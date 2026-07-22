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
  // Keep in sync with MANAGER_POWER_FLAGS in lib/ownerEntitlements.ts — these two were
  // missing, so the admin couldn't gate them at all (audit 2026-07-08).
  ["edit_settings", "Edit settings"], ["view_ratings", "See & handle ratings"],
  // Table types + khata module (mig 166).
  ["table_tags", "Mark table types + on-the-house"], ["khata", "Pay later (khata) book"],
];
// Owner-panel SECTIONS the admin can remove per restaurant (mig 133). Off = the
// section disappears from the real owner's panel (admin act-as still sees it, tinted).
const OWNER_SECTIONS: [string, string][] = [
  ["reports", "Reports"], ["staff", "Staff & powers"], ["issues", "Feedback & issues"],
  // Keep in sync with OWNER_SECTION_KEYS in lib/ownerEntitlements.ts (can't import it —
  // that's a server module). These three were missing, so the admin couldn't turn them
  // off for a restaurant even though the backend supports it (audit 2026-07-08).
  ["ratings", "Ratings"], ["customers", "Customers list"], ["settings", "Settings (appearance & password)"],
];
const TABLET_CAPS: [string, string][] = [["tablet_discount", "Apply discount"], ["tablet_mark_paid", "Mark bill paid"], ["tablet_invoice", "Generate invoice"], ["tablet_table_tags", "Mark table types"], ["tablet_khata", "Park pay-later (khata) bills"], ["tablet_table_ops", "Table & KOT operations"]];
// The feature LADDER's two admin switches per module (owner rule 2026-07-22):
// "application" = the feature on/off itself; "power transfer" = may the OWNER
// toggle it from their own panel. Keys = settings columns (mig 166).
const LADDER_MODULES: { app: string; transfer: string; label: string; hint: string }[] = [
  { app: "table_tags_allowed", transfer: "table_tags_owner_control", label: "Table types (VIP / Family / Guest) + Khata", hint: "Special table marks, on-the-house settle, and the pay-later book." },
];
const TRI: [string, string][] = [["off", "Off"], ["on", "On"], ["pin", "On · PIN"]];
// The KOT ▾ menu's single admin knob (mig 164): feature on/off AND how far down the
// ladder it may go. Each deeper rung still needs the rung above it to grant it on.
const TABLE_OPS_DEPTHS: [string, string][] = [
  ["off", "Off (nobody)"], ["owner", "Owner panel only"], ["manager", "Owner + Manager"], ["tablet", "Owner + Manager + Tablet"],
];

// Small pure UI atoms — hoisted to module scope (defining them inside the page
// body recreated them every render; the react-hooks/static-components lint
// rightly errors on that).
// Switch sized closer to the iOS 51×31 standard so it's comfortable to tap on a
// phone (was 44×26 — a touch short; admin mobile audit 2026-07-07).
const Toggle = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
    style={{ width: 50, height: 30, borderRadius: 999, border: "1px solid var(--ac-line, #d8cdb8)", background: on ? "var(--ac-accent, #c98f3f)" : "var(--ac-off, #e6dcc9)", position: "relative", cursor: "pointer", transition: "background .15s", flex: "none" }}>
    <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.3)" }} />
  </button>
);
const Tri = ({ val, onChange, withDefault }: { val: string; onChange: (v: string) => void; withDefault?: boolean }) => (
  <select value={val} onChange={(e) => onChange(e.target.value)}
    style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--ac-line,#d8cdb8)", background: "var(--ac-card,#fff)", color: "inherit", fontSize: 13.5, cursor: "pointer" }}>
    {withDefault && <option value="default">Default</option>}
    {TRI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);
const Card = ({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) => (
  <section id={id} style={{ background: "var(--ac-card,#fff)", border: "1px solid var(--ac-line,#e6dcc9)", borderRadius: 10, padding: "16px 18px", marginBottom: 12 }}>
    <h3 style={{ margin: "0 0 4px", fontSize: 14.5 }}>{title}</h3>
    {hint && <p style={{ margin: "0 0 12px", color: "var(--ac-muted,#857655)", fontSize: 12.5, lineHeight: 1.5 }}>{hint}</p>}
    {children}
  </section>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--ac-line,#f0e9dc)" }}>
    <span style={{ fontSize: 13.5 }}>{label}</span>{children}
  </div>
);

export default function AccessPage() {
  const [rests, setRests] = useState<Rest[]>([]);
  // Deep-link support (X-ray "open setting" jumps land here): ?rid=<id> preselects
  // the restaurant, ?focus=<card-id> scrolls to + pulses that card after load.
  const [linked] = useState<{ rid: string | null; focus: string | null }>(() =>
    typeof window === "undefined" ? { rid: null, focus: null }
    : { rid: new URLSearchParams(window.location.search).get("rid"), focus: new URLSearchParams(window.location.search).get("focus") });
  const [rid, setRid] = useState<string>("");
  const [panels, setPanels] = useState<Record<string, boolean>>({});
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [manager, setManager] = useState<Record<string, boolean>>({});
  const [owner, setOwner] = useState<Record<string, boolean>>({});
  const [tablet, setTablet] = useState<Record<string, string>>({});
  const [ladder, setLadder] = useState<Record<string, boolean>>({}); // module switches (access route `features`, mig 166)
  const [tableOpsDepth, setTableOpsDepth] = useState<string>("off"); // KOT ▾ menu depth knob (mig 164→167)
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Error flags so a failed load NEVER silently falls back to defaults (every toggle would
  // read ON because `{}` means "no overrides = default on"), showing a fake all-configured
  // screen; and so a failed restaurant-list fetch shows a retry instead of a blank page
  // (audit 2026-07-07).
  const [listErr, setListErr] = useState(false);
  const [loadErr, setLoadErr] = useState(false);

  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 1800); };

  // Load the restaurant list once.
  const loadList = useCallback(() => {
    setListErr(false);
    fetch("/api/admin/restaurants").then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((d) => {
      if (d.error) { setListErr(true); return; }
      const list: Rest[] = d.restaurants || [];
      setRests(list);
      const wanted = linked.rid && list.some((r) => r.id === linked.rid) ? linked.rid : "";
      if (list.length && !rid) setRid(wanted || list[0].id);
    }).catch(() => setListErr(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadList(); }, [loadList]);

  // Load everything for the selected restaurant.
  const loadRestaurant = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true); setLoadErr(false);
    try {
      const responses = await Promise.all([
        fetch(`/api/admin/restaurants/panels?restaurant_id=${id}`),
        fetch(`/api/admin/restaurants/features?restaurant_id=${id}`),
        fetch(`/api/admin/restaurants/access?restaurant_id=${id}`),
        // ?rid= scopes the fetch server-side to this restaurant's OWNER portfolio (a few
        // restaurants) instead of ALL tenants — the admin branch ignored ?restaurant_id=
        // and returned every restaurant's staff just to render one restaurant's overrides
        // (egress; audit 2026-07-06). The client filter below narrows to this exact id.
        fetch(`/api/owner/staff?rid=${id}`),
      ]);
      // If ANY control-state fetch failed, surface an error rather than rendering defaults
      // (which would look like every panel/feature is ON when we simply couldn't load them).
      if (responses.slice(0, 3).some((r) => !r.ok)) { setLoadErr(true); return; }
      const [p, f, a, s] = await Promise.all(responses.map((r) => r.json().catch(() => ({}))));
      if (p.error || f.error || a.error) { setLoadErr(true); return; }
      setPanels(p.panels || {});
      setFeatures(f.features || {});
      setManager(a.manager || {});
      setOwner(a.owner || {});
      setTablet(a.tablet || {});
      setLadder(a.features || {});
      setTableOpsDepth(a.tableOpsDepth || "off");
      setStaff((s.staff || []).filter((u: Staff) => u.restaurant_id === id && u.role !== "owner"));
    } catch { setLoadErr(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (rid) loadRestaurant(rid); }, [rid, loadRestaurant]);

  // After a deep-linked load, scroll to the named card and pulse it once.
  useEffect(() => {
    if (loading || !linked.focus || !rid) return;
    const el = document.getElementById(`ac-${linked.focus}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "box-shadow .3s";
    el.style.boxShadow = "0 0 0 4px rgba(217,119,6,.55)";
    const t = setTimeout(() => { el.style.boxShadow = ""; }, 2200);
    return () => clearTimeout(t);
  }, [loading, rid, linked.focus]);

  // Savers — each optimistic, then persist. On failure we reload the truth.
  const savePanel = async (panel: string, enabled: boolean) => {
    setPanels((x) => ({ ...x, [panel]: enabled }));
    const r = await fetch("/api/admin/restaurants/panels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, panel, enabled }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };
  const saveFeature = async (key: string, value: boolean) => {
    setFeatures((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, key, value }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };
  const saveManager = async (key: string, value: boolean) => {
    setManager((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, manager: { [key]: value } }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };
  const saveOwner = async (key: string, value: boolean) => {
    setOwner((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, owner: { [key]: value } }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };
  const saveTableOpsDepth = async (value: string) => {
    setTableOpsDepth(value);
    const r = await fetch("/api/admin/restaurants/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, tableOpsDepth: value }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };
  const saveTablet = async (key: string, value: string) => {
    setTablet((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, tablet: { [key]: value } }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };
  const saveLadder = async (key: string, value: boolean) => {
    setLadder((x) => ({ ...x, [key]: value }));
    const r = await fetch("/api/admin/restaurants/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, features: { [key]: value } }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };
  const saveStaffPerm = async (userId: string, key: string, value: string) => {
    setStaff((list) => list.map((u) => u.id === userId ? { ...u, permissions: { ...(u.permissions || {}), [key]: value } } : u));
    // "default" clears the override (null) so the user inherits the restaurant-wide setting.
    const perm = value === "default" ? null : value;
    // set_permissions is a per-id action → PATCH. POST is the create-new-staff handler
    // and rejects this body ("Name must be at least 2 characters"), so the override
    // never saved (found 2026-07-06). PATCH dispatches on `action` correctly.
    const r = await fetch("/api/owner/staff", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: userId, action: "set_permissions", permissions: { [key]: perm } }) });
    if (r.ok) toast("Saved"); else { toast("Failed"); loadRestaurant(rid); }
  };

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

      {listErr && rests.length === 0 && (
        <div style={{ color: "var(--ac-muted,#857655)", padding: 20 }}>Couldn&rsquo;t load restaurants. <button onClick={loadList} style={{ marginLeft: 8, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--ac-line,#d8cdb8)", background: "var(--ac-card,#fff)", color: "inherit", cursor: "pointer" }}>Retry</button></div>
      )}
      {loading && <div style={{ color: "var(--ac-muted,#857655)", padding: 20 }}>Loading…</div>}
      {!loading && loadErr && rid && (
        <div style={{ color: "var(--ac-muted,#857655)", padding: 20 }}>Couldn&rsquo;t load this restaurant&rsquo;s settings — the switches below are hidden so you don&rsquo;t see a wrong state. <button onClick={() => loadRestaurant(rid)} style={{ marginLeft: 8, padding: "6px 12px", borderRadius: 8, border: "1px solid var(--ac-line,#d8cdb8)", background: "var(--ac-card,#fff)", color: "inherit", cursor: "pointer" }}>Retry</button></div>
      )}
      {!loading && !loadErr && rid && (
        <>
          <Card id="ac-panels" title="Panels" hint="Which staff apps this restaurant can use. Turning one off blocks that role's login.">
            {PANELS.map(([k, l]) => <Row key={k} label={l}><Toggle on={panels[k] !== false} onChange={(v) => savePanel(k, v)} /></Row>)}
          </Card>
          <Card id="ac-owner-panel" title="Owner panel sections" hint="Which sections exist in this restaurant's OWNER panel. Off = the section disappears for the real owner (you still see it, tinted, when viewing as admin).">
            {OWNER_SECTIONS.map(([k, l]) => <Row key={k} label={l}><Toggle on={owner[k] !== false} onChange={(v) => saveOwner(k, v)} /></Row>)}
          </Card>
          <Card id="ac-modules" title="Modules — the feature ladder" hint="Per module, the admin's TWO switches (owner rule): 'on' = the feature exists for this restaurant at all; 'owner controls' = hand the on/off power to the owner (the toggle then appears in their panel). Below that, the owner→manager and manager→tablet rungs still apply.">
            {LADDER_MODULES.map((m) => (
              <Row key={m.app} label={m.label}>
                <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ac-muted,#857655)" }}>
                    on <Toggle on={ladder[m.app] === true} onChange={(v) => saveLadder(m.app, v)} />
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ac-muted,#857655)", opacity: ladder[m.app] === true ? 1 : 0.45 }}
                    title="Transfer the on/off power to the owner — their panel gains the toggle">
                    owner controls <Toggle on={ladder[m.transfer] === true} onChange={(v) => saveLadder(m.transfer, v)} />
                  </label>
                </span>
              </Row>
            ))}
          </Card>
          <Card id="ac-manager-powers" title="Manager powers" hint="The ladder, per power: 'exists' = you allow this restaurant the power AT ALL (off = the toggle disappears from the owner's panel and the power dies for managers). 'granted' = what the owner has currently given their managers.">
            {MANAGER_POWERS.map(([k, l]) => {
              const exists = owner[`power_${k}`] !== false;
              return (
                <Row key={k} label={l}>
                  <span style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ac-muted,#857655)" }}>
                      exists <Toggle on={exists} onChange={(v) => saveOwner(`power_${k}`, v)} />
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ac-muted,#857655)", opacity: exists ? 1 : 0.45 }}
                      title={exists ? "What the owner granted their managers" : "Removed by admin — the owner can't see or grant this power"}>
                      granted <Toggle on={manager[k] === true} onChange={(v) => saveManager(k, v)} />
                    </label>
                  </span>
                </Row>
              );
            })}
          </Card>
          <Card id="ac-table-ops" title="Table & KOT operations (KOT menu)"
            hint="The KOT ▾ menu on a table: change table, merge tables, move a KOT or a single dish, split the bill. ONE knob sets whether the feature exists and how deep it may go; each deeper rung still needs the rung above to switch it on (owner grants the manager below; the MANAGER grants the tablet from their panel's Access settings — or you can flip it in the tablet card).">
            <Row label="Who may have it">
              <select value={tableOpsDepth} onChange={(e) => saveTableOpsDepth(e.target.value)}
                style={{ padding: "9px 10px", borderRadius: 8, border: "1px solid var(--ac-line,#d8cdb8)", background: "var(--ac-card,#fff)", color: "inherit", fontSize: 13.5, cursor: "pointer" }}>
                {TABLE_OPS_DEPTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
            <Row label="Granted to managers (owner's rung)">
              <span style={{ opacity: ["manager", "tablet"].includes(tableOpsDepth) ? 1 : 0.45 }}
                title={["manager", "tablet"].includes(tableOpsDepth) ? "What the owner granted their managers" : "Raise the depth to Owner + Manager first"}>
                <Toggle on={manager.table_ops === true} onChange={(v) => saveManager("table_ops", v)} />
              </span>
            </Row>
          </Card>
          <Card id="ac-tablet" title="Tablet (waiter) billing" hint="What the waiter tablet may do to a bill. 'On · PIN' requires a manager PIN each time. 'Table & KOT operations' only takes effect when its ladder knob above reaches Owner + Manager + Tablet.">
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
