"use client";
// Owner · interactive analytics dashboard. THREE drill-down levels, everything
// clickable: All restaurants → one restaurant → one dish. A date-scope toggle
// drives every number + chart. Numbers come pre-aggregated from the lfh_owner_*
// RPCs via /api/owner/{overview,analytics} (one round-trip per chart, tiny rows —
// never order-scanning in JS). Live refresh rides the SAME realtime bus as the
// admin screens, and ONLY while this page is mounted (useLivePoll subscribes on
// mount, tears down on unmount) — so when nothing's open, nothing fetches.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inr, useActiveAutoRefresh } from "@/components/admin/shared";
import { RevenueBar, TrendLine, HourlyBar, CategoryDonut } from "@/components/owner/Charts";

type Range = "today" | "7d" | "30d" | "all";
const RANGES: { k: Range; label: string }[] = [
  { k: "today", label: "Today" }, { k: "7d", label: "7 days" },
  { k: "30d", label: "30 days" }, { k: "all", label: "All time" },
];

type Restaurant = {
  id: string; slug: string; name: string; active: boolean; accentColor: string;
  ordersToday: number; revenueToday: number; ordersAll: number; revenueAll: number; openTables: number;
};
type Overview = { restaurants: Restaurant[]; totals: { revenueToday: number; ordersToday: number; openTables: number; restaurantCount: number } };
type GroupRev = { id: string; slug: string; name: string; accentColor: string; revenue: number; orders: number };
type TsRow = { bucket: string; restaurantId?: string; revenue: number; orders: number };
type GroupA = { scope: "group"; restaurantRevenue: GroupRev[]; timeseries: TsRow[] };
type Dish = { title: string; qty: number; revenue: number };
type RestA = {
  scope: "restaurant";
  restaurant: { id: string; slug: string; name: string; accentColor: string; heroTitle: string };
  kpis: { revenue: number; orders: number; avgOrder: number; openTables: number; topDish: string };
  timeseries: TsRow[]; dishes: Dish[]; categories: { category: string; qty: number; revenue: number }[];
  hourly: { hour: number; orders: number; revenue: number }[];
};
type View = { level: "home" } | { level: "restaurant"; rid: string } | { level: "dish"; rid: string; dish: string };

const FALLBACK = "#e3c06f";
// Bucket timestamp → short axis label (date for day/week ranges, hour for "today").
function tsLabel(iso: string, range: Range): string {
  const d = new Date(iso);
  if (range === "today") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function OwnerDashboard() {
  const [view, setView] = useState<View>({ level: "home" });
  const [range, setRange] = useState<Range>("today");
  const [ov, setOv] = useState<Overview | null>(null);
  const [group, setGroup] = useState<GroupA | null>(null);
  const [rest, setRest] = useState<RestA | null>(null);
  const [showGraphs, setShowGraphs] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dishSort, setDishSort] = useState<"revenue" | "qty">("revenue");

  // One fetcher that reads the CURRENT view+range. Home loads overview (cards) +
  // group analytics (bar/trend); a restaurant loads its analytics; a dish reuses
  // the loaded restaurant data. Kept in a ref so the live-bus callback always runs
  // the latest version (no stale closure) without re-subscribing.
  const load = useCallback(async () => {
    try {
      const v = view; const rg = range;
      if (v.level === "home") {
        const [o, g] = await Promise.all([
          fetch("/api/owner/overview", { cache: "no-store" }).then((r) => r.json()),
          fetch(`/api/owner/analytics?range=${rg}`, { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (o.error) throw new Error(o.error);
        if (g.error) throw new Error(g.error);
        setOv(o); setGroup(g); setErr(null);
      } else {
        const a = await fetch(`/api/owner/analytics?range=${rg}&rid=${v.rid}`, { cache: "no-store" }).then((r) => r.json());
        if (a.error) throw new Error(a.error);
        setRest(a); setErr(null);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [view, range]);

  const loadRef = useRef(load); loadRef.current = load;
  // Refetch on navigation / range change.
  useEffect(() => { load(); }, [load]);
  // Heavy dashboard: a gentle ~60s auto-refresh that runs ONLY while the tab is visible
  // AND in use (click/scroll/key); it stops when idle or hidden, and the page never opens
  // a realtime websocket. Manual ↻ Refresh is instant. (owner 2026-06-26)
  const [refreshing, setRefreshing] = useState(false);
  useActiveAutoRefresh(() => loadRef.current(), 60000);
  const manualRefresh = () => { setRefreshing(true); loadRef.current(); setTimeout(() => setRefreshing(false), 600); };

  const goHome = () => { setView({ level: "home" }); setRest(null); };

  // ---- shape group timeseries → multi-line rows {label,[name]:rev} ----
  const trendData = useMemo(() => {
    if (!group) return { rows: [], lines: [] as { key: string; name: string; color: string }[] };
    const names = new Map(group.restaurantRevenue.map((r) => [r.id, { name: r.name, color: r.accentColor || FALLBACK }]));
    const byBucket = new Map<string, Record<string, unknown>>();
    for (const t of group.timeseries) {
      const key = t.bucket;
      if (!byBucket.has(key)) byBucket.set(key, { label: tsLabel(key, range) });
      const meta = names.get(t.restaurantId || "");
      if (meta) (byBucket.get(key)!)[meta.name] = t.revenue;
    }
    const lines = group.restaurantRevenue.slice(0, 8).map((r) => ({ key: r.name, name: r.name, color: r.accentColor || FALLBACK }));
    return { rows: Array.from(byBucket.values()), lines };
  }, [group, range]);

  const restTrend = useMemo(() => {
    if (!rest) return [] as Record<string, unknown>[];
    return rest.timeseries.map((t) => ({ label: tsLabel(t.bucket, range), Revenue: t.revenue }));
  }, [rest, range]);

  const dishView = useMemo(() => {
    if (view.level !== "dish" || !rest) return null;
    const total = rest.dishes.reduce((a, d) => a + d.revenue, 0) || 1;
    const idx = rest.dishes.findIndex((d) => d.title === view.dish);
    const d = rest.dishes[idx];
    return d ? { d, rank: idx + 1, share: Math.round((d.revenue / total) * 100), of: rest.dishes.length } : null;
  }, [view, rest]);

  const RangeToggle = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div className="own-range" role="tablist" aria-label="Date range">
        {RANGES.map((r) => (
          <button key={r.k} role="tab" aria-selected={range === r.k}
            className={range === r.k ? "on" : ""} onClick={() => setRange(r.k)}>{r.label}</button>
        ))}
      </div>
      <button className="adm-btn" onClick={manualRefresh} disabled={refreshing} title="Refresh now (auto-updates are throttled to save load)">
        <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
      </button>
    </div>
  );

  return (
    <>
      {/* Breadcrumb / back */}
      <div className="own-bar">
        <div className="own-crumb">
          <button className={view.level === "home" ? "cur" : "lnk"} onClick={goHome}>All restaurants</button>
          {view.level !== "home" && rest && (<>
            <span className="sep">›</span>
            <button className={view.level === "restaurant" ? "cur" : "lnk"} onClick={() => setView({ level: "restaurant", rid: (view as { rid: string }).rid })}>{rest.restaurant.name}</button>
          </>)}
          {view.level === "dish" && (<><span className="sep">›</span><span className="cur">{view.dish}</span></>)}
        </div>
        {RangeToggle}
      </div>

      {err && <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 16 }}><b>Couldn&apos;t load.</b> <span className="adm-muted" style={{ fontSize: 12.5 }}>{err}</span></div>}

      {/* ============ HOME ============ */}
      {view.level === "home" && (
        <>
          <div className="adm-stats">
            {([["Restaurants", ov ? ov.totals.restaurantCount : "…", "fa-store"],
               ["Revenue (range)", group ? inr(group.restaurantRevenue.reduce((a, r) => a + r.revenue, 0)) : "…", "fa-indian-rupee-sign"],
               ["Orders (range)", group ? group.restaurantRevenue.reduce((a, r) => a + r.orders, 0) : "…", "fa-receipt"],
               ["Open tables now", ov ? ov.totals.openTables : "…", "fa-chair"]] as [string, string | number, string][]).map(([k, v, ic], i) => (
              <button key={k} className={`adm-stat own-stat${i === 1 ? " clickable" : ""}`} onClick={i === 1 ? () => setShowGraphs((s) => !s) : undefined}>
                <div className="ic"><i className={`fas ${ic}`} aria-hidden="true" /></div>
                <div className="k">{k}{i === 1 && <i className="fas fa-chevron-down" style={{ marginLeft: 6, fontSize: 9, transform: showGraphs ? "rotate(180deg)" : "none", transition: ".2s" }} />}</div>
                <div className="v">{v}</div>
              </button>
            ))}
          </div>

          {/* Graphs (expand on Revenue click, or always once data is in) */}
          {(showGraphs || group) && (
            <div className="own-charts">
              <div className="adm-card">
                <div className="own-ctitle">Who earns more <span>· revenue by restaurant</span></div>
                <RevenueBar data={(group?.restaurantRevenue ?? []).map((r) => ({ id: r.id, name: r.name, revenue: r.revenue, orders: r.orders, accentColor: r.accentColor || FALLBACK }))}
                  onSelect={(id) => { setView({ level: "restaurant", rid: id }); }} />
                <div className="own-hint">Tip: click a bar to open that restaurant</div>
              </div>
              <div className="adm-card">
                <div className="own-ctitle">Revenue over time <span>· {range === "today" ? "by hour" : "by day"}</span></div>
                <TrendLine data={trendData.rows} lines={trendData.lines} />
              </div>
            </div>
          )}

          {/* Restaurant cards */}
          <h2 className="own-h2">Restaurants</h2>
          <div className="own-grid">
            {!ov && <div className="adm-empty" style={{ gridColumn: "1 / -1" }}>Loading…</div>}
            {ov?.restaurants.map((r) => (
              <button key={r.id} className="adm-card own-card" style={{ ["--rcol" as string]: r.accentColor }} onClick={() => setView({ level: "restaurant", rid: r.id })}>
                <span className="own-accent" aria-hidden="true" />
                <div className="own-head">
                  <div style={{ minWidth: 0, textAlign: "left" }}>
                    <div className="own-name" title={r.name}>{r.name}</div>
                    <div className="adm-muted" style={{ fontSize: 12 }}>{r.slug}</div>
                  </div>
                  <span className={`own-pill ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Off"}</span>
                </div>
                <div className="own-today">
                  <div className="own-cell"><div className="k">Orders today</div><div className="v">{r.ordersToday}</div></div>
                  <div className="own-cell"><div className="k">Revenue today</div><div className="v">{inr(r.revenueToday)}</div></div>
                  <div className="own-cell"><div className="k">Open tables</div><div className="v">{r.openTables}</div></div>
                </div>
                <div className="own-foot">
                  <span><i className="fas fa-receipt" /> {r.ordersAll.toLocaleString("en-US")} all-time</span>
                  <span><i className="fas fa-indian-rupee-sign" /> {inr(r.revenueAll)} all-time</span>
                  <span className="own-open">Open <i className="fas fa-arrow-right" /></span>
                </div>
              </button>
            ))}
          </div>

          {/* More tools — roadmap teasers (each opens a branded Coming-soon page) */}
          <h2 className="own-h2">More tools</h2>
          <div className="adm-teasers">
            {([
              ["/owner/sales", "fa-chart-line", "Sales & reports", "Day / item / tax reports, exportable"],
              ["/owner/inventory", "fa-boxes-stacked", "Inventory", "Stock, recipes & low-stock alerts"],
              ["/owner/customers", "fa-user-group", "Customers & loyalty", "Profiles, points & win-backs"],
              ["/owner/marketing", "fa-bullhorn", "Marketing", "Coupons, campaigns & ROI"],
              ["/owner/online", "fa-truck-fast", "Online & apps", "Zomato, Swiggy & direct ordering"],
              ["/owner/menu", "fa-book-open", "Menu", "Edit items, prices & modifiers"],
            ] as [string, string, string, string][]).map(([href, icon, title, blurb]) => (
              <a key={href} href={href} className="adm-teaser">
                <span className="ti"><i className={`fas ${icon}`} aria-hidden="true" /></span>
                <span style={{ minWidth: 0 }}><span className="tt">{title}<span className="soon">Soon</span></span><span className="tb">{blurb}</span></span>
              </a>
            ))}
          </div>
        </>
      )}

      {/* ============ RESTAURANT ============ */}
      {view.level === "restaurant" && (
        <RestaurantView rest={rest} range={range} restTrend={restTrend} dishSort={dishSort} setDishSort={setDishSort}
          onDish={(title) => setView({ level: "dish", rid: (view as { rid: string }).rid, dish: title })} />
      )}

      {/* ============ DISH ============ */}
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
              <div className="adm-stat"><div className="k">Rank</div><div className="v">#{dishView.rank}<span style={{ fontSize: 13, color: "var(--muted)" }}> / {dishView.of}</span></div></div>
            </div>
            <div className="own-ctitle" style={{ marginTop: 18 }}>How it compares <span>· revenue vs other dishes</span></div>
            <RevenueBar data={(rest?.dishes ?? []).slice(0, 12).map((d) => ({ id: d.title, name: d.title, revenue: d.revenue, orders: d.qty, accentColor: d.title === dishView.d.title ? (rest?.restaurant.accentColor || FALLBACK) : "rgba(128,128,128,.35)" }))}
              onSelect={(title) => setView({ level: "dish", rid: (view as { rid: string }).rid, dish: title })} />
          </>)}
        </div>
      )}

      <style jsx>{`
        .own-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
        .own-crumb { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 800; min-width: 0; }
        .own-crumb .lnk { color: var(--muted); background: none; border: none; font: inherit; cursor: pointer; padding: 0; }
        .own-crumb .lnk:hover { color: var(--accent); text-decoration: underline; }
        .own-crumb .cur { color: var(--fg, inherit); }
        .own-crumb .sep { color: var(--muted); font-weight: 400; }
        .own-range { display: inline-flex; background: var(--card); border: var(--border); border-radius: 10px; padding: 3px; gap: 2px; }
        .own-range button { background: none; border: none; padding: 6px 12px; border-radius: 7px; font-size: 12.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .own-range button.on { background: var(--accent); color: #fff; }
        .own-stat.clickable { cursor: pointer; }
        .own-stat.clickable:hover { border-color: var(--accent); }
        .own-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 8px; }
        .own-ctitle { font-size: 13px; font-weight: 800; margin-bottom: 10px; }
        .own-ctitle span { color: var(--muted); font-weight: 500; }
        .own-hint { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
        .own-h2 { font-size: 14px; font-weight: 800; margin: 22px 0 10px; }
        .own-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 14px; }
        .own-card { position: relative; overflow: hidden; padding-left: 22px; text-align: left; cursor: pointer; transition: transform .12s, box-shadow .12s; width: 100%; font: inherit; color: inherit; }
        .own-card:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,.12); }
        .own-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--rcol, var(--accent)); }
        .own-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
        .own-name { font-size: 16px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .own-pill { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
        .own-pill.on { background: color-mix(in srgb, var(--adm-ok) 20%, transparent); color: var(--adm-ok); }
        .own-pill.off { background: rgba(120,120,120,.18); color: var(--muted); }
        .own-today { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
        .own-cell .k { font-size: 11px; color: var(--muted); }
        .own-cell .v { font-size: 20px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
        .own-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding-top: 12px; border-top: var(--border); font-size: 12px; color: var(--muted); }
        .own-foot i { opacity: .7; margin-right: 4px; }
        .own-open { margin-left: auto; color: var(--rcol, var(--accent)); font-weight: 700; }
        .own-dish-h { border-left: 4px solid var(--rcol); padding-left: 12px; }
        .own-dish-name { font-size: 22px; font-weight: 800; }
        @media (max-width: 760px) { .own-charts { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}

// ---- Restaurant detail view ----
function RestaurantView({ rest, range, restTrend, dishSort, setDishSort, onDish }: {
  rest: RestA | null; range: Range; restTrend: Record<string, unknown>[];
  dishSort: "revenue" | "qty"; setDishSort: (s: "revenue" | "qty") => void; onDish: (t: string) => void;
}) {
  if (!rest) return <div className="adm-empty">Loading restaurant…</div>;
  const accent = rest.restaurant.accentColor || FALLBACK;
  const dishes = [...rest.dishes].sort((a, b) => (dishSort === "revenue" ? b.revenue - a.revenue : b.qty - a.qty));
  const maxRev = Math.max(1, ...dishes.map((d) => d.revenue));
  const k = rest.kpis;
  return (
    <>
      <div className="adm-stats">
        {([["Revenue", inr(k.revenue)], ["Orders", k.orders], ["Avg order", inr(k.avgOrder)], ["Open tables", k.openTables], ["Top dish", k.topDish]] as [string, string | number][]).map(([key, v]) => (
          <div key={key} className="adm-stat"><div className="k">{key}</div><div className="v" style={{ fontSize: key === "Top dish" ? 15 : undefined }}>{v}</div></div>
        ))}
      </div>
      <div className="rv-charts">
        <div className="adm-card"><div className="rv-ct">Revenue over time</div><TrendLine data={restTrend} lines={[{ key: "Revenue", name: "Revenue", color: accent }]} /></div>
        <div className="adm-card"><div className="rv-ct">Busy hours <span>· orders by hour</span></div><HourlyBar data={rest.hourly} color={accent} /></div>
        <div className="adm-card"><div className="rv-ct">Revenue by category</div><CategoryDonut data={rest.categories} /></div>
      </div>
      <div className="adm-card" style={{ marginTop: 14 }}>
        <div className="rv-ct" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Every dish <span style={{ color: "var(--muted)", fontWeight: 500 }}>· click one for detail</span></span>
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
              <i className="fas fa-chevron-right" />
            </button>
          ))}
        </div>
      </div>
      <style jsx>{`
        .rv-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .rv-ct { font-size: 13px; font-weight: 800; margin-bottom: 10px; }
        .rv-ct span { color: var(--muted); font-weight: 500; }
        .rv-sort { display: inline-flex; gap: 2px; background: var(--bg, transparent); }
        .rv-sort button { background: none; border: var(--border); padding: 4px 10px; border-radius: 7px; font-size: 11.5px; font-weight: 700; color: var(--muted); cursor: pointer; }
        .rv-sort button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
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
