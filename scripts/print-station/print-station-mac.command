#!/bin/zsh
# ── AEVIDINE PRINT STATION · macOS ───────────────────────────────────────────────────────────────
# Double-click this file on the computer the thermal printer is plugged into. It opens ONE Chrome
# window, in kiosk mode, on the kitchen panel, with every setting that stops Chrome from going to
# sleep behind another window — which is the whole reason auto-print used to stop (owner, 2026-08-17:
# "if you minimize, or open another app in the same PC, the KOT prints totally stop").
#
# It is a NORMAL Chrome, in its OWN profile: log in once here and it stays logged in. Nothing you do
# in your everyday Chrome can disturb it, and nothing here can disturb your everyday Chrome.
#
# Change these two lines and nothing else.
URL="${PRINT_STATION_URL:-https://3-d-backup.vercel.app/kitchen}"   # /kitchen (or /editor for the manager screen)
PROFILE="${PRINT_STATION_PROFILE:-$HOME/.aevidine-print-station}"    # this window's own Chrome profile

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Google Chrome isn't installed at the usual place. Install Chrome, then run this again."
  read -r "?Press return to close…"
  exit 1
fi

# Stop the Mac sleeping while the print station is open (a sleeping PC prints nothing). This ends by
# itself when the Chrome window is closed — the `caffeinate -w` waits on Chrome's own process id.
echo "Opening the print station… keep this window open. Close the Chrome window to finish."
"$CHROME" \
  --kiosk --kiosk-printing \
  --user-data-dir="$PROFILE" \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-features=CalculateNativeWinOcclusion \
  --no-first-run --no-default-browser-check \
  --autoplay-policy=no-user-gesture-required \
  "$URL" &
CHROME_PID=$!
caffeinate -dimsu -w $CHROME_PID &
wait $CHROME_PID
