// floorSummary.ts — one floor computation shared by every device looking at it.
//
// THE PROBLEM THIS SOLVES (measured 2026-07-31)
//   `lfh_table_view_summary` walks every table and runs ~6 queries per table — about 1,800
//   statements for a 300-table floor. Alone that's ~300ms and fine. But every manager and
//   waiter device polls the WHOLE floor as its 60s backstop, and on a busy floor several
//   devices land together: at 12 concurrent whole-floor reads the calls queue behind each
//   other and cross the statement timeout — which is **8 SECONDS**, not the 120s the database
//   default suggests (PostgREST logs in as `authenticator`, whose role settings carry
//   statement_timeout=8s; SET ROLE service_role afterwards does not re-apply them — proven on
//   the app path: a 5s query returns 200, a 20s query is cancelled at 8.8s with 57014). That is
//   exactly what filled the error log with "canceling statement due to statement timeout"
//   (134 rows in 12h) and what put pings on the owner's phone.
//
//   A FIRST set-based rewrite was tried and rejected by measurement: 5× faster at 4 concurrent
//   reads, 2× SLOWER at 12, because one large aggregate per call contends for CPU where many
//   small ones interleave. Sharing was shipped instead.
//
//   UPDATE — migration 238 then rewrote the function in a DIFFERENT shape (per-table ladder and
//   small aggregates kept, one set-based data pass added, a whole-history count(*) FILTER and a
//   quadratic tile concat removed) and it wins at every load: 12 at once 4.9× faster, 24 6.8×,
//   48 8.0× — it improves under load instead of collapsing. So a floor read now costs 11–29ms,
//   not ~300ms. BOTH levers are in place and they are complementary: this file cuts the NUMBER
//   of calls, mig 238 cut the COST of each. Don't remove either on the grounds that the other
//   exists.
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
//
// WHY THERE IS NO "JUST RETRY THE READ" HERE (built, measured, rejected 2026-07-31)
//   The obvious next idea is to ask again when the database cancels a read. It does not work in
//   this app, and the numbers are worth keeping so nobody rebuilds it:
//     · the statement limit is 8s (PostgREST logs in as `authenticator`, statement_timeout=8s —
//       NOT the 120s database default; a 20s query is cancelled at 8.8s with 57014);
//     · the serverless function gets ~10s. So waiting the full 8s and THEN retrying cannot fit;
//     · cutting each attempt shorter (3.5s, say) does fit — but the failures we actually saw were
//       MINUTES of whole-instance saturation, not sub-second blips, so a second attempt 250ms
//       later fails too. It buys a faster failure, not a success.
//   What actually caused those bursts: two 501-phase test suites hammering this small shared
//   instance at once (see docs/FLOOR-TIMEOUT-WATCH.md). The fix was to stop doing that, not to
//   retry. The 1.5s sharing below is what genuinely absorbs a pile-up: it removes the duplicate
//   work instead of adding more.
type Entry = { at: number; promise: Promise<unknown> };

const WINDOW_MS = 1500;            // how long one computation is shared
const inflight = new Map<string, Entry>();

/**
 * Share one whole-floor computation between concurrent callers.
 * `key` must identify the restaurant (and anything else that changes the RESULT).
 * `compute` is the real database call; it runs at most once per window.
 *
 * ⚠️ THE RESULT IS SHARED BY REFERENCE — TREAT IT AS READ-ONLY.
 * Every caller inside the window gets the SAME object, so editing it edits what the
 * next device is handed. This is not theoretical: the tablet narrowed the floor to a
 * waiter's section in place, and for 1.5s afterwards the manager's panel (and every
 * other waiter's) was served that one waiter's three tiles out of three hundred, the
 * rest of the floor looking free (found 2026-08-02). Spread it into a new object, or
 * `structuredClone` it, before changing anything.
 */
export async function sharedFloorSummary<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = inflight.get(key);
  if (hit && now - hit.at < WINDOW_MS) return hit.promise as Promise<T>;

  // The entry is registered BEFORE compute can settle, and the failure cleanup checks it is still
  // the same entry. Both matter and neither is theoretical:
  //   · if compute() threw synchronously, the old order (build the promise, then set it) ran the
  //     catch's delete BEFORE the set — so a REJECTED promise stayed in the map and was handed to
  //     every caller for the next 1.5s, turning one blip into 1.5s of failures;
  //   · without the identity check, a late failure could delete a NEWER entry that a caller after
  //     the window had already stored, throwing away a perfectly good in-flight computation.
  const entry: Entry = { at: now, promise: null as unknown as Promise<unknown> };
  inflight.set(key, entry);
  entry.promise = (async () => {
    try {
      return await compute();
    } catch (e) {
      if (inflight.get(key) === entry) inflight.delete(key);   // never hand a failure to the next caller
      throw e;
    }
  })();
  const promise = entry.promise as Promise<T>;   // the map is untyped by design (one map, many shapes)

  // keep the map from growing on a many-restaurant instance
  if (inflight.size > 64) {
    for (const [k, v] of inflight) if (now - v.at > WINDOW_MS) inflight.delete(k);
  }
  return promise;
}

/**
 * Drop this restaurant's shared snapshot. Called at the START of every staff WRITE, so a
 * device that changes something and immediately reloads the floor can never be handed a
 * snapshot computed before its own action ("read your own write"). Without this a waiter who
 * marked a table paid could see the tile flick back to unpaid for a moment — the exact
 * "old value for a second" behaviour the owner refuses.
 * Over-invalidating is harmless: the next read simply computes.
 *
 * It drops EVERY key that ends in this restaurant's id, not just `floor:` — a second shared
 * read was added (`merges:<rid>`, the live table joins) and naming keys one by one is a list
 * somebody eventually forgets to extend, which would leave a just-made merge showing on one
 * device and not another for the length of the window.
 */
export function invalidateFloor(restaurantId: string): void {
  const suffix = `:${restaurantId}`;
  for (const k of [...inflight.keys()]) if (k.endsWith(suffix)) inflight.delete(k);
}

/** Test hook: forget everything (so a test can measure a cold call). */
export function _resetSharedFloorSummary(): void {
  inflight.clear();
}
