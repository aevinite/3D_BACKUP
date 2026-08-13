"use client";
// RealtimeProvider — the guest side of Realtime Stage 2. Opens ONE WebSocket to
// Supabase and listens for tiny "breadcrumb" rows for THIS guest's table. When one
// arrives it fires a `lfh:rt-tick` window event (DEBOUNCED ~300ms so a burst of
// changes = one nudge); the guest's live components (order tracker, session
// widgets, cart, bill) listen for it and refetch — instead of polling every 2–3s.
// Their own timers drop to a slow 60s backup.
//
// Carries no data itself — just the nudge. The real data still comes through the
// existing secure RPCs. Renders nothing. Metrics live on window.__lfh_rt_guest.
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { intendedTable } from "@/lib/tableConnection";
import { useRestaurantId } from "@/lib/restaurant-context";
import { reportRealtime, reportLatency } from "@/lib/connectionStatus";

type GuestMetrics = { events: number; ticks: number; reconnects: number; lastEventAt: number; topic: string | null };

export default function RealtimeProvider() {
  const rid = useRestaurantId();
  useEffect(() => {
    const metrics: GuestMetrics = { events: 0, ticks: 0, reconnects: 0, lastEventAt: 0, topic: null };
    (window as unknown as { __lfh_rt_guest?: GuestMetrics }).__lfh_rt_guest = metrics;

    // Debounced nudge: collapse a burst of breadcrumbs into ONE refetch signal.
    let tTimer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (tTimer) clearTimeout(tTimer);
      tTimer = setTimeout(() => { metrics.ticks++; try { window.dispatchEvent(new CustomEvent("lfh:rt-tick")); } catch {} }, 300);
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let currentTopic: string | null = null;
    let everSubscribed = false;

    // (Re)subscribe to the current table's topic. Called on mount and whenever the
    // guest's table changes (e.g. they connect to a session after scanning a QR).
    // `force` rebuilds the channel even when the topic is unchanged — needed on tab
    // wake, because the underlying websocket may have silently died while the phone
    // was backgrounded. Without force we'd bail here ("already on the right topic")
    // and keep a DEAD channel, so the page stayed stale until a manual refresh —
    // that was the root of the "not live when I come back to Chrome" bug.
    const resubscribe = (force = false) => {
      const table = intendedTable();
      const topic = table ? `table:${table}` : null;
      if (topic === currentTopic && !force) return; // already on the right topic
      if (channel) { supabase.removeChannel(channel); channel = null; }
      currentTopic = topic;
      metrics.topic = topic;
      if (!topic) return; // no table yet → backup poll covers us until they connect
      // SCOPE THE SOCKET TO THIS RESTAURANT, SERVER-SIDE (T13 sweep, 2026-08-13).
      //
      // `table:N` is NOT unique across restaurants, so filtering on the bare `topic` meant a guest
      // sitting at table 5 was DELIVERED every breadcrumb for table 5 of every restaurant on the
      // platform and threw them away in JavaScript below. The display was always right; the traffic
      // grew with the number of RESTAURANTS instead of with this restaurant's own business — the
      // exact wording mig 267 / sweep F7 used when it closed the same gap on the staff panels, and
      // the owner's #1 scaling worry. This was the last subscriber still on the bare topic.
      //
      // The fix needs no migration: mig 145 added `realtime_events.topic_rid` ('<topic>:<rid>') for
      // precisely this, and lfh_set_topic_rid() populates it on EVERY breadcrumb — `table:N` rows
      // included — so the column is already correct on these rows. public/panels/realtime.js and
      // lib/useRealtime.ts have both used it for a while.
      //
      // `rid` resolves ASYNC (RestaurantProvider starts at #1 then corrects itself), so until it
      // lands we stay on the bare topic rather than subscribe to a `topic_rid` built from the WRONG
      // restaurant — that would filter out the guest's own events, which is a missed update, far
      // worse than a few extra ones. The effect's [rid] dependency rebuilds this the moment the real
      // id arrives, and the JS check below still runs as the safety net either way.
      const scoped = rid ? `${topic}:${rid}` : null;
      channel = supabase
        .channel(scoped ? `rt:${scoped}` : `rt:${topic}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events",
              filter: scoped ? `topic_rid=eq.${scoped}` : `topic=eq.${topic}` },
          (payload) => {
            // Belt and braces: the filter above already scopes the socket once `rid` is known, but
            // this stays because the pre-`rid` window (and any future caller that passes none) is
            // still on the bare topic, where restaurant A's "table 5" and restaurant B's "table 5"
            // share the channel. Drop any event whose breadcrumb belongs to a DIFFERENT restaurant
            // (mig 086 added realtime_events.restaurant_id for exactly this; mirrors
            // lib/useRealtime.ts). If either id is missing we keep the event (safe: at worst one
            // extra refetch, never a missed update).
            const pnew = (payload as { new?: { restaurant_id?: string; created_at?: string } })?.new;
            const evRid = pnew?.restaurant_id;
            if (rid && evRid && evRid !== rid) return;
            // FREE latency reading (now − when the breadcrumb was written); no extra request.
            const ts = pnew?.created_at;
            if (ts) { const lat = Date.now() - Date.parse(ts); if (lat >= 0 && lat < 60000) reportLatency(lat); }
            metrics.events++; metrics.lastEventAt = Date.now(); tick();
          })
        .subscribe((status) => {
          // Feed the top-right connection light (only real faults downgrade it).
          if (status === "SUBSCRIBED") reportRealtime("online");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reportRealtime("weak");
          if (status === "SUBSCRIBED") { if (everSubscribed) { metrics.reconnects++; tick(); } everSubscribed = true; }
        });
    };

    resubscribe();
    // The table can appear/change while browsing; re-check on these signals. Each
    // also nudges a refetch so a freshly-woken/connected screen isn't stale.
    const onSession = () => { resubscribe(); tick(); };
    // On wake/reconnect, FORCE a fresh channel (the old socket is probably dead) and
    // refetch so a returning phone is instantly live again. Returning to a tab fires
    // visibilitychange + focus + pageshow (and sometimes online) back-to-back, so we
    // THROTTLE the rebuild: the first signal rebuilds the socket, the rest within
    // 1.5s just refetch — avoids tearing the socket down/up 2-3× per wake.
    // IDLE-DISCONNECT (owner 2026-06-26 — protect the realtime connection budget): a tab
    // left HIDDEN for IDLE_MS DROPS its channel so it stops holding a websocket connection
    // (the "stale 41 connections" problem — tabs left open with no one looking). It rebuilds
    // the channel + refetches the instant the tab is shown again. Mirrors lib/useRealtime.ts.
    const IDLE_MS = 120000;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let torndown = false;
    const teardown = () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
      currentTopic = null; // force a fresh subscribe on next wake even if the topic is unchanged
      torndown = true;
    };
    let lastForce = 0;
    const forceReconnect = () => {
      const now = Date.now();
      if (torndown) { torndown = false; lastForce = now; resubscribe(true); tick(); return; } // reconnect after idle
      if (now - lastForce < 1500) { tick(); return; } // already rebuilt this wake — just refetch
      lastForce = now;
      resubscribe(true);
      tick();
    };
    const onWake = () => {
      clearTimeout(idleTimer);
      if (!document.hidden) forceReconnect();
    };
    const onVisibility = () => {
      if (document.hidden) { clearTimeout(idleTimer); idleTimer = setTimeout(teardown, IDLE_MS); } // arm the idle drop
      else onWake();
    };
    window.addEventListener("lfh:session-changed", onSession);
    window.addEventListener("lfh:cart-updated", onSession);
    // A guest can first establish their table by TYPING it into the waiter popup
    // (no cart activity) — that fires lfh:table-scanned. Without this the live
    // socket stayed unsubscribed until the next cart change / wake (audit fix
    // 2026-07-06); now it subscribes as soon as the table is known.
    window.addEventListener("lfh:table-scanned", onSession);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake); // bfcache restore (phone wake)
    // A network flap (wifi↔cellular) fires "online". If the tab is HIDDEN we must NOT
    // reopen a live socket — that's exactly the phantom-connection leak the idle-drop
    // prevents. Only reconnect when visible; if hidden, (re)arm the idle drop instead
    // so we never hold a background connection. Mirrors onWake's hidden guard.
    const onOnline = () => {
      metrics.reconnects++;
      if (document.hidden) { clearTimeout(idleTimer); idleTimer = setTimeout(teardown, IDLE_MS); return; }
      forceReconnect();
    };
    window.addEventListener("online", onOnline);

    return () => {
      if (tTimer) clearTimeout(tTimer);
      clearTimeout(idleTimer);
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("lfh:session-changed", onSession);
      window.removeEventListener("lfh:cart-updated", onSession);
      window.removeEventListener("lfh:table-scanned", onSession);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("online", onOnline);
    };
    // rid in deps: it resolves ASYNC (RestaurantProvider starts at #1 then fixes itself),
    // so the filter above must rebuild with the real id once it lands — otherwise a non-#1
    // guest would keep filtering against #1 and drop its OWN events. Re-running tears down
    // and rebuilds the socket cleanly (same as a wake/resubscribe).
  }, [rid]);

  return null;
}
