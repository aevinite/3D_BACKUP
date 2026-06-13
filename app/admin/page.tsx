// The ADMIN home — first slice of the unified shell.
//
// It shows the LIVE floor by polling /api/admin/floor (~1s), which reads the one
// "brain" (lfh_floor_state). This is the proof that the brain works end-to-end:
// every table's status comes from a single source, so it can never disagree with
// the other screens. Styling here is intentionally minimal for now — the full
// admin dashboard design is piece 3.
"use client";

import { useEffect, useState } from "react";

// The shape of one table tile, as the brain returns it.
type Tile = {
  table_number: string;
  state: "free" | "seated" | "new" | "preparing" | "served" | "cleared";
  open: boolean;
  members: number;
  pending_members: number;
  has_new: boolean;
  has_call: boolean;
  due: number;
  pay: "" | "red" | "green";
};

// Friendly label + colour per state.
const LABEL: Record<Tile["state"], string> = {
  free: "Free",
  seated: "Seated",
  new: "New order",
  preparing: "Preparing",
  served: "Served",
  cleared: "Cleared",
};
// Free tables stay DIM; any open/occupied table lights up bright and warm so the
// floor reads at a glance (owner: "if the table is open it should brighten up,
// kind of yellow" — not just an outline).
const COLOR: Record<Tile["state"], string> = {
  free: "#0e1726",      // dim navy — clearly empty
  seated: "#2563eb",    // bright blue — guests seated
  new: "#ea580c",       // bright orange — new order waiting
  preparing: "#7c3aed", // violet — cooking
  served: "#ca8a04",    // gold/yellow — open & served (brightened)
  cleared: "#15803d",   // green — paid / cleared
};

export default function AdminHome() {
  const [tables, setTables] = useState<Tile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Visiting /admin marks this browser as "admin" so the floating switcher
  // appears across the panels. (A real password login replaces this in piece 5.)
  useEffect(() => {
    try {
      localStorage.setItem("lfh_admin", "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/admin/floor", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j.error) setErr(j.error);
        else {
          setErr(null);
          setTables(j.tables as Tile[]);
        }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoadedOnce(true);
      }
    };
    load();
    const id = setInterval(load, 1000); // ~1s live poll
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const open = tables.filter((t) => t.open).length;
  const due = tables.reduce((s, t) => s + (Number(t.due) || 0), 0);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b1220",
        color: "#dbe7ff",
        fontFamily: "system-ui, sans-serif",
        padding: "24px",
      }}
    >
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>🛠️ Admin · Live floor</h1>
        <span style={{ opacity: 0.7, fontSize: 14 }}>
          {open} open · €{due.toFixed(2)} due · updates every second
        </span>
      </header>

      {err && (
        <p style={{ color: "#f87171", marginTop: 12 }}>
          Couldn&apos;t load the floor: {err}
        </p>
      )}

      {!loadedOnce ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>Loading the live floor…</p>
      ) : (
        <div
          style={{
            marginTop: 20,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          }}
        >
          {tables.map((t) => (
            <div
              key={t.table_number}
              style={{
                background: COLOR[t.state],
                border: t.pay === "red" ? "2px solid #f87171" : t.pay === "green" ? "2px solid #34d399" : "2px solid transparent",
                borderRadius: 14,
                padding: "14px 16px",
                // Occupied tiles glow so the floor reads at a glance; free stays flat.
                boxShadow: t.state === "free" ? "none" : "0 4px 18px rgba(0,0,0,.35)",
                opacity: t.state === "free" ? 0.75 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 18 }}>Table {t.table_number}</strong>
                <span style={{ fontSize: 16 }}>
                  {t.has_call ? "🔔" : ""}
                  {t.has_new ? "🆕" : ""}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600 }}>{LABEL[t.state]}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                {t.open ? `${t.members} seated` : "—"}
                {Number(t.due) > 0 ? ` · €${Number(t.due).toFixed(2)} due` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
