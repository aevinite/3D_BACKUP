// Block C — the money and compliance rules of my half, DRIVEN (P179601–P179636). Each row puts a
// real bill shape in the stub world, calls the real route, and reads what was stored, logged and
// audited. docs/COMPLIANCE-GUARDRAILS.md: a sale can be cancelled, never disappear; every money
// change is audited; an issued invoice is corrected by a credit note, never edited.
import { check, call } from "./lib.mjs";
import { fullWorld, ALL_PERMS, ID } from "./endpoints.mjs";

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const audits = (G, kind) => G.RPCS.filter((c) => c.name === "lfh_record_removal" && (!kind || c.args.p_kind === kind));
const logged = (G, a) => G.LOGS.some((l) => l.action === a);
const ord = (G, id = ID.order) => G.FIX.orders.find((o) => o.id === id);
let n = 179601;
const row = (what, fn) => check(`P${n++}`, what, "STUB · the real route, French House manager unless named", fn);
const run = async (setup, verb, path, body) => { const G = await fullWorld(setup); if (setup.mut) setup.mut(G); const r = await call(verb, path, body === null ? {} : { body }); return { G, r }; };

// ── PATCH /orders/:id — cancel, pay, revert, restore ────────────────────────────────────────
row("a PAID order cannot be cancelled until it is un-paid (409), and stays paid", async () => {
  const { G, r } = await run({ mut: (G) => { ord(G).payment_status = "paid"; } }, "PATCH", `orders/${ID.order}`, { status: "cancelled" });
  return { ok: r.status === 409 && ord(G).status === "preparing", note: `${r.status}` }; });
row("a ticket on a LIVE printed invoice cannot be cancelled — the credit-note door is named", async () => {
  const { G, r } = await run({ mut: (G) => { const s = G.FIX.sessions.find((x) => x.id === ID.sess); s.invoice_no = "INV-9"; s.invoice_voided = false; s.invoice_at = ago(1); } }, "PATCH", `orders/${ID.order}`, { status: "cancelled" });
  return { ok: r.status === 409 && /credit note/.test(r.text) && ord(G).status === "preparing", note: `${r.status}` }; });
row("a cancel writes order_cancel to the log AND an order_cancelled Audit row naming the person", async () => {
  const { G, r } = await run({}, "PATCH", `orders/${ID.order}`, { status: "cancelled", reason_code: "guest_left" });
  const a = audits(G, "order_cancelled")[0];
  return { ok: r.status === 200 && logged(G, "order_cancel") && a && a.args.p_actor && a.args.p_reason_code === "guest_left" && !!ord(G).cancelled_at, note: a ? a.args.p_actor : "no audit" }; });
row("restoring a cancel inside 30 minutes works and is logged order_uncancel", async () => {
  const { G, r } = await run({}, "PATCH", `orders/${ID.cancelled}`, { status: "received" });
  return { ok: r.status === 200 && ord(G, ID.cancelled).status === "received" && ord(G, ID.cancelled).cancelled_at === null && logged(G, "order_uncancel"), note: `${r.status}` }; });
row("restoring a cancel OLDER than 30 minutes is refused and it stays cancelled", async () => {
  const { G, r } = await run({ mut: (G) => { ord(G, ID.cancelled).cancelled_at = ago(45); } }, "PATCH", `orders/${ID.cancelled}`, { status: "received" });
  return { ok: r.status === 409 && ord(G, ID.cancelled).status === "cancelled", note: `${r.status}` }; });
row("taking payment on a cancelled order is refused", async () => {
  const { r } = await run({}, "PATCH", `orders/${ID.cancelled}`, { payment_status: "paid", payment_method: "Cash" }); return { ok: r.status === 409, note: `${r.status}` }; });
row("taking payment before the order is accepted is refused", async () => {
  const { r } = await run({}, "PATCH", `orders/${ID.order2}`, { payment_status: "paid", payment_method: "Cash" }); return { ok: r.status === 409 && /Accept the order first/.test(r.text), note: `${r.status}` }; });
row("a payment method nobody counts is refused", async () => {
  const { G, r } = await run({}, "PATCH", `orders/${ID.order}`, { payment_status: "paid", payment_method: "Bitcoin" }); return { ok: r.status === 400 && ord(G).payment_status === "pending", note: `${r.status}` }; });
row("un-paying a bill needs a reason (409 without one) and the money stays booked", async () => {
  const { G, r } = await run({ mut: (G) => { Object.assign(ord(G), { payment_status: "paid", paid_at: ago(2) }); } }, "PATCH", `orders/${ID.order}`, { payment_status: "pending" });
  return { ok: r.status === 409 && ord(G).payment_status === "paid", note: `${r.status}` }; });
row("un-paying with a reason clears the tip, logs payment_revert and writes a payment_reverted Audit row", async () => {
  const { G, r } = await run({ mut: (G) => { Object.assign(ord(G), { payment_status: "paid", paid_at: ago(2), tip: 40 }); } }, "PATCH", `orders/${ID.order}`, { payment_status: "pending", revert_reason: "wrong table" });
  return { ok: r.status === 200 && ord(G).tip === 0 && ord(G).paid_at === null && logged(G, "payment_revert") && audits(G, "payment_reverted").length === 1, note: `${r.status}` }; });
row("un-paying a bill paid more than 30 minutes ago is refused", async () => {
  const { r } = await run({ mut: (G) => { Object.assign(ord(G), { payment_status: "paid", paid_at: ago(31) }); } }, "PATCH", `orders/${ID.order}`, { payment_status: "pending", revert_reason: "x" });
  return { ok: r.status === 409 && /30 minutes/.test(r.text), note: `${r.status}` }; });
row("archiving unpaid food off the floor turns it into a visible ✕ with an Audit row marked automatic", async () => {
  const { G, r } = await run({}, "PATCH", `orders/${ID.order}`, { archived: true });
  const a = audits(G, "order_cancelled")[0];
  return { ok: r.status === 200 && ord(G).status === "cancelled" && ord(G).archived === true && a && /unpaid food archived/.test(JSON.stringify(a.args.p_meta || {})), note: `${ord(G).status}` }; });
row("archiving a pay-later order does NOT cancel it — that money is still to be collected", async () => {
  const { G, r } = await run({ mut: (G) => { ord(G).khata_at = ago(1); } }, "PATCH", `orders/${ID.order}`, { archived: true });
  return { ok: r.status === 200 && ord(G).status === "preparing" && ord(G).archived === true && audits(G).length === 0, note: `${ord(G).status}` }; });
// ── discounts ───────────────────────────────────────────────────────────────────────────────
row("a discount on a live invoice is refused, nothing moves", async () => {
  const { G, r } = await run({ mut: (G) => { const s = G.FIX.sessions.find((x) => x.id === ID.sess); s.invoice_no = "INV-9"; s.invoice_voided = false; s.invoice_at = ago(1); } }, "POST", `orders/${ID.order}/discount`, { amount: 10 });
  return { ok: r.status === 409 && !G.RPCS.some((c) => c.name === "lfh_staff_bill_discount"), note: `${r.status}` }; });
row("a bill discount bigger than the bill is clamped to the bill's taxable food (uncapped admin; a capped person is refused first)", async () => {
  const { G, r } = await run({ who: "admin" }, "POST", `orders/${ID.order}/discount`, { amount: 5000 });
  const c = G.RPCS.find((x) => x.name === "lfh_staff_bill_discount");
  return { ok: r.status === 200 && c && c.args.p_amount === 600, note: c ? `stored ₹${c.args.p_amount} of a ₹600 bill` : `${r.status}` }; });
row("a discount writes a discount_given Audit row with the amount actually stored", async () => {
  const { G } = await run({ rpc: { lfh_staff_bill_discount: { discount: 40 } } }, "POST", `orders/${ID.order}/discount`, { amount: 40, note: "regular" });
  const a = audits(G, "discount_given")[0]; return { ok: !!a && Number(a.args.p_amount) === 40, note: a ? `₹${a.args.p_amount}` : "none" }; });
row("removing a discount (amount 0) is logged but is NOT an Audit removal — it puts money back", async () => {
  const { G } = await run({ rpc: { lfh_staff_bill_discount: { discount: 0 } } }, "POST", `orders/${ID.order}/discount`, { amount: 0 });
  return { ok: logged(G, "order_discount") && audits(G, "discount_given").length === 0, note: "" }; });
row("a solo ticket's discount is written on its own row, clamped at its own food (uncapped admin)", async () => {
  const { G, r } = await run({ who: "admin" }, "POST", `orders/${ID.solo}/discount`, { amount: 999 });
  return { ok: r.status === 200 && ord(G, ID.solo).discount === 150, note: `discount ${ord(G, ID.solo).discount}` }; });
row("a quick order's discount ADDS to the table's existing bill discount instead of replacing it", async () => {
  const { G } = await run({ rpc: { lfh_staff_place_order: { ok: true, order_id: ID.order2 } }, mut: (G) => { ord(G).discount = 30; } }, "POST", "order", { table: "4", items: [{ id: "dal", qty: 1 }], discount: 10 });
  const c = G.RPCS.find((x) => x.name === "lfh_staff_bill_discount"); return { ok: !!c && c.args.p_amount === 40, note: c ? `₹${c.args.p_amount}` : "not called" }; });
// ── tips, parcels, on-the-house, pay-later ──────────────────────────────────────────────────
row("a tip is capped at ₹1,00,000 so a typo cannot land in the day-close", async () => {
  const { G } = await run({}, "POST", `orders/${ID.order}/tip`, { amount: 500000 }); return { ok: ord(G).tip === 100000, note: `tip ${ord(G).tip}` }; });
row("a counter parcel is stored WITH its tax, so the record equals the paper", async () => {
  const { G, r } = await run({ settings: { tax_rate: 0.05 } }, "POST", "parcel", { items: [{ id: "dal", qty: 2 }] });
  const c = G.RPCS.find((x) => x.name === "lfh_platform_insert"); return { ok: r.status === 200 && c && c.args.p_total === 420, note: c ? `stored ₹${c.args.p_total} for ₹400 of food at 5%` : `${r.status}` }; });
row("a parcel paid 'cash' is filed under the one spelling every breakdown counts ('Cash')", async () => {
  const { G } = await run({ rpc: { lfh_platform_insert: { id: "p-new" } } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], paid: true, method: "cash" });
  const w = G.WRITES.find((x) => x.table === "aggregator_orders" && x.op === "update"); return { ok: !!w && w.patch.payment_method === "Cash", note: w ? w.patch.payment_method : "no update" }; });
row("a parcel paid with an unknown method is refused BEFORE the parcel exists", async () => {
  const { G, r } = await run({}, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], paid: true, method: "IOU" });
  return { ok: r.status === 400 && !G.RPCS.some((x) => x.name === "lfh_platform_insert"), note: `${r.status}` }; });
row("a parcel with a sold-out dish is refused, nothing created", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.menu_items[0].tags = ["sold-out"]; } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }] });
  return { ok: r.status === 400 && /sold out/.test(r.text) && !G.RPCS.some((x) => x.name === "lfh_platform_insert"), note: `${r.status}` }; });
row("a parcel's discount is RECORDED in its payload and gets its own order_discount line", async () => {
  const { G } = await run({ rpc: { lfh_platform_insert: { id: "p-new" } }, accessConfig: { give_discounts: { limit: { manager: 100 } } } }, "POST", "parcel", { items: [{ id: "dal", qty: 1 }], discount: 20, discountNote: "staff" });
  const w = G.WRITES.find((x) => x.table === "aggregator_orders" && x.op === "update");
  return { ok: !!w && w.patch.payload.discount === 20 && G.LOGS.filter((l) => l.action === "order_discount").length === 1, note: w ? JSON.stringify(w.patch.payload).slice(0, 80) : "" }; });
row("on the house is refused on a VIP table — only Family or Owner's Guest", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.table_tags.find((x) => x.restaurant_id === "rest-1").tag = "vip"; G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order); } }, "POST", "tables/4/on-the-house", {});
  return { ok: r.status === 409 && /Family or Owner/.test(r.text), note: `${r.status}` }; });
row("on the house stores a 100% discount, the reserved method, and one Audit row per order", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); } }, "POST", "tables/4/on-the-house", {});
  const o = ord(G); return { ok: r.status === 200 && o.discount === 400 && o.payment_method === "On the house" && audits(G, "on_the_house").length === 1, note: `${r.status} ${o.payment_method}` }; });
row("parking a bill on pay-later marks it in the book, archives it, and closes the table", async () => {
  const { G, r } = await run({ mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order || o.restaurant_id === "rest-2"); ord(G).status = "served"; } }, "POST", "tables/4/khata", { customer_id: ID.khata });
  const o = ord(G); return { ok: r.status === 200 && o.khata_customer_id === ID.khata && o.archived === true && logged(G, "khata_park"), note: `${r.status}` }; });
// ── bills, invoices, credit notes ───────────────────────────────────────────────────────────
row("a manager cannot delete a bill — cancel is the only route out (R27)", async () => {
  const { G, r } = await run({}, "POST", "orders/delete", { ids: [ID.order2], reason: "x" }); return { ok: r.status === 403 && !G.WRITES.length, note: `${r.status}` }; });
row("the OWNER cannot delete a bill either (R27)", async () => {
  const { r } = await run({ who: "owner" }, "DELETE", `orders/${ID.order2}`, null); return { ok: r.status === 403, note: `${r.status}` }; });
row("the admin console deletes ONE bill at a time — orders from two bills are refused", async () => {
  const { r } = await run({ who: "admin", mut: (G) => { ord(G, ID.order2).session_id = "other"; } }, "POST", "orders/delete", { ids: [ID.order, ID.order2] });
  return { ok: r.status === 400 && /more than one bill/.test(r.text), note: `${r.status}` }; });
row("[read] a settled invoice the database locks (LFH01) and a cancelled sale (LFH02) are each answered 409 with their own sentence", async () => {
  const { branch } = await import("./lib.mjs"); const t = branch('a === "sessions" && c === "invoice"');
  return { ok: /error\.code === "LFH01"[\s\S]{0,140}credit note[\s\S]{0,40}409/.test(t) && /error\.code === "LFH02"[\s\S]{0,240}never gets a tax invoice[\s\S]{0,20}409/.test(t), note: "read the invoice branch — the stub cannot return a database error code" }; });
row("voiding an invoice that was never generated is refused and NO Audit row is invented", async () => {
  const { G, r } = await run({}, "POST", `sessions/${ID.sess}/void-invoice`, { reason: "x" });
  return { ok: r.status === 409 && audits(G).length === 0, note: `${r.status}` }; });
row("a manager voiding an invoice older than the reopen window is sent to the credit note", async () => {
  const { r } = await run({ mut: (G) => { G.FIX.sessions.find((s) => s.id === ID.closedSess).invoice_at = ago(20); } }, "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "x" });
  return { ok: r.status === 409 && /credit note/.test(r.text), note: `${r.status}` }; });
row("a credit note needs a reason, and one of ₹0 is refused", async () => {
  const a = await run({}, "POST", `sessions/${ID.closedSess}/credit-note`, { amount: 50 });
  const b = await run({}, "POST", `sessions/${ID.closedSess}/credit-note`, { amount: 0, reason: "x" });
  return { ok: a.r.status === 400 && b.r.status === 400 && !a.G.RPCS.length && !b.G.RPCS.length, note: `${a.r.status}/${b.r.status}` }; });
row("reopening a table that is still open is refused", async () => {
  const { r } = await run({}, "POST", `sessions/${ID.sess}/reopen-table`, { reason: "x" }); return { ok: r.status === 409 && /already open/.test(r.text), note: `${r.status}` }; });
row("clearing a table that still owes money records a close_unpaid line naming what was owed", async () => {
  const { G, r } = await run({}, "POST", "tables/4/restart", {});
  const l = G.LOGS.find((x) => x.action === "close_unpaid"); return { ok: r.status === 200 && l && /₹\d/.test(l.detail), note: l ? l.detail : "no line" }; });
