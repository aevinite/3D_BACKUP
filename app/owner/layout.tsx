// Server-side gate for the OWNER panel. Runs in the Node runtime (env vars are
// reliably available here), validates the login cookie against ADMIN_PASSWORD,
// and bounces to /staff-login if it's missing — identical to the /aevinite gate.
//
// AUTH: reuses the existing ADMIN_PASSWORD cookie gate (tokenIsValid).
// TODO: replace with the dedicated owner role once RBAC lands. A parallel session
//       owns staff_users / lib/userAuth.ts / lib/panelGate.ts / middleware.ts —
//       this panel deliberately stays out of those files to avoid collisions.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import OwnerShell from "@/components/owner/OwnerShell";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const ok = await tokenIsValid(store.get(AUTH_COOKIE)?.value);
  if (!ok) redirect("/staff-login?next=/owner");
  return <OwnerShell>{children}</OwnerShell>;
}
