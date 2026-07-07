"use client";
// Admin · Complaints & issues — the FULL "view all & resolve" screen. This lives
// UNDER /aevinite, so the admin layout's cookie gate is the only thing guarding it:
// the admin reaches it with NO owner login (the old link pointed at /owner/issues,
// whose guard bounced the admin to /login unless an act-as cookie was set — that was
// the "view & resolve sends me to a login" bug). Admin scope = every restaurant.
// Resolve/reopen hits the existing PATCH on /api/owner/issues (admin is in scope).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveAutoRefresh } from "@/components/admin/shared";
import Dropdown from "@/components/admin/Dropdown";

type Issue = {
  id: string; restaurant_id: string; restaurantName: string; subject: string;
  body?: string | null; status: string; raised_by?: string | null; raised_role?: string | null;
  created_at: string; resolved_at?: string | null; resolved_by?: string | null;
};

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export default function AdminIssues() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [filter, setFilter] = useState("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Track a failed load so we never show the "No open issues 🎉" all-clear when the
  // fetch actually errored (bug #8, 2026-07-06 — real complaints were being hidden).
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    // ?scope=all — force the platform-wide view. Without it, ownerScope() honours the
    // 6-hour act-as cookie set when the admin peeks into a restaurant, silently collapsing
    // this list to just that one restaurant while the header still claims "every restaurant"
    // (real complaints vanished for up to 6h). Same fix the dashboard already uses.
    fetch("/api/owner/issues?scope=all", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(true); else { setIssues(j.issues || []); setErr(false); } })
      .catch(() => setErr(true))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  useActiveAutoRefresh(load, 60000);

  const setStatus = async (id: string, status: "resolved" | "open") => {
    setBusy(id);
    // Optimistic: flip locally so the click feels instant, then confirm with the server.
    setIssues((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      const r = await fetch("/api/owner/issues?scope=all", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!r.ok) load(); // revert to server truth on failure
    } catch { load(); }
    finally { setBusy(null); }
  };

  const shown = useMemo(() => {
    const list = filter === "all" ? issues : issues.filter((i) => i.status === filter);
    // open first, newest first
    return [...list].sort((a, b) =>
      a.status === b.status ? +new Date(b.created_at) - +new Date(a.created_at) : a.status === "open" ? -1 : 1);
  }, [issues, filter]);

  const openCount = issues.filter((i) => i.status === "open").length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Complaints &amp; issues</h1>
        <Dropdown value={filter} onChange={setFilter} options={FILTERS} ariaLabel="Filter issues" minWidth={132} />
      </div>
      <p className="adm-page-sub">Everything staff and owners have raised, across every restaurant · {openCount} open.</p>

      {!loaded ? (
        <div className="adm-empty">Loading issues…</div>
      ) : err ? (
        <div className="adm-empty">Couldn&rsquo;t load issues. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>
      ) : shown.length === 0 ? (
        <div className="adm-empty">{filter === "open" ? "No open issues right now. 🎉" : "Nothing here."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((i) => {
            const resolved = i.status === "resolved";
            return (
              <div key={i.id} className="adm-card" style={{ display: "flex", alignItems: "flex-start", gap: 12, opacity: resolved ? 0.72 : 1 }}>
                <i className={`fas ${resolved ? "fa-circle-check" : "fa-triangle-exclamation"}`}
                  style={{ color: resolved ? "var(--adm-ok, #2e9e6b)" : "var(--adm-danger, #e5484d)", fontSize: 17, marginTop: 2 }} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 14.5 }}>{i.subject}</div>
                  {i.body && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 3, whiteSpace: "pre-wrap" }}>{i.body}</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 7, fontSize: 11.5, color: "var(--muted)", alignItems: "center" }}>
                    <span style={{ color: "var(--accent)", fontWeight: 700 }}><i className="fas fa-store" style={{ marginRight: 4, opacity: 0.8 }} aria-hidden="true" />{i.restaurantName}</span>
                    <span>· {i.raised_by || i.raised_role || "—"}</span>
                    <span>· {new Date(i.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    {resolved && i.resolved_by && <span>· resolved by {i.resolved_by}</span>}
                  </div>
                </div>
                <button className={`adm-btn ${resolved ? "" : "ok"}`} disabled={busy === i.id}
                  style={{ flexShrink: 0, padding: "8px 13px", fontSize: 12.5 }}
                  onClick={() => setStatus(i.id, resolved ? "open" : "resolved")}>
                  {busy === i.id ? "…" : resolved ? "Reopen" : "Resolve"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
