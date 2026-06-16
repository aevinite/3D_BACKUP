-- 046_oplog_device_id.sql — record WHICH device performed each staff action.
-- There's no per-staff login yet, so every panel (tablet/kitchen/editor) drops a
-- random, persistent device id in a cookie on first use; the API stores it here
-- so the Operation log can show "tablet · #a3f9b2" instead of just "tablet".
-- Later, when real auth lands, this can map to a staff/device record.

ALTER TABLE staff_actions ADD COLUMN IF NOT EXISTS device_id text;
