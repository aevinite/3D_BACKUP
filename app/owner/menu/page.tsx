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
import { mergeOwnerEntitlements } from "@/lib/ownerEntitlements";
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
  // "I COULDN'T ASK" IS NOT "IT IS SWITCHED OFF" (T13 sweep, 2026-08-17).
  //
  // Both reads below used to swallow their error (`entitledSubset` ends in `.data || []`, and the
  // admin branch used `.data` with no error check). An empty answer is the SAME shape whether the
  // admin genuinely switched Menu off or the query simply failed — and this page then told the
  // owner, in words, that their menu editor "isn't switched on … ask your administrator". That is
  // a lie about their configuration on a database blip: it sends them to support about a setting
  // that is perfectly fine, and support finds nothing wrong. The rest of the product refuses to do
  // this — /api/owner/staff answers 503 "please try again" for exactly this case, and the note
  // there spells out why ("a failed READ is not a switched-off feature"), as does
  // lib/panelAccess.ts → OwnedLookupFailed. This page was the one owner screen still guessing.
  //
  // It is also ONE read now instead of two. `entitledSubset` read `restaurants` for
  // owner_entitlements and then this page read the same table again for the names; asking for all
  // three columns at once answers both questions in a single trip.
  let couldntRead = false;

  if (u && u.role === "owner") {
    // Hiding the nav row is never the only guard (docs/ACCESS-MODEL.md): a typed or bookmarked
    // /owner/menu lands straight here, so the admin's "Menu" section switch is enforced AGAIN.
    // Manager mode and Inventory (inventoryLadder) both already did this; Menu was gated in the
    // sidebar and nowhere else, so an owner whose Menu section had been switched off could still
    // open the editor from history and change prices (found 2026-08-05).
    //
    // `enabledOwnedRestaurantIds` cannot answer an empty list for a real owner who reaches this
    // page — app/owner/layout.tsx redirects them to /login before the page renders when it is
    // empty — and it throws (rather than shortening) when it could not read. So an empty `ids`
    // here means the entitlement genuinely said no.
    const owned = await enabledOwnedRestaurantIds(u.id);
    if (owned.length) {
      const q = await sb.from("restaurants").select("id, name, owner_entitlements").in("id", owned);
      if (q.error) couldntRead = true;
      else {
        // Absent / non-boolean = ON, exactly as mergeOwnerEntitlements defines it, so nothing
        // changes for a restaurant that has never had the switch touched.
        restaurants = (q.data || [])
          .filter((r) => mergeOwnerEntitlements(r.owner_entitlements).menu !== false)
          .map((r) => ({ id: r.id as string, name: (r.name as string) || "Restaurant" }));
        const ids = restaurants.map((r) => r.id);
        // Honour ?rid only when the owner actually owns it; else default to their first.
        selected = qRid && ids.includes(qRid) ? qRid : (ids[0] || "");
      }
    }
  } else if (store.get(ADMIN_ACT_COOKIE)?.value && (await tokenIsValid(store.get(AUTH_COOKIE)?.value))) {
    // Admin act-as: the one restaurant they entered from the console (the layout already vetted this).
    const rid = qRid || store.get(ADMIN_ACT_COOKIE)!.value;
    const q = await sb.from("restaurants").select("id, name").eq("id", rid).maybeSingle();
    if (q.error) couldntRead = true;
    else {
      const row = q.data as { id: string; name: string } | null;
      if (row) { restaurants = [{ id: row.id, name: row.name }]; selected = row.id; }
    }
  }

  if (couldntRead) {
    return (
      <div className="adm-page">
        <h1 className="adm-page-h">Menu</h1>
        <p className="adm-page-sub">
          Couldn&apos;t open your menu just now — please reload the page. Nothing has changed
          and your menu is safe; if this keeps happening, contact Aevidine.
        </p>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="adm-page">
        <h1 className="adm-page-h">Menu</h1>
        {/* Reached only when the entitlement really said no — a failed read is answered above,
            and an owner with no restaurant at all never gets past app/owner/layout.tsx. */}
        <p className="adm-page-sub">
          The menu editor isn&apos;t switched on for your restaurant — ask your administrator.
        </p>
      </div>
    );
  }

  return <OwnerMenuEditor restaurants={restaurants} initial={selected} skin={skin} />;
}
