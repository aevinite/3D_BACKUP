# Was the food actually made? — cancellation, real loss, and audit tags

**Owner, 2026-08-18.** His words:

> "when the order or kot is remove it will move in audit section and from audit section you can
> trasnfer the thing as cancelling and while kot delete button there will be one thing order was mode
> and order was not made like in red they have to choose if made then it will show as cancelling and
> the inventory deducted and the cancelinging amout go up expensis goes up and all in audit it will
> noted like loss or anything make tags for all kind of audit and stuff"

---

## 1. The idea, in one line

A cancelled order is two completely different events wearing one name: **food that was never cooked**
(no cost — correct the record and move on) and **food that was cooked and thrown away** (a real cost —
the ingredients are gone). The software has never asked which, so it has never been able to tell the
truth about either.

## 2. What the code does TODAY — measured, not assumed

| step | what happens now | is it right? |
|---|---|---|
| order fires to the kitchen | `trg_inv_deplete_order` (mig 224) posts a negative `consumption` movement for every recipe ingredient | ✅ correct |
| the order is cancelled | **nothing** — the consumption stays posted | ❌ it silently assumes every cancelled order was cooked |
| `consumption_reversal` | declared in `inv_movements`' CHECK (mig 221) and labelled **"Order cancelled"** in the manager panel's inventory ledger… | ❌ **nothing has ever written one.** A dead kind |
| the audit row | `deletion_audit` kind `order_cancelled`, risk `record`, carrying the **bill value** | ✅ as a record — but the bill value is revenue never earned, NOT the cost of the loss |
| expenses | nothing is written | ❌ real wasted food never becomes a cost |

So the two faults his ask exposes are already in the product:

* **A mis-keyed order eats stock for ever.** Cancel it and the ingredients never come back. On a
  restaurant with recipes, that is a phantom shortage with no record of why.
* **Genuinely wasted food is free.** Cook it, cancel it, and the P&L never hears about it.

## 3. The rule this establishes

> **A cancellation must say whether the food was made. If it was, the loss is a cost with a name.**

* **Not made** → post `consumption_reversal`, ingredients return to the shelf, no expense, audit tag
  `no-loss`.
* **Made** → the `consumption` stands (the stock really is gone), an **expense** is written for the
  ingredient cost, and the audit row is tagged `loss` with that cost on it.
* **Unanswered** (an old row, or an offline replay) → tag `unanswered`, and it is fixable from the
  Audit screen. Nothing is guessed.

### What it does NOT do — the compliance line

Read `docs/COMPLIANCE-GUARDRAILS.md` §3.0 first. This feature only ever **adds** records:

* The bill is untouched. Cancel stays the only route out of a bill; no invoice is renumbered; the
  cancelled sale still appears in the Z-report, the GST report and the day book at ₹0.
* **Classifying is append-only.** The original `deletion_audit` row is never edited. A correction
  writes a NEW row (`removal_classified`) naming who changed it, when, from what to what — so the
  record shows the history of the answer, not just the answer.
* The ingredient cost is an **expense**, never a reduction of revenue. Revenue is already net; nothing
  here touches it. (This is the distinction settled on 2026-08-18: the cancelled *bill value* is not a
  cost and is not quoted on the dashboard; the *ingredient cost of food made and binned* is.)

## 4. Phases

| # | phase | what lands |
|---|---|---|
| **P1** | **Migration** | `made` on the cancel path · `removal_classified` audit kind · `lfh_cancel_classify()` RPC that posts the reversal **or** the expense, once-only · audit tags (`loss` / `no-loss` / `unanswered`) exposed through `lfh_audit_kind_counts` · `expenses.category` gains `food_loss` |
| **P2** | **The choice** | The KOT/order cancel flow asks, in red, **"Was the food made?" — Yes, it was cooked / No, never started**. Required. Manager panel, waiter tablet, and the API that both go through, so an offline replay carries the answer too |
| **P3** | **Fix it from the Audit** | An unanswered or wrongly-answered row can be classified from the Audit screen (owner read-only; manager/admin can set it, permission-scoped) |
| **P4** | **Tags** | Every audit kind carries its tags, in ONE map both halves read (`lfh_audit_risk`'s neighbour + `public/panels/auditsort.js`), shown as chips on all three Audit screens |
| **P5** | **The money** | The food-loss expense reaches the Expenses tile, the inventory expense report and the day book |
| **P6** | **Prove it** | Seeded on backup: cook-and-bin, mis-key-and-cancel, an unanswered row, then classify it. Stock, expense, audit tag and the owner's tiles all checked, and every row created is deleted by id afterwards |

## 4b. Where it ended up — all six phases done, 2026-08-19

Migration **337**. Guards: `npm run verify:cancel-loss` (the database, 18 checks) and
`npm run verify:cancel-made` (through the real manager endpoint, 13 checks); `verify:audit` grew to 87
and now asserts the tag map's two halves agree; `verify:owner-screen` to 55. Full pass: **17 of 17**.

**Faults this work found that were already in the product**

* Cancelling reversed no stock, so a mis-keyed order ate its ingredients for ever.
* `consumption_reversal` was a dead movement kind the manager panel already labelled "Order cancelled".
* Wasted food never became a cost anywhere.

**Faults this work introduced and then fixed** — kept here because each one is a trap worth knowing

1. The classifier was called from inside the cancel block, *before* the row is updated at the bottom of
   the handler, so the RPC correctly refused an order that was not cancelled yet — and said nothing.
   A refusal is logged now.
2. The loss was written to `deletion_audit.amount`, which the Audit screens SUM per kind, so one
   ₹200.60 loss answered twice read ₹401.20 in the record-only total. `amount` stays NULL.
3. The previous answer was read off the `order_cancelled` row, where answers do not live, so a
   correction was never marked as one.
4. The answer lived *only* on the correction row, so a row that had just been answered still showed
   "Not answered yet". The current answer is merged onto the cancellation row as a read convenience;
   the history is untouched.
5. The loss expense was dated by the calendar day while every report window filters by the **business**
   day, so food cooked after midnight fell outside the window: the tile showed 2 of 3 losses and a
   total that happened to look plausible (₹1,800 of ₹3,600). Migration 294 already set the rule.
6. `removal_classified` rows appeared in a list headed "everything taken out of the system" and were
   counted in its total. Filtered out of both removals lists, and out of the chips to match.

## 5b. The one question he has not answered

Who may **change** an answer later. Built on the stated default: whoever cancels answers, and only
`void_bills` (manager and above) may correct it from the Audit. Say the word and it moves.

## 5. Open questions for him (do not guess)

1. **Who may answer?** Anyone who can cancel (waiter included), or manager+ only? Default proposed:
   whoever cancels answers; only manager+ may *change* an answer from the Audit.
2. **No recipe, no cost.** A dish with no recipe has no ingredient cost, so "made" can be recorded but
   valued at ₹0. Proposed: record the loss with a ₹0 value and mark the row `cost-unknown`, rather than
   inventing a figure. (Same honesty rule the inventory reports already use for recipe coverage.)
