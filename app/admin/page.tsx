// The ADMIN home — the owner's control room (behind the admin login gate).
//
// It is deliberately MORE than the editor: alongside the live floor it holds the
// powerful, owner-only controls — the maintenance switch (takes the guest menu
// offline) and the per-restaurant FEATURE TOGGLES (moved here from the editor;
// the editor no longer has them). Everything reads/writes via /api/admin/* which
// is locked to the admin. Deep menu/order editing still lives in the Editor.
"use client";

import { useCallback, useEffect, useState } from "react";

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

type Overview = {
  maintenance: boolean;
  sessionsEnabled: boolean;
  tableCount: number;
  features: Record<string, boolean>;
  openTables: number;
  activeOrders: number;
  unpaidOrders: number;
  revenueToday: number;
  ordersToday: number;
};

const LABEL: Record<Tile["state"], string> = {
  free: "Free", seated: "Seated", new: "New order",
  preparing: "Preparing", served: "Served", cleared: "Cleared",
};
// Free tables stay dim; open ones brighten (warm/bright) so the floor reads fast.
const COLOR: Record<Tile["state"], string> = {
  free: "#0e1726", seated: "#2563eb", new: "#ea580c",
  preparing: "#7c3aed", served: "#ca8a04", cleared: "#15803d",
};

// The ten guest-facing feature switches (the four backend-only ones are hidden).
const FEATURES: { key: string; label: string }[] = [
  { key: "model3d", label: "3D dish viewer" },
  { key: "ratings", label: "Star ratings" },
  { key: "reviews", label: "Written reviews" },
  { key: "allergies", label: "Allergy system" },
  { key: "favorites", label: "Favorites" },
  { key: "waiter_calls", label: "Call waiter" },
  { key: "search", label: "Dish search" },
  { key: "languages", label: "Languages" },
  { key: "currency", label: "Currency picker" },
  { key: "scrollspy", label: "Category scroll-spy" },
];

// The guest-menu filter chips, each toggleable on/off (stored as features.chip_<slug>).
const CHIPS = [
  { key: "chip_popular", label: "Popular" },
  { key: "chip_top-rated", label: "Top Rated" },
  { key: "chip_price", label: "Low Price" },
  { key: "chip_veg", label: "Veg" },
  { key: "chip_non-veg", label: "Non-Veg" },
];

// Recent-activity feed helpers (the admin's combined who-did-what view).
const PANEL_COLOR: Record<string, string> = { editor: "#d4a574", kitchen: "#7ec88a", tablet: "#60a5fa", admin: "#e8a13c" };
const ACT_LABEL: Record<string, string> = {
  order_accept: "Accepted order", order_serve: "Served order", order_ready: "Marked ready",
  order_discount: "Applied discount", table_open: "Opened table", table_close: "Closed table",
  table_shift: "Shifted table", transfer_head: "Transferred head", order_place: "Placed order",
  call_attend: "Attended call", member_approve: "Approved guest", sold_out_on: "Marked sold-out", sold_out_off: "Back in stock",
};
const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};
type Action = { id: string; panel: string; action: string; table_number?: string | null; detail?: string | null; created_at: string };

const card = { background: "#111a2e", border: "1px solid #1f2c49", borderRadius: 14, padding: 16 } as const;

// Prices/totals are stored in a USD base; show them in rupees the SAME way the
// menu/editor/tablet do (× INR_RATE) so every screen shows the identical ₹ amount.
const INR_RATE = 84;
const inr = (n: number) => "₹" + Math.round((Number(n) || 0) * INR_RATE).toLocaleString("en-US");

export default function AdminHome() {
  const [tables, setTables] = useState<Tile[]>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<Action[]>([]);

  const loadOverview = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/overview", { cache: "no-store" });
      const j = await r.json();
      if (!j.error) setOv(j as Overview);
    } catch {
      /* ignore a transient poll miss */
    }
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/oplog", { cache: "no-store" });
      const j = await r.json();
      if (!j.error) setActivity(j.actions || []);
    } catch {
      /* ignore a transient poll miss */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loadFloor = async () => {
      try {
        const r = await fetch("/api/admin/floor", { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (j.error) setErr(j.error);
        else { setErr(null); setTables(j.tables as Tile[]); }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    loadFloor();
    loadOverview();
    loadActivity();
    const id = setInterval(() => { loadFloor(); loadOverview(); }, 1000);
    const aid = setInterval(loadActivity, 3000); // activity feed — a touch slower
    return () => { alive = false; clearInterval(id); clearInterval(aid); };
  }, [loadOverview, loadActivity]);

  // Flip the maintenance switch (with an are-you-sure, since it hides the menu).
  const toggleMaintenance = async () => {
    if (!ov) return;
    const turningOn = !ov.maintenance;
    const msg = turningOn
      ? "Put the guest menu into maintenance ('we'll be right back')? Guests can't browse or order until you turn it back on."
      : "Bring the guest menu back online?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await fetch("/api/admin/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: turningOn }) });
      await loadOverview();
    } finally {
      setBusy(false);
    }
  };

  // Flip one feature switch.
  const toggleFeature = async (key: string, current: boolean) => {
    setBusy(true);
    try {
      await fetch("/api/admin/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value: !current }) });
      await loadOverview();
    } finally {
      setBusy(false);
    }
  };

  const featureOn = (key: string) => {
    // default ON for the guest switches unless explicitly stored false
    const v = ov?.features?.[key];
    return v === undefined ? true : v === true;
  };

  return (
    <main style={{ minHeight: "100vh", background: "#0b1220", color: "#dbe7ff", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>🛠️ Admin · Control room</h1>
        {ov?.maintenance ? (
          <span style={{ background: "#7f1d1d", color: "#fecaca", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
            ⚠ Menu in maintenance
          </span>
        ) : null}
      </header>

      {/* Key numbers */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16 }}>
        <Stat label="Open tables" value={ov ? ov.openTables : "…"} />
        <Stat label="Active orders" value={ov ? ov.activeOrders : "…"} />
        <Stat label="Unpaid bills" value={ov ? ov.unpaidOrders : "…"} />
        <Stat label="Revenue today" value={ov ? inr(ov.revenueToday) : "…"} />
        <Stat label="Orders today" value={ov ? ov.ordersToday : "…"} />
      </section>

      {/* Owner controls: maintenance + feature toggles (admin-only powers) */}
      <section style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: 12, marginTop: 16, alignItems: "start" }}>
        <div style={card}>
          <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Maintenance</h2>
          <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7 }}>
            Turn the guest menu off with a “we’ll be right back” screen. Staff panels keep working.
          </p>
          <button
            onClick={toggleMaintenance}
            disabled={!ov || busy}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10, border: 0, cursor: ov && !busy ? "pointer" : "default",
              background: ov?.maintenance ? "#16a34a" : "#dc2626", color: "#fff", fontWeight: 700, fontSize: 14,
            }}
          >
            {ov?.maintenance ? "Bring menu back online" : "Take menu offline"}
          </button>
        </div>

        <div style={card}>
          <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Features</h2>
          <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7 }}>
            Turn guest-facing features on/off for the whole restaurant. (Edited only here — not in the editor.)
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
            {FEATURES.map((f) => {
              const on = featureOn(f.key);
              return (
                <button
                  key={f.key}
                  onClick={() => toggleFeature(f.key, on)}
                  disabled={!ov || busy}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    padding: "9px 12px", borderRadius: 10, border: "1px solid #1f2c49", cursor: ov && !busy ? "pointer" : "default",
                    background: on ? "#13351f" : "#1a2236", color: on ? "#86efac" : "#94a3b8", fontSize: 13, fontWeight: 600, textAlign: "left",
                  }}
                  title={on ? "On — tap to turn off" : "Off — tap to turn on"}
                >
                  <span>{f.label}</span>
                  <span>{on ? "ON" : "OFF"}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Menu filter chips — show/hide each chip in the guest menu */}
      <section style={{ ...card, marginTop: 12 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Menu filter chips</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, opacity: 0.7 }}>
          Show or hide each filter chip in the guest menu.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {CHIPS.map((c) => {
            const on = featureOn(c.key);
            return (
              <button
                key={c.key}
                onClick={() => toggleFeature(c.key, on)}
                disabled={!ov || busy}
                style={{
                  padding: "9px 12px", borderRadius: 10, border: "1px solid #1f2c49",
                  cursor: ov && !busy ? "pointer" : "default",
                  background: on ? "#13351f" : "#1a2236", color: on ? "#86efac" : "#94a3b8",
                  fontSize: 13, fontWeight: 600,
                }}
                title={on ? "Showing in menu — tap to hide" : "Hidden — tap to show"}
              >
                {c.label}: {on ? "ON" : "OFF"}
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent activity across all panels (the combined who-did-what feed) */}
      <section style={{ ...card, marginTop: 12 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>Recent activity <span style={{ opacity: 0.6, fontWeight: 400 }}>· across all panels</span></h2>
        {activity.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 13, margin: 0 }}>No staff actions yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", maxHeight: 300, overflowY: "auto" }}>
            {activity.map((a) => (
              <div key={a.id} style={{ display: "grid", gridTemplateColumns: "76px 1fr auto", gap: 10, alignItems: "center", fontSize: 13, padding: "7px 0", borderBottom: "1px solid #16223c" }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: PANEL_COLOR[a.panel] || "#94a3b8" }}>{a.panel}</span>
                <span>{ACT_LABEL[a.action] || a.action}{a.table_number ? ` · Table ${a.table_number}` : (a.detail ? ` · ${a.detail}` : "")}</span>
                <span style={{ opacity: 0.55, whiteSpace: "nowrap" }}>{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Live floor */}
      <section style={{ marginTop: 20 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15 }}>
          Live floor <span style={{ opacity: 0.6, fontWeight: 400 }}>· updates every second</span>
        </h2>
        {err && <p style={{ color: "#f87171" }}>Couldn&apos;t load the floor: {err}</p>}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {tables.map((t) => (
            <div
              key={t.table_number}
              style={{
                background: COLOR[t.state],
                border: t.pay === "red" ? "2px solid #f87171" : t.pay === "green" ? "2px solid #34d399" : "2px solid transparent",
                borderRadius: 14, padding: "14px 16px",
                boxShadow: t.state === "free" ? "none" : "0 4px 18px rgba(0,0,0,.35)",
                opacity: t.state === "free" ? 0.75 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 18 }}>Table {t.table_number}</strong>
                <span style={{ fontSize: 16 }}>{t.has_call ? "🔔" : ""}{t.has_new ? "🆕" : ""}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 14, fontWeight: 600 }}>{LABEL[t.state]}</div>
              <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
                {t.open ? `${t.members} seated` : "—"}
                {Number(t.due) > 0 ? ` · ${inr(Number(t.due))} due` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ ...card, padding: "12px 16px" }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
