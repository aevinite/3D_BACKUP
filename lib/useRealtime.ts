"use client";
// useRealtime — React mirror of public/panels/realtime.js for the guest menu and
// admin. Opens ONE websocket, runs a per-topic callback (debounced ~300ms) on a
// breadcrumb, on tab wake/focus/online, and once on mount. 60s fallback poll keeps
// the screen alive if the socket drops.
//
// Guests pass only { menu } so they never receive the 'ops' order firehose.
import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { reportRealtime } from "@/lib/connectionStatus";

type Topic = "ops" | "menu";
type Handlers = Partial<Record<Topic, () => void | Promise<void>>>;

// One shared client per tab (the anon url+key are public — same values the guest
// bundle already ships). Lazily created from /api/rt-config.
let clientPromise: Promise<SupabaseClient> | null = null;
async function getClient(): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const cfg = await (await fetch("/api/rt-config", { cache: "no-store" })).json();
    // worker:true keeps the websocket heartbeat alive in a Web Worker so a
    // backgrounded phone tab doesn't silently drop the connection (see lib/supabase.ts).
    return createClient(cfg.url, cfg.anonKey, { realtime: { worker: true, params: { eventsPerSecond: 10 } } });
  })();
  return clientPromise;
}

export function useRealtime(handlers: Handlers, restaurantId?: string) {
  // Keep the latest handlers in a ref so the effect subscribes exactly once and
  // never tears down/re-subscribes when the parent re-renders with new closures.
  const ref = useRef(handlers);
  ref.current = handlers;
  // Restaurant to scope breadcrumbs to (ref so it updates without re-subscribing).
  // Undefined = no scoping (admin/staff intentionally see everything).
  const ridRef = useRef(restaurantId);
  ridRef.current = restaurantId;

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
    let sb: SupabaseClient | null = null;
    // Build (or REBUILD) the per-topic channels. Tears down any existing ones first
    // so calling it again on wake replaces a possibly-dead socket with a live one.
    const onStatus = (status: string) => {
      // Feed the top-right connection light. Only genuine faults downgrade it;
      // "CLOSED" is skipped (it also fires on our own idle/resubscribe teardown).
      if (status === "SUBSCRIBED") reportRealtime("online");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reportRealtime("weak");
    };
    const subscribe = () => {
      if (!sb || disposed) return;
      channels.forEach((c) => { try { sb!.removeChannel(c); } catch {} });
      const rid = ridRef.current;
      channels = topics.map((topic) => {
        // GUEST (rid set): filter the socket to THIS restaurant's THIS-topic events
        // via the combined `topic_rid` column (migration 145), so the guest never
        // receives other restaurants' breadcrumbs over the wire — no cross-restaurant
        // chatter and no order firehose. ADMIN/STAFF (no rid) intentionally watch
        // every restaurant, so they keep the topic-only filter.
        const filter = rid ? "topic_rid=eq." + topic + ":" + rid : "topic=eq." + topic;
        return sb!.channel(rid ? `rt:${topic}:${rid}` : "rt:" + topic)
          .on(
            "postgres_changes" as never,
            { event: "INSERT", schema: "public", table: "realtime_events", filter } as never,
            () => fire(topic) // filter already scoped it; no client-side rid check needed
          )
          .subscribe(onStatus);
      });
    };
    getClient().then((client) => {
      if (disposed) return;
      sb = client;
      subscribe();
    }).catch(() => {});

    // On tab wake, the backgrounded socket may be dead. Rebuild the channels (force
    // a reconnect) AND refetch immediately so the screen is live again at once,
    // instead of staying stale until the 60s backup poll fires. visibilitychange +
    // focus + online often fire together on return, so THROTTLE the rebuild: first
    // signal rebuilds, the rest within 1.5s only refetch (avoids 2-3× socket churn).
    // IDLE-DISCONNECT (owner 2026-06-26 — protect the realtime connection budget): a tab
    // left HIDDEN for IDLE_MS drops its realtime channels so it stops holding a websocket
    // connection (the "stale 41 connections" problem — tabs left open with no one looking).
    // It reconnects + refetches the instant the tab is shown again; the 60s safety poll also
    // pauses while hidden so a backgrounded tab does zero work.
    const IDLE_MS = 120000;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let torndown = false;
    const teardown = () => {
      if (!sb) return;
      channels.forEach((c) => { try { sb!.removeChannel(c); } catch {} });
      channels = [];
      torndown = true;
    };
    let lastWake = 0;
    const wake = () => {
      if (document.hidden) return;
      clearTimeout(idleTimer);
      const now = Date.now();
      if (torndown) { torndown = false; lastWake = now; subscribe(); fireAll(); return; } // reconnect after idle
      if (now - lastWake < 1500) { fireAll(); return; } // already rebuilt this wake — just refetch
      lastWake = now;
      subscribe();
      fireAll();
    };
    const onVisibility = () => {
      if (document.hidden) { clearTimeout(idleTimer); idleTimer = setTimeout(teardown, IDLE_MS); } // arm the idle drop
      else wake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    const poll = setInterval(() => { if (!document.hidden) fireAll(); }, 60000); // safety net — paused while hidden

    topics.forEach(run); // initial load — fire IMMEDIATELY (the 300ms debounce only coalesces realtime bursts)

    return () => {
      disposed = true;
      clearInterval(poll);
      clearTimeout(idleTimer);
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      getClient().then((sb) => channels.forEach((c) => sb.removeChannel(c))).catch(() => {});
    };
  }, []);
}
