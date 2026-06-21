-- 076_pending_gate_and_table_session_id.sql
-- Two guest-session hardening fixes the owner hit while testing rejoin (2026-06-21):
--
-- 1. PENDING MEMBERS MUST NOT SEE THE LIVE TABLE. lfh_session_state returned the
--    table's orders/items/bill to ANY non-removed token holder — so a guest still
--    "waiting for the head to let you in" could already watch what's being prepared.
--    Now the live order data (items / orders / bill) is returned ONLY to an APPROVED
--    member; a pending member gets empty arrays + a zero bill (they still get their
--    own member.approved=false so the UI shows the waiting screen). Server-side gate
--    so it can't be bypassed from the client. (members/pending/calls are unchanged.)
--
-- 2. NAME PERSISTS FOR THE SAME OPEN SESSION. lfh_table_status now also returns the
--    open session's id, so the guest app can tell it's RE-joining the SAME session
--    on this table (vs a brand-new one staff opened later) and reuse the name the
--    device already gave — instead of asking for it again on every rejoin.

-- ── 1. session state: live order data is APPROVED-only ──────────────────────
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
    -- LIVE ORDER DATA — APPROVED MEMBERS ONLY. A guest still waiting for the head
    -- must not see the table's dishes-in-progress, orders, or running bill.
    'items',   CASE WHEN v_m.approved
                 THEN COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'qty', qty, 'status', status,
                                                                  'options', options, 'removed', removed, 'note', note) ORDER BY created_at)
                                FROM order_items WHERE session_id = v_s.id), '[]'::json)
                 ELSE '[]'::json END,
    'orders',  CASE WHEN v_m.approved
                 THEN COALESCE((SELECT json_agg(json_build_object('id', id, 'status', status, 'total', total, 'items', items, 'created_at', created_at) ORDER BY created_at)
                                FROM orders WHERE session_id = v_s.id AND status <> 'cancelled'), '[]'::json)
                 ELSE '[]'::json END,
    'bill',    CASE WHEN v_m.approved
                 THEN (SELECT json_build_object('subtotal', COALESCE(SUM(subtotal), 0), 'tax', COALESCE(SUM(tax), 0), 'total', COALESCE(SUM(total), 0))
                       FROM orders WHERE session_id = v_s.id AND status <> 'cancelled')
                 ELSE json_build_object('subtotal', 0, 'tax', 0, 'total', 0) END,
    'calls',   COALESCE((SELECT json_agg(json_build_object('id', id, 'note', note, 'status', CASE WHEN resolved THEN 'attended' ELSE 'open' END) ORDER BY created_at DESC)
                          FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved), '[]'::json));
END; $$;

GRANT EXECUTE ON FUNCTION lfh_session_state(text) TO anon;

-- ── 2. table status: also return the open session's id ──────────────────────
CREATE OR REPLACE FUNCTION lfh_table_status(p_table text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_count int;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT * INTO v_s FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'open', false, 'members', 0); END IF;
  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_s.id AND NOT removed;
  RETURN json_build_object('ok', true, 'open', true, 'members', v_count,
                           'session_id', v_s.id, 'last_activity_at', v_s.last_activity_at);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_table_status(text) TO anon;

NOTIFY pgrst, 'reload schema';
