-- 306_hidden_dishes.sql — A THIRD STATE FOR A DISH: on the menu · SOLD OUT · HIDDEN.
--
-- OWNER, 2026-08-06: "in sold out add option that [it] didn't even show in menu … so that some
-- will show as sold out, some will be not show, only hidden — add that with sold, you can toggle."
--
-- SOLD OUT and HIDDEN are different promises to a diner:
--   sold-out  the dish IS on the menu, wearing its badge, and cannot be ordered today
--   hidden    the dish is not on the guest menu AT ALL — as if it were never printed
--
-- Both are tags on menu_items, so this needs no new column and the editor's existing tag
-- plumbing carries it. What it DOES need is the half that does not depend on a screen: the
-- guest read drops hidden dishes server-side (lib/menu.ts), and the two guest ordering
-- functions refuse one outright. CLAUDE.md: hiding is never the only guard.
--
-- STAFF ARE DELIBERATELY UNAFFECTED (owner chose this): a waiter may still put an off-menu dish
-- on a bill — an off-menu special, a staff meal, something served only on request. They order
-- through the panel routes, which never call these two functions.
--
-- ⚠ RECREATE SAFETY. Both bodies below were copied VERBATIM from the migration that last defined
-- them (session → mig 253, public → mig 281) by script, not retyped, with exactly one block
-- inserted. That is deliberate: mig 264's first draft silently dropped mig 253's open-price guard
-- because a body was copied from the wrong ancestor, and that trap is recorded in CLAUDE.md.
-- `npm run verify:hidden` asserts every earlier guard is still present in both.

-- ── 1. SESSION order (the guest is in a dining session) — body from mig 253 ──────────
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

-- ── 2. PUBLIC / QR order (identified by table number) — body from mig 281 ───────────
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
