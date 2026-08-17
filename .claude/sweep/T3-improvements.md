# Sweep 6 — T3 improvements (guest basket · table session · placing an order)

## 🟢 Built in this branch

Both were folded into the fixes they belong with rather than shipped as separate changes, because
each is the honest completion of one:

1. **The failure reason for a request to staff is TOASTED, not only written into `note`.**
   Three of the five screens that can send one (`waiting_approval`, `denied`, `table_closed`) never
   render `note`, and `location_help` renders it inside a reassuring sentence — so a message written
   there would have been invisible on three screens and misleading on a fourth. Part of FIX-2.

2. **The bill lets go of a table number that was only ever a prefill.**
   Two ✕ buttons wipe the device-wide remembered table (the waiter popup's and the session gate's);
   the bill only ever FILLED from that memory, never released. It now drops the number when it still
   holds exactly what was remembered, and never touches one the guest typed into the bill itself.
   Part of FIX-5.

## 🟡 Not built — these need a decision from the owner

3. **The saved-orders chip disappears after a reload with no signal.**
   The chip is a lazily-imported chunk. In production the service worker caches `/_next/static/`, so
   it should come back; in dev there is no service worker and it does not. The order itself is
   completely safe either way (proved: it survives in the phone's storage and sends on reconnect) —
   this is only about whether the diner can SEE it during that window. Confirming it on the deployed
   site, and precaching the chunk if not, is a service-worker change (`public/sw.js`) outside this
   territory.
   · **If yes:** a diner who reloads while offline still sees "1 order waiting to send".
   · **If no:** nothing breaks and no order is lost; they just have no window onto it until the
   signal returns. · **Effort:** ~1 hour including a deployed check. · **Risk:** low, but it touches
   the service worker, which is the one file where a mistake is served from cache for a long time.

4. **The "Maximum 99 per dish" message reads as a success.**
   It is raised with no `variant`, so it renders with a tick like a confirmation, for something that
   is a refusal. Deliberately identical to the wording on the dish card, which is why I did not
   change it unilaterally — matching those two was itself an earlier decision.
   · **If yes:** the ceiling reads as a limit rather than a confirmation. · **If no:** nothing
   breaks; it is a small wrong-signal moment on a screen almost nobody reaches. · **Effort:**
   ~10 minutes, in two files. · **Risk:** none, beyond re-opening a settled wording choice.

5. **`OrderTracker` has the same `refresh()` effect registered twice.**
   Two `useEffect(… , [restaurantId])` blocks both call `refresh()`. Harmless — one extra read of
   localStorage per restaurant change — and no person could ever notice, which is exactly why the
   rules say to leave pure tidying alone. Listed only so the next sweep does not "find" it.
   · **If yes:** one fewer redundant effect. · **If no:** nothing breaks. · **Effort:** 2 minutes.
   · **Risk:** none.
