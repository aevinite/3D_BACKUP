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
  // ?restaurant_id scopes ALL three lists to ONE restaurant — the admin Logs page's
  // restaurant filter passes it so the Customers tab shows just that tenant (the DB
  // still keeps everyone's rows; this is only the admin's view). Validate the id
  // before it hits a uuid column (a malformed id would 500 with a raw Postgres error).
  const rid = new URL(req.url).searchParams.get("restaurant_id");
  if (rid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid))
    return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });
  try {
    // The guest/customer/blocklist lists are independent — read them in parallel.
    // (session_members carries restaurant_id so we can tag each row with its restaurant;
    // customers/blocklist keep select(*) — they carry no money column, only contact info.)
    let membersQ = sb.from("session_members")
      .select("id, name, phone, phone_verified, role, approved, removed, location_ok, joined_at, restaurant_id, session:sessions(table_number, status)")
      .order("joined_at", { ascending: false }).limit(120);
    let customersQ = sb.from("customers").select("*").order("last_seen_at", { ascending: false }).limit(120);
    let blocklistQ = sb.from("blocklist").select("*").order("blocked_at", { ascending: false }).limit(200);
    if (rid) {
      membersQ = membersQ.eq("restaurant_id", rid);
      customersQ = customersQ.eq("restaurant_id", rid);
      blocklistQ = blocklistQ.eq("restaurant_id", rid);
    }
    const [members, customers, blocklist] = await Promise.all([membersQ, customersQ, blocklistQ]);
    const memberRows = members.data ?? [];
    const custRows = customers.data ?? [];
    const blockRows = blocklist.data ?? [];

    // Order/call counts: fetch ONLY for the members we're actually showing (scoped by their
    // ids). The old code took the 400 most-recent rows platform-wide, so a member whose orders
    // fell outside that window showed fewer orders than reality ("2" when they had 5) on a busy
    // multi-restaurant day. No `total` — the admin counts orders, never sees per-order money.
    const memberIds = memberRows.map((m) => m.id).filter(Boolean);
    const [orders, calls] = memberIds.length
      ? await Promise.all([
          sb.from("orders").select("member_id, created_at").in("member_id", memberIds),
          sb.from("waiter_calls").select("member_id, note, created_at").in("member_id", memberIds),
        ])
      : [{ data: [] }, { data: [] }];

    // Stamp each row with its restaurant name so the admin (who sees every restaurant at
    // once) can tell tenants apart instead of one indistinguishable jumble.
    const rids = Array.from(new Set([
      ...memberRows.map((m) => m.restaurant_id),
      ...custRows.map((c) => (c as { restaurant_id?: string }).restaurant_id),
      ...blockRows.map((b) => (b as { restaurant_id?: string }).restaurant_id),
    ].filter(Boolean))) as string[];
    const nameById = new Map<string, string>();
    if (rids.length) {
      const rest = await sb.from("restaurants").select("id, name").in("id", rids);
      for (const x of rest.data ?? []) nameById.set(x.id, x.name);
    }
    const tag = <T extends { restaurant_id?: string | null }>(r: T) =>
      ({ ...r, restaurant_name: r.restaurant_id ? nameById.get(r.restaurant_id) ?? null : null });

    return NextResponse.json({
      members: memberRows.map(tag),
      customers: custRows.map((c) => tag(c as { restaurant_id?: string | null })),
      blocklist: blockRows.map((b) => tag(b as { restaurant_id?: string | null })),
      orders: orders.data ?? [], calls: calls.data ?? [],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
