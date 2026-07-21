#!/bin/zsh
# Install the live-fix watcher: admin "Describe a problem" box → Terminal pops on this Mac.
# Run it once from Terminal, from anywhere:  zsh scripts/live-fix-watcher/install.sh
#
# It installs a COPY under ~/.claude/fix-request-watcher/ (outside ~/Documents, so launchd can
# run it WITHOUT the Full-Disk-Access grant) and loads a 60s launchd timer. Secrets are copied
# into that folder's .env (chmod 600) and are never printed.
set -eu

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$SELF_DIR/../.." && pwd)"
BASE="$HOME/.claude/fix-request-watcher"
PLIST="$HOME/Library/LaunchAgents/com.aevinite.live-fix-watcher.plist"
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"

[ -f "$PROJ/.env.local" ] || { echo "❌ $PROJ/.env.local not found"; exit 1; }

# Pull the two values we need without ever echoing them.
SB_URL="$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$PROJ/.env.local" | head -1 | cut -d= -f2- | tr -d '"' )"
SB_KEY="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$PROJ/.env.local" | head -1 | cut -d= -f2- | tr -d '"' )"
[ -n "$SB_URL" ] && [ -n "$SB_KEY" ] || { echo "❌ Supabase URL/key missing from .env.local"; exit 1; }

mkdir -p "$BASE/jobs"
cp "$SELF_DIR/watch.mjs" "$BASE/watch.mjs"
cp "$SELF_DIR/../live-fix-prompt.md" "$BASE/live-fix-prompt.md"

# The popped session must land in the OWNER's main project folder, never a worktree copy —
# worktrees are throwaway. If this install runs from a worktree, pin the canonical path.
case "$PROJ" in
  "$HOME/Documents/Projects/backup_Menu") : ;;
  *) PROJ="$HOME/Documents/Projects/backup_Menu" ;;
esac
umask 177
cat > "$BASE/.env" <<ENV
SUPABASE_URL=$SB_URL
SUPABASE_SERVICE_ROLE_KEY=$SB_KEY
PROJECT_DIR=$PROJ
CLAUDE_BIN=$HOME/.local/bin/claude
ENV
umask 022

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.aevinite.live-fix-watcher</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$BASE/watch.mjs</string>
    </array>
    <key>StartInterval</key><integer>60</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$BASE/watch.log</string>
    <key>StandardErrorPath</key><string>$BASE/watch.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✅ Live-fix watcher installed and running (checks every 60s)."
echo "   Turn off any time:  launchctl unload $PLIST"
