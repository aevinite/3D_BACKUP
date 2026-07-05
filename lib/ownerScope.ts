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

export type OwnerScope = { all: true } | { all: false; ids: string[]; ownerId: string };

export async function ownerScope(req: NextRequest): Promise<OwnerScope | null> {
  // A logged-in OWNER wins over a stray admin cookie in the same browser. This
  // matches app/owner/layout.tsx (which renders the OWNER shell when the owner
  // cookie is valid) — before, layout picked owner chrome while this scoped to
  // the admin's act-as restaurant: owner header, someone else's numbers
  // (surfaced 2026-07-04 verifying the redesign on a shared browser profile).
  const owner = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (owner && owner.role === "owner") {
    // Multi-owner: resolve EVERY restaurant this owner is a member of via the
    // restaurant_owners join table (migration 097) — widens to all restaurants
    // they co-own AND never leaks one they aren't a member of.
    const { data } = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", owner.id);
    return { all: false, ids: (data || []).map((r) => r.restaurant_id as string), ownerId: owner.id };
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
    if (scopeParam === "all") return { all: true };
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
      // if nobody owns it.
      const [primaryQ, membersQ] = await Promise.all([
        sb.from("restaurants").select("owner_user_id").eq("id", acting).maybeSingle(),
        sb.from("restaurant_owners").select("user_id").eq("restaurant_id", acting),
      ]);
      const members = (membersQ.data || []).map((m) => m.user_id as string);
      const primary = primaryQ.data?.owner_user_id as string | null | undefined;
      const ownerId = primary && members.includes(primary) ? primary : (members[0] ?? primary ?? null);
      if (ownerId) {
        const { data } = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId);
        const ids = (data || []).map((x) => x.restaurant_id as string);
        if (!ids.includes(acting)) ids.push(acting); // never lose the entered restaurant
        return { all: false, ids, ownerId };
      }
      return { all: false, ids: [acting], ownerId: "admin" };
    }
    return { all: true };
  }
  return null;
}

// Convenience: is a given restaurant id in scope? (admin → always true)
export function inScope(scope: OwnerScope, restaurantId: string): boolean {
  return scope.all || scope.ids.includes(restaurantId);
}
