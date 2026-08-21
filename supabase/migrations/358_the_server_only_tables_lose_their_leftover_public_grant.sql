-- 358_the_server_only_tables_lose_their_leftover_public_grant.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- DEFENCE IN DEPTH, finishing a job migration 204 started in this same range.
--
-- 23 tables created by migrations 121-230 are protected today by exactly ONE thing: row-level
-- security is on and they carry no read policy, so the public menu key gets no rows from them.
-- That is true and it is checked (`npm run verify:grants`). But they ALSO still carry Supabase's
-- default `anon` / `authenticated` table grants, handed out automatically as each table was
-- created. So the only thing standing between the public key and these rows is the ABSENCE of a
-- policy — and a policy is a thing somebody adds later, for a good reason, without necessarily
-- knowing it is also the lock.
--
-- Migration 204 set the standard for exactly this case. It enabled RLS on seven server-only
-- tables AND dropped the stray grants on the two that had them, in its own words: "defence in
-- depth — same spirit as the REVOKE staff RPCs from anon rule in CLAUDE.md / migration 038".
-- Migration 196 did the same for `owner_analytics_cache`. These 23 never got that second half.
--
-- CHECKED BEFORE WRITING, because narrowing a grant the code still needs is how the guest menu
-- has been broken before:
--   • every call site for all 23 tables lives in `app/api/**` or `lib/**` and goes through the
--     SERVICE-ROLE client, which bypasses both RLS and these grants. The one call site outside
--     those folders is `app/q/[code]/page.tsx` reading `table_qr_codes` — and it uses
--     `supabaseAdmin` too (it is a server component; its own comment says so).
--   • with RLS on and no policy, anon already receives ZERO rows from every one of them, so this
--     removes no data anybody is getting. It changes a silent empty answer into an honest refusal.
--
-- Owner approved 2026-08-22 ("do all the things you told in the need decision"), from sweep #6
-- terminal 22's improvement I1.
--
-- If a future feature genuinely needs one of these read with the public key, it needs a read
-- POLICY *and* a grant — and the grant with no policy did nothing anyway. See the memory note
-- "a read POLICY with no GRANT does nothing"; this is that rule from the other side.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.action_idempotency     FROM anon, authenticated;
REVOKE ALL ON public.agent_runs             FROM anon, authenticated;
REVOKE ALL ON public.app_config             FROM anon, authenticated;
REVOKE ALL ON public.banquet_items          FROM anon, authenticated;
REVOKE ALL ON public.customer_devices       FROM anon, authenticated;
REVOKE ALL ON public.customer_visits        FROM anon, authenticated;
REVOKE ALL ON public.expenses               FROM anon, authenticated;
REVOKE ALL ON public.fix_requests           FROM anon, authenticated;
REVOKE ALL ON public.inv_count_lines        FROM anon, authenticated;
REVOKE ALL ON public.inv_counts             FROM anon, authenticated;
REVOKE ALL ON public.inv_items              FROM anon, authenticated;
REVOKE ALL ON public.inv_movements          FROM anon, authenticated;
REVOKE ALL ON public.inv_purchase_lines     FROM anon, authenticated;
REVOKE ALL ON public.inv_purchases          FROM anon, authenticated;
REVOKE ALL ON public.inv_vendors            FROM anon, authenticated;
REVOKE ALL ON public.inv_waste_entries      FROM anon, authenticated;
REVOKE ALL ON public.khata_customers        FROM anon, authenticated;
REVOKE ALL ON public.login_throttle         FROM anon, authenticated;
REVOKE ALL ON public.session_payments       FROM anon, authenticated;
REVOKE ALL ON public.staff_payments         FROM anon, authenticated;
REVOKE ALL ON public.table_qr_codes         FROM anon, authenticated;
REVOKE ALL ON public.table_tags             FROM anon, authenticated;
REVOKE ALL ON public.unblock_requests       FROM anon, authenticated;

-- Belt: the service role must keep everything it had (it is what every panel route uses).
-- CREATE-time defaults already grant it; this makes the intent explicit and is a no-op otherwise.
DO $keep_service_role$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['action_idempotency', 'agent_runs', 'app_config', 'banquet_items', 'customer_devices', 'customer_visits', 'expenses', 'fix_requests', 'inv_count_lines', 'inv_counts', 'inv_items', 'inv_movements', 'inv_purchase_lines', 'inv_purchases', 'inv_vendors', 'inv_waste_entries', 'khata_customers', 'login_throttle', 'session_payments', 'staff_payments', 'table_qr_codes', 'table_tags', 'unblock_requests'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    END IF;
  END LOOP;
END $keep_service_role$;

NOTIFY pgrst, 'reload schema';
