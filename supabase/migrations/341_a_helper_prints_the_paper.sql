-- 341 · A HELPER PRINTS THE PAPER — one basket, many printers
--
-- WHY (owner, 2026-08-20). At Aangan one man is the owner AND the manager: he sits at the counter
-- in the owner panel in Manager mode, and the kitchen's auto-print window kept pulling his screen
-- away from the floor he was reading. Meanwhile THREE printers hang off the shop's computer —
-- kitchen slips, bills, and a small-paper A4 machine for banquet sheets — and a browser cannot
-- choose between them: silent printing always goes to the machine's DEFAULT printer, and there is
-- no web API to pick one. One browser profile = one printer, for ever.
--
-- So the printing moves out of the tab and into a tiny program on the machine that has the
-- printers: a HELPER. It polls this queue over plain outbound HTTPS, prints the job on the printer
-- named in the job, and confirms. Nothing has to be logged in, nothing has to stay open, nothing
-- can steal the screen, and a closed kitchen panel no longer stops the kitchen printing.
--
-- WHAT THIS MIGRATION IS NOT: it is not a new queue. print_jobs (mig 269) already IS the queue,
-- already auto-fills from the order trigger (mig 335), and its single filtered UPDATE claim is
-- already what makes double printing impossible. This adds the missing halves — WHO prints
-- (print_agents) and WHERE it goes (print_jobs.printer) — and widens `kind` so a bill and a
-- banquet sheet can travel the same road as a kitchen ticket.
--
-- ROUTING IS DELIBERATELY NOT IN HERE. The address book (which kind of paper goes to which
-- printer on which machine) lives in settings.modules.printing — the module bag, so no new
-- settings column (mig 326 rule; there are already 110) — and is resolved by the route handler at
-- CLAIM time, not stamped at queue time. Three reasons: changing the address book then takes
-- effect on the very next poll, the rules are not duplicated in SQL where they would drift from
-- lib/, and a restaurant with NO helper keeps working exactly as today because its jobs are simply
-- claimed by a screen instead.

-- ── WHO can print ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS print_agents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  -- What the person calls that computer — "Shop's computer", "My Mac". It is what every dropdown
  -- in the admin console shows, so it is renameable and must stay readable.
  name          text NOT NULL,
  -- The helper's code, NEVER stored in the clear: sha-256 only. The plaintext is shown once, at
  -- install time, and cannot be recovered afterwards — a new code is minted instead. It is a
  -- printing-only credential: it can ask for jobs and say "printed", and can reach nothing else.
  token_hash    text NOT NULL,
  -- The machine that first used the code. If a second machine ever reports the same code with a
  -- different fingerprint, that is the "somebody copied the helper file onto another computer"
  -- case: the app FLAGS it instead of silently accepting it, because half the tickets would then
  -- come out in the wrong room. (No paper is duplicated even then — see the claim.)
  fingerprint   text,
  seen_fingerprints jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What that machine told us it can see, e.g. [{"name":"Printer_POS_80","desc":"Zijiang ZJ-80"}].
  -- Every printer dropdown is built from THIS, which is why a printer nobody owns can never be
  -- chosen and a name can never be mistyped.
  printers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Every poll touches this. It is the whole "connected · seen 2s ago" / "last seen 6 minutes ago"
  -- line — the difference between a mystery and a fact when no paper comes out.
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- One press kills a sold, stolen or replaced machine's code. Rows are kept, not deleted, so the
  -- audit of what printed where stays readable.
  revoked_at    timestamptz,
  UNIQUE (restaurant_id, name)
);
ALTER TABLE print_agents ENABLE ROW LEVEL SECURITY;
-- Staff-only, like print_jobs and print_stations: RLS on with NO policies, so only the
-- service-role routes (which always scope by restaurant_id) can read or write it.

-- The two reads that happen constantly: "which helpers does this restaurant have" (admin screen,
-- panels' status line) and "who owns this token" (every single poll).
CREATE INDEX IF NOT EXISTS print_agents_rid_idx ON print_agents (restaurant_id, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS print_agents_token_idx ON print_agents (token_hash);

COMMENT ON TABLE print_agents IS
  'The computers that can print for a restaurant (mig 341). A helper program on each polls print_jobs over outbound HTTPS and prints on the printer named in the job. token_hash is sha-256 of a printing-only credential; printers is what that machine reported it can see, and every printer dropdown is built from it.';

-- ── WHERE the paper goes ─────────────────────────────────────────────────────────────────────
-- All additive with safe defaults, so every row already in the basket stays valid and every
-- existing reader (the kitchen board, the manager's stuck-job strip) keeps working untouched.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES print_agents(id) ON DELETE SET NULL;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS printer  text;
-- What to BUILD, not the built thing: ids and the few flags the document needs (session, order,
-- parcel, banquet event). The document itself is rendered from public/panels/billdoc.js when the
-- helper asks for it, so a job cannot carry a stale copy of a bill and there is never a second
-- layout to drift. It also keeps the row small — this table is polled.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS payload  jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Which machine actually printed it, kept after the fact so "where did that ticket come out?" has
-- an answer that survives a route change.
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS printed_by text;

-- `kind` was CHECK (kind IN ('kot')) because a kitchen ticket was the only thing that queued
-- itself. A bill and a banquet sheet now travel the same road, and 'test' is the admin's "send one
-- page to that printer" button — which must be a real job so it proves the real path, not a
-- special case that can pass while the real one is broken.
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check
  CHECK (kind IN ('kot','bill','banquet','label','test'));

-- THE POLL'S OWN INDEX. Every helper asks "anything for me?" every couple of seconds, and the
-- answer is normally NO — so that question must never cost a scan. Two shapes are asked: jobs
-- already addressed to me, and unaddressed jobs of a kind I am the route for.
CREATE INDEX IF NOT EXISTS print_jobs_agent_idx
  ON print_jobs (restaurant_id, agent_id, status, created_at);
CREATE INDEX IF NOT EXISTS print_jobs_kind_idx
  ON print_jobs (restaurant_id, kind, status, created_at);

COMMENT ON COLUMN print_jobs.printer IS
  'The printer NAME as its own computer knows it ("Printer_POS_80") — not an address, not an IP. Set from the route when a helper claims the job, or by the caller for a test page.';
