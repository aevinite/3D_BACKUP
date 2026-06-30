# Phase 1 — Starter-Menu Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the admin creates a restaurant from `/aevinite`, a "Start with sample menu" toggle (default ON) seeds a full starter menu (categories + filters + dishes) into the new restaurant, scoped to its `restaurant_id`.

**Architecture:** Bundle the demo menu as a static repo file (`public/content/starter-menu.json`). A pure mapper module (`lib/starterMenu.ts`) converts that file's camelCase entries into snake_case DB rows for a given `restaurant_id`, stripping all 3D fields and generating a unique `menu_items.id` per item. The `create_restaurant` API action calls the mapper and bulk-inserts when `seedMenu` is true. The create modal gains the toggle.

**Tech Stack:** Next.js 16 route handler, Supabase service role (`lib/supabaseAdmin`), TypeScript, Node built-in test runner (`node --test`) for the pure mapper.

---

## File Structure

- **Create** `public/content/starter-menu.json` — the bundled demo menu (copied from `/Users/aevinite/Documents/Projects/DEMO_3DMENU/public/content/menu.json`). Static seed source.
- **Create** `lib/starterMenu.ts` — pure functions that load + map the starter menu into DB-ready rows for a given `restaurant_id`. One responsibility: turn the file into rows. No DB calls (testable in isolation).
- **Create** `lib/starterMenu.test.mjs` — node test for the mapper (3D stripped, snake_case, unique ids, scoped rid).
- **Modify** `app/api/admin/restaurants/route.ts` — `create_restaurant` accepts `seedMenu` (default true); after settings succeed, seed categories → filters → items via the mapper.
- **Modify** `app/aevinite/restaurants/page.tsx` — add the "Start with sample menu" toggle to the create modal; send `seedMenu` in the POST body.

---

### Task 1: Bundle the starter menu file

**Files:**
- Create: `public/content/starter-menu.json`

- [ ] **Step 1: Copy the demo menu into this repo**

```bash
cp /Users/aevinite/Documents/Projects/DEMO_3DMENU/public/content/menu.json \
   /Users/aevinite/Documents/Projects/backup_Menu/public/content/starter-menu.json
```

- [ ] **Step 2: Verify shape (categories/filters/items present)**

Run:
```bash
node -e "const d=require('./public/content/starter-menu.json'); console.log('cats',d.categories.length,'filters',d.filters.length,'items',d.items.length)"
```
Expected: `cats 9 filters 10 items 72`

- [ ] **Step 3: Commit**

```bash
git add public/content/starter-menu.json
git commit -m "feat(seed): bundle demo menu as starter-menu.json"
```

---

### Task 2: Pure mapper module `lib/starterMenu.ts`

**Files:**
- Create: `lib/starterMenu.ts`
- Test: `lib/starterMenu.test.mjs`

**Interface (what this module exposes):**
- `loadStarterMenu(): StarterMenu` — reads + JSON-parses `public/content/starter-menu.json`.
- `toCategoryRows(menu, restaurantId): CategoryRow[]`
- `toFilterRows(menu, restaurantId): FilterRow[]`
- `toItemRows(menu, restaurantId): ItemRow[]` — strips 3D, generates unique `id`.

- [ ] **Step 1: Write the failing test**

Create `lib/starterMenu.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStarterMenu, toCategoryRows, toFilterRows, toItemRows } from "./starterMenu.ts";

const RID = "11111111-1111-1111-1111-111111111111";

test("loadStarterMenu returns categories, filters, items", () => {
  const m = loadStarterMenu();
  assert.ok(m.categories.length >= 1);
  assert.ok(m.filters.length >= 1);
  assert.ok(m.items.length >= 1);
});

test("category rows are scoped + snake_case", () => {
  const rows = toCategoryRows(loadStarterMenu(), RID);
  for (const r of rows) {
    assert.equal(r.restaurant_id, RID);
    assert.ok(typeof r.slug === "string" && r.slug.length > 0);
    assert.ok("sort_order" in r);
    assert.equal(r.active, true);
  }
});

test("filter rows are scoped + snake_case", () => {
  const rows = toFilterRows(loadStarterMenu(), RID);
  for (const r of rows) {
    assert.equal(r.restaurant_id, RID);
    assert.ok(typeof r.slug === "string" && r.slug.length > 0);
    assert.ok("sort_order" in r);
  }
});

test("item rows: scoped, snake_case, 3D stripped, unique ids", () => {
  const rows = toItemRows(loadStarterMenu(), RID);
  const ids = new Set();
  for (const r of rows) {
    assert.equal(r.restaurant_id, RID);
    assert.equal(r.is4d, false);
    assert.equal(r.model_folder, null);
    assert.equal(r.model_small_url, null);
    assert.equal(r.model_optimized_url, null);
    assert.ok(typeof r.id === "string" && r.id.length > 0);
    assert.ok(!ids.has(r.id), "ids must be unique");
    ids.add(r.id);
    assert.ok(typeof r.slug === "string" && r.slug.length > 0);
    assert.ok("sort_order" in r);
  }
  // ids must NOT equal the source slug (would collide across restaurants)
  assert.ok(rows.every((r) => r.id !== r.slug));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --experimental-strip-types lib/starterMenu.test.mjs`
Expected: FAIL — `Cannot find module './starterMenu.ts'` (module not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/starterMenu.ts`:

```ts
// Loads the bundled demo menu and maps it into DB-ready, restaurant-scoped rows.
// Pure (no DB): used by the admin create_restaurant route to seed a new tenant.
// Mirrors the snake_case mapping in scripts/seed-supabase.mjs, but: (a) scopes every
// row to the GIVEN restaurant_id, (b) strips ALL 3D fields (the demo's relative
// /models/*.glb paths don't exist here), and (c) generates a UNIQUE menu_items.id
// per item (the table's id is a TEXT primary key with no default; reusing the demo's
// slug-as-id would collide the moment a second restaurant seeds the same file).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type StarterMenu = {
  categories: any[];
  filters: any[];
  items: any[];
};

export type CategoryRow = {
  restaurant_id: string; slug: string; name: unknown;
  icon: string | null; color: string | null; sort_order: number; active: boolean;
};
export type FilterRow = {
  restaurant_id: string; slug: string; name: unknown;
  icon: string | null; sort_order: number; active: boolean;
};
export type ItemRow = {
  restaurant_id: string; id: string; slug: string; title: string;
  price: unknown; image: string | null; category: string;
  veg: boolean; is4d: false;
  model_folder: null; model_small_url: null; model_optimized_url: null;
  description: string | null; long_description: string | null;
  rating: null; time: string | null; nutrition: unknown; ingredients: unknown;
  reviews: never[]; related_slugs: unknown; tags: string[]; allergens: unknown[];
  sort_order: number;
};

export function loadStarterMenu(): StarterMenu {
  const p = join(process.cwd(), "public", "content", "starter-menu.json");
  const m = JSON.parse(readFileSync(p, "utf8"));
  return {
    categories: Array.isArray(m.categories) ? m.categories : [],
    filters: Array.isArray(m.filters) ? m.filters : [],
    items: Array.isArray(m.items) ? m.items : [],
  };
}

export function toCategoryRows(menu: StarterMenu, restaurantId: string): CategoryRow[] {
  return menu.categories.map((c: any, i: number) => ({
    restaurant_id: restaurantId,
    slug: c.slug,
    name: c.name,
    icon: c.icon ?? null,
    color: c.color ?? null,
    sort_order: c.sortOrder ?? i,
    active: c.active ?? true,
  }));
}

export function toFilterRows(menu: StarterMenu, restaurantId: string): FilterRow[] {
  return menu.filters.map((f: any, i: number) => ({
    restaurant_id: restaurantId,
    slug: f.slug,
    name: f.name,
    icon: f.icon ?? null,
    sort_order: f.sortOrder ?? i,
    active: f.active ?? true,
  }));
}

export function toItemRows(menu: StarterMenu, restaurantId: string): ItemRow[] {
  return menu.items.map((item: any, i: number) => ({
    restaurant_id: restaurantId,
    id: randomUUID(),               // globally-unique; (restaurant_id, slug) is the real key
    slug: item.slug,
    title: item.title,
    price: item.price,
    image: item.image ?? null,
    category: item.category,
    veg: item.veg ?? false,
    is4d: false,                    // 3D stripped — demo's /models/*.glb aren't reachable here
    model_folder: null,
    model_small_url: null,
    model_optimized_url: null,
    description: item.description ?? null,
    long_description: item.longDescription ?? null,
    rating: null,                   // real ratings live in the reviews table
    time: item.time ?? null,
    nutrition: item.nutrition ?? null,
    ingredients: item.ingredients ?? null,
    reviews: [],
    related_slugs: item.relatedSlugs ?? null,
    tags: item.tags ?? (item.veg ? ["veg"] : ["non-veg"]),
    allergens: item.allergens ?? [],
    sort_order: i,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test --experimental-strip-types lib/starterMenu.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json; echo "TSC=$?"`
Expected: `TSC=0`.

- [ ] **Step 6: Commit**

```bash
git add lib/starterMenu.ts lib/starterMenu.test.mjs
git commit -m "feat(seed): pure starter-menu mapper (scoped, 3D stripped, unique ids)"
```

---

### Task 3: Seed the menu in `create_restaurant`

**Files:**
- Modify: `app/api/admin/restaurants/route.ts:97-141` (the `create_restaurant` block)

- [ ] **Step 1: Add the import**

At the top of `app/api/admin/restaurants/route.ts`, after the existing imports (around line 13), add:

```ts
import { loadStarterMenu, toCategoryRows, toFilterRows, toItemRows } from "@/lib/starterMenu";
```

- [ ] **Step 2: Parse the `seedMenu` flag (default true)**

In the `create_restaurant` block, right after the `panels` object is built (after line 109), add:

```ts
    // Seed a starter menu unless the admin turned the toggle off (default ON).
    const seedMenu = body?.seedMenu !== false;
```

- [ ] **Step 3: Seed after settings succeed**

Immediately AFTER the settings upsert error check (after line 121, `if (setRes.error) return bad(...)`), and BEFORE the logins loop (line 124), insert:

```ts
    // 2b) Seed the starter menu (categories → filters → items), scoped to this restaurant.
    //     Best-effort: a seed failure must NOT orphan the already-created restaurant — we
    //     report it in the response so the admin knows, and the restaurant is still usable
    //     and editable from its manager panel. Egress-safe: scoped inserts, no reads.
    let menuSeeded = false;
    let seedError: string | null = null;
    if (seedMenu) {
      try {
        const menu = loadStarterMenu();
        const cats = toCategoryRows(menu, rid);
        const filters = toFilterRows(menu, rid);
        const items = toItemRows(menu, rid);
        if (cats.length) {
          const r1 = await sb.from("categories").upsert(cats, { onConflict: "restaurant_id,slug" });
          if (r1.error) throw new Error(r1.error.message);
        }
        if (filters.length) {
          const r2 = await sb.from("filters").upsert(filters, { onConflict: "restaurant_id,slug" });
          if (r2.error) throw new Error(r2.error.message);
        }
        if (items.length) {
          const r3 = await sb.from("menu_items").upsert(items, { onConflict: "restaurant_id,slug" });
          if (r3.error) throw new Error(r3.error.message);
        }
        menuSeeded = true;
      } catch (e) {
        seedError = e instanceof Error ? e.message : String(e);
      }
    }
```

- [ ] **Step 4: Return the seed result**

Change the final return of the `create_restaurant` block (line 140) from:

```ts
    return ok({ ok: true, id: rid, slug, name, panels, logins });
```
to:
```ts
    return ok({ ok: true, id: rid, slug, name, panels, logins, menuSeeded, seedError });
```

- [ ] **Step 5: Update the log line to note the menu**

Change line 139's `detail` to append the seed status. Replace:

```ts
    await logAction("admin", "restaurant_create", { actor: "admin", detail: `created restaurant "${name}" (${slug}) · panels ${onPanels.join("+")}` });
```
with:
```ts
    await logAction("admin", "restaurant_create", { actor: "admin", detail: `created restaurant "${name}" (${slug}) · panels ${onPanels.join("+")}${seedMenu ? (menuSeeded ? " · menu seeded" : " · menu seed FAILED") : " · no menu"}` });
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json; echo "TSC=$?"`
Expected: `TSC=0`.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/restaurants/route.ts
git commit -m "feat(admin): seed starter menu on create_restaurant (seedMenu flag, best-effort)"
```

---

### Task 4: Add the toggle to the create modal

**Files:**
- Modify: `app/aevinite/restaurants/page.tsx:116-202` (the `NewRestaurant` component)

- [ ] **Step 1: Add `seedMenu` state**

In `NewRestaurant`, after the `panels` state (line 119), add:

```tsx
  const [seedMenu, setSeedMenu] = useState(true);
```

- [ ] **Step 2: Send `seedMenu` in the POST body**

In `create()`, change the body (line 136) from:

```tsx
        body: JSON.stringify({ action: "create_restaurant", name: name.trim(), panels }),
```
to:
```tsx
        body: JSON.stringify({ action: "create_restaurant", name: name.trim(), panels, seedMenu }),
```

- [ ] **Step 3: Reset `seedMenu` after a successful create**

In `create()`, after `setPanels({ ... })` (line 140), add:

```tsx
      setSeedMenu(true);
```

- [ ] **Step 4: Render the toggle**

Immediately AFTER the panel toggle grid `</div>` (after line 174, the closing of `adm-togglegrid`), add a sample-menu toggle styled like the panel toggles:

```tsx
      <div className="adm-togglegrid" style={{ marginTop: 8 }}>
        <button className={`adm-toggle ${seedMenu ? "on" : "off"}`} disabled={busy}
          onClick={() => setSeedMenu((v) => !v)}
          title={seedMenu ? "On — a sample menu will be added" : "Off — start with an empty menu"}>
          <span>Start with sample menu</span><span className="pill">{seedMenu ? "ON" : "OFF"}</span>
        </button>
      </div>
```

- [ ] **Step 5: Show seed status in the success box**

In the `done` success block, the type currently is `{ name; slug; logins }`. Extend the `done` state type (line 122) to include the seed result:

Replace:
```tsx
  const [done, setDone] = useState<{ name: string; slug: string; logins: { panel: string; username: string; password: string }[] } | null>(null);
```
with:
```tsx
  const [done, setDone] = useState<{ name: string; slug: string; logins: { panel: string; username: string; password: string }[]; menuSeeded?: boolean; seedError?: string | null } | null>(null);
```

And in `create()`, change the `setDone(...)` (line 139) from:
```tsx
      setDone({ name: d.name, slug: d.slug, logins: d.logins || [] });
```
to:
```tsx
      setDone({ name: d.name, slug: d.slug, logins: d.logins || [], menuSeeded: d.menuSeeded, seedError: d.seedError });
```

Then, inside the `done` success box, right after the `<b>{done.name}</b> created (...)` line (after line 184), add:
```tsx
          {done.seedError ? (
            <p className="hint" style={{ margin: "6px 0", color: "var(--adm-bad, #c0392b)" }}>Menu seed failed: {done.seedError}. The restaurant was created — add dishes from its manager panel.</p>
          ) : done.menuSeeded ? (
            <p className="hint" style={{ margin: "6px 0" }}>Sample menu added — open the manager panel to edit it.</p>
          ) : null}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json; echo "TSC=$?"`
Expected: `TSC=0`.

- [ ] **Step 7: Commit**

```bash
git add app/aevinite/restaurants/page.tsx
git commit -m "feat(admin): 'Start with sample menu' toggle on the create form"
```

---

### Task 5: Live end-to-end verification (per project rules — not from source alone)

**Files:** none (verification only). Dev server runs on port 4000.

- [ ] **Step 1: Ensure dev server is up**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/menu`
Expected: `307` (redirect) or `200`. If not, start `npm run dev`.

- [ ] **Step 2: Create a restaurant WITH the toggle ON (Chrome MCP, logged into /aevinite)**

Navigate to `/aevinite/restaurants`, open "New restaurant", name it "Demo Bistro", leave "Start with sample menu" ON, create. Confirm the success box says "Sample menu added" and shows logins.

- [ ] **Step 3: Verify the guest menu renders the seeded dishes**

Open `/r/demo-bistro/menu?table=1`. Expected: ~72 dishes across 9 categories, 10 filter chips; images load; NO 3D buttons; no console errors. Capture a screenshot at desktop AND ~390px.

- [ ] **Step 4: Verify menu editing works for the new restaurant**

In the new restaurant's manager panel, add a dish, edit one, delete one. Confirm each change persists and shows on the guest menu (cache busts within seconds).

- [ ] **Step 5: Verify the toggle OFF path**

Create a second restaurant "Empty Cafe" with the toggle OFF. Open its guest menu — expect an empty menu (no dishes), and NO dishes leaked from Demo Bistro or restaurant #1.

- [ ] **Step 6: Verify restaurant #1 is untouched**

Open `/r/<#1-slug>/menu` (Little French House) — its own menu still renders exactly as before.

- [ ] **Step 7: Clean up test restaurants (optional) + record result**

If desired, deactivate/delete the test restaurants. Note the verified outcome in the PR description.

---

## Self-Review

**1. Spec coverage (Phase 1 section of the design doc):**
- "Add `public/content/starter-menu.json`" → Task 1. ✓
- "Create form gets a switch (default ON)" → Task 4. ✓
- "`create_restaurant` route, when ON, inserts categories + filters + items scoped to rid (3D stripped, camelCase→snake_case)" → Tasks 2 + 3. ✓
- "Wrap in try/catch so a menu-seed failure does not orphan the restaurant — report partial success" → Task 3 Steps 3-4. ✓
- "Egress-safe: scoped inserts, no whole-table reads" → Task 3 (upserts only, scoped). ✓
- Verify steps (create ON, guest renders 72, manager edits, toggle OFF empty, #1 untouched, desktop+390px) → Task 5. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓

**3. Type consistency:** Mapper exports (`loadStarterMenu`, `toCategoryRows`, `toFilterRows`, `toItemRows`) match between `lib/starterMenu.ts` (Task 2 Step 3), the test (Task 2 Step 1), and the route import (Task 3 Step 1). Response fields `menuSeeded` / `seedError` match between route (Task 3) and UI (Task 4). ✓

**Note on `id`:** `menu_items.id` is TEXT PK with no default; `toItemRows` generates `randomUUID()` and the test asserts `id !== slug` + uniqueness, preventing the cross-restaurant collision. Upsert uses `onConflict: "restaurant_id,slug"` (the real per-tenant key), matching migration 079.
