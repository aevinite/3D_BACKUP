// GET /api/owner/overview — the OWNER cockpit: one card's worth of headline
// numbers PER RESTAURANT, plus a top-line summary across all of them.
//
// Aggregated server-side in ONE grouped query (the lfh_owner_overview() RPC —
// migration 088), so an owner with many restaurants pays for a single round-trip
// and downloads one tiny pre-summed row per restaurant — never N queries, never
// scanning every order in JS. Service-role only (the RPC is REVOKEd from anon).
//
// AUTH: ownerScope() (lib/ownerScope.ts) — a real OWNER sees only the restaurants they own, the
// ADMIN super-user sees all, everyone else gets 401. (The old note here said "behind the
// ADMIN_PASSWORD cookie gate" with a TODO to add the owner role once RBAC landed; RBAC landed long
// ago and this route has used ownerScope since. Corrected in the T9 sweep, 2026-08-05.)
//
// WHY THERE IS NO cachedOwnerPayload HERE, deliberately: this reads the PRE-AGGREGATED
// orders_daily_agg rollup plus a small tail since its watermark, scoped by p_ids (mig 266) — which
// is exactly the "dashboards read pre-aggregated summary tables" rule, not a live order scan. The
// shell and the dashboard mount together, so lib/ownerOverviewCache.ts shares one request for ~8s.
// Don't "fix" this by wrapping it in the snapshot cache; it would only add staleness.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScopeOr503, dbFail, type PartialKey } from "@/lib/ownerScope";
import { getOwnerEntitlementsUnion, mergeOwnerEntitlements, entitledSubset } from "@/lib/ownerEntitlements";

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
  reportsOff?: boolean;
};

export async function GET(req: NextRequest) {
  // A SCOPE WE COULD NOT READ IS NOT "YOU ARE NOBODY" (T20 sweep, 2026-08-19). `ownerScope()` throws
  // OwnerScopeUnavailable when the act-as widen read fails — deliberately, so a blip can never
  // silently shrink the view — and `ownerScopeOr503()` was written in the same change to turn that
  // into a retryable 503 with a sentence a person can act on. It had NO callers: all twelve owner
  // routes still called `ownerScope()` bare, so the throw reached Next unhandled and the owner got a
  // blank 500 with no retry. Same 401 as before for a real "not you"; the only new answer is the 503.
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  const scope = sc.scope;

  // Scope the aggregation IN THE DATABASE (mig 138): pass the owner's restaurant
  // ids so the RPC only scans + sums their orders, instead of summing the WHOLE
  // platform every load and discarding the rest in JS (egress/cost fix). NULL = all
  // (admin). The `allow` filter below stays as cheap defense-in-depth.
  const pIds = scope.all ? null : scope.ids;
  const { data, error } = await sb.rpc("lfh_owner_overview", { p_ids: pIds });
  if (error) return dbFail("owner/overview", error, { message: "Couldn't load your restaurants just now — please try again." });

  // Numerics arrive as strings over the wire — coerce once here so the client
  // gets clean numbers and the totals add up.
  const allow = scope.all ? null : new Set(scope.ids);
  // Per-restaurant privacy (Stage 7): a REAL owner only sees REVENUE for restaurants whose
  // "reports" section the admin still grants. Ungranted restaurants stay in the list (so the
  // owner knows they exist) but their revenue is ZEROED + flagged reportsOff, so the client
  // greys them and no number leaks. Admin (scope.all / scope.admin) sees everything.
  const repAllow = scope.all || scope.admin ? null : new Set(await entitledSubset(scope.ids, "reports"));
  const restaurants: OutRow[] = (data ?? []).filter((r: Row) => !allow || allow.has(r.restaurant_id)).map((r: Row) => {
    const repOff = !!repAllow && !repAllow.has(r.restaurant_id);
    return {
      id: r.restaurant_id,
      slug: r.slug,
      name: r.name,
      active: r.active,
      accentColor: r.accent_color || "#e3c06f",
      ordersToday: repOff ? 0 : Number(r.orders_today) || 0,
      revenueToday: repOff ? 0 : Math.round((Number(r.revenue_today) || 0) * 100) / 100,
      ordersAll: repOff ? 0 : Number(r.orders_all) || 0,
      revenueAll: repOff ? 0 : Math.round((Number(r.revenue_all) || 0) * 100) / 100,
      openTables: Number(r.open_tables) || 0,
      reportsOff: repOff,
    };
  });

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

  // Which optional MODULES this owner has anywhere in their set (mig 220). Used by the
  // Reports hub to hide the "Team & pay" card completely for a restaurant that doesn't have
  // the feature — a card that opens onto "not enabled" is dead UI.
  // ── A CARD MUST NOT VANISH BECAUSE A READ BLIPPED (T9 improvement 11, 2026-08-06) ─────────────
  // Both probes below used to destructure `data` only and ignore `error`. A failed settings read
  // therefore looked identical to "no restaurant has this feature", so the "Team & pay" or
  // "Inventory & stock" card silently disappeared from the Reports hub — the owner's hub changing
  // shape for a reason nobody can see. The two states are now told apart:
  //   read OK  → true/false exactly as before (hide a card nobody can use — that part was right);
  //   read FAILED → keep the card VISIBLE and name `modules` in `partial`, so the hub can show the
  //                 "couldn't read which features are on" note instead of quietly rearranging.
  // Showing a card that might open onto "not enabled" is the kinder failure: the owner sees a real
  // sentence either way, instead of hunting for a card that was there yesterday.
  const modIds = scope.all ? [] : scope.ids;
  const partial: PartialKey[] = [];
  let payroll = scope.all || !!scope.admin;   // admin sees every card (X-ray)
  let inventory = scope.all || !!scope.admin;
  if ((!payroll || !inventory) && modIds.length) {
    // ONE read for both modules — they were two round-trips over the same rows.
    const probe = await sb.from("settings")
      .select("payroll_allowed, payroll_owner_control, payroll_enabled, inventory_allowed, inventory_owner_control, inventory_enabled")
      .in("restaurant_id", modIds);
    if (probe.error) {
      console.error("[owner/overview] module probe failed:", probe.error.message);
      partial.push("modules");
      payroll = true; inventory = true;        // keep the cards; the note explains why
    } else {
      const rows = (probe.data || []) as Record<string, unknown>[];
      const on = (r: Record<string, unknown>, a: string, c: string, e: string) =>
        r[a] === true && (r[c] !== true || r[e] !== false);
      if (!payroll) payroll = rows.some((r) => on(r, "payroll_allowed", "payroll_owner_control", "payroll_enabled"));
      if (!inventory) inventory = rows.some((r) => on(r, "inventory_allowed", "inventory_owner_control", "inventory_enabled"));
    }
  }

  return NextResponse.json({
    restaurants,
    totals: { ...totals, restaurantCount: restaurants.length },
    entitlements,
    modules: { payroll, inventory },
    ...(partial.length ? { partial } : {}),
  });
}
