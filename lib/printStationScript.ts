// lib/printStationScript.ts — MODE B: the restaurant's own Chrome does the printing.
//
// Owner, 2026-08-28: *"there will be 2 mode… one for the helper, one for the kisko-Chrome setup —
// like if we run that .bat or .command file it will open that Chrome which runs minimised and doesn't
// auto-open when printing required, doesn't affect other tabs while print. And you can set a
// particular user of that restaurant so that the KOT autoprint happens on that."*
//
// WHY THIS EXISTS BESIDE THE HELPER. The helper (lib/printHelperScript.ts) is the better answer and
// always will be: it needs no browser, no login, and it can send each kind of paper to a DIFFERENT
// printer. But it needs a printer the machine can name, and some restaurants will not install
// anything at all. For them the browser has always been the fallback — and it was a wall of Terminal
// commands in the setup guide. This turns that fallback into the same shape as the helper: ONE file
// you double-click, once, ever.
//
// FOUR THINGS HE ASKED FOR, AND HOW EACH IS ACTUALLY ACHIEVED — measured on this Mac, 2026-08-28:
//
//  1. "runs minimised / doesn't auto-open"
//     Launching the Chrome binary directly steals focus. `open -g -j -n` (-g do not raise,
//     -j hidden, -n its own instance) was NOT enough on its own: measured with a REAL url, the
//     frontmost app still went Finder → Google Chrome. An about:blank test had said otherwise —
//     the kind of easy test that ships a false promise. So the mac launcher remembers who had the
//     screen and hands it straight back; measured after that, Finder → Chrome → Finder.
//     Windows needs none of this: `start /min` genuinely starts it minimised.
//
//  2. "doesn't affect other tabs"
//     Its own `--user-data-dir`. That is a separate Chrome INSTANCE with its own profile, so the
//     person's ordinary Chrome, their tabs, their history and their logins are untouched — and
//     quitting one does not quit the other.
//
//  3. "doesn't auto-open when printing is required"
//     `--kiosk-printing` prints with no dialog and takes no focus. Deliberately NOT `--kiosk`: that
//     is fullscreen-kiosk, which is the OPPOSITE of what he asked for and is what the old setup
//     guide told people to use for this.
//
//  4. …and the part nobody would guess: A HIDDEN CHROME MUST STILL RUN ITS TIMERS.
//     Chrome throttles background and occluded windows hard, and a throttled panel stops polling —
//     the tickets would simply queue. The three --disable-*throttling/backgrounding flags below are
//     what stop that, and they are not decoration: a hidden instance carrying them beaconed 13 times
//     in 14 seconds (measured with a local counter), i.e. full rate. Remove them and this mode
//     quietly stops printing while looking fine.
//
// WHAT IS NOT IN THIS FILE, on purpose: any password. The person signs in ONCE in the window it
// opens, and that Chrome profile remembers it for good — the same reason the print helper carries no
// secret. Which PERSON is a decision made on the Printing board, not here.
export type StationOs = "mac" | "windows" | "linux";

export type StationArgs = {
  origin: string;          // the site this station talks to
  panel?: "manager" | "kitchen";  // which screen it stands at; the routes decide what it prints
  label?: string;          // the restaurant's name, for the window title and the log only
};

// ── THE SAME RULE AS THE HELPER'S: A VALUE CANNOT ADD A LINE (T25 round 3, item 40, 2026-08-31) ──
// lib/printHelperScript.ts had exactly this hole and it was fixed on 2026-08-31 (item 27): the old
// rule stripped everything that could END a quoted string and NOT newlines, and a comment line — or a
// `SITE="…"` line — only lasts until one. This file is the station's twin and was left behind.
// MEASURED here with an origin of `https://x\nsay 'added from an origin'\n# `:
//
//     1| #!/bin/sh
//     2| # Aevidine print station
//     3| SITE="https://x
//     4| say 'added from an origin'      ← a real line, from the ORIGIN
//
// Same fix, same reasons: line breaks fold to a space, and the batch/shell punctuation that means
// "and then do this" goes with them (`%` in particular is how a .bat file expands a variable). The
// 200-character ceiling stays. `verify:print-helper` block 8g now checks BOTH files.
const safe = (s: string) =>
  String(s || "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/["`$\\%^&|<>;]/g, "")
    .slice(0, 200);

/** The flags that are the whole reason this works, in one place so the three scripts cannot drift.
 *  Every one of them was in the setup guide's hand-typed recipe; the difference here is that nobody
 *  types them. `--kiosk` is deliberately absent — see note 3 in the header. */
const CHROME_FLAGS = [
  "--kiosk-printing",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--autoplay-policy=no-user-gesture-required",
];

// ── macOS ────────────────────────────────────────────────────────────────────────────────────
const mac = (a: StationArgs) => `#!/bin/zsh
# Aevidine print station${a.label ? " — " + safe(a.label) : ""}
# Double-click once. It opens a small Chrome of its own, out of the way, which prints this
# restaurant's kitchen slips. Nothing else on this Mac is touched.

# ══════════════════════════════════════════════════════════════════════════════
#  THE TWO LINES YOU MAY CHANGE — and nothing else in this file.
#
#   SITE   the web address this station talks to. Change it to point this same
#          file at a different site (a test site, a new address) without remaking
#          the file. Keep the https:// and no trailing slash.
#   PANEL  which screen it opens: kitchen  or  manager.
#
#  Everything below is machinery. If it stops working after an edit, the edit is
#  the reason.
# ══════════════════════════════════════════════════════════════════════════════
SITE="${safe(a.origin)}"
PANEL="${a.panel === "kitchen" ? "kitchen" : "manager"}"
PROFILE="$HOME/.aevidine-print-station"
LOCK="$PROFILE/running.pid"
LOG="$HOME/Library/Caches/aevidine-print/station.log"
mkdir -p "$PROFILE" "$(dirname "$LOG")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "Google Chrome is not installed on this Mac. Install it, then start this again."
  sleep 8; exit 1
fi

clear 2>/dev/null || true
echo ""
echo "  ┌──────────────────────────────────────────────┐"
echo "  │   Aevidine  ·  print station                 │"
echo "  └──────────────────────────────────────────────┘"
echo ""
echo "    Site       $SITE"
echo "    Screen     $PANEL"
echo "    Computer   $(scutil --get ComputerName 2>/dev/null || hostname)"
echo ""

# ── ONE AT A TIME ────────────────────────────────────────────────────────────────────────────
# Two of these would be two Chromes on one profile — Chrome itself refuses that, but the second
# window would flash up in front of somebody's work before it did. So the second copy says so.
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "    The print station is ALREADY RUNNING on this Mac."
  echo "    Nothing to do — you can close this window."
  echo ""
  sleep 6; exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

# ── HOW THIS AVOIDS TAKING OVER THE SCREEN, and what actually had to be done ─────────────────
# Running the Chrome binary directly steals focus outright. \`open -g -j -n\` (-g don't raise,
# -j hidden, -n own instance) was NOT enough either: measured on 2026-08-28 AND again on 2026-08-29,
# the frontmost app still went Terminal → Google Chrome. An about:blank test had said otherwise,
# which is exactly the kind of easy test that ships a false promise.
#
# The first fix waited three seconds and handed focus back. That is still three seconds of Chrome
# sitting on top of somebody's work, and it is what the owner saw. So it now HIDES the window
# instead — the macOS equivalent of ⌘H — the moment it appears.
#
# BY PROCESS ID, NEVER BY NAME. \`set visible of process "Google Chrome" to false\` would hide the
# restaurant's OWN Chrome as well: same app, same name, and hiding an app hides all of its windows.
# The station runs with its own --user-data-dir, so that is what identifies it.
#
# IN A LOOP, because Chrome raises itself when the window is ready — which is after this script has
# already moved on. Four seconds of retries, then it stops and never interferes again.
#
# AND A HIDDEN CHROME STILL PRINTS. Measured: a hidden window with these flags fired 30 timers in
# 29 seconds — dead on one a second, no throttling at all. That is what the three
# --disable-*backgrounding* flags above are for; without them macOS would slow a hidden tab to a
# crawl and a ticket would print minutes late.
WASFRONT="$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)"
open -g -j -n -a "Google Chrome" --args \\
  --user-data-dir="$PROFILE" \\
  --window-size=520,360 \\
${CHROME_FLAGS.map((f) => `  ${f} \\`).join("\n")}
  "$SITE/$PANEL"

# …and put it out of the way, targeting THIS Chrome and no other.
(
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    CPID="$(pgrep -f "user-data-dir=$PROFILE" 2>/dev/null | head -1)"
    if [ -n "$CPID" ]; then
      osascript -e "tell application \\"System Events\\" to set visible of (first process whose unix id is $CPID) to false" >/dev/null 2>&1
    fi
    sleep 0.4
  done
  # Belt and braces: if anything above failed, give the screen back to whoever had it.
  if [ -n "$WASFRONT" ] && [ "$WASFRONT" != "Google Chrome" ]; then
    osascript -e "tell application \\"$WASFRONT\\" to activate" >/dev/null 2>&1
  fi

  # ── AND IT STAYS OUT OF THE WAY ────────────────────────────────────────────────────────────
  # Printing can bring a hidden app back into view on macOS — measured on 2026-08-30, the station
  # was visible again after a ticket came out. Hiding it once at startup is therefore not enough:
  # the whole promise is a window that is never in anybody's way, and a window that reappears after
  # the first order has broken that promise by the second one.
  #
  # NEVER WHILE SOMEBODY IS USING IT. It only re-hides when the station is visible AND is NOT the
  # app in front — so the person signing in for the first time, or looking at it deliberately, is
  # left alone. One check a minute; it costs nothing and it never fights the human.
  while true; do
    sleep 60
    CPID="$(pgrep -f "user-data-dir=$PROFILE" 2>/dev/null | head -1)"
    [ -z "$CPID" ] && continue
    FRONT="$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)"
    [ "$FRONT" = "Google Chrome" ] && continue
    SEEN="$(osascript -e "tell application \\"System Events\\" to get visible of (first process whose unix id is $CPID)" 2>/dev/null)"
    [ "$SEEN" = "true" ] && osascript -e "tell application \\"System Events\\" to set visible of (first process whose unix id is $CPID) to false" >/dev/null 2>&1
  done
) &

echo "    Chrome is running out of the way. It will print without ever coming to the front." | tee -a "$LOG"
echo ""
echo "    THE FIRST TIME ONLY: find that small Chrome window (⌘ + Tab, or Mission Control)"
echo "    and sign in as the person the Printing board names. It remembers from then on."
echo ""
echo "    Leave THIS window open — it is what stops the Mac going to sleep."
echo ""

# caffeinate holds the Mac awake for as long as this window lives. A sleeping Mac prints nothing,
# and it is the single most common reason a restaurant says "it stopped overnight".
caffeinate -dimsu
`;

// ── Windows ──────────────────────────────────────────────────────────────────────────────────
const windows = (a: StationArgs) => `@echo off
REM Aevidine print station${a.label ? " — " + safe(a.label) : ""}
REM Double-click once. It opens a small Chrome of its own, minimised, which prints this
REM restaurant's kitchen slips. Nothing else on this PC is touched.
setlocal enabledelayedexpansion

REM ══════════════════════════════════════════════════════════════════════════════
REM  THE TWO LINES YOU MAY CHANGE — and nothing else in this file.
REM
REM   SITE   the web address this station talks to. Change it to point this same
REM          file at a different site (a test site, a new address) without
REM          remaking the file. Keep the https:// and no trailing slash.
REM   PANEL  which screen it opens: kitchen  or  manager.
REM
REM  Everything below is machinery. If it stops working after an edit, the edit
REM  is the reason.
REM ══════════════════════════════════════════════════════════════════════════════
set "SITE=${safe(a.origin)}"
set "PANEL=${a.panel === "kitchen" ? "kitchen" : "manager"}"
set "PROFILE=%LOCALAPPDATA%\\AevidinePrintStation"
set "LOGDIR=%LOCALAPPDATA%\\AevidinePrintHelper"
if not exist "%PROFILE%" mkdir "%PROFILE%"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" (
  echo   Google Chrome is not installed on this PC. Install it, then start this again.
  timeout /t 10 /nobreak >nul & exit /b 1
)

cls
echo.
echo   ================================================
echo      Aevidine  .  print station
echo   ================================================
echo.
echo     Site       %SITE%
echo     Screen     %PANEL%
echo     Computer   %COMPUTERNAME%
echo.

REM A sleeping PC prints nothing — the commonest reason a shop says "it stopped overnight".
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 0 >nul 2>&1

REM START /MIN is the whole answer on Windows: the window exists, does its job, and never comes to
REM the front. Its own --user-data-dir makes it a separate Chrome, so the person's normal Chrome,
REM their tabs and their logins are untouched.
start "Aevidine print station" /min "%CHROME%" ^
 --user-data-dir="%PROFILE%" ^
 --window-size=520,360 ^
${CHROME_FLAGS.map((f) => ` ${f} ^`).join("\n")}
 "%SITE%/%PANEL%"

echo     Chrome is running minimised. It will print without ever coming to the front.
echo.
echo     THE FIRST TIME ONLY: open it from the taskbar and sign in as the person the
echo     Printing board names. It remembers from then on.
echo.
echo     You can close THIS window — Chrome keeps running.
echo.
timeout /t 12 /nobreak >nul
`;

// ── Linux / Raspberry Pi ─────────────────────────────────────────────────────────────────────
const linux = (a: StationArgs) => `#!/bin/sh
# Aevidine print station${a.label ? " — " + safe(a.label) : ""}
# ══════════════════════════════════════════════════════════════════════════════
#  THE TWO LINES YOU MAY CHANGE — and nothing else in this file.
#
#   SITE   the web address this station talks to. Change it to point this same
#          file at a different site (a test site, a new address) without remaking
#          the file. Keep the https:// and no trailing slash.
#   PANEL  which screen it opens: kitchen  or  manager.
#
#  Everything below is machinery. If it stops working after an edit, the edit is
#  the reason.
# ══════════════════════════════════════════════════════════════════════════════
SITE="${safe(a.origin)}"
PANEL="${a.panel === "kitchen" ? "kitchen" : "manager"}"
PROFILE="$HOME/.aevidine-print-station"
mkdir -p "$PROFILE"

CHROME=""
for c in google-chrome google-chrome-stable chromium chromium-browser; do
  command -v "$c" >/dev/null 2>&1 && { CHROME="$c"; break; }
done
[ -z "$CHROME" ] && { echo "Install Chromium:  sudo apt install -y chromium-browser"; exit 1; }

echo ""
echo "  Aevidine · print station"
echo "  Site    $SITE"
echo "  Screen  $PANEL"
echo ""
echo "  THE FIRST TIME ONLY: sign in as the person the Printing board names."
echo ""

# No focus-stealing trick needed here: a window manager that honours it gets the geometry below,
# and on a Pi this is usually the only thing on screen anyway.
"$CHROME" --user-data-dir="$PROFILE" --window-size=520,360 \\
${CHROME_FLAGS.map((f) => `  ${f} \\`).join("\n")}
  "$SITE/$PANEL" >/dev/null 2>&1 &
echo "  Chrome is running. Leave this terminal open."
wait
`;

export function stationScript(os: StationOs, a: StationArgs): string {
  if (os === "windows") return windows(a);
  if (os === "linux") return linux(a);
  return mac(a);
}

export const STATION_FILENAME: Record<StationOs, string> = {
  mac: "print-station.command",
  windows: "print-station.bat",
  linux: "print-station.sh",
};

/** What a person still has to do by hand, once. Unlike the helper, this one cannot avoid a sign-in:
 *  the panel it opens IS the restaurant's own screen, and only the person can say who they are. */
export const STATION_FIRST_RUN: Record<StationOs, string> = {
  mac: "Find the small Chrome window (⌘ + Tab) and sign in once as the person named on the Printing board.",
  windows: "Open it from the taskbar and sign in once as the person named on the Printing board.",
  linux: "Sign in once in the window it opens, as the person named on the Printing board.",
};
