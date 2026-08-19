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

## 🟢 Closed after checking (owner asked, 2026-08-18)

3. **The saved-orders chip disappears after a reload with no signal — CHECKED ON THE LIVE SITE, NO
   CHANGE NEEDED.** Measured on `3-d-backup.vercel.app`, guest menu, A35 emulation, offline: the
   service worker is registered and controlling the page, the caches present are
   `lfh-fallback-v9 / lfh-shell-v9 / lfh-asset-v9 / lfh-data-v9`, and after an offline reload the
   chip **renders** ("1 waiting" also shows in the header badge) with the order still in the phone's
   storage. The chip's lazily-imported chunk comes out of `lfh-asset-v9`, which is exactly what that
   cache exists for. Its absence in dev is the dev server registering no service worker — an artefact
   of how it is being tested, not a product fault. **Do not "fix" `public/sw.js` for this and do not
   re-report it.**

### Nothing is still 🟡 — everything below was built (2026-08-18/19)

4. **The "Maximum 99 per dish" message reads as a success.** — **BUILT 2026-08-18** (see below).
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


## 🟢 Built 2026-08-18, on the owner's instruction to finish what was left

6. **"Maximum 99 per dish" is no longer stamped with a success tick.** Both copies (the bill's "+"
   and the dish card's "+") raised the toast with no `variant`, so `ToastHost` fell back to
   `success` and drew a green ✓ on something that had just refused to happen. Both now pass
   `variant: "info"` — a neutral • — because nothing went wrong and there is nothing to fix: the "+"
   simply has a ceiling and the message says so. Changed in BOTH places in the same commit, since the
   whole point of these two strings is that the bill and the card explain the same limit identically.

7. **`npm run verify:order` no longer breaks the billing-compliance rule to clean up after itself.**
   It placed a test order and finished with a hard `DELETE`, which the append-only trigger correctly
   refuses — so the guard died on its own last step and had been red for that reason alone. It now
   retires the row the way the law allows and the trigger's own hint names: cancel, then soft-delete
   with a reason, line items removed, the order row kept and dated. It then **asserts that a hard
   delete of that row is STILL refused** — so if anyone ever weakens the safeguard, this guard is
   what goes red. The safeguard itself was not touched.
