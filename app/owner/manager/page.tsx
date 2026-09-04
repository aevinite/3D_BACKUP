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
import { redirect } from "next/navigation";
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

  let restaurants: { id: string; name: string; accentColor?: string }[] = [];
  let selected = "";

  if (u && u.role === "owner") {
    // Hiding the nav row is never the only guard: a typed /owner/manager URL lands here,
    // so the admin's "Manager mode" section switch is enforced again (entitledSubset).
    const ids = await entitledSubset(await enabledOwnedRestaurantIds(u.id), "manager_mode");
    if (ids.length) {
      const rows = (await sb.from("restaurants").select("id, name, accent_color").in("id", ids)).data || [];
      const byId = new Map(rows.map((r) => [r.id as string, r]));
      restaurants = ids.map((id) => ({ id, name: (byId.get(id)?.name as string) || "Restaurant", accentColor: (byId.get(id)?.accent_color as string) || undefined }));
      // Honour ?rid only when the owner actually owns it. ONE restaurant → straight in;
      // several → selected stays "" so the client shows the pick-a-restaurant launcher
      // (owner, 2026-08-02: "first screen to select the restaurant").
      selected = qRid && ids.includes(qRid) ? qRid : ids.length === 1 ? ids[0] : "";
    }
  } else if (store.get(ADMIN_ACT_COOKIE)?.value && (await tokenIsValid(store.get(AUTH_COOKIE)?.value))) {
    // Admin act-as: opens ON the restaurant they entered from the console (the layout
    // already vetted this), but the list MIRRORS the real owner's estate — if this
    // restaurant's owner owns others too, the same launcher / "Switch restaurant" bar the
    // real owner gets appears here (owner, 2026-08-02: testing as a two-restaurant owner
    // through the console showed no way to switch — the admin view must not hide what the
    // owner would see). The admin may reach any restaurant anyway, so this widens nothing.
    const rid = qRid || store.get(ADMIN_ACT_COOKIE)!.value;
    const ownerIds = ((await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid)).data || [])
      .map((r) => r.user_id as string);
    const estateIds = new Set<string>([rid]);
    if (ownerIds.length) {
      // Paged, not `.limit(50)` (T19 sweep, 2026-08-14): past the 50th link the siblings were
      // dropped with no notice, so the "Switch restaurant" bar would quietly stop offering some
      // of the owner's floors. Same rule as lib/panelAccess.ts → ownedLinkIds() and
      // lib/ownerScope.ts → scopedRestaurantIds(): a list is complete or it says so.
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const q = await sb.from("restaurant_owners").select("restaurant_id").in("user_id", ownerIds)
          .order("restaurant_id").range(offset, offset + PAGE - 1);
        const batch = q.data || [];
        for (const l of batch) estateIds.add(l.restaurant_id as string);
        if (q.error || batch.length < PAGE) break;
      }
    }
    const rows = (await sb.from("restaurants").select("id, name, accent_color").in("id", [...estateIds]).is("deleted_at", null)).data || [];
    restaurants = rows.map((r) => ({ id: r.id as string, name: r.name as string, accentColor: (r.accent_color as string) || undefined }));
    // The console named THIS restaurant, so land on its floor (never on the launcher);
    // switching to a sibling is then one tap, same as for the real owner.
    if (restaurants.some((r) => r.id === rid)) selected = rid;
    else if (restaurants.length) selected = restaurants[0].id;
  }

  // ── A SECTION YOU DO NOT HAVE SIMPLY IS NOT THERE (owner, 2026-08-31) ─────────────────────────
  // *"if the inventory is not switch on, then it will not show — it will not even show that
  //  option… it will not only show 'unable to access', that there is a feature which contains
  //  inventory."*
  // This is R36 again, arriving from the page side: *"owner can't know which option are not given
  // to them, only admin should know that."* The sidebar already hides a withheld section from a
  // real owner (`OwnerShell` → `if (!on && (!adminViewing || simulated)) return null`). The PAGE
  // did not: reached by a typed URL or an old bookmark it printed "No restaurant is available here right
  // now" — which
  // names a feature he has not been given and invites him to go and ask for it.
  // That screen is DELETED, not restyled (the standing "a new way replaces the old one" rule), and
  // he is sent back to his dashboard instead. The ADMIN is unaffected: only a real owner can reach
  // this line, because the admin act-as branch above is never module-gated — admin = top power, and
  // its X-ray nav says outright "You can still open it from this view".
  // The heading that used to sit here was ONE user of `adm-page-title`, a class no stylesheet
  // declares (sweep 6 · T14). It is gone with the screen — but it was not the LAST one, and this
  // comment said it was: the launcher in components/owner/OwnerManagerMode.tsx still carried it,
  // and `verify:owner-money` item 7 only ever walked `app/`, so the guard stayed green over it.
  // Both are fixed (T17 sweep, 2026-09-04); the walk now covers `app/` AND `components/`.
  if (!restaurants.length) redirect("/owner");

  return <OwnerManagerMode restaurants={restaurants} initial={selected} skin={skin} />;
}
