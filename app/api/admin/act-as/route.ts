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

  // EXIT "view as": clear the cookie and return THAT response.
  if (body?.clear) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_ACT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const rid = String(body?.restaurant_id || "");
  if (!rid) return NextResponse.json({ error: "restaurant_id required" }, { status: 400 });
  const r = (await sb.from("restaurants").select("id, name").eq("id", rid).limit(1)).data?.[0];
  if (!r) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  // CRITICAL: set the cookie on the SAME response we return. The old code set it on
  // one response then returned a fresh NextResponse.json(), silently dropping the
  // Set-Cookie — so the admin's panels stayed on restaurant #1 (the "I can only
  // access Little French House" bug). Short-lived (6h) view session; HttpOnly.
  const res = NextResponse.json({ ok: true, restaurant: r.name });
  // `secure` in production, matching BOTH login doors (T17 sweep, 2026-08-13, finding F13). The
  // two cookie-setting doors in this area were deliberately aligned on 2026-08-05 — "the point is
  // that the two doors now agree" — and this third one, set from the same console, was missed.
  // Vercel serves HTTPS only so nothing changes in practice; three cookies, one rule.
  res.cookies.set(ADMIN_ACT_COOKIE, rid, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 6, secure: process.env.NODE_ENV === "production" });
  return res;
}
