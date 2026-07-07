// GET /api/owner/customers — the OWNER's guest list (the `customers` table, mig 014),
// scoped to their restaurants + gated by the admin-controlled "customers" entitlement.
// READ-ONLY and money-free (the table holds only contact info + first/last seen). A
// "returning" guest = last_seen meaningfully after first_seen. Egress-safe: explicit
// columns, .in(restaurant_id), .limit, one cheap head-count for the true total.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope, type OwnerScope } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic";
const COLS = "restaurant_id, phone, name, blocked, first_seen_at, last_seen_at";
const RETURN_GAP_MS = 60_000; // last_seen more than a minute after first_seen = came back

async function scopedIds(scope: OwnerScope): Promise<string[]> {
  if (!scope.all) return scope.ids;
  const r = await sb.from("restaurants").select("id");
  return (r.data || []).map((x) => x.id as string);
}

export async function GET(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // A real owner is limited to restaurants whose "customers" section the admin still
  // allows; the admin's own session is never gated (admin = top power).
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset(scope.ids, "customers");
    if (!allowed.length) return NextResponse.json({ error: "Customers isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope = { ...scope, ids: allowed };
  }
  const ids = await scopedIds(scope);
  if (!ids.length) return NextResponse.json({ summary: { total: 0, returning: 0, newThisMonth: 0, blocked: 0, shown: 0 }, customers: [] });

  // Sanitised search (their own data; strip chars that would break the PostgREST or() filter).
  const search = (req.nextUrl.searchParams.get("q") || "").replace(/[,()%*]/g, "").trim();
  let q = sb.from("customers").select(COLS).in("restaurant_id", ids)
    .order("last_seen_at", { ascending: false }).limit(300);
  if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const list = (data || []) as Array<{ restaurant_id: string; phone: string; name: string | null; blocked: boolean; first_seen_at: string; last_seen_at: string }>;

  // Restaurant names (multi-restaurant owner tells brands apart).
  const rids = [...new Set(list.map((c) => c.restaurant_id))];
  const names: Record<string, string> = {};
  if (rids.length) {
    const r = await sb.from("restaurants").select("id, name").in("id", rids);
    for (const x of (r.data || []) as { id: string; name: string }[]) names[x.id] = x.name;
  }

  const monthAgo = Date.now() - 30 * 86_400_000;
  const isReturning = (c: { first_seen_at: string; last_seen_at: string }) =>
    new Date(c.last_seen_at).getTime() - new Date(c.first_seen_at).getTime() > RETURN_GAP_MS;
  const customers = list.map((c) => ({ ...c, restaurantName: names[c.restaurant_id] || "—", returning: isReturning(c) }));

  // True total (cheap head count) so the summary isn't capped at the 300-row page.
  const cnt = await sb.from("customers").select("phone", { count: "exact", head: true }).in("restaurant_id", ids);
  const summary = {
    total: cnt.count ?? list.length,
    returning: customers.filter((c) => c.returning).length,
    newThisMonth: list.filter((c) => new Date(c.first_seen_at).getTime() >= monthAgo).length,
    blocked: list.filter((c) => c.blocked).length,
    shown: list.length,
  };
  return NextResponse.json({ summary, customers });
}
