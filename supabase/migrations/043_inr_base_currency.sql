-- 043_inr_base_currency.sql
-- Switch the money BASE from USD to INR (owner ships to Indian restaurants, so
-- prices should be entered/stored in rupees). This converts the stored data ×84
-- to the EXACT rupee value guests already see, so nothing visibly changes:
--   old display  = snap10( nice(usd) × 84 )   (lib/format.ts INR rate 84, step 10)
--   new stored ₹ = that same number; display rate becomes 1 (see lib/format.ts).
-- The display-code half of this change (rates ÷84, INR step 1, panels ×1) ships
-- together — without it prices would render 84× off.
--
-- lfh_nice_usd stays as-is: on whole-rupee values its .99/.50 logic is a no-op,
-- so lfh_price_order keeps working and now returns rupee amounts.

-- ⚠️ ONE-TIME — GUARDED SINCE MIGRATION 307. `seed-supabase.mjs` re-runs every file in this
-- folder, and this one MULTIPLIES money by 84. A second run turned a ₹500 dish into ₹42,000 and
-- the whole bill history into ₹3.08 billion (measured, not guessed). It now runs only while
-- `lfh_applied_once` has no row for it — absent table (a fresh database) counts as "not yet",
-- which is the single legitimate run. Do NOT unwrap this.

-- ⚠️ THE HELPER MAY NOT EXIST YET, AND THAT IS NOT AN ERROR (fixed 2026-08-13, T16 finding 7511).
-- `lfh_already_applied` is created by migration 307 — 264 files AFTER this one. On a database that
-- already has it (every live stack) the call below is a plain check. On a FRESH database seeded
-- from zero it does not exist when this file runs, and calling it directly raised
-- `function lfh_already_applied(unknown) does not exist`, which made seed-supabase.mjs abort at
-- file 043 of 319 — so a brand-new database could not be built from this repo at all. The
-- `to_regprocedure` gate answers "is the helper there?" without touching it, and the call itself
-- goes through EXECUTE so PostgreSQL only PLANS it when the answer is yes. "No helper" means
-- "nothing has been recorded", which reads as not-yet-applied — exactly the single legitimate run.
DO $reseed_guard$
DECLARE v_applied boolean := false;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('043_inr_base_currency') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '043_inr_base_currency: already applied — skipped (a second x84 would corrupt every price and bill)';
  RETURN;
END IF;

-- 1) Dish base prices: USD → the exact rupee figure currently shown.
UPDATE menu_items
SET price = (round(lfh_nice_usd(NULLIF(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric) * 84 / 10) * 10)::int::text
WHERE price ~ '[0-9]';

-- 2) Option add-on prices (jsonb): each choice price × 84, rounded to whole ₹.
UPDATE menu_items
SET options = (
  SELECT jsonb_agg(
    jsonb_set(grp, '{choices}', (
      SELECT jsonb_agg(jsonb_set(ch, '{price}', to_jsonb(round(COALESCE((ch->>'price')::numeric, 0) * 84))))
      FROM jsonb_array_elements(COALESCE(grp->'choices', '[]'::jsonb)) ch
    ))
  )
  FROM jsonb_array_elements(options) grp
)
WHERE options IS NOT NULL AND jsonb_typeof(options) = 'array' AND jsonb_array_length(options) > 0;

-- 3) Existing orders + their lines: × 84 (whole ₹) so old bills still read right.
UPDATE orders SET
  subtotal = round(subtotal * 84),
  tax      = round(tax * 84),
  total    = round(total * 84),
  discount = round(discount * 84);

UPDATE order_items SET unit_price = round(unit_price * 84);

-- 4) Per-line prices inside orders.items (jsonb, USD strings) × 84.
UPDATE orders
SET items = (
  SELECT jsonb_agg(
    jsonb_set(it, '{price}', to_jsonb(to_char(round(COALESCE(NULLIF(regexp_replace(it->>'price', '[^0-9.]', '', 'g'), ''), '0')::numeric * 84), 'FM999999990')))
  )
  FROM jsonb_array_elements(items) it
)
WHERE items IS NOT NULL AND jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0;

END $reseed_guard$;
