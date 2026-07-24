-- 184_khata_outstanding.sql
--
-- Pay Later (khata) rework — the read side. Two SECURITY-DEFINER RPCs so the SAME
-- net-due math lives in ONE place (SQL) and feeds BOTH the manager Bills → Pay Later
-- view AND the new owner-panel Pay Later section:
--
--   lfh_khata_outstanding(ids[])       — per-BILL rows of what is still owed, per person.
--   lfh_khata_collected(ids[], from,to)— how much pay-later money actually came in,
--                                         bucketed by paid_at (the collection day).
--
-- Net-due math is IDENTICAL to the app everywhere else (discount is pre-tax, so a
-- bill's owed amount drops by discount × (1 + tax/subtotal); see editor route.ts).
-- Both take an ARRAY of restaurant ids: the manager passes ARRAY[rid], the owner
-- passes their scoped-and-entitled subset. Reads ride the existing partial index
-- orders_khata_open_ix (mig 166) for the outstanding path; a sibling index below
-- covers the collected path.
--
-- 038 rule: staff-only, service-role executes AFTER the caller is vetted (managerCan /
-- ownerScope). Public/anon/authenticated may NEVER call these.

-- ── A. Index for the "collected" path (paid pay-later bills by collection day) ──
CREATE INDEX IF NOT EXISTS orders_khata_paid_ix
  ON orders (restaurant_id, paid_at)
  WHERE khata_at IS NOT NULL AND payment_status = 'paid';

-- ── B. Outstanding: one row per open bill, per person ─────────────────────────
-- A "bill" = the orders parked together (grouped by session_id; a solo parked order
-- is its own bill, keyed by its order id). order_ids lets the caller collect exactly
-- that bill via POST /khata/pay { session_id | order_id }.
CREATE OR REPLACE FUNCTION lfh_khata_outstanding(p_restaurant_ids uuid[])
RETURNS TABLE (
  restaurant_id     uuid,
  khata_customer_id uuid,
  name              text,
  phone             text,
  note              text,
  bill_key          text,        -- session_id::text, or the order id for a solo bill
  session_id        uuid,
  bill_no           integer,     -- daily human bill number (sessions.bill_no), may be NULL
  table_number      text,
  khata_at          timestamptz, -- when it was parked (all orders in a bill share the stamp)
  order_ids         uuid[],      -- every order on this bill (for the collect call)
  bill_amount       numeric      -- net owed on this bill
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH open_orders AS (
    SELECT o.id, o.restaurant_id, o.khata_customer_id, o.session_id,
           o.table_number::text AS table_number, o.khata_at,
           round(
             (COALESCE(o.total, 0)
              - COALESCE(o.discount, 0)
                * (1 + CASE WHEN COALESCE(o.subtotal, 0) > 0 THEN o.tax / o.subtotal ELSE 0 END)
             )::numeric, 2) AS due
    FROM orders o
    WHERE o.khata_at IS NOT NULL
      AND o.payment_status <> 'paid'
      AND o.status <> 'cancelled'
      AND o.khata_customer_id IS NOT NULL
      AND o.restaurant_id = ANY (p_restaurant_ids)
  )
  SELECT oo.restaurant_id,
         oo.khata_customer_id,
         kc.name, kc.phone, kc.note,
         COALESCE(oo.session_id::text, oo.id::text)        AS bill_key,
         oo.session_id,
         s.bill_no,
         max(oo.table_number)                              AS table_number,
         max(oo.khata_at)                                  AS khata_at,
         array_agg(oo.id)                                  AS order_ids,
         round(sum(oo.due), 2)                             AS bill_amount
  FROM open_orders oo
  JOIN khata_customers kc ON kc.id = oo.khata_customer_id
  LEFT JOIN sessions s ON s.id = oo.session_id
  GROUP BY oo.restaurant_id, oo.khata_customer_id, kc.name, kc.phone, kc.note,
           COALESCE(oo.session_id::text, oo.id::text), oo.session_id, s.bill_no
  ORDER BY max(oo.khata_at) DESC;
$$;

REVOKE ALL ON FUNCTION lfh_khata_outstanding(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_khata_outstanding(uuid[]) TO service_role;

-- ── C. Collected: pay-later money received in a window, by collection day ──────
-- Counts pay-later orders now paid, whose paid_at (collection moment) falls in the
-- window. Same net math. One row per restaurant; the caller sums for a grand total.
CREATE OR REPLACE FUNCTION lfh_khata_collected(
  p_restaurant_ids uuid[],
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  restaurant_id uuid,
  collected     numeric,
  order_count   bigint,
  bill_count    bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.restaurant_id,
         COALESCE(round(sum(
           (COALESCE(o.total, 0)
            - COALESCE(o.discount, 0)
              * (1 + CASE WHEN COALESCE(o.subtotal, 0) > 0 THEN o.tax / o.subtotal ELSE 0 END)
           )::numeric), 2), 0)                                     AS collected,
         COUNT(*)::bigint                                          AS order_count,
         COUNT(DISTINCT COALESCE(o.session_id::text, o.id::text))::bigint AS bill_count
  FROM orders o
  WHERE o.khata_at IS NOT NULL
    AND o.payment_status = 'paid'
    AND o.status <> 'cancelled'
    AND o.paid_at IS NOT NULL
    AND o.paid_at >= p_from AND o.paid_at < p_to
    AND o.restaurant_id = ANY (p_restaurant_ids)
  GROUP BY o.restaurant_id;
$$;

REVOKE ALL ON FUNCTION lfh_khata_collected(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_khata_collected(uuid[], timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
