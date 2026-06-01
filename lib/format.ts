"use client";

// Currency + language helpers.
//
// Prices in menu.json are stored as USD numbers (the source of truth).
// The user-facing display is converted via the static `rate` below.
// Rates are intentionally hardcoded — for a live restaurant you should
// refresh them periodically from a free FX feed (e.g. exchangerate.host).
// They're declared here so a non-developer can update the numbers without
// touching any other file.

export type CurrencyCode = "USD" | "INR" | "EUR" | "AED" | "SAR" | "QAR";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  label: string;
  rate: number;     // multiplier vs base USD
  decimals: number; // how many decimal places to show
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: "USD", symbol: "$",   label: "USD", rate: 1,     decimals: 2 },
  { code: "INR", symbol: "₹",   label: "INR", rate: 84,    decimals: 0 },
  { code: "EUR", symbol: "€",   label: "EUR", rate: 0.92,  decimals: 2 },
  { code: "AED", symbol: "AED", label: "AED", rate: 3.67,  decimals: 2 },
  { code: "SAR", symbol: "SAR", label: "SAR", rate: 3.75,  decimals: 2 },
  { code: "QAR", symbol: "QAR", label: "QAR", rate: 3.64,  decimals: 2 },
];

export type LanguageCode = "en" | "de" | "fr" | "ar" | "hi" | "ko";

export interface LanguageMeta {
  code: LanguageCode;
  short: string;
  label: string;
  flag: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: "en", short: "EN", label: "English", flag: "🇬🇧" },
  { code: "de", short: "DE", label: "Deutsch", flag: "🇩🇪" },
  { code: "fr", short: "FR", label: "Français", flag: "🇫🇷" },
  { code: "ar", short: "AR", label: "العربية", flag: "🇸🇦" },
  { code: "hi", short: "HI", label: "हिन्दी", flag: "🇮🇳" },
  { code: "ko", short: "KO", label: "한국어", flag: "🇰🇷" },
];

const CURRENCY_KEY = "lfh_currency";
const LANGUAGE_KEY = "lfh_language";

export const getCurrency = (): CurrencyMeta => {
  if (typeof localStorage === "undefined") return CURRENCIES[0];
  const code = (localStorage.getItem(CURRENCY_KEY) || "USD") as CurrencyCode;
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
};

export const setCurrency = (code: CurrencyCode) => {
  try {
    localStorage.setItem(CURRENCY_KEY, code);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("lfh:currency-changed"));
  }
};

export const getLanguage = (): LanguageMeta => {
  if (typeof localStorage === "undefined") return LANGUAGES[0];
  const code = (localStorage.getItem(LANGUAGE_KEY) || "en") as LanguageCode;
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
};

export const setLanguage = (code: LanguageCode) => {
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("lfh:language-changed"));
  }
};

// Round a converted price to a "nice" customer-facing number.
// We round to the nearest 5 / 10 / 100 depending on magnitude so we never
// show fractions like ₹1091 or AED 47.67 — restaurant menu prices look
// confident when they end in .00, .50, .95, or 0/5 in whole-number currencies.
const niceRound = (value: number, decimals: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (decimals === 0) {
    // For ₹ and other whole-number currencies, snap to the nearest pleasing step.
    if (value >= 500) return Math.round(value / 50) * 50;
    if (value >= 100) return Math.round(value / 10) * 10;
    if (value >= 20)  return Math.round(value / 5) * 5;
    return Math.round(value);
  }
  // For $/€/AED etc, end prices in .95 if close, otherwise nearest .50.
  const whole = Math.floor(value);
  const frac = value - whole;
  if (Math.abs(frac - 0.99) < 0.07) return whole + 0.99;
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return whole + 0.99;
};

// formatPrice converts a USD price to the user's chosen currency, rounds
// it to a nice display value, and returns a string like "₹1,100" or "$12.99".
export const formatPrice = (price: string | number, currency?: CurrencyMeta): string => {
  const cur = currency || getCurrency();
  const n = typeof price === "string" ? parseFloat(price) : price;
  if (!Number.isFinite(n)) return `${cur.symbol}0`;
  const rounded = niceRound(n * cur.rate, cur.decimals);
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  });
  const tight = cur.symbol.length === 1;
  return tight ? `${cur.symbol}${formatted}` : `${cur.symbol} ${formatted}`;
};
