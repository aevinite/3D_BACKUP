// lib/timeView.ts — ONE place that answers "what shape should this time chart be?"
//
// THE PROBLEM IT SOLVES (owner, 2026-08-14). Platform Analytics over 7 days drew one tall bar
// on 06 Aug, a 6px stub, a 2px sliver and four completely empty columns across a ~1000px plot.
// Nothing was broken: the old rule was "fewer than 2 buckets with orders → show text instead",
// and 3 buckets had orders, so it drew a chart. But a chart where one bar is 97% of the total
// and most columns are blank answers no question — it just looks broken. His words: "if [the]
// graph is of all months and [has] only data of 1 month, [it should] change automatically to
// days instead of all months … and if you have lowest then you can do that text stuff not enough
// data … make sure it's dynamic, it should change its style acc to the data availability".
//
// So the decision is no longer a single count. It is a ladder, checked in order:
//
//   nothing at all                  → "empty"   say so plainly, draw no axes
//   one bucket with activity        → "single"  the number as a stat + when it happened
//   activity crammed into one spot  → "drill"   redraw the busy bucket at a finer grain
//                                               (month → day → hour), with a line saying why
//   otherwise                       → "chart"   a normal trend, which is what most days look like
//
// WHY A SEPARATE FILE: the owner cockpit has its own populated()/NotEnough/ScrollX rules in
// components/owner/Charts.tsx, and the admin console had a second, weaker copy of the same idea.
// This is the shared brain both can call. It is deliberately PURE — no fetching, no React — so
// the drill decision can be unit-tested and so the caller stays in charge of what it costs to
// fetch the finer data (see the egress note on `canDrill` below).

export type Grain = "month" | "day" | "hour";

export type TimePoint = { day: string; orders: number };

export type TimeVerdict =
  /** Enough spread to be worth plotting. */
  | { mode: "chart" }
  /** Nothing happened in this window. */
  | { mode: "empty" }
  /** Exactly one bucket has activity and we cannot (or need not) go finer. */
  | { mode: "single"; value: number; whenIso: string }
  /** Activity is crammed into one bucket — redraw THAT bucket one grain finer. */
  | { mode: "drill"; intoIso: string; value: number; share: number; nextGrain: Grain };

/** The next finer grain, or null when we are already as fine as this app goes. */
export function finer(grain: Grain): Grain | null {
  return grain === "month" ? "day" : grain === "day" ? "hour" : null;
}

/** Buckets that carry real activity. A zero bucket is not a data point. */
export const populatedCount = (pts: TimePoint[]) => pts.filter((p) => (Number(p.orders) || 0) > 0).length;

// How lopsided a window has to be before drilling beats plotting it flat. Both must hold:
//   · at least half the buckets are empty  — a full-looking chart is never "crammed"
//   · the busiest bucket holds ≥70% of everything — one bar really is the whole story
// Tuned against the case that started this (7 buckets, 4 empty = 57%, top bar 97%). A normal
// trading week (every day busy, top day ~25%) fails both and is plotted, unchanged.
const EMPTY_SHARE_MIN = 0.5;
const TOP_SHARE_MIN = 0.7;

/**
 * Decide how to render a time series.
 *
 * `canDrill` is the CALLER's promise that fetching one bucket at the finer grain is cheap and
 * scoped — for the admin trend that is the same RPC with a narrower from/to and p_bucket:'hour',
 * so 24 rows for ONE day, indexed on created_at. Never pass true for something that would make
 * the page re-read a whole table (see the data-cost-guard rule); pass false and the ladder simply
 * stops at "single"/"chart" instead.
 */
export function decideTimeView(
  points: TimePoint[] | null | undefined,
  opts: { grain: Grain; canDrill?: boolean },
): TimeVerdict {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length === 0) return { mode: "empty" };

  const total = pts.reduce((n, p) => n + (Number(p.orders) || 0), 0);
  if (total <= 0) return { mode: "empty" };

  const withActivity = pts.filter((p) => (Number(p.orders) || 0) > 0);
  const top = withActivity.reduce((a, b) => ((Number(b.orders) || 0) > (Number(a.orders) || 0) ? b : a));

  // One lonely bucket: there is no trend to draw at any grain, so say the number.
  // (Drilling into a single bucket CAN still be worth it — one busy day split into hours is a
  //  real shape — so we only fall through to "single" when we cannot go finer.)
  const next = finer(opts.grain);
  if (withActivity.length < 2) {
    if (opts.canDrill && next) {
      return { mode: "drill", intoIso: top.day, value: Number(top.orders) || 0, share: 1, nextGrain: next };
    }
    return { mode: "single", value: Number(top.orders) || 0, whenIso: top.day };
  }

  // Several buckets have something, but it is all piled into one of them.
  const emptyShare = (pts.length - withActivity.length) / pts.length;
  const topShare = (Number(top.orders) || 0) / total;
  if (opts.canDrill && next && emptyShare >= EMPTY_SHARE_MIN && topShare >= TOP_SHARE_MIN) {
    return { mode: "drill", intoIso: top.day, value: Number(top.orders) || 0, share: topShare, nextGrain: next };
  }

  return { mode: "chart" };
}

/** "6 Aug" / "6 Aug, 2pm" — IST, matching the buckets the API hands back. */
export function labelFor(iso: string, grain: Grain): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00+05:30" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (grain === "hour") {
    return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}, ` +
      d.toLocaleTimeString("en-IN", { hour: "numeric", timeZone: "Asia/Kolkata" }).replace(" ", "").toLowerCase();
  }
  if (grain === "month") return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** The plain-words reason shown above a drilled chart. */
export function drillReason(v: Extract<TimeVerdict, { mode: "drill" }>, grain: Grain, windowLabel: string): string {
  const when = labelFor(v.intoIso, grain);
  const pct = Math.round(v.share * 100);
  const unit = v.nextGrain === "hour" ? "hour by hour" : "day by day";
  return v.share >= 0.999
    ? `${when} was the only ${grain} with orders in ${windowLabel} — showing it ${unit}.`
    : `${pct}% of orders in ${windowLabel} landed on ${when} — showing that ${grain} ${unit}.`;
}
