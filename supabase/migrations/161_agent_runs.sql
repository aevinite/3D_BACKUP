-- 161 — agent_runs: the visible HISTORY of every Claude working session (owner 2026-07-21:
-- "whatever the terminal open, background and front, all history should be shown at the admin
-- panel Repair somewhere").
--
-- ⚠ MIGRATION NUMBER: next free after 160 (fix_requests). Standalone additive CREATE TABLE —
--   correct at any number; renumber if a parallel branch takes 161 first.
--
-- One row per agent session, whoever started it:
--   • 'live'    — the pop-up terminal the watcher opens on the owner's Mac
--   • 'nightly' — the 02:30 repair robot
--   • 'audit'   — the scheduled owner/tablet panel audits
-- The starter INSERTs status='running'; the wrapper stamps ended_at + final status; the session
-- itself writes `report` (a short plain-language "what I did", capped by the writers at ~8 KB).
--
-- Service-role ONLY (RLS on, no policy), like fix_requests. No customer data belongs in report.

CREATE TABLE IF NOT EXISTS agent_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('live', 'nightly', 'audit')),
  title       text NOT NULL,                 -- plain line: the request summary / "Nightly repair run"
  request_id  uuid,                          -- fix_requests.id when the run serves one request
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'closed', 'failed')),
  report      text,                          -- the session's own summary of what it did
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);

-- The admin history list reads newest-first; one cheap index.
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs (started_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;  -- no policy = only service_role can touch it

NOTIFY pgrst, 'reload schema';
