// /api/owner/manager-permissions — the OWNER (never a manager) flips what their
// managers are allowed to do, per restaurant. This is the "owner controls manager
// powers" knob: each flag, when false, means only the owner can do that action.
//
//   PATCH { restaurant_id, permissions: { manage_staff?, edit_menu?, give_discounts?,
//           view_dashboard?, void_bills? } }  → merges the given booleans.
//
// AUTH: admin super-user, or an OWNER who owns that restaurant. A MANAGER is
// explicitly refused — they must not be able to widen their own powers.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie } from "@/lib/userAuth";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

// The full set of manager-capability flags (mirrors migration 091's default).
const FLAGS = ["manage_staff", "edit_menu", "give_discounts", "view_dashboard", "void_bills"] as const;
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

export async function PATCH(req: NextRequest) {
  let body: any = {}; try { body = await req.json(); } catch {}
  const rid = String(body?.restaurant_id || "");
  if (!rid) return bad("Missing restaurant_id.");

  // Authorise: admin (any restaurant) OR an owner who owns THIS restaurant.
  const isAdmin = await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
  if (!isAdmin) {
    const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
    if (!u) return bad("Not authorised — please log in.", 401);
    if (u.role !== "owner") return bad("Only the owner can change manager powers.", 403);
    // Multi-owner (migration 097): authorise via membership in restaurant_owners,
    // not the single primary-owner column, so any co-owner of this restaurant can
    // change its manager powers — and only an actual owner of it can.
    const owned = (await sb.from("restaurant_owners").select("restaurant_id").eq("restaurant_id", rid).eq("user_id", u.id).limit(1)).data?.[0];
    if (!owned) return bad("That restaurant isn't yours.", 403);
  }

  // Validate + collect only known boolean flags from the request.
  const incoming = body?.permissions && typeof body.permissions === "object" ? body.permissions : {};
  const patch: Record<string, boolean> = {};
  for (const k of FLAGS) if (k in incoming) patch[k] = incoming[k] === true;
  if (!Object.keys(patch).length) return bad("No valid permission flags given.");

  // Merge onto the existing JSONB (don't clobber flags the caller didn't send).
  const cur = (await sb.from("restaurants").select("manager_permissions, name").eq("id", rid).limit(1)).data?.[0];
  if (!cur) return bad("Restaurant not found.", 404);
  const merged = { ...(cur.manager_permissions || {}), ...patch };
  const { error } = await sb.from("restaurants").update({ manager_permissions: merged }).eq("id", rid);
  if (error) return bad(error.message, 500);
  await logAction("owner", "manager_permissions", { restaurant_id: rid, detail: `${cur.name}: ${Object.entries(patch).map(([k, v]) => `${k}=${v ? "on" : "off"}`).join(", ")}` });
  return ok({ ok: true, manager_permissions: merged });
}
