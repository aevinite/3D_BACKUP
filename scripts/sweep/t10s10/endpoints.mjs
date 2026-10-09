// scripts/sweep/t10s10/endpoints.mjs — every endpoint in MY half of the manager route, with a
// request that reaches its working path, and the fixture world that lets it get there.
//
// Read off the route by hand on 2026-10-09 (the customer-capture branch → end of file). A test
// that adds an endpoint here must also give it a body that reaches its writes — an endpoint that
// is refused before it does anything proves nothing about its scoping (see `reached` in new-a.mjs).
import { world } from "./lib.mjs";

const R1 = "rest-1", R2 = "rest-2";
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ID = {
  order: UUID(1), order2: UUID(2), cancelled: UUID(3), sess: UUID(4), item: UUID(5), member: UUID(6), req: UUID(7),
  call: UUID(8), plat: UUID(9), khata: UUID(10), fb: UUID(11), ban: UUID(12), job: UUID(13), ev: UUID(14),
  bq: UUID(15), closedSess: UUID(16), paid: UUID(17), solo: UUID(18),
  // the SAME shapes in the second restaurant — never touched by a request made as rest-1
  o_r2: UUID(101), s_r2: UUID(104), i_r2: UUID(105), m_r2: UUID(106), p_r2: UUID(109), k_r2: UUID(110),
};

/** A fully-granted French House manager. Every manager power the route asks about, on. */
export const ALL_PERMS = { void_bills: true, give_discounts: true, khata: true, table_tags: true, banquet: true, parcel: true,
  platform: true, print_clear: true, edit_menu: true, view_ratings: true, table_ops: true, take_orders: true, mark_paid: true,
  print_invoice: true, print_here: true, table_assign: true, view_logs: true };
const MODULES_ON = { table_tags_allowed: true, khata_allowed: true, banquet_allowed: true, table_ops_allowed: true,
  take_orders_allowed: true, parcel_allowed: true, platform_allowed: true, auto_print_kot: true, auto_print_kot_allowed: true,
  platform_channels: { zomato: { on: true } }, modules: { loyalty: { allowed: true } } };

function rows(rid, ids, table = "4") {
  const now = new Date(Date.now() - 2 * 60_000).toISOString();
  return {
    orders: [
      { id: ids.order, restaurant_id: rid, session_id: ids.sess, table_number: table, status: "preparing", payment_status: "pending", archived: false,
        subtotal: 400, taxable_base: 400, mrp_amount: 0, total: 420, tax: 20, discount: 0, items: [{ id: "d1", qty: 2, status: "preparing" }], created_at: now, kot_no: 7 },
      ...(ids.order2 ? [{ id: ids.order2, restaurant_id: rid, session_id: ids.sess, table_number: table, status: "received", payment_status: "pending", archived: false,
        subtotal: 200, taxable_base: 200, total: 210, items: [{ id: "d1", qty: 1, status: "received" }], created_at: now }] : []),
      ...(ids.cancelled ? [{ id: ids.cancelled, restaurant_id: rid, session_id: ids.sess, table_number: table, status: "cancelled", cancelled_at: now, payment_status: "pending", archived: false, items: [] }] : []),
      ...(ids.paid ? [{ id: ids.paid, restaurant_id: rid, session_id: ids.closedSess, table_number: "9", status: "served", payment_status: "paid", paid_at: now, archived: true, khata_at: now, khata_customer_id: ids.khata, total: 300, items: [] }] : []),
      ...(ids.solo ? [{ id: ids.solo, restaurant_id: rid, session_id: null, table_number: null, status: "served", payment_status: "pending", subtotal: 150, taxable_base: 150, total: 157.5, items: [] }] : []),
    ],
    sessions: [
      { id: ids.sess, restaurant_id: rid, table_number: table, status: "open", invoice_no: null, bill_no: 12, last_activity_at: now },
      ...(ids.closedSess ? [{ id: ids.closedSess, restaurant_id: rid, table_number: "9", status: "closed", invoice_no: "INV-1", invoice_voided: false, invoice_at: now, bill_no: 3 }] : []),
    ],
    order_items: [{ id: ids.item, restaurant_id: rid, order_id: ids.order, session_id: ids.sess, title: "Dal", qty: 2, unit_price: 200, status: "preparing", removed: [], added_allergens: [] }],
    session_members: [{ id: ids.member, restaurant_id: rid, session_id: ids.sess, role: "guest", approved: false, removed: false, device_id: "g-dev", phone: "900000" + (rid === R1 ? "1" : "2") }],
    requests: ids.req ? [{ id: ids.req, restaurant_id: rid, table_number: table, type: "join", status: "pending" }] : [],
    waiter_calls: ids.call ? [{ id: ids.call, restaurant_id: rid, table_number: table, resolved: false }] : [],
    aggregator_orders: [{ id: ids.plat, restaurant_id: rid, source: "zomato", external_id: "Z1", status: "new", total: 250, paid: false, printed_at: null }],
    khata_customers: [{ id: ids.khata, restaurant_id: rid, name: "Ravi", phone: "98" + (rid === R1 ? "1" : "2") }],
    feedback: ids.fb ? [{ id: ids.fb, restaurant_id: rid, rating: 4 }] : [],
    blocklist: ids.ban ? [{ id: ids.ban, restaurant_id: rid, phone: "9111" }] : [],
    print_jobs: ids.job ? [{ id: ids.job, restaurant_id: rid, kind: "kot", status: "queued", order_id: ids.order }] : [],
    printer_events: ids.ev ? [{ id: ids.ev, restaurant_id: rid, status: "open" }] : [],
    banquet_items: ids.bq ? [{ id: ids.bq, restaurant_id: rid, title: "Thali", price: 300, unit: "per plate", active: true }] : [],
    table_tags: [{ restaurant_id: rid, table_number: table, tag: "family" }],
    menu_items: [{ id: rid === R1 ? "dal" : "dal__r2", restaurant_id: rid, slug: "dal", title: "Dal", price: "200", image: "", category: "mains", tags: [], open_price: false }],
    categories: [{ slug: "mains", restaurant_id: rid, name: { en: "Mains" } }],
    filters: [{ slug: "veg", restaurant_id: rid, name: { en: "Veg" } }],
    table_merges: [], deletion_audit: [], customers: [], session_payments: [], staff_users: [],
  };
}

/** Two restaurants, every table populated in both. `extra` replaces whole tables for one test. */
export async function fullWorld(o = {}) {
  const a = rows(R1, ID);
  const b = rows(R2, { order: ID.o_r2, sess: ID.s_r2, item: ID.i_r2, member: ID.m_r2, plat: ID.p_r2, khata: ID.k_r2 });
  const fix = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) fix[k] = [...(a[k] || []), ...(b[k] || [])];
  Object.assign(fix, o.fix || {});
  return world({
    perms: o.perms || ALL_PERMS, who: o.who, user: o.user, accessConfig: o.accessConfig, ents: o.ents,
    settings: { ...MODULES_ON, ...(o.settings || {}) }, fix, rpc: o.rpc, rpcImpl: o.rpcImpl, fail: o.fail,
  });
}

// [verb, path, body, label]. The body is the one the panel sends, enough to reach the working path.
export const ENDPOINTS = [
  ["POST", "customer-capture", { table: "4", session: ID.sess, phone: "9876543210", name: "Asha", consent: true }, "save the guest at bill time"],
  ["POST", "loyalty", { table: "4", phone: "9876543210" }, "read a guest's points"],
  ["POST", "loyalty-redeem", { table: "4", phone: "9876543210", points: 10 }, "spend a guest's points"],
  ["POST", "issue", { subject: "Fridge warm", body: "since 6pm" }, "raise a complaint"],
  ["POST", "order", { table: "4", items: [{ id: "dal", qty: 1 }] }, "take a new order"],
  ["POST", "parcel", { items: [{ id: "dal", qty: 1 }], customer: "Asha", paid: true, method: "Cash" }, "a counter parcel"],
  ["POST", "ratings/ack", { id: ID.fb, acknowledged: true }, "handle a guest rating"],
  ["POST", "platform/test", { channel: "zomato" }, "simulate a delivery order"],
  ["POST", `platform/${ID.plat}/status`, { status: "accepted" }, "advance a delivery order"],
  ["POST", `platform/${ID.plat}/pay`, { method: "UPI" }, "collect a parcel at handover"],
  ["POST", `sessions/${ID.sess}/bill-printed`, {}, "note that a bill was printed"],
  ["POST", `platform/${ID.plat}/printed`, {}, "note that a parcel bill was printed"],
  ["POST", "banquet/item-save", { title: "Buffet", price: 450 }, "save a banquet line"],
  ["POST", "banquet/item-delete", { id: ID.bq }, "delete a banquet line"],
  ["POST", "banquet/place", { table: "4", lines: [{ id: ID.bq, qty: 10 }] }, "place a banquet order"],
  ["POST", "banquet/bill", { lines: [{ id: ID.bq, qty: 10 }], meta: {} }, "issue a banquet bill"],
  ["POST", "audit", { kind: "dish_removed", order_id: ID.order, reason_code: "mistake" }, "record why something was removed"],
  ["POST", "audit/classify", { order_id: ID.cancelled, made: true }, "answer 'was the food made?'"],
  ["POST", "orders/delete", { ids: [ID.order2], reason: "duplicate" }, "delete one bill (admin only)"],
  ["POST", `orders/${ID.order}/tip`, { amount: 50 }, "record a tip"],
  ["POST", `orders/${ID.order}/discount`, { amount: 40, note: "regular" }, "give a discount"],
  ["POST", `orders/${ID.order}/allergies`, { allergies: ["peanuts"], reason_note: "guest told us" }, "change the order's allergy line"],
  ["POST", `orders/${ID.order2}/accept`, {}, "accept a ticket"],
  ["POST", `orders/${ID.order}/serve-all`, {}, "serve a whole ticket"],
  ["POST", `orders/${ID.order}/item`, { index: 0, status: "served" }, "set one dish inside a ticket"],
  ["POST", "sessions/open", { table: "6" }, "open a table"],
  ["POST", `sessions/${ID.sess}/close`, { force: true }, "close a table"],
  ["POST", `sessions/${ID.sess}/auto-approve`, { value: true }, "auto-approve joiners"],
  ["POST", `sessions/${ID.sess}/invoice`, {}, "generate the tax invoice"],
  ["POST", `sessions/${ID.closedSess}/reopen-table`, { reason: "one more coffee" }, "reopen a paid table"],
  ["POST", `sessions/${ID.closedSess}/void-invoice`, { reason: "wrong dish" }, "reopen a bill"],
  ["POST", `sessions/${ID.closedSess}/credit-note`, { amount: 50, reason: "cold food" }, "issue a credit note"],
  ["POST", `sessions/${ID.sess}/shift`, { to: "7" }, "change table"],
  ["POST", `orders/${ID.order}/move`, { to: "7" }, "move one ticket"],
  ["POST", `sessions/${ID.sess}/merge`, { to: "2" }, "merge two tables"],
  ["POST", "tables/4/pay-split", { splits: [{ method: "Cash", amount: 210 }, { method: "UPI", amount: 210 }] }, "settle in parts"],
  ["POST", `order-items/${ID.item}/move`, { to: "7" }, "move one dish"],
  ["POST", `members/${ID.member}/approve`, {}, "let a guest join"],
  ["POST", `members/${ID.member}/remove`, {}, "remove a guest"],
  ["POST", `members/${ID.member}/make-head`, {}, "make a guest the head of the table"],
  ["POST", `items/${ID.item}/delete`, { reason_code: "mistake" }, "remove one dish"],
  ["POST", `items/${ID.item}/qty`, { qty: 1, reason_code: "mistake" }, "change a dish's quantity"],
  ["POST", `items/${ID.item}/note`, { note: "less spicy" }, "change a dish's note"],
  ["POST", `items/${ID.item}/removed`, { removed: ["onion"], reason_note: "guest asked" }, "change a dish's NO-list"],
  ["POST", `orders/${ID.order}/add-item`, { dishId: "dal", qty: 1 }, "add a dish to a ticket"],
  ["POST", `items/${ID.item}/status`, { status: "served" }, "serve one dish"],
  ["POST", `requests/${ID.req}/resolve`, { status: "approved" }, "answer a join request"],
  ["POST", "tables/4/restart", {}, "clear the table's round"],
  ["POST", "tables/4/unmerge", {}, "split a merged table"],
  ["POST", "tables/4/tag", { tag: "vip" }, "mark a table type"],
  ["POST", "tables/4/on-the-house", {}, "settle on the house"],
  ["POST", "tables/4/khata", { customer_id: ID.khata }, "park the bill on pay-later"],
  ["POST", "khata/customers", { name: "Meera", phone: "9000011111" }, "add a person to the pay-later book"],
  ["POST", "khata/pay", { order_id: ID.paid, method: "Cash" }, "collect a pay-later tab"],
  ["POST", "blocklist", { member_id: ID.member, reason: "rude" }, "ban a guest"],
  ["POST", "print-jobs", { order_id: ID.order }, "reprint a KOT in the kitchen"],
  ["POST", "print-jobs/claim", { ids: [ID.job] }, "the counter claims a ticket to print"],
  ["POST", `print-jobs/${ID.job}/done`, { ok: true }, "the counter reports a print"],
  ["POST", "printing/queue/clear", {}, "empty the printing queue"],
  ["POST", "printing/test", { printer: "EPSON" }, "a test page"],
  ["POST", "print-station/take", {}, "print here instead"],
  ["POST", "print-station/release", {}, "stop printing here"],
  ["POST", `print-jobs/${ID.job}/dismiss`, {}, "dismiss a stuck reprint"],
  ["POST", `printer-events/${ID.ev}/resolve`, {}, "mark a printer problem handled"],
  ["POST", "items", { id: "dal", title: "Dal tadka" }, "edit a dish"],
  ["POST", "categories", { slug: "mains", name: { en: "Main course" } }, "edit a category"],
  ["POST", "filters", { slug: "veg", name: { en: "Vegetarian" } }, "edit a filter"],
  ["POST", "settings", { oplog_retention_days: 30 }, "save a setting"],
  ["PATCH", `orders/${ID.order}`, { status: "cancelled", reason_code: "mistake" }, "cancel a ticket"],
  ["PATCH", `calls/${ID.call}`, { resolved: true }, "tick off a waiter call"],
  ["DELETE", `orders/${ID.order2}`, null, "delete a ticket (admin only)"],
  ["DELETE", `calls/${ID.call}`, null, "remove a waiter call"],
  ["DELETE", `blocklist/${ID.ban}`, null, "lift a ban"],
  ["DELETE", "items/dal", null, "delete a dish"],
  ["DELETE", "categories/mains", null, "delete a category"],
  ["DELETE", "filters/veg", null, "delete a filter"],
];

// Tables that belong to ONE restaurant. A statement on any of them must say which one.
export const TENANT_TABLES = new Set(["orders", "sessions", "order_items", "settings", "session_members", "requests", "waiter_calls",
  "aggregator_orders", "khata_customers", "feedback", "blocklist", "print_jobs", "printer_events", "menu_items", "categories", "filters",
  "banquet_items", "table_tags", "table_merges", "deletion_audit", "customers", "session_payments", "staff_users", "print_stations",
  "print_agents", "print_routes", "banquet_bills", "credit_notes", "issues"]);
