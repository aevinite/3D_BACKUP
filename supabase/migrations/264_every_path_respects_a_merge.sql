-- 264 — EVERY PATH THAT TOUCHES A TABLE RESPECTS A LIVE MERGE (owner, 2026-08-03)
--
-- Round 2 of the merge audit ("check every single possibility — all features should work in a
-- merged table as merged"). Round 1 (PR #745) fixed the panels and the by-table endpoints; this
-- migration closes the remaining SERVER paths that could still split a joined party or strand
-- its records. Four functions, each patched from its newest written-down live body (the mig-250
-- discipline — never recreate from an old migration and silently revert later fixes):
--
--   1. lfh_place_order_public (mig 240) — a GUEST ordering at a merged child seated a brand-new
--      second party on the joined table (the very state mig 260 exists to prevent — it guarded
--      lfh_staff_open_table but not this insert). The order now joins the party it was merged
--      into, exactly like the waiter path (mig 250): the session is the PARENT's, the order
--      still records the table it was ordered at.
--   2. lfh_staff_shift_table (mig 217) — two holes:
--      · shifting a merged PARENT renumbered the whole party's orders onto the new table
--        (destroying "each order keeps the table it was ordered at", which is what makes an
--        unmerge exact) and left the table_merges rows pointing at the OLD number — a child
--        "merged with T28" while the party sits at T5. A merged party now refuses to shift:
--        reason 'party_merged' — unmerge first, then move, then re-merge if wanted.
--      · a merged CHILD passed the "target free" test (it has no session of its own), so a solo
--        party could be shifted ONTO a joined table. Refused: reason 'merged_child', parent named.
--   3. lfh_staff_move_order (mig 173) — moving a KOT TO a merged child inserted a second session
--      on the joined table. The destination now resolves to the table holding the bill, so the
--      KOT joins the party's one bill.
--   4. lfh_staff_move_order_item (mig 175) — same hole, same fix, for a single dish.

-- ── 1. guest order at a merged table joins the party (mirror of mig 250) ────────────────────
CREATE OR REPLACE FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_order uuid; v_priced jsonb; v_auto boolean := false; v_items jsonb; v_status text;
  v_tbl text := NULLIF(p_table, '');
  v_s sessions;
BEGIN
  -- RATE LIMIT (mig 205): cap public/QR orders per table in the window.
  IF NOT lfh_rate_check(v_rid, 'guest_order', 'table:' || COALESCE(v_tbl, '?'),
                        'Table ' || COALESCE(v_tbl, '?')) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- 253: open-price dishes are staff-priced -- never orderable from a guest device. See the
  -- long note on lfh_place_order in mig 253; same rule, same reason code. (This block was
  -- DROPPED by 264's first draft — the body had been copied from mig 240, but mig 253
  -- redefined this function after 240. The recreate-reverts-a-fix trap, caught in review.)
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE m.open_price
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'staff_priced_item');
  END IF;

  -- Priced against the restaurant the order is FOR (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- AUTO-ACCEPT FOLLOW-UPS (163). No session here, so "same seating" = this table
  -- has an accepted order that's still unpaid and recent. A paid/settled bill (or a
  -- stale 3h+ order) means a NEW party — their first order needs an Accept again.
  -- NULLIF: an order with no table can never match (comparison stays NULL/false).
  SELECT EXISTS (
    SELECT 1 FROM orders
     WHERE restaurant_id = v_rid
       AND table_number = v_tbl
       AND status IN ('preparing', 'served')
       AND payment_status <> 'paid'
       AND created_at > NOW() - INTERVAL '3 hours'
  ) INTO v_auto;
  IF v_auto THEN
    v_status := 'preparing';
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status', 'preparing')), '[]'::jsonb)
      INTO v_items FROM jsonb_array_elements(v_priced->'items') e;
  ELSE
    v_status := 'received';
    v_items  := v_priced->'items';
  END IF;

  -- THE PARTY (2026-07-31). Same lock key as lfh_staff_place_order, so a guest order and a
  -- waiter order arriving together on one table serialise and share ONE session. A takeaway /
  -- no-table order keeps session_id NULL — there is no table to seat.
  -- A MERGED TABLE ORDERS ONTO THE PARTY IT WAS JOINED TO (mig 249/250, extended here
  -- 2026-08-03): a guest at table 7 while 7 is merged into 6 adds their dish to the ONE bill.
  -- Without this the guest's order opened a SECOND party on the joined table — the exact state
  -- mig 260 blocks on lfh_staff_open_table. The order still records table_number = v_tbl below,
  -- so the KOT prints for the guest's own table and an unmerge hands it back exactly.
  IF v_tbl IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || v_tbl, 0));
    SELECT * INTO v_s FROM sessions
      WHERE table_number = lfh_merge_parent_table(v_rid, v_tbl)
        AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_s.id IS NULL THEN
      BEGIN
        INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
          VALUES (v_tbl, 'open', 'guest', NOW(), v_rid)
          RETURNING * INTO v_s;
      EXCEPTION WHEN unique_violation THEN
        -- Another path opened it without taking our lock (idx_one_open_session_per_table).
        -- Losing that race is a success: the table has a party, which is all we wanted.
        SELECT * INTO v_s FROM sessions
          WHERE table_number = v_tbl AND status = 'open' AND restaurant_id = v_rid
          ORDER BY last_activity_at DESC LIMIT 1;
      END;
    END IF;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, restaurant_id)
    VALUES (v_tbl, v_items,
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), v_status, v_s.id, v_rid)
    RETURNING id INTO v_order;

  IF v_s.id IS NOT NULL THEN
    UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  END IF;

  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $function$
;

REVOKE ALL ON FUNCTION public.lfh_place_order_public(text, jsonb, text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lfh_place_order_public(text, jsonb, text[], uuid) TO anon, authenticated, service_role;

-- ── 2. a merged party does not SHIFT, and nothing shifts ONTO a joined table ────────────────
CREATE OR REPLACE FUNCTION public.lfh_staff_shift_table(p_session uuid, p_to text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_s sessions; v_from text; v_rid uuid; v_parent text;
BEGIN
  SELECT * INTO v_s FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_session'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  IF p_to = v_s.table_number THEN RETURN json_build_object('ok', false, 'reason', 'same_table'); END IF;
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);

  -- A MERGED PARTY DOES NOT SHIFT (mig 264). Shifting would renumber EVERY order onto the new
  -- table — including the child's, whose numbers are what makes an unmerge exact (mig 249) —
  -- and leave the table_merges rows naming a table nobody sits at any more. Unmerge first,
  -- then move, then re-merge if wanted; each of those steps stays exact and on the record.
  IF EXISTS (SELECT 1 FROM table_merges m
              WHERE m.restaurant_id = v_rid AND m.session_id = p_session AND m.ended_at IS NULL) THEN
    RETURN json_build_object('ok', false, 'reason', 'party_merged');
  END IF;

  -- CONCURRENCY (mig 217): serialize on the DESTINATION table using the identical lock
  -- key as lfh_staff_place_order (mig 202), so a shift and a placement onto the same
  -- table cannot both pass the "is it free?" test. A near-simultaneous second request
  -- waits here until the first commits, then sees the truth below.
  PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || COALESCE(p_to, ''), 0));

  -- A JOINED TABLE IS NOT A FREE TABLE (mig 264). It has no session of its own — its party
  -- lives on the parent — so the occupancy test below cannot see it. Checked INSIDE the lock,
  -- like mig 260's twin guard on lfh_staff_open_table, so a merge landing at the same instant
  -- can't slip a party onto it.
  SELECT m.parent_table INTO v_parent FROM table_merges m
   WHERE m.restaurant_id = v_rid AND m.child_table = p_to AND m.ended_at IS NULL
   LIMIT 1;
  IF v_parent IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'merged_child', 'parent_table', v_parent);
  END IF;

  -- Occupancy is checked UNDER the lock: an earlier read could predate a competing commit.
  IF EXISTS (SELECT 1 FROM sessions WHERE table_number = p_to AND status = 'open' AND restaurant_id = v_rid) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
  END IF;

  v_from := v_s.table_number;
  UPDATE sessions     SET table_number = p_to, last_activity_at = NOW() WHERE id = p_session;
  UPDATE orders       SET table_number = p_to WHERE session_id = p_session;
  UPDATE waiter_calls SET table_number = p_to WHERE session_id = p_session AND NOT resolved;
  -- TAG: the mark belongs to the PARTY — move it with them. Only when the party HAS a
  -- mark: the target's stale tag then gives way (PK). An unmarked party shifting onto a
  -- pre-marked free table leaves that mark alone. Rows fire the table_tags trigger → repaint.
  IF EXISTS (SELECT 1 FROM table_tags WHERE restaurant_id = v_rid AND table_number = v_from) THEN
    DELETE FROM table_tags WHERE restaurant_id = v_rid AND table_number = p_to;
    UPDATE table_tags SET table_number = p_to
      WHERE restaurant_id = v_rid AND table_number = v_from;
  END IF;
  -- Nudge BOTH table topics (guests) AND BOTH tables on 'ops' (staff panels' targeted
  -- refetch) so the OLD table clears and the NEW table fills — no wrong/duplicated tile.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'session', p_session::text, v_from, v_rid),
    ('table:' || p_to,   'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, p_to,   v_rid),
    ('ops',              'session', p_session::text, v_from, v_rid);
  RETURN json_build_object('ok', true, 'from', v_from, 'to', p_to);
EXCEPTION
  -- Belt-and-braces (mig 217): any residual race on the one-open-session-per-table index
  -- becomes the same clear answer the panels already show, never a raw 500.
  WHEN unique_violation THEN
    RETURN json_build_object('ok', false, 'reason', 'target_occupied');
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_staff_shift_table(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_staff_shift_table(uuid, text) TO service_role;

-- ── 3. moving a KOT to a joined table joins that party's ONE bill ───────────────────────────
CREATE OR REPLACE FUNCTION lfh_staff_move_order(p_order uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_o      orders;
  v_from   text;
  v_to     text;
  v_src    sessions;      -- source session (may be absent: orders.session_id is nullable)
  v_target sessions;
BEGIN
  SELECT * INTO v_o FROM orders WHERE id = p_order AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_order'); END IF;
  -- Never re-home a PAID order — it's settled revenue on a closed bill; moving it onto
  -- another party's live bill would double-count / corrupt the money trail.
  IF v_o.payment_status = 'paid' THEN RETURN json_build_object('ok', false, 'reason', 'order_paid'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  -- A JOINED TABLE MEANS ITS PARTY'S BILL (mig 264): sending a KOT "to table 29" while 29 is
  -- merged into 28 means the one bill those tables share. Resolving here is what stops the old
  -- behaviour — a brand-new second session inserted ON the joined table. Same-table covers both
  -- spellings: the KOT's own table, and any member of the party it already belongs to.
  v_to := lfh_merge_parent_table(p_rid, p_to);
  IF p_to = v_o.table_number OR v_to = lfh_merge_parent_table(p_rid, v_o.table_number) THEN
    RETURN json_build_object('ok', false, 'reason', 'same_table');
  END IF;
  v_from := v_o.table_number;

  -- Don't pull an order OFF a bill whose invoice is already generated (and not voided):
  -- the guest holds a printed invoice that would now overstate the total. Same rule for
  -- the target side below. A voided invoice never blocks (it's being re-billed anyway).
  IF v_o.session_id IS NOT NULL THEN
    SELECT * INTO v_src FROM sessions WHERE id = v_o.session_id AND restaurant_id = p_rid;
    IF FOUND AND v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
      RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
    END IF;
  END IF;

  -- Find (or open) the target table's session, then re-home the order onto it.
  SELECT * INTO v_target FROM sessions
   WHERE table_number = v_to AND restaurant_id = p_rid AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_target.invoice_no IS NOT NULL AND NOT COALESCE(v_target.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;
  IF NOT FOUND THEN
    INSERT INTO sessions (table_number, status, opened_by, opened_at, restaurant_id)
    VALUES (v_to, 'open', 'waiter', NOW(), p_rid)
    RETURNING * INTO v_target;
  END IF;

  UPDATE orders      SET table_number = v_to, session_id = v_target.id WHERE id = p_order;
  UPDATE order_items SET session_id = v_target.id WHERE order_id = p_order;

  -- The target now has an order, so make sure it has a bill number (the bill trigger
  -- only fires on session INSERT, not on this move — assign it if missing).
  IF v_target.bill_no IS NULL THEN
    UPDATE sessions SET bill_no = lfh_next_counter(p_rid, 'bill')
     WHERE id = v_target.id AND bill_no IS NULL;
  END IF;

  -- Re-split each side's whole-bill discount over its (new) set of orders.
  IF v_src.id IS NOT NULL THEN PERFORM lfh_split_bill_discount(v_src.id); END IF;
  PERFORM lfh_split_bill_discount(v_target.id);

  -- Nudge BOTH table topics (guests) AND BOTH tables on 'ops' (staff panels' targeted
  -- refetch) so the OLD table's ticket disappears and the NEW table's appears — the
  -- mig-096 four-row pattern.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'order', p_order::text, v_from, p_rid),
    ('table:' || v_to,   'order', p_order::text, v_to,   p_rid),
    ('ops',              'order', p_order::text, v_to,   p_rid),
    ('ops',              'order', p_order::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', v_to, 'target_session', v_target.id);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_move_order(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_move_order(uuid, text, uuid) TO service_role;

-- ── 4. moving a single dish to a joined table joins that party's ONE bill ───────────────────
-- The live body is mig 175's; ONLY the destination resolution changes (v_to), exactly as above.
CREATE OR REPLACE FUNCTION lfh_staff_move_order_item(p_item uuid, p_to text, p_rid uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item   order_items;
  v_order  orders;        -- source order (the KOT the line leaves)
  v_src    sessions;      -- source session
  v_target sessions;
  v_new    orders;        -- fresh order (new KOT) on the target
  v_from   text;
  v_to     text;
  v_left   int;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id AND restaurant_id = p_rid;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  IF v_order.payment_status = 'paid' THEN RETURN json_build_object('ok', false, 'reason', 'order_paid'); END IF;
  IF v_order.status = 'cancelled' THEN RETURN json_build_object('ok', false, 'reason', 'order_cancelled'); END IF;
  IF p_to !~ '^\d+$' THEN RETURN json_build_object('ok', false, 'reason', 'bad_table'); END IF;
  -- A JOINED TABLE MEANS ITS PARTY'S BILL (mig 264) — see lfh_staff_move_order above.
  v_to := lfh_merge_parent_table(p_rid, p_to);
  IF p_to = v_order.table_number OR v_to = lfh_merge_parent_table(p_rid, v_order.table_number) THEN
    RETURN json_build_object('ok', false, 'reason', 'same_table');
  END IF;
  v_from := v_order.table_number;

  -- Printed-invoice locks on either side (a live invoice total must never drift).
  IF v_order.session_id IS NOT NULL THEN
    SELECT * INTO v_src FROM sessions WHERE id = v_order.session_id AND restaurant_id = p_rid;
    IF FOUND AND v_src.invoice_no IS NOT NULL AND NOT COALESCE(v_src.invoice_voided, false) THEN
      RETURN json_build_object('ok', false, 'reason', 'source_invoiced');
    END IF;
  END IF;
  SELECT * INTO v_target FROM sessions
   WHERE table_number = v_to AND restaurant_id = p_rid AND status <> 'closed'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_target.invoice_no IS NOT NULL AND NOT COALESCE(v_target.invoice_voided, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'target_invoiced');
  END IF;
  IF NOT FOUND THEN
    INSERT INTO sessions (table_number, status, opened_by, opened_at, restaurant_id)
    VALUES (v_to, 'open', 'waiter', NOW(), p_rid)
    RETURNING * INTO v_target;
  END IF;

  -- Fresh order = fresh KOT number (assigned by the orders INSERT trigger). Its real
  -- totals/status/items-json all come from lfh_reprice_order right after the move.
  INSERT INTO orders (session_id, table_number, status, payment_status, items, subtotal, tax, total, restaurant_id)
  VALUES (v_target.id, v_to,
          CASE WHEN v_item.status = 'served' THEN 'served'
               WHEN v_item.status IN ('preparing', 'ready') THEN 'preparing'
               ELSE 'received' END,
          'unpaid', '[]'::jsonb, 0, 0, 0, p_rid)
  RETURNING * INTO v_new;

  UPDATE order_items SET order_id = v_new.id, session_id = v_target.id WHERE id = p_item;

  -- Source: reprice the survivors, or cancel the KOT if the moved line was its last
  -- dish (lfh_reprice_order alone would leave a ₹0 'received' ghost on the bill).
  SELECT COUNT(*) INTO v_left FROM order_items WHERE order_id = v_order.id;
  IF v_left = 0 THEN
    UPDATE orders SET status = 'cancelled', subtotal = 0, tax = 0, total = 0, items = '[]'::jsonb
     WHERE id = v_order.id;
  ELSE
    PERFORM lfh_reprice_order(v_order.id);
    UPDATE orders SET edited_at = NOW() WHERE id = v_order.id;  -- ✎ Edited badge: staff re-check the shrunk ticket
  END IF;
  PERFORM lfh_reprice_order(v_new.id);

  -- The target now bills something — make sure it has a bill number (INSERT-only trigger).
  IF v_target.bill_no IS NULL THEN
    UPDATE sessions SET bill_no = lfh_next_counter(p_rid, 'bill')
     WHERE id = v_target.id AND bill_no IS NULL;
  END IF;

  -- mig-096 four-row breadcrumb pattern: both tables, guests + staff ops.
  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id) VALUES
    ('table:' || v_from, 'order', v_new.id::text, v_from, p_rid),
    ('table:' || v_to,   'order', v_new.id::text, v_to,   p_rid),
    ('ops',              'order', v_new.id::text, v_to,   p_rid),
    ('ops',              'order', v_new.id::text, v_from, p_rid);

  RETURN json_build_object('ok', true, 'from', v_from, 'to', v_to,
                           'new_order', v_new.id, 'source_cancelled', v_left = 0,
                           'target_session', v_target.id);
END; $$;

REVOKE ALL ON FUNCTION lfh_staff_move_order_item(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_move_order_item(uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
