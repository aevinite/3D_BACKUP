-- 141 — waiter-call throttle: dedup PER REASON, not per table. (renumbered from 138)
--
-- Audit 2026-07-06: the 6-second anti-spam throttle in lfh_call_waiter_table
-- keyed only on the table number, so a guest who tapped "Water" and then a
-- DIFFERENT request ("Bring the bill") within 6s had the second one silently
-- dropped as `already_sent` — while the guest UI still said "staff notified".
-- The bill request never reached staff.
--
-- Fix: the throttle now also matches the NOTE (the reason), so only a genuine
-- REPEAT of the SAME request within 6s is deduped; a different request always
-- goes through. Everything else (blocked check, cap, restaurant scoping) is
-- byte-for-byte the latest (083) version. The client now also reads the returned
-- {ok, reason} and only shows success when a call actually landed.
CREATE OR REPLACE FUNCTION lfh_call_waiter_table(
  p_table text, p_note text,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_t text := NULLIF(btrim(p_table), '');
  v_note text := NULLIF(btrim(p_note), '');
BEGIN
  IF v_t IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_table'); END IF;
  -- A blocked table can't summon staff.
  IF lfh_is_blocked(NULL, v_t, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
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
  INSERT INTO waiter_calls(table_number, note, restaurant_id) VALUES (v_t, v_note, v_rid);
  RETURN json_build_object('ok', true);
END; $$;
