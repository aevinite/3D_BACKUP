// verify-two-parties.mjs — THE ROOT TEST for "one table, two parties in a row".
//
// Owner, 2026-07-30/31: a freshly opened table showed the PREVIOUS party's food and money.
// The panels were fixed (PR #578) and orders can no longer outlive their session (mig 232).
// This test goes after the whole CLASS: it runs two consecutive parties at the SAME table
// and checks that NOTHING of party A reaches party B — on every surface, in the money, and
// in the customer ledger — and that acting on A's bill afterwards never touches B.
//
//   node scripts/verify-two-parties.mjs                    # dev DB, API checks
//   node scripts/verify-two-parties.mjs --base http://localhost:4000   # + the served API
//
// Dev/test database only. Every row it creates leaves the floor the way the app does
// (archived + deleted_at — an issued bill is never hard-deleted).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parseEnv = (t) => Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
  const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
}));
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
// Which databases this rig may write to lives in ONE place (scripts/sweep/devStacks.mjs) —
// backup-1 AND backup-2, never AV live. It used to be a copy of one project id per script, which
// refused on backup-2, the very stack a fix goes live on when backup-1's deploy cap is spent.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

// Call an RPC WITH the bill's session id when the database understands that argument, and
// without it when it doesn't. That way this same test runs against the OLD database (where it
// must FAIL, proving the fault is real) and the fixed one (where it must pass) — a test that
// can only ever pass proves nothing.
async function rpcPreferSession(fn, args, sessionId) {
  const withSession = await sb.rpc(fn, { ...args, p_session: sessionId });
  if (!withSession.error) return withSession;
  if (/p_session|does not exist|PGRST202|schema cache/i.test(withSession.error.message || "")) {
    info(`(${fn} has no session argument yet — calling the old way, which is the fault under test)`);
    return sb.rpc(fn, args);
  }
  return withSession;
}

let failed = 0;
const pass = (m) => console.log("  ✓ " + m);
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const info = (m) => console.log("  · " + m);
const head = (m) => console.log("\n" + m);

const RID = must(await sb.from("staff_users").select("restaurant_id").eq("username", "diagm1").limit(1))[0].restaurant_id;
const TEST_PHONE = "9000000199";           // a made-up number, only ever used by this test
const made = { orders: [], sessions: [] };

// A free table with nothing on it at all.
const count = must(await sb.from("settings").select("table_count").eq("restaurant_id", RID).limit(1))[0]?.table_count || 10;
const busy = new Set([
  ...must(await sb.from("sessions").select("table_number").eq("restaurant_id", RID).neq("status", "closed")).map((s) => String(s.table_number)),
  ...must(await sb.from("orders").select("table_number").eq("restaurant_id", RID).eq("archived", false).is("deleted_at", null).neq("status", "cancelled").limit(2000)).map((o) => String(o.table_number)),
]);
// `.find()` returns undefined when EVERY table is busy, and `String(undefined)` is the string
// "undefined" — so this used to go on and try to open a table called "undefined", failing deep
// inside lfh_staff_open_table with a raw stack trace that named a line number and nothing else.
// Inside the 520-phase suite that read as "guard: two parties never mix ❌ at …:82:17", which
// looks like a broken product; the guard next to it (verify-table-lifecycle) says the real
// reason in one plain line, and that is what this should do too. It happens for real: with
// several sweep terminals sharing one floor there were 36 open sessions and no free table.
const freeTable = [...Array(count).keys()].map((n) => n + 1).reverse().find((n) => !busy.has(String(n)));
if (freeTable === undefined) {
  console.error(`need one completely free table; the floor is busy right now ` +
    `(${count} tables, all of them in use — ${busy.size} carry a live session or order)`);
  process.exit(1);
}
const T = String(freeTable);
const dish = must(await sb.from("menu_items").select("id,title,price").eq("restaurant_id", RID).limit(2));

const openTable = async () => {
  const r = await sb.rpc("lfh_staff_open_table", { p_restaurant_id: RID, p_table: T });
  if (r.error || r.data?.error) throw new Error(r.error?.message || r.data.error);
  made.sessions.push(r.data.id);
  return r.data.id;
};
const order = async (d, qty) => {
  const r = await sb.rpc("lfh_staff_place_order", { p_table: T, p_items: [{ id: d.id, qty }], p_allergies: [], p_note: null, p_restaurant_id: RID });
  if (r.error) throw new Error(r.error.message);
  made.orders.push(r.data.order_id);
  return r.data.order_id;
};

try {
  head(`Two parties, one table (T${T} of "${must(await sb.from("restaurants").select("name").eq("id", RID).limit(1))[0].name}")`);

  // ── PARTY A: sits, orders, is served, pays with a phone number, leaves ──────
  const sessA = await openTable();
  const orderA = await order(dish[0], 2);
  must(await sb.from("order_items").update({ status: "served" }).eq("order_id", orderA).select("id"));
  must(await sb.from("orders").update({ status: "served", payment_status: "paid", paid_at: new Date().toISOString() }).eq("id", orderA).select("id"));
  // A also gets a VIP mark and rings the bell — table-scoped things that must NOT be
  // inherited by the next party (mig 166 clears the mark on close; the close trigger
  // resolves the call). Checked further down.
  await sb.from("table_tags").upsert({ restaurant_id: RID, table_number: T, tag: "vip" }, { onConflict: "restaurant_id,table_number" });
  await sb.from("waiter_calls").insert({ restaurant_id: RID, table_number: T, session_id: sessA, note: "water", resolved: false });
  const capA = await sb.rpc("lfh_capture_customer", { p_restaurant_id: RID, p_table: T, p_phone: TEST_PHONE, p_name: "Party A", p_consent: true });
  info(`party A: session ${sessA.slice(0, 8)}, ₹${must(await sb.from("orders").select("total").eq("id", orderA).limit(1))[0].total} paid, customer saved (${JSON.stringify(capA.data || capA.error?.message)})`);
  const visitA = must(await sb.from("customer_visits").select("session_id,phone").eq("phone", TEST_PHONE).eq("restaurant_id", RID));
  visitA.some((v) => v.session_id === sessA)
    ? pass("party A's visit is booked against party A's own session")
    : fail(`party A's visit points at ${JSON.stringify(visitA.map((v) => v.session_id?.slice(0, 8)))}, not A's session ${sessA.slice(0, 8)}`);
  // A leaves — the table is closed the normal way.
  const { closeSession } = { closeSession: null }; // (the route helper isn't importable here)
  must(await sb.from("sessions").update({ status: "closed" }).eq("id", sessA).select("id"));

  // ── PARTY B: a new party is seated at the same table and orders ONE dish ────
  const sessB = await openTable();
  const orderB = await order(dish[1] || dish[0], 1);
  const bTotal = Number(must(await sb.from("orders").select("total").eq("id", orderB).limit(1))[0].total);
  info(`party B: session ${sessB.slice(0, 8)}, one dish, ₹${bTotal}`);

  // ── 1) THE FLOOR: every surface must show B only ────────────────────────────
  head("1) Does any surface still show party A?");
  const newTile = (await sb.rpc("lfh_table_view_summary", { p_restaurant_id: RID, p_table: T })).data?.tiles?.[T];
  // A brand-new order is 'received' and is deliberately NOT a bill yet, so ₹0 due is CORRECT
  // here (the summary counts money only once staff accept). Check the dish count now...
  newTile.counts.nw === 1 && Number(newTile.due) === 0
    ? pass(`tile before accepting: "${newTile.label}", 1 new dish, ₹0 due (a new order isn't a bill yet)`)
    : fail(`tile before accepting shows ${JSON.stringify(newTile.counts)} / ₹${newTile.due} due — expected 1 new dish, ₹0`);
  // ...then accept party B's order, which is when the money must appear — and it must be
  // party B's money only.
  must(await sb.from("order_items").update({ status: "preparing" }).eq("order_id", orderB).select("id"));
  must(await sb.from("orders").update({ status: "preparing" }).eq("id", orderB).select("id"));
  const tile = (await sb.rpc("lfh_table_view_summary", { p_restaurant_id: RID, p_table: T })).data?.tiles?.[T];
  const dueOk = Math.abs(Number(tile.due) - bTotal) < 1;
  dueOk && tile.counts.nw + tile.counts.ck + tile.counts.rd + tile.counts.sv === 1
    ? pass(`manager/waiter tile after accepting: "${tile.label}", 1 dish, ₹${Math.round(Number(tile.due))} due — party B's order only`)
    : fail(`tile shows ${JSON.stringify(tile.counts)} and ₹${tile.due} due; party B ordered 1 dish worth ₹${bTotal}`);

  // THESE THREE CHECKS ASSERT IDENTITY, NOT A COUNT (2026-08-05).
  // They used to demand "exactly 1 thing at this table", which made the guard fail on ANY row it
  // did not create — including one left by an earlier run of ITSELF that crashed before its own
  // cleanup (that is precisely what happened: the 520-phase suite reported "kitchen board shows 4
  // ticket(s) at T29", where this test only ever makes 2). A guard that goes red on its own litter
  // reads as a product fault and wastes the sweep it is meant to protect.
  // The invariant was never "the table is otherwise empty" — it is "party A's food is gone and
  // party B's is here", which is exactly what the table-slice check below already did properly.
  // Anything unrelated is reported alongside the pass instead of failing it.
  const floor = (await sb.rpc("lfh_floor_state", { p_restaurant_id: RID })).data;
  const entry = (Array.isArray(floor) ? floor : []).find((e) => String(e.table_number) === T);
  const floorIds = (entry?.orders || []).map((o) => String(o.id ?? o.order_id ?? ""));
  const floorHasA = floorIds.includes(String(orderA));
  const floorHasB = floorIds.includes(String(orderB));
  const floorOther = floorIds.filter((id) => id !== String(orderA) && id !== String(orderB)).length;
  floorHasB && !floorHasA
    ? pass(`admin/owner live floor: party B's order is there, party A's is gone${floorOther ? ` (+${floorOther} unrelated, not this test's)` : ""}`)
    : fail(`admin/owner live floor at T${T}: party A present=${floorHasA}, party B present=${floorHasB} — party A's order must be gone and B's must be listed`);

  const kitchen = (await sb.rpc("lfh_kitchen_tickets", { p_restaurant_id: RID })).data || [];
  const kTickets = kitchen.filter((k) => String(k.table_number) === T);
  const kHasA = kTickets.some((k) => String(k.order_id) === String(orderA));
  const kHasB = kTickets.some((k) => String(k.order_id) === String(orderB));
  const kOther = kTickets.filter((k) => String(k.order_id) !== String(orderA) && String(k.order_id) !== String(orderB)).length;
  kHasB && !kHasA
    ? pass(`kitchen board: party B's ticket is there and party A's is not${kOther ? ` (+${kOther} unrelated, not this test's)` : ""}`)
    : fail(`kitchen board at T${T}: party A's ticket present=${kHasA}, party B's present=${kHasB} — party A's served food must not be cooking again`);

  const bundle = (await sb.rpc("lfh_floor_bundle", { p_restaurant_id: RID, p_table: T })).data;
  const bundleSess = (bundle?.sessions || []).map((s) => s.id);
  !bundleSess.includes(sessA) && bundleSess.includes(sessB)
    ? pass("the panel's table slice carries party B's session, not party A's")
    : fail(`the table slice carries sessions ${JSON.stringify(bundleSess.map((s) => s.slice(0, 8)))}`);

  // Table-scoped leftovers: the mark and the bell belonged to party A only.
  const tag = must(await sb.from("table_tags").select("tag").eq("restaurant_id", RID).eq("table_number", T));
  tag.length === 0
    ? pass("party A's VIP mark was cleared when they left — party B isn't wearing it")
    : fail(`party B's table still carries party A's "${tag[0].tag}" mark`);
  const calls = must(await sb.from("waiter_calls").select("id,resolved,session_id").eq("restaurant_id", RID).eq("table_number", T).eq("resolved", false));
  calls.length === 0
    ? pass("party A's waiter call was closed out with them — no phantom bell on party B's tile")
    : fail(`${calls.length} unresolved call(s) from party A still ring on party B's table`);

  // ── 2) THE MONEY: B's bill is B's dish, and A's paid bill is untouched ──────
  head("2) The money");
  const liveAtTable = must(await sb.from("orders").select("id,total,session_id,payment_status")
    .eq("restaurant_id", RID).eq("table_number", T).eq("archived", false).is("deleted_at", null).neq("status", "cancelled"));
  const liveHasA = liveAtTable.some((o) => String(o.id) === String(orderA));
  const liveHasB = liveAtTable.some((o) => String(o.id) === String(orderB));
  const liveOther = liveAtTable.filter((o) => String(o.id) !== String(orderA) && String(o.id) !== String(orderB));
  liveHasB && !liveHasA
    ? pass(`party B's order is the live one at the table (₹${bTotal})${liveOther.length ? ` (+${liveOther.length} unrelated, not this test's)` : ""}`)
    : fail(`live orders at T${T}: party A present=${liveHasA}, party B present=${liveHasB} ` +
        `${JSON.stringify(liveAtTable.map((o) => `₹${o.total}/${o.payment_status}`))} — party B must never be billed for A's food`);
  const aRow = must(await sb.from("orders").select("payment_status,total,archived,status").eq("id", orderA).limit(1))[0];
  aRow.payment_status === "paid" && aRow.status === "served" && aRow.archived
    ? pass("party A's settled bill is intact and off the floor (archived, still in the ledger)")
    : fail(`party A's bill changed: ${aRow.status}/${aRow.payment_status}/archived=${aRow.archived}`);

  // ── 3) THE CUSTOMER LEDGER: capture/uncapture must follow the BILL ──────────
  head("3) The customer ledger (this is where the old code went wrong)");
  const visits = must(await sb.from("customer_visits").select("session_id,phone").eq("restaurant_id", RID).eq("phone", TEST_PHONE));
  !visits.some((v) => v.session_id === sessB)
    ? pass("party B's session carries no visit for party A's phone number")
    : fail("party A's phone number is booked as a visit on party B's session — the wrong guest got the loyalty visit");

  // Capture AGAIN for A's bill now that B is seated: it must still land on A's session.
  const capLate = await rpcPreferSession("lfh_capture_customer",
    { p_restaurant_id: RID, p_table: T, p_phone: TEST_PHONE, p_name: "Party A", p_consent: true }, sessA);
  if (capLate.error) fail("capturing A's customer after B sat down errored: " + capLate.error.message);
  const afterLate = must(await sb.from("customer_visits").select("session_id").eq("restaurant_id", RID).eq("phone", TEST_PHONE));
  !afterLate.some((v) => v.session_id === sessB)
    ? pass("saving party A's customer while party B is seated does NOT touch party B")
    : fail("saving party A's customer wrote a visit onto party B's session (wrong party, and it links B's devices to A's phone)");

  // Reverting A's payment must reverse A's visit, never B's.
  const unc = await rpcPreferSession("lfh_uncapture_customer", { p_restaurant_id: RID, p_table: T }, sessA);
  if (unc.error) fail("reversing A's visit errored: " + unc.error.message);
  const afterUnc = must(await sb.from("customer_visits").select("session_id").eq("restaurant_id", RID).eq("phone", TEST_PHONE));
  const bStillHasVisit = afterUnc.some((v) => v.session_id === sessB);
  const aVisitGone = !afterUnc.some((v) => v.session_id === sessA);
  aVisitGone && !bStillHasVisit
    ? pass("reverting party A's bill reversed party A's visit and left party B alone")
    : fail(`after reverting A's bill: A's visit ${aVisitGone ? "gone (right)" : "still there (wrong)"}, B's visit ${bStillHasVisit ? "was created/kept (wrong party)" : "absent"}`);

  // ── 4) THE SERVED API (opt-in): the panel is never even SENT A's orders ─────
  const baseArg = process.argv.indexOf("--base");
  const BASE = baseArg > -1 ? process.argv[baseArg + 1] : "";
  if (!BASE) {
    console.log("\n4) Served-API check SKIPPED (pass --base http://localhost:4000 with the app running)");
  } else {
    head(`4) What the server hands the open panel (${BASE})`);
    const { loginAs } = await import("./sweep/login.mjs");
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext();
      await loginAs(ctx, "manager", BASE);
      const res = await ctx.request.get(`${BASE}/api/editor/orders?table=${T}`);
      const rows = await res.json();
      const list = Array.isArray(rows) ? rows : [];
      const leaked = list.filter((o) => o.session_id && o.session_id !== sessB);
      leaked.length === 0
        ? pass(`the table slice returned ${list.length} row(s), all party B's — the browser never receives another party's orders`)
        : fail(`the table slice returned ${leaked.length} row(s) belonging to other parties (of ${list.length}) — the panel has to filter them out, which is exactly how the ₹1,150 bug happened`);
    } finally { await browser.close(); }
  }
} finally {
  // cleanup — the app's own way: off the floor, never hard-deleted
  if (made.orders.length) await sb.from("orders").update({ archived: true, archived_at: new Date().toISOString(), deleted_at: new Date().toISOString() }).in("id", made.orders);
  for (const s of made.sessions) await sb.from("sessions").update({ status: "closed" }).eq("id", s);
  await sb.from("customer_visits").delete().in("session_id", made.sessions);
  await sb.from("customer_devices").delete().eq("restaurant_id", RID).eq("phone", TEST_PHONE);
  await sb.from("customers").delete().eq("restaurant_id", RID).eq("phone", TEST_PHONE);
  console.log(`\n· cleaned up ${made.orders.length} test orders, ${made.sessions.length} sessions and the test customer`);
}


console.log(failed ? `\n✗ ${failed} check(s) failed — party B can still be affected by party A` : "\n✓ two parties, one table: nothing of party A reaches party B");
process.exit(failed ? 1 : 0);
