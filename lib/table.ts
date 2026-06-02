// Shared table-number validation used by both the cart (place order) and the
// "call a waiter" popup, so the two can never drift apart. The kitchen/staff
// need a real place to go, so we reject blanks, non-numbers, 0, and anything
// above the restaurant's configured table count.
//
// `tableCount` of 0 means "we don't know how many tables exist" (settings not
// loaded / not configured) — in that case we only check the value is a sane
// positive integer and skip the upper bound.

// The shape of the answer `validateTable` gives back: did the number pass, the
// cleaned-up value, and (if it failed) a friendly message to show the guest.
export interface TableCheck {
  ok: boolean;
  /** Trimmed, digits-only value when ok; "" otherwise. */
  value: string;
  /** Guest-facing message to toast when not ok. */
  message?: string;
}

// Checks a table number the guest typed and tells us whether it's allowed.
// `raw` is exactly what they entered; `tableCount` is how many tables the
// restaurant has (0 means "unknown", so we skip the "too high" check).
export function validateTable(raw: string, tableCount: number): TableCheck {
  // Remove any leading/trailing spaces. `raw || ""` guards against undefined.
  const value = (raw || "").trim();
  // Empty box — nudge them to type something.
  if (!value) {
    return { ok: false, value: "", message: "Please enter your table number first." };
  }
  // Whole positive integer only (inputs are digits-only, but guard anyway).
  // Turn the text into a number so we can compare it below.
  const num = Number(value);
  // `/^\d+$/` is a pattern meaning "nothing but digits, start to finish" — so
  // "12" passes but "1a", "1.5" or "-3" don't. We also confirm it's a whole
  // number that's at least 1.
  if (!/^\d+$/.test(value) || !Number.isInteger(num) || num < 1) {
    return { ok: false, value: "", message: "Please enter a valid table number." };
  }
  // Only enforce the upper bound when we actually know the table count.
  // (If they typed a table higher than the restaurant has, reject it.)
  if (tableCount > 0 && num > tableCount) {
    return {
      ok: false,
      value: "",
      message: `Table ${num} doesn't exist — we have tables 1–${tableCount}. Please check your number.`,
    };
  }
  // Passed every check — hand back the clean value.
  return { ok: true, value };
}

// Toast the message, focus the offending input, and flash its error state.
// Used when validateTable fails: it pops up the warning, jumps the cursor into
// the wrong box, and briefly turns it red so the guest sees what to fix.
export function flagTableInput(inputId: string, message: string) {
  // Fire our app-wide "show a toast" event (other code listens for it and
  // renders the little pop-up notification).
  window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message, kicker: "table", variant: "error" } }));
  // Find the input box on the page by its id (might not exist, hence the cast).
  const el = document.getElementById(inputId) as HTMLInputElement | null;
  // The "?." means "only do this if el actually exists" — avoids a crash.
  el?.focus();
  // Add the red error styling...
  el?.classList.add("table-input-error");
  // ...then remove it 1.5 seconds later so it's just a quick flash.
  setTimeout(() => el?.classList.remove("table-input-error"), 1500);
}

// ── "scanned" table from a per-table QR ────────────────────────────────────
// Each table gets a sticker linking to `/menu?table=N`. When the guest opens
// that link, the menu page stores N here, and the cart + chef pre-fill from it
// so nobody has to type their table. It stays editable (a QR can be mis-scanned
// or shared), and clears when the guest scans a different table.
export const SCANNED_TABLE_KEY = "lfh_table";

export function getScannedTable(): string {
  try {
    return localStorage.getItem(SCANNED_TABLE_KEY) || "";
  } catch {
    return "";
  }
}

export function setScannedTable(value: string) {
  try {
    if (value) localStorage.setItem(SCANNED_TABLE_KEY, value);
    else localStorage.removeItem(SCANNED_TABLE_KEY);
  } catch {}
}
