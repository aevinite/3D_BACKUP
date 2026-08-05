-- 297_undo_a_resurrection.sql
--
-- CORRECTING MIGRATION 296. I reported `lfh_check_verification` as MISSING from the database and
-- restored it. It was not missing — migration 267 DELETED it on purpose, as dead code:
--
--     "The mig-037 OTP stub. The live OTP path is lfh_send_otp / lfh_verify_otp against
--      `otp_codes`; this one reads `verification_codes` and nothing calls it."
--
-- I only read migrations 001–150 (that was the sweep's scope) so I saw migration 040 create it,
-- saw it absent from `pg_proc`, and called it drift. The decision to remove it was written down
-- 117 migrations later, exactly where it should have been — I just never looked there. The lesson
-- is the cheap one: before calling a missing object "drift", grep the WHOLE migrations folder for
-- its name, not only the range under review.
--
-- So put it back the way 267 left it. `verification_codes` itself carries a RETIRED comment from
-- the same migration, which is the real statement of intent for this whole stub.
DROP FUNCTION IF EXISTS lfh_check_verification(text, text, uuid);

-- WHAT MIGRATION 296 GOT RIGHT AND IS KEPT: `lfh_request_verification` still exists and is still
-- reachable with the public key, so hardening it was worth doing regardless of whether the feature
-- is dead. Before 296 it read `settings WHERE id = 'site'` — restaurant #1's row — so #1's switch
-- answered for every restaurant, and if that row were ever renamed the read found nothing, `v_on`
-- was NULL, `IF NOT v_on` was NULL rather than TRUE, and the guard did not fire at all: it would
-- have started handing out codes with the feature off. It now takes the restaurant as an argument
-- and answers 'disabled' for anything unclear — no restaurant, no settings row, NULL flag.
--
-- It is nevertheless the surviving half of a retired stub, and the honest thing is to say so here
-- rather than leave the next reader to work it out. Retiring it too is a one-line DROP whenever
-- the owner wants it gone; it is not done unasked because `scripts/verify-families.mjs` asserts it
-- answers 'disabled', and that assertion is a genuine guard on the backend-only-flags rule.
COMMENT ON FUNCTION lfh_request_verification(text, text, uuid) IS
  'SURVIVING HALF OF A RETIRED STUB (migs 037/040; its partner lfh_check_verification was dropped '
  'by mig 267 as dead code, and `verification_codes` is marked RETIRED there too). Hardened by mig '
  '296 to read its OWN restaurant''s switch and fail CLOSED. Nothing in the app calls it; the live '
  'OTP path is lfh_send_otp / lfh_verify_otp over `otp_codes`. Safe to drop when someone decides to.';

NOTIFY pgrst, 'reload schema';
