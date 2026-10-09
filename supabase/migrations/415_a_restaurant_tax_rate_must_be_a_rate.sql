-- 415 — a restaurant's own tax_rate must be a RATE (a fraction 0..0.5), like the rate an order is stamped with
-- (sweep #10 T30 round 3, item 18, 2026-10-09 — owner: "do all")
--
-- WHY. Migration 396 put `orders_tax_rate_is_a_rate` (0..0.5) on the rate stamped onto each order, after
-- ten orders were found holding 5 — a percent typed into a fraction column, i.e. 500% tax. The place
-- that number COMES FROM — settings.tax_rate — had no such rule:
--
--   · the admin's restaurant-settings route clamped it to 0..1, so 0.6 (60%) saved happily, and then
--     every order the restaurant took was stamped 0.6 and REFUSED by 396's constraint — the restaurant
--     could not take an order, from a value the admin screen had just accepted;
--   · the owner's settings save (the editor route, owner role) wrote it with no range check at all, so a
--     typed 5 meant 500% tax on every bill until somebody noticed.
--
-- lib/tax.ts reads this column for every bill, cart, report and pay-in-parts due in the app. A rule that
-- can be stated once, in the database, is stated here; the admin route's clamp is moved to the same
-- 0..0.5 in the same change, and lib/dbRefusal names this constraint so a refused value reads as a
-- sentence (not "That value isn't allowed here").
--
-- Nothing on the dev database is outside the range (counted before writing this: 0 of 20 rows), so this
-- is purely the rule — no data is rewritten and no lfh_already_applied ledger is needed. Idempotent.
-- ⚠️ BACKUP-STACK FILE FIRST: AV live receives it only through the release ritual, asked for by name.

DO $settings_tax_rate_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.settings'::regclass
                    AND conname = 'settings_tax_rate_is_a_rate') THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_tax_rate_is_a_rate
      CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 0.5));
  END IF;
END $settings_tax_rate_check$;

COMMENT ON COLUMN public.settings.tax_rate IS
  'The restaurant''s flat GST rate as a FRACTION (0.05 = 5%), used only when no named tax_components are set; 0 or NULL fall back to 5% (lfh_effective_tax_rate / lib/tax.ts). Constrained to 0..0.5 by mig 415 — the same range mig 396 puts on orders.tax_rate, so a rate a restaurant can save is always one its orders can be stamped with.';

NOTIFY pgrst, 'reload schema';
