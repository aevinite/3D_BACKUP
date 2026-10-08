-- 413_the_loyalty_tables_lose_their_leftover_public_grant.sql — sweep #10 T39 item 31.
--
-- WHERE: backend only, nothing on screen changes.
--
-- Migrations 392 and 393 removed Supabase's default table grant from every server-only table, so a
-- table is reached only through the server's own key or a SECURITY DEFINER function — never by the
-- public key directly. Loyalty points (migrations 401/403, 2026-09-19) then created loyalty_config and
-- loyalty_ledger, which arrived with that default grant like every new table does. Row-level security
-- is on and neither has a policy, so the grant opened no rows to anyone; it is removed because the
-- rule is that a server-only table carries no public grant at all, not "carries one that RLS happens
-- to neutralise". verify:server-only-tables named both.
--
-- Safe: lib/loyalty.ts reads and writes both tables with supabaseAdmin (the service role), and every
-- loyalty function is already service_role-only (migration 403). Idempotent: REVOKE of a privilege
-- that is not held is a no-op. Rewrites no data.
REVOKE ALL ON TABLE public.loyalty_config FROM anon, authenticated;
REVOKE ALL ON TABLE public.loyalty_ledger FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
