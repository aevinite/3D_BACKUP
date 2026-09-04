# Sweep #8 · Terminal 20 — the admin's Recycle bin, Billing & plans, Usage & cost

**Territory:** `app/aevinite/recycle/page.tsx` · `app/aevinite/billing/page.tsx` ·
`app/aevinite/usage/page.tsx` · `components/admin/RemovalDetail.tsx`
**Branch:** `sweep8/t20-admin-recycle-billing-usage` · **port:** 4320 · **ids:** `P73701`–`P74268`

## The record is the commits — read `git log` on this branch

Each numbered item is one commit, with the number in its subject and the whole story in its body,
so a single veto is clean. Five problems found and fixed (items 1–5), two improvements made
(items 6–7). Nothing is duplicated here, because a second copy of a finding is the copy that goes
stale.

| item | what was wrong |
|---|---|
| 1 | "Put this bill back" on a removal card could be a button that did nothing |
| 2 | On Billing, a payment that was NOT recorded looked exactly like one that was |
| 3 | Billing printed dates the way the database stores them (`2027-07-04`) |
| 4 | "Delete this payment record?" never said which payment |
| 5 | The recycle bin told the admin to close and reopen a row, and reopening did nothing |
| 6 | New guard: `npm run verify:bin-billing-usage` — 568 re-runnable checks |
| 7 | `verify:ledger-index` could not see two of the 32 ledger files (1,095 unprotected ids) |

## Re-run of what already existed

151 rows across nine ledger files. **148 still true · 0 regressions · 2 rewritten because they
defended a rule the owner deleted · 1 handed back** (its subject is another terminal's file).
One row flipped the good way: T12's `P20999` was ❌ and is green.

Full four-part report: printed in the terminal window, per `.claude/sweep/S8-REPORT-FORMAT.md`.
