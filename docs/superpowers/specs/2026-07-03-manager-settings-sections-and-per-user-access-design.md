# Manager Settings: sidebar sections + per-user access — design

Date: 2026-07-03 · Owner request (voice): "settings should be organized… below Site settings there
should be User setting, Table setting… and an Access setting where you toggle what a particular
user can do (e.g. mark as paid / not paid) — user/permissions."

## Problem

The manager panel's Settings tab is ONE long "General settings" scroll (10 cards) behind a single
sidebar entry ("Site settings · general"). Hard to find anything. And tablet capabilities
(discount / mark-paid / invoice) are restaurant-wide tri-states — the owner wants them grantable
PER USER.

## A. Settings sections (reorganization, no behaviour change)

Sidebar (the existing `.list-item` pattern) lists sections; the right pane renders only the active
section's cards. New state: `state.settingsSection` (default `"general"`).

| id | Sidebar label | Cards (all existing, just regrouped) |
|----|---------------|--------------------------------------|
| `general` | General · site basics | Service mode, Bubble effect |
| `tables` | Tables · floor & seats | Number of tables, Table setting (seats), Auto close/restart |
| `users` | Users · staff logins | User setting card (staff team) |
| `access` | Access · user permissions | Defaults-for-everyone (the 3 tri-states, moved from "Tablet panel access") + NEW per-user override list |
| `billing` | Billing · invoice & print | Billing & invoice, Auto-print KOT (entitlement-gated as today) |
| `sessions` | Dining sessions | Sessions toggles + OTP + location/geo fields |

- Page title follows the section ("Access settings", "Table settings", …).
- Save button stays global (settings are one row; unchanged fields unaffected).
- No new overlays → nothing to register with the back-stack manager.

## B. Per-user access (new feature)

### Data
Migration 116: `ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL
DEFAULT '{}'::jsonb;` Keys (v1): `tablet_discount`, `tablet_mark_paid`, `tablet_invoice` (same keys
as the restaurant tri-states, so resolution is a simple fallback). Values: `"on" | "pin" | "off"`.
Absent key = inherit restaurant default. JSONB so future capabilities need no migration (mirrors
`restaurants.manager_permissions`).

### Resolution rule (single source of truth)
`effective(key, user) = user.permissions[key] ?? settings[key] ?? "off"` →
`off` blocked · `pin` manager-PIN gate · `on` allowed.

### Enforcement (backend-first)
`app/api/tablet/[...path]/route.ts` → `tabletPerm(key, req, body, rid)` gains the logged-in user
(already available from `gate()`): fetch `staff_users.permissions` for that user id (single tiny
select, only on money actions — egress-negligible), apply the resolution rule, keep the existing
admin bypass and PIN flow. Buttons on the tablet client follow the RESOLVED values (served wherever
the tri-states are served to the tablet today), but the server gate is the real guard.

### Editing API
`/api/owner/staff` PATCH gains `action: "set_permissions"` `{ id, permissions: {key: value|null} }`
— null/absent deletes the key (back to Default). Validated against the known key list + value set.
Scope: identical to the rest of staff management (admin / owner / manager with `manage_staff`).
Oplog the change.

### Manager-panel UI (Access section)
- Card "Defaults for everyone": the existing three tri-selects (unchanged bindings).
- Card "Per-user overrides": one row per active TABLET-role user (from the already-loaded staff
  list — no new fetch): name + role chip + three small selects, options
  `Default (currently On/PIN/Off) · On · On — needs PIN · Off`. Change → PATCH set_permissions →
  toast + refresh staff list. Kitchen/manager users are hidden in v1 (these three caps only bite on
  the tablet panel).
- Respects the existing `staffDenied` state (manager without `manage_staff` sees the same denial
  message as the Users section).

## Non-goals (v1)
- No per-user overrides for kitchen/manager capabilities (owner-panel `manager_permissions` already
  covers manager powers).
- Owner-panel Staff & powers page does NOT get the per-user grid yet — follow-up if wanted.
- No admin entitlement toggle: this is core staff management (already permission-scoped), not a
  guest-facing module.

## New-feature checklist (CLAUDE.md)
1–2. Admin entitlement: n/a (core staff mgmt, not a toggleable guest module).
3. Least-privilege: edit rights = owner / manager-with-manage_staff; server enforces.
4. Backend-first: resolution + gate live in the tablet API; UI is a convenience.
5. Panels: manager Settings (UI), tablet (behaviour). Owner panel: follow-up.
6. Off = render nothing: denied managers see the denial card, no dead UI.
7. UI: existing panel design system (.card, tri-select, list-item sidebar).
8. Back-stack: no new overlays.
9. Egress-safe: no new polls; staff list reused; one tiny per-action select on enforcement.

## Testing
- Unit-ish: resolution rule via API behaviour (override beats default; absent falls back).
- E2E: per-user Off → tablet button hidden AND direct API call 403s; per-user On while default Off
  → allowed; Default row shows resolved value; section nav renders each group; save still works.
- Verify in Chrome at desktop + ~390px (settings sidebar collapses like other tabs).
