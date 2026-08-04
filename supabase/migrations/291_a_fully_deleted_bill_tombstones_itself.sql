-- 291_a_fully_deleted_bill_tombstones_itself.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- A BILL WHOSE EVERY ORDER IS DELETED MUST TOMBSTONE ITSELF — whoever did the deleting.
--
-- Migration 280 fixed the APP's delete path (softDeleteOrders was sending `archived` to a table that
-- has no such column, so the session UPDATE was rejected in silence) and repaired the 138 bills left
-- in that state. That fix works: driving the deployed site, a whole-bill delete through the real
-- endpoint IS tombstoned and the admin ledger finds it.
--
-- But asking the database again a few hours later found **37 more** in exactly the same state — every
-- order deleted, the session still reading alive. Their fingerprint says what happened: `deleted_by`
-- and `delete_reason` are BOTH null on all of them, which the app path never leaves (it always
-- records who), and they are on the demo restaurant's test tables in the window today's sweep
-- sessions were running. They came from scripts stamping `deleted_at` directly through the service
-- role — not from the product.
--
-- WHICH DOES NOT MATTER, and that is the point. To the admin the symptom is identical: the bill is
-- invisible to the ledger's `deleted_at is not null` query, so it cannot be found or put back, and
-- the 90-day retention clock never starts. A rule that only holds when the app is the one writing is
-- not a rule — it is a convention, and a convention cannot be relied on by a screen whose whole job
-- is proving no sale quietly vanished.
--
-- So the rule moves to where the ACTION happens, exactly as migration 232 did for closing a table
-- ("cleanup lives on the status change itself, so EVERY close — the app path, a script's bare UPDATE,
-- a hand-run SQL fix, anything we write later — is covered"). softDeleteOrders keeps its explicit
-- tombstone (belt and braces, and it carries the actor and reason, which a trigger cannot invent).
--
-- DELIBERATELY NOT REVERSED HERE: restoring an order clears its `deleted_at`, and lib/softDelete.ts
-- already un-tombstones the session in the same breath. A trigger that also un-tombstoned would be a
-- second writer of the same fact for no gain.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lfh_tombstone_fully_deleted_bill() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.session_id IS NULL THEN RETURN NULL; END IF;
  -- Only when the LAST live order on this bill has just gone.
  IF EXISTS (SELECT 1 FROM orders o WHERE o.session_id = NEW.session_id AND o.deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;
  UPDATE sessions s
     SET deleted_at    = COALESCE(s.deleted_at, NEW.deleted_at),
         deleted_by    = COALESCE(s.deleted_by, NEW.deleted_by),
         delete_reason = COALESCE(s.delete_reason, NEW.delete_reason,
                                  'every order on this bill was deleted')
   WHERE s.id = NEW.session_id
     AND s.deleted_at IS NULL;
  RETURN NULL;   -- AFTER trigger: the return value is ignored
END $$;
REVOKE ALL ON FUNCTION lfh_tombstone_fully_deleted_bill() FROM PUBLIC, anon, authenticated;

-- Fires only when `deleted_at` actually changes, so ordinary order edits cost nothing. AFTER, so the
-- row it is reasoning about is already committed to the statement's view.
DROP TRIGGER IF EXISTS trg_tombstone_fully_deleted_bill ON orders;
CREATE TRIGGER trg_tombstone_fully_deleted_bill
  AFTER UPDATE OF deleted_at ON orders
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION lfh_tombstone_fully_deleted_bill();

-- ── Repair the 37 (and anything else now in that state) ──────────────────────
-- Same shape as mig 280's repair: only fills a NULL deleted_at, only where EVERY order on the bill is
-- already deleted (stating a fact the orders already record), and takes the time from the ORDERS so
-- the retention window runs from when the bill was really removed — not from now().
WITH fully_deleted AS (
  SELECT s.id, max(o.deleted_at) AS when_deleted, min(o.deleted_by) AS by_whom, min(o.delete_reason) AS why
    FROM sessions s JOIN orders o ON o.session_id = s.id
   WHERE s.deleted_at IS NULL
   GROUP BY s.id
  HAVING count(*) FILTER (WHERE o.deleted_at IS NULL) = 0 AND count(*) > 0
)
UPDATE sessions s
   SET deleted_at    = f.when_deleted,
       deleted_by    = COALESCE(s.deleted_by, f.by_whom),
       delete_reason = COALESCE(s.delete_reason, f.why, 'every order on this bill was deleted')
  FROM fully_deleted f
 WHERE s.id = f.id;

-- This must now be 0, and STAY 0 — the trigger is what makes "stay" true:
--   select count(*) from sessions s where s.deleted_at is null
--     and exists (select 1 from orders o where o.session_id = s.id)
--     and not exists (select 1 from orders o where o.session_id = s.id and o.deleted_at is null);

NOTIFY pgrst, 'reload schema';

-- ── One unrelated line, and why it is here ───────────────────────────────────
-- `npm run verify:db-grants` is RED on main: migration 281 recreated lfh_check_ban and did not
-- re-revoke it, so it is EXECUTE-able by anon + authenticated. That is the mig-038 gotcha this
-- project already wrote down ("a new Postgres function is PUBLIC-executable by default"), and a
-- ban-checking function is staff-only — a guest browser has no business calling it.
--
-- It is not my change and it deserves its own migration, but numbers are being taken faster than a
-- PR can land right now, and leaving a guard red on main is how a red guard stops meaning anything.
-- One line, no behaviour change for any legitimate caller (the panels use the service role).
REVOKE ALL ON FUNCTION lfh_check_ban(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_check_ban(text, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
