// Editor API — the whole editor/server.js Express surface, ported into ONE Next
// catch-all route handler so it runs inside the single app (no separate :4001
// server). Faithful to the original: same paths (under /api/editor/*), same
// request/response shapes, same business guards. Uses the server-only
// service-role client.
//
// The editor's browser UI (public/panels/editor/app.js) calls fetch("/api/editor"
// + path), so e.g. /api/editor/all, /api/editor/orders/:id, etc. land here.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic"; // always live, never cached

const nowIso = () => new Date().toISOString();
// Unwrap a Supabase { data, error } reply — throw on error so the catch turns it
// into a clean 500 (mirrors the editor server's `must`).
 
const must = (r: any) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
 
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

const ORDER_STATUSES = ["received", "preparing", "served", "cancelled"];
// Generic CRUD tables: which Supabase table + its unique key.
const TABLES: Record<string, { name: string; key: string }> = {
  items: { name: "menu_items", key: "id" },
  categories: { name: "categories", key: "slug" },
  filters: { name: "filters", key: "slug" },
  settings: { name: "settings", key: "id" },
};

 
async function readBody(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    const p = path.join("/");

    if (p === "all") {
      const [items, categories, filters, settings] = await Promise.all([
        sb.from("menu_items").select("*").order("sort_order"),
        sb.from("categories").select("*").order("sort_order"),
        sb.from("filters").select("*").order("sort_order"),
        sb.from("settings").select("*").eq("id", "site").maybeSingle(),
      ]);
      return ok({
        items: must(items),
        categories: must(categories),
        filters: must(filters),
        settings: must(settings) || { id: "site", bubbles_enabled: true, service_mode: false },
      });
    }

    if (p === "orders") {
      return ok(must(await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(200)));
    }

    if (p === "calls") {
      return ok(must(await sb.from("waiter_calls").select("*").order("created_at", { ascending: false }).limit(100)));
    }

    if (p === "sessions") {
      const sessions = must(
        await sb.from("sessions").select("*").neq("status", "closed").order("last_activity_at", { ascending: false })
      );
       
      const ids = sessions.map((s: any) => s.id);
      const [members, items, requests, blocklist] = await Promise.all([
        ids.length ? sb.from("session_members").select("*").in("session_id", ids).eq("removed", false).order("joined_at") : Promise.resolve({ data: [] }),
        ids.length ? sb.from("order_items").select("*").in("session_id", ids).order("created_at") : Promise.resolve({ data: [] }),
        sb.from("requests").select("*").eq("status", "pending").order("created_at"),
        sb.from("blocklist").select("*").order("blocked_at", { ascending: false }),
      ]);
      return ok({
        sessions,
        members: must(members) || [],
        items: must(items) || [],
        requests: must(requests) || [],
        blocklist: must(blocklist) || [],
      });
    }

    if (p === "stats") {
      // Range: today | 30d | year. Buckets the revenue series by hour / day / month.
      const range = new URL(req.url).searchParams.get("range") || "30d";
      const now = new Date();
      let since: Date;
      if (range === "today") { since = new Date(); since.setHours(0, 0, 0, 0); }
      else if (range === "year") { since = new Date(now.getFullYear(), now.getMonth() - 11, 1); }
      else { since = new Date(Date.now() - 29 * 864e5); since.setHours(0, 0, 0, 0); }

      const [ordersQ, dishesQ] = await Promise.all([
        sb.from("orders").select("id,total,discount,status,payment_status,created_at,items").gte("created_at", since.toISOString()),
        sb.from("menu_items").select("id,title,category"),
      ]);
      const orders = must(ordersQ), dishes = must(dishesQ);
      const catOf: Record<string, string> = Object.fromEntries(dishes.map((d: { id: string; category?: string }) => [d.id, d.category || "other"]));
      const hours = Array(24).fill(0);
      const topD: Record<string, number> = {}, cats: Record<string, number> = {}, seriesMap: Record<string, number> = {};
      const bucket = range === "today" ? "hour" : range === "year" ? "month" : "day";
      const keyFor = (d: Date) => bucket === "hour" ? String(d.getHours())
        : bucket === "month" ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : d.toISOString().slice(0, 10);
      let paid = 0, unpaid = 0, cancelled = 0, revenue = 0;
      for (const o of orders) {
        if (o.status === "cancelled") { cancelled++; continue; }
        const dt = new Date(o.created_at);
        const amt = (Number(o.total) || 0) - (Number(o.discount) || 0);
        revenue += amt;
        const k = keyFor(dt); seriesMap[k] = (seriesMap[k] || 0) + amt;
        hours[dt.getHours()] += 1;
        if (o.payment_status === "paid") paid++; else unpaid++;
        for (const it of (Array.isArray(o.items) ? o.items : [])) {
          const q = Number(it.qty) || 1;
          if (it.title) topD[it.title] = (topD[it.title] || 0) + q;
          const c = catOf[it.id] || "other";
          cats[c] = (cats[c] || 0) + q;
        }
      }
      // Zero-filled, ordered revenue series with friendly labels.
      const series: { label: string; revenue: number }[] = [];
      const r2 = (n: number) => Math.round(n * 100) / 100;
      if (bucket === "hour") {
        for (let h = 0; h < 24; h++) series.push({ label: `${h}:00`, revenue: r2(seriesMap[String(h)] || 0) });
      } else if (bucket === "day") {
        for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = d.toISOString().slice(0, 10); series.push({ label: k.slice(5), revenue: r2(seriesMap[k] || 0) }); }
      } else {
        const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; series.push({ label: MN[d.getMonth()], revenue: r2(seriesMap[k] || 0) }); }
      }
      const avgOrder = (paid + unpaid) > 0 ? r2(revenue / (paid + unpaid)) : 0;
      return ok({
        range, series, hours, cats, paid, unpaid, cancelled, revenue: r2(revenue),
        orderCount: orders.length, avgOrder,
        topDishes: Object.entries(topD).sort((a, b) => b[1] - a[1]).slice(0, 10),
      });
    }

    if (p === "customers") {
      const [membersQ, ordersQ, fbQ] = await Promise.all([
        sb.from("session_members").select("id,name,phone,session_id,joined_at,role"),
        sb.from("orders").select("id,member_id,total,discount,status,created_at"),
        sb.from("feedback").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      const members = must(membersQ), orders = must(ordersQ), feedback = must(fbQ);
      const spendByMember: Record<string, number> = {};
      for (const o of orders) {
        if (o.status === "cancelled" || !o.member_id) continue;
        spendByMember[o.member_id] = (spendByMember[o.member_id] || 0) + (Number(o.total) || 0) - (Number(o.discount) || 0);
      }
       
      const map: Record<string, any> = {};
      for (const m of members) {
        const key = (m.phone && m.phone.trim()) || (m.name && m.name.trim().toLowerCase());
        if (!key) continue;
        const c = map[key] || (map[key] = { name: m.name || "", phone: m.phone || "", sessions: new Set(), spend: 0, lastSeen: m.joined_at, headCount: 0 });
        if (m.name && !c.name) c.name = m.name;
        c.sessions.add(m.session_id);
        c.spend += spendByMember[m.id] || 0;
        if (m.role === "owner") c.headCount++;
        if (m.joined_at > c.lastSeen) c.lastSeen = m.joined_at;
      }
      const customers = Object.values(map)
         
        .map((c: any) => ({ name: c.name, phone: c.phone, visits: c.sessions.size, spend: Math.round(c.spend * 100) / 100, lastSeen: c.lastSeen, headCount: c.headCount }))
        .sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1));
      return ok({ customers, feedback });
    }

    if (p === "users") {
      const members = must(
        await sb.from("session_members")
          .select("id, name, phone, phone_verified, role, approved, removed, location_ok, joined_at, session:sessions(table_number, status)")
          .order("joined_at", { ascending: false }).limit(120)
      );
      const customers = must(await sb.from("customers").select("*").order("last_seen_at", { ascending: false }).limit(120));
      const blocklist = must(await sb.from("blocklist").select("*").order("blocked_at", { ascending: false }));
      const orders = must(await sb.from("orders").select("member_id, total, created_at").not("member_id", "is", null).order("created_at", { ascending: false }).limit(400));
      const calls = must(await sb.from("waiter_calls").select("member_id, note, created_at").not("member_id", "is", null).order("created_at", { ascending: false }).limit(400));
      return ok({ members, customers, blocklist, orders, calls });
    }

    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);

    // orders/delete (bulk/clear) — keep settled bills.
    if (a === "orders" && b === "delete") {
      const { ids, all } = body || {};
       
      let candidates: any[];
      if (all) candidates = must(await sb.from("orders").select("id,payment_status,status"));
      else if (Array.isArray(ids) && ids.length) candidates = must(await sb.from("orders").select("id,payment_status,status").in("id", ids));
      else return err("no ids");
      const deletable = candidates.filter((o) => !(o.payment_status === "paid" && o.status !== "cancelled")).map((o) => o.id);
      const kept = candidates.length - deletable.length;
      if (deletable.length) must(await sb.from("orders").delete().in("id", deletable));
      return ok({ ok: true, deleted: deletable.length, kept });
    }

    // orders/:id/discount | accept | serve-all | item
    if (a === "orders" && c === "discount") {
      const cur = must(await sb.from("orders").select("total").eq("id", b).single());
      const raw = Number(body && body.amount);
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), Number(cur.total) || 0) : 0;
      const note = String((body && body.note) || "").slice(0, 200) || null;
      const row = must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", b).select());
      return ok(row[0] || null);
    }
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
       
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).select());
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("status", "received");
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()) || null);
    }
    if (a === "orders" && c === "serve-all") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
       
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).select());
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).neq("status", "served");
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()) || null);
    }
    if (a === "orders" && c === "item") {
      const idx = Number(body && body.index);
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
      const items = Array.isArray(cur.items) ? cur.items : [];
      if (!items[idx]) return err("bad item index");
      items[idx] = { ...items[idx], status };
       
      const servedCount = items.filter((i: any) => i.status === "served").length;
       
      const orderStatus = servedCount === items.length ? "served"
        : items.some((i: any) => i.status === "preparing" || i.status === "served") ? "preparing" : "received";
      const row = must(await sb.from("orders").update({ items, status: orderStatus }).eq("id", b).select());
      return ok(row[0] || null);
    }

    // sessions/open
    if (a === "sessions" && b === "open") {
      const table = String((body && body.table) || "").trim();
      if (!table) return err("table required");
      const num = Number(table);
      if (!/^\d+$/.test(table) || num < 1) return err("invalid table number");
      const setRow = await sb.from("settings").select("table_count").eq("id", "site").maybeSingle();
      const maxTables = setRow.data && setRow.data.table_count ? Number(setRow.data.table_count) : 0;
      if (maxTables > 0 && num > maxTables) return err(`Table ${num} doesn't exist — tables are 1–${maxTables}.`);
      const existing = must(await sb.from("sessions").select("*").eq("table_number", table).neq("status", "closed").limit(1));
      let row;
      if (existing.length) {
        row = must(await sb.from("sessions").update({ status: "open", opened_by: "waiter", opened_at: existing[0].opened_at || nowIso(), last_activity_at: nowIso() }).eq("id", existing[0].id).select())[0];
      } else {
        row = must(await sb.from("sessions").insert({ table_number: table, status: "open", opened_by: "waiter", opened_at: nowIso() }).select())[0];
      }
      await sb.from("requests").update({ status: "approved" }).eq("table_number", table).eq("status", "pending");
      return ok(row || null);
    }

    // sessions/:id/close | auto-approve | shift
    if (a === "sessions" && c === "close") {
      const row = must(await sb.from("sessions").update({ status: "closed", closed_at: nowIso() }).eq("id", b).select());
      const sess = row[0];
      if (sess && sess.table_number != null) {
        const t = String(sess.table_number).trim();
        must(await sb.from("orders").update({ status: "cancelled", archived: true }).eq("table_number", t).eq("archived", false).in("status", ["received", "preparing"]).select());
        must(await sb.from("orders").update({ archived: true }).eq("table_number", t).eq("archived", false).eq("status", "served").select());
      }
      return ok(sess || null);
    }
    if (a === "sessions" && c === "auto-approve") {
      const value = !!(body && body.value === true);
      const row = must(await sb.from("sessions").update({ auto_approve: value }).eq("id", b).select());
      return ok(row[0] || null);
    }
    if (a === "sessions" && c === "shift") {
      const to = String((body && body.to) || "").trim();
      const { data, error } = await sb.rpc("lfh_staff_shift_table", { p_session: b, p_to: to });
      if (error) throw new Error(error.message);
      return ok(data);
    }

    // members/:id/approve | remove | make-head
    if (a === "members" && c === "approve") {
      const row = must(await sb.from("session_members").update({ approved: true }).eq("id", b).select());
      return ok(row[0] || null);
    }
    if (a === "members" && c === "remove") {
      const row = must(await sb.from("session_members").update({ removed: true }).eq("id", b).select());
      return ok(row[0] || null);
    }
    if (a === "members" && c === "make-head") {
      const found = must(await sb.from("session_members").select("id,session_id,role,removed").eq("id", b).limit(1));
      const m = found[0];
      if (!m) return err("member not found", 404);
      const sessRows = must(await sb.from("sessions").select("status").eq("id", m.session_id).limit(1));
      if (!sessRows[0] || sessRows[0].status !== "open") return err("table is not open");
      if (m.role === "owner" && !m.removed) return ok(m);
      must(await sb.from("session_members").update({ removed: true }).eq("session_id", m.session_id).eq("role", "owner").eq("removed", false).select());
      const row = must(await sb.from("session_members").update({ role: "owner", approved: true, removed: false }).eq("id", m.id).select());
      return ok(row[0] || null);
    }

    // items/:id/status (session order_items)
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
       
      const patch: any = { status };
      if (status === "served") patch.served_at = nowIso();
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).select());
      const item = updated[0];
      if (item && item.order_id) {
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id));
        const total = rows.length;
         
        const served = rows.filter((r: any) => r.status === "served").length;
         
        const anyActive = rows.some((r: any) => r.status === "preparing" || r.status === "served");
        const orderStatus = total > 0 && served === total ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: orderStatus }).eq("id", item.order_id);
      }
      return ok(item || null);
    }

    // requests/:id/resolve
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

    // blocklist (add)
    if (a === "blocklist" && path.length === 1) {
      const phone = body.phone ? String(body.phone).trim() : null;
      const table = body.table ? String(body.table).trim() : null;
      if (!phone && !table && !body.member_id) return err("phone, table, or member_id required");
      const row = must(await sb.from("blocklist").insert({ phone, table_number: table, member_id: body.member_id || null, reason: body.reason || null }).select())[0];
      if (phone) await sb.from("customers").upsert({ phone, blocked: true }, { onConflict: "phone" });
      return ok(row || null);
    }

    // generic upsert: POST /:kind  (items | categories | filters | settings)
    if (path.length === 1) {
      const t = TABLES[a];
      if (!t) return err("unknown kind", 404);
      if (a === "settings" && body && typeof body === "object") {
        body.id = "site";
        if ("table_count" in body) {
          const n = Math.round(Number(body.table_count));
          body.table_count = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 12;
        }
        for (const k of ["sessions_enabled", "require_location", "require_otp"]) {
          if (k in body) body[k] = body[k] === true || body[k] === "true";
        }
        for (const g of ["geo_lat", "geo_lng"]) {
          if (g in body) { const v = parseFloat(body[g]); body[g] = Number.isFinite(v) ? v : null; }
        }
        if ("geo_radius_m" in body) {
          const n = Math.round(Number(body.geo_radius_m));
          body.geo_radius_m = Number.isFinite(n) ? Math.min(Math.max(n, 20), 5000) : 250;
        }
        if ("features" in body) {
          const f = body.features;
          body.features = f && typeof f === "object" && !Array.isArray(f)
            ? Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === "boolean"))
            : {};
        }
      }
      if (a === "items" && body && typeof body === "object") {
        const slugify = (s: string) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (!body.slug && body.title) body.slug = slugify(body.title);
        if (!body.id) body.id = body.slug || slugify(body.title);
      }
      const data = must(await sb.from(t.name).upsert(body, { onConflict: t.key }).select());
      return ok(data[0]);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    const [a, id] = path;
    const body = await readBody(req);

    if (a === "orders" && id) {
       
      const patch: any = {};
      if (body.status !== undefined) {
        if (!ORDER_STATUSES.includes(body.status)) return err("invalid status");
        patch.status = body.status;
      }
      if (body.payment_status !== undefined) {
        if (!["pending", "paid"].includes(body.payment_status)) return err("invalid payment_status");
        patch.payment_status = body.payment_status;
      }
      if (body.archived !== undefined) patch.archived = body.archived === true;
      if (!Object.keys(patch).length) return err("nothing to update");
      const cur = must(await sb.from("orders").select("status,payment_status").eq("id", id).single());
      if (patch.status === "cancelled" && cur.payment_status === "paid")
        return err("Can't cancel a paid order — mark it unpaid (refund) first.", 409);
      if (patch.payment_status === "paid" && cur.status === "cancelled")
        return err("Can't take payment on a cancelled order.", 409);
      const data = must(await sb.from("orders").update(patch).eq("id", id).select());
      return ok(data[0] || null);
    }

    if (a === "calls" && id) {
      const data = must(await sb.from("waiter_calls").update({ resolved: body?.resolved === true }).eq("id", id).select());
      return ok(data[0] || null);
    }

    return err("unknown PATCH endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { path = [] } = await ctx.params;
    const [a, id] = path;

    if (a === "orders" && id) {
      const cur = must(await sb.from("orders").select("payment_status,status").eq("id", id).single());
      if (cur && cur.payment_status === "paid" && cur.status !== "cancelled")
        return err("Won't delete a PAID bill — it's a financial record. Mark it unpaid or void it first.", 409);
      must(await sb.from("orders").delete().eq("id", id));
      return ok({ ok: true });
    }

    if (a === "calls" && id) {
      must(await sb.from("waiter_calls").delete().eq("id", id));
      return ok({ ok: true });
    }

    if (a === "blocklist" && id) {
      const existing = must(await sb.from("blocklist").select("*").eq("id", id).limit(1));
      must(await sb.from("blocklist").delete().eq("id", id));
      const phone = existing[0] && existing[0].phone;
      if (phone) {
        const others = must(await sb.from("blocklist").select("id").eq("phone", phone).limit(1));
        if (!others.length) await sb.from("customers").update({ blocked: false }).eq("phone", phone);
      }
      return ok({ ok: true });
    }

    // generic delete: DELETE /:kind/:id  (items | categories | filters | settings)
    if (a && id) {
      const t = TABLES[a];
      if (!t) return err("unknown kind", 404);
      must(await sb.from(t.name).delete().eq(t.key, id));
      return ok({ ok: true });
    }

    return err("unknown DELETE endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
