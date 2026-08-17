# T10 improvements — guest & staff-panel API routes (phases P04501–P05000)

Two 🟢 built in this branch (both inside the territory, both small, neither needing a migration,
a screen, a module or a permission). Four 🟡 listed for the owner to decide, with a
recommendation on each.

---

## 🟢 BUILT

### I1 — a blocked person keeps the one button they are allowed to press

* **Where** — the admin sign-in screen (`/staff-login`) when the admin has blocked this device →
  the "You're blocked" card. What he would SEE: the note box and the **Request unblock** button go
  grey, with "0 left today" under them, after a few taps of Retry.
* **What it is** — the Retry button re-asks `/api/blocked`. That read has a ceiling of 20 a minute
  (improvement I3, 2026-08-12), and when the ceiling is hit it answered `remaining: 0`.
  `BlockedView.tsx` computes `outOfTries = remaining <= 0`, so it disabled the textarea AND the
  button — taking away the only thing a blocked person is allowed to do, and telling them a number
  that was never actually counted.
* **Why it is reachable** — the counter is keyed by the device cookie if there is one and otherwise
  by the server-derived IP, so a restaurant behind one connection shares this bucket across every
  device on it. A manager and two waiters all checking after a block reach 20 a minute far sooner
  than one person tapping would.
* **What changed** — the throttled answer now says "we didn't count, so assume none used"
  (`remaining: MAX_PER_DAY`) instead of "you have none left". The REAL cap is untouched and is
  enforced where it always was — on the POST, which does its own count and refuses closed on doubt
  (T9 F25). Nothing here can hand out a fourth request.
* **Size** — 2 lines of code, ~14 lines of comment. **Risk** — none: it only loosens a display
  number on a degraded path; the enforcing half is unchanged.
* **Guard** — `verify:panel-api` → "the throttled /api/blocked answer leaves the ask-to-be-unblocked
  button usable", plus the paired check that the POST still fails closed.

### I2 — a queued "call the waiter" now gets the same "wait this long" a queued order already gets

* **Where** — backend only, nothing on screen: `/api/guest/call-waiter`, the door a phone uses to
  deliver a waiter-call it saved while it had no signal. What he would SEE, indirectly: during a
  rush the restaurant's server stops being hit by every waiting phone on the same beat.
* **What it is** — when the server can't answer, this route replied `502 { reason: "server_busy" }`
  and nothing else, so the phone fell back to its own fixed timer. `/api/guest/place-order` was
  given a server-set, jittered wait for exactly this a fortnight ago (improvement I10, owner
  2026-08-12), and its own comment states the reasoning: *"every waiting phone comes back at the
  same moment, on the same timer, and lands on the server that was already struggling — the retry
  storm makes the rush it is reacting to worse."*
* **Why a CALL needs it more than an order** — calling a waiter is what a diner does when something
  is wrong, so it is the most re-tapped guest action there is. And the two share one queue:
  `lib/guestOutbox.ts` drains orders and calls in a SINGLE loop and reads the hint generically
  (`if (j?.retryAfter != null) noteServerRetryAfter(j.retryAfter)`, before any branch) into a shared
  backoff. So the same rush taught the phone to back off or not, depending purely on which of the
  two the diner happened to have tapped.
* **What changed** — the same `busy()` helper place-order uses: `retryAfter` in the body and a
  `Retry-After` header, jittered 20–45s **on the server** so a thousand phones get a thousand
  different answers.
* **Nothing on the device changes** — the field is already read, generically, by code that shipped
  on 2026-08-12. It is a HINT: a build that ignores it keeps its existing schedule and is exactly as
  correct as before.
* **Size** — ~10 lines of code (2 call sites + one helper). **Risk** — none: it adds a field to a
  refusal. `npm run verify:order-retry` (51 checks) still passes.
* **Guard** — `verify:panel-api` → "tells a queued phone how long to wait" + "jitters that wait
  server-side", asserted on BOTH guest routes so they cannot drift apart again.

---

## 🟡 NOT BUILT — these need a decision from him

### I3 — the purchase form lets you add the same ingredient twice with no warning

* **Where** — manager panel → Inventory → 🧾 New vendor bill / ⚡ Quick cash buy → the "+ item…"
  row. What he would SEE: two "Tomatoes" lines on one bill, with nothing saying so.
* **Why not built** — the file is `public/panels/editor/inventory.js`, which belongs to another
  terminal. (The SERVER half of the damage this caused is fixed here — finding F4 — so the stock
  ledger is now correct either way. This is only about warning the person.)
* **If yes** — the form either merges the two lines or shows "Tomatoes is already on this bill —
  add to it?" before accepting a second one. **If no** — nothing breaks now that F4 is fixed; the
  bill just carries two lines for one ingredient, which is a legitimate thing to want.
* **Effort** ~30 min. **Risk** low. **Recommendation** — LOW priority, and possibly leave it: two
  lines at two rates is a real thing a real bill does. The fault was ours, not the form's.

### I4 — an old saved guest order with no restaurant still lands on restaurant #1

* **Where** — backend only, nothing on screen: `/api/guest/place-order` and `/api/guest/call-waiter`.
* **What it is** — a body that names a MALFORMED restaurant is refused (correctly). A body that
  names NONE AT ALL still falls back to restaurant #1 — kept on purpose for the single-restaurant
  shape these routes shipped with. On a stack serving many restaurants, an order saved on a phone by
  a build old enough to predate that field would replay onto #1's floor and #1's books.
* **If yes** — refuse a body with no restaurant, and the diner is told to order again. **If no** —
  the fallback stays; it is only reachable by a phone carrying a genuinely ancient saved order.
* **Effort** 10 min. **Risk** — the trade is real in both directions: refusing loses a legitimate
  legacy order; keeping it can put one restaurant's money on another's books.
* **Recommendation** — MEDIUM. I would refuse it, because "money on the wrong restaurant's books" is
  the failure this file has already been fixed for twice; but it is his call, because it is his
  legacy shape.

### I5 — a device blocked by staff can still READ the kitchen board

* **Where** — kitchen panel → the pass. What he would SEE: a screen he has blocked still showing
  live tickets, though it can no longer act on them.
* **What it is** — every WRITE checks `deviceBlocked(dev, rid)`; the board READ does not. So a
  blocked kitchen screen keeps displaying orders and can only be stopped by taking it off the wifi.
* **If yes** — a blocked device sees the same "blocked by staff" refusal on the board that it
  already gets on every button. **If no** — nothing breaks; a blocked screen is a read-only screen.
* **Effort** 15 min. **Risk** low, but it is a behaviour change on a live panel.
* **Recommendation** — it is a product decision, not a fault: blocking has always meant "you can't
  DO anything", and a cook staring at a dead board may be worse than one who can still read it. I
  would leave it and only change it if he wants a blocked device to go dark completely.

### I6 — the delivery-app webhook has no flood ceiling

* **Where** — backend only, nothing on screen: `/api/aggregators/webhook/<zomato|swiggy>`, the one
  door an outside company posts through. Dormant today (the `aggregators` flag is off).
* **What it is** — the body is capped at 64 kB (T9 I4) but the request RATE is not, so an
  unauthenticated caller costs one small database read per request before the shared secret is even
  checked.
* **Recommendation** — **do NOT build this**, and I am listing it only so the next sweep does not
  "discover" it and add one. A naive cap on an inbound aggregator webhook drops REAL ORDERS during
  the exact lunch rush a busy outlet needs it most, and a lost Zomato order is a customer with no
  food. If it ever needs a ceiling it has to be per-outlet and generous, decided with the real
  traffic numbers in front of us — not guessed at now, on a route nobody is calling yet.
</content>
