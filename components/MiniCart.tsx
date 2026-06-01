"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format";

// A sticky bottom pill on phones: "🛍 N items · ₹X · View bill". Tapping opens
// the cart. Hidden when the cart is empty, when the cart panel is open, and on
// the 3D viewer (which has its own bottom bar). Desktop hides it via CSS.
export default function MiniCart() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [subtotal, setSubtotal] = useState(0);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const sync = () => {
    try {
      const raw = localStorage.getItem("lfh_cart");
      const arr = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(arr) ? arr : [];
      setCount(list.reduce((s, it) => s + (it.qty || 1), 0));
      setSubtotal(list.reduce((s, it) => s + (parseFloat(it.price) || 0) * (it.qty || 1), 0));
    } catch {
      setCount(0);
      setSubtotal(0);
    }
  };

  useEffect(() => {
    sync();
    setCurrency(getCurrency());
    const onCart = () => sync();
    const onCur = () => setCurrency(getCurrency());
    const onOpen = () => setCartOpen(true);
    const onClose = () => setCartOpen(false);
    window.addEventListener("lfh:cart-updated", onCart);
    window.addEventListener("lfh:currency-changed", onCur);
    window.addEventListener("lfh:open-cart", onOpen);
    window.addEventListener("lfh:close-all", onClose);
    return () => {
      window.removeEventListener("lfh:cart-updated", onCart);
      window.removeEventListener("lfh:currency-changed", onCur);
      window.removeEventListener("lfh:open-cart", onOpen);
      window.removeEventListener("lfh:close-all", onClose);
    };
  }, []);

  if (count === 0 || cartOpen) return null;
  if (pathname && pathname.startsWith("/view")) return null;

  const price = currency ? formatPrice(subtotal, currency) : `$${subtotal.toFixed(2)}`;
  return (
    <button
      type="button"
      className="mini-cart"
      onClick={() => window.dispatchEvent(new Event("lfh:open-cart"))}
      aria-label={`View bill — ${count} items, ${price}`}
    >
      <span className="mini-cart-left">
        <i className="fas fa-bag-shopping" aria-hidden="true"></i>
        {count} item{count !== 1 ? "s" : ""}
      </span>
      <span className="mini-cart-price">{price}</span>
      <span className="mini-cart-cta">
        View bill <i className="fas fa-arrow-right" aria-hidden="true"></i>
      </span>
    </button>
  );
}
