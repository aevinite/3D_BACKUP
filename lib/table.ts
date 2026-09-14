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
  //
  // ── AND ONE A PHONE CAN HOLD EXACTLY (T4 sweep #9 round 2) ────────────────────────────────────
  // `isSafeInteger`, not `isInteger`. Above 2^53-1 a JavaScript number stops being able to name
  // every whole number, so `Number("99999999999999999999")` is 1e20 and `String()` of it is
  // "100000000000000000000" — a DIFFERENT number from the one that was typed. With the table count
  // known this was already refused by the range test below, but `tableCount` is 0 whenever the
  // restaurant's settings have not loaded yet, and then a twenty-digit entry came back `ok` with
  // digits nobody typed. That is the exact rule this checker exists for — the number that leaves
  // here is the number the floor will be given — broken by the canonicalising added earlier the
  // same day. No real table is anywhere near 2^53, so nothing legitimate is refused by this.
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(num) || num < 1) {
    return { ok: false, value: "", message: "Please enter a valid table number." };
  }
  // Only enforce the upper bound when we actually know the table count.
  // (If they typed a table higher than the restaurant has, reject it.)
  //
  // REJECTED (owner, 2026-09-14) — docs/REJECTED-IDEAS.md R55: do NOT make this bound work offline by caching the count on the
  // phone (R55). With no signal `tableCount` is 0 and this check is skipped — offered as a gap, and
  // it is not one: *"user/guest will scan qr and they will be locked to that particular table"*. A
  // guest never types the number; the QR carries it. The typed box is the admin's way to reach any
  // table, and `tableCount > 0` is the honest guard for the one caller that does know the count.
  if (tableCount > 0 && num > tableCount) {
    return {
      ok: false,
      value: "",
      message: `Table ${num} doesn't exist — we have tables 1–${tableCount}. Please check your number.`,
    };
  }
  // ── "007" IS TABLE 7, AND THE FLOOR HAS NEVER HEARD OF "007" (T4 sweep #9, item 4) ────────────
  // A table's identity everywhere — sessions, orders, bills, KOTs and the printed QR — is its
  // NUMBER, stored as text and compared with `=` (migration 131 states exactly that in its own
  // header; lfh_table_status does `WHERE table_number = lfh_merge_parent_table(...)`). So a padded
  // "007" passes every check above — it is all digits, and 7 is inside the range — and then matches
  // nothing: the diner is carried to "your table isn't open yet" for a table that does not exist,
  // while the one they are sitting at is open, and Request-a-waiter puts "007" in front of the
  // floor. MEASURED on the wire before this line existed: p_table went out as "007".
  //
  // Canonicalising is safe precisely BECAUSE of the two checks above — by this point the value has
  // been proved a plain positive whole number inside 1..tableCount, and a table's number is never
  // padded at the place it is created. It is done HERE, in the one shared checker, so all three
  // doors that ask for a table number get it: the basket's Place Order, the waiter-call popup, and
  // the table sheet (which stopped keeping its own private copy of these rules in the same change).
  return { ok: true, value: String(num) };
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
// Tenant-scoped: the table you scanned at one restaurant must not pre-fill at
// another restaurant on the same phone.
import { tget, tset, tremove } from "./tenantStorage";
export const SCANNED_TABLE_KEY = "lfh_table";

export function getScannedTable(): string {
  return tget(SCANNED_TABLE_KEY) || "";
}

export function setScannedTable(value: string) {
  if (value) tset(SCANNED_TABLE_KEY, value);
  else tremove(SCANNED_TABLE_KEY);
}
