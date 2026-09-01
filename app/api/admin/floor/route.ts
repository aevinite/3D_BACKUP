// GET /api/admin/floor — the live floor, straight from the ONE brain.
//
// This calls lfh_floor_state() (migration 041), which decides every table's
// status in one place. Because every staff/admin screen reads THIS, they can
// never disagree. Runs on the server with the service-role key (the function is
// staff-only / revoked from the public key).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";

// Always fetch fresh — the floor is live, never cached.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ?all=1 — EVERY restaurant's floor at once (owner 2026-07-04: the admin live
  // floor must show the whole platform "like a year calendar", not just one
  // restaurant). One fan-out on the pooled server connection; the payload is
  // trimmed to the 4 fields the mini-tiles render so 12 × 300 tables stays tiny.
  // The PAGE decides when to call this (first load + manual Refresh only —
  // owner 2026-07-06); no per-event realtime — a platform-wide firehose would
  // refetch the fan-out on every order anywhere.
  if (req.nextUrl.searchParams.get("all") === "1") {
    // Order counts come pre-summed from Postgres (lfh_admin_floor_stats,
    // migration 134) — one tiny row per restaurant, never today's order rows
    // themselves. Counts only, NO revenue (owner 2026-07-03: the admin panel
    // shows no earnings anywhere).
    // ONE round-trip for the whole platform's tiles (lfh_admin_floor_all, migration 145)
    // instead of one lfh_floor_state call PER restaurant — the per-restaurant fan-out grew
    // linearly with tenant count (100 restaurants = 100 requests every refresh). The RPC
    // already trims each tile to {n,s,p,c} and drops money, and excludes recycle-bin
    // restaurants. Counts still come pre-summed from lfh_admin_floor_stats (one tiny row per
    // restaurant, counts only, NO revenue).
    const [restsQ, statsQ, tilesQ] = await Promise.all([
      supabaseAdmin.from("restaurants").select("id, name, slug, active").is("deleted_at", null).order("name").limit(2000),
      supabaseAdmin.rpc("lfh_admin_floor_stats"),
      supabaseAdmin.rpc("lfh_admin_floor_all"),
    ]);
    if (restsQ.error) return adminFail("the live floor", restsQ.error, { action: "load" });
    const rests = restsQ.data ?? [];
    type StatRow = { restaurant_id: string; orders_today: number; active_orders: number; unpaid_orders: number; paid_today: number; cancelled_today: number };
    const statsBy = new Map(((statsQ.data as StatRow[] | null) ?? []).map((s) => [s.restaurant_id, s]));
    type Tile = { n: string; s: string; p: string; c: boolean };
    type FloorRow = { restaurant_id: string; tables: Tile[] };
    const tilesBy = new Map(((tilesQ.data as FloorRow[] | null) ?? []).map((f) => [f.restaurant_id, f.tables || []]));
    const floors = rests.map((r) => {
      const st = statsBy.get(r.id);
      return {
        id: r.id, name: r.name, slug: r.slug, active: !!r.active,
        tables: tilesBy.get(r.id) ?? [],
        ordersToday: Number(st?.orders_today) || 0,
        activeOrders: Number(st?.active_orders) || 0,
        unpaidOrders: Number(st?.unpaid_orders) || 0,
        paidToday: Number(st?.paid_today) || 0,
        cancelledToday: Number(st?.cancelled_today) || 0,
        error: null as string | null,
      };
    });
    // Never fake zeros: if a stats/tiles RPC failed (e.g. a DB missing a migration), say so
    // instead of silently rendering 0 orders / empty floors everywhere.
    if (statsQ.error) console.error("[admin/floor] order counts unavailable:", statsQ.error.message);
    if (tilesQ.error) console.error("[admin/floor] live tables unavailable:", tilesQ.error.message);
    return NextResponse.json({
      restaurants: floors,
      generatedAt: new Date().toISOString(),
      // SAY IT IN WORDS, NOT IN POSTGRES (T19 sweep #7, 2026-09-01). These two fields carried the
      // database's own sentence and app/aevinite/floor/page.tsx prints them inside its banner, so the
      // Live floor could read "Order counts unavailable (function lfh_admin_floor_stats(unknown) does
      // not exist)". That is the same fault lib/adminFail was written for, on the eight screens fixed
      // in sweep #6 — this was the ninth, wearing a different field name. The raw text still goes to
      // the server log, where it is searchable and useful.
      statsError: statsQ.error ? "couldn't be read just now" : null,
      tilesError: tilesQ.error ? "couldn't be read just now" : null,
    });
  }

  // ── ONE restaurant's floor. `restaurant_id` is REQUIRED, and that is the whole point of this
  // block. `lfh_floor_state` declares `p_restaurant_id uuid DEFAULT <restaurant #1>` — a leftover
  // from the tenancy migration, when a default was how every existing caller kept working. Calling
  // it with no argument therefore did not fail; it quietly answered with FRENCH HOUSE'S FLOOR, for
  // whichever restaurant the admin thought they were looking at. Nothing reached this branch today
  // (the console's only caller uses ?all=1), so nobody had been shown the wrong tables — but it was
  // one new caller away, and a wrong floor is the kind of mistake that reads as real data.
  //
  // Now it names the restaurant, and refuses without one, exactly like every other per-restaurant
  // admin read (see /api/admin/oplog, /api/admin/audit, /api/admin/repair). Guarded by
  // scripts/verify-rpc-scoped.mjs, which fails if any call site omits an RPC's p_restaurant_id.
  const rid = req.nextUrl.searchParams.get("restaurant_id");
  if (!rid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid)) {
    return NextResponse.json(
      { error: "restaurant_id is required — say which restaurant's floor you want, or use ?all=1 for every restaurant." },
      { status: 400 },
    );
  }
  const { data, error } = await supabaseAdmin.rpc("lfh_floor_state", { p_restaurant_id: rid });
  if (error) {
    return adminFail("the live floor", error, { action: "load" });
  }
  // lfh_floor_state returns a JSON array of per-table objects.
  return NextResponse.json({ tables: data ?? [] });
}
