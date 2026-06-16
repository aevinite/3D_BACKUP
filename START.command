#!/usr/bin/env bash
# ===========================================================================
#  Little French House - start the menu with one double-click.
#  Mac version of START.BAT. Opens the menu app in its own Terminal window.
#  (This project runs as ONE unified server - for the full app incl. /admin,
#   /editor, /kitchen, /tablet use START-ALL.command instead.)
# ===========================================================================
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

echo "Starting the menu app in its own window..."
osascript -e "tell application \"Terminal\" to do script \"cd '$DIR' && ./run.command\"" >/dev/null

# original START.BAT also tried to launch a separate editor on 4001;
# this project has no separate editor folder (it's unified), so only if present:
if [ -f "$DIR/editor/run.command" ]; then
  osascript -e "tell application \"Terminal\" to do script \"cd '$DIR/editor' && ./run.command\"" >/dev/null
  echo "    Editor: http://localhost:4001"
fi

echo "    Menu:   http://localhost:4000/menu"
echo "  Close that window (or press Ctrl+C in it) to stop the server."
