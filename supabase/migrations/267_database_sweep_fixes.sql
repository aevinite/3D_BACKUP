-- 267_database_sweep_fixes.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- The database-layer sweep (terminal 8 of the 2026-08-04 whole-product sweep) read all
-- 266 migrations against the live catalog. This migration fixes what it found. Every
-- item below names the finding it closes and the migration whose intent had drifted.
--
--  F1  17 staff-only functions were EXECUTE-able by anon/authenticated even though the
--      migrations revoke them by name. Re-locked here, and now GUARDED by
--      `npm run verify:grants` so it can never drift silently again.
--  F2  lfh_resolve_open_requests() had NO restaurant filter — one restaurant opening its
--      table 5 approved another restaurant's pending "open table 5" request.
--  F3  staff_actions breadcrumbs rode the `ops` topic, so every activity-log row made
--      every open staff panel re-read the WHOLE floor. Moved to its own `audit` topic.
--  F5  realtime_events carried a 14 MB index that has never been scanned once (nothing
--      SELECTs that table — Realtime reads the WAL). Dropped.
--  F6  The sessions breadcrumb watch-list missed columns added after mig 096, so the
--      bill's named customer / discount note never reached another device live.
--  F10 session_payments had no breadcrumb, so a part-payment was invisible for 60s.
--  F11 Six functions nothing calls — including one that still ends tables, against the
--      owner's "no table ends itself" rule. Dropped. Two dead tables COMMENTed.
--  F12 Ten indexes that duplicate a key they sit beside, on the write-heaviest tables.
--  F15 orders_change_watermark is the most-updated table in the schema (226k updates for
--      619 rows) and mig 247's vacuum tuning had skipped it.
--  F16 lfh_session_delete_cleanup was missing two steps its close-side mirror has.
--  F17 A bill discount that clamps to zero changed only the session row (fixed by F6).
--  F4  Two cron jobs the migrations create did not exist: migs 053 + 060 wrapped
--      `cron.schedule` in `EXCEPTION WHEN OTHERS THEN NULL/NOTICE`, so when pg_cron was
--      not yet enabled they reported success and created nothing. Scheduled here at TOP
--      LEVEL (pg_cron is created by mig 191) so a failure is LOUD, never a swallowed
--      NOTICE. lfh_auto_close_idle_sessions is deliberately NOT scheduled — see F11.
--
-- Additive and idempotent: every statement is IF EXISTS / OR REPLACE / ON CONFLICT, so a
-- full reseed lands here in the same state. No row of business data is created, changed
-- or deleted. No bill, order or session is touched.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- F1 — RE-LOCK THE 17 STAFF-ONLY FUNCTIONS
-- ═════════════════════════════════════════════════════════════════════════════
-- Each line below re-asserts a REVOKE an earlier migration already wrote. Proof that this
-- is drift and not a missing line: mig 068 revokes six functions on lines 207-212 and only
-- 208/209 held; and every REVOKE written in migs 260-264 DID hold. So the mechanism works —
-- these were lost after they ran, with nothing watching.
--
-- ⚠️  WHAT MUST **NOT** BE REVOKED, AND WHY — read before adding a line here.
-- `lfh_price_order` is SECURITY **INVOKER** and anon-callable (the guest cart prices
-- itself), and it calls `lfh_nice_usd`. An INVOKER function runs as the CALLER, so
-- revoking a helper it uses breaks guest pricing outright. Verified before writing this:
-- every function below is reached only from a route handler (service role) or from inside
-- a SECURITY DEFINER function owned by postgres, never from a browser holding the anon key.
-- The anon-reachable set stays exactly as it is: lfh_place_order, lfh_place_order_public,
-- lfh_price_order, lfh_nice_usd, lfh_phone10, lfh_effective_tax_rate, lfh_session_state,
-- lfh_join_session, lfh_get/set/merge_cart, lfh_call_waiter*, lfh_request*, lfh_submit_review,
-- lfh_leave_feedback, lfh_table_status, lfh_geo_ok, lfh_is_blocked, lfh_greet_device,
-- lfh_recognize_customer, lfh_touch_session, lfh_send_otp, lfh_verify_otp, get_order_status,
-- set_order_table_number, lfh_*_member, lfh_set_auto_approve.

-- The live floor + kitchen board (staff reads that carry money).      was: mig 081:283,285
REVOKE ALL ON FUNCTION lfh_floor_state(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_kitchen_tickets(uuid)                 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_floor_state(uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION lfh_kitchen_tickets(uuid)              TO service_role;

-- Floor-wide actions. close_all_tables(force) cancels cooking food and unpaid bills —
-- the single most destructive action in the product.                  was: mig 103:60, 102:47
REVOKE ALL ON FUNCTION lfh_staff_close_all_tables(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_open_all_tables(uuid)           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_close_all_tables(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_open_all_tables(uuid)           TO service_role;

-- Editing a live ticket.                                    was: mig 063:191-193, 068:207-212, 116:36
REVOKE ALL ON FUNCTION lfh_staff_add_item_to_order(uuid, jsonb)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_edit_item_qty(uuid, int)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_staff_edit_item_note(uuid, text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_sync_order_items_json(uuid)           FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_staff_add_item_to_order(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_edit_item_qty(uuid, int)       TO service_role;
GRANT EXECUTE ON FUNCTION lfh_staff_edit_item_note(uuid, text)     TO service_role;
GRANT EXECUTE ON FUNCTION lfh_sync_order_items_json(uuid)          TO service_role;

-- Delivery-platform tickets.                                          was: mig 071:83, 080:105
REVOKE ALL ON FUNCTION lfh_platform_set_status(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_platform_insert(text, text, text, text, jsonb, numeric, uuid)
                                                                 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_platform_set_status(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION lfh_platform_insert(text, text, text, text, jsonb, numeric, uuid)
                                                                    TO service_role;

-- THE BILL AND KOT COUNTERS. Every call consumes a number, so a stray call leaves a GAP in
-- the bill series with no bill against it — the first thing a CGST officer asks about
-- (docs/COMPLIANCE-GUARDRAILS.md). Safe to lock: both are only ever reached from inside a
-- SECURITY DEFINER function owned by postgres (place_order / assign_kot / assign_bill_on_order
-- / generate_invoice / issue_credit_note / assign_aggregator_numbers), and anon cannot INSERT
-- an order at all (RLS on `orders` has no policy).                    was: mig 080:44,46
REVOKE ALL ON FUNCTION lfh_next_counter(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_next_seq(uuid, text)                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_next_counter(uuid, text)           TO service_role;
GRANT EXECUTE ON FUNCTION lfh_next_seq(uuid, text)               TO service_role;

-- Breadcrumb housekeeping + the ₹ formatter.                          was: mig 057:49, 081:282
-- lfh_rt_prune is called from inside lfh_rt_emit (DEFINER, postgres) and lfh_inr only from
-- lfh_table_view_summary (DEFINER), so neither is reached as anon.
REVOKE ALL ON FUNCTION lfh_rt_prune()                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_inr(numeric)                          FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_rt_prune()                         TO service_role;
GRANT EXECUTE ON FUNCTION lfh_inr(numeric)                       TO service_role;

-- Owner earnings by hour and by dish. Never revoked by ANY migration until now.
REVOKE ALL ON FUNCTION lfh_owner_hourly(uuid, timestamptz, timestamptz)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_owner_dish_breakdown(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_owner_hourly(uuid, timestamptz, timestamptz)         TO service_role;
GRANT EXECUTE ON FUNCTION lfh_owner_dish_breakdown(uuid, timestamptz, timestamptz) TO service_role;

-- Trigger functions. PostgreSQL does NOT check EXECUTE when firing a trigger, so revoking
-- these changes nothing about how they run — it only stops a direct call.  was: mig 066:38, 069:19
REVOKE ALL ON FUNCTION lfh_rt_emit()                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_resolve_open_requests()               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lfh_rt_emit()                          TO service_role;
GRANT EXECUTE ON FUNCTION lfh_resolve_open_requests()            TO service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- F2 — A TABLE'S REQUEST BELONGS TO ITS OWN RESTAURANT
-- ═════════════════════════════════════════════════════════════════════════════
-- Mig 069 wrote `WHERE table_number = NEW.table_number AND status = 'pending' AND
-- type = 'open'` with no restaurant filter. Mig 146 was written precisely to add that
-- filter and fixed the two SIBLING cleanups (its lines 43, 61, 71) — this third trigger,
-- which touches the same table for the same reason, was missed.
--
-- Table numbers are plain digits, so every restaurant collides with every other: a diner
-- at restaurant B asks a waiter to open table 5, and the moment ANY restaurant opens its
-- own table 5 their request flips to `approved` with no waiter ever seeing it.
CREATE OR REPLACE FUNCTION lfh_resolve_open_requests() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE requests SET status = 'approved'
    WHERE table_number = NEW.table_number
      AND restaurant_id = NEW.restaurant_id     -- ← the whole point of this migration
      AND status = 'pending'
      AND type = 'open';
  RETURN NEW;
END $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- F3 + F10 — THE BREADCRUMB SAYS WHO NEEDS TO LISTEN
-- ═════════════════════════════════════════════════════════════════════════════
-- TWO changes to lfh_rt_emit, both about not waking screens that don't care:
--
-- 1. `staff_actions` moves from the `ops` topic to a new `audit` topic. A breadcrumb with
--    no table_number tells a panel "I can't scope this — reload everything"
--    (public/panels/realtime.js), and the manager panel answers with pollOrders() +
--    loadPlatform() — a WHOLE-FLOOR read. Nothing on any floor tile renders from
--    staff_actions, yet in one week this database logged 5,828 `row_change` rows (the
--    settings/menu edit footprint), 2,464 `login`s and 692 `ui_taps` diagnostics. Every
--    single one made every open phone and tablet on that floor re-download the floor —
--    worst during a rush, when logins and orders are most frequent. That is exactly the
--    whole-board read the egress rule forbids. The admin activity feed still needs it, so
--    it gets its own topic and components/admin/shared.tsx subscribes to `audit` as well.
--
-- 2. `session_payments` (mig 176, pay-in-parts) gains a breadcrumb, scoped to its table via
--    the session. Splitting a bill is a two-person moment: a waiter takes ₹500 of a ₹1,200
--    bill on the tablet and the manager's open bill kept showing ₹1,200 due until the 60s
--    backstop — long enough to ask the table for money it has already handed over.
CREATE OR REPLACE FUNCTION lfh_rt_emit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  k text;
  eid text;
  tn text;
  topic_name text;
  v_rid uuid;
BEGIN
  r := COALESCE(NEW, OLD);
  v_rid := COALESCE(r.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  topic_name := 'ops';  -- default for operational tables
  IF TG_TABLE_NAME = 'orders' THEN
    k := 'order'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    k := 'order_item'; eid := r.order_id::text;
    SELECT o.table_number INTO tn FROM orders o WHERE o.id = r.order_id;
  ELSIF TG_TABLE_NAME = 'waiter_calls' THEN
    k := 'call'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'sessions' THEN
    k := 'session'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'session_payments' THEN
    -- NEW (mig 267 / F10): a part-payment is money on ONE table's bill, so scope it to that
    -- table and the manager/waiter refetch just that tile instead of the whole floor.
    k := 'payment'; eid := r.session_id::text;
    SELECT s.table_number INTO tn FROM sessions s WHERE s.id = r.session_id;
  ELSIF TG_TABLE_NAME = 'requests' THEN
    k := 'request'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'session_members' THEN
    k := 'member'; eid := r.id::text;
    SELECT s.table_number INTO tn FROM sessions s WHERE s.id = r.session_id;
  ELSIF TG_TABLE_NAME = 'blocklist' THEN
    k := 'block'; eid := NULL; tn := NULL;             -- ops topic, staff-only
  ELSIF TG_TABLE_NAME = 'staff_actions' THEN
    -- CHANGED (mig 267 / F3): the admin activity feed's OWN topic. It is deliberately NOT
    -- `ops`: no floor tile renders from staff_actions, and an unscopable ops breadcrumb
    -- costs every open panel a whole-floor read. Only components/admin/shared.tsx listens.
    k := 'action'; eid := r.id::text; tn := NULL; topic_name := 'audit';
  ELSIF TG_TABLE_NAME = 'table_tags' THEN
    -- TAG: mark/clear/move of a table tag; no id column → entity is the table itself.
    k := 'table_tag'; eid := NULL; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'menu_items' THEN
    k := 'menu_item'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'categories' THEN
    k := 'category'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'filters' THEN
    k := 'filter'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'settings' THEN
    k := 'settings'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSE
    k := TG_TABLE_NAME; eid := r.id::text; tn := NULL;
  END IF;

  INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
    VALUES (topic_name, k, eid, tn, v_rid);
  IF tn IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number, restaurant_id)
      VALUES ('table:' || tn, k, eid, tn, v_rid);
  END IF;

  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  RETURN NULL;
END $$;

-- F10: attach it. Full-row (no column list) — an amount, method or note correction all
-- change what the other device shows.
DROP TRIGGER IF EXISTS rt_emit_session_payments ON session_payments;
CREATE TRIGGER rt_emit_session_payments
  AFTER INSERT OR UPDATE OR DELETE ON session_payments
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();


-- ═════════════════════════════════════════════════════════════════════════════
-- F6 + F17 — EVERY SESSION COLUMN A PANEL RENDERS IS IN THE WATCH-LIST
-- ═════════════════════════════════════════════════════════════════════════════
-- Mig 096 set this watch-list and wrote the rule down: "every column a panel renders must
-- be in the watch-list — a rendered column the trigger ignores = a silent missed instant
-- update". Three later migrations added rendered columns and none extended it:
--
--   mig 143 → sessions.discount, discount_note   (the whole-bill discount + its note)
--   mig 188 → sessions.deleted_at, deleted_by, delete_reason  (the bill ledger's tombstone)
--   mig 227 → sessions.cust_name, cust_phone     (the bill's "Bill to:" customer)
--
-- The one that bites in ordinary service: the till captures "Bill to: Mr Sharma" on the
-- tablet, and the manager with that table's bill already open on the desktop never sees the
-- name arrive — and printing in that window prints a bill with no customer on it.
--
-- discount/deleted_at were reachable INDIRECTLY (both paths also write `orders`, whose
-- trigger has no column list) — but only when an order row actually changes. F17 is the
-- hole that leaves: a bill discount on an already-fully-paid table clamps to zero, touches
-- no order row, and so emitted nothing at all. Watching the columns directly closes both.
--
-- `cart`/`cart_updated_at` stay OUT: they have their own table-only trigger (mig 109) so a
-- guest's keystroke does not wake every panel on the floor. `last_activity_at` stays out
-- too — it is a heartbeat, and watching it would spam every device.
DROP TRIGGER IF EXISTS rt_emit_sessions ON sessions;
CREATE TRIGGER rt_emit_sessions
  AFTER INSERT OR DELETE OR UPDATE OF
    status, bill_no, invoice_no, auto_approve, invoice_voided, void_at,
    discount, discount_note, cust_name, cust_phone, deleted_at, closed_at
  ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();


-- ═════════════════════════════════════════════════════════════════════════════
-- F16 — THE DELETE-CLEANUP MIRRORS THE CLOSE-CLEANUP
-- ═════════════════════════════════════════════════════════════════════════════
-- The two are deliberate mirrors (migs 020 → 146 → 232 → 249) and the delete side was
-- missing two steps the close side has: ending live table_merges rows (added to the close
-- side by mig 249) and marking session members removed.
--
-- It is nearly unreachable today — lfh_block_issued_delete refuses to hard-delete a session
-- that has a bill_no, and lfh_assign_bill_on_order gives one on the first order, so only a
-- session that never took an order can be deleted. Closed anyway: the guard and the cleanup
-- live in two different files, and only one of them is holding that invariant.
CREATE OR REPLACE FUNCTION lfh_session_delete_cleanup() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE session_members SET removed = true WHERE session_id = OLD.id AND NOT removed;
  UPDATE waiter_calls SET resolved = true WHERE session_id = OLD.id AND NOT resolved;
  UPDATE requests     SET status = 'denied' WHERE table_number = OLD.table_number AND restaurant_id = OLD.restaurant_id AND status = 'pending';
  UPDATE orders
     SET status = 'cancelled', archived = true,
         archived_at = COALESCE(archived_at, NOW()),
         cancelled_at = COALESCE(cancelled_at, NOW())
   WHERE session_id = OLD.id AND NOT archived AND deleted_at IS NULL
     AND status <> 'cancelled' AND payment_status <> 'paid' AND khata_at IS NULL;
  UPDATE orders
     SET archived = true, archived_at = COALESCE(archived_at, NOW())
   WHERE session_id = OLD.id AND NOT archived AND deleted_at IS NULL;
  -- Mirror of mig 249 on the close side: the tables this party had joined are separated
  -- again, and the record says why.
  UPDATE table_merges SET ended_at = NOW(), ended_reason = 'session_deleted'
   WHERE session_id = OLD.id AND ended_at IS NULL;
  RETURN OLD;
END; $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- F11 — SIX FUNCTIONS NOTHING CALLS, ONE OF WHICH STILL ENDS TABLES
-- ═════════════════════════════════════════════════════════════════════════════
-- Established by cross-checking all 153 live functions against every `.rpc(` call in the
-- codebase AND against every other function body, so trigger functions and SQL-internal
-- helpers are not miscounted as dead.

-- THE IMPORTANT ONE. lfh_auto_close_idle_sessions closes any open table idle for N minutes.
-- Mig 254 retired that whole behaviour on the owner's instruction ("all the serve has been
-- done and all the mark-as-paid has been done … the table restarts. I don't want that") — it
-- neutralised settings.auto_table_action and deleted lib/autoSettle.ts, but left this
-- function standing. Nothing schedules it (mig 099's cron never got created — see F4) and
-- nothing calls it, so it survived only as a loaded gun: it was also one of the 17 functions
-- anon could run. A TABLE IS ENDED ONLY BY A PERSON TAPPING ✓ Close.
DROP FUNCTION IF EXISTS lfh_auto_close_idle_sessions(int);

-- Superseded trigger function: lfh_assign_bill_on_order does this now, per session rather
-- than per order. No trigger has referenced lfh_assign_bill since mig 040.
DROP FUNCTION IF EXISTS lfh_assign_bill();

-- Superseded ban checks: lfh_join_session calls lfh_device_banned, and eight functions call
-- lfh_is_blocked. These two are called by nothing at all.
DROP FUNCTION IF EXISTS lfh_check_ban(text, text, uuid);
DROP FUNCTION IF EXISTS lfh_check_ban_scoped(text, text, uuid);

-- The mig-037 OTP stub. The live OTP path is lfh_send_otp / lfh_verify_otp against
-- `otp_codes`; this one reads `verification_codes` and nothing calls it.
DROP FUNCTION IF EXISTS lfh_check_verification(text, text);

-- No caller in SQL or app code. lfh_merge_parent_table is the live helper (5 order paths).
DROP FUNCTION IF EXISTS lfh_merge_group(uuid, text);

-- The two dead TABLES are deliberately NOT dropped. Dropping a table an older deployed
-- build might still SELECT is how a live panel starts erroring mid-service (mig 254's own
-- reasoning). They are marked instead, so a later reader cannot mistake them for live.
COMMENT ON TABLE payments IS
  'RETIRED — mig 037 stub, never used. 0 rows; no function or route reads or writes it '
  '(admin_purge_restaurant only deletes from it). The live money records are `orders` '
  '(payment_status/method/paid_at) and `session_payments` (pay-in-parts). Kept, not dropped, '
  'so an older deployed build cannot fail on a missing table. Recorded by mig 267 (F11).';
COMMENT ON TABLE verification_codes IS
  'RETIRED — the mig-037/040 OTP stub. The LIVE OTP path is lfh_send_otp / lfh_verify_otp '
  'against `otp_codes`. Its only reader, lfh_check_verification, was dropped by mig 267 (F11); '
  'lfh_request_verification still writes it while the verification feature stays off. Kept, '
  'not dropped, so an older deployed build cannot fail on a missing table.';


-- ═════════════════════════════════════════════════════════════════════════════
-- F5 + F12 — INDEXES THAT COST WRITES AND EARN NOTHING
-- ═════════════════════════════════════════════════════════════════════════════
-- Every drop below is justified by a measured scan count, not by eye. None of them changes
-- a query's ANSWER: in each case another index leads with the same column, so the planner
-- has an equal-or-better path.

-- F5: 14 MB, ZERO scans, zero tuples read — and it CANNOT be used, because nothing in the
-- codebase ever SELECTs realtime_events. Both readers subscribe through Supabase Realtime
-- (lib/useRealtime.ts, public/panels/realtime.js), which reads the WAL — an index plays no
-- part. Meanwhile it is maintained on all ~1.5M breadcrumb inserts. On a table whose heap is
-- 152 kB it was 14 MB of the 21 MB of index sitting on this table.
-- (The remaining bloat on the pkey is reclaimed by `npm run db:maintain -- --apply`, which
-- REINDEXes CONCURRENTLY — maintenance, deliberately not part of a schema migration.)
DROP INDEX IF EXISTS realtime_events_topic_idx;

-- F12: strictly redundant with the leading column of another index on the same table.
-- `orders` carried 15 indexes and takes ~550k lifetime inserts; the measured order ceiling
-- (100 simultaneous orders in ~2s) is exactly when this cost is paid.
DROP INDEX IF EXISTS idx_orders_restaurant;          -- (rid) — a prefix of idx_orders_analytics_covering
DROP INDEX IF EXISTS idx_orders_restaurant_created;  -- (rid, created_at) — same key as the covering index, minus the INCLUDEs
DROP INDEX IF EXISTS idx_daily_counters_restaurant;  -- PK is (restaurant_id, key, day)
DROP INDEX IF EXISTS idx_seq_counters_restaurant;    -- PK is (restaurant_id, key)
DROP INDEX IF EXISTS idx_customers_restaurant;       -- PK is (restaurant_id, phone)
DROP INDEX IF EXISTS idx_categories_restaurant;      -- PK is (restaurant_id, slug)
DROP INDEX IF EXISTS idx_filters_restaurant;         -- PK is (restaurant_id, slug)
DROP INDEX IF EXISTS idx_staff_users_restaurant;     -- 0 scans; idx_staff_users_username_any leads with restaurant_id
DROP INDEX IF EXISTS idx_blocklist_phone;            -- 0 scans; idx_blocklist_rid_phone is the scoped one
DROP INDEX IF EXISTS idx_blocklist_table;            -- 0 scans; idx_blocklist_restaurant covers the scoped read

-- DELIBERATELY KEPT, so nobody "tidies" them later:
--   idx_orders_member       — rid-less and only 159 scans, but member_id has no other index,
--                             so dropping it turns those reads into a seq scan. Worse, not better.
--   idx_sessions_table_status / idx_requests_table_status — rid-less (pre-tenancy shape) but
--                             genuinely used (8,152 scans); they match wider then filter, which
--                             costs a little and answers correctly.
--   idx_orders_created_covering — rid-less on purpose: the admin's cross-restaurant timeseries.


-- ═════════════════════════════════════════════════════════════════════════════
-- F15 — TUNE THE TABLE THAT IS UPDATED MORE THAN ANY OTHER
-- ═════════════════════════════════════════════════════════════════════════════
-- Mig 247 tuned autovacuum for orders / staff_actions / realtime_events. By then the
-- busiest-updated table in the schema was one it did not mention: orders_change_watermark
-- (mig 246) had taken 226,241 updates against 619 live rows — one narrow row per restaurant
-- per day, bumped by a trigger on every single order insert, update and delete. That design
-- is right (it replaced a 21.6-second full scan with a 5 ms read); it just needs the same
-- care mig 247 gave the others.
--
-- fillfactor 70 leaves free space on each page so a repeated update to the same narrow row
-- stays a HOT update on its own page instead of writing a new tuple elsewhere and dirtying
-- every index. The aggressive autovacuum thresholds then clean up the dead tuples promptly
-- on a table this small.
ALTER TABLE public.orders_change_watermark SET (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.05
);

-- Same shape, smaller: 10 live rows taking 23,036 updates from the inventory depletion
-- trigger (one per order that consumes a recipe ingredient), untuned, 712 kB of heap.
ALTER TABLE public.inv_items SET (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_threshold = 50
);


-- ═════════════════════════════════════════════════════════════════════════════
-- F4 — THE TWO MAINTENANCE JOBS THAT SILENTLY NEVER GOT CREATED
-- ═════════════════════════════════════════════════════════════════════════════
-- Live `cron.job` held only mig 191/201's two rollup jobs. Two older ones were absent:
--
--   lfh-prune-logs  (daily 04:00)   — mig 053:79-91
--   lfh-rt-prune    (every 10 min)  — mig 060:12-27
--
-- Both migrations wrap `CREATE EXTENSION pg_cron` + `cron.schedule` in
-- `DO $$ … EXCEPTION WHEN OTHERS THEN RAISE NOTICE / NULL`. pg_cron was not yet enabled on
-- this project when they ran, so they raised, were swallowed, and reported success. A NOTICE
-- in a migration log nobody reads is not a report. The visible consequences: the activity
-- log is never trimmed (staff_actions' oldest row was 39 days old against the one-month
-- ceiling mig 158 exists to enforce, while app/api/admin/oplog/cleanup/route.ts tells the
-- reader there IS an "automatic per-restaurant nightly prune"), and breadcrumb cleanup fell
-- back entirely to the 1-in-100 opportunistic call inside lfh_rt_emit — which works while a
-- restaurant is busy and stops working exactly when it goes quiet.
--
-- Scheduled here at TOP LEVEL, no DO block and no exception handler, so if pg_cron is ever
-- unavailable this migration FAILS LOUDLY instead of pretending. Mig 191 creates the
-- extension at top level and runs first, so by here it exists. cron.schedule() upserts by
-- job name, so re-running is safe. Guarded from now on by `npm run verify:grants`, which
-- fails when either job is missing.
SELECT cron.schedule('lfh-prune-logs', '0 4 * * *',    'SELECT public.lfh_prune_logs();');
SELECT cron.schedule('lfh-rt-prune',   '*/10 * * * *', 'SELECT public.lfh_rt_prune();');

-- NOT scheduled, on purpose: mig 099's `lfh_auto_close_idle_sessions` job. The owner's rule
-- is that no table ends itself (mig 254), and the function itself is dropped above. Its
-- absence from cron.job was luck; now it is a decision.


NOTIFY pgrst, 'reload schema';
