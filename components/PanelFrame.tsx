"use client";

import { useEffect, useRef } from "react";

// Hosts a staff-panel iframe (tablet / manager / kitchen) AND bridges the phone's
// safe-area insets into it. EVERY panel host page must render this instead of a raw
// <iframe> — a raw iframe reintroduces the two phone bugs this solves:
//
// 1) SIZING — a `height:100vh` iframe is sized to the LARGE viewport (browser URL bar
//    hidden). When the URL bar IS showing (normal browsing on Android Chrome / Samsung
//    Internet), the bottom ~56px of the iframe hang BELOW the visible screen, so any
//    control docked to the iframe's bottom edge is cut off — and scrolling inside an
//    iframe never collapses the URL bar, so it stays cut forever (Samsung A36 audit
//    2026-07-20). `height:100%` on a fixed element tracks the browser's ACTUAL visible
//    viewport as the URL bar shows/hides, in every browser (no dvh support needed).
//
// 2) INSETS — the panel CSS pads its bottom-anchored controls (view-order footer, SEND
//    bar, drawers, sheets) with `env(safe-area-inset-bottom)` for the iPhone home
//    indicator / gesture bar, but `env()` does NOT reliably resolve inside a nested
//    iframe (commonly 0). The TOP-LEVEL document does resolve it (app/layout sets
//    viewport-fit=cover), so we measure it here with a hidden probe and push real pixel
//    values into the same-origin iframe as `--safe-t` / `--safe-b`. Android's 3-BUTTON
//    nav bar is not reported by env() at all, so when the phone reports nothing we
//    reserve the standard 48px on Android (owner's S24 Ultra audit 2026-07-09). Panel
//    CSS reads `max(env(...), var(--safe-b/t, 0px))`, so it works either way.
export default function PanelFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);";
    document.body.appendChild(probe);

    const push = () => {
      const cs = getComputedStyle(probe);
      const envTop = parseFloat(cs.paddingTop) || 0;
      const envBottom = parseFloat(cs.paddingBottom) || 0;
      // Some browsers under-report the gesture/nav area via env(): also MEASURE the gap
      // between the layout viewport and the visible visual viewport, and if both read 0
      // on Android, reserve the standard ~48px 3-button-nav height.
      let measured = 0;
      try {
        const vv = window.visualViewport;
        if (vv) measured = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
      } catch { /* no visualViewport */ }
      if (measured > 120) measured = 0;   // a big gap is the on-screen keyboard, not the nav bar
      let bottom = Math.max(envBottom, measured);
      if (bottom === 0 && /Android/i.test(navigator.userAgent || "")) bottom = 48;
      try {
        const doc = ref.current?.contentWindow?.document?.documentElement;
        if (doc) { doc.style.setProperty("--safe-t", envTop + "px"); doc.style.setProperty("--safe-b", bottom + "px"); }
      } catch { /* iframe not ready yet — the load handler / delayed pushes will catch it */ }
    };

    const el = ref.current;
    const onLoad = () => push();
    el?.addEventListener("load", onLoad);
    window.addEventListener("resize", push);
    window.addEventListener("orientationchange", push);
    // The URL bar showing/hiding fires visualViewport resize (NOT always window resize).
    const vv = window.visualViewport;
    vv?.addEventListener("resize", push);
    // A couple of delayed pushes cover the gap between the iframe's `load` and its <html>
    // being ready. Cheap, client-only, no network.
    const t1 = setTimeout(push, 400);
    const t2 = setTimeout(push, 1500);
    push();

    return () => {
      el?.removeEventListener("load", onLoad);
      window.removeEventListener("resize", push);
      window.removeEventListener("orientationchange", push);
      vv?.removeEventListener("resize", push);
      clearTimeout(t1); clearTimeout(t2);
      probe.remove();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      // height:100% (not 100vh!) so the frame ends at the VISIBLE bottom while the URL
      // bar is showing — see the sizing note above.
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", border: 0 }}
    />
  );
}
