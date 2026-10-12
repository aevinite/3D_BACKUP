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
| Can have gaps | no (by design) | **yes** | only in history from before 2026-09-25 — see below |

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
* the order was **moved** to another table, or the table was **merged** into another party — the
  first table keeps the number it drew and closes with nothing on it, while the food is billed on
  the table it went to (the move itself is in the Activity log as `order_move` / `table_shift` /
  `table_merge`). A table an order moves ONTO draws its own number then, if it had none
  (`trg_assign_bill_on_relink`);
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

Printing a bill again draws no number, changes no number, and is recorded nowhere. The printed bill
says nothing about being a second copy (owner, 2026-08-19 — R37 in `docs/REJECTED-IDEAS.md`), and
since 2026-10-10 the bill's button always says **"Print"** — it never turns into "Reprint" (owner:
*"this was for kot not bill so remove the thing"* — R62). Both are guarded by
`npm run verify:bill-reprint`.

`sessions.bill_printed_at` (migration 333, re-commented by 339) is still a column in the table, but
nothing writes or reads it any more: the stamp it held existed only to relabel that button, and the
route that set it was deleted with the label. **Reopening** a bill is a different act and that one
IS in the Audit.

The kitchen ticket keeps its big DUPLICATE banner (owner, 2026-08-04, re-confirmed 2026-08-19) —
a cook who mistakes a duplicate for a fresh order cooks the food twice.

## Why invoice numbers never reset — and also have gaps

A tax invoice number must be sequential forever, so it comes from a different counter
(`seq_counters`, migration 037) that has no day in its key.

**Once issued, an invoice number is final** (migration 398): the database refuses any change to a
bill's `invoice_no` or `invoice_at`, so a number cannot be moved, re-dated or laundered. Reopening an
invoiced bill sets the invoice aside while the table is served again (`invoice_voided`), and putting
it back brings back **the same number and the same date**, with `invoice_reopen_count` going up by
one so the bill can show it was reopened (migration 407, owner 2026-09-25). A reopen is the same
supply still being served, not a new sale, so it takes no new number.

Before 2026-09-25 it was the other way round — re-issuing a reopened bill drew a fresh number and
left the old one on the record marked voided (migration 073) — so the invoice series of an older
restaurant can still skip a number from that time. It was never reused, and every generate and
void since migration 189 is in `invoice_events` with its number, reason and timestamp.

**A bill that was CANCELLED before any invoice existed never takes a number at all** (owner,
2026-08-16; migration 331). Until then `lfh_generate_invoice` would happily draw the next number
for a bill whose every order was cancelled — the series gained a number attached to ₹0 and the
paper that printed was the "CANCELLED — NO CHARGE" sheet carrying a live invoice number. The two
cases read the same in a list and are opposites: **no supply → no invoice**, but **invoice already
issued → the number is retired, not freed**. Full rule: `docs/COMPLIANCE-GUARDRAILS.md` §3.0.

## Which year the invoice number carries

A printed invoice number reads `<prefix>/<financial year>/<six digits>` — `INV/2026-27/000042`.
The year in the middle is **India's financial year, April to March**, taken from the invoice's
**own issue date** in India time, never from today and never from the printing device's clock
(`financialYear()` in `public/panels/billdoc.js`). So a March invoice reprinted in April still says
`2025-26`, and a tablet set to London prints the same number as one set to Mumbai.

The year is part of how the number is WRITTEN, not of how it is counted: the counter itself has no
year in its key and does **not** restart on 1 April — every number stays unique for the life of the
restaurant. The prefix is the restaurant's own (admin console → the restaurant's Settings → Billing → "Invoice prefix", default `INV`).

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
| invoice generate / void (before 2026-09-25 a re-issue drew a new number) | `073_invoice_pipeline.sql` |
| per-restaurant counters | `080_tenant_counters.sql` |
| every invoice generate / void kept in a trail | `189_invoice_events_and_settled_lock.sql` |
| one series for parcel, banquet and the delivery platforms | `261_parcel_platform_bill_numbers.sql` |
| no duplicate KOT on a backdated write | `296_database_layer_a_sweep_fixes.sql` |
| a cancelled sale takes no invoice number | `331_a_cancelled_sale_takes_no_invoice_number.sql` |
| every issued bill is signed and chained | `332_every_bill_is_signed_and_chained.sql` |
| the bill-printed stamp (still a column; nothing has written or read it since 2026-10-10, R62) | `333_a_reprinted_bill_knows_it_is_a_reprint.sql` |
| …and the printed bill says nothing about being a second copy | `339_a_reprinted_bill_says_nothing.sql` |
| an issued invoice number and date can never change | `398_an_issued_invoice_is_final_and_a_cancelled_one_is_corrected.sql` |
| a reopened bill keeps its invoice number | `407_a_reopened_bill_keeps_its_number.sql` |
