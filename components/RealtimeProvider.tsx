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
    const resubscribe = () => {
      const table = intendedTable();
      const topic = table ? `table:${table}` : null;
      if (topic === currentTopic) return; // already on the right topic
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
    const onWake = () => { if (!document.hidden) { resubscribe(); tick(); } };
    window.addEventListener("lfh:session-changed", onSession);
    window.addEventListener("lfh:cart-updated", onSession);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake); // bfcache restore (phone wake)
    window.addEventListener("online", () => { metrics.reconnects++; tick(); });

    return () => {
      if (tTimer) clearTimeout(tTimer);
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("lfh:session-changed", onSession);
      window.removeEventListener("lfh:cart-updated", onSession);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, []);

  return null;
}
