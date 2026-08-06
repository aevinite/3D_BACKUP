-- 307_a_reseed_cannot_multiply_the_money.sql
--
-- THE HAZARD. `scripts/seed-supabase.mjs` step 1 runs EVERY file in supabase/migrations, in
-- filename order, unconditionally — there is no ledger of what has already been applied. Almost
-- every migration is written to survive that (CREATE OR REPLACE, IF NOT EXISTS, backfills keyed
-- on `WHERE … IS NULL`). Two are not, and both rewrite live data:
--
--   · 043_inr_base_currency.sql — the one-time USD→INR conversion. It multiplies every dish
--     price, every order's subtotal/tax/total/discount, every order_items.unit_price and every
--     price inside orders.items by 84. Running it a second time multiplies again. Measured on
--     the backup database the day this was written: a ₹500 dish becomes ₹42,000, a ₹441 bill
--     becomes ₹37,044, and the whole bill history goes from ₹36,621,750 to ₹3,076,226,973.
--
--   · 093_grandfather_r1_manager_powers.sql — an unconditional UPDATE of restaurant #1's
--     manager_permissions using jsonb_build_object, i.e. it REPLACES the whole bag with 5 keys.
--     French House now carries 24 keys. A re-run would delete 19 of them and flip
--     `delete_bill` from a deliberate false to absent — silently handing a manager powers an
--     admin had taken away. That is the access model being rewritten by a seed script.
--
-- CLAUDE.md documents the re-seed command with only "⚠️ it overwrites editor-made DB changes",
-- which does not warn anyone about either of these. The doc is corrected in the same commit.
--
-- THE FIX. A one-row-per-migration ledger, and those two migrations become no-ops once their key
-- is in it. Idempotent by construction, and it works in BOTH directions:
--
--   · EXISTING database (already in rupees): this migration inserts the keys now, so the very
--     next re-seed skips both. Nothing about today's data changes.
--   · FRESH database (seeded from zero): 043 and 093 sort BEFORE this file, so they run once
--     while the ledger does not exist yet — which the guard reads as "not yet applied", exactly
--     right — and then this file records them. The second pass skips them.
--
-- Deliberately NOT a full migration runner. That would be a real change to how this project
-- deploys, and the two files above are the only ones in 001–150 that damage anything on a second
-- run (every other one-time block was checked: 018/024/030/032/034/049/051/064/087/097/145 are
-- all either idempotent or key their backfill on a NULL, and 030's wipe targets two legacy
-- columns that hold data on zero rows).

-- ── the ledger ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lfh_applied_once (
  key        text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  note       text
);

-- Staff/service data about the schema itself — never guest-readable. RLS on with no policy is
-- the house lock (migs 014/039/054): anon and authenticated get nothing, the service role and
-- the migration runner (table owner) bypass it.
ALTER TABLE lfh_applied_once ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON lfh_applied_once FROM anon, authenticated;

COMMENT ON TABLE lfh_applied_once IS
  'Which ONE-TIME data migrations have already run, so a re-seed cannot apply them twice. '
  'Only migrations that REWRITE existing data need a row here — everything else in this repo is '
  'written to be idempotent. See migration 307 for why (a second run of 043 multiplied all money by 84).';

-- ── the helper both guarded migrations call ──────────────────────────────────────────────────
-- TRUE when this one-time migration must be skipped. The ledger deliberately may not exist yet
-- (a fresh database runs 043 long before this file), and "no ledger" means "nothing has been
-- recorded", so the answer is false and the migration runs its single legitimate time.
CREATE OR REPLACE FUNCTION lfh_already_applied(p_key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regclass('public.lfh_applied_once') IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM lfh_applied_once WHERE key = p_key);
END $$;

-- Staff-only, like every function here (the mig-038 rule).
REVOKE ALL ON FUNCTION lfh_already_applied(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_already_applied(text) TO service_role;

-- ── record the two that have provably already run ────────────────────────────────────────────
-- On an existing database this is the whole fix: both are marked, so the next re-seed skips them.
-- On a fresh one they have just run, a few hundred files earlier in the same pass, so marking
-- them here is equally correct. Either way ON CONFLICT keeps this migration itself idempotent.
INSERT INTO lfh_applied_once (key, note) VALUES
  ('043_inr_base_currency',
   'the one-time USD->INR x84 conversion. A second run multiplies every price and every stored bill by 84 again.'),
  ('093_grandfather_r1_manager_powers',
   'replaces restaurant #1 manager_permissions with a 5-key bag. A second run would delete the other 19 keys and undo an admin''s choices.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
