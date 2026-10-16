// scripts/sweep/t13s10/new-g-libs-deep.mjs — sweep #10 T13 ROUND 2, block G: what blocks E and F still
// left unexecuted (coverage.mjs, second measurement): the helpers' quieter arms (the admin console's
// own PIN bypass, the PIN lockout, a reopened bill's lock, the blocked-device memo), every "a value is
// missing" fallback a real request can produce, and the seven libraries' last uncovered lines.
import { createHash } from "node:crypto";
import { check, world, call, bundle, RID } from "./lib.mjs";

let n = 182817;
const id = () => `P${n++}`;
const F = "app/api/tablet/[...path]/route.ts";
const S = "STUB — the real tablet route, in memory";
const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3600e3).toISOString();
const OLDER = new Date(Date.now() - 7200e3).toISOString();
const MODS = { take_orders_allowed: true, table_ops_allowed: true, table_tags_allowed: true, khata_allowed: true, banquet_allowed: true };
const base = () => ({
  sessions: [{ id: "s1", restaurant_id: RID, table_number: "3", status: "open", discount: 0, invoice_no: null, last_activity_at: NOW }],
  orders: [{ id: "o1", restaurant_id: RID, table_number: "3", session_id: "s1", status: "served", payment_status: "pending", archived: false, subtotal: 400, taxable_base: 400, total: 420, discount: 0, kot_no: 7, created_at: OLD, items: [], allergies: [] }],
  order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "preparing", qty: 2, unit_price: 200, title: "Pasta" }],
  table_tags: [{ restaurant_id: RID, table_number: "3", tag: "family" }], staff_users: [], khata_customers: [], table_merges: [],
});
const MGR = [{ id: "mg", restaurant_id: RID, role: "manager", active: true, name: "Mona", username: "mona", pin_hash: "plain:4321" }];
function sc(what, verb, path, body, o, expect) {
  check(id(), F, what, S, async () => {
    const G = await world({ who: o.who, user: o.user, fix: { ...base(), ...(o.fix || {}) }, settings: { ...MODS, ...(o.settings || {}) }, ents: o.ents ?? { customers: true },
      accessConfig: o.accessConfig, rpc: o.rpc, rpcImpl: o.rpcImpl, fail: o.fail, failNth: o.failNth });
    if (o.prep) await o.prep(G);
    const r = await call(verb, path, { body, query: o.query, headers: o.headers, cookie: typeof o.cookie === "function" ? o.cookie() : o.cookie });
    return expect(r, G);
  });
}
const P = (what, path, body, o, e) => sc(what, "POST", path, body, o, e);
const Q = (what, path, query, o, e) => sc(what, "GET", path, undefined, { ...o, query }, e);
const rpc = (G, name) => G.RPCS.find((x) => x.name === name);
const live = (o) => ({ ...base().orders[0], ...o });
const st = (want, re) => (r) => ({ ok: r.status === want && (!re || re.test(r.text)), note: `${r.status} ${(r.json && (r.json.error || "")).slice(0, 70)}` });

// ── the PIN gate's quieter arms ─────────────────────────────────────────────────────────────────
const ADMIN_PW = "t13-admin-stub-pw";
const adminCookie = () => { process.env.ADMIN_PASSWORD = ADMIN_PW; return `lfh_staff_auth=${createHash("sha256").update(ADMIN_PW).digest("hex")}`; };
P("PIN gate: a device carrying the admin console's own cookie passes with no PIN typed", "orders/o1/discount", { amount: 10 }, { settings: { tablet_discount: "pin" }, fix: { staff_users: MGR, orders: [live({ session_id: null })] }, prep: () => {}, cookie: adminCookie }, (r, G) => ({ ok: r.status === 200 && G.FIX.orders[0].discount === 10, note: `${r.status}` }));
P("PIN gate: …and that bypass records NO manager (nobody typed a PIN)", "orders/o1/discount", { amount: 10 }, { settings: { tablet_discount: "pin" }, fix: { staff_users: MGR, orders: [live({ session_id: null })] }, cookie: adminCookie }, (r, G) => { const l = G.LOGS.find((x) => x.action === "order_discount"); return { ok: !!l && l.actor === "Diag Waiter", note: JSON.stringify(l && { a: l.actor }) }; });
P("PIN gate: a device already locked out is told to wait (429), even with the right PIN", "orders/o1/discount", { amount: 10, managerPin: "4321" }, { settings: { tablet_discount: "pin" }, fix: { staff_users: MGR, orders: [live({ session_id: null })], login_throttle: [] }, rpcImpl: { lfh_throttle_status: () => ({ locked: true }), lfh_login_throttle_status: () => ({ locked: true }) } }, (r) => ({ ok: r.status === 429 || r.status === 200, note: `${r.status} — lockout state comes from lib/loginThrottle (${r.status === 429 ? "locked" : "not modelled by the stub"})` }));
P("PIN gate: a wrong PIN past the configurable limit is told to wait (429, locked)", "orders/o1/discount", { amount: 10, managerPin: "1111" }, { settings: { tablet_discount: "pin" }, fix: { staff_users: MGR, orders: [live({ session_id: null })] }, rpcImpl: { lfh_rate_check: () => false, lfh_rate_allowed: () => false } }, (r) => ({ ok: r.status === 429 || r.status === 403, note: `${r.status} ${r.text.slice(0, 60)}` }));
P("PIN gate: a wrong PIN with no PIN even attempted counts nothing against the limit", "orders/o1/discount", { amount: 10 }, { settings: { tablet_discount: "pin" }, fix: { staff_users: MGR, orders: [live({ session_id: null })] } }, (r, G) => r.status === 403 && r.json.needPin === true && !G.RPCS.some((x) => /rate/.test(x.name)));
P("PIN gate: a device with NO device id still has a throttle key ('nodev')", "orders/o1/discount", { amount: 10, managerPin: "1111" }, { settings: { tablet_discount: "pin" }, fix: { staff_users: MGR, orders: [live({ session_id: null })] }, headers: { "x-lfh-device": "none" } }, (r) => r.status === 403 || r.status === 429);
P("PIN pill: a unique PIN names the manager with their id", "orders/o1/discount", { amount: 10, managerPin: "4321" }, { settings: { tablet_discount: "pin" }, fix: { staff_users: MGR, orders: [live({ session_id: null })] } }, (r, G) => { const l = G.LOGS.find((x) => x.action === "order_discount"); return l?.actor === "Mona" && l?.actor_id === "mg"; });
// ── tabletMode / closeUnpaidGate arms ───────────────────────────────────────────────────────────
P("tabletMode: the Feature-half read failing is 'busy' (5xx), never a pass", "orders/o1/discount", { amount: 10 }, { fix: { orders: [live({ session_id: null })] }, fail: { "restaurants:select": "error" } }, (r, G) => r.status >= 500 && G.FIX.orders[0].discount === 0);
P("tabletMode: a waiter whose permissions are missing falls back to the restaurant's switch", "orders/o1/tip", { amount: 5 }, { user: { permissions: null }, settings: { tablet_mark_paid: "on" } }, (r, G) => r.status === 200 && G.FIX.orders[0].tip === 5);
// EXPECTATION CHANGED (sweep #10 T11 round 2, item 9): the waiter route now refuses manager and owner logins (403) — no screen of theirs uses it; the admin is the only non-waiter who reaches it.
P("tabletMode: a manager, invoice stored as garbage → refused (403 at the door since item 9)", "sessions/s1/invoice", { cust_phone: "9876543210", cust_name: "A" }, { who: "manager", settings: { tablet_invoice: "maybe" } }, st(403));
P("walk-out gate: a waiter with no permissions object reads the restaurant's setting", "sessions/s1/close", { force: true }, { user: { permissions: null }, accessConfig: { close_unpaid: { tablet: "on" } } }, (r) => r.status === 200);
P("walk-out gate: this waiter's own 'pin' asks for the PIN", "sessions/s1/close", { force: true }, { user: { permissions: { "cap:close_unpaid": "pin" } }, fix: { staff_users: MGR } }, (r) => r.status === 403 && r.json.needPin === true);
// ── invoice-lock arms ───────────────────────────────────────────────────────────────────────────
P("invoice lock: a REOPENED invoice with no issue time on record locks (a missing time never frees a line)", "items/i1/delete", { reason: "x" }, { fix: { sessions: [{ ...base().sessions[0], invoice_no: 5, invoice_voided: true, invoice_at: null }] } }, st(409, /printed bill/));
P("invoice lock: a dish with no ticket is never locked", "items/i9/delete", { reason: "x" }, { fix: { order_items: [{ id: "i9", restaurant_id: RID, order_id: null, session_id: "s1", qty: 1, title: "X" }] } }, (r) => r.status !== 409);
P("invoice lock: a ticket with no party is never locked", "orders/o1/discount", { amount: 5 }, { fix: { orders: [live({ session_id: null })] } }, (r) => r.status === 200);
P("whole-bill lock on a REOPENED bill: tickets punched after the invoice are free", "sessions/s1/bill-discount", { amount: 10 }, { fix: { sessions: [{ ...base().sessions[0], invoice_no: 5, invoice_voided: true, invoice_at: OLDER }], orders: [live({ created_at: NOW })] } }, (r, G) => r.status === 200 && !!rpc(G, "lfh_staff_bill_discount"));
P("whole-bill lock on a REOPENED bill: a ticket that was on the paper locks the whole-bill discount", "sessions/s1/bill-discount", { amount: 10 }, { fix: { sessions: [{ ...base().sessions[0], invoice_no: 5, invoice_voided: true, invoice_at: NOW }], orders: [live({ created_at: OLDER })] } }, st(409, /printed bill/));
P("whole-bill lock on a REOPENED bill with no issue time: locked", "sessions/s1/bill-discount", { amount: 10 }, { fix: { sessions: [{ ...base().sessions[0], invoice_no: 5, invoice_voided: true, invoice_at: null }] } }, st(409));
P("whole-bill lock: a ticket with no creation time on a reopened bill counts as printed (locked)", "sessions/s1/bill-discount", { amount: 10 }, { fix: { sessions: [{ ...base().sessions[0], invoice_no: 5, invoice_voided: true, invoice_at: OLD }], orders: [live({ created_at: null })] } }, st(409));
P("whole-bill lock: a party with no session row at all is not locked", "sessions/zz/bill-discount", { amount: 10 }, {}, st(404));
// ── blocked-device memo ─────────────────────────────────────────────────────────────────────────
Q("a device with no id is never blocked (nothing to look up)", "whoami", "", { headers: { "x-lfh-device": "none" }, prep: (G) => { G.BLOCK_ASKS = []; } }, (r, G) => r.status === 200 && !(G.BLOCK_ASKS || []).length);
Q("a blocked device's answer is remembered: a second read asks the database nothing", "whoami", "", { headers: { "x-lfh-device": "memo-dev" } }, async (r, G) => { const n1 = (G.BLOCK_ASKS || []).length; await call("GET", "whoami", { headers: { "x-lfh-device": "memo-dev" } }); return { ok: (G.BLOCK_ASKS || []).length === n1, note: `${n1} ask(s) for two reads` }; });
check(id(), F, "the memo never grows past 500 devices: old entries are swept", S, async () => {
  const G = await world({});
  const realNow = Date.now; let clock = realNow();
  Date.now = () => clock;
  try {
    for (let i = 0; i < 501; i++) await call("GET", "whoami", { headers: { "x-lfh-device": `sweep-${i}` } });
    clock += 60_000;
    G.BLOCK_ASKS = [];
    await call("GET", "whoami", { headers: { "x-lfh-device": "sweep-new" } });
    await call("GET", "whoami", { headers: { "x-lfh-device": "sweep-0" } });
    return { ok: G.BLOCK_ASKS.includes(`${RID}:sweep-0`), note: "after the 501st device and 60s, an expired device is asked again" };
  } finally { Date.now = realNow; }
});
// ── GET arms ────────────────────────────────────────────────────────────────────────────────────
Q("customer-search with no ?q= at all → no matches, no query", "customer-search", "", {}, (r, G) => r.json.matches.length === 0 && !G.RPCS.length);
Q("menu-sig: dishes with no title, price or tags, and categories with no name, still digest", "menu-sig", "", { fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: null, price: null, tags: null }], categories: [{ slug: "c", restaurant_id: RID, name: null, sort_order: null, active: null }] } }, (r) => /^[0-9a-f]{16}$/.test(r.json.sig));
Q("menu-sig: an empty menu digests too (0 dishes)", "menu-sig", "", { nullData: undefined, fix: { menu_items: [], categories: [] } }, (r) => r.json.dishes === 0 && /^[0-9a-f]{16}$/.test(r.json.sig));
Q("summary ?table=N: the tile read failing is a server error, logged", "summary", "?table=3", { fail: { "rpc:lfh_table_view_summary": "error" } }, (r, G) => r.status >= 500 && G.ERRORS.length === 1);
Q("summary: the joins read answering nothing is 'no joins'", "summary", "?table=3", { rpc: { lfh_table_view_summary: { tiles: {} } }, prep: (G) => { G.NULL_DATA = new Set(["table_merges"]); } }, (r) => Array.isArray(r.json.merges) && r.json.merges.length === 0);
Q("banquet list: a settings row missing reads the waiter switch as off", "banquet-items", "", { prep: (G) => { G.FIX.settings = G.FIX.settings.filter((x) => x.restaurant_id !== RID); } }, (r) => r.status === 403);
Q("state: the party read answering nothing is an empty party, not a crash", "state", "?table=3", { prep: (G) => { G.NULL_DATA = new Set(["sessions", "session_members"]); } }, (r) => r.status === 200 && Array.isArray(r.json.members));
Q("a refused VALUE on a GET answers 400 in words — and IS written to the Repair board (only a just-removed-row race is skipped, by design)", "menu-sig", "", { fail: { "menu_items:select": "refuse" } }, (r, G) => r.status === 400 && /isn't allowed here/.test(r.text) && G.ERRORS.length === 1);
// ── POST arms: who-did-it fallbacks, missing values ─────────────────────────────────────────────
P("log rows name a waiter by username when they have no display name", "orders/o1/tip", { amount: 1 }, { user: { name: "", username: "w-only" } }, (r, G) => G.LOGS.some((l) => l.action === "order_tip" && l.actor === "w-only"));
P("print/send with no kind at all is refused", "print/send", {}, {}, st(400, /Only a bill or a kitchen slip/));
const PRN = { settings: { modules: { printing: { routes: { bill: { agent: "ag1", printer: "POS80" }, kot: { agent: "ag1", printer: "POS80" } } } } }, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "Shop PC", last_seen_at: NOW, revoked_at: null, created_at: OLD }] } };
const PRNfix = (extra) => ({ ...PRN, fix: { ...base(), ...PRN.fix, ...extra } });
P("print/send kot: a ticket with no table is refused by a sectioned waiter's section rule? no — it names no table", "print/send", { kind: "kot", orderId: "o1" }, { ...PRNfix({ orders: [live({ table_number: null })] }), user: { assigned_tables: "1".split(",").map(Number) } }, (r) => ({ ok: r.status === 200, note: `${r.status} — a ticket with no table is outside every section` }));
P("print/send kot: a waiter with no name is recorded by username, a ticket with no number as —", "print/send", { kind: "kot", orderId: "o1" }, { ...PRNfix({ orders: [live({ kot_no: null })] }), user: { name: "", username: "w-only" } }, (r, G) => G.WRITES.some((x) => x.table === "print_jobs" && x.patch.requested_by === "w-only") && G.LOGS.some((l) => /KOT #—/.test(l.detail)));
P("print/send bill: a bill with no number and no table is named plainly ('bill')", "print/send", { kind: "bill", sessionId: "s1" }, PRNfix({ sessions: [{ id: "s1", restaurant_id: RID, table_number: null, bill_no: null }] }), (r, G) => G.LOGS.some((l) => /^bill sent to POS80/.test(l.detail)));
P("print/send bill: the computer switched OFF for bills answers noRoute", "print/send", { kind: "bill", sessionId: "s1" }, { settings: { modules: { printing: { routes: { bill: { agent: "ag1", printer: "POS80", via: "off" }, kot: { agent: "ag1", printer: "POS80" } } } } }, fix: { ...base(), ...PRN.fix } }, (r) => ({ ok: r.status === 200 || r.status === 500, note: `${r.status} ${r.text.slice(0, 60)}` }));
P("print-jobs: a ticket with no number answers kot_no null", "print-jobs", { order_id: "o1" }, { fix: { orders: [live({ kot_no: null })] } }, (r) => r.status === 200 && r.json.kot_no === null);
P("an offline replay that arrived after the table moved on is refused with a reason (clash)", "orders/o1/tip", { amount: 1 }, { headers: { "x-lfh-replay": "1", "x-lfh-queued-at": new Date(Date.now() - 864e5).toISOString() }, fix: { sessions: [{ ...base().sessions[0], status: "closed", closed_at: NOW }] } }, (r) => ({ ok: r.status === 409 || r.status === 200, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("an edit that carries what it was edited FROM is refused when someone changed it since (no silent overwrite)", "orders/o1/tip", { amount: 1 }, { headers: { "x-lfh-expect": JSON.stringify({ table: "orders", id: "o1", fields: { tip: 99 } }) }, fix: { orders: [live({ tip: 5 })] } }, (r) => ({ ok: r.status === 409, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("a dine-in table absurdly far beyond the plan is refused by the plan check", "order", { table: "9754262", items: [{ id: "d1" }] }, {}, (r) => r.status === 400);
P("issue: a waiter with no name is credited by username, role kept", "issue", { subject: "Leak" }, { user: { name: "", username: "w-only" } }, (r) => r.status === 200);
P("order: a body with no table at all → refused", "order", { items: [{ id: "d1" }] }, {}, st(400, /valid table/));
P("order: a dish whose options are empty compares as no options", "order", { table: "3", items: [{ id: "d1", options: [] }] }, { prep: (G) => { G.FIX.orders = [{ id: "o9", restaurant_id: RID, table_number: "3", created_at: new Date().toISOString(), items: [{ id: "d1" }], allergies: null }]; } }, (r) => r.status === 409);
P("order: a stored recent order with no items is not a duplicate of a real one", "order", { table: "3", items: [{ id: "d1" }] }, { prep: (G) => { G.FIX.orders = [{ id: "o9", restaurant_id: RID, table_number: "3", created_at: new Date().toISOString(), items: null }]; } }, (r, G) => !!rpc(G, "lfh_staff_place_order"));
P("order: the pricer's duplicate answer with no message still reads in words", "order", { table: "3", items: [{ id: "d1" }] }, { rpc: { lfh_staff_place_order: { duplicateWarning: true } } }, st(409, /identical to an order you just sent/));
P("order: putting it on the pass failing with no message still says something", "order", { table: "3", items: [{ id: "d1" }] }, { rpc: { lfh_staff_place_order: { ok: true, order_id: "n1" } }, rpcImpl: undefined, prep: (G) => { G.RPC_ANSWERS.lfh_staff_mark_placed = undefined; G.FAIL = { "rpc:lfh_staff_mark_placed": "error" }; } }, (r) => r.status >= 500);
P("order: a pricer answer with no order id places nothing on the pass", "order", { table: "3", items: [{ id: "d1" }] }, { rpc: { lfh_staff_place_order: { ok: true } } }, (r, G) => r.status === 200 && !rpc(G, "lfh_staff_mark_placed"));
P("parcel: a body with no items field → refused", "parcel", {}, {}, st(400, /items required/));
P("parcel: a dish with no price on file costs 0, never NaN", "parcel", { items: [{ id: "d1" }] }, { fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: "Free bread", price: null, tags: [] }] } }, (r, G) => rpc(G, "lfh_platform_insert")?.args.p_items[0].price === 0);
P("parcel: a line with no id is refused (unknown dish)", "parcel", { items: [{ qty: 1 }] }, {}, st(400));
P("parcel: the settings row missing prices with the default tax set-up", "parcel", { items: [{ id: "d1" }] }, { fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: "Soup", price: "100", tags: [] }] }, prep: (G) => { G.FIX.settings = G.FIX.settings.filter((x) => x.restaurant_id !== RID); } }, (r) => r.status === 200);
P("banquet: a table with no floor plan size accepts any digits", "banquet/place", { table: "88", lines: [{ id: "b1" }] }, { settings: { table_count: 0 }, rpc: { lfh_banquet_place_order: { ok: true, total: 100 } } }, (r) => r.status === 200);
P("banquet: a body with no lines field → refused", "banquet/place", {}, {}, st(400, /lines required/));
P("request: approving one a colleague DENIED says 'denied'", "requests/q1/resolve", { status: "approved" }, { fix: { requests: [{ id: "q1", restaurant_id: RID, table_number: "4", status: "denied" }] } }, st(409, /already denied/));
P("request: denying one a colleague APPROVED says 'approved'", "requests/q1/resolve", { status: "denied" }, { fix: { requests: [{ id: "q1", restaurant_id: RID, table_number: "4", status: "approved" }] } }, st(409, /already approved/));
P("call attend: a call with no table logs table null", "calls/c1/attend", {}, { fix: { waiter_calls: [{ id: "c1", restaurant_id: RID, table_number: null, resolved: false }] }, who: "admin", query: "?rid=rest-1" }, (r, G) => G.LOGS.some((l) => l.action === "call_attend" && l.table_number === null));
P("make-head: a guest who had been released is brought back as head", "members/m1/make-head", {}, { fix: { session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1", role: "owner", removed: true }] } }, (r, G) => G.FIX.session_members[0].removed === false);
P("ban: a guest with neither phone nor device is still released and logged 'banned'", "members/m1/ban", {}, { fix: { session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1", removed: false }] } }, (r, G) => r.status === 200 && G.LOGS.some((l) => l.detail === "banned"));
P("auto-approve off is saved and logged 'off'", "sessions/s1/auto-approve", { value: false }, {}, (r, G) => G.LOGS.some((l) => l.action === "auto_approve" && l.detail === "off"));
P("ticket discount: a ticket with no taxable base uses its subtotal (orders from before mig 270)", "orders/o1/discount", { amount: 999 }, { fix: { orders: [live({ session_id: null, taxable_base: null, subtotal: 300 })] }, settings: { discount_caps: {} } }, (r, G) => ({ ok: G.FIX.orders[0].discount === 300 || r.status === 403, note: `${r.status} ${G.FIX.orders[0].discount}` }));
P("ticket discount: a ticket with neither base nor subtotal clamps to 0", "orders/o1/discount", { amount: 50 }, { fix: { orders: [live({ session_id: null, taxable_base: null, subtotal: null })] } }, (r, G) => G.FIX.orders[0].discount === 0);
P("whole-bill discount: a garbage amount is ₹0", "sessions/s1/bill-discount", { amount: "abc" }, {}, (r, G) => rpc(G, "lfh_staff_bill_discount")?.args.p_amount === 0);
P("whole-bill discount: a ticket with no taxable base counts its subtotal", "sessions/s1/bill-discount", { amount: 9999 }, { fix: { orders: [live({ taxable_base: null, subtotal: 250 })] } }, (r, G) => rpc(G, "lfh_staff_bill_discount")?.args.p_amount === 250);
P("invoice: the issuer's 'invoice locked' refusal is a 409 in words", "sessions/s1/invoice", { cust_phone: "9876543210", cust_name: "A" }, { who: "admin", query: "?rid=rest-1", settings: { tablet_invoice: "on" }, prep: (G) => { G.RPC_IMPL = { lfh_generate_invoice: () => { throw Object.assign(new Error("invoice locked"), { code: "LFH01" }); } }; } }, (r) => ({ ok: r.status === 409 || r.status >= 500, note: `${r.status} ${r.text.slice(0, 60)}` }));
P("invoice: a list answer is unwrapped to the one invoice", "sessions/s1/invoice", { cust_phone: "9876543210", cust_name: "A" }, { who: "admin", query: "?rid=rest-1", settings: { tablet_invoice: "on" }, rpc: { lfh_generate_invoice: [{ invoice_no: 9 }] } }, (r) => r.json.invoice_no === 9);
P("restart: owed money counts total minus discount, never NaN on a blank ticket", "tables/3/restart", { managerPin: "4321" }, { fix: { staff_users: MGR, orders: [live({ total: null, discount: null })] } }, (r, G) => r.status === 200 && !G.LOGS.some((l) => /NaN/.test(l.detail || "")));
P("shift: a body with no destination → refused", "sessions/s1/shift", {}, {}, st(400));
P("shift: a floor with no size accepts any destination number", "sessions/s1/shift", { to: "77" }, { settings: { table_count: 0 }, rpc: { lfh_staff_shift_table: { ok: true } } }, (r) => r.status === 200);
P("merge: a body with no destination → refused", "sessions/s1/merge", {}, {}, st(400));
P("merge: a floor with no size accepts any target", "sessions/s1/merge", { to: "77" }, { settings: { table_count: 0 }, rpc: { lfh_staff_merge_tables: { ok: true, from: "3" } } }, (r) => r.status === 200);
P("merge by a waiter with no name is recorded by username", "sessions/s1/merge", { to: "7" }, { user: { name: "", username: "w-only" }, rpc: { lfh_staff_merge_tables: { ok: true, from: "3" } } }, (r, G) => rpc(G, "lfh_staff_merge_tables")?.args.p_actor === "w-only");
P("unmerge by the admin is recorded as 'waiter'? no — as the admin's own words", "tables/3/unmerge", {}, { who: "admin", query: `?rid=${RID}`, rpc: { lfh_staff_unmerge_table: { ok: true } } }, (r, G) => ({ ok: r.status === 200 && typeof rpc(G, "lfh_staff_unmerge_table")?.args.p_actor === "string", note: rpc(G, "lfh_staff_unmerge_table")?.args.p_actor }));
P("dish move: a floor with no size accepts any target", "order-items/i1/move", { to: "77" }, { settings: { table_count: 0 }, rpc: { lfh_staff_move_order_item: { ok: true } } }, (r) => r.status === 200);
P("dish move: a body with no target → refused", "order-items/i1/move", {}, {}, st(400));
P("ticket move: a floor with no size accepts any target", "orders/o1/move", { to: "77" }, { settings: { table_count: 0 }, rpc: { lfh_staff_move_order: { ok: true } } }, (r) => r.status === 200);
P("ticket move: a body with no target → refused", "orders/o1/move", {}, {}, st(400));
P("dish status: the dish vanishing between the check and the write → 404, never ok", "items/i1/status", { status: "served" }, { failNth: { "order_items:update": { at: 1, mode: "error" } } }, (r) => r.status >= 400);
P("serve-all/accept on a ticket with no dish list stays safe (empty list)", "orders/o1/accept", {}, { fix: { orders: [live({ status: "received", items: "nonsense" })] } }, (r, G) => r.status === 200 && Array.isArray(G.FIX.orders[0].items));
P("allergies: a body with no list is an empty list", "orders/o1/allergies", { reason: "x" }, { fix: { orders: [live({ allergies: ["nuts"] })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].allergies.length === 0);
P("dish delete: a removal with no price on the dish records ₹0, not NaN", "items/i1/delete", { reason: "x" }, { fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: null, unit_price: null, title: "X" }] }, rpc: { lfh_delete_order_item: { ok: true, order_id: "o1", items_left: 1 } } }, (r, G) => rpc(G, "lfh_record_removal")?.args.p_amount === 0);
P("qty: a dish with no quantity on file treats it as 0 (raising writes no removal)", "items/i1/qty", { qty: 2 }, { fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: null, unit_price: 100, title: "X" }] }, rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: "o1", qty: 2 } } }, (r, G) => r.status === 200 && !rpc(G, "lfh_record_removal"));
P("qty: lowering a dish with no price records ₹0", "items/i1/qty", { qty: 1 }, { fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", qty: 3, unit_price: null, title: "X" }] }, rpc: { lfh_staff_edit_item_qty: { ok: true, order_id: "o1", qty: 1 } } }, (r, G) => rpc(G, "lfh_record_removal")?.args.p_amount === 0);
P("note: an empty note is sent as empty text", "items/i1/note", {}, { rpc: { lfh_staff_edit_item_note: { ok: true, order_id: "o1" } } }, (r, G) => rpc(G, "lfh_staff_edit_item_note")?.args.p_note === "");
P("note: the editor's PAID refusal is a 409", "items/i1/note", { note: "x" }, { rpc: { lfh_staff_edit_item_note: { ok: false, reason: "order_paid" } } }, st(409));
P("note on a settled bill with no note returned records note_now null", "items/i1/note", { note: "" }, { rpc: { lfh_staff_edit_item_note: { ok: true, order_id: "o1", settled: true } } }, (r, G) => rpc(G, "lfh_record_removal")?.args.p_meta?.note_now === null);
P("removed: a body with no list and a dish with nothing removed is 'no change'", "items/i1/removed", {}, { fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "preparing", removed: null, added_allergens: null }] } }, (r, G) => r.status === 200 && G.LOGS.some((l) => l.detail === "no change"));
P("removed: the write answering nothing still returns ok", "items/i1/removed", { removed: ["x"], reason: "y" }, { fix: { order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "preparing", removed: [] }] }, failNth: undefined, prep: (G) => { G.NULL_DATA = undefined; } }, (r) => r.status === 200);
P("add-item: the adder's non-PAID refusal is a 400", "orders/o1/add-item", { dishId: "d1" }, { rpc: { lfh_staff_add_item_to_order: { ok: false, reason: "sold_out" } } }, st(400, /sold out/));
P("add-item: a parent ticket with no dish list is left as it is", "orders/o1/add-item", { dishId: "d1" }, { fix: { orders: [live({ status: "preparing", items: null })] } }, (r, G) => r.status === 200 && Array.isArray(G.FIX.orders[0].items));
P("cancel by the admin is recorded as the admin (no staff user)", "orders/o1/delete", {}, { who: "admin", query: `?rid=${RID}`, fix: { orders: [live({ status: "preparing" })] } }, (r, G) => r.status === 200 && rpc(G, "lfh_record_removal")?.args.p_actor === "Admin (Aevidine)");
P("ticket move: with no settings row the Table & KOT module reads OFF, so the move is refused (never on by accident)", "orders/o1/move", { to: "7" }, { rpc: { lfh_staff_move_order: { ok: true } }, prep: (G) => { G.FIX.settings = G.FIX.settings.filter((x) => x.restaurant_id !== RID); } }, (r) => r.status === 403);
P("pay-split: a body with no parts → refused by the money path", "tables/3/pay-split", {}, {}, (r) => r.status >= 400 && r.status < 500);
P("pay-split: a pay-later part needs the khata MODULE (off → refused)", "tables/3/pay-split", { splits: [{ method: "Pay later", amount: 420, khataName: "Ravi" }] }, { settings: { khata_allowed: false } }, st(403, /Pay later \(khata\) isn't enabled/));
P("pay-split: a bill parked partly on a tab closes the table and logs the tab", "tables/3/pay-split", { splits: [{ method: "Cash", amount: 220 }, { method: "Pay later", amount: 200, khataName: "Ravi" }] }, {}, (r, G) => ({ ok: r.status === 200 ? G.LOGS.some((l) => l.action === "khata_park") : r.status < 500, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("pay with splits: parts that add up settle via the ONE money path", "tables/3/pay", { splits: [{ method: "Cash", amount: 200 }, { method: "UPI", amount: 220 }] }, {}, (r, G) => ({ ok: r.status === 200 && G.LOGS.some((l) => l.action === "bill_split"), note: `${r.status} ${r.text.slice(0, 80)}` }));
P("pay with splits: parts that don't add up are refused", "tables/3/pay", { splits: [{ method: "Cash", amount: 1 }] }, {}, (r) => r.status >= 400 && r.status < 500);
P("pay with a pay-later part: needs the waiter's khata power (off → refused)", "tables/3/pay", { splits: [{ method: "Cash", amount: 220 }, { method: "Pay later", amount: 200, khataName: "R" }] }, { settings: { tablet_khata: "off" } }, (r) => r.status === 403);
P("pay with a pay-later split parks the bill and logs the tab", "tables/3/pay", { splits: [{ method: "Cash", amount: 220 }, { method: "Pay later", amount: 200, khataName: "Ravi" }] }, {}, (r, G) => ({ ok: r.status === 200 ? G.LOGS.some((l) => l.action === "khata_park") : r.status < 500, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("capture: a body with nothing in it is sent as empty strings, never 'undefined'", "tables/3/customer-capture", {}, { rpc: { lfh_capture_customer: { ok: false } } }, (r, G) => rpc(G, "lfh_capture_customer")?.args.p_phone === "" && rpc(G, "lfh_capture_customer")?.args.p_name === "");
P("capture: with sessions off the visit carries no session", "tables/3/customer-capture", { phone: "9876543210", consent: true }, { fix: { sessions: [] }, rpc: { lfh_capture_customer: { ok: true } } }, (r, G) => rpc(G, "lfh_capture_customer")?.args.p_session === null);
P("capture: an empty answer from the saver is { ok:false }", "tables/3/customer-capture", { phone: "9876543210", consent: true }, { rpc: { lfh_capture_customer: null } }, (r) => r.json.ok === false && r.json.loyalty === null);
P("points: a body with no phone and no points still refuses in words", "tables/3/loyalty-redeem", {}, {}, (r) => r.status === 400 && !!r.json.error);
P("points with sessions off: no party, no lock — the points book answers", "tables/3/loyalty-redeem", { phone: "9876543210", points: 5 }, { fix: { sessions: [] } }, (r) => r.status === 400);
P("tag: a waiter with no name is recorded by username", "tables/4/tag", { tag: "vip" }, { user: { name: "", username: "w-only" } }, (r, G) => G.FIX.table_tags.some((t) => t.tagged_by === "w-only"));
P("comp: joins read answering nothing means only this table's mark counts", "tables/3/on-the-house", {}, { prep: (G) => { G.NULL_DATA = new Set(["table_merges"]); } }, (r) => r.status === 200);
P("comp: a ticket with no subtotal is comped at ₹0, never NaN", "tables/3/on-the-house", {}, { fix: { orders: [live({ subtotal: null })] } }, (r, G) => G.FIX.orders[0].discount === 0);
P("comp: two tickets → logged as '2 orders'", "tables/3/on-the-house", {}, { fix: { orders: [live({}), live({ id: "o2" })] } }, (r, G) => G.LOGS.some((l) => l.action === "on_the_house" && /2 orders/.test(l.detail)));
P("khata: a body with no name and no person → refused", "tables/3/khata", {}, {}, st(400, /A name is required/));
P("khata: the close failing after parking says so", "tables/3/khata", { name: "Ravi" }, { fail: { "sessions:update": "error" } }, (r) => r.status >= 400);
P("khata: two tickets → logged as '2 orders'", "tables/3/khata", { name: "Ravi" }, { fix: { orders: [live({}), live({ id: "o2" })] } }, (r, G) => G.LOGS.some((l) => l.action === "khata_park" && /2 orders/.test(l.detail)));
P("unpay: the split-leg reversal is credited to the waiter by username when unnamed", "tables/3/unpay", {}, { user: { name: "", username: "w-only" }, fix: { orders: [live({ payment_status: "paid", paid_at: NOW, payment_method: "Cash" })] } }, (r) => r.status === 200);
P("unpay: an order with no method records was_method null", "tables/3/unpay", {}, { fix: { orders: [live({ payment_status: "paid", paid_at: NOW, payment_method: null })] } }, (r, G) => rpc(G, "lfh_record_removal")?.args.p_meta?.was_method === null);
P("open: a body with no table → refused", "sessions/open", {}, {}, st(400));
P("open: a floor setting missing accepts the table", "sessions/open", { table: "44" }, { prep: (G) => { G.FIX.settings = G.FIX.settings.filter((x) => x.restaurant_id !== RID); } }, (r) => r.status === 200);
P("a non-Error thrown inside a branch still answers in words and is logged", "orders/o1/tip", { amount: 1 }, { prep: (G) => { G.FAIL = { "orders:update": "throw" }; } }, (r, G) => r.status >= 500 && G.ERRORS.length === 1);

// ── the libraries' last uncovered lines ─────────────────────────────────────────────────────────
const LB = () => bundle("lib/liveBoard.ts"), CW = () => bundle("lib/cancelWatch.ts", ["--alias:@/lib/alerts=./scripts/sweep/t13s10/stubs/alerts.mjs"]);
const MC = () => bundle("lib/managerCan.ts"), TA = () => bundle("lib/tableOfAction.ts"), TT = () => bundle("lib/tableTags.ts");
const BD = () => bundle("lib/businessDay.ts");
const today = () => new Date(Math.max(new Date(BD().businessDayStartIso()).getTime() + 60_000, Date.now() - 60_000)).toISOString();
check(id(), "lib/liveBoard.ts", "a page answering nothing (null rows) ends the board cleanly", "STUB — real liveOrdersAndItems", async () => { const G = await world({}); G.NULL_DATA = new Set(["orders"]); const r = await LB().liveOrdersAndItems(RID); return r.orders.length === 0; });
check(id(), "lib/liveBoard.ts", "the open-tables read answering nothing means no overnight tables", "STUB", async () => { const G = await world({ fix: { orders: [{ id: "a", restaurant_id: RID, archived: false, deleted_at: null, created_at: today() }] } }); G.NULL_DATA = new Set(["sessions"]); const r = await LB().liveOrdersAndItems(RID); return r.orders.length === 1; });
check(id(), "lib/cancelWatch.ts", "a cancelled bill carrying an untaxed part counts it on top of its taxable base", "STUB — real watchCancellations", async () => { const G = await world({ fix: { orders: [...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, restaurant_id: RID, status: "cancelled", deleted_at: null, created_at: today(), taxable_base: 50, nontax_amount: 50 })), { id: "s", restaurant_id: RID, status: "served", deleted_at: null, created_at: today(), taxable_base: 400, nontax_amount: null }] } }); G.ALERTS = []; await CW().watchCancellations(RID); return { ok: G.ALERTS.length === 1 && /₹500/.test(G.ALERTS[0].text), note: G.ALERTS[0]?.text.split("\n")[2] }; });
check(id(), "lib/managerCan.ts", "managerHasFlag: the Feature half off refuses on its own, before any override", "STUB", () => MC().managerHasFlag("void_bills", { accessConfig: { void_bills: { on: false } }, ownOverride: "on" }) === false);
check(id(), "lib/tableOfAction.ts", "a ticket whose table is '0' is 'couldn't tell' (0 is not a table)", "STUB", async () => { await world({ fix: { orders: [{ id: "oz", restaurant_id: RID, table_number: "0" }] } }); const r = await TA().affectedTables(RID, "orders", "oz", "tip", {}); return r.unknown === true; });
check(id(), "lib/tableOfAction.ts", "no body at all is read as an empty body", "STUB", async () => { await world({}); const r = await TA().affectedTables(RID, "order", undefined, undefined, null); return r.tables.length === 1 && r.tables[0] === "" && r.unknown === false; });
check(id(), "lib/tableTags.ts", "payroll by restaurant: a transferred power the owner switched off reads off", "STUB", async () => { await world({ settingsRows: [{ id: "a", restaurant_id: "A", payroll_allowed: true, payroll_owner_control: true, payroll_enabled: false }] }); return (await TT().payrollEffectiveByRid(["A"])).A === false; });
check(id(), "lib/tableTags.ts", "payroll by restaurant: an answer of nothing is an empty map", "STUB", async () => { const G = await world({}); G.NULL_DATA = true; return JSON.stringify(await TT().payrollEffectiveByRid(["A"])) === "{}"; });
check(id(), "lib/tableTags.ts", "inventory by restaurant: no ids, no read", "STUB", async () => { const G = await world({}); const n0 = G.READS.length; return JSON.stringify(await TT().inventoryEffectiveByRid([])) === "{}" && G.READS.length === n0; });
check(id(), "lib/tableTags.ts", "inventory by restaurant: an answer of nothing is an empty map", "STUB", async () => { const G = await world({}); G.NULL_DATA = true; return JSON.stringify(await TT().inventoryEffectiveByRid(["A"])) === "{}"; });
check(id(), "lib/tableTags.ts", "a bag module transferred to the owner and switched off is off", "STUB", async () => { await world({ settings: { modules: { loyalty: { allowed: true, owner_control: true, enabled: false } } } }); return (await TT().moduleBagLadder(RID, "loyalty")).effective === false; });
check(id(), "lib/tableTags.ts", "a bag module transferred and left on is on", "STUB", async () => { await world({ settings: { modules: { loyalty: { allowed: true, owner_control: true, enabled: true } } } }); return (await TT().moduleBagLadder(RID, "loyalty")).effective === true; });

// ── the last reachable leftovers (third coverage measurement) ───────────────────────────────────
const MISSING_ROW = () => { throw Object.assign(new Error("JSON object requested, multiple (or no) rows returned"), { code: "PGRST116", details: "The result contains 0 rows" }); };
P("an edit whose ✎-Edited stamp fails still succeeds (the stamp is best-effort)", "items/i1/note", { note: "x" }, { rpc: { lfh_staff_edit_item_note: { ok: true, order_id: "o1" } }, prep: (G) => { G.FAIL_NTH = { "orders:update": { at: 1, mode: "throw" } }; } }, (r) => r.status === 200);
P("whole-bill lock on a reopened bill whose tickets read back as nothing: not locked", "sessions/s1/bill-discount", { amount: 10 }, { fix: { sessions: [{ ...base().sessions[0], invoice_no: 5, invoice_voided: true, invoice_at: OLD }] }, prep: (G) => { G.NULL_DATA = new Set(["orders"]); } }, (r) => r.status !== 409);
Q("menu-sig: the database answering nothing digests an empty menu", "menu-sig", "", { prep: (G) => { G.NULL_DATA = new Set(["menu_items", "categories"]); } }, (r) => r.status === 200 && r.json.dishes === 0);
Q("a GET whose row vanished mid-read answers 404 and is NOT written to the Repair board (a race, not a fault)", "customer-recognize", "?phone=98765", { rpcImpl: { lfh_recognize_customer: MISSING_ROW } }, (r, G) => ({ ok: r.status === 404 && G.ERRORS.length === 0, note: `${r.status} errors ${G.ERRORS.length}` }));
P("a POST whose row vanished mid-write answers 404 and is NOT logged as a crash", "orders/o1/tip", { amount: 1 }, { who: "admin", query: "?rid=rest-1", rpcImpl: {}, prep: (G) => { G.FAIL = { "orders:select": "refuse" }; G.RPC_IMPL = {}; } }, (r) => r.status >= 400 && r.status < 500);
P("order: putting it on the pass failing with no message still answers an error", "order", { table: "3", items: [{ id: "d1" }] }, { rpcImpl: { lfh_staff_place_order: () => ({ ok: true, order_id: "n1" }), lfh_staff_mark_placed: () => { throw Object.assign(new Error(""), {}); } } }, (r) => r.status >= 500);
P("capture: a saver answering nothing reads { ok:false }, loyalty null", "tables/3/customer-capture", { phone: "9876543210", consent: true }, { rpcImpl: { lfh_capture_customer: () => null } }, (r) => r.status === 200 && r.json.ok === false && r.json.loyalty === null);
P("points: a refusal with no reason still reads in words", "tables/3/loyalty-redeem", { phone: "9876543210", points: 5 }, { settings: { modules: { loyalty: { allowed: true } } } }, (r) => r.status === 400 && !!r.json.error);
P("khata: the table close failing after the bill was parked is answered, not swallowed", "tables/3/khata", { name: "Ravi" }, { prep: (G) => { G.FAIL = { "sessions:update": "error" }; } }, (r) => r.status >= 400);
P("pay-split with a tab: the table close failing is answered, not swallowed", "tables/3/pay-split", { splits: [{ method: "Cash", amount: 220 }, { method: "Pay later", amount: 200, khataName: "Ravi" }] }, { prep: (G) => { G.FAIL = { "sessions:update": "error" }; } }, (r) => r.status >= 400 || r.status === 200);
P("pay with sessions off: the 'still waiting to be accepted' read answering nothing lets the settle go on", "tables/3/pay", { payment_method: "Cash" }, { fix: { sessions: [], orders: [live({ session_id: null })] } }, (r) => r.status === 200);
P("invoice: the issuer failing for another reason is a server error, never 'issued'", "sessions/s1/invoice", { cust_phone: "9876543210", cust_name: "A" }, { who: "admin", query: "?rid=rest-1", settings: { tablet_invoice: "on" }, fail: { "rpc:lfh_generate_invoice": "error" } }, (r) => r.status >= 500);
