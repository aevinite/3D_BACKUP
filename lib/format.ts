"use client";

// Currency + language helpers.
//
// Prices in menu.json are stored as USD numbers (the source of truth).
// The user-facing display is converted via the static `rate` below.
// Rates are intentionally hardcoded — for a live restaurant you should
// refresh them periodically from a free FX feed (e.g. exchangerate.host).
// They're declared here so a non-developer can update the numbers without
// touching any other file.

// The list of currency "names" the app supports. The | means "one of these".
// If you wanted to add another currency, you'd add its short code here first.
export type CurrencyCode = "USD" | "INR" | "EUR" | "AED" | "SAR" | "QAR";

// A description of everything we need to know about one currency.
// (An "interface" is just a shape/template that says what fields exist.)
export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  label: string;
  rate: number;     // multiplier vs base USD
  decimals: number; // how many decimal places to show
}

// The actual table of currencies the menu offers. Each row is one currency.
// "rate" is how many of that currency equal 1 US dollar (so ₹84 = $1).
// A non-developer can safely update these rate numbers when exchange rates move.
export const CURRENCIES: CurrencyMeta[] = [
  { code: "USD", symbol: "$",   label: "USD", rate: 1,     decimals: 2 },
  { code: "INR", symbol: "₹",   label: "INR", rate: 84,    decimals: 0 },
  { code: "EUR", symbol: "€",   label: "EUR", rate: 0.92,  decimals: 2 },
  { code: "AED", symbol: "AED", label: "AED", rate: 3.67,  decimals: 2 },
  { code: "SAR", symbol: "SAR", label: "SAR", rate: 3.75,  decimals: 2 },
  { code: "QAR", symbol: "QAR", label: "QAR", rate: 3.64,  decimals: 2 },
];

// The list of languages the menu can show. Each is a short 2-letter code:
// en = English, de = German, fr = French, ar = Arabic, hi = Hindi, ko = Korean.
export type LanguageCode = "en" | "de" | "fr" | "ar" | "hi" | "ko";

// The shape describing one language: its code, a short tag (EN), a full
// name (English), and a flag emoji to show in the language picker.
export interface LanguageMeta {
  code: LanguageCode;
  short: string;
  label: string;
  flag: string;
}

// The actual table of languages offered in the language switcher.
export const LANGUAGES: LanguageMeta[] = [
  { code: "en", short: "EN", label: "English", flag: "🇬🇧" },
  { code: "de", short: "DE", label: "Deutsch", flag: "🇩🇪" },
  { code: "fr", short: "FR", label: "Français", flag: "🇫🇷" },
  { code: "ar", short: "AR", label: "العربية", flag: "🇸🇦" },
  { code: "hi", short: "HI", label: "हिन्दी", flag: "🇮🇳" },
  { code: "ko", short: "KO", label: "한국어", flag: "🇰🇷" },
];

// These are the "labels" we save the chosen currency/language under in the
// browser's localStorage (a tiny per-device notebook the browser keeps).
const CURRENCY_KEY = "lfh_currency";
const LANGUAGE_KEY = "lfh_language";

// Read back which currency the guest picked last time (defaults to USD).
// localStorage only exists in the browser, so if it's missing we just return
// the first currency in the list so nothing crashes on the server.
export const getCurrency = (): CurrencyMeta => {
  if (typeof localStorage === "undefined") return CURRENCIES[0];
  const code = (localStorage.getItem(CURRENCY_KEY) || "USD") as CurrencyCode;
  // Find the matching row; if somehow not found, fall back to the first one.
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
};

// Remember the guest's chosen currency, then shout out an announcement so any
// price on screen can hear it and re-draw itself in the new currency.
export const setCurrency = (code: CurrencyCode) => {
  try {
    localStorage.setItem(CURRENCY_KEY, code);
  } catch {} // if saving fails (private mode, etc.) just carry on quietly
  if (typeof window !== "undefined") {
    // "lfh:currency-changed" is the event name other components listen for.
    window.dispatchEvent(new Event("lfh:currency-changed"));
  }
};

// Same idea as getCurrency, but for the chosen language (defaults to English).
export const getLanguage = (): LanguageMeta => {
  if (typeof localStorage === "undefined") return LANGUAGES[0];
  const code = (localStorage.getItem(LANGUAGE_KEY) || "en") as LanguageCode;
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
};

// Save the guest's chosen language and announce it so on-screen text re-renders.
export const setLanguage = (code: LanguageCode) => {
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {}
  if (typeof window !== "undefined") {
    // "lfh:language-changed" is the event name the useLanguage() hook listens for.
    window.dispatchEvent(new Event("lfh:language-changed"));
  }
};

// Round a converted price to a "nice" customer-facing number.
// We round to the nearest 5 / 10 / 100 depending on magnitude so we never
// show fractions like ₹1091 or AED 47.67 — restaurant menu prices look
// confident when they end in .00, .50, .95, or 0/5 in whole-number currencies.
const niceRound = (value: number, decimals: number): number => {
  // Guard against bad input (e.g. NaN); a price should never be "not a number".
  if (!Number.isFinite(value)) return 0;
  if (decimals === 0) {
    // For ₹ and other whole-number currencies, snap to the nearest pleasing step.
    // Trick: divide, round, multiply back. e.g. round 1091 to nearest 50 -> 1100.
    if (value >= 500) return Math.round(value / 50) * 50;
    if (value >= 100) return Math.round(value / 10) * 10;
    if (value >= 20)  return Math.round(value / 5) * 5;
    return Math.round(value);
  }
  // For $/€/AED etc, end prices in .95 if close, otherwise nearest .50.
  const whole = Math.floor(value); // the dollars part (everything before the dot)
  const frac = value - whole;      // the cents part (the leftover after the dot)
  // If we're already very close to .99, just make it .99 (a confident menu price).
  if (Math.abs(frac - 0.99) < 0.07) return whole + 0.99;
  if (frac < 0.25) return whole;        // cents are tiny -> round down to a whole number
  if (frac < 0.75) return whole + 0.5;  // cents are middling -> land on .50
  return whole + 0.99;                  // cents are high -> push up to .99
};

// formatPrice converts a USD price to the user's chosen currency, rounds
// it to a nice display value, and returns a string like "₹1,100" or "$12.99".
// The "confident" price as a USD number (rounds to .95 / .50 / .00). This is the
// SINGLE source of truth for what a dish costs, so the menu, cart and bill all read
// the same value, agree, and add up. The pretty rounding is applied once, here, in USD.
export const prettyUsd = (price: string | number): number => {
  // The price might arrive as text ("12.5") or a real number; turn it into a number.
  const n = typeof price === "string" ? parseFloat(price) : price;
  // Apply the "nice" rounding once, in USD, so everywhere downstream agrees.
  return niceRound(Number.isFinite(n) ? n : 0, 2);
};

// Menu/item PRICE: the confident USD price, converted to the chosen currency.
// (USD display is identical to before; other currencies now mirror the USD price,
// so the menu and the bill never disagree.)
export const formatPrice = (price: string | number, currency?: CurrencyMeta): string =>
  formatMoney(prettyUsd(price), currency);

// formatMoney is for BILLS and TOTALS: it converts to the chosen currency and
// rounds to that currency's decimals WITHOUT the "nice" menu-price rounding, so a
// bill always adds up (subtotal + tax = total) and the guest sees what they pay.
// Use formatPrice for menu/item prices; use formatMoney for anything summed.
export const formatMoney = (price: string | number, currency?: CurrencyMeta): string => {
  // Use the currency passed in, or fall back to whatever the guest picked.
  const cur = currency || getCurrency();
  // Accept text or number for the price, and guard against bad values.
  const n = typeof price === "string" ? parseFloat(price) : price;
  const safe = Number.isFinite(n) ? n : 0;
  // Convert USD -> chosen currency (multiply by rate), then add thousands commas
  // and the right number of decimal places. toLocaleString does the comma/decimal work.
  const formatted = (safe * cur.rate).toLocaleString("en-US", {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  });
  // A 1-character symbol like $ or ₹ hugs the number ("$12"); a multi-letter one
  // like "AED" gets a space ("AED 12") so it reads cleanly.
  const tight = cur.symbol.length === 1;
  return tight ? `${cur.symbol}${formatted}` : `${cur.symbol} ${formatted}`;
};
