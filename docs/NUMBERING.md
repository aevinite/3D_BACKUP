# The three numbers a restaurant hands out

Written 2026-08-06 (T8 database sweep, finding F11). Staff call all three "the bill number" at
some point, and they behave differently. This is the one page that says which is which.

| | **KOT number** | **Bill number** | **Invoice number** |
|---|---|---|---|
| Lives on | `orders.kot_no` | `sessions.bill_no` | `sessions.invoice_no` |
| Who sees it | the kitchen, on the ticket | staff always; **the customer's sheet only when there is no invoice number** | the printed tax invoice |
| Resets | every business day (05:00 IST) | every business day (05:00 IST) | **never** |
| Given out when | the order is created | the table's **first order** lands | someone generates a tax invoice |
| Per restaurant | yes | yes | yes |
| Can have gaps | no (by design) | **yes** | **yes** |

## Why the day starts at 05:00, not midnight

A service running past midnight is still the same night's trade. So "today" everywhere — the
counters, the panels' Today filter, the Z-report — rolls over at **05:00 India time**, not at
midnight (migration 044, mirrored in `lib/businessDay.ts`). A bill rung at 01:30 belongs to the
previous day's numbers.

## Why bill numbers have gaps and that is correct

A bill number is handed out when a table's **first order** arrives, not when the table is opened
(migration 040). That is deliberate: before it, tapping a table to open it burned a bill number,
so a day of ordinary floor work left big holes in the series for tables that never ordered.

Gaps can still appear, and each is honest:

* a table was opened, ordered, and the order was later **cancelled** — the number stays spent;
* two tables' first orders landed in the same instant — the counter is atomic, so they get
  different numbers, never the same one (migration 051 takes a row lock to guarantee it).

**A missing bill number never means a sale was removed.** Sales are never deleted — see
`docs/COMPLIANCE-GUARDRAILS.md`. If you need to prove where a number went, ask **the Audit**, the
**admin bill ledger** and the **signed chain** — those three keep the record permanently:

* **the Audit** (`deletion_audit`, migration 251) — every removal with its reason, the person, the
  bill/KOT number and the amount. Append-only, and **nothing prunes it**;
* **the admin bill ledger** (`/aevinite` → Bills) — the bill row itself, tombstoned rather than
  erased, reachable at any time by number, date or table;
* **the signed chain** (migration 332) — the moment a bill becomes a tax document, one row is
  written holding its identity, its money at that instant, and a hash of all of it together with the
  hash of the row before it for that restaurant. Remove a row or re-order two and the next row's
  `prev_hash` stops matching, visibly; change a bill's food or totals afterwards and the row's stored
  money stops matching what the orders now say, and it is reported as CHANGED. That is what turns
  "our software cannot make a sale vanish" from a promise into something an inspector can check. It
  is tamper-EVIDENT, not encryption and not a certification claim — the full reasoning, and why the
  hash is computed in the database rather than in the app, is in the migration's own header.

⚠️ **Not the Activity log.** This page used to name it, and it is the wrong place to send anyone:
the Activity log is `staff_actions`, and `lfh_prune_logs()` (migration 158) deletes it after a hard
maximum of **30 days** — selectable down to **1 day** from `/aevinite/settings`. It is a working
log of what staff did, not the record of where a number went (corrected 2026-08-11, T7 finding F5).

## Which number the CUSTOMER'S sheet shows (owner, 2026-08-21)

This app hands out three numbers where a POS normally has two, and only `bill_no` can have visible
holes — a table that ordered and then cancelled leaves its number spent. Printing it beside the
invoice number meant a customer, and an owner flicking through the day's sheets, saw #12, #14, #15
and read it as sloppiness.

So the printed sheet shows **`bill_no` only when there is no invoice number to show instead**:

* a restaurant that issues GST invoices → the sheet shows the **invoice number** and nothing else
  (that is the number meant to be quoted);
* a restaurant without invoicing → the sheet shows **`bill_no`**, which is the case it exists for;
* a **cancelled** sheet names the invoice number it retired, marked "— voided" (mig 073), so it
  still shows no `bill_no`.

Nothing about how numbers are ASSIGNED changed — every rule on this page still holds, and staff
screens (the manager's Bills record, the admin bill ledger, the Audit) show `bill_no` as they always
did. It is a decision about the customer's piece of paper only.
`public/panels/billdoc.js` → the `billNo` row.

## A reprint is not a number, and not an event

`sessions.bill_printed_at` (migration 333, re-commented by migration 339) records that a bill has
been printed before. It exists so a panel's button can read **"Reprint"** — nothing more. The
printed bill says nothing at all about being a second copy (owner, 2026-08-19; R37 in
`docs/REJECTED-IDEAS.md`, guarded by `npm run verify:bill-reprint`), and no number is drawn or
changed by a reprint. **Reopening** a bill is a different act and that one IS in the Audit.

The kitchen ticket keeps its big DUPLICATE banner (owner, 2026-08-04, re-confirmed 2026-08-19) —
a cook who mistakes a duplicate for a fresh order cooks the food twice.

## Why invoice numbers never reset — and also have gaps

A tax invoice number must be sequential forever, so it comes from a different counter
(`seq_counters`, migration 037) that has no day in its key.

When an invoice is **voided**, the number stays on the record and is never reused; re-issuing
draws a fresh one (migration 073). So the invoice series can skip a number, and the skipped one is
still findable on the voided record with its reason and timestamp. That is the compliant
behaviour — a void that silently reused its number would be the opposite.

**A bill that was CANCELLED before any invoice existed never takes a number at all** (owner,
2026-08-16; migration 331). Until then `lfh_generate_invoice` would happily draw the next number
for a bill whose every order was cancelled — the series gained a number attached to ₹0 and the
paper that printed was the "CANCELLED — NO CHARGE" sheet carrying a live invoice number. The two
cases read the same in a list and are opposites: **no supply → no invoice**, but **invoice already
issued → the number is retired, not freed**. Full rule: `docs/COMPLIANCE-GUARDRAILS.md` §3.0.

## One KOT series, all channels

Dine-in, parcel, banquet and delivery-platform orders all draw from the **same** daily KOT counter
(migration 261). The kitchen shouts one number and there is only one order it can mean.

The KOT number is a plain integer with no cap — a day taking three thousand orders reaches #3000
and starts again at #1 after the 05:00 rollover. A writer that brings its own number (the history
seeder backdating a bill) pushes the counter past itself, so it can never hand the same number to
two bills (migration 296).

## Where each rule actually lives

Find these by their CONTENT, not by the number in the name: parallel branches get renumbered on
merge, and numbers are already duplicated on `main`. The filenames below are the ones as they stand
today.

| rule | file |
|---|---|
| the counters themselves, atomic | `036_kot_bill_staff_orders.sql` |
| bill number on first order, not on open | `040_bill_no_lazy_and_otp_rename.sql` |
| 05:00 IST business day | `044_business_day_counter.sql` |
| two first orders in the same instant get different numbers | `051_concurrency_integrity_guards.sql` |
| invoice generate / void | `073_invoice_pipeline.sql` |
| per-restaurant counters | `080_tenant_counters.sql` |
| one series for parcel, banquet and the delivery platforms | `261_parcel_platform_bill_numbers.sql` |
| no duplicate KOT on a backdated write | `296_database_layer_a_sweep_fixes.sql` |
| a cancelled sale takes no invoice number | `331_a_cancelled_sale_takes_no_invoice_number.sql` |
| every issued bill is signed and chained | `332_every_bill_is_signed_and_chained.sql` |
| a bill remembers it has been printed (so the button can say "Reprint") | `333_a_reprinted_bill_knows_it_is_a_reprint.sql` |
| …and the printed bill says nothing about it | `339_a_reprinted_bill_says_nothing.sql` |
