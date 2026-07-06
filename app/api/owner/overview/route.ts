// GET /api/owner/overview — the OWNER cockpit: one card's worth of headline
// numbers PER RESTAURANT, plus a top-line summary across all of them.
//
// Aggregated server-side in ONE grouped query (the lfh_owner_overview() RPC —
// migration 088), so an owner with many restaurants pays for a single round-trip
// and downloads one tiny pre-summed row per restaurant — never N queries, never
// scanning every order in JS. Service-role only (the RPC is REVOKEd from anon).
//
// AUTH: behind the existing ADMIN_PASSWORD cookie gate, same as /api/admin/*.
// TODO: replace with the dedicated owner role once RBAC lands (a parallel session
//       owns staff_users / userAuth / panelGate / middleware — do not touch them).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScope } from "@/lib/ownerScope";
import { getOwnerEntitlementsUnion, mergeOwnerEntitlements } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic"; // always fresh — these are live numbers

type Row = {
  restaurant_id: string;
  slug: string;
  name: string;
  active: boolean;
  accent_color: string | null;
  orders_today: number;
  revenue_today: number;
  orders_all: number;
  revenue_all: number;
  open_tables: number;
};
type OutRow = {
  id: string; slug: string; name: string; active: boolean; accentColor: string;
  ordersToday: number; revenueToday: number; ordersAll: number; revenueAll: number; openTables: number;
};

export async function GET(req: NextRequest) {
  const scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Scope the aggregation IN THE DATABASE (mig 138): pass the owner's restaurant
  // ids so the RPC only scans + sums their orders, instead of summing the WHOLE
  // platform every load and discarding the rest in JS (egress/cost fix). NULL = all
  // (admin). The `allow` filter below stays as cheap defense-in-depth.
  const pIds = scope.all ? null : scope.ids;
  const { data, error } = await sb.rpc("lfh_owner_overview", { p_ids: pIds });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Numerics arrive as strings over the wire — coerce once here so the client
  // gets clean numbers and the totals add up.
  const allow = scope.all ? null : new Set(scope.ids);
  const restaurants: OutRow[] = (data ?? []).filter((r: Row) => !allow || allow.has(r.restaurant_id)).map((r: Row) => ({
    id: r.restaurant_id,
    slug: r.slug,
    name: r.name,
    active: r.active,
    accentColor: r.accent_color || "#e3c06f",
    ordersToday: Number(r.orders_today) || 0,
    revenueToday: Math.round((Number(r.revenue_today) || 0) * 100) / 100,
    ordersAll: Number(r.orders_all) || 0,
    revenueAll: Math.round((Number(r.revenue_all) || 0) * 100) / 100,
    openTables: Number(r.open_tables) || 0,
  }));

  const totals = restaurants.reduce(
    (acc: { revenueToday: number; ordersToday: number; openTables: number }, r: OutRow) => {
      acc.revenueToday += r.revenueToday;
      acc.ordersToday += r.ordersToday;
      acc.openTables += r.openTables;
      return acc;
    },
    { revenueToday: 0, ordersToday: 0, openTables: 0 },
  );
  totals.revenueToday = Math.round(totals.revenueToday * 100) / 100;

  // Section entitlements (mig 133) ride along so the DASHBOARD can hide its hero
  // shortcut buttons (Reports / Staff & powers / Feedback) for a REAL owner whose
  // section the admin removed — the nav already hides them (OwnerShell), but the
  // hero shortcuts leaked (found in the PR #173 visual pass). Admin sees all-on:
  // its view keeps every shortcut (the X-ray tints live in the nav, not here).
  const entitlements = scope.admin || scope.all
    ? mergeOwnerEntitlements(null)
    : await getOwnerEntitlementsUnion(scope.ids);

  return NextResponse.json({
    restaurants,
    totals: { ...totals, restaurantCount: restaurants.length },
    entitlements,
  });
}
