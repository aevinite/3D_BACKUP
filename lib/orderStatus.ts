// Shared copy + helpers for an order's live status, used by the floating
// OrderTracker strip AND the "Live now" section in the cart's Previous-orders
// tab, so both always agree on the wording/icons AND on which orders still
// count as "live". One rule, two consumers — no drift.

// OrderStatus is the type that lists the possible states an order can be in.
import type { OrderStatus } from "./menu";

// The happy-path lifecycle, in order (cancelled is off-path).
// These are the three normal stages an order moves through, in this order.
export const STEPS: OrderStatus[] = ["received", "preparing", "served"];

// The exact wording + icon to show for each status. Keeping it here (one place)
// means every part of the app describes an order the same way.
// "label" is the headline, "sub" is the smaller line under it, "icon" is a
// Font Awesome icon class (e.g. fa-receipt).
export const STATUS_COPY: Record<OrderStatus, { label: string; sub: string; icon: string }> = {
  received: { label: "Awaiting accept", sub: "Waiting for the kitchen to accept your order…", icon: "fa-receipt" },
  preparing: { label: "Preparing your order", sub: "The kitchen is on it 👨‍🍳", icon: "fa-fire-burner" },
  served: { label: "Served — enjoy!", sub: "Bon appétit 🍽️", icon: "fa-utensils" },
  cancelled: { label: "Order cancelled", sub: "Please ask a member of staff.", icon: "fa-circle-xmark" },
};

// --- Live order tracking (localStorage) -----------------------------------

// The localStorage key under which this device's in-progress orders are saved.
// Tenant-scoped (lfh_active_orders:<slug>) so one restaurant's live order bar
// never floats over another restaurant's menu on the same phone.
import { tget, tset } from "./tenantStorage";
export const ACTIVE_ORDERS_KEY = "lfh_active_orders";
export const POLL_MS = 1500; // how often a guest re-checks their order's status (snappy near-real-time)
// With Realtime ON, the guest refetches the instant a breadcrumb arrives (via the
// `lfh:rt-tick` window event), so the timer below is only a slow safety-net poll
// for when the WebSocket is asleep/dropped. (Was POLL_MS=1.5s of constant polling.)
export const RT_BACKUP_MS = 60 * 1000;
export const SERVED_LINGER_MS = 5 * 1000; // a served/cancelled order lingers 5s in the live view, then drops into Previous orders (becomes a past bill)
export const MAX_AGE_MS = 3 * 60 * 60 * 1000; // stop following an order after 3h (3 hrs * 60 min * 60 sec * 1000 ms)

// One order this device placed and is still following the status of.
// This describes everything we remember about a single live order.
export interface ActiveOrder {
  id: string;
  tableNumber: string;
  total: number;
  itemCount: number;
  items?: { title: string; qty: number }[];
  status: OrderStatus;
  placedAt: number;
  finalizedAt?: number; // when we first saw it served/cancelled
  dismissed?: boolean;
  // Hidden from the floating strip only (dragged onto the cross). The order is
  // still live: it keeps polling and still shows in the cart's "Live now" list.
  stripHidden?: boolean;
}

// True if the order is "done" — either served or cancelled. Once final, there's
// nothing more to wait for, so we stop treating it as actively in-progress.
export const isFinalStatus = (s: OrderStatus) => s === "served" || s === "cancelled";

// Load this device's saved orders out of localStorage and hand them back as a list.
// Everything is wrapped in try/catch so that bad/missing saved data never crashes
// the page — we just return an empty list instead.
export const readActiveOrders = (): ActiveOrder[] => {
  try {
    const raw = tget(ACTIVE_ORDERS_KEY);
    // localStorage stores text, so JSON.parse turns that text back into a list.
    const list = raw ? JSON.parse(raw) : [];
    // Double-check it really is a list before trusting it.
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

// Save the given list of orders back into localStorage (as text via JSON.stringify).
// Quietly does nothing if saving fails (e.g. storage full or private mode).
export const writeActiveOrders = (list: ActiveOrder[]) => {
  tset(ACTIVE_ORDERS_KEY, JSON.stringify(list));
};

// The orders still worth showing live: not dismissed and not aged out. A SERVED
// (or cancelled) order now STAYS in the live panel — it no longer drops after a
// few seconds. It only goes away when the dining session ends / a new session
// starts (that clears lfh_active_orders), so the guest keeps seeing "everything
// served" for the rest of their visit (owner, 2026-06-14). Newest first.
export const liveActiveOrders = (list: ActiveOrder[], now: number = Date.now()): ActiveOrder[] =>
  list
    // .filter keeps only the orders that pass this test; the rest drop away.
    .filter((o) => {
      // Drop it only if the guest dismissed it, or it's older than our 3-hour limit.
      if (o.dismissed || now - o.placedAt > MAX_AGE_MS) return false;
      // Served/cancelled stay visible (until the session ends or it's dismissed) —
      // no timed disappearance.
      return true;
    })
    // .sort with (b - a) puts the most recently placed order first (newest first).
    .sort((a, b) => b.placedAt - a.placedAt);

// True when an order is still cooking (received/preparing) AND its floating
// strip was hidden (dragged to the cross). That's exactly when we show the red
// "you still have a live order" dot on the cart icon + Previous-orders tab.
// If the strip is visible (not hidden), this is false — no dot needed.
// .some returns true if AT LEAST ONE order matches: it's hidden from the strip
// and still cooking. That single match is enough to light up the red dot.
export const hasHiddenLiveOrder = (list: ActiveOrder[], now: number = Date.now()): boolean =>
  liveActiveOrders(list, now).some((o) => o.stripHidden && !isFinalStatus(o.status));
