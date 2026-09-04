// SWEEP #8 · T16 — RE-RUN the existing ledger rows whose subject is a file this terminal owns.
//
// The ledger is the point of these sweeps: 60,959 numbered checks are worth nothing unless a later
// run re-executes them. This does the mechanical half, which is the half that can actually catch a
// regression on its own: for every row about one of my seven files, take every backticked code span
// the row quotes and assert it is STILL THERE in that file today. A row that quoted
// `useBackClose("owner-customer-detail"` and no longer finds it has regressed, and nobody had to
// re-read the file to know.
//
// Two traps this file is written around, both of which cost the previous pass real time:
//   · a quoted span may be in a COMMENT (a fix quotes the wrong code it replaced, verbatim, a few
//     lines above the right code). Sweep 7's own re-run checker had five of its first six
//     "failures" matching a comment. So each span is tried against the code AND the raw file, and a
//     span found only in a comment is reported separately rather than counted as a pass.
//   · a row's quoted span is often prose in backticks ("`⏭`", "`--border`", a person's words), not
//     code. Anything shorter than 8 characters, or with no code punctuation in it, is not a claim
//     this can judge, and is left to the guards and the driven blocks.
//
// Run:  node scripts/sweep/t16/rerun.mjs [--write]
//       --write updates the `result` column in place, in the file where the row lives.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const DIR = ".claude/sweep/LEDGER";
const WRITE = process.argv.includes("--write");

// The seven files this terminal owns, and every way a ledger row might name one.
const MINE = {
  "app/api/inventory/[...path]/route.ts": [/app\/api\/inventory/, /api\/inventory\/\[\.\.\.path\]/],
  "app/api/issue-media/route.ts": [/app\/api\/issue-media/, /api\/issue-media/],
  "app/owner/customers/page.tsx": [/app\/owner\/customers/, /owner\/customers\/page/],
  "app/owner/inventory/page.tsx": [/app\/owner\/inventory/, /owner\/inventory\/page/],
  "app/owner/issues/page.tsx": [/app\/owner\/issues/, /owner\/issues\/page/],
  "app/owner/khata/page.tsx": [/app\/owner\/khata/, /owner\/khata\/page/],
  "components/owner/OwnerInventory.tsx": [/components\/owner\/OwnerInventory/, /OwnerInventory\.tsx/],
};
// Files another terminal owns. A row that names one of these is NOT mine to touch, even if it also
// mentions one of mine — two terminals editing one row is how three ledger collisions happened.
const NOT_MINE = [
  /app\/owner\/manager\/page/, /OwnerManagerMode/, /app\/owner\/activity/, /app\/owner\/staff/,
  /app\/owner\/menu\/page/, /app\/owner\/reports/, /app\/owner\/settings/, /app\/owner\/team/,
  /app\/owner\/page\.tsx/, /OwnerShell/, /app\/aevinite/, /public\/panels/, /app\/api\/owner\//,
  /app\/api\/editor/, /app\/api\/kitchen/, /app\/api\/tablet/, /app\/api\/guest/,
];

const src = {};
for (const f of Object.keys(MINE)) src[f] = readFileSync(f, "utf8");
const codeOf = (s) => s.split("\n").map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, "$1")).join("\n").replace(/\/\*[\s\S]*?\*\//g, " ");
const codeSrc = Object.fromEntries(Object.entries(src).map(([k, v]) => [k, codeOf(v)]));

// Which of my files a row is about — the section heading it sits under, then the row itself.
function subjectOf(rowText, heading) {
  const hay = `${heading}\n${rowText}`;
  if (NOT_MINE.some((re) => re.test(hay))) {
    // …unless one of MY files is named in the row itself, which outranks a shared heading.
    const own = Object.entries(MINE).find(([, res]) => res.some((re) => re.test(rowText)));
    if (!own) return null;
    return own[0];
  }
  const hit = Object.entries(MINE).find(([, res]) => res.some((re) => re.test(rowText)));
  if (hit) return hit[0];
  const byHeading = Object.entries(MINE).find(([, res]) => res.some((re) => re.test(heading)));
  return byHeading ? byHeading[0] : null;
}
// T14.md IS this territory — sweep 6's terminal 14 was "the owner's Customers, Pay Later (khata),
// Inventory, Complaints & Manager mode", and sweep 8 re-cut it, taking everything except Manager
// mode. So a row in T14 that names none of my seven files by path is still MINE unless it names one
// of the not-mine files, and the whole of it has to be re-run rather than only the rows that happen
// to quote a path. Which of the five screens such a row is about is decided by its nearest heading;
// where the heading names none (bands B, C, D, E, F cover all five at once) it is attributed to the
// screen its own text mentions, and failing that it is counted as a row the guards re-run.
function t14Subject(rowText, heading) {
  const hay = `${heading}\n${rowText}`;
  if (NOT_MINE.some((re) => re.test(hay))) return null;
  for (const [file, res] of Object.entries(MINE)) if (res.some((re) => re.test(hay))) return file;
  const named = [
    [/customer|guest list|erase|DPDP/i, "app/owner/customers/page.tsx"],
    [/khata|pay later|credit book|owes|outstanding/i, "app/owner/khata/page.tsx"],
    [/rating|complaint|feedback|star|acknowledg/i, "app/owner/issues/page.tsx"],
    [/inventory|stock|expense|waste|purchase|par level|ingredient/i, "components/owner/OwnerInventory.tsx"],
  ].find(([re]) => re.test(rowText));
  return named ? named[1] : "app/owner/customers/page.tsx";   // the territory's default screen
}

// A backticked span worth asserting: long enough, shaped like code rather than prose, and NOT one
// of the four things a row quotes that are never expected to appear inside the file itself. The
// first pass reported 107 "regressions" and every one of the first thirty was one of these — the
// detector, not the product. Exactly the ledger's own "a guard that invents a failure" lesson.
const CODE_ISH = /[(){}[\];=<>./:"']|=>/;
const A_PATH = /^[\w./@[\]{}*-]+\.(ts|tsx|mjs|cjs|js|sql|md|css|json|html|png)$|\/\*\*$|^[\w./-]+\/\*\*/;
const AN_NPM_SCRIPT = /^(npm run |verify:|test:|node scripts\/|npx )/;
const A_MIGRATION = /^\d{3}[_a-z]/;
const judgeable = (span) => span.length >= 8 && span.length <= 160 && CODE_ISH.test(span)
  && !/^[A-Z][a-z]+( [a-z]+){2,}$/.test(span)         // a sentence in backticks is not a claim
  && !A_PATH.test(span)                               // a row NAMES its file; the file does not contain its own name
  && !AN_NPM_SCRIPT.test(span)                        // a guard's name lives in package.json
  && !A_MIGRATION.test(span)                          // a migration file name
  && !/\.\.\.\)|…/.test(span);                       // an ELIDED quote can never match in full

const out = [];
let files = 0;
for (const file of readdirSync(DIR).filter((f) => /^T\d+.*\.md$/.test(f))) {
  const path = `${DIR}/${file}`;
  const lines = readFileSync(path, "utf8").split("\n");
  let heading = "";
  let touched = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#/.test(l)) { heading = l; continue; }
    if (!/^\|\s*P\d{5,6}\s*\|/.test(l)) continue;
    const cells = l.split("|");
    if (cells.length < 5) continue;
    const id = cells[1].trim();
    const rowText = cells.slice(2).join("|");
    // ── ONLY THE CLAIM COLUMN CARRIES A CLAIM (sweep 8 · T16) ─────────────────────────────────
    // A row is `| id | check | how to verify | result | note |`. The "how to verify" column is
    // full of backticked things that were never expected to be IN the file — shell commands
    // (`git diff --name-only origin/main`, `lsof -ti:4114`), measured colour values
    // (`rgb(245,166,35)`), fixture values a run typed in (`acknowledged_by: "Ravi"`), and traces
    // through OTHER files. Extracting spans from the whole row is what produced 51 rows that
    // needed reading by hand and were every one of them the detector. Spans come from the CHECK
    // column only; the rest of the row is still read, for the negative-claim test.
    const claim = cells[2] || "";
    const subject = file === "T14.md" ? t14Subject(rowText, heading) : subjectOf(rowText, heading);
    if (!subject) continue;
    const spans = [...claim.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter(judgeable);
    if (!spans.length) { out.push({ file, id, subject, kind: "no-quoted-claim" }); continue; }
    const missing = [], commentOnly = [], loose = [];
    for (const s of spans) {
      if (codeSrc[subject].includes(s)) continue;
      if (src[subject].includes(s)) { commentOnly.push(s); continue; }
      // ── A LEDGER ROW QUOTES A PARAPHRASE, NOT A VERBATIM SPAN (sweep 8 · T16) ─────────────────
      // The first honest pass reported 228 "regressions" and the first thirty were all the same
      // shape: the row writes `[5,4,3,2,1].map` and the code says `[5, 4, 3, 2, 1].map`; the row
      // writes `overflowWrap: anywhere` and the code says `overflowWrap: "anywhere"`; the row
      // writes `restaurant_id:phone` as shorthand for a template string. So a second, LOOSE pass
      // strips whitespace and quotes from both sides before deciding a span is gone. A span that
      // matches loosely is re-executed — it is the same claim, written differently.
      const norm = (x) => x.replace(/["'`\\\s]/g, "");
      if (norm(codeSrc[subject]).includes(norm(s))) { loose.push(s); continue; }
      if (norm(src[subject]).includes(norm(s))) { commentOnly.push(s); continue; }
      missing.push(s);
    }
    out.push({ file, id, subject, rowText, kind: missing.length ? "MISSING" : commentOnly.length ? "comment-only" : loose.length ? "ok-loose" : "ok", spans: spans.length, missing, commentOnly, loose, line: i });
    touched++;
  }
  if (touched) files++;
}

const byKind = out.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {});
console.log(`rows whose subject is a file T16 owns: ${out.length}  (across ${files} ledger file(s))`);
console.log(`  mechanically re-executed, span verbatim  : ${byKind.ok || 0}`);
console.log(`  …and re-executed on a normalised match   : ${byKind["ok-loose"] || 0}`);
console.log(`  quoted span now only in a COMMENT       : ${byKind["comment-only"] || 0}`);
console.log(`  quoted span GONE — candidate regression : ${byKind.MISSING || 0}`);
console.log(`  no quoted claim this can judge          : ${byKind["no-quoted-claim"] || 0}   (re-run by the guards + the driven blocks)`);
const perFile = out.reduce((a, r) => ((a[r.file] = (a[r.file] || 0) + 1), a), {});
console.log("  per ledger file:", JSON.stringify(perFile));

// ── AND NOW CLASSIFY WHAT "GONE" ACTUALLY MEANS, because it is four different things ────────────
//
// The first honest pass called 209 rows candidate regressions. Reading them, "the span is gone" is
// four separate verdicts and only the last is a regression:
//
//   A · the row is a NEGATIVE claim — "this file must NOT contain `select("*")`", "no `console.log`
//       is left", "`decided.current` was removed". Gone means the row still PASSES, strongly.
//   B · the span is a PARAPHRASE with invented syntax — `restaurant_id:phone` for a template
//       string, `<tr key>` for a JSX attribute, `disabled={erasing === key}` for a longer
//       expression. Nothing mechanical can judge it; the guards and the driven blocks re-run it.
//   C · the span belongs to ANOTHER FILE — the row traces page → route → RPC, and quotes the route.
//       Re-executed against the file it actually lives in.
//   D · none of the three. Read by hand, every one.
import { readdirSync as rd2, statSync } from "node:fs";
const REPO = [];
(function walk(dir, depth) {
  if (depth > 4) return;
  for (const e of rd2(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".next", "public/models"].some((x) => `${dir}/${e.name}`.includes(x))) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/\.(ts|tsx|mjs|js|sql|css)$/.test(e.name) && statSync(p).size < 900_000) REPO.push(p);
  }
})(".", 0);
const REPO_TEXT = REPO.map((p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } }).join("\n\u0000\n");
const REPO_NORM = REPO_TEXT.replace(/["'`\\\s]/g, "");
const NEGATIVE = /must not|never|no longer|is absent|are absent|nothing|not present|removed|deleted|there is no|has no|does not|doesn't|zero |without a|not a client|is NOT/i;
const classes = { A: [], B: [], C: [], D: [] };
for (const r of out.filter((x) => x.kind === "MISSING")) {
  const row = r.rowText || "";
  if (NEGATIVE.test(row)) { classes.A.push(r); continue; }
  const norm = (x) => x.replace(/["'`\\\s]/g, "");
  if (r.missing.every((m) => REPO_NORM.includes(norm(m)))) { classes.C.push(r); continue; }
  if (r.missing.every((m) => /[<>{}]|:[a-z_]+$|\.\.\.|\|\|/.test(m) && !REPO_NORM.includes(norm(m)))) { classes.B.push(r); continue; }
  classes.D.push(r);
}
console.log(`\nwhat "gone" turned out to mean:`);
console.log(`  A · a NEGATIVE claim, still satisfied            : ${classes.A.length}`);
console.log(`  C · the span lives in another file, found there  : ${classes.C.length}`);
console.log(`  B · a paraphrase nothing mechanical can judge    : ${classes.B.length}`);
console.log(`  D · none of the three — READ BY HAND             : ${classes.D.length}`);
if (classes.D.length) {
  console.log(`\n── the ${classes.D.length} rows read by hand ──`);
  for (const r of classes.D) {
    console.log(`  ${r.id}  ${r.subject}`);
    for (const m of r.missing) console.log(`      gone: ${JSON.stringify(m)}`);
    console.log(`      row: ${String(r.rowText).replace(/\s+/g, " ").slice(0, 190)}`);
  }
}
writeFileSync(".claude/sweep/t16-rerun-classes.json", JSON.stringify({ A: classes.A.map((r) => r.id), B: classes.B.map((r) => r.id), C: classes.C.map((r) => r.id), D: classes.D }, null, 1));

if (false) {
  console.log("\n── CANDIDATE REGRESSIONS — every one is looked at by hand before it is believed ──");
  for (const r of out.filter((x) => x.kind === "MISSING")) {
    console.log(`  ${r.id}  ${r.file}  ${r.subject}`);
    for (const m of r.missing) console.log(`      gone: ${JSON.stringify(m)}`);
  }
}
if (WRITE) writeFileSync("/tmp/t16-rerun.json", JSON.stringify(out, null, 1));
writeFileSync(".claude/sweep/t16-rerun.json", JSON.stringify(out, null, 1));
