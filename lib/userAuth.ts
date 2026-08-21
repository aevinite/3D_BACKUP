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
import { isPanelEnabledCached, ownerPanelEnabled, isRestaurantDeleted } from "@/lib/panelAccess";

export const USER_COOKIE = "lfh_user";
export type Role = "owner" | "manager" | "tablet" | "kitchen";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // cookies are good for 7 days
const MAX_FAILS = 5;                            // wrong tries before a lockout
const LOCK_MS = 60 * 1000;                      // lockout length (1 minute)
const PBKDF2_ITERS = 120_000;                   // slow-hash work factor
const MAX_USERNAME_LEN = 100;                   // login inputs are length-capped so an
const MAX_PASSWORD_LEN = 200;                   // oversize value can't waste PBKDF2 CPU
// HOW MANY ACCOUNTS ONE TYPED NAME MAY MATCH (2026-08-21).
//
// A username is unique only PER restaurant (mig 091), so the same name legitimately exists at
// several restaurants and the lookup below fetches every match. It had no `.limit()` at all, and
// every LIVE match then costs one PBKDF2 verify at 120,000 iterations — so the read AND the CPU per
// login attempt grew with the number of tenants sharing a common name ("admin", "manager", "raj").
// `docs/SAAS-EFFICIENCY-PLAYBOOK.md` has carried "cap the userAuth candidate loop" as owed work
// since 2026-06-26; this is that cap.
//
// Set far above anything real (nine restaurants exist today) so it is a ceiling on pathology, not a
// rule anybody meets — and it says so out loud when it is reached, because a login that quietly
// stopped matching would be the worst possible way to find out.
const MAX_LOGIN_CANDIDATES = 50;

// Why a login failed — the SENSITIVE detail. NEVER shown to the user (they only ever
// see the generic "Wrong name or password."); it's returned so the route can record
// it in the ADMIN operation log ("who tried what was lacking"). "transient" is a
// server/DB blip, not a real failure, and must not be logged as one.
export type LoginFailReason = "empty" | "too_long" | "transient" | "no_such_name" | "locked" | "wrong_password" | "disabled";
// Who/where an attempt was aimed at, for the audit log. For an unknown name we only
// know what was typed; for a wrong password we know the real account it targeted.
export type LoginAttempt = { username: string; role?: Role; restaurant_id?: string; actor?: string | null };

// The HMAC signing key for cookies. Prefer a dedicated SESSION_SECRET; fall back
// to the admin password so the gate still works if it isn't set separately.
//
// ⚠️ WHAT THAT FALLBACK COSTS, SAID OUT LOUD (sweep 2026-08-05). This key signs EVERY staff
// cookie. On a stack where SESSION_SECRET is not set, the key IS the admin password — so changing
// the admin password re-signs nothing and instantly invalidates every existing cookie: every
// waiter tablet, every kitchen screen and every manager on every restaurant is logged out at once,
// mid-service, and nothing in the admin UI warns that the field does that. Set SESSION_SECRET on
// every deployment and the two are independent (it is set on this dev stack). The warning below
// fires once per server start so a stack missing it is visible in the logs instead of only
// discovered by a floor full of signed-out staff.
let warnedNoSessionSecret = false;
const SECRET = () => {
  const dedicated = process.env.SESSION_SECRET;
  if (!dedicated && !warnedNoSessionSecret) {
    warnedNoSessionSecret = true;
    console.warn(
      "[auth] SESSION_SECRET is not set, so staff cookies are signed with the admin password. " +
      "Changing ADMIN_PASSWORD will sign out every staff device on every restaurant at once. " +
      "Set SESSION_SECRET in this deployment's env to keep the two independent.",
    );
  }
  return dedicated || process.env.ADMIN_PASSWORD || process.env.STAFF_PASSWORD || "lfh-dev-secret";
};

export type StaffUser = {
  id: string; username: string; role: Role; restaurant_id: string;
  name: string | null; phone: string | null; active: boolean; pin_hash: string | null;
  token_version: number; can_self_reset: boolean; can_self_set_pin: boolean; profile_confirmed: boolean;
  // Per-user capability overrides (migration 115): capability-key → 'on'|'pin'|'off'.
  // Absent key = inherit the restaurant-wide default. Rides free on the select("*")
  // row reads below — no extra query anywhere.
  permissions: Record<string, string> | null;
  // Waiter sections (migration 222): the table numbers this tablet login may see and act
  // on. Rides free on the same select("*") as `permissions` — see lib/tableAssign.ts, which
  // also explains why an empty array only restricts anyone while the module is on.
  assigned_tables: number[] | null;
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
// `restaurantId` (the tenant-scoped /r/<slug>/login door) restricts the lookup to
// ONE restaurant's staff — the same name+password at another restaurant no longer
// matches at all, which removes the bare login's cross-restaurant ambiguity below.
export async function loginUser(
  username: string, password: string, restaurantId?: string,
): Promise<
  | { ok: true; user: StaffUser; cookie: string }
  | { ok: false; error: string; transient?: boolean; reason?: LoginFailReason; attempted?: LoginAttempt }
> {
  const uname = normalizeLoginName(username);
  if (!uname || !password) return { ok: false, error: "Enter your username and password.", reason: "empty" };
  // Length cap BEFORE the (slow) PBKDF2 verify: a huge password would otherwise burn
  // CPU per attempt. Same generic message so it reveals nothing.
  if (uname.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
    return { ok: false, error: "Wrong name or password.", reason: "too_long", attempted: { username: uname.slice(0, 80) } };
  }
  // Username is unique only PER restaurant (mig 091), so the SAME name can exist at
  // several restaurants. Fetch every active match and pick the one whose PASSWORD
  // verifies — so the login form needs no restaurant field. (The only ambiguity is
  // two restaurants sharing BOTH the same name AND password; then the first wins.)
  // `deleted_at IS NULL`: a recycle-bin account is not a login. Since mig 245 a binned
  // row's name can be re-used by a LIVE account, so without this filter a lookup could
  // match the dead row (and its old password) instead of the real one.
  //
  // DISABLED rows (active=false) are fetched too — not to log them in, but so a disabled
  // person who types their RIGHT password can be told the truth instead of "wrong password"
  // (owner, 2026-08-02: "if it is disabled, user will see he has been disabled"). Only a
  // verified password unlocks that message, so it reveals nothing to someone guessing names.
  const candRes = await sb.from("staff_users").select("*").eq("username", uname)
    .is("deleted_at", null).limit(MAX_LOGIN_CANDIDATES);
  // A FAILED lookup is a server problem, not wrong credentials — don't gaslight the
  // waiter into resetting a password during a network blip (stress test 2026-07-03).
  if (candRes.error) return { ok: false, error: "Can't reach the server — try again in a moment.", transient: true, reason: "transient" };
  let candidates = (candRes.data || []) as any[];
  // Reaching the ceiling means a real account may not have been considered, which must never be
  // silent (see MAX_LOGIN_CANDIDATES). Unreachable at today's scale; visible in the logs if it ever is.
  if (candidates.length >= MAX_LOGIN_CANDIDATES) {
    console.warn(`[auth] the name "${uname}" matches ${MAX_LOGIN_CANDIDATES}+ accounts — raise MAX_LOGIN_CANDIDATES or give the login door a restaurant.`);
  }
  if (restaurantId) {
    // Tenant door (/r/<slug>/login): only THAT restaurant's people may match. Staff
    // rows carry the restaurant directly; OWNER rows carry the #1 "home" namespace,
    // not the restaurants they own — so an owner used to be locked out of their own
    // restaurant's door (2026-07-06 fix). Owners match via the restaurant_owners
    // join table instead: keep an owner candidate only if they OWN this restaurant.
    const ownerIds = candidates.filter((u) => u.role === "owner" && u.restaurant_id !== restaurantId).map((u) => u.id);
    let ownsHere = new Set<string>();
    if (ownerIds.length) {
      const links = await sb.from("restaurant_owners").select("user_id")
        .eq("restaurant_id", restaurantId).in("user_id", ownerIds);
      if (links.error) return { ok: false, error: "Can't reach the server — try again in a moment.", transient: true, reason: "transient" };
      ownsHere = new Set((links.data || []).map((l) => l.user_id as string));
    }
    candidates = candidates.filter((u) =>
      u.restaurant_id === restaurantId || (u.role === "owner" && ownsHere.has(u.id)));
  }
  // Build the audit-log "who was targeted" from a candidate row (the real account a
  // wrong password / lockout was aimed at). Used only for the admin log, never shown.
  const attemptOf = (u: any): LoginAttempt => ({
    username: uname, role: u.role, restaurant_id: u.restaurant_id, actor: u.name || u.username,
  });
  // Same generic message whether the name is missing or the password is wrong —
  // never reveal which names exist.
  if (!candidates.length) {
    return { ok: false, error: "Wrong name or password.", reason: "no_such_name", attempted: { username: uname, restaurant_id: restaurantId } };
  }
  // Only LIVE accounts can sign in; disabled rows exist here purely for the honest message below.
  const live = candidates.filter((u) => u.active === true);
  // Honour a lockout on ANY matching live row (don't let a colliding name dodge it).
  const now = new Date();
  const lockedCand = live.find((u) => u.locked_until && new Date(u.locked_until) > now);
  if (lockedCand) {
    return { ok: false, error: "Too many tries — wait a minute and try again.", reason: "locked", attempted: attemptOf(lockedCand) };
  }
  let matched: any = null;
  for (const u of live) {
    if (await verifySecret(String(password), u.password_hash)) { matched = u; break; }
  }
  if (!matched) {
    // A DISABLED account with the RIGHT password is told so plainly (owner, 2026-08-02) —
    // a person locked out by their manager must never be left guessing at a password that
    // is in fact correct. Checked only after every live row failed, and only on a verified
    // password, so name-guessing still learns nothing.
    for (const u of candidates) {
      if (u.active !== true && await verifySecret(String(password), u.password_hash)) {
        return { ok: false, error: "This login has been disabled. Speak to your manager or owner.", reason: "disabled", attempted: attemptOf(u) };
      }
    }
    if (!live.length) {
      // The name exists only on disabled rows and the password was wrong → the same generic
      // answer an unknown name gets (these rows were invisible here before 2026-08-02).
      return { ok: false, error: "Wrong name or password.", reason: "no_such_name", attempted: { username: uname, restaurant_id: restaurantId } };
    }
    // Wrong password → bump the fail counter (and lock past the limit) on each live match.
    for (const u of live) {
      const fc = (u.failed_count || 0) + 1;
      const patch = fc >= MAX_FAILS
        ? { failed_count: 0, locked_until: new Date(Date.now() + LOCK_MS).toISOString() }
        : { failed_count: fc };
      await sb.from("staff_users").update(patch).eq("id", u.id);
    }
    return { ok: false, error: "Wrong name or password.", reason: "wrong_password", attempted: attemptOf(live[0]) };
  }
  await sb.from("staff_users")
    .update({ failed_count: 0, locked_until: null, last_seen_at: new Date().toISOString() })
    .eq("id", matched.id);
  return { ok: true, user: matched as StaffUser, cookie: await sign(matched) };
}

// Thrown when the cookie could not be VERIFIED because the staff_users lookup itself
// failed (DB/network blip) — deliberately distinct from "cookie is invalid". The
// 2026-07-03 stress test showed a few seconds of DNS flap 401-logging-out EVERY open
// panel because a failed lookup fell through the same `!u` branch as a bad cookie.
// A transient outage must surface as 503 ("try again"), never as "please log in".
export class AuthDbError extends Error {}

// Resolve a USER_COOKIE value to its (active) user: verify the HMAC signature
// against the user's CURRENT role + token_version, and reject if older than the
// max age. Any mismatch (tampered, role changed, token bumped, expired) → null.
// Throws AuthDbError when the lookup FAILS (vs. finding nothing).
export async function userFromCookie(value: string | undefined | null): Promise<StaffUser | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [id, iatStr, sig] = parts;
  const iat = Number(iatStr);
  if (!id || !Number.isFinite(iat)) return null;
  if (Date.now() - iat > TOKEN_TTL_MS) return null; // expired
  // Retry the lookup once on a hard error before giving up (bug #9, 2026-07-06): a
  // brief DB/DNS flap otherwise threw AuthDbError, which the page/layout gates surface
  // as a raw 500. A single ~120ms retry clears most transient flaps so the gate never
  // trips; a SUSTAINED outage still throws (fail-closed, requireRole answers 503).
  let res = await sb.from("staff_users").select("*").eq("id", id).eq("active", true).limit(1);
  if (res.error) {
    await new Promise((r) => setTimeout(r, 120));
    res = await sb.from("staff_users").select("*").eq("id", id).eq("active", true).limit(1);
  }
  if (res.error) throw new AuthDbError(res.error.message);
  const u = res.data?.[0];
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
  req: { cookies: { get(name: string): { value: string } | undefined }; nextUrl?: { searchParams?: URLSearchParams } },
  role: Role,
): Promise<{ ok: true; user: StaffUser | null } | { ok: false; transient?: boolean }> {
  // PER-TAB ADMIN PIN — checked even before the staff cookie (owner, 2026-07-28). A
  // request carrying ?rid= is one only an ADMIN-VIEW tab produces: the console's
  // act-as/go flow appends it, panelAdminRid strips it for real staff, and the panel
  // echoes it on every API call. Tabs share one cookie jar, so the staff-first order
  // below used to let a staff login in ANOTHER tab take over an admin-opened panel
  // mid-session. A pinned request with a valid admin cookie therefore stays the
  // admin's, regardless of who else is signed in; without the admin cookie the pin
  // is ignored and nothing changes for real staff.
  if (req.nextUrl?.searchParams?.get("rid") && (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) {
    return { ok: true, user: null }; // admin super — scope comes from the same ?rid via panelRestaurantId
  }
  let u: StaffUser | null;
  try {
    u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  } catch (e) {
    // DB blip ≠ logged out: gates answer 503, panels keep their session and retry.
    if (e instanceof AuthDbError) return { ok: false, transient: true };
    throw e;
  }
  if (u && roleSatisfies(u.role, role)) {
    // Panel entitlement (bug M3, 2026-07-05): if the admin turned this role's panel OFF for
    // the user's restaurant, block the request — not just new logins. Before, requireRole
    // ignored the toggle, so an already-open manager/kitchen/tablet kept loading AND SAVING
    // until it reloaded. Cached (30s TTL) so this hot path never adds a per-request read.
    // OWNERS are special (2026-07-06): their row's restaurant_id is the #1 "home"
    // namespace, not what they own — their entitlement is "any owned restaurant has
    // the owner panel on" (ownerPanelEnabled reads the restaurant_owners join).
    if (u.role === "owner") {
      if (!(await ownerPanelEnabled(u.id))) return { ok: false };
    } else {
      if (!(await isPanelEnabledCached(u.role, u.restaurant_id))) return { ok: false };
      // Recycle-bin block (bug H2, 2026-07-06): if the admin soft-deleted this restaurant,
      // a manager/kitchen/tablet tab left OPEN kept loading AND saving orders on a "deleted"
      // restaurant until it reloaded — the M3 panel-toggle fix never added the parallel
      // deleted_at check. Same 30s-TTL cache as the panel map, so no per-request read; a
      // fresh delete takes effect within TTL. Owners are exempt here — their restaurant_id is
      // the #1 home namespace, and ownerPanelEnabled already excludes binned restaurants.
      if (await isRestaurantDeleted(u.restaurant_id)) return { ok: false };
    }
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

// ── Who was this login for? (alert wording only) ───────────────────────────────────────────
// When a login limit is reached the owner gets a phone ping + a bell entry. Those used to say
// only the typed name ("ravi") — not which RESTAURANT it belongs to, nor whether it's a manager,
// a kitchen screen, a waiter tablet or an owner (owner 2026-07-29). This builds that one human
// line. It runs ONLY on the rare wall-hit path, never on a normal login, so the hot login path
// keeps its deliberate "no DB read before the counter" shape.
// Reads are scoped + capped + explicit-column (egress rules). Never throws: a blank result just
// means the alert falls back to the plain typed name.
const ROLE_WORD: Record<string, string> = {
  owner: "Owner", manager: "Manager", kitchen: "Kitchen screen", tablet: "Waiter tablet",
};

export async function describeLoginTarget(username: string, restaurantId?: string | null): Promise<string | null> {
  try {
    const uname = normalizeLoginName(username);
    if (!uname) return null;
    const { data, error } = await sb.from("staff_users")
      .select("id, role, name, username, restaurant_id")
      .eq("username", uname).eq("active", true).is("deleted_at", null).limit(5);
    if (error) return null;
    const rows = (data || []) as { id: string; role: string; name: string | null; restaurant_id: string | null }[];
    // A name nobody has is worth SAYING — it means someone is typing a name that doesn't exist
    // here, which reads very differently from a real waiter fumbling their password.
    if (!rows.length) return `Unknown name “${uname}” — no active account has that name`;

    // Restaurant names for the rows we're about to describe (one scoped read, ≤5 ids).
    // Owners are the exception: their row's restaurant_id is the #1 "home" namespace, not what
    // they own, so an owner's restaurant comes from the ownership join instead.
    const ids = new Set<string>();
    for (const r of rows) if (r.role !== "owner" && r.restaurant_id) ids.add(r.restaurant_id);
    if (restaurantId) ids.add(restaurantId);
    const ownerRows = rows.filter((r) => r.role === "owner");
    const ownedByUser: Record<string, string[]> = {};
    if (ownerRows.length && !restaurantId) {
      const { data: links } = await sb.from("restaurant_owners")
        .select("user_id, restaurant_id").in("user_id", ownerRows.map((r) => r.id)).limit(20);
      for (const l of (links || []) as { user_id: string; restaurant_id: string }[]) {
        ids.add(l.restaurant_id);
        (ownedByUser[l.user_id] ||= []).push(l.restaurant_id);
      }
    }
    const nameOf: Record<string, string> = {};
    if (ids.size) {
      const { data: rests } = await sb.from("restaurants").select("id, name").in("id", [...ids]).limit(20);
      for (const r of (rests || []) as { id: string; name: string }[]) nameOf[r.id] = r.name;
    }

    const describe = (r: typeof rows[number]) => {
      const role = ROLE_WORD[r.role] || r.role;
      // Don't repeat the same word twice ("“diagm1” (diagm1)") when the display name IS the login name.
      const person = r.name && r.name.toLowerCase() !== uname ? `“${r.name}” (${uname})` : `“${uname}”`;
      let where: string;
      if (r.role === "owner") {
        const owned = (restaurantId ? [restaurantId] : ownedByUser[r.id] || []).map((id) => nameOf[id]).filter(Boolean);
        where = owned.length ? owned.slice(0, 2).join(" + ") + (owned.length > 2 ? ` +${owned.length - 2} more` : "") : "their restaurants";
      } else {
        where = (r.restaurant_id && nameOf[r.restaurant_id]) || "unknown restaurant";
      }
      return `${role} ${person} at ${where}`;
    };
    // The same name can exist at several restaurants (mig 091), and the plain /login door can't
    // tell them apart — so name the first and say how many others share it.
    const first = describe(rows[0]);
    return rows.length > 1 ? `${first} (+${rows.length - 1} more account${rows.length > 2 ? "s" : ""} use this name)` : first;
  } catch {
    return null; // wording help only — never let it break a login or an alert
  }
}
