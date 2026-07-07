-- 145 — lfh_admin_floor_all(): the ENTIRE platform's live floor in ONE call.
--
-- The admin "all restaurants" floor used to call lfh_floor_state() once PER restaurant from
-- the app (N app→DB round-trips per refresh — 100 restaurants = 100 requests fired at once).
-- This wraps that fan-out INSIDE Postgres: one round-trip from the app, the per-restaurant
-- work happens server-side. It also TRIMS each tile to only the 4 fields the admin mini-tiles
-- render (table number, state, pay dot, call badge) — so no order rows and, importantly, NO
-- money (`due`) ever leave the database for the admin (admin sees no earnings).
--
-- Staff-only: revoked from the public/anon/authenticated keys, granted to service_role only
-- (the API calls it with the service-role key behind the admin cookie gate).

CREATE OR REPLACE FUNCTION public.lfh_admin_floor_all()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rid   uuid;
  v_tiles json;
  v_out   json[] := '{}';
BEGIN
  FOR v_rid IN
    SELECT id FROM restaurants WHERE deleted_at IS NULL ORDER BY name
  LOOP
    -- Reuse the single source of truth for a table's state, then keep only the 4 rendered
    -- fields (drops the orders array + the money `due`, so the payload stays tiny + money-free).
    SELECT COALESCE(json_agg(json_build_object(
             'n', e->>'table_number',
             's', e->>'state',
             'p', COALESCE(e->>'pay', ''),
             'c', COALESCE((e->>'has_call')::boolean, false)
           )), '[]'::json)
      INTO v_tiles
      FROM json_array_elements(public.lfh_floor_state(v_rid)) e;

    v_out := array_append(v_out, json_build_object('restaurant_id', v_rid, 'tables', v_tiles));
  END LOOP;

  RETURN array_to_json(v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.lfh_admin_floor_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_admin_floor_all() TO service_role;

NOTIFY pgrst, 'reload schema';
