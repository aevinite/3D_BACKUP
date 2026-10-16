"use client";

// ─────────────────────────────────────────────────────────────────────────────
// guestName — ONE name for a diner, everywhere they are asked for one.
//
// THE OWNER'S OWN WORDS (2026-09-02):
//   "if you add name in review it will save as there name … when name ask again in review what
//    will name will be autofill there and there they add diff name the reviews name will be
//    change to again added name … so like everywhere there wil be 1 name … second time review
//    will also have that name"
//
// WHAT IT REPLACES. A diner used to be asked their name in three unrelated places, and none of
// them knew about the others:
//   · the review box on a dish page  (app/item/[slug]/ItemClient.tsx — started empty every time)
//   · opening or joining a table     (components/SessionGate.tsx — kept per SESSION, so a new
//                                     session asked again from scratch)
//   · before a waiter is called      (the same screen's name, cleared whenever the sheet closed)
// So one person could be three different people to the same restaurant in one evening: a review
// signed "Mia", a table opened by "M", and a request to staff that said "Someone".
//
// THE RULE NOW, in three lines:
//   1. A name given ANYWHERE becomes THE name for this diner at this restaurant.
//   2. Every box that asks for a name is filled in with it already.
//   3. Typing a different one changes it everywhere — INCLUDING reviews already left, which is
//      the half that cannot be done on the phone (migration 378, lfh_rename_my_reviews).
//
// PER RESTAURANT, not per phone, and that is deliberate. Every other guest key in this app is
// tenant-scoped (`lib/tenantStorage.ts`) after the 2026-07-04 leak where one restaurant's stored
// state showed up while browsing another on the same phone. "Everywhere" means everywhere within
// the restaurant the diner is actually sitting in — which is the case he described. Making it
// follow the phone across restaurants is a one-line change here if he ever wants it.
//
// WHICH DEVICE ID. Reviews are keyed by `lib/device.ts` (`lfh_device_id`); bans and sessions use
// a DIFFERENT id, `lib/guestDevice.ts` (`lfh_device`). The rename must use the review one or it
// renames nothing, silently.
// ─────────────────────────────────────────────────────────────────────────────

import { tget, tset, tkey } from "./tenantStorage";
import { getDeviceId } from "./device";
import { renameMyReviews } from "./menu";

const KEY = "lfh_my_name";
/** The same ceiling every name box in the guest app uses, and the one migration 378 enforces. */
export const GUEST_NAME_MAX = 40;
/** Fired after the one name changes, so any box already on screen can refill itself. */
export const GUEST_NAME_EVENT = "lfh:guest-name-changed";

/** Trim, collapse runs of whitespace, and cap — one definition, used on the way in and out. */
export const tidyGuestName = (raw: string): string =>
  String(raw || "").replace(/\s+/g, " ").trim().slice(0, GUEST_NAME_MAX);

/**
 * This diner's one name at this restaurant, or "" if they have never given one.
 * Safe to call during render: it only reads storage, and it never throws.
 */
export function getGuestName(): string {
  try {
    return tidyGuestName(tget(KEY) || "");
  } catch {
    return "";
  }
}

/**
 * Remember a name the diner has just given, wherever they gave it.
 *
 * Returns true when the stored name actually CHANGED and the phone KEPT it — callers use that to
 * avoid re-announcing something nobody typed, and the review toast uses it to say "saved as your
 * name". A private window (storage switched off) keeps nothing: the name is still sent to rename
 * past reviews, but the answer is false, because the next box will NOT be filled in with it. When it changes we do two things beyond storing it: tell the rest of
 * the app, and rename this device's past reviews at this restaurant so the diner is not signed
 * two different ways on the same menu.
 *
 * The rename is fire-and-forget on purpose. It must never delay or fail the thing the diner was
 * actually doing — placing an order, joining a table, leaving a review — and a failed rename
 * costs nothing worse than an older review keeping an older name until the next time.
 */
export function setGuestName(name: string, restaurantId?: string): boolean {
  const tidy = tidyGuestName(name);
  if (!tidy) return false;                       // clearing a box is not the same as renaming
  let kept = false;
  try {
    if (getGuestName() === tidy) return false;   // nothing changed → no write, no event, no rename
    tset(KEY, tidy);
    // READ IT BACK (sweep #10 T4, item 10, 2026-10-13). tset swallows a refused write on purpose
    // (a preference must never cost the page), so the old `catch { return false }` here could never
    // run: in a private window every review answered "changed" and the toast said "saved as your
    // name" — a promise the next visit broke, because nothing had been saved. Kept = it is there now.
    //
    // …ON THE PHONE, NOT IN THE PAGE (2026-10-16). Since sweep #10 T3 round 4's item 47, tset keeps a
    // write the phone refuses in the page's memory (so a basket survives a full or blocked storage),
    // and getGuestName() reads that copy back — so this read-back always passed again, and a private
    // window was once more told "saved as your name" for a name the next visit will not have. The
    // promise is about the next visit, so it is checked against the phone's own storage.
    kept = tidyGuestName(localStorage.getItem(tkey(KEY)) || "") === tidy;
  } catch { /* storage blocked outright — kept stays false */ }
  try {
    window.dispatchEvent(new CustomEvent(GUEST_NAME_EVENT, { detail: { name: tidy } }));
  } catch { /* not a browser, or events blocked — the stored name still stands */ }
  // …and the half that lives on the server: reviews this device has already left.
  if (restaurantId) {
    try {
      void renameMyReviews(getDeviceId(), restaurantId, tidy);
    } catch { /* best-effort, exactly as documented above */ }
  }
  return kept;
}
