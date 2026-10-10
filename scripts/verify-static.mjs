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

// The static guards, in the order they used to run. Each line is [script, what it protects] —
// the second half is what a person needs when the name alone doesn't say it. Adding one? It must
// read repo files only, and it needs a row in docs/GUARD-MAP.md (verify:pointers enforces that).
const GUARDS = [
  ["verify-ui-integrity.mjs", "nothing that would print code on someone's screen"],
  ["verify-tap-guard.mjs", "no user tap is dropped in silence"],
  ["verify-test-safety.mjs", "our own tests can't trip the app's rate limits"],
  ["verify-clash-coverage.mjs", "two people can't silently overwrite each other"],
  ["verify-floor-share.mjs", "a write always drops the shared floor snapshot"],
  ["verify-panel-cache.mjs", "no browser is left on a stale panel file"],
  ["verify-fixture-pickers.mjs", "a guard that picks its own table never takes another guard's"],
  ["verify-board-sig.mjs", "the kitchen/tablet board still repaints on a real change"],
  ["verify-audit-coverage.mjs", "every change that lowers a bill leaves a record"],
  ["verify-order-retry.mjs", "a refused order is still placeable"],
  ["verify-money-round-twins.mjs", "one exact rounding to the paisa, the same in the app, the panels and the database"],
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

  // ── SEVEN THAT RAN NOWHERE (added by the T10 sweep, 2026-08-12) ──────────────────────────
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
  ["verify-guest-recovery.mjs", "a diner loses neither their basket nor their waiter call"],
  ["verify-hidden-dishes.mjs", "a dish taken off the menu is really off the menu"],
  ["verify-fix-survives.mjs", "a rewritten database function has not dropped a fix it already had"],
  ["verify-print-queue.mjs", "auto-print is a ROW, and prints on a window another window covers"],
  ["verify-print-helper.mjs", "a COMPUTER can own the paper: one basket, many printers, no screen fighting it"],
  ["verify-launch-risks.mjs", "no surprise bill, no keyboard dead-end on the guest menu, no message without consent"],

  // ── THIRTY-THREE MORE THAT RAN NOWHERE (sweep #10 T39, 2026-10-09) ─────────────────────────
  // Measured: 33 guards that read repo files only and need nothing beyond `npm ci` were run by no
  // automatic step at all — and on 2026-10-08 seven of that day's reds were among them, some red for
  // weeks (verify:admin-health, owner-shell, panel-dialogs, panel-scope, panel-names, kitchen,
  // owner-s7). Each was run here with an EMPTY environment (no .env.local, no keys) and passed.
  // verify-panel-scope is the slow one (~85s); every other one is about a second.
  // verify:inventory-window is NOT here only because it is TypeScript that must be bundled first —
  // it has its own step in .github/workflows/checks.yml.
  ["verify-plain-logs.mjs", "an activity-log line or alert button reads as plain English"],
  ["verify-admin-health-logs.mjs", "an admin diagnostics page that could not ask never says 'all clear'"],
  ["verify-owner-panel.mjs", "the owner's Menu, Team and Settings screens say what really happened"],
  ["verify-owner-money-screens.mjs", "the owner's Customers / Pay Later / Inventory / Complaints screens"],
  ["verify-owner-shell.mjs", "the owner console's frame and its Settings screen"],
  ["verify-panel-canvas.mjs", "no see-through band past the fold on a phone"],
  ["verify-panel-dialogs.mjs", "a staff panel never uses the browser's own alert/confirm/prompt"],
  ["verify-panel-scope.mjs", "every panel helper exists where its caller can see it (no blank panel)"],
  ["verify-panel-names.mjs", "every name a panel reads exists where it is read"],
  ["verify-panel-secrets.mjs", "a panel never receives the delivery apps' connection keys"],
  ["verify-one-bill-delete.mjs", "never more than one bill per request"],
  ["verify-plain-refusals.mjs", "a database error never lands raw in front of a manager"],
  ["verify-log-visibility.mjs", "what an owner may see in the activity log, read safely"],
  ["verify-bills-screen.mjs", "the Bills record screen keeps the layout the owner picked"],
  ["verify-money-boxes.mjs", "a box a person types money into accepts its own numbers"],
  ["verify-ledger-index.mjs", "one sweep ID means one check, forever"],
  ["verify-3d-viewer.mjs", "the dish page and 3D viewer's badges, fallbacks and messages"],
  ["verify-kitchen-screen.mjs", "the kitchen screen's 1,660 numbered checks"],
  ["verify-parcel-home.mjs", "a parcel has one home; the floor never grows a parcel strip"],
  ["verify-floor-per-row.mjs", "tables per row and the floor's sideways scrolling"],
  ["verify-read-guards.mjs", "a route that must require a login does"],
  ["verify-panel-api-guards.mjs", "guest and staff-panel routes keep their scoping and gating"],
  ["verify-bill-reprint-is-silent.mjs", "a reprint is a print, not a new bill"],
  ["verify-owner-scope-503.mjs", "an owner route that cannot read its scope answers a retryable 503"],
  ["verify-admin-refusals.mjs", "an admin refusal fails closed and reports back"],
  ["verify-retention-lock.mjs", "the admin's log-retention lock is visible and enforced"],
  ["verify-t28-picked.mjs", "the four owner-route properties picked on 2026-09-15"],
  ["verify-owner-territory-s7.mjs", "the owner's Kitchen printing card and sweep #7's owner screens"],
  ["verify-shared-panel-styles.mjs", "a box two panels both load is styled on both"],
  ["verify-t12-plumbing.mjs", "the shared panel files, judged against the ledger"],
  ["verify-owner-team-and-logs.mjs", "the owner's Audit & logs and Team roster"],
  ["verify-session-gate-taps.mjs", "the guest's table sheet"],
  ["verify-guest-waits-for-its-restaurant.mjs", "every guest screen waits until it knows which restaurant it is on"],
  ["verify-migration-numbers.mjs", "two sessions never give two database changes the same number, and no number goes missing"],
  ["verify-installed-packages.mjs", "the packages installed here are the versions the lock names (the folder runs what the site runs)"],
];

// NOT HERE, AND WHY — the admission test is stricter than it first looks.
//
// "Does it read anything outside the repo" has a second half nobody had had to think about:
// verify-outbox-drain and verify-warm-shell import PLAYWRIGHT and drive a real (headless) browser
// against a little local server they start themselves. No database, no login, no deployed site — so
// they LOOK static, they finish in a second, and on this Mac they pass, because the browser binaries
// are installed here. On a CI runner `npm ci` installs the playwright package but not its browsers,
// so both die with ERR_MODULE_NOT_FOUND / a missing executable. Adding them turned the whole step red
// on a machine where nothing was actually wrong. (T10 sweep, 2026-08-13 — caught by CI within minutes
// of adding them, which is the system working.)
//
// So the test is: reads repo FILES only, and needs nothing installed beyond `npm ci`. A guard that
// launches a browser belongs with verify:busy and verify:cache — run it locally, or in a job that
// installs browsers first.
//
//   verify:outbox         · saved work always finds its way out, in the order it was made
//   verify:warm-shell     · a device's first visit leaves it able to open the app
//   verify:offline-retry  · the last-resort screen keeps ONE backing-off retry loop (T4, 2026-08-17)
//
// All three are in docs/GUARD-MAP.md with "app running"/browser noted, so they are still findable.

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
