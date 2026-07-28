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

// PostgREST silently caps any response at 1000 rows. With ascending ordering that
// means a board past 1000 live rows keeps the OLDEST and DROPS the NEWEST — the
// 2026-07-03 stress test showed the kitchen going blind to every new KOT once a
// backlog passed the cap, with no error anywhere. pageAll() walks .range() windows
// until a short page so the board is COMPLETE again. PAGE must not exceed the
// server's max-rows (1000). MAX_PAGES is runaway protection only (20k rows is far
// beyond any real floor); if it ever trips we log — never silently truncate again.
const PAGE = 1000;
const MAX_PAGES = 20;
async function pageAll<T>(
  makePage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await makePage(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
  console.error(`liveBoard: pageAll hit MAX_PAGES (${MAX_PAGES * PAGE} rows) — board truncated`);
  return all;
}

// ── ID lists must NEVER be inlined whole (the blank-kitchen bug) ─────────────
// PostgREST puts every filter in the URL, so an `in.(…)` list of UUIDs costs ~37 bytes
// EACH. Past roughly 500-700 ids the request exceeds the edge proxy's URL limit and comes
// back as `414 Request-URI Too Large`; the route turned that into a 500 and the KITCHEN
// BOARD WENT COMPLETELY BLANK mid-rush — "New 0 · Cooking 0 · Ready 0" while thousands of
// tickets were live, with no hint on screen (AV-live rush test 2026-07-28: 4,321 active
// tickets, every /api/kitchen/board call failed). The sessions id-list was hardened for
// this in 2026-07-03; the ORDER id-lists were not, which is what actually broke.
//
// So: every id list is split into small chunks, each chunk is fetched (and paged) on its
// own, and the results are merged + dedup'd by id. 150 ids ≈ 5.5KB of URL — a wide margin
// under the ~18KB that still worked. Chunks run a few at a time so a big backlog stays
// fast without opening dozens of simultaneous connections (owner's connection budget).
const ID_CHUNK = 150;
const CHUNK_CONCURRENCY = 6;

const chunkIds = (ids: string[]): string[][] => {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK));
  return out;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

// Merge the chunk/pass results back into ONE list that looks exactly like the old single
// query's output: unique by id, ordered by created_at then id (the stable tiebreak).
const mergeRows = (groups: Row[][]): Row[] => {
  const byId = new Map<string, Row>();
  for (const g of groups) for (const r of g) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

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
  // ONLY pre-rollover sessions matter here: a session OPENED today (created_at >= since)
  // can only contain orders created after it, so those orders already pass the
  // `created_at >= since` arm of the OR below. Narrowing to the overnight stragglers
  // keeps this id-list tiny — the stress test showed 300+ open sessions inlining ~11KB
  // of UUIDs into the PostgREST URL, flirting with URL-length failures.
  const openRes = await sb.from("sessions").select("id")
    .eq("status", "open").eq("restaurant_id", restaurantId).lt("created_at", since);
  if (openRes.error) throw new Error(openRes.error.message);
  const openIds = (openRes.data ?? []).map((s) => s.id as string);

  // Orders: today's, PLUS any belonging to a still-open session (matches the brain).
  // Two SCOPED passes instead of one query with every session id inlined in the URL:
  //   (a) everything since the business-day start, and
  //   (b) the pre-rollover open sessions' orders, in id chunks.
  // The row SET is identical to the old `created_at>=since OR session_id IN (…)` — pass (b)
  // adds `created_at < since` only because anything newer is already in pass (a) — and
  // mergeRows dedups + restores the created_at,id ordering. See the ID_CHUNK note above.
  const baseOrders = () => {
    let q = sb.from("orders").select(ORDER_COLS).eq("archived", false).is("deleted_at", null).eq("restaurant_id", restaurantId);
    if (activeOnly) q = q.in("status", KITCHEN_ACTIVE_STATUSES); // kitchen board → drop served/cancelled server-side
    if (tableFilter) q = q.in("table_number", tableFilter);
    return q;
  };
  const orderPasses: Row[][] = [
    await pageAll<Row>((from, to) => baseOrders().gte("created_at", since)
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    ...(await mapLimit(chunkIds(openIds), CHUNK_CONCURRENCY, (ids) =>
      pageAll<Row>((from, to) => baseOrders().lt("created_at", since).in("session_id", ids)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)))),
  ];
  const orders = mergeRows(orderPasses);

  // Every dish row for a set of order ids, chunked so the URL can never overflow.
  const itemsForOrderIds = async (ids: string[]): Promise<Row[]> =>
    mergeRows(await mapLimit(chunkIds(ids), CHUNK_CONCURRENCY, (c) =>
      pageAll<Row>((from, to) => sb.from("order_items").select(ITEM_COLS).eq("restaurant_id", restaurantId)
        .in("order_id", c)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to))));

  // TARGETED path: items are simply the items of the orders we fetched — scope by
  // order_id (no today/open OR logic needed; the orders query already settled which
  // orders count, including today's closed-session ones). Empty orders → empty items.
  if (tableFilter) {
    const orderIds = orders.map((o) => o.id);
    if (!orderIds.length) return { orders, items: [] };
    return { orders, items: await itemsForOrderIds(orderIds) };
  }

  // ACTIVE-ONLY (kitchen) full board: the caller already dropped served/cancelled orders
  // server-side, and the client only ever reads items keyed to an order still on the board.
  // So scope items to exactly those active orders' ids instead of shipping EVERY of today's
  // items (served + cancelled included) on this 60s-polled, rush-throttled path — the whole-
  // board read the egress rules forbid, once per kitchen screen. The tablet (activeOnly=false)
  // still needs served items for bills, so it keeps the full read below. (egress fix 2026-07-09)
  if (activeOnly) {
    const activeIds = orders.map((o) => o.id);
    if (!activeIds.length) return { orders, items: [] };
    return { orders, items: await itemsForOrderIds(activeIds) };
  }

  // FULL path: per-dish rows are today's, PLUS the items of the OLD (pre-rollover)
  // open-session orders we just kept — so their dishes' statuses come along too.
  // Keeping the id-list to just those old orders keeps the query small.
  const sinceMs = new Date(since).getTime();
  const oldOrderIds = orders.filter((o) => new Date(o.created_at).getTime() < sinceMs).map((o) => o.id);
  const items = mergeRows([
    await pageAll<Row>((from, to) =>
      sb.from("order_items").select(ITEM_COLS).eq("restaurant_id", restaurantId).gte("created_at", since)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    oldOrderIds.length ? await itemsForOrderIds(oldOrderIds) : [],
  ]);

  return { orders, items };
}
