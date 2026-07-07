-- Per-restaurant realtime scoping AT THE SOCKET (audit follow-up, cost/scale).
--
-- Today every guest subscribes to realtime_events filtered by `topic` only, then
-- discards other restaurants' breadcrumbs in JS. No data leaks (the refetch is
-- already restaurant-scoped), but at scale every restaurant's guests receive every
-- other restaurant's menu pings over the socket — needless chatter.
--
-- Supabase's postgres_changes filter can match only ONE column. Filtering by
-- `topic` alone lets other restaurants through; filtering by `restaurant_id` alone
-- would re-expose the order ("ops") firehose to guests. So we add ONE combined
-- column, `topic_rid` = topic || ':' || restaurant_id, and filter on THAT — giving
-- each guest exactly its own restaurant's events for exactly the topics it watches.
--
-- topic_rid is a PLAIN column (not GENERATED) so it's reliably in the logical-
-- replication stream the realtime server reads. A single BEFORE INSERT trigger on
-- realtime_events fills it — independent of the many rt_emit trigger functions, so
-- none of those need touching. restaurant_id is always set (migration 086 COALESCEs
-- it to #1), so topic_rid is always populated.

ALTER TABLE realtime_events ADD COLUMN IF NOT EXISTS topic_rid text;

CREATE OR REPLACE FUNCTION lfh_set_topic_rid() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.topic_rid := NEW.topic || ':' || COALESCE(NEW.restaurant_id::text, '00000000-0000-0000-0000-000000000001');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_set_topic_rid ON realtime_events;
CREATE TRIGGER trg_set_topic_rid BEFORE INSERT ON realtime_events
  FOR EACH ROW EXECUTE FUNCTION lfh_set_topic_rid();

-- Backfill any existing rows so the filter is consistent (table is small/ephemeral).
UPDATE realtime_events
   SET topic_rid = topic || ':' || COALESCE(restaurant_id::text, '00000000-0000-0000-0000-000000000001')
 WHERE topic_rid IS NULL;

NOTIFY pgrst, 'reload schema';
