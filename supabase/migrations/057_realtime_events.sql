-- 057_realtime_events.sql  (Realtime Stage 2 — Phase 0 foundation)
--
-- A tiny, NON-SENSITIVE "breadcrumb" table. Postgres triggers (added in later
-- phases) drop one row here whenever an operational table changes. Every device
-- keeps a single WebSocket open listening for breadcrumbs on its topic, then
-- refetches the real data through its existing secure path — so we update only
-- when something actually changed, instead of polling every second.
--
-- Security: the breadcrumb carries NO names/prices/PII — just "kind X, id Y,
-- table Z changed". So it's safe for the public (anon) key to SELECT (which is
-- what Realtime needs to deliver the event). The real tables stay locked behind
-- their existing RLS + SECURITY DEFINER RPCs.

CREATE TABLE IF NOT EXISTS realtime_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic        text NOT NULL,        -- 'ops' (staff) | 'table:<n>' (a table's guests)
  kind         text NOT NULL,        -- order | order_item | call | session | member | request | table
  entity_id    text,                 -- the changed row's id (for future granular use)
  table_number text,                 -- when a table is involved
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast "give me recent events for my topic" (Realtime filters by topic).
CREATE INDEX IF NOT EXISTS realtime_events_topic_idx ON realtime_events (topic, id DESC);

-- RLS ON. Anon/authenticated may ONLY read (so Realtime can deliver). Writes are
-- done by the trigger function (SECURITY DEFINER), never by clients.
ALTER TABLE realtime_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rt_events_read ON realtime_events;
CREATE POLICY rt_events_read ON realtime_events FOR SELECT TO anon, authenticated USING (true);

-- Put the table on the Realtime publication so postgres_changes streams INSERTs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'realtime_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE realtime_events';
  END IF;
END $$;

-- Keep the table tiny: drop breadcrumbs older than 15 minutes. Called
-- opportunistically by the emit trigger (added next phase) and safe to call ad hoc.
CREATE OR REPLACE FUNCTION lfh_rt_prune() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM realtime_events WHERE created_at < now() - interval '15 minutes';
$$;
REVOKE ALL ON FUNCTION lfh_rt_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_rt_prune() TO service_role;

NOTIFY pgrst, 'reload schema';
