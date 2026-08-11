-- 309 — TWO MONEY FACTS THE PAY-LATER BOOK AND THE PURGE HAD WRONG (T7 sweep, 2026-08-11)
--
-- ⚠ MIGRATION NUMBER: next free after 308. Renumber to the next free slot if a parallel branch
--   took it — every statement here is CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS, correct at
--   ANY number, and it rewrites no existing data (so it needs no lfh_already_applied guard).
--
-- ── A · A DELETED BILL IS NOT MONEY THE GUEST OWES (finding F12) ──────────────────────────────
-- lfh_khata_outstanding() filtered `payment_status <> 'paid'`, `status <> 'cancelled'` and a
-- khata_customer_id — but never `deleted_at IS NULL`. Every other money surface in the product
-- drops a soft-deleted order (the printed bill's billMoney, its item rows in billData, settling in
-- parts in lib/paySplit.ts, the admin ledger in lib/billLedger.ts), each with a comment saying a
-- tombstoned line is by definition off the bill. This one function never got it.
-- So: an admin or manager deleted a pay-later bill the compliant way — with a reason, into the
-- ledger and the permanent audit — and the guest still showed on /owner/khata owing that money,
-- with the manager panel (which reads the SAME rpc) offering to collect it.
--
-- COLLECTED IS DELIBERATELY LEFT ALONE. Money that came in came in, and the Z-report counts a
-- deleted bill too (docs/COMPLIANCE-GUARDRAILS.md §3 — "Z-report includes voids/deletes"). Only
-- what is still OWED changes. The asymmetry is the point, so it is written down here.
--
-- ── B · THE DISCOUNT IS GROSSED AT THE RATE IT WAS CHARGED (finding F12, secondary) ───────────
-- Both functions derived the rate as `o.tax / o.subtotal`. On a bill carrying MRP / nil-rated
-- lines the subtotal is BIGGER than the taxable base (migs 270/272), so that fraction lands under
-- the real rate, the discount is under-grossed and the amount owed comes out slightly high. It is
-- also a fourth way of answering a question migration 301 already answered once and for all:
-- `orders.disc_gross` is the discount as it actually reduces the bill, computed at WRITE time from
-- the order's own tax_rate and maintained by trg_orders_disc_gross. Every analytics reader
-- subtracts it rather than re-deriving it; the khata book now does too.
--
-- ── C · A HEADLINE FIGURE THAT CANNOT BE TRUNCATED (finding F13) ──────────────────────────────
-- lfh_khata_outstanding RETURNS TABLE — one row per open bill — and the owner route summed those
-- rows in JS to get "TOTAL OUTSTANDING". PostgREST caps a set-returning rpc at db-max-rows exactly
-- as it caps a select, and this project's DB has such a cap (the Z-report pages around it and says
-- so: "silently computed the till on a truncated sample → understated cash"). Pay-later bills
-- accumulate until someone pays, so a khata-heavy restaurant crosses that cap over months and the
-- headline quietly goes small.
-- Fixed the way the efficiency playbook says to: the HEADLINE comes from an aggregate that returns
-- ONE row and can never be truncated, and the detail list is bounded by CUSTOMER (p_limit) so
-- every person shown still has all of their own bills — limiting by BILL would have cut a
-- customer's smaller bills and understated that person instead.
--
-- ── D · BILLS SURVIVE A PURGE (finding F6, owner's decision 2026-08-11) ───────────────────────
-- `docs/COMPLIANCE-GUARDRAILS.md` §3 says records are retained 6–8 years "even a tenant purged
-- from the 90-day recycle bin". admin_purge_restaurant() deleted orders, sessions, invoice_events,
-- daily_counters and seq_counters, and deletion_audit went with the restaurants row by ON DELETE
-- CASCADE — so after a purge nothing anywhere held that tenant's sales. Asked, the owner chose:
-- "Keep bills forever, purge only the rest."
-- So the purge now clears everything operational and leaves the MONEY: orders, sessions,
-- order_items, payments, session_payments, credit_notes, invoice_events, deletion_audit and the
-- counters that prove the numbering. The restaurants row itself must stay (orders and sessions
-- reference it) — it is marked `purged_at` and keeps its name, which is also what lets anyone read
-- those bills later. It is already out of every list, because a purge only runs on a restaurant
-- whose deleted_at is set.

-- ── A0 · An index that matches the new predicate ─────────────────────────────────────────────
-- The old partial index (mig 166) is still correct but no longer covers the whole WHERE, so give
-- the outstanding path its own. Same shape, plus the tombstone exclusion.
CREATE INDEX IF NOT EXISTS orders_khata_open_live_ix
  ON orders (restaurant_id, khata_customer_id)
  WHERE khata_at IS NOT NULL AND payment_status <> 'paid' AND deleted_at IS NULL;

-- ── A1 · Outstanding: live bills only, grossed by disc_gross, bounded by CUSTOMER ─────────────
DROP FUNCTION IF EXISTS lfh_khata_outstanding(uuid[]);
CREATE OR REPLACE FUNCTION lfh_khata_outstanding(
  p_restaurant_ids uuid[],
  p_limit          integer DEFAULT 500      -- how many PEOPLE to return bills for, biggest debt first
)
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
           -- mig 301: the discount as it really reduces this bill, at the rate THIS order was
           -- charged (never re-derived from tax/subtotal, which is wrong the moment a bill
           -- carries an untaxed line).
           round((COALESCE(o.total, 0) - COALESCE(o.disc_gross, 0))::numeric, 2) AS due
    FROM orders o
    WHERE o.khata_at IS NOT NULL
      AND o.payment_status <> 'paid'
      AND o.status <> 'cancelled'
      AND o.deleted_at IS NULL          -- ← F12: a tombstoned bill is not owed
      AND o.khata_customer_id IS NOT NULL
      AND o.restaurant_id = ANY (p_restaurant_ids)
  ),
  bills AS (
    SELECT oo.restaurant_id,
           oo.khata_customer_id,
           COALESCE(oo.session_id::text, oo.id::text)        AS bill_key,
           oo.session_id,
           max(oo.table_number)                              AS table_number,
           max(oo.khata_at)                                  AS khata_at,
           array_agg(oo.id)                                  AS order_ids,
           round(sum(oo.due), 2)                             AS bill_amount
    FROM open_orders oo
    GROUP BY oo.restaurant_id, oo.khata_customer_id,
             COALESCE(oo.session_id::text, oo.id::text), oo.session_id
  ),
  -- Bounded by PERSON, biggest debt first, so every customer that IS shown has all of their bills
  -- and their own figure is complete. The headline total comes from the summary function below,
  -- which sees everyone.
  ranked AS (
    SELECT b.khata_customer_id,
           row_number() OVER (ORDER BY sum(b.bill_amount) DESC, b.khata_customer_id) AS rn
    FROM bills b
    GROUP BY b.khata_customer_id
  )
  SELECT b.restaurant_id, b.khata_customer_id, kc.name, kc.phone, kc.note,
         b.bill_key, b.session_id, s.bill_no, b.table_number, b.khata_at,
         b.order_ids, b.bill_amount
  FROM bills b
  JOIN ranked r      ON r.khata_customer_id = b.khata_customer_id
  JOIN khata_customers kc ON kc.id = b.khata_customer_id
  LEFT JOIN sessions s    ON s.id = b.session_id
  WHERE r.rn <= GREATEST(1, COALESCE(p_limit, 500))
  ORDER BY b.khata_at DESC;
$$;
REVOKE ALL ON FUNCTION lfh_khata_outstanding(uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_khata_outstanding(uuid[], integer) TO service_role;

-- ── A2 · The headline, as ONE row that cannot be truncated ────────────────────────────────────
CREATE OR REPLACE FUNCTION lfh_khata_outstanding_summary(p_restaurant_ids uuid[])
RETURNS TABLE (
  total_outstanding numeric,
  people_count      bigint,
  bill_count        bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH open_orders AS (
    SELECT o.khata_customer_id, o.session_id, o.id,
           round((COALESCE(o.total, 0) - COALESCE(o.disc_gross, 0))::numeric, 2) AS due
    FROM orders o
    WHERE o.khata_at IS NOT NULL
      AND o.payment_status <> 'paid'
      AND o.status <> 'cancelled'
      AND o.deleted_at IS NULL
      AND o.khata_customer_id IS NOT NULL
      AND o.restaurant_id = ANY (p_restaurant_ids)
  )
  SELECT COALESCE(round(sum(due), 2), 0)                                        AS total_outstanding,
         COUNT(DISTINCT khata_customer_id)::bigint                              AS people_count,
         COUNT(DISTINCT COALESCE(session_id::text, id::text))::bigint            AS bill_count
  FROM open_orders;
$$;
REVOKE ALL ON FUNCTION lfh_khata_outstanding_summary(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_khata_outstanding_summary(uuid[]) TO service_role;

-- ── B1 · Collected: same one grossing rule. Deleted bills DELIBERATELY still count. ───────────
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
         -- mig 301's disc_gross, as everywhere else. No deleted_at filter: money that was
         -- collected was collected, and the Z-report counts a deleted bill too (COMPLIANCE §3).
         COALESCE(round(sum((COALESCE(o.total, 0) - COALESCE(o.disc_gross, 0))::numeric), 2), 0) AS collected,
         COUNT(*)::bigint                                                  AS order_count,
         COUNT(DISTINCT COALESCE(o.session_id::text, o.id::text))::bigint  AS bill_count
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

-- ── D · The purge keeps the money ────────────────────────────────────────────────────────────
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS purged_at timestamptz;
COMMENT ON COLUMN restaurants.purged_at IS
  'When this restaurant was purged from the recycle bin. The row itself is KEPT so its bills, '
  'invoice history and audit stay readable for the 6-8 year retention (owner, 2026-08-11); '
  'everything operational - menu, staff, settings, feedback - was deleted at that moment.';

CREATE OR REPLACE FUNCTION admin_purge_restaurant(p_rid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r restaurants%rowtype;
begin
  select * into r from restaurants where id = p_rid for update;
  if not found then raise exception 'Restaurant % not found', p_rid; end if;
  if p_rid = '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'The default restaurant can never be purged';
  end if;
  if r.deleted_at is null then
    raise exception 'Restaurant is not in the recycle bin — delete it first';
  end if;
  if now() < r.deleted_at + interval '90 days' then
    raise exception 'Retention lock: this restaurant cannot be purged until 90 days after deletion (deleted_at=%)', r.deleted_at;
  end if;
  if r.purged_at is not null then
    raise exception 'This restaurant has already been purged (purged_at=%) — its bills are kept on purpose', r.purged_at;
  end if;

  -- THE MONEY IS NOT TOUCHED (owner, 2026-08-11 — "keep bills forever, purge only the rest").
  -- Deliberately NOT deleted here, and the `lfh.allow_purge` escape hatch is NOT opened, so mig
  -- 190's immutability trigger still stands guard over every one of them:
  --   orders · order_items · sessions · payments · session_payments · credit_notes
  --   invoice_events · deletion_audit · daily_counters · seq_counters
  -- Everything below is operational: it describes how the restaurant RAN, not what it SOLD.
  delete from aggregator_orders where restaurant_id = p_rid;
  delete from feedback         where restaurant_id = p_rid;
  delete from reviews          where restaurant_id = p_rid;
  delete from waiter_calls     where restaurant_id = p_rid;
  delete from requests         where restaurant_id = p_rid;
  delete from session_members  where restaurant_id = p_rid;
  delete from menu_items       where restaurant_id = p_rid;
  delete from categories       where restaurant_id = p_rid;
  delete from filters          where restaurant_id = p_rid;
  delete from customers        where restaurant_id = p_rid;
  delete from blocklist        where restaurant_id = p_rid;
  delete from otp_codes        where restaurant_id = p_rid;
  delete from verification_codes where restaurant_id = p_rid;
  delete from staff_actions    where restaurant_id = p_rid;   -- the working log; the AUDIT stays
  delete from realtime_events  where restaurant_id = p_rid;
  delete from restaurant_owners   where restaurant_id = p_rid;
  delete from restaurant_payments where restaurant_id = p_rid;
  delete from restaurant_billing  where restaurant_id = p_rid;
  delete from issues              where restaurant_id = p_rid;
  update restaurants set owner_user_id = null where id = p_rid;
  delete from staff_users where restaurant_id = p_rid;
  delete from settings    where restaurant_id = p_rid;
  -- The row STAYS, marked. It is what the kept bills hang off, and it is already out of every
  -- list in the product (deleted_at is set, which is the precondition for getting here at all).
  update restaurants set purged_at = now() where id = p_rid;
end $$;
revoke all on function admin_purge_restaurant(uuid) from public, anon, authenticated;
grant execute on function admin_purge_restaurant(uuid) to service_role;

NOTIFY pgrst, 'reload schema';
