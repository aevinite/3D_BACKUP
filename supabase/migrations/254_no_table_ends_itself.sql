-- 254_no_table_ends_itself.sql
--
-- A TABLE IS NEVER ENDED BY THE APP (owner, 2026-08-02: "all the serve has been done and all
-- the mark-as-paid has been done … the table restarts. I don't want that").
--
-- settings.auto_table_action (mig 070) let a restaurant choose what happens the instant a bill
-- was fully paid AND every dish served: 'off' (nothing), 'close' (free the table) or 'restart'
-- (wipe the round, keep the party). Both of the active choices turn out to be wrong on a real
-- floor: a party that has PAID is usually still sitting there finishing their coffee, and their
-- table either vanished off the floor or silently reset under them.
--
-- The application code that read this column (lib/autoSettle.ts) is DELETED. The manager panel
-- now shows a ✓ Close control — on the floor tile beside the bill, and in the table detail —
-- which appears only when everything is served AND the whole bill is paid (in either order),
-- and a person taps it.
--
-- The column is kept rather than dropped: it is harmless once nothing reads it, and dropping a
-- column that an older deployed build might still SELECT is how a live panel starts erroring
-- mid-service. This migration just makes sure no row still carries a setting nobody honours,
-- so a later reader can't resurrect the behaviour by accident, and records why in the schema.

UPDATE settings SET auto_table_action = 'off' WHERE auto_table_action IS DISTINCT FROM 'off';

COMMENT ON COLUMN settings.auto_table_action IS
  'RETIRED 2026-08-02 (mig 254). No code reads this. A table is ended only by a person tapping '
  '✓ Close in the manager panel, which appears once every dish is served and the bill is paid. '
  'Kept as an always-''off'' column so an older build cannot fail on a missing column.';
