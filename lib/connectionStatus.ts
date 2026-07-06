// connectionStatus.ts — the shared connection signal for the REACT surfaces
// (guest menu, admin, owner). It mirrors what public/panels/connbadge.js does for
// the vanilla panels: it combines the device's own online/offline state with the
// realtime websocket's health into one of three human states the badge paints:
//
//   "online"  🟢  the device has internet AND the live socket is healthy.
//   "weak"    🟡  the device has internet but the live socket errored/closed.
//   "offline" 🔴  the device has NO internet (navigator.onLine === false).
//
// Design notes:
// - It NEVER makes a network request of its own (no polling ping) — that would add
//   egress, the owner's #1 fear. It only reads navigator.onLine (free) and whatever
//   the realtime hooks already learn from their existing subscriptions.
// - The realtime health defaults to "online" (optimistic): a page that has NO
//   realtime subscription still shows green when the device is online — honest,
//   because the internet genuinely works. Only an actual socket error downgrades it.
import { useSyncExternalStore } from "react";

export type ConnLevel = "online" | "weak" | "offline";

// Realtime socket health as last reported by the hooks. Optimistic default.
let rtHealth: "online" | "weak" = "online";
let cached: ConnLevel = "online";
let started = false;
const listeners = new Set<() => void>();

function compute(): ConnLevel {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return rtHealth === "online" ? "online" : "weak";
}

function emit() {
  const next = compute();
  if (next === cached) return;
  cached = next;
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

// Called by the realtime hooks (useRealtime / RealtimeProvider) as they learn the
// socket state from their existing .subscribe() callbacks.
export function reportRealtime(status: "online" | "weak") {
  if (status === rtHealth) return;
  rtHealth = status;
  emit();
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  cached = compute();
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
}

function subscribe(cb: () => void) {
  ensureStarted();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): ConnLevel {
  // Keep the snapshot fresh for the device-online axis even before any event fires
  // (e.g. the very first render after a hard reload while offline).
  if (typeof navigator !== "undefined" && navigator.onLine === false && cached !== "offline") cached = "offline";
  return cached;
}

// SSR has no navigator/socket — assume online so the server and first client render
// agree (no hydration flash); the client re-reads the truth on mount.
function getServerSnapshot(): ConnLevel { return "online"; }

export function useConnectionStatus(): ConnLevel {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
