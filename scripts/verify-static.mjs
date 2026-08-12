#!/usr/bin/env node
/**
 * verify:static — run EVERY static guard and report EVERY failure. Never stop at the first.
 *
 * WHY THIS FILE EXISTS (T10 sweep, 2026-08-12). This used to be a single `&&` chain of 22 commands
 * inside package.json. A chain stops at its first non-zero exit, so ONE stale guard switched off
 * every guard after it — silently, behind a red X that had become normal. It happened twice in two
 * days, both times because a guard asserted the SPELLING of correct code rather than the rule:
 *
 *   · 2026-08-11 — verify-owner-reports (position 15 of 22) demanded the old spelling of the owner
 *     day-sheet cache key. main was red for 15 consecutive runs. The SEVEN guards behind it never
 *     ran: doc-pointers, i18n-scope, loadall, no-attend-flash, open-request-guard, ready-tile,
 *     tablet-wants-in. In CI the next STEP, `access model`, was skipped too.
 *   · 2026-08-12 — verify-merge-party (position 12) demanded a `for … push` loop that had become a
 *     `.filter`. main was red for five hours and ten guards were muted behind it.
 *
 * In both cases the product was fine and the report was wrong, and in both cases the damage was not
 * the false alarm — it was the nine or ten checks nobody knew had stopped running.
 *
 * So: run all of them, always. Collect the failures. Print a summary that says exactly which guards
 * failed and — the part a chain can never tell you — that the others really did run. Exit 1 if any
 * failed, so CI still refuses the push.
 *
 * Same guarantees as before: every guard here reads ONLY files in this repo. No database, no login,
 * no deployed site, no `.env.local`. That is why it is safe on every push and in every worktree, and
 * it is the admission test for adding one (see .github/workflows/checks.yml).
 *
 * Run: npm run verify:static          (add -- --quiet to print only failures)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const QUIET = process.argv.includes("--quiet");

// The 22 static guards, in the order they used to run. Each line is [script, what it protects] —
// the second half is what a person needs when the name alone doesn't say it. Adding one? It must
// read repo files only, and it needs a row in docs/GUARD-MAP.md (verify:pointers enforces that).
const GUARDS = [
  ["verify-ui-integrity.mjs", "nothing that would print code on someone's screen"],
  ["verify-tap-guard.mjs", "no user tap is dropped in silence"],
  ["verify-test-safety.mjs", "our own tests can't trip the app's rate limits"],
  ["verify-clash-coverage.mjs", "two people can't silently overwrite each other"],
  ["verify-floor-share.mjs", "a write always drops the shared floor snapshot"],
  ["verify-panel-cache.mjs", "no browser is left on a stale panel file"],
  ["verify-board-sig.mjs", "the kitchen/tablet board still repaints on a real change"],
  ["verify-audit-coverage.mjs", "every change that lowers a bill leaves a record"],
  ["verify-order-retry.mjs", "a refused order is still placeable"],
  ["verify-print-format.mjs", "the bill and the kitchen ticket live in ONE file"],
  ["verify-menu-parts.mjs", "each Edit-the-menu switch reaches real code"],
  ["verify-merge-party.mjs", "a merged party is one bill everywhere"],
  ["verify-xray-marks.mjs", "the admin view MARKS what someone lacks, never hides it"],
  ["verify-manager-behaviour.mjs", "the manager panel's fixes still hold"],
  ["verify-owner-reports.mjs", "the owner's reports, charts and dashboard"],
  ["verify-doc-pointers.mjs", "every rule's pointer, and the guard map, still resolve"],
  ["verify-i18n-scope.mjs", "one tenant's languages never leak to another"],
  ["verify-loadall-preserves-orders.mjs", "'load all' keeps the orders and calls"],
  ["verify-open-no-attend-flash.mjs", "no 1-second Attend flash when opening a table"],
  ["verify-open-request-guard.mjs", "a join request stays valid, a stale one doesn't"],
  ["verify-ready-tile-and-kitchen.mjs", "a ready tile shows before EVERY dish is ready"],
  ["verify-tablet-wants-in.mjs", "a free table with a raised hand says 'Wants in'"],

  // ── NINE THAT RAN NOWHERE (added by the T10 sweep, 2026-08-12) ───────────────────────────
  // Each of these reads repo files only, finishes in under a second, and was green — and each one
  // was run by nobody but a person remembering to. Not in the old chain, not in the PostToolUse
  // hook (which runs six), not in CI. That is the same silence the CI file's own header was written
  // to end, and its comment claiming "six moved in, two stayed out" was nine guards out of date.
  //
  // The admission test is the one CI states: does it read anything outside the repo? These don't.
  // (verify:no-ask reads ~/.claude/CLAUDE.md and verify:avlive-release reads the client-stack
  // folder, so both correctly stay out — the hook covers no-ask on this machine.)
  ["verify-rejected-ideas.mjs", "every NO the owner gave is written at the code, not just in a doc"],
  ["verify-css-tokens.mjs", "no --adm-*/--ow-* token is read without being declared"],
  ["verify-dead-css.mjs", "no :global() rule that can never match anything"],
  ["verify-panel-twins.mjs", "the same action agrees across manager, kitchen and tablet"],
  ["verify-server-only-imports.mjs", "no client file reaches a server-only module"],
  ["verify-outbox-drain.mjs", "saved work always finds its way out, in the order it was made"],
  ["verify-guest-recovery.mjs", "a diner loses neither their basket nor their waiter call"],
  ["verify-hidden-dishes.mjs", "a dish taken off the menu is really off the menu"],
  ["verify-warm-shell.mjs", "a device's first visit leaves it able to open the app"],
];

const failed = [];
const missing = [];
const passed = [];

for (const [script, protects] of GUARDS) {
  const file = path.join(ROOT, "scripts", script);
  if (!existsSync(file)) {
    // A guard that has been deleted or renamed must be LOUD. Skipping it quietly is how a checkout
    // ends up with fewer guards than it thinks it has.
    missing.push([script, protects]);
    continue;
  }
  if (!QUIET) console.log(`\n━━ ${script} — ${protects}`);
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    stdio: QUIET ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  const ok = r.status === 0;
  (ok ? passed : failed).push([script, protects, QUIET ? `${r.stdout || ""}${r.stderr || ""}` : ""]);
  if (QUIET && !ok) {
    console.log(`\n━━ ${script} — ${protects}`);
    console.log((failed.at(-1)[2] || "").trimEnd());
  }
}

/* ── the summary a chain could never give you ────────────────────────────────────────────── */
const line = "─".repeat(78);
console.log(`\n${line}`);
if (!failed.length && !missing.length) {
  console.log(`✅ verify:static — all ${passed.length} static guards passed.`);
  process.exit(0);
}
console.log(`❌ verify:static — ${failed.length} of ${GUARDS.length} guard(s) FAILED. ` +
  `${passed.length} passed and DID run (a chain would have hidden that).`);
for (const [script, protects] of failed) console.log(`   ✗ ${script.padEnd(38)} ${protects}`);
if (missing.length) {
  console.log(`\n⚠️  ${missing.length} guard(s) named here are NOT in this checkout, so they did not run:`);
  for (const [script, protects] of missing) console.log(`   ? ${script.padEnd(38)} ${protects}`);
}
console.log(`\nBefore "fixing" the code: check whether the guard is asserting the SPELLING of code`);
console.log(`that has legitimately changed shape. That was the cause both times main went red this`);
console.log(`week — see this file's header. Assert the rule, not the wording.`);
console.log(line);
process.exit(1);
