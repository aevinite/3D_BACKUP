// lib/money.mjs — the ONLY place price math lives. Pure functions, no imports,
// so both the browser bundle (via lib/format.ts) and `node --test` can use it.
//
// Money flows like this:
//   USD in the database --niceUsd--> "confident" USD unit (matches the server's
//   lfh_nice_usd in migration 029) --displayAmount--> converted to the guest's
//   currency and snapped to that currency's step (INR snaps to 10s; the owner
//   chose round Indian-rupee figures, other currencies keep natural endings).

// Round a raw USD price to a confident menu ending (.00 / .50 / .99).
// MUST stay in sync with lfh_nice_usd() in supabase/migrations/029 — the server
// recomputes every order with that function, so if these two ever disagree the
// bill the guest sees and the total the kitchen charges would drift apart.
export function niceUsd(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return 0;
  const whole = Math.floor(n);
  const frac = n - whole;
  if (Math.abs(frac - 0.99) < 0.07) return whole + 0.99;
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return whole + 0.99;
}

// Snap a number to the nearest multiple of `step`, killing float dust
// (0.1+0.2 problems) by rounding to 6 decimals afterwards.
export function snapToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.round((Math.round(value / step) * step) * 1e6) / 1e6;
}

// Convert a USD amount to the guest's currency and snap to its display step.
// rate: how many of that currency equal $1. step: 10 for INR, 0.01 for others.
export function displayAmount(usd, rate, step) {
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  if (!Number.isFinite(n)) return 0;
  return snapToStep(n * rate, step);
}

// Round small amounts (tax) to the currency's MINOR unit so tax doesn't jump
// in ₹10 hops: INR minor = 1 rupee, USD/EUR minor = 0.01 (one cent).
export function minorRound(value, minor) {
  return snapToStep(value, minor);
}
