"use client";
// warmData.ts — HAND THE OFFLINE LAYER A READ THE PAGE HAS ALREADY RECEIVED.
//
// THE GAP THIS CLOSES (measured on the deployed site, 2026-08-07). The offline layer promises that
// a screen you have opened will open again with no internet, showing its last known state. For the
// guest menu that was only true from the SECOND visit:
//
//   visit 1  →  no saved read  →  an offline reload rendered a correctly styled, branded page
//                                 with NO DISHES on it
//   visit 2  →  saved read     →  the full menu, plus the honest "showing saved figures" strip
//
// The cause is the same race the page's CODE used to lose: the worker only handles requests once it
// CONTROLS the client, and the menu's data fetch fires before that on a first visit. The code half
// was fixed by asking the worker to fetch the missing files (LFH_WARM_SHELL). Doing that for a READ
// would mean fetching the menu a second time on every diner's first visit — a real per-device cost,
// and egress is the one budget this project treats as non-negotiable.
//
// So nothing is re-fetched. The page ALREADY has the payload in memory; it simply hands it over,
// and the worker stores it under the same key the next read will look for. Zero extra requests,
// zero extra bytes off the server — the device just keeps what it was already given.
//
// The worker validates everything it is handed (same origin, a read family it already caches, a
// size cap, and it never overwrites something it has stored itself). See public/sw.js →
// LFH_WARM_DATA.

/**
 * Give the service worker a copy of a read this page just received, so the same screen can open
 * offline on a FIRST visit rather than only on the second.
 *
 * Deliberately silent and best-effort: this is a bonus, and it must never affect the page. Safe to
 * call on every load — the worker skips anything it has already saved.
 */
export function warmDataCache(url: string, payload: unknown): void {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const send = () => {
      try {
        const c = navigator.serviceWorker.controller;
        if (!c) return;
        c.postMessage({
          type: "LFH_WARM_DATA",
          url: new URL(url, location.origin).href,
          body: JSON.stringify(payload),
        });
      } catch { /* never throw into the page */ }
    };
    // On a brand-new device the worker claims the client a moment after this data arrives — which
    // is the whole reason the read was missed — so wait for that rather than giving up.
    if (navigator.serviceWorker.controller) send();
    else navigator.serviceWorker.addEventListener("controllerchange", send, { once: true });
  } catch { /* no service worker → nothing to warm, and nothing to report */ }
}
