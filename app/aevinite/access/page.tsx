"use client";
// /aevinite/access — the ADMIN access-control hub (redesign, 2026-07-03).
// One place to toggle EVERY access bit for a restaurant: which panels it has, which
// guest features are on, what its managers may do, what the tablet may do to a bill,
// and per-staff-member overrides. No earnings/revenue anywhere — this is pure control.
// Builds entirely on the existing admin APIs (panels / features / access / owner-staff).
import { useEffect, useState, useCallback } from "react";

type Rest = { id: string; name: string; slug: string; active: boolean };
type Staff = { id: string; name: string | null; username: string; role: string; restaurant_id: string; permissions?: Record<string, string> };

const PANELS: [string, string][] = [["manager", "Manager"], ["kitchen", "Kitchen"], ["tablet", "Waiter tablet"], ["owner", "Owner"]];
const FEATURES: [string, string][] = [
  ["ratings", "Star ratings"], ["reviews", "Reviews"], ["model3d", "3D dish viewer"], ["allergies", "Allergies"],
  ["favorites", "Favorites"], ["waiter_calls", "Call waiter"], ["search", "Search"], ["languages", "Languages"],
  ["currency", "Currency switch"], ["scrollspy", "Scroll-spy"], ["diet_filter", "Veg / Non-veg filter"],
];
const MANAGER_POWERS: [string, string][] = [
  ["manage_staff", "Manage staff"], ["edit_menu", "Edit menu"], ["give_discounts", "Give discounts"],
  ["view_dashboard", "View dashboard"], ["void_bills", "Void bills"],
];
const TABLET_CAPS: [string, string][] = [["tablet_discount", "Apply discount"], ["tablet_mark_paid", "Mark bill paid"], ["tablet_invoice", "Generate invoice"]];
const TRI: [string, string][] = [["off", "Off"], ["on", "On"], ["pin", "On · PIN"]];

export default function AccessPage() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [rid, setRid] = useState<string>("");
  const [panels, setPanels] = useState<Record<string, boolean>>({});
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [manager, setManager] = useState<Record<string, boolean>>({});
  const [tablet, setTablet] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 1800); };

  // Load the restaurant list once.
  useEffect(() => {
    fetch("/api/admin/restaurants").then((r) => r.json()).then((d) => {
      const list: Rest[] = d.restaurants || [];
      setRests(list);
      if (list.length && !rid) setRid(list[0].id);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load everything for the selected restaurant.
  const loadRestaurant = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const [p, f, a, s] = await Promise.all([
        fetch(`/api/admin/restaurants/panels?restaurant_id=${id}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/admin/restaurants/features?restaurant_id=${id}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/admin/restaurants/access?restaurant_id=${id}`).then((r) => r.json()).catch(() => ({})),
        fetch(`/api/owner/staff?restaurant_id=${id}`).then((r) => r.json()).catch(() => ({})),
      ]);
      setPanels(p.panels || {});
      setFeatures(f.features || {});
      setManager(a.manager || {});
      setTablet(a.tablet || {});
      setStaff((s.staff || []).filter((u: Staff) => u.restaurant_id === id && u.role !== "owner"));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (rid) loadRestaurant(rid); }, [rid, loadRestaurant]);

  // Savers — each optimistic, then persist. On failure we reload the truth.
  const savePanel = async (panel: string, enabled: boolean) => {
    setPanels((x) => ({ ...x, [panel]: enabled }));
    const r = await fetch("/api/admin/restaurants/panels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, panel, enabled }) });
    r.ok ? toast("Saved") : (toast("Failed"), loadRestaurant(rid));
  };
  const saveFeature = async (key: string, value: boolean) => {
    setFeatures((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, key, value }) });
    r.ok ? toast("Saved") : (toast("Failed"), loadRestaurant(rid));
  };
  const saveManager = async (key: string, value: boolean) => {
    setManager((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, manager: { [key]: value } }) });
    r.ok ? toast("Saved") : (toast("Failed"), loadRestaurant(rid));
  };
  const saveTablet = async (key: string, value: string) => {
    setTablet((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, tablet: { [key]: value } }) });
    r.ok ? toast("Saved") : (toast("Failed"), loadRestaurant(rid));
  };
  const saveStaffPerm = async (userId: string, key: string, value: string) => {
    setStaff((list) => list.map((u) => u.id === userId ? { ...u, permissions: { ...(u.permissions || {}), [key]: value } } : u));
    // "default" clears the override (null) so the user inherits the restaurant-wide setting.
    const perm = value === "default" ? null : value;
    const r = await fetch("/api/owner/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: userId, action: "set_permissions", permissions: { [key]: perm } }) });
    r.ok ? toast("Saved") : (toast("Failed"), loadRestaurant(rid));
  };

  const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      style={{ width: 44, height: 26, borderRadius: 999, border: "1px solid var(--ac-line, #d8cdb8)", background: on ? "var(--ac-accent, #c98f3f)" : "var(--ac-off, #e6dcc9)", position: "relative", cursor: "pointer", transition: "background .15s", flex: "none" }}>
      <span style={{ position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.3)" }} />
    </button>
  );
  const Tri = ({ val, onChange, withDefault }: { val: string; onChange: (v: string) => void; withDefault?: boolean }) => (
    <select value={val} onChange={(e) => onChange(e.target.value)}
      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--ac-line,#d8cdb8)", background: "var(--ac-card,#fff)", color: "inherit", fontSize: 13.5, cursor: "pointer" }}>
      {withDefault && <option value="default">Default</option>}
      {TRI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const Card = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
    <section style={{ background: "var(--ac-card,#fff)", border: "1px solid var(--ac-line,#e6dcc9)", borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{title}</h3>
      {hint && <p style={{ margin: "0 0 14px", color: "var(--ac-muted,#857655)", fontSize: 13, lineHeight: 1.5 }}>{hint}</p>}
      {children}
    </section>
  );
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--ac-line,#f0e9dc)" }}>
      <span style={{ fontSize: 14.5 }}>{label}</span>{children}
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "8px 4px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22 }}>Access control</h2>
          <p style={{ margin: 0, color: "var(--ac-muted,#857655)", fontSize: 13.5 }}>Toggle every access bit for a restaurant — panels, guest features, manager powers, tablet capabilities, and per-person overrides.</p>
        </div>
        <select value={rid} onChange={(e) => setRid(e.target.value)}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--ac-line,#d8cdb8)", background: "var(--ac-card,#fff)", color: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer", minWidth: 200 }}>
          {rests.map((r) => <option key={r.id} value={r.id}>{r.name}{r.active ? "" : " (inactive)"}</option>)}
        </select>
      </div>

      {loading && <div style={{ color: "var(--ac-muted,#857655)", padding: 20 }}>Loading…</div>}
      {!loading && rid && (
        <>
          <Card title="Panels" hint="Which staff apps this restaurant can use. Turning one off blocks that role's login.">
            {PANELS.map(([k, l]) => <Row key={k} label={l}><Toggle on={panels[k] !== false} onChange={(v) => savePanel(k, v)} /></Row>)}
          </Card>
          <Card title="Manager powers" hint="What this restaurant's managers are allowed to do (server-enforced).">
            {MANAGER_POWERS.map(([k, l]) => <Row key={k} label={l}><Toggle on={manager[k] === true} onChange={(v) => saveManager(k, v)} /></Row>)}
          </Card>
          <Card title="Tablet (waiter) billing" hint="What the waiter tablet may do to a bill. 'On · PIN' requires a manager PIN each time.">
            {TABLET_CAPS.map(([k, l]) => <Row key={k} label={l}><Tri val={tablet[k] || "off"} onChange={(v) => saveTablet(k, v)} /></Row>)}
          </Card>
          <Card title="Guest menu features" hint="Which features guests see on this restaurant's menu.">
            {FEATURES.map(([k, l]) => <Row key={k} label={l}><Toggle on={features[k] !== false} onChange={(v) => saveFeature(k, v)} /></Row>)}
          </Card>
          <Card title="Per-person overrides" hint="Override the tablet billing caps for one staff member. 'Default' = inherit the restaurant setting above.">
            {staff.length === 0 && <p style={{ color: "var(--ac-muted,#857655)", fontSize: 14, margin: 0 }}>No manager/kitchen/tablet staff for this restaurant yet.</p>}
            {staff.map((u) => (
              <div key={u.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--ac-line,#f0e9dc)" }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 8 }}>{u.name || u.username} <span style={{ color: "var(--ac-muted,#857655)", fontWeight: 400, fontSize: 12.5 }}>· {u.role}</span></div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {TABLET_CAPS.map(([k, l]) => (
                    <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ac-muted,#857655)" }}>
                      {l}
                      <Tri val={(u.permissions && u.permissions[k]) || "default"} onChange={(v) => saveStaffPerm(u.id, k, v)} withDefault />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
      {msg && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#111", color: "#fff", padding: "9px 18px", borderRadius: 999, fontSize: 14, zIndex: 50 }}>{msg}</div>}
    </div>
  );
}
