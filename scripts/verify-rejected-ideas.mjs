#!/usr/bin/env node
// verify-rejected-ideas.mjs — the owner's rejections must be findable AT THE CODE, not just in a doc.
//
// THE RULE (owner, 2026-08-07): "everything I reject also should be written in the comment in the code.
// And while suggesting something and doing, at that time, you have to make sure I have already said no
// for it. So you don't repeat the same thing again."
//
// He said that after being offered — for the third time — a change he had already refused twice (a
// profile on the kitchen panel). A list in a doc nobody opens does not stop that. A comment sitting on
// the exact line someone would otherwise edit does.
//
// So this guard checks BOTH halves stay joined:
//   1. every row in docs/REJECTED-IDEAS.md names at least one code site,
//   2. every one of those sites really carries a `REJECTED (owner, …)` comment,
//   3. every `REJECTED (owner, …)` comment in the codebase is traceable to a row (no orphan claims),
//   4. the doc still explains the rule and how to add one.
//
// Read-only. Run it any time: `npm run verify:rejected`.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const DOC = "docs/REJECTED-IDEAS.md";
let pass = true;
const fail = (m, d) => { pass = false; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

if (!existsSync(`${ROOT}/${DOC}`)) {
  console.log(`✗ ${DOC} is missing — the owner's rejections have nowhere to live.`);
  process.exit(1);
}
const doc = readFileSync(`${ROOT}/${DOC}`, "utf8");

// 1 · the doc must still carry the rule and the how-to (someone deleting them defeats the point)
for (const [what, needle] of [
  ["the owner's rule, in his words", "written in the comment in the code"],
  ["the 'read this before suggesting' instruction", "BEFORE suggesting any improvement"],
  ["the how-to-add section", "## How to add one"],
  ["a Reversed section (so a change of mind has somewhere to go)", "## Reversed"],
]) doc.includes(needle) ? ok(`doc keeps ${what}`) : fail(`doc lost ${what}`, `expected to find: "${needle}"`);

// 2 · parse the table rows: | R1 | idea | decision | code site |
// ONLY the rows ABOVE "## Reversed". A reversed row is no longer a rejection — the doc's own
// how-to says to move one there when he changes his mind — and the two checks below cannot hold
// for it: it records a reversal rather than a NO, and the code it named is often the code that was
// DELETED, which is exactly why the decision changed. (Found the first time a row was ever moved:
// R8, 2026-08-15. The Reversed section had said "(none yet)" since the file was written, so this
// half of the guard had never once run.)
const active = doc.includes("## Reversed") ? doc.slice(0, doc.indexOf("## Reversed")) : doc;
const rows = [...active.matchAll(/^\|\s*(R\d+)\s*\|([^|]+)\|([^|]+)\|(.+?)\|\s*$/gm)]
  .map((m) => ({ id: m[1], idea: m[2].trim(), decision: m[3].trim(), sites: m[4].trim() }));
if (!rows.length) fail("no rejection rows found in the doc's table");
else ok(`${rows.length} rejection${rows.length === 1 ? "" : "s"} listed (${rows.map((r) => r.id).join(", ")})`);

// every row must actually say NO and name a file
for (const r of rows) {
  if (!/\bNO\b/.test(r.decision)) fail(`${r.id} does not record a clear NO`, r.decision.slice(0, 90));
  const files = [...r.sites.matchAll(/`([^`]+?\.(?:ts|tsx|js|css|mjs))`/g)].map((m) => m[1].split(" ")[0]);
  if (!files.length) { fail(`${r.id} names no code file in its "code site" column`, r.sites.slice(0, 90)); continue; }
  // WHICH LINE the comment sits on, not just which file (T10 sweep, 2026-08-12).
  //
  // CLAUDE.md promises "a `REJECTED (owner, <date>):` comment on the exact line someone would
  // otherwise change". This only checked that the FILE contained one somewhere. Four of the eight
  // rows name public/panels/tablet/app.js, so a single comment anywhere in an 11,000-line file
  // satisfied all four — and the one thing that actually stops the mistake is the comment being
  // where the person is already looking. (Checked by hand at the time: every row really did have
  // its own comment at the right function. The guard simply would not have noticed if it didn't.)
  //
  // The row already names the site — "`public/panels/tablet/app.js` → `tileHtml()`" — so use it.
  // NEAR means within 60 lines: close enough that the comment is on screen with the code, loose
  // enough that adding a few lines between them is not a failure.
  const NEAR = 60;
  const siteHints = [...r.sites.matchAll(/→\s*`([^`]+)`/g)].map((m) => m[1].replace(/\(\)$/, ""));
  for (const f of files) {
    if (!existsSync(`${ROOT}/${f}`)) { fail(`${r.id} points at a file that does not exist`, f); continue; }
    const src = readFileSync(`${ROOT}/${f}`, "utf8");
    const lines = src.split("\n");
    const marks = lines.map((l, i) => (/REJECTED \(owner,/.test(l) ? i : -1)).filter((i) => i >= 0);
    if (!marks.length) { fail(`${r.id}: ${f} carries no "REJECTED (owner, …)" comment`, "the doc says no, the code does not"); continue; }

    // WHICH LINES COUNT AS "THE PLACE SOMEONE WOULD EDIT" — code lines, never comment lines.
    //
    // WHY (T27 sweep, 2026-08-28). The hint used to be matched against every line, including the
    // lines of the REJECTED note itself — and a good note usually names its own anchor, because it
    // is explaining what not to change. So the note satisfied "is the comment near the code?"
    // against ITSELF and passed wherever it sat. Found while adding R23's pointers to four files:
    // all four went green on a word inside the note.
    //
    // The masking has to be a real BLOCK-comment strip, not a per-line startsWith test. The first
    // attempt tested each line for a leading `//` or `*`, which does nothing for the interior of a
    // `/* … */` in CSS or a `{/* … */}` in JSX — the middle lines of those start with ordinary
    // words, so a note inside one still matched itself. Blanking the comment RANGES while keeping
    // the line count is what makes the anchor honest.
    const masked = src
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))   // /* … */ and {/* … */}
      .replace(/(^|[^:])\/\/[^\n]*/g, (c, p) => p + c.slice(p.length).replace(/./g, " "))
      .split("\n");
    const isCode = (i) => (masked[i] || "").trim() !== "";
    const hasHint = (i, h) => isCode(i) && (masked[i] || "").includes(h);

    // ANY of the row's anchors, not just the first one that happens to appear.
    //
    // A row that names several files names several anchors — R23 lists five sites — and `find()`
    // took the first anchor present in THIS file, which in app/globals.css was `split` (from
    // `.hero-title.has-split`) rather than the `greet-badge` the row meant for it. The comment was
    // in exactly the right place and the check still failed. A rejection is satisfied when its note
    // sits at ONE of the places someone would edit; it does not have to sit at all of them.
    const usable = siteHints.filter((h) => h && !h.includes("/") && lines.some((_, i) => hasHint(i, h)));
    if (!usable.length) { ok(`${r.id} → ${f} carries its REJECTED comment`); continue; }
    const nearHint = usable.find((h) => {
      const at = lines.map((_, i) => (hasHint(i, h) ? i : -1)).filter((i) => i >= 0);
      return marks.some((m) => at.some((a) => Math.abs(a - m) <= NEAR));
    });
    if (nearHint) { ok(`${r.id} → ${f} carries its REJECTED comment AT ${nearHint}`); continue; }
    fail(
      `${r.id}: ${f} has a REJECTED comment, but not near any of \`${usable.join("`, `")}\` — the places someone would edit`,
      `comment(s) at line ${marks.map((m) => m + 1).join(", ")}. ` +
        `A rejection nobody sees while editing is the one that gets re-suggested — that is what this file exists to stop.`,
    );
  }
}

// 3 · no orphan claims: a REJECTED comment must be traceable to a row
let files = [];
try {
  // execFileSync with an argument array: no shell, so nothing here can be re-interpreted as a command.
  files = execFileSync("git", ["ls-files", "lib", "app", "public/panels", "components", "scripts"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((f) => /\.(ts|tsx|js|mjs|css)$/.test(f));
} catch { /* not a git checkout — skip this half rather than fail the run */ }
const orphans = [];
for (const f of files) {
  if (f.endsWith("scripts/verify-rejected-ideas.mjs")) continue;   // this file talks ABOUT the marker
  const src = readFileSync(`${ROOT}/${f}`, "utf8");
  if (!/REJECTED \(owner,/.test(src)) continue;
  // it must point back at the doc, so a reader can find the decision and the date
  if (!/REJECTED-IDEAS\.md/.test(src)) orphans.push(f);
}
orphans.length
  ? fail(`${orphans.length} file(s) claim a REJECTED decision without pointing at ${DOC}`, orphans.join("\n      "))
  : ok("every REJECTED comment in the codebase points back at the doc");

const byIdAll = new Map([...doc.matchAll(/^\|\s*(R\d+)\s*\|([^|]+)\|/gm)].map((m) => [m[1], { idea: m[2].trim() }]));
// 3b · THE NUMBER IN THE CODE MUST BE THE NUMBER IN THE DOC (T5 sweep #7, 2026-08-22)
//
// THE FAULT THIS EXISTS FOR, found in the manager panel and fixed in the same branch. Three rows
// were added to the doc, the numbers after them shifted, and four comments were left citing the
// OLD ones:
//
//   public/panels/editor/app.js    "R28: there is NO third, short 'Order' face"  → the row is R31
//                                   (R28 is now the guest menu's 3D-preload cap)
//   public/panels/editor/app.js    "R29: there is no 🍽️ Serve-all on the tile"    → the row is R32
//                                   (R29 is now the guest call-waiter bell)
//   public/panels/editor/app.js    the empty-party line, citing R30              → the row is R33
//                                   (R30 is now the guest hero's translated fallback)
//   public/panels/editor/style.css the same R28                                  → the row is R31
//
// Everything above stayed GREEN through all of it: check 2 asks "is there a comment near the code",
// check 3 asks "does the comment name the doc". Neither asks whether the NUMBER lands on the right
// row — so a reader following "R29" out of the tile arrived at a decision about a guest-menu bell,
// with nothing to tell them which of the two was wrong. That is the confusion this whole file
// exists to prevent, one level up.
//
// THE TEST RUNS DOC → CODE, not code → doc, and the direction is the whole point. A guard, a test
// or a second file may legitimately cite a rejection it merely enforces (verify-one-bill-delete
// cites R27; lib/staffProfileShared.test.mjs cites R7) and the row has no reason to list them —
// the first cut of this check ran the other way and accused all eight of them. So: for each row,
// each file the ROW ITSELF names must, if it cites any rejection number at all, cite THIS one.
{
  // THE TEST, in one sentence: in a file the doc names as a code site, every rejection number a
  // comment cites must be one of the numbers whose rows name THAT file.
  //
  // Two earlier cuts of this check were wrong and both are worth recording, because each looked
  // reasonable:
  //   · "the row's file must cite the row's number" — over-fires on R8, R37 and R39, whose comments
  //     are written in the older style with no number at all. Correct code, three red lines.
  //   · "the comment nearest the row's named symbol must cite that row" — a file can hold six
  //     rejections and their symbols appear all over it (`floorTileHtml` is referenced three times),
  //     so the 60-line window claims comments that belong to a neighbour. Four more red lines.
  // The subset rule needs neither a window nor a numbering convention, and it is exactly the thing
  // that went wrong: a number that belongs to somebody else's row.
  //
  // Files the doc names NOWHERE are exempt on purpose. A guard, a test or a second reader may cite
  // a rejection it merely enforces — verify-one-bill-delete.mjs cites R27, staffProfileShared.test
  // cites R7 — and a row has no reason to list them.
  const named = new Map();                                   // file → the ids whose row names it
  for (const m of doc.matchAll(/^\|\s*(R\d+)\s*\|([^|]+)\|([^|]+)\|(.+?)\|\s*$/gm)) {
    for (const g of m[4].matchAll(/`([^`]+?\.(?:ts|tsx|js|css|mjs))`/g)) {
      const f = g[1].split(" ")[0];
      if (!named.has(f)) named.set(f, new Set());
      named.get(f).add(m[1]);
    }
  }
  let checked = 0;
  const wrong = [];
  for (const [f, ids] of named) {
    if (!existsSync(`${ROOT}/${f}`)) continue;                // a row whose code was deleted (R8)
    const lines = readFileSync(`${ROOT}/${f}`, "utf8").split("\n");
    lines.forEach((l, i) => {
      const c = l.match(/REJECTED-IDEAS\.md\s+(R\d+)/);
      if (!c) return;
      checked++;
      if (ids.has(c[1])) return;
      const other = byIdAll.get(c[1]);
      wrong.push(`${f}:${i + 1} cites ${c[1]}, but ${c[1]} is `
        + (other ? `the row about "${other.idea.slice(0, 62)}…"` : "not a row in the doc at all")
        + ` — this file's own rejections are ${[...ids].join(", ")}`);
    });
  }
  if (!checked) fail("no rejection comment cites its row by number", "the numbers are how a reader gets from the code to the decision");
  else if (!wrong.length) ok(`${checked} numbered citation${checked === 1 ? "" : "s"} land on a row that names their own file`);
  else fail(`${wrong.length} rejection number(s) have DRIFTED between the doc and the code`, wrong.join("\n      ") + "\n      A number that has drifted sends the next reader to somebody else's decision.");
}

// 4 · the standing rule must be in CLAUDE.md too, or a new session never learns it exists
const claude = existsSync(`${ROOT}/CLAUDE.md`) ? readFileSync(`${ROOT}/CLAUDE.md`, "utf8") : "";
/REJECTED-IDEAS\.md/.test(claude)
  ? ok("CLAUDE.md points at the rejected-ideas list")
  : fail("CLAUDE.md does not mention docs/REJECTED-IDEAS.md", "a rule nobody is told about is not a rule");

console.log(pass
  ? "\n✅ PASS — every rejection is recorded in the code as well as the doc"
  : "\n❌ FAIL — a rejection the owner made is not where the next person will look");
process.exit(pass ? 0 : 1);
