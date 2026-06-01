-- Enable Supabase Realtime change events on the `settings` table so the guest
-- site reacts to maintenance/bubble toggles within ~1s instead of only on a
-- manual refresh. `settings` already has a permissive public SELECT policy
-- (003_settings.sql), so the anon role is authorized to receive these events.
--
-- Idempotent: only add the table to the publication if it isn't already a member
-- (ALTER PUBLICATION ... ADD TABLE errors on a duplicate).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
  END IF;
END $$;
