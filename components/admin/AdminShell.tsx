"use client";
// AdminShell — the dense SaaS ops-console frame for every /aevinite page
// (redesign 2026-07-04): a fixed 224px grouped sidebar, a topbar with a real
// restaurant quick-switcher (search → jump to /aevinite/restaurants?focus=slug),
// skin toggle + logout, and a 1280px content column. DARK is the default skin.
// The chrome uses NEW .adx-* classes + the `.adm.adx` token skin at the END of
// app/globals.css — the owner panel keeps the old `.adm` chrome untouched.
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ConnectionBadge from "@/components/ConnectionBadge";
import NotificationBell from "@/components/admin/NotificationBell";
import { useBackClose } from "@/lib/backStack";

type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean };
type NavGroup = { label: string; items: NavItem[]; quiet?: boolean };

// Grouped nav: Operate (daily work) / Manage (tenants & access) / Platform /
// Coming soon (quiet — placeholders, no dead ends).
// (Owner 2026-07-04: "Command" reads wrong → Dashboard. The old global "Features"
// page confused him — per-restaurant features already live in each restaurant's
// detail + the Access-control hub, so the nav entry is gone; the page itself stays
// reachable by URL until we delete it.)
const GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { href: "/aevinite", label: "Dashboard", icon: "fa-table-columns", exact: true },
      { href: "/aevinite/floor", label: "Live floor", icon: "fa-chair" },
      { href: "/aevinite/analytics", label: "Analytics", icon: "fa-chart-pie" },
      { href: "/aevinite/bill-audit", label: "Bills", icon: "fa-file-invoice-dollar" },
      { href: "/aevinite/repair", label: "Repair & support", icon: "fa-screwdriver-wrench" },
      { href: "/aevinite/logs", label: "Audit & logs", icon: "fa-scroll" },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/aevinite/restaurants", label: "Restaurants", icon: "fa-store" },
      { href: "/aevinite/owners", label: "Owners", icon: "fa-crown" },
      { href: "/aevinite/customers", label: "Customers", icon: "fa-user-group" },
      { href: "/aevinite/recycle", label: "Recycle bin", icon: "fa-trash-can" },
      { href: "/aevinite/access", label: "Access / Permissions", icon: "fa-key" },
      { href: "/aevinite/users", label: "Users", icon: "fa-users" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/aevinite/revenue", label: "Revenue", icon: "fa-chart-line" },
      { href: "/aevinite/usage", label: "Usage & cost", icon: "fa-gauge-high" },
      { href: "/aevinite/billing", label: "Billing & plans", icon: "fa-file-invoice" },
      { href: "/aevinite/health", label: "System health", icon: "fa-heart-pulse" },
      { href: "/aevinite/rate-limits", label: "Rate limits", icon: "fa-shield-halved" },
      { href: "/aevinite/settings", label: "Settings", icon: "fa-gear" },
    ],
  },
];

type Rest = { id: string; slug: string; name: string; active: boolean };

export default function AdminShell({ children, initialSkin }: { children: React.ReactNode; initialSkin?: "light" | "dark" }) {
  const path = usePathname();
  // DARK is the default skin (owner spec 2026-07-04) — light stays as the toggle.
  // The server passes the cookie value as `initialSkin` so SSR already emits the RIGHT
  // data-skin — no dark→light flash on load/refresh for admins who chose light (mirrors
  // the owner-panel fix 2026-07-06; before this the state defaulted to "dark" and only
  // flipped to light AFTER hydration, which is what caused the black flash). Falls back
  // to dark on a first-ever visit (no cookie yet).
  const [skin, setSkin] = useState<"light" | "dark">(initialSkin ?? "dark");
  useEffect(() => {
    // Reconcile with localStorage only if it and the SSR cookie disagree (rare) — keeps
    // the toggle working even if the cookie was cleared but localStorage kept. Also seed
    // the cookie from localStorage so admins who chose light BEFORE this fix (value only
    // in localStorage, no cookie yet) get a flash-free load next time, without re-toggling.
    try {
      const s = localStorage.getItem("aevidine_skin");
      if (s === "dark" || s === "light") {
        if (s !== skin) setSkin(s);
        if (!document.cookie.includes("aevidine_skin=")) {
          document.cookie = `aevidine_skin=${s}; path=/; max-age=31536000; samesite=lax`;
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleSkin = () => {
    setSkin((cur) => {
      const next = cur === "dark" ? "light" : "dark";
      try { localStorage.setItem("aevidine_skin", next); } catch {}
      // Persist to a cookie too so the NEXT server render starts on the right skin.
      try { document.cookie = `aevidine_skin=${next}; path=/; max-age=31536000; samesite=lax`; } catch {}
      return next;
    });
  };

  const isActive = (n: NavItem) => (n.exact ? path === n.href : path.startsWith(n.href));

  // Phone (≤900px) nav drawer. The .adx-burger/.adx-side.open/.adx-backdrop CSS shipped
  // 2026-07-08 but the button that toggles it never did — so on a phone the sidebar sat
  // off-screen with NO way to open it. This is that missing half (found 2026-07-20).
  const [navOpen, setNavOpen] = useState(false);
  // Hardware BACK closes the drawer instead of leaving the page (project rule: every
  // overlay registers). Self-noops while closed.
  useBackClose("admin-nav", navOpen, () => setNavOpen(false));
  // A nav click changes the route → close; widening past the breakpoint → close too
  // (otherwise the .open class + BACK layer silently linger on desktop).
  useEffect(() => { setNavOpen(false); }, [path]);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = (e: MediaQueryListEvent) => { if (!e.matches) setNavOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="adm adx" data-skin={skin}>
      {navOpen && <div className="adx-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className={"adx-side" + (navOpen ? " open" : "")} id="adminNav">
        <div className="adx-brand" title="Aevidine" tabIndex={0}>
          <span className="mark" style={{ background: "transparent", boxShadow: "none" }}>
            <img src="/brand/aevidine-mark.svg" alt="Aevidine" width={28} height={28} style={{ display: "block" }} />
          </span>
          <span className="who">
            <b>Aevidine</b><span>Platform admin</span>
            {/* draws in only on hover/focus of the brand */}
            <span className="adx-brand-line" aria-hidden="true" />
          </span>
        </div>
        <nav className="adx-nav" aria-label="Admin sections">
          {GROUPS.map((g) => (
            <div key={g.label} className={"adx-group" + (g.quiet ? " quiet" : "")}>
              <div className="adx-group-lbl">{g.label}</div>
              {g.items.map((n) => (
                // Navigating to a DIFFERENT page: the path-effect above closes the drawer
                // AFTER the route commits (closing in the click handler races the
                // router.push against the back-stack's history rewind and can bounce the
                // navigation back — 2026-07-20). Re-tapping the CURRENT page's link never
                // navigates, so that one closes here (no race possible).
                <Link key={n.href} href={n.href} className={"adx-navlink" + (isActive(n) ? " active" : "")} title={n.label}
                  onClick={() => { if (isActive(n)) setNavOpen(false); }}>
                  <i className={`fas ${n.icon}`} aria-hidden="true" />
                  <span className="lbl">{n.label}</span>
                  {n.soon && <span className="navsoon">Soon</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="adx-side-foot">Aevidine · Restaurant OS</div>
      </aside>

      <div className="adm-body">
        <header className="adx-top">
          <button type="button" className="adx-burger" onClick={() => setNavOpen((o) => !o)}
            aria-label={navOpen ? "Close menu" : "Open menu"} aria-expanded={navOpen} aria-controls="adminNav">
            <i className={`fas ${navOpen ? "fa-xmark" : "fa-bars"}`} aria-hidden="true" />
          </button>
          <RestaurantSwitcher />
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <ConnectionBadge />
            <NotificationBell />
            <button className="adm-icnbtn" onClick={toggleSkin} title={skin === "dark" ? "Switch to light" : "Switch to dark"} aria-label="Toggle light/dark theme">
              <i className={`fas ${skin === "dark" ? "fa-sun" : "fa-moon"}`} aria-hidden="true" />
            </button>
            {/* A FORM, not a link (sweep 2026-08-05): signing out changes state, so it is a POST.
                As a GET link, anything that merely pointed at /api/staff-logout could drop the
                admin back to the guest menu mid-work. Still one tap, still works with no JS. */}
            <form method="post" action="/api/staff-logout" style={{ display: "contents" }}>
              <button type="submit" className="adm-icnbtn" title="Sign out" aria-label="Sign out">
                <i className="fas fa-right-from-bracket" aria-hidden="true" />
              </button>
            </form>
          </div>
        </header>

        <main className="adm-main"><div className="adx-wrap">{children}</div></main>
      </div>
    </div>
  );
}

// RestaurantSwitcher — topbar quick jump to any restaurant. Fetches the list ONCE
// on first open (lazy, cached in state — no egress until the admin actually uses
// it), filters client-side, and picking a row jumps to the Restaurants page with
// ?focus=<slug> (that page scrolls to + highlights the row).
function RestaurantSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Rest[] | null>(null);
  const [loadErr, setLoadErr] = useState(false); // show Retry instead of a stuck "Loading…" (bug #7, 2026-07-06)
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadList = () => {
    setLoadErr(false);
    fetch("/api/admin/restaurants", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.error) setLoadErr(true); else setList((j.restaurants || []).map((r: Rest) => ({ id: r.id, slug: r.slug, name: r.name, active: r.active }))); })
      .catch(() => setLoadErr(true));
  };

  useEffect(() => {
    if (!open) return;
    // Reload every time the switcher opens (not just once) so a restaurant created/renamed/
    // suspended elsewhere shows its latest state instead of a stale cached list (audit
    // 2026-07-07). The old list stays visible until the refresh lands, so there's no flash.
    loadList();
    inputRef.current?.focus();
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
    // Only depend on `open` — depending on `list` would re-run when loadList() sets it,
    // causing an infinite refetch loop.
  }, [open]);

  const needle = q.trim().toLowerCase();
  const rows = (list || []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)).slice(0, 12);

  const pick = (r: Rest) => {
    setOpen(false); setQ("");
    router.push(`/aevinite/restaurants?focus=${encodeURIComponent(r.slug)}`);
    // If we're ALREADY on the Restaurants page, router.push only changes the query — the
    // page doesn't remount, so its mount-only `focus` read never re-fires and the jump did
    // nothing. Fire an event the page listens for so it opens the picked restaurant either
    // way (fresh mount reads the URL; already-mounted page reacts to this).
    window.dispatchEvent(new CustomEvent("adm:focus-restaurant", { detail: r.slug }));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && rows[hi]) { e.preventDefault(); pick(rows[hi]); }
  };

  return (
    <div className="adx-switch" ref={wrapRef}>
      <button type="button" className="adx-switch-trig" onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open} title="Jump to a restaurant">
        <i className="fas fa-store" aria-hidden="true" />
        <span className="t">Restaurants</span>
        <i className="fas fa-chevron-down chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="adx-switch-pop" role="listbox">
          <div className="adx-switch-search">
            <i className="fas fa-magnifying-glass" aria-hidden="true" />
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKeyDown}
              placeholder="Search name or slug…" aria-label="Search restaurants" />
          </div>
          {loadErr && list === null ? (
            <div className="adx-switch-empty">Couldn&rsquo;t load. <button type="button" className="adm-btn" style={{ marginLeft: 6 }} onClick={loadList}>Retry</button></div>
          ) : list === null ? (
            <div className="adx-switch-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="adx-switch-empty">No match.</div>
          ) : (
            rows.map((r, i) => (
              <button key={r.id} type="button" role="option" aria-selected={i === hi}
                className={"adx-switch-opt" + (i === hi ? " hi" : "")}
                onMouseEnter={() => setHi(i)} onClick={() => pick(r)}>
                <span className={"dot" + (r.active ? " on" : "")} aria-hidden="true" />
                <span className="nm">{r.name}</span>
                <span className="sl">{r.slug}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
