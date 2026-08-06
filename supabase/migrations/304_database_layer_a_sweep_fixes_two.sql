-- 304_database_layer_a_sweep_fixes_two.sql
-- The database-half of the SECOND sweep of migrations 001–150 (T8, 2026-08-06), fixed at
-- the source. The first sweep's fixes are migration 296; this is what that pass did not reach.
--
-- Six changes, each one the smallest thing that makes a stated rule TRUE:
--   1. A blocked guest's appeal stays inside the restaurant it was made at, and stops
--      reporting success it did not have.                                        (F1/F2/F3)
--   2. The dish + category breakdowns speak the SAME money as every other ₹ figure. (F4)
--   3. A guest can no longer open a table — the rule migration 021 wrote down.      (F5)
--   4. `require_otp` defaults to OFF, like the feature it gates.                    (F8)
--   5. `settings` leaves the realtime publication it no longer has a listener for.  (F9)
--   6. `settings.tax_inclusive` — dead since migration 270 — is dropped.            (F10)
--
-- NOT HERE, deliberately: not one stored bill is rewritten. Section 2 changes how a REPORT
-- is computed, never what an order says. A settled sale is never edited (billing guardrail).

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 1. THE BLOCKED GUEST'S APPEAL — one restaurant, and an honest answer
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHAT THE GUEST SEES (components/BanGate.tsx): a full-screen "You've been blocked" wall that
-- says "leave your number below and ask a member of staff to unblock you", and then "✓ Your
-- unblock request has been sent."
--
-- THREE THINGS WERE WRONG WITH THE FUNCTION BEHIND THAT (migration 077, never redefined since):
--
--   a) NO RESTAURANT. It matched `device_id = p_device OR phone = p_phone` across the WHOLE
--      blocklist. Migration 142 had already made a BAN per-restaurant — "in a multi-tenant SaaS
--      one café must not be able to blacklist a guest from all the others" — but the APPEAL was
--      left global. So a guest blocked at two restaurants who appeals at one had their personal
--      phone number written onto the other restaurant's block record too. Same rule as mig 142:
--      a NULL p_restaurant_id means "every restaurant" (an old client that sends only two
--      arguments), and legacy rows with a NULL restaurant_id stay matchable so this can never
--      make an existing appeal unreachable.
--
--   b) A FALLBACK THAT COULD NEVER FIRE. When the first UPDATE matched nothing it retried
--      `WHERE unban_phone = btrim(p_phone)` — which can only match a row that ALREADY recorded
--      this same phone as an unban phone. For the case its own comment named ("banned by phone
--      only and the guest is on a fresh device") the FIRST update already handles it, because it
--      matches on `phone` too. The branch was dead in every direction. Dropped.
--
--   c) IT ALWAYS SAID YES. It returned {ok:true} regardless of whether a single row changed, so
--      the guest got the ✓ confirmation even when nothing was written. That is a tap reporting
--      success for something that did not happen — the "never drop a tap in silence" rule
--      inverted. It now answers ok:false + reason 'not_blocked' when it matched nothing, and the
--      wall tells the guest to speak to staff instead of pretending.
--
-- Signature changes (gains the restaurant), so the old one is dropped and the anon grant is
-- re-applied on the new one — this IS a guest-facing function and must stay reachable by the
-- guest's own browser (it is on the verify-db-grants allow-list for exactly that reason).
DROP FUNCTION IF EXISTS lfh_request_unban(text, text);

CREATE OR REPLACE FUNCTION lfh_request_unban(
  p_device text, p_phone text, p_restaurant_id uuid DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n     int;
  v_phone text := btrim(COALESCE(p_phone, ''));
BEGIN
  IF length(v_phone) < 5 THEN
    RETURN json_build_object('ok', false, 'reason', 'phone_required');
  END IF;

  UPDATE blocklist
     SET unban_phone = v_phone, unban_requested_at = NOW()
   WHERE ((p_device IS NOT NULL AND p_device <> '' AND device_id = p_device)
          OR phone = v_phone)
     -- Scoped exactly like the ban CHECK (mig 142): this restaurant, plus legacy rows that
     -- never stamped one, so a scoping change can never orphan an existing appeal.
     AND (p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id OR restaurant_id IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Tell the truth: only a row that actually changed is a request staff can see.
  IF v_n = 0 THEN
    RETURN json_build_object('ok', false, 'reason', 'not_blocked');
  END IF;
  RETURN json_build_object('ok', true, 'recorded', v_n);
END; $$;

REVOKE ALL ON FUNCTION lfh_request_unban(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lfh_request_unban(text, text, uuid) TO anon;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 2. THE DISH + CATEGORY BREAKDOWNS SPEAK THE SAME MONEY AS EVERYTHING ELSE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE BUG. Both breakdowns computed  revenue = Σ (qty × unit price) on paid orders. That figure
-- is PRE-TAX and GROSS OF ANY DISCOUNT. Every other ₹ on the same screens — the Sales report,
-- the dashboard KPI, the payment breakdown, the records strip — is
--      revenue = total − discount × (1 + rate)
-- (tax-inclusive, discount applied BEFORE tax), the rule migrations 113 → 126 → 140 spent four
-- passes converging on. So the "Revenue by dish" column could never add up to the revenue
-- printed beside it: too low by the tax, too high by the discount — two errors pulling opposite
-- ways, so not even a constant percentage anyone could learn to ignore.
--
-- Migration 113 saw half of this and said so in its own comment: the breakdowns' ₹ column "IS a
-- ₹ figure the owner UI renders alongside the paid-only restaurant-total revenue on the same
-- screen — so it gets the same paid filter, or the two would disagree". The PAID filter was
-- carried over. The TAX and DISCOUNT halves never were, and 126/140 (which moved every other
-- money RPC onto discount-before-tax) skipped these two.
--
-- THE FIX — allocate, don't recompute. Each order's net revenue is split across its own dish
-- lines in proportion to each line's gross (qty × price). By construction the shares of one
-- order sum back to that order's net revenue, so Σ(dish revenue) now equals the headline
-- revenue for the same window. Nothing about an ORDER changes; only how a report divides it.
--
-- HONEST LIMIT, written down rather than glossed: an order carrying money but NO dish lines in
-- its `items` JSON contributes nothing to a per-dish table (it has no dish to attribute to), and
-- an untitled line is excluded from the output while still counting in its order's gross. Both
-- are inherent to "revenue BY DISH" and neither is new here.
--
-- The rate is read ONCE per call instead of once per line: these functions fan out to one row
-- per dish line (far more rows than the per-order RPCs that call it per row), and every row here
-- belongs to p_restaurant_id anyway, so the value is identical and the work is not repeated.
--
-- Bodies are otherwise the LIVE ones, verbatim: the khata-aware date window, the `mi.title` join,
-- work_mem, STABLE/DEFINER/search_path and the unchanged `qty` column are all as they were.

CREATE OR REPLACE FUNCTION public.lfh_owner_dish_breakdown(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE(title text, qty bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET work_mem TO '128MB'
AS $function$
  WITH rate AS (SELECT lfh_effective_tax_rate(p_restaurant_id) AS r)
  SELECT it->>'title' AS title,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         -- this line's share of its order's NET revenue (discount before tax, tax included)
         COALESCE(SUM(
           CASE WHEN g.gross > 0 THEN
             (COALESCE(NULLIF(it->>'qty', '')::numeric, 0) * COALESCE(NULLIF(it->>'price', '')::numeric, 0))
             / g.gross
             * (o.total - o.discount * (1 + (SELECT r FROM rate)))
           ELSE 0 END
         ) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  -- the whole order's gross, so each line's share is a true proportion of it
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(
             COALESCE(NULLIF(e->>'qty', '')::numeric, 0) * COALESCE(NULLIF(e->>'price', '')::numeric, 0)
           ), 0) AS gross
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) e
  ) g ON true
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
    AND COALESCE(it->>'title', '') <> ''
  GROUP BY it->>'title'
  ORDER BY 3 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.lfh_owner_category_breakdown(
  p_restaurant_id uuid, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE(category text, qty bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET work_mem TO '128MB'
AS $function$
  WITH rate AS (SELECT lfh_effective_tax_rate(p_restaurant_id) AS r)
  SELECT COALESCE(mi.category, 'Other') AS category,
         COALESCE(SUM((it->>'qty')::numeric), 0)::bigint AS qty,
         COALESCE(SUM(
           CASE WHEN g.gross > 0 THEN
             (COALESCE(NULLIF(it->>'qty', '')::numeric, 0) * COALESCE(NULLIF(it->>'price', '')::numeric, 0))
             / g.gross
             * (o.total - o.discount * (1 + (SELECT r FROM rate)))
           ELSE 0 END
         ) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric AS revenue
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS it
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(
             COALESCE(NULLIF(e->>'qty', '')::numeric, 0) * COALESCE(NULLIF(e->>'price', '')::numeric, 0)
           ), 0) AS gross
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) e
  ) g ON true
  LEFT JOIN menu_items mi ON mi.restaurant_id = o.restaurant_id AND mi.title = (it->>'title')
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status <> 'cancelled'
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) >= p_from
    AND (CASE WHEN o.khata_at IS NOT NULL AND o.paid_at IS NOT NULL THEN o.paid_at ELSE o.created_at END) < p_to
  GROUP BY 1
  ORDER BY 3 DESC;
$function$;

-- Staff-only, as always (mig 038: a replaced function must never be left public-executable).
REVOKE EXECUTE ON FUNCTION lfh_owner_dish_breakdown(uuid, timestamptz, timestamptz)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_owner_dish_breakdown(uuid, timestamptz, timestamptz)     TO service_role;
REVOKE EXECUTE ON FUNCTION lfh_owner_category_breakdown(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_owner_category_breakdown(uuid, timestamptz, timestamptz) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 3. A GUEST CANNOT OPEN A TABLE
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Migration 021 wrote the rule down: "guests do NOT open tables. Staff open a table's session
-- from the editor floor… To order, the session must ALREADY be open." It enforced that by taking
-- the auto-open OUT of lfh_join_session — and left lfh_open_session, which does exactly what the
-- rule forbids (INSERT INTO sessions … status 'open'), still executable with the public menu key
-- that ships in every guest's browser.
--
-- Nothing calls it: zero call sites across app/, components/, lib/, public/panels/, scripts/ and
-- tests/. Staff open a table through lfh_staff_open_table (mig 114), which is service_role only.
-- So this is dead surface that can still act, and the honest fix is to remove it rather than
-- leave a second, weaker door next to the real one.
--
-- Dropped, not revoked: a revoked function is still a thing the next reader has to reason about,
-- and `expectedLiveFunctions()` in verify-db-grants replays creates and drops in order — so a
-- DROP here is how the intent gets written down where that check can see it.
DROP FUNCTION IF EXISTS lfh_open_session(text, text, uuid);

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 4. `require_otp` DEFAULTS TO OFF, LIKE THE FEATURE IT GATES
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Migration 014 created `require_otp BOOLEAN NOT NULL DEFAULT true`. Migration 018 shelved phone
-- OTP and said plainly that leaving it on "would make lfh_place_order reject every order with
-- 'otp_required'" — then fixed it with `UPDATE settings SET require_otp = false WHERE id='site'`.
-- That changed the ONE row that existed and left the column DEFAULT at true.
--
-- Since then every settings row has been born by cloning restaurant #1 (lib/settingsClone.ts),
-- which carries false — so nothing live is affected. But the trap is real and this database
-- proves it: the only three rows carrying `true` are test restaurants created some other way,
-- all three now in the recycle bin. A settings row made by a seed, a repair script or a hand
-- insert is still born refusing every guest order, with a code naming a shelved feature.
--
-- The default now matches the shipped behaviour. Existing rows are untouched (the three that
-- say true are binned test tenants; changing a stored value is not this migration's business).
ALTER TABLE settings ALTER COLUMN require_otp SET DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 5. `settings` LEAVES THE REALTIME PUBLICATION
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Migration 013 put `settings` on the publication so the guest site would react to a maintenance
-- or bubble toggle within ~1s. Both halves of that have since gone:
--   · the anon key has NO read policy on `settings` any more (migs 282/283 moved the guest onto
--     lfh_guest_settings), and Realtime enforces RLS on postgres_changes — so an anon subscriber
--     could not be delivered these rows even if it asked; and
--   · components/AppShell.tsx was rewritten to watch the BREADCRUMB (realtime_events,
--     topic_rid = 'menu:<rid>') instead, precisely so the guest would not need that table read.
-- Nothing subscribes to the table now, so every settings write is decoded into the logical
-- replication stream for a listener that does not exist. The admin settings screen writes on
-- every toggle.
--
-- Guarded so it is idempotent and so a project where it was already removed still applies clean.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.settings;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 6. `settings.tax_inclusive` IS DROPPED
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Created by migration 037 ("menu prices include tax?") and superseded by migration 270's
-- `price_tax_mode`, which is what every tax decision actually reads. `tax_inclusive` is read by
-- NO code anywhere — its only mentions outside its own migration are 270's note that it was
-- replaced, mig 282's guest denylist (which already withholds it), and reference/DATABASE.md.
-- It is NULL on all 16 settings rows, so nothing is lost.
--
-- Why bother: tax is the one subject where a stale-looking column is dangerous. Anyone reading
-- the schema to answer "does this restaurant quote tax-inclusive prices?" currently finds a
-- column whose name promises exactly that answer and whose value means nothing.
--
-- mig 282's denylist still names it; a denylist entry for a column that no longer exists is
-- inert (`to_jsonb(row) - ARRAY[…]` simply finds nothing to remove), so that function is left
-- alone rather than churned.
ALTER TABLE settings DROP COLUMN IF EXISTS tax_inclusive;

NOTIFY pgrst, 'reload schema';
