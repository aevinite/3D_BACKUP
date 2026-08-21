-- 358_a_forgotten_restaurant_fails_loudly.sql
--
-- THE TRAP. When multi-restaurant support landed (migration 078), every table that already existed
-- was given `restaurant_id … DEFAULT '00000000-0000-0000-0000-000000000001'`. That default was the
-- BACKFILL device: it let 078 add a NOT NULL column to tables already full of rows without a
-- rewrite, and it kept every existing write path working while the app was made tenant-aware.
--
-- The rule for an additive change here is default → backfill → ENFORCE. The first two steps
-- happened. The third never did. So on 25 pre-tenancy tables the default is still sitting there,
-- three hundred migrations later, quietly meaning: "if a writer forgets to say which restaurant,
-- file it under French House." Every table created AFTER tenancy correctly has no default and
-- refuses to guess — so the schema currently disagrees with itself about the most important
-- column in it.
--
-- Nothing is wrong today: every production write path names its restaurant. The cost is what
-- happens NEXT. A new module, a new script, a hand-written INSERT, or an old function body brought
-- back by a single-file migration run (see migration 099 and the 001–118 sweep) lands silently in
-- French House instead of failing. That is the same family as the recurring "restaurant #1's
-- branding leaked onto another tenant" bug, and it is the shape that is hardest to notice: the row
-- is not missing, it is in somebody else's restaurant.
--
-- WHAT THIS DOES. Drops the DEFAULT on all 25. The column stays as it was — NOT NULL on 24 of
-- them, and deliberately NULLABLE on `staff_actions`, where a platform-level row (an owner-account
-- admin action, a failed login, the nightly prune's own log line) genuinely belongs to no
-- restaurant. So a writer that forgets now gets an immediate `null value in column "restaurant_id"`
-- on 24 tables, and on `staff_actions` gets an honest NULL instead of being mis-filed under French
-- House. No data changes. No column is added or removed. Reversible with one ALTER per table.
--
-- WHY THE LAST FIVE WERE HELD BACK AT FIRST, AND WHAT UNBLOCKED THEM. `orders`, `sessions`,
-- `session_members`, `blocklist` and `staff_actions` were left defaulted in the first version of
-- this file because two TEST fixtures still inserted into them without naming a restaurant:
--   scripts/verify-realtime.mjs      — a throwaway session, and its staff_actions self-test row
--   scripts/verify-tablet-parity.mjs — a throwaway session, member, order and blocklist row
-- Both always meant restaurant #1; they simply never said so. They now pass it explicitly (one
-- `R1` constant each), so the last five are included here and the split is gone. `orders` and
-- `sessions` are the two that matter most, which is exactly why this file is not worth shipping
-- half-done. `scripts/seed-today.mjs` needed no change — it already passes `restaurant_id: r.id`.
--
-- VERIFIED BEFORE WRITING, against the live dev database and the whole repo:
--   · 0 live function bodies insert into any of the 25 without naming restaurant_id (all 190
--     checked, including the high-traffic ones: lfh_rt_emit -> realtime_events,
--     lfh_next_counter_on -> daily_counters, lfh_next_seq -> seq_counters all pass it explicitly).
--     The ONE exception is lfh_prune_audit(), which writes its own platform-level line into
--     staff_actions with no restaurant — and that is CORRECT: it should be NULL, not French House.
--     Dropping the default there is the fix, not the risk.
--   · 0 places in app/, lib/, components/ or public/panels/ insert into any of them without it;
--   · 0 scripts, after the two fixture fixes above.
-- Earlier migrations are unaffected: this file sorts after all of them, so every INSERT in the seed
-- sequence has already run while the default was still in place.

ALTER TABLE aggregator_orders    ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE categories           ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE customers            ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE daily_counters       ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE feedback             ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE filters              ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE menu_items           ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE order_items          ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE otp_codes            ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE payments             ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE rate_limit_counters  ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE rate_limit_events    ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE realtime_events      ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE requests             ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE reviews              ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE seq_counters         ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE settings             ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE staff_users          ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE verification_codes   ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE waiter_calls         ALTER COLUMN restaurant_id DROP DEFAULT;

ALTER TABLE orders               ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE sessions             ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE session_members      ALTER COLUMN restaurant_id DROP DEFAULT;
ALTER TABLE blocklist            ALTER COLUMN restaurant_id DROP DEFAULT;
-- staff_actions keeps its NULLABLE column on purpose (platform-level rows). Only the guess goes.
ALTER TABLE staff_actions        ALTER COLUMN restaurant_id DROP DEFAULT;

NOTIFY pgrst, 'reload schema';
