# SWEEP #9 — TERMINAL 21 of 40

**Your territory: The admin's Platform floor and Rate limits**

`app/aevinite/floor/**` (633), `app/aevinite/rate-limits/**`, `app/aevinite/staff-online/**`, `lib/rateLimit.ts`, `lib/liveBoard.ts`. Never trip the app's own limits while testing.

**The exact files you own** (re-derive this, do not trust the list):

```
app/aevinite/floor/page.tsx
app/aevinite/rate-limits/page.tsx
app/aevinite/staff-online/page.tsx
lib/liveBoard.ts
lib/rateLimit.ts
```

**Your ID block: `P103601` – `P103700`** — 100 ids, pre-allocated, yours alone.
**Your port:** 4421 — never 4000, that is the owner's own window.
**Your branch:** `sweep9/t21-admin-floor-and-limits`   ·   **Your worktree:** `../wt-s9-t21`

> **Your block is already reserved, so you NEVER need to claim ids from `LEDGER/INDEX.md`.**
> Sweep #7 recorded **six separate id collisions**, every one caused by a terminal reading a stale
> *Next free ID* line and two terminals claiming the same range; sweep #8 then had 3,005 rows overrun
> their reserved blocks. You have 100 ids for 50 checks. **Never read or edit that line. If you
> somehow exhaust your block, STOP and say so in your report — do not take someone else's range.**

---

## 0b — ABSOLUTE PATHS FOR EVERY FILE READ (keep the habit)

**Never combine `cd` with a file read that uses a relative path.** The root cause that stalled five
terminals in sweep #8 was fixed on 2026-09-05, but the habit costs nothing and the failure cost whole
runs:

- ❌ `cd /Users/aevinite/Documents/Projects/wt-s9-t21 && wc -l app/foo.tsx`
- ✅ `wc -l /Users/aevinite/Documents/Projects/wt-s9-t21/app/foo.tsx`
- ✅ `cd /Users/aevinite/Documents/Projects/wt-s9-t21 && npm run typecheck` — running a command is fine.

**Absolute paths for every `cat`, `head`, `tail`, `wc`, `grep`, `sed`, `find`.**

## 0 — READ THE RULES AND THE FORMAT FIRST

- **`.claude/sweep/S9-RULES.md`** — worktree discipline, what you must never touch, the
  shared-database limits, the wording discipline that will otherwise get this session killed, the
  fix-yes/improve-no split, and how your run ends.
- **`.claude/sweep/S9-REPORT-FORMAT.md`** — the owner's own report format. Not optional.
- **`CLAUDE.md`**, and the **Standing pre-empts** table in `.claude/sweep/LEDGER/INDEX.md` — a list
  of deliberate designs that look like faults. Eight sweeps have re-discovered them. Do not be the ninth.
- **`docs/REJECTED-IDEAS.md`** — before you list a single improvement, check he has not already said
  no to it. He has refused the same suggestion three times before. Every rejection also carries a
  `REJECTED (owner, <date>):` comment on the exact line someone would otherwise change.

## 1 — WHAT THIS RUN IS, AND WHAT IT IS NOT

Three sentences that decide everything you do:

1. **The re-run is the work. Fifty new checks is the extension.** The ledger holds **74,232 numbered
   checks across 44 files** (re-derive: `npm run verify:ledger-index`, which counts them live — `ROW-COUNTS.json` is a stale snapshot). Your first job is
   to re-run the ones covering **your** files. Only then do you write **50** new ones.
2. **You FIX problems. You do NOT build improvements.** His words for this run: *"They will do the
   fixes. They will not do the improvements. They will list that improvements."* An improvement goes
   in Part 4 of your chat report and nowhere else — not built, not committed, not started.
3. **Nothing is forced.** His words: *"if everything is okay, they don't have to force to get the
   thing, but they should have to check everything. And if there is problem, they have to list
   that's must."* Checking everything is mandatory. Finding something is not. **"This part is clean,
   and here are the rows that prove it" is a complete, respected result.**

**You plan your own checks.** Nobody hands you a checklist. You get the territory above and an ID
block, and you design the 50 yourself — because you are the one who will have read the code. Read
your files first, list what could genuinely be wrong, then write the checks. Mix the kinds:

- **Code-reading correctness** — follow the logic to where it gives a wrong result, fails silently,
  or can never run at all.
- **Project-rule conformance** — the `CLAUDE.md` rules that govern *your* area: scoped reads with a
  column list and a limit, clash coverage (`expect:`), idempotency, back-button registration,
  offline behaviour, a tap never vanishing in silence, the chart rules, floor invalidation, one bill
  document, one numbering series, no new column on `settings`.
- **Live observation, headless** — load the real page or route and check the **rendered** result
  (visible text, `count() > 0`, `offsetParent`), never "the source contains it". A green test is
  not evidence the screen is right.
- **Visual judgment** — screenshot it, then **look at it** like a picky human: nothing overlapping or
  cut off, readable in both skins, the right restaurant's branding, no leaked code text
  (`-->`, `${`, `undefined`, `NaN`, `[object Object]`), no lonely one-bar chart, no blank screen
  without an honest message. Desktop 1280px, the owner's phone (Samsung A35: 360×780, dpr3), tablet
  (iPad 1194×834).
- **Cross-panel truth** — trace by reading that a change reaches every panel that must show it, and
  no panel that must not.
- **Your own brain** — "is this how it *should* work for a real restaurant?" A thing can be
  technically correct and still wrong: a confusing label, a two-tap flow that should be one, a number
  a waiter would misread. Those are **improvements** unless a real person gets a wrong result — so
  they go in Part 4, listed, not built.

## 2 — BEFORE ANY NEW CHECK: RE-RUN WHAT ALREADY EXISTS

**Find your existing rows and re-run them first.** The ledger is keyed to older territory splits, so
no single file is "yours". Locate your rows like this:

```sh
grep -ln "<a distinctive file name you own>" /Users/aevinite/Documents/Projects/backup_Menu/.claude/sweep/LEDGER/T*.md
```

**The ledger files most likely to hold your rows: `T6.md` · `T1.md` · `T10.md` · `T11.md` · `T12.md` · `T13.md`.**

**Re-run every row in those files whose subject is a file YOU own.** Update each row's `result`
column in place, in the file where it lives. **Leave rows about files you do not own alone** —
another terminal is re-running those, and two terminals editing the same row is how three ledger
collisions have already happened.

- A row that was `✅` and is now `❌` is a **REGRESSION** — the most valuable thing this sweep can
  produce. Put it **first** in your report and **fix it first**. Name the id and the date it was
  last green.
- A row marked `✅ NOT a finding` or `✅ deliberate` exists **precisely so nobody files it again.**
- **Never reuse an id. Never renumber one.**

**Why this matters more than anything else you do:** sweeps #1–#5 each invented a *different* set of
checks, so five runs sampled five different slices and nothing converged. Sweeps #6–#8 built 74,232
permanent numbered checks to end that — and that investment returns **nothing** unless this run
re-executes the part that covers your files.

## 3 — THEN FIFTY NEW CHECKS, AIMED AT GROUND THE LEDGER DOES NOT STAND ON

Fifty, with ids from **`P103601`–`P103700`**. Do not write 500; do not write 20. Fifty, chosen —
not scattered. Pick them in this priority order:

1. **Files in your territory with no ledger row at all** (grep proves it). Section 2b above, if you
   have one, is first in this queue.
2. **Ground the existing rows read but never drove** — a row that says "the code does X" where
   nobody has ever loaded the screen and looked.
3. **What changed in your files since 2026-09-12** (`git -C /Users/aevinite/Documents/Projects/backup_Menu log --since=2026-09-12 --oneline -- <your files>`). New code is the least-checked code.
4. **The judgment checks** — the "should it work this way" ones your area deserves.

Write each row into the `LEDGER/T*.md` file where your territory's rows already live (or a clearly
named new one if your territory has none), in the same table shape the existing rows use. Mark each
`✅` / `❌` / `⏭` with a one-line result. **Never trust a count typed in a document** — re-derive
every inventory with the command, not the digit.

## 4 — THE OLDER SWEEPS' IMPROVEMENT IDEAS

Sweep #6 wrote ~178 improvement ideas into `.claude/sweep/T<n>-improvements.md` files **and the
owner never saw one of them** — which is why reporting now happens in chat. Those files are still on
disk. Read the ones covering your files (`grep -l` for your file names across
`/Users/aevinite/Documents/Projects/backup_Menu/.claude/sweep/T*-improvements.md`), then read the
code **as it is today**, and decide honestly for each: **ALREADY BUILT** (say what does it now and
where you saw it) · **STILL OPEN** (say why it is still worth doing) · **NO LONGER RELEVANT** (say
what changed). Sweeps #6–#8 shipped a great deal after those ideas were written — check, never assume.

That becomes **Part 3** of your report. Anything STILL OPEN is carried into **Part 4** with a full
numbered entry — never left as a one-liner.

## 5 — HOW YOU REPORT. THE FORMAT IS FIXED AND IT IS NOT OPTIONAL.

**Read `.claude/sweep/S9-REPORT-FORMAT.md` in full before you write one line of report.** It is the
owner's own format, standing since 2026-08-13: *"i loved this format whenever i asked for improvement
or problem make sure this format should be there idc where you write this rule"*.

**Everything goes in your CHAT WINDOW. Nothing goes in a file.** Do not create an improvements file,
do not append to one, do not put ideas in your findings file, your ledger, or your PR body. He reads
these terminal windows — that is the entire point.

**Four parts, ONE continuous numbering running through all of them** so he can reply "do 4 and 9":

| part | what is in it |
|---|---|
| 🔧 **PART 1 — problems I found and FIXED** | One commit each, number in the message. Regressions first. |
| ✅ **PART 2 — improvements I already MADE** | **EMPTY THIS RUN, by his instruction.** One line saying so. |
| 💡 **PART 3 — the old ideas, re-checked against today's code** | ALREADY BUILT / STILL OPEN / NO LONGER RELEVANT, one line each. |
| 🤔 **PART 4 — what needs HIS decision** | Every improvement you spotted, plus anything you chose not to fix. Grouped 🟢 *I can do these right now* · 🟡 *These need something from you first*. |

**Every item in every part carries these six lines:**

- **Where** — panel → exact screen or tab → **what he would SEE**. Never a file name in this line.
  "Backend only, nothing on screen" in exactly those words when there is no screen.
- **What it is** — plain words, no jargon in the first sentence.
- **If yes** — what actually changes for him.
- **If no** — what he lives with. **Say "nothing breaks" when that is true.**
- **Effort** — real minutes or hours ("already done — 20 min" for finished work).
- **Risk** — none / low / high, and what the risk actually is.

**End with your own recommendation** — which numbers are worth having, which you would skip, one
honest sentence each. He asked for judgment, not a menu.

Print a **running version every ~25 checks** so he can read you without waiting, and the full version
when you finish. Copy the skeleton in `S9-REPORT-FORMAT.md` literally.

**If you found nothing:** print the header counters, then "This part is clean — <x> ledger rows
re-run, 50 new checks, no problems found", then Parts 3 and 4. **Do not invent an item to fill
Part 1.**

## 6 — FIX THE PROBLEMS, IN YOUR OWN WORKTREE. BUILD NO IMPROVEMENTS.

When you find a real **problem** in your territory, **fix it**, then re-run the check until it is
green.

- **One commit per numbered item, with the number in the message.**
- **Every fix leaves a guard behind** — extend an existing `verify:*` or add one, and name it in
  your PR. A fix with nothing watching it comes back. A guard you leave red blocks **every** session
  in this folder through the repo's PostToolUse hook, so leave yours green.
- `npm run typecheck` must pass (`npm run lint` is bare ESLint and does **not** check types —
  separate, also-required gate).
- **An improvement is not yours to build this run.** Not "while I was in there", not "it was two
  lines". List it in Part 4 and move on. A new way that replaces an old one, a nicer label, a
  re-ordering, a tidy-up — all Part 4.
- **The one exception:** if fixing a problem *requires* a small change to how something works, that
  is part of the fix — say so plainly in the item's "What it is" line.
- Your run ends per §2 of `S9-RULES.md`: pushed PR → rebase on fresh `origin/main` → typecheck and
  your guards green → **merge your own PR**. You never deploy, you never take the deploy lock, you
  never force-push `main`.

## 7 — YOU ARE DONE WHEN

1. every existing ledger row covering a file you own has been re-run and its result updated in
   place, in the file where it lives;
2. your **50** new checks are planned, executed and recorded with ids from `P103601`–`P103700`;
3. every **problem** you found is fixed in your worktree, or recorded with an honest reason it is
   not — and **no improvement has been built**;
4. `npm run typecheck` passes and the `verify:*` guards touching your area are green;
5. your PR is pushed and merged by you per the rules — or left open with the reason stated;
6. **the full four-part report is printed in your chat**, in the shape of `S9-REPORT-FORMAT.md`.

Work straight through. Do not stop to ask permission for anything the rules already cover, and do not
stop early because the territory "looks clean" — prove it with the rows.
