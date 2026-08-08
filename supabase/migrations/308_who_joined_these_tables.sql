-- 308 — WHO joined these two tables? (owner, 2026-08-08)
--
-- THE GAP. `table_merges` has carried `merged_by` / `merged_by_id` since migration 249 and the
-- unmerge half has always filled `ended_by` — but every merge row on the dev database reads
-- `merged_by = NULL`. The reason is one line: mig 249 took the actor from
-- `current_setting('lfh.actor', true)`, a session GUC that **nothing in this codebase has ever
-- set**, and which could not work reliably even if it did — PostgREST hands each `sb.rpc()` a
-- pooled connection, so a `SET` from one request is not the connection the next one runs on.
--
-- So the trail said WHAT and WHEN but never WHO, on an action that puts two tables' money onto one
-- bill. Its own mirror image already does it right: `lfh_staff_unmerge_table(p_rid, p_child,
-- p_actor)` takes the actor as a PARAMETER and the manager route passes it. Every other audited
-- RPC in this app does the same — `lfh_generate_invoice(p_actor)`, `lfh_void_invoice(p_actor)`,
-- `lfh_platform_set_status(p_by)`. This brings merge into line with its own twin.
--
-- WHY THE OLD 3-ARG FUNCTION IS DROPPED IN THE SAME BREATH. `CREATE OR REPLACE` with extra
-- parameters creates an OVERLOAD, it does not replace: a later `lfh_staff_merge_tables(a,b,c)`
-- would then match both the 3-arg function and the 5-arg one through its defaults, and Postgres
-- refuses that as `function is not unique`. Dropping the old one first leaves exactly one
-- function, and because the two new parameters carry DEFAULTs, a caller that has not been
-- redeployed yet still resolves — it simply records NULL, exactly as it does today. Nothing
-- breaks in the window between this migration and the deploy.
--
-- The body below is migration 249's, unchanged except for the actor: same guards, same
-- lowest-table-wins rule, same re-homing, same realtime events. Re-stated in full because that is
-- how a function is replaced.
--
-- ⚠️ A NEW FUNCTION IS PUBLIC-EXECUTABLE BY DEFAULT (the mig 038/267 lesson) — the REVOKE/GRANT at
-- the bottom is not optional, and `npm run verify:grants` fails without it.

DROP FUNCTION IF EXISTS lfh_staff_merge_tables(uuid, text, uuid);

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

  UPDATE sessions SET status = 'closed', closed_at = NOW(), last_activity_at = NOW() WHERE id = v_drop.id;

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

  RETURN json_build_object('ok', true, 'from', v_child, 'to', v_parent,
                           'target_session', v_keep.id, 'parent_table', v_parent, 'child_table', v_child);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION lfh_staff_merge_tables(uuid, text, uuid, text, uuid) IS
  'Join two parties onto one bill. p_actor/p_actor_id record WHO did it in table_merges — pass them '
  'from the panel route (g.user), the same way lfh_staff_unmerge_table does. Migration 308.';
