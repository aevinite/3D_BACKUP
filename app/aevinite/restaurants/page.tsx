"use client";
// Admin · Restaurants — the multi-tenant super-panel. Lists EVERY restaurant on
// this backend (searchable by name/slug); pick one to edit ITS guest-feature
// switches. Each switch writes to that restaurant's own settings.features row
// (scoped by restaurant_id), so the change shows ONLY on that restaurant's guest
// menu (/r/<slug>/menu). Mirrors the single-restaurant Features tab's UI + the
// .adm-* styling, parameterised by restaurant.
import { useCallback, useEffect, useRef, useState } from "react";
import { openRestaurantPanel } from "@/components/admin/shared";
import RestaurantReport from "@/components/admin/RestaurantReport";
import CredentialsCard from "@/components/admin/CredentialsCard";
import { CopyButton } from "@/components/admin/CopyButton";
import TicketCard, { type TicketLike } from "@/components/admin/TicketCard";
import { useBackClose } from "@/lib/backStack";
import { useToast } from "@/components/admin/toast";
import { adminFetch } from "@/lib/adminFetch";


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

      {/* The live slugs, so the guest-link preview can show the address the server will really
          mint rather than the one the typed name suggests (see slugPreview below). */}
      <NewRestaurant onCreated={loadList} takenSlugs={(list || []).map((r) => r.slug)} />

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
                {/* AN OWNER WHO CANNOT SIGN IN IS STILL AN OWNER (T16 sweep, 2026-08-19).
                    /api/admin/restaurants only lists ACTIVE owners, and a suspended one — or one
                    in the recycle bin, which always goes through suspend first — is therefore not
                    in that list, so `ownerName` came back "—" and this column read exactly like a
                    restaurant nobody owns. The Owners page already went to the trouble of naming a
                    binned primary holder for this very reason; this column had the same hole. */}
                {(() => {
                  const known = r.ownerUserId ? owners.find((o) => o.id === r.ownerUserId) : null;
                  const label = !r.ownerUserId ? "—" : known ? known.name : "assigned · not active";
                  return (
                    <span className="adm-muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={r.ownerUserId && !known ? "This restaurant has an owner, but that account is suspended or in the recycle bin — open Owners to see who." : undefined}>
                      {label}
                    </span>
                  );
                })()}
                {(() => {
                  const hs = healthStatus(r.active, health[r.id], r.createdAt);
                  return (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }} title={hs.note}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: hs.color, flexShrink: 0 }} />
                      <span className="hue-ink" style={{ ["--hue" as string]: hs.color, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hs.label}</span>
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

// ＋ New restaurant — create a restaurant in one go: name, panels, sample menu. Whatever the
// admin picks is REMEMBERED (app_config, mig 186) and auto-fills the next create form
// (owner 2026-07-24). The backend mints one starter login per ENABLED panel (shown ONCE).
//
// ── THE ACCESS BLOCK LEFT THIS FORM (sweep T6, 2026-08-06) ──────────────────────────────
// It used to carry a whole second permissions screen: "Modules · On / Owner controls",
// 14 manager powers × "Exists / Granted", seven owner sections and nine waiter tri-states —
// the 4-rung ladder docs/ACCESS-MODEL.md deleted as a concept. Three things were wrong with
// it, and all three are fixed by simply not sending any of it:
//
//   1. THE WAITER PRESET WAS PRE-MIGRATION-295. It shipped tablet_table_ops / _table_tags /
//      _khata / _parcel / _banquet = "off", and the create route spreads what the form sends
//      OVER cleanClonedSettings — so every new restaurant was born with the exact fault
//      migration 295 exists to repair: a waiter who cannot move a table, mark its type, use
//      khata, punch a counter parcel or bill a banquet, with five switches to find by hand.
//   2. IT SEEDED view_ratings: false while the model's own answer is TRUE, so a new
//      restaurant's managers were born with no Rating review tab. (verify-access-model
//      guards MP_DEFAULT for exactly this drift; the form's hand-typed copy overrode it.)
//   3. FOUR owner sections (reports / issues / customers / settings) and every power_<flag>
//      could ONLY be set here — they have no row on Access, and the server honours them, so
//      one untick left the Access screen showing a row ON while a manager was refused, with
//      nothing able to put it back.
//
// Sending nothing lands a new restaurant on exactly the state the model documents:
// manager_permissions absent → MANAGER_GRANT_DEFAULTS · owner_entitlements absent → all on ·
// settings → lib/settingsClone (money caps off, floor caps on, modules off). Permissions are
// set on ONE screen, after creation: /aevinite/access.
const NR_PANELS = [
  { key: "manager", label: "Manager panel" }, { key: "kitchen", label: "Kitchen display" },
  { key: "tablet", label: "Waiter tablet" }, { key: "owner", label: "Owner dashboard" },
] as const;
const SYS_PANELS: Record<string, boolean> = { manager: true, kitchen: true, tablet: true, owner: false };

// The create card's two building blocks.
//
// They MUST live out here, not inside NewRestaurant's body. A component declared during render is
// a NEW component type on every render, so React throws the old subtree away and mounts a fresh
// one — every keystroke in "Restaurant name" was remounting all seven toggles and both access
// rows, losing focus and restarting their transitions. eslint reports it as an error
// ("Cannot create components during render"), which is why the lint step now has to pass:
// the same mistake elsewhere in the owner panel wiped text while it was being typed (PR #762).
function Tog({ on, k, label, onClick, busy }: { on: boolean; k: string; label: string; onClick: () => void; busy: boolean }) {
  return (
    <button key={k} type="button" className={`adm-toggle ${on ? "on" : "off"}`} disabled={busy} onClick={onClick}
      title={on ? "On — tap to turn off" : "Off — tap to turn on"}>
      <span>{label}</span><span className="pill">{on ? "ON" : "OFF"}</span>
    </button>
  );
}

function NewRestaurant({ onCreated, takenSlugs }: { onCreated: () => void; takenSlugs: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [panels, setPanels] = useState<Record<string, boolean>>({ ...SYS_PANELS });
  const [seedMenu, setSeedMenu] = useState(true);
  const [preset, setPreset] = useState<"saved" | "system">("system");
  const [saved, setSaved] = useState<{ panels?: Record<string, boolean>; seedMenu?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<{ id?: string; name: string; slug: string; logins: { panel: string; username: string; password: string }[]; loginErrors?: string[]; menuSeeded?: boolean; seedError?: string | null } | null>(null);
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
        } else { setPreset("system"); }
      } catch { /* fall back to the system defaults already in state */ }
    })();
    return () => { live = false; };
  }, [open]);

  const applyPreset = (p: "saved" | "system") => {
    setPreset(p);
    if (p === "system") { setPanels({ ...SYS_PANELS }); setSeedMenu(true); }
    else if (saved) { setPanels({ ...SYS_PANELS, ...(saved.panels || {}) }); setSeedMenu(saved.seedMenu !== false); }
  };
  // THE PREVIEW HAS TO BE THE ADDRESS THAT WILL ACTUALLY EXIST (T16 sweep, 2026-08-19).
  //
  // It used to be the bare slug of the typed name, but the create route makes the slug unique with
  // a numeric suffix when a LIVE restaurant already holds it (a binned one no longer reserves the
  // name, mig 319). So the form promised "/r/aangan/menu", the restaurant was minted as
  // "aangan-2", and the admin had already read the wrong address off the screen - the address that
  // goes on printed QR codes. Same loop as the server's, over the slugs already on this page.
  const slugBase = (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "restaurant";
  const slugTaken = new Set(takenSlugs);
  let slugPreview = slugBase;
  for (let i = 2; slugTaken.has(slugPreview); i++) slugPreview = `${slugBase}-${i}`;
  const slugSuffixed = slugPreview !== slugBase;
  const setPanel = (k: string) => setPanels((s) => ({ ...s, [k]: !s[k] }));

  const create = async () => {
    if (creatingRef.current) return;
    if (name.trim().length < 2) { setMsg("Enter a name (at least 2 characters)."); return; }
    if (!Object.values(panels).some(Boolean)) { setMsg("Turn on at least one panel."); return; }
    creatingRef.current = true;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/restaurants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        // NO `access` KEY (sweep T6, 2026-08-06 — see the note above NR_PANELS). Sending nothing
        // is what makes the route fall through to MP_DEFAULT + cleanClonedSettings, which ARE the
        // model's documented new-restaurant state. Permissions are set on /aevinite/access after.
        body: JSON.stringify({ action: "create_restaurant", name: name.trim(), panels, seedMenu, saveDefaults: true }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't create the restaurant.");
      setDone({ id: d.id, name: d.name, slug: d.slug, logins: d.logins || [], loginErrors: d.loginErrors || [], menuSeeded: d.menuSeeded, seedError: d.seedError });
      // Remember locally too so the very next open pre-fills instantly, and mark preset "saved".
      setSaved({ panels, seedMenu }); setPreset("saved"); setName("");
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
    <div className="adm-card nr-card" style={{ marginBottom: 14 }}>
      <h2>New restaurant</h2>
      <p className="hint">Set it up in one go — name, panels, sample menu. Whatever you pick is remembered and pre-fills the next restaurant you create. One starter login is made per panel you turn on (passwords show once). It starts on the standard permissions; change them on Access &amp; permissions once it exists.</p>

      {/* BASICS */}
      <div className="nr-sec">
        {/* The preset picker lives HERE, not under the Access heading (sweep T6, 2026-08-06):
            it only chooses which PANELS and whether a sample menu is seeded now that this form
            sets no permissions, and a control named "System defaults" sitting under "Access &
            permissions" would read as picking a permission set that no longer exists. */}
        <div className="nr-sec-h" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>Basics</span>
          <select className="nr-preset" disabled={busy} value={preset} onChange={(e) => applyPreset(e.target.value as "saved" | "system")}>
            {saved && <option value="saved">My saved setup</option>}
            <option value="system">System defaults</option>
          </select>
          {preset === "saved" && saved && <span className="adm-muted" style={{ fontSize: 11.5 }}>panels and sample menu pre-filled from your last restaurant</span>}
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Restaurant name" disabled={busy} className="nr-input" />
        <div className="nr-slug">Guest link: <code>/r/{slugPreview}/menu</code></div>
        {slugSuffixed && (
          <div className="hint" style={{ margin: "4px 0 0", color: "var(--adm-warn, #d97706)" }}>
            <i className="fas fa-circle-info" style={{ marginRight: 6 }} aria-hidden="true" />
            <b>/r/{slugBase}/menu</b> is already in use, so this one gets <b>{slugPreview}</b>. That is the address
            its QR codes will carry &mdash; rename it now if you&rsquo;d rather have a different one.
          </div>
        )}
        <div className="adm-togglegrid" style={{ marginTop: 8 }}>
          <Tog on={seedMenu} k="seed" label="Start with sample menu" onClick={() => setSeedMenu((v) => !v)} busy={busy} />
        </div>
      </div>

      {/* PANELS */}
      <div className="nr-sec">
        <div className="nr-sec-h">Panels</div>
        <div className="adm-togglegrid">
          {NR_PANELS.map((p) => <Tog key={p.key} on={panels[p.key] === true} k={p.key} label={p.label} onClick={() => setPanel(p.key)} busy={busy} />)}
        </div>
      </div>

      {/* ACCESS — NOT SET HERE ANY MORE (sweep T6, 2026-08-06; see the note above NR_PANELS).
          Every permission lives on ONE screen, and this form's copy of them was both a second
          vocabulary for one idea AND three real faults on every restaurant it created. */}
      <div className="nr-sec">
        <div className="nr-sec-h">Access &amp; permissions</div>
        <p className="hint" style={{ margin: "6px 0 0" }}>
          A new restaurant starts on the standard setup: its guest menu on, every manager menu on,
          the extra modules (pay later, banquet, staff pay, inventory) off, waiters able to work the
          floor but not to settle or discount a bill. Change any of it on{" "}
          <b>Access &amp; permissions</b> once the restaurant exists — that is the only screen that
          decides what anyone can do.
        </p>
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
          {/* CLOSE THE LOOP THE ACCESS BLOCK USED TO CLOSE BADLY (2026-08-06). This form stopped
              setting permissions, and the sentence above says to change them on Access — so hand
              over a button that lands on THIS restaurant's Access screen instead of leaving the
              admin to find it. ?from=rest gives that page its "Back to <restaurant>" link. */}
          {done.id ? (
            <p style={{ margin: "8px 0 0" }}>
              <a className="adm-btn primary" href={`/aevinite/access?rid=${done.id}&from=rest`}>
                <i className="fas fa-user-shield" style={{ marginRight: 7 }} aria-hidden="true" />Set its access &amp; permissions
              </a>
            </p>
          ) : null}
          {done.seedError ? (
            <p className="hint" style={{ margin: "6px 0", color: "var(--adm-bad, #c0392b)" }}>Menu seed failed: {done.seedError}. The restaurant was created — add dishes from its manager panel.</p>
          ) : done.menuSeeded ? (
            <p className="hint" style={{ margin: "6px 0" }}>Sample menu added — open the manager panel to edit it.</p>
          ) : null}
          {done.logins.length > 0 ? (
            <>
              {/* A COPY BUTTON, BECAUSE THE SENTENCE ABOVE ASKS YOU TO COPY (T20 sweep, 2026-08-16).
                  This said "copy these passwords now, they won't be shown again" and then gave you
                  nothing to copy with — up to four random 10-character strings to transcribe by
                  hand, with a password reset as the only remedy for a typo. They are also on the
                  restaurant's "Logins & passwords" card from now on, so this is no longer the only
                  chance to see them; it is still the fastest. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "8px 0 6px" }}>
                <p className="hint" style={{ margin: 0, flex: 1, minWidth: 180 }}>Starter logins — copy them now:</p>
                <CopyButton className="adm-btn" style={{ fontSize: 12 }} label="Copy all"
                  text={[`${done.name} — sign-in details`, `Guest menu: /r/${done.slug}/menu`, "",
                    ...done.logins.map((l) => `${l.panel}: ${l.username} / ${l.password}`)].join("\n")} />
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {done.logins.map((l) => (
                  <div key={l.panel} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ textTransform: "capitalize", fontWeight: 700 }}>{l.panel}</span>{" — name "}
                    <code style={{ fontWeight: 700 }}>{l.username}</code>{" · password "}<code style={{ fontWeight: 700 }}>{l.password}</code>
                    <CopyButton className="adm-btn" style={{ fontSize: 11, padding: "2px 8px" }} text={l.password} />
                  </div>
                ))}
              </div>
              <p className="hint" style={{ margin: "6px 0 0" }}>
                These stay readable on this restaurant&rsquo;s <b>Logins &amp; passwords</b> card, where you can also print a handover sheet.
              </p>
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
        <div className="adm-empty"><i className="fas fa-circle-check" style={{ color: "var(--adm-ok, #16a34a)", marginRight: 7 }} aria-hidden="true" />No open tickets for this restaurant.</div>
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
  // (The staff-feature help screenshots went with the "Main features" card, and their full-size
  // zoom went with them — the state, its back-stack layer and its Escape handler survived as a
  // layer nothing could ever open. Removed, T20 sweep 2026-08-16.)
  // "Full report" (owner's words: "every single bit" of ONE restaurant) swaps the
  // whole detail view for its own report — its own component, own data load —
  // instead of cramming another card into an already-long page.
  const [showReport, setShowReport] = useState(false);
  // A tiny toast so a failed toggle tells the admin instead of silently snapping back
  // (or, worse, getting stuck showing the wrong ON/OFF state). Mirrors the Access page.
  const [toast, setToast] = useState<string | null>(null);
  // The ⚙ Settings TAB IS GONE (owner, 2026-08-01: "you have completely removed setting and
  // permission from restaurant detail — everything will be here on the access control tab, not
  // there"). Branding, billing, KOT printing, dining sessions, tables & QR and the banquet bill
  // now live inside the feature they belong to on Access & permissions. `tab` survives as a
  // constant only so the scroll-restore key below keeps its shape.
  const tab = "overview";

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
  // OLD ?tab=settings links still exist in the wild — the panels' "zones off" dropdown sends the
  // admin here for an admin-only setting (billing / KOT / sessions / table count). The tab they
  // pointed at is gone, so forward them to where those settings actually live now instead of
  // dropping them on Overview with no explanation.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("tab") === "settings")
        window.location.replace(`/aevinite/access?rid=${restaurant.id}&from=rest`);
    } catch {}
  }, [restaurant.id]);
  // Stable (useCallback) so the loaders below can list it as a dep without refetching every render.
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); }, []);

  // Phone hardware Back peels one layer at a time instead of leaving the admin page
  // (CLAUDE.md back-button rule): the image zoom → the full report → the detail view → list.
  // Registered top-down; the back-stack pops whichever is on top first.
  useBackClose("admin-rest-detail", true, onBack);
  useBackClose("admin-rest-report", showReport, () => setShowReport(false));

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
    // These sections are not on this page any more — they moved to Access & permissions with
    // the rest of the settings (owner, 2026-08-01). An old ?section= link would otherwise scroll
    // to nothing and look broken, so forward it to the screen that owns that setting now.
    const moved = ["review", "main-features", "branding", "billing", "kitchen", "sessions", "tables"].includes(section);
    if (moved) {
      window.location.replace(`/aevinite/access?rid=${restaurant.id}&from=rest`);
      return;
    }
    requestAnimationFrame(() => {
      const el = document.getElementById(`det-${section}`);
      if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
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

          <RestaurantTickets restaurantId={restaurant.id} />

          <div id="det-status"><StatusCard restaurant={restaurant} /></div>

          <div id="det-owner"><OwnerCard restaurant={restaurant} owners={owners} onChanged={onChanged} /></div>

          <div id="det-enter"><EnterCard restaurant={restaurant} panels={panels} /></div>

          {/* WHO CAN SIGN IN, AND WITH WHAT — plus the printable handover sheet (owner,
              2026-08-16). It sits directly under "Open & manage this restaurant" because that is
              the moment the question comes up: you have just walked into the restaurant, and the
              next thing you need is what to tell the client. */}
          <CredentialsCard restaurantId={restaurant.id} />

          {/* EVERY setting and permission is on the one Access screen now (owner, 2026-08-01).
              This page is identity and actions only — who owns it, how to walk in, how to bin it.
              One link, one source of truth, no duplicate control that can disagree. */}
          <div id="det-access-link" className="adm-card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Everything you can change about this restaurant</div>
              <p className="hint" style={{ margin: "3px 0 0" }}>Its guest-menu features · colours, logo &amp; wording · the bill · kitchen tickets · dining sessions · tables &amp; QR codes · banquet billing · what managers, owners and waiters may do · one person&apos;s exceptions — all on one screen.</p>
            </div>
            <a className="adm-btn primary" href={`/aevinite/access?rid=${restaurant.id}&from=rest`}>
              <i className="fas fa-user-shield" style={{ marginRight: 7 }} aria-hidden="true" />Open Access / Permissions
            </a>
          </div>

      <DangerCard restaurant={restaurant} onDeleted={onBack} onChanged={onChanged} />
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


// Owner assignment for one restaurant: pick an existing owner, or create a new one
// (which is auto-assigned here). Writes via /api/admin/restaurants (PATCH/POST).
function OwnerCard({ restaurant, owners, onChanged }: { restaurant: Restaurant; owners: Owner[]; onChanged: () => void }) {
  const [sel, setSel] = useState<string>(restaurant.ownerUserId || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ name: string; password: string } | null>(null);
  const [newName, setNewName] = useState("");
  // An owner IS assigned, but they are not in the (active-only) owners list — see the note on the
  // select below. `sel` is the truth; `owners` is only who can be picked.
  const assignedUnknown = !!sel && !owners.some((o) => o.id === sel);

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
          {/* A SELECT WITH NO MATCHING OPTION SHOWS ITS FIRST ONE (T16 sweep, 2026-08-19). The
              owners list is active-only, so a restaurant whose owner is suspended or sitting in
              the recycle bin had no option to select and this box displayed "— no owner —" for a
              restaurant that HAS one. The admin would then pick somebody and quietly replace an
              owner they were never told about. An explicit option for the real assignee makes the
              truth visible, and leaves replacing them a deliberate act. */}
          {assignedUnknown && <option value={sel}>— currently assigned (suspended or in the recycle bin) —</option>}
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {msg && <span className="adm-muted" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
      {assignedUnknown && (
        <p className="hint" style={{ margin: "8px 0 0" }}>
          <i className="fas fa-circle-info" style={{ marginRight: 7 }} aria-hidden="true" />
          This restaurant already has an owner, but that account is <b>suspended or in the recycle bin</b>, so
          it isn&rsquo;t in the list above. <a href="/aevinite/owners">Open Owners</a> to see who it is —
          picking somebody here replaces them.
        </p>
      )}
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
