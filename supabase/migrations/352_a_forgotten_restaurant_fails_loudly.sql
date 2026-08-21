-- 352_a_forgotten_restaurant_fails_loudly.sql
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
-- WHAT THIS DOES. Drops the DEFAULT on 20 of the 25. The column stays NOT NULL, so a writer that
-- forgets now gets an immediate, loud `null value in column "restaurant_id"` instead of a wrong row.
-- No data changes. No column is added or removed. Reversible with one ALTER per table.
--
-- WHY 20 AND NOT 25 — read this before "finishing the job". Five are deliberately left alone
-- because three TEST scripts still insert into them without a restaurant, and those files are not
-- this migration's to change:
--     orders           · scripts/seed-today.mjs:65, scripts/verify-tablet-parity.mjs:39
--     sessions         · scripts/verify-realtime.mjs:69, scripts/verify-tablet-parity.mjs:37
--     session_members  · scripts/verify-tablet-parity.mjs:38
--     blocklist        · scripts/verify-tablet-parity.mjs:48
--     staff_actions    · scripts/verify-realtime.mjs:82, and lfh_prune_audit() writes its own
--                        platform-level log line with no restaurant — which is CORRECT, because
--                        that column is deliberately nullable here (an owner-account action or a
--                        failed login belongs to no restaurant). Dropping its default is still the
--                        right end state — the prune's line would become NULL instead of being
--                        mis-filed under French House — but it belongs with the script fix.
-- Each of those is one line: add `restaurant_id: <the test restaurant>` to the insert. Once they
-- are fixed, the remaining five are five more ALTERs exactly like the ones below. `orders` and
-- `sessions` are the two that matter most, so this is not finished until that follow-up lands.
--
-- VERIFIED BEFORE WRITING, against the live dev database and the whole repo — for these 20:
--   · 0 live function bodies insert into them without naming restaurant_id (all 190 checked,
--     including the high-traffic ones: lfh_rt_emit → realtime_events, lfh_next_counter_on →
--     daily_counters, lfh_next_seq → seq_counters all pass it explicitly);
--   · 0 places in app/, lib/, components/ or public/panels/ insert into them without it;
--   · 0 scripts insert into them without it;
--   · all 20 already have restaurant_id NOT NULL, so nothing about what is allowed changes —
--     only what happens when a writer stays silent.
-- Earlier migrations are unaffected: this file sorts after all of them, so every INSERT in the
-- seed sequence has already run while the default was still in place.

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

NOTIFY pgrst, 'reload schema';
