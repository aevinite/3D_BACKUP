// Tablet API — the tablet/server.js surface, ported into one Next catch-all so it
// runs inside the single app (no separate :4003 server). Faithful to the
// original: same paths (under /api/tablet/*), shapes, and the service-role
// pricing RPC. The tablet UI calls fetch("/api/tablet"+path).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const nowIso = () => new Date().toISOString();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const must = (r: any) => { if (r.error) throw new Error(r.error.message); return r.data; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readBody(req: NextRequest): Promise<any> { try { return await req.json(); } catch { return {}; } }

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET /api/tablet/state — everything the tablet floor needs in one call ─────
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    if (path.join("/") === "state") {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const [settings, sessions, members, orders, calls, dishes, categories] = await Promise.all([
        sb.from("settings").select("*").eq("id", "site").maybeSingle(),
        sb.from("sessions").select("*").neq("status", "closed"),
        sb.from("session_members").select("*").eq("removed", false),
        sb.from("orders").select("*").gte("created_at", since.toISOString()).eq("archived", false).order("created_at"),
        sb.from("waiter_calls").select("*").eq("resolved", false),
        sb.from("menu_items").select("id,title,price,category,tags,veg").order("category"),
        sb.from("categories").select("slug,name,icon,sort_order,active").order("sort_order"),
      ]);
      return ok({
        settings: must(settings), sessions: must(sessions), members: must(members),
        orders: must(orders), calls: must(calls), dishes: must(dishes), categories: must(categories),
      });
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST: place order / attend call / approve member / open session ──────────
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);

    // order — server-side priced via lfh_staff_place_order (never trusts prices)
    if (a === "order" && path.length === 1) {
      const { table, items, allergies, note } = body || {};
      const t = String(table || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (!Array.isArray(items) || !items.length) return err("items required");
      const { data, error } = await sb.rpc("lfh_staff_place_order", {
        p_table: t, p_items: items, p_allergies: Array.isArray(allergies) ? allergies : [], p_note: note || null,
      });
      if (error) throw new Error(error.message);
      return ok(data);
    }

    // calls/:id/attend
    if (a === "calls" && c === "attend") {
      const row = must(await sb.from("waiter_calls").update({ resolved: true }).eq("id", b).select());
      return ok(row[0] || null);
    }

    // members/:id/approve
    if (a === "members" && c === "approve") {
      const row = must(await sb.from("session_members").update({ approved: true }).eq("id", b).select());
      return ok(row[0] || null);
    }

    // sessions/open
    if (a === "sessions" && b === "open") {
      const t = String((body && body.table) || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const existing = must(await sb.from("sessions").select("id").eq("table_number", t).neq("status", "closed").limit(1));
      if (existing.length) return ok(existing[0]);
      const row = must(await sb.from("sessions").insert({ table_number: t, status: "open", opened_by: "waiter", opened_at: nowIso() }).select());
      return ok(row[0] || null);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
