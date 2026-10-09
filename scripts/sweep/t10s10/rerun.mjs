// scripts/sweep/t10s10/rerun.mjs — the OLDER ledger rows whose subject is MY half of the manager
// route, re-run under their ORIGINAL ids (sweep #10 T10, 2026-10-09). Rows about the first half
// carry a "S10-T9" stamp and are terminal 9's; rows about the waiter tablet or the kitchen route
// (tabletPerm, managerPinGate, logAction("kitchen"…)) belong to those routes' terminals.
//
//   node scripts/sweep/t10s10/rerun.mjs            # run, print
//   node scripts/sweep/t10s10/rerun.mjs --ledger   # one table row per check, for the write-back
import { execFileSync } from "node:child_process";
import { check, runAll, src, branch, rd, world, call, ROOT } from "./lib.mjs";

const guard = (args) => {
  try { const out = execFileSync("npm", ["run", "--silent", ...args], { cwd: ROOT, stdio: "pipe", timeout: 400000 }).toString(); return { ok: true, out }; }
  catch (e) { return { ok: false, out: String(e.stdout || "").slice(-600) + String(e.stderr || "").slice(-300) }; }
};
const memo = new Map();
const once = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
const B = (t) => branch(t);
const has = (t, re) => re.test(t);

// ── T10.md (sweep #6/#7 — guest & staff-panel API routes) ─────────────────────────────────────
check("P04580", "An issue photo lands in the private bucket, read back through a signed link", "read lib/mediaLinks PRIVATE_BUCKETS + the route's signRows",
  () => /issue-media/.test(rd("lib/mediaLinks.ts")) && /signRows\(/.test(src));
check("P04775", "`print-jobs/claim` caps the id list at 20", "read the branch",
  () => has(B('a === "print-jobs" && b === "claim"'), /\.slice\(0, 20\)/));
check("P04776", "`print-jobs/:id/done` ok:true resolves every open printer problem", "read lib/printQueue finishKotJob",
  () => /printer_events[\s\S]{0,400}resolved/.test(rd("lib/printQueue.ts")) && has(B('a === "print-jobs" && c === "done"'), /finishKotJob\(rid/));
check("P04854", "`requests/:id/resolve` only resolves a STILL-PENDING request", "read the branch",
  () => has(B('a === "requests" && c === "resolve"'), /\.eq\("status", "pending"\)/));
check("P04859", "`members/:id/approve` 404s when the guest has left", "STUB: approve a member that is not there",
  async () => { await world(); const r = await call("POST", "members/m-gone/approve", { body: {} }); return { ok: r.status === 404, note: `${r.status}` }; });
check("P04860", "`members/:id/make-head` refuses when the table is not open", "STUB: a member on a closed session",
  async () => { await world({ fix: { session_members: [{ id: "m1", session_id: "s1", role: "guest", removed: false, restaurant_id: "rest-1" }], sessions: [{ id: "s1", status: "closed", restaurant_id: "rest-1" }] } });
    const r = await call("POST", "members/m1/make-head", { body: {} }); return { ok: r.status === 400 && /not open/.test(r.text), note: `${r.status} ${r.text.slice(0, 60)}` }; });
check("P04861", "`members/:id/remove` 404s and is logged", "STUB: remove a gone member, then a present one",
  async () => { const G = await world({ fix: { session_members: [{ id: "m1", session_id: "s1", restaurant_id: "rest-1", removed: false }] } });
    const a = await call("POST", "members/nobody/remove", { body: {} }); const b = await call("POST", "members/m1/remove", { body: {} });
    return { ok: a.status === 404 && b.status === 200 && G.LOGS.some((l) => l.action === "member_remove"), note: `${a.status}/${b.status}` }; });
check("P04865", "`orders/:id/discount` is scoped by restaurant as well as gated", "read the branch",
  () => { const t = B('a === "orders" && c === "discount"'); return /managerCan\(g, rid, "give_discounts"\)/.test(t) && (t.match(/\.eq\("restaurant_id", rid\)/g) || []).length >= 3; });
check("P04872", "`sessions/:id/invoice` confirms the session is this restaurant's first", "read the branch",
  () => has(B('a === "sessions" && c === "invoice"'), /ownsGen[\s\S]{0,200}\.eq\("restaurant_id", rid\)[\s\S]{0,200}if \(!ownsGen\)/));
check("P04876", "`tables/:t/restart` resolves a merged child to its parent", "read the branch",
  () => has(B('a === "tables" && c === "restart"'), /mergeParentTable\(sb, rid, tRaw\)/));
check("P04885", "`sessions/:id/merge` validates the target table against table_count", "STUB: merge into table 99 of a 20-table restaurant",
  async () => { await world({ user: {}, fix: { sessions: [{ id: "s1", restaurant_id: "rest-1", status: "open" }] }, settings: { table_ops_allowed: true } });
    const r = await call("POST", "sessions/s1/merge", { body: { to: "99" } }); return { ok: r.status === 400 && /out of range/.test(r.text), note: `${r.status} ${r.text.slice(0, 60)}` }; });
check("P04888", "`order-items/:id/move` is table-ops gated and target-validated", "read the branch",
  () => { const t = B('a === "order-items" && c === "move"'); return /tableOpsGate\(g, rid\)/.test(t) && /tableCountIm/.test(t); });
check("P04889", "`items/:id/status` 404s when the update matched no row", "STUB: serve a dish that is gone",
  async () => { await world(); const r = await call("POST", "items/i-gone/status", { body: { status: "served" } }); return { ok: r.status === 404, note: `${r.status}` }; });
check("P04765", "`items/:id/status` 404s when the update matched no row (manager twin)", "STUB, as P04889",
  async () => { await world(); const r = await call("POST", "items/i-gone/status", { body: { status: "preparing" } }); return { ok: r.status === 404, note: `${r.status}` }; });
check("P04766", "`items/:id/status` clears `served_at` for any pre-served status", "read the branch",
  () => has(B('a === "items" && c === "status"'), /patch\.served_at = status === "served" \? nowIso\(\) : null/));
check("P04891", "`orders/:id/serve-all` refuses a CANCELLED ticket", "STUB: serve-all on a cancelled order",
  async () => { const G = await world({ fix: { orders: [{ id: "o1", restaurant_id: "rest-1", status: "cancelled", items: [{ id: "d", status: "received" }] }] } });
    const r = await call("POST", "orders/o1/serve-all", { body: {} }); return { ok: r.status === 409 && G.FIX.orders[0].status === "cancelled", note: `${r.status}` }; });
check("P04892", "`orders/:id/allergies` 404s when the order is gone", "STUB",
  async () => { await world(); const r = await call("POST", "orders/o-gone/allergies", { body: { allergies: ["nuts"], reason_note: "x" } }); return { ok: r.status === 404, note: `${r.status}` }; });
check("P04893", "`orders/:id/allergies` stamps `edited_at` and the per-dish ＋/✎− marks", "read the branch",
  () => { const t = B('a === "orders" && c === "allergies"'); return /edited_at: nowIso\(\)/.test(t) && /added_allergens/.test(t) && /removed_flag/.test(t); });
check("P04894", "`items/:id/delete` confirms the dish is this restaurant's first", "STUB: delete a dish that is not this restaurant's",
  async () => { const G = await world({ fix: { order_items: [{ id: "i1", restaurant_id: "rest-2", order_id: "o9" }] } });
    const r = await call("POST", "items/i1/delete", { body: {} }); return { ok: r.status === 404 && !G.RPCS.some((c) => c.name === "lfh_delete_order_item"), note: `${r.status}` }; });
check("P04895", "`items/:id/delete` writes a Removals row with the dish's own worth", "read the branch",
  () => has(B('a === "items" && c === "delete"'), /amount: \(Number\(gone\.unit_price\) \|\| 0\) \* \(Number\(gone\.qty\) \|\| 1\)/));
check("P04896", "`items/:id/delete` stamps `edited_at`", "read the branch", () => has(B('a === "items" && c === "delete"'), /stampEdited\(/));
check("P04897", "`items/:id/qty` records a REDUCTION only", "read the branch", () => has(B('a === "items" && c === "qty"'), /if \(qty < wasQty\)/));
check("P04907", "`orders/:id/move` is table-ops gated and validates the target", "read the branch",
  () => { const t = B('a === "orders" && c === "move"'); return /tableOpsGate\(g, rid\)/.test(t) && /tableCountMv/.test(t); });
check("P04909", "`tables/:t/pay-split` delegates the arithmetic to `lib/paySplit`", "read the branch",
  () => has(B('a === "tables" && c === "pay-split"'), /settleBillInParts\(sb,/));
check("P04919", "customer-capture is gated by the `customers` entitlement", "STUB: entitlement off",
  async () => { await world({ ents: { customers: false } }); const r = await call("POST", "customer-capture", { body: { table: "3", phone: "9", consent: true } }); return { ok: r.status === 403, note: `${r.status}` }; });
check("P04921", "`tables/:t/on-the-house` requires a comp mark on ANY member of the party", "read the branch",
  () => { const t = B('a === "tables" && c === "on-the-house"'); return /partyKids/.test(t) && /COMP_TAGS\.includes/.test(t); });
check("P04923", "on-the-house refuses when nothing is unpaid", "read the branch", () => has(B('a === "tables" && c === "on-the-house"'), /Nothing to settle on this table\.", 409/));
check("P04924", "on-the-house writes one Removals row per order", "read the branch", () => has(B('a === "tables" && c === "on-the-house"'), /for \(const o of unpaid\) \{\s*await recordRemoval/));
check("P04925", "`tables/:t/khata` refuses while food is still cooking", "read the branch", () => has(B('a === "tables" && c === "khata"'), /still has orders cooking[\s\S]{0,90}409/));
check("P04934", "`sessions/:id/close` with `force` runs the close-unpaid gate", "read the branch + lib/sessionClose",
  () => has(B('a === "sessions" && c === "close"'), /closeSession\(b, \{ force:/) && /close_unpaid/.test(rd("lib/sessionClose.ts")));
check("P19757", "print-station/take refuses when automatic printing is off for the restaurant", "read the branch + counterPrintTarget",
  () => has(B('a === "print-station" && b === "take"'), /if \(!t2\.mayPrint\) return err/) && /auto_print_kot === true && st\?\.auto_print_kot_allowed === true/.test(src));
check("P19758", "print-station/take refuses when the admin routed tickets elsewhere than the counter", "read counterPrintTarget",
  () => /const panelOk = route\.kind === "screen" \? route\.panel === "manager" : false/.test(src));
check("P19759", "print-station/take refuses a browser with no device id, out loud", "STUB: no device id",
  () => has(B('a === "print-station" && b === "take"'), /if \(!dv2\) return err\("This browser has no device id yet/));
check("P19784", "print-jobs/:id/done 404s when the job is gone", "read the branch", () => has(B('a === "print-jobs" && c === "done"'), /if \(!r\.found\) return err\("That print job is gone\.", 404\)/));
// ── T14 ────────────────────────────────────────────────────────────────────────────────────
for (const id of ["P06947", "P22074", "P47771"]) check(id, "A complaint raised from a panel's 🚩 reaches the owner's Complaints tab", "STUB: POST /issue → raiseIssue → issues row",
  async () => { const G = await world({ fix: { issues: [] } }); const r = await call("POST", "issue", { body: { subject: "Fridge", body: "warm" } });
    const w = G.WRITES.find((x) => x.table === "issues"); return { ok: r.status === 200 && !!w && w.patch && w.patch.restaurant_id === "rest-1", note: `${r.status} · issues insert ${!!w}` }; });
for (const id of ["P06956", "P22081", "P47778"]) check(id, "An order taken in owner Manager mode is logged as the owner, not a shadow manager", "STUB: owner places an order; read the actor on the order_place line",
  async () => { const G = await world({ who: "owner", settings: { take_orders_allowed: true }, rpc: { lfh_staff_place_order: { ok: true, order_id: "o1" } } });
    const r = await call("POST", "order", { body: { table: "2", items: [{ id: "x", qty: 1 }] } }); const l = G.LOGS.find((x) => x.action === "order_place");
    return { ok: r.status === 200 && l && l.actor === "Owner" && l.actor_id === "o1", note: `${r.status} actor=${l && l.actor}` }; });
check("P22079", "\"handled by\" on a rating is written as a NAME by the manager route", "read ratings/ack",
  () => has(B('a === "ratings" && b === "ack"'), /const who = g\.user\?\.name \|\| g\.user\?\.username \|\| "Manager"/));
// ── T15 ────────────────────────────────────────────────────────────────────────────────────
check("P22146", "the server actually asks for it — the manager route reads print_here", "read print-jobs/claim", () => has(B('a === "print-jobs" && b === "claim"'), /managerCan\(g, rid, "print_here"\)/));
check("P22550", "the print permission reaches the manager route from the REQUEST, not the panel's word", "STUB: a manager without print_here claims",
  async () => { await world({ perms: { print_here: false } }); const r = await call("POST", "print-jobs/claim", { body: { ids: ["j1"] } });
    return { ok: r.status === 200 && r.json && Array.isArray(r.json.won) && r.json.won.length === 0, note: `${r.status} ${r.text.slice(0, 80)}` }; });
// ── T20 ────────────────────────────────────────────────────────────────────────────────────
check("P52259", "the manager panel's OWN void refuses an already-voided bill", "STUB: void a reopened bill",
  async () => { await world({ perms: { void_bills: true }, fix: { sessions: [{ id: "s1", restaurant_id: "rest-1", invoice_no: "7", invoice_voided: true }] } });
    const r = await call("POST", "sessions/s1/void-invoice", { body: { reason: "x" } }); return { ok: r.status === 409 && /already reopened/.test(r.text), note: `${r.status}` }; });
check("P52268", "…in the SAME words the manager's void uses, so the two screens agree", "npm run verify:read-guards",
  () => once("rg", () => guard(["verify:read-guards"])));
// ── T24 / T30 / T18 / T23 / T5 / T6 / T25-S8 ───────────────────────────────────────────────────
check("P11712", "the manager route's split call and the tablet route's split call reach the same function with the same arguments", "read both routes",
  () => /settleBillInParts\(sb, \{ rid, table: t, splits: splitParts \}\)/.test(src) && /settleBillInParts\(sb,/.test(rd("app/api/tablet/[...path]/route.ts")));
check("P29829", "the manager cannot hide a sale — cancel is the only route out of a bill", "npm run verify:one-bill-delete",
  () => once("obd", () => guard(["verify:one-bill-delete"])));
check("P29848", "a reopened bill DOES write an audit row", "read void-invoice", () => has(B('a === "sessions" && c === "void-invoice"'), /recordRemoval\(\{\s*rid, kind: "invoice_voided"/));
check("P29852", "a cancel writes an audit row naming the person, the reason, the KOT and the bill", "STUB: PATCH status cancelled",
  async () => { const G = await world({ fix: { orders: [{ id: "o1", restaurant_id: "rest-1", status: "preparing", payment_status: "pending", session_id: "s1", table_number: "4" }] }, rpc: { lfh_record_removal: 1 } });
    const r = await call("PATCH", "orders/o1", { body: { status: "cancelled", reason_code: "mistake" } });
    const rr = G.RPCS.find((c) => c.name === "lfh_record_removal"); return { ok: r.status === 200 && rr && rr.args.p_kind === "order_cancelled" && rr.args.p_order === "o1" && rr.args.p_actor, note: `${r.status} ${rr ? rr.args.p_kind : "no audit"}` }; });
check("P23690", "the credit-note amount is rounded to paise and a non-number is refused visibly", "STUB: amount 'abc'",
  async () => { await world({ perms: { void_bills: true }, fix: { sessions: [{ id: "s1", restaurant_id: "rest-1" }] } }); const r = await call("POST", "sessions/s1/credit-note", { body: { amount: "abc", reason: "x" } });
    return { ok: r.status === 400 && /greater than zero/.test(r.text) && /Math\.round\(\(Number\(body\?\.amount\) \|\| 0\) \* 100\) \/ 100/.test(src), note: `${r.status}` }; });
check("P23692", "the credit-note endpoint is wrapped in withIdempotency on the server too", "read the POST export",
  () => /export const POST = withIdempotency\(invalidateFloorAfter\(postImpl\), "editor"\)/.test(src));
check("P11433", "merging two tables leaves the child's VIP mark on the child, and on-the-house still works", "read on-the-house: the party's children's marks are consulted",
  () => has(B('a === "tables" && c === "on-the-house"'), /\.in\("table_number", \[t, \.\.\.partyKids\.map/));
check("P35185", "reopen-table exists and is gated by the same money power", "read the branch",
  () => has(B('a === "sessions" && c === "reopen-table"'), /managerCan\(g, rid, "void_bills"\)/));
check("P35187", "…and invalidates the floor so every screen sees the table return", "read the branch", () => has(B('a === "sessions" && c === "reopen-table"'), /invalidateFloor\(rid\)/));
check("P02948", "A successful print clears an open printer problem on the manager's floor", "read lib/printQueue finishKotJob",
  () => /printer_events/.test(rd("lib/printQueue.ts")) && has(B('a === "print-jobs" && c === "done"'), /finishKotJob/));
check("P17808", "only the KITCHEN may mark a dish ready — the manager panel is not allowed to", "STUB: status 'ready' from the manager route",
  async () => { await world(); const r = await call("POST", "items/i1/status", { body: { status: "ready" } }); return { ok: r.status === 400 && /invalid status/.test(r.text), note: `${r.status}` }; });
check("P32374", "the manager route stamps who punched an order", "STUB: place an order, read lfh_staff_mark_placed's arguments",
  async () => { const G = await world({ settings: { take_orders_allowed: true }, rpc: { lfh_staff_place_order: { ok: true, order_id: "o1" } } });
    await call("POST", "order", { body: { table: "2", items: [{ id: "x", qty: 1 }] } }); const m = G.RPCS.find((c) => c.name === "lfh_staff_mark_placed");
    return { ok: !!m && m.args.p_by_id === "u1" && m.args.p_by === "Diag Manager", note: m ? `${m.args.p_by}` : "not called" }; });
check("P79184", "an on-the-house settle needs mark_paid as well as the table-type power", "read the branch (the T25 doors guard is run whole below)",
  () => has(B('a === "tables" && c === "on-the-house"'), /managerCan\(g, rid, "table_tags"\)[\s\S]{0,2500}managerCan\(g, rid, "mark_paid"\)/));
check("P79301", "P79301–P79370 — the 70 write-door rows of T25-S8", "npm run verify:t25-writes",
  () => { const g = once("t25w", () => guard(["verify:t25-writes"])); return { ok: g.ok && /70 checks passed, 0 failed/.test(g.out), note: g.ok ? "70/70" : g.out.slice(-200) }; });

const argv = process.argv.slice(2);
await runAll({ ledger: argv.includes("--ledger"), quiet: argv.includes("--quiet"), allowForeign: true });
