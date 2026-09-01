// /api/admin/restaurants/credentials — the handover sheet's data (owner, 2026-08-16).
//
// WHAT IT IS FOR. The admin hands a restaurant over and has to tell the client what their logins
// are. Until migration 330 nobody could: `password_hash` is one-way, so the starter passwords were
// shown once on the create screen and then unreadable forever. This returns the readable copy that
// migration 330 keeps alongside the hash, for ONE restaurant, so the console can show and print it.
//
//   GET  ?restaurant_id=<uuid>            → the restaurant, its owners and its panel logins,
//                                           each with its password when one is stored.
//   POST { restaurant_id, user_id }       → that ONE login gets a NEW password, stored readable,
//                                           and returned. Used by "Show" on a login created before
//                                           mig 330, whose original text does not exist anywhere.
//   POST { restaurant_id, action:"reset_all" }
//                                         → EVERY login on this sheet gets a new password, in one
//                                           press, for a handover. REFUSED while any table is open —
//                                           see the note on resetAll() below.
//
// THE THREE RULES THIS ROUTE KEEPS:
//   1. ADMIN ONLY. Same cookie as every other /api/admin/* route, checked before the first read.
//      No panel API returns `password_shown`, and RLS keeps the column off anon/authenticated
//      entirely — this handler is the only door.
//   2. A PASSWORD IS NEVER LOGGED. The audit lines below name WHO was looked at or reset and by
//      whom; they never carry the value. lib/passwordVault.ts says the same thing at openPassword().
//   3. PINs ARE NOT HERE. A manager's PIN is an authorising secret, not a handover credential — it
//      stays one-way (`pin_hash`, still hashSecret) and is deliberately absent from the sheet.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { openPassword, passwordFields, vaultReady } from "@/lib/passwordVault";
import { withIdempotency } from "@/lib/idempotency";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

// Same alphabet as the restaurant builder's starter logins: no l/o/0/1, so nothing on a printed
// sheet can be read two ways.
function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

const ROLE_ORDER: Record<string, number> = { owner: 0, manager: 1, kitchen: 2, tablet: 3, waiter: 4 };
const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", manager: "Manager panel", kitchen: "Kitchen screen",
  tablet: "Waiter tablet", waiter: "Waiter",
};

type Row = {
  id: string; username: string; name: string | null; role: string;
  active: boolean; password_shown: string | null; last_seen_at: string | null;
};

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  const rid = new URL(req.url).searchParams.get("restaurant_id") || "";
  if (!UUID.test(rid)) return err("invalid restaurant_id");

  const restQ = await sb.from("restaurants").select("id, slug, name, active, deleted_at").eq("id", rid).maybeSingle();
  if (restQ.error) return adminFail("this restaurant's handover sheet", restQ.error, { action: "load" });
  const rest = restQ.data as { id: string; slug: string; name: string; active: boolean; deleted_at: string | null } | null;
  if (!rest) return err("restaurant not found", 404);

  // Its own staff, plus every owner attached through the join table (an owner's `restaurant_id` is
  // only a filing anchor — mig 097 — so owners of THIS restaurant usually sit under another one).
  const [staffQ, linkQ] = await Promise.all([
    // Bounded (T20 sweep #7, 2026-08-27). Both are ONE restaurant's rows, so PostgREST's cap could
    // never plausibly bite — but this sheet is the thing the client is handed, and a silently short
    // list of logins is the one way it can be wrong while looking complete. A ceiling far above any
    // real staff roll says the bound is deliberate; `.limit(500)` matches the roster's own cap.
    sb.from("staff_users")
      .select("id, username, name, role, active, password_shown, last_seen_at")
      .eq("restaurant_id", rid).is("deleted_at", null).order("role").limit(500),
    sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).limit(500),
  ]);
  // Plain sentence to the console, the database's words in `detail` + the log — the same helper every
  // sibling admin route uses. These three were the last raw `error.message` bodies in this file
  // (T20 sweep #7, 2026-08-27).
  if (staffQ.error) return adminFail("this restaurant's logins", staffQ.error, { action: "load" });

  // ── A SHEET MISSING THE OWNER'S LOGIN IS THE WORST WAY FOR THIS TO FAIL (T20 sweep #7, 2026-08-27) ─
  // `linkQ.error` was never inspected. An owner's `restaurant_id` is only a filing anchor (mig 097), so
  // owners of THIS restaurant usually sit under a different one — which means this join IS how they get
  // onto the sheet. A failed read therefore printed a complete-looking handover sheet with every panel
  // login on it and NO OWNER LOGIN AT ALL, and the admin hands that to the client. The one credential
  // the client cares about most, silently absent, on a page whose whole job is completeness.
  if (linkQ.error) return adminFail("this restaurant's owner logins", linkQ.error, { action: "load" });

  const ownerIds = [...new Set((linkQ.data || []).map((l) => l.user_id as string))];
  let ownerRows: Row[] = [];
  if (ownerIds.length) {
    const o = await sb.from("staff_users")
      .select("id, username, name, role, active, password_shown, last_seen_at")
      .in("id", ownerIds).is("deleted_at", null).limit(ownerIds.length);
    if (o.error) return adminFail("this restaurant's owner logins", o.error, { action: "load" });
    ownerRows = (o.data || []) as Row[];
  }

  // The primary owner wears the ★ on the sheet, the same badge the Owners roster uses. A failed read
  // only costs the badge, so it is reported and the sheet still prints (`primaryUnread` below).
  const primaryQ = await sb.from("restaurants").select("owner_user_id").eq("id", rid).maybeSingle();
  if (primaryQ.error) console.error("[admin/credentials] could not read the primary owner:", primaryQ.error.message);
  const primaryId = primaryQ.data?.owner_user_id as string | null | undefined;

  // Merge, dedupe by id (an owner anchored to THIS restaurant appears in both reads).
  const byId = new Map<string, Row>();
  for (const r of [...ownerRows, ...((staffQ.data || []) as Row[])]) byId.set(r.id, r);

  const logins = await Promise.all([...byId.values()].map(async (r) => ({
    id: r.id,
    role: r.role,
    roleLabel: ROLE_LABEL[r.role] || (r.role.charAt(0).toUpperCase() + r.role.slice(1)),
    name: r.name || r.username,
    username: r.username,
    active: r.active === true,
    primary: r.role === "owner" && r.id === primaryId,
    // null = created before mig 330, or the vault key changed. The card offers "Show" for those,
    // which sets a new one — the original text is not recoverable and never was.
    password: await openPassword(r.password_shown),
  })));
  logins.sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
    || Number(b.primary) - Number(a.primary)
    || a.name.localeCompare(b.name));

  // The link that goes on paper. `origin` is absent on a plain GET, so build it from the headers
  // the proxy actually sets — x-forwarded-proto is what stops a printed sheet saying "https" for a
  // local http run (and vice-versa behind Vercel).
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = req.headers.get("origin") || `${proto}://${host}`;
  return NextResponse.json({
    restaurant: {
      id: rest.id, name: rest.name, slug: rest.slug,
      active: rest.active === true, binned: !!rest.deleted_at,
      guestUrl: `${origin}/r/${rest.slug}/menu`,
    },
    logins,
    // false = no vault key on this deployment, so nothing can be stored or shown. The card says so
    // instead of silently offering a button that would reset a password for nothing.
    vaultReady: vaultReady(),
    // Only when true: the ★ could not be worked out, so its absence on the sheet means nothing.
    ...(primaryQ.error ? { primaryUnread: true } : {}),
    generatedAt: new Date().toISOString(),
  });
}

// POST — give ONE login a new password and keep it readable, so it can go on the sheet.
async function postImpl(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  if (!vaultReady()) return err("This deployment has no credential key set, so a password can't be stored for printing.", 409);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const rid = String(body.restaurant_id || "");
  if (!UUID.test(rid)) return err("invalid restaurant_id");

  // ── ONE PRESS FOR THE WHOLE RESTAURANT (owner, 2026-08-31 — item 28) ─────────────────────────────
  // Handing a restaurant over used to mean pressing "Show" once per login, each with its own
  // confirmation: owner, manager, kitchen, waiter — four rounds of the same dialogue for one handover.
  //
  // ── THE GUARD, AND WHY IT IS NOT OPTIONAL ───────────────────────────────────────────────────────
  // Giving a login a new password bumps `token_version`, which ENDS EVERY SESSION that person has.
  // One login at a time, that is a decision about one person. All of them at once, it signs out
  // everybody at that restaurant in the same instant — fine on a handover morning, a disaster in the
  // middle of service, with the waiter's tablet and the kitchen screen going to the login page while
  // food is on the pass.
  //
  // He asked for the button and was told that cost. So it exists, and it REFUSES while the restaurant
  // is mid-service — any session still open on a table. That is the same signal the Repair Kit reads
  // to decide whether a table is live, and it is the honest test: a restaurant with nobody sitting at
  // a table is not serving anyone, so there is nothing to interrupt. The refusal says how many tables
  // are open and offers the one-at-a-time route, which is unchanged and still works during service.
  if (String(body.action || "") === "reset_all") return resetAll(req, rid);

  const userId = String(body.user_id || "");
  if (!UUID.test(userId)) return err("invalid user_id");

  // The person must really belong to this restaurant — either its own staff, or one of its owners
  // through the join table. Checked server-side so the button can never reach another tenant's login.
  // A blip must not read as "that login no longer exists" (404, nothing retries it) on the button that
  // mints a NEW password — nor as "doesn't belong to this restaurant", which is a refusal about
  // ownership. Both refusals are decided from these reads, so both reads answer for themselves.
  const uQ = await sb.from("staff_users")
    .select("id, username, name, role, restaurant_id, token_version")
    .eq("id", userId).is("deleted_at", null).maybeSingle();
  if (uQ.error) return adminFail("this login", uQ.error, { action: "load" });
  const u = uQ.data as { id: string; username: string; name: string | null; role: string; restaurant_id: string | null; token_version: number | null } | null;
  if (!u) return err("That login no longer exists.", 404);
  if (u.restaurant_id !== rid) {
    const ownsQ = await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).eq("user_id", userId).maybeSingle();
    if (ownsQ.error) return adminFail("this login", ownsQ.error, { action: "load" });
    if (!ownsQ.data) return err("That login doesn't belong to this restaurant.", 403);
  }

  const password = genPassword();
  // token_version bump = every existing session on this account ends, which is the honest
  // consequence of changing a password and is what the confirm step warns about.
  const wr = await sb.from("staff_users")
    .update({ ...(await passwordFields(password)), token_version: (u.token_version || 0) + 1, failed_count: 0, locked_until: null })
    .eq("id", userId).select("id").maybeSingle();
  if (wr.error) return adminFail("this login's new password", wr.error, { action: "save" });
  // Never report a password the database didn't take (the 2026-07-07 rule).
  if (!wr.data) return err("Couldn't set that password — nothing was changed. Please try again.", 500);

  // The RECORD names who was changed and by whom. It never carries the password itself.
  await logAction("admin", "user_reset_password", {
    actor: "admin", restaurant_id: rid,
    detail: `new password set for "${u.name || u.username}" (${u.role}) from the handover sheet`,
  });
  return NextResponse.json({ ok: true, password });
}

/**
 * Every login on this restaurant's sheet gets a new password, in one press.
 *
 * Refused mid-service (see the note at the call site). Otherwise: the SAME single-login path, run for
 * each person, so there is one rule for what a new password does — a fresh readable copy, a bumped
 * `token_version`, and a cleared lockout. A person whose write fails is NAMED in the answer rather
 * than silently skipped: a handover sheet that is missing one password without saying so is the fault
 * this whole card was built to remove.
 */
async function resetAll(req: NextRequest, rid: string): Promise<NextResponse> {
  if (!vaultReady()) return err("This deployment has no credential key set, so passwords can't be stored for printing.", 409);

  const rest = await sb.from("restaurants").select("id, name").eq("id", rid).maybeSingle();
  if (rest.error) return adminFail("this restaurant", rest.error, { action: "load" });
  if (!rest.data) return err("restaurant not found", 404);

  // MID-SERVICE CHECK. A failed read REFUSES — deciding "nobody is sitting down" from a query that
  // did not answer is the one direction this must never guess in, because the cost is a floor full of
  // signed-out staff. Same status list the Repair Kit uses for "is this table live".
  const openQ = await sb.from("sessions").select("table_number")
    .eq("restaurant_id", rid).in("status", ["open", "pending"]).limit(500);
  if (openQ.error) return adminFail("whether this restaurant is mid-service", openQ.error, { action: "load" });
  const openTables = (openQ.data || []).length;
  if (openTables > 0) {
    return NextResponse.json({
      error: `${rest.data.name} has ${openTables} table${openTables === 1 ? "" : "s"} open right now. Changing every password signs out every screen at once — the waiter tablet and the kitchen would go to the login page mid-service. Close the tables first, or use Show on one login at a time.`,
      reason: "mid_service",
      openTables,
    }, { status: 409 });
  }

  // Everyone on the sheet: this restaurant's own staff, plus every owner attached through the join
  // table. Exactly the same two reads the GET builds the sheet from, and they answer for themselves
  // for exactly the same reason — a sheet silently missing the owner is the worst failure it has.
  const [staffQ, linkQ] = await Promise.all([
    sb.from("staff_users").select("id, username, name, role, token_version")
      .eq("restaurant_id", rid).is("deleted_at", null).limit(500),
    sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).limit(500),
  ]);
  if (staffQ.error) return adminFail("this restaurant's logins", staffQ.error, { action: "load" });
  if (linkQ.error) return adminFail("this restaurant's owner logins", linkQ.error, { action: "load" });

  type Person = { id: string; username: string; name: string | null; role: string; token_version: number | null };
  const byId = new Map<string, Person>();
  for (const p of (staffQ.data || []) as Person[]) byId.set(p.id, p);
  const ownerIds = [...new Set((linkQ.data || []).map((l) => l.user_id as string))].filter((id) => !byId.has(id));
  if (ownerIds.length) {
    const o = await sb.from("staff_users").select("id, username, name, role, token_version")
      .in("id", ownerIds).is("deleted_at", null).limit(ownerIds.length);
    if (o.error) return adminFail("this restaurant's owner logins", o.error, { action: "load" });
    for (const p of (o.data || []) as Person[]) byId.set(p.id, p);
  }
  const people = [...byId.values()];
  if (!people.length) return err("This restaurant has no logins to reset.", 409);

  const set: { id: string; name: string; role: string; username: string; password: string }[] = [];
  const failed: string[] = [];
  for (const p of people) {
    const password = genPassword();
    const wr = await sb.from("staff_users")
      .update({ ...(await passwordFields(password)), token_version: (p.token_version || 0) + 1, failed_count: 0, locked_until: null })
      .eq("id", p.id).select("id").maybeSingle();
    // Never report a password the database didn't take (the 2026-07-07 rule), and never let one
    // failure hide behind the others.
    if (wr.error || !wr.data) { failed.push(p.name || p.username); continue; }
    set.push({ id: p.id, name: p.name || p.username, role: p.role, username: p.username, password });
  }

  // ONE record for the whole action, naming who was changed and by whom — never a password.
  await logAction("admin", "user_reset_password", {
    actor: "admin", restaurant_id: rid,
    detail: `handover: new passwords set for ${set.length} login${set.length === 1 ? "" : "s"} at "${rest.data.name}"`
      + `${failed.length ? ` — ${failed.length} FAILED (${failed.join(", ")})` : ""}`
      + " · every session on those accounts ended",
  });
  return NextResponse.json({ ok: true, reset: set.length, logins: set, ...(failed.length ? { failed } : {}) });
}

// A double-tap must not burn two passwords and leave the printed one wrong.
export const POST = withIdempotency(postImpl, "admin");
