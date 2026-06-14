"use client";
// RealtimeProvider — the guest side of Realtime Stage 2. Opens ONE WebSocket to
// Supabase and listens for tiny "breadcrumb" rows for THIS guest's table. When one
// arrives it fires a `lfh:rt-tick` window event; the guest's live components
// (order tracker, session widgets, cart, bill) listen for it and refetch
// immediately — instead of polling every 2–3 seconds. Their own timers drop to a
// slow 60s backup (wired per-component in later phases).
//
// Carries no data itself — just the nudge. The real data still comes through the
// existing secure RPCs. Renders nothing.
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { intendedTable } from "@/lib/tableConnection";

// Broadcast the nudge that live components listen for.
function tick() {
  try { window.dispatchEvent(new CustomEvent("lfh:rt-tick")); } catch {}
}

export default function RealtimeProvider() {
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let currentTopic: string | null = null;

    // (Re)subscribe to the current table's topic. Called on mount and whenever the
    // guest's table changes (e.g. they connect to a session after scanning a QR).
    const resubscribe = () => {
      const table = intendedTable();
      const topic = table ? `table:${table}` : null;
      if (topic === currentTopic) return; // already on the right topic
      if (channel) { supabase.removeChannel(channel); channel = null; }
      currentTopic = topic;
      if (!topic) return; // no table yet → backup poll covers us until they connect
      channel = supabase
        .channel(`rt:${topic}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: `topic=eq.${topic}` }, tick)
        .subscribe();
    };

    resubscribe();
    // The table can appear/change while browsing; re-check on these signals.
    const onSession = () => resubscribe();
    const onVisible = () => { if (!document.hidden) { resubscribe(); tick(); } };
    window.addEventListener("lfh:session-changed", onSession);
    window.addEventListener("lfh:cart-updated", onSession);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);

    return () => {
      if (channel) supabase.removeChannel(channel);
      window.removeEventListener("lfh:session-changed", onSession);
      window.removeEventListener("lfh:cart-updated", onSession);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", tick);
    };
  }, []);

  return null;
}
