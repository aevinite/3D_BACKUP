-- 070_auto_table_action.sql
-- Global setting: when a table's bill is fully PAID and every dish is SERVED,
-- automatically 'close' or 'restart' that table. 'off' (default) = no auto action,
-- i.e. today's behaviour. Flipped on per-restaurant from the manager's settings.
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_table_action text NOT NULL DEFAULT 'off';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_auto_table_action_chk') THEN
    ALTER TABLE settings ADD CONSTRAINT settings_auto_table_action_chk
      CHECK (auto_table_action IN ('off', 'close', 'restart'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
