-- 340 · THE TWO FUNCTIONS THAT LIVED ONLY ON THE DATABASE
--
-- `npm run verify:db-parity` — and phase 19 of the 528-phase suite — had been failing on clean main:
--
--   ✗ 2 function(s) exist on the database but in NO migration: lfh_audit_tags, lfh_cancel_classify
--     — a rebuild would lose them and the other stack can never get them
--
-- They are the cancellation-classification work ("was the food actually made?" → put the stock back,
-- or price the loss as an expense — and the tags the Audit screens read). Real, finished, in use, and
-- written straight onto the dev database without a migration ever being committed. That is the one
-- thing this project cannot leave standing: **a fix that is only on one stack is not a fix.** Rebuild
-- the database from `supabase/migrations` and both would simply vanish; the client stack could never
-- be given them at all.
--
-- So this captures them EXACTLY as they run today — `pg_get_functiondef` output, unedited, not a
-- rewrite from memory — so that applying this migration to an empty database produces the same two
-- functions, and applying it to this one changes nothing.
--
-- GRANTS ARE PART OF THE CAPTURE. Both are staff-only: their live ACL is postgres + service_role and
-- nothing else. A new Postgres function is PUBLIC-executable by default (the mig 038/267 lesson that
-- `verify:grants` exists to guard), so the REVOKE/GRANT pair below is not decoration — without it a
-- rebuilt database would hand `lfh_cancel_classify`, which writes expenses and moves stock, to the
-- anon key. Re-running is safe.

CREATE OR REPLACE FUNCTION public.lfh_audit_tags(p_kind text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
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

CREATE OR REPLACE FUNCTION public.lfh_cancel_classify(p_restaurant uuid, p_order uuid, p_made boolean, p_actor text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid, p_actor_role text DEFAULT NULL::text, p_audit_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                -- THE BUSINESS DAY, NOT THE CALENDAR DAY (measured, 2026-08-19). A restaurant's day
                -- runs 05:00 IST to 05:00 IST, and every document date in this system follows that —
                -- migration 294 exists for exactly this and gives the rule as lfh_doc_date_hi(): step
                -- back the 5-hour offset BEFORE taking the date. Dated by the calendar day instead,
                -- food cooked at 01:00 was stamped tomorrow and then fell outside the window the
                -- dashboard filters by, so the Expenses tile showed 2 of 3 losses and a total that
                -- happened to look plausible (₹1,800 of ₹3,600). Same arithmetic as the helper.
                ((COALESCE(v_order.created_at, now()) - interval '5 hours') AT TIME ZONE 'Asia/Kolkata')::date,
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

  -- ── AND THE ROW A SCREEN ACTUALLY LISTS CARRIES THE CURRENT ANSWER ──────────────────────────
  -- The trail of answers lives in the 'removal_classified' rows above and is never touched. But the
  -- Audit LISTS the 'order_cancelled' row, and a list cannot afford a sub-query per line to find the
  -- latest answer — measured: without this the panel showed "Not answered yet" on a row that had just
  -- been answered, because it was reading the cancellation's own meta.
  -- So the answer is MERGED onto the cancellation row as a read convenience. This erases nothing: the
  -- who/when/from-what history is still one row per answer, and `corrected` still marks a change.
  UPDATE deletion_audit
     SET meta = COALESCE(meta, '{}'::jsonb)
                || jsonb_build_object('made', p_made, 'loss_cost', ROUND(v_cost, 2))
   WHERE restaurant_id = p_restaurant AND kind = 'order_cancelled' AND order_id = p_order;

  RETURN jsonb_build_object('ok', true, 'made', p_made, 'lossCost', ROUND(v_cost, 2),
                            'lines', v_lines, 'expenseId', v_expense,
                            'tags', lfh_audit_tags('order_cancelled',
                                     jsonb_build_object('made', p_made, 'loss_cost', ROUND(v_cost, 2))));
END $function$;
-- Staff-only, exactly as they are on the database today: no anon, no authenticated, no PUBLIC.
REVOKE ALL ON FUNCTION public.lfh_audit_tags(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lfh_cancel_classify(uuid, uuid, boolean, text, uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_audit_tags(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.lfh_cancel_classify(uuid, uuid, boolean, text, uuid, text, bigint) TO service_role;
