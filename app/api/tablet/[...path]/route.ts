// Tablet API — the tablet/server.js surface, ported into one Next catch-all so it
// runs inside the single app (no separate :4003 server). Faithful to the
// original: same paths (under /api/tablet/*), shapes, and the service-role
// pricing RPC. The tablet UI calls fetch("/api/tablet"+path).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction } from "@/lib/oplog";
import { businessDayStartIso } from "@/lib/businessDay";

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
      const since = businessDayStartIso();
      const [settings, sessions, members, orders, items, calls, dishes, categories, requests] = await Promise.all([
        sb.from("settings").select("*").eq("id", "site").maybeSingle(),
        sb.from("sessions").select("*").neq("status", "closed"),
        sb.from("session_members").select("*").eq("removed", false),
        sb.from("orders").select("*").gte("created_at", since).eq("archived", false).order("created_at"),
        // Per-dish rows (the same table the kitchen advances). Lets the tablet show
        // and advance each dish's status (new → cooking → served), not just the order.
        sb.from("order_items").select("*").gte("created_at", since).order("created_at").order("id"),
        sb.from("waiter_calls").select("*").eq("resolved", false),
        sb.from("menu_items").select("id,title,price,category,tags,veg,options").order("category"),
        sb.from("categories").select("slug,name,icon,sort_order,active").order("sort_order"),
        sb.from("requests").select("*").eq("status", "pending").order("created_at"),
      ]);
      return ok({
        settings: must(settings), sessions: must(sessions), members: must(members),
        orders: must(orders), items: must(items), calls: must(calls), dishes: must(dishes),
        categories: must(categories), requests: must(requests),
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

    // items/:id/status — advance ONE dish (received→preparing→served) from the
    // tablet, then roll the parent order's overall status up. Mirrors the kitchen
    // endpoint exactly so kitchen + tablet stay perfectly consistent.
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
      await logAction("tablet", "item_status", { detail: status });
      return ok(item || null);
    }

    // orders/:id/accept — accept a (often phone/online) order: everything not yet
    // served → preparing, so it shows up on the kitchen pass. Mirrors the kitchen.
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
      const its = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      must(await sb.from("orders").update({ items: its, status: "preparing" }).eq("id", b).select());
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("status", "received");
      await logAction("tablet", "order_accept", { order_id: b });
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()));
    }

    // orders/:id/move — move a SINGLE order (and its dish rows) to another table's
    // open session. Distinct from sessions/:id/shift (which moves the whole party).
    if (a === "orders" && c === "move") {
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to)) return err("valid target table required");
      // Find (or open) the target table's session, then re-home the order onto it.
      let target = (must(await sb.from("sessions").select("id").eq("table_number", to).neq("status", "closed").limit(1)))[0];
      if (!target) target = (must(await sb.from("sessions").insert({ table_number: to, status: "open", opened_by: "waiter", opened_at: nowIso() }).select()))[0];
      const moved = must(await sb.from("orders").update({ table_number: to, session_id: target.id }).eq("id", b).select());
      await sb.from("order_items").update({ session_id: target.id }).eq("order_id", b);
      // The target now has an order, so make sure it has a bill number (the bill
      // trigger only fires on INSERT, not on this move — assign it if missing).
      const tb = (must(await sb.from("sessions").select("bill_no").eq("id", target.id).limit(1)))[0];
      if (tb && tb.bill_no == null) {
        try { const { data: bn } = await sb.rpc("lfh_next_counter", { p_key: "bill" }); if (bn != null) await sb.from("sessions").update({ bill_no: bn }).eq("id", target.id).is("bill_no", null); } catch { /* bill stays lazy if the counter isn't callable */ }
      }
      await logAction("tablet", "order_move", { order_id: b, table_number: to });
      return ok(moved[0] || null);
    }

    // sessions/:id/close — free the table (end the dining session). Mirrors the
    // editor's close: mark the session closed; the floor immediately shows it free.
    if (a === "sessions" && c === "close") {
      const sess = (must(await sb.from("sessions").select("table_number").eq("id", b).limit(1)))[0];
      const row = must(await sb.from("sessions").update({ status: "closed", closed_at: nowIso() }).eq("id", b).select());
      await logAction("tablet", "table_close", { table_number: sess ? sess.table_number : null });
      return ok(row[0] || null);
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
