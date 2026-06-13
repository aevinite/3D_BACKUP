// Server-side gate for the ADMIN panel. Runs in the Node runtime (env vars are
// reliably available here, unlike edge middleware), so it can validate the login
// cookie against STAFF_PASSWORD. Not signed in → bounce to /staff-login.
// (This replaced the edge middleware, which couldn't read the password env.)
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const ok = await tokenIsValid(store.get(AUTH_COOKIE)?.value);
  if (!ok) redirect("/staff-login?next=/admin");
  return <>{children}</>;
}
