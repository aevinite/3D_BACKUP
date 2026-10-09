-- 416 — the last seven tables lose the guest/staff-key privileges no rule ever let them use
-- (sweep #10 T30 round 3, item 21, 2026-10-09 — owner: "do all"; the full read-policy review the
-- efficiency playbook §5 had listed as still owed)
--
-- THE REVIEW, TABLE BY TABLE (read from pg_class / pg_policies / has_table_privilege on the dev database):
--   · all 77 public tables have row-level security ON;
--   · the public key (anon) and the signed-in key (authenticated) can READ exactly five of them, each
--     through a policy that exists on purpose: categories, filters, menu_items, reviews (the guest
--     menu, migs 030/…) and realtime_events (the breadcrumb Realtime delivers — mig 057: "Anon/
--     authenticated may ONLY read (so Realtime can deliver)"; it carries a table number and a kind,
--     never a name or a figure);
--   · they can WRITE none of them: no policy anywhere grants INSERT / UPDATE / DELETE to either role.
--
-- What was left is 46 table privileges that RLS already blocks — Supabase's default grants that
-- migrations 362, 392 and 393 removed from every other table: write privileges on the five tables
-- above, and every privilege on deletion_audit and table_merges (server-only tables whose only policy
-- is for the service role). They do nothing today; they are removed so that "no policy" is not the
-- ONLY thing standing between the public key and a write — the same defence-in-depth standard as mig
-- 204 / 393. SELECT stays where a policy uses it, so the guest menu and Realtime are untouched.
--
-- Checked first, the way 393 did: every SECURITY INVOKER function anon may execute (lfh_price_order,
-- lfh_rid, lfh_nice_usd, lfh_phone10, lfh_assign_kot, lfh_set_topic_rid) only READS menu_items or is
-- a trigger that fires inside a SECURITY DEFINER statement; no anon-key code writes any of these.
-- service_role is untouched. Idempotent (REVOKE of an absent privilege is a no-op).
-- ⚠️ BACKUP-STACK FILE FIRST: AV live receives it only through the release ritual, asked for by name.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.categories, public.filters, public.menu_items, public.reviews, public.realtime_events
  FROM anon, authenticated;

REVOKE ALL ON public.deletion_audit, public.table_merges FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
