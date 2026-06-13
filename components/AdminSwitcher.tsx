// The ADMIN-ONLY floating panel switcher.
//
// Rules (owner): only an admin sees it — a normal customer on /menu, or anyone
// who opens a single panel standalone, must NOT see it. It floats, can be
// dragged anywhere, and opens a dropdown to jump between panels. Its position is
// remembered between visits.
//
// "Admin mode" for now = a localStorage flag `lfh_admin` set to "1" (the /admin
// page sets it). A real password login replaces this later (piece 5). Because we
// gate on that flag, the switcher never shows for a plain customer.
"use client";

import { useEffect, useRef, useState } from "react";

// The panels you can jump to. Order matters — admin first (home).
const PANELS = [
  { href: "/admin", label: "Admin", icon: "🛠️" },
  { href: "/menu", label: "Menu", icon: "🍽️" },
  { href: "/editor", label: "Editor", icon: "✏️" },
  { href: "/kitchen", label: "Kitchen", icon: "👨‍🍳" },
  { href: "/tablet", label: "Tablet", icon: "📋" },
];

export default function AdminSwitcher() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  // Position of the floating pill (top-right by default).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);

  // Decide admin-or-not + restore saved position, once, in the browser.
  useEffect(() => {
    try {
      // Admin = signed in to the staff gate. The login sets a readable flag
      // cookie (the real auth cookie is HttpOnly and can't be read here). So a
      // plain customer (no cookie) never sees the switcher.
      setIsAdmin(document.cookie.split("; ").some((c) => c === "lfh_is_staff=1"));
      const saved = localStorage.getItem("lfh_switcher_pos");
      if (saved) setPos(JSON.parse(saved));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  // Default position (top-right) if none saved yet — done after mount so we can
  // read the window size without breaking server rendering.
  useEffect(() => {
    if (pos === null && isAdmin) {
      setPos({ x: window.innerWidth - 150, y: 16 });
    }
  }, [pos, isAdmin]);

  // Dragging: pointer down on the handle starts a drag; move updates position;
  // up saves it. `moved` lets us tell a drag apart from a click.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!elRef.current) return;
    const rect = elRef.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current.moved = true;
    const x = Math.max(4, Math.min(window.innerWidth - 60, e.clientX - dragRef.current.dx));
    const y = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - dragRef.current.dy));
    setPos({ x, y });
  };
  const onPointerUp = () => {
    if (dragRef.current) {
      if (pos) {
        try {
          localStorage.setItem("lfh_switcher_pos", JSON.stringify(pos));
        } catch {
          /* ignore */
        }
      }
      dragRef.current = null;
    }
  };

  if (!isAdmin || !pos) return null;

  return (
    <div
      ref={elRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 2147483000, // sit above everything, including panel UIs
        fontFamily: "system-ui, sans-serif",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {/* The draggable pill. Click toggles the dropdown; drag moves it. */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => {
          // Only treat as a click if we didn't just drag.
          if (!dragRef.current?.moved) setOpen((o) => !o);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#0b1220",
          color: "#dbe7ff",
          border: "1px solid #2a3a5f",
          borderRadius: 999,
          padding: "8px 14px",
          fontSize: 14,
          fontWeight: 600,
          cursor: "grab",
          boxShadow: "0 6px 20px rgba(0,0,0,.35)",
        }}
        title="Switch panel · drag to move"
      >
        ⠿ Panels ▾
      </button>

      {open && (
        <div
          style={{
            marginTop: 6,
            background: "#0b1220",
            border: "1px solid #2a3a5f",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,.45)",
            minWidth: 160,
          }}
        >
          {PANELS.map((p) => (
            <a
              key={p.href}
              href={p.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                color: "#dbe7ff",
                textDecoration: "none",
                fontSize: 14,
                borderBottom: "1px solid #16223c",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#16223c")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontSize: 16 }}>{p.icon}</span>
              {p.label}
            </a>
          ))}
          {/* Sign out of the staff gate. */}
          <a
            href="/api/staff-logout"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", color: "#f87171", textDecoration: "none", fontSize: 14 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#16223c")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ fontSize: 16 }}>🚪</span>
            Log out
          </a>
        </div>
      )}
    </div>
  );
}
