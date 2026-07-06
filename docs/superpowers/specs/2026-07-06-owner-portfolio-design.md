# Owner portfolio redesign — one owner, 1..N restaurants (2026-07-06)

Owner-approved 2026-07-06 ("direct merge, don't show me"). Mockup reviewed in Chrome:
`scratchpad/owner-portfolio-mockup.html` (session scratchpad).

## Goal

1. **Owner panel auto-arranges by restaurant count** and ALWAYS shows the full list
   of owned restaurants on every page.
2. **Admin gets a real Owners section** (`/aevinite/owners`, currently a ComingSoon
   stub): create an owner once, attach/detach 1..N restaurants, reset password,
   suspend/restore, act-as view.
3. **Fix the single-restaurant-era leftovers** that break real multi/tenant owners.

## Current state (explored 2026-07-06)

- DB already M:N: `restaurant_owners(restaurant_id,user_id)` (mig 097) + legacy
  primary `restaurants.owner_user_id` (mig 092). `ownerScope()` (lib/ownerScope.ts)
  resolves an owner cookie → owned ids. All `/api/owner/*` routes scope by it.
- Owner dashboard (`app/owner/page.tsx`) is already adaptive 1 / 2 / 3+.
- Admin owner CRUD is buried in the Restaurants tab (`OwnerCard` in
  `app/aevinite/restaurants/page.tsx`); `/aevinite/owners` is a stub.
- Leftovers: owner rows pinned to `restaurant_id = #1` →
  (a) owner can't log in at `/r/<their-slug>/login` (loginUser filters by rid),
  (b) `requireRole`/`panel-login` check the OWNER panel toggle against #1,
  (c) `ownerScope` act-as widening still reads `owner_user_id` not the join table.

## Design

### Owner panel
- **Sidebar "My restaurants" block** (OwnerShell, all pages, only when N>1): color
  dot + name + today's revenue per restaurant, count badge, "view all N" beyond 6.
  Data: the existing pre-aggregated `/api/owner/overview` (one small call, reused
  by the dashboard; shell fetch is cached per navigation, no new polling).
- **Dashboard tiers by N** (extends the existing 1/2/3+ pattern):
  - 1 → today's single-restaurant dashboard, no portfolio chrome; POLISH pass
    (owner asked "more better for owner 1"): plain-words insight strip, records
    row surfaced, tighter hierarchy.
  - 2 → head-to-head (existing) + VS metric table.
  - 3–4 → portfolio KPI strip + rich cards (sparkline) + leaderboard + multi-line
    trend (existing 3+ mode, kept).
  - 5–9 → compact cards (no sparkline), leaderboard/trend cap at top 5.
  - ≥10 → **HQ mode**: aggregate strip + ONE sortable/searchable table (revenue +
    inline bar, Δ vs yesterday, orders, open tables, alerts, open→). No cards.
- Thresholds live in one place (`app/owner/page.tsx` const), not scattered.

### Admin › Owners (`/aevinite/owners` + new `/api/admin/owners`)
- GET: owners (`role='owner'`) + their restaurants via `restaurant_owners`,
  last_seen, active, + restaurants-without-owner warning list.
- POST `create_owner` (name, username, auto password shown once, restaurant ids)
  — reuses the existing create path semantics from `/api/admin/restaurants`.
- PATCH: `attach`/`detach` restaurant (syncs `owner_user_id` primary when needed),
  `reset_password`, `suspend`/`restore`.
- UI: owner cards (avatar initials, @username, count, restaurant chips with ×,
  attach-chip, actions row), "New owner" drawer, KPI strip, no-owner warning.
- Existing per-restaurant OwnerCard in the Restaurants tab stays (kept in sync —
  both write `restaurant_owners`).

### Backend fixes (no schema change needed)
- `loginUser` (lib/userAuth.ts): when a tenant slug is given, also match owners
  who OWN that restaurant (via `restaurant_owners`), not just rows with that rid.
- Owner panel-enabled checks: evaluate against owned restaurants (any enabled),
  not the #1 home row.
- `ownerScope` act-as: widen via `restaurant_owners`, fall back to
  `owner_user_id`.
- Owner usernames stay in the #1 namespace (global uniqueness for owners is fine
  — they log in at the bare door); NO migration.

## Non-goals
- No new realtime channels, no poll faster than 60s, all reads stay
  pre-aggregated + scoped (egress rules).
- No owner-side feature toggles; feature flags stay admin-only.
- No subdomain work.

## Definition of done
- Lint/typecheck pass; owner dashboard verified at N=1 and N>1 (act-as), admin
  Owners page verified live; tenant-door owner login works; PR → main.
