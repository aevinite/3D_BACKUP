-- 250 — an order taken at a merged table joins the party it was merged into (owner, 2026-08-01)
--
-- Companion to mig 249. He chose, when asked: "let them order, it joins the same bill" — a waiter at
-- table 7 while 7 is merged into 6 adds the dish there, and it lands on the ONE bill. Without this
-- the order would open a SECOND party on table 7 and quietly split the bill the merge had joined.
--
-- The body below is the LIVE definition of lfh_staff_place_order read straight out of the database
-- and patched in ONE place (how it picks the session), so this migration cannot revert a fix that
-- was made in a later migration than the one that first created the function.

CREATE OR REPLACE FUNCTION public.lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text, p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid, p_confirm_duplicate boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid   uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_s     sessions; v_order uuid; v_kot int; v_item jsonb; v_priced jsonb;
  v_sig   text; v_alg text;
BEGIN
  -- (1) Serialize concurrent placements on the SAME table for this restaurant. A
  -- transaction-scoped advisory lock: a near-simultaneous second request waits here until
  -- the first commits, so it can reuse the now-open session (no unique violation → no 500)
  -- and see the first order in the dedup check below.
  PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || COALESCE(p_table, ''), 0));

  -- Same money math as guest orders, scoped to THIS restaurant's menu (mig 118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- (2) Atomic double-tap guard (unless the waiter already confirmed "send anyway").
  -- Signature = sorted per-item (id:qty:options) of the PRICED items (lfh_price_order emits
  -- 'id' + 'options'), plus the sorted order-level allergies. Compared against a
  -- non-cancelled, non-deleted order on this table from the last 3 seconds.
  v_sig := (SELECT string_agg(
              (e->>'id') || ':' || (e->>'qty') || ':' ||
              CASE WHEN jsonb_typeof(e->'options') = 'array'
                   THEN COALESCE((SELECT string_agg((op->>'group') || '/' || (op->>'label'), ','
                                  ORDER BY (op->>'group') || '/' || (op->>'label'))
                                  FROM jsonb_array_elements(e->'options') op), '')
                   ELSE '' END,
              '|' ORDER BY (e->>'id') || ':' || (e->>'qty'))
            FROM jsonb_array_elements(v_priced->'items') e);
  v_alg := (SELECT string_agg(a, ',' ORDER BY a) FROM unnest(COALESCE(p_allergies, '{}'::text[])) a);
  IF NOT COALESCE(p_confirm_duplicate, false) THEN
    IF EXISTS (
      SELECT 1 FROM orders o
      WHERE o.table_number = p_table AND o.restaurant_id = v_rid
        AND o.status <> 'cancelled' AND o.deleted_at IS NULL
        AND o.created_at >= now() - interval '3 seconds'
        AND jsonb_typeof(o.items) = 'array'   -- only array-shaped orders can match (old/scalar rows skipped)
        AND (SELECT string_agg(
               (e->>'id') || ':' || (e->>'qty') || ':' ||
               CASE WHEN jsonb_typeof(e->'options') = 'array'
                    THEN COALESCE((SELECT string_agg((op->>'group') || '/' || (op->>'label'), ','
                                   ORDER BY (op->>'group') || '/' || (op->>'label'))
                                   FROM jsonb_array_elements(e->'options') op), '')
                    ELSE '' END,
               '|' ORDER BY (e->>'id') || ':' || (e->>'qty'))
             FROM jsonb_array_elements(o.items) e) IS NOT DISTINCT FROM v_sig
        AND (SELECT string_agg(a, ',' ORDER BY a) FROM unnest(COALESCE(o.allergies, '{}'::text[])) a)
            IS NOT DISTINCT FROM v_alg
    ) THEN
      RETURN json_build_object('ok', false, 'duplicateWarning', true,
        'error', 'This looks identical to an order just sent for this table.');
    END IF;
  END IF;

  -- The table's open session FOR THIS RESTAURANT, or OPEN ONE NOW so the order is
  -- never an orphan. (Another restaurant's open "table 1" must never be reused.)
  -- A MERGED TABLE ORDERS ONTO THE PARTY IT WAS JOINED TO (owner, 2026-08-01, mig 249: he chose
  -- "let them order, it joins the same bill"). A waiter standing at table 7 while 7 is merged into
  -- 6 must be able to add a dish without walking to 6, and that dish belongs on the ONE bill. The
  -- order still records table_number = p_table below, so the KOT prints for table 7 and an unmerge
  -- can hand it back exactly. Without this, ordering at 7 would open a SECOND party on 7 and
  -- silently split the bill the merge just joined.
  SELECT * INTO v_s FROM sessions
    WHERE table_number = lfh_merge_parent_table(v_rid, p_table)
      AND status = 'open' AND restaurant_id = v_rid
    ORDER BY last_activity_at DESC LIMIT 1;
  IF v_s.id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_table, 'open', 'waiter', NOW(), v_rid)
      RETURNING * INTO v_s;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (p_table, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, restaurant_id)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        COALESCE(v_item->>'note', p_note),
        v_rid);
  END LOOP;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot);
END; $function$;

NOTIFY pgrst, 'reload schema';
