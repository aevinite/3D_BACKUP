# Sweep #9 · Terminal 34 — the money and compliance libraries · what was found

**Territory:** `docs/SAAS-EFFICIENCY-PLAYBOOK.md` · `lib/clash.ts` · `lib/dbRefusal.ts` ·
`lib/idempotency.ts` · `lib/idempotencyRule.ts` · `lib/paySplit.ts` · `lib/readGuard.ts` ·
`lib/tax.ts` · `lib/taxFiling.ts` — 2,046 lines.
**Ledger:** `.claude/sweep/LEDGER/T34-S9.md` (50 new rows, `P104901`–`P104950`) plus 203 existing
rows re-run in place across 11 ledger files.
**Re-run everything:** `npm run verify:t34`.

---

## The product itself is clean

**253 checks, 252 ✅, 1 ⏭, no product fault.** The money arithmetic in this territory agrees with
itself and with the paper everywhere it was asked:

- 3,000 randomly generated bills were put through the **real** `settleBillInParts` (against an
  in-memory stand-in for the database, so no row was written) and its recomputed due matched
  `LFH_BILLDOC.billMoney`'s printed total **to the paisa on every one**, across five tax profiles
  including composition scheme and a mixed-rate bill. Nobody had ever compared those two directly —
  that comparison is the whole reason `orderTaxRate` was moved into one file, and it had never been
  measured.
- `lib/tax.ts`, `public/panels/billdoc.js`'s `taxModel` and the installed
  `lfh_effective_tax_rate` still answer the same number on every shape tried, including a stored
  zero and the composition scheme.
- The owner's **Tax / GST** sheet, driven on a real production build, reconciles in both
  directions: ₹9,973 collected over ₹1,99,360 taxable at exactly 5.00%, split CGST ₹4,986.50 +
  SGST ₹4,986.50 = ₹9,973. Evidence:
  `.claude/sweep/shots/S9-T34/P27033-P27098-production-tax-gst-green.png`.

## The two problems were GUARDS, and both were red on clean `origin/main`

### 1 · `verify:t24-money-rules` read a COMMENT as two action codes (REGRESSION)

Red since **#1365**. The guard lists every action code the app can write by scanning the raw text of
`app/**` and `lib/**`, and one of its two ternary patterns also matches a ternary FIRST argument.
`/api/maintenance` now needs `logAction(s.admin ? "admin" : "manager", …)` so an admin's own flip
stays out of the owner's feed — **and the comment that explains that line spells the call out**, so
"admin" and "manager" were recorded as action codes with no screen and the guard refused.

Its sister guard `verify:audit` was given the `PANEL_NAMES` subtraction in the very commit that
introduced the shape (its comment says so); this copy was missed. Fixed the same way.
Sabotage-tested: with a genuinely homeless code present the guard still fails.
**Ledger row `P11654`. Guard: `verify:t24-money-rules`, now 239/239 green.**

### 2 · `verify:t24b`'s `P26984` was reading a list that had moved to another file

`RATE_LABELS` moved out of `lib/rateLimit.ts` into `lib/plainError.ts` on 2026-09-02 and is
re-exported, so nothing else noticed. The check still sliced the old file, got an empty string back
and failed — while the rule it asks about is **true**: all nine rate keys have a friendly name.
Repointed at the file the list actually lives in, and it now fails loudly if the map moves again
rather than passing on an empty slice. Sabotage-tested by removing one label.
**Ledger row `P26984`. Guard: `verify:t24b`, now 432/432 green.**

---

## Where the ledger was thinnest, and what was put there

Counted by subject across all 49 ledger files *before* any new check was written:

| file | rows before | rows added |
|---|---|---|
| `lib/readGuard.ts` | **0** | 18 |
| `docs/SAAS-EFFICIENCY-PLAYBOOK.md` | **0** | 6 |
| `lib/dbRefusal.ts` | **1** | 14 |
| `lib/idempotencyRule.ts` | 4 | 4 |
| `lib/paySplit.ts` | 51 | 5 (the settle-vs-paper comparison above) |
| `lib/clash.ts` | 45 | 3 |

## Two of the new checks passed WITH the fault present, and were rewritten

Thirteen of the fifty were sabotage-tested. `P104919` was being answered by the prose rule when the
SQLSTATE was deleted from the refusal list — it now asserts the code path and the prose path
separately. `P104940` matched a login cap widened from 50 to 5000 because the pattern had no `\b`.
Both were fixed before this file was written, and both now fail under the same sabotage.

## The one ⏭

`P14525` (T30) — the filing split still shows no order-level money, so it still owes no
shared-definition reference. Unchanged, and now re-runnable rather than re-judged by hand.

## A trap worth knowing: a cold dev worktree is not evidence for these rows

Seven of the 66 live rows (`P27033`–`P27098`) failed against a dev server in a fresh worktree. The
owner Reports screen there renders **unstyled** and never issues its data read at all, so every
figure on it is ₹0 while the API behind it answers ₹2.09 lakh. The same build on production is
perfect. Both screenshots are kept beside this file. Drive these rows against a production build.
