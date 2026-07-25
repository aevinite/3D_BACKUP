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
import { useState } from "react";
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
          <YAxis domain={fitDomain(values)} tick={{ fontSize: 11, fill: AXIS }} tickFormatter={compact} width={48} allowDecimals={false} />
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
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={compact} allowDecimals={false} />
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
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={28} allowDecimals={false} />
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
  if (!data.length) return <Empty />;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 12, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={14} interval="preserveStartEnd" />
          <YAxis domain={[0, max]} tick={{ fontSize: 11, fill: AXIS }} width={34} allowDecimals={false} />
          <Tooltip content={<CountTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="value" name={name} fill={color} radius={[5, 5, 0, 0]} maxBarSize={46} />
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
  if (!rows.length || !methods.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 200 }}>
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
  const max = Math.max(1, ...data.map((d) => d.value));
  const values = data.map((d) => d.value);
  const gid = "own-tg-" + cssId(label);
  return (
    <div>
      <div className="rs-tc-head">
        <span className="rs-tc-title">{title || ""}</span>
        <div className="rs-tc-toggle" role="tablist" aria-label="Chart type">
          <button role="tab" aria-selected={mode === "bar"} className={mode === "bar" ? "on" : ""} onClick={() => setMode("bar")}>Bar</button>
          <button role="tab" aria-selected={mode === "line"} className={mode === "line" ? "on" : ""} onClick={() => setMode("line")}>Line</button>
        </div>
      </div>
      {!data.length ? <Empty /> : (
        <div style={{ width: "100%", height }}>
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
        </div>
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
