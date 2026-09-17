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
//
// ── AND "CLEANED TO NOTHING" IS NOT "NOTHING WAS TYPED" (T28 sweep #9, owner picked item 11) ──────
//
// The cleaner used to answer a bare `string`, and `""` meant both things at once. Every caller was
// written the same way — `if (safe) q = q.or(…)` — so a search that cleaned down to nothing applied
// NO FILTER, and typing `*` on owner → Guests answered with the WHOLE list. Typing a character and
// getting MORE results than before is the opposite of what a search box promises. (It stays inside
// the caller's own restaurants — the scope is a separate `.in("restaurant_id", ids)` that this has
// no bearing on — so it was a confusing answer, never somebody else's data.)
//
// Two of the callers were worse again: `app/api/admin/oplog` and `app/api/admin/audit` built the
// filter UNCONDITIONALLY, so an emptied search became `ilike.%%`, which matches every row by
// construction.
//
// The fix is to stop answering a bare string. `searchTerm()` returns WHICH of the three things
// happened, so a caller cannot accidentally collapse two of them into one branch:
//
//     none          nothing was typed          → no filter, show the list
//     term          search for this            → filter
//     unsearchable  typed, none of it usable   → show nothing, and SAY so
//
// `unsearchable` is an honest answer rather than an empty one: none of `%*,()\` can be searched for
// at all (there is no escape that makes PostgREST match a literal `%` inside `ilike`), so "no guest
// matches that" is true, and telling the person their search had nothing searchable in it is the
// only thing that explains an empty screen they did not expect.
//
// ⚠️ THE TRAP IN THIS CHANGE, WATCHED HAPPENING. An object is ALWAYS truthy and stringifies to
// `[object Object]`, and TypeScript accepts BOTH — so `if (search)` and `${search}` still compile
// against this type while quietly meaning something else. That is not hypothetical: it survived a
// clean `tsc` in `app/api/admin/customers/route.ts` on the very day this landed. `verify:t28-picked`
// now reads every caller for those two shapes, because the compiler will not.

/** The characters that would change what an `ilike` search MEANS rather than what it matches. */
const MEANINGFUL = /[%*,()\\]/g;

/**
 * What a typed search turned out to mean once cleaned. A discriminated union on purpose: the bug
 * above existed because two different situations shared one value, and a `kind` cannot be ignored
 * by accident the way an empty string can.
 *
 * **In plain words:** three answers — "they typed nothing", "search for this", and "they typed
 * something, but none of it is a thing you can search for".
 */
export type SearchTerm =
  | { kind: "none"; term: "" }
  | { kind: "term"; term: string }
  | { kind: "unsearchable"; term: "" };

/**
 * Clean a typed search term for use inside a PostgREST `ilike` pattern, and say what it means.
 *
 * · wildcards (`%`, `*`) and the `or=(...)` grammar characters (`,`, `(`, `)`) are dropped, so the
 *   search means exactly the words that were typed;
 * · a backslash goes too — PostgREST's pattern escape, which would otherwise swallow the next
 *   character;
 * · the result is trimmed and length-capped, because it lands in a URL and in a query plan;
 * · WHITESPACE ONLY is `none`, not `unsearchable` — somebody who taps space in an empty box has not
 *   searched for anything, and answering them "nothing matches" would be a lie about their typing.
 */
export function searchTerm(raw: string | null | undefined, maxLen = 80): SearchTerm {
  const typed = String(raw ?? "").trim();
  if (!typed) return { kind: "none", term: "" };
  const cleaned = typed.replace(MEANINGFUL, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
  if (!cleaned) return { kind: "unsearchable", term: "" };
  return { kind: "term", term: cleaned };
}

/** Digits only — for a phone search, where anything else is noise. */
export function safePhone(raw: string | null | undefined, maxLen = 15): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, maxLen);
}
