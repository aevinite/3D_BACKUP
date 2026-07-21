// GET /api/health — PUBLIC, unauthenticated uptime probe for an outside watchdog
// (e.g. UptimeRobot, free plan, every 5 min). It answers "is the app up AND can it reach the
// database?" and nothing else — no secrets, no counts, no tenant data. If the DB is unreachable
// it returns HTTP 503 so the watchdog notices; otherwise 200 { ok:true }.
//
// Setup for the owner: docs/runtime-support/alerts-setup.md.
import { NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Cheapest possible DB touch: a head-count on a tiny table, no rows moved.
    const { error } = await sb.from("restaurants").select("id", { count: "exact", head: true }).limit(1);
    if (error) return NextResponse.json({ ok: false, db: false }, { status: 503 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
