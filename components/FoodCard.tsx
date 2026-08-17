"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { formatPrice, prettyUsd, getCurrency, DEFAULT_CURRENCY, type CurrencyMeta } from "@/lib/format";
import type { OptionGroup } from "@/lib/menu";
import VegIcon from "./VegIcon";
// The "must be at a table to order" gate. When dining-sessions are on and the
// guest isn't connected, this opens the join flow and runs the add afterwards.
import { gateAddToCart } from "@/lib/tableConnection";
// Per-restaurant feature switches: ratings / 3D badges can be turned off.
import { useFeatures } from "@/lib/features";
// A long dish name shrinks to fit its two-line box instead of being cut off with "…"
// (owner, 2026-08-05: "make it dynamic so that for every screen it should fit").
import { useFitText } from "@/lib/useFitText";
// The sold-out pill has a translation in all six languages (t.notAvailable) and the DISH PAGE
// already used it — only this card rendered the English literal, so a Hindi guest saw
// "Not available" on the grid and "उपलब्ध नहीं" the moment they opened it (T15 sweep).
import { useTranslation } from "@/lib/i18n";

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
  // The two model FILES. The card needs them because the "4D" tick alone does not mean 3D will
  // open — see `has3d` below. Both are already on the card payload (lib/menu.ts CARD_COLUMNS).
  modelSmallUrl?: string;
  modelOptimizedUrl?: string;
  rating?: string;       // average of REAL reviews ("" = none yet -> "New" badge)
  reviewCount?: number;  // how many real reviews exist
  time?: string;
  tags?: string[];       // labels like "sold-out" or filter slugs
  options?: OptionGroup[]; // size/extras choices that open the Customize popup
  allergens?: string[];
}

// The localStorage key where the shopping cart is saved on this device —
// tenant-scoped via tget/tset so each restaurant has its own cart.
import { tget, tset } from "@/lib/tenantStorage";
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
    const raw = tget(CART_KEY);
    // JSON.parse turns the saved text back into a real list.
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};

// Saves the cart back to localStorage and announces the change so other parts
// of the app (the cart badge, other cards) can update themselves.
const writeCart = (cart: CartItem[]) => {
  try {
    tset(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event("lfh:cart-updated")); // "the cart changed!"
  } catch {}
};

// One dish "card" in the menu grid: the photo, name, price, veg badge, and the
// add/customise button. `index` is its position (used to stagger the fade-in);
// `viewingCategory` is the current filter, remembered in the link.
export default function FoodCard({ item, index, viewingCategory, restaurantId, restaurantSlug, showDiet }: { item: FoodItem; index: number; viewingCategory?: string; restaurantId?: string; restaurantSlug?: string;
  /* Whether the veg / non-veg MARK belongs on this card. Decided by MenuView, which is the only
     place that can see the WHOLE menu: on a pure-veg (or all-meat) restaurant every dish is on the
     same side of the line, so marking each one says nothing — owner, 2026-08-12. Undefined means
     "no opinion", which falls back to the switch alone, so any caller that predates this prop keeps
     today's behaviour. */
  showDiet?: boolean }) {
  // Read THIS restaurant's switches (not the default one's) so a per-restaurant
  // toggle — e.g. turning ratings off for one restaurant — actually shows/hides
  // here. Falls back to the default restaurant when no id is passed.
  const features = useFeatures(restaurantId); // which restaurant features are switched on
  // The two-line name box keeps its exact designed size; a name too long for it shrinks its own
  // font until the WHOLE name fits, instead of being cut off. (owner, 2026-08-05)
  const nameRef = useFitText(item.title);
  const t = useTranslation();                 // the guest's language, for the sold-out pill
  // Inside a specific restaurant's menu (/r/<slug>/menu) the dish link must stay in
  // that restaurant (/r/<slug>/item/...). No slug = the default menu → global /item.
  const base = restaurantSlug ? `/r/${restaurantSlug}` : "";
  // How many of this (plain) dish are in the cart — shows on the +/- counter.
  const [cartQty, setCartQty] = useState(0);
  // The currency to format the price in (e.g. $, €). Loaded on screen.
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null);
  // Whether the photo has finished loading (lets us fade it in).
  const [imgLoaded, setImgLoaded] = useState(false);
  // A broken/missing photo URL: show a neutral placeholder instead of the
  // browser's broken-image glyph or an endless shimmer. Starts true when there
  // is no URL at all (an empty src never fires onError).
  const [imgError, setImgError] = useState(!item.image);
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
    // Customising IS an intent to order, so it goes through the same table gate:
    // if the guest isn't connected, the join flow opens first and the Customize
    // popup opens once they're in.
    gateAddToCart(() => {
      popThumb();
      // Tell the app to open the Customize popup, pre-filled with this dish.
      window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", {
        detail: {
          item: { id: item.id, title: item.title, price: item.price, image: item.image },
          options: item.options,
          allergens: item.allergens,
        },
      }));
    });
  };

  // Adds or removes one of this dish from the cart. `delta` is +1 (the "+"
  // button) or -1 (the "−" button).
  const updateQty = (e: MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    // Removing (delta < 0) is always allowed; ADDING goes through the table gate so
    // a not-yet-seated guest is sent to join their table first (then the add runs).
    if (delta > 0) { gateAddToCart(() => applyQty(delta)); return; }
    applyQty(delta);
  };

  // The actual cart mutation, split out so the gate can run it before OR after the
  // join flow without duplicating the logic.
  const applyQty = (delta: number) => {
    if (delta > 0) popThumb(); // little bounce only when adding
    const cart = readCart();
    // Find this dish's plain line in the cart (if it's already there).
    const idx = cart.findIndex(i => i.id === item.id && isPlainLine(i));
    // Work out the new quantity after applying delta, CLAMPED to 99 to match the
    // server's per-line LEAST(99, …) cap — otherwise the cart quoted more items
    // (and a higher price) than the kitchen would actually make/charge (audit fix
    // bug #6; the cart-panel "+" already clamped, these menu-card taps didn't).
    const rawQty = (idx >= 0 ? cart[idx].qty : 0) + delta;
    const newQty = Math.min(99, rawQty);
    // Tell the guest why the "+" stopped adding, so it doesn't feel broken.
    // REJECTED (owner, 2026-08-12): these two toast strings stay ENGLISH and are not moved into
    // lib/i18n.ts. Guest sweep T1 reported them (with the offline strip) as "hardcoded English on a
    // 6-language menu"; asked directly, the owner chose *"No — English is fine for these"*. Do not
    // translate them and do not re-report them. See docs/REJECTED-IDEAS.md R15.
    if (delta > 0 && rawQty > 99) {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Maximum 99 per dish", subtitle: "that's the most we can add to one line", kicker: "your order", duration: 1400 } }));
    }
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
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${item.title} added`, subtitle: "tap to view your bill", kicker: "your order", event: "lfh:open-cart", duration: 1200 } }));
    }
  };

  // DOES 3D ACTUALLY WORK FOR THIS DISH? Three things have to be true, and the card used to check
  // only the first two (owner, 2026-08-12: *"do the problem nine also"*).
  //
  //   1. the owner ticked "4D" on the dish            → item.is4d
  //   2. this restaurant has the 3D feature switched on → features.model3d
  //   3. THE MODEL FILES EXIST                        → both URLs are set
  //
  // The downloader has always required all three (`i.is4d && i.modelSmallUrl && i.modelOptimizedUrl`
  // in MenuView) — the badge did not. So a dish ticked as 4D BEFORE its model was uploaded wore a
  // "4D" badge, a cube icon and the whole 4D card treatment, and the diner who tapped through was
  // met with "3D view isn't ready for this dish". Advertising the one feature this product sells
  // itself on and then not having it is worse than not advertising it. One source of truth now.
  const has3d = !!(item.is4d && features.model3d && item.modelSmallUrl && item.modelOptimizedUrl);
  // ── STILL OWED: SHOW A BROKEN 3D DISH ON THE OWNER'S PROBLEMS LIST ────────────────────────────
  // Asked for by the owner, 2026-08-12: *"whenever the 3-D is not available, it should show me as a
  // problem also notification"*. The badge above no longer LIES to the diner, which is the guest
  // half; telling the owner is the other half, and it deliberately does NOT live here.
  //
  // Why not from the diner's phone: the only public sink for a client-side fault is
  // /api/log/client-error, which files at level 'error', is capped at 5 per device per 10 minutes,
  // and can raise an owner alert. A menu with three un-uploaded models would burn that budget on a
  // content problem and push real crashes off the Repair board — the same "a board full of
  // non-faults is a board nobody reads" reasoning that endpoint's own noise filter was built on.
  // It would also only ever be noticed if a diner happened to open that menu.
  //
  // Where it belongs: the admin/editor side already holds `is4d`, `model_small_url` and
  // `model_optimized_url` for every dish, so "ticked 4D, feature on, files missing" is a plain
  // server-side query over `menu_items` — found without any diner, per restaurant, once. That is a
  // job on the ADMIN problems surface, not in a guest card. Tracked in .claude/REQUESTS.md.
  // ──────────────────────────────────────────────────────────────────────────────────────────────

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
    <Link href={`${base}/item/${item.slug}${viewingCategory ? `?cat=${viewingCategory}` : ""}`} className="item-card-link">
      <div
        // is-4d gives the card its 3D treatment. It must follow the SWITCH, not just the
        // dish flag: with 3D off the badge and the cube icon correctly disappear, but the
        // card kept wearing the 4D styling with nothing to explain it (sweep 2026-08-04).
        className={`item-card fade-in ${has3d ? "is-4d" : ""} ${soldOut ? "sold-out" : ""}`}
        // Stagger each card's fade-in slightly based on its position — CAPPED at the tenth card
        // (T1 improvement 9, 2026-08-12). Uncapped, a 40-dish category made its last card wait 2.4s
        // before appearing, and Aangan has categories that size; the effect is a flourish on the
        // first few cards, not something a diner should sit through. Ten steps keeps the cascade
        // visible and everything after that arrives together.
        style={{ animationDelay: `${Math.min(index, 10) * 0.06}s` }}
      >
        {/* The photo area; the class flips from "loading" to "ready" once loaded */}
        <div
          className={`thumb-wrapper ${imgLoaded || imgError ? "img-ready" : "img-loading"}`}
          ref={thumbRef}
          // On a broken/missing photo, fill with a neutral tint so the card
          // never shows a broken-image icon or pulses forever.
          style={imgError ? { background: "var(--surface-2, rgba(120,120,120,0.12))" } : undefined}
        >
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
            // Hide the img element itself when the photo is broken/missing, the
            // same way the search dropdown does, so no broken glyph shows.
            style={imgError ? { visibility: "hidden" } : undefined}
            onLoad={() => setImgLoaded(true)}
            // If the photo URL ever fails (dead host/404), stop the shimmer and
            // settle the card instead of leaving it pulsing forever — that
            // endless "loading" shimmer is what reads as a blank card.
            onError={() => { setImgLoaded(true); setImgError(true); }}
          />
          {/* Show a little "4D" cube badge only if this dish has a 3D model
              (and the restaurant hasn't switched the 3D feature off). */}
          {has3d ? (
            <div className="badge-4d">
              <i className="fas fa-cube"></i> 4D
            </div>
          ) : null}
        </div>
        <div className="dish-info">
          <div className="dish-name" ref={nameRef}>
            {item.title}
            {/* A small cube icon beside the name for 4D dishes */}
            {has3d ? <i className="fas fa-cube dish-4d-icon"></i> : null}
          </div>
          {/* Rating (real average) and prep time. Dishes with no reviews yet
              show only the prep time — no invented stars, no extra badges
              (the owner rejected a "New" badge here on 2026-06-10). The whole
              rating disappears when the restaurant switches ratings off.
              NO INVENTED PREP TIME. This used to be `item.time || "25-30 min"`, and because
              `time` is blank for whole menus, EVERY dish told the diner "25-30 min" — measured on
              restaurant #1: all 59 cards, espresso included (guest sweep T1, 2026-08-06). A number
              a guest plans their evening around has to be real or absent; the same reasoning
              removed the fake per-dish star rating. The editor's Prep time field keeps
              "25-30 min" as its PLACEHOLDER, which is where a suggestion belongs.
              The row itself always renders (see `.dish-meta` min-height in globals.css) so a dish
              with neither a rating nor a time keeps the card exactly the height it is today. */}
          {/* Built as a list and joined, rather than nested ternaries with a hand-written " • ".
              With the invented prep time gone, either half can now be missing, and a hardcoded
              separator would leave a card reading "• 4.5 ★" or a lonely bullet. */}
          <div className="dish-meta">
            {[
              // Ratings ON: the real average, or an honest "no ratings yet" when there are none.
              // Ratings OFF for this restaurant: neither — the slot says nothing at all, which is
              // correct, because "no ratings yet" would imply ratings are coming.
              features.ratings
                ? (item.reviewCount && item.reviewCount > 0 ? `${item.rating} ★` : t.noRatingsYet)
                : "",
              // Only when the restaurant has asked for it (Access → Menu → Prep time on a dish;
              // `prep_time`, default OFF — owner, 2026-08-12) AND the dish actually has one typed.
              // Nothing is ever invented: this used to be `item.time || "25-30 min"`, which told
              // every diner on restaurant #1 that all 59 dishes take 25-30 minutes, espresso included.
              features.prep_time ? (item.time || "") : "",
            ].filter(Boolean).join(" • ")}
          </div>
          {/* Price, formatted to the chosen currency (falls back to a $ amount) */}
          <div className="dish-price">{formatPrice(item.price, currency || DEFAULT_CURRENCY)}</div>
        </div>

        {/* The veg / non-veg marker in the corner. One switch now covers the filter chips
            AND this mark (Access → Menu → Veg / non-veg): a pure-veg restaurant has nothing
            to distinguish, so marking every dish green was noise (owner, 2026-07-31). */}
        {(showDiet ?? !!features.diet_filter) && (
          <div className="diet-badge" aria-hidden="true">
            <VegIcon isVeg={item.veg} size={18} />
          </div>
        )}
        {/* The bottom-right control changes depending on the dish's state: */}
        {soldOut ? (
          // 1) Sold out: a "Not available" LABEL — not a button, and no longer a dead spot either.
          //
          // It used to carry `onClick={e => { e.preventDefault(); e.stopPropagation(); }}`, which
          // did keep it from behaving like a button — but it also swallowed the whole-card link
          // underneath it. So on a sold-out dish there was one patch of the tile where a tap did
          // absolutely nothing, while every other patch opened the dish. A diner who taps the words
          // "Not available" is asking *what is this, and when is it back* — the honest answer is the
          // dish page, which is what the rest of the card already gives them.
          // Dropping the handler is all it takes: the tap bubbles to the card's own <Link>. There is
          // nothing here to preventDefault FOR — unlike the "+" and the −/+ stepper below, this
          // element has no action of its own to protect. (Guest sweep T1, 2026-08-17.)
          <span className="sold-out-pill">
            {t.notAvailable}
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
