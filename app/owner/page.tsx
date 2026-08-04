"use client";
// Owner · Dashboard — MERGED redesign (owner-approved 2026-07-26, spec in memory
// "owner-dashboard-merge-spec"). What changed vs the 2026-07-04 adaptive dashboard:
//   · NO global range tabs — every card carries its OWN small range dropdown
//     ("half the graphs didn't react to the global switch, so it looked broken").
//     Data is cached client-side PER (scope, range): cards sharing a range share one
//     fetch, and switching a card only fetches that range once (egress-safe).
//   · Top row = FIVE KPI cards (Revenue / Orders / Avg order / Today so far / Lost
//     to cancellations) with a sparkline living inside each card — no open-tables card.
//   · Breadcrumb merged into the shell's top strip (Owner › Dashboard › <name>) via
//     the lfh:owner-crumb event — the second heading row is gone.
//   · Single-restaurant view: revenue trend (tooltip shows ₹ AND orders), busy hours,
//     category donut, payment donut (the ONLY payment chart — same-hour + 14-day
//     stacked bars removed), NEW day×hour heatmap (mig 197), records, every-dish list,
//     recent-activity mini feed. Charts are theme-emerald — never the restaurant accent.
//   · Multi-restaurant: 2–3 → Samsung-style stacked daily bars (one bar per day,
//     split by restaurant); every multi tier gets ONE sortable table; a row click
//     slides a summary drawer from the right with "View in full detail" → the
//     restaurant's own dashboard (the owner's 3-phase drill).
//   · Report ▾ (top right): Print / CSV / Excel of what's currently on screen.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { inr, useActiveAutoRefresh } from "@/components/admin/shared";
import { asSuffix } from "@/lib/ownerPin";
import {
  AreaTrend, TimeBar, LeaderBar, WhoEarnsMore, CategoryDonut, PaymentDonut, canonPayMethod,
  DeltaChip, Spark, SparkArea, Heatmap, StackedDailyBars, RevMonthCompare,
} from "@/components/owner/Charts";
import { businessDayStartIso } from "@/lib/businessDay";
import { AnimatedNumber } from "@/components/owner/AnimatedNumber";
import { reportRealtime } from "@/lib/connectionStatus";
import { fetchOwnerOverview } from "@/lib/ownerOverviewCache";
import { readSnap, writeSnap } from "@/lib/ownerSnap";
import { useBackClose } from "@/lib/backStack";
import { buildReportHtml, buildReportTables, type ReportData, type ExportTable } from "@/components/owner/ownerReportDoc";
import { gatherOwnerReport } from "@/lib/ownerReportGather";
import { ReportMenu } from "@/components/owner/OwnerReportButton";

const DAY_MS = 86400000;
type Range = "today" | "yesterday" | "week" | "7d" | "month" | "30d" | "lastmonth" | "all";
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "week", label: "This week" }, { k: "7d", label: "Last 7 days" },
  { k: "month", label: "This month" }, { k: "30d", label: "Last 30 days" },
  { k: "lastmonth", label: "Last month" }, { k: "all", label: "All time" },
];
const RANGE_LABEL: Record<Range, string> = {
  today: "today", yesterday: "yesterday", week: "this week", "7d": "last 7 days",
  month: "this month", "30d": "last 30 days", lastmonth: "last month", all: "all time",
};
const PREV_LABEL: Record<Range, string> = {
  today: "vs yesterday (same hours)", yesterday: "vs the day before", week: "vs last week",
  "7d": "vs the 7 days before", month: "vs last month (so far)", "30d": "vs the 30 days before",
  lastmonth: "vs the month before", all: "",
};
// The owner's last-used range survives a refresh (owner 2026-07-27: "whenever I refresh
// it goes to 30 days again"). One browser-local key; validated against RANGES on read.
const RANGE_LS_KEY = "lfh-owner-range";
// Theme accent for every single-scope chart (owner 2026-07-26: "it should be green
// everywhere" — Burger Barn's charts were rendering in its brown accent).
const GREEN = "#34d399";
const GRAY_LINE = "#9ca3af";   // "last month" reference line (neutral grey — clearly visible over the green area)
const FALLBACK = GREEN;

type Restaurant = {
  id: string; slug: string; name: string; active: boolean; accentColor: string;
  ordersToday: number; revenueToday: number; ordersAll: number; revenueAll: number; openTables: number;
  // The admin has taken Reports away for this restaurant, so /api/owner/overview sends ZERO
  // revenue for it on purpose. Rendering that zero as a real figure made a trading restaurant
  // look dead — every money cell below says "hidden" instead (found 2026-08-04).
  reportsOff?: boolean;
};
type Overview = { restaurants: Restaurant[]; totals: { revenueToday: number; ordersToday: number; openTables: number; restaurantCount: number }; entitlements?: Record<string, boolean> };
type GroupRev = { id: string; slug: string; name: string; accentColor: string; revenue: number; orders: number };
type TsRow = { bucket: string; restaurantId?: string; revenue: number; orders: number };
type TsPrevRow = { bucket: string; revenue: number };
type Pay = { method: string; revenue: number; orders: number };
type HeatRow = { dow: number; hr: number; orders: number; revenue: number };
type Prev = { revenue: number; orders: number } | null;
type GroupA = { scope: "group"; restaurantRevenue: GroupRev[]; timeseries: TsRow[]; timeseriesPrev?: TsPrevRow[]; paymentMethods: Pay[]; heatmap?: HeatRow[]; categories?: { category: string; qty: number; revenue: number }[]; prev: Prev; cachedAt?: string; staffPay?: { paidOut: number; people: number; entries: number } | null };
type Dish = { title: string; qty: number; revenue: number };
type Records = {
  bestDay?: { date: string; revenue: number } | null;
  bigBill?: { table: string | null; revenue: number } | null;
  fastHour?: { at: string; orders: number } | null;
  starDish?: { title: string; qty: number } | null;
  regulars?: number | null;
} | null;
type RestA = {
  scope: "restaurant"; prev: Prev;
  restaurant: { id: string; slug: string; name: string; accentColor: string; heroTitle: string };
  kpis: { revenue: number; orders: number; paidOrders?: number; avgOrder: number; openTables: number; topDish: string };
  // Staff pay that LEFT in this window (mig 221). null = this restaurant doesn't have the
  // Staff-profiles-&-pay module, so no such tile is drawn at all.
  staffPay?: { paidOut: number; people: number; entries: number } | null;
  timeseries: TsRow[]; timeseriesPrev?: TsPrevRow[]; dishes: Dish[]; categories: { category: string; qty: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[]; paymentMethods: Pay[];
  heatmap?: HeatRow[]; records?: Records; cachedAt?: string;
};
type Payload = GroupA | RestA;
type MoneyTotals = { revenue: number; discount: number; cancelledOrders: number; cancelledValue: number; tax: number };
type View = { level: "home" } | { level: "restaurant"; rid: string } | { level: "dish"; rid: string; dish: string };
type Act = { id: string; panel: string; action: string; actor: string | null; table_number: string | null; created_at: string };

// Range model (owner round-2, 2026-07-26): ONE main dropdown top-right drives
// EVERYTHING — the KPI boxes and every graph ("it is for how much? for all the
// graphs"; owner: the boxes should have "only the main one"). The Busy HEATMAP now
// follows that main range too (owner 2026-07-26: "it should be shown from how much
// we have selected … and be clickable and interactive") — see the interactive
// Heatmap in Charts.tsx. Only Busy-HOURS stays PINNED to the last 7 days (a stable
// weekly rhythm; the weekFallback below finds the newest active week when empty).
const WEEK: Range = "7d";
// 2–3 restaurants: the split daily bars stay in the THEME's green family — light +
// dark green, a third non-brown colour only if needed (owner round-2: "only brown
// doesn't make sense"). Identity accent colours are for the many-tier only.
const GREEN_SHADES = ["#34d399", "#0f766e", "#a3e635"];
// 4+ restaurants: give each one a DISTINCT, SOLID colour (owner 2026-07-27: the charts
// looked "faded" and same-ish because most restaurants default to the same gold accent —
// so several bars/lines were the identical washed-out yellow). This vibrant qualitative
// palette assigns a clearly-different hue per restaurant BY POSITION, so no two adjacent
// restaurants share a colour and the same restaurant keeps its colour across the
// "Who earns more" bars AND the "Revenue over time" lines that sit side-by-side.
const PORTFOLIO_COLORS = [
  "#34d399", // emerald  (owner brand green first)
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#ef4444", // red
  "#eab308", // yellow
  "#f97316", // orange
  "#06b6d4", // cyan
];
/** Stable colour for a restaurant by its position in the portfolio list. */
const portfolioColor = (i: number) => PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length];

const IST = "Asia/Kolkata";
// Some RPCs return a zone-LESS IST wall-clock timestamp — see the note in the old
// dashboard (owner audit 2026-07-06): treat zone-less as UTC so numbers print the same
// wherever they're viewed.
function istWall(ts: string, opts: Intl.DateTimeFormatOptions): string {
  const zoneless = /T/.test(ts) && !/[Z+]|[+-]\d\d:?\d\d$/.test(ts);
  const d = new Date(zoneless ? ts + "Z" : ts);
  return d.toLocaleString("en-IN", { ...opts, timeZone: zoneless ? "UTC" : IST });
}
function tsLabel(iso: string, range: Range): string {
  const d = new Date(iso);
  if (range === "today" || range === "yesterday") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
}
// Stable IST bucket key (hour or day grain) — lines timeseries rows up against the
// COMPLETE expected bucket sequence so no-sales periods show as zeros (2026-07-05).
function istKey(d: Date, range: Range): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  if (range === "today" || range === "yesterday") return `${p.year}-${p.month}-${p.day} ${p.hour}`;
  return `${p.year}-${p.month}-${p.day}`;
}
function expectedBuckets(range: Range): { key: string; label: string; ms: number }[] {
  const now = new Date();
  const out: { key: string; label: string; ms: number }[] = [];
  if (range === "today" || range === "yesterday") {
    // Hour keys aligned to the server's 05:00-IST business day (bug H5) — "today"
    // stops at the current hour so future hours aren't zero-padded.
    const startMs = Date.parse(businessDayStartIso(now)) - (range === "yesterday" ? DAY_MS : 0);
    const endMs = range === "yesterday" ? startMs + DAY_MS - 1 : now.getTime();
    for (let t = startMs; t <= endMs; t += 3600_000) {
      const d = new Date(t);
      out.push({ key: istKey(d, range), label: d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST }), ms: t });
    }
  } else if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      out.push({ key: istKey(d, range), label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }), ms: d.getTime() });
    }
  }
  return out;
}
// Exact-days caption for a range — shown as the dropdown's tooltip.
function rangeSpanText(k: Range): string {
  const now = new Date();
  const f = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
  if (k === "today") return `Today · ${f(now)}`;
  if (k === "yesterday") return `Yesterday · ${f(new Date(now.getTime() - DAY_MS))}`;
  if (k === "week") {
    const ist = new Date(now.getTime() + 5.5 * 3600_000);
    const dow = (ist.getUTCDay() + 6) % 7; // Mon=0
    return `${f(new Date(now.getTime() - dow * DAY_MS))} – ${f(now)} (this week)`;
  }
  if (k === "7d") return `${f(new Date(now.getTime() - 6 * DAY_MS))} – ${f(now)} (7 days)`;
  if (k === "month") return `${now.toLocaleDateString("en-IN", { month: "long", timeZone: IST })} so far`;
  if (k === "30d") return `${f(new Date(now.getTime() - 29 * DAY_MS))} – ${f(now)} (30 days)`;
  if (k === "lastmonth") {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    return `All of ${prev.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: IST })}`;
  }
  return `Everything up to ${f(now)}`;
}
// A thrown fetch/PostgREST failure is often a plain object, not an Error — String(e)
// renders the literal "[object Object]" (the owner saw exactly that in the red banner
// on the client site, 2026-07-27). Pull the human parts out of whatever shape arrives.
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const s = [o.message, o.error, o.details, o.code].filter((x): x is string => typeof x === "string" && !!x).join(" · ");
    if (s) return s;
    try { return JSON.stringify(e).slice(0, 200); } catch { /* fall through */ }
  }
  return String(e);
}
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ── Per-card range dropdown (the global tab bar's replacement) ────────────────
function RangeDrop({ id, value, onChange, compactBtn, main }: { id: string; value: Range; onChange: (r: Range) => void; compactBtn?: boolean; main?: boolean }) {
  const [open, setOpen] = useState(false);
  // Project rule: every popup registers with the back-stack manager (self-noops closed).
  useBackClose(`owner-rng-${id}`, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(`[data-rng="${id}"]`)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open, id]);
  const cur = RANGES.find((r) => r.k === value)!;
  return (
    <span className="owr" data-rng={id}>
      <button type="button" className={`owr-btn${compactBtn ? " sm" : ""}${main ? " main" : ""}`} title={rangeSpanText(value)}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {cur.label} <i className="fas fa-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <span className="owr-pop" role="listbox" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.k} type="button" role="option" aria-selected={r.k === value}
              className={r.k === value ? "on" : ""}
              onClick={() => { onChange(r.k); setOpen(false); }}>
              {r.label}<small>{rangeSpanText(r.k)}</small>
            </button>
          ))}
        </span>
      )}
      <style jsx>{`
        .owr { position: relative; display: inline-flex; }
        .owr-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--bg); border: var(--border); border-radius: 8px; padding: 5px 10px; font: inherit; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; white-space: nowrap; }
        .owr-btn.sm { padding: 3px 8px; font-size: 10.5px; }
        .owr-btn:hover { color: var(--accent); border-color: var(--accent); }
        .owr-btn i { font-size: 9px; opacity: .7; }
        .owr-btn.main { background: color-mix(in srgb, #34d399 16%, transparent); border: 1px solid #34d399; color: #059669; font-size: 12.5px; font-weight: 800; padding: 7px 14px; border-radius: 10px; }
        .owr-btn.main:hover { background: color-mix(in srgb, #34d399 26%, transparent); color: #047857; }
        :global([data-skin="dark"]) .owr-btn.main { color: #34d399; }
        :global([data-skin="dark"]) .owr-btn.main:hover { color: #6ee7b7; }
        /* z-index above sibling cards + NEVER clipped: the KPI cards must keep
           overflow visible for this to escape (owner bug, round-2 2026-07-26). */
        .owr-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 90; min-width: 210px; display: flex; flex-direction: column; background: var(--card); border: var(--border); border-radius: 12px; padding: 5px; box-shadow: 0 16px 40px rgba(0,0,0,.45); }
        .owr-pop button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; background: none; border: none; border-radius: 8px; padding: 7px 10px; font: inherit; font-size: 12.5px; font-weight: 700; color: inherit; cursor: pointer; text-align: left; }
        .owr-pop button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
        .owr-pop button.on { color: var(--accent); }
        .owr-pop button small { font-size: 10px; color: var(--muted); font-weight: 500; }
      `}</style>
    </span>
  );
}

// ── Restaurant selector (owner 2026-07-27): a light dropdown at the top of the
// dashboard to switch scope — "All restaurants" (group view) or one restaurant
// (that restaurant's full dashboard). It only DRIVES the existing view model
// (goHome / viewTo restaurant) — no new fetch: every scope is already cached
// per `${scopeKey}|${range}`, so switching costs nothing extra. The colour swatch
// per restaurant matches its portfolioColor(i) in the charts, so a restaurant
// keeps ONE identity colour across the selector and every graph.
function RestaurantDrop({ rests, activeRid, onPick }: {
  rests: { id: string; name: string; accentColor: string; revenueToday: number; reportsOff?: boolean }[];
  activeRid: string | null; // null = All restaurants
  onPick: (rid: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  useBackClose("owner-rest", open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.("[data-restdrop]")) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const idx = activeRid ? rests.findIndex((r) => r.id === activeRid) : -1;
  const cur = idx >= 0 ? rests[idx] : null;
  const money = (n: number) =>
    n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L`
    : n >= 1e3 ? `₹${(n / 1e3).toFixed(1)}k` : `₹${Math.round(n)}`;
  return (
    <span className="owd" data-restdrop>
      <button type="button" className="owd-btn" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {cur ? <span className="sw" style={{ background: portfolioColor(idx) }} aria-hidden="true" />
          : <i className="fas fa-store" aria-hidden="true" />}
        <span className="lbl">{cur ? cur.name : "All restaurants"}</span>
        <i className="fas fa-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <span className="owd-pop" role="listbox" aria-label="Choose restaurant">
          <button type="button" role="option" aria-selected={!activeRid} className={!activeRid ? "on" : ""}
            onClick={() => { onPick(null); setOpen(false); }}>
            <i className="fas fa-store dot" aria-hidden="true" />
            <span className="nm">All restaurants</span>
            <small>{rests.length} in total</small>
          </button>
          <span className="owd-div" aria-hidden="true" />
          {rests.map((r, i) => (
            <button key={r.id} type="button" role="option" aria-selected={activeRid === r.id}
              className={activeRid === r.id ? "on" : ""}
              onClick={() => { onPick(r.id); setOpen(false); }}>
              <span className="sw" style={{ background: portfolioColor(i) }} aria-hidden="true" />
              <span className="nm">{r.name}</span>
              <small>{r.reportsOff ? "takings hidden" : `${money(r.revenueToday)} today`}</small>
            </button>
          ))}
        </span>
      )}
      <style jsx>{`
        .owd { position: relative; display: inline-flex; }
        .owd-btn { display: inline-flex; align-items: center; gap: 8px; max-width: 260px; background: var(--card); border: var(--border); border-radius: 10px; padding: 7px 13px; font: inherit; font-size: 14px; font-weight: 800; color: inherit; cursor: pointer; }
        .owd-btn:hover { border-color: var(--accent); }
        .owd-btn .lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .owd-btn i.fa-store { font-size: 12px; opacity: .7; }
        .owd-btn i.fa-chevron-down { font-size: 9px; opacity: .6; margin-left: 2px; }
        .owd-btn .sw { width: 11px; height: 11px; border-radius: 999px; flex: none; }
        .owd-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 90; min-width: 250px; max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; background: var(--card); border: var(--border); border-radius: 12px; padding: 5px; box-shadow: 0 16px 40px rgba(0,0,0,.45); }
        .owd-div { height: 1px; background: var(--border); margin: 4px 6px; opacity: .6; }
        .owd-pop button { display: flex; align-items: center; gap: 9px; background: none; border: none; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 700; color: inherit; cursor: pointer; text-align: left; }
        .owd-pop button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
        .owd-pop button.on { color: var(--accent); }
        .owd-pop button .sw { width: 11px; height: 11px; border-radius: 999px; flex: none; }
        .owd-pop button .dot { width: 12px; text-align: center; font-size: 11px; opacity: .7; flex: none; }
        .owd-pop button .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .owd-pop button small { font-size: 10.5px; color: var(--muted); font-weight: 600; flex: none; }
      `}</style>
    </span>
  );
}

// ── D1-style KPI card: sparkline inside, delta chip; the whole card is a LINK
// into the matching report (owner round-3: "the top five box … should take you
// to the report section").
function Kpi({ k, v, money, delta, prevTitle, sub, loading, spark, pill, href }: {
  k: string; v: number | string; money?: boolean; delta?: { now: number; prev: number | null };
  prevTitle?: string; sub?: string; loading?: boolean; spark?: number[];
  pill?: string; href?: string;
}) {
  const body = (
    <>
      <div className="ow2-kt">
        <span className="k">{k}</span>
        {pill ? <span className="ow2-live">{pill}</span> : null}
      </div>
      <div className="row">
        <div className="v">{typeof v === "number" ? <AnimatedNumber value={v} loading={loading} money={money} /> : v}</div>
        {!loading && delta && <DeltaChip now={delta.now} prev={delta.prev} title={prevTitle || ""} />}
      </div>
      {sub && !loading && <div className="ow2-sub">{sub}</div>}
      {spark && spark.length >= 2 && !loading && (
        <div className="ow2-spark" aria-hidden="true"><SparkArea points={spark} color={GREEN} height={34} /></div>
      )}
    </>
  );
  const styles = (
    <style jsx global>{`
      /* overflow must stay VISIBLE so popups escape the card (round-2 bug: overflow
         hidden clipped the dropdown). The spark clips itself via its rounded wrapper. */
      .ow2-kpi { position: relative; padding-bottom: 30px; }
      .ow2-kpi.ow2-click { cursor: pointer; text-decoration: none; color: inherit; display: block; transition: border-color .15s, transform .15s; }
      .ow2-kpi.ow2-click:hover { border-color: var(--accent); transform: translateY(-2px); }
      .ow2-kt { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .ow2-kt .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 800; }
      .ow2-live { font-size: 10px; font-weight: 800; color: ${GREEN}; background: color-mix(in srgb, ${GREEN} 14%, transparent); border-radius: 999px; padding: 2px 8px; }
      .ow2-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
      .ow2-spark { position: absolute; left: 0; right: 0; bottom: 0; opacity: .55; pointer-events: none; overflow: hidden; border-radius: 0 0 12px 12px; }
    `}</style>
  );
  return href ? (
    <Link href={href} className="adm-stat owx-kpi ow2-kpi ow2-click" title="Open the full report">{body}{styles}</Link>
  ) : (
    <div className="adm-stat owx-kpi ow2-kpi">{body}{styles}</div>
  );
}

export default function OwnerDashboard() {
  const [view, setView] = useState<View>({ level: "home" });
  // ── Scroll memory on the drill (owner 2026-07-26: "for the other pages also — back should
  // keep me where I was"). Drilling DEEPER (home→restaurant→dish) opens at the top; going
  // BACK restores the exact scroll of the level you left. Same pattern as /owner/reports;
  // the owner panel scrolls inside .adm-main, not the window.
  const levelDepth = (v: View) => (v.level === "home" ? 0 : v.level === "restaurant" ? 1 : 2);
  const drillScroll = useRef<[number, number, number]>([0, 0, 0]);
  const prevView = useRef<View>(view);
  const viewTo = (v: View) => {
    const el = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".adm-main");
    if (el) drillScroll.current[levelDepth(prevView.current)] = el.scrollTop;
    setView(v);
  };
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(".adm-main");
    const from = levelDepth(prevView.current), to = levelDepth(view);
    prevView.current = view;
    if (!el || from === to) return;
    el.scrollTop = to > from ? 0 : drillScroll.current[to];   // deeper → top; back → restore
  }, [view]);
  // The MAIN range (top-right): the one dropdown the whole page follows — KPI boxes
  // and graphs alike (owner round-2: "only the main one"). Default 30 days.
  const [globalRange, setGlobalRange] = useState<Range>("30d");
  // Restore the last-used range once on mount (owner 2026-07-27: a refresh always
  // bounced back to 30 days). Post-mount so SSR/hydration still render the default.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RANGE_LS_KEY) as Range | null;
      if (saved && saved !== "30d" && RANGES.some((r) => r.k === saved)) setGlobalRange(saved);
    } catch { /* storage unavailable */ }
  }, []);
  const pickRange = useCallback((k: Range) => {
    setGlobalRange(k);
    try { localStorage.setItem(RANGE_LS_KEY, k); } catch { /* noop */ }
  }, []);
  const [ov, setOv] = useState<Overview | null>(null);
  // Payload cache — key `${scopeKey}|${range}`; cards sharing a range share ONE fetch,
  // and a range the owner already looked at repaints instantly (session-cached).
  const [cache, setCache] = useState<Record<string, Payload>>({});
  const [moneyCache, setMoneyCache] = useState<Record<string, MoneyTotals | "err">>({});
  const [recs, setRecs] = useState<Record<string, Records>>({});
  const [acts, setActs] = useState<Act[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dishSort, setDishSort] = useState<"revenue" | "qty">("revenue");
  const inflight = useRef<Set<string>>(new Set());
  // Admin tab pin (bug C1): ?rid= rides on EVERY call so a second tab's act-as cookie
  // can never repaint this one under a different restaurant.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const withPin = (href: string) => (scopePin ? `${href}?rid=${scopePin}${asSuffix()}` : href);
  const scp = scopePin ? `&scope=${scopePin}${asSuffix()}` : "";

  const single = ov?.restaurants.length === 1;
  const homeRid = single ? ov!.restaurants[0].id : null;
  const activeRid = view.level === "home" ? homeRid : (view as { rid: string }).rid;
  const restCount = ov?.restaurants.length ?? 0;
  const scopeKey = activeRid ?? "group";

  // ── Instant-paint (owner 2026-07-26): last-seen payloads from THIS tab paint at ~0ms ──
  // `snap` is a render-only FALLBACK layer — never written into `cache`/`moneyCache`, so
  // the loaders' "fetch if missing" guards still fire and every hydrated number silently
  // revalidates. The entrance animations (count-up, chart draw-in) run on the hydrated
  // data exactly as they do on fetched data. Cleared on login (lib/ownerSnap.ts).
  const snapKey = `dash${scopePin ? `:${scopePin}` : ""}`;
  const [snap, setSnap] = useState<{ ov?: Overview; cache?: Record<string, Payload>; money?: Record<string, MoneyTotals | "err">; updatedAt?: string } | null>(null);
  useEffect(() => {
    const s = readSnap<{ ov?: Overview; cache?: Record<string, Payload>; money?: Record<string, MoneyTotals | "err">; updatedAt?: string }>(snapKey);
    if (!s) return;
    setSnap(s);
    // ov/updatedAt have no fetch-skip guards, so hydrating the state directly is safe —
    // loadOverview() always runs on mount and overwrites with the live answer.
    if (s.ov) setOv((cur) => cur ?? s.ov!);
    if (s.updatedAt) setUpdatedAt((cur) => cur ?? s.updatedAt!);
  }, [snapKey]);
  // Persist the freshest state for the next open of this tab (best-effort, tiny JSON).
  useEffect(() => {
    if (!ov || !Object.keys(cache).length) return;
    writeSnap(snapKey, { ov, cache, money: moneyCache, updatedAt: updatedAt ?? undefined });
  }, [snapKey, ov, cache, moneyCache, updatedAt]);

  const pl = useCallback((range: string): Payload | undefined =>
    cache[`${scopeKey}|${range}`] ?? snap?.cache?.[`${scopeKey}|${range}`], [cache, snap, scopeKey]);
  const moneyOf = (range: Range): MoneyTotals | "err" | undefined =>
    moneyCache[`${scopeKey}|${range}`] ?? snap?.money?.[`${scopeKey}|${range}`];

  // Refresh-proof drill (owner round-5: "if you refresh it, it comes backwards").
  // The panel runs under the back-stack history manager, which OWNS pushState/popstate
  // for the hardware-back peel — so a URL query would be stomped by it (and it's a
  // project hard-rule not to hand-roll history in a component). We persist the open
  // restaurant/dish in sessionStorage instead: survives F5, invisible to the back
  // manager, per-tab, and scoped by the admin ?rid pin so two admin tabs don't clash.
  const drillKey = `owner_drill${scopePin ? `:${scopePin}` : ""}`;
  const drillRestored = useRef(false);
  // Sidebar "My restaurants" rows open a restaurant from any page (event / ?focus=).
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus) { setView({ level: "restaurant", rid: focus }); drillRestored.current = true; }
    else {
      try {
        const saved = JSON.parse(sessionStorage.getItem(drillKey) || "null");
        if (saved && saved.level && saved.rid) setView(saved);
      } catch { /* ignore */ }
    }
    drillRestored.current = true;
    const onOpen = (e: Event) => {
      const rid = (e as CustomEvent).detail?.rid as string | null | undefined;
      viewTo(rid ? { level: "restaurant", rid } : { level: "home" });
    };
    window.addEventListener("lfh:owner-open-restaurant", onOpen);
    return () => window.removeEventListener("lfh:owner-open-restaurant", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Persist the current drill (only after the initial restore, so we never overwrite
  // a saved drill with the transient "home" of first paint).
  useEffect(() => {
    if (!drillRestored.current) return;
    try {
      if (view.level === "home") sessionStorage.removeItem(drillKey);
      else sessionStorage.setItem(drillKey, JSON.stringify(view));
    } catch { /* ignore */ }
  }, [view, drillKey]);

  // Merged breadcrumb (owner 2026-07-26): the restaurant/dish tail renders in the
  // SHELL's top strip (Owner › Dashboard › …), not as a second heading row here.
  useEffect(() => {
    const tail: string[] = [];
    if (!single && view.level !== "home") {
      const name = ov?.restaurants.find((r) => r.id === (view as { rid: string }).rid)?.name;
      if (name) tail.push(name);
    }
    if (view.level === "dish") tail.push(view.dish);
    window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail } }));
    return () => { window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail: [] } })); };
  }, [view, ov, single]);

  // ── data layer: fetch one (scope, range) payload if missing ──
  const fetchPayload = useCallback(async (sk: string, range: string, opts?: { force?: boolean; refresh?: boolean; qs?: string }) => {
    const key = `${sk}|${range}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    try {
      const rid = sk === "group" ? null : sk;
      // records ride ONCE per restaurant (unbounded scan — not worth re-running per range).
      const recQ = rid && !(rid in ((recsRef.current) || {})) ? "&records=1" : "";
      const refQ = opts?.refresh ? "&refresh=1" : "";
      const a = await fetch(`/api/owner/analytics?${opts?.qs ?? `range=${range}`}${rid ? `&rid=${rid}` : ""}&compare=1${recQ}${scp}${refQ}`, { cache: "no-store" }).then((r) => r.json());
      if (a.error) throw new Error(errText(a.error));
      setCache((c) => ({ ...c, [key]: a }));
      if (a.cachedAt) setUpdatedAt(a.cachedAt);
      if (rid && a.records) setRecs((m) => ({ ...m, [rid]: a.records }));
      setErr(null);
      reportRealtime("online");
    } catch (e) {
      setErr(errText(e));
      reportRealtime("weak");
    } finally {
      inflight.current.delete(key);
    }
  }, [scp]);
  const recsRef = useRef(recs); recsRef.current = recs;
  const cacheRef = useRef(cache); cacheRef.current = cache;
  const moneyRef = useRef(moneyCache); moneyRef.current = moneyCache;

  const fetchMoney = useCallback(async (sk: string, range: Range, opts?: { refresh?: boolean }) => {
    const key = `money:${sk}|${range}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    try {
      const rid = sk === "group" ? null : sk;
      const refQ = opts?.refresh ? "&refresh=1" : "";
      const m = await fetch(`/api/owner/reports?type=sales&range=${range}${rid ? `&rid=${rid}` : ""}${scp}${refQ}`, { cache: "no-store" }).then((r) => r.json());
      setMoneyCache((c) => ({ ...c, [`${sk}|${range}`]: m.error ? "err" : m.totals }));
      if (m.cachedAt) setUpdatedAt(m.cachedAt);
    } catch {
      setMoneyCache((c) => ({ ...c, [`${sk}|${range}`]: "err" }));
    } finally {
      inflight.current.delete(key);
    }
  }, [scp]);

  // PRE-WARM every other range in the background (owner 2026-07-27: "all the calculation
  // should be going on in the background … all time should also be pre-calculated").
  // A few seconds after a scope's dashboard has painted, quietly request each remaining
  // range once, staggered. Server-side, cachedOwnerPayload stores the snapshot, so
  // switching ranges — or tomorrow's first open — answers from ONE cache-row read.
  // Ranges already fetched this session are skipped, so warm visits cost ~nothing; and
  // because it's view-triggered (not a blind cron), idle tenants burn zero compute.
  const warmedScopes = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!ov) return;
    const sk = scopeKey;
    if (warmedScopes.current.has(sk)) return;
    warmedScopes.current.add(sk);
    const others = RANGES.map((r) => r.k).filter((k) => k !== globalRange);
    const timers = others.map((k, i) => setTimeout(() => {
      if (!cacheRef.current[`${sk}|${k}`]) fetchPayload(sk, k);
      if (!moneyRef.current[`${sk}|${k}`]) fetchMoney(sk, k);
    }, 4000 + i * 1500));
    return () => { timers.forEach(clearTimeout); };
    // globalRange deliberately NOT a dep: warming runs once per scope per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, scopeKey, fetchPayload, fetchMoney]);

  // Recent activity mini feed (single/drilled view) — 6 rows, scoped, egress-tiny.
  const fetchActs = useCallback(async (rid: string) => {
    try {
      const j = await fetch(`/api/owner/oplog?limit=6&rid=${rid}${scopePin ? `&scope=${scopePin}${asSuffix()}` : ""}`, { cache: "no-store" }).then((r) => r.json());
      setActs(Array.isArray(j.actions) ? j.actions : null);
    } catch { setActs(null); }
  }, [scopePin]);

  // The distinct (scope, range) keys the CURRENT view's cards need: the main range
  // (all graphs), any KPI overrides, and the pinned week for busy-hours/heatmap.
  const neededRanges = useMemo(() => Array.from(new Set<Range>([globalRange, WEEK])), [globalRange]);

  // Overview first (identity + today-so-far numbers), then ensure every needed payload.
  const loadOverview = useCallback(async () => {
    try {
      const o = (await fetchOwnerOverview(scp)) as Overview;
      if ((o as unknown as { error?: string }).error) throw new Error((o as unknown as { error: string }).error);
      setOv(o);
      setErr(null);
    } catch (e) {
      setErr(errText(e));
      reportRealtime("weak");
    }
  }, [scp]);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (!ov) return;
    for (const r of neededRanges) if (!cache[`${scopeKey}|${r}`]) fetchPayload(scopeKey, r);
    if (!moneyCache[`${scopeKey}|${globalRange}`]) fetchMoney(scopeKey, globalRange);
    // The "Revenue this month vs last month" chart is LOCKED to whole calendar months,
    // independent of the range dropdown — fetch its own month payload once.
    if (!cache[`${scopeKey}|month`]) fetchPayload(scopeKey, "month", { qs: "range=month" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, scopeKey, neededRanges, globalRange]);

  useEffect(() => { if (activeRid) { setActs(null); fetchActs(activeRid); } }, [activeRid, fetchActs]);

  // Auto-refresh (activity-gated 60s): overview + the payloads in use. Group payloads
  // are compute-on-view cached server-side (mig 196), so this stays cheap.
  const tick = useCallback(() => {
    loadOverview();
    for (const r of neededRanges) fetchPayload(scopeKey, r);
    fetchPayload(scopeKey, "month", { qs: "range=month" });
    fetchMoney(scopeKey, globalRange);
  }, [loadOverview, fetchPayload, fetchMoney, neededRanges, scopeKey, globalRange]);
  const tickRef = useRef(tick); tickRef.current = tick;
  useActiveAutoRefresh(() => tickRef.current(), 60000);

  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = () => {
    setRefreshing(true);
    const started = Date.now();
    const jobs: Promise<unknown>[] = [loadOverview()];
    for (const r of neededRanges) jobs.push(fetchPayload(scopeKey, r, { refresh: true }));
    jobs.push(fetchMoney(scopeKey, globalRange, { refresh: true }));
    if (activeRid) jobs.push(fetchActs(activeRid));
    Promise.allSettled(jobs).finally(() => {
      const wait = Math.max(0, 400 - (Date.now() - started));
      setTimeout(() => setRefreshing(false), wait);
    });
  };

  // ── derived: KPI values from each card's own range ──
  const kpiOf = useCallback((range: Range) => {
    const p = pl(range);
    if (!p) return null;
    if (p.scope === "restaurant") {
      return { revenue: p.kpis.revenue, orders: p.kpis.orders, paidOrders: p.kpis.paidOrders ?? p.kpis.orders, avg: p.kpis.avgOrder, prev: p.prev, ts: p.timeseries, staffPay: p.staffPay ?? null };
    }
    const revenue = p.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
    const orders = p.restaurantRevenue.reduce((a, r) => a + r.orders, 0);
    const paidOrders = p.paymentMethods.reduce((a, m) => a + (m.orders || 0), 0);
    return { revenue, orders, paidOrders, avg: paidOrders ? revenue / paidOrders : 0, prev: p.prev, ts: p.timeseries, staffPay: p.staffPay ?? null };
  }, [pl]);

  // Sparkline points (per bucket) for a range — group sums across restaurants.
  const sparkOf = useCallback((range: Range, kind: "revenue" | "orders") => {
    const k = kpiOf(range);
    if (!k) return undefined;
    const by = new Map<string, number>();
    for (const t of k.ts) {
      const key = istKey(new Date(t.bucket), range);
      by.set(key, (by.get(key) || 0) + (kind === "revenue" ? t.revenue : t.orders));
    }
    const exp = expectedBuckets(range);
    const pts = exp.length ? exp.map((e) => by.get(e.key) ?? 0) : Array.from(by.values());
    return pts.length >= 2 ? pts : undefined;
  }, [kpiOf]);

  // Trend rows for the main chart (single scope) — carries __orders for the tooltip.
  const restTrend = useMemo(() => {
    const p = pl(globalRange);
    if (!p || p.scope !== "restaurant") return [];
    const by = new Map<string, { rev: number; ord: number }>();
    for (const t of p.timeseries) by.set(istKey(new Date(t.bucket), globalRange), { rev: t.revenue, ord: t.orders });
    const exp = expectedBuckets(globalRange);
    if (!exp.length) return p.timeseries.map((t) => ({ label: tsLabel(t.bucket, globalRange), Revenue: t.revenue, __orders: t.orders }));
    return exp.map((e) => ({ label: e.label, Revenue: by.get(e.key)?.rev ?? 0, __orders: by.get(e.key)?.ord ?? 0 }));
  }, [pl, globalRange]);

  // Group trend (multi):
  //   · 2–3 restaurants → Samsung-style stacked daily bars in GREEN SHADES (round-2:
  //     no brown/orange at this tier — identity colours are for the many-tier only);
  //   · 4+ → the multi-line per-restaurant trend in accent colours, side-by-side with
  //     "Who earns more" (round-2: "this was the best one" — restored).
  const groupTrend = useMemo(() => {
    const p = pl(globalRange);
    if (!p || p.scope !== "group") return { rows: [] as Record<string, unknown>[], lines: [] as { key: string; name: string; color: string }[], stacked: false };
    const stacked = p.restaurantRevenue.length >= 2 && p.restaurantRevenue.length <= 3;
    const lines = p.restaurantRevenue.map((r, i) => ({
      key: r.id, name: r.name,
      color: stacked ? GREEN_SHADES[i % GREEN_SHADES.length] : portfolioColor(i),
    }));
    const by = new Map<string, Record<string, number>>();
    for (const t of p.timeseries) {
      const k = istKey(new Date(t.bucket), globalRange);
      const row = by.get(k) || {};
      if (t.restaurantId) row[t.restaurantId] = (row[t.restaurantId] || 0) + t.revenue;
      row.__orders = (row.__orders || 0) + t.orders;
      by.set(k, row);
    }
    const exp = expectedBuckets(globalRange);
    const keys = exp.length ? exp : Array.from(by.keys()).sort().map((k) => ({ key: k, label: k }));
    const rows = keys.map((e) => {
      const found = by.get(e.key) || {};
      const row: Record<string, unknown> = { label: e.label, __orders: found.__orders || 0 };
      for (const l of lines) row[l.key] = found[l.key] || 0;
      return row;
    });
    return { rows, lines, stacked };
  }, [pl, globalRange]);

  // Revenue THIS calendar month vs LAST calendar month, aligned by day-of-month (day-1 over
  // day-1), rendered as two clean lines like the multi-restaurant "Revenue over time" chart
  // (owner 2026-07-26: light green = this month, dark green = last month, line only). LOCKED
  // to whole months (own `month` payload), so it's always populated regardless of the range
  // dropdown. Group scope sums across restaurants per day; single scope is per day.
  const monthCompare = useMemo(() => {
    const p = pl("month");
    if (!p) return { rows: [] as Record<string, unknown>[], hasPrev: false };
    const dom = (bucket: string) => new Date(Date.parse(bucket) + 5.5 * 3600_000).getUTCDate();
    const curBy = new Map<number, { rev: number; ord: number }>();
    for (const t of p.timeseries) {
      const d = dom(t.bucket);
      const c = curBy.get(d) || { rev: 0, ord: 0 };
      c.rev += t.revenue; c.ord += t.orders; curBy.set(d, c);
    }
    const prevBy = new Map<number, number>();
    for (const t of p.timeseriesPrev ?? []) {
      const d = dom(t.bucket);
      prevBy.set(d, (prevBy.get(d) || 0) + t.revenue);
    }
    const hasPrev = prevBy.size > 0;
    const todayDom = new Date(Date.now() + 5.5 * 3600_000).getUTCDate();
    const maxDay = Math.max(todayDom, ...(hasPrev ? [...prevBy.keys()] : [0]));
    const rows: Record<string, unknown>[] = [];
    for (let d = 1; d <= maxDay; d++) {
      rows.push({
        label: String(d),
        cur: d <= todayDom ? (curBy.get(d)?.rev ?? 0) : null, // this month: real up to today, blank for future days
        prev: hasPrev ? (prevBy.get(d) ?? 0) : null,
        __orders: curBy.get(d)?.ord ?? 0,
      });
    }
    return { rows, hasPrev };
  }, [pl]);
  // This / last calendar-month names for the legend + card tag (IST).
  const monthName = (mi: number) => new Date(Date.UTC(2000, ((mi % 12) + 12) % 12, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const istMonthIdx = new Date(Date.now() + 5.5 * 3600_000).getUTCMonth();
  const thisMonthName = monthName(istMonthIdx);
  const lastMonthName = monthName(istMonthIdx - 1);
  // Names for the this-vs-last-month chart legend/tooltip.
  const monthCurName = `This month · ${thisMonthName}`;
  const monthPrevName = `Last month · ${lastMonthName}`;

  // Latest-active-week fallback (owner round-5: "the two datas are not even
  // showing"): if the pinned last-7-days window has zero orders but the main range
  // does have activity, fetch the newest 7 IST days that HAD orders as a custom
  // window and label the cards with those dates.
  const weekFallback = useMemo(() => {
    const wp = pl(WEEK);
    if (!wp) return null; // still loading — don't decide yet
    const active = wp.scope === "restaurant"
      ? (wp.hourly ?? []).some((h) => h.orders > 0)
      : ((wp as GroupA).heatmap ?? []).some((c) => c.orders > 0);
    if (active) return null;
    const base = pl(globalRange);
    const ts = base?.timeseries ?? [];
    let maxMs = 0;
    for (const t of ts) if ((t.orders || 0) > 0) maxMs = Math.max(maxMs, Date.parse(t.bucket));
    if (!maxMs) return null;
    const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
    const to = istDay(maxMs), from = istDay(maxMs - 6 * DAY_MS);
    return { key: `latestwk:${from}:${to}`, qs: `range=custom&from=${from}&to=${to}`, from, to };
  }, [pl, globalRange]);
  useEffect(() => {
    if (weekFallback && !cache[`${scopeKey}|${weekFallback.key}`]) fetchPayload(scopeKey, weekFallback.key, { qs: weekFallback.qs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekFallback, scopeKey]);
  const weekKey = weekFallback?.key ?? WEEK;
  const fmtD = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const weekTagText = weekFallback ? `week of ${fmtD(weekFallback.from)} – ${fmtD(weekFallback.to)}` : "last 7 days";
  const weekTagTitle = weekFallback ? "The current week has no orders yet — showing the most recent week with activity." : rangeSpanText(WEEK);

  // ── multi-restaurant table (all multi tiers — owner: design #4) ──
  const [tq, setTq] = useState("");
  const [tSort, setTSort] = useState<{ k: "rank" | "name" | "today" | "revenue" | "orders" | "avg" | "openTables"; asc: boolean }>({ k: "revenue", asc: false });
  const tableRows = useMemo(() => {
    if (!ov || single) return [];
    const p = pl(globalRange);
    const revById = new Map((p?.scope === "group" ? p.restaurantRevenue : []).map((r) => [r.id, r]));
    // per-restaurant sparkline from the group timeseries of the table's range
    const sparks = new Map<string, number[]>();
    if (p?.scope === "group") {
      const byRest = new Map<string, Map<string, number>>();
      for (const t of p.timeseries) {
        if (!t.restaurantId) continue;
        const m = byRest.get(t.restaurantId) || new Map<string, number>();
        const k = istKey(new Date(t.bucket), globalRange);
        m.set(k, (m.get(k) || 0) + t.revenue);
        byRest.set(t.restaurantId, m);
      }
      const exp = expectedBuckets(globalRange);
      for (const [rid, m] of byRest) sparks.set(rid, exp.length ? exp.map((e) => m.get(e.key) ?? 0) : Array.from(m.values()));
    }
    const total = Math.max(1, Array.from(revById.values()).reduce((a, r) => a + r.revenue, 0));
    const base = ov.restaurants.map((r) => {
      const g = revById.get(r.id);
      const revenue = g?.revenue ?? 0, orders = g?.orders ?? 0;
      return {
        id: r.id, slug: r.slug, name: r.name, active: r.active, accent: r.accentColor || FALLBACK,
        revenue, orders, avg: orders ? revenue / orders : 0, share: revenue / total,
        openTables: r.openTables, today: r.revenueToday, ordersToday: r.ordersToday, reportsOff: r.reportsOff === true,
        revenueAll: r.revenueAll, ordersAll: r.ordersAll, spark: sparks.get(r.id),
      };
    });
    const rank = new Map([...base].sort((a, b) => b.revenue - a.revenue).map((r, i) => [r.id, i + 1]));
    const q = tq.trim().toLowerCase();
    const rows = q ? base.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) : base;
    const dir = tSort.asc ? 1 : -1;
    rows.sort((a, b) => {
      if (tSort.k === "name") return a.name.localeCompare(b.name) * dir;
      if (tSort.k === "rank") return ((rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)) * dir;
      const key = tSort.k === "today" ? "today" : tSort.k;
      return ((a[key as "revenue"] as number) - (b[key as "revenue"] as number)) * dir;
    });
    // <=3 restaurants: identity colours join the green theme too (round-3 — the
    // table dots/share bars were still showing brown/orange accents at this tier).
    return rows.map((r) => {
      const rk = rank.get(r.id)!;
      return { ...r, rank: rk, accent: restCount <= 3 ? GREEN_SHADES[(rk - 1) % GREEN_SHADES.length] : r.accent };
    });
  }, [ov, single, pl, globalRange, tq, tSort]);
  const th = (k: typeof tSort.k, label: string, left?: boolean) => (
    <th className={left ? "l" : undefined} onClick={() => setTSort((s) => ({ k, asc: s.k === k ? !s.asc : false }))}
      role="columnheader" aria-sort={tSort.k === k ? (tSort.asc ? "ascending" : "descending") : "none"}
      style={{ cursor: "pointer" }}>
      {label} {tSort.k === k && <i className={`fas fa-caret-${tSort.asc ? "up" : "down"}`} aria-hidden="true" />}
    </th>
  );

  // Best / needs-attention callouts (multi) — momentum = 2nd half vs 1st half of the
  // trend range's own series (accurate, zero extra fetches).
  // Only for 4+ restaurants (owner round-3), and the two cards must NEVER name the
  // same restaurant — the top performer is skipped when picking "needs attention".
  const callouts = useMemo(() => {
    const p = pl(globalRange);
    if (!p || p.scope !== "group" || p.restaurantRevenue.length <= 3) return null;
    const total = p.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
    const best = p.restaurantRevenue[0];
    const halves = new Map<string, { a: number; b: number }>();
    const buckets = Array.from(new Set(p.timeseries.map((t) => t.bucket))).sort();
    const mid = Math.floor(buckets.length / 2);
    const rankIdx = new Map(buckets.map((b, i) => [b, i]));
    for (const t of p.timeseries) {
      if (!t.restaurantId) continue;
      const h = halves.get(t.restaurantId) || { a: 0, b: 0 };
      if ((rankIdx.get(t.bucket) ?? 0) < mid) h.a += t.revenue; else h.b += t.revenue;
      halves.set(t.restaurantId, h);
    }
    let watchId: string | null = null, watchPct = 0;
    for (const r of p.restaurantRevenue) {
      if (best && r.id === best.id) continue; // never the same restaurant twice
      const h = halves.get(r.id);
      if (!h || h.a <= 0) continue;
      const pct = ((h.b - h.a) / h.a) * 100;
      if (pct < -5 && (!watchId || pct < watchPct)) { watchId = r.id; watchPct = pct; }
    }
    // Per-restaurant sparkline points (revenue by bucket) for the centre draw-in graph.
    const sparkFor = (rid: string) => {
      const by = new Map<string, number>();
      for (const t of p.timeseries) if (t.restaurantId === rid) by.set(t.bucket, (by.get(t.bucket) || 0) + t.revenue);
      return buckets.map((bk) => by.get(bk) ?? 0);
    };
    const watchR = watchId ? p.restaurantRevenue.find((r) => r.id === watchId)! : null;
    return {
      best: best ? { id: best.id, name: best.name, revenue: best.revenue, share: total ? best.revenue / total : 0, spark: sparkFor(best.id) } : null,
      watch: watchR ? { id: watchR.id, name: watchR.name, pct: watchPct, spark: sparkFor(watchR.id) } : null,
    };
  }, [pl, globalRange]);

  // ── plain-language insights (derived from data already on screen) ──
  const insights = useMemo(() => {
    const out: { icon: string; text: string }[] = [];
    const rl = RANGE_LABEL[globalRange];
    const p = pl(globalRange);
    const money = moneyOf(globalRange);
    if (p?.scope === "restaurant") {
      const k = p.kpis;
      if (p.prev && p.prev.revenue > 0 && k.revenue > 0) {
        const pct = Math.round(((k.revenue - p.prev.revenue) / p.prev.revenue) * 100);
        if (pct >= 300) out.push({ icon: "fa-arrow-trend-up", text: `Revenue is ${Math.round(k.revenue / p.prev.revenue)}× the period before` });
        else if (Math.abs(pct) >= 3) out.push({ icon: pct > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", text: `Revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% ${PREV_LABEL[globalRange]}` });
      }
      const busiest = [...p.hourly].sort((a, b) => b.orders - a.orders)[0];
      if (busiest?.orders) out.push({ icon: "fa-clock", text: `Busiest at ${busiest.hour}:00 — ${busiest.orders} order${busiest.orders === 1 ? "" : "s"}` });
      const total = p.dishes.reduce((a, d) => a + d.revenue, 0);
      if (p.dishes[0] && total > 0) out.push({ icon: "fa-utensils", text: `${p.dishes[0].title} makes ${Math.round((p.dishes[0].revenue / total) * 100)}% of dish revenue` });
      if (money && money !== "err" && money.cancelledValue > 0) out.push({ icon: "fa-ban", text: `${inr(money.cancelledValue)} lost to ${money.cancelledOrders} cancelled order${money.cancelledOrders === 1 ? "" : "s"} ${RANGE_LABEL[globalRange]}` });
      const payRows = (p.paymentMethods ?? []).map((x) => ({ ...x, method: canonPayMethod(x.method) }));
      const pay = payRows.filter((x) => x.method !== "Not recorded").sort((a, b) => b.revenue - a.revenue)[0];
      const payTotal = payRows.reduce((a, x) => a + x.revenue, 0);
      if (pay && payTotal > 0 && pay.revenue / payTotal >= 0.15)
        out.push({ icon: "fa-wallet", text: `${pay.method} is ${Math.round((pay.revenue / payTotal) * 100)}% of payments` });
    } else if (p?.scope === "group") {
      const total = p.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
      if (p.prev && p.prev.revenue > 0 && total > 0) {
        const pct = Math.round(((total - p.prev.revenue) / p.prev.revenue) * 100);
        if (pct >= 300) out.push({ icon: "fa-arrow-trend-up", text: `Group revenue is ${Math.round(total / p.prev.revenue)}× the period before` });
        else if (Math.abs(pct) >= 3) out.push({ icon: pct > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", text: `Group revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% ${PREV_LABEL[globalRange]}` });
      }
      const top = p.restaurantRevenue[0];
      if (top && total > 0 && p.restaurantRevenue.length > 1)
        out.push({ icon: "fa-trophy", text: `${top.name} leads with ${Math.round((top.revenue / total) * 100)}% of revenue ${rl}` });
      if (money && money !== "err" && money.cancelledValue > 0) out.push({ icon: "fa-ban", text: `${inr(money.cancelledValue)} lost to cancellations ${RANGE_LABEL[globalRange]}` });
      if (money && money !== "err" && money.discount > 0 && total > 0) out.push({ icon: "fa-tag", text: `${inr(money.discount)} given as discounts` });
    }
    return out.slice(0, 4);
  }, [pl, globalRange, globalRange, moneyCache, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dishView = useMemo(() => {
    if (view.level !== "dish") return null;
    const p = pl(globalRange);
    if (!p || p.scope !== "restaurant" || p.restaurant.id !== view.rid) return "loading" as const;
    const total = p.dishes.reduce((a, d) => a + d.revenue, 0) || 1;
    const idx = p.dishes.findIndex((d) => d.title === view.dish);
    const d = p.dishes[idx];
    return d ? { d, rank: idx + 1, share: Math.round((d.revenue / total) * 100), of: p.dishes.length, dishes: p.dishes } : ("missing" as const);
  }, [view, pl, globalRange]);

  // ── drawer (multi): row click → summary from data ALREADY loaded (zero fetches) ──
  const [drawerRid, setDrawerRid] = useState<string | null>(null);
  useBackClose("owner-rest-drawer", !!drawerRid, () => setDrawerRid(null));
  const drawer = useMemo(() => {
    if (!drawerRid || !ov) return null;
    const r = ov.restaurants.find((x) => x.id === drawerRid);
    if (!r) return null;
    const row = tableRows.find((x) => x.id === drawerRid);
    return { r, row };
  }, [drawerRid, ov, tableRows]);
  // The drawer's mini chart — a real labelled gradient trend (round-2: "see how
  // pretty the before graph looks — make it like that"), from data already loaded.
  const drawerTrend = useMemo(() => {
    if (!drawerRid) return [];
    const p = pl(globalRange);
    if (!p || p.scope !== "group") return [];
    const by = new Map<string, { rev: number; ord: number }>();
    for (const t of p.timeseries) {
      if (t.restaurantId !== drawerRid) continue;
      const k = istKey(new Date(t.bucket), globalRange);
      const cur = by.get(k) || { rev: 0, ord: 0 };
      cur.rev += t.revenue; cur.ord += t.orders;
      by.set(k, cur);
    }
    const exp = expectedBuckets(globalRange);
    if (!exp.length) return [];
    return exp.map((e) => ({ label: e.label, Revenue: by.get(e.key)?.rev ?? 0, __orders: by.get(e.key)?.ord ?? 0 }));
  }, [drawerRid, pl, globalRange]);

  // ── Report export tables for the current view ──
  // Gather the professional report "at that time" (owner round-3): group summary +
  // EVERY restaurant individually. All reads hit the compute-on-view cached APIs
  // (mig 196 + the new restaurant-scope cache), so even 7 restaurants gather fast.
  // The full compiled statement — now a thin call into the shared gatherer so the
  // /owner/reports hub generates the byte-identical report (owner round-6).
  const gatherReport = (periodQs: string, periodLabel: string): Promise<ReportData> => {
    if (!ov) throw new Error("not loaded yet");
    return gatherOwnerReport({ restaurants: ov.restaurants, activeRid, scopePin, asSuffix: asSuffix(), periodQs, periodLabel });
  };
  const exportName = `aevidine-report-${new Date().toISOString().slice(0, 10)}`;
  // KPI boxes deep-link into the matching report (round-3).
  const reportHref = (t: string) => (scopePin ? `/owner/reports?rid=${scopePin}${asSuffix()}&open=${t}` : `/owner/reports?open=${t}`);

  const goHome = () => viewTo({ level: "home" });
  const openFull = (rid: string) => { setDrawerRid(null); viewTo({ level: "restaurant", rid }); };

  // Today-so-far numbers (from the overview — no extra call).
  const todayRow = activeRid ? ov?.restaurants.find((r) => r.id === activeRid) : null;
  const todayRev = activeRid ? (todayRow?.revenueToday ?? 0) : (ov?.totals.revenueToday ?? 0);
  const todayOrd = activeRid ? (todayRow?.ordersToday ?? 0) : (ov?.totals.ordersToday ?? 0);

  const kMain = kpiOf(globalRange);
  const money = moneyOf(globalRange);
  const trendPayload = pl(globalRange);
  const records = activeRid ? recs[activeRid] : null;

  // Highlights live at the BOTTOM of the page now (owner round-3: "we don't require
  // this information at the top"). Callouts only exist for 4+ restaurants.
  const highlights = view.level !== "dish" && (insights.length > 0 || callouts) ? (
    <div style={{ marginTop: 12 }}>
      {/* Split banner (owner round-5 pick #2): green ½ vs red ½ scoreboard, each half
          clickable into that restaurant, with a draw-in sparkline filling the middle.
          Styles are GLOBAL (namespaced under .ow2-split): `highlights` is an extracted
          const, so styled-jsx's *scoped* class is never added to its elements. */}
      <style jsx global>{`
        .ow2-split { display: grid; grid-template-columns: 1fr 1fr; border: var(--border); border-radius: 14px; overflow: hidden; margin-bottom: 12px; background: var(--card); }
        .ow2-split .oh { display: flex; align-items: center; gap: 13px; padding: 14px 18px; min-height: 82px; background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; overflow: hidden; transition: filter .15s; }
        .ow2-split .oh.good { background: linear-gradient(90deg, color-mix(in srgb, ${GREEN} 14%, transparent), transparent 78%); }
        .ow2-split .oh.warn { border-left: var(--border); background: linear-gradient(270deg, color-mix(in srgb, #ef4444 12%, transparent), transparent 78%); }
        .ow2-split .oh.warn .txt { text-align: right; }
        .ow2-split .oh:hover { filter: brightness(1.05); }
        .ow2-split .oh.ghost { cursor: default; }
        .ow2-split .ic { font-size: 22px; flex: none; align-self: flex-start; margin-top: 2px; }
        .ow2-split .txt { flex: none; min-width: 0; }
        .ow2-split .txt small { display: block; font-size: 10px; color: var(--muted); font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
        .ow2-split .txt b { display: block; font-size: 17px; font-weight: 800; line-height: 1.25; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ow2-split .txt i { display: block; font-style: normal; font-size: 12.5px; color: var(--muted); }
        /* The top performer's revenue was a FIXED emerald (${GREEN}) picked for the dark
           card — on the light skin's white card that is 1.92:1 contrast, i.e. the number
           the whole callout exists to show was practically invisible (found by the
           both-skins readability sweep, 2026-07-31). Mixing the skin's own accent toward
           the skin's own text colour keeps it green in both themes and readable in both:
           ~5.5:1 on white, ~8.8:1 on the dark card. */
        .ow2-split .txt em { font-style: normal; font-weight: 800; color: color-mix(in srgb, var(--accent) 80%, var(--text)); }
        .ow2-split .txt em.r { color: #ef4444; }
        .ow2-split .mid { flex: none; width: clamp(90px, 26%, 200px); height: 46px; display: flex; align-items: center; opacity: .9; }
        .ow2-split .oh.good .mid { margin-left: auto; }
        .ow2-split .oh.warn .mid { margin-right: auto; }
        .ow2-split .mid svg { width: 100%; }
        @media (max-width: 820px) { .ow2-split .mid { display: none; } }
        @media (max-width: 620px) { .ow2-split { grid-template-columns: 1fr; } .ow2-split .oh.warn { border-left: none; border-top: var(--border); } .ow2-split .oh.warn .txt { text-align: left; } }
      `}</style>
      {callouts && view.level === "home" && !single && (callouts.best || callouts.watch) && (
        <div className="ow2-split">
          {callouts.best ? (
            <button className="oh good" onClick={() => setDrawerRid(callouts.best!.id)} title={`Open ${callouts.best.name}`}>
              <span className="ic">🏆</span>
              <span className="txt"><small>Top performer · {RANGE_LABEL[globalRange]}</small>
                <b>{callouts.best.name}</b>
                <i><em>{inr(callouts.best.revenue)}</em> · {Math.round(callouts.best.share * 100)}% of revenue</i></span>
              <span className="mid" aria-hidden="true"><SparkArea points={callouts.best.spark} color="#10b981" height={44} animate /></span>
            </button>
          ) : <span className="oh ghost" />}
          {callouts.watch ? (
            <button className="oh warn" onClick={() => setDrawerRid(callouts.watch!.id)} title={`Open ${callouts.watch.name}`}>
              <span className="mid" aria-hidden="true"><SparkArea points={callouts.watch.spark} color="#ef4444" height={44} animate /></span>
              <span className="txt"><small>Needs attention</small>
                <b>{callouts.watch.name}</b>
                <i>trending <em className="r">▼ {Math.abs(Math.round(callouts.watch.pct))}%</em> this period</i></span>
              <span className="ic">⚠️</span>
            </button>
          ) : <span className="oh ghost" />}
        </div>
      )}
      {insights.length > 0 && (
        <div className="owx-insights" style={{ marginTop: 12 }}>
          {insights.map((ins, i) => (
            <span key={i} className="owx-insight"><i className={`fas ${ins.icon}`} aria-hidden="true" />{ins.text}</span>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const kpiRow = (
    <div className="adm-stats ow2-stats">
      <Kpi k="Revenue" href={reportHref("sales")} v={kMain?.revenue ?? 0} money loading={!kMain}
        delta={kMain?.prev ? { now: kMain.revenue, prev: kMain.prev.revenue } : undefined}
        prevTitle={PREV_LABEL[globalRange]} sub={PREV_LABEL[globalRange] || "whole history"} spark={sparkOf(globalRange, "revenue")} />
      <Kpi k="Orders" href={reportHref("volume")} v={kMain?.orders ?? 0} loading={!kMain}
        sub={kMain && kMain.paidOrders !== kMain.orders ? `${kMain.paidOrders} paid · rest still open` : PREV_LABEL[globalRange] || "whole history"}
        delta={kMain?.prev ? { now: kMain.orders, prev: kMain.prev.orders } : undefined}
        prevTitle={PREV_LABEL[globalRange]} spark={sparkOf(globalRange, "orders")} />
      <Kpi k="Avg order" href={reportHref("avgbill")} v={kMain?.avg ?? 0} money loading={!kMain} sub="per paid order" />
      <Kpi k="Today so far" href={reportHref("daysummary")} v={todayRev} money loading={!ov} pill="● live"
        sub={`${todayOrd} order${todayOrd === 1 ? "" : "s"} today`} />
      <Kpi k="Lost to cancellations" href={reportHref("cancellations")} v={money === "err" ? "—" : ((money as MoneyTotals | undefined)?.cancelledValue ?? 0)} money
        loading={!money}
        sub={money === "err" ? "couldn't total for this range" : ((money as MoneyTotals | undefined)?.cancelledOrders ? `${(money as MoneyTotals).cancelledOrders} order${(money as MoneyTotals).cancelledOrders === 1 ? "" : "s"}` : "none — great")} />
      {/* STAFF PAY AS AN EXPENSE (owner 2026-07-30). Only drawn when the restaurant has the
          module — otherwise the tiles don't exist, same as everywhere else. "After staff pay"
          is the number he asked for: revenue minus what actually went out to the team. */}
      {kMain?.staffPay && (
        <>
          <Kpi k="Staff pay out" href={reportHref("team")} v={kMain.staffPay.paidOut} money loading={!kMain}
            sub={kMain.staffPay.entries
              ? `${kMain.staffPay.entries} payment${kMain.staffPay.entries === 1 ? "" : "s"} · ${kMain.staffPay.people} on the pay list`
              : "nothing paid out yet"} />
          <Kpi k="After staff pay" href={reportHref("team")} v={(kMain.revenue ?? 0) - kMain.staffPay.paidOut} money loading={!kMain}
            sub="revenue minus what went out to the team" />
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Toolbar — Report ▾ + Refresh (the global range tabs are GONE by design) */}
      <div className="ow2-bar">
        {ov && !single ? (
          // Pick scope right here (owner 2026-07-27): "All restaurants" (group) or one
          // restaurant's full dashboard. Replaces the old static title + back button.
          <RestaurantDrop
            rests={ov.restaurants}
            activeRid={view.level === "home" ? null : (view as { rid: string }).rid}
            onPick={(rid) => (rid ? viewTo({ level: "restaurant", rid }) : goHome())}
          />
        ) : <span className="ow2-title">{single ? "Dashboard" : `Your ${restCount || "…"} restaurant${restCount === 1 ? "" : "s"}`}</span>}
        <div className="ow2-tools">
          {/* THE main range — one dropdown for every graph on the page (owner round-2).
              Picking it also resets the five KPI boxes; each box can still override. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <RangeDrop id="global" value={globalRange} onChange={pickRange} main />
            <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{rangeSpanText(globalRange)}</span>
          </div>
          <ReportMenu gather={gatherReport} filename={exportName} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <button className="adm-btn" onClick={manualRefresh} disabled={refreshing} title="Refresh now — recomputes the live numbers">
              <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
            </button>
            {updatedAt && !refreshing && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>updated {timeAgo(updatedAt)}</span>}
          </div>
        </div>
      </div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 16 }}><b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span></div>}


      {/* ═══════ HOME · MULTI ═══════ */}
      {view.level === "home" && !single && (
        <>
          {kpiRow}


          {/* Group revenue — 2–3 restaurants: Samsung-style stacked daily bars in
              green shades · 4+: "Who earns more" + the per-restaurant multi-line
              trend, side by side (owner round-2: "this was the best one"). */}
          {groupTrend.stacked ? (
            <div className="adm-card" style={{ marginBottom: 12 }}>
              <div className="ow2-ct">
                <span>Revenue over time <span className="mut">· {globalRange === "today" || globalRange === "yesterday" ? "by hour" : "by day"} · each bar split by restaurant</span></span>
                <span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span>
              </div>
              {!trendPayload ? <div className="adm-empty">Loading…</div>
                : <StackedDailyBars data={groupTrend.rows} lines={groupTrend.lines} />}
            </div>
          ) : (
            <div className="ow2-two" style={{ marginBottom: 12 }}>
              <div className="adm-card">
                <div className="ow2-ct"><span>Who earns more <span className="mut">· tap a bar to open</span></span>
                  <span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
                {!trendPayload || trendPayload.scope !== "group" ? <div className="adm-empty">Loading…</div>
                  : <WhoEarnsMore data={trendPayload.restaurantRevenue.map((r, i) => ({ id: r.id, name: r.name, revenue: r.revenue, orders: r.orders, accentColor: portfolioColor(i) }))}
                      onSelect={(id) => setDrawerRid(id)} />}
              </div>
              <div className="adm-card">
                <div className="ow2-ct"><span>Revenue over time <span className="mut">· {globalRange === "today" || globalRange === "yesterday" ? "by hour" : "by day"}</span></span></div>
                {!trendPayload ? <div className="adm-empty">Loading…</div>
                  : <AreaTrend data={groupTrend.rows} lines={groupTrend.lines} />}
              </div>
            </div>
          )}

          {/* THE table (design #4) — every multi tier. Click a row → side drawer. */}
          <div className="adm-card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
            <div className="hq-bar">
              <span className="hq-search">
                <i className="fas fa-magnifying-glass" aria-hidden="true" />
                <input value={tq} onChange={(e) => setTq(e.target.value)} placeholder={`Search ${restCount} restaurants…`} aria-label="Search restaurants" />
                {tq && <button className="hq-x" onClick={() => setTq("")} aria-label="Clear search">×</button>}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--muted)", fontWeight: 600 }}>
                Revenue window · {RANGE_LABEL[globalRange]}
              </span>
            </div>
            <div className="hq-scroll">
              <table className="hq-table ow2-table">
                <thead><tr>
                  {th("rank", "#", true)}
                  {th("name", "Restaurant", true)}
                  {th("today", "Today")}
                  {th("revenue", `Revenue (${RANGE_LABEL[globalRange]})`)}
                  {th("orders", "Orders")}
                  {th("avg", "Avg check")}
                  <th className="hide-m">Trend</th>
                  <th className="hide-m">Share</th>
                  {th("openTables", "Open")}
                  <th aria-hidden="true" />
                </tr></thead>
                <tbody>
                  {tableRows.length === 0 && (
                    <tr><td colSpan={10} className="hq-empty">{ov ? "No restaurant matches that search." : "Loading…"}</td></tr>
                  )}
                  {tableRows.map((r) => (
                    <tr key={r.id} className="hq-row" onClick={() => setDrawerRid(r.id)}
                      tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setDrawerRid(r.id); }}>
                      <td className="rk l">{r.rank}</td>
                      <td className="l"><span className="hq-nm"><span className="sw" style={{ background: r.accent }} aria-hidden="true" />{r.name}</span></td>
                      {/* Reports switched off ⇒ every money cell says so rather than printing
                          the deliberate zero as if it were this restaurant's real takings. */}
                      {r.reportsOff ? (
                        <td className="mut" colSpan={4} title="Reports are switched off for this restaurant, so its figures aren't shown here.">
                          <span style={{ opacity: .7 }}><i className="fas fa-eye-slash" style={{ marginRight: 6, fontSize: 10 }} aria-hidden="true" />figures hidden</span>
                        </td>
                      ) : (
                        <>
                          <td className="mut"><AnimatedNumber value={r.today} money /></td>
                          <td><b><AnimatedNumber value={r.revenue} money /></b></td>
                          <td className="mut"><AnimatedNumber value={r.orders} /></td>
                          <td className="mut"><AnimatedNumber value={r.avg} money /></td>
                        </>
                      )}
                      <td className="hide-m">{!r.reportsOff && r.spark && r.spark.length >= 2 ? <Spark points={r.spark} color={GREEN} width={84} height={22} /> : <span className="mut">—</span>}</td>
                      <td className="hide-m">{r.reportsOff ? <span className="mut">—</span> : <><span className="hq-meter" aria-hidden="true"><span style={{ width: `${Math.round(r.share * 100)}%`, background: r.accent }} /></span><span style={{ fontSize: 11 }}>{Math.round(r.share * 100)}%</span></>}</td>
                      <td className="mut"><AnimatedNumber value={r.openTables} /></td>
                      <td className="go"><i className="fas fa-chevron-right" aria-hidden="true" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* This month vs last month (replaced Busy hours, owner 2026-07-26 — the busy
              heatmap below already covers hour-of-day) + category. Locked to whole months. */}
          <div className="ow2-two" style={{ marginBottom: 12 }}>
            <div className="adm-card">
              <div className="ow2-ct"><span>Revenue · this month vs last <span className="mut">· {thisMonthName} vs {lastMonthName} · all {restCount} restaurants</span></span><span className="ow2-tag">{thisMonthName}</span></div>
              {!pl("month") ? <div className="adm-empty">Loading…</div>
                : <RevMonthCompare data={monthCompare.rows} curName={monthCurName} prevName={monthPrevName} curColor={GREEN} prevColor={GRAY_LINE} />}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Revenue by category <span className="mut">· all {restCount} restaurants</span></span><span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as GroupA | undefined)?.categories
                ? <CategoryDonut data={(pl(globalRange) as GroupA).categories!} />
                : <div className="adm-empty">Loading…</div>}
            </div>
          </div>

          {/* Heatmap + payments, side by side (group scope) */}
          <div className="ow2-two">
            <div className="adm-card">
              <div className="ow2-ct"><span>Busy heatmap <span className="mut">· by day × hour · all {restCount} restaurants</span></span><span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as GroupA | undefined)?.heatmap
                ? <Heatmap data={(pl(globalRange) as GroupA).heatmap!} accent={GREEN} rangeLabel={RANGES.find((r) => r.k === globalRange)!.label} />
                : <div className="adm-empty">Loading…</div>}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Payment methods <span className="mut">· how customers paid · all {restCount} restaurants</span></span><span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as GroupA | undefined)?.paymentMethods
                ? <PaymentDonut data={(pl(globalRange) as GroupA).paymentMethods} />
                : <div className="adm-empty">Loading…</div>}
            </div>
          </div>

          {highlights}
        </>
      )}

      {/* ═══════ SINGLE-OWNER HERO — identity + one-tap jumps ═══════ */}
      {view.level === "home" && single && ov && (
        <div className="own-hero" style={{ ["--rcol" as string]: GREEN }}>
          <div className="own-hero-id">
            <div className="own-hero-name">{ov.restaurants[0].name}</div>
            <div className="own-hero-sub">
              <span className={`own-pill ${ov.restaurants[0].active ? "on" : "off"}`}>{ov.restaurants[0].active ? "Active" : "Off"}</span>
              <span className="mono">{ov.restaurants[0].slug}</span>
              <span className="live"><i className="fas fa-chair" aria-hidden="true" /> {ov.restaurants[0].openTables} table{ov.restaurants[0].openTables === 1 ? "" : "s"} open now</span>
            </div>
          </div>
          <div className="own-hero-links">
            {ov.entitlements?.reports !== false && <Link href={withPin("/owner/reports")} className="own-hero-link"><i className="fas fa-file-invoice" aria-hidden="true" /> Reports</Link>}
            {ov.entitlements?.staff !== false && <Link href={withPin("/owner/staff")} className="own-hero-link"><i className="fas fa-users-gear" aria-hidden="true" /> Staff &amp; powers</Link>}
            {ov.entitlements?.issues !== false && <Link href={withPin("/owner/issues")} className="own-hero-link"><i className="fas fa-triangle-exclamation" aria-hidden="true" /> Feedback</Link>}
          </div>
        </div>
      )}

      {/* ═══════ RESTAURANT (drill-down, or HOME when there's only one) ═══════ */}
      {((view.level === "home" && single) || view.level === "restaurant") && activeRid && (
        <>
          {kpiRow}
          <div className="adm-card" style={{ marginBottom: 12 }}>
            <div className="ow2-ct">
              <span>Revenue over time <span className="mut">· {globalRange === "today" || globalRange === "yesterday" ? "by hour" : "by day"}</span></span>
              <span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span>
            </div>
            {!trendPayload || trendPayload.scope !== "restaurant" ? <div className="adm-empty">Loading…</div>
              : restTrend.length >= 9
                ? <AreaTrend data={restTrend} lines={[{ key: "Revenue", name: "Revenue", color: GREEN }]} />
                : <TimeBar data={restTrend.map((r) => ({ label: String(r.label), revenue: Number(r.Revenue) || 0, __orders: Number(r.__orders) || 0 })) as { label: string; revenue: number }[]} color={GREEN} />}
          </div>

          <div className="ow2-two">
            <div className="adm-card">
              <div className="ow2-ct"><span>Revenue · this month vs last <span className="mut">· {thisMonthName} vs {lastMonthName}</span></span><span className="ow2-tag">{thisMonthName}</span></div>
              {!pl("month") ? <div className="adm-empty">Loading…</div>
                : <RevMonthCompare data={monthCompare.rows} curName={monthCurName} prevName={monthPrevName} curColor={GREEN} prevColor={GRAY_LINE} />}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Revenue by category</span><span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as RestA | undefined)?.categories
                ? <CategoryDonut data={(pl(globalRange) as RestA).categories} />
                : <div className="adm-empty">Loading…</div>}
            </div>
          </div>

          <div className="ow2-two" style={{ marginTop: 12 }}>
            <div className="adm-card">
              <div className="ow2-ct"><span>Busy heatmap <span className="mut">· by day × hour</span></span><span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as RestA | undefined)?.heatmap
                ? <Heatmap data={(pl(globalRange) as RestA).heatmap!} accent={GREEN} rangeLabel={RANGES.find((r) => r.k === globalRange)!.label} />
                : <div className="adm-empty">Loading…</div>}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Payment methods <span className="mut">· how customers paid</span></span><span className="ow2-tag" title={rangeSpanText(globalRange)}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as RestA | undefined)?.paymentMethods && ((pl(globalRange) as RestA).paymentMethods.reduce((a, m) => a + m.revenue, 0) > 0)
                ? <PaymentDonut data={(pl(globalRange) as RestA).paymentMethods} />
                : (pl(globalRange) ? <div className="adm-empty">No recorded payments in this range.</div> : <div className="adm-empty">Loading…</div>)}
            </div>
          </div>

          {/* Records strip — the numbers worth bragging about */}
          {records && (records.bestDay || records.starDish) && (
            <div className="adm-card" style={{ marginTop: 12 }}>
              <div className="ow2-ct"><span>Your records <span className="mut">· the numbers worth bragging about</span></span></div>
              <div className="rv-recs">
                {records.bestDay && (
                  <div className="rv-rec"><span className="e">🏆</span><span><small>BEST DAY EVER</small><b><AnimatedNumber value={records.bestDay.revenue} money /></b>
                    <i>{new Date(records.bestDay.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST })} — beat it!</i></span></div>
                )}
                {records.starDish && (
                  <div className="rv-rec"><span className="e">👑</span><span><small>STAR DISH · 30 DAYS</small><b>{records.starDish.title}</b>
                    <i>{records.starDish.qty} plates</i></span></div>
                )}
                {records.fastHour && (
                  <div className="rv-rec"><span className="e">⚡</span><span><small>BUSIEST HOUR EVER</small><b><AnimatedNumber value={records.fastHour.orders} /> orders</b>
                    <i>{istWall(records.fastHour.at, { day: "numeric", month: "short", hour: "numeric", hour12: true })}</i></span></div>
                )}
                {records.bigBill && (
                  <div className="rv-rec"><span className="e">💎</span><span><small>BIGGEST BILL</small><b><AnimatedNumber value={records.bigBill.revenue} money /></b>
                    <i>{records.bigBill.table ? `table ${records.bigBill.table}` : "one sitting"}</i></span></div>
                )}
                {(records.regulars ?? 0) > 0 && (
                  <div className="rv-rec"><span className="e">🔁</span><span><small>REGULARS · 30 DAYS</small><b><AnimatedNumber value={records.regulars ?? 0} /> returning guests</b>
                    <i>same name, 2+ visits</i></span></div>
                )}
              </div>
            </div>
          )}

          <div className="ow2-two" style={{ marginTop: 12 }}>
            {/* Every dish — tap one for detail */}
            <div className="adm-card">
              <div className="ow2-ct">
                <span>Every dish <span className="mut">· tap one for detail</span></span>
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span className="rv-sort">
                    <button className={dishSort === "revenue" ? "on" : ""} onClick={() => setDishSort("revenue")}>By revenue</button>
                    <button className={dishSort === "qty" ? "on" : ""} onClick={() => setDishSort("qty")}>By qty</button>
                  </span>
                </span>
              </div>
              <DishList payload={pl(globalRange) as RestA | undefined} sort={dishSort}
                onDish={(t) => viewTo({ level: "dish", rid: activeRid, dish: t })} />
            </div>
            {/* Recent activity — the owner's mini log (surprise add) */}
            <div className="adm-card">
              <div className="ow2-ct">
                <span>Recent activity <span className="mut">· who did what</span></span>
                {ov?.entitlements?.activity !== false && <Link href={withPin("/owner/activity")} className="ow2-seeall">See all <i className="fas fa-arrow-right" aria-hidden="true" /></Link>}
              </div>
              {!acts ? <div className="adm-empty">Loading…</div>
                : acts.length === 0 ? <div className="adm-empty">Nothing yet.</div>
                : (
                  <div className="ow2-acts">
                    {acts.map((a) => (
                      <div key={a.id} className="ow2-act">
                        <span className={`pn pn-${a.panel}`}>{a.panel}</span>
                        <span className="tx">{a.action}{a.table_number ? ` · table ${a.table_number}` : ""}</span>
                        <span className="who">{a.actor || "—"}</span>
                        <span className="when">{timeAgo(a.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>

          {highlights}
        </>
      )}

      {/* ═══════ DISH ═══════ */}
      {view.level === "dish" && (
        <div className="adm-card own-dish">
          {dishView === "loading" || dishView === null ? <div className="adm-empty">Loading dish…</div>
          : dishView === "missing" ? (
            <div className="adm-empty">
              No sales for <b>{view.dish}</b> in {RANGE_LABEL[globalRange]}.{" "}
              <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => viewTo({ level: "restaurant", rid: view.rid })}>
                <i className="fas fa-arrow-left" aria-hidden="true" /> Back to restaurant
              </button>
            </div>
          ) : (<>
            <div className="own-dish-h" style={{ ["--rcol" as string]: GREEN }}>
              <div className="own-dish-name">{dishView.d.title}</div>
              <div className="adm-muted">{RANGE_LABEL[globalRange]}</div>
            </div>
            <div className="adm-stats" style={{ marginTop: 14 }}>
              <div className="adm-stat"><div className="k">Revenue</div><div className="v"><AnimatedNumber value={dishView.d.revenue} money /></div></div>
              <div className="adm-stat"><div className="k">Sold</div><div className="v">{dishView.d.qty}</div></div>
              <div className="adm-stat"><div className="k">Share of revenue</div><div className="v">{dishView.share}%</div></div>
              <div className="adm-stat"><div className="k">Rank by revenue</div><div className="v">#{dishView.rank}<span style={{ fontSize: 13, color: "var(--muted)" }}> / {dishView.of}</span></div></div>
            </div>
            <div className="ow2-ct" style={{ marginTop: 18 }}><span>How it compares <span className="mut">· revenue vs other dishes</span></span></div>
            <LeaderBar data={dishView.dishes.slice(0, 12).map((d) => ({ id: d.title, name: d.title, revenue: d.revenue, orders: d.qty, accentColor: d.title === dishView.d.title ? GREEN : "rgba(128,128,128,.35)" }))}
              onSelect={(title) => viewTo({ level: "dish", rid: (view as { rid: string }).rid, dish: title })} />
          </>)}
        </div>
      )}

      {/* ═══════ DRAWER — phase 2 of the 3-phase drill (multi only) ═══════ */}
      {drawer && (
        <div className="ow2-drawer-wrap" role="dialog" aria-label={`${drawer.r.name} summary`}>
          <div className="ow2-drawer-back" onClick={() => setDrawerRid(null)} aria-hidden="true" />
          <aside className="ow2-drawer">
            <header>
              <span className="hq-nm" style={{ fontSize: 15 }}><span className="sw" style={{ background: drawer.row?.accent || GREEN }} aria-hidden="true" />{drawer.r.name}</span>
              <button className="x" onClick={() => setDrawerRid(null)} aria-label="Close">✕</button>
            </header>
            <div className="bd">
              <div className="dstats">
                <div><small>Today</small><b><AnimatedNumber value={drawer.r.revenueToday} money /></b><i>{drawer.r.ordersToday} orders</i></div>
                <div><small>Revenue · {RANGE_LABEL[globalRange]}</small><b><AnimatedNumber value={drawer.row?.revenue ?? 0} money /></b><i>{drawer.row?.orders ?? 0} orders</i></div>
                <div><small>Avg check</small><b><AnimatedNumber value={drawer.row?.avg ?? 0} money /></b><i>per order</i></div>
                <div><small>Open tables</small><b><AnimatedNumber value={drawer.r.openTables} /></b><i>right now</i></div>
              </div>
              {drawerTrend.length >= 2 && (
                <div className="dspark"><small>Trend · {RANGE_LABEL[globalRange]}</small>
                  <AreaTrend data={drawerTrend} lines={[{ key: "Revenue", name: "Revenue", color: GREEN }]} height={170} /></div>
              )}
              <div className="dall">
                <span><i className="fas fa-receipt" aria-hidden="true" /> {drawer.r.ordersAll.toLocaleString("en-IN")} orders all-time</span>
                <span><i className="fas fa-indian-rupee-sign" aria-hidden="true" /> {inr(drawer.r.revenueAll)} all-time</span>
                <span className={`own-pill ${drawer.r.active ? "on" : "off"}`}>{drawer.r.active ? "Active" : "Off"}</span>
              </div>
            </div>
            <footer>
              <button className="full" onClick={() => openFull(drawer.r.id)}>
                View in full detail <i className="fas fa-arrow-right" aria-hidden="true" />
              </button>
            </footer>
          </aside>
        </div>
      )}

      <style jsx>{`
        .ow2-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        .ow2-title { font-size: 17px; font-weight: 800; }
        .ow2-back { display: inline-flex; align-items: center; gap: 8px; background: none; border: var(--border); border-radius: 9px; padding: 7px 13px; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .ow2-back:hover { color: var(--accent); border-color: var(--accent); }
        .ow2-tools { display: flex; gap: 10px; align-items: flex-start; }
        .ow2-stats { margin-bottom: 12px; }
        :global(.ow2-stats) { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
        .ow2-ct { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 800; margin-bottom: 10px; flex-wrap: wrap; }
        .ow2-ct .mut { color: var(--muted); font-weight: 500; }
        .ow2-tag { font-size: 10.5px; font-weight: 700; color: var(--muted); background: var(--bg); border: var(--border); border-radius: 8px; padding: 3px 9px; white-space: nowrap; }
        .ow2-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        /* table */
        .hq-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 12px 14px; border-bottom: var(--border); }
        .hq-search { flex: 1 1 220px; display: flex; align-items: center; gap: 9px; border: var(--border); background: var(--bg); border-radius: 9px; padding: 7px 12px; color: var(--muted); }
        .hq-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; font: inherit; font-size: 13px; color: var(--text); }
        .hq-search i { font-size: 12px; }
        .hq-x { background: none; border: none; color: var(--muted); font-size: 15px; cursor: pointer; padding: 0 2px; line-height: 1; }
        .hq-scroll { overflow: auto; max-height: 64vh; }
        .hq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .hq-table th { position: sticky; top: 0; background: var(--card); z-index: 1; text-align: right; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; padding: 9px 12px; border-bottom: var(--border); white-space: nowrap; user-select: none; }
        .hq-table th:hover { color: var(--accent); }
        .hq-table th.l, .hq-table td.l { text-align: left; }
        .hq-table td { padding: 9px 12px; border-bottom: var(--border); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .hq-table .rk { width: 30px; color: var(--muted); font-weight: 800; font-size: 11.5px; }
        .hq-row { cursor: pointer; }
        .hq-row:hover td, .hq-row:focus-visible td { background: var(--muted2); }
        .hq-nm { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hq-nm .sw { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
        .hq-meter { display: inline-block; vertical-align: middle; width: 52px; height: 7px; border-radius: 4px; background: rgba(128,128,128,.14); overflow: hidden; margin-right: 8px; }
        .hq-meter span { display: block; height: 100%; border-radius: 4px; }
        .hq-table .mut { color: var(--muted); }
        .hq-table .go i { color: var(--muted); font-size: 11px; }
        .hq-empty { text-align: center !important; color: var(--muted); padding: 26px 12px !important; }
        /* dish view bits reused */
        .own-dish-h { border-left: 4px solid var(--rcol); padding-left: 12px; }
        .own-dish-name { font-size: 22px; font-weight: 800; }
        .rv-sort { display: inline-flex; gap: 2px; }
        .rv-sort button { background: none; border: var(--border); padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .rv-sort button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
        .rv-recs { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
        .rv-rec { flex: 1 1 190px; min-width: 170px; display: flex; gap: 11px; align-items: center; border: 1px solid var(--border-c, rgba(128,128,128,.22)); border-radius: 12px; padding: 11px 14px; }
        .rv-rec .e { font-size: 20px; }
        .rv-rec small { display: block; font-size: 9.5px; color: var(--muted); font-weight: 800; letter-spacing: 0.5px; }
        .rv-rec b { display: block; font-size: 14px; line-height: 1.3; font-variant-numeric: tabular-nums; }
        .rv-rec i { display: block; font-style: normal; font-size: 10.5px; color: var(--muted); }
        /* hero */
        .own-hero { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; border: var(--border); border-left: 4px solid var(--rcol); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background: linear-gradient(90deg, color-mix(in srgb, var(--rcol) 9%, transparent), transparent 55%); }
        .own-hero-id { min-width: 0; flex: 1; }
        .own-hero-name { font-size: 20px; font-weight: 800; line-height: 1.2; }
        .own-hero-sub { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
        .own-hero-sub .live { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text); }
        .own-hero-sub .live i { color: var(--rcol); font-size: 11px; }
        .own-hero-links { display: flex; gap: 8px; flex-wrap: wrap; }
        :global(.own-hero-link) { display: inline-flex; align-items: center; gap: 8px; border: var(--border); background: var(--card); border-radius: 9px; padding: 8px 13px; font-size: 12.5px; font-weight: 700; color: var(--text) !important; text-decoration: none; transition: border-color .15s; }
        :global(.own-hero-link:hover) { border-color: var(--rcol); }
        :global(.own-hero-link i) { color: var(--rcol); font-size: 12px; }
        .own-pill { font-size: 10px; font-weight: 800; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
        .own-pill.on { background: color-mix(in srgb, var(--adm-ok) 18%, transparent); color: var(--adm-ok); }
        .own-pill.off { background: rgba(120,120,120,.18); color: var(--muted); }
        /* recent activity */
        :global(.ow2-seeall) { font-size: 11.5px; font-weight: 700; color: var(--accent) !important; text-decoration: none; }
        :global(.ow2-seeall i) { font-size: 10px; margin-left: 4px; }
        .ow2-acts { display: flex; flex-direction: column; gap: 2px; }
        .ow2-act { display: grid; grid-template-columns: auto 1fr auto auto; gap: 10px; align-items: center; padding: 8px 6px; border-radius: 8px; font-size: 12.5px; }
        .ow2-act:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
        .ow2-act .pn { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; background: rgba(128,128,128,.14); color: var(--muted); }
        .ow2-act .tx { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ow2-act .who { color: var(--muted); font-size: 11.5px; }
        .ow2-act .when { color: var(--muted); font-size: 10.5px; white-space: nowrap; }
        /* drawer */
        .ow2-drawer-wrap { position: fixed; inset: 0; z-index: 90; }
        .ow2-drawer-back { position: absolute; inset: 0; background: rgba(5,8,14,.55); backdrop-filter: blur(2px); animation: ow2fade .2s ease-out; }
        .ow2-drawer { position: absolute; top: 0; right: 0; height: 100%; width: min(400px, 94vw); background: var(--card); border-left: var(--border); box-shadow: -18px 0 50px rgba(0,0,0,.4); display: flex; flex-direction: column; animation: ow2slide .24s cubic-bezier(.4,0,.2,1); }
        @keyframes ow2slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes ow2fade { from { opacity: 0; } to { opacity: 1; } }
        .ow2-drawer header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 18px; border-bottom: var(--border); }
        .ow2-drawer .x { background: var(--bg); border: var(--border); color: var(--text); width: 32px; height: 32px; border-radius: 9px; font-size: 13px; cursor: pointer; }
        .ow2-drawer .bd { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }
        .dstats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .dstats > div { border: var(--border); border-radius: 11px; padding: 11px 13px; }
        .dstats small { display: block; font-size: 10px; color: var(--muted); font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
        .dstats b { display: block; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 2px; }
        .dstats i { display: block; font-style: normal; font-size: 10.5px; color: var(--muted); }
        .dspark { border: var(--border); border-radius: 11px; padding: 11px 13px; }
        .dspark small { display: block; font-size: 10px; color: var(--muted); font-weight: 800; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
        .dall { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; font-size: 12px; color: var(--muted); }
        .dall i { opacity: .7; margin-right: 4px; }
        .ow2-drawer footer { padding: 14px 18px; border-top: var(--border); }
        .ow2-drawer .full { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px; background: var(--accent); color: #06251a; border: none; border-radius: 11px; padding: 12px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; }
        .ow2-drawer .full:hover { filter: brightness(1.08); }
        @media (max-width: 1080px) { :global(.ow2-stats) { grid-template-columns: repeat(3, 1fr) !important; } }
        @media (max-width: 760px) {
          :global(.ow2-stats) { grid-template-columns: repeat(2, 1fr) !important; }
          .ow2-two, .ow2-callouts { grid-template-columns: 1fr; }
          .hq-table .hide-m { display: none; }
          .hq-table th:nth-child(3), .hq-table td:nth-child(3), .hq-table th:nth-child(6), .hq-table td:nth-child(6) { display: none; }
          .ow2-act .who { display: none; }
        }
      `}</style>
    </>
  );
}

// ── Every-dish list (kept from the old view, range now per-card) ──────────────
function DishList({ payload, sort, onDish }: { payload?: RestA; sort: "revenue" | "qty"; onDish: (t: string) => void }) {
  if (!payload) return <div className="adm-empty">Loading…</div>;
  const dishes = [...payload.dishes].sort((a, b) => (sort === "revenue" ? b.revenue - a.revenue : b.qty - a.qty));
  const maxRev = Math.max(1, ...dishes.map((d) => d.revenue));
  return (
    <div className="rv-dishes">
      {dishes.length === 0 && <div className="adm-empty">No dish sales in this range.</div>}
      {dishes.map((d) => (
        <button key={d.title} className="rv-dish" onClick={() => onDish(d.title)}>
          <span className="rv-dn">{d.title}</span>
          <span className="rv-bar"><span style={{ width: `${(d.revenue / maxRev) * 100}%`, background: GREEN }} /></span>
          <span className="rv-q">{d.qty} sold</span>
          <span className="rv-r">{inr(d.revenue)}</span>
          <i className="fas fa-chevron-right" aria-hidden="true" />
        </button>
      ))}
      <style jsx>{`
        .rv-dishes { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; max-height: 420px; overflow-y: auto; }
        .rv-dish { display: grid; grid-template-columns: minmax(110px, 1.4fr) 1.6fr auto auto auto; align-items: center; gap: 12px; padding: 9px 8px; border: none; border-radius: 8px; background: none; cursor: pointer; font: inherit; color: inherit; text-align: left; }
        .rv-dish:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
        .rv-dn { font-weight: 700; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rv-bar { height: 8px; border-radius: 4px; background: rgba(128,128,128,.14); overflow: hidden; }
        .rv-bar span { display: block; height: 100%; border-radius: 4px; }
        .rv-q { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
        .rv-r { font-weight: 800; font-variant-numeric: tabular-nums; min-width: 70px; text-align: right; }
        .rv-dish i { color: var(--muted); font-size: 11px; }
        @media (max-width: 760px) { .rv-dish { grid-template-columns: 1fr auto auto; } .rv-bar { display: none; } }
      `}</style>
    </div>
  );
}
