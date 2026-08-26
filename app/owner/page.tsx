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
import { inr, useActiveAutoRefresh, actLabel, panelLabel, timeAgo } from "@/components/admin/shared";
import { asSuffix, asValue } from "@/lib/ownerPin";
import {
  AreaTrend, TimeBar, LeaderBar, WhoEarnsMore, CategoryDonut, PaymentDonut, canonPayMethod,
  DeltaChip, Spark, SparkArea, Heatmap, StackedDailyBars, RevMonthCompare,
} from "@/components/owner/Charts";
import { businessDayStartIso } from "@/lib/businessDay";
import { compactINR } from "@/lib/money";
import { portfolioColor } from "@/lib/restaurantColor";
import { AnimatedNumber } from "@/components/owner/AnimatedNumber";
import { reportRealtime } from "@/lib/connectionStatus";
import { fetchOwnerOverview } from "@/lib/ownerOverviewCache";
import { readSnap, writeSnap } from "@/lib/ownerSnap";
import { actorLabel, actorTitle } from "@/lib/ownerActor";
import { useBackClose } from "@/lib/backStack";
import { type ReportData } from "@/components/owner/ownerReportDoc";
import { gatherOwnerReport } from "@/lib/ownerReportGather";
import { ReportMenu } from "@/components/owner/OwnerReportButton";

const DAY_MS = 86400000;
// The server clamps the busy grid to the last ~90 days on purpose (an all-time grid hit the
// statement timeout and 500'd the whole dashboard). The card's chip still showed the SELECTED
// range, so "All time" sat over a 90-day picture (T5 sweep, 2026-08-06). These are the ranges
// that are actually wider than the clamp.
const HEAT_CLAMP_DAYS = 90;
const HEAT_CLAMPED: Partial<Record<Range, boolean>> = { all: true };
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
// The "we couldn't read part of this" strip a chart card shows when the group total is incomplete.
// Deliberately INSIDE the affected card rather than a page-level banner: the owner needs to know
// WHICH chart is short, not merely that something somewhere failed.
function PartialStrip({ keys, msg }: { keys?: string[]; msg?: string }) {
  if (!keys || !keys.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px", fontSize: 12.5, color: "var(--adm-warn)" }}>
      <i className="fas fa-triangle-exclamation" aria-hidden="true" />
      {/* `msg` because not every partial read is about several restaurants: the all-time records
          read is one restaurant's, so the group wording would have been simply untrue there
          (T12 sweep, 2026-08-27). Everything else keeps the original sentence. */}
      <span>{msg ?? "Some restaurants didn\u2019t answer, so this total is incomplete. Tap Refresh to try again."}</span>
    </div>
  );
}

type GroupA = { scope: "group"; restaurantRevenue: GroupRev[]; timeseries: TsRow[]; timeseriesPrev?: TsPrevRow[]; paymentMethods: Pay[]; heatmap?: HeatRow[]; categories?: { category: string; qty: number; revenue: number }[]; prev: Prev; cachedAt?: string;
  // Named figures the server could NOT read this time (lib/partialRead). A chart built from only
  // SOME of the group is still drawn — but it must say so, or a total that is too small reads as
  // fact (T9 finding F18, 2026-08-07).
  partial?: string[]; staffPay?: { paidOut: number; people: number; entries: number } | null;
  // Food cooked and then binned, priced at what the ingredients cost (mig 337). null = the read
  // failed, which is reported rather than shown as a zero — a silent 0 would say he wasted nothing.
  foodLoss?: { amount: number; entries: number } | null };
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
  // openTables is NOT here: the analytics route stopped computing it (T5 sweep, 2026-08-06) —
  // it was a ~165ms live count on every request that no card ever read. Every open-tables figure
  // on this page comes from the OVERVIEW payload (`ov.restaurants[…].openTables`).
  kpis: { revenue: number; orders: number; paidOrders?: number; avgOrder: number; topDish: string };
  // Staff pay that LEFT in this window (mig 221). null = this restaurant doesn't have the
  // Staff-profiles-&-pay module, so no such tile is drawn at all.
  staffPay?: { paidOut: number; people: number; entries: number } | null;
  /** Food cooked and then binned, at ingredient cost (mig 337). See the group type above. */
  foodLoss?: { amount: number; entries: number } | null;
  timeseries: TsRow[]; timeseriesPrev?: TsPrevRow[]; dishes: Dish[]; categories: { category: string; qty: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[]; paymentMethods: Pay[];
  heatmap?: HeatRow[]; records?: Records; cachedAt?: string;
  // Named figures the server could NOT read (lib/partialRead) — the restaurant scope gained
  // this for the busy heatmap, which used to degrade to an empty grid in silence
  // (T5 sweep, 2026-08-11).
  partial?: string[];
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
// Heatmap in Charts.tsx. NOTHING is pinned to its own range any more — the last card that
// was (Busy hours, last 7 days) went with the 2026-08-05 clean-up noted further down.
// 2–3 restaurants: the split daily bars stay in the THEME's green family — light +
// dark green, a third non-brown colour only if needed (owner round-2: "only brown
// doesn't make sense"). Identity accent colours are for the many-tier only.
const GREEN_SHADES = ["#34d399", "#0f766e", "#a3e635"];
// 4+ restaurants: each gets a DISTINCT, SOLID colour, because most restaurants default to the
// same gold accent and several bars/lines came out the identical washed-out yellow (owner,
// 2026-07-27). The palette moved to lib/restaurantColor so the SHELL's sidebar and switcher can
// use the very same colour — they were still painting their own brand accents (T5, 2026-08-07).

const IST = "Asia/Kolkata";
// Some RPCs return a zone-LESS IST wall-clock timestamp — see the note in the old
// dashboard (owner audit 2026-07-06): treat zone-less as UTC so numbers print the same
// wherever they're viewed.
function istWall(ts: string, opts: Intl.DateTimeFormatOptions): string {
  const zoneless = /T/.test(ts) && !/[Z+]|[+-]\d\d:?\d\d$/.test(ts);
  const d = new Date(zoneless ? ts + "Z" : ts);
  return d.toLocaleString("en-IN", { ...opts, timeZone: zoneless ? "UTC" : IST });
}
/** "8 PM" — the one clock format this console uses (matches the Studio's hourLabel). */
const hour12 = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
/** istWall() for a stamp that includes an hour — but upper-cased, because toLocaleString
 *  writes "1 pm" and every other time on this console is written "1 PM". The records strip was
 *  the one place that leaked the locale's own casing (T5 sweep, 2026-08-11). */
const istWall12 = (ts: string, opts: Intl.DateTimeFormatOptions): string =>
  istWall(ts, opts).replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());
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
// An istKey() day/hour key → the same friendly label tsLabel() gives ("4 Aug", "3 PM").
// `istKey` builds "YYYY-MM-DD" (day grain) or "YYYY-MM-DD HH" (hour grain) IN IST, so pin the
// parse to +05:30 rather than letting the browser read it as local time.
function keyLabel(key: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}))?$/.exec(key);
  if (!m) return key;
  const d = new Date(`${m[1]}T${m[2] ?? "00"}:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return key;
  return m[2] != null
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
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
// HOW LONG AGO — ONE WORDING (owner, 2026-08-18, approving the sweep's 🟡 4).
// This file used to carry its own copy that wrote "5 min ago" / "3 hr ago", while Audit & logs one
// click away — and every one of the eleven admin-console screens — wrote "5m ago" from the shared
// helper. Same fact, two wordings, on two screens he moves between constantly. The SHORT form wins
// because it is already the wording on twelve screens: changing those instead would mean editing the
// one file the whole admin console shares, for a bigger blast radius and no better answer. So the
// local copy is gone and `timeAgo` below is the shared one, imported with `inr` and the log
// translators from components/admin/shared.

// WHICH ELEMENT ACTUALLY SCROLLS on the owner console (T12 sweep, 2026-08-17).
// At >900px it is `.adm-main`; at <=900px globals.css gives `.adm-main` `overflow-y: visible` and
// makes `.adm` the 100dvh scroller instead. The window NEVER scrolls at either width — measured:
// at 1280x800 `.adm-main` is 2256/751 and the document is 800/800; at 360x780 `.adm` is 4109/780
// while `.adm-main` is 4052/4052. So a save/restore written against `.adm-main` alone silently did
// nothing on a phone, which is exactly how the owner's "back should keep me where I was" was lost
// there. Same shape as `port()` in app/aevinite/restaurants/page.tsx, which solved this first.
function scrollPort(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const sel of [".adm-main", ".adm"]) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.scrollHeight > el.clientHeight + 2) return el;
  }
  return document.querySelector<HTMLElement>(".adm-main");
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
        /* --accent-ink, not --accent: this is the accent used as INK on a 16% tint of ITSELF, which
           measured 3.65:1 on the light console (T26 sweep, 2026-08-22). --accent-on covers ink on a
           full accent fill; --accent-ink is the tint half, declared per console skin in globals.css.
           The dark override below is unchanged. */
        .owr-btn.main { background: color-mix(in srgb, var(--accent) 16%, transparent); border: 1px solid var(--accent); color: var(--accent-ink, var(--accent)); font-size: 12.5px; font-weight: 800; padding: 7px 14px; border-radius: 10px; }
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
// per restaurant matches its portfolioColor(id) in the charts, so a restaurant
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
  // the SHARED short form (lib/money) — this used to be a private copy that went to crores while
  // the chart axis beside it stopped at lakhs, so one amount read two ways (T5 sweep, 2026-08-06)
  const money = compactINR;
  return (
    <span className="owd" data-restdrop>
      <button type="button" className="owd-btn" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {cur ? <span className="sw" style={{ background: portfolioColor(cur.id) }} aria-hidden="true" />
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
              <span className="sw" style={{ background: portfolioColor(r.id) }} aria-hidden="true" />
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

// ── D1-style KPI card: sparkline inside, delta chip. The whole card is a BUTTON that opens the
// tile's popup (owner, 2026-08-18: "if you click on orders, it will take you to that pop up, which
// will show average order and all the details of the order"). It used to be a Link straight into
// the report; that is now the LAST line of the popup instead, so the figure gets explained before
// he leaves the page — and so the link can carry the scope and the range he is actually looking at.
//
// `compact` prints the short form on the FACE of the tile (₹55.1L) — his ask, and what makes five
// tiles fit one line. The exact rupees are in the popup.
function Kpi({ k, v, money, compact, delta, prevTitle, sub, loading, spark, pill, onOpen }: {
  k: string; v: number | string; money?: boolean; compact?: boolean;
  delta?: { now: number; prev: number | null };
  prevTitle?: string; sub?: string; loading?: boolean; spark?: number[];
  pill?: string; onOpen?: () => void;
}) {
  const hasSpark = !!spark && spark.length >= 2 && !loading;
  const body = (
    <>
      <div className="ow2-kt">
        <span className="k">{k}</span>
        {pill ? <span className="ow2-live">{pill}</span> : null}
      </div>
      <div className="row">
        <div className="v">{typeof v === "number"
          ? (compact && !loading
              // the SHARED short form (lib/money), the same one the restaurant switcher and the
              // chart axes use — so one amount never reads two ways on one screen
              ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{compactINR(v)}</span>
              : <AnimatedNumber value={v} loading={loading} money={money} />)
          : v}</div>
        {!loading && delta && <DeltaChip now={delta.now} prev={delta.prev} title={prevTitle || ""} />}
      </div>
      {sub && !loading && <div className="ow2-sub">{sub}</div>}
      {hasSpark && (
        <div className="ow2-spark" aria-hidden="true"><SparkArea points={spark!} color={GREEN} height={34} /></div>
      )}
    </>
  );
  const styles = (
    <style jsx global>{`
      /* overflow must stay VISIBLE so popups escape the card (round-2 bug: overflow
         hidden clipped the dropdown). The spark clips itself via its rounded wrapper. */
      .ow2-kpi { position: relative; }
      /* THE SPARKLINE BAND MUST BE RESERVED, AND THE RULE MUST WIN THE CASCADE (T9 sweep,
         2026-08-05). The spark is absolute at bottom:0, 34px tall. This used to be
         '.ow2-kpi { padding-bottom: 30px }' — ONE class, which loses to
         '.owx .adm-stat { padding: 10px 14px }' in app/globals.css (two selectors). So the reserved
         space was never 30px, it was 10px, and on the owner's 360px phone the green line was drawn
         straight THROUGH 'vs the 30 days before' and '4184 paid, rest still open'. Measured, not
         guessed: the caption box overlapped the spark box by 14px.
         Three classes so it beats that rule; keep this >= the SparkArea height below, plus air. */
      .owx .adm-stat.ow2-kpi { padding-bottom: 44px; }
      /* …but only a tile that HAS a spark needs that band. Five of the seven don't, and on a
         360px phone each was carrying 34px of empty green-less space (T5 sweep, 2026-08-06).
         Same three-class weight so it still beats .owx .adm-stat. */
      .owx .adm-stat.ow2-kpi.ow2-nospark { padding-bottom: 14px; }
      /* ow2-click is a <button> now (owner, 2026-08-18: the tile opens a popup). A button brings
         its own font, centring and padding, so reset all three or the tiles stop matching the cards
         around them. width:100% keeps it filling its grid track, and text-align:left undoes the
         centring a button does by default. NEVER use a backtick in these comments — this block is a
         template literal and a backtick closes it (this file's own warning, learned twice today). */
      .ow2-kpi.ow2-click { cursor: pointer; text-decoration: none; color: inherit; display: block; width: 100%; font: inherit; text-align: left; transition: border-color .15s, transform .15s; }
      .ow2-kpi.ow2-click:hover { border-color: var(--accent); transform: translateY(-2px); }
      .ow2-kt { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .ow2-kt .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 800; }
      /* nowrap + flex-none: on a 360px phone the dot and the word "live" stacked inside the
         pill and the label broke to "TODAY SO / FAR" (T5 sweep, 2026-08-11). */
      /* ── THE "live" PILL NEEDS ITS OWN READABLE INK (T12 sweep, 2026-08-17) ──────────────────
         This used to be a flat ${GREEN}, and for a long time nothing showed it: every KPI tile was
         a Link, and globals.css line 2392 forces every element inside an anchor to inherit its colour, so there
         the pill quietly took the tile's own ink and measured 17.74:1 on the light skin. The moment
         a tile is NOT a link — which is now the case when Reports are switched off for the
         restaurant — the declared value applies and the same pill measures 1.92:1 on a white card.
         Fixed the way this file already fixes it for the top-performer figure a few hundred lines
         down: mix the skin's own accent toward the skin's own text, so it stays green in both
         themes and readable in both. Measured after the change, in the div case: light 5.9:1,
         dark 8.4:1. Do not put a flat hex back here. */
      .ow2-live { font-size: 10px; font-weight: 800; color: color-mix(in srgb, var(--accent) 80%, var(--text)); background: color-mix(in srgb, ${GREEN} 14%, transparent); border-radius: 999px; padding: 2px 8px; white-space: nowrap; flex: none; }
      .ow2-kt .k { min-width: 0; }
      .ow2-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
      .ow2-spark { position: absolute; left: 0; right: 0; bottom: 0; opacity: .55; pointer-events: none; overflow: hidden; border-radius: 0 0 12px 12px; }
      /* ── "TODAY SO FAR" USED TO BREAK IN HALF ON A PHONE ───────────────────────────────
         Two tiles per row at 360px is a 162px tile, and four words beside the "● live" pill
         do not fit one line at the size the label is really drawn at.
         It took three goes and both traps this file already documents (T5, 2026-08-11):
           1. a two-class selector (.ow2-kt .k) loses to .owx .adm-stat .k in globals.css,
              which is three classes and comes later — so the rule silently did nothing;
           2. writing the four-class version in the PAGE's scoped style block did nothing
              either, because styled-jsx stamps its jsx- class only on markup written in
              that component, and .owx belongs to the shell — the same reason .hq-table th
              needed :global() lower down.
         So it lives HERE, in this component's *global* block, next to the padding rule that
         escaped trap 1 the same way. Measured on the deployed phone viewport, not read off
         the source. The label itself stays wrappable: "LOST TO CANCELLATIONS" has to break. */
      @media (max-width: 760px) {
        .owx .adm-stat.ow2-kpi .ow2-kt { flex-wrap: wrap; row-gap: 3px; }
        .owx .adm-stat.ow2-kpi .ow2-kt .k { font-size: 9.5px; letter-spacing: .02em; }
      }
    `}</style>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen}
      className={`adm-stat owx-kpi ow2-kpi ow2-click${hasSpark ? "" : " ow2-nospark"}`}
      title={`${k} — tap for the detail`}>{body}{styles}</button>
  ) : (
    <div className={`adm-stat owx-kpi ow2-kpi${hasSpark ? "" : " ow2-nospark"}`}>{body}{styles}</div>
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
    const el = scrollPort();
    if (el) drillScroll.current[levelDepth(prevView.current)] = el.scrollTop;
    setView(v);
  };
  useLayoutEffect(() => {
    const el = scrollPort();
    const from = levelDepth(prevView.current), to = levelDepth(view);
    prevView.current = view;
    if (!el || from === to) return;
    el.scrollTop = to > from ? 0 : drillScroll.current[to];   // deeper → top; back → restore
  }, [view]);
  // ── THE DRILL IS A BACK STEP (T12 sweep, 2026-08-17) ─────────────────────────────────────────
  // Opening a dish changes the SCREEN without changing the address, so on its own the phone's BACK
  // button skipped it and left the owner panel altogether. Measured on a 360x780 A35: after tapping
  // one dish there was NO way back to the dashboard at all — the top-strip crumb is display:none at
  // that width, the ☰ drawer's own "Dashboard" link is already the active route, and re-opening
  // /owner deliberately restores the drill (the refresh-proof drill, owner round-5). Only clearing
  // session storage escaped.
  //
  // So the drill registers with the back-stack manager, the same singleton the range dropdowns, the
  // restaurant drawer and the heatmap zoom already use — never a hand-rolled pushState (project
  // rule). ONE LAYER PER LEVEL, in hook order, so the layers stack restaurant-then-dish and BACK
  // peels dish → restaurant → dashboard. A single-restaurant owner jumps home→dish, which registers
  // both at once; the dish layer sends him straight home and the restaurant layer then unregisters
  // itself, which reconcile() rewinds invisibly (same URL either way).
  useBackClose("owner-drill-restaurant", view.level !== "home", () => setView({ level: "home" }));
  useBackClose("owner-drill-dish", view.level === "dish", () => setView((v) =>
    v.level === "dish" && !single ? { level: "restaurant", rid: v.rid } : { level: "home" }));
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
  /** Per restaurant: the server told us it could not read the all-time records. See fetchPayload. */
  const [recsUnread, setRecsUnread] = useState<Record<string, boolean>>({});
  const [acts, setActs] = useState<Act[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // WHEN each payload was computed, per cache key. The single page-level "updated X ago" was set
  // by whichever request answered LAST, so it could describe a different card's snapshot than the
  // one being read (T5 sweep, 2026-08-06). Now every card can state its own age, and the header
  // line reports the OLDEST thing on screen — the honest worst case.
  const [ages, setAges] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  // A DELIBERATE "this section isn't enabled for you" answer, kept apart from `err` so it is never
  // dressed as a breakage (see the branch in fetchPayload). While it is set, no analytics payload
  // is ever going to arrive, so nothing on the page may keep saying "Loading…".
  //
  // It carries the SCOPE it belongs to. On an estate where the admin has taken Reports away from
  // one restaurant, drilling into that restaurant must not blank the group view the owner then
  // returns to — and a return to a scope already in `cache` fires no fetch, so nothing would clear
  // a scope-less flag.
  const [offScope, setOffScope] = useState<{ scope: string; msg: string } | null>(null);
  // Has ANY payload answered this visit? Until one has, what is on screen is the instant-paint
  // snapshot from the last time this tab was open — real numbers, but last-seen ones. The age
  // line said "updated 15 hr ago" without saying that was a saved copy (T5 sweep, 2026-08-11).
  const [landed, setLanded] = useState(false);
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
  // WHICH RESTAURANTS THESE NUMBERS ARE ACTUALLY ABOUT (2026-08-05).
  // The captions below said "all N restaurants" using restCount — every restaurant the owner
  // owns, including any whose "reports" section Aevidine has switched off. Those stay in the
  // list on purpose (so the owner knows they exist) with their revenue zeroed and flagged
  // reportsOff, and /api/owner/analytics narrows its scope to the entitled ones — so on an
  // estate of 5 with reports off for 1, a caption claimed 5 over numbers covering 4. A money
  // label that overstates its own coverage is exactly what a decision gets built on.
  const reportedCount = (ov?.restaurants ?? []).filter((r) => !r.reportsOff).length;
  const restScopeText =
    reportedCount === restCount
      ? `all ${restCount} restaurant${restCount === 1 ? "" : "s"}`
      : `${reportedCount} of ${restCount} restaurants · takings hidden for ${restCount - reportedCount}`;
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

  /** The refusal, but only if it is about the scope currently on screen. */
  const offNote = offScope && offScope.scope === scopeKey ? offScope.msg : null;
  // ── AND NO STALE FIGURE MAY LEAK THROUGH IT (T12 sweep, 2026-08-17, second pass) ──────────────
  // `pl` falls back to the instant-paint snapshot — real numbers from the last time this tab was
  // open. Seen in a light-skin screenshot of the switched-off state: the note said figures were not
  // shown while the tiles beside it still drew "-59%" delta chips and green sparklines, the revenue
  // chart was fully painted, and "Staff pay out" and "After staff pay" printed real money derived
  // from the very revenue that was supposedly hidden. Once the server has refused this scope, the
  // honest answer is that we have nothing to show for it — snapshot included.
  const pl = useCallback((range: string): Payload | undefined =>
    (offScope && offScope.scope === scopeKey) ? undefined
      : cache[`${scopeKey}|${range}`] ?? snap?.cache?.[`${scopeKey}|${range}`], [cache, snap, scopeKey, offScope]);
  const moneyOf = (range: Range): MoneyTotals | "err" | undefined =>
    offNote ? undefined : moneyCache[`${scopeKey}|${range}`] ?? snap?.money?.[`${scopeKey}|${range}`];

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
    // focus=all is an explicit "show me everything" from the top-bar switcher on another page.
    // It must BEAT the saved drill — without it, "All restaurants" landed here and the restore
    // below quietly put you back inside the last restaurant you had opened.
    if (focus === "all") { setView({ level: "home" }); drillRestored.current = true; }
    else if (focus) { setView({ level: "restaurant", rid: focus }); drillRestored.current = true; }
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
      // A deliberate "Reports aren't enabled for this restaurant" (403, `disabled: true`) is a
      // PERMISSION, not a network problem — it used to drop the top strip's Connected pill to a
      // warning state and show the entitlement text in the red "couldn't load" banner
      // (T5 sweep, 2026-08-06). Say it plainly and leave the connection light alone.
      // ── SWITCHED OFF IS NOT BROKEN (T12 sweep, 2026-08-17) ──────────────────────────────────
      // This branch has always understood that a 403 + `disabled: true` is a PERMISSION rather
      // than a network problem — the 2026-08-06 fix stopped it dropping the Connected pill. But
      // it still put the sentence in `err`, and `err` renders inside a RED-BORDERED card headed
      // "Couldn't load.", over a page of cards that then said "Loading…" for ever and three KPI
      // values that stayed blank. Measured by replaying the server's own answer: an owner whose
      // Reports the admin deliberately switched off was told, permanently, that his dashboard was
      // broken. It gets its own state so the page can say it plainly and stop pretending to load.
      if (a.error && a.disabled) { setOffScope({ scope: sk, msg: errText(a.error) }); setErr(null); setLanded(true); return; }
      if (a.error) throw new Error(errText(a.error));
      setOffScope((cur) => (cur && cur.scope === sk ? null : cur));
      setCache((c) => ({ ...c, [key]: a }));
      setLanded(true);
      if (a.cachedAt) { setUpdatedAt(a.cachedAt); setAges((m) => ({ ...m, [key]: a.cachedAt })); }
      // ── AND REMEMBER WHEN IT COULD NOT BE READ (T12 sweep, 2026-08-27) ────────────────────────
      // /api/owner/analytics already sends `partial: ["records"]` when the all-time records RPC
      // fails — its own comment calls that improvement I5, "A TILE THAT VANISHES SAYS SO". Only the
      // server half was ever built: nothing on this page read the key, so the "Your records" card
      // simply disappeared and the screen said nothing at all. Measured by replaying the server's
      // own answer. Held per RESTAURANT rather than read off the current payload, because
      // `records=1` rides on ONE request per restaurant, so the flag would otherwise come and go
      // with the range dropdown. A later successful read clears it.
      if (rid) {
        if (a.records) { setRecs((m) => ({ ...m, [rid]: a.records })); setRecsUnread((m) => (m[rid] ? { ...m, [rid]: false } : m)); }
        else if (Array.isArray(a.partial) && a.partial.includes("records")) setRecsUnread((m) => ({ ...m, [rid]: true }));
      }
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
      if (m.cachedAt) { setUpdatedAt(m.cachedAt); setAges((a2) => ({ ...a2, [`money:${sk}|${range}`]: m.cachedAt })); }
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
    // ONLY the range he is most likely to want next — his LAST-USED one (already remembered in
    // localStorage) — instead of all seven. Warming everything cost 14 requests per scope on every
    // visit, and again for each restaurant opened, for periods he mostly never looks at
    // (T5 sweep, 2026-08-06). Switching to a cold range still works: it just fetches then, and the
    // server's snapshot cache means the SECOND look at it is instant anyway.
    let saved: Range | null = null;
    try { const v = localStorage.getItem(RANGE_LS_KEY) as Range | null; if (v && RANGES.some((r) => r.k === v)) saved = v; } catch { /* storage unavailable */ }
    const others = Array.from(new Set<Range>([saved && saved !== globalRange ? saved : "today"]))
      .filter((k) => k !== globalRange);
    const timers = others.map((k, i) => setTimeout(() => {
      if (!cacheRef.current[`${sk}|${k}`]) fetchPayload(sk, k);
      if (!moneyRef.current[`${sk}|${k}`]) fetchMoney(sk, k);
    }, 4000 + i * 1500));
    return () => { timers.forEach(clearTimeout); };
    // globalRange deliberately NOT a dep: warming runs once per scope per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ov, scopeKey, fetchPayload, fetchMoney]);

  // Recent activity mini feed (single/drilled view) — 6 rows, scoped, egress-tiny.
  //
  // ── "SWITCHED OFF" IS NOT "STILL LOADING" (T12 sweep, 2026-08-17) ────────────────────────────
  // /api/owner/oplog answers 403 + `disabled: true` when the admin has taken Audit & logs away
  // from this owner (hiding is never the only guard). This function used to fold that answer into
  // the same `null` it uses for "nothing arrived", and `null` is what the card renders as
  // "Loading…" — so the one card on the home screen an owner opens every day sat spinning
  // FOREVER, with a live "See all" beside it. Measured by replaying the server's own 403.
  // Module checklist point 6: render nothing when the flag is off. So the refusal gets its own
  // state and the whole card is left out.
  const [actsOff, setActsOff] = useState(false);
  // ── …AND NEITHER IS A FAILED READ (T12 sweep, 2026-08-27) ────────────────────────────────────
  // The 2026-08-17 fix above taught this card the difference between "switched off" and "still
  // loading". It left the third case alone: a read that simply FAILS — the server 500s, the phone
  // drops the connection — also lands on `setActs(null)`, and `null` is what the card renders as
  // "Loading…". Measured by aborting /api/owner/oplog: the card on the home screen an owner opens
  // every day sat on "Loading…" with no end and no way to retry. It is the identical fault the
  // 403 branch was fixed for, one branch over.
  const [actsErr, setActsErr] = useState(false);
  const fetchActs = useCallback(async (rid: string) => {
    try {
      const j = await fetch(`/api/owner/oplog?limit=6&rid=${rid}${scopePin ? `&scope=${scopePin}${asSuffix()}` : ""}`, { cache: "no-store" }).then((r) => r.json());
      if (j.disabled) { setActsOff(true); setActs([]); setActsErr(false); return; }
      setActsOff(false);
      // An answer that is not a list is a failure, not an empty log — the same distinction
      // `actsOff` draws for a refusal.
      if (Array.isArray(j.actions)) { setActs(j.actions); setActsErr(false); }
      else { setActs(null); setActsErr(true); }
    } catch { setActs(null); setActsErr(true); }
  }, [scopePin]);

  // The distinct (scope, range) keys the CURRENT view's cards need. That is the MAIN range and
  // nothing else: the only card that ever had its own pinned window (Busy hours, last 7 days)
  // was deleted on 2026-08-05, but "7d" stayed in this list — so every dashboard open, AND every
  // 60-second auto-refresh tick, fetched a whole extra analytics payload that no JSX could read
  // (T5 sweep, 2026-08-06). Exactly the waste the "latest active week" fetch was removed for.
  const neededRanges = useMemo(() => [globalRange], [globalRange]);

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

  useEffect(() => { if (activeRid) { setActs(null); setActsErr(false); fetchActs(activeRid); } }, [activeRid, fetchActs]);

  // Auto-refresh (activity-gated 60s): overview + the payloads in use. Group payloads
  // are compute-on-view cached server-side (mig 196), so this stays cheap.
  const tick = useCallback(() => {
    loadOverview();
    for (const r of neededRanges) fetchPayload(scopeKey, r);
    fetchPayload(scopeKey, "month", { qs: "range=month" });
    fetchMoney(scopeKey, globalRange);
    // …AND THE ACTIVITY FEED (T12 sweep, 2026-08-17). It was left out, so the card headed
    // "Recent activity · who did what" was frozen at whatever the page loaded with while every
    // other card on the screen stayed 60 seconds fresh. Measured over ~88s of an active tab:
    // analytics went 3 → 5 requests, oplog stayed at 1. Manual Refresh already re-fetched it,
    // which is what says the omission was an oversight rather than a decision. Six rows with a
    // column list and a hard limit is the cheapest read on this page.
    if (activeRid) fetchActs(activeRid);
  }, [loadOverview, fetchPayload, fetchMoney, fetchActs, activeRid, neededRanges, scopeKey, globalRange]);
  const tickRef = useRef(tick); tickRef.current = tick;
  useActiveAutoRefresh(() => tickRef.current(), 60000);

  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = () => {
    setRefreshing(true);
    const started = Date.now();
    const jobs: Promise<unknown>[] = [loadOverview()];
    for (const r of neededRanges) jobs.push(fetchPayload(scopeKey, r, { refresh: true }));
    // The month-vs-month card reads its OWN payload and was left out of Refresh entirely, so it
    // kept showing snapshot figures up to five minutes old while every other card recomputed —
    // with no way to force it (T5 sweep, 2026-08-06).
    jobs.push(fetchPayload(scopeKey, "month", { qs: "range=month", refresh: true }));
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
      return { revenue: p.kpis.revenue, orders: p.kpis.orders, paidOrders: p.kpis.paidOrders ?? p.kpis.orders, avg: p.kpis.avgOrder, prev: p.prev, ts: p.timeseries, staffPay: p.staffPay ?? null, foodLoss: p.foodLoss ?? null };
    }
    const revenue = p.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
    const orders = p.restaurantRevenue.reduce((a, r) => a + r.orders, 0);
    const paidOrders = p.paymentMethods.reduce((a, m) => a + (m.orders || 0), 0);
    return { revenue, orders, paidOrders, avg: paidOrders ? revenue / paidOrders : 0, prev: p.prev, ts: p.timeseries, staffPay: p.staffPay ?? null, foodLoss: p.foodLoss ?? null };
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
    // SORT the fallback. `expectedBuckets` is empty for This week / This month / Last month /
    // All time, and Map.values() is INSERTION order — with several restaurants interleaved in
    // the group timeseries that is time order only by luck. The line inside a KPI tile has no
    // axis, so a mis-ordered one looks exactly like a real trend (T5 sweep, 2026-08-06).
    // groupTrend already sorts its keys for this reason.
    const pts = exp.length
      ? exp.map((e) => by.get(e.key) ?? 0)
      : Array.from(by.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
    return pts.length >= 2 ? pts : undefined;
  }, [kpiOf]);

  // Trend rows for the main chart (single scope) — carries __orders for the tooltip.
  const restTrend = useMemo(() => {
    const p = pl(globalRange);
    if (!p || p.scope !== "restaurant") return [];
    const by = new Map<string, { rev: number; ord: number }>();
    for (const t of p.timeseries) by.set(istKey(new Date(t.bucket), globalRange), { rev: t.revenue, ord: t.orders });
    const exp = expectedBuckets(globalRange);
    // sorted for the same reason as sparkOf above — never trust the payload's row order
    if (!exp.length) return [...p.timeseries]
      .sort((a, b) => (String(a.bucket) < String(b.bucket) ? -1 : 1))
      .map((t) => ({ label: tsLabel(t.bucket, globalRange), Revenue: t.revenue, __orders: t.orders }));
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
      color: stacked ? GREEN_SHADES[i % GREEN_SHADES.length] : portfolioColor(r.id),
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
    // No expected sequence (week / month / lastmonth / all) → use the buckets we actually got,
    // but LABEL them like a human date. They used to be labelled with the raw en-CA key, so a
    // multi-restaurant estate on 4 of the 8 periods read "2026-08-04" under every bar while the
    // single-restaurant chart beside it said "4 Aug" (owner-panel sweep 2026-08-04).
    const keys = exp.length ? exp : Array.from(by.keys()).sort().map((k) => ({ key: k, label: keyLabel(k) }));
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
        // This month: COMPLETE days only. Today is still in progress, so plotting its
        // part-day beside a full month of history drew the green line diving to the floor —
        // on the 4th of a month it read as revenue collapsing, not as "the day isn't over"
        // (owner-panel sweep 2026-08-04). Future days were already blank; today joins them,
        // and the caption under the chart says today is excluded.
        cur: d < todayDom ? (curBy.get(d)?.rev ?? 0) : null,
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

  // THE LATEST-ACTIVE-WEEK FALLBACK IS GONE (2026-08-05) — it had become dead weight that still
  // cost a network request.
  //
  // It was added in owner round-5 ("the two datas are not even showing"): when the pinned
  // last-7-days window had no orders it worked out the newest 7 IST days that DID, fetched that
  // custom window, and labelled the cards with those dates. The labels were later dropped from
  // the JSX and nobody removed the machinery, so what was left was: a `useMemo` whose result fed
  // only its own fetch, a fetch whose payload (`latestwk:<from>:<to>`) NO chart ever looked up,
  // and three computed captions (`weekKey`, `weekTagText`, `weekTagTitle`) that were never
  // rendered. eslint had been reporting all three as unused; the live-looking fetch next to them
  // made it read as deliberate. Net effect: every dashboard open during a quiet week paid for an
  // extra custom-range analytics payload that could not appear on screen.
  //
  // The sparse-data story it belonged to is still handled, by the rule that actually renders:
  // `populated()` / `NotEnough` / the auto-drill in the reports route. If a "most recent week with
  // activity" card is wanted again, bring back the fetch AND the card together.

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
      // SORT the fallback, like sparkOf / restTrend / groupTrend / drawerTrend all do. It is
      // correct today only because lfh_owner_revenue_timeseries happens to end `ORDER BY 1`;
      // a line inside a tile has no axis, so a wrong order looks exactly like a real trend
      // (T5 sweep, 2026-08-11).
      for (const [rid, m] of byRest) sparks.set(rid, exp.length
        ? exp.map((e) => m.get(e.key) ?? 0)
        : Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v));
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
    // 4+: the dot and the share bar now use the SAME portfolioColor the charts use, instead of
    // each restaurant's own brand accent. That is the owner's own reasoning applied to a third
    // surface — he asked for distinct colours at this tier precisely because "most restaurants
    // default to the same gold accent, so several bars were the identical washed-out yellow"
    // (2026-07-27), and the table's dots had exactly that problem while sitting right under
    // charts that had been fixed (T5 sweep, 2026-08-06). One restaurant, one colour, everywhere
    // on this page.
    return rows.map((r) => {
      const rk = rank.get(r.id)!;
      return { ...r, rank: rk, accent: restCount <= 3 ? GREEN_SHADES[(rk - 1) % GREEN_SHADES.length] : portfolioColor(r.id) };
    });
  }, [ov, single, pl, globalRange, tq, tSort]);
  const th = (k: typeof tSort.k, label: string, left?: boolean, extra?: string) => (
    <th className={[left ? "l" : "", extra || ""].filter(Boolean).join(" ") || undefined} onClick={() => setTSort((s) => ({ k, asc: s.k === k ? !s.asc : false }))}
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
      // 12-hour, like every report in the Studio ("8 PM"). This was the one place on the
      // dashboard that named a time and it used 24-hour (T5 sweep, 2026-08-06).
      if (busiest?.orders) out.push({ icon: "fa-clock", text: `Busiest at ${hour12(busiest.hour)} — ${busiest.orders} order${busiest.orders === 1 ? "" : "s"}` });
      const total = p.dishes.reduce((a, d) => a + d.revenue, 0);
      if (p.dishes[0] && total > 0) out.push({ icon: "fa-utensils", text: `${p.dishes[0].title} makes ${Math.round((p.dishes[0].revenue / total) * 100)}% of dish revenue` });
      // NO "₹X lost to cancellations" LINE (owner, 2026-08-18). It read as money the restaurant
      // lost, and a cancellation is not that — nothing was charged. It also quoted the money
      // rollup's count, which disagrees with the Audit's by 3x on the same window (measured:
      // 1,124/₹8,28,096 here against 394/₹1,85,766 there, because the two count different sets).
      // The Audit's own risk strip answers this properly, on the screen that owns the record.
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
      // …and the same for the group view, for the same reason.
      if (money && money !== "err" && money.discount > 0 && total > 0) out.push({ icon: "fa-tag", text: `${inr(money.discount)} given as discounts` });
    }
    return out.slice(0, 4);
    // `globalRange` was listed twice here — harmless, but a duplicated dependency is the shape of a
    // half-finished edit and it invites the next reader to guess (T12 sweep, 2026-08-27).
  }, [pl, globalRange, moneyCache, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const dishView = useMemo(() => {
    if (view.level !== "dish") return null;
    const p = pl(globalRange);
    if (!p || p.scope !== "restaurant" || p.restaurant.id !== view.rid) return "loading" as const;
    const total = p.dishes.reduce((a, d) => a + d.revenue, 0) || 1;
    const idx = p.dishes.findIndex((d) => d.title === view.dish);
    const d = p.dishes[idx];
    return d ? { d, rank: idx + 1, share: Math.round((d.revenue / total) * 100), of: p.dishes.length, dishes: p.dishes } : ("missing" as const);
  }, [view, pl, globalRange]);

  // ── the tile popup (owner, 2026-08-18) ───────────────────────────────────────────────────────
  // Which tile is open, or null. Every figure it shows is already in hand, so opening it costs no
  // request. Registered with the back-stack manager like every other overlay on this page.
  const [tileOpen, setTileOpen] = useState<null | "revenue" | "orders" | "today" | "expenses" | "onhand">(null);
  useBackClose("owner-kpi-tile", !!tileOpen, () => setTileOpen(null));
  useEffect(() => {
    if (!tileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTileOpen(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tileOpen]);

  // ── drawer (multi): row click → summary from data ALREADY loaded (zero fetches) ──
  const [drawerRid, setDrawerRid] = useState<string | null>(null);
  useBackClose("owner-rest-drawer", !!drawerRid, () => setDrawerRid(null));
  // Escape closes it too. It already closed on the hardware/browser Back and on the backdrop and
  // the ✕ — but not on Escape, while the reports Studio's overlay has always bound it. On a
  // desktop that meant the one habit that works everywhere else silently did nothing here
  // (found while driving the interactions, T5 sweep 2026-08-06).
  useEffect(() => {
    if (!drawerRid) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerRid(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerRid]);
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
    // No expected sequence (This week / This month / Last month / All time) used to mean NO
    // CHART AT ALL — tapping a restaurant row showed a trend on "30 days" and a blank card on
    // "This month", with nothing to explain it (T5 sweep, 2026-08-06). Fall back to the buckets
    // we actually got, sorted and human-labelled, exactly as groupTrend does.
    const keys = exp.length
      ? exp
      : Array.from(by.keys()).sort().map((k) => ({ key: k, label: keyLabel(k) }));
    return keys.map((e) => ({ label: e.label, Revenue: by.get(e.key)?.rev ?? 0, __orders: by.get(e.key)?.ord ?? 0 }));
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
  // ── THE DEEP LINK CARRIES WHAT HE IS LOOKING AT (owner, 2026-08-18) ──────────────────────────
  // His bug, in his words: "whenever I click on order, it takes me to the order of a particular
  // restaurant. But actually I am in a tab for all the restaurant." Exactly right, and this line was
  // why: it only ever sent `rid`, which on an admin tab is the ADMIN'S PIN — the restaurant the
  // console drilled into — and the reports page then forces its own scope to that pin. So from
  // "All restaurants" on a pinned admin tab, every tile landed on Burger Barn.
  //
  // Two things now travel with the link, and the reports page prefers them over the pin:
  //   • `view=all` or `view=<rid>` — the scope THIS PAGE is showing (`activeRid`), which is null on
  //     the all-restaurants view. A separate name from `rid` on purpose: `rid` is the admin's
  //     authorisation pin and must keep meaning that, or a tab could re-scope its own permissions.
  //   • `range=<the dropdown's value>` — "if I'm at thirty days all restaurant and I open the detail
  //     view of orders then it should be also open in thirty days and all restaurant."
  const detailHref = (t: string) => {
    const q = new URLSearchParams();
    if (scopePin) { q.set("rid", scopePin); const a = asValue(); if (a) q.set("as", a); }
    q.set("view", activeRid ?? "all");
    q.set("range", globalRange);
    q.set("open", t);
    return `/owner/reports?${q.toString()}`;
  };

  const goHome = () => viewTo({ level: "home" });
  const openFull = (rid: string) => { setDrawerRid(null); viewTo({ level: "restaurant", rid }); };

  // Today-so-far numbers (from the overview — no extra call).
  const todayRow = activeRid ? ov?.restaurants.find((r) => r.id === activeRid) : null;
  const todayRev = activeRid ? (todayRow?.revenueToday ?? 0) : (ov?.totals.revenueToday ?? 0);
  const todayOrd = activeRid ? (todayRow?.ordersToday ?? 0) : (ov?.totals.ordersToday ?? 0);

  // The OLDEST of the payloads currently on screen — so the header line can never claim a page
  // is fresher than its stalest card.
  const shownAges = [ages[`${scopeKey}|${globalRange}`], ages[`${scopeKey}|month`], ages[`money:${scopeKey}|${globalRange}`]]
    .filter((x): x is string => !!x);
  const oldestShown = shownAges.length
    ? shownAges.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
    : updatedAt;
  /** "Figures computed 6 Aug 2026, 9:52 pm" — the per-card tooltip. */
  const ageTitle = (key: string) => {
    const at = ages[key];
    if (!at) return undefined;
    return `Figures computed ${new Date(at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: IST })} · ${timeAgo(at)}`;
  };
  const mainAge = () => ageTitle(`${scopeKey}|${globalRange}`);
  /** What a card with no payload yet should say. "Loading…" is a promise, and once the server has
   *  told us this section is switched off for this restaurant the promise is false — every card
   *  said it for ever (T12 sweep, 2026-08-17). Short, because it is repeated per card. */
  const loadNote = offNote ? "Not shown — Reports are switched off." : "Loading…";
  /** Reports really are available for this scope: the admin still grants the section AND the
   *  server has not refused this payload. Used to stop the KPI tiles linking into a Reports hub
   *  that would only refuse him — the hero shortcut has always been gated, the tiles never were. */
  const reportsOn = ov?.entitlements?.reports !== false && !offNote;
  const kMain = kpiOf(globalRange);
  const money = moneyOf(globalRange);
  const trendPayload = pl(globalRange);
  const records = activeRid ? recs[activeRid] : null;
  const recordsUnread = !!(activeRid && recsUnread[activeRid]);

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

  // ── THE TILE ROW (owner, 2026-08-18, after reviewing the sweep) ───────────────────────────────
  // "you can just do, like, money has been generated, orders, if you click on orders it will take
  // you to that pop up … we can keep revenue, orders, today so far, expenses, on hand money" and
  // "everything should be in the one line. That's what I want. Right now it is two rows."
  //
  // So: FIVE tiles, one row. "Avg order" is gone from the row — it lives inside the Orders popup,
  // which is where he asked for it. "Lost to cancellations", "Staff pay out" and "After staff pay"
  // are gone as tiles; what they held is now Expenses + On hand, with the detail in the popups.
  //
  // ── THE MONEY MODEL, CHECKED RATHER THAN ASSUMED ─────────────────────────────────────────────
  // He said cancellations should sit under Expenses. They must not be added to it, and this is why:
  // migration 315 made `revenue` the NET figure — the discount is already taken off it — and every
  // rollup counts only orders that are not cancelled. So a discount and a cancellation are ALREADY
  // out of revenue. Adding them to Expenses and then subtracting Expenses from revenue would count
  // the same loss twice, and "on hand" would read lakhs too low.
  //   Expenses = what actually LEFT the business (the staff pay ledger).
  //   On hand   = revenue − Expenses, so the three tiles reconcile on screen.
  //   Discounts and cancellations live in the REVENUE popup under "what you didn't charge", which
  //   is the honest home for them: they are the answer to "why isn't revenue higher?".
  const staffOut = kMain?.staffPay?.paidOut ?? 0;
  const hasPayroll = !!kMain?.staffPay;
  // FOOD COOKED AND THEN BINNED (owner, 2026-08-18: "the cancelinging amout go up expensis goes up").
  // Priced at what the ingredients really cost, not at what the bill would have been — the bill value
  // is revenue he never earned and was never in the revenue figure to begin with (mig 315).
  const foodLost = kMain?.foodLoss?.amount ?? 0;
  const foodLostRows = kMain?.foodLoss?.entries ?? 0;
  const expensesOut = staffOut + foodLost;
  const onHand = (kMain?.revenue ?? 0) - expensesOut;
  const mt = money === "err" ? undefined : (money as MoneyTotals | undefined);
  // ── WHEN REPORTS ARE SWITCHED OFF ────────────────────────────────────────────────────────────
  // `offNote` means no analytics payload is ever coming, so every tile prints an em dash and says
  // why instead of animating a blank for ever, and none of them opens a popup or a report.
  const offSub = "Reports are switched off";
  const kpiRow = (
    <div className="adm-stats ow2-stats ow2-stats5">
      <Kpi k="Revenue" onOpen={offNote ? undefined : () => setTileOpen("revenue")} v={offNote ? "—" : (kMain?.revenue ?? 0)} money compact loading={!offNote && !kMain}
        delta={kMain?.prev ? { now: kMain.revenue, prev: kMain.prev.revenue } : undefined}
        prevTitle={PREV_LABEL[globalRange]} sub={offNote ? offSub : PREV_LABEL[globalRange] || "whole history"} spark={sparkOf(globalRange, "revenue")} />
      <Kpi k="Orders" onOpen={offNote ? undefined : () => setTileOpen("orders")} v={offNote ? "—" : (kMain?.orders ?? 0)} loading={!offNote && !kMain}
        sub={offNote ? offSub : kMain ? `${inr(kMain.avg)} per paid order` : PREV_LABEL[globalRange] || "whole history"}
        delta={kMain?.prev ? { now: kMain.orders, prev: kMain.prev.orders } : undefined}
        prevTitle={PREV_LABEL[globalRange]} spark={sparkOf(globalRange, "orders")} />
      {/* ── AND THAT INCLUDES TODAY (T12 sweep, 2026-08-27) ───────────────────────────────────
          This tile reads the OVERVIEW payload, not analytics, so `offNote` did not reach it and it
          stayed a live figure while its four neighbours printed an em dash. But /api/owner/overview
          ZEROES revenueToday and ordersToday for a restaurant whose Reports the admin has taken
          away (its own route says so, and the estate table renders that same zero as "figures
          hidden"). So the one tile still printing a number printed a FALSE one: measured by
          replaying both of the server's own answers, the row read
          "— · — · ₹0, 0 orders today · — · —". A confident zero beside four honest dashes reads as
          "you took nothing today", which is the opposite of what is true. It says what the others
          say, and the "live" pill goes with it — there is nothing live to point at. */}
      <Kpi k="Today so far" onOpen={offNote ? undefined : () => setTileOpen("today")} v={offNote ? "—" : todayRev} money compact
        loading={!offNote && !ov} pill={offNote ? undefined : "● live"}
        sub={offNote ? offSub : `${todayOrd} order${todayOrd === 1 ? "" : "s"} today`} />
      <Kpi k="Expenses" onOpen={offNote ? undefined : () => setTileOpen("expenses")} v={offNote ? "—" : expensesOut} money compact loading={!offNote && !kMain}
        sub={offNote ? offSub
          : foodLost > 0 && staffOut > 0 ? "staff pay + food lost"
          : foodLost > 0 ? `${foodLostRows} cancellation${foodLostRows === 1 ? "" : "s"} where food was made`
          // A FAILED FOOD-LOSS READ IS NOT A ZERO (T12 sweep, 2026-08-27). The route returns null
          // when it could not read the expenses rows, and says in its own comment that a silent 0
          // "would tell him he wasted nothing, which is the wrong way for this to fail". The popup
          // said so; the tile face fell through to the staff-pay wording and said nothing at all,
          // so a total that is too low looked complete.
          : kMain && kMain.foodLoss == null ? "staff pay only — we couldn\u2019t read the food figure"
          : hasPayroll ? `${kMain!.staffPay!.entries} staff payment${kMain!.staffPay!.entries === 1 ? "" : "s"}` : "nothing recorded yet"} />
      <Kpi k="On hand" onOpen={offNote ? undefined : () => setTileOpen("onhand")} v={offNote ? "—" : onHand} money compact loading={!offNote && !kMain}
        sub={offNote ? offSub : "revenue minus expenses"} />
    </div>
  );

  // ── THE TILE POPUP (owner, 2026-08-18) ───────────────────────────────────────────────────────
  // "there should be a pop up which should open, and in that average order and information about
  // the order should be written, and at the below there will be a click for a seen proper detail,
  // and that will take me to that particular page." The tile shows a SHORT figure so five fit one
  // line; the popup carries the exact rupees and the breakdown, which is also what solves the
  // spacing he complained about.
  //
  // "it should also take me in the dashboard of whatever I am at … if I am at all restaurant, it
  // should take me to the all restaurant orders thing … and thirty days" — so both the popup's
  // heading AND its bottom link carry the scope he is looking at and the range he has chosen. See
  // `detailHref` for how that travels.
  // A row is [label, value, hint?, isTotal?]. `isTotal` is EXPLICIT rather than "the last row",
  // because on the Revenue popup the last row is "Cancelled bills" — which is emphatically not a
  // total, and styling it as one made a figure that is deliberately excluded look like the answer.
  const tileDetail = (): { title: string; sub: string; rows: [string, string, (string | undefined)?, boolean?][]; note?: string; audit?: boolean; open: string } | null => {
    const per = RANGE_LABEL[globalRange];
    switch (tileOpen) {
      case "revenue": return {
        title: "Revenue", sub: `what guests actually paid · ${per}`,
        rows: [
          ["Revenue", inr(kMain?.revenue ?? 0), "after discounts, cancelled bills never counted"],
          ["Paid orders", (kMain?.paidOrders ?? 0).toLocaleString("en-IN"), "bills that have been settled"],
          ["Average per paid order", inr(kMain?.avg ?? 0)],
          ...(kMain?.prev ? [["The period before", inr(kMain.prev.revenue), PREV_LABEL[globalRange]] as [string, string, string]] : []),
          // A DISCOUNT IS MONEY; A CANCELLATION IS NOT (owner, 2026-08-18) ─────────────────────
          // He said it plainly: a cancelled order "will [be] in [the] audit, so there would not even
          // be [a] cancellation, only if you see" — i.e. it is a record you go and look at, not a
          // figure to put on this screen. The database agrees and always has:
          // `lfh_audit_risk()` calls `discount_given` MONEY and lets `order_cancelled` fall through
          // to RECORD, and the Audit screen prints record rows as "of food, never charged".
          //
          // So the discount stays as a money line — it really is money the restaurant gave away, and
          // it is already off the revenue above. The cancellation quotes NO figure at all, and here
          // is the measured reason why that matters: on the same restaurant and the same 30 days, the
          // money rollup behind this screen said 1,124 cancelled worth ₹8,28,096, while the Audit
          // said 394 worth ₹1,85,766 — because the rollup counts every order row marked cancelled
          // and the Audit holds only the ones recorded with a reason. Both are true about different
          // sets, so any number printed here would contradict the record one click away. The screen
          // says what a cancellation means for revenue, and sends him to the record for the rest.
          ...(mt && mt.discount > 0 ? [["Discounts given", inr(mt.discount), "money you gave away — already taken off the revenue above"] as [string, string, string]] : []),
        ],
        note: "A cancelled bill is not money you lost — nothing was ever charged for it, so it was never in the revenue above. Cancellations are kept as a record, with the reason and the person, in Audit & logs.",
        audit: true,
        open: "sales",
      };
      case "orders": return {
        title: "Orders", sub: `every order in the period · ${per}`,
        rows: [
          ["Orders", (kMain?.orders ?? 0).toLocaleString("en-IN")],
          ["Paid", (kMain?.paidOrders ?? 0).toLocaleString("en-IN"), "settled bills"],
          ["Still open", Math.max(0, (kMain?.orders ?? 0) - (kMain?.paidOrders ?? 0)).toLocaleString("en-IN"), "on a table right now, or unpaid"],
          ["Average per paid order", inr(kMain?.avg ?? 0), "revenue ÷ paid orders"],
          ...(kMain?.prev ? [["The period before", kMain.prev.orders.toLocaleString("en-IN"), PREV_LABEL[globalRange]] as [string, string, string]] : []),
        ],
        open: "volume",
      };
      case "today": return {
        title: "Today so far", sub: "live, since the business day started at 5am",
        rows: [
          ["Taken today", inr(todayRev)],
          ["Orders today", todayOrd.toLocaleString("en-IN")],
          ["Average per order", inr(todayOrd ? todayRev / todayOrd : 0)],
          ["Tables open now", String(activeRid ? (todayRow?.openTables ?? 0) : (ov?.totals.openTables ?? 0))],
        ],
        note: "This one does not follow the period above — it is always today.",
        open: "daysummary",
      };
      case "expenses": return {
        title: "Expenses", sub: `what the period cost you · ${per}`,
        rows: [
          ["Staff pay out", inr(staffOut), hasPayroll ? `${kMain!.staffPay!.entries} payment${kMain!.staffPay!.entries === 1 ? "" : "s"} to ${kMain!.staffPay!.people} ${kMain!.staffPay!.people === 1 ? "person" : "people"}` : "nothing recorded in this period"],
          ["Food made then binned", inr(foodLost), kMain?.foodLoss == null
            ? "couldn't read this — the figure above may be short"
            : foodLostRows
              ? `${foodLostRows} cancellation${foodLostRows === 1 ? "" : "s"} where the kitchen had already cooked it — at what the ingredients cost`
              : "none — every cancellation was caught before the kitchen started"],
          ["Total expenses", inr(expensesOut), undefined, true],
        ],
        note: "This is what the period COST you, not what left your bank. Food is counted when it is used, not when it was bought. A discount is not here — your revenue already has it taken off. And a cancelled bill's value is not here either: nothing was charged for it, so it was never money you had. Cancellations live in Audit & logs, with the reason and the person.",
        audit: true,
        open: "team",
      };
      case "onhand": {
        // ── AND THIS POPUP HAS TO ADMIT IT AS WELL (T12 sweep, 2026-08-27) ──────────────────────
        // `foodLoss === null` means the server could not READ that figure, not that it was zero.
        // The Expenses popup one tap away has always said so on its own row; this one printed a
        // flat "− ₹0" and then called the result "Money on hand" as if it were settled — the one
        // line on the page where an unread cost makes the ANSWER too big. Measured by replaying
        // the server's own answer: "Less food made then binned − ₹0 · Money on hand ₹13,41,642".
        const foodUnread = !!kMain && kMain.foodLoss == null;
        return {
        title: "On hand", sub: `what is left of the period · ${per}`,
        rows: [
          ["Revenue", inr(kMain?.revenue ?? 0)],
          ["Less staff pay", "− " + inr(staffOut)],
          ["Less food made then binned", "− " + inr(foodLost),
            foodUnread ? "we couldn\u2019t read this — any food you lost is missing from the sum below" : undefined],
          ["Money on hand", inr(onHand), foodUnread ? "this may be too high, for the reason above" : undefined, true],
        ],
        note: "Takings minus what the period cost you. It is not a bank balance — rent, bills and any stock you have not recorded here are not in it, and food is counted when it is used rather than when it was bought.",
        open: "team",
      }; }
      default: return null;
    }
  };

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
            {oldestShown && !refreshing && (
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}
                title={`The oldest figures on this page were computed ${new Date(oldestShown).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: IST })}. Each card carries its own time — hover its period chip.`}>
                {!landed && "your last view · "}updated {timeAgo(oldestShown)}
              </span>
            )}
          </div>
        </div>
      </div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 16 }}><b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span></div>}
      {/* The switched-off note: a plain, unalarming card in the muted colour, NOT the red one.
          Nothing here is broken — Aevidine has simply not given this restaurant the Reports
          section, and the owner's next move is to ask us, which the sentence says. */}
      {offNote && !err && (
        <div className="adm-card" style={{ marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <i className="fas fa-eye-slash" style={{ color: "var(--muted)", marginTop: 2 }} aria-hidden="true" />
          <span><b>Figures aren&rsquo;t shown here.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{offNote}</span></span>
        </div>
      )}


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
                <span className="ow2-tag" title={[rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{RANGES.find((r) => r.k === globalRange)!.label}</span>
              </div>
              {!trendPayload ? <div className="adm-empty">{loadNote}</div>
                : <StackedDailyBars data={groupTrend.rows} lines={groupTrend.lines} />}
            </div>
          ) : (
            <div className="ow2-two" style={{ marginBottom: 12 }}>
              <div className="adm-card">
                <div className="ow2-ct"><span>Who earns more <span className="mut">· tap a bar to open</span></span>
                  <span className="ow2-tag" title={[rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
                {!trendPayload || trendPayload.scope !== "group" ? <div className="adm-empty">{loadNote}</div>
                  : <WhoEarnsMore data={trendPayload.restaurantRevenue.map((r) => ({ id: r.id, name: r.name, revenue: r.revenue, orders: r.orders, accentColor: portfolioColor(r.id) }))}
                      onSelect={(id) => setDrawerRid(id)} />}
              </div>
              <div className="adm-card">
                <div className="ow2-ct"><span>Revenue over time <span className="mut">· {globalRange === "today" || globalRange === "yesterday" ? "by hour" : "by day"}</span></span></div>
                {!trendPayload ? <div className="adm-empty">{loadNote}</div>
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
                  {th("today", "Today", false, "hide-s")}
                  {th("revenue", `Revenue (${RANGE_LABEL[globalRange]})`)}
                  {th("orders", "Orders")}
                  {/* "Avg / order", NOT "Avg check": this column divides by ALL non-cancelled
                      orders (open ones included) while the KPI card above says "per paid order",
                      so the two could never be reconciled. Same honesty fix the Busy-times report
                      made for its own "Per order" column (T5 sweep, 2026-08-06). */}
                  {th("avg", "Avg / order", false, "hide-s")}
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
                      <td className="l"><span className="hq-nm" title={r.name}><span className="sw" style={{ background: r.accent }} aria-hidden="true" />{r.name}</span></td>
                      {/* Reports switched off ⇒ every money cell says so rather than printing
                          the deliberate zero as if it were this restaurant's real takings. */}
                      {/* FOUR CELLS EITHER WAY, matching the header one-for-one. This used to be a
                          single colSpan={4} cell — and at =<760px the stylesheet hides the 3rd and
                          6th columns by position, so on a phone the colSpan cell WAS the 3rd child:
                          the whole "figures hidden" explanation vanished and every remaining cell
                          slid under the wrong heading (T5 sweep, 2026-08-06). Same shape, same
                          hide-s classes, message in the always-visible Revenue column. */}
                      {r.reportsOff ? (
                        <>
                          <td className="mut hide-s">—</td>
                          <td className="mut" title="Reports are switched off for this restaurant, so its figures aren't shown here.">
                            <span style={{ opacity: .7 }}><i className="fas fa-eye-slash" style={{ marginRight: 6, fontSize: 10 }} aria-hidden="true" />figures hidden</span>
                          </td>
                          <td className="mut">—</td>
                          <td className="mut hide-s">—</td>
                        </>
                      ) : (
                        <>
                          <td className="mut hide-s"><AnimatedNumber value={r.today} money /></td>
                          <td><b><AnimatedNumber value={r.revenue} money /></b></td>
                          <td className="mut"><AnimatedNumber value={r.orders} /></td>
                          <td className="mut hide-s"><AnimatedNumber value={r.avg} money /></td>
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
              <div className="ow2-ct"><span>Revenue · this month vs last <span className="mut">· {thisMonthName} vs {lastMonthName} · {restScopeText}</span></span><span className="ow2-tag" title={[`All of ${thisMonthName} so far`, ageTitle(`${scopeKey}|month`)].filter(Boolean).join(" · ")}>{thisMonthName}</span></div>
              {!pl("month") ? <div className="adm-empty">{loadNote}</div>
                : <><RevMonthCompare data={monthCompare.rows} curName={monthCurName} prevName={monthPrevName} curColor={GREEN} prevColor={GRAY_LINE} />
                  {/* Say why the green line stops short — a part-day plotted against full days
                      looked like a crash (owner-panel sweep 2026-08-04). */}
                  <div className="ow2-note">Today is still in progress, so it joins the line tomorrow.</div></>}
            </div>
            {/* flex column, so the donut card can TAKE the height the taller card beside it
                sets (owner, 2026-08-19). CategoryDonut then fills it — see Charts.tsx. */}
            <div className="adm-card ow2-fill">
              {/* "added up across restaurants" — the group donut merges a category NAME across
                  every restaurant, which is the right thing for a portfolio view but is NOT what
                  the Items & menu report does (it keeps each brand's rows apart, because the same
                  title in two brands is a different product). Saying so is what was missing
                  (T5 sweep, 2026-08-06). */}
              <div className="ow2-ct"><span>Revenue by category <span className="mut">· added up across {restScopeText}</span></span><span className="ow2-tag" title={[rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              <PartialStrip keys={(pl(globalRange) as GroupA | undefined)?.partial?.filter((k) => k === "categories")} />
              {(pl(globalRange) as GroupA | undefined)?.categories
                ? <CategoryDonut data={(pl(globalRange) as GroupA).categories!} />
                : <div className="adm-empty">{loadNote}</div>}
            </div>
          </div>

          {/* Heatmap + payments, side by side (group scope) */}
          <div className="ow2-two">
            <div className="adm-card">
              <div className="ow2-ct"><span>Busy heatmap <span className="mut">· by day × hour · {restScopeText}{HEAT_CLAMPED[globalRange] ? ` · last ${HEAT_CLAMP_DAYS} days only` : ""}</span></span><span className="ow2-tag" title={[HEAT_CLAMPED[globalRange] ? `A busy pattern is about recent weeks, so this grid always covers the last ${HEAT_CLAMP_DAYS} days, whatever the period above says` : rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{HEAT_CLAMPED[globalRange] ? `Last ${HEAT_CLAMP_DAYS} days` : RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              <PartialStrip keys={(pl(globalRange) as GroupA | undefined)?.partial?.filter((k) => k === "busyHours")} />
              {(pl(globalRange) as GroupA | undefined)?.heatmap
                ? <Heatmap data={(pl(globalRange) as GroupA).heatmap!} accent={GREEN} rangeLabel={HEAT_CLAMPED[globalRange] ? `Last ${HEAT_CLAMP_DAYS} days` : RANGES.find((r) => r.k === globalRange)!.label} />
                : <div className="adm-empty">{loadNote}</div>}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Payment methods <span className="mut">· how customers paid · {restScopeText}</span></span><span className="ow2-tag" title={[rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              <PartialStrip keys={(pl(globalRange) as GroupA | undefined)?.partial?.filter((k) => k === "payments")} />
              {(pl(globalRange) as GroupA | undefined)?.paymentMethods
                ? <PaymentDonut data={(pl(globalRange) as GroupA).paymentMethods} />
                : <div className="adm-empty">{loadNote}</div>}
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
            {/* "Team", not "Staff & powers". The page this opens is headed "Team & pay" and its
                only tab is "Team"; the SIDEBAR was corrected on 2026-08-05 for exactly that reason
                and this shortcut was missed, so the two sat 90px apart in one frame naming the same
                screen two different things (T12 sweep, 2026-08-17, seen on both sizes). */}
            {ov.entitlements?.staff !== false && <Link href={withPin("/owner/staff")} className="own-hero-link"><i className="fas fa-users-gear" aria-hidden="true" /> Team</Link>}
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
              <span className="ow2-tag" title={[rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{RANGES.find((r) => r.k === globalRange)!.label}</span>
            </div>
            {!trendPayload || trendPayload.scope !== "restaurant" ? <div className="adm-empty">{loadNote}</div>
              : restTrend.length >= 9
                ? <AreaTrend data={restTrend} lines={[{ key: "Revenue", name: "Revenue", color: GREEN }]} />
                : <TimeBar data={restTrend.map((r) => ({ label: String(r.label), revenue: Number(r.Revenue) || 0, __orders: Number(r.__orders) || 0 })) as { label: string; revenue: number }[]} color={GREEN} />}
          </div>

          <div className="ow2-two">
            <div className="adm-card">
              <div className="ow2-ct"><span>Revenue · this month vs last <span className="mut">· {thisMonthName} vs {lastMonthName}</span></span><span className="ow2-tag" title={[`All of ${thisMonthName} so far`, ageTitle(`${scopeKey}|month`)].filter(Boolean).join(" · ")}>{thisMonthName}</span></div>
              {!pl("month") ? <div className="adm-empty">{loadNote}</div>
                : <><RevMonthCompare data={monthCompare.rows} curName={monthCurName} prevName={monthPrevName} curColor={GREEN} prevColor={GRAY_LINE} />
                  {/* Say why the green line stops short — a part-day plotted against full days
                      looked like a crash (owner-panel sweep 2026-08-04). */}
                  <div className="ow2-note">Today is still in progress, so it joins the line tomorrow.</div></>}
            </div>
            {/* flex column, so the donut card can TAKE the height the taller card beside it
                sets (owner, 2026-08-19). CategoryDonut then fills it — see Charts.tsx. */}
            <div className="adm-card ow2-fill">
              <div className="ow2-ct"><span>Revenue by category</span><span className="ow2-tag" title={[rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as RestA | undefined)?.categories
                ? <CategoryDonut data={(pl(globalRange) as RestA).categories} />
                : <div className="adm-empty">{loadNote}</div>}
            </div>
          </div>

          <div className="ow2-two" style={{ marginTop: 12 }}>
            <div className="adm-card">
              <div className="ow2-ct"><span>Busy heatmap <span className="mut">· by day × hour{HEAT_CLAMPED[globalRange] ? ` · last ${HEAT_CLAMP_DAYS} days only` : ""}</span></span><span className="ow2-tag" title={[HEAT_CLAMPED[globalRange] ? `A busy pattern is about recent weeks, so this grid always covers the last ${HEAT_CLAMP_DAYS} days, whatever the period above says` : rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{HEAT_CLAMPED[globalRange] ? `Last ${HEAT_CLAMP_DAYS} days` : RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              <PartialStrip keys={(pl(globalRange) as RestA | undefined)?.partial?.filter((k) => k === "busyHours")} />
              {(pl(globalRange) as RestA | undefined)?.heatmap
                ? <Heatmap data={(pl(globalRange) as RestA).heatmap!} accent={GREEN} rangeLabel={HEAT_CLAMPED[globalRange] ? `Last ${HEAT_CLAMP_DAYS} days` : RANGES.find((r) => r.k === globalRange)!.label} />
                : <div className="adm-empty">{loadNote}</div>}
            </div>
            <div className="adm-card">
              <div className="ow2-ct"><span>Payment methods <span className="mut">· how customers paid</span></span><span className="ow2-tag" title={[rangeSpanText(globalRange), mainAge()].filter(Boolean).join(" · ")}>{RANGES.find((r) => r.k === globalRange)!.label}</span></div>
              {(pl(globalRange) as RestA | undefined)?.paymentMethods && ((pl(globalRange) as RestA).paymentMethods.reduce((a, m) => a + m.revenue, 0) > 0)
                ? <PaymentDonut data={(pl(globalRange) as RestA).paymentMethods} />
                : (pl(globalRange) ? <div className="adm-empty">No recorded payments in this range.</div> : <div className="adm-empty">{loadNote}</div>)}
            </div>
          </div>

          {/* Records strip — the numbers worth bragging about */}
          {(recordsUnread || (records && (records.bestDay || records.starDish))) && (
            <div className="adm-card" style={{ marginTop: 12 }}>
              <div className="ow2-ct"><span>Your records <span className="mut">· the numbers worth bragging about</span></span></div>
              {/* A CARD THAT VANISHES SAYS SO — the client half of the route's improvement I5. */}
              <PartialStrip keys={recordsUnread ? ["records"] : undefined}
                msg="We couldn&rsquo;t read your all-time records just now, so this card is short. Tap Refresh to try again." />
              {records && <div className="rv-recs">
                {records.bestDay && (
                  <div className="rv-rec"><span className="e">🏆</span><span><small>BEST DAY EVER</small><b><AnimatedNumber value={records.bestDay.revenue} money /></b>
                    <i>{new Date(records.bestDay.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST })} — beat it!</i></span></div>
                )}
                {/* "LAST 30 DAYS (ROLLING)", not "30 DAYS". lfh_owner_records keeps its OWN
                    rolling window, while the dish list below is the SELECTED range (30 whole IST
                    days ending today) — so the two printed different plate counts for the same
                    dish, 400px apart, both captioned "30 days" (measured live: 549 vs 529,
                    T5 sweep 2026-08-06). Naming the window is the honest fix; the records strip
                    is deliberately all-time-ish and must not follow the dropdown. */}
                {records.starDish && (
                  <div className="rv-rec"><span className="e">👑</span><span><small>STAR DISH · LAST 30 DAYS (ROLLING)</small><b>{records.starDish.title}</b>
                    <i>{records.starDish.qty} plates</i></span></div>
                )}
                {records.fastHour && (
                  <div className="rv-rec"><span className="e">⚡</span><span><small>BUSIEST HOUR EVER</small><b><AnimatedNumber value={records.fastHour.orders} /> orders</b>
                    <i>{istWall12(records.fastHour.at, { day: "numeric", month: "short", hour: "numeric", hour12: true })}</i></span></div>
                )}
                {records.bigBill && (
                  <div className="rv-rec"><span className="e">💎</span><span><small>BIGGEST BILL</small><b><AnimatedNumber value={records.bigBill.revenue} money /></b>
                    <i>{records.bigBill.table ? `table ${records.bigBill.table}` : "one sitting"}</i></span></div>
                )}
                {(records.regulars ?? 0) > 0 && (
                  <div className="rv-rec"><span className="e">🔁</span><span><small>REGULARS · LAST 30 DAYS (ROLLING)</small><b><AnimatedNumber value={records.regulars ?? 0} /> returning guests</b>
                    <i>same name, 2+ visits</i></span></div>
                )}
              </div>}
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
              <DishList payload={pl(globalRange) as RestA | undefined} sort={dishSort} note={loadNote}
                onDish={(t) => viewTo({ level: "dish", rid: activeRid, dish: t })} />
            </div>
            {/* Recent activity — the owner's mini log (surprise add).
                ABSENT, not spinning, when the admin has taken Audit & logs away: `actsOff` is set
                from the server's own 403 and `logs` is the entitlement the overview really sends.
                Either one leaves the card out entirely (module checklist point 6) and the dish
                list beside it simply takes the row. */}
            {ov?.entitlements?.logs !== false && !actsOff && (
            <div className="adm-card">
              <div className="ow2-ct">
                <span>Recent activity <span className="mut">· who did what</span></span>
                {/* The card's own gate above already requires `logs`, so this link no longer
                    carries a second copy of it. It used to gate on `entitlements.activity` — a key
                    that has never existed: the section is called "logs" in lib/ownerEntitlements
                    OWNER_SECTION_KEYS, that is what the sidebar gates on and what
                    /api/owner/oplog refuses on. Measured live, the overview sends 33 keys and
                    `activity` is not one of them, so the gate read `undefined !== false` and was
                    ALWAYS true — an owner whose Audit & logs the admin had switched off was still
                    offered a link into a page that refuses him (T12 sweep, 2026-08-17). */}
                <Link href={withPin("/owner/activity")} className="ow2-seeall">See all <i className="fas fa-arrow-right" aria-hidden="true" /></Link>
              </div>
              {!acts ? (actsErr
                  ? <div className="adm-empty">Couldn&rsquo;t load this just now — it tries again by itself every minute.{" "}
                      <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => activeRid && fetchActs(activeRid)}>Try again</button></div>
                  : <div className="adm-empty">Loading…</div>)
                : acts.length === 0 ? <div className="adm-empty">Nothing yet — your team&rsquo;s work shows up here as it happens.</div>
                : (
                  <div className="ow2-acts">
                    {acts.map((a) => (
                      // P2 (T15, 2026-08-14): this card printed the RAW database values — `order_place`,
                      // `bill_paid`, `invoice_void`, and a chip reading `editor` or `db` — on the one owner
                      // screen that gets opened every day, while /owner/activity one click away printed
                      // "Placed order", "Marked paid", "Manager panel". Both translators were already
                      // exported from the file this page imports `inr` from. `npm run verify:audit` passed
                      // throughout because it checks that every action code HAS a label, not that a screen
                      // USES one — so never render `a.action` or `a.panel` bare.
                      <div key={a.id} className="ow2-act">
                        <span className={`pn pn-${a.panel}`}>{panelLabel(a.panel)}</span>
                        <span className="tx">{actLabel(a.action)}{a.table_number ? ` · table ${a.table_number}` : ""}</span>
                        {/* NEVER A DATABASE ID WHERE A PERSON'S NAME GOES (T12 sweep, 2026-08-27).
                            Two owner-panel writers log the owner's uuid as the actor, and this cell
                            printed it verbatim — measured on the home screen:
                            "Handled a rating · c0af7b5b-…-f475e48bab53". lib/ownerActor.ts carries
                            the whole story and the two routes that need the real fix. */}
                        <span className="who" title={actorTitle(a.actor)}>{actorLabel(a.actor)}</span>
                        <span className="when">{timeAgo(a.created_at)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
            )}
          </div>

          {highlights}
        </>
      )}

      {/* ═══════ DISH ═══════ */}
      {view.level === "dish" && (
        <div className="adm-card own-dish">
          {dishView === "loading" || dishView === null ? <div className="adm-empty">{offNote ? loadNote : "Loading dish…"}</div>
          : dishView === "missing" ? (
            <div className="adm-empty">
              No sales for <b>{view.dish}</b> in {RANGE_LABEL[globalRange]}.{" "}
              <button className="adm-btn" style={{ marginLeft: 6 }} onClick={() => viewTo({ level: "restaurant", rid: view.rid })}>
                <i className="fas fa-arrow-left" style={{ marginRight: 6 }} aria-hidden="true" /> Back to restaurant
              </button>
            </div>
          ) : (<>
            {/* ── A WAY BACK YOU CAN SEE (owner, 2026-08-18: "for the problem eight, have you add
                the cross button or do stuff like that?") ────────────────────────────────────────
                The phone's BACK and the sidebar's Dashboard link both work now, but neither is
                visible, and at 360px the top-strip breadcrumb is display:none — so on his phone
                nothing on the screen said "go back". A ✕ in the corner of the dish header, sized
                past the 44px guideline so a thumb catches it, and it goes UP ONE LEVEL: back to the
                restaurant on a multi-restaurant estate, back to the dashboard for one restaurant. */}
            <div className="own-dish-h" style={{ ["--rcol" as string]: GREEN }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="own-dish-name">{dishView.d.title}</div>
                <div className="adm-muted">{RANGE_LABEL[globalRange]}</div>
              </div>
              <button type="button" className="own-dish-x"
                onClick={() => setView(single ? { level: "home" } : { level: "restaurant", rid: (view as { rid: string }).rid })}
                aria-label={single ? "Back to the dashboard" : "Back to the restaurant"}
                title={single ? "Back to the dashboard" : "Back to the restaurant"}>✕</button>
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

      {/* ═══════ TILE POPUP — the detail behind a KPI tile (owner, 2026-08-18) ═══════ */}
      {(() => {
        const d = tileDetail();
        if (!d) return null;
        // WHOSE numbers these are, said on the popup itself: "it should also show for all restaurant
        // or of a particular restaurant". The heading answers it before he reads a figure.
        const who = activeRid
          ? (ov?.restaurants.find((r) => r.id === activeRid)?.name ?? "this restaurant")
          : `all ${restCount} restaurant${restCount === 1 ? "" : "s"}`;
        return (
          <div className="ow2-tile-wrap" role="dialog" aria-label={`${d.title} detail`} aria-modal="true">
            <div className="ow2-tile-back" onClick={() => setTileOpen(null)} aria-hidden="true" />
            <div className="ow2-tile">
              <header>
                <span className="ti"><b>{d.title}</b><i>{d.sub}</i></span>
                <button className="x" onClick={() => setTileOpen(null)} aria-label="Close">✕</button>
              </header>
              <div className="who"><i className="fas fa-store" aria-hidden="true" /> {who}</div>
              <div className="rows">
                {d.rows.map(([label, value, hint, isTotal]) => (
                  <div className={`r${isTotal ? " last" : ""}`} key={label}>
                    <span className="l">{label}{hint ? <i>{hint}</i> : null}</span>
                    <span className="v">{value}</span>
                  </div>
                ))}
              </div>
              {d.note ? (
                <p className="note">
                  <i className="fas fa-circle-info" aria-hidden="true" />
                  <span>
                    {d.note}
                    {/* Straight to the record, so "cancellations live in Audit & logs" is a door and
                        not just a sentence. Gated on the SAME `logs` entitlement the sidebar and
                        /api/owner/oplog use — if the admin has taken the log away there is nothing
                        to send him to, and the sentence stands on its own. */}
                    {d.audit && ov?.entitlements?.logs !== false ? (
                      <>{" "}<Link className="nlink" href={withPin("/owner/activity")}>Open Audit &amp; logs <i className="fas fa-arrow-right" aria-hidden="true" /></Link></>
                    ) : null}
                  </span>
                </p>
              ) : null}
              <footer>
                {/* "at the below there will be a click for a seen proper detail, and that will take
                    me to that particular page" — and it carries the scope and the range (detailHref). */}
                {reportsOn ? (
                  /* NO onClick THAT CLOSES THIS FIRST. Measured: closing the popup on the same tap
                     sent us straight back to the dashboard instead of to the report. The popup owns
                     a back-stack layer, and closing it makes backStack rewind that entry with
                     history.go(-1) — which wins the race against the router and undoes the
                     navigation. It is the identical trap components/owner/OwnerShell.tsx documents
                     for its nav links ("pages that NAVIGATE leave it open and let the route change
                     close it"), and the same cure: navigate, and let the unmount tidy up, where
                     backStack's own "a real navigation pushed on top of our buffer" guard sees the
                     new URL and leaves the buffer alone. */
                  <Link className="full" href={detailHref(d.open)}>
                    See the full detail <i className="fas fa-arrow-right" aria-hidden="true" />
                  </Link>
                ) : <span className="full off">Reports are switched off for this restaurant</span>}
              </footer>
            </div>
          </div>
        );
      })()}

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
                <div><small>Avg / order</small><b><AnimatedNumber value={drawer.row?.avg ?? 0} money /></b><i>all orders, paid or open</i></div>
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
        :global(.ow2-stats) { display: grid; grid-template-columns: repeat(var(--ow2-cols, 5), 1fr); gap: 12px; }
        /* ONE LINE, FIVE TILES (owner, 2026-08-18: "everything should be in the one line. That is
           what I want. Right now it is top bottom two rows"). minmax(0,1fr) not 1fr, for the same
           reason the chart pair below uses it: a bare 1fr floors at the item's min-content width, so
           one long figure could push its own track wider than the row. The short money form on the
           tile face (compactINR) is the other half of making five fit. */
        :global(.ow2-stats5) { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        :global(.ow2-stats5) > * { min-width: 0; }
        .ow2-ct { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 800; margin-bottom: 10px; flex-wrap: wrap; }
        .ow2-ct .mut { color: var(--muted); font-weight: 500; }
        /* A quiet caption under a chart, for saying what it deliberately leaves out. */
        .ow2-note { font-size: 10.5px; color: var(--muted); margin-top: 6px; text-align: right; }
        .ow2-tag { font-size: 10.5px; font-weight: 700; color: var(--muted); background: var(--bg); border: var(--border); border-radius: 8px; padding: 3px 9px; white-space: nowrap; }
        /* minmax(0,1fr), NOT a bare 1fr. A bare 1fr track means minmax(auto,1fr), and that
           auto floor is the item's MIN-CONTENT width — so a card holding something with an
           intrinsic minimum (the heatmap's 430px grid; the payment legend's 220px column beside
           a 180px donut) pushed its own track wider than the phone instead of letting the card's
           inner scroller do its job. On the owner's A35 (360px) the main pane measured 496px wide
           and the Busy-heatmap and Payment-methods cards ran 136px off-screen, taking the
           heatmap's enlarge button with them, with no horizontal scrollbar to reveal them
           (owner-panel sweep, 2026-08-04). min-width:0 on the children is the other half of the
           cure: without it a grid item still refuses to shrink.
           NOTE: this CSS lives in a template literal — never use backticks in these comments,
           they close the string and the build fails with "Identifier cannot follow number". */
        .ow2-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
        .ow2-two > * { min-width: 0; }
        /* A card that hands its leftover height to its chart instead of leaving a blank
           band under it. The grid already stretches both cards to the taller one's height;
           this is what lets the SHORTER card's content actually use it. */
        .ow2-fill { display: flex; flex-direction: column; }
        /* table */
        .hq-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 12px 14px; border-bottom: var(--border); }
        .hq-search { flex: 1 1 220px; display: flex; align-items: center; gap: 9px; border: var(--border); background: var(--bg); border-radius: 9px; padding: 7px 12px; color: var(--muted); }
        .hq-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; font: inherit; font-size: 13px; color: var(--text); }
        .hq-search i { font-size: 12px; }
        .hq-x { background: none; border: none; color: var(--muted); font-size: 15px; cursor: pointer; padding: 0 2px; line-height: 1; }
        .hq-scroll { overflow: auto; max-height: 64vh; }
        .hq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        /* ── :global(th), NOT th — THE HEADER IS BUILT BY A HELPER (T5 sweep, 2026-08-06) ──
           Every <th> in this table comes out of the th() arrow function above. styled-jsx only
           stamps its scope class onto JSX written in the component's OWN function body, and a
           nested arrow is a different scope — so these th elements ship as a bare
           a bare th with no jsx- class with no jsx- class at all. A scoped .hq-table th selector
           compiles to .hq-table.jsx-X th.jsx-X — which therefore matched NOTHING: measured on
           the live site, a header cell computed to fontSize 13px, textTransform none,
           position static — i.e. the whole header row had been unstyled since it was written
           (not sticky, not uppercase, no border), and the phone column-hiding below could not
           reach it either, leaving 8 header columns over 6 body cells. Marking the DESCENDANT
           global keeps the scope on .hq-table (so nothing leaks out of this page) while letting
           the rule reach a th the transform never touched. */
        .hq-table :global(th) { position: sticky; top: 0; background: var(--card); z-index: 1; text-align: right; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; padding: 9px 12px; border-bottom: var(--border); white-space: nowrap; user-select: none; }
        .hq-table :global(th):hover { color: var(--accent); }
        .hq-table :global(th.l), .hq-table td.l { text-align: left; }
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
        .own-dish-h { display: flex; align-items: flex-start; gap: 12px; border-left: 4px solid var(--rcol); padding-left: 12px; }
        /* 44x44 — the tap-target guideline, and the reason this is not the 25x22 the panel sheets
           use (he judged those fine because the phone BACK also closes them; here BACK is exactly
           what was missing, so this one has to be catchable). */
        .own-dish-x { flex: none; width: 44px; height: 44px; border-radius: 12px; border: var(--border); background: var(--bg); color: var(--muted); font-size: 16px; line-height: 1; cursor: pointer; }
        .own-dish-x:hover { color: var(--accent); border-color: var(--accent); }
        .own-dish-name { font-size: 22px; font-weight: 800; }
        .rv-sort { display: inline-flex; gap: 2px; }
        .rv-sort button { background: none; border: var(--border); padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        /* --accent-on, not #fff — see the note in components/owner/reports/kit.tsx. */
        .rv-sort button.on { background: var(--accent); color: var(--accent-on, #fff); border-color: var(--accent); }
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
        /* ── the KPI tile popup (owner, 2026-08-18) ────────────────────────────────────────────
           A centred sheet rather than the side drawer: this is a figure being explained, not a
           restaurant being previewed, and the numbers read better centred over the tile they came
           from. Same close contract as every other overlay here — backdrop, the X, Escape and the
           phone's BACK. */
        .ow2-tile-wrap { position: fixed; inset: 0; z-index: 95; display: grid; place-items: center; padding: 18px; }
        .ow2-tile-back { position: absolute; inset: 0; background: rgba(5,8,14,.6); backdrop-filter: blur(2px); animation: ow2fade .18s ease-out; }
        .ow2-tile { position: relative; width: min(430px, 100%); max-height: min(88vh, 720px); overflow-y: auto; background: var(--card); border: var(--border); border-radius: 16px; box-shadow: 0 24px 70px rgba(0,0,0,.45); animation: ow2pop .18s cubic-bezier(.4,0,.2,1); }
        @keyframes ow2pop { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
        .ow2-tile header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 16px 18px 10px; }
        .ow2-tile header .ti { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .ow2-tile header .ti b { font-size: 17px; font-weight: 800; }
        .ow2-tile header .ti i { font-style: normal; font-size: 11.5px; color: var(--muted); }
        .ow2-tile .x { flex: none; background: var(--bg); border: var(--border); color: var(--text); width: 30px; height: 30px; border-radius: 9px; font-size: 13px; cursor: pointer; }
        .ow2-tile .who { display: flex; align-items: center; gap: 7px; margin: 0 18px 12px; padding: 6px 10px; border-radius: 9px; background: color-mix(in srgb, var(--accent) 9%, transparent); font-size: 11.5px; font-weight: 700; color: var(--text); }
        .ow2-tile .who i { font-size: 10px; opacity: .7; }
        .ow2-tile .rows { padding: 0 18px; display: flex; flex-direction: column; }
        .ow2-tile .r { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--border-c, rgba(128,128,128,.16)); }
        .ow2-tile .r:last-child { border-bottom: none; }
        /* the total line reads as the answer, not as one more row */
        .ow2-tile .r.last { margin-top: 4px; border-top: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); border-bottom: none; padding-top: 11px; }
        .ow2-tile .r.last .l, .ow2-tile .r.last .v { font-weight: 800; }
        .ow2-tile .r.last .v { color: color-mix(in srgb, var(--accent) 80%, var(--text)); font-size: 17px; }
        .ow2-tile .r .l { display: flex; flex-direction: column; gap: 2px; font-size: 13px; font-weight: 600; min-width: 0; }
        .ow2-tile .r .l i { font-style: normal; font-size: 10.5px; color: var(--muted); font-weight: 500; line-height: 1.35; }
        .ow2-tile .r .v { flex: none; font-size: 14.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .ow2-tile .note { display: flex; gap: 8px; margin: 12px 18px 0; padding: 10px 12px; border-radius: 10px; background: var(--bg); font-size: 11.5px; line-height: 1.45; color: var(--muted); }
        .ow2-tile .note > i { margin-top: 2px; opacity: .8; flex: none; }
        :global(.ow2-tile .note .nlink) { display: inline-flex; align-items: center; gap: 5px; margin-top: 4px; font-weight: 800; color: color-mix(in srgb, var(--accent) 80%, var(--text)) !important; text-decoration: none; white-space: nowrap; }
        :global(.ow2-tile .note .nlink:hover) { text-decoration: underline; }
        :global(.ow2-tile .note .nlink i) { font-size: 9px; }
        .ow2-tile footer { padding: 14px 18px 16px; }
        :global(.ow2-tile .full) { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px; background: var(--accent); color: #06251a !important; border: none; border-radius: 11px; padding: 12px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; text-decoration: none; }
        :global(.ow2-tile .full:hover) { filter: brightness(1.08); }
        :global(.ow2-tile .full.off) { background: var(--bg); border: var(--border); color: var(--muted) !important; cursor: default; font-weight: 600; }
        .ow2-drawer footer { padding: 14px 18px; border-top: var(--border); }
        .ow2-drawer .full { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px; background: var(--accent); color: #06251a; border: none; border-radius: 11px; padding: 12px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; }
        .ow2-drawer .full:hover { filter: brightness(1.08); }
        /* Five in a line is a DESKTOP promise. Below ~1080px five tiles would be ~150px each and the
           labels would break mid-word, which is the exact fault the 2026-08-11 fix cured — so the
           laptop step is 3 and the phone step is 2. Told to him plainly rather than pretended. */
        @media (max-width: 1080px) { :global(.ow2-stats), :global(.ow2-stats5) { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } }
        @media (max-width: 760px) {
          :global(.ow2-stats), :global(.ow2-stats5) { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .ow2-two, .ow2-callouts { grid-template-columns: minmax(0, 1fr); }
          /* by CLASS, never by nth-child — a row whose cells don't line up 1:1 with the header
             (the "figures hidden" row) used to lose the wrong ones. And :global, because the
             header's th carries no jsx- scope class (see the note by .hq-table :global(th)
             above) — without it only the BODY cells hid and the header kept 8 columns over 6.
             (T5 sweep, 2026-08-06.) */
          .hq-table :global(.hide-m), .hq-table :global(.hide-s) { display: none; }
          .ow2-act .who { display: none; }
        }
      `}</style>
    </>
  );
}

// ── Every-dish list (kept from the old view, range now per-card) ──────────────
function DishList({ payload, sort, onDish, note }: { payload?: RestA; sort: "revenue" | "qty"; onDish: (t: string) => void; note?: string }) {
  // `note` is the page's own placeholder text: "Loading…" normally, but "Reports are switched off"
  // once the server has said so, because then no payload is ever coming (T12 sweep, 2026-08-17).
  if (!payload) return <div className="adm-empty">{note ?? "Loading…"}</div>;
  const dishes = [...payload.dishes].sort((a, b) => (sort === "revenue" ? b.revenue - a.revenue : b.qty - a.qty));
  const maxRev = Math.max(1, ...dishes.map((d) => d.revenue));
  return (
    <div className="rv-dishes">
      {dishes.length === 0 && <div className="adm-empty">No dish sales in this range.</div>}
      {dishes.map((d) => (
        <button key={d.title} className="rv-dish" onClick={() => onDish(d.title)}>
          <span className="rv-dn" title={d.title}>{d.title}</span>
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
