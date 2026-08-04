-- 271_session_state_carries_the_split.sql
--
-- The guest's live table bill (lfh_session_state) computed its tax as
--   (Σsubtotal − Σdiscount) × rate
-- which silently assumes EVERY rupee on the bill is taxable. With MRP / exempt lines (mig 270)
-- that overstates the tax and the guest's screen would disagree with the printed paper.
--
-- It now reads the split, and carries 'nontax' + 'taxable' out to the client so
-- components/SessionTableBill.tsx can show an honest "MRP items" row instead of inventing one.
-- (Fabricating a bill line on the client is forbidden in this project — the number has to come
-- from the server that computed it.)
--
-- LEGACY-SAFE BY CONSTRUCTION: COALESCE(taxable_base, subtotal) and COALESCE(nontax_amount, 0)
-- mean an order placed before mig 270 is treated as entirely taxable — which is exactly what
-- it was charged. For every restaurant today (feature off) the output is byte-identical.
--
-- The body below was PULLED FROM THE LIVE FUNCTION and patched in three places, rather than
-- hand-transcribed — the same technique migration 126 used on this same function, because
-- retyping 250 lines is how an earlier fix gets silently dropped (mig 203 did exactly that to
-- the per-restaurant tax rate mig 119 had added).

CREATE OR REPLACE FUNCTION public.lfh_session_state(p_token text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_m session_members; v_s sessions; v_removed session_members;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN
    SELECT * INTO v_removed FROM session_members WHERE token = p_token AND removed;
    IF FOUND THEN
      IF EXISTS (SELECT 1 FROM sessions WHERE id = v_removed.session_id AND status = 'closed') THEN
        RETURN json_build_object('ok', false, 'reason', 'session_closed');
      END IF;
      RETURN json_build_object('ok', false, 'reason', 'removed');
    END IF;
    RETURN json_build_object('ok', false, 'reason', 'invalid_token');
  END IF;
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id;
  RETURN json_build_object(
    'ok', true,
    'session', json_build_object('id', v_s.id, 'table_number', v_s.table_number, 'status', v_s.status, 'auto_approve', v_s.auto_approve),
    'member',  json_build_object('id', v_m.id, 'role', v_m.role, 'approved', v_m.approved, 'phone_verified', v_m.phone_verified, 'name', v_m.name),
    'members', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name, 'role', role, 'approved', approved, 'phone_verified', phone_verified) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT removed), '[]'::json),
    'pending', COALESCE((SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY joined_at)
                          FROM session_members WHERE session_id = v_s.id AND NOT approved AND NOT removed), '[]'::json),
    'items',   CASE WHEN v_m.approved
                 THEN COALESCE((SELECT json_agg(json_build_object('id', id, 'title', title, 'qty', qty, 'status', status,
                                                                  'options', options, 'removed', removed, 'note', note) ORDER BY created_at)
                                FROM order_items WHERE session_id = v_s.id), '[]'::json)
                 ELSE '[]'::json END,
    'orders',  CASE WHEN v_m.approved
                 THEN COALESCE((SELECT json_agg(json_build_object('id', id, 'status', status, 'total', total, 'items', items, 'created_at', created_at) ORDER BY created_at)
                                FROM orders WHERE session_id = v_s.id AND status <> 'cancelled'), '[]'::json)
                 ELSE '[]'::json END,
    -- (2026-07-05) discount-before-tax so the guest's live table total equals the
    -- printed/paid bill. taxable = Σsubtotal − Σdiscount; tax on taxable; total on top.
    -- Now also carries a 'discount' field so the guest UI can show the reduction line.
    'bill',    CASE WHEN v_m.approved
                 THEN (SELECT json_build_object(
                         'subtotal', COALESCE(SUM(subtotal), 0),
                         'discount', COALESCE(SUM(discount), 0),
                         'nontax', COALESCE(SUM(COALESCE(nontax_amount, 0)), 0),
                         'taxable', GREATEST(COALESCE(SUM(COALESCE(taxable_base, subtotal)), 0) - COALESCE(SUM(discount), 0), 0),
                         'tax',   round(GREATEST(COALESCE(SUM(COALESCE(taxable_base, subtotal)), 0) - COALESCE(SUM(discount), 0), 0) * lfh_effective_tax_rate(v_s.restaurant_id), 2),
                         'total', round(GREATEST(COALESCE(SUM(COALESCE(taxable_base, subtotal)), 0) - COALESCE(SUM(discount), 0), 0) * (1 + lfh_effective_tax_rate(v_s.restaurant_id)) + COALESCE(SUM(COALESCE(nontax_amount, 0)), 0), 2))
                       FROM orders WHERE session_id = v_s.id AND status <> 'cancelled')
                 ELSE json_build_object('subtotal', 0, 'discount', 0, 'nontax', 0, 'taxable', 0, 'tax', 0, 'total', 0) END,
    'calls',   COALESCE((SELECT json_agg(json_build_object('id', id, 'note', note, 'status', CASE WHEN resolved THEN 'attended' ELSE 'open' END) ORDER BY created_at DESC)
                          FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved), '[]'::json));
END; $function$
;

GRANT EXECUTE ON FUNCTION lfh_session_state(text) TO anon;

NOTIFY pgrst, 'reload schema';
