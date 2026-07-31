-- 244 — DROP A DEAD COPY OF THE HEATMAP FUNCTION (2026-07-31)
--
-- `npm run verify:db-parity` listed five functions living on the database that no migration
-- creates. FOUR were the banquet ones, and another session wrote those down the same day
-- (migrations 237 and 239 — nothing to add here). The fifth is this one:
--
--   lfh_owner_heatmap_old
--
-- It is called by NOTHING — not by app code, not from inside any other database function — and
-- the real `lfh_owner_heatmap` is what the owner panel uses (migration 199, rewritten in 241).
-- Writing a dead copy into this folder would enshrine confusion, so it is dropped instead: after
-- this, "every live function is created by a migration in this folder" is true because there is
-- no orphan left, not because we blessed one.
--
-- It also carried EXECUTE for anon and authenticated, which no reporting function should have —
-- one more reason not to keep it lying around (see the grants gotcha in migration 038).
--
-- IF a report ever turns out to need it, the definition is not lost: it is the pre-241 body of
-- lfh_owner_heatmap, which lives in migration 199.
DROP FUNCTION IF EXISTS public.lfh_owner_heatmap_old(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.lfh_owner_heatmap_old(uuid, timestamptz, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.lfh_owner_heatmap_old(uuid, date, date);
