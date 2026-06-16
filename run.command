#!/usr/bin/env bash
# ===========================================================================
#  Little French House - start the MENU app only (http://localhost:4000).
#  Mac version of run.bat. If something is already using port 4000 it is
#  closed first, then a fresh server is started.
#  (Use START.command to launch the menu, or START-ALL.command for the
#   single unified server.)
# ===========================================================================
cd "$(dirname "$0")" || exit 1

PORT=4000

# --- free the port (Mac equivalent of the netstat/taskkill loop) ---
PIDS=$(lsof -ti tcp:$PORT 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "*** Closed the existing menu app on port $PORT, starting a new one. ***"
  echo "$PIDS" | xargs kill -9 2>/dev/null
else
  echo "Nothing was running on port $PORT - starting a fresh menu app."
fi

# --- check Node is installed ---
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js was not found on PATH - install it from https://nodejs.org"
  read -n 1 -s -r -p "Press any key to exit..."; echo
  exit 1
fi

# --- first run: install dependencies ---
if [ ! -d node_modules ]; then
  echo "  First run - installing dependencies, please wait..."
  npm install
fi

echo "Starting the MENU app on http://localhost:$PORT ..."
# open Chrome to /menu a few seconds after the server starts
( sleep 4; open -a "Google Chrome" "http://localhost:$PORT/menu" 2>/dev/null || open "http://localhost:$PORT/menu" ) &

# start the dev server in this window (close the window or press Ctrl+C to stop)
npm run dev
