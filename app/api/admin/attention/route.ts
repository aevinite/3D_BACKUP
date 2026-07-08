// GET /api/admin/attention — the operator's "who needs me" list (account-health, part of
// feature #11). Two derived signals, NO new table and NO food money:
//   • at-risk   — a PAYING restaurant (billing status = active) that's gone idle
//                 (no orders in 30 days) or quiet this week (0 in 7d after being active).
//   • onboarding — a recently-created restaurant that never got going (no orders yet).
// Built from restaurant_billing + the lfh_admin_usage RPC + restaurants.created_at.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [billingQ, usageQ, restsQ] = await Promise.all([
    sb.from("restaurant_billing").select("restaurant_id, status, plan"),
    sb.rpc("lfh_admin_usage"),
    sb.from("restaurants").select("id, name, slug, active, created_at").is("deleted_at", null),
  ]);
  if (restsQ.error) return NextResponse.json({ error: restsQ.error.message }, { status: 500 });

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

    if (paying && u.o30 === 0) {
      atRisk.push({ id: r.id, name: r.name, slug: r.slug, plan: b?.plan || null, reason: "Paying but no orders in 30 days" });
    } else if (paying && u.o7 === 0 && u.o30 > 0) {
      atRisk.push({ id: r.id, name: r.name, slug: r.slug, plan: b?.plan || null, reason: "Was active, but no orders this week" });
    } else if (!paying && ageDays <= 30 && u.o30 === 0) {
      onboarding.push({ id: r.id, name: r.name, slug: r.slug, ageDays, reason: ageDays <= 1 ? "Just created — not live yet" : `Created ${ageDays} days ago, no orders yet` });
    }
  }
  onboarding.sort((a, b) => a.ageDays - b.ageDays);

  return NextResponse.json({ atRisk, onboarding, generatedAt: new Date().toISOString() });
}
