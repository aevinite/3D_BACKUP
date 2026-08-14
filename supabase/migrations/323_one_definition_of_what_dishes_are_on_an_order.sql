-- 323_one_definition_of_what_dishes_are_on_an_order.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHERE: Manager + Tablet panel → Tables floor (a tile's "2 cooking · 0/4 served") and
-- Kitchen panel → the three columns. Nothing on either screen changes — proved below.
--
-- THE FAULT, AND WHAT IT IS *NOT*. An order's dishes live in two places: `order_items` rows, and the
-- `orders.items` JSON ticket. Every reader therefore has to answer "which one do I count, and how?"
-- — and each one answered it in its OWN words. That duplication, not the two sources, is what caused
-- three separate tile-versus-detail bugs: mig 105 fixed the tile to count PLATES not rows, mig 122
-- branched off a pre-105 copy and silently reverted it, mig 136 had to restore it.
--
-- I had planned to delete the JSON fallback after backfilling `order_items` for old orders. MEASURED
-- FIRST, and it was the wrong plan: 29,896 of 31,123 orders (96%) have NO dish rows at all — the
-- history/demo seeder writes the JSON ticket only. The fallback is not a remnant, it is the normal
-- shape for imported history, and removing it would have blanked the counts on 96% of orders. A
-- 30,000-order backfill would also have written rows a later re-price could turn into a different
-- settled total, which the billing guardrail forbids.
--
-- SO THE FIX IS THE OTHER HALF OF THE IDEA: keep both sources, and write the DECISION down ONCE.
-- `order_dish_lines` is that one definition — one row per dish on an order, with the rules the floor
-- summary had evolved to (they were the strictest):
--   · prefer `order_items` rows; fall back to the JSON ticket only when an order has NO rows;
--   · a status is lower-cased and defaults to 'received';
--   · a qty is only trusted if it LOOKS like an integer (mig 238's guard), floors at 0, defaults 1;
--   · a non-array `items` reads as empty rather than aborting the call (mig 229's guard).
-- It also carries `raw` — the original JSON line, when that was the source — so a reader that used to
-- hand the whole line onwards can still do exactly that.
--
-- WHY A VIEW AND NOT A FUNCTION: the floor summary is ONE set-based pass on purpose (mig 238, "do not
-- simplify this back"). A per-order function call would make it per-row again — the precise mistake
-- 238 removed. A view joins.
--
-- PROVED: the floor summary's whole payload and the kitchen's whole payload were captured for every
-- restaurant before this migration and compared after. Byte-identical, both.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.order_dish_lines WITH (security_invoker = true) AS
  -- The dish ROWS, when an order has them.
  SELECT oi.order_id,
         'rows'::text                                   AS src,
         LOWER(COALESCE(oi.status, 'received'))          AS status,
         GREATEST(COALESCE(oi.qty, 1), 0)                AS qty,
         oi.title,
         oi.note,
         to_jsonb(COALESCE(oi.removed, '{}'::text[]))    AS removed,
         NULL::jsonb                                     AS raw,
         oi.created_at,
         oi.id                                           AS item_id,
         NULL::int                                       AS line_no,
         oi.ctid                                         AS phys
    FROM public.order_items oi
  UNION ALL
  -- …else the JSON ticket, line by line. `NOT EXISTS` is what makes this a fallback and not a double
  -- count, and it is the same test both readers used.
  SELECT o.id,
         'json'::text,
         LOWER(COALESCE(el->>'status', 'received')),
         GREATEST(COALESCE(CASE WHEN el->>'qty' ~ '^-?[0-9]+$' THEN (el->>'qty')::int END, 1), 0),
         el->>'title',
         el->>'note',
         CASE WHEN jsonb_typeof(el->'removed') = 'array' THEN el->'removed' ELSE NULL END,
         el,                                              -- the untouched line, for readers that pass it on
         o.created_at,
         NULL::uuid,
         -- THE LINE'S PLACE IN ITS SOURCE, so a reader can print the dishes in the order they were
         -- actually taken. For a JSON ticket that is the array position; for dish rows it is the
         -- row's physical position, which is what `ORDER BY created_at` alone used to fall back on
         -- when several dishes were inserted in the same statement (they share created_at to the
         -- microsecond). Getting this wrong REVERSED two kitchen tickets in review — the cook reads
         -- a KOT top-down, so this is not cosmetic.
         el_no::int,   -- line_no
         NULL::tid     -- phys
    FROM public.orders o
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END)
      WITH ORDINALITY AS t(el, el_no)
   WHERE NOT EXISTS (SELECT 1 FROM public.order_items oi2 WHERE oi2.order_id = o.id);

COMMENT ON VIEW public.order_dish_lines IS
  'THE ONE definition of what dishes are on an order and in what state (mig 323): the order_items rows when it has them, else the orders.items JSON ticket, with status lower-cased, qty integer-guarded and a non-array ticket read as empty. 96% of orders (all imported history) have only the JSON, so the fallback is permanent, not legacy. Every counter reads THIS — three tile-versus-detail bugs (migs 105/122/136) came from each reader spelling the rule out for itself. `raw` holds the original JSON line when that was the source.';

-- The floor summary and the kitchen board are the only readers, and both run as the service role.
GRANT SELECT ON public.order_dish_lines TO service_role;

NOTIFY pgrst, 'reload schema';
