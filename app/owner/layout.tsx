// Server-side gate for the OWNER panel. Runs in the Node runtime (env vars are
// reliably available here) and bounces unauthorised visitors to the staff login.
//
// AUTH (two callers, kept strictly separate):
//   1. A logged-in OWNER (USER_COOKIE, role=owner) → their own cockpit, sees only
//      the restaurants they own (scoped by ownerScope).
//   2. The ADMIN super-user (AUTH_COOKIE) → may VIEW any restaurant's owner cockpit,
//      but ONLY after deliberately entering it (act-as cookie set). A bare admin
//      login is still bounced, so admin can never silently "become" an owner — the
//      cross-contamination fix stays intact. This view is invisible to the real
//      owner (it's the admin's own separate session).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import OwnerShell from "@/components/owner/OwnerShell";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();

  // 1) OWNER role → their own cockpit.
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  if (u && u.role === "owner") return <OwnerShell>{children}</OwnerShell>;

  // 2) ADMIN viewing a specific restaurant (act-as) → top-power, invisible view.
  const acting = store.get(ADMIN_ACT_COOKIE)?.value;
  if (acting && (await tokenIsValid(store.get(AUTH_COOKIE)?.value))) {
    const r = (await sb.from("restaurants").select("name").eq("id", acting).limit(1)).data?.[0];
    return (
      <OwnerShell adminViewing restaurantName={r?.name || "this restaurant"}>
        {children}
      </OwnerShell>
    );
  }

  redirect("/login?next=/owner");
}
