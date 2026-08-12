-- 051_concurrency_integrity_guards.sql
-- Safe structural guards from the deep concurrency / paid-state audit. No UX
-- change — these prevent races and a security IDOR.

-- L3: at most ONE open session per table. Dedupe any existing dups (keep the most
-- recently active), then enforce with a partial unique index — kills duplicate-
-- session races in request-approve / shift / join (a whole class of bugs).
-- ⚠️ ONE-TIME, AND SCOPED PER RESTAURANT SINCE 311. Written when ONE restaurant existed, this
-- partitioned by table_number ALONE — so on today's multi-restaurant database it treated
-- "table 5 at Aangan" and "table 5 at French House" as duplicates of each other and CLOSED all
-- but the most recently active. Closing is not a quiet flag: the close trigger then empties the
-- shared cart, marks every member removed (their phones stop working mid-meal), resolves the
-- table's waiter calls and denies its pending requests. Measured on the backup database the day
-- this was fixed: 27 open tables, 4 table numbers open at more than one restaurant, so a re-seed
-- would have shut 4 LIVE tables. `seed-supabase.mjs` re-runs every file in this folder, so that
-- was one command away. Migration 307's audit cleared this block as safe; that judgement was made
-- in a single-restaurant frame and was wrong.
-- Now: PARTITION BY (restaurant_id, table_number), and the whole block runs only while the ledger
-- has no row for it (migration 311 records it, so every existing database skips it for good).
DO $reseed_guard$
BEGIN
IF lfh_already_applied('051_one_open_session_per_table') THEN
  RAISE NOTICE '051_one_open_session_per_table: already applied — skipped (it would close live tables)';
  RETURN;
END IF;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY restaurant_id, table_number
    ORDER BY last_activity_at DESC NULLS LAST, opened_at DESC NULLS LAST
  ) AS rn
  FROM sessions WHERE status = 'open' AND table_number IS NOT NULL
)
UPDATE sessions s SET status = 'closed', closed_at = now()
  FROM ranked r WHERE s.id = r.id AND r.rn > 1;

END $reseed_guard$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session_per_table
  ON sessions (table_number) WHERE status = 'open';

-- C4 (security IDOR): lock down set_order_table_number. The guest "fix my table
-- typo" path may only correct a SESSION-LESS order; a session-attached order must
-- be moved by staff (orders/:id/move, which re-links session + items). This
-- closes the anon ability to shove any order onto any table and the resulting
-- table_number/session_id split-brain.
CREATE OR REPLACE FUNCTION public.set_order_table_number(order_id UUID, new_table TEXT)
RETURNS TABLE (status TEXT, table_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_o orders; v_t text := NULLIF(btrim(new_table), '');
BEGIN
  IF v_t IS NULL OR v_t !~ '^\d+$' THEN RETURN; END IF;
  SELECT * INTO v_o FROM orders WHERE id = order_id AND status IN ('received','preparing');
  IF NOT FOUND THEN RETURN; END IF;
  IF v_o.session_id IS NOT NULL THEN RETURN; END IF; -- session orders: staff move only
  UPDATE orders SET table_number = v_t WHERE id = order_id;
  RETURN QUERY SELECT o.status, o.table_number FROM orders o WHERE o.id = order_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_order_table_number(UUID, TEXT) TO anon, authenticated;

-- M1: serialize first-order bill_no assignment with a row lock so two concurrent
-- first orders for one session can't both consume a bill number (sequence gap).
CREATE OR REPLACE FUNCTION lfh_assign_bill_on_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_has int;
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    SELECT bill_no INTO v_has FROM sessions WHERE id = NEW.session_id FOR UPDATE;
    IF v_has IS NULL THEN
      UPDATE sessions SET bill_no = lfh_next_counter('bill') WHERE id = NEW.session_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

NOTIFY pgrst, 'reload schema';
