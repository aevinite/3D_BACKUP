# Cross-Panel Live Sync — Design Spec

**Date:** 2026-06-17
**Goal:** Every state change in any panel (guest menu, admin, manager/editor, kitchen, tablet) propagates to every other screen that displays it — feeling instant — while *lowering* total database load. Built to extend cleanly for future features.

## Decisions locked with owner

- **Speed:** Truly instant (sub-second) — use the existing websocket push, not polling.
- **Guest menu:** Live but **gentle** — sold-out / price / availability reflect within ~1s without yanking the guest around (a dish being viewed shows "Sold out" instead of vanishing).
- **Admin:** Convert from 1s polling to the same push system (cuts ~180 req/min to near zero).

## What already exists (do NOT rebuild)

A "breadcrumb" push system:
- `realtime_events` table (migration 057) — tiny non-PII rows: `topic`, `kind`, `entity_id`, `table_number`. On the `supabase_realtime` publication. Auto-pruned to 15 min.
- `lfh_rt_emit()` trigger fn (058/059) — on a watched table change, inserts a breadcrumb on topic `ops` (staff) and, when a table is known, `table:<n>` (that table's guests).
- Watched today: `orders`, `order_items`, `waiter_calls`, `sessions` (**only** columns `status, cart, cart_updated_at, bill_no, invoice_no`), `session_members`, `requests`.
- `public/panels/realtime.js` (`LFH_RT.start({topics, onEvent})`) — one websocket per tab, debounces bursts ~300ms, refetches on breadcrumb + on tab wake/focus/online, 60s/2s fallbacks. Used by editor, kitchen, tablet.
- `/api/rt-config` — hands panels the public url + anon key.

**The system works for orders. The problem is what it was never told about.**

## The gaps (from full action audit)

| # | Gap | Table | Fix |
|---|-----|-------|-----|
| 1 | `auto_approve` toggle (the "join without approval" switch) never emits — excluded from sessions watched columns | `sessions` | Add `auto_approve` to the trigger's `UPDATE OF` list |
| 2 | Sold-out / 86, dish edits, price, new/deleted dishes never emit | `menu_items` | New trigger → **`menu`** topic |
| 3 | Feature toggles, maintenance, table_count, geo never emit | `settings` | New trigger → **`menu`** topic |
| 4 | Category add/edit/reorder/delete never emit | `categories` | New trigger → **`menu`** topic |
| 5 | Filter/tag changes never emit | `filters` | New trigger → **`menu`** topic |
| 6 | Block/unblock phone/table/device never emit | `blocklist` | New trigger → **`ops`** topic (staff-only, no PII id needed) |
| 7 | Editor's breadcrumb handler only calls `pollOrders()` — never `loadAll()`, so even a menu breadcrumb wouldn't refresh dishes | editor handler | Per-topic handlers (below) |
| 8 | Guest menu has no live updates at all | guest React app | New `useRealtime` hook on `menu` topic |
| 9 | Admin polls every 1s | admin React app | New `useRealtime` hook on `ops`+`menu` |
| 10 | Tablet refetches request data on every ops breadcrumb but has **no request-queue UI** | tablet | NOT a sync bug — flag to owner as a separate UI decision; do not silently add UI |

## Architecture

### Two topics, subscribe by need (keeps load minimal)
- **`ops`** — operational churn (orders/items/calls/sessions/members/requests/blocklist). **Staff panels only.**
- **`menu`** — slow-changing content (menu_items/categories/filters/settings). **Staff panels AND guests.**
- Guests subscribe to **`menu` only** — never the order firehose. One idle websocket per guest; breadcrumbs fire only on real edits (rare).

### Backend — migration `066_realtime_content_triggers.sql`
Extend `lfh_rt_emit()` so content tables route to the `menu` topic instead of `ops`:
- `menu_items` → kind `menu_item`, topic `menu`
- `categories` → kind `category`, topic `menu`
- `filters` → kind `filter`, topic `menu`
- `settings` → kind `settings`, topic `menu`
- `blocklist` → kind `block`, topic `ops`
- Keep all existing `ops` branches unchanged.
Then:
- Re-create `rt_emit_sessions` trigger to add `auto_approve` to watched columns.
- Add row-level AFTER INSERT/UPDATE/DELETE triggers on `menu_items`, `categories`, `filters`, `settings`, `blocklist`.
- `REVOKE` stays as-is (function already locked to service_role).
- `NOTIFY pgrst, 'reload schema';`

Bulk edits (e.g. seed script upserting every dish) emit many breadcrumbs at once — harmless: client debounce coalesces to ONE refetch, prune keeps the table tiny.

### `realtime.js` — per-topic handlers (backward compatible)
Refactor `LFH_RT.start` to accept either the old `{ topics, onEvent }` (unchanged behaviour) **or** a new `{ handlers: { ops: fn, menu: fn } }`. Each topic gets its own debounced fire so a cheap `ops` refresh doesn't trigger an expensive full `loadAll`. Wake/reconnect/initial-load fire **all** handlers once (debounced).

### Panel wiring
- **Editor:** `LFH_RT.start({ handlers: { ops: () => pollOrders(), menu: () => loadAll() } })`. `loadAll()` refreshes dishes/categories/filters/settings; `pollOrders()` stays the cheap order path.
- **Kitchen:** subscribe `topics: ["ops","menu"]`, single `onEvent: load` (its `load()` already pulls dishes incl. sold-out). One-line change.
- **Tablet:** same as kitchen — add `"menu"` to topics; `load()` already pulls menu_items+categories.
- **Admin (`app/aevinite/page.tsx`):** replace the 1s/3s `setInterval`s with new `useRealtime` hook → on `ops`: `loadFloor()`+`loadOverview()`; on `menu`: `loadOverview()`. Keep a slow 30s safety poll + focus refetch.

### Guest menu + admin — React `useRealtime` hook (`lib/useRealtime.ts`)
A small client hook mirroring `LFH_RT`: fetches `/api/rt-config`, uses the already-bundled `@supabase/supabase-js` (not the CDN import the vanilla panels use), subscribes to given topics, debounces ~300ms, refetches on breadcrumb + visibility/focus/online, with a 60s fallback. Returns nothing; takes per-topic callbacks.

- **Guest menu (`app/menu/page.tsx`):** `useRealtime({ menu: refreshMenu })`. `refreshMenu` re-runs `getMenuItems()`/`getCategories()`/`getFilters()` and reconciles into state **keyed by dish id** (React keys keep scroll/position stable; sold-out flips a badge, it doesn't remove the card). Newly added dishes appear; removed dishes show unavailable rather than disappearing mid-view.
- **Features live:** add `refreshFeatures()` to `lib/features.ts` that busts the module cache, re-fetches `getSettings()`, and notifies live `useFeatures()` subscribers (subscriber Set or a `window` event the hook listens to). Guest `useRealtime` calls it on a `menu`/settings breadcrumb so maintenance + feature toggles go live.

### Resilience (already present, keep)
Websocket drop → 60s slow poll; reconnect/visibility/focus/online → debounced refetch. Guests get focus-refetch so returning to a tab always shows current state.

## Trade-offs (honest)
- **Added:** one websocket per guest tab (idle almost always; Supabase Realtime is built for this) + 5 new triggers (microseconds on rare content writes).
- **Saved:** admin stops ~180 req/min. **Net DB load drops.**
- **Subtlety:** `settings` is a single rarely-changed row, so a whole-table trigger is safe (no heartbeat-spam like sessions had).

## Build order
1. Migration 066 (triggers + auto_approve) — apply via Management API.
2. `realtime.js` per-topic handlers (backward compatible).
3. Editor handler split (ops→pollOrders, menu→loadAll).
4. Kitchen + tablet: add `"menu"` topic.
5. `lib/useRealtime.ts` hook.
6. Guest menu: gentle reconcile + `refreshFeatures()`.
7. Admin: replace polling with hook.

## Verification plan (check 4–5×, agents + browser)
- **Type-check:** `npm run lint` clean.
- **Migration applied:** confirm triggers exist + a content edit inserts a `menu`-topic breadcrumb (SQL check).
- **Multi-tab E2E (Chrome DevTools MCP / Playwright):** two tabs side by side — edit a dish in editor → kitchen/tablet/guest reflect within ~1s; toggle sold-out in kitchen → guest shows "Sold out"; toggle auto_approve → editor+guest both update; toggle a feature flag in admin → guest menu reflects; place order in tablet → kitchen pops.
- **Load check:** confirm admin no longer fires per-second requests (network panel); confirm websocket frames carry only breadcrumbs.
- **Regression:** `node scripts/verify-cache.mjs` still passes (3D untouched, but confirm).
- **Independent verifier:** run `work-checker` agent on the final diff.
