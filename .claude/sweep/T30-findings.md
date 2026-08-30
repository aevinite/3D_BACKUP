# T30 findings — sweep #7 (cross-panel truth)

Re-run 2026-08-28 against `origin/main` c005b3d3. Branch `sweep7/t30-cross-panel-truth`, port 4230.
**The four-part report for the owner is in the terminal chat, not here** (§6 of the sweep rules).

## Re-run of P14501–P15000

500 of 500 re-run. **0 regressions.** 57 rows that were ❌ are now green — all six of sweep #6's
product handoffs are done on `main`, and all 30 of its coverage gaps have a named owner in sweep #7.
One row is still ❌ and it is unchanged: `P14543`.

## Fixed on this branch

**1 · A comment in the manager route still said a restaurant keeps the power to delete a bill.**
`app/api/editor/[...path]/route.ts` — R27 (owner, 2026-08-16, re-confirmed 2026-08-21) retired the
grantable "Delete a bill" permission outright; the enforcement is right and guarded, but a comment
5,000 lines from it read *"DELETING a bill keeps its own power (delete_bill + void_bills) — it stays
deliberately handed over"*. That is the shape that makes somebody rebuild a permission the owner
refused. Comment corrected; `verify:one-bill-delete` gains a sixth check that reads the RAW file
(the guard's own `code()` helper blanks every line comment, so a comment check against it can only
ever pass — which is how the first draft of this check shipped green against the very wording it was
written to catch). Proved it fails by putting the old wording back.

## Found, not fixed — reasons

**`P29711` · `sessions.bill_printed_at` is outside its table's breadcrumb watch-list.** A bill
printed at the till leaves a second device's button reading "🖨 Print" instead of "🖨 Reprint" for up
to 60 seconds. Nothing on paper is wrong (a bill reprint deliberately carries no band and no audit
row) and no figure is wrong. Not fixed here because the cheap-looking fix does not work: adding the
column to the trigger publishes a TARGETED breadcrumb, and the targeted path patches the summary
TILE, not the orders array the label is built from — so the honest fix is a small scoped read when
the bill card opens, in `public/panels/{editor,tablet}/app.js`, which are other terminals' files
this run. Carried to the owner's report as a decision item.

**`P14543` · `app/api/owner/customers/route.ts` computes `total - disc_gross` inline.** Numerically
identical to `netOf()` — `orders.net_amount` is `GENERATED ALWAYS AS (total - disc_gross)`, confirmed
on the live database this run — so no number is wrong anywhere. It is a second copy of a money rule
in a codebase whose whole history is copies drifting. Carried to the report as an improvement.
