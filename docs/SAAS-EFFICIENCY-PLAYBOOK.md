# SaaS efficiency & safety playbook

Hard-won lessons from the 2026-06-26 egress incident + the follow-up audits. This is the
"how we keep this SaaS cheap, fast, and safe as it grows" reference. The short version lives
in `CLAUDE.md` (NEW-FEATURE CHECKLIST item 9) and in the global `~/.claude/CLAUDE.md`.

> ⚠️ **THREE LATER LESSONS ARE NOT IN THIS FILE YET (noted 2026-08-04).** CLAUDE.md points here
> as "the full pattern", so a feature written by this document alone gets the June rules and not
> the ones learned by taking the database down twice since. Read these three in CLAUDE.md before
> building a data feature:
>
> 1. **Analytics go through the compute-on-view snapshot cache** — `lib/ownerCache.ts`
>    (`cachedOwnerPayload`) + `owner_analytics_cache` (mig 196). This is the DEFAULT for any
>    dashboard/report number, not an optimisation to add later.
> 2. **A change-detector may never scan the table it guards.** `lfh_owner_orders_fingerprint`
>    cost **21,591 ms and ~2.9 GB** of page reads — 2.7x the 8s statement ceiling, so the
>    dashboard burned the CPU and then FAILED. Mig 246 replaced it with a trigger-maintained
>    watermark: **5 ms, 157 buffers**. If a guard costs more than the query it protects, it is
>    not a guard.
> 3. **The floor is read once and shared** — `lib/floorSummary.ts` (a ~1.5s window) plus mig 238.
>    Every write handler must call `invalidateFloor(rid)`, a `?table=N` refetch is NEVER shared,
>    and the window stays ~1.5s. Guarded by `npm run verify:floor`.

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
- **If you put a CACHE in front of the read, clear it with `{ expire: 0 }`** — see §3a.

### 3a. A cache in front of a breadcrumb is where cross-panel updates die

Everything above makes the *write* announce itself. None of it helps if the *read* is answered from
a cache that has not been told. This is its own failure mode and it cost a full round to find
(PR #824 / migration 299), so it belongs in the checklist and not only in three code comments.

**The rule: `revalidateTag(tag, { expire: 0 })`, never `revalidateTag(tag, "max")`.**

`"max"` is the stale-while-revalidate profile: it serves **one more stale read** and refreshes
behind it. On a menu edit that is exactly the read the next panel makes, so a manager changes a
price, the guest menu (or the kitchen board) answers from the old copy once, and it looks as though
the breadcrumb never fired. `{ expire: 0 }` drops it outright.

Live call sites, all three deliberately identical — copy one when you add a fourth:

| where | why it clears |
|---|---|
| `app/api/editor/[...path]/route.ts` (`bustMenuCache`) | a manager edits a dish |
| `app/api/kitchen/[...path]/route.ts` | the kitchen marks something sold out |
| `app/api/admin/restaurants/access-tree/route.ts` | the admin changes what a restaurant may show |

Two more things that are easy to get wrong here:
- **The edge cache is NOT purged by `revalidateTag`** — `app/api/r/[restaurant]/menu-data/route.ts`
  carries the note; an owner edit needs its own cache-busting on that path.
- **`unstable_cache` / `revalidateTag` only intercept reads that run ON THE SERVER**
  (`lib/menuDataServer.ts`). A client-side fetch is not in that cache and does not need clearing —
  and will not be fixed by clearing it either.

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
  migrated ~093. **RESOLVED 2026-06-26:** confirmed via `pg_indexes` that `idx_orders_created_at`
  + `idx_orders_restaurant_created` (mig 095) ARE live in prod → the windowed analytics RPCs
  are index-covered. Only the all-time `orders_all`/`revenue_all` aggregate in `lfh_owner_overview`
  still scans (can't be range-indexed). **YAGNI per CLAUDE.md** at current scale; revisit with a
  pre-aggregated summary table when order volume actually demands it (Stage-3).

### Medium — ALL RESOLVED 2026-06-26
- [x] **Kitchen + tablet targeted refetch** — now refetch only the changed table(s) like the
  manager; verified live (single change → ?table=N only; shift → both tables). (PR #50)
- [x] **Composite indexes** `(restaurant_id, created_at)` on staff_actions/waiter_calls +
  `(restaurant_id, status)` on aggregator_orders. (mig 098, applied live, PR #48)
- [x] **Guest-side realtime leaks** — RealtimeProvider + AppShell now idle-disconnect like
  useRealtime.ts. (PR #48)
- [x] **autoSettle multi-tenant bug** — now derives restaurant_id from the session's orders and
  reads that restaurant's settings (was always #1). (PR #48)

### Still open (lower priority)
- [ ] **Unbounded reads:** `.limit()` on the `blocklist` reads (admin custlog / editor route).
- [ ] **N+1:** batch the allergen per-item UPDATE loop (editor route ~505-511); cap the
  userAuth candidate loop. (manager-PIN loop is now restaurant-scoped, so much smaller.)
- [ ] Trim `orders.select("*")` (editor `/orders`) to rendered columns; `s-maxage` on menu reads.
- [ ] **Full RLS/secrets sweep** — the dedicated security-audit agent was blocked by a tooling
  safeguard; do it by hand. (The concrete bugs it would target — cross-tenant manager-PIN — were
  found + fixed; a systematic per-table RLS review is still owed.)

### Done (2026-06-26)
- [x] Targeted per-table refetch on the manager (PR #45) + kitchen + tablet (PR #50).
- [x] Wake-on-return for admin/owner auto-refresh; 60s cadence.
- [x] Shift breadcrumb covers both tables + invoice-void breadcrumb + pollTables dedup (PR #46, mig 096).
- [x] Restaurant name on every panel header + admin activity log.
- [x] Idle-disconnect on staff panels + admin + guest menu + guest RealtimeProvider/AppShell; pooled connection (no direct clients).
- [x] **Multiple owners per restaurant** via restaurant_owners join table (PR #48, mig 097); isolation verified live.
- [x] **Cross-tenant manager-PIN hole** fixed — PIN check scoped to the tablet's restaurant (PR #48).
- [x] **Guest AppShell** reads its own restaurant's settings, not #1's (PR #49).

## Do NOT reach for infrastructure (owner rule, restated 2026-08-05)

Every rule above is a way to make a read cheap. When one is still slow, the temptation is to buy
capacity instead, and the answer is no until the numbers say otherwise:

- **Redis, job queues and read replicas are Stage-3 (50–300+ restaurants). Do not add them early**
  — that is CLAUDE.md's rule, and this file is where people come looking for permission.
- **Order volume is not the risk.** 100 genuinely simultaneous orders land in ~2s on the free tier
  and the rest of the site never wobbles (measured, `npm run load:ramp`). What saturates the
  instance is a handful of unbounded analytics reads landing together — so the fix is always
  further up this page, not a bigger machine. Full numbers: `docs/PROJECT-HISTORY.md` §2.
- **Measure before and after, on the real database.** A set-based rewrite of the floor query was
  rejected by measurement once already (`docs/PROJECT-HISTORY.md` §1); "it should be faster" is not
  evidence. And if a read is already ~10–30ms, the remaining cause is CONTENTION, so making the
  query faster again achieves nothing.
