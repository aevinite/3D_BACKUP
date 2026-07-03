// Per-user staff auth (Phase 1), hardened to production standards. Each staff
// member has a row in `staff_users` with a role; login sets a tamper-proof,
// expiring cookie. The guest menu is unaffected. All DB access here is
// service-role (server only) via lib/supabaseAdmin.
//
// Security design (see migration 055 for the columns):
//   • Passwords + PINs are stored as SALTED, SLOW PBKDF2 hashes — not bare
//     SHA-256 — so a DB leak can't be reversed with rainbow tables.
//   • The cookie is HMAC-signed (not a plain hash) and carries an issued-at time;
//     the server rejects it past a 7-day max age.
//   • A per-user `token_version` is folded into the signature, so bumping it
//     instantly invalidates every existing cookie ("log out everywhere") — done
//     automatically whenever a password is changed or a user is revoked.
//   • Login is rate-limited: 5 wrong tries locks the account for 60 seconds.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { sha256hex, safeEqual, AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const USER_COOKIE = "lfh_user";
export type Role = "owner" | "manager" | "tablet" | "kitchen";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // cookies are good for 7 days
const MAX_FAILS = 5;                            // wrong tries before a lockout
const LOCK_MS = 60 * 1000;                      // lockout length (1 minute)
const PBKDF2_ITERS = 120_000;                   // slow-hash work factor

// The HMAC signing key for cookies. Prefer a dedicated SESSION_SECRET; fall back
// to the admin password so the gate still works if it isn't set separately.
const SECRET = () =>
  process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.STAFF_PASSWORD || "lfh-dev-secret";

export type StaffUser = {
  id: string; username: string; role: Role; restaurant_id: string;
  name: string | null; phone: string | null; active: boolean; pin_hash: string | null;
  token_version: number; can_self_reset: boolean; can_self_set_pin: boolean; profile_confirmed: boolean;
  // Per-user capability overrides (migration 115): capability-key → 'on'|'pin'|'off'.
  // Absent key = inherit the restaurant-wide default. Rides free on the select("*")
  // row reads below — no extra query anywhere.
  permissions: Record<string, string> | null;
};

// Normalize a typed "Name" into the canonical login key stored in `username`:
// trimmed, lowercased, inner whitespace collapsed. This is what makes a single
// "Name" field double as a forgiving, unique login id ("Raj  Kumar" === "raj
// kumar"). Used by BOTH account creation/edit and the login lookup so they agree.
export function normalizeLoginName(s: string): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ── small byte/base64 helpers (work in both Node and edge runtimes) ──────────
const enc = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDec = (s: string) => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

// ── password / PIN hashing: salted, slow PBKDF2-SHA256 ───────────────────────
async function pbkdf2(plain: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc(plain), "PBKDF2", false, ["deriveBits"]);
  // Cast: getRandomValues / decoded bytes are valid BufferSource at runtime; the
  // generic Uint8Array<ArrayBufferLike> type just needs a nudge under strict TS.
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: iters, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}
// Produce a self-describing hash string: "pbkdf2$<iters>$<salt>$<hash>".
export async function hashSecret(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(plain, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${b64url(salt)}$${b64url(h)}`;
}
// Constant-time verify. Also tolerates a legacy bare-SHA-256 hash (none exist
// today, but this keeps us safe if an old row ever appears).
export async function verifySecret(plain: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts[0] !== "pbkdf2" || parts.length !== 4) {
    return safeEqual(await sha256hex(plain), stored); // legacy fallback
  }
  const iters = parseInt(parts[1], 10) || PBKDF2_ITERS;
  const salt = b64urlDec(parts[2]);
  const got = b64url(await pbkdf2(plain, salt, iters));
  return safeEqual(got, parts[3]);
}

// ── cookie sign / verify (HMAC-SHA256 over id:role:token_version:iat) ─────────
async function hmac(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc(SECRET()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc(msg));
  return b64url(new Uint8Array(sig));
}
// Cookie value = "<id>.<iat>.<sig>". id is a uuid and iat a number (neither
// contains "."), and the sig is base64url, so a 3-way split is unambiguous.
async function sign(u: { id: string; role: string; token_version: number }): Promise<string> {
  const iat = Date.now();
  const sig = await hmac(`${u.id}:${u.role}:${u.token_version}:${iat}`);
  return `${u.id}.${iat}.${sig}`;
}

// Verify username+password against staff_users (active only), with lockout. On
// success resets the fail counter and returns the user + a ready-to-set cookie.
export async function loginUser(
  username: string, password: string,
): Promise<{ ok: true; user: StaffUser; cookie: string } | { ok: false; error: string }> {
  const uname = normalizeLoginName(username);
  if (!uname || !password) return { ok: false, error: "Enter your name and password." };
  // Username is unique only PER restaurant (mig 091), so the SAME name can exist at
  // several restaurants. Fetch every active match and pick the one whose PASSWORD
  // verifies — so the login form needs no restaurant field. (The only ambiguity is
  // two restaurants sharing BOTH the same name AND password; then the first wins.)
  const candidates = ((await sb.from("staff_users").select("*").eq("username", uname).eq("active", true)).data || []) as any[];
  // Same generic message whether the name is missing or the password is wrong —
  // never reveal which names exist.
  if (!candidates.length) return { ok: false, error: "Wrong name or password." };
  // Honour a lockout on ANY matching row (don't let a colliding name dodge it).
  const now = new Date();
  if (candidates.some((u) => u.locked_until && new Date(u.locked_until) > now)) {
    return { ok: false, error: "Too many tries — wait a minute and try again." };
  }
  let matched: any = null;
  for (const u of candidates) {
    if (await verifySecret(String(password), u.password_hash)) { matched = u; break; }
  }
  if (!matched) {
    // Wrong password → bump the fail counter (and lock past the limit) on each match.
    for (const u of candidates) {
      const fc = (u.failed_count || 0) + 1;
      const patch = fc >= MAX_FAILS
        ? { failed_count: 0, locked_until: new Date(Date.now() + LOCK_MS).toISOString() }
        : { failed_count: fc };
      await sb.from("staff_users").update(patch).eq("id", u.id);
    }
    return { ok: false, error: "Wrong name or password." };
  }
  await sb.from("staff_users")
    .update({ failed_count: 0, locked_until: null, last_seen_at: new Date().toISOString() })
    .eq("id", matched.id);
  return { ok: true, user: matched as StaffUser, cookie: await sign(matched) };
}

// Resolve a USER_COOKIE value to its (active) user: verify the HMAC signature
// against the user's CURRENT role + token_version, and reject if older than the
// max age. Any mismatch (tampered, role changed, token bumped, expired) → null.
export async function userFromCookie(value: string | undefined | null): Promise<StaffUser | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, iatStr, sig] = parts;
  const iat = Number(iatStr);
  if (!id || !Number.isFinite(iat)) return null;
  if (Date.now() - iat > TOKEN_TTL_MS) return null; // expired
  const u = (await sb.from("staff_users").select("*").eq("id", id).eq("active", true).limit(1)).data?.[0];
  if (!u) return null;
  const expected = await hmac(`${id}:${u.role}:${u.token_version}:${iat}`);
  if (!safeEqual(sig, expected)) return null;
  return u as StaffUser;
}

// Role hierarchy: an OWNER can do anything a manager can, and a MANAGER can also
// act on the kitchen/tablet panels (oversight). kitchen and tablet are device
// siblings — neither may use the other's API. The admin super-user bypasses all.
export function roleSatisfies(have: Role, need: Role): boolean {
  if (have === need) return true;
  if (have === "owner") return true;                                      // owner ⊇ everything
  if (have === "manager") return need === "kitchen" || need === "tablet"; // manager ⊇ kitchen/tablet
  return false;
}

// Authoritative gate for a panel's API route handlers: allow a valid user cookie
// whose role SATISFIES the requirement (per the hierarchy above), OR a valid ADMIN
// cookie (super-access). Returns the acting user (null for admin super-access), or
// false if denied.
//
// ORDER MATTERS (QA sweep, 2026-07-03): the STAFF login is checked FIRST. On a
// device holding BOTH cookies — the owner's own machine constantly does: he signs
// into /aevinite AND tests staff panels — the old admin-first order returned
// user:null, so panelRestaurantId fell through to the admin act-as/default path and
// silently scoped a logged-in waiter's panel to restaurant #1 (or whatever the admin
// last viewed). Observed live: burger-barn's waiter tablet answering with
// french-house's 300-tile floor + 59-dish menu — a cross-restaurant leak. A person
// who explicitly signed in must always act as THAT person; the admin fallback is
// only for admin-only sessions (its ?rid / act-as flow is unchanged).
export async function requireRole(
  req: { cookies: { get(name: string): { value: string } | undefined } },
  role: Role,
): Promise<{ ok: true; user: StaffUser | null } | { ok: false }> {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u && roleSatisfies(u.role, role)) {
    // Presence heartbeat (throttled ~45s): mark this user active now so admin/owner
    // see who's working / which panel is open. Fire-and-forget; never blocks the call.
    const seen = (u as { last_seen_at?: string | null }).last_seen_at;
    if (!seen || Date.now() - new Date(seen).getTime() > 45_000) {
      sb.from("staff_users").update({ last_seen_at: new Date().toISOString() }).eq("id", u.id).then(() => {}, () => {});
    }
    return { ok: true, user: u };
  }
  // No satisfying staff session → the ADMIN super-user may still pass (their panel
  // scope then comes from ?rid / the act-as cookie via panelRestaurantId).
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) return { ok: true, user: null }; // admin super
  return { ok: false };
}
