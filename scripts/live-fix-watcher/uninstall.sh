#!/bin/zsh
# Remove the live-fix watcher completely (timer + installed copy + stored secrets).
set -u
PLIST="$HOME/Library/LaunchAgents/com.aevinite.live-fix-watcher.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$HOME/.claude/fix-request-watcher"
echo "✅ Live-fix watcher removed."
