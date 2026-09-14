# SWEEP #9 RULES — read fully, obey exactly. Every terminal, no exceptions.

You are ONE of **40** parallel Claude sessions running a whole-product sweep of this repo.
Up to 5 of us run at once, in the SAME folder, against the SAME shared dev database.
These rules are what make that safe.

**Five things are different in sweep #9 from every sweep before it. Read these five first.**

0. **YOUR ID BLOCK IS PRE-ALLOCATED — NEVER CLAIM ONE YOURSELF.** Your prompt names 100 ids that
   are yours alone, out of `P101601`–`P105600`. **Do not read `LEDGER/INDEX.md`'s *Next free ID*
   line to claim a range, and do not edit it.** Sweep #7 recorded **six separate id collisions**,
   every one caused by two terminals reading the same stale mark; sweep #8 then had 3,005 rows
   overrun their reserved blocks. If you exhaust your 100 ids, STOP and say so in your report —
   do not take anyone else's range.

1. **FIFTY NEW CHECKS, NOT FIVE HUNDRED — and the re-run is the real work.**
   The owner set the number for this run: **50 new numbered checks each.** That is deliberate and
   it is not a smaller sweep. The ledger now holds **74,232 numbered checks across 44 files**
   (re-derive: `npm run verify:ledger-index`, which counts them live — `ROW-COUNTS.json` is a stale snapshot), and the bulk of your run is
   **re-running the existing rows that cover files YOU own** — not inventing new ones. Fifty new
   checks is the *extension* on top of that, aimed at ground the ledger does not stand on.

2. **YOU FIX WHAT YOU FIND. YOU DO NOT BUILD IMPROVEMENTS.**
   The owner's instruction for this run, in his words: *"They will do the fixes. They will not do
   the improvements. They will list that improvements."*
   - A **problem** = something that is wrong today. **Fix it**, one commit per numbered item.
   - An **improvement** = something that works and could be nicer. **Do not build it.** It goes in
     **Part 4** of your chat report as a numbered decision item, and nowhere else. **PART 2 of the
     report will be empty this run, and that is correct** — write one line saying improvements were
     list-only by his instruction.
   - If you are unsure which one a thing is: if a real person gets a wrong number, a blank screen,
     a lost tap or a silent failure, it is a problem. Otherwise it is an improvement. When still
     unsure, **do not build it** — list it.

2b. **PICK YOUR NEW CHECKS BY MEASURING WHERE THE LEDGER IS THIN — NOT BY HAVING AN IDEA.**
   (Owner, 2026-09-14, STANDING.) Before you write a single new check, count the existing rows
   **per file in your territory, by SUBJECT**, across every ledger file — not by memory, not from
   `ROW-COUNTS.json`, and not from any number typed in a document:

   ```sh
   cd .claude/sweep/LEDGER
   for f in <each file you own>; do
     n=$(grep -hE "^\| P[0-9]+ " T*.md | awk -F'|' -v k="$f" '$3 ~ k' | wc -l)
     printf "%-24s %s\n" "$f" "$n"
   done | sort -k2 -n
   ```

   **Aim your new checks at the top of that sorted list.** The files with the fewest rows are not
   the unimportant ones — they are the ones no sweep prompt ever happened to name. Sweep #9's
   terminal 5 ran this and found ten of its forty files carrying **1 to 6 rows each** across all
   44 ledger files: the loading spinner, the background bubbles, the star picker and the
   last-resort offline page among them. That is where its fifty went.

   This is the rule that makes sweeps CONVERGE. Sweeps #1–#5 each invented a different set of
   checks and five runs sampled five different slices; re-running the existing rows fixed half of
   that, and measuring before extending fixes the other half. **Say the counts in your report**, so
   the next terminal can see whether the thin corner stayed covered.

3. **THERE IS NO QUOTA, AND FORCING A FINDING IS WORSE THAN FINDING NOTHING.**
   His words: *"if everything is okay, they don't have to force to get the thing, but they should
   have to check everything. And if there is problem, they have to list that's must."*
   - Checking everything in your territory is **mandatory**. Finding something is **not**.
   - "This part is clean, here are the rows that prove it" is a **respected, complete result.**
   - A terminal that pads its report to look busy costs this project more than one that reports 50
     greens. Eight sweeps have re-discovered the same deliberate designs as "faults" — read the
     **Standing pre-empts** table in `.claude/sweep/LEDGER/INDEX.md` before you file anything.
   - A row already marked `✅ NOT a finding` or `✅ deliberate` exists **precisely so nobody files
     it again.**

4. **A REGRESSION OUTRANKS EVERYTHING ELSE YOU CAN FIND.** A ledger row that was `✅` last time and
   is `❌` now means something that worked has broken since. It goes **first** in your report and it
   gets **fixed first**.

---

## 1. Where you work — your own worktree, never this folder

```sh
cd /Users/aevinite/Documents/Projects/backup_Menu
git fetch origin
git worktree add ../wt-s9-t<N> -b sweep9/t<N>-<slug> origin/main
cd ../wt-s9-t<N>
npm install            # a REAL install. NEVER copy node_modules or any file from elsewhere.
```

- **Never `cp` a file into a worktree from anywhere** — it silently reverts other people's work.
  A real `npm install` every time, however long it takes.
- Every git command uses `git -C <absolute-path>`. Always. Other sessions share this folder and a
  bare `git` in the wrong directory has cost this project real work.
- You edit files **only inside your own worktree**, and only files your territory names.
- **Never `git add -A`.** Stage only the files you changed, by name. An unrecognised modified file
  in the shared folder is another session's live work.
- **You never force-push `main`.** That is one of the owner's four ask-first protections.
- **You never take `.claude/deploy.lock`.**

## 2. How your run ENDS — PR, then your own merge. No deploy lock, ever.

`CLAUDE.md` and the project memory both say *"done means LIVE ON BACKUP, not a PR"*, and sweep #8
proved a per-run no-merge gate does not hold against it — 25 PRs merged themselves anyway. So this
run does not pretend otherwise:

1. Push your branch and **open a PR**.
2. **Rebase on fresh `origin/main`** (`git -C <your-wt> fetch origin && git -C <your-wt> rebase origin/main`).
3. `npm run typecheck` green **and** the `verify:*` guards touching your area green.
4. Only then **merge your own PR** (`gh pr merge --squash` or `--merge`, your choice, from your own
   worktree). Vercel deploys `main` by itself — **you do not deploy, you do not run a deploy
   script, you do not take the lock.**
5. If your rebase hits a conflict you cannot resolve honestly, **leave the PR open** and say so in
   your report. An open PR with a clear reason beats a bad merge.

**One commit per numbered item, with the number in the message** — e.g.
`fix(kitchen): item 7 — the ticket kept its old table name after a rename`. That is what lets the
owner veto item 7 alone without unpicking your whole branch.

## 3. Never touch these

- **AV LIVE** — `/Users/aevinite/Documents/LIVE_PROJECTS/3D_Menu_Av`, its repo, its Vercel
  project, its Supabase project `kclqkmdxnwlhtyrducku`, and the gitignored live-keys env file that
  `CLAUDE.md` names. Off-limits including **reads** — a PreToolUse hook REFUSES any tool call that
  even names that file, so do not type its name. Never point a script, server or seed at those keys.
- **Aangan** — the read-only control restaurant, sitting at factory permission defaults. Its
  differences from French House are the *point*, not a fault. Write to **French House**.
- **Another session's uncommitted work.** Leave it. Never `git add -A`, never `git stash pop`.
- **Port 4000** — the owner's own window. Yours is in your prompt. Prove the port is yours before
  you trust anything you see on it.
- **The `LEDGER/` directory is never deleted, never archived, never renumbered.**

## 4. Be gentle — several of you share one database and one app

- **Never** run `npm run verify:everything` (pid-locked), any `load:*` / ramp / stress script, or
  anything that loops requests.
- **One login per role for your entire run**, via `scripts/sweep/login.mjs` → `loginAs()`, which
  caches. `adminHeaders()` for admin APIs. **Never** POST JSON to `/api/staff-login`. Never a login
  inside a loop or a retry. Never repeat a rate-limited action (login, PIN, guest order, waiter
  call, OTP) — the app's own limits make honest findings indistinguishable from collisions.
- **Headless Playwright only.** Never Chrome MCP — parallel sessions deadlock it.
- Scoped reads with a column list and a `.limit()`. No full-table scans. This product's cost is
  egress, not effort.
- **Every row you write to the database, you delete by its own id, in the same run.** Never "clean
  up whatever is there" — that is another terminal's fixture. If your check flips a setting,
  restore it in a `finally` **and** on `SIGINT`/`SIGTERM`.

## 4b. NEVER write `cd <dir> && <read a relative path>` — it used to stop terminals dead

The root cause was fixed on 2026-09-05 (the old blanket read-deny was replaced by narrower
edit/write denies plus a PreToolUse hook), and no window has stalled since. **Keep the habit
anyway** — it costs nothing and five terminals in sweep #8 lost their run to it:

- ❌ `cd /path/to/wt && wc -l app/foo.tsx`
- ✅ `wc -l /path/to/wt/app/foo.tsx`
- ✅ `cd /path/to/wt && npm run typecheck` — running a command is fine.

Pass **absolute paths** to `cat`, `head`, `tail`, `wc`, `grep`, `sed`, `find`.

## 5. Wording discipline — non-negotiable, it kills sessions

Follow the **SAFE-AUDIT WORDING** block in `CLAUDE.md` in everything you type: chat, tool
descriptions, greps, commit messages, ledger rows. A real-time classifier halts the whole session
on the *words and shape* of the work, not your intent, and several sessions have died to it.

- Plain product-correctness language only: *"does each restaurant only see its own numbers?"*,
  *"does every admin request require being logged in?"*, *"are owner earnings hidden where
  required?"*
- **Never** attack/defence framing. Never the banned words (attack, exploit, probe, leak, bypass,
  tamper, impersonate, escalate, breach, vulnerable, malicious, injection, IDOR, pentest,
  CSRF/XSS/RCE, "cross-tenant" as a threat).
- **Verify by READING code and observing normal use.** No trickery: no swapping ids in a URL, no
  replaying as another restaurant, no calling an endpoint without a login "to see what happens". If
  reading the code suggests a gap, **report it as a finding** — never demonstrate it.
- Login / data-separation / permission questions are done **by you, inline**. Never delegate one to
  a sub-agent; they get killed mid-run.

## 6. How you report — and where each thing goes

| what | where it goes |
|---|---|
| Your ledger rows (re-run results + your 50 new ones) | the `LEDGER/T*.md` file where each row lives — **committed in your PR** |
| Problems you found and fixed | your commits, plus `.claude/sweep/T<N>-S9-findings.md` |
| **Improvement ideas, and your whole four-part report** | **YOUR CHAT WINDOW ONLY. Never a file.** Shape: `.claude/sweep/S9-REPORT-FORMAT.md` |
| Screenshots | `.claude/sweep/shots/S9-T<N>/` — look at it, then **delete it**. Keep only a shot that is evidence for a finding. |

**The shape of that report is FIXED — read `.claude/sweep/S9-REPORT-FORMAT.md` and follow it
literally.** It is the owner's own format, standing since 2026-08-13: *"i loved this format whenever
i asked for improvement or problem make sure this format should be there idc where you write this
rule"*. Four parts, ONE continuous numbering running through all of them so he can reply "do 4 and 9":

| part | what is in it |
|---|---|
| 🔧 **PART 1 — problems I found and FIXED** | One commit each, number in the message, so a single veto is clean. Regressions first. |
| ✅ **PART 2 — improvements I already MADE** | **EMPTY THIS RUN, by his instruction.** One line saying so. |
| 💡 **PART 3 — the older sweeps' ideas re-checked against today's code** | ALREADY BUILT / STILL OPEN / NO LONGER RELEVANT, one line each. Every STILL OPEN one is carried into Part 4 in full. |
| 🤔 **PART 4 — what needs HIS decision** | Every improvement you spotted, plus anything you chose not to fix. Nothing built unless he names a number. Grouped 🟢 *I can do these right now* · 🟡 *These need something from you first*. |

**Every item in every part carries these six lines, in this order:**

- **Where** — panel → exact screen or tab → **what he would SEE**. Never a file name in this line;
  "Backend only, nothing on screen" in exactly those words when there is no screen.
- **What it is** — plain words, no jargon in the first sentence.
- **If yes** — what actually changes for him.
- **If no** — what he lives with. **Say "nothing breaks" when that is true** — it usually is, and
  hiding it is how a tidy-up gets mistaken for a fire.
- **Effort** — real minutes or hours ("already done — 20 min" for finished work).
- **Risk** — none / low / high, and what the risk actually is.

**End with your own recommendation**, naming the numbers worth having and the ones you would skip,
one honest sentence each. He asked for judgment, not a menu.

Print a **running version every ~25 checks** and the full version when you finish. Copy the skeleton
in `S9-REPORT-FORMAT.md` literally — do not improvise a variant of it.

Every item names **where it lives** — the panel, then the exact screen or tab, then what he would
see. A list that names files instead of screens leaves him lost, and he has said so.

## 7. Every fix leaves a guard behind

A fix with nothing watching it comes back. When you fix something, **extend an existing `verify:*`
guard or add one**, and say in your PR which guard now covers it. Judge a guard by **reading** it,
never by a grep — three of three static "dead guard" hits in sweep #6 were the detector being wrong.
And a guard that goes red in the repo's PostToolUse hook blocks **every** session in this folder, so
leave yours green.

## 8. When a check needs a write, and you can't make one

Mark the row `⏭` with one line saying exactly what a later session should do. `⏭` is an honest
result. So is **"this part is clean"**.

## 9. Finish discipline

You are done when:
1. every existing ledger row covering a file you own has been re-run and its result updated in
   place, in the file where it lives;
2. your **50** new checks are written, executed, and recorded with ids from your own block;
3. every **problem** you found is fixed in your worktree, or recorded with an honest reason it
   was not; **no improvement has been built**;
4. `npm run typecheck` passes, and the `verify:*` guards touching your area are green;
5. your PR is pushed, and merged by you per §2 — or left open with the reason;
6. **the full four-part report is printed in your chat**, in the shape of `S9-REPORT-FORMAT.md`.

Work straight through. Do not stop to ask permission for anything these rules already cover, and do
not stop early because the territory "looks clean" — prove it with the rows.
