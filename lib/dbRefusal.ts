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

// Postgres SQLSTATEs that mean "this data is not acceptable" (class 22 = data exception,
// class 23 = integrity constraint violation). Everything else — connection failures, timeouts,
// deadlocks, out-of-memory — is a server problem and stays a 500.
const REFUSAL_CODES = new Set([
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

/** Is this the database refusing the CONTENT of a write (as opposed to failing to serve it)? */
export function isDataRefusal(e: unknown): boolean {
  const o = (e || {}) as MaybePgError;
  const code = typeof o.code === "string" ? o.code : "";
  if (code && REFUSAL_CODES.has(code)) return true;
  if (isMissingRow(e)) return true;
  const msg = [o.message, o.details].filter((x) => typeof x === "string").join(" ");
  return REFUSAL_TEXT.test(msg);
}

/**
 * Should this failure be written to the error board as a red crash row?
 * Everything except the pure "someone else already changed/removed it" race — that is normal
 * floor traffic, not a fault, and it drowns out the errors that ARE.
 */
export function worthLogging(e: unknown): boolean {
  return !isMissingRow(e);
}

/** 400 when the database refused the value, 500 when the database failed to answer. */
export function refusalStatus(e: unknown, fallback = 500): number {
  if (isMissingRow(e)) return 404;
  return isDataRefusal(e) ? 400 : fallback;
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
  if (!isDataRefusal(e)) return raw;
  for (const name of Object.keys(PLAIN)) if (raw.includes(name)) return PLAIN[name];
  const m = raw.match(/violates unique constraint/i) ? "Something with that name or number already exists."
    : raw.match(/violates foreign key/i) ? "That refers to something that no longer exists — reload and try again."
    : raw.match(/violates not-null/i) ? "Something required was left empty."
    : "That value isn't allowed here.";
  return m;
}
