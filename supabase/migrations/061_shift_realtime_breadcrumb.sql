-- 061_shift_realtime_breadcrumb.sql
-- When a party is shifted to another table, the orders/calls moves only breadcrumb
-- the NEW table (+ ops), and the sessions table_number change fires no breadcrumb at
-- all. A guest still subscribed to the OLD table's realtime topic therefore gets NO
-- nudge — their table number only refreshes on the slow 60s backup poll or a manual
-- refresh. Fix: at the end of the shift, emit breadcrumbs to BOTH the old and new
-- table topics (+ ops) so old- and new-table guests (and every panel) refetch
-- instantly. Pure realtime breadcrumb — adds NO polling egress.
CREATE OR REPLACE FUNCTION lfh_staff_shift_table(p_session uuid, p_to text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_from text;
BEGIN
  SELECT * INTO v_s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_s.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  -- The destination must be empty: no open session may already live there.
  IF EXISTS (SELECT 1 FROM sessions WHERE table_number = p_to AND status = 'open') THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
  END IF;
  v_from := v_s.table_number;
  UPDATE sessions     SET table_number = p_to, last_activity_at = NOW() WHERE id = p_session;
  UPDATE orders       SET table_number = p_to WHERE session_id = p_session;
  UPDATE waiter_calls SET table_number = p_to WHERE session_id = p_session AND NOT resolved;
  -- Nudge BOTH table topics (+ ops) so guests at the OLD table refetch immediately
  -- (the moves above only reach the NEW table), and every staff panel updates too.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number) VALUES
    ('table:' || v_from, 'session', p_session::text, v_from),
    ('table:' || p_to,   'session', p_session::text, p_to),
    ('ops',              'session', p_session::text, p_to);
  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to);
END; $$;
-- New functions are PUBLIC-executable by default — keep this staff-only (migration 038 pattern).
REVOKE ALL ON FUNCTION lfh_staff_shift_table(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_shift_table(uuid, text) TO service_role;
