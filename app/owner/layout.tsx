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
import { USER_COOKIE, userFromCookie, AuthDbError } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { getOwnerEntitlements, getOwnerEntitlementsUnion } from "@/lib/ownerEntitlements";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";
import { khataLadder, inventoryLadder } from "@/lib/tableTags";
import OwnerShell from "@/components/owner/OwnerShell";
import OwnerReconnecting from "@/components/owner/OwnerReconnecting";
import AutoFitNumbers from "@/components/AutoFitNumbers";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const acting = store.get(ADMIN_ACT_COOKIE)?.value;
  // Pass the persisted skin to the shell so SSR emits the right theme immediately (no
  // dark→light flash for light-mode owners). Written as a cookie by OwnerShell's toggle.
  const skinCookie = store.get("aevidine_skin")?.value;
  const initialSkin = skinCookie === "light" || skinCookie === "dark" ? skinCookie : undefined;

  // Resolve auth INSIDE try/catch so a transient DB blip (AuthDbError) shows a calm
  // "reconnecting" retry instead of crashing the whole panel or bouncing a logged-in
  // owner to /login (a blip ≠ logged out — same rule as lib/userAuth.ts gates). The
  // branching/redirect stays OUTSIDE: redirect() throws NEXT_REDIRECT internally, and
  // catching that here would silently break the redirect.
  let u: Awaited<ReturnType<typeof userFromCookie>> = null;
  let actingValid = false;
  let ownedIds: string[] = [];
  try {
    u = await userFromCookie(store.get(USER_COOKIE)?.value);
    if (acting) actingValid = await tokenIsValid(store.get(AUTH_COOKIE)?.value);
    // Resolve the owner's LIVE + owner-panel-enabled restaurants. (This helper swallows a
    // read error into an empty list rather than throwing, so a rare DB blip sends the owner
    // to /login below — no worse, and safer, than the old code which fell back to restaurant
    // #1's nav and mis-rendered a real owner as owning nothing; audit 2026-07-07.)
    if (u && u.role === "owner") ownedIds = await enabledOwnedRestaurantIds(u.id);
  } catch (e) {
    if (e instanceof AuthDbError) return <OwnerReconnecting />;
    throw e;
  }

  // 1) OWNER role → their own cockpit. Access requires at least one LIVE restaurant whose
  // owner panel the admin still allows: if the admin turned the owner panel off for every
  // restaurant they own (or binned them all), send them to login instead of a full cockpit
  // (matches the API-layer gate in lib/ownerScope — audit 2026-07-07). Sections the ADMIN
  // removed (mig 133) are HIDDEN here — union across the estate, so a section survives if
  // ANY of their restaurants still has it.
  if (u && u.role === "owner") {
    if (!ownedIds.length) redirect("/login?next=/owner");
    const ents = await getOwnerEntitlementsUnion(ownedIds);
    // Pay Later nav shows if the module is on for ANY owned restaurant (per-restaurant data
    // is filtered by the API). Injected as a synthetic section key the nav gate reads.
    ents.khata_book = (await Promise.all(ownedIds.map((id) => khataLadder(id)))).some((l) => l.effective);
    // Inventory & expenses (mig 221): same synthetic-key pattern — the nav shows the section
    // if ANY owned restaurant has the module effective (per-restaurant data filtered by the API).
    ents.inventory = (await Promise.all(ownedIds.map((id) => inventoryLadder(id)))).some((l) => l.effective);
    // DUAL-COOKIE case (owner, 2026-07-28): a real owner login AND a live admin act-as in
    // the same browser. This layout can't read searchParams, so it can't tell an
    // admin-opened tab (?rid= pin) from the owner's own — pass BOTH payloads and let
    // OwnerShell pick per tab. Costs one extra entitlement read, only on such sessions
    // (in practice just the admin's own machine while testing).
    let dualAdmin: { adminEntitlements: Record<string, boolean>; restaurantName: string } | undefined;
    if (acting && actingValid) {
      const r = (await sb.from("restaurants").select("name").eq("id", acting).limit(1)).data?.[0];
      const adminEnts = await getOwnerEntitlements(acting);
      adminEnts.khata_book = (await khataLadder(acting)).effective;
      adminEnts.inventory = (await inventoryLadder(acting)).effective;
      dualAdmin = { adminEntitlements: adminEnts, restaurantName: r?.name || "this restaurant" };
    }
    return <OwnerShell initialSkin={initialSkin} entitlements={ents} dualAdmin={dualAdmin}><AutoFitNumbers />{children}</OwnerShell>;
  }

  // 2) ADMIN viewing a specific restaurant (act-as) → top-power, invisible view.
  // The admin sees removed sections TINTED (hierarchy X-ray), never hidden.
  if (acting && actingValid) {
    const r = (await sb.from("restaurants").select("name").eq("id", acting).limit(1)).data?.[0];
    const adminEnts = await getOwnerEntitlements(acting);
    // Admin act-as: show Pay Later greyed (X-ray) when the module is off for this restaurant,
    // never hidden — same rule as the other sections the admin sees tinted.
    adminEnts.khata_book = (await khataLadder(acting)).effective;
    adminEnts.inventory = (await inventoryLadder(acting)).effective;
    return (
      <OwnerShell adminViewing restaurantName={r?.name || "this restaurant"} initialSkin={initialSkin} entitlements={adminEnts}>
        <AutoFitNumbers />
        {children}
      </OwnerShell>
    );
  }

  redirect("/login?next=/owner");
}
