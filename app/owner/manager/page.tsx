// Owner panel → Manager mode (owner, 2026-08-02). The FULL live manager panel — floor
// tiles, Bills, Platform, Banquet, Inventory, Dashboard — embedded in the owner cockpit
// for the restaurant the owner picks, so an owner who runs their own floor can work it
// without a second login. Same engine as the manager panel (public/panels/editor with
// ?ownermode=1), so everything is live-synced across manager/kitchen/tablet for free.
// Four sections are deliberately NOT in it (Settings, ⭐ Ratings, 🗑 Audit, the Menu
// editor/viewer) because the owner panel already has its own versions of each.
//
// Resolution mirrors the owner Menu page exactly:
//   • a real OWNER → the restaurants they own (restaurant_owners join, live + panel on),
//     narrowed to those the admin still entitles to "manager_mode" (absent = ON)
//   • the ADMIN act-as → the one restaurant they entered from the console
// The embedded panel echoes ?rid on every API call; the editor route validates that rid
// against the owner's estate (app/api/editor → editorScope), so this never widens reach —
// and every write is logged as the OWNER, no shadow manager account anywhere.
import { cookies } from "next/headers";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import OwnerManagerMode from "@/components/owner/OwnerManagerMode";

export default async function Page({ searchParams }: { searchParams: Promise<{ rid?: string }> }) {
  const { rid: qRid } = await searchParams;
  const store = await cookies();
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  // Match the owner panel's skin (OwnerShell defaults to dark when no cookie is set).
  const skin: "light" | "dark" = store.get("aevidine_skin")?.value === "light" ? "light" : "dark";

  let restaurants: { id: string; name: string }[] = [];
  let selected = "";

  if (u && u.role === "owner") {
    // Hiding the nav row is never the only guard: a typed /owner/manager URL lands here,
    // so the admin's "Manager mode" section switch is enforced again (entitledSubset).
    const ids = await entitledSubset(await enabledOwnedRestaurantIds(u.id), "manager_mode");
    if (ids.length) {
      const rows = (await sb.from("restaurants").select("id, name").in("id", ids)).data || [];
      const nameById = new Map(rows.map((r) => [r.id as string, r.name as string]));
      restaurants = ids.map((id) => ({ id, name: nameById.get(id) || "Restaurant" }));
      // Honour ?rid only when the owner actually owns it; else default to their first.
      selected = qRid && ids.includes(qRid) ? qRid : ids[0];
    }
  } else if (store.get(ADMIN_ACT_COOKIE)?.value && (await tokenIsValid(store.get(AUTH_COOKIE)?.value))) {
    // Admin act-as: the one restaurant they entered from the console (the layout already
    // vetted this). The admin sees the section even when switched off — top power, X-ray.
    const rid = qRid || store.get(ADMIN_ACT_COOKIE)!.value;
    const row = (await sb.from("restaurants").select("id, name").eq("id", rid).maybeSingle()).data as
      { id: string; name: string } | null;
    if (row) { restaurants = [{ id: row.id, name: row.name }]; selected = row.id; }
  }

  if (!selected) {
    return (
      <div className="adm-page">
        <h1 className="adm-page-title">Manager mode</h1>
        <p className="adm-page-sub">No restaurant is available here right now.</p>
      </div>
    );
  }

  return <OwnerManagerMode restaurants={restaurants} initial={selected} skin={skin} />;
}
