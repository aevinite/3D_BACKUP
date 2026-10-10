# Sweep #10 · Terminal 10 — findings (the manager route, part 2 of 2)

Territory: `app/api/editor/[...path]/route.ts` from the POST `customer-capture` branch to the end of
the file (lines ~3,442–end on 2026-10-09). Ledger: `LEDGER/T10-S10.md`. Each item is its own commit.

## 1 · A cancelled ticket could be brought back without Restore

- **Where:** Manager panel → Tables → a table's tickets → ✓ Accept & Prepare / serving a dish.
- **What was wrong:** four doors (POST `orders/:id/accept`, POST `orders/:id/item`, POST
  `items/:id/status`, PATCH `orders/:id` with `preparing`/`served`) moved a CANCELLED order's status
  with no 30-minute window and no `order_uncancel` line. A stale tile + a colleague's cancel on
  another device revived the ticket into the kitchen and its money onto the bill, unrecorded.
  serve-all had been given this refusal on 2026-08-04; its siblings had not.
- **Fix:** each door refuses a cancelled ticket with 409 and one sentence (`VOIDED_MSG`); Restore
  (`received`) is unchanged.
- **Guard:** `npm run verify:voided-stays` (17 checks, in memory against the real route; sabotaged:
  13 red). Ledger P179001–P179017.
- **Not mine, same shape:** the waiter tablet's and the kitchen's `orders/:id/accept` and the
  tablet's `items/:id/status` (their own terminals).

## 2 · A leftover door switched the kitchen's delivery-app power with no permission check

- **Where:** backend only, nothing on screen (the Platform tab's "Show in bills" checkbox that used
  it was removed on 2026-07-07).
- **Fix:** POST `platform/toggles` removed, obituary in place. Guard: `verify:t10-writes` (item 2).

## 3 · An owner's settings save could write a module's admin switches

- **Where:** backend only — the manager panel's settings save, which an owner also reaches.
- **What was wrong:** `modules` (Loyalty points' admin switch), every `*_owner_control` and
  `*_enabled` added after mig 166, and `platform_channels` were not stripped for a staff save.
- **Fix:** dropped for any staff-cookie save; admin console untouched. Guard: `verify:t10-writes`.

## 4 · The manager's discount limit was measured against the bill's first ticket

- **Where:** Manager panel → a table → − Discount → Apply.
- **What was wrong:** the screen allows the person's % of the whole bill; the server measured the %
  against the one ticket whose id was sent, refusing legitimate discounts on multi-ticket bills.
- **Fix:** the cap uses the bill's base on a table, the ticket's on a solo order. Guard: `verify:t10-writes`.

## 5 · A comment promised a branded reprint the owner removed (R37/R38)

- **Where:** backend only. Comment corrected. Guard: `verify:t10-writes` (item 5).

## 6 · A tip on a ticket that had gone was reported as saved

- **Where:** Manager panel → a table → 💳 Mark paid → tip.
- **Fix:** zero-row match answers 404 (the waiter twin's words). Guard: `verify:t10-writes`.

## 7 · Four statements found their row by id alone

- **Where:** backend only, nothing on screen (Ratings → ✓ Handled; Tables → clear the round).
- **What was wrong:** the rating read compared restaurant_id after fetching by id, its update and the
  two closing writes of `tables/:t/restart` used the id alone. Correct today (each id came from a
  scoped read) but the WHERE clause is the only scope the service-role client has.
- **Fix:** restaurant named in all four. Guard: `verify:t10-writes` (item 7, 3 checks, sabotaged red).
- **Not mine, same shape:** `lib/removalAudit.ts` (bill read by session id) and `lib/sessionClose.ts`
  (close writes by session id after its ownership check).

## 8 · Lifting a ban that was already lifted still wrote "unbanned"

- **Where:** Manager panel → a table's guests / Audit & logs → Users → Unblock.
- **Fix:** an already-lifted ban answers 404 and writes nothing; the read names `id, phone`, not `*`.
  Guard: `verify:t10-writes` (item 8).

## 9 · The printer-problem "resolve" door had no caller

- **Where:** backend only (the floor's printer strip was removed 2026-08-31; its wiring 2026-09-03).
- **Fix:** removed with an obituary; problems still close on the next good print. Guard: `verify:t10-writes`.

## 10 · Five doors handed the database's own words to the screen

- **Where:** customer save after a bill · pay-later "add a person" (two doors) · 🚩 raise an issue ·
  un-paying a split bill.
- **Fix:** the real error goes to the server log; the person reads one sentence. The complaint form's
  own sentences still pass through. Guard: `verify:t10-writes` (item 10).

## 11 · The invoice door's comment claimed a switch that does not exist

- **Where:** backend only. `print_invoice` is always on for a manager since 2026-08-01; the comment
  said the Access row "genuinely bites". Comment corrected; guard asserts both the words and the code.

## Seen, outside this boundary (for its owner)

- Manager panel on a 360px phone → Tables: every tile shows "🪑 4 / F…" and **no table number**
  (P179909). `public/panels/editor` floor styling.
- `lib/removalAudit.ts` reads the bill by session id alone; `lib/sessionClose.ts` closes by session id
  alone after its ownership check (block A's named exemptions).
- The waiter tablet's and the kitchen's `orders/:id/accept`, and the tablet's `items/:id/status`, can
  revive a cancelled ticket the same way item 1 fixed here.

# Round 2 (2026-10-10) — the owner's answers to Part 4, built

| # | what | his words / my call |
|---|---|---|
| 5 | the guest bill's "Reprint" button and the `bill_printed_at` stamp removed (both panels, both routes); the KOT keeps DUPLICATE | "this was for kot not bill so remove the thing" — reverses 2026-08-19 · R62 |
| 11 | the dead `print_invoice` check deleted; a manager can always generate/print a bill | R63 |
| 12 | the waiter tablet (Accept, serve a dish) and the kitchen (Accept, All ready, take back, one dish ready) refuse a cancelled ticket — the sabotage run showed all five REALLY revived it | "solve … all the rest" |
| 13 | a quick-order discount over the limit is refused BEFORE the order is placed (it used to be refused after) | "solve … all the rest" |
| 14 | not built; the rule now says "a `.limit()` on a list that can grow" | R64 |
| 15 | lib/removalAudit + lib/sessionClose name the restaurant; 3 stale exemptions gone | "you decide for good of my project" |
| 16 | 38 lines of leftover printer-setup comments deleted | — |
| 17 | a deleted category/tag is recorded in the Audit by its name, not its slug | — |
| 18 | not built | R65 |
| 19 | NOT A FAULT — my phone emulation had touch off; as a real A35 every tile shows its number (P179909 corrected) | — |

Guards: `verify:voided-stays` (25), `verify:t10-writes` (30), `verify:bill-reprint-is-silent` (part 4 rewritten), `verify:scoped-reads`, `verify:rejected` — each sabotage-tested.
