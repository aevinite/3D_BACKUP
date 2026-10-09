// Block B — the states a normal day never visits (P179501–P179570). Every row DRIVES the real
// route in memory: a module switched off, a permission taken away, the database failing on
// purpose, a row that has gone, and an input that is wrong. Each refusal must be a plain
// sentence, must not carry the stub's own error text, and must not have written anything.
import { check, call } from "./lib.mjs";
import { fullWorld, ALL_PERMS, ID } from "./endpoints.mjs";

// A write that matched no row changed nothing, so it is not counted (the stub records the attempt).
const writes = (G) => G.WRITES.filter((w) => w.table !== "staff_actions" && (w.op === "insert" || w.op === "upsert" || w.matched > 0)).length;
const plain = (r) => !/stub:|violates|syntax|PGRST|undefined|\[object Object\]/.test(r.text);
let n = 179501;
const row = (what, setup, verb, path, body, expect) => {
  const id = `P${n++}`;
  check(id, what, "STUB · the real route, " + (setup.label || "fully-granted manager"), async () => {
    const G = await fullWorld(setup);
    if (setup.mut) setup.mut(G);
    const r = await call(verb, path, body === null ? {} : { body });
    const res = expect(r, G);
    const okv = typeof res === "object" ? res.ok : res;
    return { ok: !!okv && plain(r), note: `${r.status} ${r.text.slice(0, 90)}${typeof res === "object" && res.note ? " · " + res.note : ""}` };
  });
};
const refused = (code, re) => (r, G) => ({ ok: r.status === code && (!re || re.test(r.text)) && G.RPCS.length === 0 && writes(G) === 0, note: `${writes(G)} writes, ${G.RPCS.length} rpcs` });
const off = (k) => ({ settings: { [k]: false }, label: `${k} = false` });
const noPerm = (k) => ({ perms: { ...ALL_PERMS, [k]: false }, label: `manager without ${k}` });
const fail = (f) => ({ fail: f, label: `database failing: ${JSON.stringify(f)}` });

// ── a module switched off: refused, nothing written ─────────────────────────────────────────
row("banquet switched off → saving a banquet line is refused", off("banquet_allowed"), "POST", "banquet/item-save", { title: "x", price: 1 }, refused(403, /Banquet isn't enabled/));
row("banquet switched off → issuing a banquet bill is refused", off("banquet_allowed"), "POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 1 }] }, refused(403));
row("pay-later switched off → parking a bill is refused", off("khata_allowed"), "POST", "tables/4/khata", { customer_id: ID.khata }, refused(403, /Pay later/));
row("pay-later switched off → adding a person to the book is refused", off("khata_allowed"), "POST", "khata/customers", { name: "x" }, refused(403));
row("pay-later switched off → collecting a tab is refused", off("khata_allowed"), "POST", "khata/pay", { order_id: ID.paid, method: "Cash" }, refused(403));
row("table types switched off → marking a table is refused", off("table_tags_allowed"), "POST", "tables/4/tag", { tag: "vip" }, refused(403, /Table types/));
row("table types switched off → settling on the house is refused", off("table_tags_allowed"), "POST", "tables/4/on-the-house", {}, refused(403));
row("a counter parcel needs NO module switch — it is permanent by design (an old parcel_allowed=false must not take it away)", off("parcel_allowed"), "POST", "parcel", { items: [{ id: "dal", qty: 1 }] }, (r) => r.status === 200);
row("collecting a delivery order that is already collected → 409, paid_at not moved", { mut: (G) => { G.FIX.aggregator_orders[0].paid = true; } }, "POST", `platform/${ID.plat}/pay`, { method: "UPI" }, refused(409, /already marked collected/));
row("collecting with a payment method nobody counts ('Bitcoin') → refused before anything is stamped", {}, "POST", `platform/${ID.plat}/pay`, { method: "Bitcoin" }, refused(400, /Pick how it was paid/));
row("noting a parcel bill printed a SECOND time keeps the first time", { mut: (G) => { G.FIX.aggregator_orders[0].printed_at = "2026-10-01T10:00:00.000Z"; } }, "POST", `platform/${ID.plat}/printed`, {}, (r, G) => r.status === 200 && r.json.printed_at === "2026-10-01T10:00:00.000Z" && writes(G) === 0);
row("order-taking switched off → a new order is refused", off("take_orders_allowed"), "POST", "order", { table: "4", items: [{ id: "dal", qty: 1 }] }, refused(403, /Order-taking/));
row("table & ticket operations off → change table is refused", off("table_ops_allowed"), "POST", `sessions/${ID.sess}/shift`, { to: "7" }, refused(403, /Table & KOT operations/));
row("table & ticket operations off → moving one ticket is refused", off("table_ops_allowed"), "POST", `orders/${ID.order}/move`, { to: "7" }, refused(403));
row("table & ticket operations off → merging is refused", off("table_ops_allowed"), "POST", `sessions/${ID.sess}/merge`, { to: "2" }, refused(403));
row("table & ticket operations off → settling in parts is refused", off("table_ops_allowed"), "POST", "tables/4/pay-split", { splits: [{ method: "Cash", amount: 420 }] }, refused(403));
row("table & ticket operations off → moving one dish is refused", off("table_ops_allowed"), "POST", `order-items/${ID.item}/move`, { to: "7" }, refused(403));
row("table & ticket operations off → splitting a merged table is refused", off("table_ops_allowed"), "POST", "tables/4/unmerge", {}, refused(403));
row("customer directory off → reading a guest's points is refused", { ents: { customers: false }, label: "customers entitlement off" }, "POST", "loyalty", { table: "4", phone: "98" }, refused(403, /customer directory/));
row("customer directory off → spending points is refused", { ents: { customers: false }, label: "customers entitlement off" }, "POST", "loyalty-redeem", { table: "4", phone: "98", points: 5 }, refused(403));
// ── a permission taken away: refused, nothing written ───────────────────────────────────────
row("without 'reopen a bill' → reopening a paid table is refused", noPerm("void_bills"), "POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "x" }, refused(403, /reopen a bill/));
row("without 'reopen a bill' → voiding an invoice is refused", noPerm("void_bills"), "POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "x" }, refused(403));
row("without 'reopen a bill' → a credit note is refused", noPerm("void_bills"), "POST", `sessions/${ID.closedSess}/credit-note`, { amount: 5, reason: "x" }, refused(403));
row("without 'reopen a bill' → clearing a table that owes money is refused", noPerm("void_bills"), "POST", "tables/4/restart", {}, refused(403, /clear a table/));
row("without 'reopen a bill' → answering 'was the food made' is refused", noPerm("void_bills"), "POST", "audit/classify", { order_id: ID.cancelled, made: true }, refused(403));
row("without 'give discounts' → a discount is refused", noPerm("give_discounts"), "POST", `orders/${ID.order}/discount`, { amount: 10 }, refused(403, /give discounts/));
row("without 'give discounts' → spending loyalty points is refused", noPerm("give_discounts"), "POST", "loyalty-redeem", { table: "4", phone: "98", points: 5 }, refused(403));
row("without 'clear the queue' → emptying the printing queue is refused", noPerm("print_clear"), "POST", "printing/queue/clear", {}, refused(403, /printing queue/));
row("without 'edit the menu' → saving a banquet line is refused", noPerm("edit_menu"), "POST", "banquet/item-save", { title: "x", price: 1 }, refused(403, /banquet menu/));
row("without 'view ratings' → handling a rating is refused", noPerm("view_ratings"), "POST", "ratings/ack", { id: ID.fb, acknowledged: true }, refused(403));
row("adding a person whose phone is already in the book returns that person, inserts nobody", {}, "POST", "khata/customers", { name: "Ravi again", phone: "981" }, (r, G) => r.status === 200 && r.json.existed === true && writes(G) === 0);
row("an invoice without the customer the restaurant requires → refused, and NO number is drawn", {}, "POST", `sessions/${ID.sess}/invoice`, {}, refused(400, /mobile number and name/));
row("without 'edit the menu' → a dish save is refused at the tab gate", noPerm("edit_menu"), "POST", "items", { id: "dal", title: "x" }, refused(403, /menu editor/));
row("without 'print here' → the counter claims nothing", noPerm("print_here"), "POST", "print-jobs/claim", { ids: [ID.job] },
  (r) => r.status === 200 && r.json && r.json.won.length === 0 && r.json.refused === "not_allowed");
// ── the database failing on purpose ─────────────────────────────────────────────────────────
row("orders unreachable → Accept answers in a plain sentence, writes nothing", fail({ "orders:select": "throw" }), "POST", `orders/${ID.order2}/accept`, {}, (r, G) => r.status >= 500 && writes(G) === 0);
row("orders read errors → a discount is refused in a sentence", fail({ "orders:select": "error" }), "POST", `orders/${ID.order}/discount`, { amount: 10 }, (r, G) => r.status >= 500 && writes(G) === 0);
row("sessions unreachable → generating an invoice is refused in a sentence and draws no number", fail({ "sessions:select": "throw" }), "POST", `sessions/${ID.sess}/invoice`, {}, (r, G) => r.status >= 500 && !G.RPCS.some((c) => c.name === "lfh_generate_invoice"));
row("dishes unreachable → removing a dish is refused in a sentence, the delete never runs", fail({ "order_items:select": "throw" }), "POST", `items/${ID.item}/delete`, {}, (r, G) => r.status >= 500 && !G.RPCS.some((c) => c.name === "lfh_delete_order_item"));
row("the order function errors → a new order is refused in a sentence", fail({ "rpc:lfh_staff_place_order": "error" }), "POST", "order", { table: "4", items: [{ id: "dal", qty: 1 }] }, (r) => r.status >= 500);
row("the invoice function unreachable → a plain sentence, not a crash", fail({ "rpc:lfh_generate_invoice": "throw" }), "POST", `sessions/${ID.sess}/invoice`, { cust_phone: "9876543210", cust_name: "A" }, (r) => r.status >= 500);
row("the change-table function errors → refused in a sentence", fail({ "rpc:lfh_staff_shift_table": "error" }), "POST", `sessions/${ID.sess}/shift`, { to: "7" }, (r) => r.status >= 500);
// ── a row that has gone ─────────────────────────────────────────────────────────────────────
row("auto-approve on a table that has closed → 404, nothing saved", {}, "POST", "sessions/00000000-0000-4000-8000-000000000999/auto-approve", { value: true }, refused(404, /has closed/));
row("answering a join request that is gone → 404", {}, "POST", "requests/00000000-0000-4000-8000-000000000999/resolve", { status: "approved" }, (r) => r.status === 404);
row("ticking off a waiter call that is gone → 404", {}, "PATCH", "calls/00000000-0000-4000-8000-000000000999", { resolved: true }, (r) => r.status === 404);
row("parking a bill on a person not in this book → 404", { mut: (G) => { G.FIX.orders = G.FIX.orders.filter((o) => o.id === ID.order); G.FIX.orders[0].status = "served"; } }, "POST", "tables/4/khata", { customer_id: ID.k_r2 }, refused(404, /khata book/));
row("advancing a delivery order that is not this restaurant's → 404", {}, "POST", `platform/${ID.p_r2}/status`, { status: "accepted" }, refused(404));
row("noting a bill printed for a session that is not this restaurant's → 404", {}, "POST", `sessions/${ID.s_r2}/bill-printed`, {}, refused(404));
row("reprinting a KOT that is gone → 404", {}, "POST", "print-jobs", { order_id: "00000000-0000-4000-8000-000000000999" }, refused(404));
row("reprinting a cancelled KOT → refused, nothing queued", {}, "POST", "print-jobs", { order_id: ID.cancelled }, refused(400, /cancelled/));
row("changing the quantity of a dish that is gone → 404", {}, "POST", "items/00000000-0000-4000-8000-000000000999/qty", { qty: 2 }, refused(404));
row("adding a dish to a ticket that is gone → 404", {}, "POST", "orders/00000000-0000-4000-8000-000000000999/add-item", { dishId: "dal" }, refused(404));
row("changing the note of a dish that is gone → 404", {}, "POST", "items/00000000-0000-4000-8000-000000000999/note", { note: "x" }, refused(404));
row("a credit note on a session that is not this restaurant's → 404", { perms: ALL_PERMS }, "POST", `sessions/${ID.s_r2}/credit-note`, { amount: 5, reason: "x" }, refused(404));
// ── an input that is wrong ──────────────────────────────────────────────────────────────────
row("quantity 0 → refused", {}, "POST", `items/${ID.item}/qty`, { qty: 0 }, refused(400, /invalid quantity/));
row("open a table called 'abc' → refused", {}, "POST", "sessions/open", { table: "abc" }, refused(400));
row("change table to 'x' → refused", {}, "POST", `sessions/${ID.sess}/shift`, { to: "x" }, refused(400, /valid table/));
row("PATCH an order to status 'bogus' → refused", {}, "PATCH", `orders/${ID.order}`, { status: "bogus" }, refused(400, /invalid status/));
row("a dish status of 'cancelled' → refused (cancel is the order's PATCH)", {}, "POST", `items/${ID.item}/status`, { status: "cancelled" }, refused(400));
row("an order for table 999 of a 20-table floor → refused, naming the real count", {}, "POST", "order", { table: "999", items: [{ id: "dal", qty: 1 }] }, refused(400, /has 20 tables/));
row("an order with no dishes → refused", {}, "POST", "order", { table: "4", items: [] }, refused(400, /items required/));
row("a banquet order for table 'x' → refused", {}, "POST", "banquet/place", { table: "x", lines: [{ id: ID.bq, qty: 1 }] }, refused(400));
row("a table type of 'gold' → refused", {}, "POST", "tables/4/tag", { tag: "gold" }, refused(400, /invalid tag/));
row("the owner sending guest feature switches → refused, they are the admin's", { who: "owner", label: "owner" }, "POST", "settings", { features: { ar: true } }, refused(403, /Guest features/));
row("a dish price of '12.5.5' → refused", { who: "owner", label: "owner" }, "POST", "items", { id: "dal", price: "12.5.5" }, refused(400, /valid price/));
row("creating a category whose name already exists → refused, the old one kept", {}, "POST", "categories", { __create: true, slug: "mains", name: { en: "Mains" } }, refused(409, /already exists/));
row("a missing id arriving as 'undefined' → refused before any query", {}, "POST", "orders/undefined/accept", {}, refused(400, /Missing id/));
row("PATCH an order 'null' → refused before any query", {}, "PATCH", "orders/null", { status: "served" }, refused(400, /Missing id/));
row("DELETE a dish 'undefined' → refused before any query", {}, "DELETE", "items/undefined", null, refused(400, /Missing id/));
row("recording a removal of an unknown kind → refused", {}, "POST", "audit", { kind: "everything" }, refused(400, /unknown removal kind/));
row("'was the food made?' answered 'yes' (not true/false) → refused", {}, "POST", "audit/classify", { order_id: ID.cancelled, made: "yes" }, refused(400));
