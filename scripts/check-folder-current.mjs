// check-folder-current.mjs — "is the folder I am about to audit actually the product?"
//
// WHY THIS EXISTS (2026-08-04)
//   A ten-terminal sweep audited /Users/aevinite/Documents/Projects/backup_Menu and every terminal
//   was reading code 105 commits old: the folder sat at PR #705 while origin/main was at #762.
//   Files that exist upstream were simply absent on disk (lib/panelFailure.ts, the busy-database
//   read fallback), so the sweep reported gaps that had been fixed days earlier — and its "passes"
//   were passing on code nobody runs any more.
//
//   Nothing about that state is visible. The app builds, the tests are green, git says nothing
//   unless you ask. The only defence is asking, every time, BEFORE trusting what you read.
//
// WHAT IT ANSWERS
//   1. How far behind (and ahead) of origin/main is this checkout?
//   2. Which uncommitted files would COLLIDE with a sync? Those belong to other live sessions in
//      this shared folder — the rule is leave them alone, not stash them (15 of 16 collided on
//      2026-08-04, and resolving them would have meant editing code this session never wrote).
//   3. Is it therefore safe to sync, or should this task use a worktree off origin/main instead?
//
// READ-ONLY. It runs `git fetch` (which only updates remote-tracking refs, never the working tree)
// and otherwise only reads. It never stashes, checks out, pulls, resets or edits a single file.
//
// Usage:  node scripts/check-folder-current.mjs [--no-fetch] [--repo <path>] [--quiet]
// Exit:   0 = current (safe to trust / safe to sync)
//         1 = BEHIND origin/main — get current before auditing or claiming anything is broken
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const ROOT = val("--repo") || process.cwd();
const QUIET = flag("--quiet");

const git = (...a) => {
  try { return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim(); }
  catch { return ""; }
};
// `git status --porcelain` encodes the state in the FIRST TWO COLUMNS, so a worktree-modified file
// begins with a SPACE (" M path"). Trimming the whole output eats that space on the first line only
// and every path then loses a character — this check reported "LAUDE.md" for CLAUDE.md the first time
// it ran. Porcelain output must never be trimmed as a block.
const gitLines = (...a) => {
  try { return execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).split("\n").filter(Boolean); }
  catch { return []; }
};
const say = (s = "") => { if (!QUIET) console.log(s); };

// ── where are we? ────────────────────────────────────────────────────────────────
const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "(detached)";
// A worktree made off origin/main is a legitimate way to work while the shared folder is stuck, so
// name it rather than judging it by the same rule.
const isWorktree = git("rev-parse", "--is-inside-work-tree") === "true"
  && !!git("rev-parse", "--git-common-dir")
  && git("rev-parse", "--git-dir") !== git("rev-parse", "--git-common-dir");

say(`\nFOLDER CURRENCY CHECK — ${ROOT}`);
say(`  branch: ${branch}${isWorktree ? "  (a worktree — not the shared folder)" : ""}`);

if (!flag("--no-fetch")) {
  // Updates remote-tracking refs ONLY. Nothing in the working tree moves.
  git("fetch", "origin", "--quiet");
}

const upstream = git("rev-parse", "--verify", "--quiet", "origin/main");
if (!upstream) {
  say("  could not read origin/main — is there a remote called 'origin'?\n");
  process.exit(0); // nothing to compare against: don't fail a checkout that has no remote
}

const behind = Number(git("rev-list", "--count", "HEAD..origin/main") || 0);
const ahead = Number(git("rev-list", "--count", "origin/main..HEAD") || 0);
const head = git("log", "--oneline", "-1", "HEAD");
const tip = git("log", "--oneline", "-1", "origin/main");

say(`  HEAD        ${head}`);
say(`  origin/main ${tip}`);
say(`  ${behind} commit(s) behind · ${ahead} ahead`);

// ── what would a sync disturb? ───────────────────────────────────────────────────
// Tracked files modified in the working tree. In this shared folder these are usually ANOTHER
// session's unshipped edits — the rule is to leave them untouched, so the useful thing to report
// is which of them a sync would force into a conflict.
const porcelain = gitLines("status", "--porcelain");
const modified = porcelain
  .filter((l) => /^( M|M |MM|AM|MD|AD)/.test(l))
  .map((l) => l.slice(3).trim())
  .filter(Boolean);
// An UNTRACKED file at a path the incoming commits ADD also blocks a sync (git refuses to
// overwrite it), and it is just as likely to be another session's work-in-progress.
const incoming = new Set(gitLines("diff", "--name-only", "HEAD", "origin/main"));
const untrackedClash = porcelain
  .filter((l) => l.startsWith("??"))
  .map((l) => l.slice(3).trim())
  .filter((f) => incoming.has(f));

const collides = modified.filter((f) => {
  // `git diff --quiet A B -- f` exits non-zero when the two commits differ for that file, i.e.
  // the incoming commits touch a file somebody here is editing.
  try { execFileSync("git", ["-C", ROOT, "diff", "--quiet", "HEAD", "origin/main", "--", f]); return false; }
  catch { return true; }
});

if (modified.length || untrackedClash.length) {
  const total = collides.length + untrackedClash.length;
  say(`\n  ${modified.length} uncommitted tracked file(s); ${total} would collide with a sync:`);
  for (const f of collides) say(`    collides  ${f}`);
  for (const f of untrackedClash) say(`    collides  ${f}  (untracked, but the incoming commits add this path)`);
  const safe = modified.filter((f) => !collides.includes(f));
  for (const f of safe) say(`    ok        ${f}`);
}
const blocked = collides.length + untrackedClash.length;

// ── the verdict, in the words that matter ────────────────────────────────────────
if (behind === 0) {
  say(`\n✅ CURRENT — what you are reading is the product. Safe to audit and safe to sync.\n`);
  process.exit(0);
}

say(`\n❌ BEHIND by ${behind} commit(s) — DO NOT audit, plan, or report a bug from this checkout.`);
say(`   Anything missing here may already be fixed upstream, and a green check may be checking dead code.`);
say(`\n   What to do:`);
if (blocked) {
  say(`   · ${blocked} file(s) above are probably another live session's unshipped work.`);
  say(`     LEAVE THEM ALONE — do not stash, commit or revert them (CLAUDE.md: the Mac-folder rule).`);
  say(`   · So do NOT sync this folder right now. Work in a worktree off the real main instead:`);
  say(`       git worktree add -b <type>/<name> .claude/worktrees/<name> origin/main`);
  say(`       cd .claude/worktrees/<name> && npm install`);
  say(`   · Sync the shared folder once those sessions have landed their work.`);
} else {
  say(`   · Nothing collides, so the folder can be brought up to date:`);
  say(`       git fetch origin && git rebase origin/main`);
  say(`   · Re-run this check afterwards and expect "CURRENT".`);
}
say("");
process.exit(1);
