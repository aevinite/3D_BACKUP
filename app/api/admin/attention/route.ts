// GET /api/admin/attention — the operator's "who needs me" list (account-health, part of
// feature #11). Two derived signals, NO new table and NO food money:
//   • at-risk   — a PAYING restaurant (billing status = active) that's gone idle
//                 (no orders in 30 days) or quiet this week (0 in 7d after being active).
//   • onboarding — a recently-created restaurant that never got going (no orders yet).
// Built from restaurant_billing + the lfh_admin_usage RPC + restaurants.created_at.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [billingQ, usageQ, restsQ] = await Promise.all([
    sb.from("restaurant_billing").select("restaurant_id, status, plan"),
    sb.rpc("lfh_admin_usage"),
    sb.from("restaurants").select("id, name, slug, active, created_at").is("deleted_at", null),
  ]);
  // Check ALL three — a partial failure (e.g. the usage RPC times out) would otherwise leave
  // usage empty and flag EVERY paying restaurant as churn-risk with a confident 200 (audit).
  const anyErr = restsQ.error || usageQ.error || billingQ.error;
  // PLAIN WORDS FOR THE CONSOLE (sweep #6, T19). This answered with the database's own
  // sentence, so a failure here read as e.g. `relation "…" does not exist` in a red toast —
  // right for a developer, useless on the screen the owner runs his platform from. adminFail
  // keeps the raw text where it is actually useful (the response `detail` and the server log)
  // and gives the screen a sentence that names the thing and says whether anything changed.
  if (anyErr) return adminFail("the account-health list", anyErr, { action: "load" });

  const billing = new Map<string, { status: string; plan: string | null }>((billingQ.data || []).map((b) => [b.restaurant_id, { status: b.status, plan: b.plan }]));
  const usage = new Map<string, { o7: number; o30: number }>(((usageQ.data as { restaurant_id: string; orders_7d: number; orders_30d: number }[]) || []).map((u) => [u.restaurant_id, { o7: Number(u.orders_7d) || 0, o30: Number(u.orders_30d) || 0 }]));
  const now = Date.now();

  const atRisk: { id: string; name: string; slug: string; plan: string | null; reason: string }[] = [];
  const onboarding: { id: string; name: string; slug: string; ageDays: number; reason: string }[] = [];

  for (const r of restsQ.data || []) {
    if (r.active !== true) continue; // suspended restaurants are a separate (deliberate) state
    const u = usage.get(r.id) || { o7: 0, o30: 0 };
    const b = billing.get(r.id);
    const paying = b?.status === "active";
    const ageDays = r.created_at ? Math.floor((now - new Date(r.created_at).getTime()) / 86_400_000) : 9999;

    if (ageDays <= 30 && u.o30 === 0) {
      // A recently-created restaurant that hasn't started yet → onboarding, NOT churn — even
      // if it's already paying (a day-1 paying customer isn't "about to leave"; audit).
      onboarding.push({ id: r.id, name: r.name, slug: r.slug, ageDays, reason: ageDays <= 1 ? "Just created — not live yet" : `Created ${ageDays} days ago, no orders yet` });
    } else if (paying && u.o30 === 0) {
      // Established (>30d) paying restaurant that's gone idle → real churn risk.
      atRisk.push({ id: r.id, name: r.name, slug: r.slug, plan: b?.plan || null, reason: "Paying but no orders in 30 days" });
    } else if (paying && u.o7 === 0 && u.o30 > 0) {
      atRisk.push({ id: r.id, name: r.name, slug: r.slug, plan: b?.plan || null, reason: "Was active, but no orders this week" });
    }
  }
  onboarding.sort((a, b) => a.ageDays - b.ageDays);

  return NextResponse.json({ atRisk, onboarding, generatedAt: new Date().toISOString() });
}
