-- 354_the_last_half_of_a_retired_stub.sql
--
-- Drops `lfh_request_verification` — the surviving half of the migration-037 verification stub.
--
-- ITS PARTNER HAS BEEN REMOVED THREE TIMES. Migration 267 dropped `lfh_check_verification` as dead
-- code ("nothing calls it"); migration 296 restored it by mistake; migration 297 — a file named
-- "undo a resurrection" — dropped it again and wrote down why; and the migrations-001-118 sweep found
-- a fourth route back (running migration 040 alone re-created it AND re-granted it to the public menu
-- key) and closed that too. This function is the other half of the same retired pair. Migration 297
-- said so in as many words: "Nothing in the app calls it; the live OTP path is lfh_send_otp /
-- lfh_verify_otp over `otp_codes`. Safe to drop when someone decides to." The owner decided
-- (2026-08-21).
--
-- Zero callers, checked again before writing: nothing in app/, lib/, components/, public/panels/ or
-- scripts/ calls it except the guard that asserted it existed, and that guard is rewritten in this
-- same change (below). It was still reachable with the public menu key, so this removes a
-- code-issuing door standing next to the real one while the `verification` flag makes it invisible.
--
-- WHAT REPLACES ITS GUARD, so a rule does not quietly lose its check. `scripts/verify-families.mjs`
-- asserted the RPC answers `{ok:false, reason:'disabled'}` while its backend-only flag is off, and
-- migration 297 correctly called that "a genuine guard on the backend-only-flags rule". Deleting the
-- assertion would have cost that. It now asserts the stronger thing: the RPC is NOT REACHABLE AT ALL.
-- A feature that cannot be called is better evidence for "this system isn't there" than a feature
-- that politely declines. The flags-are-off half of that check is untouched.
--
-- `verification_codes` DELIBERATELY STAYS, and this is not laziness — read before "finishing the job".
-- It is empty (0 rows), RLS-locked, read by nothing, and already carries a RETIRED comment from
-- migration 267. But `admin_purge_restaurant` contains
--     delete from verification_codes where restaurant_id = p_rid;
-- so dropping the table means hand-editing the body of the function that permanently deletes a
-- restaurant. Re-typing a destructive function to remove an empty table that costs nothing is a worse
-- trade than leaving the table alone. It goes when the purge is next touched for its own reasons.

DROP FUNCTION IF EXISTS public.lfh_request_verification(text, text, uuid);

COMMENT ON TABLE verification_codes IS
  'RETIRED (migs 037/267). Both of its functions are now gone: lfh_check_verification (dropped by '
  'mig 267, again by 297) and lfh_request_verification (dropped by mig 354). The live phone path is '
  'lfh_send_otp / lfh_verify_otp over `otp_codes`. This table is kept ONLY because '
  'admin_purge_restaurant still deletes from it; drop both together when that function is next '
  'edited. It holds no rows and nothing reads it.';

NOTIFY pgrst, 'reload schema';
