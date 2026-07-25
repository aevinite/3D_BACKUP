-- 196_owner_analytics_cache.sql
-- Compute-on-view snapshot cache for the owner cockpit's EXPENSIVE reads.
--
-- Why: opening the owner dashboard / a report used to re-run multi-scan report RPCs
-- (lfh_owner_sales_report, dish/category/hourly breakdowns) on EVERY open AND every 60s
-- auto-refresh — and for a portfolio owner, once PER restaurant (mapLimit fan-out). That
-- is the dashboard slowness. This table stores the FINISHED JSON per (scope, report,
-- range) so a normal open reads ONE tiny row instead. Recompute happens only on a manual
-- Refresh (?refresh=1) or a keep-warm pass — the latter guarded by a cheap fingerprint so
-- an unchanged window is never recomputed. This LOWERS egress + DB load (owner's #1 fear):
-- reads shrink from whole-table scans to a single-row lookup; heavy compute runs rarely
-- instead of constantly.
--
-- Service-role only: every write goes through the owner API route handlers (which already
-- authorize + scope via lib/ownerScope). No anon/authenticated access.

CREATE TABLE IF NOT EXISTS public.owner_analytics_cache (
  cache_key      text PRIMARY KEY,          -- e.g. reports:v1:<scopeKey>:<type>:<range>
  payload        jsonb        NOT NULL,      -- the finished API JSON, served verbatim
  fingerprint    text,                       -- cheap change-detector at compute time
  computed_at    timestamptz  NOT NULL DEFAULT now(),
  last_viewed_at timestamptz  NOT NULL DEFAULT now()
);
-- keep-warm targets the recently-viewed keys only (idle restaurants cost nothing)
CREATE INDEX IF NOT EXISTS idx_owner_analytics_cache_viewed
  ON public.owner_analytics_cache (last_viewed_at);

REVOKE ALL ON public.owner_analytics_cache FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.owner_analytics_cache TO service_role;

-- Cheap change-detector for a set of restaurants over a created_at window: order count +
-- the latest of every mutation timestamp (create / edit / pay / cancel / delete). If this
-- string is unchanged since the cached compute, nothing relevant changed → skip recompute.
-- STABLE + sargable (created_at range); p_ids NULL = whole platform (admin all-view).
CREATE OR REPLACE FUNCTION public.lfh_owner_orders_fingerprint(
  p_ids uuid[], p_from timestamptz, p_to timestamptz
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT count(*)::text || ':' || coalesce(extract(epoch FROM max(
           greatest(o.created_at, o.edited_at, o.paid_at, o.cancelled_at, o.deleted_at)
         ))::bigint::text, '0')
  FROM public.orders o
  WHERE (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
    AND o.created_at >= p_from AND o.created_at < p_to;
$$;
REVOKE ALL ON FUNCTION public.lfh_owner_orders_fingerprint(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_orders_fingerprint(uuid[], timestamptz, timestamptz) TO service_role;
