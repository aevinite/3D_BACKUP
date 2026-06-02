"use client";

// SessionCartSync — makes the pre-order CART shared across everyone in a v2
// dining session. The cart still lives in localStorage["lfh_cart"], so every
// existing cart component (FoodCard, CartPanel, MiniCart, Header…) keeps working
// unchanged. This component is the only thing that talks to the server cart:
//
//   PULL (every 2s): if the session's server cart changed, overwrite the local
//     cart and fire `lfh:cart-updated` so all cart UIs re-render.
//   PUSH (debounced): when the local cart changes (lfh:cart-updated), write it up.
//
// It only runs for an APPROVED member of an OPEN session. A guest still waiting
// for approval keeps a private local cart (it isn't touched) until the head lets
// them in — at which point the FIRST sync reconciles the two carts:
//   server empty + you have items -> push yours (you're the head / brought items)
//   you have none                 -> adopt the server cart
//   both have items               -> union by line (server wins per line, your
//                                     unique lines added), then push
//
// When sessions are OFF, or this device isn't in a session, it stays idle and the
// cart behaves exactly like today (purely local).

import { useEffect, useRef } from "react";
import { getSettings } from "@/lib/menu";
import { getStoredSession, getSessionCart, setSessionCart } from "@/lib/session";

const CART_KEY = "lfh_cart";

interface Line { id: string; sig?: string; qty?: number; [k: string]: unknown; }
const lineKey = (i: Line) => `${i.id}__${i.sig ?? "[]"}`;

const readLocal = (): Line[] => {
  try { const raw = localStorage.getItem(CART_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
};

export default function SessionCartSync() {
  const enabled = useRef<boolean | null>(null);     // sessions_enabled (cached)
  const activeToken = useRef<string | null>(null);  // token while we're an approved member of an open session
  const reconciledToken = useRef<string | null>(null); // session we've already done the first-merge for
  const lastJson = useRef<string>("[]");            // last cart JSON we synced (guards both push + pull)
  const applyingRemote = useRef(false);             // true while WE write local -> our own push listener must skip
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    let iv: ReturnType<typeof setInterval> | null = null;

    // Overwrite the local cart and notify the UI, without triggering our own push.
    const writeLocalGuarded = (cart: Line[]) => {
      applyingRemote.current = true;
      try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
      window.dispatchEvent(new Event("lfh:cart-updated")); // listeners run synchronously here
      applyingRemote.current = false;
    };

    const reconcile = (server: Line[], local: Line[]): Line[] => {
      if (server.length === 0) return local;   // you're the head / you brought the items
      if (local.length === 0) return server;   // adopt the table's cart
      const map = new Map(server.map((i) => [lineKey(i), i])); // server wins per line
      for (const li of local) if (!map.has(lineKey(li))) map.set(lineKey(li), li); // add your unique lines
      return [...map.values()];
    };

    const tick = async () => {
      if (enabled.current === null) {
        try { enabled.current = (await getSettings()).sessionsEnabled; } catch { enabled.current = false; }
      }
      if (!alive) return;
      const s = enabled.current ? getStoredSession() : null;
      if (!s) { activeToken.current = null; reconciledToken.current = null; return; } // idle: pure local cart

      const r = await getSessionCart(s.token);
      if (!alive) return;
      if (!r.ok || !r.open || !r.approved) { activeToken.current = null; reconciledToken.current = null; return; }
      activeToken.current = s.token;
      const serverCart = (r.cart as Line[]) || [];

      // First sync for this session -> merge the two carts once.
      if (reconciledToken.current !== s.token) {
        const merged = reconcile(serverCart, readLocal());
        writeLocalGuarded(merged);
        lastJson.current = JSON.stringify(merged);
        reconciledToken.current = s.token;
        if (lastJson.current !== JSON.stringify(serverCart)) await setSessionCart(s.token, merged);
        return;
      }

      // Steady state: adopt the server cart if it changed under us.
      const serverJson = JSON.stringify(serverCart);
      if (serverJson !== lastJson.current) {
        writeLocalGuarded(serverCart);
        lastJson.current = serverJson;
      }
    };

    // Local edit -> push up (debounced), unless the change came from our own pull.
    const onCartUpdated = () => {
      if (applyingRemote.current) return;
      const token = activeToken.current;
      if (!token) return; // not in an active session -> stays purely local
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(async () => {
        if (activeToken.current !== token) return; // session went idle/changed since we scheduled — don't push to a dead token
        const local = readLocal();
        const json = JSON.stringify(local);
        if (json === lastJson.current) return; // nothing actually changed
        const res = await setSessionCart(token, local);
        if (res.ok) lastJson.current = json;
      }, 500);
    };

    // A new session (just became head / just got approved) should reconcile fresh.
    const onSessionChanged = () => { reconciledToken.current = null; tick(); };

    window.addEventListener("lfh:cart-updated", onCartUpdated);
    window.addEventListener("lfh:session-changed", onSessionChanged);
    tick();
    iv = setInterval(tick, 2000);

    return () => {
      alive = false;
      if (iv) clearInterval(iv);
      if (pushTimer.current) clearTimeout(pushTimer.current);
      window.removeEventListener("lfh:cart-updated", onCartUpdated);
      window.removeEventListener("lfh:session-changed", onSessionChanged);
    };
  }, []);

  return null;
}
