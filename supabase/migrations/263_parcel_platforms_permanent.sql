-- 263 — Parcel + Platforms become ONE PERMANENT feature (owner, 2026-08-03)
--
-- "The parcel counter should not have a toggle option. The parcel counter where the parcels
--  are shown and where the Zomato and all that stuff will be shown will be permanently there.
--  Permanently." Asked how far that went, he chose: merge them into one permanent thing, and
--  the only switches left are the individual delivery apps inside it.
--
-- WHAT CHANGED IN CODE (this migration only makes the DB agree with it):
--   · lib/tableTags.ts    — parcelLadder / platformLadder now answer permanently-effective.
--   · lib/accessTree.ts   — the two switched rows ("Parcel — counter takeaway" in Main, and
--                           "Platforms (Zomato, Swiggy, own website)" in Extra) are replaced by
--                           ONE switchless group, "Parcel & delivery platforms", holding the
--                           three channel switches and their keys.
--   · lib/accessModel.ts  — the parcel/platform POWER rows keep their power (a real per-person
--                           setting) and lose their `module:` binding (the restaurant switch).
--   · the admin quick-features screen loses its Platform on/off toggle.
--
-- WHY THIS IS NOT A REPEAT OF THE BUG MIG 259 FIXED. Mig 259 split these apart because, while
-- they shared takeaway_*, switching Platforms off silently killed the counter parcel: the floor
-- still offered it and the server refused the finished order at the last tap. The CAUSE was a
-- master switch able to turn parcel off. There is no such switch now, on either half. Merging
-- them BEHIND a switch would bring the bug back; merging them into something PERMANENT is what
-- removes it for good.
--
-- The columns are deliberately NOT dropped. Dropping them would break any older deployment
-- rolled back onto this database, and they are cheap. They are simply no longer read — every
-- gate is a constant in code now. Backfilling them to TRUE here is belt-and-braces: if a future
-- change ever reads one again by mistake, it finds "on" rather than silently taking a live
-- feature away from a restaurant whose row still says false.

-- Every existing restaurant: both halves on.
UPDATE settings
   SET takeaway_allowed      = TRUE,
       takeaway_enabled      = TRUE,
       takeaway_owner_control = FALSE,
       parcel_allowed        = TRUE,
       parcel_enabled        = TRUE,
       parcel_owner_control  = FALSE
 WHERE takeaway_allowed IS DISTINCT FROM TRUE
    OR takeaway_enabled IS DISTINCT FROM TRUE
    OR takeaway_owner_control IS DISTINCT FROM FALSE
    OR parcel_allowed IS DISTINCT FROM TRUE
    OR parcel_enabled IS DISTINCT FROM TRUE
    OR parcel_owner_control IS DISTINCT FROM FALSE;

-- And every restaurant created from here on, so a new one is born with the same truth as an
-- old one (lib/settingsClone.ts writes these too; the default is the second belt).
ALTER TABLE settings ALTER COLUMN takeaway_allowed       SET DEFAULT TRUE;
ALTER TABLE settings ALTER COLUMN takeaway_enabled       SET DEFAULT TRUE;
ALTER TABLE settings ALTER COLUMN takeaway_owner_control SET DEFAULT FALSE;
ALTER TABLE settings ALTER COLUMN parcel_allowed         SET DEFAULT TRUE;
ALTER TABLE settings ALTER COLUMN parcel_enabled         SET DEFAULT TRUE;
ALTER TABLE settings ALTER COLUMN parcel_owner_control   SET DEFAULT FALSE;

COMMENT ON COLUMN settings.takeaway_allowed IS
  'RETIRED 2026-08-03 (mig 263) — the parcel/delivery board is permanent and nothing reads this. Kept so an older deployment can still roll back onto this database. Do not read it again without adding a switch to the Access screen to go with it.';
COMMENT ON COLUMN settings.parcel_allowed IS
  'RETIRED 2026-08-03 (mig 263) — see settings.takeaway_allowed.';
