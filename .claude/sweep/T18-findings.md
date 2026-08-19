# T18 findings — the admin's money view (Revenue · Analytics · Customers · the Bill ledger)

**Phases:** 500 / 500 (P08501–P09000) · ledger: `.claude/sweep/LEDGER/T18.md`
**Problems:** 8 — **2 high**, 5 medium, 1 low. Every one is fixed in `sweep6/t18-admin-money-analytics`.
**Handoffs:** 3 (the real fix lives outside this territory).
**Came back CLEAN:** `app/aevinite/page.tsx` (the admin Dashboard — 80 phases, nothing found) and
every "does the admin ever see food money" rule: the Dashboard, Platform analytics, Customers and the
Change log carry **zero** ₹ glyphs, and no file in the territory computes a tax rate of its own.

Everything below was driven on port 4118 as the admin (cookie, never a password POST), against the
dev database, in both skins, at 1280×800 and at 360×780 dpr3. 24 page loads produced **0** page or
console errors.

---

## F1 · HIGH — "From 19 Aug, To 19 Aug" on the Bills ledger found 30 bills. There were 181.

**Where:** admin console → **Bills** → the **From / to** date pickers. He picks one day and the list
shows a fraction of it. Bills #373, #374 and #375 — taken at 03:55 IST — are not in it, and no
message says anything is missing.

**Why:** `qsFor()` pins the END of the window to IST (`to + "T23:59:59.999+05:30"`, with a comment
explaining exactly this trap) and leaves the START as a bare `YYYY-MM-DD`. `new Date("2026-08-19")`
is **UTC** midnight, i.e. **05:30 IST**, so the window opens five and a half hours late — over the
restaurant's late-night trade. Worse, the two halves disagree: a bill at 03:56 IST on the 19th is
after "to: 18 Aug" (23:59:59 IST on the 18th) and before "from: 19 Aug" (05:30 IST), so a
single-day search on **either** day cannot find it.

**Measured live** (`.t18/datewin.mjs`, and again by driving the real date inputs):

    endpoint  from=2026-08-19            (what the screen sends) →  30 bills
    endpoint  from=2026-08-19T00:00:00+05:30 (the whole IST day) → 181 bills
    the SCREEN with From=19 Aug and To=19 Aug                    →  30 rows
    bills that search cannot reach: 151 — e.g. #375 03:55 IST, #374 03:55 IST, #373 03:56 IST

**Reachable:** any single-day search, every day, on every restaurant. 194 of the newest 1,000
numbered bills on this database were opened between 00:00 and 05:30 IST.
**Who is worse off:** the admin, on the one screen whose written job is *"THE ADMIN MUST BE ABLE TO
REACH A DELETED BILL AT ANY TIME"* — he concludes a bill does not exist.
`file:line` — `app/aevinite/bill-audit/page.tsx:121` (the `to` line) and `:119` (the `from` line).
**Fix:** `from` is pinned to the first moment of that IST day, the mirror of what `to` already did.
**Guard:** `npm run verify:admin-money` → section A (4 checks), which fails on a revert.

## F2 · HIGH — Platform analytics showed the 7-day order count under the "Last 30 days" label

**Where:** admin console → **Platform analytics**, opened with a range in the address (`?range=30d`),
and every time he switches range. The tile reads **"ORDERS · LAST 30 DAYS"** with the **7-day**
number under it, and the "Last 30 days" tab is highlighted. The Dashboard's **Orders today** card
links here with `?range=today`, so its drill-in has the same coin-flip.

**Why:** `load()` has no request-sequencing guard. The mount effect runs twice — once with the
default `7d`, then with the range read out of the address — so two requests are in flight and
**whichever answers last wins**, regardless of which range the page is now showing. Both are served
from the snapshot cache, so the order is a race. The 60s backstop can land a stale payload the same way.

**Measured live**, four consecutive opens of `?range=30d`:

    run 1 → "Orders · last 30 days"  290        run 2 → 290
    run 3 → 290                                 run 4 → 290
    the 30-day truth from the same endpoint: 5,990

(An earlier run the same session gave 6,355 / 291 / 6,355 / 291 — it is a race, and it lands on the
wrong answer often enough to be the normal experience.)

**Reachable:** every open with `?range=`, and every fast range switch.
**Who is worse off:** the admin — the platform's headline order count is wrong by a factor of 20 and
nothing on the screen hints at it.
`file:line` — `app/aevinite/analytics/page.tsx:76` (`load`).
**Fix:** a monotonic request token. `load()` stamps each attempt, and a reply whose stamp is not the
current one is dropped instead of written to state.
**Guard:** `npm run verify:admin-money` → section B (opens `?range=30d` four times and asserts the
label and the number describe the same window).

## F3 · MEDIUM — drilling into a day narrowed every number on the page and relabelled nothing

**Where:** admin console → **Platform analytics** → the chart card, when a window's orders pile into
one day → **"See 18 Aug hour by hour"**. After the tap the tile reads **"ORDERS · LAST 7 DAYS 73"**
— 73 is that ONE day — the page subtitle still ends *"Last 7 days."*, the chart heading still says
**"Orders per day"** over an axis reading 12am…9pm, and both card hints still say *"for last 7 days"*.
Only one small line inside the chart admits the truth.

**Why:** the drill re-fetches the whole payload for one day (`?day=`), so `totals`, `busiest` and
`bySource` all narrow — but every label on the page is derived from `RANGE_LABEL[range]`, and `range`
never changed. The chart heading also re-derives the grain from `range` instead of the `bucket` the
server just sent.
**Measured live** with the payload stubbed to the shape the drill exists for (a display check —
nothing was written anywhere); screenshot read at `.t18/shots/analytics-drilled.png`.
**Reachable:** any window whose orders land ≥90% on one day — which is the ordinary shape of a
quiet platform, and exactly why the drill was built.
**Who is worse off:** the admin, comparing one day's platform activity against a week's benchmark.
`file:line` — `app/aevinite/analytics/page.tsx:131,158,191,192,204,238`.
**Fix:** one `windowText` used by every label, which becomes the drilled day's own name while a
drill is open; the chart heading now names the grain the server actually sent (`data.bucket`).
**Guard:** `verify:admin-money` → section C (drills, then asserts no label still says the window).

## F4 · MEDIUM — on a phone, a bill's amount is off the screen and cannot be scrolled to

**Where:** admin console → **Bills** → the list, on a phone. The state and the bill number are
visible; the **table, the amount, the time and the chevron are not**, and there is no way to reach
them — the card clips instead of scrolling.

**Why:** each row is a 6-column grid with `minWidth: 640` inside a card styled
`{ padding: 0, overflow: "hidden" }`. The sibling Change-log page and the Customers table both put
`overflowX: auto` on their dense wrapper; this one is the only dense table in the territory that hides
the overflow instead.
**Measured live at 360×780 dpr3, both skins:** the card reports `scrollWidth 640 / clientWidth 330`
and cannot scroll; per cell — `Closed unpaid ✓ · #30·My Little Fr ✓ · T9 ✗ · ₹399 ✗ · 3h ago ✗ · chevron ✗`.
**Reachable:** every phone and every narrow window, on both skins.
**Who is worse off:** the admin — the money column is the point of this screen and it is the one he
cannot see. **The fix is not a sideways scroll**: he has ruled that out for the panels
(R8's quote, *"there shouldn't be horizontal scroll anywhere"*), so the row REFLOWS.
`file:line` — `app/aevinite/bill-audit/page.tsx:309,323`.
**Fix:** the row's grid moved out of the inline style into the page's own `<style>` as `.blz-rowgrid`,
and below 760px it becomes three short lines (state · amount / bill · when / table · chevron). No
horizontal scroll is introduced and the desktop grid is byte-for-byte the one it was.
**Guard:** `verify:admin-money` → section D (every cell of the first row inside the viewport at 360px).

## F5 · MEDIUM — the guest drawer ignored the phone Back button, the keyboard and the page behind it

**Where:** admin console → **Customers** → tap a guest → the drawer slides in from the right. Pressing
the phone's hardware **Back** left the Customers page entirely instead of closing the drawer.

**Why:** the drawer is the only overlay in this territory that does not call `useAdminModal` — the
hook whose own header says it exists so *"no future modal can get any of them wrong"*. It hand-rolled
an Escape listener and stopped there, so it got none of the other three things.
**Measured live at 360×780:**

    drawer opened            → true
    phone Back               → LEFT THE PAGE (about:blank)
    focus after opening      → stayed outside the drawer
    the page behind it       → still scrollable

**Reachable:** every phone, every guest row. The sibling OwnerChooser on the Dashboard has had the
hook since 2026-07-25.
**Who is worse off:** the admin on a phone, thrown out of the screen by the button that should have
stepped back one layer; and anyone using a keyboard, whose focus never enters the drawer.
`file:line` — `app/aevinite/customers/page.tsx:121` (the hand-rolled listener), `:279` (the dialog).
**Fix:** `useAdminModal(drawerRef, "admin-customer-detail", close)` — phone Back, Escape, focus in and
back out, Tab trapped, and the scroll port frozen. The hand-rolled Escape effect is gone (the hook
does it).
**Guard:** `verify:admin-money` → section E (opens the drawer, presses Back, asserts the URL is
unchanged, the drawer is gone, focus went in and the scroll port is frozen).

## F6 · MEDIUM — the Change log printed a raw database word where the change should be

**Where:** admin console → **Bills → Change log** → the **Change** column. 29 rows on the live page
read **`order_cancel`**. Cancelling a bill is a tamper-risk row — it is flagged red and counted in
"226 bill removals/reverts worth a glance" — and it is the one whose name is a database identifier.

**Why:** the page's own `ACT` map is missing `order_cancel` and `order_uncancel`, both of which the
endpoint returns (`BILL_ACTIONS`, and `order_cancel` is in `RISK`). Its fallback is
`{ t: r.action }` — the raw code. The sibling Bills page falls through to the shared `actLabel()`
instead, and its comment says why: *"which never prints a raw code"*.
**Measured live:** 500 rows on screen, raw database words found: `order_cancel`. In the log itself:
`order_cancel` × 29.
**Reachable:** any restaurant that has cancelled a bill.
**Who is worse off:** the admin, and the "Activity log must read as English" rule.
`file:line` — `app/aevinite/bill-audit/changes/page.tsx:14` (the map), `:102` (the fallback).
**Fix:** both labels added ("Bill cancelled" / "Cancel undone"), and the fallback now goes through
the shared `actLabel()`, so no future action can ever print a raw code here again.
**Guard:** `verify:admin-money` → section F (no cell in the Change column matches a `snake_case` code).

## F7 · LOW — a stray vertical hairline down the Revenue page on a phone

**Where:** admin console → **Platform revenue** → the KPI strip, on a phone. A vertical line runs
down the right-hand side of the card past four of the five figures and then stops — it looks like a
half-drawn table.
**Why:** `.rev-strip` is a wrapping flexbox and every `.cell` carries `border-right`, cleared only on
`:last-child`. Once the cells stack one per row, each one's right border draws a disconnected segment.
**Evidence:** read in `.t18/shots/revenue-dark-a35.png` and again with the chart populated in
`.t18/shots/revenue-chart-a35.png`.
**Who is worse off:** nobody loses a number — it is a blemish on the operator's own money screen.
`file:line` — `app/aevinite/revenue/page.tsx:185`.
**Fix:** below 720px the divider becomes a `border-bottom` between stacked cells and the right border
is dropped, so the separator always separates the things it sits between.
**Guard:** `verify:admin-money` → section G (no `.rev-strip .cell` has a right border at 360px).

## F8 · MEDIUM — the Revenue chart's labels render at 3.9px on a phone

**Where:** admin console → **Platform revenue** → **Collected — last 12 months**. Every month label
and the "peak ₹26,000" note are unreadable smudges.
**Why:** the SVG declares a fixed `viewBox` 760 units wide and is drawn at `width: 100%`. On a phone
that is a 0.39× scale, so `fontSize="10"` lands as **3.9px**; on the desktop the same markup is
1.29× and reads 12.9px.
**Measured live** (the payments ledger is empty on this database, so the reply was stubbed for a
display check — nothing was written anywhere):

    1280×800 → svg 982px / viewBox 760 → scale 1.29 → labels 12.9px  ✔
    360×780  → svg 298px / viewBox 760 → scale 0.39 → labels  3.9px  ✘  (box height 5px)

**Reachable:** every phone, once any subscription payment exists.
**Who is worse off:** the admin — the chart of his own income has no readable axis.
`file:line` — `app/aevinite/revenue/page.tsx:24` (`CollectedChart`).
**Fix:** the chart measures its own container (ResizeObserver) and draws its viewBox at that width, so
one user unit is one pixel and 10px is 10px at every size; and when there is not room for twelve
labels it thins them to every 2nd or 3rd month — the house adaptive-time-axis rule — instead of
overprinting. Nothing about the chart's shape changes.
**Guard:** `verify:admin-money` → section H (every label ≥ 9.5px effective at 360px and at 1280px, and
no two labels overlap).

---

# 🔗 HANDOFFS — the real fix is outside this territory

## 🔗 H1 · HIGH — the admin Bill ledger's amount is not the one net figure the rest of the app uses

**Where:** admin console → **Bills** → a bill's **Total** and **Collected**, and the "amount removed"
written into the permanent Removals audit when the admin deletes a bill.
**What is wrong:** `netOf()` in `lib/billLedger.ts` re-derives the net as
`total − discount × (1 + tax_rate)` and **falls back to a rate of 0 when `orders.tax_rate` is null**.
Migration 301 fills `orders.disc_gross` with the discount grossed at the order's own rate, *falling
back to the restaurant's configured rate for a row with none*, and migration 310 makes
`orders.net_amount` (`total − disc_gross`) the ONE definition every money reader sums. So for a
discounted order with no stamped rate the ledger reads HIGH.
**Measured on the dev database:** 10 discounted orders carry no stamped rate; of 1,000 discounted
orders sampled the ledger disagreed with `net_amount` on 3, worst case

    order ae738fc4-3891-4cd8-81a4-f5864ca8b591
      total 525 · discount 50 · tax_rate NULL · disc_gross 52.50 · net_amount 472.50
      lib/billLedger netOf() → 475.00      (₹2.50 high)

This is the screen whose own comment says its figures being higher than every bill, Z-report line and
dashboard number *"undermined the oversight it exists for"* — and it is the last reader still doing
the arithmetic itself.
**The change needed:** add `net_amount` (and `disc_gross`) to `ORDER_COLS` in
`app/api/admin/bills/route.ts:45`, and in `lib/billLedger.ts:78` make `netOf()` return the stored
`net_amount` when it is present, keeping today's arithmetic only as the fallback for a row that
somehow lacks it. `netAmount()` in the route already delegates to `netOf`, so the ledger and the
permanent audit move together — which is the property that file was consolidated to protect.
**Files:** `lib/billLedger.ts` · `app/api/admin/bills/route.ts` (both outside T18's fence).

## 🔗 H2 · MEDIUM — the platform order count counts recycle-bin restaurants; the per-restaurant list does not

**Where:** admin console → **Platform analytics** → **"ORDERS · LAST 30 DAYS"** against the
**Busiest restaurants** table beside it; and the Dashboard's **Orders today** card, which counts the
same way.
**What is wrong:** `lfh_admin_busiest_restaurants` was given a `restaurants.deleted_at IS NULL` guard
by migration 135 *("binned restaurants must not inflate the counts")*, and the route applies the same
`liveIds` filter to tables, staff and the restaurant counts — but the headline order count
(`ordersCountQ`) and the by-source RPC's dine-in leg have no such guard. So the list of every live
restaurant cannot be reconciled with the total above it.
**Measured live through the real endpoint:**

    30 days: tile 5,990 · per-restaurant list 5,851 · difference 139
    those 139 belong to OG'S CAFE and Empty Cafe ZZ, both in the recycle bin

(today and 7d happen to agree — the binned restaurants have no recent orders, so this is quiet until
it is not.)
**The change needed:** scope the order count to live restaurants, the way its neighbours already are —
`app/api/admin/analytics/route.ts:128` and `app/api/admin/dashboard/route.ts:35` — and add the same
guard to `lfh_admin_orders_by_source`'s dine-in leg in a NEW migration (do not edit 137).
**Files:** two admin routes + one new migration (all outside T18's fence).

## 🔗 H3 · LOW — the Customers restaurant filter offers restaurants that are in the recycle bin

**Where:** admin console → **Customers** → the **All restaurants** dropdown. It lists **17**
restaurants where the platform has **9** live ones; the guest tiles and the "Where the guests are"
spread count the binned ones' guests too.
**What is wrong:** `app/api/admin/customers/route.ts:48` reads `restaurants` with no
`.is("deleted_at", null)`, unlike every other admin route.
**The change needed:** the `deleted_at` filter on that read (and keep `nameOf()` resolving a binned
name for an existing row, so a guest's chip never goes blank).
**File:** `app/api/admin/customers/route.ts` (outside T18's fence).
