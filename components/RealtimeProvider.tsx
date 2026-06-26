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

type GuestMetrics = { events: number; ticks: number; reconnects: number; lastEventAt: number; topic: string | null };

export default function RealtimeProvider() {
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
      channel = supabase
        .channel(`rt:${topic}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: `topic=eq.${topic}` },
          () => { metrics.events++; metrics.lastEventAt = Date.now(); tick(); })
        .subscribe((status) => {
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
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake); // bfcache restore (phone wake)
    const onOnline = () => { metrics.reconnects++; forceReconnect(); };
    window.addEventListener("online", onOnline);

    return () => {
      if (tTimer) clearTimeout(tTimer);
      clearTimeout(idleTimer);
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("lfh:session-changed", onSession);
      window.removeEventListener("lfh:cart-updated", onSession);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
