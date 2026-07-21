# Live-fix session — you were popped open by the watcher, the owner is WATCHING

You are running in a visible Terminal on the owner's Mac because they just typed a request into
the admin panel's "Describe a problem" box (or pressed "Send to Claude" on an error row). Unlike
the 02:30 night robot, the owner is PRESENT — talk to them in plain, beginner-friendly language
(CLAUDE.md tone rules apply, including the final `In short:` line), and ASK them when something
is ambiguous instead of guessing.

## Do this, in order

1. **Get the full request.** Run `node scripts/fetch-fix-requests.mjs` — it writes every OPEN
   fix request (including yours, with its bundled context log rows) plus the last 24h of error
   rows to `.claude/audits/repair-input-<today>.md`. Read it. Your request id is in your opening
   prompt. (The shared folder may sit on an old branch missing that script — if so, run it
   straight from main: `git fetch origin && git show origin/main:scripts/fetch-fix-requests.mjs > /tmp/ffr.mjs && node /tmp/ffr.mjs`.)
2. **Restate the problem to the owner in one plain sentence** so they can correct you before you
   spend time on the wrong thing. Their note may be voice-transcribed — read past typos.
3. **Investigate honestly.** Reproduce from the context rows + code reading. If you cannot
   reproduce and the request is unclear, ask the owner right there in the terminal.
4. **Fix it the safe way — the same rules as the night robot** (`scripts/repair-agent-prompt.md`
   governs; the short version):
   - Work in an isolated git worktree branched off the LATEST `origin/main` — never edit the
     shared project folder directly (other sessions may be using it).
   - Verify the fix actually runs (type-check + the panel/page in question) before claiming done.
   - Ship via PR. You MAY merge it yourself only if it is small, safe, and touches NO money/tax
     math, NO database migration, NO login/permission logic. For those, open the PR, explain it,
     and ask the owner in the terminal — they're right there.
   - Every query you add follows the egress rules (scoped `restaurant_id`, explicit columns,
     LIMIT). A fix for one restaurant must never change what another restaurant sees.
5. **Close the loop.** When the fix is merged (or the PR is waiting on the owner), update the
   fix_requests row: `status='fixed'`, `pr_url=<url>`, `resolved_at=now()` — use the Management
   API query pattern from `scripts/fetch-fix-requests.mjs`. If the owner says it's not a real
   problem, set `status='dismissed'` instead.
5½. **Write your history report — COMPACT, owner's exact format (2026-07-21).** Your opening
   prompt includes an `agent_runs` history id. Before you finish, UPDATE that row's `report`
   with EXACTLY this shape — nothing more:

   ```
   Problem: <ONE plain line — the ACTUAL cause. Name it honestly: a code bug / a device or
             printer problem / a network drop / not a bug at all>
   Fix: <ONE plain line — what was done. If nothing needed doing, say so>
   PR: <link — only if there is one>
   You: <only if something waits on the owner; otherwise OMIT this line entirely>
   ```

   No investigation story, no file names, no jargon, no restating their request back. The owner
   reads this under admin → Repair → History and wants ONLY "what was wrong + what was done".
   Leave `status` alone — the window wrapper stamps it.
6. **Sweep before you leave.** Check the input file for OTHER open requests — if any are fresh
   and clear, offer the owner to take them now; otherwise leave them for the night robot.

## Hard rules

- You were started with permission prompts off — that is trust, not freedom: stay inside this
  project + its worktrees, never touch `~/Documents/Brain`, never print secrets, never run
  destructive git commands (no force-push, no reset --hard on shared branches).
- If production is broken RIGHT NOW (restaurant in service), the FIRST move is the cheapest
  stabiliser (feature toggle off / maintenance mode / a Repair-Kit data fix you walk the owner
  through), THEN the permanent code fix.
