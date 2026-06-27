"use client";
// ReorderableNav (F3) — the shared sidebar nav for AdminShell + OwnerShell with an
// "Arrange" edit mode: tap Arrange, drag items to choose their order, tap Done. The
// order persists per-panel in localStorage. Out of edit mode it renders normal <Link>s
// (so the F2 hover-rail + active states are unchanged); in edit mode items become
// draggable rows with a grip and DON'T navigate. Native HTML5 drag — no extra deps.
import Link from "next/link";
import { useEffect, useState } from "react";

export type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean };

export default function ReorderableNav({ items, storageKey, pathname }: { items: NavItem[]; storageKey: string; pathname: string }) {
  const [order, setOrder] = useState<string[]>(() => items.map((i) => i.href));
  const [editing, setEditing] = useState(false);
  const [dragHref, setDragHref] = useState<string | null>(null);

  // Load the saved order once. Merge defensively: keep saved hrefs that still exist,
  // then append any NEW nav items the saved order didn't know about (so adding a
  // section later never hides it). Drop saved hrefs that no longer exist.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const saved: string[] = raw ? JSON.parse(raw) : [];
      const known = new Set(items.map((i) => i.href));
      const merged = [
        ...saved.filter((h) => known.has(h)),
        ...items.map((i) => i.href).filter((h) => !saved.includes(h)),
      ];
      setOrder(merged);
    } catch {}
  }, [storageKey, items]);

  const persist = (next: string[]) => {
    setOrder(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };

  const ordered = order.map((h) => items.find((i) => i.href === h)).filter(Boolean) as NavItem[];
  const isActive = (n: NavItem) => (n.exact ? pathname === n.href : pathname.startsWith(n.href));

  const onDrop = (targetHref: string) => {
    if (!dragHref || dragHref === targetHref) { setDragHref(null); return; }
    const next = [...order];
    const from = next.indexOf(dragHref);
    const to = next.indexOf(targetHref);
    if (from < 0 || to < 0) { setDragHref(null); return; }
    next.splice(from, 1);
    next.splice(to, 0, dragHref);
    persist(next);
    setDragHref(null);
  };

  return (
    <nav className={"adm-nav" + (editing ? " editing" : "")}>
      {ordered.map((n) =>
        editing ? (
          <div key={n.href} className={"adm-nav-drag" + (dragHref === n.href ? " dragging" : "")}
            draggable role="button" aria-grabbed={dragHref === n.href}
            onDragStart={() => setDragHref(n.href)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(n.href)}
            onDragEnd={() => setDragHref(null)}>
            <i className="fas fa-grip-vertical adm-nav-grip" aria-hidden="true" />
            <i className={`fas ${n.icon}`} aria-hidden="true" /> <span className="lbl">{n.label}</span>
            {n.soon && <span className="navsoon">Soon</span>}
          </div>
        ) : (
          <Link key={n.href} href={n.href} className={isActive(n) ? "active" : ""} title={n.label}>
            <i className={`fas ${n.icon}`} aria-hidden="true" /> <span className="lbl">{n.label}</span>
            {n.soon && <span className="navsoon">Soon</span>}
          </Link>
        )
      )}
      {/* Arrange lives at the BOTTOM as a subtle footer control — it's rarely used, so it
          no longer clutters the top of the menu (owner 2026-06-27). */}
      <button type="button" className={"adm-nav-edit" + (editing ? " editing" : "")} onClick={() => setEditing((v) => !v)}
        title={editing ? "Done arranging" : "Arrange menu order"} aria-pressed={editing}>
        <i className={`fas ${editing ? "fa-check" : "fa-arrows-up-down-left-right"}`} aria-hidden="true" />
        <span className="lbl">{editing ? "Done" : "Arrange menu"}</span>
      </button>
    </nav>
  );
}
