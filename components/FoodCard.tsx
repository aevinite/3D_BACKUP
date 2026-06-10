"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { formatPrice, prettyUsd, getCurrency, type CurrencyMeta } from "@/lib/format";
import type { OptionGroup } from "@/lib/menu";
import VegIcon from "./VegIcon";

// The full set of details one dish can have. The "?" ones are optional.
interface FoodItem {
  id: string;
  slug: string;          // the short url-friendly name, e.g. "onion-soup"
  title: string;
  price: string;
  image: string;
  category: string;
  veg: boolean;          // vegetarian? drives the VegIcon
  is4d: boolean;         // does this dish have a 3D model to view?
  modelFolder?: string;
  rating?: string;       // average of REAL reviews ("" = none yet -> "New" badge)
  reviewCount?: number;  // how many real reviews exist
  time?: string;
  tags?: string[];       // labels like "sold-out" or filter slugs
  options?: OptionGroup[]; // size/extras choices that open the Customize popup
  allergens?: string[];
}

// The localStorage key where the shopping cart is saved on this device.
const CART_KEY = "lfh_cart";

// The shape of one line saved in the cart. `sig` is a "signature" that captures
// any chosen options, so a plain dish and a customised one stay separate lines.
interface CartItem { id: string; title: string; price: string; image: string; qty: number; sig?: string; }

// The menu card's "+" only ever adds/controls the PLAIN version of a dish
// (no options, no removed allergens, no note). The customize popup tags those
// lines with sig "[]"; quick-adds historically had no sig. Match either so the
// card never accidentally bumps a customized line that shares the same id.
const isPlainLine = (i: CartItem) => !i.sig || i.sig === "[]";

// Reads the saved cart out of localStorage and hands back the list. If anything
// is missing or corrupt, it safely returns an empty list instead of crashing.
const readCart = (): CartItem[] => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    // JSON.parse turns the saved text back into a real list.
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

// Saves the cart back to localStorage and announces the change so other parts
// of the app (the cart badge, other cards) can update themselves.
const writeCart = (cart: CartItem[]) => {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("lfh:cart-updated")); // "the cart changed!"
  } catch {}
};

// One dish "card" in the menu grid: the photo, name, price, veg badge, and the
// add/customise button. `index` is its position (used to stagger the fade-in);
// `viewingCategory` is the current filter, remembered in the link.
export default function FoodCard({ item, index, viewingCategory }: { item: FoodItem; index: number; viewingCategory?: string }) {
  // How many of this (plain) dish are in the cart — shows on the +/- counter.
  const [cartQty, setCartQty] = useState(0);
  // The currency to format the price in (e.g. $, €). Loaded on screen.
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null);
  // Whether the photo has finished loading (lets us fade it in).
  const [imgLoaded, setImgLoaded] = useState(false);
  // A handle to the photo wrapper so we can "pop" it when added.
  const thumbRef = useRef<HTMLDivElement>(null);

  // Pop the image on every add (works on touch too, where there's no hover).
  // This uses the browser's built-in animate() to bounce the photo briefly.
  const popThumb = () => {
    thumbRef.current?.animate(
      [{ transform: "scale(0.82)" }, { transform: "scale(1.07)" }, { transform: "scale(1)" }],
      { duration: 340, easing: "cubic-bezier(0.34,1.56,0.64,1)" }
    );
  };

  // Look up how many of this dish are currently in the cart and update the
  // counter shown on the card.
  const syncQty = () => {
    const found = readCart().find(i => i.id === item.id && isPlainLine(i));
    setCartQty(found?.qty ?? 0);
  };

  // On first show (and whenever the dish changes): read the current quantity
  // and currency, then listen for cart/currency changes so the card stays in
  // sync if they're edited elsewhere.
  useEffect(() => {
    syncQty();
    setCurrencyState(getCurrency());
    // When the cart changes anywhere, re-check our quantity.
    const onCart = () => syncQty();
    // When the currency is switched, re-read it so the price re-formats.
    const onCur = () => setCurrencyState(getCurrency());
    window.addEventListener("lfh:cart-updated", onCart);
    window.addEventListener("lfh:currency-changed", onCur);
    // Cleanup: drop both listeners when the card is removed.
    return () => {
      window.removeEventListener("lfh:cart-updated", onCart);
      window.removeEventListener("lfh:currency-changed", onCur);
    };
    // syncQty/setCurrencyState are stable; re-run only when the dish changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Dishes with options open the customize popup instead of adding directly.
  // (preventDefault/stopPropagation stop the tap from also opening the dish page,
  //  since the whole card is a link.)
  const openCustomize = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    popThumb();
    // Tell the app to open the Customize popup, pre-filled with this dish.
    window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", {
      detail: {
        item: { id: item.id, title: item.title, price: item.price, image: item.image },
        options: item.options,
        allergens: item.allergens,
      },
    }));
  };

  // Adds or removes one of this dish from the cart. `delta` is +1 (the "+"
  // button) or -1 (the "−" button).
  const updateQty = (e: MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (delta > 0) popThumb(); // little bounce only when adding
    const cart = readCart();
    // Find this dish's plain line in the cart (if it's already there).
    const idx = cart.findIndex(i => i.id === item.id && isPlainLine(i));
    // Work out the new quantity after applying delta.
    const newQty = (idx >= 0 ? cart[idx].qty : 0) + delta;
    if (newQty <= 0) {
      // Dropped to zero or below: remove the line entirely.
      writeCart(cart.filter((i, k) => k !== idx));
    } else if (idx >= 0) {
      // Already in the cart: just update its count.
      cart[idx].qty = newQty;
      writeCart(cart);
    } else {
      // Not in the cart yet: add it as a new plain line (sig "[]"). The price
      // stored is the CONFIDENT (prettyUsd) unit — the same convention the
      // customize popup uses — so the bill never re-rounds a stored price.
      writeCart([...cart, { id: item.id, title: item.title, price: prettyUsd(item.price).toFixed(2), image: item.image, qty: newQty, sig: "[]" }]);
    }
    // Update the on-card counter (never show a negative number).
    setCartQty(Math.max(0, newQty));
    // Notify on add (so the toast fires from the menu too, not just the popup).
    if (delta > 0) {
      // Tappable confirmation: tapping the toast opens the bill (the quick "+"
      // skips the customize popup, so this is its version of the success step).
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${item.title} added`, subtitle: "tap to view your bill", kicker: "your order", event: "lfh:open-cart" } }));
    }
  };

  // Is this dish flagged sold-out? (We treat a missing tags list as empty.)
  const soldOut = (item.tags || []).includes("sold-out");
  // Menu cards stay FAST: dishes with real option groups (size/extras you must
  // pick) open the Customize popup; everything else keeps the quick "+", which
  // adds the plain/non-allergic version. Allergy choices live on the dish's
  // detail page ("Add to Cart" there opens the popup), not on the menu cards.
  // Does this dish have real option groups? If so, the button opens Customize
  // instead of quick-adding.
  const hasOptions = (item.options?.length ?? 0) > 0;

  return (
    // The whole card is a link to the dish's detail page. We tack the current
    // category onto the URL (?cat=...) so going back keeps the same filter.
    <Link href={`/item/${item.slug}${viewingCategory ? `?cat=${viewingCategory}` : ""}`} className="item-card-link">
      <div
        className={`item-card fade-in ${item.is4d ? "is-4d" : ""} ${soldOut ? "sold-out" : ""}`}
        // Stagger each card's fade-in slightly based on its position.
        style={{ animationDelay: `${index * 0.06}s` }}
      >
        {/* The photo area; the class flips from "loading" to "ready" once loaded */}
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
          {/* Show a little "4D" cube badge only if this dish has a 3D model */}
          {item.is4d ? (
            <div className="badge-4d">
              <i className="fas fa-cube"></i> 4D
            </div>
          ) : null}
        </div>
        <div className="dish-info">
          <div className="dish-name">
            {item.title}
            {/* A small cube icon beside the name for 4D dishes */}
            {item.is4d ? <i className="fas fa-cube dish-4d-icon"></i> : null}
          </div>
          {/* Rating (real average) and prep time. Dishes with no reviews yet
              show only the prep time — no invented stars, no extra badges
              (the owner rejected a "New" badge here on 2026-06-10). */}
          <div className="dish-meta">
            {item.reviewCount && item.reviewCount > 0 ? (
              <>{item.rating} ★ • </>
            ) : null}{item.time || "25-30 min"}
          </div>
          {/* Price, formatted to the chosen currency (falls back to a $ amount) */}
          <div className="dish-price">{currency ? formatPrice(item.price, currency) : `$${item.price}`}</div>
        </div>

        {/* The veg / non-veg marker in the corner */}
        <div className="diet-badge" aria-hidden="true">
          <VegIcon isVeg={item.veg} size={18} />
        </div>
        {/* The bottom-right control changes depending on the dish's state: */}
        {soldOut ? (
          // 1) Sold out: a non-clickable "Not available" pill.
          <span
            className="sold-out-pill"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            Not available
          </span>
        ) : hasOptions ? (
          // 2) Has options: a "sliders" button that opens the Customize popup.
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
          // 2) Not in cart yet: a simple "+" button to quick-add one.
          <button
            type="button"
            className="cart-add-btn"
            onClick={(e) => updateQty(e, 1)}
            aria-label={`Add ${item.title} to cart`}
          >
            <i className="fas fa-plus"></i>
          </button>
        ) : (
          // 3) Already in cart: a "− [count] +" stepper to change the amount.
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
