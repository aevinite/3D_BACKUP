// Kitchen API — the kitchen/server.js surface, ported into one Next catch-all so
// it runs inside the single app (no separate :4002 server). Faithful to the
// original: same paths (under /api/kitchen/*), shapes, and rollup logic. Uses the
// server-only service-role client. The kitchen UI calls fetch("/api/kitchen"+path).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction, deviceIdFrom, deviceBlocked } from "@/lib/oplog";
import { liveOrdersAndItems } from "@/lib/liveBoard";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { notifyAggregator } from "@/lib/aggregators";
import { panelRestaurantId } from "@/lib/panelScope";

export const dynamic = "force-dynamic";

// Gate: only a logged-in KITCHEN user (or the admin super-user) may touch this.
async function gate(req: NextRequest): Promise<{ user: StaffUser | null } | NextResponse> {
  const g = await requireRole(req, "kitchen");
  if (!g.ok) return NextResponse.json({ error: "Not authorised — please log in." }, { status: 401 });
  return { user: g.user };
}
// (panel restaurant scope now comes from lib/panelScope → panelRestaurantId, which
//  also honours the admin's "view as" restaurant.)

const nowIso = () => new Date().toISOString();
 
const must = (r: any) => { if (r.error) throw new Error(r.error.message); return r.data; };
 
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
 
async function readBody(req: NextRequest): Promise<any> { try { return await req.json(); } catch { return {}; } }

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET /api/kitchen/board — today's live orders + items + dishes ────────────
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  try {
    const { path = [] } = await ctx.params;
    if (path.join("/") === "board") {
      // Orders + dishes from the shared "live board" helper — today's tickets PLUS
      // any still-open session's, so a dish left cooking on an overnight table keeps
      // showing here (and matches the manager). Was a day-clipped fetch before.
      const [live, dishes, platform, settings, restaurant] = await Promise.all([
        liveOrdersAndItems(rid),
        sb.from("menu_items").select("id,title,category,tags").eq("restaurant_id", rid).order("category"),
        // active platform (Zomato/Swiggy/takeaway) tickets — separate table, so dine-in is untouched
        sb.from("aggregator_orders").select("*").eq("restaurant_id", rid).in("status", ["new", "accepted", "preparing", "ready"]).order("created_at"),
        sb.from("settings").select("kitchen_can_accept_platform").eq("restaurant_id", rid).maybeSingle(),
        // THIS restaurant's identity, so the kitchen header shows which restaurant the
        // panel is scoped to (multi-tenant — never a hardcoded brand). Single-row PK lookup.
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color").eq("id", rid).maybeSingle(),
      ]);
      return ok({
        orders: live.orders, items: live.items, dishes: must(dishes),
        platform: must(platform) || [],
        platformAccept: !!(must(settings) || {}).kitchen_can_accept_platform,
        restaurant: must(restaurant) || null,
      });
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST: accept / ready / item status / sold-out ────────────────────────────
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which device (kitchen screen) is acting
    // A staff-blocked device can't do anything from the kitchen screen.
    if (await deviceBlocked(dev)) return err("This device has been blocked by staff.", 403);

    // orders/:id/accept — everything not served → preparing
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
       
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // No .select(): the fetched-back row was discarded; we re-read the full row below.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("status", "received");
      await logAction("kitchen", "order_accept", { order_id: b, device_id: dev });
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()));
    }

    // orders/:id/ready — kitchen finished the whole order: every dish → READY
    // (cooked, waiting for the waiter to carry it out). NOT served — serving is
    // the waiter's action on the tablet. Order stays "preparing" until served.
    if (a === "orders" && c === "ready") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "ready" })) : [];
      // No .select(): the fetched-back row was discarded; we re-read the full row below.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b));
      await sb.from("order_items").update({ status: "ready" }).eq("order_id", b).neq("status", "served");
      await logAction("kitchen", "order_ready", { order_id: b, device_id: dev });
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()));
    }

    // items/:id/status — one dish moved along, with order rollup. The kitchen
    // sends "ready" (cooked); the tablet sends "served" (delivered).
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "ready", "served"].includes(status)) return err("invalid status");

      const patch: any = { status };
      if (status === "served") patch.served_at = nowIso();
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).select());
      const item = updated[0];
      if (item && item.order_id) {
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id));

        const served = rows.filter((r: any) => r.status === "served").length;

        const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
        const overall = served === rows.length && rows.length > 0 ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: overall }).eq("id", item.order_id);
      }
      return ok(item || null);
    }

    // platform/:id/status — kitchen advances a platform (Zomato/Swiggy/takeaway)
    // order. ACCEPTING is gated by the manager's "kitchen can accept platform
    // orders" toggle; once it's in the queue, cooking it through is the kitchen's job.
    if (a === "platform" && c === "status") {
      const status = body && body.status;
      if (!["accepted", "preparing", "ready", "handed_over"].includes(status)) return err("invalid status");
      if (status === "accepted") {
        const s = await sb.from("settings").select("kitchen_can_accept_platform").eq("restaurant_id", rid).maybeSingle();
        if (!(s.data && s.data.kitchen_can_accept_platform)) {
          return err("The kitchen isn't allowed to accept platform orders — the manager accepts them.", 403);
        }
      }
      const { data, error } = await sb.rpc("lfh_platform_set_status", { p_id: b, p_status: status, p_by: "kitchen" });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      void notifyAggregator(row?.source, row?.external_id, status); // best-effort push back to the platform (dormant w/o keys)
      await logAction("kitchen", "platform_status", { detail: status, device_id: dev });
      return ok(row);
    }

    // dishes/:id/sold-out — toggle the 'sold-out' tag (the 86 board)
    if (a === "dishes" && c === "sold-out") {
      const value = !!(body && body.value === true);
      const cur = must(await sb.from("menu_items").select("tags").eq("id", b).single());
       
      const tags = Array.isArray(cur.tags) ? cur.tags.filter((t: string) => t !== "sold-out") : [];
      if (value) tags.push("sold-out");
      const row = must(await sb.from("menu_items").update({ tags }).eq("id", b).select());
      await logAction("kitchen", value ? "sold_out_on" : "sold_out_off", { detail: b, device_id: dev });
      return ok(row[0] || null);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
