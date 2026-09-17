-- 236_write_down_the_unwritten_function.sql
-- (renumbered from 235 the same day: another session's 235_access_model_v2.sql landed in parallel.
--  Two files with the same number make "which ran first?" unanswerable — verify-db-parity now
--  fails on a duplicate number so the next collision is caught before it is merged.)
--
-- HOUSEKEEPING WITH TEETH, from the owner's "check everything again, go to the root" pass.
--
-- Comparing the two live databases against each other AND against this folder turned up
-- lfh_check_ban_scoped: a function running on BOTH databases that **no migration file creates**.
-- Nobody wrote it down. Consequences if it had stayed that way:
--   • rebuilding a database from supabase/migrations/ would come up WITHOUT it, and the guest
--     app's "is this device/phone blocked for this restaurant?" check would fail at runtime;
--   • a new restaurant stack (or a restored backup) would silently differ from the two we have.
-- It is captured here VERBATIM from the live definition (pg_get_functiondef), with the exact
-- grants it already carries — anon may call it, because the GUEST app is what asks.
--
-- This is the same disease as the qty guard in mig 234: a change made straight on a database
-- instead of through this folder. `npm run verify:db-parity` now fails on both shapes — a
-- function missing from the folder, and a substantial function whose live body no longer
-- matches anything written here.

CREATE OR REPLACE FUNCTION public.lfh_check_ban_scoped(p_device text, p_phone text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row blocklist;
BEGIN
  IF p_restaurant_id IS NULL THEN RETURN json_build_object('banned', false); END IF;
  SELECT * INTO v_row FROM blocklist
    WHERE restaurant_id = p_restaurant_id
      AND ( (p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
         OR (p_phone  IS NOT NULL AND p_phone  <> '' AND phone     = p_phone) )
    LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('banned', false); END IF;
  RETURN json_build_object('banned', true, 'reason', v_row.reason,
                           'unban_requested', v_row.unban_requested_at IS NOT NULL);
END $function$;
-- Grants exactly as they are live: the guest app calls this through the anon key.
REVOKE ALL ON FUNCTION lfh_check_ban_scoped(text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION lfh_check_ban_scoped(text, text, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ⚠️ RUN-ALONE GUARD (sweep #9, T32, 2026-09-18).
-- `lfh_check_ban_scoped` above is RETIRED. Migration 267 dropped it, and migration 281 dropped it a
-- second time while saying the quiet part out loud about this very file: "if 236 is ever re-run
-- alone they will come back". Migration 293 then made the ban question the guest's own — one door,
-- `lfh_check_ban`, scoped to the restaurant that is asking.
--
-- Left as it was, running THIS FILE ALONE — the single-file route CLAUDE.md actually recommends
-- (`node scripts/run-migration.mjs 236_…`) — puts a second ban-check door back beside the real one
-- AND re-grants it to the public menu key, because the GRANT is two lines above. Two doors that
-- answer "is this guest blocked?" is exactly the state migrations 267, 281 and 293 spent three
-- files removing.
--
-- A FULL re-seed already ends correctly (267, 281 and 293 all sort after this file). Idempotent,
-- and safe where it does not exist. Guarded by `npm run verify:run-alone`.
DROP FUNCTION IF EXISTS public.lfh_check_ban_scoped(text, text, uuid);
