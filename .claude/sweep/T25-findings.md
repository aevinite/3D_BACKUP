# T25 — findings (`lib/**` remainder, 108 files, phases P12001–P12500)

Working machinery for the merge terminal. The report the owner reads is the terminal window.

**One real problem in 500 phases, and it is a high one.** Everything else in this territory came back
clean — which is what four previous sweeps through these files should produce, and did.

---

## ❌ F1 — a browser without `AbortSignal.timeout` cannot read the database at all · HIGH · **confirmed** · FIXED

| | |
|---|---|
| **Where** | Guest menu → a DISH PAGE (and the settings/features read, the ban check, ratings, reviews, and every session RPC: join a table, the shared cart, call a waiter, place the order). What a diner SEES: a dish page that is blank, and an order button that never completes. |
| **File** | `lib/supabase.ts` — the shared anon client every browser database read goes through. |
| **Who is worse off** | A diner on an older phone. They can see the dish grid and nothing else, and they cannot order. |
| **When it happens** | Any browser without `AbortSignal.timeout` — shipped Chrome 103 / Safari 15.4 / Firefox 100, all 2022. **Reading** the property throws on a browser that lacks it, so `?? AbortSignal.timeout(ms)` does not skip the deadline; it throws out of the request. |
| **Not deliberate** | This repo feature-tests the same API in FIVE other browser-side places, each with a comment saying why — `lib/menu.ts` (`orderDeadline`), `lib/guestOutbox.ts` (`sendDeadline`), `lib/session.ts` (its `rpc` helper), `public/panels/outbox.js`, `public/panels/issue-raise.js`. `public/panels/outbox.js` says it in as many words: *"READING AbortSignal.timeout throws on some older phones."* The one file that skipped the test was the shared client itself. |

**Measured on this branch**, headless, with the getter made to throw (which is what such a browser does):

| | normal | API absent (before) | API absent (after the fix) |
|---|---|---|---|
| Supabase REST requests on one dish-page view | 23 | **0** | 23 |
| `AbortSignal.timeout` getter hits | 0 | **42** | 18 (the five sibling guards feature-testing it — as designed) |
| dish page text length | 627 chars | **17 chars** | 627 chars |

**Why it stayed invisible:** the dish GRID comes from `/api/r/<slug>/menu-data`, a plain `fetch`, so
the menu still drew. Only the reads that go through the Supabase client died. And `lib/menu.ts`
guards its OWN signal correctly — but when the API is missing it hands back `undefined`, execution
falls to the `??` branch, and the throw lands in `lib/supabase.ts` instead.

**Fix:** `restDeadline()` in `lib/supabase.ts` — the same shape as the five siblings. A device
without the API gets NO deadline, which is exactly what it had before the deadline was added: a slow
read, not a dead one.

**Guard:** `npm run verify:abort-guard` (`scripts/verify-abort-guard.mjs`). Verified RED on the
pre-fix shape, RED if any of the five sibling guards is removed, GREEN on the fixed tree.
Row added to `docs/GUARD-MAP.md` (so `verify:pointers` stays green).

---

## Not findings — checked and deliberate

- `/r/aangan/menu` answers 404. Aangan's slug is `aangan-garden-restaurant`. My first harness had the
  wrong slug; the resolver is correct.
- `menu-data` fetched 3× on a cold DEV load. Turbopack + React strict mode double-invoke effects;
  zero re-fetches across the next 30s of idle, so nothing is polling. Not measured as a fault.
- 2 websockets in dev — one is Next's HMR socket. Exactly ONE Supabase realtime socket per seated
  guest, confirmed.
- `lib/format.ts` hand-maintained FX rates — REJECTED, `docs/REJECTED-IDEAS.md` R17.
- `settingsClone.ts` inheriting #1's guest-menu columns — REJECTED, R8.
- Kitchen has no profile — ruled three times.
- Path-based routing, no Stage-3 infrastructure, `lfh_theme` doing nothing on `/owner` — all
  deliberate, all in the pre-empt list.

## 🔗 HANDOFF

None. Every fix and every improvement landed inside `lib/**`.

The two files outside `lib/` that I wrote are the §7 completion of my own guards and nothing else:
`scripts/verify-abort-guard.mjs` + `scripts/verify-id-chunks.mjs` (new), their two `package.json`
entries, and their two rows in `docs/GUARD-MAP.md` (without which `verify:pointers` fails).
