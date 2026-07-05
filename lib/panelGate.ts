// Server-side gate for a PANEL ROUTE (e.g. /editor, /kitchen, /tablet). Runs in
// the Node runtime via the panel's layout.tsx — same pattern as the admin gate,
// because edge middleware can't reliably read the password env. Allows:
//   • a logged-in user whose role matches this panel, or
//   • the ADMIN super-user — but ONLY after deliberately picking a restaurant from
//     /aevinite (act-as cookie set by /api/admin/act-as/go), the same rule the owner
//     panel already enforces. A bare /tablet etc. with just the admin cookie used to
//     slip in silently scoped to restaurant #1; now it bounces to the admin console.
// Anyone else is bounced to /login (carrying ?next so they return after login).
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie, type Role } from "@/lib/userAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { isPanelEnabled } from "@/lib/panelAccess";
import { getRestaurantBySlug } from "@/lib/tenant";

// Where each role lands after login. The canonical copy — LoginForm keeps a
// client-side duplicate (it can't import this server module).
export const ROLE_HOME: Record<Role, string> = { owner: "/owner", manager: "/manager", kitchen: "/kitchen", tablet: "/tablet" };

export async function requirePanel(role: Role, next: string): Promise<void> {
  const store = await cookies();
  // A logged-in user whose role matches this exact panel AND whose restaurant has
  // this panel ENABLED (mig 106) — a disabled panel bounces to login, so an
  // already-signed-in user is locked out the moment the admin turns their panel off.
  // Staff is checked FIRST (mirrors requireRole's order, QA sweep 2026-07-03): on a
  // device holding both cookies, the person who explicitly signed in wins.
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u && u.role === role && (await isPanelEnabled(role, u.restaurant_id))) return;
  // Admin super-access: may hop into any panel — even one turned OFF for the
  // restaurant (admin sets up / inspects everything) — but only via the admin
  // console's act-as flow, which names WHICH restaurant. No scope → back to /aevinite.
  if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) {
    if (store.get(ADMIN_ACT_COOKIE)?.value) return;
    redirect("/aevinite");
  }
  redirect(`/login?next=${encodeURIComponent(next)}`);
}

// Gate for a TENANT-SCOPED panel route (/r/<slug>/tablet|kitchen|manager).
//
// The slug is a LABEL + a CHECK — never the data source. Staff data stays scoped
// by the session cookie (lib/panelScope), so a typo'd or guessed slug can't leak
// anything: a staff session whose restaurant does NOT match the slug is bounced
// to THAT restaurant's login instead of silently showing their own restaurant
// under the wrong address. The admin super-user may open any slug; the returned
// restaurantId is then passed as ?rid= into the panel iframe (the existing
// admin view-as mechanism — ignored server-side for real staff sessions).
export async function requirePanelAt(
  role: Role, slug: string,
): Promise<{ restaurantId: string; admin: boolean }> {
  const r = await getRestaurantBySlug(slug);
  if (!r) notFound();
  const store = await cookies();
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u && u.role === role && u.restaurant_id === r.id && r.active && (await isPanelEnabled(role, r.id))) {
    return { restaurantId: r.id, admin: false };
  }
  // Admin super-access: any slug, even an inactive restaurant or a disabled panel
  // (admin sets up / inspects everything) — same bypass as the bare-route gate.
  if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) return { restaurantId: r.id, admin: true };
  redirect(`/r/${slug}/login?next=${encodeURIComponent(`/r/${slug}${ROLE_HOME[role]}`)}`);
}
