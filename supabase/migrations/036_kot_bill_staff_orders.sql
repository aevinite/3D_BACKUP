-- KOT ticket numbers + bill numbers + staff-placed orders (Phases 2-3 plumbing).
--
-- 1. Every ORDER gets a short daily KOT number (#1, #2, …) the kitchen can shout;
--    every SESSION gets a daily BILL number. Both reset each day via a tiny
--    counters table (atomic upsert — two simultaneous orders can't share a number).
-- 2. get_order_status also returns the kot number so the guest's tracker can show
--    "Ticket #7".
-- 3. lfh_staff_place_order: the waiter-tablet places an order FOR a table. Same
--    server-side pricing as guest orders (lfh_price_order — unknown/sold-out
--    rejected, prices from the DB). SERVICE-ROLE ONLY: no anon grant, so guests
--    can never reach it.

-- ── 1a. daily counters ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_counters (
  key TEXT NOT NULL,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  n   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);

CREATE OR REPLACE FUNCTION lfh_next_counter(p_key text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO daily_counters(key, day, n) VALUES (p_key, CURRENT_DATE, 1)
    ON CONFLICT (key, day) DO UPDATE SET n = daily_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;

-- ── 1b. kot_no on orders, bill_no on sessions (assigned on insert) ──────────
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS kot_no  INT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS bill_no INT;

CREATE OR REPLACE FUNCTION lfh_assign_kot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kot_no IS NULL THEN NEW.kot_no := lfh_next_counter('kot'); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_assign_kot ON orders;
CREATE TRIGGER trg_assign_kot BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION lfh_assign_kot();

CREATE OR REPLACE FUNCTION lfh_assign_bill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bill_no IS NULL THEN NEW.bill_no := lfh_next_counter('bill'); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_assign_bill ON sessions;
CREATE TRIGGER trg_assign_bill BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION lfh_assign_bill();

-- ── 2. guest order tracker can show the ticket number ───────────────────────
-- (return shape changes, so the old function must be dropped first)
DROP FUNCTION IF EXISTS public.get_order_status(uuid);
CREATE FUNCTION public.get_order_status(order_id UUID)
RETURNS TABLE (status TEXT, table_number TEXT, created_at TIMESTAMPTZ, kot_no INT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT o.status, o.table_number, o.created_at, o.kot_no
  FROM orders o WHERE o.id = order_id
$$;
GRANT EXECUTE ON FUNCTION public.get_order_status(UUID) TO anon, authenticated;

-- ── 3. staff-placed orders (waiter tablet / captain mode) ────────────────────
CREATE OR REPLACE FUNCTION lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s sessions; v_order uuid; v_kot int; v_item jsonb; v_priced jsonb;
BEGIN
  -- Same money math as guest orders: priced by the server, sold-out rejected.
  v_priced := lfh_price_order(p_items);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- Attach to the table's open session when there is one (so the shared bill
  -- and the floor board see it); otherwise it's a legacy-style table order.
  SELECT * INTO v_s FROM sessions WHERE table_number = p_table AND status = 'open' LIMIT 1;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id)
    VALUES (p_table, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, NULL)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        COALESCE(v_item->>'note', p_note));
  END LOOP;

  IF v_s.id IS NOT NULL THEN UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id; END IF;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot);
END; $$;
-- Deliberately NO anon grant: only the staff panels' service-role key may call this.

NOTIFY pgrst, 'reload schema';
