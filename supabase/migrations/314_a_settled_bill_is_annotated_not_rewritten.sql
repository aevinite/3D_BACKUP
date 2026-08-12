-- 314_a_settled_bill_is_annotated_not_rewritten.sql
-- (RENUMBERED 312 → 314 on merge: a parallel session's table-merge migration took 312 minutes
--  earlier. Two files sharing a number apply in FILENAME order, not intent order — the exact trap
--  this sweep reported. Already applied to the backup database under the old name; every statement
--  is idempotent, so re-running under this one is a no-op.)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE OWNER, 2026-08-13, on sweep problem P4: "why is this even possible after bill — you should
-- not be able to edit and stuff. You CAN, but it will go in audit, minor section, not the risky
-- one … no money one. If you want, redesign the whole audit section: it should also show the whole
-- risk, money-wise, how much money is there which reverted, and all everything."
--
-- WHERE THIS LIVES: Manager panel → Bills tab → open a bill → a dish's ✎ note / allergy chips
-- (and the same edit on Manager panel → Tables floor → table detail → a dish row). Tablet panel
-- reaches the same two endpoints.
--
-- ── 1. WHAT WAS WRONG ────────────────────────────────────────────────────────────────────────
-- Migration 116 deliberately allowed a note / allergy edit at ANY status, and the reasoning is
-- right: a note never touches total, subtotal, tax or discount, and an allergy that was missed
-- must be recordable even after the guest has paid. But the function's last act was
-- `lfh_sync_order_items_json`, which does not patch one field — it REBUILDS `orders.items` from
-- scratch out of the current `order_items` rows. So annotating a dish on a SETTLED bill re-wrote
-- every line of that bill's stored ticket. Identical output while the two agree; the moment they
-- do not — a legacy order, a line priced another way, a row touched by only one of the two paths
-- — an already-issued bill's printed lines change after the fact, silently, with no audit row.
--
-- A settled sale's CONTENTS are not ours to rewrite. So on a settled bill the note is now PATCHED
-- into the one line it belongs to, matched by that line's own `order_items.id` (migration 068
-- stamps it on every line, so the match is exact and not a title guess). Nothing else in the
-- ticket is touched. An UNSETTLED order keeps the full rebuild — that is what keeps the ticket a
-- true projection of the dish rows while the order is still live.
--
-- ── 2. AND IT LEAVES A TRACE — IN THE MINOR SECTION ──────────────────────────────────────────
-- The edit is legal, so it is not refused; it is RECORDED. `lib/removalAudit.ts` gains the kind
-- `bill_annotated`, and `lfh_audit_risk()` below classifies it as `record` — not `money` — which
-- is what keeps it out of every money figure while still showing up in the Audit list.
--
-- ── 3. THE AUDIT LEARNS THE DIFFERENCE BETWEEN "RISKY" AND "MONEY MOVED" ─────────────────────
-- `lfh_audit_risk(kind)` is the database's half of the one risk map (the other half is KIND_RISK
-- in public/panels/auditsort.js, which all three panels read). `verify:audit` asserts the two
-- agree, because two answers to "is this row about money" is exactly how a summary starts
-- disagreeing with the list printed above it.
-- The money view he asked for rides on the function the Audit screens ALREADY call
-- (`lfh_audit_kind_counts` — kind, how many, how much): it gains a `risk` column, so one call now
-- answers both "what happened" and "did money actually move". A second, rival summary function was
-- written first and deleted before merge — two functions answering one question is precisely how two
-- screens start disagreeing.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── 1. A settled bill is annotated, never rewritten ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lfh_staff_edit_item_note(p_item uuid, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_item    order_items;
  v_order   orders;
  v_note    text;
  v_settled boolean;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_not_found'); END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;
  -- Still refused on a cancelled order: nothing was ever served, so there is nothing to annotate
  -- (unchanged from migration 116).
  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  END IF;

  v_note := NULLIF(left(COALESCE(p_note, ''), 300), '');
  UPDATE order_items SET note = v_note WHERE id = p_item;   -- target row by its unique id

  v_settled := (v_order.payment_status = 'paid');

  IF v_settled THEN
    -- SETTLED: patch ONLY this line's note inside the stored ticket. Matched on the line's own
    -- order_items id (mig 068 stamps `id` on every line), so no other line — and no other field of
    -- this line — can move. If a legacy ticket has no id on its lines there is nothing safe to
    -- match, and we leave the ticket exactly as issued rather than guess by title.
    UPDATE orders o
       SET items = (
         SELECT COALESCE(jsonb_agg(
                  CASE WHEN (line->>'id') = p_item::text
                       THEN CASE WHEN v_note IS NULL THEN line - 'note'
                                 ELSE jsonb_set(line, '{note}', to_jsonb(v_note)) END
                       ELSE line END
                  ORDER BY idx), '[]'::jsonb)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END)
              WITH ORDINALITY AS t(line, idx)
       )
     WHERE o.id = v_order.id
       AND jsonb_typeof(o.items) = 'array';
  ELSE
    -- NOT settled: the ticket is still a live projection of the dish rows, so rebuild it as before.
    PERFORM lfh_sync_order_items_json(v_order.id);
  END IF;

  -- `settled` tells the route handler to write the minor audit row (lib/removalAudit.ts →
  -- kind 'bill_annotated'). Returning it is how the record gets made without the browser deciding.
  RETURN jsonb_build_object('ok', true, 'order_id', v_order.id, 'note', v_note,
                            'settled', v_settled, 'bill_no', NULL::int);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.lfh_staff_edit_item_note(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_staff_edit_item_note(uuid, text) TO service_role;

-- ── 2. The one risk map, database half ───────────────────────────────────────────────────────
-- Mirrors KIND_RISK in public/panels/auditsort.js exactly (verify:audit asserts it).
--   money  — the restaurant collected less than the food was worth. The only rows the money
--            summary counts.
--   record — the record changed, the money did not (a KOT voided before anything was charged, a
--            dish off a live order, a menu edit, a reopen, a restore, a note after settling).
--   data   — a person's details erased on request: not money, and not undoable.
CREATE OR REPLACE FUNCTION public.lfh_audit_risk(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE p_kind
    WHEN 'discount_given'            THEN 'money'
    WHEN 'on_the_house'              THEN 'money'
    WHEN 'payment_reverted'          THEN 'money'
    WHEN 'order_deleted'             THEN 'money'
    WHEN 'bill_changed_after_reopen' THEN 'money'
    WHEN 'customer_erased'           THEN 'data'
    ELSE 'record'
  END;
$function$;
REVOKE EXECUTE ON FUNCTION public.lfh_audit_risk(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_audit_risk(text) TO service_role;

-- ── 3. The money view: what actually moved, and how much ─────────────────────────────────────
-- NOT A NEW FUNCTION. `lfh_audit_kind_counts` already exists (it feeds the type chips on all three
-- Audit screens: kind + how many + how much) and a second function answering the same question is
-- how two screens start disagreeing — the fault this whole day's work is about. So it GAINS the one
-- thing it could not say: the RISK of each kind.
--
-- After this, one call gives a screen everything the owner asked for: the per-type list it already
-- had, AND the split between money that actually moved and a record that merely changed. The screen
-- adds up nothing itself.
--
-- `amount` is what the recording endpoint stamped on the row: for a discount the money taken off,
-- for on-the-house the bill's own value, for a reverted payment the amount un-collected, for a
-- deleted bill what that bill was worth, for a reopen the difference before→after. A row with no
-- amount counts toward `n` and contributes 0 — an audit must never invent a figure it was not given.
--
-- Signature and column order are UNCHANGED and `risk` is appended LAST, so the existing callers
-- (app/api/owner/audit, the admin console) keep working untouched during a rollout.
-- Postgres refuses to change a function's OUT columns through CREATE OR REPLACE (42P13), so the old
-- shape is dropped first and the grants are re-applied below — the same pattern migration 139 used
-- when lfh_admin_floor_stats grew two columns.
DROP FUNCTION IF EXISTS public.lfh_audit_kind_counts(uuid[], timestamptz, timestamptz);
-- And the rival summary function written earlier in this session is dropped, not left lying about:
-- one question, one function.
DROP FUNCTION IF EXISTS public.lfh_audit_money_summary(uuid[], timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.lfh_audit_kind_counts(
  p_restaurant_ids uuid[],
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE(kind text, n bigint, amount numeric, risk text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT d.kind,
         COUNT(*)::bigint                                  AS n,
         COALESCE(round(SUM(COALESCE(d.amount, 0)), 2), 0) AS amount,
         lfh_audit_risk(d.kind)                            AS risk
  FROM deletion_audit d
  WHERE d.restaurant_id = ANY (p_restaurant_ids)
    AND (p_from IS NULL OR d.at >= p_from)
    AND (p_to   IS NULL OR d.at <  p_to)
  GROUP BY d.kind
  ORDER BY COUNT(*) DESC, d.kind;
$function$;
REVOKE EXECUTE ON FUNCTION public.lfh_audit_kind_counts(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_audit_kind_counts(uuid[], timestamptz, timestamptz) TO service_role;

-- The audit list is read by restaurant + newest-first, and now also grouped by kind. Both are
-- covered by one index; `at DESC` is what the list already sorts by.
CREATE INDEX IF NOT EXISTS deletion_audit_rid_kind_at_idx ON public.deletion_audit (restaurant_id, kind, at DESC);

NOTIFY pgrst, 'reload schema';
