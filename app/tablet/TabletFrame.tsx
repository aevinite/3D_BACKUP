"use client";

import { useEffect, useRef } from "react";

// Hosts the waiter-tablet panel iframe AND bridges the phone's safe-area insets into it.
//
// WHY: the panel is a full-screen (`inset:0`) iframe. Its CSS pads the bottom-anchored controls
// (the in-flow "view order" footer, the SEND footer, the ☰ drawer, the options sheet) with
// `env(safe-area-inset-bottom)` so they clear the phone's home / gesture bar. But
// `env(safe-area-inset-*)` does NOT reliably resolve inside a nested iframe (it commonly reads 0),
// so on a real phone those controls sat only a few px above the very bottom edge — right where the
// gesture bar lives (audit 2026-07-09). The TOP-LEVEL document DOES resolve the insets (app/layout
// sets viewport-fit=cover), so we measure them here with a hidden probe and push the real pixel
// values into the same-origin iframe as `--safe-b` / `--safe-t`. The panel CSS reads
// `max(env(...), var(--safe-b/t))`, so it's correct whether or not the iframe's own env() works.
export default function TabletFrame({ src }: { src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);";
    document.body.appendChild(probe);

    const push = () => {
      const cs = getComputedStyle(probe);
      const top = cs.paddingTop || "0px";
      const bottom = cs.paddingBottom || "0px";
      try {
        const doc = ref.current?.contentWindow?.document?.documentElement;
        if (doc) { doc.style.setProperty("--safe-t", top); doc.style.setProperty("--safe-b", bottom); }
      } catch { /* iframe not ready yet — the load handler / delayed pushes will catch it */ }
    };

    const el = ref.current;
    const onLoad = () => push();
    el?.addEventListener("load", onLoad);
    window.addEventListener("resize", push);
    window.addEventListener("orientationchange", push);
    // A couple of delayed pushes cover the gap between the iframe's `load` and its <html> being
    // ready. Cheap, client-only, no network.
    const t1 = setTimeout(push, 400);
    const t2 = setTimeout(push, 1500);
    push();

    return () => {
      el?.removeEventListener("load", onLoad);
      window.removeEventListener("resize", push);
      window.removeEventListener("orientationchange", push);
      clearTimeout(t1); clearTimeout(t2);
      probe.remove();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      src={src}
      title="Waiter tablet"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
    />
  );
}
