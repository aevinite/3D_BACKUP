-- 329 — A PREP BATCH IS ONE ACTION, NOT SEVEN.
--
-- WHY (T17 API sweep, 2026-08-13, finding F6). "Make a batch" on the manager panel's Inventory tab
-- takes a prep item's recipe, consumes each ingredient, and adds the batch to stock. The route did
-- that as N+1 SEPARATE calls to lfh_inv_post_movement — one per ingredient, then one for the output.
-- Two things follow from that, and both cost real stock:
--
--   1. NO TRANSACTION. If anything fails after the first ingredient movement — a lock wait, a
--      statement timeout, the serverless invocation being cut short — the ingredients are gone from
--      stock and the batch was never added. The ledger is internally consistent (every movement is
--      real) and the shelf is wrong, which is the worst combination to debug.
--
--   2. A RETRY RE-CONSUMED EVERYTHING. Each dedupe key was built from the request's action id, and
--      public/panels/editor/inventory.js mints a FRESH id per tap — deliberately, and correctly, so
--      that two genuine expenses minutes apart are never merged into one. But it means the manager's
--      second tap after a failure looks like a brand-new batch: the ingredients come out AGAIN,
--      while the batch is added once. A cook re-tapping a failed batch quietly halved the walk-in.
--
-- THE FIX IS THE SHAPE, NOT A BIGGER KEY. One function, one transaction, one dedupe identity for the
-- WHOLE batch. Postgres gives us atomicity for free inside a function body, so either every movement
-- lands or none does. And the identity is derived from what the batch IS — restaurant + item +
-- quantity + the minute it was asked for — so a retry of the SAME batch is recognised as the same
-- batch and changes nothing, while a genuine second batch of the same thing an hour later is its own
-- action. p_attempt lets the caller pass the panel's action id to make that sharper still.
--
-- Reuses lfh_inv_post_movement for every leg rather than restating the weighted-average rule: two
-- copies of a costing rule is how an average starts disagreeing with its own ledger.

-- ═════════════════════════════════════════════════════════════════════════════
-- lfh_inv_produce — consume a prep recipe's ingredients and add the batch, atomically.
--   Returns { ok, reason?, cost?, consumed?, replay? } as jsonb, in the shape the route's other
--   RPC calls already use ({ ok:false, reason } = a refusal a person must read).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION lfh_inv_produce(
  p_restaurant uuid,
  p_item       uuid,
  p_qty_base   numeric,
  p_by         text DEFAULT NULL,
  p_attempt    text DEFAULT NULL   -- the panel's action id, when it has one
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch     numeric;
  v_name      text;
  v_scale     numeric;
  v_cost      numeric := 0;
  v_lines     integer := 0;
  v_key       text;
  v_posted    bigint;
  v_first     boolean := true;
  r           record;
BEGIN
  IF p_qty_base IS NULL OR p_qty_base <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_qty');
  END IF;

  -- The prep item itself, locked for the duration so two people can't brew the same batch at once.
  SELECT name, recipe_batch_base INTO v_name, v_batch
    FROM inv_items
   WHERE id = p_item AND restaurant_id = p_restaurant
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found');
  END IF;
  IF v_batch IS NULL OR v_batch <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_recipe');
  END IF;

  -- ONE identity for the whole batch. `date_trunc('minute')` is what makes a human retry land on the
  -- same key: a person who taps again after a failure does so within seconds, and a deliberate second
  -- batch of the same size in the same minute is not a thing a kitchen does. When the caller passes
  -- its own attempt id we use that instead, which is exact.
  v_key := 'produce:' || p_restaurant::text || ':' || p_item::text || ':' || p_qty_base::text || ':' ||
           COALESCE(p_attempt, to_char(date_trunc('minute', now() AT TIME ZONE 'UTC'), 'YYYYMMDDHH24MI'));

  -- Consume every ingredient, scaled to the size actually made.
  v_scale := p_qty_base / v_batch;
  FOR r IN
    SELECT l.item_id, l.qty_base, COALESCE(i.avg_cost, 0) AS avg_cost
      FROM inv_recipe_lines l
      JOIN inv_items i ON i.id = l.item_id AND i.restaurant_id = p_restaurant
     WHERE l.restaurant_id = p_restaurant
       AND l.owner_type = 'prep'
       AND l.owner_key  = p_item::text
     ORDER BY l.item_id
  LOOP
    v_lines := v_lines + 1;
    v_cost  := v_cost + (r.qty_base * v_scale * r.avg_cost);
    v_posted := lfh_inv_post_movement(
      p_restaurant, r.item_id, -(r.qty_base * v_scale), 'production',
      v_key || ':in:' || r.item_id::text,
      NULL, NULL, 'production', v_key, p_by);
    -- The FIRST leg tells us whether this whole batch has already been made: every leg shares one
    -- key prefix, so if leg one is a replay they all are. Nothing is written twice either way (the
    -- movement insert is ON CONFLICT DO NOTHING) — this is only so the caller can say "already done"
    -- instead of reporting a second batch.
    IF v_first THEN
      v_first := false;
      IF v_posted IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'replay', true, 'cost', 0, 'consumed', 0);
      END IF;
    END IF;
  END LOOP;

  IF v_lines = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_recipe');
  END IF;

  -- …and add what was made, valued at what it actually cost to make.
  v_posted := lfh_inv_post_movement(
    p_restaurant, p_item, p_qty_base, 'production', v_key || ':out',
    CASE WHEN p_qty_base > 0 THEN v_cost / p_qty_base ELSE 0 END,
    NULL, 'production', v_key, p_by);

  RETURN jsonb_build_object(
    'ok', true,
    'cost', round(v_cost::numeric, 2),
    'consumed', v_lines,
    'name', v_name,
    'replay', v_posted IS NULL);
END $$;

-- A NEW FUNCTION IS PUBLIC-EXECUTABLE BY DEFAULT (the mig 038/267 lesson, guarded by
-- npm run verify:grants). This one moves stock, so it is service_role only — the route calls it.
REVOKE EXECUTE ON FUNCTION lfh_inv_produce(uuid,uuid,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_inv_produce(uuid,uuid,numeric,text,text) TO service_role;
