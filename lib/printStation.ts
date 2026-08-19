// lib/printStation.ts — the three print-station starters, as ONE source of truth.
//
// WHY THEY ARE NOT THREE FILES IN public/ ANY MORE (owner, 2026-08-19). He downloaded the Mac one and
// macOS refused to open it — Gatekeeper blocks any script downloaded from the web that Apple hasn't
// notarised, and on Sequoia the old right-click→Open escape is gone. The guide now explains that, but
// there was a second, quieter problem in the same file: its `URL=` line pointed at the BACKUP site,
// and every restaurant had to find and edit it before the thing would work. A wrong URL and a blocked
// file look identical to the person standing there ("nothing happens").
//
// So the starters are generated per request instead, with `URL` already set to the site the person
// downloaded them FROM (`app/api/print-station/[file]/route.ts` passes its own host). Nothing to edit,
// nothing to get wrong, and one place to fix a flag — the four screens that offer these downloads all
// point at that route.
//
// They contain no secret: a Chrome command line and a public URL. That is why the route is public.

/** /kitchen for a kitchen screen · /manager for a counter screen. */
export type StationPanel = "kitchen" | "manager";
export const STATION_FILES = {
  mac: "print-station-mac.command",
  windows: "print-station-windows.bat",
  linux: "print-station-linux.sh",
} as const;
export type StationKind = keyof typeof STATION_FILES;

// The flags, in one place, because they are the whole point of these files and a missing one is a
// printer that stops when a window covers it:
//   --kiosk --kiosk-printing            full screen, and print with NO dialog
//   --disable-background-timer-throttling      a background window is not slowed down
//   --disable-backgrounding-occluded-windows   a COVERED window is not treated as closed  ← the fix
//   --disable-renderer-backgrounding           …nor is the page inside it
//   --user-data-dir                     its own Chrome profile: stays logged in, ignores the everyday one
const FLAGS = [
  "--kiosk --kiosk-printing",
  '--user-data-dir="{PROFILE}"',
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--no-first-run --no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
];

export function stationScript(kind: StationKind, origin: string, panel: StationPanel = "kitchen"): string {
  const url = `${origin.replace(/\/+$/, "")}/${panel}`;
  if (kind === "mac") {
    return `#!/bin/zsh
# ── AEVIDINE PRINT STATION · macOS ───────────────────────────────────────────────────────────────
# Double-click this on the computer the thermal printer is plugged into. It opens ONE Chrome window,
# in kiosk mode, on the panel — with the settings that stop Chrome dozing off behind another window,
# which is why kitchen tickets used to stop printing the moment you minimised it.
#
# ⚠ IF macOS SAYS "Not Opened — Apple could not verify…" and only offers Done / Move to Bin:
#   nothing is wrong with this file. Apple blocks any script downloaded from the web. Run it through
#   bash instead, which is allowed:
#
#       bash ~/Downloads/${STATION_FILES.mac}
#
#   To make it double-clickable for ever, clear the download flag once:
#       xattr -d com.apple.quarantine ~/Downloads/${STATION_FILES.mac}
#       chmod +x ~/Downloads/${STATION_FILES.mac}
#
# This copy was made for ${url} — nothing to edit. For the counter screen instead of the kitchen,
# download the "manager" version, or change /${panel} below.
URL="\${PRINT_STATION_URL:-${url}}"
PROFILE="\${PRINT_STATION_PROFILE:-$HOME/.aevidine-print-station}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Google Chrome isn't installed at the usual place. Install Chrome, then run this again."
  read -r "?Press return to close…"
  exit 1
fi

# caffeinate keeps the Mac awake while the window is open, and lets go when it closes. A sleeping
# computer prints nothing — it is the most common cause of "it stopped overnight".
echo "Opening the print station… keep this window open. Close the Chrome window to finish."
"$CHROME" \\
  ${FLAGS.join(" \\\n  ").replace("{PROFILE}", "$PROFILE")} \\
  "$URL" &
CHROME_PID=$!
caffeinate -dimsu -w $CHROME_PID &
wait $CHROME_PID
`;
  }
  if (kind === "windows") {
    return `@echo off
REM ── AEVIDINE PRINT STATION · Windows ───────────────────────────────────────────────────────────
REM Double-click this on the PC the thermal printer is plugged into. It opens ONE Chrome window, in
REM kiosk mode, on the panel — with the settings that stop Chrome dozing off behind another window,
REM which is why kitchen tickets used to stop printing the moment somebody minimised it.
REM
REM If Windows says "Windows protected your PC": More info -> Run anyway. Once per file.
REM
REM This copy was made for ${url} — nothing to edit.
REM To start it automatically: press Win+R, type shell:startup, and drop a shortcut to this file in.
set "URL=${url}"
set "PROFILE=%LOCALAPPDATA%\\AevidinePrintStation"

set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" (
  echo Google Chrome isn't installed at the usual place. Install Chrome, then run this again.
  pause
  exit /b 1
)

REM Never sleep, never blank the screen while the station is meant to be printing.
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 0 >nul 2>&1

start "" "%CHROME%" --kiosk --kiosk-printing ^
 --user-data-dir="%PROFILE%" ^
 --disable-background-timer-throttling ^
 --disable-backgrounding-occluded-windows ^
 --disable-renderer-backgrounding ^
 --disable-features=CalculateNativeWinOcclusion ^
 --no-first-run --no-default-browser-check ^
 --autoplay-policy=no-user-gesture-required ^
 "%URL%"
`;
  }
  return `#!/bin/sh
# ── AEVIDINE PRINT STATION · Linux (Ubuntu · Debian · Raspberry Pi OS) ──────────────────────────
# Run this on the computer the thermal printer is attached to (or that can reach it on the network):
#
#     chmod +x ${STATION_FILES.linux} && ./${STATION_FILES.linux}
#
# (or simply:  sh ${STATION_FILES.linux}  — no permission needed)
#
# It opens ONE Chrome/Chromium window, in kiosk mode, with the settings that stop the browser dozing
# off behind another window. To start it on boot, see section 5b.5 of the setup guide:
#     ${origin.replace(/\/+$/, "")}/print-setup.html
#
# This copy was made for ${url} — nothing to edit.
URL="\${PRINT_STATION_URL:-${url}}"
PROFILE="\${PRINT_STATION_PROFILE:-$HOME/.aevidine-print-station}"

BROWSER=""
for b in chromium-browser chromium google-chrome google-chrome-stable; do
  command -v "$b" >/dev/null 2>&1 && { BROWSER="$b"; break; }
done
if [ -z "$BROWSER" ]; then
  echo "No Chrome or Chromium found. Install one:  sudo apt install -y chromium-browser"
  exit 1
fi

# The screen must never blank and the machine must never suspend: a sleeping computer prints nothing.
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null

echo "Opening the print station with $BROWSER — close the window to finish."
exec "$BROWSER" \\
  ${FLAGS.join(" \\\n  ").replace("{PROFILE}", "$PROFILE")} \\
  "$URL"
`;
}
