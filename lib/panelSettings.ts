// panelSettings.ts — WHAT NEVER LEAVES THE SERVER INSIDE A SETTINGS ROW.
//
// WHY THIS EXISTS (T17 sweep, 2026-08-13, finding F1). The manager panel's boot bundle
// (`/api/editor/all`) and the waiter tablet's floor refresh (`/api/tablet/summary`) both read the
// restaurant's `settings` row with `select("*")` and hand the whole thing to the browser. They do
// that for a good reason — between them those two screens read dozens of columns, and a hand-typed
// column list is the kind of thing that silently goes stale when a feature adds a column.
//
// But one column in that row is not a setting at all: `platform_channels` carries the per-channel
// CONNECTION KEY for Zomato / Swiggy / the website (migration 209). Both admin screens that manage
// those keys go out of their way never to hand the value back —
// `app/api/admin/restaurants/platform-channels/route.ts` answers `hasKey: true/false`, and the
// Access screen shows `••••1234` (lib/accessState.ts). It was reaching every manager's and every
// waiter's browser anyway, once a minute per tablet, and NOT ONE line of `public/panels/` reads it.
//
// So this is the same move the tablet route already makes for `access_config` (T6 sweep,
// 2026-08-10: "this restaurant's whole permission record has no business in a tablet payload") —
// stated once, in one file, because it has to be true on both panels and a second copy is how one
// of them stops doing it.
//
// ADD TO THE LIST, NEVER TO ONE ROUTE: if a future feature stores a credential, a webhook secret or
// anything else a panel must not hold on `settings`, name the column here and both panels are
// covered the same day. `npm run verify:panel-secrets` fails if a panel route ships a settings row
// without going through this.

/** Columns on `settings` that are NOT settings — a credential a panel has no use for. */
export const PRIVATE_SETTINGS_COLUMNS = [
  // Per-channel delivery-platform connection keys (mig 209): { zomato: { on, key }, … }.
  "platform_channels",
] as const;

/**
 * Strip the private columns out of a settings row that is about to be sent to a panel.
 *
 * Takes and returns the same shape, so a caller can keep passing the row around unchanged; `null`
 * in, `null` out (the panels already handle a restaurant with no settings row). It COPIES rather
 * than deleting in place — the row may be the same object another read is holding, and the floor
 * cache's one rule is that a handler never writes into shared state.
 */
export function panelSafeSettings<T extends Record<string, unknown> | null | undefined>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if ((PRIVATE_SETTINGS_COLUMNS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out as T;
}
