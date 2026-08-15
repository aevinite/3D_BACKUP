-- 328_a_bill_counter_is_not_a_settings_change.sql — T16 finding 7788, 2026-08-15
--
-- ⚠ MIGRATION NUMBER: next free after 327. Every statement is DROP/CREATE TRIGGER, correct at ANY
--   number; renumber freely if a parallel branch took 328.
--
-- WHERE THIS LIVES, and what people saw:
--   · Guest menu (all three doors — /menu, /r/<slug>/menu, /q/<code>): every phone in the room
--     silently re-fetched its settings + menu each time the restaurant issued a banquet bill.
--   · Owner panel → Audit & logs, and the admin activity feed: an amber `warn` line reading
--     "settings update (<restaurant uuid>)", tagged panel = db, with nobody's name on it — one per
--     banquet bill. Migration 159 writes that row to record a MANUAL database edit ("when the owner
--     or Claude changes a row directly in Supabase, not through a panel"). A banquet bill is not
--     that, so the log was crying wolf during the one service where staff are busiest.
--
-- THE CAUSE. `lfh_banquet_bill_create` draws the banquet bill number from
-- `settings.banquet_bill_next` and bumps it (`UPDATE settings SET banquet_bill_next = v_seq + 1`).
-- It is the only number in the product kept in the settings row rather than the counter tables, and
-- `settings` carries two triggers that exist for changes a person made:
--   · rt_emit_settings (mig 066) writes a `menu:<rid>` breadcrumb — components/AppShell.tsx:75
--     subscribes every guest device to exactly that filter and calls refresh() on it;
--   · trg_manual_edit_settings (mig 159) writes the staff_actions 'warn' row described above.
-- Both are right for a real settings change and wrong for a counter tick.
--
-- WHY THIS FIXES THE TRIGGERS AND NOT THE COUNTER (the trade-off, deliberately taken).
-- The tidy-looking fix is to move the number to `lfh_next_seq(rid,'banquet_bill')` like every other
-- series. It was rejected for two concrete reasons:
--   1. `banquet_bill_next` is an ADMIN CONTROL, not just storage — the admin sets the starting
--      banquet bill number, and the API refuses to change it once bills exist
--      (app/api/admin/restaurants/settings/route.ts:261-274 and app/api/editor/[...path]/route.ts:4407).
--      Moving the counter means rewriting that control and its guard in two route files, for a
--      number a restaurant prints on paperwork.
--   2. `lfh_banquet_bill_create`'s live body was last written by migration 284 THROUGH DYNAMIC SQL
--      (it rewrote the function it read out of pg_get_functiondef), so the newest text in this
--      folder is not the definition that is running. Recreating it from 239's text would revert
--      284's banquet-tax fix — the exact trap migration 270 records, and the one that cost the T16
--      sweep's own first draft a full rewrite.
-- So the function is not touched at all. What changes is the two triggers' opinion of a counter
-- tick, which is the whole of the harm. If the counter is ever moved for its own reasons, these
-- WHEN clauses simply stop matching anything and can be dropped.
--
-- SHAPE: a trigger's WHEN clause may not mention OLD on an INSERT or NEW on a DELETE, so each
-- trigger splits into an UPDATE half that carries the test and an INSERT/DELETE half that does not.
-- `to_jsonb(row) - 'banquet_bill_next'` compares the WHOLE row minus the counter, so any other
-- column moving still fires exactly as before — including a settings change made in the same
-- statement as a counter bump. Same denylist reasoning as mig 282's guest read: a column added
-- later is included automatically, and the only thing that can go wrong is one needless event.

-- RE-RUNNABLE, and checked by running it twice: every trigger this file creates is dropped first,
-- INCLUDING the two new `_upd` names. Dropping only the old names left `CREATE TRIGGER
-- rt_emit_settings_upd` failing with "already exists" on the second pass — which is finding 7620's
-- fault (a file that works exactly once) reappearing in the fix for another one. seed-supabase.mjs
-- re-runs every file in this folder, so "works once" is broken.

-- ── 1 · the guest menu's breadcrumb ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS rt_emit_settings     ON public.settings;
DROP TRIGGER IF EXISTS rt_emit_settings_upd ON public.settings;

CREATE TRIGGER rt_emit_settings
  AFTER INSERT OR DELETE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

CREATE TRIGGER rt_emit_settings_upd
  AFTER UPDATE ON public.settings
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'banquet_bill_next') IS DISTINCT FROM (to_jsonb(NEW) - 'banquet_bill_next'))
  EXECUTE FUNCTION lfh_rt_emit();

-- ── 2 · the "someone edited the database by hand" footprint ───────────────────────────────────
DROP TRIGGER IF EXISTS trg_manual_edit_settings     ON public.settings;
DROP TRIGGER IF EXISTS trg_manual_edit_settings_upd ON public.settings;

CREATE TRIGGER trg_manual_edit_settings
  AFTER DELETE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION lfh_log_manual_edit();

CREATE TRIGGER trg_manual_edit_settings_upd
  AFTER UPDATE ON public.settings
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'banquet_bill_next') IS DISTINCT FROM (to_jsonb(NEW) - 'banquet_bill_next'))
  EXECUTE FUNCTION lfh_log_manual_edit();

COMMENT ON COLUMN public.settings.banquet_bill_next IS
  'The NEXT banquet bill number (admin sets the starting value; the API refuses to change it once '
  'bills exist). It is a counter living in the settings row for historical reasons, so both of '
  'settings'' triggers deliberately IGNORE an update that changes only this column — a bill counter '
  'ticking is not a settings change, and treating it as one made every guest phone re-fetch the menu '
  'and filed a false "edited by hand" warning per banquet bill (mig 328).';

NOTIFY pgrst, 'reload schema';
