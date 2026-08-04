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

// ── The way an embed SHOULD be mounted ───────────────────────────────────────────────
// Rendered as JSX, React inserts the <iframe> element FIRST and assigns `src` after — and
// the browser treats that as a NAVIGATION, so it pushes an entry onto the browser's history.
// The consequence is a swallowed Back press: on /owner/menu (and Inventory → Manage) the
// phone's Back button appeared to do nothing, and a multi-restaurant owner who had switched
// restaurant three times had to press Back four times to leave the page.
//
// OwnerManagerMode found and documented this on 2026-08-02 and built its frame imperatively
// to avoid it; the other two embeds were never converted (found 2026-08-04). This hook is
// that pattern, once, so all three share it:
//   • the element is created, given its src, and only THEN inserted → an initial load with
//     no history entry;
//   • `deps` (normally the restaurant id) rebuilds the frame, still with no entry;
//   • the live skin travels by postMessage on change and on load — never via the src, which
//     would reload the panel and lose whatever was open.
export function useEmbedFrame(src: string, skin: "light" | "dark", deps: unknown[]) {
  const mount = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const skinRef = useRef(skin);
  skinRef.current = skin;
  const srcRef = useRef(src);
  srcRef.current = src;

  useEffect(() => { pushSkinTo(frame.current, skin); }, [skin]);
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const el = document.createElement("iframe");
    el.src = srcRef.current;                      // set BEFORE insertion — no history entry
    el.className = "emb-frame";
    el.style.cssText = "flex:1 1 auto;width:100%;height:100%;border:0;display:block;background:var(--bg, #0a0c10)";
    el.addEventListener("load", () => pushSkinTo(el, skinRef.current));
    host.appendChild(el);
    frame.current = el;
    return () => { frame.current = null; el.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return mount;
}
