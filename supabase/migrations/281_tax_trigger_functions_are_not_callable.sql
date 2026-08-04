-- 281_tax_trigger_functions_are_not_callable.sql
--
-- Migration 270 added two TRIGGER functions and, against this project's own standing rule
-- (mig 038: "a new Postgres function is PUBLIC-executable by default"), never revoked them.
-- `npm run verify:grants` caught it.
--
-- A trigger function is invoked by the trigger machinery, not by a role calling it, so no
-- role needs EXECUTE on it and revoking changes no behaviour whatsoever — which is precisely
-- why it is worth doing: a callable function that nothing is supposed to call is a loose end
-- that reads as intentional to whoever finds it next.
REVOKE ALL ON FUNCTION lfh_orders_fill_tax_split()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_order_items_fill_tax_mode()  FROM PUBLIC, anon, authenticated;

-- ── WHAT IS DELIBERATELY *NOT* REVOKED HERE ──────────────────────────────────────────────
-- lfh_resolve_tax_mode KEEPS its anon grant (mig 273). It is called by lfh_price_order, which
-- is SECURITY INVOKER and granted to anon — so the caller's own privileges are what run it.
-- That is the identical case the grants guard already records for lfh_nice_usd: "formatter
-- called BY lfh_price_order, which is INVOKER — revoking it breaks guest pricing." The
-- resolver reads only `settings`, which anon can already read, so the grant exposes nothing
-- new. It is listed in the guard's ANON_ALLOWED with that reason rather than left to look
-- like an oversight.

NOTIFY pgrst, 'reload schema';
