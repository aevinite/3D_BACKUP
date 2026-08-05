> ⚠️ **HISTORY — not a current specification.** superseded by the MEASURED ceiling of 2026-08-01 (100 simultaneous orders in ~2s — see CLAUDE.md).
> Kept because it records why things were built this way. Do not follow it for new work; the
> live rules are in `CLAUDE.md`. (Banner added 2026-08-04: eleven finished documents were sitting
> in `docs/` beside the load-bearing ones with nothing to tell them apart.)

# Stress test 2026-07-03 — FINAL findings (bugs listed, NOT fixed)

Test: 7 restaurants (pizza-palace, burger-barn, spice-route, sakura-sushi, taco-fiesta,
green-bowl, demo-bistro) × 300 tables each (2,100 tables), all seeded live, 24–28-worker
rush load. Two soak runs 11:04–11:44 + 11:43–12:09 UTC (≈65 min total; ≥50 min clean after
the machine-sleep incident). Observers: real logged-in manager/kitchen/tablet/guest pages.
french-house + aangan EXCLUDED and verified untouched (0 stress rows). Tenant isolation
verified (0 foreign rows in demo-bistro manager feed). Load: 22,941 actions
(+8,897 orders, +22,060 order_items, +3,109 sessions, +1,569 waiter calls).

## BUGS (ranked)

1. **Kitchen board silently drops NEW tickets past a 1000-row cap.** `lib/liveBoard.ts`
   queries have no `.limit()`; PostgREST caps at 1000 rows, ascending `created_at` keeps the
   OLDEST rows. burger-barn at 654 live orders / 1,993 item rows → response contained exactly
   1000 items; only 408/773 tickets had item rows; every new KOT ≥ ~#345 NEVER appeared
   (19/19 kitchen probes failed in the clean window). A jammed rush night = kitchen stops
   seeing new orders with NO error shown.

2. **Kitchen full-board poll is an egress bomb under backlog.** One kitchen screen: 390
   board polls = 278 MB in ~50 min (~713KB each, 3–14.5s response). Violates the project's
   own scoped-read/limit rule; targeted per-table refetch exists but full passes dominate
   under load. Compare: manager 16.8MB, tablet 17.4MB (both mostly targeted ?table= calls),
   demo-bistro manager 1.6MB.

3. **DB compute saturates at 7×300-table rush (free tier).** Idle ping 723ms →
   4,692ms median / 8s p95 under load; placeOrder 589ms → 2,138ms median. Everything
   downstream (realtime 3.2s avg, panel refetches, 45s tile updates) follows from this.
   Post-load recovery is full and fast (ping 502ms within minutes) — no lasting damage,
   pure capacity ceiling. The pooled connection held: zero connection-refused errors in
   23k actions.

4. **Auth treats a failed DB lookup as an invalid cookie → mass logout.**
   `lib/userAuth.ts` `userFromCookie()` returns null (→401) when the `staff_users` SELECT
   errors (network/DNS/timeouts), not only when the cookie is bad. During the DNS-recovery
   window all 4 panels 401'd and bounced staff to /login; they do NOT auto-recover when
   the network returns. Cookie TTL (7d) was irrelevant. Flaky Wi-Fi = random staff logouts.

5. **Panel APIs return bursty 500s at saturation spikes** (kitchen/board, editor/summary,
   tablet/summary — ~20 occurrences in the clean window, unreproducible seconds later).
   Route catch-alls turn any failed upstream query into a 500; panels show error/blank for
   that cycle. No retry/backoff; a 503+retry or stale-cache-serve would mask these.

6. **Manager floor updates can exceed 90s under load.** With a live page: 1 success at
   6.3s, plus a 45.9s sample pre-sleep, and 6 probes where a tile showed NO change within
   90s (realtime breadcrumb + 60s poll both missed or were too slow). Kitchen showed the
   same order in 250ms at low load — panel-side refetch queueing + DB saturation.

7. **Manager (and tablet) browser tabs crashed repeatedly under load** (mgrPP "Target
   closed" every ~2–3 min; tablet evaluate failures late-run). CONFOUNDED: headless Chrome
   + this Mac was memory-starved during the test (2 other Claude sessions + dev server +
   load generator). The manager page consistently died first → it is the heaviest page;
   worth a real-device memory profile at 300 tables before calling it an app bug.

8. **lfh_join_session has no p_restaurant_id parameter** — guest-join simulation for
   non-#1 restaurants couldn't call it directly (function-not-found). Verify all guest
   join paths pass tenant context via the scoped wrapper; a direct call defaults to
   restaurant #1.

9. **Guest menu requests /api/r/green-bowl/menu-data → 404** (repeats), then falls back
   to direct Supabase reads using `select=*`, and `item_ratings?select=*` is UNSCOPED
   (no restaurant_id filter) — egress-rule violation + dead endpoint spam. Guest settings
   were also re-read 55× in 50 min.

10. **Manager Tables tab first paint took 23–39s under load** (300 tiles). At idle it's
    instant; under saturation the first summary load blocks the whole floor view.

## VERDICTS (what held up)

- **Realtime layer: SOLID.** 100 concurrent subscribers, 99.32% delivery under full load
  (avg 3.2s — DB-bound), 100% delivery + 1.1s avg + reconnect-recovery ✓ at idle.
  realtime_events stayed lean (+366 rows for 23k actions — breadcrumb design working).
- **Tenant isolation: PASS.** 0 foreign rows; french-house/aangan untouched.
- **Egress design: PASS except kitchen.** Targeted ?table= refetches are small (~17KB);
  soak driver moved only 6.1MB for 23k writes. The kitchen full board is the one hole.
- **Pooled connection: PASS.** No connection exhaustion at 60–200 actions/sec.
- **DB recovery: PASS.** Back to baseline minutes after load stopped.
- **Prod (Vercel 3-d-backup): READY throughout; live site untouched.**

## Environmental notes
- 16:43–16:48 IST the Mac slept (battery); that window's failures excluded from verdicts.
  caffeinate used thereafter.
- Dev server was shared with 2 other active sessions editing tablet/editor files — some
  hot-reload noise possible in panel behaviour.
- Test data left in place: demo restaurants now hold ~1,647 open sessions / ~9k orders
  (useful for re-testing the kitchen cap; say the word and I'll bulk-close/clean them).
- demo-bistro table_count restored 300→10; soak staff users deleted.

## UPDATE (same day) — owner said "fix them all": PR #123 `fix/stress-test-bugs`

- FIXED #1 kitchen 1000-row blindness: lib/liveBoard.ts pageAll() pagination (verified: 3,121 item rows returned vs the old hard 1000; brand-new KOT visible on a 1,050-order backlog) + open-session URL-size fix.
- FIXED #2 kitchen egress: full-board reloads rate-limited to one per 4s (trailing) in kitchen app.js; targeted ?table= refetches untouched.
- FIXED #4 auth blip-logout: AuthDbError → `transient` → 503 on kitchen/tablet/editor/maintenance gates + panel-login (verified live vs an unreachable DB; bad cookie still 401).
- FIXED #9 guest reads: item_ratings view + restaurant_id (mig 116, applied), scoped ratings/reviews reads, explicit-column guest settings (no gstin/tax/phone to guests). The menu-data 404 was already fixed on origin/main.
- NOT A BUG #8: lfh_join_session was already tenant-scoped by mig 083 — the stress probe used the pre-083 signature.
- NOT FIXED (not code): #3 DB capacity (free tier saturates at 7×300 rush — tier/infra decision); #6/#10 manager latency under that saturation (re-test after capacity); #7 manager tab crashes (needs real-device profile; test machine was memory-starved).
- Re-verify #5 (bursty 500s) in the next load test — expected largely gone via #1+#4.
