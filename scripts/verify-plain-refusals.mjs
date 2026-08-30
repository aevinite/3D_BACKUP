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

// ── AND THE PANEL BOUNDARY HAS A PLAIN DEFAULT (T25 round 2, item 25, 2026-08-31) ────────────────
//
// Everything above catches a message BUILT by concatenating a caught error. This is the other way the
// same text reaches a screen: being passed through unchanged. lib/panelFailure.ts is the one answer
// every staff panel route gives when its handler threw, and its `unknown` sentence was OPTIONAL —
// 7 of 11 call sites omitted it, so an unclassified failure went to the device verbatim. Measured on
// the real code: "permission denied for table orders", "Could not find the function public.lfh_x(uuid)
// in the schema cache", "new row violates row-level security policy for table \"orders\"",
// "TypeError: Cannot read properties of undefined (reading 'id')", "JWT expired" — and an Error with
// no message produced an EMPTY toast, which is a tap that answered nothing.
//
// Asserted as PROPERTIES of the file, so a rewrite that gets there another way still passes:
{
  const rel = "lib/panelFailure.ts";
  const raw = existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "";
  const src = codeOf(raw);
  const need = [
    [/const\s+UNKNOWN_TEXT\s*=\s*["'`][^"'`]{20,}["'`]/, "there is no plain default sentence for an unclassified failure"],
    [/opts\?\.unknown\s*\?\?\s*UNKNOWN_TEXT/, "the caller's `unknown` no longer FALLS BACK to the plain default — an omitted one goes back to leaking the raw text"],
    [/if\s*\(!message\s*\|\|\s*!message\.trim\(\)\)/, "an empty sentence is no longer replaced — an Error with no message would show an empty toast"],
    [/console\.error\(/, "the raw text is no longer logged server-side; it must go somewhere, or a real bug becomes invisible"],
  ];
  for (const [re, why] of need) re.test(src) ? ok(`${rel}: ${String(re).slice(0, 46)}…`) : bad(`${rel}: ${why}`);
  // The raw message must not be reachable from the body at all: no `detail`, and no un-defaulted
  // refusalMessage() for the unclassified branch.
  // refusalMessage() belongs in the KNOWN branch and nowhere else. The old shape put it in the
  // fallback position (`!known && opts?.unknown ? opts.unknown : refusalMessage(e)`), which is what
  // leaked. Assert both halves — the right position present, the wrong position absent. (The first
  // cut of this line matched the CORRECT code and accused it, because `known ? refusalMessage(e) :
  // (opts?.unknown ?? …)` contains the same characters in the same order. Judge a position, not a
  // substring.)
  /known\s*\?\s*refusalMessage\(e\)/.test(src)
    ? ok(`${rel}: refusalMessage() is used for a CLASSIFIED failure`)
    : bad(`${rel}: refusalMessage() is no longer the answer for a classified refusal — those sentences are the ones a person can act on`);
  /:\s*refusalMessage\(e\)\s*[;,)]/.test(src)
    ? bad(`${rel}: refusalMessage() is back in the FALLBACK position — an unclassified failure would leak its raw text again`)
    : ok(`${rel}: an unclassified failure answers the plain default, not refusalMessage()`);
  /\bdetail\b/.test(src)
    ? bad(`${rel}: a \`detail\` field appeared — the panel half must never carry the database's words (that is lib/adminFail.ts's job, and only there)`)
    : ok(`${rel}: no detail field — a waiter cannot reach the raw text`);
}

console.log(fails
  ? `\n✗ verify:plain-refusals — ${fails} shared helper(s) hand a person the database's own words`
  : "\n✓ verify:plain-refusals — the detail stays our side, the person gets a sentence they can act on");
process.exit(fails ? 1 : 0);
