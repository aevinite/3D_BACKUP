"use client";
// AdminShell — the calm, sectioned dashboard frame for every /aevinite page:
// a left sidebar (each section on its own page), a topbar with the restaurant
// context + a light/dark theme toggle + logout, and a scrollable content area.
// Token-driven, so it follows the app's warm light/dark themes automatically.
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import ReorderableNav, { type NavItem } from "@/components/admin/ReorderableNav";

// Full platform sidebar. Real sections link to live pages; "soon" ones open a
// branded Coming-soon page so the menu reads complete with no dead ends.
const NAV: NavItem[] = [
  { href: "/aevinite", label: "Overview", icon: "fa-gauge-high", exact: true },
  { href: "/aevinite/restaurants", label: "Restaurants", icon: "fa-store" },
  { href: "/aevinite/owners", label: "Owners", icon: "fa-crown", soon: true },
  { href: "/aevinite/users", label: "Users & access", icon: "fa-users" },
  { href: "/aevinite/floor", label: "Live floor", icon: "fa-chair" },
  { href: "/aevinite/analytics", label: "Analytics", icon: "fa-chart-pie", soon: true },
  { href: "/aevinite/logs", label: "Activity log", icon: "fa-scroll" },
  { href: "/aevinite/features", label: "Features", icon: "fa-toggle-on" },
  { href: "/aevinite/billing", label: "Billing & plans", icon: "fa-file-invoice-dollar", soon: true },
  { href: "/aevinite/health", label: "System health", icon: "fa-heart-pulse", soon: true },
  { href: "/aevinite/settings", label: "Settings", icon: "fa-gear" },
];

const RESTAURANT = "All restaurants"; // admin is top of the hierarchy — it sees every tenant, not one

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [skin, setSkin] = useState<"light" | "dark">("light");
  const [restMenu, setRestMenu] = useState(false);

  // Aevidine panel skin: light = Apple frosted glass (default), dark = Neon.
  // Scoped to this panel via data-skin — independent of the guest menu's theme.
  useEffect(() => {
    try { const s = localStorage.getItem("aevidine_skin"); if (s === "dark" || s === "light") setSkin(s); } catch {}
  }, []);

  const toggleSkin = () => {
    setSkin((cur) => { const next = cur === "dark" ? "light" : "dark"; try { localStorage.setItem("aevidine_skin", next); } catch {} return next; });
  };

  return (
    <div className="adm" data-skin={skin}>
      <aside className="adm-side">
        <div className="adm-brand">
          <span className="mark">✦</span>
          <span className="who"><b>Aevidine</b><span>Admin · all restaurants</span></span>
        </div>
        <ReorderableNav items={NAV} storageKey="lfh_admin_nav_order" pathname={path} />
        <div className="adm-side-foot">Aevidine · Restaurant OS</div>
      </aside>

      <div className="adm-body">
        <header className="adm-top">
          {/* Restaurant context — single-tenant today, the shell for many later. */}
          <div style={{ position: "relative" }}>
            <button className="adm-rest" onClick={() => setRestMenu((v) => !v)} aria-haspopup="menu" aria-expanded={restMenu}>
              <span className="dot" /> {RESTAURANT} <i className="fas fa-chevron-down" style={{ fontSize: 11, opacity: 0.6 }} aria-hidden="true" />
            </button>
            {restMenu && (
              <div role="menu" onMouseLeave={() => setRestMenu(false)}
                style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 240, background: "var(--card)", border: "var(--border)", borderRadius: 12, padding: 8, boxShadow: "0 16px 40px rgba(0,0,0,.28)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, background: "color-mix(in srgb, var(--accent) 16%, transparent)", fontWeight: 700, fontSize: 13.5 }}>
                  <i className="fas fa-check" style={{ color: "var(--accent)" }} aria-hidden="true" /> {RESTAURANT}
                </div>
                <Link href="/aevinite/restaurants" role="menuitem" onClick={() => setRestMenu(false)}
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", marginTop: 4, color: "var(--muted)", fontSize: 13, textDecoration: "none" }}>
                  <i className="fas fa-store" aria-hidden="true" /> Manage restaurants
                  <i className="fas fa-arrow-right" style={{ marginLeft: "auto", fontSize: 11 }} aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="adm-icnbtn" onClick={toggleSkin} title={skin === "dark" ? "Switch to light" : "Switch to dark"} aria-label="Toggle light/dark theme">
              <i className={`fas ${skin === "dark" ? "fa-sun" : "fa-moon"}`} aria-hidden="true" />
            </button>
            <a className="adm-icnbtn" href="/api/staff-logout" title="Log out" aria-label="Log out">
              <i className="fas fa-right-from-bracket" aria-hidden="true" />
            </a>
          </div>
        </header>

        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
