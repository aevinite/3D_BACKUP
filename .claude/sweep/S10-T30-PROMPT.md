# SWEEP #10 — TERMINAL 30 of 40 · wave 2 (running beside terminal 9)

**Your territory — your BOUNDARY: The money and compliance libraries**

*every rupee: tax, split payments, discounts, idempotency, first-save-wins, refusals.*

**The exact files you own** (computed against every tracked file today — 0 unowned, 0 owned twice):

```
docs/BUSINESS-LOGIC-AUDIT.md
docs/CANCEL-AND-LOSS-SPEC.md
docs/COMPLIANCE-GUARDRAILS.md
docs/SAAS-EFFICIENCY-PLAYBOOK.md
lib/clash.ts
lib/clashCompare.ts
lib/dbRefusal.ts
lib/discountCap.ts
lib/idempotency.ts
lib/idempotencyRule.ts
lib/money.mjs
lib/money.test.mjs
lib/money.ts
lib/paySplit.ts
lib/payments.ts
lib/readGuard.ts
lib/tax.ts
lib/taxFiling.ts
tests/money.test.mjs
tests/order-totals.e2e.mjs
```

## The law, the scars, and the false alarms in YOUR territory

- **Billing compliance (CGST §132 — the PetPooja raids):** nothing may erase, hide or edit an issued sale, bulk-delete bills, disable the audit log or hide sales from the Z-report. A sale can be cancelled; never disappear. Read `docs/COMPLIANCE-GUARDRAILS.md` before touching anything.
- Tax = one source of truth; discount before tax, grossed at the rate charged; split payment = mark paid; a money box must accept its own numbers; rounding down on a float drops a paisa.
- `lib/clash.ts`: first save wins, loser told; `node scripts/verify-clash-coverage.mjs` green. Idempotency keys on every money write.

**Your ID block: `P199001` – `P200000`** — 1,000 ids, pre-allocated, yours alone, for **500 new checks**.
**Your port:** 4430 — never 4000, that is the owner's own window.
**Your branch:** `sweep10/t30-money-and-compliance`   ·   **Your worktree:** `/Users/aevinite/Documents/Projects/wt-s10-t30`
**Your new ledger file:** `.claude/sweep/LEDGER/T30-S10.md`   ·   **Your findings file:** `.claude/sweep/T30-S10-findings.md`

> **Stay inside your boundary.** Terminal 9 is running at the same time on a different
> territory, and 38 more follow. A problem you spot OUTSIDE your territory: one line in Part 4
> naming the screen, and leave it — its owner will meet it. **Never read or edit the *Next free ID*
> line in `LEDGER/INDEX.md`** — your block is above; nine collisions came from that line.

---

## 0 — READ THESE FIRST, IN THIS ORDER

1. **`.claude/sweep/S10-RULES.md`** — in full. Worktree discipline, the never-touch list, the shared
   database limits, the wording rules that will otherwise get this session killed, fix-yes /
   improve-list-only, unmerged work, and how your run ends.
2. **`.claude/sweep/S10-REPORT-FORMAT.md`** — the owner's own report format. Not optional.
3. **`CLAUDE.md`** (auto-loaded) — especially the SAFE-AUDIT WORDING block — and the **Standing
   pre-empts** table in `.claude/sweep/LEDGER/INDEX.md`: deliberate designs that look like faults.
4. **`docs/REJECTED-IDEAS.md`** — before you list one improvement. He has refused the same idea
   three times before; every rejection also sits as a `REJECTED (owner, <date>):` code comment.

Then set up your worktree exactly as `S10-RULES.md` §1 says. Every file read uses an absolute path.

## 1 — WHAT THIS RUN IS

The owner called this sweep **"the last time"**: *"make sure anything should not be left any kind of
securtity error should not be left … or any like of … glich"*. So:

1. **Re-run first, then 500 new checks.** The ledger's existing rows on your files are re-run top to
   bottom before a single new id is written. Then **500** new checks, planned by you, inside your
   boundary, aimed by measurement (§3).
2. **FIX every problem. LIST every improvement.** A problem is fixed in your worktree, one commit per
   numbered item, and leaves a guard behind. An improvement goes in Part 4 of your chat report —
   never built. Unsure → it is an improvement.
3. **Nothing is forced.** Checking everything is mandatory; finding something is not. *"This part is
   clean, here are the rows that prove it"* is a complete result. He said it himself: improve only
   *"if anything there, not for the sake of finding"*.

**This territory map is NEW.** The owner asked for it on 2026-10-08: *"create new, don't follow old
data … make sure everything should be covered"*. It was cut fresh from today's 1,658 tracked files —
every file owned exactly once, none twice — and it does NOT match any earlier sweep's split. So:

- **No old result is trusted.** An old `✅` in the ledger is a claim, not a fact, until YOU re-prove
  it on today's code. That is why the re-run in §2 comes first.
- **No old plan is copied.** Your 500 new checks are designed by you, today, from reading your own
  files — not lifted from an earlier phase list.
- The old ledger and old findings files are used for ONE purpose: to find what used to work, so a
  break shows up as a regression.

## 1b — CORRECTNESS OF LOGINS AND DATA SEPARATION IS PART OF YOUR TERRITORY

He asked that no safety gap be left. You answer that **only in product-correctness language, only by
reading code and observing normal use, and only inline (never in a sub-agent)** — see `S10-RULES.md`
§7. For every screen, route, function or script in your boundary, ask and record:

- Does every request here require the right login before it touches data? (`/aevinite` + all
  `/api/admin/*` → `tokenIsValid` before any DB call · panel APIs → `requireRole()` · `/api/owner/*`
  → `ownerScope()` · anything public must be on the deliberately-public list in
  `docs/CLAUDE-DETAIL.md` → Security gate.)
- Does each restaurant only see and change its own rows (`restaurant_id` on every query, RLS
  enforcing it in the database, the restaurant taken from the session — never from the request)?
- Does a staff role reach only what its permission list grants (`lib/accessTree.ts`, `lib/staffCaps.ts`;
  hiding a button is never the only guard)?
- Is every new Postgres function limited to the roles that need it (REVOKE/GRANT, `verify:grants`)?
- Does a bad or missing input get a clear refusal, not a crash or a silent wrong write?
- Are secrets never sent to a browser, never logged, never printed?

If the code suggests a gap: **fix it and leave a guard**. Never demonstrate it.

## 2 — BEFORE ANY NEW CHECK: RE-RUN WHAT ALREADY EXISTS

> **Re-run every row in your ledger FIRST — all of them, top to bottom, not only the ❌ ones —
> and update each row's `result` in place. A row that was ✅ before and is ❌ now is a
> regression, and it is the most valuable thing you can find. Only when every existing row has
> a fresh result may you add new IDs, and only for ground the ledger does not cover. Your ids come
> from your pre-allocated block `P199001`–`P200000` — never from the *Next free ID* line. Never reuse an
> ID. Never renumber anyone else's.**

The ledger is keyed to older territory splits, so no single file is "yours". Find your rows by
SUBJECT across every ledger file:

```sh
grep -ln "<a distinctive file name you own>" /Users/aevinite/Documents/Projects/backup_Menu/.claude/sweep/LEDGER/T*.md
```

**Earlier sweeps cut the product differently, so your rows are spread across many ledger files — grep ALL of them (`T*.md`, `T*-S8*.md`, `T*-S9*.md`, `T*-R2.md`), one distinctive file name at a time.**

Re-run every row whose subject is a file **you** own; leave the rest alone (another terminal owns
them). Six ledgers are GENERATED by a guard script (`npm run verify:ledger-index` names them) —
re-run those by running their script, not by hand.


## 3 — THEN 500 NEW CHECKS, AIMED WHERE THE LEDGER IS THIN

Ids from **`P199001`–`P200000`**, written to **`.claude/sweep/LEDGER/T30-S10.md`** (same table shape as
the other ledgers, with the subject FILE named in every row). Plan them yourself — you are the one
who will have read the code — in this priority order:

1. **Section 2b** above, if you have one: nobody has checked it once.
2. **Files with the fewest rows by subject** (the measuring loop in `S10-RULES.md` rule 3), and the
   files whose rows only ever READ the code and never DROVE the real app.
3. **What changed in your files since the last sweep touched them:**
   `git -C /Users/aevinite/Documents/Projects/backup_Menu log --since=2026-09-01 --oneline -- <your files>` —
   new code is the least-checked code.
4. **The states the happy path never visits:** the feature switched OFF, a failed or slow read,
   offline, two devices at once (first save wins, loser told — `lib/clash.ts`), an empty
   restaurant, a busy one, a second restaurant (French House written to, Aangan read-only), keyboard
   only, the back button inside every popup.
5. **The judgment checks** — "is this how a real restaurant needs it to work?". A confusing label or a
   two-tap flow that should be one is an improvement (Part 4), not a problem.

Mix the kinds: code-reading correctness · project-rule conformance (the rules in `CLAUDE.md` that
govern your area) · live observation on YOUR port (the RENDERED result, never "the source contains
it") · visual judgment — screenshot and LOOK at desktop 1280, Samsung A35 360×780 dpr3, iPad
1194×834, both skins: nothing cut off or overlapping, no `undefined` / `NaN` / `[object Object]` /
`${`, the right restaurant's branding · cross-panel truth (a change reaches every panel that must
show it, and none that must not, realtime included) · logins and data separation (§1b).

Mark each `✅` / `❌` / `⏭` with a one-line result. **Never trust a count typed in a document** —
re-derive every inventory with the command, not the digit.

## 4 — THE OLDER SWEEPS' IMPROVEMENT IDEAS

`.claude/sweep/T*-improvements.md` files still hold ideas the owner never saw. `grep -l` your file
names across them, read the code **as it is today**, and decide each: **ALREADY BUILT** (what does it
now, where you saw it) · **STILL OPEN** (why still worth it) · **NO LONGER RELEVANT** (what changed).
That is **Part 3**. Every STILL OPEN one gets a full numbered entry in Part 4.

## 5 — HOW YOU REPORT. THE FORMAT IS FIXED.

**Read `.claude/sweep/S10-REPORT-FORMAT.md` in full and copy its skeleton literally.** Everything goes
in your **CHAT WINDOW** — never an improvements file, never the PR body. He reads these windows.

```
════════════ TERMINAL 30 of 40 — <territory in four words> ════════════
Ledger rows re-run: <x> of <y>   ·   regressions found: <n>
New checks written: <x> of 500   ·   problems found: <n>   ·   fixed: <n>
Unmerged work in my boundary: <handled / none>
──────────────────────────────────────────────────────────────────────────
🔧 PART 1 — PROBLEMS I FOUND AND FIXED        (regressions first; one commit each)
✅ PART 2 — IMPROVEMENTS I ALREADY MADE        NONE — this run fixes problems and LISTS improvements
💡 PART 3 — OLDER SWEEPS' IDEAS, RE-CHECKED   ALREADY BUILT / STILL OPEN / NO LONGER RELEVANT
🤔 PART 4 — THINGS THAT NEED YOUR DECISION    🟢 I can do these right now · 🟡 These need you first
⭐ MY RECOMMENDATION                          the numbers worth having, the ones to skip, and why
```

**One continuous numbering across all four parts.** **Every item carries six lines:**

- **Where** — panel → exact screen or tab → **what he would SEE**. Never a file name here.
  "Backend only, nothing on screen" in exactly those words when there is no screen.
- **What it is** — plain words, no jargon in the first sentence (give the real term after, then
  explain it — he is learning the vocabulary).
- **If yes** — what changes for him.
- **If no** — what he lives with. **"Nothing breaks"** when that is true.
- **Effort** — real minutes or hours ("already done — 20 min" for finished work).
- **Risk** — none / low / high, and what the risk actually is.

Print a **running version every ~100 checks**, the full version at the end. If you found nothing:
the header counters, then *"This part is clean — <x> ledger rows re-run, 500 new checks, no
problems found"*, then Parts 3 and 4. **Never invent an item to fill Part 1.**

## 6 — FIX THE PROBLEMS, IN YOUR OWN WORKTREE

- One commit per numbered item, number in the message.
- **Every fix leaves a guard behind** (extend a `verify:*` or add one; sabotage-test it once; name it
  in the PR). A guard left red blocks every session in this folder.
- `npm run typecheck` must pass (`npm run lint` does NOT check types — separate gate).
- If a fix *requires* a small change to how something works, that is part of the fix — say so in the
  item's "What it is" line. Anything beyond that is an improvement: Part 4.
- Touching billing → read `docs/COMPLIANCE-GUARDRAILS.md` first: a sale can be cancelled, never
  disappear. Touching the floor → every write calls `invalidateFloor(rid)`. Touching 3D loading →
  `node scripts/verify-cache.mjs`. New migration → `node scripts/run-migration.mjs <one file>` on the
  DEV database only, REVOKE/GRANT for staff-only functions, `lfh_already_applied` around data rewrites.

## 7 — YOU ARE DONE WHEN

1. every existing ledger row whose subject is a file you own has a fresh result, in place;
2. your **500** new checks are written, run and recorded in `LEDGER/T30-S10.md`, and **your own row**
   in the sweep-#10 table of `LEDGER/INDEX.md` is filled in;
3. every problem is fixed (or recorded with an honest reason it is not) — **no improvement built**;
4. unmerged work inside your boundary is merged, closed, or named with a reason;
5. typecheck, your area's guards and `verify:ledger-index` are green;
6. your PR is merged by you, live on backup and seen there — or left open with the reason;
7. your dev server is stopped, worktree removed, branch deleted, screenshots deleted;
8. **the full four-part report is printed in your chat.**

Work straight through. Do not stop to ask permission for anything the rules already cover, and do not
stop early because the territory "looks clean" — prove it with the rows.
