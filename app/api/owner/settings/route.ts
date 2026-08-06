// /api/owner/settings
//   GET  → the signed-in owner's account view: their name, the owner-panel sections the
//          admin has enabled for them (read-only — the admin controls these), and the list
//          of restaurants they own. Scoped via ownerScope; no money, no other tenant.
//   POST → self password change (the logged-in OWNER only): verify current, set new, bump
//          token_version. That invalidates the current cookie, so the client re-logs in.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, dbFail } from "@/lib/ownerScope";
import { getOwnerEntitlementsUnion, OWNER_SECTION_KEYS, entitledSubset } from "@/lib/ownerEntitlements";
import { USER_COOKIE, userFromCookie, hashSecret, verifySecret } from "@/lib/userAuth";
import { MODULE_DEFS } from "@/lib/accessModel";
import { logAction } from "@/lib/oplog";
import { rateAllowed, rateResetOnSuccess } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// The laddered modules an admin can hand to an owner (…_owner_control) — MODULE_DEFS,
// DERIVED from lib/accessModel.ts (2026-07-26). The old hand-typed copy here was
// missing parcel: an admin who transferred parcel control gave the owner a toggle
// that never appeared on this page. The PATCH below only accepts these keys, and
// only while the transfer is on.

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
    // Ladder rule (docs/ACCESS-MODEL.md): a section that's OFF is REFUSED by the server,
    // not just hidden from the nav. The "settings" section had no server gate — a real
    // owner whose Settings section the admin switched off could still open this page
    // directly and change their password. Refuse here (matches customers/reports/issues)
    // so both this GET and the self password-change POST below are truly closed. (The
    // module-toggle PATCH already checks the per-restaurant "settings" entitlement.)
    if (ent.settings === false)
      return NextResponse.json({ error: "Settings isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    // Per-restaurant privacy (Stage 7): the settings page only lists restaurants whose
    // "settings" section the admin granted this owner — so they can't view/edit another
    // restaurant's appearance/config that the admin withheld. Union above still decides
    // whether the nav item exists at all; this decides WHICH restaurants appear inside.
    const settingsIds = scope.admin ? scope.ids : await entitledSubset(scope.ids, "settings");
    const r = await sb.from("restaurants").select("id, name").in("id", settingsIds.length ? settingsIds : [" "]).order("name");
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
    const modCols = MODULE_DEFS.flatMap((d) => [d.allowed, d.control, d.enabled]);
    // Dynamic column list → supabase can't infer the row shape; cast via unknown.
    const rows = ((await sb.from("settings")
      .select(["restaurant_id", ...modCols].join(", "))
      .in("restaurant_id", modIds).limit(200)).data || []) as unknown as Record<string, unknown>[];
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
  // Per-restaurant privacy (Stage 7): a REAL owner can only touch the settings of a restaurant
  // whose "settings" section the admin granted them (admin act-as is unrestricted).
  if (!scope.all && !scope.admin && !(await entitledSubset([rid], "settings")).length)
    return NextResponse.json({ error: "The admin hasn't given you settings for this restaurant." }, { status: 403 });
  // The toggle only works while the admin has transferred control (and the feature exists).
  const s = (await sb.from("settings").select(`${def.allowed}, ${def.control}`).eq("restaurant_id", rid).maybeSingle()).data as Record<string, boolean> | null;
  if (!s?.[def.allowed]) return NextResponse.json({ error: "This feature isn't enabled for that restaurant." }, { status: 403 });
  if (!s[def.control]) return NextResponse.json({ error: "The admin hasn't handed you this switch." }, { status: 403 });
  const { error } = await sb.from("settings").update({ [def.enabled]: enabled }).eq("restaurant_id", rid);
  if (error) return dbFail("owner/settings.module", error, { message: "Couldn't change that switch — please try again." });
  // A module turning itself off changes what a whole panel offers, and nothing recorded it — so with
  // two co-owners nobody could say who flipped it (sweep 2026-08-04). Unlike issues/ratings there is
  // no in-row stamp to fall back on: the settings column holds only the value.
  await logAction("owner", "module_toggle", {
    restaurant_id: rid, actor: scope.admin ? "admin" : (("ownerId" in scope && scope.ownerId) || "owner"),
    detail: `${def.label} → ${enabled ? "on" : "off"}`,
  });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const owner = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!owner || owner.role !== "owner")
    return NextResponse.json({ error: "Only a signed-in owner can change their password here." }, { status: 403 });
  // Same rung as GET: if the admin switched this owner's Settings section off, the self
  // password-change is refused server-side too (not just hidden from the nav).
  const scope = await ownerScope(req);
  if (scope && !scope.all) {
    const ent = await getOwnerEntitlementsUnion(scope.ids);
    if (ent.settings === false)
      return NextResponse.json({ error: "Settings isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const current = String(body?.current || "");
  const next = String(body?.next || "");
  if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
  if (next === current) return NextResponse.json({ error: "New password must be different from the current one." }, { status: 400 });

  const row = (await sb.from("staff_users").select("password_hash, token_version").eq("id", owner.id).maybeSingle()).data as
    { password_hash: string | null; token_version: number } | null;
  if (!row) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  // Same wall as app/api/panel-profile (sweep 2026-08-04, mig 277) — see the note there for why an
  // already-signed-in password box still needs one. Counted per account, before the check.
  if (!(await rateAllowed("password_change", owner.id, {
    restaurantId: owner.restaurant_id ?? null,
    label: `Owner ${owner.name || owner.username} changing their own password`,
  }))) {
    return NextResponse.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });
  }
  if (!(await verifySecret(current, row.password_hash)))
    return NextResponse.json({ error: "Your current password is wrong." }, { status: 403 });
  await rateResetOnSuccess("password_change", owner.id);

  const hash = await hashSecret(next);
  const { error } = await sb.from("staff_users")
    .update({ password_hash: hash, token_version: (row.token_version || 0) + 1 })
    .eq("id", owner.id);
  if (error) return dbFail("owner/settings.password", error, { message: "Couldn't change your password — please try again." });
  // Bumping token_version ends EVERY session on this account, so the visible symptom is "everyone
  // got logged out" with nothing to explain it. app/api/panel-profile already logs its equivalent
  // self-change as `password_change`; this one didn't (sweep 2026-08-04).
  await logAction("owner", "password_change", {
    restaurant_id: owner.restaurant_id ?? undefined,
    actor: owner.name || owner.username, actor_id: owner.id,
    detail: `${owner.name || owner.username} changed their own password (all their sessions ended)`,
  });
  // token_version bumped → the current cookie no longer validates; the client re-logs in.
  return NextResponse.json({ ok: true, reauth: true });
}
