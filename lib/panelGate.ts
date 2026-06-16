// Server-side gate for a PANEL ROUTE (e.g. /editor, /kitchen, /tablet). Runs in
// the Node runtime via the panel's layout.tsx — same pattern as the admin gate,
// because edge middleware can't reliably read the password env. Allows:
//   • the ADMIN super-user (valid staff-gate cookie) — may hop into any panel, or
//   • a logged-in user whose role matches this panel.
// Anyone else is bounced to /login (carrying ?next so they return after login).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie, type Role } from "@/lib/userAuth";

export async function requirePanel(role: Role, next: string): Promise<void> {
  const store = await cookies();
  // Admin super-access: the staff gate cookie lets the owner into every panel.
  if (await tokenIsValid(store.get(AUTH_COOKIE)?.value)) return;
  // Otherwise it must be a logged-in user whose role matches this exact panel.
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u && u.role === role) return;
  redirect(`/login?next=${encodeURIComponent(next)}`);
}
