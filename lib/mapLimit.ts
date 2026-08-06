// ONE bounded fan-out helper for the owner's aggregate reads.
//
// There were four copies with four different limits (reports route 8, analytics route 8,
// ownerReportGather 4) and, in the merged-inventory branch, a bare `for … await` with no cap at
// all — which is the opposite problem: it runs the restaurants strictly one after another
// (T5 sweep, 2026-08-06). The rule they all exist to enforce is the same one: a bare Promise.all
// over a list fires one call PER RESTAURANT at once, which on a grown platform saturates the
// pool and times the whole payload out (audit 2026-07-07), and a handful of expensive reads
// landing together is the shape that took the database down on 2026-07-31.
//
// Order is preserved, so callers can keep pairing results with their input by index.

/**
 * Run `fn` over `items` with at most `limit` in flight. Results come back in input order.
 * A limit below 1 is treated as 1; an empty list does no work and awaits nothing.
 */
export async function mapLimit<I, O>(
  items: I[],
  limit: number,
  fn: (item: I, index: number) => PromiseLike<O> | O,
): Promise<O[]> {
  const out = new Array<O>(items.length);
  if (!items.length) return out;
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The owner routes' shared ceiling — 8 concurrent per-restaurant reads. */
export const FANOUT = 8;
/** The tighter ceiling for the heavier per-restaurant reads (staff pay, inventory). */
export const FANOUT_HEAVY = 6;
