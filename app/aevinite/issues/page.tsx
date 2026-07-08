"use client";
// Admin · Complaints & issues — the FULL "view all & resolve" screen. This lives
// UNDER /aevinite, so the admin layout's cookie gate is the only thing guarding it:
// the admin reaches it with NO owner login (the old link pointed at /owner/issues,
// whose guard bounced the admin to /login unless an act-as cookie was set — that was
// the "view & resolve sends me to a login" bug). Admin scope = every restaurant.
// Resolve/reopen hits the existing PATCH on /api/owner/issues (admin is in scope).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveAutoRefresh } from "@/components/admin/shared";
import Dropdown from "@/components/admin/Dropdown";
import TicketCard, { type TicketLike } from "@/components/admin/TicketCard";

type Issue = TicketLike & { restaurantName: string; status: string };

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export default function AdminIssues() {
  const router = useRouter();
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
          {shown.map((i) => (
            <TicketCard key={i.id} issue={i} showRestaurant busy={busy === i.id}
              onOpenRestaurant={(slug) => { router.push(`/aevinite/restaurants?focus=${encodeURIComponent(slug)}`); window.dispatchEvent(new CustomEvent("adm:focus-restaurant", { detail: slug })); }}
              onSetStatus={(id, status) => setStatus(id, status)} />
          ))}
        </div>
      )}
    </>
  );
}
