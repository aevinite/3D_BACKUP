// scripts/sweep/t13s10/new-f-route-deep.mjs — sweep #10 T13 ROUND 2, block F: the second half of the
// waiter route's unexecuted arms (dish edits, settling, capture, points, tags, comps, khata, unpay,
// close/open, every GET endpoint's quieter answers, and the shared helpers). Same rules as block E.
import { check, world, call, RID, RID2 } from "./lib.mjs";

let n = 182675;
const id = () => `P${n++}`;
const F = "app/api/tablet/[...path]/route.ts";
const S = "STUB — the real tablet route, in memory";
const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3600e3).toISOString();
const MODS = { take_orders_allowed: true, table_ops_allowed: true, table_tags_allowed: true, khata_allowed: true, banquet_allowed: true };
const base = () => ({
  sessions: [{ id: "s1", restaurant_id: RID, table_number: "3", status: "open", discount: 0, invoice_no: null, last_activity_at: NOW }],
  orders: [{ id: "o1", restaurant_id: RID, table_number: "3", session_id: "s1", status: "served", payment_status: "pending", archived: false, subtotal: 400, taxable_base: 400, total: 420, discount: 0, kot_no: 7, created_at: OLD, items: [{ id: "d1", status: "received" }], allergies: ["nuts"] }],
  order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "preparing", qty: 2, unit_price: 200, title: "Pasta", removed: ["onion"], added_allergens: [], removed_flag: false }],
  table_tags: [{ restaurant_id: RID, table_number: "3", tag: "family" }],
  khata_customers: [], staff_users: [], table_merges: [], session_payments: [],
});
const merge = (a, b) => ({ ...a, ...(b || {}) });
function sc(what, verb, path, body, o, expect) {
  check(id(), F, what, S, async () => {
    const G = await world({ who: o.who, user: o.user, fix: merge(base(), o.fix), settings: { ...MODS, ...(o.settings || {}) }, ents: o.ents ?? { customers: true },
      accessConfig: o.accessConfig, rpc: o.rpc, rpcImpl: o.rpcImpl, fail: o.fail, failNth: o.failNth });
    if (o.prep) o.prep(G);
    const r = await call(verb, path, { body, query: o.query, headers: o.headers, cookie: o.cookie });
    return expect(r, G);
  });
}
const P = (what, path, body, o, e) => sc(what, "POST", path, body, o, e);
const Q = (what, path, query, o, e) => sc(what, "GET", path, undefined, { ...o, query }, e);
const st = (want, re) => (r) => ({ ok: r.status === want && (!re || re.test(r.text)), note: `${r.status} ${(r.json && (r.json.error || "")).slice(0, 70)}` });
const rpc = (G, name) => G.RPCS.find((x) => x.name === name);
const live = (o) => merge(base().orders[0], o);

// ── dish status / accept / serve-all / allergies ───────────────────────────────────────────────
P("dish status: an unknown status is refused", "items/i1/status", { status: "eaten" }, {}, st(400, /invalid status/));
P("dish status: a dish with no ticket is still moved (nothing to roll up)", "items/i9/status", { status: "served" }, { fix: { order_items: [{ id: "i9", restaurant_id: RID, order_id: null, session_id: "s1", status: "preparing" }] } }, (r, G) => r.status === 200 && G.FIX.order_items[0].status === "served");
P("dish status: every dish back to received rolls the ticket back to received", "items/i1/status", { status: "received" }, { fix: { orders: [live({ status: "preparing" })] } }, (r, G) => G.FIX.orders[0].status === "received");
P("dish status: is logged with the new status", "items/i1/status", { status: "served" }, {}, (r, G) => G.LOGS.some((l) => l.action === "item_status" && l.detail === "served"));
P("accept: a ticket that is gone → 404", "orders/zz/accept", {}, {}, st(404));
P("accept: dishes not yet served go to preparing; served ones stay served", "orders/o1/accept", {}, { fix: { orders: [live({ status: "received", items: [{ id: "a", status: "served" }, { id: "b", status: "received" }] })] } }, (r, G) => { const it = G.FIX.orders[0].items; return it[0].status === "served" && it[1].status === "preparing" && G.FIX.orders[0].status === "preparing"; });
P("accept: a ticket with no dish list still accepts (empty list, no crash)", "orders/o1/accept", {}, { fix: { orders: [live({ status: "received", items: null })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].status === "preparing");
P("serve-all: a ticket that is gone → 404", "orders/zz/serve-all", {}, {}, st(404));
P("serve-all: every dish served, the ticket served, served_at stamped, logged", "orders/o1/serve-all", {}, { fix: { orders: [live({ status: "preparing" })] } }, (r, G) => G.FIX.orders[0].status === "served" && G.FIX.order_items[0].status === "served" && !!G.FIX.order_items[0].served_at && G.LOGS.some((l) => l.action === "order_serve"));
P("serve-all: a ticket with no dish list still serves", "orders/o1/serve-all", {}, { fix: { orders: [live({ status: "preparing", items: undefined })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].status === "served");
P("allergies: a ticket that is gone → 404", "orders/zz/allergies", { allergies: [], reason: "x" }, {}, st(404));
P("allergies: adding one with a reason marks the dishes and stamps the ticket edited", "orders/o1/allergies", { allergies: ["nuts", "dairy"], reason: "guest told us" }, {}, (r, G) => r.status === 200 && G.FIX.orders[0].allergies.includes("dairy") && !!G.FIX.orders[0].edited_at && G.LOGS.some((l) => l.action === "order_allergies" && /added dairy/.test(l.detail)));
P("allergies: removing one with a reason logs 'removed …'", "orders/o1/allergies", { allergies: [], reason: "mistake" }, {}, (r, G) => G.LOGS.some((l) => l.action === "order_allergies" && /removed nuts/.test(l.detail)));
P("allergies: the same list again needs no reason and logs the list", "orders/o1/allergies", { allergies: ["NUTS"] }, {}, (r, G) => r.status === 200 && G.LOGS.some((l) => l.action === "order_allergies" && l.detail === "nuts"));
P("allergies: an empty list on an empty ticket logs '(none)'", "orders/o1/allergies", {}, { fix: { orders: [live({ allergies: null })] } }, (r, G) => G.LOGS.some((l) => l.detail === "(none)"));
P("allergies: deduped, lower-cased, blanks dropped, capped at 20", "orders/o1/allergies", { allergies: [...Array.from({ length: 30 }, (_, i) => `A${i}`), " ", "a1"], reason: "x" }, {}, (r, G) => G.FIX.orders[0].allergies.length === 20 && G.FIX.orders[0].allergies.every((a) => a === a.toLowerCase()));
// ── dish delete / qty / note / removed / add-item / cancel ─────────────────────────────────────
P("dish delete: already gone → 404", "items/zz/delete", {}, {}, st(404, /already removed/));
P("dish delete: a PAID ticket is refused (409)", "items/i1/delete", {}, { rpc: { lfh_delete_order_item: { ok: false, reason: "order_paid" } } }, st(409, /PAID bill/));
P("dish delete: 'item_not_found' from the database reads 'already removed' (400)", "items/i1/delete", {}, { rpc: { lfh_delete_order_item: { ok: false, reason: "item_not_found" } } }, st(400, /already removed/));
P("dish delete: any other refusal is passed through as words", "items/i1/delete", {}, { rpc: { lfh_delete_order_item: { ok: false, reason: "busy kitchen" } } }, st(400, /busy kitchen/));
P("dish delete: a refusal with no reason still says something", "items/i1/delete", {}, { rpc: { lfh_delete_order_item: { ok: false } } }, st(400, /could not delete/));
P("dish delete: the remover failing is a server error", "items/i1/delete", {}, { fail: { "rpc:lfh_delete_order_item": "error" } }, (r) => r.status >= 500);
P("dish delete: success writes dish_removed (title, qty, amount) and stamps the ticket edited", "items/i1/delete", { reason: "wrong dish" }, { rpc: { lfh_delete_order_item: { ok: true, order_id: "o1", items_left: 0, order_cancelled: true } } }, (r, G) => { const a = rpc(G, "lfh_record_removal")?.args; return { ok: a?.p_kind === "dish_removed" && a?.p_item_title === "Pasta" && a?.p_amount === 400 && !!G.FIX.orders[0].edited_at && G.LOGS.some((l) => /order emptied → cancelled/.test(l.detail)), note: JSON.stringify(a && { k: a.p_kind, amt: a.p_amount }) }; });
P("qty: not a number → refused", "items/i1/qty", { qty: "lots" }, {}, st(400, /invalid quantity/));
P("qty: zero → refused", "items/i1/qty", { qty: 0 }, {}, st(400));
P("qty: a dish that is gone → 404", "items/zz/qty", { qty: 1 }, {}, st(404));
P("qty: the editor's refusal reads as words (sold out)", "items/i1/qty", { qty: 3 }, { rpc: { lfh_staff_edit_item_qty: { ok: false, reason: "sold_out" } } }, st(400, /sold out/));
P("qty: a PAID ticket → 409", "items/i1/qty", { qty: 3 }, { rpc: { lfh_staff_edit_item_qty: { ok: false, reason: "order_paid" } } }, st(409));
P("qty: the editor failing is a server error", "items/i1/qty", { qty: 3 }, { fail: { "rpc:lfh_staff_edit_item_qty": "error" } }, (r) => r.status >= 500);
P("qty: lowering 2 → 1 writes qty_reduced worth one dish", "items/i1/qty", { qty: 1 }, { rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: "o1", qty: 1 } } }, (r, G) => { const a = rpc(G, "lfh_record_removal")?.args; return a?.p_kind === "qty_reduced" && a?.p_qty === 1 && a?.p_amount === 200; });
P("qty: raising 2 → 3 writes no removal (it adds money)", "items/i1/qty", { qty: 3 }, { rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: "o1", qty: 3 } } }, (r, G) => r.status === 200 && !rpc(G, "lfh_record_removal") && !!G.FIX.orders[0].edited_at);
for (const [reason, re] of [["order_cancelled", /cancelled/], ["item_not_found", /no longer on the order/], ["order_not_found", /no longer exists/], ["unknown_item", /isn't on the menu/], ["empty_order", /Nothing to add/], ["price_required", /needs a price/], ["odd", /odd/], [undefined, /Couldn't edit the order/]])
  P(`note: the editor's '${reason ?? "(no reason)"}' refusal reads as words`, "items/i1/note", { note: "x" }, { rpc: { lfh_staff_edit_item_note: { ok: false, reason } } }, st(400, re));
P("note: a dish that is gone → 404", "items/zz/note", { note: "x" }, {}, st(404));
P("note: the editor failing is a server error", "items/i1/note", { note: "x" }, { fail: { "rpc:lfh_staff_edit_item_note": "error" } }, (r) => r.status >= 500);
P("note: on a SETTLED bill it is allowed and recorded as bill_annotated", "items/i1/note", { note: "less spicy", reason: "guest" }, { rpc: { lfh_staff_edit_item_note: { ok: true, order_id: "o1", settled: true, note: "less spicy" } } }, (r, G) => rpc(G, "lfh_record_removal")?.args.p_kind === "bill_annotated");
P("note: on an open bill no Audit row, but the ticket is stamped edited", "items/i1/note", { note: "x" }, { rpc: { lfh_staff_edit_item_note: { ok: true, order_id: "o1" } } }, (r, G) => !rpc(G, "lfh_record_removal") && !!G.FIX.orders[0].edited_at);
P("removed: a dish that is gone → 400 in words", "items/zz/removed", { removed: [] }, {}, st(400, /no longer on the order/));
P("removed: a PAID ticket → 409", "items/i1/removed", { removed: ["garlic"], reason: "x" }, { fix: { orders: [live({ payment_status: "paid" })] } }, st(409));
P("removed: a CANCELLED ticket → refused", "items/i1/removed", { removed: ["garlic"], reason: "x" }, { fix: { orders: [live({ status: "cancelled" })] } }, st(400, /cancelled/));
P("removed: a change with no reason is refused", "items/i1/removed", { removed: ["garlic"] }, {}, st(400, /Say why/));
P("removed: adding 'garlic' marks it ＋ and logs the reason", "items/i1/removed", { removed: ["onion", "garlic"], reason: "allergy" }, {}, (r, G) => { const it = G.FIX.order_items[0]; return it.added_allergens.includes("garlic") && G.LOGS.some((l) => /added garlic; — allergy/.test(l.detail)); });
P("removed: taking off an original 'onion' sets the ✎− flag", "items/i1/removed", { removed: [], reason: "fixed" }, {}, (r, G) => G.FIX.order_items[0].removed_flag === true);
P("removed: taking back a just-added mark clears it (no ✎− flag)", "items/i1/removed", { removed: ["onion"], reason: "undo" }, { fix: { order_items: [merge(base().order_items[0], { removed: ["onion", "garlic"], added_allergens: ["garlic"] })] } }, (r, G) => !G.FIX.order_items[0].added_allergens.includes("garlic") && G.FIX.order_items[0].removed_flag === false);
P("removed: the same list again is 'no change' and needs no reason", "items/i1/removed", { removed: ["ONION"] }, {}, (r, G) => r.status === 200 && G.LOGS.some((l) => l.detail === "no change"));
P("add-item: no dish named → refused", "orders/o1/add-item", {}, {}, st(400, /dish required/));
P("add-item: a ticket that is gone → 404", "orders/zz/add-item", { dishId: "d1" }, {}, st(404));
P("add-item: the adder's refusal reads as words; a PAID ticket is 409", "orders/o1/add-item", { dishId: "d1" }, { rpc: { lfh_staff_add_item_to_order: { ok: false, reason: "order_paid" } } }, st(409));
P("add-item: the adder failing is a server error", "orders/o1/add-item", { dishId: "d1" }, { fail: { "rpc:lfh_staff_add_item_to_order": "error" } }, (r) => r.status >= 500);
P("add-item: on an accepted ticket the new dish goes straight to preparing", "orders/o1/add-item", { dishId: "d1", qty: 2, price: 50, options: [{ group: "S", label: "L" }], removed: ["salt"], note: "hot" }, { fix: { orders: [live({ status: "preparing", items: [{ id: "x", status: "received" }] })] } }, (r, G) => { const line = rpc(G, "lfh_staff_add_item_to_order")?.args.p_items[0]; return line?.qty === 2 && line?.price === "50" && line?.note === "hot" && G.FIX.orders[0].items[0].status === "preparing"; });
P("add-item: on a ticket still waiting to be accepted, nothing is pushed to the kitchen", "orders/o1/add-item", { id: "d1" }, { fix: { orders: [live({ status: "received", items: [{ id: "x", status: "received" }] })] } }, (r, G) => G.FIX.orders[0].items[0].status === "received");
P("cancel (Delete order): a ticket that is gone → 404", "orders/zz/delete", {}, {}, st(404));
P("cancel: a ticket with no table still cancels and records no table", "orders/o1/delete", {}, { fix: { orders: [live({ status: "preparing", table_number: null, session_id: null })] } }, (r, G) => r.status === 200 && rpc(G, "lfh_record_removal")?.args.p_table === null);
// ── settling ────────────────────────────────────────────────────────────────────────────────────
P("pay: a table that is not digits → refused", "tables/x/pay", {}, {}, st(400));
P("pay: with sessions off, a received ticket on the table still blocks settling", "tables/3/pay", { payment_method: "Cash" }, { fix: { sessions: [], orders: [live({ status: "received", session_id: null })] } }, st(409, /Accept the order first/));
P("pay: with sessions off, settles the table's live tickets by number", "tables/3/pay", { payment_method: "UPI", payment_note: "ref 123" }, { fix: { sessions: [], orders: [live({ session_id: null })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].payment_status === "paid" && G.FIX.orders[0].payment_method === "UPI" && G.FIX.orders[0].payment_note === "ref 123");
P("pay: no payment method given buckets as 'not recorded' (no method written)", "tables/3/pay", {}, {}, (r, G) => r.status === 200 && G.FIX.orders[0].payment_status === "paid" && G.FIX.orders[0].payment_method === undefined);
P("pay: a merged child settles the PARTY's bill on the parent table", "tables/5/pay", { payment_method: "Cash" }, { fix: { table_merges: [{ restaurant_id: RID, parent_table: "3", child_table: "5", ended_at: null }] } }, (r, G) => r.status === 200 && G.FIX.orders[0].payment_status === "paid");
P("pay with splits: the parts are checked for shape first", "tables/3/pay", { splits: [{ method: "Cash" }] }, {}, (r) => ({ ok: r.status === 400, note: `${r.status} ${r.text.slice(0, 70)}` }));
P("pay with splits: also needs the Table & KOT switch (off → refused)", "tables/3/pay", { splits: [{ method: "Cash", amount: 420 }] }, { settings: { tablet_table_ops: "off" } }, (r) => r.status === 403);
P("pay with a pay-later part: needs the khata module (off → refused)", "tables/3/pay", { splits: [{ method: "Pay later", amount: 420, customer: { name: "R" } }] }, { settings: { khata_allowed: false } }, (r) => ({ ok: r.status === 403 || r.status === 400, note: `${r.status} ${r.text.slice(0, 60)}` }));
P("pay-split: a table that is not digits → refused", "tables/x/pay-split", { splits: [] }, {}, st(400));
P("pay-split: a pay-later part needs the waiter's khata power (off → refused)", "tables/3/pay-split", { splits: [{ method: "Pay later", amount: 420 }] }, { settings: { tablet_khata: "off" } }, (r) => r.status === 403);
P("pay-split: parts that don't add up are refused by the shared money path", "tables/3/pay-split", { splits: [{ method: "Cash", amount: 1 }] }, {}, (r) => ({ ok: r.status >= 400 && r.status < 500, note: `${r.status} ${r.text.slice(0, 70)}` }));
P("pay-split: parts that add up settle the bill and log bill_split", "tables/3/pay-split", { splits: [{ method: "Cash", amount: 200 }, { method: "UPI", amount: 220 }] }, {}, (r, G) => ({ ok: r.status === 200 && G.LOGS.some((l) => l.action === "bill_split"), note: `${r.status} ${r.text.slice(0, 80)}` }));
// ── customer capture / loyalty ──────────────────────────────────────────────────────────────────
P("capture: a table that is not digits → refused", "tables/x/customer-capture", {}, {}, st(400));
P("capture: the customer directory off → refused", "tables/3/customer-capture", { phone: "9876543210" }, { ents: { customers: false } }, (r) => r.status === 403);
P("capture: a database error says the BILL is fine, never Postgres", "tables/3/customer-capture", { phone: "9876543210", consent: true }, { fail: { "rpc:lfh_capture_customer": "error" } }, st(500, /the bill itself is fine/));
P("capture: saved → logged, and the visit is booked to THIS party's session", "tables/3/customer-capture", { phone: "9876543210", name: "Asha", consent: true }, { rpc: { lfh_capture_customer: { ok: true } } }, (r, G) => { const a = rpc(G, "lfh_capture_customer")?.args; return { ok: a?.p_session === "s1" && a?.p_consent === true && G.LOGS.some((l) => l.action === "customer_saved"), note: JSON.stringify(a) }; });
P("capture: without consent nothing is logged as saved", "tables/3/customer-capture", { phone: "9876543210" }, { rpc: { lfh_capture_customer: { ok: false } } }, (r, G) => r.status === 200 && !G.LOGS.some((l) => l.action === "customer_saved") && r.json.loyalty === null);
P("capture: an over-long phone and name are cut (20 / 80)", "tables/3/customer-capture", { phone: "9".repeat(40), name: "n".repeat(200), consent: true }, {}, (r, G) => { const a = rpc(G, "lfh_capture_customer")?.args; return a?.p_phone.length === 20 && a?.p_name.length === 80; });
P("loyalty balance: a table that is not digits → refused", "tables/x/loyalty", {}, {}, st(400));
P("loyalty balance: directory off → refused", "tables/3/loyalty", { phone: "9876543210" }, { ents: { customers: false } }, (r) => r.status === 403);
P("loyalty balance: no phone → { on:false } without asking anything", "tables/3/loyalty", {}, {}, (r) => r.status === 200 && r.json.on === false);
P("loyalty balance: module off → { on:false } (billing exactly as it is)", "tables/3/loyalty", { phone: "9876543210" }, {}, (r) => ({ ok: r.status === 200 && r.json.on === false, note: r.text }));
P("points: a table that is not digits → refused", "tables/x/loyalty-redeem", {}, {}, st(400));
P("points: directory off → refused", "tables/3/loyalty-redeem", { phone: "9" }, { ents: { customers: false } }, (r) => r.status === 403);
P("points: needs the discount permission (off → refused)", "tables/3/loyalty-redeem", { phone: "9876543210", points: 5 }, { settings: { tablet_discount: "off" } }, (r) => r.status === 403);
P("points: a refusal from the points book reads as words", "tables/3/loyalty-redeem", { phone: "9876543210", points: 5 }, {}, (r) => ({ ok: r.status === 400 && !!r.json?.error, note: r.text.slice(0, 80) }));
// ── tags / comps / khata / unpay ────────────────────────────────────────────────────────────────
P("tag: a table that is not digits → refused", "tables/x/tag", { tag: "vip" }, {}, st(400));
P("tag: marking VIP stores it with who marked it, and logs it", "tables/4/tag", { tag: "vip" }, {}, (r, G) => G.FIX.table_tags.some((t) => t.table_number === "4" && t.tag === "vip" && t.tagged_by === "Diag Waiter") && G.LOGS.some((l) => l.action === "table_tag_set"));
P("tag: an absent tag clears the mark", "tables/3/tag", {}, {}, (r, G) => r.status === 200 && r.json.tag === "" && !G.FIX.table_tags.some((t) => t.table_number === "3"));
P("comp: a table that is not digits → refused", "tables/x/on-the-house", {}, {}, st(400));
P("comp: the mark may sit on a JOINED child of the party", "tables/3/on-the-house", {}, { fix: { table_tags: [{ restaurant_id: RID, table_number: "5", tag: "guest" }], table_merges: [{ restaurant_id: RID, parent_table: "3", child_table: "5", ended_at: null }] } }, (r, G) => r.status === 200 && G.FIX.orders[0].payment_status === "paid");
P("comp: nothing unpaid → refused (409)", "tables/3/on-the-house", {}, { fix: { orders: [live({ payment_status: "paid" })] } }, st(409, /Nothing to settle/));
P("comp: a ticket still waiting to be accepted → refused", "tables/3/on-the-house", {}, { fix: { orders: [live({ status: "received" })] } }, st(409, /Accept the order first/));
P("comp: with sessions off, comps the table's live tickets by number", "tables/3/on-the-house", {}, { fix: { sessions: [], orders: [live({ session_id: null })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].payment_method === "On the house");
P("khata: a table that is not digits → refused", "tables/x/khata", {}, {}, st(400));
P("khata: nothing unpaid → refused", "tables/3/khata", { name: "R" }, { fix: { orders: [live({ payment_status: "paid" })] } }, st(409, /Nothing unpaid/));
P("khata: parking onto a known person (by id) closes the table", "tables/3/khata", { customer_id: "k1" }, { fix: { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", phone: "1" }] } }, (r, G) => r.status === 200 && G.FIX.orders[0].khata_customer_id === "k1" && G.FIX.orders[0].archived === true);
P("khata: a phone that is already in the book reuses that person (no duplicate)", "tables/3/khata", { name: "Ravi B", phone: "1" }, { fix: { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", phone: "1" }] } }, (r, G) => G.FIX.khata_customers.length === 1 && G.FIX.orders[0].khata_customer_id === "k1");
P("khata: a new person is added to the book, name and note cut", "tables/3/khata", { name: "n".repeat(100), note: "z".repeat(300) }, {}, (r, G) => G.FIX.khata_customers.length === 1 && G.FIX.khata_customers[0].name.length === 80 && G.FIX.khata_customers[0].note.length === 200);
P("khata: adding the person failing says so in words (500), never Postgres", "tables/3/khata", { name: "Ravi" }, { fail: { "khata_customers:insert": "error" } }, st(500, /Couldn't add that person/));
P("khata: with sessions off, the table's signals are cleared instead of a close", "tables/3/khata", { name: "Ravi" }, { fix: { sessions: [], orders: [live({ session_id: null })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].archived === true);
P("unpay: a table that is not digits → refused", "tables/x/unpay", {}, {}, st(400));
P("unpay: a table with no open party → refused, pointing at the manager panel", "tables/3/unpay", {}, { fix: { sessions: [] } }, st(409, /reopen it from the manager panel/));
P("unpay: an 'On the house' settle is reverted AND its 100% discount stripped", "tables/3/unpay", { reason: "wrong table" }, { fix: { orders: [live({ payment_status: "paid", paid_at: NOW, payment_method: "On the house", discount: 400 })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].discount === 0 && G.FIX.orders[0].payment_status === "pending" && G.LOGS.some((l) => l.action === "payment_revert" && /unpaid: wrong table/.test(l.detail)));
P("unpay: one Audit row per order reverted, with the old method", "tables/3/unpay", {}, { fix: { orders: [live({ payment_status: "paid", paid_at: NOW, payment_method: "Card" })] } }, (r, G) => rpc(G, "lfh_record_removal")?.args.p_kind === "payment_reverted");
P("unpay: the visit and the points the settle booked are reversed for THIS party", "tables/3/unpay", {}, { fix: { orders: [live({ payment_status: "paid", paid_at: NOW, payment_method: "Cash" })] } }, (r, G) => rpc(G, "lfh_uncapture_customer")?.args.p_session === "s1");
// ── close / open ────────────────────────────────────────────────────────────────────────────────
P("close: a table with nothing owed closes without any gate", "sessions/s1/close", {}, { fix: { orders: [live({ payment_status: "paid" })] } }, (r, G) => ({ ok: r.status === 200, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("close: an unpaid table without force is refused by the shared close rule", "sessions/s1/close", {}, {}, (r) => ({ ok: r.status >= 400 && r.status < 500, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("close force: the walk-out switch on 'on' for this waiter closes it", "sessions/s1/close", { force: true }, { user: { permissions: { "cap:close_unpaid": "on" } } }, (r) => ({ ok: r.status === 200, note: `${r.status}` }));
P("close force: this waiter's own 'off' refuses even if the restaurant allows", "sessions/s1/close", { force: true }, { user: { permissions: { "cap:close_unpaid": "off" } }, accessConfig: { close_unpaid: { tablet: "on" } } }, st(403, /isn't enabled on the tablet/));
P("close force: the restaurant's 'on' lets it through", "sessions/s1/close", { force: true }, { accessConfig: { close_unpaid: { tablet: "on" } } }, (r) => r.status === 200);
P("close force: the admin is never stopped by the walk-out switch", "sessions/s1/close", { force: true }, { who: "admin", query: `?rid=${RID}`, accessConfig: { close_unpaid: { tablet: "off" } } }, (r) => r.status === 200);
P("open: a table that is not digits → refused", "sessions/open", { table: "x" }, {}, st(400));
P("open: a free table opens and is logged", "sessions/open", { table: "6" }, {}, (r, G) => r.status === 200 && G.FIX.sessions.some((s) => s.table_number === "6") && G.LOGS.some((l) => l.action === "table_open" && l.table_number === "6"));
// ── GET endpoints' quieter answers ──────────────────────────────────────────────────────────────
Q("customer-recognize: a phone is looked up for THIS restaurant", "customer-recognize", "?phone=%2098765%20", { rpc: { lfh_recognize_customer: { known: true, name: "Asha", visits: 3 } } }, (r, G) => r.json.known === true && rpc(G, "lfh_recognize_customer")?.args.p_restaurant_id === RID && rpc(G, "lfh_recognize_customer")?.args.p_phone === "98765");
Q("customer-recognize: the lookup answering nothing is 'not known'", "customer-recognize", "?phone=98765", { rpc: { lfh_recognize_customer: null } }, (r) => r.json.known === false);
Q("customer-recognize: the lookup failing is a server error, not 'not known'", "customer-recognize", "?phone=98765", { fail: { "rpc:lfh_recognize_customer": "error" } }, (r) => r.status >= 500);
Q("customer-search: three digits ask for at most six, for THIS restaurant", "customer-search", "?q=987", { rpc: { lfh_customer_phone_search: [{ phone: "9876" }] } }, (r, G) => r.json.matches.length === 1 && rpc(G, "lfh_customer_phone_search")?.args.p_limit === 6);
Q("customer-search: a non-list answer is an empty list, not a crash", "customer-search", "?q=987", { rpc: { lfh_customer_phone_search: { weird: 1 } } }, (r) => Array.isArray(r.json.matches) && r.json.matches.length === 0);
Q("customer-search: the search failing is a server error", "customer-search", "?q=987", { fail: { "rpc:lfh_customer_phone_search": "error" } }, (r) => r.status >= 500);
Q("menu-sig: digests the dishes and categories into 16 hex characters", "menu-sig", "", { fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: "Soup", price: 120, tags: ["veg"] }], categories: [{ slug: "soups", restaurant_id: RID, name: { en: "Soups" }, sort_order: 1, active: true }] } }, (r) => /^[0-9a-f]{16}$/.test(r.json.sig) && r.json.dishes === 1);
Q("menu-sig: a price change changes the digest", "menu-sig", "", { fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: "Soup", price: 125, tags: [] }] } }, async (r) => { const G2 = await world({ fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: "Soup", price: 120, tags: [] }] } }); const r2 = await call("GET", "menu-sig"); return r.json.sig !== r2.json.sig; });
Q("menu-sig: a dish read failing is a server error", "menu-sig", "", { fail: { "menu_items:select": "error" } }, (r) => r.status >= 500);
Q("summary: the floor answering nothing is an empty floor, not a crash", "summary", "?nomenu=1", { prep: async () => {}, rpc: { lfh_table_view_summary: null } }, async (r) => ({ ok: r.status === 200 && typeof r.json.tiles === "object", note: `${r.status}` }));
Q("summary: a restaurant row that is missing sends restaurant:null, not a crash", "summary", "?nomenu=1", { prep: (G) => { G.FIX.restaurants = G.FIX.restaurants.filter((x) => x.id !== RID); }, rpc: { lfh_table_view_summary: { tiles: {} } } }, (r) => r.status === 200 && r.json.restaurant === null);
Q("summary: a settings row that is missing sends settings:null", "summary", "?nomenu=1", { prep: (G) => { G.FIX.settings = G.FIX.settings.filter((x) => x.restaurant_id !== RID); }, rpc: { lfh_table_view_summary: { tiles: {} } } }, (r) => r.status === 200 && r.json.settings === null);
Q("summary: a failed restaurant read is a server error (logged), not a half payload", "summary", "?nomenu=1", { fail: { "restaurants:select": "error" }, rpc: { lfh_table_view_summary: { tiles: {} } } }, (r, G) => r.status >= 500 && G.ERRORS.some((e) => e.action === "route_error" && /GET summary/.test(e.detail)));
Q("state: a party's guests ride along, and its calls and requests", "state", "?table=3", { fix: { session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1", name: "A", removed: false }], waiter_calls: [{ id: "c1", restaurant_id: RID, table_number: "3", resolved: false }], requests: [{ id: "q1", restaurant_id: RID, table_number: "3", status: "pending" }] } }, (r) => r.json.members.length === 1 && r.json.calls.length === 1 && r.json.requests.length === 1);
Q("state: a table with no party sends no guests and asks for none", "state", "?table=9", {}, (r, G) => r.json.members.length === 0 && !G.SCOPE_LOG.some((q) => q.table === "session_members"));
Q("khata picker: a search nobody can run (symbols only) answers 'unsearchable', never the 8 newest", "khata/customers", "?q=%25%25", {}, (r) => ({ ok: r.status === 200 && r.json.unsearchable === true && r.json.customers.length === 0, note: r.text }));
Q("khata picker: the admin is not stopped by the waiter's switch", "khata/customers", `?q=ra&rid=${RID}`, { who: "admin", settings: { tablet_khata: "off" } }, (r) => r.status === 200);
Q("banquet list: the waiter's banquet switch off refuses", "banquet-items", "", { settings: { tablet_banquet: "off" } }, st(403, /off for the tablet/));
Q("banquet list: the admin sees it even with the switch off", "banquet-items", `?rid=${RID}`, { who: "admin", settings: { tablet_banquet: "off", banquet_allowed: false } }, (r) => r.status === 200);
// ── helpers and the preamble ────────────────────────────────────────────────────────────────────
P("a POST with no sign-in is refused (401) before anything is read", "orders/o1/tip", { amount: 1 }, { who: "nobody" }, (r, G) => r.status === 401 && G.SCOPE_LOG.length === 0);
P("a POST during a sign-in blip answers 503 (stay logged in, retry)", "orders/o1/tip", { amount: 1 }, { who: "blip" }, (r) => r.status === 503);
P("the admin with no restaurant chosen is told to open the panel from the console (400)", "orders/o1/tip", { amount: 1 }, { who: "admin" }, st(400, /No restaurant scope/));
P("an unknown POST from a manager looking in is 404 (no section gate for managers)", "nope", {}, { who: "manager" }, st(404));
P("a thrown failure inside a branch is logged to the Repair board and answered in words", "orders/o1/tip", { amount: 1 }, { fail: { "orders:update": "throw" } }, (r, G) => r.status >= 500 && G.ERRORS.some((e) => e.action === "route_error" && /POST orders\/o1\/tip/.test(e.detail)) && !/stub:/.test(r.text));
P("a refused VALUE (bad id syntax) reaching a write answers 400 in words, and is written to the Repair board", "orders/o1/tip", { amount: 1 }, { who: "manager", fail: { "orders:select": "refuse" } }, (r, G) => ({ ok: r.status === 400 && /isn't allowed here/.test(r.text) && G.ERRORS.length === 1, note: `${r.status} errors ${G.ERRORS.length}` }));
P("the admin's own console cookie passes a PIN gate with no PIN typed", "members/m1/ban", {}, { who: "manager", fix: { session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1", removed: false }], staff_users: [{ id: "mg", restaurant_id: RID, role: "manager", active: true, pin_hash: "plain:4321" }] }, prep: async () => { process.env.ADMIN_PASSWORD = "t13-stub-admin"; }, cookie: undefined }, async (r) => ({ ok: r.status === 403 && r.json.needPin === true, note: "without the console cookie a manager on the tablet is asked for the PIN like anyone" }));
Q("a device with no device id is never treated as blocked", "whoami", "", { headers: { "x-lfh-device": "" } }, (r) => r.status === 200);
Q("whoami for an owner looking in names the owner", "whoami", "", { who: "owner" }, (r) => r.json.actor === "owner" && r.json.higherView === false);
Q("whoami ?as= on a non-admin is ignored (only the admin may look through someone)", "whoami", "?as=w2", {}, (r) => r.json.asName === null);
