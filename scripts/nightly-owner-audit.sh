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

# ── THE NIGHT RUN KEEPS LOSING TO THE USAGE LIMIT, SO THERE IS A CATCH-UP (2026-09-19) ──────────
# Six of the last twelve scheduled runs "failed", and the repair board said they had "died before
# they could start". They had not: they ran for 20-85 minutes and then hit
#     You've hit your session limit · resets 7:50am (Asia/Calcutta)
# because the 02:30 repair run, this 06:00 audit and the owner's own late-night work all share one
# five-hour window. Nothing in the code was broken; the budget was simply spent, and the audit he
# actually reads was the one that lost.
#
# So: when the limit stops a run, it leaves a marker. The plist now also fires at noon, and that
# run does NOTHING unless the marker is there — the same shape as brain-refine's 10:30 catch-up.
# A normal night never triggers it, and it can never run twice for the same day.
CUTOFF_MARK="$PROJ/.claude/audits/.usage-cutoff"
HOUR="$(date +%H)"
if [ "$HOUR" -ge 8 ] && [ "$HOUR" -lt 20 ]; then
  if [ ! -f "$CUTOFF_MARK" ]; then
    exit 0   # the night run finished; nothing to catch up — stay silent
  fi
  if [ -f "$PROJ/.claude/audits/owner-audit-$DATE.md" ]; then
    rm -f "$CUTOFF_MARK"; exit 0   # already have today's report
  fi
  echo "[catch-up] the night run was cut off by the usage limit — running now" >>"$LOG"
fi

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
    2>&1 | tee "$PROJ/.claude/audits/.last-claude-output"; then AGENT_STATUS="done"; else AGENT_STATUS="failed"; fi
  echo "Claude audit finished at $(date)."

  # A RUN THAT RAN OUT OF BUDGET MUST SAY SO. Without this the row reaches the repair board as
  # "failed, no report was saved", and the board's own sentence then guesses the wrong cause
  # ("died before it could start") for a run that worked for 22 minutes. One line of report is
  # the difference between a misleading board and a true one — and it sets the marker the
  # catch-up above looks for.
  if [ "$AGENT_STATUS" = "failed" ] && grep -qiE "session limit|usage limit|rate limit" "$PROJ/.claude/audits/.last-claude-output" 2>/dev/null; then
    RESET_LINE="$(grep -ioE "resets [^)]*" "$PROJ/.claude/audits/.last-claude-output" | head -1)"
    {
      echo "# Owner panel audit — stopped early"
      echo
      echo "**This run did not fail. It ran out of Claude usage.** ${RESET_LINE:-The limit resets later today.}"
      echo
      echo "Nothing was audited, so nothing is known about tonight — this is not an all-clear."
      echo "A catch-up run is scheduled for noon and will do the audit then."
      echo
      echo "Why it happens: the 02:30 repair run, this audit and any late-night work share one"
      echo "five-hour usage window. If the window is spent, the audit is what loses."
    } > "$PROJ/.claude/audits/owner-audit-$DATE.md"
    touch "$CUTOFF_MARK"
    echo "(recorded: stopped by the usage limit; catch-up armed)"
  else
    rm -f "$CUTOFF_MARK"
  fi
  rm -f "$PROJ/.claude/audits/.last-claude-output"

  [ -n "$RUN_ID" ] && "$NODE_BIN/node" "$PROJ/scripts/agent-run-record.mjs" end "$RUN_ID" "$AGENT_STATUS" "$PROJ/.claude/audits/owner-audit-$DATE.md" 2>/dev/null

  # 3) If WE started the server, leave it running (harmless) — the machine is the
  #    owner's; killing it could stomp another session. Just note it.
  [ "$STARTED_SERVER" = "1" ] && echo "(Note: dev server was auto-started by this job.)"

  echo "===== Done: $(date) ====="
} >>"$LOG" 2>&1
