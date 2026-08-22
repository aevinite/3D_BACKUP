# Sweep #6 · Terminal 22 — findings
Territory: `supabase/migrations/` positions 121–230 (110 files) — sessions, tables, the floor
summary and the rush protections. Branch `sweep6/t22-db-migrations-b`. Ledger: `LEDGER/T22.md`.

Four real problems, all four fixed in this worktree. Every one passed the four-test gate before a
line of working code was changed.

---

## F1 · A removed order stayed on the KITCHEN board  ·  confirmed  ·  high
**Where:** kitchen panel → the live board. A ticket for a party that had left, on a table the
manager's floor showed as free.
"Removed from the floor" is written as TWO columns on `orders`: `deleted_at` (the tombstone the
ledger, the retention window and the indexes read) and `archived` (the flag every live board reads
— `lfh_floor_state`, `lfh_table_view_summary`, `lfh_kitchen_tickets`, `lfh_admin_floor_stats`).
`lib/softDelete.ts` stamps both and says why. Nothing enforced it, so any write that stamped only
`deleted_at` left an order the floor called gone and the kitchen still called food.
**Watched:** 24 orders at French House were in that state, the oldest for over two weeks.
`npm run verify:lifecycle` went red on it about one run in three — whenever its random table pick
landed on T8/T9/T10/T26/T29 — which read as flakiness rather than as this.
**Fixed:** migration `355_a_removed_order_leaves_every_board.sql` — a BEFORE INSERT/UPDATE trigger
that normalises `archived` whenever `deleted_at` is set, plus a one-time backfill wrapped in
`lfh_already_applied`. It cannot fight the restore path, which clears `deleted_at` and deliberately
leaves `archived` set.
**Guard:** the trigger IS the regression check — the split state can no longer be written.
`verify:lifecycle` now passes; ledger rows P10676, P10677, P10947.

## F2 · A re-seed put people the owner had removed back on the pay list  ·  code-read  ·  high
**Where:** owner panel → Team → the pay screen, and the monthly cost figure. Backend on a re-seed.
Migration 221's one-time backfill sets `in_payroll = true` for anyone who still holds a pay rate or
has any payment history. A re-seed re-runs every migration with no ledger, so it reverses the
owner's own decision to take someone OFF the list, and stamps `payroll_added_by = 'migration 221'`
for a choice he had reversed.
**Fixed:** the backfill is wrapped in the `lfh_already_applied` pattern. Because the guard function
only exists from migration 307 onward, seeing it at file 221 proves an earlier pass already ran the
backfill — so it records the key and skips.
**Proved:** took a French House person off the pay list (keeping the rate), re-ran migration 221,
they stayed off, then restored the row by id. Ledger rows P10642, P10767.

## F3 · Six owner-analytics functions had silently lost their working memory  ·  code-read  ·  medium
**Where:** owner panel → Dashboard and Reports, on the wide/all-time views. Backend tuning, nothing
on screen until it times out as "Couldn't load".
Migration 192 gave eleven analytics functions `work_mem = 128MB` with the measurement written down
(at ~398k orders the default 4MB spilled 75–340MB to disk and tipped past the 8s statement timeout).
Function-level SET clauses are part of a function's definition, so a later `CREATE OR REPLACE` that
does not restate them DROPS them — and migrations 310, 315, 321, 327 and 337 each did exactly that.
Migration 266's own comment says the opposite out loud ("CREATE OR REPLACE preserves settings"),
which is why nobody noticed: the folder looks like it sets the tuning and the database does not.
Not obsolete: all six still scan raw `orders`, three of them with no rollup at all, and two of the
five that kept the setting are in the same shape.
**Fixed:** migration `356_the_owner_dashboard_keeps_its_working_memory.sql` — guarded ALTERs, so a
future signature change makes it a no-op instead of killing a re-seed. All eleven now carry it.
**Guard:** ledger row P10609 reads `pg_proc.proconfig` for all eleven.

## F4 · After staff cleared a table, the next party's FIRST order skipped the Accept  ·  confirmed  ·  medium
**Where:** manager and tablet panels → the Tables floor. A brand-new order appeared already
"preparing", with no Accept tap, and the kitchen started cooking it unchecked.
Migration 164's own header states the rule: "the FIRST order of any seating still arrives as
'received' and must be accepted". It decides "is this a follow-up?" by asking whether the seating
already has an accepted order — and that test looked only at status and payment, never at whether
the order is still on the floor. Clearing a table (the app's own soft-delete) leaves its orders
'preparing' and unpaid, so a restarted table auto-accepted the next party's first order. Both guest
doors share the flaw.
**Watched:** opened a table, placed and accepted one order, cleared it the way the app clears it,
then ordered through the table's QR door — it arrived 'preparing'. After the fix, 'received'.
**Fixed:** migration `357_the_accept_is_only_skipped_for_an_order_still_on_the_floor.sql` — two
lines in each of the two EXISTS tests. Both bodies are the CURRENT live definitions taken from the
database with `pg_get_functiondef` and changed in exactly those two places, the same method
migrations 206 and 207 used, so nothing newer is reverted.
**Guard:** ledger rows P10644–P10654 drive every auto-accept boundary, including this one.

---

## 🔗 HANDOFFS

**H1 · the 350–354 sequence gap — RESOLVED, no action needed.**
`verify:grants` failed because migration numbers 350–354 were missing while this terminal held
355–359. Those five have since landed on `main`; this branch is rebased onto it and the check reads
"no unexplained gaps in the sequence". Nothing to hand off.

**H2 · the duplicated 346 — RESOLVED by someone else, and a NEW one has appeared.**
`346_usage_and_cost_answers_for_any_window.sql` was renumbered to 347 on main. But `main` now
carries **two files numbered 352** — `352_a_reseed_cannot_undo_an_admins_choice.sql` and
`352_a_split_part_can_be_pay_later.sql`. Another terminal's collision, outside migrations 121–230,
left alone.

**H3 · `lfh_request_verification` is declared by the migrations and MISSING from the database.**
`verify:grants` fails twice on it: the allow-list names a function that does not exist, and the
folder creates it with no later migration retiring it. Migration 296 hardened it deliberately and
migration 297 says in as many words that it is kept on purpose, because
`scripts/verify-families.mjs` asserts it answers 'disabled'. So either migration 296 never applied
to this database or something dropped it by hand.
**Not touched on purpose:** migration 297 also says retiring it is "a one-line DROP whenever the
owner wants it gone", so a terminal may be doing exactly that right now with an unpushed migration.
Re-creating it could fight that work. Whoever owns migration 296/297 should decide: restore it, or
retire it in a migration so the intent is written down.

**H4 · the shared dev database was ahead of `main` — EXPLAINED AND RESOLVED.**
`lfh_block_issued_delete` in the database cited **migration 361**, which existed in no branch this
terminal could see. It was terminal 21's, unmerged at the time; pull request #1078 has since landed
it. It is a good change — it tests `kot_no is not null` instead of looking up the session's
`bill_no`, which is true from the moment an order exists and so protects earlier. The same pull
request also answers H3: its migration 360 retires `lfh_request_verification` deliberately, which is
exactly why the function was missing from the database and why this terminal was right not to
re-create it.

**H5 · this terminal's 358/359 collided with terminal 21's and were renumbered to 362/363.**
Terminal 21 used 358–361 although this terminal held the reserved block 355–359. #1078 merged first,
so the later work moved rather than the earlier. Content unchanged.

---

## Not findings — checked and deliberately so

* The purge keeps `session_payments`, `credit_notes`, `invoice_events` and `khata_customers`. Its
  own header says why (money, and a khata foreign key with no ON DELETE) and `npm run verify:purge`
  asserts the whole list. Left alone.
* `lfh_bump_error_signature` is absent. Migration 219 dropped it on purpose so nothing can mute an
  error. Left alone.
* The 23 server-only tables this range creates carry Supabase's default anon/authenticated table
  GRANTs. RLS is on with zero policies on every one, so the public key gets no rows — that is the
  documented design in migration 204 and what `verify:grants` asserts. Listed as improvement I1,
  not a fault.
* A tile's `₹ due` excludes an order nobody has accepted yet. Deliberate (live body line 108).
* `lfh_admin_table_estimates` is platform-wide and not restaurant-scoped. Deliberate — it reads
  `pg_class` row estimates for the admin's own health page.


---

# Second sitting, 2026-08-22 — the owner approved the four improvements

All four 🟡 items were built and verified; the detail is in `T22-improvements.md`. Two things found
while building them are worth recording as findings in their own right:

## F5 · `verify:table-lifecycle.mjs` died on the product's own double-tap protection  ·  confirmed
**Where:** backend only, nothing on screen — but it is the guard that protects finding F1.
The rig places identical orders back to back by design (that is what "the next party sits down"
looks like at machine speed). Migration 202 refuses a second identical order on the same table
within three seconds — correctly. The rig did not check the answer, so `order()` returned
`undefined` and the run died four scenarios in with `invalid input syntax for type uuid:
"undefined"`, which reads exactly like a product fault and is not one.
**Fixed:** the rig now passes `p_confirm_duplicate: true` — the same "send anyway" a waiter uses —
and throws with the refusal spelled out if anything else comes back. `verify:lifecycle` now passes
twice in a row.

## F6 · migration 221's re-seed guard recorded a ledger key it never checked  ·  confirmed
Caught by the strengthened `verify:grants` on main: "'221_payroll_optin_backfill' is recorded … but
no migration CHECKS it, so the ledger row protects nothing". True — the first version decided using
`to_regprocedure` alone, which is correct in effect but leaves the ledger row decorative.
**Fixed:** it now calls `lfh_already_applied('221_payroll_optin_backfill')` first and only falls
back to the "the guard function exists, so an earlier pass ran this file" reasoning when the ledger
has no answer yet — recording the key at that point so the ledger tells the truth.
