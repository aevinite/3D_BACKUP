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
import { redirect } from "next/navigation";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie, type Role } from "@/lib/userAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { isPanelEnabled } from "@/lib/panelAccess";

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
