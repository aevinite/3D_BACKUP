-- 273_ticket_keeps_its_tax_mode.sql
--
-- lfh_sync_order_items_json rebuilds orders.items (the JSON ticket every panel reads) from the
-- order_items rows. It was written before migration 270, so it did not copy the two new
-- per-line columns across — which meant that the FIRST time a waiter edited or removed a dish,
-- the rebuild silently dropped `tax_mode` and `is_mrp` from the ticket.
--
-- The visible symptom: the MRP stamp disappears from the waiter's screen and the guest's live
-- bill after any edit, and the tablet's own taxable-base estimate falls back to "everything is
-- taxable". No money was ever wrong — order_items keeps its columns, orders.taxable_base keeps
-- its value, and the server clamp is what actually rules — but a bill that says a bottle is
-- MRP before an edit and not after is exactly the kind of contradiction this project treats as
-- a bug in its own right (a screen must not disagree with itself).
--
-- Baseline = migration 068. The ONLY change is two more keys in the jsonb_build_object.
-- is_mrp is written as NULL rather than false when it does not apply, so jsonb_strip_nulls
-- (already wrapping this object) keeps the ticket exactly as small as it is today for every
-- restaurant not using the feature.

CREATE OR REPLACE FUNCTION lfh_sync_order_items_json(p_order uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE orders o
     SET items = COALESCE((
       SELECT jsonb_agg(
                jsonb_strip_nulls(jsonb_build_object(
                  'id',       oi.id,
                  'title',    oi.title,
                  'price',    to_char(oi.unit_price, 'FM999999990.00'),
                  'qty',      oi.qty,
                  'options',  CASE WHEN oi.options IS NULL OR oi.options = '[]'::jsonb THEN NULL ELSE oi.options END,
                  'removed',  CASE WHEN oi.removed IS NULL OR array_length(oi.removed, 1) IS NULL THEN NULL ELSE to_jsonb(oi.removed) END,
                  'note',     oi.note,
                  'status',   oi.status,
                  -- (270) the frozen behaviour of this line, so a rebuilt ticket still prices
                  -- and labels itself the way it was sold.
                  'tax_mode', oi.tax_mode,
                  'is_mrp',   CASE WHEN oi.is_mrp THEN true ELSE NULL END
                ))
                ORDER BY oi.created_at, oi.id)
       FROM order_items oi WHERE oi.order_id = p_order
     ), '[]'::jsonb)
   WHERE o.id = p_order;
END; $$;

-- lfh_price_order is STABLE/INVOKER and granted to anon; it calls lfh_resolve_tax_mode, which
-- migration 270 revoked from anon. Every guest path reaches it through a SECURITY DEFINER
-- wrapper today, so nothing is broken — but a function that is callable by a role which cannot
-- call its own dependency is a trap laid for whoever wires the next entry point. The resolver
-- only reads `settings`, which anon can already read, so granting it exposes nothing new.
GRANT EXECUTE ON FUNCTION lfh_resolve_tax_mode(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
