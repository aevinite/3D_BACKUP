// lib/printHelperScript.ts — the helper program itself, as text a person types once.
//
// NOTHING IS DOWNLOADED, and that is the whole design (owner, 2026-08-19, with the screenshot):
// macOS blocks any script that came off the web — "Not Opened — Apple could not verify it is free of
// malware", with only Done or Move to Bin, and the old right-click→Open way out is gone in Sequoia —
// and Windows SmartScreen does the same. A file the person pastes into TextEdit or Notepad
// themselves carries no quarantine flag, so nothing can object to it. So the admin console SHOWS
// this text with a Copy button; it is never served as a file.
//
// IT NEEDS NOTHING INSTALLED. `curl` ships with macOS and Windows 10+; Chrome is already on any
// machine that runs our panels; `lp` is built into macOS and Linux. The one exception is Windows,
// which has no built-in "print this PDF silently to that printer" — see the Windows notes below.
//
// THE HELPER IS DELIBERATELY STUPID. It holds no rules, no layout and no idea what a bill is: it
// asks what to print, is handed a finished document, prints it on the named printer, and says
// whether paper came out. Everything else stays server-side, which is why the machine is set up
// once and never revisited — a change to the bill, the routing or the paper size needs no visit.

export type HelperOs = "mac" | "windows" | "linux";

export type HelperScriptArgs = {
  origin: string;      // the site the helper talks to, e.g. https://www.aevinite.shop
  /** NO LONGER USED and deliberately kept out of the file (mig 368, owner 2026-08-27: "there
   *  wouldn't be one key for all restaurants… or maybe a pairing code or whatever" → "zero typing
   *  one, yeah"). The helper holds no secret now: it pairs itself and writes its own token to its
   *  own disk, which is what makes ONE file work for every restaurant. */
  code?: string;
  label?: string;      // what the person called this computer, for the log only
};

// ── THE ONE PIECE WINDOWS CANNOT DO BY ITSELF ────────────────────────────────────────────────
// Windows has no built-in way to print a PDF silently to a NAMED printer. macOS and Linux have `lp`;
// Windows has nothing, which is why PetPooja reaches for QZ Tray and everyone else ships an
// installer. So the helper fetches ONE portable, open-source executable — 20 MB, no installer, no
// registry — and it fetches it ITSELF, once, so the person downloads nothing by hand.
//
// PINNED AND CHECKED, both on purpose: a floating "latest" URL is a program that changes underneath
// a restaurant without anybody deciding to, and a download with no checksum is a program you did not
// choose. Both values were verified by fetching the file on 2026-08-27.
const SUMATRA = {
  version: "3.6.1",
  url: "https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip",
  sha256: "98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544",
  exe: "SumatraPDF-3.6.1-64.exe",
};

const safe = (s: string) => String(s || "").replace(/["`$\\]/g, "").slice(0, 200);

// ── macOS ────────────────────────────────────────────────────────────────────────────────────
// Printer discovery is `lpstat -e` (queue names) plus, for each, the DEFAULT page size out of
// `lpoptions -l` and its millimetres out of the queue's own PPD. That last part matters: the paper a
// printer is loaded with decides the size the document must be built at, and a page that disagrees
// with the paper is what rotates a ticket or halves it. Reading it from the machine beats asking a
// restaurant to know it.
const mac = (a: HelperScriptArgs) => `#!/bin/zsh
# Aevidine print helper${a.label ? " — " + safe(a.label) : ""}
# Leave this running. It has no window and prints nothing by itself; it only does what the
# restaurant's own address book tells it to.

SITE="${safe(a.origin)}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WORK="$HOME/Library/Caches/aevidine-print"
HOME_DIR="$HOME/.aevidine-print"
TOKEN_FILE="$HOME_DIR/token"
LOCK="$HOME_DIR/running.pid"
PLIST="$HOME/Library/LaunchAgents/com.aevidine.print.plist"
LOG="$WORK/helper.log"
mkdir -p "$WORK" "$HOME_DIR"
chmod 700 "$HOME_DIR"

# ── ONE AT A TIME ────────────────────────────────────────────────────────────────────────────
# From today this file is ALSO started automatically at login (the LaunchAgent below), so somebody
# double-clicking it while the automatic one is already running would put two helpers on one token.
# Nothing would print twice — the claim is atomic — but they would fight for every job and the log
# would be unreadable. So a second copy says so and steps aside.
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo ""
  echo "  The Aevidine print helper is ALREADY RUNNING on this computer."
  echo "  Nothing to do — you can close this window."
  echo ""
  sleep 6
  exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome is not installed — install it, then start this again." | tee -a "$LOG"
  sleep 8
  exit 1
fi

# ── WHAT THIS WINDOW SHOWS ───────────────────────────────────────────────────────────────────
# Owner, 2026-08-27: "show me the interface of helper, like how it will be once linked". This IS the
# interface — a Terminal window is what a .command file opens, so it is made to read like a status
# screen rather than a wall of shell output. Every line a person needs is here and nothing else.
banner() {
  # Plain "clear" rather than an ANSI escape sequence: an octal escape is illegal inside the
  # TypeScript template literal this script is generated from, and clear is on every Mac anyway.
  clear 2>/dev/null || true
  echo ""
  echo "  ┌──────────────────────────────────────────────┐"
  echo "  │   Aevidine  ·  print helper                  │"
  echo "  └──────────────────────────────────────────────┘"
  echo ""
  echo "    Site       $SITE"
  echo "    Computer   $(scutil --get ComputerName 2>/dev/null || hostname)"
  echo "    Printers   $1"
  echo ""
}

# This machine, so the app can tell one computer from another and warn if one code is copied onto two.
FP="$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}')"
# THE MACHINE'S OWN NAME. Nobody is asked to type one any more (owner, 2026-08-27: "what the fuck is
# a computer name"). scutil gives the friendly name a person recognises — "Rishi's MacBook Pro" —
# and hostname is the fallback.
HOST="$(scutil --get ComputerName 2>/dev/null || hostname)"

# Every printer this Mac has, with the paper it is set to (in millimetres, read from the queue's own
# driver file). This is what fills the dropdowns in the app, so nobody types a printer name.
printers_json() {
  local first=1 out="[" p desc media dims w h
  for p in $(lpstat -e 2>/dev/null); do
    # The model as CUPS knows it. Split on spaces and "Zijiang ZJ-80" becomes "Zijiang" — the whole
    # value is one quoted field, so it is read as one.
    desc="$(lpoptions -p "$p" 2>/dev/null | sed -n "s/.*printer-make-and-model='\\([^']*\\)'.*/\\1/p" | head -1)"
    media="$(lpoptions -p "$p" -l 2>/dev/null | sed -n 's/^PageSize[^:]*: //p' | tr ' ' '\\n' | sed -n 's/^\\*//p' | head -1)"
    w=""; h=""
    if [ -n "$media" ] && [ -f "/etc/cups/ppd/$p.ppd" ]; then
      # A PPD writes the paper as *PaperDimension X70MMY65MM/80mm x 65mm: "226 182" — the size's
      # human name is glued to the key with a slash, so the key is matched up to a / or a :, and the
      # two numbers are taken from inside the quotes. Points -> millimetres (72pt = 25.4mm).
      # PaperDimension is the WHOLE sheet, which is what a page size must be; the ImageableArea
      # beside it is the smaller bit the head can reach, and using that as a page size would shrink
      # every ticket by the width of its own margins.
      dims="$(awk -v m="$media" '$0 ~ "^\\*PaperDimension "m"[/:]" { if (match($0, /"[0-9.]+ [0-9.]+"/)) { s=substr($0, RSTART+1, RLENGTH-2); split(s, a, " "); printf "%.1f %.1f", a[1]*25.4/72, a[2]*25.4/72; exit } }' "/etc/cups/ppd/$p.ppd")"
      w="\${dims%% *}"; h="\${dims##* }"
    fi
    [ $first -eq 0 ] && out="$out,"
    first=0
    out="$out{\\"name\\":\\"$p\\",\\"desc\\":\\"$desc\\""
    [ -n "$w" ] && [ -n "$h" ] && out="$out,\\"paper\\":{\\"name\\":\\"$media\\",\\"wMm\\":$w,\\"hMm\\":$h}"
    out="$out}"
  done
  echo "$out]"
}

say() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $1" >> "$LOG"; }
line() { echo "    $1"; say "$1"; }

PLIST_NAMES="$(printers_json | sed 's/[{}"]//g; s/name://g; s/,desc:[^,]*//g; s/,paper:[^}]*//g' | tr -d '[]' | sed 's/,/, /g')"
banner "\${PLIST_NAMES:-none found}"

# ── START IT AGAIN BY ITSELF, EVERY TIME (owner, 2026-08-27: "at the night they will shut it down,
#    and at the morning it will auto start itself?") ──────────────────────────────────────────────
# A LaunchAgent, not a Login Item, and for two reasons that both matter to a restaurant:
#   · Login Items were an INSTRUCTION a person had to follow, so they were skipped — and a skipped
#     step means the shop opens, nothing prints, and nobody knows why.
#   · KeepAlive restarts it if it ever dies mid-service. A Login Item does not.
# Written every run and it is idempotent: if the file is already right, nothing happens.
install_autostart() {
  local me="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aevidine.print</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$me</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$WORK/launchd.log</string>
</dict></plist>
PLISTEOF
  launchctl unload "$PLIST" >/dev/null 2>&1
  launchctl load "$PLIST" >/dev/null 2>&1
}

# ── PAIRING: the helper links ITSELF, and nobody types anything (mig 368) ─────────────────────
# This file holds NO secret, which is what lets ONE file work for every restaurant. On its first run
# it describes itself, opens the browser on THIS machine, and waits for a person to press Allow. The
# token it gets back is written here and used for ever after.
CODE=""
[ -f "$TOKEN_FILE" ] && CODE="$(cat "$TOKEN_FILE" 2>/dev/null)"

if [ -z "$CODE" ]; then
  line "This computer is not linked yet. Asking the site for a link…"
  START="$(curl -s -m 25 -X POST "$SITE/api/print-agent/pair/start" -H "content-type: application/json" \\
    -d "{\\"fingerprint\\":\\"$FP\\",\\"hostname\\":\\"$HOST\\",\\"os\\":\\"mac\\",\\"printers\\":$(printers_json)}")"
  PC="$(echo "$START" | sed -n 's/.*"code":"\\([^"]*\\)".*/\\1/p')"
  PS="$(echo "$START" | sed -n 's/.*"secret":"\\([^"]*\\)".*/\\1/p')"
  PU="$(echo "$START" | sed -n 's/.*"pairUrl":"\\([^"]*\\)".*/\\1/p')"
  if [ -z "$PC" ] || [ -z "$PS" ]; then
    line "Could not reach $SITE. Check this computer is online, then start this again."
    sleep 12; exit 1
  fi
  echo ""
  line "Your browser is opening. In that page, press  ►  ALLOW"
  line "If it did not open, go to:  $PU"
  echo ""
  open "$PU" >/dev/null 2>&1
  # Ten minutes, the life of a pairing. Asking every 3s is 200 requests at worst and it means the
  # window says "linked" the moment the person's finger leaves the button.
  n=0
  while [ $n -lt 200 ]; do
    POLL="$(curl -s -m 15 -X POST "$SITE/api/print-agent/pair/poll" -H "content-type: application/json" \\
      -d "{\\"code\\":\\"$PC\\",\\"secret\\":\\"$PS\\"}")"
    case "$POLL" in
      *'"state":"linked"'*)
        CODE="$(echo "$POLL" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')"
        WHERE="$(echo "$POLL" | sed -n 's/.*"restaurant":"\\([^"]*\\)".*/\\1/p')"
        NAME="$(echo "$POLL" | sed -n 's/.*"name":"\\([^"]*\\)".*/\\1/p')"
        printf '%s' "$CODE" > "$TOKEN_FILE"
        chmod 600 "$TOKEN_FILE"
        install_autostart
        banner "\${PLIST_NAMES:-none found}"
        line "✅  Linked to $WHERE"
        line "    This computer is now \\"$NAME\\""
        line "    It will start again by itself every time this Mac is switched on."
        echo ""
        break ;;
      *'"state":"expired"'*)
        line "That link expired before anybody pressed Allow. Start this file again."
        sleep 12; exit 1 ;;
    esac
    n=$((n+1)); sleep 3
  done
  if [ -z "$CODE" ]; then line "Nobody pressed Allow. Start this file again when you are ready."; sleep 12; exit 1; fi
else
  install_autostart
  line "Linked. Waiting for something to print — you can minimise this window."
  echo ""
fi

# ── the loop: ask, print, report. Nothing clever, on purpose. ────────────────────────────────
while :; do
  HELLO="$(curl -s -m 20 -X POST "$SITE/api/print-agent/hello" -H "x-lfh-agent: $CODE" \\
    -H "content-type: application/json" \\
    -d "{\\"fingerprint\\":\\"$FP\\",\\"printers\\":$(printers_json)}")"
  case "$HELLO" in
    *'"ok":true'*) : ;;
    *) line "This computer's link was removed on the site. Delete $TOKEN_FILE and start this file again to link it afresh."
       sleep 30; continue ;;
  esac

  # Keep asking while there is work; the sleep below is only for when the basket is empty.
  while :; do
    JOB="$(curl -s -m 20 "$SITE/api/print-agent/next" -H "x-lfh-agent: $CODE")"
    [ -z "$JOB" ] && break                      # 204 — nothing to print
    ID="$(echo "$JOB" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')"
    PRINTER="$(echo "$JOB" | sed -n 's/.*"printer":"\\([^"]*\\)".*/\\1/p')"
    [ -z "$ID" ] && break
    HTML="$WORK/job.html"; PDF="$WORK/job.pdf"
    rm -f "$HTML" "$PDF"
    if ! curl -s -m 30 -o "$HTML" "$SITE/api/print-agent/job/$ID/document" -H "x-lfh-agent: $CODE" || [ ! -s "$HTML" ]; then
      say "job $ID: the app had no document for it (already handled)"; continue
    fi
    # Turn it into a paper-shaped PDF with the Chrome that is already on this machine. Its own
    # profile folder, so it can never disturb anybody's browsing.
    #
    # AND ON A WATCHDOG, because Chrome's new headless mode DOES NOT EXIT after --print-to-pdf: it
    # writes the file and keeps running. Waiting for it (the obvious way to write this) hung the
    # helper for ever after the very first ticket — the job stayed "printing", nothing came out, and
    # thirteen Chrome processes piled up. Measured on 2026-08-20. So: start it, wait for the PDF to
    # appear and settle, then end it ourselves.
    "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \\
      --user-data-dir="$WORK/chrome" --no-pdf-header-footer --virtual-time-budget=4000 \\
      --print-to-pdf="$PDF" "file://$HTML" >/dev/null 2>&1 &
    CPID=$!
    n=0
    while [ $n -lt 40 ]; do
      [ -s "$PDF" ] && break
      sleep 0.5; n=$((n+1))
    done
    sleep 1                                    # let the last bytes land before we take the file
    kill "$CPID" >/dev/null 2>&1
    pkill -f "print-to-pdf=$PDF" >/dev/null 2>&1
    wait "$CPID" 2>/dev/null
    # "lp accepted it" IS NOT "paper came out". lp hands the file to the print queue and returns 0
    # even when the printer is switched off — measured 2026-08-20, with the printer unplugged: the
    # helper cheerfully reported success while the ticket sat in the queue. This app's own rule is
    # that nothing may say "printed" when nothing printed, so the job is FOLLOWED to completion.
    #
    # And if it never completes, the queued copy is CANCELLED before the ticket is handed back —
    # otherwise the printer would print it when it wakes AND the app would send it again: the one
    # way this design could ever produce two identical tickets.
    OUT=""
    [ -s "$PDF" ] && OUT="$(lp -d "$PRINTER" "$PDF" 2>/dev/null)"
    CUPSID="$(echo "$OUT" | sed -n 's/.*request id is \\([^ ]*\\).*/\\1/p')"
    PRINTED=0
    if [ -n "$CUPSID" ]; then
      n=0
      while [ $n -lt 30 ]; do                    # up to ~15s: a thermal ticket takes about two
        if lpstat -W completed -o "$PRINTER" 2>/dev/null | grep -q "^$CUPSID "; then PRINTED=1; break; fi
        sleep 0.5; n=$((n+1))
      done
      [ $PRINTED -eq 0 ] && cancel "$CUPSID" >/dev/null 2>&1
    fi
    if [ $PRINTED -eq 1 ]; then
      curl -s -m 20 -X POST "$SITE/api/print-agent/job/$ID/done" -H "x-lfh-agent: $CODE" \\
        -H "content-type: application/json" -d '{}' >/dev/null
      say "printed job $ID on $PRINTER"
    else
      # Say WHY, and hand it back. The app retries it, and after five tries the manager's screen
      # says so — a ticket must never quietly disappear.
      curl -s -m 20 -X POST "$SITE/api/print-agent/job/$ID/failed" -H "x-lfh-agent: $CODE" \\
        -H "content-type: application/json" -d "{\\"error\\":\\"$PRINTER did not print it — switched off, out of paper, or unplugged\\"}" >/dev/null
      say "FAILED job $ID on $PRINTER — is it switched on, with paper?"
    fi
  done
  sleep 2
done
`;

// ── Windows ──────────────────────────────────────────────────────────────────────────────────
// Windows has no built-in silent PDF print, so the helper uses SumatraPDF portable (one 6 MB file,
// no installer, no admin rights) and says so plainly if it is missing rather than failing quietly.
// Printer discovery is PowerShell's Get-Printer — and since 2026-08-27 it also reports the PAPER
// SIZE, which it had never done. Get-PrintConfiguration gives PaperSize by name and
// Get-PrinterProperty gives the media dimensions in hundredths of a millimetre; both are read inside
// a try/catch per printer, because a driver that refuses one must not cost the whole list. A size the
// machine could not work out is simply absent — a WRONG size is worse than none, and that has not
// changed.
//
// Owner, 2026-08-27, on why this mattered: he was typing paper sizes by hand for every Windows
// printer, and the paper size is the setting that decides whether a slip prints sideways or at half
// size. Asking a restaurant to know its own millimetres was always the wrong question.
const windows = (a: HelperScriptArgs) => `@echo off
REM Aevidine print helper${a.label ? " — " + safe(a.label) : ""}
REM Leave this running. It has no window of its own and prints nothing by itself.
setlocal enabledelayedexpansion

set "SITE=${safe(a.origin)}"
set "WORK=%LOCALAPPDATA%\\AevidinePrintHelper"
set "LOG=%WORK%\\helper.log"
set "TOKENFILE=%WORK%\\token.txt"
set "LOCKFILE=%WORK%\\running.lock"
if not exist "%WORK%" mkdir "%WORK%"

REM ── ONE AT A TIME ─────────────────────────────────────────────────────────────────────────
REM This file is started automatically at login from today, so a person double-clicking it while the
REM automatic copy is already running would put two helpers on one token. Nothing prints twice (the
REM claim is atomic) but they would fight for every job. A crude lock is enough: the file is held
REM open for the life of the process, so a leftover lock from a crash is not mistaken for a live one.
2>nul (
  >>"%LOCKFILE%" (call )
) || (
  echo.
  echo   The Aevidine print helper is ALREADY RUNNING on this computer.
  echo   Nothing to do - you can close this window.
  echo.
  timeout /t 6 /nobreak >nul
  exit /b 0
)

set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" (
  echo Google Chrome is not installed - install it, then start this again.>>"%LOG%"
  echo Google Chrome is not installed - install it, then start this again.
  pause & exit /b 1
)

REM ── THE ONE PIECE WINDOWS CANNOT DO BY ITSELF, and the helper now sorts it out ─────────────
REM Windows has no built-in way to print a PDF silently to a NAMED printer. It used to say "put
REM SumatraPDF.exe next to this file" - which quietly made the client download a program by hand, so
REM the whole "nothing is downloaded" promise was only ever true on a Mac (owner, 2026-08-27).
REM
REM Now the helper fetches it: ONE portable open-source executable, no installer, no registry. The URL
REM and the SHA-256 are PINNED - a floating "latest" is a program that changes under a restaurant
REM without anybody deciding to, and a download with no checksum is a program you did not choose. If
REM the checksum does not match, it is deleted and nothing prints: a mismatch is never ignored.
set "SUMATRA=%~dp0SumatraPDF.exe"
if not exist "%SUMATRA%" set "SUMATRA=%WORK%\\${SUMATRA.exe}"
if not exist "%SUMATRA%" (
  echo   Fetching the small PDF printer Windows needs ^(once^)...
  echo %DATE% %TIME%  fetching SumatraPDF ${SUMATRA.version}>>"%LOG%"
  curl -sL -m 300 -o "%WORK%\\sp.zip" "${SUMATRA.url}" 2>nul
  set "GOT="
  for /f "skip=1 tokens=*" %%h in ('certutil -hashfile "%WORK%\\sp.zip" SHA256 2^>nul') do if not defined GOT set "GOT=%%h"
  set "GOT=%GOT: =%"
  if /I not "%GOT%"=="${SUMATRA.sha256}" (
    del /q "%WORK%\\sp.zip" 2>nul
    echo   The PDF printer did not download correctly. Check the internet and start this again.
    echo %DATE% %TIME%  SumatraPDF checksum mismatch - refused>>"%LOG%"
    timeout /t 12 /nobreak >nul & exit /b 1
  )
  powershell -NoProfile -Command "Expand-Archive -LiteralPath '%WORK%\\sp.zip' -DestinationPath '%WORK%' -Force" >nul 2>&1
  del /q "%WORK%\\sp.zip" 2>nul
  set "SUMATRA=%WORK%\\${SUMATRA.exe}"
)
if not exist "%SUMATRA%" (
  echo   Could not set up the PDF printer. Start this file again.
  echo %DATE% %TIME%  SumatraPDF missing after fetch>>"%LOG%"
  timeout /t 12 /nobreak >nul & exit /b 1
)

REM This machine, so the app can tell one computer from another.
for /f "skip=1 tokens=*" %%i in ('wmic csproduct get uuid 2^>nul') do if not defined FP set "FP=%%i"
set "FP=%FP: =%"
REM ...and its own NAME. Nobody types one any more (owner, 2026-08-27: "what the fuck is a computer
REM name") - Windows has known it since it was set up.
set "HOST=%COMPUTERNAME%"

REM ── EVERY PRINTER, WITH ITS PAPER SIZE ────────────────────────────────────────────────────
REM Written to a file by PowerShell and posted with --data-binary, because a JSON blob on a cmd.exe
REM command line is a quoting minefield. The paper size is read per printer inside a try/catch: a
REM driver that refuses to answer must cost that one printer's size, never the whole list.
set "PSPRINTERS=$out=@(); foreach($pr in Get-Printer){ $o=@{ name=$pr.Name; desc=$pr.DriverName }; try{ $c=Get-PrintConfiguration -PrinterName $pr.Name -ErrorAction Stop; $w=(Get-PrinterProperty -PrinterName $pr.Name -PropertyName 'PaperSizeWidth' -ErrorAction Stop).Value; $h=(Get-PrinterProperty -PrinterName $pr.Name -PropertyName 'PaperSizeHeight' -ErrorAction Stop).Value; if($w -gt 0 -and $h -gt 0){ $o.paper=@{ name=[string]$c.PaperSize; wMm=[math]::Round($w/100,1); hMm=[math]::Round($h/100,1) } } }catch{}; $out+=$o }"

REM ── PAIRING: this file holds NO secret, so ONE file works for every restaurant (mig 368) ────
REM On its first run it describes itself, opens the browser on THIS machine, and waits for somebody
REM to press Allow. The token it gets back is written here and used for ever after.
set "CODE="
if exist "%TOKENFILE%" set /p CODE=<"%TOKENFILE%"
if not "%CODE%"=="" goto haveCode

cls
echo.
echo   ================================================
echo      Aevidine  .  print helper
echo   ================================================
echo.
echo     Site       %SITE%
echo     Computer   %HOST%
echo.
echo     This computer is not linked yet. Asking the site for a link...
powershell -NoProfile -Command "%PSPRINTERS%; @{ fingerprint='%FP%'; hostname='%HOST%'; os='windows'; printers=$out } | ConvertTo-Json -Compress -Depth 4" > "%WORK%\\start.json" 2>nul
curl -s -m 25 -X POST "%SITE%/api/print-agent/pair/start" -H "content-type: application/json" --data-binary "@%WORK%\\start.json" > "%WORK%\\start.out" 2>nul
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\start.out' -Raw | ConvertFrom-Json).code"\`) do set "PC=%%i"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\start.out' -Raw | ConvertFrom-Json).secret"\`) do set "PS=%%i"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\start.out' -Raw | ConvertFrom-Json).pairUrl"\`) do set "PU=%%i"
if "%PC%"=="" (
  echo     Could not reach %SITE%. Check this computer is online, then start this again.
  echo %DATE% %TIME%  pair/start failed>>"%LOG%"
  timeout /t 12 /nobreak >nul & exit /b 1
)
echo.
echo     Your browser is opening.  In that page, press   ALLOW
echo     If it did not open, go to:  %PU%
echo.
start "" "%PU%"
set /a PN=0
:pairwait
powershell -NoProfile -Command "@{ code='%PC%'; secret='%PS%' } | ConvertTo-Json -Compress" > "%WORK%\\poll.json" 2>nul
curl -s -m 15 -X POST "%SITE%/api/print-agent/pair/poll" -H "content-type: application/json" --data-binary "@%WORK%\\poll.json" > "%WORK%\\poll.out" 2>nul
findstr /C:"\\"state\\":\\"linked\\"" "%WORK%\\poll.out" >nul
if not errorlevel 1 goto paired
findstr /C:"\\"state\\":\\"expired\\"" "%WORK%\\poll.out" >nul
if not errorlevel 1 (
  echo     That link expired before anybody pressed Allow. Start this file again.
  timeout /t 12 /nobreak >nul & exit /b 1
)
set /a PN+=1
if %PN% GEQ 200 (
  echo     Nobody pressed Allow. Start this file again when you are ready.
  timeout /t 12 /nobreak >nul & exit /b 1
)
timeout /t 3 /nobreak >nul
goto pairwait

:paired
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\poll.out' -Raw | ConvertFrom-Json).token"\`) do set "CODE=%%i"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\poll.out' -Raw | ConvertFrom-Json).restaurant"\`) do set "WHERE=%%i"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\poll.out' -Raw | ConvertFrom-Json).name"\`) do set "MYNAME=%%i"
>"%TOKENFILE%" echo %CODE%
del /q "%WORK%\\poll.out" "%WORK%\\start.out" "%WORK%\\poll.json" "%WORK%\\start.json" 2>nul
echo     [ OK ]  Linked to %WHERE%
echo             This computer is now "%MYNAME%"
echo.

:haveCode
REM ── START IT AGAIN BY ITSELF, EVERY TIME (owner, 2026-08-27: "at the night they will shut it
REM    down, and at the morning it will auto start itself?") ─────────────────────────────────────
REM A shortcut in the Startup folder, written BY the helper. It used to be an instruction a person had
REM to follow ("Win+R, shell:startup, drag a shortcut in") - so it was skipped, and a skipped step
REM means the shop opens, nothing prints, and nobody knows why. Rewritten every run; harmless if it
REM is already there. WindowStyle 7 = minimised, so it never sits in front of anybody's work.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\\Aevidine Print Helper.lnk'); $s.TargetPath='%~f0'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Description='Keeps this computer printing for Aevidine'; $s.Save()" >nul 2>&1

cls
echo.
echo   ================================================
echo      Aevidine  .  print helper
echo   ================================================
echo.
echo     Site       %SITE%
echo     Computer   %HOST%
echo.
echo     Linked. Waiting for something to print.
echo     You can minimise this window - it must stay running.
echo.

:loop
REM Every printer this PC has, as JSON, so the app's dropdowns are built from the machine's own words.
powershell -NoProfile -Command "%PSPRINTERS%; @{ fingerprint='%FP%'; printers=$out } | ConvertTo-Json -Compress -Depth 4" > "%WORK%\\hello.json" 2>nul
curl -s -m 20 -X POST "%SITE%/api/print-agent/hello" -H "x-lfh-agent: %CODE%" -H "content-type: application/json" --data-binary "@%WORK%\\hello.json" > "%WORK%\\hello.out" 2>nul
findstr /C:"\\"ok\\":true" "%WORK%\\hello.out" >nul
if errorlevel 1 (
  echo %DATE% %TIME%  this computer's link was removed on the site - delete %TOKENFILE% and start again>>"%LOG%"
  timeout /t 30 /nobreak >nul
  goto loop
)

:work
curl -s -m 20 "%SITE%/api/print-agent/next" -H "x-lfh-agent: %CODE%" > "%WORK%\\job.json" 2>nul
for %%A in ("%WORK%\\job.json") do if %%~zA LSS 5 goto idle
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\job.json' -Raw | ConvertFrom-Json).id"\`) do set "ID=%%i"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\job.json' -Raw | ConvertFrom-Json).printer"\`) do set "PRINTER=%%i"
if "%ID%"=="" goto idle

del /q "%WORK%\\job.html" "%WORK%\\job.pdf" 2>nul
curl -s -m 30 -o "%WORK%\\job.html" "%SITE%/api/print-agent/job/%ID%/document" -H "x-lfh-agent: %CODE%" 2>nul
for %%A in ("%WORK%\\job.html") do if %%~zA LSS 20 (
  echo %DATE% %TIME%  job %ID%: the app had no document for it ^(already handled^)>>"%LOG%"
  goto work
)

REM Chrome's new headless mode does NOT exit after --print-to-pdf (measured on macOS 2026-08-20;
REM same engine here), so it is started with a 25-second leash and ended if it overstays. Waiting on
REM it plainly would hang the helper for ever after the first ticket.
powershell -NoProfile -Command "$a=@('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir=%WORK%\\chrome','--no-pdf-header-footer','--virtual-time-budget=4000','--print-to-pdf=%WORK%\\job.pdf','file:///%WORK:\\=/%/job.html'); $p=Start-Process -FilePath '%CHROME%' -ArgumentList $a -PassThru -WindowStyle Hidden; if(-not $p.WaitForExit(25000)){ try{ $p.Kill() }catch{} }" >nul 2>&1
"%SUMATRA%" -print-to "%PRINTER%" -silent "%WORK%\\job.pdf" >nul 2>&1
if errorlevel 1 (
  curl -s -m 20 -X POST "%SITE%/api/print-agent/job/%ID%/failed" -H "x-lfh-agent: %CODE%" -H "content-type: application/json" -d "{\\"error\\":\\"could not print on %PRINTER%\\"}" >nul 2>&1
  echo %DATE% %TIME%  FAILED job %ID% on %PRINTER% - is it switched on, with paper?>>"%LOG%"
) else (
  curl -s -m 20 -X POST "%SITE%/api/print-agent/job/%ID%/done" -H "x-lfh-agent: %CODE%" -H "content-type: application/json" -d "{}" >nul 2>&1
  echo %DATE% %TIME%  printed job %ID% on %PRINTER%>>"%LOG%"
)
goto work

:idle
timeout /t 2 /nobreak >nul
goto work
`;

// ── Linux / Raspberry Pi ─────────────────────────────────────────────────────────────────────
const linux = (a: HelperScriptArgs) => `#!/bin/sh
# Aevidine print helper${a.label ? " — " + safe(a.label) : ""}
SITE="${safe(a.origin)}"
WORK="$HOME/.cache/aevidine-print"; LOG="$WORK/helper.log"; mkdir -p "$WORK"
HOME_DIR="$HOME/.aevidine-print"; TOKEN_FILE="$HOME_DIR/token"; LOCK="$HOME_DIR/running.pid"
AUTOSTART="$HOME/.config/autostart/aevidine-print.desktop"
mkdir -p "$HOME_DIR"; chmod 700 "$HOME_DIR"

# One at a time — this file starts itself at login now, so a hand-started second copy steps aside.
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "The Aevidine print helper is already running on this computer."; sleep 5; exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

CHROME=""
for c in google-chrome google-chrome-stable chromium chromium-browser; do
  command -v "$c" >/dev/null 2>&1 && { CHROME="$c"; break; }
done
[ -z "$CHROME" ] && { echo "Install Chromium:  sudo apt install -y chromium-browser" | tee -a "$LOG"; exit 1; }

FP="$(cat /etc/machine-id 2>/dev/null || hostname)"
HOST="$(hostname)"

printers_json() {
  first=1; out="["
  for p in $(lpstat -e 2>/dev/null); do
    desc="$(lpoptions -p "$p" 2>/dev/null | tr ' ' '\\n' | sed -n 's/^printer-make-and-model=//p' | tr -d "'" | head -1)"
    [ $first -eq 0 ] && out="$out,"; first=0
    out="$out{\\"name\\":\\"$p\\",\\"desc\\":\\"$desc\\"}"
  done
  echo "$out]"
}
say() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $1" >> "$LOG"; }
say "helper started, talking to $SITE"

# Starts itself at login, written by the helper rather than asked of a person (owner, 2026-08-27).
install_autostart() {
  me="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  mkdir -p "$(dirname "$AUTOSTART")"
  printf '%s\\n' "[Desktop Entry]" "Type=Application" "Name=Aevidine print helper" \\
    "Exec=/bin/sh \\"$me\\"" "X-GNOME-Autostart-enabled=true" "NoDisplay=true" > "$AUTOSTART"
}

# ── PAIRING: no secret in this file, so ONE file works everywhere (mig 368) ───────────────────
CODE=""
[ -f "$TOKEN_FILE" ] && CODE="$(cat "$TOKEN_FILE" 2>/dev/null)"
if [ -z "$CODE" ]; then
  echo "This computer is not linked yet. Asking the site for a link..."
  START="$(curl -s -m 25 -X POST "$SITE/api/print-agent/pair/start" -H "content-type: application/json" \\
    -d "{\\"fingerprint\\":\\"$FP\\",\\"hostname\\":\\"$HOST\\",\\"os\\":\\"linux\\",\\"printers\\":$(printers_json)}")"
  PC="$(echo "$START" | sed -n 's/.*"code":"\\([^"]*\\)".*/\\1/p')"
  PS="$(echo "$START" | sed -n 's/.*"secret":"\\([^"]*\\)".*/\\1/p')"
  PU="$(echo "$START" | sed -n 's/.*"pairUrl":"\\([^"]*\\)".*/\\1/p')"
  [ -z "$PC" ] && { echo "Could not reach $SITE. Check this computer is online."; sleep 10; exit 1; }
  echo ""
  echo "  Open this page on THIS computer and press ALLOW:"
  echo "  $PU"
  echo ""
  # A Pi with no desktop has no browser to open — the URL above is then the whole instruction, which
  # is why it is printed whether or not xdg-open works.
  command -v xdg-open >/dev/null 2>&1 && xdg-open "$PU" >/dev/null 2>&1
  n=0
  while [ $n -lt 200 ]; do
    POLL="$(curl -s -m 15 -X POST "$SITE/api/print-agent/pair/poll" -H "content-type: application/json" \\
      -d "{\\"code\\":\\"$PC\\",\\"secret\\":\\"$PS\\"}")"
    case "$POLL" in
      *'"state":"linked"'*)
        CODE="$(echo "$POLL" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')"
        printf '%s' "$CODE" > "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE"
        install_autostart
        echo "Linked. It will start again by itself at every login."
        break ;;
      *'"state":"expired"'*) echo "That link expired. Start this file again."; sleep 10; exit 1 ;;
    esac
    n=$((n+1)); sleep 3
  done
  [ -z "$CODE" ] && { echo "Nobody pressed Allow. Start this file again."; sleep 10; exit 1; }
else
  install_autostart
  echo "Linked. Waiting for something to print."
fi

while :; do
  HELLO="$(curl -s -m 20 -X POST "$SITE/api/print-agent/hello" -H "x-lfh-agent: $CODE" \\
    -H "content-type: application/json" -d "{\\"fingerprint\\":\\"$FP\\",\\"printers\\":$(printers_json)}")"
  case "$HELLO" in
    *'"ok":true'*) : ;;
    *) say "this computer's link was removed on the site — delete $TOKEN_FILE and start again."; sleep 30; continue ;;
  esac
  while :; do
    JOB="$(curl -s -m 20 "$SITE/api/print-agent/next" -H "x-lfh-agent: $CODE")"
    [ -z "$JOB" ] && break
    ID="$(echo "$JOB" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')"
    PRINTER="$(echo "$JOB" | sed -n 's/.*"printer":"\\([^"]*\\)".*/\\1/p')"
    [ -z "$ID" ] && break
    HTML="$WORK/job.html"; PDF="$WORK/job.pdf"; rm -f "$HTML" "$PDF"
    curl -s -m 30 -o "$HTML" "$SITE/api/print-agent/job/$ID/document" -H "x-lfh-agent: $CODE"
    [ -s "$HTML" ] || { say "job $ID: no document (already handled)"; continue; }
    # Same watchdog as the Mac: new-headless Chrome writes the PDF and then keeps running, so
    # waiting for it would hang the helper for ever after one ticket.
    "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$WORK/chrome" \\
      --no-pdf-header-footer --virtual-time-budget=4000 --print-to-pdf="$PDF" "file://$HTML" >/dev/null 2>&1 &
    CPID=$!
    n=0
    while [ $n -lt 40 ]; do
      [ -s "$PDF" ] && break
      sleep 0.5; n=$((n+1))
    done
    sleep 1
    kill "$CPID" >/dev/null 2>&1
    pkill -f "print-to-pdf=$PDF" >/dev/null 2>&1
    wait "$CPID" 2>/dev/null
    # Followed to completion, and the queued copy cancelled if it never prints — see the Mac script:
    # lp returns 0 for "queued", not for "on paper", and a stuck copy plus a retry is the only way
    # this design could ever hand out two identical tickets.
    OUT=""; PRINTED=0
    [ -s "$PDF" ] && OUT="$(lp -d "$PRINTER" "$PDF" 2>/dev/null)"
    CUPSID="$(echo "$OUT" | sed -n 's/.*request id is \\([^ ]*\\).*/\\1/p')"
    if [ -n "$CUPSID" ]; then
      n=0
      while [ $n -lt 30 ]; do
        if lpstat -W completed -o "$PRINTER" 2>/dev/null | grep -q "^$CUPSID "; then PRINTED=1; break; fi
        sleep 0.5; n=$((n+1))
      done
      [ $PRINTED -eq 0 ] && cancel "$CUPSID" >/dev/null 2>&1
    fi
    if [ $PRINTED -eq 1 ]; then
      curl -s -m 20 -X POST "$SITE/api/print-agent/job/$ID/done" -H "x-lfh-agent: $CODE" -H "content-type: application/json" -d '{}' >/dev/null
      say "printed job $ID on $PRINTER"
    else
      curl -s -m 20 -X POST "$SITE/api/print-agent/job/$ID/failed" -H "x-lfh-agent: $CODE" -H "content-type: application/json" -d "{\\"error\\":\\"$PRINTER did not print it — switched off, out of paper, or unplugged\\"}" >/dev/null
      say "FAILED job $ID on $PRINTER"
    fi
  done
  sleep 2
done
`;

export function helperScript(os: HelperOs, a: HelperScriptArgs): string {
  return os === "windows" ? windows(a) : os === "linux" ? linux(a) : mac(a);
}

/** What the person must do with that text, per machine. The admin console shows these beside it and
 *  the in-app guide repeats them; both read from here so they cannot drift apart. */
export const HELPER_FILENAME: Record<HelperOs, string> = {
  mac: "print-helper.command",
  windows: "print-helper.bat",
  linux: "print-helper.sh",
};
/** WHAT THE HELPER DOES ABOUT STARTING ITSELF — a statement now, not an instruction (owner,
 *  2026-08-27: "at the night they will shut it down, and at the morning it will auto start itself?").
 *  It used to be a step a person had to follow, so it was skipped — and a skipped step means the shop
 *  opens, nothing prints, and nobody knows why. The helper writes its own auto-start on every run. */
export const HELPER_AUTOSTART: Record<HelperOs, string> = {
  mac: "Nothing to do — it installs its own start-up item the first time it runs, and restarts itself if it ever stops.",
  windows: "Nothing to do — it puts its own shortcut in the Startup folder the first time it runs.",
  linux: "Nothing to do — it writes its own ~/.config/autostart entry the first time it runs.",
};
