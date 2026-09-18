# The whole-SaaS stress test

> Asked for by the owner on 2026-09-18: *"62 restaurants, 30 tables each, all ordering and
> accepting and preparing simultaneously, 30 minutes straight, before and after."*
>
> Two sessions worked on it: one owns the rig and the run (this document's **The run**), one owns
> the database profiling and the fixes (**What the database showed, and what changed**). One
> document, because two stress documents is the "there are two printing things" failure.

## The short version

**Read this before any number below it.** Three claims get confused with each other and only one
of them is ever true at a time:

1. *"The app broke."* — measured, phase by phase, below.
2. *"Orders were lost."* — **no.** A guest order that the restaurant cannot take right now is
   saved on the phone and sent when it can (`lib/guestOutbox.ts`), and the server asks it to wait
   a jittered 20-45 seconds rather than letting a thousand phones retry together
   (`app/api/guest/place-order/route.ts` → `busy()`). A saturated database answers the panels as
   *busy*, not as broken: `lib/dbRefusal.ts` already classifies `57014` (statement timeout),
   `53300` (too many connections), the `08xxx` family and Cloudflare's own gateway wording, and
   `public/panels/outbox.js` checks the status code **before** it parses the body, so an HTML
   error page from Cloudflare is queued rather than crashing on `JSON.parse`.
3. *"A rig said the app broke."* — the first rig did, on 2026-09-18, and it was wrong. See below.

## The thing that actually decides the ceiling: the box has 407 MB of RAM

Measured on the dev instance's own Prometheus endpoint, **idle**, after a restart:

```
node_memory_MemTotal_bytes     407 MB      cores 2 (shared)
node_memory_MemAvailable_bytes 184 MB      load1 0.94
node_memory_SwapTotal_bytes   1024 MB
node_memory_SwapFree_bytes     803 MB   →  221 MB of swap IN USE with nothing running
```

Three things follow, and they outrank every query in this document:

1. **`max_connections = 60` is a fiction.** 407 MB cannot hold sixty Postgres backends, which is
   why neither rig ever saw more than ~12-14 active ones. Raising it would change nothing.
2. **The collapse was paging, not CPU and not locks.** Load samples showed backends "on CPU" while
   throughput fell over, with no lock waits, no long transactions and no dead-tuple backlog. A box
   that swaps while idle goes to disk under load — and disk is where the 8-second statement
   timeout comes from.
3. **The 14-minute outage had no Postgres-internal cause.** At the moment it took its first
   connection again there were four idle backends, zero waiting locks, no long-running
   transaction, no replication slot. Nothing was holding it. It simply had to page itself back in.

So: no query tuning removes this ceiling. Tuning changes **how far you get before you hit it**.
The floor-board read rate is the biggest lever on that distance, and the instance size is the
ceiling itself.

## Why the first rig's verdict was withdrawn

The first version reported *"68% of orders failed; an idle restaurant's floor board took 19
seconds"*. Both numbers were artefacts of the rig, not findings about the product:

| What it did | Why that is not the app |
|---|---|
| Ran every call as **service_role** | RLS — the thing that actually separates 62 restaurants — was switched off for the whole test |
| Placed guest orders with **`lfh_staff_place_order`** | The real online guest order goes through `/api/guest/place-order` (`lib/menu.ts` → `postGuestOrder`), which is where the at-most-once id, the deadline and the busy-backpressure live. None of it was exercised |
| Had **30 table-loops per restaurant race for the same 3 `status=received` rows** | One kitchen screen accepts an order; thirty diners do not. Thirty writers fighting over three rows is contention no restaurant can produce |
| Measured "the floor board" as a raw PostgREST call to **`lfh_floor_bundle`** | The manager's board is `GET /api/tablet/summary` → **`lfh_table_view_summary`** — a *different function*, behind `requireRole()` and the shared 1.5s snapshot (`lib/floorSummary.ts`). So that probe is an honest measure of **database health as an untouched restaurant experiences it** — the bystander effect is real and is the thing the owner cares about — but it is not a measure of what a manager's screen would show, and it was reported as though it were |
| Started 106 seconds after the previous slam | Its phase 1 failed at ~6 writes/sec, which is not a capacity result — it is a database that had not recovered. (This applies to the 2026-09-18 evening run only. The separate 12-minute ladder run by the backup-menu-db session took 30 idle probe rounds first — floor 56ms p50, ping 33ms, zero errors — so its phase 1 was genuinely clean and its numbers stand.) |

The rule this leaves behind: **a rig must never report a number for a screen it never opened.**

## The run

### What the rig is now

`scripts/stress-fleet.mjs` (orchestrator) + `scripts/stress-tenant.mjs` (one process per
restaurant). 62 processes, all live for all 30 minutes, 1,860 tables. Inside each restaurant, the
actors of an actual building — and each one uses the door a real person uses:

| Actor | Count | Door |
|---|---|---|
| Waiter | 3 concurrent | `POST /api/tablet/sessions/open`, `…/tables/:t/pay`, `…/sessions/:id/close` |
| Guest phone | 30 | **anon key**: `lfh_join_session`, `lfh_guest_settings`, `menu_items`, `lfh_set_cart`, `lfh_session_state`, `lfh_call_waiter`, `lfh_leave_session` |
| Guest order | — | `POST /api/guest/place-order` with an `X-LFH-Action-Id`, exactly as `postGuestOrder` sends it |
| Kitchen screen | 1 | `GET /api/kitchen/board`, `…/orders/:id/accept`, `…/orders/:id/ready`, `…/items/:id/status` |
| Floor board | 1 | `GET /api/tablet/summary` |

Staff screens are reached with the admin cookie plus the act-as cookie (`lib/panelScope.ts`), so
the whole fleet needs **zero** login requests and cannot trip the `staff_login` limit (5 per 5
minutes) — the same zero-request trick `scripts/sweep/login.mjs` uses.

### Three things the app taught the rig

Each of these looked like a product failure first and was the rig being unrealistic:

1. **A guest cannot open a session.** `lfh_join_session` answers `no_open_session` — staff seat
   the table, because a table belongs to a *party*. The rig now seats before it joins.
2. **A table whose food is still cooking cannot be closed** ("serve them first, then park the
   bill"). The rig paid and closed the instant the party left; 64 correct refusals. It now serves
   the dishes and the waiter comes back.
3. **A follow-up order is already `preparing` and nobody pressed Accept** (migrations 163/357).
   Only the *first* order of a seating is ever `received`. A kitchen model that waits for
   `received` finishes the first round of each party and lets every later dish cook forever —
   which then blocks the table from closing.

### The ladder

Every restaurant is live throughout; what climbs is how hard each table orders, so the answer is a
ceiling rather than a verdict. Phase 1 is the honest picture of 62 genuinely busy restaurants — a
party sits, orders, eats, orders again, pays, so a table orders about every six minutes.

| Phase | Minutes | A table orders every | Orders/sec across 1,860 tables |
|---|---|---|---|
| 1 — a real dinner rush | 0–8 | ~6 min | 5.2 |
| 2 — twice real | 8–14 | ~3 min | 10.3 |
| 3 — four times | 14–20 | ~90 s | 20.7 |
| 4 — eight times | 20–25 | ~45 s | 41.3 |
| 5 — sixteen times | 25–30 | ~22 s | 84.5 |

Even phase 5 stays under the app's own `guest_order` rule (8 per table per minute, migration 205),
so the ladder measures the app rather than its limiter.

### What the rig itself got wrong, and had to be told

Recorded because the next person to run this will make the same mistakes, and because every one of
them first looked like a fault in the product:

| The rig did | The app's answer | Why the rig was wrong |
|---|---|---|
| Paid and closed a table the moment the party left | `409 This table still has orders cooking — serve them first` (64×) | A waiter serves the food first. The rig now serves the dishes and comes back to settle |
| Re-seated the same table immediately after a party left | every close refused, forever | `openTableSession` is idempotent, so the "new party" joined the session still being settled and ordered again. A settling table takes no new party |
| Waited for `received` before accepting | only ~1 order in 8 ever appeared | Migrations 163/357: a follow-up order in an open seating is written straight to `preparing`. A kitchen model that waits for `received` leaves every later dish cooking forever |
| Counted `503 … very busy` as a failure | — | That is `lib/dbRefusal.ts` working. Counting designed backpressure as failure is exactly how the first rig reached "68% of orders failed" |
| Polled both boards every 5 seconds | the whole deployment stopped answering | `public/panels/realtime.js` refetches on a breadcrumb with a **60-second backstop**. 5s is 12× the real read rate; across 62 restaurants it saturated the site on its own, with `/api/health` timing out |
| Seated 1,860 tables in 8 seconds | everything timed out | A dining room fills over an hour, not eight seconds |
| Labelled a phase "4 restaurants" while running 62 | failures in the gentlest phase | The worker ignored `--startSec`, so the ladder gated nothing |
| Sent the admin cookie as a command-line argument | — | `ps` shows every argument of every process. The cookie holds `sha256(ADMIN_PASSWORD)` and the gate accepts it as proof on its own. The previous version put the **service-role key** there |

### Two rigs, two paths, one answer

The strongest evidence here is that the ceiling was found twice, independently, by rigs that share
no code and take opposite routes into the system:

| | this rig | the backup-menu-db rig |
|---|---|---|
| Path | the app's own routes (`/api/tablet/*`, `/api/kitchen/*`, `/api/guest/place-order`) | direct to PostgREST |
| Identity | **anon key** for guests, so RLS is on; admin cookie for staff screens | **service_role**, RLS bypassed |
| Actors | waiter / 30 phones / kitchen / floor board | 30 table-loops per restaurant |
| 4 restaurants · 120 tables | clean | clean — 1,613 writes, 8% errors, floor p50 181 ms |
| 8 restaurants · 240 tables | — | **79% failed**, floor p50 51.8 s |
| 16 restaurants · 480 tables | — | 92% failed |
| 31 restaurants · 930 tables | — | 100% failed |
| 62 restaurants · 1,860 tables | — | 100% failed |
| afterwards | — | full recovery, identical to the before numbers |

When a measurement through the front door and a measurement through the back door agree on where
the wall is, the wall is real.

### Results — 2026-09-18, 62 processes, real dinner-rush pace, deployed site + dev database

The run **ended itself at 19m16** when the ceiling rail fired: the bystander site had failed three
probe rounds running, so it stopped rather than hold the database under water. **No restart was
needed** — the instance recovered on its own, which is the half of the question a run that kills
the database cannot answer.

#### The load

| phase | restaurants | tables | ok | **FAILED** | refused on purpose | told to wait | fail rate |
|---|---|---|---|---|---|---|---|
| 1 | **4** | 120 | 1,740 | **0** | 85 | 0 | **0.0%** |
| 2 | **8** | 240 | 1,537 | 363 | 232 | 101 | 16.3% |
| 3 | **16** | 480 | 73 | 1,082 | 12 | 135 | 83.1% |
| 4 | **31** | 930 | 6 | 350 | 0 | 48 | 86.6% |
| 5 | 62 | 1,860 | *never reached — the rail stopped the run in phase 4* | | | | |

"Refused on purpose" is almost entirely the app correctly declining to close a table whose food is
still cooking; the rig retries, as a waiter would. "Told to wait" is the app's own backpressure.

#### The bystander — French House, never once under load

p50/p95 in ms. `!` = at least one request failed outright.

| the screen a real person opens | idle | 4 rest. | 8 rest. | 16 rest. | after |
|---|---|---|---|---|---|
| **manager floor board** (`/api/tablet/summary`) | 499/1798 | 323/1959 | **2674**/8071! | **8075**/8075! | 531/8228! |
| **kitchen board** (`/api/kitchen/board`) | 654/5019 | 511/1910 | **5477**/25002! | **25003**/25003! | 724/3585! |
| **guest menu page** (`/r/french-house/menu`) | 119/635 | 192/327 | **5504**/23392! | **25003**/25003! | 123/846! |
| guest menu data | 94/316 | 169/306 | 1673/18188! | 15100/15100! | 92/733! |
| `/api/health` | 110/154 | 112/197 | 1125/25002! | 25002/25002! | 121/385 |
| raw database ping | 65/98 | 44/153 | 596/16296! | 20003/20003! | 66/466 |

**Read the "4 restaurants" column against "idle": they are the same.** A restaurant that is not in
the test cannot tell that four others are having their busiest night. At eight it can. At sixteen
its staff cannot work at all — and neither can its diners, because the guest menu page is in that
list too.

The raw database ping degrades in lock-step with every app screen, which is the whole diagnosis in
one row: **nothing above the database is the bottleneck.**

#### Before and after

| | before | after |
|---|---|---|
| database size | 141.3 MB | 143.3 MB (+1.9 MB; the 500 MB ceiling was never in play) |
| restaurants / settings / menu items | 261 / 84 / 1,692 | unchanged |
| orders | 45,208 | 45,590 (+382) |
| sessions | 8,346 | 8,692 (+346) |

Cleanup: **415 orders soft-deleted, 798 sessions closed, 0 live test orders left, 0 refusals.**
Verified afterwards: 37 open sessions (the pre-existing baseline), **0** on any stress tenant, **0**
live stress orders. Nothing was left on anybody's floor.

Recovery: `db:ok rest:ok auth:ok`, `/api/health` 381 ms, guest menu 329 ms — unaided.

#### The answer, in one line

**This stack holds 4 busy restaurants (120 live tables) with nothing to spare. It is already
noticeably slower at 8, and unusable at 16** — and the limit is the 407 MB database box, not the
application code.

## Findings

Each one says **where it lives** — panel → screen → what you would see — before it names a file.

### 1. A diner was told to check their internet when the restaurant's database was the problem — FIXED

**Where:** Guest menu, all three doors (`/menu`, `/r/<slug>/menu`, `/q/<code>`) → the table-session
screen → during a rush, a diner whose phone is working perfectly is told
*"We can't reach the restaurant's system right now — check your internet and retry."*
Affects joining a table, the shared cart, calling a waiter, and leaving. The ordering path was
already safe (`lib/guestOutbox.ts` has a catch-all sentence).

**Why it happened:** a panel route turns a saturated database into a polite 503 via
`lib/dbRefusal.ts`. The guest RPCs go straight to PostgREST, so `lib/session.ts` → `rpc()` received
a bare `{code:"57014"}`, returned `reason: <raw Postgres sentence>`, matched no known code in
`components/SessionGate.tsx`, and fell through to the "check your internet" branch — three lines
above a comment explaining why that must never happen to someone whose connection is fine.

**Fixed** by the backup-menu-db session: one line in `lib/session.ts` reusing `isDbUnreachable`, so
every call site already words it *"the restaurant's system isn't answering right now — this one's
on us"*. Unit-checked against the nine error shapes actually observed.

### 2. The floor board's READ is what decides how many restaurants fit

**Where:** Manager panel and Tablet → the floor / tables board → the table grid takes seconds to
paint and then shows *"The system is very busy right now"* — **including at a restaurant nobody is
using**, because the cost is shared.

**The function is not slow.** Measured idle, `EXPLAIN (ANALYZE, BUFFERS)` on the whole floor:
**22.1 ms** for French House (27 live orders, 3,050 shared buffer hits) and **16.6 ms** for a
30-table stress tenant — matching the 11-29 ms that `lib/floorSummary.ts` already records for
migration 238. It is the **rate** that costs, not the query.

**Backend:** `GET /api/tablet/summary` → `lfh_table_view_summary`, coalesced by
`lib/floorSummary.ts` for 1.5s *per serverless instance* (which is less coalescing than it looks
once Vercel spreads 62 restaurants across many instances). At roughly 41 reads/sec × the ~20 ms
measured above, the boards alone are about **0.8 of the 2 shared cores before a single order is
placed** — on a box that is already in swap. Orders are the spikes on top of that standing cost.

(An earlier draft of this section said 1.2 cores, from a 30 ms estimate made before
`lfh_table_view_summary` was actually measured at 22.1/16.6 ms. The measured figure is the one to
use; the conclusion is unchanged and the point does not depend on the third digit.)

### 3. The dev database does not always recover on its own

**Where:** backend only, nothing on screen. After a 62-restaurant run the Postgres instance stopped
accepting connections entirely — Supabase's own health endpoint reported `db: UNHEALTHY`,
`"Failed to connect to database"` — and stayed that way for 14 minutes with zero load on it. A
project restart brought it back in 3½ minutes with every row intact. Earlier, lighter runs recovered
on their own in about two minutes, so "it recovers by itself" is true only up to a point.

## What to do about it — pick by number

### Can be done now, no decision needed

**1. Migration 399 — stop a breadcrumb sweeping the whole table inside someone's order**
· **Where:** backend only, nothing on screen — it shows up as everything being slow during a rush.
· **What it is:** `lfh_rt_emit` rolled a 1-in-100 dice on an *unindexed full-table* `DELETE` of
  `realtime_events`. It fires per changed ROW, and an order emits 8-14 breadcrumbs, so ~7-8% of
  orders paid for a full sweep inside the diner's own transaction. `pg_cron` has done the same
  prune every ten minutes all along.
· **If yes:** the single worst thing on the write path is gone. · **If no:** every busy service keeps
  paying it, and it gets worse as the table grows. · **Effort:** written, tested, one statement.
· **Risk:** very low — it deletes a redundant piggyback, it does not change what a subscriber sees.

**2. The "check your internet" fix — already applied**
· **Where:** guest menu, all three doors → the table-session screen. · Covered in Findings §1.
· **Risk:** very low, one line, reuses the existing `isDbUnreachable` classifier.

### Needs you

**3. Is the client project on the same free tier?** ← *the most important line in this document*
· **Where:** your Supabase billing page, ten seconds. **Nobody should read your live stack to find
  this out** — it is a question for you, not a task for us.
· **What it is:** free tier **is** the 407 MB box measured above. · **If it is free:** the ceiling
  in this document is a **paying-customer** ceiling, and a compute upgrade is the single highest-value
  change available. · **If it is paid:** this whole document is a dev-stack curiosity and the code
  fixes are optimisation, not urgency. · **Effort:** ten seconds. · **Risk:** none.

**4. Pay for a bigger database instance**
· **Where:** infrastructure, nothing on screen. · **What it is:** the ceiling is RAM, not code.
· **If yes:** every number here moves at once, and it is the only change that does. · **If no:**
  the stack holds a handful of busy restaurants, whatever else is optimised. · **Effort:** a
  billing change. · **Risk:** money. · **Do not decide this before item 3.**

**5. Reduce the floor board's read RATE (not its query)**
· **Where:** manager panel and tablet → the floor/tables board. · **What it is:** the query is
  already fast (22 ms). 62 restaurants reading it is ~0.8 of 2 cores as standing load. Options:
  widen the shared-snapshot window past 1.5s, or make a breadcrumb refetch only the table it names
  instead of the whole floor (the kitchen board already does exactly this — `?table=N`).
· **If yes:** more restaurants per box, the only code change that buys that. · **If no:** the
  standing cost stays the thing that decides the ceiling. · **Effort:** real — it touches the
  snapshot cache and the realtime path. · **Risk:** medium; a floor that updates late is a floor
  people stop trusting. **Measure before building.**

**Recommendation:** do 1 now (it is written and safe), answer 3 tonight because it decides whether
any of this is urgent, and only then weigh 4 against 5. Do not start 5 on the strength of this
document alone — the arithmetic says it is the right lever, but a rate change on a live floor board
needs its own measurement first.

## What the database showed, and what changed

Measured from inside the database while the fleet ran (`pg_stat_statements` reset per window, a
`pg_stat_activity` sampler every 5s) and from the instance's own Prometheus endpoint.

### 1. The ceiling is MEMORY — 407 MB, and it was already in swap

**Where:** backend only, nothing on screen.

Everything else in this document sits on top of this one fact. The dev Postgres instance has:

| | |
|---|---|
| RAM | **407 MB total**, 184 MB available, 159 MB of that page cache |
| Swap | 1,024 MB, **803 MB free → 221 MB already in use with nothing running** |
| Cores | 2 (shared) |
| `max_connections` | 60 |

*(Read from `https://<ref>.supabase.co/customer/v1/privileged/metrics`, basic auth `service_role`.
That endpoint needs no database connection, which is why it kept answering during the outage
below while SQL did not — worth remembering next time this instance goes quiet.)*

So `max_connections = 60` is a fiction: 407 MB cannot hold sixty Postgres backends, and neither
rig ever saw more than **12–14 active at once** no matter how much concurrency was pointed at it.
It also settles what looked like a CPU story: at peak, the `pg_stat_activity` samples showed
backends *on the CPU* (439 samples) rather than waiting on locks (32), yet throughput had
collapsed — because the real wait was **paging**, which does not show up as a lock and does not
show up as a wait event. A box that swaps while idle goes to disk under load, and disk is where
the 8-second statement timeout comes from.

**In simple words:** the test database has less memory than a cheap phone, and it was already
borrowing from the hard disk before the test started. Sixty-two busy restaurants cannot fit in
that, and no amount of tidying the code changes it — tidying the code only changes how far you get
before you hit the wall.

**What follows from it, and what does not:**

- Raising `max_connections` would achieve nothing — it is not the limit that is binding.
- The only two levers that exist are *fewer/cheaper queries* (below) and *more memory* (a paid
  compute tier). Stage-3 machinery — Redis, read replicas, a real load balancer — stays out, per
  the standing architecture rule.
- **This is the TEST stack.** Different Supabase project, different Vercel project, and
  `scripts/stress-fleet.mjs` refuses to run against anything else (`refuseUnlessDevTestDb`). No
  paying client was involved at any point.

### 2. Recovery, measured from the outside

After the 30-minute run the instance stopped accepting connections with **zero load on it**. A
watcher polling one `select 1` every 20 seconds got its first answer **5.3 minutes** later, and
the snapshot taken at that instant found nothing holding anything:

```
4 client backends, all idle        0 locks waiting
1 active query (the snapshot's)    no transaction older than 0.0s
no dead-tuple backlog              no replication slots
```

There was no Postgres-internal problem to find. It simply had to page itself back in. On the
heavier run it never managed it and needed a restart (see *The run*, §3). Lighter runs recovered
on their own in about two minutes — so both statements are true, and the pessimistic one is the
one to plan around.

### 3. The one real fault on the write path: every write rolled a dice on a full table sweep

**Where:** backend only, nothing on screen — but it was on *every* write the app makes, from a
waiter's "Send to kitchen" to a diner's order to a kitchen screen marking a dish ready.

`lfh_rt_emit` — the trigger that announces every change to every open screen — ended with:

```sql
IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
```

`lfh_rt_prune()` is `DELETE FROM realtime_events WHERE created_at < now() - interval '15 minutes'`,
and `realtime_events` has no index on `created_at`, so that is a **sequential scan of the whole
breadcrumb table, inside the customer's own transaction**.

And the dice is rolled per *row changed*, not per order. Measured on the stress tenant, 3 dishes
per order, 40 orders through each door:

| | breadcrumb rows per order | full sweeps | rows read by the sweeps |
|---|---|---|---|
| Staff door (`lfh_staff_place_order`) | **13.6** | 5 in 40 orders | 10,643 |
| Guest door (`lfh_place_order`) | **8.2** | 1 in 40 orders | 4,995 |

40 orders × 13.6 emits = 544 rolls at 1% ≈ 5.4 expected sweeps, **5 observed**. The mechanism is
confirmed to the decimal place: the sweep landed on roughly **7–8% of orders**, not 1%.

Cumulative damage on the dev database before the fix, from `pg_stat_user_tables`:

```
seq_scan          26,984
seq_tup_read   1,079,442,494     ← a billion rows read, by housekeeping alone
autovacuum_count   1,113
```

It has been redundant since **migration 060**, which put the same prune on pg_cron every ten
minutes and left the old one in place — both ways running side by side, one of them on the
customer's critical path. **Migration 399** removes it and re-asserts the cron job so the removal
can never leave the table unpruned.

#### What removing one line actually bought — measured, quiet instance, 40 orders through each door

| | before 399 | after 399 |
|---|---|---|
| **staff order — database time (mean)** | **30.2 ms** | **12.5 ms** — −59% |
| **guest order — database time (mean)** | **31.2 ms** | **7.4 ms** — −76% |
| staff order, end-to-end p95 / max | 217 ms / 442 ms | **96 ms / 224 ms** |
| guest order, end-to-end p95 / max | 176 ms / 205 ms | **62 ms / 70 ms** |
| seating a table (`lfh_join_session`, mean) | 15.3 ms | **2.6 ms** |
| full sweeps of `realtime_events` per 80 orders | 4 — **27,570 rows read** | **0 — 0 rows** |

A 1-in-100 event cannot halve a mean unless it is enormous, and it is: a sweep scans the whole
breadcrumb table and then deletes about two-thirds of it, indexes and WAL included — on the order
of a second and a half. That is why the *average* order was paying ~18 ms for something only 8% of
orders actually ran, and why the tail was four times the median.

**Proof it is gone, not just quiet:** the live function now has **0 executable lines** matching
`IF random()` and 1 commented-out line (the obituary), the `lfh-rt-prune` cron job is still active,
and a mechanical diff of the migration against the previous live definition shows exactly one
executable line removed and nothing else touched. *(First attempt at that check was a bad test — the
regex matched the obituary comment I had just written. Re-run properly.)*

### 3a. Where the rest of an order's time goes — all 17 triggers, one at a time

`EXPLAIN ANALYZE` on an INSERT reports each trigger separately, which is the only way to see what
`orders` really costs. Median of 5, quiet instance, 2 dishes:

| | |
|---|---|
| **INSERT INTO orders** | **15.5 ms**, of which **12.2 ms (79%) is triggers** and 3.3 ms is the row |
| pricing the basket (`lfh_price_order`) | 7.8 ms |
| the 3-second duplicate guard (staff door only) | **0.15 ms** — index scan, not the O(history) scan feared |
| the auto-accept check (guest door only, mig 163/357) | **0.12 ms** — index scan on `session_id` |

The triggers, in order of cost:

```
2.69 ms  trg_orders_fill_tax_split       ← tax
2.04 ms  trg_stamp_order_tax_rate        ← tax
1.59 ms  trg_assign_kot
1.42 ms  rt_emit_orders
1.25 ms  trg_inv_deplete_order
0.93 ms  trg_order_joins_closed_session
0.61 ms  trg_orders_watermark
0.45 ms  trg_clamp_order_discount
0.35 ms  trg_resplit_bill_discount
0.32 ms  trg_kot_queue_autoprint
0.22 ms  trg_assign_bill_on_order
0.22 ms  zz_orders_disc_gross
0.09 ms  trg_removed_order_leaves_every_board
```

**38% of the trigger time is the two tax triggers.** That is money correctness and it is not being
touched on the strength of 4.7 ms. `trg_inv_deplete_order` at 1.25 ms is the one worth a later look
— a restaurant with no inventory module should ideally not pay to find that out — but 1.25 ms of
15.5 ms is not tonight's problem, and it is written here so the next person has the number.

**And the important correction this makes to my own earlier claim:** I reported an order costing
193 ms idle / 404 ms under load. On a healthy instance it costs **~30 ms before 399 and ~12 ms
after**. The 193 ms and 404 ms were almost entirely *waiting*, not working — the memory ceiling
again, not the code.

### 3b. A seat is cheap — it only *looked* expensive because it goes first

**Where:** waiter tablet / manager panel → tap a free table → Open. `POST /api/tablet/sessions/open`
→ `lib/openSession.ts`.

Seating was the first thing to time out in the 62-restaurant launches, which reads like "seating is
expensive". It is not:

| | |
|---|---|
| the "is this table already open?" read | **0.13 ms** — index scan on `idx_sessions_rest_table_created`, 2 buffers |
| **INSERT INTO sessions** | **4.3 ms**, of which 2.6 ms (59%) is triggers (`rt_emit_sessions` 1.77, `resolve_open_requests` 0.78) |

**~4.4 ms in total — a third of an order.** It failed first because it was *first in the queue*, not
because it is heavy: nothing can happen at a table until it is seated, so seating is what queues up
when the database has stopped accepting work. Worth knowing, because "make seating cheaper" would
have been the wrong fix.

### 3c. Exactly how many breadcrumbs one order emits

Counted scoped to one tenant so no other writer could inflate it — this is the number migration
400 (parked, below) would change:

| | breadcrumbs |
|---|---|
| a 3-dish order (staff door, table already seated) | **12** — 6 × `order_item`, 4 × `session`, 2 × `order` |
| a 3-dish order (staff door, table not yet seated) | **12** |
| **the kitchen marking that order ready** — one `UPDATE` | **6** — all `order_item`, all carrying the same order id |

Each row-change writes two rows: one on `ops`, one on `table:<n>`. The six from a 3-dish write are
duplicates of each other as far as any subscriber is concerned.

### 3d. PARKED — one breadcrumb per write, not one per dish

**Where:** backend only, nothing on screen. The file is
**`docs/STRESS-TEST-migration-400-draft.sql`** — deliberately *not* in `supabase/migrations/`,
because a re-seed runs every file in that folder with no ledger, and an unverified change to the
realtime plumbing must not be able to reach a database on its own.

`order_items` announces per ROW. Making it announce per STATEMENT collapses the duplicates in §3c:

| | before | after |
|---|---|---|
| 3 dishes in one order | 6 `order_item` rows | **2** |
| the kitchen readying all 3 | 6 | **2** |
| one statement spanning 2 orders / 2 tables | 8 | **4** — both table topics |
| an `UPDATE` matching no row | 0 | **0** |
| a dish deleted | 6 | **2** — restaurant still taken from the item row |
| what a subscriber receives | `order_item` / order id / table 7 | **byte-identical** |

Unit-tested on a throwaway PostgreSQL 17 with a stand-in schema (all six cases above), and
`realtime_events`' own `BEFORE INSERT` trigger `trg_set_topic_rid` still fires per row, so the
`topic_rid` every subscription filters on is still filled.

**What it buys, stated narrowly:** WAL, logical decoding, and Realtime's per-row per-subscriber RLS
evaluation — which is the largest single consumer of database time in the schema
(3,249,528 calls / 23,146 seconds in `pg_stat_statements`). **It does NOT reduce read volume**, and
an earlier draft of this document implied it did. `public/panels/realtime.js` already debounces
~200–300 ms per topic with burst-stretching, so those six duplicate breadcrumbs were already
collapsing into a single panel refetch.

**Why it is parked and not shipped:** realtime is what makes every board feel instant, and a
regression there is worse than the saving. It ships only after a real browser confirms a new order
reaching the kitchen board, a dish marked ready moving the manager's tile and the waiter's tablet,
and a removed dish leaving every board — on a non-#1 restaurant. That check did not fit the night
this was found.

**No index was added, deliberately.** Retention is 15 minutes and the cron runs every 10, so each
scheduled prune deletes roughly two-thirds of the table — for a delete that broad a sequential
scan genuinely *is* the cheaper plan, and an index would be maintained on every insert into the
highest-insert table in the schema forever, to speed up a job that runs 144 times a day. The fix
is to stop running the sweep twenty times a second, not to index it.

**Also a finding in its own right:** the manager's door costs **65% more breadcrumbs** than a
diner's phone (13.6 vs 8.2), because it opens the session itself and touches `sessions` twice.
Which matters for advice: the panel a waiter uses is the dearer of the two doors.

> **Why there are no latency figures in the table above.** The same pass recorded per-order
> latencies, and they are thrown away on purpose: it ran at 17:35 UTC, which overlapped the start
> of the other session's ladder, so its timings are that ladder's numbers and not a baseline (it
> reported `lfh_table_view_summary` at 652 ms mean against a quiet-instance 22 ms). The COUNTS
> above are load-independent and stand. Written down rather than quietly dropped, so nobody
> reading this later wonders where the column went.

### 4. The floor board is the standing load, and it is already as cheap as it gets

**Where:** manager panel → Table view, waiter tablet → floor, and the owner's floor card.

On a freshly restarted, quiet instance, `EXPLAIN (ANALYZE, BUFFERS)` of the whole-floor read:

| | database time | shared buffer hits |
|---|---|---|
| French House (27 live orders) | **22.1 ms** | 3,050 |
| a 30-table stress tenant | **16.6 ms** | 2,383 |

End to end from a laptop: p50 44 ms, p95 73 ms — and a bare `select id limit 1` is 33 ms of that,
so about 11 ms is ours. That matches what `lib/floorSummary.ts` already documents for migration 238
(11–29 ms, down from ~300 ms). **The function is not the problem; the rate is** — and the rate is
what the other session's ladder measures.

### 5. A diner with a perfect phone was told to check their internet

**Where:** guest menu → the table sheet (join a table, the shared cart, calling a waiter, leaving)
→ the diner sees *"We can't reach the restaurant's system right now — check your internet and
retry."* File: `lib/session.ts` → `rpc()`.

This is the one fault a *guest* would have seen, and the stress run is what surfaced it. Those
RPCs go straight to PostgREST, so no route of ours is in the way to translate a failure: the
reason handed to the screen is whatever Postgres said. Under saturation that is
`canceling statement due to statement timeout` (57014), `too many connections` (53300), or a whole
Cloudflare gateway page — none of which matched the existing abort test, so `isSessionTimeout()`
answered *false* and `components/SessionGate.tsx` fell through to the branch that blames the
diner's connection. Three lines below that sentence sits a comment explaining that this must never
happen.

Fixed with one line, reusing the classifier the panel routes already use:

```ts
if (isDbUnreachable(error)) return { ok: false, reason: "timed_out" };
```

`timed_out` is reused rather than adding a new code, because every call site already words it
*"The restaurant's system isn't answering right now — this one's on us."* Unit-checked against the
nine error shapes actually observed: 57014, 53300, a 522 gateway page, `upstream request timeout`,
57P01 and `fetch failed`/ECONNRESET all classify as *didn't answer*; a CHECK violation, our own
`P0001` refusal and `PGRST116` no-rows all still classify as *a refusal*, so a refused value keeps
showing its own message.

**Left as a thread:** `submitReview`, `renameMyReviews` and `leaveFeedback` in `lib/menu.ts` still
return the raw Postgres message. A review form wording badly during a once-a-year saturation was
not worth changing money-adjacent code for on the night.

### 6. What the app already did right, and needed no change

Checked by reading the code, because the rigs' failure counts read as lost orders and they are not:

- `public/panels/outbox.js:495` tests `res.status >= 500` **before** it calls `res.json()`, so
  Cloudflare's HTML error page is queued as *busy* and replayed in order instead of throwing on a
  parse. A staff write is never lost to a busy database.
- `lib/dbRefusal.ts` already classified every error shape this test produced, including `57014`
  and `53300` — so a saturated database answers panels `503` + `X-LFH-Busy` and the wording is
  *"the system is very busy right now — this will come back by itself."*
- `public/panels/netretry.js:59` caps a read at **15 s**, so the 67-second board read the first rig
  sat through is not what a manager would have experienced.
- `app/api/guest/place-order/route.ts` → `busy()` sheds load with a **jittered 20–45 s**
  `Retry-After`, so a thousand phones do not return in the same second.
- `app/error.tsx` catches a thrown server read on all three guest doors and shows *"We couldn't
  load this just now — something went wrong on our side, it's not your connection."* Confirmed
  live during the outage: the page answered 500 and the body is Next's error shell, with that card
  rendered on the client.

### 7. The rig lied to us twice, and that is worth writing down

- **A probe with no deadline records nothing, not a slow answer.** Every phase after the first
  printed `p50=0ms p95=0ms err=0` — "instant and healthy" at the exact moment the database had
  stopped answering. `scripts/stress-fleet.mjs`'s `sb()` now carries a 20 s deadline.
- **The watchdog cost more than what it watched.** The disk guard's per-table
  `pg_total_relation_size` walk measured **1,427 ms mean** during the run. It now takes only
  `pg_database_size` while running, and the breakdown before and after.
- A probe round is also guarded against overlapping itself, because seven sequential calls each
  waiting out a deadline take longer than the 10-second timer that starts them.

### 8. Found by accident: this repo cannot build a database from zero

**Where:** backend only, nothing on screen — and it matters on the day someone has to rebuild.

Standing up a local Postgres to profile without disturbing the shared instance, the from-zero
build aborted at migration **049 of 407**. Two separate causes:

1. `049` and `051` called `lfh_already_applied(...)` directly, though that helper is created at
   migration **307**. Migrations 043, 225 and 235 already carry a `to_regprocedure` gate for
   exactly this; **that same gate — and nothing else — was added to 049 and 051.** Behaviour is
   identical on every database that has the helper, which is all of them.
2. It then fails again *inside* 049's orphan-order backfill, which reads `orders.restaurant_id`
   before that column exists. **Not fixed** — it needs its own change, not a line in a stress-test
   branch. `CLAUDE.md` already steers everyone to `scripts/run-migration.mjs` rather than a
   re-seed, so nothing in daily use depends on it.

### 9. One N+1 the optimisation audit missed

`docs/OPTIMIZATION-AUDIT.md` item 18 says "none to fix; all 30 candidates checked".
`lfh_price_order` loops over the basket and calls `lfh_resolve_tax_mode(...)` per dish, and that
function reads the `settings` row each time — so a four-dish order reads `settings` five times.
It is an N+1 by the letter. **Left alone on purpose:** `settings` is 84 rows and the read is a
primary-key lookup, so the whole thing is a fraction of a millisecond of the ~200 ms a placement
costs, and it is tax code. It goes on the list to fix when there is a measurement that says it
matters, not before.

### 10. The lesson that outlives the numbers

**Three separate times tonight, a confident claim about what a measurement showed turned out to be
a claim about the instrument.**

| The claim | What it actually was |
|---|---|
| "68% of orders failed" | A rig calling the database directly as `service_role`, with thirty table-loops fighting over three rows |
| "It fails even at 4 restaurants, 6 writes/sec" | A run started 106 seconds after the previous slam, on a database that had not recovered |
| "Your ladder's phase labels are wrong" | A `--startSec` gate dropped in a *rewrite* of the worker, not in the worker that run used — caught by arithmetic (1,613 writes in 120 s is 13.4/sec; 1,860 tables at a 20-second pace would be ~93) |

Every time, the number was real and the **label on it** was not. That is the failure mode to guard
against here, not a test that fails: a test that succeeds at measuring the wrong thing and gets
believed. The rule both sessions ended up working by: **a rig may not report a number for a screen
it never opened, and neither of us accepts the other's claim about our own measurements without
checking it.** Both retractions in this document were produced that way.

