-- 379_a_guest_number_written_the_international_way.sql
--
-- A GUEST NUMBER WRITTEN "0091 98765 43210" IS THE SAME GUEST (owner, 2026-09-07).
--
-- WHAT WAS WRONG. lfh_phone10() knew four ways an Indian mobile number arrives:
--
--     9876543210        ten digits, the national number
--     919876543210      twelve, the country code with no prefix
--     09876543210       eleven, the trunk prefix
--     0919876543210     thirteen, both
--
-- It did not know the FIFTH, which is the one printed on business cards and pasted out of
-- contact apps: 00 91 followed by the ten digits, fourteen in all. That number was stored as
-- "00919876543210" — a distinct row from the same person's "9876543210" — so the guest was a
-- new customer every time they were written down that way, their visit count restarted, and
-- the "✓ Returning customer" line never appeared for them.
--
-- WHY THIS IS ONE MIGRATION AND NOT A ONE-LINE CLIENT FIX. `public/panels/billcustomer.js`
-- says in as many words that its norm() "mirrors lfh_phone10() in migration 227 so the client
-- and the database agree", and that a constant here and a constant there drifting is "silent
-- and expensive". Teaching the browser a fifth shape the database did not know would have made
-- the sheet find a guest the database then failed to match. Both sides move together or
-- neither does. The client half is `phone10()` in public/panels/billdoc.js, which billcustomer's
-- norm() now delegates to — one definition for the panels and the server both.
--
-- SAFE TO RE-RUN. CREATE OR REPLACE only; no data is rewritten by this file. Rows already
-- stored under a fourteen-digit key are folded in below, and THAT part is wrapped in
-- lfh_already_applied so a re-seed cannot run it twice.

CREATE OR REPLACE FUNCTION lfh_phone10(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH d AS (SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') AS x)
  SELECT CASE
           WHEN length(x) = 10                          THEN x
           WHEN length(x) = 12 AND left(x, 2) = '91'    THEN right(x, 10)
           WHEN length(x) = 11 AND left(x, 1) = '0'     THEN right(x, 10)
           WHEN length(x) = 13 AND left(x, 3) = '091'   THEN right(x, 10)
           -- NEW (mig 379): the international form, "00 91 …" — fourteen digits.
           WHEN length(x) = 14 AND left(x, 4) = '0091'  THEN right(x, 10)
           ELSE NULLIF(x, '')
         END
    FROM d;
$$;
GRANT EXECUTE ON FUNCTION lfh_phone10(text) TO service_role;

-- ── The guests already split in two by this ────────────────────────────────────────────────
-- A customer row keyed on fourteen digits is the same person as the ten-digit row beside it.
-- Where BOTH exist for one restaurant, the visits are added onto the ten-digit row and the
-- fourteen-digit row is removed; where only the fourteen-digit row exists, it is re-keyed.
-- Nothing is deleted that is not first merged, and the whole block runs at most once.
DO $$
BEGIN
  IF lfh_already_applied('379_fold_0091_customer_rows') THEN
    RAISE NOTICE 'mig 379: the 0091 fold has already run — skipping';
    RETURN;
  END IF;

  -- 1. BOTH rows exist for one restaurant → the stray's visits are added to the real row, the
  --    earliest first-seen and the latest last-seen are kept, and a name is only taken from the
  --    stray when the real row has none. Nothing a person typed is overwritten.
  UPDATE customers c
     SET visits        = c.visits + s.visits,
         first_seen_at = LEAST(c.first_seen_at, s.first_seen_at),
         last_seen_at  = GREATEST(c.last_seen_at, s.last_seen_at),
         name          = COALESCE(NULLIF(c.name, ''), s.name),
         blocked       = c.blocked OR s.blocked
    FROM customers s
   WHERE s.restaurant_id = c.restaurant_id
     AND length(s.phone) = 14 AND left(s.phone, 4) = '0091'
     AND c.phone = right(s.phone, 10);

  -- …and only then is the stray removed. Merge first, delete second — never the other way round.
  DELETE FROM customers s
   USING customers c
   WHERE s.restaurant_id = c.restaurant_id
     AND length(s.phone) = 14 AND left(s.phone, 4) = '0091'
     AND c.phone = right(s.phone, 10);

  -- 2. only the stray exists → it simply becomes the real one. No row is lost either way.
  UPDATE customers
     SET phone = right(phone, 10)
   WHERE length(phone) = 14 AND left(phone, 4) = '0091';

  -- The ledger is written the way migration 307 established: a row in lfh_applied_once, not a
  -- helper (there is no lfh_mark_applied — a first draft of this file invented one).
  INSERT INTO lfh_applied_once (key, note) VALUES
    ('379_fold_0091_customer_rows',
     'folds customer rows keyed on the 14-digit 0091 form onto their 10-digit selves. A second run is harmless once the rows are gone, but the visit-count addition must never be repeated.')
  ON CONFLICT (key) DO NOTHING;
END $$;

-- A bill already ISSUED keeps whatever number was typed on it: sessions.cust_phone is a record of
-- what happened, and this project does not edit records. The printed bill reads it through
-- phone10() in public/panels/billdoc.js, so an old fourteen-digit value now PRINTS as "98765 43210"
-- without the stored row being touched.

NOTIFY pgrst, 'reload schema';
