// GET /api/health — PUBLIC, unauthenticated uptime probe for an outside watchdog
// (e.g. UptimeRobot, free plan, every 5 min). It answers "is the app up AND can it reach the
// database?" and nothing else — no secrets, no counts, no tenant data. If the DB is unreachable
// it returns HTTP 503 so the watchdog notices; otherwise 200 { ok:true }.
//
// Setup for the owner: docs/runtime-support/alerts-setup.md.
//
// REJECTED (owner, 2026-08-13): a SECOND, deeper health check that names WHICH part is broken —
// database vs file storage vs the live-updates setting. It was built on 2026-08-12 as
// `/api/health/deep` (improvement I13) and removed the next day: *"then we don't need it remove
// it"*, said once the setup was explained — it needs a second monitor created in HIS UptimeRobot
// account, and he does not want to run one. A health page nobody watches is dead code.
//
// So do not re-add that route, AND do not "improve" THIS one by adding storage / config checks to
// it instead. That is the same idea in a different place, and it would also undo the 2026-08-06
// trim that made this probe cheap — it runs 288 times a day, forever, which is the entire reason it
// does one bounded row read and stops. Full reasoning: docs/REJECTED-IDEAS.md → R12.
//
// This route itself STAYS. It is not decoration: public/offline.html uses it to tell "this device
// lost signal" apart from "the restaurant's server is down", and the verify suite pings it.
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
