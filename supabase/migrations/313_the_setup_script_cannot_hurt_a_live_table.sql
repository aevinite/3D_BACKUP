-- 311_the_setup_script_cannot_hurt_a_live_table.sql
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Six of the ten problems the T8 sweep of migrations 001–150 found, fixed at the source. Each
-- section says WHERE a real person would have met it before naming a file (owner's rule,
-- 2026-08-12).
--
--  P1  Manager panel → Tables floor: 4 live tables would go Free mid-service, carts emptied and
--      guests thrown off, if anyone re-ran the migration folder. (measured: 27 open tables, 4
--      table numbers open at more than one restaurant)
--  P3  Manager panel → Tables floor + Bills: a re-seed could attach one restaurant's order to
--      ANOTHER restaurant's table. (0 such rows today — latent)
--  P5  Manager + Tablet panel → Tables floor: the floor payload handed every staff device each
--      seated guest's private access pass and device id, and the offline cache kept them.
--  P6  Backend only, nothing on screen: `restaurants` carries a "guests may read this" policy
--      while the database answers "permission denied". A policy that grants nothing.
--  P7  Guest menu → placing an order: a restaurant restored from the bin with table sessions on
--      would refuse EVERY order ('otp_required') for a phone check that was never built.
--  P8  Admin console → Restaurants → create: a new restaurant could start with no settings row,
--      which renders Manager panel → Tables floor with ZERO tables ("this place has no tables").
--  P9  Guest menu → the shared cart: the first-sync write could still silently drop a dish another
--      phone added a moment earlier — the one path migration 144's merge did not cover.
--
-- P1 and P3 are fixed in their OWN files (049, 051) — scoped per restaurant AND wrapped in the
-- `lfh_already_applied` guard migration 307 built. This file records both keys in that ledger, so
-- a database where they have already run (every existing one) skips them for good.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ── P1 + P3. The two one-time blocks can never run again on THIS database ─────────────────────
-- 307 built the ledger for exactly this and used it on 043 + 093. These are the other two that
-- rewrite live rows. A fresh database still runs them once (they sort before 307, when the ledger
-- does not exist yet, which the guard reads as "not applied" — the single legitimate run).
INSERT INTO public.lfh_applied_once (key, note) VALUES
  ('051_one_open_session_per_table',
   'The open-session dedupe. Its PARTITION had no restaurant_id, so on a multi-restaurant database it closed every "table 5" but one, ACROSS restaurants — measured: 4 live tables. Now scoped per restaurant AND recorded here.'),
  ('049_link_orphan_orders',
   'The orphan-order backfill. It matched an open session by table_number alone and created sessions with no restaurant_id (so: restaurant #1), which could hand one restaurant''s order to another''s table. Now scoped per restaurant AND recorded here.')
ON CONFLICT (key) DO NOTHING;

-- ── P6. Drop the read policy that grants nothing ──────────────────────────────────────────────
-- Migration 078 wrote `CREATE POLICY public_read_restaurants … USING (true)`, but the anon role
-- has no SELECT privilege on the table, so reading it with the guest key answers
-- "permission denied for table restaurants". The BEHAVIOUR is right — migration 282 moved guest
-- reads behind one door (lfh_guest_restaurant) — so the policy is the part that lies. It also made
-- verify:grants count a "wide-open read policy" that opens nothing. Guests are unaffected: they
-- never read this table directly.
DROP POLICY IF EXISTS public_read_restaurants ON public.restaurants;

COMMENT ON TABLE public.restaurants IS
  'Tenant root. NOT readable with the guest/anon key by design — a guest reaches its own restaurant through lfh_guest_restaurant() (mig 282). The public read POLICY migration 078 created was dropped in 311: it had no matching GRANT, so it granted nothing and only misled the next reader.';

-- ── P7. Finish the default that was flipped without a backfill ─────────────────────────────────
-- `require_otp` shipped NOT NULL DEFAULT true (mig 014) for a phone check that was shelved and
-- never built (mig 018's own note). lfh_place_order refuses with 'otp_required' whenever it is true
-- and the diner is not phone-verified. Migration 304 corrected the DEFAULT but left the rows that
-- already said true — the middle step of this project's own rule (default → BACKFILL → enforce).
-- Measured: 3 of 16 settings rows still true, all three restaurants currently in the recycle bin
-- with table sessions off. Restore one, switch sessions on, and every guest order dies.
DO $reseed_guard$
BEGIN
IF lfh_already_applied('311_require_otp_backfill') THEN
  RAISE NOTICE '311_require_otp_backfill: already applied — skipped';
  RETURN;
END IF;
UPDATE public.settings SET require_otp = false WHERE require_otp;
INSERT INTO public.lfh_applied_once (key, note) VALUES
  ('311_require_otp_backfill', 'Turned off a phone check that was never built, on the rows mig 304 left behind. One-time: an owner who deliberately turns it on later must not have it turned off again.')
ON CONFLICT (key) DO NOTHING;
END $reseed_guard$;

-- ── P8. A restaurant can never be created without its settings row ────────────────────────────
-- 296 §5 added this trigger because a restaurant with no settings row renders a floor with ZERO
-- tiles (lfh_floor_state / lfh_table_view_summary read table_count from it, and GREATEST(NULL,0)
-- is 0). But the INSERT names `settings.id` — a COPY of the slug, left over from the single-
-- restaurant days — with a blanket ON CONFLICT DO NOTHING. A clash on EITHER key silently
-- produced no row, i.e. exactly the empty floor it exists to prevent. Now: the conflict target is
-- the key that actually matters, and the id is made unique per restaurant so it cannot collide
-- with a slug some other (or binned) restaurant already holds.
CREATE OR REPLACE FUNCTION public.lfh_settings_follow_restaurant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  -- id keeps carrying the slug because that is what it has always held and some tooling reads it,
  -- but it can no longer be the reason a restaurant ends up with no settings: on a collision it
  -- falls back to the restaurant's own id, which is unique by construction.
  INSERT INTO settings (id, restaurant_id)
  VALUES (CASE WHEN EXISTS (SELECT 1 FROM settings s WHERE s.id = NEW.slug)
               THEN NEW.id::text ELSE NEW.slug END,
          NEW.id)
  ON CONFLICT (restaurant_id) DO NOTHING;
  RETURN NULL;
END; $function$;
REVOKE ALL ON FUNCTION public.lfh_settings_follow_restaurant() FROM PUBLIC, anon, authenticated;

-- ── P9. The shared cart's last overwrite path can no longer lose a dish ───────────────────────
-- Guest menu → cart. Migration 144 added lfh_merge_cart because writing the WHOLE array loses a
-- dish when two diners add within a second of each other. One path still writes the whole array:
-- the FIRST sync for a session (components/SessionCartSync.tsx), which reads the server cart,
-- unions it with the local one and writes the result. If another phone adds a dish between that
-- read and that write, the dish is gone — silently, which is the one thing the owner's
-- no-silent-overwrites rule forbids.
-- The fix is additive: an optional p_seen. A caller that passes the cart_updated_at it READ gets
-- refused with 'cart_moved' if the cart has moved on since (and the current cart back, so it can
-- adopt it and try again). A caller that passes nothing behaves exactly as before, so a guest
-- phone running an older cached build is no worse off than today.
CREATE OR REPLACE FUNCTION public.lfh_set_cart(p_token text, p_cart jsonb, p_seen timestamptz DEFAULT NULL)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_m session_members; v_s sessions; v_ts timestamptz;
BEGIN
  SELECT * INTO v_m FROM session_members WHERE token = p_token AND NOT removed;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  -- Lock the row so the check and the write cannot straddle another device's merge.
  SELECT * INTO v_s FROM sessions WHERE id = v_m.session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'invalid_token'); END IF;
  IF v_s.status <> 'open' THEN RETURN json_build_object('ok', false, 'reason', 'session_closed'); END IF;
  IF NOT v_m.approved THEN RETURN json_build_object('ok', false, 'reason', 'not_approved'); END IF;
  -- FIRST SAVE WINS, AND THE LOSER IS TOLD (never a silent overwrite).
  IF p_seen IS NOT NULL AND v_s.cart_updated_at IS NOT NULL AND v_s.cart_updated_at > p_seen THEN
    RETURN json_build_object('ok', false, 'reason', 'cart_moved',
                             'cart', COALESCE(v_s.cart, '[]'::jsonb),
                             'cart_updated_at', v_s.cart_updated_at);
  END IF;
  v_ts := NOW();
  UPDATE sessions SET cart = COALESCE(p_cart, '[]'::jsonb), cart_updated_at = v_ts, last_activity_at = v_ts
    WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'cart_updated_at', v_ts);
END; $function$;
-- Same reachability as migration 019: a guest-facing, token-scoped RPC. The 2-arg signature is
-- REPLACED by this 3-arg one (the third argument defaults), so the existing anon grant follows it;
-- re-granted explicitly because a DEFAULTed extra parameter creates a new signature.
REVOKE ALL ON FUNCTION public.lfh_set_cart(text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lfh_set_cart(text, jsonb, timestamptz) TO anon;
DROP FUNCTION IF EXISTS public.lfh_set_cart(text, jsonb);

-- ── P5. The floor stops handing out each guest's private access pass ──────────────────────────
-- Manager + Tablet panel → Tables floor. lfh_floor_bundle's member list was `json_agg(m)` — the
-- WHOLE session_members row, which carries `token`: the random string a guest's phone sends with
-- every tap, and therefore that guest's identity for ordering, calling a waiter and editing the
-- shared cart. Nothing on the floor draws it, but it reached every staff device on every floor
-- load and every ?table=N refetch, and the panels are offline-first, so it was written into the
-- device's cache and sat there long after the guests left.
-- Now the payload names the fields the floor actually renders. `phone` STAYS — the panel bans and
-- blocks by it and shows it on the guest row (app.js: data-ban-phone, data-block-phone, "Phone").
-- `token` and `device_id` are gone; a device ban still works because it resolves the device from
-- the member id server-side (mig 077).
CREATE OR REPLACE FUNCTION public.lfh_floor_bundle(p_restaurant_id uuid, p_table text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT * FROM sessions
    WHERE restaurant_id = p_restaurant_id
      AND status <> 'closed'
      AND (p_table IS NULL OR table_number = p_table)
  )
  SELECT json_build_object(
    'sessions',  COALESCE((SELECT json_agg(x ORDER BY x.last_activity_at DESC) FROM s x), '[]'::json),
    'members',   COALESCE((SELECT json_agg(json_build_object(
                               'id', m.id, 'session_id', m.session_id, 'name', m.name,
                               'role', m.role, 'approved', m.approved,
                               'phone', m.phone, 'phone_verified', m.phone_verified, 'joined_at', m.joined_at,
                               'removed', m.removed
                             ) ORDER BY m.joined_at)
                             FROM session_members m
                            WHERE m.session_id IN (SELECT id FROM s) AND NOT m.removed), '[]'::json),
    'items',     COALESCE((SELECT json_agg(i ORDER BY i.created_at)
                             FROM order_items i
                            WHERE i.session_id IN (SELECT id FROM s)), '[]'::json),
    'requests',  COALESCE((SELECT json_agg(r ORDER BY r.created_at)
                             FROM requests r
                            WHERE r.restaurant_id = p_restaurant_id AND r.status = 'pending'
                              AND (p_table IS NULL OR r.table_number = p_table)), '[]'::json),
    'blocklist', COALESCE((SELECT json_agg(b ORDER BY b.blocked_at DESC)
                             FROM blocklist b
                            WHERE b.restaurant_id = p_restaurant_id), '[]'::json),
    -- TAG: the board's marks (tiny table: at most one row per table).
    'table_tags', COALESCE((SELECT json_agg(json_build_object(
                              'table_number', t.table_number, 'tag', t.tag))
                             FROM table_tags t
                            WHERE t.restaurant_id = p_restaurant_id
                              AND (p_table IS NULL OR t.table_number = p_table)), '[]'::json)
  );
$function$;

-- ── Tell PostgREST about the new signature ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
