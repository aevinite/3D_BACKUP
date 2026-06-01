// Shared table-number validation used by both the cart (place order) and the
// "call a waiter" popup, so the two can never drift apart. The kitchen/staff
// need a real place to go, so we reject blanks, non-numbers, 0, and anything
// above the restaurant's configured table count.
//
// `tableCount` of 0 means "we don't know how many tables exist" (settings not
// loaded / not configured) — in that case we only check the value is a sane
// positive integer and skip the upper bound.

export interface TableCheck {
  ok: boolean;
  /** Trimmed, digits-only value when ok; "" otherwise. */
  value: string;
  /** Guest-facing message to toast when not ok. */
  message?: string;
}

export function validateTable(raw: string, tableCount: number): TableCheck {
  const value = (raw || "").trim();
  if (!value) {
    return { ok: false, value: "", message: "Please enter your table number first." };
  }
  // Whole positive integer only (inputs are digits-only, but guard anyway).
  const num = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(num) || num < 1) {
    return { ok: false, value: "", message: "Please enter a valid table number." };
  }
  // Only enforce the upper bound when we actually know the table count.
  if (tableCount > 0 && num > tableCount) {
    return {
      ok: false,
      value: "",
      message: `Table ${num} doesn't exist — we have tables 1–${tableCount}. Please check your number.`,
    };
  }
  return { ok: true, value };
}

// Toast the message, focus the offending input, and flash its error state.
export function flagTableInput(inputId: string, message: string) {
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker: "table", variant: "error" } }));
  const el = document.getElementById(inputId) as HTMLInputElement | null;
  el?.focus();
  el?.classList.add("table-input-error");
  setTimeout(() => el?.classList.remove("table-input-error"), 1500);
}
