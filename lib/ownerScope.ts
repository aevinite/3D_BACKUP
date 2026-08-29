// Shared owner-panel auth/scope resolver for /api/owner/*.
//
// The owner cockpit is reachable by TWO kinds of caller:
//   • the ADMIN super-user (AUTH_COOKIE) — sees EVERY restaurant ({ all:true }), and
//   • a logged-in OWNER (role=owner) — sees ONLY the restaurants they own
//     (membership in restaurant_owners, migration 097), as a concrete id list.
// Anyone else (manager/kitchen/tablet/none) → null, which the routes turn into 401/403.
//
// Built on the RBAC primitives in lib/userAuth (cookie → user) + the owner_user_id
// link added in migration 092. Keeping it here means overview + analytics scope
// identically and an owner can never see another owner's numbers.
import type { NextRequest } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";

// `admin: true` marks the ADMIN's session (all-view OR act-as pin) — set on every
// admin branch below. Gates that restrict a REAL owner (e.g. the mig 132 owner
// entitlements) must check THIS flag, never `ownerId === "admin"`: the act-as path
// deliberately borrows the real owner's id whenever the restaurant has one, so that
// sentinel almost never fires (work-checker, 2026-07-06 — the admin was getting
// wrongly locked out of the very sections it had switched off).
// `ownerName` is the signed-in owner's LOGIN NAME, carried for one purpose only: writing a
// readable person into the `actor` columns the panels display (see ownerActorName below). It is
// absent on the admin branches, which record "admin" anyway, and it is never used for a permission
// decision — `ownerId` remains the identity.
export type OwnerScope = { all: true; admin?: true } | { all: false; ids: string[]; ownerId: string; ownerName?: string; admin?: true };

/**
 * "We could not work out what you are allowed to see."
 *
 * Deliberately NOT the same as `null` (which means "you are nobody here" → 401). A scope we failed
 * to READ is a transient problem, and answering 401 for it would log a legitimate owner out of their
 * own cockpit; answering with a PARTIAL scope would quietly hide restaurants they own. So it throws,
 * and `ownerScopeOr503()` turns it into a retryable answer. (T9 finding F22, 2026-08-12.)
 */
export class OwnerScopeUnavailable extends Error {
  constructor() {
    super("Couldn't work out which restaurants you can see");
    this.name = "OwnerScopeUnavailable";
  }
}

/**
 * The shape every `/api/owner/*` route should use: resolve the scope, and get back either a scope,
 * or the Response to return. Saves each route hand-writing the same three-way branch, and makes the
 * "couldn't read it" case impossible to forget.
 */
export async function ownerScopeOr503(
  req: NextRequest,
): Promise<{ scope: OwnerScope; resp?: undefined } | { scope?: undefined; resp: Response }> {
  let s: OwnerScope | null;
  try { s = await ownerScope(req); }
  catch (e) {
    if (e instanceof OwnerScopeUnavailable) {
      return { resp: Response.json(
        { error: "Couldn't load your restaurants just now — please try again.", transient: true },
        { status: 503 },
      ) };
    }
    throw e;
  }
  if (!s) return { resp: Response.json({ error: "unauthorized" }, { status: 401 }) };
  return { scope: s };
}

export async function ownerScope(req: NextRequest): Promise<OwnerScope | null> {
  // PER-TAB ADMIN PIN (owner, 2026-07-28): ?scope=/?rid=/?as= are appended only by the
  // admin console's act-as flow and echoed by that tab on every call. Such a pin WITH a
  // valid admin cookie marks the request as an ADMIN-VIEW tab — it stays the admin's
  // view even when a real owner is signed in elsewhere in the same browser (tabs share
  // one cookie jar; the owner-first order below used to let an owner login in another
  // tab take over an admin-opened cockpit). Without the admin cookie the params are
  // ignored, so nothing changes for real owners.
  const pinSp = req.nextUrl?.searchParams;
  const adminPinned =
    !!(pinSp?.get("scope") || pinSp?.get("rid") || pinSp?.get("as")) &&
    (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value));
  // A logged-in OWNER wins over a stray admin cookie in the same browser (unless the
  // per-tab admin pin above claimed this request). This matches app/owner/layout.tsx
  // (which renders the OWNER shell when the owner cookie is valid) — before, layout
  // picked owner chrome while this scoped to the admin's act-as restaurant: owner
  // header, someone else's numbers (surfaced 2026-07-04 on a shared browser profile).
  const owner = adminPinned ? null : await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (owner && owner.role === "owner") {
    // Multi-owner: resolve every restaurant this owner is a member of (restaurant_owners,
    // mig 097) — but ONLY the ones that are LIVE and still have the owner panel switched on.
    // enabledOwnedRestaurantIds drops a binned or admin-disabled restaurant, so revoking the
    // owner panel (or binning the restaurant) cuts off an already-open owner tab within the
    // 30s cache TTL instead of the 7-day cookie life (audit 2026-07-07). Empty set → no access.
    const ids = await enabledOwnedRestaurantIds(owner.id);
    if (!ids.length) return null;
    // The login name rides along free — `userFromCookie` already read the whole row. See
    // ownerActorName below for why it is needed.
    return { all: false, ids, ownerId: owner.id, ownerName: owner.username || undefined };
  }
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) {
    // Admin who has DELIBERATELY entered one restaurant is scoped to JUST that
    // restaurant — so the owner cockpit shows exactly what THAT owner sees. This
    // reuses the same {all:false} path a real owner takes (one id), so no owner
    // route changes. Admin with NO act-as keeps the full all-restaurants view.
    // A per-TAB scope pin wins over the browser-wide act-as cookie (the cookie is
    // shared across tabs, so a second "view as" used to repoint the first tab's
    // data — owner bug 2026-07-03, and worse it let a WRITE land on the wrong
    // restaurant — bug C1, 2026-07-05). The owner cockpit/reports pages now send
    // an explicit ?scope= on every call: `all` = the whole-platform view (so the
    // /aevinite command center can't be silently collapsed to one restaurant for
    // 6h by a drill-in — bug H2), or a restaurant id = pin to THAT owner's set.
    // `scope` is deliberately separate from the analytics `rid` drill-in param.
    const sp = req.nextUrl?.searchParams;
    const scopeParam = sp?.get("scope");
    if (scopeParam === "all") return { all: true, admin: true };
    // Legacy: an admin single-restaurant link may still carry ?rid=; honor it as a pin.
    const acting = scopeParam || sp?.get("rid") || req.cookies.get(ADMIN_ACT_COOKIE)?.value;
    if (acting) {
      // Show what the OWNER of the entered restaurant sees: ALL restaurants that owner
      // owns (an owner may run several), not just the one we entered — so the admin's
      // owner-cockpit view matches the real owner's. Resolve the owner via the
      // restaurant_owners JOIN TABLE (the scoping source of truth, mig 097) — prefer
      // the primary owner_user_id when it's a member, else any co-owner — and widen
      // through the same join table (2026-07-06; was keyed off owner_user_id alone,
      // which missed hand-attached co-ownerships). Fall back to the single restaurant
      // if nobody owns it. Carries `admin: true` — this is still the ADMIN's session
      // borrowing the owner's id, so entitlement gates must never fire on it.
      const [primaryQ, membersQ] = await Promise.all([
        sb.from("restaurants").select("owner_user_id").eq("id", acting).maybeSingle(),
        sb.from("restaurant_owners").select("user_id").eq("restaurant_id", acting),
      ]);
      const members = (membersQ.data || []).map((m) => m.user_id as string);
      const primary = primaryQ.data?.owner_user_id as string | null | undefined;
      // ?as=<ownerId> — the admin explicitly PICKED which owner's cockpit to open (the
      // dashboard "which owner?" chooser, owner 2026-07-25). Honor it ONLY when that owner
      // actually co-owns this restaurant; otherwise fall back to primary/first (a stale or
      // crafted id can never widen the view to someone else's restaurants). Per-tab param,
      // never a cookie, so a second admin tab can't repaint this one (same rule as ?scope=).
      const asOwner = sp?.get("as");
      const ownerId = (asOwner && members.includes(asOwner))
        ? asOwner
        : (primary && members.includes(primary) ? primary : (members[0] ?? primary ?? null));
      if (ownerId) {
        // A BLIP MUST NOT SILENTLY SHRINK THE VIEW (T9 finding F22, fixed 2026-08-12). This read's
        // `.error` was ignored, so a failed widen left `ids` as just the entered restaurant — an
        // admin who opened a five-restaurant owner's cockpit saw ONE, with nothing to say the other
        // four had been dropped rather than never existed. It never widens wrongly, which is the
        // direction that matters for isolation; but narrowing in silence is still a wrong answer.
        const owned = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId);
        if (owned.error) {
          console.error("[ownerScope] could not widen the act-as set:", owned.error.message);
          throw new OwnerScopeUnavailable();
        }
        const ids = (owned.data || []).map((x) => x.restaurant_id as string);
        if (!ids.includes(acting)) ids.push(acting); // never lose the entered restaurant
        return { all: false, ids, ownerId, admin: true };
      }
      return { all: false, ids: [acting], ownerId: "admin", admin: true };
    }
    return { all: true, admin: true };
  }
  return null;
}

// Convenience: is a given restaurant id in scope? (admin → always true)
export function inScope(scope: OwnerScope, restaurantId: string): boolean {
  return scope.all || scope.ids.includes(restaurantId);
}

/**
 * WHICH LOG A `/api/owner/*` ACTION BELONGS IN.
 *
 * ── The leak this closes (owner, 2026-08-12) ────────────────────────────────────────────────────
 * The owner asked about the feature-switch log line: *"if you mean feature log is shown to owner
 * then off it, because it's also admin change — owner should not be able to see."* Checking it found
 * the general version of that worry, and he was right.
 *
 * Aevidine's OWN screens already log as `panel:"admin"`, and the owner's Activity feed excludes
 * `panel in (admin,db)` — so a switch flipped from the admin console was already invisible. But the
 * admin can also act THROUGH the owner cockpit (the act-as pin), and those routes logged
 * `logAction("owner", …, { actor: "admin" })`. That row is `panel:"owner"`, so it sails past the
 * filter and appears in the owner's log with the word "admin" in it.
 *
 * (The oplog route blanks `actor_id` when it equals ADMIN_VIEW_ACTOR_ID, which covers the *panel*
 * view marker — but not the plain `actor: "admin"` string these owner routes write, so the
 * standing "admin = top power, INVISIBLY" rule was leaking through a different hole.)
 *
 * So: an action performed by the admin is recorded against the ADMIN panel, wherever it was
 * performed from. Nothing is hidden from the record — it lands in Aevidine's Everything Log in full,
 * which is where an admin action belongs — it simply stops appearing in the owner's feed.
 */
export function ownerLogPanel(scope: OwnerScope): "owner" | "admin" {
  return (scope.all || scope.admin) ? "admin" : "owner";
}

/**
 * WHO TO RECORD AS THE PERSON — one definition, for every owner-panel write.
 *
 * These routes each built this by hand as
 *     (scope.all || scope.admin) ? "admin" : (scope.ownerId || "owner")
 * and `scope.ownerId` is a UUID. Five call sites did it — ratings, customers, and three in issues —
 * and the value goes into columns the panels PRINT: `staff_actions.actor`, `deletion_audit.actor`,
 * `feedback.acknowledged_by` and `issues.raised_by`. So a real owner acknowledging a rating or
 * erasing a guest appeared on his own screens as, verbatim:
 *
 *     Handled a rating   c0af7b5b-c0d8-40f6-b831-f475e48bab53   2m ago
 *
 * measured on French House (T12 sweep, 2026-08-27). Every other row in those columns holds a login
 * name — "diagm1", "diagt1" — because every other writer records one, so this was the odd one out
 * rather than the convention.
 *
 * The login name is what goes in, matching the rest of the record. The admin still records as
 * "admin" (the standing "admin = top power, invisibly" rule), and the uuid remains the fallback for
 * the case that cannot happen in practice — an owner scope with no name on it — so nothing is ever
 * recorded as nobody.
 *
 * This does NOT change any authorisation: `ownerId` is still the identity everywhere it matters.
 */
export function ownerActorName(scope: OwnerScope): string {
  if (scope.all || scope.admin) return "admin";
  return scope.ownerName || scope.ownerId || "owner";
}

// The CONCRETE restaurant-id list for a scope. A real owner already has one; the admin's
// all-restaurants view needs every id, and that read must be PAGED.
//
// Three routes (khata / customers / ratings) each had their own copy doing a bare
// `select("id")` with no limit and no paging. PostgREST caps the rows it returns, so past
// that cap the admin's all-restaurants Pay Later / Customers / Ratings views silently
// dropped restaurants — the identical bug the reports route's allRestaurantIds() was written
// to page around ("a flat .limit(100) silently dropped every restaurant past the 100th").
// ONE helper now, so a fourth copy can't drift (found by the 2026-08-04 owner-panel sweep).
//
// A PARTIAL LIST IS NOT A LIST (T9 sweep, 2026-08-05). This used to `break` on a read error and
// return whatever it had, on the theory that "a partial list beats no list". For a NAME lookup that
// would be true; but this list is what the admin's Pay Later / Customers / Ratings views SUM over,
// so a transient error mid-paging silently produced money totals that excluded some restaurants,
// with nothing on screen saying the answer was incomplete. That is the same class as presenting
// saved figures as live. The sibling helper for the same job (allRestaurantIds in the reports route)
// already threw; now both fail the same way and the caller can say "try again".
export class RestaurantListIncomplete extends Error {
  constructor(cause?: string) {
    super(`Couldn't read the full restaurant list${cause ? `: ${cause}` : ""}`);
    this.name = "RestaurantListIncomplete";
  }
}

export async function scopedRestaurantIds(scope: OwnerScope): Promise<string[]> {
  if (!scope.all) return scope.ids;
  const ids: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const r = await sb.from("restaurants").select("id").order("id").range(offset, offset + PAGE - 1);
    if (r.error) throw new RestaurantListIncomplete(r.error.message);
    const batch = (r.data ?? []).map((x) => x.id as string);
    ids.push(...batch);
    if (batch.length < PAGE) break;
  }
  return ids;
}

/** One shared 503 for "we couldn't read the whole list" — retryable, never a wrong total. */
export function incompleteListResponse(): Response {
  return Response.json(
    { error: "Couldn't load every restaurant just now — please try again.", transient: true },
    { status: 503 },
  );
}

// ── NEVER HAND THE DATABASE'S OWN WORDS TO AN OWNER (T9 sweep, 2026-08-06) ────────────────────────
//
// Nine owner endpoints each wrote their own `{ error: error.message }` 500 — the raw
// PostgREST/Postgres sentence. `/api/maintenance` was fixed for exactly this on 2026-08-05: *"a
// malformed ?rid= put 'invalid input syntax for type uuid' on a manager's screen — meaningless to
// them, and internal to us."* Nothing here is dangerous; it just sends an owner to support holding a
// sentence about our schema instead of a "please try again".
//
// `/api/owner/reports` already modelled the right shape by translating a statement timeout (57014)
// into advice, so that case is folded in here rather than left as a tenth local copy.
//
// Retryable by default (503 + `transient`), because that is what a read failure almost always is and
// it tells the client it may try again. Pass `status: 500` for a genuinely non-retryable one.
export function dbFail(
  where: string,
  err: unknown,
  opts?: { message?: string; status?: number },
): Response {
  const raw = err instanceof Error ? err.message
    : (err && typeof err === "object" && "message" in err) ? String((err as { message: unknown }).message)
    : String(err);
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
  // The detail stays OUR side — this is the only place it is allowed to appear.
  console.error(`[${where}] read failed${code ? ` (${code})` : ""}:`, raw);
  // A statement timeout is the one database condition an owner CAN act on, so it keeps its advice.
  const timedOut = code === "57014" || /statement timeout/i.test(raw);
  const message = timedOut
    ? "That took too long to build. Try a shorter period, or one restaurant at a time."
    : (opts?.message ?? "Couldn't load that just now — please try again.");
  return Response.json(
    { error: message, transient: !timedOut },
    { status: opts?.status ?? (timedOut ? 504 : 503) },
  );
}

// ── "this ONE figure couldn't be read" ────────────────────────────────────────────────────────────
// The words moved to lib/partialRead.ts on 2026-08-06 and MUST stay there: they are read by
// "use client" screens, and anything they import lands in the browser bundle. This module imports
// lib/supabaseAdmin (service-role, server-only), so importing it from a client component broke the
// owner's Pay Later page with "supabaseKey is required." Re-exported here so server routes can keep
// getting everything from one place.
export { type PartialKey, partialLabel, partialNote } from "@/lib/partialRead";
