"use client";
// useRealtime — React mirror of public/panels/realtime.js for the guest menu and
// admin. Opens ONE websocket, runs a per-topic callback (debounced ~300ms) on a
// breadcrumb, on tab wake/focus/online, and once on mount. 60s fallback poll keeps
// the screen alive if the socket drops.
//
// Guests pass only { menu } so they never receive the 'ops' order firehose.
import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { reportRealtime, reportLatency } from "@/lib/connectionStatus";

// `audit` carries staff_actions only, and exists so the activity log does NOT ride `ops`
// (mig 267 / sweep F3): an ops breadcrumb with no table_number means "reload the whole
// floor", and an activity-log row — a login, a menu edit, a tap diagnostic — was making
// every open staff panel do exactly that. Only the admin console listens to `audit`.
type Topic = "ops" | "menu" | "audit";
type Handlers = Partial<Record<Topic, () => void | Promise<void>>>;

// One shared client per tab (the anon url+key are public — same values the guest
// bundle already ships).
//
// ONE WEBSOCKET PER TAB, NOT TWO (T13 sweep, 2026-08-13). This always built its OWN client from
// /api/rt-config, while components/RealtimeProvider.tsx uses the module singleton in lib/supabase.ts
// — and supabase-js opens a websocket PER CLIENT INSTANCE, with no pooling between them. Both are
// live on every guest menu view where a table is known (RealtimeProvider is mounted from the root
// layout via GuestChrome, and MenuView calls this hook), so every seated guest held TWO connections
// where one would do: 200 guests = 400 connections. That is the exact resource the idle-drop timers
// in this file and in public/panels/realtime.js were both written to protect ("the stale 41
// connections problem") — they cut IDLE connections and neither could remove the duplicate on an
// ACTIVE one.
//
// So: prefer the shared client when the public values are compiled in (the normal case — the guest
// bundle already ships them, which is what makes lib/supabase.ts work at all), and keep the
// /api/rt-config path as the fallback for a deployment where they are not. The two clients are
// built with the SAME realtime options (worker:true, eventsPerSecond:10), so nothing about delivery
// changes; lib/supabase.ts additionally wraps its REST fetch in a timeout, which the websocket does
// not use.
//
// The import is DYNAMIC on purpose. lib/supabase.ts builds its client at module scope from those
// two values, so a top-level import here would run that construction — and throw — on a deployment
// where they are missing, which is precisely the case the /api/rt-config fallback below exists to
// survive. Importing it only after we have checked the values keeps that fallback genuinely
// reachable instead of decorative.
let clientPromise: Promise<SupabaseClient> | null = null;
async function getClient(): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise;
  // Read through locals so a bundler cannot fold these into truthy strings at build time.
  const inlineUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const inlineKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (inlineUrl && inlineKey) {
    clientPromise = import("@/lib/supabase").then((m) => m.supabase);
    // A failed import must not be remembered forever (the same rule the rt-config path follows
    // below, and the lesson public/panels/realtime.js records at length).
    clientPromise.catch(() => { clientPromise = null; });
    return clientPromise;
  }
  clientPromise = (async () => {
    const cfg = await (await fetch("/api/rt-config", { cache: "no-store" })).json();
    // See the note in public/panels/realtime.js: a 503 { unconfigured:true } is a real answer, and
    // passing its empty values into createClient would surface as "Invalid URL" (T9 improvement 6).
    if (cfg?.unconfigured || !cfg?.url || !cfg?.anonKey) {
      clientPromise = null;   // let the next caller try again once it is configured
      throw new Error("Live updates are not set up on this server");
    }
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
            (payload: { new?: { created_at?: string } }) => {
              // FREE latency reading: how long this breadcrumb took to reach us
              // (now − when it was written). No extra request — the event already arrived.
              const ts = payload?.new?.created_at;
              if (ts) { const lat = Date.now() - Date.parse(ts); if (lat >= 0 && lat < 60000) reportLatency(lat); }
              fire(topic); // filter already scoped it; no client-side rid check needed
            }
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
    // pageshow fires on a BACK-FORWARD-CACHE restore — a phone coming back from another app or a
    // back gesture. Both twins of this file already had it (public/panels/realtime.js and
    // components/RealtimeProvider.tsx); this one did not, so the guest's DISH LIST was the one thing
    // with no wake-up on that path and a dish that went sold-out while the phone was away stayed
    // tappable until the 60s poll below (T13 sweep, 2026-08-13). visibilitychange usually covers a
    // bfcache restore, which is why this was only ever a narrow gap — but iOS Safari does not fire
    // it reliably on a gesture-restore, and that is exactly the case the panel twin added it for.
    // `wake` is throttled to one socket rebuild per 1.5s, so the extra signal costs a refetch at most.
    // ONLY A REAL BACK-FORWARD RESTORE (guest sweep, 2026-08-26).
    //
    // `pageshow` fires on EVERY page load, not only on a bfcache restore — and on an ordinary load
    // it arrives AFTER this effect has already done its initial fetch. So every fresh load woke the
    // screen for no reason: a second full refetch, and a needless socket teardown-and-rebuild.
    // Measured on a production build of the guest menu, first ever visit:
    //     261ms  fetch /menu-data      (the real one)
    //     460ms  pageshow persisted=false
    //     762ms  fetch /menu-data      (this listener)
    // `persisted` is the flag that tells the two apart, and it is true for exactly the case this
    // listener was added for — a phone returning from another app, or an iOS gesture-back, where
    // visibilitychange is not reliable.
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) wake(); };
    window.addEventListener("pageshow", onPageShow);
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
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", wake);
      getClient().then((sb) => channels.forEach((c) => sb.removeChannel(c))).catch(() => {});
    };
  }, []);
}
