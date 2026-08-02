"use client";
// OwnerShell (redesign 2026-07-04) — the frame for the OWNER panel (/owner).
// Dense console chrome on the `.adm.owx` skin: DARK by default (light behind the
// toggle), grouped 224px sidebar that collapses to a pill row ≤900px, emerald
// accent (owner = money) vs the admin console's blue. The owner panel keeps NO
// link to /aevinite — admin is a higher, password-gated privilege.
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { inr, useActiveAutoRefresh } from "@/components/admin/shared";
import { useBackClose } from "@/lib/backStack";
import ConnectionBadge from "@/components/ConnectionBadge";
import { fetchOwnerOverview } from "@/lib/ownerOverviewCache";
import { asSuffix } from "@/lib/ownerPin";

type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean; ent?: string };
type NavGroup = { label: string; quiet?: boolean; items: NavItem[] };

// Grouped nav: the real, working sections up top; future modules live in ONE
// quiet "Coming soon" group (they open branded Coming-soon pages) — a complete
// menu like the big POS panels, without their 300-report clutter.
const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/owner", label: "Dashboard", icon: "fa-gauge-high", exact: true },
      // Manager mode (owner, 2026-08-02): the FULL live manager panel — floor, bills,
      // ordering — embedded for owners who work their own restaurant. On this page the
      // whole sidebar collapses to the ☰ burger at EVERY width (the "mmode" class below)
      // so the floor gets the entire screen, exactly like the real manager panel.
      { href: "/owner/manager", label: "Manager mode", icon: "fa-table-cells-large", ent: "manager_mode" },
    ],
  },
  {
    label: "Business",
    items: [
      // `ent` = the owner-entitlement key (mig 133) that must be ON for this section
      // to exist. Hidden from the real owner when off; tinted for the admin act-as.
      // Menu = the real dishes/categories/tags editor (owner 2026-07-25); shows read-only
      // "View menu" when the admin turned menu editing off (enforced in the editor panel).
      { href: "/owner/menu", label: "Menu", icon: "fa-book-open", ent: "menu" },
      { href: "/owner/reports", label: "Reports", icon: "fa-file-invoice", ent: "reports" },
      { href: "/owner/staff", label: "Staff & powers", icon: "fa-users-gear", ent: "staff" },
      { href: "/owner/customers", label: "Customers", icon: "fa-user-group", ent: "customers" },
      // Activity = the owner's read-only log of everything their staff did (staff_actions,
      // scoped server-side); each row opens the shared organized detail popup.
      // Gated by the "logs" entitlement since the access rebuild (2026-07-31): the owner's
      // Log page is now a listed switch under Access → Owner's menu, so it must actually
      // disappear when switched off. Absent entitlement = ON, so nothing changes by itself.
      { href: "/owner/activity", label: "Activity", icon: "fa-clock-rotate-left", ent: "logs" },
      // Pay Later (khata, mig 166/184): gated on the pay-later MODULE being effective for the
      // restaurant (ent key injected by the layout), NOT a separate admin section toggle — so
      // it appears only for restaurants that actually have pay-later on (no dead section).
      { href: "/owner/khata", label: "Pay Later", icon: "fa-book", ent: "khata_book" },
      // Inventory & expenses (mig 221): gated on the inventory MODULE being effective for the
      // restaurant (ent key injected by the layout from inventoryLadder), same as Pay Later —
      // it appears only for restaurants the admin gave the module to (no dead section).
      { href: "/owner/inventory", label: "Inventory & expenses", icon: "fa-boxes-stacked", ent: "inventory" },
      { href: "/owner/issues", label: "Feedback & complaints", icon: "fa-triangle-exclamation", ent: "issues" },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/owner/settings", label: "Settings", icon: "fa-gear", ent: "settings" },
    ],
  },
  {
    label: "Coming soon",
    quiet: true,
    items: [
      { href: "/owner/marketing", label: "Marketing", icon: "fa-bullhorn", soon: true },
      { href: "/owner/online", label: "Online & apps", icon: "fa-truck-fast", soon: true },
    ],
  },
];

// The OWNER-panel path label for the top-strip breadcrumb — derived from the current
// route by re-using the same labels the sidebar already shows (single source of truth,
// so a renamed section updates both at once). Longest-prefix match: `/owner` → Dashboard
// (exact), `/owner/reports` → Reports, `/owner/reports/sales` → Reports, etc. This is the
// owner's own path (orientation inside /owner), NOT the admin act-as breadcrumb.
function ownerSectionLabel(path: string): string {
  const items = GROUPS.flatMap((g) => g.items);
  let best: NavItem | undefined;
  for (const it of items) {
    const hit = it.exact ? path === it.href : path === it.href || path.startsWith(it.href + "/");
    if (hit && (!best || it.href.length > best.href.length)) best = it;
  }
  return best?.label ?? "Dashboard";
}

export default function OwnerShell({ children, adminViewing, restaurantName, initialSkin, entitlements, dualAdmin }: {
  children: React.ReactNode; adminViewing?: boolean; restaurantName?: string; initialSkin?: "light" | "dark";
  // Owner-panel section entitlements (mig 133), resolved server-side by the layout.
  // Absent map (never happens in practice) = everything on.
  entitlements?: Record<string, boolean>;
  // DUAL-COOKIE case (owner, 2026-07-28): a real owner is signed in AND the admin's
  // act-as is live in the same browser. The layout can't read searchParams, so it can't
  // tell an admin-opened tab from the owner's own — it passes BOTH payloads and this
  // client picks per tab below (?rid= pin → admin view; no pin → the owner's own view).
  dualAdmin?: { adminEntitlements: Record<string, boolean>; restaurantName: string };
}) {
  const path = usePathname();
  const router = useRouter();
  const [zonesOpen, setZonesOpen] = useState(false);
  // Hardware BACK closes the zones popout instead of leaving the page (project rule:
  // every popup registers). Self-noops while closed.
  useBackClose("owner-xray-zones", zonesOpen, () => setZonesOpen(false));
  // Admin scope pin (bug C1, 2026-07-05): when the admin drills into ONE restaurant
  // the URL carries ?rid=<id>. Carry it across EVERY sidebar link so navigating
  // dashboard→reports→staff keeps this tab pinned to that restaurant instead of
  // falling back to the browser-wide act-as cookie (which a second tab can overwrite).
  // Read ?rid AFTER mount, not in the useState initializer: the server never sees ?rid, so
  // seeding from window.location on the client made the FIRST client render diverge from the
  // server — the admin banner name AND every sidebar link href — throwing a hydration mismatch on
  // every admin ?rid= drill-in (audit 2026-07-09). Starting null (same as the server) then filling
  // it in useEffect keeps SSR and first paint identical; the pin lands on the next render, before
  // any nav click. A real owner has no ?rid, so this stays null throughout.
  const [ridPin, setRidPin] = useState<string | null>(null);
  // ACTUAL-VIEW toggle (owner, 2026-07-28): ?view=real on an admin-view tab renders the
  // cockpit exactly as the REAL owner sees it (removed sections hidden, not tinted); only
  // the slim admin bar stays as the way back. Read post-mount like ridPin (hydration-safe).
  const [viewReal, setViewReal] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setRidPin(q.get("rid"));
    setViewReal(q.get("view") === "real");
  }, []);
  // DUAL-COOKIE per-tab resolution (owner, 2026-07-28): a ?rid-pinned tab is the ADMIN's
  // view (only the console's act-as/go flow appends the pin — panel APIs enforce the same
  // rule server-side in lib/ownerScope); an unpinned tab is the real owner's own cockpit.
  // Resolved post-mount like ridPin, so SSR and first paint stay identical — the brief
  // owner-styled first frame only ever happens on the admin's own machine.
  if (dualAdmin && ridPin) {
    adminViewing = true;
    entitlements = dualAdmin.adminEntitlements;
    restaurantName = dualAdmin.restaurantName;
  }
  const simulated = !!(adminViewing && viewReal);
  // Flip THIS TAB between the full admin view and the actual owner view — pure URL state.
  const setSimulate = (on: boolean) => {
    const u = new URL(window.location.href);
    if (on) u.searchParams.set("view", "real"); else u.searchParams.delete("view");
    window.location.href = u.toString();
  };
  const sectionOn = (it: NavItem) => !it.ent || !entitlements || entitlements[it.ent] !== false;
  // What the admin sees tinted (the X-ray zones): sections off for the real owner.
  const offSections = GROUPS.flatMap((g) => g.items).filter((it) => it.ent && !sectionOn(it));
  const withRid = (href: string) => (ridPin ? `${href}${href.includes("?") ? "&" : "?"}rid=${ridPin}${asSuffix()}${viewReal ? "&view=real" : ""}` : href);
  // Skin: the server passes the cookie value as `initialSkin` so SSR already emits the
  // RIGHT data-skin — no dark→light flash on load for owners who chose light (fixed
  // 2026-07-06). Falls back to dark on a first-ever visit (no cookie yet).
  const [skin, setSkin] = useState<"light" | "dark">(initialSkin ?? "dark");

  useEffect(() => {
    // Reconcile with localStorage only if it and the SSR cookie disagree (rare) — keeps
    // the toggle working even if the cookie was cleared but localStorage kept.
    try { const s = localStorage.getItem("aevidine_skin"); if ((s === "dark" || s === "light") && s !== skin) setSkin(s); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mobile (≤900px): the sidebar becomes a ☰ left slide-in drawer (2026-07-20, same
  // pattern as the manager + admin panels — replaced the old horizontally-scrolling
  // pill strip that hid sections off the right edge). Hardware BACK closes the drawer
  // (project rule: every overlay registers); a route change or widening past the
  // breakpoint closes it too.
  const [navOpen, setNavOpen] = useState(false);
  useBackClose("owner-nav", navOpen, () => setNavOpen(false));
  useEffect(() => { setNavOpen(false); }, [path]);

  // Merged breadcrumb tail (owner 2026-07-26): the dashboard broadcasts the drilled
  // restaurant/dish names and they render HERE, in the one top strip — Owner ›
  // Dashboard › My Little French House — instead of a second heading row on the page.
  const [crumbTail, setCrumbTail] = useState<string[]>([]);
  useEffect(() => {
    const onCrumb = (e: Event) => setCrumbTail(((e as CustomEvent).detail?.tail as string[]) ?? []);
    window.addEventListener("lfh:owner-crumb", onCrumb);
    return () => window.removeEventListener("lfh:owner-crumb", onCrumb);
  }, []);
  // NB: no path-based clear here — each broadcasting page (dashboard, reports) emits an empty
  // tail on unmount, so the tail always reflects the CURRENT page. A path-based clear here ran
  // AFTER the incoming page's mount broadcast (parent effects fire after child effects) and
  // wiped it — the reports sub-report crumb vanished. Page-owned lifecycle avoids that race.

  // Top-strip restaurant switcher dropdown (multi-restaurant owners only). Hardware
  // BACK closes it (project rule: every overlay registers); a route change closes it too.
  const [restOpen, setRestOpen] = useState(false);
  useBackClose("owner-rest-switch", restOpen, () => setRestOpen(false));
  useEffect(() => { setRestOpen(false); }, [path]);
  useEffect(() => {
    if (!restOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".owx-switch-pop, .owx-switch")) setRestOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [restOpen]);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e: MediaQueryListEvent) => { if (!e.matches) setNavOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // "My restaurants" — the full list the owner owns, ALWAYS visible in the sidebar
  // (owner request 2026-07-06). The shared overview cache collapses this with the
  // dashboard's own overview fetch on a hard load (no duplicate read). It refreshes on
  // the same activity-gated 60s cadence as the dashboard so the sidebar's "revenue today"
  // no longer drifts stale against the live cards (audit 2026-07-07).
  const [myRests, setMyRests] = useState<{ id: string; name: string; accentColor: string; revenueToday: number }[]>([]);
  const refreshMyRests = useCallback(() => {
    const scp = ridPin ? `&scope=${ridPin}${asSuffix()}` : "";
    return fetchOwnerOverview(scp)
      .then((j) => {
        const list = (j as { restaurants?: unknown })?.restaurants;
        if (!Array.isArray(list)) return;
        setMyRests(list.map((r: { id: string; name: string; accentColor?: string; revenueToday?: number }) => ({
          id: r.id, name: r.name, accentColor: r.accentColor || "#34d399", revenueToday: r.revenueToday || 0,
        })));
      })
      .catch(() => {});
  }, [ridPin]);
  useEffect(() => { refreshMyRests(); }, [refreshMyRests]);
  useActiveAutoRefresh(() => refreshMyRests(), 60000);
  // The owner panel rendered = the auth/DB lookup SUCCEEDED, so reset the reconnect
  // backoff counter — the next outage starts fresh at 3s (see OwnerReconnecting).
  useEffect(() => { try { sessionStorage.removeItem("owner_reconnect_attempts"); } catch { /* ignore */ } }, []);

  // Banner name must match THIS tab, not the browser-wide act-as cookie (bug #10,
  // 2026-07-06): with two admin owner-tabs open, the cookie holds the last-opened
  // restaurant, so tab A's banner showed tab B's name over tab A's (correctly
  // ?rid-scoped) numbers. When this tab is pinned (?rid), prefer the name of the
  // pinned restaurant from the already-fetched list; fall back to the server prop.
  const pinnedName = ridPin ? myRests.find((r) => r.id === ridPin)?.name : undefined;
  // On the first render ridPin is null (read post-mount, see above) so this is `restaurantName`,
  // matching the server — no hydration mismatch. Once ?rid is read, a pinned tab shows its OWN
  // restaurant's name (never the shared act-as cookie's, which a second tab may have repointed);
  // "this restaurant" is the brief placeholder until myRests resolves (bug #10, 2026-07-06).
  const shownName = ridPin ? (pinnedName || "this restaurant") : restaurantName;

  // Open one restaurant's dashboard from anywhere: on /owner the dashboard listens
  // for this event (no reload); from any other page we navigate home with ?focus=.
  const openRestaurant = (rid: string | null) => {
    if (path === "/owner") {
      setNavOpen(false); // no navigation happens on the home page → close explicitly
      window.dispatchEvent(new CustomEvent("lfh:owner-open-restaurant", { detail: { rid } }));
    } else if (path === "/owner/reports") {
      // On Reports the switcher re-scopes the reports IN PLACE (owner 2026-07-27:
      // "toggle on top to all restaurants" must work here without bouncing back to the
      // dashboard). The reports page listens for lfh:owner-scope and sets its rid — same
      // event-driven, no-new-fetch idea the dashboard uses for its own switcher.
      setNavOpen(false);
      window.dispatchEvent(new CustomEvent("lfh:owner-scope", { detail: { rid } }));
    } else {
      // navigating → the path-effect closes the drawer after the route commits
      const q = [rid ? `focus=${rid}` : "", ridPin ? `rid=${ridPin}${asSuffix()}` : ""].filter(Boolean).join("&");
      router.push(`/owner${q ? `?${q}` : ""}`);
    }
  };

  // Close the X-ray zones popout on an outside click (same rule as the manager panel's).
  useEffect(() => {
    if (!zonesOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.(".xray-zpop, .xray-zbtn")) setZonesOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [zonesOpen]);

  const toggleSkin = () => {
    setSkin((cur) => {
      const next = cur === "dark" ? "light" : "dark";
      try { localStorage.setItem("aevidine_skin", next); } catch {}
      // Persist to a cookie too so the NEXT server render starts on the right skin.
      try { document.cookie = `aevidine_skin=${next}; path=/; max-age=31536000; samesite=lax`; } catch {}
      return next;
    });
  };

  // Admin "exit view": clear the act-as cookie, then back to the admin hub.
  // Only ever rendered for the admin (a real owner never gets adminViewing).
  const exitAdminView = async () => {
    try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
    router.push("/aevinite/restaurants");
  };

  const isActive = (it: NavItem) => (it.exact ? path === it.href : path.startsWith(it.href));

  // Manager mode fills the whole screen: the sidebar becomes the ☰ drawer at EVERY width
  // (not just ≤900px) — the .mmode CSS in globals.css applies the same drawer rules the
  // phone layout already uses, so the embedded manager floor gets the full viewport.
  const managerMode = path.startsWith("/owner/manager");

  return (
    <div className={"adm owx" + (managerMode ? " mmode" : "")} data-skin={skin}>
      {navOpen && <div className="owx-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className={"owx-side" + (navOpen ? " open" : "")} id="ownerNav">
        <div className="owx-brand">
          <span className="mark"><i className="fas fa-store" aria-hidden="true" /></span>
          <span className="who"><b>Owner</b><span>Aevidine</span></span>
        </div>
        <nav className="owx-nav" aria-label="Owner sections">
          {GROUPS.map((g) => (
            <div key={g.label} className={`owx-group${g.quiet ? " quiet" : ""}`}>
              <div className="owx-group-lbl">{g.label}</div>
              {g.items.map((it) => {
                const on = sectionOn(it);
                // Hidden below, tinted above: a section the admin removed disappears for
                // the real owner, but the admin act-as sees it grey-tinted (X-ray). The
                // ACTUAL-VIEW mode renders like the real owner: hidden, not tinted.
                if (!on && (!adminViewing || simulated)) return null;
                return (
                  <Link key={it.href} href={withRid(it.href)} className={`owx-navlink${isActive(it) ? " active" : ""}${on ? "" : " xray-off"}`}
                    onClick={() => { if (isActive(it)) setNavOpen(false); }} /* different page → the path-effect closes AFTER the route commits (closing here races the back-stack rewind and can bounce the nav) */
                    aria-current={isActive(it) ? "page" : undefined}
                    title={on ? undefined : `Not available — ${it.label} isn't enabled for this owner (turned off by the admin). You can still open it from this view.`}>
                    <i className={`fas ${it.icon}`} aria-hidden="true" />
                    {it.label}
                    {it.soon && <span className="navsoon">Soon</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* My restaurants — always ALL of them, on every page (>1 only: a single-
            restaurant owner needs no list of one). Scrolls past ~7 so 15+ stays sane. */}
        {myRests.length > 1 && (
          <div className="owx-myrest">
            <div className="hd">My restaurants <b>{myRests.length}</b></div>
            <div className="rows">
              <button className="rrow all" onClick={() => openRestaurant(null)}>
                <i className="fas fa-layer-group" aria-hidden="true" />
                <span className="nm">All restaurants</span>
              </button>
              {myRests.map((r) => (
                <button key={r.id} className="rrow" onClick={() => openRestaurant(r.id)} title={`Open ${r.name}`}>
                  <span className="sw" style={{ background: r.accentColor }} aria-hidden="true" />
                  <span className="nm">{r.name}</span>
                  <span className="rv">{inr(r.revenueToday)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="owx-side-foot">Aevidine · Restaurant OS</div>
      </aside>

      <div className="adm-body">
        {/* ADMIN-ONLY breadcrumb/exit bar (never rendered for the real owner). */}
        {adminViewing && (
          <div className="adm-adminbar" role="status">
            <nav className="adm-crumbs" aria-label="Breadcrumb">
              {/* Clear the act-as cookie BEFORE leaving — like "Exit view". A plain link
                  left the admin still "acting as" this restaurant for 6h, so re-opening
                  /owner silently re-entered it (fixed 2026-07-06). */}
              <a href="/aevinite/restaurants" onClick={(e) => { e.preventDefault(); exitAdminView(); }}>Restaurants</a>
              <i className="fas fa-chevron-right sep" aria-hidden="true" />
              <span className="cur">{shownName}</span>
              <i className="fas fa-chevron-right sep" aria-hidden="true" />
              <span className="cur">Owner panel</span>
            </nav>
            <span className="adm-adminbar-tag"><i className="fas fa-user-shield" aria-hidden="true" /> Admin view{simulated ? " · as real owner" : ""}</span>
            {/* X-ray zone counter: which sections the real owner can't see. In the
                ACTUAL-VIEW mode it's replaced by the way back to the full admin view. */}
            {simulated ? (
              <button className="adm-btn xray-zbtn" onClick={() => setSimulate(false)}
                title="Back to the full admin view (everything visible)">
                <i className="fas fa-user-shield" style={{ marginRight: 6 }} aria-hidden="true" /> See full admin view
              </button>
            ) : (
            <span style={{ position: "relative" }}>
              <button className="adm-btn xray-zbtn" onClick={() => setZonesOpen((o) => !o)}
                title="Sections hidden from the real owner">
                {offSections.length} section{offSections.length === 1 ? "" : "s"} off for owner <i className="fas fa-chevron-down" style={{ fontSize: 9 }} aria-hidden="true" />
              </button>
              {zonesOpen && (
                <div className="xray-zpop" role="menu">
                  <div className="zh">Off for the real owner</div>
                  {offSections.length === 0 && <div className="zrow" style={{ cursor: "default" }}>Nothing is off.</div>}
                  {offSections.map((it) => (
                    <button key={it.href} className="zrow" onClick={() => {
                      setZonesOpen(false);
                      // Jump straight to the EXACT admin control for this section — the
                      // Access page scrolls to it and flashes it (owner 2026-07-28).
                      router.push(`/aevinite/access${ridPin ? `?rid=${ridPin}&` : "?"}focus=${encodeURIComponent(it.ent!)}`);
                    }}>
                      <span className="dot" aria-hidden="true" />{it.label}<small>change in Access</small>
                    </button>
                  ))}
                  {/* Bottom row (owner 2026-07-28): flip THIS TAB to the ACTUAL owner panel —
                      exactly what the real owner sees, with their real access. */}
                  <div className="zsep" aria-hidden="true" />
                  <button className="zrow zsim" onClick={() => { setZonesOpen(false); setSimulate(true); }}
                    title="Reload this tab showing exactly what the real owner sees — same limited access, fully working">
                    <span className="dot" style={{ background: "#6b7280" }} aria-hidden="true" />👁 See the actual owner panel
                  </button>
                </div>
              )}
            </span>
            )}
            <button className="adm-btn" onClick={exitAdminView} title="Stop viewing this owner panel">
              <i className="fas fa-arrow-rotate-left" style={{ marginRight: 6 }} aria-hidden="true" /> Exit view
            </button>
          </div>
        )}
        <header className="owx-top">
          <button type="button" className="owx-burger" onClick={() => setNavOpen((o) => !o)}
            aria-label={navOpen ? "Close menu" : "Open menu"} aria-expanded={navOpen} aria-controls="ownerNav">
            <i className={`fas ${navOpen ? "fa-xmark" : "fa-bars"}`} aria-hidden="true" />
          </button>
          <div className="owx-top-nav">
            {/* Restaurant switcher. >1 restaurant → dropdown that jumps the active
                restaurant (reuses myRests + openRestaurant). One restaurant → static pill. */}
            {myRests.length > 1 ? (
              <div className="owx-switch-wrap">
                <button type="button" className="owx-scope owx-switch" onClick={() => setRestOpen((o) => !o)}
                  aria-haspopup="menu" aria-expanded={restOpen} title="Switch restaurant">
                  <span className="dot" aria-hidden="true" />
                  <span className="lbl">{adminViewing ? shownName : "Owner overview"}</span>
                  <i className="fas fa-chevron-down caret" aria-hidden="true" />
                </button>
                {restOpen && (
                  <div className="owx-switch-pop" role="menu" aria-label="Switch restaurant">
                    <div className="hd">Switch restaurant</div>
                    <button type="button" className="rrow all" role="menuitem"
                      onClick={() => { setRestOpen(false); openRestaurant(null); }}>
                      <i className="fas fa-layer-group" aria-hidden="true" />
                      <span className="nm">All restaurants</span>
                    </button>
                    {myRests.map((r) => (
                      <button key={r.id} type="button" className="rrow" role="menuitem"
                        onClick={() => { setRestOpen(false); openRestaurant(r.id); }} title={`Open ${r.name}`}>
                        <span className="sw" style={{ background: r.accentColor }} aria-hidden="true" />
                        <span className="nm">{r.name}</span>
                        <span className="rv">{inr(r.revenueToday)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <span className="owx-scope">
                <span className="dot" aria-hidden="true" />
                <span className="lbl">{adminViewing ? shownName : "Owner overview"}</span>
              </span>
            )}
            {/* Owner-panel path (orientation inside /owner) — NOT the admin act-as bar.
                On the dashboard a drilled restaurant/dish appends as the tail (merged
                breadcrumb, owner 2026-07-26); "Dashboard" then becomes the way back. */}
            <nav className="owx-path" aria-label="Owner panel path">
              <Link href={withRid("/owner")} className="cr root">Owner</Link>
              <i className="fas fa-chevron-right sep root" aria-hidden="true" />
              {crumbTail.length > 0 ? (
                <>
                  <button type="button" className="cr root" style={{ background: "none", border: "none", padding: 0, font: "inherit", cursor: "pointer" }}
                    onClick={() => window.dispatchEvent(new CustomEvent("lfh:owner-open-restaurant", { detail: { rid: null } }))}>
                    {ownerSectionLabel(path)}
                  </button>
                  {crumbTail.map((t, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "inherit" }}>
                      <i className="fas fa-chevron-right sep root" aria-hidden="true" />
                      <span className="cr cur" aria-current={i === crumbTail.length - 1 ? "page" : undefined}>{t}</span>
                    </span>
                  ))}
                </>
              ) : (
                <span className="cr cur" aria-current="page">{ownerSectionLabel(path)}</span>
              )}
            </nav>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <ConnectionBadge pollMode />
            <button className="adm-icnbtn" onClick={toggleSkin} title={skin === "dark" ? "Switch to light" : "Switch to dark"} aria-label="Toggle light/dark theme">
              <i className={`fas ${skin === "dark" ? "fa-sun" : "fa-moon"}`} aria-hidden="true" />
            </button>
            {adminViewing ? (
              <button className="adm-icnbtn" onClick={exitAdminView} title="Exit admin view" aria-label="Exit admin view">
                <i className="fas fa-arrow-rotate-left" aria-hidden="true" />
              </button>
            ) : (
              <a className="adm-icnbtn" href="/api/panel-logout" title="Log out" aria-label="Log out">
                <i className="fas fa-right-from-bracket" aria-hidden="true" />
              </a>
            )}
          </div>
        </header>

        <main className="adm-main"><div className="owx-wrap">{children}</div></main>
      </div>

      {/* Hierarchy X-ray styles (same amber language as the manager panel's ribbon). */}
      <style jsx global>{`
        /* GREYED OUT (off-for-owner) — neutral mid-grey, clearly dimmer than enabled links,
           never near-black; stays clickable for the admin (owner 2026-07-28: grey, not golden). */
        .adm.owx .owx-navlink.xray-off { color: #8b919c !important; opacity: .55; filter: grayscale(1); }
        .adm.owx .owx-navlink.xray-off::after { content: ""; width: 6px; height: 6px; border-radius: 50%;
          background: #9aa0a6; margin-left: 6px; display: inline-block; vertical-align: middle; }
        .adm.owx .xray-zbtn { color: #b45309; border-color: color-mix(in srgb, #d97706 45%, transparent); }
        .adm.owx .xray-zpop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; min-width: 250px;
          background: var(--adm-card, #fff); border: 1px solid var(--adm-line, #ddd); border-radius: 12px; padding: 6px;
          box-shadow: 0 12px 32px rgba(0,0,0,.28); }
        .adm.owx .xray-zpop .zh { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--adm-muted,#888); padding: 6px 8px 4px; }
        .adm.owx .xray-zpop .zrow { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent;
          border: 0; border-radius: 8px; padding: 8px; font: inherit; font-size: 12.5px; color: inherit; cursor: pointer; }
        .adm.owx .xray-zpop .zrow:hover { background: color-mix(in srgb, #d97706 12%, transparent); }
        .adm.owx .xray-zpop .zrow .dot { width: 7px; height: 7px; border-radius: 50%; background: #d97706; flex-shrink: 0; }
        .adm.owx .xray-zpop .zrow small { color: var(--adm-muted,#888); margin-left: auto; }
        .adm.owx .xray-zpop .zsep { height: 1px; margin: 6px 4px; background: var(--adm-line, #ddd); }
        .adm.owx .xray-zpop .zrow.zsim { font-weight: 700; }
        .adm.owx .xray-zpop .zrow.zsim:hover { background: color-mix(in srgb, #6b7280 14%, transparent); }
      `}</style>
    </div>
  );
}
