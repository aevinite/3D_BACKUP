// Which restaurant a STAFF-PANEL API request (kitchen/tablet/manager) is acting on.
//
//  • A logged-in staff member  → their OWN restaurant (staff_users.restaurant_id).
//  • The ADMIN super-user       → the restaurant they're "viewing as" (set by the
//    admin via /api/admin/act-as → ADMIN_ACT_COOKIE), else the default restaurant #1.
//
// This is what lets an admin enter a restaurant first and then open its panels
// scoped to THAT restaurant, instead of always defaulting to #1. Replaces the old
// per-handler ridOf(g) so all three panels share one rule.
import type { NextRequest } from "next/server";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import type { StaffUser } from "@/lib/userAuth";

export const ADMIN_ACT_COOKIE = "aevidine_admin_rid";

export function panelRestaurantId(
  req: { cookies: { get(name: string): { value: string } | undefined } },
  g: { user: StaffUser | null },
): string {
  if (g.user) return g.user.restaurant_id || DEFAULT_RESTAURANT_ID;
  // Admin super-user: honour the "viewing as" restaurant if one is set.
  const acting = req.cookies.get(ADMIN_ACT_COOKIE)?.value;
  return acting || DEFAULT_RESTAURANT_ID;
}

// Convenience for handlers whose `req` is a NextRequest.
export type ScopeReq = NextRequest;
