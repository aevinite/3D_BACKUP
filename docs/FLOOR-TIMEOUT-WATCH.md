# Floor timeouts — the follow-up check (open until confirmed)

**Status: WAITING FOR EVIDENCE.** Opened 2026-07-31. Close it or act on it with one command:

```bash
npm run check:floor-timeouts
```

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
   2-minute limit. Now whole-floor reads for the same restaurant inside a 1.5s window share ONE
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
If a whole-floor read is ~10–30ms and screens are still timing out at 2 minutes, then the query is
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
