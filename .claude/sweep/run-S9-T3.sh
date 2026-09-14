#!/bin/zsh
cd /Users/aevinite/Documents/Projects/backup_Menu
exec claude --dangerously-skip-permissions "$(cat .claude/sweep/S9-T3-PROMPT.md)"
