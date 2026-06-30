# Aangan Garden Restaurant — Setup (Part A) Design

**Date:** 2026-06-30
**Status:** Approved (decisions confirmed with owner)
**Restaurant:** AANGAN GARDEN RESTAURANT — slug `aangan-garden-restaurant`, id `6c6fadb6-da23-4ab3-9f90-d164773f60b3`. Pure-veg, Ahmedabad (Bopal/Ambli). Currently empty (no menu, no branding, panels M+K+T).

**Goal:** Make Aangan a real, sellable restaurant: a curated menu (~7-8 items per category, every category), its own dark-navy/gold/orange branding + logo, panels limited to **manager + tablet** (no kitchen), and a working **KOT** that shows on the manager panel **and prints** from it.

Part B (tablet phone-responsive redesign) is a SEPARATE spec, built after this.

---

## Source
`/Users/aevinite/Downloads/Menu.pdf` (16 pages). All items veg. Branding: dark slate-navy bg (~`#2d3142`), gold headings (~`#c79a3e`), lime-green sub-labels, **orange "Aangan" wordmark (~`#e8772e`)**, brown band. Logo: palm trees + garden huts + sunset + "Aangan Garden Restaurant" (page 1). Footer: Jain option, takeaway, "order can't be cancelled", "service 20-25 min", phone +91 98984 75101.

## 1. Menu seed (~7-8 per category, all categories)
- **File:** `public/content/aangan-menu.json` — `{ categories[], filters[], items[] }`, same shape as `starter-menu.json`. All items `veg:true`, no 3D, real PDF prices, short descriptions from the PDF, `tags` incl. `veg` (+ `bestseller` on the "Aangan Special" items).
- **Categories (22)** with curated counts: Beverages(8), Soups(8), Salads(7), Sides "Khane Ke Saath"(7), Starters Mexican/Italian(8), Tandoor Starters(8), Sizzlers(5), Mexican Rice(2), Chinese Starters(8), Pasta(7), Sandwich(4), Pizza(6), China Town noodles/rice(8), Thai(2), Paneer mains(8), Kaju & Cheese(4), Indian Delicacies(8), Kofta(5), Indian Bread(8), Dal(6), Rice/Biryani(7), Dessert(6). Small categories include all items; large ones a curated 7-8 (always include the "Aangan Special").
- **Seed script:** `scripts/seed-aangan.mjs` — reads the file, maps camelCase→snake_case + stamps Aangan's `restaurant_id` + generates unique `menu_items.id` (reuse the `lib/starterMenu.ts` pattern; 3D stripped), upserts categories→filters→items scoped to Aangan (`onConflict restaurant_id,slug` / unique id). Idempotent. One-off data seed (NOT the create-restaurant default — that stays the demo).
- **Filters:** veg, bestseller, jain (Jain option noted on the PDF), plus a couple (spicy, chefs-special). Dishes tagged accordingly.

## 2. Branding (its own identity; uses the Phase-2/3 tools)
- Via `restaurants` columns (`update_branding` route): `accent_color` = Aangan orange `#e8772e`; `theme` jsonb:
  - dark: `{ bg:#22242e, card:#2d3142, text:#f3ece0, accent:#e8772e }`
  - light: `{ bg:#faf6ee, card:#ffffff, text:#2d3142, accent:#e8772e }`
- `hero_title` = `Aangan *Garden*` (uses the new `*accent*` split → "Garden" in orange), `tagline` = `PURE VEG` (or "Welcome to Aangan"), `logo_text` = `Aangan *Garden*`.
- **Logo image:** crop the palm-garden logo from PDF page 1 → upload via the Phase-3 logo route (POST `/api/admin/restaurants/logo`) so it shows on the splash + search bar. Replaceable later.

## 3. Panels
- Set `settings.enabled_panels` for Aangan to `{ manager:true, tablet:true, kitchen:false, owner:false }` via the admin panels route (`/api/admin/restaurants/panels`). Kitchen login blocked; tablet+manager only.

## 4. KOT on the manager panel (small new feature — no kitchen screen)
KOTs are already generated (daily `kot_no`) and shown on the manager panel. Add **printing** to the manager panel since there's no kitchen screen:
- **Auto-print on new order:** mirror the kitchen panel's auto-print (hidden-iframe, printer-agnostic compact KOT, fires once per brand-new order via a `knownIds` guard) into the **manager** panel (`public/panels/editor/app.js`), gated by the SAME entitlement chain: admin `settings.auto_print_kot_allowed` + owner `settings.auto_print_kot`. Never prints the existing board on open; never double-prints. Wrapped so it can't break the board.
- **Manual "Print KOT" button** on each order card (always available) → prints the same compact KOT for that order.
- For Aangan: turn the admin allow ON + owner toggle ON so auto-print is active.
- Reuse the existing KOT layout/util from the kitchen panel (extract the shared print function so kitchen + manager render identical tickets — DRY).

## Out of scope (Part A)
- Tablet phone redesign (Part B).
- Owner panel (off).
- Online-ordering / payments.

## Verification (live, desktop + ~390px, zero console errors)
- Aangan guest menu `/r/aangan-garden-restaurant/menu?table=1`: all categories render with their curated items + prices; navy/orange theme; "Aangan **Garden**" hero (Garden orange); logo on splash + search bar; no #1 leak; veg badges.
- Admin panels show Aangan = manager+tablet only; kitchen login blocked.
- Manager panel for Aangan: a new order shows its KOT, auto-prints (with allow+toggle on), and the manual Print KOT button works. Bills still work.
- #1 and other restaurants unaffected by the manager auto-print addition (gated off by default).

## Risks
- Logo crop from PDF may be rough → user can re-upload (Phase-3 control). 
- Manager auto-print must default OFF for every other restaurant (gated by the two flags) — verify #1/others don't suddenly print.
- Big seed (~150 rows) → batch the upsert; scoped to Aangan only.
