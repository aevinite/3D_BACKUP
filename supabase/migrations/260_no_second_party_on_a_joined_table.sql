-- 260 — A JOINED TABLE CANNOT BE GIVEN A SECOND PARTY (2026-08-02)
--
-- Found while checking the merge feature end to end. Merge T27 into T28 and the two become one
-- party held by T27, with T28 recorded as its child (mig 249). The manager panel handles that
-- correctly — a child tile is not a free tile, tapping it opens the joint bill, and it reads
-- "⇄ with T27". But the ENDPOINT underneath had no such rule: calling lfh_staff_open_table on
-- the joined table cheerfully created a SECOND session there.
--
-- Why that matters, even though no button offers it: the floor then holds one table that is
-- simultaneously "part of T27's party" and "a new party of its own", and an unmerge later moves
-- the first party's order onto the table the NEW people are sitting at — someone else's food and
-- someone else's money on their bill. That is the one thing the table rules exist to prevent
-- ("a table shows only its own party"), and hiding the button was the only thing preventing it.
--
-- The refusal names the parent, so a caller can send the person to the joint bill instead of
-- showing them a dead end. Shape matches the function's existing refusals ({error: …}), with a
-- machine-readable reason beside it — never make a panel pattern-match on prose.
CREATE OR REPLACE FUNCTION lfh_staff_open_table(p_restaurant_id uuid, p_table text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max      int;
  v_num      int;
  v_existing sessions;
  v_row      sessions;
  v_parent   text;
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

  -- NEW (mig 260): is this table currently being served as part of another table's party? Read
  -- INSIDE the lock, so a merge landing at the same instant can't slip a second party through.
  SELECT m.parent_table INTO v_parent FROM table_merges m
   WHERE m.restaurant_id = p_restaurant_id AND m.child_table = p_table AND m.ended_at IS NULL
   LIMIT 1;
  IF v_parent IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'merged_child',
      'parent_table', v_parent,
      'error', format('Table %s is joined with table %s — it shares that bill. Unmerge it first to seat a new party.', p_table, v_parent));
  END IF;

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

REVOKE EXECUTE ON FUNCTION lfh_staff_open_table(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_open_table(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
