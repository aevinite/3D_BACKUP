-- 357_the_accept_is_only_skipped_for_an_order_still_on_the_floor.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Migration 164 built auto-accept with one rule stated plainly in its own header:
--
--     "The FIRST order of any seating still arrives as 'received' and must be accepted."
--
-- It decides "is this a follow-up?" by asking whether the seating already has an ACCEPTED order.
-- That test looks at an order's status and payment — and never at whether the order is still on
-- the floor at all.
--
-- SO IT WAS WRONG AFTER A RESTART. When staff clear a table's orders (the app's own soft-delete,
-- lib/softDelete.ts) the rows keep status 'preparing' and payment 'pending' and simply leave every
-- live board. The next order on that table — the first order of a brand-new seating — was then
-- treated as a follow-up and went straight to the kitchen pass with nobody accepting it.
--
-- WATCHED, not reasoned: sweep #6 terminal 22 opened a table on the dev stack, placed and accepted
-- one order, cleared it the way the app clears it, then placed the next order through the table's
-- QR door. It arrived as 'preparing'. Both doors share the flaw; the session door's test has the
-- same shape.
--
-- WHO THIS COSTS. The manager and the tablet: the Accept tap is the moment a new party's first
-- order is seen and checked before the kitchen starts cooking it, and after a restart — which is
-- the very thing staff do when an order was wrong — that moment was skipped silently.
--
-- THE FIX is two lines in each of the two EXISTS tests: the order that stands in for an Accept
-- must still be on the floor. Both bodies below are the CURRENT LIVE DEFINITIONS, taken from the
-- database with pg_get_functiondef and changed in exactly those two places — the same method
-- migrations 206 and 207 used, and for the same reason: recreating from an older copy silently
-- reverts everything the newer migrations added (migs 249/253/264/281/302/306 all live in here).
--
-- Nothing else moves: same signatures, same grants (CREATE OR REPLACE keeps them; re-asserted
-- below for the guest doors), same pricing, same rate limits, same merge handling.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── 1. the guest's own session door ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_place_order(p_token text, p_items jsonb, p_allergies text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_m session_members; v_s sessions; v_order uuid; v_item jsonb; v_req_otp boolean; v_priced jsonb;
        v_rid uuid; v_auto boolean := false; v_items jsonb; v_status text;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  -- DERIVE the restaurant from the session this token belongs to (NOT the #1 default).
  v_rid := COALESCE(v_s.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  IF lfh_is_blocked(v_m.phone, v_s.table_number, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;

  -- RATE LIMIT (mig 205): too many orders from this table in the window → politely reject.
  IF NOT lfh_rate_check(v_rid, 'guest_order', 'table:' || v_s.table_number, 'Table ' || v_s.table_number) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  SELECT require_otp INTO v_req_otp FROM settings WHERE restaurant_id = v_rid;
  IF COALESCE(v_req_otp, true) AND NOT v_m.phone_verified THEN
    RETURN json_build_object('ok', false, 'reason', 'otp_required');
  END IF;

  -- 253: OPEN-PRICE dishes are priced by STAFF at order time (mig 215), which means
  -- lfh_price_order takes the line price from the CALLER for them. That is right for the
  -- waiter/manager panels and wrong here: these two functions are granted to "anon" and
  -- forward the browser's items verbatim, so a guest device would be naming its own amount.
  -- Every other price in this app comes from the database. The guest menu already hides these
  -- dishes (lib/menu.ts) -- this is the server-side backstop that makes the hiding a real rule
  -- rather than a UI preference. Staff RPCs are untouched and keep working.
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE m.open_price
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'staff_priced_item');
  END IF;

  -- 306: A DISH TAKEN OFF THE MENU IS NOT ORDERABLE FROM A GUEST DEVICE.
  -- 'hidden' is the third state beside sold-out (owner, 2026-08-06): sold-out still SHOWS on the
  -- menu wearing its badge, hidden is not on the guest menu at all. The guest read already drops
  -- these server-side (lib/menu.ts), so in normal use a basket cannot contain one -- this is the
  -- half that does not depend on the screen, which is the app's own rule: hiding is never the
  -- only guard. STAFF are deliberately unaffected: a waiter may still put an off-menu dish on a
  -- bill, and they order through the panel routes, not through here.
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE 'hidden' = ANY(m.tags)
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'hidden_item');
  END IF;

  -- SERVER prices the order — scoped to THIS session's restaurant (118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- AUTO-ACCEPT FOLLOW-UPS (163): staff already accepted an order for this seating,
  -- so this one skips straight to the pass — exactly what the Accept button writes.
  SELECT EXISTS (
    SELECT 1 FROM orders
     WHERE session_id = v_s.id
       AND status NOT IN ('received', 'cancelled')
       -- (357) …and it must still be ON THE FLOOR. An order staff have cleared away is not part
       -- of this seating any more, so it cannot stand in for the Accept nobody has given yet.
       AND NOT archived
       AND deleted_at IS NULL
  ) INTO v_auto;
  IF v_auto THEN
    v_status := 'preparing';
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status', 'preparing')), '[]'::jsonb)
      INTO v_items FROM jsonb_array_elements(v_priced->'items') e;
  ELSE
    v_status := 'received';
    v_items  := v_priced->'items';
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_s.table_number, v_items,
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), v_status, v_s.id, v_m.id, v_rid)
    RETURNING id INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        v_item->>'note', v_status, v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $function$;

-- ── 2. the table-QR door (no session of their own) ───────────────────────────────────────────
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
  v_max int;                 -- NEW (281/F21): this restaurant's highest real table
BEGIN
  -- RATE LIMIT (mig 205): cap public/QR orders per table in the window.
  IF NOT lfh_rate_check(v_rid, 'guest_order', 'table:' || COALESCE(v_tbl, '?'),
                        'Table ' || COALESCE(v_tbl, '?')) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- NEW (mig 281 / F21): THE TABLE MUST EXIST AT THIS RESTAURANT. Same rule and same wording as
  -- lfh_staff_open_table, so the guest path and the staff path agree. Only applied to a numeric
  -- table: a parcel / takeaway / banquet order has none and must stay unaffected.
  IF v_tbl IS NOT NULL AND v_tbl ~ '^\d+$' THEN
    SELECT COALESCE(table_count, 0) INTO v_max FROM settings WHERE restaurant_id = v_rid;
    IF v_max > 0 AND v_tbl::int > v_max THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_table',
        'error', format('Table %s doesn''t exist — tables are 1–%s.', v_tbl, v_max));
    END IF;
    IF v_tbl::int < 1 THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_table',
        'error', 'That table number isn''t valid.');
    END IF;
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

  -- 306: A DISH TAKEN OFF THE MENU IS NOT ORDERABLE FROM A GUEST DEVICE.
  -- 'hidden' is the third state beside sold-out (owner, 2026-08-06): sold-out still SHOWS on the
  -- menu wearing its badge, hidden is not on the guest menu at all. The guest read already drops
  -- these server-side (lib/menu.ts), so in normal use a basket cannot contain one -- this is the
  -- half that does not depend on the screen, which is the app's own rule: hiding is never the
  -- only guard. STAFF are deliberately unaffected: a waiter may still put an off-menu dish on a
  -- bill, and they order through the panel routes, not through here.
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE 'hidden' = ANY(m.tags)
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'hidden_item');
  END IF;

  -- Priced against the restaurant the order is FOR (118). This is also what makes an order
  -- carrying another restaurant's dishes impossible: unknown_item.
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
       -- (357) …and it must still be ON THE FLOOR. Staff clearing a table (the app's own
       -- soft-delete) leaves its orders 'preparing' and unpaid, so without these two lines a
       -- restarted table auto-accepted the NEXT party's very first order.
       AND NOT archived
       AND deleted_at IS NULL
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
END; $function$;

-- Both are guest-called anon RPCs, token-scoped / table-scoped (migs 029/083/164/264).
GRANT EXECUTE ON FUNCTION public.lfh_place_order(text, jsonb, text[])              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_place_order_public(text, jsonb, text[], uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
