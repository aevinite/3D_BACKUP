# Offline sync — connection light + offline action queue (LIVE)

Shipped 2026-07-07 (PRs #193 staff, #195 guest). **This is a living feature — keep
extending it as new panels/writes are added.** If you touch ordering, billing, or add a
new panel/endpoint, read this first so the offline behaviour stays correct.

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
