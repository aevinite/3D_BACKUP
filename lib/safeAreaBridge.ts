// safeAreaBridge — tell a same-origin panel iframe where the phone's notch and gesture bar are.
//
// WHY THIS FILE EXISTS (T12 phone sweep, 2026-08-13). Inside an iframe, `env(safe-area-inset-*)`
// does NOT reliably resolve — it commonly reads 0 — so a panel that pads its bottom-docked
// controls with it gets no padding at all and those controls end up in the strip Android draws
// its gesture bar in. The TOP-LEVEL document does resolve env() (app/layout sets
// viewport-fit=cover), so the host measures the four insets and pushes them into the frame as
// `--safe-t/-b/-l/-r`. Every panel stylesheet reads
// `max(env(safe-area-inset-bottom, 0px), var(--safe-b, 0px))`, so it works either way.
//
// This lived only inside components/PanelFrame.tsx, which is why `/manager`, `/kitchen` and
// `/tablet` were fine while the OWNER console's three embedded panels — Manager mode,
// Menu, Inventory → Manage — were not: they build their own <iframe> and only ever pushed the
// skin. One bridge, three callers, no third copy to drift.
//
//   const stop = attachSafeAreaBridge(() => frameRef.current);
//   …later: stop();
//
// The pushes are cheap (one getComputedStyle on a hidden probe) and client-only — no network,
// no re-render, nothing for the panel to subscribe to.

/**
 * Measure the host's safe-area insets and keep pushing them into the iframe returned by
 * `getFrame`, until the returned cleanup runs. Safe to call before the frame exists — the
 * load handler and the two delayed pushes catch it.
 */
export function attachSafeAreaBridge(getFrame: () => HTMLIFrameElement | null | undefined): () => void {
  if (typeof document === "undefined") return () => {};

  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);" +
    // LEFT/RIGHT too. They matter in LANDSCAPE on a notched phone or tablet — which is how
    // the waiter panel is actually held — and inside the iframe a bare env() reads 0 there
    // just like top/bottom.
    "padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);";
  document.body.appendChild(probe);

  const push = () => {
    const cs = getComputedStyle(probe);
    const envTop = parseFloat(cs.paddingTop) || 0;
    const envBottom = parseFloat(cs.paddingBottom) || 0;
    const envLeft = parseFloat(cs.paddingLeft) || 0;
    const envRight = parseFloat(cs.paddingRight) || 0;
    // Some browsers under-report the overlap via env(): also MEASURE the gap between the layout
    // viewport and the visible visual viewport, and trust the larger signal.
    let measured = 0;
    try {
      const vv = window.visualViewport;
      if (vv) measured = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
    } catch { /* no visualViewport */ }
    if (measured > 120) measured = 0;   // a big gap is the on-screen keyboard, not the nav bar
    const bottom = Math.max(envBottom, measured);
    try {
      const doc = getFrame()?.contentWindow?.document?.documentElement;
      if (doc) {
        doc.style.setProperty("--safe-t", envTop + "px");
        doc.style.setProperty("--safe-b", bottom + "px");
        doc.style.setProperty("--safe-l", envLeft + "px");
        doc.style.setProperty("--safe-r", envRight + "px");
      }
    } catch { /* iframe not ready yet — the load handler / delayed pushes will catch it */ }
  };

  const el = getFrame();
  const onLoad = () => push();
  el?.addEventListener("load", onLoad);
  window.addEventListener("resize", push);
  window.addEventListener("orientationchange", push);
  // The URL bar showing/hiding fires visualViewport resize (NOT always window resize).
  const vv = window.visualViewport;
  vv?.addEventListener("resize", push);
  // A couple of delayed pushes cover the gap between the iframe's `load` and its <html> being
  // ready. Cheap, client-only, no network.
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
}
