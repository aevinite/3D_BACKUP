"use client";

import { useEffect, useRef, useState } from "react";
import { attachSafeAreaBridge } from "@/lib/safeAreaBridge";
import { useBackClose } from "@/lib/backStack";
import { useOwnerSkin, pushSkinTo } from "./useOwnerSkin";

// Owner panel → Manager mode (owner, 2026-08-02). Hosts the SAME live manager panel
// (public/panels/editor, ?ownermode=1) inside the owner cockpit. One engine per
// restaurant — identical floor/bills/ordering + realtime, so it stays in step with the
// manager/kitchen/tablet panels with zero extra plumbing. The panel itself hides
// Settings / Ratings / Audit / the Menu tab (the owner panel already has those).
//
// TWO SCREENS (owner, 2026-08-02: "there should be first screen to select the
// restaurant, and you can launch the manager mode"):
//   • >1 restaurant and none picked → a LAUNCHER of restaurant cards; tapping one
//     opens its floor. Hardware BACK inside the floor returns here (useBackClose),
//     and a slim "Switch restaurant" bar on top does the same by tap.
//   • 1 restaurant (or a ?rid deep link / admin act-as) → straight into the floor,
//     no ceremony.
//
// SKIN REPLICATION (owner, 2026-08-02: "it will replicate the mode you are in owner"):
// the shell broadcasts `lfh:owner-skin` on every toggle; we forward it into the
// running iframe as a postMessage so the floor flips light/dark the same instant the
// cockpit does — no reload, no refetch. On iframe load we push the current skin once,
// so even a stale ?skin= param in the URL can never leave the panel on the wrong mode.
export default function OwnerManagerMode({
  restaurants,
  initial,
  skin: initialSkin,
}: {
  restaurants: { id: string; name: string; accentColor?: string }[];
  initial: string;
  skin: "light" | "dark";
}) {
  const [rid, setRid] = useState<string | null>(initial || null);
  // Follow the cockpit's skin (shared with the Menu + Inventory embeds — one hook, so the
  // three can't drift apart again). The frame is told by message; its ?skin= is only ever
  // the value it was born with.
  const skin = useOwnerSkin(initialSkin);
  const frame = useRef<HTMLIFrameElement>(null);
  const skinRef = useRef(skin);
  skinRef.current = skin;
  const many = restaurants.length > 1;
  const current = restaurants.find((r) => r.id === rid);

  const pushSkin = (s: "light" | "dark") => pushSkinTo(frame.current, s);
  useEffect(() => { pushSkin(skin); }, [skin]);

  // Hardware BACK inside the floor peels back to the launcher (multi-restaurant only) —
  // project rule: every screen is a back step, never a whole-site exit.
  useBackClose("owner-mmode-panel", !!rid && many, () => setRid(null));

  // The iframe is created IMPERATIVELY, with src set BEFORE it enters the DOM. Rendered
  // as JSX, React inserts the element first and assigns src after — the browser treats
  // that as a NAVIGATION and adds a history entry ON TOP of the back-stack's layer, so
  // the phone's BACK blanked the floor instead of returning to the launcher (found by
  // the launcher back-test, 2026-08-02). An iframe whose src is set pre-insertion does
  // an initial load with no entry. Skin changes travel by postMessage, never a reload.
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!rid || !mount.current) return;
    const el = document.createElement("iframe");
    el.src = `/panels/editor/index.html?rid=${encodeURIComponent(rid)}&ownermode=1&skin=${skinRef.current}`;
    el.title = "Manager mode";
    el.className = "omm-frame";
    el.addEventListener("load", () => pushSkin(skinRef.current));
    mount.current.appendChild(el);
    frame.current = el;
    // The phone's notch / gesture-bar insets, pushed in as --safe-t/-b/-l/-r (T12, 2026-08-13).
    // Manager mode IS the floor on his own phone, so its "Send to kitchen" and undo bar are
    // exactly the controls that were landing in the gesture strip. Same bridge as PanelFrame.
    const stopSafeArea = attachSafeAreaBridge(() => el);
    return () => { stopSafeArea(); frame.current = null; el.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);

  // ── Screen 1: pick the restaurant ─────────────────────────────────────────────
  if (!rid) {
    return (
      <div className="omm-launch">
        <h1 className="adm-page-title">Manager mode</h1>
        <p className="adm-page-sub">Pick the restaurant whose floor you want to run — live tables, orders and bills, exactly like the manager panel.</p>
        <div className="omm-grid">
          {restaurants.map((r) => (
            <button key={r.id} type="button" className="omm-card" onClick={() => setRid(r.id)}>
              <span className="sw" style={{ background: r.accentColor || "#34d399" }} aria-hidden="true" />
              <span className="nm">{r.name}</span>
              <span className="go">Open the live floor <i className="fas fa-arrow-right" aria-hidden="true" /></span>
            </button>
          ))}
        </div>
        <style>{`
          .omm-launch{ max-width: 860px; }
          .omm-grid{ display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:14px; margin-top:18px; }
          .omm-card{ display:flex; flex-direction:column; align-items:flex-start; gap:10px; text-align:left;
            min-height:110px; padding:16px 18px; font:inherit; color:var(--text); cursor:pointer;
            background:var(--card); border:var(--border); border-radius:14px;
            transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease; }
          .omm-card:hover{ border-color:var(--accent); transform:translateY(-2px); box-shadow:0 10px 26px rgba(0,0,0,.18); }
          .omm-card:active{ transform:scale(.98); }
          .omm-card:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }
          .omm-card .sw{ width:12px; height:12px; border-radius:50%; flex:0 0 auto; }
          .omm-card .nm{ font-size:16px; font-weight:700; line-height:1.3; }
          .omm-card .go{ margin-top:auto; font-size:12.5px; font-weight:600; color:var(--accent);
            display:inline-flex; align-items:center; gap:7px; }
        `}</style>
      </div>
    );
  }

  // ── Screen 2: the floor ───────────────────────────────────────────────────────
  return (
    <div className="omm-full">
      {many && (
        <div className="omm-bar">
          <button type="button" className="omm-switchbtn" onClick={() => setRid(null)}>
            <i className="fas fa-arrow-right-arrow-left" aria-hidden="true" /> Switch restaurant
          </button>
          <span className="omm-cur">
            <span className="dot" style={{ background: current?.accentColor || "#34d399" }} aria-hidden="true" />
            {current?.name}
          </span>
        </div>
      )}
      <div ref={mount} className="omm-mount" />
      <style>{`
        /* Break out of the owner content padding / centered max-width — only on this page. */
        .adm-main:has(.omm-full){ padding:0 !important; overflow:hidden !important; }
        .owx-wrap:has(.omm-full){ max-width:none !important; margin:0 !important; height:100% !important; }
        .omm-full{ height:100%; display:flex; flex-direction:column; min-height:0; }
        .omm-mount{ flex:1 1 auto; min-height:0; display:flex; }
        .omm-frame{ flex:1 1 auto; width:100%; border:0; display:block; background:var(--bg, #0a0c10); }
        .omm-bar{ display:flex; align-items:center; gap:12px; padding:7px 12px; min-height:44px;
          border-bottom:1px solid var(--line, #1d2430); background:var(--card); }
        .omm-switchbtn{ display:inline-flex; align-items:center; gap:8px; min-height:32px; padding:5px 12px;
          font:inherit; font-size:12.5px; font-weight:700; color:var(--accent); cursor:pointer;
          background:transparent; border:1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius:9px; }
        .omm-switchbtn:hover{ background:color-mix(in srgb, var(--accent) 12%, transparent); }
        .omm-switchbtn:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }
        .omm-cur{ display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--text); }
        .omm-cur .dot{ width:9px; height:9px; border-radius:50%; }
      `}</style>
    </div>
  );
}
