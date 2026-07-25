"use client";

import { useState } from "react";

// Owner panel → Menu (2026-07-25). Hosts the SAME menu editor the manager panel uses
// (public/panels/editor, menu-only mode) inside the owner cockpit, scoped to the picked
// restaurant. One engine per restaurant — identical editing + the admin→owner "edit_menu"
// switch turns it into a read-only "View menu" automatically. Because it's the same engine
// it already syncs LIVE with the manager panel: realtime while a panel is open, and a fresh
// re-fetch every time the page is opened.
//
// FULL-BLEED: the editor fills the entire owner content area edge-to-edge (no boxed
// "screen-inside-a-screen"), keeping the owner sidebar as the menu bar. `:has()` cancels the
// content padding/max-width only on THIS page, so no shared-layout change.
export default function OwnerMenuEditor({
  restaurants,
  initial,
  skin,
}: {
  restaurants: { id: string; name: string }[];
  initial: string;
  skin: "light" | "dark";
}) {
  const [rid, setRid] = useState(initial);
  const src = `/panels/editor/index.html?rid=${encodeURIComponent(rid)}&menuonly=1&skin=${skin}`;
  const many = restaurants.length > 1;

  return (
    <div className="ome-full">
      {many && (
        <div className="ome-switch">
          <span>Restaurant</span>
          <select value={rid} onChange={(e) => setRid(e.target.value)}>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      )}
      <iframe key={rid} src={src} title="Menu editor" className="ome-frame" />
      <style>{`
        /* Break out of the owner content padding / centered max-width — only on this page. */
        .adm-main:has(.ome-full){ padding:0 !important; overflow:hidden !important; }
        .owx-wrap:has(.ome-full){ max-width:none !important; margin:0 !important; height:100% !important; }
        .ome-full{ height:100%; display:flex; flex-direction:column; min-height:0; }
        .ome-frame{ flex:1 1 auto; width:100%; border:0; display:block; background:var(--bg, #0a0c10); }
        .ome-switch{ display:flex; align-items:center; gap:9px; padding:9px 16px;
          border-bottom:1px solid var(--line, #1d2430); font-size:13px; font-weight:600; color:var(--muted, #9aa4b6); }
        .ome-switch select{ font:inherit; font-weight:700; color:var(--text, #e6ebf3);
          background:var(--card, #10141b); border:1px solid var(--line, #1d2430); border-radius:9px; padding:6px 11px; cursor:pointer; }
      `}</style>
    </div>
  );
}
