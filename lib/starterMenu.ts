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
  time: string | null; nutrition: unknown; ingredients: unknown;
  related_slugs: unknown; tags: string[]; allergens: unknown[];
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
    // No `rating` / `reviews` here: migration 359 dropped both columns. A dish's stars come from
    // real customer reviews (the `reviews` table via the `item_ratings` view, migrations 030/116),
    // so a brand-new restaurant correctly starts with no ratings rather than empty placeholders.
    time: item.time ?? null,
    nutrition: item.nutrition ?? null,
    ingredients: item.ingredients ?? null,
    related_slugs: item.relatedSlugs ?? null,
    tags: item.tags ?? (item.veg ? ["veg"] : ["non-veg"]),
    allergens: item.allergens ?? [],
    sort_order: i,
  }));
}
