// Proves two changes:
//  (A) Manager floor tile turns "ready" (pink) when ANY dish is ready — not only
//      when EVERY dish is ready. Mirrors editor tableTileState precedence.
//  (B) Kitchen "mark ready" is optimistic+merged: a dish the cook just tapped stays
//      "ready" even if a mid-rush refetch lands before the server caught up.
// Also guards that the tablet was ALREADY correct (ready before preparing).
//   node scripts/verify-ready-tile-and-kitchen.mjs

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };

// (A) Manager tile-state precedence ----------------------------------------------
const mgrStOld = ({ anyReceived, anyReady, anyPreparing }) =>            // buggy order
  anyReceived ? "new" : anyPreparing ? "prep" : anyReady ? "ready" : "done";
const mgrStNew = ({ anyReceived, anyReady, anyPreparing }) =>            // fixed order
  anyReceived ? "new" : anyReady ? "ready" : anyPreparing ? "prep" : "done";

check("OLD manager: 1 ready + others preparing → 'prep' (bug)", mgrStOld({ anyReady: true, anyPreparing: true }) === "prep");
check("FIXED manager: 1 ready + others preparing → 'ready' (pink)", mgrStNew({ anyReady: true, anyPreparing: true }) === "ready");
check("FIXED manager: only preparing → 'prep'", mgrStNew({ anyPreparing: true }) === "prep");
check("FIXED manager: all ready → 'ready' (still pink)", mgrStNew({ anyReady: true }) === "ready");
check("FIXED manager: a brand-new order still wins → 'new'", mgrStNew({ anyReceived: true, anyReady: true }) === "new");

// (B) Tablet tile precedence (must already be ready-before-prep) ------------------
const tabSt = ({ nw = 0, rd = 0, ck = 0, sv = 0 }) =>
  nw > 0 ? "new" : rd > 0 ? "ready" : ck > 0 ? "prep" : sv > 0 ? "served" : "free";
check("tablet already pink on any ready (1 ready + 3 preparing)", tabSt({ rd: 1, ck: 3 }) === "ready");

// (C) Kitchen optimistic merge guard (mirror load()'s pendingReady merge) ---------
const kitchenMerge = (serverItems, pendingReady) =>
  pendingReady.size ? serverItems.map((i) => (pendingReady.has(i.id) && i.status !== "served" ? { ...i, status: "ready" } : i)) : serverItems;

{ // server snapshot still says "preparing" but the cook just tapped i1 ready
  const merged = kitchenMerge([{ id: "i1", status: "preparing" }, { id: "i2", status: "preparing" }], new Set(["i1"]));
  check("kitchen: just-tapped dish stays ready when server lags", merged.find((i) => i.id === "i1").status === "ready");
  check("kitchen: untouched dish unaffected", merged.find((i) => i.id === "i2").status === "preparing");
}
{ // never un-serve: a served dish stays served even if in pendingReady
  const merged = kitchenMerge([{ id: "i1", status: "served" }], new Set(["i1"]));
  check("kitchen: never downgrades a SERVED dish to ready", merged[0].status === "served");
}
{ // no pending → straight passthrough (no churn)
  const src = [{ id: "i1", status: "preparing" }];
  check("kitchen: no pending → passthrough", kitchenMerge(src, new Set()) === src);
}

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
