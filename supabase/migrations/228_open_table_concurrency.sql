-- 228_open_table_concurrency.sql — opening a table can't crash when two people tap at once.
--
-- THE BUG (error log, 2026-07-26 + the same shape reported before):
--   duplicate key value violates unique constraint "idx_one_open_session_per_table"
-- lfh_staff_open_table (mig 114) does SELECT-then-INSERT with nothing serialising the two
-- steps, and the tablet/manager "Open" endpoints do the same check in JS. Two devices tapping
-- Open on the same table in the same instant both see "no open session", both INSERT, and the
-- second one hits the unique index and surfaces as a raw 500 to whoever tapped second — on a
-- busy floor that is two waiters seating the same party.
--
-- THE FIX — the pattern already used by lfh_staff_place_order (mig 202) and
-- lfh_staff_shift_table (mig 217), so all three now serialise on the SAME key:
--   1. a transaction-scoped advisory lock on ('lfh_place:<restaurant>:<table>') at the top, so
--      a near-simultaneous second call waits and then simply finds the session the first one
--      opened (and returns it, which is the correct answer — the table IS open);
--   2. a unique_violation handler as a belt-and-braces net for any caller that reaches the
--      INSERT without the lock (an old client, a direct call): it re-reads the winning row and
--      returns that instead of throwing.
-- Opening a table is idempotent by nature, so "someone else opened it first" is a success,
-- never an error.

CREATE OR REPLACE FUNCTION lfh_staff_open_table(p_restaurant_id uuid, p_table text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max      int;
  v_num      int;
  v_existing sessions;
  v_row      sessions;
BEGIN
  v_num := NULLIF(p_table, '')::int;
  IF v_num IS NULL OR v_num < 1 THEN
    RETURN jsonb_build_object('error', 'invalid table number');
  END IF;

  SELECT COALESCE(table_count, 0) INTO v_max FROM settings WHERE restaurant_id = p_restaurant_id;
  IF v_max > 0 AND v_num > v_max THEN
    RETURN jsonb_build_object('error', format('Table %s doesn''t exist — tables are 1–%s.', v_num, v_max));
  END IF;

  -- Serialize concurrent opens of the SAME table for this restaurant. Same key as
  -- lfh_staff_place_order / lfh_staff_shift_table so an open can't interleave with a
  -- placement or a move either. Transaction-scoped: released on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || p_restaurant_id::text || ':' || COALESCE(p_table, ''), 0));

  SELECT * INTO v_existing FROM sessions
    WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status <> 'closed'
    LIMIT 1;

  IF FOUND THEN
    UPDATE sessions
       SET status = 'open', opened_by = 'waiter',
           opened_at = COALESCE(v_existing.opened_at, now()), last_activity_at = now()
     WHERE id = v_existing.id
     RETURNING * INTO v_row;
  ELSE
    BEGIN
      INSERT INTO sessions (table_number, status, opened_by, opened_at, last_activity_at, restaurant_id)
      VALUES (p_table, 'open', 'waiter', now(), now(), p_restaurant_id)
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      -- Someone opened it between our SELECT and INSERT (a caller that skipped the lock).
      -- The table is open, which is what was asked for — return the row that won.
      SELECT * INTO v_row FROM sessions
        WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status <> 'closed'
        LIMIT 1;
      IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('error', 'Could not open that table — try again.');
      END IF;
    END;
  END IF;

  -- Opening the table answers any pending "asked to open" request for it.
  UPDATE requests SET status = 'approved'
    WHERE restaurant_id = p_restaurant_id AND table_number = p_table AND status = 'pending';

  RETURN to_jsonb(v_row);
END; $$;

-- Lock down: service-role only (the panel endpoints call it via supabaseAdmin).
REVOKE EXECUTE ON FUNCTION lfh_staff_open_table(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_open_table(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
