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
// visits/consent added by Customer CRM (mig 211): a REAL repeat count + the DPDP
// opt-in flag. Still money-free (no spend column exists).
const COLS = "restaurant_id, phone, name, blocked, visits, consent, first_seen_at, last_seen_at";
const REPEAT_MIN = 2; // visits >= 2 = a returning customer (real count, not a time heuristic)

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
  const list = (data || []) as Array<{ restaurant_id: string; phone: string; name: string | null; blocked: boolean; visits: number; consent: boolean; first_seen_at: string; last_seen_at: string }>;

  // Restaurant names (multi-restaurant owner tells brands apart).
  const rids = [...new Set(list.map((c) => c.restaurant_id))];
  const names: Record<string, string> = {};
  if (rids.length) {
    const r = await sb.from("restaurants").select("id, name").in("id", rids);
    for (const x of (r.data || []) as { id: string; name: string }[]) names[x.id] = x.name;
  }

  const monthAgo = Date.now() - 30 * 86_400_000;
  const monthAgoIso = new Date(monthAgo).toISOString();
  const customers = list.map((c) => ({ ...c, restaurantName: names[c.restaurant_id] || "—", returning: (c.visits || 0) >= REPEAT_MIN }));

  // Summary counts are TRUE scoped head-counts, not derived from the 300-row display page —
  // before this, "Blocked"/"New" undercounted for a restaurant with >300 guests (a guest
  // blocked long ago, or a busy month, fell outside the recent-300 window). `total`,
  // `blocked` and `newThisMonth` are plain column filters, so each is one cheap indexed
  // COUNT(head) scoped by restaurant_id — no extra rows fetched. `returning` needs a
  // per-row comparison of two timestamps (last_seen vs first_seen), which a column filter
  // can't express, so it stays derived from the shown page and can undercount on very busy
  // restaurants; making it exact needs a small scoped DB function (see OVERNIGHT note).
  // `returning` is now an EXACT scoped head-count (visits >= 2) — the real visit
  // counter (mig 211) lets us count it in the DB instead of eyeballing timestamps on
  // the shown page, so it no longer undercounts busy restaurants.
  const head = () => sb.from("customers").select("phone", { count: "exact", head: true }).in("restaurant_id", ids);
  const [cntAll, cntBlocked, cntNew, cntReturning] = await Promise.all([
    head(),
    head().eq("blocked", true),
    head().gte("first_seen_at", monthAgoIso),
    head().gte("visits", REPEAT_MIN),
  ]);
  const summary = {
    total: cntAll.count ?? list.length,
    returning: cntReturning.count ?? customers.filter((c) => c.returning).length,
    newThisMonth: cntNew.count ?? list.filter((c) => new Date(c.first_seen_at).getTime() >= monthAgo).length,
    blocked: cntBlocked.count ?? list.filter((c) => c.blocked).length,
    shown: list.length,
  };
  return NextResponse.json({ summary, customers });
}

// DELETE /api/owner/customers — erase a customer (DPDP right-to-erasure, mig 211).
// Removes the customers row + their visit ledger + device links, scoped to a
// restaurant the owner actually owns AND still has the "customers" section for.
// Admin (top power) is never gated. Body: { restaurant_id, phone }.
export async function DELETE(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { restaurant_id?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }
  const restaurantId = String(body?.restaurant_id || "");
  const phone = String(body?.phone || "");
  if (!restaurantId || !phone) return NextResponse.json({ error: "restaurant_id and phone required" }, { status: 400 });

  // The restaurant must be in the owner's own, still-entitled set (never trust the
  // client's restaurant_id beyond that). Admin bypasses the entitlement gate only.
  const ownIds = await scopedIds(scope);
  if (!ownIds.includes(restaurantId)) return NextResponse.json({ error: "not your restaurant" }, { status: 403 });
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset([restaurantId], "customers");
    if (!allowed.length) return NextResponse.json({ error: "Customers isn't enabled for your restaurant.", disabled: true }, { status: 403 });
  }

  await sb.from("customer_visits").delete().eq("restaurant_id", restaurantId).eq("phone", phone);
  await sb.from("customer_devices").delete().eq("restaurant_id", restaurantId).eq("phone", phone);
  const del = await sb.from("customers").delete().eq("restaurant_id", restaurantId).eq("phone", phone).select("phone");
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, erased: (del.data || []).length });
}
