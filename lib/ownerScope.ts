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
export type OwnerScope = { all: true; admin?: true } | { all: false; ids: string[]; ownerId: string; admin?: true };

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
    return { all: false, ids, ownerId: owner.id };
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
        const { data } = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId);
        const ids = (data || []).map((x) => x.restaurant_id as string);
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

// ── "THIS ONE FIGURE COULDN'T BE READ" (T9 improvement 2, 2026-08-06) ─────────────────────────────
//
// Several owner screens are built from SEVERAL reads at once: Pay Later is outstanding + collected
// today + collected this month; the day sheet is sales + settlement + tips + wages + stock; the hub
// is the restaurant list + two module probes. Until now a failed piece had only two endings, and both
// were dishonest in their own way:
//
//   · a silent ZERO — "collected today ₹0" when nobody read it. That is a claim, and it is the shape
//     that starts an argument with the till. (T9 findings F3, F4, F5.)
//   · the WHOLE page as a retryable 503 — which throws away the figures that were perfectly fine.
//     That is what F3's first fix did, and it is heavy-handed: the outstanding total was correct.
//
// So a payload may now carry `partial: ["collectedToday", …]` — the plain names of the parts that did
// not load. The screen keeps everything that DID load and greys just those, with a line saying so and
// a Refresh. `partialLabel()` turns the key into words for the person reading it.
//
// The rule for using it: a key belongs in `partial` when the value is ABSENT (null/undefined), never
// when it is a real zero. If a caller cannot tell the two apart, it must not use this — it should
// fail the request instead.
export type PartialKey =
  | "collectedToday" | "collectedMonth"     // Pay Later
  | "payments" | "tips" | "staffPay" | "inventory"   // the day sheet's optional lines
  | "modules";                               // the hub's payroll/inventory card probes
// NOTE: the staff roster deliberately does NOT use this. A list is better served by a per-ROW marker
// (`payUnread` on each person, shipped 2026-08-06) than by one note at the top of the page, because
// the owner needs to know WHICH people's figures are missing, not just that some are.

const PARTIAL_LABELS: Record<PartialKey, string> = {
  collectedToday: "money collected today",
  collectedMonth: "money collected this month",
  payments: "how the money arrived",
  tips: "tips",
  staffPay: "staff pay",
  inventory: "stock figures",
  modules: "which features are on",
};

/** Plain words for one unread part, for a screen to put in front of a person. */
export function partialLabel(k: string): string {
  return PARTIAL_LABELS[k as PartialKey] ?? k;
}

/** The one sentence every screen uses, so they cannot word it eight different ways. */
export function partialNote(keys: string[]): string {
  if (!keys.length) return "";
  const words = keys.map(partialLabel);
  const list = words.length === 1 ? words[0]
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `Couldn't read ${list} just now — everything else on this page is up to date.`;
}
