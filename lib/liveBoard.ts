// Shared "live board" order source for the TABLET and KITCHEN panels.
//
// WHY THIS EXISTS: the manager's floor brain (lfh_floor_state, migration 041)
// shows an OPEN session's orders no matter how old — deliberately "never clipped
// to today". But the tablet and kitchen /state endpoints used to fetch only orders
// since the 05:00 IST business-day start (businessDayStartIso). So a table left
// open ACROSS that rollover still showed its orders on the manager, yet looked
// EMPTY on the tablet/kitchen — a confusing desync (e.g. an overnight Table 13).
//
// This helper makes every panel agree: it returns TODAY's orders PLUS every order
// that belongs to a still-OPEN session, regardless of age. Defining it in ONE place
// stops the three surfaces drifting apart again (which is exactly how this bug
// crept in — the brain was fixed, these two endpoints were not).
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { businessDayStartIso } from "@/lib/businessDay";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";

// We only touch id / created_at / session_id here; the rest of the row passes
// through untouched, hence the index signature.
type Row = { id: string; created_at: string; session_id?: string | null; [k: string]: unknown };

// TARGETED REFETCH (owner 2026-06-26 — egress cut): `tableNumbers` scopes the board to
// ONLY those tables. The kitchen/tablet panels pass it when a realtime breadcrumb names
// the changed table(s), so a single dish-status change re-reads a few rows instead of the
// whole floor. Omit it (or pass empty) for the full board — unchanged behaviour. Always
// scoped by restaurant_id either way.
// EXPLICIT COLUMN LISTS (owner 2026-06-26 egress rule — no `.select("*")` on a hot/polled
// path). This helper is SHARED by the kitchen + tablet panels, so each list is the UNION of
// every column EITHER panel's client renders, PLUS the few liveBoard itself needs internally
// (orders.id/created_at/session_id for the today/open-session OR + the old-order id list;
// order_items.order_id to group dishes, created_at to sort). Grep-verified against both
// public/panels/{tablet,kitchen}/app.js before locking: drop a rendered column here and that
// panel silently breaks (and boardSig wouldn't repaint it either). `edited_at` is intentionally
// NOT listed — neither panel renders a "✎ Edited" badge today (CLAUDE.md's claim is stale).
const ORDER_COLS =
  "id, created_at, session_id, table_number, status, payment_status, total, discount, discount_note, kot_no, member_id, allergies, items";
const ITEM_COLS =
  "id, order_id, title, qty, status, note, options, removed, added_allergens, removed_flag, unit_price, created_at";

// ACTIVE order statuses for the KITCHEN board. orders.status is only ever
// {received, preparing, served, cancelled} — there is NO 'ready' order status ('ready'
// lives on order_items). A fully-served order flips to 'served' (the kitchen already
// drops it client-side), so filtering to received+preparing server-side trims the payload
// with no regression. The TABLET must NOT use this — it needs served/paid orders for bills.
const KITCHEN_ACTIVE_STATUSES = ["received", "preparing"];

export async function liveOrdersAndItems(
  restaurantId: string = DEFAULT_RESTAURANT_ID,
  tableNumbers?: string[],
  // KITCHEN-only: when true, restrict orders to received/preparing (the active pass). Off by
  // default so the tablet (bills need served/paid) and any other caller see the full set.
  activeOnly: boolean = false,
): Promise<{ orders: Row[]; items: Row[] }> {
  const since = businessDayStartIso();
  const tableFilter = Array.isArray(tableNumbers) && tableNumbers.length
    ? tableNumbers.map(String)
    : null;

  // Which sessions are open right now — their orders stay visible at any age.
  // Scoped to this restaurant so a kitchen/tablet only ever sees its own floor.
  const openRes = await sb.from("sessions").select("id").eq("status", "open").eq("restaurant_id", restaurantId);
  if (openRes.error) throw new Error(openRes.error.message);
  const openIds = (openRes.data ?? []).map((s) => s.id as string);

  // Orders: today's, PLUS any belonging to a still-open session (matches the brain).
  // The optional table filter is AND-ed in BEFORE the today/open-session OR group, so
  // PostgREST builds  ... AND table_number IN (…) AND (created_at>=since OR session_id IN (…)).
  let ordQ = sb.from("orders").select(ORDER_COLS).eq("archived", false).eq("restaurant_id", restaurantId);
  if (activeOnly) ordQ = ordQ.in("status", KITCHEN_ACTIVE_STATUSES); // kitchen board → drop served/cancelled server-side
  if (tableFilter) ordQ = ordQ.in("table_number", tableFilter);
  ordQ = openIds.length
    ? ordQ.or(`created_at.gte.${since},session_id.in.(${openIds.join(",")})`)
    : ordQ.gte("created_at", since);
  const ordRes = await ordQ.order("created_at", { ascending: true });
  if (ordRes.error) throw new Error(ordRes.error.message);
  const orders = (ordRes.data ?? []) as Row[];

  // TARGETED path: items are simply the items of the orders we fetched — scope by
  // order_id (no today/open OR logic needed; the orders query already settled which
  // orders count, including today's closed-session ones). Empty orders → empty items.
  if (tableFilter) {
    const orderIds = orders.map((o) => o.id);
    if (!orderIds.length) return { orders, items: [] };
    const itRes = await sb.from("order_items").select(ITEM_COLS).eq("restaurant_id", restaurantId)
      .in("order_id", orderIds)
      .order("created_at", { ascending: true }).order("id", { ascending: true });
    if (itRes.error) throw new Error(itRes.error.message);
    return { orders, items: (itRes.data ?? []) as Row[] };
  }

  // FULL path: per-dish rows are today's, PLUS the items of the OLD (pre-rollover)
  // open-session orders we just kept — so their dishes' statuses come along too.
  // Keeping the id-list to just those old orders keeps the query small.
  const sinceMs = new Date(since).getTime();
  const oldOrderIds = orders.filter((o) => new Date(o.created_at).getTime() < sinceMs).map((o) => o.id);
  let itQ = sb.from("order_items").select(ITEM_COLS).eq("restaurant_id", restaurantId);
  itQ = oldOrderIds.length
    ? itQ.or(`created_at.gte.${since},order_id.in.(${oldOrderIds.join(",")})`)
    : itQ.gte("created_at", since);
  const itRes = await itQ.order("created_at", { ascending: true }).order("id", { ascending: true });
  if (itRes.error) throw new Error(itRes.error.message);

  return { orders, items: (itRes.data ?? []) as Row[] };
}
