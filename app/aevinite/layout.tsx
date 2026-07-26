// Server-side gate for the ADMIN panel. Runs in the Node runtime (env vars are
// reliably available here, unlike edge middleware), so it can validate the login
// cookie against STAFF_PASSWORD. Not signed in → bounce to /staff-login.
// (This replaced the edge middleware, which couldn't read the password env.)
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import AdminShell from "@/components/admin/AdminShell";
import { AdminToastProvider } from "@/components/admin/toast";
import AutoFitNumbers from "@/components/AutoFitNumbers";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const ok = await tokenIsValid(store.get(AUTH_COOKIE)?.value);
  if (!ok) redirect("/staff-login?next=/aevinite");
  // Read the saved skin from the cookie so SSR emits the RIGHT data-skin and there's no
  // dark→light flash on load for admins who chose light mode (mirrors the owner layout).
  const skinCookie = store.get("aevidine_skin")?.value;
  const initialSkin = skinCookie === "light" || skinCookie === "dark" ? skinCookie : undefined;
  return <AdminShell initialSkin={initialSkin}><AdminToastProvider><AutoFitNumbers />{children}</AdminToastProvider></AdminShell>;
}
