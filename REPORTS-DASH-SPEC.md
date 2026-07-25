# Owner Reports — enrich each report into a rich dashboard (shared spec)

You are enriching report views in **`app/owner/reports/page.tsx`** (function `ReportBody`,
which has one `if (sel === "<key>") { ... return (<> ... </>); }` block per report). Make YOUR
assigned reports into rich, premium, data-dense dashboards. **Edit ONLY your assigned blocks.**

## Hard rules (do not break these)
- Edit ONLY your assigned `if (sel === "...")` block(s) in `app/owner/reports/page.tsx`.
- Do NOT edit: `components/owner/reports/kit.tsx`, `components/owner/Charts.tsx`,
  `app/api/owner/reports/route.ts`, `app/globals.css`, or any OTHER report block. This keeps
  our parallel branches conflict-free.
- If you need a NEW reusable component, put it in a NEW file under
  `components/owner/reports/` (e.g. `SearchTable.tsx`) and import it — new files never conflict.
- Keep the existing data flow: your block receives (in scope) `data: Payload`, `accent` (a CSS
  string, already the theme green — pass it to charts as `color={accent}`), `singleRest: boolean`,
  and `bucket: string`. Helpers in scope: `bucketLabel(iso, bucket)`, `inr(n)`, `nfmt(n)`,
  `roundToSum`, `classifyMenu`, `KLASS`, `DAYPARTS`.
- Charts use the owner THEME green — always `color={accent}`. Never a per-restaurant colour.
- Run `npx tsc --noEmit -p tsconfig.json` until it reports 0 errors before committing.
- Use the **ui-ux-pro-max skill** for design guidance (data-dense dashboard style).
- First: `git fetch origin && git reset --hard origin/feat/reports-dash-base` in your worktree,
  then `npm install`, then work. Commit to your own branch and push it. Do NOT deploy.

## Data payload (`data: Payload`)
- Money reports (`kind: money`/`daysummary`): `data.rows: MoneyRow[]`, `data.totals: Totals`,
  `data.tax`, `data.payments` (daysummary only), `data.bucket`.
  `MoneyRow = { bucket, orders, paidOrders, subtotal, tax, discount, revenue, cancelledOrders, cancelledValue }`
- `dishes`/`menu`: `data.rows: {title, qty, revenue}[]` (sorted by revenue desc).
- `categories`: `data.rows: {category, qty, revenue}[]`.
- `hourly`/`daypart`: `data.rows: {hour, orders, revenue}[]`.
- `payments`: `data.rows: {method, revenue, orders}[]`.

## Components you may import + use (already exist)
- From `@/components/owner/reports/kit`:
  - `Stat({ label, value, sub?, tone?, icon?, spark?, big? })` — a KPI tile. `tone`:
    "accent"|"good"|"warn"|"bad"|"info". `icon`: Font Awesome 6 name e.g. "fa-crown".
    `spark`: number[] (mini sparkline). Wrap several in `<div className="rs-kpis">...</div>`.
  - `Panel({ title?, hint?, right?, children, pad? })` — a titled card. `pad={false}` for tables/charts.
- From `@/components/owner/Charts`:
  - `ToggleChart({ data:{label,value}[], color, money?, name?, title?, height? })` — a time-series
    the user flips between BARS and a filled LINE (a "Bar/Line" pill, top-right). `money` (default
    true) = ₹ formatting; `money={false}` = plain counts. USE THIS for every time trend.
  - `LeaderBar({ data:{id,name,revenue,orders,accentColor}[], onSelect? })` — horizontal ranking bars.
  - `CategoryDonut({ data:{category,revenue}[] })`, `PaymentDonut({ data:{method,revenue,orders}[] })`.
  - `canonPayMethod(m)`, `PAY_COLORS`.
- `inr`, `nfmt` are in scope in page.tsx already (don't re-import).

## CSS classes available (from kit's ReportsStyles, scoped to `.rs-root`)
`.rs-kpis` (KPI grid), `.rs-stat`, `.rs-panel`, `.rs-table` + `.rs-tablewrap` (wrap for scroll),
`.rs-table th/td`, `td.num` (right-align numbers), `.rs-note`, `.rs-grid.two` (1.5fr/1fr two-col),
`.rs-empty`, `.rs-daysheet`, `.rs-lines`/`.rs-line`, `.rs-tag.<klass>`, `.rs-quad`/`.rs-qbox`.
You may add small inline styles or `<style jsx global>` **inside your new component files** only.

## What "rich dashboard" means (apply to each of your reports)
1. **KPI band** at top (`.rs-kpis`) — 4-6 `Stat` tiles: the headline metric (big), plus supporting
   ones. Show BOTH money AND counts where the data has them (revenue + units/orders).
2. **Best-fit primary chart** — a `ToggleChart` for anything over time (green). For rankings use
   `LeaderBar`; for proportions use a donut.
3. **Best / worst breakdown** — every report should surface "what's winning" AND "what needs
   attention / selling less" (e.g. top 5 + bottom 5, biggest discount day, worst cancellation day).
4. **A clean detail table** (`.rs-table`) with the full rows, right-aligned tabular numbers, a
   totals row where it makes sense, and % shares.
5. **Scale-safe:** never render a chart with 50+ bars. Chart the TOP N (10-12); put the long tail
   in a table. For big lists (items can be 200+), the table must have a **search box** + **sortable
   columns** (by revenue / qty / name) + show all rows scrollable. Build a `SearchTable` component
   in a new file for this and reuse it.
6. Keep it aesthetic, consistent with the existing green data-dense look, and readable at 390px.

## Notes
- `singleRest === false` means "all restaurants" — some things (tax split) only make sense per
  restaurant; guard with `singleRest`.
- Empty states: if no rows, render `<EmptyCard text="..." />` (already in scope).
- Don't remove the existing CSV/Print (they live in the page shell, not your block).
