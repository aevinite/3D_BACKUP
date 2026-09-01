"use client";

import { useRef, useState } from "react";
import { useOwnerSkin, useEmbedFrame } from "./useOwnerSkin";

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
  // The cockpit's light/dark toggle reaches this embed LIVE (2026-08-03) — by message, so
  // the editor never reloads mid-edit. See components/owner/useOwnerSkin.ts.
  const liveSkin = useOwnerSkin(skin);
  // Mounted IMPERATIVELY (useEmbedFrame): a JSX <iframe> makes the browser record a history
  // entry, so the phone's Back button was swallowed once per mount — and `key={rid}` meant
  // every restaurant switch added another (found 2026-08-04). The `?skin=` in the src is only
  // ever the skin the frame was BORN with; live changes travel by postMessage.
  const bornSkin = useRef(liveSkin).current;
  const src = `/panels/editor/index.html?rid=${encodeURIComponent(rid)}&menuonly=1&skin=${bornSkin}`;
  const mount = useEmbedFrame(src, liveSkin, [rid]);
  // ONE RESTAURANT = NO BAR AT ALL (owner, 2026-09-01, STANDING).
  // *"If the owner has only one restaurant, then there shouldn't be any kind of bar only like to
  // switch the restaurant. If they have two then only it should have."* — so this is a hard rule,
  // not a nicety: a switcher offering exactly one choice is a control that does nothing, taking a
  // row of height off the editor on every screen, and the great majority of owners hold one
  // restaurant. It has always behaved this way; it is written down now so nobody "improves" it into
  // an always-visible header showing the current restaurant's name. The admin act-as branch of
  // app/owner/menu/page.tsx resolves exactly one restaurant too, so the bar is correctly absent
  // there as well. Guarded: verify:owner-panel §15 (static) and P21545 (driven).
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
      <div ref={mount} className="ome-mount" />
      <style>{`
        /* Break out of the owner content padding / centered max-width — only on this page. */
        .adm-main:has(.ome-full){ padding:0 !important; overflow:hidden !important; }
        .owx-wrap:has(.ome-full){ max-width:none !important; margin:0 !important; height:100% !important; }
        .ome-full{ height:100%; display:flex; flex-direction:column; min-height:0; }
        .ome-mount{ flex:1 1 auto; min-height:0; display:flex; }
        .ome-mount .emb-frame{ flex:1 1 auto; width:100%; border:0; display:block; background:var(--bg, #0a0c10); }
        /* --border-c, NOT --line (T13, sweep #7, 2026-08-27). The --line token is declared by the PANEL
           stylesheets (editor / kitchen / tablet) and by nothing in the owner or admin console, so
           inside this cockpit it always fell through to the hard-coded #1d2430 — a dark navy, which
           is right on the dark skin and a heavy wrong-coloured hairline on the light one. --border-c
           is the console's own border colour and is declared in BOTH skins, so this bar now matches
           whichever one you are in. Same for the select below. */
        .ome-switch{ display:flex; align-items:center; gap:9px; padding:9px 16px;
          border-bottom:1px solid var(--border-c, #1d2430); font-size:13px; font-weight:600; color:var(--muted, #9aa4b6); }
        .ome-switch select{ font:inherit; font-weight:700; color:var(--text, #e6ebf3);
          background:var(--card, #10141b); border:1px solid var(--border-c, #1d2430); border-radius:9px; padding:6px 11px; cursor:pointer; }
      `}</style>
    </div>
  );
}
