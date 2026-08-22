-- 296_database_layer_a_sweep_fixes.sql
--   (renumbered 295 -> 296: a parallel session merged its own 295 minutes earlier. Two files
--    sharing a number apply in FILENAME order, not intent order — the exact trap this sweep
--    reported as a finding, hit for real inside the hour. Already applied to the backup DB
--    under the old name; every statement is idempotent, so re-running under this one is a no-op.)
-- The database-layer findings from the 001–150 migration sweep (T8), fixed at the source.
--
-- The shape of almost every fault below is the same, and worth naming once: a migration
-- stated a rule in CODE, a later migration changed the world around it, and nothing in the
-- DATABASE enforced the rule — so a script, a backdated insert or a second restaurant could
-- quietly break it and every check stayed green.
--
-- WHAT IS DELIBERATELY *NOT* HERE: not one stored bill is edited. Rows that already violate
-- these rules are history — a settled sale, even a demo one, is never rewritten (the billing
-- guardrail). Everything below makes the rule true for every FUTURE write and leaves the past
-- exactly as it is. The demo restaurants' existing odd numbers clear on the next re-seed.
--
--   1. KOT numbers: uncapped, per business DAY, and never issued twice.   (sweep F1)
--   2. A discount can never exceed the food it is taken off.             (sweep F2)
--   3. A restaurant's dish numbers are its own, not the platform's.      (sweep F6)
--   4. The dormant verification pair is whole again, and fails CLOSED.   (sweep F4, F5)
--   5. Every restaurant has a settings row, so no floor renders empty.   (sweep F16)
--   6. `status` / `payment_status` can no longer grow a new spelling.    (sweep F7)
--   7. The locks migrations 094/003/078 asked for are re-applied.        (sweep F9, F13)
--   8. One provably-unused index is dropped.                            (sweep F10)

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 1. KOT NUMBERS — uncapped, per business day, never issued twice
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE OWNER'S REQUIREMENT (2026-08-05): the kitchen ticket number must NOT stop at a hundred.
-- If a day takes two or three thousand orders the series must reach that, and it must start
-- again at 1 when the day rolls over. That is already true — `kot_no` is a plain integer (so
-- ~2.1 billion), nothing in the app pads or wraps it, and real data shows French House running
-- #1 → #414 inside one business day and starting again at #1 the next. Nothing here changes
-- that; this section PROTECTS it, because there was one way to break it:
--
-- THE BUG. Migration 036 makes the counter atomic, but `lfh_assign_kot` only fills `kot_no`
-- when the caller left it NULL, and a caller that brings its OWN number never moved the
-- counter. The history seeder does exactly that (a backdated bill has to keep the number it
-- carried that day), so the counter stayed behind the numbers already in use and the next real
-- order that day was handed one of them. Live evidence at the time of writing: 94 duplicate
-- (restaurant, business day, kot_no) groups on French House and 6 on Pizza Palace — two
-- different bills carrying the number the kitchen shouts.
--
-- A SECOND, QUIETER BUG in the same function: `lfh_next_counter` keys on `now()`, so a
-- backdated insert with a NULL kot_no drew from TODAY's series instead of its own day's.
--
-- THE FIX. Split "which day is this row on" from "give me the next number on that day", so
-- both branches agree, and make a supplied number MOVE THE COUNTER PAST ITSELF.

-- The one definition of which business day a moment belongs to (05:00 IST rollover, migration
-- 044). Keeping it in a function means the counter, a backdated insert and any later reader
-- can never drift apart the way they just did.
CREATE OR REPLACE FUNCTION lfh_business_day(p_at timestamptz DEFAULT now())
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ((COALESCE(p_at, now()) AT TIME ZONE 'Asia/Kolkata') - interval '5 hours')::date;
$$;

-- Next number in a restaurant's series ON A GIVEN DAY. Same atomic upsert migration 036 used
-- (two simultaneous orders cannot share a number); the day is now an argument instead of
-- always being today.
CREATE OR REPLACE FUNCTION lfh_next_counter_on(p_rid uuid, p_key text, p_day date)
RETURNS int LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO daily_counters(restaurant_id, key, day, n) VALUES (p_rid, p_key, p_day, 1)
    ON CONFLICT (restaurant_id, key, day) DO UPDATE SET n = daily_counters.n + 1
    RETURNING n INTO v_n;
  RETURN v_n;
END; $$;

-- A writer that brings its own number must still move the counter past it. GREATEST, never a
-- plain assignment, so a low backdated number can't drag a day's series backwards.
CREATE OR REPLACE FUNCTION lfh_reserve_counter(p_rid uuid, p_key text, p_day date, p_n int)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_n IS NULL OR p_n < 1 THEN RETURN; END IF;
  INSERT INTO daily_counters(restaurant_id, key, day, n) VALUES (p_rid, p_key, p_day, p_n)
    ON CONFLICT (restaurant_id, key, day) DO UPDATE SET n = GREATEST(daily_counters.n, EXCLUDED.n);
END; $$;

-- The existing entry point keeps its signature and behaviour (today's series) so every
-- caller — the bill trigger, the platform insert, the banquet path — is untouched.
CREATE OR REPLACE FUNCTION lfh_next_counter(p_rid uuid, p_key text)
RETURNS int LANGUAGE sql SET search_path = public AS $$
  SELECT lfh_next_counter_on(p_rid, p_key, lfh_business_day());
$$;

CREATE OR REPLACE FUNCTION lfh_assign_kot() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_rid uuid := COALESCE(NEW.restaurant_id, '00000000-0000-0000-0000-000000000001'::uuid);
  v_day date := lfh_business_day(COALESCE(NEW.created_at, now()));
BEGIN
  IF NEW.kot_no IS NULL THEN
    -- Draw from the series for THIS ROW's day, not today's.
    NEW.kot_no := lfh_next_counter_on(v_rid, 'kot', v_day);
  ELSE
    -- The caller brought its own number: make sure nobody is handed it again.
    PERFORM lfh_reserve_counter(v_rid, 'kot', v_day, NEW.kot_no);
  END IF;
  RETURN NEW;
END; $$;

-- Staff-only, like every counter helper since migration 038. The order triggers reach these
-- either as service_role (the panels) or from inside a SECURITY DEFINER order RPC (a guest),
-- so no guest ever needs EXECUTE of their own.
REVOKE ALL ON FUNCTION lfh_business_day(timestamptz)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_next_counter_on(uuid, text, date)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_reserve_counter(uuid, text, date, int)        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_business_day(timestamptz)                 TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_next_counter_on(uuid, text, date)         TO service_role;
GRANT  EXECUTE ON FUNCTION lfh_reserve_counter(uuid, text, date, int)    TO service_role;
REVOKE ALL ON FUNCTION lfh_next_counter(uuid, text)                      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_next_counter(uuid, text)                  TO service_role;

-- One-time repair of the COUNTERS (not of any bill): for every restaurant-day that already
-- issued numbers, park the counter at the highest number in use, so the next order that day
-- continues the series instead of colliding with it. Reads orders only; writes counters only.
INSERT INTO daily_counters (restaurant_id, key, day, n)
SELECT o.restaurant_id, 'kot', lfh_business_day(o.created_at), MAX(o.kot_no)
  FROM orders o
 WHERE o.kot_no IS NOT NULL
 GROUP BY 1, 2, 3
ON CONFLICT (restaurant_id, key, day) DO UPDATE SET n = GREATEST(daily_counters.n, EXCLUDED.n);

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 2. A DISCOUNT CAN NEVER EXCEED THE FOOD IT IS TAKEN OFF
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE BUG. Migrations 143 and 148 both clamp a discount to the order's own pre-tax subtotal,
-- but only in the two functions that happen to route through them. Nothing in the database
-- said so, so the history seeder — which picks a discount from a fixed ₹50–₹200 list without
-- looking at the order it is attaching to — planted 40 bills where the discount is larger than
-- the food. Every money surface reads `total − discount × (1 + rate)`, so each of those bills
-- contributes NEGATIVE revenue: −₹519.75 on Aangan alone, −₹1,399.65 across six restaurants.
-- What an owner sees is a day's total short by up to ₹520 with no bill on the list explaining
-- where it went.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT. A CHECK is evaluated as each row is written, and
-- `lfh_delete_order_item` lowers `subtotal` in one statement and lets the AFTER trigger rescale
-- `discount` in the next — so a CHECK would reject the perfectly correct act of removing a dish
-- from a discounted order. A BEFORE trigger clamps instead of refusing, which is both
-- non-breaking and self-healing.
--
-- THE DIRECTION MATTERS: this only ever moves a discount DOWN, which can only ever move a bill
-- UP. It cannot hide or shrink a sale, so it is the compliant side of the line.
CREATE OR REPLACE FUNCTION lfh_clamp_order_discount() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.discount, 0) < 0 THEN
    NEW.discount := 0;
  ELSIF COALESCE(NEW.discount, 0) > COALESCE(NEW.subtotal, 0) THEN
    NEW.discount := GREATEST(COALESCE(NEW.subtotal, 0), 0);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION lfh_clamp_order_discount() FROM PUBLIC, anon, authenticated;

-- Fires on the two columns that decide the answer, so it also catches the case where the FOOD
-- shrinks under a discount that was fine a moment ago. It runs BEFORE the mig-143/148 re-split
-- (an AFTER trigger), and both only ever produce a smaller number, so they never fight.
DROP TRIGGER IF EXISTS trg_clamp_order_discount ON orders;
CREATE TRIGGER trg_clamp_order_discount
  BEFORE INSERT OR UPDATE OF discount, subtotal ON orders
  FOR EACH ROW EXECUTE FUNCTION lfh_clamp_order_discount();

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 3. A RESTAURANT'S DISH NUMBERS ARE ITS OWN
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE BUG. Migration 032 exists to give staff a short reference to say out loud — its own
-- example is "Espresso (#7)". Migration 082 then made `dish_no` unique PER restaurant, but
-- `assign_dish_no` still took `MAX(dish_no)` across the whole table, so numbers came from one
-- global pool: French House #1–59, Pizza Palace #60–72, Aangan #195–467 (201 dishes spread over
-- 273 numbers, interleaved with OG's Cafe #335–406). No restaurant but the first has a menu
-- that starts at 1, and "#467" is not a number anyone shouts across a kitchen.
--
-- Fixed for every dish added from now on: each restaurant continues from ITS OWN highest number,
-- and a brand-new restaurant starts at #1.
--
-- EXISTING numbers are deliberately left alone. They are display-only (an order stores the dish
-- id, never the number), so a renumber is technically safe — but it would change a reference the
-- staff of a live restaurant already have in their heads and on printed sheets. That is the
-- owner's call to make, not a migration's, and it is a one-line UPDATE whenever he wants it.
CREATE OR REPLACE FUNCTION assign_dish_no() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.dish_no IS NULL THEN
    SELECT COALESCE(MAX(dish_no), 0) + 1 INTO NEW.dish_no
      FROM menu_items WHERE restaurant_id = NEW.restaurant_id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION assign_dish_no() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 4. THE DORMANT VERIFICATION PAIR IS WHOLE AGAIN, AND FAILS CLOSED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- TWO BUGS, both invisible while the feature is off — which is exactly why nobody caught them.
--
-- (a) HALF THE FEATURE IS MISSING. Migration 040 created `lfh_request_verification` AND
--     `lfh_check_verification`. Only the request half is in the database. Turn the switch on
--     and a guest can be sent a code that nothing on earth can check. Neither `verify:grants`
--     (which inspects functions that exist) nor `verify:db-parity` (which compares the two
--     stacks, and both are missing it) could see an ABSENT function.
--
-- (b) THE SWITCH FAILS OPEN. Both read `settings WHERE id = 'site'` — and 'site' is restaurant
--     #1's row alone, so #1's switch decides for every restaurant on the platform (migration 085
--     flagged this and left it open; it is still open 65 migrations later). Worse: if that row is
--     ever renamed, the read finds nothing, `v_on` is NULL, and `IF NOT v_on` is NULL — which is
--     not TRUE, so the guard does not fire and the function starts handing out codes with the
--     feature off.
--
-- Both fixed: the restaurant is now an argument, the answer is that restaurant's own switch, and
-- anything unclear — no restaurant given, no settings row, NULL flag — answers 'disabled'.
DROP FUNCTION IF EXISTS lfh_request_verification(text, text);
CREATE OR REPLACE FUNCTION lfh_request_verification(
  p_contact text, p_channel text, p_restaurant_id uuid DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on boolean; v_code text;
BEGIN
  -- No restaurant, no answer. Fails CLOSED rather than falling back to restaurant #1.
  IF p_restaurant_id IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'disabled'); END IF;
  SELECT COALESCE((features->>'verification')::boolean, false) INTO v_on
    FROM settings WHERE restaurant_id = p_restaurant_id;
  -- COALESCE around v_on itself: a missing settings row must read as OFF, not as "unknown".
  IF NOT COALESCE(v_on, false) THEN RETURN json_build_object('ok', false, 'reason', 'disabled'); END IF;
  IF p_channel NOT IN ('sms','whatsapp','email') THEN RETURN json_build_object('ok', false, 'reason', 'bad_channel'); END IF;
  IF length(trim(COALESCE(p_contact, ''))) < 5 THEN RETURN json_build_object('ok', false, 'reason', 'bad_contact'); END IF;
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO verification_codes(contact, channel, code, expires_at, restaurant_id)
    VALUES (trim(p_contact), p_channel, v_code, NOW() + interval '10 minutes', p_restaurant_id);
  -- Actually SENDING the code still needs a paid provider — deliberately left for the day the
  -- switch turns on (migration 037's note still stands).
  RETURN json_build_object('ok', true);
END; $$;

-- The missing half, restored — and scoped, so one restaurant's code can never satisfy another's.
CREATE OR REPLACE FUNCTION lfh_check_verification(
  p_contact text, p_code text, p_restaurant_id uuid DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on boolean; v_row verification_codes;
BEGIN
  IF p_restaurant_id IS NULL THEN RETURN json_build_object('ok', false, 'reason', 'disabled'); END IF;
  SELECT COALESCE((features->>'verification')::boolean, false) INTO v_on
    FROM settings WHERE restaurant_id = p_restaurant_id;
  IF NOT COALESCE(v_on, false) THEN RETURN json_build_object('ok', false, 'reason', 'disabled'); END IF;
  SELECT * INTO v_row FROM verification_codes
    WHERE contact = trim(COALESCE(p_contact, '')) AND code = p_code
      AND NOT used AND expires_at > NOW()
      AND restaurant_id = p_restaurant_id
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('ok', false, 'reason', 'wrong_or_expired'); END IF;
  UPDATE verification_codes SET used = true WHERE id = v_row.id;
  RETURN json_build_object('ok', true);
END; $$;

-- Guest-facing, exactly as migration 040 granted them.
GRANT EXECUTE ON FUNCTION lfh_request_verification(text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION lfh_check_verification(text, text, uuid)   TO anon;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 5. EVERY RESTAURANT HAS A SETTINGS ROW
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE BUG. Migration 079 added UNIQUE (restaurant_id) to `settings`, which guarantees AT MOST
-- one row per restaurant — never at least one. Two restaurants currently have none.
--
-- What that costs if it ever happens to a live restaurant: `lfh_floor_state` and
-- `lfh_table_view_summary` both read `COALESCE(table_count, 0) INTO v_table_count FROM settings
-- WHERE restaurant_id = …` and then `generate_series(1, GREATEST(v_table_count, 0))`. With no
-- row, `v_table_count` stays NULL, `GREATEST(NULL, 0)` is 0, and the series is empty — so the
-- floor renders ZERO TILES. A manager reads that as "this restaurant has no tables" instead of
-- "its settings are missing", which is the dishonest-empty-screen the owner's rules forbid.
--
-- Fixed at the root instead of in each reader: a restaurant cannot exist without a settings row.
-- The admin's create flow upserts on restaurant_id, so a bare row waiting for it is harmless.
INSERT INTO settings (id, restaurant_id)
SELECT r.slug, r.id
  FROM restaurants r
 WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.restaurant_id = r.id)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION lfh_settings_follow_restaurant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO settings (id, restaurant_id) VALUES (NEW.slug, NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION lfh_settings_follow_restaurant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_settings_follow_restaurant ON restaurants;
CREATE TRIGGER trg_settings_follow_restaurant
  AFTER INSERT ON restaurants
  FOR EACH ROW EXECUTE FUNCTION lfh_settings_follow_restaurant();

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 6. `status` / `payment_status` CANNOT GROW A NEW SPELLING
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE BUG. Migration 006 added `orders.status` and 009 added `orders.payment_status`, both as
-- bare TEXT with no CHECK — `orders` has no CHECK constraints at all. Live data now holds THREE
-- spellings of "not paid yet": 'paid' (29,030), 'pending' (1,410) and 'unpaid' (28). The 'unpaid'
-- rows come from a test script, not from any app code (fixed in the same change as this file).
--
-- Nothing in the app filters `payment_status = 'pending'` today — every money path asks
-- `= 'paid'` or `<> 'paid'` — so all three behave correctly by luck. The risk is the NEXT filter
-- somebody writes as `= 'pending'`, which would silently skip 28 bills and fail no test.
--
-- NOT VALID on purpose: the constraint governs every future write and does not touch, reject or
-- rewrite a single existing row. 'unpaid' is listed because those rows exist and a settled record
-- is not ours to rewrite — but no code may produce it any more.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_chk;
ALTER TABLE orders ADD  CONSTRAINT orders_status_chk
  CHECK (status IN ('received','preparing','served','cancelled')) NOT VALID;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_chk;
ALTER TABLE orders ADD  CONSTRAINT orders_payment_status_chk
  CHECK (payment_status IN ('pending','paid','unpaid')) NOT VALID;

COMMENT ON CONSTRAINT orders_payment_status_chk ON orders IS
  '''pending'' and ''paid'' are the live values. ''unpaid'' is a legacy spelling left by an old test fixture and kept only so existing rows stay writable — no code may write it.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 7. THE LOCKS 094 / 003 / 078 ASKED FOR, RE-APPLIED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- (a) Migration 094 ends with `revoke all on public.issues from anon, authenticated` — a
--     deliberate second layer on top of "RLS on, no policy". That revoke is gone from the live
--     database, so row-level security is the only thing left between the public key and the
--     complaints feed. The identical revoke in migration 122 (restaurant_billing /
--     restaurant_payments) DID survive, so the pattern had quietly become inconsistent — and the
--     table left on one layer is the one nobody would think to re-check.
REVOKE ALL ON public.issues FROM anon, authenticated;

-- (b) Migrations 003 and 078 created public READ policies on `settings` and `restaurants`. Those
--     policies were removed on purpose by the later one-RPC-door guest-config work (a guest now
--     reads both through `lfh_guest_settings` / `lfh_guest_restaurant`), and anon's SELECT went
--     with them. But anon's INSERT and UPDATE grants on both tables were left behind. RLS denies
--     them, so nothing can use them — they are dead privileges that read as permission to anyone
--     auditing grants, which is how the next person talks themselves out of a real finding.
REVOKE INSERT, UPDATE, DELETE ON public.settings    FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.restaurants FROM anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 8. ONE PROVABLY-UNUSED INDEX
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- `idx_otp_phone` (migration 014) indexes `otp_codes(phone)` alone, but every lookup since
-- migration 084 asks `phone = ? AND restaurant_id = ?`. `pg_stat_user_indexes` reports 0 scans
-- against it. Dropped.
--
-- Two indexes the sweep first suspected are STAYING, because measurement said otherwise:
-- `idx_requests_table_status` has 1,638,821 scans (the most-used index on that table) and
-- `idx_sessions_table_status` has 8,896. Reasoning said they were superseded; the counters said
-- they are load-bearing. The counters win.
DROP INDEX IF EXISTS idx_otp_phone;

NOTIFY pgrst, 'reload schema';

-- ⚠️ RUN-ALONE GUARD (added 2026-08-21 when migration 360 retired this function).
-- `lfh_request_verification` above is RETIRED. Migration 297 already recorded that it is "the
-- SURVIVING HALF OF A RETIRED STUB… nothing in the app calls it… safe to drop when someone
-- decides to"; the owner decided, and migration 360 dropped it. This file re-creates the
-- three-argument version AND re-grants it to the public menu key, so running it by hand puts a
-- code-issuing door back beside the real one — which is exactly what happened on the shared dev
-- database while the 001-118 sweep was running, and what npm run verify:run-alone caught.
-- A full re-seed ends correctly (354 sorts after this file). This closes the partial-run route.
DROP FUNCTION IF EXISTS lfh_request_verification(text, text, uuid);
