# T11 findings — the owner's reports & charts

> **UPDATE 2026-08-19 — all three handoffs below are now FIXED and merged** (PR #1016, `e1060db1`),
> at the owner's instruction, along with both improvements. Terminals 16–30 never ran, so
> `supabase/migrations/` and `app/globals.css` were unowned — nothing was taken from another
> terminal. Migration **337** names the union columns explicitly; the print block resets `html/body`
> at `html[data-staffdark="1"]` specificity; the phone controls are 44px. Pass 3 re-ran the whole
> suite against merged main: **184 automated assertions + 103 static guard checks, 0 failures.**
> Every day now returns exactly `SUM(net_amount)` from the bills, and the settlement reconciles to
> the rupee. Details in `LEDGER/T11.md` → "PASS 3".

**Phases:** 500 / 500 (P05001–P05500) · pass 2 = 494 ✅ · 6 ⏭ (each with a written reason)
**Problems:** 7 — **3 high**, 3 medium, 1 low.
**Fixed in `sweep6/t11-owner-reports-charts`:** 4 (every one that lives inside T11's territory).
**Handed off:** 3 — the three HIGH ones share a single root cause and live in T23's files; browser-print
lives in T26's; the A35 control heights are a size question, also T26's.

Everything below was proved by driving the real Reports Studio on port 4111 as the diag owner
(French House) and by read-only queries against the backup database — not by reading alone.

---

## 🔴 H1 · HIGH ×3 · confirmed at the database AND on screen — 🔗 HANDOFF to **T23** (`supabase/migrations/`)

**This is sweep #5's F1/F2/F3. It is still unfixed on `origin/main`, and it is the single most
valuable thing in this territory.** I could not fix it myself: the root cause is three SQL function
bodies in `supabase/migrations/`, which is T23's territory this sweep (files 231→newest). §1 of the
sweep rules is explicit that the fence works both ways, so this is a handoff with the exact change,
not an edit.

### The root cause, in one paragraph

Three report functions are built the same way: a `hist` block reading the pre-summed rollup for older
days, and a `tail` block reading today's and yesterday's live orders, glued with
`SELECT * FROM hist UNION ALL SELECT * FROM tail`. In all three, `hist` lists its columns
**… net, dpg …** and `tail` lists the same two **… dpg, net …**. A `UNION ALL` in Postgres takes its
column NAMES from the FIRST branch only, and the wrapper then sums them **by name** — so every row
that came from the live tail has its revenue and its grossed discount swapped.

| function | file | `hist` | `tail` |
|---|---|---|---|
| `lfh_owner_revenue_timeseries` | `321_the_sweep_of_layer_b.sql` | l.209-212 (`net`, `dpg`) | l.223-227 (`dpg`, `net`), stacked at l.239 |
| `lfh_owner_payment_breakdown` | `321_the_sweep_of_layer_b.sql` | l.85-88 (`net`, `dpg`) | l.116-120 (`dpg`, `net`), stacked at l.134 |
| `lfh_owner_sales_report` (month path) | `315_the_rollup_carries_the_net_too.sql` | `hist` | `mtail`, same swap |

`lfh_owner_restaurant_revenue` is built the same way but joins its halves **by name**
(`h.net` / `t.net`, mig 321 l.185-194) instead of stacking them — which is why it is correct, and why
one page can show two different totals for the same window.

### The fix T23 needs to make

In each of the three, make the `tail` (and `mtail`) branch list its columns in the **same order as
`hist`** — i.e. `… , net, dpg, …` — or, better, name them explicitly in the `UNION ALL`
(`SELECT restaurant_id, day, gp, dp, net, dpg, ao FROM hist UNION ALL SELECT restaurant_id, day, gp,
dp, net, dpg, ao FROM tail`) so column order can never decide the answer again. **Nothing about the
stored bills changes** — this is a read path only.

### Proved at the database (read-only, French House, 17 Aug 2026)

Rollup watermark `rolled_through = 2026-08-15`, so 16 and 17 Aug are the live tail:

| IST day | really took (`SUM(net_amount)`) | that day's grossed discount | what the chart returned |
|---|---|---|---|
| 11 Aug (rollup) | ₹441.00 | ₹0.00 | ₹441 ✅ |
| 12 Aug (rollup) | ₹1,517.25 | ₹110.25 | ₹1,517.25 ✅ |
| 15 Aug (rollup) | ₹2,646.00 | ₹0.00 | ₹2,646 ✅ |
| **16 Aug (live)** | **₹1,323.00** | ₹0.00 | **₹0** ❌ |
| **17 Aug (live)** | **₹23,268.00** | ₹0.00 | **₹0** ❌ |

### Proved on the screen

**Owner → Reports → Sales → period "12 months" → the "By period" table**, rendered:

```
Jun 26  4,276  4,276  ₹85,82,560   ₹4,27,469    ₹33,175  ₹89,76,854    123
Jul 26  4,806  4,806  ₹96,97,810   ₹4,82,999    ₹37,825  ₹1,01,42,984  174
Aug 26    691    386  ₹3,66,731   −₹3,55,394    ₹5,530   ₹5,807      1,030
```

Two things sweep #5 did not report:

1. **The GST cell for the current month prints a large NEGATIVE number, −₹3,55,394.** The route
   derives tax as `revenue − (subtotal − discount)`, so a revenue that is really the grossed discount
   forces the tax negative. A negative GST figure on the view the filing table is built from.
2. **The "Revenue over time" chart shows the current month as a completely blank column** — Jun and
   Jul are full-height bars and Aug is nothing at all, for a month that took ₹3,69,511. That is the
   "business falling off a cliff" reading, on screen, today.

**Payments**, forced live (so this is not snapshot staleness):

| window | settlement says | Sales says | the settlement rows |
|---|---|---|---|
| today | **₹0** | ₹8,778 | `Cash 12 bills ₹0`, `Not recorded 2 bills ₹0` |
| 7 days | ₹5,486.25 | ₹15,587.25 | |
| 12 months | ₹1,94,85,381 | ₹1,91,25,645 | |

And the **Day summary for 15 Aug** reproduces sweep #5's exact figures: "Total collected ₹3,969",
"Paid bills 9", settlement `[{Cash, 9 orders, ₹0}]`.

**Why it hides:** on a day with no discount the wrong figure is ₹0, which reads as "no trading yet"
rather than a fault.

**Do NOT patch the display.** The Reports page renders these faithfully; clamping the negative or
hiding the blank column here would make the database fault invisible. Two ledger rows (P05171,
P05193) record that decision so a later sweep does not "fix" the symptom.

---

## 🔗 H2 · MEDIUM · confirmed — 🔗 HANDOFF to **T26** (`app/globals.css`)

**Where:** owner panel → **Reports** → any open report (and the Dashboard) → press **Ctrl+P / ⌘+P**,
or File → Print. He gets one page and then blank/dark pages, and the **"By period" table — the rows
of actual dated numbers — never appears.**

**Measured under print media on port 4111, Sales · 30 days:**

```
media=print   reportHeight 1943   lastRowTop 1826   byPeriodRows 28
              docScrollHeight 900   bodyScrollHeight 1943
              htmlOverflow hidden   htmlHeight 900px   htmlBg rgb(10,12,16)
```

The report lays out to 1943px with its last table row at y=1826, while the document paginates only
**900px** — one viewport. `html` keeps `overflow: hidden`, `height: 900px` and the dark `--bg`.

**Why:** `app/globals.css:67` — `html, body { height: 100%; … overflow: hidden; … }` is the app-shell
rule the panels need on screen. The owner console's own print block (`app/globals.css:4870`)
carefully un-clips `.adm.owx`, `.adm-body` and `.adm-main` — you can see `bodyScrollHeight` become
1943 — but **nothing resets `html, body`**, so the printed document is still clipped to one screen
height and the dark background fills the surplus paper.

**The fix T26 needs to make** — inside the existing `@media print` block at `app/globals.css:4870`:

```css
html, body {
  height: auto !important;
  overflow: visible !important;
  background: #ffffff !important;
}
```

**Note the working path:** the Studio's own **Export → Print** button does NOT print the page — it
builds a separate clean document (`sectionExport.tsx → sectionHtml`) and that one is complete and
correct. The `@media print` block, `PrintHead` and `PrintFoot` exist specifically so ⌘P produces the
same sheet; its own comment says "they are no longer two documents". Today they still are.

---

## 🔗 H3 · LOW · confirmed, but a SIZE decision — 🔗 HANDOFF to **T26**, and 🟡 for the owner

**Where:** owner panel → **Reports**, on a phone (measured at Samsung A35, 360×780 dpr3) → the period
dropdown ("30 days"), the hub's "Report" button, and the Day summary's "Today" / "Yesterday" buttons.

Measured heights: period control **31px**, Report button **30px**, Today/Yesterday **27px** each.
Common guidance is 44px.

**But no tap was ever demonstrated to miss:** 20/20 real touch taps landed on the 27px day buttons and
12/12 on the 31px period control. (A first run read 5/10 on the period control — that was my own test
tapping a control it had left open, not a missed tap.) So this is a comfort question with a real
trade-off — bigger controls eat vertical space on a 780px phone — which §6 sends to the owner rather
than to me. Sizing of styled-jsx/CSS is also explicitly T26's territory this sweep.

---

## ✅ F1 · MEDIUM · confirmed · FIXED — the day sheet listed the same payment method twice

**Where:** owner panel → **Reports → Day summary** → the **"Settlement · how the money arrived"**
panel. On 5 Aug 2026, French House's sheet rendered, one line above the other:

```
Cash · 4% · 7 bills   ₹1,838
Cash · 1% · 2 bills   ₹525
```

two shares and two bars for one pile of cash.

**Why:** the settlement is grouped in the database by the RAW `payment_method`, so a method stored
with two casings ("Cash" and "cash" — French House really holds both) comes back as two rows. This
panel canonicalised the **label** and stopped there (`page.tsx` old l.1253). Because the row key is
that canonical name, React also logged **"Encountered two children with the same key"** and was free
to drop or duplicate one row. The Payments report (l.1885-1891) and `PaymentDonut` have always merged.

**Fix:** merge into a Map keyed by `canonPayMethod()` first, then drop the empty methods (so a method
split across two casings can no longer be filtered away in halves), biggest first.

**Measured after:** one `Cash · 5% · 9 bills ₹2,363` (7+2 bills, ₹1,838+₹525), the panel total
unchanged at exactly **₹46,049**, and the console error gone.

**Guard:** `verify:owner-reports` → T11-A (2 checks).

---

## ✅ F2 · MEDIUM · confirmed · FIXED — Refresh left the "By restaurant" cards stale

*(sweep #5 F7 — reported then, never fixed.)*

**Where:** owner panel → **Reports** (the hub, for an owner with more than one restaurant) → press
**Refresh**. The big headline and the five KPI columns update to the live figures; the **"By
restaurant"** cards underneath keep their old ones, so the cards stop adding up to the headline
directly above them.

**Why:** every other fetch in `refreshNow()` passes `force`, which sends `?refresh=1` and makes the
server recompute live. The brief only had its `briefTick` bumped, so it re-requested the same cached
key — up to five minutes old, older still on an idle key. He pressed the one button whose whole job
is to give him the live numbers.

**Fix:** the brief's fetch appends `&refresh=1` for the tick Refresh just bumped, and only that tick —
a later period change stays an ordinary cached read, so this costs no extra recompute of the estate.

**Measured on the real hub, before and after:**

```
before   Refresh → type=byrestaurant&range=30d                (no force)
after    Refresh → type=byrestaurant&range=30d&refresh=1
         period change → type=byrestaurant&range=7d           (no force)
         Refresh again → type=byrestaurant&range=7d&refresh=1
```

**Guard:** `verify:owner-reports` → T11-A (2 checks).

---

## ✅ F3 · LOW · confirmed · FIXED — "1 orders"

*(sweep #5 F9 — reported then, never fixed.)*

**Where:** owner panel → **Reports → Busy times → By hour** → the **"Peak hour"** and **"Quietest
hour"** tiles, and the four **day-part** tiles on **"Times of day"**.

On screen before the fix: **"QUIETEST HOUR · 10 AM · ₹441 · 1 orders"**. A quiet hour with exactly one
order is the normal case for a quiet hour, so this was on screen most of the time. Every other count
in this same file already writes `order/orders`.

**Measured after:** "QUIETEST HOUR 10 AM ₹441 · **1 order**".

**Guard:** `verify:owner-reports` → T11-A (1 check).

---

## ✅ F4 · MEDIUM · confirmed · FIXED — a ranking chart painted over the text below it

**Where:** owner panel → **Reports → Payments → "Discounts given" → "Biggest discount days"**, on any
period with only one or two days that had a discount. Same shape on **"Worst cancellation days"**, on
**Team → Performance → "Who put through the most"**, and on the ranking bars in the Inventory reports
and the dashboard's dish drawer — they all share `LeaderBar`.

**Why:** the plot has a 140px floor, but its container was capped at `rows * 42 + 20`
unconditionally — **62px at one row**, 104px at two — while `overflowY` is `visible` for anything up
to 8 rows. Nothing clipped the difference.

**Measured live, one discount day (7-day period):**

```
outerInlineMaxHeight  62px      plotRenderedH        140
outerRenderedH        62        plotPaintsBelowBoxBy  78
overflowY             visible
hit-test on the sentence "These 1 day account for 100% of everything
discounted this period"  →  svg.recharts-surface
```

The green bar was drawn **on top of the words**, and the chart's own money axis was pushed out of view
with it.

**Fix:** apply the cap only when the list actually scrolls (`data.length > 8`); below that there is
nothing to scroll and nothing to contain. Nine rows and up keep the exact height and scrolling they
had; three to eight were already above the floor and are untouched.

**Measured after:** note top y=923 sits below plot bottom y=913, and the axis ₹0 / ₹30 / ₹60 / ₹90 /
₹105 is drawn.

**Guard:** `verify:owner-reports` → T11-B (2 checks).

---

## What came back CLEAN

- **`lib/ownerCache.ts` — the whole compute-on-view snapshot cache.** 50 phases: freshness, the
  stale-while-revalidate path, the in-flight guard, the fingerprint short-circuit, the partial-payload
  refusal, the all-zero refusal, the piggy-backed housekeeping sweep, scope isolation, forced Refresh.
  **No fault found.** One 🟡 (the all-zero guard does not cover the forced path) is a trade-off, not a
  bug — it is I2 below.
- **The tax maths.** CGST + SGST sums to the "Tax collected" tile **to the rupee**
  (₹98,281.50 × 2 = ₹1,96,563, measured in the light skin). The filing table reconciles both ways, the
  mixed-rate banner correctly stays quiet on a clean single-rate restaurant, no phantom exempt tile,
  and every split goes through the one `lib/taxFiling` computation shared with the export.
- **The arithmetic the page prints.** `subtotal − discount + tax = revenue` holds per row and on the
  totals across all nine periods (and the day sheet's four money-flow lines add up on screen). Note
  this identity is preserved *even under H1*, because the route derives tax from revenue — which is
  exactly why the tax went negative rather than the identity breaking.
- **The chart kit.** Every time-series routes through `populated()` / `NotEnough` / `ScrollX`; every
  axis gets round ticks; gradient ids are instance-scoped in all five places; tooltips are en-IN and
  pluralised; no undeclared `var(--x)` (the `--ink` reference really is comment-only).
- **Both skins, both devices.** 56 screen/skin/device combinations: the skin attribute is right every
  time, no `NaN` / `undefined` / `[object Object]` / `Infinity` reaches the screen, the document never
  scrolls sideways at 1280px or at 360px, and chart label ink is `rgb(139,148,167)` on dark and
  `rgb(107,114,128)` on light — it flips, and nothing resolves to black-on-black.
- **Freshness honesty.** The `cachedAt` chip and Refresh sit beside the period control on the hub and
  on every report. The one apparent contradiction I chased — Sales "today" ₹4,914 against the day
  sheet's ₹8,778 — was a **stale snapshot, not a fault**: forced live, both read ₹8,778 / 14 bills,
  and the screen said "updated 2 min ago" the whole time.
- **Back button, Escape, deep links, redirects.** Four back layers, all via `useBackClose`; no
  hand-rolled pushState; all 18 deep-link aliases land on a report and never on the catalogue; an
  unknown `?open=` falls back to the hub with no page error; `/owner/report` and `/owner/sales` both
  still redirect.
- **Egress.** The Reports page issues no request of its own while idle; the only idle traffic is the
  shell's activity-gated 60s sidebar refresh, at the backstop, not faster.

## Housekeeping

- `npm run verify:heatmap-parity` **cannot run on this stack** — it needs an `lfh_owner_heatmap_old`
  fixture captured from a previous definition, and none exists on the backup database. It is not
  failing on a product fault; it has nothing to compare against. Flagged for T28 (`scripts/`), who
  owns the guards, to either seed the fixture or retire the entry.
- My run created no rows anywhere. Every probe was a GET; the one stubbed response (a two-restaurant
  overview, to make the hub render its brief) was client-side only and never reached the server.
  Aangan was never queried or written to.
