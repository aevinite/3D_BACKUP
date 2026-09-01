// dbRefusal.ts — "the database said no to this VALUE" is not "the server is busy".
//
// WHY THIS EXISTS (2026-08-02). The owner set Tables per row to 18 in the manager panel and saw
// a blue bar: "Sending 3 saved changes… Made while you were offline." His connection was fine
// (the panel's own badge read 487 ms and live updates were flowing) and the layout never
// changed. What actually happened:
//
//   settings.floor_per_row still carried migration 226's CHECK (2..12), so 18 was refused by
//   the database → the route's catch-all turned that into a 500 → and a 500, by design, means
//   "the server can't take this right now, save it on the device and send it later" (see
//   public/panels/outbox.js and the busy-server rules in CLAUDE.md).
//
// So a write that could NEVER succeed was queued, retried behind his back, and blamed on his
// internet. The rule the app already had was right — it was applied to the wrong thing:
//
//   5xx = the server is struggling  → keep the work, retry, tell them it is saved.
//   4xx = the server refuses it     → the person must see it. Never retry it silently.
//
// A constraint violation, a bad number, a missing reference: those are refusals of the CONTENT.
// They will be refused identically forever, so they belong in the second bucket. This helper
// spots them in whatever the Supabase client threw and gives back the status + a sentence a
// person can act on.
//
// It is deliberately conservative: anything it does not recognise stays a 500, because a real
// database hiccup MUST keep its "save it and retry" behaviour.
//
// NO IMPORTS ON PURPOSE: tests/error-text.test.mjs loads this file with plain `node --test`, which
// resolves neither the `@/` alias nor an extensionless specifier. Keep it self-contained.

// Postgres SQLSTATEs that mean "this data is not acceptable" (class 22 = data exception,
// class 23 = integrity constraint violation). Everything else — connection failures, timeouts,
// deadlocks, out-of-memory — is a server problem and stays a 500.
const REFUSAL_CODES = new Set([
  // ── OUR OWN refusal codes (mig 278) ──────────────────────────────────────────────────────────
  // A refusal the app must RECOGNISE gets its own SQLSTATE instead of being identified by the words
  // of its message. Registered here as data refusals so that even a route branch nobody wrote
  // answers 4xx — never a 500, which public/panels/outbox.js would queue and retry forever behind
  // the person. See the migration's header for the full reasoning.
  "LFH01", // the invoice is locked — the bill is settled and cannot be reopened
  "LFH02", // a credit note bigger than the bill total
  "LFH03", // reopening a bill was asked for without a reason (mig 286's guard, coded in mig 300)
  "22001", // string too long
  "22003", // number out of range
  "22007", // invalid date/time format
  "22P02", // invalid text representation (e.g. "abc" into an int column)
  "23502", // not-null violation
  "23503", // foreign key violation
  "23505", // unique violation
  "23514", // CHECK constraint violation  ← the floor_per_row case
  "23P01", // exclusion violation
]);

// The same thing said in prose, for the paths where only a message survives.
const REFUSAL_TEXT = /violates (check|unique|foreign key|not-null|exclusion) constraint|invalid input syntax|value too long|out of range|numeric field overflow/i;

// A few constraints we can name properly. Postgres prose ("new row for relation \"settings\"
// violates check constraint \"settings_floor_per_row_range\"") is not something to put in front
// of a manager mid-service. Add a line here when you add a constraint a person can trip.
const PLAIN: Record<string, string> = {
  settings_floor_per_row_range: "Tables per row has to be a whole number between 2 and 30.",
};

// Our own codes → the sentence a person reads (mig 278). Keyed by SQLSTATE, so the wording of the
// SQL exception can change freely without changing what anyone is told.
const OWN_CODE_TEXT: Record<string, string> = {
  LFH01: "This bill is settled — its invoice can't be reopened. Make a credit note instead.",
  LFH02: "The credit can't be more than the bill total.",
  // Migration 286 started refusing a void with no reason, but raised it as a generic
  // check_violation — so this arrived as "That value isn't allowed here." and nobody learned
  // what to do. The manager panel asks for a reason before calling; this sentence is for every
  // other caller 286 was written to cover (the Repair Kit, a script, a future panel).
  LFH03: "Say why this bill is being reopened — a reason is required.",
};
/** Our own refusal code, if this error carries one (mig 278). Null for anything else. */
export function ownRefusalCode(e: unknown): string | null {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && c in OWN_CODE_TEXT ? c : null;
}

type MaybePgError = { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };

// ── "IT ISN'T THERE ANY MORE" IS THE SAME MISTAKE AS THE ONE ABOVE (2026-08-03) ───────────────
// A .single() that matches nothing throws PostgREST's PGRST116 with the message "Cannot coerce
// the result to a single JSON object". Until now that fell through to the catch-all: a 500, a red
// crash row on the admin's error board, and — because 5xx means "the server is struggling" — the
// offline queue keeping the tap and retrying it forever. But a row that is gone will still be gone
// on the next try, exactly like a value the CHECK constraint refuses. It is a 4xx.
//
// It is also NOT a fault. Two people on a floor race constantly: a waiter taps Accept on a KOT the
// manager just cancelled, a stale tile is tapped after its table was closed. Logging that as a
// crash puts ordinary racing on the same board as real breakage — and a board full of non-faults
// is a board nobody reads (see the errlog "Failed to fetch" noise filter, same reasoning).
//
// Deliberately narrow: PGRST116 ALSO fires when .single() matches MORE than one row, and that is a
// genuine data fault (a duplicate that shouldn't exist) which must keep its 500 and its red row.
// So we require the "0 rows" detail; with no detail to read, nothing changes.
const MISSING_ROW_DETAIL = /contains?\s+0\s+rows/i;

/**
 * Did the row simply not exist? (A .single()/.maybeSingle() lookup that matched nothing.)
 * True only for the 0-row case — "more than one row" stays a real error.
 */
export function isMissingRow(e: unknown): boolean {
  const o = (e || {}) as MaybePgError;
  if (o.code !== "PGRST116") return false;
  const detail = typeof o.details === "string" ? o.details : "";
  return MISSING_ROW_DETAIL.test(detail);
}

/**
 * Rethrow a Supabase/Postgres error WITHOUT losing its SQLSTATE (mig 278).
 *
 * THE BUG THIS EXISTS FOR. Route handlers did `throw new Error(error.message)`, which builds a
 * brand-new Error carrying only the text. Every classifier in this file reads `.code` first, so a
 * rethrown database error arrived with no code at all — and a refusal whose message matched none of
 * the patterns below became an unknown failure → 500 → and a 500 on a write means "the server is
 * struggling", so public/panels/outbox.js queued it and retried it forever behind the person.
 *
 * Carrying `code`, `details` and `hint` through means isDataRefusal / isDbUnreachable / isMissingRow
 * all still work on the way out of the catch, so the status a person gets is the honest one.
 */
export function pgError(e: unknown): Error {
  const o = (e || {}) as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
  const err = new Error(typeof o.message === "string" ? o.message : String(o.message ?? "database error"));
  // Assigned rather than passed to the constructor so this stays a plain Error for every caller
  // that only reads .message (which is most of them).
  if (o.code !== undefined) (err as unknown as { code?: unknown }).code = o.code;
  if (o.details !== undefined) (err as unknown as { details?: unknown }).details = o.details;
  if (o.hint !== undefined) (err as unknown as { hint?: unknown }).hint = o.hint;
  return err;
}

/** Is this the database refusing the CONTENT of a write (as opposed to failing to serve it)? */
export function isDataRefusal(e: unknown): boolean {
  const o = (e || {}) as MaybePgError;
  const code = typeof o.code === "string" ? o.code : "";
  if (code && REFUSAL_CODES.has(code)) return true;
  if (isMissingRow(e)) return true;
  const msg = [o.message, o.details].filter((x) => typeof x === "string").join(" ");
  return REFUSAL_TEXT.test(msg);
}

// ── "I COULDN'T REACH THE DATABASE" IS THE THIRD BUCKET (2026-08-03) ──────────────────────────
// The two buckets above split a failure into "the database refuses this VALUE" (4xx, the person
// must see it) and "something else went wrong" (500). But the biggest group of failures we
// actually record is neither: the database was simply not answering.
//
// On 2026-08-03 the Fix-NOW board filled with 56 of them in one morning — every one of these,
// on both restaurants, across five different manager reads:
//
//   "GET sessions — TimeoutError: The operation was aborted due to timeout"
//   "GET summary  — TypeError: fetch failed"
//
// The first is our own 8-second deadline (lib/supabaseAdmin.ts) firing because the shared
// instance was saturated; the second is the connection never being made at all. Measured
// afterwards, every one of those endpoints answers in 65-1000 ms — nothing was broken, the
// database was busy for about two hours.
//
// A 500 was the wrong answer to that, in two ways a person feels:
//
//   · the manager panel showed the raw sentence "TimeoutError: The operation was aborted due to
//     timeout" in a red toast — which reads as "this app is broken", not "one moment";
//   · a 500 is "the truth" to the service worker, so it is passed straight through instead of
//     falling back to the copy already saved on the device (public/sw.js). The device HAD the
//     floor from a minute earlier and showed an error instead.
//
// The owner's rule is explicit (CLAUDE.md, the rush section): "the server can't take this right
// now" takes the SAME path as "no internet". That was built for WRITES (they queue and replay).
// This is the read half of the same rule: 503 + a `busy` marker, which the service worker reads
// as "answer from the device and say so".
//
// Nothing is hidden by this: the error row is still recorded with the ORIGINAL message (the
// routes hand the raw error to logError), so the Repair board still shows exactly what happened.
// Only the status and the sentence a person reads change. A 500 stays a 500 for anything we do
// NOT recognise here, so a genuine bug is never dressed up as a busy moment.
const UNREACHABLE_CODES = new Set([
  "57014", // query_canceled — "canceling statement due to statement timeout"
  "08000", "08001", "08003", "08004", "08006", // connection exception family
  "53100", // disk full
  "53200", // out of memory
  "53300", // too many connections  ← the peak-load shape we design against
  "55P03", // lock not available
  "40001", // serialization failure (retryable by definition)
  "40P01", // deadlock detected
  // ── THE POOLER RECYCLING US IS "IT DIDN'T ANSWER", NOT "THE APP BROKE" ──────────────────────
  // (T25 round 3, item 42, 2026-08-31.) lib/readRetry.ts has treated these three as transient since
  // it was written — it retries them once, and its own comment names the cause: "the pooler recycled
  // us". This file did not have them, so the SAME failure was "retry me" to one file and "an app bug"
  // to the other: a 500 with "something went wrong at our end" instead of a 503 with "the system is
  // very busy — this will come back by itself", and a red crash row on the Repair board for a
  // connection that was simply taken away mid-request.
  //
  // Only these three, and deliberately not readRetry's `XX000` (internal_error): the pooler reports
  // some drops as XX000, but so does a genuine bug, and calling every internal error "busy" would
  // hide the faults this board exists to show.
  "57P01", // admin_shutdown     — the pooler recycled the connection
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now — still starting up
]);

// The same conditions as prose, for the paths where only a message survives — a fetch that never
// connected, our own deadline, PostgREST/Cloudflare in front of a database that stopped answering.
//
// The last group is what a GATEWAY error PAGE says. When Supabase's edge can't reach the database
// it answers with a whole Cloudflare HTML page and supabase-js hands that page over as the error
// message (the 2026-07-31 ticket — errorSignature.readableError exists for the same reason). We
// match the WORDS such a page carries rather than parsing HTML here, so there is no second copy
// of that parser to drift from the first.
const UNREACHABLE_TEXT =
  /statement timeout|operation was aborted|aborted due to timeout|fetch failed|socket hang up|econnreset|econnrefused|etimedout|enotfound|eai_again|epipe|connection (refused|reset|closed|terminated|timed out)|too many (clients|connections)|server closed the connection|upstream request timeout|gateway time-?out|service unavailable|temporarily unavailable|bad gateway|web server is down|origin is unreachable|5(0[234]|22|23|24)\s*:/i;

// AbortSignal.timeout() rejects with a DOMException named TimeoutError; a caller's own
// controller gives AbortError. Both mean the same thing here: we gave up waiting.
const UNREACHABLE_NAMES = new Set(["TimeoutError", "AbortError", "ConnectTimeoutError", "HeadersTimeoutError", "BodyTimeoutError"]);

/**
 * Was the database simply not reachable in time? (As opposed to refusing the request, or the
 * app throwing.) True → 503 + `busy`, so the read falls back to the device's saved copy and the
 * write keeps its existing "save it and replay" behaviour.
 */
export function isDbUnreachable(e: unknown): boolean {
  // A refusal of the VALUE is decided first: it is specific, and it must never be retried.
  if (isDataRefusal(e) || isMissingRow(e)) return false;
  const o = (e || {}) as MaybePgError & { name?: unknown; cause?: unknown };
  if (typeof o.name === "string" && UNREACHABLE_NAMES.has(o.name)) return true;
  const code = typeof o.code === "string" ? o.code : "";
  if (code && UNREACHABLE_CODES.has(code)) return true;
  // Node's fetch reports "fetch failed" and hides the real reason (ECONNRESET, ENOTFOUND…) on
  // `cause` — so read that too, or every dropped connection looks like an unknown 500.
  const cause = (o.cause || {}) as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof cause.name === "string" && UNREACHABLE_NAMES.has(cause.name)) return true;
  if (typeof cause.code === "string" && UNREACHABLE_CODES.has(cause.code)) return true;
  const msg = [o.message, o.details, cause.message, cause.code].filter((x) => typeof x === "string").join(" ");
  return UNREACHABLE_TEXT.test(msg);
}

/** What a person reads when the database didn't answer. Never blames their internet. */
export const BUSY_MESSAGE = "The system is very busy right now — this will come back by itself in a moment.";

/**
 * Should this failure be written to the error board as a red crash row?
 * Everything except the pure "someone else already changed/removed it" race — that is normal
 * floor traffic, not a fault, and it drowns out the errors that ARE.
 *
 * A busy database IS still logged: it is a real incident the owner needs to see on the Repair
 * board (that is how the backup stacks surface trouble at all — they send no phone alerts).
 */
export function worthLogging(e: unknown): boolean {
  return !isMissingRow(e);
}

/** 400 when the database refused the value, 503 when it didn't answer, 500 when the app broke. */
export function refusalStatus(e: unknown, fallback = 500): number {
  // Our own refusals are CONFLICTS, not bad input: the request was well-formed, the bill's state
  // says no. 409 is what the panels already treat as "a person must read this" (mig 278).
  if (ownRefusalCode(e)) return 409;
  if (isMissingRow(e)) return 404;
  if (isDataRefusal(e)) return 400;
  if (isDbUnreachable(e)) return 503;
  return fallback;
}

/**
 * What to SHOW for a refusal. Named constraints get their own sentence; anything else gets a
 * plain one rather than raw Postgres. A non-refusal keeps its original message, because that is
 * what the error log and the retry logic are reading.
 */
export function refusalMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String((e as MaybePgError)?.message ?? e ?? "");
  // "Cannot coerce the result to a single JSON object" is a sentence for a developer, and it
  // arrives in front of a waiter mid-service. Say what happened instead.
  if (isMissingRow(e)) return "That's not there any more — someone else may have changed or removed it. Refresh and try again.";
  // Same reasoning for "TimeoutError: The operation was aborted due to timeout", which is what a
  // manager was actually shown in a red toast for two hours on 2026-08-03.
  if (isDbUnreachable(e)) return BUSY_MESSAGE;
  // One of OUR codes (mig 278) → its own sentence, never the raw `lfh: invoice locked — …` prose,
  // which was written for the error log and not for a waiter mid-service.
  const own = ownRefusalCode(e);
  if (own) return OWN_CODE_TEXT[own];
  if (!isDataRefusal(e)) return raw;
  for (const name of Object.keys(PLAIN)) if (raw.includes(name)) return PLAIN[name];
  const m = raw.match(/violates unique constraint/i) ? "Something with that name or number already exists."
    : raw.match(/violates foreign key/i) ? "That refers to something that no longer exists — reload and try again."
    : raw.match(/violates not-null/i) ? "Something required was left empty."
    : "That value isn't allowed here.";
  return m;
}
