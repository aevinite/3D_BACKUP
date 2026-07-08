"use client";
// Admin · Panel status — per-restaurant panel CONNECTIVITY. For each restaurant's enabled
// panels (Manager/Kitchen/Tablet/Owner), shows when it was last active — a proxy for "is
// that screen connected & in use". Spot an enabled panel that's gone quiet (device down /
// nobody logged in). From /api/admin/panels-health (last-seen + enabled-panels, no new table).
import { useCallback, useEffect, useState } from "react";
import { useActiveAutoRefresh, timeAgo } from "@/components/admin/shared";

type Panel = { role: string; on: boolean; lastSeen: string | null; status: "off" | "never" | "online" | "idle" | "offline" };
type Row = { id: string; name: string; slug: string; active: boolean; panels: Panel[] };
type Data = { rows: Row[]; roles: string[]; attention: number; generatedAt: string };

const ROLE_LABEL: Record<string, string> = { manager: "Manager", kitchen: "Kitchen", tablet: "Tablet", owner: "Owner" };
const STATUS = {
  online: { c: "var(--adm-ok)", t: "Online" },
  idle: { c: "#d4a574", t: "Idle" },
  offline: { c: "var(--adm-danger)", t: "Quiet" },
  never: { c: "var(--adm-danger)", t: "Never seen" },
  off: { c: "var(--muted)", t: "Off" },
} as const;

function Cell({ p }: { p: Panel }) {
  const s = STATUS[p.status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }} title={p.on ? (p.lastSeen ? `Last active ${timeAgo(p.lastSeen)}` : "Never seen active") : "Panel disabled for this restaurant"}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: s.c, flex: "0 0 auto", border: p.status === "never" ? `1px solid ${s.c}` : undefined, backgroundColor: p.status === "never" ? "transparent" : s.c }} aria-hidden="true" />
      <span style={{ fontSize: 12.5, color: p.status === "off" ? "var(--muted)" : "var(--text)" }}>
        {s.t}{p.on && p.lastSeen && (p.status === "idle" || p.status === "offline") ? ` · ${timeAgo(p.lastSeen)}` : ""}
      </span>
    </span>
  );
}

export default function AdminPanelsHealth() {
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/panels-health", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't load.");
      setD(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Panel &amp; device status</h1>
          <p className="adm-page-sub" style={{ marginTop: 4 }}>Which panels are connected per restaurant — spot a screen that&apos;s gone quiet. Based on last staff activity (printer/hardware monitoring is a later add).</p>
        </div>
        <button className="adm-btn" disabled={loading} onClick={load}>
          <i className={`fas fa-rotate-right${loading ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
        </button>
      </div>

      {err && <p style={{ color: "var(--adm-danger)", fontSize: 13 }}>{err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></p>}

      {d && (
        <div className="adm-card" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, borderColor: d.attention > 0 ? "#d4a574" : undefined }}>
          <i className={`fas ${d.attention > 0 ? "fa-triangle-exclamation" : "fa-circle-check"}`} style={{ color: d.attention > 0 ? "#d4a574" : "var(--adm-ok)" }} aria-hidden="true" />
          <span style={{ fontSize: 13 }}>{d.attention > 0 ? <><b>{d.attention}</b> enabled panel{d.attention === 1 ? "" : "s"} quiet or never seen — a device or login may be down.</> : "All enabled panels have been active recently."}</span>
        </div>
      )}

      <div className="adm-card" style={{ padding: 0, overflow: "hidden" }}>
        {!d ? <div className="adm-empty">{err ? "Couldn't load." : "Loading…"}</div> : d.rows.length === 0 ? (
          <div className="adm-empty">No restaurants yet.</div>
        ) : (
          <div className="adm-logwrap" style={{ border: 0 }}>
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))" }}>
              <span>Restaurant</span>
              {d.roles.map((r) => <span key={r}>{ROLE_LABEL[r] || r}</span>)}
            </div>
            {d.rows.map((row) => (
              <div key={row.id} className="adm-logrow" style={{ gridTemplateColumns: "1.4fr repeat(4, minmax(120px, 1fr))", alignItems: "center" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{row.name}</span>
                  {!row.active && <span style={{ fontSize: 11, color: "var(--muted)" }}>suspended</span>}
                </span>
                {row.panels.map((p) => <Cell key={p.role} p={p} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
