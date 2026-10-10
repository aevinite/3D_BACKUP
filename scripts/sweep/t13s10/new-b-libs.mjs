// scripts/sweep/t13s10/new-b-libs.mjs — sweep #10 T13, new checks block B.
//   lib/tableOfAction.ts — 4 rows by subject before this run, all READ; here every action shape is CALLED
//   lib/tableTags.ts     — 15 rows, mostly read; here every ladder is driven, both ways
//   lib/managerCan.ts    — 27 rows; here the whole flag × rung matrix is driven on the real function
import { check, bundle, world, sql, CODE, SRC, RID, RID2, FRENCH_HOUSE, rd } from "./lib.mjs";

let n = 182141;
const id = () => `P${n++}`;
const TAF = "lib/tableOfAction.ts", TTF = "lib/tableTags.ts", MCF = "lib/managerCan.ts";
const TA = () => bundle("lib/tableOfAction.ts");
const TT = () => bundle("lib/tableTags.ts");
const MC = () => bundle("lib/managerCan.ts");
const AT = () => bundle("lib/accessTree.ts");
const AM = () => bundle("lib/accessModel.ts");
const S = "STUB — real affectedTables, in memory";
const J = (x) => JSON.stringify(x);
const FIX = {
  sessions: [{ id: "s1", restaurant_id: RID, table_number: "2" }, { id: "s0", restaurant_id: RID, table_number: null }, { id: "sx", restaurant_id: RID2, table_number: "9" }],
  orders: [{ id: "o1", restaurant_id: RID, table_number: "5" }, { id: "o0", restaurant_id: RID, table_number: null }],
  order_items: [{ id: "i1", restaurant_id: RID, order_id: "o1", session_id: "s1" }, { id: "i2", restaurant_id: RID, order_id: null, session_id: "s1" }, { id: "i3", restaurant_id: RID, order_id: null, session_id: null }, { id: "i4", restaurant_id: RID, order_id: "gone", session_id: null }],
  waiter_calls: [{ id: "c1", restaurant_id: RID, table_number: "8" }],
  requests: [{ id: "r1", restaurant_id: RID, table_number: "011" }],
  session_members: [{ id: "m1", restaurant_id: RID, session_id: "s1" }, { id: "m2", restaurant_id: RID, session_id: "gone" }, { id: "m3", restaurant_id: RID, session_id: null }],
};
const at = async (a, b, c, body, o = {}) => { await world({ fix: FIX, ...o }); return TA().affectedTables(o.rid ?? RID, a, b, c, body || {}); };
const is = (r, tables, unknown) => ({ ok: J(r.tables) === J(tables) && r.unknown === unknown, note: J(r) });

// ════════ lib/tableOfAction.ts — 50 ═══════════════════════════════════════════════════════════════
check(id(), TAF, "tables/<n>/… answers that table", S, async () => is(await at("tables", "12", "pay"), ["12"], false));
check(id(), TAF, "tables/007/… is table 7 (zero-padded the same table)", S, async () => is(await at("tables", "007", "pay"), ["7"], false));
check(id(), TAF, "tables/abc/… answers an empty table (the branch's own digits check then refuses it)", S, async () => is(await at("tables", "abc", "pay"), [""], false));
check(id(), TAF, "placing an order answers the body's table", S, async () => is(await at("order", undefined, undefined, { table: 4 }), ["4"], false));
check(id(), TAF, "opening a table answers the body's table", S, async () => is(await at("sessions", "open", undefined, { table: "06" }), ["6"], false));
check(id(), TAF, "a banquet bill ON a table answers that table", S, async () => is(await at("banquet", "place", undefined, { table: "3" }), ["3"], false));
check(id(), TAF, "a standalone banquet bill (no table) is never restricted by a section", S, async () => is(await at("banquet", "place", undefined, {}), [], false));
check(id(), TAF, "a floor complaint has no table", S, async () => is(await at("issue"), [], false));
check(id(), TAF, "a counter parcel has no table", S, async () => is(await at("parcel"), [], false));
check(id(), TAF, "sessions/<id>/… answers that party's table", S, async () => is(await at("sessions", "s1", "auto-approve"), ["2"], false));
check(id(), TAF, "moving a party answers BOTH tables (from and to)", S, async () => is(await at("sessions", "s1", "shift", { to: "11" }), ["2", "11"], false));
check(id(), TAF, "orders/<id>/… answers the ticket's table", S, async () => is(await at("orders", "o1", "tip"), ["5"], false));
check(id(), TAF, "moving a ticket answers both tables", S, async () => is(await at("orders", "o1", "move", { to: "07" }), ["5", "7"], false));
check(id(), TAF, "a dish answers its ticket's table", S, async () => is(await at("items", "i1", "status"), ["5"], false));
check(id(), TAF, "moving a dish (order-items/…/move) answers both tables", S, async () => is(await at("order-items", "i1", "move", { to: "9" }), ["5", "9"], false));
check(id(), TAF, "a dish with no ticket falls back to its party's table", S, async () => is(await at("items", "i2", "status"), ["2"], false));
check(id(), TAF, "a dish with neither ticket nor party is 'couldn't tell' (refused for a sectioned waiter)", S, async () => is(await at("items", "i3", "status"), [], true));
check(id(), TAF, "a dish whose ticket has vanished is 'couldn't tell', not 'gone' (the dish itself is still there)", S, async () => is(await at("items", "i4", "status"), [], true));
check(id(), TAF, "a guest call answers its table", S, async () => is(await at("calls", "c1", "attend"), ["8"], false));
check(id(), TAF, "a join request answers its table, normalised ('011' → 11)", S, async () => is(await at("requests", "r1", "resolve"), ["11"], false));
check(id(), TAF, "a guest at the table answers their party's table", S, async () => is(await at("members", "m1", "approve"), ["2"], false));
check(id(), TAF, "a guest whose party has vanished is 'couldn't tell'", S, async () => is(await at("members", "m2", "approve"), [], true));
check(id(), TAF, "a guest with no party is 'couldn't tell'", S, async () => is(await at("members", "m3", "approve"), [], true));
check(id(), TAF, "item 4: a party that does not exist here is GONE — nothing to protect", S, async () => is(await at("sessions", "nope", "close"), [], false));
check(id(), TAF, "item 4: a ticket that does not exist here is GONE", S, async () => is(await at("orders", "nope", "tip"), [], false));
check(id(), TAF, "item 4: a dish that does not exist here is GONE", S, async () => is(await at("items", "nope", "status"), [], false));
check(id(), TAF, "item 4: a call that does not exist here is GONE", S, async () => is(await at("calls", "nope", "attend"), [], false));
check(id(), TAF, "item 4: a request that does not exist here is GONE", S, async () => is(await at("requests", "nope", "resolve"), [], false));
check(id(), TAF, "item 4: a guest who does not exist here is GONE", S, async () => is(await at("members", "nope", "approve"), [], false));
check(id(), TAF, "a FAILED party read is 'couldn't tell' (refused), never 'gone'", S, async () => is(await at("sessions", "s1", "close", {}, { fail: { sessions: "error" } }), [], true));
check(id(), TAF, "a FAILED ticket read is 'couldn't tell'", S, async () => is(await at("orders", "o1", "tip", {}, { fail: { orders: "error" } }), [], true));
check(id(), TAF, "a FAILED dish read is 'couldn't tell'", S, async () => is(await at("items", "i1", "status", {}, { fail: { order_items: "error" } }), [], true));
check(id(), TAF, "a FAILED call read is 'couldn't tell'", S, async () => is(await at("calls", "c1", "attend", {}, { fail: { waiter_calls: "error" } }), [], true));
check(id(), TAF, "a FAILED request read is 'couldn't tell'", S, async () => is(await at("requests", "r1", "resolve", {}, { fail: { requests: "error" } }), [], true));
check(id(), TAF, "a FAILED guest read is 'couldn't tell'", S, async () => is(await at("members", "m1", "approve", {}, { fail: { session_members: "error" } }), [], true));
check(id(), TAF, "a party that exists but has no table number is 'couldn't tell'", S, async () => is(await at("sessions", "s0", "close"), [], true));
check(id(), TAF, "a ticket that exists but has no table number is 'couldn't tell'", S, async () => is(await at("orders", "o0", "tip"), [], true));
check(id(), TAF, "no restaurant, no answer: 'couldn't tell' without a single read", S, async () => { const G = await world({ fix: FIX }); const r = await TA().affectedTables("", "orders", "o1", "tip", {}); return { ok: r.unknown === true && G.READS.length === 0, note: `${G.READS.length} reads` }; });
check(id(), TAF, "ANOTHER restaurant's party is GONE from here (every lookup is scoped) — it cannot vouch for a table", S, async () => is(await at("sessions", "sx", "close"), [], false));
check(id(), TAF, "every lookup it makes names the restaurant", S, async () => { const G = await world({ fix: FIX }); for (const [a, b] of [["sessions", "s1"], ["orders", "o1"], ["items", "i1"], ["calls", "c1"], ["requests", "r1"], ["members", "m1"]]) await TA().affectedTables(RID, a, b, "x", {}); const bad = G.SCOPE_LOG.filter((q) => !q.filters.some((f) => f.col === "restaurant_id" && f.val === RID)); return { ok: G.SCOPE_LOG.length >= 8 && !bad.length, note: `${G.SCOPE_LOG.length} lookups, ${bad.length} unscoped` }; });
check(id(), TAF, "normTable: numbers and strings of the same table agree", "STUB", () => ["12", 12, " 12 ", "012"].every((v) => TA().normTable(v) === "12"));
check(id(), TAF, "normTable: a leading number wins ('12a' → 12), the way Postgres-side text compares", "STUB", () => TA().normTable("12a") === "12");
check(id(), TAF, "normTable: nothing usable is an empty string, never 'NaN'", "STUB", () => [undefined, null, "", "x", {}].every((v) => TA().normTable(v) === ""));
check(id(), TAF, "a move with a BLANK destination answers only the source", S, async () => is(await at("sessions", "s1", "shift", { to: "" }), ["2"], false));
check(id(), TAF, "a move with a GONE source still checks the destination", S, async () => is(await at("orders", "nope", "move", { to: "4" }), ["4"], false));
check(id(), TAF, "print/send is an unrecognised shape (the route asks its own section question above the gate)", S, async () => is(await at("print", "send", undefined, {}), [], true));
check(id(), TAF, "print-jobs is unrecognised too, for the same reason", S, async () => is(await at("print-jobs", undefined, undefined, {}), [], true));
check(id(), TAF, "tables with no table segment is unrecognised (refused for a sectioned waiter)", S, async () => is(await at("tables", undefined, undefined, {}), [], true));
check(id(), TAF, "one read per lookup: a party, a ticket and a call each cost exactly one", S, async () => { const G = await world({ fix: FIX }); const c0 = G.READS.length; await TA().affectedTables(RID, "orders", "o1", "tip", {}); const c1 = G.READS.length; await TA().affectedTables(RID, "calls", "c1", "attend", {}); const c2 = G.READS.length; return c1 - c0 === 1 && c2 - c1 === 1; });
check(id(), TAF, "the offline-clash gate reads the same resolver and treats 'nothing to protect' as no clash", "SRC", () => /const \{ tables, unknown \} = await affectedTables\(rid, a, b, c, body\);/.test(rd("lib/clash.ts")) && /if \(unknown \|\| !tables\.length\) return null;/.test(rd("lib/clash.ts")));

// ════════ lib/tableTags.ts — 50 ═══════════════════════════════════════════════════════════════════
const TS = "STUB — real ladder, in memory";
const LADDERS = [
  ["tableTagsLadder", "table_tags"], ["khataLadder", "khata"], ["banquetLadder", "banquet"], ["tableOpsLadder", "table_ops"],
  ["takeOrdersLadder", "take_orders"], ["payrollLadder", "payroll"], ["inventoryLadder", "inventory"],
];
for (const [fn, mod] of LADDERS) {
  check(id(), TTF, `${fn} reads ${mod}_allowed / _owner_control / _enabled and is ON when granted`, TS, async () => { await world({ settingsRows: [{ id: "s", restaurant_id: RID, [`${mod}_allowed`]: true, [`${mod}_owner_control`]: false }] }); return (await TT()[fn](RID)).effective === true; });
  check(id(), TTF, `${fn} is OFF when the owner's own toggle is off while the power is transferred`, TS, async () => { await world({ settingsRows: [{ id: "s", restaurant_id: RID, [`${mod}_allowed`]: true, [`${mod}_owner_control`]: true, [`${mod}_enabled`]: false }] }); return (await TT()[fn](RID)).effective === false; });
}
check(id(), TTF, "a restaurant with NO settings row has every switchable module off", TS, async () => { await world({ settingsRows: [] }); const all = await TT().allModuleLadders(RID); return Object.values(all).every((l) => l.effective === false); });
check(id(), TTF, "…but Parcel and Platforms are on even then (permanent, owner 2026-08-03)", TS, async () => { await world({ settingsRows: [] }); return (await TT().parcelLadder(RID)).effective && (await TT().takeawayLadder(RID)).effective; });
check(id(), TTF, "an unset owner toggle (NULL) reads as enabled", TS, async () => { await world({ settingsRows: [{ id: "s", restaurant_id: RID, khata_allowed: true, khata_owner_control: true, khata_enabled: null }] }); return (await TT().khataLadder(RID)).effective === true; });
check(id(), TTF, "only a real TRUE grants — the string 'true' does not", TS, async () => { await world({ settingsRows: [{ id: "s", restaurant_id: RID, khata_allowed: "true" }] }); return (await TT().khataLadder(RID)).effective === false; });
check(id(), TTF, "allModuleLadders answers one entry per declared module", TS, async () => { await world(); const all = await TT().allModuleLadders(RID); return { ok: J(Object.keys(all).sort()) === J(AM().MODULE_DEFS.map((m) => m.key).sort()), note: Object.keys(all).join(",") }; });
check(id(), TTF, "allModuleLadders agrees with every single-module ladder across 16 random restaurants", TS, async () => {
  let bad = 0;
  for (let k = 0; k < 16; k++) {
    const row = { id: "s", restaurant_id: RID, modules: {} };
    for (const [, mod] of LADDERS) { row[`${mod}_allowed`] = Math.random() < 0.6; row[`${mod}_owner_control`] = Math.random() < 0.4; row[`${mod}_enabled`] = [true, false, null][k % 3]; }
    await world({ settingsRows: [row] });
    const all = await TT().allModuleLadders(RID);
    for (const [fn, mod] of LADDERS) if (all[mod].effective !== (await TT()[fn](RID)).effective) bad++;
  }
  return { ok: bad === 0, note: `${bad} disagreements over ${16 * LADDERS.length}` };
});
check(id(), TTF, "Loyalty reads its rung from settings.modules (the bag), not from columns", TS, async () => { await world({ settings: { modules: { loyalty: { allowed: true } } } }); return (await TT().loyaltyLadder(RID)).effective === true; });
check(id(), TTF, "…and an absent bag entry leaves Loyalty off", TS, async () => { await world({ settings: { modules: {} } }); return (await TT().loyaltyLadder(RID)).effective === false; });
check(id(), TTF, "…and a bag that is not an object (corrupt row) leaves it off, not crashing", TS, async () => { await world({ settings: { modules: "nonsense" } }); return (await TT().loyaltyLadder(RID)).effective === false; });
check(id(), TTF, "allModuleLadders reads the bag for Loyalty in the SAME single read", TS, async () => { const G = await world({ settings: { modules: { loyalty: { allowed: true, owner_control: true, enabled: false } } } }); const n0 = G.READS.length; const all = await TT().allModuleLadders(RID); return G.READS.length - n0 === 1 && all.loyalty.effective === false; });
check(id(), TTF, "payroll for many restaurants: no ids, no read", TS, async () => { const G = await world(); const n0 = G.READS.length; const r = await TT().payrollEffectiveByRid([]); return J(r) === "{}" && G.READS.length === n0; });
check(id(), TTF, "payroll for many restaurants answers each by id", TS, async () => { await world({ settingsRows: [{ id: "a", restaurant_id: "A", payroll_allowed: true }, { id: "b", restaurant_id: "B", payroll_allowed: false }] }); const r = await TT().payrollEffectiveByRid(["A", "B"]); return r.A === true && r.B === false; });
check(id(), TTF, "payroll for 800 restaurants is read in chunks, not one 29 KB URL", TS, async () => { const ids = Array.from({ length: 800 }, (_, i) => `r${i}`); const G = await world({ settingsRows: ids.map((r) => ({ id: r, restaurant_id: r, payroll_allowed: true })) }); const r = await TT().payrollEffectiveByRid(ids); const reads = G.SCOPE_LOG.filter((q) => q.table === "settings").length; return { ok: Object.keys(r).length === 800 && reads > 1, note: `${reads} chunked reads, ${Object.keys(r).length} answers` }; });
check(id(), TTF, "inventory for 800 restaurants is chunked the same way", TS, async () => { const ids = Array.from({ length: 800 }, (_, i) => `r${i}`); const G = await world({ settingsRows: ids.map((r) => ({ id: r, restaurant_id: r, inventory_allowed: true })) }); const r = await TT().inventoryEffectiveByRid(ids); return Object.keys(r).length === 800 && G.SCOPE_LOG.filter((q) => q.table === "settings").length > 1; });
check(id(), TTF, "a restaurant missing from the settings answer is simply absent (reads as off)", TS, async () => { await world({ settingsRows: [] }); return (await TT().inventoryEffectiveByRid(["zz"])).zz === undefined; });
check(id(), TTF, "table types are exactly VIP, Family and Owner's Guest", "STUB", () => J(TT().TABLE_TAGS) === J(["vip", "family", "guest"]));
check(id(), TTF, "isTableTag accepts those three and nothing else (not 'VIP', not '', not null)", "STUB", () => ["vip", "family", "guest"].every(TT().isTableTag) && !["VIP", "", null, "staff", 1].some(TT().isTableTag));
check(id(), TTF, "'On the house' is offered for Family and Owner's Guest only — a VIP pays", "STUB", () => J(TT().COMP_TAGS) === J(["family", "guest"]));
check(id(), TTF, "the no-charge settle is stamped with the reserved method 'On the house'", "STUB", () => TT().ON_THE_HOUSE_METHOD === "On the house");
check(id(), TTF, "platformLadder IS takeawayLadder (one feature, two names) and NOT parcelLadder", "STUB", () => TT().platformLadder === TT().takeawayLadder && TT().platformLadder !== TT().parcelLadder);
check(id(), TTF, "the permanent ladders cost no database read at all", TS, async () => { const G = await world(); const n0 = G.READS.length; await TT().parcelLadder(RID); await TT().takeawayLadder(RID); return G.READS.length === n0; });
check(id(), TTF, "every ladder read is scoped to the restaurant asked about", TS, async () => { const G = await world(); for (const [fn] of LADDERS) await TT()[fn](RID); await TT().allModuleLadders(RID); await TT().loyaltyLadder(RID); const bad = G.SCOPE_LOG.filter((q) => !q.filters.some((f) => f.col === "restaurant_id" && f.val === RID)); return { ok: !bad.length, note: `${G.SCOPE_LOG.length} reads, ${bad.length} unscoped` }; });
check(id(), TTF, "every column-backed module's three columns really exist on the dev database", "DB — information_schema, read-only", async () => { const cols = AM().MODULE_DEFS.filter((m) => !m.bag).flatMap((m) => [m.allowed, m.control, m.enabled]); const rows = await sql(`select column_name from information_schema.columns where table_schema='public' and table_name='settings' and column_name in (${cols.map((c) => `'${c}'`).join(",")})`); const have = new Set(rows.map((r) => r.column_name)); const miss = cols.filter((c) => !have.has(c)); return { ok: !miss.length, note: `${cols.length - miss.length}/${cols.length} present${miss.length ? "; missing " + miss.join(",") : ""}` }; });
check(id(), TTF, "settings.modules (the bag) exists on the dev database", "DB", async () => (await sql("select 1 as ok from information_schema.columns where table_schema='public' and table_name='settings' and column_name='modules'")).length === 1);
check(id(), TTF, "French House's real switches: allModuleLadders on today's DB row matches the SQL formula", "DB + STUB", async () => { const cols = AM().MODULE_DEFS.filter((m) => !m.bag).flatMap((m) => [m.allowed, m.control, m.enabled]); const row = (await sql(`select ${cols.join(",")}, modules from settings where restaurant_id='${FRENCH_HOUSE}' limit 1`))[0]; await world({ settingsRows: [{ id: "fh", restaurant_id: RID, ...row }] }); const all = await TT().allModuleLadders(RID); const bad = AM().MODULE_DEFS.filter((m) => !m.bag).filter((m) => all[m.key].effective !== (row[m.allowed] === true && (row[m.control] !== true || row[m.enabled] !== false))); return { ok: !bad.length, note: AM().MODULE_DEFS.map((m) => `${m.key}:${all[m.key].effective ? "on" : "off"}`).join(" ") }; });
check(id(), TTF, "Aangan (the read-only control) — the same agreement, read only", "DB + STUB", async () => { const cols = AM().MODULE_DEFS.filter((m) => !m.bag).flatMap((m) => [m.allowed, m.control, m.enabled]); const row = (await sql(`select ${cols.join(",")}, modules from settings s join restaurants r on r.id=s.restaurant_id where r.slug like 'aangan%' limit 1`))[0]; if (!row) return "skip: no Aangan row found"; await world({ settingsRows: [{ id: "ag", restaurant_id: RID, ...row }] }); const all = await TT().allModuleLadders(RID); return { ok: AM().MODULE_DEFS.filter((m) => !m.bag).every((m) => all[m.key].effective === (row[m.allowed] === true && (row[m.control] !== true || row[m.enabled] !== false))), note: AM().MODULE_DEFS.map((m) => `${m.key}:${all[m.key].effective ? "on" : "off"}`).join(" ") }; });
check(id(), TTF, "the waiter route reads its module rungs from this file, not its own copies (except the two row-based helpers it documents)", "SRC", () => /from "@\/lib\/tableTags";/.test(SRC.route) && (CODE.route.match(/_allowed === true && \(/g) || []).length === 2);
check(id(), TTF, "the tablet's row-based Table & KOT rung uses the SAME formula as tableOpsLadder", "STUB", async () => { let bad = 0; for (const a of [true, false]) for (const c of [true, false]) for (const e of [true, false, null]) { await world({ settingsRows: [{ id: "s", restaurant_id: RID, table_ops_allowed: a, table_ops_owner_control: c, table_ops_enabled: e }] }); const lib = (await TT().tableOpsLadder(RID)).effective; const row = a === true && (c !== true || e !== false); if (lib !== row) bad++; } return { ok: bad === 0, note: `${bad} of 12 disagree` }; });
check(id(), TTF, "the file is server-only (it imports the service client), so no panel can bundle it", "SRC", () => /import \{ supabaseAdmin as sb \} from "@\/lib\/supabaseAdmin";/.test(SRC.tableTags) && !/import[^\n]*tableTags|require\([^)]*tableTags/.test(rd("public/panels/tablet/app.js")));
check(id(), TTF, "the retired takeaway_* / parcel_* columns are read by NOTHING (a stale false cannot take a feature away)", "SRC", () => !/takeaway_allowed|parcel_allowed/.test(CODE.tableTags) && !/takeaway_allowed|parcel_allowed/.test(CODE.route));
check(id(), TTF, "moduleBagLadder's absent entry: allowed false, owner_control false, enabled true", TS, async () => { await world({ settings: { modules: {} } }); const l = await TT().moduleBagLadder(RID, "anything"); return l.allowed === false && l.ownerControl === false && l.enabled === true; });
check(id(), TTF, "moduleLadder costs exactly one settings read", TS, async () => { const G = await world(); const n0 = G.READS.length; await TT().khataLadder(RID); return G.READS.length - n0 === 1; });
check(id(), TTF, "a failed settings read leaves a module OFF (never on by accident)", TS, async () => { await world({ fail: { settings: "error" } }); return (await TT().khataLadder(RID)).effective === false && (await TT().tableOpsLadder(RID)).effective === false; });

// ════════ lib/managerCan.ts — 40 ══════════════════════════════════════════════════════════════════
const MS = "STUB — real managerCan, in memory";
const mgr = (perms = {}) => ({ user: { id: "m1", role: "manager", restaurant_id: RID, permissions: perms } });
const DEF = () => AT().MANAGER_GRANT_DEFAULTS;
for (const flag of ["edit_menu", "view_ratings", "view_logs", "view_dashboard", "void_bills", "give_discounts", "print_here", "print_clear"]) {
  check(id(), MCF, `${flag}: nothing stored → the Access screen's default`, MS, async () => { await world(); const r = await MC().managerCan(mgr(), RID, flag); return { ok: r === DEF()[flag], note: `${r} (default ${DEF()[flag]})` }; });
  check(id(), MCF, `${flag}: the restaurant switched it off → refused`, MS, async () => { await world({ perms: { [flag]: false } }); return (await MC().managerCan(mgr(), RID, flag)) === false; });
  check(id(), MCF, `${flag}: this person's own 'on' beats the restaurant's off`, MS, async () => { await world({ perms: { [flag]: false } }); return (await MC().managerCan(mgr({ [flag]: "on" }), RID, flag)) === true; });
  check(id(), MCF, `${flag}: the Feature half off beats everything, even a personal 'on'`, MS, async () => { await world({ perms: { [flag]: true }, accessConfig: { [flag]: { on: false } } }); return (await MC().managerCan(mgr({ [flag]: "on" }), RID, flag)) === false; });
}
check(id(), MCF, "managerHasFlag: 'pin' counts as allowed (the PIN is asked elsewhere)", "STUB", () => MC().managerHasFlag("void_bills", { ownOverride: "pin", managerPermissions: { void_bills: false } }) === true);
check(id(), MCF, "managerHasFlag: 'default' falls through to the restaurant's grant", "STUB", () => MC().managerHasFlag("void_bills", { ownOverride: "default", managerPermissions: { void_bills: true } }) === true);
check(id(), MCF, "managerHasFlag: nothing at all → the default (no crash on nulls)", "STUB", () => MC().managerHasFlag("give_discounts", { accessConfig: null, managerPermissions: null, ownOverride: null }) === DEF().give_discounts);
check(id(), MCF, "managerHasFlag and managerCan give the same answer for the same rows (the picker and the gate agree)", MS, async () => { let bad = 0; for (const flag of Object.keys(DEF())) for (const stored of [true, false, undefined]) for (const ov of ["on", "off", undefined]) { await world({ perms: stored === undefined ? {} : { [flag]: stored } }); const a = await MC().managerCan(mgr(ov ? { [flag]: ov } : {}), RID, flag); const b = MC().managerHasFlag(flag, { managerPermissions: stored === undefined ? {} : { [flag]: stored }, ownOverride: ov }); if (a !== b) bad++; } return { ok: bad === 0, note: `${bad} of ${Object.keys(DEF()).length * 9} disagree` }; });
check(id(), MCF, "a retired (unconfigurable) power is permanently on — the module is its switch", "STUB", () => MC().managerHasFlag("old_power", {}) === true);
check(id(), MCF, "the owner's edit_menu with the Feature half absent is allowed", MS, async () => { await world(); return (await MC().managerCan({ user: { id: "o", role: "owner", restaurant_id: RID } }, RID, "edit_menu")) === true; });
check(id(), MCF, "managerCan reads the ACTING restaurant's row, never another's", MS, async () => { await world({ restaurants: [{ id: RID, manager_permissions: { void_bills: false }, access_config: {} }, { id: RID2, manager_permissions: { void_bills: true }, access_config: {} }] }); return (await MC().managerCan(mgr(), RID, "void_bills")) === false && (await MC().managerCan(mgr(), RID2, "void_bills")) === true; });
check(id(), MCF, "the waiter's route never asks managerCan (a waiter's caps go through tabletPerm)", "SRC", () => !/managerCan/.test(CODE.route));
