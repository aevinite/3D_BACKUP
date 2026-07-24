"use client";
/* /aevinite/access — the access-control panel (redesign #1, rail + accordion).
 * This IS the access page (the old inline-styled version was replaced by this on the
 * owner's 2026-07-24 merge). Reads/writes the whole ladder through
 * /api/admin/restaurants/access2 using lib/accessModel bindings, styled with the admin
 * theme tokens (var(--card)/(--border)/(--accent)).
 *
 * SAFE-BY-DESIGN: every save maps onto the EXISTING enforced columns, so turning a
 * rung off here hides AND server-refuses it via the app's current guards. Genuinely-new
 * granular sub-options (menu split, dashboard/log picks, discount caps, new tablet
 * rungs) persist to access_config; their enforcement is a later, reviewed step. */
import { useEffect, useState, useCallback, useRef } from "react";
import {
  GROUPS, PERMISSIONS, PERM_BY_ID, permsOf, maxReach, reachLevel, allowed,
  tabletValue, moduleKey, type Perm, type SubOpt, type AccessState,
} from "@/lib/accessModel";

type Rest = { id: string; name: string; slug: string; active: boolean };
type Staff = { id: string; name: string | null; username: string; role: string; permissions?: Record<string, string> };

// ── tiny inline icon set (no FA dependency) ──────────────────────────────────
const P: Record<string, string> = {
  crown: "M3 18h18M4 15L2 7l5.5 4L12 4l4.5 7L22 7l-2 8z", users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 010 7.8",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8", check: "M20 6L9 17l-5-5", minus: "M5 12h14",
  chevron: "M6 9l6 6 6-6", chevronR: "M9 18l6-6-6-6", info: "M12 22a10 10 0 100-20 10 10 0 000 20M12 16v-5M12 8h.01",
  alert: "M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0zM12 9v4M12 17h.01", key: "M7.5 15.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9M10.7 12.3L21 2M17 6l3 3",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", arrowR: "M5 12h14M12 5l7 7-7 7", arrowL: "M19 12H5M12 19l-7-7 7-7", lock: "M5 11h14v10H5zM8 11V7a4 4 0 018 0v4", x: "M18 6L6 18M6 6l12 12", reset: "M3 12a9 9 0 103-6.7L3 8M3 3v5h5",
  // area icons (GROUPS[].icon)
  cutlery: "M3 2v7a2 2 0 002 2h1a2 2 0 002-2V2M6 11v11M17 2v20M17 12c2 0 4-2 4-5V2c-2 0-4 2-4 5",
  book: "M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z",
  receipt: "M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5zM8 8h8M8 12h6",
  grip: "M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z",
  grid: "M5 5h4v4H5zM15 5h4v4h-4zM5 15h4v4H5zM15 15h4v4h-4z",
  fire: "M12 2c1 4 4 5 4 9a4 4 0 01-8 0c0-1.5.5-2.5 1-3M12 22a6 6 0 006-6c0-2-1-4-2-5",
  sparkles: "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z",
  chart: "M3 3v16.5A1.5 1.5 0 004.5 21H21M7 15l3.5-4 3 2.5L20 7",
  sidebar: "M3 3h18v18H3zM9 3v18",
};
const Icon = ({ n, s = 16 }: { n: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
    {P[n]?.split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}
  </svg>
);

// Count badge — an oval that fills like a progress ring (owner design, 2026-07-24).
// Shows "on/total" (one consistent bold colour, no faded denominator); the oval outline
// draws round proportionally from the TOP-CENTRE; when everything's on it goes green and
// the label becomes just "All". Geometry is fixed (48×28) so the perimeter is analytic —
// no DOM measuring, works on the server render too.
const OW = 48, OH = 28, OINSET = 2, OR = OH / 2 - OINSET;
const OX0 = OINSET, OY0 = OINSET, OX1 = OW - OINSET, OY1 = OH - OINSET, OCX = OW / 2;
const OVAL_D = `M ${OCX} ${OY0} L ${OX1 - OR} ${OY0} A ${OR} ${OR} 0 0 1 ${OX1 - OR} ${OY1} L ${OX0 + OR} ${OY1} A ${OR} ${OR} 0 0 1 ${OX0 + OR} ${OY0} L ${OCX} ${OY0} Z`;
const OVAL_PERIM = 2 * ((OX1 - OR) - (OX0 + OR)) + Math.PI * (2 * OR);
const CountOval = ({ on, total }: { on: number; total: number }) => {
  const full = total > 0 && on >= total;
  const ratio = total > 0 ? Math.min(on / total, 1) : 0;
  return (
    <span className={`acc2-count ${full ? "full" : ""}`}>
      <svg viewBox={`0 0 ${OW} ${OH}`} aria-hidden="true">
        <path className="bgf" d={OVAL_D} />
        <path className="tk" d={OVAL_D} />
        <path className="pg" d={OVAL_D} style={{ strokeDasharray: OVAL_PERIM, strokeDashoffset: OVAL_PERIM * (1 - ratio) }} />
      </svg>
      <span className="lb">{full ? "All" : `${on}/${total}`}</span>
    </span>
  );
};

const REACH_LABEL = ["Off", "Owner only", "Owner + Manager", "Owner + Mgr + Tablet"];
// The three sub-option tiers mirror the reach ladder (owner ⊇ manager ⊇ waiter).
type Side = "owner" | "manager" | "waiter";
const OPTS = { owner: "owner_opts", manager: "manager_opts", waiter: "waiter_opts" } as const;
const SIDE_META: Record<Side, { label: string; icon: string }> = {
  owner: { label: "Owner can…", icon: "crown" }, manager: { label: "Manager can…", icon: "users" }, waiter: { label: "Waiter can…", icon: "user" },
};
// The per-user override is stored+enforced under the tablet_* column key (staff_users.permissions,
// mig 115, read by tabletPerm) — NOT the capability id. MODULE-SCOPE so it's never in the TDZ when
// resolved()/holders() run during render (moving it inside the component crashed the panel — a
// hoisted fn called it before the const initialised). Falls back to id for caps with no column.
const permKey = (p: Perm) => p.tablet || p.id;
// A representative real-panel screenshot per area, shown in the (i) popover so the admin can
// see WHERE the thing lives in the app. Files in public/admin-help/ (captured from the live
// panels). Lazy-loaded (only when a popover opens). Missing file → the img just doesn't show.
const SHOT_BY_GROUP: Record<string, string> = {
  guest: "guest-menu", menu: "manager-menu", money: "manager-menu", floor: "tablet",
  kitchen: "kitchen", banquet: "manager-menu", reports: "owner-home", staff: "owner-staff", panels: "owner-home",
};
const ROLE_ORDER: Record<string, number> = { owner: 0, manager: 1, tablet: 2, kitchen: 3 };
const ROLE_LABEL: Record<string, string> = { owner: "Owner", manager: "Manager", tablet: "Waiter", kitchen: "Kitchen" };
const ROLE_RELEVANCE: Record<string, string[]> = {
  manager: ["edit_menu", "give_discounts", "void_bills", "mark_paid", "print_invoice", "khata", "take_orders", "table_ops", "table_tags", "banquet", "view_dashboard", "view_ratings", "view_logs", "manage_staff", "edit_settings"],
  tablet: ["give_discounts", "mark_paid", "print_invoice", "khata", "take_orders", "table_ops", "table_tags", "void_bills"],
  kitchen: ["edit_menu", "view_logs"],
  owner: PERMISSIONS.filter((p) => p.kind === "ladder").map((p) => p.id),
};

export default function Access2Page() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [rid, setRid] = useState<string>("");
  const [st, setSt] = useState<AccessState | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [tab, setTab] = useState<"general" | "person">("general");
  const [personId, setPersonId] = useState<string>("");
  const [personFilter, setPersonFilter] = useState<string>("");
  const [open, setOpen] = useState<Record<string, boolean>>({ guest: true });
  const [activeArea, setActiveArea] = useState<string>("guest"); // the ONE rail item highlighted (nav target)
  const [side, setSide] = useState<Record<string, Side>>({});
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "err">("");
  const [info, setInfo] = useState<{ perm: Perm; sub?: string } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [fromRest, setFromRest] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);
  const spyClick = useRef(0); // suppress the spy briefly after a rail click so it doesn't fight the smooth-scroll

  useEffect(() => {
    // Read ?rid / ?from off the URL directly (no useSearchParams → no Suspense
    // boundary needed), matching how the restaurants page reads ?focus.
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const urlRid = q.get("rid") || "";
    setFromRest(q.get("from") === "rest");
    fetch("/api/admin/restaurants").then((r) => r.json()).then((d) => {
      const list: Rest[] = (Array.isArray(d) ? d : d.restaurants || []).filter((x: Rest) => x.active !== false);
      setRests(list);
      const pick = list.find((x) => x.id === urlRid) || list[0];
      if (pick) setRid(pick.id);
    }).catch(() => {});
  }, []);

  const load = useCallback((id: string) => {
    if (!id) return;
    fetch(`/api/admin/restaurants/access2?restaurant_id=${id}`).then((r) => r.json()).then((d) => { if (!d.error) setSt(d); }).catch(() => {});
    fetch(`/api/owner/staff?rid=${id}`).then((r) => r.json()).then((d) => {
      const s: Staff[] = (d.staff || d.users || d || []) as Staff[];
      setStaff(Array.isArray(s) ? s : []);
    }).catch(() => setStaff([]));
  }, []);
  useEffect(() => { load(rid); setPersonId(""); setPersonFilter(""); }, [rid, load]);

  // Scroll-spy: as the sections scroll past, highlight the matching AREA in the left rail —
  // exactly like the guest menu's category strip. The scroll container is .adm-main.
  useEffect(() => {
    if (tab !== "general" || !st) return;
    const scroller = document.querySelector(".adm-main");
    if (!scroller) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (Date.now() < spyClick.current) return; // let a rail-click's smooth scroll settle first
        const band = scroller.getBoundingClientRect().top + 96;
        let best = GROUPS[0].id, bestTop = -Infinity;
        for (const g of GROUPS) {
          const el = document.getElementById("sec-" + g.id);
          if (!el) continue;
          const top = el.getBoundingClientRect().top;
          if (top <= band && top > bestTop) { bestTop = top; best = g.id; }
        }
        setActiveArea(best);
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { scroller.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [tab, st, rid]);

  // Keep the highlighted rail item in view WITHIN the rail (scrolls the rail only, never the page).
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const btn = rail.querySelector<HTMLElement>(`[data-area="${activeArea}"]`);
    if (!btn) return;
    const bt = btn.offsetTop, bh = btn.offsetHeight, rt = rail.scrollTop, rh = rail.clientHeight;
    if (bt < rt + 6) rail.scrollTo({ top: Math.max(0, bt - 10), behavior: "smooth" });
    else if (bt + bh > rt + rh - 6) rail.scrollTo({ top: bt + bh - rh + 10, behavior: "smooth" });
  }, [activeArea]);

  // apply a patch locally (mirror the server) + POST it
  const save = useCallback((patch: any) => {
    setSt((prev) => {
      if (!prev) return prev;
      const n: AccessState = JSON.parse(JSON.stringify(prev));
      if (patch.features) Object.assign(n.features, patch.features);
      if (patch.panels) Object.assign(n.panels, patch.panels);
      if (patch.owner) Object.assign(n.owner, patch.owner);
      if (patch.manager) Object.assign(n.manager, patch.manager);
      if (patch.tablet) Object.assign(n.tablet, patch.tablet);
      if (patch.adminSwitches) Object.assign(n.adminSwitches, patch.adminSwitches);
      if (patch.modules) for (const k of Object.keys(patch.modules)) n.modules[k] = { ...n.modules[k], ...patch.modules[k] };
      if (patch.config) for (const k of Object.keys(patch.config)) n.config[k] = { ...(n.config[k] || {}), ...patch.config[k] };
      return n;
    });
    setSaving("saving");
    fetch("/api/admin/restaurants/access2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurant_id: rid, patch }) })
      .then((r) => { setSaving(r.ok ? "saved" : "err"); if (!r.ok) load(rid); setTimeout(() => setSaving(""), 1400); })
      .catch(() => { setSaving("err"); load(rid); });
  }, [rid, load]);

  // Closing a fixed overlay by TAPPING its close button focuses that button; when the
  // button then unmounts, the browser restores focus to <body> and NATIVELY scrolls the
  // admin content container back to the top (verified on touch: 500 → 0, with no JS
  // scroll call to intercept). So we snapshot the scroll position of whichever container
  // is actually scrolled (.adm.adx on mobile, .adm-main on desktop) and put it back on
  // the next frame — before paint, so it's imperceptible. Cheap, no egress.
  const closeStay = (fn: () => void) => {
    const els = ([document.querySelector<HTMLElement>(".adm.adx"), document.querySelector<HTMLElement>(".adm-main")].filter(Boolean) as HTMLElement[]);
    const snap = els.map((e) => e.scrollTop);
    const wy = window.scrollY;
    fn();
    const restore = () => { els.forEach((e, i) => { if (e.scrollTop !== snap[i]) e.scrollTop = snap[i]; }); if (window.scrollY !== wy) window.scrollTo(0, wy); };
    requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
  };

  if (!st) return <div style={{ padding: 40, color: "var(--muted)" }}>Loading access…</div>;

  const rest = rests.find((r) => r.id === rid);

  // ── save helpers that translate the model → canonical columns ───────────────
  const powerKey = (f: string) => `power_${f}`;
  const setReach = (p: Perm, lvl: number) => {
    lvl = Math.max(0, Math.min(lvl, maxReach(p)));
    const patch: any = {};
    if (p.module) { patch.modules = { [moduleKey(p)]: { allowed: lvl >= 1 } }; }
    // A section-linked capability's OWNER rung IS the owner-panel section: one control writes
    // BOTH the section (page exists) AND power_<flag> (admin allows the manager grant). This is
    // what links the old "Owner panel sections" to the powers so ratings etc. never diverge.
    if (p.section) { patch.owner = { ...(patch.owner || {}), [p.section]: lvl >= 1 }; }
    if (p.power && !p.fixedTop) { patch.owner = { ...(patch.owner || {}), [powerKey(p.power)]: lvl >= 1 }; }
    if (p.power) patch.manager = { ...(patch.manager || {}), [p.power]: lvl >= 2 };
    if (p.waiter) {
      const on = lvl >= 3;
      if (p.tabletNew) patch.config = { [p.id]: { tablet: on ? (tabletValue(p, st) === "pin" ? "pin" : "on") : "off" } };
      else if (p.tablet) patch.tablet = { ...(patch.tablet || {}), [p.tablet]: on ? (st.tablet[p.tablet] !== "off" ? st.tablet[p.tablet] : "on") : "off" };
    }
    save(patch);
  };
  const setMaster = (p: Perm, on: boolean) => { setReach(p, on ? Math.max(1, reachLevel(p, st)) : 0); if (on) setOpenCards((s) => ({ ...s, [p.id]: true })); else setOpenCards((s) => ({ ...s, [p.id]: false })); };
  const setWaiter = (p: Perm, v: string) => { if (p.tabletNew) save({ config: { [p.id]: { tablet: v } } }); else if (p.tablet) save({ tablet: { [p.tablet]: v } }); };
  const setSub = (p: Perm, sideK: Side, subId: string, on: boolean) => {
    const cur = { ...((st.config[p.id]?.[OPTS[sideK]]) || {}) };
    cur[subId] = on;
    const patch: any = { config: { [p.id]: { [OPTS[sideK]]: cur } } };
    // Cascade DOWN — a lower tier can never hold a sub-option a higher one lacks.
    // owner OFF → drop it for manager AND waiter; manager OFF → drop it for waiter.
    if (!on) {
      if (sideK === "owner") {
        const mgr = { ...((st.config[p.id]?.manager_opts) || {}) };
        const wtr = { ...((st.config[p.id]?.waiter_opts) || {}) };
        if (mgr[subId]) { delete mgr[subId]; patch.config[p.id].manager_opts = mgr; }
        if (wtr[subId]) { delete wtr[subId]; patch.config[p.id].waiter_opts = wtr; }
      } else if (sideK === "manager") {
        const wtr = { ...((st.config[p.id]?.waiter_opts) || {}) };
        if (wtr[subId]) { delete wtr[subId]; patch.config[p.id].waiter_opts = wtr; }
      }
    }
    save(patch);
  };
  const setLimit = (p: Perm, sideK: string, v: number) => save({ config: { [p.id]: { limit: { ...((st.config[p.id]?.limit) || {}), [sideK]: v } } } });

  // ── switches (guest / panels / owner sections / admin auto-print) ───────────
  const switchVal = (p: Perm): boolean => {
    if (p.feature) return !!st.features[p.feature];
    if (p.panel) return st.panels[p.panel] !== false;
    if (p.section) return st.owner[p.section] !== false;
    if (p.adminSwitch) return !!st.adminSwitches[p.adminSwitch];
    return false;
  };
  const setSwitch = (p: Perm, on: boolean) => {
    if (p.feature) save({ features: { [p.feature]: on } });
    else if (p.panel) save({ panels: { [p.panel]: on } });
    else if (p.section) save({ owner: { [p.section]: on } });
    else if (p.adminSwitch) save({ adminSwitches: { [p.adminSwitch]: on } });
  };

  const subOn = (p: Perm, sideK: Side, subId: string) =>
    !!(st.config[p.id]?.[OPTS[sideK]]?.[subId]);
  const conflicts = (p: Perm): string[] => {
    if (!p.sub) return [];
    const lvl = reachLevel(p, st);
    const bad = new Set<string>();
    // a lower tier holding a sub-option a higher tier lacks = an impossible state to flag
    if (lvl >= 2) p.sub.forEach((s) => { if (subOn(p, "manager", s.id) && !subOn(p, "owner", s.id)) bad.add(s.name); });
    if (lvl >= 3 && p.waiter) p.sub.forEach((s) => { if (subOn(p, "waiter", s.id) && !subOn(p, "manager", s.id)) bad.add(s.name); });
    return [...bad];
  };

  const sortedStaff = [...staff].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || (a.name || a.username).localeCompare(b.name || b.username));

  return (
    <div className="acc2">
      <Style />
      <nav className="adm-crumbs" style={{ marginBottom: 4 }}>
        <a href="/aevinite">Dashboard</a><span className="sep">›</span>
        <a href="/aevinite/restaurants">Restaurants</a><span className="sep">›</span>
        {/* Back to origin: if we arrived from a restaurant detail, this crumb reopens THAT
            detail (?focus=<slug>); otherwise it just returns to the list. */}
        <a href={rest ? `/aevinite/restaurants?focus=${rest.slug}` : "/aevinite/restaurants"}>{rest?.name || "Restaurant"}</a>
        <span className="sep">›</span>
        <span className="cur">Access</span>
      </nav>
      {fromRest && rest && (
        <a className="adm-btn" href={`/aevinite/restaurants?focus=${rest.slug}`} style={{ margin: "10px 0 2px", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Icon n="arrowL" s={14} /> Back to {rest.name}
        </a>
      )}

      <header className="acc2-head">
        <div>
          <h1 className="adm-page-title" style={{ margin: 0 }}>Access &amp; permissions</h1>
          <p className="adm-page-sub" style={{ margin: "4px 0 0" }}>{rest?.name} · {staff.length} people · new panel (preview)</p>
        </div>
        <div className="acc2-head-r">
          <span className={`acc2-save ${saving}`}>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : saving === "err" ? "Save failed" : ""}</span>
          <select className="acc2-rsel" value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Restaurant">
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="acc2-tabs">
            <button className={tab === "general" ? "on" : ""} onClick={() => { setTab("general"); setPersonFilter(""); }}><Icon n="shield" s={15} /> General</button>
            <button className={tab === "person" ? "on" : ""} onClick={() => setTab("person")}><Icon n="users" s={15} /> Per person</button>
          </div>
        </div>
      </header>

      {tab === "general" ? <General /> : <PerPerson />}

      {info && <InfoPop />}
      {lightbox && (
        <div className="acc2-lightbox" onClick={() => closeStay(() => setLightbox(null))}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local help screenshot lightbox */}
          <img src={lightbox} alt="Where this appears in the app, enlarged" />
        </div>
      )}
    </div>
  );

  // ───────────────────────────── GENERAL ─────────────────────────────────────
  function General() {
    const conf = PERMISSIONS.filter((p) => conflicts(p).length);
    return (
      <>
        {conf.length > 0 && (
          <div className="acc2-warn">
            <Icon n="alert" s={18} />
            <span><b>{conf.length} power{conf.length > 1 ? "s have" : " has"} a manager set above the owner.</b> A manager can never hold something the owner doesn't — {conf.map((c) => c.name).join(", ")}.</span>
          </div>
        )}
        <div className="acc2-rail-wrap">
          <nav className="acc2-rail" ref={railRef}>
            <div className="rh">Areas</div>
            {GROUPS.map((g) => {
              const ps = permsOf(g.id);
              const on = ps.filter((p) => (p.kind === "switch" ? switchVal(p) : reachLevel(p, st!) > 0)).length;
              return (
                <button key={g.id} data-area={g.id} className={activeArea === g.id ? "on" : ""} onClick={() => { spyClick.current = Date.now() + 750; setActiveArea(g.id); setOpen((s) => ({ ...s, [g.id]: true })); document.getElementById("sec-" + g.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                  <span className="acc2-gi"><Icon n={g.icon} s={15} /></span>
                  <span className="nm">{g.name}</span><CountOval on={on} total={ps.length} />
                </button>
              );
            })}
          </nav>
          <div className="acc2-main">
            {GROUPS.map((g) => {
              const ps = permsOf(g.id);
              const on = ps.filter((p) => (p.kind === "switch" ? switchVal(p) : reachLevel(p, st!) > 0)).length;
              const isOpen = open[g.id];
              return (
                <section className="adm-card acc2-sect" id={"sec-" + g.id} key={g.id}>
                  <button className="acc2-sh" onClick={() => setOpen((s) => ({ ...s, [g.id]: !s[g.id] }))}>
                    <span className="acc2-gi lg"><Icon n={g.icon} s={19} /></span>
                    <div className="acc2-sh-t"><h2>{g.name}</h2><p>{g.blurb}</p></div>
                    <CountOval on={on} total={ps.length} />
                    <span className={`acc2-chev ${isOpen ? "o" : ""}`}><Icon n="chevron" /></span>
                  </button>
                  {isOpen && <div className="acc2-body">{ps.map((p) => p.kind === "switch" ? <SwitchRow key={p.id} p={p} /> : <LadderCard key={p.id} p={p} />)}</div>}
                </section>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  function SwitchRow({ p }: { p: Perm }) {
    const on = switchVal(p);
    const blocked = p.requires && !st!.features[p.requires];
    return (
      <div className="acc2-sw">
        <div className="acc2-sw-b">
          <div className="nm">{p.name}{p.adminOnly && <span className="tag">ADMIN ONLY</span>}<InfoBtn p={p} /></div>
          <div className="ds">{blocked ? `Needs “${PERM_BY_ID[p.requires!].name}” on first.` : p.what}</div>
        </div>
        <Toggle checked={on} disabled={!!blocked} onChange={() => setSwitch(p, !on)} />
      </div>
    );
  }

  function LadderCard({ p }: { p: Perm }) {
    const lvl = reachLevel(p, st!);
    const gated = !allowed(p, st!) && !!p.module; // module not allowed by admin
    const isOpen = !!openCards[p.id];
    const sd = side[p.id] || "owner";
    const canMgr = lvl >= 2;
    const canWtr = !!p.waiter && lvl >= 3;
    // which tiers this capability actually reaches → which "…can" tabs to show
    const tiers: Side[] = ["owner", ...(canMgr ? ["manager"] as Side[] : []), ...(canWtr ? ["waiter"] as Side[] : [])];
    const shown: Side = tiers.includes(sd) ? sd : "owner";
    const parentHas = (spt: SubOpt, s: Side) => s === "owner" ? true : s === "manager" ? subOn(p, "owner", spt.id) : subOn(p, "manager", spt.id);
    const conf = conflicts(p);
    const master = p.fixedTop ? true : lvl >= 1;
    const reachTxt = p.fixedTop ? "Owner + Manager" + (lvl >= 3 ? " + Tablet" : "") : REACH_LABEL[lvl];

    return (
      <article className={`acc2-card ${isOpen ? "o" : ""} ${master ? "act" : ""}`}>
        <div className="acc2-ph">
          <button className="acc2-ph-b" onClick={() => setOpenCards((s) => ({ ...s, [p.id]: !s[p.id] }))}>
            <div className="nm">{p.name}{p.adminOnly && <span className="tag">ADMIN ONLY</span>}</div>
            <div className="ds">{p.what}</div>
          </button>
          <div className="acc2-ph-c">
            <span className={`acc2-reachtag ${master ? "on" : ""}`}>{reachTxt}</span>
            {!p.fixedTop && <Toggle checked={master} onChange={() => setMaster(p, !master)} />}
            <button className={`acc2-chev ${isOpen ? "o" : ""}`} onClick={() => setOpenCards((s) => ({ ...s, [p.id]: !s[p.id] }))}><Icon n="chevron" /></button>
          </div>
        </div>

        {isOpen && (
          <div className="acc2-cb">
            {p.module && (
              <div className="acc2-gate">
                <div className="lbl">Admin allows “{p.name}” for this restaurant
                  <small>{allowed(p, st!) ? "Allowed — the owner decides who uses it below." : "Not allowed — nothing below applies and the server refuses it."}</small></div>
                <Toggle checked={allowed(p, st!)} onChange={() => save({ modules: { [moduleKey(p)]: { allowed: !allowed(p, st!) } } })} />
              </div>
            )}
            {gated ? (
              <p className="acc2-hint"><Icon n="shield" /> Switched off for this restaurant. Turn “Admin allows” on to open the settings.</p>
            ) : master ? (
              <>
                {/* CUMULATIVE reach ladder (capped at the capability's max): the model is
                    additive — manager always includes owner, tablet always includes manager —
                    so every step UP TO the chosen reach fills in (soft) and the chosen ceiling
                    is solid + checked. Reads like signal bars: you can SEE that "+ Manager"
                    still keeps the owner. Clicking a step sets the ceiling. Owner-only caps
                    (Issues/Customers) show just "Owner"; money/floor caps go up to "+ Tablet". */}
                {!p.fixedTop && !p.ownerOnly && (
                  <div className="acc2-reach">
                    {Array.from({ length: maxReach(p) }, (_, i) => i + 1).map((v) => (
                      <button key={v} className={`rs r${v} ${lvl >= v ? "on" : ""} ${lvl === v ? "cur" : ""}`} onClick={() => setReach(p, v)} title={v === 1 ? "Owner only" : v === 2 ? "Owner and managers" : "Owner, managers and waiters"}>
                        <Icon n={v === 1 ? "crown" : v === 2 ? "users" : "user"} s={14} />{v === 1 ? "Owner" : v === 2 ? "+ Manager" : "+ Tablet"}
                        {lvl === v && <span className="rc"><Icon n="check" s={11} /></span>}
                      </button>
                    ))}
                  </div>
                )}
                {p.ownerOnly && <p className="acc2-hint"><Icon n="crown" /> Owner-only — this is an owner-panel page; the toggle above turns it on or off.</p>}
                {p.fixedTop && <p className="acc2-hint"><Icon n="info" /> Owner &amp; manager always have this — choose whether waiters get it below.</p>}

                {p.sub && (
                  <>
                    {/* ONE "…can" tab per tier this capability reaches: Owner, +Manager, +Tablet(Waiter).
                        Each tier picks WHICH sub-actions it gets; cascade is waiter ⊆ manager ⊆ owner. */}
                    <div className="acc2-sides">
                      {tiers.map((tk) => (
                        <button key={tk} className={`sd ${tk} ${shown === tk ? "on" : ""}`} onClick={() => setSide((s) => ({ ...s, [p.id]: tk }))}>
                          <Icon n={SIDE_META[tk].icon} s={14} /> {SIDE_META[tk].label} <b>{p.sub!.filter((spt) => subOn(p, tk, spt.id)).length}/{p.sub!.length}</b>
                        </button>
                      ))}
                    </div>
                    <div className={`acc2-chips ${shown}`}>
                      {p.sub.map((spt) => {
                        const on = subOn(p, shown, spt.id);
                        const dis = spt.adminOnly && shown !== "owner";           // admin-only sub can't be delegated below owner
                        const bad = shown !== "owner" && on && !parentHas(spt, shown); // holding what the tier above lacks
                        // Corner badges = the OTHER tiers that also hold this sub-option.
                        // Owner→O, Manager→M, waiter tier→T (the tablet — the rest of the UI
                        // says "+ Tablet"/"T", so t[0] "W" was the odd one out; owner 2026-07-24).
                        const others = tiers.filter((t) => t !== shown && subOn(p, t, spt.id)).map((t) => t === "waiter" ? "T" : t[0].toUpperCase());
                        return (
                          <div key={spt.id} className={`chip ${on ? "on" : ""} ${bad ? "bad" : ""} ${dis ? "dis" : ""}`}>
                            <button disabled={dis} onClick={() => setSub(p, shown, spt.id, !on)}>
                              <span className="box"><Icon n="check" s={12} /></span>{spt.name}
                              {spt.adminOnly && <span className="tag">ADMIN</span>}
                            </button>
                            {others.length > 0 && <span className="xb" title={"Also on for: " + others.map((o) => o === "O" ? "owner" : o === "M" ? "manager" : "tablet").join(", ")}>{others.join("")}</span>}
                            <button className="ib" onClick={() => setInfo({ perm: p, sub: spt.id })}><Icon n="info" s={12} /></button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {p.limit && (
                  <div className="acc2-limit">
                    <div className="lbl">{p.limit.label} — {shown}<small>Anything above this is refused, not just hidden.</small></div>
                    <div className="segs">{p.limit.options.map((o) => {
                      const cur = (st!.config[p.id]?.limit?.[shown]) ?? p.limit!.options[0];
                      return <button key={o} className={cur === o ? "on" : ""} onClick={() => setLimit(p, shown, o)}>{o}{p.limit!.unit}</button>;
                    })}</div>
                  </div>
                )}

                {p.waiter && lvl >= 3 && (
                  <div className="acc2-waiter">
                    <div className="lbl"><Icon n="user" s={15} /> Every waiter, by default<small>Override one person on the Per person tab.</small></div>
                    <div className="tri">
                      {[["on", "Straight on", "check"], ["pin", "On, ask for a PIN", "key"]].map(([v, l, ic]) => (
                        <button key={v} className={tabletValue(p, st!) === v || (v === "on" && tabletValue(p, st!) !== "pin") ? "on" : ""} onClick={() => setWaiter(p, v as string)}><Icon n={ic as string} s={13} />{l}</button>
                      ))}
                    </div>
                  </div>
                )}

                {conf.length > 0 && (
                  <div className="acc2-conflict"><Icon n="alert" s={16} /><span><b>Manager is set above the owner:</b> {conf.join(", ")}. Give the owner the same option, or untick it for the manager.</span></div>
                )}

                <button className="acc2-who" onClick={() => { setTab("person"); setPersonFilter(p.id); }}>
                  <Icon n="users" s={14} /> Who has this right now? <b>{holders(p).length}</b> <Icon n="arrowR" s={14} />
                </button>
              </>
            ) : (
              <p className="acc2-hint"><Icon n="info" /> Off — nobody has this. Flip the switch above to give it to the owner.</p>
            )}
          </div>
        )}
      </article>
    );
  }

  function holders(p: Perm): Staff[] {
    return sortedStaff.filter((u) => (ROLE_RELEVANCE[u.role] || []).includes(p.id) && resolved(u, p).eff);
  }
  function resolved(u: Staff, p: Perm): { base: boolean; eff: boolean; ov: string } {
    const lvl = reachLevel(p, st!);
    let base = false;
    if (u.role === "owner") base = lvl >= 1;
    else if (u.role === "manager") base = lvl >= 2;
    else if (u.role === "tablet") base = lvl >= 3 && !!p.waiter;
    const ov = u.permissions?.[permKey(p)] || "default";
    const eff = ov === "on" || ov === "pin" ? true : ov === "off" ? false : base;
    return { base, eff, ov };
  }
  function setOverride(u: Staff, p: Perm, v: string) {
    const key = permKey(p);
    setStaff((prev) => prev.map((x) => x.id === u.id ? { ...x, permissions: { ...(x.permissions || {}), [key]: v } } : x));
    fetch("/api/owner/staff", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, action: "set_permissions", permissions: { [key]: v } }) }).catch(() => {});
  }

  // ───────────────────────────── PER PERSON ──────────────────────────────────
  function PerPerson() {
    const people = sortedStaff;
    const person = people.find((p) => p.id === personId) || people[0];
    if (!person) return <div className="adm-card" style={{ padding: 24, color: "var(--muted)" }}>No staff for this restaurant.</div>;
    let lastRole = "";
    const list = people.map((u) => {
      const hd = u.role !== lastRole ? <div className="prole" key={"h" + u.id}>{ROLE_LABEL[u.role]}{u.role === "tablet" ? "s" : ""}</div> : null;
      lastRole = u.role;
      const nOv = Object.keys(u.permissions || {}).length;
      return (<div key={u.id}>{hd}
        <button className={`prow ${u.id === person.id ? "on" : ""}`} onClick={() => setPersonId(u.id)}>
          <span className="av">{(u.name || u.username).split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
          <span className="pi"><span className="nm">{u.name || u.username}</span><span className="mt">{ROLE_LABEL[u.role]}</span></span>
          {nOv > 0 && <span className="ovr">{nOv}</span>}
        </button></div>);
    });

    if (personFilter) {
      const p = PERM_BY_ID[personFilter];
      const relevant = people.filter((u) => (ROLE_RELEVANCE[u.role] || []).includes(p.id));
      const hs = relevant.filter((u) => resolved(u, p).eff);
      return (
        <div className="acc2-pp">
          <nav className="acc2-plist adm-card">{list}</nav>
          <div className="adm-card">
            <div className="acc2-filter"><Icon n="users" s={15} /> Who has <b>{p.name}</b> — <b>{hs.length}</b> of {relevant.length}
              <button onClick={() => setPersonFilter("")}>Back to one person</button></div>
            {relevant.map((u) => <CapRow key={u.id} u={u} p={p} whoMode />)}
          </div>
        </div>
      );
    }

    const caps = (ROLE_RELEVANCE[person.role] || []).map((id) => PERM_BY_ID[id]).filter((p) => p && !(p.module && !allowed(p, st!)));
    let lastG = "";
    return (
      <div className="acc2-pp">
        <nav className="acc2-plist adm-card">{list}</nav>
        <div className="adm-card">
          <div className="acc2-pdh">
            <span className="av">{(person.name || person.username).split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
            <div><h3>{person.name || person.username}</h3><span>{ROLE_LABEL[person.role]}</span></div>
          </div>
          {caps.length === 0 ? <p className="acc2-hint" style={{ padding: 20 }}>Nothing here applies to a {ROLE_LABEL[person.role].toLowerCase()}.</p> :
            caps.map((p) => { const hd = p.group !== lastG ? <div className="capg" key={"g" + p.id}>{PERM_BY_ID[p.id] && GROUPS.find((g) => g.id === p.group)?.name}</div> : null; lastG = p.group; return <div key={p.id}>{hd}<CapRow u={person} p={p} /></div>; })}
        </div>
      </div>
    );
  }

  function CapRow({ u, p, whoMode }: { u: Staff; p: Perm; whoMode?: boolean }) {
    const { base, eff, ov } = resolved(u, p);
    const pinnable = u.role === "tablet" && p.waiter;
    const opts: [string, string][] = pinnable
      ? [["default", "Follows restaurant"], ["on", "On"], ["pin", "On, PIN"], ["off", "Off"]]
      : [["default", "Follows restaurant"], ["on", "On"], ["off", "Off"]];
    return (
      <div className={`caprow ${whoMode && eff ? "hi" : ""}`}>
        {whoMode && <span className="av sm">{(u.name || u.username).split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>}
        <div className="body">
          <div className="nm">{whoMode ? (u.name || u.username) : p.name}{whoMode && <span className={`hasit ${eff ? "y" : "n"}`}>{eff ? "Has it" : "Does not"}</span>}<InfoBtn p={p} /></div>
          <div className="ds">{whoMode ? `${ROLE_LABEL[u.role]} · ${ov === "default" ? "follows restaurant" : "overridden to " + ov.toUpperCase()}` : (ov === "default" ? `Follows the restaurant — currently ${base ? "on" : "off"}.` : `Overridden — restaurant says ${base ? "on" : "off"}.`)}</div>
        </div>
        <div className="tri3">
          {opts.map(([v, l]) => (
            <button key={v} className={`${ov === v || (v === "on" && ov === "pin" && !pinnable) ? "on" : ""} v-${v}`} onClick={() => setOverride(u, p, v)}>
              {v === "on" && <Icon n="check" s={12} />}{v === "off" && <Icon n="minus" s={12} />}{v === "pin" && <Icon n="key" s={12} />}{l}{v === "default" && <b>{base ? "ON" : "OFF"}</b>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function InfoBtn({ p }: { p: Perm }) { return <button className="acc2-ib" onClick={() => setInfo({ perm: p })}><Icon n="info" s={12} /></button>; }
  function InfoPop() {
    if (!info) return null;
    const sub = info.sub ? info.perm.sub?.find((s) => s.id === info.sub) : undefined;
    const shot = SHOT_BY_GROUP[info.perm.group];
    const src = shot ? `/admin-help/${shot}.png` : null;
    return (
      <div className="acc2-infowrap" onClick={() => closeStay(() => setInfo(null))}>
        <div className="acc2-info" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="cl" onClick={() => closeStay(() => setInfo(null))}><Icon n="x" s={16} /></button>
          <h4>{sub ? sub.name : info.perm.name}{(sub?.adminOnly || info.perm.adminOnly) && <span className="tag">ADMIN ONLY</span>}</h4>
          <p>{sub ? sub.what : info.perm.what}</p>
          {src && <>
            <p className="note">Where it shows in the app (tap to enlarge):</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- local help screenshot, lazy-loaded */}
            <img className="acc2-shot" src={src} alt="Where this appears in the app" loading="lazy" onClick={() => setLightbox(src)} />
          </>}
        </div>
      </div>
    );
  }
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: () => void }) {
  return <button className={`acc2-toggle ${checked ? "on" : ""}`} role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}><span /></button>;
}

function Style() {
  return <style jsx global>{`
  .acc2 { max-width: 1180px; }
  .acc2-head { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; margin:6px 0 18px; }
  .acc2-head-r { margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .acc2-save { font-size:12px; font-weight:700; color:var(--muted); min-width:60px; }
  .acc2-save.saved { color:var(--adm-ok); } .acc2-save.err { color:var(--adm-danger); }
  .acc2-rsel { height:40px; border-radius:10px; border:var(--border); background:var(--card); color:var(--text); font-weight:700; font-size:13.5px; padding:0 10px; }
  .acc2-tabs { display:flex; gap:3px; background:var(--card); border:var(--border); border-radius:12px; padding:4px; }
  .acc2-tabs button { display:flex; align-items:center; gap:7px; min-height:40px; padding:0 16px; border-radius:9px; border:none; background:transparent; color:var(--muted); font-weight:700; font-size:13.5px; cursor:pointer; }
  .acc2-tabs button.on { background:var(--accent); color:#fff; }
  .acc2-warn { display:flex; gap:10px; align-items:flex-start; padding:12px 16px; margin:0 0 16px; border-radius:12px; background:color-mix(in srgb, var(--adm-danger) 12%, transparent); border:1px solid color-mix(in srgb, var(--adm-danger) 40%, transparent); color:var(--text); font-size:13.5px; }
  .acc2-warn svg { color:var(--adm-danger); margin-top:1px; }
  .acc2-rail-wrap { display:grid; grid-template-columns:250px 1fr; gap:20px; align-items:start; }
  .acc2-rail { position:sticky; top:12px; max-height:calc(100dvh - 96px); overflow-y:auto; background:var(--card); border:var(--border); border-radius:14px; padding:7px; scrollbar-width:thin; }
  .acc2-rail .rh { padding:9px 11px 6px; font-size:10.5px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); }
  .acc2-rail button { position:relative; display:flex; align-items:center; gap:11px; width:100%; min-height:46px; padding:8px 12px; border:none; background:transparent; border-radius:10px; cursor:pointer; color:var(--text); text-align:left; transition:background .14s; }
  .acc2-rail button:hover { background:color-mix(in srgb, var(--accent) 7%, transparent); }
  /* Single, consistent active treatment: a soft tint + a slim accent bar on the left
     (only ONE rail item is active = the nav target). Icon chip stays uniform — no jarring
     big solid block, so items read as one clean list. */
  .acc2-rail button.on { background:color-mix(in srgb, var(--accent) 11%, transparent); }
  .acc2-rail button.on::before { content:""; position:absolute; left:0; top:9px; bottom:9px; width:3px; border-radius:0 3px 3px 0; background:var(--accent); }
  .acc2-rail button.on .nm { color:var(--accent); }
  .acc2-rail button.on .acc2-gi { background:color-mix(in srgb, var(--accent) 20%, transparent); border-color:color-mix(in srgb, var(--accent) 40%, transparent); }
  .acc2-rail .nm { flex:1; font-size:13.5px; font-weight:650; }
  /* the small area-icon chip (rail + section header) — uniform for all rows */
  .acc2-gi { width:30px; height:30px; border-radius:9px; display:grid; place-items:center; flex:none; background:color-mix(in srgb, var(--accent) 11%, transparent); color:var(--accent); border:1px solid color-mix(in srgb, var(--accent) 20%, transparent); }
  .acc2-gi.lg { width:38px; height:38px; border-radius:11px; }
  .acc2-rail .nm { flex:1; font-size:13.5px; font-weight:700; }
  .acc2-main { display:flex; flex-direction:column; gap:14px; min-width:0; }
  .acc2-sect { padding:0; overflow:hidden; scroll-margin-top:12px; transition:box-shadow .15s, border-color .15s; }
  .acc2-sect:hover { border-color:color-mix(in srgb, var(--accent) 30%, var(--border)); }
  .acc2-sh { display:flex; align-items:center; gap:13px; width:100%; padding:13px 16px; border:none; background:transparent; cursor:pointer; text-align:left; color:var(--text); }
  .acc2-sh-t { flex:1; min-width:0; }
  .acc2-sh h2 { margin:0; font-size:15.5px; font-weight:800; letter-spacing:-.02em; }
  .acc2-sh p { margin:2px 0 0; font-size:12px; color:var(--muted); line-height:1.35; }
  .acc2-count { position:relative; display:inline-flex; align-items:center; justify-content:center; width:48px; height:28px; flex:none; }
  .acc2-count svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
  .acc2-count .bgf { fill:transparent; transition:fill .3s; }
  .acc2-count .tk { fill:none; stroke:color-mix(in srgb, var(--muted) 34%, transparent); stroke-width:2; }
  .acc2-count .pg { fill:none; stroke:var(--accent); stroke-width:2; stroke-linecap:round; transition:stroke-dashoffset .5s ease; }
  .acc2-count .lb { position:relative; font-size:12px; font-weight:800; line-height:1; font-variant-numeric:tabular-nums; letter-spacing:.02em; color:var(--text); }
  .acc2-count.full .pg { stroke:var(--adm-ok); }
  .acc2-count.full .bgf { fill:color-mix(in srgb, var(--adm-ok) 13%, transparent); }
  .acc2-count.full .lb { color:var(--adm-ok); letter-spacing:.04em; }
  .acc2-chev { color:var(--muted); transition:transform .2s; display:grid; place-items:center; background:none; border:none; cursor:pointer; }
  .acc2-chev.o { transform:rotate(180deg); color:var(--accent); }
  .acc2-body { border-top:var(--border); padding:8px; display:flex; flex-direction:column; gap:8px; }
  .acc2-sw { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:11px; background:var(--bg); }
  .acc2-sw-b { flex:1; min-width:0; } .acc2-sw .nm { font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px; }
  .acc2-sw .ds { font-size:12px; color:var(--muted); margin-top:2px; }
  .acc2-toggle { width:44px; height:26px; border-radius:99px; background:var(--muted2); border:var(--border); position:relative; cursor:pointer; flex:none; transition:background .2s; }
  .acc2-toggle span { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:99px; background:var(--muted); transition:transform .2s, background .2s; }
  .acc2-toggle.on { background:var(--accent); border-color:var(--accent); } .acc2-toggle.on span { transform:translateX(18px); background:#fff; }
  .acc2-toggle:disabled { opacity:.4; cursor:not-allowed; }
  .tag { font-size:9px; font-weight:800; letter-spacing:.06em; padding:2px 6px; border-radius:5px; background:color-mix(in srgb,var(--adm-warn) 18%,transparent); color:var(--adm-warn); border:1px solid color-mix(in srgb,var(--adm-warn) 34%,transparent); }
  .acc2-card { background:var(--bg); border:var(--border); border-radius:13px; overflow:hidden; }
  .acc2-card.act { border-color:color-mix(in srgb,var(--accent) 40%,transparent); }
  .acc2-ph { display:flex; align-items:flex-start; gap:10px; padding:12px 14px; }
  .acc2-ph-b { flex:1; min-width:0; text-align:left; border:none; background:none; cursor:pointer; color:var(--text); }
  .acc2-ph-b .nm { font-size:14.5px; font-weight:800; display:flex; align-items:center; gap:8px; }
  .acc2-ph-b .ds { font-size:12px; color:var(--muted); margin-top:3px; }
  .acc2-ph-c { display:flex; align-items:center; gap:9px; flex:none; }
  .acc2-reachtag { font-size:11px; font-weight:800; color:var(--muted); background:var(--card); border:var(--border); padding:5px 8px; border-radius:7px; white-space:nowrap; }
  .acc2-reachtag.on { color:var(--accent); background:color-mix(in srgb,var(--accent) 12%,transparent); border-color:color-mix(in srgb,var(--accent) 30%,transparent); }
  .acc2-cb { border-top:var(--border); padding:14px; }
  .acc2-gate { display:flex; gap:12px; align-items:center; padding:11px 13px; margin-bottom:14px; border-radius:11px; background:color-mix(in srgb,var(--adm-warn) 10%,transparent); border:1px solid color-mix(in srgb,var(--adm-warn) 26%,transparent); }
  .acc2-gate .lbl { flex:1; font-size:12.8px; font-weight:700; } .acc2-gate small { display:block; font-weight:400; color:var(--muted); margin-top:2px; }
  .acc2-hint { display:flex; gap:8px; align-items:flex-start; font-size:12.5px; color:var(--muted); margin:2px 0; }
  .acc2-reach { display:grid; grid-template-columns:repeat(auto-fit,minmax(90px,1fr)); gap:4px; padding:4px; background:var(--card); border:var(--border); border-radius:11px; }
  .acc2-reach .rs { display:flex; align-items:center; justify-content:center; gap:6px; min-height:42px; border-radius:8px; border:none; background:transparent; color:var(--muted); font-weight:700; font-size:12.5px; cursor:pointer; }
  .acc2-reach .rs { position:relative; transition:background .14s, color .14s; }
  .acc2-reach .rs.on { color:var(--accent); background:color-mix(in srgb,var(--accent) 20%,transparent); }
  .acc2-reach .rs.cur { color:#fff; background:var(--accent); }
  .acc2-reach .rs .rc { display:grid; place-items:center; width:15px; height:15px; border-radius:999px; background:rgba(255,255,255,.28); }
  .acc2-reach .rs.cur .rc { color:#fff; }
  .acc2-sides { display:flex; gap:4px; background:var(--card); border:var(--border); border-radius:11px; padding:4px; margin:14px 0 12px; }
  .acc2-sides .sd { flex:1; display:flex; align-items:center; justify-content:center; gap:7px; min-height:40px; border-radius:8px; border:none; background:transparent; color:var(--muted); font-weight:700; font-size:13px; cursor:pointer; }
  .acc2-sides .sd.on { background:var(--muted2); color:var(--text); }
  .acc2-sides .sd:disabled { opacity:.4; cursor:not-allowed; }
  .acc2-chips { display:flex; flex-wrap:wrap; gap:8px; }
  .acc2-chips .chip { position:relative; display:flex; align-items:center; background:var(--card); border:var(--border); border-radius:10px; }
  .acc2-chips .chip button:first-child { display:flex; align-items:center; gap:9px; min-height:42px; padding:0 6px 0 11px; border:none; background:none; color:var(--muted); font-weight:600; font-size:12.8px; cursor:pointer; }
  .acc2-chips .chip .box { width:18px; height:18px; border-radius:5px; border:1.5px solid var(--muted); display:grid; place-items:center; color:transparent; }
  .acc2-chips .chip.on { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 12%,transparent); }
  .acc2-chips .chip.on button:first-child { color:var(--text); } .acc2-chips .chip.on .box { background:var(--accent); border-color:var(--accent); color:#fff; }
  .acc2-chips .chip.bad { border-color:var(--adm-danger); background:color-mix(in srgb,var(--adm-danger) 12%,transparent); }
  .acc2-chips .chip.dis { opacity:.5; }
  .acc2-chips .chip .ib { padding:0 9px 0 2px; background:none; border:none; color:var(--muted); cursor:pointer; align-self:center; }
  .acc2-chips .chip .xb { position:absolute; top:-7px; right:-6px; min-width:18px; height:18px; padding:0 4px; border-radius:99px; display:grid; place-items:center; font-size:9.5px; font-weight:800; letter-spacing:.06em; font-family:ui-monospace,monospace; border:2px solid var(--bg); background:var(--accent); color:#fff; }
  .acc2-limit { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:14px; padding:11px 13px; border-radius:11px; background:var(--card); border:var(--border); }
  .acc2-limit .lbl { flex:1; min-width:150px; font-size:13px; font-weight:700; } .acc2-limit small { display:block; font-weight:400; color:var(--muted); }
  .acc2-limit .segs { display:flex; gap:3px; background:var(--bg); border:var(--border); border-radius:9px; padding:3px; }
  .acc2-limit .segs button { min-height:36px; min-width:46px; border-radius:7px; border:none; background:none; color:var(--muted); font-weight:700; font-family:ui-monospace,monospace; font-size:12px; cursor:pointer; }
  .acc2-limit .segs button.on { background:var(--accent); color:#fff; }
  .acc2-waiter { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:14px; padding:12px 13px; border-radius:11px; background:color-mix(in srgb,var(--adm-ok) 8%,transparent); border:1px solid color-mix(in srgb,var(--adm-ok) 24%,transparent); }
  .acc2-waiter .lbl { flex:1; min-width:170px; font-size:13px; font-weight:700; display:flex; align-items:center; gap:8px; } .acc2-waiter small { display:block; font-weight:400; color:var(--muted); }
  .acc2-waiter .tri { display:flex; gap:3px; background:var(--bg); border:var(--border); border-radius:9px; padding:3px; }
  .acc2-waiter .tri button { display:flex; align-items:center; gap:6px; min-height:36px; padding:0 12px; border-radius:7px; border:none; background:none; color:var(--muted); font-weight:700; font-size:12.5px; cursor:pointer; }
  .acc2-waiter .tri button.on { background:var(--adm-ok); color:#04210f; }
  .acc2-conflict { display:flex; gap:9px; align-items:flex-start; margin-top:14px; padding:11px 13px; border-radius:10px; background:color-mix(in srgb,var(--adm-danger) 12%,transparent); border:1px solid color-mix(in srgb,var(--adm-danger) 40%,transparent); font-size:12.5px; }
  .acc2-conflict svg { color:var(--adm-danger); flex:none; margin-top:1px; }
  .acc2-who { display:inline-flex; align-items:center; gap:8px; margin-top:14px; min-height:40px; padding:0 14px; border-radius:10px; border:1px dashed var(--muted); background:none; color:var(--muted); font-weight:700; font-size:12.5px; cursor:pointer; }
  .acc2-who:hover { border-style:solid; border-color:var(--accent); color:var(--accent); }
  .acc2-who b { color:var(--accent); font-family:ui-monospace,monospace; }
  .acc2-ib { width:20px; height:20px; padding:0; appearance:none; -webkit-appearance:none; border-radius:99px; border:var(--border); background:none; color:var(--muted); display:inline-grid; place-items:center; cursor:pointer; flex:none; line-height:0; }
  .acc2-ib svg { display:block; }
  .acc2-pp { display:grid; grid-template-columns:270px 1fr; gap:20px; align-items:start; }
  .acc2-plist { padding:8px; position:sticky; top:12px; }
  .prole { padding:10px 12px 4px; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); }
  .prow { display:flex; align-items:center; gap:11px; width:100%; min-height:56px; padding:7px 12px; border:none; background:none; border-radius:10px; border-left:3px solid transparent; cursor:pointer; text-align:left; color:var(--text); }
  .prow:hover { background:color-mix(in srgb,var(--accent) 7%,transparent); }
  .prow.on { background:color-mix(in srgb,var(--accent) 13%,transparent); border-left-color:var(--accent); }
  .prow .av { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; font-size:12px; font-weight:800; background:var(--muted2); flex:none; }
  .prow.on .av { background:var(--accent); color:#fff; }
  .prow .pi { flex:1; min-width:0; } .prow .nm { display:block; font-size:13.5px; font-weight:700; } .prow .mt { display:block; font-size:11px; color:var(--muted); }
  .prow .ovr { font-size:10px; font-weight:800; font-family:ui-monospace,monospace; color:var(--accent); background:color-mix(in srgb,var(--accent) 14%,transparent); padding:3px 6px; border-radius:5px; }
  .acc2-pdh { display:flex; align-items:center; gap:14px; padding:6px 6px 16px; border-bottom:var(--border); margin-bottom:8px; }
  .acc2-pdh .av { width:48px; height:48px; border-radius:13px; display:grid; place-items:center; font-size:16px; font-weight:800; background:var(--accent); color:#fff; }
  .acc2-pdh h3 { margin:0; font-size:18px; font-weight:800; } .acc2-pdh span { font-size:12.5px; color:var(--muted); }
  .acc2-filter { display:flex; align-items:center; gap:9px; padding:11px 13px; margin:-6px -6px 8px; border-radius:10px; background:color-mix(in srgb,var(--accent) 10%,transparent); font-size:13px; }
  .acc2-filter button { margin-left:auto; background:none; border:none; color:var(--muted); font-weight:700; font-size:12px; text-decoration:underline; cursor:pointer; }
  .capg { padding:12px 6px 4px; font-size:10px; font-weight:800; letter-spacing:.09em; text-transform:uppercase; color:var(--muted); }
  .caprow { display:flex; align-items:center; gap:12px; padding:11px 8px; border-top:var(--border); flex-wrap:wrap; }
  .caprow.hi { background:color-mix(in srgb,var(--accent) 8%,transparent); border-radius:9px; }
  .caprow .av.sm { width:32px; height:32px; border-radius:9px; display:grid; place-items:center; font-size:11px; font-weight:800; background:var(--muted2); flex:none; }
  .caprow .body { flex:1; min-width:170px; } .caprow .nm { font-size:13.5px; font-weight:700; display:flex; align-items:center; gap:8px; } .caprow .ds { font-size:11.5px; color:var(--muted); margin-top:2px; }
  .caprow .hasit { font-size:10px; font-weight:800; padding:2px 7px; border-radius:99px; } .caprow .hasit.y { background:color-mix(in srgb,var(--adm-ok) 16%,transparent); color:var(--adm-ok); } .caprow .hasit.n { background:var(--muted2); color:var(--muted); }
  .tri3 { display:flex; gap:3px; background:var(--bg); border:var(--border); border-radius:10px; padding:3px; flex:none; }
  .tri3 button { display:flex; align-items:center; gap:5px; min-height:38px; padding:0 11px; border-radius:7px; border:none; background:none; color:var(--muted); font-weight:700; font-size:12px; cursor:pointer; }
  .tri3 button b { font-family:ui-monospace,monospace; font-size:10px; opacity:.8; }
  .tri3 button.on.v-default { background:var(--muted2); color:var(--text); }
  .tri3 button.on.v-on { background:var(--adm-ok); color:#04210f; }
  .tri3 button.on.v-pin { background:var(--accent); color:#fff; }
  .tri3 button.on.v-off { background:var(--adm-danger); color:#fff; }
  .acc2-infowrap { position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,.4); display:grid; place-items:center; padding:24px; }
  .acc2-info { max-width:420px; width:100%; background:var(--card); border:var(--border); border-radius:16px; padding:18px; position:relative; box-shadow:var(--elev-hi); }
  .acc2-info h4 { margin:0 0 8px; font-size:16px; font-weight:800; display:flex; align-items:center; gap:8px; padding-right:24px; }
  .acc2-info p { margin:0; font-size:13.5px; color:var(--text); line-height:1.5; } .acc2-info .note { margin-top:10px; font-size:12px; color:var(--muted); }
  .acc2-info .cl { position:absolute; top:12px; right:12px; width:28px; height:28px; border-radius:8px; border:none; background:var(--bg); color:var(--muted); cursor:pointer; display:grid; place-items:center; }
  .acc2-shot { width:100%; margin-top:8px; border-radius:10px; border:var(--border); cursor:zoom-in; display:block; background:var(--bg); }
  .acc2-lightbox { position:fixed; inset:0; z-index:1100; background:rgba(0,0,0,.75); display:grid; place-items:center; padding:32px; cursor:zoom-out; }
  .acc2-lightbox img { max-width:96vw; max-height:92vh; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  @media (max-width:900px){ .acc2-rail-wrap,.acc2-pp{ grid-template-columns:1fr; } .acc2-rail,.acc2-plist{ position:static; } }
  `}</style>;
}
