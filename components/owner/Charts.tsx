"use client";
// Owner-dashboard chart kit — thin, theme-aware Recharts wrappers. Series are
// coloured by each restaurant's own accent. Tooltips formatted as ₹. All sit in a
// fixed-height responsive box so they render inside the .adm cards on light/dark.
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-US");
const AXIS = "var(--muted)";
const GRID = "var(--border-c, rgba(128,128,128,.18))";

// Shared tooltip — small card, ₹ for money keys.
function box(children: React.ReactNode) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border-c, rgba(128,128,128,.3))", borderRadius: 10, padding: "8px 10px", fontSize: 12, boxShadow: "0 6px 20px rgba(0,0,0,.12)" }}>
      {children}
    </div>
  );
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MoneyTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return box(<>
    {label != null && <div style={{ color: "var(--muted)", marginBottom: 4 }}>{label}</div>}
    {payload.map((p: { name: string; value: number; color: string }, i: number) => (
      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, display: "inline-block" }} />
        <b>{p.name}</b>: {inr(p.value)}
      </div>
    ))}
  </>);
}

export type RevDatum = { id: string; name: string; revenue: number; orders: number; accentColor: string };

// Horizontal "who earns more" bar — each bar in that restaurant's accent. Clickable.
export function RevenueBar({ data, onSelect }: { data: RevDatum[]; onSelect?: (id: string) => void }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: Math.max(140, data.length * 42) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tickFormatter={(v) => "₹" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} tick={{ fontSize: 11, fill: AXIS }} />
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

// Revenue trend. `lines` = which series + colours; `data` rows like {label, [key]:value}.
export function TrendLine({ data, lines, money = true }: { data: Record<string, unknown>[]; lines: { key: string; name: string; color: string }[]; money?: boolean }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 230 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} tickFormatter={(v) => money ? "₹" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v) : v} width={44} />
          <Tooltip content={money ? <MoneyTip /> : undefined} />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {lines.map((l) => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Orders-by-hour bar (busy times).
export function HourlyBar({ data, color }: { data: { hour: number; orders: number }[]; color: string }) {
  if (!data.length) return <Empty />;
  // fill missing hours so the axis reads 0–23 continuously
  const byHour = new Map(data.map((d) => [d.hour, d.orders]));
  const full = Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, orders: byHour.get(h) || 0 }));
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={full} margin={{ left: 0, right: 8, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} interval={2} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={28} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="orders" name="Orders" fill={color} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Revenue-by-DAY bars for ONE restaurant (used when a single restaurant is picked —
// a bar-per-day reads far clearer than one lonely bar in the by-restaurant chart).
export function TimeBar({ data, color }: { data: { label: string; revenue: number }[]; color: string }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ width: "100%", height: 230 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 4, right: 14, top: 6, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} minTickGap={16} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={44} tickFormatter={(v) => "₹" + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
          <Tooltip content={<MoneyTip />} cursor={{ fill: "rgba(128,128,128,.08)" }} />
          <Bar dataKey="revenue" name="Revenue" fill={color} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Category donut — shades derived from the restaurant accent + a palette.
const PALETTE = ["#e3935b", "#5b8def", "#3fb98a", "#e0b341", "#a36bd4", "#e2607a", "#4bbdc9", "#9aa84a"];
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

function Empty() {
  return <div style={{ height: 120, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 13 }}>No data in this range yet.</div>;
}
