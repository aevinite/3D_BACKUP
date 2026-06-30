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

## Phase 2 — Branding editor in the admin panel (full theme palette)

**Theme model — full palette, derived everything (owner choice 2026-06-30).**
The menu's look reduces to four meaningful colours; all other tokens (glows, gradients, borders, dim/muted variants, button fills) are *derived* from them in `AppShell.accentVars()`:
- `background` → `--bg`
- `card / surface` → `--card`
- `text` → `--text` (plus a derived `--muted`)
- `accent` → `--accent` / `--gold` and all their derived gradients/glows (existing logic)

The admin sets these four; the derivation recolours the **whole** menu, not just one pill. Each colour is editable **both** by a colour picker **and** a hex-code text field (e.g. `#1a0f09`), validated. Live preview updates as you type.

**Light AND dark mode — each themed separately (owner choice 2026-06-30).** The guest menu has a light/dark toggle, and each mode has its own `--bg/--card/--text/--accent` today. The editor lets the admin set a palette for **each mode**, and the guest's toggle picks the matching one.

**Storage.** Reuse existing columns: `accent_color` (a sensible default/legacy accent) + the already-present unused `theme jsonb`, shaped as:
```json
{ "dark":  { "bg": "#…", "card": "#…", "text": "#…", "accent": "#…" },
  "light": { "bg": "#…", "card": "#…", "text": "#…", "accent": "#…" } }
```
Additive, no migration needed for Phase 2. Any missing mode/colour → fall back to the current derived-from-`accent_color` / default behaviour (so #1 and any un-themed tenant are unaffected). Per-mode keys are independent: theming only dark still leaves light on its sensible default.

**Render.** Extend `AppShell.accentVars()` (and the light-mode block) to merge the matching mode's `theme` overrides on top of the accent-derived base: when a mode's `bg`/`card`/`text`/`accent` are set, emit `--bg`/`--card`/`--text`/`--accent` (and derive `--muted`, glows, gradients from them) **scoped to that mode** (`:root` dark vs the light-mode selector). Keep the `isDefault` guard so restaurant #1 keeps its hand-tuned values in both modes. `lib/tenant.ts` returns the full `theme` object alongside `accentColor`.

**API**
- New admin-gated action `update_branding` (POST) on `app/api/admin/restaurants/route.ts`: accepts `{ restaurant_id, accent_color?, theme?: { dark?: {bg?,card?,text?,accent?}, light?: {bg?,card?,text?,accent?} }, hero_title?, tagline?, logo_text? }`. Validate every colour as a hex string (`#rgb`/`#rrggbb`); length-cap text. Write `accent_color`, `theme`, and the text columns on `restaurants`. Bust the cached tenant bundle so guests see changes within seconds.

**UI**
- In `/aevinite/restaurants`, each restaurant row gets an **"Edit branding"** action opening a panel with a **Dark / Light mode switch** at the top; under each mode, four colour controls (picker + hex input each) for background / card / text / accent. A **live preview** card (a sample menu tile + pill + text) recolours in real time and reflects the mode being edited. Below: text inputs for hero title, tagline/greeting, logo text. A soft contrast hint if text-on-background is hard to read (warn, don't block). Register the panel/drawer in the back-button manager.

**Verify**
- Set Demo Bistro to a distinct full palette in **both** modes (e.g. dark: teal bg / cream text / magenta accent; light: pale mint bg / charcoal text / magenta accent) + custom hero/tagline. On its guest menu, toggling light/dark switches between the two custom palettes and recolours **everywhere** — background, cards, text, pills, glows, gradients — with the matching hero/greeting. Hex-typed values apply identically to picker values. **Zero** "Little French House" text or gold in either mode. Restaurant #1 unchanged in both modes. Test desktop + ~390px.

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
