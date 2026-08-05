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
#   zsh scripts/launchagents/install.sh          # install / refresh all three
#   zsh scripts/launchagents/install.sh --status  # just say what is loaded and how it last exited
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

if [ "${1:-}" = "--status" ]; then
  echo "Scheduled audit jobs:"
  status
  echo
  echo "Logs: $LOGS"
  exit 0
fi

mkdir -p "$AGENTS" "$LOGS" || { echo "cannot create $AGENTS / $LOGS" >&2; exit 1; }

for j in $JOBS; do
  src="$HERE/$j.plist"
  [ -r "$src" ] || { echo "missing plist: $src" >&2; exit 1; }
  plutil -lint "$src" >/dev/null || { echo "$src is not a valid plist" >&2; exit 1; }

  # The script the job runs has to exist, or launchd fails every morning in silence — which is
  # exactly what happened between 7 and 21 July, when the .sh file was not in the checkout.
  prog=$(plutil -extract ProgramArguments.1 raw "$src" 2>/dev/null)
  [ -r "$prog" ] || { echo "$j points at a script that is not readable: $prog" >&2; exit 1; }

  launchctl bootout "$DOMAIN/$j" 2>/dev/null   # ignore "not loaded"
  cp "$src" "$AGENTS/$j.plist"
  launchctl bootstrap "$DOMAIN" "$AGENTS/$j.plist" || { echo "failed to load $j" >&2; exit 1; }
  echo "loaded $j"
done

echo
echo "Now loaded:"
status
echo
echo "Logs: $LOGS  ·  reports: .claude/audits/"
echo "Remove one with:  launchctl bootout $DOMAIN/<label>"
