-- 338: ONE SCREEN IS THE PRINTER, AND YOU CAN SEE WHICH — AND SWITCH
-- (owner, 2026-08-19: "divide whole printing in both manager as well as owner and kitchen — from one
--  only printer will be connect at one time; if connect at manager and kitchen panel it show printing
--  happening in manager, wanna switch and stuff".)
--
-- WHAT WAS MISSING. mig 335 made a ticket a ROW and mig 336 said which ROOM may claim it. Neither said
-- WHICH DEVICE — so with two screens entitled (a kitchen display and the counter PC, or simply two
-- kitchen tabs) both claimed, and which one printed was a coin flip. The atomic claim meant the ticket
-- printed once, which is the important half; but "once, on whichever machine won the race" is not a
-- printer anyone can rely on, and nothing on any screen said where the paper was coming out.
--
-- THE MODEL: exactly one ACTIVE station per restaurant, and the server refuses a claim from anyone
-- else. A partial unique index does the enforcing, in the database, so no amount of racing browsers
-- can produce two.
--
-- TAKING OVER IS DELIBERATE, EXCEPT WHEN IT CANNOT BE. Three rules, and the third is the one that
-- stops a shut kitchen screen taking printing with it:
--   1. no active station        → the first entitled screen that asks becomes it (so a kitchen that
--                                 has always "just printed" keeps doing exactly that, no set-up),
--   2. an active station exists → another screen is TOLD where printing is happening and offers a
--                                 plain "print here instead", which hands it over in one tap,
--   3. the active station has not been heard from for STALE_MINUTES → any entitled screen may take it
--                                 without asking, because that machine is asleep, closed or unplugged.
--
-- The device is identified by the `lfh_panel_device` cookie the panels already carry (lib/oplog.ts) —
-- which is per browser PROFILE, and the print station runs in its own profile, so it is exactly the
-- right grain: the same physical PC used for two different jobs counts as two devices.
CREATE TABLE IF NOT EXISTS print_stations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  device_id     text NOT NULL,
  -- What a person would call this screen ("Kitchen screen", "Counter · manager"). Written by the
  -- panel that took the station; shown to every other screen so "printing happens over there" names
  -- somewhere real instead of a uuid.
  label         text,
  panel         text NOT NULL CHECK (panel IN ('kitchen', 'editor')),
  active        boolean NOT NULL DEFAULT true,
  claimed_by    text,                      -- the staff name that pressed the button
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, device_id)
);
-- THE ENFORCEMENT: one active station per restaurant, in the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS print_stations_one_active
  ON print_stations (restaurant_id) WHERE active;
-- Every read is "who is printing for this restaurant" and every write touches one device's row.
CREATE INDEX IF NOT EXISTS print_stations_rid_idx ON print_stations (restaurant_id, active);

-- Staff-only, like print_jobs and printer_events (migs 269/335): RLS on with NO policies, so only the
-- service-role routes — which always scope by restaurant_id — can see or change any of it.
ALTER TABLE print_stations ENABLE ROW LEVEL SECURITY;

-- NO realtime breadcrumb on purpose. A station heartbeat lands on every board read (a few times a
-- minute per screen); emitting an event for each one would wake every open panel in the restaurant to
-- tell it nothing has changed. Screens learn who is printing on the read they were making anyway —
-- the same reasoning mig 335 used for auto print jobs.
COMMENT ON TABLE print_stations IS
  'Which ONE device prints this restaurant''s kitchen tickets (mig 338). One active row per restaurant, enforced by a partial unique index; a station unheard-of for a few minutes can be taken over without asking.';
