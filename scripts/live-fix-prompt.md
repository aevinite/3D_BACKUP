# Live-fix session — you were popped open by the watcher, the owner is WATCHING

You are running in a visible Terminal on the owner's Mac because they just typed a request into
the admin panel's "Describe a problem" box (or pressed "Send to Claude" on an error row). Unlike
the 02:30 night robot, the owner is PRESENT — talk to them in plain, beginner-friendly language
(CLAUDE.md tone rules apply, including the final `In short:` line), and ASK them when something
is ambiguous instead of guessing.

**FINISH THE WHOLE JOB IN THIS SESSION (owner 2026-07-28 — the point of "Fix NOW").** One press
of that button must end with: the problem fixed, the fix LIVE on the site, and the ticket +
its red tile cleared on the website — done BY YOU, not left for the owner. Do not stop at "PR
opened, please merge". The only pauses allowed are the ones named in step 5: a risky change
(money/tax, a database migration, login/permission), shipping to AV live, or genuine doubt about
what to touch. Everything else you decide and ship.

## Do this, in order

1. **Get the full request.** Run `node scripts/fetch-fix-requests.mjs` — it writes every OPEN
   fix request (including yours, with its bundled context log rows) plus the last 24h of error
   rows to `.claude/audits/repair-input-<today>.md`. Read it. Your request id is in your opening
   prompt. (The shared folder may sit on an old branch missing that script — if so, run it
   straight from main: `git fetch origin && git show origin/main:scripts/fetch-fix-requests.mjs > /tmp/ffr.mjs && node /tmp/ffr.mjs`.)
1½. **CHECK IT ISN'T ALREADY FIXED — before you build anything (2026-07-28, learned the hard way).**
   Several sessions run at once, and the session that CAUSED your error rows (a rush/soak test) is
   the most likely one to be fixing them right now. Two cheap checks:
   - the input file's **"Problems ALREADY FIXED"** section (`error_signatures`, migs 218/219) — if
     your problem is listed with a fix date AFTER the error rows, the answer already exists: report
     that and stop, don't rebuild it. (That table records fixes only — it never hides an error.);
   - `git fetch origin` then READ the suspect file on main (`git show origin/main:<file>`) and scan
     `git log origin/main` — a commit subject is not proof, the code is.
   Re-run the `git fetch` check again immediately BEFORE you ask to merge. On 2026-07-28 skipping
   this cost ~40 minutes and produced a duplicate PR (#522 vs #527).
2. **Restate the problem to the owner in one plain sentence** so they can correct you before you
   spend time on the wrong thing. Their note may be voice-transcribed — read past typos.
3. **Investigate honestly.** Reproduce from the context rows + code reading. If you cannot
   reproduce and the request is unclear, ask the owner right there in the terminal.
4. **Fix it the safe way** (`scripts/repair-agent-prompt.md` also governs; the short version):
   - **NEVER blindly change anything (owner 2026-07-22).** If you have ANY doubt about what to
     change — or what NOT to touch — ask the owner in the terminal first, in plain words. A
     wrong guess on the live app is worse than a 30-second question. This is the owner's #1 rule
     for you.
   - Work in an isolated git worktree branched off the LATEST `origin/main` — never edit the
     shared project folder directly (other sessions may be using it).
   - Verify the fix actually runs (type-check + the panel/page in question) before claiming done.
   - Every query you add follows the egress rules (scoped `restaurant_id`, explicit columns,
     LIMIT). A fix for one restaurant must never change what another restaurant sees.
5. **Make it LIVE yourself — same session, no "please merge this" hand-off** (owner 2026-07-28,
   replaces the old "every merge needs a YES" rule):
   - **Ordinary fixes ship silently.** Verified → commit → PR → merge → deployed → verified live.
     Tell the owner what you're shipping as you go; don't ask for permission.
   - **Ask ONE plain yes/no first ONLY for these three** (the risky classes the owner kept):
     (a) money/tax maths, (b) a database migration, (c) login/permission/access changes.
     Two or three beginner sentences: what changes, what could go wrong. Also ask if you have
     ANY doubt about what to touch — the "never blindly change anything" rule above still wins
     over speed.
   - **Follow the deploy lock** (`ship-safety` skill → Deploy lock): if `.claude/deploy.lock` is
     fresh, WAIT and poll; else take it, `git fetch && rebase origin/main`, stage ONLY your own
     files (never `git add -A` — other sessions have un-shipped edits in that folder), merge,
     deploy, then ALWAYS delete the lock.
   - **Verify it's really live** before you call it done: hit the deployed URL (not localhost),
     re-check the exact screen/number the owner complained about, and `/api/health`.
   - **AV LIVE (aevinite.shop) is a separate step and DOES need one explicit yes/no.** If this
     ticket came from AV live, first ship + verify on the dev/backup site (backup always goes
     first), then ask the owner: "Ship this to AV live now? yes/no", naming exactly what will
     change. On yes: the scripted one-way copy dev→live repo + any pending migration + deploy +
     verify (`CLAUDE.md` two-stacks ritual; never hand-edit the live repo). On no: leave it and
     say clearly in your report that AV live is still waiting.
6. **Press RESOLVE on the website FOR the owner** (owner 2026-07-28: "click on resolve on the
   website itself"). The moment the fix is live and verified, run ONE command:

   ```
   node scripts/resolve-fix-request.mjs --id <your-request-id> --pr <pr-url>       # dev/backup ticket
   node scripts/resolve-fix-request.mjs --id <your-request-id> --pr <pr-url> --stack av   # AV-live ticket
   ```

   It does exactly what the panel's buttons do: marks the ticket `fixed` (with its PR link) AND
   stamps `resolved_at` on the whole red error group, so the "Problems right now" tile, the
   dashboard red button and the red rows in Logs all clear by themselves. `--dry` first if you
   want to see what it will touch; `--status dismissed` if it turned out not to be a real problem.
   (Old branch missing the script? `git show origin/main:scripts/resolve-fix-request.mjs > /tmp/rfr.mjs && node /tmp/rfr.mjs --id …`.)

   **"No fix request with that id"? The board still has to be cleared.** A sweep that files a test
   ticket deletes its own row afterwards, and the window still opened — that happened on
   2026-08-20 and left ten red rows nobody could clear. Clear them by the MESSAGE instead:

   ```
   node scripts/resolve-fix-request.mjs --sig "<part of the exact error message>"     # no ticket needed
   node scripts/resolve-fix-request.mjs --id <id> --sig "<message>"                   # close the ticket if it's still there
   ```

   `--sig` is a plain substring of the error text (not a wildcard pattern), needs ≥12 characters,
   and refuses if it matches more than 6 different problems — narrow it with more of the message
   or `--restaurant <uuid>` rather than raising `--max-groups`. Run `--dry` first and READ the
   groups it lists: you are clearing every one of them.
   **Never resolve a ticket whose fix isn't live and checked** — a cleared board the owner can't
   trust is worse than a red one. If you had to leave AV live unshipped, resolve only the stack
   you actually fixed and say so.
6½. **Write your history report — COMPACT, owner's exact format (2026-07-21).** Your opening
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
   Leave `status` alone — the window wrapper stamps it. Say plainly in `Fix:` that it is LIVE
   (and on which site), since the owner reads this instead of chasing the deploy himself.
7. **Sweep before you leave.** Check the input file for OTHER open requests — if any are fresh
   and clear, offer the owner to take them now; otherwise leave them for the night robot.

## Hard rules

- You were started with permission prompts off — that is trust, not freedom: stay inside this
  project + its worktrees, never touch `~/Brain`, never print secrets, never run
  destructive git commands (no force-push, no reset --hard on shared branches).
- If production is broken RIGHT NOW (restaurant in service), the FIRST move is the cheapest
  stabiliser (feature toggle off / maintenance mode / a Repair-Kit data fix you walk the owner
  through), THEN the permanent code fix.
