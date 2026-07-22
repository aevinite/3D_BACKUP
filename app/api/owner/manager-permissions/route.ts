// /api/owner/manager-permissions — the OWNER (never a manager) flips what their
// managers are allowed to do, per restaurant. This is the "owner controls manager
// powers" knob: each flag, when false, means only the owner can do that action.
//
//   PATCH { restaurant_id, permissions: { manage_staff?, edit_menu?, give_discounts?,
//           view_dashboard?, void_bills?, edit_settings? } }  → merges the given booleans.
//
// AUTH: admin super-user, or an OWNER who owns that restaurant. A MANAGER is
// explicitly refused — they must not be able to widen their own powers.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { logAction } from "@/lib/oplog";
import { mergeOwnerEntitlements, powerEntitlementKey } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic";

// The full set of manager-capability flags the owner can grant. `edit_settings` is
// enforced by the editor route (managerCan(…, "edit_settings")) but had no toggle here,
// so it was permanently off — added so the owner can actually grant it. New powers just
// append to this whitelist (the owner page maps over it — no fixed count anywhere).
// table_ops = the KOT ▾ menu (merge tables, move a KOT/item, split bill); its admin
// rung is the table_ops_depth knob — mergeOwnerEntitlements derives power_table_ops
// from it, so the existing entitlement guard below applies unchanged.
const FLAGS = ["manage_staff", "edit_menu", "give_discounts", "view_dashboard", "void_bills", "edit_settings", "view_ratings", "table_tags", "khata", "banquet", "table_ops"] as const;
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

export async function PATCH(req: NextRequest) {
  let body: any = {}; try { body = await req.json(); } catch {}
  const rid = String(body?.restaurant_id || "");
  if (!rid) return bad("Missing restaurant_id.");

  // Authorise: an OWNER who owns THIS restaurant, OR (failing that) the admin super-user.
  // Owner is checked FIRST so a browser holding both an owner and an admin cookie is
  // treated as the owner (scoped to owned restaurants) — consistent with lib/ownerScope
  // and the staff route, not silently escalated to admin (found 2026-07-06).
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u?.role === "owner") {
    // Multi-owner (migration 097): authorise via membership in restaurant_owners,
    // not the single primary-owner column, so any co-owner of this restaurant can
    // change its manager powers — and only an actual owner of it can.
    const owned = (await sb.from("restaurant_owners").select("restaurant_id").eq("restaurant_id", rid).eq("user_id", u.id).limit(1)).data?.[0];
    if (!owned) return bad("That restaurant isn't yours.", 403);
  } else if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value))) {
    return bad(u ? "Only the owner can change manager powers." : "Not authorised — please log in.", u ? 403 : 401);
  }

  // Validate + collect only known boolean flags from the request.
  const incoming = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};
  const patch: Record<string, boolean> = {};
  for (const k of FLAGS) {
    if (!(k in incoming)) continue;
    // Reject junk — the old `incoming[k] === true` silently coerced a non-boolean
    // (e.g. edit_menu:"maybe" quietly turned the power OFF) and still answered {ok:true}.
    if (typeof incoming[k] !== "boolean") return bad(`"${k}" must be true or false.`);
    patch[k] = incoming[k];
  }
  if (!Object.keys(patch).length) return bad("No valid permission flags given.");

  // Merge onto the existing JSONB (don't clobber flags the caller didn't send).
  const cur = (await sb.from("restaurants").select("manager_permissions, owner_entitlements, name").eq("id", rid).limit(1)).data?.[0];
  if (!cur) return bad("Restaurant not found.", 404);

  // Mig 133 (the ladder): an OWNER can only grant a power the ADMIN still entitles —
  // the toggle is hidden from their panel, so a request naming it is hand-crafted.
  // The admin console writes through /api/admin/restaurants/access, so isAdmin here
  // means the act-as owner view — keep it able to flip only what the owner could.
  const ents = mergeOwnerEntitlements(cur.owner_entitlements);
  for (const k of Object.keys(patch)) {
    if (patch[k] && ents[powerEntitlementKey(k)] === false)
      return bad(`"${k}" isn't available for this restaurant — the admin has removed it.`, 403);
  }
  const merged = { ...(cur.manager_permissions || {}), ...patch };
  const { error } = await sb.from("restaurants").update({ manager_permissions: merged }).eq("id", rid);
  if (error) return bad("Something went wrong, please try again.", 500);
  await logAction("owner", "manager_permissions", { restaurant_id: rid, actor_id: u?.id ?? null, detail: `${cur.name}: ${Object.entries(patch).map(([k, v]) => `${k}=${v ? "on" : "off"}`).join(", ")}` });
  return ok({ ok: true, manager_permissions: merged });
}
