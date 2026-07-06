// GET /api/admin/custlog — the CUSTOMER log for the admin's Logs page: guests in
// sessions, returning customers, the blocklist, plus each member's orders/calls so
// the admin can show "who did what" exactly like the manager's guest log. Admin-gated.
// (Mirrors the manager's /api/editor/users so both panels render the same data.)
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    // Run all five reads in parallel — they're independent, so this is ~one round
    // trip instead of five (the sequential version took ~1.8s).
    const [members, customers, blocklist, orders, calls] = await Promise.all([
      sb.from("session_members")
        .select("id, name, phone, phone_verified, role, approved, removed, location_ok, joined_at, session:sessions(table_number, status)")
        .order("joined_at", { ascending: false }).limit(120),
      sb.from("customers").select("*").order("last_seen_at", { ascending: false }).limit(120),
      sb.from("blocklist").select("*").order("blocked_at", { ascending: false }).limit(200),
      // No `total` (bug H3, 2026-07-06): the admin Logs page only counts orders per member;
      // it must not receive per-order money. Dropping the column keeps the payload honest.
      sb.from("orders").select("member_id, created_at").not("member_id", "is", null).order("created_at", { ascending: false }).limit(400),
      sb.from("waiter_calls").select("member_id, note, created_at").not("member_id", "is", null).order("created_at", { ascending: false }).limit(400),
    ]);
    return NextResponse.json({
      members: members.data ?? [], customers: customers.data ?? [], blocklist: blocklist.data ?? [],
      orders: orders.data ?? [], calls: calls.data ?? [],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
