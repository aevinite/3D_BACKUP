# Floor timeouts — the follow-up check (open until confirmed)

**Status: ANSWERED for the 2026-07-31 bursts — the query is exonerated, the load was OURS.**
Keep the check; it is still the way to judge any future burst.

```bash
npm run check:floor-timeouts
```

## The 2026-07-31 15:20 answer (worked through the list below — start here before re-deriving it)

The owner pressed "Fix NOW" on a burst of `GET summary` timeouts from Aangan's waiter tablet
(14:04–14:43 UTC, 32 rows, all after mig 238 went live). Verdict, with the evidence:

| step | finding |
|---|---|
| is the read slow? | **No.** Aangan's whole floor measures **1.3–1.7 ms** (10 tables, 41,883 orders). It was being killed at the **8-second** `statement_timeout` — so it spent ~8s *waiting*, not working. |
| was it only us? | `pg_stat_statements` showed `max_exec_time` piled up at **7.7–8.0 s across many unrelated query shapes** — the whole instance was saturated, not one query. |
| who saturated it? | **Our own testing.** `scripts/verify-everything.mjs` (the 501-phase suite) running in a loop against `localhost:4310`, alongside two other dev servers and ~20 worktrees, on a shared 60-connection dev instance holding **399,426 orders** of seeded stress data. Phases 348–418 drive Aangan's tablet — which is exactly the panel and restaurant that timed out. |
| did the panel make it worse? | No. `load()` coalesces concurrent calls onto one in-flight fetch, and the 2s poll only exists when realtime failed to load. No retry storm. |

**So: not a product fault, and per the project rule our own load generating alarming rows counts as
a bug in the test, not a finding.** Do NOT "optimise" the floor query again on the strength of these
rows — at 1.5 ms there is nothing left to win. The database was calm again by 15:25 with 2 active
connections.

**What WAS a real fault, and got fixed:** the gateway's reply. When Supabase's edge gave up at
14:38 it answered with a Cloudflare **522 HTML page**, and the app stored that entire page as the
problem text — so the Problems list, the Logs, the phone alert and the "Fix NOW" ticket title all
read `<!DOCTYPE html> <!--[if lt IE 7]>…`. `logError` now runs the message through
`readableError()` (`lib/errorSignature.ts`), which keeps the page's `<title>` — the only part that
says anything — and drops the markup. Guarded by `npm run test:errors`.

**If you are looking at a NEW burst:** re-run the check, and before anything else confirm whether a
test suite or a load script was running at that hour (`ps -Ao pid,etime,command | grep verify-`).
That single question decided this one.

---

## What was wrong

The manager panel and the waiter tablets were logging this against the backup site:

```
GET summary — canceling statement due to statement timeout
```

**208 of them in 48 hours**, in bursts — 133 inside the 07:00 UTC hour alone, then nothing for
hours. Every one of those is a real screen that failed to draw a floor.

The cause was `lfh_table_view_summary`, the function that decides what every tile SAYS and what
money it shows. It walked the floor table by table, running 6–7 queries per table — roughly 2,000
statements to answer one refresh of a 300-table floor.

## What was done about it — two fixes, in this order

1. **Share the computation** (PR #603/#607, `lib/floorSummary.ts`). Every manager and waiter device
   polls the whole floor as its 60-second backstop; a dozen landing together queued and crossed the
   limit (see below — it is **8 seconds**, not the 2 minutes the database default suggests). Now
   whole-floor reads for the same restaurant inside a 1.5s window share ONE
   database call. **This one is also on AV live.**
2. **Make the read itself cheap** (PR #616, migration **238**). One set-based pass instead of the
   per-table loop, plus two costs that were hiding in it: a floor-wide `count(*) FILTER` that walked
   *every order the restaurant had ever taken* (~42k rows a call), and tile accumulation via
   `v_tiles := v_tiles || one_tile`, which re-copies the growing object once per table.
   **Backup only — AV live has NOT been given this** (see the bottom of this file).

Measured, inside the database, whole floor, min/avg/worst of 7:

| floor | before | after |
|---|---|---|
| 300 tables, 41,766 orders | 169 / 386 / **1675** ms | 11 / 16 / **29** ms |
| **10** tables, 41,978 orders | 19 / 238 / **1547** ms | 2 / 9 / **40** ms |

Fired together on one 300-table floor: 12 at once **4.9× faster**, 24 at once 6.8×, 48 at once
8.0× — it improves with load instead of degrading.

## Why this file exists instead of a claim that it's fixed

Migration 238 went live at **~11:30 UTC on 2026-07-31**, and by then the day's bursts had already
stopped. "No timeouts since" was worth nothing — there had been no traffic to time out. Worse, some
of the 10:30–11:01 rows were probably caused by **my own load testing**, so even the before-picture
is not clean.

So the honest position is: the numbers say it should be fixed, and there is no evidence yet that it
is. That gets checked, not assumed.

---

## The number everyone gets wrong: the limit is 8 SECONDS

The database's default `statement_timeout` is 120s, so it is natural to assume a query has two
minutes. **It does not.** PostgREST logs in as `authenticator`, whose role settings carry
`statement_timeout=8s`, and that is what the session gets — `SET ROLE service_role` afterwards does
not re-apply role settings. Measured on the real app path: a 5s query returns `200`, a 20s query is
cancelled at **8.8s** with `57014 canceling statement due to statement timeout` — the exact error in
these rows.

This matters for reading every number here. A floor read at ~26ms has **~300x headroom** against 8s.
It cannot cross that limit on its own; it would have to become 300 times slower.

## What the first re-check found (2026-07-31, ~4h after the fix)

**The floor query is fixed. Timeouts still happened, and they were not its fault.**

- 32 more rows, ALL on **Aangan — a 10-table restaurant** — in a single 40-minute window
  (14:04–14:43 UTC), all from the waiter tablet.
- App traffic in that window was **low** (2–19 logged actions per 5 min). By contrast 13:45 had
  **148 actions and zero timeouts**, and the 45 minutes afterwards had a full 501-phase suite
  running against the app with **zero timeouts**.
- Every query that route issues, timed for Aangan with the database calm: floor RPC 5–16ms,
  settings/categories/restaurant/dishes all ~10ms of database time. Nothing close to 8s.
- `pg_stat_statements` shows **several different** app statements with maxima pressed against the
  ceiling (7.7–7.9s). That is the signature of a saturated database cancelling whatever happened to
  be running — not one slow query.

So the remaining cause is **contention**, and the biggest single consumer of this database is
**owner analytics / reports** (`p_from`, `p_to`, `p_bucket`): mean ~0.5s, max ~8s, thousands of
calls. If timeouts recur, that is the first place to look — and note CLAUDE.md already requires
those to be served from the snapshot cache, so a high call count there may mean something is
bypassing it.

**A caveat worth keeping honest:** this is the shared dev database, and several sessions test against
it at once. Timeout rows here can be a neighbour's load rather than a product fault — check what else
was running before treating them as a bug (step 4 below).

## Tomorrow: run the check

```bash
npm run check:floor-timeouts            # last 48h
npm run check:floor-timeouts -- --hours 24
```

It is **read-only**. It never deletes or resolves an error row — a timeout row is the record of
something a real screen suffered, and errors are never hidden in this project.

It prints four things and then a verdict:

1. **whether the live function is still migration 238** — checked first, because this repo has been
   bitten by a later migration re-creating a function from a stale copy and silently undoing a fix.
   If this fails, everything else is judging the wrong function.
2. **timeouts before vs since** the fix went live, floor reads counted separately.
3. **a bar per hour**, so a burst is visible rather than averaged away.
4. **what a whole-floor read costs right now** on the two biggest floors.

### Reading the verdict

| verdict | what it means | what to do |
|---|---|---|
| **FIXED** | no floor read timed out in ≥12h of being live | delete this file and `scripts/check-floor-timeouts.mjs`, and remove the npm script. Done. |
| **TOO EARLY** | clean, but not enough hours yet | run it again after a busy period. Don't claim it's fixed. |
| **NOT FIXED** | floor reads still timing out after the change | work the list below, in order |
| **cannot judge** | the live function isn't mig 238 any more | re-apply `supabase/migrations/238_floor_summary_one_pass.sql`, then find what overwrote it (`grep -l lfh_table_view_summary supabase/migrations/*.sql` — the highest-numbered one wins) |

---

## If it is still timing out

Work these in order. The first two are about not fixing the wrong thing.

**1. Read what actually timed out, not just the count.**

```sql
SELECT created_at, panel, detail FROM staff_actions
 WHERE created_at > now() - interval '24 hours'
   AND detail::text ILIKE '%canceling statement%'
 ORDER BY created_at DESC LIMIT 30;
```

`GET summary` is this problem. `POST order` (there were 2) is a **different** one — don't lump them
together. If the mix has changed, the cause has changed.

**2. Check whether the read is actually slow, or just waiting.** The script prints the current cost.
If a whole-floor read is ~10–30ms and screens are still timing out, then the query is
**not** the bottleneck and making it faster again will achieve nothing. That means contention —
go to step 3. This is the exact mistake that already cost a lot of time here: single-call timings
pointed at the wrong culprit, and the "obvious one-line fix" was worth only ~1.1× under real load.

**3. Is the sharing layer doing its job?**

```bash
npm run verify:floor     # 12 static checks
```

Three ways it silently stops helping, each with no symptom in any other test:
- a **write handler that forgot `invalidateFloor(rid)`** — then a device that changed something
  reads a floor computed before its own action;
- a targeted **`?table=N` refetch is deliberately NOT shared** (that's what makes a tile update
  instantly) — so a burst of per-table refetches is unshared load by design. If a panel started
  polling per-table on a timer, that's your flood;
- the **1.5s window** — if someone widened it the floor goes stale; if it was narrowed, sharing
  stops working.

**4. Rule out one of our own load tests.** A single hour with a big burst and silence either side
looks exactly like a stress run, not a restaurant. Check whether another session was running
`verify-everything`, a `_conc`-style load script, or a rush test at that hour — `lsof -p <pid> |
grep cwd` names the worktree. Our own testing generating alarming rows about the app counts as a
bug in the test, not a finding.

**5. Only then, real levers** (cheapest first):
- **Snapshot the tiles payload** the way analytics already does — `lib/ownerCache.ts` +
  a cheap fingerprint, so an unchanged floor is a single row read. This is the established pattern
  in this codebase; don't invent a new cache.
- **Slow the backstop poll for idle tabs** (60s → 120s when the tab has been hidden a while). The
  realtime channel already drops on hidden/idle; the poll should respect the same signal.
- **Look at the connection pool**, not the query — if PostgREST is queueing, every statement looks
  slow and no query change helps. Confirm the POOLED connection string is in use.

**Never do these:**
- **Don't raise `statement_timeout`.** That converts a visible failure into a slow floor and a
  wedged connection.
- **Don't delete, resolve, or filter the timeout rows** to make the Problems list look clean. Silent
  is fine, invisible is not.
- **Don't "simplify" migration 238 back to a loop** on the theory that the count line was the whole
  problem. Measured: the count fix alone is ~1.1× under load; the restructure carries the win.

---

## Before changing that function again — ever

It decides what staff believe about a table and what it owes, so it is not reviewed by reading a
diff. Compare the answers:

```bash
# 1. snapshot what the floor says today
node scripts/verify-summary-parity.mjs --snapshot /tmp/floor-before.json

# 2. create the candidate ALONGSIDE the live one, named lfh_table_view_summary_v2
#    (copy the live body out with pg_get_functiondef, rename, then edit —
#     never edit the live one to "try something")

# 3. compare them, in the same instant, tile by tile
node scripts/verify-summary-parity.mjs
```

It covers every restaurant, every table holding a session or a live order, a spread of empty ones,
and dining sessions **on and off** (that flips which orders a table claims). It is itself proven to
catch a trailing space in a label, money rounded to 1 decimal instead of 2, and an off-by-one in the
"ready" threshold. And it re-reads a difference before believing it, because this database is shared
and data moving mid-read is not a logic change.

---

## One decision left open — AV live

**AV live does not have migration 238.** It has the sharing fix only. `npm run verify:db-parity`
will keep reporting `lfh_table_view_summary` as differing between the two databases, and that is
expected and correct until a release happens.

Putting it on AV live needs the owner's **explicit yes**, asked for on its own (one yes = one
change). The sensible trigger is this check coming back **FIXED** on backup — then there is evidence
to show him, rather than a promise. What to tell him when asking: it changes no wording, no price
and no tile on any screen; it only makes the floor draw faster; it is one database function, no
deploy of the site needed.

---

# Owner reports — what the research found (2026-07-31)

Researched because I suspected owner analytics of causing the floor timeouts. **They were not the
cause** (that was two of our own 501-phase test suites saturating this instance). But the research
found a real, separate bug and two things worth doing. Costs below are measured inside the database.

## Fixed: the busiest-times heatmap could never finish (migration 241)

`lfh_owner_heatmap` looked up the tax rate **once per order row** — `lfh_effective_tax_rate(o.restaurant_id)`
inside its `SUM`. It was the only one of the 16 functions that use that rate to do so; the other 15
already resolve it once. Now resolved once per restaurant via a tiny CTE and a LEFT join (a plain
join would drop orphan orders and quietly change the revenue).

|  | before | after |
|---|---|---|
| one busy tenant, all of 2026 | 8.2–16.3 s — **cancelled at 8 s** | 4.5–6.7 s — **finishes** |
| all 15 restaurants, all of 2026 | 34.7–35.6 s — cancelled | 12.5–21 s — **still cancelled** |

Proved with `node scripts/verify-heatmap-parity.mjs`: 62 comparisons, every day/hour bucket
identical for orders *and* revenue, including all restaurants in one call (the only shape where rows
carry different rates). The comparison was itself checked against a deliberate 0.01 rate nudge and
caught it.

## Still open, in priority order

1. **The whole-portfolio heatmap over a long range still exceeds 8 s and still fails.** The remaining
   cost is the scan, not the rate. It needs the data pre-aggregated by day-of-week **and hour** — the
   existing `orders_daily_agg` cannot serve it because it has no hour dimension. That is a new rollup
   plus a refresher, and it must come with the same parity proof. Not started.
2. **`lfh_owner_sales_report` skips a tier.** It reads `orders_report_monthly_agg` and then scans raw
   orders — with nothing in between — even though `orders_daily_agg` already summarises the current
   month's completed days. Monthly rollup is rolled through **June**, so a July report scans ~49k raw
   rows. One tenant, July: **32–53 ms** via raw vs **4–11 ms** for the daily-rollup path used by
   `lfh_owner_revenue_timeseries`. Small in absolute terms, cheap to fix, do it when nearby.
3. **The daily rollup runs two days behind** (`orders_daily_agg_state.rolled_through` = 2026-07-29
   while today is 07-31). Every function that uses it therefore scans two days of raw orders instead
   of none. Worth finding out what refreshes it and why it lags.
4. **The amplifier, and it is not a code bug:** `orders` is **281 MB** while this instance's
   `shared_buffers` is **224 MB**. The table cannot be cached, so any large scan reads from disk *and*
   evicts the floor's hot pages — which is how heavy analytics makes unrelated panel reads slow.
   Two honest options: shrink the hot set (much of the 399k orders here is demo/test data) or give the
   instance more memory. Worth checking what AV live's real order count is before assuming it has the
   same problem — it almost certainly has far fewer.

**Measured and worth not forgetting:** for one tenant over one month every report is tens of
milliseconds. The expensive shapes are *long ranges* and *all restaurants at once*. Any future work
here should be judged on those two, not on a single-restaurant month.

---

# Why the database kept failing — the root cause (2026-08-01)

Asked directly: *why is the database failing, can't you solve it?* Here is the honest chain, what was
fixed, and the one part that costs money.

## The machine is too small for its data

| | |
|---|---|
| `shared_buffers` (what Postgres can cache) | **224 MB** |
| `effective_cache_size` | 384 MB → a **~1 GB** machine (Supabase Micro) |
| the database | **367 MB** before this work |
| `max_connections` | 60 |

The working set did not fit. So every large scan read from disk **and evicted the floor's hot pages**
— that is the mechanism by which a heavy report made unrelated panel reads slow enough to cross the
**8-second** statement wall. It is also why the instance eventually fell over when two of our own
501-phase suites ran at once.

## Fixed: a third of that memory was pure waste

`realtime_events` holds ~300 live rows (breadcrumbs are inserted and pruned all day) and its indexes
had grown to **29 MB — one of them 19.4 MB for 306 rows**. A B-tree never returns those pages by
itself: VACUUM frees space *inside* index pages but never shrinks the index file, so a churn table's
indexes only ever grow. **REINDEX is the only thing that reclaims them.**

**Database 367 MB → 321 MB, in one pass, with nothing locked and no row touched.**

- **`npm run db:maintain`** reports what can be reclaimed; `-- --apply` does it (all `CONCURRENTLY`).
  It refuses to point at anything but the backup database. A command, not a cron — deliberately.
- **Migration 247** makes the three hot tables vacuum sooner. At the defaults, a 400k-row table waits
  for ~**80 000** dead rows before autovacuum fires, which is why `orders` sat **11 days** with 13 266
  dead rows and stale planner statistics. Now ~8 000.

## Tried and rejected by measurement — do not retry these

| idea | why it looked right | what happened |
|---|---|---|
| drop `idx_orders_restaurant_created` + `idx_orders_restaurant` (21 MB) | each is a column-prefix of a larger index, so they look redundant | heatmap **1.6–9.4 s → 20–39 s**. Load-bearing. Both restored. |
| add an effective-date index carrying the heatmap's columns, for an index-only scan | would avoid the 162 MB heap entirely | **worse** — 2.5–10.3 s → 13.5–18.9 s, and +26 MB. Dropped. |

## What is still not fixed

1. **The portfolio heatmap over a long range still crosses the 8 s wall** (best case is now ~1.6 s
   after the memory reclaim, worst still 10 s+). Cheap tricks are exhausted — it needs the data
   pre-aggregated by day-of-week **and hour**. That is a new rollup table plus a refresher, with the
   same parity proof `scripts/verify-heatmap-parity.mjs` gives. **Not built.**
2. **The machine.** 224 MB of cache for a 321 MB database is still too little; the reclaim bought
   headroom, it did not create room. Two honest options, and this one is the owner's call because it
   costs money:
   - **Shrink the data** — 399 000 orders here are overwhelmingly demo/seed/stress-test rows. A real
     restaurant produces a tiny fraction of that. Trimming the demo tenants' history would put the
     whole database comfortably inside cache. (Orders can only be archived/soft-deleted, never
     hard-deleted — that compliance rule stands.)
   - **Pay for a bigger instance** — the direct fix for headroom.
   - **Worth checking first:** AV live almost certainly has far fewer orders, so it may not have this
     problem at all. Its order count should be read before assuming the client stack needs anything.

---

# The root cause is FIXED: the demo history was 14× too big (2026-08-01)

The owner's call: *"delete all test data and add last 2 months, ~3k orders per week, Sunday and rush
hours — make it perfect and less load."* That turned out to be the actual fix for everything above.

## What was wrong

**399,449 orders** of invented history — ~6 months × 9 restaurants at ~400 orders/day each. No real
restaurant produces that, and none of it was real: 338,748 carried the `demo-seed` tag and most of the
rest were the same generator's discounted rows. It made the `orders` table **281 MB** inside a 322 MB
database, on a machine that can only cache **224 MB**.

## What it is now

**`npm run demo:reset`** (plan) / **`-- --apply`** (act) — `scripts/reset-demo-history.mjs`.

| | before | after |
|---|---|---|
| orders | **399,449** | **29,576** |
| database | **367 MB** | **120 MB** — inside the 224 MB cache |
| orders table | 281 MB | ~20 MB |

~3,400 orders/week across all demo restaurants, the last 61 days, with **Sunday busiest** (5,348 vs
Monday's 2,962), lunch peaking at 13:00 and dinner at 20:00, a quiet 15:00–17:00 lull, and roughly one
day in twelve unusually busy. Real dishes, each restaurant's real tax rate, ~2.5% cancelled, ~8%
discounted, feedback on some. Menus, settings, staff, permissions and owners are untouched, so Aangan
still holds the factory-default permission set the QA suite reads.

## The payoff — this is what all of the above was chasing

| | before | after |
|---|---|---|
| heatmap, one restaurant, all 2026 | 5,554–13,090 ms, often **cancelled** | **24–206 ms** |
| heatmap, ALL restaurants | 12,544–21,012 ms, **always cancelled** | **87–99 ms** |
| floor summary, 300 tables | 13–281 ms | 14–27 ms |

**So the day-of-week + hour rollup listed above as "still needed" is not needed.** The report that
could never finish now finishes in a tenth of a second. Fixing the root removed the problem instead of
working around it — and the machine no longer needs upgrading either.

## Three bugs the checks caught in my own seed data — worth knowing about

1. **Sunday's rush landed on Monday.** `new Date(midnightIST).getUTCDay()` returns the *previous*
   day (midnight IST is 18:30 UTC the day before), so every weight was one day early. Caught by
   plotting orders per weekday instead of trusting the code.
2. **Session-less orders left "live" haunt their table forever.** ~10% of today's rows were seeded as
   still-cooking with no session, and by the table-ownership rule that means they belong to the TABLE
   for good — free tables showing "Preparing · ₹1,150 due", the exact fault the owner once hit.
   Phase 183 caught it. Nothing is seeded live any more.
3. **Orders dated in the FUTURE.** Today's count was scaled by how much of the day had passed, but the
   times were still drawn from the whole 11:00–23:00 spread, so a morning run wrote dinner orders that
   had not happened. 303 of them, and they sat on the tables the suite tests — its own order read back
   ₹2,247 instead of ₹1,100 (phase 172).

## How the deletion respected the compliance rule

An issued bill can never be hard-deleted — a BEFORE DELETE trigger (mig 190) blocks it for everyone
including the service role, because the product must be incapable of hiding a sale. **No new permanent
purge function was added** (that would widen the very surface the rule protects). The reset uses the
trigger's own audited, transaction-local `lfh.allow_purge` flag — the same door the 90-day restaurant
purge uses — and refuses to point at any database but the backup one.

It also **refuses to run while a test suite is live**, deletes in batches with only the *live-behaviour*
triggers suspended per batch (one statement each, so a failure rolls the suspension back with it), and
verifies every trigger is enabled again before writing anything.

Verified after: phases 16–18, 57, 126–128 and **168–184 all pass** against the deployed site, zero
future-dated rows, zero table-haunting rows.

