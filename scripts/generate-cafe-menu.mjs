// Generates the Little French House CAFE menu into public/content/menu.json,
// modelled on the real littlefrenchhouse.in menu (real dish names + real photos).
//
// - Food images are the restaurant's own photos (harvested from the live site).
// - Coffee / beverage images are verified Unsplash photos (the site has none).
// - It's a vegetarian cafe, so ~90% veg with a few non-veg additions.
// - The "Avocado & Cream Cheese" croissant is the ONLY 4D dish; it reuses the
//   existing model (which actually renders as an avocado), so 3D matches the food.
// - Ingredients are derived per-dish from the title; descriptions are richer
//   per-category templates; attribute filters (bestseller/chef/top-rated/new).
//
// Re-run: node scripts/generate-cafe-menu.mjs   then   node scripts/seed-supabase.mjs --replace

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const GLB_SMALL = "/models/croissant_small.glb";
const GLB_OPTIMIZED = "/models/croissant-optimized.glb";

const LFH = (f) => `https://littlefrenchhouse.in/restaurant/wp-content/uploads/2021/01/${f}`;
const UNS = (id) => `https://images.unsplash.com/${id}?w=600&h=600&fit=crop`;

// ---------------------------------------------------------------------------
// Categories — Coffee first. 6-lang names, FA icon, accent colour.
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { slug: "coffee",     icon: "fa-mug-hot",     color: "#a16207", name: { en: "Coffee", de: "Kaffee", fr: "Café", ar: "قهوة", hi: "कॉफ़ी", ko: "커피" } },
  { slug: "beverages",  icon: "fa-glass-water", color: "#0ea5e9", name: { en: "Beverages", de: "Getränke", fr: "Boissons", ar: "مشروبات", hi: "पेय", ko: "음료" } },
  { slug: "croissants", icon: "fa-bread-slice", color: "#d4a574", name: { en: "Croissants", de: "Croissants", fr: "Croissants", ar: "كرواسون", hi: "क्रोइसैन", ko: "크루아상" } },
  { slug: "starters",   icon: "fa-bowl-food",   color: "#f59e0b", name: { en: "Starters", de: "Vorspeisen", fr: "Entrées", ar: "مقبلات", hi: "स्टार्टर", ko: "스타터" } },
  { slug: "salads",     icon: "fa-leaf",        color: "#22c55e", name: { en: "Salads", de: "Salate", fr: "Salades", ar: "سلطات", hi: "सलाद", ko: "샐러드" } },
  { slug: "sandwiches", icon: "fa-burger",      color: "#f97316", name: { en: "Sandwiches", de: "Sandwiches", fr: "Sandwichs", ar: "ساندويتش", hi: "सैंडविच", ko: "샌드위치" } },
  { slug: "pizza",      icon: "fa-pizza-slice", color: "#ef4444", name: { en: "Pizza", de: "Pizza", fr: "Pizza", ar: "بيتزا", hi: "पिज्जा", ko: "피자" } },
  { slug: "pasta",      icon: "fa-utensils",    color: "#eab308", name: { en: "Pasta", de: "Pasta", fr: "Pâtes", ar: "باستا", hi: "पास्ता", ko: "파스타" } },
  { slug: "desserts",   icon: "fa-ice-cream",   color: "#ec4899", name: { en: "Desserts", de: "Desserts", fr: "Desserts", ar: "حلويات", hi: "डेज़र्ट", ko: "디저트" } },
];

// Attribute filters first (engaging), then dietary. No "All" chip (UI handles it).
const FILTERS = [
  { slug: "bestseller",   icon: "🔥",   name: { en: "Bestseller", de: "Bestseller", fr: "Best-seller", ar: "الأكثر مبيعاً", hi: "बेस्टसेलर", ko: "베스트셀러" } },
  { slug: "chef-special", icon: "👨‍🍳", name: { en: "Chef's Special", de: "Chefempfehlung", fr: "Spécialité du Chef", ar: "طبق الشيف", hi: "शेफ स्पेशल", ko: "셰프 스페셜" } },
  { slug: "top-rated",    icon: "⭐",   name: { en: "Top Rated", de: "Top bewertet", fr: "Mieux notés", ar: "الأعلى تقييماً", hi: "टॉप रेटेड", ko: "인기 평점" } },
  { slug: "new",          icon: "🆕",   name: { en: "New", de: "Neu", fr: "Nouveau", ar: "جديد", hi: "नया", ko: "신메뉴" } },
  { slug: "vegetarian",   icon: "🌿",   name: { en: "Vegetarian", de: "Vegetarisch", fr: "Végétarien", ar: "نباتي", hi: "शाकाहारी", ko: "채식" } },
  { slug: "vegan",        icon: "🥑",   name: { en: "Vegan", de: "Vegan", fr: "Végan", ar: "نباتي صرف", hi: "वीगन", ko: "비건" } },
  { slug: "high-protein", icon: "💪",   name: { en: "High Protein", de: "Proteinreich", fr: "Riche en protéines", ar: "غني بالبروتين", hi: "उच्च प्रोटीन", ko: "고단백" } },
  { slug: "healthy",      icon: "🥗",   name: { en: "Healthy", de: "Gesund", fr: "Sain", ar: "صحي", hi: "स्वस्थ", ko: "건강식" } },
  { slug: "spicy",        icon: "🌶️",  name: { en: "Spicy", de: "Scharf", fr: "Épicé", ar: "حار", hi: "मसालेदार", ko: "매운맛" } },
  { slug: "gluten-free",  icon: "🌾",   name: { en: "Gluten-Free", de: "Glutenfrei", fr: "Sans gluten", ar: "خالٍ من الغلوتين", hi: "ग्लूटेन-मुक्त", ko: "글루텐프리" } },
];

// Attribute-filter membership (by slug). top-rated is derived from rating.
const BESTSELLERS = new Set(["cappuccino", "avocado-and-cream-cheese", "chicago-deep-dish-margherita", "buddha-bowl", "nutella-banana-crepes", "aglio-e-olio-in-coconut-oil", "spinach-feta-grilled-cheese", "caff-latte"]);
const CHEF_SPECIAL = new Set(["truffle-and-wild-mushroom-pizza", "wild-mushroom-tagliatelle", "sassy-signature-salad", "avocado-and-cream-cheese", "roasted-tomato-basil-risotto"]);
const NEW_ITEMS = new Set(["spicy-watermelon-cooler", "smoked-salmon-fettuccine", "mediterranean-veg-pizza", "crunchy-fruit-salad", "mocha-frappe"]);

// Per-category prep base: time, nutrition base (incl. sugar), richer descriptions.
const CAT = {
  coffee:     { cal: 130, protein: 6,  carbs: 16, sugar: 10, short: (n) => `${n}, pulled fresh from our house espresso blend.`, long: (n) => `Our ${n} is made by hand using a small-batch house espresso blend — bold, aromatic and beautifully balanced. Served at the perfect temperature, with latte art on the house whenever it fits the cup.` },
  beverages:  { cal: 180, protein: 3,  carbs: 34, sugar: 24, short: (n) => `${n} — blended fresh, never from a carton.`, long: (n) => `A cool, refreshing ${n} made to order with real fruit and no artificial mixes. Light, vibrant and exactly what you want alongside a slow afternoon at the cafe.` },
  croissants: { cal: 360, protein: 9,  carbs: 38, sugar: 6,  short: (n) => `Flaky all-butter croissant, filled ${n.toLowerCase()} style.`, long: (n) => `Our signature all-butter croissant is laminated over two days for that shatter-crisp, honeycomb crumb, then filled ${n.toLowerCase()} style and finished to order. Best enjoyed warm with a coffee.` },
  starters:   { cal: 320, protein: 9,  carbs: 30, sugar: 4,  short: (n) => `${n} — a warm, generous way to begin.`, long: (n) => `Our ${n} is prepared fresh to order from quality seasonal produce. A comforting, shareable opener that sets the tone for the meal to come.` },
  salads:     { cal: 340, protein: 13, carbs: 22, sugar: 6,  short: (n) => `${n} — crisp, colourful and tossed to order.`, long: (n) => `A bright, generous bowl of ${n}, tossed in our house dressing with crunch, freshness and a little something unexpected in every forkful. As wholesome as it is satisfying.` },
  sandwiches: { cal: 440, protein: 16, carbs: 42, sugar: 5,  short: (n) => `${n}, grilled golden on artisan bread.`, long: (n) => `Our ${n} is layered generously and grilled on toasted artisan bread until golden and melty. Served warm with a side of fries or dressed leaves.` },
  pizza:      { cal: 640, protein: 22, carbs: 64, sugar: 8,  short: (n) => `${n} — hand-stretched and wood-fired.`, long: (n) => `Our ${n} starts with a slow-proved dough, hand-stretched and wood-fired for a blistered, airy crust. Topped with San Marzano tomato, quality cheese and finished with fresh herbs.` },
  pasta:      { cal: 600, protein: 18, carbs: 70, sugar: 6,  short: (n) => `${n}, made with fresh pasta and a house sauce.`, long: (n) => `Our ${n} is cooked to order with fresh pasta and a sauce simmered in-house daily. Comforting, full-flavoured and finished with a flourish of cheese and herbs.` },
  desserts:   { cal: 420, protein: 8,  carbs: 56, sugar: 32, short: (n) => `${n} — the perfect sweet finish.`, long: (n) => `Our ${n} is made fresh and plated with care — indulgent without being heavy, and the ideal way to round off your visit. Equally good to share or keep all to yourself.` },
};

const CAT_TIME = { coffee: "3-5 min", beverages: "3-5 min", croissants: "ready now", starters: "10-15 min", salads: "8-12 min", sandwiches: "10-15 min", pizza: "18-25 min", pasta: "18-25 min", desserts: "8-12 min" };

// Keyword -> ingredient. Scanned against the dish title for per-dish ingredients.
const INGREDIENT_KEYWORDS = [
  ["avocado", ["🥑", "Avocado"]], ["cream cheese", ["🧀", "Cream Cheese"]], ["croissant", ["🥐", "Butter Croissant"]],
  ["mozzarella", ["🧀", "Mozzarella"]], ["ricotta", ["🧀", "Ricotta"]], ["feta", ["🧀", "Feta"]], ["formaggi", ["🧀", "Four Cheeses"]],
  ["cottage cheese", ["🧀", "Cottage Cheese"]], ["cheese", ["🧀", "Cheese"]], ["mushroom", ["🍄", "Mushroom"]], ["truffle", ["🍄", "Truffle Oil"]],
  ["pesto", ["🌿", "Basil Pesto"]], ["basil", ["🌿", "Basil"]], ["spinach", ["🥬", "Spinach"]], ["lettuce", ["🥬", "Lettuce"]],
  ["tomato", ["🍅", "Tomato"]], ["corn", ["🌽", "Sweet Corn"]], ["cucumber", ["🥒", "Cucumber"]], ["mint", ["🌿", "Fresh Mint"]],
  ["melon", ["🍈", "Melon"]], ["watermelon", ["🍉", "Watermelon"]], ["pineapple", ["🍍", "Pineapple"]], ["mango", ["🥭", "Mango"]],
  ["banana", ["🍌", "Banana"]], ["blueberry", ["🫐", "Blueberry"]], ["strawberry", ["🍓", "Strawberry"]], ["orange", ["🍊", "Orange"]],
  ["lemon", ["🍋", "Lemon"]], ["nutella", ["🍫", "Nutella"]], ["oreo", ["🍪", "Oreo"]], ["caramel", ["🍮", "Caramel"]],
  ["chocolate", ["🍫", "Chocolate"]], ["mocha", ["🍫", "Cocoa"]], ["hazelnut", ["🌰", "Hazelnut"]], ["almond", ["🌰", "Almond"]],
  ["espresso", ["☕", "Espresso"]], ["latte", ["☕", "Espresso"]], ["cappuccino", ["☕", "Espresso"]], ["coffee", ["☕", "Coffee"]],
  ["chicken", ["🍗", "Grilled Chicken"]], ["salmon", ["🐟", "Smoked Salmon"]], ["fish", ["🐟", "Fish"]],
  ["potato", ["🥔", "Potato"]], ["fries", ["🍟", "Fries"]], ["onion", ["🧅", "Onion"]], ["garlic", ["🧄", "Garlic"]],
  ["risotto", ["🍚", "Arborio Rice"]], ["gnocchi", ["🥔", "Gnocchi"]], ["ravioli", ["🍝", "Ravioli"]], ["tortellini", ["🍝", "Tortellini"]],
  ["tagliatelle", ["🍝", "Tagliatelle"]], ["fettuccine", ["🍝", "Fettuccine"]], ["macaroni", ["🍝", "Macaroni"]], ["pasta", ["🍝", "Fresh Pasta"]],
  ["pizza", ["🍕", "Pizza Dough"]], ["bread", ["🍞", "Artisan Bread"]], ["waffle", ["🧇", "Waffle Batter"]], ["pancake", ["🥞", "Pancake Batter"]],
  ["crepe", ["🥞", "Crêpe"]], ["arancini", ["🍚", "Risotto Rice"]], ["quinoa", ["🌾", "Quinoa"]], ["fruit", ["🍓", "Seasonal Fruit"]],
  ["ranch", ["🥗", "Ranch Dressing"]], ["pickled", ["🥒", "Pickled Veggies"]], ["bell pepper", ["🫑", "Bell Pepper"]], ["piri", ["🌶️", "Piri Piri"]],
  ["chilli", ["🌶️", "Chilli"]], ["olive", ["🫒", "Olive Oil"]],
];
const CAT_BASE_INGREDIENTS = {
  coffee: [["🥛", "Steamed Milk"], ["💧", "Filtered Water"]],
  beverages: [["🧊", "Ice"], ["🍯", "Honey"]],
  croissants: [["🧈", "French Butter"], ["🥬", "Garden Greens"]],
  starters: [["🌿", "Fresh Herbs"], ["🫒", "Olive Oil"], ["🧂", "Sea Salt"]],
  salads: [["🥬", "Mixed Greens"], ["🫒", "House Dressing"], ["🥒", "Cucumber"]],
  sandwiches: [["🍞", "Sourdough"], ["🥬", "Lettuce"], ["🍅", "Tomato"]],
  pizza: [["🍅", "San Marzano Tomato"], ["🧀", "Mozzarella"], ["🌿", "Basil"]],
  pasta: [["🧄", "Garlic"], ["🧀", "Parmesan"], ["🌿", "Herbs"]],
  desserts: [["🧈", "Butter"], ["🍯", "Maple Syrup"], ["🍓", "Berries"]],
};

// Items: [name, price, veg(0/1), tags[], image]
const ITEMS = {
  coffee: [
    ["Espresso", "2.99", 1, ["vegan", "gluten-free"], UNS("photo-1461023058943-07fcbe16d735")],
    ["Cappuccino", "3.99", 1, ["vegetarian", "gluten-free"], UNS("photo-1509042239860-f550ce710b93")],
    ["Caffè Latte", "4.29", 1, ["vegetarian"], UNS("photo-1551030173-122aabc4489c")],
    ["Mocha Frappe", "4.99", 1, ["vegetarian"], UNS("photo-1437418747212-8d9709afab22")],
    ["Hazelnut Cold Coffee", "4.79", 1, ["vegetarian"], UNS("photo-1572490122747-3968b75cc699")],
    ["Caramel Cold Coffee", "4.79", 1, ["vegetarian"], UNS("photo-1485808191679-5f86510681a2")],
  ],
  beverages: [
    ["Pink Pineapple Smoothie", "5.49", 1, ["vegan", "healthy"], UNS("photo-1638176066666-ffb2f013c7dd")],
    ["Blueberry Banana Booster", "5.49", 1, ["vegan", "healthy", "high-protein"], UNS("photo-1600271886742-f049cd451bba")],
    ["Nutella Shake", "5.99", 1, ["vegetarian"], UNS("photo-1571091655789-405eb7a3a3a8")],
    ["The Oreo Shake", "5.99", 1, ["vegetarian"], UNS("photo-1542990253-0d0f5be5f0ed")],
    ["Mint Melon Juice", "4.49", 1, ["vegan", "healthy", "gluten-free"], UNS("photo-1622597467836-f3285f2131b8")],
    ["Cucumber Mint Cooler", "4.49", 1, ["vegan", "healthy"], UNS("photo-1546171753-97d7676e4602")],
    ["Pineapple Mint Mojito", "4.99", 1, ["vegan"], UNS("photo-1502741224143-90386d7f8c82")],
    ["Spicy Watermelon Cooler", "4.99", 1, ["vegan", "spicy", "healthy"], UNS("photo-1623065422902-30a2d299bbe4")],
  ],
  croissants: [
    ["Avocado & Cream Cheese", "6.49", 1, ["vegetarian", "healthy"], LFH("Avocado-and-Cream-Cheese.png")],
    ["Caprese Style", "5.99", 1, ["vegetarian"], LFH("Caperese-Style.png")],
    ["Minty Cucumber Cream Cheese", "5.49", 1, ["vegetarian"], LFH("Minty-Cucumber-Cream-Cheese.png")],
    ["Ranch Pickled Veggies", "5.49", 1, ["vegetarian"], LFH("Ranch-Dressed-Pickled-Veggies.png")],
  ],
  starters: [
    ["Cream of Lettuce Soup", "4.99", 1, ["vegetarian", "healthy"], LFH("Cream-of-Lettuse-1.png")],
    ["Crockpot French Onion Soup", "5.49", 1, ["vegetarian"], LFH("Crockpot-French-Onion-Soup.png")],
    ["Roasted Tomato & Basil Soup", "4.99", 1, ["vegetarian", "healthy", "gluten-free"], LFH("Roasted-Tomato-and-Basil-Soup.png")],
    ["Arancini Balls", "6.49", 1, ["vegetarian"], LFH("Aarancini-balls.png")],
    ["Hash Brown Potato Cakes", "5.99", 1, ["vegetarian"], LFH("Hashbrown-Potato-Cakes.png")],
    ["Double Loaded Spiced Fries", "6.49", 1, ["vegetarian", "spicy"], LFH("Double-Loaded-Spiced-Fries.png")],
    ["Pesto Mushroom Canapés", "6.99", 1, ["vegetarian"], LFH("Pesto-Filled-Crisp-Mushroom-Canapes.png")],
    ["Farmer's Tear & Share Bread", "6.99", 1, ["vegetarian"], LFH("Farmers-Tear-and-Share-pull-apart-bread.png")],
  ],
  salads: [
    ["Buddha Bowl", "9.99", 1, ["vegan", "healthy", "high-protein"], LFH("Buddha-Bowl.png")],
    ["Protein Power Bowl", "10.49", 1, ["vegetarian", "high-protein", "healthy"], LFH("Protein-Powder-Bowl.png")],
    ["Roasted Veggie Salad", "9.49", 1, ["vegan", "healthy"], LFH("Roasted-Veggie-Salad.png")],
    ["Crunchy Fruit Salad", "8.49", 1, ["vegan", "healthy", "gluten-free"], LFH("Crunchy-Fruit-Saladwith-Poppy-Seeds.png")],
    ["Sassy Signature Salad", "9.99", 1, ["vegetarian", "healthy"], LFH("Sassy-Signature-Salad.png")],
    ["Diet Cracker Nachos", "8.99", 1, ["vegetarian"], LFH("Diet-Crackers-Twist-to-old-school-nachos-copy.png")],
    ["Grilled Chicken Salad", "11.49", 0, ["high-protein", "healthy"], UNS("photo-1532550907401-a500c9a57435")],
  ],
  sandwiches: [
    ["Spinach Feta Grilled Cheese", "8.49", 1, ["vegetarian"], LFH("Spinach-Feta-Grilled-Cheese-Sandwich.png")],
    ["Cottage Cheese Piri Piri", "8.99", 1, ["vegetarian", "spicy"], LFH("Cottage-cheese-piri-piri-twist.png")],
    ["Pesto Ricotta Crostino", "7.49", 1, ["vegetarian"], LFH("Pesto-Ricotta.png")],
    ["Creamy Corn & Spinach Crostino", "7.49", 1, ["vegetarian"], LFH("Creamy-Corn-Spinach.png")],
    ["Roasted Tomato Mozzarella", "7.99", 1, ["vegetarian"], LFH("Roasted-Tomato-Basil-Mozarella.png")],
    ["Grilled Chicken Sandwich", "9.99", 0, ["high-protein"], UNS("photo-1626645738196-c2a7c87a8f58")],
  ],
  pizza: [
    ["Chicago Deep Dish Margherita", "13.99", 1, ["vegetarian"], LFH("Deep-Dish-1.png")],
    ["Tri Chilli Pizza", "13.49", 1, ["vegetarian", "spicy"], LFH("Tri-Chilli-1.png")],
    ["Quattro Formaggi Pizza", "14.49", 1, ["vegetarian"], LFH("Quattro-Formaggi-Pizza-1.png")],
    ["Mediterranean Veg Pizza", "13.49", 1, ["vegetarian", "healthy"], LFH("Mediterranean-Veg-Pizza-1.png")],
    ["Truffle & Wild Mushroom Pizza", "15.49", 1, ["vegetarian"], LFH("Truffle-and-Wild-Mushroom-Pizza-1.png")],
    ["Flat Bread Pesto Pizza", "12.99", 1, ["vegetarian"], LFH("Flat-Bread-Pesto-Pizza-1.png")],
  ],
  pasta: [
    ["Aglio e Olio in Coconut Oil", "12.49", 1, ["vegetarian"], LFH("Aglio-E-Olio-In-Coconut-Oil.png")],
    ["Ravioli in Pesto Sauce", "13.49", 1, ["vegetarian"], LFH("Ravioli-In-Pesto-Sauce.png")],
    ["Wild Mushroom Tagliatelle", "14.49", 1, ["vegetarian"], LFH("Wild-Mushroom-Tagliatelle-With-Truffle-Oil.png")],
    ["Grandma's Mac N' Cheese", "12.99", 1, ["vegetarian"], LFH("Grandmas-Cosy-Macaroni-N-Cheese.png")],
    ["Gnocchi in Red Pesto", "13.49", 1, ["vegetarian"], LFH("Gnocchi-In-Homemade-Red-Pesto.png")],
    ["Roasted Tomato Basil Risotto", "13.99", 1, ["vegetarian", "gluten-free"], LFH("Roastd-Tomato-Basil-Risotto.png")],
    ["Chicken Alfredo Pasta", "14.99", 0, ["high-protein"], UNS("photo-1604908176997-125f25cc6f3d")],
    ["Smoked Salmon Fettuccine", "16.49", 0, ["high-protein", "healthy"], UNS("photo-1467003909585-2f8a72700288")],
  ],
  desserts: [
    ["Nutella Banana Crepes", "6.49", 1, ["vegetarian"], LFH("Nutella-Banana-Creps-Crepes.png")],
    ["Salted Caramel Crepes", "6.99", 1, ["vegetarian"], LFH("Salted-Caramel-Crepes-with-Mascaprone-Cream-Cheese.png")],
    ["Strawberry & Orange Crepes", "6.49", 1, ["vegetarian"], LFH("Strawberry-Orange-Crepes-Crepes.png")],
    ["Lemon Blueberry Waffles", "6.99", 1, ["vegetarian"], LFH("Lemon-Blueberry-Waffles-Dessert.png")],
    ["Nutella Pancake", "5.99", 1, ["vegetarian"], LFH("Nutella-Pancake-2.png")],
    ["Fluffy Buttermilk Pancakes", "5.99", 1, ["vegetarian"], LFH("Fluffy-Buttermilk-Pancakes-Dessert.png")],
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");

const REVIEWERS = ["Aarav", "Priya", "Liam", "Sofia", "Noah", "Emma", "Yuki", "Marco", "Lina", "Omar", "Chloe", "Daniel", "Mei", "Hannah", "Diego", "Aisha"];
const REVIEW_TEMPLATES = [
  (n) => `The ${n} was excellent — easily my new favourite here.`,
  (n) => `Loved the ${n}. Fresh, beautifully presented and great value.`,
  (n) => `Best ${n} I've had in a long time. Highly recommend.`,
  (n) => `${n} was lovely, and the cafe has such a cosy vibe.`,
  (n) => `Came back just for the ${n}. So good.`,
];
function buildReviews(name, seed) {
  const count = 2 + (seed % 2);
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = hash(name + i);
    out.push({ name: REVIEWERS[(seed + i * 3) % REVIEWERS.length], rating: 4 + (s % 2), text: REVIEW_TEMPLATES[s % REVIEW_TEMPLATES.length](name) });
  }
  return out;
}
function buildNutrition(meta, tags) {
  let { cal, protein, carbs, sugar } = meta;
  if (tags.includes("healthy")) { cal = Math.round(cal * 0.75); carbs = Math.round(carbs * 0.8); sugar = Math.round(sugar * 0.6); }
  if (tags.includes("high-protein")) protein += 16;
  return { calories: String(cal), protein: `${protein}g`, carbs: `${carbs}g`, sugar: `${sugar}g` };
}
// Per-dish ingredients: match title keywords, then top up with category basics.
function buildIngredients(title, catSlug) {
  const t = title.toLowerCase();
  const out = [];
  const seen = new Set();
  for (const [kw, ing] of INGREDIENT_KEYWORDS) {
    if (t.includes(kw) && !seen.has(ing[1])) { out.push({ emoji: ing[0], name: ing[1] }); seen.add(ing[1]); }
    if (out.length >= 5) break;
  }
  for (const ing of CAT_BASE_INGREDIENTS[catSlug] || []) {
    if (out.length >= 5) break;
    if (!seen.has(ing[1])) { out.push({ emoji: ing[0], name: ing[1] }); seen.add(ing[1]); }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
const categories = CATEGORIES.map((c, i) => ({ ...c, sortOrder: i + 1 }));
const filters = FILTERS.map((f, i) => ({ ...f, sortOrder: i + 1 }));

// Derive allergens from the dish title + its ingredient names. Heuristic — the
// owner can fine-tune any dish in the editor afterwards.
const ALLERGEN_KEYWORDS = [
  ["gluten", ["bread", "croissant", "pasta", "pizza", "dough", "flour", "waffle", "pancake", "crepe", "crêpe", "brownie", "cookie", "arancini", "tortellini", "ravioli", "fettuccine", "tagliatelle", "gnocchi", "macaroni", "sandwich", "crostino", "bagel", "cake", "cheesecake", "danish", "muffin", "roll", "bun", "cracker", "nacho", "tear", "fries", "risotto"]],
  ["dairy", ["cheese", "cream", "mozzarella", "ricotta", "feta", "butter", "milk", "parmesan", "latte", "cappuccino", "mocha", "frappe", "nutella", "chocolate", "mascarpone", "cottage", "alfredo", "bechamel", "gratin", "macaroni", "espresso"]],
  ["eggs", ["egg", "pancake", "waffle", "crepe", "crêpe", "brownie", "mayo", "carbonara", "cake"]],
  ["nuts", ["nut", "almond", "hazelnut", "pesto", "praline", "walnut", "pecan", "cashew", "pistachio", "nutella"]],
  ["soy", ["soy", "tofu", "edamame", "miso"]],
  ["fish", ["fish", "salmon", "tuna", "anchovy", "seafood", "shrimp", "prawn", "calamari", "squid", "lobster", "crab", "poke"]],
];
function deriveAllergens(title, ingredients) {
  const hay = (title + " " + ingredients.map((i) => i.name).join(" ")).toLowerCase();
  const out = [];
  for (const [allergen, kws] of ALLERGEN_KEYWORDS) {
    if (kws.some((k) => hay.includes(k))) out.push(allergen);
  }
  return out;
}

const items = [];
let order = 0;
for (const cat of CATEGORIES) {
  const meta = CAT[cat.slug];
  for (const [name, price, veg, baseTags, image] of ITEMS[cat.slug]) {
    const slug = slugify(name);
    const seed = hash(slug);
    const is4d = slug === "avocado-and-cream-cheese";
    const rating = (4.3 + (seed % 7) / 10).toFixed(1);

    // attribute tags
    const tags = [...baseTags];
    if (BESTSELLERS.has(slug)) tags.push("bestseller");
    if (CHEF_SPECIAL.has(slug)) tags.push("chef-special");
    if (NEW_ITEMS.has(slug)) tags.push("new");
    if (parseFloat(rating) >= 4.8) tags.push("top-rated");

    const ing = buildIngredients(name, cat.slug);

    items.push({
      id: slug,
      slug,
      title: name,
      price,
      image,
      category: cat.slug,
      veg: !!veg,
      is4d,
      modelFolder: is4d ? "MP" : null, // matches public/content/items/MP/config.json
      modelSmallUrl: is4d ? GLB_SMALL : null,
      modelOptimizedUrl: is4d ? GLB_OPTIMIZED : null,
      description: meta.short(name),
      longDescription: meta.long(name),
      rating,
      time: CAT_TIME[cat.slug],
      nutrition: buildNutrition(meta, baseTags),
      ingredients: ing,
      allergens: deriveAllergens(name, ing),
      reviews: buildReviews(name, seed),
      tags,
      sort_order: order++,
    });
  }
}

const vegCount = items.filter((i) => i.veg).length;
writeFileSync(join(root, "public", "content", "menu.json"), JSON.stringify({ categories, filters, items }, null, 2) + "\n");
console.log(`✓ wrote ${items.length} items, ${categories.length} categories, ${filters.length} filters`);
console.log(`  veg ${vegCount} / non-veg ${items.length - vegCount}  (${Math.round((vegCount / items.length) * 100)}% veg)`);
console.log(`  4D: ${items.filter((i) => i.is4d).map((i) => i.slug).join(", ")}`);
console.log(`  bestseller ${items.filter(i=>i.tags.includes("bestseller")).length}, chef ${items.filter(i=>i.tags.includes("chef-special")).length}, new ${items.filter(i=>i.tags.includes("new")).length}, top-rated ${items.filter(i=>i.tags.includes("top-rated")).length}`);
