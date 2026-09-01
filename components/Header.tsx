// Runs in the browser so it can read/save the theme and react to taps.
"use client";

import { useEffect, useState } from "react";
import NavPicker from "./NavPicker";
import ConnectionBadge from "./ConnectionBadge";
// Per-restaurant feature switches: currency/language pickers can be turned off.
import { useFeatures } from "@/lib/features";
// Which languages/currencies THIS restaurant offers (Access → Menu → Format) — the same
// short-TTL de-duplicated settings read useFeatures makes, so it adds no request.
import { getSettings } from "@/lib/menu";
import { useRestaurantId } from "@/lib/restaurant-context";
import {
  CURRENCIES,
  LANGUAGES,
  getCurrency,
  getLanguage,
  setCurrency,
  setLanguage,
  type CurrencyMeta,
  type LanguageMeta,
} from "@/lib/format";
import { readActiveOrders, hasHiddenLiveOrder } from "@/lib/orderStatus";
import { tget } from "@/lib/tenantStorage";
import { splitBrandSegments, hasBrandMarkers } from "@/lib/brandText";
// A RESTAURANT'S OWN NAME IS NEVER CUT (owner, 2026-08-26). The top bar packs the wordmark next to
// four fixed-width buttons, so on the narrowest phones the name ran out of room and ended in "…" —
// measured at 320px: 98px available, 120px needed, while 360px and up were clean. This is the same
// helper the dish names already use ("make it dynamic so that for every screen it should fit",
// 2026-08-05), taught to notice a name that is too WIDE as well as one that is too tall.
import { useFitText } from "@/lib/useFitText";

// The site only has two looks: a dark theme and a light theme.
type Theme = "dark" | "light";

// readTheme(): figure out which theme is currently active by reading the
// "data-theme" marker on the page's top <html> element. Defaults to light.
const readTheme = (): Theme => {
  // On the server there's no document yet, so just assume light.
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
};

// Header: the top bar with the restaurant name, currency/language pickers, a
// light/dark toggle, and the cart button (with its item-count badge).
export default function Header({ logoText }: { logoText?: string }) {
  const restaurantId = useRestaurantId();
  // Re-fits whenever the name itself changes — a soft restaurant switch, or the wordmark being
  // edited — and whenever the bar's own box resizes (rotating the phone).
  const brandRef = useFitText<HTMLHeadingElement>(logoText || "little French house");
  const features = useFeatures(restaurantId); // which restaurant features are switched on
  // Each useState below is a labelled memory box the header keeps:
  const [mounted, setMounted] = useState(false); // has the header finished loading in the browser yet?
  const [theme, setTheme] = useState<Theme>("light"); // current look: dark or light
  const [cartCount, setCartCount] = useState(0); // number on the little cart badge
  const [hiddenLive, setHiddenLive] = useState(false); // a live order whose tracker is hidden
  const [currency, setCurrencyState] = useState<CurrencyMeta>(CURRENCIES[0]); // chosen currency
  const [language, setLanguageState] = useState<LanguageMeta>(LANGUAGES[0]); // chosen language

  // loadCartCount(): read the saved cart and add up all the quantities so the
  // badge shows the right number.
  const loadCartCount = () => {
    try {
      // Read the cart from the browser's notepad (localStorage).
      const saved = tget("lfh_cart");
      if (!saved) return setCartCount(0);
      const cart = JSON.parse(saved); // text back into a list
      const total = Array.isArray(cart)
        ? cart.reduce((sum: number, it: { qty?: number }) => sum + (it.qty ?? 1), 0)
        : 0;
      setCartCount(total);
    } catch {
      setCartCount(0); // if anything goes wrong, show 0
    }
  };

  // loadHiddenLive(): decide whether to show the little "live order" dot on the
  // cart button (true when there's an in-progress order whose tracker is hidden).
  const loadHiddenLive = () => {
    try { setHiddenLive(hasHiddenLiveOrder(readActiveOrders())); } catch { setHiddenLive(false); }
  };

  // useEffect runs once when the header appears: load everything, then start
  // listening for app-wide messages so the header stays in sync.
  useEffect(() => {
    setMounted(true);
    setTheme(readTheme());
    setCurrencyState(getCurrency());
    setLanguageState(getLanguage());
    loadCartCount();
    loadHiddenLive();
    // Tiny helpers that react to each kind of broadcast message:
    const onCart = () => loadCartCount(); // cart changed -> update the badge
    const onTheme = () => setTheme(readTheme()); // theme toggled somewhere -> re-read it
    const onCurrency = () => setCurrencyState(getCurrency()); // currency changed -> refresh
    const onLanguage = () => setLanguageState(getLanguage()); // language changed -> refresh
    // Recompute the live-order dot when an order is placed, its status changes,
    // or it's hidden (OrderTracker broadcasts lfh:orders-updated for all of these).
    const onOrders = () => loadHiddenLive();
    // Start listening for those messages from the rest of the app.
    window.addEventListener("lfh:cart-updated", onCart);
    window.addEventListener("lfh:theme-changed", onTheme);
    window.addEventListener("lfh:currency-changed", onCurrency);
    window.addEventListener("lfh:language-changed", onLanguage);
    window.addEventListener("lfh:order-placed", onOrders);
    window.addEventListener("lfh:orders-updated", onOrders);
    // "storage" is the browser's built-in signal that fires when ANOTHER tab
    // changes localStorage — keeps the dot in sync across tabs.
    window.addEventListener("storage", onOrders);
    // Stop listening when the header goes away (prevents leftover listeners).
    return () => {
      window.removeEventListener("lfh:cart-updated", onCart);
      window.removeEventListener("lfh:theme-changed", onTheme);
      window.removeEventListener("lfh:currency-changed", onCurrency);
      window.removeEventListener("lfh:language-changed", onLanguage);
      window.removeEventListener("lfh:order-placed", onOrders);
      window.removeEventListener("lfh:orders-updated", onOrders);
      window.removeEventListener("storage", onOrders);
    };
    // Re-read on a soft same-tab restaurant switch (the header doesn't remount across
    // /r/A → /r/B), so the cart count + live-order dot reflect the new tenant's own
    // scoped storage instead of lingering on the previous restaurant's.
  }, [restaurantId]);

  // Single-currency / English-only restaurants (owner 2026-07-09): when a restaurant
  // turns the currency or language switcher OFF, keep the RESTAURANT DEFAULT — INR and
  // English — even for a RETURNING guest who picked another currency/language at a
  // DIFFERENT restaurant. Hiding the picker isn't enough on its own: the device-wide
  // saved choice would still apply, so we force it back to the default when the feature
  // is off. (When it's on, the guest's own choice is untouched.)
  useEffect(() => {
    if (features.currency === false && getCurrency().code !== "INR") setCurrency("INR");
    if (features.languages === false && getLanguage().code !== "en") setLanguage("en");
    // Re-runs only when a feature flag resolves/changes — never on the guest's own pick.
  }, [features.currency, features.languages]);

  // WHICH languages / currencies this restaurant offers (Access → Menu → Format). Exactly
  // one means the switcher is REMOVED, not disabled — the owner's rule. getSettings is the
  // same short-TTL, de-duplicated read useFeatures already makes, so this costs no extra
  // request. Until it resolves we show nothing rather than the full six, so a single-language
  // restaurant never flashes a picker it doesn't have.
  const [menuLangs, setMenuLangs] = useState<string[] | null>(null);
  const [menuCurrs, setMenuCurrs] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    getSettings(restaurantId)
      .then((s) => { if (alive) { setMenuLangs(s.menuLanguages); setMenuCurrs(s.menuCurrencies); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [restaurantId]);
  // A guest carrying a choice from ANOTHER restaurant must not keep a language this one
  // doesn't offer — that would render the menu in a language the restaurant switched off.
  useEffect(() => {
    if (menuLangs && menuLangs.length && !menuLangs.includes(getLanguage().code)) setLanguage(menuLangs[0] as LanguageMeta["code"]);
    if (menuCurrs && menuCurrs.length && !menuCurrs.includes(getCurrency().code)) setCurrency(menuCurrs[0] as CurrencyMeta["code"]);
  }, [menuLangs, menuCurrs]);

  const currencyOptions = CURRENCIES.filter((c) => (menuCurrs ? menuCurrs.includes(c.code) : true));
  const languageOptions = LANGUAGES.filter((l) => (menuLangs ? menuLangs.includes(l.code) : true));
  // The switcher exists only when there is a real choice to make.
  const showCurrency = features.currency && !!menuCurrs && currencyOptions.length > 1;
  const showLanguage = features.languages && !!menuLangs && languageOptions.length > 1;

  // toggleTheme(): flip between dark and light when the toggle is tapped.
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark"; // pick the opposite
    setTheme(next); // update our memory
    document.documentElement.setAttribute("data-theme", next); // re-skin the page now
    try {
      // Remember the choice so it sticks on the next visit.
      localStorage.setItem("lfh_theme", next);
    } catch {}
    // Tell the rest of the app the theme changed so others can react.
    window.dispatchEvent(new Event("lfh:theme-changed"));
  };

  // The sun/moon icon is chosen by CSS from the <html data-theme> attribute (set
  // before first paint by the boot script), not by JS — so it never flashes the
  // wrong glyph for a frame on a dark reload while React catches up (audit fix
  // bug #16). We still keep `mounted` for other client-only bits below.
  void mounted;

  return (
    <div className="nav">
      {/* Left: the restaurant name, split into styled pieces. */}
      <div className="brand">
        {logoText ? (
          // Custom wordmark. With *asterisks* the marked part uses the accent and the
          // rest is the mode-adaptive plain colour (white in dark / black in light).
          // With NO markers the whole name stays the accent — unchanged from before.
          <h1 className="brand-title" ref={brandRef}>
            {hasBrandMarkers(logoText)
              ? splitBrandSegments(logoText).map((seg, i) => (
                  <span key={i} className={seg.hi ? "brand-highlight" : "brand-plain"}>{seg.text}</span>
                ))
              : <span className="brand-highlight">{logoText}</span>}
          </h1>
        ) : (
          <h1 className="brand-title" ref={brandRef}>
            <span className="brand-plain">little</span>{" "}
            <span className="brand-highlight">French</span>{" "}
            <span className="brand-plain">house</span>
          </h1>
        )}
      </div>
      {/* Right: all the action buttons (currency, language, theme, cart). */}
      <div className="nav-actions">
        {/* Connection light (🟢 Live / 🟡 Reconnecting / 🔴 Offline). */}
        <ConnectionBadge guest />
        {/* Currency dropdown: button shows the current symbol; the list lets
            the guest pick another. onSelect calls setCurrency to switch.
            Gone when the currency feature is off (₹-only menu). */}
        {showCurrency && <NavPicker
          buttonLabel="Currency"
          buttonContent={<span style={{ fontSize: 14 }}>{currency.symbol}</span>}
          options={currencyOptions.map((c) => ({
            key: c.code,
            label: (
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ width: 22, textAlign: "center" }}>{c.symbol}</span>
                <span>{c.label}</span>
              </span>
            ),
            active: currency.code === c.code,
            onSelect: () => setCurrency(c.code),
          }))}
        />}
        {/* Language dropdown: same idea as currency, but for the menu language.
            Gone when the languages feature is off (English-only menu). */}
        {showLanguage && <NavPicker
          buttonLabel="Language"
          buttonContent={<span style={{ fontSize: 12 }}>{language.short}</span>}
          options={languageOptions.map((l) => ({
            key: l.code,
            label: (
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ width: 22, textAlign: "center" }}>{l.flag}</span>
                <span>{l.label}</span>
              </span>
            ),
            active: language.code === l.code,
            onSelect: () => setLanguage(l.code),
          }))}
        />}
        {/* The light/dark toggle button. Tapping it runs toggleTheme. */}
        <button
          className="nav-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title="Toggle Theme"
        >
          {/* Both icons are rendered; CSS shows the right one for the current
              [data-theme] with no first-paint flash (see bug #16 fix above). */}
          <i className="fas fa-sun theme-icon-sun" aria-hidden="true"></i>
          <i className="fas fa-moon theme-icon-moon" aria-hidden="true"></i>
        </button>
        {/* The cart button. Tapping it broadcasts "lfh:open-cart" so the cart
            panel opens. */}
        <button
          className="nav-btn"
          title="Cart"
          aria-label="Open cart"
          onClick={() => window.dispatchEvent(new Event("lfh:open-cart"))}
        >
          <i className="fas fa-shopping-bag"></i>
          {/* Only show the number badge when there's at least one item. */}
          {cartCount > 0 && (
            <span className="cart-badge" style={{ display: "flex" }}>
              {cartCount}
            </span>
          )}
          {/* A small pulsing dot appears when there's a live order whose tracker is hidden. */}
          {hiddenLive && <span className="cart-live-dot" aria-label="Live order in progress" />}
        </button>
      </div>
    </div>
  );
}
