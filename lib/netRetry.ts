// lib/netRetry.ts — a read never announces a network problem until a quiet retry has failed too.
//
// ── THE OWNER'S REPORT, 2026-09-12 ────────────────────────────────────────────────────────────────
// *"My network was fully functional, internet was perfectly fine, and for three seconds it said your
// network is not good. I click retry, now it's okay — but it should not even come for three seconds
// if my network is good."*
//
// He is right, and the mechanism is exactly what he guessed. Every client read in this app made ONE
// attempt: `lib/adminFetch.ts`, the browser Supabase client and all three panel `api()` helpers went
// straight from a single rejected fetch to a message about HIS internet, with a Try again button
// beside it. His manual Retry then succeeded — not because anything was fixed, but because the blip
// was already over by the time he could click. The app was reporting one lost packet as a verdict on
// his connection.
//
// A blip is not a diagnosis. This makes the retry the app's job instead of his.
//
// ── WHAT IS RETRIED, AND WHAT DELIBERATELY IS NOT ────────────────────────────────────────────────
//   · ONLY IDEMPOTENT requests — GET/HEAD, or a call naming no method. Re-sending a POST can ring up
//     a second order or a second bill. Writes already have an at-most-once path (the offline outbox
//     and lib/idempotency.ts) and must never be retried here. This is the rule that keeps the fix
//     from becoming a compliance problem.
//   · ONLY TRANSIENT PLUMBING — fetch itself rejecting (connection reset, socket hang-up, a DNS
//     blink) or the edge answering 502/503/504. A 4xx is an ANSWER, not a blip: a second identical
//     request gets the same reply, and 429 in particular must never be hammered — tripping the app's
//     own rate limits is how a test once alerted the owner's phone.
//   · NEVER after the caller aborted, and NEVER after a deadline fired. The person navigated away, or
//     the request has already had all the time it was given. Retrying past a deadline would quietly
//     double the ceiling every screen was tuned to.
//   · NEVER when the browser KNOWS it is offline. `navigator.onLine === false` is trustworthy in the
//     negative, and "no internet" is an honest thing to say IMMEDIATELY — the offline layer exists
//     for precisely that case and shows saved data instead. (The converse is not true: `onLine` being
//     true only means a network adapter is up, not that the internet works — which is why nothing
//     here waits for it to be true.)
//
// ── THE BUDGET IS SMALL ON PURPOSE ───────────────────────────────────────────────────────────────
// Two extra attempts, ~250ms and ~600ms, each jittered so that a dining room full of phones coming
// back at once does not re-synchronise into a second wave against the same server. Worst case, a
// genuinely dead server costs under a second before the person is told — against the three seconds
// he spent reading a wrong message. And because the retry happens INSIDE the fetch, the screen stays
// in its existing LOADING state the whole time: no error flashes up and takes itself back, which is
// the other half of what he asked for.
//
// Not to be confused with lib/readRetry.ts — that is the SERVER's one retry for a Supabase read that
// came back with a connection-class SQLSTATE. Same principle, different layer; this one is the
// browser's, and it is the only one a person can see.

/** How long to wait before each extra attempt. Length = how many retries. */
const ATTEMPT_WAITS_MS = [250, 600];

/** Statuses that mean "the machinery in front of the app, not the app". Never 4xx, never 429. */
const TRANSIENT_STATUS = new Set([502, 503, 504]);

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Spread a retry wave: the wait plus up to half of itself again. */
const jitter = (ms: number) => ms + Math.floor(Math.random() * (ms / 2));

/** A request is safe to send twice only when sending it twice cannot change anything. */
function isIdempotent(init?: RequestInit): boolean {
  const m = (init?.method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

/** An abort is a decision — the caller's, or the deadline's. It is never a blip. */
function isAbort(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

/** True only when the browser is CERTAIN there is no connection. */
function knownOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * fetch(), but a transient failure on an idempotent request is retried quietly before the caller —
 * and therefore the person — ever hears about it. Same signature as fetch, so it is a drop-in.
 */
export async function retryFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // A write goes out exactly once, always. No exceptions, no "it was only a GET-ish POST".
  if (!isIdempotent(init)) return fetch(input, init);

  let lastRes: Response | undefined;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= ATTEMPT_WAITS_MS.length; attempt++) {
    if (attempt > 0) {
      await wait(jitter(ATTEMPT_WAITS_MS[attempt - 1]));
      // The person may have left, or the deadline may have passed, while we waited.
      if (init?.signal?.aborted) break;
    }
    try {
      const res = await fetch(input, init);
      // Anything that is a real answer — including a 4xx — goes straight back to the caller.
      if (!TRANSIENT_STATUS.has(res.status)) return res;
      lastRes = res;
    } catch (e) {
      // Told to stop, or genuinely offline: say so now rather than stalling on hopeless retries.
      if (isAbort(e) || init?.signal?.aborted || knownOffline()) throw e;
      lastErr = e;
    }
  }

  // Every attempt failed. Hand back the last real answer if there was one, else the last error —
  // so callers keep the exact shape they have always handled.
  if (lastRes) return lastRes;
  throw lastErr;
}
