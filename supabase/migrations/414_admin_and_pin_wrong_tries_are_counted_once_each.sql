-- 414 — THE ADMIN DOOR AND THE MANAGER PIN COUNT EVERY WRONG TRY, EVEN WHEN SEVERAL ARRIVE AT ONCE
-- (sweep #10 T17 round 4, item 29, 2026-10-08)
--
-- lib/loginThrottle.ts → throttleFail counted a wrong try by READING login_throttle.fail_count, adding one in the app
-- and UPSERTING it back. Ten wrong tries sent at the same instant all read 0 and all wrote 1 — measured on the dev stack
-- with a throwaway key (r4test:<uuid>, deleted by the same run): count 1, no lock, after 10 simultaneous tries. So the
-- admin door's "10 wrong tries lock this address for 5 minutes" and the manager PIN's per-device lock did not hold for
-- tries sent together. Migration 411 fixed the same shape for staff passwords; this is its sibling for the throttle table.
--
-- The add-one now happens INSIDE the insert-or-update, so concurrent tries queue on the row lock and each one counts.
-- Same rule as before: the try that reaches p_max locks the key for p_lock_ms and resets the count. Two small changes,
-- both in the safe direction: a lock already running is never SHORTENED by a later lock, and a key that is still
-- locked (a deliberate block, ~100 years out) keeps its lock instead of having it cleared by a wrong try that slipped
-- in at the same moment — the old upsert wrote locked_until = null on every non-locking try.
--
-- Returns the count this try reached (before any reset) and whether it locked, which is what the admin door needs for
-- "N tries left" and for the third-try alert. Staff-only: called with the service role, never from a browser.
CREATE OR REPLACE FUNCTION public.lfh_throttle_fail(p_key text, p_max integer, p_lock_ms integer)
RETURNS TABLE (fail_count integer, locked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO login_throttle AS t (key, fail_count, locked_until, updated_at)
       VALUES (p_key, 1, NULL, now())
  ON CONFLICT (key) DO UPDATE
       SET fail_count   = t.fail_count + 1,
           locked_until = CASE WHEN t.locked_until > now() THEN t.locked_until ELSE NULL END,
           updated_at   = now()
  RETURNING t.fail_count INTO n;

  IF n >= p_max THEN
    -- The row is already locked by the statement above for the rest of this call, so this cannot interleave.
    UPDATE login_throttle t
       SET fail_count   = 0,
           locked_until = GREATEST(COALESCE(t.locked_until, now()), now() + make_interval(secs => p_lock_ms / 1000.0)),
           updated_at   = now()
     WHERE t.key = p_key;
    RETURN QUERY SELECT n, true;
  ELSE
    RETURN QUERY SELECT n, false;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lfh_throttle_fail(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_throttle_fail(text, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
