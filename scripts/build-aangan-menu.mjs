// Generates public/content/aangan-menu.json from the compact data below (transcribed
// from the Aangan Garden Restaurant PDF). ~7-8 items per category, every category,
// all pure-veg, real prices. No images (owner adds real dish photos in the editor).
// Run: node scripts/build-aangan-menu.mjs
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const slugify = (s) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
// Clean on-brand placeholder (navy block + utensil) — image is NOT NULL in the DB and
// the owner replaces these with real dish photos in the editor. Inline SVG = no network,
// never a broken image.
const PLACEHOLDER = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='120'%20height='120'%3E%3Crect%20width='120'%20height='120'%20fill='%232d3142'/%3E%3Ctext%20x='60'%20y='78'%20font-size='52'%20text-anchor='middle'%3E%F0%9F%8D%BD%EF%B8%8F%3C/text%3E%3C/svg%3E";

// category slug -> [name, icon, color]
const CATS = [
  ["beverages", "Beverages", "fa-mug-hot", "#e8772e"],
  ["soups", "Soups", "fa-bowl-food", "#c79a3e"],
  ["salads", "Salads", "fa-leaf", "#8bbf3c"],
  ["sides", "Sides & Papad", "fa-plate-wheat", "#c79a3e"],
  ["starters", "Starters", "fa-pepper-hot", "#e8772e"],
  ["tandoor", "Tandoor Starters", "fa-fire", "#e8772e"],
  ["sizzlers", "Sizzlers", "fa-fire-burner", "#e8772e"],
  ["chinese-starters", "Chinese Starters", "fa-bowl-rice", "#c79a3e"],
  ["pasta", "Pasta", "fa-wheat-awn", "#c79a3e"],
  ["sandwich", "Sandwich", "fa-bread-slice", "#c79a3e"],
  ["pizza", "Pizza", "fa-pizza-slice", "#e8772e"],
  ["noodles-rice", "Noodles & Rice", "fa-bowl-rice", "#c79a3e"],
  ["thai", "Thai", "fa-bowl-food", "#8bbf3c"],
  ["paneer", "Paneer Specials", "fa-cheese", "#e8772e"],
  ["kaju-cheese", "Kaju & Cheese", "fa-cheese", "#c79a3e"],
  ["indian-mains", "Indian Delicacies", "fa-utensils", "#e8772e"],
  ["kofta", "Kofta", "fa-bowl-food", "#c79a3e"],
  ["dal", "Dal", "fa-bowl-food", "#c79a3e"],
  ["rice-biryani", "Rice & Biryani", "fa-bowl-rice", "#c79a3e"],
  ["bread", "Indian Bread", "fa-bread-slice", "#c79a3e"],
  ["mexican-rice", "Mexican Rice", "fa-bowl-rice", "#e8772e"],
  ["dessert", "Dessert", "fa-ice-cream", "#8bbf3c"],
];

// category slug -> [ [title, price, desc, ...extraTags] ]  (all veg; "special" → bestseller+chefs-special)
const ITEMS = {
  "beverages": [
    ["Virgin Mojito", 219, "Crushed lime & mint with brown sugar, mint & lemon"],
    ["Litchi Cooler", 229, "Litchi with a twist of lemon & fizz"],
    ["Blue Perish", 219, "Fizzy blue curacao with lemon juice & sprite"],
    ["Fruit Punch", 229, "Mix fruit juice blended with vanilla & topped fruit"],
    ["Strawberry Punch", 229, "Strawberry crush & ice cream with sprite"],
    ["Mango Hawai", 229, "Butterscotch & vanilla ice cream with mango & coconut milk"],
    ["Cold Coffee with Ice Cream", 239, "Creamy cold coffee with a scoop of ice cream"],
    ["Oreo Shake", 239, "Thick Oreo cookie shake"],
  ],
  "soups": [
    ["Tomato Soup", 199, "All-time favourite tomato soup"],
    ["Cheese Corn Tomato Soup", 209, "Tomato base with fresh corn & grated cheese"],
    ["Hot & Sour Soup", 219, "Chinese soup with mushroom, bamboo shoot & veggies"],
    ["Manchow Soup", 219, "Hot & spicy soup topped with fried noodles"],
    ["Veg Sweet Corn Soup", 219, "Sweet corn soup with vegetables"],
    ["Tom Yum Soup", 229, "Thai clear broth with mushroom, lemongrass & lime"],
    ["Broccoli Almond Soup", 229, "Creamy broccoli soup garnished with almond"],
    ["Thai Coconut Soup", 269, "Coconut milk with Thai basil & lemongrass"],
  ],
  "salads": [
    ["Fresh Green Salad", 199, "Cucumber, tomato, beetroot & carrot"],
    ["Peanut Salad", 269, "Onion, tomato, green chillies, peanuts & coriander"],
    ["Mexican Tortilla Salad", 269, "Kidney beans, baked beans, bell peppers & tortilla"],
    ["Pasta Salad", 199, "Pasta, bell pepper, basil & chilly sauce"],
    ["Russian Salad", 299, "Fruits & veggies in cream"],
    ["Waldorf Salad", 299, "Rich cream with walnut & apple"],
    ["Caesar Salad", 289, "Iceberg, mayo, cream & croutons with chilly flakes"],
  ],
  "sides": [
    ["Masala Papad", 69, "Cucumber, tomato, onion & salt on crisp papad"],
    ["Cheese Chilly Papad", 109, "Cheese, green chilly & coriander"],
    ["French Fries", 159, "Classic crispy fries"],
    ["Peri Peri French Fries", 179, "Spicy peri peri masala fries"],
    ["Over Loaded French Fries", 249, "Fries topped with mixed sauce"],
    ["Sweet & Salted Lassi", 229, "Thick churned yogurt drink"],
    ["Choice of Raita", 169, "Boondi / veg / pineapple raita"],
  ],
  "starters": [
    ["Nachos", 299, "Classic nachos with cheese sauce & salsa"],
    ["Nachos Supreme", 299, "Beans, bell pepper & kidney beans in cheese & salsa"],
    ["Tacos", 299, "Classic tacos with cheese sauce & salsa"],
    ["Cheese Cigar", 309, "Cheese, bell pepper & jalapeno rolls in thousand island"],
    ["Cheese Ball", 319, "Cheese balls with pesto dip"],
    ["Spinach Cheese Ball", 329, "Cheese & spinach balls with pesto dip"],
    ["Bruschetta Veg", 349, "Tomato, bell pepper, olives, cheese & basil"],
    ["Cottage Cheese Pesto", 379, "Finger-cut cottage cheese with pesto sauce"],
  ],
  "tandoor": [
    ["Hara Bhara Kabab", 309, "Spinach & cottage cheese kebabs with green chutney"],
    ["Veg Seekh Kabab", 299, "Minced veg seasoned with spices, grilled on charcoal"],
    ["Raja Kabab", 299, "Potato, green peas & cottage cheese kababs"],
    ["Dahi Kabab", 309, "Hung curd with spices, onion & green chilli kebabs"],
    ["Paneer Tikka Dry", 389, "Diced paneer in tandoori yogurt marination"],
    ["Malai Paneer Tikka", 389, "Soft paneer with cream cheese & cashews"],
    ["Paneer Afghani", 399, "Paneer stuffed with dry fruit & cheese in tandoori masala"],
    ["Assorted Platter", 469, "Tandoori potato, cauliflower, hara bhara, paneer & baby corn", "chefs-special"],
  ],
  "sizzlers": [
    ["Aangan Special Sizzler", 599, "Our chef's special sizzler", "special"],
    ["Italian King Sizzler", 549, "Spaghetti & exotic veg in garlic olive oil with fries"],
    ["Paneer on the Rock Sizzler", 549, "Butter rice, veg, pasta & paneer tikka in shashlik sauce"],
    ["Sizzling Mexicano Sizzler", 549, "Crispy potato turnovers with Mexican rice & salsa"],
    ["Chinese Sizzler in Chilli Garlic", 549, "Paneer chilli & manchurian with rice & noodles"],
  ],
  "chinese-starters": [
    ["Veg Manchurian Dry/Gravy", 319, "Fried veg balls in manchurian sauce"],
    ["Veg Spring Roll", 309, "Julienne veg wrapped & deep fried"],
    ["Paneer Chilly Dry/Gravy", 389, "Diced paneer tossed with green chilli & soya"],
    ["Veg Wonton", 299, "Wonton sautéed with hot schezwan sauce"],
    ["American Corn & Salt Pepper", 329, "Corn with chilli flakes, capsicum & black pepper"],
    ["Honey Chilly Potato", 299, "Crispy potato in fiery chilli sauce & honey"],
    ["Crispy Corn Chilly", 349, "Crispy sweet corn with onion, garlic & pepper"],
    ["Dragon Paneer", 399, "Cottage cheese, schezwan sauce & crackling spinach"],
  ],
  "pasta": [
    ["Make Your Own Pasta", 359, "Penne/fusilli/spaghetti with arrabbiata/alfredo/pesto"],
    ["Ravioli Pasta", 399, "Choice of arrabbiata / alfredo / pesto"],
    ["Baked Macaroni with Pineapple", 349, "All-time favourite baked macaroni"],
    ["Baked Enchiladas", 399, "Corn tortilla stuffed with refried beans & baked cheese"],
    ["Baked Lasagna", 399, "White sauce & cheese veggies"],
    ["Baked Cannelloni", 409, "Veggies baked in white cheese & red sauce"],
    ["Veg Florentine", 349, "Assorted veggies baked in cheese sauce"],
  ],
  "sandwich": [
    ["Bread Butter", 149, "Simple buttered bread"],
    ["Cheese Chilli Toast", 209, "Grilled cheese chilli toast"],
    ["Cheese Chutney Sandwich", 219, "Cheese with green chutney"],
    ["Bombay Club Veg Sandwich", 269, "Tomato, cucumber, potato-peas stuffing & cheese"],
  ],
  "pizza": [
    ["Margherita Double Cheese Pizza", 449, "Loaded with cheese (8 inch)"],
    ["Veggie Bite Pizza", 479, "Onion, green pepper & tomato loaded with cheese"],
    ["Rustic Italian Pizza", 479, "Oven-dried tomatoes, capsicum, black olives & chilli flakes"],
    ["Mexican Delight Pizza", 479, "Kidney beans, sweet corn, tomato, olive & jalapeno"],
    ["Tandoori Paneer Pizza", 489, "Tandoori paneer, capsicum & onion with cheese"],
    ["Peri Peri Pizza", 419, "Onion, olives, peri peri sauce & cheese"],
  ],
  "noodles-rice": [
    ["Wok Tossed Hakka Noodles", 280, "Noodles tossed with carrot, cabbage, capsicum & beans"],
    ["Chilly Garlic Noodles", 339, "Noodles with veg, fried garlic & chilli, spicy"],
    ["Veg Manchurian Noodles/Rice", 349, "Kids' special manchurian with noodles or rice"],
    ["Triple Schezwan Rice", 339, "Schezwan rice, crispy noodles & spicy veg gravy"],
    ["American Chop Suey", 299, "Crispy noodles sautéed with veg & tangy sauce"],
    ["Schezwan Fried Rice", 319, "Rice & diced veg tossed in chilli oil & schezwan"],
    ["Veg Fried Rice", 299, "Rice tossed with vegetables"],
    ["Chinese Bhel", 309, "Rice, noodles, manchurian & veggies, med spicy"],
  ],
  "thai": [
    ["Thai Green Curry", 499, "Exotic mix veg in coconut milk green curry with rice"],
    ["Paneer & Baby Corn Thai Red Curry", 499, "Paneer & baby corn in lemongrass red curry with rice"],
  ],
  "paneer": [
    ["Aangan Special Paneer", 459, "Our chef's special paneer", "special"],
    ["Paneer Rara", 399, "Paneer cubes in brown gravy with garlic & kasuri methi"],
    ["Paneer Khurchan", 399, "Paneer in rich, creamy, mildly spicy gravy"],
    ["Paneer Makhani", 399, "Malai paneer in silky tomato gravy with butter"],
    ["Paneer Tikka Methi Garlic Masala", 409, "Chef's special — just try it", "chefs-special"],
    ["Balti Paneer", 409, "Two cuts of paneer in red gravy, layered in a balti"],
    ["Paneer Pasanda", 429, "Sliced paneer stuffed with herbs & cashew in brown gravy"],
    ["All Time Favourite Paneer", 419, "Kadai/Handi/Tikka Masala/Butter/Lasuni/Mutter/Palak"],
  ],
  "kaju-cheese": [
    ["Cheese Butter Masala", 449, "All-time favourite cheese in butter masala"],
    ["Kaju Kadai", 419, "Fried cashew sautéed with onion, tomato & capsicum"],
    ["Kaju Butter Masala", 419, "Fried cashew in rich makhani gravy, med spicy"],
    ["Khoya Kaju", 419, "Fried cashew in sweet creamy cashew gravy"],
  ],
  "indian-mains": [
    ["Aangan Special Veg", 419, "Our chef's special vegetable", "special"],
    ["Subzi Lababdar", 389, "Assorted vegetables in tangy tomato gravy"],
    ["Teekha Subzi Handi", 399, "Cauliflower, peas & peppers in richly spiced masala"],
    ["Navratna Korma", 399, "Mix veg in rich cashew nut gravy"],
    ["Veg Jaipuri", 349, "Mix veg in spicy brown gravy, garnished with papad"],
    ["Baby Corn Achari Masala", 359, "Tender baby corn in pickling masala"],
    ["Veg Makhanwala", 349, "Veggies, khoya, paneer & cheese in red gravy"],
    ["Aloo Mutter", 329, "Diced aloo with fresh green peas in brown gravy"],
  ],
  "kofta": [
    ["Dum Aloo Punjabi", 369, "Stuffed baby potatoes in spicy yogurt gravy"],
    ["Malai Kofta", 419, "Kofta in rich cashew gravy"],
    ["Karachi Kofta", 399, "Tender vegetable balls in spicy brown gravy"],
    ["Cheese Kofta Masaledar", 439, "Grated cheese dumplings in cashew gravy, med sweet"],
    ["Veg Kofta Curry", 409, "Soft cottage cheese & veggie dumplings, med spicy"],
  ],
  "dal": [
    ["Aangan Special Dal", 309, "Toor & black urad dal, Punjabi style", "special"],
    ["Dal Fry", 259, "Lentils tempered with butter, cumin & red chilli"],
    ["Dal Tadka", 259, "Lentils in thick gravy tempered with butter & cumin"],
    ["Dal Makhani", 319, "Black urad dal & rajma in butter & cream"],
    ["Dal Palak", 259, "Spinach cooked in toovar dal with spices"],
    ["Dal Panchratna", 299, "Five mix dals cooked with Indian spices"],
  ],
  "rice-biryani": [
    ["Aangan Special Pulao", 359, "Our chef's special pulao", "special"],
    ["Steam Rice", 209, "Steamed basmati rice"],
    ["Jeera Rice", 249, "Cumin tossed in butter with basmati rice & coriander"],
    ["Veg Pulao", 279, "Mix veg tossed in butter with basmati & spices"],
    ["Veg Hyderabadi Biryani", 399, "Minty flavoured rice with fried onions"],
    ["Veg Dum Biryani", 399, "Long-grain rice with aromatic spices & veg, dum-cooked"],
    ["Special Khichdi", 299, "Plain / masala / vegetable / palak khichdi"],
  ],
  "bread": [
    ["Butter Roti", 59, "Tandoori roti with butter"],
    ["Lachha Paratha", 99, "Flaky layered paratha"],
    ["Butter Naan", 99, "Soft tandoori naan with butter"],
    ["Garlic Naan", 140, "Naan topped with garlic"],
    ["Hariyali Naan", 139, "Naan with fresh herbs"],
    ["Paneer Kulcha", 199, "Kulcha stuffed with spiced paneer"],
    ["Cheese Naan", 219, "Naan stuffed with cheese"],
    ["Cheese Chilli Garlic Naan", 219, "Naan with cheese, chilli & garlic"],
  ],
  "mexican-rice": [
    ["Mexican Hot Pot Rice", 419, "Rice with tomato, onion, garlic & kidney beans, sour cream"],
    ["Mexican Rice with Salsa Curry", 419, "Assorted veggies in tangy salsa curry"],
  ],
  "dessert": [
    ["Choice of Ice Cream", 99, "Vanilla / strawberry / chocolate"],
    ["American Nuts Ice Cream", 139, "Nutty American ice cream"],
    ["Almond Carnival Ice Cream", 139, "Almond ice cream"],
    ["Sizzling Brownie with Vanilla", 299, "Hot brownie with vanilla ice cream", "chefs-special"],
    ["Gulab Jamun", 140, "Warm gulab jamun"],
    ["Mung Dal Halvo", 165, "Rich moong dal halwa"],
  ],
};

const FILTERS = [
  ["veg", "Veg", "🌿", 1],
  ["bestseller", "Bestseller", "🔥", 2],
  ["chefs-special", "Chef's Special", "⭐", 3],
  ["jain", "Jain Available", "🟢", 4],
  ["spicy", "Spicy", "🌶️", 5],
];

const categories = CATS.map(([slug, name, icon, color], i) => ({
  slug, icon, color, sortOrder: i + 1, active: true, name: { en: name },
}));
const filters = FILTERS.map(([slug, name, icon, sortOrder]) => ({ slug, icon, sortOrder, active: true, name: { en: name } }));

const items = [];
let order = 0;
for (const [cat] of CATS) {
  const rows = ITEMS[cat] || [];
  rows.forEach(([title, price, description, ...extra]) => {
    const tags = ["veg"];
    if (extra.includes("special")) tags.push("bestseller", "chefs-special");
    for (const e of extra) if (e !== "special" && !tags.includes(e)) tags.push(e);
    items.push({
      slug: slugify(title), title, price: String(price), image: PLACEHOLDER, category: cat,
      veg: true, is4d: false, description, tags,
    });
    order++;
  });
}

const out = { categories, filters, items };
writeFileSync(join(root, "public", "content", "aangan-menu.json"), JSON.stringify(out, null, 2));
console.log(`✓ aangan-menu.json: ${categories.length} categories, ${filters.length} filters, ${items.length} items`);
