// lib/readRetry.ts — one retry for a read that failed for a reason that will probably not repeat.
//
// ── THE OWNER'S QUESTION, 2026-08-12: "why are they failing to load and read? that should not happen" ──
//
// He is right, and it is worth being precise about what a "failed read" here actually IS, because
// the answer changes what the fix should be.
//
// A read from this app to Supabase is an HTTPS round trip from a Vercel function in one region to
// Postgres in Mumbai. It comes back as `{ data, error }` — never a thrown exception — and `error`
// covers four genuinely different things:
//
//   1. TRANSIENT PLUMBING — the TCP connection was reset, the socket hung up, the pooler dropped an
//      idle connection, DNS blinked, a 502/503/504 came back from the edge. These are the ordinary
//      background noise of talking to another machine over the internet. They do not mean anything
//      is wrong with the query, the data or the app, and **the same request one moment later
//      succeeds.** This is what most of the "blips" the sweep worried about really are.
//   2. TOO SLOW — Postgres hit its statement timeout (57014). The query really is too heavy for the
//      data it is being asked about.
//   3. WRONG — a column that doesn't exist, a permission the function was never granted, bad input.
//      Broken code or broken config.
//   4. REFUSED — a constraint said no (a duplicate key, a check).
//
// ONLY case 1 is worth retrying, and one retry is enough: if a second attempt a few hundred
// milliseconds later also fails, something real is wrong and the owner should be told rather than
// kept waiting. Retrying case 2 makes a slow page slower and doubles the load that caused it.
// Retrying 3 or 4 is pointless — the second answer is identical to the first, always.
//
// So this is deliberately NOT a general-purpose retry library. It is: *one* extra attempt, *only*
// for plumbing, *only* for READS (a write retry is a duplicate-row problem and is already solved
// elsewhere, by `lib/idempotency.ts` — do not use this for writes).
//
// What this does NOT fix, and nothing at this layer can: a genuinely slow query. That is what the
// timing probe (`scripts/read-timings.mjs`) and indexes are for. This file stops the *noise*
// reaching a human; it does not paper over a real problem, because case 2 is passed straight
// through to `dbFail`, which already turns 57014 into advice the owner can act on.

/** The shape every supabase read returns. */
export type SbRead<T = unknown> = { data: T | null; error: unknown };

/** How long to wait before the single retry — short, jittered so a wave doesn't re-synchronise. */
const RETRY_WAIT_MS = 120;
const JITTER_MS = 80;

/**
 * Postgres/PostgREST error codes that mean "the connection, not the query".
 * 08xxx is the SQL standard's whole connection-exception class.
 */
const TRANSIENT_CODES = new Set([
  "08000", // connection_exception
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "53300", // too_many_connections
  "57P01", // admin_shutdown       (the pooler recycled us)
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now   (still starting up)
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "XX000", // internal_error — Supabase's pooler reports some connection drops as this
]);

/** Fetch-layer failures never carry a Postgres code, only a message. */
const TRANSIENT_TEXT = /(fetch failed|network|socket hang up|econnreset|econnrefused|etimedout|epipe|enotfound|eai_again|terminating connection|connection closed|connection reset|server closed the connection|502|503|504|bad gateway|service unavailable|gateway timeout)/i;

/**
 * Is this error worth ONE more attempt?
 *
 * Deliberately answers NO for a statement timeout (57014). See the header: retrying a query that was
 * too slow makes it slower and doubles the load. `dbFail` already turns that one into real advice
 * ("try a shorter period, or one restaurant at a time").
 */
export function isTransient(error: unknown): boolean {
  if (!error) return false;
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code) : "";
  if (code === "57014") return false;                   // too slow — a retry cannot help
  if (code && TRANSIENT_CODES.has(code)) return true;
  const msg = error instanceof Error ? error.message
    : (typeof error === "object" && error && "message" in error)
      ? String((error as { message: unknown }).message)
      : String(error);
  // A bare "TypeError: fetch failed" from undici is the single most common shape of case 1.
  return TRANSIENT_TEXT.test(msg);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a READ, and if it fails for a plumbing reason, run it exactly once more.
 *
 * `run` is a function so it can genuinely be called twice. It is also wrapped in a try/catch because
 * a hard network failure sometimes THROWS out of the supabase client instead of arriving as
 * `{ error }` — and a route that only handles `{ error }` would turn that into a 500 with no body.
 * Normalising both shapes here is half the point of this file.
 */
export async function retryRead<T>(
  run: () => PromiseLike<SbRead<T>>,
): Promise<{ result: SbRead<T>; retried: boolean }> {
  const attempt = async (): Promise<SbRead<T>> => {
    try {
      const r = await run();
      // A client that resolves with neither data nor error is still a failure, not an empty answer.
      return r ?? { data: null, error: new Error("read returned nothing") };
    } catch (e) {
      return { data: null, error: e };
    }
  };

  const first = await attempt();
  if (!first.error || !isTransient(first.error)) return { result: first, retried: false };

  await wait(RETRY_WAIT_MS + Math.floor(Math.random() * JITTER_MS));
  const second = await attempt();
  return { result: second, retried: true };
}
