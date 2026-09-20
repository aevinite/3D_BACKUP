-- 406 — THE PER-DISH LIVE CARD NOW WORKS FOR THE GUEST IT WAS BUILT FOR.
--
-- Migration 404 (yesterday) gave the guest's Live-status tab one row per DISH with its own
-- served / preparing state — the L5 design the owner picked: *"I WANT IT SHOULD SHOW ALERGY AND
-- NOT AND SERVE PREPR STSUS FOR PERTICULAR DOISH"*. It reads `order_items`.
--
-- IT RETURNED NOTHING FOR THE MAIN GUEST DOOR, AND THAT WAS NOT VISIBLE FROM THE CODE THAT
-- SHIPPED IT. Three functions place an order, and only two of them write `order_items`:
--
--     lfh_place_order        (a table SESSION order)   → orders + order_items    (mig 357)
--     lfh_staff_place_order  (waiter / tablet)         → orders + order_items    (mig 385)
--     lfh_place_order_public (the QR diner: /q/<code>) → orders ONLY             (mig 385)
--
-- So every order placed the way the film shows — scan the QR, tap Place Order — has zero
-- `order_items` rows, `get_order_dishes` answered `[]`, and CartPanel fell back to the old joined
-- line ("Espresso ×1, Avocado & Cream Cheese ×1") under ONE status for the whole order. Exactly
-- the thing 404 was written to stop. Measured 2026-09-21 on the dev stack: two orders placed
-- through the real guest UI, `order_items` 0 rows each, `get_order_dishes` → [].
--
-- The per-dish state was never missing — it is in `orders.items`, which the handlers keep current
-- (`/orders/:id/item` and `serve-all` both stamp a status onto every element). Only the READ was
-- looking in the one place the QR path does not fill.
--
-- THE FIX IS THE FALLBACK THIS CODEBASE ALREADY USES for precisely this split: migration 385's
-- table-view CTE reads "order_items when the order has any, else the orders.items JSON". Same
-- shape here, same guards — `jsonb_typeof(...) = 'array'` because a scalar `items` used to abort
-- the whole call (mig 229), and the integer regex because a qty that is not a number must not
-- raise. Preferred, not merged: when order_items rows exist they are the answer, so nothing
-- changes for a session or staff order.
--
-- NOT FIXED HERE, AND IT IS A REAL QUESTION FOR THE OWNER: whether lfh_place_order_public should
-- write `order_items` like its two siblings. That would make one table the single source for
-- every order, but `lib/printQueue.ts`, `lib/liveBoard.ts` and `lib/tableOfAction.ts` all read
-- `order_items` and today see nothing from a QR order — giving them rows changes KOTs, the live
-- board and the floor at once. That is a deliberate decision, not a side-effect of a read fix.
--
-- Verify:  node scripts/verify-db-grants.mjs

CREATE OR REPLACE FUNCTION public.get_order_dishes(order_id uuid)
RETURNS TABLE(
  title   text,
  qty     int,
  status  text,
  note    text,
  options jsonb,
  removed text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- One CTE so ONE ORDER BY governs the whole answer: a branch of a UNION cannot carry its own,
  -- and sorting the union by title would shuffle the dishes out of the order they were added in.
  WITH lines AS (
    -- The kitchen's own rows, when the order has them (a session order, or one a waiter placed).
    SELECT
      oi.title,
      GREATEST(COALESCE(oi.qty, 1), 1)              AS qty,
      -- A line nobody has touched reads 'received', which the screen words as "Awaiting accept" —
      -- the same vocabulary lib/orderStatus.ts uses, so the tab and the floating strip cannot
      -- disagree about what a word means.
      LOWER(COALESCE(oi.status, 'received'))        AS status,
      oi.note,
      oi.options,
      COALESCE(oi.removed, '{}')                    AS removed,
      -- Oldest line first = the order the guest added them in, and the order the ticket prints.
      row_number() OVER (ORDER BY oi.created_at, oi.id) AS ord
    FROM order_items oi
    WHERE oi.order_id = get_order_dishes.order_id

    UNION ALL

    -- …and the order's own JSON when it has no rows — the QR diner's order, which is most of
    -- them. WITH ORDINALITY keeps the dishes in the sequence they were added in.
    SELECT
      COALESCE(el->>'title', '')                    AS title,
      GREATEST(COALESCE(CASE WHEN el->>'qty' ~ '^-?[0-9]+$' THEN (el->>'qty')::int END, 1), 1) AS qty,
      LOWER(COALESCE(el->>'status', 'received'))    AS status,
      el->>'note'                                   AS note,
      CASE WHEN jsonb_typeof(el->'options') = 'array' THEN el->'options' ELSE NULL END AS options,
      CASE WHEN jsonb_typeof(el->'removed') = 'array'
           THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(el->'removed') x), '{}')
           ELSE '{}' END                            AS removed,
      t.ord
    FROM orders o
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS t(el, ord)
    WHERE o.id = get_order_dishes.order_id
      AND NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = get_order_dishes.order_id)
  )
  SELECT title, qty, status, note, options, removed FROM lines ORDER BY ord
$$;

REVOKE ALL ON FUNCTION public.get_order_dishes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_dishes(uuid) TO anon, authenticated, service_role;
