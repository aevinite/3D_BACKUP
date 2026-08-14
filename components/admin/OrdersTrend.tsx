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
import { decideTimeView, labelFor, type Grain } from "@/lib/timeView";

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

export default function OrdersTrend({ data, bucket = "day", windowLabel = "this range", onDrill, drilledInto, onBack }: {
  data: TrendPoint[];
  bucket?: "day" | "hour";
  /** "the last 7 days" — used in the plain-words line above a drilled chart. */
  windowLabel?: string;
  /** Present = the caller CAN cheaply fetch one bucket at a finer grain (see lib/timeView). */
  onDrill?: (dayIso: string) => void;
  /** Set while showing a drilled-into bucket, so we can offer the way back. */
  drilledInto?: string | null;
  onBack?: () => void;
}) {
  const grain: Grain = bucket === "hour" ? "hour" : "day";
  const verdict = decideTimeView(data, { grain, canDrill: !!onDrill });

  // Nothing at all — say it plainly rather than drawing an empty pair of axes.
  if (verdict.mode === "empty") {
    return (
      <div className="adm-empty" style={{ display: "grid", gap: 6, placeItems: "center", padding: "26px 16px" }}>
        <div style={{ fontSize: 13 }}>No orders in {windowLabel}.</div>
        {drilledInto && onBack ? <BackLink onBack={onBack} /> : null}
      </div>
    );
  }

  // One bucket, and no finer grain to fall back on: the number IS the answer.
  if (verdict.mode === "single") {
    return (
      <div className="adm-empty" style={{ display: "grid", gap: 6, placeItems: "center", padding: "26px 16px" }}>
        <div style={{ fontSize: 13 }}>Not enough activity to draw a trend yet.</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
          {verdict.value} {verdict.value === 1 ? "order" : "orders"} · {labelFor(verdict.whenIso, grain)}
        </div>
        <div style={{ fontSize: 11.5 }}>A trend needs orders in more than one {grain}.</div>
        {drilledInto && onBack ? <BackLink onBack={onBack} /> : null}
      </div>
    );
  }

  // Everything is piled into one bucket — offer that bucket at a finer grain instead of a plot
  // that is mostly empty columns. The caller fetches it (one scoped query) and re-renders.
  if (verdict.mode === "drill") {
    const when = labelFor(verdict.intoIso, grain);
    const pct = Math.round(verdict.share * 100);
    return (
      <div className="adm-empty" style={{ display: "grid", gap: 8, placeItems: "center", padding: "24px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
          {verdict.value} {verdict.value === 1 ? "order" : "orders"} · {when}
        </div>
        <div style={{ fontSize: 12.5, maxWidth: 340, lineHeight: 1.5 }}>
          {verdict.share >= 0.999
            ? `That was the only day with orders in ${windowLabel}, so a ${grain}-by-${grain} chart would be one bar and a lot of empty space.`
            : `${pct}% of the orders in ${windowLabel} landed on that one day, so the trend across the whole window says very little.`}
        </div>
        <button type="button" className="adm-btn" onClick={() => onDrill?.(verdict.intoIso)}
          style={{ marginTop: 2 }}>
          See {when} hour by hour
        </button>
      </div>
    );
  }

  // ── a real trend ────────────────────────────────────────────────────────────────
  const fmt = bucket === "hour" ? fmtHour : fmtDay;
  const rows = data.map((d) => ({ ...d, label: fmt(d.day) }));
  // Adaptive tick thinning: aim for ~8 labelled ticks whatever the range
  // (24 hours → every 3rd, 30 days → every 4th, 7 days → all).
  const tickEvery = Math.max(0, Math.ceil(rows.length / 8) - 1);
  return (
    <>
      {drilledInto ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Showing <strong style={{ color: "var(--text)" }}>{labelFor(drilledInto, "day")}</strong> hour by hour — the rest of {windowLabel} had almost nothing.
          </div>
          {onBack ? <BackLink onBack={onBack} /> : null}
        </div>
      ) : null}
    {/* DENSE → SCROLL, don't squeeze (the other half of the rule). Bars stay ≥22px by giving the
        chart a minimum width and letting the card scroll sideways when there are too many buckets to
        fit; it still fills the card when they do fit, so nothing changes for a normal range. */}
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
    </>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="adm-btn" onClick={onBack} style={{ fontSize: 12 }}>
      ← Back to the whole range
    </button>
  );
}
