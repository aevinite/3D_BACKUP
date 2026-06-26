// Server-side gate for the OWNER panel. Runs in the Node runtime (env vars are
// reliably available here) and bounces unauthorised visitors to the staff login.
//
// AUTH: the ADMIN super-user (AUTH_COOKIE → sees every restaurant) OR a logged-in
// OWNER (USER_COOKIE, role=owner → sees only the restaurants they own). The owner
// role + its restaurant scoping landed with RBAC (mig 091/092 + lib/userAuth).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import OwnerShell from "@/components/owner/OwnerShell";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  // OWNER panel = the OWNER role ONLY. The admin has its OWN separate panel
  // (/aevinite) and must NEVER "become" the owner. This keeps admin and owner
  // fully separate — so logging out of one can never affect the other.
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (!u || u.role !== "owner") redirect("/login?next=/owner");
  return <OwnerShell>{children}</OwnerShell>;
}
