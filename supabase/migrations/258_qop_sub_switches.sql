-- 258_qop_sub_switches.sql — the two halves of ⚡ QO/P, switchable on their own.
--
-- WHY (owner, 2026-08-02): QO/P sends an order to one of two places — a table, or out as a
-- parcel — and he wants each of those to be its own sub-switch under the QO/P row in Access
-- & permissions, so a restaurant can be given one, the other, or both.
--
-- What each combination does (the screen says the same thing in plain words):
--   both on   → the destination step offers the Parcel bar AND every table.
--   tables on, parcel off → tables only; no Parcel bar, no Parcel tiles under the floor.
--   parcel on, tables off → Parcel only; the order can't be sent to a table from here.
--   both off  → there is nothing left for the button to do, so the button itself is gone
--               and the floor header keeps only KOT.
--
-- Both default TRUE: QO/P replaced a button that already did parcels, and it must also do
-- what ＋ Take order does, so an upgrade takes nothing away. These sit UNDER the existing
-- permissions, never over them — a restaurant without "Take a new order" gets no tables
-- however this column is set, and the same for Platforms and parcels.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS qop_tables_allowed BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS qop_parcel_allowed BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.settings.qop_tables_allowed IS
  'May the QO/P screen send an order to a TABLE? Sub-switch of qop_allowed (owner, 2026-08-02). Still requires the take_orders permission.';
COMMENT ON COLUMN public.settings.qop_parcel_allowed IS
  'May the QO/P screen send an order out as a PARCEL? Sub-switch of qop_allowed (owner, 2026-08-02). Still requires the parcel/takeaway module.';
