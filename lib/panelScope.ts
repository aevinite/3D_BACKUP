// Which restaurant a STAFF-PANEL API request (kitchen/tablet/manager) is acting on.
//
//  • A logged-in staff member  → their OWN restaurant (staff_users.restaurant_id).
//  • The ADMIN super-user       → the restaurant they're "viewing as" (?rid= per-tab
//    pin, else the act-as cookie set by /api/admin/act-as/go). NO silent fallback:
//    an admin request naming neither returns NULL and the handler answers 400 — the
//    old "else default restaurant #1" let a scopeless admin call quietly act on #1
//    (owner, 2026-07-06: panels are entered FROM the admin console, restaurant named).
//
// This is what lets an admin enter a restaurant first and then open its panels
// scoped to THAT restaurant. Replaces the old per-handler ridOf(g) so all three
// panels share one rule.
import type { NextRequest } from "next/server";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import type { StaffUser } from "@/lib/userAuth";

export const ADMIN_ACT_COOKIE = "aevidine_admin_rid";

export function panelRestaurantId(
  req: { cookies: { get(name: string): { value: string } | undefined }; nextUrl?: { searchParams?: URLSearchParams } },
  g: { user: StaffUser | null },
): string | null {
  if (g.user) return g.user.restaurant_id || DEFAULT_RESTAURANT_ID;
  // Admin super-user ONLY (a staff request always has g.user — requireRole 401s
  // everyone else before this runs): a per-TAB ?rid= wins over the browser-wide
  // act-as cookie. The cookie is shared by every tab, so opening restaurant B's
  // panel used to silently repoint restaurant A's already-open panel at B (owner,
  // 2026-07-03 — "the Aangan manager panel shifts to the other restaurant", and
  // opening a table from that panel landed on the WRONG restaurant's floor). The
  // admin page now opens each panel with ?rid=<id> and the panels echo it on every
  // API call, so each tab stays pinned to ITS restaurant.
  const urlRid = req.nextUrl?.searchParams?.get("rid");
  if (urlRid) return urlRid;
  return req.cookies.get(ADMIN_ACT_COOKIE)?.value || null;
}

// Convenience for handlers whose `req` is a NextRequest.
export type ScopeReq = NextRequest;

// A path segment that is really a MISSING client value. When a staff panel builds a URL
// like `/api/tablet/resolve-call/${id}` and `id` is undefined/null/NaN, the segment arrives
// as the literal string "undefined" (or "null"/"NaN"). Used as a UUID it makes Postgres throw
// `invalid input syntax for type uuid: "undefined"` — which the route catch logs as a scary
// route_error 500. None of these strings is ever a valid path arg here, so reject them up front
// with a clean 400 instead. (owner, 2026-07-26 — kill the "uuid: undefined" route_error class.)
export function emptyIdSegment(v: string | undefined): boolean {
  return v === "undefined" || v === "null" || v === "NaN";
}
