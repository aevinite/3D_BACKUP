// GET /api/admin/restaurants — list EVERY restaurant on this tenant backend, for
// the admin super-panel's Restaurants tab. Returns a small summary per row
// (id, slug, name, active) plus whether it has a settings row yet, so the admin
// can pick one and edit its per-restaurant feature switches. Admin-gated (same
// STAFF_PASSWORD cookie as the rest of /aevinite + /api/admin/*), service role.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // All restaurants, plus which restaurant_ids already have a settings row (so
  // the UI can hint "no settings yet" — we create one on first toggle anyway).
  const [restQ, setQ] = await Promise.all([
    sb.from("restaurants").select("id, slug, name, active").order("name"),
    sb.from("settings").select("restaurant_id"),
  ]);
  if (restQ.error) return NextResponse.json({ error: restQ.error.message }, { status: 500 });

  const withSettings = new Set((setQ.data || []).map((r) => r.restaurant_id).filter(Boolean));
  const restaurants = (restQ.data || []).map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    active: r.active === true,
    hasSettings: withSettings.has(r.id),
  }));
  return NextResponse.json({ restaurants });
}
