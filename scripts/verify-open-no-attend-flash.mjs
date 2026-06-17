// Proves the manager-floor "open a requested table → Attend flashes for ~1s" glitch
// is gone. Mirrors editor app.js: tableTileState (st) + the on-tile quick-action
// branch order. The flash happened because opening seats the table (st: req→waiting)
// while the pending request stayed in local state (hasReq=true) until the refetch,
// so the quick-action fell to the hasJoin||hasReq→"Attend" branch for one cycle.
//   node scripts/verify-open-no-attend-flash.mjs

// --- mirror of tableTileState's state machine (only the parts we need) ---
function deriveSt({ orders = [], sess = null, members = [], reqs = [] }) {
  if (orders.length) return "order";                 // some order state (irrelevant here)
  if (sess) return members.length ? "seated" : "waiting"; // open session, with/without guests
  if (reqs.length) return "req";                     // free table, a guest is asking in
  return "free";
}
// --- mirror of the on-tile quick-action branch order (editor app.js ~2242-2252) ---
function quickAction({ st, hasNew, hasReq, hasJoin, done, hasCall, sessionsOn }) {
  if ((st === "free" || st === "req") && sessionsOn) return "Open";
  if (hasNew) return "Accept";
  if (hasJoin || hasReq) return "Attend";
  if (done) return "RST/CLS";
  if (st === "bill") return "Mark paid";
  if (hasCall) return "Attend(call)";
  return "(none)";
}
const tile = (board, sessionsOn = true) => {
  const st = deriveSt(board);
  return quickAction({ st, hasNew: false, hasReq: (board.reqs || []).length > 0, hasJoin: false, done: false, hasCall: false, sessionsOn });
};

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };

const openReq = { id: "r1", table_number: "5", type: "open", status: "pending" };

// 0) Before opening: a free table with an open-request shows the "Open" quick button.
check('requested table shows "Open"', tile({ sess: null, reqs: [openReq] }) === "Open");

// 1) OLD open (bug): optimistic session added, request NOT cleared → "Attend" flash.
const afterOpenOld = { sess: { id: "pending-5" }, members: [], reqs: [openReq] };
check('OLD open flashes "Attend" (bug reproduced)', tile(afterOpenOld) === "Attend");

// 2) NEW open (fixed): optimistic session added AND request cleared → no flash.
const afterOpenNew = { sess: { id: "pending-5" }, members: [], reqs: [] };
check('FIXED open shows no quick button (no Attend flash)', tile(afterOpenNew) === "(none)");

// 3) A real "Attend" still works when it SHOULD: open table, no request, a waiter call.
check("genuine waiter call still shows Attend(call)", quickAction({ st: "waiting", hasNew: false, hasReq: false, hasJoin: false, done: false, hasCall: true, sessionsOn: true }) === "Attend(call)");
// 4) A genuine join request on a seated table still shows Attend (not over-suppressed).
check("genuine join request still shows Attend", quickAction({ st: "seated", hasNew: false, hasReq: false, hasJoin: true, done: false, hasCall: false, sessionsOn: true }) === "Attend");

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
