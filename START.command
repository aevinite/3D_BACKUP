#!/usr/bin/env bash
# ===========================================================================
#  Little French House - start the menu with one double-click.
#  Opens the menu app in its own Terminal window.
#  (ONE unified server on port 4000 - every panel is a route on it:
#   /menu, /aevinite, /manager, /kitchen, /tablet, /owner.)
# ===========================================================================
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

echo "Starting the menu app in its own window..."
osascript -e "tell application \"Terminal\" to do script \"cd '$DIR' && ./run.command\"" >/dev/null

echo "    Menu:   http://localhost:4000/menu"
echo "  Close that window (or press Ctrl+C in it) to stop the server."
