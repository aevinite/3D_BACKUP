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

-- ⚠️ RUN-ALONE GUARD (sweep #9, T29, 2026-09-15).
-- The membership this file adds is RETIRED. Migration 304 took `settings` back OFF the
-- supabase_realtime publication, and wrote down both reasons: the anon key has no read policy on
-- `settings` any more (migs 282/283 moved the guest onto `lfh_guest_settings`, and Realtime
-- enforces RLS on postgres_changes, so an anon subscriber could not be delivered these rows even
-- if it asked), and AppShell was rewritten to watch the BREADCRUMB instead. Nothing subscribes.
--
-- Left as it was, running THIS FILE ALONE puts every settings write back into the logical
-- replication stream for a listener that does not exist — and the admin settings screen writes on
-- every toggle. That is pure egress, which is this product's actual cost. A FULL re-seed already
-- ends correctly (304 sorts after this file). Guarded and idempotent, exactly like 304's own block.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.settings;
  END IF;
END $$;
