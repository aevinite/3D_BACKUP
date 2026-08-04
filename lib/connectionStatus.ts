// connectionStatus.ts — the shared connection signal for the REACT surfaces
// (guest menu, admin, owner). It mirrors what public/panels/connbadge.js does for
// the vanilla panels: it combines the device's own online/offline state with the
// realtime websocket's health into one of three levels, AND carries a live latency
// (ms) reading so the badge can show an actual "42 ms" number coloured by speed
// instead of a vague "Reconnecting" word:
//
//   "online"  🟢  the device has internet AND the live socket is healthy.
//   "weak"    🟡  the device has internet but the live socket errored/closed.
//   "offline" 🔴  the device has NO internet (navigator.onLine === false).
//
// Design notes:
// - It NEVER makes a network request of its own (no polling ping) — that would add
//   egress, the owner's #1 fear (owner 2026-07-08: "don't keep it if that's
//   increasing egress"). The latency number is measured ONLY from traffic the app
//   ALREADY makes: the delivery time of realtime breadcrumbs that already arrive
//   (now − created_at, reported by the realtime hooks). Zero new requests.
// - The realtime health defaults to "online" (optimistic): a page that has NO
//   realtime subscription still shows green when the device is online — honest,
//   because the internet genuinely works. Only an actual socket error downgrades it.
// - latencyMs is null until the first reading, and treated as STALE after
//   LATENCY_FRESH_MS (a quiet screen just shows "Live" like before — no scary red).
import { useSyncExternalStore } from "react";

export type ConnLevel = "online" | "weak" | "offline";

export type ConnSnapshot = {
  level: ConnLevel;
  everConnected: boolean;   // has the socket connected at least once? (calm "Connecting…" vs amber "Reconnecting")
  latencyMs: number | null; // last measured round-trip / delivery time (null = never measured)
  latencyAt: number;        // Date.now() of that reading (0 = never)
  history: number[];        // recent readings, oldest → newest, capped at HISTORY_MAX (for the sparkline)
};

// A reading older than this is treated as stale → the badge falls back to the plain
// "Live" state instead of showing an out-of-date number.
export const LATENCY_FRESH_MS = 90_000;
const HISTORY_MAX = 24;

// Realtime socket health as last reported by the hooks. Optimistic default.
let rtHealth: "online" | "weak" = "online";
let level: ConnLevel = "online";
let everConnected = false;
let latencyMs: number | null = null;
let latencyAt = 0;
const history: number[] = [];
let started = false;
const listeners = new Set<() => void>();

// The snapshot object handed to React. Rebuilt (new ref) ONLY when something changes,
// so useSyncExternalStore doesn't loop (getSnapshot must be referentially stable when
// nothing changed).
let snapshot: ConnSnapshot = { level, everConnected, latencyMs, latencyAt, history: [] };
function rebuild() { snapshot = { level, everConnected, latencyMs, latencyAt, history: history.slice() }; }

function computeLevel(): ConnLevel {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return rtHealth === "online" ? "online" : "weak";
}

function emit() {
  level = computeLevel();
  rebuild();
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

// Called by the realtime hooks (useRealtime / RealtimeProvider) as they learn the
// socket state from their existing .subscribe() callbacks.
export function reportRealtime(status: "online" | "weak") {
  if (status === "online") everConnected = true;
  if (status === rtHealth) return;
  rtHealth = status;
  emit();
}

// Called by the hooks with the delivery latency of a breadcrumb that ALREADY arrived
// (now − created_at). No new request is ever made to obtain this. Garbage is dropped.
export function reportLatency(ms: number) {
  if (!(ms >= 0) || ms > 60_000) return;
  latencyMs = Math.round(ms);
  latencyAt = Date.now();
  history.push(latencyMs);
  if (history.length > HISTORY_MAX) history.shift();
  rebuild();
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  level = computeLevel();
  rebuild();
  window.addEventListener("online", emit);
  window.addEventListener("offline", emit);
}

function subscribe(cb: () => void) {
  ensureStarted();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function getSnapshot(): ConnSnapshot {
  // Keep the snapshot fresh for the device-online axis even before any event fires
  // (e.g. the very first render after a hard reload while offline). Rebuild ONCE on
  // the flip so the returned ref stays stable afterwards (no render loop).
  if (typeof navigator !== "undefined" && navigator.onLine === false && level !== "offline") {
    level = "offline"; rebuild();
  }
  return snapshot;
}

// SSR has no navigator/socket — assume online so the server and first client render
// agree (no hydration flash); the client re-reads the truth on mount. Stable const ref.
const SERVER_SNAPSHOT: ConnSnapshot = { level: "online", everConnected: false, latencyMs: null, latencyAt: 0, history: [] };
function getServerSnapshot(): ConnSnapshot { return SERVER_SNAPSHOT; }

// Full snapshot (level + latency + history) — used by the badge.
export function useConnection(): ConnSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Back-compat: just the level, for any caller that only needs the colour axis.
export function useConnectionStatus(): ConnLevel {
  return useConnection().level;
}

// ── Shared latency → quality tier (mirrored in public/panels/connbadge.js) ──────
// Delivery latency (breadcrumb write → client receive) is typically 100–500ms when
// healthy; it climbs into the seconds when the network degrades. Four tiers so the
// number goes green → yellow → orange → red exactly as the owner asked. `bars` (0–3)
// carries the SAME meaning as the colour so it's never colour-only (accessibility).
export type Tier = { key: string; color: string; text: string; tint: string; bars: number; label: string };
// `bars` must differ wherever the COLOUR differs, or the tier is colour-only for that step and the
// promise above is not kept. Slow and Poor both said 1, so the two worst states were told apart by
// hue alone — the one place it matters most, and unreadable to anyone who can't separate orange
// from red. Poor is the floor now: 0 lit bars, which also reads correctly as "barely connected".
export function latencyTier(ms: number | null): Tier | null {
  if (ms == null) return null;
  if (ms <= 700)  return { key: "good", color: "#22c55e", text: "#16a34a", tint: "rgba(34,197,94,.16)",  bars: 3, label: "Excellent" };
  if (ms <= 1500) return { key: "okay", color: "#eab308", text: "#ca8a04", tint: "rgba(234,179,8,.18)",  bars: 2, label: "Good" };
  if (ms <= 3000) return { key: "slow", color: "#f97316", text: "#ea580c", tint: "rgba(249,115,22,.16)", bars: 1, label: "Slow" };
  return              { key: "poor", color: "#ef4444", text: "#dc2626", tint: "rgba(239,68,68,.16)",  bars: 0, label: "Poor" };
}
