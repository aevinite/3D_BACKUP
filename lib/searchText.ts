// lib/searchText.ts — cleaning what someone typed into a search box, once, for every screen.
//
// ── WHY (T9 finding F15 + idea I14, 2026-08-12) ──────────────────────────────────────────────────
//
// Two owner screens let you type a search, and they cleaned the text differently:
//
//     /api/owner/oplog      qText.replace(/[%,()]/g, " ")     ← misses *
//     /api/owner/customers  q.replace(/[,()%*]/g, "")         ← strips *
//
// PostgREST translates `*` into `%` inside an `ilike` pattern (it is its documented wildcard, because
// `%` is awkward in a URL). So on the Activity log, typing `*` matched EVERY row instead of the
// literal character — and any search containing one silently returned far more than it should.
//
// The characters being removed are not removed for safety — PostgREST parameterises the value, and
// nothing here is concatenated into SQL. They are removed for CORRECTNESS: `,` and `)` end a filter
// term in PostgREST's own `or=(...)` grammar, and `%`/`*` are wildcards. Leaving any of them in means
// the search does something other than what the person typed.
//
// One function, so the two screens cannot disagree again, and the next search box gets it for free.

/** The characters that would change what an `ilike` search MEANS rather than what it matches. */
const MEANINGFUL = /[%*,()\\]/g;

/**
 * Clean a typed search term for use inside a PostgREST `ilike` pattern.
 *
 * · wildcards (`%`, `*`) and the `or=(...)` grammar characters (`,`, `(`, `)`) are dropped, so the
 *   search means exactly the words that were typed;
 * · a backslash goes too — PostgREST's pattern escape, which would otherwise swallow the next
 *   character;
 * · the result is trimmed and length-capped, because it lands in a URL and in a query plan.
 *
 * Returns `""` when nothing usable is left, which every caller treats as "no search" rather than as
 * "search for an empty string" (an empty `ilike '%%'` matches everything — the very bug above).
 */
export function safeSearch(raw: string | null | undefined, maxLen = 80): string {
  return String(raw ?? "").replace(MEANINGFUL, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** Digits only — for a phone search, where anything else is noise. */
export function safePhone(raw: string | null | undefined, maxLen = 15): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, maxLen);
}
