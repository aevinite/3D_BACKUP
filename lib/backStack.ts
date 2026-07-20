"use client";

// ─────────────────────────────────────────────────────────────────────────────
// backStack — the ONE place that teaches the phone's hardware BACK button how to
// walk through the guest app like a native app (Option A, owner-chosen 2026-06-19).
//
// THE IDEA (plain words): every popup/overlay is state-driven (it does NOT change
// the web address — so there's zero extra network/database cost). The browser's
// back button only knows about *history entries*, not React state, so on its own
// it skips every popup and leaves the site. To fix that, whenever a popup opens we
// quietly add ONE history entry; when back is pressed we pop the TOP popup instead
// of letting the browser leave. Real PAGES (/item, /view) already have their own
// address, so the browser handles their back for free — they need nothing here.
//
// WHY a central singleton and not per-component history calls: the bookkeeping is
// fiddly (rapid double-back, "close everything", keeping the count in sync). Doing
// it once here means every component only writes ONE trivial line (useBackClose).
//
// HOW THE SYNC STAYS HONEST:
//   • `layers`  — the popups currently open, in open order (top = last).
//   • `pushed`  — how many history entries WE have added that are still live.
//   • `ignore`  — how many upcoming popstate events WE caused (history.go) and so
//                 must swallow rather than treat as a user pressing back.
// We RECONCILE history to match `layers` on a microtask, so several closes in the
// same tick (e.g. lfh:close-all) collapse into a single history.go(-N).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

type Layer = { id: string; close: () => void };
type RootHandler = (() => void) | null;

interface BackState {
  layers: Layer[];
  pushed: number;
  ignore: number;
  pending: boolean;
  rootHandler: RootHandler;
  started: boolean;
}

// Live on globalThis so the state survives React Fast-Refresh and remounts (same
// pattern as lib/modelLoader.ts). One brain for the whole tab.
function st(): BackState {
  const g = globalThis as unknown as { __lfh_back?: BackState };
  if (!g.__lfh_back) {
    g.__lfh_back = { layers: [], pushed: 0, ignore: 0, pending: false, rootHandler: null, started: false };
  }
  return g.__lfh_back;
}

// Add or drop history entries until the browser has exactly one per open popup.
// Runs once per microtask so a burst of opens/closes coalesces into one change.
function reconcile() {
  const s = st();
  s.pending = false;
  const target = s.layers.length;
  if (target > s.pushed) {
    // New popups opened → add one buffer entry each. We spread the current
    // history.state so Next.js's own router bookkeeping (its `key`/`__NA` fields)
    // is preserved on the synthetic entry and routing never breaks.
    for (let i = s.pushed; i < target; i++) {
      history.pushState({ ...(history.state as object), __lfhLayer: true }, "");
    }
    s.pushed = target;
  } else if (target < s.pushed) {
    // Popups closed by their own UI (X / backdrop / completion). Rewind the buffer
    // entries in one hop. CRITICAL: history.go(-N) fires exactly ONE popstate (not
    // N) for same-document entries — so we swallow exactly ONE, regardless of N.
    // (Counting N here left a stale `ignore` that ate the NEXT real back press,
    // e.g. the Leave dialog right after close-all — verified 2026-06-19.)
    const remove = s.pushed - target;
    s.pushed = target;
    // BUT: if a real NAVIGATION already pushed on top of our buffer (tapping a nav
    // link inside an open drawer: router.push lands, THEN the drawer closes), the
    // current entry is the new page — not our buffer. Rewinding would yank the user
    // straight back off the page they just opened (bug found 2026-07-20: admin/owner
    // drawer nav-taps kept "bouncing back"). Leave the buried buffer alone; a later
    // back press just crosses it (same URL as the page before, so it's invisible).
    if (!(history.state as { __lfhLayer?: boolean } | null)?.__lfhLayer) return;
    s.ignore += 1;
    history.go(-remove);
  }
}

function schedule() {
  const s = st();
  if (s.pending) return;
  s.pending = true;
  queueMicrotask(reconcile);
}

// The single popstate listener for the whole guest app.
function onPop() {
  const s = st();
  if (s.ignore > 0) {
    // This pop was caused by our own reconcile() rewind — not a real back press.
    s.ignore -= 1;
    return;
  }
  if (s.pushed > 0) {
    // A real back press while a popup is open: the browser already removed one of
    // our buffer entries, so drop the TOP popup to match. We remove it from
    // `layers` synchronously (its React cleanup will then find nothing to do).
    s.pushed -= 1;
    const top = s.layers.pop();
    if (top) top.close();
    return;
  }
  // No popups open → this is a back press at a real page. Let the menu exit-guard
  // (BackQuitDialog) decide whether to show "Leave this site?" or do nothing.
  if (s.rootHandler) s.rootHandler();
}

function ensureStarted() {
  const s = st();
  if (s.started || typeof window === "undefined") return;
  s.started = true;
  window.addEventListener("popstate", onPop);
}

// Register an open popup. Returns an unregister function — call it when the popup
// closes by ANY means. (useBackClose below wires this to a component's `open`.)
export function registerBackLayer(id: string, close: () => void): () => void {
  ensureStarted();
  const s = st();
  const layer: Layer = { id, close };
  s.layers.push(layer);
  schedule();
  return () => {
    const i = s.layers.indexOf(layer);
    if (i === -1) return; // already removed by a back press → nothing to rewind
    s.layers.splice(i, 1);
    schedule(); // closed via UI → reconcile() will rewind its buffer entry
  };
}

// The menu's "Leave this site?" guard registers here; only one exists at a time.
export function setRootBackHandler(fn: RootHandler) {
  ensureStarted();
  st().rootHandler = fn;
}

// ── The ONE line every popup writes ──────────────────────────────────────────
// Call unconditionally near the top of a popup component. While `open` is true the
// popup is a back-step; while false it self-noops. `close` is whatever already
// closes the popup (usually `() => setOpen(false)`).
export function useBackClose(id: string, open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    return registerBackLayer(id, () => closeRef.current());
  }, [open, id]);
}
