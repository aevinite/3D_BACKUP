"use client";
// OwnerShell — the frame for the multi-restaurant OWNER panel (/owner). It reuses
// the SAME `.adm-*` chrome as the admin control room (AdminShell) so the two look
// and feel identical: a left sidebar, a topbar with a light/dark toggle + logout,
// and a scrollable content area. Token-driven, so it follows the warm light/dark
// themes automatically (the root layout's boot script sets data-theme on first paint).
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/owner", label: "All restaurants", icon: "fa-store", exact: true },
  { href: "/owner/staff", label: "Staff & powers", icon: "fa-users-gear", exact: false },
];

export default function OwnerShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Match the toggle icon to whatever theme the boot script already applied.
  useEffect(() => {
    const cur = (document.documentElement.getAttribute("data-theme") as "light" | "dark") || "dark";
    setTheme(cur);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("lfh_theme", next); } catch {}
    setTheme(next);
  };

  const isActive = (n: (typeof NAV)[number]) => (n.exact ? path === n.href : path.startsWith(n.href));

  return (
    <div className="adm">
      <aside className="adm-side">
        <div className="adm-brand">
          <span className="mark">👑</span>
          <span className="who"><b>Owner</b><span>All restaurants</span></span>
        </div>
        <nav className="adm-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={isActive(n) ? "active" : ""}>
              <i className={`fas ${n.icon}`} aria-hidden="true" /> {n.label}
            </Link>
          ))}
          {/* Jump back to the single-restaurant control room. */}
          <Link href="/aevinite">
            <i className="fas fa-gauge-high" aria-hidden="true" /> Control room
          </Link>
        </nav>
        <div className="adm-side-foot">4D Menu · multi-restaurant SaaS</div>
      </aside>

      <div className="adm-body">
        <header className="adm-top">
          <button className="adm-rest" type="button" aria-label="Owner scope">
            <span className="dot" /> Owner overview
          </button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="adm-icnbtn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light" : "Switch to dark"} aria-label="Toggle light/dark theme">
              <i className={`fas ${theme === "dark" ? "fa-sun" : "fa-moon"}`} aria-hidden="true" />
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
