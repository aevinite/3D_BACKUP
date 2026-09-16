-- 392 — ten more server-only tables lose the leftover public grant
-- (owner picked item 5 of sweep #9 terminal 30's round-2 report, 2026-09-16)
--
-- WHY. Migration 362 took Supabase's default `anon`/`authenticated` table grants off 23 tables that
-- only the service-role server touches, on the owner's approval, and said why: RLS on with no policy
-- means the public menu key gets no rows TODAY, but the absence of a policy is then the ONLY thing
-- standing there. Migration 204 set that standard — "defence in depth — same spirit as the REVOKE
-- staff RPCs from anon rule" — and 196 did it for owner_analytics_cache.
--
-- Ten tables have appeared since and never got the second half:
--
--   banquet_bills            bill_chain               inv_recipe_lines
--   print_agents             print_jobs               print_setup_codes
--   print_stations           printer_events           restaurant_owners
--   restaurant_slug_history
--
-- ═══ EVERY ONE WAS CHECKED AGAINST ITS CALL SITES FIRST, WHICH IS WHAT MADE THIS SAFE ═══
--
-- The 2026-08-22 approval of migration 362 said this is "low but not zero — a REVOKE on a live table
-- is the kind of change that breaks a read nobody remembered", and asked for each table to be
-- checked against the app's anon client first. So, every call site across app/, lib/ and public/:
--
--   · all ten are reached ONLY through `supabaseAdmin` (the service-role client), which bypasses
--     both RLS and table grants. Two sit outside app/api and lib and were read individually:
--     `app/owner/manager/page.tsx` and `app/r/[restaurant]/owner/route.ts` both import
--     `supabaseAdmin as sb`. A third apparent hit, `app/aevinite/printing/page.tsx:1185`, is a
--     clash-expectation object (`{ table: "print_agents", … }` for lib/clash.ts) and not a read.
--   · NO anon-callable SECURITY INVOKER function reads any of the ten. That check matters more than
--     the grant itself: an INVOKER function runs AS THE CALLER, so revoking a table one of them
--     reads would silently break a guest. The only INVOKER function touching any of these is
--     `lfh_bill_chain_append_only`, the append-only trigger on bill_chain, which is staff-only and
--     fires from service-role writes. The anon-reachable INVOKER functions read `menu_items`,
--     `settings`, `sessions` and `table_tags` — none of them here.
--
-- ═══ FIFTEEN MORE STILL CARRY THE GRANT AND ARE DELIBERATELY LEFT ALONE ═══
--
-- Derived from the database, there are 25 such tables, not 10. The other fifteen are the
-- PRE-TENANCY GUEST tables — orders, sessions, session_members, order_items, customers, payments,
-- waiter_calls, requests, blocklist, otp_codes, daily_counters, seq_counters, staff_actions,
-- feedback, aggregator_orders — and they are exactly where a revoke is dangerous:
-- `lfh_assign_bill_on_order` is anon-reachable AND SECURITY INVOKER AND writes `sessions`, so
-- revoking that one would break a guest placing an order, loudly, at the till. Those fifteen need
-- their own pass with each INVOKER path traced, and that is a separate decision — not something to
-- fold into a change the owner approved for ten named tables.
--
-- WHAT CHANGES FOR ANYONE: nothing. No screen, no request, no figure. RLS already denied these rows
-- to the public key; this removes the grant behind it so two things stand there instead of one.
--
-- Guarded by `npm run verify:grants` (which already fails on a table reachable with the public key)
-- and by `npm run verify:server-only-tables`, which names these ten so a future migration cannot
-- hand the grant back without the check going red.

REVOKE ALL ON TABLE public.banquet_bills           FROM anon, authenticated;
REVOKE ALL ON TABLE public.bill_chain              FROM anon, authenticated;
REVOKE ALL ON TABLE public.inv_recipe_lines        FROM anon, authenticated;
REVOKE ALL ON TABLE public.print_agents            FROM anon, authenticated;
REVOKE ALL ON TABLE public.print_jobs              FROM anon, authenticated;
REVOKE ALL ON TABLE public.print_setup_codes       FROM anon, authenticated;
REVOKE ALL ON TABLE public.print_stations          FROM anon, authenticated;
REVOKE ALL ON TABLE public.printer_events          FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_owners       FROM anon, authenticated;
REVOKE ALL ON TABLE public.restaurant_slug_history FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
