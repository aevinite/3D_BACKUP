"use client";
// OrdersTrend — a small orders-per-bucket bar chart shared by Platform Analytics and
// the per-restaurant Report. Order COUNTS only, never money (CLAUDE.md hard rule:
// no food-revenue anywhere in /aevinite). Lives in its own file so the page can
// `next/dynamic(..., { ssr: false })` it — recharts only loads for the pages that
// actually render a chart, not the whole admin bundle.
//
// Chart hygiene (dataviz spec): solid hairline grid (never dashed), bars ≤24px with
// a 4px rounded data-end, no entry animation (an animating-from-zero bar reads as an
// empty chart on first paint), zero-filled buckets from the API, and time-axis ticks
// that auto-thin to the range (house adaptive-time-axis rule: today→hours, 30d→~every
// 4th day) instead of colliding or vanishing.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export type TrendPoint = { day: string; orders: number };

const fmtDay = (iso: string) => {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00+05:30" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
};
const fmtHour = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-IN", { hour: "numeric", timeZone: "Asia/Kolkata" }).replace(" ", "");
};

export default function OrdersTrend({ data, bucket = "day" }: { data: TrendPoint[]; bucket?: "day" | "hour" }) {
  if (!data || data.length === 0) return <div className="adm-empty">No orders in this range.</div>;
  const fmt = bucket === "hour" ? fmtHour : fmtDay;
  const rows = data.map((d) => ({ ...d, label: fmt(d.day) }));
  // Adaptive tick thinning: aim for ~8 labelled ticks whatever the range
  // (24 hours → every 3rd, 30 days → every 4th, 7 days → all).
  const tickEvery = Math.max(0, Math.ceil(rows.length / 8) - 1);
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--muted2, rgba(120,120,120,0.16))" strokeWidth={1} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval={tickEvery} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)", fontVariantNumeric: "tabular-nums" } as never} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--muted2, rgba(120,120,120,0.25))", borderRadius: 8, fontSize: 12.5 }}
            labelStyle={{ color: "var(--text)", fontWeight: 700 }}
            formatter={(v) => [v, "Orders"]}
          />
          <Bar dataKey="orders" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
