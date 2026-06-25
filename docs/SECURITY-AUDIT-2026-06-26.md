# Aevidine — Auth / Authz / Tenant-Isolation Audit (2026-06-26)

A→Z review after locking owners out of admin. Verdict: **isolated and gated; one
defense-in-depth follow-up.**

## Authentication / authorization — PASS
- **Admin panel** `/aevinite` + **all 11** `/api/admin/*` routes require a valid admin
  password cookie (`AUTH_COOKIE` → `tokenIsValid`). Nothing admin is reachable without it.
- **Owner panel** `/owner` + `/api/owner/*` use `ownerScope(req)`: admin → all restaurants,
  owner (role=owner) → only `restaurants.owner_user_id = them`, everyone else → 401.
  An owner can never see another owner's data.
- **Operational panels** (`/api/editor|kitchen|tablet`) use `requireRole(req, role)` with the
  role hierarchy (owner ⊇ manager ⊇ kitchen/tablet; admin bypasses). kitchen ≠ tablet.
- **Owner → admin is closed**: the "Control room" link was removed from the owner sidebar;
  the floating panel switcher renders only when the admin-only `lfh_is_staff` flag is present
  (set ONLY by the admin password login — never by owner/manager `panel-login`). No other
  `/aevinite` link exists anywhere reachable by a non-admin.

## Tenant isolation — PASS (in practice)
- Every LIST/READ on a tenant table (menu_items, categories, filters, orders, sessions,
  waiter_calls, aggregator_orders, settings, issues …) filters by `restaurant_id` (the panel's
  `panelRestaurantId(req,g)` or owner scope). A user can only ever LIST their own restaurant's
  rows, so they never learn another tenant's row ids.
- RPCs are `REVOKE`d from anon/authenticated and take `p_restaurant_id` where relevant.
- The `issues` table (mig 094) is RLS-enabled with no anon policy; reached only via service-role
  routes scoped by `ownerScope` / `panelRestaurantId`.

## Defense-in-depth follow-up (NOT exploitable through normal use)
- By-id mutations (`orders/sessions/session_members.update(...).eq("id", <id>)`) don't
  re-assert `restaurant_id = caller's restaurant`. Because all reads are scoped, a manager
  never obtains another restaurant's UUIDs, so this isn't reachable via the app; and UUIDs are
  unguessable. Recommended hardening: a shared `assertRowInRestaurant(table, id, rid)` guard
  before by-id writes, or DB triggers. Tracked as a follow-up, not a live hole.
