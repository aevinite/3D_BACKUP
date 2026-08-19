# T11 improvements — the owner's reports & charts

Four ideas. **None was built.** Every one either has a genuine trade-off either way, or lives in
another terminal's files — §6 of the sweep rules sends both of those to the owner rather than to me.
The four real problems inside my territory were fixed instead; they are in `T11-findings.md`.

---

## 🟡 I1 · Say "the amount was not recorded" instead of "No payments recorded"

**Where:** owner panel → Reports → Day summary → the "Settlement · how the money arrived" panel.

Today, when the settlement rows come back with bills against them but ₹0 of money, the panel filters
every row out and prints **"No payments recorded."** — directly beside a "TOTAL COLLECTED" tile
showing real money. On 15 Aug that was "Total collected ₹3,969 / Paid bills 9" next to "No payments
recorded".

The honest line would be *"9 bills settled — the amount against them could not be read."* That is a
sentence an owner can act on, and it would have made H1 visible on day one instead of reading like a
quiet day.

**If yes:** a half-read settlement announces itself instead of impersonating an empty one.
**If no:** once H1 is fixed this case becomes rare, but it can still happen on any read failure, and
it will read as "nobody paid".
**Why I did not build it:** it is a user-visible TEXT string, and text strings anywhere in `app/` are
explicitly **T27's** territory this sweep. It is also arguably the wrong place to fix a database
fault. Hand to T27 once H1 has landed.

---

## 🟡 I2 · Extend the all-zero snapshot guard to the FORCED path

**Where:** backend only, nothing on screen — `lib/ownerCache.ts` (my own file).

The cache already refuses to overwrite a good snapshot with one whose every money figure has
collapsed to zero (`collapsedToZero`, the improvement added 2026-08-12 after invented ₹0s outlived a
blip by hours). But that guard only runs on the BACKGROUND path. A **forced** read (the Refresh
button) sets `existing = null` before reading, so it never loads the previous payload and can never
compare — meaning a Refresh pressed during a database blip can store an all-zero payload over a good
one, and every other viewer sees ₹0 for up to five minutes with no note.

Refresh is also the button he presses *because* something already looks wrong, so it is the worst
path to leave unguarded.

**If yes:** a blip during a manual Refresh can no longer freeze ₹0 onto everyone's dashboard. The
caller still receives exactly what was computed — the guard only ever declines to *store*.
**If no:** the gap stays; nobody has observed it, so this is prevention, not a repair.
**Cost:** one extra indexed row read on the forced path (already the slow path).
**The real trade-off, and why this is your call:** a restaurant that genuinely took ₹0 and pressed
Refresh would keep serving the older non-zero row to other viewers until the next open. The
background path already accepts that trade; extending it is consistent, but it is a deliberate choice
about which wrong answer is safer, and §6 says that is yours.
**Effort:** ~15 minutes. **Risk:** low, contained to one function.

---

## 🟡 I3 · Give the money charts a real zero line, so a negative can never be silently clipped

**Where:** owner panel → Reports → any chart — most visibly **Sales → "Revenue over time"** and
**Tax / GST → "Tax over time"** on the 12-month / FY / All-time periods.

Bar charts here are zero-based and line charts clamp their lower bound to 0
(`fitDomain`, `Math.max(0, min - pad)`). That is deliberate and right for revenue. But it means a
NEGATIVE value is drawn outside the plot and simply disappears. Today that is not hypothetical: the
current month's tax really is **−₹3,55,394** (see H1), and the chart shows nothing at all for it
rather than showing something wrong — which is arguably the safer failure, but it is silent.

**If yes:** a money chart can never hide a negative figure; a refund-heavy or credit-note month would
be visible rather than absent.
**If no:** nothing breaks, and once H1 is fixed no negative should occur in normal trading.
**Why I did not build it:** it changes how **every** chart in the console looks (a zero line and a
downward bar), which is a design decision, not a repair — and design work goes through the UI/UX
skill and your eye, not a sweep terminal. It would also have masked H1 while I was proving it.
**Effort:** ~1 hour plus a look at every affected chart. **Risk:** medium — it touches the shared kit.

---

## 🟡 I4 · Make the phone controls on Reports a comfortable size

**Where:** owner panel → Reports on a phone → the period dropdown ("30 days"), the hub's "Report"
button, and the Day summary's "Today" / "Yesterday" buttons.

Measured at Samsung A35 (360×780): period control **31px**, Report **30px**, Today/Yesterday **27px**.
Common guidance is 44px.

**If yes:** the controls he taps most on his phone get comfortable.
**If no:** nothing breaks — I drove 20 real touch taps on the day buttons and 12 on the period
control and **every single one landed**. This is comfort, not failure.
**The trade-off:** on a 780px-tall phone, taller controls push the first KPI card further down, and
the day sheet already needs a scroll to reach the settlement panel.
**Why I did not build it:** sizing of styled-jsx / CSS anywhere in the app is explicitly **T26's**
territory this sweep, and it is a taste call either way.
**Effort:** ~20 minutes. **Risk:** low, but it moves the fold on every Reports screen.
