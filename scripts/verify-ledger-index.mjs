// verify:ledger-index — is the sweep's permanent test record still trustworthy?
//
// `.claude/sweep/LEDGER/` is the record of everything this product has been checked for, and
// `INDEX.md` is its table of contents and its ID registry. The whole scheme rests on ONE ID = ONE
// CHECK, FOREVER — that is the only reason "re-run row P07423" is a sentence that means something.
// This guard fails when that stops being true, or when the index stops telling the next sweep to
// re-run before it re-invents.
//
// Reads only. Writes nothing. Touches no database, needs no key, runs in well under a second.
//
// ── WHAT A "PHASE ROW" IS, AND THE MISTAKE THAT MATTERS HERE (T30, 2026-08-22) ─────────────────
// A phase row is `| id | check | how to verify | result | note |` — SIX pipes, five cells.
// Ledgers ALSO contain narrative tables that reference a phase id in their first column:
// T13's "What this pass found that the first two did not", T6's "Rows whose expectation CHANGED".
// Those are three-column recap tables, they are legitimate and useful, and an id appearing in one
// is a BACK-REFERENCE, not a second check.
//
// The first version of this guard counted any line starting `| P##### |` as a phase row. It
// therefore reported 15 "duplicate ids" in T13 and 3 in T6 that do not exist, and 18 "malformed
// rows" that are simply recap rows. Reporting a fault that is not there is the same failure as
// missing one — it sends someone to renumber a perfectly good file. So: a phase row is identified
// by its SHAPE (five cells), and a first-column id in any other table shape is ignored, though it
// must still refer to an id that exists somewhere.
//
// Splitting is on UNESCAPED pipes only. Cells legitimately contain `\|` — the checks are full of
// `grep -c 'a\|b'`, `find … \| wc -l` and JavaScript's `a \|\| b`. Splitting naively both
// under-counts real rows and invents malformed ones.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = ".claude/sweep/LEDGER";
const INDEX = join(DIR, "INDEX.md");
const problems = [];
const fail = (m) => problems.push(m);

if (!existsSync(INDEX)) {
  console.error(`\n❌ verify:ledger-index — ${INDEX} is missing.\n` +
    `   It is the master record of what this product has been checked for, and the ID registry\n` +
    `   every sweep reads first. Restore it from git; it is never deleted and never archived.\n`);
  process.exit(1);
}
const index = readFileSync(INDEX, "utf8");
// ── AND WHY WIDENING THIS LINE WAS NOT ENOUGH ON ITS OWN (T18 of sweep #8, same day) ──────────
//
// T18 reached this from the other end — the owner picked it as its item 18 — and hit the half that
// is not visible from here. Both generated files wrote `| id | check |`, TWO columns, and
// `isPhaseRow` below needs SIX cells. So widening the pattern by itself did not protect those ids:
// it reclassified all of them as narrative back-references, and the dangling-reference check a few
// lines down then failed on every single one. This guard runs in the PostToolUse hook, so that
// would have blocked Write/Edit for every session in this repo.
//
// The generators were therefore fixed FIRST: `scripts/verify-admin-sweep.mjs` and
// `scripts/verify-repair-health-sweep.mjs` now emit the standard five-column row — including a
// RESULT column, because a generated ledger with nowhere to record a result cannot converge, which
// is the entire point of the ledger. If a future generated ledger appears with two columns again,
// this guard will call its rows narrative and the ids will go unprotected exactly as before. The
// shape is the requirement, not a nicety.
// ── A ROUND LEDGER IS STILL A LEDGER (T20 of sweep #8, 2026-09-04) ─────────────────────────────
//
// This matched `^T\d+\.md$` only, so a second ROUND filed by the same terminal — `T17-R2.md`
// (527 ids) and `T20-S8.md` (568) — was invisible to every check below it. Not rejected:
// **invisible**. Their 1,095 ids were absent from the duplicate scan, absent from the registry
// bounds check, and absent from the row-count snapshot that proves no ledger has lost a row. A
// later sweep could have been handed one of them a second time and this guard would have said
// nothing — which is the ONE failure a ledger cannot survive, and the same shape as the six-digit
// hole T9 closed a day earlier.
//
// `T<n>-<round>.md` now counts as a round of ledger `T<n>`. §2 below still asks INDEX.md about the
// PARENT (`T20.md`), never about the round file, so nothing that was green can go red for this: a
// round is filed under the terminal that owns it, and its territory is stated in its own header.
// ONE hyphen was not enough, and I proved it on myself within the hour: this allowed
// `T20-S8.md` and then went blind to `T20-S8-R2.md`, the very next file I filed. A round name is
// however many segments the terminal needed — the rule is "T<number>, then anything hyphenated".
const isLedger = (f) => /^T\d+(-[A-Za-z0-9]+)*\.md$/.test(f);
const parentOf = (f) => f.replace(/^(T\d+)(-[A-Za-z0-9]+)*\.md$/, "$1.md");
const ledgers = readdirSync(DIR).filter(isLedger)
  .sort((a, b) => (Number(a.replace(/^T(\d+).*$/, "$1")) - Number(b.replace(/^T(\d+).*$/, "$1"))) || a.localeCompare(b));
if (!ledgers.length) { console.error("\n❌ verify:ledger-index — no ledger files at all in " + DIR + "\n"); process.exit(1); }

const cellsOf = (line) => line.split(/(?<!\\)\|/);
// ── FIVE **OR SIX** DIGITS (T9 of sweep #8, 2026-09-03 — the owner picked it as item 15) ───────
//
// This file matched a phase id with exactly `P\d{5}` in three places, so `P99999` was the last id
// the whole scheme could express — and the registry had reached `P99921`, leaving **79**.
//
// Running out was not the danger. A six-digit id would not have been REJECTED, it would have been
// **silently ignored**: `isPhaseRow` would answer false, the row would vanish from `phaseRows`,
// from the duplicate check, from the registry, and from the row-count snapshot that §5 uses to
// prove no ledger has lost a row. A sweep would file 500 checks, this guard would go green, and
// the ids would be handed to somebody else later. That is the one failure mode a ledger cannot
// survive — the whole point of an id is that it means one check, forever.
//
// `{5,6}` keeps every existing id valid (they are all five digits) and costs nothing. It is
// deliberately NOT `{5,}`: an unbounded run of digits would swallow a typo'd twelve-digit id as a
// legitimate one, and the padStart below assumes a known width.
const ID_DIGITS = "\\d{5,6}";
const FIRST_COL_ID = new RegExp(`^\\|\\s*(P${ID_DIGITS})\\s*\\|`);
// A PHASE ROW IS DECIDED BY ITS OWN TABLE'S HEADER, NOT BY A FIXED WIDTH (sweep #7 / T28,
// 2026-08-29).
//
// This required exactly five cells, because every ledger up to sweep #6 wrote
// `| id | check | how to verify | result | note |`. T16's sweep-#7 block declares a FOUR-column
// table in its own header — `| id | check | result | note |` — and drops the how-to-verify column.
// That is a legitimate choice and its 500 rows read perfectly well; this guard simply could not see
// them, so it reported all 500 as "an id in a first column that no phase row carries" and went red
// on clean main. Worse than the noise: 500 ids were invisible to the REGISTRY, which is the one job
// this file has — a future sweep could have handed T16's numbers to somebody else.
//
// So: a row is a phase row if it starts with an id and has AT LEAST four cells, and the id, result
// and note are read by position from the header that introduced it. Assert the property (an id, a
// verdict, a place to say why), never one particular column count.
const PHASE_ROW_START = new RegExp(`^\\|\\s*P${ID_DIGITS}\\s*\\|`);
//
// ── AND A ROUND LEDGER MAY DECLARE ONLY `| id | check |` (T20 of sweep #8, 2026-09-04) ─────────
// `T17-R2.md` does exactly that, on purpose: its 527 rows are GENERATED from
// scripts/verify-admin-sweep.mjs, and it keeps the verdict in the run's output rather than in a
// column a hand could edit. Once the file-name pattern above learned to see round ledgers, those
// rows arrived here as four cells and were filed as narrative — so 527 real ids read as "an id no
// phase row carries" and the guard went red on a file that is perfectly well formed.
//
// A two-cell row inside a ROUND ledger counts as a phase row for the one purpose that matters
// most: OWNING ITS ID, so nobody can be handed it twice. It carries no verdict column, and §4's
// result/note reads below simply find nothing there — which is the truth about that table, not a
// fault in it. Every other ledger still needs its four cells, so a recap row elsewhere cannot be
// mistaken for a phase row.
// ONE hyphen was not enough, and T20 proved it on itself within the hour: this allowed
// `T20-S8.md` and then went blind to `T20-S8-R2.md`, the very next file it filed. A round name is
// however many segments the terminal needed — the rule is "T<number>, then anything hyphenated".
const isRound = (f) => /^T\d+(-[A-Za-z0-9]+)+\.md$/.test(f);
// ── …AND THE GENERATOR IT HANDS ITS VERDICT TO MUST ACTUALLY BE THERE (T19 of sweep #8, the same
//    day, integrated onto T20's item 7 rather than over it) ────────────────────────────────────
// The rule above is right and stays: a round ledger may keep its verdict in a run's output instead
// of in a column. The half it does not cover is what happens when that run stops existing. Every
// such file NAMES its generator in its own header — T17-R2.md says "Regenerate with `node
// scripts/verify-admin-sweep.mjs --ledger`" — so the claim is checkable, and if the script is ever
// deleted or renamed those rows quietly become 527 ids with no way to re-run them at all: still
// counted, still protected from a collision, and no longer provable. That is the one thing a
// verdict-less table has to be held to.
const GENERATOR = /(?:Regenerate with|generated from|GENERATED from)[^\n]*?`?\s*node (scripts\/[A-Za-z0-9._-]+\.mjs)/i;
const generatorOf = (src) => (src.match(GENERATOR) || [])[1] || null;
const isPhaseRow = (line, file) =>
  PHASE_ROW_START.test(line) && (cellsOf(line).length >= 6 || (isRound(file || "") && cellsOf(line).length >= 4));

// ── 1 · one ID, one check, forever ─────────────────────────────────────────────────────────────
const owner = new Map();      // id -> file, for PHASE rows only
const referenced = new Map();  // id -> [files] where a recap table mentions it
let phaseRows = 0;
const generatedBy = new Map();   // ledger -> the script that writes its rows, when it names one
for (const f of ledgers) {
  const src = readFileSync(join(DIR, f), "utf8");
  const lines = src.split("\n");
  const gen = generatorOf(src);
  if (gen) {
    if (!existsSync(gen)) {
      fail(`${f} says its rows are generated by ${gen}, and that file is not here. Its ids then ` +
        `have no way to be re-run at all — restore the generator, or give the table a result ` +
        `column so a person can read the verdict.`);
    } else generatedBy.set(f, gen);
  }
  const seen = new Set();
  let rows = 0;
  for (const line of lines) {
    const m = line.match(FIRST_COL_ID);
    if (!m) continue;
    const id = m[1];
    if (!isPhaseRow(line, f)) {                    // a recap / narrative table row
      (referenced.get(id) || referenced.set(id, []).get(id)).push(f);
      continue;
    }
    rows++; phaseRows++;
    if (seen.has(id)) fail(`${f} uses ${id} on two different PHASE rows. An id means one check, ` +
      `forever — give the second one a fresh id from the repair block INDEX.md reserves.`);
    seen.add(id);
    const prev = owner.get(id);
    if (prev && prev !== f) fail(`${id} is a phase row in BOTH ${prev} and ${f}. One of them ran ` +
      `past its block. Renumber the newer one into INDEX.md's repair block; never renumber the ` +
      `terminal whose block it legitimately is.`);
    else owner.set(id, f);
  }
  if (rows === 0) fail(`${f} contains no phase rows at all — a ledger with no rows records nothing. ` +
    `A phase row is \`| id | check | how to verify | result | note |\`; check the pipes.`);
}

// A recap row must point at an id that actually exists, or it is a dangling reference.
// The overwhelmingly likely cause is NOT a typo: it is a PHASE row whose cell holds an unescaped
// pipe, so it parsed as a narrative row and its id looks unclaimed. Say that first, because sending
// someone hunting for a renumbering when the real fix is one backslash wastes the whole trip.
// (T22's P10509 was exactly this: `topic||':'||restaurant_id` in its check column.)
for (const [id, files] of referenced)
  if (!owner.has(id)) fail(`${[...new Set(files)].join(", ")}: ${id} appears in a first column but ` +
    `no PHASE row carries it. Most likely that very row IS a phase row whose cell contains an ` +
    `unescaped \`|\` — from a \`grep -c 'a|b'\`, a \`… | wc -l\`, or JavaScript's \`a || b\` — so it ` +
    `parsed as narrative. Escape the pipe as \`\\|\` and re-run. Only if the row really is a ` +
    `back-reference is this a renumbering that was not followed through, or a typo.`);

// ── 2 · every ledger is in the index, and every index entry is real ────────────────────────────
for (const f of ledgers) {
  // A round file is answered for by its parent's row: `T20-S8.md` is a second round of T20's
  // ledger, filed under the terminal that owns it, with its own territory in its own header.
  const t = parentOf(f).replace(".md", "");
  const byName = new RegExp(`\\b${t}\\.md\\b`);
  const byRow = new RegExp(`^\\|\\s*${t.slice(1)}\\s*\\|`, "m");
  if (!byName.test(index) && !byRow.test(index))
    fail(`${DIR}/${f} exists but INDEX.md has no row for it — add its territory and its ID block, ` +
         `or the next sweep will not know it is there.`);
}
for (const m of index.matchAll(/\bT(\d+)\.md\b/g)) {
  const f = `T${m[1]}.md`;
  if (ledgers.includes(f)) continue;
  const near = index.slice(Math.max(0, m.index - 500), m.index + 500);
  if (!/NEVER FILED|not yet filed|unmerged branch/i.test(near))
    fail(`INDEX.md points at ${DIR}/${f}, which does not exist here — either file it, or say ` +
         `"NEVER FILED" (or name the branch it lives on) beside it, so the gap stays visible.`);
}

// ── 3 · the index still carries the instruction that makes the ledger worth anything ───────────
for (const [re, what] of [
  [/RE-?RUN EVERY EXISTING ROW/i, `the instruction to RE-RUN EVERY EXISTING ROW before writing a new phase. ` +
    `Without it the next sweep invents a different set of checks and the convergence is lost — which ` +
    `is what sweeps #1 to #5 each did, five times over.`],
  [/next free ID/i, `the next free phase ID. With no registry a sweep reuses an id, and then two ` +
    `different checks answer to one number.`],
  [/[Nn]ever reuse an ID/, `"never reuse an ID, never renumber anyone else's".`],
]) if (!re.test(index)) fail(`INDEX.md no longer states ${what}`);

// ── 4 · the next free ID really is free ────────────────────────────────────────────────────────
const declared = index.match(new RegExp(`next free ID[^P]*P(${ID_DIGITS})`, "i"));
if (declared) {
  const next = Number(declared[1]);
  const taken = [...owner.keys()].map((i) => Number(i.slice(1))).filter((n) => n >= next);
  const pad = (n) => "P" + String(n).padStart(declared[1].length, "0");
  if (taken.length) fail(`INDEX.md says the next free ID is ${pad(next)}, but ` +
    `${taken.length} phase row(s) already use that id or higher (lowest: ` +
    `${pad(Math.min(...taken))}). Move the registry forward, or the next ` +
    `sweep collides on its very first new phase.`);
}

// ── 5 · A LEDGER MAY GROW. IT MAY NOT SHRINK. ─────────────────────────────────────────────────
//
// Found the expensive way (sweep #8, terminal 7, 2026-09-03): a terminal wrote its new section by
// OVERWRITING T7.md instead of appending to it, and destroyed 2,802 permanent rows — and this
// guard, whose entire job is protecting the ledger, PASSED. Everything it checked was still true
// of what was left: no duplicate ids, no dangling back-reference, the index still carried its
// instructions. It counts what is there; it had no idea what used to be.
//
// That is the one thing the ledger cannot survive, because the whole value of 55,000 numbered
// checks is that "re-run P04477" still means something years later. A row count per file, kept
// beside the ledgers and committed with them, is enough: growth is always fine and is recorded
// automatically, a DROP is never fine and stops the run.
//
//   node scripts/verify-ledger-index.mjs --bless    ← the deliberate escape hatch, for the one
//   legitimate case: a repair that MOVES ids between files (T18 moved 1,029 in 2026-09-01). It
//   records today's counts as the new floor, and it is a thing a person types on purpose.
const COUNTS = join(DIR, "ROW-COUNTS.json");
const BLESS = process.argv.includes("--bless");
const nowCounts = {};
for (const f of ledgers) {
  nowCounts[f] = readFileSync(join(DIR, f), "utf8").split("\n").filter(isPhaseRow).length;
}
let floor = {};
if (existsSync(COUNTS)) { try { floor = JSON.parse(readFileSync(COUNTS, "utf8")); } catch { floor = {}; } }
if (!BLESS) {
  for (const [f, was] of Object.entries(floor)) {
    if (!(f in nowCounts)) {
      fail(`the ledger ${f} is GONE. It held ${was} numbered check(s). A ledger file is permanent — ` +
        `every one of those ids is a sentence somebody can still say ("re-run P04477"). Restore it ` +
        `from git, or run --bless if the rows genuinely moved to another file.`);
      continue;
    }
    if (nowCounts[f] < was) {
      fail(`the ledger ${f} has SHRUNK — ${was} numbered check(s) before, ${nowCounts[f]} now, ` +
        `${was - nowCounts[f]} lost. A sweep APPENDS its section; it never overwrites the file. ` +
        `Recover them with \`git diff ${join(DIR, f)}\`, or run --bless if the rows genuinely moved ` +
        `to another ledger.`);
    }
  }
}
// Growth (and a brand-new ledger) is normal and is recorded without being asked. This write only
// happens on a run that is otherwise about to pass, so the baseline can never be moved DOWN by
// simply running the guard again after the damage.
if (!problems.length) {
  const next = {};
  for (const f of Object.keys(nowCounts).sort()) next[f] = BLESS ? nowCounts[f] : Math.max(nowCounts[f], floor[f] || 0);
  const text = JSON.stringify(next, null, 2) + "\n";
  if (!existsSync(COUNTS) || readFileSync(COUNTS, "utf8") !== text) writeFileSync(COUNTS, text);
}

if (problems.length) {
  console.error(`\n❌ verify:ledger-index — ${problems.length} problem(s):\n`);
  problems.forEach((p) => console.error("  · " + p + "\n"));
  process.exit(1);
}
const genNote = generatedBy.size
  ? `, ${generatedBy.size} of them generated (${[...generatedBy.entries()].map(([f, g]) => `${f} ← ${g}`).join("; ")})`
  : "";
console.log(`✅ verify:ledger-index — ${ledgers.length} ledger(s)${genNote}, ${phaseRows} phase rows, ` +
  `${owner.size} distinct ids, no collisions, ${referenced.size} summary back-reference(s) all resolving, ` +
  `no ledger has lost a row, and INDEX.md still tells the next sweep to re-run before it re-invents.`);
