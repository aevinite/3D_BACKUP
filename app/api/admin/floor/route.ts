// GET /api/admin/floor — the live floor, straight from the ONE brain.
//
// This calls lfh_floor_state() (migration 041), which decides every table's
// status in one place. Because every staff/admin screen reads THIS, they can
// never disagree. Runs on the server with the service-role key (the function is
// staff-only / revoked from the public key).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

// Always fetch fresh — the floor is live, never cached.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ?all=1 — EVERY restaurant's floor at once (owner 2026-07-04: the admin live
  // floor must show the whole platform "like a year calendar", not just one
  // restaurant). One fan-out on the pooled server connection; the payload is
  // trimmed to the 4 fields the mini-tiles render so 12 × 300 tables stays tiny.
  // The page refreshes this on a calm timer (no per-event realtime — a platform-
  // wide firehose would refetch the fan-out on every order anywhere).
  if (req.nextUrl.searchParams.get("all") === "1") {
    const restsQ = await supabaseAdmin
      .from("restaurants").select("id, name, slug, active").order("name");
    if (restsQ.error) return NextResponse.json({ error: restsQ.error.message }, { status: 500 });
    const rests = restsQ.data ?? [];
    const floors = await Promise.all(rests.map(async (r) => {
      const { data, error } = await supabaseAdmin.rpc("lfh_floor_state", { p_restaurant_id: r.id });
      type Row = { table_number: string; state: string; pay: string; has_call: boolean };
      const tables = error ? [] : ((data as Row[] | null) ?? []).map((t) => ({
        n: t.table_number, s: t.state, p: t.pay || "", c: !!t.has_call,
      }));
      return { id: r.id, name: r.name, slug: r.slug, active: !!r.active, tables, error: error?.message || null };
    }));
    return NextResponse.json({ restaurants: floors });
  }

  const { data, error } = await supabaseAdmin.rpc("lfh_floor_state");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // lfh_floor_state returns a JSON array of per-table objects.
  return NextResponse.json({ tables: data ?? [] });
}
