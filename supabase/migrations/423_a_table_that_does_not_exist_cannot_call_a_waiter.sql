-- 423 · a table that does not exist cannot call a waiter (owner, 2026-10-15)
--
-- WHY. Owner, on sweep #10 terminal 3's item 29: "the table which are not there they shouldn't be
-- able to call … if the thing doesn't even exist then why it is being called". The guest bell
-- (components/ChefPopup.tsx → lib/menu.ts callWaiter) sends its call from the phone STRAIGHT to this
-- function — no route of ours sits in between — so the only check on the table number was the one
-- the popup does on the phone. A QR or a hand-made request naming table 45 at a 30-table restaurant
-- raised a hand nobody could walk to, and because the floor (lfh_floor_state) draws tables 1..count
-- PLUS any table with activity, it also put a phantom "table 45" tile on every staff floor.
--
-- An ORDER has had this rule since migration 281 (lfh_place_order_public: "the table must exist at
-- this restaurant"). The waiter call never got it. Same rule now, same reason code, same sentence:
--   · the table must be a whole number — a guest bell only ever sends digits (lib/table.ts
--     validateTable), and nothing else calls this function with a label (grepped: the app, the
--     tests and the stress scripts all send numbers);
--   · 1 or more;
--   · not above settings.table_count — when the restaurant has a floor plan at all (0 = none set up,
--     exactly the case migration 281 also lets through, so a brand-new restaurant is not dead-ended).
-- And it is stored CANONICAL ("007" → "7"), the same rule validateTable applies, so a call can never
-- sit on a table name the floor tile does not have.
--
-- The refusal is `{ ok:false, reason:'unknown_table', error:'Table 45 doesn''t exist — tables are 1–30.' }`
-- — word for word what migration 281 answers for an order. lib/guestOutbox.ts already words
-- `unknown_table` for every kind; components/ChefPopup.tsx gains the live door's branch.
--
-- WHAT IS UNCHANGED. Everything after the new check is migration 386's body exactly as it was: the
-- blocked-table check, the rate limit (mig 205), the 6-second dedupe, the 6-call cap, the session
-- stamp (mig 334) and the insert. Signature, grants and SECURITY DEFINER are restated as they were.
-- Additive in behaviour only: no column, no table, no data rewritten.

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
  IF v_t !~ '^\d{1,9}$' THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table', 'error', 'That table number isn''t valid.');
  END IF;
  IF v_t::int < 1 THEN
    RETURN json_build_object('ok', false, 'reason', 'unknown_table', 'error', 'That table number isn''t valid.');
  END IF;
  v_t := (v_t::int)::text;   -- canonical: "007" is table 7, the tile the floor draws
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
