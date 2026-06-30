# No-Code Restaurant Builder — Design

**Date:** 2026-06-30
**Status:** Approved (Approach A, admin-only, phased)
**Goal:** Let the admin spin up a complete, genuinely-different restaurant entirely from the website (`/aevinite`) — starter menu, theme colour, hero text, and a logo image — with **no code changes**. Success = the admin alone can create, brand, and run a new restaurant end-to-end.

---

## Context (current state, verified 2026-06-30)

- **Create flow:** `app/aevinite/restaurants/page.tsx` → `POST /api/admin/restaurants?action=create_restaurant` (`app/api/admin/restaurants/route.ts`). It inserts a `restaurants` row, a `settings` row cloned from restaurant #1, and one starter login per enabled panel. **It does NOT seed any menu — a new restaurant starts empty.**
- **Menu editing already works** per-restaurant from the manager panel (`public/panels/editor/app.js` + `app/api/editor/[...path]/route.ts`): items / categories / filters upsert, scoped by `restaurant_id`, gated by `managerCan(..., "edit_menu")` (owner always allowed).
- **Branding columns already exist** (`supabase/migrations/087_restaurant_branding.sql`): `restaurants.logo_text`, `hero_title`, `tagline`, `accent_color`, `theme jsonb`. They are **rendered** (`lib/tenant.ts` → `MenuView` → `AppShell.accentVars()`, `HeroTitle`, `IntroSplash`, `Header`) but there is **no UI to set them**.
- **Logo image:** only restaurant #1 shows an image, hardcoded as `/lfh-logo.png` in `IntroSplash.tsx` (`isDefault && <img src={LOGO}>`). Other tenants render text only. There is **no `logo_url` column** and **no file-upload route** anywhere in `app/` or `lib/`.
- **#1-leak guard:** `MenuView` computes `isDefault = restaurantId === DEFAULT_RESTAURANT_ID` and only passes custom branding for non-default tenants, keeping #1's hand-tuned look intact. All new rendering MUST preserve this.

### Starter menu source
- `/Users/aevinite/Documents/Projects/DEMO_3DMENU/public/content/menu.json`: `{ categories: 9, filters: 10, items: 72 }`.
- Item **images** are external public URLs (Unsplash / TheMealDB) → reachable from this app, no copying.
- Only **2 of 72** items reference 3D, via **relative** paths (`/models/*.glb`) that live in the DEMO project and are **not** reachable here → the seed **strips all 3D fields** (`is4d=false`, model URLs/folder cleared). New restaurants start as a 2D image menu; 3D can be added per dish later from the panel.
- The file uses **camelCase** (`modelOptimizedUrl`, `longDescription`); the DB uses **snake_case**. Reuse the existing mapping in `scripts/seed-supabase.mjs` `toRow()`.

---

## Architecture decision

**Approach A (chosen): bundle the demo menu as a static starter file in this repo.**
Copy the demo `menu.json` into `public/content/starter-menu.json`. On create-with-toggle-ON, the server reads that file and inserts categories + filters + items scoped to the new `restaurant_id`.

- Rejected **B** (hidden template tenant cloned per-create): extra phantom restaurant, more complexity now; good future upgrade for an editable template (YAGNI).
- Rejected **C** (pull live from DEMO's separate Supabase): cross-project DB coupling, extra egress, fragile.

---

## Phase 1 — Starter-menu toggle at creation

**Data / files**
- Add `public/content/starter-menu.json` = the demo menu (categories, filters, items), 3D fields removed at build-time of the file or stripped in code (code-strip is safer/idempotent).
- New server helper `lib/starterMenu.ts`: loads + validates the file, maps camelCase→snake_case, strips 3D, stamps `restaurant_id`, returns `{ categories, filters, items }` ready to upsert.

**API**
- Extend `create_restaurant` in `app/api/admin/restaurants/route.ts` to accept `seedMenu: boolean` (default `true`). After the `restaurants` + `settings` + logins succeed, if `seedMenu`, bulk-insert categories → filters → items (scoped to the new `rid`), using upsert `onConflict` matching existing per-tenant uniqueness (`restaurant_id,slug` for categories/filters; `id` or `restaurant_id,slug` for items). Wrap in try/catch so a menu-seed failure does **not** orphan the created restaurant — report partial success clearly.
- Egress-safe: bulk insert in batches; no whole-table reads; everything scoped by `rid`.

**UI**
- `app/aevinite/restaurants/page.tsx` create modal: add a shadcn-style switch **"Start with sample menu"** (default ON). Send `seedMenu` in the POST body.

**Verify (live, both desktop + ~390px)**
- Create "Demo Bistro" from `/aevinite` with toggle ON. Guest menu at `/r/<slug>/menu?table=1` renders 72 dishes across 9 categories, 10 filter chips; images load; no 3D buttons; no console errors.
- Manager panel for that restaurant: add a dish, edit one, delete one — all persist and appear on the guest menu.
- Create a second restaurant with toggle OFF → empty menu (no leakage of Demo Bistro's or #1's dishes).

---

## Phase 2 — Branding editor in the admin panel

**API**
- New action `update_branding` (POST) or `PATCH` on `app/api/admin/restaurants/route.ts`, admin-gated: accepts `{ restaurant_id, accent_color?, hero_title?, tagline?, logo_text? }`, validates (hex colour format; length caps on text), writes the columns on `restaurants`. Bust any cached tenant bundle so guests see changes within seconds.

**UI**
- In `/aevinite/restaurants`, each restaurant row gets an **"Edit branding"** action opening a panel: colour picker (accent), text inputs for hero title, tagline/greeting, logo text. Live preview swatch. Register the panel/drawer in the back-button manager.

**Verify**
- Set Demo Bistro accent to a distinct colour + custom hero/tagline. Its guest menu shows the new accent on pills, glow, background wash, and the new hero/greeting text. **Zero** "Little French House" text or gold anywhere. Restaurant #1 unchanged (still its gold + LFH hero). Test desktop + ~390px.

---

## Phase 3 — Logo image upload (intro splash + search bar)

**Data**
- Migration: `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_url text;` (additive, nullable, default NULL → existing restaurants unaffected).
- Supabase Storage bucket `branding` (public read), path `branding/<restaurant_id>/logo.<ext>`.

**API**
- New admin-gated upload route (e.g. `POST /api/admin/restaurants/logo`): accepts an image (PNG/JPG/WEBP/SVG), size cap (e.g. ≤ 1 MB), uploads to Storage via the service role, writes `restaurants.logo_url`. Returns the public URL. Reject non-image / oversize with a clear message.

**Rendering (preserve the #1-leak guard)**
- `lib/tenant.ts`: include `logoUrl` in `getRestaurantBySlug`.
- `MenuView` → pass `logoUrl` (for non-default tenants) into `AppShell` → `IntroSplash` and `Header`.
- `IntroSplash.tsx`: show `<img>` when a `logoUrl` is present (for ANY tenant), else current behaviour (#1 keeps `/lfh-logo.png`; others show text). 
- `Header.tsx`: render the logo image next to the search/magnifying-glass area when `logoUrl` present; else the styled name.
- Admin branding panel (Phase 2) gains the upload control.

**Verify**
- Upload a logo for Demo Bistro → appears on its opening splash AND next to its search bar, at desktop + ~390px. Restaurant #1 still shows its own logo. A restaurant with no logo shows its styled name (no broken image). No console errors; egress unaffected (logo served from Storage CDN, not the DB).

---

## Cross-cutting requirements (apply to all phases)

- **Admin-gated** (`tokenIsValid` / existing admin gate); every query scoped by `restaurant_id`; explicit column lists + limits on any read; no whole-table scans.
- **No #1 branding leak** onto other tenants (text, colour, logo, hero). Verify each phase.
- **Realtime/egress:** no new poll faster than the 60s backstop; the menu-cache bust already exists — reuse it.
- **Back-button manager:** register every new popup/drawer/modal.
- **UI:** shadcn-style, beginner-simple; verified live (Chrome) at desktop and ~390px — never "done from source alone."
- **Phased delivery:** each phase = its own branch + PR, merged to `main` only after live verification; production stays deployable.

## Out of scope (explicit)
- Owner self-service branding (admin-only for now).
- Editable starter-menu template from UI (future Approach-B upgrade).
- Seeding 3D models for the starter menu (added per-dish later).
- Subdomain routing (path-based stays the source of truth).

## Risks & mitigations
- *Menu-seed partial failure* → wrap seed in try/catch after restaurant creation; surface partial success; restaurant still usable + editable.
- *Duplicate slugs across re-seeds* → rely on per-tenant uniqueness (`restaurant_id,slug`) + upsert onConflict.
- *Logo upload abuse / huge files* → type + size validation server-side; service-role upload only.
- *#1 regression* → keep `isDefault` guard; explicit "verify #1 unchanged" step in Phases 2 & 3.
