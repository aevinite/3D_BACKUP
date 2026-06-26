# SaaS efficiency & safety playbook

Hard-won lessons from the 2026-06-26 egress incident + the follow-up audits. This is the
"how we keep this SaaS cheap, fast, and safe as it grows" reference. The short version lives
in `CLAUDE.md` (NEW-FEATURE CHECKLIST item 9) and in the global `~/.claude/CLAUDE.md`.

---

## 1. What happened (so we never repeat it)

Supabase egress blew past the 5 GB free quota. The dashboard breakdown (Org → Usage →
Egress per day, hover a bar) showed **96.6% PostgREST** (database REST reads), only 3.4%
realtime. **It was NOT the 3D models / storage** — verify the breakdown before blaming.

Root cause: every realtime "something changed" breadcrumb made each open staff panel
re-read the WHOLE board — ALL orders + ALL sessions + ALL calls — even when one table
changed. ~240 KB/event × every open panel × thousands of events during testing.

**Diagnosis method (reuse this):** read the actual egress breakdown first; measure real
payload sizes (`fetch` in the browser, check `.length`); don't guess. We wasted time
guessing "missing index" and "3D models" before measuring.

---

## 2. The targeted-refetch pattern (the fix, and the model for all live data)

Instead of refetching everything on a change, refetch **only what changed**:

1. The realtime breadcrumb row (`realtime_events`) carries `table_number` + `kind`.
2. `public/panels/realtime.js` accumulates the changed tables during its debounce window
   and hands the handler `{ full, tables[] }`.
3. The manager's `ops` handler calls `pollTables(tables)` → fetches only `?table=N` slices
   of `/orders`,`/calls`,`/sessions` → **merges** them into the in-memory board.
4. `reconcileBoard()` (shared with the full poll) runs the identical chimes/redraw, so no
   alert is ever lost.

**Three things that MUST hold (each one bit us — see migration 096):**
- **Full-reload fallback** whenever a change can't be scoped to one table: no
  `table_number`, or `kind=platform`. Worst case = one wasted full read, never a wrong floor.
- **A change that spans two tables must breadcrumb BOTH.** A table SHIFT moves a party
  A→B; the breadcrumb must nudge `ops` for A *and* B, or the moved party shows on both tiles
  until the backstop. (mig 096 added the old-table `ops` breadcrumb.)
- **Column-scoped triggers must watch every rendered column.** `rt_emit_sessions` watched
  `status, cart, …, invoice_no` but NOT `invoice_voided` — so voiding a bill fired no
  breadcrumb and the unlock lagged 60s. (mig 096 added the void columns.) **Defense:**
  `pollTables` dedups orders + board rows by row id, so a duplicate can never render.
- **The 60s full poll stays as the backstop** in every panel. Any missed targeted update
  self-heals within 60s — a permanently-wrong screen is impossible.

Measured result: `/orders` 162 KB → 16.6 KB, `/sessions` 75 KB → 1.3 KB per event (~92%),
far more in normal use (a real table has 1–3 orders, not the stress test's 19).

---

## 3. The future-proofing rule (every NEW feature)

A new feature may **never** reintroduce a whole-board read. Before merging confirm ALL:
- **Scoped read:** `.eq("restaurant_id", rid)` + explicit column list (no `.select("*")` on
  a hot/polled path) + `.limit()`. No read-all-then-filter-in-JS.
- **Targeted breadcrumb:** new live table → `rt_emit` trigger carrying `table_number` when
  scopable (NULL when not → safe full reload). Column-scoped trigger → watch every rendered column.
- **Per-table fetch + merge** dedup'd by **row id** (never table_number alone).
- **No poll faster than 60s;** realtime per restaurant; channels drop on hidden/idle.
- **Verify in the Network tab** that one change refetches ONLY that table.

---

## 4. Security: what actually protects a SaaS (and what's theater)

"Make it so people can't inspect the site" is a **myth** — anything the browser runs is
readable; blocking devtools only annoys real users. Real protection:
- **Never trust the client.** Enforce every rule server-side: Row-Level Security on every
  tenant table + server-side role checks in API routes (not just hidden UI).
- **No secrets in the browser.** Only the anon key + project URL may be `NEXT_PUBLIC_*`.
  Service-role key / access tokens / passwords stay server-only.
- **Lock down RPC grants:** new Postgres functions are PUBLIC-executable by default —
  staff/admin RPCs need `REVOKE … FROM PUBLIC, anon, authenticated` + `GRANT … TO service_role`
  (the migration-038 pattern).
- **Rate-limit** public endpoints; re-lock the open staff panels before public launch.

> A dedicated security audit was attempted but a tooling safeguard blocked the agent
> (false positive on "security audit" framing). The RLS/secrets/grants review should be
> redone by hand — it is legitimate defensive work on our own code.

---

## 5. Remaining work (prioritized — from the 2026-06-26 audits)

### High
- [ ] **`lfh_owner_overview` full-scans ALL orders (all-time, no window) on every owner
  dashboard load** — the real ~147s freeze. Fix: pre-aggregated per-restaurant summary
  (trigger/rollup), or drop the all-time totals from the default cockpit. (mig 088)
- [ ] **Verify analytics indexes are LIVE in prod** (`select * from pg_indexes where
  tablename='orders'`). Migrations 094/095 add `idx_orders_restaurant_created`; prod was
  migrated ~093 — apply if missing, or the windowed analytics RPCs still full-scan.
- [ ] **Kitchen + tablet still reload the whole board on every event** (now the biggest
  live-egress source post-PR#45). Cheap interim first: tighten `select(...)` + add `.limit()`
  in `lib/liveBoard.ts` (lines 32, 45). Then make them targeted like the manager (kitchen
  first — smaller; tablet's `/state` returns 9 joined collections, higher merge risk).

### Medium
- [ ] **Composite indexes:** `(restaurant_id, created_at DESC)` on `staff_actions` and
  `waiter_calls`; `(restaurant_id, status)` on `aggregator_orders`. The auto single-column
  `(restaurant_id)` index (mig 078) doesn't cover the filter+sort hot paths.
- [ ] **Guest-side realtime leaks (the "41 phantom connections"):** `components/RealtimeProvider.tsx`
  and `components/AppShell.tsx` open channels that only close on unmount, never on hidden/idle.
  Route both through the same idle-disconnect manager as `lib/useRealtime.ts`.
- [ ] **Unbounded reads:** add `.limit()` to the `blocklist` reads (`app/api/admin/custlog`,
  editor route) and the tablet `/state` collections.
- [ ] **N+1:** batch the allergen per-item UPDATE loop (editor route ~505-511); cap the
  manager-PIN / userAuth candidate loops.
- [ ] **Multi-tenant correctness bug (not egress):** `lib/autoSettle.ts:18` reads
  `settings.eq("id","site")` instead of `.eq("restaurant_id", rid)` — auto-settle uses
  restaurant #1's setting for every tenant. Fix separately.

### Low
- [ ] Trim `orders.select("*")` (editor `/orders`, ~159 KB) to the columns actually rendered.
- [ ] Add short `s-maxage` cache headers to cacheable menu/categories/filters reads.
- [ ] Sentry: 10% traces + `enableLogs` + `sendDefaultPii` — review at scale.

### Done (2026-06-26)
- [x] Targeted per-table refetch on the manager (PR #45).
- [x] Wake-on-return for admin/owner auto-refresh; 60s cadence.
- [x] Shift breadcrumb covers both tables + invoice-void breadcrumb + pollTables dedup (PR #46, mig 096).
- [x] Restaurant name on every panel header + admin activity log.
- [x] Idle-disconnect on the staff panels + admin + guest menu + pooled connection (confirmed airtight, no direct clients).
