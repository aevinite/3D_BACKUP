#!/bin/zsh
# Nightly OWNER-panel deep audit. Scheduled by launchd (see
# ~/Library/LaunchAgents/com.aevinite.owner-audit.plist) to run at 4:00 AM local.
# It makes sure the dev server is up, then runs Claude headlessly to audit the
# owner panel and write a plain-language report into .claude/audits/.
set -u

PROJ="/Users/aevinite/Documents/Projects/backup_Menu"
CLAUDE="/Users/aevinite/.local/bin/claude"
NODE_BIN="/opt/homebrew/bin"
DATE="$(date +%Y-%m-%d)"
LOG="$PROJ/.claude/audits/run-$DATE.log"

export PATH="$NODE_BIN:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PROJ" || { echo "cannot cd to project" >&2; exit 1; }
mkdir -p "$PROJ/.claude/audits"

{
  echo "===== Owner audit run: $(date) ====="

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

  # 2) Run the audit headlessly. Unattended => skip permission prompts (read-only
  #    audit that only writes one report file). Falls back to sonnet if opus is busy.
  echo "Launching Claude audit at $(date)..."
  RUN_ID="$("$NODE_BIN/node" "$PROJ/scripts/agent-run-record.mjs" start audit "Owner panel nightly audit" 2>/dev/null || true)"
  if "$CLAUDE" -p "$(cat "$PROJ/scripts/owner-audit-prompt.md")" \
    --dangerously-skip-permissions \
    --fallback-model claude-sonnet-5 \
    --add-dir "$PROJ" \
    2>&1; then AGENT_STATUS="done"; else AGENT_STATUS="failed"; fi
  echo "Claude audit finished at $(date)."
  [ -n "$RUN_ID" ] && "$NODE_BIN/node" "$PROJ/scripts/agent-run-record.mjs" end "$RUN_ID" "$AGENT_STATUS" "$PROJ/.claude/audits/owner-audit-$DATE.md" 2>/dev/null

  # 3) If WE started the server, leave it running (harmless) — the machine is the
  #    owner's; killing it could stomp another session. Just note it.
  [ "$STARTED_SERVER" = "1" ] && echo "(Note: dev server was auto-started by this job.)"

  echo "===== Done: $(date) ====="
} >>"$LOG" 2>&1
