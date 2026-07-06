-- 133_owner_entitlements.sql — the ADMIN → OWNER rung of the access ladder
-- (owner, 2026-07-06: "complete all the ladder — admin can manage everything").
--
-- restaurants.owner_entitlements is a JSONB map of entitlement-key → boolean the
-- ADMIN controls per restaurant. It decides which parts of the OWNER panel even
-- EXIST for that restaurant, and which manager-power toggles the owner may grant:
--
--   Sections (owner-panel nav):  "reports" | "staff" | "issues"
--   Power availability:          "power_manage_staff" | "power_edit_menu" |
--                                "power_give_discounts" | "power_view_dashboard" |
--                                "power_void_bills"
--
-- Resolution rule (single source of truth, lib/ownerEntitlements.ts):
--   entitled(key) = owner_entitlements[key] !== false   -- ABSENT means ON
-- so every existing restaurant keeps exactly today's behaviour (all on).
--
-- A power entitlement OFF beats the owner's grant: the manager's effective power is
--   effective(flag) = entitled("power_"+flag) AND manager_permissions[flag] === true
-- (enforced in managerCan(), app/api/editor). The owner's Staff & powers page hides
-- an unentitled toggle from the real owner and shows it tinted to the admin — the
-- same hidden-below / tinted-above rule as the hierarchy X-ray (PR #140).
--
-- LIVE-SAFE: additive column with a default; existing rows read '{}' = all-on.
-- Same JSONB-not-columns pattern as manager_permissions (091) and
-- staff_users.permissions (115) so future keys need no further migration.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS owner_entitlements jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
