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
import { readFileSync, readdirSync, existsSync } from "node:fs";
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
const ledgers = readdirSync(DIR).filter((f) => /^T\d+\.md$/.test(f))
  .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
if (!ledgers.length) { console.error("\n❌ verify:ledger-index — no ledger files at all in " + DIR + "\n"); process.exit(1); }

const cellsOf = (line) => line.split(/(?<!\\)\|/);
const FIRST_COL_ID = /^\|\s*(P\d{5})\s*\|/;
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
const isPhaseRow = (line) => /^\|\s*P\d{5}\s*\|/.test(line) && cellsOf(line).length >= 6;

// ── 1 · one ID, one check, forever ─────────────────────────────────────────────────────────────
const owner = new Map();      // id -> file, for PHASE rows only
const referenced = new Map();  // id -> [files] where a recap table mentions it
let phaseRows = 0;
for (const f of ledgers) {
  const lines = readFileSync(join(DIR, f), "utf8").split("\n");
  const seen = new Set();
  let rows = 0;
  for (const line of lines) {
    const m = line.match(FIRST_COL_ID);
    if (!m) continue;
    const id = m[1];
    if (!isPhaseRow(line)) {                       // a recap / narrative table row
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
  const t = f.replace(".md", "");
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
const declared = index.match(/next free ID[^P]*P(\d{5})/i);
if (declared) {
  const next = Number(declared[1]);
  const taken = [...owner.keys()].map((i) => Number(i.slice(1))).filter((n) => n >= next);
  if (taken.length) fail(`INDEX.md says the next free ID is P${String(next).padStart(5, "0")}, but ` +
    `${taken.length} phase row(s) already use that id or higher (lowest: ` +
    `P${String(Math.min(...taken)).padStart(5, "0")}). Move the registry forward, or the next ` +
    `sweep collides on its very first new phase.`);
}

if (problems.length) {
  console.error(`\n❌ verify:ledger-index — ${problems.length} problem(s):\n`);
  problems.forEach((p) => console.error("  · " + p + "\n"));
  process.exit(1);
}
console.log(`✅ verify:ledger-index — ${ledgers.length} ledger(s), ${phaseRows} phase rows, ` +
  `${owner.size} distinct ids, no collisions, ${referenced.size} summary back-reference(s) all resolving, ` +
  `and INDEX.md still tells the next sweep to re-run before it re-invents.`);
