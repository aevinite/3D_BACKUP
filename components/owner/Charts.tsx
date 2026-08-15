"use client";
// Owner-panel chart kit (redesign 2026-07-04) — theme-aware Recharts wrappers.
//
// The owner's rule: a chart must FILL its box — the data touches the top AND the
// bottom of the y-range instead of floating in a 0-anchored band of dead space.
//   · LINE/AREA charts get fitDomain(): [min − 6% span, max + 6% span].
//   · BAR charts stay zero-based (a bar cut off at the bottom lies about size)
//     but the top of the domain is EXACTLY the data max — no headroom.
// Series colour = each restaurant's own accent. ₹ tooltips. All charts sit in
// fixed-height responsive boxes so cards never jump while loading.
import { useState, useId, Fragment, type CSSProperties } from "react";
import { useBackClose } from "@/lib/backStack";
import { compactINR, roundTicks } from "@/lib/money";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
} from "recharts";

// en-IN, the SAME grouping as components/admin/shared → inr, which every tile, table and
// legend in this console uses. This file used to keep its own en-US copy, so hovering the
// revenue chart showed ₹8,359,670 where the KPI card above it said ₹83,59,670 — and inside
// one MoneyTip the amount was en-US while the orders line below it was en-IN (T5 sweep,
// 2026-08-06). Kept local (not imported) so the chart kit stays dependency-free.
const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
// One shared short form for the whole console — and it goes up to CRORES now (owner,
// 2026-08-06: "do 1.2 Cr, it will look great"). This used to stop at lakhs, so a chart axis
// read "₹120.0L" while the restaurant dropdown beside it wrote "₹1.2Cr" for the same amount.
const compact = compactINR;
const AXIS = "var(--muted)";
const GRID = "var(--border-c, rgba(128,128,128,.18))";

// ── I6 (T5 sweep, 2026-08-06) — ROUND TICKS, WITHOUT GIVING UP THE OWNER'S RULE ──────────────
// The domain still ends at the exact data max, so a chart still FILLS its box. What changed is
// that we now hand recharts an explicit set of ROUND ticks, so it stops ALSO labelling that
// ragged max: the axis used to print ₹7.1L directly above ₹6L while every other gap was a full
// ₹2L, which reads as a rendering glitch. `roundTicks` returns [] when nothing sensible fits,
// and `tk()` then passes undefined so the axis behaves exactly as it did before.
const tk = (lo: number, hi: number) => { const t = roundTicks(lo, hi); return t.length ? t : undefined; };

/** y-domain that makes the data touch top AND bottom of the plot (owner's rule). */
function fitDomain(values: number[]): [number, number] {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return [0, 1];
  const min = Math.min(...nums), max = Math.max(...nums);
  if (min === max) return [min === 0 ? 0 : min * 0.9, max === 0 ? 1 : max * 1.1];
  const pad = (max - min) * 0.06;
  return [Math.max(0, min - pad), max + pad];
}

// ── Dynamic-chart rule (owner, 2026-07-25) ───────────────────────────────────
// A lonely 1-bar chart floating in an empty plot reads as broken. So EVERY
// time-series chart here obeys one shared rule (see dataviz skill · "a single value
// is a stat tile, not a one-bar chart"):
//   · < 2 points with real activity → DON'T draw a chart; show the NotEnough card
//     (the single value is still surfaced as a number, never lost).
//   · many buckets → the plot SCROLLS horizontally (ScrollX) so bars keep a
//     comfortable width instead of squeezing into threads; it fills the card with
//     no scrollbar whenever the natural width already fits.
// New time charts added later MUST route through populated()/NotEnough/ScrollX.
const MIN_POINTS = 2;
/** How many buckets carry real activity (a zero bucket is not a data point). */
const populated = (values: number[]) => values.filter((v) => (Number(v) || 0) > 0).length;
/** The one non-zero value, when there's exactly one — surfaced in NotEnough. */
const soleValue = (values: number[]) => values.find((v) => (Number(v) || 0) > 0) ?? 0;

/** Horizontal-scroll frame. Bars keep ≥`per`px each; past what fits, the plot
 *  scrolls. `width: max(100%, …)` means it fills the card (no scrollbar) whenever
 *  the natural width already fits — so normal 7/30-day charts are unchanged. */
function ScrollX({ count, per = 24, height, extra = 0, children }: { count: number; per?: number; height: number; extra?: number; children: React.ReactNode }) {
  // `extra` = the width the plot's own chrome eats before any bar is drawn (the y-axis
  // and the right margin). Without it, `count * per` was the width of the WHOLE box, so
  // each bar really got (per − chrome/count) px — on a phone that turned a 46px column
  // into 36px under a 42px-wide "₹38.8L" label and the amounts crowded each other.
  // Defaults to 0, so every existing caller keeps the exact width it had.
  return (
    <div className="owx-scrollx" style={{ width: "100%", overflowX: "auto", overflowY: "hidden" }}>
      <div style={{ width: `max(100%, ${Math.round(count * per + extra)}px)`, height }}>{children}</div>
    </div>
  );
}

/** Shown instead of a sad 1-bar chart. Keeps the single value visible as a stat. */
function NotEnough({ height = 200, value, hint }: { height?: number; value?: string; hint?: string }) {
  return (
    <div style={{ minHeight: height, display: "grid", placeItems: "center", textAlign: "center", padding: 18 }}>
      <div>
        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}><i className="fas fa-chart-column" aria-hidden="true" /></div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Not enough data yet</div>
        {value != null && (
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
        )}
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, maxWidth: 280, marginInline: "auto", lineHeight: 1.45 }}>
          {hint || "A trend needs activity on more than one point in this period — come back once there’s a bit more."}
        </div>
      </div>
    </div>
  );
}

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border-c, rgba(128,128,128,.3))", borderRadius: 10, padding: "8px 10px", fontSize: 12, boxShadow: "0 6px 20px rgba(0,0,0,.25)" }}>
      {children}
    </div>
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MoneyTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  // Rows may carry a hidden `__orders` count (owner 2026-07-26: "the graph should also
  // show the number of orders when you hover") — shown as one extra plain line.
  const orders = payload[0]?.payload?.__orders;
  return (
    <TipBox>
      {label != null && <div style={{ color: "var(--muted)", marginBottom: 4 }}>{label}</div>}
      {payload.map((p: { name: string; value: number; color?: string; fill?: string }, i: number) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color || p.fill, display: "inline-block" }} />
          <b>{p.name}</b>: {inr(p.value)}
        </div>
      ))}
      {orders != null && Number(orders) > 0 && (
        <div style={{ color: "var(--muted)", marginTop: 4 }}>{Number(orders).toLocaleString("en-IN")} order{Number(orders) === 1 ? "" : "s"}</div>
      )}
    </TipBox>
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CountTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <TipBox>
      {label != null && <div style={{ color: "var(--muted)", marginBottom: 4 }}>{label}</div>}
      {payload.map((p: { name: string; value: number }, i: number) => (
        // grouped, like every other number in the console — a 12,345-order bucket used to
        // print "12345" (T5 sweep, 2026-08-06).
        <div key={i}><b>{p.name}</b>: {(Number(p.value) || 0).toLocaleString("en-IN")}</div>
      ))}
    </TipBox>
  );
}

// ── AreaTrend — revenue over time, single or multi restaurant ──────────────
export function AreaTrend({ data, lines, height = 260 }: {
  data: Record<string, unknown>[];
  lines: { key: string; name: string; color: string }[];
  height?: number;
}) {
  // A gradient id must be unique PER CHART INSTANCE, not per series key — the same lesson
  // ToggleChart learned on 2026-08-04 (duplicate <linearGradient> ids mean the second one is
  // ignored and both charts fill from the FIRST). Two AreaTrends can already co-exist (the
  // main trend and the restaurant drawer's), and today they happen to use different keys, so
  // nothing is visibly wrong — this stops the next one being a silent mis-fill. Same for
  // RevMonthCompare and Column3D below. (T5 sweep, 2026-08-06.)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!data.length || !lines.length) return <Empty />;
  const values = data.flatMap((row) => lines.map((l) => Number(row[l.key]) || 0));
  const single = lines.length === 1;
  // Dynamic-chart rule — AreaTrend was the ONE time chart here that skipped the shared
  // populated()/NotEnough gate, so a brand-new restaurant's "Revenue over time · last 30
  // days" drew 29 dead-flat days plus one lonely spike (exactly the "reads as broken"
  // shape the rule forbids — seen on Aangan's live owner dashboard 2026-07-28, and it is
  // what EVERY new client sees in their first weeks). Now it answers like its siblings:
  // fewer than 2 buckets with real activity → the NotEnough card, single value kept as
  // a number. Charts with genuine history are untouched.
  if (populated(values) < MIN_POINTS) {
    return <NotEnough height={height} value={populated(values) === 1 ? inr(soleValue(values)) : undefined} />;
  }
  return (
    <div>
      {/* Legend lives ABOVE the plot as wrapping HTML chips — NOT Recharts' in-canvas legend
          — so the chart uses the FULL box height instead of surrendering a strip at the
          bottom, and EVERY restaurant is listed no matter how many (the strip wraps, then
          scrolls past a few rows). Owner 2026-07-25: "graph is not taking full space". */}
      {!single && (
        <div className="own-legend" role="list">
          {lines.map((l) => (
            <span key={l.key} className="own-leg" role="listitem">
              <span className="own-leg-dot" style={{ background: l.color }} aria-hidden="true" />{l.name}
            </span>
          ))}
        </div>
      )}
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ left: 4, right: 10, top: 8, bottom: 4 }}>
            <defs>
              {lines.map((l) => (
                <linearGradient key={l.key} id={`own-g-${cssId(l.key)}-${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={l.color} stopOpacity={0.36} />
                  <stop offset="100%" stopColor={l.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} minTickGap={24} />
            <YAxis domain={fitDomain(values)} ticks={tk(...fitDomain(values))} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={48} allowDecimals={false} />
            {/* Crosshair + ringed active dot = the "pretty" hover from the design demos
                the owner asked to match (2026-07-26). */}
            <Tooltip content={<MoneyTip />} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3", strokeOpacity: 0.5 }} />
            {lines.map((l) => (
              <Area key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color}
                strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                fill={single ? `url(#own-g-${cssId(l.key)}-${uid})` : "transparent"} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
const cssId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

// ── RevMonthCompare — "this month vs last month" (owner 2026-07-26). THIS month is a
//    green filled area (the gradient "light falling top→bottom" look the owner liked),
//    LAST month is a plain grey reference line over it so it stays clearly visible. Data
//    rows: { label, cur, prev, __orders }, aligned by day-of-month. ────────────────────
export function RevMonthCompare({ data, height = 260, curName, prevName, curColor = "#34d399", prevColor = "#9ca3af" }: {
  data: Record<string, unknown>[];
  height?: number; curName: string; prevName: string; curColor?: string; prevColor?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");   // instance-scoped gradient id (see AreaTrend)
  if (!data.length) return <Empty />;
  const hasPrev = data.some((d) => (Number(d.prev) || 0) > 0);
  const values = data.flatMap((d) => [Number(d.cur) || 0, ...(hasPrev ? [Number(d.prev) || 0] : [])]);
  // Dynamic-chart rule — this was the SECOND time chart to skip the shared gate (the first
  // was AreaTrend, fixed 2026-07-28; this one was added the same week and missed). It is
  // LOCKED to whole calendar months, so the range dropdown can't rescue it: on the 1st or 2nd
  // of a month, or for any new restaurant, it drew ~30 dead-flat days plus one lonely spike —
  // exactly the "reads as broken" shape the owner banned. `cur` is deliberately `null` for
  // future days, so count activity across BOTH months' real values.
  const activity = data.flatMap((d) => [Number(d.cur) || 0, Number(d.prev) || 0]);
  if (populated(activity) < MIN_POINTS) {
    return <NotEnough height={height}
      value={populated(activity) === 1 ? inr(soleValue(activity)) : undefined}
      hint="A month-on-month comparison needs takings on more than one day — it fills in as the month goes on." />;
  }
  const gid = `own-g-monthcur-${uid}`;
  return (
    <div>
      <div className="own-legend" role="list">
        <span className="own-leg" role="listitem"><span className="own-leg-dot" style={{ background: curColor }} aria-hidden="true" />{curName}</span>
        {hasPrev && (
          <span className="own-leg" role="listitem"><span className="own-leg-dot" style={{ background: prevColor }} aria-hidden="true" />{prevName}</span>
        )}
      </div>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ left: 4, right: 10, top: 8, bottom: 4 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={curColor} stopOpacity={0.4} />
                <stop offset="100%" stopColor={curColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} minTickGap={24} />
            <YAxis domain={fitDomain(values)} ticks={tk(...fitDomain(values))} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={48} allowDecimals={false} />
            <Tooltip content={<MoneyTip />} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3", strokeOpacity: 0.5 }} />
            {/* grey LAST-month line drawn first, under the green area's stroke */}
            {hasPrev && (
              <Line type="monotone" dataKey="prev" name={prevName} stroke={prevColor} strokeWidth={2}
                dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
            )}
            <Area type="monotone" dataKey="cur" name={curName} stroke={curColor} strokeWidth={2.5}
              dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }} fill={`url(#${gid})`} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── TimeBar — revenue per bucket for ONE scope (bars, zero-based, fitted top) ─
export function TimeBar({ data, color, height = 240 }: { data: { label: string; revenue: number }[]; color: string; height?: number }) {
  const values = data.map((d) => d.revenue);
  if (populated(values) < MIN_POINTS) return <NotEnough height={height} value={populated(values) === 1 ? inr(soleValue(values)) : undefined} />;
  const max = Math.max(1, ...values);
  return (
    <ScrollX count={data.length} height={height}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={16} padding={{ left: 2, right: 14 }} />
          <YAxis domain={[0, max]} ticks={tk(0, max)} tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} allowDecimals={false} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" fill={color} radius={[5, 5, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </ScrollX>
  );
}

/** A category tick that carries its own tooltip — recharts clips a long label silently. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CatTick({ x, y, payload }: any) {
  const label = String(payload?.value ?? "");
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{label}</title>
      <text x={0} y={0} dy={4} textAnchor="end" fill={AXIS} fontSize={11.5}>{label}</text>
    </g>
  );
}

// ── LeaderBar — "who earns more" across restaurants (3+ scope). Clickable. ──
export type RevDatum = { id: string; name: string; revenue: number; orders: number; accentColor: string };
export function LeaderBar({ data, onSelect, valueLabel = "Revenue", showValues = false }: { data: RevDatum[]; onSelect?: (id: string) => void; valueLabel?: string; showValues?: boolean }) {
  if (!data.length) return <Empty />;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  // Ranking bars: comfortable row height, but past ~8 rows the card would grow
  // unbounded — cap the visible height and scroll instead of stretching the page.
  const rowH = 42, visible = Math.min(data.length, 8);
  // `showValues` writes the amount just past the end of each bar. Used by
  // WhoEarnsMore, where this IS the only view once a portfolio passes 9 restaurants,
  // so the money has to be readable without hovering. The extra right margin is the
  // room that label needs — the domain still ends at the data max, so the longest
  // bar can never grow over its own number. Off everywhere else, so the reports
  // pages and the dish ranking render exactly as before.
  return (
    <div style={{ width: "100%", maxHeight: visible * rowH + 20, overflowY: data.length > 8 ? "auto" : "visible" }}>
     <div style={{ width: "100%", height: Math.max(140, data.length * rowH) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: showValues ? 58 : 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, max]} tickFormatter={compact} tick={{ fontSize: 11, fill: AXIS }} allowDecimals={false} />
          {/* A long name is clipped to the 110px axis with nothing to reveal it. A custom tick
              draws the same label plus an SVG <title>, so hovering gives the full name back
              (T5 sweep, 2026-08-06). */}
          <YAxis type="category" dataKey="name" width={110} tick={<CatTick />} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name={valueLabel} radius={[0, 6, 6, 0]} cursor={onSelect ? "pointer" : undefined}
            onClick={(d: { id?: string }) => d?.id && onSelect?.(d.id)}>
            {showValues && (
              <LabelList dataKey="revenue" position="right" formatter={((value: unknown) => compact(Number(value))) as never}
                style={{ fill: "var(--text)", fontSize: 11, fontWeight: 700 }} />
            )}
            {data.map((d) => <Cell key={d.id} fill={d.accentColor} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
     </div>
    </div>
  );
}

// ── WhoEarnsMore — the "Who earns more" card body (owner 2026-07-27) ─────────
// The ranking, in the ONE shape that suits the number of restaurants — the reader
// never picks it (the Columns/Bars/Line toggle was REMOVED 2026-07-31: the shape was
// already decided, so the buttons were just three ways to make it worse). Up to 9
// restaurants → vertical columns; 10+ → the ranked horizontal LeaderBar.
// Flat gradient column (owner 2026-07-27: "forget 3d" — the drop-shadow + gloss looked
// blurry on the client site). Crisp rounded column, full colour at the top fading gently
// toward the base — the exact look from the approved design demo.
function Column3D(props: {
  x?: number; y?: number; width?: number; height?: number; fill?: string; index?: number; uid?: string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, fill = "#888", index = 0, uid = "" } = props;
  if (height <= 0 || width <= 0) return null;
  // `uid` scopes the gradient to THIS chart instance — see the AreaTrend note.
  const gid = `we-col-${uid}-${index}`;
  return (
    <g>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity={1} />
          <stop offset="100%" stopColor={fill} stopOpacity={0.72} />
        </linearGradient>
      </defs>
      <rect x={x} y={y} width={width} height={height} rx={6} fill={`url(#${gid})`} />
    </g>
  );
}

function ColumnsChart({ data, onSelect }: { data: RevDatum[]; onSelect?: (id: string) => void }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");   // instance-scoped gradient ids (see AreaTrend)
  const max = Math.max(1, ...data.map((d) => d.revenue));
  // The amount above each column is THEME text, never a fixed colour. It used to say
  // `var(--ink)` — a variable this app has never defined anywhere — so the invalid
  // var() fell back to the SVG initial fill, pure BLACK, and every amount sat
  // unreadable on the dark owner console (owner's screenshot, 2026-07-31). `--text`
  // is defined in BOTH .adm.owx skins, so it flips with the theme.
  // ScrollX guarantees each column ≥46px — the room a "₹40.8L" label needs — so two
  // amounts can never print on top of one another (the owner's dynamic-chart rule:
  // dense → scroll, don't squeeze). `width: max(100%, …)` means it only scrolls when it
  // must: on a desktop card all 9 fit with no scrollbar, on an A35 phone (≈236px of
  // plot) even 7 must scroll, because 7 readable labels need ≈294px and squeezing them
  // to fit is what made the amounts unreadable in the first place.
  return (
    <ScrollX count={data.length} per={46} extra={46 + 22} height={300}>
      <ResponsiveContainer>
        {/* right:22 — NOT 8. The amount sits CENTRED over its column, so above the last
            column it needs room past the column's own right edge; with 8 the final label
            was sliced in half by the SVG's edge on an A35 phone ("₹16.7L" read "₹16.").
            top:24 is the matching room for the tallest column's label. */}
        {/* left:10 — the names print at −28° with textAnchor="end", so each one extends LEFT and
            DOWN from its tick. The FIRST column's tick sits just past the y-axis, so the longest
            name ran off the card: "My Little French House" rendered as "le French House" on the
            owner's own dashboard, and started off-screen entirely on a phone (T11 sweep). It is
            the biggest earner, so it is always the first column and always the one that breaks. */}
        <BarChart data={data} margin={{ left: 10, right: 22, top: 24, bottom: 6 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          {/* Truncate from the END, never the start. An angled label that overflows is cut on its
              LEFT — which removes the words that identify it ("My Little" → gone) and leaves the
              generic tail. Bounding the label keeps its horizontal reach inside the plot AND means
              what survives is the part you recognise. The full name is still on the tooltip. */}
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: AXIS }} interval={0} angle={-28} textAnchor="end" height={74}
            tickFormatter={(v: string) => (typeof v === "string" && v.length > 15 ? v.slice(0, 14).trimEnd() + "…" : v)} />
          <YAxis domain={[0, max]} ticks={tk(0, max)} tickFormatter={compact} tick={{ fontSize: 11, fill: AXIS }} width={46} allowDecimals={false} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" shape={<Column3D uid={uid} />} maxBarSize={72} isAnimationActive={false}
            cursor={onSelect ? "pointer" : undefined}
            onClick={(d: { id?: string }) => d?.id && onSelect?.(d.id)}>
            <LabelList dataKey="revenue" position="top" formatter={((value: unknown) => compact(Number(value))) as never} style={{ fill: "var(--text)", fontSize: 11, fontWeight: 700 }} />
            {data.map((d) => <Cell key={d.id} fill={d.accentColor} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ScrollX>
  );
}

/** Past this many restaurants the ranking turns HORIZONTAL — a vertical column can no
 *  longer hold a readable restaurant name or amount (owner's decision, 2026-07-31). */
const COLUMNS_MAX = 9;
export function WhoEarnsMore({ data, onSelect }: {
  data: RevDatum[];
  onSelect?: (id: string) => void;
}) {
  if (!data.length) return <Empty />;
  // The chart picks itself off the count — no toggle. "Line" is gone with the toggle
  // because the card sitting immediately beside this one is already the
  // revenue-over-time lines, so it was the same picture twice.
  const sorted = [...data].sort((a, b) => b.revenue - a.revenue);
  return sorted.length > COLUMNS_MAX
    ? <LeaderBar data={sorted} onSelect={onSelect} showValues />
    : <ColumnsChart data={sorted} onSelect={onSelect} />;
}

/** "29%" · "<1%" for a real-but-tiny share · "0%" only when it really is nothing. */
const sharePct = (v: number, total: number) => {
  if (total <= 0 || v <= 0) return "0%";
  const p = (v / total) * 100;
  return p < 0.5 ? "<1%" : `${Math.round(p)}%`;
};

// ── CategoryDonut ───────────────────────────────────────────────────────────
const PALETTE =["#34d399", "#5b8def", "#e0b341", "#e2607a", "#a36bd4", "#4bbdc9", "#e3935b", "#9aa84a"];
export function CategoryDonut({ data }: { data: { category: string; revenue: number }[] }) {
  // A category that took NO money is not a slice — it's a legend row to read past, and a
  // zero-width wedge (PaymentDonut has always filtered this; this one didn't). Sort FIRST,
  // then colour, so the palette follows the ranking instead of the caller's row order.
  const rows = data.filter((d) => (Number(d.revenue) || 0) > 0).sort((a, b) => b.revenue - a.revenue);
  if (!rows.length) return <Empty />;
  // DYNAMIC legend (owner round-5): the old bottom legend wrapped into a wall of
  // text with 25+ categories and squeezed the donut. Now the legend fills the RIGHT
  // column first; past its capacity a LEFT column joins; past both, the text steps
  // down a size. The donut always keeps the middle. Sorted by revenue so the labels
  // an owner actually cares about are always at the top of the columns.
  const sorted = rows.map((d, i) => ({ ...d, color: PALETTE[i % PALETTE.length] }));
  const n = sorted.length;
  const perCol = 9;                                   // comfortable rows per side column
  const twoCols = n > perCol;
  const small = n > perCol * 2;                       // both sides full → smaller text
  // SPLIT IN HALF, don't interleave (T5 sweep, 2026-08-11). This used to be `i % 2`, which
  // fills both columns evenly but scatters the ranking: measured live, the LEFT column (which
  // is rendered first, so it is read first) began at pasta 17% while the biggest category —
  // salads 29% — sat at the top of the RIGHT one. The comment below already claimed the sort
  // existed "so the labels an owner actually cares about are always at the top of the columns";
  // that is only true of a column each reader can read in order. Halves give the same two
  // columns AND keep 1,2,3… running down the left and continuing down the right.
  const half = Math.ceil(n / 2);
  const left = twoCols ? sorted.slice(0, half) : [];
  const right = twoCols ? sorted.slice(half) : sorted;
  const total = sorted.reduce((a, d) => a + d.revenue, 0) || 1;
  const legendCol = (items: typeof sorted) => (
    <div style={{ display: "flex", flexDirection: "column", gap: small ? 3 : 5, minWidth: 0, flex: "1 1 0", maxHeight: 230, overflowY: "auto" }}>
      {items.map((d) => (
        <span key={d.category} title={`${d.category} · ${inr(d.revenue)} · ${sharePct(d.revenue, total)}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: small ? 10 : 11.5, fontWeight: 600, color: "var(--muted)", minWidth: 0 }}>
          <span style={{ width: small ? 8 : 9, height: small ? 8 : 9, borderRadius: 3, background: d.color, flexShrink: 0 }} aria-hidden="true" />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.category}</span>
          {/* A real-but-tiny share reads "<1%", never a flat "0%" beside a non-zero amount. */}
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "var(--text)", flexShrink: 0 }}>{sharePct(d.revenue, total)}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
      {left.length > 0 && legendCol(left)}
      <div style={{ width: 190, height: 210, flexShrink: 0 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={sorted} dataKey="revenue" nameKey="category" innerRadius={52} outerRadius={86} paddingAngle={2} stroke="var(--card)">
              {sorted.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip content={<MoneyTip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {legendCol(right)}
    </div>
  );
}

// ── PaymentDonut — how the money actually arrived (UPI / Cash / Card / …) ───
// One FIXED colour per method, identical in every panel (set validated
// colorblind-safe against dark surfaces, 2026-07-05). Every number is also
// written out in the legend — nobody should have to judge slice angles.
export const PAY_COLORS: Record<string, string> = {
  UPI: "#9085e9", Cash: "#199e70", Card: "#3987e5", Other: "#c98500", "Not recorded": "#6b7280",
};
// A method this app doesn't know by name (a wallet, a house account) used to fall back to the
// SAME grey as "Not recorded", so two custom methods were one indistinguishable wedge in the
// ring — the legend named them, the chart didn't (T5 sweep, 2026-08-06). Give each a stable
// colour of its own, picked from the name so it never changes between two loads. Deliberately
// away from the five fixed hues above, and away from "Not recorded" grey, which keeps its
// meaning: "nobody wrote down how this was paid".
const PAY_EXTRA = ["#d97706", "#0ea5e9", "#c026d3", "#65a30d", "#e11d48", "#0d9488"];
export function payColor(method: string): string {
  if (PAY_COLORS[method]) return PAY_COLORS[method];
  let h = 0;
  for (let i = 0; i < method.length; i++) h = (h * 31 + method.charCodeAt(i)) >>> 0;
  return PAY_EXTRA[h % PAY_EXTRA.length];
}
/** Canonical label for a stored payment_method (any casing, null, "" → "Not recorded"). */
export function canonPayMethod(m: string | null | undefined): string {
  const t = (m || "").trim();
  if (!t) return "Not recorded";
  return Object.keys(PAY_COLORS).find((k) => k.toLowerCase() === t.toLowerCase()) || t;
}
export function PaymentDonut({ data }: { data: { method: string; revenue: number; orders: number }[] }) {
  const merged = new Map<string, { method: string; revenue: number; orders: number }>();
  for (const p of data) {
    const method = canonPayMethod(p.method);
    const row = merged.get(method) || { method, revenue: 0, orders: 0 };
    row.revenue += p.revenue; row.orders += p.orders;
    merged.set(method, row);
  }
  const rows = [...merged.values()].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((a, p) => a + p.revenue, 0);
  if (!rows.length || total <= 0) return <Empty />;
  const color = payColor;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 22 }}>
      <div style={{ position: "relative", width: 180, height: 180, flex: "0 0 auto" }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={rows} dataKey="revenue" nameKey="method" innerRadius="68%" outerRadius="100%"
              paddingAngle={2.5} stroke="var(--card)" strokeWidth={2} startAngle={90} endAngle={-270}>
              {rows.map((p) => <Cell key={p.method} fill={color(p.method)} />)}
            </Pie>
            <Tooltip content={<MoneyTip />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3, fontVariantNumeric: "tabular-nums" }}>{inr(total)}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" }}>collected</div>
          </div>
        </div>
      </div>
      <div style={{ flex: "1 1 220px", minWidth: 220, display: "flex", flexDirection: "column", gap: 11 }}>
        {rows.map((p) => (
          <div key={p.method} style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", columnGap: 9, alignItems: "baseline" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: color(p.method), alignSelf: "center" }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{p.method}</span>
            <span style={{ fontSize: 13.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{inr(p.revenue)}</span>
            <span style={{ gridColumn: "2 / 4", fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {sharePct(p.revenue, total)} · {p.orders} bill{p.orders === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Spark — tiny inline sparkline for KPI tiles (pure SVG, no axes) ─────────
// ── SparkArea — full-width gradient mini-trend for KPI cards (D1 look, 2026-07-26).
// preserveAspectRatio="none" lets it stretch across the whole card bottom.
export function SparkArea({ points, color, height = 34, animate = false }: { points: number[]; color: string; height?: number; animate?: boolean }) {
  // useId, not Math.random(): every other gradient in this file moved off a random id after the
  // duplicate-<linearGradient> lesson (two charts filling from ONE definition). This one only
  // escaped it because it never renders on the server — that is luck, not a rule. The hook must
  // run before the early return below, so it sits here (T5 sweep, 2026-08-11).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (points.length < 2) return null;
  const w = 300;
  const max = Math.max(...points, 1), min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const X = (i: number) => (i * step).toFixed(1);
  const Y = (v: number) => (height - 3 - ((v - min) / span) * (height - 6)).toFixed(1);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${X(i)},${Y(v)}`).join(" ");
  const gid = `spa-${uid}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${gid})`} className={animate ? "spa-fill" : undefined} />
      {/* thin, calm line — the thick stroke read as chunky (owner round-3).
          animate=true draws the line in (pathLength=1 → dashoffset 1→0). */}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75"
        vectorEffect="non-scaling-stroke" pathLength={animate ? 1 : undefined} className={animate ? "spa-line" : undefined} />
      {animate && (
        <style>{`
          .spa-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: spaDraw 1.1s ease-out forwards; }
          .spa-fill { opacity: 0; animation: spaFade .8s ease-out .35s forwards; }
          @keyframes spaDraw { to { stroke-dashoffset: 0; } }
          @keyframes spaFade { to { opacity: 1; } }
          @media (prefers-reduced-motion: reduce) { .spa-line { animation: none; stroke-dashoffset: 0; } .spa-fill { animation: none; opacity: 1; } }
        `}</style>
      )}
    </svg>
  );
}

export function Spark({ points, color, width = 72, height = 26 }: { points: number[]; color: string; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const [lo, hi] = fitDomain(points);
  const span = hi - lo || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - lo) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="owx-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

// ── DeltaChip — ▲/▼ vs the previous equal-length period ────────────────────
export function DeltaChip({ now, prev, title }: { now: number; prev: number | null | undefined; title: string }) {
  if (prev == null) return null;
  if (prev === 0 && now === 0) return <span className="owx-delta flat" title={title}>—</span>;
  if (prev === 0) return <span className="owx-delta up" title={title}><i className="fas fa-arrow-up" aria-hidden="true" />new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (Math.abs(pct) < 1) return <span className="owx-delta flat" title={title}>±0%</span>;
  const up = pct > 0;
  // Huge jumps (test data, first real week…) read better as "12×" than "↑1174%".
  const label = pct >= 300 ? `${Math.round(now / prev)}×` : `${Math.abs(pct)}%`;
  return (
    <span className={`owx-delta ${up ? "up" : "down"}`} title={title}>
      <i className={`fas fa-arrow-${up ? "up" : "down"}`} aria-hidden="true" />{label}
    </span>
  );
}

function Empty() {
  return <div style={{ height: 120, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>No data in this range yet.</div>;
}

// ── ToggleChart — ONE time-series the viewer flips between BARS and a filled LINE.
// The "Bar / Line" pill sits top-right (owner's reference). `money` picks ₹ vs plain-count
// formatting + tooltip. Data is normalised to {label, value}; used by the hub + every
// time-based report so the toggle behaves identically everywhere.
// `cost` is an OPTIONAL second series — the "cost line" that was deferred until the
// inventory module existed (mig 227). Passing it is purely additive: when it's absent the
// render path, domains and tooltips are byte-for-byte what they were, so no existing
// report changes. When present, each datum carries a `cost` and the chart draws it as a
// second bar/line on the SAME x-axis (the caller aligns the buckets, so a point can never
// land on the wrong day).
export function ToggleChart({ data, color, money = true, height = 240, name, title, defaultMode = "bar", cost, costName = "Cost" }: {
  data: { label: string; value: number; cost?: number }[]; color: string; money?: boolean; height?: number; name?: string; title?: string; defaultMode?: "bar" | "line";
  cost?: boolean; costName?: string;
}) {
  const [mode, setMode] = useState<"bar" | "line">(defaultMode);
  const label = name || (money ? "Revenue" : "Orders");
  const fmt = money ? compact : (v: number) => Math.round(v).toString();
  const values = data.map((d) => d.value);
  // The cost series shares the value axis, so it must be inside the domain too — otherwise
  // a cost spike taller than revenue would be clipped and silently under-read.
  const costValues = cost ? data.map((d) => Number(d.cost) || 0) : [];
  const max = Math.max(1, ...values, ...costValues);
  const COST_COLOR = "#f59e0b";
  const enough = populated(values) >= MIN_POINTS;
  // The gradient id must be unique PER CHART INSTANCE, not per series label. It used to be
  // derived from `label` alone, so the Day summary — which renders "Revenue through the day"
  // and the Busy-hours chart, both money charts with no `name` — emitted the same
  // id="own-tg-Revenue" twice. Duplicate SVG ids mean the second <linearGradient> is ignored
  // and both charts fill from the FIRST one; identical colours hid it, but giving either
  // chart its own colour later would silently paint both the same (found 2026-08-04).
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gid = `own-tg-${cssId(label)}-${uid}`;
  return (
    <div>
      <div className="rs-tc-head">
        <span className="rs-tc-title">{title || ""}</span>
        {enough && (
          <div className="rs-tc-toggle" role="tablist" aria-label="Chart type">
            <button role="tab" aria-selected={mode === "bar"} className={mode === "bar" ? "on" : ""} onClick={() => setMode("bar")}>Bar</button>
            <button role="tab" aria-selected={mode === "line"} className={mode === "line" ? "on" : ""} onClick={() => setMode("line")}>Line</button>
          </div>
        )}
      </div>
      {!enough ? (
        <NotEnough height={height} value={populated(values) === 1 ? (money ? inr(soleValue(values)) : String(Math.round(soleValue(values)))) : undefined} />
      ) : (
        <ScrollX count={data.length} height={height}>
          <ResponsiveContainer>
            {mode === "bar" ? (
              <BarChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
              {/* The LAST date label kept getting clipped to one character at 360px: with
                  interval="preserveStartEnd" the final tick is centred on the final bar, which
                  sits at the plot's right edge, so half its text fell outside the SVG (T12 phone
                  sweep, 2026-08-13). `padding.right` moves the last bar inside the plot instead of
                  widening the chart, so the label has room at every width and nothing else moves. */}
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={14} interval="preserveStartEnd" padding={{ left: 2, right: 14 }} />
                <YAxis domain={[0, max]} ticks={tk(0, max)} tick={{ fontSize: 11, fill: AXIS }} width={money ? 48 : 36} tickFormatter={fmt} allowDecimals={false} />
                <Tooltip content={money ? <MoneyTip /> : <CountTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
                <Bar dataKey="value" name={label} fill={color} radius={[5, 5, 0, 0]} maxBarSize={46} />
                {cost && <Bar dataKey="cost" name={costName} fill={COST_COLOR} radius={[5, 5, 0, 0]} maxBarSize={46} />}
              </BarChart>
            ) : (
              <AreaChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
                <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={24} interval="preserveStartEnd" padding={{ left: 2, right: 14 }} />
                <YAxis domain={cost ? [0, max] : fitDomain(values)} ticks={cost ? tk(0, max) : tk(...fitDomain(values))} tick={{ fontSize: 11, fill: AXIS }} width={money ? 48 : 36} tickFormatter={fmt} allowDecimals={false} />
                <Tooltip content={money ? <MoneyTip /> : <CountTip />} />
                <Area type="monotone" dataKey="value" name={label} stroke={color} strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} fill={`url(#${gid})`} />
                {cost && <Area type="monotone" dataKey="cost" name={costName} stroke={COST_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} fill="none" />}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </ScrollX>
      )}
    </div>
  );
}

// ── Heatmap — day-of-week × hour busy grid (interactive redesign, 2026-07-26) ──
// Sequential magnitude viz (dataviz skill: ONE hue, light→dark by value). It now
// follows the owner's chosen top range (was pinned to the last 7 days) and is fully
// interactive:
//   · Orders ⇄ Revenue metric toggle — instant, repaints intensity + readout (both
//     numbers travel in every payload, so toggling needs no refetch → zero egress).
//   · Click any cell → a readout of that exact day + hour (orders AND ₹).
//   · A less→more legend so the colour actually carries meaning.
//   · ⤢ Enlarge → a big, keyboard-focusable modal (the inline cells are far under a
//     44px tap target; the modal is the accessible large-cell view). Registered in
//     the back-button manager so hardware-back closes it first.
const DOW_LB = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hr12 = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
const hrRange = (h: number) => `${hr12(h)}–${hr12((h + 1) % 24)}`;
type HeatCell = { dow: number; hr: number; orders: number; revenue?: number };

const hmBtn: CSSProperties = { background: "var(--bg)", border: "var(--border)", color: "var(--text)", width: 28, height: 28, borderRadius: 8, cursor: "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center" };
const hmOverlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(5,8,14,.6)", backdropFilter: "blur(3px)" };
const hmCard: CSSProperties = { background: "var(--card)", border: "var(--border)", borderRadius: 16, padding: 20, width: "min(960px, 96vw)", maxHeight: "92vh", overflow: "auto", boxShadow: "0 24px 70px rgba(0,0,0,.5)" };

export function Heatmap({ data, accent, rangeLabel }: { data: HeatCell[]; accent: string; rangeLabel?: string }) {
  const hasRevenue = data.some((d) => (d.revenue ?? 0) > 0);
  const [metric, setMetric] = useState<"orders" | "revenue">("orders");
  const [sel, setSel] = useState<{ dow: number; hr: number } | null>(null);
  const [big, setBig] = useState(false);
  useBackClose("owner-heatmap-zoom", big, () => setBig(false));

  if (!data.length || !data.some((d) => d.orders > 0)) return <Empty />;

  const m: "orders" | "revenue" = hasRevenue ? metric : "orders";
  // Two grids so flipping the metric is instant (no refetch): orders + paid revenue.
  const gOrders: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  const gRev: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const d of data) if (d.dow >= 0 && d.dow < 7 && d.hr >= 0 && d.hr < 24) {
    gOrders[d.dow][d.hr] = d.orders;
    gRev[d.dow][d.hr] = d.revenue ?? 0;
  }
  const grid = m === "revenue" ? gRev : gOrders;
  const max = Math.max(1, ...grid.flat());
  const selVal = sel ? { orders: gOrders[sel.dow][sel.hr], revenue: gRev[sel.dow][sel.hr] } : null;
  const toggle = (dow: number, hr: number) => setSel((s) => (s && s.dow === dow && s.hr === hr ? null : { dow, hr }));
  const cellTip = (d: number, h: number) => `${DOW_LB[d]} ${hrRange(h)} · ${gOrders[d][h].toLocaleString("en-IN")} order${gOrders[d][h] === 1 ? "" : "s"}${hasRevenue ? ` · ${inr(gRev[d][h])}` : ""}`;

  const controls = (large: boolean) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {hasRevenue ? (
        <div style={{ display: "inline-flex", background: "var(--bg)", border: "var(--border)", borderRadius: 9, padding: 2, gap: 2 }}>
          {(["orders", "revenue"] as const).map((k) => (
            <button key={k} onClick={() => setMetric(k)}
              style={{ border: "none", cursor: "pointer", font: "inherit", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 7, background: m === k ? accent : "transparent", color: m === k ? "#06251a" : "var(--muted)" }}>
              {k === "orders" ? "Orders" : "Revenue"}
            </button>
          ))}
        </div>
      ) : <span />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        {selVal
          ? <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }}>{DOW_LB[sel!.dow]} · {hrRange(sel!.hr)} · {selVal.orders.toLocaleString("en-IN")} order{selVal.orders === 1 ? "" : "s"}{hasRevenue ? ` · ${inr(selVal.revenue)}` : ""}</span>
          : <span style={{ fontSize: 11, color: "var(--muted)" }}>Tap a cell for details</span>}
        {!large && <button onClick={() => setBig(true)} title="Enlarge" aria-label="Enlarge heatmap" style={hmBtn}><i className="fas fa-up-right-and-down-left-from-center" aria-hidden="true" /></button>}
      </div>
    </div>
  );

  const gridView = (large: boolean) => {
    const minCell = large ? 22 : 12, rad = large ? 5 : 3, labelEvery = large ? 2 : 4;
    const labelFs = large ? 10 : 9, dayFs = large ? 12 : 10.5, colW = large ? 40 : 34;
    return (
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `${colW}px repeat(24, 1fr)`, gap: large ? 4 : 3, minWidth: large ? minCell * 24 + colW : 430 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{ fontSize: labelFs, color: "var(--muted)", textAlign: "center", whiteSpace: "nowrap" }}>{h % labelEvery === 0 ? hr12(h) : ""}</div>
          ))}
          {grid.map((row, d) => (
            <Fragment key={d}>
              <div style={{ fontSize: dayFs, color: sel?.dow === d ? "var(--text)" : "var(--muted)", fontWeight: sel?.dow === d ? 800 : 500, display: "flex", alignItems: "center" }}>{DOW_LB[d]}</div>
              {row.map((v, h) => {
                const on = sel?.dow === d && sel?.hr === h;
                return (
                  <div key={h} onClick={() => toggle(d, h)} title={cellTip(d, h)} role="button" tabIndex={large ? 0 : -1}
                    aria-label={`${DOW_FULL[d]} ${hrRange(h)}, ${gOrders[d][h]} orders${hasRevenue ? `, ${inr(gRev[d][h])}` : ""}`}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(d, h); } }}
                    style={{
                      aspectRatio: "1", borderRadius: rad, minWidth: minCell, cursor: "pointer",
                      background: v > 0 ? `color-mix(in srgb, ${accent} ${Math.max(8, Math.round((v / max) * 100))}%, transparent)` : "rgba(128,128,128,.08)",
                      boxShadow: on ? `0 0 0 2px ${accent}` : "none",
                    }} />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    );
  };

  // The scale is REBUILT when you flip Orders ⇄ Revenue, so the same shade means 3 orders on one
  // view and ₹18,000 on the other. Printing the two ends is what makes the colour mean something
  // (T5 sweep, 2026-08-06).
  const legendHi = m === "revenue" ? compact(max) : Math.round(max).toLocaleString("en-IN");
  const legend = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 10, color: "var(--muted)" }}>
      <span>0</span>
      {[10, 30, 55, 80, 100].map((p) => (
        <span key={p} style={{ width: 16, height: 10, borderRadius: 2, background: `color-mix(in srgb, ${accent} ${p}%, transparent)` }} />
      ))}
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "var(--text)" }}>{legendHi}</span>
      <span style={{ marginLeft: "auto" }}>{m === "revenue" ? "revenue" : "orders"} in the busiest hour · day × hour</span>
    </div>
  );

  return (
    <>
      {controls(false)}
      {gridView(false)}
      {legend}
      {big && (
        <div role="dialog" aria-label="Busy heatmap enlarged" style={hmOverlay} onClick={(e) => { if (e.target === e.currentTarget) setBig(false); }}>
          <div style={hmCard}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <b style={{ fontSize: 15 }}>Busy heatmap{rangeLabel ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {rangeLabel}</span> : null}</b>
              <button onClick={() => setBig(false)} aria-label="Close" style={hmBtn}>✕</button>
            </div>
            {controls(true)}
            {gridView(true)}
            {legend}
          </div>
        </div>
      )}
    </>
  );
}

// ── StackedDailyBars — 2–3 restaurants: each day = ONE bar split by restaurant ──
// (owner 2026-07-26, Samsung-screen-time style). Hover = per-restaurant dot + name
// + ₹ (MoneyTip already renders exactly that); the restaurant legend sits top-right.
export function StackedDailyBars({ data, lines, height = 260 }: {
  data: Record<string, unknown>[];
  lines: { key: string; name: string; color: string }[];
  height?: number;
}) {
  if (!data.length || !lines.length) return <Empty />;
  const totals = data.map((row) => lines.reduce((a, l) => a + (Number(row[l.key]) || 0), 0));
  if (populated(totals) < MIN_POINTS) return <NotEnough height={height} value={populated(totals) === 1 ? inr(soleValue(totals)) : undefined} />;
  const max = Math.max(1, ...totals);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 14px", marginBottom: 8 }} role="list">
        {lines.map((l) => (
          <span key={l.key} role="listitem" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: l.color, display: "inline-block" }} aria-hidden="true" />{l.name}
          </span>
        ))}
      </div>
      <ScrollX count={data.length} height={height}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={16} />
            <YAxis domain={[0, max]} ticks={tk(0, max)} tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} allowDecimals={false} />
            <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
            {lines.map((l, i) => (
              <Bar key={l.key} dataKey={l.key} name={l.name} stackId="day" fill={l.color}
                radius={i === lines.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]} maxBarSize={42} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ScrollX>
    </div>
  );
}
