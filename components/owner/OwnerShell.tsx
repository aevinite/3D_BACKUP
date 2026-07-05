"use client";
// OwnerShell (redesign 2026-07-04) — the frame for the OWNER panel (/owner).
// Dense console chrome on the `.adm.owx` skin: DARK by default (light behind the
// toggle), grouped 224px sidebar that collapses to a pill row ≤900px, emerald
// accent (owner = money) vs the admin console's blue. The owner panel keeps NO
// link to /aevinite — admin is a higher, password-gated privilege.
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { inr } from "@/components/admin/shared";

type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean };
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
      { href: "/owner/reports", label: "Reports", icon: "fa-file-invoice" },
      { href: "/owner/staff", label: "Staff & powers", icon: "fa-users-gear" },
      { href: "/owner/issues", label: "Feedback & issues", icon: "fa-triangle-exclamation" },
    ],
  },
  {
    label: "Coming soon",
    quiet: true,
    items: [
      { href: "/owner/menu", label: "Menu", icon: "fa-book-open", soon: true },
      { href: "/owner/inventory", label: "Inventory", icon: "fa-boxes-stacked", soon: true },
      { href: "/owner/customers", label: "Customers", icon: "fa-user-group", soon: true },
      { href: "/owner/marketing", label: "Marketing", icon: "fa-bullhorn", soon: true },
      { href: "/owner/online", label: "Online & apps", icon: "fa-truck-fast", soon: true },
      { href: "/owner/settings", label: "Settings", icon: "fa-gear", soon: true },
    ],
  },
];

export default function OwnerShell({ children, adminViewing, restaurantName }: { children: React.ReactNode; adminViewing?: boolean; restaurantName?: string }) {
  const path = usePathname();
  const router = useRouter();
  // Admin scope pin (bug C1, 2026-07-05): when the admin drills into ONE restaurant
  // the URL carries ?rid=<id>. Carry it across EVERY sidebar link so navigating
  // dashboard→reports→staff keeps this tab pinned to that restaurant instead of
  // falling back to the browser-wide act-as cookie (which a second tab can overwrite).
  const [ridPin] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("rid"));
  const withRid = (href: string) => (ridPin ? `${href}${href.includes("?") ? "&" : "?"}rid=${ridPin}` : href);
  // Dark is the console default; the old stored preference still wins.
  const [skin, setSkin] = useState<"light" | "dark">("dark");

  useEffect(() => {
    try { const s = localStorage.getItem("aevidine_skin"); if (s === "dark" || s === "light") setSkin(s); } catch {}
  }, []);

  // "My restaurants" — the full list the owner owns, ALWAYS visible in the sidebar
  // (owner request 2026-07-06). ONE fetch of the already-pre-aggregated overview per
  // hard page load (the layout survives client-side navigation, so this doesn't
  // re-fetch when hopping Dashboard→Reports); the dashboard keeps its own live copy.
  const [myRests, setMyRests] = useState<{ id: string; name: string; accentColor: string; revenueToday: number }[]>([]);
  useEffect(() => {
    let dead = false;
    const scp = ridPin ? `&scope=${ridPin}` : "";
    fetch(`/api/owner/overview?_=1${scp}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (dead || !Array.isArray(j?.restaurants)) return;
        setMyRests(j.restaurants.map((r: { id: string; name: string; accentColor?: string; revenueToday?: number }) => ({
          id: r.id, name: r.name, accentColor: r.accentColor || "#34d399", revenueToday: r.revenueToday || 0,
        })));
      })
      .catch(() => {});
    return () => { dead = true; };
  }, [ridPin]);

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
  const toggleSkin = () => {
    setSkin((cur) => { const next = cur === "dark" ? "light" : "dark"; try { localStorage.setItem("aevidine_skin", next); } catch {} return next; });
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
              {g.items.map((it) => (
                <Link key={it.href} href={withRid(it.href)} className={`owx-navlink${isActive(it) ? " active" : ""}`}
                  aria-current={isActive(it) ? "page" : undefined}>
                  <i className={`fas ${it.icon}`} aria-hidden="true" />
                  {it.label}
                  {it.soon && <span className="navsoon">Soon</span>}
                </Link>
              ))}
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
              <Link href="/aevinite/restaurants">Restaurants</Link>
              <i className="fas fa-chevron-right sep" aria-hidden="true" />
              <span className="cur">{restaurantName}</span>
              <i className="fas fa-chevron-right sep" aria-hidden="true" />
              <span className="cur">Owner panel</span>
            </nav>
            <span className="adm-adminbar-tag"><i className="fas fa-user-shield" aria-hidden="true" /> Admin view</span>
            <button className="adm-btn" onClick={exitAdminView} title="Stop viewing this owner panel">
              <i className="fas fa-arrow-rotate-left" style={{ marginRight: 6 }} aria-hidden="true" /> Exit view
            </button>
          </div>
        )}
        <header className="owx-top">
          <span className="owx-scope">
            <span className="dot" aria-hidden="true" /> {adminViewing ? restaurantName : "Owner overview"}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
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
    </div>
  );
}
