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

// Stable, cuisine-appropriate photos: direct Unsplash CDN URLs — all verified HTTP 200.
// Format: https://images.unsplash.com/photo-<id>?w=600&q=70
// Curated per cuisine; a handful reused across similar dishes within the same restaurant.
const U = (id) => `https://images.unsplash.com/photo-${id}?w=600&q=70`;

// Shared filter set (items reference these slugs in their tags).
const FILTERS = [
  { slug: "bestseller", name: { en: "Bestseller" }, icon: "⭐", sort_order: 0, active: true },
  { slug: "vegetarian", name: { en: "Veg" }, icon: "🌿", sort_order: 1, active: true },
  { slug: "spicy", name: { en: "Spicy" }, icon: "🌶️", sort_order: 2, active: true },
  { slug: "new", name: { en: "New" }, icon: "🆕", sort_order: 3, active: true },
];
const cat = (slug, en, icon, color, i) => ({ slug, name: { en }, icon, color, sort_order: i, active: true });

// item tuple: [slug, title, price, category, veg, tags, imageUrl]
const DEMO = [
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000002", slug: "pizza-palace", name: "Pizza Palace", active: true, logo_text: "Pizza Palace", hero_title: "Wood-Fired Pizzeria", tagline: "BUONASERA", accent_color: "#c0392b" },
    categories: [cat("pizzas", "Pizzas", "fa-solid fa-pizza-slice", "#d97706", 0), cat("sides", "Sides", "fa-solid fa-bowl-food", "#16a34a", 1), cat("drinks", "Drinks", "fa-solid fa-glass-water", "#0ea5e9", 2), cat("desserts", "Desserts", "fa-solid fa-ice-cream", "#db2777", 3)],
    items: [
      ["margherita-pizza", "Margherita Pizza", "299", "pizzas", true, ["bestseller", "vegetarian"], U("1574071318508-1cdbab80d002")],
      ["pepperoni-pizza", "Pepperoni Pizza", "399", "pizzas", false, ["bestseller"], U("1565299624946-b28f40a0ae38")],
      ["veggie-supreme-pizza", "Veggie Supreme Pizza", "349", "pizzas", true, ["vegetarian"], U("1513104890138-7c749659a591")],
      ["bbq-chicken-pizza", "BBQ Chicken Pizza", "429", "pizzas", false, ["spicy"], U("1528736235302-52922df5c122")],
      ["four-cheese-pizza", "Four Cheese Pizza", "379", "pizzas", true, ["vegetarian", "new"], U("1548365328-8c6db3220e4c")],
      ["garlic-bread", "Garlic Bread", "149", "sides", true, ["vegetarian"], U("1509722747041-616f39b57569")],
      ["buffalo-wings", "Buffalo Wings", "249", "sides", false, ["spicy"], U("1567620905732-2d1ec7ab7445")],
      ["classic-cola", "Classic Cola", "60", "drinks", true, [], U("1624378439575-d8705ad7ae80")],
      ["choco-lava-cake", "Choco Lava Cake", "129", "desserts", true, ["bestseller"], U("1571877227200-a0d98ea607e9")],
      ["tiramisu", "Tiramisu", "159", "desserts", true, [], U("1571115177098-24ec42ed204d")],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000003", slug: "burger-barn", name: "Burger Barn", active: true, logo_text: "Burger Barn", hero_title: "Smashed & Stacked", tagline: "HOWDY", accent_color: "#b45309" },
    categories: [cat("burgers", "Burgers", "fa-solid fa-burger", "#b45309", 0), cat("sides", "Sides", "fa-solid fa-bowl-food", "#16a34a", 1), cat("shakes", "Shakes", "fa-solid fa-glass-water", "#db2777", 2), cat("drinks", "Drinks", "fa-solid fa-bottle-water", "#0ea5e9", 3)],
    items: [
      ["classic-cheeseburger", "Classic Cheeseburger", "199", "burgers", false, ["bestseller"], U("1555041469-a586c61ea9bc")],
      ["bacon-double", "Bacon Double", "279", "burgers", false, ["bestseller"], U("1586190848861-99aa4a171e90")],
      ["veggie-burger", "Veggie Burger", "179", "burgers", true, ["vegetarian"], U("1547592180-85f173990554")],
      ["spicy-chicken-burger", "Spicy Chicken Burger", "229", "burgers", false, ["spicy"], U("1615361200141-f45040f367be")],
      ["bbq-mushroom-burger", "BBQ Mushroom Burger", "209", "burgers", true, ["vegetarian", "new"], U("1585238342024-78d387f4a707")],
      ["french-fries", "French Fries", "99", "sides", true, ["vegetarian", "bestseller"], U("1630384060421-cb20d0e0649d")],
      ["onion-rings", "Onion Rings", "119", "sides", true, ["vegetarian"], U("1558961363-fa8fdf82db35")],
      ["chocolate-shake", "Chocolate Shake", "149", "shakes", true, ["bestseller"], U("1572490122747-3968b75cc699")],
      ["strawberry-shake", "Strawberry Shake", "149", "shakes", true, [], U("1553361371-9b22f78e8b1d")],
      ["iced-lemonade", "Iced Lemonade", "79", "drinks", true, ["new"], U("1508766917616-d22f3f1eea14")],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000004", slug: "spice-route", name: "Spice Route", active: true, logo_text: "Spice Route", hero_title: "Authentic Indian Kitchen", tagline: "NAMASTE", accent_color: "#c2410c" },
    categories: [cat("curries", "Curries", "fa-solid fa-bowl-food", "#c2410c", 0), cat("biryani", "Biryani", "fa-solid fa-plate-wheat", "#d97706", 1), cat("breads", "Breads", "fa-solid fa-bread-slice", "#a16207", 2), cat("drinks", "Drinks", "fa-solid fa-mug-hot", "#0ea5e9", 3)],
    items: [
      ["butter-chicken", "Butter Chicken", "349", "curries", false, ["bestseller"], U("1603360946369-dc9bb6258143")],
      ["paneer-tikka-masala", "Paneer Tikka Masala", "299", "curries", true, ["vegetarian", "bestseller"], U("1585937421612-70a008356fbe")],
      ["dal-makhani", "Dal Makhani", "229", "curries", true, ["vegetarian"], U("1546833998-877b37c2e5c6")],
      ["chicken-biryani", "Chicken Biryani", "319", "biryani", false, ["spicy", "bestseller"], U("1567188040759-fb8a883dc6d8")],
      ["veg-biryani", "Veg Biryani", "259", "biryani", true, ["vegetarian"], U("1528712306091-ed0763094c98")],
      ["garlic-naan", "Garlic Naan", "69", "breads", true, ["vegetarian"], U("1589302168068-964664d93dc0")],
      ["butter-roti", "Butter Roti", "39", "breads", true, ["vegetarian"], U("1601050690597-df0568f70950")],
      ["tandoori-chicken", "Tandoori Chicken", "329", "curries", false, ["spicy", "new"], U("1565557623262-b51c2513a641")],
      ["mango-lassi", "Mango Lassi", "99", "drinks", true, ["bestseller"], U("1558618666-fcd25c85cd64")],
      ["masala-chai", "Masala Chai", "49", "drinks", true, [], U("1567529684892-09290a1b2d05")],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000005", slug: "sakura-sushi", name: "Sakura Sushi", active: true, logo_text: "Sakura Sushi", hero_title: "Fresh Sushi & Ramen", tagline: "IRASSHAIMASE", accent_color: "#be123c" },
    categories: [cat("sushi", "Sushi", "fa-solid fa-fish", "#be123c", 0), cat("ramen", "Ramen", "fa-solid fa-bowl-food", "#d97706", 1), cat("sides", "Sides", "fa-solid fa-shrimp", "#16a34a", 2), cat("drinks", "Drinks", "fa-solid fa-mug-hot", "#0ea5e9", 3)],
    items: [
      ["salmon-nigiri", "Salmon Nigiri", "249", "sushi", false, ["bestseller"], U("1579871494447-9811cf80d66c")],
      ["tuna-roll", "Tuna Roll", "279", "sushi", false, ["bestseller"], U("1611143669185-af224c5e3252")],
      ["california-roll", "California Roll", "229", "sushi", false, [], U("1553621042-f6e147245754")],
      ["avocado-roll", "Avocado Roll", "199", "sushi", true, ["vegetarian", "new"], U("1540189549336-e6e99c3679fe")],
      ["tonkotsu-ramen", "Tonkotsu Ramen", "329", "ramen", false, ["bestseller"], U("1569050467447-ce54b3bbc37d")],
      ["miso-ramen", "Miso Ramen", "299", "ramen", true, ["vegetarian"], U("1512058564366-18510be2db19")],
      ["spicy-ramen", "Spicy Miso Ramen", "319", "ramen", false, ["spicy"], U("1591814468924-caf88d1232e1")],
      ["edamame", "Edamame", "129", "sides", true, ["vegetarian"], U("1547592166-23ac45744acd")],
      ["gyoza", "Pork Gyoza", "189", "sides", false, [], U("1583608205776-bfd35f0d9f83")],
      ["matcha-latte", "Matcha Latte", "139", "drinks", true, ["new"], U("1515823064-d6e0c04616a7")],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000006", slug: "taco-fiesta", name: "Taco Fiesta", active: true, logo_text: "Taco Fiesta", hero_title: "Street Tacos & More", tagline: "HOLA", accent_color: "#ca8a04" },
    categories: [cat("tacos", "Tacos", "fa-solid fa-pepper-hot", "#ca8a04", 0), cat("burritos", "Burritos", "fa-solid fa-bowl-food", "#16a34a", 1), cat("sides", "Sides", "fa-solid fa-cheese", "#d97706", 2), cat("drinks", "Drinks", "fa-solid fa-glass-water", "#0ea5e9", 3)],
    items: [
      ["chicken-taco", "Chicken Taco", "129", "tacos", false, ["bestseller"], U("1561758033-d89a9ad46330")],
      ["carnitas-taco", "Carnitas Taco", "149", "tacos", false, ["bestseller"], U("1565299585323-38d6b0865b47")],
      ["veggie-taco", "Veggie Taco", "119", "tacos", true, ["vegetarian"], U("1540189549336-e6e99c3679fe")],
      ["fish-taco", "Baja Fish Taco", "159", "tacos", false, ["spicy", "new"], U("1555126634-323283e090fa")],
      ["beef-burrito", "Beef Burrito", "239", "burritos", false, ["bestseller"], U("1593504049359-74330189a345")],
      ["bean-burrito", "Bean Burrito", "199", "burritos", true, ["vegetarian"], U("1517093157656-b9eccef91cb1")],
      ["quesadilla", "Cheese Quesadilla", "179", "sides", true, ["vegetarian"], U("1618040996337-56904b7850b9")],
      ["loaded-nachos", "Loaded Nachos", "199", "sides", true, ["vegetarian", "spicy"], U("1552332386-f8dd00dc2f85")],
      ["guacamole", "Guacamole & Chips", "149", "sides", true, ["vegetarian"], U("1600335895229-6e75511892c8")],
      ["horchata", "Horchata", "89", "drinks", true, [], U("1576618148400-f54bed99fcfd")],
    ],
  },
  {
    restaurant: { id: "00000000-0000-0000-0000-000000000007", slug: "green-bowl", name: "Green Bowl", active: true, logo_text: "Green Bowl", hero_title: "Fresh & Healthy Bowls", tagline: "EAT CLEAN", accent_color: "#15803d" },
    categories: [cat("bowls", "Bowls", "fa-solid fa-bowl-rice", "#15803d", 0), cat("salads", "Salads", "fa-solid fa-leaf", "#16a34a", 1), cat("smoothies", "Smoothies", "fa-solid fa-blender", "#db2777", 2), cat("snacks", "Snacks", "fa-solid fa-apple-whole", "#d97706", 3)],
    items: [
      ["quinoa-power-bowl", "Quinoa Power Bowl", "279", "bowls", true, ["vegetarian", "bestseller"], U("1540189549336-e6e99c3679fe")],
      ["buddha-bowl", "Buddha Bowl", "259", "bowls", true, ["vegetarian"], U("1546069901-ba9599a7e63c")],
      ["poke-bowl", "Salmon Poke Bowl", "329", "bowls", false, ["bestseller", "new"], U("1505253758473-96b7015fcd40")],
      ["caesar-salad", "Caesar Salad", "229", "salads", false, [], U("1550304943-4f24f54ddde9")],
      ["greek-salad", "Greek Salad", "219", "salads", true, ["vegetarian"], U("1607532941433-304659e8198a")],
      ["kale-salad", "Kale & Avocado Salad", "239", "salads", true, ["vegetarian", "new"], U("1512621776951-a57141f2eefd")],
      ["berry-smoothie", "Mixed Berry Smoothie", "169", "smoothies", true, ["bestseller"], U("1505144808419-1957a94ca61e")],
      ["green-detox-smoothie", "Green Detox Smoothie", "179", "smoothies", true, ["vegetarian"], U("1502741338009-cac2772e18bc")],
      ["avocado-toast", "Avocado Toast", "149", "snacks", true, ["vegetarian"], U("1482049016688-2d3e1b311543")],
      ["granola-cup", "Granola & Yogurt Cup", "139", "snacks", true, [], U("1504387103978-e4ee71416c38")],
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

  const items = d.items.map(([slug, title, price, category, veg, tags, img], i) => ({
    restaurant_id: rid,
    id: `${d.restaurant.slug}-${slug}`,
    slug,
    title,
    price,
    image: img,
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

  // Authoritative cleanup: drop any item left on THIS demo restaurant that is no
  // longer in the list above (e.g. renamed/removed dishes from an earlier seeder
  // version). Upsert alone never deletes, so without this, old rows linger with
  // stale/mismatched images — the "blank/wrong photo" bug. Scoped to rid only;
  // restaurant #1 (French House) is never in DEMO, so it is never touched.
  const keepIds = items.map((it) => it.id);
  let staleRemoved = 0;
  {
    const { data: removed, error: de } = await db
      .from("menu_items")
      .delete()
      .eq("restaurant_id", rid)
      .not("id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`)
      .select("id");
    if (de) throw new Error(`menu_items cleanup (${d.restaurant.slug}): ${de.message}`);
    staleRemoved = removed?.length ?? 0;
  }

  console.log(`✓ ${d.restaurant.name}: ${d.categories.length} categories, ${items.length} items${staleRemoved ? ` (removed ${staleRemoved} stale)` : ""}`);
}

console.log(`Done. Seeded ${DEMO.length} demo restaurants (+ French House #1 = ${DEMO.length + 1} total).`);
