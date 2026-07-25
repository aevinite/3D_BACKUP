// Owner panel → Menu (2026-07-25). Was a "Coming soon" placeholder; now the real menu
// editor, embedded from the manager panel's editor (menu-only) and scoped to the
// restaurant the owner picks. Resolution mirrors the owner layout gate:
//   • a real OWNER → the restaurants they own (restaurant_owners join, live + panel on)
//   • the ADMIN act-as → the one restaurant they entered from the console
// The embedded panel echoes ?rid on every API call; the editor route validates that rid
// against the owner's estate (app/api/editor → editorScope), so this never widens reach.
import { cookies } from "next/headers";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import OwnerMenuEditor from "@/components/owner/OwnerMenuEditor";

export default async function Page({ searchParams }: { searchParams: Promise<{ rid?: string }> }) {
  const { rid: qRid } = await searchParams;
  const store = await cookies();
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  // Match the owner panel's skin (OwnerShell defaults to dark when no cookie is set).
  const skin: "light" | "dark" = store.get("aevidine_skin")?.value === "light" ? "light" : "dark";

  let restaurants: { id: string; name: string }[] = [];
  let selected = "";

  if (u && u.role === "owner") {
    const ids = await enabledOwnedRestaurantIds(u.id);
    if (ids.length) {
      const rows = (await sb.from("restaurants").select("id, name").in("id", ids)).data || [];
      const nameById = new Map(rows.map((r) => [r.id as string, r.name as string]));
      restaurants = ids.map((id) => ({ id, name: nameById.get(id) || "Restaurant" }));
      // Honour ?rid only when the owner actually owns it; else default to their first.
      selected = qRid && ids.includes(qRid) ? qRid : ids[0];
    }
  } else if (store.get(ADMIN_ACT_COOKIE)?.value && (await tokenIsValid(store.get(AUTH_COOKIE)?.value))) {
    // Admin act-as: the one restaurant they entered from the console (the layout already vetted this).
    const rid = qRid || store.get(ADMIN_ACT_COOKIE)!.value;
    const row = (await sb.from("restaurants").select("id, name").eq("id", rid).maybeSingle()).data as
      { id: string; name: string } | null;
    if (row) { restaurants = [{ id: row.id, name: row.name }]; selected = row.id; }
  }

  if (!selected) {
    return (
      <div className="adm-page">
        <h1 className="adm-page-title">Menu</h1>
        <p className="adm-page-sub">No restaurant is available to edit right now.</p>
      </div>
    );
  }

  return <OwnerMenuEditor restaurants={restaurants} initial={selected} skin={skin} />;
}
