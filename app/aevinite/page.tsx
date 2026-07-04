"use client";
// Admin · Command — the restaurant-centric home of the ops console (redesign
// 2026-07-04). Purpose: reach ANY restaurant and its panels in one click.
//   1. Compact stat strip (counts only — NO revenue anywhere in the admin panel).
//   2. The restaurant command table: one dense row per restaurant with panel
//      chips (M K T O), live open-table count, quick-open buttons (act-as +
//      new tab) and a Manage → link.
//   3. Working now (active staff) + Latest activity.
// Data: the SAME existing admin endpoints as before (one fetch each, no per-row
// fetches), refreshed by useActiveAutoRefresh (60s, only while visible & in use).
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openRestaurantPanel, useActiveAutoRefresh, ActivityFeed, timeAgo, type Action } from "@/components/admin/shared";

type Rest = {
  id: string; slug: string; name: string; active: boolean;
  ownerUserId: string | null; ownerName: string | null;
  panels: Record<string, boolean> | null;
};
type OvRow = { id: string; openTables: number };
type Issue = { id: string; restaurantName: string; subject: string; status: string; created_at: string };
type Staff = { name: string | null; username: string; role: string; restaurantName: string | null; last_seen_at: string | null };

// The four operational panels, in chip order. A panel is ON unless explicitly false.
const PANEL_DEFS: { key: string; letter: string; label: string; path: string }[] = [
  { key: "manager", letter: "M", label: "Manager", path: "/editor" },
  { key: "kitchen", letter: "K", label: "Kitchen", path: "/kitchen" },
  { key: "tablet", letter: "T", label: "Tablet", path: "/tablet" },
  { key: "owner", letter: "O", label: "Owner", path: "/owner" },
];
const panelOn = (r: Rest, key: string) => !r.panels || r.panels[key] !== false;

export default function AdminCommand() {
  const [rests, setRests] = useState<Rest[] | null>(null);
  const [ovRows, setOvRows] = useState<OvRow[]>([]);
  const [ordersToday, setOrdersToday] = useState<number | null>(null);
  const [openTablesNow, setOpenTablesNow] = useState<number | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [activity, setActivity] = useState<Action[]>([]);
  const [q, setQ] = useState("");
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/restaurants", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setRests(j.restaurants || []); }).catch(() => {});
    fetch("/api/admin/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!j.error) { setMaintenance(!!j.maintenance); setOrdersToday(Number(j.ordersToday) || 0); setOpenTablesNow(Number(j.openTables) || 0); }
    }).catch(() => {});
    // Per-restaurant live open-table counts (one pre-aggregated RPC round-trip —
    // for the admin cookie it returns every restaurant). We read ONLY openTables.
    fetch("/api/owner/overview", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!j.error) setOvRows((j.restaurants || []).map((r: { id: string; openTables: number }) => ({ id: r.id, openTables: Number(r.openTables) || 0 })));
    }).catch(() => {});
    fetch("/api/owner/issues", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setIssues(j.issues || []); }).catch(() => {});
    fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setStaff(j.users || []); }).catch(() => {});
    fetch("/api/admin/oplog?limit=18", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (!j.error) setActivity(j.actions || []); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);
  const [refreshing, setRefreshing] = useState(false);
  const manualRefresh = () => { setRefreshing(true); load(); setTimeout(() => setRefreshing(false), 600); };

  const ovById = useMemo(() => new Map(ovRows.map((r) => [r.id, r.openTables])), [ovRows]);
  const openIssues = useMemo(() => issues.filter((i) => i.status === "open"), [issues]);
  const online = useMemo(() => staff.filter((u) => u.last_seen_at && Date.now() - new Date(u.last_seen_at).getTime() < 180_000), [staff]);
  const PANEL_NAME = (role: string) => (({ owner: "Owner", manager: "Manager", kitchen: "Kitchen", tablet: "Tablet" } as Record<string, string>)[role] || role);

  const needle = q.trim().toLowerCase();
  const rows = (rests || []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle));
  const activeCount = (rests || []).filter((r) => r.active).length;

  const openPanel = async (r: Rest, path: string) => {
    setBusyRow(r.id); setErr(null);
    try { await openRestaurantPanel(r.id, path); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusyRow(null); }
  };

  const STATS: [string, string | number][] = [
    ["Restaurants", rests === null ? "…" : `${activeCount} active / ${rests.length}`],
    ["Open issues", openIssues.length],
    ["Open tables now", openTablesNow ?? "…"],
    ["Staff online now", online.length],
    ["Orders today", ordersToday ?? "…"],
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Dashboard</h1>
        <button className="adm-btn" onClick={manualRefresh} disabled={refreshing} title="Refresh now (auto-updates are throttled to save load)">
          <i className={`fas fa-rotate-right${refreshing ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>
      <p className="adm-page-sub">Every restaurant on the platform — open any panel, no password.</p>

      {maintenance && (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-danger)", fontSize: 15 }} aria-hidden="true" />
          <div style={{ flex: 1, fontSize: 13 }}><b>A guest menu is in maintenance.</b></div>
          <Link href="/aevinite/settings" className="adm-btn">Settings</Link>
        </div>
      )}

      {/* 1 · Compact stat strip — text rows, counts only. */}
      <div className="cmd-strip adm-card" role="list">
        {STATS.map(([k, v]) => (
          <div key={k} className="cell" role="listitem">
            <span className="k">{k}</span>
            <span className={`v${k === "Open issues" && Number(v) > 0 ? " warn" : ""}`}>{v}</span>
          </div>
        ))}
      </div>

      {/* 2 · Restaurant command table — the heart of the page. */}
      <div className="adm-card" style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
        <div className="cmd-tools">
          <i className="fas fa-magnifying-glass" style={{ color: "var(--muted)", fontSize: 12 }} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search restaurants by name or slug…" aria-label="Search restaurants" />
          <span style={{ color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>{rows.length} of {rests?.length ?? 0}</span>
        </div>
        {err && <div style={{ padding: "8px 14px", color: "var(--adm-danger)", fontSize: 12.5, borderBottom: "var(--border)" }}>{err}</div>}
        <div className="cmd-row head">
          <span>Restaurant</span><span>Status</span><span>Panels</span><span className="num">Open</span><span>Quick open</span><span />
        </div>
        {rests === null ? (
          <div className="adm-empty">Loading restaurants…</div>
        ) : rows.length === 0 ? (
          <div className="adm-empty">No restaurants match &ldquo;{q}&rdquo;.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="cmd-row">
              <span style={{ minWidth: 0 }}>
                <span className="nm">{r.name}</span>
                <span className="sl">{r.slug}</span>
              </span>
              <span>
                <span className={`cmd-pill ${r.active ? "on" : "off"}`}>{r.active ? "Active" : "Suspended"}</span>
              </span>
              <span className="cmd-chips" title={PANEL_DEFS.map((p) => `${p.label}: ${panelOn(r, p.key) ? "on" : "off"}`).join(" · ")}>
                {PANEL_DEFS.map((p) => (
                  <span key={p.key} className={`pchip${panelOn(r, p.key) ? " on" : ""}`} aria-label={`${p.label} panel ${panelOn(r, p.key) ? "enabled" : "off"}`}>{p.letter}</span>
                ))}
              </span>
              <span className="num">{ovById.has(r.id) ? ovById.get(r.id) : "—"}</span>
              <span className="cmd-open">
                <a className="obtn" href={`/r/${r.slug}/menu`} target="_blank" rel="noopener" title={`Open ${r.name}'s guest menu`}>Guest</a>
                {PANEL_DEFS.map((p) => (
                  <button key={p.key} className="obtn" disabled={!panelOn(r, p.key) || busyRow === r.id}
                    onClick={() => openPanel(r, p.path)}
                    title={panelOn(r, p.key) ? `Open ${p.label} as ${r.name} (new tab, no password)` : `${p.label} panel is off for this restaurant`}>
                    {p.label}
                  </button>
                ))}
              </span>
              <span style={{ textAlign: "right" }}>
                <Link className="cmd-manage" href={`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`} title={`Manage ${r.name}`}>
                  Manage <i className="fas fa-arrow-right" style={{ fontSize: 10 }} aria-hidden="true" />
                </Link>
              </span>
            </div>
          ))
        )}
      </div>

      {/* 3 · Working now + latest activity. */}
      <div className="cmd-grid2">
        <div className="adm-card">
          <div className="cmd-sec">Working now <span>· {online.length} active</span></div>
          {online.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "6px 0" }}>No staff active right now.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {online.map((u, i) => (
                <div key={i} className="cmd-staff">
                  <span className="dot" aria-hidden="true" />
                  <b>{u.name || u.username}</b>
                  <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12 }}>{PANEL_NAME(u.role)}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.restaurantName || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="adm-card">
          <div className="cmd-sec">
            Latest activity <span>· all restaurants</span>
            <Link href="/aevinite/logs" style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>View all →</Link>
          </div>
          <ActivityFeed rows={activity} />
        </div>
      </div>

      {/* Open issues — quiet row under the grid; loud only when something IS open. */}
      <div className="adm-card" style={{ marginTop: 12 }}>
        <div className="cmd-sec">
          Open issues <span>· {openIssues.length} open</span>
          <Link href="/aevinite/issues" style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>Manage →</Link>
        </div>
        {openIssues.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "4px 0" }}>Nothing open right now.</div>
        ) : (
          openIssues.slice(0, 5).map((i) => (
            <div key={i.id} className="cmd-issue">
              <i className="fas fa-triangle-exclamation" style={{ color: "var(--adm-warn)", fontSize: 12 }} aria-hidden="true" />
              <b style={{ fontSize: 13 }}>{i.subject}</b>
              <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{i.restaurantName}</span>
              <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12, whiteSpace: "nowrap" }}>{timeAgo(i.created_at)}</span>
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        /* stat strip: label+value text cells with hairline dividers */
        .cmd-strip { display: flex; flex-wrap: wrap; padding: 0; margin-bottom: 12px; }
        .cmd-strip .cell { display: flex; flex-direction: column; gap: 2px; padding: 10px 16px; border-right: var(--border); flex: 1 1 auto; min-width: 130px; }
        .cmd-strip .cell:last-child { border-right: 0; }
        .cmd-strip .k { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 600; }
        .cmd-strip .v { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .cmd-strip .v.warn { color: var(--adm-warn); }
        /* command table */
        .cmd-tools { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: var(--border); }
        .cmd-tools input { flex: 1; min-width: 0; background: transparent; border: 0; outline: none; color: var(--text); font-size: 13px; padding: 2px 0; }
        .cmd-row { display: grid; grid-template-columns: minmax(140px, 1.1fr) 84px 96px 46px minmax(340px, 1.9fr) 78px; gap: 8px; align-items: center; padding: 0 14px; min-height: 40px; border-bottom: var(--border); font-size: 13px; }
        .cmd-row:last-child { border-bottom: 0; }
        .cmd-row.head { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; min-height: 32px; background: var(--muted2); }
        .cmd-row .nm { display: block; font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cmd-row .sl { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cmd-row .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
        .cmd-pill { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }
        .cmd-pill.on { background: color-mix(in srgb, var(--adm-ok) 16%, transparent); color: var(--adm-ok); }
        .cmd-pill.off { background: color-mix(in srgb, var(--adm-danger) 14%, transparent); color: var(--adm-danger); }
        /* M K T O chips: filled = enabled, hollow = off */
        .cmd-chips { display: inline-flex; gap: 4px; }
        .pchip { width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center; font-size: 10px; font-weight: 700; border: 1px solid var(--border-c, #1d2430); color: var(--muted); }
        .pchip.on { background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent); }
        /* quick-open buttons */
        .cmd-open { display: inline-flex; gap: 5px; flex-wrap: wrap; padding: 6px 0; }
        .obtn { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: 6px; border: var(--border); background: transparent; color: var(--text); font-size: 11.5px; font-weight: 600; text-decoration: none; cursor: pointer; transition: background .15s ease, border-color .15s ease; white-space: nowrap; }
        .obtn:hover:not(:disabled) { background: var(--muted2); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
        .obtn:disabled { opacity: .32; cursor: default; }
        a.obtn { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
        .cmd-manage { color: var(--accent); font-size: 12.5px; font-weight: 600; text-decoration: none; white-space: nowrap; }
        .cmd-manage:hover { text-decoration: underline; }
        /* two-column bottom grid */
        .cmd-grid2 { display: grid; grid-template-columns: 1fr 1.4fr; gap: 12px; }
        .cmd-sec { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text); margin-bottom: 8px; }
        .cmd-sec span { color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; }
        .cmd-staff { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: var(--border); font-size: 13px; }
        .cmd-staff:last-child { border-bottom: 0; }
        .cmd-staff .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--adm-ok); flex-shrink: 0; }
        .cmd-issue { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: var(--border); }
        .cmd-issue:last-child { border-bottom: 0; }
        @media (max-width: 1100px) {
          .cmd-row { grid-template-columns: minmax(140px, 1.2fr) 84px 100px minmax(280px, 1.6fr) 80px; }
          .cmd-row .num, .cmd-row.head .num { display: none; }
        }
        @media (max-width: 900px) { .cmd-grid2 { grid-template-columns: 1fr; } }
        @media (max-width: 760px) {
          .cmd-row { grid-template-columns: 1fr; gap: 4px; padding: 10px 14px; }
          .cmd-row.head { display: none; }
          .cmd-row > span { text-align: left !important; }
          .cmd-row .num { display: none; }
        }
      `}</style>
    </>
  );
}
