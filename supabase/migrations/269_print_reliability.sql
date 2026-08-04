-- 269: PRINT RELIABILITY — a kitchen ticket to print is a ROW, never a fire-and-forget
-- browser call (owner, 2026-08-04: "bulletproof — if anything happens, half print, roll
-- complete, it should notify the manager; internet problem → it prints when internet is
-- available").
--
-- Two tables, following the mig-256 principle ("printed can't live on the device that
-- printed"):
--
--  • print_jobs — the durable queue. The manager's "Reprint in kitchen" inserts a row;
--    the kitchen screen claims it (an atomic status flip, so two open kitchen tabs never
--    both print it), prints the ticket with the REPRINT · DUPLICATE banner, and reports
--    done/failed. A kitchen that is closed or offline simply leaves the row queued — it
--    prints the moment the screen is back. A row stuck queued/printing, or failed out of
--    retries, surfaces as a manager notification with a "Print here instead" fallback.
--
--  • printer_events — printer problems. A one-tap report from the kitchen (paper out /
--    half print / jam — things a browser genuinely cannot detect) or an automatic
--    'auto_fail' when the kitchen's print call throws. Open events show on the manager's
--    floor (and therefore inside the owner's Manager mode, which embeds the same panel).
--    ANY successful print auto-resolves them — the print itself is the proof the printer
--    works again.
--
-- Both tables are staff-only: RLS on with NO policies, so only the service-role routes
-- (which always scope by restaurant_id) can touch them. Realtime rides the existing
-- lfh_rt_emit ELSE branch (kind = table name, table_number NULL → panels do a full
-- refresh; both events are rare, so the unscoped breadcrumb is the honest cheap choice).

CREATE TABLE IF NOT EXISTS print_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'kot' CHECK (kind IN ('kot')),
  order_id      uuid REFERENCES orders(id) ON DELETE CASCADE,
  reprint       boolean NOT NULL DEFAULT true,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','printing','done','failed','dismissed')),
  attempts      int  NOT NULL DEFAULT 0,
  requested_by  text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  claimed_at    timestamptz,
  done_at       timestamptz
);
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
-- The kitchen asks "anything for me to print?" on every board pass; the manager asks
-- "anything stuck?" on every floor pass. Both filter by (restaurant_id, status).
CREATE INDEX IF NOT EXISTS print_jobs_active_idx
  ON print_jobs (restaurant_id, status, created_at);

CREATE TABLE IF NOT EXISTS printer_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind          text NOT NULL
                CHECK (kind IN ('paper_out','half_print','jam','other','auto_fail')),
  note          text,
  count         int  NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  reported_by   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
ALTER TABLE printer_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS printer_events_open_idx
  ON printer_events (restaurant_id, status);

-- Breadcrumbs. print_jobs: INSERT only — a new job must wake the kitchen board instantly,
-- but the claim/done churn (3 updates per print) must NOT cost every open panel a
-- whole-floor read each; the manager's stuck-job view reads on its normal poll.
-- printer_events: INSERT + UPDATE — a problem opening AND its resolution both need to
-- reach the manager's floor (and clear the strip) without waiting for the backstop.
DROP TRIGGER IF EXISTS rt_emit_print_jobs ON print_jobs;
CREATE TRIGGER rt_emit_print_jobs
  AFTER INSERT ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_printer_events ON printer_events;
CREATE TRIGGER rt_emit_printer_events
  AFTER INSERT OR UPDATE ON printer_events
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();
