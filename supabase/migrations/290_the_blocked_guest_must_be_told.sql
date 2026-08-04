-- 290 — THE BLOCKED GUEST MUST BE TOLD (guest sweep 2026-08-04)
--
-- WHAT WAS WRONG
-- `BanGate` (components/BanGate.tsx) asks the database "is this device blocked?" on every
-- guest page load and again whenever the tab regains focus, through
-- `lib/session.ts` → checkBan() → rpc('lfh_check_ban', …).
--
-- Migration 267 dropped that function, and migration 281 dropped it a second time, on the
-- stated grounds that "nothing in SQL or app code calls either". That was true of
-- lfh_check_ban_scoped; it was NOT true of lfh_check_ban — lib/session.ts:203 has called it
-- all along. So on every guest menu load the browser fired
-- POST /rest/v1/rpc/lfh_check_ban and got a 404 (observed live on backup-1, both demo
-- restaurants, during an ordinary page load).
--
-- WHAT THAT COST
--   · The full-screen "You've been blocked" card could never appear: rpc() answers
--     {ok:false} on a failure and BanGate reads `r.ok !== false && r.banned`, so `banned`
--     stayed false forever. A guest the restaurant had blocked browsed the menu normally.
--   · With the card gone, so was the ONLY route back — the "leave your number and ask a
--     member of staff to unblock you" box lives inside it. The guest is still refused at
--     join/order (lfh_join_session uses lfh_device_banned, and the guest RPCs use
--     lfh_is_blocked), so no wrong money — but the refusal arrived with no explanation and
--     no way to appeal, while the staff panel still showed the feature as working.
--   · A failing request plus a console error on every diner's phone, on every load.
--
-- THE FIX
-- Restore the function exactly as migration 142 defined it — same name, same argument list
-- (text, text, uuid), same restaurant scoping, same JSON shape the component already reads
-- ({banned, reason, unban_requested}). Nothing in the app changes shape.
--
-- WHY THIS IS SAFE TO BE anon-CALLABLE, unlike the staff functions mig 267/038 locked down:
-- it is SECURITY DEFINER but it answers ONLY about the caller's own device/phone, it returns
-- no other guest's data and no restaurant data, and it cannot write. It is the same grant
-- migration 142 gave it. The default PUBLIC grant is revoked first (the mig-038 rule), so
-- anon is the only role that may call it.
--
-- KEEPING IT: `npm run verify:grants` lists functions whose grants have drifted, and the
-- guest sweep's own check is that a guest menu load produces no failing RPC. If this
-- function is ever dropped again, BanGate must be deleted in the SAME commit — a wall that
-- cannot appear is worse than no wall, because the panel still promises it works.

DROP FUNCTION IF EXISTS lfh_check_ban(text, text, uuid);
CREATE OR REPLACE FUNCTION lfh_check_ban(p_device text, p_phone text, p_restaurant_id uuid DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row blocklist;
BEGIN
  SELECT * INTO v_row FROM blocklist
    WHERE ((p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
        OR (p_phone  IS NOT NULL AND p_phone  <> '' AND phone     = p_phone))
      AND (p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id OR restaurant_id IS NULL)
    ORDER BY blocked_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('banned', false); END IF;
  RETURN json_build_object('banned', true, 'reason', v_row.reason,
                           'unban_requested', v_row.unban_requested_at IS NOT NULL);
END; $$;

-- Grants: the DROP above created a brand-new function object, and a new Postgres function
-- carries the default PUBLIC execute grant, so both lines are required (mig 038's rule).
REVOKE ALL ON FUNCTION lfh_check_ban(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lfh_check_ban(text, text, uuid) TO anon;
