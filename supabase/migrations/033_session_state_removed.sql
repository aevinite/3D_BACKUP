-- Tell a waiting guest's phone WHEN IT WAS DECLINED. Before this, a partner
-- whose join request the head denied (= their member row got removed=true)
-- kept polling lfh_session_state and only ever saw a generic 'invalid_token',
-- which the join screen treated the same as "still waiting" — so the guest sat
-- on the waiting spinner forever. Now a removed token gets its own answer
-- ('removed'), letting the app show "the table declined your request" with
-- next steps (call a waiter / try another table). Everything else is identical
-- to migration 028's version of this function.

CREATE OR REPLACE FUNCTION lfh_session_state(p_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_m session_members; v_s sessions;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN
    -- The token exists but the member was removed: that's a decline/kick.
    -- Answer 'removed' so the guest's screen can say so instead of waiting.
    IF EXISTS (SELECT 1 FROM session_members WHERE token = p_token AND removed) THEN
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
    'items',   COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'qty', qty, 'status', status) ORDER BY created_at)
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
