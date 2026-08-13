// Seeds public/content/aangan-menu.json into AANGAN GARDEN RESTAURANT, scoped to its
// restaurant_id. Maps to snake_case + generates a unique menu_items.id per item (TEXT PK).
// Idempotent (upsert on the per-tenant keys). Run: node scripts/seed-aangan.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { refuseUnlessDevTestDb } from "./sweep/devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
// Which database is this? (T10 sweep, 2026-08-12 — this script had no answer.)
// One shared allow-list, in scripts/sweep/devStacks.mjs, so it knows about BOTH dev stacks
// (backup-1 and the backup-2 failover) and never about the client one.
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this seeds a whole restaurant's menu");

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const RID = "6c6fadb6-da23-4ab3-9f90-d164773f60b3"; // AANGAN GARDEN RESTAURANT
const menu = JSON.parse(readFileSync(join(root, "public", "content", "aangan-menu.json"), "utf8"));

const catRows = menu.categories.map((c, i) => ({
  restaurant_id: RID, slug: c.slug, name: c.name, icon: c.icon ?? null, color: c.color ?? null,
  sort_order: c.sortOrder ?? i, active: c.active ?? true,
}));
const filterRows = menu.filters.map((f, i) => ({
  restaurant_id: RID, slug: f.slug, name: f.name, icon: f.icon ?? null, sort_order: f.sortOrder ?? i, active: f.active ?? true,
}));
const itemRows = menu.items.map((it, i) => ({
  restaurant_id: RID, id: randomUUID(), slug: it.slug, title: it.title, price: it.price,
  image: it.image ?? null, category: it.category, veg: it.veg ?? true, is4d: false,
  model_folder: null, model_small_url: null, model_optimized_url: null,
  description: it.description ?? null, long_description: it.longDescription ?? null,
  rating: null, time: it.time ?? null, nutrition: null, ingredients: null, reviews: [],
  related_slugs: null, tags: it.tags ?? ["veg"], allergens: [], sort_order: i,
}));

const must = async (label, p) => { const { error } = await p; if (error) throw new Error(`${label}: ${error.message}`); console.log(`✓ ${label}`); };

await must(`categories (${catRows.length})`, sb.from("categories").upsert(catRows, { onConflict: "restaurant_id,slug" }));
await must(`filters (${filterRows.length})`, sb.from("filters").upsert(filterRows, { onConflict: "restaurant_id,slug" }));
await must(`menu_items (${itemRows.length})`, sb.from("menu_items").upsert(itemRows, { onConflict: "restaurant_id,slug" }));
console.log("✓ Aangan menu seeded.");
