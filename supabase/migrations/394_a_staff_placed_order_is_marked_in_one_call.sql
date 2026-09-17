-- 394 — a staff-placed order is marked "already accepted" in ONE database call, not three
-- (owner, 2026-09-17: "whenever I click on a manager panel table view and take order and then
--  click on send to kitchen it takes like two or three seconds I want it instantly … it should
--  not feel the gap … optimize it, there shouldn't be any kind of [gap], everything should update
--  very fast")
--
-- ═══ WHAT WAS MEASURED, BEFORE WRITING A LINE ═══
--
-- POST /api/editor/order, timed end to end on the dev stack against the Mumbai database
-- (2026-09-17, three runs): 673 ms, 717 ms, 1149 ms. Per-step marks inside the handler, on the
-- 673 ms run — each number is milliseconds since the request arrived:
--
--     gate/scope/tab-gate/body  50      ← one read, shared with every other panel call
--     takeOrdersLadder          98      ← +48
--     managerCan                145     ← +47
--     settings.table_count      188     ← +43
--     lfh_staff_place_order     459     ← +271   the real work: price, insert, KOT, triggers
--     SELECT orders.items       508     ← +49  ┐
--     UPDATE orders             564     ← +56  ├ THIS FILE: three calls doing one job
--     UPDATE order_items        620     ← +56  ┘
--     audit log insert          665     ← +45
--
-- One database round trip from that machine costs 45–60 ms (five trivial SELECTs, timed: 219 ms
-- serial). So the three trips that push a manager-placed order straight onto the pass cost ~160 ms
-- of the ~670 ms — a quarter of the wait, spent entirely on latency rather than on work.
--
-- ═══ WHY A NEW FUNCTION AND NOT A PARAMETER ON lfh_staff_place_order ═══
--
-- Folding this into the placement RPC would save one more round trip and make it atomic. It also
-- rewrites the function that prices and inserts EVERY staff order on three panels plus the admin
-- repair route. The window this closes (an order exists as 'received' for ~160 ms before it is
-- marked 'preparing') exists today exactly as it does after this change, so nothing about the
-- ordering gets worse — and the blast radius of a separate, single-purpose function is one route
-- each. Deliberate trade: ~50 ms left on the table in exchange for not touching the pricer.
--
-- ═══ ONE DIFFERENCE FROM THE TYPESCRIPT IT REPLACES, AND IT IS SAFER ═══
--
-- The route did `Array.isArray(cur?.items) ? cur.items.map(…) : []` — so an order whose `items`
-- was NOT a json array (a legacy or malformed row) had its items column BLANKED to `[]` by the
-- update. This keeps such a row exactly as it is and only sets the status columns. Every other
-- behaviour is identical, line for line:
--   · a dish already 'served' keeps that status; anything else (including a dish with no status
--     at all) becomes 'preparing' — `e->>'status' = 'served'` is false for a missing key, which is
--     what `i.status === "served" ? … : "preparing"` did;
--   · the dish order inside the array is preserved (WITH ORDINALITY, aggregated in that order);
--   · order_items only moves rows that are still 'received', never a served or ready one;
--   · placed_by_id / placed_by are set on the same write (mig 220's columns) — NULL still means
--     "the guest ordered it themselves".
--
-- Scoped like every other by-id write: `restaurant_id = lfh_rid(p_restaurant_id)`, so a null
-- restaurant is REFUSED and never quietly means French House (migrations 385 + 386), and one
-- restaurant can never mark another's order. No default on p_restaurant_id, for the same reason.
--
-- Callers: app/api/editor/[...path]/route.ts (the manager panel) and
--          app/api/tablet/[...path]/route.ts (the waiter tablet) — the twins carried a byte-identical
--          copy of the three calls, so they get the identical fix in the same change.
--
-- Additive: this file creates a function and grants it to service_role. It rewrites no data, so it
-- needs no `lfh_already_applied` fence.

CREATE OR REPLACE FUNCTION public.lfh_staff_mark_placed(
  p_order uuid,
  p_restaurant_id uuid,
  p_by_id uuid DEFAULT NULL,
  p_by text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
BEGIN
  -- The order itself: every dish that is not already served is cooking, the order is on the pass,
  -- and WHO punched it rides along on the same write (no extra round trip, mig 220).
  UPDATE orders o
     SET items = CASE
                   WHEN jsonb_typeof(o.items) = 'array' THEN (
                     SELECT COALESCE(jsonb_agg(
                              CASE WHEN e->>'status' = 'served' THEN e
                                   ELSE jsonb_set(e, '{status}', '"preparing"'::jsonb) END
                              ORDER BY ord), '[]'::jsonb)
                       FROM jsonb_array_elements(o.items) WITH ORDINALITY AS t(e, ord)
                   )
                   ELSE o.items   -- not an array: leave it exactly as it is (see the header)
                 END,
         status = 'preparing',
         placed_by_id = p_by_id,
         placed_by = p_by
   WHERE o.id = p_order
     AND o.restaurant_id = v_rid;

  -- …and its own dish rows, for a restaurant on sessions (order_items). Only the ones still
  -- waiting to be accepted move; a 'ready' or 'served' dish is left where it is.
  UPDATE order_items
     SET status = 'preparing'
   WHERE order_id = p_order
     AND restaurant_id = v_rid
     AND status = 'received';
END
$function$;

-- Staff-only, like every other lfh_staff_* function: a NEW function is EXECUTE-able by anon by
-- default in Postgres, which is migration 038's lesson and what `npm run verify:grants` guards.
REVOKE ALL ON FUNCTION public.lfh_staff_mark_placed(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_staff_mark_placed(uuid, uuid, uuid, text) TO service_role;
