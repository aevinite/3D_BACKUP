// Runs in the browser so it can react to taps and read the saved cart.
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { prettyUsd, toDisplay, formatAmount, getCurrency, type CurrencyMeta } from "@/lib/format";

// A sticky bottom pill on phones: "🛍 N items · ₹X · View bill". Tapping opens
// the cart. Hidden when the cart is empty, when the cart panel is open, and on
// the 3D viewer (which has its own bottom bar). Desktop hides it via CSS.
export default function MiniCart() {
  // The current page address (e.g. "/menu") — we use it to hide this pill on the 3D page.
  const pathname = usePathname();
  // These four "useState" lines are the pill's little memory boxes. Each holds a
  // value, and changing it re-draws the pill automatically.
  const [count, setCount] = useState(0); // how many items are in the cart
  // Each line's confident USD unit price + quantity. We keep the LINES (not a
  // pre-summed total) because the subtotal must be summed in the guest's
  // display currency — each line converted+snapped first — to match the bill.
  const [lines, setLines] = useState<{ usd: number; qty: number }[]>([]);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null); // which currency to show (₹, $, etc.)
  const [cartOpen, setCartOpen] = useState(false); // is the full cart panel currently open?

  // sync(): read the saved cart from the browser's storage and recount it.
  const sync = () => {
    try {
      // localStorage is the browser's little notepad that survives page reloads.
      // "lfh_cart" is where the whole cart is saved as text.
      const raw = localStorage.getItem("lfh_cart");
      const arr = raw ? JSON.parse(raw) : []; // turn the saved text back into a list
      const list = Array.isArray(arr) ? arr : [];
      // Add up the quantities of every line to get the total item count.
      setCount(list.reduce((s, it) => s + (it.qty || 1), 0));
      // Remember each line's USD unit price + qty; the display subtotal is
      // computed at draw time in the guest's currency.
      setLines(list.map((it: { price: string; qty?: number }) => ({ usd: prettyUsd(it.price), qty: it.qty || 1 })));
    } catch {
      // If the saved data is broken somehow, just show an empty cart.
      setCount(0);
      setLines([]);
    }
  };

  // useEffect runs once when the pill first appears. It's where we start
  // "listening" for app-wide messages and clean up when the pill goes away.
  useEffect(() => {
    sync(); // count the cart right away
    setCurrency(getCurrency()); // load the currency the guest picked
    // Small helpers that react to each kind of broadcast message:
    const onCart = () => sync(); // cart changed -> recount
    const onCur = () => setCurrency(getCurrency()); // currency changed -> refresh
    const onOpen = () => setCartOpen(true); // full cart opened -> hide this pill
    const onClose = () => setCartOpen(false); // everything closed -> show pill again
    // Start listening for those broadcast messages from elsewhere in the app.
    window.addEventListener("lfh:cart-updated", onCart);
    window.addEventListener("lfh:currency-changed", onCur);
    window.addEventListener("lfh:open-cart", onOpen);
    window.addEventListener("lfh:close-all", onClose);
    // The returned function runs when the pill is removed — it stops listening so
    // we don't leak old listeners. Always pair add/removeEventListener like this.
    return () => {
      window.removeEventListener("lfh:cart-updated", onCart);
      window.removeEventListener("lfh:currency-changed", onCur);
      window.removeEventListener("lfh:open-cart", onOpen);
      window.removeEventListener("lfh:close-all", onClose);
    };
  }, []);

  // Don't show the pill if the cart is empty or the full cart panel is already open.
  if (count === 0 || cartOpen) return null;
  // Also hide it on the 3D viewer page, which has its own bottom bar.
  if (pathname && pathname.startsWith("/view")) return null;

  // Sum the lines in the DISPLAY currency (each converted + snapped first),
  // then format — this matches the bill's subtotal to the rupee.
  const dispSubtotal = lines.reduce((s, l) => s + toDisplay(l.usd, currency || undefined) * l.qty, 0);
  const price = currency ? formatAmount(dispSubtotal, currency) : `$${dispSubtotal.toFixed(2)}`;
  return (
    // The whole pill is one big button. Tapping it broadcasts "lfh:open-cart",
    // which the cart panel hears and opens itself.
    <button
      type="button"
      className="mini-cart"
      onClick={() => window.dispatchEvent(new Event("lfh:open-cart"))}
      aria-label={`View bill — ${count} item${count !== 1 ? "s" : ""}, ${price}`}
    >
      {/* Left side: the shopping-bag icon and the item count. */}
      <span className="mini-cart-left">
        <i className="fas fa-bag-shopping" aria-hidden="true"></i>
        {/* Show "1 item" vs "3 items" — add the "s" only when it's not exactly 1. */}
        {count} item{count !== 1 ? "s" : ""}
      </span>
      {/* Middle: the formatted price. */}
      <span className="mini-cart-price">{price}</span>
      {/* Right side: the "View bill" call-to-action with an arrow. */}
      <span className="mini-cart-cta">
        View bill <i className="fas fa-arrow-right" aria-hidden="true"></i>
      </span>
    </button>
  );
}
