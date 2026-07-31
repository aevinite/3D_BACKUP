-- ============================================================================
-- 237_banquet_bill.sql — the banquet bill becomes a real, printable bill
--
-- Owner, 2026-07-31 (from Aangan's own paper: an A5 pre-printed pad + their old
-- POS's "BANQUET BILLING INFORMATION" screen). Three owner rules shape this:
--
--   1. "only ask for what's necessary" — the bill screen is built from a list the
--      ADMIN ticks per restaurant (settings.banquet_fields). An unticked field is
--      absent from the screen AND from the paper: no empty boxes.
--   2. "totally another bill no sequence … the restaurant could change the bill no
--      so I don't get any trouble, otherwise all locked + auto-fill" — banquet bills
--      carry their OWN series (prefix + style + counter) which the restaurant sets up
--      while no banquet bill exists yet; after that the counter is server-owned and
--      no client can send, skip or reuse a number.
--   3. "plain paper by default, Aangan on the pre-printed pad" — paper is a
--      per-restaurant setting, defaulting to plain (the app prints its own header).
--
-- Money keeps riding the EXISTING order pipeline (mig 130/132: server-priced order
-- at status 'served', no kitchen ticket) so Bills, the day-book, the GST report and
-- the audit log all keep working with no changes. banquet_bills only adds the
-- paperwork around that sale, plus the frozen totals that were actually PRINTED.
-- Nothing here can hide a sale: a wrong bill is voided through the existing Bills
-- flow (migs 188/189/190), which keeps the row and the audit trail.
--
-- All additive: new columns (with defaults), one new table, new functions.
-- ============================================================================

-- ── 1. per-restaurant configuration ─────────────────────────────────────────
-- banquet_fields: which boxes this restaurant is asked for. The keys are the same
-- on the server, the manager panel and the admin panel (lib/banquetFields.ts).
-- Default = the smallest set that still makes a lawful bill.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS banquet_fields      jsonb   NOT NULL DEFAULT '["cust_name","cust_phone","dish","pax","rate","advance"]'::jsonb,
  -- the banquet series
  ADD COLUMN IF NOT EXISTS banquet_bill_prefix text    NOT NULL DEFAULT 'BQB',
  ADD COLUMN IF NOT EXISTS banquet_bill_style  text    NOT NULL DEFAULT 'fy',
  ADD COLUMN IF NOT EXISTS banquet_bill_next   int     NOT NULL DEFAULT 1,
  -- the paper
  ADD COLUMN IF NOT EXISTS banquet_paper       text    NOT NULL DEFAULT 'plain',
  ADD COLUMN IF NOT EXISTS banquet_paper_size  text    NOT NULL DEFAULT 'a5',
  ADD COLUMN IF NOT EXISTS banquet_paper_top   int     NOT NULL DEFAULT 33,
  ADD COLUMN IF NOT EXISTS banquet_paper_bot   int     NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS banquet_paper_side  int     NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS banquet_paper_foot  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banquet_paper_sign  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS banquet_paper_fill  boolean NOT NULL DEFAULT true;

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_banquet_bill_style_chk;
ALTER TABLE settings ADD CONSTRAINT settings_banquet_bill_style_chk
  CHECK (banquet_bill_style IN ('fy','date','plain'));
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_banquet_paper_chk;
ALTER TABLE settings ADD CONSTRAINT settings_banquet_paper_chk
  CHECK (banquet_paper IN ('plain','pad') AND banquet_paper_size IN ('a4','a5')
         AND banquet_paper_top BETWEEN 0 AND 80 AND banquet_paper_bot BETWEEN 0 AND 50
         AND banquet_paper_side BETWEEN 2 AND 25);
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_banquet_bill_next_chk;
ALTER TABLE settings ADD CONSTRAINT settings_banquet_bill_next_chk
  CHECK (banquet_bill_next BETWEEN 1 AND 99999999);

-- ── 2. the bill's own paperwork ─────────────────────────────────────────────
-- One row per issued banquet bill. The MONEY is on orders (order_id); the totals
-- here are a frozen copy of what the paper said, so a re-print years later prints
-- the same figures even if a tax rate changes.
CREATE TABLE IF NOT EXISTS banquet_bills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_id      uuid REFERENCES orders(id) ON DELETE SET NULL,
  session_id    uuid REFERENCES sessions(id) ON DELETE SET NULL,
  bill_seq      int  NOT NULL,
  bill_no       text NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  -- what was printed (frozen)
  subtotal      numeric NOT NULL DEFAULT 0,
  tax           numeric NOT NULL DEFAULT 0,
  total         numeric NOT NULL DEFAULT 0,
  received      numeric NOT NULL DEFAULT 0,      -- sum of `advances`, kept for cheap list reads
  advances      jsonb   NOT NULL DEFAULT '[]'::jsonb,  -- [{date,mode,ref,amt}]
  -- the function
  hall          text, func text, fn_date date, fn_from text, fn_to text,
  pax           int,  rate numeric,
  -- who it is made out to
  cust_name     text, cust_phone text, cust_gstin text, cust_addr text, cust_person text,
  remark        text, prepared_by text, table_number text,
  -- a wrong bill is voided, never deleted (the row and its number stay)
  voided_at     timestamptz, void_reason text, voided_by text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, bill_seq)
);
-- discount actually given (rupees, already applied to `total`). Stored so a re-print
-- shows the same figures; the SALE-side copy lives on orders.discount, which every
-- money view in the app already reads with the discount-BEFORE-tax rule (mig 143).
ALTER TABLE banquet_bills ADD COLUMN IF NOT EXISTS discount numeric NOT NULL DEFAULT 0;
-- the two reads this table gets: the Banquet list (newest first) and "which bill is
-- this order?" when the Bills tab labels a banquet row.
CREATE INDEX IF NOT EXISTS banquet_bills_rid_issued_idx ON banquet_bills(restaurant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS banquet_bills_order_idx      ON banquet_bills(order_id);
CREATE INDEX IF NOT EXISTS banquet_bills_phone_idx      ON banquet_bills(restaurant_id, cust_phone);

-- Staff-only data: RLS on with no anon/authenticated policy = only our service-role
-- routes can read or write it (same shape as banquet_items, mig 130).
ALTER TABLE banquet_bills ENABLE ROW LEVEL SECURITY;

-- ── 3. render a bill number ─────────────────────────────────────────────────
-- Three styles, because a restaurant's accountant may already file one of them:
--   fy     BQB/2026-27/000006   (a running year series — the default)
--   date   BQB-140826-6         (their old POS's shape)
--   plain  BQB-000006
CREATE OR REPLACE FUNCTION lfh_banquet_bill_no(p_prefix text, p_style text, p_seq int, p_when timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE COALESCE(p_style, 'fy')
    WHEN 'date'  THEN upper(COALESCE(NULLIF(p_prefix,''),'BQB')) || '-' || to_char(p_when, 'DDMMYY') || '-' || p_seq::text
    WHEN 'plain' THEN upper(COALESCE(NULLIF(p_prefix,''),'BQB')) || '-' || lpad(p_seq::text, 6, '0')
    ELSE upper(COALESCE(NULLIF(p_prefix,''),'BQB')) || '/' ||
         CASE WHEN EXTRACT(MONTH FROM p_when) >= 4
              THEN EXTRACT(YEAR FROM p_when)::int::text || '-' || right((EXTRACT(YEAR FROM p_when)::int + 1)::text, 2)
              ELSE (EXTRACT(YEAR FROM p_when)::int - 1)::text || '-' || right(EXTRACT(YEAR FROM p_when)::int::text, 2)
         END || '/' || lpad(p_seq::text, 6, '0')
  END;
$$;

-- ── 4. issue a banquet bill ─────────────────────────────────────────────────
-- Prices from banquet_items (never from the client), lands the sale as a normal
-- order at 'served' exactly like mig 130/132, takes the next number from the
-- restaurant's own counter under a row lock, and writes the paperwork.
--
-- p_lines : [{ id, qty, price? }]  — price is honoured ONLY for an open-price
--           banquet item (its stored price is 0), the same rule as open-price
--           dishes (mig 215). Anything else is priced from the DB.
-- p_meta  : { hall, func, fn_date, fn_from, fn_to, pax, rate, cust_name,
--             cust_phone, cust_gstin, cust_addr, cust_person, remark,
--             prepared_by, advances:[{date,mode,ref,amt}] }
--           Only the keys the restaurant is allowed (settings.banquet_fields) are
--           kept — a forged client cannot smuggle a field the admin switched off.
CREATE OR REPLACE FUNCTION lfh_banquet_bill_create(
  p_lines jsonb,
  p_meta  jsonb DEFAULT '{}'::jsonb,
  p_table text DEFAULT NULL,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
  p_by    text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rid    uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_set    settings;
  v_table  text := NULLIF(trim(COALESCE(p_table, '')), '');
  v_fields jsonb;
  v_ok     boolean;
  v_in     jsonb; v_bi banquet_items;
  v_qty    int; v_unit numeric; v_pct numeric; v_gross numeric;
  v_items  jsonb := '[]'::jsonb;
  v_sub    numeric := 0; v_disc numeric := 0; v_rate numeric; v_tax numeric; v_total numeric;
  v_s      sessions; v_order uuid; v_kot int;
  v_seq    int; v_no text; v_now timestamptz := now();
  v_adv    jsonb := '[]'::jsonb; v_recv numeric := 0; v_a jsonb;
  v_bill   uuid;
BEGIN
  SELECT * INTO v_set FROM settings WHERE restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  IF NOT COALESCE(v_set.banquet_allowed, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  v_fields := COALESCE(v_set.banquet_fields, '[]'::jsonb);

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'empty_order');
  END IF;
  IF v_table IS NOT NULL AND v_table !~ '^\d+$' THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_table');
  END IF;

  -- price every line on the server
  FOR v_in IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_bi FROM banquet_items
      WHERE id = (v_in->>'id')::uuid AND restaurant_id = v_rid AND active;
    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;
    v_qty := GREATEST(1, LEAST(5000, COALESCE(NULLIF(v_in->>'qty','')::int, 1)));
    -- open-price banquet item (stored price 0): the typed price is used, clamped.
    v_unit := CASE WHEN COALESCE(v_bi.price, 0) = 0 AND (v_in ? 'price')
                   THEN GREATEST(0, LEAST(10000000, round(COALESCE(NULLIF(v_in->>'price','')::numeric, 0), 2)))
                   ELSE round(v_bi.price, 2) END;
    v_gross := v_unit * v_qty;
    v_sub := v_sub + v_gross;
    -- a per-line % discount, but ONLY when this restaurant is allowed to discount at
    -- all (settings.banquet_fields). It becomes rupees on orders.discount below, so the
    -- discount-BEFORE-tax rule and every existing money view stay correct (mig 143).
    IF v_fields ? 'disc' THEN
      v_pct := GREATEST(0, LEAST(100, COALESCE(NULLIF(v_in->>'disc','')::numeric, 0)));
      v_disc := v_disc + round(v_gross * v_pct / 100, 2);
    END IF;
    v_items := v_items || jsonb_build_object(
      'id', v_bi.id,
      'title', v_bi.title || CASE WHEN COALESCE(v_bi.unit,'') <> '' THEN ' (' || v_bi.unit || ')' ELSE '' END,
      'price', to_char(v_unit, 'FM999999990.00'),
      'qty', v_qty, 'options', NULL, 'removed', '[]'::jsonb, 'note', NULL);
  END LOOP;

  v_rate  := lfh_effective_tax_rate(v_rid);
  v_disc  := LEAST(v_disc, v_sub);                 -- can never exceed the bill
  v_tax   := round((v_sub - v_disc) * v_rate, 2);  -- discount BEFORE tax (house rule)
  v_total := v_sub - v_disc + v_tax;

  -- the sale: a normal order, straight to 'served' (never a kitchen ticket)
  IF v_table IS NOT NULL THEN
    SELECT * INTO v_s FROM sessions
      WHERE table_number = v_table AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_s.id IS NULL THEN
      INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
        VALUES (v_table, 'open', 'waiter', v_now, v_rid) RETURNING * INTO v_s;
    END IF;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, discount, discount_note,
                     allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_table, v_items, v_sub, v_tax, v_total, v_disc,
            CASE WHEN v_disc > 0 THEN 'banquet bill discount' END,
            '{}', 'served', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_in IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order, v_s.id, v_in->>'title', (v_in->>'qty')::int, (v_in->>'price')::numeric,
              NULL, '{}', NULL, 'served', v_rid);
  END LOOP;
  IF v_s.id IS NOT NULL THEN
    UPDATE sessions SET last_activity_at = v_now WHERE id = v_s.id;
  END IF;

  -- the number: server-owned counter, taken under the settings row lock above so
  -- two tills can never print the same bill number.
  v_seq := GREATEST(COALESCE(v_set.banquet_bill_next, 1), 1);
  UPDATE settings SET banquet_bill_next = v_seq + 1 WHERE restaurant_id = v_rid;
  v_no := lfh_banquet_bill_no(v_set.banquet_bill_prefix, v_set.banquet_bill_style, v_seq, v_now);

  -- advances (only when this restaurant fills them)
  IF (v_fields ? 'advance') OR (v_fields ? 'paysplit') THEN
    FOR v_a IN SELECT * FROM jsonb_array_elements(COALESCE(p_meta->'advances', '[]'::jsonb)) LOOP
      IF COALESCE(NULLIF(v_a->>'amt','')::numeric, 0) > 0 THEN
        v_adv  := v_adv || jsonb_build_object(
          'date', COALESCE(NULLIF(v_a->>'date',''), to_char(v_now, 'YYYY-MM-DD')),
          'mode', left(COALESCE(NULLIF(v_a->>'mode',''), 'Cash'), 20),
          'ref',  left(COALESCE(v_a->>'ref',''), 60),
          'amt',  round((v_a->>'amt')::numeric, 2));
        v_recv := v_recv + round((v_a->>'amt')::numeric, 2);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO banquet_bills(
    restaurant_id, order_id, session_id, bill_seq, bill_no, issued_at,
    subtotal, tax, total, discount, received, advances,
    hall, func, fn_date, fn_from, fn_to, pax, rate,
    cust_name, cust_phone, cust_gstin, cust_addr, cust_person,
    remark, prepared_by, table_number, created_by)
  VALUES (
    v_rid, v_order, v_s.id, v_seq, v_no, v_now,
    v_sub, v_tax, v_total, v_disc, v_recv, v_adv,
    CASE WHEN v_fields ? 'hall'    THEN left(NULLIF(p_meta->>'hall',''), 60) END,
    CASE WHEN v_fields ? 'func'    THEN left(NULLIF(p_meta->>'func',''), 60) END,
    CASE WHEN v_fields ? 'fndate'  THEN NULLIF(p_meta->>'fn_date','')::date END,
    CASE WHEN v_fields ? 'fndate'  THEN left(NULLIF(p_meta->>'fn_from',''), 10) END,
    CASE WHEN v_fields ? 'fndate'  THEN left(NULLIF(p_meta->>'fn_to',''), 10) END,
    CASE WHEN v_fields ? 'pax'     THEN NULLIF(p_meta->>'pax','')::int END,
    CASE WHEN v_fields ? 'rate'    THEN NULLIF(p_meta->>'rate','')::numeric END,
    CASE WHEN v_fields ? 'cust_name'  THEN left(NULLIF(p_meta->>'cust_name',''), 120) END,
    CASE WHEN v_fields ? 'cust_phone' THEN left(NULLIF(regexp_replace(COALESCE(p_meta->>'cust_phone',''), '[^0-9+]', '', 'g'), ''), 15) END,
    CASE WHEN v_fields ? 'gstin'   THEN upper(left(NULLIF(p_meta->>'cust_gstin',''), 20)) END,
    CASE WHEN v_fields ? 'address' THEN left(NULLIF(p_meta->>'cust_addr',''), 300) END,
    CASE WHEN v_fields ? 'person'  THEN left(NULLIF(p_meta->>'cust_person',''), 80) END,
    CASE WHEN v_fields ? 'remark'  THEN left(NULLIF(p_meta->>'remark',''), 300) END,
    left(NULLIF(COALESCE(p_meta->>'prepared_by', p_by), ''), 80),
    v_table, left(COALESCE(p_by, ''), 80))
  RETURNING id INTO v_bill;

  -- remember the customer for next time (the same directory the dine-in bill uses)
  IF (v_fields ? 'cust_phone') AND lfh_phone10(p_meta->>'cust_phone') IS NOT NULL THEN
    INSERT INTO customers(phone, name, restaurant_id, first_seen_at, last_seen_at)
      VALUES (lfh_phone10(p_meta->>'cust_phone'),
              NULLIF(left(COALESCE(p_meta->>'cust_name',''), 120), ''), v_rid, v_now, v_now)
    ON CONFLICT (restaurant_id, phone) DO UPDATE
      SET name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
          last_seen_at = v_now;
  END IF;

  RETURN json_build_object('ok', true, 'bill_id', v_bill, 'bill_no', v_no, 'bill_seq', v_seq,
                           'order_id', v_order, 'kot_no', v_kot, 'table', v_table,
                           'subtotal', v_sub, 'tax', v_tax, 'total', v_total,
                           'discount', v_disc, 'received', v_recv);
END; $$;

REVOKE EXECUTE ON FUNCTION lfh_banquet_bill_create(jsonb, jsonb, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_bill_create(jsonb, jsonb, text, uuid, text) TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_banquet_bill_no(text, text, int, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_bill_no(text, text, int, timestamptz) TO service_role;

-- ── 5. the old entry point keeps working, and now gets a number too ─────────
-- The waiter tablet's one-tap banquet bill (mig 130/132) called this. It now goes
-- through the same code, so EVERY banquet bill — tablet or manager — is numbered
-- and appears in the Banquet list.
CREATE OR REPLACE FUNCTION lfh_banquet_place_order(
  p_table text, p_lines jsonb,
  p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r json;
BEGIN
  v_r := lfh_banquet_bill_create(p_lines, '{}'::jsonb, p_table, p_restaurant_id, 'waiter');
  RETURN v_r;
END; $$;
REVOKE EXECUTE ON FUNCTION lfh_banquet_place_order(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_banquet_place_order(text, jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
