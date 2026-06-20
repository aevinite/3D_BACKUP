"use client";

// PointerCaptureGuard — fixes a mobile bug where the menu goes DEAD TO TAPS after
// you switch apps and come back (until you refresh), even though the page is still
// visibly updating (live orders etc.).
//
// CAUSE: the floating live-order strip (OrderTracker) and the table-status card
// (SessionStatusWidget) are DRAGGABLE; a touch grabs the finger via
// `setPointerCapture`. When Android backgrounds Chrome MID-TOUCH it often never
// fires `pointerup`/`pointercancel`, so that capture is NEVER released. On return,
// every tap keeps routing to that one captured element and the rest of the page
// can't be tapped — but JS keeps running, so live updates still render. A refresh
// clears the capture, which is the workaround the user was forced to use.
//
// FIX: track whichever element currently holds pointer capture (the
// `gotpointercapture` event bubbles to document), and release it the moment the
// page goes to the background (or comes back). Purely ADDITIVE: during normal use a
// drag releases itself and this never fires — it only cleans up a capture that got
// stranded by an app-switch. Covers both widgets today and any draggable added later.

import { useEffect } from "react";

export default function PointerCaptureGuard() {
  useEffect(() => {
    let held: { el: Element; id: number } | null = null;

    const onGot = (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.target instanceof Element) held = { el: pe.target, id: pe.pointerId };
    };
    const onLost = (e: Event) => {
      const pe = e as PointerEvent;
      if (held && held.id === pe.pointerId) held = null;
    };
    // Release a stranded capture. No-op if nothing is held or it's already released.
    const release = () => {
      if (!held) return;
      const { el, id } = held;
      held = null;
      try {
        (el as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(id);
      } catch {
        /* the capture was already gone — nothing to do */
      }
    };
    const onVisibility = () => { if (document.hidden) release(); };

    // capture phase so we still see these even if a handler stops propagation
    document.addEventListener("gotpointercapture", onGot, true);
    document.addEventListener("lostpointercapture", onLost, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", release);
    window.addEventListener("pageshow", release); // belt-and-braces on bfcache restore

    return () => {
      document.removeEventListener("gotpointercapture", onGot, true);
      document.removeEventListener("lostpointercapture", onLost, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("pageshow", release);
    };
  }, []);

  return null;
}
