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

import { createHash } from "node:crypto";

export type HelperOs = "mac" | "windows" | "linux";

export type HelperScriptArgs = {
  origin: string;      // the site the helper talks to, e.g. https://www.aevinite.shop
  /** NO LONGER USED and deliberately kept out of the file (mig 368, kept out again by mig 380).
   *  The helper holds no secret: it ASKS for a ten-minute setup code on its first run and trades it
   *  for its own token, which is what makes ONE file work for every restaurant. */
  code?: string;
  label?: string;      // what the person called this computer, for the log only
};

// ── HOW A COMPUTER JOINS A RESTAURANT (mig 380) ───────────────────────────────────────────────
//
// Owner, 2026-09-13: *"instead of login make something else otherwise the waiter will also do that
// printing thing"*, then: *"you can generate code for each restaurant from printing menu and like
// the helper ask for that code and that generated code only works for 10 min."*
//
// It used to open a browser on this machine and wait for somebody signed in THERE to press Allow.
// That asked a restaurant's counter PC for a STAFF LOGIN — the same login a waiter has — which is
// the thing he objected to, and it also stranded anyone signed in without the print_setup switch on
// a page that just said "sign in" for ever.
//
// Now: a person on the Printing screen presses "Show a setup code", the helper asks for it once,
// and nobody ever signs in on this machine. Three things follow from that, and all three are in
// every one of the scripts below:
//
//  · A PERSON MUST BE ABLE TO TYPE. A copy started by the auto-start entry has nobody watching it,
//    so it is passed --auto (mac/linux) or /auto (Windows) and simply exits or waits quietly when
//    there is no token, instead of sitting at a prompt in a window nobody will ever look at.
//  · A REFUSED TOKEN CLEARS ITSELF. When the site says this computer was unlinked, the token file is
//    deleted and the helper asks for a fresh code — it used to tell the person to go and delete a
//    file inside a hidden folder, which is not a thing a restaurant does.
//  · THE LOCK STANDS ASIDE FOR A SETUP. A second copy normally steps back so two helpers never share
//    one token — but a copy with NO token has nothing to step back for, and the auto-started one
//    holding the lock is exactly what would otherwise stop somebody re-linking the machine.

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

// ── A VALUE PASTED INTO A GENERATED FILE MUST NOT BE ABLE TO ADD A LINE TO IT ────────────────
// (T25 round 2, item 27, 2026-08-31.) Both values here are typed by a person: `label` is the name
// the admin gives the computer on /aevinite/printing, and `origin` is built from the request's host.
// They are pasted into a shell script, a .bat file and a comment line.
//
// The old rule stripped `"`, a backtick, `$` and `\` — everything that could END a quoted string or
// start a substitution — and that part was right. It did NOT strip NEWLINES, and a comment line only
// lasts until one. MEASURED by generating the real file with the computer named
// `Front desk PC\nsay 'this line was added by the computer name'\n# `:
//
//     1| #!/bin/zsh
//     2| # Aevidine print helper — Front desk PC
//     3| say 'this line was added by the computer name'      ← a real line, from a NAME
//
// …identically on all three machines. So line breaks are folded to a space, and the batch/shell
// punctuation that means "and then do this" (`% ^ & | < > ;`) goes with them: none of it belongs in
// a hostname or in what somebody calls their front-desk PC, and `%` in particular is how a .bat file
// expands a variable. The 200-character ceiling stays.
const safe = (s: string) =>
  String(s || "")
    .replace(/[\r\n\u2028\u2029]+/g, " ")     // a name can never start a new LINE of the script
    .replace(/["`$\\%^&|<>;]/g, "")
    .slice(0, 200);

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

# ══════════════════════════════════════════════════════════════════════════════
#  THE ONE LINE YOU MAY CHANGE — and nothing else in this file.
#
#   SITE   the web address this helper talks to. Change it to point this same
#          file at a different site (a test site, a new address) without
#          remaking it. Keep the https:// and no trailing slash.
#
#  Everything below is machinery. If it stops working after an edit, the edit
#  is the reason.
# ══════════════════════════════════════════════════════════════════════════════
SITE="${safe(a.origin)}"
# ── WHERE THIS FILE IS, WORKED OUT HERE AND NOWHERE ELSE ─────────────────────────────────────
# IN ZSH, \$0 INSIDE A FUNCTION IS THE FUNCTION'S OWN NAME — not the script. install_autostart
# used to read it inside itself, so the start-up item it wrote pointed at a file called
# "install_autostart" in whatever directory the helper happened to be started from, and launchd
# answered:
#     /bin/zsh: can't open input file: …/install_autostart
# The helper therefore NEVER came back after a reboot, while the window and the guide both promised
# it would. Found by installing it for real on a Mac and reading the item it wrote (2026-09-13) —
# every earlier test checked that the item EXISTED, which it did, perfectly and uselessly.
# At the top level of a script \$0 is the script, so it is captured once, here.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
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
# …EXCEPT WHEN THIS MACHINE HAS NO TOKEN (mig 380). The copy holding the lock is then an
# auto-started one with nothing to do, and standing aside would leave the person who just came to
# re-link this computer with no way to type a code. Whoever can type wins.
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  if [ -s "$TOKEN_FILE" ]; then
    echo ""
    echo "  The Aevidine print helper is ALREADY RUNNING on this computer."
    echo "  Nothing to do — you can close this window."
    echo ""
    sleep 6
    exit 0
  fi
  kill "$(cat "$LOCK" 2>/dev/null)" >/dev/null 2>&1
  sleep 1
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
  # THE ONE LINE THAT ANSWERS "is this the current file?" from a photograph.
  echo "    Version    __HELPER_VERSION__"
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
# A VALUE GOING INTO JSON IS ESCAPED FIRST (T11, sweep #8, 2026-09-07).
# This file builds its printer list by hand, and interpolated $p and $desc straight into it. A
# printer whose CUPS model name contains a double quote — Brother \"QL\" Series — or a backslash
# made the whole list invalid JSON, so the server could not read this machine's printers at all:
# the admin's dropdowns came up empty for it and nothing anywhere said why. The Windows half was
# never exposed to this, because PowerShell's ConvertTo-Json escapes by construction; these two
# shell halves now agree with it.
jesc() { printf '%s' "\$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g'; }
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
    out="$out{\\"name\\":\\"$(jesc "$p")\\",\\"desc\\":\\"$(jesc "$desc")\\""
    [ -n "$w" ] && [ -n "$h" ] && out="$out,\\"paper\\":{\\"name\\":\\"$(jesc "$media")\\",\\"wMm\\":$w,\\"hMm\\":$h}"
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
# ── AND NOT ONE COMMENT INSIDE THE PLIST ─────────────────────────────────────────────────────
# An XML comment may not contain a double hyphen — so "--auto", written inside one, makes the whole
# file invalid XML. launchd then keeps whatever job it had cached and silently ignores every later
# edit, which is the worst way for a start-up item to fail: the file on disk looks right, and none
# of it is in effect. (Mine did exactly that for a few hours on 2026-09-13. plistlib refuses to read
# it, which is how it was caught.) The two notes that were in here live above this function now.
#
# ── ARGUMENTS: what each key is for ─────────────────────────────────────────────────────────
#   --auto            nobody is watching this copy; with no token it steps aside rather than
#                     waiting at a prompt in a window that does not exist (mig 380)
#   KeepAlive         bring it back if it ever dies mid-service
#   ThrottleInterval  ten seconds between restarts — launchd's own default, and the right answer
#                     for the case that actually matters: a helper that died in the middle of
#                     service. Five minutes was tried first, to keep an UNLINKED machine from
#                     re-running this file every ten seconds — but that traded ten quiet log lines
#                     a minute for up to five minutes of a restaurant not printing, which is the
#                     wrong way round. The unlinked case waits on its own instead (see link_up).
install_autostart() {
  # ── IT RUNS FROM ITS OWN FOLDER, NEVER FROM THE DESKTOP ────────────────────────────────────
  # macOS TCC does not let a background item read ~/Desktop, ~/Documents or ~/Downloads. The guide
  # tells everybody to save this file on the DESKTOP — so a start-up item pointing there is refused
  # by the system every single time:
  #     /bin/zsh: can't open input file: /Users/<name>/Desktop/print-helper.command
  # The file, the path and the plist were all perfect; the folder was the problem. Measured on a
  # real Mac on 2026-09-13, after fixing two other faults that were hiding it.
  #
  # So the helper keeps a copy of itself in its own folder (already chmod 700) and the start-up item
  # runs THAT. It also makes the promise survive somebody moving the Desktop file, renaming it, or
  # putting it in the bin once it "looks like it is working" — which is the ordinary thing to do
  # with a file you were told to type out once.
  #
  # Re-running the Desktop file after pasting a newer one refreshes the copy, so updating is still
  # "paste, save, double-click" and nothing else.
  local run="$HOME_DIR/helper.command"
  # WRITTEN ASIDE AND MOVED INTO PLACE, NEVER OVER THE TOP. cp onto the copy that launchd is
  # RUNNING rewrites the very file that shell is still reading, and it then executes nonsense: seen
  # on 2026-09-13, where it garbled the next answer badly enough that the helper concluded it had
  # been unlinked and threw its own token away. mv swaps the name atomically — the running one
  # keeps the file it started with and finishes it in peace.
  if [ "$SELF" != "$run" ]; then
    cp -f "$SELF" "$run.new" 2>/dev/null && chmod +x "$run.new" 2>/dev/null && mv -f "$run.new" "$run" 2>/dev/null
    rm -f "$run.new" 2>/dev/null
  fi
  [ -x "$run" ] || run="$SELF"          # copy refused: better a start-up item that may be blocked
  local me="$run"                      # the path came from SELF, at the top. Never work it out here.
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST.new" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aevidine.print</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$me</string><string>--auto</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardErrorPath</key><string>$WORK/launchd.log</string>
</dict></plist>
PLISTEOF
  # ── ONLY TELL launchd ABOUT IT IF IT ACTUALLY CHANGED ──────────────────────────────────────
  # This used to unload and reload the job every single time the helper started — and the copy
  # launchd ITSELF started is inside that job, so "launchctl unload" killed the very process that
  # was running the line. It came up, stopped itself, and launchd (KeepAlive, five-minute throttle)
  # brought up another one to do the same thing. The helper looked installed, launchd reported a
  # clean exit 0, and the restaurant's computer never polled once.
  #
  # Measured on 2026-09-13: started by hand it ran for ever; started by launchd it was gone within
  # seconds, with an empty error log. The two are the same file — the difference is only that one of
  # them is allowed to unload the job it is living in.
  #
  # Writing the file is idempotent, so comparing is enough: a copy launchd started writes exactly
  # what is already there, changes nothing, and lives. A copy somebody double-clicks after pasting a
  # NEWER file writes something different, and only then is launchd told.
  if cmp -s "$PLIST.new" "$PLIST" 2>/dev/null; then
    rm -f "$PLIST.new"
  else
    mv -f "$PLIST.new" "$PLIST" 2>/dev/null
    launchctl unload "$PLIST" >/dev/null 2>&1
    launchctl load "$PLIST" >/dev/null 2>&1
  fi
}

# ── LINKING: one setup code, typed once, and nobody signs in here (mig 380) ───────────────────
# Owner, 2026-09-13: "you can generate code for each restaurant from printing menu and like the
# helper ask for that code and that generated code only works for 10 min."
#
# This file holds NO secret, which is what lets ONE file work for every restaurant. The code it asks
# for is not a login: it signs nobody in, it reads nothing, it dies in ten minutes, and the first
# computer to use it spends it. What comes back is this machine's own token, written here and used
# for ever after — so nobody signs in on this computer, now or later.
AUTO=0
[ "$1" = "--auto" ] && AUTO=1

# A code the person typed, made into the code we issued: they will type the space the screen shows
# ("K7M P2X"), or the dash they remember, or lower case on a laptop that autocapitalises. All the
# same code. The server normalises it too — this half only keeps the window's own echo tidy.
tidy_code() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -d '[:blank:]_-'; }

link_up() {
  # NOBODY IS WATCHING AN AUTO-STARTED COPY. Sitting at a prompt would look, from the outside,
  # exactly like a helper that is running fine and simply never prints.
  if [ "$AUTO" = "1" ] || [ ! -t 0 ]; then
    # WAITS BEFORE GIVING UP, so launchd's ten-second restart does not turn "this machine is not
    # linked" into six log lines a minute. The ten seconds belong to a helper that CRASHED; this
    # path is the other case, and it can afford to be patient.
    say "not linked, and nobody can type here — start this file by hand to enter a setup code"
    sleep 50
    return 1
  fi
  local typed tidied answer n=0
  while [ $n -lt 5 ]; do
    n=$((n+1))
    echo ""
    echo "    ─────────────────────────────────────────────────────"
    echo "    This computer is not set up to print yet."
    echo ""
    echo "    On the Aevidine Printing screen, press"
    echo "        \\"Show a setup code\\""
    echo "    and type the six characters it shows, here."
    echo ""
    echo "    The code lasts ten minutes. Nobody signs in on this"
    echo "    computer — not now, and not ever."
    echo "    ─────────────────────────────────────────────────────"
    echo ""
    printf "    Setup code:  "
    read typed || { echo ""; say "no code was typed"; return 1; }
    tidied="$(tidy_code "$typed")"
    if [ -z "$tidied" ]; then continue; fi
    echo ""
    line "Checking that code…"
    # The printer list travels WITH the code, so the Printing screen's dropdowns are full the moment
    # this machine appears on it — nobody should have to wait for a first hello to be able to say
    # which printer prints the bills.
    answer="$(curl -s -m 25 -X POST "$SITE/api/print-agent/pair/claim" -H "content-type: application/json" \\
      -d "{\\"code\\":\\"$tidied\\",\\"helper\\":\\"__HELPER_VERSION__\\",\\"fingerprint\\":\\"$FP\\",\\"hostname\\":\\"$HOST\\",\\"os\\":\\"mac\\",\\"printers\\":$(printers_json)}")"
    if [ -z "$answer" ]; then
      line "Could not reach $SITE. Check this computer is online, then try again."
      continue
    fi
    case "$answer" in
      *'"ok":true'*)
        CODE="$(echo "$answer" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')"
        WHERE="$(echo "$answer" | sed -n 's/.*"restaurant":"\\([^"]*\\)".*/\\1/p')"
        NAME="$(echo "$answer" | sed -n 's/.*"name":"\\([^"]*\\)".*/\\1/p')"
        if [ -z "$CODE" ]; then line "The site answered oddly. Try again in a moment."; continue; fi
        printf '%s' "$CODE" > "$TOKEN_FILE"
        chmod 600 "$TOKEN_FILE"
        install_autostart
        banner "\${PLIST_NAMES:-none found}"
        line "✅  Linked to $WHERE"
        line "    This computer is now \\"$NAME\\""
        line "    It will start again by itself every time this Mac is switched on."
        echo ""
        return 0 ;;
      *)
        # THE SERVER'S OWN SENTENCE, not one invented here: it is the half that knows whether the
        # code was wrong, already used, or simply late, and a person retyping needs that difference.
        line "$(echo "$answer" | sed -n 's/.*"error":"\\([^"]*\\)".*/\\1/p')"
        ;;
    esac
  done
  line "That is five tries. Press \\"Show a setup code\\" again and start this file when you have it."
  return 1
}

CODE=""
[ -f "$TOKEN_FILE" ] && CODE="$(cat "$TOKEN_FILE" 2>/dev/null)"

if [ -z "$CODE" ]; then
  link_up || { sleep 10; exit 1; }
else
  install_autostart
  line "Linked. Waiting for something to print — you can minimise this window."
  echo ""
fi

# ── the loop: ask, print, report. Nothing clever, on purpose. ────────────────────────────────
while :; do
  # ── ONLY THE SITE SAYING "NO" COUNTS AS BEING UNLINKED (2026-09-13) ─────────────────────────
  # This used to treat ANY answer that was not ok:true as "this computer was unlinked" and
  # DELETE ITS OWN TOKEN. An empty answer does that. A timeout does that. A 502 while the site is
  # deploying does that. So a moment of bad wifi in a restaurant could unlink the shop's printer and
  # leave somebody needing a fresh setup code to get their printing back — from a blip that fixed
  # itself in two seconds.
  #
  # Seen for real on 2026-09-13: re-running the file corrupted the copy the running helper was
  # reading, its next answer came back garbled, and the helper threw its own token away.
  #
  # The HTTP code is read now, and only a 401 — the site's way of saying "that printing code is not
  # valid any more" — is believed. Everything else is a blip: the token is kept, and it asks again.
  HCODE="$(curl -s -m 20 -o "$WORK/hello.out" -w '%{http_code}' -X POST "$SITE/api/print-agent/hello" \\
    -H "x-lfh-agent: $CODE" -H "content-type: application/json" \\
    -d "{\\"fingerprint\\":\\"$FP\\",\\"printers\\":$(printers_json)}")"
  HELLO="$(cat "$WORK/hello.out" 2>/dev/null)"
  if [ "$HCODE" != "200" ] && [ "$HCODE" != "401" ]; then
    say "the site did not answer (HTTP \${HCODE:-none}) — keeping this computer's code and trying again"
    sleep 30; continue
  fi
  case "$HELLO" in
    *'"ok":true'*) : ;;
    # ── A REFUSED TOKEN CLEARS ITSELF (mig 380) ──────────────────────────────────────────────
    # It used to say "delete $TOKEN_FILE and start this file again" — a hidden folder inside a home
    # directory, which is not a thing a restaurant does, so the real outcome was a machine that
    # never printed again and nobody knowing why. The dead token goes now, and if somebody is
    # sitting here the helper simply asks for a fresh setup code.
    *) if [ "$HCODE" != "401" ]; then
         say "the site answered oddly but did not refuse this computer — keeping its code"
         sleep 30; continue
       fi
       rm -f "$TOKEN_FILE"
       CODE=""
       line "This computer was unlinked on the site."
       if link_up; then continue; fi
       # ── NOBODY TO TYPE: LET GO OF THE LOCK AND STOP ──────────────────────────────────────
       # Waiting here in a loop was the obvious way to write this and it is the wrong one. This
       # copy has no token and nobody watching it, so it can never do anything again — and while it
       # sits there it HOLDS the single-instance lock, which is exactly what somebody walking up to
       # re-link the machine needs. Exiting hands the lock over. The auto-start entry brings this
       # file back on its own five-minute throttle, finds no token, and steps aside again, so
       # nothing is lost by stopping.
       say "stopping so somebody can run this file by hand and enter a setup code"
       exit 0 ;;
  esac

  # ── HOW OFTEN THIS ASKS IS THE APP'S DECISION, NOT THIS FILE'S (2026-09-09) ─────────────────
  # The server has always sent "pollMs" in this very answer and nothing had ever read it: one write
  # on the server, zero readers anywhere. So "every 2 seconds" was hard-coded into every copy of this
  # file, and slowing printing traffic down would have meant re-installing on every restaurant's
  # computer. At 2s one helper is ~43,000 requests a day; twenty restaurants is ~864,000, each one a
  # function call and a database read.
  #
  # IT CAN ONLY EVER SLOW DOWN. The value is accepted only when it is a whole number between 2,000
  # and 60,000 ms; anything else - missing, empty, garbled, an old server that sends nothing - falls
  # back to the 2 seconds this file used before. That is deliberate, and it is what makes this safe
  # to ship to an operating system nobody here can test on: the worst case is today's behaviour,
  # never a tighter loop. Nothing here can cost more than it already does.
  PMS="$(printf '%s' "$HELLO" | sed -n 's/.*"pollMs"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -1)"
  case "$PMS" in ''|*[!0-9]*) PMS=2000 ;; esac
  [ "$PMS" -lt 2000 ] && PMS=2000
  [ "$PMS" -gt 60000 ] && PMS=60000
  IDLE=$(( PMS / 1000 ))

  # ── ONE LANE PER PRINTER (owner, 2026-09-14) ────────────────────────────────────────────────
  #
  # *"Whenever there are more prints in the queue it is working slowly… if there are three different
  # printers connected to the PC and set up for different prints, so all that we have different
  # queue. For example, you can send kitchen and print bill simultaneously in parallel."*
  #
  # This loop printed STRICTLY one job at a time, whatever printer it was for. Each one costs a
  # Chrome render plus up to fifteen seconds waiting for the queue to confirm the paper came out —
  # so a bill for a customer standing at the counter waited behind every kitchen slip in front of
  # it, on a DIFFERENT printer that was idle the whole time.
  #
  # A "max" on the request asks the app for a BATCH: at most one job per distinct printer. So every job in a round
  # is on its own printer, and one background worker per job can never collide with another. A round
  # now takes as long as its SLOWEST printer instead of the sum of all of them.
  #
  # TWO THINGS ARE PER-JOB AND HAVE TO BE: the html/pdf pair (two workers sharing one job.pdf would
  # print each other's paper) and Chrome's profile directory (two Chromes on one profile fight over
  # its lock and one of them silently writes nothing).
  print_one() {
    ID="$1"; PRINTER="$2"
    HTML="$WORK/job-$ID.html"; PDF="$WORK/job-$ID.pdf"
    rm -f "$HTML" "$PDF"
    if ! curl -s -m 30 -o "$HTML" "$SITE/api/print-agent/job/$ID/document" -H "x-lfh-agent: $CODE" || [ ! -s "$HTML" ]; then
      say "job $ID: the app had no document for it (already handled)"; return
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
      --user-data-dir="$WORK/chrome-$ID" --no-pdf-header-footer --virtual-time-budget=4000 \\
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
    rm -rf "$WORK/chrome-$ID" "$HTML" "$PDF"
  }

  while :; do
    # An old app answers the single-job shape and ignores the max — the reader below copes with both,
    # because a helper file cannot be pushed and this one may well outlive a rollback.
    BATCH="$(curl -s -m 20 "$SITE/api/print-agent/next?max=4" -H "x-lfh-agent: $CODE")"
    [ -z "$BATCH" ] && break                    # 204 — nothing to print
    : > "$WORK/batch.txt"
    echo "$BATCH" | tr '{' '\\n' | while IFS= read -r CHUNK; do
      JID="$(printf '%s' "$CHUNK" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')"
      JPR="$(printf '%s' "$CHUNK" | sed -n 's/.*"printer":"\\([^"]*\\)".*/\\1/p')"
      [ -n "$JID" ] && printf '%s %s\\n' "$JID" "$JPR" >> "$WORK/batch.txt"
    done
    [ ! -s "$WORK/batch.txt" ] && break
    # Redirected from a FILE, never a pipe: a pipe runs this in a subshell and the wait below
    # would have nothing to wait for. A printer name may contain spaces, and read puts the whole
    # remainder in the LAST variable, which is why the id is written first.
    while read -r JID JPR; do
      [ -z "$JID" ] && continue
      print_one "$JID" "$JPR" &
    done < "$WORK/batch.txt"
    wait                                        # every lane finishes before the next round
  done
  sleep "$IDLE"
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
// ⚠️ A KNOWN, WRITTEN LIMIT: WINDOWS DOES NOT FOLLOW THE JOB TO COMPLETION.
//
// On mac and linux this helper waits for the job to LEAVE the print queue before it reports back,
// because a print command returns success with the printer unplugged (measured, 2026-08). The
// Windows branch below has no way to do that here: it trusts the PDF program's exit code, so on
// Windows the queue's one promise — "nothing says printed unless paper came out" — is not kept, and
// a ticket can be marked printed with no paper and never come back.
//
// IT IS NOT FIXED HERE ON PURPOSE. The fix belongs in the path that decides whether a ticket is
// reprinted, i.e. paper and money, and there is no Windows machine with a printer on this side to
// watch it work. Writing it blind and shipping it is the trade this project refuses. What it needs:
// a Windows PC with a real printer, then follow the job with Get-PrintJob (or wmic printjob) exactly
// as the other two follow theirs, and retry-and-report on failure instead of recording done.
//
// verify:print-documents reads this note and SKIPS rather than passing, so the gap stays visible.
const windows = (a: HelperScriptArgs) => `@echo off
REM Aevidine print helper${a.label ? " — " + safe(a.label) : ""}
REM Leave this running. It has no window of its own and prints nothing by itself.
setlocal enabledelayedexpansion

REM ══════════════════════════════════════════════════════════════════════════════
REM  THE ONE LINE YOU MAY CHANGE — and nothing else in this file.
REM
REM   SITE   the web address this helper talks to. Change it to point this same
REM          file at a different site (a test site, a new address) without
REM          remaking it. Keep the https:// and no trailing slash.
REM
REM  Everything below is machinery. If it stops working after an edit, the edit
REM  is the reason.
REM ══════════════════════════════════════════════════════════════════════════════
set "SITE=${safe(a.origin)}"
set "WORK=%LOCALAPPDATA%\\AevidinePrintHelper"
set "LOG=%WORK%\\helper.log"
set "TOKENFILE=%WORK%\\token.txt"
set "LOCKFILE=%WORK%\\running.lock"
if not exist "%WORK%" mkdir "%WORK%"

REM ── ONE LANE PER PRINTER (owner, 2026-09-14) ──────────────────────────────────────────────────
REM
REM *"You can send kitchen and print bill simultaneously in parallel."*
REM
REM This file used to print strictly one job at a time, whatever printer it was for, so a bill for a
REM customer standing at the counter waited behind every kitchen slip in front of it - on a DIFFERENT
REM printer that was idle the whole time.
REM
REM A round now asks the app for at most ONE JOB PER PRINTER and starts a lane for each. A lane is
REM THIS SAME FILE, re-run with /lane - which is why this dispatch is the first thing after the
REM folder exists and before every other line: a lane must not take the single-instance lock, must
REM not read the setup code prompt, and must not write a Startup shortcut. It prints one job and
REM ends.
REM
REM The parent waits for the lanes before starting the next round, so two tickets for one printer
REM can never be in flight at once and their ORDER is kept - which is a promise the kitchen queue
REM makes. That wait is BOUNDED (see :waitlanes): a mis-count must cost a slow round, never a helper
REM that stops printing.
if /i "%~1"=="/lane" goto lane

REM ── NOBODY IS WATCHING AN AUTO-STARTED COPY (mig 380) ─────────────────────────────────────
REM The Startup shortcut this file writes for itself passes /auto and opens the window MINIMISED.
REM Setting a computer up now means TYPING a six-character code, so an auto-started copy with no
REM token would sit at a prompt in a minimised window that nobody will ever restore - which, from
REM the outside, looks exactly like a helper running perfectly and simply never printing. It steps
REM out of the way instead, and leaves the lock free for the copy a person just double-clicked.
if /I "%~1"=="/auto" if not exist "%TOKENFILE%" (
  echo %DATE% %TIME%  auto-start with no setup code - waiting for somebody to run this by hand>>"%LOG%"
  exit /b 0
)

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
REM ── !GOT!, NOT %GOT% — AND IT IS NOT A STYLE CHOICE (T11 sweep #8, 2026-09-04) ─────────────
REM cmd.exe expands every %VAR% when it PARSES a whole parenthesised block, before a single line of
REM it runs. GOT is set by the for-loop just above, INSIDE this block, so a %GOT% read here saw the
REM value from before the block started — i.e. nothing. The two lines then became
REM     set "GOT="                          (%GOT: =% on an undefined var is the empty string)
REM     if /I not ""=="98b33a…"             (true)
REM …so the checksum NEVER matched, the zip was deleted every time, and this file printed "The PDF
REM printer did not download correctly" and exited. Windows has no built-in silent PDF print, so
REM that means a Windows helper could not print at all unless somebody had already put
REM SumatraPDF.exe beside the file by hand — the exact manual step this fetch exists to remove.
REM setlocal enabledelayedexpansion is already on at the top of the file; !VAR! is what reads a
REM value that was set in the same block. Guarded by verify:print-helper block 8i, which walks the
REM generated .bat and fails on any %VAR% read inside a block that sets VAR.
  set "GOT=!GOT: =!"
  if /I not "!GOT!"=="${SUMATRA.sha256}" (
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

REM ── LINKING: one setup code, typed once, and nobody signs in here (mig 380) ───────────────
REM Owner, 2026-09-13: "you can generate code for each restaurant from printing menu and like the
REM helper ask for that code and that generated code only works for 10 min."
REM
REM This file holds NO secret, which is what lets ONE file work for every restaurant. It used to
REM open a browser here and wait for somebody signed in ON THIS PC to press Allow - a STAFF login on
REM a shop's counter machine, which is the same login a waiter has. Nobody signs in here any more.
set "CODE="
if exist "%TOKENFILE%" set /p CODE=<"%TOKENFILE%"
if not "%CODE%"=="" goto haveCode
set /a TRIES=0

:askcode
set /a TRIES+=1
if %TRIES% GTR 5 (
  echo     That is five tries. Press "Show a setup code" again and start this file when you have it.
  timeout /t 15 /nobreak >nul & exit /b 1
)
cls
echo.
echo   ================================================
echo      Aevidine  .  print helper
echo   ================================================
echo.
echo     Site       %SITE%
echo     Computer   %HOST%
echo     Version    __HELPER_VERSION__
echo.
echo     This computer is not set up to print yet.
echo.
echo     On the Aevidine Printing screen, press
echo         "Show a setup code"
echo     and type the six characters it shows, here.
echo.
echo     The code lasts ten minutes. Nobody signs in on
echo     this computer - not now, and not ever.
echo.
set "TYPED="
set /p TYPED=  Setup code:  
if "%TYPED%"=="" goto askcode

REM THE TYPED VALUE IS NEVER PUT ON A COMMAND LINE. It goes to a file and PowerShell reads it from
REM there, which is also where it is stripped down to letters and digits: a person will type the
REM space the screen shows ("K7M P2X"), or a dash, and somebody pasting from a chat can bring
REM anything at all with it. A quote or an ampersand on a cmd.exe command line is how a .bat file
REM stops being the file you wrote.
>"%WORK%\\typed.txt" echo(!TYPED!
echo.
echo     Checking that code...
REM The printer list travels WITH the code, so the Printing screen's dropdowns are full the moment
REM this machine appears on it.
powershell -NoProfile -Command "%PSPRINTERS%; $c=((Get-Content '%WORK%\\typed.txt' -Raw) -replace '[^A-Za-z0-9]','').ToUpper(); @{ code=$c; helper='__HELPER_VERSION__'; fingerprint='%FP%'; hostname='%HOST%'; os='windows'; printers=$out } | ConvertTo-Json -Compress -Depth 4" > "%WORK%\\claim.json" 2>nul
del /q "%WORK%\\typed.txt" 2>nul
REM ── NO CARET BEFORE THE PIPE, AND IT IS NOT A STYLE CHOICE (found on a real Windows PC,
REM    2026-09-13). Inside a for /f "usebackq" command the text is handed to cmd, and a pipe that
REM    sits between DOUBLE QUOTES is already literal - there is nothing to escape. Writing a caret
REM    in front of it passes the caret straight through to PowerShell, which answers:
REM        Get-Content : A positional parameter cannot be found that accepts argument "^".
REM    ...so all four reads below failed: the error message, the token, the restaurant and the
REM    computer name. A CORRECT code was spent on the server and then rejected here for want of a
REM    token, which put the person in a loop that burned a fresh code every time round.
REM    The three older reads in this file (pollMs, job id, printer) always used a plain pipe and
REM    always worked; these now match them. Guarded by verify:print-helper block 8j.
curl -s -m 25 -X POST "%SITE%/api/print-agent/pair/claim" -H "content-type: application/json" --data-binary "@%WORK%\\claim.json" > "%WORK%\\claim.out" 2>nul
del /q "%WORK%\\claim.json" 2>nul
for %%A in ("%WORK%\\claim.out") do if %%~zA EQU 0 (
  echo     Could not reach %SITE%. Check this computer is online, then try again.
  echo %DATE% %TIME%  pair/claim got no answer>>"%LOG%"
  timeout /t 6 /nobreak >nul
  goto askcode
)
findstr /C:"\\"ok\\":true" "%WORK%\\claim.out" >nul
if errorlevel 1 (
  REM THE SERVER'S OWN SENTENCE, not one invented here: only it knows whether the code was wrong,
  REM already used, or simply late, and a person retyping needs that difference.
  for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\claim.out' -Raw | ConvertFrom-Json).error"\`) do echo     %%i
  del /q "%WORK%\\claim.out" 2>nul
  timeout /t 5 /nobreak >nul
  goto askcode
)
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\claim.out' -Raw | ConvertFrom-Json).token"\`) do set "CODE=%%i"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\claim.out' -Raw | ConvertFrom-Json).restaurant"\`) do set "WHERE=%%i"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "(Get-Content '%WORK%\\claim.out' -Raw | ConvertFrom-Json).name"\`) do set "MYNAME=%%i"
del /q "%WORK%\\claim.out" 2>nul
if "%CODE%"=="" (
  echo     The site answered oddly. Try again in a moment.
  timeout /t 6 /nobreak >nul
  goto askcode
)
>"%TOKENFILE%" echo %CODE%
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
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\\Aevidine Print Helper.lnk'); $s.TargetPath='%~f0'; $s.Arguments='/auto'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Description='Keeps this computer printing for Aevidine'; $s.Save()" >nul 2>&1

cls
echo.
echo   ================================================
echo      Aevidine  .  print helper
echo   ================================================
echo.
echo     Site       %SITE%
echo     Computer   %HOST%
echo     Version    __HELPER_VERSION__
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
  REM ── A REFUSED TOKEN CLEARS ITSELF (mig 380) ────────────────────────────────────────────
  REM It used to tell the person to go and delete a file inside %LOCALAPPDATA%, which is not a
  REM thing a restaurant does - so the real outcome was a machine that never printed again and
  REM nobody knowing why. The dead token goes, and somebody sitting here is asked for a fresh
  REM setup code. An auto-started copy has nobody to ask, so it steps aside for one that has.
  echo %DATE% %TIME%  this computer was unlinked on the site>>"%LOG%"
  del /q "%TOKENFILE%" 2>nul
  set "CODE="
  if /I "%~1"=="/auto" exit /b 0
  set /a TRIES=0
  goto askcode
)

REM ── HOW OFTEN THIS ASKS IS THE APP'S DECISION (2026-09-09) ───────────────────────────────────
REM See the long note in the mac branch. It can only ever slow DOWN: anything that is not a whole
REM number between 2000 and 60000 leaves this at the 2 seconds it used before, so a parsing quirk on
REM this operating system costs nothing.
REM
REM IT SITS HERE, not up in the setup, because it reads hello.out - which does not exist until the
REM answer above has landed. Placed earlier it would have read nothing, fallen back to 2s and looked
REM like it worked while ignoring the app for ever.
REM
REM EVERY LINE IS TOP LEVEL, on purpose. A %VAR% compared INSIDE the same parenthesised block that
REM SETS it is expanded when cmd.exe parses the block, so it can never be true - the fault that made
REM the PDF-printer check fail on every Windows machine.
set "IDLE=2"
for /f "usebackq tokens=*" %%i in (\`powershell -NoProfile -Command "try{[int]((Get-Content '%WORK%\\hello.out' -Raw | ConvertFrom-Json).pollMs)}catch{0}"\`) do set "PMS=%%i"
if "%PMS%"=="" set "PMS=0"
if %PMS% GEQ 2000 if %PMS% LEQ 60000 set /a IDLE=%PMS%/1000

:work
REM The app answers a BATCH - at most one job per printer - when asked with a max. An older app
REM ignores it and answers a single job; the reader below produces one line either way, so this file
REM works against both.
curl -s -m 20 "%SITE%/api/print-agent/next?max=4" -H "x-lfh-agent: %CODE%" > "%WORK%\\job.json" 2>nul
for %%A in ("%WORK%\\job.json") do if %%~zA LSS 5 goto idle
REM One "id,printer" line per job. A COMMA is a safe separator: the app strips commas, quotes,
REM backslashes and control characters out of every printer name it accepts, so one can never appear
REM inside the name and split the line in the wrong place.
powershell -NoProfile -Command "$j=Get-Content '%WORK%\\job.json' -Raw | ConvertFrom-Json; $list=if($j.jobs){$j.jobs}else{@($j)}; foreach($x in $list){ if($x.id){ '{0},{1}' -f $x.id,$x.printer } }" > "%WORK%\\batch.txt" 2>nul
for %%A in ("%WORK%\\batch.txt") do if %%~zA LSS 5 goto idle
del /q "%WORK%\\lane-*.done" 2>nul
set "LANES=0"
REM !LANES! and not %LANES% - a %VAR% read inside the same parenthesised block that SETS it is
REM expanded when cmd.exe PARSES the block, i.e. before the loop has run even once. That exact
REM mistake is why the PDF-printer check failed on every Windows machine once already.
for /f "usebackq tokens=1,* delims=," %%a in ("%WORK%\\batch.txt") do (
  set /a LANES=!LANES!+1
  REM CHROME and SUMATRA are PASSED IN, and that is not a nicety: the lane jumps to :lane before
  REM either of them is worked out, so a lane left to find them itself would have both empty and
  REM print nothing at all, silently. They are read here, outside this block, so %VAR% is right.
  start "" /b cmd /c call "%~f0" /lane "%%a" "%%b" "%CHROME%" "%SUMATRA%"
)
if %LANES%==0 goto idle
set "WAITED=0"
:waitlanes
timeout /t 1 /nobreak >nul
set "FINISHED=0"
for /f %%c in ('dir /b "%WORK%\\lane-*.done" 2^>nul ^| find /c /v ""') do set "FINISHED=%%c"
if %FINISHED% GEQ %LANES% goto work
set /a WAITED=%WAITED%+1
REM BOUNDED ON PURPOSE. If a lane dies without leaving its flag - killed, out of disk, a Chrome that
REM never returned - counting for ever would stop this computer printing anything again. Ninety
REM seconds is far past the ~20s a slow ticket takes, and going round again is harmless: the app
REM will not hand out a job it has already given to somebody.
if %WAITED% LSS 90 goto waitlanes
echo %DATE% %TIME%  a printing lane did not finish in 90s - carrying on>>"%LOG%"
goto work

:lane
REM ── ONE LANE: print exactly one job, then leave a flag and end ───────────────────────────────
REM Re-run of this same file with /lane <id> <printer>. It shares nothing with its siblings except
REM the folder, and every file it touches carries the job id - two lanes on one job.pdf would print
REM each other's paper, and two Chromes on one profile folder fight over its lock and one of them
REM silently writes nothing.
set "ID=%~2"
set "PRINTER=%~3"
set "CHROME=%~4"
set "SUMATRA=%~5"
REM No id means no flag can be named, so this one really does just end. Every OTHER way out goes to
REM :laneend, which writes the flag — a lane that leaves without one is a lane the parent waits the
REM full ninety seconds for, and that is a round of everybody's printing lost to one missing file.
if "%ID%"=="" exit /b
if not exist "%CHROME%" goto laneend
if not exist "%SUMATRA%" goto laneend
set /p CODE=<"%TOKENFILE%"
if "%CODE%"=="" goto laneend

set "JHTML=%WORK%\\job-%ID%.html"
set "JPDF=%WORK%\\job-%ID%.pdf"
set "JPROF=%WORK%\\chrome-%ID%"
del /q "%JHTML%" "%JPDF%" 2>nul
curl -s -m 30 -o "%JHTML%" "%SITE%/api/print-agent/job/%ID%/document" -H "x-lfh-agent: %CODE%" 2>nul
for %%A in ("%JHTML%") do if %%~zA LSS 20 (
  echo %DATE% %TIME%  job %ID%: the app had no document for it ^(already handled^)>>"%LOG%"
  goto laneend
)

REM Chrome's new headless mode does NOT exit after --print-to-pdf (measured on macOS 2026-08-20;
REM same engine here), so it is started with a 25-second leash and ended if it overstays. Waiting on
REM it plainly would hang the helper for ever after the first ticket.
powershell -NoProfile -Command "$a=@('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--user-data-dir=%JPROF%','--no-pdf-header-footer','--virtual-time-budget=4000','--print-to-pdf=%JPDF%','file:///%JHTML:\\=/%'); $p=Start-Process -FilePath '%CHROME%' -ArgumentList $a -PassThru -WindowStyle Hidden; if(-not $p.WaitForExit(25000)){ try{ $p.Kill() }catch{} }" >nul 2>&1
"%SUMATRA%" -print-to "%PRINTER%" -silent "%JPDF%" >nul 2>&1
if errorlevel 1 (
  curl -s -m 20 -X POST "%SITE%/api/print-agent/job/%ID%/failed" -H "x-lfh-agent: %CODE%" -H "content-type: application/json" -d "{\\"error\\":\\"could not print on %PRINTER%\\"}" >nul 2>&1
  echo %DATE% %TIME%  FAILED job %ID% on %PRINTER% - is it switched on, with paper?>>"%LOG%"
) else (
  curl -s -m 20 -X POST "%SITE%/api/print-agent/job/%ID%/done" -H "x-lfh-agent: %CODE%" -H "content-type: application/json" -d "{}" >nul 2>&1
  echo %DATE% %TIME%  printed job %ID% on %PRINTER%>>"%LOG%"
)

:laneend
REM THE FLAG IS THE LAST THING, AND IT IS WRITTEN WHATEVER HAPPENED. The parent counts these to know
REM the round is over; a lane that ended without leaving one would be waited on until the bound in
REM :waitlanes gives up. Named by the job id, so two lanes never write the same flag.
rmdir /s /q "%JPROF%" 2>nul
del /q "%JHTML%" "%JPDF%" 2>nul
echo done>"%WORK%\\lane-%ID%.done"
exit /b

:idle
timeout /t %IDLE% /nobreak >nul
goto work
`;

// ── Linux / Raspberry Pi ─────────────────────────────────────────────────────────────────────
const linux = (a: HelperScriptArgs) => `#!/bin/sh
# Aevidine print helper${a.label ? " — " + safe(a.label) : ""}
# ══════════════════════════════════════════════════════════════════════════════
#  THE ONE LINE YOU MAY CHANGE — and nothing else in this file.
#
#   SITE   the web address this helper talks to. Change it to point this same
#          file at a different site (a test site, a new address) without
#          remaking it. Keep the https:// and no trailing slash.
#
#  Everything below is machinery. If it stops working after an edit, the edit
#  is the reason.
# ══════════════════════════════════════════════════════════════════════════════
SITE="${safe(a.origin)}"
# Captured HERE, at the top level, for the same reason the Mac's is: a shell's \$0 inside a
# function cannot be trusted to be the script, and the start-up entry this writes is useless if it
# names the wrong file. (POSIX sh gets this right where zsh does not — they now read alike.)
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
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

# A VALUE GOING INTO JSON IS ESCAPED FIRST (T11, sweep #8, 2026-09-07).
# This file builds its printer list by hand, and interpolated $p and $desc straight into it. A
# printer whose CUPS model name contains a double quote — Brother \"QL\" Series — or a backslash
# made the whole list invalid JSON, so the server could not read this machine's printers at all:
# the admin's dropdowns came up empty for it and nothing anywhere said why. The Windows half was
# never exposed to this, because PowerShell's ConvertTo-Json escapes by construction; these two
# shell halves now agree with it.
jesc() { printf '%s' "\$1" | sed -e 's/\\\\/\\\\\\\\/g' -e 's/"/\\\\"/g'; }
printers_json() {
  first=1; out="["
  for p in $(lpstat -e 2>/dev/null); do
    # THE WHOLE MODEL NAME, not its first word (T11 sweep #8, 2026-09-04). This split the option
    # line on SPACES, so "Zijiang ZJ-80" arrived as "Zijiang" — measured against real CUPS. The
    # value is one quoted field, and the Mac branch above already reads it as one; the printer's
    # model is what a person picks from in the admin's dropdown, so half of it is worse than none.
    desc="$(lpoptions -p "$p" 2>/dev/null | sed -n "s/.*printer-make-and-model='\\([^']*\\)'.*/\\1/p" | head -1)"
    # ── AND THE PAPER IT IS LOADED WITH (T11 sweep #8, 2026-09-04) ────────────────────────────
    # This was the one platform that reported a printer's NAME and not its paper. It matters more
    # than it looks: a page that is a different size from the paper in the printer is what makes a
    # driver rotate a ticket or halve it (the fault the owner photographed on 2026-08-19), and with
    # no size reported a Raspberry Pi's printers had to have one pinned by hand per route — the
    # question "asking a restaurant to know its own millimetres" was already called the wrong one.
    # Linux is CUPS, exactly like the Mac: same lpoptions, same /etc/cups/ppd/<queue>.ppd layout,
    # so this is the Mac's own read, unchanged. PaperDimension is the WHOLE sheet, which is what a
    # page size must be; the ImageableArea beside it is the smaller area the head can reach.
    # Verified against this repo's own Mac CUPS on 2026-09-04: two real POS-80 queues reported
    # {"name":"X70MMY65MM","wMm":79.7,"hMm":64.2} — i.e. 226x182pt, the 80mm roll.
    media="$(lpoptions -p "$p" -l 2>/dev/null | sed -n 's/^PageSize[^:]*: //p' | tr ' ' '\\n' | sed -n 's/^\\*//p' | head -1)"
    w=""; h=""
    if [ -n "$media" ] && [ -f "/etc/cups/ppd/$p.ppd" ]; then
      dims="$(awk -v m="$media" '$0 ~ "^\\*PaperDimension "m"[/:]" { if (match($0, /"[0-9.]+ [0-9.]+"/)) { s=substr($0, RSTART+1, RLENGTH-2); split(s, a, " "); printf "%.1f %.1f", a[1]*25.4/72, a[2]*25.4/72; exit } }' "/etc/cups/ppd/$p.ppd")"
      w="\${dims%% *}"; h="\${dims##* }"
    fi
    [ $first -eq 0 ] && out="$out,"; first=0
    out="$out{\\"name\\":\\"$(jesc "$p")\\",\\"desc\\":\\"$(jesc "$desc")\\""
    [ -n "$w" ] && [ -n "$h" ] && out="$out,\\"paper\\":{\\"name\\":\\"$(jesc "$media")\\",\\"wMm\\":$w,\\"hMm\\":$h}"
    out="$out}"
  done
  echo "$out]"
}
say() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $1" >> "$LOG"; }
say "helper started, talking to $SITE"

# Starts itself at login, written by the helper rather than asked of a person (owner, 2026-08-27).
install_autostart() {
  # Runs from a copy in its own folder, like the Mac's. Linux has no TCC to work around, but the
  # other half of the reason holds everywhere: a file somebody was told to type out once gets moved,
  # renamed, or binned the moment it looks like it is working.
  run="$HOME_DIR/helper.sh"
  # Aside and moved into place, never over the top — see the Mac's note; cp onto a running script
  # makes the running shell read nonsense.
  if [ "$SELF" != "$run" ]; then
    cp -f "$SELF" "$run.new" 2>/dev/null && chmod +x "$run.new" 2>/dev/null && mv -f "$run.new" "$run" 2>/dev/null
    rm -f "$run.new" 2>/dev/null
  fi
  [ -x "$run" ] || run="$SELF"
  me="$run"                            # the path came from SELF, at the top, like the Mac's
  mkdir -p "$(dirname "$AUTOSTART")"
  # Written aside and only moved when it differs, like the Mac's — see the note there. Nothing on
  # Linux has to be reloaded, but a file rewritten on every start is a file that can be caught
  # half-written by whatever reads it next.
  printf '%s\\n' "[Desktop Entry]" "Type=Application" "Name=Aevidine print helper" \\
    "Exec=/bin/sh \\"$me\\" --auto" "X-GNOME-Autostart-enabled=true" "NoDisplay=true" > "$AUTOSTART.new"
  if cmp -s "$AUTOSTART.new" "$AUTOSTART" 2>/dev/null; then rm -f "$AUTOSTART.new"; else mv -f "$AUTOSTART.new" "$AUTOSTART" 2>/dev/null; fi
}

# ── LINKING: one setup code, typed once (mig 380) ─────────────────────────────────────────────
# No secret in this file, so ONE file works everywhere. On a Pi with no desktop this is the branch
# that matters most: the old flow needed a BROWSER on this machine, which a headless Pi does not
# have, so setting one up meant reading a URL off the screen onto a phone. Typing six characters
# needs nothing, and nobody signs in on this computer at all.
AUTO=0
[ "$1" = "--auto" ] && AUTO=1
tidy_code() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr -d '[:blank:]_-'; }

link_up() {
  if [ "$AUTO" = "1" ] || [ ! -t 0 ]; then
    say "not linked, and nobody can type here — run this file by hand to enter a setup code"
    return 1
  fi
  n=0
  while [ $n -lt 5 ]; do
    n=$((n+1))
    echo ""
    echo "  This computer is not set up to print yet.  (file __HELPER_VERSION__)"
    echo "  On the Aevidine Printing screen press \\"Show a setup code\\","
    echo "  then type the six characters here. It lasts ten minutes,"
    echo "  and nobody signs in on this computer."
    echo ""
    printf "  Setup code: "
    read typed || { say "no code was typed"; return 1; }
    tidied="$(tidy_code "$typed")"
    [ -z "$tidied" ] && continue
    answer="$(curl -s -m 25 -X POST "$SITE/api/print-agent/pair/claim" -H "content-type: application/json" \\
      -d "{\\"code\\":\\"$tidied\\",\\"helper\\":\\"__HELPER_VERSION__\\",\\"fingerprint\\":\\"$FP\\",\\"hostname\\":\\"$HOST\\",\\"os\\":\\"linux\\",\\"printers\\":$(printers_json)}")"
    if [ -z "$answer" ]; then echo "  Could not reach $SITE. Check this computer is online."; continue; fi
    case "$answer" in
      *'"ok":true'*)
        CODE="$(echo "$answer" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')"
        WHERE="$(echo "$answer" | sed -n 's/.*"restaurant":"\\([^"]*\\)".*/\\1/p')"
        [ -z "$CODE" ] && { echo "  The site answered oddly. Try again in a moment."; continue; }
        printf '%s' "$CODE" > "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE"
        install_autostart
        echo "  Linked to $WHERE. It will start again by itself at every login."
        return 0 ;;
      *)
        echo "  $(echo "$answer" | sed -n 's/.*"error":"\\([^"]*\\)".*/\\1/p')" ;;
    esac
  done
  echo "  That is five tries. Press \\"Show a setup code\\" again and run this when you have it."
  return 1
}

CODE=""
[ -f "$TOKEN_FILE" ] && CODE="$(cat "$TOKEN_FILE" 2>/dev/null)"
if [ -z "$CODE" ]; then
  link_up || { sleep 10; exit 1; }
else
  install_autostart
  echo "Linked. Waiting for something to print."
fi

while :; do
  # ── ONLY THE SITE SAYING "NO" COUNTS AS BEING UNLINKED (2026-09-13) ─────────────────────────
  # This used to treat ANY answer that was not ok:true as "this computer was unlinked" and
  # DELETE ITS OWN TOKEN. An empty answer does that. A timeout does that. A 502 while the site is
  # deploying does that. So a moment of bad wifi in a restaurant could unlink the shop's printer and
  # leave somebody needing a fresh setup code to get their printing back — from a blip that fixed
  # itself in two seconds.
  #
  # Seen for real on 2026-09-13: re-running the file corrupted the copy the running helper was
  # reading, its next answer came back garbled, and the helper threw its own token away.
  #
  # The HTTP code is read now, and only a 401 — the site's way of saying "that printing code is not
  # valid any more" — is believed. Everything else is a blip: the token is kept, and it asks again.
  HCODE="$(curl -s -m 20 -o "$WORK/hello.out" -w '%{http_code}' -X POST "$SITE/api/print-agent/hello" \\
    -H "x-lfh-agent: $CODE" -H "content-type: application/json" \\
    -d "{\\"fingerprint\\":\\"$FP\\",\\"printers\\":$(printers_json)}")"
  HELLO="$(cat "$WORK/hello.out" 2>/dev/null)"
  if [ "$HCODE" != "200" ] && [ "$HCODE" != "401" ]; then
    say "the site did not answer (HTTP \${HCODE:-none}) — keeping this computer's code and trying again"
    sleep 30; continue
  fi
  case "$HELLO" in
    *'"ok":true'*) : ;;
    # Self-healing, same as the Mac: the dead token goes, and a person sitting here is asked for a
    # fresh setup code instead of being told to delete a file in a hidden folder (mig 380).
    *) if [ "$HCODE" != "401" ]; then
         say "the site answered oddly but did not refuse this computer — keeping its code"
         sleep 30; continue
       fi
       rm -f "$TOKEN_FILE"; CODE=""
       echo "This computer was unlinked on the site."
       if link_up; then continue; fi
       # Same as the Mac: a copy with no token and nobody watching it must LET GO of the lock, or
       # it is the thing standing between this machine and being re-linked.
       say "stopping so somebody can run this file by hand and enter a setup code"
       exit 0 ;;
  esac

  # ── HOW OFTEN THIS ASKS IS THE APP'S DECISION, NOT THIS FILE'S (2026-09-09) ─────────────────
  # The server has always sent "pollMs" in this very answer and nothing had ever read it: one write
  # on the server, zero readers anywhere. So "every 2 seconds" was hard-coded into every copy of this
  # file, and slowing printing traffic down would have meant re-installing on every restaurant's
  # computer. At 2s one helper is ~43,000 requests a day; twenty restaurants is ~864,000, each one a
  # function call and a database read.
  #
  # IT CAN ONLY EVER SLOW DOWN. The value is accepted only when it is a whole number between 2,000
  # and 60,000 ms; anything else - missing, empty, garbled, an old server that sends nothing - falls
  # back to the 2 seconds this file used before. That is deliberate, and it is what makes this safe
  # to ship to an operating system nobody here can test on: the worst case is today's behaviour,
  # never a tighter loop. Nothing here can cost more than it already does.
  PMS="$(printf '%s' "$HELLO" | sed -n 's/.*"pollMs"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' | head -1)"
  case "$PMS" in ''|*[!0-9]*) PMS=2000 ;; esac
  [ "$PMS" -lt 2000 ] && PMS=2000
  [ "$PMS" -gt 60000 ] && PMS=60000
  IDLE=$(( PMS / 1000 ))

  # ── ONE LANE PER PRINTER — the same change as the Mac script (owner, 2026-09-14) ────────────
  # A batch is at most one job per distinct printer, so one background worker per job can never
  # collide with another, and the html/pdf pair and Chrome's profile directory are per-job because
  # two workers sharing either would print each other's paper. The long "why" is on the Mac copy.
  print_one() {
    ID="$1"; PRINTER="$2"
    HTML="$WORK/job-$ID.html"; PDF="$WORK/job-$ID.pdf"; rm -f "$HTML" "$PDF"
    curl -s -m 30 -o "$HTML" "$SITE/api/print-agent/job/$ID/document" -H "x-lfh-agent: $CODE"
    [ -s "$HTML" ] || { say "job $ID: no document (already handled)"; return; }
    # Same watchdog as the Mac: new-headless Chrome writes the PDF and then keeps running, so
    # waiting for it would hang the helper for ever after one ticket.
    "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$WORK/chrome-$ID" \\
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
    rm -rf "$WORK/chrome-$ID" "$HTML" "$PDF"
  }

  while :; do
    BATCH="$(curl -s -m 20 "$SITE/api/print-agent/next?max=4" -H "x-lfh-agent: $CODE")"
    [ -z "$BATCH" ] && break
    : > "$WORK/batch.txt"
    echo "$BATCH" | tr '{' '\\n' | while IFS= read -r CHUNK; do
      JID="$(printf '%s' "$CHUNK" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')"
      JPR="$(printf '%s' "$CHUNK" | sed -n 's/.*"printer":"\\([^"]*\\)".*/\\1/p')"
      [ -n "$JID" ] && printf '%s %s\\n' "$JID" "$JPR" >> "$WORK/batch.txt"
    done
    [ ! -s "$WORK/batch.txt" ] && break
    while read -r JID JPR; do
      [ -z "$JID" ] && continue
      print_one "$JID" "$JPR" &
    done < "$WORK/batch.txt"
    wait
  done
  sleep "$IDLE"
done
`;

/**
 * ── WHICH COPY OF THIS FILE IS THAT MACHINE RUNNING? (2026-09-13) ────────────────────────────
 *
 * THE FAULT THIS ENDS, and it cost the owner two rounds of the same photo. A caret bug was fixed
 * and shipped; he ran the file again and got the IDENTICAL error, because the copy on his Desktop
 * was still the old one. Nothing on his screen, in his screenshot, or on our board could tell an
 * old copy from a new one — the two fail the same way and look the same doing it. The server knew
 * something was wrong (his code was accepted at 15:43:20, a computer row was created, and it never
 * came back) and had no way to say what.
 *
 * So the file carries a stamp, and it is DERIVED FROM ITS OWN TEXT rather than typed by hand:
 * a version somebody has to remember to bump is a version that is wrong exactly when it matters.
 * Change one character of any branch below and its stamp changes by itself.
 *
 * The SITE line is masked out before hashing, so the same file has the same stamp on backup, on the
 * live site and on localhost — otherwise "is this the current file?" would have three answers.
 */
export function helperVersion(os: HelperOs): string {
  const body = os === "windows" ? windows({ origin: "X" }) : os === "linux" ? linux({ origin: "X" }) : mac({ origin: "X" });
  // …and the stamp itself is stripped before hashing, or inserting it would change what it is OF.
  const bare = body.replace(/^(SITE=|set "SITE=|echo\s+Version|  echo "    Version).*$/gm, "");
  return createHash("sha256").update(bare).digest("hex").slice(0, 7);
}

export function helperScript(os: HelperOs, a: HelperScriptArgs): string {
  const text = os === "windows" ? windows(a) : os === "linux" ? linux(a) : mac(a);
  return text.replace(/__HELPER_VERSION__/g, helperVersion(os));
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
