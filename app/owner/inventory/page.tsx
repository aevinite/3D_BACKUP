// Owner panel → Inventory & expenses (mig 221). Was a "Coming soon" placeholder; now
// the real thing: an Overview report (snapshot-cached /api/owner/inventory) plus a
// Manage view hosting the SAME inventory engine the manager panel uses (invonly embed),
// so entering a bill or an expense works identically from either panel. Restaurant
// resolution mirrors the owner Menu page: an owner picks among their entitled
// restaurants; the admin act-as gets the one they entered.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { inventoryEffectiveByRid } from "@/lib/tableTags";
import OwnerInventory from "@/components/owner/OwnerInventory";

export default async function Page({ searchParams }: { searchParams: Promise<{ rid?: string }> }) {
  const { rid: qRid } = await searchParams;
  const store = await cookies();
  const u = await userFromCookie(store.get(USER_COOKIE)?.value);
  const skin: "light" | "dark" = store.get("aevidine_skin")?.value === "light" ? "light" : "dark";

  let restaurants: { id: string; name: string }[] = [];
  let selected = "";

  if (u && u.role === "owner") {
    const ids = await enabledOwnedRestaurantIds(u.id);
    // Only restaurants where the admin has the inventory module ON — the nav is
    // union-gated, so a multi-restaurant owner may land here with a mixed estate.
    // ONE settings read for the whole estate (sweep 6 · T14, 2026-08-18). This was a `for` loop
    // calling `inventoryLadder(id)` one restaurant at a time, so an owner with twenty floors paid
    // twenty round-trips, in series, before this page drew anything. `inventoryEffectiveByRid`
    // exists for exactly this and is already used by /api/owner/reports; the rung it computes is
    // the same expression `moduleLadder` uses — allowed && (!ownerControl || enabled) — so no
    // restaurant's answer changes, it just arrives at once.
    const effective = await inventoryEffectiveByRid(ids);
    const withModule = ids.filter((id) => effective[id]);
    if (withModule.length) {
      const rows = (await sb.from("restaurants").select("id, name").in("id", withModule)).data || [];
      const nameById = new Map(rows.map((r) => [r.id as string, r.name as string]));
      restaurants = withModule.map((id) => ({ id, name: nameById.get(id) || "Restaurant" }));
      selected = qRid && withModule.includes(qRid) ? qRid : withModule[0];
    }
  } else if (store.get(ADMIN_ACT_COOKIE)?.value && (await tokenIsValid(store.get(AUTH_COOKIE)?.value))) {
    const rid = qRid || store.get(ADMIN_ACT_COOKIE)!.value;
    const row = (await sb.from("restaurants").select("id, name").eq("id", rid).maybeSingle()).data as
      { id: string; name: string } | null;
    if (row) { restaurants = [{ id: row.id, name: row.name }]; selected = row.id; }
  }

  // ── A SECTION YOU DO NOT HAVE SIMPLY IS NOT THERE (owner, 2026-08-31) ─────────────────────────
  // *"if the inventory is not switch on, then it will not show — it will not even show that
  //  option… it will not only show 'unable to access', that there is a feature which contains
  //  inventory."*
  // This is R36 again, arriving from the page side: *"owner can't know which option are not given
  // to them, only admin should know that."* The sidebar already hides a withheld section from a
  // real owner (`OwnerShell` → `if (!on && (!adminViewing || simulated)) return null`). The PAGE
  // did not: reached by a typed URL or an old bookmark it printed "This feature isn't switched on for your
  // restaurant yet — ask your administrator" — which
  // names a feature he has not been given and invites him to go and ask for it.
  // That screen is DELETED, not restyled (the standing "a new way replaces the old one" rule), and
  // he is sent back to his dashboard instead. The ADMIN is unaffected: only a real owner can reach
  // this line, because the admin act-as branch above is never module-gated — admin = top power, and
  // its X-ray nav says outright "You can still open it from this view".
  if (!selected) redirect("/owner");

  return <OwnerInventory restaurants={restaurants} initial={selected} skin={skin} />;
}
