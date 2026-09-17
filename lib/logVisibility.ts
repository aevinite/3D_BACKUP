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
import { readInChunks } from "@/lib/inChunks";

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

  // CHUNKED + LIMITED (T25 sweep, 2026-08-21). This one matters most of the five, because of the
  // rule in the box at the top of this file: a restaurant that is ABSENT from the map is
  // `canSee -> false`. That is exactly right when the reason is "outside the caller's scope", and
  // exactly wrong when the reason is "PostgREST capped the answer at 1,000 rows and said nothing".
  // Truncation would therefore HIDE activity the owner is entitled to see, and it would look like an
  // empty log rather than a failure — the one shape this file exists to make impossible.
  // readInChunks turns it back into `{ error }`, which the caller already answers 503 for.
  // Measurements: lib/inChunks.ts.
  const r = await readInChunks<{ id: string; owner_entitlements: Record<string, boolean> | null }>(ids, (chunk) =>
    sb.from("restaurants").select("id, owner_entitlements").in("id", chunk).limit(chunk.length));
  if (r.error) {
    console.error("[logVisibility] could not read the log switches:", (r.error as { message?: string })?.message ?? String(r.error));
    return { ok: false, error: r.error };
  }
  const map = new Map<string, Record<string, boolean>>();
  for (const row of r.rows || []) {
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

// ── AND THREE KINDS THE OWNER NEVER SEES AT ALL, DECLARED ONCE ───────────────────────────────────
//
// Everything above answers "may this owner see this KIND of row", which is a per-restaurant switch
// Aevidine sets. Three exclusions sit underneath that and are not switches at all — no owner sees
// them, on any restaurant, ever:
//
//   · `panel in (admin,db)`  — the admin's own actions and direct-database edits
//   · `level = 'error'`      — app FAULTS are a support signal for the admin, not the owner. The
//                              owner's "problems" surface is Complaints (owner, 2026-07-26). An OR
//                              rather than a plain `neq`, or a NULL level would be dropped too.
//   · `action = 'ui_taps'`   — the raw button-tap breadcrumbs `public/panels/errlog.js` writes so
//                              support can see what someone was doing before a crash. They are
//                              level:'info' on a normal panel, so they passed both filters above
//                              and landed in the owner's list as "Button taps", hundreds at a time,
//                              pushing the real staff actions off the page (T9 sweep, 2026-08-05).
//
// WHY THEY MOVED HERE (T28 sweep #9, owner picked item 12, 2026-09-17). They were written out twice:
// as three function-local `const`s in `/api/owner/oplog` (applied to the page AND, since round 2, to
// the count beside it) and as three hard-coded strings in `/api/owner/staff`'s per-person activity
// card. Two copies of a filter that decides WHAT IS COUNTED is the shape that produced "page 4 of 3"
// in this very file's neighbour: the list and its total were filtered differently, so the footer
// described a set the page was not showing. A third surface would have had to get all three right
// again from memory.
//
// One function, applied to both the rows and the count, so they cannot drift apart.

/** The three standing exclusions, as PostgREST filter fragments. Exported for guards and tests. */
export const OWNER_LOG_EXCLUDES = {
  /** `.not("panel", "in", …)` */
  panels: "(admin,db)",
  /** `.or(…)` — keeps rows whose level is NULL, drops only `error` */
  level: "level.is.null,level.neq.error",
  /** `.neq("action", …)` */
  action: "ui_taps",
} as const;

/**
 * Narrow any `staff_actions` query to the rows an owner is allowed to see at all.
 *
 * Generic over the builder rather than typed to one, so the same call works for the paged
 * `select()` and for the `head: true` count beside it — which is the whole point: a list and the
 * total under it must be filtered by the same thing or the pager lies.
 *
 * **In plain words:** hide the three kinds of row the owner is never shown, in one place, so no
 * screen can forget one of them.
 */
export function withoutHiddenKinds<Q>(q: Q): Q {
  const f = q as unknown as StaffActionFilter;
  return f
    .not("panel", "in", OWNER_LOG_EXCLUDES.panels)
    .or(OWNER_LOG_EXCLUDES.level)
    .neq("action", OWNER_LOG_EXCLUDES.action) as unknown as Q;
}

/** The three methods this needs, and nothing else.
 *
 *  `Q` is deliberately UNCONSTRAINED, which is the one compromise in this file and is written down
 *  rather than hidden. Both structural constraints were tried first — `<Q extends { not(…): Q; … }>`
 *  and the same shape named separately — and each made TypeScript check PostgrestFilterBuilder's
 *  whole generic tree for assignability and answer *"TS2589: Type instantiation is excessively deep
 *  and possibly infinite"* on the head-count call, which is a hard compile error, not a warning.
 *
 *  What is lost: the compiler will not stop somebody passing this a thing that is not a query.
 *  What is kept, and is the actual point: all three exclusions are applied TOGETHER or not at all,
 *  so no surface can quietly implement two of the three. `verify:t28-picked` asserts that every
 *  `staff_actions` read on an owner surface comes through here, which is the check the type cannot
 *  be. */
type StaffActionFilter = {
  not(column: string, operator: string, value: string): StaffActionFilter;
  or(filters: string): StaffActionFilter;
  neq(column: string, value: string): StaffActionFilter;
};
