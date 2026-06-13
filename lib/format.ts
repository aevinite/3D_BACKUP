"use client";

// Currency + language helpers.
//
// Prices are stored in INR (rupees) — the base currency (migration 043).
// Other currencies are converted from ₹ via the static `rate` below.
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
// BASE is now INR — prices are stored in rupees (migration 043). `rate` = how
// many of that currency equal ₹1: INR is 1 (base); others are their old per-USD
// rate ÷ 84. A non-developer updates these when FX moves.
export const CURRENCIES: CurrencyMeta[] = [
  { code: "INR", symbol: "₹",   label: "INR", rate: 1,          decimals: 0 },
  { code: "USD", symbol: "$",   label: "USD", rate: 1 / 84,     decimals: 2 },
  { code: "EUR", symbol: "€",   label: "EUR", rate: 0.92 / 84,  decimals: 2 },
  { code: "AED", symbol: "AED", label: "AED", rate: 3.67 / 84,  decimals: 2 },
  { code: "SAR", symbol: "SAR", label: "SAR", rate: 3.75 / 84,  decimals: 2 },
  { code: "QAR", symbol: "QAR", label: "QAR", rate: 3.64 / 84,  decimals: 2 },
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

// The default currency is RUPEES (₹) — everything shows in INR unless a guest
// explicitly picks another from the currency switcher. setCurrency only ever
// writes on an explicit pick, so a guest who never chose (new OR existing) gets
// INR; one who deliberately chose another currency keeps their choice.
const DEFAULT_CURRENCY: CurrencyMeta = CURRENCIES.find((c) => c.code === "INR") || CURRENCIES[0];

// Read back which currency the guest picked last time (defaults to INR).
// localStorage only exists in the browser, so if it's missing we just return
// the default so nothing crashes on the server.
export const getCurrency = (): CurrencyMeta => {
  if (typeof localStorage === "undefined") return DEFAULT_CURRENCY;
  const stored = localStorage.getItem(CURRENCY_KEY);
  if (!stored) return DEFAULT_CURRENCY;
  return CURRENCIES.find((c) => c.code === stored) || DEFAULT_CURRENCY;
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

// ---------------------------------------------------------------------------
// Price display. The actual MATH lives in lib/money.mjs (pure functions shared
// with `npm run test:money`). This section only ties that math to the
// currency the guest picked.
// ---------------------------------------------------------------------------
import { niceUsd, displayAmount, minorRound } from "./money.mjs";

// Display step per currency: INR prices snap to ₹10 (owner's decision,
// 2026-06-10 — "round figures for Indian rupees only"); 2-decimal currencies
// keep their cents. Tax uses MINOR below so it doesn't jump in ₹10 hops.
// INR is the base now, so its prices show EXACTLY as the owner set them (step 1);
// other currencies are converted from ₹ and keep their cents.
const STEP: Record<CurrencyCode, number> = { USD: 0.01, INR: 1, EUR: 0.01, AED: 0.01, SAR: 0.01, QAR: 0.01 };
const MINOR: Record<CurrencyCode, number> = { USD: 0.01, INR: 1, EUR: 0.01, AED: 0.01, SAR: 0.01, QAR: 0.01 };

// The "confident" USD unit price (.00/.50/.99 endings) — single source of
// truth, mirrors the server's lfh_nice_usd (migration 029). Old name kept so
// existing callers don't need to change.
export const prettyUsd = (price: string | number): number => niceUsd(price);

// USD -> guest currency as a NUMBER, snapped to the currency's step.
// All bill math must happen on these numbers so what's summed is what's shown.
export const toDisplay = (usd: string | number, currency?: CurrencyMeta): number => {
  const cur = currency || getCurrency();
  return displayAmount(usd, cur.rate, STEP[cur.code]);
};

// Round an already-display-domain amount (e.g. the 5% tax) to the currency's
// minor unit: whole rupees for INR, cents for everything else.
export const toMinor = (amount: number, currency?: CurrencyMeta): number => {
  const cur = currency || getCurrency();
  return minorRound(amount, MINOR[cur.code]);
};

// A small USD amount (an add-on like "+$1.25") converted and rounded to the
// currency's MINOR unit — add-ons never get the ₹10 menu snapping, otherwise
// the chips couldn't add up to the line total.
export const minorDisplay = (usd: string | number, currency?: CurrencyMeta): number => {
  const cur = currency || getCurrency();
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  return minorRound((Number.isFinite(n) ? n : 0) * cur.rate, MINOR[cur.code]);
};

// Display value of ONE cart-line unit: the snapped base price PLUS each
// add-on minor-rounded. Built this way so what the guest sees always adds up:
//   base chip (₹550) + add-on chips (+₹105) = unit (₹655) = bill line ÷ qty.
// `unitUsd` is the full unit (base + add-ons) as stored on the cart line;
// `addonUsds` are the add-on prices, so base = unit − Σ add-ons.
export const unitDisplay = (unitUsd: number, addonUsds: number[], currency?: CurrencyMeta): number => {
  const cur = currency || getCurrency();
  const addonSumUsd = addonUsds.reduce((s, a) => s + (Number.isFinite(a) ? a : 0), 0);
  const baseDisp = displayAmount(unitUsd - addonSumUsd, cur.rate, STEP[cur.code]);
  const addonsDisp = addonUsds.reduce((s, a) => s + minorDisplay(a, cur), 0);
  return baseDisp + addonsDisp;
};

// Format an already-display-domain NUMBER with symbol + thousands separators.
// No rounding happens here — the number must already be snapped by
// toDisplay/toMinor, so the string always matches the math.
export const formatAmount = (amount: number, currency?: CurrencyMeta): string => {
  const cur = currency || getCurrency();
  const formatted = (Number.isFinite(amount) ? amount : 0).toLocaleString("en-US", {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  });
  // A 1-character symbol like $ or ₹ hugs the number ("$12"); a multi-letter one
  // like "AED" gets a space ("AED 12") so it reads cleanly.
  const tight = cur.symbol.length === 1;
  return tight ? `${cur.symbol}${formatted}` : `${cur.symbol} ${formatted}`;
};

// Menu/dish PRICE: confident USD -> converted -> snapped -> formatted.
export const formatPrice = (price: string | number, currency?: CurrencyMeta): string =>
  formatAmount(toDisplay(prettyUsd(price), currency), currency);

// Bill-line money: a USD number (already includes add-ons) -> converted ->
// snapped EXACTLY like formatPrice, so a dish can never show two different
// prices on two screens (the old version skipped snapping — that was the
// ₹546-on-the-page vs ₹545-in-the-popup bug).
export const formatMoney = (price: string | number, currency?: CurrencyMeta): string =>
  formatAmount(toDisplay(price, currency), currency);
