# Owner Dashboard — interactive analytics (design + build spec)

Owner-requested 2026-06-25: a **beautiful, fully interactive, accurate** owner dashboard where
*everything is clickable* and drills down, with **charts**, and **live updates ONLY while a panel
is open** (zero background egress when nothing's open).

## Aesthetic
Clean, premium SaaS‑analytics look matching the app (light/cream surfaces, rounded cards, soft
shadows, the app's type scale). **Each restaurant carries its own `accent_color`** as its identity
throughout — its card border, its chart series, its detail header. Data‑dense but calm. Smooth
hover/expand transitions. Mobile‑responsive.

## Tech
- **Recharts** (composable React charts) for line/bar/donut. Series colored by `restaurant.accent_color`.
- Data comes **only from Postgres aggregation RPCs** (small pre‑summed payloads) — the UI NEVER
  downloads orders to sum in JS (accuracy + egress). Every money figure = **net of discount, excludes
  cancelled**, 05:00‑IST business‑day boundary (matches `lfh_owner_overview` / the counters).

## Screens & interactions (everything clickable)

### 1. Owner Home — all restaurants
- **Date scope toggle:** Today · 7d · 30d · All (drives every number/chart).
- **KPI strip** (aggregated across the owner's restaurants): Revenue · Orders · Open tables · Active
  restaurants. Clicking **Revenue** expands the *revenue breakdown* (the graphs view).
- **"Who earns more" bar chart:** revenue per restaurant, each bar in that restaurant's accent color.
  Click a bar → that restaurant's detail (screen 2).
- **Revenue‑over‑time line chart:** one line per restaurant (accent‑colored), over the selected range.
- **Restaurant cards grid:** per restaurant — name, today revenue, orders, open tables, a sparkline,
  accent‑bordered. Click a card → screen 2.

### 2. Restaurant detail — click a restaurant
- Accent‑colored brand header (name + wordmark).
- **KPI row:** Revenue · Orders · Avg order value · Open tables · Top dish. (Revenue clickable → the
  per‑hour/per‑dish breakdown.)
- **Charts:** revenue‑over‑time (line) · orders‑by‑hour (bar — busy times) · revenue‑by‑category
  (donut) · top dishes (horizontal bar).
- **Dish table:** every dish — qty sold, revenue, % of restaurant revenue — sortable. Click a dish → screen 3.

### 3. Dish analytics — click a dish
- That dish across the range: qty + revenue trend (line), share of restaurant revenue, peak hours.

## Data RPCs (new migration — all `STABLE SECURITY DEFINER`, `service_role`-only, restaurant‑scoped)
- `lfh_owner_overview()` — exists (all‑restaurants headline).
- `lfh_owner_revenue_timeseries(p_restaurant_id uuid /*null=all*/, p_bucket text, p_from timestamptz, p_to timestamptz)` — revenue+orders per time bucket → line charts.
- `lfh_owner_restaurant_revenue(p_from, p_to)` — revenue+orders per restaurant → the comparison bar.
- `lfh_owner_dish_breakdown(p_restaurant_id uuid, p_from, p_to)` — per‑dish qty + revenue.
- `lfh_owner_category_breakdown(p_restaurant_id uuid, p_from, p_to)` — per‑category revenue (donut).
- `lfh_owner_hourly(p_restaurant_id uuid, p_day date)` — orders/revenue by hour.
Each: net of discount, exclude cancelled, GROUP BY in Postgres, returns tiny rows. Validate on local PG.

## Egress‑safe live updates (the owner's hard requirement)
- **Subscribe only while a panel is mounted; unsubscribe on unmount.** No panel open ⇒ no
  subscription ⇒ **zero egress**. No polling anywhere.
- Use the existing breadcrumb realtime (`realtime_events`, push), **scoped per restaurant**
  (`restaurant_id=eq.<rid>`, from migration 086). Owner Home subscribes to the owner's restaurants;
  a detail screen subscribes to just that one restaurant.
- On a nudge: **debounce (~1s)** then refetch ONLY the small RPC(s) for the currently‑open view. Never
  refetch a view that isn't mounted.
- Reuse/extend `lib/useRealtime.ts` so the subscription lifecycle is tied to component mount.

## Accuracy checks (verify before "done")
- Cross‑check an RPC total against a direct `SUM` on known sandbox data.
- Toggle a restaurant's data and confirm only its numbers move.
- Confirm closing the dashboard tears down all subscriptions (no lingering realtime traffic).

## Build order
1. Aggregation RPCs migration (+ validate local PG + apply to sandbox).
2. Recharts dep + a small chart toolkit (accent‑aware).
3. Screen 1 (home) → 2 (restaurant) → 3 (dish), wired to the RPCs, all clickable.
4. Mount‑scoped per‑restaurant realtime refresh.
5. Browser‑verify each screen + the egress behavior; screenshots.

## Guardrails
Sandbox + worktree only; coordinate with the parallel roles session (don't clobber its files; use a
non‑colliding migration number; file‑specific commits). Don't merge to main. Owner panel area only
(app owner routes + these RPCs + chart components) — stay out of staff/roles files.
