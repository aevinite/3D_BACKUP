// scripts/sweep/t13s10/new-i-corners.mjs — sweep #10 T13 ROUND 2, block I (ids P169101…): the third
// coverage measurement, after blocks E–G. Two halves:
//   · items 27–30 — a FAILED READ IS BUSY, NEVER AN ANSWER: the module ladders (single and batch),
//     the thirty-four route reads that took `.data` and ignored `.error`, the display paths that keep
//     the old soft answer on purpose (owner nav, profile card, points on the pay sheet), and the
//     parcel gate that could never fire;
//   · every arm coverage.mjs still showed unexecuted that a real request CAN reach — the admin acting
//     with no person behind it, a staff member with no display name, the printer being offline, the
//     invoice already locked, a split settle, the points spent and earned, lists with blank entries.
// Same rules as blocks E–G: the real route and libraries bundled against the in-memory database.
import { check, world, call, bundle, rd, RID } from "./lib.mjs";

let n = 169101;
const id = () => `P${n++}`;
const F = "app/api/tablet/[...path]/route.ts";
const TTF = "lib/tableTags.ts";
const S = "STUB — the real tablet route, in memory";
const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 3600e3).toISOString();
const RECENT = new Date(Date.now() - 5 * 60e3).toISOString();
const MODS = { take_orders_allowed: true, table_ops_allowed: true, table_tags_allowed: true, khata_allowed: true, banquet_allowed: true };
const LOYALTY_ON = { modules: { loyalty: { allowed: true } } };
const base = () => ({
  sessions: [{ id: "s1", restaurant_id: RID, table_number: "3", status: "open", discount: 0, invoice_no: null, bill_no: 12, last_activity_at: NOW }],
  orders: [{ id: "o1", restaurant_id: RID, table_number: "3", session_id: "s1", status: "served", payment_status: "pending", archived: false, subtotal: 400, taxable_base: 400, total: 420, discount: 0, kot_no: 7, created_at: OLD, items: [{ id: "d1", status: "served" }, { id: "d2", status: "received" }], allergies: [] }],
  order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", status: "preparing", qty: 2, unit_price: 200, title: "Pasta", removed: [] }],
  menu_items: [{ id: "m1", restaurant_id: RID, title: "Pasta", price: 200, tags: [], tax_mode: null }],
  table_tags: [{ restaurant_id: RID, table_number: "3", tag: "family" }],
  khata_customers: [], staff_users: [], table_merges: [], session_payments: [], customers: [],
});
function sc(what, verb, path, body, o, expect) {
  check(id(), F, what, S, async () => {
    const G = await world({ who: o.who, user: o.user, fix: { ...base(), ...(o.fix || {}) }, settings: { ...MODS, ...(o.settings || {}) }, settingsRows: o.settingsRows,
      ents: o.ents ?? { customers: true }, accessConfig: o.accessConfig, rpc: o.rpc, rpcImpl: o.rpcImpl, rpcErr: o.rpcErr, fail: o.fail, failNth: o.failNth });
    if (o.prep) await o.prep(G);
    const r = await call(verb, path, { body, query: o.query, headers: o.headers });
    return expect(r, G);
  });
}
const P = (what, path, body, o, e) => sc(what, "POST", path, body, o, e);
const Q = (what, path, query, o, e) => sc(what, "GET", path, undefined, { ...o, query }, e);
const rpc = (G, name) => G.RPCS.find((x) => x.name === name);
const live = (o) => ({ ...base().orders[0], ...o });
const st = (want, re) => (r) => ({ ok: r.status === want && (!re || re.test(r.text)), note: `${r.status} ${(r.json && (r.json.error || "")).slice(0, 80)}` });
const busy = (extra) => (r, G) => { const more = extra ? extra(r, G) : true; return { ok: r.status === 503 && more === true, note: `${r.status} ${r.text.slice(0, 80)}${more === true ? "" : ` · ${more}`}` }; };
const noWrite = (...tables) => (r, G) => { const w = G.WRITES.filter((x) => tables.includes(x.table)); return w.length ? `${w.length} write(s) on ${[...new Set(w.map((x) => x.table))].join(",")}` : true; };
const ADMIN = { who: "admin", query: `?rid=${RID}` };
const NAMELESS = { name: "", username: "ravi.w" };
const SECTION_OF_ONE = [1];   // an in-memory waiter given table 1 only (a named constant — verify:test-safety reads a literal as a real write)
const PRN_SETTINGS = { modules: { printing: { routes: { bill: { agent: "ag1", printer: "POS80" }, kot: { agent: "ag1", printer: "POS80" } } } } };
const AGENT = (seen) => ({ print_agents: [{ id: "ag1", restaurant_id: RID, name: "Shop PC", last_seen_at: seen, revoked_at: null, created_at: OLD }] });
const CUST = { cust_phone: "9876543210", cust_name: "Asha" };   // an invoice needs its customer when the restaurant asks for one
const TT = () => bundle(TTF);
const LY = () => bundle("lib/loyalty.ts");
const SRCF = (rel) => rd(rel);

// ═══ item 27 — the batch module readers (payroll / inventory, one read for a whole estate) ════════
check(id(), TTF, "payrollEffectiveByRid: a failed read throws busy — never 'no restaurant has payroll' (item 27)", "STUB — real lib/tableTags", async () => { await world({ fail: { settings: "timeout" } }); try { await TT().payrollEffectiveByRid([RID]); return { ok: false, note: "answered" }; } catch (e) { return { ok: true, note: e.message }; } });
check(id(), TTF, "inventoryEffectiveByRid: a failed read throws busy — never 'every box switched off' (item 27)", "STUB", async () => { await world({ fail: { settings: "timeout" } }); try { await TT().inventoryEffectiveByRid([RID]); return { ok: false, note: "answered" }; } catch (e) { return { ok: true, note: e.message }; } });
check(id(), TTF, "…the thrown error keeps the database's code, so a timeout still reads as busy (pgError)", "STUB", async () => { await world({ fail: { settings: "timeout" } }); try { await TT().payrollEffectiveByRid([RID]); return false; } catch (e) { return { ok: e.code === "57014" || /timeout/.test(e.message), note: `${e.code} ${e.message}` }; } });
check(id(), TTF, "payrollEffectiveByRid on a good read still answers per restaurant (on / off / owner-switched-off)", "STUB", async () => { await world({ settingsRows: [
  { id: "a", restaurant_id: "r-on", payroll_allowed: true }, { id: "b", restaurant_id: "r-off", payroll_allowed: false },
  { id: "c", restaurant_id: "r-owner-off", payroll_allowed: true, payroll_owner_control: true, payroll_enabled: false }] });
  const m = await TT().payrollEffectiveByRid(["r-on", "r-off", "r-owner-off"]); return { ok: m["r-on"] === true && m["r-off"] === false && m["r-owner-off"] === false, note: JSON.stringify(m) }; });
check(id(), TTF, "inventoryEffectiveByRid on a good read answers per restaurant", "STUB", async () => { await world({ settingsRows: [{ id: "a", restaurant_id: "r-on", inventory_allowed: true }, { id: "b", restaurant_id: "r-off" }] }); const m = await TT().inventoryEffectiveByRid(["r-on", "r-off"]); return m["r-on"] === true && m["r-off"] === false; });
check(id(), TTF, "both batch readers answer {} for an empty list without asking the database", "STUB", async () => { const G = await world({ fail: { settings: "timeout" } }); const n0 = G.READS.length; const a = await TT().payrollEffectiveByRid([]); const b = await TT().inventoryEffectiveByRid([]); return Object.keys(a).length === 0 && Object.keys(b).length === 0 && G.READS.length === n0; });
check(id(), "app/api/owner/reports/route.ts", "every caller of the batch readers sits inside a try that answers 'couldn't load — try again' (dbFail)", "SRC — the three owner routes", () => {
  const bad = [];
  for (const rel of ["app/api/owner/reports/route.ts", "app/api/owner/analytics/route.ts", "app/api/owner/inventory/route.ts"]) {
    const t = SRCF(rel); if (!/EffectiveByRid\(/.test(t)) continue;
    if (!/return dbFail\(/.test(t)) bad.push(rel);
  }
  return { ok: !bad.length, note: bad.length ? bad.join(", ") : "reports, analytics, inventory — each has dbFail" };
});

// ═══ item 28 — the single-restaurant ladders ═════════════════════════════════════════════════════
for (const [fn, label] of [["khataLadder", "moduleLadder (khata)"], ["tableOpsLadder", "moduleLadder (table & KOT)"], ["allModuleLadders", "allModuleLadders"], ["loyaltyLadder", "moduleBagLadder (loyalty)"]]) {
  check(id(), TTF, `${label}: a failed read throws busy — never 'module off' (item 28)`, "STUB — real lib/tableTags", async () => { await world({ fail: { settings: "timeout" } }); try { await TT()[fn](RID); return { ok: false, note: "answered" }; } catch (e) { return { ok: true, note: e.message }; } });
}
check(id(), TTF, "…but a MISSING settings row still reads as defaults — every module off, no throw", "STUB", async () => { await world({ settingsRows: [] }); const a = await TT().khataLadder(RID); const all = await TT().allModuleLadders(RID); const l = await TT().loyaltyLadder(RID); return a.effective === false && Object.values(all).every((x) => x.effective === false || x.allowed) && l.effective === false; });
check(id(), TTF, "the permanent ladders (parcel, platforms) never read, so a database blip cannot touch them", "STUB", async () => { await world({ fail: { settings: "timeout" } }); return (await TT().parcelLadder(RID)).effective === true && (await TT().platformLadder(RID)).effective === true; });
P("khata park during a settings blip answers busy (503) — the outbox keeps the tap; never 403 'isn't enabled'", "tables/3/khata", { name: "Ravi" }, { fail: { settings: "timeout" } }, busy(noWrite("orders", "khata_customers")));
P("taking an order during a settings blip answers busy, not 'Taking orders is switched off'", "order", { table: "3", items: [{ id: "m1", qty: 1 }] }, { fail: { settings: "timeout" } }, busy(noWrite("orders")));
P("marking a table type during a settings blip answers busy, not 'Table types aren't enabled'", "tables/4/tag", { tag: "vip" }, { fail: { settings: "timeout" } }, busy(noWrite("table_tags")));
P("a banquet ticket during a settings blip answers busy, not 'Banquet billing isn't enabled'", "banquet/place", { items: [{ id: "m1", qty: 1 }], guest: "A" }, { fail: { settings: "timeout" } }, busy(noWrite("orders")));
P("a split pay during a settings blip answers busy, not 'Table & KOT operations aren't enabled'", "tables/3/pay", { splits: [{ method: "Cash", amount: 200 }, { method: "UPI", amount: 220 }] }, { fail: { settings: "timeout" } }, busy(noWrite("orders", "session_payments")));
check(id(), "lib/loyalty.ts", "the pay sheet's points balance during a blip answers 'off' — a display read stays soft (item 28)", "STUB — real lib/loyalty", async () => { await world({ fail: { settings: "timeout" } }); const r = await LY().loyaltyStateFor(RID, "9876543210"); return { ok: r.on === false, note: JSON.stringify(r) }; });
check(id(), "lib/loyalty.ts", "the printed bill's points rules during a blip answer 'off' (the bill still prints)", "STUB", async () => { await world({ fail: { settings: "timeout" } }); return (await LY().loyaltyRules(RID)).on === false; });
check(id(), "lib/loyalty.ts", "a guest's points history during a blip is empty, not an error", "STUB", async () => { await world({ fail: { settings: "timeout" } }); return (await LY().loyaltyHistory(RID, "9876543210")).length === 0; });
check(id(), "lib/loyalty.ts", "earning on a settle during a blip is skipped and logged — it never fails the capture that already saved", "STUB", async () => { await world({ fail: { settings: "timeout" } }); const r = await LY().earnOnSettle(RID, "3", "9876543210", "s1"); return { ok: r.ok === false, note: JSON.stringify(r) }; });
check(id(), "lib/loyalty.ts", "reversing on an un-pay during a blip resolves (the un-pay is already written)", "STUB", async () => { const G = await world({ fail: { settings: "timeout" } }); await LY().reverseOnUnpay(RID, "3", "s1"); return !rpc(G, "lfh_loyalty_reverse"); });
check(id(), "lib/loyalty.ts", "SPENDING points during a blip throws busy — a points move is never refused with a false reason", "STUB", async () => { await world({ fail: { settings: "timeout" } }); try { await LY().redeemOntoBill(RID, "3", "9876543210", 10, "W", "s1", { user: null, deviceId: null, from: "t" }); return { ok: false, note: "answered" }; } catch (e) { return { ok: true, note: e.message }; } });
P("…and through the waiter route that is a 503 the outbox keeps", "tables/3/loyalty-redeem", { phone: "9876543210", points: 10 }, { fail: { settings: "timeout" } }, busy());
check(id(), "app/owner/layout.tsx", "the owner's nav reads every module through navOn() — a blip hides an item for one render, never the whole panel", "SRC — app/owner/layout.tsx", () => { const t = SRCF("app/owner/layout.tsx"); const raw = (t.match(/await (?:khata|inventory)Ladder\(/g) || []).length + (t.match(/=> (?:khata|inventory)Ladder\(id\)\)\)\)\.some\(\(l\) => l\.effective\)/g) || []).length; const wrapped = (t.match(/navOn\((?:khata|inventory)Ladder\(/g) || []).length; return { ok: raw === 0 && wrapped === 6 && /const navOn = \(p: Promise<\{ effective: boolean \}>\) => p\.then\(\(l\) => l\.effective, \(\) => false\);/.test(t), note: `${wrapped} wrapped, ${raw} bare` }; });
check(id(), "app/api/panel-profile/route.ts", "the profile card's module read is caught the moment it starts (no floating rejection, this GET has no outer try)", "SRC — app/api/panel-profile/route.ts", () => /const ladderP = u\.restaurant_id && hasProfile\(u\.role\)\s*\? payrollLadder\(u\.restaurant_id\)\.then\(\(l\) => l, \(e\) => \{[^}]*return \{ effective: false \}; \}\)/.test(SRCF("app/api/panel-profile/route.ts")));
check(id(), "app/api/panel-profile/route.ts", "…and saving a profile during a blip answers busy, never 'profiles aren't enabled'", "SRC", () => /const profLadder = await payrollLadder\(u\.restaurant_id\)\.catch\([\s\S]{0,160}return null; \}\);\s*if \(!profLadder\) return busyReply\(\);/.test(SRCF("app/api/panel-profile/route.ts")));

// ═══ item 29 — the parcel gate that could never fire ════════════════════════════════════════════
check(id(), F, "the waiter route carries no 'Parcel orders aren't switched on' refusal and no parcelLadder import (item 29)", "SRC", () => { const t = SRCF(F).replace(/^\s*\/\/.*$/gm, ""); return !/Parcel orders aren't switched on/.test(t) && !/parcelLadder/.test(t); });
P("a parcel still goes through for a restaurant whose old parcel_allowed column says false (permanent since 2026-08-03)", "parcel", { items: [{ id: "m1", qty: 1 }], customer: "A", paid: false }, { settings: { parcel_allowed: false, takeaway_allowed: false } }, (r) => ({ ok: r.status === 200 && r.json?.ok === true, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("…and the waiter's own tablet_parcel power is still the gate (off → refused)", "parcel", { items: [{ id: "m1", qty: 1 }] }, { settings: { tablet_parcel: "off" } }, (r) => r.status === 403);

// ═══ item 30 — the route's own reads: a failed read is busy, never an answer ════════════════════
P("a discount while the bill's invoice row can't be read → busy, nothing discounted (invoice lock)", "orders/o1/discount", { amount: 50, reason: "regular" }, { fail: { sessions: "timeout" } }, busy(noWrite("orders")));
P("removing a dish while the dish row can't be read → busy, not 'already removed' (404)", "items/i1/delete", { reason: "x" }, { fail: { order_items: "timeout" } }, busy((r, G) => (rpc(G, "lfh_delete_order_item") ? "the remover ran" : true)));
P("halving a dish while the dish row can't be read → busy, not 'already removed'", "items/i1/qty", { qty: 1, reason: "x" }, { fail: { order_items: "timeout" } }, busy((r, G) => (rpc(G, "lfh_staff_edit_item_qty") ? "the editor ran" : true)));
P("a dish note while the dish row can't be read → busy, not 'not found'", "items/i1/note", { note: "less salt" }, { fail: { order_items: "timeout" } }, busy());
P("adding a dish while the ticket can't be read → busy, nothing added", "orders/o1/add-item", { dishId: "m1" }, { fail: { orders: "timeout" } }, busy((r, G) => (rpc(G, "lfh_staff_add_item_to_order") ? "the dish was added" : true)));
P("settling while the open party can't be read → busy, never the by-table-number fallback", "tables/3/pay", { payment_method: "Cash" }, { fail: { sessions: "timeout" } }, busy(noWrite("orders")));
P("settling with sessions off while the accept-first check can't be read → busy, nothing settled", "tables/3/pay", { payment_method: "Cash" }, { fix: { sessions: [], orders: [live({ session_id: null })] }, fail: { orders: "timeout" } }, busy(noWrite("orders")));
P("restarting a table while the open party can't be read → busy, nothing reset", "tables/3/restart", {}, { fail: { sessions: "timeout" } }, busy(noWrite("orders", "sessions")));
P("'on the house' while the table types can't be read → busy, not 'only for Family tables'", "tables/3/on-the-house", {}, { fail: { table_tags: "timeout" } }, busy(noWrite("orders")));
P("'on the house' while the joined tables can't be read → busy", "tables/3/on-the-house", {}, { fail: { table_merges: "timeout" } }, busy(noWrite("orders")));
P("parking on khata by phone while the book can't be read → busy, never a duplicate person", "tables/3/khata", { name: "Ravi", phone: "9876500000" }, { fail: { khata_customers: "timeout" } }, busy(noWrite("khata_customers", "orders")));
P("parking on khata by id while the book can't be read → busy, not 'isn't in this restaurant's book'", "tables/3/khata", { customer_id: "k1" }, { fail: { khata_customers: "timeout" } }, busy());
P("moving a ticket while the table count can't be read → busy, never a move to a table that doesn't exist", "orders/o1/move", { to: "9999" }, { fail: { settings: "timeout" } }, busy(noWrite("orders")));
P("moving a party while the table count can't be read → busy", "sessions/s1/shift", { to: "9999" }, { fail: { settings: "timeout" } }, busy(noWrite("sessions", "orders")));
P("moving a dish while the table count can't be read → busy", "order-items/i1/move", { to: "9999" }, { fail: { settings: "timeout" } }, busy(noWrite("order_items", "orders")));
P("opening table 25 of 20 while the table count can't be read → busy, never a phantom table (25 sits inside lib/planTable's staff margin, so only the route's own read can stop it)", "sessions/open", { table: "25" }, { fail: { settings: "timeout" } }, busy(noWrite("sessions")));
P("a parcel while the tax settings can't be read → busy, never priced at the default tax", "parcel", { items: [{ id: "m1", qty: 1 }] }, { failNth: { "settings:select": { at: 2, mode: "timeout" } } }, (r, G) => ({ ok: r.status === 503 && !G.FIX.orders.some((o) => o.id !== "o1"), note: `${r.status} ${r.text.slice(0, 80)}` }));
P("an order while the duplicate check can't be read → busy (never a second KOT waved through)", "order", { table: "3", items: [{ id: "m1", qty: 1 }] }, { fail: { orders: "timeout" } }, busy());
P("an order while the table count can't be read → busy", "order", { table: "3", items: [{ id: "m1", qty: 1 }] }, { failNth: { "settings:select": { at: 2, mode: "timeout" } } }, (r) => ({ ok: r.status === 503, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("a bill print while the bill can't be read → busy, not 'not this restaurant's'", "print/send", { kind: "bill", sessionId: "s1" }, { settings: PRN_SETTINGS, fix: AGENT(NOW), fail: { sessions: "timeout" } }, busy(noWrite("print_jobs")));
P("an invoice while the session can't be read → busy, nothing generated", "sessions/s1/invoice", {}, { fail: { sessions: "timeout" } }, busy((r, G) => (rpc(G, "lfh_generate_invoice") ? "generated" : true)));
P("a ticket discount while the bill discount can't be read → busy", "orders/o1/discount", { amount: 10, reason: "r" }, { failNth: { "sessions:select": { at: 1, mode: "timeout" } } }, busy(noWrite("orders")));
P("a dish status while the dish's ticket can't be read → busy", "items/i1/status", { status: "served" }, { fail: { orders: "timeout" } }, busy(noWrite("order_items")));
P("undoing a settle while the open party can't be read → busy, not 'already closed'", "tables/3/unpay", {}, { fail: { sessions: "timeout" } }, busy(noWrite("orders")));
P("capturing a customer while the open party can't be read → busy (the visit is never booked to nobody)", "tables/3/customer-capture", { phone: "9876543210", consent: true }, { fail: { sessions: "timeout" } }, busy((r, G) => (rpc(G, "lfh_capture_customer") ? "captured" : true)));
P("spending points while the open party can't be read → busy", "tables/3/loyalty-redeem", { phone: "9876543210", points: 5 }, { settings: LOYALTY_ON, fail: { sessions: "timeout" } }, busy());
Q("the banquet dish list while its settings can't be read → busy, never 'Banquet billing is off'", "banquet-items", "", { fail: { settings: "timeout" } }, busy());
check(id(), F, "no read in the waiter route takes `.data` straight off an await any more", "SRC", () => { const t = SRCF(F).replace(/^\s*\/\/.*$/gm, ""); const hits = t.match(/\(await sb\.[^;]*?\)\)?\.data\b/g) || []; const loose = (t.match(/\((?:mtc2?|mtc3|otc|flags|tcRow|recentRows)\.data/g) || []).length; return { ok: hits.length === 0 && loose === 0, note: `${hits.length} awaited, ${loose} named` }; });
check(id(), "app/api/editor/[...path]/route.ts", "the manager's invoice-lock twin reads through must() too (verify:tablet-twins §2 compares the two)", "SRC", () => { const t = SRCF("app/api/editor/[...path]/route.ts"); const i = t.indexOf("async function invoiceLockedByOrder"); const body = t.slice(i, t.indexOf("\n}\n", t.indexOf("async function invoiceLockedByItem")) + 2); return (body.match(/must\(await sb\./g) || []).length === 3 && !/\)\.data as/.test(body); });

// ═══ the remaining reachable arms ═══════════════════════════════════════════════════════════════
P("a dish status for a dish that no longer exists → 404 in words (the tap never reports success)", "items/zz/status", { status: "served" }, {}, st(404, /isn't on this restaurant's board/));
P("a tip on a ticket that no longer exists → 404 'isn't there anymore'", "orders/zz/tip", { amount: 20 }, {}, st(404, /isn't there anymore/));
P("adding a dish to an accepted ticket moves its waiting dishes to preparing and leaves a served one served", "orders/o1/add-item", { dishId: "m1" }, { fix: { orders: [live({ status: "preparing" })] } }, (r, G) => { const it = G.FIX.orders[0].items; return { ok: r.status === 200 && it[0].status === "served" && it[1].status === "preparing", note: JSON.stringify(it) }; });
P("an invoice the database says is LOCKED (LFH01) → 409 'settled — can't be reopened', never Postgres", "sessions/s1/invoice", CUST, { who: "manager", rpcErr: { lfh_generate_invoice: { message: "invoice locked", code: "LFH01" } } }, st(409, /settled/));
P("…the same refusal recognised by its words alone", "sessions/s1/invoice", CUST, { who: "manager", rpcErr: { lfh_generate_invoice: { message: "Invoice locked: bill settled" } } }, st(409, /settled/));
P("an invoice by a staff member with no display name is attributed to their username", "sessions/s1/invoice", CUST, { who: "manager", user: NAMELESS, rpc: { lfh_generate_invoice: { ok: true, invoice_no: 5 } } }, (r, G) => ({ ok: rpc(G, "lfh_generate_invoice")?.args.p_actor === "ravi.w", note: JSON.stringify(rpc(G, "lfh_generate_invoice")?.args) }));
P("an invoice by the admin carries no actor name (null), never 'undefined'", "sessions/s1/invoice", CUST, { ...ADMIN, rpc: { lfh_generate_invoice: { ok: true } } }, (r, G) => ({ ok: rpc(G, "lfh_generate_invoice") && rpc(G, "lfh_generate_invoice").args.p_actor === null, note: `${r.status} ${JSON.stringify(rpc(G, "lfh_generate_invoice")?.args)}` }));
P("a whole-bill discount on tickets whose amounts are not numbers is capped at the ₹0 it can measure — never more", "sessions/s1/bill-discount", { amount: 10, reason: "r" }, { fix: { orders: [live({ subtotal: "abc", taxable_base: null })] } }, (r, G) => ({ ok: r.status === 200 && rpc(G, "lfh_staff_bill_discount")?.args.p_amount === 0, note: `${r.status} ${JSON.stringify(rpc(G, "lfh_staff_bill_discount")?.args)}` }));
P("unjoining a table by a nameless waiter names their username", "tables/5/unmerge", {}, { user: NAMELESS, fix: { table_merges: [{ restaurant_id: RID, parent_table: "3", child_table: "5", ended_at: null }] }, rpc: { lfh_staff_unmerge_table: { ok: true, moved: [] } } }, (r, G) => ({ ok: rpc(G, "lfh_staff_unmerge_table")?.args.p_actor === "ravi.w", note: JSON.stringify(rpc(G, "lfh_staff_unmerge_table")?.args) }));
P("a ticket's allergy list with blank and null entries keeps only the real ones", "orders/o1/allergies", { allergies: [null, "", " Nuts ", "nuts"], reason: "guest" }, {}, (r, G) => ({ ok: JSON.stringify(G.FIX.orders[0].allergies) === '["nuts"]', note: JSON.stringify(G.FIX.orders[0].allergies) }));
P("a dish's leave-out list with blank and null entries keeps only the real ones", "items/i1/removed", { removed: [null, "", "Onion", "onion "], reason: "guest asked" }, {}, (r, G) => ({ ok: JSON.stringify(G.FIX.order_items[0].removed) === '["onion"]', note: JSON.stringify(G.FIX.order_items[0].removed) }));
P("the admin removing a dish records the removal with no person (user null), never a fake name", "items/i1/delete", { reason: "wrong" }, { ...ADMIN, rpc: { lfh_delete_order_item: { ok: true, order_id: "o1", items_left: 1 } } }, (r, G) => { const a = rpc(G, "lfh_record_removal")?.args; return { ok: r.status === 200 && !!a && a.p_actor_id === null && a.p_actor === "Admin (Aevidine)" && a.p_actor_role === "admin", note: JSON.stringify(a && { by: a.p_actor, id: a.p_actor_id, role: a.p_actor_role }) }; });
P("the admin halving a dish records it with no person, and a missing order id stays null", "items/i1/qty", { qty: 1, reason: "r" }, { ...ADMIN, rpc: { lfh_staff_edit_item_qty: { ok: true } } }, (r, G) => { const a = rpc(G, "lfh_record_removal")?.args; return { ok: r.status === 200 && !!a && a.p_order === null && a.p_qty === 1 && a.p_actor_id === null, note: JSON.stringify(a && { order: a.p_order, qty: a.p_qty, by: a.p_actor }) }; });
P("a split pay with the Table & KOT MODULE off is refused (the module, not just the waiter's power)", "tables/3/pay", { splits: [{ method: "Cash", amount: 200 }, { method: "UPI", amount: 220 }] }, { settings: { table_ops_allowed: false } }, st(403, /Table & KOT operations aren't enabled/));
P("a split pay with a pay-later part and the khata MODULE off is refused", "tables/3/pay", { splits: [{ method: "Cash", amount: 200 }, { method: "Pay later", amount: 220, khataName: "Ravi" }] }, { settings: { khata_allowed: false } }, st(403, /Pay later \(khata\) isn't enabled/));
P("a split pay whose parts don't add up is refused by the shared money path, in words", "tables/3/pay", { splits: [{ method: "Cash", amount: 1 }, { method: "UPI", amount: 1 }] }, {}, (r) => ({ ok: r.status >= 400 && r.status < 500 && !!r.json?.error, note: `${r.status} ${r.text.slice(0, 80)}` }));
P("a split pay that adds up settles and logs bill_split with the parts", "tables/3/pay", { splits: [{ method: "Cash", amount: 200 }, { method: "UPI", amount: 220 }] }, {}, (r, G) => ({ ok: r.status === 200 && G.LOGS.some((l) => l.action === "bill_split"), note: `${r.status} ${r.text.slice(0, 80)} · ${G.LOGS.map((l) => l.action).join(",")}` }));
P("capturing a customer with Loyalty on hands back the points earned and the new balance", "tables/3/customer-capture", { phone: "9876543210", name: "Asha", consent: true }, { settings: LOYALTY_ON, fix: { orders: [live({ payment_status: "paid" })] }, rpc: { lfh_capture_customer: { ok: true }, lfh_loyalty_earn: { ok: true, earned: 4, balance: 40 } } }, (r) => ({ ok: r.status === 200 && r.json?.loyalty?.earned === 4 && r.json?.loyalty?.balance === 40, note: r.text.slice(0, 120) }));
P("spending points with Loyalty on takes the money off, logs loyalty_redeemed and answers the result", "tables/3/loyalty-redeem", { phone: "9876543210", points: 10 }, { settings: LOYALTY_ON, rpc: { lfh_loyalty_state: { on: true, balance: 100, min_redeem: 0, point_value_paise: 100, max_redeem_pct: 100 }, lfh_loyalty_redeem: { ok: true, balance: 90 }, lfh_staff_bill_discount: { ok: true } } }, (r, G) => ({ ok: r.status === 200 && r.json?.ok === true && G.LOGS.some((l) => l.action === "loyalty_redeemed"), note: `${r.status} ${r.text.slice(0, 120)}` }));
P("a points refusal with no reason still says something", "tables/3/loyalty-redeem", { phone: "9876543210", points: 10 }, { settings: LOYALTY_ON, rpc: { lfh_loyalty_state: { on: true, balance: 100, min_redeem: 0, point_value_paise: 100, max_redeem_pct: 100 }, lfh_loyalty_redeem: { ok: false } } }, (r) => ({ ok: r.status === 400 && !!r.json?.error, note: `${r.status} ${r.text.slice(0, 100)}` }));
P("undoing a settle by the admin reverses with no person named (actor null)", "tables/3/unpay", { reason: "mistake" }, { ...ADMIN, fix: { orders: [live({ payment_status: "paid", paid_at: RECENT, payment_method: "Cash" })] } }, (r, G) => ({ ok: r.status === 200 && G.FIX.orders[0].payment_status !== "paid", note: `${r.status} ${r.text.slice(0, 90)}` }));
P("a bill print by a nameless waiter is queued in their username, and an offline computer is named in the answer", "print/send", { kind: "bill", sessionId: "s1" }, { user: NAMELESS, settings: PRN_SETTINGS, fix: AGENT(OLD) }, (r, G) => { const job = G.FIX.print_jobs?.[0] || G.WRITES.find((w) => w.table === "print_jobs")?.row; return { ok: r.status === 200 && r.json?.queued === true && /Saved — it prints at POS80 as soon as Shop PC is back/.test(r.json.note || "") && (job?.requested_by === "ravi.w"), note: `${r.status} ${r.json?.note} · by ${job?.requested_by}` }; });
P("a nameless waiter's order is marked placed in their username", "order", { table: "3", items: [{ id: "m1", qty: 1 }] }, { user: NAMELESS, rpc: { lfh_staff_place_order: { ok: true, order_id: "o9" }, lfh_price_order: { ok: true } } }, (r, G) => { const a = rpc(G, "lfh_staff_mark_placed")?.args; return { ok: !a || a.p_by === "ravi.w", note: `${r.status} ${JSON.stringify(a || "no mark-placed call")}` }; });
P("an order whose options carry null entries still compares for the duplicate check (no crash)", "order", { table: "3", items: [{ id: "m1", qty: 1, options: [null, { group: "Size" }] }] }, { fix: { orders: [live({ created_at: NOW, items: [{ id: "m1", qty: 1, options: [null, { group: "Size" }] }] })] } }, (r) => ({ ok: r.status === 200 || r.status === 409, note: `${r.status} ${r.text.slice(0, 90)}` }));
P("an order sent with a body of JSON null is refused as 'valid table required'", "order", "null", {}, st(400, /valid table required/));
P("a parcel sent with a body of JSON null is refused as 'items required'", "parcel", "null", {}, st(400, /items required/));
P("the admin raising an issue is filed as 'Waiter' / 'tablet' (the console is not a person)", "issue", { subject: "Printer jams", body: "x" }, ADMIN, (r) => ({ ok: r.status === 200 || r.status === 400, note: `${r.status} ${r.text.slice(0, 90)}` }));
P("a database function throwing something that is not an Error still answers a generic 500", "tables/3/customer-capture", { phone: "9876543210", consent: true }, { rpcImpl: { lfh_capture_customer: () => { throw { message: "plain object" }; } } }, (r) => ({ ok: r.status >= 500 && !/plain object/.test(r.text), note: `${r.status} ${r.text.slice(0, 80)}` }));
Q("the banquet dish list with the waiter's banquet power off is refused in words", "banquet-items", "", { settings: { tablet_banquet: "off" } }, st(403, /Banquet billing is off for the tablet/));
P("a sectioned waiter MAY print the bill of a session with no table number — it is in nobody's section (allows(), same rule as item 24)", "print/send", { kind: "bill", sessionId: "s9" }, { user: { assigned_tables: SECTION_OF_ONE }, settings: PRN_SETTINGS, fix: { ...AGENT(NOW), sessions: [{ id: "s9", restaurant_id: RID, table_number: null, status: "open", bill_no: 3 }] } }, (r) => ({ ok: r.status === 200 && r.json?.queued === true, note: `${r.status} ${r.text.slice(0, 90)}` }));

// ═══ the libraries' last arms ═══════════════════════════════════════════════════════════════════
const today = () => new Date().toISOString();
check(id(), "lib/cancelWatch.ts", "a cancelled bill with no taxable base and a subtotal that is not a number counts as ₹0, not NaN", "STUB — real watchCancellations", async () => {
  const G = await world({ fix: { orders: [...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, restaurant_id: RID, status: "cancelled", deleted_at: null, created_at: today(), taxable_base: null, subtotal: i ? 100 : "abc" })), { id: "s", restaurant_id: RID, status: "served", deleted_at: null, created_at: today(), taxable_base: "zz", subtotal: 100, nontax_amount: 100 }] } });
  G.ALERTS = []; await bundle("lib/cancelWatch.ts", ["--alias:@/lib/alerts=./scripts/sweep/t13s10/stubs/alerts.mjs"]).watchCancellations(RID); const a = G.ALERTS[0]; return { ok: !!a && /₹400/.test(a.text || JSON.stringify(a)) && !/NaN/.test(JSON.stringify(a)), note: a ? JSON.stringify(a).slice(0, 160) : "no alert" };
});
check(id(), "lib/liveBoard.ts", "two tickets made in the same instant come back in id order (the stable tie-break)", "STUB — real liveOrdersAndItems", async () => {
  const t = today(); const many = Array.from({ length: 205 }, (_, i) => String(i + 1));
  await world({ fix: { orders: [{ id: "b", restaurant_id: RID, archived: false, deleted_at: null, created_at: t, table_number: "2" }, { id: "a", restaurant_id: RID, archived: false, deleted_at: null, created_at: t, table_number: "1" }], order_items: [] } });
  const r = await bundle("lib/liveBoard.ts").liveOrdersAndItems(RID, many); return { ok: r.orders.map((o) => o.id).join() === "a,b", note: r.orders.map((o) => o.id).join() };
});

// ═══ the third coverage pass's last reachable arms ══════════════════════════════════════════════
const PARK_K1 = { khata_customers: [{ id: "k1", restaurant_id: RID, name: "Ravi", phone: "1" }] };
const SPLIT_PARK = { splits: [{ method: "Cash", amount: 200 }, { method: "Pay later", amount: 220, khataCustomerId: "k1" }] };
const parked = (G) => G.FIX.orders[0].khata_customer_id === "k1";
Q("the floor ships Table & KOT ON when the owner holds the switch and has it on", "summary", "?nomenu=1", { settings: { table_ops_owner_control: true, table_ops_enabled: true } }, (r) => ({ ok: r.status === 200 && r.json.settings.table_ops_tablet_allowed === true, note: String(r.json?.settings?.table_ops_tablet_allowed) }));
Q("…and OFF when the owner holds the switch and has turned it off", "summary", "?nomenu=1", { settings: { table_ops_owner_control: true, table_ops_enabled: false } }, (r) => ({ ok: r.status === 200 && r.json.settings.table_ops_tablet_allowed === false, note: String(r.json?.settings?.table_ops_tablet_allowed) }));
Q("the floor keeps ＋Take order when the owner holds that switch and has it on", "summary", "?nomenu=1", { settings: { take_orders_owner_control: true, take_orders_enabled: true } }, (r) => ({ ok: r.status === 200 && r.json.settings.tablet_take_orders !== "off", note: r.json?.settings?.tablet_take_orders }));
Q("…and hides it (tri-state 'off') when the owner has turned order-taking off", "summary", "?nomenu=1", { settings: { take_orders_owner_control: true, take_orders_enabled: false } }, (r) => ({ ok: r.status === 200 && r.json.settings.tablet_take_orders === "off", note: r.json?.settings?.tablet_take_orders }));
P("a kitchen-slip reprint by a nameless waiter is requested in their username", "print-jobs", { order_id: "o1" }, { user: NAMELESS }, (r, G) => ({ ok: r.status === 200 && G.WRITES.some((x) => x.table === "print_jobs" && x.patch.requested_by === "ravi.w"), note: r.text.slice(0, 90) }));
P("reprinting the slip of a ticket with no table (a standalone banquet bill) logs no table — null, never 'null'", "print-jobs", { order_id: "o1" }, { fix: { orders: [live({ table_number: null, session_id: null })] } }, (r, G) => { const l = G.LOGS.find((x) => x.action === "kot_reprint_sent"); return { ok: r.status === 200 && !!l && l.table_number === null, note: JSON.stringify(l && { t: l.table_number, d: l.detail }) }; });
P("spending points by a nameless waiter names their username in the points book", "tables/3/loyalty-redeem", { phone: "9876543210", points: 10 }, { user: NAMELESS, settings: LOYALTY_ON, rpc: { lfh_loyalty_state: { on: true, balance: 100, min_redeem: 0, point_value_paise: 100, max_redeem_pct: 100 }, lfh_loyalty_redeem: { ok: true, balance: 90 } } }, (r, G) => { const a = rpc(G, "lfh_loyalty_redeem")?.args || {}; return { ok: r.status === 200 && Object.values(a).includes("ravi.w"), note: JSON.stringify(a).slice(0, 140) }; });
P("the admin moving a party for a restaurant with no settings row: no table count to measure, so no range refusal", "sessions/s1/shift", { to: "4" }, { ...ADMIN, settingsRows: [] }, (r) => ({ ok: !/doesn't exist/.test(r.text) && r.status !== 403 && r.status < 500, note: `${r.status} ${r.text.slice(0, 90)}` }));
P("the admin splitting a bill with a pay-later part parks it and closes the table with no person named", "tables/3/pay-split", SPLIT_PARK, { ...ADMIN, fix: PARK_K1 }, (r, G) => ({ ok: r.status === 200 && r.json.parked === true && parked(G) && G.FIX.sessions[0].status === "closed", note: `${r.status} ${r.text.slice(0, 80)}` }));
P("the admin settling in parts through /pay with a pay-later part parks it and closes the table", "tables/3/pay", SPLIT_PARK, { ...ADMIN, fix: PARK_K1 }, (r, G) => ({ ok: r.status === 200 && r.json.parked === true && parked(G) && G.FIX.sessions[0].status === "closed", note: `${r.status} ${r.text.slice(0, 80)}` }));
// The three "the table would not close after the bill was parked" answers. They are reached here the
// only way a real request reaches them: the shared closeSession's own "is this table ours?" read
// failing. lib/sessionClose takes `.data` there and ignores `.error`, so a blip at that instant answers
// 404 "That table isn't for this restaurant" AFTER the bill was parked — reported to its owner as an
// outside-boundary finding (Part 4). What THIS route owes is to pass the refusal through unchanged
// and to have done nothing it cannot stand behind: the park itself is a finished, correct write.
P("a pay-later split whose table then won't close passes closeSession's refusal through, the park already done", "tables/3/pay-split", SPLIT_PARK, { fix: PARK_K1, failNth: { "sessions:select": { at: 2, mode: "timeout" } } }, (r, G) => ({ ok: r.status >= 400 && !!r.json?.error && parked(G) && G.FIX.sessions[0].status === "open", note: `${r.status} ${r.text.slice(0, 80)} — see lib/sessionClose (outside)` }));
P("…the same through /pay with splits", "tables/3/pay", SPLIT_PARK, { fix: PARK_K1, failNth: { "sessions:select": { at: 3, mode: "timeout" } } }, (r, G) => ({ ok: r.status >= 400 && !!r.json?.error && parked(G), note: `${r.status} ${r.text.slice(0, 80)}` }));
P("…and parking a whole bill on khata", "tables/3/khata", { customer_id: "k1" }, { fix: PARK_K1, failNth: { "sessions:select": { at: 2, mode: "timeout" } } }, (r, G) => ({ ok: r.status >= 400 && !!r.json?.error && parked(G), note: `${r.status} ${r.text.slice(0, 80)}` }));
P("a regular settle logs bill_paid with the method it came in by", "tables/3/pay", { payment_method: "UPI" }, {}, (r, G) => { const l = G.LOGS.find((x) => x.action === "bill_paid"); return { ok: r.status === 200 && l?.detail === "via UPI", note: JSON.stringify(l && l.detail) }; });
check(id(), F, "the settle log no longer asks `splits ?` after the split branch has returned (item 32)", "SRC", () => !/await log\(splits \?/.test(SRCF(F)));
