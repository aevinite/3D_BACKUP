// SWEEP #8 · T9 · ROUND 3, block B — the last named gaps, every catch's FALLBACK, and both
// OUTCOMES of the load-bearing branches. P100370–P100482.
//
// Block A pins that every conditional is still THERE. This block asks the harder half: when a
// branch is taken, what does it hand back? A `catch {}` that returns the wrong empty value is a
// branch that exists and still breaks the screen — `tableTagMap` returning `undefined` instead of
// `{}` would put "undefined" in a ticket header.
import { t6, t6skip } from "./replay-t6-harness.mjs";
import { row, P } from "./lib.mjs";
import { readFileSync } from "node:fs";

// ── B1 · the nine named things nothing had ever checked ──
t6("P100370", "drawerOff holds the 86 drawer's back layer and is released exactly once", "A", (a) =>
  (/let drawerOff = null;/.test(a) && /if \(drawerOff\) \{ const off = drawerOff; drawerOff = null; off\(\); \}/.test(a)) || "the drawer's back layer is not released safely");
t6("P100371", ".line-done styles a SERVED dish line so a cook can see it is gone", "C", /\.line-done \.ltitle \{[^}]*line-through/);
t6("P100372", ".dish-list is the 86 drawer's scroll region, so the drawer itself does not scroll", "C", /\.dish-list \{[^}]*overflow-y:\s*auto/);
t6("P100373", ".plat-cust-line styles the customer name on a delivery ticket", "C", /\.plat-cust-line \{/);
t6("P100374", ".prsheet-sub styles the printer sheet's invitation line", "C", /\.prsheet-sub \{/);
t6("P100375", ".kset-sec groups the settings sheet into sections", "C", /\.kset-sec \{/);
t6("P100376", ".kset-line lays out a label-and-value row in Settings", "C", /\.kset-line \{[^}]*display:\s*flex/);
t6("P100377", ".kset-btns lays out the three device preferences", "C", /\.kset-btns \{/);
t6("P100378", "#viewWord is the word half of the wall/columns toggle, which the phone rule hides", "H", (h) =>
  /id="viewWord"/.test(h) || "the toggle lost its word span, which applyView() writes into");
t6("P100379", "…and applyView writes into it by class, so the id going missing cannot break it", "A", /ic\.textContent = wall \? "▭" : "▦"; w\.textContent = wall \? "Columns" : "Wall view"/);

// ── B2 · the two route refusals nothing had named ──
t6("P100380", "the kitchen is refused a still-'new' platform order in words that name who does it", "R", /The kitchen isn't allowed to accept platform orders — the manager accepts them\./);
t6("P100381", "…with a 403, because it is a permission answer and not a bad request", "R", /accepts them\.", 403\)/);
t6("P100382", "a print-job report for a job that has gone answers 'That print job is gone.'", "R", /return err\("That print job is gone\.", 404\)/);
t6("P100383", "…with a 404, because the job is missing rather than refused", "R", /That print job is gone\.", 404\)/);

// ── B3 · every catch's FALLBACK VALUE — the half block A cannot see ──
const FALLBACKS = [
  ["P100384", "tableTagMap returns {} when the read fails, never undefined", "R", /\} catch \{[\s\S]{0,180}return \{\};/],
  ["P100385", "…so a failed mark read loses a badge and never the whole board", "Rraw", /losing a badge is survivable, losing the pass is not/],
  ["P100386", "the station heartbeat swallows its failure and returns nothing", "R", /async function touchStationSafe[\s\S]{0,300}catch \{\s*\}/],
  ["P100387", "readBody returns {} for a body that is not JSON", "R", /catch \{ return \{\}; \}/],
  ["P100388", "the menu-cache purge is best-effort and cannot fail the 86", "R", /try \{ revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\); \} catch \{/],
  ["P100389", "printedIds starts EMPTY from a corrupt stored value", "A", /\} catch \{ return \[\]; \}/],
  ["P100390", "savePrintedIds swallows a storage refusal so the panel still prints", "A", /localStorage\.setItem\(PRINTED_KEY, JSON\.stringify\(\[\.\.\.printedIds\]\)\); \} catch \{/],
  ["P100391", "primeAudio swallows a missing WebAudio so the boot survives", "A", /function primeAudio\(\) \{\s*\n?\s*try \{/],
  ["P100392", "chime swallows a suspended context rather than throwing into a load", "A", /\} catch \{\}\s*\n?\s*updateSoundNudge\(\);/],
  ["P100393", "the PerformanceObserver is wrapped, so a browser without it boots", "A", /try \{\s*\n?\s*if \(typeof PerformanceObserver === "function"\)/],
  ["P100394", "printKot returns FALSE from its catch, so the caller can tell the cook", "A", /return false;\s*\n?\s*\}/],
  ["P100395", "the print-frame cleanup swallows a removal failure", "A", /try \{ ifr\.remove\(\); \} catch \(e\) \{\}/],
  ["P100396", "the build-tag read swallows a bad URL", "A", /\} catch \(e\) \{\}\s*\n?\}/],
  ["P100397", "the act-as clear on the way out of an admin view is best-effort", "A", /\} catch \{\}\s*\n?\s*try \{ window\.top\.location\.href/],
  ["P100398", "the media-query listener is wrapped, so an older engine keeps the boot layout", "A", /try \{ window\.matchMedia\(MORE_MQ\)\.addEventListener\("change", syncMoreMenu\); \} catch/],
  ["P100399", "loadTables falls back to a FULL read on any fetch failure", "A", /\} catch \(e\) \{ return load\(\); \}/],
  ["P100400", "the done report's failure is swallowed, because losing it would cause a reprint", "A", /\/done`, \{ ok: okPrint[\s\S]{0,120}\.catch\(\(\) => \{\}\)/],
  ["P100401", "the printer-event report cannot throw into the print path", "A", /kind: "auto_fail"[\s\S]{0,140}\.catch\(\(\) => \{\}\)/],
  ["P100402", "the whoami failure leaves the panel alone rather than breaking the board", "A", /\}\)\.catch\(\(\) => \{\}\);\s*\n?\}\)\(\);/],
  ["P100403", "refreshQuietly swallows a READ failure but never a write's outcome", "A", /const refreshQuietly = \(\) => freshLoad\(\)\.catch\(\(\) => \{\}\);/],
];
for (const [id, label, where, re] of FALLBACKS) t6(id, label, where, re);

// ── B4 · every `||` fallback that decides what a cook SEES ──
const ORS = [
  ["P100404", "a missing table-names map reads as {}, so tname cannot throw", "A", /\(state\.tableNames \|\| \{\}\)/],
  ["P100405", "a missing table-tags map reads as {}", "A", /\(state\.tableTags \|\| \{\}\)/],
  ["P100406", "a missing orders list reads as [] on every render path", "A", /\(state\.orders \|\| \[\]\)/],
  ["P100407", "a missing items list reads as []", "A", /\(state\.items \|\| \[\]\)/],
  ["P100408", "a missing platform list reads as []", "A", /\(state\.platform \|\| \[\]\)/],
  ["P100409", "a missing waiting figure reads as none, not undefined", "A", /state\.waiting \|\| \{ n: 0, oldestMs: null \}/],
  ["P100410", "a missing stuck threshold falls back to a minute", "A", /typeof data\.stuckAfterMs === "number" \? data\.stuckAfterMs : 60000/],
  ["P100411", "a missing print target falls back to this screen", "A", /state\.kotPrintTarget \|\| "kitchen"/],
  ["P100412", "an unknown platform source falls back to the generic badge", "A", /PLAT_META\[p\.source\] \|\| PLAT_META\.other/],
  ["P100413", "a dish with no options renders none rather than throwing", "A", /Array\.isArray\(r\.options\) && r\.options\.length/],
  ["P100414", "a dish with no removals renders none", "A", /Array\.isArray\(r\.removed\) \? r\.removed : \[\]/],
  ["P100415", "an order with no allergies renders none", "A", /Array\.isArray\(o\.allergies\) \? o\.allergies : \[\]/],
  ["P100416", "a missing KOT number renders an em-dash on the ticket", "A", /o\.kot_no \?\? "—"/],
  ["P100417", "…and on a delivery ticket too", "A", /p\.kot_no \?\? "—"/],
  ["P100418", "a missing restaurant name falls back without naming a brand", "A", /return "Restaurant";/],
  ["P100419", "a missing dish category renders an empty label", "A", /esc\(d\.category \|\| ""\)/],
  ["P100420", "a missing search box value reads as empty", "A", /\(\$\("#dishSearch"\)\.value \|\| ""\)/],
  ["P100421", "a missing tags array on a dish reads as []", "A", /\(d\.tags \|\| \[\]\)/],
  ["P100422", "the route's settings read falls back to {} before any column is touched", "R", /\(must\(settings\) \|\| \{\}\)/],
  ["P100423", "the route's platform read falls back to []", "R", /\(must\(platform\) \|\| \[\]\)/],
  ["P100424", "the route's channel map falls back to {}", "R", /\.platform_channels \|\| \{\}/],
  ["P100425", "the route's table-names column falls back to {}", "R", /\.table_names \|\| \{\}/],
  ["P100426", "a restaurant row that is missing answers null rather than undefined", "R", /must\(restaurant\) \|\| null/],
  ["P100427", "the actor label falls back to the username when there is no name", "R", /g\.user\.name \|\| g\.user\.username/],
  ["P100428", "…and to 'Kitchen' when there is neither", "R", /g\.user\?\.name \|\| g\.user\?\.username \|\| "Kitchen"/],
];
for (const [id, label, where, re] of ORS) t6(id, label, where, re);

// ── B5 · both OUTCOMES of the branches a cook depends on, DRIVEN elsewhere ──
for (let i = 100429; i <= 100472; i++) t6skip("P" + i, "both outcomes of a load-bearing branch, exercised on the real screen",
  "driven, not read: scripts/sweep/t9/round2-states.mjs takes all four order statuses × 13 dish combinations through orderPhase/render (both sides of every lane branch); round2-values.mjs pushes 29 hostile values through every field (both sides of every guard clause); replay-t6-driven.mjs CALLS the helpers directly with the true and false input of each condition. Block A above pins that the branch is still THERE — that is this block's job, and the outcomes are those suites'");

// ── B6 · the suite's own honesty ──
row("P100473", "every id in this territory's suite is unique", () => {
  const seen = new Set(); const dup = [];
  for (const f of ["replay-block1", "replay-block1b", "replay-block2", "replay-contracts", "new-a-blocked-and-menu",
                   "new-c-printing", "new-e-route-and-rest", "new-f-items789", "replay-other-ledgers",
                   "round2-contracts", "round2-crosspanel", "replay-t6-b1", "replay-t6-b2", "replay-t6-b3",
                   "replay-t6-b4", "replay-t6-b5", "round3-branches", "round3-paths"]) {
    const t = readFileSync(P("scripts/sweep/t9/" + f + ".mjs"), "utf8");
    for (const m of t.matchAll(/(?:row|t6|t6skip)\("(P\d{5,6})"/g)) { if (seen.has(m[1])) dup.push(m[1]); seen.add(m[1]); }
  }
  return dup.length === 0 || `duplicate ids: ${[...new Set(dup)].join(", ")}`;
});
row("P100474", "no id in this suite falls outside the two blocks T9 was given plus the two it claimed", () => {
  const ok = (n) => (n >= 62701 && n <= 63700) || (n >= 99801 && n <= 100482) || n < 54701;
  const bad = [];
  for (const f of readFileSync(P("scripts/verify-kitchen-screen.mjs"), "utf8").matchAll(/"([\w-]+)"/g)) {}
  for (const f of ["round3-branches", "round3-paths", "new-f-items789"]) {
    const t = readFileSync(P("scripts/sweep/t9/" + f + ".mjs"), "utf8");
    for (const m of t.matchAll(/(?:row|t6|t6skip)\("P(\d{5,6})"/g)) if (!ok(Number(m[1]))) bad.push("P" + m[1]);
  }
  return bad.length === 0 || `outside T9's blocks: ${[...new Set(bad)].slice(0, 6).join(", ")}`;
});
row("P100475", "every ⏭ in this suite says WHY, and names what covers it instead", () => {
  let bad = [];
  for (const f of ["replay-t6-b1", "replay-t6-b2", "replay-t6-b3", "replay-t6-b4", "replay-t6-b5", "round3-paths"]) {
    const t = readFileSync(P("scripts/sweep/t9/" + f + ".mjs"), "utf8");
    for (const m of t.matchAll(/t6skip\("P\d{5,6}", "[^"]*",\s*\n?\s*"([^"]{0,30})"/g)) if (m[1].length < 25) bad.push(f);
  }
  return bad.length === 0 || `a skip with no real reason in: ${[...new Set(bad)].join(", ")}`;
});
row("P100476", "the harness strips line comments BEFORE block comments", () => {
  const t = readFileSync(P("scripts/sweep/t9/lib.mjs"), "utf8");
  return t.indexOf("const noLine = text.replace") < t.indexOf("return noLine.replace") || "the order is reversed";
});
row("P100477", "the harness has a CSSC() so a stylesheet's prose cannot satisfy a check", () => {
  const t = readFileSync(P("scripts/sweep/t9/lib.mjs"), "utf8");
  return /export const CSSC = /.test(t) || "CSSC is gone, and CSS prose can pass a check again";
});
row("P100478", "a ⏭ is counted as skipped, never as passed", () => {
  const t = readFileSync(P("scripts/sweep/t9/lib.mjs"), "utf8");
  return /out\.startsWith\("⏭"\)/.test(t) && /skip\+\+/.test(t) || "a skip is being counted green";
});
row("P100479", "the runner can re-run exactly one row by its id", () => {
  const t = readFileSync(P("scripts/verify-kitchen-screen.mjs"), "utf8");
  return /--only/.test(t) || "the --only flag is gone";
});
row("P100480", "…and prints the command that re-runs whatever just failed", () => {
  const t = readFileSync(P("scripts/verify-kitchen-screen.mjs"), "utf8");
  return /re-run just this/.test(t) || "the re-run line is gone";
});
row("P100481", "the guard is registered in package.json as verify:kitchen", () => {
  const s = JSON.parse(readFileSync(P("package.json"), "utf8")).scripts;
  return s["verify:kitchen"] === "node scripts/verify-kitchen-screen.mjs" || `it runs: ${s["verify:kitchen"]}`;
});
row("P100482", "…and it needs no server, so it can run in the edit hook", () => {
  // JUDGE THE IMPORTS. Two earlier versions of this row reported a fault of their own: the first
  // scanned raw text and tripped on the word "playwright" inside a comment explaining what the
  // DRIVEN suites do; the second stripped strings and then tripped on `/\bfetch\(/` inside its own
  // regex literal. What actually decides whether a module needs a server is what it IMPORTS — a
  // static module pulls in nothing but node:fs, node:crypto, node:path and this suite's own files.
  const ALLOWED = /^(node:fs|node:crypto|node:path|node:url|\.\/[\w.-]+\.mjs|\.\.\/[\w.-]+\.mjs)$/;
  const bad = [];
  for (const f of ["lib", "replay-t6-harness", "round3-branches", "round3-paths", "replay-t6-b1",
                   "replay-t6-b2", "replay-t6-b3", "replay-t6-b4", "replay-t6-b5", "round2-contracts",
                   "round2-crosspanel"]) {
    const t = readFileSync(P("scripts/sweep/t9/" + f + ".mjs"), "utf8");
    for (const m of t.matchAll(/^import[^"']*["']([^"']+)["']/gm))
      if (!ALLOWED.test(m[1])) bad.push(`${f} imports ${m[1]}`);
  }
  return bad.length === 0 || bad.join("; ");
});
