// Kitchen API — the kitchen/server.js surface, ported into one Next catch-all so
// it runs inside the single app (no separate :4002 server). Faithful to the
// original: same paths (under /api/kitchen/*), shapes, and rollup logic. Uses the
// server-only service-role client. The kitchen UI calls fetch("/api/kitchen"+path).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

const nowIso = () => new Date().toISOString();
 
const must = (r: any) => { if (r.error) throw new Error(r.error.message); return r.data; };
 
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
 
async function readBody(req: NextRequest): Promise<any> { try { return await req.json(); } catch { return {}; } }

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET /api/kitchen/board — today's live orders + items + dishes ────────────
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    if (path.join("/") === "board") {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const [orders, items, dishes] = await Promise.all([
        sb.from("orders").select("*").gte("created_at", since.toISOString()).eq("archived", false).order("created_at", { ascending: true }),
        sb.from("order_items").select("*").gte("created_at", since.toISOString()).order("created_at", { ascending: true }),
        sb.from("menu_items").select("id,title,category,tags").order("category"),
      ]);
      return ok({ orders: must(orders), items: must(items), dishes: must(dishes) });
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST: accept / ready / item status / sold-out ────────────────────────────
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);

    // orders/:id/accept — everything not served → preparing
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
       
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).select());
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("status", "received");
      await logAction("kitchen", "order_accept", { order_id: b });
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()));
    }

    // orders/:id/ready — everything → served, order complete
    if (a === "orders" && c === "ready") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
       
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).select());
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b);
      await logAction("kitchen", "order_ready", { order_id: b });
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()));
    }

    // items/:id/status — one dish ready/back, with order rollup
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
       
      const patch: any = { status };
      if (status === "served") patch.served_at = nowIso();
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).select());
      const item = updated[0];
      if (item && item.order_id) {
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id));
         
        const served = rows.filter((r: any) => r.status === "served").length;
         
        const anyActive = rows.some((r: any) => r.status === "preparing" || r.status === "served");
        const overall = served === rows.length && rows.length > 0 ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: overall }).eq("id", item.order_id);
      }
      return ok(item || null);
    }

    // dishes/:id/sold-out — toggle the 'sold-out' tag (the 86 board)
    if (a === "dishes" && c === "sold-out") {
      const value = !!(body && body.value === true);
      const cur = must(await sb.from("menu_items").select("tags").eq("id", b).single());
       
      const tags = Array.isArray(cur.tags) ? cur.tags.filter((t: string) => t !== "sold-out") : [];
      if (value) tags.push("sold-out");
      const row = must(await sb.from("menu_items").update({ tags }).eq("id", b).select());
      await logAction("kitchen", value ? "sold_out_on" : "sold_out_off", { detail: b });
      return ok(row[0] || null);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
