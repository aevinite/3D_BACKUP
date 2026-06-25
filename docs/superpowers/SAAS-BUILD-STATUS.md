# SaaS Multi-Tenant Build — Live Status

**Branch:** `worktree-feat+saas-multitenant` (isolated git worktree under `.claude/worktrees/`).
**Live site / `main`:** untouched. Nothing here is deployed yet. Final step is applying the
vetted migrations to the live Supabase **with the owner watching** — not before.

**Design plan:** `docs/SAAS-ARCHITECTURE-PLAN.html` (visual). **Rules/playbook:** `CLAUDE.md` →
"SaaS multi-tenant build" section. **Phase 0 detail:** `docs/superpowers/plans/2026-06-25-phase0-tenancy-core.md`.

---

## Progress

| Phase | What | Status | Migrations |
|------|------|--------|-----------|
| 0 | Tenancy core — `restaurants` table + `restaurant_id` on all 23 tables (default #1) | ✅ committed | 078 |
| 1a | Per-restaurant uniqueness (keys) + counters (KOT/bill/invoice) | ✅ committed | 079, 080 |
| 1b | Scope staff functions + remaining unique indexes | ✅ committed | 081, 082 |
| 1b | Scope guest table/phone/slug RPCs (param) | ✅ committed | 083 |
| 1b | Scope guest token/order RPCs (derive) | ✅ committed | 084 |
| 1c | Scope RPC settings reads per restaurant | ✅ committed | 085 |
| 1c | Realtime breadcrumbs carry restaurant_id (`lfh_rt_emit` + platform) | ✅ committed | 086 |
| — | **DATABASE LAYER COMPLETE** (078–086, all validated on local PG, live untouched) | ✅ | 078–086 |
| 1d | App side: `/r/<slug>` routing + thread `restaurant_id` through menu/features/settings/realtime + panels + API handlers | ⬜ todo (needs app-testable DB) | — |
| 1e | Seed a 2nd demo restaurant + full app end-to-end test | ⬜ todo (needs app-testable DB) | — |
| 2 | Per-restaurant feature flags + white-label theme + fix toggle staleness/merge dup toggle UIs | ⬜ todo | — |
| 3 | Roles & permissions: owner role, owner-set manager powers, re-lock panels, scope `staff_users.username` per restaurant | ⬜ todo | — |
| 4 | Owner panel (5th panel) — staff mgmt, manager powers, all-restaurants profit view (see competitor-dashboards research) | ⬜ todo | — |
| 5 | Admin super-panel — Owners tab, restaurant search, per-restaurant feature entitlements | ⬜ todo | — |

---

## How to validate (offline, no cloud)

A throwaway local Postgres 17 replays every migration. From the worktree root:

```sh
PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH" node scripts/local-db-validate.mjs   # expect: PASS (N migrations)
```

Cluster: data dir under `…/scratchpad/lfh-localpg`, port **55432**, db `lfh_dev`, superuser `lfh_super`.
Details + bootstrap stubs: `scripts/LOCAL-DB-NOTES.md`. (psql:
`/opt/homebrew/opt/postgresql@17/bin/psql -U lfh_super -p 55432 -d lfh_dev`.)

---

## Invariants held on every change (don't break these)

- **Non-breaking for restaurant #1:** every `restaurant_id` defaults to
  `00000000-0000-0000-0000-000000000001`; single-restaurant behaviour is unchanged.
- **Guest RPCs stay `anon`-granted.** When a signature changes, DROP + re-CREATE + re-GRANT to the
  ORIGINAL grantees (anon for guest, service_role for staff). Never lock guests out.
- **Validate every migration on local PG before committing**; add a behavioural two-restaurant test
  for anything tenant-sensitive (proven so far: independent KOT/invoice; separated floor/kitchen;
  two open "table 1"s; orders stamped with the right restaurant).
- **Reproduce each function's latest body verbatim**, add only scoping; keep SECURITY DEFINER +
  search_path + return type.

## Known deferrals (tracked, not forgotten)

- `staff_users.username` unique index left **global** → scope to `(restaurant_id, lower(username))`
  in **Phase 3**, together with making the staff login lookup restaurant-aware.
- 3 functions read `settings WHERE id='site'` but have no per-call restaurant context, so they're
  left for later (documented in 085): `lfh_request_verification` / `lfh_check_verification`
  (dormant backend-only verification feature, default OFF) and `lfh_prune_logs` (global retention
  cron — needs a per-restaurant loop, a redesign).
- App-side settings/menu reads (`lib/menu.ts` `getSettings`/`getMenuItems`, `useFeatures`) still
  read globally → scope by the URL-resolved restaurant_id in **Phase 1d** (app routing).
- App end-to-end testing needs a **PostgREST-backed DB** (a free cloud dev Supabase, or local
  Supabase via Docker). Owner to provide/authorize when convenient; not blocking the DB layer.
