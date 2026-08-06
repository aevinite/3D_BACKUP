/* swreg.js — makes sure the offline layer (public/sw.js) is installed for the staff
 * panels too.
 *
 * The panels normally run inside an iframe on a React page, which already registers
 * the worker (components/OfflineShell.tsx) — and one registration covers the whole
 * origin, iframes included. But a panel is ALSO opened directly in some flows (and a
 * brand-new device's very first load may not be controlled yet), so each panel asks
 * for it as well. Registering twice is harmless: the browser keeps one worker.
 *
 * Kept deliberately tiny and dependency-free, and it never throws into the panel.
 */
(function () {
  if (!("serviceWorker" in navigator)) return;
  // Same escape hatch as the React side: ?nosw=1 removes the offline layer.
  try {
    if (new URLSearchParams(location.search).has("nosw")) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { if (r.active) r.active.postMessage({ type: "LFH_SW_KILL" }); r.unregister(); });
      });
      return;
    }
  } catch (e) { /* ignore */ }

  function reg() {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(function (r) {
      // Pick up a new deploy when a long-open panel comes back into view.
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") { try { r.update(); } catch (e) {} }
      });
      // AND SAVE THIS PANEL'S OWN PAGE. The comment at the top of this file already noted that
      // "a brand-new device's very first load may not be controlled yet" — this is the other half
      // of that. The worker can only store a page whose navigation it handled, so on a device's
      // first load the panel HTML was never saved: lose signal, reload, and a waiter got the
      // "hasn't been opened on this device yet" screen mid-service. Ask for it explicitly.
      // What this panel is made of, so the worker saves the CODE as well as the document — on a
      // first visit the chunks load before it controls the page, so it never sees them and an
      // offline reload rendered unstyled HTML. performance already holds the list.
      function pageAssets() {
        try {
          return performance.getEntriesByType("resource")
            .filter(function (r) { return ["script", "link", "css", "font", "img"].indexOf(r.initiatorType) >= 0; })
            .map(function (r) { return r.name; })
            .filter(function (n) { return n.indexOf(location.origin) === 0; });
        } catch (e) { return []; }
      }
      function warm() {
        try {
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "LFH_WARM_SHELL", url: location.href, assets: pageAssets() });
          }
        } catch (e) { /* never throw into the panel */ }
      }
      if (navigator.serviceWorker.controller) warm();
      else navigator.serviceWorker.addEventListener("controllerchange", warm, { once: true });
    }).catch(function () { /* offline layer is a bonus; never break the panel */ });
  }

  if (document.readyState === "complete") reg();
  else window.addEventListener("load", reg);
})();
