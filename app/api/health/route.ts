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
    // Cheapest possible DB touch: read ONE id and stop. No rows of data, and no COUNT.
    //
    // It used to ask for `count: "exact"` as well (T9 improvement 5, 2026-08-06). A watchdog hits
    // this every 5 minutes forever, and an exact count makes Postgres tally the whole `restaurants`
    // table every single time — work that grows with the platform to answer a question that never
    // needed it. "Can we reach the database?" is fully answered by whether ONE row comes back
    // without an error. `.limit(1)` on its own is the whole probe.
    //
    // Deliberately NOT `head: true` either: a HEAD-shaped request with no count asks the database
    // for nothing at all, which would stop being a real proof that the connection works.
    const { error } = await sb.from("restaurants").select("id").limit(1);
    if (error) return NextResponse.json({ ok: false, db: false }, { status: 503 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
