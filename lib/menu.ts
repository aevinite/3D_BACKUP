// Shared data layer for the menu.
//
// Reads come from the Supabase `menu_items` table using the ANON (public) key
// — the same client in lib/supabase.ts. The table's RLS policy allows public
// SELECT, so no auth is needed. The service-role key is NEVER used here; it
// stays server-side only (see scripts/seed-supabase.mjs).
//
// The DB stores columns in snake_case; the app works in camelCase. The mapping
// happens in `mapRow` so the rest of the app doesn't change shape.

// Grab the shared database connection we set up in supabase.ts.
import { supabase } from "./supabase";

// The shape of one dish in the app. Every field a menu card / detail page might
// need lives here. Some fields are optional (marked with "?") because not every
// dish has, say, a 3D model.
export interface MenuItem {
  id: string;
  slug: string;
  title: string;
  price: string;
  image: string;
  category: string;
  veg: boolean;
  is4d: boolean;
  modelFolder?: string;
  modelSmallUrl?: string;
  modelOptimizedUrl?: string;
  description: string;
  longDescription: string;
  rating: string;       // average of REAL reviews ("" when there are none yet -> UI shows "New")
  reviewCount: number;  // how many real reviews exist (from the item_ratings view)
  time: string;
  nutrition: { calories: string; protein: string; carbs: string; sugar?: string };
  ingredients: { emoji: string; name: string }[];
  reviews: { name: string; rating: number; text: string }[];
  relatedSlugs: string[];
  tags: string[];
  allergens: string[];
  searchAlias: string; // hidden synonyms for search (e.g. "caesar, healthy")
  options: OptionGroup[]; // per-dish customization (size, milk, extras…)
}

// A customization group the owner defines and the guest picks from.
export interface OptionGroup {
  name: string;
  type: "single" | "multi"; // single = pick one (radio), multi = pick any (checkbox)
  choices: { label: string; price: number }[]; // price is added to the base price
}

// A label that exists in several languages, e.g. { en: "Burgers", de: "Burger" }.
export type LocalizedText = Record<string, string>;

export interface Category {
  slug: string;
  name: LocalizedText;
  icon?: string;   // FontAwesome class, e.g. "fa-burger"
  color?: string;  // hex accent
  sortOrder: number;
  active: boolean;
}

// Pick the label for a language, falling back to English, then to whatever
// exists, so the UI never shows a blank.
// Example: localized({ en: "Burgers", de: "Burger" }, "de") -> "Burger".
export function localized(text: LocalizedText | undefined, lang: string): string {
  // Nothing to translate — give back an empty string.
  if (!text) return "";
  // Try the asked-for language; if missing, fall back to English; if that's
  // missing too, use the first translation we have. "||" picks the first
  // non-empty option in that order.
  return text[lang] || text.en || Object.values(text)[0] || "";
}

// One DB row (snake_case) -> one app object (camelCase).
// The database names columns like `model_folder`; the app prefers `modelFolder`.
// This function does that rename, and fills in safe defaults for any missing
// field so the rest of the app never has to worry about empty/null data.
// The aggregate row for one dish from the `item_ratings` view (migration 030):
// the average stars + count of REAL customer reviews. Both the menu cards and
// the dish page read this same view, so the two can never disagree.
type RatingAgg = { item_slug: string; avg_rating: number | string | null; review_count: number | null };

function mapRow(row: any, agg?: RatingAgg): MenuItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    price: row.price,
    image: row.image,
    category: row.category,
    // "!!" forces the value into a strict true/false (e.g. turns 1 into true).
    veg: !!row.veg,
    is4d: !!row.is4d,
    // "??" means "use the left side, but if it's null/undefined use the right".
    // So here: keep the DB value, otherwise leave it unset.
    modelFolder: row.model_folder ?? undefined,
    modelSmallUrl: row.model_small_url ?? undefined,
    modelOptimizedUrl: row.model_optimized_url ?? undefined,
    description: row.description ?? "",
    longDescription: row.long_description ?? "",
    // Rating comes ONLY from real reviews now (the old per-dish seed number was
    // fake). Empty string = no reviews yet; the UI shows a "New" badge instead.
    // toFixed(1) so the card says "5.0" exactly like the dish page does.
    rating: agg?.avg_rating != null ? Number(agg.avg_rating).toFixed(1) : "",
    reviewCount: agg?.review_count ?? 0,
    time: row.time ?? "",
    nutrition: row.nutrition ?? { calories: "", protein: "", carbs: "", sugar: "" },
    ingredients: row.ingredients ?? [],
    reviews: row.reviews ?? [],
    relatedSlugs: row.related_slugs ?? [],
    tags: row.tags ?? [],
    allergens: row.allergens ?? [],
    searchAlias: row.search_alias ?? "",
    // Only keep `options` if it really is a list; otherwise use an empty list
    // so code that loops over options never breaks.
    options: Array.isArray(row.options) ? row.options : [],
  };
}

// Record a placed order. The browser sends ONLY item id + qty + chosen options
// (group/label) — never prices. The server (lfh_place_order_public) looks up every
// price from menu_items, recomputes the bill, rejects sold-out/unknown items, and
// stores the order. So nothing money-related here is trusted.
export interface OrderInput {
  tableNumber: string;
  items: { id: string; qty: number; options?: { group: string; label: string }[]; removed?: string[]; note?: string }[];
  allergies: string[];
}
// Guest taps "Call a Waiter" — inserts a row the restaurant sees live in the editor.
// `async` means this talks to the database and we wait for it to finish.
export async function callWaiter(tableNumber: string, note?: string): Promise<void> {
  // Add a new row to the `waiter_calls` table. "|| null" stores an empty value
  // as a proper blank in the database rather than an empty string.
  const { error } = await supabase.from("waiter_calls").insert({
    table_number: tableNumber || null,
    note: note || null,
  });
  // If the database refused, raise a clear error the caller can show/handle.
  if (error) throw new Error(`Call failed: ${error.message}`);
}

// Order lifecycle status. The restaurant advances received -> preparing -> served.
export type OrderStatus = "received" | "preparing" | "served" | "cancelled";

// Returns the new order's id. We generate the id on the client so the guest's
// device can follow ONLY its own order later (the table is insert-only for the
// public, so we can't read the id back via .select()).
export async function createOrder(o: OrderInput): Promise<string> {
  // Call the server function that prices and stores the order. It returns the
  // new order's id (the SERVER generates it) so the device can poll its status.
  const { data, error } = await supabase.rpc("lfh_place_order_public", {
    p_table: o.tableNumber || "",
    p_items: o.items,
    p_allergies: o.allergies,
  });
  if (error) throw new Error(`Order failed: ${error.message}`);
  // The function answers { ok, order_id } on success, or { ok:false, reason }
  // (e.g. a sold-out or unknown dish slipped through) which we surface as an error.
  const res = (data ?? {}) as { ok?: boolean; reason?: string; item?: string; order_id?: string };
  if (!res.ok || !res.order_id) {
    throw new Error(`Order failed: ${res.reason || "unknown"}${res.item ? ` (${res.item})` : ""}`);
  }
  return res.order_id;
}

// A guest corrects only their own order's table number (migration 007). Only
// works while the order is still open (received/preparing); returns true on success.
export async function updateOrderTableNumber(
  id: string,
  tableNumber: string
): Promise<boolean> {
  // `.rpc(...)` calls a database FUNCTION (a bit of logic that lives in the DB)
  // by name, here "set_order_table_number", passing the order id and new table.
  const { data, error } = await supabase.rpc("set_order_table_number", {
    order_id: id,
    new_table: tableNumber,
  });
  // Success means: no error AND the function returned at least one row (proof a
  // matching, still-open order was actually updated).
  return !error && Array.isArray(data) && data.length > 0;
}

// A guest reads only their own order's status via a SECURITY DEFINER function
// (migration 006), so no one can list everyone else's orders.
export async function getOrderStatus(
  id: string
): Promise<{ status: OrderStatus; tableNumber: string | null; createdAt: string } | null> {
  // Ask the database function for just this one order's status.
  const { data, error } = await supabase.rpc("get_order_status", { order_id: id });
  // Anything wrong or no matching order -> return null (caller treats as "unknown").
  if (error || !Array.isArray(data) || data.length === 0) return null;
  // Take the first (only) row. "as { ... }" just tells TypeScript its shape.
  const row = data[0] as { status: OrderStatus; table_number: string | null; created_at: string };
  // Re-label the snake_case DB fields into the camelCase the app expects.
  return { status: row.status, tableNumber: row.table_number, createdAt: row.created_at };
}

// All menu items, in the order set by `sort_order`.
// This is the main "fetch the whole menu from the database" function.
export async function getMenuItems(): Promise<MenuItem[]> {
  // Fetch the dishes AND the real-review aggregates at the same time (parallel
  // requests — no extra waiting). Ratings failing must never hide the menu, so
  // its error is swallowed and dishes just show as unrated.
  const [items, ratings] = await Promise.all([
    supabase.from("menu_items").select("*").order("sort_order"),
    supabase.from("item_ratings").select("*"),
  ]);
  if (items.error) throw new Error(`Failed to load menu: ${items.error.message}`);
  // Index the aggregates by slug for a quick lookup while mapping each dish.
  const aggBySlug = new Map<string, RatingAgg>(((ratings.data as RatingAgg[] | null) ?? []).map((r) => [r.item_slug, r]));
  return (items.data ?? []).map((row) => mapRow(row, aggBySlug.get(row.slug)));
}

// A single item by slug, or null if it doesn't exist.
// A "slug" is the short URL-friendly name, e.g. "classic-burger".
export async function getMenuItem(slug: string): Promise<MenuItem | null> {
  // Three parallel reads: the dish, its rating aggregate, and its newest
  // real reviews (capped at 20 so a popular dish can't flood the page).
  const [item, agg, revs] = await Promise.all([
    supabase.from("menu_items").select("*").eq("slug", slug).maybeSingle(),
    supabase.from("item_ratings").select("*").eq("item_slug", slug).maybeSingle(),
    supabase.from("reviews").select("name, stars, comment, created_at").eq("item_slug", slug).order("created_at", { ascending: false }).limit(20),
  ]);
  if (item.error) throw new Error(`Failed to load item "${slug}": ${item.error.message}`);
  if (!item.data) return null;
  const mapped = mapRow(item.data, (agg.data as RatingAgg | null) ?? undefined);
  // Replace the (now always-empty) seeded reviews with the real ones, reshaped
  // to the { name, rating, text } shape the dish page already renders.
  mapped.reviews = ((revs.data as { name: string | null; stars: number; comment: string | null }[] | null) ?? [])
    .map((r) => ({ name: r.name || "Guest", rating: r.stars, text: r.comment || "" }));
  return mapped;
}

// The newest real reviews for one dish (capped at 20), reshaped to the
// { name, rating, text } shape the dish page renders.
export async function getItemReviews(slug: string): Promise<{ name: string; rating: number; text: string }[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("name, stars, comment, created_at")
    .eq("item_slug", slug)
    .order("created_at", { ascending: false })
    .limit(20);
  // Reviews failing to load must never break the dish page — show none instead.
  if (error) return [];
  return (data ?? []).map((r) => ({ name: r.name || "Guest", rating: r.stars, text: r.comment || "" }));
}

// Save (or update) this device's rating for a dish. The server function
// validates stars/device/dish and upserts, so re-rating never duplicates.
export async function submitReview(
  slug: string, deviceId: string, stars: number, name: string, comment: string
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc("lfh_submit_review", {
    p_slug: slug, p_device: deviceId, p_stars: stars, p_name: name, p_comment: comment,
  });
  if (error) return { ok: false, reason: error.message };
  return (data ?? { ok: false, reason: "no response" }) as { ok: boolean; reason?: string };
}

// Active categories, in display order. The virtual "All" tab is added by the UI.
export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("active", true)    // only categories the owner has switched on
    .order("sort_order");
  if (error) throw new Error(`Failed to load categories: ${error.message}`);
  // Same snake_case -> camelCase tidy-up as mapRow, but for category rows.
  return (data ?? []).map((r) => ({
    slug: r.slug,
    name: r.name ?? {},
    icon: r.icon ?? undefined,
    color: r.color ?? undefined,
    sortOrder: r.sort_order ?? 0,
    active: !!r.active,
  }));
}

// Site-wide settings (single 'site' row). Defaults to bubbles on if missing.
export interface Settings {
  bubblesEnabled: boolean;
  serviceMode: boolean;
  tableCount: number; // how many tables exist; 0 = unknown (don't enforce an upper bound)
  // v2 dining-session system (all editor-configurable). sessionsEnabled OFF =>
  // the app behaves exactly like today (no session gating).
  sessionsEnabled: boolean;
  requireLocation: boolean;
  requireOtp: boolean;
  geoLat: number | null;   // café centre; null => location check bypassed (stub)
  geoLng: number | null;
  geoRadiusM: number;      // how far from the centre still counts as "at the café"
}
// Reads the single site-wide settings row and returns it with safe defaults,
// so the app still works even if settings haven't been configured yet.
export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", "site")   // all settings live in one row whose id is "site"
    .maybeSingle();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  // Small helper: turn a value into a number, or null if it's blank/not a number.
  const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
  // For each setting: if we have a row, read its value; otherwise use a default.
  // Note "!== false" means "treat anything except an explicit false as on" —
  // that's how these flags default to ON unless the owner turned them off.
  return {
    bubblesEnabled: data ? data.bubbles_enabled !== false : true,
    serviceMode: data ? data.service_mode === true : false,
    // Number(...) || 0 so a missing/NaN value disables the upper-bound check
    // rather than blocking every order.
    tableCount: data ? Number(data.table_count) || 0 : 0,
    sessionsEnabled: data ? data.sessions_enabled === true : false,
    requireLocation: data ? data.require_location !== false : true,
    requireOtp: data ? data.require_otp !== false : true,
    geoLat: data ? num(data.geo_lat) : null,
    geoLng: data ? num(data.geo_lng) : null,
    geoRadiusM: data ? Number(data.geo_radius_m) || 250 : 250,
  };
}

