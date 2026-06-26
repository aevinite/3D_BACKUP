// GET /api/admin/oplog — recent staff actions across all panels, for the admin's
// "Recent activity" feed (the combined who-did-what view). Admin-gated.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // ?limit lets the Overview feed ask for a few (30) and the Logs page ask for more
  // (up to 200). The admin sees ALL panels including admin actions (unlike the manager).
  const limit = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get("limit") || "30", 10) || 30, 1), 200);
  const r = await sb.from("staff_actions").select("*").order("created_at", { ascending: false }).limit(limit);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  const rows = r.data ?? [];

  // Stamp each row with WHICH restaurant it belongs to, so the admin (who sees every
  // restaurant) can tell them apart. Fetch the restaurant names ONCE into a map keyed
  // by id — no N+1 lookup per row. `restaurants.name` is plain text (per-tenant safe;
  // we deliberately avoid logo_text, which is #1's brand-bar wording).
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean)));
  const nameById = new Map<string, { name: string; slug: string }>();
  if (ids.length) {
    const rest = await sb.from("restaurants").select("id, name, slug").in("id", ids);
    for (const x of rest.data ?? []) nameById.set(x.id, { name: x.name, slug: x.slug });
  }
  const actions = rows.map((a) => {
    const meta = a.restaurant_id ? nameById.get(a.restaurant_id) : undefined;
    return { ...a, restaurant_name: meta?.name ?? null, restaurant_slug: meta?.slug ?? null };
  });
  return NextResponse.json({ actions });
}
