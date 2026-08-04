// clashCompare.ts — "is this value still the one the screen was editing from?"
//
// Its OWN file, with no imports at all, for the same reason lib/idempotencyRule.ts is: it is pure
// decision logic that a guard must be able to execute directly. Lifting it out of a module that
// pulls in Next and Supabase is the difference between a test that runs the REAL comparator and
// one that runs a hand-mangled copy of it — and a copy proves nothing about what ships.
//
// WHY THE OBJECT CASE EXISTS. This used to stringify everything, so every object became the
// literal "[object Object]" and two completely different values compared EQUAL. Any jsonb column
// was therefore unprotectable no matter what the call site sent. Most visibly
// `settings.table_names`: every table name lives inside one object, and the editor's save diffs by
// top-level key, so renaming a single table sends the whole thing. Two managers renaming different
// tables at the same moment meant the second save silently wiped the first's rename.

/**
 * A stable string for any value: object keys sorted at every level, so the same content compares
 * equal however it was serialised. PostgREST does not promise key order and neither does an object
 * built by a form.
 *
 * Depth-limited — these are settings blobs, not arbitrary graphs, and a cycle must never hang a
 * write. Past the limit we stop descending, which makes deep values compare EQUAL: that fails
 * OPEN (allow the write), the same direction every other decision in the clash check takes.
 */
export function stableJson(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return depth > 6 ? "[…]" : "[" + v.map((x) => stableJson(x, depth + 1)).join(",") + "]";
  if (typeof v === "object") {
    if (depth > 6) return "{…}";
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableJson(o[k], depth + 1)).join(",") + "}";
  }
  return String(v).trim();
}

export const isPlainObject = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Compare loosely enough that formatting isn't treated as a change:
 *  - text is trimmed
 *  - lists compare as SETS (an allergen list's order is not meaningful)
 *  - objects compare by CONTENT
 *  - a null/absent value and an empty object are the same, so a column that has simply never been
 *    set cannot invent a clash
 */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v == null ? "" : String(v).trim());
  if (Array.isArray(a) || Array.isArray(b)) {
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => norm(x).toLowerCase()).filter(Boolean).sort() : []);
    const x = arr(a), y = arr(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    const j = (v: unknown) => (v == null ? "{}" : stableJson(v));
    return j(a) === j(b);
  }
  return norm(a) === norm(b);
}
