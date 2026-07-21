#!/bin/zsh
# ONE-SHOT TABLET-panel deep audit. Scheduled by launchd (see
# ~/Library/LaunchAgents/com.aevinite.tablet-audit.plist) to run once at 4:00 AM local.
# It makes sure the dev server is up, then runs Claude headlessly to audit the tablet
# (waiter) panel and write a plain-language report into .claude/audits/. It removes its
# own LaunchAgent at the end so it only ever runs ONCE (owner asked for a single run).
set -u

PROJ="/Users/aevinite/Documents/Projects/backup_Menu"
CLAUDE="/Users/aevinite/.local/bin/claude"
NODE_BIN="/opt/homebrew/bin"
PLIST="/Users/aevinite/Library/LaunchAgents/com.aevinite.tablet-audit.plist"
DATE="$(date +%Y-%m-%d)"
LOG="$PROJ/.claude/audits/tablet-run-$DATE.log"

export PATH="$NODE_BIN:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PROJ" || { echo "cannot cd to project" >&2; exit 1; }
mkdir -p "$PROJ/.claude/audits"

{
  echo "===== Tablet audit run: $(date) ====="

  # 1) Ensure the dev server is up on port 4000. Start it if it's down.
  STARTED_SERVER=0
  if ! curl -s -o /dev/null --max-time 5 http://localhost:4000/menu; then
    echo "Dev server down -> starting 'npm run dev'..."
    ("$NODE_BIN/npm" run dev >"$PROJ/.claude/audits/devserver-$DATE.log" 2>&1 &)
    STARTED_SERVER=1
    # Wait up to 120s for it to answer.
    for i in {1..40}; do
      sleep 3
      if curl -s -o /dev/null --max-time 5 http://localhost:4000/menu; then
        echo "Dev server is up after ~$((i*3))s."
        break
      fi
    done
  else
    echo "Dev server already running."
  fi

  # 2) Run the audit headlessly. Unattended => skip permission prompts (read-only audit
  #    that only writes one report file). Falls back to sonnet if opus is busy.
  echo "Launching Claude tablet audit at $(date)..."
  "$CLAUDE" -p "$(cat "$PROJ/scripts/tablet-audit-prompt.md")" \
    --dangerously-skip-permissions \
    --fallback-model claude-sonnet-5 \
    --add-dir "$PROJ" \
    2>&1
  echo "Claude tablet audit finished at $(date)."

  # 3) If WE started the server, leave it running (harmless) — the machine is the owner's.
  [ "$STARTED_SERVER" = "1" ] && echo "(Note: dev server was auto-started by this job.)"

  # 4) One-shot: unload + delete this job so it never runs again.
  echo "Removing one-shot LaunchAgent so this runs only once..."
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST" 2>/dev/null
  echo "One-shot job removed."

  echo "===== Done: $(date) ====="
} >>"$LOG" 2>&1
