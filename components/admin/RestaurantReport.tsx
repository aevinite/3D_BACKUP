"use client";
// RestaurantReport — the per-restaurant "Full report" (owner's words: "every
// single bit" of ONE restaurant). NO food revenue (CLAUDE.md hard rule) —
// everything here is a usage COUNT or the labelled "activity volume" proxy.
// Backed by /api/admin/restaurants/report, scoped `.eq("restaurant_id", rid)`.
// Print-friendly: window.print() + the @media print rules in globals.css hide
// the admin chrome and keep just this content.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { ActivityFeed, type Action } from "@/components/admin/shared";
import type { TrendPoint } from "@/components/admin/OrdersTrend";

const OrdersTrend = dynamic(() => import("@/components/admin/OrdersTrend"), {
  ssr: false,
  loading: () => <div className="adm-empty">Loading chart…</div>,
});

type Range = "today" | "7d" | "30d";
const RANGE_LABEL: Record<Range, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

type Report = {
  restaurant: { id: string; name: string; slug: string; active: boolean; createdAt: string; owner: string | null; plan: string | null; planStatus: string | null };
  range: Range;
  usage: {
    orders: number; orderItems: number; activityLogEvents: number; waiterCalls: number; sessions: number;
    tablesConfigured: number; tablesOpenNow: number; menuItemCount: number;
    staffByRole: Record<string, number>; staffTotal: number; activityVolume: number;
  };
  trend: TrendPoint[];
};

const ROLE_LABEL: Record<string, string> = { manager: "Manager", tablet: "Tablet", kitchen: "Kitchen", owner: "Owner" };

export default function RestaurantReport({ restaurantId, restaurantName, onBack }: { restaurantId: string; restaurantName: string; onBack: () => void }) {
  const [range, setRange] = useState<Range>("7d");
  const [report, setReport] = useState<Report | null>(null);
  const [activity, setActivity] = useState<Action[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (r: Range) => {
    setLoading(true); setErr(null);
    try {
      const [repRes, actRes] = await Promise.all([
        fetch(`/api/admin/restaurants/report?restaurant_id=${encodeURIComponent(restaurantId)}&range=${r}`, { cache: "no-store" }),
        fetch(`/api/admin/oplog?restaurant_id=${encodeURIComponent(restaurantId)}&limit=30`, { cache: "no-store" }),
      ]);
      const repJ = await repRes.json();
      if (!repRes.ok) throw new Error(repJ.error || "Couldn't load the report.");
      setReport(repJ);
      const actJ = await actRes.json();
      if (actRes.ok) setActivity(actJ.actions || []);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [restaurantId]);
  useEffect(() => { load(range); }, [range, load]);

  return (
    <>
      <nav className="adm-crumbs adx-noprint" aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>{restaurantName}</a>
        <i className="fas fa-chevron-right sep" aria-hidden="true" />
        <span className="cur">Full report</span>
      </nav>

      <h1 className="adm-page-h">{restaurantName} — full report</h1>
      <p className="adm-page-sub">Every usage figure we have for this restaurant, scoped to just it. No food revenue — that&apos;s the owner panel&apos;s job.</p>

      <div className="adx-noprint" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div className="adm-tabs">
          {(["today", "7d", "30d"] as Range[]).map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="adm-btn" disabled={loading} onClick={() => load(range)}>
            <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
          </button>
          <button className="adm-btn" onClick={() => window.print()}><i className="fas fa-print" style={{ marginRight: 6 }} aria-hidden="true" />Print</button>
        </div>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err}</p>}

      {report === null ? (
        <div className="adm-empty">Loading…</div>
      ) : (
        <>
          <div className="adm-card" style={{ marginBottom: 14 }}>
            <h2>Overview</h2>
            <div className="adm-logwrap">
              <div className="adm-logrow" style={{ gridTemplateColumns: "1fr 1fr" }}><span className="adm-muted">Slug</span><span className="mono">{report.restaurant.slug}</span></div>
              <div className="adm-logrow" style={{ gridTemplateColumns: "1fr 1fr" }}><span className="adm-muted">Status</span><span>{report.restaurant.active ? "Live" : "Suspended"}</span></div>
              <div className="adm-logrow" style={{ gridTemplateColumns: "1fr 1fr" }}><span className="adm-muted">Owner</span><span>{report.restaurant.owner || "—"}</span></div>
              <div className="adm-logrow" style={{ gridTemplateColumns: "1fr 1fr" }}><span className="adm-muted">Created</span><span>{new Date(report.restaurant.createdAt).toLocaleDateString()}</span></div>
              <div className="adm-logrow" style={{ gridTemplateColumns: "1fr 1fr" }}><span className="adm-muted">Plan</span><span>{report.restaurant.plan ? `${report.restaurant.plan} (${report.restaurant.planStatus})` : "No plan set"}</span></div>
            </div>
          </div>

          <div className="adm-stats">
            <div className="adm-stat"><div className="k">Orders</div><div className="v">{report.usage.orders}</div></div>
            <div className="adm-stat"><div className="k">Tables open now</div><div className="v">{report.usage.tablesOpenNow} / {report.usage.tablesConfigured}</div></div>
            <div className="adm-stat"><div className="k">Staff</div><div className="v">{report.usage.staffTotal}</div></div>
            <div className="adm-stat"><div className="k">Menu items</div><div className="v">{report.usage.menuItemCount}</div></div>
            <div className="adm-stat"><div className="k">Waiter calls</div><div className="v">{report.usage.waiterCalls}</div></div>
            <div className="adm-stat"><div className="k">Sessions</div><div className="v">{report.usage.sessions}</div></div>
          </div>

          <div className="adm-card" style={{ marginBottom: 14 }}>
            <h2>Activity volume <span className="adm-muted" style={{ fontWeight: 400 }}>· {RANGE_LABEL[range].toLowerCase()}</span></h2>
            <p className="hint">
              A proxy for how much this restaurant has used the platform — orders + order-items + activity-log rows +
              sessions written in this range. This is a row-count figure, <b>not bytes and not a billing number</b>;
              real per-tenant database egress isn&apos;t queryable, so this is the closest honest stand-in.
            </p>
            <div className="fit-num" style={{ fontSize: 30, fontWeight: 800 }}>{report.usage.activityVolume.toLocaleString("en-US")}</div>
            <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
              {report.usage.orders} orders · {report.usage.orderItems} order-items · {report.usage.activityLogEvents} activity-log events · {report.usage.sessions} sessions
            </p>
          </div>

          <div className="adx-grid2col">
            <div className="adm-card" style={{ marginBottom: 14 }}>
              <h2>Orders per day</h2>
              <OrdersTrend data={report.trend} />
            </div>
            <div className="adm-card" style={{ marginBottom: 14 }}>
              <h2>Staff by role</h2>
              {report.usage.staffTotal === 0 ? (
                <div className="adm-empty">No active staff.</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {Object.entries(report.usage.staffByRole).map(([role, n]) => (
                    <div key={role} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>{ROLE_LABEL[role] || role}</span><span style={{ fontWeight: 700 }}>{n}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="adm-card adx-noprint">
            <h2>Recent activity</h2>
            {activity === null ? <div className="adm-empty">Loading…</div> : <ActivityFeed rows={activity} />}
          </div>
        </>
      )}
    </>
  );
}
