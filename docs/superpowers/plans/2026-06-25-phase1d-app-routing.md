# Phase 1d — Guest app: per-restaurant routing & threading

> Executed against the **dev sandbox** (`lfh-saas-dev`), verified in a browser before any
> production cutover. The DB layer (078–086) is already done. Goal of this phase: serve each
> restaurant's own menu at its own URL, with `restaurant_id` threaded through the guest data
> layer, RPC calls, features, and realtime — restaurant #1 keeps working unchanged.

**Goal:** A guest visiting `/r/<slug>/menu` sees THAT restaurant's menu/theme/features; QR codes
encode `/r/<slug>/t/<table>`; everything the guest does is scoped to that restaurant.

**Keystone idea:** Resolve the restaurant ONCE at the route boundary (slug → restaurant row),
put it in a context/prop, and thread its `id` into every data call + RPC the guest page makes.

---

## Slices (each: build → type-check → verify against sandbox)

### Slice 1 — Tenant resolver + verify current app on migrated schema
- **First, de-risk the cutover:** repoint the worktree `.env.local` `NEXT_PUBLIC_SUPABASE_URL` /
  `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` at the `SUPABASE_DEV_*` values, run the app, and confirm
  the EXISTING `/menu` still works against the 078–086 sandbox (proves migrations are non-breaking).
- `lib/tenant.ts`: add `getRestaurantBySlug(slug)` → `{id, slug, name, active}` via a cached anon
  query on `restaurants`; keep `DEFAULT_RESTAURANT_ID`. Server-side helper.

### Slice 2 — Routing `/r/[restaurant]/…`
- `app/r/[restaurant]/menu/page.tsx` (+ `item/[slug]`, mirror of `/view`): async `params`, resolve
  slug → restaurant; `notFound()` if unknown/inactive. Pass `restaurantId` down.
- `/menu` (bare) → redirect to `/r/<DEFAULT_RESTAURANT_SLUG>/menu` (keeps #1 working; old QR/links live).
- QR target: `/r/<slug>/t/<table>` — read `t` and seed the table into the session flow.

### Slice 3 — Data layer scoped (`lib/menu.ts`)
- Add `restaurantId` arg to `getMenuItems` / `getMenuItem` / `getCategories` / `getFilters` /
  `getSettings`; add `.eq("restaurant_id", restaurantId)`. Update callers to pass the resolved id.
  (`item_ratings` view read in `getMenuItem` → also filter by restaurant or join through menu_items.)

### Slice 4 — Features scoped (`lib/features.ts`)
- `getFeatures(restaurantId)` / `useFeatures(restaurantId)` read settings for that restaurant; make the
  `localStorage` cache key per-restaurant (`lfh_features:<rid>`) — fixes the stale-toggle bug too.

### Slice 5 — Guest RPC calls pass restaurant_id
- Where the guest app calls table/phone/slug RPCs (`lfh_open_session`, `lfh_join_session`,
  `lfh_table_status`, `lfh_request`, `lfh_place_order_public`, `lfh_call_waiter_table`,
  `lfh_submit_review`, `lfh_send_otp`, `lfh_recognize_customer`), pass `p_restaurant_id` = resolved id.
  Token/order RPCs (`lfh_place_order`, `lfh_call_waiter`, `lfh_session_state`, …) need NO change (derive).

### Slice 6 — Realtime scoped (`lib/useRealtime.ts`)
- Add `restaurant_id=eq.<rid>` to the `realtime_events` postgres-changes filter so a restaurant only
  receives its own breadcrumbs. (Breadcrumbs already carry `restaurant_id` from 086.)

### Slice 7 — Verify in browser (sandbox)
- Seed a 2nd restaurant on the sandbox (a few items). Confirm: `/r/french-house/menu` shows #1's menu;
  `/r/<slug2>/menu` shows the 2nd's, fully separate; placing an order in each lands under the right
  restaurant (check via the dev API). Screenshot both.

---

## Out of scope here (follow-on phases)
- **Staff panels** (`/manager` `/kitchen` `/tablet` `/aevinite`) need a restaurant context + the API
  handlers passing `p_restaurant_id` to the staff RPCs → **Phase 1d-staff**.
- **7 demo restaurants** with different cuisines → **Phase 1e**.
- **Production cutover** (migrate prod DB 078–086 + deploy) → final step, per SAAS-BUILD-STATUS.md.

## Safety
All on the branch + sandbox. Type-check (`npm run lint`) each slice. Don't merge to main until the
full cutover sequence in SAAS-BUILD-STATUS.md is followed and verified.
