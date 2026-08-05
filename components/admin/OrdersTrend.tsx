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
  // THE DYNAMIC-CHART RULE (CLAUDE.md): "< 2 points of real activity → NO chart". The API
  // zero-fills every bucket, so a quiet restaurant over 30 days arrived here as 1 real day and 29
  // empty ones — and this drew a single fat bar in a wide empty plot, which is exactly the shape
  // the rule bans ("a single value is a stat tile, not a one-bar chart"). Say the number instead.
  const populated = data.filter((d) => Number(d.orders) > 0);
  if (populated.length < 2) {
    const only = populated[0];
    const label = only ? (bucket === "hour" ? fmtHour(only.day) : fmtDay(only.day)) : "";
    return (
      <div className="adm-empty" style={{ display: "grid", gap: 6, placeItems: "center", padding: "26px 16px" }}>
        <div style={{ fontSize: 13 }}>Not enough activity to draw a trend yet.</div>
        {only ? (
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            {only.orders} {only.orders === 1 ? "order" : "orders"} · {label}
          </div>
        ) : null}
        <div style={{ fontSize: 11.5 }}>A chart needs at least two {bucket === "hour" ? "hours" : "days"} with orders in them.</div>
      </div>
    );
  }
  const fmt = bucket === "hour" ? fmtHour : fmtDay;
  const rows = data.map((d) => ({ ...d, label: fmt(d.day) }));
  // Adaptive tick thinning: aim for ~8 labelled ticks whatever the range
  // (24 hours → every 3rd, 30 days → every 4th, 7 days → all).
  const tickEvery = Math.max(0, Math.ceil(rows.length / 8) - 1);
  return (
    // DENSE → SCROLL, don't squeeze (the other half of the rule). Bars stay ≥22px by giving the
    // chart a minimum width and letting the card scroll sideways when there are too many buckets to
    // fit; it still fills the card when they do fit, so nothing changes for a normal range.
    <div style={{ width: "100%", height: 220, overflowX: "auto" }}>
      <div style={{ width: `max(100%, ${rows.length * 22}px)`, height: "100%" }}>
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
    </div>
  );
}
