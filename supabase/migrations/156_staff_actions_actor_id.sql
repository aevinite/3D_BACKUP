-- 156 — staff_actions.actor_id + nullable restaurant_id.
--
-- ⚠ MIGRATION NUMBER: next free after 155 (google_review_url). If a parallel branch already
--   took 156, renumber to the next free slot — this is a plain additive ALTER + index and is
--   correct at ANY number (no ordering dependency).
--
-- WHY (admin "owner activity" feed, audit 2026-07-09): the feed matched an owner's actions by
-- their display NAME, which
--   (a) MISSED the owner's own panel actions — those log actor = the ROLE literal "owner", not
--       their name — and admin-on-owner actions, whose detail carried the owner's NAME, not id; and
--   (b) SURFACED a same-named staff member's rows under the wrong owner (names are unique only
--       per-restaurant).
-- actor_id gives a stable, unambiguous key: the owner's own panel actions now carry
-- actor_id = their user id, and the feed matches on it (plus the owner-id embedded in detail for
-- admin-on-owner actions) instead of the fragile name.
--
-- Separately, owner-LEVEL admin actions (create / rename / suspend an owner) have no restaurant,
-- so under the NOT NULL column they defaulted to restaurant #1 and polluted #1's manager log.
-- Dropping NOT NULL lets those be recorded as platform-level (NULL restaurant_id) instead. The
-- column keeps its DEFAULT #1 (mig 078), so existing callers that omit restaurant_id are unchanged.
--
-- Purely ADDITIVE & non-breaking: a new nullable column, one dropped NOT NULL, one partial index.
-- No data rewrite; existing inserts keep working exactly as before.

ALTER TABLE staff_actions ADD COLUMN IF NOT EXISTS actor_id uuid;
ALTER TABLE staff_actions ALTER COLUMN restaurant_id DROP NOT NULL;

-- The feed filters by actor_id, newest-first — a partial index keeps that cheap as the log grows.
CREATE INDEX IF NOT EXISTS idx_staff_actions_actor_id
  ON staff_actions (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
