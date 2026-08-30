// verify-plain-refusals.mjs — a SHARED helper never hands the database's own sentence to a person.
//
// WHY THIS EXISTS (T25, sweep #7, 2026-08-28). lib/billCustomer.ts returns "a plain message the
// panel can show as-is" — its own header says so — and one of its branches built that message as
//
//     "Couldn't save the customer: " + error.message
//
// so a PostgREST sentence went to a manager mid-service, on the invoice path. The rule was already
// settled twice over and written down twice over:
//
//   · /api/maintenance, 2026-08-05 — "a malformed ?rid= put 'invalid input syntax for type uuid'
//     on a manager's screen — meaningless to them, and internal to us."
//   · lib/ownerScope.ts → dbFail(), which exists precisely so nine owner endpoints stopped each
//     writing their own `{ error: error.message }`: "The detail stays OUR side — this is the only
//     place it is allowed to appear."
//
// The routes were fixed. The shared libraries the routes CALL were never checked, and a message
// built inside lib/ reaches exactly the same screen.
//
// WHAT IT LOOKS FOR, and deliberately nothing wider: a user-facing field — `message:` or `error:`
// — whose value CONCATENATES a caught error's `.message`. Not `console.error` (that is the right
// place for it), not a `throw new Error(...)` (that is for the log and the error board, and this
// codebase's own dbRefusal/panelFailure classifiers read those messages), and not a comment.
//
// Static, instant, no server and no database.
//
//   node scripts/verify-plain-refusals.mjs        (npm run verify:plain-refusals)
//   node scripts/verify-plain-refusals.mjs --repo /path/to/other/checkout
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const ROOT = args.includes("--repo") ? args[args.indexOf("--repo") + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { console.log("  FAIL " + m); fails++; };

// LINE comments only. A block-comment stripper eats the file at the first `/*` inside a regex
// literal — measured at 42 KB gone on app/api/editor/[...path]/route.ts, and the guard that did it
// reported a PASS over the very function it was checking (T25's own lesson, 2026-08-21).
const codeOf = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*\s|\*\/|\/\*|\*$)/.test(l)).join("\n");

// A caught error's own words, in the shapes this codebase actually writes them.
const RAW = String.raw`(?:\w*[eE]rr(?:or)?\w*|\w+Q|e)\??\.(?:message|details|hint)`;
// …reaching a field a screen renders. Either side of the concatenation.
const PATTERNS = [
  new RegExp(String.raw`\b(?:message|error)\s*:\s*[^,\n}]*?["'\`][^"'\`\n]*["'\`]\s*\+\s*${RAW}`),
  new RegExp(String.raw`\b(?:message|error)\s*:\s*[^,\n}]*?\$\{\s*${RAW}`),
  new RegExp(String.raw`\b(?:message|error)\s*:\s*${RAW}\s*(?:\+|,|\})`),
];

const files = [];
(function walk(d) {
  if (!existsSync(join(ROOT, d))) return;
  for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const rel = `${d}/${e.name}`;
    if (e.isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(e.name)) files.push(rel);
  }
})("lib");

console.log(`\nPLAIN REFUSALS · a shared helper never hands the database's own sentence to a person — ${ROOT}\n`);

// Files whose `message`/`error` field is read by a LOG or a classifier rather than by a person.
// Named with the reason, the way every allow-list in this repo is.
const NOT_A_SCREEN = new Set([
  // dbRefusal's whole job is to CARRY the raw text so the classifiers above it can read it; it is
  // the file that decides what a person is shown instead, and refusalMessage() is that decision.
  "lib/dbRefusal.ts",
  // ownerScope.dbFail() logs the raw text and answers a plain sentence — it is the worked example
  // this guard exists to spread, and its own `message` field is the PLAIN one.
  "lib/ownerScope.ts",
]);

const offenders = [];
for (const rel of files) {
  if (NOT_A_SCREEN.has(rel)) continue;
  const src = codeOf(readFileSync(join(ROOT, rel), "utf8"));
  for (const line of src.split("\n")) {
    if (PATTERNS.some((re) => re.test(line))) offenders.push(`${rel}: ${line.trim().slice(0, 120)}`);
  }
}
if (!offenders.length) {
  ok(`none of the ${files.length} shared libraries put a database sentence in a message a person reads`);
} else for (const o of offenders) {
  bad(`${o}\n         → log the detail with console.error and answer a plain sentence. lib/ownerScope.ts → dbFail() is the worked example; /api/maintenance was fixed for exactly this on 2026-08-05.`);
}

// …and the two files that ARE allowed still do the right thing, so the allow-list can't rot into
// a hole. (A guard whose exemptions are never re-checked is how a stale allowance hides a fault —
// verify:admin-refusals' own allowance drifted from 2 to 3 that way.)
const EXEMPT_STILL_TRUE = {
  // dbRefusal.ts has NO imports on purpose (tests/error-text.test.mjs loads it with plain node), so
  // it cannot log — it CLASSIFIES, and refusalMessage() is the decision about what a person is shown
  // instead of the raw text. That function existing, and still mapping a recognised refusal to a
  // plain sentence, is the whole basis of the exemption.
  "lib/dbRefusal.ts": [
    /export function refusalMessage/,
    "refusalMessage() is gone — dbRefusal.ts is exempt because it is the file that decides what a person is shown instead of the raw text",
  ],
  // ownerScope.dbFail() is the worked example: the raw sentence goes to console.error and never to
  // the body.
  "lib/ownerScope.ts": [
    /console\.error\(`\[\$\{where\}\]/,
    "dbFail() no longer logs the raw detail server-side — the exemption was granted on exactly that basis",
  ],
};
for (const [rel, [must, why]] of Object.entries(EXEMPT_STILL_TRUE)) {
  const src = existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "";
  must.test(src) ? ok(`${rel} is exempt, and the reason it was exempted is still true`) : bad(`${rel}: ${why}`);
}

console.log(fails
  ? `\n✗ verify:plain-refusals — ${fails} shared helper(s) hand a person the database's own words`
  : "\n✓ verify:plain-refusals — the detail stays our side, the person gets a sentence they can act on");
process.exit(fails ? 1 : 0);
