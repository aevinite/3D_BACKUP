"use client";
// useRealtime — React mirror of public/panels/realtime.js for the guest menu and
// admin. Opens ONE websocket, runs a per-topic callback (debounced ~300ms) on a
// breadcrumb, on tab wake/focus/online, and once on mount. 60s fallback poll keeps
// the screen alive if the socket drops.
//
// Guests pass only { menu } so they never receive the 'ops' order firehose.
import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

type Topic = "ops" | "menu";
type Handlers = Partial<Record<Topic, () => void | Promise<void>>>;

// One shared client per tab (the anon url+key are public — same values the guest
// bundle already ships). Lazily created from /api/rt-config.
let clientPromise: Promise<SupabaseClient> | null = null;
async function getClient(): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const cfg = await (await fetch("/api/rt-config", { cache: "no-store" })).json();
    return createClient(cfg.url, cfg.anonKey, { realtime: { params: { eventsPerSecond: 10 } } });
  })();
  return clientPromise;
}

export function useRealtime(handlers: Handlers) {
  // Keep the latest handlers in a ref so the effect subscribes exactly once and
  // never tears down/re-subscribes when the parent re-renders with new closures.
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let disposed = false;
    const timers: Partial<Record<Topic, ReturnType<typeof setTimeout>>> = {};
    const topics = Object.keys(ref.current) as Topic[];

    // Run a topic's handler right now (no delay).
    const run = (topic: Topic) => {
      const fn = ref.current[topic];
      if (fn) Promise.resolve(fn()).catch(() => {});
    };
    // Debounced refetch per topic (realtime bursts coalesce into one call).
    const fire = (topic: Topic) => {
      clearTimeout(timers[topic]);
      timers[topic] = setTimeout(() => run(topic), 300);
    };
    const fireAll = () => topics.forEach(fire);

    let channels: RealtimeChannel[] = [];
    getClient().then((sb) => {
      if (disposed) return;
      channels = topics.map((topic) =>
        sb.channel("rt:" + topic)
          .on(
            "postgres_changes" as never,
            { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic } as never,
            () => fire(topic)
          )
          .subscribe()
      );
    }).catch(() => {});

    const wake = () => { if (!document.hidden) fireAll(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    const poll = setInterval(fireAll, 60000); // safety net if the socket drops

    topics.forEach(run); // initial load — fire IMMEDIATELY (the 300ms debounce is only to coalesce realtime bursts, and was costing every page 300ms of dead time before its first fetch)

    return () => {
      disposed = true;
      clearInterval(poll);
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      getClient().then((sb) => channels.forEach((c) => sb.removeChannel(c))).catch(() => {});
    };
  }, []);
}
