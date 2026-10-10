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

// ── 5. A PAID OR CANCELLED TICKET IS NOT DISCOUNTED FROM THE HANDHELD (item 5) ─────────────────────
console.log("\n5. a settled or cancelled ticket cannot be discounted from the handheld");
for (const [o, what] of [[{ payment_status: "paid", status: "served" }, "a PAID ticket"], [{ status: "cancelled", payment_status: "pending" }, "a CANCELLED ticket"]]) {
  const G = await world({ settings: { discount_cap_tablet: null }, fix: { orders: [{ id: "o7", restaurant_id: RID, table_number: "7", session_id: null, subtotal: 400, taxable_base: 400, total: 420, discount: 0, ...o }] } });
  const r = await call("POST", "orders/o7/discount", { body: { amount: 10 } });
  if (r.status === 409 && writesOn(G, "orders").length === 0 && !G.RPCS.some((x) => x.name === "lfh_record_removal")) ok(`a discount on ${what} is refused (409), nothing written, no audit row`);
  else bad(`a discount on ${what} answered ${r.status} with ${writesOn(G, "orders").length} write(s)`);
}
{
  const G = await world({ fix: { orders: [{ id: "o8", restaurant_id: RID, table_number: "7", session_id: null, subtotal: 400, taxable_base: 400, total: 420, discount: 0, status: "served", payment_status: "pending" }] } });
  const r = await call("POST", "orders/o8/discount", { body: { amount: 10 } });
  if (r.status === 200 && G.FIX.orders[0].discount === 10) ok("an UNPAID ticket is still discounted (200, ₹10 written)");
  else bad(`an unpaid ticket's discount answered ${r.status}, discount ${G.FIX.orders[0].discount}`);
}

// ── 6. A FAILED FLOOR READ IS NEVER SHARED WITH THE NEXT DEVICE (item 6) ───────────────────────────
// supabase-js resolves `{ error }` instead of throwing, so a failed read used to be shared for 1.5s.
console.log("\n6. one failed floor read is not handed to every device for the next 1.5 s");
{
  const SUMMARY = { tiles: { 1: { counts: {} } }, calls: [], requests: [], joiners: [], order_count: 0 };
  const G = await world({ fail: { "rpc:lfh_table_view_summary": "error" } });
  await call("POST", "nothing-here", { body: {} });          // drops floor:<rid> through the route's own copy
  const a = await call("GET", "summary", { query: "?nomenu=1" });
  delete G.FAIL; G.RPC_ANSWERS.lfh_table_view_summary = SUMMARY;
  const b = await call("GET", "summary", { query: "?nomenu=1" });
  if (a.status >= 500 && b.status === 200) ok(`the failed read answers ${a.status}, and the very next device's read is fresh (200), not the failure`);
  else bad(`after a failed floor read the next read answered ${b.status} — the failure was shared`);
  const c = await call("GET", "summary", { query: "?nomenu=1" });
  if (G.RPCS.filter((x) => x.name === "lfh_table_view_summary").length === 2 && c.status === 200) ok("…and a GOOD read is still shared (the third read cost no extra computation)");
  else bad(`a good read was not shared: ${G.RPCS.filter((x) => x.name === "lfh_table_view_summary").length} computations`);
}
{
  const G = await world({ rpc: { lfh_table_view_summary: { tiles: {}, calls: [], requests: [], joiners: [] } }, fail: { "table_merges:select": "error" } });
  await call("POST", "nothing-here", { body: {} });
  const a = await call("GET", "summary", { query: "?table=1" });
  delete G.FAIL; G.FIX.table_merges = [{ restaurant_id: RID, parent_table: "1", child_table: "2", ended_at: null }];
  const b = await call("GET", "summary", { query: "?table=1" });
  if (a.status === 200 && Array.isArray(a.json.merges) && a.json.merges.length === 0 && b.json.merges.length === 1) ok("a failed joins read degrades that ONE answer to no joins, and the next answer has the real join");
  else bad(`joins after a failed read: first ${a.status} ${JSON.stringify(a.json && a.json.merges)}, next ${JSON.stringify(b.json && b.json.merges)}`);
}

// ── 7. A MANAGER ON THIS PANEL IS ANSWERED BY WHAT THEY ARE SHOWN (item 7) ─────────────────────────
console.log("\n7. a manager or owner on the waiter panel can use the invoice button they are shown");
{
  const SESS = [{ id: "s1", restaurant_id: RID, table_number: "3", status: "open" }];
  const CUST = { cust_phone: "9876543210", cust_name: "Asha" };
  for (const who of ["manager", "owner"]) {
    const G = await world({ who, settings: { tablet_invoice: "on" }, fix: { sessions: SESS } });
    const shown = (await call("GET", "summary", { query: "?nomenu=1" })).json?.settings?.tablet_invoice;
    const r = await call("POST", "sessions/s1/invoice", { body: CUST });
    if (shown === "on" && r.status === 200 && G.RPCS.some((x) => x.name === "lfh_generate_invoice")) ok(`a ${who} shown 'Generate invoice' can issue it (200)`);
    else bad(`a ${who} was shown '${shown}' and the tap answered ${r.status} ${r.text.slice(0, 70)}`);
  }
  {
    const G = await world({ who: "manager", settings: { tablet_invoice: "off" }, fix: { sessions: SESS } });
    const r = await call("POST", "sessions/s1/invoice", { body: CUST });
    if (r.status === 403 && !G.RPCS.some((x) => x.name === "lfh_generate_invoice")) ok("…and where the restaurant stored 'off', the manager is refused (not shown, not allowed)");
    else bad(`a manager with 'off' answered ${r.status}`);
  }
  {
    const G = await world({ settings: { tablet_invoice: "on" }, fix: { sessions: SESS } });
    const r = await call("POST", "sessions/s1/invoice", { body: CUST });
    if (r.status === 403 && !G.RPCS.some((x) => x.name === "lfh_generate_invoice")) ok("…while a WAITER is still refused, whatever is stored (the owner's never-list)");
    else bad(`a waiter answered ${r.status} on the invoice`);
  }
}

// ── 8. ON THE HOUSE AND SPENDING POINTS RESPECT A PRINTED INVOICE TOO (round 2, owner item 11) ─────
console.log("\n8. a printed bill cannot be comped or paid down with points afterwards (both panels)");
{
  const inv = (voided = false) => ({
    sessions: [{ id: "s1", restaurant_id: RID, table_number: "3", status: "open", invoice_no: 21, invoice_voided: voided, invoice_at: recent, last_activity_at: recent }],
    orders: [{ id: "o1", restaurant_id: RID, table_number: "3", session_id: "s1", status: "served", payment_status: "pending", archived: false, subtotal: 300, created_at: hourAgo }],
    table_tags: [{ restaurant_id: RID, table_number: "3", tag: "family" }],
  });
  {
    const G = await world({ fix: inv(), settings: { table_tags_allowed: true } });
    const r = await call("POST", "tables/3/on-the-house", { body: {} });
    if (r.status === 409 && /printed bill/.test(r.text) && G.FIX.orders[0].payment_status === "pending") ok("waiter: On the house on an invoiced bill is refused (409), nothing settled");
    else bad(`waiter: On the house on an invoiced bill answered ${r.status}, payment ${G.FIX.orders[0].payment_status}`);
  }
  {
    const G = await world({ fix: { ...inv(), sessions: [{ ...inv().sessions[0], invoice_no: null, invoice_at: null }] }, settings: { table_tags_allowed: true } });
    const r = await call("POST", "tables/3/on-the-house", { body: {} });
    if (r.status === 200 && G.FIX.orders[0].payment_status === "paid") ok("waiter: …and with no invoice it still settles on the house");
    else bad(`waiter: an un-invoiced comp answered ${r.status}`);
  }
  {
    const G = await world({ fix: inv(), ents: { customers: true } });
    const r = await call("POST", "tables/3/loyalty-redeem", { body: { phone: "9876543210", points: 10 } });
    if (r.status === 409 && /printed bill/.test(r.text) && !G.RPCS.some((x) => /loyalty|redeem|bill_discount/.test(x.name))) ok("waiter: spending points on an invoiced bill is refused (409), nothing spent");
    else bad(`waiter: points on an invoiced bill answered ${r.status} ${r.text.slice(0, 70)}`);
  }
  const { readFileSync } = await import("node:fs");
  const ed = readFileSync(new URL("../app/api/editor/[...path]/route.ts", import.meta.url), "utf8");
  const after = (needle, span) => { const i = ed.indexOf(needle); return i < 0 ? "" : ed.slice(i, i + span); };
  if (/for \(const o of unpaid\) if \(await invoiceLockedByOrder\(o\.id, rid\)\) return err\(LOCKED_MSG, 409\);/.test(after('if (a === "tables" && c === "on-the-house")', 9000))) ok("manager: On the house asks the same invoice lock before it writes");
  else bad("manager: On the house no longer asks the invoice lock");
  if (/invoiceLockedByOrder\(o\.id, rid\)\) return err\(LOCKED_MSG, 409\)/.test(after('if (a === "loyalty-redeem")', 2500))) ok("manager: spending points asks the same invoice lock");
  else bad("manager: spending points no longer asks the invoice lock");
}

// ── 9. A FAILED PERMISSION READ IS "BUSY", NEVER A GUESS (round 2, item 12) ──────────────────────────
console.log("\n9. a database blip during a permission check neither grants nor refuses — it says busy");
{
  const FIXO = { orders: [{ id: "o1", restaurant_id: RID, table_number: "3", status: "served", payment_status: "pending", subtotal: 400, taxable_base: 400, discount: 0 }] };
  {
    const G = await world({ fix: FIXO, fail: { "settings:select": "error" } });
    const r = await call("POST", "orders/o1/discount", { body: { amount: 10 } });
    if (r.status >= 500 && !G.WRITES.some((w) => w.table === "orders" && w.matched)) ok(`waiter: the switch could not be read → ${r.status} (retry), no discount written`);
    else bad(`waiter: a failed switch read answered ${r.status} with ${G.WRITES.filter((w) => w.matched).length} write(s)`);
  }
  {
    const G = await world({ fix: FIXO, settings: { tablet_discount: "pin" } });
    G.FIX.staff_users = [{ id: "m", restaurant_id: RID, role: "manager", active: true, pin_hash: "plain:1234" }];
    G.FAIL = { "staff_users:select": "error" };
    const r = await call("POST", "orders/o1/discount", { body: { amount: 10 } });
    if (r.status >= 500 && !G.WRITES.some((w) => w.table === "orders" && w.matched)) ok(`waiter: on PIN, "has any manager set a PIN?" could not be read → ${r.status}, NOT let through without a PIN`);
    else bad(`waiter: a failed PIN-setup read answered ${r.status} — a PIN-gated discount went through`);
  }
  {
    const G = await world({ fix: { sessions: [{ id: "s1", restaurant_id: RID, table_number: "3", status: "open" }] }, fail: { "restaurants:select": "error" } });
    const r = await call("POST", "sessions/s1/close", { body: { force: true } });
    if (r.status >= 500 && !G.WRITES.some((w) => w.matched)) ok(`waiter: the walk-out switch could not be read → ${r.status}, the table stays open`);
    else bad(`waiter: a failed walk-out read answered ${r.status}`);
  }
  {
    const { bundle } = await import("./sweep/t13s10/lib.mjs");
    const MC = bundle("lib/managerCan.ts");
    await world({ who: "manager", accessConfig: { give_discounts: { on: false } }, fail: { restaurants: "error" } });
    let threw = false; try { await MC.managerCan({ user: { id: "m", role: "manager", restaurant_id: RID, permissions: {} } }, RID, "give_discounts"); } catch { threw = true; }
    if (threw) ok("manager: managerCan THROWS on a failed read (the caller answers busy) instead of handing out the default");
    else bad("manager: managerCan answered a failed read with a guess");
    let threw2 = false; try { await MC.managerCan({ user: { id: "o", role: "owner", restaurant_id: RID, permissions: {} } }, RID, "edit_menu"); } catch { threw2 = true; }
    if (threw2) ok("owner: the edit-menu cascade throws too (a retry, never a fail-open guess)");
    else bad("owner: the edit-menu read still fails open");
  }
  {
    const G = await world({ fix: FIXO });
    const r = await call("POST", "orders/o1/discount", { body: { amount: 10 } });
    if (r.status === 200 && G.FIX.orders[0].discount === 10) ok("…and with the database answering, the same discount goes through (200)");
    else bad(`a healthy discount answered ${r.status}`);
  }
}

// ── 10. THE KHATA PICKER ASKS THE SAME QUESTION AS THE PARK (round 2, item 9) ────────────────────────
console.log("\n10. the 'Collect later' picker and the park button can never disagree");
{
  const K = { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", phone: "1", created_at: recent }] };
  const G = await world({ fix: K, settings: { khata_allowed: true, tablet_khata: null } });
  const r = await call("GET", "khata/customers", { query: "?q=ra" });
  if (r.status === 200 && r.json.customers.length === 1) ok("an UNSET waiter khata switch reads as its default (on): the picker answers, like the park");
  else bad(`an unset khata switch: the picker answered ${r.status}`);
  G.FIX.settings[0].tablet_khata = "off";
  const r2 = await call("GET", "khata/customers", { query: "?q=ra" });
  if (r2.status === 403) ok("…and 'off' still refuses the picker");
  else bad(`'off' answered ${r2.status}`);
}

// ── 11. THE MANAGER'S FLOOR NEVER SHARES A FAILED READ EITHER (round 2, item 15 — item 6's twin) ──────
console.log("\n11. the manager floor: one failed read is not handed to every device for 1.5 s");
{
  const T9 = await import("./sweep/t9s10/lib.mjs");
  const SUM = { tiles: { 1: { counts: {} } }, calls: [], requests: [], joiners: [], order_count: 0 };
  const G = await T9.world({ fail: { "rpc:lfh_table_view_summary": "error" } });
  await T9.call("POST", "nothing-here", { body: {} });        // drops floor:<rid> through the editor route's own copy
  const a = await T9.call("GET", "summary");
  delete G.FAIL; G.RPC_ANSWERS.lfh_table_view_summary = SUM;
  const b = await T9.call("GET", "summary");
  if (a.status >= 500 && b.status === 200) ok(`manager: the failed floor read answers ${a.status}; the very next read is fresh (200)`);
  else bad(`manager: after a failed floor read the next answered ${b.status} — the failure was shared`);
}

// ── 12. THE DEAD BITS STAY GONE (round 2, item 17) ──────────────────────────────────────────────────
console.log("\n12. no dead gate, no optional scope, no read whose answer nothing uses");
{
  const { readFileSync } = await import("node:fs");
  const t = readFileSync(new URL("../app/api/tablet/[...path]/route.ts", import.meta.url), "utf8").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ");
  if (!/parcelEffectiveFromRow\s*[(=]/.test(t)) ok("the always-true parcel 'rung' is gone (Parcel has no switch since 2026-08-03)");
  else bad("parcelEffectiveFromRow is back — a gate that can never fire");
  if (/const stampEdited = async \(orderId: string \| null \| undefined, rid: string\)/.test(t) && !/if \(rid\) q = q\.eq/.test(t)) ok("stampEdited REQUIRES the restaurant (no unscoped fallback)");
  else bad("stampEdited's restaurant is optional again");
  const G = await world({ ents: { customers: true }, fix: { table_merges: [] } });
  const r = await call("POST", "tables/3/loyalty", { body: { phone: "9876543210" } });
  if (r.status === 200 && !G.SCOPE_LOG.some((q) => q.table === "table_merges")) ok("the points balance asks no table question (the merged-parent read whose answer nothing used is gone)");
  else bad(`the points balance answered ${r.status} and read table_merges ${G.SCOPE_LOG.filter((q) => q.table === "table_merges").length}×`);
}

// ── 13. A WAITER'S PAID PARCEL IS FILED UNDER A REAL METHOD, IN ITS OWN SPELLING (round 2, item 18) ───
console.log("\n13. a paid parcel's method is one of UPI / Cash / Card / Other, spelled the canonical way");
{
  const MENU = { menu_items: [{ id: "d1", restaurant_id: RID, title: "Soup", price: "120", tags: [] }] };
  {
    const G = await world({ fix: MENU, rpc: { lfh_platform_insert: [{ id: "agg1" }] } });
    G.FIX.aggregator_orders = [{ id: "agg1", restaurant_id: RID }];
    const r = await call("POST", "parcel", { body: { items: [{ id: "d1" }], paid: true } });
    const m = G.FIX.aggregator_orders[0].payment_method;
    if (r.status === 200 && m === "Cash") ok("no method given → 'Cash' (never lowercase 'cash', a bucket of its own)");
    else bad(`no method given → ${r.status}, stored '${m}'`);
  }
  {
    const G = await world({ fix: MENU, rpc: { lfh_platform_insert: [{ id: "agg1" }] } });
    G.FIX.aggregator_orders = [{ id: "agg1", restaurant_id: RID }];
    await call("POST", "parcel", { body: { items: [{ id: "d1" }], paid: true, method: "upi" } });
    if (G.FIX.aggregator_orders[0].payment_method === "UPI") ok("'upi' is stored as 'UPI'");
    else bad(`'upi' stored as '${G.FIX.aggregator_orders[0].payment_method}'`);
  }
  {
    const G = await world({ fix: MENU, rpc: { lfh_platform_insert: [{ id: "agg1" }] } });
    const r = await call("POST", "parcel", { body: { items: [{ id: "d1" }], paid: true, method: "Bitcoin" } });
    if (r.status === 400 && /Pick how it was paid/.test(r.text) && !G.RPCS.some((x) => x.name === "lfh_platform_insert")) ok("an unknown method is refused BEFORE the parcel is created (nothing half-exists)");
    else bad(`an unknown method answered ${r.status}, insert called: ${G.RPCS.some((x) => x.name === "lfh_platform_insert")}`);
  }
}

console.log(`\n${fail ? "✗ FAIL" : "✓ PASS"} — ${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
