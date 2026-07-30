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
    }).catch(function () { /* offline layer is a bonus; never break the panel */ });
  }

  if (document.readyState === "complete") reg();
  else window.addEventListener("load", reg);
})();
