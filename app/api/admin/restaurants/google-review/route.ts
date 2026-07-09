// Admin sets a restaurant's Google review link (owner 2026-07-09). When set, a guest who
// rates a dish >= 4 stars sees a "review us on Google" nudge (guest side in ItemClient;
// getSettings exposes the link). An empty value clears it (nudge off). Stored on the
// settings row (google_review_url, mig 155), scoped by restaurant_id. Admin-gated, service
// role. Modeled on the sibling staff-features route.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { cleanClonedSettings } from "@/lib/settingsClone";

export const dynamic = "force-dynamic";

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// Accept an empty string (clears the link) or a plain http(s) URL, capped for sanity.
function normalizeUrl(raw: unknown): { ok: true; url: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, url: null };
  if (typeof raw !== "string") return { ok: false, error: "link must be text" };
  const u = raw.trim();
  if (!u) return { ok: true, url: null };
  if (u.length > 500) return { ok: false, error: "link is too long" };
  if (!/^https?:\/\/\S+$/i.test(u)) return { ok: false, error: "link must start with http:// or https://" };
  return { ok: true, url: u };
}

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const restaurantId = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!isUuid(restaurantId)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  const row = await sb.from("settings").select("google_review_url").eq("restaurant_id", restaurantId).maybeSingle();
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 });
  return NextResponse.json({ url: (row.data as { google_review_url?: string | null } | null)?.google_review_url ?? null });
}

export async function POST(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { restaurant_id, url } = await req.json().catch(() => ({}));
  if (!isUuid(restaurant_id)) return NextResponse.json({ error: "missing or invalid restaurant_id" }, { status: 400 });
  const norm = normalizeUrl(url);
  if (!norm.ok) return NextResponse.json({ error: norm.error }, { status: 400 });

  const rest = await sb.from("restaurants").select("id, slug").eq("id", restaurant_id).maybeSingle();
  if (rest.error) return NextResponse.json({ error: rest.error.message }, { status: 500 });
  if (!rest.data) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });

  const cur = await sb.from("settings").select("id").eq("restaurant_id", restaurant_id).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });

  if (cur.data) {
    const r = await sb.from("settings").update({ google_review_url: norm.url }).eq("restaurant_id", restaurant_id).select("google_review_url").maybeSingle();
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
    return NextResponse.json({ url: (r.data as { google_review_url?: string | null } | null)?.google_review_url ?? null });
  }
  // No settings row yet → clone #1 as a template so every NOT NULL column is satisfied
  // (mirrors the features/panels/staff-features routes), then set id/restaurant_id + the link.
  const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
  const base = cleanClonedSettings(template.data); // strip #1's identity/geo/tax so they don't leak
  const newRow = { ...base, id: rest.data.slug, restaurant_id, google_review_url: norm.url };
  const ins = await sb.from("settings").upsert(newRow, { onConflict: "restaurant_id" }).select("google_review_url").maybeSingle();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  return NextResponse.json({ url: (ins.data as { google_review_url?: string | null } | null)?.google_review_url ?? null, created: true });
}
