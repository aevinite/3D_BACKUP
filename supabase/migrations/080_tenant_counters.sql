-- 080_tenant_counters.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1a: make KOT / bill / invoice counters PER RESTAURANT, so each
-- restaurant has its own daily KOT #1, #2… and its own invoice sequence — they
-- never collide or interleave. restaurant_id was added to daily_counters /
-- seq_counters in 078 (default #1); here we fold it into the keys and thread it
-- through the counter functions + their 5 callers.
--
-- Still non-breaking for restaurant #1: every caller derives restaurant_id from
-- the row/arg it already has (defaulting to #1), so existing single-restaurant
-- ordering keeps producing the same numbers.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Counter tables keyed per restaurant ------------------------------------
ALTER TABLE daily_counters DROP CONSTRAINT IF EXISTS daily_counters_pkey;
ALTER TABLE daily_counters ADD  PRIMARY KEY (restaurant_id, key, day);

ALTER TABLE seq_counters DROP CONSTRAINT IF EXISTS seq_counters_pkey;
ALTER TABLE seq_counters ADD  PRIMARY KEY (restaurant_id, key);

-- 2) Counter functions gain a restaurant_id argument ------------------------
--    (keeps the 05:00 IST business-day rollover from migration 044)
CREATE OR REPLACE FUNCTION lfh_next_counter(p_rid uuid, p_key text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int; v_day date;
BEGIN
  v_day := ((now() AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date;
  INSERT INTO daily_counters(restaurant_id, key, day, n) VALUES (p_rid, p_key, v_day, 1)
    ON CONFLICT (restaurant_id, key, day) DO UPDATE SET n = daily_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;

CREATE OR REPLACE FUNCTION lfh_next_seq(p_rid uuid, p_key text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO seq_counters(restaurant_id, key, n) VALUES (p_rid, p_key, 1)
    ON CONFLICT (restaurant_id, key) DO UPDATE SET n = seq_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;

REVOKE EXECUTE ON FUNCTION lfh_next_counter(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_next_counter(uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_next_seq(uuid, text)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_next_seq(uuid, text)     TO service_role;

-- 3) Update every caller to pass its restaurant_id --------------------------
-- a) KOT on order insert (orders.restaurant_id is set by 078's default).
CREATE OR REPLACE FUNCTION lfh_assign_kot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kot_no IS NULL THEN
    NEW.kot_no := lfh_next_counter(
      COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'kot');
  END IF;
  RETURN NEW;
END; $$;

-- b) lfh_assign_bill (036) — its trigger was removed in 040, so this is dead
--    code, but we update it too so nothing references the dropped single-arg fn.
CREATE OR REPLACE FUNCTION lfh_assign_bill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bill_no IS NULL THEN
    NEW.bill_no := lfh_next_counter(
      COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'bill');
  END IF;
  RETURN NEW;
END; $$;

-- c) Lazy bill number on first order (the LIVE 051 version, with row lock).
CREATE OR REPLACE FUNCTION lfh_assign_bill_on_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_has int;
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    SELECT bill_no INTO v_has FROM sessions WHERE id = NEW.session_id FOR UPDATE;
    IF v_has IS NULL THEN
      UPDATE sessions
         SET bill_no = lfh_next_counter(
           COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'bill')
       WHERE id = NEW.session_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- d) Platform order insert (the LIVE 072 version) — gains a restaurant_id arg
--    (defaults to #1 so existing callers are unaffected) and stamps it on the row.
DROP FUNCTION IF EXISTS lfh_platform_insert(text, text, text, text, jsonb, numeric);
CREATE OR REPLACE FUNCTION lfh_platform_insert(
  p_source TEXT, p_external_id TEXT, p_customer TEXT, p_phone TEXT, p_items JSONB, p_total NUMERIC,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
) RETURNS aggregator_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row aggregator_orders;
BEGIN
  INSERT INTO aggregator_orders(restaurant_id, source, external_id, payload, status, status_history,
      customer_name, customer_phone, items, total, kot_no, accepted_at)
  VALUES (p_restaurant_id, p_source, p_external_id, '{}'::jsonb, 'accepted',
      jsonb_build_array(jsonb_build_object('status','accepted','at', NOW(), 'by','auto')),
      p_customer, p_phone, COALESCE(p_items, '[]'::jsonb), COALESCE(p_total, 0),
      lfh_next_counter(p_restaurant_id, 'kot'), NOW())
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE EXECUTE ON FUNCTION lfh_platform_insert(text,text,text,text,jsonb,numeric,uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_platform_insert(text,text,text,text,jsonb,numeric,uuid) TO service_role;

-- e) Invoice number (the LIVE 073 version) — scopes the forever-sequence per
--    restaurant via the session's restaurant_id.
CREATE OR REPLACE FUNCTION lfh_generate_invoice(p_session uuid)
RETURNS sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v sessions;
BEGIN
  SELECT * INTO v FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;
  IF v.invoice_no IS NULL OR v.invoice_voided THEN
    UPDATE sessions
       SET invoice_no = lfh_next_seq(
             COALESCE(v.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid), 'invoice'),
           invoice_at = NOW(), invoice_voided = false, void_reason = NULL, void_at = NULL
     WHERE id = p_session
     RETURNING * INTO v;
  END IF;
  RETURN v;
END $$;

-- 4) Remove the old single-arg counter functions (nothing references them now).
DROP FUNCTION IF EXISTS lfh_next_counter(text);
DROP FUNCTION IF EXISTS lfh_next_seq(text);

NOTIFY pgrst, 'reload schema';

-- ⚠️ RUN-ALONE GUARD (added by the 2026-08-21 migrations-001-118 sweep, T21).
-- `lfh_assign_bill()` above is RETIRED — migration 267 dropped it as dead code. Its trigger
-- (`trg_assign_bill`) had already gone in migration 040, which moved the bill number to a table's
-- FIRST ORDER instead of the moment it is opened; this file only re-creates the function body, so
-- running it alone leaves a dead function rather than changed behaviour. Removed anyway, so the
-- state after a single run matches the state after a full re-seed. Idempotent.
DROP FUNCTION IF EXISTS lfh_assign_bill();
