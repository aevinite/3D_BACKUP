# Nightly repair agent — how it works + how to turn it on

Every night the agent reads the day's **Send-to-Claude** requests + errors, fixes each one on a
safe side-branch, verifies it, opens a PR, and (for small, safe, non-database, non-money fixes)
merges it — so you wake up to problems already fixed. Money/tax, database, or login changes are
left as a PR for your morning approval.

Pieces (all in the repo, so they can't go missing):
- `scripts/fetch-fix-requests.mjs` — gathers open requests + last-24h errors into a report file.
- `scripts/repair-agent-prompt.md` — the agent's instructions (incl. the auto-merge policy).
- `scripts/nightly-repair.sh` — runs at 02:30, does the whole thing, logs to `.claude/audits/`.
- `scripts/launchagents/com.aevinite.nightly-repair.plist` — the schedule.

---

## ⚠️ IMPORTANT: the nightly jobs need Full Disk Access (one-time, 1 minute)

The scheduler (launchd) runs these scripts in a locked-down context that macOS blocks from reading
anything under your **Documents** folder — where this project lives. **This is why your existing
owner + tablet audit jobs have silently failed since early July** (I proved it: the job gets
"Operation not permitted" even though the file is right there). The new repair job hits the same
wall until you fix it. It is NOT something code can fix — macOS requires you to grant it by hand:

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Click **+**, press **⌘⇧G**, type `/bin/zsh`, add it. Turn its switch ON.
   (This lets scheduled shell scripts read the project. `node`/`claude` run underneath zsh.)
3. That's it. This one grant also revives your owner + tablet audit jobs.

*(Alternative if you'd rather not grant zsh access: move the project out of `~/Documents`, e.g. to
`~/Projects`. Then no grant is needed. Bigger change — the Full Disk Access grant is simpler.)*

## Turn the repair agent on (after you've merged this feature + granted access above)

```
cp scripts/launchagents/com.aevinite.nightly-repair.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.aevinite.nightly-repair.plist
```

Turn it off any time:
```
launchctl unload ~/Library/LaunchAgents/com.aevinite.nightly-repair.plist
```

## Try it once by hand (optional)

```
zsh scripts/nightly-repair.sh
```
Then read the report it writes to `.claude/audits/repair-<today>.md`. (Run this from Terminal,
which already has disk access — the Full Disk Access grant above is only for the *scheduled* run.)

## Why it won't run wild

- It only ever touches requests in that night's input file; it never invents work.
- It works in an isolated throwaway git worktree off the latest `main`, verifies before claiming
  done, and only auto-merges small, safe, non-database/non-money/non-login fixes. Everything else
  waits for you. You can always turn it off with the unload command above.
