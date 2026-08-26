# T12 findings — sweep #7, 2026-08-27

**Territory:** owner home screen, Audit & logs, who's online, marketing, `OwnerShell`.
**Branch:** `sweep7/t12-owner-home` · **PR is open, not merged** (sweep #7 gates everything).
**Ledger:** `.claude/sweep/LEDGER/T12.md` — 500 sweep-#6 rows re-run + 500 new (P20601–P21100).

Twelve problems, twelve fixes, one commit each with the number in the message. Every one carries a
measurement, and every one turns `npm run verify:owner-screen` red when its own commit is reverted.

| # | where it lives | what was wrong | commit |
|---|---|---|---|
| 1 | owner → Audit & logs → Activity log | a search or severity chip that matched nothing said "No staff activity yet — it appears here as your team works." over 8,829 entries, with no way to clear the search. Both filters are server-side, so they land on the zero-rows branch | `64d122d3` |
| 2 | owner → Dashboard, top row, Reports switched off | four tiles said "— · Reports are switched off" and "Today so far" printed "₹0 · 0 orders today" as fact. It reads the overview, which zeroes that restaurant's day on purpose | `090aa941` |
| 3 | owner → Dashboard → Recent activity, and Audit & logs (both halves) | the person column printed a raw database id: "Handled a rating · c0af7b5b-…-f475e48bab53" | `1e8e1e41` |
| 4 | owner → Dashboard → Your records | `/api/owner/analytics` has sent `partial: ["records"]` since 2026-08-12 and nothing read it, so a failed read left the card silently absent | `24ff7d7d` |
| 5 | owner → Dashboard → Expenses tile + On hand popup | a food-loss read that FAILED printed as "− ₹0" under a headline "Money on hand"; the tile face said nothing either | `57449f90` |
| 6 | owner → Dashboard → Recent activity | a failed read landed on the same null the card renders as "Loading…", so it span with no end and no retry | `2180eb2e` |
| 7 | owner → Audit & logs, both Refresh buttons + the dish view's Back | the icon touched the word — 0px of gap against the 6px everywhere else (a flex row eats a leading space) | `61b03cac` |
| 8 | backend only, nothing on screen | three comments described guards that do not exist, and one dependency array listed the same value twice | `69ab7114` |
| 9 | backend only, nothing on screen (the dashboard's load) | the all-time records scan — the one read the server keeps outside its cache because it is unbounded — ran TWICE on every open, per restaurant | `3a5bd56d` |
| 10 | owner → Dashboard → Today so far → See the full detail | the popup says "it is always today" and the link opened a thirty-day report | `ea05e557` |
| 11 | owner → Audit & logs → Audit · removals | a raw database word in three places: the row ("• customer_erased"), the chip strip, and the reason column ("data_erasure_request — …") | `77bde15f`, `17bf0732`, `b277deff` |
| 12 | owner console, the light/dark button | the three writes sat inside a React state updater, so one tap broadcast the skin twice in development | `e250df0e` |

## Reported, NOT fixed — all outside this territory

1. **`app/api/owner/ratings/route.ts:143` and `app/api/owner/customers/route.ts:352`** build their
   actor as `(scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner")`, and `scope.ownerId`
   is a uuid. That is the real cause of problem 3, and the same value also lands in
   `deletion_audit`. Fixing it there restores the person's NAME; fix 3 only stops the id being
   shown. The admin console's own log page and the manager panel's Removals screen still print it.
2. **`public/panels/auditsort.js`** has no `KIND_LABEL` / `KIND_ICON` entry for `customer_erased`,
   which `lib/removalAudit.ts` lists as a real removal kind and `app/api/owner/customers` writes.
   One line each closes problem 11 for the owner panel, the manager panel, the admin console AND
   the removal-detail card at once. `verify:owner-screen` now prints a NOTE naming any kind in that
   state (a note, not a failure — this territory may only read that file).
3. **The owner console has no offline outbox.** Its one write (the food-made answer) is a raw
   `fetch`, so an answer given with no signal is refused rather than queued. Narrow — one field on
   one row — but it is the one owner write that could sensibly queue.
4. **`npm run verify:guards-alive` fails 1 of 7** — `verify-notfound-audience.mjs`,
   `verify-printing-sweep.mjs` and `verify-sw-version-report.mjs` drive the app without the app-up
   preflight. **Confirmed identical on `origin/main` before any edit of mine.**

## Not driven, and why

* The food-made answer's WRITE path. Answering updates an order's meta and can insert a `food_loss`
  expense — real rows on the database nine other terminals are reading. Code-read only. A session
  with the database to itself should drive it and delete what it creates by id.
* Every multi-restaurant path (the estate table, the drawer, the callouts, `RestaurantDrop`, the
  stacked group chart, the top-switcher re-scope). `diago1` owns one restaurant. All were code-read
  and their sweep-#6 rows re-read green, but none was driven.

## Guards

`scripts/verify-owner-screen.mjs`: **61 → 91 checks**. Each new check was proved to go red when its
own fix is reverted. Green alongside it: `verify:audit` (87), `verify:xray` (10),
`verify:owner-home`, `verify:access` (50), `verify:taps` (33), `verify:rejected`,
`verify:clash-coverage`, `verify:settings-columns`, `verify:grants`. `npm run typecheck` and
`npm run lint` both pass (lint exit 0; the two warnings in `app/owner/page.tsx` are pre-existing).

**Nothing was written to the database in this run.**
