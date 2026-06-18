// Proves the tablet tile now shows "Wants in" (amber) for a free table with a pending
// request — matching the manager — instead of plain "Free" with a red ring. Mirrors
// tileState in public/panels/tablet/app.js (the request branch added 2026-06-18).
//   node scripts/verify-tablet-wants-in.mjs

// tileState, mirrored. `a` = tableAgg counts; `reqs` = pending requests for the table.
const tileState = (a, reqs) => {
  if (a.nw > 0) return { cls: "new", label: "New order" };
  if (a.rd > 0) return { cls: "ready", label: "Ready to serve" };
  if (a.ck > 0) return { cls: "prep", label: "Preparing" };
  if (a.os.length && a.sv > 0) return { cls: a.unpaid ? "bill" : "done", label: "Served" };
  if (a.session) return a.guests ? { cls: "seated", label: "Seated" } : { cls: "waiting", label: "Open" };
  if (reqs > 0) return { cls: "req", label: "Wants in" };   // NEW
  return { cls: "free", label: "Free" };
};
const empty = { nw: 0, rd: 0, ck: 0, sv: 0, os: [], unpaid: false, session: null, guests: 0 };

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };

check('free table + pending request → "Wants in" (was "Free")', JSON.stringify(tileState(empty, 1)) === JSON.stringify({ cls: "req", label: "Wants in" }));
check('free table, no request → "Free"', tileState(empty, 0).cls === "free");
// A request must NOT override a real order state (orders still take priority).
check("a new order still wins over a request", tileState({ ...empty, nw: 1 }, 1).cls === "new");
check("an open seated table still wins over a request", tileState({ ...empty, session: {}, guests: 2 }, 1).cls === "seated");
// The "Open" quick button shows for free OR req (so a requested table is still openable).
const showsOpen = (cls) => cls === "free" || cls === "req";
check("Open button shows for a 'req' tile", showsOpen("req"));
check("Open button shows for a 'free' tile", showsOpen("free"));
check("Open button does NOT show for a seated tile", !showsOpen("seated"));

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
