#!/bin/zsh
# Nightly REPAIR agent. Scheduled by launchd (com.aevinite.nightly-repair.plist) at 02:30 local
# — before the 04:00/06:00 audits so they don't collide on the one shared browser.
# Gathers last night's fix requests + errors, then runs Claude headlessly to fix them (see
# scripts/repair-agent-prompt.md for the rules, incl. the auto-merge policy). Writes a report
# into .claude/audits/. To ENABLE:  launchctl load ~/Library/LaunchAgents/com.aevinite.nightly-repair.plist
set -u

PROJ="/Users/aevinite/Documents/Projects/backup_Menu"
CLAUDE="/Users/aevinite/.local/bin/claude"
NODE_BIN="/opt/homebrew/bin"
DATE="$(date +%Y-%m-%d)"
LOG="$PROJ/.claude/audits/repair-run-$DATE.log"

export PATH="$NODE_BIN:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$PROJ" || { echo "cannot cd to project" >&2; exit 1; }
mkdir -p "$PROJ/.claude/audits"

{
  echo "===== Repair run: $(date) ====="

  # 1) Gather input (open fix requests + last-24h errors) → repair-input-<date>.md
  echo "Fetching fix requests + errors..."
  if ! "$NODE_BIN/node" "$PROJ/scripts/fetch-fix-requests.mjs"; then
    echo "fetch failed — aborting this run." ; echo "===== Done: $(date) ====="; exit 0
  fi

  # 2) Ensure the dev server is up on port 4000 (the agent may need to reproduce a runtime bug).
  if ! curl -s -o /dev/null --max-time 5 http://localhost:4000/menu; then
    echo "Dev server down -> starting 'npm run dev'..."
    ("$NODE_BIN/npm" run dev >"$PROJ/.claude/audits/devserver-$DATE.log" 2>&1 &)
    for i in {1..40}; do sleep 3; curl -s -o /dev/null --max-time 5 http://localhost:4000/menu && { echo "Dev up after ~$((i*3))s"; break; }; done
  else
    echo "Dev server already running."
  fi

  # 3) Run the repair agent headlessly. Unattended => skip permission prompts. Falls back to sonnet.
  # The run is recorded in agent_runs (mig 161) so it shows under admin -> Repair -> History.
  RUN_ID="$("$NODE_BIN/node" "$PROJ/scripts/agent-run-record.mjs" start nightly "Nightly repair run" 2>/dev/null || true)"
  echo "Launching Claude repair agent at $(date)..."
  if "$CLAUDE" -p "$(cat "$PROJ/scripts/repair-agent-prompt.md")" \
    --dangerously-skip-permissions \
    --fallback-model claude-sonnet-5 \
    --add-dir "$PROJ" \
    2>&1; then AGENT_STATUS="done"; else AGENT_STATUS="failed"; fi
  echo "Repair agent finished at $(date)."
  [ -n "$RUN_ID" ] && "$NODE_BIN/node" "$PROJ/scripts/agent-run-record.mjs" end "$RUN_ID" "$AGENT_STATUS" "$PROJ/.claude/audits/repair-$DATE.md" 2>/dev/null

  echo "===== Done: $(date) ====="
} >>"$LOG" 2>&1
