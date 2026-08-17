// Runs in the browser so it can poll the kitchen and handle drag gestures.
"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import { getOrderStatus, getSettings, type OrderStatus } from "@/lib/menu";
import { useRestaurantId } from "@/lib/restaurant-context";
import { getStoredSession, getSessionState } from "@/lib/session";
import { tremove } from "@/lib/tenantStorage";
import {
  STEPS,
  STATUS_COPY as COPY,
  RT_BACKUP_MS,
  SERVED_LINGER_MS,
  MAX_AGE_MS,
  type ActiveOrder,
  isFinalStatus as isFinal,
  readActiveOrders as read,
  writeActiveOrders as write,
  liveActiveOrders,
} from "@/lib/orderStatus";

// Tell the open cart (same tab) that an order's status changed, so its
// "Live now" section can re-read. The browser's native `storage` event only
// fires in OTHER tabs, so we need our own in-tab signal.
const broadcast = () => window.dispatchEvent(new Event("lfh:orders-updated"));

// OrderTracker: the floating strip that shows a guest's order status
// ("Received" -> "Preparing" -> "Served"). It quietly polls the kitchen for
// updates, lets you tap to see details/edit the table, and lets you drag it
// onto an X to hide it (the order stays alive in the cart's history).
export default function OrderTracker() {
  const restaurantId = useRestaurantId();
  // useState boxes (re-draw the strip when changed):
  const [orders, setOrders] = useState<ActiveOrder[]>([]); // all orders this device is following
  // Per-dish progress across the whole table (from the session's order_items):
  // segs is one status per dish ("received"|"preparing"|"served") so the strip can
  // draw a segment per dish, and served is how many are done. Lets the guest see
  // WHICH dishes are out vs. still cooking — not just an order-level "preparing".
  const [dishProg, setDishProg] = useState<{ served: number; segs: string[] }>({ served: 0, segs: [] });
  // useRef boxes (remembered values that DON'T trigger a re-draw):
  const lastStatus = useRef<Record<string, OrderStatus>>({}); // last status we toasted, per order, to avoid repeat toasts
  const nullCounts = useRef<Record<string, number>>({}); // consecutive "order not found" polls per id, to finalize a deleted order
  // Drag-to-dismiss: hold the strip, drag it onto the cross target to hide it.
  const stripRef = useRef<HTMLButtonElement | null>(null); // points at the strip's DOM element
  const dragRef = useRef<{ sx: number; sy: number; pid: number; moved: boolean } | null>(null); // live drag bookkeeping (start point, pointer id, whether it actually moved)
  const [drag, setDrag] = useState<{ dx: number; dy: number; over: boolean } | null>(null); // how far it's been dragged + whether it's over the X
  const [snapping, setSnapping] = useState(false); // true while it springs back after a missed drop
  const [dismissing, setDismissing] = useState<{ tx: number; ty: number } | null>(null); // the fly-into-the-X animation offsets
  // The order being animated into the cross — frozen so a newly-arrived order
  // can't swap into the strip mid-animation and play the fly-out on the wrong one.
  const dismissingOrderRef = useRef<ActiveOrder | null>(null);

  // refresh(): re-read the saved orders into state. Also patches any already-
  // finished order that's missing a "finished at" time so it can auto-clear.
  const refresh = () => {
    // Backfill a finalize time for any already-final order missing one (e.g. it was
    // cancelled in a past session) so it auto-clears instead of getting stuck.
    const list = read();
    let changed = false;
    list.forEach((o) => {
      if (isFinal(o.status) && !o.finalizedAt) {
        o.finalizedAt = Date.now();
        changed = true;
      }
    });
    if (changed) write(list); // save back only if we patched something
    setOrders(list);
  };

  // Load the saved orders, then listen for "order placed". Re-runs when the resolved restaurant changes — a soft, same-tab
  // switch from /r/A to /r/B doesn't remount this widget (same route file), so without
  // this it kept showing restaurant A's live-order strip over B until an event fired.
  // read()/getCurrency() are tenant-scoped, so re-reading picks up B's own data.
  useEffect(() => {
    refresh();
    const onPlaced = () => refresh(); // a new order arrived (this tab or another)
    window.addEventListener("lfh:order-placed", onPlaced);
    window.addEventListener("storage", onPlaced); // "storage" fires when another tab changes localStorage
    return () => {
      window.removeEventListener("lfh:order-placed", onPlaced);
      window.removeEventListener("storage", onPlaced);
    };
  }, [restaurantId]);

  // Re-read on restaurant change: the tracker's orders are tenant-scoped, so switching
  // restaurants in the SAME tab (client-side nav — GuestChrome lives in the root layout
  // and doesn't remount) must re-read against THIS restaurant, else the previous
  // restaurant's live strip lingered over the new one (audit fix cart-3, 2026-07-08).
  useEffect(() => { refresh(); }, [restaurantId]);

  // Poll the kitchen for each order we're still following.
  // "Polling" = asking the server "any update?" on a repeating timer, because
  // the server can't push to us directly here.
  useEffect(() => {
    let cancelled = false; // flag so an in-flight check can bail if we unmount
    const poll = async () => {
      const list = read();
      // Only check orders that are still in progress and not too old.
      const live = list.filter(
        (o) => !o.dismissed && !isFinal(o.status) && Date.now() - o.placedAt < MAX_AGE_MS
      );
      if (live.length === 0) return; // nothing to ask about
      let changed = false;
      // WHAT THIS ROUND ACTUALLY LEARNED, by order id — not the whole list (sweep 6 T3).
      //
      // This loop reads `lfh_active_orders` at the top, then makes one network call PER ORDER,
      // then wrote the list it read back at the end. Everything else that touches that list does
      // its read and its write in one synchronous step, so it is safe — but this one holds a copy
      // across several hundred milliseconds of awaits, and whatever anyone else wrote in that
      // window was silently reverted. Three real losses:
      //   · the diner drags the strip onto the cross to hide it → it comes back,
      //   · the offline queue finally sends a saved order and records it → the entry vanishes and
      //     that order is never tracked again, though the kitchen has it,
      //   · a partner's order pulled in by the session below → dropped (that one self-heals).
      // So: remember only the fields THIS round changed, and apply them to a FRESH read.
      const learned = new Map<string, { status: OrderStatus; finalizedAt?: number }>();
      for (const o of live) {
        const res = await getOrderStatus(o.id); // ask the server for this order's status
        if (cancelled) continue;
        if (!res) {
          // getOrderStatus returns null when the order no longer exists on the server
          // (staff deleted/voided it). Count this only while ONLINE (an offline stretch
          // returns null too, but the order isn't actually gone). After a few consecutive
          // online misses, finalize the strip as cancelled so it auto-clears — instead of
          // a "preparing" ghost lingering up to 3h (audit fix 2026-07-08).
          if (typeof navigator !== "undefined" && navigator.onLine === false) continue;
          nullCounts.current[o.id] = (nullCounts.current[o.id] || 0) + 1;
          if (nullCounts.current[o.id] >= 3 && !isFinal(o.status)) {
            o.status = "cancelled";
            o.finalizedAt = Date.now();
            learned.set(o.id, { status: "cancelled", finalizedAt: o.finalizedAt });
            changed = true;
            if (lastStatus.current[o.id] !== "cancelled") {
              lastStatus.current[o.id] = "cancelled";
              window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Order no longer active", subtitle: o.tableNumber ? `table ${o.tableNumber}` : "your order", kicker: "order update", variant: "error", icon: "✕" } }));
            }
          }
          continue;
        }
        nullCounts.current[o.id] = 0; // a real answer — reset the miss counter
        if (res.status !== o.status) {
          o.status = res.status; // status moved forward — update our copy
          if (isFinal(res.status) && !o.finalizedAt) o.finalizedAt = Date.now(); // stamp the finish time
          learned.set(o.id, { status: res.status, finalizedAt: o.finalizedAt });
          changed = true;
          // Show a toast the FIRST time we see each new status (not on every poll).
          if (lastStatus.current[o.id] !== res.status) {
            lastStatus.current[o.id] = res.status;
            window.dispatchEvent(
              new CustomEvent("lfh:toast", { detail: {
                message: COPY[res.status].label,
                subtitle: o.tableNumber ? `table ${o.tableNumber}` : "your order",
                kicker: "order update",
                variant: res.status === "cancelled" ? "error" : "success",
                icon: res.status === "cancelled" ? "✕" : "🛎",
                // Tapping an order notification opens the LIVE STATUS tab (not the bill)
                // so the guest jumps straight to their order's progress. (owner, 2026-06-22)
                event: "lfh:show-previous-orders",
              } })
            );
          }
        }
      }
      // If anything changed, save it, re-draw, and tell the open cart to refresh.
      // Onto a FRESH read, touching only the orders this round actually learned something about —
      // so an order added, hidden or re-recorded while we were awaiting keeps whatever it was
      // given. An order that has since gone from the list stays gone (no resurrection): we only
      // ever map over what is there now.
      if (changed && !cancelled) {
        const fresh = read().map((o) => {
          const seen = learned.get(o.id);
          return seen ? { ...o, status: seen.status, finalizedAt: o.finalizedAt ?? seen.finalizedAt } : o;
        });
        write(fresh);
        refresh();
        broadcast();
      }
    };
    poll(); // check immediately on mount
    // Realtime drives instant updates (via lfh:rt-tick); this slow timer is only a
    // backup poll for when the WebSocket is asleep/dropped.
    const iv = setInterval(poll, RT_BACKUP_MS);
    const onTick = () => poll(); // a realtime breadcrumb for this table → refetch now
    window.addEventListener("lfh:rt-tick", onTick);
    // Cleanup: mark cancelled and stop the timer when this effect tears down.
    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener("lfh:rt-tick", onTick);
    };
  }, [orders.length]);

  // ── SHARED order tracking across the table ───────────────────────────────
  // An order placed by ANY member should show its live timeline for EVERY member
  // (so the head sees a partner's order being prepared, not just the person who
  // ordered). When we're in a dining session, pull the table's orders and add any
  // we aren't already following into our local tracker; the kitchen poll above
  // then keeps their status fresh. The device that placed an order already has it,
  // so this only fills in the ones others placed.
  useEffect(() => {
    let alive = true;
    let iv: ReturnType<typeof setInterval> | null = null;
    let onTick: (() => void) | null = null;
    (async () => {
      let on = false;
      try { on = (await getSettings(restaurantId)).sessionsEnabled; } catch {}
      if (!alive || !on) return;
      const pull = async () => {
        const s = getStoredSession();
        if (!s) { if (alive) setDishProg({ served: 0, segs: [] }); return; } // not in a session -> no per-dish bar
        const st = await getSessionState(s.token);
        if (!alive) return;
        if (!st.ok) {
          // DEFENCE IN DEPTH for the "ghost order" bug: when staff CLOSE the table
          // (or we were removed / the token died) the floating "preparing" strip must
          // disappear — not linger after the meal. SessionStatusWidget normally does
          // this cleanup, but if its poll/realtime is slow we self-heal here too.
          // Only the three DEFINITIVE endings clear local orders; any other reason is
          // a transient network blip, so we keep what we have and retry next tick
          // (otherwise a momentary drop would wrongly wipe a live order).
          const reason = st.reason as string | undefined;
          if (reason === "session_closed" || reason === "removed" || reason === "invalid_token") {
            tremove("lfh_active_orders");
            window.dispatchEvent(new Event("lfh:order-placed")); // make the strip re-read + vanish
          }
          setDishProg({ served: 0, segs: [] });
          return;
        }
        // PENDING members must NOT see the live table. The server already withholds
        // orders/items from an unapproved member (migration 076); this is the matching
        // client guard so a guest still "waiting for the head" shows no live progress.
        const mem = st.member as { approved?: boolean } | undefined;
        if (!mem?.approved) { setDishProg({ served: 0, segs: [] }); return; }
        // Per-dish progress across the whole table — one status per dish — so the
        // strip can show "2 of 3 dishes served" + a segment per dish.
        const sItems = (st.items as Array<{ status: string }>) || [];
        // The guest never sees "ready" — that's a staff-only stage. A ready dish
        // shows as "preparing" (still cooking) to the customer until it's served
        // (owner, 2026-06-14). The served count is unaffected.
        setDishProg({ served: sItems.filter((i) => i.status === "served").length, segs: sItems.map((i) => (i.status === "ready" ? "preparing" : i.status)) });
        const sessOrders = (st.orders as Array<{ id: string; status: OrderStatus; total: number; items?: { title: string; qty: number }[]; created_at: string }>) || [];
        if (!sessOrders.length) return;
        const sess = st.session as { table_number?: string } | undefined;
        const table = sess?.table_number || s.table;
        const list = read();
        const have = new Set(list.map((o) => o.id));
        let changed = false;
        for (const o of sessOrders) {
          if (have.has(o.id)) continue; // already following it (e.g. we placed it)
          const items = Array.isArray(o.items) ? o.items.map((i) => ({ title: i.title, qty: i.qty })) : [];
          list.push({
            id: o.id,
            tableNumber: String(table),
            total: Number(o.total) || 0,
            itemCount: items.reduce((a, i) => a + (Number(i.qty) || 1), 0),
            items,
            status: o.status,
            placedAt: Date.parse(o.created_at) || Date.now(),
          });
          changed = true;
        }
        if (changed) { write(list); refresh(); broadcast(); }
      };
      pull();
      // Realtime nudge drives the refetch; slow timer is just the backup.
      iv = setInterval(pull, RT_BACKUP_MS);
      onTick = () => pull();
      window.addEventListener("lfh:rt-tick", onTick);
    })();
    return () => { alive = false; if (iv) clearInterval(iv); if (onTick) window.removeEventListener("lfh:rt-tick", onTick); };
    // restaurantId resolves from the URL a beat after the #1 default; depend on it
    // so a non-#1 guest reads THIS tenant's sessionsEnabled, not #1's (audit).
  }, [restaurantId]);

  // Auto-hide a served/cancelled strip one minute after it finishes.
  // We set a single timer for whichever finished order is due to disappear soonest.
  useEffect(() => {
    const finals = orders.filter((o) => isFinal(o.status) && o.finalizedAt && !o.dismissed);
    if (finals.length === 0) return;
    const soonest = Math.min(...finals.map((o) => (o.finalizedAt as number) + SERVED_LINGER_MS));
    const delay = Math.max(0, soonest - Date.now()); // how long until that moment
    const t = setTimeout(refresh, delay + 100); // refresh just after it's due
    return () => clearTimeout(t); // cancel the timer if things change first
  }, [orders]);

  // Hide only the floating strip — the order stays live and visible in the
  // cart's "Live now" list (it is NOT cancelled or removed).
  const hideStrip = (id: string) => {
    write(read().map((o) => (o.id === id ? { ...o, stripHidden: true } : o))); // mark this one's strip hidden
    refresh();
    broadcast(); // tell the cart to update its dot/list
  };

  // Which order does the strip actually show right now?
  const visible = liveActiveOrders(orders).filter((o) => !o.stripHidden);
  // While dismissing, keep showing the SAME order that's flying into the cross.
  const order = (dismissing && dismissingOrderRef.current) || visible[0];
  if (!order) return null; // nothing live to show -> draw nothing

  const c = COPY[order.status] || COPY.preparing; // label/sub/icon; fall back to "preparing" for any unexpected status (e.g. a staff-only "ready")
  const stepIndex = STEPS.indexOf(order.status); // which step of the progress bar we're on
  // When the table has SEVERAL live orders, the strip becomes a table-level
  // summary ("2 of 3 served") with one segment per order, instead of a single
  // order's status steps. (Not while an item is mid dismiss-animation.)
  const multi = visible.length >= 2 && !dismissing;
  const servedCount = visible.filter((o) => o.status === "served").length;
  // Per-dish mode: when we have the table's dish-level statuses, the strip shows a
  // segment per dish (which are served vs. still cooking) instead of a coarse
  // order-level bar. Hidden during a dismiss animation to keep that clean.
  const dishMode = dishProg.segs.length > 0 && !dismissing;
  const allDishesServed = dishMode && dishProg.served === dishProg.segs.length;

  // openDetail(): tapping the strip ALWAYS opens the cart's "Live status" tab — the
  // good warm bill card (SessionTableBill / live orders) — for a single order or
  // many. (Was: a single order opened the tracker's own dark detail sheet, which the
  // owner didn't like.) (owner, 2026-06-19)
  // That sheet has now been DELETED rather than left sitting unreachable, and the one
  // thing only it could do — correcting a wrong table number — moved into the tab this
  // opens (CartPanel, .live-order-fixlink). Guest sweep 2026-08-04.
  const openDetail = () => {
    window.dispatchEvent(new Event("lfh:open-cart"));
    window.dispatchEvent(new Event("lfh:show-previous-orders"));
  };


  // ── Drag-to-dismiss gesture ──────────────────────────────────────────
  // Tap = open detail. Press-and-drag = pick the strip up; a cross target
  // fades in (centred, lower half). Drop on it and the strip flies into the
  // cross and hides — the order is NOT cancelled, it lives on in the cart's
  // "Previous orders → Live" list. Works with touch and mouse (pointer events).
  const CROSS_Y = 0.68; // vertical position of the cross (0=top, 1=bottom)
  const HIT = 90;       // generous hit radius around the cross
  // crossXY(): the cross's centre point on screen (middle, lower half).
  const crossXY = () => ({ x: window.innerWidth / 2, y: window.innerHeight * CROSS_Y });

  // onPointerDown: finger/mouse pressed the strip. Remember the start point and
  // "capture" the pointer so we keep getting move/up events even if it leaves the strip.
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dismissing) return; // ignore presses mid fly-out
    dragRef.current = { sx: e.clientX, sy: e.clientY, pid: e.pointerId, moved: false };
    // Capture immediately so a fast flick that leaves the small strip still
    // delivers move/up here (and so a stray pointerdown can't wedge dragRef).
    try { stripRef.current?.setPointerCapture(e.pointerId); } catch {}
  };
  // onPointerMove: finger/mouse is moving while pressed. Track how far it moved
  // and whether it's currently hovering over the X target.
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || dismissing) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy; // distance from the start point
    if (!d.moved && Math.hypot(dx, dy) < 8) return; // ignore tiny jitters (tap)
    if (!d.moved) d.moved = true; // past the threshold -> it's a real drag now
    const { x, y } = crossXY();
    // "over" is true when the pointer is within HIT pixels of the cross centre.
    setDrag({ dx, dy, over: Math.hypot(e.clientX - x, e.clientY - y) < HIT });
  };
  // endDrag: finger/mouse lifted. Decide: was it a tap, a drop on the X, or a miss?
  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try { stripRef.current?.releasePointerCapture(e.pointerId); } catch {}
    if (!d.moved) { openDetail(); return; } // it was a tap
    const { x, y } = crossXY();
    if (Math.hypot(e.clientX - x, e.clientY - y) < HIT) {
      // dropped on the cross → fly into it, then hide
      // Work out exactly how far to slide so the strip lands on the cross.
      const r = stripRef.current?.getBoundingClientRect();
      const tx = r ? x - (r.left + r.width / 2) : 0;
      const ty = r ? y - (r.top + r.height / 2) : 0;
      const id = order.id;
      const wasMulti = multi;                       // hide all orders if it was the combined strip
      const allIds = visible.map((o) => o.id);
      dismissingOrderRef.current = order; // freeze the strip we're animating out
      setDrag(null);
      setDismissing({ tx, ty }); // triggers the fly-into-the-cross animation
      // After the animation finishes, toast and actually hide the strip(s).
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
          message: "Tracker hidden", subtitle: "still in Previous orders",
          kicker: "order update", icon: "🧾", variant: "success",
        } }));
        if (wasMulti) { write(read().map((o) => (allIds.includes(o.id) ? { ...o, stripHidden: true } : o))); refresh(); broadcast(); }
        else { hideStrip(id); }
        setDismissing(null);
        dismissingOrderRef.current = null;
      }, 340); // matches the 0.34s CSS transition
    } else {
      // released away from the cross → spring back into place
      setSnapping(true);
      setDrag({ dx: 0, dy: 0, over: false }); // animate back to offset 0,0
      setTimeout(() => { setSnapping(false); setDrag(null); }, 260);
    }
  };
  // onPointerCancel: the OS yanked the gesture (e.g. a phone call). Reset cleanly.
  const onPointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    try { stripRef.current?.releasePointerCapture(e.pointerId); } catch {}
    setSnapping(false);
    setDrag(null);
  };

  // NOTE: `animation: none` is required on the active branches — the strip's
  // otRise entrance animation uses fill-mode:both, and a running/filled CSS
  // animation overrides an inline transform, which would pin the strip in place.
  const stripStyle: CSSProperties = dismissing
    ? { transform: `translate(${dismissing.tx}px, ${dismissing.ty}px) scale(0.15)`, opacity: 0, transition: "transform .34s cubic-bezier(.4,0,.2,1), opacity .34s ease", animation: "none", zIndex: 80, pointerEvents: "none", touchAction: "none" }
    : snapping
    ? { transform: "translate(0px, 0px)", transition: "transform .26s cubic-bezier(.22,1,.36,1)", animation: "none", zIndex: 80, touchAction: "none" }
    : drag
    ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(${drag.over ? 0.9 : 1})`, transition: "none", animation: "none", zIndex: 80, cursor: "grabbing", touchAction: "none" }
    : { touchAction: "none" };

  // The strip's colour status. Crucially, an order with NOTHING accepted yet
  // stays "received" (amber) instead of being shown as "preparing" (blue) — the
  // per-item/summary views used to collapse a not-yet-accepted order into blue.
  const dishStatus = allDishesServed ? "served" : (dishProg.segs.some((s) => s !== "received") ? "preparing" : "received");
  const multiStatus = servedCount === visible.length ? "served" : (visible.some((o) => o.status !== "received") ? "preparing" : "received");
  const stripStatus = dishMode ? dishStatus : multi ? multiStatus : order.status;

  return (
    <>
      {/* The X "drop zone" target, only shown while a drag is in progress. It
          highlights when the strip is hovering over it. */}
      {drag && (
        <div className={`ot-dropzone ${drag.over ? "over" : ""}`} aria-hidden="true">
          <div className="ot-dropzone-circle"><i className="fas fa-times"></i></div>
          <span className="ot-dropzone-label">{drag.over ? "Release to hide" : "Drop here to hide"}</span>
        </div>
      )}

      {/* The floating status strip itself. It's a button so tapping works for
          keyboards too. The onPointer* handlers drive the drag-to-hide gesture. */}
      <button
        type="button"
        ref={stripRef}
        className={`order-tracker status-${stripStatus}`}
        style={stripStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={onPointerCancel}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); } }}
        aria-label="Order status — tap to view, drag onto the cross to hide"
      >
        {/* The icon: a receipt for the multi-order table summary, otherwise the
            per-order status icon (received/preparing/served). */}
        <div className="ot-icon" aria-hidden="true">
          <i className={`fas ${multi ? "fa-receipt" : c.icon}`}></i>
        </div>
        <div className="ot-body">
          <div className="ot-top">
            {/* Multi: "Your table" summary. Single: the status label. */}
            <span className="ot-label">{multi ? "Your table" : c.label}</span>
            {/* Show the table number if we have one. */}
            {order.tableNumber && <span className="ot-table">Table {order.tableNumber}</span>}
          </div>
          {/* Per-dish: "X of N dishes served". Multi: "X of N orders served".
              Single: the status subtitle. */}
          <div className="ot-sub">
            {dishMode
              ? `${dishProg.served} of ${dishProg.segs.length} dishes served`
              : multi
              ? `${servedCount} of ${visible.length} orders served`
              : c.sub}
          </div>
          {dishMode ? (
            /* One segment per DISH — grey (received) → amber (preparing) → green
               (served) — so the table sees exactly which dishes are still cooking. */
            <div className="ot-dishbar" aria-hidden="true">
              {dishProg.segs.map((s, i) => (
                <span key={i} className={`ot-dseg ${s}`} />
              ))}
            </div>
          ) : multi ? (
            /* One segment per order, green once that order is fully served — so the
               table can watch its orders complete (3 orders, 1 left = 2 green). */
            <div className="ot-orderbar" aria-hidden="true">
              {visible.map((o) => (
                <span key={o.id} className={`ot-oseg ${o.status}`} />
              ))}
            </div>
          ) : (
            /* Single order: the little received → preparing → served step dots. */
            stepIndex >= 0 && (
              <div className="ot-steps" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span key={s} className={`ot-step ${i <= stepIndex ? "done" : ""} ${i === stepIndex ? "active" : ""}`} />
                ))}
              </div>
            )
          )}
        </div>
        {/* The grip lines hint that the strip can be dragged. */}
        <span className="ot-grip" aria-hidden="true"><i className="fas fa-grip-lines"></i></span>
      </button>

      {/* The tracker's own detail sheet USED TO live here. It became unreachable when the
          owner asked for a tap on the strip to open the cart's Live-status tab instead
          (2026-06-19) — setDetailOpen(true) was never called again, so ~95 lines of UI sat
          here looking live, including the ONLY way a guest could correct a wrong table
          number. Deleted rather than resurrected, because the tap behaviour is the owner's
          decision; the table-correction control now lives in the Live-status tab the tap
          actually opens (see CartPanel .live-order-fixlink). Guest sweep 2026-08-04. */}
    </>
  );
}
