// /api/owner/settings
//   GET  → the signed-in owner's account view: their name, the owner-panel sections the
//          admin has enabled for them (read-only — the admin controls these), and the list
//          of restaurants they own. Scoped via ownerScope; no money, no other tenant.
//   POST → self password change (the logged-in OWNER only): verify current, set new, bump
//          token_version. That invalidates the current cookie, so the client re-logs in.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope } from "@/lib/ownerScope";
import { getOwnerEntitlementsUnion, OWNER_SECTION_KEYS } from "@/lib/ownerEntitlements";
import { USER_COOKIE, userFromCookie, hashSecret, verifySecret } from "@/lib/userAuth";

export const dynamic = "force-dynamic";

// The laddered modules an admin can hand to an owner (…_owner_control). The PATCH
// below only accepts these keys, and only while the transfer is on.
const MODULE_DEFS = [
  { key: "table_tags", label: "Table types (VIP / Family / Guest) + pay later", allowed: "table_tags_allowed", control: "table_tags_owner_control", enabled: "table_tags_enabled" },
  { key: "banquet", label: "Banquet billing", allowed: "banquet_allowed", control: "banquet_owner_control", enabled: "banquet_enabled" },
  { key: "table_ops", label: "Table & KOT operations (KOT menu)", allowed: "table_ops_allowed", control: "table_ops_owner_control", enabled: "table_ops_enabled" },
  { key: "take_orders", label: "Order-taking", allowed: "take_orders_allowed", control: "take_orders_owner_control", enabled: "take_orders_enabled" },
] as const;

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const owner = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  const name = owner?.name || owner?.username || (scope.admin ? "Admin" : "Owner");

  const sections: Record<string, boolean> = {};
  let restaurants: { id: string; name: string }[] = [];
  if (scope.all) {
    for (const k of OWNER_SECTION_KEYS) sections[k] = true; // admin all-view: everything on
  } else {
    const ent = await getOwnerEntitlementsUnion(scope.ids);
    for (const k of OWNER_SECTION_KEYS) sections[k] = ent[k] !== false;
    const r = await sb.from("restaurants").select("id, name").in("id", scope.ids).order("name");
    restaurants = (r.data || []) as { id: string; name: string }[];
  }
  // Only a REAL logged-in owner (not the admin act-as, which has no password row here) may
  // change their password from this page.
  const canChangePassword = !!owner && owner.role === "owner";

  // Feature ladder (mig 166): modules whose on/off the admin TRANSFERRED to this owner
  // (table_tags_owner_control) — those get a toggle on the owner's settings page. A
  // restaurant without the transfer never appears here (admin keeps the switch).
  const modIds = scope.all ? restaurants.map((r) => r.id) : scope.ids;
  const modules: { restaurant_id: string; name: string; key: string; label: string; enabled: boolean }[] = [];
  // One row per (restaurant, transferred module) — generalised for every laddered
  // module (mig 166 table_tags, mig 167 banquet); add new modules to MODULE_DEFS.
  if (modIds.length) {
    const rows = (await sb.from("settings")
      .select("restaurant_id, table_tags_allowed, table_tags_owner_control, table_tags_enabled, banquet_allowed, banquet_owner_control, banquet_enabled, table_ops_allowed, table_ops_owner_control, table_ops_enabled, take_orders_allowed, take_orders_owner_control, take_orders_enabled")
      .in("restaurant_id", modIds).limit(200)).data || [];
    const nameOf = new Map(restaurants.map((r) => [r.id, r.name]));
    for (const s of rows as Record<string, unknown>[]) {
      for (const def of MODULE_DEFS) {
        if (s[def.allowed] !== true || s[def.control] !== true) continue;
        modules.push({
          restaurant_id: String(s.restaurant_id),
          name: nameOf.get(String(s.restaurant_id)) || "",
          key: def.key,
          label: def.label,
          enabled: s[def.enabled] !== false,
        });
      }
    }
  }
  return NextResponse.json({ name, isAdmin: !!scope.admin, canChangePassword, sections, restaurants, modules });
}

// PATCH — the owner flips a module the admin transferred to them (mig 166).
//   { restaurant_id, key: "table_tags", enabled: boolean }
export async function PATCH(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const rid = String(body?.restaurant_id || "");
  const def = MODULE_DEFS.find((d) => d.key === String(body?.key || ""));
  const enabled = body?.enabled;
  if (!rid || !def || typeof enabled !== "boolean")
    return NextResponse.json({ error: "restaurant_id, key and enabled (true/false) required." }, { status: 400 });
  if (!scope.all && !scope.ids.includes(rid))
    return NextResponse.json({ error: "That restaurant isn't yours." }, { status: 403 });
  // The toggle only works while the admin has transferred control (and the feature exists).
  const s = (await sb.from("settings").select(`${def.allowed}, ${def.control}`).eq("restaurant_id", rid).maybeSingle()).data as Record<string, boolean> | null;
  if (!s?.[def.allowed]) return NextResponse.json({ error: "This feature isn't enabled for that restaurant." }, { status: 403 });
  if (!s[def.control]) return NextResponse.json({ error: "The admin hasn't handed you this switch." }, { status: 403 });
  const { error } = await sb.from("settings").update({ [def.enabled]: enabled }).eq("restaurant_id", rid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const owner = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!owner || owner.role !== "owner")
    return NextResponse.json({ error: "Only a signed-in owner can change their password here." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const current = String(body?.current || "");
  const next = String(body?.next || "");
  if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
  if (next === current) return NextResponse.json({ error: "New password must be different from the current one." }, { status: 400 });

  const row = (await sb.from("staff_users").select("password_hash, token_version").eq("id", owner.id).maybeSingle()).data as
    { password_hash: string | null; token_version: number } | null;
  if (!row) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (!(await verifySecret(current, row.password_hash)))
    return NextResponse.json({ error: "Your current password is wrong." }, { status: 403 });

  const hash = await hashSecret(next);
  const { error } = await sb.from("staff_users")
    .update({ password_hash: hash, token_version: (row.token_version || 0) + 1 })
    .eq("id", owner.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // token_version bumped → the current cookie no longer validates; the client re-logs in.
  return NextResponse.json({ ok: true, reauth: true });
}
