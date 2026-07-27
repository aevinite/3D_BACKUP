-- 214 — unblock_requests: a blocked device's polite "please let me back in" queue.
--
-- ⚠ MIGRATION NUMBER: 213 was taken by a parallel branch (fix_owner_fn_drift), so this moved to
--   214. It's a standalone additive CREATE TABLE, correct at ANY number; renumber again if 214
--   collides too.
--
-- WHY: when the admin deliberately blocks a device/IP from the admin panel (a far-future lock in
-- login_throttle, see lib/loginThrottle.ts), that device now sees a "You're blocked" page instead
-- of the login form. From there it can file at most 3 unblock requests per day. Each request lands
-- here; the admin sees them at the bottom of the Rate-limits page (just above the block list) and
-- taps Unblock (lifts the throttle lock) or Deny. On purpose these requests do NOT ping the phone
-- or the notification bell — the owner said they must be scroll-only, never an interruption.
--
-- The 3/day cap is enforced in TypeScript as a plain COUNT over this table (last 24h per ip),
-- deliberately NOT a rate_limit_rules entry — a rate_limit_events row would surface in the bell and
-- push a phone alert, which is exactly what we must avoid for these silent requests.
--
-- Service-role ONLY (RLS on, no policy → anon/authenticated denied; service_role bypasses RLS),
-- exactly like fix_requests / staff_actions. No customer data belongs here — just the throttle key,
-- the requester's IP/device, and an optional short free-text message.

CREATE TABLE IF NOT EXISTS unblock_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL,                            -- the login_throttle key, e.g. 'admin:<ip>'
  ip            text NOT NULL,                            -- requester IP (from proxy headers; keying + 3/day count)
  device_id     text,                                     -- best-effort device fingerprint, may be null
  message       text,                                     -- optional short note from the requester (<=200 chars)
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'denied')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   text
);

-- Two access patterns: the 3/day cap counts recent rows for one ip; the admin list shows open rows
-- newest-first. Index the ip+time path (the hot one, hit on every blocked-device request).
CREATE INDEX IF NOT EXISTS idx_unblock_req_ip ON unblock_requests (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unblock_req_open ON unblock_requests (status, created_at DESC);

ALTER TABLE unblock_requests ENABLE ROW LEVEL SECURITY;  -- no policy = only service_role can touch it

NOTIFY pgrst, 'reload schema';
