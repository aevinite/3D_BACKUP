-- 386 — a NULL restaurant is refused, not quietly answered as French House
-- (owner picked item 4 of sweep #9 terminal 30's report, 2026-09-15)
--
-- ═══ READ THIS FIRST: THIS IS THE SECOND HALF OF MIGRATION 385, NOT A RIVAL TO IT ═══
--
-- Migration 385 (`no_function_guesses_the_restaurant`, another terminal, the same day, the same
-- owner instruction) removed the `DEFAULT <restaurant #1>` from `p_restaurant_id` on 22 function
-- SIGNATURES, by DROP + CREATE, restating every grant. That work is right and this file does not
-- undo a line of it. A caller that OMITS the argument now fails to resolve the function at all.
--
-- It does not close the other door, and the two were found independently:
--
--     WHERE restaurant_id = COALESCE(p_restaurant_id, '00000000-…-0001'::uuid)
--
-- Nineteen of those same bodies carry the guess INSIDE them — migration 385 ships seventeen such
-- expressions itself. So after 385, a caller that passes NULL **explicitly** — a variable that came
-- back empty, a route that read a missing query parameter, a script with an unset id — is still
-- answered as, or written into, MY LITTLE FRENCH HOUSE. Removing a signature default stops the
-- argument being omitted; it cannot stop the argument being null.
--
-- Among the nineteen: lfh_price_order, lfh_place_order_public, lfh_staff_place_order,
-- lfh_table_view_summary, lfh_floor_state, lfh_kitchen_tickets and lfh_is_blocked — the functions
-- that price carts, place orders, draw the floor and decide whether a guest is blocked.
--
-- It is also invisible to `verify:rpc-scoped`, which reads CALL SITES: a call site can name the
-- restaurant perfectly and still hand over a null.
--
-- ⚠️ AND THIS FILE MUST SORT AFTER 385, WHICH IS WHY IT IS 386. It was written as `384_…` and
-- renumbered the moment 385 appeared on `main`. On a fresh re-seed migrations run in filename
-- order, so 385's bodies — with the seventeen COALESCEs in them — land LAST and would have
-- silently put the fallback back. That is this folder's own standing lesson, "a migration recreate
-- reverts a fix" (migration 155 states it; an earlier sweep reverted five bodies exactly this way).
-- Sweep #10: if a later migration rewrites any of the nineteen, it must keep `lfh_rid()`.
-- `verify:rid-required` is the check that says so.
--
-- ═══ WHAT WAS MEASURED, BEFORE WRITING A LINE ═══
--
--   · 267 live application call sites of these functions were walked. Exactly ONE passed no
--     restaurant — `scripts/verify-order.mjs`, a test script, fixed in the same commit. Zero
--     production routes.
--   · Four functions default `p_restaurant_id` to NULL rather than to #1 — `lfh_check_ban`,
--     `lfh_customers_fingerprint`, `lfh_device_banned`, `lfh_request_unban`. NULL is "no restaurant
--     given", not a wrong guess, and their bodies do not fall back to #1. LEFT ALONE.
--   · Eighteen further functions coalesce a ROW's own `restaurant_id` (`NEW.restaurant_id`,
--     `v_s.restaurant_id`, …) rather than a parameter. Migration 358 made those columns NOT NULL,
--     so that arm is unreachable — dead code, not a trap. LEFT ALONE, and reported instead.
--
--     ⚠️ CORRECTION (T33, sweep #9, 2026-09-17): that last sentence is true of every one of them
--     EXCEPT ONE, and the exception was measured, not guessed. There are twenty such bodies, and
--     the live tables were re-checked column by column: `restaurant_id` is still NULLABLE on six
--     of the sixty-six tenant tables — action_idempotency, error_signatures, fix_requests,
--     invoice_events, rate_limit_rules and staff_actions — because migration 358 deliberately
--     left those, and one of the six feeds one of the twenty.
--
--     `lfh_rt_emit` (whose newest definition is migration 267, NOT this file) fires on sixteen
--     tables, and `staff_actions` is one of them:
--
--         r := COALESCE(NEW, OLD);
--         v_rid := COALESCE(r.restaurant_id, '00000000-…-0001'::uuid);
--
--     763 of 6,672 rows in `staff_actions` carry no restaurant, and they are RIGHT to: they are
--     platform-level admin events that belong to no single restaurant — `owner_create`,
--     `restaurant_purge`, `owner_suspend`, `admin_reveal_unlocked`, `login`, `client_error` —
--     with the newest dated 2026-09-16. Each one writes a live-update breadcrumb labelled as MY
--     LITTLE FRENCH HOUSE'S. So this arm is not dead; it is the one that is actually taken.
--
--     NOTHING IS WRONG ON ANY SCREEN TODAY, which is why this is a correction and not a change:
--     the `audit` topic has exactly one listener (`components/admin/shared.tsx`, and
--     `lib/useRealtime.ts` says so in as many words), and the admin console subscribes with NO
--     restaurant — `topic=eq.audit` — so it receives these events either way. The mislabel sits
--     in the stored breadcrumb's `topic_rid` column, which nothing reads for this topic. It
--     becomes real the moment anyone subscribes to `audit` WITH a restaurant, which is the
--     documented way every other topic is consumed.
--
--     Sweep #10: the fix belongs in migration 267's function, not here — `lfh_rt_emit` should
--     emit nothing when the row it fired on has no restaurant, because no scoped subscriber
--     should hear it. It is recorded for the owner's decision rather than done, since no person
--     gets a wrong answer from it today.
--
-- ═══ THE BODIES BELOW ARE THE LIVE ONES, NOT RE-TYPED ═══
--
-- Every definition came out of `pg_get_functiondef()` on the dev database — which at generation
-- time already carried migration 385's default-free signatures — with exactly one pattern
-- substituted per body. Nothing was copied from an older migration and nothing was hand-written.
-- A 19-function replacement is only safe to attempt that way.
--
-- COST: none. Same reads, same plans; one COALESCE swapped for one IMMUTABLE function call.
-- Guarded by `npm run verify:rid-required`, beside the existing `verify:rpc-scoped` on call sites.

-- ── THE REFUSAL ──────────────────────────────────────────────────────────────────────────────────
-- Takes the place of `COALESCE(p_restaurant_id, '…0001'::uuid)`. Returns the id it was given, or
-- refuses. IMMUTABLE and reads nothing, so it is safe to let every role that can call the functions
-- above call this too — `lfh_price_order` is SECURITY INVOKER and anon-callable, so its helpers must
-- be anon-callable or guest pricing breaks silently (the trap `verify-db-grants.mjs` writes down).
CREATE OR REPLACE FUNCTION public.lfh_rid(p_restaurant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_restaurant_id IS NULL THEN
    -- 22004 = null_value_not_allowed. A named, readable refusal, because the whole point is that
    -- the mistake is OBVIOUS the first time it happens instead of arriving as French House's data.
    RAISE EXCEPTION 'this needs a restaurant: p_restaurant_id was null'
      USING ERRCODE = '22004',
            HINT = 'Pass the restaurant id. There is no default any more — a missing restaurant used to mean restaurant #1.';
  END IF;
  RETURN p_restaurant_id;
END
$function$;

REVOKE ALL ON FUNCTION public.lfh_rid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lfh_rid(uuid) TO anon, authenticated, service_role;

-- ── THE NINETEEN, EACH REGENERATED FROM ITS LIVE BODY WITH ONE EXPRESSION SWAPPED ────────────────

-- ── lfh_banquet_bill_create(p_lines jsonb, p_meta jsonb, p_table text, p_restaurant_id uuid, p_by text) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_banquet_bill_create(p_lines jsonb, p_meta jsonb, p_table text, p_restaurant_id uuid, p_by text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid    uuid := lfh_rid(p_restaurant_id);
  v_set    settings;
  v_table  text := NULLIF(trim(COALESCE(p_table, '')), '');
  v_fields jsonb;
  v_in     jsonb; v_bi banquet_items;
  v_qty    int; v_unit numeric; v_pct numeric; v_gross numeric;
  v_items  jsonb := '[]'::jsonb;
  v_sub    numeric := 0; v_disc numeric := 0; v_rate numeric; v_tax numeric; v_total numeric;
  v_lines  jsonb;
  v_s      sessions; v_order uuid; v_kot int;
  v_seq    int; v_no text; v_now timestamptz := now();
  v_adv    jsonb := '[]'::jsonb; v_recv numeric := 0; v_a jsonb;
  v_bill   uuid;
BEGIN
  SELECT * INTO v_set FROM settings WHERE restaurant_id = v_rid FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(v_set.banquet_allowed, false) THEN
    RETURN json_build_object('ok', false, 'reason', 'not_allowed');
  END IF;
  v_fields := COALESCE(v_set.banquet_fields, '[]'::jsonb);

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'empty_order');
  END IF;
  IF v_table IS NOT NULL AND v_table !~ '^\d+$' THEN
    RETURN json_build_object('ok', false, 'reason', 'bad_table');
  END IF;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO v_bi FROM banquet_items
      WHERE id = (v_in->>'id')::uuid AND restaurant_id = v_rid AND active;
    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;
    v_qty := GREATEST(1, LEAST(5000, COALESCE(NULLIF(v_in->>'qty','')::int, 1)));
    v_unit := CASE WHEN COALESCE(v_bi.price, 0) = 0 AND (v_in ? 'price')
                   THEN GREATEST(0, LEAST(10000000, round(COALESCE(NULLIF(v_in->>'price','')::numeric, 0), 2)))
                   ELSE round(v_bi.price, 2) END;
    v_gross := v_unit * v_qty;
    v_sub := v_sub + v_gross;
    IF v_fields ? 'disc' THEN
      v_pct := GREATEST(0, LEAST(100, COALESCE(NULLIF(v_in->>'disc','')::numeric, 0)));
      v_disc := v_disc + round(v_gross * v_pct / 100, 2);
    END IF;
    v_items := v_items || jsonb_build_object(
      'id', v_bi.id,
      'title', v_bi.title || CASE WHEN COALESCE(v_bi.unit,'') <> '' THEN ' (' || v_bi.unit || ')' ELSE '' END,
      'price', to_char(v_unit, 'FM999999990.00'),
      'qty', v_qty, 'options', NULL, 'removed', '[]'::jsonb, 'note', NULL);
  END LOOP;

  -- THE banquet rate (18% where the restaurant set it), not the dine-in rate.
  v_rate  := lfh_banquet_tax_rate(v_rid);
  v_disc  := LEAST(v_disc, v_sub);
  v_tax   := round((v_sub - v_disc) * v_rate, 2);
  v_total := v_sub - v_disc + v_tax;
  v_lines := lfh_banquet_tax_lines(v_rid, v_sub - v_disc, v_tax);

  IF v_table IS NOT NULL THEN
    SELECT * INTO v_s FROM sessions
      WHERE table_number = v_table AND status = 'open' AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC LIMIT 1;
    IF v_s.id IS NULL THEN
      INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
        VALUES (v_table, 'open', 'waiter', v_now, v_rid) RETURNING * INTO v_s;
    END IF;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, discount, discount_note,
                     allergies, status, session_id, member_id, restaurant_id)
    VALUES (v_table, v_items, v_sub, round(v_sub * v_rate, 2), v_sub + round(v_sub * v_rate, 2), v_disc,
            CASE WHEN v_disc > 0 THEN 'banquet bill discount' END,
            '{}', 'served', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_in IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, status, restaurant_id)
      VALUES (v_order, v_s.id, v_in->>'title', (v_in->>'qty')::int, (v_in->>'price')::numeric,
              NULL, '{}', NULL, 'served', v_rid);
  END LOOP;
  IF v_s.id IS NOT NULL THEN
    UPDATE sessions SET last_activity_at = v_now WHERE id = v_s.id;
  END IF;

  v_seq := GREATEST(COALESCE(v_set.banquet_bill_next, 1), 1);
  UPDATE settings SET banquet_bill_next = v_seq + 1 WHERE restaurant_id = v_rid;
  v_no := lfh_banquet_bill_no(v_set.banquet_bill_prefix, v_set.banquet_bill_style, v_seq, v_now);

  IF (v_fields ? 'advance') OR (v_fields ? 'paysplit') THEN
    FOR v_a IN SELECT * FROM jsonb_array_elements(COALESCE(p_meta->'advances', '[]'::jsonb)) LOOP
      IF COALESCE(NULLIF(v_a->>'amt','')::numeric, 0) > 0 THEN
        v_adv  := v_adv || jsonb_build_object(
          'date', COALESCE(NULLIF(v_a->>'date',''), to_char(v_now, 'YYYY-MM-DD')),
          'mode', left(COALESCE(NULLIF(v_a->>'mode',''), 'Cash'), 20),
          'ref',  left(COALESCE(v_a->>'ref',''), 60),
          'amt',  round((v_a->>'amt')::numeric, 2));
        v_recv := v_recv + round((v_a->>'amt')::numeric, 2);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO banquet_bills(
    restaurant_id, order_id, session_id, bill_seq, bill_no, issued_at,
    subtotal, tax, total, discount, received, advances, tax_lines,
    hall, func, fn_date, fn_from, fn_to, pax, rate,
    cust_name, cust_phone, cust_gstin, cust_addr, cust_person,
    remark, prepared_by, table_number, created_by)
  VALUES (
    v_rid, v_order, v_s.id, v_seq, v_no, v_now,
    v_sub, v_tax, v_total, v_disc, v_recv, v_adv, v_lines,
    CASE WHEN v_fields ? 'hall'    THEN left(NULLIF(p_meta->>'hall',''), 60) END,
    CASE WHEN v_fields ? 'func'    THEN left(NULLIF(p_meta->>'func',''), 60) END,
    CASE WHEN v_fields ? 'fndate'  THEN NULLIF(p_meta->>'fn_date','')::date END,
    CASE WHEN v_fields ? 'fndate'  THEN left(NULLIF(p_meta->>'fn_from',''), 10) END,
    CASE WHEN v_fields ? 'fndate'  THEN left(NULLIF(p_meta->>'fn_to',''), 10) END,
    CASE WHEN v_fields ? 'pax'     THEN NULLIF(p_meta->>'pax','')::int END,
    CASE WHEN v_fields ? 'rate'    THEN NULLIF(p_meta->>'rate','')::numeric END,
    CASE WHEN v_fields ? 'cust_name'  THEN left(NULLIF(p_meta->>'cust_name',''), 120) END,
    CASE WHEN v_fields ? 'cust_phone' THEN left(NULLIF(regexp_replace(COALESCE(p_meta->>'cust_phone',''), '[^0-9+]', '', 'g'), ''), 15) END,
    CASE WHEN v_fields ? 'gstin'   THEN upper(left(NULLIF(p_meta->>'cust_gstin',''), 20)) END,
    CASE WHEN v_fields ? 'address' THEN left(NULLIF(p_meta->>'cust_addr',''), 300) END,
    CASE WHEN v_fields ? 'person'  THEN left(NULLIF(p_meta->>'cust_person',''), 80) END,
    CASE WHEN v_fields ? 'remark'  THEN left(NULLIF(p_meta->>'remark',''), 300) END,
    left(NULLIF(COALESCE(p_meta->>'prepared_by', p_by), ''), 80),
    v_table, left(COALESCE(p_by, ''), 80))
  RETURNING id INTO v_bill;

  IF (v_fields ? 'cust_phone') AND lfh_phone10(p_meta->>'cust_phone') IS NOT NULL THEN
    INSERT INTO customers(phone, name, restaurant_id, first_seen_at, last_seen_at)
      VALUES (lfh_phone10(p_meta->>'cust_phone'),
              NULLIF(left(COALESCE(p_meta->>'cust_name',''), 120), ''), v_rid, v_now, v_now)
    ON CONFLICT (restaurant_id, phone) DO UPDATE
      SET name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
          last_seen_at = v_now;
  END IF;

  RETURN json_build_object('ok', true, 'bill_id', v_bill, 'bill_no', v_no, 'bill_seq', v_seq,
                           'order_id', v_order, 'kot_no', v_kot, 'table', v_table,
                           'subtotal', v_sub, 'tax', v_tax, 'total', v_total,
                           'discount', v_disc, 'received', v_recv, 'tax_lines', v_lines);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_banquet_bill_create(p_lines jsonb, p_meta jsonb, p_table text, p_restaurant_id uuid, p_by text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_banquet_bill_create(p_lines jsonb, p_meta jsonb, p_table text, p_restaurant_id uuid, p_by text) TO service_role;

-- ── lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
  v_t text := NULLIF(btrim(p_table), '');
  v_note text := NULLIF(btrim(p_note), '');
  v_sid uuid;
BEGIN
  IF v_t IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'no_table'); END IF;
  -- A blocked table can't summon staff.
  IF lfh_is_blocked(NULL, v_t, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- RATE LIMIT (mig 205): admin-configurable cap on waiter calls per table, on top of the
  -- existing 6s dedupe + 6-call cap below.
  IF NOT lfh_rate_check(v_rid, 'waiter_call', 'table:' || v_t, 'Table ' || v_t) THEN
    RETURN json_build_object('ok', true, 'reason', 'rate_limited');
  END IF;
  -- Anti-spam throttle: ignore a repeat of the SAME request for the same table
  -- within 6 seconds. Keyed on the note too, so a DIFFERENT request still lands.
  IF EXISTS (SELECT 1 FROM waiter_calls
              WHERE table_number = v_t AND NOT resolved
                AND created_at > now() - interval '6 seconds'
                AND restaurant_id = v_rid
                AND note IS NOT DISTINCT FROM v_note) THEN
    RETURN json_build_object('ok', true, 'reason', 'already_sent');
  END IF;
  -- Hard cap: never let more than 6 unresolved calls stack on one table.
  IF (SELECT count(*) FROM waiter_calls
        WHERE table_number = v_t AND NOT resolved AND restaurant_id = v_rid) >= 6 THEN
    RETURN json_build_object('ok', true, 'reason', 'capped');
  END IF;
  -- WHICH PARTY IS THIS BELL FOR? The floor gathers calls BY SESSION whenever dining sessions are
  -- on, so a call with no session on it is invisible to every panel — the guest is told "we've told
  -- them" and nobody is. Stamp the party that covers this table (its own, or the one it is joined
  -- to). Stays NULL when there is no open party, which is exactly the sessions-off case the floor
  -- already shows unconditionally, so nothing changes there.
  SELECT s.id INTO v_sid FROM sessions s
    WHERE s.table_number = lfh_merge_parent_table(v_rid, v_t) AND s.status = 'open' AND s.restaurant_id = v_rid
    ORDER BY s.last_activity_at DESC LIMIT 1;
  -- table_number stays the table the guest is REALLY at: the waiter has to walk to that one, and
  -- every panel treats a call as belonging to the table it was rung at, merged or not.
  INSERT INTO waiter_calls(table_number, note, restaurant_id, session_id) VALUES (v_t, v_note, v_rid, v_sid);
  RETURN json_build_object('ok', true);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_call_waiter_table(p_table text, p_note text, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_capture_customer(p_restaurant_id uuid, p_table text, p_phone text, p_name text, p_consent boolean, p_session uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_capture_customer(p_restaurant_id uuid, p_table text, p_phone text, p_name text, p_consent boolean, p_session uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid   uuid := lfh_rid(p_restaurant_id);
  v_phone text := NULLIF(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
  v_name  text := NULLIF(trim(COALESCE(p_name,'')), '');
  v_sid   uuid;
  v_ins   int;
BEGIN
  -- No consent or no number ⇒ store nothing (DPDP: opt-in only).
  IF NOT COALESCE(p_consent, false) OR v_phone IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_consent_or_phone');
  END IF;

  -- WHOSE BILL IS THIS? The caller's session wins, but only if it really is this
  -- restaurant's session (the id arrives from a panel, so it is never trusted blindly).
  IF p_session IS NOT NULL THEN
    SELECT id INTO v_sid FROM sessions WHERE id = p_session AND restaurant_id = v_rid;
  END IF;
  -- No session given (old caller, or a sessions-off restaurant): the table's OPEN party
  -- first — that is who is being billed — and only then the most recent one ever seated.
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table
      ORDER BY opened_at DESC LIMIT 1;
  END IF;

  -- Upsert the customer directory row.
  INSERT INTO customers(phone, name, restaurant_id, consent, consent_at, last_seen_at)
    VALUES (v_phone, v_name, v_rid, true, NOW(), NOW())
  ON CONFLICT (restaurant_id, phone) DO UPDATE SET
    name         = COALESCE(EXCLUDED.name, customers.name),
    consent      = true,
    consent_at   = COALESCE(customers.consent_at, NOW()),
    last_seen_at = NOW();

  -- One visit per session, idempotent. Only bump the counter on a NEW ledger row.
  IF v_sid IS NOT NULL THEN
    INSERT INTO customer_visits(restaurant_id, phone, session_id)
      VALUES (v_rid, v_phone, v_sid)
    ON CONFLICT (session_id) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins = 1 THEN
      UPDATE customers SET visits = visits + 1
        WHERE restaurant_id = v_rid AND phone = v_phone;
    END IF;

    -- Link the devices the guests used in THIS session (best-effort).
    INSERT INTO customer_devices(restaurant_id, phone, device_id)
      SELECT DISTINCT v_rid, v_phone, m.device_id
        FROM session_members m
       WHERE m.session_id = v_sid AND m.device_id IS NOT NULL AND m.device_id <> ''
    ON CONFLICT (restaurant_id, phone, device_id)
      DO UPDATE SET last_seen_at = NOW();
  END IF;

  -- Retention: forget this phone's stale device links (data minimisation).
  DELETE FROM customer_devices
    WHERE restaurant_id = v_rid AND phone = v_phone
      AND last_seen_at < NOW() - interval '12 months';

  RETURN (SELECT json_build_object('ok', true, 'visits', visits, 'name', name)
            FROM customers WHERE restaurant_id = v_rid AND phone = v_phone);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_capture_customer(p_restaurant_id uuid, p_table text, p_phone text, p_name text, p_consent boolean, p_session uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_capture_customer(p_restaurant_id uuid, p_table text, p_phone text, p_name text, p_consent boolean, p_session uuid) TO service_role;

-- ── lfh_floor_state(p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_floor_state(p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid         uuid := lfh_rid(p_restaurant_id);
  v_sessions_on boolean;
  v_table_count int;
  v_t           text;
  v_sess        sessions;
  v_members     int;
  v_pending     int;
  v_has_orders  boolean;
  v_has_new     boolean;
  v_has_prep    boolean;
  v_unpaid      boolean;
  v_paid_any    boolean;
  v_due         numeric;
  v_orders      json;
  v_calls       int;
  v_state       text;
  v_tag         text;   -- TAG: this table's mark (vip/family/guest) or NULL
  v_arr         json[] := '{}';
BEGIN
  -- One settings row per restaurant now (079); read THIS restaurant's row.
  SELECT sessions_enabled, COALESCE(table_count, 0)
    INTO v_sessions_on, v_table_count
    FROM settings WHERE restaurant_id = v_rid;

  -- The universe of tables to report: 1..table_count, PLUS any table that has an
  -- open session or a live (non-archived, non-cancelled) order — so walk-ins or
  -- parties shifted above the configured count are never dropped. Scoped to this
  -- restaurant so another restaurant's "table 1" is never folded in.
  FOR v_t IN
    -- UNION (not UNION ALL) already de-duplicates the table numbers, so no DISTINCT
    -- is needed — and DISTINCT would forbid ordering by the numeric CASE below.
    SELECT t FROM (
      SELECT generate_series(1, GREATEST(v_table_count, 0))::text AS t
      UNION SELECT table_number FROM sessions
              WHERE status = 'open' AND table_number IS NOT NULL
                AND restaurant_id = v_rid
      UNION SELECT table_number FROM orders
              WHERE NOT archived AND status <> 'cancelled' AND table_number IS NOT NULL
                AND restaurant_id = v_rid
    ) u
    ORDER BY CASE WHEN t ~ '^[0-9]+$' THEN t::int ELSE 2147483647 END, t
  LOOP
    -- The table's OPEN session (if any) — the most recently active one.
    SELECT * INTO v_sess
      FROM sessions
      WHERE table_number = v_t AND status = 'open'
        AND restaurant_id = v_rid
      ORDER BY last_activity_at DESC
      LIMIT 1;

    -- Seated headcount + how many joiners are still awaiting approval.
    v_members := 0; v_pending := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) FILTER (WHERE NOT removed),
             count(*) FILTER (WHERE NOT removed AND NOT approved)
        INTO v_members, v_pending
        FROM session_members WHERE session_id = v_sess.id;
    END IF;

    -- Orders that BELONG to this table, by the canonical rule:
    --   • if there's an open session → its non-archived, non-cancelled orders
    --     (matched by session id, so date never matters);
    --   • else if sessions are OFF → the table's non-archived, non-cancelled orders;
    --   • else (sessions ON, no open session) → none (stale leftovers ignored → Free).
    WITH belong AS (
      SELECT o.* FROM orders o
      WHERE o.status <> 'cancelled' AND NOT o.archived
        AND o.restaurant_id = v_rid
        AND (
              (v_sess.id IS NOT NULL AND o.session_id = v_sess.id)
           OR (NOT v_sessions_on AND v_sess.id IS NULL AND o.table_number = v_t)
        )
    )
    SELECT
      count(*) > 0,
      COALESCE(bool_or(status = 'received'), false),
      COALESCE(bool_or(status = 'preparing'), false),
      COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status <> 'paid'), false),
      COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status =  'paid'), false),
      COALESCE(SUM(net_amount) FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid'), 0),
      COALESCE(json_agg(json_build_object(
        'id', id, 'status', status, 'payment_status', payment_status,
        'total', total, 'discount', discount, 'kot_no', kot_no, 'created_at', created_at
      ) ORDER BY created_at), '[]'::json)
      INTO v_has_orders, v_has_new, v_has_prep, v_unpaid, v_paid_any, v_due, v_orders
      FROM belong;

    -- Waiter calls only count while the table is actually open (no lingering badges).
    v_calls := 0;
    IF v_sess.id IS NOT NULL THEN
      SELECT count(*) INTO v_calls
        FROM waiter_calls WHERE session_id = v_sess.id AND NOT resolved;
    END IF;

    -- TAG: this table's special mark, if any.
    SELECT tag INTO v_tag
      FROM table_tags WHERE restaurant_id = v_rid AND table_number = v_t;

    -- The ONE definition of a tile's state.
    IF v_has_orders THEN
      IF    v_has_new  THEN v_state := 'new';
      ELSIF v_has_prep THEN v_state := 'preparing';
      ELSIF v_unpaid   THEN v_state := 'served';
      ELSE                  v_state := 'cleared';
      END IF;
    ELSIF v_sess.id IS NOT NULL THEN
      v_state := 'seated';
    ELSE
      v_state := 'free';
    END IF;

    v_arr := array_append(v_arr, json_build_object(
      'table_number',     v_t,
      'state',            v_state,
      'open',             v_sess.id IS NOT NULL,
      'session_id',       v_sess.id,
      'members',          v_members,
      'pending_members',  v_pending,
      'has_new',          v_has_new,
      'has_call',         v_calls > 0,
      'due',              round(v_due, 2),
      'pay',              CASE WHEN v_unpaid THEN 'red' WHEN v_paid_any THEN 'green' ELSE '' END,
      'tag',              COALESCE(v_tag, ''),   -- TAG: '' when unmarked
      'orders',           v_orders,
      'last_activity_at', v_sess.last_activity_at
    ));
  END LOOP;

  RETURN array_to_json(v_arr);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_floor_state(p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_floor_state(p_restaurant_id uuid) TO service_role;

-- ── lfh_geo_ok(p_lat double precision, p_lng double precision, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_geo_ok(p_lat double precision, p_lng double precision, p_restaurant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s settings; d double precision; k double precision := pi() / 180;
BEGIN
  SELECT * INTO s FROM settings
    WHERE restaurant_id = lfh_rid(p_restaurant_id);
  IF NOT COALESCE(s.require_location, true) THEN RETURN true; END IF;       -- owner turned location off
  IF s.geo_lat IS NULL OR s.geo_lng IS NULL THEN RETURN true; END IF;        -- café coords not set yet -> bypass
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN false; END IF;               -- required but no fix -> block
  d := 2 * 6371000 * asin(sqrt(
        power(sin((p_lat - s.geo_lat) * k / 2), 2) +
        cos(s.geo_lat * k) * cos(p_lat * k) * power(sin((p_lng - s.geo_lng) * k / 2), 2)));
  RETURN d <= COALESCE(s.geo_radius_m, 250);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_geo_ok(p_lat double precision, p_lng double precision, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_geo_ok(p_lat double precision, p_lng double precision, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_greet_device(p_restaurant_id uuid, p_device_id text) · sql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_greet_device(p_restaurant_id uuid, p_device_id text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT json_build_object('known', true, 'name', c.name, 'visits', c.visits)
       FROM customer_devices d
       JOIN customers c
         ON c.restaurant_id = d.restaurant_id AND c.phone = d.phone
      WHERE d.restaurant_id = lfh_rid(p_restaurant_id)
        AND d.device_id = p_device_id
        AND d.last_seen_at > NOW() - interval '12 months'
        AND c.consent AND NOT c.blocked
        AND c.name IS NOT NULL
      ORDER BY d.last_seen_at DESC
      LIMIT 1),
    json_build_object('known', false));
$function$;

REVOKE ALL ON FUNCTION public.lfh_greet_device(p_restaurant_id uuid, p_device_id text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_greet_device(p_restaurant_id uuid, p_device_id text) TO PUBLIC, anon, authenticated, service_role;

-- ── lfh_is_blocked(p_phone text, p_table text, p_restaurant_id uuid) · sql · 2 fallbacks replaced ──
CREATE OR REPLACE FUNCTION public.lfh_is_blocked(p_phone text, p_table text, p_restaurant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM blocklist
    WHERE restaurant_id = lfh_rid(p_restaurant_id)
      AND ((p_phone IS NOT NULL AND phone = p_phone)
        OR (p_table IS NOT NULL AND table_number = p_table))
  ) OR EXISTS (
    SELECT 1 FROM customers
    WHERE restaurant_id = lfh_rid(p_restaurant_id)
      AND p_phone IS NOT NULL AND phone = p_phone AND blocked
  );
$function$;

REVOKE ALL ON FUNCTION public.lfh_is_blocked(p_phone text, p_table text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_is_blocked(p_phone text, p_table text, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision, p_device text, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision, p_device text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
  v_session sessions; v_token text; v_role text; v_approved boolean; v_count int; v_member uuid;
BEGIN
  IF lfh_is_blocked(NULL, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- A device banned AT THIS RESTAURANT is refused here too (scoped — mig 139).
  IF lfh_device_banned(p_device, NULL, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'banned'); END IF;
  -- RATE LIMIT (mig 205): cap join attempts per device/table in the window.
  IF NOT lfh_rate_check(v_rid, 'join_session', 'join:' || COALESCE(NULLIF(p_device, ''), 't' || p_table),
                        'Table ' || p_table) THEN
    RETURN json_build_object('ok', false, 'reason', 'rate_limited');
  END IF;
  IF NOT lfh_geo_ok(p_lat, p_lng, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'too_far'); END IF;

  -- JOIN THE PARTY, not the table number. A diner at a joined table belongs to the one party that
  -- covers both tables — that is the whole meaning of a merge, and it is how their order, their
  -- bill and their waiter call all behave already.
  SELECT * INTO v_session FROM sessions
    WHERE table_number = lfh_merge_parent_table(v_rid, p_table) AND status = 'open' AND restaurant_id = v_rid LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'no_open_session'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_session.id::text, 0));

  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_session.id AND NOT removed;
  v_token := replace(gen_random_uuid()::text, '-', '');
  IF v_count = 0 THEN
    v_role := 'owner'; v_approved := true;
  ELSE
    v_role := 'guest'; v_approved := v_session.auto_approve;
  END IF;

  INSERT INTO session_members(session_id, name, token, role, approved, location_ok, device_id, restaurant_id)
    VALUES (v_session.id, p_name, v_token, v_role, v_approved, true, p_device, v_rid)
    RETURNING id INTO v_member;
  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_session.id;

  RETURN json_build_object('ok', true, 'token', v_token, 'member_id', v_member,
    'session_id', v_session.id, 'role', v_role, 'approved', v_approved);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision, p_device text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_join_session(p_table text, p_name text, p_lat double precision, p_lng double precision, p_device text, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_kitchen_tickets(p_restaurant_id uuid) · sql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_kitchen_tickets(p_restaurant_id uuid)
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(json_agg(json_build_object(
    'order_id',     o.id,
    'kot_no',       o.kot_no,
    'table_number', o.table_number,
    'status',       o.status,
    'created_at',   o.created_at,
    -- TAG: the table's mark so the kitchen ticket can show 👑/🏠/🤝 next to T<n>.
    'tag', COALESCE((SELECT t.tag FROM table_tags t
                      WHERE t.restaurant_id = o.restaurant_id
                        AND t.table_number = o.table_number), ''),
    -- The SAME one definition the floor tiles count (order_dish_lines, mig 323), so the board and the
    -- tile can never disagree about what is on an order again. `dl.raw` is the untouched JSON line
    -- when the ticket was the source, so an order with no dish rows still hands on exactly what it
    -- handed on before — the output of this function is unchanged, byte for byte.
    'items', COALESCE(
      (SELECT json_agg(COALESCE(dl.raw::json,
                json_build_object('title', dl.title, 'qty', dl.qty, 'status', dl.status,
                                  'note', dl.note, 'removed', dl.removed))
                -- The dishes in the order they were TAKEN: the JSON array's position, or the dish
                -- row's physical position — which is exactly what `ORDER BY oi.created_at` alone
                -- resolved to before, since dishes inserted together share created_at. Ordering by
                -- the row id instead REVERSED two real tickets (caught by the before/after compare).
                ORDER BY dl.created_at, dl.line_no, dl.phys)
         FROM order_dish_lines dl WHERE dl.order_id = o.id),
      '[]'::json)
  ) ORDER BY o.created_at), '[]'::json)
  FROM orders o
  WHERE NOT o.archived AND o.status IN ('received','preparing','served')
    AND o.restaurant_id = lfh_rid(p_restaurant_id);
$function$;

REVOKE ALL ON FUNCTION public.lfh_kitchen_tickets(p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_kitchen_tickets(p_restaurant_id uuid) TO service_role;

-- ── lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
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

  -- 306: A DISH TAKEN OFF THE MENU IS NOT ORDERABLE FROM A GUEST DEVICE.
  -- 'hidden' is the third state beside sold-out (owner, 2026-08-06): sold-out still SHOWS on the
  -- menu wearing its badge, hidden is not on the guest menu at all. The guest read already drops
  -- these server-side (lib/menu.ts), so in normal use a basket cannot contain one -- this is the
  -- half that does not depend on the screen, which is the app's own rule: hiding is never the
  -- only guard. STAFF are deliberately unaffected: a waiter may still put an off-menu dish on a
  -- bill, and they order through the panel routes, not through here.
  IF jsonb_typeof(p_items) = 'array' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_items) e
        JOIN menu_items m ON m.id = e->>'id' AND m.restaurant_id = v_rid
       WHERE 'hidden' = ANY(m.tags)
     ) THEN
    RETURN json_build_object('ok', false, 'reason', 'hidden_item');
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
       -- (357) …and it must still be ON THE FLOOR. Staff clearing a table (the app's own
       -- soft-delete) leaves its orders 'preparing' and unpaid, so without these two lines a
       -- restarted table auto-accepted the NEXT party's very first order.
       AND NOT archived
       AND deleted_at IS NULL
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

REVOKE ALL ON FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_place_order_public(p_table text, p_items jsonb, p_allergies text[], p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_price_order(p_items jsonb, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_price_order(p_items jsonb, p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_rid    uuid := lfh_rid(p_restaurant_id);
  v_in     jsonb;
  v_mi     menu_items;
  v_qty    int;
  v_base   numeric;
  v_add    numeric;
  v_opts   jsonb;
  v_unit   numeric;
  v_items  jsonb := '[]'::jsonb;
  v_sub    numeric := 0;
  v_tax    numeric;
  v_total  numeric;
  v_rate   numeric;
  v_mode   text;
  v_mrp    boolean;
  v_amt    numeric;
  v_taxbase numeric := 0;
  v_nontax  numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_order');
  END IF;

  -- (119) the restaurant's OWN rate, never a hardcoded 5%.
  v_rate := lfh_effective_tax_rate(v_rid);

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_mi FROM menu_items
      WHERE id = v_in->>'id' AND restaurant_id = v_rid;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'unknown_item', 'item', v_in->>'id');
    END IF;

    IF 'sold-out' = ANY(v_mi.tags) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sold_out', 'item', v_mi.title);
    END IF;

    v_qty := GREATEST(1, LEAST(99, COALESCE(NULLIF(v_in->>'qty', '')::int, 1)));

    IF v_mi.open_price THEN
      v_unit := round(GREATEST(0, LEAST(100000,
        COALESCE(NULLIF(regexp_replace(COALESCE(v_in->>'price',''), '[^0-9.]', '', 'g'), '')::numeric, 0))), 2);
      IF v_unit <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'price_required', 'item', v_mi.title);
      END IF;
      v_opts := '[]'::jsonb;
    ELSE
      v_base := COALESCE(NULLIF(regexp_replace(v_mi.price, '[^0-9.]', '', 'g'), '')::numeric, 0);

      SELECT
        COALESCE(SUM((ch->>'price')::numeric), 0),
        COALESCE(jsonb_agg(jsonb_build_object(
          'group', grp->>'name', 'label', ch->>'label', 'price', (ch->>'price')::numeric)), '[]'::jsonb)
        INTO v_add, v_opts
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_in->'options') = 'array' THEN v_in->'options' ELSE '[]'::jsonb END) opt
      JOIN jsonb_array_elements(CASE WHEN jsonb_typeof(v_mi.options) = 'array' THEN v_mi.options ELSE '[]'::jsonb END) grp
        ON grp->>'name' = opt->>'group'
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(grp->'choices') = 'array' THEN grp->'choices' ELSE '[]'::jsonb END) ch
      WHERE ch->>'label' = opt->>'label';

      v_unit := lfh_nice_usd(v_base) + COALESCE(v_add, 0);
    END IF;

    -- Resolve the behaviour ONCE, here, and freeze it onto the line.
    v_mode := lfh_resolve_tax_mode(v_mi.tax_mode, v_rid);
    v_mrp  := (COALESCE(v_mi.tax_mode, 'default') = 'mrp')
              AND COALESCE((SELECT item_tax_modes_allowed FROM settings WHERE restaurant_id = v_rid), false);

    v_amt := round(v_unit * v_qty, 2);
    v_sub := v_sub + v_amt;
    IF v_mode = 'exempt' THEN
      v_nontax := v_nontax + v_amt;
    ELSIF v_mode = 'incl' THEN
      v_taxbase := v_taxbase + round(v_amt / (1 + v_rate), 2);
    ELSE
      v_taxbase := v_taxbase + v_amt;
    END IF;

    v_items := v_items || jsonb_build_object(
      'id',       v_mi.id,
      'title',    v_mi.title,
      'price',    to_char(v_unit, 'FM999999990.00'),
      'qty',      v_qty,
      'options',  CASE WHEN v_opts = '[]'::jsonb THEN NULL ELSE v_opts END,
      'removed',  CASE WHEN jsonb_typeof(v_in->'removed') = 'array' THEN v_in->'removed' ELSE '[]'::jsonb END,
      'note',     v_in->>'note',
      'tax_mode', v_mode,
      'is_mrp',   v_mrp
    );
  END LOOP;

  -- subtotal is the taxable NET plus the untaxed lines, so `subtotal + tax = total` still
  -- holds and a tax-inclusive price still totals to exactly the price on the menu.
  v_sub   := round(v_taxbase + v_nontax, 2);
  v_tax   := round(v_taxbase * v_rate, 2);
  v_total := round(v_sub + v_tax, 2);

  RETURN jsonb_build_object('ok', true, 'items', v_items,
                            'subtotal', v_sub, 'tax', v_tax, 'total', v_total,
                            'taxable_base', v_taxbase, 'nontax_amount', v_nontax);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_price_order(p_items jsonb, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_price_order(p_items jsonb, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_recognize_customer(p_phone text, p_restaurant_id uuid) · sql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_recognize_customer(p_phone text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT json_build_object('known', true, 'name', name, 'blocked', blocked, 'visits', visits)
       FROM customers
      WHERE phone = regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g')
        AND restaurant_id = lfh_rid(p_restaurant_id)),
    json_build_object('known', false));
$function$;

REVOKE ALL ON FUNCTION public.lfh_recognize_customer(p_phone text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_recognize_customer(p_phone text, p_restaurant_id uuid) TO service_role;

-- ── lfh_request(p_table text, p_type text, p_name text, p_phone text, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_request(p_table text, p_type text, p_name text, p_phone text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
  v_id uuid; v_recent int;
BEGIN
  IF lfh_is_blocked(p_phone, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  SELECT count(*) INTO v_recent FROM requests
    WHERE table_number = p_table AND status = 'pending' AND created_at > NOW() - interval '3 minutes'
      AND restaurant_id = v_rid;
  IF v_recent > 0 THEN RETURN json_build_object('ok', true, 'already_pending', true); END IF;
  INSERT INTO requests(table_number, type, name, phone, restaurant_id)
    VALUES (p_table, p_type, p_name, p_phone, v_rid) RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'request_id', v_id);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_request(p_table text, p_type text, p_name text, p_phone text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_request(p_table text, p_type text, p_name text, p_phone text, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_send_otp(p_phone text, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_send_otp(p_phone text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
  v_code text;
BEGIN
  IF lfh_is_blocked(p_phone, NULL, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO otp_codes(phone, code, expires_at, restaurant_id)
    VALUES (p_phone, v_code, NOW() + interval '10 minutes', v_rid);
  RETURN json_build_object('ok', true, 'dev_code', v_code);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_send_otp(p_phone text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_send_otp(p_phone text, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text, p_restaurant_id uuid, p_confirm_duplicate boolean) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text, p_restaurant_id uuid, p_confirm_duplicate boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid   uuid := lfh_rid(p_restaurant_id);
  v_s     sessions; v_order uuid; v_kot int; v_item jsonb; v_priced jsonb;
  v_sig   text; v_alg text;
BEGIN
  -- (1) Serialize concurrent placements on the SAME table for this restaurant. A
  -- transaction-scoped advisory lock: a near-simultaneous second request waits here until
  -- the first commits, so it can reuse the now-open session (no unique violation → no 500)
  -- and see the first order in the dedup check below.
  PERFORM pg_advisory_xact_lock(hashtextextended('lfh_place:' || v_rid::text || ':' || COALESCE(p_table, ''), 0));

  -- Same money math as guest orders, scoped to THIS restaurant's menu (mig 118).
  v_priced := lfh_price_order(p_items, v_rid);
  IF NOT (v_priced->>'ok')::boolean THEN RETURN v_priced::json; END IF;

  -- (2) Atomic double-tap guard (unless the waiter already confirmed "send anyway").
  -- Signature = sorted per-item (id:qty:options) of the PRICED items (lfh_price_order emits
  -- 'id' + 'options'), plus the sorted order-level allergies. Compared against a
  -- non-cancelled, non-deleted order on this table from the last 3 seconds.
  v_sig := (SELECT string_agg(
              (e->>'id') || ':' || (e->>'qty') || ':' ||
              CASE WHEN jsonb_typeof(e->'options') = 'array'
                   THEN COALESCE((SELECT string_agg((op->>'group') || '/' || (op->>'label'), ','
                                  ORDER BY (op->>'group') || '/' || (op->>'label'))
                                  FROM jsonb_array_elements(e->'options') op), '')
                   ELSE '' END,
              '|' ORDER BY (e->>'id') || ':' || (e->>'qty'))
            FROM jsonb_array_elements(v_priced->'items') e);
  v_alg := (SELECT string_agg(a, ',' ORDER BY a) FROM unnest(COALESCE(p_allergies, '{}'::text[])) a);
  IF NOT COALESCE(p_confirm_duplicate, false) THEN
    IF EXISTS (
      SELECT 1 FROM orders o
      WHERE o.table_number = p_table AND o.restaurant_id = v_rid
        AND o.status <> 'cancelled' AND o.deleted_at IS NULL
        AND o.created_at >= now() - interval '3 seconds'
        AND jsonb_typeof(o.items) = 'array'   -- only array-shaped orders can match (old/scalar rows skipped)
        AND (SELECT string_agg(
               (e->>'id') || ':' || (e->>'qty') || ':' ||
               CASE WHEN jsonb_typeof(e->'options') = 'array'
                    THEN COALESCE((SELECT string_agg((op->>'group') || '/' || (op->>'label'), ','
                                   ORDER BY (op->>'group') || '/' || (op->>'label'))
                                   FROM jsonb_array_elements(e->'options') op), '')
                    ELSE '' END,
               '|' ORDER BY (e->>'id') || ':' || (e->>'qty'))
             FROM jsonb_array_elements(o.items) e) IS NOT DISTINCT FROM v_sig
        AND (SELECT string_agg(a, ',' ORDER BY a) FROM unnest(COALESCE(o.allergies, '{}'::text[])) a)
            IS NOT DISTINCT FROM v_alg
    ) THEN
      RETURN json_build_object('ok', false, 'duplicateWarning', true,
        'error', 'This looks identical to an order just sent for this table.');
    END IF;
  END IF;

  -- The table's open session FOR THIS RESTAURANT, or OPEN ONE NOW so the order is
  -- never an orphan. (Another restaurant's open "table 1" must never be reused.)
  -- A MERGED TABLE ORDERS ONTO THE PARTY IT WAS JOINED TO (owner, 2026-08-01, mig 249: he chose
  -- "let them order, it joins the same bill"). A waiter standing at table 7 while 7 is merged into
  -- 6 must be able to add a dish without walking to 6, and that dish belongs on the ONE bill. The
  -- order still records table_number = p_table below, so the KOT prints for table 7 and an unmerge
  -- can hand it back exactly. Without this, ordering at 7 would open a SECOND party on 7 and
  -- silently split the bill the merge just joined.
  SELECT * INTO v_s FROM sessions
    WHERE table_number = lfh_merge_parent_table(v_rid, p_table)
      AND status = 'open' AND restaurant_id = v_rid
    ORDER BY last_activity_at DESC LIMIT 1;
  IF v_s.id IS NULL THEN
    INSERT INTO sessions(table_number, status, opened_by, opened_at, restaurant_id)
      VALUES (p_table, 'open', 'waiter', NOW(), v_rid)
      RETURNING * INTO v_s;
  END IF;

  INSERT INTO orders(table_number, items, subtotal, tax, total, allergies, status, session_id, member_id, restaurant_id)
    VALUES (p_table, v_priced->'items',
            (v_priced->>'subtotal')::numeric, (v_priced->>'tax')::numeric, (v_priced->>'total')::numeric,
            COALESCE(p_allergies, '{}'), 'received', v_s.id, NULL, v_rid)
    RETURNING id, kot_no INTO v_order, v_kot;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_priced->'items') LOOP
    INSERT INTO order_items(order_id, session_id, title, qty, unit_price, options, removed, note, restaurant_id)
      VALUES (v_order, v_s.id,
        COALESCE(v_item->>'title', ''),
        COALESCE((v_item->>'qty')::int, 1),
        COALESCE((v_item->>'price')::numeric, 0),
        v_item->'options',
        CASE WHEN jsonb_typeof(v_item->'removed') = 'array'
             THEN COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'removed') x), '{}')
             ELSE '{}' END,
        COALESCE(v_item->>'note', p_note),
        v_rid);
  END LOOP;

  -- (T16 7830) trg_order_joins_closed_session (mig 302) archives + cancels an order whose session
  -- closed between the lookup above and this INSERT — correctly: the order must be RECORDED and must
  -- not appear as the next party's food. But this function still answered ok:true with a KOT number,
  -- so a waiter was told "sent", tore off a ticket, and the kitchen never saw it. Read the row back
  -- and refuse with the SAME code the guest path returns, so the panel can say why (a code, never
  -- prose — the tap-never-vanishes rule).
  IF EXISTS (SELECT 1 FROM orders o WHERE o.id = v_order AND (o.archived OR o.status = 'cancelled')) THEN
    RETURN json_build_object('ok', false, 'reason', 'session_closed',
      'error', 'That table was closed a moment ago — the order was not sent. Open the table again and re-send.');
  END IF;

  UPDATE sessions SET last_activity_at = NOW() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'order_id', v_order, 'kot_no', v_kot);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text, p_restaurant_id uuid, p_confirm_duplicate boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_staff_place_order(p_table text, p_items jsonb, p_allergies text[], p_note text, p_restaurant_id uuid, p_confirm_duplicate boolean) TO service_role;

-- ── lfh_submit_review(p_slug text, p_device text, p_stars integer, p_name text, p_comment text, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_submit_review(p_slug text, p_device text, p_stars integer, p_name text, p_comment text, p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
BEGIN
  -- Validate everything server-side; the client is never trusted.
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_stars');
  END IF;
  IF p_device IS NULL OR length(p_device) < 8 OR length(p_device) > 64 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_device');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM menu_items WHERE slug = p_slug AND restaurant_id = v_rid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_such_item');
  END IF;
  -- Upsert: a device re-rating a dish replaces its previous rating.
  INSERT INTO reviews(item_slug, device_id, name, stars, comment, restaurant_id)
  VALUES (
    p_slug, p_device,
    left(coalesce(nullif(trim(p_name), ''), 'Guest'), 40),
    p_stars,
    left(nullif(trim(p_comment), ''), 500),
    v_rid
  )
  ON CONFLICT (restaurant_id, item_slug, device_id)
  DO UPDATE SET stars = EXCLUDED.stars, name = EXCLUDED.name,
                comment = EXCLUDED.comment, created_at = now();
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.lfh_submit_review(p_slug text, p_device text, p_stars integer, p_name text, p_comment text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_submit_review(p_slug text, p_device text, p_stars integer, p_name text, p_comment text, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_table_status(p_table text, p_restaurant_id uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_table_status(p_table text, p_restaurant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid uuid := lfh_rid(p_restaurant_id);
  v_s sessions; v_count int;
BEGIN
  IF lfh_is_blocked(NULL, p_table, v_rid) THEN RETURN json_build_object('ok', false, 'reason', 'blocked'); END IF;
  -- A JOINED TABLE IS OPEN — its party just lives on another table's session (mig 249).
  SELECT * INTO v_s FROM sessions
    WHERE table_number = lfh_merge_parent_table(v_rid, p_table) AND status = 'open' AND restaurant_id = v_rid LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', true, 'open', false, 'members', 0); END IF;
  SELECT count(*) INTO v_count FROM session_members WHERE session_id = v_s.id AND NOT removed;
  RETURN json_build_object('ok', true, 'open', true, 'members', v_count,
                           'session_id', v_s.id, 'last_activity_at', v_s.last_activity_at);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_table_status(p_table text, p_restaurant_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_table_status(p_table text, p_restaurant_id uuid) TO service_role, anon, authenticated;

-- ── lfh_table_view_summary(p_restaurant_id uuid, p_table text) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_table_view_summary(p_restaurant_id uuid, p_table text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid         uuid := lfh_rid(p_restaurant_id);
  v_sessions_on boolean;
  v_table_count int;
  v_rate        numeric;
  v_tiles       jsonb := '{}'::jsonb;
  v_keys        text[]  := '{}';   -- tiles are gathered here, then built in ONE step (see below)
  v_vals        jsonb[] := '{}';
  v_order_count int;
  v_latest_tbl  text;
  r             record;
  v_state text; v_label text; v_meta text;
BEGIN
  SELECT sessions_enabled, COALESCE(table_count, 0)
    INTO v_sessions_on, v_table_count
    FROM settings WHERE restaurant_id = v_rid;
  v_sessions_on := COALESCE(v_sessions_on, false);
  -- (310) v_rate is no longer read for the tile's due — orders.net_amount already carries the
  -- discount grossed at the rate each order was charged at. Left declared, deliberately unset.

  -- ONE pass: every number every tile needs, for every table at once. The old version asked the
  -- database 6-7 questions PER TABLE inside this call (~2000 round trips at 300 tables).
  FOR r IN
    WITH tl AS (   -- the table list, unchanged
      SELECT t FROM (
        SELECT generate_series(1, GREATEST(v_table_count, 0))::text AS t
        UNION SELECT table_number FROM sessions
                WHERE status = 'open' AND table_number IS NOT NULL AND restaurant_id = v_rid
        UNION SELECT table_number FROM orders
                WHERE NOT archived AND status <> 'cancelled' AND table_number IS NOT NULL
                  AND restaurant_id = v_rid
      ) u
      WHERE p_table IS NULL OR t = p_table
    ),
    -- The table's open session. DISTINCT ON keeps the old "latest activity wins" pick, so this
    -- stays correct even if the one-open-session-per-table unique index ever went away.
    os AS (
      SELECT DISTINCT ON (s.table_number) s.table_number, s.id
        FROM sessions s
       WHERE s.restaurant_id = v_rid AND s.status = 'open' AND s.table_number IS NOT NULL
       ORDER BY s.table_number, s.last_activity_at DESC
    ),
    ts AS (
      SELECT tl.t, os.id AS sess_id FROM tl LEFT JOIN os ON os.table_number = tl.t
    ),
    mem AS (
      SELECT m.session_id,
             count(*) FILTER (WHERE NOT m.removed)                    AS members,
             count(*) FILTER (WHERE NOT m.removed AND NOT m.approved) AS pending
        FROM session_members m
       WHERE m.session_id IN (SELECT sess_id FROM ts WHERE sess_id IS NOT NULL)
       GROUP BY m.session_id
    ),
    -- OWNERSHIP RULE, unchanged: an order belongs to the table's CURRENT open session; only when
    -- sessions are OFF and there is no session does table_number decide. When sessions are ON and
    -- no session is open this is EMPTY on purpose — a new party inherits nothing.
    belong AS (
      SELECT ts.t, o.id, o.status, o.payment_status, o.total, o.discount, o.net_amount, o.items
        FROM ts
        JOIN orders o
          ON o.restaurant_id = v_rid AND o.status <> 'cancelled' AND NOT o.archived
         AND ( (ts.sess_id IS NOT NULL AND o.session_id = ts.sess_id)
            OR (NOT v_sessions_on AND ts.sess_id IS NULL AND o.table_number = ts.t) )
    ),
    -- one row per dish LINE with its status + QTY: order_items when the order has any, else the
    -- orders.items JSON. SUM(qty), not row count. The jsonb_typeof guard is mig 229 (a scalar
    -- `items` used to abort the whole call).
    lines AS (
      SELECT b.t, LOWER(COALESCE(oi.status, 'received')) AS st,
             GREATEST(COALESCE(oi.qty, 1), 0) AS qty
        FROM belong b
        JOIN order_items oi ON oi.order_id = b.id
      UNION ALL
      SELECT b.t, LOWER(COALESCE(el->>'status', 'received')) AS st,
             GREATEST(COALESCE(CASE WHEN el->>'qty' ~ '^-?[0-9]+$' THEN (el->>'qty')::int END, 1), 0) AS qty
        FROM belong b
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(b.items) = 'array' THEN b.items ELSE '[]'::jsonb END) el
       WHERE NOT EXISTS (SELECT 1 FROM order_items oi2 WHERE oi2.order_id = b.id)
    ),
    lagg AS (
      SELECT t,
             COALESCE(SUM(qty) FILTER (WHERE st = 'received'), 0)  AS nw,
             COALESCE(SUM(qty) FILTER (WHERE st = 'preparing'), 0) AS ck,
             COALESCE(SUM(qty) FILTER (WHERE st = 'ready'), 0)     AS rd,
             COALESCE(SUM(qty) FILTER (WHERE st = 'served'), 0)    AS sv
        FROM lines GROUP BY t
    ),
    bagg AS (
      SELECT t,
             count(*) AS oc,
             COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status <> 'paid'), false) AS unpaid,
             COALESCE(bool_or(status NOT IN ('received','cancelled') AND payment_status =  'paid'), false) AS paid_any,
             -- (T16 7902) The ladder below reads the LINE counts, and an order can have none to
             -- count: no order_items rows and an `items` that is empty or not an array (the scalar
             -- case mig 229 exists for). Those tiles fell through to "unpaid => Served" and labelled
             -- cooking food as served. Carry the ORDERS' own statuses so the fallback can be honest.
             COALESCE(bool_or(status = 'received'),  false) AS any_new_order,
             COALESCE(bool_or(status = 'preparing'), false) AS any_prep_order,
             -- discount BEFORE tax. NOT coalesced on purpose: a NULL discount makes the term NULL
             -- and SUM skips that row, which is exactly what the old version answered.
             COALESCE(SUM(net_amount)
                      FILTER (WHERE status NOT IN ('received','cancelled') AND payment_status <> 'paid'), 0) AS due
        FROM belong GROUP BY t
    ),
    cal AS (   -- calls are counted by SESSION, and only when a session exists
      SELECT w.session_id, count(*) AS calls
        FROM waiter_calls w
       WHERE NOT w.resolved
         AND w.session_id IN (SELECT sess_id FROM ts WHERE sess_id IS NOT NULL)
       GROUP BY w.session_id
    ),
    -- Pending requests for the table. The old predicate was `NOT (type = 'open' AND <session>)`,
    -- which under SQL's three-valued logic EXCLUDES a NULL type while a session is open (NOT NULL
    -- is NULL, not true). Both counts are carried so that behaviour is reproduced exactly rather
    -- than approximated.
    req AS (
      SELECT rq.table_number,
             count(*)                                                        AS all_pending,
             count(*) FILTER (WHERE rq.type IS NOT NULL AND rq.type <> 'open') AS non_open_pending
        FROM requests rq
       WHERE rq.restaurant_id = v_rid AND rq.status = 'pending'
       GROUP BY rq.table_number
    ),
    tg AS (
      SELECT tt.table_number, tt.tag FROM table_tags tt WHERE tt.restaurant_id = v_rid
    )
    SELECT ts.t,
           ts.sess_id,
           COALESCE(mem.members, 0)::int    AS members,
           COALESCE(mem.pending, 0)::int    AS pending,
           COALESCE(bagg.oc, 0)::int        AS oc,
           COALESCE(bagg.oc, 0) > 0         AS has_orders,
           COALESCE(lagg.nw, 0)::int        AS nw,
           COALESCE(lagg.ck, 0)::int        AS ck,
           COALESCE(lagg.rd, 0)::int        AS rd,
           COALESCE(lagg.sv, 0)::int        AS sv,
           COALESCE(bagg.unpaid, false)     AS unpaid,
           COALESCE(bagg.paid_any, false)   AS paid_any,
           COALESCE(bagg.any_new_order, false)  AS any_new_order,
           COALESCE(bagg.any_prep_order, false) AS any_prep_order,
           COALESCE(bagg.due, 0)            AS due,
           COALESCE(cal.calls, 0)::int      AS calls,
           (CASE WHEN ts.sess_id IS NOT NULL
                 THEN COALESCE(req.non_open_pending, 0)
                 ELSE COALESCE(req.all_pending, 0) END)::int AS reqs,
           tg.tag                           AS tag
      FROM ts
      LEFT JOIN mem  ON mem.session_id  = ts.sess_id
      LEFT JOIN bagg ON bagg.t          = ts.t
      LEFT JOIN lagg ON lagg.t          = ts.t
      LEFT JOIN cal  ON cal.session_id  = ts.sess_id
      LEFT JOIN req  ON req.table_number = ts.t
      LEFT JOIN tg   ON tg.table_number  = ts.t
     ORDER BY CASE WHEN ts.t ~ '^[0-9]+$' THEN ts.t::int ELSE 2147483647 END, ts.t
  LOOP
    -- ── from here down: the ORIGINAL tile assembly, expression for expression ──────────────
    IF r.has_orders THEN
      IF    r.nw > 0 THEN v_state := 'new';   v_label := 'New order';
      ELSIF r.rd > 0 THEN v_state := 'ready'; v_label := 'Ready to serve';
      ELSIF r.ck > 0 THEN v_state := 'prep';  v_label := 'Preparing';
      -- (T16 7902) With no countable lines, fall back to the ORDERS' own status before deciding
      -- this table is waiting to pay — a 'preparing' order must never read as "Served".
      ELSIF (r.nw + r.ck + r.rd + r.sv) = 0 AND r.any_new_order  THEN v_state := 'new';  v_label := 'New order';
      ELSIF (r.nw + r.ck + r.rd + r.sv) = 0 AND r.any_prep_order THEN v_state := 'prep'; v_label := 'Preparing';
      ELSIF r.unpaid THEN v_state := 'bill';  v_label := 'Served';
      ELSE                v_state := 'done';  v_label := 'Cleared';
      END IF;
      IF (r.nw + r.ck + r.rd + r.sv) > 0 THEN
        v_meta := r.sv || '/' || (r.nw + r.ck + r.rd + r.sv) || ' served'
                  || CASE WHEN r.due > 0 THEN ' · ' || lfh_inr(r.due) || ' due' ELSE '' END;
      ELSE
        -- (T16 7902) An unpaid tile is drawn with the red outline, which promises an amount. When
        -- there is none, say so rather than leaving the waiter to tap a pay button that does nothing.
        v_meta := r.oc || ' order' || CASE WHEN r.oc = 1 THEN '' ELSE 's' END
                  || CASE WHEN r.unpaid AND r.due <= 0 THEN ' · nothing to pay' ELSE '' END;
      END IF;
    ELSIF r.sess_id IS NOT NULL THEN
      IF r.members > 0 THEN v_state := 'seated'; v_label := 'Seated · ' || r.members; v_meta := 'no orders yet';
      ELSE                  v_state := 'waiting'; v_label := 'Open';                  v_meta := 'waiting for guests';
      END IF;
    ELSIF r.reqs > 0 THEN
      v_state := 'req'; v_label := 'Wants in'; v_meta := 'asked for access';
    ELSE
      v_state := 'free'; v_label := 'Free'; v_meta := 'tap to open';
    END IF;

    -- Collected, not concatenated. `v_tiles := v_tiles || one_tile` re-copies the whole growing
    -- object on every table — 300 tables cost 106 ms of pure copying, 92% of this function's
    -- remaining time. PL/pgSQL keeps a local ARRAY in an expanded form where appending is cheap,
    -- so the tiles are gathered here and the object is built once, below (8.5 ms). jsonb stores
    -- an object's keys in its own sorted order, so gathering them this way cannot change the
    -- answer — proven by the parity harness, not assumed.
    v_keys := array_append(v_keys, r.t);
    v_vals := array_append(v_vals, jsonb_build_object(
      'state',   v_state,
      'label',   v_label,
      'meta',    v_meta,
      'members', r.members,
      'pending', r.pending,
      'counts',  jsonb_build_object('nw', r.nw, 'ck', r.ck, 'rd', r.rd, 'sv', r.sv),
      'due',     round(r.due, 2),
      'pay',     CASE WHEN r.unpaid THEN 'red' WHEN r.paid_any THEN 'green' ELSE '' END,
      'tag',     COALESCE(r.tag, ''),
      'hasNew',  r.nw > 0,
      'hasCall', r.calls > 0,
      'hasReq',  r.reqs > 0,
      'hasJoin', r.pending > 0,
      'reqs',    r.reqs,
      'calls',   r.calls
    ));
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(z.k, z.v), '{}'::jsonb) INTO v_tiles
    FROM unnest(v_keys, v_vals) AS z(k, v);

  -- ── the restaurant-wide aggregates ──────────────────────────────────────────────────────
  -- The count used to be written as count(*) FILTER (…) over EVERY order the restaurant has
  -- ever taken, which made this one line the most expensive thing in the whole function: it
  -- walked all 41 766 rows of a demo floor and measured 14 ms at best, 170 ms on average and
  -- 1 102 ms at worst — and that swing, times every panel polling, is what reached the
  -- statement timeout. Moving the same two conditions into WHERE asks for the IDENTICAL answer
  -- (a FILTER that discards a row and a WHERE that never fetches it agree, NULLs included) but
  -- lets the partial index idx_orders_floor_live serve it: 0.12 ms, and steady.
  SELECT count(*) INTO v_order_count
    FROM orders
   WHERE restaurant_id = v_rid AND NOT archived AND status <> 'cancelled';

  SELECT o2.table_number INTO v_latest_tbl
    FROM orders o2
   WHERE o2.restaurant_id = v_rid AND NOT o2.archived AND o2.status <> 'cancelled'
   ORDER BY o2.created_at DESC LIMIT 1;

  RETURN json_build_object(
    'tiles', v_tiles,
    'order_count', COALESCE(v_order_count, 0),
    'latest_order_table', v_latest_tbl,
    'calls', COALESCE((SELECT json_agg(json_build_object(
                'id', c.id, 'table_number', c.table_number, 'note', c.note,
                'created_at', c.created_at, 'resolved', c.resolved) ORDER BY c.created_at DESC)
               FROM waiter_calls c
              WHERE c.restaurant_id = v_rid AND NOT c.resolved
                AND (NOT v_sessions_on
                     OR EXISTS (SELECT 1 FROM sessions s2
                                 WHERE s2.id = c.session_id AND s2.status = 'open'
                                   AND s2.restaurant_id = v_rid))), '[]'::json),
    'requests', COALESCE((SELECT json_agg(json_build_object(
                'id', r2.id, 'table_number', r2.table_number, 'type', r2.type,
                'name', r2.name, 'phone', r2.phone, 'created_at', r2.created_at) ORDER BY r2.created_at)
               FROM requests r2
              WHERE r2.restaurant_id = v_rid AND r2.status = 'pending'), '[]'::json),
    'joiners', COALESCE((SELECT json_agg(json_build_object(
                'id', m.id, 'name', m.name, 'phone', m.phone, 'joined_at', m.joined_at,
                'table_number', s.table_number, 'session_id', m.session_id) ORDER BY m.joined_at)
               FROM session_members m
               JOIN sessions s ON s.id = m.session_id
              WHERE s.restaurant_id = v_rid AND s.status = 'open'
                AND NOT m.removed AND NOT m.approved), '[]'::json),
    'blocklist', COALESCE((SELECT json_agg(b ORDER BY b.blocked_at DESC)
               FROM blocklist b WHERE b.restaurant_id = v_rid), '[]'::json)
  );
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_table_view_summary(p_restaurant_id uuid, p_table text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_table_view_summary(p_restaurant_id uuid, p_table text) TO service_role;

-- ── lfh_uncapture_customer(p_restaurant_id uuid, p_table text, p_session uuid) · plpgsql · 1 fallback replaced ──
CREATE OR REPLACE FUNCTION public.lfh_uncapture_customer(p_restaurant_id uuid, p_table text, p_session uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rid   uuid := lfh_rid(p_restaurant_id);
  v_sid   uuid;
  v_phone text;
BEGIN
  -- Reversing a payment must reverse THAT bill's visit. Resolving by table number is what
  -- deleted an innocent party's visit row when the table had already been re-seated.
  IF p_session IS NOT NULL THEN
    SELECT id INTO v_sid FROM sessions WHERE id = p_session AND restaurant_id = v_rid;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table AND status = 'open'
      ORDER BY last_activity_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN
    SELECT id INTO v_sid FROM sessions
      WHERE restaurant_id = v_rid AND table_number = p_table
      ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_sid IS NULL THEN RETURN json_build_object('ok', true, 'reversed', false); END IF;

  DELETE FROM customer_visits WHERE session_id = v_sid RETURNING phone INTO v_phone;
  IF v_phone IS NULL THEN RETURN json_build_object('ok', true, 'reversed', false); END IF;

  -- Never below zero. Devices stay linked (the person still owns them).
  UPDATE customers SET visits = GREATEST(visits - 1, 0)
    WHERE restaurant_id = v_rid AND phone = v_phone;
  RETURN json_build_object('ok', true, 'reversed', true);
END; $function$;

REVOKE ALL ON FUNCTION public.lfh_uncapture_customer(p_restaurant_id uuid, p_table text, p_session uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_uncapture_customer(p_restaurant_id uuid, p_table text, p_session uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
