// Runs in the browser so it can read/save the cart and react to taps.
"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, prettyUsd, getCurrency, type CurrencyMeta } from "@/lib/format";
import { getMenuItems, getSettings, createOrder, type MenuItem } from "@/lib/menu";
import { ALLERGENS, allergenIcon, allergenLabel } from "@/lib/allergens";
import { validateTable, flagTableInput, getScannedTable } from "@/lib/table";
import { getStoredSession } from "@/lib/session";
import SessionTableBill from "@/components/SessionTableBill";
import {
  STEPS,
  STATUS_COPY,
  type ActiveOrder,
  readActiveOrders,
  liveActiveOrders,
  isFinalStatus,
} from "@/lib/orderStatus";

// A single chosen option on a dish (e.g. group "Size", label "Large", +price).
interface CartOption { group: string; label: string; price: number }
// One line in the cart: a dish, how many, and any customizations.
interface CartItem {
  id: string;
  title: string;
  price: string;
  image: string;
  qty: number;
  options?: CartOption[];
  removed?: string[];
  note?: string;
  sig?: string;
}

// A past order kept in this device's history (for the "Previous orders" tab).
interface HistoryOrder {
  id: string;
  tableNumber: string;
  total: number;
  items: { title: string; qty: number; price: string }[];
  placedAt: number;
}

const TAX_RATE = 0.05; // 5% — shown as a line on the bill

// normalize(): take whatever messy data was saved in localStorage and turn it
// into a clean, predictable list of CartItems (filling in safe defaults). This
// guards against old/corrupt saved data crashing the cart.
const normalize = (raw: unknown): CartItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is { id: string; title: string; price: string; image: string; qty?: number; options?: CartOption[]; removed?: string[]; note?: string; sig?: string } =>
      !!it && typeof it === "object" && "id" in it
    )
    .map((it) => ({
      id: it.id,
      title: it.title,
      price: it.price,
      image: it.image,
      qty: typeof it.qty === "number" && it.qty > 0 ? it.qty : 1,
      options: Array.isArray(it.options) ? it.options : undefined,
      removed: Array.isArray(it.removed) ? it.removed : undefined,
      note: typeof it.note === "string" ? it.note : undefined,
      sig: it.sig,
    }));
};

// CartPanel: the full "Your Bill" slide-out. It lists what's in the cart, lets
// the guest change quantities, flag allergies, enter their table number, and
// place the order. It also has a "Previous orders" tab with live + past orders.
export default function CartPanel() {
  // Each useState below is a memory box; changing it re-draws the panel:
  const [open, setOpen] = useState(false); // is the panel slid open?
  const [cart, setCart] = useState<CartItem[]>([]); // the current cart lines
  const [tableNumber, setTableNumber] = useState(""); // table number the guest typed
  const [scannedTable, setScannedTableState] = useState(""); // table from a QR deep-link, if any
  const [lockedTable, setLockedTable] = useState<string | null>(null); // when in a session you can ONLY order for that table
  const [tableCount, setTableCount] = useState(0); // how many tables exist; 0 = no limit known
  const [sessionsEnabled, setSessionsEnabled] = useState(false); // v2 dining-session system
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null); // currency for all prices
  const [allergenMap, setAllergenMap] = useState<Record<string, string[]>>({}); // dish id -> its allergens, for warnings
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]); // the full menu (for pairings/editing)
  const [history, setHistory] = useState<HistoryOrder[]>([]); // this device's past orders
  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>([]); // orders still in progress
  const [showHistory, setShowHistory] = useState(false); // which tab: false=current bill, true=previous orders
  const [declared, setDeclared] = useState<string[]>([]); // allergens the diner avoids
  const [otherAllergy, setOtherAllergy] = useState(""); // free-text allergy not in the list
  const [otherOpen, setOtherOpen] = useState(false); // reveal the free-text field
  const [placing, setPlacing] = useState(false); // true while an order is being sent, to block double taps
  const declaredHydrated = useRef(false); // skip the first persist so restore can't be clobbered

  // loadCart(): read the saved cart from localStorage and clean it up.
  const loadCart = () => {
    try {
      const saved = localStorage.getItem("lfh_cart");
      setCart(saved ? normalize(JSON.parse(saved)) : []);
    } catch {
      setCart([]);
    }
  };
  // saveCart(): write the cart back to the browser's notepad (localStorage).
  const saveCart = (newCart: CartItem[]) => {
    try {
      localStorage.setItem("lfh_cart", JSON.stringify(newCart));
    } catch {}
  };
  // commit(): the one place that changes the cart — it updates the screen, saves
  // to storage, and broadcasts "lfh:cart-updated" so the badge/mini-cart refresh.
  const commit = (next: CartItem[]) => {
    setCart(next);
    saveCart(next);
    window.dispatchEvent(new Event("lfh:cart-updated"));
  };
  // decrement(): the "−" button. Lower the quantity by one, or remove the line
  // entirely if it would drop to zero.
  const decrement = (idx: number) => {
    const next = [...cart]; // copy first (never edit state directly)
    if (next[idx].qty > 1) next[idx] = { ...next[idx], qty: next[idx].qty - 1 };
    else next.splice(idx, 1); // was 1 -> remove the line
    commit(next);
  };
  // increment(): the "+" button. Add one to the quantity.
  const increment = (idx: number) => {
    const next = [...cart];
    next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
    commit(next);
  };
  // removeFromCart(): the trash button. Drop this line from the cart.
  const removeFromCart = (idx: number) => {
    const next = [...cart];
    next.splice(idx, 1);
    commit(next);
  };

  // The big setup effect: runs once when the panel mounts. It loads everything
  // and wires up all the "listen for app messages" handlers.
  useEffect(() => {
    loadCart();
    setCurrencyState(getCurrency());
    // allergen lookup by dish id (so the bill can warn)
    getMenuItems()
      .then((items) => {
        const m: Record<string, string[]> = {};
        items.forEach((i) => (m[i.id] = i.allergens || []));
        setAllergenMap(m);
        setMenuItems(items);
      })
      .catch(() => {});
    // How many tables exist, so we can reject an out-of-range table number.
    getSettings()
      .then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); })
      .catch(() => {});

    const loadHistory = () => {
      try {
        const r = localStorage.getItem("lfh_order_history");
        const p = r ? JSON.parse(r) : [];
        setHistory(Array.isArray(p) ? p : []);
      } catch { setHistory([]); }
    };
    // Live orders are written/polled by OrderTracker; we just read them here.
    const loadLive = () => setLiveOrders(liveActiveOrders(readActiveOrders()));
    loadHistory();
    loadLive();
    // restore order-wide allergy avoidances (set via "apply to all" or the bill section)
    try {
      const d = JSON.parse(localStorage.getItem("lfh_declared") || "[]");
      if (Array.isArray(d) && d.length) setDeclared(d);
    } catch {}
    // Pre-fill the table from a scanned QR (?table=N stored in lib/table). Only
    // fills an empty field, so it never clobbers what the guest typed.
    const prefillScanned = () => {
      const scanned = getScannedTable();
      setScannedTableState(scanned);
      if (scanned) setTableNumber((cur) => cur || scanned);
    };
    // While you hold a session, lock the table to it — you can only order for the
    // table you're seated at (leave the table to order elsewhere).
    const syncSession = () => {
      const ss = getStoredSession();
      setLockedTable(ss?.table || null);
      if (ss?.table) setTableNumber(ss.table);
    };
    prefillScanned();
    syncSession();
    // handleOpen: when "lfh:open-cart" fires, slide the panel open and refresh
    // everything it shows.
    const handleOpen = () => {
      setOpen(true); loadCart(); loadHistory(); loadLive(); setShowHistory(false); prefillScanned(); syncSession();
      // re-read settings on open so a freshly-toggled sessions mode is always respected
      getSettings().then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); }).catch(() => {});
    };
    // handleShowPrev: open straight to the "Previous orders" tab (the live table
    // view with the served-progress bar). Fired when the multi-order tracker is tapped.
    const handleShowPrev = () => { setOpen(true); setShowHistory(true); loadHistory(); loadLive(); };
    const handleClose = () => setOpen(false); // "lfh:close-all" -> slide shut
    const handleScanned = prefillScanned; // a QR table scan arrived -> pre-fill table
    const handleCartUpdated = loadCart; // cart changed elsewhere -> re-read it
    const handleCurrency = () => setCurrencyState(getCurrency()); // currency switched -> refresh
    // Re-read live orders whenever one is placed or its status changes.
    const handleOrdersChanged = () => { loadLive(); loadHistory(); };
    // handleAvoidAll: someone ticked "avoid X in all my dishes" in the popup —
    // merge those allergens into our order-wide avoid list.
    const handleAvoidAll = (e: Event) => {
      const list = (e as CustomEvent<{ allergens: string[] }>).detail?.allergens || [];
      setDeclared((d) => Array.from(new Set([...d, ...list])));
    };
    // Start listening for all the app-wide messages above.
    window.addEventListener("lfh:open-cart", handleOpen);
    window.addEventListener("lfh:show-previous-orders", handleShowPrev);
    window.addEventListener("lfh:close-all", handleClose);
    window.addEventListener("lfh:table-scanned", handleScanned);
    window.addEventListener("lfh:session-changed", syncSession);
    window.addEventListener("lfh:cart-updated", handleCartUpdated);
    window.addEventListener("lfh:currency-changed", handleCurrency);
    window.addEventListener("lfh:avoid-all", handleAvoidAll);
    window.addEventListener("lfh:order-placed", handleOrdersChanged);
    window.addEventListener("lfh:orders-updated", handleOrdersChanged);
    window.addEventListener("storage", handleOrdersChanged); // changes from other tabs
    // Cleanup: stop listening when the panel unmounts so we don't leak listeners.
    return () => {
      window.removeEventListener("lfh:avoid-all", handleAvoidAll);
      window.removeEventListener("lfh:open-cart", handleOpen);
      window.removeEventListener("lfh:show-previous-orders", handleShowPrev);
      window.removeEventListener("lfh:close-all", handleClose);
      window.removeEventListener("lfh:table-scanned", handleScanned);
      window.removeEventListener("lfh:session-changed", syncSession);
      window.removeEventListener("lfh:cart-updated", handleCartUpdated);
      window.removeEventListener("lfh:currency-changed", handleCurrency);
      window.removeEventListener("lfh:order-placed", handleOrdersChanged);
      window.removeEventListener("lfh:orders-updated", handleOrdersChanged);
      window.removeEventListener("storage", handleOrdersChanged);
    };
  }, []);

  // Persist the order-wide allergy avoidances. Skip the very first run: on mount
  // `declared` is still the empty default while the restore (above) is being
  // applied, so writing here would overwrite the saved list with [].
  useEffect(() => {
    if (!declaredHydrated.current) { declaredHydrated.current = true; return; }
    try { localStorage.setItem("lfh_declared", JSON.stringify(declared)); } catch {}
  }, [declared]);

  // While the cart is open, re-evaluate live orders every few seconds so a
  // "Served!" card drops off after its one-minute linger — that expiry is
  // time-based, so no event fires for it.
  useEffect(() => {
    if (!open) return;
    const refreshLive = () => setLiveOrders(liveActiveOrders(readActiveOrders()));
    refreshLive();
    const iv = setInterval(refreshLive, 5000);
    return () => clearInterval(iv);
  }, [open]);

  // showPrice(): format a number as a price string in the chosen currency.
  const showPrice = (n: number) => (currency ? formatMoney(n, currency) : `$${n.toFixed(2)}`);
  // Orders shown live up top are hidden from the history list below, so the
  // same order never appears twice in the same tab.
  const liveIds = new Set(liveOrders.map((o) => o.id));
  const pastOrders = history.filter((h) => !liveIds.has(h.id));
  // Red dot on the Previous-orders tab: a live order whose floating strip was hidden.
  const hiddenLive = liveOrders.some((o) => o.stripHidden && !isFinalStatus(o.status));
  // Bill math: subtotal = sum of (each line's price × its quantity).
  const subtotal = cart.reduce((sum, it) => sum + prettyUsd(it.price) * it.qty, 0);
  const itemCount = cart.reduce((sum, it) => sum + it.qty, 0); // total number of items
  const tax = subtotal * TAX_RATE; // 5% of the subtotal
  const total = subtotal + tax; // what the guest pays

  // itemAllergens(): the allergens a given dish contains.
  const itemAllergens = (id: string) => allergenMap[id] || [];
  // conflicts(): of a dish's allergens, which ones the guest said they avoid.
  const conflicts = (id: string) => itemAllergens(id).filter((a) => declared.includes(a));
  // orderDeclaredHits: every avoided allergen that appears anywhere in the cart (no repeats).
  const orderDeclaredHits = [...new Set(cart.flatMap((it) => conflicts(it.id)))];
  // toggleDeclared(): tap an allergy chip on/off in the avoid list.
  const toggleDeclared = (slug: string) =>
    setDeclared((d) => (d.includes(slug) ? d.filter((x) => x !== slug) : [...d, slug]));

  // Re-open the customize popup for an existing line, pre-filled, to edit it.
  // We broadcast "lfh:open-order-confirm" with the dish + its current choices so
  // the OrderConfirmModal opens already filled in.
  const editLine = (it: CartItem) => {
    const dish = menuItems.find((m) => m.id === it.id);
    if (!dish) return;
    window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", {
      detail: {
        item: { id: dish.id, title: dish.title, price: dish.price, image: dish.image },
        options: dish.options,
        allergens: dish.allergens,
        editSig: it.sig || "[]",
        preselect: { options: it.options, removed: it.removed, note: it.note, qty: it.qty },
      },
    }));
  };
  // isCustomizable(): can this dish be edited? True if it has options or allergens
  // (otherwise there's nothing to customize, so we hide the "Edit" button).
  const isCustomizable = (id: string) => {
    const d = menuItems.find((m) => m.id === id);
    return !!d && (((d.options || []).length > 0) || ((d.allergens || []).length > 0));
  };

  // Gentle pairing upsell: the top-rated drink/dessert not already on the bill.
  const cartIds = new Set(cart.map((c) => c.id));
  const PAIR_CATS = ["coffee", "beverages", "desserts"];
  const pairing =
    cart.length > 0
      ? menuItems
          // Only suggest things the guest can actually order: not already on the
          // bill, in a pairing category, and NOT flagged sold-out (sold-out lives
          // in the dish's tags, same as the "Not available" pill on the cards).
          .filter(
            (i) =>
              !cartIds.has(i.id) &&
              PAIR_CATS.includes(i.category) &&
              !(i.tags || []).includes("sold-out"),
          )
          .sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))[0] || null
      : null;
  // addPairing(): tap the "+ Add" on the suggested pairing. Add it to the cart
  // (or bump its quantity if it's already there) and pop a confirmation toast.
  const addPairing = (it: MenuItem) => {
    const next = [...cart];
    const idx = next.findIndex((c) => c.id === it.id);
    if (idx >= 0) next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
    else next.push({ id: it.id, title: it.title, price: it.price, image: it.image, qty: 1 });
    commit(next);
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${it.title} added`, kicker: "your order" } }));
  };

  // placeOrder(): the big "Place Order" button. Validates the table number, then
  // either routes through the v2 dining-session flow or sends the order directly.
  const placeOrder = async () => {
    if (cart.length === 0 || placing) return; // nothing to send, or already sending
    // Table number is required AND must be a real table (see lib/table.ts).
    const check = validateTable(tableNumber, tableCount);
    if (!check.ok) {
      // Bad/empty/out-of-range table -> highlight the field with the reason and stop.
      flagTableInput("cart-table", check.message!);
      return;
    }
    const tableTrim = check.value; // the cleaned-up table number

    // v2: when the dining-session system is ON, route the order through the
    // SessionGate (location -> join -> OTP -> the server places it). On success
    // we still record it locally so the existing tracker follows its status.
    if (sessionsEnabled) {
      setPlacing(true);
      // Bundle up everything the session flow will need, captured now (before we
      // clear the cart), so it's all still here when the gate finishes.
      const allergiesS = [...declared, ...(otherAllergy.trim() ? [otherAllergy.trim()] : [])];
      // What we send the server: id + qty + chosen options (group/label only) +
      // removed allergens + note. NO prices and NO title — the server looks those
      // up from menu_items and prices the bill itself, so nothing here is trusted.
      const itemsS = cart.map((it) => ({ id: it.id, qty: it.qty, options: it.options?.map((o) => ({ group: o.group, label: o.label })), removed: it.removed, note: it.note }));
      const trackS = cart.map((it) => ({ title: it.title, qty: it.qty })); // slim list for the tracker
      const histS = cart.map((it) => ({ title: it.title, qty: it.qty, price: it.price })); // list for history
      const totalS = total, countS = itemCount;
      // onDone: runs once the SessionGate finishes (after location/join/OTP). If the
      // server actually placed the order, we record it locally so the tracker follows it.
      const onDone = (e: Event) => {
        window.removeEventListener("lfh:session-done", onDone);
        setPlacing(false);
        const d = (e as CustomEvent).detail as { ok?: boolean; action?: string; orderId?: string };
        if (!d?.ok || d.action !== "order" || !d.orderId) return; // the gate showed its own message
        try {
          // Save into the "active orders" list so the OrderTracker shows it.
          const raw = localStorage.getItem("lfh_active_orders");
          const arr = (() => { const p = raw ? JSON.parse(raw) : []; return Array.isArray(p) ? p : []; })();
          arr.push({ id: d.orderId, tableNumber: tableTrim, total: totalS, itemCount: countS, items: trackS, status: "received", placedAt: Date.now() });
          localStorage.setItem("lfh_active_orders", JSON.stringify(arr));
          window.dispatchEvent(new Event("lfh:order-placed")); // wake the tracker
        } catch {}
        try {
          // Also add it to the browser-only permanent history (newest first, max 50).
          const rawH = localStorage.getItem("lfh_order_history");
          const hist = (() => { const p = rawH ? JSON.parse(rawH) : []; return Array.isArray(p) ? p : []; })();
          hist.unshift({ id: d.orderId, tableNumber: tableTrim, total: totalS, items: histS, placedAt: Date.now() });
          localStorage.setItem("lfh_order_history", JSON.stringify(hist.slice(0, 50)));
          setHistory(hist.slice(0, 50));
        } catch {}
        // Empty the cart and reset the allergy fields, then refresh + close.
        setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
        window.dispatchEvent(new Event("lfh:cart-updated"));
        window.dispatchEvent(new Event("lfh:close-all"));
      };
      // Listen for the gate's result, then kick off the session flow.
      window.addEventListener("lfh:session-done", onDone);
      window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "order", table: tableTrim, payload: { items: itemsS, allergies: allergiesS } } }));
      return; // the rest below is the non-session path
    }

    // ── Non-session path: send the order straight to the kitchen. ──
    setPlacing(true);
    try {
      const allergies = [...declared, ...(otherAllergy.trim() ? [otherAllergy.trim()] : [])];
      // Send ONLY id + qty + options (group/label) + removed + note — no prices.
      // The server prices and stores the order, then hands back its id to track.
      const orderId = await createOrder({
        tableNumber: tableTrim,
        items: cart.map((it) => ({ id: it.id, qty: it.qty, options: it.options?.map((o) => ({ group: o.group, label: o.label })), removed: it.removed, note: it.note })),
        allergies,
      });
      // Remember this order on THIS device so the guest can follow its status.
      try {
        const raw = localStorage.getItem("lfh_active_orders");
        const list = raw ? JSON.parse(raw) : [];
        const active = Array.isArray(list) ? list : [];
        active.push({ // add this order to the live-tracking list
          id: orderId,
          tableNumber: tableTrim,
          total,
          itemCount,
          items: cart.map((it) => ({ title: it.title, qty: it.qty })),
          status: "received",
          placedAt: Date.now(),
        });
        localStorage.setItem("lfh_active_orders", JSON.stringify(active));
        window.dispatchEvent(new Event("lfh:order-placed")); // wake the tracker
      } catch {}
      // Also keep a permanent history this device can browse later.
      try {
        const rawH = localStorage.getItem("lfh_order_history");
        const hist = (() => { const p = rawH ? JSON.parse(rawH) : []; return Array.isArray(p) ? p : []; })();
        hist.unshift({
          id: orderId,
          tableNumber: tableTrim,
          total,
          items: cart.map((it) => ({ title: it.title, qty: it.qty, price: it.price })),
          placedAt: Date.now(),
        });
        // Kept only in the guest's own browser (never Supabase); persists across visits.
        localStorage.setItem("lfh_order_history", JSON.stringify(hist.slice(0, 50)));
        setHistory(hist.slice(0, 50));
      } catch {}
      // Pop a success toast confirming the order went to the kitchen.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: "Order placed",
        subtitle: tableTrim ? `table ${tableTrim} · sent to kitchen` : "sent to kitchen",
        kicker: "to the kitchen",
        icon: "🧾",
        variant: "success",
      } }));
      // Empty the cart + reset the allergy fields, then refresh and close the panel.
      setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
      window.dispatchEvent(new Event("lfh:cart-updated"));
      window.dispatchEvent(new Event("lfh:close-all"));
    } catch {
      // Something failed (network, server) — tell the guest to try again.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Order didn't go through", subtitle: "please try again", kicker: "order", variant: "error" } }));
    } finally {
      setPlacing(false); // re-enable the button either way
    }
  };

  // If the panel isn't open, draw nothing at all.
  if (!open) return null;

  // Shared inline styling for the round − / + quantity buttons.
  const qtyBtn = {
    width: "28px", height: "28px", borderRadius: "50%",
    border: "1px solid rgba(212,165,116,0.4)", background: "transparent",
    color: "var(--text)", cursor: "pointer", fontSize: "16px", lineHeight: 1, fontWeight: 700,
  } as const;

  return (
    <>
      {/* Dark backdrop behind the panel; tapping it broadcasts "close everything". */}
      <div className="overlay active" onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}></div>
      {/* The slide-out panel itself. */}
      <div id="cart-panel" className="cart-panel panel open">
        {/* Top bar with Back and close (X) buttons — both just close the panel. */}
        <div className="cart-topbar">
          <button
            type="button"
            className="cart-back"
            onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}
          >
            <i className="fas fa-arrow-left"></i> Back
          </button>
          <button className="nav-btn" title="Close" aria-label="Close cart" onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <h3 className="panel-title" style={{ margin: "0 0 20px", textAlign: "left" }}>
          <i className="fas fa-receipt"></i> Your Bill
          {cart.length > 0 && (
            <span style={{ color: "var(--muted)", fontSize: "13px", fontWeight: 500 }}>
              {" "}· {itemCount} item{itemCount !== 1 ? "s" : ""}
            </span>
          )}
        </h3>

        {/* The two tabs: "Current bill" and "Previous orders" (with a count + live dot). */}
        <div className="cart-tabs">
          <button type="button" className={!showHistory ? "active" : ""} onClick={() => setShowHistory(false)}>Current bill</button>
          <button type="button" className={showHistory ? "active" : ""} onClick={() => setShowHistory(true)}>
            Previous orders{liveOrders.length + pastOrders.length ? ` (${liveOrders.length + pastOrders.length})` : ""}
            {hiddenLive && <span className="tab-live-dot" aria-label="Live order in progress" />}
          </button>
        </div>

        {/* Show EITHER the history tab OR the current-bill tab, never both. */}
        {showHistory ? (
          /* ── HISTORY TAB ── */
          <div className="order-history">
            <SessionTableBill />
            {/* "Live now": orders still in progress, shown with their status + steps. */}
            {liveOrders.length > 0 && (
              <div className="live-orders">
                <div className="live-orders-head">
                  <span className="live-dot" aria-hidden="true"></span>
                  Live now
                  <span className="live-count">{liveOrders.length}</span>
                </div>
                {liveOrders.map((o) => {
                  const cp = STATUS_COPY[o.status];
                  const stepIndex = STEPS.indexOf(o.status);
                  return (
                    <div key={o.id} className={`live-order status-${o.status}`}>
                      <div className="live-order-top">
                        <div className="ot-icon" aria-hidden="true">
                          <i className={`fas ${cp.icon}`}></i>
                        </div>
                        <div className="live-order-info">
                          <div className="live-order-label">{cp.label}</div>
                          <div className="live-order-sub">{cp.sub}</div>
                        </div>
                        {o.tableNumber && <span className="live-order-table">Table {o.tableNumber}</span>}
                      </div>
                      {stepIndex >= 0 && (
                        <div className="ot-steps" aria-hidden="true">
                          {STEPS.map((s, i) => (
                            <span key={s} className={`ot-step ${i <= stepIndex ? "done" : ""} ${i === stepIndex ? "active" : ""}`} />
                          ))}
                        </div>
                      )}
                      {o.items && o.items.length > 0 && (
                        <div className="live-order-items">
                          {o.items.map((it) => `${it.title} ×${it.qty}`).join(", ")}
                        </div>
                      )}
                      <div className="live-order-total"><span>Total</span><span>{showPrice(o.total)}</span></div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Friendly empty state when there's nothing live AND nothing in history. */}
            {pastOrders.length === 0 && liveOrders.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", padding: "44px 16px", fontSize: 15 }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>🧾</div>
                No previous orders yet.<br />Your past orders will show up here.
              </div>
            )}

            {/* The finished/older orders list. */}
            {pastOrders.length > 0 && (
              <>
                {liveOrders.length > 0 && <div className="hist-earlier-head">Earlier orders</div>}
                {pastOrders.map((h) => (
                  <div key={h.id} className="hist-order">
                    <div className="hist-top">
                      <span className="hist-table">{h.tableNumber ? `Table ${h.tableNumber}` : "Order"}</span>
                      <span className="hist-when">{new Date(h.placedAt).toLocaleString()}</span>
                    </div>
                    <div className="hist-items">
                      {h.items.map((it, i) => (
                        <span key={i}>{it.title} ×{it.qty}{i < h.items.length - 1 ? ", " : ""}</span>
                      ))}
                    </div>
                    <div className="hist-total"><span>Total</span><span>{showPrice(h.total)}</span></div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
        /* ── CURRENT BILL TAB ── */
        <>
        {/* The scrollable list of cart lines. */}
        <div id="cart-list" className="cart-list">
          {cart.length === 0 ? (
            // Empty cart message.
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "50px 0", fontSize: "15px" }}>
              Your cart is empty
            </div>
          ) : (
            // One block per cart line.
            cart.map((item, idx) => {
              const c = conflicts(item.id); // allergens in THIS dish the guest avoids
              return (
                <div key={`${item.id}-${item.sig || ""}-${idx}`} className="cart-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cart-item-name">{item.title}</div>
                    {/* Chosen options (e.g. "Large, Oat milk"), if any. */}
                    {item.options && item.options.length > 0 && (
                      <div className="cart-item-opts">
                        {item.options.map((o) => o.label).join(", ")}
                      </div>
                    )}
                    {/* Removed allergens shown in red (e.g. "No milk"). */}
                    {item.removed && item.removed.length > 0 && (
                      <div className="cart-item-opts" style={{ color: "#fca5a5" }}>
                        No {item.removed.map((r) => allergenLabel(r).toLowerCase()).join(", ")}
                      </div>
                    )}
                    {/* The guest's free-text note, in quotes. */}
                    {item.note && <div className="cart-item-opts">“{item.note}”</div>}
                    {itemAllergens(item.id).length > 0 && (
                      <div className="cart-item-allergens">
                        {itemAllergens(item.id).map((a) => (
                          <span
                            key={a}
                            className={`allergen-dot ${declared.includes(a) ? "flag" : ""}`}
                            title={`Contains ${allergenLabel(a).toLowerCase()}`}
                          >
                            {allergenIcon(a)}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* A clear warning if this dish conflicts with an avoided allergen. */}
                    {c.length > 0 && (
                      <div className="cart-item-warn">
                        <i className="fas fa-triangle-exclamation"></i> contains {c.map(allergenLabel).join(", ").toLowerCase()}
                      </div>
                    )}
                    {/* Quantity controls: − , the count, + , and an Edit button if customizable. */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                      <button type="button" aria-label={`Decrease ${item.title}`} onClick={() => decrement(idx)} style={qtyBtn}>−</button>
                      <span style={{ minWidth: "32px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "var(--text)" }}>{item.qty}x</span>
                      <button type="button" aria-label={`Increase ${item.title}`} onClick={() => increment(idx)} style={qtyBtn}>+</button>
                      {isCustomizable(item.id) && (
                        <button type="button" className="cart-edit-btn" onClick={() => editLine(item)}>
                          <i className="fas fa-pen"></i> Edit
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Right side of the line: this line's price (price × qty) and a trash button. */}
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div className="cart-item-price">{showPrice(prettyUsd(item.price) * item.qty)}</div>
                    <button type="button" className="remove-item" aria-label={`Remove ${item.title}`} onClick={() => removeFromCart(idx)} style={{ background: "transparent", border: "none", padding: "8px" }}>
                      <i className="fas fa-trash" style={{ fontSize: "18px" }}></i>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Everything below only shows when there's at least one item in the cart. */}
        {cart.length > 0 && (
          <>
            {/* Gentle upsell: a suggested drink/dessert that's not already on the bill. */}
            {pairing && (
              <div className="pairing">
                <div className="pairing-label">✨ Goes well with</div>
                <div className="pairing-card">
                  {pairing.image && <img src={pairing.image} alt="" className="pairing-img" />}
                  <div className="pairing-info">
                    <div className="pairing-name">{pairing.title}</div>
                    <div className="pairing-price">{showPrice(parseFloat(pairing.price))}</div>
                  </div>
                  <button type="button" className="pairing-add" onClick={() => addPairing(pairing)}>
                    + Add
                  </button>
                </div>
              </div>
            )}

            {/* Order-wide allergy section: tap chips for things to avoid across the whole order. */}
            <div className="allergy-section">
              <h4><i className="fas fa-shield-heart"></i> Any allergies? Tap what you avoid</h4>
              <div className="allergy-chips">
                {ALLERGENS.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    className={`allergy-toggle ${declared.includes(a.slug) ? "on" : ""}`}
                    aria-pressed={declared.includes(a.slug)}
                    onClick={() => toggleDeclared(a.slug)}
                  >
                    {a.icon} {a.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`allergy-toggle ${otherOpen ? "on" : ""}`}
                  aria-pressed={otherOpen}
                  onClick={() => setOtherOpen((o) => !o)}
                >
                  ✏️ Other
                </button>
              </div>
              {/* Free-text "other allergy" box, shown only when "Other" is toggled on. */}
              {otherOpen && (
                <input
                  type="text"
                  className="table-input"
                  style={{ marginTop: "10px", marginBottom: 0 }}
                  placeholder="Type your allergy…"
                  aria-label="Other allergy"
                  value={otherAllergy}
                  onChange={(e) => setOtherAllergy(e.target.value)}
                  autoFocus
                />
              )}
              {/* Overall warning if any avoided allergen appears anywhere in the order. */}
              {orderDeclaredHits.length > 0 && (
                <div className="allergy-warning">
                  <i className="fas fa-triangle-exclamation"></i> Heads up — your order contains{" "}
                  <b>{orderDeclaredHits.map(allergenLabel).join(", ").toLowerCase()}</b>. Flagged dishes are marked above.
                </div>
              )}
            </div>

            {/* A little note above the table field: locked (in a session) or pre-filled from a QR. */}
            {lockedTable ? (
              <div className="table-scanned-note">🔒 You&apos;re at table {lockedTable} — orders go here. Leave the table (top-right) to order elsewhere.</div>
            ) : (scannedTable && tableNumber === scannedTable && (
              <div className="table-scanned-note">📍 Table {scannedTable} — from your table&apos;s QR. Tap to change if that&apos;s not right.</div>
            ))}
            {/* The table-number input (required). Locked to read-only while in a session. */}
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              id="cart-table" className="table-input" placeholder="Enter Table Number (required)"
              aria-label="Table number" value={lockedTable || tableNumber}
              maxLength={4} disabled={!!lockedTable} readOnly={!!lockedTable}
              // Keep only digits so letters/symbols can never reach the field.
              onChange={(e) => setTableNumber(e.target.value.replace(/\D/g, ""))}
            />

            {/* The bill summary: subtotal, tax, and grand total. */}
            <div className="bill-rows">
              <div className="bill-line"><span>Subtotal</span><span>{showPrice(subtotal)}</span></div>
              <div className="bill-line"><span>Tax (5%)</span><span>{showPrice(tax)}</span></div>
              <div className="bill-line grand"><span>Total</span><span>{showPrice(total)}</span></div>
            </div>

            {/* The Place Order button. Disabled while an order is being sent. */}
            <button className="btn btn-gold" onClick={placeOrder} disabled={placing}>
              <i className="fas fa-circle-check"></i> {placing ? "Placing…" : "Place Order"}
            </button>
          </>
        )}
        </>
        )}
      </div>
    </>
  );
}
