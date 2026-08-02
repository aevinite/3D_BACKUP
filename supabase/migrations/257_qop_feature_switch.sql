-- 257_qop_feature_switch.sql — the admin's on/off for ⚡ QO/P (Quick order / Parcel).
--
-- WHY (owner, 2026-08-02): QO/P is the floor's quick-order screen — build an order by
-- drilling category → dish → category, then choose a table or Parcel at the end. He wants
-- it to be a switch a restaurant either HAS or doesn't, sitting in Access & permissions →
-- Main features, like Menu and Auto-print kitchen tickets.
--
-- DEFAULT TRUE, deliberately. Every other new module ships OFF, but this one REPLACES a
-- button that is already on every floor (🥡 New Parcel) — shipping it off would silently
-- take the ordering button away from every existing restaurant on upgrade. New restaurants
-- inherit the same default, which is what the owner expects a "main feature" to do.
--
-- Turning it OFF removes the button from the floor entirely; 🧾 KOT ▾ stays. It does NOT
-- touch the endpoints — ＋ Take order on a table and the waiter tablet keep their own gates
-- (take_orders / parcel), so this switch closes one door, never a capability.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS qop_allowed BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.settings.qop_allowed IS
  'Does this restaurant have the ⚡ QO/P quick-order screen on its live floor? Admin-only switch, Access → Main features (owner, 2026-08-02). Default true because it replaces the always-present New Parcel button.';
