-- 071_platform_orders.sql
-- Platform (Zomato / Swiggy / takeaway) orders: enrich the existing
-- `aggregator_orders` landing table (migration 037) so it can hold a real,
-- manageable order, and add the two operator toggles. ADDITIVE ONLY — touches
-- nothing about dine-in `orders`, so existing flows are unchanged by construction.
-- (owner direction 2026-06-20; see docs/superpowers/specs/2026-06-20-platform-panel-design.md)

-- 1. allow 'takeaway' as a source (was zomato/swiggy/other only)
ALTER TABLE aggregator_orders DROP CONSTRAINT IF EXISTS aggregator_orders_source_check;
ALTER TABLE aggregator_orders
  ADD CONSTRAINT aggregator_orders_source_check
  CHECK (source IN ('zomato','swiggy','takeaway','other'));

-- 2. fields that make an aggregator row a manageable kitchen/platform order
ALTER TABLE aggregator_orders
  ADD COLUMN IF NOT EXISTS customer_name  TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS items          JSONB   NOT NULL DEFAULT '[]'::jsonb,  -- [{title, qty, price, removed?, note?}]
  ADD COLUMN IF NOT EXISTS total          NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status_history JSONB   NOT NULL DEFAULT '[]'::jsonb,  -- [{status, at, by?}]
  ADD COLUMN IF NOT EXISTS kot_no         INT,
  ADD COLUMN IF NOT EXISTS accepted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_by    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- status values used by the app: new → accepted → preparing → ready → handed_over (or cancelled)

-- 3. the two operator toggles (live on the single `settings` row, id='site')
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS kitchen_can_accept_platform BOOLEAN NOT NULL DEFAULT true,  -- can the KITCHEN accept platform orders? else only the manager can
  ADD COLUMN IF NOT EXISTS platform_in_bills           BOOLEAN NOT NULL DEFAULT false; -- also mirror accepted platform orders into the bills list?

-- 4. realtime: wake the staff panels (kitchen + manager) when a platform order
--    changes, same 'ops' topic the kitchen already listens on. Separate trigger
--    fn so the existing lfh_rt_emit (orders/order_items) is left untouched.
CREATE OR REPLACE FUNCTION lfh_rt_emit_platform() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  r := COALESCE(NEW, OLD);
  INSERT INTO realtime_events(topic, kind, entity_id) VALUES ('ops', 'platform', r.id::text);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS rt_emit_platform ON aggregator_orders;
CREATE TRIGGER rt_emit_platform AFTER INSERT OR UPDATE OR DELETE ON aggregator_orders
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit_platform();

-- 5. RPCs (the test-order button now; the real webhook later use the SAME insert path)
CREATE OR REPLACE FUNCTION lfh_platform_insert(
  p_source TEXT, p_external_id TEXT, p_customer TEXT, p_phone TEXT, p_items JSONB, p_total NUMERIC
) RETURNS aggregator_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row aggregator_orders;
BEGIN
  INSERT INTO aggregator_orders(source, external_id, payload, status, status_history,
      customer_name, customer_phone, items, total, kot_no)
  VALUES (p_source, p_external_id, '{}'::jsonb, 'new',
      jsonb_build_array(jsonb_build_object('status','new','at', NOW())),
      p_customer, p_phone, COALESCE(p_items, '[]'::jsonb), COALESCE(p_total, 0),
      lfh_next_counter('kot'))
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION lfh_platform_set_status(p_id UUID, p_status TEXT, p_by TEXT DEFAULT NULL)
RETURNS aggregator_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row aggregator_orders;
BEGIN
  UPDATE aggregator_orders
    SET status = p_status,
        status_history = COALESCE(status_history, '[]'::jsonb)
                         || jsonb_build_object('status', p_status, 'at', NOW(), 'by', p_by),
        accepted_at = CASE WHEN p_status = 'accepted' AND accepted_at IS NULL THEN NOW() ELSE accepted_at END,
        accepted_by = CASE WHEN p_status = 'accepted' AND accepted_by IS NULL THEN p_by ELSE accepted_by END,
        updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- 6. lock the new RPCs to service_role only (new functions are PUBLIC-executable by
--    default — staff-only RPCs must be revoked from anon, per the migration-038 gotcha)
REVOKE ALL ON FUNCTION lfh_platform_insert(TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_platform_insert(TEXT,TEXT,TEXT,TEXT,JSONB,NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION lfh_platform_set_status(UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_platform_set_status(UUID,TEXT,TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
