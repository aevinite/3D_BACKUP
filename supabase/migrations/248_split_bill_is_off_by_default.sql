-- 248 — Splitting a bill is a SETTING, and it starts OFF (owner, 2026-08-01)
--
-- "IN KOT OPTION SPLIT A BILL SHOULD BE ON THE LAST OR IN SETTING BILL SECTION IS SHOULD HAVE
--  TOGGLE TO TURN IT ON AND OFF SPLIT AND KEEP IT OFF AS DEFAULT"
--
-- Splitting one table's bill into several payments is a real feature, but most of his restaurants
-- never do it, and it sat in the middle of the KOT operations list where it is one mis-tap away
-- from a half-settled table. So it becomes a per-restaurant switch in the manager's
-- Settings → Bill section, DEFAULT FALSE: existing restaurants get it off too, on purpose —
-- nobody loses money to a feature they never asked for, and any restaurant that wants it turns
-- it on in one tap.
--
-- Nothing about an ISSUED bill changes: this only decides whether the split UI is offered. The
-- server-side split RPCs are untouched, and a restaurant that switches it on mid-service keeps
-- every split it has already taken (they are payment rows, not settings).

ALTER TABLE settings ADD COLUMN IF NOT EXISTS split_bill_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN settings.split_bill_enabled IS
  'Offer "Split the bill" (several payment legs on one table) in the staff panels. Default false — '
  'owner 2026-08-01: off unless a restaurant asks for it. Does not affect bills already split.';
