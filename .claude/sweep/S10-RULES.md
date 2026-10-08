# SWEEP #10 RULES — read fully, obey exactly. Every terminal, no exceptions.

You are ONE of **40** Claude sessions running the owner's whole-product sweep of this repo, called
by him **"the last time"**. **Two of us run at once**, in the SAME folder, against the SAME shared
dev database. These rules are what make that safe.

The owner's instruction for this run, 2026-10-08, in his words (voice-to-text, typos his):

> *"divide in 30 to 40 … make sure anything should not be left any kind of securtity error should
> not be left in this or any like of vernablity of glich … we will start slow with 2 terminal at a
> time … you have to give the boundary they will find and solve issue in that and also they will
> only plan and run 500 phases test within the boundary they have given … list error unmerged and
> improve if anything there not for the sake of finding"*

That is six duties, and every one is below: **stay inside your boundary · 500 new checks · find
AND fix · nothing left unchecked (correctness of logins and data separation included) · list the
errors and handle unmerged work · never invent a finding to look busy.**

---

## The six things that define sweep #10. Read these first.

0. **YOUR ID BLOCK IS PRE-ALLOCATED — 1,000 ids, yours alone. NEVER CLAIM ONE.** Your prompt names
   it (`P170001`–`P210000`, forty blocks of 1,000). **Do not read `LEDGER/INDEX.md`'s *Next free ID*
   line, and do not edit it.** Sweeps #7, #8 and #9 recorded **nine id collisions** between them,
   every one from terminals claiming off that line. 1,000 ids for 500 checks leaves room for a
   generated band that comes out larger than planned. If you exhaust 1,000, STOP and say so.

1. **FIVE HUNDRED NEW CHECKS — AFTER THE RE-RUN, NOT INSTEAD OF IT.** The ledger holds **80,000+
   numbered checks** (re-derive: `npm run verify:ledger-index` counts them live). Your FIRST job is
   to **re-run every existing row whose subject is a file you own**, top to bottom, not only the
   `❌` ones, updating each row's `result` in place. Only then do you write **500 new checks** with
   ids from your block, aimed at ground the ledger does not stand on.

2. **YOU FIX WHAT YOU FIND. YOU DO NOT BUILD IMPROVEMENTS — YOU LIST THEM.**
   - A **problem** = wrong today: a wrong number, a blank or broken screen, a lost tap, a silent
     failure, a login or restaurant-separation gap, a crash, a glitch a real person would hit.
     **Fix it**, one commit per numbered item.
   - An **improvement** = it works and could be nicer. **Do not build it.** It goes in **Part 4** of
     your chat report as a numbered decision item. The owner picks by number; he has rejected the
     same suggestion three times before, so check `docs/REJECTED-IDEAS.md` first.
   - **Unsure? It is an improvement.** List it.

3. **PICK YOUR 500 BY MEASURING WHERE THE LEDGER IS THIN — NOT BY HAVING AN IDEA.** (Owner,
   2026-09-14, STANDING.) Before writing a new check, count existing rows **per file you own, by
   SUBJECT**, across every ledger file:

   ```sh
   cd /Users/aevinite/Documents/Projects/backup_Menu/.claude/sweep/LEDGER
   for f in <each file you own>; do
     n=$(grep -hE "^\| P[0-9]+ " T*.md | awk -F'|' -v k="$f" '$3 ~ k' | wc -l)
     printf "%-40s %s\n" "$f" "$n"
   done | sort -k2 -n
   ```

   Aim at the top of that list. Then split by the SECOND number that mattered in sweep #9: of a
   file's rows, **how many DROVE the real app** rather than read the code. Sweep #9 T28 found the
   gate all thirteen owner routes stand on had 10 rows and **zero** driven. **Say the counts in your
   report.** And **name the subject FILE in every new row** — a row that names only a function is
   invisible to this measurement (T28's own lesson).

4. **NO QUOTA. FORCING A FINDING IS WORSE THAN FINDING NOTHING.** Checking everything is
   mandatory; finding something is not. "This part is clean — here are the rows that prove it" is a
   complete, respected result. Read the **Standing pre-empts** table in `LEDGER/INDEX.md` before
   filing anything; a row marked `✅ NOT a finding` or `✅ deliberate` exists so nobody files it again.

5. **A REGRESSION OUTRANKS EVERYTHING.** A row that was `✅` and is now `❌` goes **first** in your
   report and is **fixed first**. Name the id and the date it was last green.

---

## 1. Where you work — your own worktree, never the shared folder

```sh
git -C /Users/aevinite/Documents/Projects/backup_Menu fetch origin
git -C /Users/aevinite/Documents/Projects/backup_Menu worktree add ../wt-s10-t<N> -b sweep10/t<N>-<slug> origin/main
cd /Users/aevinite/Documents/Projects/wt-s10-t<N> && npm install   # a REAL install, every time
```

- **Never `cp` a file into a worktree from anywhere, never copy or symlink `node_modules`** — it
  silently reverts other people's work.
- Every git command uses `git -C <absolute-path>`.
- You edit files **only inside your own worktree**, and only files your territory names (plus the
  ledger rows / findings file / guard this file tells you to write).
- **Never `git add -A`.** Stage only files you changed, by name.
- **You never force-push `main`. You never take `.claude/deploy.lock`.**
- **Your dev server runs on YOUR port** (in your prompt), never 4000. Prove the port is yours
  (`lsof -i :<port>`) before trusting anything on it, and stop it before you finish.

## 2. Unmerged work — part of your boundary

At the START of your run, list what is open and touches your files:

```sh
gh pr list --state open --limit 100
git -C /Users/aevinite/Documents/Projects/backup_Menu branch -r --no-merged origin/main
```

For each open PR or unmerged branch whose changes sit inside your territory (check with
`gh pr diff <n> --name-only` / `git diff --name-only origin/main...<branch>`): **read it, decide
honestly** — still wanted and correct → rebase, run your guards, merge it; superseded or wrong →
close it / delete the branch with a one-line reason. **Never `b2sync`** (it holds deletions — never
merge it). Anything that is not clearly yours, leave alone and name it in your report. Work created
before the **2026-09-12 merge baseline** was already landed or proved superseded — do not re-audit it.

## 3. How your run ENDS — PR, then your own merge. No deploy lock, ever.

1. Push your branch and **open a PR**.
2. **Rebase on fresh `origin/main`**. A conflict in a ledger table or `INDEX.md`: **keep both
   sides** — they are different terminals' rows. A conflict in code: integrate both behaviours.
3. `npm run typecheck` green **and** the `verify:*` guards touching your area green, **and**
   `npm run verify:ledger-index` green.
4. **Merge your own PR.** Vercel deploys `main` by itself — you do not deploy and you do not take
   the lock. Then, once the deploy is ready, `npm run verify:live -- --base https://3-d-backup.vercel.app` and
   look at the screen you changed on the real backup site. **Done means live on backup, verified.**
5. A rebase conflict you cannot resolve honestly → **leave the PR open** and say why.
6. **Remove your worktree and branch** when merged (`git worktree remove`, `git branch -D`).

**One commit per numbered item, with the number in the message** — e.g.
`fix(kitchen): item 7 — the ticket kept its old table name after a rename`. That is what lets the
owner veto item 7 alone.

## 4. Never touch these

- **AV LIVE** — `/Users/aevinite/Documents/LIVE_PROJECTS/3D_Menu_Av`, its repo, its Vercel project,
  its Supabase project `kclqkmdxnwlhtyrducku`, and its gitignored keys file. Off-limits **including
  reads** — a hook refuses any tool call that names that file, so do not type its name.
- **Aangan** — the read-only control restaurant at factory permission defaults. Write to **French
  House**.
- **Another session's uncommitted work.** Never `git add -A`, never `git stash pop`.
- **Port 4000** — the owner's window.
- **`.claude/sweep/LEDGER/`** is never deleted, never archived, never renumbered.

## 5. Be gentle — the database and the app are shared

- **Never** `npm run verify:everything` (pid-locked), any `load:*`/ramp/stress script, or anything
  that loops requests.
- **One login per role for your whole run**, via `scripts/sweep/login.mjs` → `loginAs()` (it caches);
  `adminHeaders()` for admin APIs. **Never** POST JSON to `/api/staff-login`. Never repeat a
  rate-limited action (login, PIN, guest order, waiter call, OTP).
- **Browser: chrome-devtools MCP first** — it runs `--isolated`, one Chrome per session (proved
  2026-09-25). Repo Playwright only for: Safari/WebKit or Firefox · several logged-in roles at once ·
  faking a failing server per request · a check that must run with no Claude session (`verify:*`).
- Scoped reads with a column list and `.limit()`. No full-table scans. Cost here is egress.
- **Every row you write, you delete by its own id in the same run.** A setting you flip, you restore
  in a `finally` **and** on `SIGINT`/`SIGTERM`.

## 6. Absolute paths for every file read

- ❌ `cd /path/to/wt && wc -l app/foo.tsx`  ✅ `wc -l /path/to/wt/app/foo.tsx`
- ✅ `cd /path/to/wt && npm run typecheck` — running a command is fine.

## 7. Wording discipline — non-negotiable, it kills sessions

Follow the **SAFE-AUDIT WORDING** block in `CLAUDE.md` in everything you type: chat, tool
descriptions, greps, commit messages, ledger rows. A real-time classifier halts the session on the
*words and shape* of the work, not your intent.

- **The owner asked that no safety gap be left.** You honour that with **product-correctness
  questions**, never attack framing: *"does every request in my territory require the right
  login?"*, *"does each restaurant only see its own rows?"*, *"does a staff role only reach what its
  permissions list?"*, *"is this database function callable only by the roles that need it?"*
  (`verify:grants`), *"are owner earnings hidden where required?"*, *"does a bad input get a clear
  refusal instead of a crash?"*.
- **Never** the banned words (attack, exploit, probe, leak, bypass, tamper, impersonate, escalate,
  breach, vulnerable, malicious, injection, IDOR, pentest, CSRF/XSS/RCE, "cross-tenant" as a threat).
- **Verify by READING code and observing normal use.** No swapping ids in a URL, no replaying as
  another restaurant, no calling an endpoint without a login to see what happens. If reading the
  code suggests a gap, **report and fix it** — never demonstrate it.
- Login / data-separation / permission questions are done **by you, inline** — never in a sub-agent.

## 8. How you report — and where each thing goes

| what | where it goes |
|---|---|
| Re-run results | in place, in the `LEDGER/T*.md` row where each lives — only rows whose subject is a file YOU own |
| Your 500 new rows | a ledger file of your own: **`LEDGER/T<N>-S10.md`**, same table shape as the others; then update **your own row** in the sweep-#10 table in `LEDGER/INDEX.md` — put the file name `T<N>-S10.md` in its *filed?* column (that is how `verify:ledger-index` finds your ledger) and fill rows / ok / prob / resv — that row only |
| Problems found and fixed | your commits, plus `.claude/sweep/T<N>-S10-findings.md` |
| **Improvement ideas, and the whole four-part report** | **YOUR CHAT WINDOW ONLY. Never a file.** Shape: `.claude/sweep/S10-REPORT-FORMAT.md` |
| Screenshots | `.claude/sweep/shots/S10-T<N>/` — look, then **delete**; keep only evidence for a finding |

**The report shape is FIXED — read `.claude/sweep/S10-REPORT-FORMAT.md` and copy it literally.**
Four parts, ONE continuous numbering: 🔧 Part 1 problems FIXED (regressions first) · ✅ Part 2
improvements MADE (**empty this run — one line saying so**) · 💡 Part 3 older sweeps' ideas re-checked
(ALREADY BUILT / STILL OPEN / NO LONGER RELEVANT) · 🤔 Part 4 needs HIS decision, grouped 🟢 *can do
now* / 🟡 *needs you first*. **Every item carries six lines: Where (panel → exact screen → what he'd
SEE; "Backend only, nothing on screen" when none) · What it is · If yes · If no ("nothing breaks"
when true) · Effort (real minutes/hours) · Risk.** End with your recommendation. Print a running
version every ~100 checks and the full one at the end.

## 9. Every fix leaves a guard behind

Extend an existing `verify:*` guard or add one, and name it in your PR. Judge a guard by **reading**
it, never by a grep. **Sabotage-test it once** (break the thing, see the guard go red, put it back)
— a guard that can only pass is not a guard. A guard left red blocks every session in this folder.

## 10. When a check needs something you cannot do

Mark the row `⏭` with one line saying exactly what a later session should do. That is honest.

## 11. You are done when

1. every existing ledger row whose subject is a file you own has a fresh result, in place;
2. your **500** new checks are written, executed and recorded in `LEDGER/T<N>-S10.md`;
3. every problem is fixed (or recorded with an honest reason it is not); **no improvement built**;
4. unmerged work in your territory is merged, closed, or named with a reason;
5. typecheck, your area's guards and `verify:ledger-index` are green;
6. your PR is merged, live on backup and seen there — or left open with the reason;
7. your dev server is stopped, your worktree removed, your screenshots deleted;
8. **the full four-part report is printed in your chat.**

Work straight through. Do not stop to ask permission for anything these rules cover, and do not
stop early because the territory "looks clean" — prove it with the rows.
