-- 069_resolve_open_requests_on_open.sql
--
-- When a table's session becomes OPEN — by ANY path (waiter opens on the tablet,
-- manager opens in the editor, or a guest scan auto-opens + becomes head) — that
-- table's pending "open" requests are FULFILLED. Mark them approved at the source so
-- a stale "Asked to open · <name>" with Approve/Deny never lingers in the panels on an
-- already-open table (owner caught it on Table 4), and never re-appears as a ghost
-- "Wants in" when the table later closes. Doing it in ONE trigger covers every open
-- path instead of patching each endpoint (the editor open already did this inline; the
-- tablet open + the guest auto-open RPC did not). (owner, 2026-06-18)

CREATE OR REPLACE FUNCTION lfh_resolve_open_requests() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE requests SET status = 'approved'
    WHERE table_number = NEW.table_number AND status = 'pending' AND type = 'open';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lfh_resolve_open_requests() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS resolve_open_requests ON sessions;
CREATE TRIGGER resolve_open_requests
  AFTER INSERT OR UPDATE OF status ON sessions
  FOR EACH ROW WHEN (NEW.status = 'open')
  EXECUTE FUNCTION lfh_resolve_open_requests();

NOTIFY pgrst, 'reload schema';
