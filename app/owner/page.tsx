"use client";
// Owner · Dashboard (redesign 2026-07-04, tiers extended 2026-07-06) — ADAPTIVE
// by restaurant count:
//   · 1 restaurant  → the dashboard IS that restaurant (hero header + charts up
//     front — a "who earns more" bar with one bar is useless, owner's complaint).
//   · 2 restaurants → head-to-head comparison + two-line trend.
//   · 3–9           → leaderboard bar + multi-line trend + card grid; click drills in
//     (5+ caps the trend at the top-5 lines so it stays readable).
//   · 10+           → HQ mode: ONE sortable, searchable table (cards would be a wall
//     of noise); scales to 50+. Sidebar (OwnerShell) always lists every restaurant.
// Every KPI carries a ▲/▼ delta vs the previous equal-length period + a sparkline,
// and an insight strip says in plain words what the numbers mean. All data arrives
// pre-aggregated from /api/owner/{overview,analytics,reports} (tiny rows, mig-113
// paid-only rule everywhere). Refresh: activity-gated ~60s + manual — no websocket.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { inr, useActiveAutoRefresh } from "@/components/admin/shared";
import {
  AreaTrend, TimeBar, LeaderBar, HourlyBar, CategoryDonut, PaymentDonut, canonPayMethod, Spark, DeltaChip,
  SameHourBar, PayTrendStack,
} from "@/components/owner/Charts";
import { businessDayStartIso } from "@/lib/businessDay";
import RangeSlider from "@/components/owner/RangeSlider";

const DAY_MS = 86400000;
type Range = "today" | "yesterday" | "7d" | "30d" | "all";
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "yesterday", label: "Yesterday" },
  { k: "7d", label: "7 days" }, { k: "30d", label: "30 days" }, { k: "all", label: "All time" },
];
const RANGE_LABEL: Record<Range, string> = {
  today: "today", yesterday: "yesterday", "7d": "the last 7 days", "30d": "the last 30 days", all: "all time",
};
const PREV_LABEL: Record<Range, string> = {
  today: "vs yesterday (same hours)", yesterday: "vs the day before", "7d": "vs the 7 days before",
  "30d": "vs the 30 days before", all: "",
};

type Restaurant = {
  id: string; slug: string; name: string; active: boolean; accentColor: string;
  ordersToday: number; revenueToday: number; ordersAll: number; revenueAll: number; openTables: number;
};
type Overview = { restaurants: Restaurant[]; totals: { revenueToday: number; ordersToday: number; openTables: number; restaurantCount: number } };
type GroupRev = { id: string; slug: string; name: string; accentColor: string; revenue: number; orders: number };
type TsRow = { bucket: string; restaurantId?: string; revenue: number; orders: number };
type Pay = { method: string; revenue: number; orders: number };
type Prev = { revenue: number; orders: number } | null;
type GroupA = { scope: "group"; restaurantRevenue: GroupRev[]; timeseries: TsRow[]; paymentMethods: Pay[]; prev: Prev };
type Dish = { title: string; qty: number; revenue: number };
type RestA = {
  scope: "restaurant"; prev: Prev;
  restaurant: { id: string; slug: string; name: string; accentColor: string; heroTitle: string };
  kpis: { revenue: number; orders: number; avgOrder: number; openTables: number; topDish: string };
  timeseries: TsRow[]; dishes: Dish[]; categories: { category: string; qty: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[]; paymentMethods: Pay[];
  sameHour?: { start: string; revenue: number; orders: number }[];
  payTrend?: { day: string; method: string; revenue: number }[];
  records?: {
    bestDay?: { date: string; revenue: number } | null;
    bigBill?: { table: string | null; revenue: number } | null;
    fastHour?: { at: string; orders: number } | null;
    starDish?: { title: string; qty: number } | null;
    regulars?: number | null;
  } | null;
};
type MoneyTotals = { revenue: number; discount: number; cancelledOrders: number; cancelledValue: number; tax: number };
type View = { level: "home" } | { level: "restaurant"; rid: string } | { level: "dish"; rid: string; dish: string };

const FALLBACK = "#34d399";
// Labels for the same-elapsed-time comparison windows, per range. Order matches
// the API: [current, the period right before, same weekday last week, 4 weeks back].
const SAMEHOUR_LABEL: Partial<Record<Range, string[]>> = {
  today: ["Today (till now)", "Yesterday (till now)", "Last week (till now)", "4 weeks ago (till now)"],
  yesterday: ["Yesterday", "Day before", "Same day last week", "4 weeks before"],
  "7d": ["This week", "Week before", "2 weeks back", "4 weeks back"],
  "30d": ["These 30 days", "30 days before", "60 days back", "90 days back"],
};

const IST = "Asia/Kolkata";
function tsLabel(iso: string, range: Range): string {
  const d = new Date(iso);
  if (range === "today" || range === "yesterday") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
}
// A stable IST key for a bucket instant, at the range's granularity — used to line
// timeseries rows up against a COMPLETE bucket sequence so days/hours with no sales
// show as a zero, not a hidden gap that makes the trend lie (found 2026-07-05).
function istKey(d: Date, range: Range): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  if (range === "today" || range === "yesterday") return `${p.year}-${p.month}-${p.day} ${p.hour}`;
  return `${p.year}-${p.month}-${p.day}`;
}
// The full ordered list of buckets we EXPECT for a range (so gaps become zeros). "all"
// is unbounded, so it's left to whatever the data spans (no fill).
function expectedBuckets(range: Range): { key: string; label: string }[] {
  const now = new Date();
  const out: { key: string; label: string }[] = [];
  if (range === "today" || range === "yesterday") {
    // Align the hourly buckets to the SERVER's 05:00-IST business day, not the
    // calendar day. Before this, the client built calendar-day hour keys while the
    // server bucketed by the 05:00-IST business day, so between 00:00 and 05:00 IST
    // the two key sequences never intersected and the chart went blank (bug H5).
    // "today" also stops at the current hour so future hours aren't zero-padded
    // (which used to drag the whole line down to zero for the rest of the day).
    const startMs = Date.parse(businessDayStartIso(now)) - (range === "yesterday" ? DAY_MS : 0);
    const endMs = range === "yesterday" ? startMs + DAY_MS - 1 : now.getTime();
    for (let t = startMs; t <= endMs; t += 3600_000) {
      const d = new Date(t);
      out.push({ key: istKey(d, range), label: d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true, timeZone: IST }) });
    }
  } else if (range === "7d" || range === "30d") {
    const n = range === "7d" ? 7 : 30;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      out.push({ key: istKey(d, range), label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }) });
    }
  }
  return out;
}

// Plain-language "exact days" caption under the range control, so the owner always
// knows the precise window a number covers (part of the 2026-07-06 range redesign).
function rangeSpanText(k: Range): string {
  const now = new Date();
  const f = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
  if (k === "today") return `Today · ${f(now)}`;
  if (k === "yesterday") return `Yesterday · ${f(new Date(now.getTime() - DAY_MS))}`;
  if (k === "7d") return `${f(new Date(now.getTime() - 6 * DAY_MS))} – ${f(now)} (7 days)`;
  if (k === "30d") return `${f(new Date(now.getTime() - 29 * DAY_MS))} – ${f(now)} (30 days)`;
  return `Everything up to ${f(now)}`;
}

// Count-up: eases a number to its target so tiles feel alive without lying —
// respects prefers-reduced-motion (jumps straight to the value).
function useCountUp(target: number, ms = 420): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = target; setVal(target); return;
    }
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

function Kpi({ k, v, money, delta, prevTitle, spark, color, sub }: {
  k: string; v: number | string; money?: boolean; delta?: { now: number; prev: number | null };
  prevTitle?: string; spark?: number[]; color?: string; sub?: string;
}) {
  const n = useCountUp(typeof v === "number" ? v : 0);
  return (
    <div className="adm-stat owx-kpi">
      <div className="k">{k}</div>
      <div className="row">
        <div className="v">{typeof v === "number" ? (money ? inr(n) : Math.round(n).toLocaleString("en-US")) : v}</div>
        {delta && <DeltaChip now={delta.now} prev={delta.prev} title={prevTitle || ""} />}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
      {spark && spark.length > 1 && <Spark points={spark} color={color || "#34d399"} />}
    </div>
  );
}

export default function OwnerDashboard() {
  const [view, setView] = useState<View>({ level: "home" });
  const [range, setRange] = useState<Range>("today");
  const [ov, setOv] = useState<Overview | null>(null);
  const [group, setGroup] = useState<GroupA | null>(null);
  const [rest, setRest] = useState<RestA | null>(null);
  const [money, setMoney] = useState<MoneyTotals | null>(null); // discounts + lost business tiles
  const [err, setErr] = useState<string | null>(null);
  const [dishSort, setDishSort] = useState<"revenue" | "qty">("revenue");
  // If an ADMIN opened this cockpit for a specific restaurant, the URL carries
  // ?rid=<id>. Pin EVERY API call to that scope (as ?scope=) so a second tab — which
  // overwrites the browser-wide act-as cookie — can never repaint or WRITE to this
  // tab under a different restaurant (bug C1, 2026-07-05). A real logged-in owner has
  // no ?rid= and is scoped by their own cookie, so this is null and nothing changes.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  // Hero quick-links must keep the admin's tab pin (same rule as OwnerShell.withRid).
  const withPin = (href: string) => (scopePin ? `${href}?rid=${scopePin}` : href);

  const single = ov?.restaurants.length === 1;
  // With ONE restaurant the home page IS that restaurant — resolve its id once known.
  const homeRid = single ? ov!.restaurants[0].id : null;
  const activeRid = view.level === "home" ? homeRid : (view as { rid: string }).rid;
  const restCount = ov?.restaurants.length ?? 0;
  const hq = restCount >= 10; // HQ table mode — cards/charts don't scale past ~9

  // HQ table controls (hooks must run unconditionally; cheap when unused).
  const [hqQuery, setHqQuery] = useState("");
  const [hqSort, setHqSort] = useState<"revenue" | "orders" | "openTables" | "name">("revenue");

  // The sidebar's "My restaurants" rows (OwnerShell) open a restaurant from ANY
  // page: same-page clicks arrive as this event, cross-page ones as ?focus=<rid>.
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (focus) setView({ level: "restaurant", rid: focus });
    const onOpen = (e: Event) => {
      const rid = (e as CustomEvent).detail?.rid as string | null | undefined;
      setView(rid ? { level: "restaurant", rid } : { level: "home" });
    };
    window.addEventListener("lfh:owner-open-restaurant", onOpen);
    return () => window.removeEventListener("lfh:owner-open-restaurant", onOpen);
  }, []);

  const load = useCallback(async () => {
    try {
      const rg = range;
      const j = (r: Response) => r.json();
      // The tab's scope pin (admin-in-one-restaurant) rides on EVERY call so the
      // shared act-as cookie can't hijack this tab (C1). Null for a real owner.
      const scp = scopePin ? `&scope=${scopePin}` : "";
      // range=all now maps to an unbounded reports window (mig M11) — pass it through so the
      // money tiles cover the same span as the all-time revenue KPIs (was collapsed to 12m).
      const moneyUrl = (rid: string | null) =>
        `/api/owner/reports?type=sales&range=${rg}${rid ? `&rid=${rid}` : ""}${scp}`;
      if (view.level === "home") {
        const o: Overview = await fetch(`/api/owner/overview?_=1${scp}`, { cache: "no-store" }).then(j);
        if ((o as unknown as { error?: string }).error) throw new Error((o as unknown as { error: string }).error);
        setOv(o);
        if (o.restaurants.length === 1) {
          const rid = o.restaurants[0].id;
          const [a, m] = await Promise.all([
            fetch(`/api/owner/analytics?range=${rg}&rid=${rid}&compare=1${scp}`, { cache: "no-store" }).then(j),
            fetch(moneyUrl(rid), { cache: "no-store" }).then(j),
          ]);
          if (a.error) throw new Error(a.error);
          setRest(a); setMoney(m.error ? null : m.totals); setGroup(null);
        } else {
          const [g, m] = await Promise.all([
            fetch(`/api/owner/analytics?range=${rg}&compare=1${scp}`, { cache: "no-store" }).then(j),
            fetch(moneyUrl(null), { cache: "no-store" }).then(j),
          ]);
          if (g.error) throw new Error(g.error);
          setGroup(g); setMoney(m.error ? null : m.totals); setRest(null);
        }
      } else {
        const rid = (view as { rid: string }).rid;
        const [a, m] = await Promise.all([
          fetch(`/api/owner/analytics?range=${rg}&rid=${rid}&compare=1${scp}`, { cache: "no-store" }).then(j),
          fetch(moneyUrl(rid), { cache: "no-store" }).then(j),
        ]);
        if (a.error) throw new Error(a.error);
        setRest(a); setMoney(m.error ? null : m.totals);
      }
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [view, range]);

  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { load(); }, [load]);
  const [refreshing, setRefreshing] = useState(false);
  useActiveAutoRefresh(() => loadRef.current(), 60000);
  const manualRefresh = () => { setRefreshing(true); loadRef.current(); setTimeout(() => setRefreshing(false), 600); };
  const goHome = () => { setView({ level: "home" }); if (!single) setRest(null); };

  // ── shape group timeseries → multi-line rows {label,[name]:rev} ──
  const trendData = useMemo(() => {
    if (!group) return { rows: [] as Record<string, unknown>[], lines: [] as { key: string; name: string; color: string }[] };
    // Key each series by restaurant ID, never by display name — two restaurants can share
    // a name, and keying by name silently merges their two lines into one (found 2026-07-05).
    // 5+ restaurants → only the top-5 earners get a line (8 lines were already noise;
    // the rest are one tap away in the cards/HQ table).
    const lineCap = group.restaurantRevenue.length >= 5 ? 5 : 8;
    const lines = group.restaurantRevenue.slice(0, lineCap).map((r) => ({ key: r.id, name: r.name, color: r.accentColor || FALLBACK }));
    const byKey = new Map<string, Record<string, unknown>>();
    for (const t of group.timeseries) {
      const k = istKey(new Date(t.bucket), range);
      if (!byKey.has(k)) byKey.set(k, { label: tsLabel(t.bucket, range) });
      if (t.restaurantId) (byKey.get(k)!)[t.restaurantId] = t.revenue;
    }
    // Zero-fill: plot the COMPLETE bucket sequence so a no-sales day/hour shows as a
    // gap-to-zero, not an invisible skip that makes the trend denser than reality.
    const expected = expectedBuckets(range);
    if (!expected.length) return { rows: Array.from(byKey.values()), lines };
    const rows = expected.map((e) => {
      const found = byKey.get(e.key) || {};
      const row: Record<string, unknown> = { label: e.label };
      for (const l of lines) row[l.key] = Number(found[l.key]) || 0;
      return row;
    });
    return { rows, lines };
  }, [group, range]);

  const restTrend = useMemo(() => {
    const byKey = new Map<string, number>();
    for (const t of (rest?.timeseries ?? [])) byKey.set(istKey(new Date(t.bucket), range), t.revenue);
    const expected = expectedBuckets(range);
    if (!expected.length) return (rest?.timeseries ?? []).map((t) => ({ label: tsLabel(t.bucket, range), Revenue: t.revenue }));
    return expected.map((e) => ({ label: e.label, Revenue: byKey.get(e.key) ?? 0 }));
  }, [rest, range]);
  const restSpark = useMemo(() => (rest?.timeseries ?? []).map((t) => t.revenue), [rest]);
  const groupSpark = useMemo(() => {
    if (!group) return [];
    const byBucket = new Map<string, number>();
    for (const t of group.timeseries) byBucket.set(t.bucket, (byBucket.get(t.bucket) || 0) + t.revenue);
    return Array.from(byBucket.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [group]);

  // ── plain-language insights, derived from data already on screen (no extra fetch) ──
  const insights = useMemo(() => {
    const out: { icon: string; text: string }[] = [];
    const rl = RANGE_LABEL[range];
    if (rest) {
      const k = rest.kpis;
      if (rest.prev && rest.prev.revenue > 0 && k.revenue > 0) {
        const pct = Math.round(((k.revenue - rest.prev.revenue) / rest.prev.revenue) * 100);
        if (pct >= 300) out.push({ icon: "fa-arrow-trend-up", text: `Revenue is ${Math.round(k.revenue / rest.prev.revenue)}× the period before` });
        else if (Math.abs(pct) >= 3) out.push({ icon: pct > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", text: `Revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% ${PREV_LABEL[range]}` });
      }
      const busiest = [...rest.hourly].sort((a, b) => b.orders - a.orders)[0];
      if (busiest?.orders) out.push({ icon: "fa-clock", text: `Busiest at ${busiest.hour}:00 — ${busiest.orders} order${busiest.orders === 1 ? "" : "s"}` });
      const total = rest.dishes.reduce((a, d) => a + d.revenue, 0);
      if (rest.dishes[0] && total > 0) out.push({ icon: "fa-utensils", text: `${rest.dishes[0].title} makes ${Math.round((rest.dishes[0].revenue / total) * 100)}% of dish revenue` });
      if (money && money.cancelledValue > 0) out.push({ icon: "fa-ban", text: `${inr(money.cancelledValue)} lost to ${money.cancelledOrders} cancelled order${money.cancelledOrders === 1 ? "" : "s"} ${rl}` });
      // Only call out a payment method the staff actually recorded — "Not recorded
      // is 100% of payments" is true but useless.
      const payRows = (rest.paymentMethods ?? []).map((p) => ({ ...p, method: canonPayMethod(p.method) }));
      const pay = payRows.filter((p) => p.method !== "Not recorded").sort((a, b) => b.revenue - a.revenue)[0];
      const payTotal = payRows.reduce((a, p) => a + p.revenue, 0);
      if (pay && payTotal > 0 && pay.revenue / payTotal >= 0.15)
        out.push({ icon: "fa-wallet", text: `${pay.method} is ${Math.round((pay.revenue / payTotal) * 100)}% of payments` });
    } else if (group) {
      const total = group.restaurantRevenue.reduce((a, r) => a + r.revenue, 0);
      if (group.prev && group.prev.revenue > 0 && total > 0) {
        const pct = Math.round(((total - group.prev.revenue) / group.prev.revenue) * 100);
        if (pct >= 300) out.push({ icon: "fa-arrow-trend-up", text: `Group revenue is ${Math.round(total / group.prev.revenue)}× the period before` });
        else if (Math.abs(pct) >= 3) out.push({ icon: pct > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down", text: `Group revenue is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% ${PREV_LABEL[range]}` });
      }
      const top = group.restaurantRevenue[0];
      if (top && total > 0 && group.restaurantRevenue.length > 1)
        out.push({ icon: "fa-trophy", text: `${top.name} leads with ${Math.round((top.revenue / total) * 100)}% of revenue ${rl}` });
      if (money && money.cancelledValue > 0) out.push({ icon: "fa-ban", text: `${inr(money.cancelledValue)} lost to cancellations ${rl}` });
      if (money && money.discount > 0 && total > 0) out.push({ icon: "fa-tag", text: `${inr(money.discount)} given as discounts` });
    }
    return out.slice(0, 4);
  }, [rest, group, money, range]);

  const dishView = useMemo(() => {
    if (view.level !== "dish" || !rest) return null;
    const total = rest.dishes.reduce((a, d) => a + d.revenue, 0) || 1;
    const idx = rest.dishes.findIndex((d) => d.title === view.dish);
    const d = rest.dishes[idx];
    return d ? { d, rank: idx + 1, share: Math.round((d.revenue / total) * 100), of: rest.dishes.length } : null;
  }, [view, rest]);

  const groupTotals = useMemo(() => {
    if (!group) return null;
    return {
      revenue: group.restaurantRevenue.reduce((a, r) => a + r.revenue, 0),
      orders: group.restaurantRevenue.reduce((a, r) => a + r.orders, 0),
    };
  }, [group]);

  // HQ (10+) table rows: overview (live today/tables) merged with the range revenue,
  // filtered by the search box, sorted by the active column. Rank is ALWAYS by range
  // revenue so "#3" keeps meaning "3rd best earner" whatever the sort.
  const hqRows = useMemo(() => {
    if (!hq || !ov) return [];
    const revById = new Map((group?.restaurantRevenue ?? []).map((r) => [r.id, r]));
    const base = ov.restaurants.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, active: r.active, accent: r.accentColor || FALLBACK,
      revenue: revById.get(r.id)?.revenue ?? 0, orders: revById.get(r.id)?.orders ?? 0,
      openTables: r.openTables, revenueToday: r.revenueToday,
    }));
    const rank = new Map([...base].sort((a, b) => b.revenue - a.revenue).map((r, i) => [r.id, i + 1]));
    const q = hqQuery.trim().toLowerCase();
    const rows = q ? base.filter((r) => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) : base;
    rows.sort((a, b) => (hqSort === "name" ? a.name.localeCompare(b.name) : (b[hqSort] as number) - (a[hqSort] as number)));
    return rows.map((r) => ({ ...r, rank: rank.get(r.id)! }));
  }, [hq, ov, group, hqQuery, hqSort]);
  const hqMaxRev = Math.max(1, ...hqRows.map((r) => r.revenue));

  const two = !!group && group.restaurantRevenue.length === 2;

  return (
    <>
      {/* Breadcrumb + range */}
      <div className="own-bar">
        <div className="own-crumb">
          <button className={view.level === "home" ? "cur" : "lnk"} onClick={goHome}>
            {single ? (ov?.restaurants[0]?.name || "Dashboard") : "All restaurants"}
          </button>
          {!single && view.level !== "home" && rest && (<>
            <span className="sep">›</span>
            <button className={view.level === "restaurant" ? "cur" : "lnk"} onClick={() => setView({ level: "restaurant", rid: (view as { rid: string }).rid })}>{rest.restaurant.name}</button>
          </>)}
          {view.level === "dish" && (<><span className="sep">›</span><span className="cur">{view.dish}</span></>)}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <RangeSlider items={RANGES} value={range} onChange={setRange} caption={rangeSpanText(range)} />
          <button className="adm-btn" onClick={manualRefresh} disabled={refreshing} title="Refresh now (auto-updates are throttled to save load)" style={{ marginTop: 2 }}>
            <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 16 }}><b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span></div>}

      {/* Insight strip — the panel talks like a person, not a spreadsheet */}
      {insights.length > 0 && view.level !== "dish" && (
        <div className="owx-insights">
          {insights.map((ins, i) => (
            <span key={i} className="owx-insight"><i className={`fas ${ins.icon}`} aria-hidden="true" />{ins.text}</span>
          ))}
        </div>
      )}

      {/* ═══════ HOME · MULTI (2 and 3+) ═══════ */}
      {view.level === "home" && !single && (
        <>
          <div className="adm-stats">
            <Kpi k={`Revenue (${RANGE_LABEL[range]})`} v={groupTotals?.revenue ?? 0} money
              delta={group?.prev ? { now: groupTotals?.revenue ?? 0, prev: group.prev.revenue } : undefined}
              prevTitle={PREV_LABEL[range]} spark={groupSpark} />
            <Kpi k="Orders" v={groupTotals?.orders ?? 0}
              delta={group?.prev ? { now: groupTotals?.orders ?? 0, prev: group.prev.orders } : undefined}
              prevTitle={PREV_LABEL[range]} />
            <Kpi k="Open tables now" v={ov?.totals.openTables ?? 0} />
            <Kpi k="Lost to cancellations" v={money?.cancelledValue ?? 0} money sub={money?.cancelledOrders ? `${money.cancelledOrders} order${money.cancelledOrders === 1 ? "" : "s"}` : "none — great"} />
          </div>

          {hq ? (
            /* ── 10+ restaurants → HQ mode: one sortable, searchable table ── */
            <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="hq-bar">
                <span className="hq-search">
                  <i className="fas fa-magnifying-glass" aria-hidden="true" />
                  <input value={hqQuery} onChange={(e) => setHqQuery(e.target.value)} placeholder={`Search ${restCount} restaurants…`} aria-label="Search restaurants" />
                  {hqQuery && <button className="hq-x" onClick={() => setHqQuery("")} aria-label="Clear search">×</button>}
                </span>
                <span className="hq-sorts" role="tablist" aria-label="Sort by">
                  {([["revenue", `Revenue (${RANGE_LABEL[range]})`], ["orders", "Orders"], ["openTables", "Open tables"], ["name", "A–Z"]] as const).map(([k, lb]) => (
                    <button key={k} role="tab" aria-selected={hqSort === k} className={hqSort === k ? "on" : ""} onClick={() => setHqSort(k)}>{lb}</button>
                  ))}
                </span>
              </div>
              <div className="hq-scroll">
                <table className="hq-table">
                  <thead><tr>
                    <th className="rk">#</th><th style={{ textAlign: "left" }}>Restaurant</th>
                    <th>Revenue ({RANGE_LABEL[range]})</th><th>Orders</th><th>Today</th><th>Open tables</th><th>Status</th><th aria-hidden="true" />
                  </tr></thead>
                  <tbody>
                    {hqRows.length === 0 && (
                      <tr><td colSpan={8} className="hq-empty">{ov ? "No restaurant matches that search." : "Loading…"}</td></tr>
                    )}
                    {hqRows.map((r) => (
                      <tr key={r.id} className="hq-row" onClick={() => setView({ level: "restaurant", rid: r.id })}
                        tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setView({ level: "restaurant", rid: r.id }); }}>
                        <td className="rk">{r.rank}</td>
                        <td style={{ textAlign: "left" }}>
                          <span className="hq-nm"><span className="sw" style={{ background: r.accent }} aria-hidden="true" />{r.name}</span>
                        </td>
                        <td>
                          <b>{inr(r.revenue)}</b>
                          <span className="hq-meter" aria-hidden="true"><span style={{ width: `${Math.round((r.revenue / hqMaxRev) * 100)}%`, background: r.accent }} /></span>
                        </td>
                        <td className="mut">{r.orders}</td>
                        <td className="mut">{inr(r.revenueToday)}</td>
                        <td className="mut">{r.openTables}</td>
                        <td><span className={`own-pill ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Off"}</span></td>
                        <td className="go"><i className="fas fa-chevron-right" aria-hidden="true" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (<>
          {two ? (
            /* ── exactly TWO restaurants → head-to-head ── */
            <div className="own-charts">
              <div className="adm-card">
                <div className="own-ctitle">Head to head <span>· {RANGE_LABEL[range]}</span></div>
                <div className="own-h2h">
                  {group!.restaurantRevenue.map((r) => {
                    const o = ov?.restaurants.find((x) => x.id === r.id);
                    const max = Math.max(1, ...group!.restaurantRevenue.map((x) => x.revenue));
                    return (
                      <button key={r.id} className="own-h2h-col" style={{ ["--rcol" as string]: r.accentColor || FALLBACK }} onClick={() => setView({ level: "restaurant", rid: r.id })}>
                        <div className="nm">{r.name}</div>
                        <div className="rev">{inr(r.revenue)}</div>
                        <div className="meter"><span style={{ width: `${(r.revenue / max) * 100}%` }} /></div>
                        <div className="meta">{r.orders} orders · {o?.openTables ?? 0} open tables</div>
                      </button>
                    );
                  })}
                </div>
                <div className="own-hint">Tip: tap a side to open that restaurant</div>
              </div>
              <div className="adm-card">
                <div className="own-ctitle">Revenue over time <span>· {range === "today" || range === "yesterday" ? "by hour" : "by day"}</span></div>
                <AreaTrend data={trendData.rows} lines={trendData.lines} />
              </div>
            </div>
          ) : (
            /* ── 3+ restaurants → leaderboard + multi-line trend ── */
            <div className="own-charts">
              <div className="adm-card">
                <div className="own-ctitle">Who earns more <span>· tap a bar to open</span></div>
                <LeaderBar data={(group?.restaurantRevenue ?? []).map((r) => ({ id: r.id, name: r.name, revenue: r.revenue, orders: r.orders, accentColor: r.accentColor || FALLBACK }))}
                  onSelect={(id) => setView({ level: "restaurant", rid: id })} />
              </div>
              <div className="adm-card">
                <div className="own-ctitle">Revenue over time <span>· {range === "today" || range === "yesterday" ? "by hour" : "by day"}</span></div>
                <AreaTrend data={trendData.rows} lines={trendData.lines} />
              </div>
            </div>
          )}

          <h2 className="own-h2">Restaurants</h2>
          <div className="own-grid">
            {!ov && <div className="adm-empty" style={{ gridColumn: "1 / -1" }}>Loading…</div>}
            {ov?.restaurants.map((r) => (
              <button key={r.id} className="adm-card own-card" style={{ ["--rcol" as string]: r.accentColor }} onClick={() => setView({ level: "restaurant", rid: r.id })}>
                <span className="own-accent" aria-hidden="true" />
                <div className="own-head">
                  <div style={{ minWidth: 0, textAlign: "left" }}>
                    <div className="own-name" title={r.name}>{r.name}</div>
                    <div className="adm-muted mono" style={{ fontSize: 11 }}>{r.slug}</div>
                  </div>
                  <span className={`own-pill ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Off"}</span>
                </div>
                <div className="own-today">
                  <div className="own-cell"><div className="k">Orders today</div><div className="v">{r.ordersToday}</div></div>
                  <div className="own-cell"><div className="k">Revenue today</div><div className="v">{inr(r.revenueToday)}</div></div>
                  <div className="own-cell"><div className="k">Open tables</div><div className="v">{r.openTables}</div></div>
                </div>
                <div className="own-foot">
                  <span><i className="fas fa-receipt" aria-hidden="true" /> {r.ordersAll.toLocaleString("en-US")} all-time</span>
                  <span><i className="fas fa-indian-rupee-sign" aria-hidden="true" /> {inr(r.revenueAll)} all-time</span>
                  <span className="own-open">Open <i className="fas fa-arrow-right" aria-hidden="true" /></span>
                </div>
              </button>
            ))}
          </div>
          </>)}
        </>
      )}

      {/* ═══════ SINGLE-OWNER HERO — identity + one-tap jumps (2026-07-06 polish):
          with one restaurant there's no portfolio to browse, so the dashboard opens
          with WHO you are and the three places you actually go next. ═══════ */}
      {view.level === "home" && single && ov && (
        <div className="own-hero" style={{ ["--rcol" as string]: ov.restaurants[0].accentColor || FALLBACK }}>
          <div className="own-hero-id">
            <div className="own-hero-name">{ov.restaurants[0].name}</div>
            <div className="own-hero-sub">
              <span className={`own-pill ${ov.restaurants[0].active ? "on" : "off"}`}>{ov.restaurants[0].active ? "Active" : "Off"}</span>
              <span className="mono">{ov.restaurants[0].slug}</span>
              <span className="live"><i className="fas fa-chair" aria-hidden="true" /> {ov.restaurants[0].openTables} table{ov.restaurants[0].openTables === 1 ? "" : "s"} open now</span>
            </div>
          </div>
          <div className="own-hero-links">
            <Link href={withPin("/owner/reports")} className="own-hero-link"><i className="fas fa-file-invoice" aria-hidden="true" /> Reports</Link>
            <Link href={withPin("/owner/staff")} className="own-hero-link"><i className="fas fa-users-gear" aria-hidden="true" /> Staff &amp; powers</Link>
            <Link href={withPin("/owner/issues")} className="own-hero-link"><i className="fas fa-triangle-exclamation" aria-hidden="true" /> Feedback</Link>
          </div>
        </div>
      )}

      {/* ═══════ RESTAURANT (drill-down, or HOME when there's only one) ═══════ */}
      {((view.level === "home" && single) || view.level === "restaurant") && activeRid && (
        <RestaurantView rest={rest} money={money} range={range} restTrend={restTrend} restSpark={restSpark}
          dishSort={dishSort} setDishSort={setDishSort}
          onDish={(title) => setView({ level: "dish", rid: activeRid, dish: title })} />
      )}

      {/* ═══════ DISH ═══════ */}
      {view.level === "dish" && (
        <div className="adm-card own-dish">
          {!dishView ? <div className="adm-empty">Loading dish…</div> : (<>
            <div className="own-dish-h" style={{ ["--rcol" as string]: rest?.restaurant.accentColor || FALLBACK }}>
              <div className="own-dish-name">{dishView.d.title}</div>
              <div className="adm-muted">at {rest?.restaurant.name} · {RANGES.find((r) => r.k === range)?.label}</div>
            </div>
            <div className="adm-stats" style={{ marginTop: 14 }}>
              <div className="adm-stat"><div className="k">Revenue</div><div className="v">{inr(dishView.d.revenue)}</div></div>
              <div className="adm-stat"><div className="k">Sold</div><div className="v">{dishView.d.qty}</div></div>
              <div className="adm-stat"><div className="k">Share of revenue</div><div className="v">{dishView.share}%</div></div>
              <div className="adm-stat"><div className="k">Rank by revenue</div><div className="v">#{dishView.rank}<span style={{ fontSize: 13, color: "var(--muted)" }}> / {dishView.of}</span></div></div>
            </div>
            <div className="own-ctitle" style={{ marginTop: 18 }}>How it compares <span>· revenue vs other dishes</span></div>
            <LeaderBar data={(rest?.dishes ?? []).slice(0, 12).map((d) => ({ id: d.title, name: d.title, revenue: d.revenue, orders: d.qty, accentColor: d.title === dishView.d.title ? (rest?.restaurant.accentColor || FALLBACK) : "rgba(128,128,128,.35)" }))}
              onSelect={(title) => setView({ level: "dish", rid: (view as { rid: string }).rid, dish: title })} />
          </>)}
        </div>
      )}

      <style jsx>{`
        .own-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
        .own-crumb { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 800; min-width: 0; }
        .own-crumb button { background: none; border: none; font: inherit; padding: 0; }
        .own-crumb .lnk { color: var(--muted); cursor: pointer; }
        .own-crumb .lnk:hover { color: var(--accent); text-decoration: underline; }
        .own-crumb .cur { color: var(--text, inherit); cursor: default; }
        .own-crumb .sep { color: var(--muted); font-weight: 400; }
        .own-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
        .own-ctitle { font-size: 13px; font-weight: 800; margin-bottom: 10px; }
        .own-ctitle span { color: var(--muted); font-weight: 500; }
        .own-hint { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
        .own-h2 { font-size: 12px; font-weight: 800; margin: 20px 0 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
        .own-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
        .own-card { position: relative; overflow: hidden; padding-left: 22px; text-align: left; cursor: pointer; transition: border-color .15s; width: 100%; font: inherit; color: inherit; }
        .own-card:hover { border-color: var(--rcol, var(--accent)); }
        .own-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--rcol, var(--accent)); }
        .own-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
        .own-name { font-size: 15px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .own-pill { font-size: 10px; font-weight: 800; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
        .own-pill.on { background: color-mix(in srgb, var(--adm-ok) 18%, transparent); color: var(--adm-ok); }
        .own-pill.off { background: rgba(120,120,120,.18); color: var(--muted); }
        .own-today { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
        .own-cell .k { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
        .own-cell .v { font-size: 18px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
        .own-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding-top: 10px; border-top: var(--border); font-size: 12px; color: var(--muted); }
        .own-foot i { opacity: .7; margin-right: 4px; }
        .own-open { margin-left: auto; color: var(--rcol, var(--accent)); font-weight: 700; }
        .own-h2h { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .own-h2h-col { border: var(--border); border-radius: 10px; padding: 12px; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; transition: border-color .15s; }
        .own-h2h-col:hover { border-color: var(--rcol); }
        .own-h2h-col .nm { font-weight: 800; font-size: 13.5px; color: var(--rcol); }
        .own-h2h-col .rev { font-size: 22px; font-weight: 800; margin: 4px 0 6px; font-variant-numeric: tabular-nums; }
        .own-h2h-col .meter { height: 7px; border-radius: 4px; background: rgba(128,128,128,.14); overflow: hidden; }
        .own-h2h-col .meter span { display: block; height: 100%; border-radius: 4px; background: var(--rcol); }
        .own-h2h-col .meta { font-size: 11.5px; color: var(--muted); margin-top: 7px; }
        .own-dish-h { border-left: 4px solid var(--rcol); padding-left: 12px; }
        .own-dish-name { font-size: 22px; font-weight: 800; }
        /* ── single-owner hero ── */
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
        /* ── HQ mode (10+ restaurants) ── */
        .hq-bar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 12px 14px; border-bottom: var(--border); }
        .hq-search { flex: 1 1 220px; display: flex; align-items: center; gap: 9px; border: var(--border); background: var(--bg); border-radius: 9px; padding: 7px 12px; color: var(--muted); }
        .hq-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; font: inherit; font-size: 13px; color: var(--text); }
        .hq-search i { font-size: 12px; }
        .hq-x { background: none; border: none; color: var(--muted); font-size: 15px; cursor: pointer; padding: 0 2px; line-height: 1; }
        .hq-sorts { display: inline-flex; background: var(--bg); border: var(--border); border-radius: 9px; padding: 3px; gap: 2px; flex-wrap: wrap; }
        .hq-sorts button { background: none; border: none; padding: 5px 11px; border-radius: 7px; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; white-space: nowrap; }
        .hq-sorts button.on { background: var(--accent); color: #fff; }
        .hq-scroll { overflow: auto; max-height: 64vh; }
        .hq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .hq-table th { position: sticky; top: 0; background: var(--card); z-index: 1; text-align: right; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; padding: 9px 12px; border-bottom: var(--border); white-space: nowrap; }
        .hq-table td { padding: 9px 12px; border-bottom: var(--border); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .hq-table .rk { width: 30px; text-align: left; color: var(--muted); font-weight: 800; font-size: 11.5px; }
        .hq-row { cursor: pointer; }
        .hq-row:hover td, .hq-row:focus-visible td { background: var(--muted2); }
        .hq-nm { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hq-nm .sw { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
        .hq-meter { display: inline-block; vertical-align: middle; width: 64px; height: 7px; border-radius: 4px; background: rgba(128,128,128,.14); overflow: hidden; margin-left: 10px; }
        .hq-meter span { display: block; height: 100%; border-radius: 4px; }
        .hq-table .mut { color: var(--muted); }
        .hq-table .go i { color: var(--muted); font-size: 11px; }
        .hq-empty { text-align: center !important; color: var(--muted); padding: 26px 12px !important; }
        @media (max-width: 760px) { .own-charts { grid-template-columns: 1fr; } .hq-meter { display: none; } .hq-table .mut { display: none; } .hq-table th:nth-child(4), .hq-table th:nth-child(5), .hq-table th:nth-child(6) { display: none; } .own-hero-links { width: 100%; } :global(.own-hero-link) { flex: 1; justify-content: center; } }
      `}</style>
    </>
  );
}

// ── Restaurant detail (also the HOME layout when the owner has one restaurant) ──
function RestaurantView({ rest, money, range, restTrend, restSpark, dishSort, setDishSort, onDish }: {
  rest: RestA | null; money: MoneyTotals | null; range: Range; restTrend: Record<string, unknown>[]; restSpark: number[];
  dishSort: "revenue" | "qty"; setDishSort: (s: "revenue" | "qty") => void; onDish: (t: string) => void;
}) {
  if (!rest) return <div className="adm-empty">Loading restaurant…</div>;
  const accent = rest.restaurant.accentColor || FALLBACK;
  const dishes = [...rest.dishes].sort((a, b) => (dishSort === "revenue" ? b.revenue - a.revenue : b.qty - a.qty));
  const maxRev = Math.max(1, ...dishes.map((d) => d.revenue));
  const k = rest.kpis;
  const payTotal = (rest.paymentMethods ?? []).reduce((a, p) => a + p.revenue, 0);
  // These two cards are independent: the same-hour comparison needs comparison windows,
  // but the 14-day payment trend always has data. They used to share ONE render guard,
  // so on the All-time view (no sameHour) the payment trend silently vanished too — now
  // each has its own guard (fixed 2026-07-06).
  const showSameHour = (rest.sameHour ?? []).length >= 2 && (rest.sameHour ?? []).some((w) => w.revenue > 0);
  const showPayTrend = (rest.payTrend ?? []).length > 0;
  return (
    <>
      <div className="adm-stats">
        <Kpi k="Revenue" v={k.revenue} money
          delta={rest.prev ? { now: k.revenue, prev: rest.prev.revenue } : undefined}
          prevTitle={PREV_LABEL[range]} spark={restSpark} color={accent} />
        <Kpi k="Orders" v={k.orders}
          delta={rest.prev ? { now: k.orders, prev: rest.prev.orders } : undefined} prevTitle={PREV_LABEL[range]} />
        <Kpi k="Avg order" v={k.avgOrder} money />
        <Kpi k="Open tables now" v={k.openTables} />
        <Kpi k="Lost to cancellations" v={money?.cancelledValue ?? 0} money sub={money?.cancelledOrders ? `${money.cancelledOrders} order${money.cancelledOrders === 1 ? "" : "s"}` : "none — great"} />
      </div>
      <div className="rv-charts">
        <div className="adm-card" style={{ gridColumn: "1 / -1" }}>
          <div className="rv-ct">Revenue over time <span>· {range === "today" || range === "yesterday" ? "by hour" : "by day"}</span></div>
          {restTrend.length >= 9
            ? <AreaTrend data={restTrend} lines={[{ key: "Revenue", name: "Revenue", color: accent }]} />
            : <TimeBar data={restTrend.map((r) => ({ label: String(r.label), revenue: Number(r.Revenue) || 0 }))} color={accent} />}
        </div>
        <div className="adm-card"><div className="rv-ct">Busy hours <span>· orders by hour</span></div><HourlyBar data={rest.hourly} color={accent} /></div>
        <div className="adm-card"><div className="rv-ct">Revenue by category</div><CategoryDonut data={rest.categories} /></div>
      </div>

      {/* "Is today actually good?" — every window cut at the SAME elapsed time
          (today-till-5pm vs last-week-till-5pm), so the comparison never lies. The
          14-day payment trend rides alongside it but has its OWN guard so it survives
          ranges (e.g. All-time) where the same-hour comparison has nothing to show. */}
      {(showSameHour || showPayTrend) && (
        <div className="rv-charts" style={{ marginTop: 12, gridTemplateColumns: showSameHour && showPayTrend ? undefined : "1fr" }}>
          {showSameHour && (
            <div className="adm-card">
              <div className="rv-ct">Is {range === "today" ? "today" : "this period"} actually good? <span>· all cut at the same time of day</span></div>
              <SameHourBar accent={accent} data={(rest.sameHour ?? []).map((w, i) => ({
                label: SAMEHOUR_LABEL[range]?.[i] ?? new Date(w.start).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST }),
                revenue: w.revenue,
              }))} />
            </div>
          )}
          {showPayTrend && (
            <div className="adm-card">
              <div className="rv-ct">How money arrives <span>· last 14 days by payment method</span></div>
              <PayTrendStack data={rest.payTrend ?? []} />
            </div>
          )}
        </div>
      )}

      {/* Payment split — how the money actually arrives */}
      {payTotal > 0 && (
        <div className="adm-card" style={{ marginTop: 12 }}>
          <div className="rv-ct">Payment methods <span>· how customers paid</span></div>
          <PaymentDonut data={rest.paymentMethods ?? []} />
        </div>
      )}

      {/* Records strip — the numbers worth bragging about (all-time + 30d) */}
      {rest.records && (rest.records.bestDay || rest.records.starDish) && (
        <div className="adm-card" style={{ marginTop: 12 }}>
          <div className="rv-ct">Your records <span>· the numbers worth bragging about</span></div>
          <div className="rv-recs">
            {rest.records.bestDay && (
              <div className="rv-rec"><span className="e">🏆</span><span><small>BEST DAY EVER</small><b>{inr(rest.records.bestDay.revenue)}</b>
                <i>{new Date(rest.records.bestDay.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST })} — beat it!</i></span></div>
            )}
            {rest.records.starDish && (
              <div className="rv-rec"><span className="e">👑</span><span><small>STAR DISH · 30 DAYS</small><b>{rest.records.starDish.title}</b>
                <i>{rest.records.starDish.qty} plates</i></span></div>
            )}
            {rest.records.fastHour && (
              <div className="rv-rec"><span className="e">⚡</span><span><small>BUSIEST HOUR EVER</small><b>{rest.records.fastHour.orders} orders</b>
                <i>{new Date(rest.records.fastHour.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", hour12: true, timeZone: IST })}</i></span></div>
            )}
            {rest.records.bigBill && (
              <div className="rv-rec"><span className="e">💎</span><span><small>BIGGEST BILL</small><b>{inr(rest.records.bigBill.revenue)}</b>
                <i>{rest.records.bigBill.table ? `table ${rest.records.bigBill.table}` : "one sitting"}</i></span></div>
            )}
            {(rest.records.regulars ?? 0) > 0 && (
              <div className="rv-rec"><span className="e">🔁</span><span><small>REGULARS · 30 DAYS</small><b>{rest.records.regulars} returning guests</b>
                <i>same name, 2+ visits</i></span></div>
            )}
          </div>
        </div>
      )}

      <div className="adm-card" style={{ marginTop: 12 }}>
        <div className="rv-ct" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Every dish <span style={{ color: "var(--muted)", fontWeight: 500 }}>· tap one for detail</span></span>
          <span className="rv-sort">
            <button className={dishSort === "revenue" ? "on" : ""} onClick={() => setDishSort("revenue")}>By revenue</button>
            <button className={dishSort === "qty" ? "on" : ""} onClick={() => setDishSort("qty")}>By qty</button>
          </span>
        </div>
        <div className="rv-dishes">
          {dishes.length === 0 && <div className="adm-empty">No dish sales in this range.</div>}
          {dishes.map((d) => (
            <button key={d.title} className="rv-dish" onClick={() => onDish(d.title)}>
              <span className="rv-dn">{d.title}</span>
              <span className="rv-bar"><span style={{ width: `${(d.revenue / maxRev) * 100}%`, background: accent }} /></span>
              <span className="rv-q">{d.qty} sold</span>
              <span className="rv-r">{inr(d.revenue)}</span>
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
      <style jsx>{`
        .rv-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .rv-ct { font-size: 13px; font-weight: 800; margin-bottom: 10px; }
        .rv-ct span { color: var(--muted); font-weight: 500; }
        .rv-sort { display: inline-flex; gap: 2px; }
        .rv-sort button { background: none; border: var(--border); padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .rv-sort button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
        .rv-recs { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
        .rv-rec { flex: 1 1 190px; min-width: 170px; display: flex; gap: 11px; align-items: center; border: 1px solid var(--border-c, rgba(128,128,128,.22)); border-radius: 12px; padding: 11px 14px; }
        .rv-rec .e { font-size: 20px; }
        .rv-rec small { display: block; font-size: 9.5px; color: var(--muted); font-weight: 800; letter-spacing: 0.5px; }
        .rv-rec b { display: block; font-size: 14px; line-height: 1.3; font-variant-numeric: tabular-nums; }
        .rv-rec i { display: block; font-style: normal; font-size: 10.5px; color: var(--muted); }
        .rv-dishes { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
        .rv-dish { display: grid; grid-template-columns: minmax(120px, 1.4fr) 2fr auto auto auto; align-items: center; gap: 12px; padding: 9px 8px; border: none; border-radius: 8px; background: none; cursor: pointer; font: inherit; color: inherit; text-align: left; }
        .rv-dish:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
        .rv-dn { font-weight: 700; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rv-bar { height: 8px; border-radius: 4px; background: rgba(128,128,128,.14); overflow: hidden; }
        .rv-bar span { display: block; height: 100%; border-radius: 4px; }
        .rv-q { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
        .rv-r { font-weight: 800; font-variant-numeric: tabular-nums; min-width: 70px; text-align: right; }
        .rv-dish i { color: var(--muted); font-size: 11px; }
        @media (max-width: 760px) { .rv-charts { grid-template-columns: 1fr; } .rv-dish { grid-template-columns: 1fr auto auto; } .rv-bar { display: none; } }
      `}</style>
    </>
  );
}
