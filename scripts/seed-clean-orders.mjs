// Create CLEAN, CONSISTENT dine-in test orders via the staff RPC (lfh_staff_place_order).
// This writes orders + order_items + session all in sync (unlike the old raw-insert seeders),
// so Accept, the kitchen board, and the bill math all agree.
//
// Usage: node scripts/seed-clean-orders.mjs <restaurant-slug> [tablesCSV]
//   e.g. node scripts/seed-clean-orders.mjs french-house 5,6,7
// Prints order ids / kot / table only — never any secret.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(".env.local", "utf8");
const get = (k) => ((env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1] || "").trim().replace(/^["']|["']$/g, "");
const url = get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL");
const key = get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) { console.log("FAIL: missing Supabase url/service key in .env.local"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const slug = process.argv[2] || "french-house";
const tables = (process.argv[3] || "5,6,7").split(",").map((s) => s.trim()).filter(Boolean);

(async () => {
  const { data: rest, error: re } = await sb.from("restaurants").select("id,name").eq("slug", slug).maybeSingle();
  if (re || !rest) { console.log("FAIL: restaurant not found for slug", slug, re?.message || ""); process.exit(1); }
  console.log(`Restaurant: ${rest.name} (${slug})`);

  // in-stock menu slugs for this restaurant
  const { data: items, error: ie } = await sb
    .from("menu_items").select("id,slug,title,tags").eq("restaurant_id", rest.id).limit(50);
  if (ie) { console.log("FAIL: menu read", ie.message); process.exit(1); }
  // lfh_price_order looks dishes up by menu_items.id (not slug) and rejects sold-out (tags).
  const inStock = (items || []).filter((m) => !(m.tags || []).includes("sold-out"));
  if (inStock.length < 2) { console.log("FAIL: not enough in-stock dishes", inStock.length); process.exit(1); }
  console.log(`In-stock dishes: ${inStock.length} (e.g. ${inStock.slice(0, 4).map((m) => m.title).join(", ")})`);

  // place a varied order on each table
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const d1 = inStock[i % inStock.length];
    const d2 = inStock[(i + 1) % inStock.length];
    const pick = [
      { id: d1.id, qty: 1 + (i % 2) },
      { id: d2.id, qty: 1 },
    ];
    const { data, error } = await sb.rpc("lfh_staff_place_order", {
      p_table: String(t),
      p_items: pick,
      p_allergies: [],
      p_note: "seed-clean-orders test",
      p_restaurant_id: rest.id,
    });
    if (error) { console.log(`  table ${t}: RPC ERROR ${error.message}`); continue; }
    console.log(`  table ${t}: ${data?.ok ? "OK" : "FAIL " + JSON.stringify(data)}  order=${data?.order_id || "-"} kot=${data?.kot_no ?? "-"}  items=${[d1.title + "×" + pick[0].qty, d2.title + "×" + pick[1].qty].join(", ")}`);
  }
  console.log("DONE — orders are in 'received' state (ready to Accept).");
})();
