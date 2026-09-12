// lib/phoneText.ts — how a guest's mobile number is written on a screen. ONE place.
//
// WHY THIS FILE EXISTS (sweep 8 · T16, 2026-09-04)
// A ten-digit number printed as one run — `9876500077` — is hard to read back to somebody over
// the phone, and reading it back is exactly what these screens are for. The owner's Customers
// screen has spaced it 5+5 since August, with that reason written beside it. **Pay Later did not**,
// and Pay Later is the screen you open when you are about to RING the person who owes you money.
// Measured on the phone he tests (360px): the Customers list showed `90000 00007` and the Pay Later
// row beside it showed `9876500077`.
//
// So rather than a third copy of four characters of arithmetic, the rule moves here — the same
// shape `lib/searchText.ts` already uses for the search cleaner that the Customers screen and its
// route both call. Zero imports, no server-only code, safe in a `"use client"` file.
//
// STILL ONE COPY LEFT, DELIBERATELY: `app/aevinite/customers/page.tsx` holds an identical local
// `showPhone`. That file belongs to the admin-console terminal, not this one, so it is named in
// this terminal's report instead of edited from here. Whoever owns it next: delete it and import
// this.

/**
 * A guest's mobile as a person reads it aloud: `9876500077` → `98765 00077`.
 *
 * Anything that is not exactly ten digits is handed back untouched — a nine-digit landline, a
 * number with a country code, a legacy row — because guessing at the grouping of a number we do
 * not recognise is worse than showing it plainly. An empty or missing number is an em dash, never
 * a blank gap and never the word "undefined".
 */
export const showPhone = (p: string | null | undefined): string => {
  const s = (p ?? "").trim();
  return s.length === 10 ? `${s.slice(0, 5)} ${s.slice(5)}` : s || "—";
};
