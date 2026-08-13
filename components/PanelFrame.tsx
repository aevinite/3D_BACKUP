"use client";

import { useEffect, useRef } from "react";
import { attachSafeAreaBridge } from "@/lib/safeAreaBridge";

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

  // The measuring + pushing lives in lib/safeAreaBridge.ts so the owner console's embedded
  // panels can use the identical bridge (T12, 2026-08-13) — see that file for the why.
  useEffect(() => attachSafeAreaBridge(() => ref.current), []);

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
