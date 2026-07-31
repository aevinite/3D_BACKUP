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
import RestaurantSettings from "@/components/admin/RestaurantSettings";
import TicketCard, { type TicketLike } from "@/components/admin/TicketCard";
import { useBackClose } from "@/lib/backStack";
import { useToast } from "@/components/admin/toast";
import { adminFetch } from "@/lib/adminFetch";

// Render brand text in the live preview: *marked* parts use the accent colour,
// the rest the mode's text colour — exactly how the guest menu renders it.
function previewParts(text: string, textColor: string, accentColor: string) {
  return splitBrandSegments(text).map((seg, i) => (
    <span key={i} style={{ color: seg.hi ? accentColor : textColor }}>{seg.text}</span>
  ));
}
const stripMarkers = (s: string) => stripBrandMarkers(s);

type Restaurant = { id: string; slug: string; name: string; active: boolean; createdAt: string | null; hasSettings: boolean; ownerUserId: string | null; ownerName: string | null };
type Owner = { id: string; name: string };
// Activity health per restaurant (from /api/admin/restaurants/health, mig 146). Signals
// only, no money — the admin panel never shows earnings.
type Health = { last_order_at: string | null; orders_24h: number; open_issues: number; staff_online: number };

// Turn the raw signals into a one-word status + colour. "Healthy" = busy now (staff online
// or an order in the last 24h); "Quiet" = ordered within a week; "Dormant" = nothing for 7+
// days (or never); "Suspended" = the restaurant is turned off.
function healthStatus(active: boolean, h: Health | undefined, createdAt?: string | null): { label: string; color: string; note: string } {
  if (!active) return { label: "Suspended", color: "var(--muted)", note: "turned off" };
  if (!h) return { label: "—", color: "var(--muted)", note: "" };
  if (h.staff_online > 0 || h.orders_24h > 0) {
    const bits = [h.orders_24h > 0 ? `${h.orders_24h} order${h.orders_24h === 1 ? "" : "s"}/24h` : "", h.staff_online > 0 ? `${h.staff_online} online` : ""].filter(Boolean);
    return { label: "Healthy", color: "var(--adm-ok)", note: bits.join(" · ") };
  }
  const last = h.last_order_at ? Date.now() - new Date(h.last_order_at).getTime() : Infinity;
  if (last <= 7 * 86400000) {
    const days = Math.floor(last / 86400000);
    return { label: "Quiet", color: "#d4a574", note: days <= 0 ? "ordered today" : `last order ${days}d ago` };
  }
  // Never ordered but only just set up → "New" (not a problem — don't alarm). Neutral blue.
  const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity;
  if (!h.last_order_at && ageMs <= 14 * 86400000) {
    return { label: "New", color: "#60a5fa", note: "just added — no orders yet" };
  }
  // Long-quiet is INFORMATIONAL, not an emergency — muted grey, never danger-red (audit 2026-07-08).
  return { label: "Dormant", color: "var(--muted)", note: h.last_order_at ? "no orders in 7+ days" : "no orders yet" };
}

// The seeded default restaurant (#1) — can never be deleted (matches the API + SQL guards).
const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";

// (The guest-feature and staff-app lists that used to live here are gone with their
// toggle grids — both are Access & permissions now, which is the only screen that
// owns a permission. Keeping copies here is how two screens start disagreeing.)

export default function AdminRestaurants() {
  const toast = useToast();
  const [list, setList] = useState<Restaurant[] | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [healthFilter, setHealthFilter] = useState<"all" | "Healthy" | "Quiet" | "New" | "Dormant" | "Suspended">("all");
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
    // The topbar switcher fires this when it targets a restaurant. Needed for the case where
    // we're ALREADY on this page: router.push only changes ?focus and doesn't remount, so the
    // mount read above never re-runs — without this, picking a restaurant did nothing.
    const onFocus = (e: Event) => { const slug = (e as CustomEvent<string>).detail; if (slug) setFocusSlug(slug); };
    window.addEventListener("adm:focus-restaurant", onFocus);
    return () => window.removeEventListener("adm:focus-restaurant", onFocus);
  }, []);
  // Opening a restaurant's DETAIL puts ?focus=<slug> in the address bar, so a REFRESH comes
  // back to the same restaurant instead of dumping the admin on the list and making them find
  // the row again (owner, 2026-07-30: "whenever I refresh it takes me back to the restaurant
  // [list] — it should keep me on the same page"). The ?focus= reader below already knew how to
  // reopen a detail; nothing was ever WRITING it when you simply clicked a row.
  // replaceState, not pushState: this page's own back arrow owns the history, and pushing would
  // make the browser's Back button look like it did nothing.
  const writeFocusUrl = (slug: string | null) => {
    try {
      const u = new URL(window.location.href);
      if (slug) u.searchParams.set("focus", slug);
      else { u.searchParams.delete("focus"); u.searchParams.delete("tab"); }
      window.history.replaceState(window.history.state, "", u.pathname + u.search);
    } catch {}
  };
  const openRestaurant = (r: Restaurant) => { writeFocusUrl(r.slug); setSelected(r); };

  // Going BACK has to clear ?focus= as well, or a refresh from the list would bounce you into
  // a detail you'd just left. Clearing it inside onBack is NOT enough: the detail registers with
  // the back-stack (useBackClose), so leaving it can run history.back(), whose popstate lands
  // AFTER our replaceState and restores the URL that still had ?focus=. So the address bar is
  // re-synced from what is actually on screen — on every change AND after any history move.
  // `hadDetail` is what stops this from eating its own homework: on MOUNT `selected` is still
  // null (the list has to load before ?focus= can be matched to a row), so an ungated "no
  // selection → strip the URL" effect wipes ?focus and ?tab a beat BEFORE the page reads them —
  // which silently undid the whole refresh fix. Only clear once a detail has actually been shown.
  const selectedRef = useRef<Restaurant | null>(null);
  selectedRef.current = selected;
  const hadDetail = useRef(false);
  useEffect(() => {
    if (selected) { hadDetail.current = true; return; }
    if (hadDetail.current) writeFocusUrl(null);
  }, [selected]);
  useEffect(() => {
    const sync = () => { if (!selectedRef.current && hadDetail.current) writeFocusUrl(null); };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (!focusSlug || !list) return;
    // Matched by slug (the original contract) OR id — the panels' "zones off" dropdown
    // only knows its ?rid pin (a uuid), not the slug (owner 2026-07-28).
    const hit = list.find((r) => r.slug === focusSlug || r.id === focusSlug);
    if (hit) { setSelected(hit); setFocusSlug(null); return; } // consume it — Back shows the plain list
    const el = document.getElementById(`rest-row-${focusSlug}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusSlug, list]);

  // Load the restaurant list once (and again when we come back from a detail view
  // so a freshly-created settings row + owner assignment show their latest state).
  const loadList = useCallback(async () => {
    // Shared helper: never fails silently — a load error pops a toast instead of leaving the
    // list stuck/blank with no explanation.
    const res = await adminFetch<{ restaurants?: Restaurant[]; owners?: Owner[] }>("/api/admin/restaurants");
    if (res.ok) { setList(res.data.restaurants || []); setOwners(res.data.owners || []); }
    else toast("Couldn't load restaurants — " + res.error, "err");
  }, [toast]);
  useEffect(() => { loadList(); }, [loadList]);

  // Health signals for all restaurants — one aggregated call (mig 146). Loaded once
  // alongside the list; a failure just leaves the badges as "—" (never blocks the list).
  const loadHealth = useCallback(async () => {
    const res = await adminFetch<{ health?: (Health & { restaurant_id: string })[] }>("/api/admin/restaurants/health");
    if (res.ok) {
      const map: Record<string, Health> = {};
      for (const h of res.data.health || []) map[h.restaurant_id] = h;
      setHealth(map);
    }
  }, []);
  useEffect(() => { loadHealth(); }, [loadHealth]);

  if (selected) {
    // Re-read the freshest copy from the list so the owner shows correctly after a round-trip.
    const fresh = (list || []).find((r) => r.id === selected.id) || selected;
    return <RestaurantDetail key={fresh.id} restaurant={fresh} owners={owners}
      onBack={() => { writeFocusUrl(null); setSelected(null); loadList(); }} onChanged={loadList} />;
  }

  const needle = q.trim().toLowerCase();
  const rows = (list || []).filter((r) => {
    if (needle && !(r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle))) return false;
    if (healthFilter !== "all" && healthStatus(r.active, health[r.id], r.createdAt).label !== healthFilter) return false;
    return true;
  });
  // Counts per health bucket for the filter chips (so the admin sees at a glance how many
  // restaurants are dormant, etc.).
  const healthCounts = (list || []).reduce((acc, r) => {
    const l = healthStatus(r.active, health[r.id], r.createdAt).label;
    acc[l] = (acc[l] || 0) + 1; return acc;
  }, {} as Record<string, number>);

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

        {/* Health filter chips — one tap to see e.g. only the dormant restaurants. */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
          {([
            ["all", "All", "var(--text)"],
            ["Healthy", "Healthy", "var(--adm-ok)"],
            ["Quiet", "Quiet", "#d4a574"],
            ["New", "New", "#60a5fa"],
            ["Dormant", "Dormant", "var(--muted)"],
            ["Suspended", "Suspended", "var(--muted)"],
          ] as const).map(([key, lbl, col]) => {
            const on = healthFilter === key;
            const count = key === "all" ? (list?.length ?? 0) : (healthCounts[key] || 0);
            return (
              <button key={key} onClick={() => setHealthFilter(key)} className="adm-chip"
                style={{ cursor: "pointer", padding: "7px 12px", border: on ? `1px solid ${col}` : "var(--border)",
                  background: on ? `color-mix(in srgb, ${col} 18%, transparent)` : "transparent",
                  color: on ? col : "var(--muted)", fontWeight: on ? 700 : 500 }}>
                {key !== "all" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: col, display: "inline-block", marginRight: 6 }} />}
                {lbl} <span style={{ opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}
        </div>

        {list === null ? (
          <div className="adm-empty">Loading restaurants…</div>
        ) : rows.length === 0 ? (
          <div className="adm-empty">{needle || healthFilter !== "all" ? "No restaurants match this filter." : "No restaurants yet."}</div>
        ) : (
          <div className="adm-logwrap">
            <div className="adm-logrow head" style={{ gridTemplateColumns: "1.2fr 0.9fr 1fr 96px 80px 80px" }}>
              <span>Name</span><span>Slug</span><span>Owner</span><span>Health</span><span>Status</span><span style={{ textAlign: "right" }}>Open</span>
            </div>
            {rows.map((r) => (
              <button
                key={r.id}
                id={`rest-row-${r.slug}`}
                className="adm-logrow"
                onClick={() => openRestaurant(r)}
                style={{
                  gridTemplateColumns: "1.2fr 0.9fr 1fr 96px 80px 80px", width: "100%", border: 0, color: "var(--text)", cursor: "pointer", textAlign: "left", font: "inherit",
                  // The ?focus= row gets a quiet accent highlight so the eye lands on it.
                  background: focusSlug === r.slug ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                  boxShadow: focusSlug === r.slug ? "inset 2px 0 0 var(--accent)" : undefined,
                }}
                title={`Open ${r.name}`}
              >
                <span style={{ fontWeight: 700 }}>{r.name}</span>
                <span className="adm-muted" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{r.slug}</span>
                <span className="adm-muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ownerName || "—"}</span>
                {(() => {
                  const hs = healthStatus(r.active, health[r.id], r.createdAt);
                  return (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }} title={hs.note}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: hs.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, color: hs.color, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hs.label}</span>
                      {health[r.id]?.open_issues ? <span className="adm-chip" title={`${health[r.id].open_issues} open issue(s)`} style={{ background: "color-mix(in srgb, var(--adm-danger) 18%, transparent)", color: "var(--adm-danger)", fontSize: 10, padding: "1px 6px" }}>{health[r.id].open_issues}</span> : null}
                    </span>
                  );
                })()}
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

// ＋ New restaurant — create a restaurant in one go: name, panels, sample menu, AND its
// full ACCESS setup (owner sections, modules, manager powers, tablet caps). Whatever the
// admin picks is REMEMBERED (app_config, mig 186) and auto-fills the next create form
// (owner 2026-07-24). The backend mints one starter login per ENABLED panel (shown ONCE).
type Access = { owner: Record<string, boolean>; manager: Record<string, boolean>; tablet: Record<string, "off" | "on" | "pin">; features: Record<string, boolean> };
const NR_PANELS = [
  { key: "manager", label: "Manager panel" }, { key: "kitchen", label: "Kitchen display" },
  { key: "tablet", label: "Waiter tablet" }, { key: "owner", label: "Owner dashboard" },
] as const;
const SYS_PANELS: Record<string, boolean> = { manager: true, kitchen: true, tablet: true, owner: false };
const NR_OWNER_SECTIONS = [["menu", "Menu"], ["reports", "Reports"], ["staff", "Staff & powers"], ["issues", "Feedback & issues"], ["ratings", "Ratings"], ["customers", "Customers"], ["settings", "Settings"]] as const;
const NR_MGR_POWERS = [["manage_staff", "Manage staff"], ["edit_menu", "Edit menu"], ["give_discounts", "Give discounts"], ["view_dashboard", "View dashboard"], ["void_bills", "Void / delete bills"], ["edit_settings", "Edit settings"], ["view_ratings", "View ratings"], ["table_tags", "Table types"], ["khata", "Pay Later (khata)"], ["banquet", "Banquet billing"], ["table_ops", "Table & KOT ops"], ["take_orders", "Take orders"], ["parcel", "Parcel / takeaway"], ["platform", "Platform board"]] as const;
const NR_MODULES = [["table_tags", "Table types + Pay Later"], ["banquet", "Banquet billing"], ["table_ops", "Table & KOT operations"], ["take_orders", "Take orders (manager)"], ["parcel", "Parcel / takeaway"], ["platform", "Platform (Zomato / Swiggy)"]] as const;
const NR_TABLET_CAPS = [["tablet_discount", "Discounts"], ["tablet_mark_paid", "Mark paid"], ["tablet_invoice", "Invoice"], ["tablet_banquet", "Banquet"], ["tablet_table_tags", "Table types"], ["tablet_khata", "Pay Later"], ["tablet_table_ops", "Table & KOT ops"], ["tablet_take_orders", "Take orders"], ["tablet_parcel", "Parcel"]] as const;
const NR_MP_DEFAULT: Record<string, boolean> = { manage_staff: false, edit_menu: true, give_discounts: true, view_dashboard: true, void_bills: false, edit_settings: false, view_ratings: false, table_tags: false, khata: false, banquet: false, table_ops: false, take_orders: false, parcel: true, platform: true };
const NR_TABLET_DEFAULT: Record<string, "off" | "on" | "pin"> = { tablet_discount: "off", tablet_mark_paid: "off", tablet_invoice: "off", tablet_banquet: "off", tablet_table_tags: "off", tablet_khata: "off", tablet_table_ops: "off", tablet_take_orders: "on", tablet_parcel: "off" };
// The SYSTEM defaults for a brand-new restaurant (matches lib/settingsClone + MP_DEFAULT +
// owner absent=ON). All owner sections + power switches on; modules off; grants = MP_DEFAULT.
function systemAccess(): Access {
  const owner: Record<string, boolean> = {};
  for (const [k] of NR_OWNER_SECTIONS) owner[k] = true;
  for (const [k] of NR_MGR_POWERS) owner["power_" + k] = true;
  const features: Record<string, boolean> = {};
  for (const [m] of NR_MODULES) { features[m + "_allowed"] = false; features[m + "_owner_control"] = false; }
  features.parcel_allowed = true; // parcel is ON for the manager by default (owner 2026-07-26)
  return { owner, manager: { ...NR_MP_DEFAULT }, tablet: { ...NR_TABLET_DEFAULT }, features };
}
// Merge a (possibly partial) saved access blob over the system defaults, so a missing key
// always falls back to a sane default — the form never renders an undefined toggle.
function mergeAccess(saved: Partial<Access> | undefined | null): Access {
  const base = systemAccess();
  if (!saved || typeof saved !== "object") return base;
  return {
    owner: { ...base.owner, ...(saved.owner || {}) },
    manager: { ...base.manager, ...(saved.manager || {}) },
    tablet: { ...base.tablet, ...(saved.tablet || {}) },
    features: { ...base.features, ...(saved.features || {}) },
  };
}

function NewRestaurant({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [panels, setPanels] = useState<Record<string, boolean>>({ ...SYS_PANELS });
  const [seedMenu, setSeedMenu] = useState(true);
  const [access, setAccess] = useState<Access>(() => systemAccess());
  const [preset, setPreset] = useState<"saved" | "system">("system");
  const [saved, setSaved] = useState<{ panels?: Record<string, boolean>; seedMenu?: boolean; access?: Partial<Access> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; slug: string; logins: { panel: string; username: string; password: string }[]; loginErrors?: string[]; menuSeeded?: boolean; seedError?: string | null } | null>(null);
  const creatingRef = useRef(false); // sync double-submit guard (bug #12)

  // On open, load the admin's remembered setup and auto-fill from it (editable). First
  // time (no saved row) → system defaults. One scoped admin read; only while the card is open.
  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      try {
        const d = await (await fetch("/api/admin/restaurants/create-defaults", { cache: "no-store" })).json();
        if (!live) return;
        if (d?.defaults) {
          setSaved(d.defaults);
          setPreset("saved");
          setPanels({ ...SYS_PANELS, ...(d.defaults.panels || {}) });
          setSeedMenu(d.defaults.seedMenu !== false);
          setAccess(mergeAccess(d.defaults.access));
        } else { setPreset("system"); setAccess(systemAccess()); }
      } catch { /* fall back to the system defaults already in state */ }
    })();
    return () => { live = false; };
  }, [open]);

  const applyPreset = (p: "saved" | "system") => {
    setPreset(p);
    if (p === "system") { setPanels({ ...SYS_PANELS }); setSeedMenu(true); setAccess(systemAccess()); }
    else if (saved) { setPanels({ ...SYS_PANELS, ...(saved.panels || {}) }); setSeedMenu(saved.seedMenu !== false); setAccess(mergeAccess(saved.access)); }
  };
  const slugPreview = (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "restaurant";
  const setPanel = (k: string) => setPanels((s) => ({ ...s, [k]: !s[k] }));
  const setOwner = (k: string) => setAccess((a) => ({ ...a, owner: { ...a.owner, [k]: !a.owner[k] } }));
  const setManager = (k: string) => setAccess((a) => ({ ...a, manager: { ...a.manager, [k]: !a.manager[k] } }));
  const setFeature = (k: string) => setAccess((a) => ({ ...a, features: { ...a.features, [k]: !a.features[k] } }));
  const setTablet = (k: string, v: "off" | "on" | "pin") => setAccess((a) => ({ ...a, tablet: { ...a.tablet, [k]: v } }));

  const create = async () => {
    if (creatingRef.current) return;
    if (name.trim().length < 2) { setMsg("Enter a name (at least 2 characters)."); return; }
    if (!Object.values(panels).some(Boolean)) { setMsg("Turn on at least one panel."); return; }
    creatingRef.current = true;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_restaurant", name: name.trim(), panels, seedMenu, access, saveDefaults: true }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't create the restaurant.");
      setDone({ name: d.name, slug: d.slug, logins: d.logins || [], loginErrors: d.loginErrors || [], menuSeeded: d.menuSeeded, seedError: d.seedError });
      // Remember locally too so the very next open pre-fills instantly, and mark preset "saved".
      setSaved({ panels, seedMenu, access }); setPreset("saved"); setName("");
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

  // Small building blocks (kept inline so the create card owns its own look).
  const Tog = ({ on, k, label, onClick }: { on: boolean; k: string; label: string; onClick: () => void }) => (
    <button key={k} type="button" className={`adm-toggle ${on ? "on" : "off"}`} disabled={busy} onClick={onClick}
      title={on ? "On — tap to turn off" : "Off — tap to turn on"}>
      <span>{label}</span><span className="pill">{on ? "ON" : "OFF"}</span>
    </button>
  );
  const Tri = ({ cap, label }: { cap: string; label: string }) => {
    const val = access.tablet[cap] || "off";
    return (
      <div className="nr-row">
        <span className="nr-row-label">{label}</span>
        <span className="nr-tri">
          {(["off", "on", "pin"] as const).map((o) => (
            <button key={o} type="button" disabled={busy} onClick={() => setTablet(cap, o)}
              className={`nr-seg ${val === o ? "sel" : ""}`}>{o === "off" ? "Off" : o === "on" ? "On" : "PIN"}</button>
          ))}
        </span>
      </div>
    );
  };
  const groupCount = (entries: readonly (readonly [string, string])[], on: (k: string) => boolean) => entries.filter(([k]) => on(k)).length;

  return (
    <div className="adm-card nr-card" style={{ marginBottom: 14 }}>
      <h2>New restaurant</h2>
      <p className="hint">Set it up in one go — name, panels, sample menu, and its access. Whatever you pick is remembered and pre-fills the next restaurant you create. One starter login is made per panel you turn on (passwords show once).</p>

      {/* BASICS */}
      <div className="nr-sec">
        <div className="nr-sec-h">Basics</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Restaurant name" disabled={busy} className="nr-input" />
        <div className="nr-slug">Guest link: <code>/r/{slugPreview}/menu</code></div>
        <div className="adm-togglegrid" style={{ marginTop: 8 }}>
          <Tog on={seedMenu} k="seed" label="Start with sample menu" onClick={() => setSeedMenu((v) => !v)} />
        </div>
      </div>

      {/* PANELS */}
      <div className="nr-sec">
        <div className="nr-sec-h">Panels</div>
        <div className="adm-togglegrid">
          {NR_PANELS.map((p) => <Tog key={p.key} on={panels[p.key] === true} k={p.key} label={p.label} onClick={() => setPanel(p.key)} />)}
        </div>
      </div>

      {/* ACCESS */}
      <div className="nr-sec">
        <div className="nr-sec-h" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>Access &amp; permissions</span>
          <select className="nr-preset" disabled={busy} value={preset} onChange={(e) => applyPreset(e.target.value as "saved" | "system")}>
            {saved && <option value="saved">My saved setup</option>}
            <option value="system">System defaults</option>
          </select>
          {preset === "saved" && saved && <span className="adm-muted" style={{ fontSize: 11.5 }}>pre-filled from your last restaurant — edit anything</span>}
        </div>

        <details className="nr-grp"><summary>Owner panel sections <em>· {groupCount(NR_OWNER_SECTIONS, (k) => access.owner[k])}/{NR_OWNER_SECTIONS.length} on</em></summary>
          <div className="adm-togglegrid">
            {NR_OWNER_SECTIONS.map(([k, l]) => <Tog key={k} on={access.owner[k]} k={k} label={l} onClick={() => setOwner(k)} />)}
          </div>
        </details>

        <details className="nr-grp"><summary>Modules <em>· {groupCount(NR_MODULES, (m) => access.features[m + "_allowed"])}/{NR_MODULES.length} on</em></summary>
          <div className="nr-mod-list">
            {NR_MODULES.map(([m, l]) => (
              <div key={m} className="nr-mod">
                <div className="nr-mod-name">{l}</div>
                <Tog on={access.features[m + "_allowed"]} k={m + "_a"} label="On" onClick={() => setFeature(m + "_allowed")} />
                <Tog on={access.features[m + "_owner_control"]} k={m + "_c"} label="Owner controls" onClick={() => setFeature(m + "_owner_control")} />
              </div>
            ))}
          </div>
        </details>

        <details className="nr-grp"><summary>Manager powers <em>· {groupCount(NR_MGR_POWERS, (k) => access.manager[k])} granted</em></summary>
          <div className="nr-mod-list">
            {NR_MGR_POWERS.map(([k, l]) => (
              <div key={k} className="nr-mod">
                <div className="nr-mod-name">{l}</div>
                <Tog on={access.owner["power_" + k]} k={k + "_ex"} label="Exists" onClick={() => setOwner("power_" + k)} />
                <Tog on={access.manager[k]} k={k + "_gr"} label="Granted" onClick={() => setManager(k)} />
              </div>
            ))}
          </div>
        </details>

        <details className="nr-grp"><summary>Waiter tablet abilities <em>· {NR_TABLET_CAPS.filter(([k]) => (access.tablet[k] || "off") !== "off").length}/{NR_TABLET_CAPS.length} on</em></summary>
          <div style={{ display: "grid", gap: 2 }}>
            {NR_TABLET_CAPS.map(([k, l]) => <Tri key={k} cap={k} label={l} />)}
          </div>
        </details>
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
function StatusCard({ restaurant }: { restaurant: Restaurant }) {
  const [err, setErr] = useState<string | null>(null);
  // Per-restaurant "we'll be right back" maintenance (settings.service_mode). Moved here from
  // the platform Settings page so it works for EVERY restaurant, not just the flagship #1
  // (audit 2026-07-08). The guest menu honours each restaurant's own service_mode (lib/menu.ts).
  const [maint, setMaint] = useState<boolean | null>(null);
  const [mBusy, setMBusy] = useState(false);
  const [maintErr, setMaintErr] = useState(false);
  const [maintReload, setMaintReload] = useState(0);
  useEffect(() => {
    let dead = false;
    setMaintErr(false);
    fetch(`/api/admin/maintenance?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((j) => { if (dead) return; if (typeof j.maintenance === "boolean") setMaint(j.maintenance); else setMaintErr(true); })
      // Don't swallow a failed load: leaving maint=null used to show a false green "Live" chip +
      // a stuck "…" button with no error. Flag it so the chip reads "Status unknown" + a Retry shows.
      .catch(() => { if (!dead) setMaintErr(true); });
    return () => { dead = true; };
  }, [restaurant.id, maintReload]);
  const toggleMaint = async () => {
    if (maint === null) return;
    const on = !maint;
    if (on && !window.confirm(`Put ${restaurant.name}'s guest menu into "we'll be right back" maintenance?\n\nGuests can't browse or order until you turn it back on. Staff panels keep working.`)) return;
    setMBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on, restaurant_id: restaurant.id }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't change maintenance.");
      setMaint(d.maintenance === true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setMBusy(false); }
  };
  const statusLabel = !restaurant.active ? "Suspended" : maint === true ? "In maintenance" : maint === false ? "Live" : maintErr ? "Status unknown" : "Checking…";
  const statusStyle = !restaurant.active
    ? { background: "color-mix(in srgb, var(--adm-danger) 22%, transparent)", color: "var(--adm-danger)" }
    : maint === true
      ? { background: "color-mix(in srgb, var(--adm-warn) 22%, transparent)", color: "var(--adm-warn)" }
      : maint === false
        ? { background: "color-mix(in srgb, var(--adm-ok) 22%, transparent)", color: "var(--adm-ok)" }
        : { background: "var(--muted2)", color: "var(--muted)" }; // unknown / still checking — not a confident green "Live"
  return (
    <div className="adm-card" style={{ marginBottom: 14, ...(restaurant.active ? {} : { borderColor: "var(--adm-danger)" }) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="adm-chip" style={statusStyle}>{statusLabel}</span>
        <span style={{ flex: 1, fontSize: 13 }} className="adm-muted">
          {!restaurant.active
            ? "Suspended — the guest menu is offline. Staff panels stay reachable to you via the buttons below."
            : maint === true
              ? "In maintenance — guests see a “we’ll be right back” screen. Staff panels keep working."
              : maint === false
                ? "Guests can open this restaurant's menu."
                : maintErr
                  ? "Couldn't check the menu's status just now — use Retry."
                  : "Checking the menu's status…"}
        </span>
        {err && <span style={{ color: "var(--adm-danger)", fontSize: 12.5 }}>{err}</span>}
        {!restaurant.active && <span className="adm-muted" style={{ fontSize: 12 }}>Reactivate in the danger zone below.</span>}
      </div>
      {restaurant.active && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "var(--border)" }}>
          <span className="adm-muted" style={{ flex: 1, fontSize: 12.5, minWidth: 180 }}>Maintenance — a soft &ldquo;we&rsquo;ll be right back&rdquo; pause (staff panels keep working), lighter than Suspend.</span>
          {maintErr ? (
            <button className="adm-btn" onClick={() => setMaintReload((n) => n + 1)} title="Couldn't check maintenance — try again">
              <i className="fas fa-rotate-right" style={{ marginRight: 7 }} aria-hidden="true" />Retry
            </button>
          ) : (
            <button className={maint ? "adm-btn primary" : "adm-btn"} disabled={mBusy || maint === null} onClick={toggleMaint}>
              <i className={`fas ${maint ? "fa-play" : "fa-pause"}`} style={{ marginRight: 7 }} aria-hidden="true" />
              {maint === null ? "…" : maint ? "Bring menu back online" : "Take menu offline"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Tickets card at the TOP of a restaurant's detail view — the issues its staff raised
// (manager/kitchen/tablet), newest first, resolvable inline. Defaults to OPEN tickets;
// a toggle reveals resolved history. Scoped read: ?restaurant_id= narrows the admin's
// all-restaurant issues feed to this one restaurant (the server enforces the scope).
function RestaurantTickets({ restaurantId }: { restaurantId: string }) {
  const [tickets, setTickets] = useState<(TicketLike & { status: string })[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    setErr(false);
    fetch(`/api/owner/issues?scope=all&restaurant_id=${encodeURIComponent(restaurantId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.error) setErr(true); else setTickets(j.issues || []); })
      .catch(() => setErr(true));
  }, [restaurantId]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: "resolved" | "open") => {
    setBusy(id);
    setTickets((prev) => (prev || []).map((t) => (t.id === id ? { ...t, status } : t))); // optimistic
    try {
      const r = await fetch("/api/owner/issues?scope=all", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }),
      });
      if (!r.ok) load();
    } catch { load(); }
    finally { setBusy(null); }
  };

  const open = (tickets || []).filter((t) => t.status === "open");
  const resolved = (tickets || []).filter((t) => t.status === "resolved");
  const shown = showResolved ? [...open, ...resolved] : open;

  // COMPACT when there's nothing to act on: no big empty "no tickets 🎉" box — just a slim
  // all-clear line (owner 2026-07-24: "why is the empty box there"). The full card only
  // appears when there ARE open tickets, or when the admin expands the resolved history.
  if (tickets !== null && !err && open.length === 0 && !showResolved) {
    return (
      <div className="adm-card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10, padding: "12px 16px" }}>
        <i className="fas fa-circle-check" style={{ color: "var(--adm-ok, #16a34a)" }} aria-hidden="true" />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>No open issues</span>
        {resolved.length > 0
          ? <button className="adm-btn" style={{ marginLeft: "auto", padding: "5px 10px", fontSize: 12 }} onClick={() => setShowResolved(true)}>Show resolved ({resolved.length})</button>
          : <span className="adm-muted" style={{ marginLeft: "auto", fontSize: 12 }}>staff reported nothing</span>}
      </div>
    );
  }

  return (
    <div className="adm-card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>
          <i className="fas fa-flag" style={{ marginRight: 8, color: "var(--adm-danger, #e5484d)" }} aria-hidden="true" />
          Tickets {open.length > 0 && <span className="adm-chip" style={{ marginLeft: 6 }}>{open.length} open</span>}
        </h2>
        {resolved.length > 0 && (
          <button className="adm-btn" style={{ marginLeft: "auto", padding: "6px 11px", fontSize: 12.5 }} onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide resolved" : `Show resolved (${resolved.length})`}
          </button>
        )}
      </div>
      <p className="hint">Problems this restaurant&apos;s staff reported from the manager, kitchen or waiter tablet.</p>
      {tickets === null ? (
        <div className="adm-empty">Loading tickets…</div>
      ) : err ? (
        <div className="adm-empty">Couldn&rsquo;t load tickets. <button className="adm-btn" style={{ marginLeft: 8 }} onClick={load}>Retry</button></div>
      ) : shown.length === 0 ? (
        <div className="adm-empty">No open tickets for this restaurant. 🎉</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((t) => (
            <TicketCard key={t.id} issue={t} busy={busy === t.id} onSetStatus={(id, status) => setStatus(id, status)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Quick on/off for a restaurant's MAIN operational features (platform, banquet), a
// shortcut so you don't have to open the full Access screen for the common ones (owner
// 2026-07-25). Each switch shows/sets the EFFECTIVE state (is it actually live for staff) and
// writes the SAME settings columns the Access screen reads — so the two are always in sync
// (single source of truth; no duplicated value). Fine-tune the full ladder in Access below.
// NOTE: auto-print KOT is NOT here — it lives ONLY in the Settings tab's "KOT printing"
// section (owner 2026-07-26). Having it in both places showed two toggles that shared one
// saved value but not one on-screen state, so they looked out of sync — one control now.
function RestaurantDetail({ restaurant, owners, onBack, onChanged }: { restaurant: Restaurant; owners: Owner[]; onBack: () => void; onChanged: () => void }) {
  const [panels, setPanels] = useState<Record<string, boolean> | null>(null);
  // Per-switch in-flight set: toggling ONE switch disables only THAT switch. The old single
  // (The per-switch in-flight tracker went with the toggle grids — this page has no
  // switches left to disable while a save is in flight.)
  // Which staff-feature help screenshot is zoomed full-size (null = none).
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  // "Full report" (owner's words: "every single bit" of ONE restaurant) swaps the
  // whole detail view for its own report — its own component, own data load —
  // instead of cramming another card into an already-long page.
  const [showReport, setShowReport] = useState(false);
  // A tiny toast so a failed toggle tells the admin instead of silently snapping back
  // (or, worse, getting stuck showing the wrong ON/OFF state). Mirrors the Access page.
  const [toast, setToast] = useState<string | null>(null);
  // Overview vs ⚙ Settings tab (owner 2026-07-26): information & actions stay on
  // Overview; everything configurable (features, review, branding, billing, KOT,
  // sessions, tables & QR) lives together under Settings.
  const [tab, setTab] = useState<"overview" | "settings">("overview");
  // Which TAB you were on survives a refresh too — landing back on Overview after reloading
  // while editing Settings is the same "lost my place" complaint (owner, 2026-07-30).
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get("tab") === "settings") setTab("settings"); } catch {}
  }, []);
  const goTab = (t: "overview" | "settings") => {
    setTab(t);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", t);
      window.history.replaceState(window.history.state, "", u.pathname + u.search);
    } catch {}
  };

  // …and so does the SCROLL position ("same page and same scroll level"). Kept in
  // sessionStorage per restaurant + tab: it's per-tab-of-the-browser, dies when the tab
  // closes, and never touches the database.
  useEffect(() => {
    const key = `adm:rest-scroll:${restaurant.id}:${tab}`;
    // The admin's scrollport is NOT the window: it's `.adm-main` on desktop and `.adm` on a
    // phone (verified in-browser at 390px, where the document itself doesn't scroll at all —
    // so a window.scrollTo fallback silently did nothing there). Same pair useAdminModal
    // freezes when a dialog opens; pick whichever is actually scrolling right now.
    const scrolls = (el: HTMLElement | null): el is HTMLElement => !!el && el.scrollHeight > el.clientHeight + 4;
    const port = (): HTMLElement | null => {
      for (const sel of [".adm-main", ".adm"]) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (scrolls(el)) return el;
      }
      return null;
    };
    const readTop = () => { const p = port(); return p ? p.scrollTop : window.scrollY; };
    const writeTop = (v: number) => { const p = port(); if (p) p.scrollTop = v; else window.scrollTo(0, v); };

    // RESTORE. The cards below fetch their own data, so the page keeps GROWING for a second or
    // two after mount — one scrollTop on mount would land short. Re-apply briefly, and abandon
    // it the instant the admin scrolls themselves so we never fight a real gesture.
    let stop = false;
    const giveUp = () => { stop = true; };
    let want = 0;
    try { want = Number(sessionStorage.getItem(key) || 0); } catch {}
    const gestures = ["wheel", "touchstart", "keydown"] as const;
    if (want > 0) {
      gestures.forEach((e) => window.addEventListener(e, giveUp, { passive: true }));
      const deadline = Date.now() + 2000;
      const tick = () => {
        if (stop || Date.now() > deadline) return;
        writeTop(want);
        window.setTimeout(tick, 120);
      };
      window.setTimeout(tick, 60);
    }

    // REMEMBER (debounced — scrolling fires continuously).
    let t: number | undefined;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => { try { sessionStorage.setItem(key, String(readTop())); } catch {} }, 150);
    };
    // Listen on BOTH candidates plus the window: which one scrolls depends on the width, and
    // the page can still be growing when this runs, so we don't try to pick just one here.
    const targets: (HTMLElement | Window)[] = [
      ...([".adm-main", ".adm"].map((sel) => document.querySelector(sel)).filter(Boolean) as HTMLElement[]),
      window,
    ];
    targets.forEach((el) => el.addEventListener("scroll", onScroll, { passive: true }));
    return () => {
      stop = true;
      window.clearTimeout(t);
      targets.forEach((el) => el.removeEventListener("scroll", onScroll));
      gestures.forEach((e) => window.removeEventListener(e, giveUp));
    };
  }, [restaurant.id, tab]);
  // ?tab=settings deep-link (owner 2026-07-28): the panels' "zones off" dropdown sends the
  // admin here for admin-only settings (billing/KOT/sessions/table count). Post-mount, not
  // in the initializer, so SSR and first paint stay identical (no hydration mismatch).
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get("tab") === "settings") setTab("settings"); } catch {}
  }, []);
  // Stable (useCallback) so the loaders below can list it as a dep without refetching every render.
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); }, []);

  // Phone hardware Back peels one layer at a time instead of leaving the admin page
  // (CLAUDE.md back-button rule): the image zoom → the full report → the detail view → list.
  // Registered top-down; the back-stack pops whichever is on top first.
  useBackClose("admin-rest-detail", true, onBack);
  useBackClose("admin-rest-report", showReport, () => setShowReport(false));
  useBackClose("admin-rest-zoom", !!zoomImg, () => setZoomImg(null));
  // Escape also closes the image zoom (it had no keyboard way out before — audit 2026-07-07).
  useEffect(() => {
    if (!zoomImg) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setZoomImg(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomImg]);

  // Deep-link to a section: arriving with ?section=features|status|… (e.g. from the Repair
  // page's "Feature switches" / "Maintenance mode" quick levers) scrolls straight to that
  // card instead of dumping the admin at the top of a long page and making them hunt for it
  // (owner 2026-07-23: "Feature switches takes me to the restaurant, not to the features").
  // The card headers render synchronously (only their inner data is async), so the anchor
  // exists on first paint; rAF lets layout settle before we scroll.
  useEffect(() => {
    let section = "";
    try { section = new URLSearchParams(window.location.search).get("section") || ""; } catch {}
    if (!section) return;
    // Consume the param immediately so a LATER detail (open a different restaurant after
    // going Back) doesn't re-read this stale section and auto-scroll unexpectedly. Strip
    // only `section`, keeping `focus` and the path intact (replaceState = no history entry).
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("section");
      window.history.replaceState(history.state, "", u.pathname + u.search);
    } catch {}
    // Sections that moved into the ⚙ Settings tab: switch the tab first, then scroll
    // once that tab's cards have rendered (one tick later).
    const inSettings = ["review", "main-features", "branding", "billing", "kitchen", "sessions", "tables"].includes(section);
    if (inSettings) setTab("settings");
    const scroll = () => {
      const el = document.getElementById(`det-${section}`);
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    if (inSettings) setTimeout(scroll, 120);
    else requestAnimationFrame(scroll);
  }, []);

  // These loaders now announce a failure (flash) instead of silently swallowing it — a failed
  // load leaves the switches disabled, so without a message you couldn't tell why (audit 2026-07-07).
  const loadPanels = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/admin/restaurants/panels?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
      if (!j.error) setPanels(j.panels || {}); else flash("Couldn't load panels.");
    } catch { flash("Couldn't load panels."); }
  }, [restaurant.id, flash]);
  useEffect(() => { loadPanels(); }, [loadPanels]);

  // (The staff-feature entitlement read that used to live here went with the "Main features"
  // card — those switches are Access & permissions → Main features now, and fetching them
  // here would have been a request whose answer nothing on this page renders.)

  // (The panel on/off switches moved to Access & permissions → Staff apps with the rest
  // of the permissions. `panels` is still read above because the Enter card needs to know
  // which apps exist before offering a door into them.)

  if (showReport) {
    return <RestaurantReport restaurantId={restaurant.id} restaurantName={restaurant.name} onBack={() => setShowReport(false)} />;
  }

  return (
    <>
      {toast && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 1002, background: "var(--adm-danger, #e5484d)", color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,0,0,0.25)" }}>{toast}</div>
      )}
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Access & permissions is its OWN screen (owner 2026-07-23) reached by a button
              from here, not shown inline. Carries ?rid so Access preselects this restaurant;
              &from=rest lets its breadcrumb come back to this detail view. */}
          <a className="adm-btn" href={`/aevinite/access?rid=${restaurant.id}&from=rest`}
            title={`Manage who can do what at ${restaurant.name}`}>
            <i className="fas fa-user-shield" style={{ marginRight: 7 }} aria-hidden="true" />Access &amp; permissions
          </a>
          <button className="adm-btn" onClick={() => setShowReport(true)} title={`Every usage figure for ${restaurant.name}`}>
            <i className="fas fa-file-lines" style={{ marginRight: 7 }} aria-hidden="true" />Full report
          </button>
        </div>
      </div>

      {/* Overview vs ⚙ Settings (owner 2026-07-26): "normal information" stays on Overview;
          everything changeable — features, Google review, branding, billing, KOT printing,
          dining sessions, tables & QR — lives together under Settings. */}
      <div className="adm-dettabs" role="tablist" aria-label="Restaurant detail tabs">
        <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "on" : ""} onClick={() => goTab("overview")}>
          <i className="fas fa-gauge" aria-hidden="true" style={{ marginRight: 7 }} />Overview
        </button>
        <button role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "on" : ""} onClick={() => goTab("settings")}>
          <i className="fas fa-sliders" aria-hidden="true" style={{ marginRight: 7 }} />Settings
        </button>
      </div>

      {tab === "overview" ? (
        <>
          <RestaurantTickets restaurantId={restaurant.id} />

          <div id="det-status"><StatusCard restaurant={restaurant} /></div>

          <div id="det-owner"><OwnerCard restaurant={restaurant} owners={owners} onChanged={onChanged} /></div>

          <div id="det-enter"><EnterCard restaurant={restaurant} panels={panels} /></div>

          {/* Panels, guest features, manager powers, tablet caps and per-person overrides ALL
              live in the ONE Access & permissions panel (owner 2026-07-24: "merge the two
              systems"). A single link = single source of truth, no stale duplicate toggles. */}
          <div id="det-access-link" className="adm-card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Panels, features &amp; permissions</div>
              <p className="hint" style={{ margin: "3px 0 0" }}>Which staff apps this restaurant has · its guest-menu features · special features (banquet, auto-print…) · manager powers · tablet capabilities · per-person overrides — all in one place.</p>
            </div>
            <a className="adm-btn primary" href={`/aevinite/access?rid=${restaurant.id}&from=rest`}>
              <i className="fas fa-user-shield" style={{ marginRight: 7 }} aria-hidden="true" />Open Access &amp; permissions
            </a>
          </div>

          <DangerCard restaurant={restaurant} onDeleted={onBack} onChanged={onChanged} />
        </>
      ) : (
        <>
          {/* Quick jump chips — scrollable on phones, so any section is one tap away. */}
          <div className="adm-setchips" aria-label="Jump to a settings section">
            {([
              // "Features" and "Google review" left this page in the access rebuild (owner,
              // 2026-07-31): the restaurant detail carries NO permissions or feature switches
              // at all — they live in Access & permissions, so exactly one screen owns them.
              ["det-branding", "fa-palette", "Branding"],
              ["det-billing", "fa-file-invoice", "Billing"],
              ["det-kitchen", "fa-print", "KOT printing"],
              ["det-sessions", "fa-qrcode", "Sessions"],
              ["det-tables", "fa-chair", "Tables & QR"],
            ] as const).map(([id, icon, label]) => (
              <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })}>
                <i className={`fas ${icon}`} aria-hidden="true" />{label}
              </button>
            ))}
          </div>

          {/* NO permissions or feature switches on this page (owner, 2026-07-31). The
              "Main features" quick card and the Google-review picker moved into Access &
              permissions — Main features and Menu → Ratings — so a feature is never
              switchable from two screens that can disagree with each other. */}
          <div id="det-branding"><BrandingCard restaurant={restaurant} /></div>

          {/* Billing · KOT printing · Dining sessions · Tables & QR — the four sections moved
              from the manager panel (same fields, admin skin). */}
          <RestaurantSettings restaurant={{ id: restaurant.id, slug: restaurant.slug, name: restaurant.name }} />
        </>
      )}
    </>
  );
}

// DangerCard — move a restaurant to the 90-day RECYCLE BIN. Distinct from Suspend:
// suspend just hides the guest menu (reversible instantly, staff/admin keep working);
// DELETE puts the whole restaurant in the bin (guest 404 + staff logins blocked) and
// starts a 90-day clock, after which it can be permanently purged from the bin. To
// make an accidental delete near-impossible, the admin must TYPE the exact name to
// confirm (the GitHub pattern). Restaurant #1 (default) can never be deleted.
function DangerCard({ restaurant, onDeleted, onChanged }: { restaurant: Restaurant; onDeleted: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [susBusy, setSusBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isDefault = restaurant.id === DEFAULT_RID;
  const nameMatches = confirmName.trim() === restaurant.name.trim();

  // Suspend / reactivate lives here now (owner 2026-07-24: suspend belongs at the BOTTOM,
  // not the top). Delete is gated behind a SUSPENDED restaurant — you must suspend first.
  const setActive = async (active: boolean) => {
    if (!active && !window.confirm(`Suspend ${restaurant.name}?\n\nIts guest menu goes OFFLINE immediately (staff panels stay reachable to you via act-as). You can reactivate any time.`)) return;
    setSusBusy(true); setErr(null);
    try {
      const r = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_restaurant_active", restaurant_id: restaurant.id, active }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't change the status.");
      onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setSusBusy(false); }
  };

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

      {/* 1) Suspend / reactivate — the reversible one, first. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingBottom: 14, marginBottom: 14, borderBottom: "var(--border)" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{restaurant.active ? "Suspend this restaurant" : "Restaurant is suspended"}</div>
          <p className="hint" style={{ margin: "3px 0 0" }}>{restaurant.active
            ? "Takes the guest menu offline immediately. Staff panels stay reachable to you. Instantly reversible — nothing is erased."
            : "The guest menu is offline and staff can't log in. Reactivate any time, or delete it below."}</p>
        </div>
        {restaurant.active
          ? <button className="adm-btn danger" disabled={susBusy} onClick={() => setActive(false)}><i className="fas fa-power-off" style={{ marginRight: 7 }} aria-hidden="true" />{susBusy ? "Suspending…" : "Suspend…"}</button>
          : <button className="adm-btn primary" disabled={susBusy} onClick={() => setActive(true)}><i className="fas fa-play" style={{ marginRight: 7 }} aria-hidden="true" />{susBusy ? "…" : "Reactivate"}</button>}
      </div>

      {/* 2) Delete — only after suspending (owner rule 2026-07-24). */}
      <p className="hint">
        Delete <b>{restaurant.name}</b> — it moves to the <b>recycle bin for 90 days</b>. Its guest menu goes offline and
        staff can&apos;t log in, but nothing is erased. You can <b>restore</b> it any time in those 90 days; only after that can it be
        permanently removed.
      </p>
      {restaurant.active ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button className="adm-btn danger" disabled title="Suspend the restaurant first" style={{ opacity: 0.5, cursor: "not-allowed" }}>
            <i className="fas fa-trash-can" style={{ marginRight: 7 }} aria-hidden="true" />Delete restaurant…
          </button>
          <span className="adm-muted" style={{ fontSize: 12.5 }}>Suspend the restaurant first — then you can delete it.</span>
        </div>
      ) : !open ? (
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
// <input type="color"> only accepts 6-digit hex; expand #abc → #aabbcc so a valid 3-digit
// value doesn't make the swatch snap to black (audit 2026-07-07).
const toColorInput = (v: string) => /^#[0-9a-fA-F]{3}$/.test(v) ? "#" + v.slice(1).split("").map((c) => c + c).join("") : v;

function BrandingCard({ restaurant }: { restaurant: Restaurant }) {
  const toast = useToast();
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [theme, setTheme] = useState<{ dark: Record<string, string>; light: Record<string, string> }>({ dark: {}, light: {} });
  const [hero, setHero] = useState(""); const [tagline, setTagline] = useState(""); const [logoText, setLogoText] = useState("");
  const [accent, setAccent] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false); const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  // Guard: only allow Save once the current branding actually LOADED. A failed load
  // left every field blank; saving then wrote those blanks over the real values,
  // wiping the restaurant's whole look (audit 2026-07-08). No successful load = no save.
  const [brandLoaded, setBrandLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      // Announces a failure via the shared toast instead of swallowing it — a failed load left
      // the branding fields blank with no explanation (audit 2026-07-07).
      try {
        const r = await fetch(`/api/admin/restaurants/branding?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (r.ok && !j.error) {
          const t = j.theme || {};
          setTheme({ dark: { ...(t.dark || {}) }, light: { ...(t.light || {}) } });
          setHero(j.hero_title || ""); setTagline(j.tagline || ""); setLogoText(j.logo_text || ""); setAccent(j.accent_color || ""); setLogoUrl(j.logo_url || null);
          setBrandLoaded(true); // load succeeded → Save is now safe (can't blank a populated restaurant)
        } else {
          toast("Couldn't load branding — " + (j.error || "try reopening."), "err");
        }
      } catch { toast("Couldn't load branding — network error.", "err"); }
    })();
  }, [restaurant.id, toast]);

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
    if (!brandLoaded) { setMsg("Branding hasn't loaded yet — reopen this restaurant before saving (so a glitch can't blank it)."); return; }
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
              <input type="color" value={toColorInput((cur[f.key] && HEX_RE.test(cur[f.key])) ? cur[f.key] : pv[f.key])} disabled={busy}
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
        <button className="adm-btn primary" disabled={busy || !brandLoaded} onClick={save}><i className="fas fa-check" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Saving…" : "Save branding"}</button>
        {!brandLoaded && <span className="adm-muted" style={{ fontSize: 12 }}>Couldn&apos;t load current branding — reopen this restaurant before saving.</span>}
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
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New owner username"
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
      const w = await openRestaurantPanel(restaurant.id, path);
      if (w) setViewing(true);
      else setMsg("Couldn't open the panel tab — allow pop-ups for this site, then try again.");
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setMsg(null);
    try {
      await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
      setViewing(false); setMsg("Stopped — reopen a panel from here when you need it again.");
    } finally { setBusy(false); }
  };

  const grpLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 8px" };
  return (
    <div className="adm-card" style={{ marginBottom: 14 }}>
      <h2>Open &amp; manage this restaurant</h2>
      <p className="hint">Open <b>{restaurant.name}</b> exactly as its guests and staff see it, or manage its people. Each opens in a new tab.</p>

      {/* Group 1 — open the restaurant's own screens (act-as). */}
      <div style={grpLabel}>Open as this restaurant</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {restaurant.active ? (
          <a className="adm-btn primary" href={`/r/${restaurant.slug}/menu`} target="_blank" rel="noopener" title={`Open ${restaurant.name}'s guest menu`}>
            <i className="fas fa-utensils" style={{ marginRight: 7 }} aria-hidden="true" />Guest menu
          </a>
        ) : (
          <button className="adm-btn" disabled title="The guest menu is offline while this restaurant is suspended — reactivate it in the danger zone below.">
            <i className="fas fa-utensils" style={{ marginRight: 7 }} aria-hidden="true" />Guest menu offline
          </button>
        )}
        {panelOn("owner") && (
          <button className="adm-btn" disabled={busy} onClick={() => openPanel("/owner")} title={`Open ${restaurant.name}'s owner dashboard`}>
            <i className="fas fa-crown" style={{ marginRight: 7 }} aria-hidden="true" />Owner dashboard
          </button>
        )}
        {PANELS.filter(([, , , k]) => panelOn(k)).map(([path, label, icon]) => (
          <button key={path} className="adm-btn" disabled={busy} onClick={() => openPanel(path)} title={`Open ${label} as ${restaurant.name}`}>
            <i className={`fas ${icon}`} style={{ marginRight: 7 }} aria-hidden="true" />{label}
          </button>
        ))}
      </div>

      {/* Group 2 — its people. */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "var(--border)" }}>
        <div style={grpLabel}>Its people</div>
        <a className="adm-btn" href="/aevinite/users" title="Create or manage staff, managers & owners">
          <i className="fas fa-user-plus" style={{ marginRight: 7 }} aria-hidden="true" />Manage staff &amp; create users
        </a>
      </div>

      {/* The "stop" control only appears once you're actually viewing panels as this
          restaurant — otherwise it's a confusing button that seems to do nothing. */}
      {viewing && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 14, paddingTop: 14, borderTop: "var(--border)" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--adm-ok)" }}>
            <i className="fas fa-eye" style={{ marginRight: 6 }} aria-hidden="true" />You&apos;re viewing panels as {restaurant.name}.
          </span>
          <button className="adm-btn" disabled={busy} onClick={stop} title="Return to your normal admin view (already-open panel tabs stay pinned)">
            <i className="fas fa-arrow-rotate-left" style={{ marginRight: 7 }} aria-hidden="true" />Stop viewing as this restaurant
          </button>
        </div>
      )}
      {msg && <div className="adm-muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
