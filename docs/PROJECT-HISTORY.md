# Project history — why the rules in CLAUDE.md exist

`CLAUDE.md` is loaded into **every session, before the owner types a word**, so it costs tokens
on every single request of every session. It therefore holds **rules only**: the short, imperative
form of what to do.

This file holds the **stories, measurements and incident write-ups** that produced those rules.
Nothing here was deleted from the project's memory — it was moved out of the always-loaded path so
it costs nothing until someone actually needs it.

**Read a section here when you are about to change the thing it describes** (and `CLAUDE.md` will
point you at it). Do not read this file "to get context" at the start of a session — that defeats
the entire purpose of the split.

---

## 1. The floor summary — one rewrite rejected, one accepted (2026-07-31)

**Rule now in CLAUDE.md:** the floor is read once and shared; every write drops the snapshot;
`?table=N` is never shared; the window stays ~1.5s; use `verify-summary-parity.mjs` before
touching `lfh_table_view_summary`.

`lfh_table_view_summary` USED TO run ~6 queries per table (~1,800 statements on a 300-table
floor). Alone that was ~300ms; the fault was CONCURRENCY — every manager/waiter device polls the
WHOLE floor as its 60s backstop, and a dozen landing together queued and crossed the statement
timeout (134 error rows in 12h, and pings on the owner's phone).

**Both levers are pulled and they are complementary** — sharing cuts the NUMBER of calls, mig 238
cuts the COST of each. Read this so neither gets undone:

- A first set-based rewrite was tried and **rejected by measurement**: byte-identical output,
  5× faster at 4 concurrent reads, **2× slower at 12**, because it computed one big aggregate
  per call where many small queries interleave better. That rejection was correct *for that
  implementation*.
- **Migration 238 is a different rewrite and was measured the same way, harder.** It keeps the
  per-table wording ladder and the small aggregates, adds one set-based data pass, deletes a
  floor-wide `count(*) FILTER` that walked EVERY order the restaurant ever took (~42k rows a
  call), and stops accumulating tiles with `v_tiles := v_tiles || one_tile` (quadratic copying,
  106ms at 300 tables). It does **not** show the collapse that got the first attempt rejected —
  on one 300-table floor, whole-floor reads fired together: **12 at once 4.6× faster, 24 at
  once 7.1×, 36 at once 7.6×, 48 at once 8.0×** (it improves with load, it does not degrade).
  Single call went 169/386/**1675**ms → 11/16/**29**ms (min/avg/worst of 7).
- **The one-line count fix alone is NOT the win** — measured at only ~1.1× under load. Do not
  "simplify" mig 238 back to a loop on the theory that the count was the whole problem.
- Why sharing is safe: each of its three properties is easy to break with **no symptom in any
  other test**. A missing `invalidateFloor(rid)` means a device that changes something and
  reloads is handed a floor computed BEFORE its own action — a waiter marks a table paid and
  watches the tile flick back.

## 2. A rush must slow the app down, never take it down (2026-08-01)

**Rules now in CLAUDE.md:** a change-detector may never scan the table it guards; "server busy"
takes the offline path (5xx/timeout = save it, 4xx = tell the person); every write has a deadline
and jittered backoff; nothing polls fast while its reads fail.

The owner's question after the 2026-07-31 outage was the right one: *"hammering should not have
done this — what if my restaurant has 800 simultaneous orders?"* Measured on the backup database
(399,617 orders, free-tier shared vCPU, PostgREST's 8s statement ceiling):

- **An order is cheap: ~64-138 ms** (`lfh_staff_place_order` / `lfh_place_order`). 800 orders
  spread over even five minutes is ~2.7/s — a few percent of one core. **Orders were never the
  problem.**
- **What saturates the instance is a handful of EXPENSIVE reads landing together.** The worst was
  the snapshot cache's own "cheap" change-detector: `lfh_owner_orders_fingerprint` scanned all
  orders — **21,591 ms and ~2.9 GB of page reads** for an all-time window. That is 2.7× the 8s
  ceiling, so a dashboard couldn't even finish: it burned 8 full seconds of the shared CPU and
  then FAILED, and a person's retry burned 8 more. **Mig 246** replaced it with a
  trigger-maintained watermark (`orders_change_watermark`, one row per restaurant per business
  day): **21,591 ms → 5 ms, 370,451 buffers → 157**, proven still to notice a change and still to
  respect the window.
- Detail behind rule 3: `doFetch` had NO timeout, so an overloaded server (which answers *nothing*
  for 30-90s) left a waiter's tap on a spinner forever — not applied, not saved. A FIXED retry beat
  means every device retries in lockstep, which is a retry storm.
- Detail behind rule 4: the kitchen's catch-up poll ran every 5s whenever realtime wasn't
  connected — and a saturated database is exactly what drops realtime, so every device switched to
  a 5s board read at the same moment and kept the database down.
- **Two concurrent 501-phase runs are what actually took the database down** — the test rig, not
  the product. Hence the pid lock on `verify:everything`.

### The ceiling is MEASURED, not guessed — and it is not order volume

`npm run load:ramp` (`scripts/load-ramp-orders.mjs`) fires real staff orders at the deployed
backup site, one distinct table each, ramping and stopping at the first sign of trouble:

| at once | placed | wall time | p50 / p95 | `/api/health` during the burst |
|---|---|---|---|---|
| 10 | 10/10 | 6.6s (cold) → 1.5s warm | 1.4s / 1.5s | 200, worst 392ms |
| 25 | 25/25 | 2.2s | 2.0s / 2.2s | 200 |
| 50 | 50/50 | 2.2s | 1.6s / 1.7s | 200 |
| **100** | **100/100** | **2.1s** | **1.7s / 2.1s** | **200, worst 207ms** |

**100 genuinely simultaneous orders land in about two seconds on the FREE tier, and the rest of
the site never wobbles.** So the fear that a busy restaurant collapses the app was aimed at the
wrong thing: order volume is not the risk, a handful of unbounded analytics scans is. Don't spend
money on compute to "handle the rush" without measuring first — re-run this ramp instead.

Two rules for the ramp itself, both learned the hard way in its first run:
- **It must not become the outage it measures.** It refuses to point anywhere but the backup
  database, refuses to start while another heavy run holds a lock, makes ZERO logins (the admin
  gate cookie, so no `staff_login` limit event and no ping to the owner's phone), uses the staff
  order path (no rate-limit rule; `guest_order` is 8/table/min and would alert), and samples
  `/api/health` throughout — the question is whether the OTHER screens kept working.
- **Test rows are put back by CLOSING the session, never by deleting.** The first version tried to
  delete and the database refused: an order gets a bill number on insert, so it is an ISSUED bill
  and `lfh_block_issued_delete` blocks a hard delete (the CGST rule we built in — it was right to
  stop me). It reported "removed 0" and left 185 rows on the floor. Closing lets the mig-232
  trigger cancel the unpaid work with a visible ✕ and archive the rest: tables free, audit trail
  intact, nothing erased. **Any future load/test script cleans up the same way.**

⚠️ Still true: it is a free-tier shared-CPU instance with 60 connections, and these changes add no
capacity — they mean a burst QUEUES and drains instead of collapsing. But the measured order
ceiling is far above anything a single restaurant does, so the honest reason to buy compute would
be many restaurants at once, not one busy night.

## 3. Our own tests were pinging the owner's phone (2026-07-29 / 07-30)

**Rules now in CLAUDE.md:** sign in once per session; use `loginAs()` / `adminHeaders()`; never
POST JSON to `/api/staff-login`; a test that trips a wall cleans up its own rows in the same run;
never widen or hide a limit.

The "limit reached" alerts exist for REAL trouble in a real restaurant. Our OWN sessions were
setting them off, and noise is how a real alert gets ignored:

- The "open it in Chrome so the owner can look" scripts (`view-device.mjs`, `sweep/login.mjs`, any
  `show-*.mjs`) signed in AGAIN for every browser context / role / restaurant. Two sessions doing
  that seconds apart put six `diagm1` logins inside five minutes and pinged the owner's phone
  about himself. `loginAs()` now CACHES the session — proven: 1 login row for 5 contexts, all with
  a working session.
- **JSON to `/api/staff-login` sends an EMPTY password** (the route reads FORM data). Three
  "checks" became three wrong-password attempts and raised an `admin_login` limit event about the
  owner's own panel. `adminHeaders()` makes zero requests ever.
- Deleting test users does NOT clear `rate_limit_events` / `rate_limit_counters` /
  `login_throttle`, and an OPEN event sits in the admin's Problems list looking like a real
  restaurant in trouble.

## 4. A tap that vanished closed the wrong table (2026-07-30, PR #554)

**Rules now in CLAUDE.md:** never `return` on a user action without a trace; never leave a promise
unresolved; stamp `data-closing`; branch on a reason CODE, never on server prose.

This cost a real close on a live client's floor. The manager's confirm box ignores clicks for its
first 350ms (so the tail of a double-tap can't answer a question nobody read), and "Close anyway"
is a CHAINED dialog — it appears only when the server's refusal lands, so it pops up under a
finger already tapping, in the same spot. A normal tap 200–300ms later was dropped with nothing on
screen; the owner closed two tables and the third "didn't work".

The tablet's shared `#confirmOverlay` had the sibling bug: handlers got reassigned, orphaning the
earlier `await` forever, so that action died mid-flight. And the old `/owes money/` text-match
missed the cooking-only refusal, so a paid-but-unserved table had no "close anyway" button at all.

## 5. A free table showed a nine-day-old party (2026-07-30, mig 232)

**Rules now in CLAUDE.md:** ownership is the SESSION, never the table number; an order can never
outlive its session.

The owner tapped **Open** on a FREE table and it appeared instantly as *"Preparing · 0/5 served ·
₹1,150 due"* with three KOTs — food ordered nine days earlier by a party whose session was long
closed. "Mark all paid" / "Generate invoice" would have billed the new guests for it.
`lfh_table_view_summary` always matched by session; the panels' `ordersForTable` (manager) /
`ordersOf` (waiter) did not, which is why the tile flip-flopped between "Preparing" and "Open ·
waiting for guests".

## 6. Two faults reached the screen while every check passed (2026-07-30)

**Rules now in CLAUDE.md:** `verify:ui` in the hook, `verify:live` after every deploy, never derive
a claim from data that doesn't support it, AV-live verification is read-only.

1. A `<script>` tag was inserted INSIDE an HTML comment. The comment ended early, so the manager's
   top bar displayed *"…the pill was inserted at the far LEFT of the topbar. -->"* to every user.
2. An orange *"Connection is struggling"* bar sat directly above the panel's own green *"Live"*
   badge. Nothing was broken; the UI contradicted itself, from ONE slow read.

The root cause of BOTH: **the work was verified with checks that could not have caught the
failure** — the wrong surface (offline-only tests), the wrong artefact (source instead of the
served file), or the wrong signal (skimming output instead of an exit code). Both are now
reproduced as tests inside `verify:ui`.

## 7. A ten-terminal sweep audited 105-commit-old code (2026-08-04)

**Rules now in CLAUDE.md:** `npm run check:current` before you audit, plan or claim a bug; syncing
a shared folder is not `git pull`; work in a worktree if you can't sync.

Every terminal was reading code 105 commits old (folder at PR #705, `origin/main` at #762). Whole
features were missing from disk — `lib/panelFailure.ts` and the busy-database read fallback did
not exist there — so the sweep reported gaps that had been fixed days earlier, and "passes" that
were passing on dead code. It cost a full sweep. **A stale folder does not announce itself:
nothing is red, the app runs, the findings just aren't about the real product.**

On the same day, 15 of 16 uncommitted files collided with the incoming commits — pulling would
have forced conflict resolution in code the syncing session did not write. And between PR #758 and
#762, four of that sweep's own findings were fixed by another session: **a worktree is only as
fresh as the moment you made it.**

## 8. The Vercel free daily deploy cap (2026-08-01)

**Rule now in CLAUDE.md:** "backup-1 first" means MERGED, not deployed; if capped, deploy backup-2
so the owner has a live site, then backup-1 when the window frees.

Backup-1's Vercel is on the free plan (~100 deploys/day) and a busy day of parallel sessions
genuinely exhausts it — 142 deploys in 24h, of which **76 were PR previews nobody opens**. When it
caps, `POST /v13/deployments` answers 402 `api-deployments-free-per-day` and a merged fix simply
cannot go out. Do not fix the cap by hammering it. The waste is real and worth fixing properly
(54% of the quota is PR previews); the owner has been shown the options and it is his call.

**Backup-2's database:** a separate Supabase project (`jhhqzexl…`) whose management token is
expired (401) — use `psql` instead: `db.jhhqzexlpzzwoqnzrgje.supabase.co`, user `postgres`,
password in `backup_Menu_2/.env.local`. On 2026-08-01 a schema diff showed **zero** missing tables
and **zero** missing functions — it was already in step. Note a PostgREST **404 on an RPC means
"no function with THAT ARGUMENT SIGNATURE"**, not "missing" — calling one with an empty body will
fool you, as it fooled me.

## 9. The SaaS multi-tenant pivot (approved 2026-06-25, since built)

**Rules now in CLAUDE.md:** pooled connection, RLS at the DB level, index every filtered column,
realtime keyed per restaurant, scoped queries, additive schema changes, pre-aggregated dashboards,
one tenant resolver.

Full visual plan: `docs/SAAS-ARCHITECTURE-PLAN.html`. The agreed build order was `0` Tenancy core
(keystone) → `1` Guest tenant resolution → `2` Per-restaurant features + white-label → `3` Roles &
permissions → `4` Owner panel → `5` Admin super-panel. Redis / job queues / read replicas were
deliberately deferred to Stage 3 (50–300+ restaurants) as YAGNI.

**Routing — path now, subdomains later.** `/r/<slug>/t/<table>` today. The resolver is written so
it can ALSO read a subdomain (`<slug>.app.com`) or a restaurant's own custom domain later — keep
that abstraction so the switch is a config/DNS flip, not a rewrite. The switch happens ONLY on the
owner's explicit go (expected trigger: the first paying restaurant wanting a branded link, or just
before public launch): add a wildcard domain + wildcard TLS on Vercel, point the resolver at the
Host header, keep path-based as fallback.

## 10. The access & permissions rebuild (2026-07-31)

**Rules now in CLAUDE.md:** a toggle exists only where the owner listed one; only the admin holds
permissions; no greyed-out ghosts; `docs/ACCESS-MODEL.md` is canonical.

The old model was a 4-rung ladder (`admin → owner → manager → tablet`) with the owner granting
manager powers, specified in `docs/ACCESS-LADDER.md`. It had **54 sub-checkboxes of which 45 were
read by no code** — a switch that looks granted and isn't. `docs/ACCESS-LADDER.md` is HISTORY only;
the logic is retired.

## 11. Deferred optimisation — realtime DELTA instead of a slice refetch (owner, 2026-07-02)

Owner-approved to revisit later, NOT yet built. Opening a table detail already paints instantly
from the slim summary (stale-while-revalidate — `tablePanelParts` streaming branch / tablet
`renderPanel`), so FIRST-open feels instant. But a LIVE update to a detail that's already open (a
new order/dish landing) still waits on a full per-table slice refetch (`?table=N` →
sessions+orders+calls+items ≈ 1–1.5s on the tablet).

Idea: instead of refetching the whole slice on every breadcrumb, apply the realtime DELTA in place
— the `rt_emit` breadcrumb already names the table + change, so patch just the changed row into
`state.data.orders`/`items` and re-render. That's the Linear/Figma "apply the delta, don't
refetch" model — near-zero egress, near-zero latency. Only build if the owner still notices the lag
after the instant-open win. Keep the 60s full-slice poll underneath as the safety net either way.

## 12. Miscellaneous background

- **The four separate servers became one app (2026-06-13).** The editor/kitchen/tablet UIs are the
  original vanilla files in `public/panels/<name>/`; their old Express APIs were ported to Next
  route handlers. The old standalone `editor/ kitchen/ tablet/ admin/` folders + the separate
  editor repo were DELETED — preserved in `reference/` and the `pre-rewrite-reference` git tag.
- **Categories & filters are DB-driven, not hardcoded.** `categories` (slug, `name` JSONB of
  6-lang translations, icon FA-class, color, sort_order, active) and `filters` (slug, `name` JSONB,
  icon emoji, sort_order, active). Each dish's `tags TEXT[]` lists the filter slugs it matches
  (seeded from the `veg` flag, which still exists for the VegIcon). `app/menu/page.tsx` builds the
  bar and chips from these, prepending a virtual "All". Labels use `localized(name, lang)` +
  `useLanguage()` in `lib/i18n.ts` (falls back to `en`, then any value). New categories/filters
  should get their other languages auto-translated at editor-save time, not by hand.
- **KOT / bills depth (migs 036–038).** Every order gets a daily `kot_no`, every session a daily
  `bill_no` (triggers + `daily_counters`); `get_order_status` returns `kot_no`. `orders.discount`
  (+note) is stored APART from totals; every due/total view is net of discounts.
  `lfh_staff_shift_table` moves a party atomically. `feedback`: one rating per order via anon
  `lfh_leave_feedback`; the guest UI is the star row on past bills in the cart.
- **The blur build gotcha cost a long debugging round:** hand-adding `-webkit-backdrop-filter` next
  to `backdrop-filter` makes the Tailwind-4 / Lightning-CSS build DROP the property entirely and
  the blur silently vanishes.
- **The `boardSig` narrowing bug (fixed 2026-06-17):** a hand-picked field list meant edits to an
  omitted field (a new allergy/note/discount) silently failed to auto-refresh and only showed on a
  MANUAL refresh.
- **Egress hit the quota 2026-06-26 and 96.6% was whole-board PostgREST reads.** Two specific bugs
  behind the breadcrumb rules: invoice-void columns weren't in a column-scoped trigger's watch-list
  (a silent missed instant update, mig 096 fixed it), and merging by `table_number` instead of row
  id shipped a dup-tile bug because the number changes on a shift.
- **The owner analytics RPCs once full-scanned `orders` and took ~147s under load** (stress test
  2026-06-26) — that is why every filtered column needs a covering index.
- **~41 realtime "users" with almost no real traffic** were stale open tabs holding channels
  forever — that is why every subscriber drops its channel when hidden/idle and re-subscribes on
  focus.
