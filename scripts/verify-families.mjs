// Three NEW families of error-hunting that the staff panels introduced
// (2026-06-13). The other three families have their own suites:
//   • table-lifecycle races        -> verify-edge-cases.mjs (checks 1-6)
//   • double-tap / two-tab         -> verify-edge-cases.mjs (checks 7-10)
//   • bad network / offline        -> verify-edge-cases.mjs (checks 11-13)
// This script adds:
//   FAMILY 4 — authorization / security: a guest's anon key must NOT reach
//              staff-only functions; pricing & sold-out can't be bypassed.
//   FAMILY 5 — staff-panel input validation: junk inputs to the tablet/editor
//              endpoints are rejected cleanly; KOT numbers stay unique under a
//              burst of concurrent orders.
//   FAMILY 6 — feature-flag & billing integrity: backend-only flags stay off &
//              invisible, malformed flag payloads are sanitised, discounts are
//              clamped and totals net out, feedback needs a real order.
// Reads secrets from .env.local; prints pass/fail only. ONE app — pass --base <url>.
//
// ⚠️ PARTIALLY REPAIRED, STILL RED (2026-07-30). This script predates the 2026-06-13 merge of the
// four panel servers into ONE app. Repaired here: the :4001 references now point at :4000, the
// editor calls use the /api/editor/... prefix, auth uses the admin cookie, and the teardown
// closes + soft-deletes instead of hard-DELETEing (mig 190 forbids erasing an issued bill, and
// every session gets a bill_no, so the old teardown could never succeed). What REMAINS: its
// assertions still describe the pre-merge API and need reviewing one by one. No app bug has
// surfaced from it — the failures are the script's own staleness. Run it before trusting it.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL, SRK = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB || !SRK || !ANON) { console.error("missing supabase env"); process.exit(1); }

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
// ── THE FOUR PANEL SERVERS BECAME ONE APP ON 2026-06-13, AND THIS STILL DIALLED 4001/4003 ────────
// (T28 sweep, 2026-08-22.) The header above has claimed since 2026-07-30 that "the editor calls use
// the /api/editor/... prefix, auth uses the admin cookie" — the code never did. It POSTed a panel
// password to http://localhost:4001/login and called http://localhost:4001/api and
// http://localhost:4003/api, none of which has existed for two months. Result: ECONNREFUSED on
// 127.0.0.1:4003 before the first assertion, so FAMILIES 4-6 have not been checked at all since
// the merge — while `npm run verify:families` sat in the list looking like cover.
//
// Fixed the way its 40 siblings work: take a --base, and speak to the ONE app.
//   · editor  → ${BASE}/api/editor/<path>
//   · tablet  → ${BASE}/api/tablet/<path>
// Auth is the ADMIN cookie from scripts/sweep/login.mjs (one cached sign-in for the whole run — the
// project's rule; never a fresh POST to a login endpoint) plus ?rid=, which is how the admin reaches
// a restaurant's panel API. Verified before rewiring: GET /api/editor/orders?rid=<French House> with
// those headers answers 200 with the real board. The old EDITOR_PASSWORD path is gone; nothing sets
// that variable any more.
const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "")
  || process.env.VERIFY_BASE || "http://localhost:4000";
const RID = "00000000-0000-0000-0000-000000000001"; // French House — the writable fixture tenant
const { adminHeaders } = await import("./sweep/login.mjs");
const panelHeaders = () => ({ "Content-Type": "application/json", ...adminHeaders(BASE) });
const withRid = (path) => `${path}${path.includes("?") ? "&" : "?"}rid=${RID}`;
const editor = async (method, path, body) => {
  const r = await fetch(`${BASE}/api/editor${withRid(path)}`, { method, headers: panelHeaders(), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const tablet = async (method, path, body) => {
  const r = await fetch(`${BASE}/api/tablet${withRid(path)}`, { method, headers: panelHeaders(), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const TA = "21", TB = "22"; // quiet test tables
const cleanup = async () => {
  // TEARDOWN FOLLOWS THE PRODUCT'S OWN RULE: a bill is never erased, it is closed/soft-deleted.
  // mig 190 blocks hard-DELETE of any "issued" session or order, and since every session gets a
  // daily bill_no stamped by trigger, that means EVERY session — so the old DELETE teardown could
  // never succeed and these scripts had been failing on a 23514 check violation before their first
  // assertion. Closing + soft-deleting clears the fixture off the floor exactly as the app would.
  // (2026-07-30)
  // Scoped by restaurant: an UPDATE filtered on table_number ALONE has to scan every order ever
  // written (398k rows here) and died with a statement timeout. Same rule the app follows.
  await sb("PATCH", `sessions?restaurant_id=eq.00000000-0000-0000-0000-000000000001&table_number=in.(${TA},${TB})`, { status: "closed", closed_at: new Date().toISOString(), deleted_at: new Date().toISOString() });
  await sb("PATCH", `orders?restaurant_id=eq.00000000-0000-0000-0000-000000000001&table_number=in.(${TA},${TB})`, { archived: true, deleted_at: new Date().toISOString() });
  await sb("DELETE", `requests?restaurant_id=eq.00000000-0000-0000-0000-000000000001&table_number=in.(${TA},${TB})`);
};

try {
  // (no panel login step any more — the admin cookie from sweep/login.mjs is used per call)
  await cleanup();

  // ─────────────────────────────────────────────────────────────────────────
  head("FAMILY 4 — authorization / security");
  // A guest's anon key must be blocked from every staff-only function.
  const a1 = await rpc(ANON, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: "espresso", qty: 1 }], p_allergies: [], p_note: null });
  check(a1.status === 401 || a1.status === 403, `anon cannot place a staff order (HTTP ${a1.status})`);
  const a2 = await rpc(ANON, "lfh_staff_shift_table", { p_session: "00000000-0000-0000-0000-000000000000", p_to: TB });
  check(a2.status === 401 || a2.status === 403, `anon cannot shift a table (HTTP ${a2.status})`);
  // 404 IS THE STRONGEST PASS HERE, NOT A FAILURE (T28 sweep, 2026-08-22). This demanded 401/403 and
  // got 404, so it failed on the best possible outcome. `lfh_next_counter` DOES exist — checked in
  // pg_proc — but it carries NO anon grant (`proacl` has no `anon=X` entry, unlike lfh_price_order
  // which deliberately does), so PostgREST cannot even find it for that role. That is the mig 038/267
  // REVOKE/GRANT rule working: a staff-only function anon cannot see is better evidence for "this is
  // not yours to call" than one that answers politely. Same reasoning the verification-RPC check in
  // FAMILY 6 already carries.
  const a3 = await rpc(ANON, "lfh_next_counter", { p_key: "kot" });
  const counterHidden = a3.status === 404 || a3.status === 401 || a3.status === 403;
  check(counterHidden, `anon cannot bump the KOT counter — not even visible to that role (HTTP ${a3.status})`);
  // Guests CAN price an order (read-only), but the price comes from the DB, not
  // from anything they send — a tampered price field is simply ignored.
  const priced = await rpc(ANON, "lfh_price_order", { p_items: [{ id: "espresso", qty: 1, price: "0.01" }] });
  const espresso = (await sb("GET", "menu_items?id=eq.espresso&select=price"))[0];
  const realUnit = Number(String(espresso.price).replace(/[^0-9.]/g, ""));
  // PRICE THROUGH THE PATH THAT ACTUALLY RUNS (T28 sweep, 2026-08-22). This called
  // lfh_price_order with the ANON key on the premise that "guests CAN price an order (read-only)".
  // They no longer do: nothing in app/, components/ or public/ calls it from a browser — every
  // reference is a comment or a server route — and a guest's order goes through
  // app/api/guest/place-order, which runs it server-side. Called with anon it now answers
  // 401 / 42501 "permission denied … GRANT SELECT ON public.settings TO anon", because mig 282
  // deliberately took anon's table-wide read on `settings` away (it was handing every restaurant's
  // gstin to every guest). So the 401 is that fix working, not a guest-facing fault.
  // The RULE is still worth guarding and is unchanged: a price sent by the client is ignored and the
  // server charges its own. Assert it where it actually happens.
  const pricedReal = await rpc(SRK, "lfh_price_order", { p_items: [{ id: "espresso", qty: 1, price: "0.01" }] });
  check(pricedReal.body && pricedReal.body.ok && Number(pricedReal.body.subtotal) >= realUnit - 0.01,
    `a client-sent price is ignored — the server charges its own (₹${pricedReal.body && pricedReal.body.subtotal}, not ₹0.01)`);
  // (A CHECK I ADDED HERE AND THEN REMOVED, 2026-08-22.) I also asserted that the ANON key can no
  // longer price an order at all — because my first probe answered 401/42501 "permission denied for
  // table settings". On a later run the same call answered 200. I could not explain the difference,
  // so the assertion went out rather than in: a check built on one observation I cannot account for
  // is exactly the flaky guard this whole sweep has been cleaning up after. The rule that MATTERS is
  // the line above — a price sent by the client is ignored and the server charges its own — and that
  // is asserted through the path that actually runs. If anon's reach into `settings` is worth
  // guarding, it belongs in verify:grants or verify:guest-read, with the rule stated rather than a
  // status code observed once.
  // Sold-out can't be ordered even if the client forces it through.
  await sb("PATCH", "menu_items?id=eq.the-oreo-shake", { tags: ["sold-out"] });
  const soldStaff = await rpc(SRK, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: "the-oreo-shake", qty: 1 }], p_allergies: [], p_note: null });
  check(soldStaff.body && soldStaff.body.ok === false && soldStaff.body.reason === "sold_out", "sold-out dish is rejected by the server (even for staff)");
  await sb("PATCH", "menu_items?id=eq.the-oreo-shake", { tags: [] }); // restore

  // ─────────────────────────────────────────────────────────────────────────
  head("FAMILY 5 — staff-panel input validation");
  // The tablet's order endpoint must reject junk before it ever reaches the DB.
  const e1 = await tablet("POST", "/order", { table: "abc", items: [{ id: "espresso", qty: 1 }] });
  check(e1.status === 400, `tablet rejects a non-numeric table (HTTP ${e1.status})`);
  const e2 = await tablet("POST", "/order", { table: TA, items: [] });
  check(e2.status === 400, `tablet rejects an empty order (HTTP ${e2.status})`);
  const e3 = await tablet("POST", "/order", { table: TA, items: [{ id: "no-such-dish", qty: 1 }] });
  // IT REFUSES WITH A SENTENCE NOW, NOT A REASON CODE (T28 sweep, 2026-08-22). This wanted
  // `{ok:false, reason:"unknown_item"}`; the endpoint answers `400 {"error":"That dish isn't on the
  // menu."}`. The refusal is what matters and it is correct — and the message is one a waiter can
  // act on, which is the product's own wording rule. Assert the refusal AND that it says something.
  check(e3.status === 400 && /menu|dish/i.test(JSON.stringify(e3.body || {})),
    `tablet rejects an unknown dish id, in words a waiter can act on (${e3.status} ${JSON.stringify(e3.body)})`);
  // Shift validation: bad target, same table, occupied target.
  const [sA] = await sb("POST", "sessions", { restaurant_id: RID, table_number: TA, status: "open", opened_by: "waiter", opened_at: new Date().toISOString() });
  const shBad = await editor("POST", `/sessions/${sA.id}/shift`, { to: "xyz" });
  // Same drift as the tablet refusal above: `400 {"error":"Pick a valid table to move to."}` rather
  // than a reason code. Assert the refusal and that it names what to do.
  check(shBad.status === 400 && /table/i.test(JSON.stringify(shBad.body || {})),
    `shift rejects a non-numeric target table, and says what to do (${shBad.status} ${JSON.stringify(shBad.body)})`);
  const shSame = await editor("POST", `/sessions/${sA.id}/shift`, { to: TA });
  check(shSame.body && shSame.body.ok === false && shSame.body.reason === "same_table", "shift rejects moving to the same table");
  const [sB] = await sb("POST", "sessions", { restaurant_id: RID, table_number: TB, status: "open", opened_by: "waiter", opened_at: new Date().toISOString() });
  const shOcc = await editor("POST", `/sessions/${sA.id}/shift`, { to: TB });
  check(shOcc.body && shOcc.body.ok === false && shOcc.body.reason === "target_occupied", "shift rejects an already-occupied target");
  await sb("PATCH", `sessions?id=eq.${sB.id}`, { status: "closed" });
  // KOT numbers must stay UNIQUE under a burst of simultaneous orders.
  // SIX IDENTICAL ORDERS ARE MEANT TO BE REFUSED — MAKE THEM SIX DIFFERENT ONES (T28 sweep,
  // 2026-08-22). This sent the same order six times and demanded six unique KOT numbers. The product
  // deliberately refuses that: five came back
  //     {"ok":false,"duplicateWarning":true,"error":"This looks identical to an order just sent for this table."}
  // so only the first minted a number and the check reported "1 distinct" — reading as a KOT
  // collision when it was the double-tap guard doing its job. The test was asking the product to do
  // the exact thing it exists to prevent.
  // The INTENT is real and worth keeping: concurrent orders must not collide on a KOT number. So make
  // the six genuinely different — a distinct note each — which is what a real rush is: six tables'
  // worth of different food arriving at once, not one waiter's finger bouncing.
  // UNIQUE ACROSS RUNS, not just within one (2026-08-22). The first fix made the six orders differ
  // from EACH OTHER, which got 6 unique KOT numbers — and then a second run minutes later was
  // refused, because those same six now looked identical to the ones just sent. A guard that only
  // passes on alternate runs is the flapping guard this repo warns about: people re-run it until it
  // is green, which is the opposite of what it is for. Stamp the run.
  const burstTag = Date.now().toString(36);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    rpc(SRK, "lfh_staff_place_order", { p_table: TA, p_items: [{ id: "espresso", qty: 1 + i }], p_allergies: [], p_note: `burst ${burstTag}-${i + 1}` })));
  // SAY WHICH OF THE TWO THINGS WENT WRONG (2026-08-22). The message used to report only the count
  // of DISTINCT numbers, so a run where three calls came back with no number at all read as
  // "(3 distinct)" — which looks like a KOT COLLISION, the most alarming thing this check could
  // possibly find. It was not: the numbering is sound (probed three times in isolation — six
  // sequential, unique numbers every time). Three calls had simply not returned one.
  // Two different faults, two different messages, and the bodies printed either way — because
  // "some orders silently did not land" and "two tickets share a number" need opposite
  // investigations, and guessing which one you are looking at wastes the trip.
  const refusedAsDupe = burst.filter((b) => b.body && b.body.duplicateWarning).length;
  const kots = burst.map((b) => b.body && b.body.kot_no).filter((n) => n != null);
  const missing = 6 - kots.length;
  if (missing) {
    // ⚠ SEEN INTERMITTENTLY, AND NOT YET EXPLAINED (2026-08-22). About one run in five, ONE of the
    // six comes back with no kot_no and is NOT flagged a duplicate. Probed in isolation eight times
    // — six sequential unique numbers every single time — so it only shows under this guard's wider
    // load (an open session on the table, earlier orders, the panel's own traffic). Print the FULL
    // bodies of the ones that failed, not a truncated blob: whoever catches this next needs the
    // reason the call gave, and that is the whole difference between a numbering fault and a call
    // that was refused for an ordinary reason.
    const bad = burst.filter((b) => !(b.body && b.body.kot_no != null));
    check(false, `all 6 simultaneous orders came back with a KOT number — ${missing} did NOT `
      + `(${refusedAsDupe} refused as duplicates). The ones with no number: `
      + bad.map((b) => `[${b.status}] ${JSON.stringify(b.body)}`).join(" · "));
  } else {
    check(new Set(kots).size === 6,
      `6 simultaneous DIFFERENT orders got 6 UNIQUE KOT numbers — no two tickets share one `
      + `(got [${kots.join(", ")}])`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  head("FAMILY 6 — feature-flag & billing integrity");
  // The four backend-only switches must be OFF by default in the live settings.
  const settings = (await sb("GET", "settings?id=eq.site&select=features"))[0];
  const f = settings.features || {};
  const backendOnly = ["verification", "payments", "aggregators", "gst_invoice"];
  check(backendOnly.every((k) => f[k] !== true), `all backend-only flags are off (${backendOnly.map((k) => k + "=" + (f[k] === true)).join(", ")})`);
  // Their RPCs must not be able to act while the flag is off (the system "isn't there").
  // This used to call lfh_request_verification and assert it answered {ok:false, reason:'disabled'}.
  // Migration 360 RETIRED that function — it was the surviving half of the mig-037 stub, whose partner
  // had been removed three times, and it was still reachable with the public menu key. So the check
  // now asserts the stronger form of the same rule: the RPC is not reachable AT ALL. A feature that
  // cannot be called is better evidence for "this system isn't there" than one that politely declines.
  const v = await rpc(ANON, "lfh_request_verification", { p_contact: "9876543210", p_channel: "sms" });
  const gone = v.status === 404 || (v.body && (v.body.code === "PGRST202" || /does not exist|could not find/i.test(JSON.stringify(v.body))));
  check(gone, `the retired verification RPC is not reachable at all (mig 360) — got ${v.status}`);
  // A malformed features payload through the editor is sanitised to a clean
  // boolean map (arrays/strings/nested junk dropped) — can't poison gating.
  // THE MANAGER PANEL CANNOT SET GUEST FEATURES AT ALL ANY MORE (T28 sweep, 2026-08-22).
  // This used to POST a poisoned feature map to /settings and assert the SERVER sanitised it to
  // booleans. That endpoint now refuses the whole request outright:
  //     403 {"error":"Guest features are set by the admin on Access & permissions, not from this panel."}
  // which is the access model's own rule — only the ADMIN holds permissions. So the old check tested
  // a capability that was deliberately removed, and could never pass again.
  // The replacement is the STRONGER form of the same rule, and it is the one worth guarding: a
  // manager cannot change a guest feature from their panel, however the payload is shaped. A junk
  // payload that is refused is safer than a junk payload that is cleaned up and saved.
  const poison = await editor("POST", "/settings", { features: { ratings: false, junk: "yes", nested: { a: 1 }, arr: [1, 2], model3d: true } });
  const refused = poison.status === 403 && /admin/i.test(JSON.stringify(poison.body || {}));
  check(refused, `the manager panel REFUSES to set guest features — only the admin holds them (got ${poison.status} ${JSON.stringify(poison.body)})`);
  // Discount is clamped to the order total and the editor reports the net.
  const [ord] = await sb("POST", "orders", { restaurant_id: RID, table_number: TA, items: [{ id: "espresso", title: "Espresso", qty: 1, price: "5.49" }], subtotal: 5.49, tax: 0.27, total: 5.76, status: "received" });
  // ASSERT THE EFFECT, NOT THE REPLY'S SHAPE (T28 sweep, 2026-08-22). This read
  // `over.body.discount` — but the endpoint answers `{"ok":true}` and no longer echoes the figure,
  // so the check compared `undefined` and failed on behaviour that is correct. Measured on a fresh
  // order (total 5.76, subtotal 5.49): asking for 9999 stores 5.49 — the subtotal, which is the cap,
  // because the discount applies BEFORE tax. Read the row back instead; that is the thing that has
  // to be true, and it cannot drift with the response shape.
  const over = await editor("POST", `/orders/${ord.id}/discount`, { amount: 9999, note: "too much" });
  const [afterDisc] = await sb("GET", `orders?id=eq.${ord.id}&select=discount,subtotal,total`);
  const cap = Number(afterDisc && afterDisc.subtotal);
  const got = Number(afterDisc && afterDisc.discount);
  check(over.status === 200 && got > 0 && got <= cap,
    `discount is clamped to what the bill can bear (asked 9999, stored ${got}, cap ${cap}, reply ${over.status})`);
  // Feedback needs a REAL order id; a fake one is refused, a real one accepted.
  const fbFake = await rpc(ANON, "lfh_leave_feedback", { p_order: "00000000-0000-0000-0000-000000000000", p_rating: 5, p_comment: null, p_name: null });
  check(fbFake.body && fbFake.body.ok === false, "feedback for a non-existent order is refused");
  const fbReal = await rpc(ANON, "lfh_leave_feedback", { p_order: ord.id, p_rating: 4, p_comment: "nice", p_name: "Tester" });
  check(fbReal.body && fbReal.body.ok === true, "feedback for a real order is accepted (anon)");
  const badRating = await rpc(ANON, "lfh_leave_feedback", { p_order: ord.id, p_rating: 9, p_comment: null, p_name: null });
  check(badRating.body && badRating.body.ok === false && badRating.body.reason === "bad_rating", "feedback rejects an out-of-range rating");
} finally {
  await cleanup();
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL FAMILY 4-6 CHECKS PASSED");
process.exit(failures ? 1 : 0);
