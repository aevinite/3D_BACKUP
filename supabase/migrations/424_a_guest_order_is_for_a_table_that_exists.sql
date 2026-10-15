-- 424 · a guest order is for a table that exists (owner, 2026-10-15 — the order half of migration 423)
--
-- WHY. Sweep #10 terminal 3, round 3: while testing the four guest doors against random bodies, reading
-- lfh_place_order_public (migration 386's body, unchanged since) showed that its floor-plan check ran
-- ONLY for an all-digit table. A guest order with an empty table was stored with no table and no
-- session; one for "abc" or " 12 " opened a dining session on a table that does not exist. The phone
-- never sends those (lib/table.ts validateTable, digits only, canonical), but the database is the guard
-- that cannot be walked around. Same reasoning, rule and sentence as migration 423 for waiter calls.
--
-- WHAT CHANGES. Only the table block at the top of the function:
--   · the table must be a whole number (after trimming), 1 or more, at most 9 digits;
--   · not above settings.table_count when the restaurant has a floor plan (0 = none set up, let through,
--     exactly as 281 did);
--   · stored canonical ("007" → "7");
--   · checked BEFORE the rate limit, so a refused table writes no rate_limit_counters row.
-- Everything else is migration 386's body, byte for byte. Signature, SECURITY DEFINER and grants are
-- restated as they were. No column, no table, no data rewritten.

CREATE OR REPLACE FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
  v_order uuid; v_priced jsonb; v_auto boolean := false; v_items jsonb; v_status text;
  v_tbl text := NULLIF(p_table, '');
  v_s sessions;
  v_max int;                 -- (281/F21, 424): this restaurant's highest real table
BEGIN
  -- NEW (424): A GUEST ORDER IS FOR A TABLE THAT EXISTS — every guest order, not only a numeric one.
  -- Migration 281 checked the floor plan only when the table was all digits, on the reasoning that "a
  -- parcel / takeaway / banquet order has none". This is the GUEST function: no guest surface makes a
  -- parcel, takeaway or banquet order (lib/planTable.ts records the grep; the owner, 2026-09-14: "user/
  -- guest will scan qr and they will be locked to that particular table"), and staff place those through
  -- lfh_staff_place_order. So a guest order with NO table was stored with no table and no session, and
  -- one for "abc" or " 12 " opened a session on a table that does not exist — a tile on every staff floor
  -- nobody can walk to. The owner, 2026-10-15, for calls: "if the thing doesn't even exist then why it is
  -- being called" (migration 423). Same rule, same sentence, same canonical form, for orders.
  -- And it now runs BEFORE the rate limit, so a refused table leaves no counter row behind.
  -- Separate tests, never `A OR B`: Postgres does not promise to evaluate the left side first, and
  -- `'abc'::int` raises an error instead of answering.
  IF v_tbl IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table', 'error', 'That table number isn''t valid.');
  END IF;
  IF btrim(v_tbl) !~ '^\d{1,9}$' THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table', 'error', 'That table number isn''t valid.');
  END IF;
  IF btrim(v_tbl)::int < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table', 'error', 'That table number isn''t valid.');
  END IF;
  v_tbl := (btrim(v_tbl)::int)::text;   -- canonical: "007" and " 7 " are table 7, the tile the floor draws
  SELECT COALESCE(table_count, 0) INTO v_max FROM settings WHERE restaurant_id = v_rid;
  IF COALESCE(v_max, 0) > 0 AND v_tbl::int > v_max THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table',
      'error', format('Table %s doesn''t exist — tables are 1–%s.', v_tbl, v_max));
  END IF;

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

REVOKE ALL ON FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid) TO service_role, anon, authenticated;
