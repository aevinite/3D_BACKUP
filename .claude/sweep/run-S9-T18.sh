#!/bin/zsh
# SWEEP #9 — terminal 18.
# The window STAYS OPEN when the session ends, whatever Terminal.app's own
# "close the window on exit" setting says. Wave 1 lost five windows to
# shellExitAction=2: claude ended, the window shut, the reason went with it.
printf '\033]0;SWEEP9 T18 — The admin's Repair and System health\007'
cd /Users/aevinite/Documents/Projects/backup_Menu
claude --dangerously-skip-permissions "$(cat .claude/sweep/S9-T18-PROMPT.md)"
code=$?
print -r -- ""
print -r -- "=========================================================================="
print -r -- "  SWEEP9 T18 SESSION ENDED — exit code: $code"
print -r -- "  The admin's Repair and System health"
print -r -- "  This window is held open on purpose. Read it, then close it yourself."
print -r -- "=========================================================================="
print -r -- ""
exec /bin/zsh -i
