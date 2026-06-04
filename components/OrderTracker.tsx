// Runs in the browser so it can poll the kitchen and handle drag gestures.
"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import { getOrderStatus, updateOrderTableNumber, getSettings, type OrderStatus } from "@/lib/menu";
import { getStoredSession, getSessionState } from "@/lib/session";
import { formatMoney, getCurrency, type CurrencyMeta } from "@/lib/format";
import {
  STEPS,
  STATUS_COPY as COPY,
  POLL_MS,
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
  // useState boxes (re-draw the strip when changed):
  const [orders, setOrders] = useState<ActiveOrder[]>([]); // all orders this device is following
  const [detailOpen, setDetailOpen] = useState(false); // is the details sheet open?
  const [tableDraft, setTableDraft] = useState(""); // table number being typed in the sheet
  const [savingTable, setSavingTable] = useState(false); // true while saving a table change
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null); // currency for prices
  // Per-dish progress across the whole table (from the session's order_items):
  // segs is one status per dish ("received"|"preparing"|"served") so the strip can
  // draw a segment per dish, and served is how many are done. Lets the guest see
  // WHICH dishes are out vs. still cooking — not just an order-level "preparing".
  const [dishProg, setDishProg] = useState<{ served: number; segs: string[] }>({ served: 0, segs: [] });
  // useRef boxes (remembered values that DON'T trigger a re-draw):
  const lastStatus = useRef<Record<string, OrderStatus>>({}); // last status we toasted, per order, to avoid repeat toasts
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

  // Runs once on mount: load orders + currency, then listen for "order placed"
  // (refresh) and "currency changed" messages.
  useEffect(() => {
    refresh();
    setCurrency(getCurrency());
    const onPlaced = () => refresh(); // a new order arrived (this tab or another)
    const onCur = () => setCurrency(getCurrency());
    window.addEventListener("lfh:order-placed", onPlaced);
    window.addEventListener("storage", onPlaced); // "storage" fires when another tab changes localStorage
    window.addEventListener("lfh:currency-changed", onCur);
    return () => {
      window.removeEventListener("lfh:order-placed", onPlaced);
      window.removeEventListener("storage", onPlaced);
      window.removeEventListener("lfh:currency-changed", onCur);
    };
  }, []);

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
      for (const o of live) {
        const res = await getOrderStatus(o.id); // ask the server for this order's status
        if (!res || cancelled) continue;
        if (res.status !== o.status) {
          o.status = res.status; // status moved forward — update our copy
          if (isFinal(res.status) && !o.finalizedAt) o.finalizedAt = Date.now(); // stamp the finish time
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
              } })
            );
          }
        }
      }
      // If anything changed, save it, re-draw, and tell the open cart to refresh.
      if (changed && !cancelled) {
        write(list);
        refresh();
        broadcast();
      }
    };
    poll(); // check immediately on mount
    const iv = setInterval(poll, POLL_MS); // then keep checking every POLL_MS milliseconds
    // Cleanup: mark cancelled and stop the timer when this effect tears down.
    return () => {
      cancelled = true;
      clearInterval(iv);
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
    (async () => {
      let on = false;
      try { on = (await getSettings()).sessionsEnabled; } catch {}
      if (!alive || !on) return;
      const pull = async () => {
        const s = getStoredSession();
        if (!s) { if (alive) setDishProg({ served: 0, segs: [] }); return; } // not in a session -> no per-dish bar
        const st = await getSessionState(s.token);
        if (!alive) return;
        if (!st.ok) { setDishProg({ served: 0, segs: [] }); return; } // session ended -> drop the per-dish bar
        // Per-dish progress across the whole table — one status per dish — so the
        // strip can show "2 of 3 dishes served" + a segment per dish.
        const sItems = (st.items as Array<{ status: string }>) || [];
        setDishProg({ served: sItems.filter((i) => i.status === "served").length, segs: sItems.map((i) => i.status) });
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
      iv = setInterval(pull, 3000);
    })();
    return () => { alive = false; if (iv) clearInterval(iv); };
  }, []);

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
    setDetailOpen(false);
    refresh();
    broadcast(); // tell the cart to update its dot/list
  };

  // Which order does the strip actually show right now?
  const visible = liveActiveOrders(orders).filter((o) => !o.stripHidden);
  // While dismissing, keep showing the SAME order that's flying into the cross.
  const order = (dismissing && dismissingOrderRef.current) || visible[0];
  if (!order) return null; // nothing live to show -> draw nothing

  const c = COPY[order.status]; // the label/sub/icon text for this status
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
  // The table can only be corrected while the order is early (not yet served).
  const canEditTable = order.status === "received" || order.status === "preparing";
  // showPrice(): format a number as a price string in the chosen currency.
  const showPrice = (n: number) => (currency ? formatMoney(n, currency) : `$${n.toFixed(2)}`);

  // openDetail(): tapping the strip. With several orders, open the cart's
  // "Previous orders" (the full per-dish table view); with one, the details sheet.
  const openDetail = () => {
    if (multi) {
      window.dispatchEvent(new Event("lfh:open-cart"));
      window.dispatchEvent(new Event("lfh:show-previous-orders"));
      return;
    }
    setTableDraft(order.tableNumber || "");
    setDetailOpen(true);
  };

  // saveTable(): send a corrected table number to the server, then update locally.
  const saveTable = async () => {
    if (savingTable) return; // ignore double taps
    setSavingTable(true);
    const ok = await updateOrderTableNumber(order.id, tableDraft); // tell the server
    setSavingTable(false);
    if (ok) {
      // Save succeeded: update our stored copy, re-draw, and confirm with a toast.
      write(read().map((o) => (o.id === order.id ? { ...o, tableNumber: tableDraft.trim() } : o)));
      refresh();
      broadcast();
      window.dispatchEvent(
        new CustomEvent("lfh:toast", { detail: { message: "Table updated", subtitle: "saved", kicker: "table", variant: "success" } })
      );
    } else {
      window.dispatchEvent(
        new CustomEvent("lfh:toast", { detail: { message: "Couldn't update table", subtitle: "it may already be served", kicker: "table", variant: "error" } })
      );
    }
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
        if (wasMulti) { write(read().map((o) => (allIds.includes(o.id) ? { ...o, stripHidden: true } : o))); setDetailOpen(false); refresh(); broadcast(); }
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
        className={`order-tracker status-${dishMode ? (allDishesServed ? "served" : "preparing") : multi ? (servedCount === visible.length ? "served" : "preparing") : order.status}`}
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

      {/* The details sheet that slides up when the strip is tapped. */}
      {detailOpen && (
        <>
          {/* Dark backdrop; tapping it closes the sheet. */}
          <div className="overlay active" onClick={() => setDetailOpen(false)} />
          <div className="ot-sheet" role="dialog" aria-modal="true" aria-label="Order status">
            <button className="ot-sheet-close" aria-label="Close" onClick={() => setDetailOpen(false)}>
              <i className="fas fa-times"></i>
            </button>

            <div className={`ot-sheet-head status-${order.status}`}>
              <div className="ot-icon" aria-hidden="true">
                <i className={`fas ${c.icon}`}></i>
              </div>
              <div>
                <div className="ot-label">{c.label}</div>
                <div className="ot-sub">{c.sub}</div>
              </div>
            </div>

            {stepIndex >= 0 && (
              <div className="ot-steps big" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span key={s} className={`ot-step ${i <= stepIndex ? "done" : ""} ${i === stepIndex ? "active" : ""}`} />
                ))}
              </div>
            )}

            {/* The list of dishes in this order, plus the total at the bottom. */}
            {order.items && order.items.length > 0 && (
              <div className="ot-items">
                {order.items.map((it, i) => (
                  <div key={i} className="ot-item-line">
                    <span>{it.title}</span>
                    <span>×{it.qty}</span>
                  </div>
                ))}
                <div className="ot-item-line total">
                  <span>Total</span>
                  <span>{showPrice(order.total)}</span>
                </div>
              </div>
            )}

            {/* The "fix my table number" area (locked once the order is served). */}
            <div className="ot-table-edit">
              <label htmlFor="ot-table-input">Table number</label>
              <div className="ot-table-row">
                <input
                  id="ot-table-input"
                  type="text"
                  inputMode="numeric"
                  value={tableDraft}
                  disabled={!canEditTable}
                  placeholder="e.g. 7"
                  onChange={(e) => setTableDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="ot-save"
                  disabled={!canEditTable || savingTable || tableDraft.trim() === (order.tableNumber || "").trim()}
                  onClick={saveTable}
                >
                  {savingTable ? "Saving…" : "Save"}
                </button>
              </div>
              <p className="ot-note">
                {canEditTable
                  ? "Got the table wrong? Fix it here — the kitchen sees the change. You can't change the dishes."
                  : "This order is already served, so the table number is locked."}
              </p>
            </div>

            {/* A plain link to hide the strip (same result as dropping it on the X). */}
            <button type="button" className="ot-hide-link" onClick={() => hideStrip(order.id)}>
              Hide this tracker — it stays in Previous orders
            </button>
          </div>
        </>
      )}
    </>
  );
}
