"use client";

import { useEffect, useRef } from "react";
import { modelWatchlist } from "@/lib/modelWatchlist";

// Headless: listens for 3D model load/fail and turns them into the app's one
// café-ticket notification (`lfh:toast`). Loaded models become a tappable
// ticket that opens the 3D view; failures become an error ticket. The watchlist
// + dedup logic stays here so only people who tried to view a model get pinged.
export default function ModelToastHost() {
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onLoaded = (e: Event) => {
      const url = (e as CustomEvent).detail?.url as string | undefined;
      if (!url) return;
      const entry = modelWatchlist.findByUrl(url);
      if (!entry) return;
      const key = `loaded:${entry.folder}`;
      if (announcedRef.current.has(key)) return;
      announcedRef.current.add(key);
      modelWatchlist.unwatchByFolder(entry.folder);
      const qs = entry.slug ? `?from=${encodeURIComponent(entry.slug)}` : "";
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: `${entry.title} in 3D`,
        subtitle: "ready to view",
        kicker: "3d preview",
        variant: "info",
        icon: "✦",
        href: `/view/${entry.folder}${qs}`,
      }}));
    };

    const onFailed = (e: Event) => {
      const url = (e as CustomEvent).detail?.url as string | undefined;
      if (!url) return;
      const entry = modelWatchlist.findByUrl(url);
      if (!entry) return;
      const key = `failed:${entry.folder}`;
      if (announcedRef.current.has(key)) return;
      announcedRef.current.add(key);
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: entry.title,
        subtitle: "3D unavailable",
        kicker: "3d preview",
        variant: "error",
      }}));
    };

    window.addEventListener("lfh:model-loaded", onLoaded);
    window.addEventListener("lfh:model-failed", onFailed);
    return () => {
      window.removeEventListener("lfh:model-loaded", onLoaded);
      window.removeEventListener("lfh:model-failed", onFailed);
    };
  }, []);

  return null;
}
