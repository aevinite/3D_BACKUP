"use client";
// Admin · Platform Analytics — cross-restaurant OPERATIONAL analytics. NO food
// revenue anywhere (CLAUDE.md hard rule: restaurant earnings are owner-panel-only).
// Everything here is a COUNT: orders, tables, restaurants, staff. Backed by ONE
// admin API (/api/admin/analytics) that aggregates server-side via the migration
// 119 RPCs — never a raw-orders fetch to the client. Refreshed by
// useActiveAutoRefresh (60s, only while visible & in use) + a manual Refresh.
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
  trend: TrendPoint[];
  busiest: Busiest[];
  bySource: { source: string; orders: number }[];
};

const SOURCE_LABEL: Record<string, string> = { dine_in: "Dine-in", zomato: "Zomato", swiggy: "Swiggy", takeaway: "Takeaway", other: "Other" };
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

export default function AdminAnalytics() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  const stats: [string, string | number][] = data
    ? [
        ["Total orders", data.totals.totalOrders],
        ["Active tables now", data.totals.activeTablesNow],
        ["Active restaurants", `${data.totals.activeRestaurants} / ${data.totals.totalRestaurants}`],
        ["Total staff", data.totals.totalStaff],
        ["Total tables", data.totals.totalTables],
      ]
    : ([["Total orders", "…"], ["Active tables now", "…"], ["Active restaurants", "…"], ["Total staff", "…"], ["Total tables", "…"]] as [string, string | number][]);

  const maxSource = Math.max(1, ...(data?.bySource || []).map((s) => s.orders));

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

      <div className="adm-stats">
        {stats.map(([k, v]) => (
          <div key={k} className="adm-stat"><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>

      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>Orders per day</h2>
        <p className="hint">Platform-wide order count trend for {RANGE_LABEL[range].toLowerCase()}.</p>
        {data ? <OrdersTrend data={data.trend} /> : <div className="adm-empty">Loading…</div>}
      </div>

      <div className="adx-grid2col">
        <div className="adm-card" style={{ marginBottom: 14 }}>
          <h2>Busiest restaurants</h2>
          <p className="hint">Ranked by order count (not money) for {RANGE_LABEL[range].toLowerCase()}.</p>
          {data === null ? (
            <div className="adm-empty">Loading…</div>
          ) : data.busiest.length === 0 ? (
            <div className="adm-empty">No orders in this range yet.</div>
          ) : (
            <div className="adm-logwrap">
              <div className="adm-logrow head" style={{ gridTemplateColumns: "1.3fr 90px 90px 1fr" }}>
                <span>Restaurant</span><span style={{ textAlign: "right" }}>Orders</span><span style={{ textAlign: "right" }}>Open now</span><span />
              </div>
              {data.busiest.map((r) => (
                <div key={r.id} className="adm-logrow" style={{ gridTemplateColumns: "1.3fr 90px 90px 1fr" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                    <div className="adm-muted mono" style={{ fontSize: 11.5 }}>{r.slug}</div>
                  </div>
                  <div style={{ textAlign: "right", fontWeight: 700 }}>{r.orders}</div>
                  <div style={{ textAlign: "right" }} className="adm-muted">{r.activeTablesNow}</div>
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
            <div className="adm-empty">Loading…</div>
          ) : data.bySource.every((s) => s.orders === 0) ? (
            <div className="adm-empty">No orders in this range yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {data.bySource.filter((s) => s.orders > 0 || s.source === "dine_in").map((s) => (
                <div key={s.source}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                    <span>{SOURCE_LABEL[s.source] || s.source}</span><span style={{ fontWeight: 700 }}>{s.orders}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: "var(--muted2, rgba(120,120,120,0.18))", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(3, (s.orders / maxSource) * 100)}%`, background: "var(--accent-grad, var(--accent))", borderRadius: 999 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
