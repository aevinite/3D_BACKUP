"use client";
// OrdersTrend — a small orders-per-day bar chart shared by Platform Analytics and
// the per-restaurant Report. Order COUNTS only, never money (CLAUDE.md hard rule:
// no food-revenue anywhere in /aevinite). Lives in its own file so the page can
// `next/dynamic(..., { ssr: false })` it — recharts only loads for the pages that
// actually render a chart, not the whole admin bundle.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export type TrendPoint = { day: string; orders: number };

const fmtDay = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
};

export default function OrdersTrend({ data }: { data: TrendPoint[] }) {
  if (!data || data.length === 0) return <div className="adm-empty">No orders in this range.</div>;
  const rows = data.map((d) => ({ ...d, label: fmtDay(d.day) }));
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--muted2, rgba(120,120,120,0.18))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--muted2, rgba(120,120,120,0.25))", borderRadius: 8, fontSize: 12.5 }}
            labelStyle={{ color: "var(--text)", fontWeight: 700 }}
            formatter={(v) => [v, "Orders"]}
          />
          <Bar dataKey="orders" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
