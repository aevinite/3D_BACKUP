-- 198_parcel_default_manager_on.sql — parcel is ON for MANAGERS, OFF for TABLET, by default
-- (owner 2026-07-26). Parcel/takeaway is a common counter task most restaurants want, so —
-- unlike a locked premium module — it ships on for the manager everywhere (admin can still
-- switch it OFF per restaurant), while the waiter tablet stays off until explicitly granted
-- (takeaway is usually handled at the counter, not by floor waiters).

-- The DEFAULT is not a data rewrite and is safe at any time.
ALTER TABLE settings ALTER COLUMN parcel_allowed SET DEFAULT true;

-- ⚠️ ONE-TIME — GUARDED SINCE 2026-08-13 (T16 finding 7510). The three statements below have no
-- WHERE that tests ABSENCE: they exist to OVERWRITE a stored value. seed-supabase.mjs re-runs
-- every file in this folder, so on a re-seed they used to hand a manager back the parcel power an
-- admin had switched OFF, and reset the waiter tablet switch — the access model being rewritten by
-- a seed script, which is exactly the fault migration 307 exists to prevent (it audited 001–150
-- only, so this file was never checked). Same guard shape as 043/093, and the same
-- `to_regprocedure` gate because the helper arrives with migration 307, long after this file.
DO $reseed_guard$
DECLARE v_applied boolean := false;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('198_parcel_default_manager_on') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '198_parcel_default_manager_on: already applied — skipped (a re-run would undo an admin''s parcel choices)';
  RETURN;
END IF;

-- 1) Backfill every existing restaurant ON.
UPDATE settings SET parcel_allowed = true;

-- 2) Tablet capability stays OFF by default; reset every restaurant to off (incl. the
--    French House demo that was flipped on during build) so "off for tablet" holds.
UPDATE settings SET tablet_parcel = 'off';

-- 3) Managers granted parcel by default — backfill the grant on every restaurant so the
--    server (managerCan reads an ABSENT key as false) and the UI agree (display = truth,
--    the banquet-default lesson). New restaurants get it from NR_MP_DEFAULT / MP_DEFAULT.
UPDATE restaurants
   SET manager_permissions = COALESCE(manager_permissions, '{}'::jsonb) || '{"parcel": true}'::jsonb;
END $reseed_guard$;

NOTIFY pgrst, 'reload schema';
