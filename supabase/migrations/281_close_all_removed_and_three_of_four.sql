-- 281_close_all_removed_and_three_of_four.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. "OPEN ALL / CLOSE ALL TABLES" IS GONE (owner, 2026-08-04: "we don't even need close
--    every table and all that stuff. So remove that option completely.")
-- 2. THREE of the four findings the sweep left for their own change: F13, F20, F21. F9 was
--    attempted, took every guest menu down, and is deliberately NOT re-attempted here (§2).
--    Two other findings turned out narrower than the sweep claimed; that is recorded, not hidden.
--
-- Additive and idempotent. No row of business data is created, changed or deleted.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. NO BULK OPEN / CLOSE OF A WHOLE FLOOR
-- ═════════════════════════════════════════════════════════════════════════════
-- The owner removed the panel's "⬆ Open all / ⬇ Close all" card on 2026-07-31, because the
-- lifecycle stopped needing it: the first order starts the party and a person taps ✓ Close to
-- end it (mig 254 — "no table ends itself"). The comment left in public/panels/editor/app.js
-- said the server endpoints "still exist and still work; they simply have no caller".
--
-- That is exactly the shape to remove, not keep. `lfh_staff_close_all_tables(rid, force)` walks
-- every open session, closes it, and with force = true cancels food still cooking and bills
-- still unpaid — the most destructive action in the product, sitting behind an endpoint nothing
-- calls. It was also one of the 17 functions mig 267 had to re-lock. An action nobody can reach
-- from a screen but anything can reach over HTTP is a liability, not a feature.
--
-- The route handlers (POST /api/editor/sessions/open-all and /sessions/close-all) are deleted in
-- the same commit. Their activity-log labels ("Opened every table" / "Closed every table") STAY:
-- old staff_actions rows still carry those codes, and the log must keep reading as English.
DROP FUNCTION IF EXISTS lfh_staff_close_all_tables(uuid, boolean);
DROP FUNCTION IF EXISTS lfh_staff_open_all_tables(uuid);

-- ALSO, and this is housekeeping rather than the owner's request: mig 267 dropped
-- lfh_check_ban / lfh_check_ban_scoped as dead (nothing in SQL or app code calls either;
-- lfh_join_session uses lfh_device_banned and eight guest RPCs use lfh_is_blocked). They are
-- present again on the backup database, which means mig 236 — which still CREATES them, to
-- write down a function that had never been in a migration — was re-run on its own after 267.
-- Dropping them again. In a full reseed the order settles it (236 creates, this drops); if 236
-- is ever re-run alone they will come back, and `npm run verify:grants` will say so on the next
-- run rather than leaving two unused functions carrying the default public grant.
DROP FUNCTION IF EXISTS lfh_check_ban(text, text, uuid);
DROP FUNCTION IF EXISTS lfh_check_ban_scoped(text, text, uuid);


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. F9 — ATTEMPTED, IT BROKE EVERY GUEST MENU, AND IT IS NOT BEING RE-ATTEMPTED HERE
-- ═════════════════════════════════════════════════════════════════════════════
-- THE FINDING IS REAL: `settings` and `restaurants` each carry a `USING (true)` read policy for
-- the public role, so the key in every guest's browser can read EVERY restaurant's row WHOLE —
-- measured with the real key: `settings.gstin` readable, `restaurants.access_config` 5,140 bytes
-- of permission tree. The policy cannot simply be dropped: lib/tenant.ts resolves a slug with the
-- anon client, and components/AppShell.tsx subscribes anon to `settings` so a flipped switch
-- reaches an open menu live (Realtime evaluates RLS as the subscriber).
--
-- SO THE FIRST DRAFT OF THIS MIGRATION NARROWED IT BY COLUMN — 20 columns on settings, 11 on
-- restaurants, matching what lib/menu.ts and lib/tenant.ts ask for. **That took the guest menu
-- down on the backup site, for every restaurant.** The mechanism, written down so nobody repeats
-- it:
--
--   · The worktree this was written in was 27 commits behind origin/main. In those commits,
--     mig 270 (item tax mode + MRP) added THREE columns to the guest's own read: `price_tax_mode`,
--     `item_tax_modes_allowed`, `mrp_tax_treatment`. lib/menu.ts now asks for 22 columns, not 19.
--   · The grant listed 19. PostgREST answered `42501 permission denied for table settings`,
--     lib/menu.ts threw its "Failed to load settings", and the menu could not render at all.
--   · The check that was supposed to catch this asserted the column list *I believed* the app
--     read, instead of driving the real page — so it passed. Same failure shape as the
--     green-suite lesson: I verified with a check that could not have caught the fault.
--
-- Another session found it and restored the whole-table grant (mig 274) plus
-- `scripts/verify-guest-read.mjs`, which asks the question the right way — with the ANON key,
-- over HTTP. That guard is the correct one and it stays.
--
-- WHY THIS IS NOT JUST "FIX THE LIST AND TRY AGAIN". A column grant in the database has to stay
-- in lockstep with a column list in the code, and code and migrations do not deploy atomically.
-- Any future migration that adds a guest-read column takes every menu down until someone also
-- widens the grant — a trap with a delay on it, which is exactly what happened. The safe shape is
-- a guest-facing VIEW (or an RPC) that returns the guest payload as ONE object the server owns,
-- so adding a field is one edit in one place. That is a design change and needs its own
-- deliberate pass; it is NOT bundled into a fix for something else.
--
-- So: the guest read stays as mig 274 restored it. The only thing done here is to remove the
-- redundant column-level grants the reverted draft left behind on this database, so a fresh
-- reseed and the live database agree. Under the whole-table grant these permit nothing extra, so
-- this changes what a guest can do by exactly nothing.
REVOKE SELECT (
  id, restaurant_id, bubbles_enabled, service_mode, table_count, sessions_enabled,
  require_location, require_otp, geo_lat, geo_lng, geo_radius_m,
  features, tax_rate, tax_components, google_review_url, google_review_mode,
  menu_enabled, menu_default_layout, menu_default_mode, menu_languages, menu_currencies
) ON public.settings FROM anon, authenticated;
REVOKE SELECT (
  id, slug, name, active, deleted_at,
  logo_text, hero_title, tagline, accent_color, theme, logo_url
) ON public.restaurants FROM anon, authenticated;
-- Re-assert mig 274's grant, so this file leaves the guest read demonstrably intact rather than
-- relying on the reader to know that a table grant outranks a column one. Idempotent.
GRANT SELECT ON TABLE public.settings    TO anon, authenticated;
GRANT SELECT ON TABLE public.restaurants TO anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. F20 — TIPS REACH THE OWNER'S REPORTS
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration 154 stored a tip per order and its own header says "Reports read SUM(orders.tip) as
-- tips collected". Exactly one report does: the manager's Z-report
-- (app/api/editor/[...path]/route.ts). The OWNER's reports read the pre-aggregated rollups, and
-- neither `orders_daily_agg` nor `orders_report_monthly_agg` has a tip column — so an owner had
-- no tips figure at any range, for any restaurant. That is money staff are owed.
--
-- WHY A NEW FUNCTION RATHER THAN A COLUMN ON THE ROLLUPS. The rollups refresh nightly, so a
-- column on them could not answer "today", which is the range an owner looks at most. Reading
-- raw orders answers every range exactly. It is cheap because of the partial index below:
-- almost no order carries a tip, so the index holds only the rows that do and the sum touches
-- nothing else. That keeps the "analytics never scans the orders table" rule intact.
CREATE INDEX IF NOT EXISTS idx_orders_tips
  ON orders (restaurant_id, created_at)
  INCLUDE (tip)
  WHERE tip > 0 AND payment_status = 'paid' AND status <> 'cancelled' AND deleted_at IS NULL;

-- Tips collected in a window, for one restaurant or a whole portfolio. Mirrors the Z-report's
-- rule exactly (PAID, not cancelled) and adds the soft-delete exclusion every money view uses,
-- so the owner's figure and the manager's figure can never disagree.
CREATE OR REPLACE FUNCTION lfh_owner_tips(
  p_restaurant_id uuid,
  p_from timestamptz,
  p_to   timestamptz,
  p_ids  uuid[] DEFAULT NULL
) RETURNS TABLE(tips numeric, tipped_orders bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(o.tip), 0)::numeric AS tips,
         COUNT(*)::bigint                 AS tipped_orders
    FROM orders o
   WHERE (p_ids IS NOT NULL AND o.restaurant_id = ANY (p_ids)
          OR p_ids IS NULL AND p_restaurant_id IS NOT NULL AND o.restaurant_id = p_restaurant_id)
     AND o.created_at >= p_from
     AND o.created_at <  p_to
     AND o.tip > 0
     AND o.payment_status = 'paid'
     AND o.status <> 'cancelled'
     AND o.deleted_at IS NULL;
$$;
-- Both scope arguments NULL would mean "every restaurant on the platform", which is never what
-- an owner asked for. Unlike the older report functions, this one simply returns nothing in that
-- case (the WHERE above cannot be satisfied), so a caller that forgets its scope gets zero
-- rather than the whole platform's tips.
REVOKE ALL ON FUNCTION lfh_owner_tips(uuid, timestamptz, timestamptz, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_tips(uuid, timestamptz, timestamptz, uuid[]) TO service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. F21 — A GUEST CANNOT ORDER ONTO A TABLE THAT DOES NOT EXIST
-- ═════════════════════════════════════════════════════════════════════════════
-- THE SWEEP OVERSTATED THIS ONE, and the correction matters. It said a guest order is "filed
-- under whichever restaurant the request names", implying an order could land on the wrong
-- restaurant. It cannot: `lfh_price_order` looks the dish up as
-- `WHERE id = … AND restaurant_id = v_rid` and its own comment says "a dish that exists but
-- belongs to another restaurant is just as unknown as a made-up id" → `unknown_item`. So an
-- order carrying one restaurant's id and another's dishes is already refused. Verified by
-- reading the shipped function, not assumed.
--
-- What IS real: the table number was never checked. `lfh_staff_open_table` refuses a table above
-- the restaurant's `table_count` ("Table 99 doesn't exist — tables are 1–20."), and
-- `lfh_place_order_public` did not. A guest URL carrying ?table=99 at a 20-table restaurant took
-- the order, opened a session on table 99 and printed a KOT — for a table that appears on no
-- floor tile, because the floor is drawn 1..table_count. The kitchen cooks it and no waiter can
-- see where it goes.
--
-- The rule below is COPIED from lfh_staff_open_table, not invented, so the guest path and the
-- staff path now answer identically:
--   · a table_count of 0 means "no limit configured" and stays permissive (unchanged behaviour)
--   · a non-numeric table is left alone — parcel/takeaway/banquet orders carry no table, and this
--     migration must not introduce a new class of rejection for anything that works today
CREATE OR REPLACE FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := COALESCE(p_restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_order uuid; v_priced jsonb; v_auto boolean := false; v_items jsonb; v_status text;
  v_tbl text := NULLIF(p_table, '');
  v_s sessions;
  v_max int;                 -- NEW (281/F21): this restaurant's highest real table
BEGIN
  -- RATE LIMIT (mig 205): cap public/QR orders per table in the window.
  IF NOT lfh_rate_check(v_rid, 'guest_order', 'table:' || COALESCE(v_tbl, '?'),
                        'Table ' || COALESCE(v_tbl, '?')) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- NEW (mig 281 / F21): THE TABLE MUST EXIST AT THIS RESTAURANT. Same rule and same wording as
  -- lfh_staff_open_table, so the guest path and the staff path agree. Only applied to a numeric
  -- table: a parcel / takeaway / banquet order has none and must stay unaffected.
  IF v_tbl IS NOT NULL AND v_tbl ~ '^\d+$' THEN
    SELECT COALESCE(table_count, 0) INTO v_max FROM settings WHERE restaurant_id = v_rid;
    IF v_max > 0 AND v_tbl::int > v_max THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_table',
        'error', format('Table %s doesn''t exist — tables are 1–%s.', v_tbl, v_max));
    END IF;
    IF v_tbl::int < 1 THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_table',
        'error', 'That table number isn''t valid.');
    END IF;
  END IF;

  -- 253: open-price dishes are staff-priced -- never orderable from a guest device. See the
  -- long note on lfh_place_order in mig 253; same rule, same reason code. (This block was
  -- DROPPED by 264's first draft — the body had been copied from mig 240, but mig 253
  -- redefined this function after 240. The recreate-reverts-a-fix trap, caught in review.)
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE m.open_price
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'staff_priced_item');
  END IF;

  -- Priced against the restaurant the order is FOR (118). This is also what makes an order
  -- carrying another restaurant's dishes impossible: unknown_item.
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- AUTO-ACCEPT FOLLOW-UPS (163). No session here, so "same seating" = this table
  -- has an accepted order that's still unpaid and recent. A paid/settled bill (or a
  -- stale 3h+ order) means a NEW party — their first order needs an Accept again.
  -- NULLIF: an order with no table can never match (comparison stays NULL/false).
  SELECT EXISTS (
    SELECT 1 FROM orders
     WHERE restaurant_id = v_rid
       AND table_number = v_tbl
       AND status IN ('preparing', 'served')
       AND payment_status <> 'paid'
       AND created_at > NOW() - INTERVAL '3 hours'
  ) INTO v_auto;
  IF v_auto THEN
    v_status := 'preparing';
    SELECT COALESCE(jsonb_agg(e || jsonb_build_object('status', 'preparing')), '[]'::jsonb)
      INTO v_items FROM jsonb_array_elements(v_priced->'items') e;
  ELSE
    v_status := 'received';
    v_items  := v_priced->'items';
  END IF;

  -- THE PARTY (2026-07-31). Same lock key as lfh_staff_place_order, so a guest order and a
  -- waiter order arriving together on one table serialise and share ONE session. A takeaway /
  -- no-table order keeps session_id NULL — there is no table to seat.
  -- A MERGED TABLE ORDERS ONTO THE PARTY IT WAS JOINED TO (mig 249/250, extended here
  -- 2026-08-03): a guest at table 7 while 7 is merged into 6 adds their dish to the ONE bill.
  -- Without this the guest's order opened a SECOND party on the joined table — the exact state
  -- mig 260 blocks on lfh_staff_open_table. The order still records table_number = v_tbl below,
  -- so the KOT prints for the guest's own table and an unmerge hands it back exactly.
  IF v_tbl IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || v_tbl, 0));
    SELECT * INTO v_s FROM sessions
      WHERE table_number = lfh_merge_parent_table(v_rid, v_tbl)
        AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_s.id IS NULL THEN
      BEGIN
        INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
          VALUES (v_tbl, 'open', 'guest', NOW(), v_rid)
          RETURNING * INTO v_s;
      EXCEPTION WHEN unique_violation THEN
        -- Another path opened it without taking our lock (idx_one_open_session_per_table).
        -- Losing that race is a success: the table has a party, which is all we wanted.
        SELECT * INTO v_s FROM sessions
          WHERE table_number = v_tbl AND status = 'open' AND restaurant_id = v_rid
          ORDER BY last_activity_at DESC LIMIT 1;
      END;
    END IF;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, restaurant_id)
    VALUES (v_tbl, v_items,
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), v_status, v_s.id, v_rid)
    RETURNING id INTO v_order;

  IF v_s.id IS NOT NULL THEN
    UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  END IF;

  RETURN json_build_object('ok', true, 'order_id', v_order);
END; $function$;

-- Unchanged from mig 264: the guest path needs this, the public roles keep it.
REVOKE ALL ON FUNCTION public.lfh_place_order_public(text, jsonb, text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lfh_place_order_public(text, jsonb, text[], uuid) TO anon, authenticated, service_role;


NOTIFY pgrst, 'reload schema';
