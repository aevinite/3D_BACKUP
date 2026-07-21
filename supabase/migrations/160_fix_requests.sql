-- 160 — fix_requests: the "Send to Claude" queue.
--
-- ⚠ MIGRATION NUMBER: next free after 159 (everything_log). If a parallel branch already took
--   160, renumber to the next free slot — this is a standalone additive CREATE TABLE, correct at
--   ANY number.
--
-- WHY: when the admin sees an error row (or just describes a problem), one tap files a repair
-- request here — the error + the ~20 surrounding log lines bundled as context. The nightly repair
-- agent reads the OPEN rows, reproduces + fixes each, and stamps the row (status='fixed', pr_url).
-- The owner never has to re-explain a bug: the facts are already captured.
--
-- Service-role ONLY (RLS on, no policy → anon/authenticated denied; service_role bypasses RLS),
-- exactly like staff_actions. No customer data belongs here — summary is an error/label + the
-- owner's note; context is log rows (already money-redacted upstream for admin origins).

CREATE TABLE IF NOT EXISTS fix_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid,                                   -- nullable: a platform-level problem has none
  created_at    timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'dismissed')),
  source        text,                                   -- 'error_row' | 'owner_described'
  summary       text NOT NULL,                          -- short human line: the error msg / the note
  note          text,                                   -- the owner's optional free-text description
  context       jsonb,                                  -- surrounding log rows + panel/device metadata
  pr_url        text,                                   -- filled by the nightly agent when it opens a PR
  resolved_at   timestamptz
);

-- The agent asks for OPEN rows newest-first; the admin list filters by status. One cheap index.
CREATE INDEX IF NOT EXISTS idx_fix_requests_status ON fix_requests (status, created_at DESC);

ALTER TABLE fix_requests ENABLE ROW LEVEL SECURITY;  -- no policy = only service_role can touch it

NOTIFY pgrst, 'reload schema';
