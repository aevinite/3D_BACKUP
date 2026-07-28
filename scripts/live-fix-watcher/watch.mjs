// Live-fix watcher — the bridge between the admin panel's "Describe a problem" box and a
// VISIBLE Claude Code terminal on the owner's Mac.
//
// Runs every 60s from launchd (com.aevinite.live-fix-watcher.plist), from a COPY installed at
// ~/.claude/fix-request-watcher/ — deliberately OUTSIDE ~/Documents so launchd can read it
// without the Full-Disk-Access grant (the same block that silenced the nightly audits).
//
// What one run does (cheap: ONE tiny scoped read, ~1 KB):
//   1. If a live session is already running (busy.lock fresher than 4h) → exit.
//   2. Read fix_requests rows that are OPEN and FRESH (created in the last 30 minutes).
//      Fresh-only is the live/overnight split: a request typed just now means the owner is AT
//      the Mac and wants the terminal; anything older belongs to the 02:30 night robot. It also
//      means a Mac that was asleep never pops a backlog of stale windows on wake.
//   3. Skip ids already handled (seen.json). If a new one remains: write a .command job file and
//      `open` it — macOS brings Terminal to the FRONT and runs Claude on the request.
//
// Secrets live in ~/.claude/fix-request-watcher/.env (chmod 600, written by install.sh). Nothing
// is ever printed except row counts. `--dry-run` makes the popped window echo instead of running
// Claude (used by the install verification).
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const BASE = dirname(fileURLToPath(import.meta.url)); // the installed copy's own folder
const DRY = process.argv.includes("--dry-run");
// Only mode='instant' requests pop (the owner chose "Fix NOW"); 'overnight' ones are the 02:30
// robot's. 2h window: an instant ask should still pop if the Mac wakes a bit later, but a
// day-old one goes to the robot instead of surprising the owner.
const FRESH_MINUTES = 120;
const SEEN_CAP = 200;

const parseEnv = (t) =>
  Object.fromEntries(
    t.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
  );

const env = parseEnv(readFileSync(join(BASE, ".env"), "utf8"));
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const projectDir = env.PROJECT_DIR || join(os.homedir(), "Documents/Projects/backup_Menu");
const claudeBin = env.CLAUDE_BIN || join(os.homedir(), ".local/bin/claude");
if (!url || !key) { console.error("watcher .env missing SUPABASE_URL / key"); process.exit(1); }

// 1) One-at-a-time: a live session already on screen wins. Stale lock (>4h) = crashed → clear.
const lock = join(BASE, "busy.lock");
if (existsSync(lock)) {
  const ageH = (Date.now() - statSync(lock).mtimeMs) / 36e5;
  if (ageH < 4) process.exit(0);
}

// 2) Fresh open requests, tiny scoped read (id/summary/note only, limit 5).
const sinceIso = new Date(Date.now() - FRESH_MINUTES * 60 * 1000).toISOString();
const q = new URLSearchParams({
  select: "id,summary,note,created_at,restaurant_id",
  status: "eq.open",
  mode: "eq.instant",
  created_at: `gt.${sinceIso}`,
  order: "created_at.desc",
  limit: "5",
});
const res = await fetch(`${url}/rest/v1/fix_requests?${q}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) { console.error(`fix_requests read failed HTTP ${res.status}`); process.exit(1); }
const rows = await res.json();
if (!rows.length) process.exit(0);

// 3) Drop already-handled ids; pop ONE window for the newest new request. The popped session's
// instructions tell it to sweep any OTHER open requests too, so marking them all seen is safe
// (nothing is lost — leftovers are also the night robot's job).
const seenPath = join(BASE, "seen.json");
let seen = [];
try { seen = JSON.parse(readFileSync(seenPath, "utf8")); } catch { /* first run */ }
const fresh = rows.filter((r) => !seen.includes(r.id));
if (!fresh.length) process.exit(0);
writeFileSync(seenPath, JSON.stringify([...fresh.map((r) => r.id), ...seen].slice(0, SEEN_CAP)));

const reqRow = fresh[0];
const summary = String(reqRow.summary || "").replace(/'/g, "’").slice(0, 200);
const note = String(reqRow.note || "").replace(/'/g, "’").slice(0, 500);

// History row (agent_runs, mig 161): the admin Repair page lists every session — this pop-up
// included. Created BEFORE the window opens so even a session the owner instantly closes shows.
let runId = "";
if (!DRY) {
  const runRes = await fetch(`${url}/rest/v1/agent_runs`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ kind: "live", title: summary, request_id: reqRow.id }),
  });
  if (runRes.ok) runId = (await runRes.json())[0]?.id || "";
}

// The rulebook is referenced by its INSTALLED absolute path (copied by install.sh), not a
// repo-relative one — the shared project folder can be on any branch at any time, and an old
// branch may not carry the file.
//
// HUMAN-FIRST WORDING (owner 2026-07-27): the owner SEES this opening prompt in the terminal,
// so it must read like a note a person would write — problem first, plain words, and the
// machine ids tucked at the bottom clearly marked as bookkeeping, never leading the message.
const prompt =
  `Hi — the owner just pressed "Fix NOW" in the admin panel, so this window opened to sort out ONE problem:\n\n` +
  `  Problem: "${summary}"\n` +
  (note ? `  Owner's note: "${note}"\n` : "") +
  `\nYour job is the WHOLE loop (owner 2026-07-28): fix it, put it LIVE, then clear the ticket + its red tile on the website yourself with node scripts/resolve-fix-request.mjs --id <request id> --pr <pr url>. Don't hand a PR back to the owner.\n` +
  `\nFirst read ${join(BASE, "live-fix-prompt.md")} and follow it exactly. The owner is watching this terminal and can answer questions — talk to them in plain, beginner-friendly language, and START by telling them in one simple sentence what you understand the problem to be.\n\n` +
  `(Bookkeeping, for your database updates only — don't lead with these when talking to the owner: fix request id ${reqRow.id}${runId ? `, history row id ${runId}` : ""}.)`;

const jobsDir = join(BASE, "jobs");
mkdirSync(jobsDir, { recursive: true });
const job = join(jobsDir, `fix-${reqRow.id.slice(0, 8)}.command`);

// The .command runs inside Terminal.app = the USER's context, which CAN read ~/Documents.
// It owns busy.lock for its whole lifetime (trap clears it even if the window is closed).
//
// Auto-close (owner 2026-07-21: "close terminal after work is done, wait 5 min"): when the
// session ends we spawn a DETACHED closer, then exit the shell immediately. Exiting first
// matters — Terminal closes a no-process window silently, but pops a scary "a process is
// still running" confirm if we tried to close while sleeping inside the window.
const body = DRY
  ? `echo '[DRY RUN] Would start Claude on request ${reqRow.id.slice(0, 8)}: ${summary}'\nsleep 5`
  : `'${claudeBin}' --dangerously-skip-permissions '${prompt.replace(/'/g, `'\\''`)}'`;
// stamp() marks the history row finished — 'done' on a normal end, 'closed' if the owner shuts
// the window mid-session (HUP). The `status=eq.running` filter makes a second stamp a no-op.
writeFileSync(job, `#!/bin/zsh
# Auto-generated by the live-fix watcher. Safe to delete after the session ends.
source '${join(BASE, ".env")}'
stamp() {
  [ -n '${runId}' ] || return 0
  /usr/bin/curl -s -o /dev/null -m 10 -X PATCH "\${SUPABASE_URL}/rest/v1/agent_runs?id=eq.${runId}&status=eq.running" \\
    -H "apikey: \${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}" \\
    -H "Content-Type: application/json" \\
    -d "{\\"status\\":\\"$1\\",\\"ended_at\\":\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\"}"
}
touch '${lock}'
trap "rm -f '${lock}'" EXIT
trap "rm -f '${lock}'; stamp closed; exit 130" INT TERM HUP
cd '${projectDir}' || { echo 'project folder missing'; stamp failed; sleep 10; exit 1; }
clear
echo '🔧 LIVE FIX REQUEST  ·  ${new Date(reqRow.created_at).toLocaleTimeString()}'
echo '   ${summary}'
echo ''
${body}
rm -f '${lock}'
stamp done
echo ''
echo '✅ Session over — this window closes itself in 5 minutes.'
( sleep 300; /usr/bin/osascript -e 'tell application "Terminal" to close (every window whose name contains "fix-${reqRow.id.slice(0, 8)}")' ) &!
exit 0
`);
chmodSync(job, 0o755);
touchLockAndOpen();

function touchLockAndOpen() {
  // Claim the lock BEFORE opening so the next 60s tick can't double-pop while Terminal launches.
  writeFileSync(lock, reqRow.id);
  execFileSync("/usr/bin/open", [job]); // `open` needs no Automation permission, unlike osascript
  console.log(`popped terminal for request ${reqRow.id.slice(0, 8)}`);
}
