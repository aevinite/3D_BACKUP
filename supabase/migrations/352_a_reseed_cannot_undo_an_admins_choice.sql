-- 352 · A re-seed cannot undo an admin's choice, or re-price a filed month
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION NUMBER: 352 — the next free number after main's 351, and the THIRD number this file
--   has carried. The reserved 360–364 block was tried first and `npm run verify:grants` refused it:
--   the folder's own sequence check fails on any unexplained gap, so jumping 349 → 360 reported ten
--   missing migrations and turned a shared guard red. It then took 350, and while this branch was in
--   review `350_an_old_web_address_still_finds_the_restaurant.sql` merged onto main under the same
--   number — the exact collision `verify:db-parity` section A2 exists to catch, caught while
--   renumbering was still just a rename. Every statement here is INSERT … ON CONFLICT DO NOTHING,
--   so this file is correct at ANY number; renumber it again if a parallel branch takes 352 first.
--   (T21 and T24 each hold an uncommitted 352 in their worktrees. Whoever merges second renumbers —
--   the parked-worktree check in verify-db-grants.mjs prints that warning on every run.)
--
-- BACKEND ONLY — NOTHING ON SCREEN CHANGES. Not one row of business data is created, changed or
-- deleted by this file. It writes three rows to the ledger migration 307 built.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────────────────────────
-- `scripts/seed-supabase.mjs` step 1 runs EVERY file in this folder, in filename order,
-- unconditionally — there is no ledger of what has already been applied. Almost every migration is
-- written to survive that. Migration 307 found the two in 001–150 that were not, built the ledger,
-- and wrapped them. Migration 321 found four more in 151–308 (198 / 209 / 295 / 288) and named the
-- shape they share:
--
--     "a WHERE that tests 'is it not the value I want' rather than absence.
--      All four are correct exactly once; on a re-seed they hand back access an admin removed,
--      or (288, after a GST change) un-stamp every historical order and let months of filed
--      revenue be re-priced at the new rate."
--
-- A 500-phase reading of migrations 231 → 349 found THREE more of exactly that shape. Each one is
-- wrapped in its own file — only the original file can make ITSELF re-runnable — and the keys are
-- recorded here, because `lfh_applied_once` does not exist until migration 307 and all three of
-- those files sort before it.
--
--   235_menu_language_defaults    — WHERE THE OWNER WOULD SEE IT: the GUEST MENU's language and
--       currency switchers. Migration 235's re-expansion tests `menu_languages = ARRAY['en']`,
--       which is true both of a restaurant nobody has configured and of one whose ADMIN narrowed it
--       to English on purpose. Measured on the backup database 2026-08-21: 4 restaurants were
--       English-only, one of them AANGAN GARDEN RESTAURANT — live, not binned. A re-seed handed all
--       four five extra languages, on the guest's phone, silently.
--
--   235_khata_follows_table_tags  — WHERE: Admin console → a restaurant → Access & permissions →
--       Pay later (khata). Migration 235 split khata off the table-types switch and copied the old
--       value across ONCE. Its `IS DISTINCT FROM` re-runs for ever, so from the moment the admin
--       sets khata independently, a re-seed drags it back. Measured: 1 settings row today.
--
--   301_backfill_disc_gross       — BACKEND ONLY, NOTHING ON SCREEN — but it reaches Owner panel →
--       Dashboard and Reports → Sales. Migration 301's backfill falls back to the rate configured
--       RIGHT NOW for an order with no stamped rate. On the day it first ran that was correct; on a
--       re-seed after a GST change it re-grosses those discounts at the NEW rate, and because
--       `orders.net_amount` is GENERATED ALWAYS AS (total − disc_gross) (mig 310), the owner's filed
--       revenue for past months moves with them. Measured: 11 discounted orders carry no stamped
--       rate today, out of 2,382 discounted rows. Same fault 321 recorded for 288, one column over.
--
-- ── HOW IT WORKS IN BOTH DIRECTIONS (migration 307's reasoning, restated) ───────────────────────
--   · EXISTING database (every live stack): the three statements have already run their legitimate
--     time. Recording the keys now is the whole fix — the very next re-seed skips all three.
--   · FRESH database seeded from zero: 235 and 301 sort BEFORE 307, so they run once while the
--     ledger does not exist yet — which the guard reads as "not yet applied", exactly right — and
--     then this file records them. The second pass skips them.
--
-- ── AND THE THREE STATEMENTS ARE NOT DISABLED, ONLY MADE ONCE-ONLY ─────────────────────────────
-- Nothing here turns a migration off. Each guarded block still runs its single legitimate time on
-- any database that has not had it; what changes is that the SECOND run is a no-op with a NOTICE
-- saying so, instead of a silent rewrite of somebody's decision.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

INSERT INTO public.lfh_applied_once (key, note) VALUES
  ('235_menu_language_defaults',
   'Re-expands a restaurant''s guest-menu language and currency lists from the single default to all six. A re-run hands five languages back to a menu an admin deliberately narrowed to English — measured 2026-08-21: 4 restaurants, one of them live.'),
  ('235_khata_follows_table_tags',
   'Copies the old shared table-types switch onto the new khata (pay-later) switch, once, when the two were split. A re-run drags pay-later back to whatever table_tags_allowed says, discarding the admin''s own choice.'),
  ('301_backfill_disc_gross',
   'Backfills orders.disc_gross. For a row with no stamped tax_rate it uses the rate configured RIGHT NOW, so a re-run after a GST change re-prices every unstamped discounted bill — and orders.net_amount is generated from it, so the owner''s filed revenue moves too. Same fault as 288_null_implausible_tax_rates.')
ON CONFLICT (key) DO NOTHING;

-- Afterwards every key any migration in this folder passes to lfh_already_applied() has a row here:
--   select key from public.lfh_applied_once order by key;
