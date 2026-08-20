# T21 improvements — the database, migrations 001 to 118

## 🟢 Built (inside my territory)

1. **`npm run verify:run-alone`** — `scripts/verify-migration-run-alone.mjs`. Makes the ten fixes
   permanent and generalises what migrations 099, 281 and 297 each patched only for themselves.
   Static half needs no database; live half catches a hand-run after the fact. ~190 lines.

## 🟡 Not built — needs a decision from the owner

1. **Drop the `restaurant_id` DEFAULT on the 25 pre-tenancy tables.** They still default to
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
