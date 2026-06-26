-- 100_floor_bundle_rpc.sql
-- PANEL-JAM-UNDER-LOAD FIX (owner overnight 2026-06-27): the manager floor endpoint
-- (/api/editor/sessions) made ~2 sequential round-trips to the DB (sessions, THEN
-- members+items+requests+blocklist) — and the DB is in Sydney (~250ms RTT each), so a
-- floor load cost ~950ms under load and grew with open-table count. This RPC assembles
-- the WHOLE floor in ONE server-side call (the joins happen locally in the DB), so the
-- panel makes a SINGLE round-trip (~250-300ms) instead of several. Same JSON shape the
-- endpoint already returns: { sessions, members, items, requests, blocklist }.
--
-- p_table NULL → full board; p_table set → that one table's slice (matches the existing
-- ?table= targeted-refetch path). Scoped by p_restaurant_id (the endpoint passes the
-- authed restaurant). service-role only (the endpoint calls it via supabaseAdmin).

CREATE OR REPLACE FUNCTION lfh_floor_bundle(p_restaurant_id uuid, p_table text DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT * FROM sessions
    WHERE restaurant_id = p_restaurant_id
      AND status <> 'closed'
      AND (p_table IS NULL OR table_number = p_table)
  )
  SELECT json_build_object(
    'sessions',  COALESCE((SELECT json_agg(x ORDER BY x.last_activity_at DESC) FROM s x), '[]'::json),
    'members',   COALESCE((SELECT json_agg(m ORDER BY m.joined_at)
                             FROM session_members m
                            WHERE m.session_id IN (SELECT id FROM s) AND NOT m.removed), '[]'::json),
    'items',     COALESCE((SELECT json_agg(i ORDER BY i.created_at)
                             FROM order_items i
                            WHERE i.session_id IN (SELECT id FROM s)), '[]'::json),
    'requests',  COALESCE((SELECT json_agg(r ORDER BY r.created_at)
                             FROM requests r
                            WHERE r.restaurant_id = p_restaurant_id AND r.status = 'pending'
                              AND (p_table IS NULL OR r.table_number = p_table)), '[]'::json),
    'blocklist', COALESCE((SELECT json_agg(b ORDER BY b.blocked_at DESC)
                             FROM blocklist b
                            WHERE b.restaurant_id = p_restaurant_id), '[]'::json)
  );
$$;

-- Lock down: service-role only (the editor endpoint calls it via the service-role client).
REVOKE EXECUTE ON FUNCTION lfh_floor_bundle(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_floor_bundle(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
