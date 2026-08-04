// Runs in the browser so it can read/save the cart and react to taps.
"use client";

import { useEffect, useRef, useState } from "react";
import { prettyUsd, toMinor, unitDisplay, formatAmount, getCurrency, type CurrencyMeta } from "@/lib/format";
import { getSettings, createOrder, isServerBusy, updateOrderTableNumber, type MenuItem } from "@/lib/menu";
import { enqueueGuestOrder } from "@/lib/guestOutbox"; // offline: save order, send on reconnect
import { useRestaurantId } from "@/lib/restaurant-context";
import { ALLERGENS, allergenIcon, allergenLabel } from "@/lib/allergens";
// Per-restaurant feature switches: the allergy section can be turned off.
import { useFeatures } from "@/lib/features";
import { validateTable, flagTableInput, getScannedTable } from "@/lib/table";
import { getStoredSession } from "@/lib/session";
import { tget, tset, isTKey, tenantSlug } from "@/lib/tenantStorage";
import { gateAddToCart } from "@/lib/tableConnection"; // "must be at a table to order" gate
import { useBackClose } from "@/lib/backStack"; // phone back button closes the panel
import SessionTableBill from "@/components/SessionTableBill";
import {
  STEPS,
  STATUS_COPY,
  type ActiveOrder,
  readActiveOrders,
  writeActiveOrders,
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

// NOTE: the per-device "Previous orders / past bills" history (with the star-rating
// feedback row) was removed (owner, 2026-06-17). The cart's second tab is now a
// LIVE-STATUS tab only — see the live bill (SessionTableBill) + live-orders strip.

// Tax rate is per-restaurant (see lib/tax.ts) — loaded into `taxRate` state from
// getSettings so the guest is quoted the SAME GST the bill actually charges (this
// was hardcoded 5%, which under-quoted any restaurant on a different rate).

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
      // Clamp to a whole 1..99 so corrupt/legacy saved data (fractions, huge counts)
      // can never quote more than the server will ever make (it caps each line at 99).
      qty: Math.min(99, Math.max(1, Math.floor(typeof it.qty === "number" && it.qty > 0 ? it.qty : 1))),
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
  const restaurantId = useRestaurantId();
  const features = useFeatures(restaurantId); // which restaurant features are switched on
  // Each useState below is a memory box; changing it re-draws the panel:
  const [open, setOpen] = useState(false); // is the panel slid open?
  const [cart, setCart] = useState<CartItem[]>([]); // the current cart lines
  const [tableNumber, setTableNumber] = useState(""); // table number the guest typed
  const [scannedTable, setScannedTableState] = useState(""); // table from a QR deep-link, if any
  const [lockedTable, setLockedTable] = useState<string | null>(null); // when in a session you can ONLY order for that table
  const [tableCount, setTableCount] = useState(0); // how many tables exist; 0 = no limit known
  const [sessionsEnabled, setSessionsEnabled] = useState(false); // v2 dining-session system
  const [taxRate, setTaxRate] = useState(0.05); // this restaurant's effective tax rate (decimal); 5% until settings load
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null); // currency for all prices
  const [allergenMap, setAllergenMap] = useState<Record<string, string[]>>({}); // dish id -> its allergens, for warnings
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]); // the full menu (for pairings/editing)
  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>([]); // orders still in progress
  const [showHistory, setShowHistory] = useState(false); // which tab: false=current bill, true=previous orders
  const [editingTable, setEditingTable] = useState<string | null>(null); // order id whose table is being corrected
  const [tableDraft, setTableDraft] = useState(""); // the corrected table number being typed
  const [savingTable, setSavingTable] = useState(false); // true while that correction is in flight
  // Previous orders are now grouped by date (Today / Yesterday / Earlier) and each
  // bill collapses long item lists itself, so the old list-level "view 2 more"
  // toggle is gone — the partitioning keeps the tab tidy.
  const [declared, setDeclared] = useState<string[]>([]); // allergens the diner avoids
  const [otherAllergy, setOtherAllergy] = useState(""); // free-text allergy not in the list
  const [otherOpen, setOtherOpen] = useState(false); // reveal the free-text field
  const [placing, setPlacing] = useState(false); // true while an order is being sent, to block double taps
  const placingRef = useRef(false); // synchronous lock so a fast double-tap can't fire two orders before React disables the button
  // A STABLE at-most-once key for the current cart. Generated once per distinct
  // cart+table, reused if the guest retries after a failed/lost send (so the server
  // dedups and never double-charges), and regenerated the moment the cart changes.
  const orderKeyRef = useRef<{ sig: string; id: string } | null>(null);
  const declaredHydrated = useRef(false); // skip the first persist so restore can't be clobbered
  const menuLoadedRef = useRef(false); // fetch the full menu (pairings/edit/allergens) only ONCE, on first open

  // Phone back button closes the bill instead of leaving the site. When editing a
  // line (which opens the customize popup ON TOP), back closes the popup first,
  // then this bill, then reaches the menu — exactly the owner's expected flow.
  useBackClose("cart", open, () => setOpen(false));

  // loadCart(): read the saved cart from localStorage and clean it up.
  const loadCart = () => {
    try {
      const saved = tget("lfh_cart");
      setCart(saved ? normalize(JSON.parse(saved)) : []);
    } catch {
      setCart([]);
    }
  };
  // saveCart(): write the cart back to the browser's notepad (localStorage).
  const saveCart = (newCart: CartItem[]) => {
    tset("lfh_cart", JSON.stringify(newCart));
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
  // increment(): the "+" button. Add one to the quantity, capped at 99 to match
  // the server's per-line LEAST(99, …) clamp — otherwise the cart quoted (and the
  // guest expected) more than the kitchen would ever receive (audit fix 2026-07-06).
  const increment = (idx: number) => {
    if (cart[idx].qty >= 99) return; // already at the max the server accepts
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
  // pruneCartToMenu(): drop saved lines whose dish has left the guest menu — taken off it, or
  // switched to "staff type the price" (open price), which the server refuses outright. Without
  // this the WHOLE order is rejected on Send and the guest has no way to tell which line is at
  // fault. Reads localStorage rather than the `cart` state so the async menu fetch can't act on
  // a stale closure, only ever runs on a NON-EMPTY menu (a bad payload can't wipe a real cart),
  // and it says what it removed instead of doing it silently.
  const pruneCartToMenu = (items: MenuItem[]) => {
    const live = new Set(items.map((i) => i.id));
    let saved: CartItem[];
    try { saved = normalize(JSON.parse(tget("lfh_cart") || "[]")); } catch { return; }
    const kept = saved.filter((l) => live.has(l.id));
    if (kept.length === saved.length) return; // nothing stale — the common case
    const gone = saved.filter((l) => !live.has(l.id)).map((l) => l.title).filter(Boolean);
    commit(kept);
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
      message: gone.length === 1 ? `${gone[0]} is no longer available` : `${gone.length} items are no longer available`,
      subtitle: "removed from your order — please ask a member of staff",
      kicker: "menu", variant: "error",
    } }));
  };

  // The big setup effect: runs once when the panel mounts. It loads everything
  // and wires up all the "listen for app messages" handlers.
  useEffect(() => {
    loadCart();
    setCurrencyState(getCurrency());
    // The full menu (allergen lookup by dish id, "goes well with" pairings, and
    // editing a line) is only needed once the cart is OPEN — the panel renders
    // nothing while closed. So we DON'T read it on mount: that fired a full
    // `menu_items` read on every guest page load, duplicating the menu the page
    // already loaded from its cached endpoint (egress waste, seen 2026-07-06).
    // loadMenuOnce() fetches it lazily on the first open, THIS restaurant's menu.
    const loadMenuOnce = () => {
      if (menuLoadedRef.current) return;
      menuLoadedRef.current = true;
      // Reuse the SAME server-cached bundle the menu page already loaded
      // (/api/r/<slug>/menu-data) instead of a fresh Supabase `select *` on every
      // cart open — zero extra DB egress, and only the columns we need (audit
      // cost tidy-up). Falls back to letting a later open retry on failure.
      fetch(`/api/r/${tenantSlug()}/menu-data`, { cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("menu-data " + r.status); return r.json(); })
        .then((bundle: { items?: MenuItem[] }) => {
          const items = Array.isArray(bundle.items) ? bundle.items : [];
          const m: Record<string, string[]> = {};
          items.forEach((i) => (m[i.id] = i.allergens || []));
          setAllergenMap(m);
          setMenuItems(items);
          if (items.length) pruneCartToMenu(items); // drop lines the menu no longer offers
        })
        .catch(() => { menuLoadedRef.current = false; }); // let a later open retry
    };
    // How many tables exist, so we can reject an out-of-range table number.
    getSettings(restaurantId)
      .then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); setTaxRate(s.taxRate); })
      .catch(() => {});

    // Live orders are written/polled by OrderTracker; we just read them here.
    const loadLive = () => setLiveOrders(liveActiveOrders(readActiveOrders()));
    loadLive();
    // Restore order-wide allergy avoidances (set via "apply to all" or the bill section).
    // ONLY when this restaurant still has the allergy feature on: with it off the whole
    // section is hidden, so a list saved on a previous visit would keep riding along on
    // every order with no way for the guest to see or clear it (guest sweep 2026-08-04).
    try {
      if (features.allergies) {
        const d = JSON.parse(tget("lfh_declared") || "[]");
        if (Array.isArray(d) && d.length) setDeclared(d);
      } else {
        setDeclared([]);
      }
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
      setOpen(true); loadMenuOnce(); loadCart(); loadLive(); setShowHistory(false); prefillScanned(); syncSession();
      // re-read settings on open so a freshly-toggled sessions mode is always respected
      getSettings(restaurantId).then((s) => { setTableCount(s.tableCount); setSessionsEnabled(s.sessionsEnabled); setTaxRate(s.taxRate); }).catch(() => {});
    };
    // handleShowPrev: open straight to the LIVE-STATUS tab (the live table view
    // with the served-progress bar). Fired when the multi-order tracker is tapped.
    const handleShowPrev = () => { setOpen(true); loadMenuOnce(); setShowHistory(true); loadLive(); };
    const handleClose = () => setOpen(false); // "lfh:close-all" -> slide shut
    const handleScanned = prefillScanned; // a QR table scan arrived -> pre-fill table
    const handleCartUpdated = loadCart; // cart changed elsewhere -> re-read it
    const handleCurrency = () => setCurrencyState(getCurrency()); // currency switched -> refresh
    // Re-read live orders whenever one is placed or its status changes.
    const handleOrdersChanged = () => { loadLive(); };
    // TWO-TABS bridge: "lfh:cart-updated" is a same-tab announcement only, so a
    // cart change made in ANOTHER tab never reached this one — its badge and
    // open cart panel showed stale items. The browser's "storage" event DOES
    // cross tabs, so translate a cross-tab lfh_cart change into the local
    // announcement every cart listener already understands.
    const handleStorageCart = (e: StorageEvent) => {
      if (isTKey(e.key, "lfh_cart")) window.dispatchEvent(new Event("lfh:cart-updated"));
    };
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
    window.addEventListener("storage", handleStorageCart);   // cross-tab cart changes
    // Cleanup: stop listening when the panel unmounts so we don't leak listeners.
    return () => {
      window.removeEventListener("storage", handleStorageCart);
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
    // restaurantId in deps: the global widgets resolve their restaurant async (starts at
    // #1, then fixes itself). Re-run so tableCount/sessionsEnabled (and the menu) reflect
    // the REAL restaurant once its id lands — else a non-#1 guest saw #1's table count,
    // wrongly rejecting a valid table number as "doesn't exist". Cleanup drops old
    // listeners, so re-running never double-subscribes.
    // features.allergies too: the switches also resolve a beat after the defaults, and the
    // allergy restore above must act on the REAL value, not the default "on".
  }, [restaurantId, features.allergies]);

  // Persist the order-wide allergy avoidances. Skip the very first run: on mount
  // `declared` is still the empty default while the restore (above) is being
  // applied, so writing here would overwrite the saved list with [].
  useEffect(() => {
    if (!declaredHydrated.current) { declaredHydrated.current = true; return; }
    tset("lfh_declared", JSON.stringify(declared));
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

  // Scroll hand-off between the two scrollbars on the Current-bill tab.
  // The inner items list (.cart-list) has its own scrollbar; the whole panel
  // (.cart-panel) has another. We WANT two scrollbars, but once the inner list
  // reaches its top/bottom the scroll should continue the outer panel (down to
  // the total + Place Order). CSS overscroll-behavior:auto alone doesn't do this
  // reliably because Chrome "latches" the wheel to the inner element at its edge,
  // which feels like the bill dead-stops. So when the list is already at its
  // boundary in the wheel's direction, we forward the leftover delta to the panel
  // ourselves. (Touch already chains fine; this is the wheel/trackpad fix.)
  useEffect(() => {
    if (!open || showHistory) return; // only the Current-bill list needs this
    const list = document.getElementById("cart-list");
    const panel = document.getElementById("cart-panel");
    if (!list || !panel) return;
    const onWheel = (e: WheelEvent) => {
      const goingDown = e.deltaY > 0;
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      const atTop = list.scrollTop <= 0;
      // Only take over once the inner list can't scroll further this way.
      if ((goingDown && atBottom) || (!goingDown && atTop)) {
        // Normalise wheel units (0=pixels, 1=lines, 2=pages) before passing on.
        const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? panel.clientHeight : 1;
        panel.scrollTop += e.deltaY * factor;
        e.preventDefault();
      }
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, [open, showHistory]);

  // showPrice(): format a stored USD ORDER TOTAL in the chosen currency.
  // Minor-unit rounding only (whole ₹ / cents) — order records hold the
  // authoritative server-style totals, never ₹10-snapped. Matches the tracker
  // and SessionTableBill so the same order reads identically everywhere.
  const showPrice = (n: number) => (currency ? formatAmount(toMinor(n * currency.rate, currency), currency) : `$${n.toFixed(2)}`);
  // fmtDisp(): format a number that is ALREADY in the display currency
  // (no conversion — just symbol + separators).
  const fmtDisp = (n: number) => (currency ? formatAmount(n, currency) : `$${n.toFixed(2)}`);
  // One cart line's value in the guest's DISPLAY currency. The stored price is
  // ALREADY the final USD unit (pretty base + add-ons — both the quick "+" and
  // the customize popup write it that way), so no prettyUsd here: re-prettying
  // 6.50+1.25=7.75 would bump it to 7.99 (the popup-vs-bill mismatch).
  // unitDisplay snaps the base part and minor-rounds the add-ons, matching the
  // popup chip by chip; then × qty, so lines sum to exactly what's printed.
  const lineDisp = (it: CartItem) =>
    unitDisplay(parseFloat(it.price), (it.options || []).map((o) => o.price || 0), currency || undefined) * it.qty;
  // Red dot on the Live-status tab: a live order whose floating strip was hidden.
  const hiddenLive = liveOrders.some((o) => o.stripHidden && !isFinalStatus(o.status));
  // Bill math — in the guest's DISPLAY currency, not USD, so the printed
  // lines visibly add up: subtotal = sum of the printed line values.
  const subtotal = cart.reduce((sum, it) => sum + lineDisp(it), 0);
  const itemCount = cart.reduce((sum, it) => sum + it.qty, 0); // total number of items
  // Tax at this restaurant's rate, rounded to the currency's minor unit (whole ₹ /
  // cents) so it doesn't jump in ₹10 hops like the menu prices do.
  const tax = toMinor(subtotal * taxRate, currency || undefined);
  const total = subtotal + tax; // what the guest pays (display currency, for the BILL UI only)
  // ORDER RECORDS are stored in USD — the tracker, history list and the
  // session pull (which saves the server's USD totals) all share one storage,
  // and they convert at render time. Storing the display number here once put
  // ₹578 through a ×84 conversion and showed ₹48,550. One domain only.
  const subtotalUsd = cart.reduce((sum, it) => sum + parseFloat(it.price) * it.qty, 0);
  const totalUsd = Math.round(subtotalUsd * (1 + taxRate) * 100) / 100;

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
  // canEdit(): show the "Edit" button on EVERY dish still in the menu (owner,
  // 2026-07-05). Even a plain dish with no options/allergens can be customized —
  // the popup always lets the guest flag a per-dish allergy and add a kitchen
  // note. We only hide Edit if the dish is gone from the menu (nothing to open).
  const canEdit = (id: string) => !!menuItems.find((m) => m.id === id);

  // Which cart lines have gone sold-out (best-effort, from the menu we loaded on
  // open). Used to flag lines in the bill and to block placing with a CLEAR reason
  // instead of the old generic "try again" dead-end (audit fix 2026-07-06). The
  // server re-checks authoritatively, so a stale view here is only a UI hint.
  const soldOutIds = new Set(menuItems.filter((m) => (m.tags || []).includes("sold-out")).map((m) => m.id));
  const isSoldOut = (id: string) => soldOutIds.has(id);

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
    // Same table gate as every other Add: not connected -> join first, then add.
    gateAddToCart(() => {
      const next = [...cart];
      const idx = next.findIndex((c) => c.id === it.id);
      if (idx >= 0) next[idx] = { ...next[idx], qty: Math.min(99, next[idx].qty + 1) }; // 99 cap, same as every add path (bug #6)
      // Stored price is the CONFIDENT unit (prettyUsd) — the same convention as
      // the quick "+" and the customize popup, so the bill never re-rounds it.
      // sig "[]" marks it as a plain line so the menu card's +/- can manage it.
      else next.push({ id: it.id, title: it.title, price: prettyUsd(it.price).toFixed(2), image: it.image, qty: 1, sig: "[]" });
      commit(next);
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${it.title} added`, kicker: "your order" } }));
    });
  };

  // saveOrderTable(): send a corrected table number for ONE already-placed order.
  // The same validation the Place Order button uses, so a guest can't move their food to
  // a table that doesn't exist. A refusal is always SAID — never a silent no-op.
  const saveOrderTable = async (o: ActiveOrder) => {
    if (savingTable) return; // in flight — ignore the second tap
    const check = validateTable(tableDraft, tableCount);
    if (!check.ok) {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: check.message, kicker: "table", variant: "error" } }));
      return;
    }
    if (check.value === (o.tableNumber || "").trim()) { setEditingTable(null); return; } // nothing to change
    setSavingTable(true);
    const ok = await updateOrderTableNumber(o.id, check.value).catch(() => false);
    setSavingTable(false);
    if (!ok) {
      // The server refuses once an order is no longer open — say the true reason.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Couldn't move that order", subtitle: "it may already be served — please ask a member of staff", kicker: "table", variant: "error" } }));
      return;
    }
    // Update this device's copy so the strip + this list agree with the kitchen at once.
    const list = readActiveOrders().map((x) => (x.id === o.id ? { ...x, tableNumber: check.value } : x));
    writeActiveOrders(list);
    setLiveOrders(liveActiveOrders(list));
    setEditingTable(null);
    window.dispatchEvent(new Event("lfh:orders-updated"));
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `Moved to table ${check.value}`, subtitle: "the kitchen has been told", kicker: "table", variant: "success" } }));
  };

  // orderItems(): the item lines as they travel to the server, honouring the switches.
  // A line SAVED earlier keeps whatever it was saved with, so a note or a removed allergen
  // can outlive the switch that allowed it — and the guest can't see or clear it, because the
  // input is gone. Gating only where the popup SAVES a line wasn't enough (proven by driving
  // it: a seeded line still sent its note). This is the last gate before the wire.
  const orderItems = () =>
    cart.map((it) => ({
      id: it.id,
      qty: it.qty,
      options: it.options?.map((o) => ({ group: o.group, label: o.label })),
      removed: features.allergies ? it.removed : undefined,
      note: features.guest_note ? it.note : undefined,
    }));

  // allergyPayload(): what actually travels with the order, honouring the switches.
  // With allergies OFF the section is hidden, so anything still in state is stale and must
  // NOT be sent; the free-text half only travels while its own switch is on. Before this
  // there were three separate inline copies of this list and none of them checked either
  // switch (guest sweep 2026-08-04).
  const allergyPayload = (): string[] => {
    if (!features.allergies) return [];
    const other = features.allergy_other ? otherAllergy.trim() : "";
    return [...declared, ...(other ? [other] : [])];
  };

  // placeOrder(): the big "Place Order" button. Validates the table number, then
  // either routes through the v2 dining-session flow or sends the order directly.
  const placeOrder = async () => {
    if (cart.length === 0 || placing || placingRef.current) return; // nothing to send, or already sending (sync + state)
    // Table number is required AND must be a real table (see lib/table.ts).
    const check = validateTable(tableNumber, tableCount);
    if (!check.ok) {
      // Bad/empty/out-of-range table -> highlight the field with the reason and stop.
      flagTableInput("cart-table", check.message!);
      return;
    }
    const tableTrim = check.value; // the cleaned-up table number

    // Sold-out guard (covers BOTH the session and non-session paths below): if a
    // dish on the bill went sold-out, tell the guest EXACTLY which one to remove
    // instead of the old generic "try again" that repeated forever (bug fix). The
    // server also rejects it, so this is a friendlier front line, not the only one.
    const soldLines = cart.filter((it) => isSoldOut(it.id));
    if (soldLines.length) {
      const names = [...new Set(soldLines.map((it) => it.title))].join(", ");
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `Sold out: ${names}`, subtitle: "please remove it to place your order", kicker: "order", variant: "error" } }));
      return;
    }

    // v2: when the dining-session system is ON, route the order through the
    // SessionGate (location -> join -> OTP -> the server places it). On success
    // we still record it locally so the existing tracker follows its status.
    if (sessionsEnabled) {
      placingRef.current = true;
      setPlacing(true);
      // Bundle up everything the session flow will need, captured now (before we
      // clear the cart), so it's all still here when the gate finishes.
      const allergiesS = allergyPayload();
      // What we send the server: id + qty + chosen options (group/label only) +
      // removed allergens + note. NO prices and NO title — the server looks those
      // up from menu_items and prices the bill itself, so nothing here is trusted.
      const itemsS = orderItems();
      const trackS = cart.map((it) => ({ title: it.title, qty: it.qty })); // slim list for the tracker
      const totalS = totalUsd, countS = itemCount; // USD — order records convert at render
      // onDone: runs once the SessionGate finishes (after location/join/OTP). If the
      // server actually placed the order, we record it locally so the tracker follows it.
      const onDone = (e: Event) => {
        const d = (e as CustomEvent).detail as { ok?: boolean; action?: string; orderId?: string; queued?: boolean };
        // Only react to OUR order's result. Other gate completions (e.g. the
        // Add-to-cart "connect" flow) also fire lfh:session-done — ignore those
        // WITHOUT deregistering, so a gated add mid-placement can't steal our listener.
        if (d?.action !== "order") return;
        window.removeEventListener("lfh:session-done", onDone);
        placingRef.current = false;
        setPlacing(false);
        if (d?.queued) {
          // Saved OFFLINE: the gate already toasted "will send when back online". The
          // guest outbox records the order into the tracker once it actually sends,
          // so we DON'T record a local entry now — just clear the cart and close.
          setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
          window.dispatchEvent(new Event("lfh:cart-updated"));
          window.dispatchEvent(new Event("lfh:close-all"));
          return;
        }
        if (!d?.ok || !d.orderId) return; // order cancelled / failed — the gate showed its own message
        try {
          // Save into the "active orders" list so the OrderTracker shows it.
          const raw = tget("lfh_active_orders");
          const arr = (() => { const p = raw ? JSON.parse(raw) : []; return Array.isArray(p) ? p : []; })();
          arr.push({ id: d.orderId, tableNumber: tableTrim, total: totalS, itemCount: countS, items: trackS, status: "received", placedAt: Date.now() });
          tset("lfh_active_orders", JSON.stringify(arr));
          window.dispatchEvent(new Event("lfh:order-placed")); // wake the tracker
        } catch {}
        // Empty the cart and reset the allergy fields, then refresh + close.
        setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
        window.dispatchEvent(new Event("lfh:cart-updated"));
        window.dispatchEvent(new Event("lfh:close-all"));
      };
      // Listen for the gate's result, then kick off the session flow.
      window.addEventListener("lfh:session-done", onDone);
      window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "order", table: tableTrim, payload: { items: itemsS, allergies: allergiesS, track: { tableNumber: tableTrim, total: totalS, itemCount: countS, items: trackS } } } }));
      return; // the rest below is the non-session path
    }

    // ── Non-session path: send the order straight to the kitchen. ──
    placingRef.current = true;
    setPlacing(true);
    try {
      const allergies = allergyPayload();
      // Send ONLY id + qty + options (group/label) + removed + note — no prices.
      // The server prices and stores the order, then hands back its id to track.
      const itemsS = orderItems();
      // Stable at-most-once key for this cart+table, shared by BOTH the online and the
      // offline paths. Computed BEFORE the offline branch on purpose: an online attempt
      // that committed but lost its reply, then retried after the phone dropped offline,
      // now replays under the SAME id instead of a fresh one — so the server places it
      // ONCE, never twice (audit fix 2026-07-08). Any edit to the cart makes a new key —
      // INCLUDING the allergy list, which was missing from the key, so adding "no peanuts" and
      // trying again re-used the previous attempt's identity.
      const sig = JSON.stringify({ t: tableTrim, i: itemsS, a: allergies });
      if (!orderKeyRef.current || orderKeyRef.current.sig !== sig) {
        const rid = (globalThis.crypto?.randomUUID?.() as string) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        orderKeyRef.current = { sig, id: rid };
      }
      // OFFLINE: save the order on-device and send it automatically on reconnect
      // (at-most-once via the guest outbox, using the SAME key as the online path).
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const q = await enqueueGuestOrder({ mode: "public", table: tableTrim, restaurantId, restaurantSlug: tenantSlug(), items: itemsS, allergies, track: { tableNumber: tableTrim, total: totalUsd, itemCount, items: cart.map((it) => ({ title: it.title, qty: it.qty })) }, actionId: orderKeyRef.current.id });
        // ONLY promise durability when the phone actually stored it. When storage refuses
        // (private browsing, no room), the order is real and WILL send — but it lives in memory
        // only, so closing the tab loses it, and saying "we'll send it automatically" would be a
        // promise this page can't keep.
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: q.persisted
          ? { message: "Saved — will send when you're back online", subtitle: "we'll send it automatically", kicker: "offline", icon: "📴", variant: "success" }
          : { message: "Saved — keep this page open", subtitle: "it sends the moment you're back online", kicker: "offline", icon: "📴", variant: "success" } }));
        orderKeyRef.current = null; // a fresh order next time
        setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
        window.dispatchEvent(new Event("lfh:cart-updated"));
        window.dispatchEvent(new Event("lfh:close-all"));
        return;
      }
      const orderId = await createOrder({
        tableNumber: tableTrim,
        items: itemsS,
        allergies,
      }, restaurantId, orderKeyRef.current.id);
      orderKeyRef.current = null; // placed OK → next tap is a new order
      // Remember this order on THIS device so the guest can follow its status.
      try {
        const raw = tget("lfh_active_orders");
        const list = raw ? JSON.parse(raw) : [];
        const active = Array.isArray(list) ? list : [];
        active.push({ // add this order to the live-tracking list
          id: orderId,
          tableNumber: tableTrim,
          total: totalUsd, // USD — converted at render time like all order records
          itemCount,
          items: cart.map((it) => ({ title: it.title, qty: it.qty })),
          status: "received",
          placedAt: Date.now(),
        });
        tset("lfh_active_orders", JSON.stringify(active));
        window.dispatchEvent(new Event("lfh:order-placed")); // wake the tracker
      } catch {}
      // Pop a success toast confirming the order went to the kitchen.
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: "Order placed",
        subtitle: tableTrim ? `table ${tableTrim} · sent to kitchen` : "sent to kitchen",
        kicker: "to the kitchen",
        icon: "🧾",
        variant: "success",
        // Tapping it opens the LIVE STATUS tab (the order's progress), not the bill. (owner, 2026-06-22)
        event: "lfh:show-previous-orders",
      } }));
      // Empty the cart + reset the allergy fields, then refresh and close the panel.
      setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
      window.dispatchEvent(new Event("lfh:cart-updated"));
      window.dispatchEvent(new Event("lfh:close-all"));
    } catch (err) {
      // If the server rejected because a dish went sold-out (or is unknown) between
      // loading and placing, say WHICH dish rather than a generic "try again" — the
      // message carries "sold_out (Title)" from createOrder (audit fix 2026-07-06).
      const msg = String((err as Error)?.message || "");
      // THE RESTAURANT COULDN'T TAKE IT THIS SECOND (its system is swamped, or the reply never
      // came). That is not the diner's problem and not a refusal, so do exactly what being
      // offline does: keep the order on this device under the SAME at-most-once key and let the
      // outbox deliver it. This is what makes a rush look like a slow moment instead of a
      // broken menu — 800 orders in the same minute are all kept, then drained in order.
      if (isServerBusy(err) && orderKeyRef.current) {
        try {
          // Their `orderItems()` / `allergyPayload()` helpers (they replaced the inline builders
          // on main) + this branch's honest wording: only promise durability when the phone
          // actually stored it.
          const q = await enqueueGuestOrder({ mode: "public", table: tableTrim, restaurantId, restaurantSlug: tenantSlug(), items: orderItems(), allergies: allergyPayload(), track: { tableNumber: tableTrim, total: totalUsd, itemCount, items: cart.map((it) => ({ title: it.title, qty: it.qty })) }, actionId: orderKeyRef.current.id });
          window.dispatchEvent(new CustomEvent("lfh:toast", { detail: q.persisted
            ? { message: "Saved — sending your order now", subtitle: "the kitchen is very busy; it goes through by itself", kicker: "order", icon: "⏳", variant: "success" }
            : { message: "Saved — keep this page open", subtitle: "the kitchen is very busy; it goes through by itself", kicker: "order", icon: "⏳", variant: "success" } }));
          orderKeyRef.current = null;
          setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
          window.dispatchEvent(new Event("lfh:cart-updated"));
          window.dispatchEvent(new Event("lfh:close-all"));
          return;
        } catch {
          // Saving on the device failed too (storage blocked) → fall through to the honest error
          // below rather than pretending the order is safe somewhere.
        }
      }
      if (/sold_out/i.test(msg)) {
        const m = msg.match(/\(([^)]+)\)/); // the dish title in parentheses, if present
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: m ? `Sold out: ${m[1]}` : "A dish just sold out", subtitle: "please remove it to place your order", kicker: "order", variant: "error" } }));
      } else if (/staff_priced_item/i.test(msg)) {
        // mig 253: a dish in the cart is now priced by staff at order time. Say so plainly —
        // "please try again" would be a lie, because retrying fails the same way every time.
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "One dish needs a member of staff", subtitle: "its price is set when you order — please ask your server", kicker: "order", variant: "error" } }));
      } else {
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Order didn't go through", subtitle: "please try again", kicker: "order", variant: "error" } }));
      }
    } finally {
      placingRef.current = false;
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

        {/* The two tabs: "Current bill" and "Live status" (with a count + live dot). */}
        <div className="cart-tabs">
          <button type="button" className={!showHistory ? "active" : ""} onClick={() => setShowHistory(false)}>Current bill</button>
          <button type="button" className={showHistory ? "active" : ""} onClick={() => setShowHistory(true)}>
            Live status{liveOrders.length ? ` (${liveOrders.length})` : ""}
            {hiddenLive && <span className="tab-live-dot" aria-label="Live order in progress" />}
          </button>
        </div>

        {/* Show EITHER the live-status tab OR the current-bill tab, never both. */}
        {showHistory ? (
          /* ── LIVE-STATUS TAB ── */
          <div className="order-history">
            <SessionTableBill />
            {/* "Live now": the coarse order-level status strip. When dining-sessions
                are ON, SessionTableBill above already shows live per-DISH progress,
                so this duplicate is hidden — it only appears in plain (sessions-off)
                mode where there's no per-dish bill. */}
            {!sessionsEnabled && liveOrders.length > 0 && (
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
                      {/* WRONG TABLE? Only while the order is still early — once it's served
                          the kitchen has already sent it somewhere, so the number is locked
                          (same rule the old tracker sheet used).
                          This lives HERE because tapping the floating strip opens THIS tab
                          (owner, 2026-06-19). The control used to sit in the tracker's own
                          detail sheet, which that change made unreachable — so from then on a
                          guest who scanned the wrong table's sticker had no way to correct it
                          and their food went to someone else's table (guest sweep 2026-08-04). */}
                      {(o.status === "received" || o.status === "preparing") && (
                        editingTable === o.id ? (
                          <div className="live-order-fixtable">
                            <input
                              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4}
                              aria-label="Correct table number" autoFocus
                              value={tableDraft}
                              onChange={(e) => setTableDraft(e.target.value.replace(/\D/g, ""))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveOrderTable(o); }}
                            />
                            <button type="button" onClick={() => saveOrderTable(o)} disabled={savingTable}>
                              {savingTable ? "Saving…" : "Save"}
                            </button>
                            <button type="button" className="ghost" onClick={() => setEditingTable(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="live-order-fixlink"
                            onClick={() => { setEditingTable(o.id); setTableDraft(o.tableNumber || ""); }}
                          >
                            Wrong table? Fix it — the kitchen sees the change
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Friendly empty state when nothing is live. In sessions mode the
                SessionTableBill above shows the live bill (and its own empty), so
                this only fills the plain (sessions-off) no-live-orders case. */}
            {!sessionsEnabled && liveOrders.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", padding: "44px 16px", fontSize: 15 }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>🍽️</div>
                Nothing cooking right now.<br />Your live orders will show up here.
              </div>
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
                    <div className="cart-item-name">
                      {item.title}
                      {isSoldOut(item.id) && (
                        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#fca5a5", border: "1px solid rgba(252,165,165,0.5)", borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" }}>
                          Sold out
                        </span>
                      )}
                    </div>
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
                    {features.allergies && itemAllergens(item.id).length > 0 && (
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
                    {features.allergies && c.length > 0 && (
                      <div className="cart-item-warn">
                        <i className="fas fa-triangle-exclamation"></i> contains {c.map(allergenLabel).join(", ").toLowerCase()}
                      </div>
                    )}
                    {/* Quantity controls: − , the count, + , and an Edit button if customizable. */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                      <button type="button" aria-label={`Decrease ${item.title}`} onClick={() => decrement(idx)} style={qtyBtn}>−</button>
                      <span style={{ minWidth: "32px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "var(--text)" }}>{item.qty}x</span>
                      <button type="button" aria-label={`Increase ${item.title}`} onClick={() => increment(idx)} style={qtyBtn}>+</button>
                      {canEdit(item.id) && (
                        <button type="button" className="cart-edit-btn" onClick={() => editLine(item)}>
                          <i className="fas fa-pen"></i> Edit
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Right side of the line: this line's price (price × qty) and a trash button. */}
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div className="cart-item-price">{fmtDisp(lineDisp(item))}</div>
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
                    {/* This is a MENU price, so it gets the full menu treatment
                        (pretty USD + ₹10 snap) — matching the card exactly. */}
                    <div className="pairing-price">{fmtDisp(unitDisplay(prettyUsd(pairing.price), [], currency || undefined))}</div>
                  </div>
                  <button type="button" className="pairing-add" onClick={() => addPairing(pairing)}>
                    + Add
                  </button>
                </div>
              </div>
            )}

            {/* Order-wide allergy section: tap chips for things to avoid across
                the whole order. Gone when the allergy feature is switched off. */}
            {features.allergies && (
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
                {/* Custom (typed) allergens become their OWN chips — tap to remove. */}
                {declared.filter((s) => !ALLERGENS.some((a) => a.slug === s)).map((s) => (
                  <button
                    key={`custom-${s}`}
                    type="button"
                    className="allergy-toggle on"
                    aria-pressed={true}
                    onClick={() => toggleDeclared(s)}
                  >
                    🚫 {s}
                  </button>
                ))}
                {/* Free-text allergies are their own switch (Access → Menu → Allergy & notes
                    → "Guest can add their own allergy"). Off keeps every preset chip above and
                    removes only the typing. Conditional render, NOT the `hidden` attribute —
                    .allergy-toggle sets its own display, which would beat `hidden`. */}
                {features.allergy_other && (
                  <button
                    type="button"
                    className={`allergy-toggle ${otherOpen ? "on" : ""}`}
                    aria-pressed={otherOpen}
                    onClick={() => setOtherOpen((o) => !o)}
                  >
                    ✏️ Other
                  </button>
                )}
              </div>
              {/* Make the order-wide behaviour explicit: an allergen tapped here is
                  left out of EVERY dish in the order, not just one. (owner, 2026-06-16) */}
              <p className="allergy-note">
                <i className="fas fa-circle-info"></i> Anything you tap here is removed from <b>all the dishes</b> in this order.
              </p>
              {/* Free-text "other allergy" box, shown only when "Other" is toggled on. */}
              {otherOpen && features.allergy_other && (
                <input
                  type="text"
                  className="table-input"
                  style={{ marginTop: "10px", marginBottom: 0 }}
                  placeholder="Type an allergy, then press Enter…"
                  aria-label="Other allergy"
                  maxLength={80}
                  value={otherAllergy}
                  onChange={(e) => setOtherAllergy(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      // Add the typed allergen as its own removable chip in `declared`.
                      const v = otherAllergy.trim().toLowerCase().replace(/^no[\s-]+/, "");
                      if (v && !declared.includes(v)) setDeclared((d) => [...d, v]);
                      setOtherAllergy("");
                    }
                  }}
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
            )}

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
              <div className="bill-line"><span>Subtotal</span><span>{fmtDisp(subtotal)}</span></div>
              <div className="bill-line"><span>GST ({Math.round(taxRate * 10000) / 100}%)</span><span>{fmtDisp(tax)}</span></div>
              <div className="bill-line grand"><span>Total</span><span>{fmtDisp(total)}</span></div>
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
