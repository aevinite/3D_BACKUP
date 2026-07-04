"use client";
// Admin · Live floor — the WHOLE platform at a glance, "year calendar" style
// (owner 2026-07-04): each restaurant is a block (a "month"), each table a tiny
// coloured cell (a "date"). Colour = kitchen state, ring = unpaid/paid, dot = a
// waiter call. Clicking a restaurant's name quick-opens its manager panel.
// Refreshes on a calm 45s active-tab timer + manual Refresh — NOT per-event
// realtime (a platform-wide firehose would refetch the whole fan-out on every
// order anywhere; this page is a lookout, not an ops screen).
import { useCallback, useEffect, useState } from "react";
import { openRestaurantPanel, useActiveAutoRefresh } from "@/components/admin/shared";

type MiniTable = { n: string; s: string; p: string; c: boolean };
type RestFloor = { id: string; name: string; slug: string; active: boolean; tables: MiniTable[]; error: string | null };

// Same palette the manager/tablet legends use, so colours mean ONE thing everywhere.
const STATE_COLOR: Record<string, string> = {
  free: "", seated: "#2dd4bf", new: "#f59e0b", preparing: "#4f9dff", served: "#22c55e", cleared: "#6b6253",
};
const LEGEND: [string, string][] = [
  ["Free", "var(--muted2, rgba(120,120,120,.25))"], ["Seated", "#2dd4bf"], ["New order", "#f59e0b"],
  ["Preparing", "#4f9dff"], ["Served", "#22c55e"],
];

export default function AdminFloor() {
  const [rests, setRests] = useState<RestFloor[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/floor?all=1", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.error) setErr(j.error); else { setErr(null); setRests(j.restaurants as RestFloor[]); }
    }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 45000);
  const manualRefresh = () => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 600); };

  const busy = (t: MiniTable[]) => t.filter((x) => x.s !== "free").length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Live floor</h1>
        <button className="adm-btn" onClick={manualRefresh} disabled={refreshing}>
          <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>
      <p className="adm-page-sub">Every table of every restaurant — colour is the kitchen state, a red ring is an unpaid bill, a dot is a waiter call.</p>

      <div className="adm-card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
        {LEGEND.map(([label, color]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} className="adm-muted">
            <i style={{ width: 11, height: 11, borderRadius: 3, background: color, display: "inline-block" }} aria-hidden="true" />{label}
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} className="adm-muted">
          <i style={{ width: 11, height: 11, borderRadius: 3, border: "2px solid #f87171", display: "inline-block", boxSizing: "border-box" }} aria-hidden="true" />Unpaid
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }} className="adm-muted">
          <i style={{ width: 11, height: 11, borderRadius: 3, border: "2px solid #34d399", display: "inline-block", boxSizing: "border-box" }} aria-hidden="true" />Paid
        </span>
        <span className="adm-muted">• = waiter call</span>
      </div>

      {err && <p style={{ color: "var(--adm-danger)" }}>Couldn&apos;t load the floors: {err}</p>}
      {rests === null ? (
        <div className="adm-empty">Loading every restaurant&apos;s floor…</div>
      ) : (
        <div className="adm-flooryear">
          {rests.map((r) => (
            <section key={r.id} className="adm-card adm-floormonth" aria-label={`${r.name} floor`}>
              <header>
                <button className="adm-floormonth-name" onClick={() => openRestaurantPanel(r.id, "/manager")}
                  title={`Open ${r.name}'s manager panel (new tab, no password)`}>
                  {r.name}
                </button>
                <span className="adm-muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                  {r.error ? "floor unavailable" : `${busy(r.tables)}/${r.tables.length} busy`}
                  {!r.active && <span style={{ color: "var(--adm-danger)", fontWeight: 700 }}> · suspended</span>}
                </span>
              </header>
              {r.error ? (
                <div className="adm-empty" style={{ padding: 10, fontSize: 12 }}>{r.error}</div>
              ) : r.tables.length === 0 ? (
                <div className="adm-empty" style={{ padding: 10, fontSize: 12 }}>No tables.</div>
              ) : (
                <div className="adm-minigrid">
                  {r.tables.map((t) => (
                    <span key={t.n}
                      className="adm-minitile"
                      style={{
                        background: STATE_COLOR[t.s] || "var(--muted2, rgba(120,120,120,.25))",
                        boxShadow: t.p === "red" ? "inset 0 0 0 2px #f87171" : t.p === "green" ? "inset 0 0 0 2px #34d399" : undefined,
                        color: t.s === "free" ? "var(--muted)" : "#fff",
                      }}
                      title={`Table ${t.n} — ${t.s}${t.p === "red" ? " · UNPAID" : t.p === "green" ? " · paid" : ""}${t.c ? " · waiter called" : ""}`}>
                      {t.c ? "•" : t.n}
                    </span>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
