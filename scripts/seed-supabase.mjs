// Seed the Supabase `menu_items` table from public/content/menu.json.
//
// What it does, in order:
//   1. Runs supabase/migrations/001_menu_items.sql via the Supabase
//      Management API (uses the personal access token / PAT).
//   2. Upserts all menu items using the SERVICE ROLE key (server-side only).
//   3. Reads them back using the ANON key to prove public-read RLS works.
//
// No secrets live in this file — they are read at runtime from .env.local,
// which is gitignored.
//
// Run with:  node scripts/seed-supabase.mjs

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- tiny .env parser (avoids adding a dotenv dependency) ---
function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = parseEnv(readFileSync(join(root, ".env.local"), "utf8"));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const pat = env.SUPABASE_ACCESS_TOKEN;

const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];

if (!SUPABASE_URL || !ANON || !SERVICE) throw new Error("Missing keys in .env.local");
if (!pat) throw new Error("Missing SUPABASE_ACCESS_TOKEN in .env.local");

// Run arbitrary SQL through the Management API (uses the PAT).
async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${body}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- step 1: run every migration in supabase/migrations (in filename order) ---
async function runMigration() {
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await runSql(readFileSync(join(dir, file), "utf8"));
    console.log(`✓ ran migration ${file}`);
  }
  // PostgREST caches the schema; nudge it so the JS client sees new tables/columns.
  await runSql("NOTIFY pgrst, 'reload schema';");
  console.log("✓ schema is ready (menu_items, categories, filters)");
}

// --- step 2: map camelCase JSON -> snake_case DB rows, then upsert ---
function toRow(item, index) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    price: item.price,
    image: item.image,
    category: item.category,
    veg: item.veg ?? false,
    is4d: item.is4d ?? false,
    model_folder: item.modelFolder ?? null,
    model_small_url: item.modelSmallUrl ?? null,
    model_optimized_url: item.modelOptimizedUrl ?? null,
    description: item.description ?? null,
    long_description: item.longDescription ?? null,
    rating: item.rating ?? null,
    time: item.time ?? null,
    nutrition: item.nutrition ?? null,
    ingredients: item.ingredients ?? null,
    reviews: item.reviews ?? null,
    related_slugs: item.relatedSlugs ?? null,
    // Filter tags. Fall back to deriving from the veg flag so older menu.json
    // files without a `tags` field still seed sensibly.
    tags: item.tags ?? (item.veg ? ["veg"] : ["non-veg"]),
    allergens: item.allergens ?? [],
    sort_order: index,
  };
}

// camelCase JSON -> snake_case row for the categories / filters tables.
function toCategoryRow(c, index) {
  return {
    slug: c.slug,
    name: c.name,
    icon: c.icon ?? null,
    color: c.color ?? null,
    sort_order: c.sortOrder ?? index,
    active: c.active ?? true,
  };
}

function toFilterRow(f, index) {
  return {
    slug: f.slug,
    name: f.name,
    icon: f.icon ?? null,
    sort_order: f.sortOrder ?? index,
    active: f.active ?? true,
  };
}

// Generic upsert-with-retry (schema cache can lag a few seconds after DDL).
async function upsertRows(admin, table, rows, conflict) {
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { error } = await admin.from(table).upsert(rows, { onConflict: conflict });
    if (!error) {
      console.log(`✓ upserted ${rows.length} rows into ${table}`);
      return;
    }
    lastErr = error;
    if (!/schema cache/i.test(error.message)) break;
    console.log(`  …waiting for schema cache on ${table} (attempt ${attempt})`);
    await sleep(2000);
  }
  throw new Error(`Seed of ${table} failed: ${lastErr.message}`);
}

// Delete every row in a table (used by --replace for a clean rebuild).
// `.not(key,'is',null)` matches all rows (every row has a non-null key).
async function clearTable(admin, table, key) {
  const { error } = await admin.from(table).delete().not(key, "is", null);
  if (error) throw new Error(`Clear ${table} failed: ${error.message}`);
  console.log(`✓ cleared ${table}`);
}

async function seed() {
  const menu = JSON.parse(
    readFileSync(join(root, "public", "content", "menu.json"), "utf8")
  );

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });

  // --replace wipes everything first, so the DB mirrors menu.json exactly
  // (use it when rebuilding the whole menu, e.g. a brand-new restaurant).
  if (process.argv.includes("--replace")) {
    console.log("  --replace: clearing existing data…");
    await clearTable(admin, "menu_items", "id");
    await clearTable(admin, "categories", "slug");
    await clearTable(admin, "filters", "slug");
  }

  // Categories and filters first (menu_items.category references a category slug).
  if (menu.categories?.length) {
    await upsertRows(admin, "categories", menu.categories.map(toCategoryRow), "slug");
  }
  if (menu.filters?.length) {
    await upsertRows(admin, "filters", menu.filters.map(toFilterRow), "slug");
  }
  await upsertRows(admin, "menu_items", menu.items.map(toRow), "id");
}

// --- step 3: read back via the anon key to prove public RLS read works ---
async function verifyAnonRead() {
  const pub = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });

  const { data, error } = await pub
    .from("menu_items")
    .select("id, slug, title, tags")
    .order("sort_order");
  if (error) throw new Error(`Anon read failed: ${error.message}`);
  console.log(`✓ anon key can read ${data.length} items:`);
  for (const r of data) console.log(`    ${r.slug} — ${r.title} [${(r.tags ?? []).join(", ")}]`);

  const { data: cats, error: catErr } = await pub
    .from("categories")
    .select("slug")
    .order("sort_order");
  if (catErr) throw new Error(`Anon read of categories failed: ${catErr.message}`);
  console.log(`✓ anon key can read ${cats.length} categories: ${cats.map((c) => c.slug).join(", ")}`);

  const { data: fils, error: filErr } = await pub
    .from("filters")
    .select("slug")
    .order("sort_order");
  if (filErr) throw new Error(`Anon read of filters failed: ${filErr.message}`);
  console.log(`✓ anon key can read ${fils.length} filters: ${fils.map((f) => f.slug).join(", ")}`);
}

await runMigration();
await seed();
await verifyAnonRead();
console.log("\nDone.");
