"use client";
// Owner · Reports Studio (redesign 2026-07-25).
//
// A categorised HUB of report cards → a premium report VIEW (KPI hero band, best-fit
// chart, breakdown, clean table), print- and CSV-ready. On-demand only: a report runs
// when the owner opens it (owner's rule — never scheduled). Every number comes from the
// existing lfh_owner_* RPCs via /api/owner/reports; a dozen reports share a handful of
// query shapes (sales/avgbill/volume/weekday/tax/discounts/cancellations all read ONE
// bucketed money payload; daypart re-slices hourly; menu re-slices dishes) so the studio
// is rich without being egress-heavy. Charts adopt the SELECTED restaurant's brand accent.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { inr, inrP } from "@/components/admin/shared";
import { useBackClose } from "@/lib/backStack";
import { asSuffix } from "@/lib/ownerPin";

// useLayoutEffect on the client, useEffect on the server (Next SSR) — lets us restore scroll
// BEFORE the browser paints, with no SSR "useLayoutEffect does nothing" warning.
const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { AnimatedNumber } from "@/components/owner/AnimatedNumber";
import {
  ToggleChart, PaymentDonut, LeaderBar,
  // payColor, NOT PAY_COLORS[m] || grey: a method this app doesn't know by name (a wallet, a
  // house account) fell back to the SAME grey as "Not recorded", so the table's swatch and the
  // donut's wedge disagreed about which slice was which. Measured live 2026-08-10: "On the
  // house" and "Not recorded" both rendered rgb(107,114,128) (T5 sweep, 2026-08-11).
  canonPayMethod, payColor,
} from "@/components/owner/Charts";
import {
  REPORTS, CATEGORIES, ReportsStyles, Stat, Panel, PrintHead, PrintFoot, nfmt, scrollToId, type RKey, type DataKind,
  DAYPARTS, WEEKDAY_SHORT, WEEKDAY_FULL, istWeekday,
} from "@/components/owner/reports/kit";
import { BestWorst, SplitBar } from "@/components/owner/reports/Insights";
import { DishesReport, CategoriesReport, MenuReport, classifyMenu, type MI } from "@/components/owner/reports/DishReports";
import {
  InvStockReport, InvPurchasesReport, InvUsageReport, InvWasteReport, InvExpensesReport,
  InvReportStyles, type InvPayload,
} from "@/components/owner/reports/InventoryReports";
import { ReportMenu } from "@/components/owner/OwnerReportButton";
import { gatherOwnerReport } from "@/lib/ownerReportGather";
import { readSnap, writeSnap } from "@/lib/ownerSnap";
import { fetchOwnerOverview } from "@/lib/ownerOverviewCache";
import { SectionExport, printSection, POPUP_BLOCKED } from "@/components/owner/reports/sectionExport";
// ONE filing computation for the whole app (screen, CSV, printed sheet) — see lib/taxFiling.ts
// for why having three was a bug rather than a style choice.
import { buildFiling, splitTax, taxableValue, exemptIsMaterial, taxableFor } from "@/lib/taxFiling";

// "day" never appears in the period dropdown — it is the Day-summary sheet's own window
// (`range=day&date=…` = ONE 05:00-IST business day). See DAY_KINDS below.
type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth" | "12m" | "fy" | "all" | "custom" | "day";
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "7 days" }, { k: "30d", label: "30 days" },
  { k: "month", label: "This month" }, { k: "lastmonth", label: "Last month" },
  { k: "12m", label: "12 months" }, { k: "fy", label: "FY (Apr–Mar)" },
  { k: "all", label: "All time" }, { k: "custom", label: "Custom…" },
];
const rangeLabel = (r: Range) => RANGES.find((x) => x.k === r)?.label ?? r;
// A "Day summary" is inherently ONE day — it must NOT carry a 7d/30d toggle (owner
// round-6). These report kinds get a single-DATE control instead of the range seg;
// under the hood a chosen day is fetched as `range=day&date=<that day>`.
//
// It used to be `range=custom&from=D&to=D`, which is a CALENDAR day from 00:00 IST — while
// Sales "Today", the owner dashboard's "TODAY SO FAR" tile, the manager dashboard and the
// manager Z-report all mean the 05:00-IST BUSINESS day. Measured 4 Aug 2026: the day sheet
// said ₹38,640 / 111 orders and every other screen said ₹30,324 / 90 for the same "today"
// (owner-panel sweep). `range=day` is the business day, so they agree now.
const DAY_KINDS = new Set<DataKind>(["daysummary"]);
// "Today" on a restaurant's day sheet is the BUSINESS day, which starts at 05:00 IST — not the
// calendar date. Between midnight and 5am the calendar has already rolled over while the shift
// has not: at 00:29 IST the day sheet defaulted to the NEW calendar date, whose business day has
// not begun, and showed ₹0 "Today" while the dashboard tile beside it read ₹46,935 for the
// business day still in progress (the T5 re-run caught this at 00:29 IST — the same disagreement
// the range=day fix removed, reappearing at the other end). Stepping back the 5-hour offset
// before taking the IST date makes "Today" mean the shift you are actually working.
const BIZ_H = 5;
const istToday = () => new Date(Date.now() + 5.5 * 3600_000 - BIZ_H * 3600_000).toISOString().slice(0, 10);
/** The plain IST CALENDAR date — the ceiling for a CUSTOM range, which is calendar-based
 *  (a GST filing period is). Between midnight and 5am this is one day ahead of the business
 *  date, and a custom range must still be allowed to include it. */
const istCalToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const yesterdayIso = () => new Date(Date.now() + 5.5 * 3600_000 - BIZ_H * 3600_000 - 86_400_000).toISOString().slice(0, 10);

// The IST dates a named range covers — used to PREFILL the print ask-dialog's from/to.
// Mirrors the server's windowFor() at day granularity (to = today for "…to now").
//
// TWO CLOCKS, deliberately. `today`/`yesterday` are BUSINESS days on the server (05:00 IST), so
// they prefill from the business date. Every other range is aligned to IST CALENDAR midnights on
// the server (7d/30d step whole calendar days; month/fy are filing periods), so those prefill
// from the calendar date — mixing the two would print a 6-day span for "7 days" between midnight
// and 5am.
function rangeDates(r: Range, cFrom: string, cTo: string): { from: string; to: string } {
  const bizToday = istToday();                                        // 05:00-IST business day
  const calToday = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const today = calToday;
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth();
  switch (r) {
    case "today": return { from: bizToday, to: bizToday };
    case "yesterday": { const yd = yesterdayIso(); return { from: yd, to: yd }; }
    case "7d": return { from: new Date(Date.now() + 5.5 * 3600_000 - 6 * 86_400_000).toISOString().slice(0, 10), to: today };
    case "30d": return { from: new Date(Date.now() + 5.5 * 3600_000 - 29 * 86_400_000).toISOString().slice(0, 10), to: today };
    case "month": return { from: iso(y, m, 1), to: today };
    case "lastmonth": return { from: iso(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1), to: iso(y, m, 0) };
    case "12m": return { from: iso(y, m - 11, 1), to: today };
    case "fy": return { from: iso(m >= 3 ? y : y - 1, 3, 1), to: today };
    case "all": return { from: "2020-01-01", to: today };
    default: return { from: cFrom, to: cTo };
  }
}

// ── Sub-tabs (the merge, owner 2026-07-26) ────────────────────────────────────
// A "body key" is one of the original report VIEWS. Six catalog reports now compose
// several of these as sub-tabs inside one report, so the owner never sub-report-hops.
// The active sub-tab also picks the data payload to fetch — each view keeps reading the
// exact same (already-verified) numbers it did as a standalone report.
type BodyKey =
  | "daysummary" | "sales" | "avgbill" | "volume" | "weekday"
  | "payments" | "discounts" | "cancellations" | "tax"
  | "dishes" | "categories" | "menu" | "hourly" | "daypart"
  | "staffpay" | "staffperf"
  // Inventory & stock (migs 221/224/227) — one body per sub-tab.
  | "invstock" | "invpurchases" | "invusage" | "invwaste" | "invexpenses";
const BODY_KIND: Record<BodyKey, DataKind> = {
  daysummary: "daysummary",
  sales: "money", avgbill: "money", volume: "money", weekday: "money",
  discounts: "money", cancellations: "money", tax: "money",
  payments: "payments",
  dishes: "dishes", menu: "dishes", categories: "categories",
  hourly: "hourly", daypart: "hourly",
  staffpay: "staffpay", staffperf: "staffperf",
  invstock: "invstock", invpurchases: "invpurchases", invusage: "invusage",
  invwaste: "invwaste", invexpenses: "invexpenses",
};
type OpenOpts = { sub?: string; pay?: "discounts" | "cancellations" };
type OpenReport = (k: RKey, opts?: OpenOpts) => void;
type SubTab = { key: string; label: string; icon: string; body: BodyKey; needsDayGrain?: boolean;
  /** The trade term, kept on hover when the tab itself is named in plain words (I1). */
  hint?: string };
/** Which periods produce DAY buckets — the only ones a day-of-week breakdown can read. */
const DAY_GRAIN_RANGES = new Set<Range>(["7d", "30d", "month", "lastmonth", "custom"]);
const SUBTABS: Record<RKey, SubTab[]> = {
  daysummary: [],
  sales: [
    { key: "revenue", label: "Revenue", icon: "fa-chart-line", body: "sales" },
    { key: "avgbill", label: "Average bill", icon: "fa-receipt", body: "avgbill" },
    { key: "volume", label: "How many orders", icon: "fa-list-check", body: "volume",
      hint: "Order volume — how many orders came in, not how much money they made" },
  ],
  payments: [],   // discounts + cancellations open as detail overlays, not tabs
  tax: [],
  items: [
    { key: "items", label: "Items", icon: "fa-utensils", body: "dishes" },
    { key: "categories", label: "Categories", icon: "fa-layer-group", body: "categories" },
    { key: "menu", label: "Which dishes earn", icon: "fa-lightbulb", body: "menu",
      hint: "Menu engineering — which dishes make you money, and which just take up space" },
  ],
  team: [
    { key: "pay", label: "Pay & cost", icon: "fa-indian-rupee-sign", body: "staffpay" },
    { key: "perf", label: "Performance", icon: "fa-chart-line", body: "staffperf" },
  ],
  timing: [
    { key: "hours", label: "By hour", icon: "fa-clock", body: "hourly" },
    { key: "dayparts", label: "Times of day", icon: "fa-sun", body: "daypart",
      hint: "Day parts — morning, afternoon, evening and late night" },
    // needsDayGrain: the weekday breakdown can only be built from DAY buckets, so on Today /
    // Yesterday / 12 months it could only ever say "pick a daily period" — a tab whose one job
    // was to send you somewhere else (T5 sweep, 2026-08-06). It is now disabled there, with the
    // reason on the button itself.
    { key: "weekday", label: "Day of week", icon: "fa-calendar-week", body: "weekday", needsDayGrain: true },
  ],
  // Inventory & stock (mig 227). Five views, one payload shape each — the owner's
  // "inside the main report all the sub reports will be there" for stock.
  inventory: [
    { key: "stock", label: "On the shelf", icon: "fa-boxes-stacked", body: "invstock" },
    { key: "buy", label: "Purchases", icon: "fa-truck", body: "invpurchases" },
    { key: "usage", label: "Usage & cost", icon: "fa-utensils", body: "invusage" },
    { key: "waste", label: "Waste", icon: "fa-trash", body: "invwaste" },
    { key: "expenses", label: "Expenses", icon: "fa-receipt", body: "invexpenses" },
  ],
};
// The body shown for a report + its active sub-tab (first tab default; no tabs = the report key itself).
const bodyKeyFor = (sel: RKey, subKey: string): BodyKey => {
  const tabs = SUBTABS[sel];
  if (!tabs.length) return sel as BodyKey;
  return (tabs.find((t) => t.key === subKey) ?? tabs[0]).body;
};

type Rest = { id: string; name: string; accent: string };
type MoneyRow = { bucket: string; orders: number; paidOrders: number; subtotal: number; tax: number; discount: number; revenue: number; cancelledOrders: number; cancelledValue: number };
type Totals = Omit<MoneyRow, "bucket">;
// `composition` = this restaurant charges the diner no GST at all (composition scheme), so
// there is no CGST/SGST split and no taxable supply to file — the report says so instead of
// printing a table of zeroes (owner-panel sweep 2026-08-04).
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean; composition?: boolean } | null;
type PayRow = { method: string; revenue: number; orders: number };
type DishRow = { title: string; qty: number; revenue: number };
type CatRow = { category: string; qty: number; revenue: number };
type HourRow = { hour: number; orders: number; revenue: number };
type Payload = { rows?: unknown[]; totals?: Totals; tax?: TaxInfo; payments?: PayRow[]; bucket?: string; drillBucket?: string; drillRows?: unknown[];
  staffPay?: { paidOut: number; people: number; entries: number } | null;
  // Tips collected in the window (mig 268 / sweep F20). Null = nothing tipped, so no tile.
  tips?: { collected: number; orders: number } | null;
  // Team & pay (mig 220): its own shapes — cash view, cost view, per-person, and the
  // performance rows share `rows`.
  cashRows?: unknown[]; monthRows?: unknown[]; people?: unknown[];
  // Inventory & stock (mig 227): the five sub-tab payloads share one shape (InvPayload),
  // and the MONEY reports carry two extra optional blocks — `inventory` (the day-sheet
  // lines) and `costSeries` (the second line on the sales chart). Both are absent/null
  // when the module is off, which is what keeps inventory invisible then.
  summary?: InvPayload["summary"]; coverage?: InvPayload["coverage"]; costDataFrom?: string | null;
  merged?: boolean; perRestaurant?: InvPayload["perRestaurant"];
  listCap?: number; expensesMore?: boolean; wasteMore?: boolean;
  dishes?: InvPayload["dishes"]; items?: InvPayload["items"]; vendors?: InvPayload["vendors"];
  series?: InvPayload["series"]; expenses?: InvPayload["expenses"]; waste?: InvPayload["waste"];
  inventory?: {
    bought: number; usedActual: number; usedTheoretical: number; wasted: number;
    expenses: number; stockValue: number; lowCount: number; negativeCount: number;
    foodCostPct: number | null; coveragePct: number; hasRecipes?: boolean;
  } | null;
  costSeries?: { bucket: string; purchased: number; used: number; wasted: number }[] | null };
// `cachedAt` is the moment the SERVER computed these figures — not the moment we fetched
// them. Reports are served from the compute-on-view snapshot cache, so an idle key can be
// minutes or hours old (a day sheet was observed reading ₹12,285 when the live figure was
// ₹38,640 — owner-panel sweep 2026-08-04). Keeping it per entry is what lets the page say
// "updated X ago" and offer Refresh, exactly like the dashboard already does.
type Entry = { loading?: boolean; error?: string; data?: Payload; cachedAt?: string };

// The effective backend window for one fetch. `day` carries a DATE (one business day),
// `custom` carries from/to, every other range carries nothing else.
type Eff = { range: Range; from?: string; to?: string; date?: string };
const keyOf = (kind: DataKind, rid: string, e: Eff) =>
  `${kind}|${rid}|${e.range}${e.date ? `|${e.date}` : e.from ? `|${e.from}|${e.to}` : ""}`;
const qsOf = (kind: DataKind, rid: string, e: Eff, scopePin: string | null) => {
  const q = new URLSearchParams({ type: apiType(kind), range: e.range });
  if (e.date) q.set("date", e.date);
  if (e.from) { q.set("from", e.from); q.set("to", e.to as string); }
  if (rid) q.set("rid", rid);
  if (scopePin) q.set("scope", scopePin);
  return q;
};

/** "just now" / "4 min ago" / "2 h ago" — how old the figures on screen are. */
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

const apiType = (kind: DataKind): string =>
  kind === "money" ? "sales" : kind === "daysummary" ? "daysummary" : kind;

// Bucket instants are IST (the RPC truncates in Asia/Kolkata) — format IN that zone or a
// non-IST viewer sees every day/month off by one (wrong on a GST document).
const TZ = "Asia/Kolkata";
function bucketLabel(iso: string, bucket: string): string {
  const d = new Date(iso);
  if (bucket === "hour") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: TZ });
  if (bucket === "month") return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: TZ });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: TZ });
}



// Build the Day-summary's extra print/CSV tables (the day's dishes + busy hours) so a
// printed day sheet carries everything for that day, not just the money lines.
function dayExtraTables(dishesDay?: Payload, hourlyDay?: Payload): { title: string; head: string[]; rows: (string | number)[][] }[] {
  const out: { title: string; head: string[]; rows: (string | number)[][] }[] = [];
  const dishes = ((dishesDay?.rows ?? []) as DishRow[]).filter((d) => d.qty > 0).sort((a, b) => b.revenue - a.revenue);
  if (dishes.length) out.push({ title: "Items sold", head: ["Dish", "Qty", "Sales"], rows: dishes.map((d) => [d.title, d.qty, Math.round(d.revenue)]) });
  const hours = ((hourlyDay?.rows ?? []) as HourRow[]).filter((h) => h.orders > 0).sort((a, b) => a.hour - b.hour);
  if (hours.length) out.push({ title: "Busy hours", head: ["Hour", "Orders", "Revenue"], rows: hours.map((h) => [`${h.hour % 12 === 0 ? 12 : h.hour % 12} ${h.hour < 12 ? "AM" : "PM"}`, h.orders, Math.round(h.revenue)]) });
  return out;
}

// Tab-lifetime memo of the hub's per-restaurant brief per query string (see Hub).
const briefMemo = new Map<string, { id: string; name: string; accent: string; revenue: number; orders: number }[]>();

// ── Menu-engineering quadrant ────────────────────────────────────────────────
// The grouping maths lives ONCE, in DishReports.tsx, and is imported here (T5 sweep,
// 2026-08-11). This file used to carry a byte-identical copy whose only job was the
// is-this-report-empty check below — two copies of the medians that decide every
// Star / Workhorse / Puzzle / Dog verdict is one place for them to drift apart.

// ── Period dropdown (owner 2026-07-27: "make it a dropdown like the dashboard,
// not the whole strip showing"). Same button+popup look as the dashboard's
// RangeDrop (owr-btn / owr-pop), so the two pages read as one console. Picking
// "Custom…" still reveals the date pickers next to it.
function PeriodDrop({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  useBackClose("owner-reports-period", open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-rng="reports-period"]')) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <span className="owr" data-rng="reports-period">
      <button type="button" className="owr-btn main" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {rangeLabel(value)} <i className="fas fa-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <span className="owr-pop" role="listbox" aria-label="Period">
          {RANGES.map((r) => (
            <button key={r.k} type="button" role="option" aria-selected={r.k === value}
              className={r.k === value ? "on" : ""}
              onClick={() => { onChange(r.k); setOpen(false); }}>
              {r.label}
            </button>
          ))}
        </span>
      )}
      <style jsx>{`
        .owr { position: relative; display: inline-flex; }
        .owr-btn { display: inline-flex; align-items: center; gap: 6px; background: var(--bg); border: var(--border); border-radius: 8px; padding: 5px 10px; font: inherit; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; white-space: nowrap; }
        .owr-btn:hover { color: var(--accent); border-color: var(--accent); }
        .owr-btn i { font-size: 9px; opacity: .7; }
        /* --accent-ink, not --accent — the same rule and the same fix as app/owner/page.tsx; this
           second copy is the one the Reports range buttons use, and it measured 3.65:1 on the light
           console (T26 sweep, 2026-08-22). */
        .owr-btn.main { background: color-mix(in srgb, var(--accent) 16%, transparent); border: 1px solid var(--accent); color: var(--accent-ink, var(--accent)); font-size: 12.5px; font-weight: 800; padding: 7px 14px; border-radius: 10px; }
        .owr-btn.main:hover { background: color-mix(in srgb, #34d399 26%, transparent); color: #047857; }
        :global([data-skin="dark"]) .owr-btn.main { color: #34d399; }
        :global([data-skin="dark"]) .owr-btn.main:hover { color: #6ee7b7; }
        .owr-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 90; min-width: 180px; max-height: 320px; overflow-y: auto; display: flex; flex-direction: column; background: var(--card); border: var(--border); border-radius: 12px; padding: 5px; box-shadow: 0 16px 40px rgba(0,0,0,.45); }
        .owr-pop button { display: flex; align-items: center; background: none; border: none; border-radius: 8px; padding: 8px 12px; font: inherit; font-size: 12.5px; font-weight: 700; color: inherit; cursor: pointer; text-align: left; }
        .owr-pop button:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
        .owr-pop button.on { color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
        /* A thumb target on a phone — see the note in kit.tsx's ReportsStyles. The period
           button measured 31px on an A35; desktop is untouched. */
        @media (max-width: 640px) {
          .owr-btn.main { min-height: 44px; padding: 7px 16px; }
          .owr-pop button { min-height: 42px; }
        }
      `}</style>
    </span>
  );
}

// DAYPARTS, WEEKDAY_* and istWeekday now live in kit.tsx — the EXPORT needs the same
// groupings, and two copies is how the file and the screen came to disagree.

export default function OwnerReports() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [ready, setReady] = useState(false);
  // Start "" so SSR and the first client render agree (reading the URL in the initial
  // state caused a hydration mismatch on the "This restaurant"/"All restaurants" label).
  // An effect below pins it from ?rid; the data fetch is gated on `ready`, so no query
  // fires against the wrong scope in the meantime. "" = all restaurants.
  const [rid, setRid] = useState<string>("");
  const [sel, setSel] = useState<RKey | "">("");         // "" = hub
  const [sub, setSub] = useState<string>("");            // active sub-tab key ("" = first)
  // A KPI drill-box inside Payments opens the discount / cancellation detail as an OVERLAY
  // (owner 2026-07-26: "make a whole popup … you don't have to make a whole sub-report").
  const [payDetail, setPayDetail] = useState<"" | "discounts" | "cancellations">("");
  // Deep link from the dashboard's KPI boxes (owner round-3: "the top five box … should take
  // you to the report section"): /owner/reports?open=<type>. `type` may be a NEW report key or
  // an OLD sub-report name — map old names onto the report + sub-tab (or payment overlay) that
  // now contains them, so existing dashboard links keep landing on the right thing.
  const openAlias = (raw: string): { sel: RKey; sub?: string; pay?: "discounts" | "cancellations" } | null => {
    const k = raw as BodyKey | RKey;
    const map: Record<string, { sel: RKey; sub?: string; pay?: "discounts" | "cancellations" }> = {
      daysummary: { sel: "daysummary" }, sales: { sel: "sales" }, tax: { sel: "tax" }, payments: { sel: "payments" },
      items: { sel: "items" }, timing: { sel: "timing" },
      // `team` and `inventory` were MISSING, so the dashboard's "Staff pay out" / "After staff
      // pay" tiles — which link to ?open=team and promise "Open the full report" — dropped the
      // owner on the report catalogue with the Team card still to find (T5 sweep, 2026-08-06).
      // Every RKey must be its own alias; the map is the only thing this deep-link consults.
      team: { sel: "team" }, inventory: { sel: "inventory" },
      avgbill: { sel: "sales", sub: "avgbill" }, volume: { sel: "sales", sub: "volume" },
      weekday: { sel: "timing", sub: "weekday" }, hourly: { sel: "timing", sub: "hours" }, daypart: { sel: "timing", sub: "dayparts" },
      dishes: { sel: "items", sub: "items" }, categories: { sel: "items", sub: "categories" }, menu: { sel: "items", sub: "menu" },
      discounts: { sel: "payments", pay: "discounts" }, cancellations: { sel: "payments", pay: "cancellations" },
    };
    return map[k] ?? null;
  };
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const open = qs.get("open");
    const a = open && openAlias(open);
    if (a) { setSel(a.sel); if (a.sub) setSub(a.sub); if (a.pay) setPayDetail(a.pay); }
    // ── THE PERIOD TRAVELS TOO (owner, 2026-08-18) ─────────────────────────────────────────────
    // "for example I'm at thirty days all restaurant, and I open the detail view of orders, then it
    // should be also open in thirty days and all restaurant." This page used to open on its own
    // default of 30 days whatever the dashboard was showing, so anyone reading "This month" on the
    // dashboard and tapping through was quietly handed a different period.
    //   The two screens do not share a vocabulary: the dashboard has "This week", this page has
    // "Last 12 months", "This financial year", "Custom" and "One day". So only a value THIS page
    // really has is accepted, and the dashboard's "week" maps to its nearest neighbour here.
    const wanted = qs.get("range");
    const mapped = wanted === "week" ? "7d" : wanted;
    if (mapped && RANGES.some((r) => r.k === mapped)) setRange(mapped as Range);
  }, []);

  // ── Scroll memory (owner 2026-07-26: "when I click back it takes me to the top — it
  // should keep me where I was"). The owner panel scrolls INSIDE `.adm-main`, not the
  // window, so save/restore THAT element's scrollTop. Opening a report jumps to the top of
  // the report; going back to the hub restores exactly where the owner was browsing.
  // ── WHICH ELEMENT ACTUALLY SCROLLS (T12 sweep, 2026-08-18) ───────────────────────────────────
  // `.adm-main` alone was wrong on a phone. At >900px it is the scroller; at <=900px globals.css
  // gives it `overflow-y: visible` and makes `.adm` the 100dvh scroller instead — so this whole
  // save/restore silently did nothing there, and "when I click back it should keep me where I was"
  // was lost on the device he actually uses. Measured at 360x780: `.adm` 4109/780 while `.adm-main`
  // is 4052/4052. The window never scrolls at either width. Same helper as the dashboard's
  // scrollPort() and as `port()` in app/aevinite/restaurants/page.tsx, which solved this first.
  const scroller = () => {
    if (typeof document === "undefined") return null;
    for (const sel of [".adm-main", ".adm"]) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && el.scrollHeight > el.clientHeight + 2) return el;
    }
    return document.querySelector<HTMLElement>(".adm-main");
  };
  const hubScroll = useRef(0);
  const openReport = useCallback((k: RKey, opts?: OpenOpts) => {
    setSel((cur) => { if (cur === "") { const el = scroller(); if (el) hubScroll.current = el.scrollTop; } return k; });
    setSub(opts?.sub ?? "");                 // land on a named sub-tab, else the report's first
    setPayDetail(opts?.pay ?? "");           // optionally pop a Payments detail overlay
  }, []);
  const backToHub = useCallback(() => { setSel(""); setSub(""); setPayDetail(""); }, []);
  // Restore the right scroll position AFTER the view swaps, before the browser paints.
  useIso(() => {
    const el = scroller();
    if (!el) return;
    if (sel) el.scrollTop = 0;                 // opened a report → start at its top
    else el.scrollTop = hubScroll.current;     // back on the hub → where we left off
  }, [sel]);
  // The mobile/desktop BACK button (and browser back) closes the open report back to the
  // hub instead of leaving the panel — same back-layer contract every owner overlay uses.
  useBackClose("owner-report-view", !!sel, backToHub);
  // The ONE top-strip breadcrumb's "Reports" segment (rendered by OwnerShell from the
  // section label) dispatches this when clicked. On the reports route it can only come from
  // that segment, so treat it as "back to the hub" — a single path, no second crumb row.
  useEffect(() => {
    const onHome = () => backToHub();
    window.addEventListener("lfh:owner-open-restaurant", onHome);
    return () => window.removeEventListener("lfh:owner-open-restaurant", onHome);
  }, [backToHub]);
  // The shell's restaurant switchers (top-strip "Owner overview ▾" dropdown + the sidebar
  // "My restaurants" list) re-scope the reports IN PLACE here instead of jumping to the
  // dashboard (owner 2026-07-27: "toggle on top to all restaurants" must work on Reports).
  // rid=null → "" = all restaurants; a real id pins to that one. Closing any open report
  // back to the hub shows the new scope's overview (and the by-restaurant brief for "all").
  useEffect(() => {
    const onScope = (e: Event) => {
      const rid = (e as CustomEvent<{ rid: string | null }>).detail?.rid ?? null;
      setRid(rid ?? "");
      backToHub();
    };
    window.addEventListener("lfh:owner-scope", onScope);
    return () => window.removeEventListener("lfh:owner-scope", onScope);
  }, [backToHub]);
  const [range, setRange] = useState<Range>("30d");
  const [day, setDay] = useState<string>(istToday());          // Day summary's single date
  const [cFrom, setCFrom] = useState<string>(istToday());       // Custom range from…
  const [cTo, setCTo] = useState<string>(istToday());           // …to
  const [store, setStore] = useState<Record<string, Entry>>({});

  // Admin act-as scope pin (mirrors app/owner/page.tsx): rides on every call so a second
  // tab's act-as cookie can't hijack this one.
  const scopePin = useMemo(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"), []);
  const scp = scopePin ? `&scope=${scopePin}${asSuffix()}` : "";

  // Pin the scope from the URL (admin act-as ?rid) after hydration — not in the initial
  // state (that mismatches SSR). Runs once on mount, before `ready`, so the gated fetch
  // already sees the pinned rid.
  //
  // ── …BUT `?view=` BEATS THE PIN (owner, 2026-08-18) ──────────────────────────────────────────
  // His bug, in his words: "whenever I click on order, it takes me to the order of a particular
  // restaurant. But actually I am in a tab for all the restaurant." On an ADMIN tab the URL always
  // carries ?rid=<the restaurant the console drilled into>, and this line forced the reports scope
  // to it — so opening a tile from the dashboard's "All restaurants" view landed on one restaurant.
  //
  // The dashboard now says which scope it was showing in `?view=` (`all`, or a restaurant id), and
  // that wins here. `rid` keeps its old meaning untouched — it is the admin's AUTHORISATION pin and
  // still travels to the server as `scope=`; `view` is only a filter, and the server honours it only
  // for a restaurant already inside that scope, so this can narrow and never widen.
  // ── READ IT IN AN EFFECT, NOT IN RENDER (measured 2026-08-18) ────────────────────────────────
  // This started life as a useMemo over window.location.search and it worked when the address was
  // TYPED and failed when the link was CLICKED — which is the way anybody actually arrives. Measured:
  // the URL read /owner/reports?rid=…&view=all&range=30d&open=volume and the scope selector still
  // said "Burger Barn", at 1s and still at 16s. A useMemo runs during RENDER, and on an App Router
  // client-side navigation the component renders before the new URL has committed, so it read the
  // PREVIOUS page's query (which carries `rid` but no `view`) and fell back to the pin — for ever,
  // because the memo has no dependency that would make it try again. The sibling effect below that
  // reads `open` and `range` was never affected: effects run after the commit, which is exactly why
  // the report and the period arrived correctly while the scope did not.
  const [viewPin, setViewPin] = useState<string | null>(null);
  useEffect(() => { setViewPin(new URLSearchParams(window.location.search).get("view")); }, []);
  useEffect(() => {
    if (viewPin) setRid(viewPin === "all" ? "" : viewPin);
    else if (scopePin) setRid(scopePin);
  }, [scopePin, viewPin]);

  // ── Instant-paint (owner 2026-07-26): last-seen report payloads from THIS tab paint at
  // ~0ms with the usual count-up/chart animations, then the normal fetch revalidates and
  // swaps in anything newer. Only settled `data` entries are persisted (never loading/error
  // states), and `started` is untouched, so every hydrated entry still refetches. Cleared
  // on login (lib/ownerSnap.ts).
  const snapKey = `reports${scopePin ? `:${scopePin}` : ""}`;
  // ── WITH NO INTERNET, THIS PAGE HAD FORGOTTEN WHOSE FIGURES IT WAS HOLDING (T11 sweep #7) ──
  // The scope is decided by /api/owner/overview. With no connection that read comes back
  // `{ error: "offline" }` (public/sw.js answers 503 rather than throwing), so `rests` stayed
  // empty and `rid` stayed "" — and every cache key this page builds carries the rid. The saved
  // 30-day answer was sitting in this tab's own sessionStorage under `money|<rid>|30d` and the
  // page looked for `money||30d`, found nothing, and printed five confident zeroes with the
  // chart explaining "Not enough data yet — come back once there's a bit more". Measured on a
  // production build, offline: headline ₹0 · Net sales ₹0 · Paid bills 0 · Avg bill ₹0 · GST ₹0,
  // over a device holding ₹13,42,142.
  //   The scope the device last SAW is the only honest answer when the server cannot give one,
  // so it is used ONLY on that failure. On a good connection nothing changes: the overview
  // answers, and the owner's "Reports always opens on All restaurants" rule stands untouched.
  //   AND IT SAYS SO AT THE TOP, IN HIS OWN WORDS (owner, 2026-08-30): "you can just say there is
  // no internet, or if it was loaded previously you can show the previously and write a note on
  // the top: the internet is not available, this is not the current data."
  //   The app's own offline notice sits at the BOTTOM of the window and talks about SAVING work
  // ("changes you make now may not save"), which is the right sentence for a panel that writes
  // and the wrong one for a page that only reads. This note is about the FIGURES, it is at the
  // top where he asked for it, and it says which of the two cases he is in — figures saved
  // earlier, or nothing saved at all. One line, no icon-shouting, and it is gone the moment the
  // scope reads normally again.
  const savedRid = useRef<string>("");
  const savedName = useRef<string>("");
  // Did the scope read come back empty? That is this page's only signal that it could not reach
  // the server, and it is what the note at the top is driven from (owner, 2026-08-30).
  const [noSignal, setNoSignal] = useState(false);
  useEffect(() => {
    const s = readSnap<{ rid?: string; restName?: string; entries?: Record<string, Entry> }>(snapKey);
    if (!s) return;
    if (s.entries) setStore((cur) => ({ ...s.entries, ...cur }));
    // Deliberately NOT restoring the last-picked restaurant: the owner's rule (2026-07-26)
    // is that Reports always OPENS on "All restaurants" (a multi-restaurant estate) — a
    // restaurant is a per-visit choice, not a sticky one. (A single-restaurant owner still
    // gets pinned by the overview effect; admin act-as still pins from ?rid.)
    // …but REMEMBER it, unused, for the one case where the rule cannot apply: see savedRid.
    // The NAME rides along, or the offline sheet is headed "This restaurant" — the fallback for
    // a scope we cannot name — while it is showing that restaurant's own figures.
    if (s.rid) savedRid.current = s.rid;
    if (s.restName) savedName.current = s.restName;
  }, [snapKey, scopePin]);
  useEffect(() => {
    const settled = Object.fromEntries(Object.entries(store).filter(([, e]) => e.data));
    if (Object.keys(settled).length) writeSnap(snapKey, { rid, restName: rid ? rests.find((r) => r.id === rid)?.name : "", entries: settled });
  }, [snapKey, store, rid, rests]);

  // Does this owner have the Staff-profiles-&-pay module anywhere? Off ⇒ the Team & pay
  // report card isn't rendered at all (mig 220).
  const [hasPayroll, setHasPayroll] = useState(false);
  // Same for Inventory & stock (migs 221/224/227): off ⇒ no card, no category, no chance
  // of opening it — the owner's "when the inventory is off that all will not show".
  const [hasInventory, setHasInventory] = useState(false);
  useEffect(() => {
    // fetchOwnerOverview() — NOT a bare fetch. The owner SHELL asks for this same payload on
    // every load, and the shared de-duper exists precisely so the two callers cost ONE request
    // (lib/ownerOverviewCache.ts, audit 2026-07-07). Calling fetch() directly here put the
    // duplicate read straight back: two identical GET /api/owner/overview on every Reports
    // open, observed live (owner-panel sweep 2026-08-04) — and that route is force-dynamic,
    // so it is a doubled uncached aggregate, not a cache hit.
    fetchOwnerOverview(scp).then((o0) => {
      const o = o0 as { modules?: Record<string, boolean>; restaurants?: Record<string, unknown>[] };
      setHasPayroll(o?.modules?.payroll === true);
      setHasInventory(o?.modules?.inventory === true);
      // Overview returns camelCase (accentColor) — reading accent_color left every chart
      // on the fallback green instead of the restaurant's own brand accent.
      const list: Rest[] = (o.restaurants ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, name: r.name as string, accent: (r.accentColor as string) || "",
      }));
      setRests(list);
      // rid is already pinned from the URL for admin act-as; a single-restaurant owner
      // (no ?rid) gets pinned here once we know there's exactly one.
      if (!scopePin && list.length === 1) setRid(list[0].id);
      // Nothing came back (no internet, or the read failed): fall back to the scope this device
      // last saw, so the figures it already holds can be found and shown — and say so on screen.
      if (!list.length) { setNoSignal(true); if (!scopePin && savedRid.current) setRid(savedRid.current); }
      else setNoSignal(false);
      setReady(true);
    }).catch(() => {
      setNoSignal(true);
      if (!scopePin && savedRid.current) setRid(savedRid.current);
      setReady(true);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The effective backend window for the ACTIVE report: a day-kind report is always a
  // single day (range=custom, from=to=day); a report on the "Custom…" range uses the
  // date pickers; everything else is the plain named range.
  const effFor = (kind: DataKind, rg: Range): Eff =>
    DAY_KINDS.has(kind) ? { range: "day", date: day }
    : rg === "custom" ? { range: "custom", from: cFrom, to: cTo }
    : { range: rg };
  const cacheKey = (kind: DataKind, r: string, rg: Range) => keyOf(kind, r, effFor(kind, rg));
  // A key is fetched at most once (period/rid/kind combos are stable) — dedup via a ref so
  // React StrictMode's double-invoke can't double-fetch, and no stale `store` closure.
  const started = useRef<Set<string>>(new Set());
  const load = useCallback((kind: DataKind, r: string, eff: Eff, force?: boolean): Promise<void> => {
    const ck = keyOf(kind, r, eff);
    if (!force && started.current.has(ck)) return Promise.resolve();
    started.current.add(ck);
    // Instant-paint: if a hydrated snapshot already fills this key, keep showing it while
    // the fetch revalidates silently (SWR) — only a truly empty key shows the skeleton.
    // A forced refresh keeps the old numbers on screen too (the spinner lives on the button).
    setStore((s) => (s[ck]?.data ? s : { ...s, [ck]: { loading: true } }));
    const q = qsOf(kind, r, eff, scopePin);
    if (force) q.set("refresh", "1");      // ?refresh=1 = recompute live, don't serve a snapshot
    return fetch(`/api/owner/reports?${q}`, { cache: "no-store" })
      .then((x) => x.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setStore((s) => ({ ...s, [ck]: { data: d, cachedAt: d.cachedAt } }));
      })
      .catch((e) => {
        started.current.delete(ck);                       // allow a later retry
        // A failed SILENT revalidate must never blank numbers already on screen (offline
        // reload on a hydrated snapshot) — keep the shown data; only an empty key errors.
        setStore((s) => (s[ck]?.data ? s : { ...s, [ck]: { error: e instanceof Error ? e.message : String(e) } }));
      });
  }, [scopePin]);
  const ensure = useCallback((kind: DataKind, r: string, _rg: Range, eff: Eff) => { void load(kind, r, eff); }, [load]);

  // The active body (sub-tab aware) and the payload it reads. The hub reads "money".
  // Resolved HERE (not further down) because the body — and therefore which payload gets
  // fetched — must follow the same "is this tab even usable in this period" rule the strip does.
  const subUsableEarly = (t: SubTab) => !t.needsDayGrain || DAY_GRAIN_RANGES.has(range);
  const tabsEarly = sel ? SUBTABS[sel] : [];
  const activeSubKeyEarly = tabsEarly.length
    ? ((tabsEarly.find((t) => t.key === sub && subUsableEarly(t)) ?? tabsEarly.find(subUsableEarly) ?? tabsEarly[0]).key)
    : "";
  const bodyKey: BodyKey = sel ? bodyKeyFor(sel, activeSubKeyEarly) : "sales";
  const activeKind: DataKind = sel ? BODY_KIND[bodyKey] : "money";
  const isDayKind = DAY_KINDS.has(activeKind);
  const fdate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const effLabel = isDayKind ? fdate(day) : range === "custom" ? `${fdate(cFrom)} – ${fdate(cTo)}` : rangeLabel(range);
  const isCustom = !isDayKind && range === "custom";
  const customOk = !isCustom || (cFrom <= cTo && !!cFrom && !!cTo);
  // Payments folds in discounts + cancellations (they read the "money" payload) as detail
  // overlays, so fetch that alongside the settlement payload when Payments is open.
  const needMoneyToo = sel === "payments";
  // Day summary also bundles that day's DISHES + BUSY HOURS (owner 2026-07-26: "in the daily
  // report there is no dish info — it should be added … all the report for that day"). Both
  // are fetched scoped to the SINGLE chosen day.
  // The day sheet's extras use the SAME business-day window as its money lines — a calendar
  // day here would put a 2am order's dish on a different sheet than its money.
  const dayEff: Eff = { range: "day", date: day };
  const dayKeyFor = (kind: DataKind) => keyOf(kind, rid, dayEff);
  useEffect(() => {
    if (!ready) return;
    if (isCustom && !customOk) return;                      // wait for a valid custom range
    ensure(activeKind, rid, range, effFor(activeKind, range));
    if (needMoneyToo) ensure("money", rid, range, effFor("money", range));
    if (sel === "daysummary") { ensure("dishes", rid, range, dayEff); ensure("hourly", rid, range, dayEff); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeKind, rid, range, day, cFrom, cTo, ensure, needMoneyToo, sel]);

  const entry = store[cacheKey(activeKind, rid, range)];
  const data = entry?.data;
  const moneyEntry = store[cacheKey("money", rid, range)];
  const dishesDay = store[dayKeyFor("dishes")]?.data;
  const hourlyDay = store[dayKeyFor("hourly")]?.data;
  // …and when the restaurant list could not be read at all, the name this device last saw beats
  // the generic fallback — the sheet is showing that restaurant's own saved figures, so it should
  // say whose they are.
  const restName = rid ? (rests.find((r) => r.id === rid)?.name ?? (savedName.current || "This restaurant")) : "All restaurants";
  // Charts follow the owner-panel THEME (green), not each restaurant's brand colour —
  // a brown/orange/red chart inside the green owner console read as a bug (owner 2026-07-25).
  const accent = "var(--accent)";
  const singleRest = !!rid;

  // Sub-tabs for the current report + the export meta for whatever sub-view is showing.
  // If the owner is ON the day-of-week tab and then picks "Today", don't leave him staring at a
  // disabled tab's empty card — the resolver above already slid him back to the first usable view.
  const subTabs = tabsEarly;
  const activeSubKey = activeSubKeyEarly;
  const activeSubLabel = subTabs.find((t) => t.key === activeSubKey)?.label ?? "";
  // `body` as well as `kind`: several bodies share one payload SHAPE (by-hour and times-of-day
  // are both "hourly"; day-of-week and average-bill are both "money"), and the export used to
  // branch on the shape alone — so it wrote the wrong report under the right heading.
  const exportMeta = { label: sel ? REPORTS[sel].label + (activeSubLabel ? ` · ${activeSubLabel}` : "") : "", kind: BODY_KIND[bodyKey], body: bodyKey };
  const exportCtx = data ? {
    meta: exportMeta, data, restName, periodLabel: effLabel, isTax: bodyKey === "tax", bucketLabel,
    extra: sel === "daysummary" ? dayExtraTables(dishesDay, hourlyDay) : undefined,
    // When the SERVER computed these figures — printed in the masthead beside "Generated <now>".
    asOf: entry?.cachedAt,
  } : null;

  // ── Freshness + Refresh (owner-panel sweep 2026-08-04) ──────────────────────
  // Every report here is served from the compute-on-view snapshot cache, which returns a
  // stored value HOWEVER OLD it is and only refreshes in the background — so the first open
  // of an idle key shows old figures. It was showing a day sheet of ₹12,285 while the live
  // number was ₹38,640, with nothing on the page to say so and no way to ask for the truth.
  // The owner dashboard has had "updated X ago" + Refresh since mig 196; this is the same
  // pattern, and it is the project rule ("the response carries cachedAt so the UI shows
  // updated X ago next to Refresh") plus the never-present-saved-data-as-live rule.
  const [refreshing, setRefreshing] = useState(false);
  const [briefTick, setBriefTick] = useState(0);
  // Re-render once a minute so "updated 4 min ago" ages by itself instead of freezing.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAgeTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const shownCachedAt = entry?.cachedAt;
  /** Is there ANY settled payload on this device for what he is looking at? Decides which of the
   *  two sentences the no-internet note shows — "this is not current" vs "there is nothing yet". */
  const haveSaved = useMemo(() => Object.values(store).some((e) => !!e?.data), [store]);
  const refreshNow = () => {
    if (refreshing) return;
    setRefreshing(true);
    const started = Date.now();
    const jobs = [load(activeKind, rid, effFor(activeKind, range), true)];
    if (needMoneyToo) jobs.push(load("money", rid, effFor("money", range), true));
    if (sel === "daysummary") { jobs.push(load("dishes", rid, dayEff, true), load("hourly", rid, dayEff, true)); }
    setBriefTick((n) => n + 1);
    Promise.allSettled(jobs).finally(() => {
      // hold the spinner ~400ms minimum so a fast answer still reads as "it did something"
      setTimeout(() => setRefreshing(false), Math.max(0, 400 - (Date.now() - started)));
    });
  };

  // ── Print ask-dialog (owner 2026-07-26: "when you click print it should autofill the date
  // you're on, with Today/Yesterday quick options — and for ranged reports ask from which to
  // which date"). Confirming with the SAME period prints at once; picking another date/range
  // first applies it (same controls as on screen), waits for that data, THEN prints.
  const [printAsk, setPrintAsk] = useState(false);
  const [pdDay, setPdDay] = useState(day);                 // dialog's day (day-kind reports)
  const [pdFrom, setPdFrom] = useState("");                // dialog's from/to (ranged reports)
  const [pdTo, setPdTo] = useState("");
  const [printWhenReady, setPrintWhenReady] = useState(false);
  // What the screen was showing BEFORE the print dialog changed it. Confirming the dialog with
  // other dates used to switch the page to a custom range and leave it there, so the owner
  // printed last month and then kept reading what he thought was the 30-day view
  // (T5 sweep, 2026-08-06). We put it back once the sheet is out.
  const restoreAfterPrint = useRef<{ range: Range; cFrom: string; cTo: string; day: string } | null>(null);
  // printSection() answers FALSE when the browser refused the pop-up. This page always routes
  // Print through its own ask-the-date dialog, so it — not SectionExport — is the place that has
  // to say so; without this the Print button did nothing at all, silently (found 2026-08-04).
  const [printErr, setPrintErr] = useState<string | null>(null);
  const tryPrint = (ctx: Parameters<typeof printSection>[0]) => { setPrintErr(printSection(ctx) ? null : POPUP_BLOCKED); };
  const openPrintAsk = () => {
    setPdDay(day);
    const w = rangeDates(range, cFrom, cTo);
    setPdFrom(w.from); setPdTo(w.to);
    setPrintAsk(true);
  };
  const confirmPrint = () => {
    setPrintAsk(false);
    setPrintErr(null);
    if (isDayKind) {
      if (pdDay === day) { if (exportCtx) tryPrint(exportCtx); return; }
      restoreAfterPrint.current = { range, cFrom, cTo, day };
      setDay(pdDay); setPrintWhenReady(true);
    } else {
      const cur = rangeDates(range, cFrom, cTo);
      if (pdFrom === cur.from && pdTo === cur.to) { if (exportCtx) tryPrint(exportCtx); return; }
      restoreAfterPrint.current = { range, cFrom, cTo, day };
      setRange("custom"); setCFrom(pdFrom); setCTo(pdTo); setPrintWhenReady(true);
    }
  };
  // Print as soon as the newly-picked period's data (and the day sheet's extras) settle.
  const extrasSettled = sel !== "daysummary" ||
    ((): boolean => { const d = store[dayKeyFor("dishes")], h = store[dayKeyFor("hourly")]; return !!(d && !d.loading && (d.data || d.error)) && !!(h && !h.loading && (h.data || h.error)); })();
  useEffect(() => {
    if (!printWhenReady || !exportCtx || entry?.loading || !extrasSettled) return;
    setPrintWhenReady(false);
    tryPrint(exportCtx);
    // …and hand the screen back exactly as he left it (the sheet is already built from the
    // period he chose, so restoring cannot change what came out of the printer).
    const back = restoreAfterPrint.current;
    restoreAfterPrint.current = null;
    if (back) { setRange(back.range); setCFrom(back.cFrom); setCTo(back.cTo); setDay(back.day); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printWhenReady, data, entry?.loading, extrasSettled]);
  useBackClose("owner-print-ask", printAsk, () => setPrintAsk(false));
  // …and Escape. The detail overlay and the dashboard drawer both close on it, so leaving this
  // one out meant the habit that works everywhere else silently did nothing here (T5 sweep,
  // 2026-08-11).
  useEffect(() => {
    if (!printAsk) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPrintAsk(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [printAsk]);

  // ── ONE breadcrumb (owner 2026-07-26: "not two different paths — on the top only") ──
  // Feed the SCOPE ("All restaurants" or the picked restaurant — owner: "beside Reports it
  // should be written All restaurants in the path") plus the open report / sub-tab / overlay
  // into the SHELL's single top path — Owner › Reports › Green Bowl › Sales › Revenue — and
  // drop the page's own second crumb row. Cleared on unmount so the path always mirrors here.
  const payLabel = payDetail === "discounts" ? "Discounts" : payDetail === "cancellations" ? "Cancellations" : "";
  const scopeCrumb = rid ? restName : rests.length > 1 ? "All restaurants" : "";
  useEffect(() => {
    const tail = [
      ...(scopeCrumb ? [scopeCrumb] : []),
      ...(sel ? [REPORTS[sel].label, ...(activeSubLabel ? [activeSubLabel] : []), ...(payLabel ? [payLabel] : [])] : []),
    ];
    window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail } }));
    return () => { window.dispatchEvent(new CustomEvent("lfh:owner-crumb", { detail: { tail: [] } })); };
  }, [sel, activeSubLabel, payLabel, scopeCrumb]);

  return (
    <div className="rs-root">
      <ReportsStyles />

      {/* THE NOTE AT THE TOP (owner, 2026-08-30 — item 5). Two sentences at most, and the second
          one only when there is really something saved to look at. */}
      {noSignal && (
        <div className="rs-offnote" role="status">
          <i className="fas fa-wifi" aria-hidden />
          <span>
            <b>The internet is not available.</b>{" "}
            {haveSaved
              ? <>This is not the current data — these are the figures saved on this device{shownCachedAt ? <>, from {timeAgo(shownCachedAt)}</> : null}.</>
              : <>Nothing has been saved on this device for this period yet, so there is nothing to show.</>}
          </span>
          <button className="rs-btn" onClick={refreshNow} disabled={refreshing}>
            <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} aria-hidden /> Try again
          </button>
        </div>
      )}

      <div className="rs-head">
        <div>
          {/* The path lives ONCE in the shell's top strip (Owner › Reports › …) — no second
              crumb row here (owner 2026-07-26). A report just shows a back link; its title is
              the rs-rtitle below. The hub shows the section heading. */}
          {sel ? (
            <button className="rs-back" onClick={backToHub}><i className="fas fa-arrow-left" aria-hidden /> All reports</button>
          ) : (
            <>
              <h1 className="rs-h1">Reports</h1>
              <p className="rs-sub">Every report you need, on demand — pick one, choose a period, then print or download it.</p>
            </>
          )}
        </div>
      </div>

      <div className="rs-controls">
        {rests.length > 1 && (
          <select className="rs-select" value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Restaurant">
            <option value="">All restaurants</option>
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        {/* Day summary is ONE day → a date control, never a 7d/30d toggle (owner round-6). */}
        {isDayKind ? (
          <div className="rs-seg" role="group" aria-label="Day">
            <button aria-pressed={day === istToday()} className={day === istToday() ? "on" : ""} onClick={() => setDay(istToday())}>Today</button>
            <button aria-pressed={day === yesterdayIso()} className={day === yesterdayIso() ? "on" : ""} onClick={() => setDay(yesterdayIso())}>Yesterday</button>
            <input type="date" className="rs-date" value={day} max={istToday()} onChange={(e) => setDay(e.target.value)} aria-label="Pick a date" />
          </div>
        ) : (
          <PeriodDrop value={range} onChange={setRange} />
        )}
        {isCustom && (
          <div className="rs-custom">
            <input type="date" className="rs-date" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} aria-label="From date" />
            <i className="fas fa-arrow-right" aria-hidden />
            <input type="date" className="rs-date" value={cTo} min={cFrom} max={istCalToday()} onChange={(e) => setCTo(e.target.value)} aria-label="To date" />
          </div>
        )}
        {/* How old are the figures on screen, and how to ask for live ones. Sits next to the
            period control on BOTH the hub and an open report — the numbers are snapshot-served
            in both places. */}
        <span className="rs-fresh">
          <button type="button" className="rs-btn" onClick={refreshNow} disabled={refreshing}
            title="Refresh now — recomputes the live numbers">
            <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} aria-hidden /> Refresh
          </button>
          {shownCachedAt && !refreshing && (
            <span className="rs-fresh-t" title={`Figures computed ${new Date(shownCachedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: TZ })}`}>
              updated {timeAgo(shownCachedAt)}
            </span>
          )}
        </span>
        {sel ? (
          /* Phase 3: professional section-scoped Print / CSV / Excel (was a raw CSV +
             UI print). Builds a clean standalone document for THIS report + period. */
          <div className="rs-actions">
            {exportCtx && <SectionExport filename={`${exportMeta.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${isDayKind ? day : range === "custom" ? `${cFrom}_${cTo}` : range}-${new Date().toISOString().slice(0, 10)}`}
              ctx={exportCtx} onPrintClick={openPrintAsk} />}
          </div>
        ) : (
          /* On the hub: the SAME ask-first compiled statement as the dashboard's Report
             button (owner round-6: "the main section will have the same report as the
             dashboard"). Generates billing + GST + settlement + per-restaurant sections. */
          <div className="rs-actions">
            <ReportMenu filename={`aevidine-report-${new Date().toISOString().slice(0, 10)}`}
              gather={(qs, label) => gatherOwnerReport({ restaurants: rests, activeRid: rid || null, scopePin, asSuffix: asSuffix(), periodQs: qs, periodLabel: label })} />
          </div>
        )}
      </div>

      {printErr && (
        <div className="rs-note" role="status" style={{ display: "flex", alignItems: "center", gap: 9, margin: "0 0 12px",
          border: "1px solid var(--adm-warn, #d97706)", borderRadius: 10, padding: "9px 12px", color: "var(--text)" }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn, #d97706)" }} aria-hidden />
          <span style={{ flex: 1 }}>{printErr}</span>
          <button className="rs-btn" onClick={() => setPrintErr(null)}>OK</button>
        </div>
      )}
      {/* Sub-tab strip — the merge (owner 2026-07-26): one report, several views, no hop. */}
      {sel && subTabs.length > 0 && (
        <div className="rs-subtabs" role="tablist" aria-label={`${REPORTS[sel].label} views`}>
          {subTabs.map((t) => {
            const off = !!t.needsDayGrain && !DAY_GRAIN_RANGES.has(range);
            return (
              <button key={t.key} role="tab" aria-selected={t.key === activeSubKey} disabled={off}
                title={off ? "Needs a period made of whole days — try 7 days, 30 days, this or last month." : t.hint}
                className={"rs-subtab" + (t.key === activeSubKey ? " on" : "") + (off ? " off" : "")}
                onClick={() => !off && setSub(t.key)}>
                <i className={`fas ${t.icon}`} aria-hidden /> {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Print ask-dialog: confirm/adjust the period, then it prints (waits for fresh data). */}
      {printAsk && (
        <div className="rs-ovl" role="dialog" aria-modal="true" aria-label="Print this report" onClick={(e) => { if (e.target === e.currentTarget) setPrintAsk(false); }}>
          <div className="rs-ovl-card" style={{ width: "min(440px, 100%)" }}>
            <header className="rs-ovl-h"><b><i className="fas fa-print" aria-hidden style={{ marginRight: 8, color: "var(--accent)" }} />Print {sel ? REPORTS[sel].label : "report"}</b>
              <button className="rs-ovl-x" onClick={() => setPrintAsk(false)} aria-label="Close"><i className="fas fa-xmark" aria-hidden /></button>
            </header>
            <div className="rs-ovl-b">
              {isDayKind ? (
                <>
                  <p className="rs-note" style={{ margin: "0 0 10px" }}>Which day should the printed sheet cover?</p>
                  <div className="rs-seg" role="group" aria-label="Print day" style={{ marginBottom: 14 }}>
                    <button aria-pressed={pdDay === istToday()} className={pdDay === istToday() ? "on" : ""} onClick={() => setPdDay(istToday())}>Today</button>
                    <button aria-pressed={pdDay === yesterdayIso()} className={pdDay === yesterdayIso() ? "on" : ""} onClick={() => setPdDay(yesterdayIso())}>Yesterday</button>
                    <input type="date" className="rs-date" value={pdDay} max={istToday()} onChange={(e) => setPdDay(e.target.value)} aria-label="Print date" />
                  </div>
                </>
              ) : (
                <>
                  <p className="rs-note" style={{ margin: "0 0 10px" }}>Print the report from which date to which date?</p>
                  <div className="rs-custom" style={{ marginBottom: 14 }}>
                    <input type="date" className="rs-date" value={pdFrom} max={pdTo} onChange={(e) => setPdFrom(e.target.value)} aria-label="Print from date" />
                    <i className="fas fa-arrow-right" aria-hidden />
                    <input type="date" className="rs-date" value={pdTo} min={pdFrom} max={istCalToday()} onChange={(e) => setPdTo(e.target.value)} aria-label="Print to date" />
                  </div>
                </>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="rs-btn" onClick={() => setPrintAsk(false)}>Cancel</button>
                <button className="rs-btn cta" onClick={confirmPrint}><i className="fas fa-print" aria-hidden /> Print</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {!sel ? (
        <Hub range={range} money={entry} restName={restName} accent={accent} onOpen={openReport}
          rests={rests} rid={rid} onPickRest={setRid} hasPayroll={hasPayroll} hasInventory={hasInventory} briefTick={briefTick}
          blank={noSignal && !entry?.data}
          briefQs={`type=byrestaurant&range=${range}${range === "custom" ? `&from=${cFrom}&to=${cTo}` : ""}${scp}`} />
      ) : (
        <ReportView sel={sel} bodyKey={bodyKey} data={data} loading={entry?.loading} error={entry?.error}
          rangeText={effLabel} accent={accent} restName={restName} singleRest={singleRest}
          onOpenReport={openReport} payDetail={payDetail} onPayDetail={setPayDetail}
          moneyData={moneyEntry?.data} dishesDay={dishesDay} hourlyDay={hourlyDay} asOf={entry?.cachedAt}
          onRetry={refreshNow} retrying={refreshing} />
      )}
    </div>
  );
}

// ── The hub: hero snapshot + per-restaurant brief + categorised report cards ──
function Hub({ range, money, restName, accent, onOpen, rests, rid, onPickRest, briefQs, hasPayroll, hasInventory, briefTick, blank }: {
  range: Range; money?: Entry; restName: string; accent: string; onOpen: (k: RKey) => void;
  rests: Rest[]; rid: string; onPickRest: (id: string) => void; briefQs: string;
  /** No connection AND nothing saved for this period. A dash, never a ₹0 — the owner asked for
   *  "just say there is no internet", and a confident ₹0 is the opposite of saying that
   *  (owner, 2026-08-30). The note at the top of the page carries the explanation. */
  blank?: boolean;
  briefTick: number;   // bumped by Refresh so the per-restaurant brief re-reads too
  hasPayroll: boolean;   // mig 220 — hides the Team & pay card when the module is off
  hasInventory: boolean; // migs 221/224/227 — hides the Inventory & stock card when the module is off
}) {
  // Per-restaurant brief (owner 2026-07-26: "in the all-restaurants view there will be a
  // brief report about all the restaurants"). Fetched only when viewing ALL of a
  // multi-restaurant estate; clicking a card scopes the whole page to that restaurant.
  // Last result is kept per-query in a module map so returning from a report re-paints the
  // brief at the SAME height instantly (no fetch gap that would shift the restored scroll),
  // then the refetch swaps in anything newer.
  const showBrief = !rid && rests.length > 1;
  const [brief, setBrief] = useState<{ id: string; name: string; accent: string; revenue: number; orders: number }[] | null>(
    () => (showBrief && briefMemo.get(briefQs)) || null);
  // Which `briefTick` we have already answered with a FORCED read — see the effect below.
  const forcedTick = useRef(0);
  useEffect(() => {
    if (!showBrief) { setBrief(null); return; }
    let live = true;
    // REFRESH HAS TO REACH THESE CARDS TOO (T11 sweep, 2026-08-17 — sweep #5 F7).
    // Every other fetch in refreshNow() passes `force`, which sends ?refresh=1 and makes the
    // server recompute live instead of answering from the snapshot cache. This one only had
    // its `briefTick` bumped, so it re-requested the SAME cached key: the big headline and the
    // five KPI columns above updated to the live figures while the "By restaurant" cards
    // underneath kept figures up to five minutes old (older still on an idle key) — so the
    // cards stopped adding up to the headline, right after he pressed the button whose whole
    // job is to give him the live numbers.
    //
    // Only the tick Refresh has just bumped forces a recompute. A later period change re-runs
    // this effect with the same tick, and that must stay an ordinary cached read — forcing on
    // every subsequent period change would make each one pay for a live recompute of the whole
    // estate, which is the cost this snapshot cache exists to avoid.
    const force = briefTick > 0 && forcedTick.current !== briefTick;
    if (force) forcedTick.current = briefTick;
    // The MEMO stays keyed on the plain query string, so the instant-repaint on the way back
    // from a report still finds it whether the last read was forced or not.
    fetch(`/api/owner/reports?${briefQs}${force ? "&refresh=1" : ""}`, { cache: "no-store" }).then((r) => r.json())
      .then((d) => { if (Array.isArray(d.rows)) { briefMemo.set(briefQs, d.rows); if (live) setBrief(d.rows); } }).catch(() => {});
    return () => { live = false; };
  }, [showBrief, briefQs, briefTick]);
  const briefMax = brief && brief.length ? Math.max(...brief.map((b) => b.revenue), 1) : 1;

  const t = money?.data?.totals;
  const rows = (money?.data?.rows ?? []) as MoneyRow[];
  const bucket = money?.data?.bucket || "day";
  // Auto-drill: when only one day/month had activity the server returns a finer
  // hourly/daily series so the chart fills instead of showing a lonely bar.
  const drill = (money?.data?.drillRows ?? []) as MoneyRow[];
  const chartBucket = money?.data?.drillBucket || bucket;
  const chartRows = drill.length ? drill : rows;
  const series = chartRows.map((r) => ({ label: bucketLabel(r.bucket, chartBucket), value: r.revenue }));
  const avg = t && t.paidOrders ? t.revenue / t.paidOrders : 0;
  const loading = money?.loading;
  return (
    <>
      {/* Overview: the animated headline + KPIs and the revenue chart, together in one panel.
          The chart is CONTAINED here (the old hero re-used the dashboard's corner-Spark, whose
          global `.owx-spark{position:absolute}` yanked it to the page corner — the "stray graph"). */}
      <div className="rs-overview">
        <div className="rs-ov-eyebrow">{restName} · {rangeLabel(range)}</div>
        <div className="rs-ov-val">{blank ? <span className="rs-ov-dash">—</span> : <AnimatedNumber value={t?.revenue || 0} money loading={loading} />}</div>
        <div className="rs-ov-sub">Total collected this period — GST included{money?.error && !blank ? " — couldn't load" : ""}</div>
        <div className="rs-ov-kpis">
          <div className="k"><span className="lbl">Net sales</span><span className="v">{blank ? "—" : <AnimatedNumber value={Math.max(0, (t?.subtotal || 0) - (t?.discount || 0))} money loading={loading} />}</span></div>
          <div className="k"><span className="lbl">Paid bills</span><span className="v">{blank ? "—" : <AnimatedNumber value={t?.paidOrders || 0} format={nfmt} loading={loading} />}</span></div>
          <div className="k"><span className="lbl">Avg bill</span><span className="v">{blank ? "—" : <AnimatedNumber value={avg} money loading={loading} />}</span></div>
          <div className="k"><span className="lbl">GST collected</span><span className="v">{blank ? "—" : <AnimatedNumber value={t?.tax || 0} money loading={loading} />}</span></div>
          <div className="k"><span className="lbl">Discounts</span><span className="v">{blank ? "—" : <AnimatedNumber value={t?.discount || 0} money loading={loading} />}</span></div>
        </div>
        <div className="rs-ov-chart">
          {/* With no connection and nothing saved, "Not enough data yet — come back once there's a
              bit more" is a sentence about the RESTAURANT, and it is not true. Draw nothing and let
              the note at the top of the page be the only thing that speaks (owner, 2026-08-30). */}
          {blank
            ? <div className="rs-ov-blank" aria-hidden />
            : loading
              ? <div className="rs-ov-skel" aria-hidden />
              : <ToggleChart data={series} color={accent} money height={210} title="Revenue over the period" />}
        </div>
      </div>

      {showBrief && brief && brief.length > 0 && (
        <div>
          <div className="rs-catrow">
            <span className="ic"><i className="fas fa-trophy" aria-hidden /></span>
            <b>By restaurant</b><span className="n">{brief.length}</span>
          </div>
          <p className="rs-sub" style={{ margin: "0 2px 12px" }}>Total collected per restaurant this period — tap one to see just its reports.</p>
          <div className="rs-brief">
            {brief.map((b, i) => (
              <button key={b.id} className="rs-brief-card" onClick={() => onPickRest(b.id)} title={`See ${b.name}'s reports`}>
                <div className="rs-brief-top">
                  <span className="sw" style={{ background: b.accent || "var(--accent)" }} aria-hidden />
                  <span className="nm">{b.name}</span>
                  <span className="rk">#{i + 1}</span>
                </div>
                <div className="rs-brief-v">{inr(b.revenue)}</div>
                <div className="rs-brief-sub">{nfmt(b.orders)} order{b.orders === 1 ? "" : "s"}</div>
                <div className="rs-brief-bar"><span style={{ width: `${Math.max(3, (b.revenue / briefMax) * 100)}%` }} /></div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* A restaurant without the Staff-profiles-&-pay module doesn't get the Team card at
          all — no dead tile that opens onto "not enabled". */}
      {CATEGORIES.filter((cat) => (cat.key !== "team" || hasPayroll) && (cat.key !== "inventory" || hasInventory)).map((cat) => (
        <div key={cat.key}>
          <div className="rs-catrow">
            <span className="ic"><i className={`fas ${cat.icon}`} aria-hidden /></span>
            <b>{cat.label}</b><span className="n">{cat.keys.length}</span>
          </div>
          <div className="rs-cards">
            {cat.keys.map((k) => {
              const m = REPORTS[k];
              return (
                <button key={k} className={`rs-card tone-${m.tone || "accent"}`} onClick={() => onOpen(k)}>
                  <span className="cic"><i className={`fas ${m.icon}`} aria-hidden /></span>
                  <span className="ct"><b>{m.label}</b><p>{m.blurb}</p></span>
                  <i className="fas fa-arrow-right go" aria-hidden />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

// ── The report view (title + loading/error, delegates body) ───────────────────
function ReportView({ sel, bodyKey, data, loading, error, rangeText, accent, restName, singleRest, onOpenReport, payDetail, onPayDetail, moneyData, dishesDay, hourlyDay, asOf, onRetry, retrying }: {
  sel: RKey; bodyKey: BodyKey; data?: Payload; loading?: boolean; error?: string;
  rangeText: string; accent: string; restName: string; singleRest: boolean;
  asOf?: string; onRetry?: () => void; retrying?: boolean;
  onOpenReport: OpenReport;
  payDetail: "" | "discounts" | "cancellations"; onPayDetail: (d: "" | "discounts" | "cancellations") => void;
  moneyData?: Payload; dishesDay?: Payload; hourlyDay?: Payload;
}) {
  const meta = REPORTS[sel];
  const tone = meta.tone || "accent";
  return (
    <div className={`rs-report tone-${tone}`} id="rs-print">
      <PrintHead restName={restName} title={meta.label} period={rangeText} asOf={asOf} />
      <div className="rs-rtitle">
        <span className="cic"><i className={`fas ${meta.icon}`} aria-hidden /></span>
        <div><h2>{meta.label}</h2><div className="scope">{restName} · {rangeText}</div></div>
      </div>
      {error ? (
        <Panel><div className="rs-empty">
          <i className="fas fa-triangle-exclamation" aria-hidden />{error}
          {/* A failed fetch used to sit there until the period changed. Refresh always worked —
              nothing said so (T5 sweep, 2026-08-06). */}
          {onRetry && (
            <div style={{ marginTop: 14 }}>
              <button className="rs-btn cta" onClick={onRetry} disabled={retrying}>
                <i className={`fas fa-rotate-right${retrying ? " fa-spin" : ""}`} aria-hidden /> Try again
              </button>
            </div>
          )}
        </div></Panel>
      ) : loading || !data ? (
        <div className="rs-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="rs-stat tone-accent" style={{ opacity: .5 }}><div className="rs-stat-k">Loading…</div><div className="rs-stat-v">—</div></div>)}</div>
      ) : (
        <ReportBody bk={bodyKey} data={data} accent={accent} singleRest={singleRest} onOpenReport={onOpenReport}
          onPayDetail={onPayDetail} dishesDay={dishesDay} hourlyDay={hourlyDay} rangeText={rangeText} />
      )}
      {/* The same closing note the Export → Print document carries, so Ctrl+P and the Print
          button hand over the same sheet (T5 sweep, 2026-08-06). */}
      <PrintFoot />
      {/* Discount / cancellation DETAIL overlay opened from a Payments KPI box (owner: a
          popup, not a whole extra sub-report). Reads the money payload. */}
      {sel === "payments" && payDetail && (
        <ReportOverlay title={payDetail === "discounts" ? "Discounts given" : "Cancellations"} onClose={() => onPayDetail("")}>
          {moneyData
            ? <ReportBody bk={payDetail} data={moneyData} accent={accent} singleRest={singleRest} onOpenReport={onOpenReport} onPayDetail={onPayDetail} />
            : <div className="rs-kpis">{[0, 1, 2].map((i) => <div key={i} className="rs-stat tone-accent" style={{ opacity: .5 }}><div className="rs-stat-k">Loading…</div><div className="rs-stat-v">—</div></div>)}</div>}
        </ReportOverlay>
      )}
    </div>
  );
}

// A full-page detail overlay (owner 2026-07-26: "make a whole popup … you don't have to make
// a whole sub-report"). Registered as a back layer so hardware/browser Back closes it first.
function ReportOverlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useBackClose("owner-report-detail", true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="rs-ovl" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rs-ovl-card">
        <header className="rs-ovl-h">
          <b>{title}</b>
          <button className="rs-ovl-x" onClick={onClose} aria-label="Close"><i className="fas fa-xmark" aria-hidden /></button>
        </header>
        <div className="rs-ovl-b">{children}</div>
      </div>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <Panel><div className="rs-empty"><i className="fas fa-inbox" aria-hidden />{text}</div></Panel>;
}

function ReportBody({ bk, data, accent, singleRest, onOpenReport, onPayDetail, dishesDay, hourlyDay, rangeText = "" }: { bk: BodyKey; data: Payload; accent: string; singleRest: boolean; onOpenReport: OpenReport; onPayDetail?: (d: "" | "discounts" | "cancellations") => void; dishesDay?: Payload; hourlyDay?: Payload; rangeText?: string }) {
  // ── INVENTORY & STOCK (mig 227) ─────────────────────────────────────────────
  // Five sub-tabs, one payload. Rendered before the money plumbing below because these
  // bodies read `summary`/`items`/`dishes`, not the bucketed money rows. A payload that
  // hasn't got a summary yet (module just switched on, nothing recorded) still renders —
  // the components handle empty lists with their own plain-language empty states.
  if (bk === "invstock" || bk === "invpurchases" || bk === "invusage" || bk === "invwaste" || bk === "invexpenses") {
    if (!data.summary || !data.coverage) return <EmptyCard text="No stock data for this period yet." />;
    const d: InvPayload = {
      summary: data.summary, coverage: data.coverage, costDataFrom: data.costDataFrom ?? null,
      dishes: data.dishes ?? [], items: data.items ?? [], vendors: data.vendors ?? [],
      series: data.series ?? [], expenses: data.expenses ?? [], waste: data.waste ?? [],
      merged: data.merged, perRestaurant: data.perRestaurant,
      listCap: data.listCap, expensesMore: data.expensesMore, wasteMore: data.wasteMore,
    };
    return (
      <>
        <InvReportStyles />
        {bk === "invstock" && <InvStockReport d={d} />}
        {bk === "invpurchases" && <InvPurchasesReport d={d} accent={accent} rangeText={rangeText} />}
        {bk === "invusage" && <InvUsageReport d={d} />}
        {bk === "invwaste" && <InvWasteReport d={d} />}
        {bk === "invexpenses" && <InvExpensesReport d={d} />}
      </>
    );
  }
  const bucket = data.bucket || "day";
  const t = data.totals;
  const mrows = (data.rows ?? []) as MoneyRow[];
  // Charts read the auto-drilled finer series when the server sent one (one active
  // day/month → hourly/daily), so a single-bar period fills out. KPI cards + the
  // GST-style tables keep using the daily `mrows`/`bucket` untouched.
  const chartBucket = data.drillBucket || bucket;
  // The "best/worst" panels + "busiest …" labels describe the CHART series, which may
  // be auto-drilled (a single day → hourly). Label them by the CHART's grain, not the
  // un-drilled window — otherwise a single day's hourly chart reads "Best DAY: 1 pm"
  // instead of "Best HOUR: 1 pm" (owner round-6, phase-4 review).
  const chartUnit: "month" | "hour" | "day" = chartBucket === "month" ? "month" : chartBucket === "hour" ? "hour" : "day";
  // rowUnit describes the TABLE/mrows grain (day / month / hour) — used by the money
  // reports whose day-level analysis reads mrows directly (discounts, cancellations),
  // so a 12-month view says "month" and a today view says "hour", not always "day".
  const rowUnit: "month" | "hour" | "day" = bucket === "month" ? "month" : bucket === "hour" ? "hour" : "day";
  const RowUnit = rowUnit[0].toUpperCase() + rowUnit.slice(1);
  const drillRows = (data.drillRows as MoneyRow[] | undefined) ?? [];
  const chartRows = drillRows.length ? drillRows : mrows;
  const cser = (pick: (r: MoneyRow) => number) => chartRows.map((r) => ({ label: bucketLabel(r.bucket, chartBucket), value: pick(r) }));
  const series = chartRows.map((r) => ({ label: bucketLabel(r.bucket, chartBucket), revenue: r.revenue }));

  // ── THE LAST BUCKET OF A "…TO NOW" WINDOW IS STILL RUNNING ─────────────────────────────
  // Every ranged report ends at `now`, so its final day (or hour, or month) is only part
  // finished. Handed to BestWorst unchanged, that half-day always won "Quietest day" and
  // dragged the trend pill down with it — measured live on Sales · 30 days: "QUIETEST DAY ·
  // 6 Aug · ₹5,124 · 0% of the period", where 6 Aug was today with one order so far, under a
  // pill reading "Trending down · 34%" (T5 sweep, 2026-08-06). The dashboard's month-compare
  // card already refuses to plot today for exactly this reason and says so in a caption; the
  // Studio's best/quietest panel never got the same treatment. The CHART still draws every
  // bucket — only the ranking and the trend leave the unfinished one out, and say they did.
  const IST_MS = 5.5 * 3600_000;
  const stampLen = chartBucket === "month" ? 7 : chartBucket === "hour" ? 13 : 10;
  const istStamp = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, stampLen);
  const lastBucket = chartRows.length ? chartRows[chartRows.length - 1].bucket : null;
  const lastIsRunning = !!lastBucket && chartRows.length > 1
    && istStamp(Date.parse(String(lastBucket))) === istStamp(Date.now());
  /** The series minus its still-running final bucket — for rankings, never for the chart. */
  const settled = <T,>(arr: T[]): T[] => (lastIsRunning && arr.length > 1 ? arr.slice(0, -1) : arr);

  // ── TEAM & PAY (mig 220) ────────────────────────────────────────────────────
  // TWO money truths, deliberately labelled as such (owner's choice 2026-07-29):
  //   CASH  — what left the till on the day it left. Matches the day book.
  //   COST  — what a month's team was worth vs what was paid for that month.
  // A salary is lumpy (one big day), so showing only the cash view makes pay-day look like a
  // disaster; showing only the cost view hides when money actually moved. Hence both.
  if (bk === "staffpay") {
    const cash = (data.cashRows ?? []) as { bucket: string; paid_out: number; people: number; entries: number }[];
    const months = (data.monthRows ?? []) as { bucket: string; expected: number; paid: number; owed: number; people: number; est_excluded: number }[];
    const people = (data.people ?? []) as { staff_id: string; name: string; role: string; designation: string | null; pay_type: string | null; pay_amount: number; paid: number; salary: number; advance: number; bonus: number; overtime: number; other: number; advanceOutstanding: number; lastPaidOn: string | null; entries: number }[];
    const tt = (data.totals ?? {}) as { paidOut: number; expected: number; owed: number; people: number; advanceOutstanding: number; estExcluded: number };
    if (!people.length && !cash.length)
      return <EmptyCard text="No staff payments recorded in this period. Record one from Team & pay → open a person → Payments." />;
    const cashSeries = cash.map((r) => ({ label: bucketLabel(r.bucket, bucket === "month" ? "month" : "day"), value: r.paid_out }));
    // "July 2026" or "Jul–Sep 2026" — whichever months the cost figures actually cover
    const mLabel = (bkt: string) => new Date(bkt).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: TZ });
    const monthSpan = months.length === 0 ? "" : months.length === 1 ? mLabel(months[0].bucket)
      : `${mLabel(months[0].bucket)} – ${mLabel(months[months.length - 1].bucket)}`;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Paid out" value={inr(tt.paidOut || 0)} sub="money that actually left" tone="bad" icon="fa-arrow-up-from-bracket" big />
          {/* Cost and owed describe whole MONTHS, while "Paid out" describes the chosen range —
              so on a short range (a day, a week) they must NAME the month or they read as if
              you owe a month's wages today (found in the 2026-07-30 sweep). */}
          <Stat label="Team cost" value={inr(tt.expected || 0)} tone="info" icon="fa-scale-balanced"
            sub={monthSpan ? `${monthSpan} · what the month${months.length > 1 ? "s" : ""} ${months.length > 1 ? "are" : "is"} worth` : "what these months were worth"} />
          <Stat label="Still owed" value={inr(tt.owed || 0)} tone={tt.owed ? "warn" : "good"} icon="fa-hourglass-half"
            sub={tt.owed ? (monthSpan ? `still to pay for ${monthSpan}` : "not yet paid for those months") : "nothing pending"} />
          <Stat label="Advances out" value={inr(tt.advanceOutstanding || 0)} sub="to recover from later salary" tone={tt.advanceOutstanding ? "warn" : "good"} icon="fa-hand-holding-dollar" />
          <Stat label="People paid" value={nfmt(tt.people || 0)} sub="in this period" tone="accent" icon="fa-users" />
        </div>

        <Panel title="Cash view — the day the money left" hint="This is the line that shows in your day book as money out." id="team-cash">
          {cashSeries.filter((d) => d.value > 0).length < 2
            ? <div className="rs-empty">
                {cashSeries.length === 1
                  ? <>Only one payment day in this period: <b>{cashSeries[0].label} · {inr(cashSeries[0].value)}</b>. A chart needs at least two.</>
                  : <>No payments in this period.</>}
              </div>
            : <div style={{ padding: 12 }}><ToggleChart data={cashSeries} color={accent} money height={230} name="Paid out" /></div>}
        </Panel>

        <Panel title="Cost view — what each month was worth" hint="Salary due for that month vs what you have paid for it. People on a daily or hourly rate are left out of “worth” until attendance exists." id="team-cost">
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Month</th><th className="num">On pay list</th><th className="num">Team cost</th><th className="num">Paid for it</th><th className="num">Still owed</th></tr></thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.bucket}>
                    <td>{new Date(m.bucket).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: TZ })}</td>
                    <td className="num">{nfmt(m.people)}{m.est_excluded ? <span className="rs-mut"> +{m.est_excluded} hourly</span> : null}</td>
                    <td className="num">{inr(m.expected)}</td>
                    <td className="num" style={{ color: "var(--adm-ok)" }}>{inr(m.paid)}</td>
                    <td className="num" style={{ color: m.owed ? "var(--adm-warn)" : "var(--muted)" }}>{inr(m.owed)}</td>
                  </tr>
                ))}
                {!months.length && <tr><td colSpan={5} className="rs-mut">No months in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          {tt.estExcluded ? <div className="rs-note">{tt.estExcluded} {tt.estExcluded === 1 ? "person is" : "people are"} on a daily/hourly rate, so their cost can&apos;t be predicted without attendance — what you actually paid them IS included in “Paid for it”.</div> : null}
        </Panel>

        <Panel title="Who you paid" hint="Every person with money against them in this period." id="team-people">
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Person</th><th>Rate</th><th className="num">Salary</th><th className="num">Advance</th><th className="num">Bonus / OT</th><th className="num">Total paid</th><th className="num">Advance left</th><th>Last paid</th></tr></thead>
              <tbody>
                {people.map((r) => (
                  <tr key={r.staff_id}>
                    <td><b>{r.name}</b> <span className="rs-mut">{r.designation || (r.role === "tablet" ? "waiter" : r.role)}</span></td>
                    <td className="rs-mut">{r.pay_amount ? `${inr(r.pay_amount)}${r.pay_type === "monthly" ? "/mo" : r.pay_type === "daily" ? "/day" : r.pay_type === "hourly" ? "/hr" : ""}` : "not set"}</td>
                    <td className="num">{inr(r.salary)}</td>
                    <td className="num">{inr(r.advance)}</td>
                    <td className="num">{inr(r.bonus + r.overtime + r.other)}</td>
                    <td className="num"><b>{inr(r.paid)}</b></td>
                    <td className="num" style={{ color: r.advanceOutstanding ? "var(--adm-warn)" : "var(--muted)" }}>{inr(r.advanceOutstanding)}</td>
                    <td className="rs-mut">{r.lastPaidOn ? new Date(r.lastPaidOn + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── TEAM PERFORMANCE (mig 220) — owner-only leaderboard ─────────────────────
  if (bk === "staffperf") {
    const rows = (data.rows ?? []) as { staff_id: string; name: string; role: string; designation: string | null; active: boolean; daysActive: number; hours: number; orders: number; value: number; tables: number; sittings: number; discount: number; ratings: number; avgRating: number | null; paid: number }[];
    const tt = (data.totals ?? {}) as { people: number; active: number; orders: number; value: number; hours: number; paid: number };
    const worked = rows.filter((r) => r.daysActive > 0 || r.orders > 0);
    if (!worked.length)
      return <EmptyCard text="Nothing recorded for anyone in this period yet. Numbers build up as staff sign in and punch orders — work done before 29 Jul 2026 isn't attributed to a person." />;
    const bars = worked.slice(0, 12).map((r) => ({ id: r.staff_id, name: r.name, revenue: r.value, orders: r.orders, accentColor: accent }));
    return (
      <>
        <div className="rs-kpis">
          <Stat label="People working" value={nfmt(tt.active || 0)} sub={`of ${nfmt(tt.people || 0)} on the team`} tone="accent" icon="fa-users" big />
          <Stat label="Orders punched" value={nfmt(tt.orders || 0)} sub="by staff, not guests" tone="info" icon="fa-list-check" />
          <Stat label="Value punched" value={inr(tt.value || 0)} sub="what they put through" tone="good" icon="fa-indian-rupee-sign" />
          <Stat label="Hours on shift" value={nfmt(Math.round(tt.hours || 0))} sub="first to last action each day" tone="accent" icon="fa-clock" />
        </div>

        <Panel title="Who put through the most" hint="Value of the orders each person punched in this period." id="perf-leader">
          {bars.filter((b) => b.revenue > 0).length < 2
            ? <div className="rs-empty">Only one person has punched orders in this period ({bars[0]?.name} · {inr(bars[0]?.revenue || 0)}). A comparison needs two.</div>
            : <LeaderBar data={bars} valueLabel="Value punched" />}
        </Panel>

        <Panel title="Everyone, side by side" hint="Sorted by value punched. Ratings come from guests who rated an order that person took." id="perf-table">
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Person</th><th className="num">Days</th><th className="num">Hours</th><th className="num">Orders</th><th className="num">Value</th><th className="num">Tables</th><th className="num">Discount</th><th className="num">Rating</th><th className="num">Paid</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.staff_id} style={{ opacity: r.active ? 1 : 0.55 }}>
                    <td><b>{r.name}</b> <span className="rs-mut">{r.designation || (r.role === "tablet" ? "waiter" : r.role)}{r.active ? "" : " · disabled"}</span></td>
                    <td className="num">{nfmt(r.daysActive)}</td>
                    <td className="num">{r.hours ? r.hours.toFixed(1) : "—"}</td>
                    <td className="num">{nfmt(r.orders)}</td>
                    <td className="num"><b>{inr(r.value)}</b></td>
                    <td className="num">{nfmt(r.tables)}</td>
                    <td className="num">{r.discount ? inr(r.discount) : "—"}</td>
                    <td className="num">{r.avgRating ? `${r.avgRating}★` : "—"}<span className="rs-mut">{r.ratings ? ` (${r.ratings})` : ""}</span></td>
                    <td className="num">{inr(r.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rs-note">Days and hours come from sign-ins and actions; orders, value and tables from what each person punched. Anything done before 29 Jul 2026 has no person attached to it — the app only started recording who from then.</div>
        </Panel>
      </>
    );
  }

  // ── DAY SUMMARY ──
  if (bk === "daysummary") {
    if (!t) return <EmptyCard text="Nothing in this period yet." />;
    // MERGE by canonical method, don't just relabel (T11 sweep, 2026-08-17). The database
    // groups the settlement by the RAW `payment_method` string, so one method stored with two
    // casings arrives as two rows — French House really holds both "Cash" and "cash". This
    // line used to canonicalise the LABEL and stop there, so the 5 Aug 2026 sheet rendered
    //     Cash · 4% · 7 bills   ₹1,838
    //     Cash · 1% · 2 bills   ₹525
    // one directly above the other, with two shares and two bars for one pile of cash — and
    // because the row key IS the canonical name, React logged "two children with the same key"
    // and was free to drop or duplicate one of them. The Payments report (below, l.1885-1891)
    // and PaymentDonut have always merged; this panel is the one that never did, so the day
    // sheet disagreed with the full report one click away. Merge FIRST, then drop the empty
    // methods — otherwise a method split across two casings can be filtered out in halves.
    const payMerged = new Map<string, PayRow>();
    for (const p of data.payments || []) {
      const method = canonPayMethod(p.method);
      const row = payMerged.get(method) || { method, revenue: 0, orders: 0 };
      row.revenue += p.revenue; row.orders += p.orders;
      payMerged.set(method, row);
    }
    // Biggest first, which is both what the RPC's own `ORDER BY revenue DESC` intended and
    // what the Payments report shows — merging can reorder, so the sort is what keeps the two
    // screens reading the same way round.
    const pays = [...payMerged.values()].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const payTotal = pays.reduce((a, p) => a + p.revenue, 0);
    // Bills the settlement reported at all, including any whose amount came back as zero — this is
    // what tells an empty settlement apart from an unreadable one.
    const payBills = [...payMerged.values()].reduce((a, p) => a + (Number(p.orders) || 0), 0);
    const avg = t.paidOrders ? t.revenue / t.paidOrders : 0;
    // ONE meaning of "orders placed" for the whole console (T5 sweep, 2026-08-11). `t.orders`
    // is COUNT(*) WHERE status <> 'cancelled', so it leaves the voided ones out — this sheet
    // used it under the label "Orders placed" while the Order-volume report used
    // orders + cancelled under the identical label. Measured 3,839 here against 4,634 there,
    // same restaurant, same window. Placed means placed.
    const placed = t.orders + t.cancelledOrders;
    const stillOpen = Math.max(0, t.orders - t.paidOrders);
    // A day that has not started trading yet is a sentence, not eleven zeroes (T5 sweep).
    const nothingYet = placed === 0 && t.revenue === 0;
    // Split the WHOLE-RUPEE tax (GST returns round to the rupee): equal rates then always
    // show equal halves (₹81,369.50 each), and the lines sum exactly to the displayed
    // whole-rupee "GST collected" — no ₹163 parent over ₹81.25+81.25 children (audit 2026-07-27).
    const taxLines = data.tax
      ? splitTax(data.tax.components.map((c) => c.rate), Math.round(t.tax)).map((amt, i) => ({ label: data.tax!.components[i].label, rate: data.tax!.components[i].rate, amt }))
      : [];
    return (
      <>
        {nothingYet && (
          <p className="rs-note" style={{ marginTop: -2, marginBottom: 12 }}>
            <i className="fas fa-circle-info" aria-hidden style={{ color: "var(--accent)", marginRight: 6 }} />
            Nothing has been billed on this day yet — a restaurant&apos;s day runs from 5 am to 5 am, so
            anything served after midnight still counts on the day before. The sheet fills in as bills are paid.
          </p>
        )}
        <div className="rs-kpis">
          <Stat label="Total collected" tone="accent" icon="fa-indian-rupee-sign" big value={inr(t.revenue)} sub="everything guests paid — GST included" spark={series.map((s) => s.revenue)} />
          <Stat label="Net sales" tone="good" icon="fa-sack-dollar" value={inr(t.subtotal - t.discount)} sub="your earnings, before GST" />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} sub={`of ${nfmt(placed)} order${placed === 1 ? "" : "s"} placed`} />
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" value={inr(avg)} />
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" value={inr(t.tax)} onClick={() => onOpenReport("tax")} title="Open the Tax / GST report" />
          <Stat label="Cancelled" tone="bad" icon="fa-ban" value={nfmt(t.cancelledOrders)} sub={`${inr(t.cancelledValue)} lost`} onClick={() => onOpenReport("payments", { pay: "cancellations" })} title="Open the Cancellations report" />
          {/* STAFF PAY OUT (mig 220) — money that LEFT on this day, so the sheet shows both
              directions. Rendered only when the restaurant has the module (a null payload
              keeps the tile off entirely rather than printing a meaningless ₹0). */}
          {data.staffPay && (
            <Stat label="Staff pay out" tone="bad" icon="fa-arrow-up-from-bracket"
              value={inr(data.staffPay.paidOut)}
              sub={data.staffPay.entries ? `${nfmt(data.staffPay.entries)} payment${data.staffPay.entries === 1 ? "" : "s"} to ${nfmt(data.staffPay.people)} ${data.staffPay.people === 1 ? "person" : "people"}` : "nothing paid out"}
              onClick={() => onOpenReport("team")} title="Open the Team & pay report" />
          )}
          {/* TIPS COLLECTED (mig 154 stored them; mig 268 surfaced them — sweep F20). Migration
              154 said "Reports read SUM(orders.tip)" and only the manager's Z-report ever did,
              so an owner had no tips figure at any range. It is money staff are OWED, not the
              restaurant's revenue — tone "info" and its own tile, deliberately never folded into
              Revenue or Average bill (mig 154 keeps a tip out of subtotal/tax/total). Null when
              nothing was tipped, so a restaurant that takes no tips sees no tile at all. */}
          {data.tips && (
            <Stat label="Tips collected" tone="info" icon="fa-hand-holding-heart"
              value={inr(data.tips.collected)}
              sub={`on ${nfmt(data.tips.orders)} bill${data.tips.orders === 1 ? "" : "s"} — for the team, not revenue`} />
          )}
          {/* INVENTORY on the day sheet (mig 227) — same treatment as staff pay: a null
              payload (module off) keeps every tile off the sheet entirely. Three DIFFERENT
              kinds of money, deliberately three tiles and never one total: cash out to
              suppliers · the cost of what the kitchen used · what's still on the shelf. */}
          {data.inventory && (
            <>
              <Stat label="Stock bought" tone="bad" icon="fa-truck" value={inr(data.inventory.bought)}
                sub="cash out to suppliers" onClick={() => onOpenReport("inventory", { sub: "buy" })}
                title="Open the Inventory & stock report" />
              <Stat label="Ingredients used" tone="warn" icon="fa-utensils" value={inr(data.inventory.usedTheoretical)}
                sub={data.inventory.foodCostPct != null
                  ? `${data.inventory.foodCostPct.toFixed(1)}% of those dishes' sales${data.inventory.coveragePct < 99.5 ? ` · ${Math.round(data.inventory.coveragePct)}% of sales mapped` : ""}`
                  : data.inventory.hasRecipes ? "no dish with a recipe sold today" : "map recipes to see this"}
                onClick={() => onOpenReport("inventory", { sub: "usage" })} title="Open Usage & cost" />
              <Stat label="Wasted + expenses" tone="bad" icon="fa-trash"
                value={inr(data.inventory.wasted + data.inventory.expenses)}
                sub={`${inr(data.inventory.wasted)} waste · ${inr(data.inventory.expenses)} other`}
                onClick={() => onOpenReport("inventory", { sub: "waste" })} title="Open the Waste report" />
              <Stat label="On the shelf" tone="info" icon="fa-boxes-stacked" value={inr(data.inventory.stockValue)}
                sub={data.inventory.negativeCount ? `${nfmt(data.inventory.negativeCount)} below zero — check bills`
                  : data.inventory.lowCount ? `${nfmt(data.inventory.lowCount)} running low` : "stock in hand"}
                onClick={() => onOpenReport("inventory", { sub: "stock" })} title="Open On the shelf" />
            </>
          )}
        </div>

        <div className="rs-daysheet">
          <Panel title="Where the money came from" hint="from item prices to money collected">
            <div className="rs-lines">
              <div className="rs-line"><span className="lbl">Item sales <span style={{ color: "var(--muted)", fontWeight: 500 }}>· menu prices</span></span><span className="val">{inr(t.subtotal)}</span></div>
              <div className="rs-line"><span className="lbl">Discounts given</span><span className="val neg">− {inr(t.discount)}</span></div>
              <div className="rs-line"><span className="lbl"><b>Net sales</b> <span style={{ color: "var(--muted)", fontWeight: 500 }}>· your earnings, GST is charged on this</span></span><span className="val"><b>{inr(t.subtotal - t.discount)}</b></span></div>
              <div className="rs-line"><span className="lbl">GST collected <span style={{ color: "var(--muted)", fontWeight: 500 }}>· held for the government</span></span><span className="val">+ {inr(t.tax)}</span></div>
              {taxLines.length > 0 && taxLines.map((l) => <div key={l.label} className="rs-line sub"><span className="lbl">{l.label} ({l.rate}%)</span><span className="val">{inrP(l.amt)}</span></div>)}
              <div className="rs-line total"><span className="lbl">Total collected</span><span className="val">{inr(t.revenue)}</span></div>
            </div>
            <p className="rs-note">
              <b>Total collected</b> is every rupee guests paid — it includes the {inr(t.tax)}{" "}
              GST, which isn&apos;t yours to keep.
              Your actual sales are the <b>Net sales</b> line ({inr(t.subtotal - t.discount)}).
              {!singleRest && " Pick one restaurant to see its CGST/SGST split."}
            </p>
          </Panel>

          <Panel title="Settlement" hint="how the money arrived"
            right={<button type="button" className="rs-drill" onClick={() => onOpenReport("payments")} title="Open the Payment settlement report">Full report <i className="fas fa-arrow-right" aria-hidden /></button>}>

            {/* "No payments recorded" is only honest when there really were no bills. When bills
                WERE settled but every amount against them reads zero, the settlement could not be
                read — say that, rather than a sentence that means the opposite (T11 sweep,
                2026-08-18). This is the shape the swapped-column fault printed for months: nine
                bills settled, "No payments recorded", and a Total collected tile full of money. */}
            {pays.length === 0 ? (
              payBills > 0
                ? <div className="rs-empty" style={{ padding: 20 }}>
                    {nfmt(payBills)} bill{payBills === 1 ? "" : "s"} settled, but the amount against
                    {payBills === 1 ? " it" : " them"} could not be read. The total above is right —
                    press Refresh, and tell us if it stays like this.
                  </div>
                : <div className="rs-empty" style={{ padding: 20 }}>No payments recorded.</div>
            ) : (
              <div className="rs-paylist">
                {pays.map((p) => {
                  const c = payColor(p.method);
                  const share = payTotal ? (p.revenue / payTotal) * 100 : 0;
                  return (
                    <div key={p.method}>
                      <div className="rs-payrow">
                        <span className="sw" style={{ background: c }} />
                        <span className="pm">{p.method} <span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 11.5 }}>· {Math.round(share)}% · {p.orders} bill{p.orders === 1 ? "" : "s"}</span></span>
                        <span className="amt">{inr(p.revenue)}</span>
                      </div>
                      <div className="rs-paybar"><span style={{ width: `${share}%`, background: c }} /></div>
                    </div>
                  );
                })}
                <div className="rs-line total" style={{ marginTop: 6 }}><span className="lbl">Total collected</span><span className="val">{inr(payTotal)}</span></div>
              </div>
            )}
          </Panel>

          <Panel title="Order stats" hint="volume & health">
            <div className="rs-lines">
              <div className="rs-line"><span className="lbl">Orders placed</span><span className="val">{nfmt(placed)}</span></div>
              <div className="rs-line"><span className="lbl">Paid bills</span><span className="val">{nfmt(t.paidOrders)}</span></div>
              {stillOpen > 0 && <div className="rs-line"><span className="lbl">Still open (not paid yet)</span><span className="val">{nfmt(stillOpen)}</span></div>}
              <div className="rs-line"><span className="lbl">Cancelled orders</span><span className="val neg">{nfmt(t.cancelledOrders)}</span></div>
              <div className="rs-line"><span className="lbl">Value lost to cancels</span><span className="val neg">{inr(t.cancelledValue)}</span></div>
              <div className="rs-line"><span className="lbl">Average bill</span><span className="val">{inr(avg)}</span></div>
              <div className="rs-line"><span className="lbl">Effective discount rate</span><span className="val">{t.subtotal ? ((t.discount / t.subtotal) * 100).toFixed(1) : "0.0"}%</span></div>
            </div>
          </Panel>
        </div>

        {/* The day's DISHES + BUSY HOURS, right on the day sheet (owner 2026-07-26). */}
        <DayExtras dishesDay={dishesDay} hourlyDay={hourlyDay} accent={accent} />

        {series.length > 1 && (
          <>
            <BestWorst
              series={settled(series).map((s) => ({ label: s.label, value: s.revenue }))}
              money noun="income"
              unit={chartUnit}
              droppedPartial={lastIsRunning}
            />
            <Panel title="Revenue through the day" pad={false}>
              <div style={{ padding: 12 }}><ToggleChart data={series.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money height={220} /></div>
            </Panel>
          </>
        )}
      </>
    );
  }

  // ── SALES TREND ──
  if (bk === "sales") {
    if (!t) return <EmptyCard text="No sales in this period yet." />;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Total collected" tone="accent" icon="fa-indian-rupee-sign" big value={inr(t.revenue)} sub="everything guests paid — GST included" spark={series.map((s) => s.revenue)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Net sales" tone="good" icon="fa-sack-dollar" value={inr(t.subtotal - t.discount)} sub="your earnings, before GST" />
          <Stat label="Item sales" tone="info" icon="fa-cart-shopping" value={inr(t.subtotal)} sub="menu prices, before discount" />
          <Stat label="GST collected" tone="accent" icon="fa-landmark" value={inr(t.tax)} sub="held for the government" onClick={() => onOpenReport("tax")} title="Open the Tax / GST report" />
          <Stat label="Discounts" tone="warn" icon="fa-tag" value={inr(t.discount)} onClick={() => onOpenReport("payments", { pay: "discounts" })} title="Open the Discounts report" />
        </div>
        {/* Revenue — with the INVENTORY COST line beside it when the module is on (mig 227,
            the long-deferred second line). Costs are matched to revenue rows by IST calendar
            key, so a point can never land on the wrong day; the overlay is dropped when the
            chart auto-drilled to a finer grain than the cost series (day), because an hourly
            revenue bar next to a daily cost bar would be a lie. */}
        {(() => {
          const costRows = data.costSeries;
          const drilled = chartBucket !== bucket;
          // The cost series is ALWAYS day- or month-grained (the route asks
          // lfh_inv_cost_series for `bucket === "month" ? "month" : "day"`), and mig 294 returns
          // its bucket as a "YYYY-MM-DD" / "YYYY-MM" STRING. On an HOUR window (Today /
          // Yesterday) `istKey` slices an hour bucket down to its DAY, so all 24 hourly bars
          // matched the one and only cost row and the chart drew the whole day's supplier spend
          // twenty-four times over (T5 sweep, 2026-08-06). `drilled` never catches it, because
          // an hour window has nothing finer to drill to. Only day/month revenue buckets can
          // carry this overlay honestly.
          const grainMatches = bucket === "day" || bucket === "month";
          const canOverlay = !!costRows?.length && !drilled && grainMatches;
          const costBy = new Map((costRows ?? []).map((c) => [c.bucket, c]));
          const istKey = (iso: string) => {
            const d = new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString();
            return bucket === "month" ? d.slice(0, 7) : d.slice(0, 10);
          };
          const rows = chartRows.map((r) => {
            const c = canOverlay ? costBy.get(istKey(r.bucket)) : undefined;
            return { label: bucketLabel(r.bucket, chartBucket), value: r.revenue, cost: c ? c.purchased : 0 };
          });
          const matched = canOverlay && rows.some((r) => r.cost > 0);
          return (
            <Panel title="Revenue over time" hint={matched ? "orange = stock bought that day (cash out)" : undefined} pad={false}>
              <div style={{ padding: 12 }}>
                <ToggleChart data={rows} color={accent} money height={240} cost={matched} costName="Stock bought" />
              </div>
            </Panel>
          );
        })()}
        {series.filter((s) => s.revenue > 0).length > 1 && (
          <BestWorst
            series={settled(series).map((s) => ({ label: s.label, value: s.revenue }))}
            money noun="revenue"
            unit={chartUnit}
            droppedPartial={lastIsRunning}
          />
        )}
        <MoneyTable rows={mrows} totals={t} bucket={bucket} />
      </>
    );
  }

  // ── AVERAGE BILL ──
  if (bk === "avgbill") {
    if (!t) return <EmptyCard text="No paid bills in this period yet." />;
    const avgSeries = chartRows.map((r) => ({ label: bucketLabel(r.bucket, chartBucket), revenue: r.paidOrders ? Math.round(r.revenue / r.paidOrders) : 0 }));
    const avg = t.paidOrders ? t.revenue / t.paidOrders : 0;
    const withData = avgSeries.filter((s) => s.revenue > 0).map((s) => s.revenue);
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" big value={inr(avg)} sub="revenue ÷ paid bills" spark={avgSeries.map((s) => s.revenue)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Paid bills" tone="accent" icon="fa-receipt" value={nfmt(t.paidOrders)} onClick={() => onOpenReport("sales", { sub: "volume" })} title="Open the Order volume report" />
          {/* "bucket" is the word the query uses; the owner reads days, hours or months
              (T5 sweep, 2026-08-11). The panel underneath already says "day". */}
          <Stat label={`Best ${chartUnit}`} tone="good" icon="fa-arrow-up" value={inr(withData.length ? Math.max(...withData) : 0)} sub="fullest average bill" />
          <Stat label={`Thinnest ${chartUnit}`} tone="warn" icon="fa-arrow-down" value={inr(withData.length ? Math.min(...withData) : 0)} sub="lightest average bill" />
        </div>
        <Panel title="Average bill over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={avgSeries.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money name="Avg bill" height={240} /></div>
        </Panel>
        {withData.length > 1 && (
          <BestWorst
            series={settled(avgSeries).map((s) => ({ label: s.label, value: s.revenue }))}
            money noun="basket size"
            title={`Fullest & thinnest ${chartUnit}`}
            unit={chartUnit}
            droppedPartial={lastIsRunning}
          />
        )}
        <MoneyTable rows={mrows} totals={t} bucket={bucket} showAvg />
      </>
    );
  }

  // ── ORDER VOLUME ──
  if (bk === "volume") {
    if (!t) return <EmptyCard text="No orders in this period yet." />;
    const vol = chartRows.map((r) => ({ label: bucketLabel(r.bucket, chartBucket), value: r.orders }));
    const placed = t.orders + t.cancelledOrders;
    const paidPct = placed ? (t.paidOrders / placed) * 100 : 0;
    const openOrders = Math.max(0, t.orders - t.paidOrders);   // placed, not cancelled, not yet paid
    const unitWord = chartUnit;
    return (
      <>
        <div className="rs-kpis">
          {/* The caption must ACCOUNT FOR the headline. It used to read "3,534 paid · 795
              cancelled" under a total of 4,634 — 305 open tables short (T5 sweep, 2026-08-11). */}
          <Stat label="Orders placed" tone="info" icon="fa-list-check" big value={nfmt(placed)}
            sub={`${nfmt(t.paidOrders)} paid${openOrders ? ` · ${nfmt(openOrders)} still open` : ""} · ${nfmt(t.cancelledOrders)} cancelled`}
            spark={vol.map((v) => v.value)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Paid bills" tone="good" icon="fa-circle-check" value={nfmt(t.paidOrders)} sub={`${paidPct.toFixed(0)}% of placed`} />
          <Stat label="Cancelled" tone="bad" icon="fa-ban" value={nfmt(t.cancelledOrders)} sub={placed ? `${((t.cancelledOrders / placed) * 100).toFixed(1)}% of placed` : ""} onClick={() => onOpenReport("payments", { pay: "cancellations" })} title="Open the Cancellations report" />
          <Stat label={`Busiest ${unitWord}`} tone="accent" icon="fa-fire" value={nfmt(vol.length ? Math.max(...vol.map((v) => v.value)) : 0)} sub={`orders in one ${unitWord}`} />
        </div>
        <SplitBar
          title="Where the orders went"
          segments={[
            { label: "Paid", value: t.paidOrders, tone: "good" },
            { label: "Open / unpaid", value: openOrders, tone: "info" },
            { label: "Cancelled", value: t.cancelledOrders, tone: "bad" },
          ]}
        />
        <Panel title="Orders over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={vol} color={accent} money={false} name="Orders" height={240} /></div>
        </Panel>
        {vol.filter((v) => v.value > 0).length > 1 && (
          <BestWorst series={settled(vol)} money={false} noun="orders" unit={unitWord} droppedPartial={lastIsRunning} />
        )}
        <MoneyTable rows={mrows} totals={t} bucket={bucket} />
      </>
    );
  }

  // ── DAY OF WEEK ──
  if (bk === "weekday") {
    if (bucket !== "day") return <EmptyCard text="Pick a daily period (7 days, 30 days, this or last month) to see the day-of-week breakdown." />;
    const NAMES = [...WEEKDAY_SHORT];
    const by = new Map<string, { rev: number; orders: number; days: number }>();
    for (const r of mrows) {
      const wd = istWeekday(r.bucket);
      const cur = by.get(wd) || { rev: 0, orders: 0, days: 0 };
      cur.rev += r.revenue; cur.orders += r.paidOrders; cur.days += (r.revenue > 0 || r.paidOrders > 0) ? 1 : 0;
      by.set(wd, cur);
    }
    const FULL = WEEKDAY_FULL;
    const rows = NAMES.map((nm) => ({ nm, ...(by.get(nm) || { rev: 0, orders: 0, days: 0 }) }));
    const chart = rows.map((r) => ({ label: r.nm, revenue: r.rev }));
    const allRev = rows.reduce((a, r) => a + r.rev, 0);
    // Only weekdays that actually occurred in the window can win/lose — a day that never
    // came round (days === 0) isn't the "worst", it just wasn't in the period.
    const seen = rows.filter((r) => r.days > 0);
    const best = seen.length ? seen.reduce((a, b) => (b.rev > a.rev ? b : a), seen[0]) : null;
    const worst = seen.length ? seen.reduce((a, b) => (b.rev < a.rev ? b : a), seen[0]) : null;
    // Weekend (Sat+Sun) vs weekday (Mon–Fri): compare per-DAY averages, not totals, so a
    // 2-day weekend isn't unfairly dwarfed by a 5-day working week.
    const WKEND = new Set(["Sat", "Sun"]);
    const wkRev = rows.filter((r) => WKEND.has(r.nm)).reduce((a, r) => a + r.rev, 0);
    const wkDays = rows.filter((r) => WKEND.has(r.nm)).reduce((a, r) => a + r.days, 0);
    const wdRev = rows.filter((r) => !WKEND.has(r.nm)).reduce((a, r) => a + r.rev, 0);
    const wdDays = rows.filter((r) => !WKEND.has(r.nm)).reduce((a, r) => a + r.days, 0);
    const wkAvg = wkDays ? wkRev / wkDays : 0;
    const wdAvg = wdDays ? wdRev / wdDays : 0;
    const gap = wdAvg ? ((wkAvg - wdAvg) / wdAvg) * 100 : 0;
    const goodTint = { background: "color-mix(in srgb, var(--adm-ok) 11%, transparent)" };
    const badTint = { background: "color-mix(in srgb, var(--adm-warn) 11%, transparent)" };
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Best weekday" tone="good" icon="fa-crown" big value={best ? FULL[best.nm] : "—"} sub={best ? `${inr(best.rev)} · ${inr(best.days ? best.rev / best.days : 0)}/day` : "no data yet"} onClick={best ? () => scrollToId("rs-weekday-breakdown") : undefined} title={best ? "Jump to the day-of-week breakdown" : undefined} />
          <Stat label="Slowest weekday" tone="warn" icon="fa-arrow-trend-down" value={worst ? FULL[worst.nm] : "—"} sub={worst ? `${inr(worst.rev)} · ${inr(worst.days ? worst.rev / worst.days : 0)}/day` : ""} onClick={worst ? () => scrollToId("rs-weekday-breakdown") : undefined} title={worst ? "Jump to the day-of-week breakdown" : undefined} />
          <Stat label="Weekend share" tone="info" icon="fa-champagne-glasses" value={allRev ? `${Math.round((wkRev / allRev) * 100)}%` : "0%"} sub="Sat + Sun of revenue" />
          <Stat label="Weekend / day" tone="accent" icon="fa-calendar-day" value={inr(wkAvg)} sub={`across ${nfmt(wkDays)} day${wkDays === 1 ? "" : "s"}`} />
          <Stat label="Weekday / day" tone="accent" icon="fa-calendar-day" value={inr(wdAvg)} sub={`across ${nfmt(wdDays)} day${wdDays === 1 ? "" : "s"}`} />
        </div>
        {wkDays > 0 && wdDays > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            An average <b>weekend</b> day takes <b>{inr(wkAvg)}</b> versus <b>{inr(wdAvg)}</b> on a working day —{" "}
            {Math.abs(gap) < 1 ? "about the same." : <><b>{Math.abs(Math.round(gap))}% {gap > 0 ? "more" : "less"}</b> on the weekend.</>}
          </p>
        )}
        <Panel title="Revenue by day of week" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={chart.map((c) => ({ label: c.label, value: c.revenue }))} color={accent} money height={240} title="Which day earns most" /></div>
        </Panel>
        <Panel id="rs-weekday-breakdown" title="Breakdown" hint="each day added up across the period" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Day</th><th className="num">Days counted</th><th className="num">Paid bills</th><th className="num">Revenue</th><th className="num">% of week</th><th className="num">Avg / day</th></tr></thead>
              <tbody>{rows.map((r) => {
                const isBest = best && r.nm === best.nm && r.rev > 0;
                const isWorst = worst && r.nm === worst.nm && !isBest && r.days > 0;
                return (
                  <tr key={r.nm} style={isBest ? goodTint : isWorst ? badTint : undefined}>
                    <td>{FULL[r.nm]}{isBest && <i className="fas fa-crown" aria-hidden style={{ color: "var(--adm-ok)", marginLeft: 6, fontSize: 10 }} />}{isWorst && <i className="fas fa-arrow-trend-down" aria-hidden style={{ color: "var(--adm-warn)", marginLeft: 6, fontSize: 10 }} />}</td>
                    <td className="num">{r.days}</td><td className="num">{nfmt(r.orders)}</td>
                    <td className="num"><b>{inr(r.rev)}</b></td>
                    <td className="num">{allRev ? ((r.rev / allRev) * 100).toFixed(1) : "0.0"}%</td>
                    <td className="num">{inr(r.days ? r.rev / r.days : 0)}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr>
                <td>Total</td><td className="num">{nfmt(rows.reduce((a, r) => a + r.days, 0))}</td>
                <td className="num">{nfmt(rows.reduce((a, r) => a + r.orders, 0))}</td>
                <td className="num">{inr(allRev)}</td><td className="num">100%</td>
                <td className="num">{inr((wkDays + wdDays) ? allRev / (wkDays + wdDays) : 0)}</td>
              </tr></tfoot>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── TAX / GST ──
  if (bk === "tax") {
    if (!t) return <EmptyCard text="No taxable sales in this period yet." />;
    // Sales net of discount. Once a restaurant sells MRP / nil-rated items (mig 270) this is
    // NOT all taxable, so a GST return needs it split — taxable supplies and exempt supplies
    // are different boxes on the form.
    const netSales = t.subtotal - t.discount;
    const configuredPct = data.tax?.effectivePct ?? null;         // the rate that's set up
    // COMPOSITION SCHEME: this restaurant charges the diner no GST at all, so there is no
    // taxable supply, no CGST/SGST split and nothing to file under those boxes. The report
    // used to print a zero-value CGST/SGST table and call all of net sales "Taxable sales"
    // (owner-panel sweep 2026-08-04) — the server now says so with a flag and the whole
    // block below reads differently.
    const composition = data.tax?.composition === true;
    // The taxable value is recoverable exactly from the tax itself: tax = taxable × rate
    // (lib/taxFiling → taxableValue, shared with the export). It stays right when a period
    // mixes taxed and MRP/exempt lines, and is capped at net sales.
    // Is there a REAL exempt / MRP portion, or is `net − tax÷rate` just rounding dust? Decided
    // ONCE, in lib/taxFiling → exemptIsMaterial (which carries the story), then handed to every
    // row below and to the export, so the tile, the filing table and the printed sheet can never
    // print three different taxable bases. Without it a single-rate restaurant was permanently
    // told it had ₹111 of exempt supply to file separately (T5 sweep, 2026-08-06).
    const exemptMaterial = !composition && exemptIsMaterial(t, configuredPct);
    const taxable = composition ? 0 : exemptMaterial ? taxableValue(t, configuredPct) : netSales;
    const exempt = exemptMaterial ? Math.max(0, Math.round((netSales - taxable) * 100) / 100) : 0;
    const actualPct = taxable ? (t.tax / taxable) * 100 : 0;       // rate the numbers actually realised
    // ── A WARNING THAT IS ALWAYS ON IS A WARNING NOBODY READS (T5 sweep, 2026-08-06) ──────────
    // This used to fire whenever the realised rate differed from the configured one by 0.5pp,
    // which is PERMANENT for any restaurant legitimately selling at two GST rates (a 5% kitchen
    // with a few 18% packaged items will never land on 5.00%). So the banner told a correctly
    // configured restaurant it had a problem, every single day, until it stopped being read.
    //
    // The honest question is not "is the average off the set rate" but "is more than one rate in
    // use". Per-period rates that scatter say yes; a steady offset from the set rate says the
    // rate itself is what it is. Only a rate that MOVES, or one that is impossibly above the set
    // rate, is worth interrupting him for.
    const rateOfRow = (r: MoneyRow) => { const tv = taxableFor(r, configuredPct, exemptMaterial); return tv > 0 ? (r.tax / tv) * 100 : null; };
    const rowRates = mrows.map(rateOfRow).filter((x): x is number => x != null && x > 0);
    const rateSpread = rowRates.length > 1 ? Math.max(...rowRates) - Math.min(...rowRates) : 0;
    const mixedRates = rateSpread > 0.75;                          // the periods disagree with each other
    const overSetRate = configuredPct != null && actualPct - configuredPct > 0.5;   // can't collect MORE than the rate
    const rateOk = configuredPct == null || (!mixedRates && !overSetRate);
    const avgTaxPerBill = t.paidOrders ? t.tax / t.paidOrders : 0;
    const comps = data.tax?.components ?? [];
    // ── ONE filing computation for the whole report (lib/taxFiling → buildFiling) ──
    // Every number below reconciles in BOTH directions: a period's tax lines sum to that
    // period's whole-rupee tax, each column sums to the period total, and the grand total is
    // EXACTLY `Math.round(totals.tax)` — the same figure the "Tax collected" tile shows.
    //
    // It used to be two independent roundings and they disagreed on screen: "The split"
    // rounded the period total once (CGST ₹207,887.50) while this table rounded all 30 days
    // and summed them (CGST ₹207,888.50, total tax ₹415,777 vs the tile's ₹415,775) — two
    // different CGST figures on one page captioned "ready to copy into a return"
    // (owner-panel sweep 2026-08-04). The largest-remainder allocation keeps the whole-rupee
    // filing grain AND the exact total.
    const filing = buildFiling(comps.length ? mrows.filter((r) => r.tax > 0) : [], comps, (r) => r.tax);
    const filingRows = filing.rows.map((fr) => ({
      bucket: fr.row.bucket, taxable: taxableFor(fr.row, configuredPct, exemptMaterial), tax: fr.tax, parts: fr.parts,
    }));
    const compTotals = filing.columnTotals;
    const filingTaxable = filingRows.reduce((a, r) => a + r.taxable, 0);
    const filingTax = filing.total;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" big value={inr(t.tax)} sub={composition ? "composition scheme — no GST charged" : `${nfmt(t.paidOrders)} paid bills`} spark={mrows.map((r) => r.tax)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          {composition ? (
            <Stat label="Sales" tone="accent" icon="fa-cart-shopping" value={inr(netSales)}
              sub="none of it taxable to the diner" />
          ) : (
            <Stat label="Taxable sales" tone="accent" icon="fa-cart-shopping" value={inr(taxable)}
              sub={exempt > 0 ? "the part GST was charged on" : "subtotal − discount"} />
          )}
          {!composition && exempt > 0 && (
            <Stat label="Exempt / MRP sales" tone="info" icon="fa-bottle-water" value={inr(exempt)}
              sub="sold with no GST — file separately" />
          )}
          {!composition && (
            <Stat label="Effective rate" tone={rateOk ? "good" : "warn"} icon="fa-percent" value={`${actualPct.toFixed(2)}%`}
              sub={configuredPct != null ? (rateOk ? `matches the set ${configuredPct}%` : mixedRates ? `mixed rates · set ${configuredPct}%` : `above the set ${configuredPct}%`) : "tax ÷ taxable sales"} />
          )}
          {!composition && <Stat label="Tax per bill" tone="info" icon="fa-receipt" value={inr(avgTaxPerBill)} sub="average" />}
        </div>
        {composition && (
          <p className="rs-note" style={{ marginTop: -4, marginBottom: 12 }}>
            <i className="fas fa-circle-info" aria-hidden style={{ color: "var(--accent)", marginRight: 6 }} />
            This restaurant is on the <b>composition scheme</b>, so it cannot charge GST to guests and
            the bill shows no tax line. There is no CGST/SGST split to file — you pay the flat
            composition rate on turnover yourself, from the <b>Sales</b>{" "}
            figure above.
          </p>
        )}
        {!composition && configuredPct != null && !rateOk && (
          <p className="rs-note" style={{ marginTop: -4, marginBottom: 12 }}>
            <i className="fas fa-triangle-exclamation" aria-hidden style={{ color: "var(--adm-warn)", marginRight: 6 }} />
            {overSetRate ? (
              <>These bills realised <b>{actualPct.toFixed(2)}%</b> — MORE than the {configuredPct}% you have set. Tax collected can&apos;t exceed the rate, so something is priced or configured wrong. Worth checking before filing.</>
            ) : (
              <>More than one GST rate is in use here: across the periods below the realised rate ranges over <b>{rateSpread.toFixed(2)} points</b> (averaging {actualPct.toFixed(2)}% against the set {configuredPct}%). That is normal if you sell items at different rates — check the split matches what you intend before filing.</>
            )}
          </p>
        )}
        {composition ? null : data.tax && comps.length ? (
          <Panel title="The split" hint="same total, shown the way the printed bill shows it">
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Tax line</th><th className="num">Rate</th><th className="num">Collected</th></tr></thead>
                <tbody>
                  <tr><td><b>Total tax</b></td><td className="num">{data.tax.effectivePct}%</td><td className="num"><b>{inr(t.tax)}</b></td></tr>
                  {/* The SAME column totals the filing table below adds up to — one computation,
                      so the two panels can never print different CGST figures. When there are no
                      per-period rows to allocate (a period with no tax at all) fall back to
                      splitting the total once. */}
                  {(filingRows.length ? compTotals : splitTax(comps.map((c) => c.rate), Math.round(t.tax))).map((amt, i) => {
                    const c = comps[i];
                    return <tr key={c.label}><td>{c.label}</td><td className="num">{c.rate}%</td><td className="num">{inrP(amt)}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
            {!data.tax.configured && <p className="rs-note">No custom tax lines set — showing the standard CGST/SGST halves.</p>}
          </Panel>
        ) : (
          <EmptyCard text="Pick a single restaurant to see its CGST/SGST split — tax lines are set per restaurant." />
        )}
        <Panel title="Tax over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={cser((r) => r.tax)} color={accent} money name="Tax" height={220} /></div>
        </Panel>
        {filingRows.length > 0 && (
          <Panel title="Tax by period — filing view" hint="taxable value and each tax line, per period" pad={false}>
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Period</th><th className="num">Taxable value</th>{comps.map((c) => <th key={c.label} className="num">{c.label} ({c.rate}%)</th>)}<th className="num">Total tax</th></tr></thead>
                <tbody>{filingRows.map((r) => (
                  <tr key={r.bucket}>
                    <td>{bucketLabel(r.bucket, bucket)}</td>
                    <td className="num">{inr(r.taxable)}</td>
                    {r.parts.map((amt, i) => <td key={comps[i].label} className="num">{inrP(amt)}</td>)}
                    <td className="num"><b>{inr(r.tax)}</b></td>
                  </tr>
                ))}</tbody>
                <tfoot><tr><td>Total</td><td className="num">{inr(filingTaxable)}</td>{compTotals.map((amt, i) => <td key={comps[i].label} className="num">{inrP(amt)}</td>)}<td className="num">{inrP(filingTax)}</td></tr></tfoot>
              </table>
            </div>
            <p className="rs-note">Each period&apos;s tax is split across the set tax lines and rounded so the parts add back to that period&apos;s total — ready to copy into a return.</p>
          </Panel>
        )}
        {/* The filing view already IS the tax report's by-period table; the generic
            money table only duplicates Period+Tax here (orders/revenue belong in Sales).
            Keep it ONLY as a fallback when no tax lines are configured, so the report
            still shows a by-period breakdown (owner round-6, phase-6 no-duplicate rule). */}
        {filingRows.length === 0 && <MoneyTable rows={mrows} totals={t} bucket={bucket} />}
      </>
    );
  }

  // ── DISCOUNTS GIVEN ──
  if (bk === "discounts") {
    if (!t) return <EmptyCard text="No sales in this period yet." />;
    const discRows = mrows.filter((r) => r.discount > 0);
    const effPct = t.subtotal ? (t.discount / t.subtotal) * 100 : 0;
    const byDisc = [...discRows].sort((a, b) => b.discount - a.discount);
    const biggest = byDisc[0];
    const totalDisc = discRows.reduce((a, r) => a + r.discount, 0);
    const top5 = byDisc.slice(0, 5).map((r) => ({ id: r.bucket, name: bucketLabel(r.bucket, bucket), revenue: r.discount, orders: r.paidOrders, accentColor: accent }));
    const top5Share = totalDisc ? (top5.reduce((a, d) => a + d.revenue, 0) / totalDisc) * 100 : 0;
    // Trend: is the discount RATE (share of sales given away) rising or easing across the period?
    const rateOf = (r: MoneyRow) => (r.subtotal ? (r.discount / r.subtotal) * 100 : 0);
    const half = Math.floor(discRows.length / 2);
    const firstAvg = half ? discRows.slice(0, half).reduce((a, r) => a + rateOf(r), 0) / half : 0;
    const lastAvg = discRows.length - half ? discRows.slice(half).reduce((a, r) => a + rateOf(r), 0) / (discRows.length - half) : 0;
    const trendDelta = lastAvg - firstAvg;
    const trend = discRows.length < 4 ? "steady" : trendDelta > 0.5 ? "rising" : trendDelta < -0.5 ? "easing" : "steady";
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Discounts given" tone="warn" icon="fa-tag" big value={inr(t.discount)} sub={`over ${nfmt(discRows.length)} ${rowUnit}${discRows.length === 1 ? "" : "s"}`} spark={mrows.map((r) => r.discount)} />
          <Stat label="Effective rate" tone="warn" icon="fa-percent" value={`${effPct.toFixed(1)}%`} sub="of gross sales" />
          <Stat label="Revenue after discounts" tone="accent" icon="fa-indian-rupee-sign" value={inr(t.revenue)} onClick={() => onOpenReport("sales")} title="Open the Sales trend report" />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} />
          <Stat label={`Biggest ${rowUnit}`} tone="bad" icon="fa-arrow-up" value={biggest ? inr(biggest.discount) : "—"} sub={biggest ? bucketLabel(biggest.bucket, bucket) : ""} onClick={biggest ? () => scrollToId("rs-disc-days") : undefined} title={biggest ? "Jump to the days-with-discounts table" : undefined} />
        </div>
        <Panel title="Discounts over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={cser((r) => r.discount)} color={accent} money name="Discount" height={240} /></div>
        </Panel>
        {top5.length > 0 && (
          <Panel title={`Biggest discount ${rowUnit}s`} hint="top 5 by amount given away">
            {/* valueLabel, or the hover reads "Revenue: ₹4,700" over money GIVEN AWAY —
                measured live 2026-08-10 (T5 sweep, 2026-08-11). */}
            <LeaderBar data={top5} valueLabel="Discount given" />
            <p className="rs-note">
              These {top5.length} {rowUnit}{top5.length === 1 ? "" : "s"} account for {top5Share.toFixed(0)}% of everything discounted this period.
              {" "}Discounting is <b>{trend}</b>{trend === "steady" ? " — the give-away rate is holding flat." : trend === "rising" ? ` — the give-away rate climbed from ~${firstAvg.toFixed(1)}% to ~${lastAvg.toFixed(1)}% of sales.` : ` — the give-away rate fell from ~${firstAvg.toFixed(1)}% to ~${lastAvg.toFixed(1)}% of sales.`}
            </p>
          </Panel>
        )}
        <Panel id="rs-disc-days" title={`${RowUnit}s with discounts`} hint={`only ${rowUnit}s a discount was given`} pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Period</th><th className="num">Paid bills</th><th className="num">Discount</th><th className="num">Revenue</th><th className="num">Disc. rate</th></tr></thead>
              <tbody>{discRows.length ? discRows.map((r) => <tr key={r.bucket}><td>{bucketLabel(r.bucket, bucket)}</td><td className="num">{nfmt(r.paidOrders)}</td><td className="num"><b>{inr(r.discount)}</b></td><td className="num">{inr(r.revenue)}</td><td className="num">{r.subtotal ? ((r.discount / r.subtotal) * 100).toFixed(1) : "0.0"}%</td></tr>) : <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>No discounts were given in this period.</td></tr>}</tbody>
              {discRows.length > 0 && <tfoot><tr><td>Total</td><td className="num">{nfmt(discRows.reduce((a, r) => a + r.paidOrders, 0))}</td><td className="num">{inr(totalDisc)}</td><td className="num">{inr(discRows.reduce((a, r) => a + r.revenue, 0))}</td><td className="num">{effPct.toFixed(1)}%</td></tr></tfoot>}
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── CANCELLATIONS ──
  if (bk === "cancellations") {
    if (!t) return <EmptyCard text="No orders in this period yet." />;
    const cxRows = mrows.filter((r) => r.cancelledOrders > 0);
    const placed = t.orders + t.cancelledOrders;
    const cxPct = placed ? (t.cancelledOrders / placed) * 100 : 0;
    const byLoss = [...cxRows].sort((a, b) => b.cancelledValue - a.cancelledValue);
    const worst = byLoss[0];
    const top5 = byLoss.slice(0, 5).map((r) => ({ id: r.bucket, name: bucketLabel(r.bucket, bucket), revenue: r.cancelledValue, orders: r.cancelledOrders, accentColor: accent }));
    const top5Share = t.cancelledValue ? (top5.reduce((a, d) => a + d.revenue, 0) / t.cancelledValue) * 100 : 0;
    const avgPerCx = t.cancelledOrders ? t.cancelledValue / t.cancelledOrders : 0;
    // Health band on the cancel rate — plain words + a tone so the note reads at a glance.
    const health = cxPct >= 8 ? { word: "high", tone: "var(--adm-danger)", icon: "fa-triangle-exclamation" }
      : cxPct >= 4 ? { word: "worth watching", tone: "var(--adm-warn)", icon: "fa-circle-exclamation" }
      : { word: "healthy", tone: "var(--adm-ok)", icon: "fa-circle-check" };
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Value lost" tone="bad" icon="fa-ban" big value={inr(t.cancelledValue)} sub={`over ${nfmt(cxRows.length)} ${rowUnit}${cxRows.length === 1 ? "" : "s"}`} spark={mrows.map((r) => r.cancelledValue)} />
          <Stat label="Cancelled orders" tone="bad" icon="fa-circle-xmark" value={nfmt(t.cancelledOrders)} sub={`${cxPct.toFixed(1)}% of all placed`} />
          <Stat label="Avg lost / cancel" tone="warn" icon="fa-scale-balanced" value={inr(avgPerCx)} />
          <Stat label="Kept revenue" tone="accent" icon="fa-indian-rupee-sign" value={inr(t.revenue)} onClick={() => onOpenReport("sales")} title="Open the Sales trend report" />
          <Stat label={`Worst ${rowUnit}`} tone="warn" icon="fa-arrow-up" value={worst ? inr(worst.cancelledValue) : "—"} sub={worst ? bucketLabel(worst.bucket, bucket) : ""} onClick={worst ? () => scrollToId("rs-cx-days") : undefined} title={worst ? "Jump to the days-with-cancellations table" : undefined} />
        </div>
        <p className="rs-note" style={{ marginTop: -4, marginBottom: 12 }}>
          <i className={`fas ${health.icon}`} aria-hidden style={{ color: health.tone, marginRight: 6 }} />
          Your cancel rate is <b>{cxPct.toFixed(1)}%</b> ({health.word}) — {nfmt(t.cancelledOrders)} of {nfmt(placed)} placed orders were voided, losing {inr(t.cancelledValue)} (about {inr(avgPerCx)} per cancel).
        </p>
        <Panel title="Value lost over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={cser((r) => r.cancelledValue)} color={accent} money name="Lost value" height={240} /></div>
        </Panel>
        {top5.length > 0 && (
          <Panel title={`Worst cancellation ${rowUnit}s`} hint="top 5 by value lost">
            <LeaderBar data={top5} valueLabel="Value lost" />
            <p className="rs-note">These {top5.length} {rowUnit}{top5.length === 1 ? "" : "s"} account for {top5Share.toFixed(0)}% of all the value lost to cancellations this period.</p>
          </Panel>
        )}
        <Panel id="rs-cx-days" title={`${RowUnit}s with cancellations`} hint={`only ${rowUnit}s something was voided`} pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Period</th><th className="num">Cancelled orders</th><th className="num">Value lost</th><th className="num">Kept revenue</th></tr></thead>
              <tbody>{cxRows.length ? cxRows.map((r) => <tr key={r.bucket}><td>{bucketLabel(r.bucket, bucket)}</td><td className="num">{nfmt(r.cancelledOrders)}</td><td className="num"><b>{inr(r.cancelledValue)}</b></td><td className="num">{inr(r.revenue)}</td></tr>) : <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>No cancellations in this period.</td></tr>}</tbody>
              {cxRows.length > 0 && <tfoot><tr><td>Total</td><td className="num">{nfmt(t.cancelledOrders)}</td><td className="num">{inr(t.cancelledValue)}</td><td className="num">{inr(cxRows.reduce((a, r) => a + r.revenue, 0))}</td></tr></tfoot>}
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── PAYMENT SETTLEMENT ──
  if (bk === "payments") {
    const raw = (data.rows ?? []) as PayRow[];
    if (!raw.length) return <EmptyCard text="No payments recorded in this period." />;
    // Merge by canonical method (mirrors PaymentDonut) so the table and the donut agree.
    const merged = new Map<string, PayRow & { method: string }>();
    for (const p of raw) {
      const method = canonPayMethod(p.method);
      const row = merged.get(method) || { method, revenue: 0, orders: 0 };
      row.revenue += p.revenue; row.orders += p.orders;
      merged.set(method, row);
    }
    // Every settled method, INCLUDING one that collected ₹0 (a fully-discounted bill is still
    // a settled bill). Dropping those rows made "bills settled" 4,243 while the Tax and Sales
    // reports said 4,254 paid bills for the same period, and pushed this report's average bill
    // to ₹2,058 against their ₹2,052 — three different answers to one question
    // (owner-panel sweep 2026-08-04). The DONUT still shows only methods with money in them
    // (a zero-width wedge is not a slice) — PaymentDonut filters that itself.
    const pays = [...merged.values()].sort((a, b) => b.revenue - a.revenue);
    const total = pays.reduce((a, p) => a + p.revenue, 0);
    const bills = pays.reduce((a, p) => a + p.orders, 0);
    const top = pays[0];
    const topShare = total ? (top.revenue / total) * 100 : 0;
    const avgBill = bills ? total / bills : 0;
    return (
      <>
        <div className="rs-kpis">
          {/* `bill` / `bills`, like every other count in this file. The 2026-08-17 pass fixed the
              Busy-times and Times-of-day tiles and stopped at the word "orders" — so these two
              still read "1 bills settled" and "· 1 bills" on any period settled by a single bill,
              while the day sheet's settlement rows one click away said "1 bill" correctly. */}
          <Stat label="Total collected" tone="accent" icon="fa-indian-rupee-sign" big value={inr(total)} sub={`${nfmt(bills)} bill${bills === 1 ? "" : "s"} settled`} />
          <Stat label="Top method" tone="good" icon="fa-wallet" value={canonPayMethod(top?.method)} sub={`${Math.round(topShare)}% of money · ${nfmt(top?.orders || 0)} bill${(top?.orders || 0) === 1 ? "" : "s"}`} onClick={() => scrollToId("rs-pay-method")} title="Jump to the per-method table" />
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" value={inr(avgBill)} sub="collected ÷ bills settled" />
          {/* Discounts + cancellations fold in here as drill-boxes → open a detail overlay
              (owner 2026-07-26: a box on top that opens the full detail, not a sub-report). */}
          <Stat label="Discounts given" tone="warn" icon="fa-tag" value="View" sub="what was given away" onClick={onPayDetail ? () => onPayDetail("discounts") : undefined} title="Open the discounts detail" />
          <Stat label="Cancellations" tone="bad" icon="fa-ban" value="View" sub="value lost to voids" onClick={onPayDetail ? () => onPayDetail("cancellations") : undefined} title="Open the cancellations detail" />
        </div>
        <div className="rs-grid two">
          <Panel id="rs-pay-method" title="Per method" hint="bills, money and average" pad={false}>
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Method</th><th className="num">Bills</th><th className="num">Revenue</th><th className="num">% share</th><th className="num">Avg bill</th></tr></thead>
                <tbody>{pays.map((p) => {
                  const share = total ? (p.revenue / total) * 100 : 0;
                  const dom = p.method === top.method;
                  return (
                    <tr key={p.method} style={dom ? { background: "color-mix(in srgb, var(--accent) 8%, transparent)" } : undefined}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: payColor(p.method), flexShrink: 0 }} />
                          {p.method}
                          {dom && <span className="rs-tag" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}>Top</span>}
                        </span>
                      </td>
                      <td className="num">{nfmt(p.orders)}</td>
                      <td className="num"><b>{inr(p.revenue)}</b></td>
                      <td className="num">{share.toFixed(1)}%</td>
                      <td className="num">{inr(p.orders ? p.revenue / p.orders : 0)}</td>
                    </tr>
                  );
                })}</tbody>
                <tfoot><tr><td>Total</td><td className="num">{nfmt(bills)}</td><td className="num">{inr(total)}</td><td className="num">100%</td><td className="num">{inr(avgBill)}</td></tr></tfoot>
              </table>
            </div>
          </Panel>
          <Panel title="How the money arrived"><PaymentDonut data={pays} /></Panel>
        </div>
        <p className="rs-note">
          <b>{canonPayMethod(top?.method)}</b> is the dominant way guests pay — {Math.round(topShare)}% of collections ({inr(top.revenue)}) across {nfmt(top.orders)} bill{top.orders === 1 ? "" : "s"}.
        </p>
      </>
    );
  }

  // ── ITEMS & MENU (sub-tabs of one report) ── the cross-drills switch sub-tab, not report.
  const itemsSub = (k: string) => { if (k === "menu") onOpenReport("items", { sub: "menu" }); else if (k === "categories") onOpenReport("items", { sub: "categories" }); else onOpenReport("items", { sub: "items" }); };
  if (bk === "dishes") {
    const dishes = (data.rows ?? []) as DishRow[];
    if (!dishes.length) return <EmptyCard text="No dish sales in this period." />;
    return <DishesReport rows={dishes} onOpenReport={itemsSub} />;
  }
  if (bk === "categories") {
    const cats = (data.rows ?? []) as CatRow[];
    if (!cats.length) return <EmptyCard text="No category sales in this period." />;
    return <CategoriesReport rows={cats} onOpenReport={itemsSub} />;
  }
  if (bk === "menu") {
    const mrowsMenu = (data.rows ?? []) as MI[];
    if (!classifyMenu(mrowsMenu).dishes.length) return <EmptyCard text="No dish sales in this period." />;
    return <MenuReport rows={mrowsMenu} onOpenReport={itemsSub} />;
  }

  // ── BUSY HOURS ──
  if (bk === "hourly") {
    const hrs = (data.rows ?? []) as HourRow[];
    if (!hrs.length) return <EmptyCard text="No orders in this period yet." />;
    // 12-hour clock label ("2 PM") — friendlier than "14:00" on a customer-facing report.
    const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
    const totalOrders = hrs.reduce((a, h) => a + h.orders, 0);
    const totalRev = hrs.reduce((a, h) => a + h.revenue, 0);
    const avgBill = totalOrders ? totalRev / totalOrders : 0;
    const byRev = [...hrs].sort((a, b) => b.revenue - a.revenue);
    const peak = byRev[0];
    // "Quietest" only makes sense among hours that actually took an order.
    const active = hrs.filter((h) => h.orders > 0).sort((a, b) => a.revenue - b.revenue);
    const quietest = active[0] || null;
    const top3 = byRev.slice(0, 3).filter((h) => h.revenue > 0);
    const top3Rev = top3.reduce((a, h) => a + h.revenue, 0);
    const top3Share = totalRev ? Math.round((top3Rev / totalRev) * 100) : 0;
    const revSeries = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: hrs.find((x) => x.hour === h)?.revenue || 0 }));
    const ordSeries = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: hrs.find((x) => x.hour === h)?.orders || 0 }));
    const tableRows = active.slice().sort((a, b) => a.hour - b.hour);   // active hours, chronological
    const goodTint = { background: "color-mix(in srgb, var(--adm-ok) 11%, transparent)" };
    return (
      <>
        <div className="rs-kpis">
          {/* `order` / `orders`, like every other count in this file (T11 sweep, 2026-08-17).
              A quiet hour with exactly ONE order is the normal case for a quiet hour, so
              "QUIETEST HOUR · 10 AM · ₹441 · 1 orders" was on screen most of the time. */}
          <Stat label="Peak hour" tone="accent" icon="fa-fire" big value={hourLabel(peak.hour)} sub={`${inr(peak.revenue)} · ${nfmt(peak.orders)} order${peak.orders === 1 ? "" : "s"}`} spark={ordSeries.map((s) => s.value)} onClick={() => scrollToId("rs-hourly-table")} title="Jump to the hour-by-hour table" />
          <Stat label="Quietest hour" tone="info" icon="fa-moon" value={quietest ? hourLabel(quietest.hour) : "—"} sub={quietest ? `${inr(quietest.revenue)} · ${nfmt(quietest.orders)} order${quietest.orders === 1 ? "" : "s"}` : "no orders yet"} onClick={quietest ? () => scrollToId("rs-hourly-table") : undefined} title={quietest ? "Jump to the hour-by-hour table" : undefined} />
          <Stat label="Total orders" tone="info" icon="fa-list-check" value={nfmt(totalOrders)} />
          <Stat label="Total revenue" tone="accent" icon="fa-indian-rupee-sign" value={inr(totalRev)} />
          {/* NOT called "Avg bill": this divides paid revenue by ALL orders in these hours, so
              it reads lower than the average bill every other report shows (₹1,991 vs ₹2,052 on
              the same period — owner-panel sweep 2026-08-04). The hourly payload carries no paid
              count, so the honest fix is to name what it actually is. */}
          <Stat label="Per order" tone="good" icon="fa-scale-balanced" value={inr(avgBill)} sub="revenue ÷ all orders in these hours" />
        </div>
        {top3.length > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            Your three busiest hours — <b>{top3.map((h) => hourLabel(h.hour)).join(", ")}</b> — bring in{" "}
            <b>{top3Share}%</b>{" "}
            of the period&apos;s revenue. Staff and stock for those windows first.
          </p>
        )}
        <Panel title="Revenue by hour" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={revSeries} color={accent} money height={240} title="When the money comes in" /></div>
        </Panel>
        <Panel title="Orders by hour" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={ordSeries} color={accent} money={false} name="Orders" height={210} title="When it's busiest" /></div>
        </Panel>
        <Panel id="rs-hourly-table" title="Hour by hour" hint="only hours with orders" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Hour</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">% of revenue</th><th className="num">Per order</th></tr></thead>
              <tbody>{tableRows.map((h) => {
                const isPeak = h.hour === peak.hour && h.revenue > 0;
                return (
                  <tr key={h.hour} style={isPeak ? goodTint : undefined}>
                    <td>{hourLabel(h.hour)}{isPeak && <i className="fas fa-fire" aria-hidden style={{ color: "var(--adm-ok)", marginLeft: 6, fontSize: 10 }} />}</td>
                    <td className="num">{nfmt(h.orders)}</td>
                    <td className="num"><b>{inr(h.revenue)}</b></td>
                    <td className="num">{totalRev ? ((h.revenue / totalRev) * 100).toFixed(1) : "0.0"}%</td>
                    <td className="num">{inr(h.orders ? h.revenue / h.orders : 0)}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr>
                <td>Total</td><td className="num">{nfmt(totalOrders)}</td><td className="num">{inr(totalRev)}</td>
                <td className="num">100%</td><td className="num">{inr(avgBill)}</td>
              </tr></tfoot>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  // ── DAY PARTS ──
  if (bk === "daypart") {
    const hrs = (data.rows ?? []) as HourRow[];
    if (!hrs.length) return <EmptyCard text="No orders in this period yet." />;
    const byHour = new Map(hrs.map((h) => [h.hour, h]));
    const parts = DAYPARTS.map((p) => {
      let rev = 0, orders = 0;
      for (const h of p.hours) { const r = byHour.get(h); if (r) { rev += r.revenue; orders += r.orders; } }
      return { ...p, rev, orders };
    });
    const totalRev = parts.reduce((a, p) => a + p.rev, 0);
    const totalOrders = parts.reduce((a, p) => a + p.orders, 0);
    const best = parts.reduce((a, b) => (b.rev > a.rev ? b : a), parts[0]);
    // "Quietest" among parts that actually took money — an empty part isn't the weakest.
    const active = parts.filter((p) => p.rev > 0);
    const weakest = active.length ? active.reduce((a, b) => (b.rev < a.rev ? b : a), active[0]) : null;
    const chart = parts.map((p) => ({ label: p.label, revenue: p.rev }));
    const goodTint = { background: "color-mix(in srgb, var(--adm-ok) 11%, transparent)" };
    const badTint = { background: "color-mix(in srgb, var(--adm-warn) 11%, transparent)" };
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Strongest part" tone="good" icon={best.icon} big value={best.rev > 0 ? best.label : "—"} sub={best.rev > 0 ? `${inr(best.rev)} · ${totalRev ? Math.round((best.rev / totalRev) * 100) : 0}% of revenue` : "no data yet"} onClick={best.rev > 0 ? () => scrollToId("rs-daypart-breakdown") : undefined} title={best.rev > 0 ? "Jump to the day-part breakdown" : undefined} />
          <Stat label="Quietest part" tone="warn" icon="fa-arrow-trend-down" value={weakest ? weakest.label : "—"} sub={weakest ? `${inr(weakest.rev)} · ${totalRev ? Math.round((weakest.rev / totalRev) * 100) : 0}% of revenue` : ""} onClick={weakest ? () => scrollToId("rs-daypart-breakdown") : undefined} title={weakest ? "Jump to the day-part breakdown" : undefined} />
          {/* `order` / `orders` — see the Busy-hours tiles above. A quiet day part with one
              order read "1 orders" on the four tiles the owner scans first. */}
          {parts.map((p) => <Stat key={p.label} label={p.label} tone="info" icon={p.icon} value={inr(p.rev)} sub={`${nfmt(p.orders)} order${p.orders === 1 ? "" : "s"}`} />)}
        </div>
        {best.rev > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            <b>{best.label}</b> is your money-maker — <b>{totalRev ? Math.round((best.rev / totalRev) * 100) : 0}%</b>{" "}
            of everything you take.
            {weakest && weakest.label !== best.label && <> <b>{weakest.label}</b> is the quietest stretch; a small offer there can even out the day.</>}
          </p>
        )}
        <Panel title="Revenue by day part" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={chart.map((c) => ({ label: c.label, value: c.revenue }))} color={accent} money height={230} title="How the day splits" /></div>
        </Panel>
        <Panel id="rs-daypart-breakdown" title="Breakdown" hint="each stretch of the day" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Day part</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">% share</th><th className="num">Per order</th></tr></thead>
              <tbody>{parts.map((p) => {
                const isBest = p.label === best.label && p.rev > 0;
                const isWorst = weakest && p.label === weakest.label && !isBest;
                return (
                  <tr key={p.label} style={isBest ? goodTint : isWorst ? badTint : undefined}>
                    <td><i className={`fas ${p.icon}`} aria-hidden style={{ color: "var(--muted)", marginRight: 8, fontSize: 11, width: 14 }} />{p.label}
                      {isBest && <i className="fas fa-crown" aria-hidden style={{ color: "var(--adm-ok)", marginLeft: 6, fontSize: 10 }} />}
                      {isWorst && <i className="fas fa-arrow-trend-down" aria-hidden style={{ color: "var(--adm-warn)", marginLeft: 6, fontSize: 10 }} />}
                    </td>
                    <td className="num">{nfmt(p.orders)}</td>
                    <td className="num"><b>{inr(p.rev)}</b></td>
                    <td className="num">{totalRev ? ((p.rev / totalRev) * 100).toFixed(1) : "0.0"}%</td>
                    <td className="num">{inr(p.orders ? p.rev / p.orders : 0)}</td>
                  </tr>
                );
              })}</tbody>
              <tfoot><tr>
                <td>Total</td><td className="num">{nfmt(totalOrders)}</td><td className="num">{inr(totalRev)}</td>
                <td className="num">100%</td><td className="num">{inr(totalOrders ? totalRev / totalOrders : 0)}</td>
              </tr></tfoot>
            </table>
          </div>
        </Panel>
      </>
    );
  }

  return <EmptyCard text="Report not available." />;
}

// ── The day's dishes + busy hours, shown inside the Day summary ───────────────
// Reuses the same dish/hourly payloads the standalone reports use, scoped to the one day.
function DayExtras({ dishesDay, hourlyDay, accent }: { dishesDay?: Payload; hourlyDay?: Payload; accent: string }) {
  const dishes = ((dishesDay?.rows ?? []) as DishRow[]).filter((d) => d.qty > 0);
  const hours = ((hourlyDay?.rows ?? []) as HourRow[]).filter((h) => h.orders > 0);
  if (!dishes.length && !hours.length) return null;
  const topDishes = [...dishes].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const dishTotal = dishes.reduce((a, d) => a + d.revenue, 0);
  const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
  const hourSeries = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: hours.find((x) => x.hour === h)?.revenue || 0 }));
  const peak = hours.length ? [...hours].sort((a, b) => b.revenue - a.revenue)[0] : null;
  return (
    <div className="rs-grid two" style={{ marginTop: 14 }}>
      {topDishes.length > 0 && (
        <Panel title="Top items" hint={`${nfmt(dishes.length)} sold`} pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Dish</th><th className="num">Qty</th><th className="num">Sales</th><th className="num">% of items</th></tr></thead>
              <tbody>{topDishes.map((d) => (
                <tr key={d.title}><td>{d.title}</td><td className="num">{nfmt(d.qty)}</td><td className="num"><b>{inr(d.revenue)}</b></td><td className="num">{dishTotal ? ((d.revenue / dishTotal) * 100).toFixed(1) : "0.0"}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      )}
      {hours.length > 0 && (
        <Panel title="Busy hours" hint={peak ? `peak ${hourLabel(peak.hour)}` : undefined} pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={hourSeries} color={accent} money height={200} title="When the money came in" /></div>
        </Panel>
      )}
    </div>
  );
}

// ── Shared money table (sales / avgbill / volume / tax) ───────────────────────
function MoneyTable({ rows, totals, bucket, showAvg }: { rows: MoneyRow[]; totals: Totals; bucket: string; showAvg?: boolean }) {
  if (!rows.length) return <EmptyCard text="Nothing in this period." />;
  return (
    <Panel id="rs-by-period" title="By period" pad={false}>
      <div className="rs-tablewrap">
        <table className="rs-table">
          <thead><tr><th>Period</th><th className="num">Orders</th><th className="num">Paid</th><th className="num">Item sales</th><th className="num">GST</th><th className="num">Discount</th><th className="num">Total collected</th>{showAvg && <th className="num">Avg bill</th>}<th className="num">Cancelled</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bucket}>
                <td>{bucketLabel(r.bucket, bucket)}</td>
                <td className="num">{nfmt(r.orders)}</td><td className="num">{nfmt(r.paidOrders)}</td>
                <td className="num">{inr(r.subtotal)}</td><td className="num">{inr(r.tax)}</td><td className="num">{inr(r.discount)}</td>
                <td className="num"><b>{inr(r.revenue)}</b></td>
                {showAvg && <td className="num">{inr(r.paidOrders ? r.revenue / r.paidOrders : 0)}</td>}
                <td className="num">{nfmt(r.cancelledOrders)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td>Total</td><td className="num">{nfmt(totals.orders)}</td><td className="num">{nfmt(totals.paidOrders)}</td>
            <td className="num">{inr(totals.subtotal)}</td><td className="num">{inr(totals.tax)}</td><td className="num">{inr(totals.discount)}</td>
            <td className="num">{inr(totals.revenue)}</td>{showAvg && <td className="num">{inr(totals.paidOrders ? totals.revenue / totals.paidOrders : 0)}</td>}
            <td className="num">{nfmt(totals.cancelledOrders)}</td>
          </tr></tfoot>
        </table>
      </div>
    </Panel>
  );
}
