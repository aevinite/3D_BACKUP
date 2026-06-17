-- 065_session_state_item_details.sql — show allergies/customizations in the
-- guest's LIVE SESSION view.
--
-- The guest "Live status" tab (SessionTableBill) reads lfh_session_state(). Until
-- now its `items` array returned only id/title/qty/status, so the options, removed
-- allergens ("no milk") and free-text note the guest added when ordering were
-- INVISIBLE in the live view — even though the "Current bill" tab shows them. This
-- adds those three fields to each item so the live view can render them and a
-- per-bill "left out" summary. CREATE OR REPLACE keeps everything else identical
-- to migration 034 (SECURITY DEFINER, search_path, anon grant).
CREATE OR REPLACE FUNCTION lfh_session_state(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions; v_removed session_members;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN
    SELECT * INTO v_removed FROM session_members WHERE token = p_token AND removed;
    IF FOUND THEN
      -- Removed because the whole table closed, or removed personally?
      IF EXISTS (SELECT 1 FROM sessions WHERE id = v_removed.session_id AND status = 'closed') THEN
        RETURN json_build_object('ok', false, 'reason', 'session_closed');
      END IF;
      RETURN json_build_object('ok', false, 'reason', 'removed');
    END IF;
    RETURN json_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  RETURN json_build_object(
    'ok', true,
    'session', json_build_object('id', v_s.id, 'table_number', v_s.table_number, 'status', v_s.status, 'auto_approve', v_s.auto_approve),
    'member',  json_build_object('id', v_m.id, 'role', v_m.role, 'approved', v_m.approved, 'phone_verified', v_m.phone_verified, 'name', v_m.name),
    'members', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'role', role, 'approved', approved, 'phone_verified', phone_verified) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT removed), '[]'::json),
    'pending', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT approved AND NOT removed), '[]'::json),
    'items',   COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'qty', qty, 'status', status,
                                                           'options', options, 'removed', removed, 'note', note) ORDER BY created_at)
                          FROM order_items WHERE session_id = v_s.id), '[]'::json),
    -- Order-level rows so every member's tracker can follow each order's status.
    'orders',  COALESCE((SELECT json_agg(json_build_object('id', id, 'status', status, 'total', total, 'items', items, 'created_at', created_at) ORDER BY created_at)
                          FROM orders WHERE session_id = v_s.id AND status <> 'cancelled'), '[]'::json),
    'bill',    (SELECT json_build_object('subtotal', COALESCE(SUM(subtotal), 0), 'tax', COALESCE(SUM(tax), 0), 'total', COALESCE(SUM(total), 0))
                        FROM orders WHERE session_id = v_s.id AND status <> 'cancelled'),
    'calls',   COALESCE((SELECT json_agg(json_build_object('id', id, 'note', note, 'status', CASE WHEN resolved THEN 'attended' ELSE 'open' END) ORDER BY created_at DESC)
                          FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved), '[]'::json));
END; $$;

GRANT EXECUTE ON FUNCTION lfh_session_state(text) TO anon;

NOTIFY pgrst, 'reload schema';
