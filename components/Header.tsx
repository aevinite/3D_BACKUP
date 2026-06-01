"use client";

import { useEffect, useState } from "react";
import NavPicker from "./NavPicker";
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

type Theme = "dark" | "light";

const readTheme = (): Theme => {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
};

export default function Header() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [cartCount, setCartCount] = useState(0);
  const [hiddenLive, setHiddenLive] = useState(false); // a live order whose tracker is hidden
  const [currency, setCurrencyState] = useState<CurrencyMeta>(CURRENCIES[0]);
  const [language, setLanguageState] = useState<LanguageMeta>(LANGUAGES[0]);

  const loadCartCount = () => {
    try {
      const saved = localStorage.getItem("lfh_cart");
      if (!saved) return setCartCount(0);
      const cart = JSON.parse(saved);
      const total = Array.isArray(cart)
        ? cart.reduce((sum: number, it: { qty?: number }) => sum + (it.qty ?? 1), 0)
        : 0;
      setCartCount(total);
    } catch {
      setCartCount(0);
    }
  };

  const loadHiddenLive = () => {
    try { setHiddenLive(hasHiddenLiveOrder(readActiveOrders())); } catch { setHiddenLive(false); }
  };

  useEffect(() => {
    setMounted(true);
    setTheme(readTheme());
    setCurrencyState(getCurrency());
    setLanguageState(getLanguage());
    loadCartCount();
    loadHiddenLive();
    const onCart = () => loadCartCount();
    const onTheme = () => setTheme(readTheme());
    const onCurrency = () => setCurrencyState(getCurrency());
    const onLanguage = () => setLanguageState(getLanguage());
    // Recompute the live-order dot when an order is placed, its status changes,
    // or it's hidden (OrderTracker broadcasts lfh:orders-updated for all of these).
    const onOrders = () => loadHiddenLive();
    window.addEventListener("lfh:cart-updated", onCart);
    window.addEventListener("lfh:theme-changed", onTheme);
    window.addEventListener("lfh:currency-changed", onCurrency);
    window.addEventListener("lfh:language-changed", onLanguage);
    window.addEventListener("lfh:order-placed", onOrders);
    window.addEventListener("lfh:orders-updated", onOrders);
    window.addEventListener("storage", onOrders);
    return () => {
      window.removeEventListener("lfh:cart-updated", onCart);
      window.removeEventListener("lfh:theme-changed", onTheme);
      window.removeEventListener("lfh:currency-changed", onCurrency);
      window.removeEventListener("lfh:language-changed", onLanguage);
      window.removeEventListener("lfh:order-placed", onOrders);
      window.removeEventListener("lfh:orders-updated", onOrders);
      window.removeEventListener("storage", onOrders);
    };
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("lfh_theme", next);
    } catch {}
    window.dispatchEvent(new Event("lfh:theme-changed"));
  };

  const iconClass = mounted && theme === "dark" ? "moon" : "sun";

  return (
    <div className="nav">
      <div className="brand">
        <h1 className="brand-title">
          <span className="brand-plain">little</span>{" "}
          <span className="brand-highlight">French</span>{" "}
          <span className="brand-plain">house</span>
        </h1>
      </div>
      <div className="nav-actions">
        <NavPicker
          buttonLabel="Currency"
          buttonContent={<span style={{ fontSize: 14 }}>{currency.symbol}</span>}
          options={CURRENCIES.map((c) => ({
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
        />
        <NavPicker
          buttonLabel="Language"
          buttonContent={<span style={{ fontSize: 12 }}>{language.short}</span>}
          options={LANGUAGES.map((l) => ({
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
        />
        <button
          className="nav-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          title="Toggle Theme"
        >
          <i id="theme-icon" className={`fas fa-${iconClass}`}></i>
        </button>
        <button
          className="nav-btn"
          title="Cart"
          aria-label="Open cart"
          onClick={() => window.dispatchEvent(new Event("lfh:open-cart"))}
        >
          <i className="fas fa-shopping-bag"></i>
          {cartCount > 0 && (
            <span className="cart-badge" style={{ display: "flex" }}>
              {cartCount}
            </span>
          )}
          {hiddenLive && <span className="cart-live-dot" aria-label="Live order in progress" />}
        </button>
      </div>
    </div>
  );
}
