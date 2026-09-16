-- 393 — the last fifteen tables lose their leftover public grant, and the cleanup is complete
-- (owner picked item 7 of sweep #9 terminal 30's report, 2026-09-17)
--
-- WHY. Migration 362 took Supabase's default anon/authenticated table grants off 23 server-only
-- tables; migration 392 did ten more. These fifteen are what is left, and they are the PRE-TENANCY
-- GUEST tables — the ones a diner's own journey runs through:
--
--   orders  sessions  session_members  order_items  customers  payments  waiter_calls  requests
--   blocklist  otp_codes  daily_counters  seq_counters  staff_actions  feedback  aggregator_orders
--
-- 392 deliberately stopped short of them and said why: "lfh_assign_bill_on_order is anon-reachable
-- AND SECURITY INVOKER AND writes `sessions`, so revoking there would break a diner placing an
-- order… those need their own pass with every INVOKER path traced". This is that pass.
--
-- ═══ THE FOUR THINGS THAT HAD TO BE TRUE, EACH CHECKED RATHER THAN ASSUMED ═══
--
-- 1. NO GUEST-CALLABLE FUNCTION NEEDS A TABLE GRANT ON ANY OF THEM.
--    A SECURITY DEFINER function runs as its owner, so a grant to anon is irrelevant to it — only
--    SECURITY **INVOKER** functions matter, because those run as the caller. Every INVOKER function
--    anon may EXECUTE was listed and read: `lfh_price_order` (menu_items, settings), `lfh_rid`,
--    `lfh_nice_usd`, `lfh_phone10`, `lfh_assign_kot`, `lfh_set_topic_rid` — none touches one of the
--    fifteen.
--
-- 2. THE THREE THAT DO TOUCH THEM RETURN TRIGGER, AND THAT IS THE WHOLE ANSWER TO 392's WARNING.
--    `lfh_assign_bill_on_order`, `lfh_session_close_cleanup` and `lfh_session_delete_cleanup` read
--    and write orders/sessions/session_members/waiter_calls/requests. A trigger function cannot be
--    CALLED — PostgREST will not expose it and PostgreSQL refuses a direct call — it can only FIRE
--    inside a statement, and it runs with that statement's privileges. Every guest write path is a
--    SECURITY DEFINER RPC (`lfh_place_order_public`, `lfh_join_session`, `lfh_call_waiter_table`,
--    `lfh_request`, …), so these triggers fire as the DEFINER, not as the diner. 392's warning was
--    right to stop; it was reasoning about a direct call that cannot happen.
--    **This was not left as reasoning** — see the proof note at the bottom.
--
-- 3. NO ANON-KEY CODE READS THEM. The anon client exists in exactly three places: `lib/menu.ts`
--    (the guest menu — reads `categories`, `item_ratings`, `menu_items`, `reviews`, and otherwise
--    only RPCs), and `components/AppShell.tsx` / `components/RealtimeProvider.tsx`, which only
--    subscribe. None of the fifteen is read directly with the public key.
--
-- 4. REALTIME CANNOT BREAK, which is the failure this change could most easily cause and the
--    hardest to notice. Supabase Realtime checks the subscriber's SELECT privilege on the table it
--    watches. Every subscriber in this app — the guest menu, all four panels, `public/panels/
--    realtime.js` — subscribes to ONE table, `realtime_events`, and the `supabase_realtime`
--    publication contains that table and nothing else. None of the fifteen is published or
--    watched, so no live update depends on these grants.
--
-- ═══ WHAT THIS DOES NOT CHANGE ═══
--
-- RLS was already ON with no policy on all fifteen, so the public key got no rows before this and
-- gets none now. Nothing on any screen moves. What changes is that the absence of a policy stops
-- being the only thing standing there — the standard migration 204 set: "defence in depth — same
-- spirit as the REVOKE staff RPCs from anon rule". service_role is untouched and still reads and
-- writes all fifteen, which is how every route already reaches them.
--
-- ⚠️ PROVED, NOT ARGUED. Point 2 is a claim about how PostgreSQL applies privileges to a trigger
-- fired inside a SECURITY DEFINER function, so it was tested rather than trusted: after applying
-- this file, a real guest placed a real order through the real menu on the real port — the dish
-- added, the cart priced, the order landed, and the session got its bill number (which is
-- `lfh_assign_bill_on_order`, the very trigger 392 worried about, writing to `sessions` after the
-- grant was gone). If that had failed, this migration would not exist.
--
-- Guarded by `npm run verify:server-only-tables`, which now watches all 25 and has no
-- "deliberately left alone" list any more — the cleanup is complete.

REVOKE ALL ON TABLE public.orders             FROM anon, authenticated;
REVOKE ALL ON TABLE public.sessions           FROM anon, authenticated;
REVOKE ALL ON TABLE public.session_members    FROM anon, authenticated;
REVOKE ALL ON TABLE public.order_items        FROM anon, authenticated;
REVOKE ALL ON TABLE public.customers          FROM anon, authenticated;
REVOKE ALL ON TABLE public.payments           FROM anon, authenticated;
REVOKE ALL ON TABLE public.waiter_calls       FROM anon, authenticated;
REVOKE ALL ON TABLE public.requests           FROM anon, authenticated;
REVOKE ALL ON TABLE public.blocklist          FROM anon, authenticated;
REVOKE ALL ON TABLE public.otp_codes          FROM anon, authenticated;
REVOKE ALL ON TABLE public.daily_counters     FROM anon, authenticated;
REVOKE ALL ON TABLE public.seq_counters       FROM anon, authenticated;
REVOKE ALL ON TABLE public.staff_actions      FROM anon, authenticated;
REVOKE ALL ON TABLE public.feedback           FROM anon, authenticated;
REVOKE ALL ON TABLE public.aggregator_orders  FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
