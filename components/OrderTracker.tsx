"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import { getOrderStatus, updateOrderTableNumber, type OrderStatus } from "@/lib/menu";
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format";
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

export default function OrderTracker() {
  const [orders, setOrders] = useState<ActiveOrder[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [tableDraft, setTableDraft] = useState("");
  const [savingTable, setSavingTable] = useState(false);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null);
  const lastStatus = useRef<Record<string, OrderStatus>>({});
  // Drag-to-dismiss: hold the strip, drag it onto the cross target to hide it.
  const stripRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; pid: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ dx: number; dy: number; over: boolean } | null>(null);
  const [snapping, setSnapping] = useState(false);
  const [dismissing, setDismissing] = useState<{ tx: number; ty: number } | null>(null);
  // The order being animated into the cross — frozen so a newly-arrived order
  // can't swap into the strip mid-animation and play the fly-out on the wrong one.
  const dismissingOrderRef = useRef<ActiveOrder | null>(null);

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
    if (changed) write(list);
    setOrders(list);
  };

  useEffect(() => {
    refresh();
    setCurrency(getCurrency());
    const onPlaced = () => refresh();
    const onCur = () => setCurrency(getCurrency());
    window.addEventListener("lfh:order-placed", onPlaced);
    window.addEventListener("storage", onPlaced);
    window.addEventListener("lfh:currency-changed", onCur);
    return () => {
      window.removeEventListener("lfh:order-placed", onPlaced);
      window.removeEventListener("storage", onPlaced);
      window.removeEventListener("lfh:currency-changed", onCur);
    };
  }, []);

  // Poll the kitchen for each order we're still following.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const list = read();
      const live = list.filter(
        (o) => !o.dismissed && !isFinal(o.status) && Date.now() - o.placedAt < MAX_AGE_MS
      );
      if (live.length === 0) return;
      let changed = false;
      for (const o of live) {
        const res = await getOrderStatus(o.id);
        if (!res || cancelled) continue;
        if (res.status !== o.status) {
          o.status = res.status;
          if (isFinal(res.status) && !o.finalizedAt) o.finalizedAt = Date.now();
          changed = true;
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
      if (changed && !cancelled) {
        write(list);
        refresh();
        broadcast();
      }
    };
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [orders.length]);

  // Auto-hide a served/cancelled strip one minute after it finishes.
  useEffect(() => {
    const finals = orders.filter((o) => isFinal(o.status) && o.finalizedAt && !o.dismissed);
    if (finals.length === 0) return;
    const soonest = Math.min(...finals.map((o) => (o.finalizedAt as number) + SERVED_LINGER_MS));
    const delay = Math.max(0, soonest - Date.now());
    const t = setTimeout(refresh, delay + 100);
    return () => clearTimeout(t);
  }, [orders]);

  // Hide only the floating strip — the order stays live and visible in the
  // cart's "Live now" list (it is NOT cancelled or removed).
  const hideStrip = (id: string) => {
    write(read().map((o) => (o.id === id ? { ...o, stripHidden: true } : o)));
    setDetailOpen(false);
    refresh();
    broadcast();
  };

  const visible = liveActiveOrders(orders).filter((o) => !o.stripHidden);
  // While dismissing, keep showing the SAME order that's flying into the cross.
  const order = (dismissing && dismissingOrderRef.current) || visible[0];
  if (!order) return null;

  const c = COPY[order.status];
  const stepIndex = STEPS.indexOf(order.status);
  const canEditTable = order.status === "received" || order.status === "preparing";
  const showPrice = (n: number) => (currency ? formatPrice(n, currency) : `$${n.toFixed(2)}`);

  const openDetail = () => {
    setTableDraft(order.tableNumber || "");
    setDetailOpen(true);
  };

  const saveTable = async () => {
    if (savingTable) return;
    setSavingTable(true);
    const ok = await updateOrderTableNumber(order.id, tableDraft);
    setSavingTable(false);
    if (ok) {
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
  const crossXY = () => ({ x: window.innerWidth / 2, y: window.innerHeight * CROSS_Y });

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (dismissing) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, pid: e.pointerId, moved: false };
    // Capture immediately so a fast flick that leaves the small strip still
    // delivers move/up here (and so a stray pointerdown can't wedge dragRef).
    try { stripRef.current?.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || dismissing) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 8) return; // ignore tiny jitters (tap)
    if (!d.moved) d.moved = true;
    const { x, y } = crossXY();
    setDrag({ dx, dy, over: Math.hypot(e.clientX - x, e.clientY - y) < HIT });
  };
  const endDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    try { stripRef.current?.releasePointerCapture(e.pointerId); } catch {}
    if (!d.moved) { openDetail(); return; } // it was a tap
    const { x, y } = crossXY();
    if (Math.hypot(e.clientX - x, e.clientY - y) < HIT) {
      // dropped on the cross → fly into it, then hide
      const r = stripRef.current?.getBoundingClientRect();
      const tx = r ? x - (r.left + r.width / 2) : 0;
      const ty = r ? y - (r.top + r.height / 2) : 0;
      const id = order.id;
      dismissingOrderRef.current = order; // freeze the strip we're animating out
      setDrag(null);
      setDismissing({ tx, ty });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
          message: "Tracker hidden", subtitle: "still in Previous orders",
          kicker: "order update", icon: "🧾", variant: "success",
        } }));
        hideStrip(id);
        setDismissing(null);
        dismissingOrderRef.current = null;
      }, 340);
    } else {
      // released away from the cross → spring back into place
      setSnapping(true);
      setDrag({ dx: 0, dy: 0, over: false });
      setTimeout(() => { setSnapping(false); setDrag(null); }, 260);
    }
  };
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
      {drag && (
        <div className={`ot-dropzone ${drag.over ? "over" : ""}`} aria-hidden="true">
          <div className="ot-dropzone-circle"><i className="fas fa-times"></i></div>
          <span className="ot-dropzone-label">{drag.over ? "Release to hide" : "Drop here to hide"}</span>
        </div>
      )}

      <button
        type="button"
        ref={stripRef}
        className={`order-tracker status-${order.status}`}
        style={stripStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={onPointerCancel}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); } }}
        aria-label="Order status — tap to view, drag onto the cross to hide"
      >
        <div className="ot-icon" aria-hidden="true">
          <i className={`fas ${c.icon}`}></i>
        </div>
        <div className="ot-body">
          <div className="ot-top">
            <span className="ot-label">{c.label}</span>
            {order.tableNumber && <span className="ot-table">Table {order.tableNumber}</span>}
          </div>
          <div className="ot-sub">{c.sub}</div>
          {stepIndex >= 0 && (
            <div className="ot-steps" aria-hidden="true">
              {STEPS.map((s, i) => (
                <span key={s} className={`ot-step ${i <= stepIndex ? "done" : ""} ${i === stepIndex ? "active" : ""}`} />
              ))}
            </div>
          )}
        </div>
        <span className="ot-grip" aria-hidden="true"><i className="fas fa-grip-lines"></i></span>
      </button>

      {detailOpen && (
        <>
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

            <button type="button" className="ot-hide-link" onClick={() => hideStrip(order.id)}>
              Hide this tracker — it stays in Previous orders
            </button>
          </div>
        </>
      )}
    </>
  );
}
