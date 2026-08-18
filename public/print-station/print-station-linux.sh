#!/bin/sh
# ── AEVIDINE PRINT STATION · Linux (Ubuntu · Debian · Raspberry Pi OS) ──────────────────────────
# Run this on the computer the thermal printer is attached to (or that can reach it on the network).
# It opens ONE Chrome/Chromium window, in kiosk mode, on the panel — with the settings that stop the
# browser dozing off behind another window, which is why auto-print used to stop dead.
#
#   chmod +x print-station-linux.sh   &&   ./print-station-linux.sh
#
# To make it start by itself on boot (the point of using a Pi), see section 5b.5 of the setup guide:
#   <your site>/print-setup.html
#
# Change these two lines and nothing else.
URL="${PRINT_STATION_URL:-https://3-d-backup.vercel.app/kitchen}"   # /kitchen, or /manager for the counter screen
PROFILE="${PRINT_STATION_PROFILE:-$HOME/.aevidine-print-station}"    # this window's own Chrome profile

# Chromium on Raspberry Pi OS, google-chrome on most desktops — whichever is installed.
BROWSER=""
for b in chromium-browser chromium google-chrome google-chrome-stable; do
  command -v "$b" >/dev/null 2>&1 && { BROWSER="$b"; break; }
done
if [ -z "$BROWSER" ]; then
  echo "No Chrome or Chromium found. Install one:  sudo apt install -y chromium-browser"
  exit 1
fi

# The screen must never blank and the machine must never suspend: a sleeping computer prints nothing.
# (Harmless if X isn't running — the errors are swallowed.)
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null

echo "Opening the print station with $BROWSER — close the window to finish."
exec "$BROWSER" \
  --kiosk --kiosk-printing \
  --user-data-dir="$PROFILE" \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --no-first-run --no-default-browser-check \
  --autoplay-policy=no-user-gesture-required \
  "$URL"
