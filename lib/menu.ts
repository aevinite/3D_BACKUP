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
// Single source of truth for the restaurant's effective tax rate AND for the three price
// behaviours (GST on top / GST inside / never taxed — migration 270). Never re-implement
// either rule here: a second copy is how the cart, the bill and the paper start disagreeing.
import { effectiveTaxRate, priceTaxMode, itemTaxModesAllowed, type DishTaxMode } from "./tax";
import { DEFAULT_RESTAURANT_ID } from "./tenant";

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
  // ── DETAIL-ONLY, and OPTIONAL on purpose (T9 improvement 15, 2026-08-06) ──────────────────────
  // A dish CARD never draws these. The grid reads CARD_COLUMNS, which correctly leaves the columns
  // out — but mapRow used to invent a default for each one anyway, so every card shipped five empty
  // fields plus a nutrition object of four empty strings. Measured on the live menu: ~3.6 KB of
  // structure nobody renders, in a 39.6 KB payload, on every guest of every restaurant — and this is
  // the hottest read in the product. They are now ABSENT when the column was not selected, and
  // unchanged when it was (the dish page and the 3D viewer read a full row, so they see no change).
  longDescription?: string;
  rating: string;       // average of REAL reviews ("" when there are none yet -> UI shows "New")
  reviewCount: number;  // how many real reviews exist (from the item_ratings view)
  time: string;
  nutrition?: { calories: string; protein: string; carbs: string; sugar?: string };
  ingredients?: { emoji: string; name: string }[];
  // deviceId lets the UI replace THIS device's previous review when the guest
  // re-rates (the DB upserts; the on-screen list must do the same).
  reviews?: { name: string; rating: number; text: string; deviceId?: string }[];
  relatedSlugs?: string[];
  tags: string[];
  allergens: string[];
  searchAlias: string; // hidden synonyms for search (e.g. "caesar, healthy")
  options: OptionGroup[]; // per-dish customization (size, milk, extras…)
  openPrice: boolean; // price is entered by staff at order time (as-per-MRP / market price)
  // Does THIS dish's typed price already contain GST, or is it never taxed at all?
  // 'default' = follow the restaurant (mig 270). The dish's own answer is IGNORED unless the
  // admin switched per-dish modes on for this restaurant — resolveTaxMode() in lib/tax.ts is
  // the only thing that decides, so never branch on this field by hand.
  taxMode: DishTaxMode;
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

// ── DELIBERATE: DISH NAMES AND DESCRIPTIONS ARE NOT TRANSLATED ──────────────────────────────
// Owner's decision, 2026-08-05, asked and answered directly. CATEGORIES and FILTERS carry one
// string per language and go through localized() below; a dish's `title`, `description` and
// `longDescription` are single-language on purpose and stay that way.
//
// This is NOT an oversight and it is NOT a bug — it has now been raised as a finding twice
// (guest sweep 2026-08-04, wording sweep T15 2026-08-05), which is the cost of not writing it
// down. Its one real consequence is known and accepted: a guest browsing in Hindi can find a
// CATEGORY by its Hindi name but cannot find a DISH by one — searching "एस्प्रेसो" returns the
// empty state while "Espresso" finds it.
//
// If we ever want it, the shape is already there: `searchAlias` on the item payload takes extra
// words a search should match, so translated dish names can be added WITHOUT translating the
// titles themselves. Do that when the owner asks — not before.
// Guarded by `npm run verify:i18n-scope` so a future sweep re-reports it as a finding.
// ─────────────────────────────────────────────────────────────────────────────────────────────

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

/** Was this column part of the SELECT? (absent key ≠ null value — see mapRow's note) */
const has = (row: any, col: string) => row != null && Object.prototype.hasOwnProperty.call(row, col);

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
    // `has(...)` = the column was actually SELECTED. Absent → omit the key entirely (a card does not
    // draw it). Present but NULL → keep today's default, so a full-row read is byte-for-byte what it
    // has always been. The distinction is the whole point: this must shrink the CARD payload only.
    ...(has(row, "long_description") ? { longDescription: row.long_description ?? "" } : {}),
    // Rating comes ONLY from real reviews now (the old per-dish seed number was
    // fake). Empty string = no reviews yet; the UI shows a "New" badge instead.
    // toFixed(1) so the card says "5.0" exactly like the dish page does.
    rating: agg?.avg_rating != null ? Number(agg.avg_rating).toFixed(1) : "",
    reviewCount: agg?.review_count ?? 0,
    time: row.time ?? "",
    ...(has(row, "nutrition") ? { nutrition: row.nutrition ?? { calories: "", protein: "", carbs: "", sugar: "" } } : {}),
    ...(has(row, "ingredients") ? { ingredients: row.ingredients ?? [] } : {}),
    ...(has(row, "reviews") ? { reviews: row.reviews ?? [] } : {}),
    ...(has(row, "related_slugs") ? { relatedSlugs: row.related_slugs ?? [] } : {}),
    tags: row.tags ?? [],
    allergens: row.allergens ?? [],
    searchAlias: row.search_alias ?? "",
    // Only keep `options` if it really is a list; otherwise use an empty list
    // so code that loops over options never breaks.
    options: Array.isArray(row.options) ? row.options : [],
    openPrice: !!row.open_price,
    // A column that wasn't selected (or a row from before mig 270) reads as "default" —
    // i.e. "follow the restaurant", which is exactly the pre-269 behaviour.
    taxMode: (["excl", "incl", "mrp", "none"].includes(String(row.tax_mode)) ? row.tax_mode : "default") as DishTaxMode,
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
// The server's answer to a waiter call. `ok:false` with reason "blocked" means a
// blocked table; `ok:true` with reason "already_sent"/"capped" means the call was
// NOT newly created (a recent duplicate, or the table already has 6 pending). The
// caller uses this to tell the guest the truth instead of always saying "sent"
// (audit fix 2026-07-06).
export interface CallWaiterResult { ok: boolean; reason?: string }
export async function callWaiter(tableNumber: string, note?: string, restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<CallWaiterResult> {
  // Go through the GUARDED RPC (not a direct insert): the database function
  // refuses blocked tables, throttles rapid repeats, and caps pile-up. Direct
  // inserts to waiter_calls are no longer allowed (see migration 050).
  const { data, error } = await supabase.rpc("lfh_call_waiter_table", {
    p_table: tableNumber || null,
    p_note: note || null,
    p_restaurant_id: restaurantId,
  });
  // A real transport/DB failure is an error we surface.
  if (error) throw new Error(`Call failed: ${error.message}`);
  // Otherwise hand back the RPC's own {ok, reason} so the UI can react honestly.
  const res = (data ?? {}) as CallWaiterResult;
  return { ok: res.ok !== false, reason: res.reason };
}

// Order lifecycle status. The restaurant advances received -> preparing -> served.
export type OrderStatus = "received" | "preparing" | "served" | "cancelled";

// How long a diner's order waits for an answer before we treat the restaurant as "too busy
// to take it this second" and save it on the device instead.
const ORDER_TIMEOUT_MS = 15000;

// "The restaurant couldn't take this right now" — as opposed to "the restaurant refused it"
// (sold out, table closed, over a limit). Only the first kind may be saved and sent later; a
// refusal has to reach the person, or they would wait for food that is never coming.
export type BusyError = Error & { busy: true };
export const isServerBusy = (e: unknown): e is BusyError =>
  !!e && typeof e === "object" && (e as { busy?: boolean }).busy === true;
function busyError(why: string): BusyError {
  const e = new Error(`Order not sent yet: ${why}`) as BusyError;
  e.busy = true;
  return e;
}

// A deadline on every order, WITHOUT assuming the browser can make one. `AbortSignal.timeout`
// is recent; on an older phone reading it throws, which was caught and mis-reported as "the
// restaurant is busy" — so a diner on a perfectly good connection was told their order had been
// saved for later. The staff twin has always guarded it (public/panels/outbox.js); now this does.
function orderDeadline(): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(ORDER_TIMEOUT_MS)
      : undefined;
  } catch { return undefined; }
}

type OrderReply = { ok?: boolean; reason?: string; item?: string; order_id?: string; retry?: boolean; duplicate?: boolean };

/**
 * THE ONE WAY a guest order reaches the server, for BOTH the QR path and a table session.
 *
 * Everything that makes an order safe lives here so neither path can drift from the other again:
 * the at-most-once id, the deadline, and the rule that "the restaurant could not take this"
 * (a dropped request, a timeout, a 5xx) is a BUSY error the caller saves and re-sends, while a
 * refusal (sold out, table closed, over the limit) is a plain error the diner must see.
 *
 * The session path used to skip all of this — it called the RPC straight from the browser with no
 * id and no timeout, so a lost reply placed the order twice and a busy system lost it entirely.
 */
async function postGuestOrder(body: Record<string, unknown>, actionId: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/guest/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LFH-Action-Id": actionId },
      body: JSON.stringify(body),
      signal: orderDeadline(),
    });
  } catch {
    // Couldn't reach the restaurant (dropped, timed out). NOT a refusal — the caller saves
    // it on the device and sends it automatically, exactly as it does when offline.
    throw busyError("could not reach the restaurant");
  }
  const j = (await res.json().catch(() => null)) as OrderReply | null;
  if (res.status === 409 && j?.retry) throw busyError("the restaurant is still handling this one");
  // The server is up but can't take it right now (it is busy, or its database didn't answer).
  // Also not a refusal: same treatment as being offline. The server's own words never travel —
  // it sends a code, and the diner-facing wording lives in lib/guestOutbox.ts reasonMsg().
  if (res.status >= 500) throw busyError("the restaurant's system is very busy");
  if (!res.ok || !j?.ok || !j.order_id) {
    throw new Error(`Order failed: ${j?.reason || "unknown"}${j?.item ? ` (${j.item})` : ""}`);
  }
  return j.order_id;
}

/**
 * Place a TABLE SESSION order (the guest is in a dining session, identity = their session token).
 *
 * Identical safety to the QR path: it goes through our own route so the at-most-once guard
 * applies, carries a deadline, and classes a busy system as "save it and send it". `restaurantId`
 * is passed only so a limit alert is raised about the RIGHT restaurant — the order itself is
 * still placed purely from the token.
 */
export async function placeSessionOrderSafe(
  token: string, items: unknown[], allergies: string[], restaurantId: string, actionId: string,
): Promise<string> {
  return postGuestOrder({ mode: "session", token, restaurantId, items, allergies }, actionId);
}

// Returns the new order's id. We generate the id on the client so the guest's
// device can follow ONLY its own order later (the table is insert-only for the
// public, so we can't read the id back via .select()).
export async function createOrder(o: OrderInput, restaurantId: string = DEFAULT_RESTAURANT_ID, actionId?: string): Promise<string> {
  // ALWAYS through our own endpoint, so the at-most-once guard and the deadline apply to every
  // order there is: if the reply is lost on a flaky connection and the guest taps again, the same
  // action id makes the server place it ONCE and echo the original order_id back.
  //
  // `actionId` used to be optional, and without one this function fell through to a direct anon
  // RPC with no dedup and no deadline — the exact pair of bugs postGuestOrder was written to fix.
  // Its only caller has always passed an id, so that branch was dead code; but it was dead code
  // that silently removed both protections for whoever called it next. There is no way to place a
  // guest order without an at-most-once key any more, which is the point.
  return postGuestOrder(
    { mode: "public", table: o.tableNumber || "", restaurantId, items: o.items, allergies: o.allergies },
    actionId || (globalThis.crypto?.randomUUID?.() as string) || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
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
// The columns the CARD GRID actually needs. Omits the heavy detail-only JSON
// (long_description, nutrition, ingredients, reviews, related_slugs, time) — those
// are only read on the dish page, which fetches the full row separately. Trimming
// them off the grid read (and its realtime refetch) cuts egress on the hot path;
// mapRow fills any omitted field with a safe default, so nothing breaks.
export const CARD_COLUMNS =
  // tax_mode rides along (mig 270): the cart has to know whether a printed price already
  // contains GST before it can quote an honest total, and it is one short text column.
  "id, slug, title, price, image, category, veg, is4d, model_folder, model_small_url, model_optimized_url, description, tags, allergens, search_alias, options, open_price, tax_mode, sort_order, restaurant_id";

// The slugs of the categories this restaurant currently has switched ON.
//
// WHY IT EXISTS: `categories` has an `active` flag and getCategories() honours it, but
// menu_items only stores a category SLUG, so nothing ever checked it. The guest menu's
// grouped view is built from the active categories and so hid those dishes correctly —
// but SEARCH, "You might also like" and the prev/next arrows read the raw item list, so a
// dish in a switched-off category stayed findable and orderable (guest sweep 2026-08-04).
//
// Returns null when we can't tell (read failed, or the restaurant has no category rows at
// all). Callers MUST treat null as "don't filter": filtering on an empty set would blank
// the entire menu, which is far worse than showing one extra dish.
async function activeCategorySlugs(restaurantId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("categories")
    .select("slug")
    .eq("restaurant_id", restaurantId)
    .eq("active", true)
    .limit(300);
  if (error || !data || data.length === 0) return null;
  return new Set(data.map((c) => c.slug as string));
}

/** Drop dishes whose category is switched off. A null set means "we can't tell" → keep all. */
function inLiveCategory<T extends { category: string }>(items: T[], live: Set<string> | null): T[] {
  return live ? items.filter((i) => live.has(i.category)) : items;
}

/**
 * THE THREE STATES A DISH CAN BE IN (owner, 2026-08-06).
 *
 *   on the menu   nothing set
 *   SOLD OUT      tag "sold-out" — still ON the menu, wearing its badge, not orderable today
 *   HIDDEN        tag "hidden"   — not on the guest menu at all, as if it were never printed
 *
 * The difference matters to a diner: "sold out" tells them the dish exists and to ask again
 * tomorrow; hidden tells them nothing, because they never see it. Staff DO still see a hidden
 * dish and may put it on a bill (an off-menu special, a staff meal, something served on request),
 * so the filtering lives in the GUEST read only — the panels have their own API.
 *
 * Both are tags rather than columns so the editor's existing tag plumbing carries them, and so a
 * dish can be sold-out AND hidden without two flags disagreeing.
 */
export const SOLD_OUT_TAG = "sold-out";
export const HIDDEN_TAG = "hidden";
export const isHidden = (tags?: string[] | null): boolean => Array.isArray(tags) && tags.includes(HIDDEN_TAG);

export async function getMenuItems(restaurantId: string = DEFAULT_RESTAURANT_ID, columns: string = "*"): Promise<MenuItem[]> {
  // Fetch the dishes AND the real-review aggregates at the same time (parallel
  // requests — no extra waiting). Ratings failing must never hide the menu, so
  // its error is swallowed and dishes just show as unrated.
  // item_ratings exposes restaurant_id since migration 116 — read ONLY this
  // restaurant's aggregates, with an explicit column list (egress rule).
  // `columns` defaults to everything (the dish page needs the full row); the grid
  // passes CARD_COLUMNS to skip heavy detail-only fields.
  const [items, ratings, liveCats] = await Promise.all([
    supabase.from("menu_items").select(columns).eq("restaurant_id", restaurantId).order("sort_order").limit(2000),
    // .limit() added per the egress rule — every read is capped, this one was not.
    supabase.from("item_ratings").select("item_slug, avg_rating, review_count").eq("restaurant_id", restaurantId).limit(2000),
    activeCategorySlugs(restaurantId), // runs in parallel, so it costs no extra wait
  ]);
  if (items.error) throw new Error(`Failed to load menu: ${items.error.message}`);
  // Index the aggregates by slug for a quick lookup while mapping each dish.
  const aggBySlug = new Map<string, RatingAgg>(((ratings.data as RatingAgg[] | null) ?? []).map((r) => [r.item_slug, r]));
  // Cast: a dynamic column string makes supabase-js widen the row type; mapRow reads
  // fields defensively (every one has a default), so treating rows as any is safe here.
  // Hide open-price dishes from the guest menu: their price is set by staff at order time,
  // so a self-ordering guest has no price to pay (the server would reject a ₹0 line anyway).
  // Waiter/manager panels read their own API and DO show these.
  // Then drop anything whose category is switched off, so a hidden category's dishes can't
  // come back through search / "you might also like" / the prev-next arrows.
  // …and drop HIDDEN dishes, for the same reason and in the same place as open-price ones: a
  // guest must never receive a dish the restaurant has taken off its menu, not even to filter it
  // out in the browser. (Sold-out dishes stay — they are meant to be seen wearing their badge.)
  const mapped = ((items.data ?? []) as any[]).map((row) => mapRow(row, aggBySlug.get(row.slug)))
    .filter((it) => !it.openPrice && !isHidden(it.tags));
  return inLiveCategory(mapped, liveCats);
}

// A single item by slug, or null if it doesn't exist.
// A "slug" is the short URL-friendly name, e.g. "classic-burger".
export async function getMenuItem(slug: string, restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<MenuItem | null> {
  // Reads: the dish, its rating aggregate, and its live categories.
  //
  // The REVIEW LIST used to be fetched here too, on every single call — but nothing reads
  // MenuItem.reviews any more: the dish page keeps its own `localReviews` (loaded in its own
  // effect, which respects the reviews switch), and the rating/count come from the
  // item_ratings aggregate. So this was up to 20 review rows pulled on every dish open AND
  // every 3D viewer open, for every restaurant, including ones with reviews switched off —
  // the last of that behaviour found by the guest sweep 2026-08-04.
  const [item, agg, liveCats] = await Promise.all([
    supabase.from("menu_items").select("*").eq("restaurant_id", restaurantId).eq("slug", slug).maybeSingle(),
    supabase.from("item_ratings").select("item_slug, avg_rating, review_count")
      .eq("restaurant_id", restaurantId).eq("item_slug", slug).maybeSingle(), // scoped since mig 116
    activeCategorySlugs(restaurantId),  // parallel, so no extra wait
  ]);
  if (item.error) throw new Error(`Failed to load item "${slug}": ${item.error.message}`);
  if (!item.data) return null;
  const mapped = mapRow(item.data, (agg.data as RatingAgg | null) ?? undefined);
  // Open-price dishes are hidden from the guest menu (see getMenuItems) — so a guest must not
  // reach one by typing/sharing its /item/<slug> URL either. Answer "no such dish" (the page
  // 404s) rather than showing a dish a guest can never order: staff set its price at the table.
  if (mapped.openPrice) return null;
  // A HIDDEN dish is not on the menu, so its own page must not open either — otherwise a guest
  // who kept a link (or a QR pointing at a retired special) walks straight past the grid filter
  // and can add it to a basket. Same answer as a dish that does not exist, which is the honest
  // one: as far as this diner is concerned, it doesn't.
  if (isHidden(mapped.tags)) return null;
  // Same for a dish whose CATEGORY is switched off: hidden on the menu means gone, including
  // by its own shared URL. A null set = we couldn't tell, so don't hide anything.
  if (liveCats && !liveCats.has(mapped.category)) return null;
  // mapped.reviews stays as mapRow left it (the legacy column, always empty). The real list
  // is loaded by whoever actually shows it — see the note above.
  return mapped;
}

// The newest real reviews for one dish (capped at 20), reshaped to the
// { name, rating, text } shape the dish page renders.
export async function getItemReviews(slug: string, restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<{ name: string; rating: number; text: string; deviceId?: string }[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("name, stars, comment, device_id, created_at")
    .eq("item_slug", slug)
    .eq("restaurant_id", restaurantId)
    .order("created_at", { ascending: false })
    .limit(20);
  // Reviews failing to load must never break the dish page — show none instead.
  if (error) return [];
  return (data ?? []).map((r) => ({ name: r.name || "Guest", rating: r.stars, text: r.comment || "", deviceId: r.device_id }));
}

// Save (or update) this device's rating for a dish. The server function
// validates stars/device/dish and upserts, so re-rating never duplicates.
export async function submitReview(
  slug: string, deviceId: string, stars: number, name: string, comment: string, restaurantId: string = DEFAULT_RESTAURANT_ID
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc("lfh_submit_review", {
    p_slug: slug, p_device: deviceId, p_stars: stars, p_name: name, p_comment: comment, p_restaurant_id: restaurantId,
  });
  if (error) return { ok: false, reason: error.message };
  return (data ?? { ok: false, reason: "no response" }) as { ok: boolean; reason?: string };
}

// Active categories, in display order. The virtual "All" tab is added by the UI.
export async function getCategories(restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("active", true)    // only categories the owner has switched on
    .order("sort_order")
    .limit(300);           // generous cap — satisfies the egress "always .limit()" rule without truncating real data
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
  // Per-restaurant feature switches (migration 035). RAW overrides only — the
  // app merges these over code-side defaults in lib/features.ts, so an absent
  // key simply means "default behavior".
  features: Record<string, boolean>;
  // The restaurant's effective tax rate as a DECIMAL (e.g. 0.05 = 5%), derived from
  // its named tax components (or the fallback rate, or 5%) — see lib/tax.ts. The guest
  // cart uses this so the quoted GST matches the actual bill (was hardcoded 5%).
  //
  // WHAT ACTUALLY CROSSES THE WIRE. This used to claim "only the single number is exposed to
  // guests, never the component labels" — which is not true and was never true: `lfh_guest_settings`
  // is `to_jsonb(row)` MINUS a denylist (mig 282), and `tax_components` is not on that denylist, so
  // the named components DO arrive in the browser (measured, guest sweep T1 2026-08-06). They have
  // to: `effectiveTaxRate` SUMS them and only falls back to the flat `tax_rate` when there are none,
  // so hiding them would silently quote a different GST than the bill charges. They are also printed
  // on every bill, so they are not a secret. `gstin`, the address and the phone ARE on the denylist —
  // that half of the old sentence was right. Only this `Settings` SHAPE keeps just the number.
  taxRate: number;
  // ── the three price behaviours (migration 270) ─────────────────────────────
  // Are the prices typed into the menu NET (GST added on top), GROSS (GST already inside),
  // or untaxable entirely (a composition-scheme restaurant may not charge the diner GST)?
  priceTaxMode: "excl" | "incl" | "composition";
  // Master switch, admin-only, FALSE everywhere by default: while it is off a dish's own
  // tax_mode is ignored completely and every line follows priceTaxMode.
  itemTaxModesAllowed: boolean;
  // How an MRP line is treated underneath. Both answers charge the guest the same (never a
  // rupee over MRP); they differ only in what the restaurant declares as output tax.
  mrpTaxTreatment: "none" | "inclusive";
  // Per-restaurant Google review link (owner 2026-07-09). When set, the guest sees a
  // "loved it? review us on Google" nudge after a HIGH dish rating; null = feature off.
  // A PUBLIC link, so it's guest-safe to expose (unlike gstin/phone).
  googleReviewUrl: string | null;
  // How the Google-review invite behaves relative to the in-menu review (mig 187, admin-only).
  //   off · google (Google CTA only) · google_plus_normal (both) · google_after_normal (post-rating nudge)
  googleReviewMode: "off" | "google" | "google_plus_normal" | "google_after_normal";
  // ── the guest-menu switches from the access rebuild (mig 235) ──────────────
  // The MASTER: false means this restaurant has no guest menu at all — the menu routes
  // answer "not found" and no QR link resolves. It runs on staff panels only.
  menuEnabled: boolean;
  // What a FIRST-time guest sees before they change anything (they still may).
  menuDefaultLayout: "grid" | "list";
  menuDefaultMode: "light" | "dark";
  // Which languages / currencies the menu offers. Exactly ONE means the switcher is
  // REMOVED from the menu (not disabled) — the owner's rule for a single-language menu.
  menuLanguages: string[];
  menuCurrencies: string[];
}
// Reads the single site-wide settings row and returns it with safe defaults,
// so the app still works even if settings haven't been configured yet.
// Per-restaurant settings cache + in-flight dedup. A guest menu load mounts ~9
// components that EACH called getSettings independently → 9 identical single-row
// reads per page view (egress waste, seen 2026-07-06). `inflight` collapses those
// simultaneous calls into ONE network request; `cache` (short TTL) serves repeat
// calls within a page's lifetime. TTL is deliberately short so a realtime
// feature/tax toggle is picked up within seconds on the next read.
const SETTINGS_TTL_MS = 8000;
const settingsCache = new Map<string, { at: number; val: Settings }>();
const settingsInflight = new Map<string, Promise<Settings>>();

export async function getSettings(restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<Settings> {
  const hit = settingsCache.get(restaurantId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.val; // fresh enough
  const pending = settingsInflight.get(restaurantId);
  if (pending) return pending; // another caller is already fetching — share it
  const p = fetchSettings(restaurantId)
    .then((val) => { settingsCache.set(restaurantId, { at: Date.now(), val }); return val; })
    .finally(() => { settingsInflight.delete(restaurantId); });
  settingsInflight.set(restaurantId, p);
  return p;
}

async function fetchSettings(restaurantId: string = DEFAULT_RESTAURANT_ID): Promise<Settings> {
  // ONE DOOR (mig 282). This used to select a column list straight off the `settings` table with
  // the public key, which meant anon needed a table-wide read — and every restaurant's gstin,
  // address, phone and panel config came with it. It now asks a SECURITY DEFINER function that
  // returns the guest's slice as one object: `to_jsonb(row)` minus a denylist.
  //
  // WHY A FUNCTION AND NOT A COLUMN GRANT OR A VIEW. Both of those ENUMERATE the allowed
  // columns, so they must stay in lockstep with the list here — and code and migrations do not
  // deploy together. That exact mismatch 500'd every guest menu on 2026-08-04 (a column grant
  // listed 19 columns while this select asked for 22). Reading keys off an object cannot do
  // that: a key the function does not return is `undefined`, and every mapping below already
  // has a default for that. It degrades instead of breaking.
  const { data, error } = await supabase
    .rpc("lfh_guest_settings", { p_restaurant_id: restaurantId }); // one row per restaurant (079)
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
    // Keep only honest boolean overrides; anything malformed is ignored.
    features: data && data.features && typeof data.features === "object"
      ? Object.fromEntries(Object.entries(data.features as Record<string, unknown>).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>
      : {},
    taxRate: effectiveTaxRate(data),
    // Read through lib/tax.ts, never off the raw column: those helpers hold the defaults
    // (unknown/missing → 'excl', modes OFF, MRP untaxed) that keep a pre-269 row behaving
    // exactly as it does today.
    // `data ?? {}` because the mode helpers take a settings ROW (a restaurant with no row at
    // all lands on their defaults — 'excl', modes off — which is exactly today's behaviour).
    priceTaxMode: priceTaxMode(data ?? {}),
    itemTaxModesAllowed: itemTaxModesAllowed(data ?? {}),
    mrpTaxTreatment: String((data as { mrp_tax_treatment?: unknown } | null)?.mrp_tax_treatment) === "inclusive" ? "inclusive" : "none",
    googleReviewUrl: data && typeof data.google_review_url === "string" && data.google_review_url.trim() ? data.google_review_url.trim() : null,
    // Default 'off' for any restaurant that hasn't been switched on (and for a missing row).
    googleReviewMode: (data && ["google", "google_plus_normal", "google_after_normal"].includes(String(data.google_review_mode)))
      ? (data.google_review_mode as "google" | "google_plus_normal" | "google_after_normal")
      : "off",
    // Access rebuild (mig 235). All default to today's behaviour, so a restaurant whose
    // row predates the migration (or is missing entirely) keeps a working menu.
    menuEnabled: data ? data.menu_enabled !== false : true,
    menuDefaultLayout: data && data.menu_default_layout === "list" ? "list" : "grid",
    menuDefaultMode: data && data.menu_default_mode === "dark" ? "dark" : "light",
    menuLanguages: strList(data?.menu_languages, ["en"]),
    menuCurrencies: strList(data?.menu_currencies, ["INR"]),
  };
}

// The shape lib/tax.ts reads (it speaks the DATABASE's column names, because the same
// helpers are used server-side on raw settings rows). This adapter is the ONE place the
// guest's camelCase Settings is translated into it — so a component never hand-builds the
// object and never accidentally leaves a field out (a missing field silently means "off").
export type TaxRules = {
  tax_rate: number;
  price_tax_mode: "excl" | "incl" | "composition";
  item_tax_modes_allowed: boolean;
  mrp_tax_treatment: "none" | "inclusive";
};
export function taxRulesOf(s: Settings): TaxRules {
  return {
    // taxRate is ALREADY the effective decimal (components summed, or the flat rate, or 5%),
    // so handing it over as tax_rate makes effectiveTaxRate() return exactly the same number.
    tax_rate: s.taxRate,
    price_tax_mode: s.priceTaxMode,
    item_tax_modes_allowed: s.itemTaxModesAllowed,
    mrp_tax_treatment: s.mrpTaxTreatment,
  };
}
/** The rules a restaurant has before its settings have loaded: today's behaviour, exactly. */
export const DEFAULT_TAX_RULES: TaxRules = {
  tax_rate: 0.05, price_tax_mode: "excl", item_tax_modes_allowed: false, mrp_tax_treatment: "none",
};

// A text[] column → a clean string list, never empty (an empty list would leave the menu
// with no language to render labels in, or no currency to price in).
function strList(v: unknown, fallback: string[]): string[] {
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
  return list.length ? Array.from(new Set(list)) : fallback;
}

// Leave feedback for one past order (rating 1–5 + optional comment). Holding
// the order id is the proof of visit; the server stores ONE feedback per order
// (re-sending updates it, which is how the optional comment gets added after
// the star tap). Returns { ok } or { ok:false, reason }.
export async function leaveFeedback(
  orderId: string,
  rating: number,
  comment?: string,
  name?: string
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc("lfh_leave_feedback", {
    p_order: orderId, p_rating: rating, p_comment: comment || null, p_name: name || null,
  });
  if (error) return { ok: false, reason: error.message };
  return (data as { ok: boolean; reason?: string }) ?? { ok: false, reason: "empty" };
}

