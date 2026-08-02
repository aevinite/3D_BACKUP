"use client";
// Admin · System health — read-only platform diagnostics. Deliberately cheap: one
// small API call (/api/admin/health) that times a trivial round-trip, reads
// planner ROW ESTIMATES (not exact counts) for the big tables, and a couple of
// small bounded queries. No secrets, no food revenue. Manual Refresh +
// useActiveAutoRefresh (60s, only while visible & in use) — this page must never
// itself become a load source.
import { useCallback, useEffect, useState } from "react";
import { timeAgo, useActiveAutoRefresh } from "@/components/admin/shared";
import { SkelList } from "@/components/admin/Skeleton";

type Health = {
  dbOk: boolean;
  latencyMs: number;
  tableEstimates: { table: string; estRows: number }[];
  tableEstimatesError: string | null;
  restaurants: { active: number; suspended: number; total: number };
  restaurantsError?: string | null;
  staffOnlineNow: number;
  staffTotal: number;
  staffError?: string | null;
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

// ── Panels & devices — folded in from the old separate "Panel status" page (2026-07-23):
// per-restaurant panel CONNECTIVITY (last-seen → online/idle/quiet/never), from
// /api/admin/panels-health. Two health screens were one job; this is now a section here.
type Panel = { role: string; on: boolean; lastSeen: string | null; status: "off" | "never" | "online" | "idle" | "offline" };
type PRow = { id: string; name: string; slug: string; active: boolean; panels: Panel[] };
type PData = { rows: PRow[]; roles: string[]; attention: number; generatedAt: string };

const ROLE_LABEL: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", tablet: "Tablet", owner: "Owner" };
const PSTATUS = {
  online: { c: "var(--adm-ok)", t: "Online" },
  idle: { c: "#d4a574", t: "Idle" },
  offline: { c: "var(--adm-danger)", t: "Quiet" },
  never: { c: "var(--adm-danger)", t: "Never seen" },
  off: { c: "var(--muted)", t: "Off" },
} as const;

function PanelCell({ p }: { p: Panel }) {
  // The OWNER panel is left OUT of the attention count (owners don't sit logged in), so a
  // red "never/quiet" owner cell was a false alarm — render it neutral instead.
  const ownerQuiet = p.role === "owner" && (p.status === "never" || p.status === "offline");
  const s = ownerQuiet ? { c: "var(--muted)", t: p.status === "never" ? "Not signed in" : "Quiet" } : PSTATUS[p.status];
  const hollow = p.status === "never" && !ownerQuiet;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }} title={p.on ? (p.lastSeen ? `Last active ${timeAgo(p.lastSeen)}` : "Never seen active") : "Panel disabled for this restaurant"}>
      <span style={{ width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", border: hollow ? `1px solid ${s.c}` : undefined, backgroundColor: hollow ? "transparent" : s.c }} aria-hidden="true" />
      <span style={{ fontSize: 12.5, color: p.status === "off" || ownerQuiet ? "var(--muted)" : "var(--text)" }}>
        {s.t}{p.on && p.lastSeen && (p.status === "idle" || p.status === "offline") ? ` · ${timeAgo(p.lastSeen)}` : ""}
      </span>
    </span>
  );
}

export default function AdminHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [pd, setPd] = useState<PData | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setPErr(null);
    // Both health checks in parallel; they're independent, so a panels failure never blocks
    // the diagnostics above and vice-versa.
    const [healthRes, panelsRes] = await Promise.allSettled([
      fetch("/api/admin/health", { cache: "no-store" }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
      fetch("/api/admin/panels-health", { cache: "no-store" }).then((r) => r.json().then((j) => ({ ok: r.ok, j }))),
    ]);
    if (healthRes.status === "fulfilled" && healthRes.value.ok) setH(healthRes.value.j);
    else setErr(healthRes.status === "fulfilled" ? (healthRes.value.j?.error || "Couldn't load health.") : "Couldn't load health.");
    if (panelsRes.status === "fulfilled" && panelsRes.value.ok) setPd(panelsRes.value.j);
    else setPErr(panelsRes.status === "fulfilled" ? (panelsRes.value.j?.error || "Couldn't load panel status.") : "Couldn't load panel status.");
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const tier = h ? latencyTier(h.latencyMs) : "warn";

  return (
    <>
      <h1 className="adm-page-h">System health</h1>
      <p className="adm-page-sub">Read-only platform diagnostics + per-restaurant panel status. {h ? <>Last checked {timeAgo(h.checkedAt)}.</> : null}</p>

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
            <span className={`adx-pill ${h.restaurantsError ? "warn" : "good"}`}><span className="dot" />{h.restaurantsError ? "restaurants unreadable" : `${h.restaurants.active} restaurant${h.restaurants.active !== 1 ? "s" : ""} live`}</span>
            {h.restaurants.suspended > 0 && <span className="adx-pill warn"><span className="dot" />{h.restaurants.suspended} suspended</span>}
            {/* 0 staff online is normal (e.g. overnight) — it's NOT a health warning; only a
                failed READ is. Green when someone's on, neutral when nobody is (audit 2026-07-23). */}
            <span className={`adx-pill ${h.staffError ? "warn" : h.staffOnlineNow > 0 ? "good" : ""}`}><span className="dot" />{h.staffError ? "staff status unreadable" : `${h.staffOnlineNow} staff online now`}</span>
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

      {/* Panels & devices (was the separate "Panel status" page) — per-restaurant connectivity. */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "18px 0 11px" }}>
        <i className="fas fa-signal" aria-hidden="true" style={{ color: "var(--muted)" }} />
        <h2 style={{ margin: 0, fontSize: 16 }}>Panels &amp; devices</h2>
        <span className="adm-muted" style={{ fontSize: 12 }}>which staff screens are connected, per restaurant</span>
      </div>
      {pErr && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{pErr} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}
      {pd && (
        <div className="adm-card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, borderColor: pd.attention > 0 ? "#d4a574" : undefined }}>
          <i className={`fas ${pd.attention > 0 ? "fa-triangle-exclamation" : "fa-circle-check"}`} style={{ color: pd.attention > 0 ? "#d4a574" : "var(--adm-ok)" }} aria-hidden="true" />
          <span style={{ fontSize: 13 }}>{pd.attention > 0 ? <><b>{pd.attention}</b> enabled panel{pd.attention === 1 ? "" : "s"} quiet or never seen — a device or login may be down.</> : "All enabled panels have been active recently."}</span>
        </div>
      )}
      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!pd ? (pErr ? <div className="adm-empty">Couldn&apos;t load.</div> : <SkelList rows={4} label="Loading" />) : pd.rows.length === 0 ? (
          <div className="adm-empty">No restaurants yet.</div>
        ) : (
          // Horizontal scroll on narrow screens (the 5-col grid is ~560px min).
          <div className="adm-logwrap" style={{ border: 0, overflowX: "auto" }}>
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))", minWidth: 560 }}>
              <span>Restaurant</span>
              {pd.roles.map((r) => <span key={r}>{ROLE_LABEL[r] || r}</span>)}
            </div>
            {pd.rows.map((row) => (
              <div key={row.id} className="adm-logrow" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))", minWidth: 560, alignItems: "center" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{row.name}</span>
                  {!row.active && <span style={{ fontSize: 11, color: "var(--muted)" }}>suspended</span>}
                </span>
                {row.panels.map((p) => <PanelCell key={p.role} p={p} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
