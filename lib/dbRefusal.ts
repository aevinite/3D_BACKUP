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

/** Is this the database refusing the CONTENT of a write (as opposed to failing to serve it)? */
export function isDataRefusal(e: unknown): boolean {
  const o = (e || {}) as MaybePgError;
  const code = typeof o.code === "string" ? o.code : "";
  if (code && REFUSAL_CODES.has(code)) return true;
  const msg = [o.message, o.details].filter((x) => typeof x === "string").join(" ");
  return REFUSAL_TEXT.test(msg);
}

/** 400 when the database refused the value, 500 when the database failed to answer. */
export function refusalStatus(e: unknown, fallback = 500): number {
  return isDataRefusal(e) ? 400 : fallback;
}

/**
 * What to SHOW for a refusal. Named constraints get their own sentence; anything else gets a
 * plain one rather than raw Postgres. A non-refusal keeps its original message, because that is
 * what the error log and the retry logic are reading.
 */
export function refusalMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String((e as MaybePgError)?.message ?? e ?? "");
  if (!isDataRefusal(e)) return raw;
  for (const name of Object.keys(PLAIN)) if (raw.includes(name)) return PLAIN[name];
  const m = raw.match(/violates unique constraint/i) ? "Something with that name or number already exists."
    : raw.match(/violates foreign key/i) ? "That refers to something that no longer exists — reload and try again."
    : raw.match(/violates not-null/i) ? "Something required was left empty."
    : "That value isn't allowed here.";
  return m;
}
