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
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const T11H = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "t11-harness");
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
// EXPECTATION CHANGED (round 2, item 7): the accept door is gone and the route takes no "served" — see the rows below.
row("P180002", "item 1 + item 7 · the kitchen route has no /accept to revive a served ticket through (the door is gone)", () =>
  lacksRe(ROUTEC(), /if \(a === "orders" && c === "accept"\)/));
row("P180003", "item 1 · one dish's ✓ (and its take-back) reads the dish's CURRENT status before writing", () =>
  hasRe(branch('if (a === "items" && c === "status")'), /from\("order_items"\)\.select\("order_id, status"\)\.eq\("id", b\)\.eq\("restaurant_id", rid\)/));
row("P180004", "item 1 · …and refuses to move a SERVED dish at all (409) — the kitchen never serves (item 7)", () => {
  const b = branch('if (a === "items" && c === "status")');
  const guard = b.indexOf('if (own && own.status === "served") return err(SERVED_DISH_MSG, 409)');
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
  return (all.length === 2 && all.every((x) => /, 409\)$/.test(x))) || `${all.length} refusals: ${all.join(" ")}`;   // two since item 7 removed /accept
});
row("P180007", "item 1 · /unready still leaves a served dish alone (the rule item 1 copied)", () =>
  hasRe(branch('if (a === "orders" && c === "unready")'), /if \(wasNow === "served"\) continue;/));
row("P180008", "item 1 · the panel's refused ✓ still drops its optimistic overlay and repaints", () =>
  hasRe(APPC(), /pendingReady\.delete\(id\);\s*if \(it\.status !== "served"\) it\.status = prev;/));
row("P180009", "item 1 · the panel's refused ALL READY still drops both overlays", () =>
  hasRe(APPC(), /pendingReadyOrders\.delete\(orderId\);\s*snap\.forEach\(\(s\) => pendingReady\.delete\(s\.id\)\);[\s\S]{0,500}toast\("Failed: " \+ e\.message\);/));   // item 18 restores + redraws in between
row("P180010", "item 7 · the kitchen route takes only the kitchen's three dish statuses — 'served' is the waiter's", () =>
  hasRe(branch('if (a === "items" && c === "status")'), /if \(!\["received", "preparing", "ready"\]\.includes\(status\)\) return err\("invalid status"\);/));

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

// ══ ITEM 3 · a refusal never draws an UNDO that cannot undo anything — P180021–P180026 ══════════
/** Every toast(...) call in the kitchen panel, split into its top-level arguments. */
function toastCalls() {
  const a = APPC(), out = [];
  const re = /(?<![\w.])toast\(/g;
  let m;
  while ((m = re.exec(a))) {
    let d = 0, i = m.index + m[0].length - 1, start = i + 1, args = [], q = null;
    for (; i < a.length; i++) {
      const c = a[i];
      if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]" || c === "}") { d--; if (d === 0) { args.push(a.slice(start, i).trim()); break; } }
      else if (c === "," && d === 1) { args.push(a.slice(start, i).trim()); start = i + 1; }
    }
    out.push({ at: m.index, args });
  }
  return out;
}
row("P180021", "item 3 · toast()'s second argument is the UNDO callback, and the definition still says so", () =>
  hasRe(APPC(), /const toast = \(msg, undoFn\) => \{[\s\S]{0,400}undoFn \? '<button class="undo">UNDO<\/button>' : ""/));
row("P180022", "item 3 · NO toast() call passes a string, number or object where the UNDO callback goes", () => {
  const bad = toastCalls().filter((c) => c.args.length > 1 && /^(["'`]|\d|\{|\[|true|false|null)/.test(c.args[1]));
  return !bad.length || `${bad.length} call(s): ${bad.map((c) => c.args.join(", ")).join(" | ").slice(0, 160)}`;
});
row("P180023", "item 3 · every toast() that DOES offer an UNDO hands it a function it defined", () => {
  const two = toastCalls().filter((c) => c.args.length > 1);
  const ok = two.every((c) => /^[A-Za-z_$][\w$]*$/.test(c.args[1]) && new RegExp(`const ${c.args[1]} = (async )?\\(`).test(APPC()));
  return (two.length >= 1 && ok) || `${two.length} two-argument call(s); not all name a defined function`;
});
row("P180024", "item 3 · a refused manual print on a TABLE ticket toasts the reason alone", () =>
  hasRe(APPC(), /try \{ says = await askWhoPrints\(\{ orderId: id, reprint: dup \}\); \}\s*catch \(e\) \{ toast\(e\.message\); return; \}/));
row("P180025", "item 3 · a refused manual print on a DELIVERY ticket toasts the reason alone", () =>
  hasRe(APPC(), /try \{ says = await askWhoPrints\(\{ aggId: id, reprint: dup \}\); \}\s*catch \(e\) \{ toast\(e\.message\); return; \}/));
row("P180026", "item 3 · no toast() call takes more than two arguments", () => {
  const bad = toastCalls().filter((c) => c.args.length > 2);
  return !bad.length || `${bad.length} call(s) with 3+ arguments`;
});

// ══ ITEM 4 · the admin's STOP on Printing holds this screen too — P180027–P180036 ════════════════
const BOARD = () => { const R = ROUTEC(); const i = R.indexOf('if (path.join("/") === "board")'); const j = R.indexOf('return err("unknown GET endpoint", 404)'); return i < 0 || j < 0 ? "" : R.slice(i, j); };
row("P180027", "item 4 · one helper answers 'is the queue stopped?' from modules.printing.paused", () =>
  hasRe(ROUTEC(), /const isPaused = \(s: unknown\): boolean => \{[\s\S]{0,200}m\.printing\.paused === true\);/));
row("P180028", "item 4 · the board's ONE settings read carries `modules`, so the stop costs no new query", () =>
  hasRe(BOARD(), /from\("settings"\)\.select\("kitchen_can_accept_platform, auto_print_kot, auto_print_kot_allowed, platform_channels, table_names, modules"\)/));
row("P180029", "item 4 · a stopped queue means this screen is not the printer (no auto rows, no net)", () =>
  hasRe(BOARD(), /const paused = isPaused\(must\(settings\)\);\s*const screenPrints = mayI\.ok && !paused;/));   // kitchenMayAuto retired, item 17
row("P180030", "item 4 · …and hands over NO job at all, the manager's reprints included", () =>
  hasRe(BOARD(), /const printJobs = paused \? \[\] : await pendingKotJobs\(/));
row("P180031", "item 4 · the board tells the sheet WHY — printRefused 'paused' outranks every routing reason", () =>
  hasRe(BOARD(), /printRefused: paused \? "paused" : mayI\.ok \? null : mayI\.why/));
row("P180032", "item 4 · the CLAIM refuses while stopped, before winning anything (a stale tab walks through the board)", () => {
  const b = branch('if (a === "print-jobs" && b === "claim")');
  const stop = b.indexOf('if (isPaused(st)) return ok({ won: [], refused: "paused"'), win = b.indexOf("claimKotJobs(rid, ids)");
  return (stop > 0 && win > stop) || "the claim's stop check is missing or comes after the claim";
});
// EXPECTATION CHANGED (item 17): 'print here instead' is retired; the claim — the one road left — refuses while stopped.
row("P180033", "item 4 · the one road to becoming the printer (the claim) refuses while stopped, and the old take door is gone", () =>
  hasRe(branch('if (a === "print-jobs" && b === "claim")'), /if \(isPaused\(st\)\) return ok\(\{ won: \[\], refused: "paused"/) && !/a === "print-station" && b === "take"/.test(ROUTEC()));
row("P180034", "item 4 · the 🖨 sheet has the words for a stopped queue", () =>
  hasRe(APPC(), /refused === "paused" \? "nobody right now — printing is stopped for this restaurant, and tickets wait until it starts again"/));
row("P180035", "item 4 · ⚙️ Settings no longer goes silent on a stopped queue — it says so, in the same words", () =>
  hasRe(APPC(), /const stopped = !hlp && state\.printRefused === "paused";[\s\S]{0,200}\(!auto && tgt !== "counter" && !hlp && !stopped\) \? "" :/));
row("P180036", "item 4 · the manager route's own stop rule is still there to agree with", () =>
  hasRe(code(src("app/api/editor/[...path]/route.ts")), /const paused = st\?\.modules\?\.printing\?\.paused === true;\s*const on = !paused &&/));

// ══ ITEM 5 · a ✓'d dish that is put back to cooking gets its ✓ back — P180037–P180040 ════════════
const MIR = () => { const a = APPC(); const i = a.indexOf("function markItemReady("); const j = a.indexOf("async function undoReady("); return i < 0 || j < 0 ? "" : a.slice(i, j); };
row("P180037", "item 5 · after the in-place ✓ edit, a card that stays in its lane is re-stamped with what it now says", () =>
  hasRe(MIR(), /if \(o && orderPhase\(o\) === "ready"\) moveCardToReady\(o\);\s*else if \(o\) \{\s*const card = document\.querySelector\([^\n]+\);\s*if \(card\) card\.__kdsHtml = ticketHtml\(o\);\s*\}/));
row("P180038", "item 5 · the re-stamp happens AFTER the dish's status is set to ready (so it stamps the truth)", () => {
  const m = MIR(); const set = m.indexOf('it.status = "ready"; pendingReady.add(id);'), stamp = m.indexOf("card.__kdsHtml = ticketHtml(o)");
  return (set > 0 && stamp > set) || "order changed";
});
row("P180039", "item 5 · the card is found with CSS.escape, like every other by-id card lookup here", () =>
  hasRe(MIR(), /\.ticket\[data-ticket="\$\{window\.CSS && CSS\.escape \? CSS\.escape\(String\(o\.id\)\) : o\.id\}"\]/));
row("P180040", "item 5 · a REFUSED ✓ still forgets the stamp entirely (the path item 5 does not replace)", () =>
  hasRe(MIR(), /forgetCardHtml\(o \? o\.id : it\.order_id\);/));

// ══ ITEM 6 · the first tap of the shift lands where the finger is — P180561–P180566 ══════════════
row("P180561", "item 6 · the gesture that unlocks sound defers the nudge until that gesture's click is delivered", () =>
  hasRe(APPC(), /function afterGesture\(fn\) \{[\s\S]{0,400}\["click", "pointercancel"\]\.forEach\(\(e\) => window\.addEventListener\(e, go, true\)\);\s*setTimeout\(go, 2500\);/));
row("P180562", "item 6 · …and runs it AFTER the click's own handlers (setTimeout 0 inside the capture listener)", () =>
  hasRe(APPC(), /setTimeout\(fn, 0\);/));
row("P180563", "item 6 · primeAudio takes the gesture path only when asked, and uses it for BOTH re-checks", () =>
  hasRe(APPC(), /function primeAudio\(fromGesture\) \{\s*const settle = fromGesture \? \(\) => afterGesture\(updateSoundNudge\) : updateSoundNudge;[\s\S]{0,300}p\.then\(\(\) => settle\(\)\)[\s\S]{0,80}settle\(\);\s*\}/));
row("P180564", "item 6 · the board's first-gesture listener is the one that asks for the gesture path", () =>
  hasRe(APPC(), /const once = \(\) => \{ primeAudio\(true\);/));
row("P180565", "item 6 · a tap ON the nudge still folds it promptly (that tap is aimed at the nudge)", () =>
  hasRe(APPC(), /soundNudgeEl\.onclick = \(\) => \{ primeAudio\(\); setTimeout\(updateSoundNudge, 250\); \};/));
row("P180566", "item 6 · the nudge still sits IN the flow under the bar (the reason the fold moves the board)", () =>
  hasRe(APPC(), /bar\.parentNode\.insertBefore\(soundNudgeEl, bar\.nextSibling\)/));

// ══ ROUND 2 · ITEM 7 · the kitchen's server makes only the moves its screen makes — P180567–P180570 ══
row("P180567", "item 7 · the kitchen route has no accept branch, and its obituary says where accepting lives", () =>
  (!/if \(a === "orders" && c === "accept"\)/.test(ROUTEC()) && /\/api\/tablet\/orders\/:id\/accept/.test(src("app/api/kitchen/[...path]/route.ts"))) || "the door is back or the obituary is gone");
row("P180568", "item 7 · no script still accepts or serves through the KITCHEN route", () => {
  const bad = ["scripts/stress-tenant.mjs", "scripts/verify-everything.mjs"].filter((f) => /\/api\/kitchen\/orders\/\$\{[^}]+\}\/accept|\/api\/kitchen\/items\/\$\{[^}]+\}\/status`, \{ status: "served" \}/.test(code(src(f))));
  return !bad.length || `still using the kitchen doors: ${bad.join(", ")}`;
});
row("P180569", "item 7 · the load script accepts and serves through the waiter's route instead", () =>
  hasRe(code(src("scripts/stress-tenant.mjs")), /\/api\/tablet\/orders\/\$\{o\.id\}\/accept[\s\S]*\/api\/tablet\/items\/\$\{it\.id\}\/status`, \{ status: "served" \}/));
row("P180570", "item 7 · the kitchen panel itself never sends 'served' or calls accept", () =>
  (!/status: "served"/.test(APPC()) && !/\/orders\/\$\{[^}]+\}\/accept/.test(APPC())) || "the panel sends a move its server no longer takes");

// ══ ROUND 2 · ITEM 8 · MY CALL: a cook's own 🖨 still prints while printing is stopped — P180571 ══
row("P180571", "item 8 · the manual 🖨 path has no stop check (MY CALL, written down at reprintOrder)", () => {
  const a = APPC(); const i = a.indexOf("async function reprintOrder("), j = a.indexOf("async function reprintPlatform(");
  const body = a.slice(i, j);
  return (i > 0 && !/paused/.test(body) && /MY CALL \(owner handed this back/.test(src("public/panels/kitchen/app.js"))) || "the hand-print path changed, or the decision note is gone";
});

// ══ ROUND 2 · ITEM 9 · the waiter's server answers the waiter login and the admin — P180572–P180573 ══
const TABGATE = () => { const t = code(src("app/api/tablet/[...path]/route.ts")); const i = t.indexOf("async function gate("); const j = t.indexOf("\n}", i); return i < 0 || j < 0 ? "" : t.slice(i, j + 2); };
row("P180572", "item 9 · the waiter route refuses any signed-in role other than tablet (403, plain sentence)", () =>
  hasRe(TABGATE(), /if \(g\.user && g\.user\.role !== "tablet"\) \{\s*return NextResponse\.json\(\{ error: "[^"]*waiter login[^"]*" \}, \{ status: 403 \}\);/));
row("P180573", "item 9 · …after the sign-in check, so a missing login is still the 401 bounce and the admin still passes", () => {
  const g = TABGATE(); const a = g.indexOf("if (!g.ok)"), b = g.indexOf('g.user.role !== "tablet"');
  return (a > 0 && b > a && /const g = await requireRole\(req, "tablet"\);/.test(g)) || "order changed";
});
// ══ ROUND 2 · ITEM 10 · an owner on the manager route must name the restaurant — P180574 ══
row("P180574", "item 10 · an owner request with no ?rid is refused before the staff-row fallback is reached", () => {
  const e = code(src("app/api/editor/[...path]/route.ts")); const i = e.indexOf("async function editorScope("); const blk = e.slice(i, i + 1600);
  const refuse = blk.indexOf('return err("Open this from the owner panel'), fall = blk.indexOf("const rid = panelRestaurantId(req, g);");
  return (i > 0 && refuse > 0 && fall > refuse) || "the refusal is missing or comes after the fallback";
});
// ══ ROUND 2 · ITEM 11 · the 86 drawer reads in the light skin and keeps its toggles whole — P180575–P180576 ══
const CSSC_ = () => src("public/panels/kitchen/style.css").replace(/\/\*[\s\S]*?\*\//g, "");
row("P180575", "item 11 · the light skin's SOLD OUT word uses the deep red, not the dark skin's pink", () =>
  hasRe(CSSC_(), /html\[data-theme="light"\] \.btn\.danger \{ color: #b91c1c; \}/));
row("P180576", "item 11 · a dish's toggle never shrinks beside a long name; the name wraps instead", () =>
  hasRe(CSSC_(), /\.dish-row \.btn \{ flex-shrink: 0; white-space: nowrap; \}/) && hasRe(CSSC_(), /\.dish-row \.dtitle \{ min-width: 0;/));

// ══ ROUND 2 · ITEM 13 · a failed step on the kitchen route is a failure, never { ok: true } — P180834–P180836 ══
row("P180834", "item 13 · ALL READY's dish update is checked (must), so a failure is never reported as success", () =>
  hasRe(ROUTEC(), /must\(await sb\.from\("order_items"\)\.update\(\{ status: "ready" \}\)\.eq\("order_id", b\)\.eq\("restaurant_id", rid\)\.neq\("status", "served"\)\);/));
row("P180835", "item 13 · the ✓'s two pre-reads and its order rollup are checked (a blip answers busy, never skips a protection)", () => {
  const b = branch('if (a === "items" && c === "status")');
  return (/const own = must\(await sb\.from\("order_items"\)/.test(b) && /const ord = must\(await sb\.from\("orders"\)/.test(b) && /must\(await sb\.from\("orders"\)\.update\(\{ status: overall \}\)/.test(b)) || "an unchecked step is back";
});
row("P180836", "item 13 · the delivery accept-gate's permission read is checked, so a blip is never a false 'not allowed'", () =>
  hasRe(branch('if (a === "platform" && c === "status")'), /data: must\(await sb\.from\("settings"\)\.select\("kitchen_can_accept_platform"\)/));

// ══ ROUND 2 · ITEM 16 · the kitchen only moves a delivery forward — P180859 ══
row("P180859", "item 16 · a delivery tap is refused when the order was cancelled or has moved past it; a repeat is 'done' with no write; the platform call keeps its reason", () => {
  const b = branch('if (a === "platform" && c === "status")');
  const own = b.indexOf("if (!owns) return err("), canc = b.indexOf('if (owns.status === "cancelled") return err(PLAT_CANCELLED_MSG, 409);'),
    back = b.search(/if \(fromRank === undefined \|\| PLAT_RANK\[status\] < fromRank\) return err\(PLAT_MOVED_MSG, 409\);/),
    same = b.indexOf("if (PLAT_RANK[status] === fromRank) return ok({ ...owns, unchanged: true });"),
    rpc = b.search(/const data = must\(await sb\.rpc\("lfh_platform_set_status"/);
  return (own > 0 && canc > own && back > canc && same > back && rpc > same && /PLAT_RANK: Record<string, number> = \{ new: 0, accepted: 1, preparing: 2, ready: 3, handed_over: 4 \}/.test(b)) || "the forward-only rule is missing, reordered, or the call is unchecked";
});
// ══ ROUND 2 · the hermetic server suites run with this guard — P180860 ══
// scripts/t11-harness runs the REAL route against an in-memory database (no server, no network). u-route.mjs,
// u-route3.mjs and u-route4.mjs take well under a second, so they run here; u-route2.mjs (8s — it walks 505 devices through the block
// memo) and mutate.mjs (minutes) are run by hand: `node scripts/t11-harness/u-route2.mjs`, `node scripts/t11-harness/mutate.mjs`.
row("P180860", "the hermetic kitchen-route suites (u-route 200 rows, u-route3 22, u-route4 8) are green", () => {
  const bad = [];
  for (const s of ["u-route.mjs", "u-route3.mjs", "u-route4.mjs"]) {
    const r = spawnSync(process.execPath, [join(T11H, s)], { encoding: "utf8", timeout: 120000 });
    const tail = ((r.stdout || "").match(/(\d+) rows · (\d+) ✅ · (\d+) ❌/) || []);
    if (r.status !== 0 || !tail[0] || tail[3] !== "0") bad.push(`${s}: ${tail[0] || "exit " + r.status}`);
  }
  return bad.length === 0 || bad.join(" | ");
});

// ══ ROUND 2 · ITEM 18 · a refused tap puts the screen back at once, without waiting for a board read — P180911 ══
row("P180911", "item 18 · a refused ✓ and a refused ALL READY restore the dishes (an old-style ticket from its copy), forget the card and redraw BEFORE the read", () => {
  const a = APPC();
  const mi = a.slice(a.indexOf("function markItemReady("), a.indexOf("async function undoReady(")); const mic = mi.slice(mi.indexOf("}).catch("));
  const mo = a.slice(a.indexOf("function markOrderReady("), a.indexOf("async function askWhoPrints(")); const moc = mo.slice(mo.indexOf("}).catch("));
  const before = (s, x, y) => s.indexOf(x) >= 0 && s.indexOf(x) < s.indexOf(y);
  return (before(mic, "render();", "refreshQuietly();") && before(mic, "forgetCardHtml(", "render();")
    && /const legacyBefore = /.test(mo) && /if \(it && it\.status !== "served"\) it\.status = s\.prev;/.test(moc) && /lo\.items = legacyBefore/.test(moc)
    && before(moc, "forgetCardHtml(orderId);", "render();") && before(moc, "render();", "refreshQuietly();")) || "a refusal path waits for the read again";
});

// ══ ROUND 2 · ITEM 19 · a queued ticket is reported done only after the print call has actually run — P180969 ══
row("P180969", "item 19 · the queue reports a job done from printKot's onDone verdict (after the real print call), never from its set-up answer", () => {
  const a = APPC();
  const pj = a.slice(a.indexOf("function processPrintJobs("), a.indexOf("// ══", a.indexOf("function processPrintJobs(")));
  const pk = a.slice(a.indexOf("function printKot("), a.indexOf("function logKotPrintFailure("));
  return (/const started = printKot\([^;]*onDone: report \}\);/.test(pj) && /if \(!started\) report\(false\);/.test(pj) && !/const okPrint = printKot\(/.test(pj)
    && /let printed = true;/.test(pk) && /catch \(e\) \{\s*printed = false;/.test(pk) && /told\(printed\);/.test(pk) && pk.indexOf("told(printed);") > pk.indexOf("try { w.print(); }")) || "the job is reported before the print call runs again";
});
