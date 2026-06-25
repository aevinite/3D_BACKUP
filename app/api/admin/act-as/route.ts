// POST /api/admin/act-as — admin "view as" a restaurant. Sets a cookie the staff
// panels (kitchen/tablet/manager) read via panelRestaurantId, so the admin can open
// any restaurant's panels scoped to THAT restaurant instead of the default #1.
// Admin-gated. Body: { restaurant_id } to enter, or { clear: true } to exit.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any = {}; try { body = await req.json(); } catch {}
  const res = NextResponse.json({ ok: true });
  if (body?.clear) { res.cookies.set(ADMIN_ACT_COOKIE, "", { path: "/", maxAge: 0 }); return res; }
  const rid = String(body?.restaurant_id || "");
  if (!rid) return NextResponse.json({ error: "restaurant_id required" }, { status: 400 });
  const r = (await sb.from("restaurants").select("id, name").eq("id", rid).limit(1)).data?.[0];
  if (!r) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });
  // Short-lived (6h) view session; HttpOnly so only the server reads it.
  res.cookies.set(ADMIN_ACT_COOKIE, rid, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 6 });
  return NextResponse.json({ ok: true, restaurant: r.name });
}
