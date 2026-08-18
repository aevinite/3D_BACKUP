-- 336_was_the_food_actually_made.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- P1 of docs/CANCEL-AND-LOSS-SPEC.md — the owner, 2026-08-18:
--   "while kot delete button there will be one thing order was mode and order was not made like in
--    red they have to choose if made then it will show as cancelling and the inventory deducted and
--    the cancelinging amout go up expensis goes up and all in audit it will noted like loss"
--
-- A cancelled order is TWO events wearing one name: food never cooked (no cost) and food cooked then
-- binned (a real cost). The software never asked which, so it could not tell the truth about either.
-- Measured before writing a line:
--   · mig 224's trg_inv_deplete_order posts a negative 'consumption' at kitchen-fire. Correct.
--   · Cancelling reverses NOTHING — so a mis-keyed order eats its ingredients for ever.
--   · 'consumption_reversal' is in mig 221's CHECK and the manager panel's inventory ledger already
--     LABELS it "Order cancelled" — and nothing has ever written one. A dead kind.
--   · Wasted food never becomes an expense.
--
-- WHERE THE OWNER SEES IT: manager panel → the floor → cancel a KOT (the red Yes/No that P2 adds) ·
-- owner panel → Audit & logs → Audit · removals (the loss tag and its cost) · owner panel →
-- Dashboard → the Expenses tile · owner panel → Inventory & expenses → Expenses.
--
-- COMPLIANCE (docs/COMPLIANCE-GUARDRAILS.md §3.0): this only ever ADDS records. The bill is not
-- touched, no invoice is renumbered, the cancelled sale still counts at ₹0 everywhere. Classifying is
-- APPEND-ONLY: the original deletion_audit row is never edited — a correction writes a new
-- 'removal_classified' row naming who changed it and from what to what, and readers take the latest.
-- The ingredient cost is an EXPENSE and never a reduction of revenue (revenue is already net, mig 315).
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── A. food loss is its own expense category ─────────────────────────────────────────────────
-- The category list is a CHECK, so it has to be replaced rather than appended to. Same names as
-- before plus 'food_loss', so nothing existing becomes invalid.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
  ('breakage','repair','utilities','cleaning','supplies','rent','transport','misc','food_loss'));

-- ── B. the audit learns a third answer ───────────────────────────────────────────────────────
-- 'removal_classified' is the append-only correction row: it is NOT itself a removal, so it must
-- never be counted as one. lfh_audit_risk() already sends every unlisted kind to 'record', which is
-- right for it.
COMMENT ON TABLE deletion_audit IS
  'Every money-lowering or record-changing removal. Append-only. kind ''removal_classified'' is not a '
  'removal — it records that somebody answered, or corrected, the "was the food made?" question on an '
  'earlier row (meta.of = that row''s id).';

-- ── C. THE TAG MAP — one answer for all three Audit screens ──────────────────────────────────
-- The client half is KIND_TAGS in public/panels/auditsort.js; verify:audit asserts the two agree, the
-- same contract lfh_audit_risk()/KIND_RISK already live under. Tags are additive labels a person can
-- filter by — deliberately NOT a second risk model.
CREATE OR REPLACE FUNCTION public.lfh_audit_tags(p_kind text, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $function$
  SELECT ARRAY(SELECT DISTINCT t FROM unnest(
    -- what KIND of thing it is
    CASE p_kind
      WHEN 'order_cancelled'            THEN ARRAY['cancellation','kitchen']
      WHEN 'order_deleted'              THEN ARRAY['bill','money']
      WHEN 'dish_removed'               THEN ARRAY['order','kitchen']
      WHEN 'qty_reduced'                THEN ARRAY['order','kitchen']
      WHEN 'menu_item_deleted'          THEN ARRAY['menu']
      WHEN 'invoice_voided'             THEN ARRAY['bill','reopen']
      WHEN 'discount_given'             THEN ARRAY['money','discount']
      WHEN 'payment_reverted'           THEN ARRAY['money','payment']
      WHEN 'on_the_house'               THEN ARRAY['money','discount']
      WHEN 'bill_changed_after_reopen'  THEN ARRAY['bill','reopen','money']
      WHEN 'order_restored'             THEN ARRAY['order','restored']
      WHEN 'bill_annotated'             THEN ARRAY['bill','note']
      WHEN 'customer_erased'            THEN ARRAY['guest','privacy']
      WHEN 'removal_classified'         THEN ARRAY['correction']
      ELSE ARRAY['other']
    END
    ||
    -- …and, for a cancellation, WHETHER THE FOOD WAS MADE. This is the tag he asked for.
    CASE
      WHEN p_kind <> 'order_cancelled' THEN ARRAY[]::text[]
      WHEN p_meta->>'made' = 'true'  THEN ARRAY['loss']
      WHEN p_meta->>'made' = 'false' THEN ARRAY['no-loss']
      ELSE ARRAY['unanswered']
    END
    ||
    -- a loss we cannot price (the dish has no recipe) is marked, never invented. Same honesty rule
    -- the inventory reports use for recipe coverage.
    CASE
      WHEN p_kind = 'order_cancelled' AND p_meta->>'made' = 'true'
           AND COALESCE((p_meta->>'loss_cost')::numeric, -1) = 0
      THEN ARRAY['cost-unknown'] ELSE ARRAY[]::text[]
    END
  ) AS t ORDER BY t);
$function$;
REVOKE EXECUTE ON FUNCTION public.lfh_audit_tags(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_audit_tags(text, jsonb) TO service_role;

-- ── D. THE ONE ACTION: answer the question, and let the answer do its work ───────────────────
-- Called by the cancel endpoint with the person's answer, and by the Audit screen when somebody
-- corrects it later. Everything it does is idempotent, so an offline replay or a double-tap is safe:
--   · the stock movement carries a dedupe_key, so it can only ever post once;
--   · the expense is found by its own (restaurant, order) marker before being written.
--
-- p_made = TRUE  → the food was cooked. The consumption stands. Price what was consumed for THIS
--                  order and write ONE 'food_loss' expense. Tag: loss.
-- p_made = FALSE → never started. Post 'consumption_reversal' for exactly what this order consumed,
--                  so the ingredients go back on the shelf, and void any earlier loss expense.
CREATE OR REPLACE FUNCTION public.lfh_cancel_classify(
  p_restaurant uuid,
  p_order      uuid,
  p_made       boolean,
  p_actor      text DEFAULT NULL,
  p_actor_id   uuid DEFAULT NULL,
  p_actor_role text DEFAULT NULL,
  p_audit_id   bigint DEFAULT NULL      -- the removal row being answered, when there is one
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_order   orders;
  v_cost    numeric := 0;
  v_lines   integer := 0;
  v_prev    text;
  v_expense uuid;
  r         RECORD;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order AND restaurant_id = p_restaurant;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found'); END IF;

  -- Link to the removal row it answers, without making every caller carry its id. recordRemoval()
  -- returns void, so the cancel endpoint has nothing to pass — it finds its own.
  IF p_audit_id IS NULL THEN
    SELECT id INTO p_audit_id FROM deletion_audit
     WHERE restaurant_id = p_restaurant AND kind = 'order_cancelled' AND order_id = p_order
     ORDER BY at DESC, id DESC LIMIT 1;
  END IF;
  IF v_order.status <> 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_cancelled');
  END IF;

  -- What this order actually took off the shelf, at the price it was taken at. Read from the ledger
  -- rather than recomputed from the recipe: the recipe may have changed since, and the ledger is what
  -- really happened.
  SELECT COALESCE(SUM(-m.qty_base * m.unit_cost), 0), COUNT(*)
    INTO v_cost, v_lines
    FROM inv_movements m
   WHERE m.restaurant_id = p_restaurant
     AND m.ref_type = 'order' AND m.ref_id = p_order::text
     AND m.kind = 'consumption';

  -- The answer that was on record before this call, so the correction row can say what moved.
  -- It lives on the latest 'removal_classified' row, NOT on the 'order_cancelled' row: answers are
  -- append-only and the removal row is never edited. Reading the removal row was the first version of
  -- this and it always came back NULL, so no correction was ever marked as one (caught by the P1 test).
  SELECT meta->>'made' INTO v_prev FROM deletion_audit
   WHERE restaurant_id = p_restaurant AND kind = 'removal_classified' AND order_id = p_order
   ORDER BY at DESC, id DESC LIMIT 1;

  IF p_made THEN
    -- THE FOOD WAS MADE. The stock is genuinely gone, so nothing is returned. Price it as an expense,
    -- once. A dish with no recipe prices at 0 and is tagged cost-unknown rather than guessed at.
    IF v_cost > 0 THEN
      SELECT id INTO v_expense FROM expenses
       WHERE restaurant_id = p_restaurant AND category = 'food_loss'
         AND note = 'order:' || p_order::text AND voided_at IS NULL
       LIMIT 1;
      IF v_expense IS NULL THEN
        INSERT INTO expenses (restaurant_id, category, title, amount, expense_date, note, created_by, created_by_id)
        VALUES (p_restaurant, 'food_loss',
                'Food made then cancelled' || COALESCE(' · table ' || v_order.table_number::text, ''),
                ROUND(v_cost, 2),
                (COALESCE(v_order.created_at, now()) AT TIME ZONE 'Asia/Kolkata')::date,
                'order:' || p_order::text, p_actor, p_actor_id)
        RETURNING id INTO v_expense;
      END IF;
    END IF;
  ELSE
    -- NEVER STARTED. Put back exactly what this order took, line for line, and strike out any loss
    -- expense a previous answer had written. The dedupe key makes the reversal once-only for ever.
    FOR r IN
      SELECT item_id, SUM(qty_base) AS q, MAX(unit_cost) AS c
        FROM inv_movements
       WHERE restaurant_id = p_restaurant AND ref_type = 'order' AND ref_id = p_order::text
         AND kind = 'consumption'
       GROUP BY item_id
    LOOP
      PERFORM lfh_inv_post_movement(
        p_restaurant, r.item_id, -r.q, 'consumption_reversal',
        'cxrev:' || p_order::text || ':' || r.item_id::text,
        r.c, 'order cancelled before it was cooked', 'order', p_order::text, COALESCE(p_actor, 'system'));
    END LOOP;
    UPDATE expenses
       SET voided_at = now(), void_reason = 'the food was never made', voided_by = p_actor
     WHERE restaurant_id = p_restaurant AND category = 'food_loss'
       AND note = 'order:' || p_order::text AND voided_at IS NULL;
  END IF;

  -- THE RECORD. Append-only: the original removal row keeps its own history, and this row says who
  -- answered, what they answered, and what it was before. Readers take the latest answer for an order.
  -- `amount` is deliberately LEFT NULL. The Audit screens sum `amount` per kind for their money /
  -- record-only split, so putting the loss on this row would add it to the record total EVERY time
  -- somebody answered — the P1 test caught it at ₹401.20 for one ₹200.60 loss, answered twice. The
  -- cost lives in meta.loss_cost, which is what the tag and the row's own detail read.
  INSERT INTO deletion_audit (restaurant_id, kind, actor, actor_id, actor_role,
                              table_number, session_id, order_id, kot_no, amount, meta)
  VALUES (p_restaurant, 'removal_classified', p_actor, p_actor_id, p_actor_role,
          v_order.table_number::text, v_order.session_id, p_order, v_order.kot_no,
          NULL,
          jsonb_build_object(
            'of', p_audit_id, 'made', p_made, 'was', v_prev,
            'loss_cost', ROUND(v_cost, 2), 'lines', v_lines,
            'expense_id', v_expense, 'corrected', (v_prev IS NOT NULL AND v_prev <> p_made::text)));

  RETURN jsonb_build_object('ok', true, 'made', p_made, 'lossCost', ROUND(v_cost, 2),
                            'lines', v_lines, 'expenseId', v_expense,
                            'tags', lfh_audit_tags('order_cancelled',
                                     jsonb_build_object('made', p_made, 'loss_cost', ROUND(v_cost, 2))));
END $function$;
REVOKE EXECUTE ON FUNCTION public.lfh_cancel_classify(uuid, uuid, boolean, text, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.lfh_cancel_classify(uuid, uuid, boolean, text, uuid, text, bigint)
  TO service_role;

-- ── E. the per-kind counts carry the tags, so the chips need no second call ──────────────────
-- lfh_audit_kind_counts already answers "kind, how many, how much, what risk" for all three Audit
-- screens (mig 311, gained `risk` in 314). It gains `tags`, built from the SAME function above — a
-- second, rival summary is how two screens start disagreeing, which is the fault 314 exists to stop.
--
-- EVERYTHING ELSE ABOUT IT IS COPIED EXACTLY, because a caller passes its arguments BY NAME and reads
-- its columns by name. Four things here are load-bearing and were nearly changed by accident:
--   · the parameter is `p_restaurant_ids` — app/api/owner/audit/route.ts calls it with that name, and
--     a rename would make the chips vanish on all three screens with no error;
--   · SECURITY DEFINER + search_path, or it cannot read the table at all;
--   · the upper bound is `d.at < p_to`, EXCLUSIVE — an inclusive bound double-counts a row that lands
--     exactly on a window edge;
--   · round(...,2) on the amount, and the `ORDER BY COUNT(*) DESC, d.kind` tiebreak, so the chip order
--     is stable rather than arbitrary between two kinds with the same count.
-- A DROP is needed because RETURNS TABLE gains a column and CREATE OR REPLACE cannot change that; the
-- argument types are identical, so the grants below restore exactly what was there.
DROP FUNCTION IF EXISTS public.lfh_audit_kind_counts(uuid[], timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION public.lfh_audit_kind_counts(
  p_restaurant_ids uuid[],
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE(kind text, n bigint, amount numeric, risk text, tags text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT d.kind,
         COUNT(*)::bigint                                  AS n,
         COALESCE(round(SUM(COALESCE(d.amount, 0)), 2), 0) AS amount,
         lfh_audit_risk(d.kind)                            AS risk,
         -- the union of every tag seen on this kind in the window, so "loss" and "no-loss" both show
         -- up as choices when both really happened
         ARRAY(SELECT DISTINCT t FROM unnest(ARRAY(
                 SELECT unnest(lfh_audit_tags(d2.kind, d2.meta))
                   FROM deletion_audit d2
                  WHERE d2.restaurant_id = ANY (p_restaurant_ids) AND d2.kind = d.kind
                    AND (p_from IS NULL OR d2.at >= p_from)
                    AND (p_to   IS NULL OR d2.at <  p_to)
               )) AS t ORDER BY t)                         AS tags
  FROM deletion_audit d
  WHERE d.restaurant_id = ANY (p_restaurant_ids)
    AND (p_from IS NULL OR d.at >= p_from)
    AND (p_to   IS NULL OR d.at <  p_to)
  GROUP BY d.kind
  ORDER BY COUNT(*) DESC, d.kind;
$function$;
REVOKE ALL ON FUNCTION public.lfh_audit_kind_counts(uuid[], timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_audit_kind_counts(uuid[], timestamptz, timestamptz)
  TO service_role;
