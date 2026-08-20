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
  code: string;        // the machine's printing-only token (shown once, at install)
  label?: string;      // what the person called this computer, for the log only
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
CODE="${safe(a.code)}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WORK="$HOME/Library/Caches/aevidine-print"
LOG="$WORK/helper.log"
mkdir -p "$WORK"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome is not installed — install it, then start this again." | tee -a "$LOG"
  exit 1
fi

# This machine, so the app can tell one computer from another and warn if one code is copied onto two.
FP="$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}')"

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
say "helper started, talking to $SITE"

# ── the loop: ask, print, report. Nothing clever, on purpose. ────────────────────────────────
while :; do
  HELLO="$(curl -s -m 20 -X POST "$SITE/api/print-agent/hello" -H "x-lfh-agent: $CODE" \\
    -H "content-type: application/json" \\
    -d "{\\"fingerprint\\":\\"$FP\\",\\"printers\\":$(printers_json)}")"
  case "$HELLO" in
    *'"ok":true'*) : ;;
    *) say "the app did not accept this computer's code — check it was copied whole. $HELLO"; sleep 30; continue ;;
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
// Printer discovery is PowerShell's Get-Printer; the paper size is left to the app's address book,
// because Windows reports it inconsistently across drivers and a WRONG size is worse than none.
const windows = (a: HelperScriptArgs) => `@echo off
REM Aevidine print helper${a.label ? " — " + safe(a.label) : ""}
REM Leave this running. It has no window of its own and prints nothing by itself.
setlocal enabledelayedexpansion

set "SITE=${safe(a.origin)}"
set "CODE=${safe(a.code)}"
set "WORK=%LOCALAPPDATA%\\AevidinePrintHelper"
set "LOG=%WORK%\\helper.log"
if not exist "%WORK%" mkdir "%WORK%"

set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME%" (
  echo Google Chrome is not installed - install it, then start this again.>>"%LOG%"
  echo Google Chrome is not installed - install it, then start this again.
  pause & exit /b 1
)

REM The one extra piece Windows needs: a silent PDF printer. Put SumatraPDF.exe next to this file.
set "SUMATRA=%~dp0SumatraPDF.exe"
if not exist "%SUMATRA%" set "SUMATRA=%WORK%\\SumatraPDF.exe"
if not exist "%SUMATRA%" (
  echo Put SumatraPDF.exe next to this file - Windows cannot print a PDF silently without it.>>"%LOG%"
  echo Put SumatraPDF.exe next to this file, then start this again.
  pause & exit /b 1
)

REM This machine, so the app can tell one computer from another.
for /f "skip=1 tokens=*" %%i in ('wmic csproduct get uuid 2^>nul') do if not defined FP set "FP=%%i"
set "FP=%FP: =%"

:loop
REM Every printer this PC has, as JSON, so the app's dropdowns are built from the machine's own words.
powershell -NoProfile -Command "$p=Get-Printer | ForEach-Object { @{ name=$_.Name; desc=$_.DriverName } }; @{ fingerprint='%FP%'; printers=$p } | ConvertTo-Json -Compress -Depth 4" > "%WORK%\\hello.json" 2>nul
curl -s -m 20 -X POST "%SITE%/api/print-agent/hello" -H "x-lfh-agent: %CODE%" -H "content-type: application/json" --data-binary "@%WORK%\\hello.json" > "%WORK%\\hello.out" 2>nul
findstr /C:"\\"ok\\":true" "%WORK%\\hello.out" >nul
if errorlevel 1 (
  echo %DATE% %TIME%  the app did not accept this computer's code - check it was copied whole.>>"%LOG%"
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
CODE="${safe(a.code)}"
WORK="$HOME/.cache/aevidine-print"; LOG="$WORK/helper.log"; mkdir -p "$WORK"

CHROME=""
for c in google-chrome google-chrome-stable chromium chromium-browser; do
  command -v "$c" >/dev/null 2>&1 && { CHROME="$c"; break; }
done
[ -z "$CHROME" ] && { echo "Install Chromium:  sudo apt install -y chromium-browser" | tee -a "$LOG"; exit 1; }

FP="$(cat /etc/machine-id 2>/dev/null || hostname)"

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

while :; do
  HELLO="$(curl -s -m 20 -X POST "$SITE/api/print-agent/hello" -H "x-lfh-agent: $CODE" \\
    -H "content-type: application/json" -d "{\\"fingerprint\\":\\"$FP\\",\\"printers\\":$(printers_json)}")"
  case "$HELLO" in
    *'"ok":true'*) : ;;
    *) say "the app did not accept this computer's code. $HELLO"; sleep 30; continue ;;
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
export const HELPER_AUTOSTART: Record<HelperOs, string> = {
  mac: "System Settings → General → Login Items & Extensions → Open at Login → + → pick print-helper.command",
  windows: "Win + R → shell:startup → drag a shortcut to print-helper.bat into that folder",
  linux: "cp the .desktop entry into ~/.config/autostart (the guide has it)",
};
