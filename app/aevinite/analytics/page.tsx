"use client";
// Admin · Platform Analytics — cross-restaurant OPERATIONAL analytics. NO food
// revenue anywhere (CLAUDE.md hard rule: restaurant earnings are owner-panel-only).
// Everything here is a COUNT: orders, tables, restaurants, staff. Backed by ONE
// admin API (/api/admin/analytics) that aggregates server-side via the migration
// 119/129 RPCs — never a raw-orders fetch to the client. Refreshed by
// useActiveAutoRefresh (60s, only while visible & in use) + a manual Refresh.
//
// Layout follows the dataviz spec: a KPI row of stat tiles (value + context, no
// redundant tile — total tables lives inside the occupancy meter), one zero-filled
// orders-per-bucket chart (hourly for Today), then busiest restaurants (table +
// inline magnitude bar) beside the source split. Refetches hold the previous
// render at reduced opacity — no skeleton flash.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { openRestaurantPanel, useActiveAutoRefresh } from "@/components/admin/shared";
import type { TrendPoint } from "@/components/admin/OrdersTrend";

const OrdersTrend = dynamic(() => import("@/components/admin/OrdersTrend"), {
  ssr: false,
  loading: () => <div className="adm-empty">Loading chart…</div>,
});

type Range = "today" | "7d" | "30d";
type Busiest = { id: string; slug: string; name: string; orders: number; activeTablesNow: number };
type Data = {
  totals: { totalOrders: number; activeTablesNow: number; activeRestaurants: number; totalRestaurants: number; totalStaff: number; totalTables: number };
  bucket?: "day" | "hour";
  trend: TrendPoint[];
  busiest: Busiest[];
  bySource: { source: string; orders: number }[];
};

const SOURCE_LABEL: Record<string, string> = { dine_in: "Dine-in", zomato: "Zomato", swiggy: "Swiggy", takeaway: "Website", parcel: "Parcel", other: "Other" };
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };
const nf = new Intl.NumberFormat("en-IN");

// 12-point sparkline for the Orders tile — muted stroke (the tile's value is the
// loud part), no axes; the trend it compresses is the chart right below.
function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2 || !pts.some((v) => v > 0)) return null;
  const w = 72, h = 26, hi = Math.max(...pts), step = w / (pts.length - 1);
  const d = pts.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (v / (hi || 1)) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "block" }}>
      <path d={d} fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".7" />
    </svg>
  );
}

export default function AdminAnalytics() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Honor ?range= on first mount so a drill-in (dashboard "Orders today" → ?range=today) opens
  // the right window, not the 7-day default. Done in an effect (not the useState init) to avoid
  // an SSR hydration mismatch (audit 2026-07-08).
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get("range");
    if (r === "today" || r === "30d") setRange(r);
  }, []);

  const load = useCallback(async (r: Range) => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/analytics?range=${r}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load analytics.");
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(range); }, [range, load]);
  useActiveAutoRefresh(() => load(range), 60000);

  const t = data?.totals;
  const occupancy = t && t.totalTables > 0 ? Math.min(1, t.activeTablesNow / t.totalTables) : 0;
  // Sparkline compresses the trend to ≤12 points so a 30-day range doesn't draw 30 segments 6px apart.
  const sparkPts = (() => {
    const tr = data?.trend || [];
    if (tr.length <= 12) return tr.map((p) => p.orders);
    const step = tr.length / 12;
    return Array.from({ length: 12 }, (_, i) => tr.slice(Math.floor(i * step), Math.floor((i + 1) * step)).reduce((s, p) => s + p.orders, 0));
  })();

  const busiestActive = (data?.busiest || []).filter((r) => r.orders > 0).slice(0, 8);
  const busiestMax = Math.max(1, ...busiestActive.map((r) => r.orders));
  const sources = (data?.bySource || []).filter((s) => s.orders > 0 || s.source === "dine_in");
  const sourceTotal = sources.reduce((s, x) => s + x.orders, 0);
  const maxSource = Math.max(1, ...sources.map((s) => s.orders));

  // A stat tile: icon chip · label · big proportional value · context line.
  // `href`/`onClick` make the tile itself the way into its detail (house rule:
  // no dead stat tiles) — plain <div> only when there is nowhere deeper to go.
  const tile = (opts: { icon: string; label: string; value: React.ReactNode; sub?: React.ReactNode; extra?: React.ReactNode; href?: string; title?: string }) => {
    const inner = (
      <>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <span className="ic"><i className={`fas ${opts.icon}`} aria-hidden="true" /></span>
          {opts.extra}
        </div>
        <div className="k">{opts.label}</div>
        <div className="v" style={{ fontVariantNumeric: "normal" }}>{opts.value}</div>
        {opts.sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{opts.sub}</div>}
      </>
    );
    return opts.href ? (
      <a key={opts.label} className="adm-stat" href={opts.href} title={opts.title} style={{ display: "block", color: "inherit", textDecoration: "none", cursor: "pointer" }}>{inner}</a>
    ) : (
      <div key={opts.label} className="adm-stat">{inner}</div>
    );
  };

  return (
    <>
      <h1 className="adm-page-h">Platform analytics</h1>
      <p className="adm-page-sub">Cross-restaurant operational trends — order counts only, never earnings. {RANGE_LABEL[range]}.</p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div className="adm-tabs">
          {(["today", "7d", "30d"] as Range[]).map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>
          ))}
        </div>
        <button className="adm-btn" disabled={loading} onClick={() => load(range)}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err}</p>}

      {/* Refetch keeps the frame: previous numbers stay visible, slightly dimmed. */}
      <div style={{ opacity: loading && data ? 0.55 : 1, transition: "opacity .2s" }}>
        <div className="adm-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          {tile({
            icon: "fa-receipt", label: `Orders · ${RANGE_LABEL[range].toLowerCase()}`,
            value: t ? nf.format(t.totalOrders) : "…",
            sub: t && t.totalOrders === 0 ? "no orders in this range" : "dine-in, all restaurants",
            extra: <Spark pts={sparkPts} />,
          })}
          {tile({
            icon: "fa-chair", label: "Tables occupied now",
            value: t ? nf.format(t.activeTablesNow) : "…",
            href: "/aevinite/floor", title: "Open the live floor",
            sub: t ? (
              <>
                <span>of {nf.format(t.totalTables)} tables ({Math.round(occupancy * 100)}%)</span>
                <span style={{ display: "block", height: 6, borderRadius: 999, background: "color-mix(in srgb, var(--accent) 16%, transparent)", overflow: "hidden", marginTop: 6 }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.max(occupancy * 100, t.activeTablesNow > 0 ? 2 : 0)}%`, background: "var(--accent)", borderRadius: 999 }} />
                </span>
              </>
            ) : undefined,
          })}
          {tile({
            icon: "fa-store", label: "Active restaurants",
            value: t ? <>{t.activeRestaurants}<span style={{ color: "var(--muted)", fontWeight: 600, fontSize: 17 }}> / {t.totalRestaurants}</span></> : "…",
            href: "/aevinite/restaurants", title: "Manage restaurants",
            sub: t && t.totalRestaurants - t.activeRestaurants > 0 ? `${t.totalRestaurants - t.activeRestaurants} suspended` : "all live",
          })}
          {tile({
            icon: "fa-user-group", label: "Active staff",
            value: t ? nf.format(t.totalStaff) : "…",
            href: "/aevinite/users", title: "Manage users",
            sub: "manager · kitchen · tablet · owner",
          })}
        </div>

        <div className="adm-card" style={{ marginBottom: 14 }}>
          <h2>Orders per {range === "today" ? "hour" : "day"}</h2>
          <p className="hint">Platform-wide order count for {RANGE_LABEL[range].toLowerCase()} — every bucket plotted, quiet ones as zero.</p>
          {data ? <OrdersTrend data={data.trend} bucket={data.bucket || "day"} /> : <div className="adm-empty">{err ? "Couldn't load — press Refresh." : "Loading…"}</div>}
        </div>

        <div className="adx-grid2col">
          <div className="adm-card" style={{ marginBottom: 14 }}>
            <h2>Busiest restaurants</h2>
            <p className="hint">Ranked by order count (not money) for {RANGE_LABEL[range].toLowerCase()}.</p>
            {data === null ? (
              <div className="adm-empty">{err ? "Couldn't load — press Refresh." : "Loading…"}</div>
            ) : busiestActive.length === 0 ? (
              <div className="adm-empty">No orders in this range yet.</div>
            ) : (
              <div className="adm-logwrap">
                <div className="adm-logrow head" style={{ gridTemplateColumns: "1.4fr 70px 80px 1fr" }}>
                  <span>Restaurant</span><span style={{ textAlign: "right" }}>Orders</span><span style={{ textAlign: "right" }}>Open now</span><span />
                </div>
                {busiestActive.map((r) => (
                  <div key={r.id} className="adm-logrow" style={{ gridTemplateColumns: "1.4fr 70px 80px 1fr", alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      <div style={{ height: 5, borderRadius: 999, background: "color-mix(in srgb, var(--accent) 14%, transparent)", overflow: "hidden", marginTop: 5, maxWidth: 180 }}>
                        <div style={{ height: "100%", width: `${Math.max((r.orders / busiestMax) * 100, 2)}%`, background: "var(--accent)", borderRadius: 999 }} />
                      </div>
                    </div>
                    <div style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{nf.format(r.orders)}</div>
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} className="adm-muted">{r.activeTablesNow}</div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button className="adm-btn" onClick={() => openRestaurantPanel(r.id, "/editor")} title={`Open ${r.name}'s manager panel`}>
                        <i className="fas fa-arrow-up-right-from-square" style={{ marginRight: 5 }} aria-hidden="true" />Manager
                      </button>
                      <a className="adm-btn" href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`}>Manage →</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="adm-card" style={{ marginBottom: 14 }}>
            <h2>Orders by source</h2>
            <p className="hint">Dine-in vs platform (Zomato / Swiggy / takeaway) order counts.</p>
            {data === null ? (
              <div className="adm-empty">{err ? "Couldn't load — press Refresh." : "Loading…"}</div>
            ) : sourceTotal === 0 ? (
              <div className="adm-empty">No orders in this range yet.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {sources.map((s) => (
                  <div key={s.source}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span>{SOURCE_LABEL[s.source] || s.source}</span>
                      <span>
                        <b style={{ fontVariantNumeric: "tabular-nums" }}>{nf.format(s.orders)}</b>
                        <span className="adm-muted" style={{ marginLeft: 6 }}>{sourceTotal > 0 ? Math.round((s.orders / sourceTotal) * 100) : 0}%</span>
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "color-mix(in srgb, var(--accent) 14%, transparent)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max((s.orders / maxSource) * 100, s.orders > 0 ? 2 : 0)}%`, background: "var(--accent)", borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
