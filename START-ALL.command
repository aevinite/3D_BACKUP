#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Little French House - ONE server for everything (http://localhost:4000).
#  Mac version of START-ALL.bat. Runs the whole app on port 4000:
#     /admin    the boss control room (live floor)   <- start here
#     /menu     the guest menu
#     /editor   the menu editor
#     /kitchen  the kitchen KDS
#     /tablet   the waiter tablet
#  The admin-only floating switcher hops between them. No other servers needed.
# ---------------------------------------------------------------------------
cd "$(dirname "$0")" || exit 1

PORT=4000

# free the port first (safer than the original .bat, which assumed it was free)
PIDS=$(lsof -ti tcp:$PORT 2>/dev/null)
[ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null

if [ ! -d node_modules ]; then
  echo "  First run - installing dependencies, please wait..."
  npm install
fi

echo "Starting the unified app on http://localhost:$PORT  (admin: /admin)"
( sleep 4; open -a "Google Chrome" "http://localhost:$PORT/admin" 2>/dev/null || open "http://localhost:$PORT/admin" ) &
npm run dev
