#!/bin/zsh
# Install (or re-install) the three scheduled audit jobs.
#
# WHY THIS FILE EXISTS. There was no installer: the three plists were copied into
# ~/Library/LaunchAgents by hand, once, and then nobody could tell whether the copy on disk still
# matched the one in the repo. On 2026-08-05 all three turned out to be DEAD — launchd reported
# `last exit code = 78: EX_CONFIG` for the owner audit and had never run the other two — because
# their log paths pointed inside ~/Documents, which macOS TCC protects. launchd could not create
# the log file, so it never started the job at all. Nothing surfaced that: no report appeared in
# .claude/audits/, no error reached anyone, and only `launchctl list` knew.
#
# The sibling that works is the proof: com.aevinite.live-fix-watcher logs to ~/.claude/ and has run
# 3,800+ times at exit 0. So these three now log to ~/Library/Logs/aevidine/, which is not gated —
# and this script creates that directory, because launchd will create a log FILE but not its folder.
#
# THAT FIX WAS ONLY HALF OF IT (found 2026-08-06, T10 sweep). Moving the LOGS out let launchd start
# the job — and write the NEXT failure into the log it could finally create. All three then died on
# exit 127 every night with `zsh: can't open input file`, because the SCRIPT is still inside
# ~/Documents and /bin/zsh has no Full Disk Access either. The plists now start
# /opt/homebrew/bin/node (which does have it) via run-job.mjs; read that file for the measurements.
#
# AND THIS INSTALLER SAID "loaded" THROUGH ALL OF IT. `launchctl bootstrap` succeeding only means
# the job was REGISTERED. The readability check below ran as ME, in a shell that can see ~/Documents,
# so it passed while launchd could not. Both are now checked the way launchd will experience them:
# --verify actually runs each job once and reads its exit code (see `verify` below).
#
#   zsh scripts/launchagents/install.sh          # install / refresh all three, then verify
#   zsh scripts/launchagents/install.sh --status  # just say what is loaded and how it last exited
#   zsh scripts/launchagents/install.sh --verify  # start each job NOW and report its real exit code
#
# These jobs are NOT harmless background readers: each one starts the dev server on port 4000 and
# runs Claude headlessly with --dangerously-skip-permissions. Install them deliberately.
set -u

HERE="${0:A:h}"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/aevidine"
JOBS=(com.aevinite.owner-audit com.aevinite.tablet-audit com.aevinite.nightly-repair)
DOMAIN="gui/$(id -u)"

status() {
  for j in $JOBS; do
    # `local line` on its own line makes zsh echo the later assignment, which prints
    # `line=...` in among the report. Declare and assign in one statement.
    local line=$(launchctl print "$DOMAIN/$j" 2>/dev/null | grep -m1 "last exit code" | sed 's/^[[:space:]]*//')
    if [ -z "$line" ]; then
      printf "  %-34s not loaded\n" "$j"
    else
      printf "  %-34s %s\n" "$j" "$line"
    fi
  done
}

# CHEAP, DECISIVE CHECK — does launchd actually get to READ the script?
#
# `launchctl bootstrap` succeeding only proves the job is registered. The check further down that
# reads the script runs as ME, in a shell that can see ~/Documents, so it passed for weeks while
# launchd could not read a thing. The honest question can only be answered from inside launchd, so
# this loads a throwaway agent that runs run-job.mjs --selftest (a read and an exit — it starts no
# server and no Claude) and reads what it reported.
selftest() {
  # One `local` per line, and never referring to a sibling declared in the SAME statement: zsh does
  # not make it visible yet, and with `set -u` that aborts the function on its first line. The
  # `status()` helper above carries a note about a related zsh/`local` trap.
  local bad=0
  local probe="com.aevinite.install-selftest"
  local plist="$AGENTS/$probe.plist"
  local log="$LOGS/install-selftest.log"
  for j in $JOBS; do
    local sh=$(plutil -extract ProgramArguments.2 raw "$HERE/$j.plist" 2>/dev/null)
    local runner=$(plutil -extract ProgramArguments.1 raw "$HERE/$j.plist" 2>/dev/null)
    local bin=$(plutil -extract ProgramArguments.0 raw "$HERE/$j.plist" 2>/dev/null)
    : > "$log"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$probe</string>
  <key>ProgramArguments</key><array>
    <string>$bin</string><string>$runner</string><string>$sh</string><string>--selftest</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict></plist>
EOF
    launchctl bootout "$DOMAIN/$probe" 2>/dev/null
    launchctl bootstrap "$DOMAIN" "$plist" 2>/dev/null
    sleep 2
    launchctl bootout "$DOMAIN/$probe" 2>/dev/null
    if grep -q "SELFTEST OK" "$log" 2>/dev/null; then
      printf "  %-34s launchd CAN read its script\n" "$j"
    else
      printf "  %-34s launchd CANNOT read its script\n" "$j"
      sed 's/^/      /' "$log" 2>/dev/null | tail -6
      bad=1
    fi
  done
  rm -f "$plist" "$log"
  return $bad
}

# The heavy check: start each job for real and report the exit code launchd got. NOT run by default
# — each job takes port 4000 and runs Claude headlessly, so only ask for this when the machine is
# free. It also reads the tail of each .err.log, because the failure that hid for weeks was a
# single line in a file nobody opens.
verify() {
  local bad=0
  echo "Running each job once to see what launchd actually gets:"
  for j in $JOBS; do
    launchctl kickstart -k "$DOMAIN/$j" >/dev/null 2>&1 || { printf "  %-34s could not be started\n" "$j"; bad=1; continue; }
  done
  sleep 3
  for j in $JOBS; do
    local code=$(launchctl print "$DOMAIN/$j" 2>/dev/null | grep -m1 "last exit code" | sed 's/[^0-9]*//g')
    local log="$LOGS/${j#com.aevinite.}.err.log"
    [ -f "$log" ] || log=$(ls "$LOGS"/*.err.log 2>/dev/null | head -1)
    if [ "${code:-x}" = "0" ] || [ -z "${code:-}" ]; then
      printf "  %-34s ok (exit ${code:-still running})\n" "$j"
    else
      printf "  %-34s FAILED, exit %s\n" "$j" "$code"
      [ -r "$log" ] && sed 's/^/      /' "$log" | tail -3
      bad=1
    fi
  done
  if [ "$bad" != 0 ]; then
    echo
    echo "A job that exits 77 could not READ its script: that is macOS TCC on ~/Documents, not a"
    echo "file permission. ProgramArguments[0] must be /opt/homebrew/bin/node — see run-job.mjs."
    return 1
  fi
  echo "All three ran. Reports land in .claude/audits/."
  return 0
}

if [ "${1:-}" = "--status" ]; then
  echo "Scheduled audit jobs:"
  status
  echo
  echo "Logs: $LOGS"
  exit 0
fi

if [ "${1:-}" = "--verify" ]; then
  verify
  exit $?
fi

mkdir -p "$AGENTS" "$LOGS" || { echo "cannot create $AGENTS / $LOGS" >&2; exit 1; }

for j in $JOBS; do
  src="$HERE/$j.plist"
  [ -r "$src" ] || { echo "missing plist: $src" >&2; exit 1; }
  plutil -lint "$src" >/dev/null || { echo "$src is not a valid plist" >&2; exit 1; }

  # The binary and the script the job runs both have to exist, or launchd fails every morning in
  # silence — which is exactly what happened between 7 and 21 July, when the .sh file was not in
  # the checkout, and again until 2026-08-06 for a different reason.
  #
  # ProgramArguments[0] MUST be a binary with Full Disk Access, or nothing under ~/Documents is
  # readable at 6am no matter what these checks say. /bin/zsh does not have it; node does.
  bin=$(plutil -extract ProgramArguments.0 raw "$src" 2>/dev/null)
  [ -x "$bin" ] || { echo "$j names a binary that is not executable: $bin" >&2; exit 1; }
  case "$bin" in
    */node) ;;
    *) echo "$j starts $bin, not node. A LaunchAgent cannot read ~/Documents unless" >&2
       echo "  ProgramArguments[0] has Full Disk Access — see scripts/launchagents/run-job.mjs." >&2
       exit 1 ;;
  esac
  for i in 1 2; do
    prog=$(plutil -extract "ProgramArguments.$i" raw "$src" 2>/dev/null) || continue
    [ -r "$prog" ] || { echo "$j points at a file that is not readable: $prog" >&2; exit 1; }
  done

  launchctl bootout "$DOMAIN/$j" 2>/dev/null   # ignore "not loaded"
  cp "$src" "$AGENTS/$j.plist"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$j.plist" || { echo "failed to load $j" >&2; exit 1; }
  echo "loaded $j"
done

echo
echo "Now loaded:"
status
echo

# "loaded" is not "works". Prove the one thing that was silently false for weeks, before saying
# anything reassuring — this script printed three cheerful lines through all of it.
echo "Checking that launchd can really read each script:"
selftest || {
  echo
  echo "Installed but NOT working: launchd cannot read the scripts, so every run will die at once." >&2
  echo "ProgramArguments[0] needs Full Disk Access — see scripts/launchagents/run-job.mjs." >&2
  exit 1
}

echo
echo "Logs: $LOGS  ·  reports: .claude/audits/"
echo "Remove one with:  launchctl bootout $DOMAIN/<label>"
echo
echo "To prove one end-to-end (takes port 4000 and runs Claude — only when the machine is free):"
echo "  zsh scripts/launchagents/install.sh --verify"
