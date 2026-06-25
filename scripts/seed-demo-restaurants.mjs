// scripts/seed-demo-restaurants.mjs
// SANDBOX-ONLY demo seeder: adds extra restaurants (distinct cuisines) to the
// dev sandbox so the multi-restaurant UI can be demonstrated.
//
// It reads ONLY the SUPABASE_DEV_* keys from .env.local, so it physically cannot
// touch production. Run:  node scripts/seed-demo-restaurants.mjs
//
// Data-driven (DEMO[] below). Idempotent upserts — never wipes restaurant #1.
// Together with the real restaurant #1 (French House café) this gives 7 demos.

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

const R1 = "00000000-0000-0000-0000-000000000001"; // existing French House (untouched)
const { data: s1 } = await db.from("settings").select("*").eq("restaurant_id", R1).maybeSingle();

// Stable, cuisine-appropriate photos: loremflickr returns a real photo matching the
// keyword; ?lock=<n> pins a specific one so it doesn't change between loads.
let lock = 100;
const lf = (kw) => `https://loremflickr.com/600/400/${encodeURIComponent(kw)}?lock=${++lock}`;

// Shared filter set (items reference these slugs in their tags).
const FILTERS = [
  { slug: "bestseller", name: { en: "Bestseller" }, icon: "⭐", sort_order: 0, active: true },
  { slug: "vegetarian", name: { en: "Veg" }, icon: "🌿", sort_order: 1, active: true },
  { slug: "spicy", name: { en: "Spicy" }, icon: "🌶️", sort_order: 2, active: true },
  { slug: "new", name: { en: "New" }, icon: "🆕", sort_order: 3, active: true },
];
const cat = (slug, en, icon, color, i) => ({ slug, name: { en }, icon, color, sort_order: i, active: true });

// item tuple: [slug, title, price, category, veg, tags, imageKeyword]
const DEMO = [
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000002", slug: "pizza-palace", name: "Pizza Palace", active: true, logo_text: "Pizza Palace", hero_title: "Wood-Fired Pizzeria", tagline: "BUONASERA", accent_color: "#c0392b" },
    categories: [cat("pizzas", "Pizzas", "fa-solid fa-pizza-slice", "#d97706", 0), cat("sides", "Sides", "fa-solid fa-bowl-food", "#16a34a", 1), cat("drinks", "Drinks", "fa-solid fa-glass-water", "#0ea5e9", 2), cat("desserts", "Desserts", "fa-solid fa-ice-cream", "#db2777", 3)],
    items: [
      ["margherita-pizza", "Margherita Pizza", "299", "pizzas", true, ["bestseller", "vegetarian"], "margherita-pizza"],
      ["pepperoni-pizza", "Pepperoni Pizza", "399", "pizzas", false, ["bestseller"], "pepperoni-pizza"],
      ["veggie-supreme-pizza", "Veggie Supreme Pizza", "349", "pizzas", true, ["vegetarian"], "vegetable-pizza"],
      ["bbq-chicken-pizza", "BBQ Chicken Pizza", "429", "pizzas", false, ["spicy"], "bbq-pizza"],
      ["four-cheese-pizza", "Four Cheese Pizza", "379", "pizzas", true, ["vegetarian", "new"], "cheese-pizza"],
      ["garlic-bread", "Garlic Bread", "149", "sides", true, ["vegetarian"], "garlic-bread"],
      ["buffalo-wings", "Buffalo Wings", "249", "sides", false, ["spicy"], "chicken-wings"],
      ["classic-cola", "Classic Cola", "60", "drinks", true, [], "cola"],
      ["choco-lava-cake", "Choco Lava Cake", "129", "desserts", true, ["bestseller"], "chocolate-cake"],
      ["tiramisu", "Tiramisu", "159", "desserts", true, [], "tiramisu"],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000003", slug: "burger-barn", name: "Burger Barn", active: true, logo_text: "Burger Barn", hero_title: "Smashed & Stacked", tagline: "HOWDY", accent_color: "#b45309" },
    categories: [cat("burgers", "Burgers", "fa-solid fa-burger", "#b45309", 0), cat("sides", "Sides", "fa-solid fa-bowl-food", "#16a34a", 1), cat("shakes", "Shakes", "fa-solid fa-glass-water", "#db2777", 2), cat("drinks", "Drinks", "fa-solid fa-bottle-water", "#0ea5e9", 3)],
    items: [
      ["classic-cheeseburger", "Classic Cheeseburger", "199", "burgers", false, ["bestseller"], "cheeseburger"],
      ["bacon-double", "Bacon Double", "279", "burgers", false, ["bestseller"], "bacon-burger"],
      ["veggie-burger", "Veggie Burger", "179", "burgers", true, ["vegetarian"], "veggie-burger"],
      ["spicy-chicken-burger", "Spicy Chicken Burger", "229", "burgers", false, ["spicy"], "chicken-burger"],
      ["bbq-mushroom-burger", "BBQ Mushroom Burger", "209", "burgers", true, ["vegetarian", "new"], "mushroom-burger"],
      ["french-fries", "French Fries", "99", "sides", true, ["vegetarian", "bestseller"], "french-fries"],
      ["onion-rings", "Onion Rings", "119", "sides", true, ["vegetarian"], "onion-rings"],
      ["chocolate-shake", "Chocolate Shake", "149", "shakes", true, ["bestseller"], "chocolate-milkshake"],
      ["strawberry-shake", "Strawberry Shake", "149", "shakes", true, [], "strawberry-milkshake"],
      ["iced-lemonade", "Iced Lemonade", "79", "drinks", true, ["new"], "lemonade"],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000004", slug: "spice-route", name: "Spice Route", active: true, logo_text: "Spice Route", hero_title: "Authentic Indian Kitchen", tagline: "NAMASTE", accent_color: "#c2410c" },
    categories: [cat("curries", "Curries", "fa-solid fa-bowl-food", "#c2410c", 0), cat("biryani", "Biryani", "fa-solid fa-plate-wheat", "#d97706", 1), cat("breads", "Breads", "fa-solid fa-bread-slice", "#a16207", 2), cat("drinks", "Drinks", "fa-solid fa-mug-hot", "#0ea5e9", 3)],
    items: [
      ["butter-chicken", "Butter Chicken", "349", "curries", false, ["bestseller"], "butter-chicken"],
      ["paneer-tikka-masala", "Paneer Tikka Masala", "299", "curries", true, ["vegetarian", "bestseller"], "paneer-curry"],
      ["dal-makhani", "Dal Makhani", "229", "curries", true, ["vegetarian"], "dal-curry"],
      ["chicken-biryani", "Chicken Biryani", "319", "biryani", false, ["spicy", "bestseller"], "chicken-biryani"],
      ["veg-biryani", "Veg Biryani", "259", "biryani", true, ["vegetarian"], "vegetable-biryani"],
      ["garlic-naan", "Garlic Naan", "69", "breads", true, ["vegetarian"], "naan-bread"],
      ["butter-roti", "Butter Roti", "39", "breads", true, ["vegetarian"], "roti"],
      ["tandoori-chicken", "Tandoori Chicken", "329", "curries", false, ["spicy", "new"], "tandoori-chicken"],
      ["mango-lassi", "Mango Lassi", "99", "drinks", true, ["bestseller"], "mango-lassi"],
      ["masala-chai", "Masala Chai", "49", "drinks", true, [], "chai-tea"],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000005", slug: "sakura-sushi", name: "Sakura Sushi", active: true, logo_text: "Sakura Sushi", hero_title: "Fresh Sushi & Ramen", tagline: "IRASSHAIMASE", accent_color: "#be123c" },
    categories: [cat("sushi", "Sushi", "fa-solid fa-fish", "#be123c", 0), cat("ramen", "Ramen", "fa-solid fa-bowl-food", "#d97706", 1), cat("sides", "Sides", "fa-solid fa-shrimp", "#16a34a", 2), cat("drinks", "Drinks", "fa-solid fa-mug-hot", "#0ea5e9", 3)],
    items: [
      ["salmon-nigiri", "Salmon Nigiri", "249", "sushi", false, ["bestseller"], "salmon-nigiri"],
      ["tuna-roll", "Tuna Roll", "279", "sushi", false, ["bestseller"], "tuna-sushi"],
      ["california-roll", "California Roll", "229", "sushi", false, [], "california-roll"],
      ["avocado-roll", "Avocado Roll", "199", "sushi", true, ["vegetarian", "new"], "avocado-sushi"],
      ["tonkotsu-ramen", "Tonkotsu Ramen", "329", "ramen", false, ["bestseller"], "tonkotsu-ramen"],
      ["miso-ramen", "Miso Ramen", "299", "ramen", true, ["vegetarian"], "miso-ramen"],
      ["spicy-ramen", "Spicy Miso Ramen", "319", "ramen", false, ["spicy"], "spicy-ramen"],
      ["edamame", "Edamame", "129", "sides", true, ["vegetarian"], "edamame"],
      ["gyoza", "Pork Gyoza", "189", "sides", false, [], "gyoza"],
      ["matcha-latte", "Matcha Latte", "139", "drinks", true, ["new"], "matcha-latte"],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000006", slug: "taco-fiesta", name: "Taco Fiesta", active: true, logo_text: "Taco Fiesta", hero_title: "Street Tacos & More", tagline: "HOLA", accent_color: "#ca8a04" },
    categories: [cat("tacos", "Tacos", "fa-solid fa-pepper-hot", "#ca8a04", 0), cat("burritos", "Burritos", "fa-solid fa-bowl-food", "#16a34a", 1), cat("sides", "Sides", "fa-solid fa-cheese", "#d97706", 2), cat("drinks", "Drinks", "fa-solid fa-glass-water", "#0ea5e9", 3)],
    items: [
      ["chicken-taco", "Chicken Taco", "129", "tacos", false, ["bestseller"], "chicken-taco"],
      ["carnitas-taco", "Carnitas Taco", "149", "tacos", false, ["bestseller"], "pork-taco"],
      ["veggie-taco", "Veggie Taco", "119", "tacos", true, ["vegetarian"], "vegetable-taco"],
      ["fish-taco", "Baja Fish Taco", "159", "tacos", false, ["spicy", "new"], "fish-taco"],
      ["beef-burrito", "Beef Burrito", "239", "burritos", false, ["bestseller"], "beef-burrito"],
      ["bean-burrito", "Bean Burrito", "199", "burritos", true, ["vegetarian"], "bean-burrito"],
      ["quesadilla", "Cheese Quesadilla", "179", "sides", true, ["vegetarian"], "quesadilla"],
      ["loaded-nachos", "Loaded Nachos", "199", "sides", true, ["vegetarian", "spicy"], "nachos"],
      ["guacamole", "Guacamole & Chips", "149", "sides", true, ["vegetarian"], "guacamole"],
      ["horchata", "Horchata", "89", "drinks", true, [], "horchata"],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000007", slug: "green-bowl", name: "Green Bowl", active: true, logo_text: "Green Bowl", hero_title: "Fresh & Healthy Bowls", tagline: "EAT CLEAN", accent_color: "#15803d" },
    categories: [cat("bowls", "Bowls", "fa-solid fa-bowl-rice", "#15803d", 0), cat("salads", "Salads", "fa-solid fa-leaf", "#16a34a", 1), cat("smoothies", "Smoothies", "fa-solid fa-blender", "#db2777", 2), cat("snacks", "Snacks", "fa-solid fa-apple-whole", "#d97706", 3)],
    items: [
      ["quinoa-power-bowl", "Quinoa Power Bowl", "279", "bowls", true, ["vegetarian", "bestseller"], "quinoa-bowl"],
      ["buddha-bowl", "Buddha Bowl", "259", "bowls", true, ["vegetarian"], "buddha-bowl"],
      ["poke-bowl", "Salmon Poke Bowl", "329", "bowls", false, ["bestseller", "new"], "poke-bowl"],
      ["caesar-salad", "Caesar Salad", "229", "salads", false, [], "caesar-salad"],
      ["greek-salad", "Greek Salad", "219", "salads", true, ["vegetarian"], "greek-salad"],
      ["kale-salad", "Kale & Avocado Salad", "239", "salads", true, ["vegetarian", "new"], "kale-salad"],
      ["berry-smoothie", "Mixed Berry Smoothie", "169", "smoothies", true, ["bestseller"], "berry-smoothie"],
      ["green-detox-smoothie", "Green Detox Smoothie", "179", "smoothies", true, ["vegetarian"], "green-smoothie"],
      ["avocado-toast", "Avocado Toast", "149", "snacks", true, ["vegetarian"], "avocado-toast"],
      ["granola-cup", "Granola & Yogurt Cup", "139", "snacks", true, [], "granola-yogurt"],
    ],
  },
];

for (const d of DEMO) {
  const rid = d.restaurant.id;
  let e;
  ({ error: e } = await db.from("restaurants").upsert(d.restaurant, { onConflict: "id" }));
  if (e) throw new Error(`restaurants (${d.restaurant.slug}): ${e.message}`);

  if (s1) {
    const s = { ...s1, id: d.restaurant.slug, restaurant_id: rid };
    ({ error: e } = await db.from("settings").upsert(s, { onConflict: "id" }));
    if (e) throw new Error(`settings (${d.restaurant.slug}): ${e.message}`);
  }

  ({ error: e } = await db.from("categories").upsert(d.categories.map((c) => ({ ...c, restaurant_id: rid })), { onConflict: "restaurant_id,slug" }));
  if (e) throw new Error(`categories (${d.restaurant.slug}): ${e.message}`);

  ({ error: e } = await db.from("filters").upsert(FILTERS.map((f) => ({ ...f, restaurant_id: rid })), { onConflict: "restaurant_id,slug" }));
  if (e) throw new Error(`filters (${d.restaurant.slug}): ${e.message}`);

  const items = d.items.map(([slug, title, price, category, veg, tags, kw], i) => ({
    restaurant_id: rid,
    id: `${d.restaurant.slug}-${slug}`,
    slug,
    title,
    price,
    image: lf(kw),
    category,
    veg,
    is4d: false,
    sort_order: i,
    tags,
    allergens: [],
    description: `${title} — freshly made at ${d.restaurant.name}.`,
  }));
  ({ error: e } = await db.from("menu_items").upsert(items, { onConflict: "id" }));
  if (e) throw new Error(`menu_items (${d.restaurant.slug}): ${e.message}`);

  console.log(`✓ ${d.restaurant.name}: ${d.categories.length} categories, ${items.length} items`);
}

console.log(`Done. Seeded ${DEMO.length} demo restaurants (+ French House #1 = ${DEMO.length + 1} total).`);
