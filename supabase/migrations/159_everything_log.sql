-- 159 — "Everything Log": add a severity LEVEL to staff_actions + record manual
-- database edits on the low-write config tables.
--
-- ⚠ MIGRATION NUMBER: next free after 158 (retention_one_month_max). If a parallel branch
--   already took 159, renumber to the next free slot — this is purely additive (one column,
--   one partial index, four AFTER triggers) and correct at ANY number, no ordering dependency.
--
-- WHY: the app already writes a who-did-what diary into staff_actions (via lib/oplog.ts
-- logAction). Two things were missing for real-time incident support:
--   (1) a SEVERITY so error rows stand out from ordinary actions (the admin log can then show
--       errors in red and the alert/nightly-agent tooling can query "just the errors" cheaply);
--   (2) footprints for MANUAL database edits — when the owner or Claude changes a row directly
--       in Supabase (not through a panel), nothing was recorded. Now the config tables leave a
--       diary line too, so "who changed this and when" is always answerable.
--
-- SCOPE OF THE TRIGGERS — config tables ONLY (menu_items, categories, settings, restaurants).
-- Deliberately NOT on orders / sessions / order_items: those are hot, high-write tables and the
-- app routes ALREADY log every order/bill action through logAction — a trigger there would
-- double-log every single order and multiply writes (egress rule). Config tables change rarely,
-- so one row per manual edit is cheap and genuinely useful.
--
-- Purely ADDITIVE & non-breaking. Existing logAction inserts default level='info' automatically.

-- 1) Severity column. Default 'info' so every existing caller is unchanged.
ALTER TABLE staff_actions
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'info'
  CHECK (level IN ('info', 'warn', 'error'));

-- 2) Cheap "just the errors" read for the admin error feed + alert tooling, as the log grows.
CREATE INDEX IF NOT EXISTS idx_staff_actions_error
  ON staff_actions (restaurant_id, created_at DESC)
  WHERE level = 'error';

-- 3) Manual-edit footprint trigger. Fires AFTER a direct UPDATE/DELETE on a config table and
--    writes ONE staff_actions row tagged panel='db' (so it's distinguishable from panel actions
--    and can be hidden from the manager's own log — admin sees everything). It records WHICH
--    table and WHICH row changed, at level 'warn'. It does NOT try to diff every column value
--    (cheap + avoids dumping large JSONB); the row id + table + op is enough to know where to look.
--
--    SAFETY: wrapped so a logging failure can NEVER block or roll back the real edit
--    (matches lib/oplog.ts's fire-and-forget contract). Also skips rows that carry an
--    app-set marker is impossible here (triggers can't see app intent), so instead we keep the
--    write tiny and tolerate that panel edits to these tables ALSO leave a 'db' row — that is
--    acceptable: config-table edits are rare, and a duplicate footprint is harmless (unlike on
--    the hot order tables, which is exactly why those are excluded).
CREATE OR REPLACE FUNCTION lfh_log_manual_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rid  uuid;
  v_row  text;
  v_op   text := lower(TG_OP);
  v_rec  jsonb;
BEGIN
  BEGIN
    -- Use NEW for update, OLD for delete.
    v_rec := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    -- Row identifier for the diary line (id, else slug).
    v_row := COALESCE(v_rec ->> 'id', v_rec ->> 'slug', '?');
    -- The restaurants table's OWN id IS the restaurant id (no restaurant_id column); every other
    -- config table carries a restaurant_id. NULLIF guards against a non-uuid text id (settings 'site').
    IF TG_TABLE_NAME = 'restaurants' THEN
      v_rid := NULLIF(v_rec ->> 'id', '')::uuid;
    ELSE
      v_rid := (v_rec ->> 'restaurant_id')::uuid;
    END IF;

    INSERT INTO staff_actions (panel, action, detail, restaurant_id, level)
    VALUES (
      'db',
      'row_change',
      TG_TABLE_NAME || ' ' || v_op || ' (' || left(v_row, 40) || ')',
      v_rid,                       -- may be NULL for the legacy settings id='site' row; that's fine (nullable since mig 156)
      'warn'
    );
  EXCEPTION WHEN OTHERS THEN
    /* never let the footprint break the real edit */
  END;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- Attach to the four config tables (drop-then-create so re-running the migration is safe).
DROP TRIGGER IF EXISTS trg_manual_edit_menu_items ON menu_items;
CREATE TRIGGER trg_manual_edit_menu_items
  AFTER UPDATE OR DELETE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION lfh_log_manual_edit();

DROP TRIGGER IF EXISTS trg_manual_edit_categories ON categories;
CREATE TRIGGER trg_manual_edit_categories
  AFTER UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION lfh_log_manual_edit();

DROP TRIGGER IF EXISTS trg_manual_edit_settings ON settings;
CREATE TRIGGER trg_manual_edit_settings
  AFTER UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION lfh_log_manual_edit();

DROP TRIGGER IF EXISTS trg_manual_edit_restaurants ON restaurants;
CREATE TRIGGER trg_manual_edit_restaurants
  AFTER UPDATE OR DELETE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION lfh_log_manual_edit();

REVOKE ALL ON FUNCTION lfh_log_manual_edit() FROM PUBLIC, anon, authenticated;
-- (SECURITY DEFINER trigger fn; no direct grant needed — it runs as table owner on the trigger.)

NOTIFY pgrst, 'reload schema';
