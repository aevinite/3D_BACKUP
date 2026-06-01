"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format";
import type { OptionGroup } from "@/lib/menu";
import VegIcon from "./VegIcon";

interface FoodItem {
  id: string;
  slug: string;
  title: string;
  price: string;
  image: string;
  category: string;
  veg: boolean;
  is4d: boolean;
  modelFolder?: string;
  rating?: string;
  time?: string;
  tags?: string[];
  options?: OptionGroup[];
  allergens?: string[];
}

const CART_KEY = "lfh_cart";

interface CartItem { id: string; title: string; price: string; image: string; qty: number; sig?: string; }

// The menu card's "+" only ever adds/controls the PLAIN version of a dish
// (no options, no removed allergens, no note). The customize popup tags those
// lines with sig "[]"; quick-adds historically had no sig. Match either so the
// card never accidentally bumps a customized line that shares the same id.
const isPlainLine = (i: CartItem) => !i.sig || i.sig === "[]";

const readCart = (): CartItem[] => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

const writeCart = (cart: CartItem[]) => {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("lfh:cart-updated"));
  } catch {}
};

export default function FoodCard({ item, index, viewingCategory }: { item: FoodItem; index: number; viewingCategory?: string }) {
  const [cartQty, setCartQty] = useState(0);
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const thumbRef = useRef<HTMLDivElement>(null);

  // Pop the image on every add (works on touch too, where there's no hover).
  const popThumb = () => {
    thumbRef.current?.animate(
      [{ transform: "scale(0.82)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
      { duration: 340, easing: "cubic-bezier(0.34,1.56,0.64,1)" }
    );
  };

  const syncQty = () => {
    const found = readCart().find(i => i.id === item.id && isPlainLine(i));
    setCartQty(found?.qty ?? 0);
  };

  useEffect(() => {
    syncQty();
    setCurrencyState(getCurrency());
    const onCart = () => syncQty();
    const onCur = () => setCurrencyState(getCurrency());
    window.addEventListener("lfh:cart-updated", onCart);
    window.addEventListener("lfh:currency-changed", onCur);
    return () => {
      window.removeEventListener("lfh:cart-updated", onCart);
      window.removeEventListener("lfh:currency-changed", onCur);
    };
    // syncQty/setCurrencyState are stable; re-run only when the dish changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Dishes with options open the customize popup instead of adding directly.
  const openCustomize = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    popThumb();
    window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", {
      detail: {
        item: { id: item.id, title: item.title, price: item.price, image: item.image },
        options: item.options,
        allergens: item.allergens,
      },
    }));
  };

  const updateQty = (e: MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (delta > 0) popThumb();
    const cart = readCart();
    const idx = cart.findIndex(i => i.id === item.id && isPlainLine(i));
    const newQty = (idx >= 0 ? cart[idx].qty : 0) + delta;
    if (newQty <= 0) {
      writeCart(cart.filter((i, k) => k !== idx));
    } else if (idx >= 0) {
      cart[idx].qty = newQty;
      writeCart(cart);
    } else {
      writeCart([...cart, { id: item.id, title: item.title, price: item.price, image: item.image, qty: newQty, sig: "[]" }]);
    }
    setCartQty(Math.max(0, newQty));
    // Notify on add (so the toast fires from the menu too, not just the popup).
    if (delta > 0) {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${item.title} added`, kicker: "your order" } }));
    }
  };

  const soldOut = (item.tags || []).includes("sold-out");
  // Menu cards stay FAST: dishes with real option groups (size/extras you must
  // pick) open the Customize popup; everything else keeps the quick "+", which
  // adds the plain/non-allergic version. Allergy choices live on the dish's
  // detail page ("Add to Cart" there opens the popup), not on the menu cards.
  const hasOptions = (item.options?.length ?? 0) > 0;

  return (
    <Link href={`/item/${item.slug}${viewingCategory ? `?cat=${viewingCategory}` : ""}`} className="item-card-link">
      <div
        className={`item-card fade-in ${item.is4d ? "is-4d" : ""} ${soldOut ? "sold-out" : ""}`}
        style={{ animationDelay: `${index * 0.06}s` }}
      >
        <div className={`thumb-wrapper ${imgLoaded ? "img-ready" : "img-loading"}`} ref={thumbRef}>
          {/* Plain <img> (not next/image) on purpose: dish image URLs are
              DB-driven and set in the editor to ANY host, which would crash
              next/image's whitelist. Matches every other image in the app. */}
          <img
            className="dish-thumb"
            src={item.image}
            alt={item.title}
            width={110}
            height={110}
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
          />
          {item.is4d ? (
            <div className="badge-4d">
              <i className="fas fa-cube"></i> 4D
            </div>
          ) : null}
        </div>
        <div className="dish-info">
          <div className="dish-name">
            {item.title}
            {item.is4d ? <i className="fas fa-cube dish-4d-icon"></i> : null}
          </div>
          <div className="dish-meta">
            {item.rating || "4.8"} ★ • {item.time || "25-30 min"}
          </div>
          <div className="dish-price">{currency ? formatPrice(item.price, currency) : `$${item.price}`}</div>
        </div>

        <div className="diet-badge" aria-hidden="true">
          <VegIcon isVeg={item.veg} size={18} />
        </div>
        {soldOut ? (
          <span
            className="sold-out-pill"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            Not available
          </span>
        ) : hasOptions ? (
          <button
            type="button"
            className="cart-add-btn customize-btn"
            onClick={openCustomize}
            aria-label={`Customize and add ${item.title}`}
            title="Customize"
          >
            <i className="fas fa-sliders"></i>
          </button>
        ) : cartQty === 0 ? (
          <button
            type="button"
            className="cart-add-btn"
            onClick={(e) => updateQty(e, 1)}
            aria-label={`Add ${item.title} to cart`}
          >
            <i className="fas fa-plus"></i>
          </button>
        ) : (
          <div
            className="cart-qty-row"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <button type="button" className="qty-ctrl" onClick={(e) => updateQty(e, -1)} aria-label="Remove one">
              <i className="fas fa-minus"></i>
            </button>
            <span className="qty-num">{cartQty}</span>
            <button type="button" className="qty-ctrl" onClick={(e) => updateQty(e, 1)} aria-label="Add one">
              <i className="fas fa-plus"></i>
            </button>
          </div>
        )}
      </div>
    </Link>
  );
}
