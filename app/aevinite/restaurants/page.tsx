"use client";
// Admin · Restaurants — the multi-tenant super-panel. Lists EVERY restaurant on
// this backend (searchable by name/slug); pick one to edit ITS guest-feature
// switches. Each switch writes to that restaurant's own settings.features row
// (scoped by restaurant_id), so the change shows ONLY on that restaurant's guest
// menu (/r/<slug>/menu). Mirrors the single-restaurant Features tab's UI + the
// .adm-* styling, parameterised by restaurant.
import { useCallback, useEffect, useState } from "react";

type Restaurant = { id: string; slug: string; name: string; active: boolean; hasSettings: boolean; ownerUserId: string | null; ownerName: string | null };
type Owner = { id: string; name: string };

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
  const [owners, setOwners] = useState<Owner[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Restaurant | null>(null);

  // Load the restaurant list once (and again when we come back from a detail view
  // so a freshly-created settings row + owner assignment show their latest state).
  const loadList = useCallback(async () => {
    try {
      const j = await (await fetch("/api/admin/restaurants", { cache: "no-store" })).json();
      if (!j.error) { setList(j.restaurants || []); setOwners(j.owners || []); }
    } catch {}
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  if (selected) {
    // Re-read the freshest copy from the list so the owner shows correctly after a round-trip.
    const fresh = (list || []).find((r) => r.id === selected.id) || selected;
    return <RestaurantDetail restaurant={fresh} owners={owners} onBack={() => { setSelected(null); loadList(); }} onChanged={loadList} />;
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
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.2fr 1fr 1fr 80px 80px" }}>
              <span>Name</span><span>Slug</span><span>Owner</span><span>Status</span><span style={{ textAlign: "right" }}>Open</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.id}
                className="adm-logrow"
                onClick={() => setSelected(r)}
                style={{ gridTemplateColumns: "1.2fr 1fr 1fr 80px 80px", width: "100%", border: 0, background: "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left", font: "inherit" }}
                title={`Open ${r.name}`}
              >
                <span style={{ fontWeight: 700 }}>{r.name}</span>
                <span className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{r.slug}</span>
                <span className="adm-muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ownerName || "—"}</span>
                <span>
                  <span className="adm-chip" style={r.active
                    ? { background: "color-mix(in srgb, var(--adm-ok) 22%, transparent)", color: "var(--adm-ok)" }
                    : { background: "var(--muted2, rgba(120,120,120,0.18))", color: "var(--muted)" }}>
                    {r.active ? "Active" : "Off"}
                  </span>
                </span>
                <span style={{ textAlign: "right", color: "var(--accent)", fontWeight: 700, fontSize: 13 }}>
                  Open <i className="fas fa-chevron-right" style={{ fontSize: 10, marginLeft: 4 }} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// The per-restaurant detail: assign its OWNER + flip its guest feature switches.
function RestaurantDetail({ restaurant, owners, onBack, onChanged }: { restaurant: Restaurant; owners: Owner[]; onBack: () => void; onChanged: () => void }) {
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

      <OwnerCard restaurant={restaurant} owners={owners} onChanged={onChanged} />

      <EnterCard restaurant={restaurant} />

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

// Owner assignment for one restaurant: pick an existing owner, or create a new one
// (which is auto-assigned here). Writes via /api/admin/restaurants (PATCH/POST).
function OwnerCard({ restaurant, owners, onChanged }: { restaurant: Restaurant; owners: Owner[]; onChanged: () => void }) {
  const [sel, setSel] = useState<string>(restaurant.ownerUserId || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);
  const [newName, setNewName] = useState("");

  const assign = async (ownerId: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/restaurants", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: restaurant.id, owner_user_id: ownerId || null }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setSel(ownerId); setMsg("Saved."); onChanged();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const createOwner = async () => {
    const name = newName.trim(); if (name.length < 2) { setMsg("Name must be at least 2 characters."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/restaurants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_owner", name }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't create.");
      setReveal({ name: d.name, password: d.password }); setNewName("");
      await assign(d.id); // auto-assign the brand-new owner to this restaurant
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="adm-card" style={{ marginBottom: 14 }}>
      <h2>Owner</h2>
      <p className="hint">Who owns this restaurant — they see it on their owner dashboard and manage its staff &amp; manager powers.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select value={sel} disabled={busy} onChange={(e) => assign(e.target.value)}
          style={{ padding: "8px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }}>
          <option value="">— no owner —</option>
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "var(--border)" }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New owner name"
          style={{ padding: "8px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
        <button className="adm-btn" disabled={busy} onClick={createOwner}><i className="fas fa-user-plus" style={{ marginRight: 6 }} aria-hidden="true" />Create &amp; assign owner</button>
      </div>
      {reveal && (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "color-mix(in srgb, var(--adm-ok) 12%, transparent)" }}>
          <b>{reveal.name}</b> created. Password (copy now — shown once): <code style={{ fontWeight: 700 }}>{reveal.password}</code>
        </div>
      )}
    </div>
  );
}

// Admin "view as": the admin ENTERS this restaurant (sets a short-lived act-as
// cookie via /api/admin/act-as), then opens its operational panels in a new tab.
// Because the panel APIs scope by panelRestaurantId (which reads that cookie for
// the admin), the manager/kitchen/tablet show THIS restaurant's live data —
// exactly what its own staff see — instead of the default restaurant. "Stop"
// clears the cookie so the admin's panels revert to the default restaurant.
function EnterCard({ restaurant }: { restaurant: Restaurant }) {
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const PANELS: [string, string, string][] = [
    ["/editor", "Manager panel", "fa-table-columns"],
    ["/kitchen", "Kitchen display", "fa-fire-burner"],
    ["/tablet", "Waiter tablet", "fa-mobile-screen-button"],
  ];

  const openPanel = async (path: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: restaurant.id }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't enter restaurant.");
      setViewing(true);
      window.open(path, "_blank", "noopener");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setMsg(null);
    try {
      await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
      setViewing(false); setMsg("Stopped — your panels show the default restaurant again.");
    } finally { setBusy(false); }
  };

  return (
    <div className="adm-card" style={{ marginBottom: 14 }}>
      <h2>View &amp; manage this restaurant</h2>
      <p className="hint">See <b>{restaurant.name}</b> exactly as its guests and staff do, and manage its people. Each opens in a new tab.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <a className="adm-btn primary" href={`/r/${restaurant.slug}/menu`} target="_blank" rel="noopener" title={`Open ${restaurant.name}'s guest menu`}>
          <i className="fas fa-utensils" style={{ marginRight: 7 }} aria-hidden="true" />View guest menu
        </a>
        <button className="adm-btn primary" disabled={busy} onClick={() => openPanel("/owner")} title={`Open ${restaurant.name}'s owner dashboard`}>
          <i className="fas fa-crown" style={{ marginRight: 7 }} aria-hidden="true" />Owner dashboard
        </button>
        {PANELS.map(([path, label, icon]) => (
          <button key={path} className="adm-btn" disabled={busy} onClick={() => openPanel(path)} title={`Open ${label} as ${restaurant.name}`}>
            <i className={`fas ${icon}`} style={{ marginRight: 7 }} aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 12, paddingTop: 12, borderTop: "var(--border)" }}>
        <a className="adm-btn" href="/aevinite/users" title="Create or manage staff, managers & owners">
          <i className="fas fa-user-plus" style={{ marginRight: 7 }} aria-hidden="true" />Manage staff &amp; create users
        </a>
        <button className="adm-btn" disabled={busy} onClick={stop}>
          <i className="fas fa-arrow-rotate-left" style={{ marginRight: 7 }} aria-hidden="true" />Stop viewing as this restaurant
        </button>
        {viewing && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--adm-ok)" }}>Now viewing panels as {restaurant.name}.</span>}
        {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}
