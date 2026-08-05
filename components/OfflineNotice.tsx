"use client";
// OfflineNotice.tsx — the honest offline strip for the REACT surfaces (guest menu,
// owner panel, admin console). Twin of public/panels/offline.js, which does the same
// job inside the staff panels.
//
// WHY IT MATTERS MOST ON A DASHBOARD
//   With the offline layer installed, an owner who opens their panel with no signal
//   still SEES numbers — the last ones this device saved. That's the right behaviour
//   (better than an error page), but silently showing yesterday's takings as if they
//   were live would be worse than showing nothing. So whenever a reply came from the
//   device instead of the server, this says so, with the time it was saved.
//
// HOW IT KNOWS
//   The service worker broadcasts LFH_SERVED_FROM_CACHE whenever it answers a read from
//   the device. That means every page is covered without editing a single fetch call
//   site — and a page that only ever gets live data never shows this strip at all.
import { useEffect, useRef, useState } from "react";

function ago(ts: number): string {
  if (!ts) return "earlier";
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "a moment ago";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m < 10 ? "0" : ""}${m} ${ap}`;
}

// The staff-panel host pages are just a frame around a panel that shows its OWN offline bar
// inside — a second strip here would say the same thing twice and could sit over the panel's
// bottom controls.
//
// The OWNER COCKPIT hosts that same panel on three of its pages (Menu → menuonly, Manager mode →
// ownermode, Inventory → invonly). They were missing from this list until 2026-08-05, so offline
// those pages showed the panel's bar inside the frame AND this fixed strip (bottom: 0,
// z-index 99990) across it — the exact duplication-and-overlap this check exists to prevent.
const isPanelHost = (path: string) =>
  /^\/(manager|kitchen|tablet)(\/|$)/.test(path)
  || /^\/r\/[^/]+\/(manager|kitchen|tablet)(\/|$)/.test(path)
  || /^\/owner\/(menu|manager|inventory)(\/|$)/.test(path);

export default function OfflineNotice() {
  const [offline, setOffline] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [, tick] = useState(0);
  const [muted, setMuted] = useState(true);    // stays muted until we know the route (SSR-safe)
  const [hasQueue, setHasQueue] = useState(false); // is this a surface whose writes are queued?

  useEffect(() => {
    setMuted(isPanelHost(location.pathname));
    // Only the GUEST surfaces have an on-device queue. This used to be any /r/ path, which
    // includes /r/<slug>/login — a staff sign-in page, not muted above — so a staff member
    // with no signal was told "Your order is saved and will send by itself" on a screen with
    // no order and no queue (guest sweep 2026-08-04). Match the guest routes only:
    // /r/<slug>/menu|item, the legacy /menu|/item, and /q/<code> (the printed table QR).
    setHasQueue(
      /^\/r\/[^/]+\/(menu|item)(\/|$)/.test(location.pathname) ||
        /^\/(menu|item)(\/|$)/.test(location.pathname) ||
        /^\/q\/[^/]+/.test(location.pathname),
    );
  }, []);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; at?: number } | null;
      if (d && d.type === "LFH_SERVED_FROM_CACHE") setSavedAt(d.at || Date.now());
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    // Keep the "12 min ago" honest without any network calls.
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
      clearInterval(t);
    };
  }, []);

  // Only speak up when there's something true to say. Two ways it goes quiet: coming back
  // online, and simply not hearing about any more saved replies for a while (otherwise one
  // slow read pinned "showing saved figures" to the screen until a reload).
  useEffect(() => { if (!offline) setSavedAt(0); }, [offline]);
  useEffect(() => {
    if (!savedAt || offline) return;
    const t = setTimeout(() => setSavedAt(0), 20000);
    return () => clearTimeout(t);
  }, [savedAt, offline]);
  // PUBLISH THIS BAR'S HEIGHT so the bottom sheets can keep their own controls clear of it.
  // It is a `position: fixed` strip at z-index 99990, and every bottom sheet (`.panel` — the
  // cart, the bill) is z-index 5000 and also sits at `bottom: 0`. So the strip painted straight
  // over the last thing in the sheet, which on the guest cart is the PLACE ORDER button: it was
  // sliced in half, and because the strip is a real element, taps on the covered part hit the
  // strip instead of the button (measured on a 360px phone: the button ran 704→748 and the
  // strip 728→780, so its bottom 20px were dead). A diner losing signal — the one moment the
  // offline queue exists for — could tap the part they could see and nothing happened.
  // Mirrors what public/panels/offline.js already does for the staff panels via `--offbar-h`.
  const barRef = useRef<HTMLDivElement | null>(null);
  const shown = !muted && (offline || !!savedAt);
  useEffect(() => {
    const root = document.documentElement;
    if (!shown) { root.style.setProperty("--lfh-offbar-h", "0px"); return; }
    // Re-measure on every render AND on resize: the text wraps to two lines on a phone, so a
    // one-shot measurement under-reserves exactly where space is tightest.
    const measure = () => {
      const h = barRef.current ? Math.round(barRef.current.getBoundingClientRect().height) : 0;
      root.style.setProperty("--lfh-offbar-h", `${h}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); root.style.setProperty("--lfh-offbar-h", "0px"); };
  }, [shown, offline, savedAt, hasQueue]);

  if (!shown) return null;

  const msg = offline
    ? savedAt
      ? `No internet — showing saved figures from ${ago(savedAt)}.`
      : "No internet — showing what's saved on this device."
    : `Connection is struggling — showing saved figures from ${ago(savedAt)}.`;

  return (
    <div
      role="status"
      ref={barRef}
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 99990,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: "9px 14px calc(9px + env(safe-area-inset-bottom))",
        background: offline ? "rgba(239,68,68,.94)" : "rgba(245,158,11,.94)",
        color: offline ? "#fff" : "#3b1d00",
        font: "700 12.5px/1.35 system-ui, sans-serif", textAlign: "center",
        boxShadow: "0 -6px 24px rgba(0,0,0,.28)",
        // NOTHING HERE IS TAPPABLE — it is a status line, not a control. Without this, the strip
        // absorbed every tap in the band it covers (see the note above where the height is
        // published). Belt AND braces: the reserved height stops it covering a control at all,
        // and this stops it swallowing a tap even if some future sheet forgets the padding.
        pointerEvents: "none",
      }}
    >
      <span aria-hidden="true">{offline ? "⚠️" : "⏳"}</span>
      <span>
        {msg}{" "}
        {/* Only the GUEST menu has a queue for what you do (lib/guestOutbox.ts). Promising
            "it's all saved" on the owner/admin screens would be a lie — their buttons post
            straight to the server. Say the true thing for each surface. */}
        <span style={{ fontWeight: 600, opacity: 0.9 }}>
          {hasQueue ? "Your order is saved and will send by itself." : "Changes you make now may not save until you're back."}
        </span>
      </span>
    </div>
  );
}
