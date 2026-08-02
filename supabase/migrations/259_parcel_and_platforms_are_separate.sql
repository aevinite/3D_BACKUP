-- 259_parcel_and_platforms_are_separate.sql
--
-- TWO FEATURES, NOT ONE (owner, 2026-08-02). Read this before touching either of them.
--
--   PARCEL      — a counter order the restaurant's OWN staff punch in: ⚡ QO/P → Parcel on
--                 the manager floor, ☰ → New parcel on the waiter tablet. No table, no
--                 outside account, no API key, nothing to connect. Columns: parcel_*.
--   PLATFORMS   — orders that ARRIVE from outside the restaurant: Zomato, Swiggy and the
--                 restaurant's own website. Needs a channel switched on and its API key.
--                 Columns: takeaway_*.
--
-- WHY THEY WERE SPLIT AGAIN: mig 235 merged them into one "Takeaway & delivery" switch on
-- takeaway_*, on the theory that they are all "an order without a table". In practice they
-- are nothing alike — a restaurant that hands parcels over the counter is usually NOT on the
-- delivery apps — and the merge had a real cost: switching Platforms off (which is what a
-- restaurant with no Zomato/Swiggy account wants) silently killed the Parcel button too. The
-- floor still OFFERED Parcel, because the panel could not tell, and the server then refused
-- the finished order with "Parcel / takeaway isn't enabled for this restaurant" — the whole
-- order typed in and lost at the last tap. AANGAN hit exactly this on 2026-08-02.
--
-- parcel_* was never dropped (mig 197 created it, 198 defaulted it to true, 235 just stopped
-- READING it), so this migration mostly re-points the code at data that is already correct.
-- Nothing here can take a feature away: every settings row already carries parcel_allowed.

-- The three module-ladder columns for PARCEL. Created by mig 197; ADD ... IF NOT EXISTS keeps
-- this runnable on a database that somehow missed it.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS parcel_allowed       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS parcel_owner_control BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parcel_enabled       BOOLEAN NOT NULL DEFAULT true;

-- Default true (mig 198's rule, restated so a fresh database agrees): Parcel replaced the
-- 🥡 New Parcel button that every floor already had, so shipping it OFF would take a working
-- button away from every existing restaurant on upgrade.
ALTER TABLE public.settings ALTER COLUMN parcel_allowed SET DEFAULT true;

-- Normalise the two rungs the new access model never uses. Owners control no features in
-- v2 (docs/ACCESS-MODEL.md): the admin's <x>_allowed is the single truth, and the Access
-- screen writes _enabled = true alongside it. One legacy row still had _owner_control = true,
-- which would have let a stale _enabled = false quietly beat the admin's ON.
UPDATE public.settings
   SET parcel_owner_control = false, parcel_enabled = true
 WHERE parcel_owner_control IS DISTINCT FROM false
    OR parcel_enabled IS DISTINCT FROM true;

COMMENT ON COLUMN public.settings.parcel_allowed IS
  'PARCEL (its own feature since mig 259): a counter takeaway punched in by the restaurant''s own staff — QO/P → Parcel, tablet ☰ → New parcel, the Parcel tiles under the live floor and the parcel bill. Admin switch, Access → Main features. NOT the delivery apps: those are takeaway_allowed (Platforms).';

COMMENT ON COLUMN public.settings.takeaway_allowed IS
  'PLATFORMS (Zomato / Swiggy / the restaurant''s own website): orders that arrive from OUTSIDE, each channel switched on separately in settings.platform_channels with its API key. Admin switch, Access → Extra features. NOT the counter parcel: that is parcel_allowed.';
