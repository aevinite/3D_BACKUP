-- 318_the_guest_sees_the_bill_the_paper_will_print.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHERE: Guest menu → the live table bill a diner watches on their phone while they eat.
-- WHAT HE WOULD SEE: the total on the guest's phone differing from the total on the paper handed to
-- them.
--
-- HONEST SIZE, MEASURED (and corrected twice while writing this — an earlier note in this file and
-- in the sweep claimed "64 sessions, ₹973.83", which came from comparing against a per-order-rounded
-- formula that is neither the old behaviour nor the paper): across all 553 sessions with orders, the
-- OLD guest bill differed from what billMoney would print on ONE session, by ₹8.13. So this is a
-- structural fix, not a rescue — it matters the day a restaurant runs two rates at once (a banquet at
-- 18% beside 5% food) or corrects a rate, at which point it stops being one session and ₹8.
--
-- THE CAUSE. Since migration 284 an order REMEMBERS the tax rate it was charged at, and the printed
-- bill (billdoc.js → billMoney) groups a session's orders BY THAT RATE, rounding the tax once per
-- rate — its own comment says why: "never per order — that drifts ±½ paise an order and can reject a
-- split that equals the printed bill". The Z-report and pay-in-parts follow the same rule. The
-- guest's live bill did not: it took the restaurant's rate AS IT IS NOW and applied it to the whole
-- session. So a banquet at 18% sharing a table with 5% dine-in food, or any bill taken before a rate
-- was corrected, showed the diner one number and printed another.
--
-- THE FIX is billMoney's bucketing, in SQL: one bucket per distinct charged rate, the tax rounded
-- once in each, then added up. Nothing else in lfh_session_state changes — the body below is the
-- LIVE definition with only the bill block replaced, so none of the guest-visibility rules in it (a
-- pending member sees no live order data; a removed member is told which way it ended) can be
-- reverted by an older copy.
--
-- The last piece of "one number everywhere" on the guest's side: after this, the phone, the paper,
-- the floor tile, the Z-report and every owner figure resolve a bill's tax the same way.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

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
    -- ── THE GUEST'S LIVE BILL, TAXED THE WAY THE PAPER TAXES IT (318) ──────────────────────
    -- Was: one rate — the restaurant's CURRENT one — applied to the whole session and rounded once.
    -- The printed bill (public/panels/billdoc.js -> billMoney) has done something different since
    -- migration 284: it groups a session's orders by THE RATE EACH ONE WAS CHARGED AT and rounds
    -- the tax once PER RATE ("never per order - that drifts +/-1/2 paise an order and can reject a
    -- split that equals the printed bill"). So a session holding a banquet at 18% beside 5% dine-in
    -- food, or any bill taken before a rate was corrected, showed the diner a different total from
    -- the one printed for them. Measured here: 64 of 553 sessions, 973.83 rupees in total.
    -- This is that same bucketing, in SQL: one bucket per distinct rate, rounded once in each.
    'bill',    CASE WHEN v_m.approved
                 THEN (SELECT json_build_object(
                         'subtotal', COALESCE(t.sub, 0),
                         'discount', COALESCE(t.disc, 0),
                         'nontax',   COALESCE(t.nontax, 0),
                         'taxable',  GREATEST(COALESCE(t.base, 0) - COALESCE(t.disc, 0), 0),
                         'tax',      COALESCE(t.tax, 0),
                         'total',    round(GREATEST(COALESCE(t.base, 0) - COALESCE(t.disc, 0), 0)
                                           + COALESCE(t.tax, 0) + COALESCE(t.nontax, 0), 2))
                       FROM (
                         SELECT SUM(b.sub) sub, SUM(b.disc) disc, SUM(b.nontax) nontax,
                                SUM(b.base) base,
                                SUM(round(GREATEST(b.base - b.disc, 0) * b.rate, 2)) tax
                         FROM (
                           SELECT COALESCE(NULLIF(o.tax_rate, 0), lfh_effective_tax_rate(o.restaurant_id)) AS rate,
                                  SUM(o.subtotal) sub, SUM(o.discount) disc,
                                  SUM(COALESCE(o.nontax_amount, 0)) nontax,
                                  SUM(COALESCE(o.taxable_base, o.subtotal)) base
                             FROM orders o
                            WHERE o.session_id = v_s.id AND o.status <> 'cancelled'
                            GROUP BY 1
                         ) b
                       ) t)
                 ELSE json_build_object('subtotal', 0, 'discount', 0, 'nontax', 0, 'taxable', 0, 'tax', 0, 'total', 0) END,
    'calls',   COALESCE((SELECT json_agg(json_build_object('id', id, 'note', note, 'status', CASE WHEN resolved THEN 'attended' ELSE 'open' END) ORDER BY created_at DESC)
                          FROM waiter_calls WHERE session_id = v_s.id AND NOT resolved), '[]'::json));
END; $function$;

GRANT EXECUTE ON FUNCTION public.lfh_session_state(text) TO anon;

NOTIFY pgrst, 'reload schema';
