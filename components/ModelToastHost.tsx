"use client";

import { useEffect, useRef } from "react";
import { modelWatchlist } from "@/lib/modelWatchlist";
import { tenantSlug } from "@/lib/tenantStorage";
import { DEFAULT_RESTAURANT_SLUG } from "@/lib/tenant";

// Headless: listens for 3D model load/fail and turns them into the app's one
// café-ticket notification (`lfh:toast`). Loaded models become a tappable
// ticket that opens the 3D view; failures become an error ticket. The watchlist
// + dedup logic stays here so only people who tried to view a model get pinged.
// "Headless" means this component shows nothing on screen itself (it returns
// null at the bottom). It just sits in the background and listens.
export default function ModelToastHost() {
  // Remembers which models we've already announced, so we never show the same
  // "3D ready" ticket twice. (A Set is just a list with no duplicates.)
  const announcedRef = useRef<Set<string>>(new Set());

  // Set up the two listeners once, and remove them when the component goes away.
  useEffect(() => {
    // Runs when a 3D model finishes downloading successfully.
    const onLoaded = (e: Event) => {
      // Pull the model's URL out of the event that was sent.
      const url = (e as CustomEvent).detail?.url as string | undefined;
      if (!url) return;
      // Find which dish this model belongs to (only those the guest tried to view).
      const entry = modelWatchlist.findByUrl(url);
      if (!entry) return;
      // Don't invite the guest to "tap to view in 3D" the dish they're ALREADY
      // viewing in 3D (audit fix bug #9): the download-complete event fires just
      // before the model paints, so without this the guest gets a pop-up for the
      // very page they're on. If we're on that folder's /view page, skip the toast.
      try {
        const path = decodeURIComponent(window.location.pathname);
        if (path === `/view/${entry.folder}`) {
          modelWatchlist.unwatchByFolder(entry.folder);
          return;
        }
      } catch {}
      // Build a unique key and bail out if we've already announced this one.
      const key = `loaded:${entry.folder}`;
      if (announcedRef.current.has(key)) return;
      announcedRef.current.add(key);
      // Stop watching this model now that it's ready.
      modelWatchlist.unwatchByFolder(entry.folder);
      // If we know the dish slug, remember where the guest came from in the link,
      // AND which restaurant (so the viewer stays in this tenant, not #1 — audit
      // fix 2026-07-06). The tab's current restaurant is the right one: the guest
      // is on its page right now. #1 keeps the bare link (no ?r=), unchanged.
      const slug = tenantSlug();
      const rParam = slug && slug !== DEFAULT_RESTAURANT_SLUG ? `&r=${encodeURIComponent(slug)}` : "";
      const qs = entry.slug ? `?from=${encodeURIComponent(entry.slug)}${rParam}` : "";
      // Fire the app's one toast event with a tappable "view in 3D" ticket.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: `${entry.title} in 3D`,
        subtitle: "ready to view",
        kicker: "3d preview",
        variant: "info",
        icon: "✦",
        href: `/view/${entry.folder}${qs}`,
      }}));
    };

    // Runs when a 3D model fails to download.
    const onFailed = (e: Event) => {
      const url = (e as CustomEvent).detail?.url as string | undefined;
      if (!url) return;
      const entry = modelWatchlist.findByUrl(url);
      if (!entry) return;
      // Same one-time guard as above, but for the failure ticket.
      const key = `failed:${entry.folder}`;
      if (announcedRef.current.has(key)) return;
      announcedRef.current.add(key);
      // Show an error toast letting the guest know 3D isn't available.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: entry.title,
        subtitle: "3D unavailable",
        kicker: "3d preview",
        variant: "error",
      }}));
    };

    // Listen for the load/fail events the model loader fires on the window.
    window.addEventListener("lfh:model-loaded", onLoaded);
    window.addEventListener("lfh:model-failed", onFailed);
    // Cleanup: stop listening when this component unmounts.
    return () => {
      window.removeEventListener("lfh:model-loaded", onLoaded);
      window.removeEventListener("lfh:model-failed", onFailed);
    };
  }, []);

  // Nothing visible to draw; the work happens via events above.
  return null;
}
