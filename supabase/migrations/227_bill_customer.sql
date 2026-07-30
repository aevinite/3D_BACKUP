-- ============================================================================
-- 227_bill_customer.sql — the bill is made out to a named customer
--
-- Owner, 2026-07-30: "bill can't be generated without name and phone number."
-- The waiter is asked for the MOBILE first; typing it searches the restaurant's own
-- customer list and auto-fills the name if that number has been here before, else it
-- says "new customer" and the name is typed once. Both are then part of that bill
-- forever, and whether they PRINT on the paper is a separate per-restaurant switch
-- the admin controls.
--
-- All additive (live-site safety): new nullable columns + two new functions. Nothing
-- existing changes behaviour until the app starts sending the values.
--
-- DPDP note: these rows are the transaction record for an invoice, so they are stored
-- with consent = false (unchanged default) — the guest-facing greeting path
-- (lfh_greet_device) only ever reads CONSENTED rows, so a number captured at the till
-- is never used to greet or market to anyone. It only serves staff at the till.
-- ============================================================================

-- ── 1. the bill's own copy of who it was made out to ────────────────────────
-- Kept ON THE SESSION (not derived from the customers directory) so that editing or
-- deleting a customer later can never rewrite an issued invoice.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS cust_name  TEXT,
  ADD COLUMN IF NOT EXISTS cust_phone TEXT;

-- ── 2. the two per-restaurant switches ─────────────────────────────────────
-- required: no invoice without a name + mobile (the owner's rule, on by default).
-- print:    whether those two lines appear on the printed bill (admin's switch).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS bill_customer_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bill_customer_print    BOOLEAN NOT NULL DEFAULT true;

-- ── 2b. ONE spelling of a phone number ─────────────────────────────────────
-- "+91 98250 12345", "098250 12345" and "9825012345" are the same person. Without this
-- they became three customers and the name never auto-filled (caught in testing).
-- Only a recognised Indian prefix is stripped — anything else is kept exactly as typed,
-- so a foreign number is never mangled.
CREATE OR REPLACE FUNCTION lfh_phone10(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH d AS (SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') AS x)
  SELECT CASE
           WHEN length(x) = 10                          THEN x
           WHEN length(x) = 12 AND left(x, 2) = '91'    THEN right(x, 10)
           WHEN length(x) = 11 AND left(x, 1) = '0'     THEN right(x, 10)
           WHEN length(x) = 13 AND left(x, 3) = '091'   THEN right(x, 10)
           ELSE NULLIF(x, '')
         END
    FROM d;
$$;
GRANT EXECUTE ON FUNCTION lfh_phone10(text) TO service_role;

-- ── 3. make the "type a number, get the name" search instant ────────────────
-- text_pattern_ops lets `phone LIKE '98250%'` use the index instead of scanning the
-- table — this is the query a waiter fires on every keystroke during a rush.
CREATE INDEX IF NOT EXISTS idx_customers_phone_prefix
  ON customers (restaurant_id, phone text_pattern_ops);

-- ── 4. prefix search — "who is 98250…?" ────────────────────────────────────
-- Scoped to ONE restaurant, prefix-anchored, hard-limited. Returns the smallest
-- possible payload (number, name, visit count) so it stays cheap on every keystroke.
DROP FUNCTION IF EXISTS lfh_customer_phone_search(uuid, text, integer);
CREATE OR REPLACE FUNCTION lfh_customer_phone_search(
  p_restaurant_id uuid,
  p_prefix        text,
  p_limit         integer DEFAULT 6
)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- a partial number is searched as typed (digits only); a COMPLETE one is normalised
  -- first, so "+91 98250 12345" finds the row stored as "9825012345".
  WITH q AS (SELECT COALESCE(lfh_phone10(p_prefix),
                             NULLIF(regexp_replace(COALESCE(p_prefix,''), '[^0-9]', '', 'g'), '')) AS pfx)
  SELECT COALESCE(json_agg(json_build_object(
           'phone', c.phone, 'name', c.name, 'visits', c.visits, 'blocked', c.blocked)
         ORDER BY c.last_seen_at DESC), '[]'::json)
    FROM customers c, q
   WHERE q.pfx IS NOT NULL
     AND length(q.pfx) >= 3
     AND c.restaurant_id = p_restaurant_id
     AND c.phone LIKE q.pfx || '%'
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 20));
$$;

-- ── 5. save the bill's customer (one call, idempotent) ──────────────────────
-- Writes the pair onto the session, upserts the directory row (so the NEXT bill for
-- that number auto-fills the name), and records ONE visit per bill — customer_visits
-- has session_id UNIQUE, so calling this twice for the same bill cannot double-count.
-- Tenant-scoped: the session must belong to p_restaurant_id or nothing is written.
DROP FUNCTION IF EXISTS lfh_bill_customer_save(uuid, uuid, text, text);
CREATE OR REPLACE FUNCTION lfh_bill_customer_save(
  p_restaurant_id uuid,
  p_session       uuid,
  p_phone         text,
  p_name          text
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text := lfh_phone10(p_phone);
  v_name  text := NULLIF(trim(COALESCE(p_name,'')), '');
  v_ok    boolean;
  v_visits integer;
  v_prev  text;
BEGIN
  IF v_phone IS NULL OR v_name IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'name_and_phone_required');
  END IF;

  UPDATE sessions SET cust_name = v_name, cust_phone = v_phone
   WHERE id = p_session AND restaurant_id = p_restaurant_id;
  v_ok := FOUND;
  IF NOT v_ok THEN
    RETURN json_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  -- directory row: keep the newest name the till was given, bump last seen
  INSERT INTO customers (phone, name, restaurant_id, last_seen_at)
       VALUES (v_phone, v_name, p_restaurant_id, NOW())
  ON CONFLICT (restaurant_id, phone) DO UPDATE
     SET name = COALESCE(EXCLUDED.name, customers.name),
         last_seen_at = NOW();

  -- One visit per bill. If the waiter CORRECTS the number on the same bill, the visit
  -- moves to the right person instead of being credited to the mistyped one (the old
  -- version silently left it behind — caught in testing).
  SELECT phone INTO v_prev FROM customer_visits WHERE session_id = p_session;
  IF v_prev IS NULL THEN
    INSERT INTO customer_visits (restaurant_id, phone, session_id)
         VALUES (p_restaurant_id, v_phone, p_session);
    UPDATE customers SET visits = visits + 1
     WHERE restaurant_id = p_restaurant_id AND phone = v_phone;
  ELSIF v_prev <> v_phone THEN
    UPDATE customer_visits SET phone = v_phone, at = NOW() WHERE session_id = p_session;
    UPDATE customers SET visits = GREATEST(0, visits - 1)
     WHERE restaurant_id = p_restaurant_id AND phone = v_prev;
    UPDATE customers SET visits = visits + 1
     WHERE restaurant_id = p_restaurant_id AND phone = v_phone;
  END IF;

  SELECT visits INTO v_visits FROM customers
   WHERE restaurant_id = p_restaurant_id AND phone = v_phone;

  RETURN json_build_object('ok', true, 'phone', v_phone, 'name', v_name, 'visits', COALESCE(v_visits, 1));
END $$;

-- staff-only (migration-038 gotcha: new functions are PUBLIC-executable by default)
REVOKE ALL ON FUNCTION lfh_customer_phone_search(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_customer_phone_search(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION lfh_bill_customer_save(uuid, uuid, text, text)   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_bill_customer_save(uuid, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
