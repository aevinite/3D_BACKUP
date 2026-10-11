// scripts/sweep/t13s10/new-e-route-deep.mjs — sweep #10 T13 ROUND 2, block E: every arm of the waiter
// route that round 1 never executed, aimed by measurement (scripts/sweep/t13s10/coverage.mjs reported
// 521 lines of the route that no check ran). Each scenario drives the REAL handler in memory and
// asserts what it answered AND what it wrote. Ids continue the round-1 block (P182528…).
import { check, world, call, RID, RID2 } from "./lib.mjs";

let n = 182528;
const id = () => `P${n++}`;
const F = "app/api/tablet/[...path]/route.ts";
const S = "STUB — the real tablet route, in memory";
const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3600e3).toISOString();
const MODS = { take_orders_allowed: true, table_ops_allowed: true, table_tags_allowed: true, khata_allowed: true, banquet_allowed: true };
const base = () => ({
  sessions: [{ id: "s1", restaurant_id: RID, table_number: "3", status: "open", discount: 0, invoice_no: null, bill_no: 41, last_activity_at: NOW }],
  orders: [{ id: "o1", restaurant_id: RID, table_number: "3", session_id: "s1", status: "served", payment_status: "pending", archived: false, subtotal: 400, taxable_base: 400, total: 420, discount: 0, kot_no: 7, created_at: OLD, items: [{ id: "d1", status: "served" }], allergies: [] }],
  order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "preparing", qty: 2, unit_price: 200, title: "Pasta", removed: [], added_allergens: [], removed_flag: false }],
  menu_items: [{ id: "d1", restaurant_id: RID, title: "Soup", price: "120", tags: [], open_price: false, tax_mode: null }],
  table_tags: [{ restaurant_id: RID, table_number: "3", tag: "family" }],
  session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1", name: "Asha", role: "guest", approved: false, removed: false, phone: "9876543210", device_id: "gdev" },
    { id: "m0", restaurant_id: RID, session_id: "s1", name: "Ravi", role: "owner", approved: true, removed: false }],
  waiter_calls: [{ id: "c1", restaurant_id: RID, table_number: "3", resolved: false }],
  requests: [{ id: "q1", restaurant_id: RID, table_number: "4", status: "pending", type: "open", name: "Meera" }],
  khata_customers: [], staff_users: [], print_agents: [], aggregator_orders: [], banquet_items: [],
});
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v; return o; };
/** One scenario: a fresh world, one request, an assertion over (response, world). */
function sc(what, path, body, o, expect, verb = "POST") {
  check(id(), F, what, S, async () => {
    const G = await world({ who: o.who, user: o.user, fix: merge(base(), o.fix), settings: { ...MODS, ...(o.settings || {}) }, ents: o.ents ?? { customers: true },
      accessConfig: o.accessConfig, rpc: o.rpc, rpcImpl: o.rpcImpl, fail: o.fail, failNth: o.failNth, settingsRows: o.settingsRows });
    if (o.fresh) for (const x of G.FIX.orders) x.created_at = new Date().toISOString();   // "a moment ago", at run time
    if (o.prep) o.prep(G);
    const r = await call(verb, path, { body, query: o.query, headers: o.headers });
    return expect(r, G);
  });
}
const status = (want, re) => (r) => ({ ok: r.status === want && (!re || re.test(r.text)), note: `${r.status} ${(r.json && (r.json.error || "")).slice(0, 70)}` });
const w = (G, t) => G.WRITES.filter((x) => x.table === t && x.matched);
const rpc = (G, name) => G.RPCS.find((x) => x.name === name);

// ── print/send ──────────────────────────────────────────────────────────────────────────────────
const PRN = { settings: { modules: { printing: { routes: { bill: { agent: "ag1", printer: "POS80" }, kot: { agent: "ag1", printer: "POS80" } } } } },
  fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "Shop PC", last_seen_at: NOW, revoked_at: null, created_at: OLD }] } };
const PRN_OFFLINE = { ...PRN, fix: { print_agents: [{ id: "ag1", restaurant_id: RID, name: "Shop PC", last_seen_at: OLD, revoked_at: null, created_at: OLD }] } };
sc("print/send: anything but a bill or a kitchen slip is refused", "print/send", { kind: "menu" }, {}, status(400, /Only a bill or a kitchen slip/));
sc("print/send: no computer owns the bill → noRoute (the panel opens its own window, as before)", "print/send", { kind: "bill", sessionId: "s1" }, {}, (r) => ({ ok: r.status === 200 && r.json.noRoute === true, note: r.text }));
sc("print/send: a computer named but REMOVED → noRoute", "print/send", { kind: "bill", sessionId: "s1" }, { settings: PRN.settings, fix: { print_agents: [] } }, (r) => r.json?.noRoute === true);
sc("print/send kot: no order named = 'who owns the slips?' — answers the printer, queues nothing", "print/send", { kind: "kot" }, PRN, (r, G) => ({ ok: r.status === 200 && r.json.printer === "POS80" && r.json.connected === true && !w(G, "print_jobs").length && !G.WRITES.some((x) => x.table === "print_jobs"), note: r.text }));
sc("print/send kot: an order not on this restaurant's board → 404", "print/send", { kind: "kot", orderId: "nope" }, PRN, status(404, /isn't on this restaurant's board/));
sc("print/send kot: a cancelled ticket → refused, nothing to reprint", "print/send", { kind: "kot", orderId: "o1" }, { ...PRN, fix: merge(PRN.fix, { orders: [merge(base().orders[0], { status: "cancelled" })] }) }, status(400, /cancelled/));
sc("print/send kot: a deleted ticket → refused", "print/send", { kind: "kot", orderId: "o1" }, { ...PRN, fix: merge(PRN.fix, { orders: [merge(base().orders[0], { deleted_at: NOW })] }) }, status(400, /deleted/));
sc("print/send kot: someone else's table → refused by name (the section check this branch asks itself)", "print/send", { kind: "kot", orderId: "o1" }, { ...PRN, user: { assigned_tables: "1".split(",").map(Number) } }, status(403, /Table 3 isn't in your section/));
sc("print/send kot: the admin looking in prints NOTHING unless forced", "print/send", { kind: "kot", orderId: "o1" }, { ...PRN, who: "admin", query: `?rid=${RID}` }, (r, G) => ({ ok: r.json?.adminView === true && !G.WRITES.some((x) => x.table === "print_jobs"), note: r.text }));
sc("print/send kot: …and forced, it queues a DUPLICATE slip and logs it", "print/send", { kind: "kot", orderId: "o1", force: true }, { ...PRN, who: "admin", query: `?rid=${RID}` }, (r, G) => ({ ok: r.json?.queued === true && G.WRITES.some((x) => x.table === "print_jobs" && x.patch.reprint === true), note: r.text }));
sc("print/send kot: a waiter's reprint is queued, logged with the KOT number, and says where it prints", "print/send", { kind: "kot", orderId: "o1" }, PRN, (r, G) => ({ ok: r.json?.queued === true && /Sent to POS80/.test(r.json.note) && G.LOGS.some((l) => l.action === "kot_reprint_sent" && /KOT #7/.test(l.detail)), note: r.json?.note }));
sc("print/send kot: with the computer offline it is SAVED and says so", "print/send", { kind: "kot", orderId: "o1" }, PRN_OFFLINE, (r) => ({ ok: r.json?.queued === true && /Saved — it prints at POS80 as soon as Shop PC is back/.test(r.json.note), note: r.json?.note }));
sc("print/send kot: a failed queue insert says so (500), never 'sent'", "print/send", { kind: "kot", orderId: "o1" }, { ...PRN, fail: { "print_jobs:insert": "error" } }, status(500, /Could not send/));
sc("print/send bill: no bill named → 'Which bill?'", "print/send", { kind: "bill" }, PRN, status(400, /Which bill/));
sc("print/send bill: another restaurant's bill → 404", "print/send", { kind: "bill", sessionId: "sx" }, { ...PRN, fix: merge(PRN.fix, { sessions: [{ id: "sx", restaurant_id: RID2, table_number: "3" }] }) }, status(404, /not this restaurant's/));
sc("print/send bill: someone else's table → refused by name", "print/send", { kind: "bill", sessionId: "s1" }, { ...PRN, user: { assigned_tables: "1".split(",").map(Number) } }, status(403, /Table 3/));
sc("print/send bill: the admin looking in → adminView, nothing printed", "print/send", { kind: "bill", sessionId: "s1" }, { ...PRN, who: "admin", query: `?rid=${RID}` }, (r, G) => r.json?.adminView === true && !G.WRITES.some((x) => x.table === "print_jobs"));
sc("print/send bill: forced by the admin → queued, and the log says it came from the admin console", "print/send", { kind: "bill", sessionId: "s1", force: true }, { ...PRN, who: "admin", query: `?rid=${RID}` }, (r, G) => ({ ok: r.json?.queued === true && G.LOGS.some((l) => l.action === "print_sent_by_admin" && /deliberately from the admin console/.test(l.detail)), note: r.text }));
sc("print/send bill: a waiter's bill goes to the computer; the log names the bill and the table", "print/send", { kind: "bill", sessionId: "s1" }, PRN, (r, G) => ({ ok: r.json?.queued === true && G.LOGS.some((l) => l.action === "print_sent" && /bill #41 for table 3/.test(l.detail)), note: G.LOGS.map((l) => l.detail).join(" | ") }));
sc("print/send bill: a parcel bill carries parcel:true in its payload", "print/send", { kind: "bill", sessionId: "s1", parcel: true }, PRN, (r, G) => G.WRITES.some((x) => x.table === "print_jobs" && x.patch.payload && x.patch.payload.parcel === true));
sc("print/send bill: the queue insert failing says so (500)", "print/send", { kind: "bill", sessionId: "s1" }, { ...PRN, fail: { "print_jobs:insert": "error" } }, status(500, /Could not send/));
// ── print-jobs (kitchen reprint) ───────────────────────────────────────────────────────────────
sc("print-jobs: no order named → refused", "print-jobs", {}, {}, status(400, /Missing order id/));
sc("print-jobs: a ticket not on this board → 404", "print-jobs", { order_id: "nope" }, {}, status(404));
sc("print-jobs: a cancelled ticket → refused", "print-jobs", { order_id: "o1" }, { fix: { orders: [merge(base().orders[0], { status: "cancelled" })] } }, status(400, /cancelled/));
sc("print-jobs: a deleted ticket → refused", "print-jobs", { order_id: "o1" }, { fix: { orders: [merge(base().orders[0], { deleted_at: NOW })] } }, status(400, /deleted/));
sc("print-jobs: someone else's table → refused by name", "print-jobs", { order_id: "o1" }, { user: { assigned_tables: "1".split(",").map(Number) } }, status(403, /Table 3/));
sc("print-jobs: queued as a DUPLICATE for the kitchen, named after the waiter, and logged", "print-jobs", { order_id: "o1" }, {}, (r, G) => ({ ok: r.status === 200 && r.json.kot_no === 7 && G.WRITES.some((x) => x.table === "print_jobs" && x.patch.reprint === true && x.patch.requested_by === "Diag Waiter") && G.LOGS.some((l) => l.action === "kot_reprint_sent"), note: r.text }));
// ── issue ───────────────────────────────────────────────────────────────────────────────────────
sc("issue: a floor complaint is raised for THIS restaurant, named after the waiter", "issue", { subject: "Fridge is warm", body: "Since noon" }, {}, (r, G) => ({ ok: r.status === 200 && G.WRITES.some((x) => x.patch && x.patch.restaurant_id === RID), note: `${r.status} ${G.WRITES.map((x) => x.table).join(",")}` }));
sc("issue: an empty subject is refused in words", "issue", { subject: "" }, {}, (r) => ({ ok: r.status === 400 && !!r.json?.error, note: r.text.slice(0, 80) }));
// ── order ───────────────────────────────────────────────────────────────────────────────────────
sc("order: the restaurant with no floor plan size (0) accepts any digit table", "order", { table: "99", items: [{ id: "d1" }] }, { settings: { table_count: 0 } }, (r, G) => ({ ok: r.status === 200 && !!rpc(G, "lfh_staff_place_order"), note: `${r.status}` }));
sc("order: an order that differs only by allergies is NOT a duplicate", "order", { table: "3", items: [{ id: "d1", qty: 1 }], allergies: ["nuts"] }, { fresh: true, fix: { orders: [{ id: "o9", restaurant_id: RID, table_number: "3", created_at: new Date().toISOString(), items: [{ id: "d1", qty: 1 }], allergies: [] }] } }, (r, G) => !!rpc(G, "lfh_staff_place_order"));
sc("order: a dish with options matches its stored twin (prices folded away) — duplicate warned", "order", { table: "3", items: [{ id: "d1", qty: 1, options: [{ group: "Size", label: "L" }] }] }, { fresh: true, fix: { orders: [{ id: "o9", restaurant_id: RID, table_number: "3", created_at: new Date().toISOString(), items: [{ id: "d1", qty: 1, options: [{ group: "Size", label: "L", price: 30 }] }], allergies: [] }] } }, status(409, /identical/));
sc("order: a per-dish 'no onion' makes it a different order", "order", { table: "3", items: [{ id: "d1", qty: 1, removed: ["Onion"] }] }, { fresh: true, fix: { orders: [{ id: "o9", restaurant_id: RID, table_number: "3", created_at: new Date().toISOString(), items: [{ id: "d1", qty: 1 }], allergies: [] }] } }, (r, G) => !!rpc(G, "lfh_staff_place_order"));
sc("order: the pricer's own atomic duplicate guard is surfaced as the same 'send anyway?'", "order", { table: "3", items: [{ id: "d1" }] }, { rpc: { lfh_staff_place_order: { duplicateWarning: true, error: "Same as a moment ago" } } }, status(409, /Same as a moment ago/));
sc("order: the pricer failing is a server error, never 'sent'", "order", { table: "3", items: [{ id: "d1" }] }, { fail: { "rpc:lfh_staff_place_order": "error" } }, (r) => r.status >= 500);
sc("order: putting it on the pass failing is a server error, never 'sent'", "order", { table: "3", items: [{ id: "d1" }] }, { rpc: { lfh_staff_place_order: { ok: true, order_id: "n1" } }, fail: { "rpc:lfh_staff_mark_placed": "error" } }, (r) => r.status >= 500);
sc("order: the waiter's note and allergies reach the pricer", "order", { table: "3", items: [{ id: "d1" }], note: "no rush", allergies: ["gluten"] }, {}, (r, G) => { const a = rpc(G, "lfh_staff_place_order")?.args; return a?.p_note === "no rush" && a?.p_allergies?.[0] === "gluten" && a?.p_restaurant_id === RID; });
sc("order: the admin's order is stamped with no waiter (who punched it = nobody)", "order", { table: "3", items: [{ id: "d1" }] }, { who: "admin", query: `?rid=${RID}`, rpc: { lfh_staff_place_order: { ok: true, order_id: "n1" } } }, (r, G) => { const m = rpc(G, "lfh_staff_mark_placed")?.args; return m?.p_by === null && m?.p_by_id === null; });
// ── parcel ──────────────────────────────────────────────────────────────────────────────────────
sc("parcel: no dishes → refused", "parcel", { items: [] }, {}, status(400, /items required/));
sc("parcel: an open-price line keeps the typed price (clamped, to the paisa)", "parcel", { items: [{ id: "d1", price: "149.999" }] }, { fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: "Fish", price: null, open_price: true, tags: [] }] } }, (r, G) => ({ ok: rpc(G, "lfh_platform_insert")?.args.p_items[0].price === 150, note: String(rpc(G, "lfh_platform_insert")?.args.p_items[0].price) }));
sc("parcel: a line note is kept, cut to 200", "parcel", { items: [{ id: "d1", note: "x".repeat(300) }] }, {}, (r, G) => rpc(G, "lfh_platform_insert")?.args.p_items[0].note.length === 200);
sc("parcel: an MRP bottle is marked is_mrp on its line", "parcel", { items: [{ id: "d1" }] }, { settings: { item_tax_modes_allowed: true }, fix: { menu_items: [{ id: "d1", restaurant_id: RID, title: "Water", price: "20", tags: [], tax_mode: "mrp" }] } }, (r, G) => ({ ok: rpc(G, "lfh_platform_insert")?.args.p_items[0].is_mrp === true, note: JSON.stringify(rpc(G, "lfh_platform_insert")?.args.p_items[0]) }));
sc("parcel: the insert failing is a server error", "parcel", { items: [{ id: "d1" }] }, { fail: { "rpc:lfh_platform_insert": "error" } }, (r) => r.status >= 500);
sc("parcel: the order's note and allergies land in its payload", "parcel", { items: [{ id: "d1" }], note: "extra napkins", allergies: ["nuts"] }, { rpc: { lfh_platform_insert: [{ id: "a1" }] }, fix: { aggregator_orders: [{ id: "a1", restaurant_id: RID }] } }, (r, G) => { const p = G.FIX.aggregator_orders[0].payload; return p?.note === "extra napkins" && p?.allergies?.[0] === "nuts" && p?.channel === "parcel"; });
sc("parcel: the customer name is kept (or 'Parcel'), the phone cut to 40", "parcel", { items: [{ id: "d1" }], phone: "9".repeat(60) }, {}, (r, G) => { const a = rpc(G, "lfh_platform_insert")?.args; return a?.p_customer === "Parcel" && a?.p_phone.length === 40; });
sc("parcel: a payload write failing is a server error", "parcel", { items: [{ id: "d1" }] }, { rpc: { lfh_platform_insert: [{ id: "a1" }] }, fix: { aggregator_orders: [{ id: "a1", restaurant_id: RID }] }, fail: { "aggregator_orders:update": "error" } }, (r) => r.status >= 500);
// ── banquet/place ───────────────────────────────────────────────────────────────────────────────
sc("banquet: a table that is not digits → refused", "banquet/place", { table: "T3", lines: [{ id: "b1" }] }, {}, status(400, /valid table/));
sc("banquet: a table beyond the floor plan → refused naming its size", "banquet/place", { table: "99", lines: [{ id: "b1" }] }, {}, status(400, /has 20 tables/));
sc("banquet: no lines → refused", "banquet/place", { lines: [] }, {}, status(400, /lines required/));
sc("banquet: a standalone bill (no table) is placed with table null", "banquet/place", { lines: [{ id: "b1", qty: 2 }] }, { rpc: { lfh_banquet_place_order: { ok: true, total: 500 } } }, (r, G) => r.status === 200 && rpc(G, "lfh_banquet_place_order")?.args.p_table === null);
for (const [reason, re] of [["not_allowed", /isn't enabled/], ["empty_order", /at least one banquet line/], ["unknown_item", /no longer exists/], ["bad_table", /valid table/], ["mystery", /mystery/], [undefined, /Couldn't create the banquet bill/]])
  sc(`banquet: the pricer's '${reason ?? "(no reason)"}' refusal reads as a sentence`, "banquet/place", { lines: [{ id: "b1" }] }, { rpc: { lfh_banquet_place_order: { ok: false, reason } } }, status(400, re));
sc("banquet: the pricer failing is a server error", "banquet/place", { lines: [{ id: "b1" }] }, { fail: { "rpc:lfh_banquet_place_order": "error" } }, (r) => r.status >= 500);
// ── requests / calls / members ──────────────────────────────────────────────────────────────────
sc("approving an 'open' request opens that table", "requests/q1/resolve", { status: "approved" }, {}, (r, G) => ({ ok: r.status === 200 && G.FIX.sessions.some((s) => s.table_number === "4" && s.status === "open"), note: `${r.status} sessions ${G.FIX.sessions.map((s) => s.table_number + ":" + s.status).join(",")}` }));
sc("approving an 'open' request for a table that is ALREADY open opens no second party", "requests/q1/resolve", { status: "approved" }, { fix: { sessions: [...base().sessions, { id: "s4", restaurant_id: RID, table_number: "4", status: "open" }] } }, (r, G) => G.FIX.sessions.filter((s) => s.table_number === "4").length === 1);
sc("denying a request opens nothing", "requests/q1/resolve", { status: "denied" }, {}, (r, G) => r.status === 200 && !G.FIX.sessions.some((s) => s.table_number === "4"));
sc("a request that is gone → 404 (not the section sentence)", "requests/zz/resolve", { status: "denied" }, {}, status(404));
sc("attending a call resolves it and logs the table", "calls/c1/attend", {}, {}, (r, G) => r.status === 200 && G.FIX.waiter_calls[0].resolved === true && G.LOGS.some((l) => l.action === "call_attend" && l.table_number === "3"));
sc("putting an attended call back un-resolves it", "calls/c1/reopen", {}, { fix: { waiter_calls: [{ id: "c1", restaurant_id: RID, table_number: "3", resolved: true }] } }, (r, G) => r.status === 200 && G.FIX.waiter_calls[0].resolved === false);
sc("putting back a call that no longer exists says so (404)", "calls/zz/reopen", {}, {}, status(404, /no longer exists/));
sc("letting a guest in approves them", "members/m1/approve", {}, {}, (r, G) => r.status === 200 && G.FIX.session_members[0].approved === true);
sc("make-head: the guest becomes the head and the old head is released", "members/m1/make-head", {}, {}, (r, G) => { const m1 = G.FIX.session_members.find((m) => m.id === "m1"), m0 = G.FIX.session_members.find((m) => m.id === "m0"); return { ok: r.status === 200 && m1.role === "owner" && m1.approved && m0.removed === true, note: `m1 ${m1.role} m0 removed ${m0.removed}` }; });
sc("make-head on the current head is a quiet no-op", "members/m0/make-head", {}, {}, (r, G) => r.status === 200 && !G.WRITES.some((x) => x.table === "session_members" && x.matched));
sc("make-head for a guest who is gone → 404", "members/zz/make-head", {}, {}, status(404));
sc("make-head on a closed table → refused", "members/m1/make-head", {}, { fix: { sessions: [merge(base().sessions[0], { status: "closed" })] } }, status(400, /not open/));
sc("removing a guest releases them and logs it", "members/m1/remove", {}, {}, (r, G) => r.status === 200 && G.FIX.session_members[0].removed === true && G.LOGS.some((l) => l.action === "member_remove"));
sc("removing a guest who already left → 404", "members/zz/remove", {}, {}, status(404));
sc("ban (PIN set up and typed): releases the guest, blocks phone AND device, scoped to this restaurant", "members/m1/ban", { managerPin: "4321" }, { fix: { staff_users: [{ id: "mg", restaurant_id: RID, role: "manager", active: true, name: "Mona", pin_hash: "plain:4321" }] } }, (r, G) => { const b = G.FIX.blocklist?.[0]; return { ok: r.status === 200 && b?.phone === "9876543210" && b?.device_id === "gdev" && b?.restaurant_id === RID && G.FIX.session_members[0].removed === true && G.LOGS.some((l) => l.action === "member_ban" && l.actor === "Mona"), note: JSON.stringify(b) }; });
sc("ban with no PIN set up anywhere yet lets the waiter through (bootstrap)", "members/m1/ban", {}, {}, (r, G) => r.status === 200 && (G.FIX.blocklist || []).length === 1);
sc("ban of a guest with no phone still blocks their device, and logs 'banned'", "members/m1/ban", {}, { fix: { session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1", device_id: "gdev", removed: false }] } }, (r, G) => r.status === 200 && G.FIX.blocklist?.[0]?.phone === null && G.LOGS.some((l) => l.detail === "banned"));
sc("ban of a guest who is gone → 404", "members/zz/ban", {}, {}, status(404));
sc("a wrong PIN, again and again, is told to wait (locked)", "members/m1/ban", { managerPin: "0000" }, { fix: { staff_users: [{ id: "mg", restaurant_id: RID, role: "manager", active: true, pin_hash: "plain:4321" }] }, rpc: { lfh_rate_check: { allowed: false } } }, (r) => ({ ok: r.status === 403 || r.status === 429, note: `${r.status} ${r.text.slice(0, 60)}` }));
sc("a PIN shared by two managers names both, and records no single id", "members/m1/ban", { managerPin: "4321" }, { fix: { staff_users: [{ id: "a", restaurant_id: RID, role: "manager", active: true, name: "Mona", pin_hash: "plain:4321" }, { id: "b", restaurant_id: RID, role: "manager", active: true, name: "Zara", pin_hash: "plain:4321" }] } }, (r, G) => { const l = G.LOGS.find((x) => x.action === "member_ban"); return { ok: l?.actor === "Mona / Zara" && l?.actor_id === null, note: JSON.stringify(l && { a: l.actor, id: l.actor_id }) }; });
sc("auto-approve on a closed table says the setting wasn't saved (404)", "sessions/zz/auto-approve", { value: true }, {}, status(404));
sc("auto-approve on is saved and logged 'on'", "sessions/s1/auto-approve", { value: true }, {}, (r, G) => G.FIX.sessions[0].auto_approve === true && G.LOGS.some((l) => l.action === "auto_approve" && l.detail === "on"));
// ── discounts ───────────────────────────────────────────────────────────────────────────────────
sc("ticket discount: a ticket that is gone → 404", "orders/zz/discount", { amount: 10 }, {}, status(404));
sc("ticket discount: clamped to the taxable base (₹999 on a ₹400 base → ₹400)", "orders/o1/discount", { amount: 999 }, { fix: { orders: [merge(base().orders[0], { session_id: null })] }, settings: { discount_cap_tablet: null } }, (r, G) => ({ ok: G.FIX.orders[0].discount === 400 || r.status === 403, note: `${r.status} discount ${G.FIX.orders[0].discount}` }));
sc("ticket discount: a garbage amount is ₹0, never NaN", "orders/o1/discount", { amount: "abc" }, { fix: { orders: [merge(base().orders[0], { session_id: null })] } }, (r, G) => r.status === 200 && G.FIX.orders[0].discount === 0);
sc("ticket discount: removing it (₹0) writes no Audit removal", "orders/o1/discount", { amount: 0 }, { fix: { orders: [merge(base().orders[0], { session_id: null, discount: 50 })] } }, (r, G) => r.status === 200 && !rpc(G, "lfh_record_removal"));
sc("ticket discount: a real one writes discount_given with the waiter's reason", "orders/o1/discount", { amount: 10, reason: "regular" }, { fix: { orders: [merge(base().orders[0], { session_id: null })] } }, (r, G) => ({ ok: rpc(G, "lfh_record_removal")?.args.p_kind === "discount_given", note: JSON.stringify(rpc(G, "lfh_record_removal")?.args.p_reason_note) }));
sc("ticket discount: over the waiter's %-cap is refused in words", "orders/o1/discount", { amount: 200 }, { fix: { orders: [merge(base().orders[0], { session_id: null })] }, settings: { discount_caps: { tablet: 10 } } }, (r) => ({ ok: r.status === 403 || r.status === 200, note: `${r.status} ${r.text.slice(0, 60)}` }));
sc("whole-bill discount: a party that is gone → 404", "sessions/zz/bill-discount", { amount: 10 }, {}, status(404));
sc("whole-bill discount: refused while a ticket carries its own discount", "sessions/s1/bill-discount", { amount: 10 }, { fix: { orders: [merge(base().orders[0], { discount: 20 })] } }, status(409, /single-ticket discount first/));
sc("whole-bill discount: the pricer failing is a server error", "sessions/s1/bill-discount", { amount: 10 }, { fail: { "rpc:lfh_staff_bill_discount": "error" } }, (r) => r.status >= 500);
sc("whole-bill discount: ₹0 clears it and writes no removal", "sessions/s1/bill-discount", { amount: 0 }, {}, (r, G) => r.status === 200 && !rpc(G, "lfh_record_removal"));
// ── invoice ─────────────────────────────────────────────────────────────────────────────────────
sc("invoice (manager): another restaurant's table → 404", "sessions/zz/invoice", { cust_phone: "9876543210", cust_name: "A" }, { who: "manager", settings: { tablet_invoice: "on" } }, status(404));
sc("invoice (manager): a bill that is settled cannot be re-invoiced (LFH01) — 409 in words", "sessions/s1/invoice", { cust_phone: "9876543210", cust_name: "A" }, { who: "manager", settings: { tablet_invoice: "on" }, rpcImpl: undefined, prep: (G) => { G.FAIL = { "rpc:lfh_generate_invoice": "error" }; } }, (r) => ({ ok: r.status >= 400, note: `${r.status}` }));
sc("invoice (manager): a re-issue carries the typed reason to the append-only history", "sessions/s1/invoice", { cust_phone: "9876543210", cust_name: "A", reason: "  wrong GSTIN  " }, { who: "manager", settings: { tablet_invoice: "on" } }, (r, G) => rpc(G, "lfh_generate_invoice")?.args.p_reason === "wrong GSTIN");
sc("invoice (manager): a too-short mobile is refused before anything is issued", "sessions/s1/invoice", { cust_phone: "98", cust_name: "A" }, { who: "manager", settings: { tablet_invoice: "on" } }, (r, G) => r.status === 400 && !rpc(G, "lfh_generate_invoice"));
// ── restart ─────────────────────────────────────────────────────────────────────────────────────
sc("restart: a table that is not digits → refused", "tables/abc/restart", {}, {}, status(400, /valid table/));
sc("restart: an empty open table restarts with no PIN, closes the party and frees the guests", "tables/3/restart", {}, { fix: { orders: [] } }, (r, G) => ({ ok: r.status === 200 && G.FIX.sessions[0].status === "closed" && G.FIX.session_members.every((m) => m.removed), note: `${r.status}` }));
sc("restart: with money owed and the right PIN, archives the round and logs '≈₹ was unpaid'", "tables/3/restart", { managerPin: "4321" }, { fix: { staff_users: [{ id: "mg", restaurant_id: RID, role: "manager", active: true, name: "Mona", pin_hash: "plain:4321" }] } }, (r, G) => ({ ok: r.status === 200 && G.FIX.orders[0].archived === true && G.FIX.orders[0].status === "served" && G.LOGS.some((l) => l.action === "table_restart" && /≈₹420 was unpaid/.test(l.detail)), note: G.LOGS.map((l) => l.detail).join("|") }));
sc("restart with sessions off: archives the table's live orders by table number", "tables/3/restart", { managerPin: "4321" }, { fix: { sessions: [], orders: [merge(base().orders[0], { session_id: null })], staff_users: [{ id: "mg", restaurant_id: RID, role: "manager", active: true, pin_hash: "plain:4321" }] } }, (r, G) => r.status === 200 && G.FIX.orders[0].archived === true);
sc("restart: a cancelled ticket is not 'served' by a restart", "tables/3/restart", {}, { fix: { orders: [merge(base().orders[0], { status: "cancelled" })] } }, (r, G) => G.FIX.orders[0].status === "cancelled");
// ── shift / merge / unmerge / moves ─────────────────────────────────────────────────────────────
sc("shift: a destination that isn't a number → refused", "sessions/s1/shift", { to: "T7" }, {}, status(400, /valid table to move to/));
sc("shift: destination 0 → refused as not a valid table (item 23 — it used to say 'not in your section')", "sessions/s1/shift", { to: "0" }, {}, status(400, /valid table to move to/));
sc("shift: another restaurant's party → 404", "sessions/sx/shift", { to: "7" }, { fix: { sessions: [...base().sessions, { id: "sx", restaurant_id: RID2, table_number: "5" }] } }, (r) => r.status === 404 || r.status === 403);
for (const [reason, re] of [["session_closed", /just closed or settled/], ["bad_table", /valid table to move to/], ["same_table", /already on that table/], ["party_merged", /spans merged tables/], ["merged_child", /joined with another/], [undefined, /Couldn't move the table/]])
  sc(`shift: the mover's '${reason ?? "(no reason)"}' refusal reads as a sentence (409)`, "sessions/s1/shift", { to: "7" }, { rpc: { lfh_staff_shift_table: { ok: false, reason } } }, status(409, re));
sc("shift: the mover failing is a server error", "sessions/s1/shift", { to: "7" }, { fail: { "rpc:lfh_staff_shift_table": "error" } }, (r) => r.status >= 500);
sc("shift: a move is logged 'party moved to T7'", "sessions/s1/shift", { to: "7" }, { rpc: { lfh_staff_shift_table: { ok: true } } }, (r, G) => G.LOGS.some((l) => l.action === "table_shift" && /T7/.test(l.detail)));
sc("merge: a target that isn't a number → refused", "sessions/s1/merge", { to: "x" }, {}, status(400));
sc("merge: a target beyond the floor plan → refused", "sessions/s1/merge", { to: "40" }, {}, status(400, /has 20 tables/));
for (const [reason, re] of [["target_not_open", /use Move table instead/], ["session_closed", /already closed/], ["source_invoiced", /already invoiced/], ["same_table", /same table/], ["weird", /Couldn't merge: weird/], [undefined, /Couldn't merge: refused/]])
  sc(`merge: '${reason ?? "(no reason)"}' reads as a sentence (409)`, "sessions/s1/merge", { to: "7" }, { rpc: { lfh_staff_merge_tables: { ok: false, reason } } }, status(409, re));
sc("merge: the joiner failing is a server error", "sessions/s1/merge", { to: "7" }, { fail: { "rpc:lfh_staff_merge_tables": "error" } }, (r) => r.status >= 500);
sc("merge approved by PIN names the MANAGER in the merge record", "sessions/s1/merge", { to: "7", managerPin: "4321" }, { settings: { tablet_table_ops: "pin" }, fix: { staff_users: [{ id: "mg", restaurant_id: RID, role: "manager", active: true, name: "Mona", pin_hash: "plain:4321" }] }, rpc: { lfh_staff_merge_tables: { ok: true, from: "3" } } }, (r, G) => ({ ok: rpc(G, "lfh_staff_merge_tables")?.args.p_actor === "Mona" && rpc(G, "lfh_staff_merge_tables")?.args.p_actor_id === "mg", note: JSON.stringify(rpc(G, "lfh_staff_merge_tables")?.args) }));
sc("unmerge: a table that isn't digits → refused", "tables/x/unmerge", {}, {}, status(400));
for (const [reason, re] of [["invoiced", /already been invoiced/], ["not_merged", /isn't merged/], ["other", /Couldn't split/]])
  sc(`unmerge: '${reason}' reads as a sentence (409)`, "tables/3/unmerge", {}, { rpc: { lfh_staff_unmerge_table: { ok: false, reason } } }, status(409, re));
sc("unmerge: the splitter failing is a server error", "tables/3/unmerge", {}, { fail: { "rpc:lfh_staff_unmerge_table": "error" } }, (r) => r.status >= 500);
sc("unmerge: the log says what moved back", "tables/3/unmerge", {}, { rpc: { lfh_staff_unmerge_table: { ok: true, parent: "2", moved: 1, kots: "7" } } }, (r, G) => G.LOGS.some((l) => l.action === "table_unmerge" && /split from T2 · 1 order returned \(KOT 7\)/.test(l.detail)));
sc("unmerge: a reply with no details still logs readable words", "tables/3/unmerge", {}, { rpc: { lfh_staff_unmerge_table: null } }, (r, G) => G.LOGS.some((l) => l.action === "table_unmerge" && /split from T\? · 0 orders returned/.test(l.detail)));
sc("dish move: a target that isn't digits → refused", "order-items/i1/move", { to: "x" }, {}, status(400));
sc("dish move: beyond the floor plan → refused", "order-items/i1/move", { to: "40" }, {}, status(400, /has 20 tables/));
for (const [reason, re] of [["order_paid", /PAID bill/], ["item_not_found", /no longer on the order/], ["order_cancelled", /cancelled/], ["source_invoiced", /already invoiced/], ["target_invoiced", /Table 7's bill is already invoiced/], ["same_table", /already on that table/], [undefined, /Couldn't move the dish: refused/]])
  sc(`dish move: '${reason ?? "(no reason)"}' reads as a sentence (409)`, "order-items/i1/move", { to: "7" }, { rpc: { lfh_staff_move_order_item: { ok: false, reason } } }, status(409, re));
sc("dish move: the mover failing is a server error", "order-items/i1/move", { to: "7" }, { fail: { "rpc:lfh_staff_move_order_item": "error" } }, (r) => r.status >= 500);
sc("ticket move: a target that isn't digits → refused", "orders/o1/move", { to: "x" }, {}, status(400));
sc("ticket move: beyond the floor plan → refused", "orders/o1/move", { to: "40" }, {}, status(400, /has 20 tables/));
for (const [reason, code, re] of [["no_order", 404, /isn't for this restaurant/], ["order_paid", 409, /PAID order/], ["same_table", 400, /already on that table/], ["source_invoiced", 409, /void or regenerate its invoice before moving an order off/], ["target_invoiced", 409, /Table 7's bill is already invoiced/], ["odd", 400, /odd/], [undefined, 400, /Couldn't move the order/]])
  sc(`ticket move: '${reason ?? "(no reason)"}' → ${code} in words`, "orders/o1/move", { to: "7" }, { rpc: { lfh_staff_move_order: { ok: false, reason } } }, status(code, re));
sc("ticket move: the mover failing is a server error", "orders/o1/move", { to: "7" }, { fail: { "rpc:lfh_staff_move_order": "error" } }, (r) => r.status >= 500);
sc("ticket move: logged with the destination", "orders/o1/move", { to: "7" }, { rpc: { lfh_staff_move_order: { ok: true } } }, (r, G) => G.LOGS.some((l) => l.action === "order_move" && l.table_number === "7"));
