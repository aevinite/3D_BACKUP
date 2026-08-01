-- 246 — THE CHEAP CHANGE-DETECTOR WAS THE MOST EXPENSIVE QUERY IN THE APP.
--
-- The snapshot cache (mig 196, lib/ownerCache.ts) exists so a dashboard doesn't scan
-- hundreds of thousands of orders on every open. It decides whether to recompute by asking
-- lfh_owner_orders_fingerprint "did anything change in this window?" — and THAT question was
-- answered with a full scan:
--
--     count(*) + max(greatest(created_at, edited_at, paid_at, cancelled_at, deleted_at))
--     FROM orders WHERE created_at >= p_from AND created_at < p_to
--
-- MEASURED on the backup database, 2026-08-01, 399,617 orders, the all-time window:
--     Execution Time: 21,591 ms      Buffers: shared hit=361,642 read=8,809  (~2.9 GB read)
--
-- That is 2.7× PostgREST's own 8-second statement ceiling here, so the guard could not even
-- finish: the dashboard failed, and the failure cost 8 full seconds of a shared single-vCPU
-- instance's time — which a person then paid AGAIN by pressing refresh. Several of those in
-- flight is exactly the whole-instance saturation that took the database down on 2026-07-31
-- (every unrelated query piling up at the 8s wait, then the API layer refusing connections).
-- The greatest(...) over five columns cannot use an index, so no index could have saved it.
--
-- THE FIX: stop asking the big table. Maintain a tiny watermark as orders change, and let the
-- detector read that instead. One row per restaurant per business day; the answer becomes an
-- index range scan over a few hundred rows.
--
-- WHY THERE IS NO BACKFILL (deliberate, and it is correct):
--   The detector's only job is to return a DIFFERENT string once something changes. Absolute
--   values are meaningless — the cache stores whatever string it saw and compares later. A
--   window with no watermark rows answers '0:0'; a snapshot stored against '0:0' stays valid
--   until the first change in that window creates a row and moves the answer. Backfilling
--   would have cost one more 21-second scan to buy nothing. Snapshots stored before this
--   migration hold an old-format string, so each one recomputes ONCE on its next view and is
--   correct from then on.
--
-- WHY BUSINESS-DAY BUCKETS RATHER THAN ONE ROW PER RESTAURANT:
--   Reports ask about a window. A single row per restaurant would mean tonight's orders
--   invalidate last month's report and every wide report would recompute constantly. Day
--   buckets keep the window scoping the old function had. Edges over-include by up to a day
--   (the range test is inclusive), which can only ever cause one needless recompute — it can
--   never miss a change, and missing a change is the only unsafe direction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.orders_change_watermark (
  restaurant_id  uuid        NOT NULL,
  day            date        NOT NULL,   -- IST business day of the order's created_at
  changes        bigint      NOT NULL DEFAULT 0,
  last_change_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, day)
);

COMMENT ON TABLE public.orders_change_watermark IS
  'Tiny per-restaurant/per-day change counter so lfh_owner_orders_fingerprint never scans orders (mig 246).';

-- Nobody but the server may read it. It carries no order detail, but the house rule is that a
-- tenant-scoped table is never readable by anon/authenticated. service_role bypasses RLS, and
-- the trigger below is SECURITY DEFINER, so writes work no matter who placed the order.
ALTER TABLE public.orders_change_watermark ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders_change_watermark FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders_change_watermark TO service_role;

-- ── the maintainer ────────────────────────────────────────────────────────────────────────
-- One upsert per order write. It sits beside the six triggers orders already carries and costs
-- a fraction of a millisecond; the row it touches is per restaurant PER DAY, the same shape of
-- contention the kot_no counter (daily_counters) has always had on this exact write path.
CREATE OR REPLACE FUNCTION public.lfh_bump_orders_watermark()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rid uuid;
  v_day date;
BEGIN
  -- A DELETE must still invalidate the window the row USED to be in.
  IF TG_OP = 'DELETE' THEN
    v_rid := OLD.restaurant_id;
    v_day := (OLD.created_at AT TIME ZONE 'Asia/Kolkata')::date;
  ELSE
    v_rid := NEW.restaurant_id;
    v_day := (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;

  IF v_rid IS NOT NULL THEN
    INSERT INTO public.orders_change_watermark (restaurant_id, day, changes, last_change_at)
    VALUES (v_rid, v_day, 1, now())
    ON CONFLICT (restaurant_id, day)
    DO UPDATE SET changes = public.orders_change_watermark.changes + 1, last_change_at = now();
  END IF;

  -- If created_at itself moved (a correction), the OLD day must be invalidated too, or a
  -- report covering it would keep showing a figure that no longer includes this order.
  IF TG_OP = 'UPDATE' AND OLD.created_at IS DISTINCT FROM NEW.created_at AND OLD.restaurant_id IS NOT NULL THEN
    INSERT INTO public.orders_change_watermark (restaurant_id, day, changes, last_change_at)
    VALUES (OLD.restaurant_id, (OLD.created_at AT TIME ZONE 'Asia/Kolkata')::date, 1, now())
    ON CONFLICT (restaurant_id, day)
    DO UPDATE SET changes = public.orders_change_watermark.changes + 1, last_change_at = now();
  END IF;

  RETURN NULL; -- AFTER trigger: the return value is ignored
END;
$$;

REVOKE ALL ON FUNCTION public.lfh_bump_orders_watermark() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_watermark ON public.orders;
CREATE TRIGGER trg_orders_watermark
AFTER INSERT OR UPDATE OR DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.lfh_bump_orders_watermark();

-- ── the detector, now reading the watermark ───────────────────────────────────────────────
-- SAME signature on purpose: CREATE OR REPLACE then keeps the existing grants, and every
-- caller (lib/ownerCache.ts → ordersFingerprint) is unchanged.
CREATE OR REPLACE FUNCTION public.lfh_owner_orders_fingerprint(
  p_ids  uuid[],
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(sum(w.changes), 0)::text || ':' ||
         coalesce(extract(epoch FROM max(w.last_change_at))::bigint::text, '0')
  FROM public.orders_change_watermark w
  WHERE (p_ids IS NULL OR w.restaurant_id = ANY (p_ids))
    AND w.day >= ((p_from AT TIME ZONE 'Asia/Kolkata')::date)
    AND w.day <= ((p_to   AT TIME ZONE 'Asia/Kolkata')::date);
$$;

COMMENT ON FUNCTION public.lfh_owner_orders_fingerprint(uuid[], timestamptz, timestamptz) IS
  'Did anything change in this window? Reads orders_change_watermark (mig 246). Was a 21.6s full scan of orders.';

COMMIT;
