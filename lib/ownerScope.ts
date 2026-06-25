// Shared owner-panel auth/scope resolver for /api/owner/*.
//
// The owner cockpit is reachable by TWO kinds of caller:
//   • the ADMIN super-user (AUTH_COOKIE) — sees EVERY restaurant ({ all:true }), and
//   • a logged-in OWNER (role=owner) — sees ONLY the restaurants they own
//     (restaurants.owner_user_id = them), as a concrete id list.
// Anyone else (manager/kitchen/tablet/none) → null, which the routes turn into 401/403.
//
// Built on the RBAC primitives in lib/userAuth (cookie → user) + the owner_user_id
// link added in migration 092. Keeping it here means overview + analytics scope
// identically and an owner can never see another owner's numbers.
import type { NextRequest } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";

export type OwnerScope = { all: true } | { all: false; ids: string[]; ownerId: string };

export async function ownerScope(req: NextRequest): Promise<OwnerScope | null> {
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) return { all: true };
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u && u.role === "owner") {
    const { data } = await sb.from("restaurants").select("id").eq("owner_user_id", u.id);
    return { all: false, ids: (data || []).map((r) => r.id as string), ownerId: u.id };
  }
  return null;
}

// Convenience: is a given restaurant id in scope? (admin → always true)
export function inScope(scope: OwnerScope, restaurantId: string): boolean {
  return scope.all || scope.ids.includes(restaurantId);
}
