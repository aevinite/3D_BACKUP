"use client";
// OwnerShell — the frame for the multi-restaurant OWNER panel (/owner). It reuses
// the SAME `.adm-*` chrome as the admin control room (AdminShell) so the two look
// and feel identical: a left sidebar, a topbar with a light/dark toggle + logout,
// and a scrollable content area. Token-driven, so it follows the warm light/dark
// themes automatically (the root layout's boot script sets data-theme on first paint).
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean };
// Full POS-grade sidebar. Real sections link to live pages; "soon" ones open a
// branded Coming-soon page so the menu is complete (like PetPooja/Toast) with no
// dead links — each lands somewhere intentional.
const NAV: NavItem[] = [
  { href: "/owner", label: "Dashboard", icon: "fa-gauge-high", exact: true },
  { href: "/owner/sales", label: "Sales & reports", icon: "fa-chart-line", soon: true },
  { href: "/owner/orders", label: "Orders & bills", icon: "fa-receipt", soon: true },
  { href: "/owner/menu", label: "Menu", icon: "fa-book-open", soon: true },
  { href: "/owner/inventory", label: "Inventory", icon: "fa-boxes-stacked", soon: true },
  { href: "/owner/staff", label: "Staff & powers", icon: "fa-users-gear" },
  { href: "/owner/customers", label: "Customers", icon: "fa-user-group", soon: true },
  { href: "/owner/marketing", label: "Marketing", icon: "fa-bullhorn", soon: true },
  { href: "/owner/online", label: "Online & apps", icon: "fa-truck-fast", soon: true },
  { href: "/owner/issues", label: "Feedback & issues", icon: "fa-triangle-exclamation" },
  { href: "/owner/report", label: "Earnings report", icon: "fa-file-invoice" },
  { href: "/owner/settings", label: "Settings", icon: "fa-gear", soon: true },
];

export default function OwnerShell({ children, adminViewing, restaurantName }: { children: React.ReactNode; adminViewing?: boolean; restaurantName?: string }) {
  const path = usePathname();
  const router = useRouter();
  const [skin, setSkin] = useState<"light" | "dark">("light");

  // Admin "exit view": clear the act-as cookie, then go back to the admin restaurants
  // hub. Only ever shown to the admin (the owner never reaches the adminViewing branch).
  const exitAdminView = async () => {
    try { await fetch("/api/admin/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) }); } catch {}
    router.push("/aevinite/restaurants");
  };

  // Aevidine panel skin: light = Apple frosted glass (default), dark = Neon. Scoped
  // to this panel via data-skin (shared with the admin shell) — guest menu untouched.
  useEffect(() => {
    try { const s = localStorage.getItem("aevidine_skin"); if (s === "dark" || s === "light") setSkin(s); } catch {}
  }, []);

  const toggleSkin = () => {
    setSkin((cur) => { const next = cur === "dark" ? "light" : "dark"; try { localStorage.setItem("aevidine_skin", next); } catch {} return next; });
  };

  const isActive = (n: NavItem) => (n.exact ? path === n.href : path.startsWith(n.href));

  return (
    <div className="adm" data-skin={skin}>
      <aside className="adm-side">
        <div className="adm-brand">
          <span className="mark">👑</span>
          <span className="who"><b>Owner</b><span>Aevidine</span></span>
        </div>
        <nav className="adm-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={isActive(n) ? "active" : ""} title={n.label}>
              <i className={`fas ${n.icon}`} aria-hidden="true" /> <span className="lbl">{n.label}</span>
              {n.soon && <span className="navsoon">Soon</span>}
            </Link>
          ))}
          {/* SECURITY: the owner panel deliberately has NO link to the admin control
              room (/aevinite). Admin is a higher privilege than owner and is gated by
              the admin password (AUTH_COOKIE) — owners must never see or reach it. */}
        </nav>
        <div className="adm-side-foot">Aevidine · Restaurant OS</div>
      </aside>

      <div className="adm-body">
        {/* ADMIN-ONLY breadcrumb/exit bar (never rendered for the real owner). Lets
            the admin see WHERE they are and step back: Restaurants › <name> › Owner. */}
        {adminViewing && (
          <div className="adm-adminbar" role="status">
            <nav className="adm-crumbs" aria-label="Breadcrumb">
              <Link href="/aevinite/restaurants">Restaurants</Link>
              <i className="fas fa-chevron-right sep" aria-hidden="true" />
              <span className="cur">{restaurantName}</span>
              <i className="fas fa-chevron-right sep" aria-hidden="true" />
              <span className="cur">Owner dashboard</span>
            </nav>
            <span className="adm-adminbar-tag"><i className="fas fa-user-shield" aria-hidden="true" /> Admin view</span>
            <button className="adm-btn" onClick={exitAdminView} title="Stop viewing this owner dashboard">
              <i className="fas fa-arrow-rotate-left" style={{ marginRight: 6 }} aria-hidden="true" /> Exit view
            </button>
          </div>
        )}
        <header className="adm-top">
          <button className="adm-rest" type="button" aria-label="Owner scope">
            <span className="dot" /> {adminViewing ? restaurantName : "Owner overview"}
          </button>
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

        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
