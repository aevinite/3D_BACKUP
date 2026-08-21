# T21 improvements — the database, migrations 001 to 118

## 🟢 Built (inside my territory)

1. **Migration 352 — a forgotten restaurant fails loudly.** BUILT after the owner approved it.
   Drops the `restaurant_id` DEFAULT on 20 of the 25 pre-tenancy tables, so a writer that stays
   silent gets `23502` instead of a row filed under French House. Column stays NOT NULL; no data
   changes. Five held back (`orders`, `sessions`, `session_members`, `blocklist`, `staff_actions`)
   because three test scripts insert into them without a restaurant — one-line fixes, named in the
   migration header and in the guard. `orders` and `sessions` matter most, so this is unfinished
   until that follow-up lands. Numbered 352 because 350 and 351 were both taken by other sessions
   mid-run. Guarded by `verify:run-alone` section 3.

2. **`npm run verify:run-alone`** — `scripts/verify-migration-run-alone.mjs`. Makes the ten fixes
   permanent and generalises what migrations 099, 281 and 297 each patched only for themselves.
   Static half needs no database; live half catches a hand-run after the fact. ~190 lines.

## 🟡 Not built — and why each one would have broken something

0. **DONE — see item 1 above.** (This was the `restaurant_id` DEFAULT item; the owner approved it
   on 2026-08-21 and it shipped as migration 352, minus the five tables the test scripts block.)

1. **~~Drop the `restaurant_id` DEFAULT on the 25 pre-tenancy tables.~~ SUPERSEDED by migration 352.**
   Original note kept for the reasoning: They still default to
   restaurant #1 (`orders`, `sessions`, `menu_items`, `settings`, `staff_users`, `categories`,
   `filters`, `customers`, `waiter_calls`, `staff_actions`, `order_items`, `reviews`, `requests`,
   `blocklist`, `otp_codes`, `daily_counters`, `seq_counters`, `session_members`, `realtime_events`,
   `payments`, `feedback`, `verification_codes`, `aggregator_orders`, `rate_limit_counters`,
   `rate_limit_events`). That default was the backfill device for migration 078; the "enforce" step of
   default→backfill→enforce was never done. Every table created AFTER tenancy correctly has no default.
   Consequence: any future write path that forgets to scope lands silently in French House instead of
   failing loudly. Needs a migration; if any live path relies on the default it turns a silent
   mis-scope into a hard error, which is why it is a decision and not a fix.

2. **Tighten the `p_restaurant_id` parameter default on 25 scoped RPCs.** Same shape one layer up:
   `lfh_floor_state`, `lfh_table_view_summary`, `lfh_price_order`, `lfh_staff_place_order` and 21 others
   default the restaurant to #1. Of 55 call sites in the app, exactly one omits it, and that branch is
   unreachable. Removing the defaults means 25 function signatures change; that is a migration and a
   real rollout risk, so it is his call.

3. **Retire `menu_items.rating` and `menu_items.reviews`.** Dead columns (0 of 464 rows carry data);
   every rating a guest sees comes from `item_ratings`. Dropping them needs a migration AND the editor's
   Items tab to stop offering the boxes — two territories, so listed rather than done.

4. **Retire `lfh_request_verification` and the `verification_codes` table.** The surviving half of a
   stub whose partner has now been removed three times. Migration 297 says it is "safe to drop when
   someone decides to"; `scripts/verify-families.mjs` asserts it answers 'disabled', so the guard moves
   with it. One-line DROP plus a guard edit — a product decision, not a fault.

## Assessed after the owner asked for 8, 9 and 10 (2026-08-21) — each was REFUSED with a reason

**Item 8 — the RPC `p_restaurant_id` defaults. NOT the same as item 7.** Item 7 removed a guess from
a COLUMN, where nothing in production relied on it. Item 8 removes it from 25 FUNCTION SIGNATURES,
and every caller that omits the argument starts failing. The omitting callers are
`app/api/admin/floor/route.ts:74` plus `scripts/stress.mjs`, `scripts/stress-max.mjs`,
`scripts/verify-manager-live-rush.mjs`, `scripts/verify-table-lifecycle.mjs`,
`scripts/verify-two-parties.mjs` and `scripts/verify-write-paths.mjs` — one route and four of the
owner's own guards, none of them this terminal's files. The payoff is near zero: of 55 production
call sites, exactly ONE omits the restaurant and that branch is unreachable. **Recommendation: fix
the single real omission (one line in `app/api/admin/floor/route.ts`) instead of churning 25
signatures.**

**Item 9 — dropping `menu_items.rating` / `.reviews` would break EVERY dish save.** The editor's
dish-save handler (`app/api/editor/[...path]/route.ts:4544`) is a DENY-list, not an allow-list: it
deletes the fields a person may not edit and passes everything else straight to `menu_items`. Its own
comment says "a column added later lands in the CONSERVATIVE bucket". So `rating` and `reviews` reach
the table on every save, and dropping the columns makes PostgREST reject the write — a manager could
not edit any dish. **Correct order: strip the two fields from `public/panels/editor/app.js` (~1281,
~1431) FIRST, then drop the columns.**

**Item 10 — retiring `lfh_request_verification` + `verification_codes` would turn three guards red.**
`scripts/verify-families.mjs:147` calls it and asserts it answers `'disabled'`; `verify-db-parity`
and `verify-db-grants` both expect it to exist. All three are outside this territory, so the drop and
the guard edits must land in one change.
