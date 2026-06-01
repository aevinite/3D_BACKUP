// Shared copy + helpers for an order's live status, used by the floating
// OrderTracker strip AND the "Live now" section in the cart's Previous-orders
// tab, so both always agree on the wording/icons AND on which orders still
// count as "live". One rule, two consumers — no drift.

import type { OrderStatus } from "./menu";

// The happy-path lifecycle, in order (cancelled is off-path).
export const STEPS: OrderStatus[] = ["received", "preparing", "served"];

export const STATUS_COPY: Record<OrderStatus, { label: string; sub: string; icon: string }> = {
  received: { label: "Order received", sub: "Waiting for the kitchen to confirm…", icon: "fa-receipt" },
  preparing: { label: "Preparing your order", sub: "The kitchen is on it 👨‍🍳", icon: "fa-fire-burner" },
  served: { label: "Served — enjoy!", sub: "Bon appétit 🍽️", icon: "fa-utensils" },
  cancelled: { label: "Order cancelled", sub: "Please ask a member of staff.", icon: "fa-circle-xmark" },
};

// --- Live order tracking (localStorage) -----------------------------------

export const ACTIVE_ORDERS_KEY = "lfh_active_orders";
export const POLL_MS = 3000; // how often a guest re-checks their order's status (lowered from 8s)
export const SERVED_LINGER_MS = 60 * 1000; // a served/cancelled card lingers one minute, then goes
export const MAX_AGE_MS = 3 * 60 * 60 * 1000; // stop following an order after 3h

// One order this device placed and is still following the status of.
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

export const isFinalStatus = (s: OrderStatus) => s === "served" || s === "cancelled";

export const readActiveOrders = (): ActiveOrder[] => {
  try {
    const raw = localStorage.getItem(ACTIVE_ORDERS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const writeActiveOrders = (list: ActiveOrder[]) => {
  try {
    localStorage.setItem(ACTIVE_ORDERS_KEY, JSON.stringify(list));
  } catch {}
};

// The orders still worth showing live: not dismissed, not aged out, and either
// in-progress OR finished within the last minute (so "Served!" lingers briefly).
// Newest first.
export const liveActiveOrders = (list: ActiveOrder[], now: number = Date.now()): ActiveOrder[] =>
  list
    .filter((o) => {
      if (o.dismissed || now - o.placedAt > MAX_AGE_MS) return false;
      if (isFinalStatus(o.status)) return !!o.finalizedAt && now - o.finalizedAt < SERVED_LINGER_MS;
      return true;
    })
    .sort((a, b) => b.placedAt - a.placedAt);

// True when an order is still cooking (received/preparing) AND its floating
// strip was hidden (dragged to the cross). That's exactly when we show the red
// "you still have a live order" dot on the cart icon + Previous-orders tab.
// If the strip is visible (not hidden), this is false — no dot needed.
export const hasHiddenLiveOrder = (list: ActiveOrder[], now: number = Date.now()): boolean =>
  liveActiveOrders(list, now).some((o) => o.stripHidden && !isFinalStatus(o.status));
