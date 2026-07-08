// Kitchen API — the kitchen/server.js surface, ported into one Next catch-all so
// it runs inside the single app (no separate :4002 server). Faithful to the
// original: same paths (under /api/kitchen/*), shapes, and rollup logic. Uses the
// server-only service-role client. The kitchen UI calls fetch("/api/kitchen"+path).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { logAction, deviceIdFrom, deviceBlocked } from "@/lib/oplog";
import { liveOrdersAndItems } from "@/lib/liveBoard";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { notifyAggregator } from "@/lib/aggregators";
import { panelRestaurantId } from "@/lib/panelScope";
import { raiseIssue } from "@/lib/issues";

export const dynamic = "force-dynamic";

// Gate: only a logged-in KITCHEN user (or the admin super-user) may touch this.
async function gate(req: NextRequest): Promise<{ user: StaffUser | null } | NextResponse> {
  const g = await requireRole(req, "kitchen");
  // transient = the auth lookup itself failed (DB blip) — 503 keeps the panel logged
  // in and retrying; only a genuinely bad/expired cookie gets the 401 → /login bounce.
  if (!g.ok) {
    return g.transient
      ? NextResponse.json({ error: "Server can't reach the database — retrying." }, { status: 503 })
      : NextResponse.json({ error: "Not authorised — please log in." }, { status: 401 });
  }
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
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  try {
    const { path = [] } = await ctx.params;

    // whoami — boot signal for the kitchen's hierarchy X-ray ribbon (Phase 4,
    // 2026-07-06). The kitchen has no permission-gated actions (yet), so this only
    // drives the "Admin view" marker; add capability maps here when kitchen gets any.
    if (path.join("/") === "whoami") {
      const actor = g.user ? g.user.role : "admin"; // no staff cookie = admin super-user
      return ok({ actor, higherView: !g.user }); // admin-only, like the tablet's
    }

    if (path.join("/") === "board") {
      // TARGETED REFETCH (owner 2026-06-26 — egress cut): when a realtime breadcrumb names
      // ONE table, the kitchen asks for just that table's orders+items (?table=N) instead of
      // re-reading the whole board. Dishes/platform/settings are table-agnostic and a
      // platform/menu event always forces a FULL pass, so a targeted slice returns ONLY
      // { orders, items } — the panel merges them into the cached board. No param = full board.
      const tbl = new URL(req.url).searchParams.get("table");
      if (tbl) {
        // activeOnly=true: the kitchen board only shows received/preparing orders (a served
        // one has left the board), so we filter server-side — no point shipping served rows.
        const live = await liveOrdersAndItems(rid, [tbl], true);
        return ok({ orders: live.orders, items: live.items });
      }
      // Orders + dishes from the shared "live board" helper — today's tickets PLUS
      // any still-open session's, so a dish left cooking on an overnight table keeps
      // showing here (and matches the manager). Was a day-clipped fetch before.
      const [live, dishes, platform, settings, restaurant] = await Promise.all([
        liveOrdersAndItems(rid, undefined, true), // activeOnly: received/preparing only (board never shows served)
        sb.from("menu_items").select("id,title,category,tags").eq("restaurant_id", rid).order("category").limit(2000),
        // active platform (Zomato/Swiggy/takeaway) tickets — separate table, so dine-in is untouched.
        // Explicit columns (egress): the kitchen renders source/items/status/kot_no/created_at/
        // customer_name and NEVER reads `payload` (the raw webhook JSON) or `status_history` — the
        // two big JSON columns — so we drop ONLY those and keep every small column (verified unused
        // in the route + kitchen/app.js, so the board looks identical). (owner 2026-06-29)
        sb.from("aggregator_orders").select("id, source, external_id, status, order_id, created_at, customer_name, customer_phone, items, total, kot_no, accepted_at, accepted_by, updated_at, restaurant_id").eq("restaurant_id", rid).in("status", ["new", "accepted", "preparing", "ready"]).order("created_at").limit(500),
        sb.from("settings").select("kitchen_can_accept_platform, auto_print_kot, auto_print_kot_allowed").eq("restaurant_id", rid).maybeSingle(),
        // THIS restaurant's identity, so the kitchen header shows which restaurant the
        // panel is scoped to (multi-tenant — never a hardcoded brand). Single-row PK lookup.
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color").eq("id", rid).maybeSingle(),
      ]);
      return ok({
        orders: live.orders, items: live.items, dishes: must(dishes),
        platform: must(platform) || [],
        platformAccept: !!(must(settings) || {}).kitchen_can_accept_platform,
        // Auto-print KOT is ON only when the ADMIN allowed it AND the owner toggled it on
        // (mig 107). The kitchen panel prints a ticket for each brand-new order when true.
        autoPrintKot: !!((must(settings) || {}).auto_print_kot && (must(settings) || {}).auto_print_kot_allowed),
        restaurant: must(restaurant) || null,
      });
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST: accept / ready / item status / sold-out ────────────────────────────
// Wrapped so a replayed offline action runs at most once (see lib/idempotency.ts).
export const POST = withIdempotency(postImpl, "kitchen");
async function postImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which device (kitchen screen) is acting
    // A staff-blocked device can't do anything from the kitchen screen.
    if (await deviceBlocked(dev)) return err("This device has been blocked by staff.", 403);

    // ── Raise an issue / complaint (photo + voice note optional) ────────────────
    // The kitchen flags a problem (equipment, stock…) for THIS restaurant; owner +
    // admin see it. Media is uploaded first via /api/issue-media; the URLs arrive here.
    if (a === "issue") {
      const ib = body as { subject?: string; body?: string; image_url?: string; audio_url?: string };
      try {
        await raiseIssue({
          rid, subject: String(ib?.subject || ""), body: ib?.body,
          raisedBy: g.user?.name || g.user?.username || "Kitchen",
          raisedRole: g.user?.role || "kitchen",
          imageUrl: ib?.image_url, audioUrl: ib?.audio_url,
        });
      } catch (e) { return err(e instanceof Error ? e.message : "Couldn't raise the issue.", 400); }
      return ok({ ok: true });
    }

    // orders/:id/accept — everything not served → preparing
    if (a === "orders" && c === "accept") {
      // .eq(restaurant_id, rid) on EVERY by-id write: sb is the service-role client (RLS
      // bypassed), so this filter is the ONLY tenant boundary — without it a stale/foreign
      // order id would be actioned across restaurants (owner's isolation concern, 2026-07-03).
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());

      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // return=minimal: the client discards the body and re-fetches the board, so we skip
      // BOTH the .select() on the update and the full-row re-read (server↔DB egress saver).
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      await logAction("kitchen", "order_accept", { order_id: b, device_id: dev });
      return ok({ ok: true });
    }

    // orders/:id/ready — kitchen finished the whole order: every dish → READY
    // (cooked, waiting for the waiter to carry it out). NOT served — serving is
    // the waiter's action on the tablet. Order stays "preparing" until served.
    if (a === "orders" && c === "ready") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "ready" })) : [];
      // return=minimal: client discards the body and re-fetches the board → skip the full-row re-read.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "ready" }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await logAction("kitchen", "order_ready", { order_id: b, device_id: dev });
      return ok({ ok: true });
    }

    // items/:id/status — one dish moved along, with order rollup. The kitchen
    // sends "ready" (cooked); the tablet sends "served" (delivered).
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "ready", "served"].includes(status)) return err("invalid status");

      const patch: any = { status };
      if (status === "served") patch.served_at = nowIso();
      // Only need order_id to roll the parent up; the client discards the body → no full row.
      // Scoped by rid so a foreign dish id can't be advanced (service-role bypasses RLS).
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).eq("restaurant_id", rid).select("order_id"));
      const item = updated[0];
      if (item && item.order_id) {
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id).eq("restaurant_id", rid));

        const served = rows.filter((r: any) => r.status === "served").length;

        const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
        const overall = served === rows.length && rows.length > 0 ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: overall }).eq("id", item.order_id).eq("restaurant_id", rid);
      }
      return ok({ ok: true });
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
      // lfh_platform_set_status updates by id with NO tenant scope (mig 071), so confirm
      // this platform order belongs to THIS restaurant first (service-role bypasses RLS).
      const owns = must(await sb.from("aggregator_orders").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!owns) return err("That platform order isn't for this restaurant.", 404);
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
      const cur = must(await sb.from("menu_items").select("tags").eq("id", b).eq("restaurant_id", rid).single());

      const tags = Array.isArray(cur.tags) ? cur.tags.filter((t: string) => t !== "sold-out") : [];
      if (value) tags.push("sold-out");
      const row = must(await sb.from("menu_items").update({ tags }).eq("id", b).eq("restaurant_id", rid).select());
      await logAction("kitchen", value ? "sold_out_on" : "sold_out_off", { detail: b, device_id: dev });
      return ok(row[0] || null);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
