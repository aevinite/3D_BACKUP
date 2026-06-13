-- 042_staff_actions_log.sql
-- The OPERATION LOG: an audit trail of staff actions across the panels, separate
-- from the customer log. Each row = "panel X did action Y" (accept/serve/attend/
-- open/close/shift…). No per-device login yet, so the actor is the PANEL
-- (editor/kitchen/tablet/admin); a real per-user actor can be added with login (later).
--
-- Service-role only: RLS ON with no policy denies the anon key; the panels write
-- via the service-role client (which bypasses RLS). Mirrors migrations 014/039.

CREATE TABLE IF NOT EXISTS staff_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  panel        text NOT NULL,        -- editor | kitchen | tablet | admin
  action       text NOT NULL,        -- e.g. order_accept, order_serve, table_open, table_shift…
  table_number text,                 -- the table involved, when relevant
  order_id     uuid,                 -- the order involved, when relevant
  detail       text,                 -- short human note (status, amount, target table…)
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_actions_created_idx ON staff_actions (created_at DESC);

ALTER TABLE staff_actions ENABLE ROW LEVEL SECURITY; -- no policy ⇒ anon denied; service-role bypasses
