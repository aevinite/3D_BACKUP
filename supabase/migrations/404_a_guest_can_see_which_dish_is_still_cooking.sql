-- 404 — A GUEST CAN SEE WHICH DISH IS STILL COOKING, NOT JUST "THE ORDER IS COOKING".
--
-- Owner, 2026-09-20, choosing the live-status design: *"I LIKE L5 … I WANT IT SHOULD SHOW ALERGY
-- AND NOT AND SERVE PREPR STSUS FOR PERTICULAR DOISH"* — allergy, note, and a served/preparing
-- state for each DISH.
--
-- WHY A NEW READ WAS NEEDED, and why the screen could not just be restyled.
--   The live card is built from what the phone saved when the order went in, and that is only:
--       items?: { title: string; qty: number }[]
--   No status, no note, no options. The only server read available to a guest without a table
--   SESSION is `get_order_status(order_id)`, which answers for the whole order. So a table whose
--   coffee had arrived and whose toast had not was told one flat word for both, and there was no
--   honest way to draw per-dish state — which is why the design was held back rather than shipped
--   with the order's status stamped on every line. A stamp saying "Served" over food that has not
--   arrived is worse than no stamp at all.
--
-- WHAT IT RETURNS, and why exactly this much.
--   One row per line of the order, in the order the kitchen sees them: what it is, how many, and
--   what has happened to it — plus the two things the guest themselves typed or chose, so the card
--   can show "no peanuts" and "less sugar" beside the dish they belong to.
--
-- THE EXPOSURE IS THE SAME CLASS AS THE FUNCTION IT SITS BESIDE, deliberately. `get_order_status`
-- already answers, to anyone holding the order's uuid, with that order's status, table number and
-- KOT number. This answers with that same order's lines. Knowing the uuid is how this app has
-- always established "this is my order" for a guest with no session — a v4 uuid is 122 bits, and
-- the phone that placed the order is the only thing that has it. No new class of data is reachable
-- that the bill on that same phone does not already show.
--
-- TIGHTER GRANTS THAN ITS NEIGHBOUR, on purpose: `get_order_status` still carries EXECUTE for
-- PUBLIC (an old default). This one is revoked from PUBLIC and granted only to the three roles
-- that have any business calling it. anon is REQUIRED — it is the key a diner's phone carries, and
-- narrowing it would silently break the very screen this exists for.
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
  SELECT
    oi.title,
    GREATEST(COALESCE(oi.qty, 1), 1)                AS qty,
    -- The kitchen's own words for a line. A line nobody has touched reads 'received', which the
    -- screen words as "Awaiting accept" — the same vocabulary lib/orderStatus.ts already uses, so
    -- the tab and the floating strip cannot disagree about what a word means.
    LOWER(COALESCE(oi.status, 'received'))          AS status,
    oi.note,
    oi.options,
    COALESCE(oi.removed, '{}')                      AS removed
  FROM order_items oi
  WHERE oi.order_id = get_order_dishes.order_id
  -- Oldest line first = the order the guest added them in, and the order the ticket prints.
  ORDER BY oi.created_at, oi.id
$$;

REVOKE ALL ON FUNCTION public.get_order_dishes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_dishes(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
