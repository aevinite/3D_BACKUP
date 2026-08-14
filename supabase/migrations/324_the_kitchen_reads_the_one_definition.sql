-- 324_the_kitchen_reads_the_one_definition_and_the_floor_is_checked_against_it.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- The second half of mig 323 — and it is NOT what I first wrote. Worth reading before changing it.
--
-- THE PLAN was to point BOTH counters at the shared view: the kitchen board and the floor summary.
-- MEASURED, and the floor could not have it. Reading the view from
-- `lfh_table_view_summary` — first as a plain join, then as a LATERAL with the order id as a constant
-- — took the summary from 162 ms to 5,286 ms on French House and 108 ms to 1,523 ms on Aangan,
-- because the planner materialises the view's JSON branch, which expands the ticket of every one of
-- ~30,000 historical orders. The floor summary is the hottest read in the product and migration 238
-- says in as many words: do not simplify this back.
--
-- SO: the KITCHEN reads the one definition (it reads a handful of live tickets, and its output is
-- byte-identical — including `raw`, the untouched JSON line, for the three live tickets that have no
-- dish rows). The FLOOR keeps its own inline pass, unchanged — and `npm run verify:dish-counts`
-- asserts the two spellings AGREE, order by order, for every live order in the database.
--
-- That is the honest version of "one way to count dishes": share the definition where it is
-- affordable, and where it is not, make drift impossible to ship instead. Drift is what actually hurt
-- — migs 105, 122 and 136 were three rounds of the same disagreement, and a check catches that; a
-- shared view that makes the floor 30× slower does not.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.lfh_kitchen_tickets(p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object(
    'order_id',     o.id,
    'kot_no',       o.kot_no,
    'table_number', o.table_number,
    'status',       o.status,
    'created_at',   o.created_at,
    -- TAG: the table's mark so the kitchen ticket can show 👑/🏠/🤝 next to T<n>.
    'tag', COALESCE((SELECT t.tag FROM table_tags t
                      WHERE t.restaurant_id = o.restaurant_id
                        AND t.table_number = o.table_number), ''),
    -- The SAME one definition the floor tiles count (order_dish_lines, mig 323), so the board and the
    -- tile can never disagree about what is on an order again. `dl.raw` is the untouched JSON line
    -- when the ticket was the source, so an order with no dish rows still hands on exactly what it
    -- handed on before — the output of this function is unchanged, byte for byte.
    'items', COALESCE(
      (SELECT json_agg(COALESCE(dl.raw::json,
                json_build_object('title', dl.title, 'qty', dl.qty, 'status', dl.status,
                                  'note', dl.note, 'removed', dl.removed))
                -- The dishes in the order they were TAKEN: the JSON array's position, or the dish
                -- row's physical position — which is exactly what `ORDER BY oi.created_at` alone
                -- resolved to before, since dishes inserted together share created_at. Ordering by
                -- the row id instead REVERSED two real tickets (caught by the before/after compare).
                ORDER BY dl.created_at, dl.line_no, dl.phys)
         FROM order_dish_lines dl WHERE dl.order_id = o.id),
      '[]'::json)
  ) ORDER BY o.created_at), '[]'::json)
  FROM orders o
  WHERE NOT o.archived AND o.status IN ('received','preparing','served')
    AND o.restaurant_id = COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
$function$;

NOTIFY pgrst, 'reload schema';
