"use client";
// /aevinite/open-tables — the detail behind the dashboard's "Open tables now" card
// (owner 2026-07-08). Shows WHICH restaurant has WHICH tables open right now, grouped,
// so you can see the whole platform's occupancy at a glance. Click any table (or the
// restaurant name) to jump straight into that restaurant's manager panel — no password.
// Reuses the SAME optimized snapshot the Live floor uses (/api/admin/floor?all=1 → one
// call, migration 145), filtered to occupied tables only. Loads once on open and only
// updates on Refresh (no auto-poll — shown as a hint, owner's egress rule).
import { useCallback, useEffect, useRef, useState } from "react";
import { openRestaurantPanel } from "@/components/admin/shared";

type MiniTable = { n: string; s: string; p: string; c: boolean };
type RestFloor = {
  id: string; name: string; slug: string; active: boolean; tables: MiniTable[];
  ordersToday: number; activeOrders: number; unpaidOrders: number;
  paidToday: number; cancelledToday: number; error: string | null;
};

// Same palette as the manager/tablet/floor legends so a colour means ONE thing everywhere.
const STATE_COLOR: Record<string, string> = {
  seated: "#2dd4bf", new: "#f59e0b", preparing: "#4f9dff", served: "#22c55e", cleared: "#6b6253",
};
const STATE_LABEL: Record<string, string> = {
  seated: "Seated", new: "New order", preparing: "Preparing", served: "Served", cleared: "Cleared",
};
const isOpen = (t: MiniTable) => t.s !== "free";

const field: React.CSSProperties = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14 };

function agoLabel(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return s < 15 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
}

export default function AdminOpenTables() {
  const [rests, setRests] = useState<RestFloor[] | null>(null);
  const [err, setErr] = useState("");
  const [fetching, setFetching] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const seq = useRef(0); // latest-wins guard

  const load = useCallback(() => {
    const my = ++seq.current;
    setFetching(true);
    fetch("/api/admin/floor?all=1", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (my !== seq.current) return;
      setFetching(false);
      // floor?all=1 returns tilesError (not top-level error) when the tiles RPC fails — honour it,
      // else a failed load shows the empty "no tables open" state as a quiet floor (audit 2026-07-09).
      if (j.error || j.tilesError) { setErr(j.error || j.tilesError); return; }
      setErr("");
      setRests(j.restaurants as RestFloor[]);
      setUpdatedAt(Date.now());
    }).catch((e) => {
      if (my !== seq.current) return;
      setFetching(false);
      setErr(e instanceof Error ? e.message : String(e));
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 15000); return () => clearInterval(id); }, []);

  const q = search.trim().toLowerCase();
  // Only restaurants that HAVE at least one open table, newest-busiest first.
  const withOpen = (rests || [])
    .map((r) => ({ r, open: r.tables.filter(isOpen) }))
    .filter(({ r, open }) => open.length > 0 && (!q || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)))
    .sort((a, b) => b.open.length - a.open.length || a.r.name.localeCompare(b.r.name));

  // Count over the SAME filtered set that's displayed, so the header total always matches the
  // tiles on screen (searching used to show e.g. "40 open across 1 restaurant"; audit 2026-07-09).
  const totalOpen = withOpen.reduce((s, { open }) => s + open.length, 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="adm-page-h" style={{ marginBottom: 0 }}>Open tables</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="ot-snap" title="This page does not update on its own — press Refresh for a fresh snapshot">
            <i className="fas fa-hand-pointer" aria-hidden="true" /> Manual — press Refresh
            {updatedAt !== null && !fetching ? <> · updated {agoLabel(updatedAt)}</> : null}
          </span>
          <button className="adm-btn" onClick={load} disabled={fetching}>
            <i className={`fas fa-rotate-right${fetching ? " fa-spin" : ""}`} style={{ marginRight: 7 }} aria-hidden="true" />Refresh
          </button>
        </div>
      </div>
      <p className="adm-page-sub">Every table that&apos;s occupied right now, by restaurant. Click a table to open that restaurant&apos;s manager panel. A red ring is an unpaid bill, a bell is a waiter call.</p>

      <div className="adm-card" style={{ marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ position: "relative", flex: "1 1 200px", maxWidth: 340, minWidth: 180 }}>
          <i className="fas fa-magnifying-glass" aria-hidden="true" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontSize: 13 }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search restaurant…" aria-label="Search restaurants" style={{ ...field, paddingLeft: 34, width: "100%" }} />
        </span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--muted)" }}>
          <b style={{ color: "var(--text)", fontSize: 15 }}>{rests === null ? "…" : totalOpen}</b> open across <b style={{ color: "var(--text)" }}>{withOpen.length}</b> restaurant{withOpen.length === 1 ? "" : "s"}
        </span>
      </div>

      {err ? (
        <div className="adm-card" style={{ borderColor: "var(--adm-danger)", color: "var(--adm-danger)" }}>Couldn&apos;t load: {err} <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>
      ) : rests === null ? (
        <div className="ot-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="adm-card"><div className="adm-skel" style={{ width: 140, height: 15, marginBottom: 12 }} /><div className="adm-skel" style={{ width: "100%", height: 60 }} /></div>
          ))}
        </div>
      ) : withOpen.length === 0 ? (
        <div className="adm-empty">{q ? "No restaurants match your search." : "No tables are open on any restaurant right now."}</div>
      ) : (
        <div className="ot-grid">
          {withOpen.map(({ r, open }) => {
            const unpaid = open.filter((t) => t.p === "red").length;
            const calls = open.filter((t) => t.c).length;
            return (
              <section key={r.id} className="adm-card ot-rest" aria-label={`${r.name} open tables`}>
                <header className="ot-head">
                  <button className="ot-name" onClick={() => openRestaurantPanel(r.id, "/manager")} title={`Open ${r.name}'s manager panel (new tab, no password)`}>
                    {r.name}
                    {!r.active && <span style={{ color: "var(--adm-danger)", fontWeight: 700, fontSize: 11 }}> · suspended</span>}
                  </button>
                  <span className="ot-count">{open.length} open</span>
                </header>
                <div className="ot-badges">
                  {unpaid > 0 && <span className="warn"><i className="fas fa-file-invoice" aria-hidden="true" /> {unpaid} unpaid</span>}
                  {calls > 0 && <span className="warn"><i className="fas fa-bell" aria-hidden="true" /> {calls} calling</span>}
                </div>
                <div className="ot-tiles">
                  {open.map((t) => (
                    <button key={t.n} className="ot-tile"
                      onClick={() => openRestaurantPanel(r.id, "/manager")}
                      style={{
                        background: STATE_COLOR[t.s] || "var(--muted2, rgba(120,120,120,.25))",
                        boxShadow: t.p === "red" ? "inset 0 0 0 2px #f87171" : t.p === "green" ? "inset 0 0 0 2px #34d399" : undefined,
                      }}
                      title={`Table ${t.n} — ${STATE_LABEL[t.s] || t.s}${t.p === "red" ? " · UNPAID" : t.p === "green" ? " · paid" : ""}${t.c ? " · waiter called" : ""} — click to open ${r.name}`}>
                      <span className="tn">{t.n}</span>
                      {t.c ? <span className="bell"><i className="fas fa-bell" aria-hidden="true" /></span> : null}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <style jsx>{`
        .ot-snap { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; color: var(--adm-warn, #d97706); background: color-mix(in srgb, var(--adm-warn, #d97706) 13%, transparent); white-space: nowrap; }
        .ot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; align-items: start; }
        .ot-rest { padding: 14px; }
        .ot-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .ot-name { background: transparent; border: 0; padding: 0; font-size: 14.5px; font-weight: 800; color: var(--text); cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ot-name:hover { color: var(--accent); text-decoration: underline; }
        .ot-count { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
        .ot-badges { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; font-size: 11.5px; min-height: 0; }
        .ot-badges .warn { color: var(--adm-warn, #d97706); font-weight: 600; }
        .ot-tiles { display: flex; flex-wrap: wrap; gap: 6px; }
        .ot-tile { position: relative; width: 40px; height: 40px; border-radius: 8px; border: 0; color: #fff; font-weight: 800; font-size: 13px; cursor: pointer; display: grid; place-items: center; transition: transform .12s ease; }
        .ot-tile:hover { transform: scale(1.08); }
        .ot-tile .tn { text-shadow: 0 1px 2px rgba(0,0,0,.3); }
        .ot-tile .bell { position: absolute; top: -4px; right: -4px; width: 16px; height: 16px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 8px; display: grid; place-items: center; }
      `}</style>
    </>
  );
}
