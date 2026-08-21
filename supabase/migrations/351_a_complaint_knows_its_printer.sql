-- 351 · A COMPLAINT KNOWS WHICH PRINTER IT IS ABOUT
--
-- THE FAULT, found by review on 2026-08-21 and confirmed in the code: printer_events (mig 269) records
-- "this RESTAURANT has a printer problem" and nothing more, and any successful print resolves every
-- open row for that restaurant (lib/printQueue.finishKotJob). That was exactly right while a
-- restaurant had ONE printer — paper coming out of it is proof it works, which is the auto-close the
-- owner asked for on 2026-08-04.
--
-- Since mig 341 a computer can own SEVERAL printers. So: report "the bill printer is out of paper",
-- then a kitchen ticket prints normally in the kitchen, and the paper-out complaint closes itself
-- while the bill printer is still empty. Nobody is told, and the board looks clean. The kitchen half
-- keeps working perfectly, which is what makes it quiet.
--
-- So a complaint now carries the printer it is about, and the auto-close is narrowed to that printer.
-- NARROWER, NEVER WIDER: a row with no printer on it (every row written before today, and any report
-- from a screen that has no routed printer) still behaves exactly as it always did, so nothing can
-- get stuck open by this change.
ALTER TABLE printer_events ADD COLUMN IF NOT EXISTS printer text;

-- Which machine it was reported from, kept for the same reason print_jobs.printed_by is kept: when
-- somebody asks "where did that complaint come from?", a name beats a guess. ON DELETE SET NULL
-- because removing a computer must never delete the record of a problem it once had.
ALTER TABLE printer_events ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES print_agents(id) ON DELETE SET NULL;

COMMENT ON COLUMN printer_events.printer IS
  'The printer NAME this complaint is about, as its own computer knows it (mig 351). NULL = unknown/legacy, which the auto-close still treats the old way: any successful print clears it.';

-- The open-complaint read is already indexed by (restaurant_id, status) — printer_events_open_idx,
-- mig 269. Nothing here needs a new index: the printer is a filter applied to a handful of open rows,
-- never a scan.
