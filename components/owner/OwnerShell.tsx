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

type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean; ent?: string };
type NavGroup = { label: string; quiet?: boolean; items: NavItem[] };

// Grouped nav: the real, working sections up top; future modules live in ONE
// quiet "Coming soon" group (they open branded Coming-soon pages) — a complete
// menu like the big POS panels, without their 300-report clutter.
const GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/owner", label: "Dashboard", icon: "fa-gauge-high", exact: true }],
  },
  {
    label: "Business",
    items: [
      // `ent` = the owner-entitlement key (mig 133) that must be ON for this section
      // to exist. Hidden from the real owner when off; tinted for the admin act-as.
      { href: "/owner/reports", label: "Reports", icon: "fa-file-invoice", ent: "reports" },
      { href: "/owner/staff", label: "Staff & powers", icon: "fa-users-gear", ent: "staff" },
      { href: "/owner/customers", label: "Customers", icon: "fa-user-group", ent: "customers" },
      { href: "/owner/issues", label: "Feedback & issues", icon: "fa-triangle-exclamation", ent: "issues" },
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
      { href: "/owner/menu", label: "Menu", icon: "fa-book-open", soon: true },
      { href: "/owner/inventory", label: "Inventory", icon: "fa-boxes-stacked", soon: true },
      { href: "/owner/marketing", label: "Marketing", icon: "fa-bullhorn", soon: true },
      { href: "/owner/online", label: "Online & apps", icon: "fa-truck-fast", soon: true },
    ],
  },
];

export default function OwnerShell({ children, adminViewing, restaurantName, initialSkin, entitlements }: {
  children: React.ReactNode; adminViewing?: boolean; restaurantName?: string; initialSkin?: "light" | "dark";
  // Owner-panel section entitlements (mig 133), resolved server-side by the layout.
  // Absent map (never happens in practice) = everything on.
  entitlements?: Record<string, boolean>;
}) {
  const path = usePathname();
  const router = useRouter();
  const [zonesOpen, setZonesOpen] = useState(false);
  // Hardware BACK closes the zones popout instead of leaving the page (project rule:
  // every popup registers). Self-noops while closed.
  useBackClose("owner-xray-zones", zonesOpen, () => setZonesOpen(false));
  const sectionOn = (it: NavItem) => !it.ent || !entitlements || entitlements[it.ent] !== false;
  // What the admin sees tinted (the X-ray zones): sections off for the real owner.
  const offSections = GROUPS.flatMap((g) => g.items).filter((it) => it.ent && !sectionOn(it));
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
  useEffect(() => { setRidPin(new URLSearchParams(window.location.search).get("rid")); }, []);
  const withRid = (href: string) => (ridPin ? `${href}${href.includes("?") ? "&" : "?"}rid=${ridPin}` : href);
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

  // Mobile (≤900px): the sidebar collapses to a horizontally-scrolling pill strip.
  // Pills past the first few (incl. the real "Feedback & issues") sit off-screen with
  // no hint, so after mount / route change, scroll the ACTIVE pill into view within the
  // strip (mirrors the staff page's scrollIntoView). block:"nearest" keeps it from
  // yanking the page vertically; desktop is untouched (the guard bails >900px).
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth > 900) return;
    const el = document.querySelector<HTMLElement>(".owx-nav .owx-navlink.active");
    el?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [path]);

  // "My restaurants" — the full list the owner owns, ALWAYS visible in the sidebar
  // (owner request 2026-07-06). The shared overview cache collapses this with the
  // dashboard's own overview fetch on a hard load (no duplicate read). It refreshes on
  // the same activity-gated 60s cadence as the dashboard so the sidebar's "revenue today"
  // no longer drifts stale against the live cards (audit 2026-07-07).
  const [myRests, setMyRests] = useState<{ id: string; name: string; accentColor: string; revenueToday: number }[]>([]);
  const refreshMyRests = useCallback(() => {
    const scp = ridPin ? `&scope=${ridPin}` : "";
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
      window.dispatchEvent(new CustomEvent("lfh:owner-open-restaurant", { detail: { rid } }));
    } else {
      const q = [rid ? `focus=${rid}` : "", ridPin ? `rid=${ridPin}` : ""].filter(Boolean).join("&");
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

  return (
    <div className="adm owx" data-skin={skin}>
      <aside className="owx-side">
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
                // Hidden below, tinted above: a section the admin removed disappears
                // for the real owner, but the admin act-as sees it amber-tinted (X-ray).
                if (!on && !adminViewing) return null;
                return (
                  <Link key={it.href} href={withRid(it.href)} className={`owx-navlink${isActive(it) ? " active" : ""}${on ? "" : " xray-off"}`}
                    aria-current={isActive(it) ? "page" : undefined}
                    title={on ? undefined : `${it.label} is off for this owner — you can still open it (admin view)`}>
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
            <span className="adm-adminbar-tag"><i className="fas fa-user-shield" aria-hidden="true" /> Admin view</span>
            {/* X-ray zone counter: which sections the real owner can't see. */}
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
                      // Jump straight to the admin setting that controls this section.
                      router.push(`/aevinite/access${ridPin ? `?rid=${ridPin}&` : "?"}focus=owner-panel`);
                    }}>
                      <span className="dot" aria-hidden="true" />{it.label}<small>change in Access</small>
                    </button>
                  ))}
                </div>
              )}
            </span>
            <button className="adm-btn" onClick={exitAdminView} title="Stop viewing this owner panel">
              <i className="fas fa-arrow-rotate-left" style={{ marginRight: 6 }} aria-hidden="true" /> Exit view
            </button>
          </div>
        )}
        <header className="owx-top">
          <span className="owx-scope">
            <span className="dot" aria-hidden="true" /> {adminViewing ? shownName : "Owner overview"}
          </span>
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
        .adm.owx .owx-navlink.xray-off { color: #d97706 !important; opacity: .72; }
        .adm.owx .owx-navlink.xray-off::after { content: ""; width: 6px; height: 6px; border-radius: 50%;
          background: #d97706; margin-left: 6px; display: inline-block; vertical-align: middle; }
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
      `}</style>
    </div>
  );
}
