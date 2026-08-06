-- 305 — THE PUBLIC ERROR-LOG'S OWN FLOOD CAP HAD NO INDEX BEHIND IT (T9 sweep, 2026-08-06)
--
-- (Numbered 304 when written; renumbered to 305 because the T8 database sweep merged its own 304
-- while this branch was in flight — same precedent as "renumber this branch's 295 to 296". The body
-- is unchanged, and it was already applied to the backup dev DB under the old name; CREATE INDEX
-- IF NOT EXISTS makes a re-run a no-op.)
--
-- `/api/log/client-error` is one of the deliberately-PUBLIC endpoints (docs/CLAUDE-DETAIL.md). It was
-- hardened twice for flooding — a per-device cap on 2026-08-04, then a separate ceiling for the
-- `taps` branch on 2026-08-05 — and that cap is enforced by counting the caller's own recent rows:
--
--     from("staff_actions").select("id")
--       .eq("device_id", capKey).eq("action", action).gte("created_at", <10 min ago>).limit(max)
--
-- Every existing index on staff_actions leads with a DIFFERENT column:
--     042  (created_at DESC)
--     098  (restaurant_id, created_at DESC)
--     156  (actor_id, created_at DESC)          WHERE actor_id IS NOT NULL
--     159  (restaurant_id, created_at DESC)     WHERE level = 'error'
--     182  (created_at DESC)                    WHERE level = 'error' AND seen_at IS NULL
--
-- Nothing covers `device_id` or `action`. So the cap's own query walks the created_at index across
-- the last ten minutes of the WHOLE PLATFORM's activity and filters in memory — and in the common
-- case there is no early exit, because `.limit(5)` can only stop once five MATCHING rows are found,
-- and a well-behaved device has none. That is the opposite of what the cap was added for: the guard
-- protecting the database became the most expensive part of a public request.
--
-- CLAUDE.md's own rule is "index every filtered column". This was the one public write path where it
-- had not been done.
--
-- SHAPE. Leading (device_id, action) because both are equality filters, then created_at DESC so the
-- ten-minute window is a range scan at the front of the matching rows rather than a filter over them.
-- Partial on `device_id IS NOT NULL`: the column is null for most log rows (only the panels and this
-- endpoint stamp it), so the index stays small and never has to cover the bulk of the table.
--
-- ADDITIVE: nothing reads differently, the same rows come back. Purely a cost fix.
--
-- Plain CREATE INDEX (not CONCURRENTLY), matching migration 230's note: a migration runs inside a
-- transaction, so CONCURRENTLY is not available, and this briefly blocks writes to `staff_actions`.
-- Cheap here — the table is ~29k rows on backup (measured 2026-08-06) and the index is PARTIAL, so
-- it only covers the panel/beacon rows that carry a device_id. Still, run it off-peak.

CREATE INDEX IF NOT EXISTS idx_staff_actions_device_action_created
  ON staff_actions (device_id, action, created_at DESC)
  WHERE device_id IS NOT NULL;

-- Why not add `level` too: the cap counts by action ('client_error' / 'ui_taps'), and level is
-- decided BY the action at every call site, so it would add width for no extra selectivity.
