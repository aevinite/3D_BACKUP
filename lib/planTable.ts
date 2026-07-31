// planTable.ts — "is this a table this restaurant could actually have?"
//
// WHY. The whole-app suite found 20 dine-in orders sitting on tables like **9,754,262** on a floor
// with 30 tables. They came from a test script using timestamp-shaped numbers, but the app ACCEPTED
// them, and that is the part worth fixing: a dine-in order on a table nobody can walk to is
// unreachable from the floor (the tile doesn't exist), so its money sits in the books with no way
// to serve or settle it from a panel. A typo'd QR or a hand-formed request would do the same.
//
// The rule is deliberately generous, not strict: a restaurant's own parcel/takeaway counters use
// numbering ABOVE the floor plan on purpose, so anything within a wide margin is fine. Only the
// absurd is refused — the same line the suite's own check draws (+500).
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

/** How far above the floor plan a legitimate counter number may go. */
export const PLAN_MARGIN = 500;

/**
 * Returns a refusal message when `table` is a NUMBER far beyond this restaurant's floor plan, or
 * null when the write may proceed.
 *
 * - A non-numeric label ("parcel", "banquet", "A1") is never judged here — those are off-plan by
 *   design and handled by their own features.
 * - FAILS OPEN: if the settings row can't be read we allow the write. A lookup hiccup must never
 *   stop a real order.
 */
export async function offPlanTable(rid: string, table: unknown): Promise<string | null> {
  const raw = String(table ?? "").trim();
  if (!raw || !/^\d+$/.test(raw)) return null;      // a label, not a plan number
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "That table number isn't valid.";
  try {
    const { data, error } = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
    if (error || !data) return null;                 // can't tell → let it through
    const count = Number(data.table_count) || 0;
    if (!count) return null;                         // no floor plan configured → nothing to compare
    if (n > count + PLAN_MARGIN) {
      return `Table ${raw} isn't on the floor plan (this restaurant has ${count} tables) — check the number.`;
    }
    return null;
  } catch {
    return null;                                     // fail open
  }
}
