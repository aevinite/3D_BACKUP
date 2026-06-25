"use client";
// Admin · Restaurants — the multi-tenant super-panel. Lists EVERY restaurant on
// this backend (searchable by name/slug); pick one to edit ITS guest-feature
// switches. Each switch writes to that restaurant's own settings.features row
// (scoped by restaurant_id), so the change shows ONLY on that restaurant's guest
// menu (/r/<slug>/menu). Mirrors the single-restaurant Features tab's UI + the
// .adm-* styling, parameterised by restaurant.
import { useCallback, useEffect, useState } from "react";

type Restaurant = { id: string; slug: string; name: string; active: boolean; hasSettings: boolean };

// The ten guest-facing switches (same set + labels as the Features tab).
const FEATURES = [
  { key: "model3d", label: "3D dish viewer" }, { key: "ratings", label: "Star ratings" },
  { key: "reviews", label: "Written reviews" }, { key: "allergies", label: "Allergy system" },
  { key: "favorites", label: "Favorites" }, { key: "waiter_calls", label: "Call waiter" },
  { key: "search", label: "Dish search" }, { key: "languages", label: "Languages" },
  { key: "currency", label: "Currency picker" }, { key: "scrollspy", label: "Category scroll-spy" },
];

export default function AdminRestaurants() {
  const [list, setList] = useState<Restaurant[] | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Restaurant | null>(null);

  // Load the restaurant list once (and again when we come back from a detail view
  // so a freshly-created settings row shows its "settings" state).
  const loadList = useCallback(async () => {
    try {
      const j = await (await fetch("/api/admin/restaurants", { cache: "no-store" })).json();
      if (!j.error) setList(j.restaurants || []);
    } catch {}
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  if (selected) {
    return <RestaurantFeatures restaurant={selected} onBack={() => { setSelected(null); loadList(); }} />;
  }

  const needle = q.trim().toLowerCase();
  const rows = (list || []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle));

  return (
    <>
      <h1 className="adm-page-h">Restaurants</h1>
      <p className="adm-page-sub">Every restaurant on this backend. Pick one to turn its guest features on or off — the change shows only on that restaurant&apos;s menu.</p>

      <div className="adm-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <i className="fas fa-magnifying-glass adm-muted" aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or slug…"
            aria-label="Search restaurants"
            style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "var(--border)", borderRadius: 10, padding: "10px 13px", fontSize: 13.5 }}
          />
          <span className="adm-muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{rows.length} of {list?.length ?? 0}</span>
        </div>

        {list === null ? (
          <div className="adm-empty">Loading restaurants…</div>
        ) : rows.length === 0 ? (
          <div className="adm-empty">No restaurants match “{q}”.</div>
        ) : (
          <div className="adm-logwrap">
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1fr 1fr 90px 110px" }}>
              <span>Name</span><span>Slug</span><span>Status</span><span style={{ textAlign: "right" }}>Features</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.id}
                className="adm-logrow"
                onClick={() => setSelected(r)}
                style={{ gridTemplateColumns: "1fr 1fr 90px 110px", width: "100%", border: 0, background: "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left", font: "inherit" }}
                title={`Edit ${r.name}'s features`}
              >
                <span style={{ fontWeight: 700 }}>{r.name}</span>
                <span className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{r.slug}</span>
                <span>
                  <span className="adm-chip" style={r.active
                    ? { background: "color-mix(in srgb, var(--adm-ok) 22%, transparent)", color: "var(--adm-ok)" }
                    : { background: "var(--muted2, rgba(120,120,120,0.18))", color: "var(--muted)" }}>
                    {r.active ? "Active" : "Off"}
                  </span>
                </span>
                <span style={{ textAlign: "right", color: "var(--accent)", fontWeight: 700, fontSize: 13 }}>
                  Edit <i className="fas fa-chevron-right" style={{ fontSize: 10, marginLeft: 4 }} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// The per-restaurant feature toggles. Reads THIS restaurant's merged features
// (defaults + its overrides) and writes each flip to its own settings row.
function RestaurantFeatures({ restaurant, onBack }: { restaurant: Restaurant; onBack: () => void }) {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/admin/restaurants/features?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
      if (!j.error) setFeatures(j.features || {});
    } catch {}
  }, [restaurant.id]);
  useEffect(() => { load(); }, [load]);

  // Each switch defaults ON unless this restaurant explicitly turned it off
  // (matches lib/features.ts FEATURE_DEFAULTS — all ten default true).
  const on = (key: string) => { const v = features?.[key]; return v === undefined ? true : v === true; };
  const toggle = async (key: string, current: boolean) => {
    setBusy(true);
    // Optimistic flip so the pill responds instantly; reconciled by load().
    setFeatures((f) => ({ ...(f || {}), [key]: !current }));
    try {
      await fetch("/api/admin/restaurants/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, key, value: !current }),
      });
      await load();
    } finally { setBusy(false); }
  };

  const Toggle = ({ k, label }: { k: string; label: string }) => {
    const isOn = on(k);
    return (
      <button className={`adm-toggle ${isOn ? "on" : "off"}`} disabled={!features || busy} onClick={() => toggle(k, isOn)}
        title={isOn ? "On — tap to turn off" : "Off — tap to turn on"}>
        <span>{label}</span><span className="pill">{isOn ? "ON" : "OFF"}</span>
      </button>
    );
  };

  return (
    <>
      <button className="adm-btn" onClick={onBack} style={{ marginBottom: 14 }}>
        <i className="fas fa-arrow-left" style={{ marginRight: 7 }} aria-hidden="true" />All restaurants
      </button>
      <h1 className="adm-page-h">{restaurant.name}</h1>
      <p className="adm-page-sub">
        <span style={{ fontFamily: "ui-monospace, monospace" }}>/r/{restaurant.slug}/menu</span>
        {" · "}Turn this restaurant&apos;s guest features on or off. Changes affect only its menu.
      </p>

      <div className="adm-card">
        <h2>Guest features</h2>
        <p className="hint">Each switch shows or hides a feature across <b>{restaurant.name}</b>&apos;s guest menu.</p>
        {features === null
          ? <div className="adm-empty">Loading switches…</div>
          : <div className="adm-togglegrid">{FEATURES.map((f) => <Toggle key={f.key} k={f.key} label={f.label} />)}</div>}
      </div>
    </>
  );
}
