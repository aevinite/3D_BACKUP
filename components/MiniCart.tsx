// Runs in the browser so it can react to taps and read the saved cart.
"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { unitDisplay, formatAmount, getCurrency, type CurrencyMeta } from "@/lib/format";
import { tget } from "@/lib/tenantStorage";

// A sticky bottom pill on phones: "🛍 N items · ₹X · View bill". Tapping opens
// the cart. Hidden when the cart is empty, when the cart panel is open, and on
// the 3D viewer (which has its own bottom bar). Desktop hides it via CSS.
export default function MiniCart() {
  // The current page address (e.g. "/menu") — we use it to hide this pill on the 3D page.
  const pathname = usePathname();
  // These four "useState" lines are the pill's little memory boxes. Each holds a
  // value, and changing it re-draws the pill automatically.
  const [count, setCount] = useState(0); // how many items are in the cart
  // Each line's USD unit price, its add-on prices, and quantity. We keep the
  // LINES (not a pre-summed total) because the subtotal must be summed in the
  // guest's display currency — each line converted+snapped first, add-ons
  // minor-rounded — exactly like the bill, so the two always match.
  const [lines, setLines] = useState<{ usd: number; addons: number[]; qty: number }[]>([]);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null); // which currency to show (₹, $, etc.)
  const [cartOpen, setCartOpen] = useState(false); // is the full cart panel currently open?

  // sync(): read the saved cart from the browser's storage and recount it.
  const sync = () => {
    try {
      // localStorage is the browser's little notepad that survives page reloads.
      // "lfh_cart" is where the whole cart is saved as text.
      const raw = tget("lfh_cart");
      const arr = raw ? JSON.parse(raw) : []; // turn the saved text back into a list
      const list = Array.isArray(arr) ? arr : [];
      // Add up the quantities of every line to get the total item count.
      setCount(list.reduce((s, it) => s + (it.qty || 1), 0));
      // Remember each line's USD unit price (already "pretty" — both add paths
      // store it that way), its add-on prices, and qty; the display subtotal
      // is computed at draw time in the guest's currency.
      setLines(list.map((it: { price: string; qty?: number; options?: { price?: number }[] }) => ({
        usd: parseFloat(it.price) || 0,
        addons: (it.options || []).map((o) => o.price || 0),
        qty: it.qty || 1,
      })));
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

  // Re-read on navigation: the cart is tenant-scoped (tget keys off the current
  // path's restaurant), so moving from /r/A to /r/B in the SAME tab must re-count
  // against B's cart — otherwise A's pill lingered over B (audit fix 2026-07-06).
  useEffect(() => { sync(); }, [pathname]);

  // Is the pill actually on screen? (cart has items, panel closed, not the 3D viewer
  // — the viewer has its own bottom bar.)
  const visible = count > 0 && !cartOpen && !(pathname && pathname.startsWith("/view"));

  // While the pill is up, mark <body> so the floating live-status strip
  // (OrderTracker) slides ABOVE it (see globals.css). Without this the strip —
  // same bottom-left spot, higher z-index — sat ON TOP of the pill, so after
  // placing an order and adding more dishes the "View bill" pill looked gone and
  // the only thing left to tap was the strip, which opens Live status instead of
  // the new bill. (owner bug report, 2026-07-22)
  useEffect(() => {
    if (visible) document.body.setAttribute("data-lfh-minicart", "1");
    else document.body.removeAttribute("data-lfh-minicart");
    return () => document.body.removeAttribute("data-lfh-minicart");
  }, [visible]);

  if (!visible) return null;

  // Sum the lines in the DISPLAY currency (each converted + snapped first,
  // add-ons minor-rounded) — this matches the bill's subtotal to the rupee.
  //
  // TAX MODES (mig 270): nothing here needs to change, and that is deliberate. This pill shows
  // the SUBTOTAL only — it never names a line, never says "MRP", and never claims to be the
  // amount payable — so a tax-inclusive or MRP line cannot be mislabelled by it. The three
  // behaviours only alter what is ADDED on top, which is the bill panel's job (CartPanel).
  // If this pill is ever changed to show a TOTAL, it must go through splitBill() in lib/tax.ts,
  // never subtotal × rate — that formula charges GST on a price that already contains it.
  const dispSubtotal = lines.reduce((s, l) => s + unitDisplay(l.usd, l.addons, currency || undefined) * l.qty, 0);
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
