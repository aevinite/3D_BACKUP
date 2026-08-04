"use client";
// OfflineShell.tsx — registers the offline layer (public/sw.js) for every React
// surface: the guest menu, the owner panel, the admin console, and the pages that
// host the staff-panel iframes.
//
// WHY A COMPONENT AND NOT AN INLINE SCRIPT
//   Registration must happen after the page is interactive (it's not render-blocking
//   work), and it needs to react to updates: when a new version of the app ships, the
//   waiting worker is told to take over immediately so a device can't get stuck on an
//   old offline layer. Doing that from a mounted client component keeps it in one
//   readable place instead of a string of inlined JS.
//
// SAFETY
//   - Registration is skipped entirely when the browser has no service-worker support
//     (nothing breaks, the app just behaves exactly as it did before).
//   - `?nosw=1` on any URL unregisters and clears the caches — a one-URL escape hatch
//     if a device ever behaves oddly, without needing a deploy.
import { useEffect } from "react";

export default function OfflineShell() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // Escape hatch: /any/page?nosw=1 tears the whole offline layer off this device.
    if (new URLSearchParams(location.search).has("nosw")) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => { r.active?.postMessage({ type: "LFH_SW_KILL" }); r.unregister(); });
      }).catch(() => {});
      return;
    }

    let cancelled = false;
    // Held here (not returned from the async function, whose return value was discarded)
    // so the listener is genuinely removed on unmount.
    let offVisible: (() => void) | null = null;
    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;
        // A newly-installed worker should take over now rather than on some future
        // tab close — otherwise a staff device keeps the previous offline layer for
        // the rest of the shift.
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) next.postMessage({ type: "LFH_SKIP_WAITING" });
          });
        });
        // Check for a new version when the person comes back to the tab (staff leave
        // panels open for days).
        const onVisible = () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); };
        document.addEventListener("visibilitychange", onVisible);
        offVisible = () => document.removeEventListener("visibilitychange", onVisible);

        // ASK THE WORKER TO SAVE THIS PAGE. The worker can only store a page whose navigation it
        // HANDLED, and the first navigation to any URL happens before it controls this client — so
        // the page a person is looking at right now was not saved, and going offline and reloading
        // showed "this screen hasn't been opened on this device yet". Verified on the deployed
        // site: the shell only appeared from the SECOND visit. One request, skipped entirely when
        // the page is already stored (the worker checks), and only once we are controlled.
        const warm = () => {
          navigator.serviceWorker.controller?.postMessage({ type: "LFH_WARM_SHELL", url: location.href });
        };
        if (navigator.serviceWorker.controller) warm();
        // A brand-new registration claims the client a moment later, so wait for that instead of
        // giving up — this is exactly the first-ever visit the fix is for.
        else navigator.serviceWorker.addEventListener("controllerchange", warm, { once: true });
      } catch {
        /* registration failing must never break the page — we simply stay online-only */
      }
    };

    // Wait for idle so this never competes with the first paint.
    const start = () => { register(); };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    return () => { cancelled = true; if (offVisible) offVisible(); };
  }, []);

  return null;
}
