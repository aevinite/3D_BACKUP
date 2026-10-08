-- 411 — EVERY WRONG PASSWORD IS COUNTED, EVEN WHEN SEVERAL ARRIVE AT ONCE (sweep #10 T17 round 3, item 23, 2026-10-08)
--
-- lib/userAuth.ts → loginUser counted a wrong password by READING failed_count, adding one in the app and WRITING it
-- back. Four wrong passwords sent at the same instant all read 0 and all wrote 1 — measured on the dev stack with a
-- throwaway French House login: count 1 after 4 simultaneous wrong tries. So "five wrong tries lock the account for a
-- minute" did not hold for tries sent together. (The per-name sign-in limit, lfh_rate_check, is counted atomically in
-- the database and still capped guessing at 5 per 5 minutes per door — this was never open, but the lockout lied.)
--
-- This function does the add-one INSIDE the update, so concurrent tries queue on the row lock and each one counts.
-- Same rule as before: the try that reaches p_max locks the row for p_lock_seconds and resets the count.
-- Staff-only: called with the service role from /api/panel-login, never from a browser.
CREATE OR REPLACE FUNCTION public.lfh_staff_login_failed(p_ids uuid[], p_max integer DEFAULT 5, p_lock_seconds integer DEFAULT 60)
RETURNS TABLE (id uuid, failed_count integer, locked_until timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE staff_users s
     SET failed_count = CASE WHEN s.failed_count + 1 >= p_max THEN 0 ELSE s.failed_count + 1 END,
         locked_until = CASE WHEN s.failed_count + 1 >= p_max THEN now() + make_interval(secs => p_lock_seconds) ELSE s.locked_until END
   WHERE s.id = ANY (p_ids)
  RETURNING s.id, s.failed_count, s.locked_until;
$$;

REVOKE ALL ON FUNCTION public.lfh_staff_login_failed(uuid[], integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_staff_login_failed(uuid[], integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
