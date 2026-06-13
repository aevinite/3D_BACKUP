# Business-Logic Audit — restaurant POS (2026-06-13)

Audited as a QA engineer + restaurant-ops consultant. Grounded in the real code
(`editor/`, `kitchen/`, `tablet/`, `admin/`, `lib/`, `supabase/migrations/`).
Scope = business logic only (not syntax/perf/security — those are covered by the
other suites). Issues are reported only with a concrete workflow + expected
behaviour. **Items marked ✅ FIXED were corrected in this same session.**

---

## SECTION 1 — System workflow map

**Actors:** Guest (phone), Waiter (tablet), Kitchen (KDS), Cashier/Manager
(editor), Owner (admin). Single restaurant, no per-user login yet (panel
passwords only).

**The happy path (dine-in, the only order type that exists today):**
1. Staff *opens* a table (editor floor or tablet) → `sessions` row, status `open`, `bill_no` assigned on first order.
2. Guest scans/enters table → joins session (head/guest, approval model) → builds shared cart.
3. Guest places order → `lfh_place_order` → `orders` row `status=received, payment_status=pending`, `kot_no` assigned; OR the waiter places it via the tablet (`lfh_staff_place_order`).
4. Kitchen sees the KOT → **Accept** (`received→preparing`) → per-dish ✓ / **All ready** (`→served`).
5. Cashier marks the order **Paid**.
6. When every order on the table is paid/cancelled → **Free table** → orders `archived=true`, session `closed` (cleanup trigger wipes cart/members/calls).
7. Archived/cancelled orders live in **Previous** as read-only records.

**Supporting flows:** waiter calls (water/bill…), join requests + head transfer,
discounts per order, table shift, guest feedback per order, maintenance mode,
feature on/off switches, the admin switcher.

---

## SECTION 2 — Entities & state transitions

### Table / Session  (`sessions.status`)
- States: **free** (no open session) · **open/seated** · **closed**.
- Allowed: free → open (staff opens) · open → closed (free table / last guest leaves / staff close).
- Forbidden (enforced): two `open` sessions for one table — blocked by the unique partial index (migration 034). ✅
- Forbidden (SHOULD enforce, see §4): closed → open by re-using the old session (a new open must be a new row).

### Order  (`status` × `payment_status` × `archived`)
- `status`: **received → preparing → served**; **any → cancelled**.
- `payment_status`: **pending ↔ paid**.
- `archived`: **false → true** (freed) → **false** (restored).
- Allowed: received→preparing→served (kitchen); received/preparing→cancelled (void); served→preparing (Reopen/remake); pending→paid (settle).
- Forbidden (SHOULD enforce, see §4): paid → cancelled with no refund record; delete of a paid/served bill; archived record carrying live actions ✅ FIXED.

### KOT  (`orders.kot_no`, per-day counter)
- Created with the order; advances with the order's items; never re-numbered. Resets daily.

### Bill  (implicit per session; `bill_no`, `invoice_no`)
- `bill_no` assigned on the table's **first order** (migration 040 ✅, was previously burned on every table-open). `invoice_no` reserved for GST (off).
- Paid per-order; a table is "settled" only when every non-cancelled order is paid.

### Entities that DO NOT exist yet (so all their transitions are "forbidden by absence")
- **Payments** (mode/amount/refund) — only a paid boolean. Table + RPCs are stubbed, flag off.
- **Refunds** — no entity.
- **Split bills** — none.
- **Reservations / waitlist** — none.
- **Delivery / takeaway order types** — every order needs a table; no type field, no token flow.
- **Inventory / stock counts** — only a binary `sold-out` tag (86 board); no quantities.
- **Staff accounts / roles** — one shared password per panel; no per-action permission.

---

## SECTION 3 — Business rules (the ones the code enforces today)

1. A table can't be freed while any non-cancelled order is unpaid (`tableSettled`, free button disabled). ✅
2. Sold-out dishes can't be ordered — rejected server-side even for staff (`lfh_price_order`). ✅
3. Prices are server-authoritative; a tampered client price is ignored. ✅
4. One head per table; head can be transferred (old head kicked) — never two. ✅
5. Server-side pricing + tax (5%); discounts stored apart from the total, clamped 0..total. ✅
6. Previous orders are read-only records; you restore to the floor to change one. ✅ FIXED
7. Maintenance mode hides the guest menu but leaves staff panels working. ✅
8. Backend-only systems (verification, payments, aggregators, GST) are off and invisible. ✅

---

## SECTION 4 — Potential logic issues found (real, with workflow + expected behaviour)

> Ranked. #1 was fixed this session; the rest are genuine gaps, most tied to
> features intentionally deferred (payments/refunds/roles) — flagged so they're
> not forgotten before real money flows.

**1. ✅ FIXED — Previous order showed live actions / "Free table" on a free table.**
- Was: an unfreed bill from a prior day sat in "Previous" with Mark-unpaid / Reopen / Free-table, and Free-table acted on the live floor.
- Now: Live/Previous split on state not date; previous = restore-only records.

**2. Deleting a paid/served bill destroys the financial record (no audit trail).**
- Workflow: editor → any order card → 🗑 delete (or "Clear all" in Previous).
- Expected (restaurant/tax reality): a *settled* bill must never be hard-deleted; it should be voidable-with-reason but retained. Today `DELETE /api/orders/:id` removes it permanently with no trace. Cashiers can erase revenue.
- Recommend: block delete when `payment_status=paid` (or archive-only), keep a void log.

**3. Paid → cancelled / reopen has no refund and leaves impossible states.**
- Workflow: a served+paid order → "Reopen" sets `status=preparing` but `payment_status` stays `paid` → a "paid but still cooking" order; or Mark-unpaid simply flips the flag with no money trail.
- Expected: reversing a paid order should create a refund/void record and a clear state, not silently flip a boolean.
- Recommend: a refund entity (ties to the deferred payments work) + forbid paid→cancelled without it.

**4. No payment mode, amount tendered, or split — "Paid" is one boolean.**
- Workflow: cashier settles a ₹2,645 table → one "Mark paid" click.
- Expected (real cashiering): record cash/card/UPI, amount + change, and allow splitting a bill across people/payments. None exist.
- Recommend: the deferred payments phase; until then "Paid" is an honor-system flag — fine for a pilot, not for accounting.

**5. Discounts have no cap, reason-requirement, or approver.**
- Workflow: editor → order → "− disc" → any amount up to the total, optional note.
- Expected: discounts are usually manager-gated and reason-required to stop staff comping freely. With no staff roles, anyone with the editor password can discount to zero.
- Recommend: when staff roles land, gate discounts; for now, the note is optional — consider making it required.

**6. Reopening a served order silently re-fires it to the kitchen.**
- Workflow: served order → "Reopen" → `preparing` → it reappears on the KDS as if to be cooked again.
- Expected: intended for a remake, but there's no "remake vs correct-a-mistake" distinction, and a paid order reopened this way confuses the kitchen.
- Recommend: a confirm ("re-fire to kitchen?") and keep payment state coherent.

**7. Kitchen can mark a dish served before the order is accepted.**
- Workflow: KDS item status whitelist allows received→served directly; the order rollup then flips to preparing/served without an explicit Accept.
- Expected: an order should be Accepted before any dish is served, so the "New" column can't be silently bypassed.
- Recommend: ignore item-serve on a `received` order until accepted (minor).

**8. Concurrent multi-user edits are last-write-wins.**
- Workflow: cashier marks an order paid at the same second a waiter cancels it (editor + tablet, 1s polls, optimistic UI).
- Expected: a clear winner / conflict notice. Today both PATCH the row; the later write wins and the other user's screen corrects on the next poll — usually fine, but a cancel-vs-pay race can leave "paid + cancelled".
- Recommend: server-side guards (can't pay a cancelled order; can't cancel a paid one) — cheap to add.

---

## SECTION 5 — Edge cases not handled

- **Restored old order vs a now-occupied table:** restoring a previous bill for table 3 brings it live; if table 3 currently has a *different* party, two live orders share table 3. Rare, but possible — restore could warn if the table is occupied by another session.
- **Cancel-everything then free:** a table whose only orders are all cancelled is "settled" and freeable (due=0) — correct, but the bill_no was consumed for a table that never paid (acceptable; just a numbering gap).
- **Day rollover with open tables:** a table left open overnight stays "live" (good, since split is state-based now), but `kot_no`/revenue-today reset at midnight while the order is still open — its KOT from yesterday won't match today's counter. Minor reporting wrinkle.
- **Feedback after the bill is deleted:** feedback rows cascade-delete with the order (FK ON DELETE CASCADE) — fine, but a deleted bill also erases its guest feedback silently.
- **Maintenance mode while guests are mid-order:** turning maintenance ON swaps the whole menu to the maintenance screen even for a guest with a half-built cart — their cart survives in localStorage, but the in-progress flow is interrupted with no warning. Acceptable for a deliberate owner action.
- **Tablet/kitchen left open on an old table number after a shift:** covered — shift moves orders+calls; panels re-poll within 1s.

---

## SECTION 6 — Recommendations (priority order)

1. **Protect settled bills** — block hard-delete of paid orders; archive + void-log instead (issue #2). *Small, high value, do before real use.*
2. **Server-side state guards** — refuse pay-a-cancelled and cancel-a-paid order; keeps the money state coherent (issues #3, #8). *Small.*
3. **Payments phase** (deferred): payment mode + amount + split + refunds — the real billing depth (issues #3, #4). *Large, gated on a gateway.*
4. **Staff roles** — manager-gated discounts/voids/deletes + an audit log of who-did-what (issues #2, #5). *Medium; also the multi-user story.*
5. **Order types** — dine-in / takeaway / delivery + a takeaway token screen (no entity today). *Medium.*
6. **Reservations/waitlist** — new entity. *Medium, optional for a café.*
7. **Reopen UX** — confirm + remake-vs-correct distinction (issue #6). *Small.*

The core dine-in lifecycle (open → order → KOT → serve → settle → free → record)
is sound and now internally consistent after the Previous-orders fix. The
biggest real-world risks before taking money are all in the **billing/refund/
roles** family — exactly the work already deferred to the payments phase.
