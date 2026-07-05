# Owner panel — complete redesign (2026-07-04)

Owner's ask (2026-07-04, 22:57 + follow-ups): completely redesign `/owner`; everything
dynamic; charts must fill their range ("touch the top and touch the bottom"); the
by-restaurant bar graph is only sensible with several restaurants — with one restaurant
show time/date charts instead; study the 17-competitor POS research and beat them all
on usefulness AND ease of use; stat tiles dynamic; aesthetic + professional; easy for a
non-technical restaurant owner.

## Design pillars

1. **Adaptive by restaurant count** (the core "dynamic" ask):
   - **1 restaurant** → the dashboard IS that restaurant: KPI tiles, revenue-over-time
     (line/area), busy hours, category split, top dishes, payment split. No
     one-bar "who earns more" chart, no pointless drill level.
   - **2 restaurants** → comparison layout: shared KPI tiles + a two-line overlaid
     trend + a paired head-to-head card (side-by-side numbers), then per-restaurant cards.
   - **3+ restaurants** → leaderboard bar (who earns more) + multi-line trend +
     restaurant card grid; click drills into the single-restaurant view above.
2. **Charts fill their range.** Line/area charts use a computed y-domain
   [min − 6% span, max + 6% span] so the data touches top AND bottom (not a wasteful
   0-anchored band). Bar charts stay zero-based (honest bars) but the domain tops out
   exactly at the data max — no dead headroom.
3. **Every KPI is alive**: value + ▲/▼ delta vs the previous equal-length period
   (the table-stakes feature every competitor has that we lacked) + a sparkline.
   Numbers count up on load; tabular-nums everywhere.
4. **Competitor-beating, from data we already store** (competitor digest 2026-07-04):
   - **Lost business in ₹** (cancelled orders value — LimeTray's standout).
   - Payment-mode split (UPI/cash/card) — mig 110.
   - Discounts given (₹, count) — orders.discount.
   - Hourly busy-hours view; top + underperforming dishes.
   - Plain-language **insight strip**: 2–3 rule-based sentences computed from the
     loaded aggregates ("Revenue ▲12% vs last week", "Dinner drives 68% of revenue"…).
     No LLM/API, zero extra egress — derived client-side from data already fetched.
   - What competitors get wrong that we avoid: report jungles (300+ reports),
     paywalled basics, jargon, desktop-only retrofits.
5. **Reports** (new page, replaces the "Earnings report" + "Sales & reports" stubs) —
   the owner's tax spec (brain 2026-07-04 18:12/18:19): on-demand generation, never
   compulsory; ranges Today / 7d / 30 days / 12 months (monthly buckets) / custom;
   scope all-restaurants or one. Types: **Sales summary**, **Tax / GST** (merged rate
   headline + CGST/SGST/component split underneath, from settings.tax_components via
   lib/tax.ts proportions), **Dishes (item-wise)**, **Categories**, **Payment methods**,
   **Discounts**, **Cancellations (lost business)**, **Busy hours**. Each = summary
   tiles + chart + table, CSV export + Print. Few, well-named reports — searchable.
6. **Skin**: `.adm.owx` — the same dense dark console language the owner approved for
   admin (`.adm.adx`, feat/admin-redesign): #0a0c10 bg, hairline #1d2430 borders, dense
   13.5px, tabular numerals, grouped 224px sidebar → pill row ≤900px, light kept behind
   the toggle. Owner accent = **emerald** (#34d399 data / #10b981 light) so you always
   know owner (green = money) vs admin (blue); amber CTA shared. CSS block is
   self-contained in globals.css (scoped `.owx`), so it does not depend on the admin
   branch merging first and cannot conflict with it beyond a trivial append.

## Architecture

- **No schema changes; one additive migration** `120_owner_reports.sql`:
  `lfh_owner_sales_report(p_restaurant_id, p_from, p_to, p_bucket)` → per-bucket
  orders, subtotal, tax, revenue (paid-only, net of discount — SAME rule as mig 113),
  discount, cancelled_orders, cancelled_value. SECURITY DEFINER, service_role-only
  grants (mig 038 pattern). Buckets hour/day/week/month via date_trunc (the existing
  timeseries RPC already accepts 'month' for the 12-month view).
- **APIs** (all behind ownerScope, all pre-aggregated, no order scanning in JS):
  - `/api/owner/analytics` — unchanged shapes + optional `&compare=1` (fetches the
    previous equal-length window's totals for the delta chips; one extra tiny RPC call).
  - `/api/owner/reports?type=…&range=…&rid=…` — new; runs the matching RPC + reads
    settings.tax_components for the split; returns rows + totals + taxModel.
- **Client**: `components/owner/Charts.tsx` rebuilt (auto-domain AreaTrend, fitted
  Bars, Spark, DeltaChip, HourHeat, Donut); `OwnerShell` rebuilt on the owx skin with
  grouped nav (Overview / Business / quiet "Coming soon" group / Settings);
  `app/owner/page.tsx` adaptive dashboard; `app/owner/reports/page.tsx` new;
  `/owner/report` + `/owner/sales` redirect to `/owner/reports`.
- **Egress discipline** (playbook): activity-gated 60s refresh only while visible+in-use
  (existing useActiveAutoRefresh), no realtime socket on the dashboard, every query
  scoped + pre-summed, compare adds ≤2 tiny RPC rows.
- **Auth unchanged**: owner cookie or admin act-as (layout.tsx untouched semantics).
  Staff & powers / Feedback keep their APIs; they inherit the new skin.

## Out of scope (competitor ideas needing data we don't have)

Inventory/food-cost, labor cost, aggregator reconciliation, peer benchmarking across
customers, review AI. They stay as quiet "coming soon" nav entries (admin-entitled
modules later, per the NEW-FEATURE CHECKLIST).

## Definition of done

Lint clean; verified live in Chrome on port 4007 (dark + light, desktop + 390px);
1-restaurant vs many-restaurant layouts both exercised (act-as an owner with one
restaurant vs admin all-view); charts confirmed touching top/bottom of their range;
tax split matches lib/tax.ts on a restaurant with configured components (Aangan);
branch pushed, NOT merged until Rishi reviews at localhost:4007/owner.
