-- 047_blocklist_device.sql — allow blocking a staff DEVICE (a tablet/kitchen
-- screen), not just a guest phone/table. The tablet & kitchen APIs refuse any
-- request whose lfh_panel_device cookie matches a blocklist row's device_id.
-- (The editor is intentionally NOT enforced, so the owner can't lock themselves
-- out of the only panel that can unblock.)

ALTER TABLE blocklist ADD COLUMN IF NOT EXISTS device_id text;
