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

// ── ONE READ PER BURST, NOT ONE PER ORDER ────────────────────────────────────
//
// This check runs on EVERY public (QR) guest order, before the RPC — so on the night this
// product is built for, 800 orders in a minute meant 800 extra `settings` reads for a number
// that had not changed since the restaurant was set up. Egress is the budget this project
// guards hardest, and that is the busiest guest write there is.
//
// `table_count` is about as static as a column gets: it changes when an admin edits the floor
// plan, which is a deliberate act nobody does mid-service. So concurrent and near-concurrent
// callers share one read. The window is deliberately SHORT anyway — an admin who adds tables
// waits a few seconds before a QR order stops being refused, which is invisible — and the
// same shape the floor read already uses (lib/floorSummary.ts, 1.5s), rather than a new idea.
//
// Per RESTAURANT, always: the key is the rid, so one tenant's floor plan can never answer for
// another's. Nothing is cached on a failure — `offPlanTable` fails open, and remembering a
// failure would keep it open for the whole window.
const PLAN_WINDOW_MS = 5000;
const planCache = new Map<string, { at: number; count: number }>();

/** Test/seed hook: forget the shared counts (nothing in the app calls this). */
export function __resetPlanCache(): void { planCache.clear(); }

async function tableCountOf(rid: string): Promise<number | null> {
  const hit = planCache.get(rid);
  if (hit && Date.now() - hit.at < PLAN_WINDOW_MS) return hit.count;
  const { data, error } = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
  if (error || !data) return null;                   // can't tell → the caller lets the write through
  const count = Number(data.table_count) || 0;
  planCache.set(rid, { at: Date.now(), count });
  // The map holds one small row per restaurant this instance has served. Sweep the expired ones
  // whenever it grows past a size no real stack reaches, so a long-lived instance can't creep.
  if (planCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of planCache) if (now - v.at >= PLAN_WINDOW_MS) planCache.delete(k);
  }
  return count;
}

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
    const count = await tableCountOf(rid);           // shared across a burst — see PLAN_WINDOW_MS
    if (count == null) return null;                  // can't tell → let it through
    if (!count) return null;                         // no floor plan configured → nothing to compare
    if (n > count + PLAN_MARGIN) {
      return `Table ${raw} isn't on the floor plan (this restaurant has ${count} tables) — check the number.`;
    }
    return null;
  } catch {
    return null;                                     // fail open
  }
}
