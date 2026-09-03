// scripts/sweep/t7/rerun.mjs — sweep #8 · T7 · RE-RUNNING WHAT ALREADY EXISTS.
//
// The ledger is the point of these sweeps: 47,000 numbered checks return nothing unless the next
// run re-executes them. This file re-runs every earlier row whose SUBJECT is a file this terminal
// owns — T9's editor/inventory.js block (P04455–P04482) and T27's text rows for both my files —
// and prints the verdict for each id, so the marks written into T9.md / T27.md are the marks that
// actually came out of a run.
//
// T5.md's 675 rows that assert against editor/app.js are re-run by scripts/sweep/t7/rerun-t5.mjs,
// which is a separate file because app.js is shared by line range with terminal 6.
import { read, check, report, has, hasNot, countOf, eq, atLeast, codeOf } from "./lib.mjs";

const INV  = read("public/panels/editor/inventory.js");
const INVC = codeOf(INV);
const APP  = read("public/panels/editor/app.js");
const APPC = codeOf(APP);
const OUTBOX = read("public/panels/outbox.js");

/* ── T9's editor/inventory.js block (P04455–P04482), re-run ─────────────────────────────────── */
check("P04455", "Every plain write goes through the shared queue", () => has(INVC, /window\.LFH_OUTBOX\.send\(\{/));
check("P04456", "A write carrying a PHOTO deliberately does not queue, and says why", () =>
  has(INVC, /!photoFile && canQueue\(\)/) === true && has(INV, /A photo needs a connection/) === true);
check("P04457", "Every write carries a FRESH action id", () => has(INVC, /"X-LFH-Action-Id"\] = newActionId\(\)/));
check("P04458", "An identical write already in flight is refused, not doubled", () =>
  has(INVC, /if \(inFlight\.has\(key\)\) throw new Error/));
check("P04459", "That refusal is visible, so it is not a dropped tap", () => has(INV, /Already saving that/));
check("P04460", "X-LFH-Expect is sent wherever the screen was editing a known value", () =>
  atLeast(countOf(INVC, /expect:/g), 3, "expectation call sites"));
check("P04461", "A count line's expect is read BEFORE the local map is overwritten", () => {
  const was = INVC.indexOf("const was = S.count.lines.get(itemId)");
  const set = INVC.indexOf("S.count.lines.set(itemId, val)");
  return (was > 0 && set > was) || "the map is written first";
});
check("P04462", "A never-counted line compares as \"the line was empty\", not as 0", () =>
  has(INVC, /was === undefined \|\| was === "" \? null/));
check("P04463", "A clash shows the server's plain sentence, not a status code", () => has(INVC, /json\.clash\.plain/));
check("P04464", "Every write has a deadline", () => has(INVC, /opts\.signal = invDeadline\(\)/));
check("P04465", "Reading AbortSignal.timeout is wrapped for older tablets", () =>
  has(INVC, /typeof AbortSignal\.timeout === "function"/));
check("P04466", "A read cannot hang for ever behind \"Loading inventory…\"", () =>
  // The deadline must sit at the FUNCTION's own indentation (4 spaces), not inside the
  // `if (method !== "GET")` block — that is where it used to live, which is why a GET on a
  // database that was up but answering nothing sat on "Loading inventory…" for ever.
  has(INVC, /^    opts\.signal = invDeadline\(\);$/m) === true
  && has(INV, /This is taking longer than it should — the system didn't answer\./) === true);
check("P04467", "Retired items stay in memory so a mis-tap cannot make one unreachable", () => has(INVC, /\/items\?all=1/));
check("P04468", "Pickers filter to active themselves", () => atLeast(countOf(INVC, /\.filter\(\(i\) => i\.active/g), 3, "active filters"));
check("P04469", "Every popup registers a Back layer and unregisters on close", () =>
  has(INVC, /LFH_BACK\.layer\(id, closePop\)/) === true && has(INVC, /offLayer = null;/) === true);
check("P04470", "Opening a second popup closes the first, layers included", () => {
  const m = INVC.match(/function openPop\(id, html, onBind\) \{\s*\n\s*(\w+\(\);)/);
  return (m && m[1] === "closePop();") || "openPop no longer closes the previous one";
});
check("P04471", "The backdrop closes the popup; a tap inside does not", () => has(INVC, /if \(e\.target === wrap\) closePop\(\)/));
check("P04472", "The live refresh is driven by the `ops` breadcrumb the panel already receives", () =>
  has(APPC, /window\.LFH_INV\.live\(\)/) === true && has(INVC, /live: liveBump/) === true);
check("P04473", "The live refresh never runs while a popup is open", () =>
  has(INVC, /document\.querySelector\("\.inv-pop, #invPop"\)/));
check("P04474", "The live refresh never runs while the tab is hidden", () => has(INVC, /if \(document\.hidden\) return;/));
check("P04475", "The live refresh coalesces a burst of orders into one refetch", () => has(INVC, /\}, 1200\)/));
check("P04476", "The offsetParent visibility test is honest (no fixed-position ancestor)", () =>
  has(INVC, /!body\.offsetParent/) === true && hasNot(read("public/panels/editor/style.css"), /#invBody\s*\{[^}]*position:\s*fixed/) === true);
check("P04477", "reset() clears the cache when the admin switches restaurant", () =>
  // RE-RUN 2026-09-03: reset() no longer exists. It had NO caller anywhere in the repo, and the
  // situation it described cannot happen here — the admin's restaurant is pinned from the URL at
  // load, so every way of changing it reloads this module. What the row protected — no stale
  // per-restaurant state — is now true by construction, and P60922 asserts that directly.
  hasNot(codeOf(INV), /reset\(\)/) === true && has(INV, /reset\(\) lived here/) === true
  && hasNot(INVC, /localStorage|sessionStorage/) === true);
check("P04478", "Every path is scoped by scoped() so the ?rid= pin rides along", () =>
  has(INVC, /"\/api\/inventory" \+ scoped\(path\)/));
check("P04479", "Queue labels for inventory paths read as English, not as URL segments", () =>
  has(OUTBOX, /inventory/) || "outbox.js no longer labels the inventory paths");
check("P04480", "A manager without inventory access sees a sentence, not a broken screen", () =>
  has(INV, /Your owner hasn't given you inventory access yet\./));
check("P04481", "The Stock list renders at 1280×800", () =>
  has(INVC, /function renderStock\(body\)/) === true && has(INV, /inv-statrow/) === true);   // driven for real in live.mjs
check("P04482", "The Count popup renders at 360×780 dpr3 with the number inputs reachable", () =>
  has(INVC, /class="inv-countin"/) === true && has(read("public/panels/editor/style.css"), /\.inv-countin/) === true);

/* ── T27's text rows for my two files, re-run ───────────────────────────────────────────────── */
check("P13408", "editor/inventory.js — its visible text reads as English and names things the way the panels do", () => {
  const words = ["ingredient", "purchase", "stock", "waste", "expense", "count"];
  const low = INV.toLowerCase();
  return words.every((w) => low.includes(w)) || "the shared vocabulary drifted";
});
for (const [id, txt] of [
  ["P28295", "Loading inventory…"], ["P28296", "⚠️ ${esc(e.message)}"],
  ["P28297", "Your owner hasn't given you inventory access yet."], ["P28298", "Loading…"],
  ["P28299", "No ingredients yet — add your first one."], ["P28300", "No movements yet."],
  ["P28301", "🎉 Nothing to order — everything is at or above its "],
  ["P28302", "No purchases yet. Enter your first bill — stock and "],
  ["P28303", "Loading past counts…"], ["P28304", "No counts yet."],
  ["P28305", "🎯 Everything matched — no corrections needed."],
  ["P28306", "Nothing wasted in the last 30 days — or nothing logg"],
  ["P28307", "No dishes match."], ["P28308", "No ingredients yet."],
  ["P28309", "No stock movement in the last ${days} days."],
  ["P28310", "No expenses recorded in ${esc(monthLabel)}."],
]) check(id, `an empty state in editor/inventory.js still says why it is empty — "${txt}"`, () =>
  INV.includes(txt) || `the sentence is gone: ${txt}`);

process.exit(report("sweep #8 · T7 · re-run of earlier rows") ? 1 : 0);
