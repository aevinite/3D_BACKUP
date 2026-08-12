# Spec — Phase 1: Auth, Users & Roles (+ editor→manager rename)

Date: 2026-06-14 · Status: for owner review

## Goal
Give the three staff panels real per-user logins with roles, managed by the
admin, replacing today's single shared `STAFF_PASSWORD` (and the fact that
editor/kitchen/tablet are currently wide open). The guest **menu stays open**.

This spec is **Phase 1 only**. Out of scope (separate cycles): the manager
"Control" panel that governs tablet capabilities (Phase 2); the PIN-gated money
actions, discount-before-tax, same-brain tablet floor, and remaining hardening
(Phase 3); the bills table / full bill logic (owner will provide later).

## Roles
Every login user has exactly one role, stored in the DB:
- **manager** — the panel formerly called "editor"; full control.
- **tablet** — waiter/captain: floor, take orders, serve, pay, shift, close.
- **kitchen** — minimal: tickets + sold-out board.
- **admin** — NOT a panel user; it's the existing master gate (super-admin across
  restaurants). Admin can open any panel without a panel login.

## Data model
New table `staff_users`:
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| username | text | login id, set by admin; stored lowercased, UNIQUE index on lower(username) (no citext extension needed) |
| password_hash | text | sha256hex(password) — reuses lib/staffAuth helper |
| role | text check in (manager,tablet,kitchen) | |
| pin_hash | text null | self-set by the user in their profile; used by Phase 3 money gates |
| name | text null | blank until captured on first login |
| phone | text null | blank until captured on first login |
| active | boolean default true | admin can disable without deleting |
| created_at | timestamptz default now() | |
| last_seen_at | timestamptz null | updated on login |

RLS: enabled, **no anon/authenticated policy** (service-role only — the API reads
it). Never exposed to the guest anon key. Password/PIN hashes never leave the
server.

## Routing (how each person is directed)
One app, one set of URLs:
- `/menu` — guest, always open, no login.
- `/login` — the SINGLE staff door (username + password). On success, redirect by
  role: manager→`/manager`, tablet→`/tablet`, kitchen→`/kitchen`.
- Visiting `/login` (or `/`) while already logged in → redirect straight to the
  user's role panel (no re-typing).
- Visiting any panel without a valid cookie → redirect to `/login?next=<panel>`.
- Admin (you) logs into `/admin` and reaches every panel + the Users page.
- No separate/secret per-role URLs — the role on the user row decides the landing
  panel.

## Auth flow
- **Login page** `/login` (username + password). Posts to `POST /api/panel-login`:
  server (service-role) looks up the active user, verifies `sha256hex(password)`
  against `password_hash` (constant-time compare), and on success sets a
  role-scoped cookie `lfh_user` = `"<userId>.<sha256hex(userId + ':' + role + ':' + STAFF_PASSWORD)>"`
  (tamper-checked server-side; STAFF_PASSWORD is the server secret). Stamps
  `last_seen_at`. `/api/panel-logout` clears it.
- **Gate (re-introduced `middleware.ts`)** protects `/manager`, `/kitchen`,
  `/tablet` and `/api/manager/*`, `/api/kitchen/*`, `/api/tablet/*`:
  - Valid **admin** cookie (existing `lfh_staff_auth`) → allowed into ANY panel
    (super-admin bypass).
  - Else a valid `lfh_user` cookie whose **role matches the panel** → allowed.
  - Else redirect (pages) / 401 (APIs) to `/login?next=<path>`.
  Menu and guest APIs are untouched.
- **Admin super-access:** logged into `/admin`, the panel switcher links open
  any panel directly (the admin cookie satisfies the gate). Hitting a panel URL
  directly without admin → needs that panel's user login.
- **First-login capture:** after a successful panel login, if the user's `name`
  OR `phone` is null, the panel shows a one-time blocking step "Tell us your name
  and phone" → `POST /api/panel-profile {name, phone}` writes them to the user
  row. Cannot use the panel until filled (so the operation log always has a real
  person behind the device).

## Profile (each panel)
A small profile control (top bar / switcher menu): shows who you are (name +
role), **Log out**, and **Set / change PIN** (`POST /api/panel-profile {pin}` →
stores `pin_hash`). The PIN is self-chosen and distinct from the login password;
it is *stored* now and *used* in Phase 3 to authorize money actions (revert bill,
void, large discount, force-close). The PIN is never required just to use the
panel — only for those sensitive actions later.

## Admin "Users" section (new)
A new top-level page in `/admin`: a table of users (name, username, role chip,
active, last seen) with:
- **Add user** — username + temp password + role (name/phone left for first login).
- **Edit** — change role, name/phone, re-/set password, reset PIN.
- **Disable / Enable** (active flag) and **Delete**.
All via `/api/admin/users` (admin-gated, service-role). Passwords are hashed
server-side; the admin never sees an existing password (only sets a new one).

## editor → manager rename
- Folder `public/panels/editor/` → `public/panels/manager/`; route `app/editor/`
  → `app/manager/`; API `app/api/editor/[...path]` → `app/api/manager/[...path]`.
- The vanilla app's internal fetches (`/api/editor` → `/api/manager`) and the
  AdminSwitcher label/links updated.
- **Back-compat:** `/editor` 308-redirects to `/manager`, and `/api/editor/*`
  re-exports the manager handler, so any cached link / bookmark keeps working.

## Security notes
- Reuse `lib/staffAuth.ts` `sha256hex` (Web Crypto) for password + PIN hashing
  and a constant-time compare helper (replaces the current `===`).
- The `lfh_user` cookie is HttpOnly, SameSite=Lax, ~7-day max-age; tamper-checked
  via the HMAC-style suffix. (A signed JWT is a future hardening, noted not done.)
- This closes the current "panels open on the internet" exposure for everyone
  except the menu.

## Migration / rollout
- Migration `053_staff_users.sql`: create `staff_users` (+ RLS), seed nothing
  (admin creates users). Until at least one user of a role exists, that panel can
  still be reached by the **admin** (super-access), so the owner is never locked
  out. Optionally seed one manager user from an env var for first boot.
- No guest-facing change. The editor→manager rename keeps redirects so nothing
  404s.

## Testing / acceptance
- Admin creates a manager/kitchen/tablet user → each can log into only their
  panel; wrong-role login is refused.
- Direct `/manager` `/kitchen` `/tablet` without a cookie → redirect to `/login`;
  `/api/*` without auth → 401 (closes the open-API hole).
- Admin logged in → opens all panels with no re-login.
- First login → name/phone capture appears once, then never again; the operation
  log shows the user.
- Profile → set PIN persists (hash stored); log out clears the cookie.
- `/editor` and `/api/editor/*` still work (redirect / alias).
- Type-check + production build pass; verified in the browser.

## First-boot (decided)
**No seeded account.** The owner logs into `/admin` (existing gate) and creates the
first manager/kitchen/tablet users from the new Users page. Admin super-access
reaches every panel, so the owner is never locked out while no users exist yet.
