# Sweep 6 — T3 findings (guest basket · table session · placing an order)

Seven real problems, all **fixed in this branch**. One 🔗 HANDOFF for a file outside this territory.
Every row passed the four-test gate before a line of working code was changed.

Guard for all of them: `npm run verify:guest-doors` (new, 27 checks, also wired as a PostToolUse
hook). Proved it goes RED on `origin/main`'s versions of these files — 20 of the 27 fail there.

---

## FIX-1 · A diner who scans the sticker on their own table could not order — HIGH · confirmed

- **Where:** guest menu → the door `/q/<code>`, i.e. the QR sticker printed for a table → the diner
  taps "+" on a dish and, instead of the dish going into the basket, a "join a table" popup opens.
  On a restaurant that has the table-session system switched off, that popup should not exist at
  all. Basket stays empty.
- **Who is worse off:** every diner at every restaurant except restaurant #1, and that restaurant's
  owner, who has printed stickers that do not work.
- **When:** always, on `/q/<code>`, for any restaurant that is not #1.
- **Why:** `lib/restaurant-context.tsx` decided the restaurant from the URL alone (`/r/<slug>`).
  `/q/<code>` keeps its own URL on purpose (the table number must not go back in the address bar),
  so there is no slug in the path — and the provider answered "restaurant #1" for every global
  widget: the basket, the session gate, the feature switches, the tax rate, the bell.
  `lib/tenantStorage.ts` already had the right rule (it reads the tenant the tab was pinned to by
  `app/q/[code]/page.tsx` before hydration), but there were two copies of the rule and only one
  was correct. Restaurant #1's own stickers resolve to #1 by accident, which is why nobody saw it.
- **Watched:** Aangan's own table-1 sticker. Sessions are OFF at Aangan; the widgets read #1's
  settings where they are ON, so the gate opened ("What should we call you?") and nothing was
  added. Via `/r/aangan-garden-restaurant/menu` the same tap added the dish.
- **Fix:** the provider now calls the exported `tenantSlug()` — one rule, imported, not re-derived.
  Read inside the effect (there is no `sessionStorage` on the server), so the first render is still
  SSR-safe. `ready` now starts true only for the routes that genuinely ARE #1 (`/menu`, `/item`).
- **Also fixed by it:** "Change table" from a sticker used to bounce the diner to restaurant #1's
  menu; the 3D viewer route had the same wrong answer.

## FIX-2 · "We've let the staff know" was shown whether or not anyone had been told — HIGH · code-read

- **Where:** guest menu → the table-session popup → "Your table isn't open yet" and the
  "Call a waiter instead" links → the screen that says *"We've let the staff know — keep this open
  and your order is sent automatically."*
- **Who is worse off:** a diner sitting at a table nobody has opened. They stop trying, because the
  screen says it worked. And the restaurant, which has a table waiting that it never heard about.
- **When:** any time `lfh_request` does not land — a timeout (`rpc()` returns
  `{ ok:false, reason:"timed_out" }`, it never throws), a tripped per-table limit, a blocked table.
- **Why:** both request paths discarded the answer and went straight to the reassurance screen.
- **Fix:** read the answer; only advance when it landed. `already_sent` still counts as landed.
  The reason is TOASTED rather than written into `note`, because three of the five screens that can
  send a request never render `note`, and one renders it inside a reassuring sentence.

## FIX-3 · The table-session gate cached one restaurant's settings for the life of the page — MEDIUM · code-read

- **Where:** backend only, nothing on screen — but it decides the geofence, the table-number range
  and whether a location check is needed for the whole visit.
- **Who is worse off:** a diner whose restaurant resolved a beat after they tapped, at whichever
  restaurant was cached in that window.
- **When:** the gate is mounted in the root layout and survives a move between restaurants; and
  `ridRef.current` is #1's placeholder for the few hundred ms the slug lookup takes.
- **Fix:** the settings are keyed by restaurant id.

## FIX-4 · The order tracker reverted whatever happened while it was waiting for the server — MEDIUM · code-read

- **Where:** guest menu → the floating live-status strip, and the bill's Live-status tab. The diner
  drags the strip away to hide it and it comes back; or an order the phone saved offline finally
  sends, is recorded, and then disappears from their list although the kitchen has it.
- **Who is worse off:** the diner, who loses sight of an order that is really being cooked.
- **When:** any status poll that spans a concurrent write — the poll reads the list, makes one
  network call per order, then wrote back the copy it had read. Every other writer of that list
  reads and writes in one synchronous step, which is why only this one is affected.
- **Fix:** the poll now remembers only what it learned, keyed by order id, and applies it to a fresh
  read. An order that has since left the list is not resurrected.

## FIX-5 · Clearing the table number in the waiter popup left it waiting in the bill — LOW · code-read

- **Where:** guest menu → the "Need something?" waiter popup → the ✕ on the table box. The number
  looks cleared, but opening the bill shows it still sitting in the table field.
- **Who is worse off:** a diner correcting a wrong table — their food can still go to the table
  they were trying to get away from.
- **Fix:** the ✕ announces the wipe (`lfh:table-scanned`), and the bill lets go of a number that was
  only ever a prefill — never one the guest typed into the bill itself.

## FIX-6 · The returning-guest greeting asked about the placeholder restaurant — MEDIUM · code-read

- **Where:** guest menu → the "Welcome back, <name> 👋" toast a moment after the menu opens.
- **Who is worse off:** a diner at restaurant B greeted by name off restaurant A's customer record —
  one restaurant's customer showing up on another's menu.
- **When:** when the slug lookup takes longer than the greeting's 1.8-second delay (a slow first
  load), which is exactly what the context's `ready` flag exists for; this was the one
  restaurant-keyed network call that did not wait for it.
- **Fix:** wait for `ready`.

## FIX-7 · "Order the rest" could refuse and say nothing — LOW · code-read

- **Where:** guest menu → the "1 order couldn't send" chip (bottom-left) → the list → the
  "Order the rest" button on a saved order that one sold-out dish blocked.
- **Who is worse off:** a diner who has already waited, tapping a button that does nothing.
- **When:** `orderRestWithout` also refuses when it cannot identify the line to drop, or when
  nothing is left afterwards — it returns `{ ok:false }` and the handler discarded it.
- **Fix:** read the result; say so when it could not work it out, and leave the order in place so
  "Try again" is still there.

## FIX-8 · `npm run verify:closed-session` was dead on `origin/main` — MEDIUM · confirmed

- **Where:** backend only, nothing on screen. A guard the sweep prompt names as a gate.
- **What:** `scripts/verify-closed-session-orders.mjs` calls `refuseUnlessDevTestDb(...)` and never
  imported it, so the whole guard died with a `ReferenceError` before running one check. It looked
  like it existed and proved nothing.
- **Fix:** the missing one-line import. It now runs and passes its 7 checks.
- **Note:** this file is outside the territory list; §7 of the rules explicitly covers extending and
  repairing `verify:*` guards, and I could not honestly report the gate as passing otherwise. Called
  out separately in the PR body.

---

## 🔗 HANDOFF — `scripts/verify-order.mjs` (not my territory)

`npm run verify:order` **fails on `origin/main`** and this branch alike, for a reason that has
nothing to do with any guest file. Its step 4 cleans up its own test order with

```sql
DELETE FROM orders WHERE id = '<the order it just placed>';
```

and the billing-compliance trigger `lfh_block_issued_delete()` now refuses that:

> `lfh: an issued bill cannot be hard-deleted — soft-delete it (deleted_at) instead`
> `HINT: Corrections use void / soft-delete; permanent erase only via the 90-day restaurant purge.`

The trigger is right and must not be weakened — the compliance rule is "a sale can be cancelled, a
sale can never disappear". The guard's cleanup is what has to change, to the route the trigger's own
hint names:

```sql
UPDATE orders SET status = 'cancelled', deleted_at = NOW() WHERE id = '<id>';
```

I did **not** make that change: it is another terminal's file and it is a compliance-adjacent
decision about how a test disposes of a sale row, which the owner should sign off rather than a
sweep terminal deciding alone. (I hit the same wall cleaning up my own probe rows and used exactly
that compliant route.)
