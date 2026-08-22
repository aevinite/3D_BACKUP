# T28 — THE REPO'S OWN TESTS · findings

Territory: `scripts/**`, `tests/**`, the `verify:*` entries in `package.json`.
Branch `sweep6/t28-the-guards` · worktree `/Users/aevinite/Documents/Projects/sweep6/T28` · port 4128.
All 17 items below are FIXED in this branch, one commit each, numbered to match.

Legend: `confirmed` = I watched it happen · `code-read` = reasoned from the source.

---

## FIXED — 13 problems

### 1 · The cancelled-tile guard printed a tick over ZERO dishes · confirmed · HIGH
`scripts/verify-cancelled-tile-parity.mjs`. `order_items.restaurant_id` is NOT NULL since the pool
model; its two dish inserts never carried it and nothing read the error, so both sides of the
comparison ran on zero dishes and "the shipped math agrees with the summary" printed a ✓ that proved
nothing. Its teardown hard-DELETEd the order and session, which the database refuses for anything
carrying a KOT or bill number (mig 036 / mig 190) — also unread — so the fixture survived every run
and the next run died at the one-open-session-per-table index.
**Who is worse off:** the manager. The leftover showed as `288 · 4 · Preparing · ＋ Take order` on My
Little French House's Tables floor after table 30, red unpaid ring, header `1/31 OCCUPIED` on a
30-table restaurant. Screenshotted at 1280×800 and 360×780 dpr3.
**Regression check:** the guard now stops on any refused insert, retires rows the way a cancellation
does, and refuses to leave an open session behind. Plus the new `verify:fixtures` (item 16).

### 2 · The 1-in-1000 glitch hunt ran NONE of its 14 checks · confirmed · HIGH
`scripts/verify-edge-cases.mjs`. Ten `page.goto("${BASE}/menu")` calls in DOUBLE quotes → Chrome was
handed the literal address `${BASE}/menu` → "Cannot navigate to invalid URL" before the first
assertion. Behind it: no `restaurant_id` on any write (23502 on the first insert); un-namespaced guest
storage keys; a password POST to a four-servers-era route; and three assertions describing screens the
product deliberately changed.
**Who is worse off:** every guest. Nothing about the session gate, the double-tap or a network blip
had been checked for weeks.
**Regression check:** new `verify:guards-alive` check 1 (proved by re-introducing the bug).

### 3 · The session-UX guard ran NONE of its 11 checks · confirmed · HIGH
`scripts/verify-session-ux.mjs`. Died at its first write (no `restaurant_id`), plus three literal
templates, plus a section that reached the panel as if it were still an Express server on a bare path.
**Regression check:** `verify:guards-alive` + the new tenant-scope check in `verify:test-safety`.

### 4 · A refusal check that ANY refusal would have satisfied · confirmed · MEDIUM
`scripts/verify-edge-cases.mjs`, "make-head on a closed table is refused (got 400)". No `?rid=`, so
the panel API answered 400 "No restaurant scope" — the same number. It would have gone green on a
build where handing a closed table to a new head worked fine. Now reads the reason as well.

### 5 · The realtime guard edited whichever restaurant it found first · confirmed · HIGH
`scripts/verify-realtime.mjs`. `.limit(1)` with no restaurant filter on `menu_items` and `categories`
— the row could belong to any tenant, Aangan included — and it flipped a category's `active` with the
restore on the NEXT LINE, outside any finally. Its session insert had no `restaurant_id`, so it
crashed on `s.id` of null and checks 4 and 5 had not run for weeks. It also deleted activity rows by
`action='rt_selftest'`, removing rows another lane had just written.
**Who is worse off:** a real restaurant whose category is left switched off by a crash — the exact
shape that once left French House's Menu switch off and gave real scans a 404 for an hour.

### 6 · The waiter-tablet breadcrumb guard crashed before its first check · confirmed · HIGH
`scripts/verify-tablet-parity.mjs`. Same missing `restaurant_id` on five tables; no try/finally, so
any throw left a live "preparing" order on table 9932 — a phantom table on the floor.

### 7 · Three failures reported on a cancel that was working perfectly · confirmed · MEDIUM
`scripts/verify-void-on-joined-party.mjs`. The removal sheet has asked TWO required questions since
2026-08-18 (the owner's "order was made / not made"); the guard answered only the reason, clicked a
disabled Remove, and blamed the app 11 seconds later.

### 8 · Four checks red on two deliberate fixes · confirmed · MEDIUM
`scripts/verify-customers.mjs`. Asked the printed bill for `size:80mm`, which was removed on purpose
(a forced @page size rotates the job — measured 80×134mm onto a 70×65mm head, 0.49×, sideways). And
read `goBtn.disabled` on "Generate bill", where the real attribute was deliberately dropped because a
disabled button emits no click and swallowed the waiter's tap.

### 9 · A guest-door check red on tidier code · confirmed · LOW
`scripts/verify-guest.mjs` P00155 asked for `URLSearchParams`/`qs.append` in the menu page after the
building moved into `queryStringOf()` in `lib/tenant.ts`. Now asserts the behaviour.

### 10 · verify:admin-refusals red on a correct file · confirmed · MEDIUM
Yesterday's H3 race fix added a third database-words site inside `ensureCodes()`, whose caller wraps
them in `adminFail`. The allowance said two. Now three, with the reason.

### 11 · One comment took two guards red on clean main · confirmed · MEDIUM
`scripts/verify-t24-money-rules.mjs` said "REJECTED (owner, …)" without naming
`docs/REJECTED-IDEAS.md`, so `verify:rejected` — and `verify:static`, which runs it — were red.

### 12 · verify:families crashed on a port that stopped existing · confirmed · HIGH
It called `localhost:4003`, retired on 2026-06-13, so it had run nothing for over two months. Most of
what it asked was duplicated elsewhere or describes a path the owner has closed; the four properties
nothing else holds are rewritten against today's app.

### 13 · Six guards read the SHARED folder's keys, not their own · code-read · MEDIUM
`verify-merged-floor`, `verify-write-paths`, `sweep/audit-capture`, and the three `sweep/t3/*` opened
`/Users/aevinite/Documents/Projects/backup_Menu/.env.local` by absolute path. Every sweep lane runs
from its own worktree, so a guard reaching back into the shared folder asserts against whatever stack
THAT copy points at — and reports green about a database nobody asked it to look at.

---

## BUILT — 4 improvements

### 14 · A stopped dev server no longer reads as "this guard is broken"
17 guards answered "nothing running" with a raw ECONNREFUSED stack. They now say one plain sentence
and exit 2, keeping each one's own flag/env/default. `baseFrom()` reads whichever of
`LFH_BASE` / `VERIFY_BASE` / `BASE` is set — all three were already in use.

### 15 · NEW GUARD `verify:guards-alive` — can every guard still run at all?
Seven static checks over all 201 scripts: no `${…}` handed to something that must resolve it; no
retired panel port; every named repo path exists; every `verify:*` entry points at a real file; every
guard is reachable; everything parses; every browser-driving guard does the app-up preflight.

### 16 · NEW GUARD `verify:fixtures` — did our own tests leave a table on the floor?
Nine off-plan throwaway table names, checked with the same filter the floor's own summary uses.
`--clean` retires what it finds, by id, the product's own way.

### 17 · NEW CHECK in `verify:test-safety` — a test write must name its restaurant
Reads the ARGUMENT of every insert/update/delete on a tenant table. Catches both the refused insert
(five dead guards) and the update filtered on `table_number` alone (which measurably closed another
restaurant's table-11 session during this sweep).

---

## 🔗 HANDOFF — the fix is in another terminal's file

### H1 · `docs/GUARD-MAP.md` — three `verify:*` entries have no row (T29 owns `docs/**`)
`verify:pointers` is RED ON CLEAN MAIN today for `verify:split-payment` and `verify:t24-money-rules`,
and my two new entries make five. `verify:static` runs `verify:pointers`, so both stay red until this
one doc gets its rows. Exact rows needed, in the money / test-tooling sections:

| check | what it needs | writes? |
|---|---|---|
| `verify:split-payment` | nothing (static) | no |
| `verify:t24-money-rules` | nothing (static) | no |
| `verify:guards-alive` | nothing (static) | no |
| `verify:fixtures` | `.env.local` (dev DB) | only with `--clean`, and only test tables |

### H2 · `components/Header.tsx` — the bag badge does not follow a cart change in another tab
Its `storage` listener is bound to `loadHiddenLive()` only; the badge's own `loadCartCount()` is bound
to the same-tab `lfh:cart-updated`. `components/CartPanel.tsx` does listen to `storage`, so the thing
a guest opens is right — only the number on the bag lags until the tab re-reads. One line: bind
`onCart` to `storage` as well.

### H3 · `package.json` "dev" ignores `PORT` (T29 owns non-verify entries)
`"dev": "next dev -p 4000"`. Every sweep terminal is told "your port is 41xx, never 4000", and
`PORT=4128 npm run dev` silently takes port 4000 — the owner's own window. It happened to me on this
run; I killed it within seconds. Suggested: `next dev -p ${PORT:-4000}`.

### H4 · duplicate migration number 352 on main (T23 owns 231+)
`352_a_reseed_cannot_undo_an_admins_choice.sql` and `352_a_split_part_can_be_pay_later.sql` both
exist. `verify:db-parity` is red on clean main for it. T21's branch is also carrying a second `353`.

---

## NOT MINE, NOT A FAULT ON MAIN — shared dev-database drift from other lanes

Recorded because they look exactly like product faults and are not:

* `verify:grants` — `lfh_request_verification()` is missing from the dev DB. T21's unmerged
  migration 354 drops it; migration 296 in main still creates it.
* `verify:db-parity` — `lfh_removed_order_leaves_every_board` exists on the DB and in no migration.
* `verify:owner-territory-live` P06476 — "a dish can be added through the real editor" fails, and the
  panel says **"Saved ✓" over a 500**: `POST /api/editor/items` answers
  `Could not find the 'rating' column of 'menu_items' in the schema cache`. Cause: T21's commit
  24d318b3 (branch `sweep6/t21-db-migrations-a`) applied migration 353, which DROPS `menu_items.rating`,
  to the shared dev database, while the matching `public/panels/editor/app.js` change is not in main.
  Its own commit message predicts this exact 500. **Merge order matters:** if that migration lands
  without the panel change, no dish can be saved at all.
* `verify:avlive-release` — reads the AV-live folder and is red whenever that stack is behind. Excluded
  from CI by intent. Not touched.

## REFUSE-TO-RUN, BY DESIGN (exit 2, said in plain words) — not vacuous, not fixed

* `verify:heatmap-parity` — needs `lfh_owner_heatmap_old` staged alongside the live function first.
* `verify:summary-parity` — needs a `lfh_table_view_summary_v2` candidate. That is how mig 238 was proved.
* `verify:offline` — refuses against a dev server, because dev serves JS `no-cache` and every offline
  check would fail for a reason unrelated to the app. Its exit code was 1 and is now 2 (item 14's rule).
* `verify:panel-plumbing-live` — requires `--base`.
