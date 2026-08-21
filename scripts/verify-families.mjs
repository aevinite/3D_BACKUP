// verify-families.mjs — the three families of error-hunting that the STAFF PANELS introduced
// (2026-06-12), reduced to the four properties nothing else in this folder holds:
//
//   1. Moving a table refuses the three ways it can be wrong — a target that is not a table, the
//      table it is already on, and a table that already has a party. A waiter who mis-taps must be
//      told, not silently moved.
//   2. Six orders placed in the same instant get six DIFFERENT kitchen-ticket numbers. Two tickets
//      sharing a number is two tables' food on one slip.
//   3. The four backend-only switches (verification / payments / aggregators / gst_invoice) are OFF
//      on the test restaurant. They are invisible in every UI on purpose, so nothing on screen would
//      ever show one had been turned on.
//   4. A guest's star rating is refused when it is out of range, and refused for an order that does
//      not exist. The stars are shown to other diners as fact.
//
// ── WHAT WAS HERE BEFORE, AND WHY IT IS GONE (sweep #6 / T28, 2026-08-22) ─────────────────────────
// This file predated the 2026-06-13 merge of the four panel servers into ONE app, and it had been
// crashing on `ECONNREFUSED ::1:4003` — a port that stopped existing over two months ago — so not one
// of its assertions had run. The 2026-07-30 note on it said as much and asked for a review one by
// one. That review is done, and most of it was duplicated or retired:
//
//   · "a guest's key cannot reach a staff-only function" (three RPC calls) — `verify:grants` asks
//     this of EVERY function in the database against a 48-entry allow-list, in both directions, and
//     also proves each allow-listed one really is callable. Three hand-picked calls add nothing.
//   · "a tampered price is ignored" / "a sold-out dish is refused" — held by verify:tax-mode,
//     verify:hidden-dishes, verify:order-retry and verify:t24-money-rules.
//   · "the tablet refuses junk input" — held by verify:order and verify:guest-recovery.
//   · "a malformed features payload is sanitised" — that path is GONE. POST /settings { features }
//     answers 403 now: guest switches are the ADMIN's alone (docs/ACCESS-MODEL.md), set on
//     /aevinite/access, and the panel's own save was the only way into settings.features with no key
//     allow-list. Asserting the old sanitiser back would be asking for that door to reopen.
//   · "the verification RPC answers disabled while its flag is off" — KEPT, in the stronger form the
//     database terminal gave it on main while this rewrite was in flight: migration 360 RETIRED
//     lfh_request_verification (it was the surviving half of the mig-037 stub, and it was still
//     reachable with the public menu key), so the rule is no longer "it politely declines" but "it
//     cannot be called at all". A feature that cannot be reached is better evidence for "this system
//     isn't there". Their sentence, on a file that can actually run it — theirs was added to the
//     version that had been dying on a retired port for two months, so the check never executed.
//   · "a discount is clamped to the order total" — held by verify:t24-money-rules and the phase suite.
//
// It writes only to My Little French House, on tables 21 and 22, and retires what it created the way
// the product does (an issued order or session cannot be hard-deleted — mig 190).
//   node scripts/verify-families.mjs [--base http://localhost:4000]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { adminHeaders } from "./sweep/login.mjs";
import { requireUp } from "./sweep/appUp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (() => { const i = process.argv.indexOf("--base"); return (i > -1 && process.argv[i + 1]) || process.env.VERIFY_BASE || "http://localhost:4000"; })().replace(/\/$/, "");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
// Nothing answering = "could not run" (exit 2), said in plain words — never a raw ECONNREFUSED
// stack, which reads as "this guard is broken". (sweep #6 / T28, 2026-08-22)
await requireUp(BASE, "the panel writes it drives");
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB || !SRK || !ANON) { console.error("missing supabase env"); process.exit(1); }

const RID = "00000000-0000-0000-0000-000000000001";   // My Little French House
const TA = "21", TB = "22";                            // quiet test tables, both retired at the end
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "✓" : "✗ FAIL"} ${label}`); if (!ok) failures++; };
const head = (t) => console.log(`\n— ${t} —`);

const sb = async (method, path, body) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const rpc = async (key, fn, args) => {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// A panel write, the sanctioned way: the admin gate cookie plus ?rid=, so nothing here ever posts a
// password and nothing counts against a login limit. requireRole() accepts exactly this pair.
const panel = async (family, path, body) => {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}/api/${family}${path}${sep}rid=${RID}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...adminHeaders(BASE) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// TEARDOWN FOLLOWS THE PRODUCT'S OWN RULE, and it is SCOPED. mig 190 refuses a hard delete of any
// order carrying a KOT number or any session carrying a bill number, so the fixture is retired the way
// a cancellation is. Both writes name the restaurant: tables 21 and 22 exist in every restaurant on
// the stack, and an unscoped close would end a live party somewhere else.
// Rating rows this run left behind, by id. A 4-star "Tester" review sits on the manager's Rating
// review screen and counts towards a dish's stars, so it is not something to leave lying about.
const ratings = [];
const cleanup = async () => {
  const now = new Date().toISOString();
  while (ratings.length) { const id = ratings.pop(); try { await sb("DELETE", `feedback?restaurant_id=eq.${RID}&id=eq.${id}`); } catch (e) { console.log("   cleanup: rating " + id + " did not go — " + e.message); } }
  await sb("PATCH", `orders?restaurant_id=eq.${RID}&table_number=in.(${TA},${TB})&archived=is.false`,
    { status: "cancelled", archived: true, archived_at: now, cancelled_at: now });
  await sb("PATCH", `sessions?restaurant_id=eq.${RID}&table_number=in.(${TA},${TB})&status=eq.open`,
    { status: "closed", closed_at: now, deleted_at: now });
  await sb("DELETE", `requests?restaurant_id=eq.${RID}&table_number=in.(${TA},${TB})`);
};

try {
  await cleanup();
  const dish = (await sb("GET", `menu_items?restaurant_id=eq.${RID}&select=id&limit=1`))[0];
  if (!dish) throw new Error("the test restaurant has no dishes to order");

  // ─────────────────────────────────────────────────────────────────────────
  head("1 · moving a table refuses every way it can be wrong");
  // A real party on TA, opened the way a waiter opens one: by taking an order.
  const placed = await rpc(SRK, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: dish.id, qty: 1 }], p_allergies: [], p_note: null, p_restaurant_id: RID });
  if (!placed.body || placed.body.ok !== true) throw new Error("could not seat the fixture party: " + JSON.stringify(placed.body));
  const sA = (await sb("GET", `sessions?restaurant_id=eq.${RID}&table_number=eq.${TA}&status=eq.open&select=id`))[0];
  if (!sA) throw new Error(`no open session on table ${TA} after placing an order`);

  // THE SHAPE CHECK MOVED IN FRONT OF THE DATABASE, so a bad target never reaches the RPC and there
  // is no `reason: "bad_table"` any more — the route answers 400 with a sentence a waiter can read.
  // That is better, not worse, so the check holds the outcome: refused, and the party did not move.
  const shBad = await panel("editor", `/sessions/${sA.id}/shift`, { to: "xyz" });
  const stillOnTA = (await sb("GET", `sessions?restaurant_id=eq.${RID}&id=eq.${sA.id}&select=table_number`))[0];
  check(shBad.status === 400 && stillOnTA && String(stillOnTA.table_number) === TA,
    `moving to something that is not a table is refused, and the party stayed put (${shBad.status} ${JSON.stringify(shBad.body)} · still on ${stillOnTA && stillOnTA.table_number})`);
  const shSame = await panel("editor", `/sessions/${sA.id}/shift`, { to: TA });
  check(shSame.body && shSame.body.ok === false && shSame.body.reason === "same_table",
    `moving to the table it is already on is refused (${JSON.stringify(shSame.body)})`);
  // A second real party on TB, so the target is genuinely occupied.
  const placedB = await rpc(SRK, "lfh_staff_place_order", { p_table: TB, p_items: [{ id: dish.id, qty: 1 }], p_allergies: [], p_note: null, p_restaurant_id: RID });
  if (!placedB.body || placedB.body.ok !== true) throw new Error("could not seat the second fixture party: " + JSON.stringify(placedB.body));
  const shOcc = await panel("editor", `/sessions/${sA.id}/shift`, { to: TB });
  check(shOcc.body && shOcc.body.ok === false && shOcc.body.reason === "target_occupied",
    `moving onto a table that already has a party is refused (${JSON.stringify(shOcc.body)})`);

  // ─────────────────────────────────────────────────────────────────────────
  head("2 · six orders in the same instant get six different ticket numbers");
  // SIX **DIFFERENT** ORDERS, or the product refuses them as one. A repeat of an order just sent for
  // the same table now comes back `{ ok:false, duplicateWarning:true }` — a real protection against a
  // waiter's double-tap sending the same round twice — so six identical rounds answered zero ticket
  // numbers and this check read as "the counter is broken". Each round below asks for a different
  // quantity, which is what makes them six genuinely different orders racing for the same counter —
  // and they start at TWO, because the fixture round already on this table is a single dish and would
  // otherwise make the first of the six a duplicate of it.
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    rpc(SRK, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: dish.id, qty: i + 2 }], p_allergies: [], p_note: `burst ${i + 1}`, p_restaurant_id: RID })));
  const kots = burst.map((b) => b.body && b.body.kot_no).filter((n) => n != null);
  if (kots.length !== 6) console.log("   (burst answers: " + JSON.stringify(burst.map((b) => ({ s: b.status, b: b.body }))).slice(0, 600) + ")");
  check(kots.length === 6 && new Set(kots).size === 6,
    `6 simultaneous orders got 6 UNIQUE kitchen-ticket numbers (${new Set(kots).size} distinct of ${kots.length} answered: ${kots.join(",")})`);

  // ─────────────────────────────────────────────────────────────────────────
  head("3 · the four backend-only switches are off, and stay invisible");
  const settings = (await sb("GET", `settings?restaurant_id=eq.${RID}&select=features`))[0];
  const f = (settings && settings.features) || {};
  const backendOnly = ["verification", "payments", "aggregators", "gst_invoice"];
  check(backendOnly.every((k) => f[k] !== true),
    `all four backend-only switches are off (${backendOnly.map((k) => k + "=" + (f[k] === true)).join(", ")})`);
  // …and the one whose function was retired outright cannot be called at all (mig 360).
  const v = await rpc(ANON, "lfh_request_verification", { p_contact: "9876543210", p_channel: "sms" });
  const gone = v.status === 404 || (v.body && (v.body.code === "PGRST202" || /does not exist|could not find/i.test(JSON.stringify(v.body))));
  check(gone, `the retired verification RPC is not reachable at all (mig 360) — got ${v.status} ${JSON.stringify(v.body).slice(0, 90)}`);

  // ─────────────────────────────────────────────────────────────────────────
  head("4 · a star rating cannot be faked or forced out of range");
  const ordId = burst.map((b) => b.body && b.body.order_id).find(Boolean);
  if (!ordId) throw new Error("no order id came back from the burst, so the rating checks have nothing real to rate");
  const fbFake = await rpc(ANON, "lfh_leave_feedback", { p_order: "00000000-0000-0000-0000-000000000000", p_rating: 5, p_comment: null, p_name: null });
  check(fbFake.body && fbFake.body.ok === false, `a rating for an order that does not exist is refused (${JSON.stringify(fbFake.body)})`);
  const fbReal = await rpc(ANON, "lfh_leave_feedback", { p_order: ordId, p_rating: 4, p_comment: "nice", p_name: "Tester" });
  check(fbReal.body && fbReal.body.ok === true, `a rating for a real order is accepted (${JSON.stringify(fbReal.body)})`);
  for (const r of (await sb("GET", `feedback?restaurant_id=eq.${RID}&order_id=eq.${ordId}&select=id`))) ratings.push(r.id);
  const badRating = await rpc(ANON, "lfh_leave_feedback", { p_order: ordId, p_rating: 9, p_comment: null, p_name: null });
  check(badRating.body && badRating.body.ok === false && badRating.body.reason === "bad_rating",
    `a rating outside 1-5 is refused (${JSON.stringify(badRating.body)})`);
} finally {
  await cleanup();
  // The one thing that must be true when we leave: nothing live on either table, or the manager's
  // floor keeps a party that walked out an hour ago.
  const left = await sb("GET", `orders?restaurant_id=eq.${RID}&table_number=in.(${TA},${TB})&archived=is.false&select=id`);
  console.log(`\n· cleaned up tables ${TA}/${TB} — ${left.length} live order(s) left`);
  if (left.length) failures++;
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL PASS — a mis-tap is refused, tickets are unique, the hidden switches are off, and a rating cannot be faked");
process.exit(failures ? 1 : 0);
