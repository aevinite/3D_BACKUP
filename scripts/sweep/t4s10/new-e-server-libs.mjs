// Block E — the server-side table libraries RUN against a stand-in database (P173257…):
// lib/openSession.ts (opening a table, race-tolerantly), lib/sessionClose.ts (the ONE table close),
// lib/tableMerge.ts (which table holds a merged party's bill) and lib/tableAssign.ts (waiter sections).
// Every statement is recorded with its filters, so "is every write pinned to this restaurant?" is
// answered by looking, not by assuming.
import { check, band, load, FILES, W, resetWorld } from "./lib.mjs";
const HOW = "STUB — real file, stand-in database (every statement recorded)";
band(173257);
const RID = "aaaaaaaa-0000-4000-8000-000000000001";
const L = async (rel) => { resetWorld(); return load(rel); };
const OS = FILES.open, SC = FILES.close, TM = FILES.merge, TA = FILES.assign;
const has = (st, kind, col, val) => st.filters.some((f) => f.kind === kind && f.col === col && (val === undefined || f.val === val));
const scoped = (st) => has(st, "eq", "restaurant_id", RID);
const sessionsCalls = (op) => W.fromLog.filter((x) => x.table === "sessions" && x.op === op);
// ── openSession ──
check(OS, "openTableSession: a table that is already open is returned as it is — no second row", HOW, async () => {
  const m = await L(OS); W.from.sessions = (st) => (st.op === "select" ? { data: [{ id: "s1", table_number: "4" }], error: null } : { data: null, error: { message: "should not insert" } });
  const r = await m.openTableSession(RID, "4"); return { ok: r.id === "s1" && sessionsCalls("insert").length === 0, note: JSON.stringify(r) };
});
check(OS, "…the read that decides it is scoped to THIS restaurant, this table, not-closed, one row", HOW, async () => {
  const m = await L(OS); W.from.sessions = (st) => (st.op === "select" ? { data: [{ id: "s1" }], error: null } : undefined); await m.openTableSession(RID, "4");
  const st = sessionsCalls("select")[0]; return scoped(st) && has(st, "eq", "table_number", "4") && has(st, "neq", "status", "closed") && has(st, "limit", null, 1);
});
check(OS, "…a free table is opened: status open, opened_by 'waiter', THIS restaurant, an opened_at time", HOW, async () => {
  const m = await L(OS); W.from.sessions = (st) => (st.op === "select" ? { data: [], error: null } : { data: [{ id: "new", ...st.patch }], error: null });
  const r = await m.openTableSession(RID, "4"); const p = sessionsCalls("insert")[0].patch;
  return { ok: r.id === "new" && p.status === "open" && p.opened_by === "waiter" && p.restaurant_id === RID && p.table_number === "4" && !Number.isNaN(Date.parse(p.opened_at)), note: JSON.stringify(p) };
});
check(OS, "…and says who opened it when the caller says so", HOW, async () => {
  const m = await L(OS); W.from.sessions = (st) => (st.op === "select" ? { data: [], error: null } : { data: [{ id: "n" }], error: null }); await m.openTableSession(RID, "4", { openedBy: "manager" });
  return sessionsCalls("insert")[0].patch.opened_by === "manager";
});
for (const msg of ['duplicate key value violates unique constraint "idx_one_open_session_per_table"', "23505: unique violation"]) {
  check(OS, `…two devices opening at once: the loser (${msg.slice(0, 28)}…) is handed the WINNER's row, not a crash`, HOW, async () => {
    const m = await L(OS); let reads = 0; W.from.sessions = (st) => (st.op === "select" ? { data: reads++ === 0 ? [] : [{ id: "winner" }], error: null } : { data: null, error: { message: msg } });
    const r = await m.openTableSession(RID, "4").catch((e) => ({ threw: e.message })); return { ok: r.id === "winner", note: JSON.stringify(r) };
  });
}
check(OS, "…if the winner cannot be found again, the real error is raised (never an invented row)", HOW, async () => {
  const m = await L(OS); W.from.sessions = (st) => (st.op === "select" ? { data: [], error: null } : { data: null, error: { message: "duplicate key value" } });
  const r = await m.openTableSession(RID, "4").then(() => "no throw", (e) => e.message); return r === "duplicate key value";
});
check(OS, "…any OTHER insert error still throws — a real failure is never swallowed", HOW, async () => {
  const m = await L(OS); W.from.sessions = (st) => (st.op === "select" ? { data: [], error: null } : { data: null, error: { message: "permission denied" } });
  const r = await m.openTableSession(RID, "4").then(() => "no throw", (e) => e.message); return r === "permission denied";
});
check(OS, "…a FAILED first read propagates instead of looking like a free table (no insert into the unique index)", HOW, async () => {
  const m = await L(OS); W.from.sessions = (st) => (st.op === "select" ? { data: null, error: { code: "57014", message: "statement timeout" } } : { data: [{ id: "x" }], error: null });
  const r = await m.openTableSession(RID, "4").then(() => "no throw", (e) => e.code); return r === "57014" && sessionsCalls("insert").length === 0;
});
// ── sessionClose: closeBlock ──
const blk = async () => (await L(SC)).closeBlock;
for (const [what, orders, force, reason] of [
  ["nothing on the table → can close", [], false, null], ["all served and paid → can close", [{ status: "served", payment_status: "paid" }], false, null],
  ["one dish still cooking → blocked 'cooking'", [{ status: "preparing", payment_status: "paid" }], false, "cooking"],
  ["one just received → blocked 'cooking'", [{ status: "received", payment_status: "paid" }], false, "cooking"],
  ["served but unpaid → blocked 'unpaid'", [{ status: "served", payment_status: "pending" }], false, "unpaid"],
  ["a payment status nobody set counts as unpaid", [{ status: "served", payment_status: null }], false, "unpaid"],
  ["cooking AND unpaid → 'both'", [{ status: "preparing", payment_status: "pending" }], false, "both"],
  ["'ready' (on the pass) is not 'cooking'", [{ status: "ready", payment_status: "paid" }], false, null],
  ["close anyway (force) lifts every block", [{ status: "preparing", payment_status: "pending" }], true, null],
]) {
  check(SC, `closeBlock: ${what}`, HOW, async () => { const f = await blk(); const r = f(orders, force); return { ok: reason === null ? r === null : r && r.reason === reason && r.status === 409, note: JSON.stringify(r) }; });
}
check(SC, "closeBlock: every refusal says what to do next, in a sentence, with 'close anyway' offered", HOW, async () => {
  const f = await blk(); const msgs = ["cooking", "unpaid", "both"].map((k) => f(k === "cooking" ? [{ status: "preparing", payment_status: "paid" }] : k === "unpaid" ? [{ status: "served", payment_status: "x" }] : [{ status: "preparing", payment_status: "x" }], false).message);
  return msgs.every((m) => /close anyway\.$/.test(m) && m.length > 40);
});
// ── sessionClose: closeSession against the stand-in ──
const closeWorld = ({ owns = { data: { id: "s1" }, error: null }, live = [], owed = [], session = { id: "s1", restaurant_id: RID, table_number: "4" } } = {}) => {
  W.from.sessions = (st) => (st.op === "select" ? owns : { data: session ? [session] : [], error: null });
  W.from.orders = (st) => {
    if (st.op === "select" && /payment_status/.test(st.cols || "")) return { data: live, error: null };
    if (st.op === "select") return { data: owed, error: null };
    return { data: [], error: null };
  };
  W.from.session_members = { data: [], error: null };
  W.from.waiter_calls = { data: [], error: null };
  W.from.requests = { data: [], error: null };
};
const ctx = (o = {}) => ({ panel: "editor", restaurantId: RID, deviceId: "dev-1", ...o });
check(SC, "closeSession with no restaurant refuses (400) before any read — the one check that scopes eight writes", HOW, async () => {
  const m = await L(SC); closeWorld(); const r = await m.closeSession("s1", { force: true }, ctx({ restaurantId: "" })); return r.ok === false && r.status === 400 && W.fromLog.length === 0;
});
check(SC, "…a session that is not this restaurant's is 404, with nothing written", HOW, async () => {
  const m = await L(SC); closeWorld({ owns: { data: null, error: null } }); const r = await m.closeSession("s1", { force: true }, ctx());
  return r.ok === false && r.status === 404 && W.fromLog.every((x) => x.op === "select");
});
check(SC, "…a BUSY ownership read throws (busy, kept, replayed) — item 3 — and nothing is written", HOW, async () => {
  const m = await L(SC); closeWorld({ owns: { data: null, error: { code: "53300", message: "too many connections" } } });
  const r = await m.closeSession("s1", { force: true }, ctx()).then(() => "returned", (e) => e.code); return r === "53300" && W.fromLog.every((x) => x.op === "select");
});
check(SC, "…the ownership read names the session AND the restaurant", HOW, async () => { const m = await L(SC); closeWorld(); await m.closeSession("s1", { force: true }, ctx()); const st = sessionsCalls("select")[0]; return has(st, "eq", "id", "s1") && scoped(st); });
check(SC, "…an unpaid table, not forced, is refused 409 'unpaid' and NOTHING is written", HOW, async () => {
  const m = await L(SC); closeWorld({ live: [{ id: "o1", status: "served", payment_status: "pending" }] }); const r = await m.closeSession("s1", {}, ctx());
  return r.ok === false && r.status === 409 && r.reason === "unpaid" && W.fromLog.every((x) => x.op === "select");
});
check(SC, "…the blocker read is THIS session, this restaurant, live, not cancelled, and bounded (500)", HOW, async () => {
  const m = await L(SC); closeWorld(); await m.closeSession("s1", {}, ctx()); const st = W.fromLog.find((x) => x.table === "orders" && x.op === "select");
  return has(st, "eq", "session_id", "s1") && scoped(st) && has(st, "eq", "archived", false) && has(st, "neq", "status", "cancelled") && has(st, "limit", null, 500);
});
check(SC, "…the money still owed is read BEFORE the session is closed (mig 232's trigger would erase it after)", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 525, discount: 0, subtotal: 500, tax: 25, khata_at: null }] }); await m.closeSession("s1", { force: true }, ctx());
  const iOwed = W.fromLog.findIndex((x) => x.table === "orders" && x.op === "select" && /khata_at/.test(x.cols || "")); const iClose = W.fromLog.findIndex((x) => x.table === "sessions" && x.op === "update");
  return { ok: iOwed > -1 && iClose > iOwed, note: `owed read #${iOwed}, close #${iClose}` };
});
check(SC, "…a forced close of an unpaid table logs the walk-out with the amount owed, discount grossed at the order's own rate", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 525, discount: 50, subtotal: 500, tax: 25, khata_at: null }] }); await m.closeSession("s1", { force: true }, ctx());
  const la = (W.misc.log || []).find((x) => x.k === "logAction" && x.v.action === "close_unpaid"); return { ok: !!la && la.v.fields.detail === "closed with 1 unpaid order, ₹472.5 owed", note: la && la.v.fields.detail };
});
check(SC, "…and writes ONE removal-audit row per order it cancels, naming the person and the amount", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 300, subtotal: 300, tax: 0, khata_at: null }, { id: "o2", total: 200, subtotal: 200, tax: 0, khata_at: null }] });
  await m.closeSession("s1", { force: true }, ctx({ user: { id: "u1", name: "Asha" }, reason: { code: "walkout", note: "left" } }));
  const rr = (W.misc.log || []).filter((x) => x.k === "recordRemoval"); return rr.length === 2 && rr.every((x) => x.v.kind === "order_cancelled" && x.v.user.name === "Asha" && x.v.reason.code === "walkout") && rr[0].v.amount === 300;
});
check(SC, "…a khata (pay-later) order is NOT written off — it is money to collect, not a cancellation", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "k1", total: 100, subtotal: 100, tax: 0, khata_at: "2026-10-12" }, { id: "o2", total: 50, subtotal: 50, tax: 0, khata_at: null }] }); await m.closeSession("s1", { force: true }, ctx());
  const rr = (W.misc.log || []).filter((x) => x.k === "recordRemoval"); const cancel = W.fromLog.find((x) => x.table === "orders" && x.op === "update" && x.patch && x.patch.status === "cancelled");
  return rr.length === 1 && rr[0].v.orderId === "o2" && has(cancel, "is", "khata_at", null);
});
check(SC, "…the cancel touches only this session's live, unpaid, non-khata orders, in this restaurant", HOW, async () => {
  const m = await L(SC); closeWorld(); await m.closeSession("s1", { force: true }, ctx()); const st = W.fromLog.find((x) => x.table === "orders" && x.op === "update" && x.patch && x.patch.status === "cancelled");
  return has(st, "eq", "session_id", "s1") && scoped(st) && has(st, "eq", "archived", false) && has(st, "neq", "status", "cancelled") && has(st, "neq", "payment_status", "paid") && has(st, "is", "khata_at", null) && st.patch.archived === true && !!st.patch.cancelled_at;
});
check(SC, "…everything else on the session is archived (the bill record), scoped the same way", HOW, async () => {
  const m = await L(SC); closeWorld(); await m.closeSession("s1", { force: true }, ctx()); const st = W.fromLog.filter((x) => x.table === "orders" && x.op === "update").find((x) => x.patch && x.patch.archived === true && !x.patch.status);
  return !!st && has(st, "eq", "session_id", "s1") && scoped(st) && !!st.patch.archived_at;
});
check(SC, "…the head and every partner are released, so the next party joins fresh", HOW, async () => {
  const m = await L(SC); closeWorld(); await m.closeSession("s1", { force: true }, ctx()); const st = W.fromLog.find((x) => x.table === "session_members" && x.op === "update");
  return !!st && st.patch.removed === true && has(st, "eq", "session_id", "s1") && scoped(st) && has(st, "eq", "removed", false);
});
check(SC, "…the table's leftover waiter calls and join requests are cleared — no ghost 🔔 on the next party", HOW, async () => {
  const m = await L(SC); closeWorld(); await m.closeSession("s1", { force: true }, ctx()); const wc = W.fromLog.find((x) => x.table === "waiter_calls"); const rq = W.fromLog.find((x) => x.table === "requests");
  return !!wc && wc.patch.resolved === true && scoped(wc) && has(wc, "eq", "table_number", "4") && !!rq && rq.patch.status === "denied" && scoped(rq);
});
check(SC, "…EVERY statement the close makes on sessions, orders and members names this restaurant", HOW, async () => {
  const m = await L(SC); closeWorld({ owed: [{ id: "o1", total: 1, subtotal: 1, tax: 0, khata_at: null }] }); await m.closeSession("s1", { force: true }, ctx());
  const bad = W.fromLog.filter((x) => ["sessions", "orders", "session_members", "waiter_calls", "requests"].includes(x.table) && !scoped(x)); return { ok: bad.length === 0 && W.fromLog.length >= 8, note: `${W.fromLog.length} statements, ${bad.length} unscoped` };
});
check(SC, "…the close sets status closed with a time, and answers ok with the session", HOW, async () => {
  const m = await L(SC); closeWorld(); const r = await m.closeSession("s1", { force: true }, ctx()); const st = sessionsCalls("update")[0];
  return r.ok === true && r.session.id === "s1" && st.patch.status === "closed" && !Number.isNaN(Date.parse(st.patch.closed_at)) && has(st, "eq", "id", "s1") && scoped(st);
});
check(SC, "…and logs 'table_close' every time, naming the table", HOW, async () => {
  const m = await L(SC); closeWorld(); await m.closeSession("s1", { force: true }, ctx()); const la = (W.misc.log || []).find((x) => x.k === "logAction" && x.v.action === "table_close");
  return !!la && la.v.fields.table_number === "4" && la.v.fields.restaurant_id === RID;
});
check(SC, "…a failed WRITE throws (the route answers it), it is never reported as closed", HOW, async () => {
  const m = await L(SC); closeWorld(); W.from.session_members = { data: null, error: { message: "permission denied for table session_members" } };
  const r = await m.closeSession("s1", { force: true }, ctx()).then((x) => (x.ok ? "closed" : "refused"), (e) => e.message); return /permission denied/.test(r);
});
check(SC, "clearTableSignals: no restaurant or no table → nothing is asked at all", HOW, async () => { const m = await L(SC); await m.clearTableSignals(null, "4"); await m.clearTableSignals(RID, null); return W.fromLog.length === 0; });
check(SC, "…a numeric table is matched as the text the floor stores", HOW, async () => { const m = await L(SC); W.from.waiter_calls = { data: [], error: null }; await m.clearTableSignals(RID, 7); return has(W.fromLog[0], "eq", "table_number", "7"); });
check(SC, "…and a database that throws never breaks the close or restart that called it", HOW, async () => { const m = await L(SC); W.from.waiter_calls = "throw"; try { await m.clearTableSignals(RID, "4"); return true; } catch { return false; } });
// ── tableMerge ──
const mg = async () => (await L(TM)).mergeParentTable;
check(TM, "mergeParentTable: a merged child resolves to the table holding the bill, read for THIS restaurant, live merges only", HOW, async () => {
  const f = await mg(); const { supabaseAdmin } = await import("./stubs/sb.mjs"); W.from.table_merges = { data: [{ parent_table: "3" }], error: null };
  const r = await f(supabaseAdmin, RID, " 7 "); const st = W.fromLog[0]; return r === "3" && scoped(st) && has(st, "eq", "child_table", "7") && has(st, "is", "ended_at", null) && has(st, "limit", null, 1);
});
check(TM, "…an unmerged table is itself", HOW, async () => { const f = await mg(); const { supabaseAdmin } = await import("./stubs/sb.mjs"); W.from.table_merges = { data: [], error: null }; return (await f(supabaseAdmin, RID, "7")) === "7"; });
check(TM, "…a blank table answers blank without asking", HOW, async () => { const f = await mg(); const { supabaseAdmin } = await import("./stubs/sb.mjs"); return (await f(supabaseAdmin, RID, "  ")) === "" && W.fromLog.length === 0; });
check(TM, "…a failed read is NOT answered as 'not merged' (item 7) — it propagates with its code", HOW, async () => {
  const f = await mg(); const { supabaseAdmin } = await import("./stubs/sb.mjs"); W.from.table_merges = { data: null, error: { code: "57014", message: "timeout" } };
  return (await f(supabaseAdmin, RID, "7").then(() => "answered", (e) => e.code)) === "57014";
});
check(TM, "…and neither is a read that threw", HOW, async () => { const f = await mg(); const { supabaseAdmin } = await import("./stubs/sb.mjs"); W.from.table_merges = "throw"; return (await f(supabaseAdmin, RID, "7").then(() => "answered", () => "threw")) === "threw"; });
// ── tableAssign ──
const ta = async () => L(TA);
const waiter = (tables) => ({ id: "w1", role: "tablet", restaurant_id: RID, assigned_tables: tables });
check(TA, "tableAssignLadder: sections are always on — no admin rung to consult", HOW, async () => { const m = await ta(); const l = await m.tableAssignLadder(RID); return l.allowed && l.enabled && l.effective && !l.ownerControl; });
check(TA, "assignedOf: normalises and de-duplicates ('007' and 7 are one table), and ignores junk", HOW, async () => { const m = await ta(); return JSON.stringify(m.assignedOf(waiter(["007", 7, 7, "x", 0, -2, "12"]))) === '["7","12"]'; });
check(TA, "…a missing or non-list section is no tables at all (the owner's 'sees nothing' choice)", HOW, async () => { const m = await ta(); return m.assignedOf(null).length === 0 && m.assignedOf(waiter("1,2")).length === 0 && m.assignedOf({}).length === 0; });
check(TA, "waiterTables: the admin super-user and a manager/owner looking in are NOT limited (null) — and nothing is read", HOW, async () => {
  const m = await ta(); const a = await m.waiterTables(null, RID); const b = await m.waiterTables({ role: "manager" }, RID); const c = await m.waiterTables({ role: "owner" }, RID); return a === null && b === null && c === null && W.fromLog.length === 0;
});
check(TA, "…a waiter gets their own list plus the floor size, from ONE scoped settings read", HOW, async () => {
  const m = await ta(); W.from.settings = { data: { table_count: 20 }, error: null }; const l = await m.waiterTables(waiter([1, 2]), RID); const st = W.fromLog[0];
  return JSON.stringify(l) === '{"tables":["1","2"],"floor":20}' && W.fromLog.length === 1 && scoped(st) && st.cols === "table_count";
});
check(TA, "…a restaurant with no settings row keeps its old answer (floor 0)", HOW, async () => { const m = await ta(); W.from.settings = { data: null, error: null }; const l = await m.waiterTables(waiter([1]), RID); return l.floor === 0 && l.floorUnknown === undefined; });
check(TA, "…a FAILED read is 'size unknown' (item 5): no table counts as off-plan, and the failure is kept for a write to answer busy", HOW, async () => {
  const m = await ta(); W.from.settings = { data: null, error: { code: "57014", message: "timeout" } }; const l = await m.waiterTables(waiter([1]), RID); return l.floor === Infinity && l.floorUnknown && l.floorUnknown.code === "57014";
});
check(TA, "…and so is a read that threw — still an answer, never a throw (four routes call this)", HOW, async () => { const m = await ta(); W.from.settings = "throw"; const l = await m.waiterTables(waiter([1]), RID).catch(() => "threw"); return l !== "threw" && l.floor === Infinity && !!l.floorUnknown; });
for (const [what, limit, t, want] of [
  ["nobody limited → every table", null, "9", true], ["not a table number at all → not ours to hide", { tables: ["1"], floor: 20 }, "parcel", true],
  ["in their section", { tables: ["1"], floor: 20 }, "1", true], ["a padded number in their section", { tables: ["7"], floor: 20 }, "007", true],
  ["inside the floor, not theirs → hidden", { tables: ["1"], floor: 20 }, "5", false], ["the last real table, not theirs → hidden", { tables: ["1"], floor: 20 }, "20", false],
  ["OFF the floor plan (47 of 30) → visible to everyone, so an old bill can be cleared", { tables: ["1"], floor: 30 }, "47", true],
  ["…unless the floor size is unknown (item 5)", { tables: ["1"], floor: Infinity }, "47", false],
]) {
  check(TA, `allows(): ${what}`, HOW, async () => { const m = await ta(); return m.allows(limit, t) === want; });
}
check(TA, "newWaiterTables: picks are clamped to the real floor, de-duplicated and sorted", HOW, async () => { const m = await ta(); W.from.settings = { data: { table_count: 5 }, error: null }; return JSON.stringify(await m.newWaiterTables(RID, [3, "1", 9, 3, 0, "x"])) === "[1,3]"; });
check(TA, "…an empty pick is refused with the sentence the create screen shows", HOW, async () => {
  const m = await ta(); W.from.settings = { data: { table_count: 5 }, error: null }; const r = await m.newWaiterTables(RID, []).then(() => "", (e) => e.message); return /^Pick at least one table for this waiter/.test(r);
});
check(TA, "…and so is a pick that is not a list", HOW, async () => { const m = await ta(); W.from.settings = { data: { table_count: 5 }, error: null }; return (await m.newWaiterTables(RID, "1,2").then(() => "", (e) => e.message)).startsWith("Pick at least one"); });
check(TA, "…and a settings read that failed says it could not read the tables — not 'pick one' to someone who picked", HOW, async () => {
  const m = await ta(); W.from.settings = { data: null, error: { message: "timeout" } }; const r = await m.newWaiterTables(RID, [1]).then(() => "", (e) => e.message); return /^Couldn't read this restaurant's tables/.test(r);
});
check(TA, "fullFloorFor: the whole floor is 1…table_count, and nothing when there is no count", HOW, async () => {
  const m = await ta(); W.from.settings = { data: { table_count: 4 }, error: null }; const a = await m.fullFloorFor(RID); W.from.settings = { data: null, error: null }; const b = await m.fullFloorFor(RID); return a.join() === "1,2,3,4" && b.length === 0;
});
check(TA, "notYoursMessage names the table when it can, plainly and without blame", HOW, async () => { const m = await ta(); return m.notYoursMessage("7") === "Table 7 isn't in your section — ask your manager to add it." && /^That table isn't/.test(m.notYoursMessage("")); });
check(TA, "blockedReason: nobody limited → no question asked, no refusal", HOW, async () => { const m = await ta(); return (await m.blockedReason(null, RID, "tables", "9", "restart", {})) === null && !(W.misc.log || []).length; });
check(TA, "…the table the write touches is resolved for THIS restaurant", HOW, async () => { const m = await ta(); await m.blockedReason({ tables: ["1"], floor: 20 }, RID, "tables", "1", "restart", {}); const a = (W.misc.log || []).find((x) => x.k === "affected"); return a && a.v.rid === RID; });
check(TA, "…a write whose table cannot be worked out is refused (unknown must not read as allowed)", HOW, async () => { const m = await ta(); W.misc.affected = { tables: [], unknown: true }; return (await m.blockedReason({ tables: ["1"], floor: 20 }, RID, "x", "y", undefined, {})) === "That table isn't in your section — ask your manager to add it."; });
check(TA, "…a move touching ANY table outside the section is refused, naming that table", HOW, async () => { const m = await ta(); W.misc.affected = { tables: ["1", "9"], unknown: false }; return (await m.blockedReason({ tables: ["1"], floor: 20 }, RID, "orders", "o1", "move", {})) === "Table 9 isn't in your section — ask your manager to add it."; });
check(TA, "…with the floor size unknown, an outside table is answered BUSY (thrown with the read's failure), an inside one goes ahead", HOW, async () => {
  const m = await ta(); const lim = { tables: ["1"], floor: Infinity, floorUnknown: { code: "57014", message: "timeout" } };
  W.misc.affected = { tables: ["9"], unknown: false }; const out = await m.blockedReason(lim, RID, "tables", "9", "restart", {}).then(() => "allowed", (e) => e.code);
  W.misc.affected = { tables: ["1"], unknown: false }; const ins = await m.blockedReason(lim, RID, "tables", "1", "restart", {}); return out === "57014" && ins === null;
});
