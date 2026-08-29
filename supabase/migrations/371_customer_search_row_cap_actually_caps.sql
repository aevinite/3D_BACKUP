-- 371_customer_search_row_cap_actually_caps.sql
-- RENUMBERED 365 → 371 (T28, sweep #7, 2026-08-29; 370 was taken by another lane while this
-- branch was rebasing, which is the whole reason the guard that catches this exists). Two files were both numbered 365 —
-- this one and 365_reopen_puts_the_table_back_not_the_bill.sql — and `npm run verify:db-parity`
-- was red on clean main for it. This is the NEWER of the two (2026-08-28 against 2026-08-26),
-- so this is the one that moves; the rule is that the file which got there first keeps its
-- number. Safe to move later: the two touch DIFFERENT objects (lfh_customer_phone_search here,
-- lfh_reopen_table there), so their order never decided anything, and nothing between 365 and
-- 371 touches lfh_customer_phone_search — the previous edit to it was migration 227.
--
-- THE ROW CAP ON THE TILL'S CUSTOMER SEARCH DID NOTHING (T8, sweep #7, owner 2026-08-28).
--
-- `lfh_customer_phone_search` (migration 227) ended:
--
--     SELECT COALESCE(json_agg(...), '[]'::json)
--       FROM customers c, q
--      WHERE ...
--      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 20));
--
-- In SQL a LIMIT is applied AFTER aggregation, and `json_agg` has already collapsed the whole
-- match set into ONE row by then — so the LIMIT capped that single row and the array inside it was
-- unbounded. Measured on the dev database before this migration: asking for **1** returned **5**,
-- and asking for 6 returned 5 (i.e. everything that matched, whatever was asked for).
--
-- WHY IT MATTERS: this fires while a waiter is typing, at the till, on the busiest path in the
-- app. On a restaurant with a large customer book a four-digit prefix would pull down EVERY
-- matching customer — and the sheet then renders only the first four of them. The route, the
-- panel's own comment and this function's own header all promised "at most 6 rows"; none of them
-- was true.
--
-- THE FIX: pick the rows first, cap THEM, and aggregate the capped set. Same arguments, same
-- shape of answer, same ordering (most recently seen first) — the array is simply now the length
-- it was always documented to be. `ORDER BY` moves inside the row-picking step, where it belongs;
-- ordering an aggregate and then limiting it was the other half of the confusion.
--
-- The index this leans on already exists: `idx_customers_phone_prefix` (migration 227) plus the
-- primary key (restaurant_id, phone). With the cap now real, the database stops building a JSON
-- array it was only going to throw away.

CREATE OR REPLACE FUNCTION lfh_customer_phone_search(
  p_restaurant_id uuid,
  p_prefix        text,
  p_limit         integer DEFAULT 6
)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- a partial number is searched as typed (digits only); a COMPLETE one is normalised
  -- first, so "+91 98250 12345" finds the row stored as "9825012345".
  WITH q AS (SELECT COALESCE(lfh_phone10(p_prefix),
                             NULLIF(regexp_replace(COALESCE(p_prefix,''), '[^0-9]', '', 'g'), '')) AS pfx),
  hits AS (
    SELECT c.phone, c.name, c.visits, c.blocked
      FROM customers c, q
     WHERE q.pfx IS NOT NULL
       AND length(q.pfx) >= 3
       AND c.restaurant_id = p_restaurant_id
       AND c.phone LIKE q.pfx || '%'
     ORDER BY c.last_seen_at DESC
     -- the cap, where it can actually cap: on the ROWS, before they become one JSON value
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 6), 20))
  )
  SELECT COALESCE(json_agg(json_build_object(
           'phone', phone, 'name', name, 'visits', visits, 'blocked', blocked)), '[]'::json)
    FROM hits;
$$;

-- A new function is PUBLIC-executable by default in Postgres (the migration 038/267 lesson), and
-- CREATE OR REPLACE does not carry the old grants across on a signature change, so they are
-- restated here. This search reads other people's phone numbers: service role only, exactly as
-- migration 227 set it.
REVOKE ALL ON FUNCTION lfh_customer_phone_search(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lfh_customer_phone_search(uuid, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
