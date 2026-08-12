// lib/logVisibility.ts — "is this owner allowed to SEE this kind of activity row?"
//
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//  THIS FILE HAS EXACTLY ONE RULE, AND IT IS NOT NEGOTIABLE:
//
//      IF WE CANNOT READ THE SWITCHES, THE ROW IS HIDDEN.
//
//  Not shown. Not "shown because it's probably fine". Hidden.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── WHY IT IS ITS OWN FILE (owner, 2026-08-12: "this should never happen … if you want to do
//    completely separate, do it") ──────────────────────────────────────────────────────────────────
//
// The T9 sweep (finding F23) found this inside /api/owner/oplog:
//
//     const rest = await sb.from("restaurants").select("id, name, owner_entitlements").in("id", ids);
//     for (const x of rest.data ?? []) entsById.set(x.id, mergeOwnerEntitlements(x.owner_entitlements));
//     ...
//     rows = rows.filter((a) => {
//       const ents = entsById.get(a.restaurant_id);
//       return !ents || ents[logKindKey(a.action)] !== false;   // ← `!ents` means SHOW
//     });
//
// The read's error was never checked. A failed read leaves `entsById` empty, `!ents` is true for
// every row, and **every row passes** — including the kinds Aevidine had deliberately switched off
// for that restaurant. A visibility switch that fails OPEN is not a switch; it is a suggestion.
//
// The reason it read that way is understandable and is exactly the trap: `!ents` was written to mean
// "this restaurant has no entitlements stored, and an absent key means ON" — which is correct and
// deliberate (`mergeOwnerEntitlements`). But "I have no row for this restaurant because nothing is
// stored" and "I have no row for this restaurant because the query failed" were the same expression.
// Two completely different facts, one variable. So the fix is not another `if` in the route — it is
// to make those two states impossible to confuse, which needs a type, which needs a file.
//
// ── HOW IT CANNOT COME BACK ──────────────────────────────────────────────────────────────────────
//
//   · `loadLogVisibility()` returns a DISCRIMINATED UNION — `{ ok: true, ... }` or `{ ok: false }`.
//     There is no `.get()` on the failure case, so a caller physically cannot ask it a question and
//     get a permissive answer by accident. TypeScript refuses to compile the old shape.
//   · `LogVisibility.canSee()` is the ONLY way to ask, and on the failure value it returns false.
//   · `npm run verify:log-visibility` (scripts/verify-log-visibility.mjs) fails the build if any
//     route filters activity rows by reading `owner_entitlements` directly instead of coming
//     through here.
//
// ── WHAT IT DOES *NOT* DO ────────────────────────────────────────────────────────────────────────
//
// This decides what an owner SEES. It never decides what gets RECORDED. Every staff action, every
// money movement and every removal is written regardless — that is `docs/COMPLIANCE-GUARDRAILS.md`
// and it is not switchable by anyone, including Aevidine. Hiding a row from a screen and not writing
// it down are different universes, and this file only touches the first.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { mergeOwnerEntitlements } from "@/lib/ownerEntitlements";

/** The three switches on Access → Owner's menu → Audit and log. */
export type LogKind = "logs_signins" | "logs_staff_changes" | "logs_service";

/**
 * Which switch a given action rides.
 *
 * Moved here from /api/owner/oplog so the per-person Activity card on a staff profile classifies
 * rows the SAME way the Activity page does — they had two copies of this and only one of them was
 * gated at all.
 */
export function logKindOf(action: string): LogKind {
  const a = String(action || "");
  if (a === "login" || a === "login_failed") return "logs_signins";
  if (a.startsWith("staff_") || a.startsWith("user_")) return "logs_staff_changes";
  return "logs_service";
}

/**
 * A successfully-loaded answer for a set of restaurants.
 *
 * `canSee` is the only question it answers. There is deliberately no way to get the raw map out:
 * every caller must go through the method, so the "absent key = on" rule lives in exactly one place.
 */
export class LogVisibility {
  /** `true` for the ADMIN's own session — the admin always sees the full record (X-ray). */
  private readonly xray: boolean;
  private readonly byRestaurant: Map<string, Record<string, boolean>>;

  constructor(xray: boolean, byRestaurant: Map<string, Record<string, boolean>>) {
    this.xray = xray;
    this.byRestaurant = byRestaurant;
  }

  /**
   * May this reader see a row of `action` from `restaurantId`?
   *
   * · admin → always yes.
   * · a restaurant we HAVE entitlements for → yes unless that kind is explicitly `false`
   *   (an absent key merges to on — `mergeOwnerEntitlements`, and that is deliberate).
   * · a restaurant we have NO entitlements row for → **no**. This is the case the old code got
   *   wrong. Reaching here means the row named a restaurant that was not in the set we loaded, i.e.
   *   outside the caller's scope — which is not something to show on doubt.
   * · a row with no restaurant at all → no, for the same reason: it cannot be checked.
   */
  canSee(restaurantId: string | null | undefined, action: string): boolean {
    if (this.xray) return true;
    if (!restaurantId) return false;
    const ents = this.byRestaurant.get(restaurantId);
    if (!ents) return false;
    return ents[logKindOf(action)] !== false;
  }

  /** Filter a page of activity rows. The only bulk helper, so no route hand-rolls the loop. */
  filter<T extends { restaurant_id?: string | null; action?: string | null }>(rows: T[]): T[] {
    if (this.xray) return rows;
    return rows.filter((r) => this.canSee(r.restaurant_id, String(r.action || "")));
  }
}

/** Loaded, or honestly not loaded. There is no third state and no permissive fallback. */
export type LogVisibilityResult =
  | { ok: true; visibility: LogVisibility }
  | { ok: false; error: unknown };

/**
 * Read the log-visibility switches for a set of restaurants.
 *
 * `xray` is for the ADMIN's own session: it short-circuits without a read at all, because the admin
 * is never filtered and there is nothing to fail.
 *
 * On a read failure this returns `{ ok: false }` — and the CALLER must decide what to do, which in
 * practice is: answer 503 and say "couldn't check what you're allowed to see". That is the honest
 * ending. Showing rows we could not check is not an option this module offers.
 */
export async function loadLogVisibility(
  restaurantIds: string[],
  xray: boolean,
): Promise<LogVisibilityResult> {
  if (xray) return { ok: true, visibility: new LogVisibility(true, new Map()) };
  const ids = [...new Set(restaurantIds.filter(Boolean))];
  if (!ids.length) return { ok: true, visibility: new LogVisibility(false, new Map()) };

  const r = await sb.from("restaurants").select("id, owner_entitlements").in("id", ids);
  if (r.error) {
    console.error("[logVisibility] could not read the log switches:", r.error.message);
    return { ok: false, error: r.error };
  }
  const map = new Map<string, Record<string, boolean>>();
  for (const row of (r.data || []) as { id: string; owner_entitlements: Record<string, boolean> | null }[]) {
    map.set(row.id, mergeOwnerEntitlements(row.owner_entitlements));
  }
  // A restaurant we asked about but got no row for stays ABSENT from the map, which `canSee` reads
  // as "cannot check → hide". That is the right answer: it means the restaurant was deleted or is
  // outside the caller's scope, and neither is a reason to show its activity.
  return { ok: true, visibility: new LogVisibility(false, map) };
}

/** The one response for "we couldn't check what you're allowed to see." Retryable, never a guess. */
export function logVisibilityUnavailable(): Response {
  return Response.json(
    {
      error: "Couldn't check which activity you're allowed to see just now — please try again.",
      transient: true,
    },
    { status: 503 },
  );
}
