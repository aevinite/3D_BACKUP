-- 312 — JOINING TWO TABLES MUST NOT THROW AWAY A TABLE'S MARK
--
-- THE GAP (T3 floor sweep, 2026-08-10). A table can be marked 👑 VIP, 🏠 Family or
-- 🤝 Owner's guest (mig 166). Merging two tables closes the higher-numbered table's party
-- (`UPDATE sessions SET status='closed'` in lfh_staff_merge_tables) — and that fires
-- `clear_table_tag_on_close`, whose whole job is "a mark belongs to THAT party, so remove it when
-- the party ends". For a merge that reasoning is wrong: the party has not ended, it has moved onto
-- one bill with another party. So the mark was deleted, in silence, on the one action that puts two
-- tables' money together.
--
-- IT COST MORE THAN A RIBBON. `tables/:t/on-the-house` (the manager route) already looks for the
-- comp mark on the parent AND on every child of the party, with the comment: *"The mark may sit on
-- ANY member of a merged party — the family sat at T29 before it was joined to T28; their comp must
-- not stop working because the bill now lives on T28."* That careful lookup could never find
-- anything, because the child's row was gone by the time the merge returned. So the free-of-charge
-- settle a Family / Owner's-guest table exists for was refused after a merge, with the message "On
-- the house is only for tables marked Family or Owner's Guest" about a table that was.
--
-- THE FIX, and why it is this one. Its own mirror image already gets this right:
-- lfh_staff_shift_table MOVES the tag with the party ("the mark belongs to the PARTY — move it with
-- them"). Merge is the case where BOTH tables have a live party, so "move it" would have to pick a
-- winner. It doesn't have to: the mark stays on the table it was put on. The tag row is captured
-- before the close and put back after it, so
--   · the ribbon stays on the table where those guests are actually sitting;
--   · the on-the-house lookup above finds it, unchanged;
--   · an UNMERGE needs no new code — the mark is still where it was, so the table gets it back
--     along with its own party;
--   · a parent that has its OWN mark keeps it. Two marks in one party is the truth, not a clash.
--
-- Nothing else in the function changes: this is mig 308's body with two statements added around the
-- close. The signature is identical, so there is no overload to trip over (the mig 308 lesson).
-- REVOKE/GRANT repeated as always (the mig 038/267 lesson).
--
-- Guard: npm run verify:merge-keeps-mark

CREATE OR REPLACE FUNCTION lfh_staff_merge_tables(p_session uuid, p_to text, p_rid uuid, p_actor text DEFAULT NULL, p_actor_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a       sessions;   -- the party the caller started from
  v_b       sessions;   -- the party on the table they picked
  v_keep    sessions;   -- the one that survives = the LOWER table number (his rule)
  v_drop    sessions;   -- the one whose rows move across
  v_to      text;
  v_child   text;
  v_parent  text;
  v_actor   text := COALESCE(NULLIF(btrim(p_actor), ''), NULLIF(current_setting('lfh.actor', true), ''));
  v_kid_tag table_tags;  -- the CHILD table's mark, rescued from clear_table_tag_on_close
BEGIN
  SELECT * INTO v_a FROM sessions WHERE id = p_session AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_a.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;

  -- CHAINS FLATTEN: picking a table that is already someone's child means the party you mean is
  -- its parent (owner: "if six and seven are merged and eight is merged to seven, it should be
  -- directly pointing to six").
  v_to := lfh_merge_parent_table(p_rid, p_to);
  IF v_to = v_a.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;

  IF v_a.invoice_no IS NOT NULL AND NOT COALESCE(v_a.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
  END IF;

  SELECT * INTO v_b FROM sessions
   WHERE table_number = v_to AND restaurant_id = p_rid AND status = 'open'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'target_not_open'); END IF;
  IF v_b.invoice_no IS NOT NULL AND NOT COALESCE(v_b.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;

  -- THE MAIN TABLE IS ALWAYS THE LOWEST NUMBER. If the caller merged 6 into 7, we keep 6 and move
  -- 7's rows across instead — the guest-facing outcome is the same single bill either way, and the
  -- floor always names the same table as the one in charge.
  IF (v_a.table_number)::bigint <= (v_b.table_number)::bigint
    THEN v_keep := v_a; v_drop := v_b;
    ELSE v_keep := v_b; v_drop := v_a;
  END IF;
  v_parent := v_keep.table_number;
  v_child  := v_drop.table_number;

  -- Re-home the dropped party onto the survivor. NOTE: table_number is NOT touched — every order
  -- keeps the table it was ordered at, which is what makes an unmerge exact.
  UPDATE orders       SET session_id = v_keep.id WHERE session_id = v_drop.id;
  UPDATE order_items  SET session_id = v_keep.id WHERE session_id = v_drop.id;
  UPDATE waiter_calls SET session_id = v_keep.id WHERE session_id = v_drop.id AND NOT resolved;
  IF EXISTS (SELECT 1 FROM session_members WHERE session_id = v_keep.id AND role = 'owner' AND NOT removed) THEN
    UPDATE session_members SET role = 'guest' WHERE session_id = v_drop.id AND role = 'owner' AND NOT removed;
  END IF;
  UPDATE session_members SET session_id = v_keep.id WHERE session_id = v_drop.id;

  UPDATE sessions SET
    discount = COALESCE(v_keep.discount, 0) + COALESCE(v_drop.discount, 0),
    discount_note = NULLIF(concat_ws(' · ',
      NULLIF(v_keep.discount_note, ''),
      CASE WHEN COALESCE(v_drop.discount, 0) > 0
           THEN 'merged from T' || v_child || COALESCE(': ' || NULLIF(v_drop.discount_note, ''), '') END), ''),
    cart = COALESCE(v_keep.cart, '[]'::jsonb) || COALESCE(v_drop.cart, '[]'::jsonb),
    cart_updated_at = CASE WHEN COALESCE(jsonb_array_length(COALESCE(v_drop.cart, '[]'::jsonb)), 0) > 0 THEN NOW() ELSE v_keep.cart_updated_at END,
    bill_no = COALESCE(v_keep.bill_no, v_drop.bill_no),
    last_activity_at = NOW()
  WHERE id = v_keep.id;
  PERFORM lfh_split_bill_discount(v_keep.id);

  -- ── THE CHILD'S MARK SURVIVES THE CLOSE (mig 312) ─────────────────────────────────────────
  -- Read it BEFORE the UPDATE below: closing the session fires clear_table_tag_on_close, which
  -- deletes it. There is no other open session on that table (the merge is what closed the only
  -- one), so the trigger's own "unless somebody else is still open here" escape does not apply.
  SELECT * INTO v_kid_tag FROM table_tags
   WHERE restaurant_id = p_rid AND table_number = v_child;

  UPDATE sessions SET status = 'closed', closed_at = NOW(), last_activity_at = NOW() WHERE id = v_drop.id;

  -- …and put it straight back. ON CONFLICT DO NOTHING because the trigger is AFTER-row and could,
  -- in some future ordering, not have run: this must never be the statement that fails a merge.
  IF v_kid_tag.table_number IS NOT NULL THEN
    INSERT INTO table_tags(restaurant_id, table_number, tag, tagged_by, tagged_at)
    VALUES (p_rid, v_kid_tag.table_number, v_kid_tag.tag, v_kid_tag.tagged_by, v_kid_tag.tagged_at)
    ON CONFLICT (restaurant_id, table_number) DO NOTHING;
  END IF;

  -- Anything the dropped table had already been carrying moves with it, so a three-table party
  -- points every child at the one surviving parent.
  UPDATE table_merges SET parent_table = v_parent, session_id = v_keep.id
   WHERE restaurant_id = p_rid AND ended_at IS NULL AND parent_table = v_child;

  INSERT INTO table_merges(restaurant_id, session_id, parent_table, child_table, merged_by, merged_by_id)
  VALUES (p_rid, v_keep.id, v_parent, v_child, v_actor, p_actor_id)
  ON CONFLICT (restaurant_id, child_table) WHERE ended_at IS NULL
  DO UPDATE SET session_id = EXCLUDED.session_id, parent_table = EXCLUDED.parent_table, merged_at = NOW();

  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_child,  'session', v_drop.id::text, v_child,  p_rid),
    ('table:' || v_parent, 'session', v_keep.id::text, v_parent, p_rid),
    ('ops',                'session', v_keep.id::text, v_parent, p_rid),
    ('ops',                'session', v_drop.id::text, v_child,  p_rid);

  -- `kept_tag` so the panel can SAY what it kept instead of the mark just quietly staying put.
  RETURN json_build_object('ok', true, 'from', v_child, 'to', v_parent,
                           'target_session', v_keep.id, 'parent_table', v_parent, 'child_table', v_child,
                           'kept_tag', v_kid_tag.tag);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid, text, uuid) IS
  'Join two parties onto one bill. p_actor/p_actor_id record WHO did it in table_merges (mig 308). '
  'The child table KEEPS its VIP/Family/Owner-guest mark across the close (mig 312) — the party has '
  'not ended, so clear_table_tag_on_close must not take it, and the on-the-house lookup searches '
  'the whole party for it.';
