-- 249 — MERGING TABLES BECOMES VISIBLE, ADDRESSED AND REVERSIBLE (owner, 2026-08-01)
--
-- "if six and seven are merged, in six it should show it is merge with seven … on seven it should be
--  completely written merge with six, access from six … you can only unmerge by clicking on the seven
--  number table … two phase interface, are you sure you want to unmerge, and on the top it will be
--  written what thing will happen, which KOT will be transferred to seven again … main table will be
--  the lowest number one always … every log of this should be written in the log section."
--
-- WHAT WAS WRONG. Merging was a ONE-WAY MOVE: the source party's orders were re-homed onto the
-- target session, `orders.table_number` was REWRITTEN to the target, and the source session was
-- closed. So afterwards nothing anywhere said two tables were joined — the second table was simply
-- free — and the origin of each order was gone, which is why there was no "merged with" anywhere and
-- nothing to unmerge. (What he saw on table 6 was the unrelated "N merged · one bill" badge, which
-- counts ORDERS, not tables.)
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT. The parties still combine into ONE session, because
-- that is what keeps one bill, one invoice and one payment correct with no change to any read path —
-- the bill, the summary, the reports and the guest side all keep working exactly as they do today.
-- Two things are added:
--   1. `orders.table_number` is NO LONGER rewritten, so every order remembers the table it was
--      actually ordered at. That is what makes "each KOT returns to the table it was ordered at"
--      exact rather than a guess.
--   2. A `table_merges` row records the join (parent table, child table, who, when), so both tiles
--      can say so, an order taken at the child can be routed to the joint bill, and the merge can be
--      undone — with the confirm able to list precisely what will move.
--
-- HIS TWO STRUCTURAL RULES ARE ENFORCED HERE, not in the UI:
--   · The parent is ALWAYS the lowest-numbered table. Merge 6 into 7 and the party ends up on 6.
--   · Chains flatten: merging 8 into 7 while 7 is already a child of 6 records 8 under **6**.

-- ── the record ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_merges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, -- the surviving (parent) party
  parent_table  text NOT NULL,
  child_table   text NOT NULL,
  merged_at     timestamptz NOT NULL DEFAULT NOW(),
  merged_by     text,
  merged_by_id  uuid,
  ended_at      timestamptz,
  ended_reason  text,        -- 'unmerged' | 'session_closed'
  ended_by      text,
  CONSTRAINT table_merges_not_self CHECK (parent_table <> child_table)
);

-- One live join per child table per restaurant: a table cannot be attached to two parties at once.
CREATE UNIQUE INDEX IF NOT EXISTS table_merges_one_live_child
  ON table_merges(restaurant_id, child_table) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS table_merges_live_by_restaurant
  ON table_merges(restaurant_id, parent_table) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS table_merges_by_session ON table_merges(session_id);

COMMENT ON TABLE table_merges IS
  'Which tables are currently served as one party, and the history of every join and split. '
  'Written by lfh_staff_merge_tables / lfh_staff_unmerge_table; ended automatically when the '
  'parent session closes. Never deleted — this is the audit trail of who joined which tables.';

ALTER TABLE table_merges ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- staff panels read it through the service role; no anon/authenticated policy on purpose.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'table_merges' AND policyname = 'table_merges_service') THEN
    CREATE POLICY table_merges_service ON table_merges FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── which table is really in charge of this one? ────────────────────────────────────────────
-- Returns the parent table when p_table is a live merged child, otherwise p_table itself. One hop
-- is enough because merges are always flattened onto the root when they are recorded.
CREATE OR REPLACE FUNCTION lfh_merge_parent_table(p_rid uuid, p_table text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT m.parent_table FROM table_merges m
      WHERE m.restaurant_id = p_rid AND m.child_table = p_table AND m.ended_at IS NULL
      LIMIT 1),
    p_table);
$$;

-- Every table joined into one party, parent first — for the "T6 + T7" wording on a bill.
CREATE OR REPLACE FUNCTION lfh_merge_group(p_rid uuid, p_parent_table text)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY[p_parent_table] || COALESCE(
    (SELECT array_agg(m.child_table ORDER BY (m.child_table ~ '^\d+$') DESC,
                                            NULLIF(regexp_replace(m.child_table, '\D', '', 'g'), '')::bigint NULLS LAST,
                                            m.child_table)
       FROM table_merges m
      WHERE m.restaurant_id = p_rid AND m.parent_table = p_parent_table AND m.ended_at IS NULL),
    '{}'::text[]);
$$;

REVOKE ALL ON FUNCTION lfh_merge_parent_table(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_merge_group(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_merge_parent_table(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_merge_group(uuid, text) TO service_role;

-- ── merge: same one-bill outcome, but recorded, addressed and reversible ────────────────────
CREATE OR REPLACE FUNCTION lfh_staff_merge_tables(p_session uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_a       sessions;   -- the party the caller started from
  v_b       sessions;   -- the party on the table they picked
  v_keep    sessions;   -- the one that survives = the LOWER table number (his rule)
  v_drop    sessions;   -- the one whose rows move across
  v_to      text;
  v_child   text;
  v_parent  text;
  v_actor   text := COALESCE(current_setting('lfh.actor', true), NULL);
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

  INSERT INTO table_merges(restaurant_id, session_id, parent_table, child_table, merged_by)
  VALUES (p_rid, v_keep.id, v_parent, v_child, v_actor)
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

-- ── unmerge: give the child table its own party back, exactly ──────────────────────────────
-- Each order goes back to the table it was ORDERED at (his choice). Anything that cannot be
-- attributed to one table — the guests and a whole-bill discount — stays with the parent, and the
-- panel's confirm says so out loud before anyone taps.
CREATE OR REPLACE FUNCTION lfh_staff_unmerge_table(p_rid uuid, p_child text, p_actor text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_m        table_merges;
  v_parent   sessions;
  v_new      sessions;
  v_moved    int := 0;
  v_kots     text;
BEGIN
  SELECT * INTO v_m FROM table_merges
   WHERE restaurant_id = p_rid AND child_table = p_child AND ended_at IS NULL LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'not_merged'); END IF;

  SELECT * INTO v_parent FROM sessions WHERE id = v_m.session_id;
  IF NOT FOUND THEN
    -- the parent party is gone; the record is simply stale
    UPDATE table_merges SET ended_at = NOW(), ended_reason = 'session_closed' WHERE id = v_m.id;
    RETURN json_build_object('ok', true, 'reason', 'parent_gone', 'moved', 0);
  END IF;
  -- A printed bill covers BOTH tables, so it has to be voided before the tables can be separated.
  IF v_parent.invoice_no IS NOT NULL AND NOT COALESCE(v_parent.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'invoiced');
  END IF;

  SELECT string_agg(DISTINCT '#' || kot_no::text, ', ' ORDER BY '#' || kot_no::text) INTO v_kots
    FROM orders WHERE session_id = v_parent.id AND table_number = p_child
      AND NOT archived AND deleted_at IS NULL AND status <> 'cancelled';

  -- Only give the child a party of its own if it actually has food on it. Otherwise it just goes
  -- back to being free — never an open party with nothing on it (owner, 2026-08-01: a state no
  -- screen can show must not exist in the database either).
  IF v_kots IS NOT NULL THEN
    -- opened_by is CHECKed to ('waiter','guest') — 'staff' is refused, which a test caught before
    -- this shipped. A table separated by a member of staff is a waiter-opened party.
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_child, 'open', 'waiter', NOW(), p_rid) RETURNING * INTO v_new;
    UPDATE orders SET session_id = v_new.id
     WHERE session_id = v_parent.id AND table_number = p_child AND NOT archived AND deleted_at IS NULL;
    UPDATE order_items oi SET session_id = v_new.id
     WHERE oi.order_id IN (SELECT id FROM orders WHERE session_id = v_new.id);
    UPDATE waiter_calls SET session_id = v_new.id
     WHERE session_id = v_parent.id AND table_number = p_child AND NOT resolved;
    SELECT count(*) INTO v_moved FROM orders WHERE session_id = v_new.id;
    -- the parent's whole-bill discount is re-spread over what it still holds
    PERFORM lfh_split_bill_discount(v_parent.id);
    PERFORM lfh_split_bill_discount(v_new.id);
  END IF;

  UPDATE table_merges SET ended_at = NOW(), ended_reason = 'unmerged', ended_by = p_actor WHERE id = v_m.id;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_parent.id;

  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || p_child,            'session', v_m.id::text, p_child,            p_rid),
    ('table:' || v_m.parent_table,   'session', v_m.id::text, v_m.parent_table,   p_rid),
    ('ops',                          'session', v_m.id::text, p_child,            p_rid),
    ('ops',                          'session', v_m.id::text, v_m.parent_table,   p_rid);

  RETURN json_build_object('ok', true, 'child', p_child, 'parent', v_m.parent_table,
                           'moved', v_moved, 'kots', v_kots);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_unmerge_table(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_unmerge_table(uuid, text, text) TO service_role;

-- ── a closing party ends its joins ─────────────────────────────────────────────────────────
-- Paying the joint bill separates the tables on its own (owner: "when the bill is paid it auto
-- restart the table … you can only unmerge after the bill has been paid, it will be unmerged").
-- This lives on the status change itself, so EVERY close does it — the app path, a script, a
-- hand-run UPDATE — exactly like the mig-232 cleanup it sits beside.
CREATE OR REPLACE FUNCTION lfh_session_close_cleanup()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.status = 'closed' AND COALESCE(OLD.status, '') <> 'closed' THEN
    NEW.cart := '[]'::jsonb;
    IF NEW.closed_at IS NULL THEN NEW.closed_at := NOW(); END IF;
    UPDATE session_members SET removed = true WHERE session_id = NEW.id AND NOT removed;
    UPDATE waiter_calls   SET resolved = true WHERE session_id = NEW.id AND NOT resolved;
    UPDATE requests       SET status = 'denied' WHERE table_number = NEW.table_number AND restaurant_id = NEW.restaurant_id AND status = 'pending';
    UPDATE orders
       SET status = 'cancelled', archived = true,
           archived_at = COALESCE(archived_at, NOW()),
           cancelled_at = COALESCE(cancelled_at, NOW())
     WHERE session_id = NEW.id AND NOT archived AND deleted_at IS NULL
       AND status <> 'cancelled' AND payment_status <> 'paid' AND khata_at IS NULL;
    UPDATE orders
       SET archived = true, archived_at = COALESCE(archived_at, NOW())
     WHERE session_id = NEW.id AND NOT archived AND deleted_at IS NULL;
    -- NEW (mig 249): the tables this party had joined are separated again, and the record says why.
    UPDATE table_merges SET ended_at = NOW(), ended_reason = 'session_closed'
     WHERE session_id = NEW.id AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END; $function$;

NOTIFY pgrst, 'reload schema';
