"use client";
// Owner · All restaurants — the headline SaaS view: every restaurant the owner
// runs, side by side, on ONE page. A top summary (today's revenue + orders +
// open tables across the whole group) then a CARD PER RESTAURANT with its own
// numbers. Numbers come pre-aggregated from /api/owner/overview (one grouped RPC),
// and refresh live on the same realtime bus the admin screens use.
import { useState } from "react";
import { inr, useLivePoll } from "@/components/admin/shared";

type Restaurant = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  accentColor: string;
  ordersToday: number;
  revenueToday: number;
  ordersAll: number;
  revenueAll: number;
  openTables: number;
};
type Overview = {
  restaurants: Restaurant[];
  totals: { revenueToday: number; ordersToday: number; openTables: number; restaurantCount: number };
};

export default function OwnerOverview() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Live push (mount + on any ops/menu change + tab-wake + 60s safety net), one
  // websocket for the page — same pattern as the admin Overview.
  useLivePoll(() => {
    fetch("/api/owner/overview", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else { setErr(null); setOv(j); } })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  });

  const t = ov?.totals;
  const summary: [string, string | number][] = [
    ["Restaurants", t ? t.restaurantCount : "…"],
    ["Revenue today", t ? inr(t.revenueToday) : "…"],
    ["Orders today", t ? t.ordersToday : "…"],
    ["Open tables now", t ? t.openTables : "…"],
  ];

  return (
    <>
      <h1 className="adm-page-h">All restaurants</h1>
      <p className="adm-page-sub">Every restaurant you run, at a glance — today and all-time.</p>

      {err && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 20 }}>
          <b>Couldn&apos;t load the overview.</b>
          <div className="adm-muted" style={{ fontSize: 12.5 }}>{err}</div>
        </div>
      )}

      {/* Top line — the whole group, today. */}
      <div className="adm-stats">
        {summary.map(([k, v]) => (
          <div key={k} className="adm-stat"><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>

      {/* One card per restaurant. */}
      <div className="own-grid">
        {!ov && <div className="adm-empty" style={{ gridColumn: "1 / -1" }}>Loading restaurants…</div>}
        {ov && ov.restaurants.length === 0 && (
          <div className="adm-empty" style={{ gridColumn: "1 / -1" }}>No restaurants yet.</div>
        )}
        {ov?.restaurants.map((r) => (
          <div key={r.id} className="adm-card own-card" style={{ ["--rcol" as string]: r.accentColor }}>
            <span className="own-accent" aria-hidden="true" />
            <div className="own-head">
              <div style={{ minWidth: 0 }}>
                <div className="own-name" title={r.name}>{r.name}</div>
                <div className="adm-muted" style={{ fontSize: 12 }}>{r.slug}</div>
              </div>
              <span className={`own-pill ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Off"}</span>
            </div>

            {/* Today */}
            <div className="own-today">
              <div className="own-cell">
                <div className="k">Orders today</div>
                <div className="v">{r.ordersToday}</div>
              </div>
              <div className="own-cell">
                <div className="k">Revenue today</div>
                <div className="v">{inr(r.revenueToday)}</div>
              </div>
              <div className="own-cell">
                <div className="k">Open tables</div>
                <div className="v">{r.openTables}</div>
              </div>
            </div>

            {/* All-time footer */}
            <div className="own-foot">
              <span><i className="fas fa-receipt" aria-hidden="true" /> {r.ordersAll.toLocaleString("en-US")} orders all-time</span>
              <span><i className="fas fa-indian-rupee-sign" aria-hidden="true" /> {inr(r.revenueAll)} all-time</span>
            </div>
          </div>
        ))}
      </div>

      {/* Scoped styles — reuse the admin tokens (var(--card) / --border / --muted)
          so it sits inside the .adm chrome and follows light/dark automatically. */}
      <style jsx>{`
        .own-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
          gap: 14px;
        }
        .own-card {
          position: relative;
          overflow: hidden;
          padding-left: 22px;
        }
        .own-accent {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 5px;
          background: var(--rcol, var(--accent));
        }
        .own-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 14px;
        }
        .own-name {
          font-size: 16px;
          font-weight: 800;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .own-pill {
          font-size: 10.5px;
          font-weight: 800;
          padding: 3px 9px;
          border-radius: 999px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          flex-shrink: 0;
        }
        .own-pill.on { background: color-mix(in srgb, var(--adm-ok) 20%, transparent); color: var(--adm-ok); }
        .own-pill.off { background: rgba(120, 120, 120, 0.18); color: var(--muted); }
        .own-today {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 14px;
        }
        .own-cell .k { font-size: 11px; color: var(--muted); }
        .own-cell .v {
          font-size: 20px;
          font-weight: 800;
          margin-top: 2px;
          font-variant-numeric: tabular-nums;
        }
        .own-foot {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 16px;
          padding-top: 12px;
          border-top: var(--border);
          font-size: 12px;
          color: var(--muted);
        }
        .own-foot i { opacity: 0.7; margin-right: 4px; }
      `}</style>
    </>
  );
}
