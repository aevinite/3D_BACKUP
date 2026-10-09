// lib/orderAllergies.ts — spread a change to an order's allergy line onto every dish on that order.
//
// ONE COPY, TWO DOORS (sweep #10 T30 round 3, item 16, 2026-10-09). The manager route and the waiter
// tablet each spelled this loop out, and each did it as ONE UPDATE PER DISH — the N+1 the efficiency
// playbook (§5) listed as still open — while ignoring every one of those updates' errors: the order's
// allergy line could be saved and a dish under it left unmarked, with the screen told "saved". The
// kitchen cooks to those marks.
//
// Now: one read, then ONE UPDATE PER DISTINCT RESULT (dishes that end up with the same marks are
// written together with `.in("id", …)` — normally one or two writes for a whole ticket), and a failed
// write THROWS with its SQLSTATE kept (lib/dbRefusal pgError), so the route answers honestly.
//
// TWO RULES FOUND BY ROUND 3'S OWN TEST (2026-10-09):
//   · The route must call this BEFORE it saves the order's allergy line. The change is worked out as
//     "old line vs new line"; if the line were saved first and a dish write then failed, the retry
//     would see no change at all and the dishes would never be marked — a failure that only looks
//     healed. Dishes first, line last: a retry finds the same change and finishes the job.
//   · The dishes are read in pages of PAGE, never with one cut-off: a single `.limit(500)` would have
//     skipped dish 501 in silence. Each page is still a bounded read (egress rule, playbook §1).
import { pgError } from "@/lib/dbRefusal";

type Item = { id: string; added_allergens?: unknown; removed_flag?: unknown };

/** Dishes read per page. A guest order is capped at 200 lines; staff additions are not, hence pages. */
export const PAGE = 500;

/** What one dish's marks become after the order-level change (pure — the rule both routes share). */
export function spreadOne(item: Item, added: unknown[], removed: unknown[]): { added_allergens: string[]; removed_flag: boolean } {
  const mark = new Set((Array.isArray(item.added_allergens) ? item.added_allergens : []).map((x) => String(x).toLowerCase()));
  let rf = !!item.removed_flag;
  for (const s of added) mark.add(String(s));
  for (const s of removed) { if (mark.has(String(s))) mark.delete(String(s)); else rf = true; }
  return { added_allergens: [...mark], removed_flag: rf };
}

/** Group dishes by the marks they end up with, so each distinct result is ONE write. */
export function groupSpread(items: Item[], added: unknown[], removed: unknown[]): { patch: { added_allergens: string[]; removed_flag: boolean }; ids: string[] }[] {
  const groups = new Map<string, { patch: { added_allergens: string[]; removed_flag: boolean }; ids: string[] }>();
  for (const it of items || []) {
    if (!it || !it.id) continue;
    const patch = spreadOne(it, added, removed);
    const key = JSON.stringify(patch);
    const g = groups.get(key) || { patch, ids: [] };
    g.ids.push(String(it.id));
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Read the order's dishes and write the spread. `sb` is the service-role client the route already
 * holds; every read and write is scoped to the restaurant. Returns how many writes it took.
 */
export async function spreadOrderAllergies(
  sb: any, rid: string, orderId: string, added: unknown[], removed: unknown[],
): Promise<number> {
  if (!added.length && !removed.length) return 0;
  const items: Item[] = [];
  for (let from = 0; ; from += PAGE) {
    const read = await sb.from("order_items").select("id, added_allergens, removed_flag").eq("order_id", orderId).eq("restaurant_id", rid)
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (read.error) throw pgError(read.error);
    const page = (read.data || []) as Item[];
    items.push(...page);
    if (page.length < PAGE) break;
  }
  const groups = groupSpread(items, added, removed);
  for (const g of groups) {
    const w = await sb.from("order_items").update(g.patch).in("id", g.ids).eq("restaurant_id", rid);
    if (w.error) throw pgError(w.error);
  }
  return groups.length;
}
