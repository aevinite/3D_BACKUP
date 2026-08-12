-- 051_concurrency_integrity_guards.sql
-- Safe structural guards from the deep concurrency / paid-state audit. No UX
-- change — these prevent races and a security IDOR.

-- L3: at most ONE open session per table. Dedupe any existing dups (keep the most
-- recently active), then enforce with a partial unique index — kills duplicate-
-- session races in request-approve / shift / join (a whole class of bugs).
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY table_number
    ORDER BY last_activity_at DESC NULLS LAST, opened_at DESC NULLS LAST
  ) AS rn
  FROM sessions WHERE status = 'open' AND table_number IS NOT NULL
)
UPDATE sessions s SET status = 'closed', closed_at = now()
  FROM ranked r WHERE s.id = r.id AND r.rn > 1;
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
