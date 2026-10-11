// SWEEP #10 · TERMINAL 11 · the guards the fixes leave behind — P180001–P180040.
//
// Loaded by scripts/verify-kitchen-screen.mjs (`npm run verify:kitchen`), so they run in the same
// one-second static pass as every other kitchen row and need no server. Each block names the item it
// defends; each was sabotage-tested once when it was written (break the fix, watch the row go red,
// put it back) — the result of that test is recorded in .claude/sweep/LEDGER/T11-S10.md.
//
// The same three fixes are ALSO driven in memory (the real route, bundled, called against the stub
// database) by scripts/sweep/t11s10/run.mjs — that is the proof they behave; this is the tripwire.
import { row, APPC, ROUTEC, hasRe, lacksRe } from "../t9/lib.mjs";

/** One POST branch of the kitchen route, from its test to the next top-level `if (a === "` test. */
function branch(test) {
  const R = ROUTEC();
  const i = R.indexOf(test);
  if (i < 0) return "";
  const rest = R.slice(i + test.length);
  const m = rest.search(/\n {4}if \(a === "/);
  return m < 0 ? R.slice(i) : R.slice(i, i + test.length + m);
}

// ══ ITEM 1 · a late tap never puts a served table back to "cooking" — P180001–P180010 ══════════
row("P180001", "item 1 · /ready refuses a ticket whose every dish is already served (409, before any write)", () => {
  const b = branch('if (a === "orders" && c === "ready")');
  const guard = b.indexOf('if (cur.status === "served") return err(SERVED_MSG, 409)');
  const write = b.indexOf('sb.from("orders").update(');
  return (b && guard > 0 && write > guard) || "the served refusal is missing, or comes after the write";
});
row("P180002", "item 1 · /accept refuses a served ticket the same way", () => {
  const b = branch('if (a === "orders" && c === "accept")');
  const guard = b.indexOf('if (cur.status === "served") return err(SERVED_MSG, 409)');
  const write = b.indexOf('sb.from("orders").update(');
  return (b && guard > 0 && write > guard) || "the served refusal is missing, or comes after the write";
});
row("P180003", "item 1 · one dish's ✓ (and its take-back) reads the dish's CURRENT status before writing", () =>
  hasRe(branch('if (a === "items" && c === "status")'), /from\("order_items"\)\.select\("order_id, status"\)\.eq\("id", b\)\.eq\("restaurant_id", rid\)/));
row("P180004", "item 1 · …and refuses to move a SERVED dish to anything but served (409)", () => {
  const b = branch('if (a === "items" && c === "status")');
  const guard = b.indexOf('if (own && own.status === "served" && status !== "served") return err(SERVED_DISH_MSG, 409)');
  const write = b.indexOf('sb.from("order_items").update(patch)');
  return (guard > 0 && write > guard) || "the served-dish refusal is missing, or comes after the write";
});
row("P180005", "item 1 · the two refusals are plain sentences a cook can act on", () => {
  const R = ROUTEC();
  return (/const SERVED_MSG = "Every dish on that ticket has already been served — refresh the board\.";/.test(R)
    && /const SERVED_DISH_MSG = "That dish has already been served — refresh the board\.";/.test(R)) || "a refusal sentence changed or went missing";
});
row("P180006", "item 1 · the refusals are 409 (someone else moved first), never 400 or 500", () => {
  const R = ROUTEC();
  const all = R.match(/err\(SERVED_(?:DISH_)?MSG, (\d+)\)/g) || [];
  return (all.length === 3 && all.every((x) => /, 409\)$/.test(x))) || `${all.length} refusals: ${all.join(" ")}`;
});
row("P180007", "item 1 · /unready still leaves a served dish alone (the rule item 1 copied)", () =>
  hasRe(branch('if (a === "orders" && c === "unready")'), /if \(wasNow === "served"\) continue;/));
row("P180008", "item 1 · the panel's refused ✓ still drops its optimistic overlay and repaints", () =>
  hasRe(APPC(), /pendingReady\.delete\(id\);\s*if \(it\.status !== "served"\) it\.status = prev;/));
row("P180009", "item 1 · the panel's refused ALL READY still drops both overlays", () =>
  hasRe(APPC(), /pendingReadyOrders\.delete\(orderId\);\s*snap\.forEach\(\(s\) => pendingReady\.delete\(s\.id\)\);\s*toast\("Failed: " \+ e\.message\);/));
row("P180010", "item 1 · a served dish's own write (the waiter path) is still allowed on this route", () =>
  hasRe(branch('if (a === "items" && c === "status")'), /\["received", "preparing", "ready", "served"\]\.includes\(status\)/));
