// lib/restaurantNames.ts — "which brand does this row belong to?", in ONE place.
//
// ── WHY (T9 finding F17 + idea I9, 2026-08-12) ───────────────────────────────────────────────────
//
// Five owner routes — audit, oplog, issues, ratings, khata — each carried their own copy of:
//
//     const rest = await sb.from("restaurants").select("id, name").in("id", ids);
//     for (const x of rest.data ?? []) nameById.set(x.id, x.name);
//
// Five copies, and all five forgot the same thing: `.error` is never inspected. On a failed read
// every row renders its restaurant as "—". For a single-restaurant owner that is invisible; for a
// multi-restaurant estate it makes the whole list useless — you cannot tell which brand a removal, a
// complaint or a debt belongs to — and nothing on the page says why.
//
// Two other things were only right in ONE of the five copies, which is the other half of the reason
// this is now shared:
//
//   · `restaurants.name` is a JSONB of translations on some rows and a plain string on others
//     (older tenants vs newer ones). Only /api/owner/customers handled that; the other four would
//     have rendered `[object Object]` as a restaurant name the day they met such a row.
//   · the read needs `.limit(ids.length)` — past PostgREST's 1000-row default, every name after the
//     thousandth silently became "—" (the reports route learned this one the hard way and left a
//     comment about it; nobody else got the fix).
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

/**
 * Names for a set of restaurant ids.
 *
 * `partial` is the important part: TRUE means the lookup failed and the names are missing for a
 * reason, so the screen can say "couldn't read which restaurant each row belongs to" instead of
 * quietly printing a dash. A caller reports it as the `restaurantNames` PartialKey.
 *
 * `get()` returns `null` rather than `"—"` so the wording stays with the screen, not the data layer.
 */
export class RestaurantNames {
  readonly partial: boolean;
  private readonly byId: Map<string, string>;
  private readonly slugById: Map<string, string>;

  constructor(byId: Map<string, string>, slugById: Map<string, string>, partial: boolean) {
    this.byId = byId;
    this.slugById = slugById;
    this.partial = partial;
  }

  get(id: string | null | undefined): string | null {
    if (!id) return null;
    return this.byId.get(id) ?? null;
  }

  slug(id: string | null | undefined): string | null {
    if (!id) return null;
    return this.slugById.get(id) ?? null;
  }

  /** The ids we actually resolved — for a caller building a picker that must not list blanks. */
  get ids(): string[] {
    return [...this.byId.keys()];
  }
}

/** `restaurants.name` is JSONB on some rows and text on others. One reading of it, for everyone. */
export function readRestaurantName(name: unknown, slug: string): string {
  if (typeof name === "string" && name.trim()) return name;
  if (name && typeof name === "object") {
    const en = (name as Record<string, unknown>).en;
    if (typeof en === "string" && en.trim()) return en;
    // Any other translation is better than a slug — take the first non-empty string we find.
    for (const v of Object.values(name as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return slug;
}

/**
 * Look up the names for these ids. Never throws — a failure comes back as `partial: true` with an
 * empty map, because a missing NAME must not fail a page whose actual content read fine.
 *
 * (That is a deliberate difference from the money helpers: a wrong name is confusing, a wrong number
 * is a lie. Names degrade; figures refuse.)
 */
export async function restaurantNames(ids: (string | null | undefined)[]): Promise<RestaurantNames> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (!unique.length) return new RestaurantNames(new Map(), new Map(), false);

  const byId = new Map<string, string>();
  const slugById = new Map<string, string>();
  // Chunked by INPUT ids: the filter is an `.in(...)` list, so a thousand ids in one URL is its own
  // problem. `.limit()` matches the chunk so PostgREST's default row cap can never truncate it.
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const r = await sb.from("restaurants").select("id, name, slug").in("id", part).limit(part.length);
    if (r.error) {
      console.error("[restaurantNames] lookup failed:", r.error.message);
      return new RestaurantNames(byId, slugById, true);   // whatever resolved, plus an honest flag
    }
    for (const x of (r.data || []) as { id: string; name: unknown; slug: string }[]) {
      byId.set(x.id, readRestaurantName(x.name, x.slug));
      slugById.set(x.id, x.slug);
    }
  }
  return new RestaurantNames(byId, slugById, false);
}
