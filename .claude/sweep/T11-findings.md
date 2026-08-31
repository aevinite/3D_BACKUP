# T11 findings — the owner's reports & charts (sweep #7, 2026-08-27)

Branch `sweep7/t11-owner-reports` · worktree `../wt-s7-t11` · port **4211, a PRODUCTION build**
(`npm run build` + `next start`, not a dev server — see F0). Restaurant read: **French House**.
**Nothing was written to any restaurant.** Aangan untouched. Every check is a READ.

Ledger: `.claude/sweep/LEDGER/T11.md` — all 500 sweep-#6 rows re-run in place, plus 500 new rows
`P20101`–`P20600`. **No regression.** Six problems found, all six fixed on this branch, each its own
commit with its item number in the message.

---

## F0 · The method note that has to come first

A dev server **never hydrates with the network cut** — the page is a dead SSR snapshot. My first
offline pass on `npm run dev` therefore "found" a screen with no React at all, and it would have been
filed as a product fault. Every offline row in this sweep was re-driven against a real production
build before anything was believed. `public/sw.js` says so in its own comment ("Dev gets network-first
for everything"); it costs one `npm run build` to obey it.

---

## Item 1 · On a phone, the buttons you MOVE with were still small — FIXED

`components/owner/reports/kit.tsx`. The 2026-08-18 pass raised the control strip to 44px and stopped.
Re-measured on an A35 (360×780), every screen, both skins: `← All reports` **23px** (the only way back
to the hub), the sub-tab strip **34px**, the day sheet's `Full report →` **22px**, the overlay ✕
**32px** — under a row of 44px buttons. Nothing was broken; the taps land. It is consistency.
Raised the four NAVIGATION controls only. The in-chart Bar/Line pill (22px) and the Items
By revenue / By quantity pill (38px) are deliberately left for the owner — 44px there adds ~26px to
every chart card on a 780px phone, which is a look decision. Desktop re-measured unchanged (23/34/34).
Guard: `verify:owner-reports` → "…and so are the controls you MOVE with".

## Item 2 · The Payments report said "1 bills settled" — FIXED

`app/owner/reports/page.tsx`. TOTAL COLLECTED read "1 bills settled" and TOP METHOD "· 1 bills" on any
period settled by a single bill, while the day sheet's settlement rows one click away read "1 bill".
The 2026-08-17 pass fixed the same fault on the Busy-times and Times-of-day tiles — it was written for
the word *orders*, and these two say *bills*. Verified on the rendered screen with the payload held to
one bill (client side only, nothing written): "1 bill settled".

## Item 3 · The guard that should have caught item 2 watched one word — FIXED

`scripts/verify-owner-reports.mjs`. "no count on the Reports page is followed by a bare 'orders'" now
has a sibling covering every plural this file counts (orders, bills, days, people, payments, items,
dishes, months, hours).

## Item 4 · The day sheet's settlement was a DIFFERENT DAY from its own total — FIXED (migration 367)

**The big one.** `supabase/migrations/367_the_settlement_reads_the_same_day_the_money_does.sql`.

A restaurant's day runs 05:00 → 05:00 IST and the whole console agrees. But `orders_daily_agg.day` is
the IST **calendar** date (mig 190), so the rollup cannot answer a 05:00 window.
`lfh_owner_sales_report` fences exactly this (rollup only on a month bucket), which is why the day
sheet's MONEY was right. `lfh_owner_payment_breakdown` had **no fence at all**, so the Settlement panel
underneath that money silently answered for the calendar day.

Measured on French House, forced recompute each time:

| business day | Total collected tile | Settlement panel | the calendar day |
|---|---|---|---|
| 20 Aug | ₹12,558 (13 bills) | ₹9,660 (10) | ₹9,660 (10) |
| 21 Aug | ₹31,773 (31) | ₹5,796 (6) | ₹5,796 (6) |
| 22 Aug | ₹94,952 (118) | ₹1,23,386 (145) | ₹1,23,386 (145) |
| 23 Aug | ₹0 (0) | ₹441 (1) | ₹441 (1) |

The Settlement column is the calendar day **exactly**, all four — that is the mechanism, not a
coincidence. 23 Aug read worst on screen: a ₹0 sheet with Cash ₹441 listed under it. Today always
agreed, because today is past the rollup watermark and answered by the live tail — which is why this
never showed on the day you were looking at while it happened.

Also reached **Reports → Payments on Today / Yesterday** and the **Dashboard's payment-method card**:
one function, three screens.

After: all four agree to the rupee AND to the bill count. On screen, 22 Aug reads ₹94,952 in the tile,
₹94,952 at the foot of the money-flow lines and ₹94,952 at the foot of the settlement, over
90 + 27 + 1 = 118 bills. Every IST-midnight window (7d, 30d, this/last month, 12m, FY, all time, every
custom range) still reads the rollup, re-verified unchanged. Not one stored bill is rewritten.
Guards: three new checks in `verify:owner-reports` T11-C.

## Item 5 · The downloaded Payments file listed Cash twice — FIXED

`components/owner/reports/sectionExport.tsx`. The CSV/Excel/Print file carried
`Cash,274,316864` and `Cash,2,525` two lines apart, where the screen shows one row of ₹3,17,389.
French House really stores both "Cash" and "cash"; the screen merges, the export ran the raw rows
through `canonPayMethod` for the **label** and stopped — the exact bug fixed on screen on 2026-08-17,
still in the file. The totals always reconciled, which is why it survived. The file now also carries
the % share, the average bill and a Total row, so it is the same report as the screen.
Guard: four checks in a new `verify:owner-reports` T11-F section.

## Item 6 · With no internet, Reports said the restaurant took ₹0 — FIXED

`app/owner/reports/page.tsx`. On a production build with the network cut, the hub printed
**₹0 · NET SALES ₹0 · PAID BILLS 0 · AVG BILL ₹0 · GST ₹0 · DISCOUNTS ₹0**, headed
"ALL RESTAURANTS", with the chart explaining *"Not enough data yet — a trend needs activity on more
than one point in this period, come back once there's a bit more."* That sentence is about the
RESTAURANT and it was false. The only admission was "— couldn't load" at the end of a caption.

The real answer — ₹13,42,142 — was in that tab's own storage the whole time. The scope comes from
`/api/owner/overview`; offline that answers `{ error: "offline" }`, so the restaurant list came back
empty and the scope stayed blank — and **every cache key on this page carries the restaurant id**. The
page looked for the figures of "no restaurant".

Fixed by falling back to the scope (and the name) this device last saw, **only** when the restaurant
list cannot be read — so the owner's "Reports always opens on All restaurants" rule is untouched on a
good connection. **No second warning bar**: the app's own offline notice was already on screen; a first
draft added one and there were two bars saying one thing.

After, offline: headline ₹13,42,142, all five tiles real, "MY LITTLE FRENCH HOUSE · 30 DAYS", the chart
draws, one amber bar, and opening Sales from the hub gives the full report with all 26 rows of the
by-period table. Online: unchanged.
Guard: four checks in a new `verify:owner-reports` T11-G section.

---

## HANDOFF · not mine to fix, and it is real

**The manager's Z-report calls a Cash bill "Not recorded".** `app/api/editor/[...path]/route.ts`
(T10's territory). Its day-close query is

```
.select("id,session_id,subtotal,taxable_base,nontax_amount,mrp_amount,tax_rate,discount,status,payment_status,tip")
```

— **`payment_method` is not in the list**, and the code below reads `o.payment_method` five times. So
every bill not settled in parts is labelled "Not recorded" in the till count, and
`onHouseCount`/`onHouseNet` are permanently 0 (which also means an on-the-house bill falls into
`paidCount`/`paidNet` — reasoned from the code, not measured, because no on-the-house bill fell on the
business day I could observe).

**Measured, same business day, same window** (`since` = 2026-08-25T23:30Z = 05:00 IST):
manager Z-report **"Not recorded" ₹1,932 / 4 bills** · owner day sheet **"Cash" ₹1,932 / 4 bills**.
The money and the count agree; the NAME does not. For a manager counting the till at close, "Not
recorded" means "nobody wrote down how this was paid" — an action item that is not real.

One line to fix. It belongs to whoever owns `app/api/editor/**`.

---

## Withdrawn, recorded so nobody re-files it

- **"The owner Dashboard is ₹25 lakh above Reports on all time."** It is not. That was a **stale
  analytics snapshot on my own side**. Forcing a live recompute on both sides gives ₹1,70,52,368.35 on
  both, and they match on all seven ranges I checked. A cross-panel money comparison MUST pass
  `refresh=1` to both sides or it is comparing two clocks.
- **"An inverted custom range invents money."** `windowFor()` documents "bad input falls back to the
  last 30 days", and the page refuses to fetch an inverted range at all (`customOk`). Deliberate,
  unreachable from the UI.
- **"The Payments table's swatch does not match the donut."** The donut deliberately drops a method
  that collected ₹0 (a zero-width wedge is not a slice). Every method with money in it matches.
- **"Browser Back does not close the Cancellations overlay."** It does. A **deep link** opens the
  report and the overlay in one commit, so one Back closes both — and the person-path (Payments →
  the Cancellations box → Back) closes the overlay and leaves the report open, verified.

---

# THE OWNER'S FOLLOW-UP — 2026-08-30

He read the report and answered: *"for the fifth with no internet, you can just say there is no
internet or if it was loaded previously you can show the previously and write a note on the top. The
internet is not available. This is not the current data. You can do number seven, you can do number
nine and I give you permission for number 10."*

**Item 5 — reshaped to his sentence.** The note is now the first element on the Reports page and says
which of the two situations he is in: *"The internet is not available. This is not the current data —
these are the figures saved on this device, from 3 min ago."* or *"…Nothing has been saved on this
device for this period yet, so there is nothing to show."* With nothing saved every figure is a DASH,
not a ₹0, and the chart draws nothing rather than saying "Not enough data yet — come back once there's
a bit more", which is a sentence about the restaurant and was untrue. **I had got this wrong the first
time**: I removed my own note because the app's bar at the bottom already said something similar. His
correction was right — that bar is about SAVING work, not about the figures, and it is at the bottom.

**Item 7 — done.** The Bar/Line pill (22px) and the Items By-revenue/By-quantity pill (38px) are 44px
on a phone. Exactly one tappable is left under 44px anywhere on Reports: the dish search box at 36px,
a text field whose height is set in another component's own styles.

**Item 9 — done, with his permission to touch the manager panel's file.** One column added to the
Z-report's day-close query. The till list names Cash / UPI / Card / Pay later where it previously said
only "Not recorded", and bills settled in parts are now correctly left to their own payment legs.

**Item 10 — both tests run, and both of this ledger's long-standing `⏭` rows are closed.**
Each writes to French House and restores the exact prior value in a `finally` **and** on
`SIGINT`/`SIGTERM`, then re-reads the row to prove it. Aangan untouched.
- **Composition scheme (`P05191`)**: the Tax report shows the sentence and two tiles only — no
  Effective-rate tile, no Taxable-sales tile, no zero-value CGST/SGST table.
- **Entitlement flip (`P05482`)**: the Inventory card is absent → present → absent, and with the
  module off the deep link refuses honestly (API 403, a plain sentence on screen, zero tiles, zero ₹,
  zero rows).

## Two things I found while doing them, and did NOT fix

1. **The manager's till list can total more than the day's takings.** Same block as item 9, a
   different bug. Measured in one moment: the till list totalled ₹14,301 while the day's takings were
   ₹12,369. The legs loop adds every non-reversed payment leg with no check that the bill is PAID, so
   a table that has part-paid and is still open is counted as money collected — I watched one do it
   (session `7e261230`, three legs on an unpaid bill). Item 9's fix does not touch this and does not
   make it worse: before the fix the skip could never fire at all. It needs its own decision.
2. **`verify:ledger-index` is RED on `origin/main`, and it is not mine.** `T12.md` uses `P05992` and
   `P40435` on two phase rows each. Proven pre-existing by re-running the guard with T11's file
   replaced by `origin/main`'s copy. Not repaired here — this project's own rule is "never renumber
   anyone else's". Noted in `INDEX.md` so the next terminal that sees it red does not lose an hour.

---

# ROUND 2 — THE WHOLE TERRITORY, 2026-09-01

He asked for a fresh 500 that "should contain every single bit of thing in the boundaries", after
items 1–11 went live on backup. Round 1 covered the three files the prompt named; **round 2 covers
all eleven files the Reports Studio is actually made of**, including the six under
`components/owner/reports/` that no terminal's bullet has ever named (1,856 lines between them).

**609 assertions executed against a production build, condensed into 500 numbered rows
(`P49001`–`P49500`). All green. One problem found.**

## Item 12 · Four reports downloaded a DIFFERENT report — FIXED

Owner → Reports → Export → CSV / Excel / Print. The file was headed with the report you were
looking at and filled with another one. Measured on 30 days, French House:

| report | what the screen shows | what the file contained |
|---|---|---|
| Times of day | Morning / Afternoon / Evening / Late night | 24 hourly rows |
| Day of week | Monday…Sunday, days counted, avg/day | dated by-period rows (3 Aug, 4 Aug…) |
| Which dishes earn | Dish · **Group** · Sold · % units · Sales · % sales | the plain dish list, no grouping at all |
| Average bill | …Total collected · **Avg bill** · Cancelled | the same table **without** the Avg bill column |

One cause: **the export branched on the payload SHAPE, and several reports share one.** By-hour and
Times-of-day are both `hourly`; Day-of-week and Average-bill are both `money`. So the first report
of each shape decided what everybody got, under everybody's heading. Nothing looked broken — proper
title, real numbers, correct totals — which is why it survived every sweep so far.

Fixed by telling the export which BODY is on screen, and by moving the groupings (`DAYPARTS`, the
weekday names, the IST weekday helper) out of `page.tsx` and into `kit.tsx` so **one definition**
feeds both the screen and the file. They were unreachable from the export before, which is precisely
how the two came to describe different things.

Verified by downloading all four and comparing row by row with the screen: Morning 714 / ₹1,00,334 /
27.2% · Monday 2 / 69 / ₹39,312 / 10.7% / ₹19,656 · Pink Pineapple Smoothie / Star / 717 / 20.3% /
₹2,10,156 / 57.0% · Avg bill ₹498 on 3 Aug — every one identical.

Guard: a new `T11-I` section in `verify:owner-reports` (125 → 133 checks).

## What round 2 found NOT to be faults

- **`kit.tsx` says its CSS is "scoped to `.rs-root`" but really scopes by the `rs-` class prefix.**
  Checked what that would actually break: no file outside the studio wears an `rs-` class, and the
  one component that emits `rs-` markup from outside the folder (`Charts.tsx`) is only ever rendered
  inside the Reports page. Loosely worded, correct in effect.
- **The totals row disappears while a search is active in a long list.** Deliberate — a total of
  everything under a filtered list would be a lie. Drove it: the row returns the moment the search
  is cleared.
- **A day-kind export's filename carries the date twice** (`day-summary-2026-08-31-2026-08-31`).
  That is the period and the generated-on date, both of which belong in the name.
- **The Times-of-day printed sheet is exactly one page.** It has four rows. A short report is short;
  what matters is that it is not CLIPPED, and it is not.
