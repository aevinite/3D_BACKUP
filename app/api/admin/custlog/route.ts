// GET /api/admin/custlog — the CUSTOMER log for the admin's Logs page: guests in
// sessions, returning customers, the blocklist, plus each member's orders/calls so
// the admin can show "who did what" exactly like the manager's guest log. Admin-gated.
// (Mirrors the manager's /api/editor/users so both panels render the same data.)
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";

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
    // The guest + blocklist lists are independent — read them in parallel.
    // (session_members carries restaurant_id so we can tag each row with its restaurant;
    // blocklist keeps select(*) — it carries no money column, only contact info.)
    // NB: the `customers` table used to be fetched here too but the Logs page never rendered
    // it (CustData = members/blocklist/orders/calls) — dropped to stop shipping an unused
    // 120-row payload on every load (audit 2026-07-23).
    let membersQ = sb.from("session_members")
      .select("id, name, phone, phone_verified, role, approved, removed, location_ok, joined_at, restaurant_id, session:sessions(table_number, status)")
      .order("joined_at", { ascending: false }).limit(120);
    let blocklistQ = sb.from("blocklist").select("*").order("blocked_at", { ascending: false }).limit(200);
    if (rid) {
      membersQ = membersQ.eq("restaurant_id", rid);
      blocklistQ = blocklistQ.eq("restaurant_id", rid);
    }
    const [members, blocklist] = await Promise.all([membersQ, blocklistQ]);
    // Surface a failed read — otherwise a broken query shows an EMPTY customer log ("no
    // customers") with a 200 instead of an error the page can retry (audit).
    const cErr = members.error || blocklist.error;
    // PLAIN WORDS FOR THE CONSOLE (sweep #6, T19). This answered with the database's own
    // sentence, so a failure here read as e.g. `relation "…" does not exist` in a red toast —
    // right for a developer, useless on the screen the owner runs his platform from. adminFail
    // keeps the raw text where it is actually useful (the response `detail` and the server log)
    // and gives the screen a sentence that names the thing and says whether anything changed.
    if (cErr) return adminFail("the customer log", cErr, { action: "load" });
    const memberRows = members.data ?? [];
    const blockRows = blocklist.data ?? [];

    // Order/call counts: fetch ONLY for the members we're actually showing (scoped by their
    // ids). The old code took the 400 most-recent rows platform-wide, so a member whose orders
    // fell outside that window showed fewer orders than reality ("2" when they had 5) on a busy
    // multi-restaurant day. No `total` — the admin counts orders, never sees per-order money.
    //
    // AND THE SAME BUG WAS STILL HERE, one layer down (sweep #6, T19). Scoping by member id fixed
    // WHICH rows are asked for; it did nothing about HOW MANY come back. Neither read stated a
    // ceiling, so both stopped at PostgREST's own cap — and 120 members on a busy day is well past
    // it. The rows that fell off the end were simply not counted, which is the very symptom the
    // note above says was fixed: a guest showing fewer orders than they really made, on the screen
    // the admin uses to answer "who did what". A hidden ceiling gives a wrong number silently; an
    // explicit one that is far above anything real gives the right one. 120 members × 60 orders is
    // a heavier day than either table has ever seen.
    const MEMBER_ROW_CAP = 8000;
    const memberIds = memberRows.map((m) => m.id).filter(Boolean);
    const [orders, calls] = memberIds.length
      ? await Promise.all([
          sb.from("orders").select("member_id, created_at").in("member_id", memberIds).limit(MEMBER_ROW_CAP),
          sb.from("waiter_calls").select("member_id, note, created_at").in("member_id", memberIds).limit(MEMBER_ROW_CAP),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    // Same rule as the reads above: plain words on the screen, the raw text in the log.
    if (orders.error || calls.error)
      return adminFail("the customer log", (orders.error || calls.error)!, { action: "load" });

    // Stamp each row with its restaurant name so the admin (who sees every restaurant at
    // once) can tell tenants apart instead of one indistinguishable jumble.
    const rids = Array.from(new Set([
      ...memberRows.map((m) => m.restaurant_id),
      ...blockRows.map((b) => (b as { restaurant_id?: string }).restaurant_id),
    ].filter(Boolean))) as string[];
    const nameById = new Map<string, string>();
    if (rids.length) {
      const rest = await sb.from("restaurants").select("id, name").in("id", rids).limit(2000);
      for (const x of rest.data ?? []) nameById.set(x.id, x.name);
    }
    const tag = <T extends { restaurant_id?: string | null }>(r: T) =>
      ({ ...r, restaurant_name: r.restaurant_id ? nameById.get(r.restaurant_id) ?? null : null });

    return NextResponse.json({
      members: memberRows.map(tag),
      blocklist: blockRows.map((b) => tag(b as { restaurant_id?: string | null })),
      orders: orders.data ?? [], calls: calls.data ?? [],
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
