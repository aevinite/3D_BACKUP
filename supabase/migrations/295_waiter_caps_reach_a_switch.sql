-- 295_waiter_caps_reach_a_switch.sql — the waiter tablet stops being stuck (owner, 2026-08-04)
--
-- THE FAULT THIS REPAIRS, measured on the backup database on 2026-08-04:
--
--   aangan-garden-restaurant  mark_paid=off invoice=off table_ops=off
--   green-bowl / taco-fiesta / demo-bistro / burger-barn /
--   spice-route / sakura-sushi / pizza-palace   mark_paid=off invoice=off table_ops=off
--   french-house              mark_paid=on  invoice=on  table_ops=on   (hand-configured)
--
-- EIGHT of nine restaurants could not settle a bill from the tablet, and no screen anywhere could
-- change it. The model claimed take-orders / table-ops / table-type / khata / parcel / banquet were
-- "permanently on for whoever's panel owns them, so removing their rows is the whole change". That
-- is true for a MANAGER — an absent manager_permissions key reads as the model's default — and the
-- exact opposite for a WAITER: a waiter's power is a stored tri-state column, tabletPerm() read
-- `settings[key] || 'off'`, and lib/settingsClone wrote 'off' into every new restaurant. So the
-- rows were deleted from the screen while the storage still said no, and the waiter panel's own
-- admin ribbon offered "⚙ change in Access" for a switch that no longer existed.
--
-- The owner's answer (2026-08-04): every floor capability gets its own row on Access → Waiter,
-- default ON. This is the data half of that — the code half is lib/accessTree.ts (WAITER_FLOOR,
-- waiterCapValue) and lib/settingsClone.ts.
--
-- SAFE BY CONSTRUCTION: 'on' is what these rows now show as their default, so this makes the
-- database agree with the screen. It hands nothing dangerous over — the MONEY columns
-- (tablet_mark_paid, tablet_discount) are deliberately NOT touched, and tablet_invoice is left
-- exactly as it is because a waiter can never issue an invoice at all now (WAITER_NEVER).
-- Every one of these is still capped by its module: with the khata module off there is no khata
-- on the tablet whatever this column says.

-- 1 · the six floor capabilities → 'on' (the default their new Access rows show)
--
-- ⚠️ ONE-TIME — GUARDED SINCE 2026-08-13 (T16 finding 7510). The WHERE below does not test
-- ABSENCE, it tests "is it not the value I want" — this statement exists to overwrite a stored
-- tri-state. That is right once, as the repair it was written to be. On a re-seed it forced all six
-- of a waiter's capability switches back to 'on', throwing away any 'off' or 'pin' an admin had
-- since set on Access → Waiter, with nothing on screen and nothing in the Activity log to say so.
DO $reseed_guard$
DECLARE v_applied boolean := false;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('295_waiter_caps_default_on') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '295_waiter_caps_default_on: already applied — skipped (a re-run would force all six waiter switches back on)';
ELSE
UPDATE settings SET
  tablet_take_orders = 'on',
  tablet_table_ops   = 'on',
  tablet_table_tags  = 'on',
  tablet_khata       = 'on',
  tablet_parcel      = 'on',
  tablet_banquet     = 'on'
WHERE tablet_take_orders IS DISTINCT FROM 'on'
   OR tablet_table_ops   IS DISTINCT FROM 'on'
   OR tablet_table_tags  IS DISTINCT FROM 'on'
   OR tablet_khata       IS DISTINCT FROM 'on'
   OR tablet_parcel      IS DISTINCT FROM 'on'
   OR tablet_banquet     IS DISTINCT FROM 'on';
END IF;
END $reseed_guard$;

-- 2 · the walk-out close moves to its own key, carrying any stored value with it.
--
-- Closing a table that still owes money used to be gated by access_config.void_bills.tablet —
-- i.e. by the row labelled "Reopen a bill", which is a completely different act. The screen said
-- one thing and the switch did another, and when the owner removed the waiter's reopen row
-- (2026-08-04: "tablet will not have option of print and reopen bill and stuff") the walk-out
-- would have gone with it. It is now its own row, "Close a table that still owes money", stored at
-- access_config.close_unpaid.tablet with the same 'pin' default it always behaved as.
--
-- Only restaurants that had actually SET a value are rewritten; everything else keeps reading the
-- 'pin' default, which is what it was doing before.
-- NOT jsonb_set (2026-08-04). `jsonb_set(cfg, '{close_unpaid,tablet}', …, create_missing => true)`
-- creates only the LAST element of the path: with no `close_unpaid` object already there it writes
-- NOTHING and reports success. That is exactly what happened on the first run — Aangan's stored
-- 'off' and French House's 'on' both silently became the 'pin' default. Merging objects with `||`
-- builds the parent as well.
UPDATE restaurants
   SET access_config = COALESCE(access_config, '{}'::jsonb)
       || jsonb_build_object(
            'close_unpaid',
            COALESCE(access_config -> 'close_unpaid', '{}'::jsonb)
              || jsonb_build_object('tablet', access_config -> 'void_bills' -> 'tablet'))
 WHERE access_config -> 'void_bills' ? 'tablet'
   AND NOT (COALESCE(access_config -> 'close_unpaid', '{}'::jsonb) ? 'tablet');

-- 3 · the retired waiter-reopen value is left in place, unread.
-- Nothing deletes access_config.void_bills.tablet: it costs nothing, and a stored key that no code
-- reads is how every other retired switch in this model is handled (see MANAGER_TAB_KEYS). Do NOT
-- start reading it again — a waiter reopening a bill is the thing this change forbids.
