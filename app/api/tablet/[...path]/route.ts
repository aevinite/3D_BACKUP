// Tablet API — the tablet/server.js surface, ported into one Next catch-all so it
// runs inside the single app (no separate :4003 server). Faithful to the
// original: same paths (under /api/tablet/*), shapes, and the service-role
// pricing RPC. The tablet UI calls fetch("/api/tablet"+path).

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

// ── GET /api/tablet/state — everything the tablet floor needs in one call ─────
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    if (path.join("/") === "state") {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const [settings, sessions, members, orders, calls, dishes, categories, requests] = await Promise.all([
        sb.from("settings").select("*").eq("id", "site").maybeSingle(),
        sb.from("sessions").select("*").neq("status", "closed"),
        sb.from("session_members").select("*").eq("removed", false),
        sb.from("orders").select("*").gte("created_at", since.toISOString()).eq("archived", false).order("created_at"),
        sb.from("waiter_calls").select("*").eq("resolved", false),
        sb.from("menu_items").select("id,title,price,category,tags,veg,options").order("category"),
        sb.from("categories").select("slug,name,icon,sort_order,active").order("sort_order"),
        sb.from("requests").select("*").eq("status", "pending").order("created_at"),
      ]);
      return ok({
        settings: must(settings), sessions: must(sessions), members: must(members),
        orders: must(orders), calls: must(calls), dishes: must(dishes), categories: must(categories),
        requests: must(requests),
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
      await logAction("tablet", "order_place", { table_number: t });
      return ok(data);
    }

    // requests/:id/resolve — approve/deny a guest's open/join request (approving
    // an "open" request opens that table). Mirrors the editor.
    if (a === "requests" && c === "resolve") {
      const status = body && body.status;
      if (!["approved", "denied"].includes(status)) return err("invalid status");
      const reqRow = must(await sb.from("requests").update({ status }).eq("id", b).select())[0];
      if (status === "approved" && reqRow && reqRow.type === "open") {
        const existing = must(await sb.from("sessions").select("id").eq("table_number", reqRow.table_number).neq("status", "closed").limit(1));
        if (!existing.length) must(await sb.from("sessions").insert({ table_number: reqRow.table_number, status: "open", opened_by: "waiter", opened_at: nowIso() }));
      }
      return ok(reqRow || null);
    }

    // calls/:id/attend
    if (a === "calls" && c === "attend") {
      const row = must(await sb.from("waiter_calls").update({ resolved: true }).eq("id", b).select());
      await logAction("tablet", "call_attend", { table_number: row[0]?.table_number ?? null });
      return ok(row[0] || null);
    }

    // members/:id/approve
    if (a === "members" && c === "approve") {
      const row = must(await sb.from("session_members").update({ approved: true }).eq("id", b).select());
      return ok(row[0] || null);
    }

    // members/:id/make-head — transfer the table head to another member (kick the
    // current head, promote this one). Mirrors the editor's make-head.
    if (a === "members" && c === "make-head") {
      const found = must(await sb.from("session_members").select("id,session_id,role,removed").eq("id", b).limit(1));
      const m = found[0];
      if (!m) return err("member not found", 404);
      const sessRows = must(await sb.from("sessions").select("status").eq("id", m.session_id).limit(1));
      if (!sessRows[0] || sessRows[0].status !== "open") return err("table is not open");
      if (m.role === "owner" && !m.removed) return ok(m);
      must(await sb.from("session_members").update({ removed: true }).eq("session_id", m.session_id).eq("role", "owner").eq("removed", false).select());
      const row = must(await sb.from("session_members").update({ role: "owner", approved: true, removed: false }).eq("id", b).select());
      return ok(row[0] || null);
    }

    // sessions/:id/shift — move the whole party (session + orders + calls) to
    // another table, atomically, via the service-role RPC.
    if (a === "sessions" && c === "shift") {
      const to = String((body && body.to) || "").trim();
      const { data, error } = await sb.rpc("lfh_staff_shift_table", { p_session: b, p_to: to });
      if (error) throw new Error(error.message);
      return ok(data);
    }

    // sessions/open
    if (a === "sessions" && b === "open") {
      const t = String((body && body.table) || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const existing = must(await sb.from("sessions").select("id").eq("table_number", t).neq("status", "closed").limit(1));
      if (existing.length) return ok(existing[0]);
      const row = must(await sb.from("sessions").insert({ table_number: t, status: "open", opened_by: "waiter", opened_at: nowIso() }).select());
      await logAction("tablet", "table_open", { table_number: t });
      return ok(row[0] || null);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
