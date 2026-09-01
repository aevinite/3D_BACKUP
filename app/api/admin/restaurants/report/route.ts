// GET /api/admin/restaurants/report?restaurant_id=<uuid>&range=today|7d|30d — the
// per-restaurant "Full report" (owner's words: "every single bit" of ONE
// restaurant). NO food revenue (CLAUDE.md hard rule) — everything here is a COUNT
// or an activity-volume proxy, clearly labelled as such. Every query is scoped
// `.eq("restaurant_id", rid)`, explicit columns, head-count where possible so we
// never pull raw rows just to know how many there are. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { businessDayStartIso } from "@/lib/businessDay";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";
// ONE retry for a read that failed for a plumbing reason — see the long note in lib/readRetry.ts.
import { retryRead } from "@/lib/readRetry";

export const dynamic = "force-dynamic";
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function rangeBounds(range: string): { from: Date; to: Date } {
  const now = new Date();
  // "today" = the 05:00-IST business day (same boundary as the Dashboard/Live-floor "orders
  // today"), so this per-restaurant report can't disagree with them for 00:00–05:00 orders.
  if (range === "today") return { from: new Date(businessDayStartIso(now)), to: now };
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const days = range === "30d" ? 29 : 6;
  const fromIst = istMidnight - days * 86400000;
  return { from: new Date(fromIst - IST_OFFSET_MS), to: now };
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const url = new URL(req.url);
  const rid = url.searchParams.get("restaurant_id") || "";
  if (!rid) return bad("restaurant_id required");
  // Validate the shape BEFORE it reaches a uuid column — a malformed id used to surface a
  // raw Postgres "invalid input syntax for type uuid" 500 to the client (audit 2026-07-06).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rid)) return bad("Invalid restaurant_id.");
  const range = url.searchParams.get("range") || "7d";
  const { from, to } = rangeBounds(["today", "7d", "30d"].includes(range) ? range : "7d");
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  // ── WHY EVERY READ ON THIS PAGE IS NOW RETRIED (owner, 2026-08-20) ──────────────────────────
  // T20 listed this route's three swallowed errors as a decision (item 14) and his answer was to
  // go one better: *"i want you fix that hiccup doesn't happen only if you can do the improvement
  // decision also"* — i.e. stop the blip first, and THEN make it say so if it still gets through.
  //
  // Both halves are here. `retryRead` gives every read on this page one more attempt when it fails
  // for a plumbing reason (a dropped pooler connection, a socket hang-up, a 502) — the class that
  // succeeds a moment later, which is what nearly every "hiccup" on this screen actually was. It
  // deliberately does NOT retry a statement timeout or a broken query, because a second identical
  // answer helps nobody and doubles the load that caused it.
  //
  // The improvement is `partial` below: the three reads that used to fail SILENTLY — the owner's
  // name, the plan and the table count — now name themselves when a retry didn't save them, so the
  // screen can say "couldn't read this" instead of drawing "—" and 0, which read as "there isn't
  // one". The admin console had no convention for this; the owner panel has had one since
  // 2026-08-06 (lib/partialRead.ts), and this adopts the same word for the same meaning.
  type RestRow = { id: string; name: string; slug: string; active: boolean; created_at: string | null; owner_user_id: string | null };
  const restQ = (await retryRead<RestRow>(() =>
    sb.from("restaurants").select("id, name, slug, active, created_at, owner_user_id").eq("id", rid).maybeSingle() as PromiseLike<{ data: RestRow | null; error: unknown }>,
  )).result;
  // Plain sentence to the screen, raw text to `detail` + the log — see the note in /api/admin/usage.
  if (restQ.error) return adminFail("this restaurant's full report", restQ.error, { action: "load" });
  if (!restQ.data) return bad("restaurant not found", 404);

  /** One read, retried once on a plumbing failure, unwrapped back to the plain `{data, error}`
   *  shape the rest of this handler already speaks. `count` rides through for the head-counts. */
  type Read = { data: any; error: unknown; count?: number | null };
  const one = async (run: () => PromiseLike<Read>): Promise<Read> => {
    const { result } = await retryRead(run as () => PromiseLike<{ data: unknown; error: unknown }>);
    return result as Read;
  };

  const [
    ownerQ, billingQ, settingsQ,
    ordersCountQ, orderItemsCountQ, activityCountQ, callsCountQ, sessionsCountQ,
    openTablesQ, staffQ, menuItemsCountQ,
    trendQ,
  ] = await Promise.all([
    restQ.data.owner_user_id ? one(() => sb.from("staff_users").select("name, username").eq("id", restQ.data!.owner_user_id).maybeSingle()) : Promise.resolve({ data: null, error: null }),
    one(() => sb.from("restaurant_billing").select("plan, status, cycle, next_due_on").eq("restaurant_id", rid).maybeSingle()),
    one(() => sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle()),
    one(() => sb.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).neq("status", "cancelled").gte("created_at", fromIso).lt("created_at", toIso)),
    one(() => sb.from("order_items").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso)),
    one(() => sb.from("staff_actions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso)),
    one(() => sb.from("waiter_calls").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso)),
    one(() => sb.from("sessions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).gte("created_at", fromIso).lt("created_at", toIso)),
    one(() => sb.from("sessions").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).eq("status", "open")),
    // Bounded (T20 sweep #7, 2026-08-27): `staffTotal` is this read's own row count, so PostgREST's
    // cap was quietly deciding the figure. 2000 matches /api/admin/users' cap and is far above any
    // real restaurant's roll.
    one(() => sb.from("staff_users").select("role").eq("restaurant_id", rid).eq("active", true).limit(2000)),
    one(() => sb.from("menu_items").select("id", { count: "exact", head: true }).eq("restaurant_id", rid)),
    one(() => sb.rpc("lfh_admin_orders_timeseries", { p_restaurant_id: rid, p_from: fromIso, p_to: toIso })),
  ]);
  for (const q of [ordersCountQ, orderItemsCountQ, activityCountQ, callsCountQ, sessionsCountQ, openTablesQ, staffQ, menuItemsCountQ, trendQ]) {
    if (q.error) return adminFail("this restaurant's full report", q.error, { action: "load" });
  }

  const staffByRole: Record<string, number> = {};
  for (const s of staffQ.data || []) staffByRole[s.role] = (staffByRole[s.role] || 0) + 1;

  const ordersInRange = ordersCountQ.count || 0;
  const orderItemsInRange = orderItemsCountQ.count || 0;
  const activityInRange = activityCountQ.count || 0;
  const sessionsInRange = sessionsCountQ.count || 0;
  // "Activity volume" — a clearly-labelled PROXY for per-tenant usage/egress (real
  // DB egress isn't queryable per-tenant): every write-shaped row this restaurant
  // produced in the range. NOT bytes, NOT a billing figure.
  const activityVolume = ordersInRange + orderItemsInRange + activityInRange + sessionsInRange;

  // ── THE THREE THAT USED TO GO QUIET ─────────────────────────────────────────────────────────
  // owner / plan / table count each swallowed their error, so "couldn't read it" drew exactly like
  // "there isn't one": an em dash where an owner's name goes, and 0 tables. They are NOT promoted
  // to a whole-page failure — the rest of the report is perfectly readable and throwing it away for
  // one absent figure is the fault lib/partialRead.ts was written to stop. They name themselves
  // instead, and the screen greys just those.
  const partial: string[] = [];
  if (ownerQ.error) { console.error("[admin/report] owner name read failed:", (ownerQ.error as { message?: string })?.message); partial.push("owner"); }
  if (billingQ.error) { console.error("[admin/report] plan read failed:", (billingQ.error as { message?: string })?.message); partial.push("plan"); }
  if (settingsQ.error) { console.error("[admin/report] table count read failed:", (settingsQ.error as { message?: string })?.message); partial.push("tablesConfigured"); }

  const b = billingQ.error ? null : billingQ.data;

  return NextResponse.json({
    restaurant: {
      id: restQ.data.id, name: restQ.data.name, slug: restQ.data.slug, active: restQ.data.active, createdAt: restQ.data.created_at,
      owner: ownerQ.data ? (ownerQ.data.name || ownerQ.data.username) : null,
      plan: b?.plan || null, planStatus: b?.status || null,
    },
    range,
    // Rides along ONLY when something genuinely went unread, so a healthy report is byte-for-byte
    // what it was before this change.
    ...(partial.length ? { partial } : {}),
    usage: {
      orders: ordersInRange,
      orderItems: orderItemsInRange,
      activityLogEvents: activityInRange,
      waiterCalls: callsCountQ.count || 0,
      sessions: sessionsInRange,
      // null, not 0, when it could not be read — `partial` names it and the screen greys that tile.
      // A confident "0 tables" is the fabricated figure this whole block exists to stop.
      tablesConfigured: settingsQ.error ? null : Number(settingsQ.data?.table_count) || 0,
      tablesOpenNow: openTablesQ.count || 0,
      menuItemCount: menuItemsCountQ.count || 0,
      staffByRole,
      staffTotal: (staffQ.data || []).length,
      activityVolume,
    },
    trend: (trendQ.data || []).map((r: { bucket: string; orders: number }) => ({ day: r.bucket, orders: Number(r.orders) || 0 })),
  });
}
