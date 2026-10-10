-- 420 · the owner sees delivery-app sales, for the channels that are on (owner, 2026-10-11)
--
-- WHY. The owner said: "we can do that in owner about the platform only when the feature is on only
-- then". Zomato, Swiggy and own-website orders live in aggregator_orders (mig 071), a table no owner
-- screen and no lfh_owner_* function ever read — so the manager's Dashboard showed the channel split
-- and the owner's Dashboard showed nothing. This is the one read the owner Dashboard needs.
--
-- WHAT IT ANSWERS. One row per delivery channel that is SWITCHED ON for the restaurant
-- (settings.platform_channels.<channel>.on = true), with that channel's order value and order count
-- in the window. A channel that is OFF never comes back at all — not a ₹0 row — so "only when the
-- feature is on" is decided here, in the database, and the screen cannot show a channel the
-- restaurant has not got. A channel that is ON with no orders comes back as ₹0 / 0, because "on, but
-- nothing yet" is a real answer.
--
--   · channel 'website' is stored as source 'takeaway' (the manager route's CH2SRC, lib/tableTags.ts).
--   · Counter PARCELS (source 'parcel') are NOT a delivery channel and are not returned — they are a
--     permanent feature with no switch (mig 263); how they reach the owner's reports is a separate
--     decision (tax treatment differs, see docs/COMPLIANCE-GUARDRAILS.md).
--   · cancelled / rejected orders are not sales (the manager Dashboard's own rule).
--   · DEMO orders (payload.demo = true — the "add a demo platform order" tool) are not sales: that
--     tool exists so the owner can show the board, and its own guard says fake orders must never
--     reach live revenue.
--
-- COST. Scoped by restaurant (p_restaurant_id or p_ids) and by time, through the new
-- (restaurant_id, created_at) index; the settings side is one row per restaurant.
--
-- WHO MAY CALL IT. Only the server (service_role) — the owner routes call it after ownerScope().

CREATE INDEX IF NOT EXISTS idx_aggregator_orders_restaurant_created
  ON public.aggregator_orders (restaurant_id, created_at);

CREATE OR REPLACE FUNCTION public.lfh_owner_channel_sales(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz, p_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(restaurant_id uuid, channel text, revenue numeric, orders bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH on_channels AS (
    SELECT s.restaurant_id, c.channel, c.source, c.ord
      FROM settings s
     CROSS JOIN (VALUES ('zomato', 'zomato', 1), ('swiggy', 'swiggy', 2), ('website', 'takeaway', 3)) AS c(channel, source, ord)
     WHERE (p_restaurant_id IS NOT NULL OR p_ids IS NOT NULL)            -- never the whole platform by accident
       AND (p_restaurant_id IS NULL OR s.restaurant_id = p_restaurant_id)
       AND (p_ids IS NULL OR s.restaurant_id = ANY (p_ids))
       AND (s.platform_channels -> c.channel ->> 'on') = 'true'
  )
  SELECT oc.restaurant_id, oc.channel,
         COALESCE(SUM(a.total), 0)::numeric(14, 2) AS revenue,
         COUNT(a.id) AS orders
    FROM on_channels oc
    LEFT JOIN aggregator_orders a
      ON a.restaurant_id = oc.restaurant_id
     AND a.source = oc.source
     AND a.created_at >= p_from AND a.created_at < p_to
     AND a.status NOT IN ('cancelled', 'rejected')
     AND COALESCE(a.payload ->> 'demo', '') <> 'true'
   GROUP BY oc.restaurant_id, oc.channel, oc.ord
   ORDER BY oc.restaurant_id, oc.ord;
$function$;

COMMENT ON FUNCTION public.lfh_owner_channel_sales(uuid, timestamptz, timestamptz, uuid[]) IS
  'Owner Dashboard: order value + count per delivery channel that is switched ON (an OFF channel is never returned). Excludes cancelled/rejected and demo orders; parcels are not a channel. Mig 420.';

REVOKE ALL ON FUNCTION public.lfh_owner_channel_sales(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_channel_sales(uuid, timestamptz, timestamptz, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
