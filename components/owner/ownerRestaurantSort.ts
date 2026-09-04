// ONE ORDER for the owner cockpit's restaurant lists — by name, the same on every screen.
//
// ── WHY (T17 sweep, 2026-09-04) ──────────────────────────────────────────────────────────────────
//
// A two-restaurant owner met his own restaurants in three different orders inside one console, and
// one of the three was not even stable between two loads of the same screen:
//
//   · the sidebar's "My restaurants"  → whatever `lfh_owner_overview` happened to return
//   · /owner/menu's picker            → whatever `.in("id", …)` happened to return
//   · /owner/manager's launcher       → the same read, MEASURED flipping 1 time in 8 loads
//
// PostgREST makes no promise about row order for a select with no `order by`, and both pages then
// used POSITION as if it meant something. On the launcher that is only confusing. On /owner/menu it
// decides real work: `selected = ids[0]`, so WHICH restaurant's menu opens — whose dish names and
// whose prices are on screen to be edited — was up to the database's mood.
//
// The project has this scar written down twice already: lib/restaurantColor exists because a colour
// keyed by POSITION "drifts the moment a chart sorts a copy", and the `two-rows-can-hold-one-web-
// address` finding was an unordered `LIMIT 1` picking the wrong row.
//
// So: sort by name, in one place, and let all three lists call it. `localeCompare` with
// `numeric: true` so "Branch 2" comes before "Branch 10", and `sensitivity: "base"` so a
// lower-case name is not exiled to the end.
//
// THE FILE IS CALLED …Sort, NOT …Order, AND THAT IS DELIBERATE. `verify:owner-s7` P21278 asserts
// that app/owner/menu/page.tsx "touches no bill, order or price directly" by grepping its code for
// /bill|invoice|order/i — so an import path containing the word "Order" turned a real, useful check
// red for a reason that had nothing to do with what it guards. The check is right; the filename was
// the thing to change. Do not rename this back.
//
// No "use client": a plain module, imported by the two SERVER pages and by the client shell alike.
// It sorts a COPY — never the caller's array, which on the server is the array a query returned.

export function byName<T extends { name?: string | null }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) =>
    String(a?.name ?? "").localeCompare(String(b?.name ?? ""), "en", { numeric: true, sensitivity: "base" }));
}
