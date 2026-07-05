-- Restaurant RECYCLE BIN (soft-delete) — admin can move a whole restaurant to a
-- 90-day recycle bin, restore it, or (only after 90 days) permanently purge it.
--
-- Design (see app/api/admin/restaurants/route.ts for the actions):
--   • deleted_at NULL      → live / suspended as before (unchanged behaviour).
--   • deleted_at SET       → in the recycle bin. The guest resolver treats it as
--                            gone (404) and staff logins are blocked — exactly
--                            like a suspended restaurant, but reversible + purgeable.
--   • purge (hard delete)  → allowed ONLY once now() >= deleted_at + 90 days;
--                            enforced in the API, never automatic.
--
-- Additive + nullable → existing rows are untouched (every current restaurant
-- stays live). No backfill, no NOT NULL, no data change. Safe on the live DB.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;      -- when it went to the bin (NULL = not deleted)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS deleted_by    text;             -- who moved it (admin actor label)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS delete_reason text;             -- optional note shown in the bin

-- The recycle-bin listing filters WHERE deleted_at IS NOT NULL. A partial index
-- keeps that read cheap and never touches the hot "live restaurants" path (those
-- rows aren't in this index at all).
CREATE INDEX IF NOT EXISTS idx_restaurants_deleted_at
  ON restaurants (deleted_at)
  WHERE deleted_at IS NOT NULL;

-- ── admin_purge_restaurant(p_rid) ─────────────────────────────────────────────
-- PERMANENTLY erase a restaurant and every row it owns, ATOMICALLY (one txn —
-- either the whole restaurant is gone or nothing changed; a half-purged tenant is
-- impossible). Each tenant table's restaurant_id → restaurants FK has NO cascade
-- (migration 078), so every child table must be cleared before the restaurants
-- row. order_items/session_members/feedback cascade off orders/sessions, but we
-- delete them explicitly too so the order is obvious and robust.
--
-- Two hard guards live HERE (defense-in-depth, not only in the API):
--   1. Restaurant #1 (the seeded default) can NEVER be purged.
--   2. Purge is refused unless the restaurant is in the bin AND its 90-day
--      retention window has fully elapsed. There is deliberately NO early-purge
--      override — trashed means untouchable for 90 days, for everyone.
CREATE OR REPLACE FUNCTION admin_purge_restaurant(p_rid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r restaurants%ROWTYPE;
BEGIN
  SELECT * INTO r FROM restaurants WHERE id = p_rid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant % not found', p_rid;
  END IF;
  IF p_rid = '00000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'The default restaurant can never be purged';
  END IF;
  IF r.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Restaurant is not in the recycle bin — delete it first';
  END IF;
  IF now() < r.deleted_at + interval '90 days' THEN
    RAISE EXCEPTION 'Retention lock: this restaurant cannot be purged until 90 days after deletion (deleted_at=%)', r.deleted_at;
  END IF;

  -- Grandchildren / children first (explicit; cascade would also handle some).
  DELETE FROM order_items       WHERE restaurant_id = p_rid;
  DELETE FROM payments          WHERE restaurant_id = p_rid;
  DELETE FROM aggregator_orders WHERE restaurant_id = p_rid;
  DELETE FROM feedback          WHERE restaurant_id = p_rid;
  DELETE FROM reviews           WHERE restaurant_id = p_rid;
  DELETE FROM waiter_calls      WHERE restaurant_id = p_rid;
  DELETE FROM requests          WHERE restaurant_id = p_rid;
  DELETE FROM session_members   WHERE restaurant_id = p_rid;
  DELETE FROM orders            WHERE restaurant_id = p_rid;
  DELETE FROM sessions          WHERE restaurant_id = p_rid;

  -- Menu + catalogue.
  DELETE FROM menu_items        WHERE restaurant_id = p_rid;
  DELETE FROM categories        WHERE restaurant_id = p_rid;
  DELETE FROM filters           WHERE restaurant_id = p_rid;

  -- People + auth + misc tenant data.
  DELETE FROM customers          WHERE restaurant_id = p_rid;
  DELETE FROM blocklist          WHERE restaurant_id = p_rid;
  DELETE FROM otp_codes          WHERE restaurant_id = p_rid;
  DELETE FROM verification_codes WHERE restaurant_id = p_rid;
  DELETE FROM staff_actions      WHERE restaurant_id = p_rid;
  DELETE FROM realtime_events    WHERE restaurant_id = p_rid;
  DELETE FROM daily_counters     WHERE restaurant_id = p_rid;
  DELETE FROM seq_counters       WHERE restaurant_id = p_rid;

  -- Owner links + platform billing (these cascade off restaurants, but clear
  -- them first so nothing references the restaurant when we delete it).
  DELETE FROM restaurant_owners   WHERE restaurant_id = p_rid;
  DELETE FROM restaurant_payments WHERE restaurant_id = p_rid;
  DELETE FROM restaurant_billing  WHERE restaurant_id = p_rid;
  DELETE FROM issues              WHERE restaurant_id = p_rid;

  -- Null out the owner pointer, then drop staff logins + settings, then the row.
  UPDATE restaurants SET owner_user_id = NULL WHERE id = p_rid;
  DELETE FROM staff_users WHERE restaurant_id = p_rid;
  DELETE FROM settings    WHERE restaurant_id = p_rid;
  DELETE FROM restaurants WHERE id = p_rid;
END;
$$;

-- Lock it down (migration 038 convention): a purge is admin-only, run via the
-- service role from the admin API — never callable by anon/authenticated.
REVOKE ALL ON FUNCTION admin_purge_restaurant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_purge_restaurant(uuid) TO service_role;
