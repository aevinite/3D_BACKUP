# The 500-phase whole-app test

`npm run verify:everything` — 500 numbered phases, run one at a time against a chosen site.
Each phase is ONE question with a yes/no answer, printed as it runs, so a failure is pinned to
a number instead of hiding in a wall of output.

```bash
npm run verify:everything                                  # the deployed backup site
VERIFY_BASE=http://localhost:4000 npm run verify:everything # a local dev server
node scripts/verify-everything.mjs --list                  # print the map, run nothing
node scripts/verify-everything.mjs --only 419-440           # re-check one group
node scripts/verify-everything.mjs --skip-slow              # drop the bundled child suites
```

## The two restaurants have different jobs

| | role in the test |
|---|---|
| **French House** | the one that gets WRITTEN to — switches flipped, a real order pushed through, modules turned on and off. Every change is restored at the end, **including if the run is killed**. |
| **Aangan** | the CONTROL. Kept at the factory default permission set and only ever READ, so group 17 can prove all 68 defaults are still exactly what the model says. |

Aangan's defaults are not re-typed anywhere: they are `def` on each node of `lib/accessTree.ts`.
To put a restaurant back to them:

```bash
npm run access:defaults -- --slug aangan-garden-restaurant           # show what would change
npm run access:defaults -- --slug aangan-garden-restaurant --apply   # write it, then read it back
```

The applier refuses to run unless `.env.local` points at the backup database, and refuses any
live client base URL.

## What the 500 phases cover

| phases | group | what it answers |
|---|---|---|
| 1–8 | the environment | right database, right site, migration 235's columns present, every stored language/currency renderable |
| 9–24 | the repo's own guards | ui-integrity, taps, access model, clash coverage, test safety, money maths, table ownership, two parties, lifecycle, db parity, offline, no-fatal-ui, access-live |
| 25–40 | public + guest routes | every route answers, real dishes render, no code leaks to a diner, no console errors, **every** restaurant's menu answers |
| 41–60 | admin console | all 13 admin pages render with content |
| 61–73 | owner panel | all owner pages render |
| 74–89 | the four staff panels | each signs in as its REAL role, leaks nothing, throws nothing, shows Live with no alarm bar |
| 90–118 | the access tree | each guest switch off → gone → on → back; module tabs appear and disappear; a staff-app switch refuses that login at the door; the endpoint refuses too, not just the UI |
| 119–138 | manager panel | its own screens and APIs; no hidden-but-visible rows; admin-only surfaces absent |
| 139–155 | money + data integrity | totals, discounts, kitchen-ticket numbers |
| 156–160 | data separation | each restaurant sees only its own numbers (read-only, by reading the code and the data) |
| 161–177 | a real order, end to end | placed → cooking → served → billed → closed, then cleaned up |
| 178–276 | every switch, one phase each | writes a different legal value, reads it back from the server, restores it |
| 277–302 | every API family | admin + owner, enumerated from the route files |
| 303–316 | the 390px phone | each surface renders and doesn't overflow sideways |
| 317–330 | money + records, deeper | ticket numbers, table labels, staff logins, prices, rate-limit rules, migration hygiene |
| 331–347 | every restaurant | its menu, its Access screen, its settings row, its dishes |
| **348–418** | **Aangan at the factory defaults** | all 68 switches read exactly `def`; the applier and the suite agree on the list |
| **419–440** | **the guest journey** | categories, dishes, search, pinned strip, cart, layout, light/dark, currency, dish page, QR table, veg mark, favourites, 3D, allergies, language + currency switchers appear ONLY when there is a choice, no other restaurant's brand, back-button wiring, the service worker |
| **441–461** | **bills, invoices, compliance** | bill numbers, no negative bill, discount never exceeds the bill, tax from one place, refusal by CODE not prose, a deleted bill still counted, soft-delete only, the staff-action trail, GSTIN shape, no order outlives its session, customer name+number |
| **462–475** | **Inventory + Payroll** | off on Aangan by default; switched on for French House inside the run and put back; units, quantities, movements; the pay ledger is append-only and server-only |
| **476–490** | **the rules that hold under real use** | idempotency, clash guard, connection light, realtime per restaurant, channel dropped when hidden, no poll faster than the 60s backstop on the normal path, outbox replays once, login page still offline-able, alerts time out, every limited action has a rule, nothing hides a limit event, the crash log is clean, no test restaurant switched on |
| **491–500** | **the owner's real devices** | the A35 phone (360×780) and a tablet (1194×834): each panel renders and nothing spills off the side |

## Rules the suite itself obeys

- **Signs in once per role.** `loginAs()` caches the session, so recycling a browser costs no
  extra logins. Staff login is limited to 5 per 5 minutes and reaching it pings the owner's
  phone — a test that raises an alert is a bug in the test.
- **Restores on the way out, even when killed.** `SIGINT`/`SIGTERM`/`uncaughtException` all run
  the same restore. An earlier run was interrupted and left French House half-configured; that
  is worse than no test.
- **Recycles the browser every 22 pages.** One browser opening 50+ heavy panel pages crashed at
  phase 56 and turned 1 crash into 40 "failures", which buries the real findings.
- **Never skips silently.** A phase that cannot run says so and counts as a failure — "didn't
  run" and "passed" must never look the same.
- **Scopes every database query** to one restaurant with a limit. `orders` holds ~400k demo rows
  and an unscoped scan is cancelled by the database (57014), which reads like a product fault.
- **Judges by-design behaviour as by-design.** Several checks carry a comment naming the healthy
  case they used to report as a fault (an empty session has no bill number; a bill keeps the
  number of the day it opened; the 2-second poll is the realtime-down fallback).
