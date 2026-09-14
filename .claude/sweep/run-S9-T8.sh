#!/bin/zsh
# SWEEP #9 — terminal 8.
# The window STAYS OPEN when the session ends, whatever Terminal.app's own
# "close the window on exit" setting says. Wave 1 lost five windows to
# shellExitAction=2: claude ended, the window shut, the reason went with it.
printf '\033]0;SWEEP9 T8 — The manager panel's host page and shell\007'
cd /Users/aevinite/Documents/Projects/backup_Menu
claude --dangerously-skip-permissions "$(cat .claude/sweep/S9-T8-PROMPT.md)"
code=$?
print -r -- ""
print -r -- "=========================================================================="
print -r -- "  SWEEP9 T8 SESSION ENDED — exit code: $code"
print -r -- "  The manager panel's host page and shell"
print -r -- "  This window is held open on purpose. Read it, then close it yourself."
print -r -- "=========================================================================="
print -r -- ""
exec /bin/zsh -i
