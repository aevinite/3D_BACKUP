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
  canonPayMethod, PAY_COLORS,
} from "@/components/owner/Charts";
import {
  REPORTS, CATEGORIES, ReportsStyles, Stat, Panel, PrintHead, nfmt, scrollToId, type RKey, type DataKind,
} from "@/components/owner/reports/kit";
import { BestWorst, SplitBar } from "@/components/owner/reports/Insights";
import { DishesReport, CategoriesReport, MenuReport } from "@/components/owner/reports/DishReports";
import { ReportMenu } from "@/components/owner/OwnerReportButton";
import { gatherOwnerReport } from "@/lib/ownerReportGather";
import { readSnap, writeSnap } from "@/lib/ownerSnap";
import { SectionExport, printSection } from "@/components/owner/reports/sectionExport";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastmonth" | "12m" | "fy" | "all" | "custom";
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
// under the hood a chosen day is fetched as range=custom with from=to=that day.
const DAY_KINDS = new Set<DataKind>(["daysummary"]);
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const yesterdayIso = () => new Date(Date.now() + 5.5 * 3600_000 - 86_400_000).toISOString().slice(0, 10);

// The IST calendar dates a named range covers — used to PREFILL the print ask-dialog's
// from/to. Mirrors the server's windowFor() at day granularity (to = today for "…to now").
function rangeDates(r: Range, cFrom: string, cTo: string): { from: string; to: string } {
  const today = istToday();
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth();
  switch (r) {
    case "today": return { from: today, to: today };
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
  | "dishes" | "categories" | "menu" | "hourly" | "daypart";
const BODY_KIND: Record<BodyKey, DataKind> = {
  daysummary: "daysummary",
  sales: "money", avgbill: "money", volume: "money", weekday: "money",
  discounts: "money", cancellations: "money", tax: "money",
  payments: "payments",
  dishes: "dishes", menu: "dishes", categories: "categories",
  hourly: "hourly", daypart: "hourly",
};
type OpenOpts = { sub?: string; pay?: "discounts" | "cancellations" };
type OpenReport = (k: RKey, opts?: OpenOpts) => void;
type SubTab = { key: string; label: string; icon: string; body: BodyKey };
const SUBTABS: Record<RKey, SubTab[]> = {
  daysummary: [],
  sales: [
    { key: "revenue", label: "Revenue", icon: "fa-chart-line", body: "sales" },
    { key: "avgbill", label: "Average bill", icon: "fa-receipt", body: "avgbill" },
    { key: "volume", label: "Order volume", icon: "fa-list-check", body: "volume" },
  ],
  payments: [],   // discounts + cancellations open as detail overlays, not tabs
  tax: [],
  items: [
    { key: "items", label: "Items", icon: "fa-utensils", body: "dishes" },
    { key: "categories", label: "Categories", icon: "fa-layer-group", body: "categories" },
    { key: "menu", label: "Menu engineering", icon: "fa-lightbulb", body: "menu" },
  ],
  timing: [
    { key: "hours", label: "By hour", icon: "fa-clock", body: "hourly" },
    { key: "dayparts", label: "Day parts", icon: "fa-sun", body: "daypart" },
    { key: "weekday", label: "Day of week", icon: "fa-calendar-week", body: "weekday" },
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
type TaxInfo = { effectivePct: number; components: { label: string; rate: number; amount: number }[]; configured: boolean } | null;
type PayRow = { method: string; revenue: number; orders: number };
type DishRow = { title: string; qty: number; revenue: number };
type CatRow = { category: string; qty: number; revenue: number };
type HourRow = { hour: number; orders: number; revenue: number };
type Payload = { rows?: unknown[]; totals?: Totals; tax?: TaxInfo; payments?: PayRow[]; bucket?: string; drillBucket?: string; drillRows?: unknown[] };
type Entry = { loading?: boolean; error?: string; data?: Payload };

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

// Split a tax total across its lines PROPORTIONALLY to their rates, to the paise, with the
// last line absorbing the rounding remainder so the parts ALWAYS add back to the total
// exactly. Paise (not whole rupees) is the fix for the owner's "both are 2.5% — why is CGST
// ₹81,370 but SGST ₹81,369?" — an odd total (₹162,739) splits to ₹81,369.50 + ₹81,369.50,
// two EQUAL halves. Mirrors the server's own split (route.ts) so screen == printed bill.
function splitTax(rates: number[], target: number): number[] {
  const sum = rates.reduce((a, r) => a + r, 0) || 1;
  const p2 = (v: number) => Math.round(v * 100) / 100;
  let running = 0;
  return rates.map((r, i) => {
    const amt = i === rates.length - 1 ? p2(target - running) : p2(target * (r / sum));
    running = p2(running + amt);
    return amt;
  });
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

// ── Menu-engineering quadrant (client-only view over the dishes payload) ──────
type MI = { title: string; qty: number; revenue: number };
type Klass = "star" | "workhorse" | "puzzle" | "dog";
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function classifyMenu(rows: MI[]) {
  const clean = rows.filter((r) => (Number(r.qty) || 0) > 0);
  const totalQty = clean.reduce((a, r) => a + r.qty, 0);
  const totalRev = clean.reduce((a, r) => a + r.revenue, 0);
  const medQty = median(clean.map((r) => r.qty));
  const medPrice = median(clean.map((r) => (r.qty ? r.revenue / r.qty : 0)));
  const dishes = clean.map((r) => {
    const price = r.qty ? r.revenue / r.qty : 0;
    const klass: Klass = r.qty >= medQty && price >= medPrice ? "star" : r.qty >= medQty ? "workhorse" : price >= medPrice ? "puzzle" : "dog";
    return { ...r, price, qtyShare: totalQty ? r.qty / totalQty : 0, revShare: totalRev ? r.revenue / totalRev : 0, klass };
  });
  return { dishes };
}

const DAYPARTS: { label: string; icon: string; hours: number[] }[] = [
  { label: "Morning",    icon: "fa-mug-hot",   hours: [5, 6, 7, 8, 9, 10, 11] },
  { label: "Afternoon",  icon: "fa-sun",       hours: [12, 13, 14, 15, 16] },
  { label: "Evening",    icon: "fa-cloud-sun", hours: [17, 18, 19, 20, 21] },
  { label: "Late night", icon: "fa-moon",      hours: [22, 23, 0, 1, 2, 3, 4] },
];

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
      avgbill: { sel: "sales", sub: "avgbill" }, volume: { sel: "sales", sub: "volume" },
      weekday: { sel: "timing", sub: "weekday" }, hourly: { sel: "timing", sub: "hours" }, daypart: { sel: "timing", sub: "dayparts" },
      dishes: { sel: "items", sub: "items" }, categories: { sel: "items", sub: "categories" }, menu: { sel: "items", sub: "menu" },
      discounts: { sel: "payments", pay: "discounts" }, cancellations: { sel: "payments", pay: "cancellations" },
    };
    return map[k] ?? null;
  };
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get("open");
    const a = open && openAlias(open);
    if (a) { setSel(a.sel); if (a.sub) setSub(a.sub); if (a.pay) setPayDetail(a.pay); }
  }, []);

  // ── Scroll memory (owner 2026-07-26: "when I click back it takes me to the top — it
  // should keep me where I was"). The owner panel scrolls INSIDE `.adm-main`, not the
  // window, so save/restore THAT element's scrollTop. Opening a report jumps to the top of
  // the report; going back to the hub restores exactly where the owner was browsing.
  const scroller = () => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".adm-main"));
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
  useEffect(() => { if (scopePin) setRid(scopePin); }, [scopePin]);

  // ── Instant-paint (owner 2026-07-26): last-seen report payloads from THIS tab paint at
  // ~0ms with the usual count-up/chart animations, then the normal fetch revalidates and
  // swaps in anything newer. Only settled `data` entries are persisted (never loading/error
  // states), and `started` is untouched, so every hydrated entry still refetches. Cleared
  // on login (lib/ownerSnap.ts).
  const snapKey = `reports${scopePin ? `:${scopePin}` : ""}`;
  useEffect(() => {
    const s = readSnap<{ rid?: string; entries?: Record<string, Entry> }>(snapKey);
    if (!s) return;
    if (s.entries) setStore((cur) => ({ ...s.entries, ...cur }));
    // Deliberately NOT restoring the last-picked restaurant: the owner's rule (2026-07-26)
    // is that Reports always OPENS on "All restaurants" (a multi-restaurant estate) — a
    // restaurant is a per-visit choice, not a sticky one. (A single-restaurant owner still
    // gets pinned by the overview effect; admin act-as still pins from ?rid.)
  }, [snapKey, scopePin]);
  useEffect(() => {
    const settled = Object.fromEntries(Object.entries(store).filter(([, e]) => e.data));
    if (Object.keys(settled).length) writeSnap(snapKey, { rid, entries: settled });
  }, [snapKey, store, rid]);

  useEffect(() => {
    fetch(`/api/owner/overview?_=1${scp}`, { cache: "no-store" }).then((r) => r.json()).then((o) => {
      // Overview returns camelCase (accentColor) — reading accent_color left every chart
      // on the fallback green instead of the restaurant's own brand accent.
      const list: Rest[] = (o.restaurants ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, name: r.name as string, accent: (r.accentColor as string) || "",
      }));
      setRests(list);
      // rid is already pinned from the URL for admin act-as; a single-restaurant owner
      // (no ?rid) gets pinned here once we know there's exactly one.
      if (!scopePin && list.length === 1) setRid(list[0].id);
      setReady(true);
    }).catch(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The effective backend window for the ACTIVE report: a day-kind report is always a
  // single day (range=custom, from=to=day); a report on the "Custom…" range uses the
  // date pickers; everything else is the plain named range.
  const effFor = (kind: DataKind, rg: Range): { range: Range; from?: string; to?: string } =>
    DAY_KINDS.has(kind) ? { range: "custom", from: day, to: day }
    : rg === "custom" ? { range: "custom", from: cFrom, to: cTo }
    : { range: rg };
  const cacheKey = (kind: DataKind, r: string, rg: Range) => {
    const e = effFor(kind, rg);
    return `${kind}|${r}|${e.range}${e.from ? `|${e.from}|${e.to}` : ""}`;
  };
  // A key is fetched at most once (period/rid/kind combos are stable) — dedup via a ref so
  // React StrictMode's double-invoke can't double-fetch, and no stale `store` closure.
  const started = useRef<Set<string>>(new Set());
  const ensure = useCallback((kind: DataKind, r: string, rg: Range, eff: { range: Range; from?: string; to?: string }) => {
    const ck = `${kind}|${r}|${eff.range}${eff.from ? `|${eff.from}|${eff.to}` : ""}`;
    if (started.current.has(ck)) return;
    started.current.add(ck);
    // Instant-paint: if a hydrated snapshot already fills this key, keep showing it while
    // the fetch revalidates silently (SWR) — only a truly empty key shows the skeleton.
    setStore((s) => (s[ck]?.data ? s : { ...s, [ck]: { loading: true } }));
    const q = new URLSearchParams({ type: apiType(kind), range: eff.range });
    if (eff.from) { q.set("from", eff.from); q.set("to", eff.to as string); }
    if (r) q.set("rid", r);
    if (scopePin) q.set("scope", scopePin);
    fetch(`/api/owner/reports?${q}`, { cache: "no-store" })
      .then((x) => x.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setStore((s) => ({ ...s, [ck]: { data: d } }));
      })
      .catch((e) => {
        started.current.delete(ck);                       // allow a later retry
        // A failed SILENT revalidate must never blank numbers already on screen (offline
        // reload on a hydrated snapshot) — keep the shown data; only an empty key errors.
        setStore((s) => (s[ck]?.data ? s : { ...s, [ck]: { error: e instanceof Error ? e.message : String(e) } }));
      });
  }, [scopePin]);

  // The active body (sub-tab aware) and the payload it reads. The hub reads "money".
  const bodyKey: BodyKey = sel ? bodyKeyFor(sel, sub) : "sales";
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
  const dayEff = { range: "custom" as Range, from: day, to: day };
  const dayKeyFor = (kind: DataKind) => `${kind}|${rid}|custom|${day}|${day}`;
  useEffect(() => {
    if (!ready) return;
    if (isCustom && !customOk) return;                      // wait for a valid custom range
    ensure(activeKind, rid, range, effFor(activeKind, range));
    if (needMoneyToo) ensure("money", rid, range, effFor("money", range));
    if (sel === "daysummary") { ensure("dishes", rid, "custom", dayEff); ensure("hourly", rid, "custom", dayEff); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeKind, rid, range, day, cFrom, cTo, ensure, needMoneyToo, sel]);

  const entry = store[cacheKey(activeKind, rid, range)];
  const data = entry?.data;
  const moneyEntry = store[cacheKey("money", rid, range)];
  const dishesDay = store[dayKeyFor("dishes")]?.data;
  const hourlyDay = store[dayKeyFor("hourly")]?.data;
  const restName = rid ? (rests.find((r) => r.id === rid)?.name ?? "This restaurant") : "All restaurants";
  // Charts follow the owner-panel THEME (green), not each restaurant's brand colour —
  // a brown/orange/red chart inside the green owner console read as a bug (owner 2026-07-25).
  const accent = "var(--accent)";
  const singleRest = !!rid;

  // Sub-tabs for the current report + the export meta for whatever sub-view is showing.
  const subTabs = sel ? SUBTABS[sel] : [];
  const activeSubKey = subTabs.length ? (subTabs.find((t) => t.key === sub)?.key ?? subTabs[0].key) : "";
  const activeSubLabel = subTabs.find((t) => t.key === activeSubKey)?.label ?? "";
  const exportMeta = { label: sel ? REPORTS[sel].label + (activeSubLabel ? ` · ${activeSubLabel}` : "") : "", kind: BODY_KIND[bodyKey] };
  const exportCtx = data ? {
    meta: exportMeta, data, restName, periodLabel: effLabel, isTax: bodyKey === "tax", bucketLabel,
    extra: sel === "daysummary" ? dayExtraTables(dishesDay, hourlyDay) : undefined,
  } : null;

  // ── Print ask-dialog (owner 2026-07-26: "when you click print it should autofill the date
  // you're on, with Today/Yesterday quick options — and for ranged reports ask from which to
  // which date"). Confirming with the SAME period prints at once; picking another date/range
  // first applies it (same controls as on screen), waits for that data, THEN prints.
  const [printAsk, setPrintAsk] = useState(false);
  const [pdDay, setPdDay] = useState(day);                 // dialog's day (day-kind reports)
  const [pdFrom, setPdFrom] = useState("");                // dialog's from/to (ranged reports)
  const [pdTo, setPdTo] = useState("");
  const [printWhenReady, setPrintWhenReady] = useState(false);
  const openPrintAsk = () => {
    setPdDay(day);
    const w = rangeDates(range, cFrom, cTo);
    setPdFrom(w.from); setPdTo(w.to);
    setPrintAsk(true);
  };
  const confirmPrint = () => {
    setPrintAsk(false);
    if (isDayKind) {
      if (pdDay === day) { if (exportCtx) printSection(exportCtx); return; }
      setDay(pdDay); setPrintWhenReady(true);
    } else {
      const cur = rangeDates(range, cFrom, cTo);
      if (pdFrom === cur.from && pdTo === cur.to) { if (exportCtx) printSection(exportCtx); return; }
      setRange("custom"); setCFrom(pdFrom); setCTo(pdTo); setPrintWhenReady(true);
    }
  };
  // Print as soon as the newly-picked period's data (and the day sheet's extras) settle.
  const extrasSettled = sel !== "daysummary" ||
    ((): boolean => { const d = store[dayKeyFor("dishes")], h = store[dayKeyFor("hourly")]; return !!(d && !d.loading && (d.data || d.error)) && !!(h && !h.loading && (h.data || h.error)); })();
  useEffect(() => {
    if (!printWhenReady || !exportCtx || entry?.loading || !extrasSettled) return;
    setPrintWhenReady(false);
    printSection(exportCtx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printWhenReady, data, entry?.loading, extrasSettled]);
  useBackClose("owner-print-ask", printAsk, () => setPrintAsk(false));

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
          <div className="rs-seg" role="tablist" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r.k} role="tab" aria-selected={range === r.k} className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.label}</button>
            ))}
          </div>
        )}
        {isCustom && (
          <div className="rs-custom">
            <input type="date" className="rs-date" value={cFrom} max={cTo} onChange={(e) => setCFrom(e.target.value)} aria-label="From date" />
            <i className="fas fa-arrow-right" aria-hidden />
            <input type="date" className="rs-date" value={cTo} min={cFrom} max={istToday()} onChange={(e) => setCTo(e.target.value)} aria-label="To date" />
          </div>
        )}
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

      {/* Sub-tab strip — the merge (owner 2026-07-26): one report, several views, no hop. */}
      {sel && subTabs.length > 0 && (
        <div className="rs-subtabs" role="tablist" aria-label={`${REPORTS[sel].label} views`}>
          {subTabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === activeSubKey}
              className={"rs-subtab" + (t.key === activeSubKey ? " on" : "")} onClick={() => setSub(t.key)}>
              <i className={`fas ${t.icon}`} aria-hidden /> {t.label}
            </button>
          ))}
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
                    <input type="date" className="rs-date" value={pdTo} min={pdFrom} max={istToday()} onChange={(e) => setPdTo(e.target.value)} aria-label="Print to date" />
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
          rests={rests} rid={rid} onPickRest={setRid}
          briefQs={`type=byrestaurant&range=${range}${range === "custom" ? `&from=${cFrom}&to=${cTo}` : ""}${scp}`} />
      ) : (
        <ReportView sel={sel} bodyKey={bodyKey} data={data} loading={entry?.loading} error={entry?.error}
          rangeText={effLabel} accent={accent} restName={restName} singleRest={singleRest}
          onOpenReport={openReport} payDetail={payDetail} onPayDetail={setPayDetail}
          moneyData={moneyEntry?.data} dishesDay={dishesDay} hourlyDay={hourlyDay} />
      )}
    </div>
  );
}

// ── The hub: hero snapshot + per-restaurant brief + categorised report cards ──
function Hub({ range, money, restName, accent, onOpen, rests, rid, onPickRest, briefQs }: {
  range: Range; money?: Entry; restName: string; accent: string; onOpen: (k: RKey) => void;
  rests: Rest[]; rid: string; onPickRest: (id: string) => void; briefQs: string;
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
  useEffect(() => {
    if (!showBrief) { setBrief(null); return; }
    let live = true;
    fetch(`/api/owner/reports?${briefQs}`, { cache: "no-store" }).then((r) => r.json())
      .then((d) => { if (Array.isArray(d.rows)) { briefMemo.set(briefQs, d.rows); if (live) setBrief(d.rows); } }).catch(() => {});
    return () => { live = false; };
  }, [showBrief, briefQs]);
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
        <div className="rs-ov-val"><AnimatedNumber value={t?.revenue || 0} money loading={loading} /></div>
        <div className="rs-ov-sub">Total collected this period — GST included{money?.error ? " — couldn't load" : ""}</div>
        <div className="rs-ov-kpis">
          <div className="k"><span className="lbl">Net sales</span><span className="v"><AnimatedNumber value={Math.max(0, (t?.subtotal || 0) - (t?.discount || 0))} money loading={loading} /></span></div>
          <div className="k"><span className="lbl">Paid bills</span><span className="v"><AnimatedNumber value={t?.paidOrders || 0} format={nfmt} loading={loading} /></span></div>
          <div className="k"><span className="lbl">Avg bill</span><span className="v"><AnimatedNumber value={avg} money loading={loading} /></span></div>
          <div className="k"><span className="lbl">GST collected</span><span className="v"><AnimatedNumber value={t?.tax || 0} money loading={loading} /></span></div>
          <div className="k"><span className="lbl">Discounts</span><span className="v"><AnimatedNumber value={t?.discount || 0} money loading={loading} /></span></div>
        </div>
        <div className="rs-ov-chart">
          {loading
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

      {CATEGORIES.map((cat) => (
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
function ReportView({ sel, bodyKey, data, loading, error, rangeText, accent, restName, singleRest, onOpenReport, payDetail, onPayDetail, moneyData, dishesDay, hourlyDay }: {
  sel: RKey; bodyKey: BodyKey; data?: Payload; loading?: boolean; error?: string;
  rangeText: string; accent: string; restName: string; singleRest: boolean;
  onOpenReport: OpenReport;
  payDetail: "" | "discounts" | "cancellations"; onPayDetail: (d: "" | "discounts" | "cancellations") => void;
  moneyData?: Payload; dishesDay?: Payload; hourlyDay?: Payload;
}) {
  const meta = REPORTS[sel];
  const tone = meta.tone || "accent";
  return (
    <div className={`rs-report tone-${tone}`} id="rs-print">
      <PrintHead restName={restName} title={meta.label} period={rangeText} />
      <div className="rs-rtitle">
        <span className="cic"><i className={`fas ${meta.icon}`} aria-hidden /></span>
        <div><h2>{meta.label}</h2><div className="scope">{restName} · {rangeText}</div></div>
      </div>
      {error ? (
        <Panel><div className="rs-empty"><i className="fas fa-triangle-exclamation" aria-hidden />{error}</div></Panel>
      ) : loading || !data ? (
        <div className="rs-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="rs-stat tone-accent" style={{ opacity: .5 }}><div className="rs-stat-k">Loading…</div><div className="rs-stat-v">—</div></div>)}</div>
      ) : (
        <ReportBody bk={bodyKey} data={data} accent={accent} singleRest={singleRest} onOpenReport={onOpenReport}
          onPayDetail={onPayDetail} dishesDay={dishesDay} hourlyDay={hourlyDay} />
      )}
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

function ReportBody({ bk, data, accent, singleRest, onOpenReport, onPayDetail, dishesDay, hourlyDay }: { bk: BodyKey; data: Payload; accent: string; singleRest: boolean; onOpenReport: OpenReport; onPayDetail?: (d: "" | "discounts" | "cancellations") => void; dishesDay?: Payload; hourlyDay?: Payload }) {
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

  // ── DAY SUMMARY ──
  if (bk === "daysummary") {
    if (!t) return <EmptyCard text="Nothing in this period yet." />;
    const pays = (data.payments || []).map((p) => ({ ...p, method: canonPayMethod(p.method) })).filter((p) => p.revenue > 0);
    const payTotal = pays.reduce((a, p) => a + p.revenue, 0);
    const avg = t.paidOrders ? t.revenue / t.paidOrders : 0;
    // Split the WHOLE-RUPEE tax (GST returns round to the rupee): equal rates then always
    // show equal halves (₹81,369.50 each), and the lines sum exactly to the displayed
    // whole-rupee "GST collected" — no ₹163 parent over ₹81.25+81.25 children (audit 2026-07-27).
    const taxLines = data.tax
      ? splitTax(data.tax.components.map((c) => c.rate), Math.round(t.tax)).map((amt, i) => ({ label: data.tax!.components[i].label, rate: data.tax!.components[i].rate, amt }))
      : [];
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Total collected" tone="accent" icon="fa-indian-rupee-sign" big value={inr(t.revenue)} sub="everything guests paid — GST included" spark={series.map((s) => s.revenue)} />
          <Stat label="Net sales" tone="good" icon="fa-sack-dollar" value={inr(t.subtotal - t.discount)} sub="your earnings, before GST" />
          <Stat label="Paid bills" tone="info" icon="fa-receipt" value={nfmt(t.paidOrders)} sub={`${nfmt(t.orders)} orders total`} />
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" value={inr(avg)} />
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" value={inr(t.tax)} onClick={() => onOpenReport("tax")} title="Open the Tax / GST report" />
          <Stat label="Cancelled" tone="bad" icon="fa-ban" value={nfmt(t.cancelledOrders)} sub={`${inr(t.cancelledValue)} lost`} onClick={() => onOpenReport("payments", { pay: "cancellations" })} title="Open the Cancellations report" />
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
              <b>Total collected</b> is every rupee guests paid — it includes the {inr(t.tax)} GST, which isn&apos;t yours to keep.
              Your actual sales are the <b>Net sales</b> line ({inr(t.subtotal - t.discount)}).
              {!singleRest && " Pick one restaurant to see its CGST/SGST split."}
            </p>
          </Panel>

          <Panel title="Settlement" hint="how the money arrived"
            right={<button type="button" className="rs-drill" onClick={() => onOpenReport("payments")} title="Open the Payment settlement report">Full report <i className="fas fa-arrow-right" aria-hidden /></button>}>

            {pays.length === 0 ? <div className="rs-empty" style={{ padding: 20 }}>No payments recorded.</div> : (
              <div className="rs-paylist">
                {pays.map((p) => {
                  const c = PAY_COLORS[p.method] || PAY_COLORS["Not recorded"];
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
              <div className="rs-line"><span className="lbl">Orders placed</span><span className="val">{nfmt(t.orders)}</span></div>
              <div className="rs-line"><span className="lbl">Paid bills</span><span className="val">{nfmt(t.paidOrders)}</span></div>
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
              series={series.map((s) => ({ label: s.label, value: s.revenue }))}
              money noun="income"
              unit={chartUnit}
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
        <Panel title="Revenue over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={series.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money height={240} /></div>
        </Panel>
        {series.filter((s) => s.revenue > 0).length > 1 && (
          <BestWorst
            series={series.map((s) => ({ label: s.label, value: s.revenue }))}
            money noun="revenue"
            unit={chartUnit}
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
          <Stat label="Highest bucket" tone="good" icon="fa-arrow-up" value={inr(withData.length ? Math.max(...withData) : 0)} />
          <Stat label="Lowest bucket" tone="warn" icon="fa-arrow-down" value={inr(withData.length ? Math.min(...withData) : 0)} />
        </div>
        <Panel title="Average bill over time" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={avgSeries.map((s) => ({ label: s.label, value: s.revenue }))} color={accent} money name="Avg bill" height={240} /></div>
        </Panel>
        {withData.length > 1 && (
          <BestWorst
            series={avgSeries.map((s) => ({ label: s.label, value: s.revenue }))}
            money noun="basket size"
            title={`Fullest & thinnest ${chartUnit}`}
            unit={chartUnit}
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
          <Stat label="Orders placed" tone="info" icon="fa-list-check" big value={nfmt(placed)} sub={`${nfmt(t.paidOrders)} paid · ${nfmt(t.cancelledOrders)} cancelled`} spark={vol.map((v) => v.value)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
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
          <BestWorst series={vol} money={false} noun="orders" unit={unitWord} />
        )}
        <MoneyTable rows={mrows} totals={t} bucket={bucket} />
      </>
    );
  }

  // ── DAY OF WEEK ──
  if (bk === "weekday") {
    if (bucket !== "day") return <EmptyCard text="Pick a daily period (7 days, 30 days, this or last month) to see the day-of-week breakdown." />;
    const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const by = new Map<string, { rev: number; orders: number; days: number }>();
    for (const r of mrows) {
      const wd = new Date(r.bucket).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
      const cur = by.get(wd) || { rev: 0, orders: 0, days: 0 };
      cur.rev += r.revenue; cur.orders += r.paidOrders; cur.days += (r.revenue > 0 || r.paidOrders > 0) ? 1 : 0;
      by.set(wd, cur);
    }
    const FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
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
    const taxable = t.subtotal - t.discount;                       // the value tax is charged on
    const actualPct = taxable ? (t.tax / taxable) * 100 : 0;       // rate the numbers actually realised
    const configuredPct = data.tax?.effectivePct ?? null;         // the rate that's set up
    const rateOk = configuredPct == null || Math.abs(actualPct - configuredPct) < 0.5;
    const avgTaxPerBill = t.paidOrders ? t.tax / t.paidOrders : 0;
    const comps = data.tax?.components ?? [];
    // Per-period filing view: split each period's tax across the set tax lines, integer-rounded
    // so each row's parts still sum to that row's total tax (matches the printed-bill split).
    // Whole-rupee per-row tax (GST-return rounding) so each row's parts sum exactly to the
    // row's displayed total, and two equal rates never differ by a paisa.
    const filingRows = (comps.length ? mrows.filter((r) => r.tax > 0) : []).map((r) => ({
      bucket: r.bucket,
      taxable: r.subtotal - r.discount,
      tax: Math.round(r.tax),
      parts: splitTax(comps.map((c) => c.rate), Math.round(r.tax)),
    }));
    const compTotals = comps.map((_, i) => filingRows.reduce((a, r) => a + r.parts[i], 0));
    const filingTaxable = filingRows.reduce((a, r) => a + r.taxable, 0);
    const filingTax = filingRows.reduce((a, r) => a + r.tax, 0);
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Tax collected" tone="accent" icon="fa-landmark" big value={inr(t.tax)} sub={`${nfmt(t.paidOrders)} paid bills`} spark={mrows.map((r) => r.tax)} onClick={() => scrollToId("rs-by-period")} title="Jump to the by-period table" />
          <Stat label="Taxable sales" tone="accent" icon="fa-cart-shopping" value={inr(taxable)} sub="subtotal − discount" />
          <Stat label="Effective rate" tone={rateOk ? "good" : "warn"} icon="fa-percent" value={`${actualPct.toFixed(2)}%`}
            sub={configuredPct != null ? (rateOk ? `matches the set ${configuredPct}%` : `set rate is ${configuredPct}%`) : "tax ÷ taxable sales"} />
          <Stat label="Tax per bill" tone="info" icon="fa-receipt" value={inr(avgTaxPerBill)} sub="average" />
        </div>
        {configuredPct != null && !rateOk && (
          <p className="rs-note" style={{ marginTop: -4, marginBottom: 12 }}>
            <i className="fas fa-triangle-exclamation" aria-hidden style={{ color: "var(--adm-warn)", marginRight: 6 }} />
            The rate the bills actually realised ({actualPct.toFixed(2)}%) doesn&apos;t match the set rate ({configuredPct}%) — usually from tax-free or specially-priced items in this period. Worth a look before filing.
          </p>
        )}
        {data.tax ? (
          <Panel title="The split" hint="same total, shown the way the printed bill shows it">
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead><tr><th>Tax line</th><th className="num">Rate</th><th className="num">Collected</th></tr></thead>
                <tbody>
                  <tr><td><b>Total tax</b></td><td className="num">{data.tax.effectivePct}%</td><td className="num"><b>{inr(t.tax)}</b></td></tr>
                  {splitTax(data.tax.components.map((c) => c.rate), Math.round(t.tax)).map((amt, i) => {
                    const c = data.tax!.components[i];
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
            <LeaderBar data={top5} />
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
            <LeaderBar data={top5} />
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
    const pays = [...merged.values()].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue);
    const total = pays.reduce((a, p) => a + p.revenue, 0);
    const bills = pays.reduce((a, p) => a + p.orders, 0);
    const top = pays[0];
    const topShare = total ? (top.revenue / total) * 100 : 0;
    const avgBill = bills ? total / bills : 0;
    return (
      <>
        <div className="rs-kpis">
          <Stat label="Total collected" tone="accent" icon="fa-indian-rupee-sign" big value={inr(total)} sub={`${nfmt(bills)} bills settled`} />
          <Stat label="Top method" tone="good" icon="fa-wallet" value={canonPayMethod(top?.method)} sub={`${Math.round(topShare)}% of money · ${nfmt(top?.orders || 0)} bills`} onClick={() => scrollToId("rs-pay-method")} title="Jump to the per-method table" />
          <Stat label="Average bill" tone="info" icon="fa-scale-balanced" value={inr(avgBill)} />
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
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: PAY_COLORS[p.method] || PAY_COLORS["Not recorded"], flexShrink: 0 }} />
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
          <Stat label="Peak hour" tone="accent" icon="fa-fire" big value={hourLabel(peak.hour)} sub={`${inr(peak.revenue)} · ${nfmt(peak.orders)} orders`} spark={ordSeries.map((s) => s.value)} onClick={() => scrollToId("rs-hourly-table")} title="Jump to the hour-by-hour table" />
          <Stat label="Quietest hour" tone="info" icon="fa-moon" value={quietest ? hourLabel(quietest.hour) : "—"} sub={quietest ? `${inr(quietest.revenue)} · ${nfmt(quietest.orders)} orders` : "no orders yet"} onClick={quietest ? () => scrollToId("rs-hourly-table") : undefined} title={quietest ? "Jump to the hour-by-hour table" : undefined} />
          <Stat label="Total orders" tone="info" icon="fa-list-check" value={nfmt(totalOrders)} />
          <Stat label="Total revenue" tone="accent" icon="fa-indian-rupee-sign" value={inr(totalRev)} />
          <Stat label="Avg bill" tone="good" icon="fa-scale-balanced" value={inr(avgBill)} sub="revenue ÷ orders" />
        </div>
        {top3.length > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            Your three busiest hours — <b>{top3.map((h) => hourLabel(h.hour)).join(", ")}</b> — bring in{" "}
            <b>{top3Share}%</b> of the period&apos;s revenue. Staff and stock for those windows first.
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
              <thead><tr><th>Hour</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">% of revenue</th><th className="num">Avg bill</th></tr></thead>
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
          {parts.map((p) => <Stat key={p.label} label={p.label} tone="info" icon={p.icon} value={inr(p.rev)} sub={`${nfmt(p.orders)} orders`} />)}
        </div>
        {best.rev > 0 && (
          <p className="rs-note" style={{ marginBottom: 12 }}>
            <b>{best.label}</b> is your money-maker — <b>{totalRev ? Math.round((best.rev / totalRev) * 100) : 0}%</b> of everything you take.
            {weakest && weakest.label !== best.label && <> <b>{weakest.label}</b> is the quietest stretch; a small offer there can even out the day.</>}
          </p>
        )}
        <Panel title="Revenue by day part" pad={false}>
          <div style={{ padding: 12 }}><ToggleChart data={chart.map((c) => ({ label: c.label, value: c.revenue }))} color={accent} money height={230} title="How the day splits" /></div>
        </Panel>
        <Panel id="rs-daypart-breakdown" title="Breakdown" hint="each stretch of the day" pad={false}>
          <div className="rs-tablewrap">
            <table className="rs-table">
              <thead><tr><th>Day part</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">% share</th><th className="num">Avg bill</th></tr></thead>
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
