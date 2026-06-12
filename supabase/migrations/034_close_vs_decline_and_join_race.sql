-- Edge-case hardening (owner asked for a "1-in-1000 glitches" hunt, 2026-06-12).
-- Three fixes in one migration:
--
-- 1. CLOSED TABLE vs DECLINED GUEST get different answers. Closing a session
--    marks every member removed (trigger in migration 020), so after migration
--    033 a partner waiting to join when staff closed the table would be told
--    'removed' — and their phone would say "the table didn't let you in", which
--    is wrong (nobody declined them; the table just ended). Now: a removed
--    member whose session is CLOSED gets 'session_closed'; a removed member of
--    a still-open session got kicked/declined for real and keeps 'removed'.
--
-- 2. THE TWO-HEADS RACE. lfh_join_session counted members and THEN inserted —
--    two phones joining an empty table in the same instant both counted 0 and
--    both became head. An advisory transaction lock on the session id now
--    serializes concurrent joins (second phone waits a few ms, then counts 1).
--
-- 3. A DATABASE-LEVEL GUARANTEE of one active head per table: a unique partial
--    index, so even buggy future code can never create a second active owner.

-- ── 1. session state: distinguish "table ended" from "you were declined" ────
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

-- ── 2. join: serialize concurrent joins so only ONE first guest becomes head ─
CREATE OR REPLACE FUNCTION lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  IF NOT lfh_geo_ok(p_lat, p_lng) THEN RETURN json_build_object('ok', false, 'reason', 'too_far'); END IF;

  -- Staff must have opened the table first. No auto-open.
  SELECT * INTO v_session FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_open_session'); END IF;

  -- One join per session AT A TIME: the second of two simultaneous joiners waits
  -- here a few milliseconds until the first commits, then counts them correctly.
  -- (Without this, both counted 0 members and BOTH became the table's head.)
  PERFORM pg_advisory_xact_lock(hashtextextended(v_session.id::text, 0));

  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_session.id AND NOT removed;
  v_token := replace(gen_random_uuid()::text, '-', '');
  IF v_count = 0 THEN
    v_role := 'owner'; v_approved := true;            -- first guest at an opened table = head
  ELSE
    v_role := 'guest'; v_approved := v_session.auto_approve;
  END IF;

  INSERT INTO session_members(session_id, name, token, role, approved, location_ok)
    VALUES (v_session.id, p_name, v_token, v_role, v_approved, true)
    RETURNING id INTO v_member;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_session.id;

  RETURN json_build_object('ok', true, 'token', v_token, 'member_id', v_member,
    'session_id', v_session.id, 'role', v_role, 'approved', v_approved);
END; $$;

GRANT EXECUTE ON FUNCTION lfh_join_session(text, text, double precision, double precision) TO anon;

-- ── 3. hard rule: a session can never have TWO active heads ─────────────────
-- First demote any duplicates an old race already created (keep the earliest),
-- then add the unique rule so it can never happen again.
UPDATE session_members m SET role = 'guest'
  WHERE role = 'owner' AND NOT removed
    AND EXISTS (SELECT 1 FROM session_members m2
                 WHERE m2.session_id = m.session_id AND m2.role = 'owner'
                   AND NOT m2.removed AND m2.joined_at < m.joined_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_owner_per_session
  ON session_members(session_id) WHERE role = 'owner' AND NOT removed;

NOTIFY pgrst, 'reload schema';
