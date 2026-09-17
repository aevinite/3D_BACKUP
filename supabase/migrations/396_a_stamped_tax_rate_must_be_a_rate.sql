-- 396 — a stamped tax rate must be a RATE, and the column now refuses anything else
-- (sweep #9, terminal 33, ROUND 2 — found by block D, the invariants over the real data)
--
-- ═══ WHAT IS WRONG, MEASURED ═══
--
-- `orders.tax_rate` is the rate the tax on that bill was ACTUALLY CHARGED at, stamped once so a
-- historical bill survives a GST change (migration 288's subject, and what lets a discount be
-- grossed at the rate charged rather than at today's rate). Every reader treats it as a FRACTION:
--
--     lfh_fill_disc_gross:  disc_gross := discount * (1 + COALESCE(NULLIF(tax_rate, 0),
--                                                                  lfh_effective_tax_rate(rid)))
--
-- On the dev stack, 41,159 orders store it as a fraction — 0.050000 for 5%. **TEN store `5`.** All
-- ten are French House, all dated 2026-08-19, and to every reader they say FIVE HUNDRED PER CENT.
--
-- NOBODY HAS A WRONG NUMBER TODAY, and that is measured, not assumed: all ten carry
-- `discount = 0`, `disc_gross = 0`, and none is paid — so no figure on any screen has ever been
-- computed from the bad rate. Their `total` (105.00, 210.00 on subtotals of 100 and 200) shows 5%
-- was genuinely charged; only the stamped metadata is wrong, by a factor of a hundred.
--
-- ═══ WHY IT IS A FAULT AND NOT A CURIOSITY ═══
--
-- Apply one discount to any of those ten bills and `disc_gross` becomes `discount × 6` instead of
-- `discount × 1.05`. A ₹100 discount on a ₹210 bill would gross to ₹600, `net_amount` would go to
-- −₹390 — and migration 390's floor would quietly show it as **₹0 collected** instead of ₹105.
-- The fix that stops a takings column reading below zero would HIDE this one, which is exactly the
-- shape worth closing before it happens.
--
-- ═══ HOW THEY GOT IN — THE ACTUAL GAP ═══
--
-- `lfh_plausible_tax_rate` already refuses 5 (`IF p_rate < 0 OR p_rate > 0.5 THEN RETURN false`),
-- and `lfh_stamp_order_tax_rate` consults it. Neither failed: the trigger only FILLS the column
-- when it arrives null, so a writer that supplies `tax_rate` itself is never checked. Nothing
-- validates the column, and no database function other than the stamp writes it — so those ten
-- came from outside the database, and the same door is open to every future write.
--
-- So the rule the product already states in a function is now enforced on the COLUMN, which is
-- where a rule has to live to hold against a caller nobody has written yet (the SaaS rule in
-- CLAUDE.md: business rules in the database, never in app-code filtering alone).
--
-- ═══ REPAIR FIRST, CONSTRAIN SECOND ═══
--
-- Adding a CHECK to a live column FAILS if any existing row violates it, so the ten are repaired
-- in the same file, before the constraint — the shape migrations 178 and 363 both used.
--
-- THEY ARE SET TO NULL, NOT DIVIDED BY 100, and that is migration 288's own precedent: "NULLs a
-- stamped tax_rate that differs from the restaurant's CURRENT rate", because a stamp nobody can
-- trust is better absent than guessed. `lfh_stamp_order_tax_rate` says the same in its body —
-- "otherwise leave NULL: the reader falls back to the restaurant's settings" — and
-- `lfh_fill_disc_gross`'s COALESCE is that fallback. So nulling these ten makes a future discount
-- on them CORRECT, where dividing by 100 would only make it plausible.
--
-- ⚠️ NO MONEY IS TOUCHED AND NO SALE IS HIDDEN. `total`, `subtotal`, `tax`, `discount`,
-- `disc_gross` and `net_amount` are not written by this file; `net_amount` is a generated column and
-- cannot be. Nothing is deleted, nothing is filtered, and no figure that includes voided or deleted
-- bills stops including them (docs/COMPLIANCE-GUARDRAILS.md §4, migration 309's asymmetry). The ten
-- rows keep every rupee they carry — only a piece of metadata that was arithmetically impossible is
-- cleared.
--
-- ═══ WRAPPED IN THE ONE-TIME LEDGER, BECAUSE IT REWRITES LIVE DATA ═══
--
-- A re-seed re-runs every migration with no ledger of its own (CLAUDE.md), so a data-rewriting
-- statement needs migration 307's guard or it can fire again years later against rows that are by
-- then legitimate. The UPDATE is keyed on `396_null_impossible_tax_rates`; the CHECK is idempotent
-- on its own (IF NOT EXISTS on the constraint name) and deliberately sits OUTSIDE the ledger, so a
-- fresh database still gets the constraint even though it has no rows to repair.
--
-- The band matches `lfh_plausible_tax_rate`'s own outer bound rather than inventing a second
-- number: 0 is real (composition, or a fully untaxed bill), above 0.5 is nothing sane. It cannot
-- also check "this rate matches THIS restaurant's settings", because a CHECK may not read another
-- table — that half stays where it already is, in the plausibility function the stamp consults.
--
-- Guarded by `npm run verify:tax-rate-is-a-rate`.

DO $tax_rate_repair$
BEGIN
  IF NOT lfh_already_applied('396_null_impossible_tax_rates') THEN
    UPDATE public.orders
       SET tax_rate = NULL
     WHERE tax_rate IS NOT NULL
       AND (tax_rate < 0 OR tax_rate > 0.5);
    INSERT INTO lfh_applied_once (key, note) VALUES
      ('396_null_impossible_tax_rates',
       'NULLs a stamped orders.tax_rate outside 0..0.5 — ten rows on 2026-08-19 held 5 (i.e. 500%) where every other row holds 0.05. A re-run could clear a rate that is legitimate by then.')
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $tax_rate_repair$;

DO $tax_rate_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.orders'::regclass
                    AND conname = 'orders_tax_rate_is_a_rate') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_tax_rate_is_a_rate
      CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 0.5));
  END IF;
END $tax_rate_check$;

COMMENT ON COLUMN public.orders.tax_rate IS
  'The rate the tax on THIS bill was actually charged at, as a FRACTION (0.05 = 5%) — never a percentage. Stamped once by lfh_stamp_order_tax_rate so a historical bill survives a GST change, and read by lfh_fill_disc_gross to gross a discount at the rate charged. NULL means "not stamped", and every reader falls back to the restaurant''s current setting. Constrained to 0..0.5 by mig 396 after ten rows were found holding 5; the "does it match THIS restaurant" half lives in lfh_plausible_tax_rate, because a CHECK may not read another table.';

NOTIFY pgrst, 'reload schema';
