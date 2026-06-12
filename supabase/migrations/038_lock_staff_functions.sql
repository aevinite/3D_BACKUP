-- SECURITY FIX (caught by the verification run, 2026-06-13): Postgres grants
-- EXECUTE on new functions to PUBLIC by default, so "no anon grant" was NOT
-- enough — a guest's anon key could call the STAFF-ONLY functions (place a
-- staff order, shift a table). Revoke the default and grant only service_role
-- (the key the staff panels' servers hold).

REVOKE EXECUTE ON FUNCTION lfh_staff_place_order(text, jsonb, text[], text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_place_order(text, jsonb, text[], text) TO service_role;

REVOKE EXECUTE ON FUNCTION lfh_staff_shift_table(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_staff_shift_table(uuid, text) TO service_role;

-- The counter helpers don't leak data but shouldn't be public-dialable either
-- (anyone could inflate the KOT/bill/invoice numbers). The order triggers that
-- use them run inside SECURITY DEFINER RPCs (or as service_role), so guests
-- never need direct execute rights.
REVOKE EXECUTE ON FUNCTION lfh_next_counter(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_next_counter(text) TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_next_seq(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_next_seq(text) TO service_role;

NOTIFY pgrst, 'reload schema';
