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
browser's dinosaur page, mid-service. Now a service worker keeps three per-device caches:

| Cache | Holds | Strategy |
|---|---|---|
| `lfh-shell` | HTML of pages already visited + `/offline.html` | network-first, cached page as fallback |
| `lfh-asset` | `/_next/static`, `/panels/*`, images, fonts | cache-first for hashed Next chunks in prod; network-first everywhere else |
| `lfh-data` | last good reply of each `GET /api/…` read | network-first, saved copy as fallback |

**Rules that must not be "optimised" away** (all enforced in `public/sw.js`):

- **Online freshness is never traded away.** Everything dynamic is network-first; the only
  cache-first path is `/_next/static/` (content-hashed, cannot go stale) and even that is
  network-first on localhost, because dev chunk names aren't hashed — that's what stops the
  classic "I deployed but the panel shows old code".
- **Writes are never touched.** Non-GET goes straight to the network; the outbox owns
  offline writes. A service worker replaying a POST could double a bill.
- **Login/auth is never cached**, and signing out (`/api/{panel,staff}-logout`) wipes the shell
  + data caches from inside the worker — a navigation, so page JS can't do it. Signing IN also
  wipes them (`LFH_CLEAR_DATA` from `app/login/LoginForm.tsx`), which covers a shared tablet
  whose previous session just expired. Together with the 12-hour expiry, that's what stops one
  device showing a previous account's screens offline.
- **`cache.match` must pass `ignoreVary: true`.** Next sends `Vary`, so a lookup by bare
  URL silently missed every saved read (found in testing: the guest menu opened but listed
  no dishes).
- **A saved copy expires.** Nothing older than **12 hours** is served (`MAX_STALE_MS`), and
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
- **Bump `VERSION` in `public/sw.js` whenever you change the caching RULES.** The `activate`
  sweep renames the caches, and that is the only way to force every device off the old rules.
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
  that table (started after the change was made), or the table was **closed/billed** after it —
  i.e. exactly the cases where applying it would corrupt someone else's bill. It does not try
  to be a merge engine for every field that might have been
  changed elsewhere. *(The field-level `X-LFH-Expect` idea was removed — nothing populated
  it, and a protection that only exists in a comment is worse than none.)*
- It **fails open** on any lookup error, and never invents a refusal for an action it can't
  resolve to a table.
- The panel then shows it in "These changes need you" with the plain reason, what to do, and
  Try-again / Not-needed-anymore. Nothing is silently applied; nothing is silently dropped.

Verify all of the above with **`node scripts/verify-offline.mjs --base http://localhost:PORT`**
(39 checks). Add `--slow-proxy http://localhost:4099` after starting `node scripts/slow-proxy.mjs`
to also cover a **hanging** connection — Chrome's own throttling does NOT reach a service
worker, so slowing the server is the only truthful way to test that case.
**Run it against `next build && next start`, not `next dev`** — dev's per-compile chunk URLs
make the offline shell behave differently from production.

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
- **Fail open, never fail closed.** `lib/idempotency.ts` proceeds without dedup if the table
  errors — a dedup hiccup must never block real writes.
- Keep it **egress-safe**: the badge derives state from existing signals; do not add a
  connectivity ping.

## TODO / keep developing (future sessions)

- [ ] **Real-device test** of the full guest offline → reconnect → order-appears flow (only
      verified headless + via the server route so far).
- [ ] **Guest: only place-order is queued.** Other guest writes (call waiter, requests, cart
      set) are NOT offline-queued yet — extend `lib/guestOutbox.ts` + a route per action if
      wanted (same at-most-once pattern).
- [ ] **An offline order shows as "waiting to send", not as a live ticket** (waiter panel
      table detail + a ⏳ mark on the tile). This is deliberate: fabricating a ticket would
      mean fabricating a bill line, and a bill must only ever show what the kitchen really
      has. If the owner ever wants the dishes to appear inside the order list itself, they
      must still be visibly excluded from every total.
- [ ] **3D models don't work offline** (multi-MB GLBs from Supabase Storage are deliberately
      not cached). Guest menu text/images do.
- [ ] **Clash checks are table-scoped.** Actions with no table (parcel, banquet standalone,
      menu edits) are not clash-checked — a stale menu edit can still win last-write.
- [ ] **OWNER DECISION PENDING:** with no internet, a device that is still signed in opens the
      saved screens without reaching the login middleware (a service worker answering from
      cache never does). Bounded to 12 hours and wiped on sign-in/sign-out. If the owner wants
      it tighter, the options are a shorter expiry or asking for the manager PIN before showing
      saved figures.
- [ ] **New panels/features** must include the connection badge and wire their writes through
      the outbox + `withIdempotency` (see NEW-FEATURE CHECKLIST in CLAUDE.md).
- [ ] **Duplicate-ack has no body** — a replay that the server already completed returns
      `{ok:true, duplicate:true}` without the original `order_id`, so the guest tracker can't
      record that order. Rare (only if the first response was lost); improve by storing the
      response in `action_idempotency` if it ever matters.
- [ ] **Prune `action_idempotency`** — rows accumulate; add a periodic cleanup of rows older
      than a day (index on `created_at` already exists).
- [ ] Consider surfacing a staff "waiting to sync" drawer entry when a queued action **fails**
      more visibly (currently in the badge dropdown only).

## Migration numbering gotcha (2026-07-07)

`138_action_idempotency.sql` (this feature) is the only migration 138 on `main`. A parallel
session's guest-ratings code briefly had comments *mislabelling* its migration as "mig 138" —
its real backing is **migration 140** (`140_owner_audit_fixes.sql`, present + applied); the
comments were corrected. No functional collision occurred, but it's a near-miss: **always use
the next FREE migration number** (`ls supabase/migrations | sort | tail`) — parallel sessions
collide on numbers easily.
