-- SECURITY FIX (caught by the code review, 2026-06-13): the six tables added in
-- migrations 036-037 shipped WITHOUT row-level security, so Supabase's default
-- public-schema grants let the anon (guest) key read and write them directly —
-- including verification_codes (OTP codes in cleartext) and payments. Migration
-- 014 locks "every new table" exactly this way: enable RLS with NO policy, which
-- denies anon/authenticated entirely. The SECURITY DEFINER RPCs (lfh_leave_feedback,
-- the OTP RPCs, the order triggers that bump the counters) run as the table owner
-- and BYPASS RLS, and the staff panels use the service-role key (also bypasses),
-- so every legitimate path keeps working — only direct guest access is shut off.

ALTER TABLE feedback           ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregator_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_counters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE seq_counters       ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
