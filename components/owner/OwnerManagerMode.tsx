"use client";

import { useState } from "react";

// Owner panel → Manager mode (owner, 2026-08-02). Hosts the SAME live manager panel
// (public/panels/editor, ?ownermode=1) inside the owner cockpit, scoped to the picked
// restaurant. One engine per restaurant — identical floor/bills/ordering + realtime, so
// it stays in step with the manager/kitchen/tablet panels with zero extra plumbing. The
// panel itself hides Settings / Ratings / Audit / the Menu tab (the owner panel already
// has those) and wears the owner skin via the same var remap the Menu embed uses.
//
// FULL-BLEED: fills the entire owner content area edge-to-edge (same `:has()` trick as
// OwnerMenuEditor) — the owner sidebar is a ☰ drawer on this page (OwnerShell "mmode"),
// so the floor gets the whole screen, exactly like the real manager panel.
export default function OwnerManagerMode({
  restaurants,
  initial,
  skin,
}: {
  restaurants: { id: string; name: string }[];
  initial: string;
  skin: "light" | "dark";
}) {
  const [rid, setRid] = useState(initial);
  const src = `/panels/editor/index.html?rid=${encodeURIComponent(rid)}&ownermode=1&skin=${skin}`;
  const many = restaurants.length > 1;

  return (
    <div className="omm-full">
      {many && (
        <div className="omm-switch">
          <span>Restaurant</span>
          <select value={rid} onChange={(e) => setRid(e.target.value)}>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      )}
      <iframe key={rid} src={src} title="Manager mode" className="omm-frame" />
      <style>{`
        /* Break out of the owner content padding / centered max-width — only on this page. */
        .adm-main:has(.omm-full){ padding:0 !important; overflow:hidden !important; }
        .owx-wrap:has(.omm-full){ max-width:none !important; margin:0 !important; height:100% !important; }
        .omm-full{ height:100%; display:flex; flex-direction:column; min-height:0; }
        .omm-frame{ flex:1 1 auto; width:100%; border:0; display:block; background:var(--bg, #0a0c10); }
        .omm-switch{ display:flex; align-items:center; gap:9px; padding:9px 16px;
          border-bottom:1px solid var(--line, #1d2430); font-size:13px; font-weight:600; color:var(--muted, #9aa4b6); }
        .omm-switch select{ font:inherit; font-weight:700; color:var(--text, #e6ebf3);
          background:var(--card, #10141b); border:1px solid var(--line, #1d2430); border-radius:9px; padding:6px 11px; cursor:pointer; }
      `}</style>
    </div>
  );
}
