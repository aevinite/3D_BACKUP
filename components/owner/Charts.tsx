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
import { useState, Fragment, type CSSProperties } from "react";
import { useBackClose } from "@/lib/backStack";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, ComposedChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList,
} from "recharts";

const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-US");
const compact = (v: number) =>
  "₹" + (v >= 100000 ? (v / 100000).toFixed(1).replace(/\.0$/, "") + "L"
       : v >= 1000   ? (v / 1000).toFixed(1).replace(/\.0$/, "") + "k"
       : Math.round(v).toString());
const AXIS = "var(--muted)";
const GRID = "var(--border-c, rgba(128,128,128,.18))";

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
function ScrollX({ count, per = 24, height, children }: { count: number; per?: number; height: number; children: React.ReactNode }) {
  return (
    <div className="owx-scrollx" style={{ width: "100%", overflowX: "auto", overflowY: "hidden" }}>
      <div style={{ width: `max(100%, ${Math.round(count * per)}px)`, height }}>{children}</div>
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
        <div key={i}><b>{p.name}</b>: {p.value}</div>
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
  if (!data.length || !lines.length) return <Empty />;
  const values = data.flatMap((row) => lines.map((l) => Number(row[l.key]) || 0));
  const single = lines.length === 1;
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
                <linearGradient key={l.key} id={`own-g-${cssId(l.key)}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={l.color} stopOpacity={0.36} />
                  <stop offset="100%" stopColor={l.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} minTickGap={24} />
            <YAxis domain={fitDomain(values)} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={48} allowDecimals={false} />
            {/* Crosshair + ringed active dot = the "pretty" hover from the design demos
                the owner asked to match (2026-07-26). */}
            <Tooltip content={<MoneyTip />} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3", strokeOpacity: 0.5 }} />
            {lines.map((l) => (
              <Area key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color}
                strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                fill={single ? `url(#own-g-${cssId(l.key)})` : "transparent"} />
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
  if (!data.length) return <Empty />;
  const hasPrev = data.some((d) => (Number(d.prev) || 0) > 0);
  const values = data.flatMap((d) => [Number(d.cur) || 0, ...(hasPrev ? [Number(d.prev) || 0] : [])]);
  const gid = "own-g-monthcur";
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
            <YAxis domain={fitDomain(values)} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={48} allowDecimals={false} />
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
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={16} />
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} allowDecimals={false} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" fill={color} radius={[5, 5, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </ScrollX>
  );
}

// ── LeaderBar — "who earns more" across restaurants (3+ scope). Clickable. ──
export type RevDatum = { id: string; name: string; revenue: number; orders: number; accentColor: string };
export function LeaderBar({ data, onSelect }: { data: RevDatum[]; onSelect?: (id: string) => void }) {
  if (!data.length) return <Empty />;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  // Ranking bars: comfortable row height, but past ~8 rows the card would grow
  // unbounded — cap the visible height and scroll instead of stretching the page.
  const rowH = 42, visible = Math.min(data.length, 8);
  return (
    <div style={{ width: "100%", maxHeight: visible * rowH + 20, overflowY: data.length > 8 ? "auto" : "visible" }}>
     <div style={{ width: "100%", height: Math.max(140, data.length * rowH) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, max]} tickFormatter={compact} tick={{ fontSize: 11, fill: AXIS }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11.5, fill: AXIS }} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]} cursor={onSelect ? "pointer" : undefined}
            onClick={(d: { id?: string }) => d?.id && onSelect?.(d.id)}>
            {data.map((d) => <Cell key={d.id} fill={d.accentColor} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
     </div>
    </div>
  );
}

// ── WhoEarnsMore — the "Who earns more" card body (owner 2026-07-27) ─────────
// Same ranking data, three ways: 3-D Columns (default) · Bars (the ranked
// horizontal LeaderBar) · Line (the per-restaurant multi-line trend, reused from
// AreaTrend). A small segmented toggle at the top-right flips between them. This
// is the ONLY chart that changed — every other owner card is untouched.
// Flat gradient column (owner 2026-07-27: "forget 3d" — the drop-shadow + gloss looked
// blurry on the client site). Crisp rounded column, full colour at the top fading gently
// toward the base — the exact look from the approved design demo.
function Column3D(props: {
  x?: number; y?: number; width?: number; height?: number; fill?: string; index?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, fill = "#888", index = 0 } = props;
  if (height <= 0 || width <= 0) return null;
  const gid = `we-col-${index}`;
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
  const max = Math.max(1, ...data.map((d) => d.revenue));
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 24, bottom: 6 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: AXIS }} interval={0} angle={-28} textAnchor="end" height={74} />
          <YAxis domain={[0, max]} tickFormatter={compact} tick={{ fontSize: 11, fill: AXIS }} width={46} allowDecimals={false} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" shape={<Column3D />} maxBarSize={72} isAnimationActive={false}
            cursor={onSelect ? "pointer" : undefined}
            onClick={(d: { id?: string }) => d?.id && onSelect?.(d.id)}>
            <LabelList dataKey="revenue" position="top" formatter={((value: unknown) => compact(Number(value))) as never} style={{ fill: "var(--ink)", fontSize: 11, fontWeight: 700 }} />
            {data.map((d) => <Cell key={d.id} fill={d.accentColor} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WhoEarnsMore({ data, trendData, trendLines, onSelect }: {
  data: RevDatum[];
  trendData?: Record<string, unknown>[];
  trendLines?: { key: string; name: string; color: string }[];
  onSelect?: (id: string) => void;
}) {
  const [view, setView] = useState<"columns" | "bars" | "line">("columns");
  if (!data.length) return <Empty />;
  const sorted = [...data].sort((a, b) => b.revenue - a.revenue);
  const canLine = !!(trendData && trendData.length && trendLines && trendLines.length);
  const opts: [typeof view, string][] = [["columns", "Columns"], ["bars", "Bars"]];
  if (canLine) opts.push(["line", "Line"]);
  const v = view === "line" && !canLine ? "columns" : view;
  return (
    <div>
      <div style={{ display: "inline-flex", gap: 2, padding: 3, marginLeft: "auto", marginBottom: 8,
        background: "rgba(128,128,128,.14)", borderRadius: 9, float: "right" }}>
        {opts.map(([o, label]) => (
          <button key={o} type="button" onClick={() => setView(o)} aria-pressed={v === o}
            style={{ border: 0, cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 6,
              background: v === o ? "#e6b93f" : "transparent", color: v === o ? "#1a1205" : "var(--muted)" }}>{label}</button>
        ))}
      </div>
      <div style={{ clear: "both" }}>
        {v === "line" ? <AreaTrend data={trendData!} lines={trendLines!} height={248} />
          : v === "bars" ? <LeaderBar data={sorted} onSelect={onSelect} />
          : <ColumnsChart data={sorted} onSelect={onSelect} />}
      </div>
    </div>
  );
}

// ── HourlyBar — busy hours (orders by hour, count not money) ────────────────
export function HourlyBar({ data, color }: { data: { hour: number; orders: number }[]; color: string }) {
  if (!data.length) return <Empty />;
  const byHour = new Map(data.map((d) => [d.hour, d.orders]));
  const full = Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, orders: byHour.get(h) || 0 }));
  const max = Math.max(1, ...full.map((d) => d.orders));
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={full} margin={{ left: 0, right: 8, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          {/* Adaptive ticks (owner's axis rule): let Recharts drop labels by available
              width instead of a hard every-3rd-hour — narrow cards thin out, wide fill. */}
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={14} interval="preserveStartEnd" />
          {/* width must fit the widest count label — a busy restaurant's 4-digit hourly count
              (e.g. Green Bowl's 0/350/700/1050/1303) overflowed the old 28px axis, so each
              label's leading digit was clipped and the numbers read as a scrambled
              "303/050/700" (1303→303, 1050→050) — the owner's bug, 2026-07-25. Widen the axis
              + round to whole orders so the full label always fits. */}
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={40} allowDecimals={false} tickFormatter={(v: number) => Math.round(v).toString()} />
          <Tooltip content={<CountTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="orders" name="Orders" fill={color} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── CountBar — a generic count-per-bucket bar (orders/volume, not money) ─────
// Same visual language as TimeBar but the tooltip/axis are plain counts, not ₹.
export function CountBar({ data, color, name = "Orders", height = 220 }: {
  data: { label: string; value: number }[]; color: string; name?: string; height?: number;
}) {
  const values = data.map((d) => d.value);
  if (populated(values) < MIN_POINTS) return <NotEnough height={height} value={populated(values) === 1 ? String(Math.round(soleValue(values))) : undefined} />;
  const max = Math.max(1, ...values);
  return (
    <ScrollX count={data.length} height={height}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 12, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={14} interval="preserveStartEnd" />
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={34} allowDecimals={false} />
          <Tooltip content={<CountTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="value" name={name} fill={color} radius={[5, 5, 0, 0]} maxBarSize={46} />
        </BarChart>
      </ResponsiveContainer>
    </ScrollX>
  );
}

// ── CategoryDonut ───────────────────────────────────────────────────────────
const PALETTE = ["#34d399", "#5b8def", "#e0b341", "#e2607a", "#a36bd4", "#4bbdc9", "#e3935b", "#9aa84a"];
export function CategoryDonut({ data }: { data: { category: string; revenue: number }[] }) {
  if (!data.length) return <Empty />;
  // DYNAMIC legend (owner round-5): the old bottom legend wrapped into a wall of
  // text with 25+ categories and squeezed the donut. Now the legend fills the RIGHT
  // column first; past its capacity a LEFT column joins; past both, the text steps
  // down a size. The donut always keeps the middle. Sorted by revenue so the labels
  // an owner actually cares about are always at the top of the columns.
  const sorted = [...data].map((d, i) => ({ ...d, color: PALETTE[i % PALETTE.length] })).sort((a, b) => b.revenue - a.revenue);
  const n = sorted.length;
  const perCol = 9;                                   // comfortable rows per side column
  const twoCols = n > perCol;
  const small = n > perCol * 2;                       // both sides full → smaller text
  const right = twoCols ? sorted.filter((_, i) => i % 2 === 0) : sorted;
  const left = twoCols ? sorted.filter((_, i) => i % 2 === 1) : [];
  const total = sorted.reduce((a, d) => a + d.revenue, 0) || 1;
  const legendCol = (items: typeof sorted) => (
    <div style={{ display: "flex", flexDirection: "column", gap: small ? 3 : 5, minWidth: 0, flex: "1 1 0", maxHeight: 230, overflowY: "auto" }}>
      {items.map((d) => (
        <span key={d.category} title={`${d.category} · ${inr(d.revenue)} · ${Math.round((d.revenue / total) * 100)}%`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: small ? 10 : 11.5, fontWeight: 600, color: "var(--muted)", minWidth: 0 }}>
          <span style={{ width: small ? 8 : 9, height: small ? 8 : 9, borderRadius: 3, background: d.color, flexShrink: 0 }} aria-hidden="true" />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.category}</span>
          <span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", color: "var(--text)", flexShrink: 0 }}>{Math.round((d.revenue / total) * 100)}%</span>
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
  const color = (m: string) => PAY_COLORS[m] || PAY_COLORS["Not recorded"];
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
              {Math.round((p.revenue / total) * 100)}% · {p.orders} bill{p.orders === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SameHourBar — "is today actually good?" (the Restroworks honest compare) ─
// All four windows are cut at the SAME elapsed time, so a half-day is compared
// to half-days only. Current window in the accent, history in fading grays.
export function SameHourBar({ data, accent }: { data: { label: string; revenue: number }[]; accent: string }) {
  if (!data.length || !data.some((d) => d.revenue > 0)) return <Empty />;
  const grays = ["", "rgba(138,147,163,.45)", "rgba(138,147,163,.32)", "rgba(138,147,163,.22)"];
  const max = Math.max(1, ...data.map((d) => d.revenue));
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} interval={0} />
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} allowDecimals={false} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={52}>
            {data.map((d, i) => <Cell key={d.label} fill={i === 0 ? accent : grays[i] || grays[3]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── PayTrendStack — how money arrives, per day × method (stacked) ───────────
export function PayTrendStack({ data }: { data: { day: string; method: string; revenue: number }[] }) {
  // pivot rows → one object per day with a key per method, fixed method order.
  const methods = Object.keys(PAY_COLORS).filter((m) => data.some((r) => canonPayMethod(r.method) === m));
  const byDay = new Map<string, Record<string, number | string>>();
  for (const r of data) {
    const d = String(r.day);
    const row = byDay.get(d) || { day: d };
    const m = canonPayMethod(r.method);
    row[m] = (Number(row[m]) || 0) + r.revenue;
    byDay.set(d, row);
  }
  const rows = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((r) => ({ ...r, label: new Date(String(r.day)).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) }));
  if (!methods.length || rows.length < MIN_POINTS) return <NotEnough height={200} />;
  return (
    <ScrollX count={rows.length} height={200}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={14} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} allowDecimals={false} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {methods.map((m) => (
            <Bar key={m} dataKey={m} name={m} stackId="pay" fill={PAY_COLORS[m]} radius={[2, 2, 0, 0]} maxBarSize={26} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ScrollX>
  );
}

// ── Spark — tiny inline sparkline for KPI tiles (pure SVG, no axes) ─────────
// ── SparkArea — full-width gradient mini-trend for KPI cards (D1 look, 2026-07-26).
// preserveAspectRatio="none" lets it stretch across the whole card bottom.
export function SparkArea({ points, color, height = 34, animate = false }: { points: number[]; color: string; height?: number; animate?: boolean }) {
  if (points.length < 2) return null;
  const w = 300;
  const max = Math.max(...points, 1), min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const X = (i: number) => (i * step).toFixed(1);
  const Y = (v: number) => (height - 3 - ((v - min) / span) * (height - 6)).toFixed(1);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${X(i)},${Y(v)}`).join(" ");
  const gid = "spa" + Math.random().toString(36).slice(2, 7);
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
export function ToggleChart({ data, color, money = true, height = 240, name, title, defaultMode = "bar" }: {
  data: { label: string; value: number }[]; color: string; money?: boolean; height?: number; name?: string; title?: string; defaultMode?: "bar" | "line";
}) {
  const [mode, setMode] = useState<"bar" | "line">(defaultMode);
  const label = name || (money ? "Revenue" : "Orders");
  const fmt = money ? compact : (v: number) => Math.round(v).toString();
  const values = data.map((d) => d.value);
  const max = Math.max(1, ...values);
  const enough = populated(values) >= MIN_POINTS;
  const gid = "own-tg-" + cssId(label);
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
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={14} interval="preserveStartEnd" />
                <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={money ? 48 : 36} tickFormatter={fmt} allowDecimals={false} />
                <Tooltip content={money ? <MoneyTip /> : <CountTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
                <Bar dataKey="value" name={label} fill={color} radius={[5, 5, 0, 0]} maxBarSize={46} />
              </BarChart>
            ) : (
              <AreaChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
                <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={24} interval="preserveStartEnd" />
                <YAxis domain={fitDomain(values)} tick={{ fontSize: 11, fill: AXIS }} width={money ? 48 : 36} tickFormatter={fmt} allowDecimals={false} />
                <Tooltip content={money ? <MoneyTip /> : <CountTip />} />
                <Area type="monotone" dataKey="value" name={label} stroke={color} strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} fill={`url(#${gid})`} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </ScrollX>
      )}
    </div>
  );
}

// ── back-compat aliases — the current /aevinite admin page still imports these
// names; the admin redesign branch replaces that page, at which point these can go.
export const RevenueBar = LeaderBar;
export function TrendLine({ data, lines }: { data: Record<string, unknown>[]; lines: { key: string; name: string; color: string }[]; money?: boolean }) {
  return <AreaTrend data={data} lines={lines} height={230} />;
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

  const legend = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 10, color: "var(--muted)" }}>
      <span>Less</span>
      {[10, 30, 55, 80, 100].map((p) => (
        <span key={p} style={{ width: 16, height: 10, borderRadius: 2, background: `color-mix(in srgb, ${accent} ${p}%, transparent)` }} />
      ))}
      <span>More</span>
      <span style={{ marginLeft: "auto" }}>{m === "revenue" ? "revenue" : "orders"} · day × hour</span>
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
            <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} allowDecimals={false} />
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
