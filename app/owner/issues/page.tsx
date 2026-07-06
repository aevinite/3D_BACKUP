"use client";
// Owner · Issues — staff-raised issues / complaints across the owner's restaurants
// (the admin super-user sees every restaurant's). Open ones first; resolve/reopen
// inline. Reads /api/owner/issues (scoped server-side by ownerScope).
import { useCallback, useEffect, useState } from "react";

type Issue = {
  id: string; restaurant_id: string; restaurantName: string;
  subject: string; body: string | null; raised_by: string | null; raised_role: string | null;
  status: string; created_at: string; resolved_at: string | null;
};

export default function OwnerIssues() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busy, setBusy] = useState<string | null>(null);
  // Admin-in-one-restaurant scope pin (bug C1) — mirrors app/owner/page.tsx & reports.
  // Rides on EVERY call as ?scope= so a second tab's shared act-as cookie can't hijack
  // this tab's restaurant (before, Issues ignored the pin and followed the cookie —
  // an admin juggling two restaurant tabs saw/resolved the wrong one). Null for a real
  // owner (no ?rid in their URL), so nothing changes for them.
  const [scopePin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const scp = scopePin ? `?scope=${scopePin}` : "";

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/owner/issues${scp}`, { cache: "no-store" })).json();
      if (!j.error) setIssues(j.issues || []);
    } catch {}
  }, [scp]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: "open" | "resolved") => {
    setBusy(id);
    // Optimistic update so the chip flips instantly.
    setIssues((cur) => (cur || []).map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      await fetch(`/api/owner/issues${scp}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
      await load();
    } finally { setBusy(null); }
  };

  const openCount = (issues || []).filter((i) => i.status === "open").length;
  const rows = (issues || []).filter((i) => filter === "all" || i.status === "open");

  return (
    <>
      <h1 className="adm-page-h">Issues &amp; complaints</h1>
      <p className="adm-page-sub">Problems your staff have flagged across your restaurants. Resolve each one once it&apos;s handled.</p>

      <div className="adm-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <div className="own-range">
            <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>Open · {openCount}</button>
            <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
          </div>
          <button className="adm-btn" style={{ marginLeft: "auto" }} onClick={load}><i className="fas fa-rotate" aria-hidden="true" /> Refresh</button>
        </div>

        {issues === null ? (
          <div className="adm-empty">Loading issues…</div>
        ) : rows.length === 0 ? (
          <div className="adm-empty">{filter === "open" ? "No open issues — all clear. 🎉" : "No issues raised yet."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((i) => {
              const open = i.status === "open";
              const col = open ? "var(--adm-danger, #e5484d)" : "var(--adm-ok, #16a34a)";
              return (
                <div key={i.id} className="adm-card" style={{ margin: 0, borderLeft: `4px solid ${col}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14.5 }}>{i.subject}</b>
                    <span className="adm-chip">{i.restaurantName}</span>
                    <span className="adm-chip" style={{ background: `color-mix(in srgb, ${col} 16%, transparent)`, color: col }}>{i.status}</span>
                    <span style={{ marginLeft: "auto" }}>
                      {open
                        ? <button className="adm-btn" disabled={busy === i.id} onClick={() => setStatus(i.id, "resolved")}><i className="fas fa-check" aria-hidden="true" /> Resolve</button>
                        : <button className="adm-btn" disabled={busy === i.id} onClick={() => setStatus(i.id, "open")}><i className="fas fa-rotate-left" aria-hidden="true" /> Reopen</button>}
                    </span>
                  </div>
                  {i.body && <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>{i.body}</p>}
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                    Raised by <b>{i.raised_by || "—"}</b> ({i.raised_role || "staff"}) · {new Date(i.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {i.resolved_at ? ` · resolved ${new Date(i.resolved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
