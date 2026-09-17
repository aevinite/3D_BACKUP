# The 20-point optimisation list — answered, item by item

**Owner, 2026-09-17, STANDING:** *"whenever I tell you to optimize the thing you will do all this
stuff… I need you to compress all images, add lazy loading, split the code into chunks, cache API
responses, add a CDN, minify JS and CSS, index the database, reduce unnecessary re-renders, debounce
input handlers, paginate large lists, remove unused dependencies, defer non-critical scripts, add a
loading skeleton, add a load balancer, compress API payloads, add database connection pooling, cache
expensive computed results, fix N plus one database queries, enable server-side caching, and run a
lighthouse audit. Make no mistakes. and do it also if not done"* — then: *"and do for all panels"*.

So "optimize" is not a vague ask in this project: it is this checklist, every line answered with a
measurement, on **every panel** — guest menu · manager · kitchen · waiter tablet · owner console ·
admin console. This file is the first full run (2026-09-17). Re-run it the same way: measure first,
change second, measure again, and write down what did **not** move.

Two standing rules override any item on the list:

* **The Stage-3 rule** (`CLAUDE.md` → SaaS architecture): Redis, queues, read replicas and a real
  load balancer are deliberately NOT added early. One shared database, pool model.
* **`docs/SAAS-EFFICIENCY-PLAYBOOK.md`** for anything that touches a read.

---

## How this was measured

| Tool | What for |
|---|---|
| Playwright + Chrome DevTools Protocol, **Lighthouse's own mobile preset** (4× CPU slowdown, Slow-4G: 150 ms RTT / 1.6 Mbps) | FCP · LCP · CLS · long tasks · bytes per screen |
| `next start` on a production build | real chunk sizes, not dev-mode ones |
| `pg_stat_statements` + `pg_stat_user_tables` / `pg_stat_user_indexes` | which queries and tables actually cost something |
| `curl -I` against the deployed site | what the CDN really sends (encoding, cache headers) |

The `chrome-devtools` MCP — which has a one-press Lighthouse audit — **could not be used**: another
session on this machine held its browser profile (`The browser is already running for
…/chrome-profile`). The metrics below are the same ones that audit reports, gathered directly.

### The numbers, before anything changed

| Screen | JS downloaded | FCP | LCP | CLS | Long tasks |
|---|---|---|---|---|---|
| Guest menu (`/r/french-house/menu`) | 1,630 KB | 868 ms | **5,892 ms** | 0.095 | 2 (174 ms) |
| Manager panel (`/manager`) | **3,522 KB** (panel `app.js` 1,340 + chart library 209) | — (iframe) | — | 0.000 | 1 (109 ms) |
| Owner console (`/owner`) | 1,909 KB | 840 ms | 840 ms | **0.433** | 6 (506 ms) |

---

## 1 · Compress all images — **DONE NOW** (two real wins) ✅

**a) Every photo a person uploads is shrunk in the browser, before it is sent.**
`public/panels/shrinkimg.js` (new, loaded by **all three panels**) caps the long edge at 1280 px and
re-encodes as WebP at q0.82, honouring the phone's EXIF rotation. Used by both upload doors:

* manager/owner → **Edit menu → a dish photo** (`public/panels/editor/app.js`) — this is the picture
  **every guest downloads** when the menu opens, shown in a card ~300 px wide;
* any panel → **🚩 Report an issue → photo** (`public/panels/issue-raise.js`).

Measured in a real browser on a 4032×3024 photo: **354 KB → 31 KB (91% smaller), 1280×960, WebP**.
A real 4 MB phone photo lands at ~150–250 KB. An already-small image is returned **untouched** (no
second lossy pass), it never returns something bigger, and **any failure returns the original file**
— an upload can not fail because of this. The 4 MB server-side limit is unchanged as the backstop.

**b) The admin console's 51 help screenshots: 4.95 MB → 2.19 MB (56% smaller).**
`node scripts/shrink-help-shots.mjs` (new) writes a `.webp` twin of each capture using the browser as
the encoder — no new dependency. `components/admin/AccessTree.tsx` asks for the twin and **falls back
to the PNG once** if it is missing, so a help picture can never disappear. `scripts/shot-access-help.mjs`
now says to re-run the converter after a fresh capture.

**Where the guest menu's own dish photos already stood:** measured, they are already WebP and small
(the four heaviest on French House: 73, 73, 56, 42 KB). Nothing to do there.

## 2 · Lazy loading — **ALREADY MOSTLY THERE, GAPS CLOSED NOW** ✅

`loading="lazy"` was already on 24 images (the guest menu grid, the search suggestions, the dish
tiles in Take order). Every remaining `<img>` in the app was listed and decided one at a time:

* **now lazy:** the dish-page lightbox · the admin issue photo (list + modal) · the branding logo
  preview · the owner's expense-slip thumbnails · the order-confirm dish image · the panel issue
  photo preview · the inventory bill photos (×2).
* **deliberately NOT lazy, with the reason written at each line:** the dish page's main photo (it is
  the LCP element — it now says `loading="eager" fetchPriority="high"`), the **first three** cards of
  the guest menu grid (`loading={index < 3 ? "eager" : "lazy"}`, the first also `fetchPriority="high"`
  — lazy-loading what a guest is already looking at is how a menu comes up grey), the bill document's
  logo and the QR print sheet (**a lazy image can print blank**), the maintenance screen's logo and
  the admin header mark.

## 3 · Split the code into chunks — **DONE where it pays; measured, not assumed** ✅

* **The manager panel no longer downloads a charting library it usually never uses.**
  `chart.umd.min.js` is 209 KB and is used by exactly one screen — the Dashboard's seven graphs —
  while the panel **opens on the Tables tab**. It is now fetched the first time a graph is about to
  be drawn (`ensureChartLib()` in `public/panels/editor/app.js`), and the existing "the library
  didn't load, the numbers above still work" path is what a failure lands on.
  **Verified:** `/manager` went 3,522 KB → **3,328 KB** of JS; the library is requested **0 times**
  on boot, and opening the Dashboard draws all **7 canvases** from the on-demand load.
* Already split: the admin console's recharts screen (`next/dynamic`), every guest widget
  (`components/GuestChrome.tsx`), and Next's own per-route splitting (106 chunks).
* **NOT split, with the measurement behind it:** the owner console's recharts (384 KB). On `/owner`
  the charts **are** the screen — the library is needed on first paint, so deferring it moves the
  cost rather than removing it, and doing it properly means splitting a 1,078-line chart module that
  four screens import. Named as its own task rather than half-done on the screen he watches most.

## 4 · Cache API responses — **ALREADY DONE (four layers), verified** ✅

| Layer | Where | What it saves |
|---|---|---|
| Shared floor read, 1.5 s window | mig 238 · `invalidateFloor()` | the floor is computed once for every screen asking at the same moment — `lfh_floor_bundle` measures **30.6 ms** across 14,708 calls |
| Snapshot cache, stale-while-revalidate | `lib/ownerCache.ts` (mig 196) | the owner cockpit's expensive reports return one finished JSON row and refresh **after** the response; 2,872 rows cached, 202 recomputed today |
| Service worker data cache | `public/sw.js` → `DATA_PATHS` | every panel screen opens and reads offline |
| In-flight GET de-duplication | `api()` in each panel | boot used to fire `/summary`, `/all`, `/platform` 3–4× each (~470 KB of duplicate JSON); now one request is shared |

## 5 · Add a CDN — **ALREADY THERE** ✅

Vercel's edge network serves the app, pinned to **`bom1` (Mumbai)** in `vercel.json` — the same
region as the database, which is why a write costs ~45–60 ms per round trip instead of ~250 ms.
Cache headers are already per-asset-type (`vercel.json`): models `immutable, 1 year` · vendor 1 day ·
panel JS/CSS `max-age=300, stale-while-revalidate=86400` · images 1 day + SWR a week. GLBs and dish
photos sit on Supabase Storage, itself CDN-backed.
**The 300 s on panel JS is deliberate and stays:** a stale panel is a real hazard here — staff once
ran a weeks-old `app.js` and filed bugs for code that no longer existed (`scripts/verify-panel-cache.mjs`
tells that story). The `?v=` content hash + a short TTL is the belt-and-braces that replaced it.

## 6 · Minify JS and CSS — **DONE for the app; deliberately NOT hand-rolled for the panels** ⚠️

Next minifies everything it builds (app, owner and admin consoles). The vanilla panels are served
from `public/` verbatim, and the platform **already compresses them on the wire**: measured on the
deployed site, `editor/app.js` is 1,371 KB raw → **465 KB brotli**, `style.css` 416 KB → 124 KB.

A build step that minified the panels would save maybe 30% of the *parse* cost and would cost:
a second copy of every panel file, a rewrite of `index.html` at build time (so the file in git would
no longer be what is deployed), and a new way for "I edited `app.js` and nothing changed" to happen —
the exact failure `verify:panel-cache` exists to prevent. **Not worth it; stated rather than skipped.**

## 7 · Index the database — **ALREADY DONE; checked against the live statistics** ✅

* **248 indexes** across the public schema.
* Every tenant table with more than 100 rows has an index starting at `restaurant_id` — the single
  exception is `action_idempotency` (261 rows), which is keyed by its primary key `action_id`, the
  only way it is ever read. **An index there would never be used.**
* **No unused indexes** to drop: zero indexes over 100 KB with `idx_scan = 0`.
* Sequential scans exist on `sessions` (5,266 rows) and `order_items` (5,243) — on tables that small
  the planner chooses a scan **because it is faster**; an index cannot improve them. The big
  `orders` scans traced back to **our own audit scripts** run through the Management API
  (`pg_stat_statements` records the `-- source: POST /v1/projects/:ref/database/query` comment), not
  to app code.

## 8 · Reduce unnecessary re-renders — **DONE NOW (guest menu) + already extensive** ✅

* **Guest menu search no longer re-filters the whole menu on every keystroke.**
  `components/MenuView.tsx` had **zero** memo hooks and re-filtered + re-rendered every card per
  letter. It now uses **`useDeferredValue`** (React 19): the letter appears instantly, the expensive
  re-filter runs at lower priority and is interrupted if another letter arrives. Better than a timer
  here because it self-tunes — imperceptible on a fast phone, a real saving on a slow one.
* Already there: 218 `useMemo`/`useCallback`/`memo` uses across the consoles; the panels repaint the
  floor **tile by tile** (`patchFloorTiles`) instead of rebuilding the grid, and skip the redraw
  entirely when the board's fingerprint has not changed.

## 9 · Debounce input handlers — **ALREADY DONE except one; that one fixed** ✅

109 debounce/throttle sites across the app. The manager and tablet dish searches have waited 250 ms
since they were written. **The kitchen's 86-board search was the outlier** — it rebuilt the whole dish
list on every keystroke, on the oldest device in the building, during service. Now debounced at
120 ms. **Verified in the browser:** typing leaves the list untouched at first (59 rows) and rebuilds
once after the pause (1 row).

## 10 · Paginate large lists — **ALREADY DONE** ✅

Every list read is bounded, and the big ones are properly paged rather than capped: the floor board
pages with `.range()` (`pageBoard` in `lib/liveBoard.ts`), the risk-actor scan walks
`staff_actions` 1,000 rows at a time to a 20,000 ceiling **and returns a `truncated` flag** so the
screen can say so, bills/history are clamped to the Access window and 200 rows, id-lists are chunked
so a PostgREST URL can never overflow. `npm run verify:scoped-reads` holds the discipline (128
statements, every exemption written down).

## 11 · Remove unused dependencies — **DONE NOW** ✅

The runtime dependency list is already minimal — 8 packages, every one in use (`@sentry/nextjs` via
`next.config.ts` + `instrumentation-client.ts`, `@supabase/supabase-js`, `gsap`, `next`, `qrcode`,
`react`, `react-dom`, `recharts`). **`shadcn` was removed** from devDependencies: the CLI is BLOCKED
on Tailwind 4 by a standing rule and its MCP was deleted on 2026-09-02, so it was referenced by
nothing but `package.json`. Lockfile refreshed. `chart.js` stays — `scripts/build-vendor.mjs` pins it
to build the panel's vendor file.

## 12 · Defer non-critical scripts — **DONE NOW, all three panels** ✅

Every body script in the manager, kitchen and tablet panels now carries `defer` (22 · 15 · 18 tags).
`theme.js` in `<head>` stays blocking **on purpose**: it picks the skin before the first paint, and
deferring it would show a flash of the wrong colours on every load. There are no inline `<script>`
blocks in any panel, so execution order is unchanged.
**Verified in the browser:** all three panels boot with every shared global present
(`LFH_RT`, `LFH_OUTBOX`, `LFH_BACK`, `LFH_OFF`, `LFH_IMG`, `LFH_ISSUE`) and **zero console errors**.
Plus the chart library deferral in item 3.

## 13 · Loading skeleton — **ALREADY THERE on every panel** ✅

Guest menu 11 skeleton elements · manager panel 17 (including the remembered table count and tiles
per row, so the floor's first paint does not re-flow) · waiter tablet 4 · admin console a route-level
`app/aevinite/loading.tsx` · owner console per-card loading states with a reserved sparkline band ·
kitchen a ticket skeleton. **Improved today** (see item 8's CLS work): two owner-console blocks now
hold their height from the first paint instead of growing when the data lands.

## 14 · Add a load balancer — **ALREADY PROVIDED; adding one is against a standing rule** ✅

Vercel runs every route as an auto-scaled serverless function behind its own anycast edge — that
**is** the load balancer, and it needs no configuration. Putting a real one in front of it (or adding
Redis / queues / read replicas) is **Stage 3** and `CLAUDE.md` says not to add it early: one shared
database, pool model, until the traffic actually asks.

## 15 · Compress API payloads — **ALREADY DONE (two ways), verified** ✅

* **On the wire:** the platform brotli-compresses responses. Measured on the deployed site:
  **24,243 bytes → 6,631 (73% smaller)**.
* **In the query:** every read names its columns and carries a `.limit()`; the floor slice asks for
  one table instead of the whole board (the read that used to be 159 KB and growing); a targeted
  realtime breadcrumb refetches one table. The rule is `docs/SAAS-EFFICIENCY-PLAYBOOK.md` and
  `npm run verify:scoped-reads` guards it.

## 16 · Database connection pooling — **ALREADY THE ARCHITECTURE** ✅

The app holds **no Postgres sockets at all**: there is no `pg` dependency and no `Pool()` anywhere.
Every read and write goes through PostgREST over HTTPS (`@supabase/supabase-js`), which pools on the
database side — which is exactly why a serverless fleet cannot exhaust connections here. Nothing to
add; adding a pooler in front of a pooler would only add a hop.

## 17 · Cache expensive computed results — **ALREADY DONE, and it prunes itself** ✅

`lib/ownerCache.ts` (mig 196) caches the owner cockpit's heavy reports keyed by
scope+report+range+window-day, serves stale instantly and recomputes in the background via Next's
`after()`, with a per-instance in-flight guard so one turnover recomputes once. It also **sweeps
itself** — rows not viewed for 30 days are deleted, piggy-backed on a cold compute at most hourly
(never a cron; that is the project rule). Nightly rollups (`orders_daily_agg`, mig 190/191) keep
dashboards off raw scans. Current state: 2,872 cached rows, oldest 2026-08-18.
The database's own record of what is expensive confirms where the cost is:
`lfh_owner_heatmap` 562 ms · `lfh_owner_revenue_timeseries` 215 ms · `lfh_owner_payment_breakdown`
160 ms per call — all of them behind this cache.

## 18 · Fix N+1 database queries — **NONE TO FIX; all 30 candidates checked** ✅

A scan for "an `await sb.…` inside a loop" flagged 30 places. **Every one was opened and read.** All
are either a single query inside a branch, a query *after* a loop, a `Promise.all`, or the correct
batched shape — `.in(ids)` for a whole page at once. The discipline is even written into the code:
`app/api/admin/bills/route.ts` carries *"one query for the whole page keyed by session_id — never one
per bill"*, and mig 340/349 exist to keep it that way. `app/api/editor/[...path]/route.ts`'s risk-actor
scan is paged, not per-row.
**And the send path got the equivalent fix today** (PR #1402): the four pre-checks on `POST /order`
now travel together and its three post-write calls became one (mig 394) — 673 ms → ~330 ms.

## 19 · Enable server-side caching — **ALREADY DONE** ✅

The same four layers as item 4, plus: `force-dynamic` only where a screen must be live, the floor
snapshot shared per restaurant with `invalidateFloor()` on every write so "read your own write" still
holds, and `withIdempotency()` so a replayed offline action is executed at most once rather than
recomputed.

## 20 · Run a Lighthouse audit — **DONE (metrics gathered directly), two real findings** ✅

| Screen | FCP | LCP | CLS | Verdict |
|---|---|---|---|---|
| Guest menu | 868 ms → 1,164 ms* | **5,892 ms** | 0.096 | LCP is the **intro splash logo**, revealed by its own GSAP animation — see below |
| Manager panel | — (content is in an iframe) | — | 0.000 | no shift at all |
| Owner console | 840 ms | 840 ms → 5,076 ms* | **0.433** | three separate blocks grow as data lands — two fixed, one named |

\* single throttled runs vary by a few hundred ms; the figures that matter are the ones that moved by
design (JS bytes, the chart library, the debounce) and they were each verified separately.

**Finding 1 — the guest menu's LCP is the intro animation, not a slow asset.** The LCP element is
`IMG.intro-logo` (`lfh-logo.png`, 35 KB, 170×170 — already tiny) and it becomes the largest paint
only when `IntroSplash`'s GSAP timeline fades it in (`autoAlpha` from 0). First contentful paint is
**868 ms**, so the guest is not looking at a blank screen; the metric is measuring a deliberate brand
moment. Making the number "good" means changing the intro animation, which is a design decision, not
a performance fix — **flagged for him to decide, not changed.**

**Finding 2 — the owner console jumps while it loads (CLS 0.433, "poor").** The exact sources were
read off the layout-shift entries rather than guessed:

* `0.264 @ 4.6 s` — the estate table pushed **62 px** down by the block above it;
* `0.013 @ 5.0 s` — everything pushed **13 px** down by the header;
* `0.109 @ 5.2 s` — a chart card growing **39 px** while another card is removed.

**Fixed today:** the KPI tiles now reserve their caption line and sparkline band from the first paint
(`app/owner/page.tsx`), and the header's "updated 2 minutes ago" line is rendered from the start and
only fills in its words. **Still open:** the highlights banner and the chart cards above the estate
table need their space reserved the same way — that is a layout task on the owner console, worth its
own change, and the three numbers above are what it should be measured against.

---

## What changed today, in one list

| # | Change | Where | Measured effect |
|---|---|---|---|
| 1 | Uploaded photos shrunk in the browser | `public/panels/shrinkimg.js` (all panels) + both upload doors | 354 KB → 31 KB on the test photo (91%) |
| 1 | 51 admin help shots given WebP twins | `scripts/shrink-help-shots.mjs`, `AccessTree.tsx` | 4.95 MB → 2.19 MB (56%) |
| 2 | Lazy loading on 9 more images; eager + high priority where it is the LCP | 8 files | fewer bytes before first paint |
| 3 | The 209 KB chart library loads on demand | `editor/index.html`, `editor/app.js` | `/manager` 3,522 → 3,328 KB; 0 requests on boot; 7 graphs still draw |
| 8/9 | Guest search deferred; kitchen search debounced | `MenuView.tsx`, `kitchen/app.js` | typing no longer re-filters per keystroke (verified 59 → 1 rows after the pause) |
| 11 | `shadcn` removed | `package.json` | one fewer dev dependency |
| 12 | `defer` on every panel script | 3 panel HTML files | all panels boot, 0 console errors |
| 13 | Two owner blocks hold their height | `app/owner/page.tsx` | removes ~26 px of the load-time jump |
| 20 | The audit itself | this file | two findings, one fixed, one flagged for his decision |
