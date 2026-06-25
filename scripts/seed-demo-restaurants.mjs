// scripts/seed-demo-restaurants.mjs
// SANDBOX-ONLY demo seeder: adds extra restaurants (distinct cuisines) to the
// dev sandbox so the multi-restaurant UI can be demonstrated.
//
// It reads ONLY the SUPABASE_DEV_* keys from .env.local, so it physically cannot
// touch production. Run:  node scripts/seed-demo-restaurants.mjs
//
// Structure is data-driven (DEMO[] below) so adding more cuisines later is trivial.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function parseEnv(t) {
  const o = {};
  for (const l of t.split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}
const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const URL_ = env.SUPABASE_DEV_URL;
const SERVICE = env.SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  throw new Error("Missing SUPABASE_DEV_URL / SUPABASE_DEV_SERVICE_ROLE_KEY — this seeder is sandbox-only and refuses to run without them.");
}
console.log("▶ DEV sandbox target:", URL_);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const R1 = "00000000-0000-0000-0000-000000000001"; // existing French House
const PIZZA = "00000000-0000-0000-0000-000000000002";

// Reuse real, guaranteed-loading image URLs + a settings template from restaurant #1.
const { data: imgRows } = await db.from("menu_items").select("image").eq("restaurant_id", R1).limit(24);
const IMAGES = (imgRows || []).map((r) => r.image).filter(Boolean);
const img = (i) => (IMAGES.length ? IMAGES[i % IMAGES.length] : "");
const { data: s1 } = await db.from("settings").select("*").eq("restaurant_id", R1).maybeSingle();

const DEMO = [
  {
    restaurant: { id: PIZZA, slug: "pizza-palace", name: "Pizza Palace", active: true, logo_text: "Pizza Palace", hero_title: "Wood-Fired Pizzeria", tagline: "BUONASERA", accent_color: "#c0392b" },
    heroImg: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=500&q=60",
    categories: [
      { slug: "pizzas", name: { en: "Pizzas" }, icon: "fa-solid fa-pizza-slice", color: "#d97706", sort_order: 0, active: true },
      { slug: "sides", name: { en: "Sides" }, icon: "fa-solid fa-bowl-food", color: "#16a34a", sort_order: 1, active: true },
      { slug: "drinks", name: { en: "Drinks" }, icon: "fa-solid fa-glass-water", color: "#0ea5e9", sort_order: 2, active: true },
      { slug: "desserts", name: { en: "Desserts" }, icon: "fa-solid fa-ice-cream", color: "#db2777", sort_order: 3, active: true },
    ],
    filters: [
      { slug: "bestseller", name: { en: "Bestseller" }, icon: "⭐", sort_order: 0, active: true },
      { slug: "vegetarian", name: { en: "Veg" }, icon: "🌿", sort_order: 1, active: true },
      { slug: "spicy", name: { en: "Spicy" }, icon: "🌶️", sort_order: 2, active: true },
      { slug: "new", name: { en: "New" }, icon: "🆕", sort_order: 3, active: true },
    ],
    // [slug, title, price, category, veg, tags]
    items: [
      ["margherita-pizza", "Margherita Pizza", "299", "pizzas", true, ["bestseller", "vegetarian"]],
      ["pepperoni-pizza", "Pepperoni Pizza", "399", "pizzas", false, ["bestseller"]],
      ["veggie-supreme-pizza", "Veggie Supreme Pizza", "349", "pizzas", true, ["vegetarian"]],
      ["bbq-chicken-pizza", "BBQ Chicken Pizza", "429", "pizzas", false, ["spicy"]],
      ["four-cheese-pizza", "Four Cheese Pizza", "379", "pizzas", true, ["vegetarian", "new"]],
      ["garlic-bread", "Garlic Bread", "149", "sides", true, ["vegetarian"]],
      ["cheesy-garlic-sticks", "Cheesy Garlic Sticks", "179", "sides", true, ["vegetarian", "bestseller"]],
      ["buffalo-chicken-wings", "Buffalo Chicken Wings", "249", "sides", false, ["spicy"]],
      ["classic-cola", "Classic Cola", "60", "drinks", true, []],
      ["fresh-lime-soda", "Fresh Lime Soda", "80", "drinks", true, ["new"]],
      ["choco-lava-cake", "Choco Lava Cake", "129", "desserts", true, ["bestseller"]],
      ["tiramisu", "Tiramisu", "159", "desserts", true, []],
    ],
  },
];

for (const d of DEMO) {
  const rid = d.restaurant.id;
  let e;
  ({ error: e } = await db.from("restaurants").upsert(d.restaurant, { onConflict: "id" }));
  if (e) throw new Error("restaurants: " + e.message);

  if (s1) {
    const s = { ...s1, id: d.restaurant.slug, restaurant_id: rid };
    ({ error: e } = await db.from("settings").upsert(s, { onConflict: "id" }));
    if (e) throw new Error("settings: " + e.message);
  }

  ({ error: e } = await db.from("categories").upsert(d.categories.map((c) => ({ ...c, restaurant_id: rid })), { onConflict: "restaurant_id,slug" }));
  if (e) throw new Error("categories: " + e.message);

  ({ error: e } = await db.from("filters").upsert(d.filters.map((f) => ({ ...f, restaurant_id: rid })), { onConflict: "restaurant_id,slug" }));
  if (e) throw new Error("filters: " + e.message);

  const items = d.items.map(([slug, title, price, category, veg, tags], i) => ({
    restaurant_id: rid,
    id: `${d.restaurant.slug}-${slug}`,
    slug,
    title,
    price,
    image: d.heroImg || img(i),
    category,
    veg,
    is4d: false,
    sort_order: i,
    tags,
    allergens: [],
    description: `${title} — freshly made at ${d.restaurant.name}.`,
  }));
  ({ error: e } = await db.from("menu_items").upsert(items, { onConflict: "id" }));
  if (e) throw new Error("menu_items: " + e.message);

  console.log(`✓ ${d.restaurant.name}: ${d.categories.length} categories, ${d.filters.length} filters, ${items.length} items`);
}

const { count } = await db.from("menu_items").select("*", { count: "exact", head: true }).eq("restaurant_id", PIZZA);
console.log("pizza-palace menu_items now in sandbox:", count);
console.log("Done.");
