#!/usr/bin/env node
// verify:tablet-twins — the waiter's handheld obeys the same money rules the manager's till does.
//
// Sweep #10, terminal 13. The waiter tablet's server route (app/api/tablet/[...path]/route.ts) is a
// TWIN of the manager's (app/api/editor/[...path]/route.ts): about forty actions with the same names
// and no shared code. Every rule below was added to the manager's route and NOT to the tablet's, so
// the same tap was refused at the till and accepted on the handheld. Each section is one numbered
// item of the T13 report, and each was proved by driving the handler before it was fixed.
//
// This drives the REAL tablet route (bundled with esbuild, called in memory against
// scripts/panel-stubs plus scripts/sweep/t13s10/stubs — no socket opens) and asserts what the
// handler actually WROTE, not what the file says. Every section also proves the gate is not refusing
// everything: the same door still works on a live ticket.
import { world, call, writesOn, RID } from "./sweep/t13s10/lib.mjs";

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
const recent = new Date(Date.now() - 5 * 60_000).toISOString();

console.log("verify:tablet-twins — the waiter's handheld follows the manager's money rules");

// ── 1. A CANCELLED TICKET STAYS CANCELLED (item 1) ─────────────────────────────────────────────────
// The one way back from a cancel is Restore on the manager panel. Two doors on the tablet recompute a
// ticket's status and used to bring a cancelled one back to the kitchen and onto the bill, unlogged.
console.log("\n1. a cancelled ticket is never revived from the handheld");
const cancelledWorld = () => world({
  fix: {
    orders: [{ id: "o1", restaurant_id: RID, status: "cancelled", cancelled_at: recent, payment_status: "pending", archived: false,
      session_id: "s1", table_number: "4", items: [{ id: "d1", status: "received", qty: 1 }] }],
    order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "received" }],
  },
});
for (const [path, body, what] of [
  ["orders/o1/accept", {}, "✓ Accept"],
  ["items/i1/status", { status: "served" }, "serving one dish"],
  ["items/i1/status", { status: "preparing" }, "sending one dish to preparing"],
  ["orders/o1/serve-all", {}, "Serve all"],
]) {
  const G = await cancelledWorld();
  const r = await call("POST", path, { body });
  if (r.status === 409 && /cancelled|voided/.test(r.text)) ok(`${what} on a cancelled ticket is refused (409)`);
  else bad(`${what} on a cancelled ticket answered ${r.status} ${r.text.slice(0, 90)}`);
  const o = G.FIX.orders[0];
  if (o.status === "cancelled" && writesOn(G, "orders", "order_items").length === 0) ok("…and nothing about the ticket or its dishes changed");
  else bad(`…but the ticket now reads '${o.status}' after ${writesOn(G, "orders", "order_items").length} write(s)`);
}
{
  const G = await world({ fix: { orders: [{ id: "o2", restaurant_id: RID, status: "received", table_number: "6", items: [{ id: "d", status: "received" }] }] } });
  const r = await call("POST", "orders/o2/accept", { body: {} });
  if (r.status === 200 && G.FIX.orders[0].status === "preparing") ok("a LIVE ticket is still accepted (200, now preparing)");
  else bad(`a live ticket's accept answered ${r.status}, status ${G.FIX.orders[0].status}`);
}
{
  const G = await world({ fix: { orders: [{ id: "o3", restaurant_id: RID, status: "preparing", table_number: "6", items: [] }],
    order_items: [{ id: "i3", restaurant_id: RID, order_id: "o3", status: "preparing" }] } });
  const r = await call("POST", "items/i3/status", { body: { status: "served" } });
  if (r.status === 200 && G.FIX.order_items[0].status === "served" && G.FIX.orders[0].status === "served") ok("a dish on a LIVE ticket is still served, and the ticket rolls up to served");
  else bad(`a live dish's serve answered ${r.status}, dish ${G.FIX.order_items[0].status}, order ${G.FIX.orders[0].status}`);
}

// ── 2. A PRINTED INVOICE LOCKS WHAT IS ON IT (item 2) ──────────────────────────────────────────────
// Owner's rule 10 (docs/COMPLIANCE-GUARDRAILS.md §3.0b). The lock lives in the routes, not the
// database, and the tablet's route had none of it.
console.log("\n2. once the invoice is printed, nothing comes off the bill from the handheld");
const hourAgo = new Date(Date.now() - 3600e3).toISOString();
const invWorld = (sess = {}, order = {}) => world({
  fix: {
    sessions: [{ id: "s1", restaurant_id: RID, table_number: "4", status: "open", invoice_no: 17, invoice_voided: false, invoice_at: recent, discount: 0, ...sess }],
    orders: [{ id: "o1", restaurant_id: RID, status: "served", payment_status: "pending", session_id: "s1", table_number: "4",
      subtotal: 500, total: 525, taxable_base: 500, discount: 0, created_at: hourAgo, items: [], ...order }],
    order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "served", qty: 2, title: "Pasta", unit_price: 250 }],
  },
  settings: { discount_cap_tablet: null },
});
const MONEY_DOORS = [
  ["items/i1/delete", { reason: "x" }, "taking a dish off", "lfh_delete_order_item"],
  ["items/i1/qty", { qty: 1 }, "lowering a quantity", "lfh_staff_edit_item_qty"],
  ["items/i1/qty", { qty: 3 }, "raising a quantity on a printed ticket", "lfh_staff_edit_item_qty"],
  ["orders/o1/discount", { amount: 10 }, "a ticket discount", null],
  ["sessions/s1/bill-discount", { amount: 10 }, "a whole-bill discount", "lfh_staff_bill_discount"],
  ["orders/o1/add-item", { dishId: "d9" }, "adding a dish to a printed ticket", "lfh_staff_add_item_to_order"],
];
for (const [path, body, what, rpc] of MONEY_DOORS) {
  const G = await invWorld();
  const r = await call("POST", path, { body });
  const touched = writesOn(G, "orders", "order_items", "sessions").length + G.RPCS.filter((x) => x.name === rpc).length;
  if (r.status === 409 && /printed bill/.test(r.text) && touched === 0) ok(`${what} on an invoiced bill is refused (409) and nothing moves`);
  else bad(`${what} on an invoiced bill answered ${r.status} ${r.text.slice(0, 80)} — ${touched} write/call(s)`);
}
// A REOPENED bill (mig 407 keeps the number) locks only what was on the paper; a ticket punched
// after the reopen is free — the owner's 2026-09-25 rule, identical to the manager's.
{
  const G = await invWorld({ invoice_voided: true, invoice_at: hourAgo }, { created_at: recent });
  const r = await call("POST", "items/i1/delete", { body: { reason: "x" } });
  if (r.status === 200 && G.RPCS.some((x) => x.name === "lfh_delete_order_item")) ok("after a reopen, a dish on a ticket punched AFTER the invoice can still come off");
  else bad(`after a reopen, a new ticket's dish answered ${r.status} ${r.text.slice(0, 80)}`);
}
{
  const G = await invWorld({ invoice_voided: true, invoice_at: recent }, { created_at: hourAgo });
  const r = await call("POST", "items/i1/delete", { body: { reason: "x" } });
  if (r.status === 409 && !G.RPCS.some((x) => x.name === "lfh_delete_order_item")) ok("after a reopen, a dish that WAS on the paper still cannot come off");
  else bad(`after a reopen, a printed dish answered ${r.status}`);
}
{
  const G = await invWorld({ invoice_no: null, invoice_at: null });
  const r = await call("POST", "items/i1/delete", { body: { reason: "x" } });
  if (r.status === 200 && G.RPCS.some((x) => x.name === "lfh_delete_order_item")) ok("a bill with NO invoice still lets a dish come off (the lock is not refusing everything)");
  else bad(`an un-invoiced bill's dish delete answered ${r.status} ${r.text.slice(0, 80)}`);
}
{
  const G = await invWorld({ invoice_no: null, invoice_at: null });
  const r = await call("POST", "sessions/s1/bill-discount", { body: { amount: 10 } });
  if (r.status === 200 && G.RPCS.some((x) => x.name === "lfh_staff_bill_discount")) ok("a whole-bill discount on an un-invoiced bill still goes through");
  else bad(`an un-invoiced whole-bill discount answered ${r.status} ${r.text.slice(0, 80)}`);
}
// The copy must stay a copy. The manager's helper is the rule; if either side changes, both must.
{
  const { readFileSync } = await import("node:fs");
  const fn = (file) => {
    const t = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const i = t.indexOf("async function invoiceLockedByOrder(");
    return i < 0 ? null : t.slice(i, t.indexOf("\n}\n", i) + 2).replace(/\s+/g, " ");
  };
  const ed = fn("app/api/editor/[...path]/route.ts"), tb = fn("app/api/tablet/[...path]/route.ts");
  if (ed && tb && ed === tb) ok("the tablet's invoiceLockedByOrder is byte-for-byte the manager's");
  else bad("the tablet's invoiceLockedByOrder and the manager's have drifted apart — change both, or neither");
}

// ── 3. NOBODY AT THE RESTAURANT REMOVES A BILL — "Delete order" CANCELS (item 3) ─────────────────────
// R27 / COMPLIANCE-GUARDRAILS §3.0 rule 4. The waiter's delete used to soft-delete the ticket (and an
// emptied bill's session) out of every report.
console.log("\n3. the waiter's \"Delete order\" cancels the ticket and never removes it");
const liveTicket = (o = {}) => world({ fix: {
  orders: [{ id: "o5", restaurant_id: RID, status: "preparing", payment_status: "pending", session_id: "s5", table_number: "5", total: 200, created_at: hourAgo, ...o }],
  sessions: [{ id: "s5", restaurant_id: RID, table_number: "5", status: "open", invoice_no: null }],
} });
{
  const G = await liveTicket();
  const r = await call("POST", "orders/o5/delete", { body: { reason: "wrong table" } });
  const o = G.FIX.orders[0], sess = G.FIX.sessions[0];
  if (r.status === 200 && o.status === "cancelled" && o.cancelled_at) ok("the ticket is CANCELLED (status cancelled, cancelled_at stamped)");
  else bad(`the ticket answered ${r.status} and reads status '${o.status}'`);
  if (!o.deleted_at && !sess.deleted_at && !G.WRITES.some((w) => w.patch && "deleted_at" in w.patch)) ok("…nothing is stamped deleted — not the ticket, not the bill");
  else bad("…but something was stamped deleted_at — the sale left the reports");
  if (G.LOGS.some((l) => l.action === "order_cancel" && l.order_id === "o5")) ok("…the Activity log says order_cancel");
  else bad("…no order_cancel line in the Activity log");
  const rr = G.RPCS.find((x) => x.name === "lfh_record_removal");
  if (rr && rr.args.p_kind === "order_cancelled" && rr.args.p_actor === "Diag Waiter") ok("…Audit & logs records order_cancelled, naming the waiter");
  else bad(`…the removal record is ${rr ? rr.args.p_kind : "missing"}`);
  if (!G.RPCS.some((x) => x.args && x.args.p_kind === "order_deleted")) ok("…and no order_deleted record is written");
  else bad("…an order_deleted record was written");
}
{
  const G = await liveTicket({ payment_status: "paid", status: "served" });
  const r = await call("POST", "orders/o5/delete", { body: {} });
  if (r.status === 409 && G.FIX.orders[0].status === "served") ok("a PAID ticket is still refused (409) and left alone");
  else bad(`a paid ticket answered ${r.status}, status ${G.FIX.orders[0].status}`);
}
{
  const G = await world({ fix: {
    orders: [{ id: "o5", restaurant_id: RID, status: "preparing", payment_status: "pending", session_id: "s5", table_number: "5", created_at: hourAgo }],
    sessions: [{ id: "s5", restaurant_id: RID, table_number: "5", status: "open", invoice_no: 9, invoice_voided: false, invoice_at: recent }],
  } });
  const r = await call("POST", "orders/o5/delete", { body: {} });
  if (r.status === 409 && G.FIX.orders[0].status === "preparing" && writesOn(G, "orders").length === 0) ok("a ticket on a printed invoice is refused (409) and left alone");
  else bad(`a ticket on a printed invoice answered ${r.status}, status ${G.FIX.orders[0].status}`);
}
{
  const G = await liveTicket({ status: "cancelled", cancelled_at: recent });
  const r = await call("POST", "orders/o5/delete", { body: {} });
  if (r.status === 200 && writesOn(G, "orders").length === 0 && !G.RPCS.some((x) => x.name === "lfh_record_removal")) ok("cancelling an already-cancelled ticket is a quiet no-op (no second audit row)");
  else bad(`a second cancel answered ${r.status} with ${writesOn(G, "orders").length} write(s)`);
}
{
  const { readFileSync } = await import("node:fs");
  const t = readFileSync(new URL("../app/api/tablet/[...path]/route.ts", import.meta.url), "utf8").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
  if (!/softDeleteOrders\s*\(/.test(t)) ok("the waiter's route calls softDeleteOrders nowhere");
  else bad("the waiter's route calls softDeleteOrders again — R27: nobody at the restaurant removes a bill");
}

// ── 4. A TAP ON SOMETHING ALREADY GONE SAYS SO — NOT "ask your manager to add the table" (item 4) ──────
// Sections are always on for a waiter, so the section gate runs before every row-id action. It could
// not tell "no such row" from "couldn't tell", and refused the first with the section sentence.
console.log("\n4. a stale tap is told the thing is gone, not that the table is someone else's");
// An IN-MEMORY waiter holding tables 1–3 (nothing real is written; no restaurant's setting moves).
const SECTION_1_TO_3 = [1, 2, 3];
const GONE_DOORS = [
  ["calls/gone1/attend", {}, /no longer on the board/, "attending a call that was already cleared"],
  ["members/gone1/approve", {}, /no longer on this table/, "letting in a guest who already left"],
  ["items/gone1/status", { status: "served" }, /isn't on this restaurant's board/, "serving a dish that was removed"],
  ["orders/gone1/serve-all", {}, /isn't there anymore/, "serving an order that is gone"],
  ["requests/gone1/resolve", { status: "approved" }, /no longer there/, "answering a request that is gone"],
];
for (const [path, body, want, what] of GONE_DOORS) {
  const G = await world({ fix: {} });
  const r = await call("POST", path, { body });
  // A scoped update that matched no row is still a statement the stub logs; what matters is that it CHANGED nothing.
  if (r.status === 404 && want.test(r.text) && G.WRITES.every((w) => w.matched === 0)) ok(`${what} → 404 "${(r.json && r.json.error || "").slice(0, 60)}"`);
  else bad(`${what} answered ${r.status} ${r.text.slice(0, 90)}`);
}
{
  // The gate still does its job: a dish on a table OUTSIDE the waiter's section is refused by name.
  const G = await world({ user: { assigned_tables: SECTION_1_TO_3 }, fix: {
    orders: [{ id: "o9", restaurant_id: RID, status: "preparing", table_number: "9", items: [] }],
    order_items: [{ id: "i9", restaurant_id: RID, order_id: "o9", status: "preparing" }],
  } });
  const r = await call("POST", "items/i9/status", { body: { status: "served" } });
  if (r.status === 403 && /Table 9 isn't in your section/.test(r.text) && G.WRITES.length === 0) ok("a dish on someone else's table is still refused, naming table 9");
  else bad(`someone else's table answered ${r.status} ${r.text.slice(0, 90)}`);
}
{
  // A FAILED lookup is still "couldn't tell" and still refused — a blip never reads as allowed.
  const G = await world({ user: { assigned_tables: SECTION_1_TO_3 }, fail: { waiter_calls: "error" }, fix: {
    waiter_calls: [{ id: "c9", restaurant_id: RID, table_number: "9", resolved: false }],
  } });
  const r = await call("POST", "calls/c9/attend", { body: {} });
  if (r.status === 403 && G.WRITES.length === 0) ok("a lookup that FAILED still refuses (403) and writes nothing");
  else bad(`a failed lookup answered ${r.status} with ${G.WRITES.length} write(s)`);
}

console.log(`\n${fail ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
