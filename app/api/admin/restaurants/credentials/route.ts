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
//   POST { restaurant_id, action:"reset_all" [, signOut] }
//                                         → EVERY login on this sheet gets a new password, in one
//                                           press, for a handover. Nobody is signed out unless
//                                           signOut is asked for — see the note on resetAll().
//
// THE FOUR RULES THIS ROUTE KEEPS:
//   1. ADMIN ONLY, AND THEN UNCOVERED. Same cookie as every other /api/admin/* route, checked
//      before the first read — AND a live uncover window on top of it (lib/revealGate.ts), because
//      reading back a client's password is not the same act as reading their bills. A covered
//      console still gets the sheet's names and login ids; the password column comes back null and
//      `unlocked:false` tells the card to draw the "type the admin password" box instead.
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
import { REVEAL_COOKIE, REVEAL_LOCKED_MESSAGE, revealUnlocked } from "@/lib/revealGate";
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
  // Covered is not an error — the sheet still loads, with every name, role and login id on it. Only
  // the passwords are held back, so the card can show the whole shape of the handover and ask for
  // the admin password once, at the moment he actually needs to read one.
  const unlocked = await revealUnlocked(req.cookies.get(REVEAL_COOKIE)?.value);
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

  // HOW BUSY THE RESTAURANT IS RIGHT NOW — a NUMBER on the card, not a veto (owner, 2026-09-13).
  // The card offers a "sign everyone out too" tick beside the reset, and this is what lets it say
  // "23 tables are open right now" in the moment he is deciding, instead of the server deciding for
  // him after the fact. `head: true` means the row bodies never cross the wire — only the count.
  const openQ = await sb.from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", rid).in("status", ["open", "pending"]);
  // A failed count only costs the sentence. It must NOT cost the sheet, and it must not silently
  // read as zero — "no tables open" is the reassuring answer, and it is the one thing this may not
  // invent. null renders as "couldn't check" beside the tick.
  if (openQ.error) console.error("[admin/credentials] could not count open tables:", openQ.error.message);
  const openTables = openQ.error ? null : (openQ.count ?? 0);

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
    // `hasPassword` vs `password` are two different questions and the card needs both:
    //   hasPassword:false → nothing readable was EVER kept (created before mig 330, or the vault
    //                       key was rotated). No amount of typing the admin password shows it —
    //                       the original text is not recoverable and never was. "Set a new one".
    //   password:null with hasPassword:true → there IS one, the console is just covered.
    // Sending `hasPassword` while covered is deliberate and costs nothing: it says whether a row
    // will print filled-in or blank, which is the question you ask BEFORE uncovering anything.
    ...(await (async () => {
      const pw = await openPassword(r.password_shown);
      return { hasPassword: pw !== null, password: unlocked ? pw : null };
    })()),
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
    // false = the passwords are covered right now. Distinct from vaultReady, which is about the
    // deployment and never changes while you look at it.
    unlocked,
    // How many tables are live this second — null when the count could not be read. Advice on the
    // card, never a veto: see the note above resetAll().
    openTables,
    // Only when true: the ★ could not be worked out, so its absence on the sheet means nothing.
    ...(primaryQ.error ? { primaryUnread: true } : {}),
    generatedAt: new Date().toISOString(),
  });
}

// POST — give ONE login a new password and keep it readable, so it can go on the sheet.
async function postImpl(req: NextRequest) {
  if (!(await admin(req))) return err("unauthorized", 401);
  // Every path below hands a readable password back, so all of them sit behind the uncover window.
  // 423 Locked, never 403 — the card opens the "type the admin password" box on a 423 and shows a
  // refusal on a 403, and telling a person to re-type a password when the real answer is "you may
  // not" is the worst of both.
  if (!(await revealUnlocked(req.cookies.get(REVEAL_COOKIE)?.value))) return err(REVEAL_LOCKED_MESSAGE, 423);
  if (!vaultReady()) return err("This deployment has no credential key set, so a password can't be stored for printing.", 409);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const rid = String(body.restaurant_id || "");
  if (!UUID.test(rid)) return err("invalid restaurant_id");

  // ── ONE PRESS FOR THE WHOLE RESTAURANT (owner, 2026-08-31 — item 28) ─────────────────────────────
  // Handing a restaurant over used to mean pressing "Show" once per login, each with its own
  // confirmation: owner, manager, kitchen, waiter — four rounds of the same dialogue for one handover.
  // Nobody is signed out unless it is asked for — see the note above resetAll().
  const signOut = body.signOut === true;
  if (String(body.action || "") === "reset_all") return resetAll(rid, signOut);

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
  // A token_version bump is what ends every existing session on this account. It is now OPT-IN, and
  // the card says which of the two it is about to do — see rule 4 on resetAll() below.
  const wr = await sb.from("staff_users")
    .update({
      ...(await passwordFields(password)),
      ...(signOut ? { token_version: (u.token_version || 0) + 1 } : {}),
      failed_count: 0, locked_until: null,
    })
    .eq("id", userId).select("id").maybeSingle();
  if (wr.error) return adminFail("this login's new password", wr.error, { action: "save" });
  // Never report a password the database didn't take (the 2026-07-07 rule).
  if (!wr.data) return err("Couldn't set that password — nothing was changed. Please try again.", 500);

  // The RECORD names who was changed and by whom. It never carries the password itself.
  await logAction("admin", "user_reset_password", {
    actor: "admin", restaurant_id: rid,
    detail: `new password set for "${u.name || u.username}" (${u.role}) from the handover sheet`
      + (signOut ? " · every session on that account ended" : " · their screens stayed signed in"),
  });
  return NextResponse.json({ ok: true, password, signedOut: signOut });
}

/**
 * Every login on this restaurant's sheet gets a new password, in one press.
 *
 * ── WHY THERE IS NO LONGER A MID-SERVICE REFUSAL (owner, 2026-09-13) ────────────────────────────
 * This used to REFUSE outright while any table was open, because giving every login a new password
 * bumped `token_version` — which ends every session at once, sending the waiter's tablet and the
 * kitchen screen to the login page with food on the pass. The refusal was right about the danger and
 * wrong about the cause. He said so: *"the table and the password change no relation"*.
 *
 * He is right, and the fix is to MAKE it true rather than to argue. A password and a session are two
 * different things: the hash decides who may sign in NEXT TIME, `token_version` decides who is signed
 * in NOW. Changing one never had to change the other. So `signOut` is opt-in, and with it off — the
 * default, and what a handover actually wants — every screen in the building stays exactly as it is,
 * the new passwords simply apply the next time somebody signs in. There is then nothing for an open
 * table to be interrupted BY, and nothing left for a guard to refuse.
 *
 * With `signOut` on, the eviction is back and it is the caller's stated intention; the card counts
 * the open tables and says so on the button, but it does not overrule him.
 *
 * Otherwise unchanged: the SAME single-login path, run for each person, so there is one rule for what
 * a new password does. A person whose write fails is NAMED in the answer rather than silently
 * skipped — a handover sheet missing one password without saying so is the fault this card exists
 * to remove.
 */
async function resetAll(rid: string, signOut: boolean): Promise<NextResponse> {
  if (!vaultReady()) return err("This deployment has no credential key set, so passwords can't be stored for printing.", 409);

  const rest = await sb.from("restaurants").select("id, name").eq("id", rid).maybeSingle();
  if (rest.error) return adminFail("this restaurant", rest.error, { action: "load" });
  if (!rest.data) return err("restaurant not found", 404);

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
      .update({
        ...(await passwordFields(password)),
        ...(signOut ? { token_version: (p.token_version || 0) + 1 } : {}),
        failed_count: 0, locked_until: null,
      })
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
      + (signOut ? " · every session on those accounts ended" : " · their screens stayed signed in"),
  });
  return NextResponse.json({ ok: true, reset: set.length, logins: set, signedOut: signOut, ...(failed.length ? { failed } : {}) });
}

// A double-tap must not burn two passwords and leave the printed one wrong.
export const POST = withIdempotency(postImpl, "admin");
