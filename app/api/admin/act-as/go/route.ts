// GET /api/admin/act-as/go?rid=<restaurant_id>&to=</manager|/kitchen|...>[&uid=<owner>]
// The INSTANT quick-open: sets the act-as cookie and 302-redirects to the panel in ONE
// round trip. The click handler window.open()s this URL synchronously, so the tab
// appears the moment the admin clicks (owner 2026-07-04: quick-open "takes too much
// time" — the old flow awaited a POST before the tab even opened, which also risked
// popup blockers). Admin-gated like the POST route; `to` is whitelisted so this can
// never become an open redirect.
//   uid — OPTIONAL, only for to=/owner: when a restaurant has SEVERAL owners the
//   dashboard "which owner?" chooser passes the picked owner as uid; we forward it to
//   the cockpit as ?as= (per-tab), which ownerScope honors after re-checking membership
//   (owner 2026-07-25). Ignored for the other panels.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { ADMIN_ACT_COOKIE } from "@/lib/panelScope";

export const dynamic = "force-dynamic";

const ALLOWED_PATHS = new Set(["/manager", "/editor", "/kitchen", "/tablet", "/owner"]);

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rid = req.nextUrl.searchParams.get("rid") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  const uid = req.nextUrl.searchParams.get("uid") || "";
  if (!rid || !ALLOWED_PATHS.has(to))
    return NextResponse.json({ error: "rid and a known panel path required" }, { status: 400 });

  const r = (await sb.from("restaurants").select("id").eq("id", rid).limit(1)).data?.[0];
  if (!r) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  // Same cookie the POST route sets; the redirect carries ?rid= so THIS tab stays
  // pinned to the restaurant even if the browser-wide cookie later changes. A chosen
  // owner (uid) rides along as ?as= for the owner cockpit only — ownerScope re-checks
  // that the owner actually co-owns this restaurant before honoring it.
  const asPin = to === "/owner" && uid ? `&as=${encodeURIComponent(uid)}` : "";
  const res = NextResponse.redirect(new URL(`${to}?rid=${encodeURIComponent(rid)}${asPin}`, req.nextUrl.origin), 302);
  res.cookies.set(ADMIN_ACT_COOKIE, rid, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 6 });
  return res;
}
