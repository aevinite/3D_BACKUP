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
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
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
  return (
    <TipBox>
      {label != null && <div style={{ color: "var(--muted)", marginBottom: 4 }}>{label}</div>}
      {payload.map((p: { name: string; value: number; color?: string; fill?: string }, i: number) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color || p.fill, display: "inline-block" }} />
          <b>{p.name}</b>: {inr(p.value)}
        </div>
      ))}
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
export function AreaTrend({ data, lines, height = 240 }: {
  data: Record<string, unknown>[];
  lines: { key: string; name: string; color: string }[];
  height?: number;
}) {
  if (!data.length || !lines.length) return <Empty />;
  const values = data.flatMap((row) => lines.map((l) => Number(row[l.key]) || 0));
  const single = lines.length === 1;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          <defs>
            {lines.map((l) => (
              <linearGradient key={l.key} id={`own-g-${cssId(l.key)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={l.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={l.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} minTickGap={24} />
          <YAxis domain={fitDomain(values)} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={48} />
          <Tooltip content={<MoneyTip />} />
          {!single && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {lines.map((l) => (
            <Area key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color}
              strokeWidth={2.25} dot={false} activeDot={{ r: 4 }}
              fill={single ? `url(#own-g-${cssId(l.key)})` : "transparent"} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
const cssId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

// ── TimeBar — revenue per bucket for ONE scope (bars, zero-based, fitted top) ─
export function TimeBar({ data, color, height = 240 }: { data: { label: string; revenue: number }[]; color: string; height?: number }) {
  if (!data.length) return <Empty />;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={16} />
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" fill={color} radius={[5, 5, 0, 0]} maxBarSize={42} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── LeaderBar — "who earns more" across restaurants (3+ scope). Clickable. ──
export type RevDatum = { id: string; name: string; revenue: number; orders: number; accentColor: string };
export function LeaderBar({ data, onSelect }: { data: RevDatum[]; onSelect?: (id: string) => void }) {
  if (!data.length) return <Empty />;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  return (
    <div style={{ width: "100%", height: Math.max(140, data.length * 42) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, max]} tickFormatter={compact} tick={{ fontSize: 11, fill: AXIS }} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11.5, fill: AXIS }} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" radius={[0, 6, 6, 0]} cursor={onSelect ? "pointer" : undefined}
            onClick={(d: { id?: string }) => d?.id && onSelect?.(d.id)}>
            {data.map((d) => <Cell key={d.id} fill={d.accentColor} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} interval={2} />
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={28} allowDecimals={false} />
          <Tooltip content={<CountTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="orders" name="Orders" fill={color} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── CategoryDonut ───────────────────────────────────────────────────────────
const PALETTE = ["#34d399", "#5b8def", "#e0b341", "#e2607a", "#a36bd4", "#4bbdc9", "#e3935b", "#9aa84a"];
export function CategoryDonut({ data }: { data: { category: string; revenue: number }[] }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 230 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="revenue" nameKey="category" innerRadius={52} outerRadius={86} paddingAngle={2} stroke="var(--card)">
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip content={<MoneyTip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Spark — tiny inline sparkline for KPI tiles (pure SVG, no axes) ─────────
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

// ── back-compat aliases — the current /aevinite admin page still imports these
// names; the admin redesign branch replaces that page, at which point these can go.
export const RevenueBar = LeaderBar;
export function TrendLine({ data, lines }: { data: Record<string, unknown>[]; lines: { key: string; name: string; color: string }[]; money?: boolean }) {
  return <AreaTrend data={data} lines={lines} height={230} />;
}
