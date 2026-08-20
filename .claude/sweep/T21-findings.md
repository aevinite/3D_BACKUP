# T21 findings — the database, migrations 001 to 118

Territory: the first 120 files of `supabase/migrations/`.
Ledger: `.claude/sweep/LEDGER/T21.md` (P10001–P10500). All findings below are FIXED in `sweep6/t21-db-migrations-a`.

## The one real fault, in ten places

**ONE CLASS: running a single old migration by hand undoes a decision a later migration made.**

`CLAUDE.md` and `scripts/run-migration.mjs` both recommend applying ONE migration instead of a full
re-seed, and that script's header states the assumption plainly: *"Idempotent migrations (CREATE OR
REPLACE / IF NOT EXISTS) are safe to re-run."* For a file that only ADDS things, that is true. For a
file whose objects a LATER migration deliberately REMOVED, it is not — the old file happily re-creates
them, and the removal lives 100+ files away where nobody looks.

The project has hit this three times and patched only its own instance each time:
migration 099 (its body was replaced by its own removal, "running this file alone brought a
table-closing job back to life"), migration 281 (*"if 236 is ever re-run alone they will come back"*),
and migration 297, named "undo a resurrection". Nothing generalised it. This sweep did.

**MEASURED, not reasoned.** Running 005, 015 and 036 by hand against the dev database:
- re-created **7 pre-tenancy function overloads, 5 of them callable with the public menu key** —
  including an `lfh_place_order` that trusts a client-supplied `subtotal`/`tax`/`total`, the exact
  thing migration 029 exists to prevent (029 leaves a shim there that IGNORES that money);
- reverted **5 function BODIES** to their old era — `lfh_session_state`, the guest's whole table view,
  went from 5,315 characters back to 1,601, losing migrations 076/126/271/318.

`verify:grants` stayed GREEN through all of it and could not have caught it: its allow-list is keyed by
function NAME, so a stale overload of an allowed name looks allowed, and it never compares bodies.

The dev database was restored to a byte-exact snapshot taken before anything ran (all 187 functions,
every body length matching), and `verify:grants` re-verified green afterwards.

| # | file | what a single run put back | why that matters | severity |
|---|------|---------------------------|------------------|----------|
| 1 | `005_allergens_and_orders.sql` | policy `orders.public_insert_orders` (anon INSERT, `WITH CHECK (true)`) | a guest's phone writes an `orders` row with a price it chose, past `lfh_place_order`'s session/approval/pricing checks — the thing mig 029 exists to stop | **high — money** |
| 1 | `008_search_alias_and_calls.sql` | policy `waiter_calls.public_insert_calls` | unlimited unattributed waiter calls on any table number; mig 050 replaced this with a rate-limited RPC that refuses a closed table | medium |
| 2 | `015_sessions_v2_rpcs.sql` | function `lfh_open_session(text,text)` **+ its anon GRANT** | a guest opens their own table — mig 021 forbids it, mig 304 removed the function for doing it | **high** |
| 2 | `083_guest_rpc_scoping_param.sql` | function `lfh_open_session(text,text,uuid)` **+ its anon GRANT** | same door, tenant-scoped signature | **high** |
| 3 | `036_kot_bill_staff_orders.sql` | trigger `trg_assign_bill` on `sessions` + `lfh_assign_bill()` | every table a waiter opens instantly spends a bill number even if nobody orders — mig 040 fixed exactly this, and `docs/NUMBERING.md` records why | **high — numbering** |
| 3 | `080_tenant_counters.sql` | function `lfh_assign_bill()` | dead function only (mig 040 already took its trigger) | low |
| 4 | `037_billing_feedback_backend_stubs.sql` | function `lfh_request_otp` + anon GRANT | a second code-issuing door beside the live one, invisible while `verification` is backend-only | low |
| 4 | `040_bill_no_lazy_and_otp_rename.sql` | function `lfh_check_verification` + anon GRANT | third route to the resurrection migs 267 and 297 each undid | low |
| 5 | `003_settings.sql` | policy `settings.public_read_settings` (`USING (true)`) | every restaurant's whole settings row — gstin, access_config — to the public menu key. **Inert today** because anon's table SELECT grant is also revoked; this removes the reliance on that one remaining lock | low (defence in depth) |
| 5 | `078_tenancy_core.sql` | policy `restaurants.public_read_restaurants` | same shape, closed by mig 313; also inert today for the same reason | low (defence in depth) |

**Fix (all ten):** each file now ENDS in the state the later migration decided — an idempotent
`DROP … IF EXISTS`, in the pattern migrations 036, 040 and 099 already use, with a comment naming the
later migration and the rule. A full re-seed is unchanged (the later DROP was always going to win);
a single-file run now lands in the same place.

**Confirmed, not reasoned:** ran 005, 008, 015 and 036 through `scripts/run-migration.mjs` after the
fix and re-queried — no policy, function or trigger came back.

## Guard

`scripts/verify-migration-run-alone.mjs` + `npm run verify:run-alone`. Two assertions:
1. **static** — no migration re-creates an object the sequence later retires without removing it again
   itself (18 retired objects across 356 files);
2. **live** — no function in the database carries a signature the sequence drops. This is the
   stale-overload check, and it is what catches a hand-run after the fact.

Proved it bites: removing the fix from 036 makes it exit 1; restoring it exits 0.

Four files OUTSIDE migrations 001–118 still carry the same shape. They are listed in a written-down
`KNOWN_BACKLOG` so the guard is green today and RED on anything new — see the handoff below.

## 🔗 HANDOFF

1. **`scripts/run-migration.mjs`** — the root cause. It should refuse, or at minimum print a loud list,
   when the file it is asked to run is not the last definer of the functions it defines. Its header
   currently promises the opposite ("safe to re-run"). Evidence: running 015 reverted `lfh_session_state`
   from 5,315 to 1,601 characters.
2. **`scripts/verify-db-grants.mjs`** — its `ANON_ALLOWED` allow-list is keyed by function NAME, so a
   stale overload of an allowed name passes. Key it by signature, or call `verify:run-alone`'s live half.
3. **Four files needing the same one-line ending** (each outside 001–118, each needs the removal its own
   later migration already wrote): `218_error_signatures.sql` → `lfh_bump_error_signature` (retired by 219) ·
   `236_write_down_the_unwritten_function.sql` → `lfh_check_ban_scoped` (retired by 281) ·
   `249_merge_is_recorded_and_reversible.sql` → `lfh_merge_group` (retired by 267) ·
   `296_database_layer_a_sweep_fixes.sql` → `lfh_check_verification` (retired by 297).
4. **`public/panels/editor/app.js`** — the Items tab shows a "Rating" text box (line ~1431) and editable
   review rows (~1281) bound to `menu_items.rating` / `menu_items.reviews`. Both columns are dead: every
   rating a guest sees comes from the `item_ratings` view. Someone types 4.8 and nothing changes anywhere.
5. **`app/api/admin/floor/route.ts:74`** — `supabaseAdmin.rpc("lfh_floor_state")` with no restaurant, so it
   answers with restaurant #1's floor by parameter default. Unreachable today (the only caller uses
   `?all=1`), so not a fault yet; it is a trap for the next caller.
6. **Pre-existing red, not mine:** `npm run verify:db-parity` fails on clean `origin/main` —
   `346_a_purge_clears_the_printing_setup.sql` and `346_usage_and_cost_answers_for_any_window.sql` share
   number 346. Both are in `origin/main`'s tree; my diff touches no 346 file. The newer one needs renumbering.

## Checked and found CLEAN (no change made)

- Every object migrations 001–118 declare is present in the dev DB or removed by a later migration (120/120).
- All 69 surviving functions from the range match their migration's body byte-for-byte — zero hand-edit drift.
- Every tenant table the range created leads on `restaurant_id`, has RLS on, and its policy has the matching
  GRANT. The documented "read POLICY with no GRANT" fault does not exist anywhere in this range.
- No `ADD COLUMN … NOT NULL` without a default; no `SET NOT NULL`; every `CREATE INDEX` and `ADD CONSTRAINT`
  survives a re-run.
- The 11 one-time data-rewriting blocks migration 307 enumerated are all still guarded or predicate-keyed.
  Migration 043's ×84 money conversion is guarded twice over — confirmed on screen: prices are whole rupees.
- The three duplicate-number pairs in the range (057, 068, 116) declare disjoint objects.
- `staff_actions.restaurant_id` being nullable is CORRECT (900 platform-level rows: owner-account admin
  actions, failed logins, client errors) and the admin Activity log reads them un-scoped.
- The 5 wide-open read policies are the ones the repo chose; column-narrowing is a rejected idea (migs 274/281).
