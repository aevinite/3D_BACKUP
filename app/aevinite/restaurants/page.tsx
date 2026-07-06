"use client";
// Admin · Restaurants — the multi-tenant super-panel. Lists EVERY restaurant on
// this backend (searchable by name/slug); pick one to edit ITS guest-feature
// switches. Each switch writes to that restaurant's own settings.features row
// (scoped by restaurant_id), so the change shows ONLY on that restaurant's guest
// menu (/r/<slug>/menu). Mirrors the single-restaurant Features tab's UI + the
// .adm-* styling, parameterised by restaurant.
import { useCallback, useEffect, useRef, useState } from "react";
import { splitBrandSegments, stripBrandMarkers } from "@/lib/brandText";
import { openRestaurantPanel } from "@/components/admin/shared";
import RestaurantReport from "@/components/admin/RestaurantReport";

// Render brand text in the live preview: *marked* parts use the accent colour,
// the rest the mode's text colour — exactly how the guest menu renders it.
function previewParts(text: string, textColor: string, accentColor: string) {
  return splitBrandSegments(text).map((seg, i) => (
    <span key={i} style={{ color: seg.hi ? accentColor : textColor }}>{seg.text}</span>
  ));
}
const stripMarkers = (s: string) => stripBrandMarkers(s);

type Restaurant = { id: string; slug: string; name: string; active: boolean; hasSettings: boolean; ownerUserId: string | null; ownerName: string | null };
type Owner = { id: string; name: string };

// The seeded default restaurant (#1) — can never be deleted (matches the API + SQL guards).
const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";

// The ten guest-facing switches (same set + labels as the Features tab).
const FEATURES = [
  { key: "model3d", label: "3D dish viewer" }, { key: "ratings", label: "Star ratings" },
  { key: "reviews", label: "Written reviews" }, { key: "allergies", label: "Allergy system" },
  { key: "favorites", label: "Favorites" }, { key: "waiter_calls", label: "Call waiter" },
  { key: "search", label: "Dish search" }, { key: "languages", label: "Languages" },
  { key: "currency", label: "Currency picker" }, { key: "scrollspy", label: "Category scroll-spy" },
  { key: "diet_filter", label: "Veg / Non-Veg filter" },
];

// The four operational PANELS a restaurant can have (mig 106). Turning one OFF blocks that
// role's login + hides it (e.g. a restaurant that doesn't want an Owner panel).
const PANEL_OPTS = [
  { key: "manager", label: "Manager panel" }, { key: "kitchen", label: "Kitchen display" },
  { key: "tablet", label: "Waiter tablet" }, { key: "owner", label: "Owner dashboard" },
];

export default function AdminRestaurants() {
  const [list, setList] = useState<Restaurant[] | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Restaurant | null>(null);
  // ?focus=<slug> (set by the Command page's Manage→ + the topbar quick-switcher):
  // open that restaurant's DETAIL directly — landing on the list and making the
  // admin find the row again was the bug (owner 2026-07-04: "Manage should take me
  // to the details of the particular restaurant"). Read from window.location (not
  // useSearchParams) so this client page needs no Suspense boundary.
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  useEffect(() => {
    try { setFocusSlug(new URLSearchParams(window.location.search).get("focus")); } catch {}
  }, []);
  useEffect(() => {
    if (!focusSlug || !list) return;
    const hit = list.find((r) => r.slug === focusSlug);
    if (hit) { setSelected(hit); setFocusSlug(null); return; } // consume it — Back shows the plain list
    const el = document.getElementById(`rest-row-${focusSlug}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusSlug, list]);

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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h">Restaurants</h1>
          <p className="adm-page-sub">Every restaurant on this backend. Pick one to turn its guest features on or off — the change shows only on that restaurant&apos;s menu.</p>
        </div>
        <a className="adm-btn" href="/aevinite/recycle" title="Deleted restaurants — restore or permanently remove">
          <i className="fas fa-trash-can" style={{ marginRight: 7 }} aria-hidden="true" />Recycle bin
        </a>
      </div>

      <NewRestaurant onCreated={loadList} />

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
                id={`rest-row-${r.slug}`}
                className="adm-logrow"
                onClick={() => setSelected(r)}
                style={{
                  gridTemplateColumns: "1.2fr 1fr 1fr 80px 80px", width: "100%", border: 0, color: "var(--text)", cursor: "pointer", textAlign: "left", font: "inherit",
                  // The ?focus= row gets a quiet accent highlight so the eye lands on it.
                  background: focusSlug === r.slug ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                  boxShadow: focusSlug === r.slug ? "inset 2px 0 0 var(--accent)" : undefined,
                }}
                title={`Open ${r.name}`}
              >
                <span style={{ fontWeight: 700 }}>{r.name}</span>
                <span className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{r.slug}</span>
                <span className="adm-muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ownerName || "—"}</span>
                <span>
                  <span className="adm-chip" style={r.active
                    ? { background: "color-mix(in srgb, var(--adm-ok) 22%, transparent)", color: "var(--adm-ok)" }
                    : { background: "var(--muted2, rgba(120,120,120,0.18))", color: "var(--muted)" }}>
                    {r.active ? "Active" : "Suspended"}
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

// ＋ New restaurant — create a restaurant in one go: name + which panels it has, and the
// backend mints one starter login per ENABLED panel (passwords shown ONCE). Default panels:
// Manager+Kitchen+Tablet on, Owner OFF (owner's choice 2026-06-29).
function NewRestaurant({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [panels, setPanels] = useState<Record<string, boolean>>({ manager: true, kitchen: true, tablet: true, owner: false });
  const [seedMenu, setSeedMenu] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; slug: string; logins: { panel: string; username: string; password: string }[]; loginErrors?: string[]; menuSeeded?: boolean; seedError?: string | null } | null>(null);
  // Synchronous re-entry guard (bug #12, 2026-07-06): `busy` only disables the button
  // after a re-render, so a fast double-click fired two creates → a duplicate "-2" tenant.
  const creatingRef = useRef(false);

  const PANELS = [
    { key: "manager", label: "Manager panel" }, { key: "kitchen", label: "Kitchen display" },
    { key: "tablet", label: "Waiter tablet" }, { key: "owner", label: "Owner dashboard" },
  ];

  const create = async () => {
    if (creatingRef.current) return; // block a fast second click before `busy` re-renders
    if (name.trim().length < 2) { setMsg("Enter a name (at least 2 characters)."); return; }
    if (!Object.values(panels).some(Boolean)) { setMsg("Turn on at least one panel."); return; }
    creatingRef.current = true;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_restaurant", name: name.trim(), panels, seedMenu }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't create the restaurant.");
      setDone({ name: d.name, slug: d.slug, logins: d.logins || [], loginErrors: d.loginErrors || [], menuSeeded: d.menuSeeded, seedError: d.seedError });
      setName(""); setPanels({ manager: true, kitchen: true, tablet: true, owner: false }); setSeedMenu(true);
      onCreated();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); creatingRef.current = false; }
  };

  if (!open) {
    return (
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <button className="adm-btn primary" onClick={() => { setOpen(true); setDone(null); }}>
          <i className="fas fa-plus" style={{ marginRight: 7 }} aria-hidden="true" />New restaurant
        </button>
      </div>
    );
  }

  return (
    <div className="adm-card" style={{ marginBottom: 14 }}>
      <h2>New restaurant</h2>
      <p className="hint">Name it and pick which panels it has. We&apos;ll create one starter login per panel you turn on — copy the passwords, they show once.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Restaurant name" disabled={busy}
          style={{ flex: 1, minWidth: 200, padding: "9px 12px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13.5 }} />
      </div>
      <div className="adm-togglegrid">
        {PANELS.map((p) => {
          const isOn = panels[p.key] === true;
          return (
            <button key={p.key} className={`adm-toggle ${isOn ? "on" : "off"}`} disabled={busy}
              onClick={() => setPanels((s) => ({ ...s, [p.key]: !isOn }))}
              title={isOn ? "On — tap to turn off" : "Off — tap to turn on"}>
              <span>{p.label}</span><span className="pill">{isOn ? "ON" : "OFF"}</span>
            </button>
          );
        })}
      </div>
      <div className="adm-togglegrid" style={{ marginTop: 8 }}>
        <button className={`adm-toggle ${seedMenu ? "on" : "off"}`} disabled={busy}
          onClick={() => setSeedMenu((v) => !v)}
          title={seedMenu ? "On — a sample menu will be added" : "Off — start with an empty menu"}>
          <span>Start with sample menu</span><span className="pill">{seedMenu ? "ON" : "OFF"}</span>
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <button className="adm-btn primary" disabled={busy} onClick={create}>
          <i className="fas fa-check" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Creating…" : "Create restaurant"}
        </button>
        <button className="adm-btn" disabled={busy} onClick={() => { setOpen(false); setMsg(null); }}>Cancel</button>
        {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
      {done && (
        <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "color-mix(in srgb, var(--adm-ok) 12%, transparent)" }}>
          <b>{done.name}</b> created (<span style={{ fontFamily: "ui-monospace, monospace" }}>/r/{done.slug}/menu</span>).
          {done.seedError ? (
            <p className="hint" style={{ margin: "6px 0", color: "var(--adm-bad, #c0392b)" }}>Menu seed failed: {done.seedError}. The restaurant was created — add dishes from its manager panel.</p>
          ) : done.menuSeeded ? (
            <p className="hint" style={{ margin: "6px 0" }}>Sample menu added — open the manager panel to edit it.</p>
          ) : null}
          {done.logins.length > 0 ? (
            <>
              <p className="hint" style={{ margin: "8px 0 6px" }}>Starter logins — copy these passwords now, they won&apos;t be shown again:</p>
              <div style={{ display: "grid", gap: 4 }}>
                {done.logins.map((l) => (
                  <div key={l.panel} style={{ fontSize: 13 }}>
                    <span style={{ textTransform: "capitalize", fontWeight: 700 }}>{l.panel}</span>{" — name "}
                    <code style={{ fontWeight: 700 }}>{l.username}</code>{" · password "}<code style={{ fontWeight: 700 }}>{l.password}</code>
                  </div>
                ))}
              </div>
            </>
          ) : <span> No panels were enabled.</span>}
          {done.loginErrors && done.loginErrors.length > 0 && (
            <p className="hint" style={{ margin: "8px 0 0", color: "var(--adm-bad, #c0392b)" }}>
              ⚠ Couldn&rsquo;t create a login for: <b>{done.loginErrors.join(", ")}</b>. Those panels are on but have no sign-in yet — add a user for them in Users.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// The per-restaurant detail: assign its OWNER + flip its guest feature switches.
// StatusCard — Live vs SUSPENDED, with the kill switch (owner 2026-07-04: "what does
// suspended mean? where is the button?"). Suspended = active:false → the tenant
// resolver stops serving the guest menu; the admin still reaches every panel via
// act-as. Suspending is confirmed first — flipping the LIVE client off by accident
// would be an outage.
function StatusCard({ restaurant, onChanged }: { restaurant: Restaurant; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const setActive = async (active: boolean) => {
    if (!active && !window.confirm(`Suspend ${restaurant.name}?\n\nIts guest menu goes OFFLINE immediately (staff panels stay reachable to you via act-as). You can reactivate any time.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_restaurant_active", restaurant_id: restaurant.id, active }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't change the status.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="adm-card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", ...(restaurant.active ? {} : { borderColor: "var(--adm-danger)" }) }}>
      <span className="adm-chip" style={restaurant.active
        ? { background: "color-mix(in srgb, var(--adm-ok) 22%, transparent)", color: "var(--adm-ok)" }
        : { background: "color-mix(in srgb, var(--adm-danger) 22%, transparent)", color: "var(--adm-danger)" }}>
        {restaurant.active ? "Live" : "Suspended"}
      </span>
      <span style={{ flex: 1, fontSize: 13 }} className="adm-muted">
        {restaurant.active
          ? "Guests can open this restaurant's menu."
          : "Suspended — the guest menu is offline. Staff panels stay reachable to you via the buttons below."}
      </span>
      {err && <span style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{err}</span>}
      {restaurant.active
        ? <button className="adm-btn danger" disabled={busy} onClick={() => setActive(false)}><i className="fas fa-power-off" style={{ marginRight: 7 }} aria-hidden="true" />Suspend…</button>
        : <button className="adm-btn primary" disabled={busy} onClick={() => setActive(true)}><i className="fas fa-play" style={{ marginRight: 7 }} aria-hidden="true" />Reactivate</button>}
    </div>
  );
}

function RestaurantDetail({ restaurant, owners, onBack, onChanged }: { restaurant: Restaurant; owners: Owner[]; onBack: () => void; onChanged: () => void }) {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [panels, setPanels] = useState<Record<string, boolean> | null>(null);
  const [staffFeat, setStaffFeat] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState(false);
  // Which staff-feature help screenshot is zoomed full-size (null = none).
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  // "Full report" (owner's words: "every single bit" of ONE restaurant) swaps the
  // whole detail view for its own report — its own component, own data load —
  // instead of cramming another card into an already-long page.
  const [showReport, setShowReport] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/admin/restaurants/features?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
      if (!j.error) setFeatures(j.features || {});
    } catch {}
  }, [restaurant.id]);
  useEffect(() => { load(); }, [load]);

  const loadPanels = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/admin/restaurants/panels?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
      if (!j.error) setPanels(j.panels || {});
    } catch {}
  }, [restaurant.id]);
  useEffect(() => { loadPanels(); }, [loadPanels]);

  const loadStaffFeat = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/admin/restaurants/staff-features?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
      if (!j.error) setStaffFeat(j.flags || {});
    } catch {}
  }, [restaurant.id]);
  useEffect(() => { loadStaffFeat(); }, [loadStaffFeat]);

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

  // Panels default ON unless this restaurant explicitly turned one off (mig 106).
  const onP = (key: string) => { const v = panels?.[key]; return v === undefined ? true : v === true; };
  const togglePanel = async (key: string, current: boolean) => {
    setBusy(true);
    setPanels((p) => ({ ...(p || {}), [key]: !current })); // optimistic; reconciled by loadPanels()
    try {
      await fetch("/api/admin/restaurants/panels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, panel: key, enabled: !current }),
      });
      await loadPanels();
    } finally { setBusy(false); }
  };
  // Plain render helper, NOT a component — defining a component inside render remounts
  // it on every parent render (and the lint rule rightly errors on it).
  const panelToggle = (k: string, label: string) => {
    const isOn = onP(k);
    return (
      <button key={k} className={`adm-toggle ${isOn ? "on" : "off"}`} disabled={!panels || busy} onClick={() => togglePanel(k, isOn)}
        title={isOn ? "On — tap to turn off (blocks that login)" : "Off — tap to turn on"}>
        <span>{label}</span><span className="pill">{isOn ? "ON" : "OFF"}</span>
      </button>
    );
  };

  // Staff-feature ENTITLEMENTS the admin grants (e.g. allow the restaurant to auto-print KOTs).
  // Default OFF — the owner's own on/off lives in the manager settings; both must be on.
  const onS = (key: string) => staffFeat?.[key] === true;
  const toggleStaffFeat = async (key: string, current: boolean) => {
    setBusy(true);
    setStaffFeat((s) => ({ ...(s || {}), [key]: !current }));
    try {
      await fetch("/api/admin/restaurants/staff-features", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, key, value: !current }),
      });
      await loadStaffFeat();
    } finally { setBusy(false); }
  };
  const staffToggle = (k: string, label: string) => {
    const isOn = onS(k);
    return (
      <button key={k} className={`adm-toggle ${isOn ? "on" : "off"}`} disabled={!staffFeat || busy} onClick={() => toggleStaffFeat(k, isOn)}
        title={isOn ? "Allowed — tap to disallow" : "Not allowed — tap to allow"}>
        <span>{label}</span><span className="pill">{isOn ? "ON" : "OFF"}</span>
      </button>
    );
  };
  // Staff-feature CARD: the toggle plus a tiny real screenshot + one-line reminder of
  // what the feature actually is (owner 2026-07-06: "add small ss images in admin panel
  // so admin can remember what it's for"). The thumbnail zooms on tap (setZoomImg).
  const staffFeatCard = (k: string, label: string, hint: string, img: string) => (
    <div key={k} className="adm-featcard">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny local help shot, no next/image needed */}
      <img src={img} alt={`What "${label}" looks like`} loading="lazy"
        onClick={() => setZoomImg(img)} title="Tap to enlarge" />
      <div className="adm-featcard-body">
        {staffToggle(k, label)}
        <p>{hint}</p>
      </div>
    </div>
  );

  if (showReport) {
    return <RestaurantReport restaurantId={restaurant.id} restaurantName={restaurant.name} onBack={() => setShowReport(false)} />;
  }

  return (
    <>
      {/* Breadcrumb: Restaurants › <name> — matches the owner-view breadcrumb (.adm-crumbs)
          so stepping back up is consistent everywhere inside a restaurant (owner request). */}
      <nav className="adm-crumbs" aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
        <a href="/aevinite/restaurants" onClick={(e) => { e.preventDefault(); onBack(); }}>Restaurants</a>
        <i className="fas fa-chevron-right sep" aria-hidden="true" />
        <span className="cur">{restaurant.name}</span>
      </nav>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="adm-page-h">{restaurant.name}</h1>
          <p className="adm-page-sub">
            <span style={{ fontFamily: "ui-monospace, monospace" }}>/r/{restaurant.slug}/menu</span>
            {" · "}Turn this restaurant&apos;s guest features on or off. Changes affect only its menu.
          </p>
        </div>
        <button className="adm-btn" onClick={() => setShowReport(true)} title={`Every usage figure for ${restaurant.name}`}>
          <i className="fas fa-file-lines" style={{ marginRight: 7 }} aria-hidden="true" />Full report
        </button>
      </div>

      <StatusCard restaurant={restaurant} onChanged={onChanged} />

      <OwnerCard restaurant={restaurant} owners={owners} onChanged={onChanged} />

      <BrandingCard restaurant={restaurant} />

      <EnterCard restaurant={restaurant} panels={panels} />

      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>Panels</h2>
        <p className="hint">Which panels <b>{restaurant.name}</b> has. Turning one OFF blocks that login and removes its Enter button above — e.g. a restaurant with no Owner panel.</p>
        {panels === null
          ? <div className="adm-empty">Loading panels…</div>
          : <div className="adm-togglegrid">{PANEL_OPTS.map((p) => panelToggle(p.key, p.label))}</div>}
      </div>

      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>Staff features</h2>
        <p className="hint">Operational features you allow <b>{restaurant.name}</b> to use. The little picture shows what each one looks like (tap to enlarge).</p>
        {staffFeat === null
          ? <div className="adm-empty">Loading…</div>
          : <div className="adm-featgrid">
              {staffFeatCard("auto_print_kot_allowed", "Auto-print KOT (allow)",
                "The kitchen screen prints the order ticket by itself the moment an order arrives. Allowing it only reveals the owner's own on/off in Manager → Settings → Kitchen.",
                "/admin-help/auto-print-kot.png")}
              {staffFeatCard("banquet_allowed", "Banquet billing (allow)",
                "Gives the manager panel a 🎪 Banquet tab — a separate per-plate menu just for banquet bills (plates × price, no kitchen ticket). Waiter-tablet access stays a manager setting.",
                "/admin-help/banquet.png")}
            </div>}
      </div>
      {zoomImg && (
        <div className="adm-imgzoom" onClick={() => setZoomImg(null)} role="button" title="Tap anywhere to close">
          {/* eslint-disable-next-line @next/next/no-img-element -- local help screenshot lightbox */}
          <img src={zoomImg} alt="Feature screenshot, enlarged" />
        </div>
      )}

      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>Guest features</h2>
        <p className="hint">Each switch shows or hides a feature across <b>{restaurant.name}</b>&apos;s guest menu.</p>
        {features === null
          ? <div className="adm-empty">Loading switches…</div>
          : <div className="adm-togglegrid">{FEATURES.map((f) => <Toggle key={f.key} k={f.key} label={f.label} />)}</div>}
      </div>

      <DangerCard restaurant={restaurant} onDeleted={onBack} />
    </>
  );
}

// DangerCard — move a restaurant to the 90-day RECYCLE BIN. Distinct from Suspend:
// suspend just hides the guest menu (reversible instantly, staff/admin keep working);
// DELETE puts the whole restaurant in the bin (guest 404 + staff logins blocked) and
// starts a 90-day clock, after which it can be permanently purged from the bin. To
// make an accidental delete near-impossible, the admin must TYPE the exact name to
// confirm (the GitHub pattern). Restaurant #1 (default) can never be deleted.
function DangerCard({ restaurant, onDeleted }: { restaurant: Restaurant; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isDefault = restaurant.id === DEFAULT_RID;
  const nameMatches = confirmName.trim() === restaurant.name.trim();

  const del = async () => {
    if (!nameMatches) { setErr("Type the restaurant's exact name to confirm."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "soft_delete_restaurant", restaurant_id: restaurant.id, reason: reason.trim() || undefined }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't delete the restaurant.");
      onDeleted(); // back to the list — the restaurant is now in the recycle bin
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  if (isDefault) return null; // never offer to delete the default restaurant

  return (
    <div className="adm-card" style={{ marginTop: 14, borderColor: "var(--adm-danger)" }}>
      <h2 style={{ color: "var(--adm-danger)" }}>Danger zone</h2>
      <p className="hint">
        Delete <b>{restaurant.name}</b> — it moves to the <b>recycle bin for 90 days</b>. Its guest menu goes offline and
        staff can&apos;t log in, but nothing is erased. You can <b>restore</b> it any time in those 90 days; only after that can it be
        permanently removed. This is different from Suspend (which just hides the menu, instantly reversible).
      </p>
      {!open ? (
        <button className="adm-btn danger" onClick={() => { setOpen(true); setErr(null); }}>
          <i className="fas fa-trash-can" style={{ marginRight: 7 }} aria-hidden="true" />Delete restaurant…
        </button>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 460 }}>
          <label style={{ fontSize: 12.5 }}>
            Reason (optional — shown in the recycle bin)
            <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} placeholder="e.g. closed down, duplicate…"
              style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
          </label>
          <label style={{ fontSize: 12.5 }}>
            Type <b style={{ fontFamily: "ui-monospace, monospace" }}>{restaurant.name}</b> to confirm
            <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} disabled={busy} autoFocus placeholder={restaurant.name}
              style={{ width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, border: nameMatches ? "1px solid var(--adm-ok)" : "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 }} />
          </label>
          {err && <span style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{err}</span>}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="adm-btn danger" disabled={busy || !nameMatches} onClick={del}>
              <i className="fas fa-trash-can" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Deleting…" : "Move to recycle bin"}
            </button>
            <button className="adm-btn" disabled={busy} onClick={() => { setOpen(false); setConfirmName(""); setReason(""); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-restaurant brand identity: full theme palette (bg/card/text/accent) per
// light & dark mode, via colour-picker AND hex input, with a live preview, plus
// hero/tagline/logo-text. Writes /api/admin/restaurants/branding.
const PALETTE_FIELDS: { key: "bg" | "card" | "text" | "accent"; label: string }[] = [
  { key: "bg", label: "Background" }, { key: "card", label: "Card / surface" },
  { key: "text", label: "Text" }, { key: "accent", label: "Accent" },
];
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function BrandingCard({ restaurant }: { restaurant: Restaurant }) {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [theme, setTheme] = useState<{ dark: Record<string, string>; light: Record<string, string> }>({ dark: {}, light: {} });
  const [hero, setHero] = useState(""); const [tagline, setTagline] = useState(""); const [logoText, setLogoText] = useState("");
  const [accent, setAccent] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false); const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch(`/api/admin/restaurants/branding?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
        if (!j.error) {
          const t = j.theme || {};
          setTheme({ dark: { ...(t.dark || {}) }, light: { ...(t.light || {}) } });
          setHero(j.hero_title || ""); setTagline(j.tagline || ""); setLogoText(j.logo_text || ""); setAccent(j.accent_color || ""); setLogoUrl(j.logo_url || null);
        }
      } catch {}
    })();
  }, [restaurant.id]);

  // Logo IMAGE upload (separate from the text fields — it streams a file to Storage).
  const uploadLogo = async (file: File) => {
    setLogoBusy(true); setLogoMsg(null);
    try {
      const fd = new FormData(); fd.append("restaurant_id", restaurant.id); fd.append("file", file);
      const r = await fetch("/api/admin/restaurants/logo", { method: "POST", body: fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Upload failed.");
      setLogoUrl(d.logo_url); setLogoMsg("Logo updated — shows on the menu within ~15s.");
    } catch (e) { setLogoMsg(e instanceof Error ? e.message : String(e)); } finally { setLogoBusy(false); }
  };
  const removeLogo = async () => {
    setLogoBusy(true); setLogoMsg(null);
    try {
      const r = await fetch(`/api/admin/restaurants/logo?restaurant_id=${encodeURIComponent(restaurant.id)}`, { method: "DELETE" });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't remove.");
      setLogoUrl(null); setLogoMsg("Logo removed — the menu falls back to the name.");
    } catch (e) { setLogoMsg(e instanceof Error ? e.message : String(e)); } finally { setLogoBusy(false); }
  };

  const cur = theme[mode];
  const setColor = (key: string, val: string) => setTheme((s) => ({ ...s, [mode]: { ...s[mode], [key]: val } }));
  const clearColor = (key: string) => setTheme((s) => { const m = { ...s[mode] }; delete m[key]; return { ...s, [mode]: m }; });

  // Preview defaults so an unset slot still renders something sensible in the swatch.
  const pv = {
    bg: cur.bg || (mode === "dark" ? "#1a0f09" : "#faf3e8"),
    card: cur.card || (mode === "dark" ? "#2c1b11" : "#ffffff"),
    text: cur.text || (mode === "dark" ? "#f3e9db" : "#3c2a1e"),
    accent: cur.accent || accent || (mode === "dark" ? "#e3c06f" : "#d4a574"),
  };
  const lowContrast = (() => {
    const lum = (hex: string) => { const h = hex.replace("#", ""); const f = h.length === 3 ? h.split("").map(c=>c+c).join("") : h; const n = parseInt(f, 16); const r=(n>>16)&255,g=(n>>8)&255,b=n&255; return (0.299*r+0.587*g+0.114*b)/255; };
    try { return Math.abs(lum(pv.text) - lum(pv.bg)) < 0.35; } catch { return false; }
  })();

  const save = async () => {
    for (const m of ["dark", "light"] as const)
      for (const k of Object.keys(theme[m]))
        if (theme[m][k] && !HEX_RE.test(theme[m][k])) { setMsg(`${m} ${k}: "${theme[m][k]}" isn't a hex colour (e.g. #1a0f09).`); return; }
    if (accent && !HEX_RE.test(accent)) { setMsg(`Accent "${accent}" isn't a hex colour.`); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/restaurants/branding", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, theme, accent_color: accent || null, hero_title: hero || null, tagline: tagline || null, logo_text: logoText || null }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg("Saved — open the guest menu to see it (within ~15s).");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const inputStyle: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: "var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13 };

  return (
    <div className="adm-card" style={{ marginBottom: 14 }}>
      <h2>Branding &amp; theme</h2>
      <p className="hint">Set <b>{restaurant.name}</b>&apos;s colours, logo text and hero — for light and dark mode. Leave a colour blank to use the sensible default. Changes show on the guest menu within ~15s.</p>

      <div className="adm-togglegrid" style={{ marginBottom: 12 }}>
        <button className={`adm-toggle ${mode === "dark" ? "on" : "off"}`} onClick={() => setMode("dark")}><span>Dark mode</span><span className="pill">{mode === "dark" ? "EDITING" : ""}</span></button>
        <button className={`adm-toggle ${mode === "light" ? "on" : "off"}`} onClick={() => setMode("light")}><span>Light mode</span><span className="pill">{mode === "light" ? "EDITING" : ""}</span></button>
      </div>

      {/* adm-grid2 collapses to ONE column on phones — the old inline 1fr 1fr never did,
          which crammed ~260px of fixed-width colour controls into a ~155px column at 390px. */}
      <div className="adm-grid2" style={{ gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 10 }}>
          {PALETTE_FIELDS.map((f) => (
            <div key={f.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ width: 110, flex: "0 0 auto", fontSize: 13 }}>{f.label}</label>
              <input type="color" value={(cur[f.key] && HEX_RE.test(cur[f.key])) ? cur[f.key] : pv[f.key]} disabled={busy}
                onChange={(e) => setColor(f.key, e.target.value)} style={{ width: 38, flex: "0 0 auto", height: 30, border: "none", background: "none", cursor: "pointer" }} />
              <input value={cur[f.key] || ""} placeholder={pv[f.key]} disabled={busy} onChange={(e) => setColor(f.key, e.target.value.trim())} style={{ ...inputStyle, width: 110, minWidth: 0, flex: "0 1 110px", fontFamily: "ui-monospace, monospace" }} />
              {cur[f.key] && <button className="adm-btn" disabled={busy} onClick={() => clearColor(f.key)} title="Reset to default" style={{ padding: "4px 8px" }}>↺</button>}
            </div>
          ))}
        </div>
        {/* Live preview swatch — renders the wordmark + hero with *highlight* markers:
            marked parts use the accent, the rest the mode's text colour. */}
        <div style={{ borderRadius: 12, overflow: "hidden", border: "var(--border)" }}>
          <div style={{ background: pv.bg, color: pv.text, padding: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{previewParts(logoText || restaurant.name, pv.text, pv.accent)}</div>
            <div style={{ fontSize: 11, letterSpacing: 2, color: pv.accent }}>{stripMarkers(tagline) || "WELCOME"}</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{previewParts(hero || "Our Menu", pv.text, pv.accent)}</div>
            <div style={{ background: pv.card, borderRadius: 10, padding: 10, marginTop: 10 }}>
              <div style={{ fontWeight: 700 }}>Sample Dish</div>
              <div style={{ display: "inline-block", marginTop: 6, padding: "4px 10px", borderRadius: 999, background: pv.accent, color: pv.bg, fontSize: 12, fontWeight: 700 }}>Add</div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 8 }}>{mode} preview</div>
          </div>
        </div>
      </div>
      {lowContrast && <p className="hint" style={{ color: "var(--adm-bad, #c0392b)", marginTop: 8 }}>⚠ Text and background look low-contrast — guests may struggle to read it.</p>}

      <div style={{ display: "grid", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "var(--border)" }}>
        <p className="hint" style={{ margin: 0 }}>Tip: wrap a word in <code>*stars*</code> to colour it with your <b>accent</b> — the rest stays white (dark) / black (light). e.g. <code>Little *French* House</code>.</p>
        {/* Logo IMAGE — shown on the opening splash AND beside the search bar. */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 56, height: 56, borderRadius: 10, border: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", overflow: "hidden" }}>
            {logoUrl ? <img src={logoUrl} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <i className="fas fa-image adm-muted" aria-hidden="true" />}
          </div>
          <label className="adm-btn" style={{ cursor: logoBusy ? "default" : "pointer" }}>
            <i className="fas fa-upload" style={{ marginRight: 6 }} aria-hidden="true" />{logoBusy ? "Uploading…" : "Upload logo image"}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={logoBusy} style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ""; }} />
          </label>
          {logoUrl && <button className="adm-btn" disabled={logoBusy} onClick={removeLogo}>Remove logo</button>}
          {logoMsg && <span className="adm-muted" style={{ fontSize: 12 }}>{logoMsg}</span>}
        </div>
        <p className="hint" style={{ margin: 0 }}>PNG / JPG / WEBP, up to 1 MB. Shows on the opening screen and next to the search bar.</p>
        <label style={{ fontSize: 12 }}>Logo text (header + opening screen)<input value={logoText} maxLength={60} placeholder={restaurant.name} disabled={busy} onChange={(e) => setLogoText(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
        <label style={{ fontSize: 12 }}>Hero title<input value={hero} maxLength={120} placeholder="Our Menu" disabled={busy} onChange={(e) => setHero(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
        <label style={{ fontSize: 12 }}>Greeting / tagline<input value={tagline} maxLength={80} placeholder="Welcome" disabled={busy} onChange={(e) => setTagline(e.target.value)} style={{ ...inputStyle, width: "100%", marginTop: 4 }} /></label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <button className="adm-btn primary" disabled={busy} onClick={save}><i className="fas fa-check" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Saving…" : "Save branding"}</button>
        {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
    </div>
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
// exactly what its own staff see. This flow is the ONLY way an admin reaches a
// panel: a bare /tablet etc. with no restaurant scope bounces back to /aevinite.
// "Stop" clears the cookie; already-open tabs stay pinned by their ?rid=.
function EnterCard({ restaurant, panels }: { restaurant: Restaurant; panels: Record<string, boolean> | null }) {
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Only show the Enter buttons for panels this restaurant HAS. Until the panels load
  // (null) show all, so the buttons never flicker missing. (mig 106)
  const panelOn = (k: string) => !panels || panels[k] !== false;
  const PANELS: [string, string, string, string][] = [
    ["/editor", "Manager panel", "fa-table-columns", "manager"],
    ["/kitchen", "Kitchen display", "fa-fire-burner", "kitchen"],
    ["/tablet", "Waiter tablet", "fa-mobile-screen-button", "tablet"],
  ];

  const openPanel = async (path: string) => {
    setBusy(true); setMsg(null);
    try {
      // Shared act-as helper (components/admin/shared.tsx) — also used by the
      // Command page's quick-open buttons. Sets the act-as cookie, then opens the
      // panel in a new tab pinned to this restaurant via ?rid=.
      await openRestaurantPanel(restaurant.id, path);
      setViewing(true);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setMsg(null);
    try {
      await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
      setViewing(false); setMsg("Stopped — reopen a panel from here when you need it again.");
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
        {panelOn("owner") && (
          <button className="adm-btn primary" disabled={busy} onClick={() => openPanel("/owner")} title={`Open ${restaurant.name}'s owner dashboard`}>
            <i className="fas fa-crown" style={{ marginRight: 7 }} aria-hidden="true" />Owner dashboard
          </button>
        )}
        {PANELS.filter(([, , , k]) => panelOn(k)).map(([path, label, icon]) => (
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
