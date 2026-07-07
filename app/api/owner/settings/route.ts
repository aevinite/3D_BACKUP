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
  return NextResponse.json({ name, isAdmin: !!scope.admin, canChangePassword, sections, restaurants });
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
