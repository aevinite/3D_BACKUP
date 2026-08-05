-- 300_database_layer_b_sweep_fixes.sql
--
-- Seven fixes from the T16 sweep of migrations 151–286 (the database layer). Each one is a
-- separate section below with the reasoning it came from, so a later reader can tell WHY the
-- line is there and not just what it does.
--
-- Every body below was taken from `pg_get_functiondef()` on the backup database, not copied
-- from an older migration file — the documented "migration recreate reverts a fix" trap. The
-- three functions this file replaces were each checked against migrations 287–299 first, so no
-- other session's in-flight fix is undone here.

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- B1 — THE SETTLED-BILL REFUSAL GETS ITS OWN CODE BACK (undone by mig 286)
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration 278 exists for one reason, and its header spells it out: a refusal the app must
-- RECOGNISE gets its own SQLSTATE instead of being identified by the WORDS of its message,
-- because a refusal arriving with no recognised code is classified as an unknown failure →
-- 500 → and a 500 on a write means "the server is struggling", so public/panels/outbox.js
-- QUEUES the action and replays it forever behind the person.
--
-- Migration 286 then rewrote this same function to require a void reason — a good change — but
-- set the settled-lock refusal back to `errcode = 'check_violation'`. 286 sorts later, so that
-- is what the database raises today, and `LFH01` survives only in lfh_generate_invoice.
--
-- Nothing is visibly broken right now ONLY because 286 kept 278's exact sentence and the three
-- route branches still fall back to matching `/invoice locked/i`
-- (app/api/editor/[...path]/route.ts, app/api/tablet/[...path]/route.ts). 278 described that
-- prose match as a compatibility fallback for a database that had not run the migration yet —
-- not as the mechanism. Reword the sentence, translate it, or drop the em-dash, and a manager
-- reopening a settled bill stops being told "this bill is settled" and instead watches a blue
-- "saved, sending later" bar retry a request that can never succeed.
--
-- B2 — AND THE MISSING-REASON REFUSAL GETS ONE FOR THE FIRST TIME
-- 286's new "a reason is required" guard also raises `check_violation`. That IS classified as a
-- data refusal (23514 is in lib/dbRefusal.ts REFUSAL_CODES), so it correctly answers 4xx and is
-- never retried — but no route branch and no named case matches it, so refusalMessage() falls
-- all the way through to the generic "That value isn't allowed here." and nobody learns they
-- need to type a reason. 286's own header says the check is there because "the Repair Kit, a
-- script or a future panel could not be relied on to" refuse an empty reason — and those are
-- exactly the callers that get the useless sentence, because the manager route validates the
-- reason before it ever calls.
--
--   LFH01 — the invoice is locked (the bill is settled and cannot be reopened)   [mig 278]
--   LFH03 — reopening a bill needs a reason                                      [new here]
--
-- The SENTENCES are unchanged on purpose: they are what a developer reads in the error log, and
-- the routes keep matching them as a fallback, so a database that has not run this file yet
-- behaves exactly as it does now. Nothing regresses on a stale copy.
CREATE OR REPLACE FUNCTION lfh_void_invoice(p_session uuid, p_reason text DEFAULT NULL, p_actor text DEFAULT NULL)
RETURNS sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v sessions;
BEGIN
  SELECT * INTO v FROM sessions WHERE id = p_session;
  IF NOT FOUND THEN RAISE EXCEPTION 'session not found'; END IF;
  -- nothing live to void → return unchanged, record nothing (unchanged from mig 189)
  IF v.invoice_no IS NULL OR v.invoice_voided THEN RETURN v; END IF;
  -- settled lock: the bill is finalised, the invoice cannot be reopened (mig 189/278)
  IF v.status = 'closed' THEN
    RAISE EXCEPTION 'lfh: invoice locked — the bill is settled and cannot be reopened (use a credit note)'
      USING errcode = 'LFH01';
  END IF;
  -- A REASON IS REQUIRED (mig 286). Checked here so no caller can skip it.
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'lfh: reopening a bill needs a reason — say why this invoice is being voided'
      USING errcode = 'LFH03';
  END IF;
  UPDATE sessions
     SET invoice_voided = true, void_reason = btrim(p_reason), void_at = now()
   WHERE id = p_session
   RETURNING * INTO v;
  INSERT INTO invoice_events(session_id, restaurant_id, invoice_no, event, reason, actor)
    VALUES (p_session, v.restaurant_id, v.invoice_no, 'void',
            btrim(p_reason), NULLIF(btrim(COALESCE(p_actor, '')), ''));
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION lfh_void_invoice(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_void_invoice(uuid, text, text) TO service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- B3 — COLLECTING AN OLD KHATA TAB MUST MOVE THE MONTH REPORT'S CHANGE-DETECTOR
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration 185 exists so khata (pay-later) money counts on the day it is COLLECTED, not the
-- day the food was ordered. lfh_owner_sales_report honours that — its month-tail admits an old
-- order when `khata_at IS NOT NULL AND paid_at IS NOT NULL AND paid_at >= mtail_start`
-- (mig 203/213). The fingerprint that decides whether to recompute that report does NOT: its
-- tail is `o.created_at >= tail_start` only, so an order created in a frozen month is invisible
-- to it no matter what happens to the money.
--
-- What that costs a real owner: a waiter collects a ₹5,000 tab from last month. The owner opens
-- the month (or any window wider than ~35 days) money report. lib/ownerCache.ts returns the
-- stored snapshot instantly and revalidates in the background; the fingerprint is byte-identical,
-- so it stamps the row fresh and never recomputes. The ₹5,000 is simply absent, with nothing on
-- screen saying so, until he presses Refresh or the nightly rebuild moves `refreshed_at`.
--
-- WHY A THIRD CTE RATHER THAN AN `OR` ON THE EXISTING TAIL. The whole point of this function is
-- that it costs ~35ms instead of the ~9.5s full scan it replaced, and that rests on the tail
-- being an index range scan on (restaurant_id, created_at). Adding an OR over a second column
-- risks the planner abandoning that. A separate bounded CTE keeps the existing plan untouched
-- and adds one more indexed range scan, on `idx_orders_khata_paid_at` (paid_at), which
-- migration 201 created for exactly this column.
--
-- It can only ever cause one NEEDLESS recompute, never miss a change — the same safe direction
-- migration 246 reasoned about for the day-bucket watermark.
CREATE OR REPLACE FUNCTION public.lfh_owner_report_month_fingerprint(p_ids uuid[], p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  wm AS (
    SELECT rolled_through_month, refreshed_at,
           ((date_trunc('month', rolled_through_month) + interval '1 month')::timestamp
              AT TIME ZONE 'Asia/Kolkata') AS tail_start
    FROM orders_report_monthly_agg_state
  ),
  frozen AS (
    SELECT COALESCE(SUM(a.all_orders + a.canc_orders), 0) AS cnt
    FROM orders_report_monthly_agg a
    WHERE a.month <= (SELECT rolled_through_month FROM wm)
      AND a.month >= date_trunc('month', (p_from AT TIME ZONE 'Asia/Kolkata'))::date
      AND (p_ids IS NULL OR a.restaurant_id = ANY (p_ids))
  ),
  tail AS (
    SELECT count(*) AS cnt,
           max(greatest(o.created_at, o.edited_at, o.paid_at, o.cancelled_at, o.deleted_at)) AS act
    FROM orders o
    WHERE o.created_at >= (SELECT tail_start FROM wm)
      AND o.created_at <  p_to
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
  ),
  -- NEW (mig 300): a khata tab OPENED in a frozen month but COLLECTED inside this window is
  -- real money the report counts, so it has to be able to move this string. Excludes anything
  -- the tail already counted, so nothing is double-counted.
  khtail AS (
    SELECT count(*) AS cnt, max(o.paid_at) AS act
    FROM orders o
    WHERE o.khata_at IS NOT NULL
      AND o.paid_at IS NOT NULL
      AND o.paid_at >= (SELECT tail_start FROM wm)
      AND o.paid_at <  p_to
      AND o.created_at < (SELECT tail_start FROM wm)
      AND (p_ids IS NULL OR o.restaurant_id = ANY (p_ids))
  )
  SELECT ((SELECT cnt FROM frozen) + (SELECT cnt FROM tail) + (SELECT cnt FROM khtail))::text || ':' ||
         coalesce(extract(epoch FROM greatest(
             (SELECT refreshed_at FROM wm),
             (SELECT act FROM tail),
             (SELECT act FROM khtail)))::bigint::text, '0');
$function$;

REVOKE ALL ON FUNCTION public.lfh_owner_report_month_fingerprint(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfh_owner_report_month_fingerprint(uuid[], timestamptz, timestamptz) TO service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- B4 — TWO GUEST-GRANTED TAX HELPERS COULD NOT ACTUALLY RUN AS A GUEST
-- ═════════════════════════════════════════════════════════════════════════════
-- `lfh_resolve_tax_mode` (mig 270) and `lfh_effective_tax_rate` (mig 119/272) both carry an
-- anon EXECUTE grant, both are SECURITY **INVOKER** (confirmed: pg_proc.prosecdef = false), and
-- both read `public.settings`. Migration 283 revoked `SELECT ON public.settings FROM anon,
-- authenticated` and dropped the public read policy — so a guest calling either one would get
-- `permission denied for table settings` from inside the function body.
--
-- Nothing in the browser calls them today (the guest order path goes through
-- lfh_place_order_public, which is DEFINER and prices internally), so nothing is broken. What
-- was wrong is the written record, in three places that all assert the opposite:
--   · mig 287's header: "reads only `settings`, which anon can already read" — untrue after 283;
--   · scripts/verify-db-grants.mjs ANON_ALLOWED: "the guest cart prices itself server-side"
--     (lfh_price_order) and "the guest cart shows tax" (lfh_effective_tax_rate);
--   · scripts/verify-families.mjs calls lfh_price_order WITH THE ANON KEY and asserts the server
--     ignores a tampered price — an assertion that can no longer pass on its own terms.
-- The grants guard cannot catch this class at all: it checks the EXECUTE bit, not whether the
-- body's own table reads would succeed for that role.
--
-- FIXED BY MAKING THE TWO HELPERS DEFINER rather than by dropping the grants, because the
-- INVOKER chain is load-bearing: lfh_price_order is itself INVOKER and anon-granted (mig 253
-- reasons about this deliberately), and it CALLS both of these. Making them DEFINER is what
-- makes that documented design actually true. Both are pure readers of a few tax columns and
-- both now pin search_path, which is the standing requirement for a DEFINER function here.
--
-- The BODIES are unchanged, character for character, from the live definitions — only the two
-- lines that decide whose privileges run them.
CREATE OR REPLACE FUNCTION lfh_resolve_tax_mode(p_dish_mode text, p_restaurant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE
      -- A composition-scheme restaurant may not pass GST to the diner at all, so nothing on
      -- its bill is taxable and no tax line is printed (docs/COMPLIANCE-GUARDRAILS.md §3).
      WHEN s.price_tax_mode = 'composition' THEN 'exempt'
      -- Master switch off → every dish follows the restaurant, whatever the dish says.
      WHEN NOT COALESCE(s.item_tax_modes_allowed, false)
        THEN CASE WHEN s.price_tax_mode = 'incl' THEN 'incl' ELSE 'excl' END
      WHEN COALESCE(p_dish_mode, 'default') = 'excl' THEN 'excl'
      WHEN COALESCE(p_dish_mode, 'default') = 'incl' THEN 'incl'
      WHEN COALESCE(p_dish_mode, 'default') = 'none' THEN 'exempt'
      WHEN COALESCE(p_dish_mode, 'default') = 'mrp'
        THEN CASE WHEN s.mrp_tax_treatment = 'inclusive' THEN 'incl' ELSE 'exempt' END
      ELSE CASE WHEN s.price_tax_mode = 'incl' THEN 'incl' ELSE 'excl' END
    END
    FROM settings s WHERE s.restaurant_id = p_restaurant_id
  ), 'excl');
$$;

CREATE OR REPLACE FUNCTION lfh_effective_tax_rate(p_restaurant_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT tax_rate, tax_components, price_tax_mode
      FROM settings WHERE restaurant_id = p_restaurant_id
  ), comps AS (
    SELECT COALESCE(SUM((c->>'rate')::numeric), 0) AS pct
      FROM s, jsonb_array_elements(
             CASE WHEN jsonb_typeof(s.tax_components) = 'array' THEN s.tax_components
                  ELSE '[]'::jsonb END) c
     WHERE COALESCE(NULLIF(TRIM(c->>'label'), ''), '') <> ''
       AND COALESCE((c->>'rate')::numeric, 0) > 0
  )
  SELECT CASE
    -- Composition scheme: the restaurant cannot pass GST to the diner, so its effective rate
    -- is 0 — not "5% that we then hide". Hiding a rate while still arithmetically applying it
    -- is how a bill stops adding up.
    WHEN (SELECT price_tax_mode FROM s) = 'composition' THEN 0
    WHEN COALESCE((SELECT pct FROM comps), 0) > 0 THEN (SELECT pct FROM comps) / 100.0
    ELSE COALESCE(NULLIF((SELECT tax_rate FROM s), 0), 0.05)
  END;
$$;

-- The grants these already carried, re-asserted so this file leaves the guest pricing chain
-- demonstrably intact rather than relying on CREATE OR REPLACE preserving them.
GRANT EXECUTE ON FUNCTION lfh_resolve_tax_mode(text, uuid)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION lfh_effective_tax_rate(uuid)      TO anon, authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- B5 — THE RETURNING-GUEST LOOKUP IS A STAFF QUESTION, NOT A GUEST ONE
-- ═════════════════════════════════════════════════════════════════════════════
-- `lfh_recognize_customer(phone, rid)` returns {known, name, blocked, visits} for ANY phone
-- number in a restaurant, and it is granted to anon. Its sibling twenty lines earlier in the
-- same migration — `lfh_greet_device` — gates its answer on `c.consent AND NOT c.blocked` and
-- never exposes the phone. Two doors to the same data, one of them with the consent rule and
-- one without.
--
-- The right correction turned out NOT to be "add the consent check": every real caller is
-- STAFF, through the service role — the till's repeat-customer lookup on the pay sheet
-- (app/api/editor/[...path]/route.ts `customer-recognize`, and the tablet's twin). A waiter
-- taking payment legitimately needs to recognise a walk-in who has never consented to
-- marketing, so gating on consent would break the feature it was built for.
--
-- The guest side simply does not use it: `recognizeCustomer` in lib/session.ts is an exported
-- wrapper with no callers anywhere (deleted in this same commit). So the anon grant buys
-- nothing and is dropped. `lfh_greet_device` remains the guest-facing door, which is exactly
-- what migration 212 designed it to be — the consented, phone-free greeting.
REVOKE ALL ON FUNCTION lfh_recognize_customer(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_recognize_customer(text, uuid) TO service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- B6 — THE LAST TWO TRIGGER FUNCTIONS NOTHING SHOULD CALL BY NAME
-- ═════════════════════════════════════════════════════════════════════════════
-- Migration 287 revoked exactly this class for the two trigger functions migration 270 left
-- callable, and wrote down why it was worth doing even though it changes no behaviour: "a
-- callable function that nothing is supposed to call is a loose end that reads as intentional
-- to whoever finds it next."
--
-- These two are the only functions first created anywhere in 151–286 that still have no REVOKE
-- in any migration in this repository. A trigger function is invoked by the trigger machinery,
-- not by a role calling it, so revoking changes nothing except that the rule now holds for all
-- four rather than two of four.
REVOKE ALL ON FUNCTION fix_request_resolve_error()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lfh_sections_follow_table_count()  FROM PUBLIC, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- B7 — THE TWO NIGHTLY FULL REBUILDS STOP RUNNING FIVE MINUTES APART
-- ═════════════════════════════════════════════════════════════════════════════
-- `lfh_refresh_orders_daily_agg` and `lfh_refresh_orders_report_monthly_agg` both begin with
-- `DELETE FROM <agg>` and re-aggregate the whole of `orders`. That is deliberate and correct —
-- a full rebuild is what makes a correction to an OLD order eventually reach the reports, which
-- an incremental roll-forward could never do. It is not a bug and this file does not change it.
--
-- The timing was the only real problem, and it is smaller than it first looked: cron runs in the
-- database's timezone, which is UTC here, so `20 0` and `25 0` are 05:50 and 05:55 IST — a
-- genuinely quiet hour for a restaurant, not service time. What remains is that two unbounded
-- scans of the money table are scheduled FIVE MINUTES apart on a free-tier shared single-vCPU
-- instance. The daily rebuild does not have to finish in five minutes, and if it does not, the
-- two overlap — which is the "a handful of unbounded analytics reads landing together" shape
-- that docs/PROJECT-HISTORY.md §2 identifies as what actually saturated the instance on
-- 2026-07-31 (order volume never was the risk).
--
-- Moving the monthly one to 00:50 UTC (06:20 IST) gives the daily rebuild half an hour to
-- itself and keeps both inside the quiet window. Same jobs, same functions, same day — only
-- further apart. pg_cron's schedule() upserts by job name, so this re-points the existing job
-- rather than creating a second one.
-- Scheduled at TOP LEVEL, with no EXCEPTION handler, deliberately: `npm run verify:grants`
-- refuses a migration that wraps a cron change in `EXCEPTION WHEN OTHERS`, because that is how
-- lfh-prune-logs and lfh-rt-prune went missing for months — the schedule failed and nothing said
-- so. If pg_cron is absent this line SHOULD fail the migration loudly rather than quietly leave
-- the job on its old time. (It caught this file on the first run; the guard works.)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('refresh-owner-report-monthly-agg', '50 0 * * *',
                     $sql$SELECT public.lfh_refresh_orders_report_monthly_agg();$sql$);

COMMIT;

NOTIFY pgrst, 'reload schema';
