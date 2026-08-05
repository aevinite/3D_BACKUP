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
//    indicator / Android gesture bar, but `env()` does NOT reliably resolve inside a
//    nested iframe (commonly 0). The TOP-LEVEL document does resolve it (app/layout sets
//    viewport-fit=cover), so we measure it here with a hidden probe and push real pixel
//    values into the same-origin iframe as `--safe-t` / `--safe-b`. Panel CSS reads
//    `max(env(...), var(--safe-b/t, 0px))`, so it works either way.
//
//    We reserve ONLY what the phone reports (env + the visualViewport gap) — NO blanket
//    Android fallback. Chrome draws under the GESTURE nav bar (edge-to-edge, Chrome 135+,
//    https://developer.chrome.com/docs/css-ui/edge-to-edge) and reports that overlap via
//    env() LIVE as it changes; with 3-BUTTON nav the page always ends ABOVE the buttons,
//    so any reserve there is a dead strip (the earlier hard 48px painted exactly that
//    dead band under the view-order pill on a Galaxy A36 — owner report 2026-07-21). The
//    "hidden under the nav bar" bug that 48px was papering over was really the 100vh
//    sizing bug in (1). The visualViewport resize listener below re-pushes when Chrome
//    slides between the two states.
export default function PanelFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);" +
      // LEFT/RIGHT too. They matter in LANDSCAPE on a notched phone or tablet — which is how
      // the waiter panel is actually held — and inside the iframe a bare env() reads 0 there
      // just like top/bottom, so four rules in the panel stylesheets had no side inset at all.
      "padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);";
    document.body.appendChild(probe);

    const push = () => {
      const cs = getComputedStyle(probe);
      const envTop = parseFloat(cs.paddingTop) || 0;
      const envBottom = parseFloat(cs.paddingBottom) || 0;
      const envLeft = parseFloat(cs.paddingLeft) || 0;
      const envRight = parseFloat(cs.paddingRight) || 0;
      // Some browsers under-report the overlap via env(): also MEASURE the gap between
      // the layout viewport and the visible visual viewport, and trust the larger signal.
      let measured = 0;
      try {
        const vv = window.visualViewport;
        if (vv) measured = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
      } catch { /* no visualViewport */ }
      if (measured > 120) measured = 0;   // a big gap is the on-screen keyboard, not the nav bar
      const bottom = Math.max(envBottom, measured);
      try {
        const doc = ref.current?.contentWindow?.document?.documentElement;
        if (doc) {
          doc.style.setProperty("--safe-t", envTop + "px");
          doc.style.setProperty("--safe-b", bottom + "px");
          doc.style.setProperty("--safe-l", envLeft + "px");
          doc.style.setProperty("--safe-r", envRight + "px");
        }
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
