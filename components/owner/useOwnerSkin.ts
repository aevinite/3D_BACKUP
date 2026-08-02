"use client";

import { useEffect, useRef, useState } from "react";

// ONE place that answers "which skin is the owner cockpit wearing RIGHT NOW?", and one
// place that carries that answer into an embedded staff-panel iframe (Manager mode, Menu,
// Inventory). It exists because the three embeds each had their own idea of the skin and
// drifted apart (owner, 2026-08-03: "I changed the colour to white, then I go to parcel and
// it shifts to dark"). Two rules live here, both learned the hard way:
//
//   • the iframe's `?skin=` is only ever the value the frame was BORN with. Putting the
//     LIVE value in `src` makes every toggle re-navigate the iframe — the floor reloads,
//     every panel fetch runs again, and whatever was open on screen is lost.
//   • so the live value travels as a postMessage — pushed on every change AND on the
//     frame's `load` (a frame that finishes loading just after a toggle would otherwise
//     stay on the skin baked into its URL). The panel side is `applyEmbedSkin()` in
//     public/panels/editor/app.js, which is the single writer of the skin classes there.
export function useOwnerSkin(initial: "light" | "dark") {
  const [skin, setSkin] = useState<"light" | "dark">(initial);
  useEffect(() => {
    // The SSR cookie can lag a toggle made on another page — reconcile once on mount,
    // then track the shell's live event.
    try {
      const s = localStorage.getItem("aevidine_skin");
      if (s === "dark" || s === "light") setSkin(s);
    } catch {}
    const onSkin = (e: Event) => {
      const s = (e as CustomEvent).detail;
      if (s === "dark" || s === "light") setSkin(s);
    };
    window.addEventListener("lfh:owner-skin", onSkin);
    return () => window.removeEventListener("lfh:owner-skin", onSkin);
  }, []);
  return skin;
}

export function pushSkinTo(frame: HTMLIFrameElement | null | undefined, skin: "light" | "dark") {
  try {
    frame?.contentWindow?.postMessage({ type: "lfh-owner-skin", skin }, window.location.origin);
  } catch {}
}

// For a JSX <iframe>: `bornSkin` goes in the src (fixed forever), `frame` + `onLoad` keep
// it in step afterwards. Never interpolate the live skin into the src.
export function useSkinFrame(skin: "light" | "dark") {
  const frame = useRef<HTMLIFrameElement>(null);
  const born = useRef(skin);
  const live = useRef(skin);
  live.current = skin;
  useEffect(() => { pushSkinTo(frame.current, skin); }, [skin]);
  return { frame, bornSkin: born.current, onLoad: () => pushSkinTo(frame.current, live.current) };
}
