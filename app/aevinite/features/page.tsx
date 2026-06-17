"use client";
// Admin · Features — turn guest-facing features on/off for the whole restaurant,
// and show/hide each guest-menu filter chip. (Edited only here, not in the editor.)
import { useCallback, useEffect, useState } from "react";

const FEATURES = [
  { key: "model3d", label: "3D dish viewer" }, { key: "ratings", label: "Star ratings" },
  { key: "reviews", label: "Written reviews" }, { key: "allergies", label: "Allergy system" },
  { key: "favorites", label: "Favorites" }, { key: "waiter_calls", label: "Call waiter" },
  { key: "search", label: "Dish search" }, { key: "languages", label: "Languages" },
  { key: "currency", label: "Currency picker" }, { key: "scrollspy", label: "Category scroll-spy" },
];
const CHIPS = [
  { key: "chip_popular", label: "Popular" }, { key: "chip_top-rated", label: "Top Rated" },
  { key: "chip_price", label: "Low Price" }, { key: "chip_veg", label: "Veg" }, { key: "chip_non-veg", label: "Non-Veg" },
];

export default function AdminFeatures() {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const j = await (await fetch("/api/admin/overview", { cache: "no-store" })).json(); if (!j.error) setFeatures(j.features || {}); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const on = (key: string) => { const v = features?.[key]; return v === undefined ? true : v === true; };
  const toggle = async (key: string, current: boolean) => {
    setBusy(true);
    try {
      await fetch("/api/admin/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value: !current }) });
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
      <h1 className="adm-page-h">Features</h1>
      <p className="adm-page-sub">Turn guest-facing features and menu chips on or off for the whole restaurant.</p>

      <div className="adm-card" style={{ marginBottom: 16 }}>
        <h2>Guest features</h2>
        <p className="hint">Each switch shows or hides a feature across the guest menu.</p>
        <div className="adm-togglegrid">{FEATURES.map((f) => <Toggle key={f.key} k={f.key} label={f.label} />)}</div>
      </div>

      <div className="adm-card">
        <h2>Menu filter chips</h2>
        <p className="hint">Show or hide each filter chip at the top of the guest menu.</p>
        <div className="adm-togglegrid">{CHIPS.map((c) => <Toggle key={c.key} k={c.key} label={c.label} />)}</div>
      </div>
    </>
  );
}
