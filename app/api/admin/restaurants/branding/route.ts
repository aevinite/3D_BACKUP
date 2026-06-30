// /api/admin/restaurants/branding — read/write ONE restaurant's brand identity:
// accent_color + full theme palette (theme jsonb: {dark,light}{bg,card,text,accent})
// + hero_title / tagline / logo_text. Admin-gated, service role. Reuses existing
// columns (migration 087) — no migration. All colours validated as hex.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { isHexColor, sanitizeBrandTheme } from "@/lib/brandTheme";

export const dynamic = "force-dynamic";
const ok = (d: any, s = 200) => NextResponse.json(d, { status: s });
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!rid) return bad("Missing restaurant_id.");
  const { data, error } = await sb.from("restaurants")
    .select("accent_color, theme, hero_title, tagline, logo_text, logo_url").eq("id", rid).maybeSingle();
  if (error) return bad(error.message, 500);
  return ok({
    accent_color: data?.accent_color ?? null,
    theme: (data?.theme && typeof data.theme === "object") ? data.theme : {},
    hero_title: data?.hero_title ?? null,
    tagline: data?.tagline ?? null,
    logo_text: data?.logo_text ?? null,
    logo_url: data?.logo_url ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const rid = String(body?.restaurant_id || "");
  if (!rid) return bad("Missing restaurant_id.");
  const patch: Record<string, unknown> = {};
  if ("accent_color" in body) {
    const a = body.accent_color;
    if (a === null || a === "") patch.accent_color = null;
    else if (isHexColor(a)) patch.accent_color = String(a).trim();
    else return bad("accent_color must be a hex colour like #e3c06f.");
  }
  if ("theme" in body) patch.theme = sanitizeBrandTheme(body.theme);  // drops any non-hex
  if ("hero_title" in body) patch.hero_title = body.hero_title ? String(body.hero_title).slice(0, 120) : null;
  if ("tagline" in body) patch.tagline = body.tagline ? String(body.tagline).slice(0, 80) : null;
  if ("logo_text" in body) patch.logo_text = body.logo_text ? String(body.logo_text).slice(0, 60) : null;
  if (!Object.keys(patch).length) return bad("Nothing to update.");
  const { error } = await sb.from("restaurants").update(patch).eq("id", rid);
  if (error) return bad(error.message, 500);
  await logAction("admin", "restaurant_branding", { actor: "admin", restaurant_id: rid, detail: `updated branding (${Object.keys(patch).join(", ")})` });
  return ok({ ok: true });
}
