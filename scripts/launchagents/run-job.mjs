#!/usr/bin/env node
/**
 * run-job.mjs — the thing launchd actually starts, so the nightly jobs can read the project.
 *
 * WHY THIS EXISTS (measured 2026-08-06, T10 sweep).
 *
 * All three scheduled audits had been dying instantly, every night, for as long as anyone had
 * been checking. `launchctl list` reported exit code 127 and each .err.log held exactly one line:
 *
 *     /bin/zsh: can't open input file: …/backup_Menu/scripts/nightly-owner-audit.sh
 *
 * The file was there, executable, and readable from any normal shell. The problem is WHO was
 * reading it. macOS TCC protects `~/Documents`, and a LaunchAgent has no access to it unless the
 * binary named in ProgramArguments[0] has been granted Full Disk Access. `/bin/zsh` has not. A
 * probe agent proved it exactly:
 *
 *     ls -l  …/nightly-owner-audit.sh   → -rwxr-xr-x   (stat is allowed)
 *     head -1 …/nightly-owner-audit.sh   → Operation not permitted
 *     ls …/backup_Menu                   → Operation not permitted
 *     head -1 ~/.claude/…/watch.mjs      → works fine   (outside ~/Documents)
 *
 * So the 2026-08-05 fix was only half the story. It moved the LOG paths out of ~/Documents, which
 * cleared the EX_CONFIG failure — launchd could then create the log file, start the job, and write
 * the *next* failure into it. The SCRIPT path stayed inside ~/Documents, and that is the one the
 * job dies on. Moving the script out would not help either: it `cd`s into the project and reads a
 * prompt file, so the very next line is blocked the same way.
 *
 * THE FIX. `/opt/homebrew/bin/node` already HAS Full Disk Access — that is why the sibling
 * `com.aevinite.live-fix-watcher` has run 3,800+ times at exit 0. Two more probes confirmed:
 *
 *     launchd → node                        → can read the project ✅
 *     launchd → node → spawn /bin/zsh …     → can read the project ✅  (TCC responsibility is inherited)
 *
 * So the plists now start NODE, and node spawns the same zsh script it always ran. Nothing about
 * the audit scripts changes; they simply get a parent that is allowed to see the folder.
 *
 * DO NOT "simplify" this back to `/bin/zsh <script>` in the plist. That is the shape that was
 * silently dead, and it fails in the one way nothing surfaces: no report appears, no error reaches
 * anyone, and the app looks identical either way.
 *
 * Usage (from the plist):
 *   /opt/homebrew/bin/node <repo>/scripts/launchagents/run-job.mjs <repo>/scripts/nightly-X.sh
 *
 * Usage (from install.sh, through a throwaway probe agent):
 *   … run-job.mjs <script> --selftest   → prove the read works FROM LAUNCHD, run nothing
 *
 * The self-test matters because the real jobs are not cheap to try: each one starts the dev server
 * on port 4000 and runs Claude headlessly. Port 4000 belongs to whoever is working, so the
 * installer must be able to prove the TCC chain without taking it.
 */
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";

const args = process.argv.slice(2);
const selftest = args.includes("--selftest");
const script = args.find((a) => !a.startsWith("--"));
const stamp = () => new Date().toISOString();

if (!script) {
  console.error(`[${stamp()}] run-job.mjs: no script given. The plist must pass the .sh path as argv[1].`);
  process.exit(64); // EX_USAGE
}

// Read the file OURSELVES before handing it to zsh. If this throws EPERM we are back in the
// TCC hole, and one plain sentence in the log beats `zsh: can't open input file` — which is what
// sent three people looking at file permissions instead of at Privacy & Security.
try {
  accessSync(script, constants.R_OK);
} catch (e) {
  console.error(
    `[${stamp()}] run-job.mjs CANNOT READ ${script} (${e.code}).\n` +
      `  This is macOS TCC, not a file permission. The binary in the plist's ProgramArguments[0]\n` +
      `  needs Full Disk Access to reach anything under ~/Documents. It should be\n` +
      `  /opt/homebrew/bin/node (which has it) — check the plist, then re-run\n` +
      `  zsh scripts/launchagents/install.sh --status`,
  );
  process.exit(77); // EX_NOPERM
}

if (selftest) {
  console.log(`[${stamp()}] SELFTEST OK — launchd can read ${script} through node`);
  process.exit(0);
}

console.log(`[${stamp()}] run-job.mjs → /bin/zsh ${script}`);
const child = spawn("/bin/zsh", [script], { stdio: "inherit" });
child.on("error", (e) => {
  console.error(`[${stamp()}] run-job.mjs could not start zsh: ${e.message}`);
  process.exit(70); // EX_SOFTWARE
});
child.on("exit", (code, signal) => {
  console.log(`[${stamp()}] ${script} finished — code=${code ?? "null"} signal=${signal ?? "none"}`);
  process.exit(code ?? (signal ? 128 : 0));
});
