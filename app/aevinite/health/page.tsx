"use client";
// Admin · System health — read-only platform diagnostics. Deliberately cheap: one
// small API call (/api/admin/health) that times a trivial round-trip, reads
// planner ROW ESTIMATES (not exact counts) for the big tables, and a couple of
// small bounded queries. No secrets, no food revenue. Manual Refresh +
// useActiveAutoRefresh (60s, only while visible & in use) — this page must never
// itself become a load source.
import { useCallback, useEffect, useState } from "react";
import { timeAgo, useActiveAutoRefresh } from "@/components/admin/shared";

type Health = {
  dbOk: boolean;
  latencyMs: number;
  tableEstimates: { table: string; estRows: number }[];
  tableEstimatesError: string | null;
  restaurants: { active: number; suspended: number; total: number };
  staffOnlineNow: number;
  staffTotal: number;
  realtime: { configuredHost: string | null };
  openIssues: number | null;
  issuesFeedWired: boolean;
  checkedAt: string;
  error?: string;
};

const TABLE_LABEL: Record<string, string> = {
  orders: "Orders", order_items: "Order items", sessions: "Sessions", staff_users: "Staff users", restaurants: "Restaurants",
};

function latencyTier(ms: number): "good" | "warn" | "bad" {
  if (ms < 300) return "good";
  if (ms < 900) return "warn";
  return "bad";
}

export default function AdminHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/health", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load health.");
      setH(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const tier = h ? latencyTier(h.latencyMs) : "warn";

  return (
    <>
      <h1 className="adm-page-h">System health</h1>
      <p className="adm-page-sub">Read-only platform diagnostics. {h ? <>Last checked {timeAgo(h.checkedAt)}.</> : null}</p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 6 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err}</p>}

      {h === null ? (
        <div className="adm-empty">Checking…</div>
      ) : !h.dbOk ? (
        // Database ping failed → the API omits every summary field, so we must NOT
        // fall through to the normal render (it reads h.restaurants.* and would crash
        // the whole page exactly when the DB is down — the one moment this page matters).
        <div className="adm-card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <span className="adx-pill bad"><span className="dot" />Database unreachable</span>
          <span className="adm-muted" style={{ fontSize: 13 }}>
            The health check couldn&apos;t reach the database{h.latencyMs ? ` (after ${h.latencyMs}ms)` : ""}.
            {h.error ? <> Details: <span className="mono">{h.error}</span></> : null} Press Refresh to retry.
          </span>
        </div>
      ) : (
        <>
          <div className="adm-card" style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span className={`adx-pill ${h.dbOk ? tier : "bad"}`}><span className="dot" />{h.dbOk ? `Database ${h.latencyMs}ms` : "Database unreachable"}</span>
            <span className="adx-pill good"><span className="dot" />{h.restaurants.active} restaurant{h.restaurants.active !== 1 ? "s" : ""} live</span>
            {h.restaurants.suspended > 0 && <span className="adx-pill warn"><span className="dot" />{h.restaurants.suspended} suspended</span>}
            <span className={`adx-pill ${h.staffOnlineNow > 0 ? "good" : "warn"}`}><span className="dot" />{h.staffOnlineNow} staff online now</span>
            <span className={`adx-pill ${h.issuesFeedWired ? (h.openIssues ? "warn" : "good") : "warn"}`}><span className="dot" />{h.issuesFeedWired ? `${h.openIssues} open issue${h.openIssues === 1 ? "" : "s"}` : "issue feed unreachable"}</span>
          </div>

          <div className="adx-grid2col">
            <div className="adm-card" style={{ marginBottom: 14 }}>
              <h2>Row count estimates</h2>
              <p className="hint">Planner estimates (not exact counts) — an exact COUNT(*) on these tables would itself be a heavy scan, so we read Postgres&apos; own row-count metadata instead.</p>
              {h.tableEstimatesError ? (
                <div className="adm-empty">Couldn&apos;t read estimates: {h.tableEstimatesError}</div>
              ) : (
                <div className="adm-logwrap">
                  <div className="adm-logrow head" style={{ gridTemplateColumns: "1fr 120px" }}><span>Table</span><span style={{ textAlign: "right" }}>~ rows</span></div>
                  {h.tableEstimates.map((t) => (
                    <div key={t.table} className="adm-logrow" style={{ gridTemplateColumns: "1fr 120px" }}>
                      <span>{TABLE_LABEL[t.table] || t.table}</span>
                      <span style={{ textAlign: "right", fontWeight: 700 }}>{t.estRows.toLocaleString("en-US")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="adm-card" style={{ marginBottom: 14 }}>
              <h2>Realtime &amp; connections</h2>
              <p className="hint">Confirms the app is pointed at the right backend — no keys shown.</p>
              <div className="adm-logwrap">
                <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Realtime host</span><span className="mono adm-muted">{h.realtime.configuredHost || "not configured"}</span></div>
                <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Staff online (last 3 min)</span><span style={{ fontWeight: 700 }}>{h.staffOnlineNow} / {h.staffTotal}</span></div>
                <div className="adm-logrow" style={{ gridTemplateColumns: "1fr auto" }}><span>Restaurants</span><span style={{ fontWeight: 700 }}>{h.restaurants.active} live · {h.restaurants.suspended} suspended</span></div>
              </div>
              <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                {h.issuesFeedWired
                  ? `Staff-raised issues (the closest thing to an error feed): ${h.openIssues} open across the platform.`
                  : "Couldn't reach the issues table — no error feed available right now."}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
