// SWEEP #10 · TERMINAL 11 · the guards the fixes leave behind — P180001–P180040.
//
// Loaded by scripts/verify-kitchen-screen.mjs (`npm run verify:kitchen`), so they run in the same
// one-second static pass as every other kitchen row and need no server. Each block names the item it
// defends; each was sabotage-tested once when it was written (break the fix, watch the row go red,
// put it back) — the result of that test is recorded in .claude/sweep/LEDGER/T11-S10.md.
//
// The same three fixes are ALSO driven in memory (the real route, bundled, called against the stub
// database) by scripts/sweep/t11s10/run.mjs — that is the proof they behave; this is the tripwire.
import { row, APPC, ROUTEC, hasRe, lacksRe, src, code } from "../t9/lib.mjs";
const require_ = (rel) => code(src(rel));

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

// ══ ITEM 2 · the kitchen route answers the kitchen login and the admin, nobody else — P180011–P180020 ══
/** The gate() helper of the kitchen route, comments stripped. */
const GATE = () => { const R = ROUTEC(); const i = R.indexOf("async function gate("); const j = R.indexOf("\n}", i); return i < 0 || j < 0 ? "" : R.slice(i, j + 2); };
row("P180011", "item 2 · the gate still asks requireRole for the kitchen role first", () =>
  hasRe(GATE(), /const g = await requireRole\(req, "kitchen"\);/));
row("P180012", "item 2 · …then refuses any signed-in person whose role is not exactly kitchen", () =>
  hasRe(GATE(), /if \(g\.user && g\.user\.role !== "kitchen"\) \{\s*return NextResponse\.json\(\{ error: "[^"]+" \}, \{ status: 403 \}\);/));
row("P180013", "item 2 · the refusal comes AFTER the sign-in check, so a missing login is still 401 (the panel's /login bounce)", () => {
  const g = GATE(); const a = g.indexOf("if (!g.ok)"), b = g.indexOf('g.user.role !== "kitchen"');
  return (a > 0 && b > a) || "order changed";
});
row("P180014", "item 2 · the admin super-user (user === null) is NOT refused — the console's view-as still works", () =>
  hasRe(GATE(), /if \(g\.user && g\.user\.role !== "kitchen"\)/));
row("P180015", "item 2 · GET and POST both pass through the one gate before anything else", () => {
  const R = ROUTEC();
  const get = R.slice(R.indexOf("export async function GET("), R.indexOf("export async function GET(") + 200);
  const post = R.slice(R.indexOf("async function postImpl("), R.indexOf("async function postImpl(") + 200);
  return (/const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/.test(get)
    && /const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/.test(post)) || "a handler no longer starts with gate()";
});
row("P180016", "item 2 · the /kitchen page still admits the kitchen role only, so page and API agree", () =>
  hasRe(require_("lib/panelGate.ts"), /if \(u && u\.role === role\) \{/));
row("P180017", "item 2 · the restaurant's own address still admits the kitchen role only", () =>
  hasRe(require_("lib/panelGate.ts"), /if \(u && u\.role === role && u\.restaurant_id === r\.id && r\.active\)/));
row("P180018", "item 2 · the refusal is a plain sentence that names what to do", () =>
  hasRe(GATE(), /sign in with the kitchen login/));
