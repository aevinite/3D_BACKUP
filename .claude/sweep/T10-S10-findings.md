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
