# The three numbers a restaurant hands out

Written 2026-08-06 (T8 database sweep, finding F11). Staff call all three "the bill number" at
some point, and they behave differently. This is the one page that says which is which.

| | **KOT number** | **Bill number** | **Invoice number** |
|---|---|---|---|
| Lives on | `orders.kot_no` | `sessions.bill_no` | `sessions.invoice_no` |
| Who sees it | the kitchen, on the ticket | the table's bill | the printed tax invoice |
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
`docs/COMPLIANCE-GUARDRAILS.md`. If you need to prove where a number went, ask **the Audit** and the
**admin bill ledger** — those two keep the record permanently:

* **the Audit** (`deletion_audit`, migration 251) — every removal with its reason, the person, the
  bill/KOT number and the amount. Append-only, and **nothing prunes it**;
* **the admin bill ledger** (`/aevinite` → Bills) — the bill row itself, tombstoned rather than
  erased, reachable at any time by number, date or table.

⚠️ **Not the Activity log.** This page used to name it, and it is the wrong place to send anyone:
the Activity log is `staff_actions`, and `lfh_prune_logs()` (migration 158) deletes it after a hard
maximum of **30 days** — selectable down to **1 day** from `/aevinite/settings`. It is a working
log of what staff did, not the record of where a number went (corrected 2026-08-11, T7 finding F5).

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

| rule | file |
|---|---|
| the counters themselves, atomic | `036_kot_bill_staff_orders.sql` |
| bill number on first order, not on open | `040_bill_no_lazy_and_otp_rename.sql` |
| 05:00 IST business day | `044_business_day_counter.sql` |
| invoice generate / void | `073_invoice_pipeline.sql` |
| per-restaurant counters | `080_tenant_counters.sql` |
| no duplicate KOT on a backdated write | `296_database_layer_a_sweep_fixes.sql` |
