// Shared data layer for the menu.
//
// Reads come from the Supabase `menu_items` table using the ANON (public) key
// — the same client in lib/supabase.ts. The table's RLS policy allows public
// SELECT, so no auth is needed. The service-role key is NEVER used here; it
// stays server-side only (see scripts/seed-supabase.mjs).
//
// The DB stores columns in snake_case; the app works in camelCase. The mapping
// happens in `mapRow` so the rest of the app doesn't change shape.

import { supabase } from "./supabase";

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
  rating: string;
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
export function localized(text: LocalizedText | undefined, lang: string): string {
  if (!text) return "";
  return text[lang] || text.en || Object.values(text)[0] || "";
}

// One DB row (snake_case) -> one app object (camelCase).
function mapRow(row: any): MenuItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    price: row.price,
    image: row.image,
    category: row.category,
    veg: !!row.veg,
    is4d: !!row.is4d,
    modelFolder: row.model_folder ?? undefined,
    modelSmallUrl: row.model_small_url ?? undefined,
    modelOptimizedUrl: row.model_optimized_url ?? undefined,
    description: row.description ?? "",
    longDescription: row.long_description ?? "",
    rating: row.rating ?? "0",
    time: row.time ?? "",
    nutrition: row.nutrition ?? { calories: "", protein: "", carbs: "", sugar: "" },
    ingredients: row.ingredients ?? [],
    reviews: row.reviews ?? [],
    relatedSlugs: row.related_slugs ?? [],
    tags: row.tags ?? [],
    allergens: row.allergens ?? [],
    searchAlias: row.search_alias ?? "",
    options: Array.isArray(row.options) ? row.options : [],
  };
}

// Record a placed order. Public (anon) insert is allowed by RLS; the order is
// write-only for the public — only the owner (service role) can read orders back.
export interface OrderInput {
  tableNumber: string;
  items: { id: string; title: string; price: string; qty: number; options?: { group: string; label: string; price: number }[]; removed?: string[]; note?: string }[];
  subtotal: number;
  tax: number;
  total: number;
  allergies: string[];
}
// Guest taps "Call a Waiter" — inserts a row the restaurant sees live in the editor.
export async function callWaiter(tableNumber: string, note?: string): Promise<void> {
  const { error } = await supabase.from("waiter_calls").insert({
    table_number: tableNumber || null,
    note: note || null,
  });
  if (error) throw new Error(`Call failed: ${error.message}`);
}

// Order lifecycle status. The restaurant advances received -> preparing -> served.
export type OrderStatus = "received" | "preparing" | "served" | "cancelled";

// Returns the new order's id. We generate the id on the client so the guest's
// device can follow ONLY its own order later (the table is insert-only for the
// public, so we can't read the id back via .select()).
export async function createOrder(o: OrderInput): Promise<string> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { error } = await supabase.from("orders").insert({
    id,
    table_number: o.tableNumber || null,
    items: o.items,
    subtotal: o.subtotal,
    tax: o.tax,
    total: o.total,
    allergies: o.allergies,
    status: "received",
  });
  if (error) throw new Error(`Order failed: ${error.message}`);
  return id;
}

// A guest corrects only their own order's table number (migration 007). Only
// works while the order is still open (received/preparing); returns true on success.
export async function updateOrderTableNumber(
  id: string,
  tableNumber: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_order_table_number", {
    order_id: id,
    new_table: tableNumber,
  });
  return !error && Array.isArray(data) && data.length > 0;
}

// A guest reads only their own order's status via a SECURITY DEFINER function
// (migration 006), so no one can list everyone else's orders.
export async function getOrderStatus(
  id: string
): Promise<{ status: OrderStatus; tableNumber: string | null; createdAt: string } | null> {
  const { data, error } = await supabase.rpc("get_order_status", { order_id: id });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { status: OrderStatus; table_number: string | null; created_at: string };
  return { status: row.status, tableNumber: row.table_number, createdAt: row.created_at };
}

// All menu items, in the order set by `sort_order`.
export async function getMenuItems(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .order("sort_order");
  if (error) throw new Error(`Failed to load menu: ${error.message}`);
  return (data ?? []).map(mapRow);
}

// A single item by slug, or null if it doesn't exist.
export async function getMenuItem(slug: string): Promise<MenuItem | null> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Failed to load item "${slug}": ${error.message}`);
  return data ? mapRow(data) : null;
}

// Active categories, in display order. The virtual "All" tab is added by the UI.
export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) throw new Error(`Failed to load categories: ${error.message}`);
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
}
export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", "site")
    .maybeSingle();
  if (error) throw new Error(`Failed to load settings: ${error.message}`);
  return {
    bubblesEnabled: data ? data.bubbles_enabled !== false : true,
    serviceMode: data ? data.service_mode === true : false,
    // Number(...) || 0 so a missing/NaN value disables the upper-bound check
    // rather than blocking every order.
    tableCount: data ? Number(data.table_count) || 0 : 0,
  };
}

