-- 320_a_power_taken_off_one_person_reaches_their_screen.sql
--
-- THE SAME BUG MIG 299 §B FIXED, ONE TABLE OVER (T13 sweep, 2026-08-13).
--
-- Mig 299 §B fixed it for the powers that live on `restaurants` (manager_permissions,
-- access_config, owner_entitlements) and wrote down exactly why it matters:
--
--     "the owner could ring the admin to take a power off a manager 'right now', the admin did it,
--      and the manager's open screen kept offering the control until somebody reloaded the page.
--      Nothing was ever exposed … but the screen disagreed with the truth, and the next tap died
--      with an error, which is exactly what the tap-never-vanishes rule exists to prevent."
--
-- Every word of that is still true for the PER-PERSON powers, which live somewhere else:
-- `staff_users.permissions` (mig 115) — the JSONB map behind **owner panel → Staff → a person →
-- Access tab** and **admin console → Users**. Take the discount power off ONE waiter and their
-- tablet, open in their hand, keeps drawing the button until someone reloads it.
--
-- EVERYTHING NEEDED WAS ALREADY BUILT. The only missing link was the announcement:
--   · /whoami already answers with the person's own overrides
--     (app/api/editor/[...path]/route.ts — `person.permissions` / `g.user.permissions`);
--   · both panels already re-read it and repaint only when the answer differs
--     (public/panels/editor/app.js refreshWhoami() and public/panels/tablet/app.js — twins);
--   · both already call it from their `menu` topic handler.
-- Nothing published, so nothing ever called it.
--
-- WHY A SECOND TRIGGER INSTEAD OF WIDENING THE EXISTING ONE. `staff_users` already carries
-- rt_emit_staff_tables (mig 222) for `assigned_tables`, and that one routes through lfh_rt_emit()
-- → the generic ELSE branch → topic 'ops' with table_number NULL → "reload the WHOLE floor on
-- every device". That is the right cost for a section change (it moves many tables at once) and the
-- WRONG cost for a permission change: an unscopable `ops` breadcrumb is precisely what mig 267
-- moved staff_actions OFF `ops` to avoid, and what mig 299 §B chose the `menu` topic to dodge.
-- So the columns are split across two triggers with two different topics — the same shape mig 109
-- used when it split the sessions trigger to keep cart edits off `ops`.
--
-- WHY THE 'menu' TOPIC, copied from mig 299 §B's reasoning: all three staff panels already
-- subscribe to it, it is the cheap one, and it is the topic whose handler calls refreshWhoami().
-- A permission change is a rare, deliberate admin/owner action.
--
-- WHY ITS OWN FUNCTION AND NOT lfh_rt_emit(): same reason as lfh_rt_emit_access (299),
-- lfh_rt_emit_cart (109) and lfh_rt_emit_platform (071) — this one has to pick the topic and the
-- kind itself. It reads `restaurant_id`, which staff_users has had since mig 078 (mig 091 indexes
-- it), so the scope is real and a panel for another restaurant never hears this.
--
-- Additive: one function, one trigger. No column added, no row touched, nothing dropped.
-- Mig 222's own trigger is left exactly as it is.

BEGIN;

CREATE OR REPLACE FUNCTION lfh_rt_emit_staff_perms() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rid uuid;
BEGIN
  -- COALESCE(NEW, OLD) is not needed: this trigger is UPDATE-only, so NEW is always present.
  -- A staff row with no restaurant would be a broken row; skip rather than mis-file it under #1,
  -- because a breadcrumb sent to the wrong restaurant is worse than one not sent at all — it makes
  -- somebody ELSE's panel re-read /whoami for a change that was not theirs.
  v_rid := NEW.restaurant_id;
  IF v_rid IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
      VALUES ('menu', 'access', NEW.id::text, NULL, v_rid);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION lfh_rt_emit_staff_perms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_rt_emit_staff_perms() TO service_role;

-- `kind = 'access'` deliberately matches mig 299 §B: to a panel these are the same event ("your
-- powers may have changed, re-read them"), and the handler does not branch on kind.
--
-- The WHEN clause matters as much as the column list: `permissions` is written by a read-merge-write
-- (app/api/owner/staff/route.ts and app/api/admin/users/route.ts both `update({ permissions: merged })`),
-- so a save that changes nothing would otherwise publish a breadcrumb to every panel in the
-- restaurant. IS DISTINCT FROM on jsonb compares the VALUE, so a re-save of an identical map is
-- silent — and key order does not matter, because Postgres normalises jsonb on storage.
DROP TRIGGER IF EXISTS rt_emit_staff_perms ON staff_users;
CREATE TRIGGER rt_emit_staff_perms
  AFTER UPDATE OF permissions ON staff_users
  FOR EACH ROW
  WHEN (OLD.permissions IS DISTINCT FROM NEW.permissions)
  EXECUTE FUNCTION lfh_rt_emit_staff_perms();

COMMIT;

NOTIFY pgrst, 'reload schema';
