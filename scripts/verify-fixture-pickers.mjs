// verify-fixture-pickers.mjs — A GUARD THAT PICKS ITS OWN TABLE MUST NOT SIT AT SOMEBODY ELSE'S.
//
//   node scripts/verify-fixture-pickers.mjs
//   npm run verify:fixture-pickers
//
// WHY THIS EXISTS (sweep #7 / T4, 2026-08-22).
//
// scripts/sweep/fixtureTables.mjs is the list of tables a specific guard has claimed, and
// `claimedTables()` is how a guard that chooses its table DYNAMICALLY is supposed to skip them. The
// reason is not tidiness. A dynamic picker that finds no free table BORROWS one by closing its bill,
// and closing a session cancels and archives every unpaid live order on it (mig 232) — so it ends
// another lane's party mid-run, and THAT lane then reports a fault in the product. Sweep #6 measured
// exactly this: a picker took table 28 out from under verify-void-on-joined-party, which reported a
// void that had destroyed a whole party. It had not; the picker had.
//
// The fix went into the one picker that was known about. It did not stay fixed, and could not have:
//
//   verify-offline.mjs had TWO pickers. pickFreeTable() consulted claimedTables() and carried three
//   paragraphs explaining why. Section 5b, added separately, walked DOWN from 30 by hand —
//   `for (let i = 30; i >= 1; i--)` — consulted nothing, and re-opened the identical hole on the
//   IDENTICAL table. Measured 2026-08-22 against a production build: it seated table 28, then closed
//   and billed it. Nothing was watching, because the rule lived in a comment beside one loop rather
//   than in a check over all of them.
//
// A collision like that is the most expensive kind of test failure this project can have: it looks
// exactly like a real product fault, it lands in a DIFFERENT terminal's report, and it only happens
// when two runs overlap, so it does not reproduce when somebody goes looking.
//
// WHAT IT ASKS, and how it avoids crying wolf. A guard that works on a fixed OFF-PLAN name (288,
// ALGTEST, 9931 …) needs none of this — the name is its own, by construction. So a script is only
// asked the question when all three of these are true:
//
//   1. it opens or closes a dining SESSION (so it can really destroy another lane's party), and
//   2. it chooses its table from a NUMERIC RANGE rather than a fixed name, and
//   3. that choice is not filtered by claimedTables().
//
// Reads only. No key, no database, no server, well under a second.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(ROOT, "scripts");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m, why) => { fail++; console.log(`  FAIL ${m}${why ? `\n       ${why}` : ""}`); };

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    // .ts AS WELL AS .mjs (sweep #7 / T28, 2026-08-28). Two guards in this folder are TypeScript —
    // verify-cancel-loss.ts and verify-cancel-made.ts — and this walk skipped both. They happen to
    // use fixed off-plan names (T12-TEST, T12-P2) so nothing was wrong, but "nothing is wrong today"
    // is not the same as "this is checked", and the next .ts guard that picks a table dynamically
    // would have gone unseen. Neither .d.ts nor this file itself.
    else if (/\.(mjs|ts)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && e.name !== "verify-fixture-pickers.mjs") files.push(p);
  }
})(SCRIPTS);

// The list itself has to be there and be non-empty, or every check below is vacuously green —
// which is how a guard ends up asserting nothing at all.
let claimed = [];
try {
  claimed = (await import(join(SCRIPTS, "sweep/fixtureTables.mjs"))).claimedTables();
} catch (e) {
  bad("scripts/sweep/fixtureTables.mjs still exports claimedTables()", e.message);
}
claimed.length > 0
  ? ok(`the fixture list names ${claimed.length} table(s) that belong to a specific guard`)
  : bad("the fixture list is empty", "nothing below can protect anything while this list has no entries");

// Does this file seat a party at a table at all?
//
// WIDENED (sweep #7 / T28, 2026-08-27). It used to look only for the session ROUTES —
// /sessions/open, /sessions/<id>/close. verify-write-paths.mjs seats its parties by calling
// `lfh_staff_place_order` directly, which opens a session as a side effect, so this guard never
// looked at it — and verify-write-paths walks UP from table 5 through the whole floor taking the
// first one with no open session, straight into 27/28, which belong to
// verify-void-on-joined-party. Two guards on one table is the failure sweep #6 fixed twice; it
// looks exactly like a real product fault and only happens when the two runs overlap. The picker
// guard could not see the one unfenced picker left in the folder.
//
// So: placing an order at a table number seats a party just as surely as opening a session does.
const TOUCHES_SESSION = /sessions\/open|sessions\/[^/`"']*\/close|\/close`|closeSession\s*\(|lfh_staff_place_order|lfh_open_session|from\("sessions"\)[\s\S]{0,80}?\.insert\(|\/api\/tablet\/order/;

// TWO THINGS THIS HAD TO LEARN, because the first draft of it cried wolf twice on a clean tree —
// and a guard that invents a failure protects nothing.
//
//  1. "Near the word table" is not "picking a table". verify-edge-cases.mjs has
//     `for (let i = 0; i < 6; i++)` — a RETRY loop that re-dispatches a gate event, whose body
//     happens to contain `table: t`. So the loop's OWN VARIABLE must be what is used as the table.
//  2. The claimed-list filter is often applied to the candidate list several lines LATER, not
//     inside the loop. verify-offline.mjs builds `Array.from({length: 30})` and filters it 15 lines
//     down. So the question is asked of the whole ENCLOSING FUNCTION, not a fixed character window.

/** The span of the function that encloses `at` — brace-matched, so the answer is the real body. */
const enclosingFn = (src, at) => {
  const head = src.lastIndexOf("function ", at);
  const arrow = src.lastIndexOf("=> {", at);
  const start = Math.max(head, arrow);
  if (start < 0) return src;
  let open = src.indexOf("{", start);
  if (open < 0 || open > at) return src.slice(start, at + 2000);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return src.slice(start);
};

const FENCED = /claimedTables\s*\(|ownedTables|owned\w*\.has\(|\bowned\b/;

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rel = relative(ROOT, f);
  // GUARDS AND SWEEP HELPERS ONLY. Widening TOUCHES_SESSION (below) also brought in
  // scripts/load-ramp-orders.mjs, and that is a LOAD TOOL: it exists to fill the floor on purpose,
  // it is never run beside a guard (the sweep rules forbid it outright), and this check's own
  // sentence — "borrowing another guard's table destroys that lane's party" — is not about it.
  // Flagging it would be the guard inventing a failure, which is the one thing it must not do.
  if (!/^scripts\/verify-|^scripts\/sweep\/|^tests\//.test(rel)) continue;
  if (!TOUCHES_SESSION.test(src)) continue;

  const suspects = [];

  // Shape 1 — a counting loop whose OWN variable is used as a table number.
  for (const m of src.matchAll(/for\s*\(\s*(?:let|var)\s+(\w+)\s*=\s*[\w.()]+\s*;\s*\1\s*(?:>=|<=|<|>)\s*[\w.()]+\s*;\s*\1(?:\+\+|--|\s*[+-]=)/g)) {
    const v = m[1];
    const body = src.slice(m.index, m.index + 700);
    const usedAsTable = new RegExp(`table=\\$\\{${v}\\}|\\btable\\s*:\\s*\\$?\\{?${v}\\b|String\\(\\s*${v}\\s*\\)`).test(body);
    if (usedAsTable) suspects.push({ what: `a for-loop using \`${v}\` as the table number`, at: src.slice(0, m.index).split("\n").length, idx: m.index, body });
  }
  // Shape 2 — a generated range of table keys.
  for (const m of src.matchAll(/Array\.from\(\s*\{\s*length:\s*[\w.()]+\s*\}[^;\n]*\)/g)) {
    const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
    if (/key|table/i.test(line)) suspects.push({ what: "a generated range of table keys", at: src.slice(0, m.index).split("\n").length, idx: m.index });
  }
  if (!suspects.length) continue;

  if (!/claimedTables\s*\(/.test(src)) {
    bad(`${rel} picks a table from a range but never consults claimedTables()`,
      `${suspects.length} range picker(s), first at line ${suspects[0].at} (${suspects[0].what}).\n       `
      + "It opens or closes a session, so borrowing another guard's table destroys that lane's party (mig 232).\n       "
      + "Import claimedTables from scripts/sweep/fixtureTables.mjs and skip those numbers.");
    continue;
  }
  // It knows the rule — so EVERY picker in it must actually apply it, not just the one that was
  // fixed when somebody noticed. Judged over the enclosing function, per lesson 2 above.
  // The fence counts wherever it really applies: inside the loop (a `continue` on a claimed
  // number) or anywhere in the enclosing function (a `.filter()` on the candidate list).
  const unfenced = suspects.filter((s) => !FENCED.test(s.body || "") && !FENCED.test(enclosingFn(src, s.idx)));
  unfenced.length === 0
    ? ok(`${rel}: all ${suspects.length} table picker(s) skip the tables other guards own`)
    : bad(`${rel} has a table picker that skips the claimed list and one that does not`,
      `unfenced picker at line ${unfenced[0].at} (${unfenced[0].what}).\n       `
      + "This is the exact shape that took table 28 from verify-void-on-joined-party: the rule lived\n       "
      + "in a comment beside ONE loop, and the second loop in the same file inherited none of it.");
}

// And the reasoning must stay written down where the next person will look for it.
{
  const ft = readFileSync(join(SCRIPTS, "sweep/fixtureTables.mjs"), "utf8");
  /mid-run|collision|clash/i.test(ft)
    ? ok("fixtureTables.mjs still explains WHY a claimed table must be skipped")
    : bad("fixtureTables.mjs no longer explains why", "a list with no reason next to it gets 'tidied' away");
}

console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
