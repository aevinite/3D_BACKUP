// Safe id-list reads — never build a PostgREST URL that a proxy will reject.
//
// WHY THIS EXISTS (AV live, 2026-07-28): a filter like `.in("order_id", ids)` is sent as a
// GET **query string** (`order_id=in.("uuid","uuid",…)`). Each uuid costs ~39 encoded chars, so
// the URL grows with the list and the proxy in front of Supabase eventually refuses the whole
// request — Cloudflare answers with an HTML page ("414 Request-URI Too Large") that supabase-js
// surfaces as the query's error message. Measured 2026-07-28: ~500 ids (19.6 KB) is still fine,
// ~1000 ids (39 KB) is already rejected. The kitchen board hit this during the pre-handover
// rush test with 8,263 active orders — a ~320 KB URL — so the panel showed an error instead of
// tickets. It is NOT a database limit: the query never reached Postgres.
//
// The rule from now on: whenever the id list comes from ROWS (not a small fixed set like
// role/status names), read it through `inChunks` so the ids are split across several short
// URLs and the results concatenated. Cheap (a handful of extra round-trips only when the
// list is genuinely long) and it removes a whole failure class.

// Measured against the dev project 2026-07-28: 500 ids (a ~19.6 KB URL) still answers 200,
// 1000 ids (~39 KB) is rejected. 250 ids ≈ 9.8 KB of query string — a 4× safety margin, and
// few enough requests that even a pathological 8,000-order board is ~32 short reads instead
// of one impossible one.
export const ID_CHUNK = 250;

// How many chunk reads may be in flight at once. Sequential was too slow (a 134-request board
// took ~87s from a laptop); unbounded would fan a long list out into dozens of simultaneous
// connections, which is exactly what the owner's connection budget forbids. 4 is the middle.
const CONCURRENCY = 4;

export function chunkIds<T>(ids: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Run `read` once per chunk of ids and concatenate the rows, at most CONCURRENCY reads in
 * flight. A list that fits in one chunk (the everyday case) does exactly ONE query — same
 * behaviour and same cost as before this helper existed. An empty list does no query at all.
 * Row ORDER across chunks is not guaranteed — sort afterwards if the caller cares.
 */
export async function inChunks<Id, Row>(
  ids: readonly Id[],
  read: (slice: Id[]) => Promise<Row[]>,
  size = ID_CHUNK,
): Promise<Row[]> {
  if (!ids.length) return [];
  if (ids.length <= size) return read(ids.slice());
  const slices = chunkIds(ids, size);
  const out: Row[][] = new Array(slices.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= slices.length) return;
      out[i] = await read(slices[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, worker));
  return out.flat();
}

/** Drop duplicate rows by `id` (chunked/unioned reads can legitimately overlap). */
export function dedupeById<Row extends { id?: unknown }>(rows: Row[]): Row[] {
  const seen = new Set<unknown>();
  const out: Row[] = [];
  for (const r of rows) {
    const k = r?.id;
    if (k === undefined || k === null) { out.push(r); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
