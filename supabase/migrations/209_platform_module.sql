-- 209_platform_module.sql — the Platform board (Zomato / Swiggy / Website takeaway) as a
-- first-class ladder MODULE, so the admin can switch it on/off per restaurant exactly like
-- parcel / banquet / table_ops (docs/ACCESS-LADDER.md, the "six touchpoints"). Until now the
-- 🛵 Platform tab was hard-wired ON for EVERY restaurant; some restaurants aren't on the
-- delivery apps at all and shouldn't see it.
--
--   platform_allowed        — admin switch 1: the Platform board exists for this restaurant
--   platform_owner_control  — admin switch 2: hand the on/off to the owner
--   platform_enabled        — the owner's own toggle (consulted only while transferred)
--   platform_channels JSONB — per-channel config { zomato:{on,key}, swiggy:{on,key}, website:{on,key} }
--   (manager grant rides restaurants.manager_permissions.platform + owner_entitlements.power_platform)
--
-- Unlike a brand-new LOCKED module, Platform is BACKFILLED ON for every existing restaurant
-- (it was already live for all of them — a new rung on a pre-existing feature defaults to the
-- current behaviour, per docs/ACCESS-LADDER.md, like take_orders mig 179). NEW restaurants get
-- _allowed=false from the column default, so it's opt-in going forward.
--
-- Channels carry an optional API key stored SERVER-SIDE ONLY (never sent to the manager panel;
-- real Zomato/Swiggy integrations are wired later). A channel with no key still works as a live
-- demo/representation via the "Simulate order" control. Zomato + Swiggy default ON for existing
-- restaurants (today's board); the website channel is genuinely new, so OFF.
--
-- Parcel vs Takeaway: a staff-punched parcel now has its OWN source 'parcel' (was 'takeaway'),
-- so it's labelled "Parcel" everywhere and is never confused with the website "Takeaway" channel.
-- Every existing 'takeaway' row IS a staff parcel (the website channel never existed yet), so
-- they are all migrated to 'parcel'.

-- 1) Module ladder columns + channel config. Backfill _allowed ON for existing restaurants.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS platform_allowed       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_owner_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS platform_enabled       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS platform_channels      JSONB   NOT NULL DEFAULT '{}'::jsonb;

-- ⚠️ ONE-TIME — GUARDED SINCE 2026-08-13 (T16 finding 7510). Three of the four statements below
-- OVERWRITE stored choices rather than filling in a missing one, so a re-seed used to re-enable
-- the Platform board for a manager an admin had removed it from, and reset restaurant #1's
-- delivery-channel switches to all-on — and since migration 263 made Parcel & Platforms permanent,
-- those channel switches are the ONLY ones left in that group. Same guard shape as 043/093.
DO $reseed_guard$
DECLARE v_applied boolean := false;
BEGIN
IF to_regprocedure('public.lfh_already_applied(text)') IS NOT NULL THEN
  EXECUTE $probe$ SELECT lfh_already_applied('209_platform_module_defaults') $probe$ INTO v_applied;
END IF;
IF v_applied THEN
  RAISE NOTICE '209_platform_module_defaults: already applied — skipped (a re-run would undo admin channel + manager choices)';
ELSE

UPDATE settings SET platform_allowed = true;

-- 2) Channels: existing restaurants keep Zomato + Swiggy ON (today's board), website OFF.
--    This one IS keyed on absence, so it is safe either way — kept inside the guard only so the
--    whole "what this file sets up" block stays in one place.
UPDATE settings
   SET platform_channels = '{"zomato":{"on":true},"swiggy":{"on":true},"website":{"on":false}}'::jsonb
 WHERE platform_channels IS NULL OR platform_channels = '{}'::jsonb;

-- 2b) Demo / reference restaurant (#1): turn every channel ON incl. website so the full
--     Zomato/Swiggy/Website demo flow is ready out of the box (owner 2026-07-26). Admin can
--     flip any channel off per restaurant from the restaurant-detail Platform card.
UPDATE settings
   SET platform_channels = '{"zomato":{"on":true},"swiggy":{"on":true},"website":{"on":true}}'::jsonb
 WHERE restaurant_id = '00000000-0000-0000-0000-000000000001';

-- 3) Managers keep the Platform board by default — backfill the grant on every restaurant so
--    the server (managerCan reads an ABSENT key as false) and the UI agree. New restaurants
--    get it from NR_MP_DEFAULT / MP_DEFAULT.
UPDATE restaurants
   SET manager_permissions = COALESCE(manager_permissions, '{}'::jsonb) || '{"platform": true}'::jsonb;

END IF;
END $reseed_guard$;

-- 4) Parcel gets its own source; migrate every existing takeaway row (all staff parcels).
ALTER TABLE aggregator_orders DROP CONSTRAINT IF EXISTS aggregator_orders_source_check;
ALTER TABLE aggregator_orders
  ADD CONSTRAINT aggregator_orders_source_check
  CHECK (source IN ('zomato','swiggy','takeaway','parcel','other'));
UPDATE aggregator_orders SET source = 'parcel' WHERE source = 'takeaway';

NOTIFY pgrst, 'reload schema';
