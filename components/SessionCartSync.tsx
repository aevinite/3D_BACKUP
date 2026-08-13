"use client";
import { useRestaurantId } from "@/lib/restaurant-context";

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

// React building blocks: useEffect runs setup code, useRef keeps a value that
// survives re-draws without causing one.
import { useEffect, useRef } from "react";
// Reads the restaurant's on/off settings (e.g. is the session system turned on).
import { getSettings } from "@/lib/menu";
// Helpers: read the saved session, and read/write the table's shared server cart.
import { getStoredSession, getSessionCart, setSessionCart, mergeSessionCart } from "@/lib/session";
import { RT_BACKUP_MS } from "@/lib/orderStatus"; // realtime backup-poll interval (60s)

// The localStorage key where the cart is saved on this device (tenant-scoped).
import { tget, tset } from "@/lib/tenantStorage";
const CART_KEY = "lfh_cart";

// One line in the cart: a dish id, an options signature, a quantity, and extras.
interface Line { id: string; sig?: string; qty?: number; [k: string]: unknown; }
// A unique key for a cart line, so the same dish with different options counts
// as a separate line (e.g. "burger__[no onions]" vs "burger__[]").
const lineKey = (i: Line) => `${i.id}__${i.sig ?? "[]"}`;

// Reads the cart from this device's storage, safely returning [] if anything's off.
const readLocal = (): Line[] => {
  try { const raw = tget(CART_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; }
  catch { return []; }
};

// SessionCartSync — the one piece that keeps a table's cart shared across everyone
// in a dining session. It pulls the server cart down and pushes local changes up,
// so every other cart component just keeps reading localStorage like normal.
export default function SessionCartSync() {
  const restaurantId = useRestaurantId();
  // These refs hold working state that shouldn't trigger re-draws:
  const enabled = useRef<boolean | null>(null);     // sessions_enabled (cached)
  const activeToken = useRef<string | null>(null);  // token while we're an approved member of an open session
  const reconciledToken = useRef<string | null>(null); // session we've already done the first-merge for
  const lastJson = useRef<string>("[]");            // last cart JSON we synced (guards both push + pull)
  const applyingRemote = useRef(false);             // true while WE write local -> our own push listener must skip
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // delays pushes so rapid edits batch into one

  // This runs once when the component first appears. It sets up the pull timer
  // (every 2s) and the listeners that push local changes up to the server.
  useEffect(() => {
    let alive = true; // guards against acting after the component is gone
    // The restaurant resolves async (RestaurantProvider starts at #1, then fixes itself).
    // enabled.current is cached once per mount; reset it here so a change of restaurantId
    // re-reads THIS restaurant's sessions_enabled instead of keeping #1's (else a non-#1
    // table's shared cart never synced). restaurantId is in this effect's deps below.
    enabled.current = null;
    let iv: ReturnType<typeof setInterval> | null = null; // the pull timer

    // Overwrite the local cart and notify the UI, without triggering our own push.
    const writeLocalGuarded = (cart: Line[]) => {
      applyingRemote.current = true;
      tset(CART_KEY, JSON.stringify(cart));
      window.dispatchEvent(new Event("lfh:cart-updated")); // listeners run synchronously here
      applyingRemote.current = false;
    };

    // The one-time merge done when you first join a table: combine the table's
    // cart with whatever you already had so nobody's items get lost.
    const reconcile = (server: Line[], local: Line[]): Line[] => {
      if (server.length === 0) return local;   // you're the head / you brought the items
      if (local.length === 0) return server;   // adopt the table's cart
      const map = new Map(server.map((i) => [lineKey(i), i])); // server wins per line
      for (const li of local) if (!map.has(lineKey(li))) map.set(lineKey(li), li); // add your unique lines
      return [...map.values()];
    };

    // The PULL: runs on the timer. Checks the server cart and, if it changed,
    // copies it into the local cart so all the cart UIs update.
    const tick = async () => {
      // First time only: cache whether the session system is even turned on.
      if (enabled.current === null) {
        try { enabled.current = (await getSettings(restaurantId)).sessionsEnabled; } catch { enabled.current = false; }
      }
      if (!alive) return;
      // Only act if sessions are on AND we have a saved session.
      const s = enabled.current ? getStoredSession() : null;
      if (!s) { activeToken.current = null; reconciledToken.current = null; return; } // idle: pure local cart

      // Ask the server for this table's shared cart.
      const r = await getSessionCart(s.token);
      if (!alive) return;
      // Only sync if we're an approved member of a still-open session. A transient
      // network blip (r.ok false with a NON-definitive reason) must NOT reset our sync
      // state: clearing reconciledToken re-runs the first-join merge on the next good
      // pull and can RESURRECT a dish the guest just removed (audit fix 2026-07-08).
      // Mirror SessionStatusWidget — only a definitive ending clears the token.
      if (!r.ok) {
        const reason = (r as { reason?: string }).reason;
        if (reason === "session_closed" || reason === "removed" || reason === "invalid_token") {
          activeToken.current = null; reconciledToken.current = null;
        }
        return; // blip → keep state, retry next tick (don't re-merge)
      }
      if (!r.open || !r.approved) { activeToken.current = null; reconciledToken.current = null; return; }
      activeToken.current = s.token;
      const serverCart = (r.cart as Line[]) || [];

      // First sync for this session -> merge the two carts once.
      if (reconciledToken.current !== s.token) {
        const merged = reconcile(serverCart, readLocal());
        writeLocalGuarded(merged);
        lastJson.current = JSON.stringify(merged);
        reconciledToken.current = s.token;
        if (lastJson.current !== JSON.stringify(serverCart)) {
          // THIS is the one write that still sends the WHOLE array (every later change goes through
          // mergeSessionCart's delta). If a co-diner added a dish between the read above and this
          // write, the whole-array write would have silently dropped it. Passing the
          // cart_updated_at we READ makes the server refuse instead (reason 'cart_moved'), and we
          // re-run this first-sync merge on the next tick against the newer cart — first save wins,
          // the loser is told. (mig 311)
          const w = await setSessionCart(s.token, merged, (r as { cart_updated_at?: string | null }).cart_updated_at ?? null);
          if (!w.ok && (w as { reason?: string }).reason === "cart_moved") {
            reconciledToken.current = null; // someone else got there first — merge again next tick
          }
        }
        return;
      }

      // Steady state: adopt the server cart if it changed under us.
      const serverJson = JSON.stringify(serverCart);
      if (serverJson !== lastJson.current) {
        writeLocalGuarded(serverCart);
        lastJson.current = serverJson;
      }
    };

    // The PUSH: runs whenever this device's cart changes. It waits half a second
    // (so rapid edits batch) then writes the local cart up to the server. Skips
    // changes that were actually caused by our own pull above.
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

        // DELTA PUSH (migration 144): instead of overwriting the whole server
        // cart (which dropped a co-diner's dish on a concurrent add), send only
        // what THIS device changed since the last sync — added / removed lines and
        // quantity sets — and let the server merge it into the current cart under a
        // row lock. Then adopt the merged result so we also pick up anyone else's
        // concurrent changes.
        let baseline: Line[] = [];
        try { baseline = JSON.parse(lastJson.current || "[]"); } catch {}
        const bMap = new Map(baseline.map((l) => [lineKey(l), l]));
        const lMap = new Map(local.map((l) => [lineKey(l), l]));
        const added: Line[] = [];
        const qty: Line[] = [];
        for (const [k, l] of lMap) {
          const b = bMap.get(k);
          if (!b) added.push(l);                                   // a line we newly added
          else if ((l.qty ?? 0) !== (b.qty ?? 0))                  // a quantity we changed
            qty.push({ id: l.id, sig: l.sig, qty: l.qty } as Line);
        }
        const removed: Line[] = [];
        for (const [k, b] of bMap) if (!lMap.has(k)) removed.push({ id: b.id, sig: b.sig } as Line);
        if (!added.length && !removed.length && !qty.length) { lastJson.current = json; return; }

        const res = await mergeSessionCart(token, added, removed, qty);
        if (activeToken.current !== token) return; // session changed while awaiting
        const merged = res.ok ? (res.cart as Line[] | undefined) : undefined;
        if (res.ok && Array.isArray(merged)) {
          const mergedJson = JSON.stringify(merged);
          // Adopt the merged cart (it may now contain another diner's dish too).
          if (mergedJson !== json) writeLocalGuarded(merged);
          lastJson.current = mergedJson;
        } else if (res.ok) {
          lastJson.current = json; // server accepted but returned no cart — keep ours
        }
        // On failure we simply keep the local cart and retry on the next edit/pull.
      }, 500);
    };

    // A new session (just became head / just got approved) should reconcile fresh.
    const onSessionChanged = () => { reconciledToken.current = null; tick(); };

    // Start listening for cart edits and session changes, do one pull now, then
    // keep pulling every 2 seconds.
    // Realtime nudge for this table → pull the shared cart immediately.
    const onTick = () => tick();
    window.addEventListener("lfh:cart-updated", onCartUpdated);
    window.addEventListener("lfh:session-changed", onSessionChanged);
    window.addEventListener("lfh:rt-tick", onTick);
    tick();
    iv = setInterval(tick, RT_BACKUP_MS); // 60s backup; realtime drives the rest

    // Cleanup when the component disappears: stop timers and remove listeners.
    return () => {
      alive = false;
      if (iv) clearInterval(iv);
      if (pushTimer.current) clearTimeout(pushTimer.current);
      window.removeEventListener("lfh:cart-updated", onCartUpdated);
      window.removeEventListener("lfh:session-changed", onSessionChanged);
      window.removeEventListener("lfh:rt-tick", onTick);
    };
  }, [restaurantId]);

  // This component is invisible — it only does background syncing, draws nothing.
  return null;
}
