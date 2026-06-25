"use client";
// Admin · Overview — the Aevidine command center. The admin is the TOP of the
// hierarchy, so this shows EVERY restaurant on the platform, who owns each one
// (or "independent · manager-run"), and platform-wide analytics with charts.
// Data is reused from the owner RPCs (for the admin cookie they return ALL
// restaurants) + /api/admin/restaurants (the owner mapping). Live + egress-safe
// via useLivePoll (subscribe on mount, tear down on unmount).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { inr, useLivePoll, ActivityFeed, type Action } from "@/components/admin/shared";
import { RevenueBar, TrendLine } from "@/components/owner/Charts";

const FALLBACK = "#e3c06f";
type Rest = { id: string; slug: string; name: string; active: boolean; ownerUserId: string | null; ownerName: string | null };
type OvRow = { id: string; revenueToday: number; ordersToday: number; revenueAll: number; ordersAll: number; openTables: number };
type RevRow = { id: string; name: string; accentColor: string; revenue: number; orders: number };
type TsRow = { bucket: string; restaurantId?: string; revenue: number };

export default function AdminOverview() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [ov, setOv] = useState<{ restaurants: OvRow[]; totals: { openTables: number } } | null>(null);
  const [rev, setRev] = useState<RevRow[]>([]);
  const [ts, setTs] = useState<TsRow[]>([]);
  const [maintenance, setMaintenance] = useState(false);
  const [activity, setActivity] = useState<Action[]>([]);

  const load = useCallback(() => {
    fetch("/api/admin/restaurants", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) { setRests(j.restaurants || []); setOwners(j.owners || []); } }).catch(() => {});
    fetch("/api/owner/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setOv(j); }).catch(() => {});
    fetch("/api/owner/analytics?range=30d", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) { setRev(j.restaurantRevenue || []); setTs(j.timeseries || []); } }).catch(() => {});
    fetch("/api/admin/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setMaintenance(!!j.maintenance); }).catch(() => {});
    fetch("/api/admin/oplog?limit=18", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setActivity(j.actions || []); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useLivePoll(load);

  const ovById = useMemo(() => Object.fromEntries((ov?.restaurants || []).map((r) => [r.id, r])), [ov]);
  const totals = useMemo(() => ({
    revenue: rev.reduce((a, r) => a + r.revenue, 0),
    orders: rev.reduce((a, r) => a + r.orders, 0),
    openTables: ov?.totals.openTables ?? 0,
    ownerCount: owners.length,
  }), [rev, ov, owners]);

  // Multi-line trend: rows {label,[restaurantName]:revenue}; one accent-colored line per restaurant.
  const trend = useMemo(() => {
    const meta = new Map(rev.map((r) => [r.id, { name: r.name, color: r.accentColor || FALLBACK }]));
    const byBucket = new Map<string, Record<string, unknown>>();
    for (const t of ts) {
      const label = new Date(t.bucket).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
      if (!byBucket.has(t.bucket)) byBucket.set(t.bucket, { label });
      const m = meta.get(t.restaurantId || "");
      if (m) (byBucket.get(t.bucket)!)[m.name] = t.revenue;
    }
    return { rows: Array.from(byBucket.values()), lines: rev.slice(0, 8).map((r) => ({ key: r.name, name: r.name, color: r.accentColor || FALLBACK })) };
  }, [rev, ts]);

  const KPIS: [string, string | number][] = [
    ["Restaurants", rests.length || "…"],
    ["Owners", totals.ownerCount],
    ["Revenue · 30d", rev.length ? inr(totals.revenue) : "…"],
    ["Orders · 30d", rev.length ? totals.orders : "…"],
    ["Open tables now", ov ? totals.openTables : "…"],
  ];

  return (
    <>
      <h1 className="adm-page-h">Aevidine · all restaurants</h1>
      <p className="adm-page-sub">Every restaurant on the platform, who runs it, and how it&apos;s doing.</p>

      {maintenance && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 18, display: "flex", alignItems: "center", gap: 12 }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger)", fontSize: 18 }} aria-hidden="true" />
          <div style={{ flex: 1 }}><b>A guest menu is in maintenance.</b></div>
          <Link href="/aevinite/settings" className="adm-btn">Settings</Link>
        </div>
      )}

      <div className="adm-stats">
        {KPIS.map(([k, v]) => (
          <div key={k} className="adm-stat"><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>

      <div className="adm-charts2">
        <div className="adm-card">
          <div className="adm-ctitle">Who earns more <span>· revenue by restaurant (30d)</span></div>
          <RevenueBar data={rev.map((r) => ({ id: r.id, name: r.name, revenue: r.revenue, orders: r.orders, accentColor: r.accentColor || FALLBACK }))} />
        </div>
        <div className="adm-card">
          <div className="adm-ctitle">Revenue over time <span>· by day, per restaurant</span></div>
          <TrendLine data={trend.rows} lines={trend.lines} />
        </div>
      </div>

      <h2 className="adm-h2">Restaurants &amp; owners</h2>
      <div className="adm-rgrid">
        {rests.length === 0 && <div className="adm-empty" style={{ gridColumn: "1 / -1" }}>Loading restaurants…</div>}
        {rests.map((r) => {
          const o = ovById[r.id];
          const accent = rev.find((x) => x.id === r.id)?.accentColor || FALLBACK;
          return (
            <Link key={r.id} href="/aevinite/restaurants" className="adm-card adm-rcard" style={{ ["--rcol" as string]: accent }}>
              <span className="adm-raccent" aria-hidden="true" />
              <div className="adm-rhead">
                <div style={{ minWidth: 0 }}>
                  <div className="adm-rname" title={r.name}>{r.name}</div>
                  <div className="adm-muted" style={{ fontSize: 12 }}>{r.slug}</div>
                </div>
                <span className={`adm-chip ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Off"}</span>
              </div>
              <div className="adm-rowner">
                {r.ownerUserId
                  ? <><i className="fas fa-crown" aria-hidden="true" /> {r.ownerName}</>
                  : <><i className="fas fa-user-gear" aria-hidden="true" /> Independent · manager-run</>}
              </div>
              <div className="adm-rnums">
                <div><div className="k">Today</div><div className="v">{o ? inr(o.revenueToday) : "—"}</div></div>
                <div><div className="k">Orders</div><div className="v">{o ? o.ordersToday : "—"}</div></div>
                <div><div className="k">Open</div><div className="v">{o ? o.openTables : "—"}</div></div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="adm-card" style={{ marginTop: 18 }}>
        <h2>Recent activity <span className="adm-muted" style={{ fontWeight: 400 }}>· across all restaurants &amp; panels</span></h2>
        <ActivityFeed rows={activity} />
      </div>

      <style jsx>{`
        .adm-charts2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 8px; }
        .adm-ctitle { font-size: 13px; font-weight: 800; margin-bottom: 10px; }
        .adm-ctitle span { color: var(--muted); font-weight: 500; }
        .adm-h2 { font-size: 14px; font-weight: 800; margin: 22px 0 10px; }
        .adm-rgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
        .adm-rcard { position: relative; overflow: hidden; padding-left: 22px; text-decoration: none; color: inherit; display: block; transition: transform .12s, box-shadow .12s; }
        .adm-rcard:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(0,0,0,.12); }
        .adm-raccent { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--rcol, var(--accent)); }
        .adm-rhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .adm-rname { font-size: 15.5px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .adm-chip { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; flex-shrink: 0; }
        .adm-chip.on { background: color-mix(in srgb, var(--adm-ok) 20%, transparent); color: var(--adm-ok); }
        .adm-chip.off { background: rgba(120,120,120,.18); color: var(--muted); }
        .adm-rowner { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: var(--rcol, var(--accent)); margin-bottom: 12px; }
        .adm-rowner i { opacity: .85; }
        .adm-rnums { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding-top: 10px; border-top: var(--border); }
        .adm-rnums .k { font-size: 10.5px; color: var(--muted); }
        .adm-rnums .v { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; }
        @media (max-width: 760px) { .adm-charts2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
