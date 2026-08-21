# SaaS efficiency & safety playbook

Hard-won lessons from the 2026-06-26 egress incident + the follow-up audits. This is the
"how we keep this SaaS cheap, fast, and safe as it grows" reference. The short version lives
in `CLAUDE.md` (NEW-FEATURE CHECKLIST item 9) and in the global `~/.claude/CLAUDE.md`.

---

## 0. The three rules learned AFTER the June incident — read these first

These were a "not in this file yet" banner from 2026-08-04 to 2026-08-21, which meant a feature
written from this document alone got the June rules and none of the ones learned by taking the
database down twice since. They are part of the playbook now.

1. **Analytics go through the compute-on-view snapshot cache.** `lib/ownerCache.ts`
   (`cachedOwnerPayload`) + `owner_analytics_cache` (mig 196), fingerprint-gated; Refresh forces
   live. This is the DEFAULT for any dashboard or report number — not an optimisation to add later,
   and never a blind cron. **Bump the cache key when a number changes MEANING**, not only when the
   data changes: the fingerprint watches rows, so a redefinition served stale figures that looked
   fine.
2. **A change-detector may never scan the table it guards.** `lfh_owner_orders_fingerprint` cost
   **21,591 ms and ~2.9 GB** of page reads — 2.7× the 8s statement ceiling, so the dashboard burned
   the CPU and then FAILED. Mig 246 replaced it with a trigger-maintained watermark: **5 ms, 157
   buffers**. If a guard costs more than the query it protects, it is not a guard. The same
   migration is why **a busy server is treated exactly like being offline** (5xx/timeout ⇒ queue,
   4xx ⇒ tell the person), with a deadline and jittered backoff on every write and no fixed fast
   poll while reads are failing. `npm run verify:busy`.
3. **The floor is read once and shared.** `lib/floorSummary.ts` (a ~1.5s window) plus mig 238.
   Every write handler must call `invalidateFloor(rid)`, a `?table=N` refetch is NEVER shared, and
   the window stays ~1.5s (measured — do not "simplify" it back). Guarded by
   `npm run verify:floor`. ⚠️ AV live does not have mig 238; it needs its own ask.

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

> **The list to work from is `docs/SECURITY-CHECKLIST.md`** — the owner's own 20 points plus the
> eight this app actually needs, with a place to log each run. It did not exist when the paragraph
> below was written, and "do it by hand" without saying *from what* is why nobody did.
>
> Wording first, every time: describe each item in product-correctness language ("does each
> restaurant only see its own numbers?"), verify by READING the code and watching normal signed-in
> use, and never by trickery. `CLAUDE.md` → "AVOID THE CYBER-SAFEGUARD HALT" is the full rule, and
> it is the reason an earlier attempt at this review was killed mid-run rather than finished.

---

## 5. Remaining work (prioritized — from the 2026-06-26 audits)

### High — BOTH RESOLVED (do not re-do them)

- [x] **`lfh_owner_overview` no longer full-scans all orders.** This was the real ~147s freeze
  (mig 088). Since **mig 190** its history pass reads the pre-aggregated `orders_daily_agg` rollup
  rather than raw `orders` — which is exactly the "pre-aggregated per-restaurant summary" this line
  asked for — and **mig 266** made the two remaining CTEs (`hist`, `rates`) honour the caller's
  `p_ids`, so one owner opening their dashboard stopped re-aggregating the whole platform's rollup
  and computing a tax rate for every restaurant on the table. The endpoint is polled every 60s by
  every open owner tab and shared for 8s by `lib/ownerOverviewCache.ts` on top of that. Checked
  again on 2026-08-21: still the rollup, still scoped.
- [x] **Analytics indexes are live** — `idx_orders_created_at` + `idx_orders_restaurant_created`
  (mig 095) confirmed via `pg_indexes` on 2026-06-26, so the windowed analytics RPCs are
  index-covered. The all-time `orders_all` / `revenue_all` aggregate cannot be range-indexed and is
  **YAGNI per CLAUDE.md** at this scale; it now reads the rollup, so there is nothing owed here.

### Medium — ALL RESOLVED 2026-06-26
- [x] **Kitchen + tablet targeted refetch** — now refetch only the changed table(s) like the
  manager; verified live (single change → ?table=N only; shift → both tables). (PR #50)
- [x] **Composite indexes** `(restaurant_id, created_at)` on staff_actions/waiter_calls +
  `(restaurant_id, status)` on aggregator_orders. (mig 098, applied live, PR #48)
- [x] **Guest-side realtime leaks** — RealtimeProvider + AppShell now idle-disconnect like
  useRealtime.ts. (PR #48)
- [x] **autoSettle multi-tenant bug** — now derives restaurant_id from the session's orders and
  reads that restaurant's settings (was always #1). (PR #48)

### Still open (lower priority) — re-checked against the code on 2026-08-21

- [x] **Unbounded `blocklist` reads — done.** Both now cap and name their columns: the admin
  custlog read takes `.limit(200)`, and the editor route's read takes an explicit column list plus
  `.limit(500)`.
- [x] **Cap the userAuth candidate loop — done 2026-08-21.** `loginUser` fetches at most
  `MAX_LOGIN_CANDIDATES` (50) rows for one typed name and says so in the logs if it ever reaches
  that ceiling. Every live match costs one PBKDF2 verify at 120,000 iterations, so this was CPU per
  login attempt as well as egress.
- [ ] **N+1: batch the allergen per-item UPDATE loop.** Still one `order_items` UPDATE per item,
  inside a `for` loop — `app/api/editor/[...path]/route.ts` around line **3440** (the old "~505-511"
  in this file pointed at nothing after the route grew). The manager-PIN loop beside it is
  restaurant-scoped now, so it is much smaller.
- [ ] **Trim `orders.select("*")` (editor `/orders`) to rendered columns.** Still `select(billsMode
  ? BILLS_COLS : "*")` — the Bills view already names its columns; the floor/board view does not.
  Plus `s-maxage` on the menu reads.
- [ ] **Full RLS/secrets sweep** — work from `docs/SECURITY-CHECKLIST.md` (§4 above), in
  product-correctness wording, inline and never in a sub-agent. The concrete bugs it would have
  targeted (the cross-restaurant manager-PIN scope) were found and fixed; a systematic per-table
  read-policy review is still owed. Note the related trap already learned twice: **a read policy
  with no matching GRANT does nothing**, and narrowing a grant without matching the code is how a
  guest config read broke.

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
