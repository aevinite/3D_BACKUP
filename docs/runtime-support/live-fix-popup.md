# Live-fix pop-up — type in admin, a Claude terminal opens on your Mac

The night robot handles what can wait until 02:30. This piece handles **"I want it looked at
NOW"** — including things the app can't detect by itself: a bug nobody has tripped yet, a
suspicion ("bills feel wrong today"), or not-even-a-bug ("make this button bigger").

## How it works (the whole journey)

1. You open **admin → Repair → "Describe a problem"** and type anything in your own words
   (or press **Send to Claude** on a red error row in Logs).
2. A tiny checker on your Mac looks for new requests **once a minute** (one scoped, few-bytes
   read — nothing the egress budget will ever feel).
3. If your request is **fresh (under 30 minutes old)**, a **Terminal window pops open in front
   of you** with Claude already reading it and working — permission prompts off, as requested.
   Requests older than 30 minutes are left for the night robot instead (that's the split: fresh
   = you're at the Mac and want it live; old = overnight). Only one window at a time — a second
   request waits until the first session ends.
4. Because you're watching, Claude **asks you questions right there** when something's unclear —
   the night robot can't do that.
4½. When the session finishes, the window shows the result, **waits 5 minutes so you can read
   it, then closes itself** — no window pile-up.
5. Fixes ship the same safe way as always: side-copy of the code → verify → PR. Small safe fixes
   go live directly; anything money/database/login waits for your yes — and you're right there
   to give it.

## Turn it on (once, ~10 seconds)

```
zsh scripts/live-fix-watcher/install.sh
```

No Full-Disk-Access needed for THIS piece — it deliberately installs its checker outside
Documents. (The night robot still needs that grant — see nightly-agent-setup.md.)

Turn it off / remove completely:

```
zsh scripts/live-fix-watcher/uninstall.sh
```

## Honest trade-offs

- **Permissions are OFF in the popped session** (`--dangerously-skip-permissions`), per your
  explicit ask. The rulebook still forbids it from auto-merging money/database/login changes,
  and `main` stays PR-protected — but understand the deal: anyone who can log into YOUR admin
  panel can make text pop into a working Claude terminal on your Mac. Your admin login has the
  password + lockout protections, and this is your own machine — acceptable for the demo phase,
  worth revisiting before real customers.
- Each popped session **spends Claude usage credits** like any session you run by hand.
- The Mac must be on and unlocked for the pop-up; if it isn't, the request simply waits for the
  night robot — nothing is lost.
