-- 186_app_config.sql
--
-- A tiny admin-only key→value store for app-wide settings that aren't tied to one
-- restaurant. First use (owner 2026-07-24): remember the ACCESS setup the admin chose
-- the last time they created a restaurant, so the next "New restaurant" form auto-fills
-- from it (editable each time). Key: 'restaurant_creation_defaults'.
--
-- Service-role only (RLS on, no policies) — written/read exclusively by admin API routes
-- (the /aevinite console), never by the guest anon key. Small, single-purpose, reusable.
CREATE TABLE IF NOT EXISTS app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
