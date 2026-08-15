# Offline sync — the app keeps working with no internet (LIVE)

Shipped 2026-07-07 (PRs #193 staff, #195 guest) — **writes**.
Extended 2026-07-30 — **the app itself now survives being offline**: it opens, it reads,
it shows what's unsent, and a change that clashes with another device comes back to a
person instead of overwriting their work.

**This is a living feature — keep extending it as new panels/writes are added.** If you
touch ordering, billing, or add a new panel/endpoint, read this first so the offline
behaviour stays correct.

## The offline layer (2026-07-30) — READ THIS BEFORE TOUCHING `public/sw.js`

Before this, losing signal didn't just stop new data, it BROKE the app: every route sits
behind an async server component, so a reload with no network produced nothing — the
browser's dinosaur page, mid-service. Now a service worker keeps four per-device caches:

| Cache | Holds | Strategy |
|---|---|---|
| `lfh-shell` | HTML of pages already visited + `/offline.html` | network-first, cached page as fallback |
| `lfh-asset` | `/_next/static`, `/panels/*`, images, fonts | cache-first for hashed Next chunks in prod; network-first everywhere else |
| `lfh-data` | last good reply of each `GET /api/…` read | network-first, saved copy as fallback |
| `lfh-fallback` | `/offline.html` alone | precached at install; **deliberately NOT wiped on sign-in/out** — wiping it left a device on the browser's own error page mid-sign-out |

**Rules that must not be "optimised" away** (all enforced in `public/sw.js`):

- **Online freshness is never traded away.** Everything dynamic is network-first; the only
  cache-first path is `/_next/static/` (content-hashed, cannot go stale) and even that is
  network-first on localhost, because dev chunk names aren't hashed — that's what stops the
  classic "I deployed but the panel shows old code".
- **Writes are never touched.** Non-GET goes straight to the network; the outbox owns
  offline writes. A service worker replaying a POST could double a bill.
- **"The server can't take it right now" is treated exactly like "no internet"** (2026-08-01).
  There used to be a story for offline and none for overloaded: a staff tap had NO timeout, so a
  database that was up but answering nothing (measured 30-90s on 2026-07-31) hung on a spinner
  forever, and a diner got "Order didn't go through". Now a 5xx or a timed-out write is queued on
  the device under the SAME `X-LFH-Action-Id` and delivered on recovery — a rush becomes a slow
  moment, not a broken app. A **4xx is the opposite** and must never be queued: that is the server
  refusing on the merits (a clash, a closed table, a sold-out dish) and a person has to see it.
  Retries back off with jitter so devices don't hit a struggling server in lockstep. Guarded by
  `npm run verify:busy`.
- **Login/auth is never cached**, and signing out (`/api/{panel,staff}-logout`) wipes the shell
  + data caches from inside the worker — a navigation, so page JS can't do it. Signing IN also
  wipes them (`LFH_CLEAR_DATA` from `app/login/LoginForm.tsx`), which covers a shared tablet
  whose previous session just expired. Together with the 12-hour expiry, that's what stops one
  device showing a previous account's screens offline.
- **`cache.match` must pass `ignoreVary: true`.** Next sends `Vary`, so a lookup by bare
  URL silently missed every saved read (found in testing: the guest menu opened but listed
  no dishes).
- **A saved copy expires.** Nothing older than **2 hours** is served (`MAX_STALE_MS` — the
  owner chose the short window on 2026-07-30, accepting that a longer outage comes back to
  an empty screen rather than a stale board), and
  each cache is capped (`CAPS`) with the oldest entries dropped — so a device can't show
  yesterday's figures, and no cache grows forever.
- **Slow ≠ offline.** A read that merely hangs falls back to the saved copy after 6s, but the
  real request is **never cancelled** — its reply still lands and updates the saved copy, so
  a permanently slow line doesn't pin the device to one ancient snapshot or waste the egress.
  Reads that are legitimately slow (`/api/owner/`, `/api/admin/`, `/api/inventory/`) get **no**
  stall guard at all, and anything carrying `refresh`/`force`/`nocache` (`WANTS_LIVE`) is
  **never** answered from the device — a Refresh button must wait for the real number.
- **Big media is untouched:** `/models/`, `.glb`, video. They have their own in-memory loader
  and a 1-year immutable header; an earlier version raced them against a timeout and broke
  the 3D viewer.
- **Bump `VERSION` in `public/sw.js` whenever you change the caching RULES — or `offline.html`.**
  The `activate` sweep renames the caches, and that is the only way to force every device off
  the old rules. The offline page is *precached at install*, so without a bump a device keeps
  serving the old copy of it forever.
- **The last-resort page must not GUESS the cause** (`public/offline.html`). It used to always
  say *"No internet right now"*. On 2026-07-31 the backup site's database stopped answering:
  the owner's internet was fine, the site was up, and the page still blamed his internet — then
  sat on *"Waiting for the connection…"* forever, because the only thing it probed
  (`/api/health`) was the very request that was hanging. It now runs three time-boxed checks in
  order — `navigator.onLine` → an unmatched `/api/` path that reaches our server but touches no
  database → `/api/health` — and reports which one failed: *"This device is offline"*, *"can't
  reach the internet"* (Wi-Fi with no internet), or *"Your internet is fine — this one is on
  us"* when the server is reachable but its database isn't. It also offers **Go to the home
  screen**, because a page whose only button reloads a page that can't load is a dead end.
  Guarded in `scripts/verify-offline.mjs` §10 (right reason, not the wrong one, plus the way out).
- **Kill switch:** any URL with `?nosw=1` unregisters the worker and clears the caches;
  404-ing `/sw.js` does the same by browser behaviour. `vercel.json` sends
  `Cache-Control: max-age=0, must-revalidate` for `/sw.js` so an update always lands.

### Saying so honestly
A saved reply comes back tagged `X-LFH-From-Cache` + `X-LFH-Cached-At`, and the worker also
broadcasts `LFH_SERVED_FROM_CACHE` to every open page. Two twins render that:
`public/panels/offline.js` (staff bar + "needs you" sheet + the ⏳ marks on tables carrying
unsent work) and `components/OfflineNotice.tsx` (guest/owner/admin strip). **A dashboard
must never show saved figures as if they were live** — if you add a surface that reads
aggregates, make sure one of those two is present on it.

## Clashes — a replayed change never overwrites someone else's work

`lib/clash.ts`, called once per panel write dispatcher (editor / kitchen / tablet), beside
the waiter-sections gate — same single-gate reasoning, so a table-scoped action added later
is covered the day it's written.

- Only an **aged replay** is checked: the outbox sends `X-LFH-Replay: 1` + `X-LFH-Queued-At`
  only for changes coming out of the queue, and the server ignores anything younger than
  20s. **A live write therefore costs zero extra queries** — the online path is untouched.
- The **guest** phone gets the same protection: `lib/guestOutbox.ts` sends the same markers and
  `app/api/guest/place-order` runs the same gate on the public (table-number) path, which is
  the one that could otherwise land a stale order on the next party's bill. The session path
  doesn't need it — `lfh_place_order` validates the guest's own token and answers
  `session_closed` itself.
- It refuses (409 + `{clash:{plain,todo,retryable}}`) when: a **different party** is now on
  that table (started after the change was made), the table was **closed/billed** after it, or
  the table is closed and we cannot prove when (a `status='closed'` with no `closed_at`, which a
  bare SQL close leaves behind) — i.e. exactly the cases where applying it would corrupt someone
  else's bill. It does not try to be a merge engine for every field that might have been changed
  elsewhere; that is `expectClash`'s job, below.

### ⚠️ `X-LFH-Expect` IS LIVE — do not delete it
This paragraph used to say the field-level `X-LFH-Expect` idea "was removed — nothing populated
it". **That was wrong**, and it was the most dangerous line in this file: a session trusting it
could have deleted the header from `outbox.js` and switched off first-save-wins across every value
edit in the app, with every test still green (the coverage script only checks the CALL SITES).

What is actually true:
- `expectClash()` is exported from `lib/clash.ts` and called from each panel's write dispatcher —
  `app/api/{tablet,editor,kitchen}/[...path]/route.ts` (the editor route calls it twice, once for
  POST and once for PATCH).
- **`npm run verify:clash` fails the build** when a value edit doesn't send one
  (`scripts/verify-clash-coverage.mjs`), and it prints the live tally: as of 2026-08-06 that is
  **35 value-edit call sites, 27 protected, 0 unprotected**.
- The owner console reaches `/api/owner/staff` through a THIRD hop —
  `components/owner/ownerProfileHost.ts` → `patch()` builds the `X-LFH-Expect` header. That file is
  now watched by the guard too; it was not, and deleting one line there would have switched
  first-save-wins off for every owner-side pay and profile edit with the guard still green.

> **DO NOT WRITE LINE NUMBERS HERE.** This paragraph used to pin `lib/clash.ts:92-141`,
> `tablet:620`, `editor:1563`, `kitchen:180` and "fourteen call sites". By 2026-08-06 every one of
> those was wrong (`clash.ts:119`; tablet 723; editor 2072 **and** 4309; kitchen 249; 27 sites) — in
> the one paragraph in this file marked as dangerous to get wrong. Name the file and the symbol; run
> `npm run verify:clash` for the count.
- `CLAUDE.md` → NEW-FEATURE CHECKLIST item 11 makes it mandatory for every new feature.
- It is sent on **live** writes too, not only replays — two people editing the same dish at the
  same moment is the common case.
- Money columns (`discount`, `price`, `payment_status`, `total`) say the value *moved* without
  repeating the figure: this gate runs before each branch's own permission check, so the sentence
  must not state a number the person's role isn't shown elsewhere.
- It **fails open** on any lookup error, and never invents a refusal for an action it can't
  resolve to a table.
- The panel then shows it in "These changes need you" with the plain reason, what to do, and
  Try-again / Not-needed-anymore. Nothing is silently applied; nothing is silently dropped.

Verify all of the above with **`node scripts/verify-offline.mjs --base http://localhost:PORT`**
(the count grows; run it to see). Add `--slow-proxy http://localhost:4099` after starting `node scripts/slow-proxy.mjs`
to also cover a **hanging** connection — Chrome's own throttling does NOT reach a service
worker, so slowing the server is the only truthful way to test that case.
**Run it against `next build && next start`, not `next dev`** — dev's per-compile chunk URLs
make the offline shell behave differently from production.

⚠️ **What the headless tests can't prove.** Chrome's offline emulation (`context.setOffline`)
applies to the PAGE, not to the service worker's own fetches — the same gap that makes the
crawling-connection test need a real slow server. So the READS are proven honestly (a cached
reply is tagged `X-LFH-From-Cache`, which only happens when the worker's own fetch failed),
but a fresh tab's NAVIGATION can be answered live even while the page believes it's offline.
The remaining honest proof for navigations is a real device losing WiFi — still outstanding.

⚠️ **Section 1b of that script is not optional.** It checks the ONLINE path (no leftover markup
in a panel header, a live read really coming from the server, a forced refresh never being
answered from the device). The first cut of this feature shipped two faults that were invisible
to an offline-only test — keep online assertions in any test you add here.

## What it does (already live)

1. **Connection light** 🟢 Live / 🟡 Reconnecting / 🔴 Offline, top-right on all six
   surfaces (guest, admin, owner, manager, kitchen, tablet). Derived from the existing
   realtime socket state + `navigator.onLine` — **no polling, no extra egress**.
2. **Offline action queue** — when a device is offline, writes are saved on-device
   (IndexedDB) and replayed automatically on reconnect. The badge shows a "N waiting"
   count and opens a list of what's still to send / what couldn't send.
3. **At-most-once safety** — every replayable write carries a client-generated
   `X-LFH-Action-Id`; the server claims it before running the handler so a replay runs
   **once** (never a double bill / duplicate order). Fails **open** (if the dedup table
   is unavailable, normal writes still work).

## Where the code lives

| Piece | File |
|---|---|
| Connection signal (React) | `lib/connectionStatus.ts` |
| Connection badge (React: guest/admin/owner) | `components/ConnectionBadge.tsx` |
| Connection signal + badge (vanilla panels) | `public/panels/realtime.js` (`onStatus`/`getStatus`) + `public/panels/connbadge.js` |
| Staff offline queue | `public/panels/outbox.js` (wraps each panel's `api()` helper) |
| Guest offline queue | `lib/guestOutbox.ts` |
| Guest offline order route | `app/api/guest/place-order/route.ts` |
| Server at-most-once guard | `lib/idempotency.ts` (`withIdempotency`) + migration `138_action_idempotency.sql` |

## Invariants — DO NOT BREAK

- **The online path is untouched.** Both staff `api()` and the guest cart only divert to
  the queue when `navigator.onLine === false` (or a staff `fetch` throws). Online writes go
  the normal way. Never route the happy path through the queue "for consistency" without
  re-testing live ordering.
- **Every replayable write needs the guard.** A new staff POST/PATCH/DELETE handler must be
  wrapped: `export const POST = withIdempotency(postImpl, "<panel>")`. A new client write
  must go through the panel's `api()` (staff) or the guest outbox, so it carries an
  `X-LFH-Action-Id`. Without this, an offline replay can double-fire.
  **"Replayable" means it goes through an offline queue** — the vanilla staff panels, the guest
  cart and inventory.
  **Inventory, precisely** (corrected 2026-08-13, T17 finding F12 — for months this line claimed a
  queue the tab did not have, and a count typed in a cold store was simply lost): its PLAIN writes
  go through `LFH_OUTBOX` like every other panel write, via `inv()` in
  `public/panels/editor/inventory.js`. A write CARRYING A PHOTO does not — the queue stores JSON in
  IndexedDB, not files — so those stay online-only and the person is told which part needs signal.
  The OWNER panel and the ADMIN console are plain React `fetch`es with no
  queue, so they have nothing to replay; they are wrapped only where a repeat would cost money
  (`/api/admin/bills` issues credit notes, `/api/owner/staff` creates logins). If you give one of
  those surfaces a queue, wrap the rest at the same time.
- **Fail open, never fail closed.** `lib/idempotency.ts` proceeds without dedup if the table
  errors — a dedup hiccup must never block real writes.
- Keep it **egress-safe**: the badge derives state from existing signals; do not add a
  connectivity ping.

## TODO / keep developing (future sessions)

- [ ] **Real-device test** of the full guest offline → reconnect → order-appears flow (only
      verified headless + via the server route so far).
- [ ] **Guest: only place-order is queued.** Other guest writes (call waiter, requests, cart
      set) are NOT offline-queued yet — extend `lib/guestOutbox.ts` + a route per action if
      wanted (same at-most-once pattern). The **deadline** half of this is DONE — the 15s guard
      moved into the shared `rpc()` helper in `lib/session.ts` (`SESSION_TIMEOUT_MS`), so join /
      approve / leave / cart-merge / waiter-call can no longer hang on a swamped system. (This
      entry used to say they had "no timeout on any RPC"; that stopped being true and nobody
      updated it.) What is still outstanding is only the QUEUE: those actions fail visibly
      instead of being saved and re-sent.
- [ ] **An offline order shows as "waiting to send", not as a live ticket** (waiter panel
      table detail + a ⏳ mark on the tile). This is deliberate: fabricating a ticket would
      mean fabricating a bill line, and a bill must only ever show what the kitchen really
      has. If the owner ever wants the dishes to appear inside the order list itself, they
      must still be visibly excluded from every total.
- [ ] **3D models don't work offline** (multi-MB GLBs from Supabase Storage are deliberately
      not cached). Guest menu text/images do.
- [ ] **The REPLAY clash check is table-scoped.** Actions with no table (parcel, banquet
      standalone) are not covered by `replayClash`. **Menu edits no longer belong on this list** —
      they carry a field-level expectation (`buildEditExpect` in `public/panels/editor/app.js`), so
      a stale dish, price or table-name edit is refused rather than winning last-write.
- [x] **OWNER DECISION (settled):** with no internet, a device that is still signed in opens the
      saved screens without reaching the login middleware (a service worker answering from
      cache never does). Bounded to 2 hours and wiped on sign-in/sign-out. If the owner wants
      it tighter, the options are a shorter expiry or asking for the manager PIN before showing
      saved figures. **DECIDED 2026-07-30: 2 hours.**
- [ ] **New panels/features** must include the connection badge and wire their writes through
      the outbox + `withIdempotency` (see NEW-FEATURE CHECKLIST in CLAUDE.md).
      **And add the API family to `DATA_PATHS` in `public/sw.js`** — a read under a family that
      isn't listed is passed straight through, so that screen comes up EMPTY with no internet
      rather than showing its last known state. This is CLAUDE.md checklist item 10 and it is the
      step most easily missed, because nothing fails until someone is offline.
- [x] **Duplicate-ack carries the original body** (done) — `action_idempotency.result` stores the
      completed reply, so a duplicate echoes the original `order_id` and the guest tracker can
      still follow that order (`lib/idempotency.ts`, `lib/guestOutbox.ts`).
- [x] **A REFUSAL IS NEVER TREATED AS A SUCCESS BY THE STAFF QUEUE** (done, 2026-08-06) — the
      drain in `public/panels/outbox.js` removed a change on the HTTP status alone, and several
      staff branches report a refusal inside a **200** (they hand the database function's JSON
      straight back: `sessions/:id/shift`, `orders/:id/move`, `order-items/:id/move`,
      `bill-discount`, `banquet/place`, `customer-capture`). So a saved change the server turned
      down was deleted with nothing on screen. It now reads the body, the same way the diner's
      queue always has, and the refusal reaches "These changes need you" with the reason in plain
      words. The wording list is `REASONS` in that file — ONE copy, which the manager panel's
      `KOT_REASON_TEXT` now reads from. Guarded by `npm run verify:outbox` §9.
- [x] **A REFUSAL IS NEVER REMEMBERED** (done, and the rule matters more than the fix) — a handler
      that answers `{ok:false}` inside a **200** used to be stored as "done", so the diner's next
      tap on the same basket replayed the refusal instead of reaching the kitchen. The decision
      now lives in `lib/idempotencyRule.ts` → `didSomething(status, body)`: remember it only if
      the status is under 400 **and** the body doesn't say it refused. Rows written before the fix
      heal themselves on next use. Guarded by `npm run verify:order-retry`.
      **If you add a handler that reports a refusal in a 200 body, this is what protects it.**
- [x] **Prune `action_idempotency`** (done, 2026-08-04) — `maybePrune()` in `lib/idempotency.ts`
      fires on roughly one write in two hundred and calls `lfh_prune_action_idempotency`
      (migration 268): bounded, fire-and-forget, no timer touching idle data.
- [ ] Consider surfacing a staff "waiting to sync" drawer entry when a queued action **fails**
      more visibly (currently in the badge dropdown only).

## Migration numbering gotcha (2026-07-07)

`138_action_idempotency.sql` (this feature) is the only migration 138 on `main`. A parallel
session's guest-ratings code briefly had comments *mislabelling* its migration as "mig 138" —
its real backing is **migration 140** (`140_owner_audit_fixes.sql`, present + applied); the
comments were corrected. No functional collision occurred there — but "near-miss" undersold it:
**measured 2026-08-06, 18 of the 310 migration files share a number with another one** (057, 068,
116, 121, 122, 130, 145, 155, 181, 190, 196, 202, 203, 208, 221, 227, 228, 229). Nothing is broken —
they are applied and the applier sorts deterministically — but the convention has not been holding,
so do not assume it has. **Always use the next FREE number**
(`ls supabase/migrations | sort -n | tail -1`); `verify:ui` fails a duplicate that is not on `main`
yet, and grandfathers the ones that already are.
