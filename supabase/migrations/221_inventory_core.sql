-- 221_inventory_core.sql — INVENTORY MANAGEMENT + EXPENSE BOOK (Stage 1 foundation)
-- ═════════════════════════════════════════════════════════════════════════════
-- Owner ask (2026-07-29): full inventory management built from the 13-product research
-- in docs/research/pos-inventory/ (00-MASTER-SYNTHESIS.md), PLUS a full expense book
-- inside it (broken lamp → manager records it → owner sees the entry and the monthly
-- total in his reports). Staged rollout approved: this migration is Stage 1 — the
-- stock register (items, vendors, purchases/GRN, movement ledger, counts, waste) and
-- the expense book. Recipes + KOT-fire auto-deduction + variance are Stage 2 and only
-- ADD tables later; nothing here needs rework for them.
--
-- Design decisions carried in from the research (do not re-litigate casually):
--   • THREE UoMs per ingredient (purchase / stock / recipe), never one column. Stage 1
--     stores purchase→base and recipe→base factors on the item; balances live in the
--     smallest BASE unit at high precision, rounding only at render.
--   • Valuation = WEIGHTED AVERAGE COST, perpetual. LIFO is illegal in India (Ind AS 2 /
--     AS 2 / ICDS II); FIFO cost-lots are Stage-3-optional. last_rate is kept SEPARATELY
--     for pricing screens only — it does not conserve value.
--   • The movement LEDGER is append-only and idempotent: every row carries a caller-built
--     dedupe_key with a UNIQUE index, so an offline replay / double-tap / KOT reprint
--     (Stage 2) can never deduct twice. The DATABASE guarantees once-only, not the app.
--   • Balances are MATERIALISED on inv_items (qty_base, avg_cost) and updated in the same
--     transaction as the movement insert — reports never SUM the ledger (egress rule).
--   • Negative stock is ALLOWED (a negative is almost always an un-entered purchase, and
--     blocking pushes staff off-system) but the WAC engine clamps while qty ≤ 0 and the
--     negative list is a first-class hygiene report.
--   • Nothing is ever deleted or edited in place: purchases and expenses are VOIDED with
--     a reason (struck through, still visible), waste/count corrections post reversing
--     movements. Same discipline as bills — docs/COMPLIANCE-GUARDRAILS.md.
--
-- Contents
--   A. inv_items          — the ingredient/consumable master (+ materialised balance)
--   B. inv_vendors        — supplier book
--   C. inv_purchases      — purchase bills incl. the 60-second CASH / no-bill entry (+lines)
--   D. inv_movements      — the append-only, idempotent stock ledger
--   E. inv_counts         — physical count sheets (blind, resumable) (+lines)
--   F. inv_waste_entries  — waste log with reason codes + photo
--   G. expenses           — the EXPENSE BOOK (breakage, repair, utilities… broken lamp)
--   H. settings           — inventory_allowed / _owner_control / _enabled (module ladder)
--   I. lfh_inv_post_movement() — the one write path: idempotent ledger insert + WAC update
--   J. read RPC lfh_inv_stock_summary() — the owner-report aggregate (snapshot-cache fed)
--
-- LIVE-SAFE: additive only. New tables + three settings columns defaulting OFF, so no
-- restaurant sees anything until the admin flips the module on.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── A. inv_items: the ingredient master ──────────────────────────────────────
-- track_level (research: "a tracking level per ingredient, not a boolean"):
--   FULL       — counted + valued + (Stage 2) recipe-depleted
--   COUNT_ONLY — counted + valued, never recipe'd (C-class: salt, foil)
--   EXPENSE    — never stocked; buying it posts spend only (cleaning fluid, matchboxes)
-- base_uom is IMMUTABLE in practice once movements exist (enforced in the API, not here,
-- so a typo made before first use stays fixable).
CREATE TABLE IF NOT EXISTS inv_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  category         text NOT NULL DEFAULT 'general',      -- veg, dairy, meat, dry, bar, packaging…
  storage_area     text,                                  -- walk-in / dry store / bar — count-sheet ordering
  track_level      text NOT NULL DEFAULT 'FULL' CHECK (track_level IN ('FULL','COUNT_ONLY','EXPENSE')),
  -- the three units (research rule #1): balances live in base_uom; purchases are typed in
  -- purchase_uom and converted by purchase_factor (1 purchase_uom = purchase_factor base).
  -- recipe_uom/_factor sit ready for Stage 2 (NULL = recipes use base directly).
  base_uom         text NOT NULL DEFAULT 'g',             -- g | ml | pc (smallest unit, high precision)
  purchase_uom     text NOT NULL DEFAULT 'kg',
  purchase_factor  numeric(14,4) NOT NULL DEFAULT 1000 CHECK (purchase_factor > 0),
  recipe_uom       text,
  recipe_factor    numeric(14,4) CHECK (recipe_factor IS NULL OR recipe_factor > 0),
  -- ordering levels, in BASE units. par drives the "what to order today" list (the hook).
  par_qty          numeric(14,3),
  min_qty          numeric(14,3),
  -- the materialised balance + costing state (updated ONLY by lfh_inv_post_movement)
  qty_base         numeric(16,4) NOT NULL DEFAULT 0,
  avg_cost         numeric(14,6) NOT NULL DEFAULT 0,      -- ₹ per BASE unit, weighted average
  last_rate        numeric(12,2),                         -- ₹ per PURCHASE unit, display/pricing only
  default_vendor_id uuid,
  barcode          text,
  active           boolean NOT NULL DEFAULT true,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- The stock list is ALWAYS "this restaurant's active items"; low-stock filters by par.
CREATE INDEX IF NOT EXISTS idx_inv_items_rest ON inv_items (restaurant_id, active, category, name);
-- One live item per name per restaurant (case-insensitive) — stops the duplicate-item rot
-- that MarketMan ships merge tooling to undo. Renaming an inactive duplicate stays allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_items_rest_name
  ON inv_items (restaurant_id, lower(name)) WHERE active;
ALTER TABLE inv_items ENABLE ROW LEVEL SECURITY;

-- ── B. inv_vendors: the supplier book ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inv_vendors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  phone          text,
  gstin          text,
  note           text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_vendors_rest ON inv_vendors (restaurant_id, active, name);
ALTER TABLE inv_vendors ENABLE ROW LEVEL SECURITY;

-- ── C. inv_purchases: purchase bills + the cash/no-bill market entry ─────────
-- kind='cash' is the India-specific 60-second mandi purchase the research found NO
-- product ships: vendor optional, bill number optional, a photo of the handwritten
-- slip attached. kind='bill' is a normal vendor bill. Voiding keeps the row (struck
-- through) and posts REVERSING movements — never a delete.
CREATE TABLE IF NOT EXISTS inv_purchases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill','cash')),
  vendor_id      uuid REFERENCES inv_vendors(id),
  vendor_name    text,                                    -- denormalised label; survives vendor edits
  bill_no        text,
  bill_date      date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  photo_url      text,                                    -- the bill / handwritten slip photo
  subtotal       numeric(12,2) NOT NULL DEFAULT 0,
  tax            numeric(12,2) NOT NULL DEFAULT 0,
  total          numeric(12,2) NOT NULL DEFAULT 0,
  note           text,
  created_by     text,
  created_by_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz,
  void_reason    text,
  voided_by      text
);
CREATE INDEX IF NOT EXISTS idx_inv_purchases_rest_date
  ON inv_purchases (restaurant_id, bill_date DESC) WHERE voided_at IS NULL;
ALTER TABLE inv_purchases ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS inv_purchase_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id    uuid NOT NULL REFERENCES inv_purchases(id) ON DELETE CASCADE,
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES inv_items(id),
  qty_purchase   numeric(14,3) NOT NULL CHECK (qty_purchase > 0),  -- in the item's purchase_uom
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base > 0),      -- converted at entry time
  rate           numeric(12,2) NOT NULL DEFAULT 0,                 -- ₹ per purchase_uom
  amount         numeric(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inv_purchase_lines_purchase ON inv_purchase_lines (purchase_id);
CREATE INDEX IF NOT EXISTS idx_inv_purchase_lines_item
  ON inv_purchase_lines (restaurant_id, item_id);                  -- price-history per item
ALTER TABLE inv_purchase_lines ENABLE ROW LEVEL SECURITY;

-- ── D. inv_movements: the append-only stock ledger ───────────────────────────
-- EVERY stock change flows through here via lfh_inv_post_movement() — purchases in,
-- waste out, count corrections, voids (as reversals), and Stage 2's KOT-fire
-- consumption. qty_base is signed (+in / −out). Rows are immutable; there is no
-- UPDATE path anywhere.
CREATE TABLE IF NOT EXISTS inv_movements (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES inv_items(id),
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base <> 0),
  kind           text NOT NULL CHECK (kind IN (
                   'opening','purchase','purchase_void','count_adjust','waste','waste_void',
                   'consumption','consumption_reversal','adjustment','transfer_in','transfer_out',
                   'production')),
  reason         text,                                   -- waste reason code / free note
  ref_type       text,                                   -- 'purchase' | 'count' | 'waste' | 'order' …
  ref_id         text,                                   -- the document row this came from
  unit_cost      numeric(14,6) NOT NULL DEFAULT 0,       -- ₹/base at the moment of the movement
  dedupe_key     text NOT NULL,                          -- caller-built; UNIQUE = once-only forever
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_movements_dedupe ON inv_movements (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_inv_movements_rest_item
  ON inv_movements (restaurant_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_rest_kind
  ON inv_movements (restaurant_id, kind, created_at DESC);
ALTER TABLE inv_movements ENABLE ROW LEVEL SECURITY;

-- ── E. inv_counts: physical count sheets ─────────────────────────────────────
-- A count is a resumable DOCUMENT (draft → submitted), blind by default (the counter
-- types what they see; the variance appears after submit). Submitting posts one
-- count_adjust movement per line via lfh_inv_post_movement, keyed on (count, item),
-- so a double-submit is physically impossible.
CREATE TABLE IF NOT EXISTS inv_counts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','discarded')),
  count_date     date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  note           text,
  created_by     text,
  created_by_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  submitted_by   text
);
CREATE INDEX IF NOT EXISTS idx_inv_counts_rest ON inv_counts (restaurant_id, status, count_date DESC);
ALTER TABLE inv_counts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS inv_count_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id       uuid NOT NULL REFERENCES inv_counts(id) ON DELETE CASCADE,
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES inv_items(id),
  counted_base   numeric(16,4) NOT NULL CHECK (counted_base >= 0),
  system_base    numeric(16,4) NOT NULL DEFAULT 0,       -- snapshot at line-save (the "expected")
  unit_cost_snap numeric(14,6) NOT NULL DEFAULT 0,       -- cost frozen at count time (research rule #4)
  UNIQUE (count_id, item_id)                             -- one line per item per sheet; re-save replaces
);
CREATE INDEX IF NOT EXISTS idx_inv_count_lines_count ON inv_count_lines (count_id);
ALTER TABLE inv_count_lines ENABLE ROW LEVEL SECURITY;

-- ── F. inv_waste_entries: the waste log ──────────────────────────────────────
-- Waste is what makes variance honest (Stage 2) and it is money leaving TODAY, so it
-- carries the cost snapshot. Reason list is deliberately small (big buttons on a phone).
-- Wrong entry → void with a reason (posts a reversing movement); never delete.
CREATE TABLE IF NOT EXISTS inv_waste_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES inv_items(id),
  qty_base       numeric(16,4) NOT NULL CHECK (qty_base > 0),
  reason         text NOT NULL CHECK (reason IN ('spoiled','burnt','spilled','expired','staff_meal','complimentary','other')),
  note           text,
  photo_url      text,
  unit_cost_snap numeric(14,6) NOT NULL DEFAULT 0,
  waste_date     date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  created_by     text,
  created_by_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz,
  void_reason    text,
  voided_by      text
);
CREATE INDEX IF NOT EXISTS idx_inv_waste_rest_date
  ON inv_waste_entries (restaurant_id, waste_date DESC) WHERE voided_at IS NULL;
ALTER TABLE inv_waste_entries ENABLE ROW LEVEL SECURITY;

-- ── G. expenses: the EXPENSE BOOK (the broken-lamp ask) ──────────────────────
-- NOT stock: a lamp is not an ingredient. A manager (with the inv_expenses power) or
-- the owner records money that went out — what broke, what was repaired, the electric
-- bill — with a photo. Every entry is visible to the owner (list + monthly totals by
-- category in his reports). Append-only: void with a reason, never delete, so the
-- expense record can't be quietly rewritten (same rule as staff_payments / bills).
CREATE TABLE IF NOT EXISTS expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category       text NOT NULL CHECK (category IN
                   ('breakage','repair','utilities','cleaning','supplies','rent','transport','misc')),
  title          text NOT NULL,                           -- "Bar lamp broken", "Fridge repair"
  amount         numeric(12,2) NOT NULL CHECK (amount >= 0),
  expense_date   date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  note           text,
  photo_url      text,
  created_by     text,                                    -- "Rohit (manager)" — the owner sees WHO
  created_by_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  voided_at      timestamptz,
  void_reason    text,
  voided_by      text
);
-- Owner report reads month windows; the list reads newest-first. Voided rows drop out
-- of totals but stay in the list (struck through).
CREATE INDEX IF NOT EXISTS idx_expenses_rest_date
  ON expenses (restaurant_id, expense_date DESC) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_rest_created ON expenses (restaurant_id, created_at DESC);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- ── H. settings: the module ladder (brand-new feature ⇒ admin rung starts OFF) ─
--   inventory_allowed       — admin switch: does this restaurant get inventory+expenses at all
--   inventory_owner_control — admin hands the on/off to the owner
--   inventory_enabled       — the owner's own toggle (consulted only once transferred)
-- Manager reach rides manager_permissions.{inv_stock,inv_expenses,inv_recipes} +
-- owner_entitlements.power_<flag>, exactly like every other power (lib/accessModel.ts).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS inventory_allowed       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_owner_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inventory_enabled       BOOLEAN NOT NULL DEFAULT true;

-- ═════════════════════════════════════════════════════════════════════════════
-- I. lfh_inv_post_movement — THE single write path for stock.
--    Inserts the immutable ledger row (idempotent via dedupe_key) and updates the
--    item's materialised balance + weighted-average cost IN THE SAME TRANSACTION.
--    Returns the movement id, or NULL when the dedupe key already exists (replay).
--
--    WAC rules (research §2 + §6.6):
--      inflow  (qty>0): avg = (old_qty*old_avg + qty*unit_cost) / (old_qty+qty)
--                       …but if old_qty ≤ 0 the average is RESET to unit_cost (clamp —
--                       never let a negative balance poison the rate).
--      outflow (qty<0): average unchanged; the movement is VALUED at the current avg
--                       when the caller passes unit_cost = NULL.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION lfh_inv_post_movement(
  p_restaurant  uuid,
  p_item        uuid,
  p_qty_base    numeric,          -- signed: +in / −out
  p_kind        text,
  p_dedupe      text,
  p_unit_cost   numeric DEFAULT NULL,   -- ₹/base; NULL on outflows = value at current avg
  p_reason      text    DEFAULT NULL,
  p_ref_type    text    DEFAULT NULL,
  p_ref_id      text    DEFAULT NULL,
  p_created_by  text    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_qty  numeric;
  v_old_avg  numeric;
  v_cost     numeric;
  v_id       bigint;
BEGIN
  IF p_qty_base IS NULL OR p_qty_base = 0 THEN
    RAISE EXCEPTION 'inv movement qty must be non-zero';
  END IF;

  -- Lock the item row: balance + WAC update must be serialised per item.
  SELECT qty_base, avg_cost INTO v_old_qty, v_old_avg
    FROM inv_items WHERE id = p_item AND restaurant_id = p_restaurant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inv item % not found for restaurant %', p_item, p_restaurant;
  END IF;

  v_cost := COALESCE(p_unit_cost, v_old_avg, 0);

  -- Idempotent insert: a replayed dedupe key changes NOTHING and returns NULL.
  INSERT INTO inv_movements (restaurant_id, item_id, qty_base, kind, reason,
                             ref_type, ref_id, unit_cost, dedupe_key, created_by)
  VALUES (p_restaurant, p_item, p_qty_base, p_kind, p_reason,
          p_ref_type, p_ref_id, v_cost, p_dedupe, p_created_by)
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;                       -- replay — balance already reflects this movement
  END IF;

  IF p_qty_base > 0 THEN
    IF v_old_qty <= 0 THEN
      v_old_avg := v_cost;             -- clamp: reset the average after a negative spell
    ELSE
      v_old_avg := ((v_old_qty * COALESCE(v_old_avg,0)) + (p_qty_base * v_cost))
                   / (v_old_qty + p_qty_base);
    END IF;
  END IF;                              -- outflow: average unchanged

  UPDATE inv_items
     SET qty_base   = v_old_qty + p_qty_base,
         avg_cost   = COALESCE(v_old_avg, 0),
         updated_at = now()
   WHERE id = p_item;

  RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION lfh_inv_post_movement(uuid,uuid,numeric,text,text,numeric,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_inv_post_movement(uuid,uuid,numeric,text,text,numeric,text,text,text,text)
  TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- J. lfh_inv_stock_summary — one cheap aggregate for the owner report (fed through
--    the compute-on-view snapshot cache; never called per-render). Returns stock
--    value, item count, low/negative counts, waste ₹ + purchase ₹ + expense ₹ for a
--    date window — one row, no client-side table scans.
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION lfh_inv_stock_summary(
  p_restaurant uuid, p_from date, p_to date
) RETURNS TABLE (
  stock_value    numeric,
  item_count     integer,
  low_count      integer,
  negative_count integer,
  purchases_amt  numeric,
  waste_amt      numeric,
  expenses_amt   numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE((SELECT SUM(qty_base * avg_cost) FROM inv_items
              WHERE restaurant_id = p_restaurant AND active AND track_level <> 'EXPENSE'
                AND qty_base > 0), 0),
    (SELECT COUNT(*)::int FROM inv_items WHERE restaurant_id = p_restaurant AND active),
    (SELECT COUNT(*)::int FROM inv_items
      WHERE restaurant_id = p_restaurant AND active AND par_qty IS NOT NULL
        AND qty_base < par_qty),
    (SELECT COUNT(*)::int FROM inv_items
      WHERE restaurant_id = p_restaurant AND active AND qty_base < 0),
    COALESCE((SELECT SUM(total) FROM inv_purchases
              WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                AND bill_date BETWEEN p_from AND p_to), 0),
    COALESCE((SELECT SUM(qty_base * unit_cost_snap) FROM inv_waste_entries
              WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                AND waste_date BETWEEN p_from AND p_to), 0),
    COALESCE((SELECT SUM(amount) FROM expenses
              WHERE restaurant_id = p_restaurant AND voided_at IS NULL
                AND expense_date BETWEEN p_from AND p_to), 0);
$$;

REVOKE EXECUTE ON FUNCTION lfh_inv_stock_summary(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_inv_stock_summary(uuid, date, date) TO service_role;

-- ── K. inv-media bucket: bill / slip / waste / expense photos ─────────────────
-- PUBLIC-read (plain <img> URLs in the panels), writes ONLY through the service-role
-- API route — RLS on storage.objects blocks anon/authenticated writes by default.
-- Paths are per-restaurant + random uuid, so a URL can't be guessed from an id alone.
-- (Same shape as issue-media, mig 150.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('inv-media', 'inv-media', true)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
