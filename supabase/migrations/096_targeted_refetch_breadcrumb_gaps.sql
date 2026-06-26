-- 096_targeted_refetch_breadcrumb_gaps.sql
-- Two breadcrumb gaps exposed by the manager's targeted per-table refetch (PR #45).
-- Before PR #45 the manager did a FULL board reload on every ops event, so these gaps
-- were invisible. Now that it refetches only the table(s) a breadcrumb names, any change
-- whose breadcrumb doesn't name the right table is a missed/wrong update (until the 60s
-- full-poll backstop heals it). Both fixes below are additive and safe.

-- ── FIX 1 (HIGH): table SHIFT must nudge the OLD table on the 'ops' topic too ──
-- lfh_staff_shift_table moves a party A→B. It emitted ops with table_number = NEW (B)
-- only. The manager subscribes to 'ops' (not 'table:<n>'), so it refetched ONLY B —
-- leaving the moved party showing on BOTH tile A and tile B for up to 60s. Adding an
-- 'ops' breadcrumb for the OLD table makes the accumulator collect {A,B} → pollTables
-- refetches A too → /orders?table=A & /sessions?table=A come back empty → A clears.
CREATE OR REPLACE FUNCTION lfh_staff_shift_table(p_session uuid, p_to text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_from text; v_rid uuid;
BEGIN
  SELECT * INTO v_s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_s.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF EXISTS (SELECT 1 FROM sessions WHERE table_number = p_to AND status = 'open' AND restaurant_id = v_rid) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
  END IF;
  v_from := v_s.table_number;
  UPDATE sessions     SET table_number = p_to, last_activity_at = NOW() WHERE id = p_session;
  UPDATE orders       SET table_number = p_to WHERE session_id = p_session;
  UPDATE waiter_calls SET table_number = p_to WHERE session_id = p_session AND NOT resolved;
  -- Nudge BOTH table topics (guests) AND BOTH tables on 'ops' (staff panels' targeted
  -- refetch) so the OLD table clears and the NEW table fills — no wrong/duplicated tile.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'session', p_session::text, v_from, v_rid),
    ('table:' || p_to,   'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, v_from, v_rid);  -- ← NEW: old table on ops
  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to);
END; $$;

-- ── FIX 2 (MEDIUM): voiding an invoice must fire a breadcrumb ──
-- lfh_void_invoice sets invoice_voided / void_reason / void_at — none of which were in
-- the sessions trigger's column watch-list, so a void wrote NO realtime_events row and
-- the "🔒 invoiced" lock lingered on other devices until the 60s backstop. (Generating an
-- invoice sets invoice_no, which IS watched — so locking was instant but unlocking lagged.)
-- Add the void columns to the watch-list so the unlock propagates instantly too.
DROP TRIGGER IF EXISTS rt_emit_sessions ON sessions;
CREATE TRIGGER rt_emit_sessions
  AFTER INSERT OR DELETE OR UPDATE OF status, cart, cart_updated_at, bill_no, invoice_no, auto_approve, invoice_voided, void_at ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();
