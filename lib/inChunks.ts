// lib/inChunks.ts — reading "these restaurants" without the id list breaking the request.
//
// ── WHY (T25 sweep, 2026-08-21) ───────────────────────────────────────────────────────────────────
//
// PostgREST puts every filter in the URL, so an `.in("id", ids)` list of uuids costs ~37 bytes each,
// and it answers a select with at most `db-max-rows` rows while saying nothing about the ones it left
// out. Both limits were MEASURED on this stack rather than assumed:
//
//     500 ids  → 18.5 KB of id list → fine
//     800 ids  → 29.6 KB            → "Bad Request"
//   2,000 ids  → 74.0 KB            → the fetch never completes
//   a select with no .limit()       → silently capped at 1,000 rows
//
// `lib/restaurantNames.ts` already knows this and says so: it chunks at 500 and sets
// `.limit(part.length)`, because "past PostgREST's 1000-row default, every name after the thousandth
// silently became '—' (the reports route learned this one the hard way and left a comment about it;
// nobody else got the fix)". `lib/liveBoard.ts` learned the URL half the hard way too — an inlined
// id list came back 414 and the KITCHEN BOARD WENT BLANK mid-rush.
//
// Five multi-restaurant reads in lib/ were still doing it the unchecked way: the owner's own estate
// (lib/panelAccess), the payroll and inventory rungs (lib/tableTags), the entitlement subsets
// (lib/ownerEntitlements) and the activity-log switches (lib/logVisibility). Nobody is hurt at
// today's nine restaurants — this is the road, not a turn — but each one fails in a quiet direction
// when the platform grows, and quiet is the part that matters:
//
//   · panelAccess    → restaurants missing from the owner's OWN sidebar, Menu picker and every
//                      /api/owner/* call at once, with nothing on screen to say so. This is exactly
//                      the fault T19 fixed one level up (a `.limit(50)` on the ownership links); the
//                      two reads that FILTER that paged list kept the shape.
//   · tableTags      → a restaurant's Payroll or Inventory module reads as OFF because its row was
//                      past the cap, so the owner's staff-pay tile and stock screens go blank.
//   · ownerEntitlements → a section the admin left ON reads as absent, and the union of an estate
//                      quietly stops including part of it.
//   · logVisibility  → the worst-shaped one: a restaurant absent from the map is `canSee → false`
//                      BY DESIGN ("cannot check → hide"), so truncation hides activity the owner is
//                      entitled to see, and the failure looks like an empty log rather than an error.
//
// ── THE RULE ─────────────────────────────────────────────────────────────────────────────────────
//
// Chunk the id list at 500, give every chunk a `.limit()` no smaller than the chunk, and report a
// failure as a FAILURE. There is deliberately no "return what worked": every caller of this is
// deciding what an owner may see or what a module is set to, and a short answer there is a wrong
// answer, not a partial one. That is the same split lib/restaurantNames.ts draws in its own words —
// *"a wrong name is confusing, a wrong number is a lie. Names degrade; figures refuse."*
//
// It is NOT for an append-heavy table. Chunking a ledger into the app to add it up is the expensive
// way to be right (see lib/pageAll.ts's own warning). This is for the one-row-per-restaurant tables:
// `restaurants`, `settings`, `restaurant_billing`.

/** The most ids that may ride in one PostgREST URL. 500 ≈ 18.5 KB, measured good; 800 is not. */
export const IN_CHUNK = 500;

/** One chunk's worth of a supabase read. */
type Chunk<T> = { data: T[] | null; error: unknown };

/** Split an id list into URL-safe chunks. Empty in, empty out. */
export function idChunks(ids: readonly string[], size: number = IN_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Read rows for a set of ids, a URL-safe chunk at a time.
 *
 * @param ids   the id list. Deduped and blank-filtered here so no caller has to remember.
 * @param read  runs ONE chunk. The caller supplies it — rather than this file building the query —
 *              so the table, the column list and the `.limit()` stay visible at the call site,
 *              which is where the cost of a read belongs. Give it `.limit(chunk.length)` or more.
 * @returns     `{ rows }` when every chunk answered, `{ error }` if any chunk failed. Never a short
 *              list with no error — that is the whole fault this file exists to prevent.
 */
export async function readInChunks<T>(
  ids: readonly (string | null | undefined)[],
  read: (chunk: string[]) => PromiseLike<Chunk<T>>,
): Promise<{ rows: T[]; error?: undefined } | { rows?: undefined; error: unknown }> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (!unique.length) return { rows: [] };
  const rows: T[] = [];
  for (const chunk of idChunks(unique)) {
    const r = await read(chunk);
    if (r.error) return { error: r.error };
    const batch = r.data || [];
    rows.push(...batch);
    // A chunk that came back FULL to its own size is the silent-truncation shape: the caller's
    // `.limit()` is smaller than the chunk it was given, so rows may have been dropped with no
    // error. Say so rather than hand back a list that might be short.
    if (batch.length > chunk.length) return { error: new Error(`readInChunks: a chunk returned more rows than ids (${batch.length} > ${chunk.length}) — the read is not one-row-per-id`) };
  }
  return { rows };
}
