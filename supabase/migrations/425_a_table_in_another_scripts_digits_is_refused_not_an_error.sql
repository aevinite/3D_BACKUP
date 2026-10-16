-- 425 · a table written in another script's digits, or a restaurant that does not exist, is refused — not a
--       database error (sweep #10 T3, round 4)
--
-- WHAT WAS WRONG. Migrations 423 and 424 test a guest's table with  ~ '^\d{1,9}$'  and then cast it to an
-- integer. On this database (ICU collation, en_US.UTF-8) Postgres's \d is [[:digit:]], which matches EVERY
-- script's digits — Arabic-Indic ٤, Devanagari ४, full-width ４ — while ::int reads only 0–9. So
-- lfh_call_waiter_table('٤') and lfh_place_order_public('٤') passed the test and then failed the cast:
-- PostgREST answered 400 with code 22P02 ("invalid input syntax for type integer") instead of the
-- function's own {ok:false, reason:'unknown_table'}. Measured on the dev database, 2026-10-16.
--
-- WHO COULD REACH IT. Not the app's own screens: both table boxes strip anything but 0–9 as it is typed,
-- and both guest doors run lib/planTable.ts guestTable() first (JavaScript's \d is 0–9 only). But the
-- waiter bell calls lfh_call_waiter_table straight from the phone (lib/menu.ts), so the function's own
-- answer is the one that has to be right.
--
-- THE CHANGE. '^\d{1,9}$' → '^[0-9]{1,9}$' in both functions, and lfh_call_waiter_table answers
-- unknown_restaurant for a restaurant id that does not exist (it raised a foreign-key error — see the note
-- in its body). Nothing else: each body below is migration 423's / 424's exactly, signature, grants and
-- SECURITY DEFINER restated. No data is touched.
--
-- NOT CHANGED HERE (other areas, reported to them): lfh_banquet_bill_create, lfh_staff_merge_tables,
-- lfh_staff_move_order, lfh_staff_move_order_item and lfh_staff_shift_table use '^\d+$' the same way.

CREATE OR REPLACE FUNCTION public.lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
  v_t text := NULLIF(btrim(p_table), '');
  v_note text := NULLIF(btrim(p_note), '');
  v_sid uuid;
  v_max int;                 -- NEW (423): this restaurant's highest real table
BEGIN
  IF v_t IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_table'); END IF;
  -- NEW (423): THE TABLE MUST EXIST AT THIS RESTAURANT — migration 281's rule for an order, now for a
  -- call. A whole number (at most 9 digits, so the cast below can never overflow), 1 or more, and not
  -- above the floor plan when there is one.
  -- Two separate tests, never `A OR B`: Postgres does not promise to evaluate the left side first, and
  -- `'abc'::int` raises an error instead of answering.
  -- (425) [0-9], never \d: on this database \d also matches ٤ ४ ４, which the cast below cannot read.
  IF v_t !~ '^[0-9]{1,9}$' THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table', 'error', 'That table number isn''t valid.');
  END IF;
  IF v_t::int < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table', 'error', 'That table number isn''t valid.');
  END IF;
  v_t := (v_t::int)::text;   -- canonical: "007" is table 7, the tile the floor draws
  -- (425) A RESTAURANT THAT DOES NOT EXIST IS ANSWERED, NOT AN ERROR. The insert below used to fail on its
  -- foreign key (23503), the guest door turns any database error into "busy" (502), and a phone that held
  -- a saved call for a removed restaurant was told to wait and kept re-sending a call that can never land.
  -- unknown_restaurant is a reason the phone already words (lib/guestOutbox.ts) and stops on.
  IF NOT EXISTS (SELECT 1 FROM restaurants WHERE id = v_rid) THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_restaurant');
  END IF;
  SELECT COALESCE(table_count, 0) INTO v_max FROM settings WHERE restaurant_id = v_rid;
  IF COALESCE(v_max, 0) > 0 AND v_t::int > v_max THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table',
      'error', format('Table %s doesn''t exist — tables are 1–%s.', v_t, v_max));
  END IF;
  -- A blocked table can't summon staff.
  IF lfh_is_blocked(NULL, v_t, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- RATE LIMIT (mig 205): admin-configurable cap on waiter calls per table, on top of the
  -- existing 6s dedupe + 6-call cap below.
  IF NOT lfh_rate_check(v_rid, 'waiter_call', 'table:' || v_t, 'Table ' || v_t) THEN
    RETURN json_build_object('ok', true, 'reason', 'rate_limited');
  END IF;
  -- Anti-spam throttle: ignore a repeat of the SAME request for the same table
  -- within 6 seconds. Keyed on the note too, so a DIFFERENT request still lands.
  IF EXISTS (SELECT 1 FROM waiter_calls
              WHERE table_number = v_t AND NOT resolved
                AND created_at > now() - interval '6 seconds'
                AND restaurant_id = v_rid
                AND note IS NOT DISTINCT FROM v_note) THEN
    RETURN json_build_object('ok', true, 'reason', 'already_sent');
  END IF;
  -- Hard cap: never let more than 6 unresolved calls stack on one table.
  IF (SELECT count(*) FROM waiter_calls
        WHERE table_number = v_t AND NOT resolved AND restaurant_id = v_rid) >= 6 THEN
    RETURN json_build_object('ok', true, 'reason', 'capped');
  END IF;
  -- WHICH PARTY IS THIS BELL FOR? The floor gathers calls BY SESSION whenever dining sessions are
  -- on, so a call with no session on it is invisible to every panel — the guest is told "we've told
  -- them" and nobody is. Stamp the party that covers this table (its own, or the one it is joined
  -- to). Stays NULL when there is no open party, which is exactly the sessions-off case the floor
  -- already shows unconditionally, so nothing changes there.
  SELECT s.id INTO v_sid FROM sessions s
    WHERE s.table_number = lfh_merge_parent_table(v_rid, v_t) AND s.status = 'open' AND s.restaurant_id = v_rid
    ORDER BY s.last_activity_at DESC LIMIT 1;
  -- table_number stays the table the guest is REALLY at: the waiter has to walk to that one, and
  -- every panel treats a call as belonging to the table it was rung at, merged or not.
  INSERT INTO waiter_calls(table_number, note, restaurant_id, session_id) VALUES (v_t, v_note, v_rid, v_sid);
  RETURN json_build_object('ok', true);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid) TO service_role, anon, authenticated;

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
  -- (425) [0-9], never \d: on this database \d also matches ٤ ४ ４, which the cast below cannot read.
  IF btrim(v_tbl) !~ '^[0-9]{1,9}$' THEN
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
