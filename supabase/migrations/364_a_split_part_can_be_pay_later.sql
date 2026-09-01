-- 364_a_split_part_can_be_pay_later.sql
--
-- ⚠ RENUMBERED 352 → 364 (2026-08-22). Two migrations were merged as 352 within twenty minutes of
-- each other — this one and `a_reseed_cannot_undo_an_admins_choice` — and `npm run verify:db-parity`
-- had been red for it ever since: "new duplicated migration number(s): 352 … renumber the newer file".
-- This is the newer of the two by git (18:09 against 17:48), so it is the one that moved.
--
-- WHY THE MOVE IS SAFE, checked rather than assumed. A re-seed runs this folder in FILENAME order, so
-- renumbering changes WHEN this file runs — nothing else. Everything it touches is additive and its
-- own: three columns on `session_payments`, two indexes, one view and two functions, all of which
-- existed by 352 or are created here. Nothing between 353 and 363 needs any of them (the single grep
-- hit, in 354, is a COMMENT about `orders.khata_customer_id` — a different column on a different
-- table). And nothing this file needs is created after 352, because it used to run at 352. Moving a
-- migration LATER can only ever be safer than moving one earlier.
--
-- Already applied on both databases, so this is a rename on disk only — no re-run, no data change.
--
-- SPLIT PAYMENT IS MARK-PAID, AND ONE OF THE PARTS MAY BE "PAY LATER" (owner, 2026-08-21).
--
--   "if you are split for four person, so all four thing can be paid differently. Like, first can
--    pay in cash, second can pay in card. Third is pay later, fourth will be other … and we can
--    able to change the amount also. So the split doesn't mean you have to split it equally …
--    Total should be same … make it perfectly dynamic like that."
--
-- Settling a bill in parts (mig 176, lib/paySplit.ts) already lets each part carry its OWN method,
-- and the amounts are the caller's to choose as long as they add up to the bill. What it could not
-- do is let one of those parts be pay-later — because the khata book cannot owe an AMOUNT.
--
-- WHY IT COULD NOT. A khata debt is DERIVED, never stored: `lfh_khata_outstanding` sums
-- `orders.net_amount` for orders carrying `khata_at`. So the book can owe whole ORDERS
-- ("this KOT is on Ravi's tab") and nothing smaller. "₹279 of this ₹1,018.50 bill is on Ravi's tab"
-- has nowhere to live, and there is no order that is worth ₹279.
--
-- WHAT THIS ADDS. Two columns on the payment parts, and one change to how a debt is worked out:
--
--   · session_payments.khata_customer_id — NULL on a part that is real money; set on a part that is
--     owed. That row IS the record of who owes what, so an amount no longer needs an order to hang on.
--   · session_payments.settled_at        — when that owed part was actually collected.
--   · a bill's outstanding debt becomes  Σ(order net)  −  Σ(the parts already collected on it).
--
-- NOTHING EXISTING MOVES, and that is checked rather than hoped for:
--   · Every session_payments row today has khata_customer_id NULL, so no row becomes a debt.
--   · A plain split marks every order PAID, so those bills never reach `open_orders` at all — the
--     new subtraction can only ever see a bill that has a pay-later part.
--   · A whole-bill pay-later (the existing "Pay Later" button) records no parts, so it subtracts
--     zero and its figure is unchanged to the paisa.
--
-- THE BILL IS STILL SETTLED AND THE TABLE STILL FREES, exactly like Mark paid and exactly like the
-- Pay Later button already does: the orders keep payment_status='pending' and gain the khata
-- markers, so they leave the floor and live in the book until collected. What is NOT done is
-- marking a bill "paid" while part of the money never arrived — a sale that reads settled when it
-- isn't is the shape docs/COMPLIANCE-GUARDRAILS.md §2 refuses, and it would also make the khata
-- book forget the debt entirely.
--
-- Additive only: two nullable columns, one partial index, two function bodies restated with the
-- subtraction added. Both bodies below were captured with pg_get_functiondef() from the live
-- database, NOT copied from migration 310 — recreating a function from older text is how a later
-- fix gets silently reverted (CLAUDE.md's own warning, and mig 266's).

-- ── 1. A payment part can be owed rather than collected ─────────────────────────────────────
ALTER TABLE session_payments
  ADD COLUMN IF NOT EXISTS khata_customer_id uuid REFERENCES khata_customers(id),
  ADD COLUMN IF NOT EXISTS settled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS settle_group      uuid;

COMMENT ON COLUMN session_payments.khata_customer_id IS
  'Set = this part was not collected; it is owed by that person (pay-later part of a split). NULL = real money that arrived.';
COMMENT ON COLUMN session_payments.settled_at IS
  'When an owed part was actually collected. NULL while it is still owed.';
-- WHY THE GROUP EXISTS. One tap on "Take payment" writes several parts, and the debt below is
-- "the bill minus what arrived WITH it". Without a marker tying one settle's parts together, a
-- session that had been split-settled ONCE already (parts recorded, those orders marked paid) and
-- then gained a new order parked on a tab would have the OLD settle's parts subtracted from the NEW
-- debt — money counted twice, against the person who owes it. The group makes "arrived with it"
-- provable instead of inferred from timestamps.
COMMENT ON COLUMN session_payments.settle_group IS
  'The one settle these parts were taken in. Parts of the same tap share it, so a bill''s debt can subtract only what arrived alongside the owed part.';

-- The book reads "which parts are still owed", per restaurant. Partial so it stays tiny: only the
-- open pay-later parts are in it, never the (vastly more numerous) ordinary payment rows.
CREATE INDEX IF NOT EXISTS idx_session_payments_khata_open
  ON session_payments (restaurant_id, khata_customer_id)
  WHERE khata_customer_id IS NOT NULL AND settled_at IS NULL AND reversed_at IS NULL;
-- The view below looks a settle group up twice (its collected parts, and whether it still owes).
CREATE INDEX IF NOT EXISTS idx_session_payments_group
  ON session_payments (settle_group) WHERE settle_group IS NOT NULL;

-- Money that arrived ALONGSIDE an owed part, per session — the figure the two functions below
-- subtract from a bill's debt. Deliberately narrow:
--   · reversed parts (mig 285) do not count — that money was given back,
--   · an owed part is not money in, so it is excluded from the sum itself,
--   · and only a settle group that STILL has an owed part counts at all. Once the tab is collected
--     the whole bill is paid, it leaves `open_orders`, and this stops being consulted.
-- A session settled by an ordinary split (no owed part) has no qualifying group, so it contributes
-- nothing here and its orders are marked paid anyway.
CREATE OR REPLACE VIEW lfh_session_collected AS
  SELECT sp.session_id,
         sp.restaurant_id,
         round(sum(sp.amount), 2) AS collected
    FROM session_payments sp
   WHERE sp.reversed_at IS NULL
     AND sp.khata_customer_id IS NULL          -- an owed part is not money in
     AND sp.settle_group IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM session_payments owed
            WHERE owed.settle_group = sp.settle_group
              AND owed.khata_customer_id IS NOT NULL
              AND owed.settled_at IS NULL
              AND owed.reversed_at IS NULL)
   GROUP BY sp.session_id, sp.restaurant_id;

REVOKE ALL ON lfh_session_collected FROM PUBLIC, anon, authenticated;
GRANT SELECT ON lfh_session_collected TO service_role;

-- ── 2. A bill's debt is what is left AFTER what was already collected on it ──────────────────
-- Baseline: the live definition (mig 310 + F12). The ONLY change is the LEFT JOIN to
-- lfh_session_collected and the GREATEST(..., 0) subtraction in `bills`.
CREATE OR REPLACE FUNCTION public.lfh_khata_outstanding(p_restaurant_ids uuid[], p_limit integer DEFAULT 500)
 RETURNS TABLE(restaurant_id uuid, khata_customer_id uuid, name text, phone text, note text, bill_key text, session_id uuid, bill_no integer, table_number text, khata_at timestamp with time zone, order_ids uuid[], bill_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH open_orders AS (
    SELECT o.id, o.restaurant_id, o.khata_customer_id, o.session_id,
           o.table_number::text AS table_number, o.khata_at,
           -- mig 301: the discount as it really reduces this bill, at the rate THIS order was
           -- charged (never re-derived from tax/subtotal, which is wrong the moment a bill
           -- carries an untaxed line).
           round((COALESCE(o.net_amount, 0))::numeric, 2) AS due
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
           -- mig 352: a SPLIT may already have collected part of this bill in cash/card/UPI, with
           -- only the remainder on the tab. Subtract what arrived. Zero for every bill parked by
           -- the whole-bill Pay Later button, which records no parts — so those figures do not move.
           -- GREATEST(...,0): a discount applied after the parts were taken must never make a debt
           -- negative and quietly reduce somebody else's total.
           GREATEST(round(sum(oo.due), 2) - COALESCE(max(sc.collected), 0), 0) AS bill_amount
    FROM open_orders oo
    LEFT JOIN lfh_session_collected sc
           ON sc.session_id = oo.session_id AND sc.restaurant_id = oo.restaurant_id
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
    AND b.bill_amount > 0            -- a bill whose parts covered all of it is not owed
  ORDER BY b.khata_at DESC;
$function$;

-- ── 3. …and so is the headline total ────────────────────────────────────────────────────────
-- Baseline: the live definition. Same one change, grouped per bill first so the subtraction is
-- applied once per bill and not once per order.
CREATE OR REPLACE FUNCTION public.lfh_khata_outstanding_summary(p_restaurant_ids uuid[])
 RETURNS TABLE(total_outstanding numeric, people_count bigint, bill_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH open_orders AS (
    SELECT o.khata_customer_id, o.session_id, o.id, o.restaurant_id,
           round((COALESCE(o.net_amount, 0))::numeric, 2) AS due
    FROM orders o
    WHERE o.khata_at IS NOT NULL
      AND o.payment_status <> 'paid'
      AND o.status <> 'cancelled'
      AND o.deleted_at IS NULL
      AND o.khata_customer_id IS NOT NULL
      AND o.restaurant_id = ANY (p_restaurant_ids)
  ),
  bills AS (
    SELECT oo.khata_customer_id,
           COALESCE(oo.session_id::text, oo.id::text) AS bill_key,
           GREATEST(round(sum(oo.due), 2) - COALESCE(max(sc.collected), 0), 0) AS bill_amount
    FROM open_orders oo
    LEFT JOIN lfh_session_collected sc
           ON sc.session_id = oo.session_id AND sc.restaurant_id = oo.restaurant_id
    GROUP BY oo.khata_customer_id, COALESCE(oo.session_id::text, oo.id::text)
  )
  SELECT COALESCE(round(sum(bill_amount), 2), 0)        AS total_outstanding,
         COUNT(DISTINCT khata_customer_id)::bigint      AS people_count,
         COUNT(DISTINCT bill_key)::bigint               AS bill_count
  FROM bills
  WHERE bill_amount > 0;
$function$;

-- New functions are PUBLIC-executable by default (the mig 038/267 lesson) — these two are
-- staff-only and keep exactly the grants they already had.
REVOKE ALL ON FUNCTION lfh_khata_outstanding(uuid[], integer)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_khata_outstanding_summary(uuid[])    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_khata_outstanding(uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_khata_outstanding_summary(uuid[])  TO service_role;

NOTIFY pgrst, 'reload schema';
