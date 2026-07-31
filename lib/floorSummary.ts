// floorSummary.ts — one floor computation shared by every device looking at it.
//
// THE PROBLEM THIS SOLVES (measured 2026-07-31)
//   `lfh_table_view_summary` walks every table and runs ~6 queries per table — about 1,800
//   statements for a 300-table floor. Alone that's ~300ms and fine. But every manager and
//   waiter device polls the WHOLE floor as its 60s backstop, and on a busy floor several
//   devices land together: at 12 concurrent whole-floor reads the calls queue behind each
//   other and cross the database's statement timeout. That is exactly what filled the error
//   log with "canceling statement due to statement timeout" (134 rows in 12h) and what put
//   pings on the owner's phone.
//
//   A set-based rewrite of the function was tried first and REJECTED by measurement: 5×
//   faster at 4 concurrent reads, 2× SLOWER at 12, because one large aggregate per call
//   contends for CPU where many small ones interleave. Making each call faster was the wrong
//   lever. The right lever is not doing the same work twelve times.
//
// WHAT THIS DOES
//   Requests for the SAME restaurant's whole floor within a short window share ONE database
//   call: the first caller computes, everyone else awaits that same promise and gets the same
//   JSON. Twelve simultaneous polls become one query instead of twelve.
//
// WHY THIS IS SAFE FOR A LIVE FLOOR
//   · It only ever coalesces the WHOLE-floor read. A targeted `?table=N` refetch — the thing
//     that makes a tile update the instant an order lands — never goes through here.
//   · The window is 1.5s. A panel can therefore be at most ~1.5s behind on its backstop poll,
//     while realtime breadcrumbs keep the actual updates instant. The old backstop was 60s.
//   · Per Node instance and in-memory only: nothing persisted, nothing to invalidate, and a
//     cold instance simply computes. No behaviour depends on the cache existing.
//   · A failure is never cached — the entry is dropped so the next caller retries.
type Entry = { at: number; promise: Promise<unknown> };

const WINDOW_MS = 1500;            // how long one computation is shared
const inflight = new Map<string, Entry>();

/**
 * Share one whole-floor computation between concurrent callers.
 * `key` must identify the restaurant (and anything else that changes the RESULT).
 * `compute` is the real database call; it runs at most once per window.
 */
export async function sharedFloorSummary<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = inflight.get(key);
  if (hit && now - hit.at < WINDOW_MS) return hit.promise as Promise<T>;

  const promise = (async () => {
    try {
      return await compute();
    } catch (e) {
      inflight.delete(key);        // never let a failure be handed to the next caller
      throw e;
    }
  })();
  inflight.set(key, { at: now, promise });

  // keep the map from growing on a many-restaurant instance
  if (inflight.size > 64) {
    for (const [k, v] of inflight) if (now - v.at > WINDOW_MS) inflight.delete(k);
  }
  return promise;
}

/** Test hook: forget everything (so a test can measure a cold call). */
export function _resetSharedFloorSummary(): void {
  inflight.clear();
}
