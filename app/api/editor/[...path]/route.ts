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
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { businessDayStartIso } from "@/lib/businessDay";
import { requireRole } from "@/lib/userAuth";
import { closeSession } from "@/lib/sessionClose";

export const dynamic = "force-dynamic"; // always live, never cached

// Gate: only a logged-in MANAGER (or the admin super-user) may touch this API.
// Returns a 401 response to short-circuit, or null to let the handler proceed.
async function gate(req: NextRequest): Promise<NextResponse | null> {
  const g = await requireRole(req, "manager");
  return g.ok ? null : NextResponse.json({ error: "Not authorised — please log in." }, { status: 401 });
}

const nowIso = () => new Date().toISOString();
// Mark an order as EDITED after it was placed → drives the persistent "✎ Edited"
// badge on the kitchen/tablet/manager ticket so staff re-check what changed.
// Best-effort: a stamp failure must never fail the edit itself.
const stampEdited = async (orderId?: string | null) => {
  if (!orderId) return;
  try { await sb.from("orders").update({ edited_at: nowIso() }).eq("id", orderId); } catch {}
};
// Unwrap a Supabase { data, error } reply — throw on error so the catch turns it
// into a clean 500 (mirrors the editor server's `must`).

const must = (r: any) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// Friendly message for a staff-edit RPC's { ok:false, reason } (shared by the
// edit-qty / edit-note / add-item / delete endpoints).
const editErrMsg = (reason?: string) =>
  reason === "order_paid" ? "Won't change a PAID bill — mark it unpaid first."
  : reason === "order_cancelled" ? "This order was cancelled — nothing to edit."
  : reason === "item_not_found" ? "That dish is no longer on the order."
  : reason === "order_not_found" ? "That order no longer exists."
  : reason === "sold_out" ? "That dish is sold out — can't add it."
  : reason === "unknown_item" ? "That dish isn't on the menu."
  : reason === "empty_order" ? "Nothing to add."
  : (reason || "Couldn't edit the order.");

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
  const denied = await gate(req); if (denied) return denied;
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
      if (range === "today") { since = new Date(businessDayStartIso()); } // 05:00 IST business day
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

    if (p === "oplog") {
      // The operation log: recent staff actions across all panels. The ADMIN's own
      // user-management actions (panel='admin' — create/delete/reset users) are
      // HIDDEN here; they show only in the admin's own Logs page, never the manager's.
      return ok(must(await sb.from("staff_actions").select("*").neq("panel", "admin").order("created_at", { ascending: false }).limit(200)));
    }

    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await gate(req); if (denied) return denied;
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which device (this editor screen) is acting

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
    // orders/:id/allergies — staff edit of the order-wide "avoid" list (add a
    // missed allergen, fix a wrong one). Stored on orders.allergies; the kitchen/
    // tablet distribute it onto every dish as "NO X". Free-form strings allowed
    // (guests can type "other"), trimmed + de-duped + capped. (owner, 2026-06-16)
    if (a === "orders" && c === "allergies") {
      const raw = Array.isArray(body?.allergies) ? body.allergies : [];
      const allergies = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      const row = must(await sb.from("orders").update({ allergies, edited_at: nowIso() }).eq("id", b).select());
      await logAction("editor", "order_allergies", { order_id: b, detail: allergies.join(", ") || "(none)", device_id: dev });
      return ok(row[0] || null);
    }
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
       
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // No .select() here: the updated row was fetched-back then discarded — we re-read the
      // full row below anyway, so the extra round-trip was dead. `must` still checks the error.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("status", "received");
      await logAction("editor", "order_accept", { order_id: b, device_id: dev });
      return ok(must(await sb.from("orders").select("*").eq("id", b).single()) || null);
    }
    if (a === "orders" && c === "serve-all") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).single());
       
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      // No .select(): the fetched-back row was discarded; we re-read the full row below.
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b));
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).neq("status", "served");
      await logAction("editor", "order_serve", { order_id: b, device_id: dev });
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
      await logAction("editor", "table_open", { table_number: table, device_id: dev });
      return ok(row || null);
    }

    // sessions/:id/close | auto-approve | shift
    // Uses the SHARED closeSession so the manager's rule is identical to the tablet's
    // (blocked on unpaid OR still-cooking unless force). The manager needs no PIN —
    // they're already the manager; force=true is their "close anyway" override.
    if (a === "sessions" && c === "close") {
      const result = await closeSession(b, { force: !!(body && body.force === true) }, { panel: "editor", deviceId: dev });
      if (!result.ok) return err(result.message, result.status);
      return ok(result.session);
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
      await logAction("editor", "table_shift", { detail: "→ table " + to, device_id: dev });
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

    // items/:id/delete — remove ONE dish (order_item) from a table's order and
    // reconcile the bill. CRITICAL (money): orders.total is a stored server-priced
    // number, so we DON'T just delete the row — the lfh_delete_order_item RPC
    // deletes it AND recomputes the order's subtotal/tax/total from the remaining
    // dishes (and cancels the order if it's now empty), all in one transaction.
    // The RPC refuses to touch a PAID bill. Returns { ok, items_left, total, ... }.
    if (a === "items" && c === "delete") {
      const { data, error } = await sb.rpc("lfh_delete_order_item", { p_item_id: b });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) {
        const reason = data.reason || "could not delete";
        const msg = reason === "order_paid"
          ? "Won't change a PAID bill — mark it unpaid first."
          : reason === "item_not_found"
            ? "That dish was already removed."
            : reason;
        return err(msg, reason === "order_paid" ? 409 : 400);
      }
      await logAction("editor", "order_item_delete", { order_id: data?.order_id, detail: data?.order_cancelled ? "order emptied → cancelled" : `dish removed, ${data?.items_left} left`, device_id: dev });
      await stampEdited(data?.order_id);
      return ok(data);
    }

    // items/:id/qty — STAFF EDIT: change ONE dish's quantity on a PLACED order.
    // Money-safe: the RPC clamps 1..99, updates the row, then re-prices the bill
    // from order_items (orders.total is a stored server-priced number). Refuses a
    // PAID/cancelled order. (owner, 2026-06-17 — gated behind the UI confirm.)
    if (a === "items" && c === "qty") {
      const qty = Math.round(Number(body?.qty));
      if (!Number.isFinite(qty) || qty < 1) return err("invalid quantity");
      const { data, error } = await sb.rpc("lfh_staff_edit_item_qty", { p_item: b, p_qty: qty });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await logAction("editor", "order_item_qty", { order_id: data?.order_id, detail: `qty → ${data?.qty}`, device_id: dev });
      await stampEdited(data?.order_id);
      return ok(data);
    }

    // items/:id/note — STAFF EDIT: change ONE dish's note on a PLACED order.
    if (a === "items" && c === "note") {
      const { data, error } = await sb.rpc("lfh_staff_edit_item_note", { p_item: b, p_note: String(body?.note ?? "") });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await logAction("editor", "order_item_note", { order_id: data?.order_id, device_id: dev });
      await stampEdited(data?.order_id);
      return ok(data);
    }

    // items/:id/removed — STAFF EDIT: change ONE dish's removed/allergen list ("NO X")
    // on a PLACED order — add a missed allergen on just this dish, or UNDO one added by
    // mistake (the order-wide list has its own endpoint above). Removals don't change
    // the price, so a direct table write (service-role, already gated) is enough; we
    // still refuse a PAID/cancelled order to match the other edit endpoints.
    if (a === "items" && c === "removed") {
      const raw = Array.isArray(body?.removed) ? body.removed : [];
      const removed = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      // maybeSingle (not single): a missing row returns null instead of throwing, so
      // the friendly "dish not found" 400 below is reachable for a stale id.
      const item = must(await sb.from("order_items").select("id, order_id").eq("id", b).maybeSingle());
      if (!item) return err(editErrMsg("item_not_found"), 400);
      const order = must(await sb.from("orders").select("payment_status, status").eq("id", item.order_id).maybeSingle());
      if (order?.payment_status === "paid") return err(editErrMsg("order_paid"), 409);
      if (order?.status === "cancelled") return err(editErrMsg("order_cancelled"), 400);
      const row = must(await sb.from("order_items").update({ removed }).eq("id", b).select());
      await logAction("editor", "order_item_removed", { order_id: item.order_id, detail: removed.join(", ") || "(none)", device_id: dev });
      await stampEdited(item.order_id);
      return ok(row[0] || { ok: true });
    }

    // orders/:id/add-item — STAFF EDIT: ADD a new dish to an already-placed order.
    // Server-priced (rejects unknown/sold-out), inserted as 'received', then the
    // bill is re-priced. Body: { dishId, qty, options?, removed?, note? }.
    if (a === "orders" && c === "add-item") {
      const dishId = String(body?.dishId || body?.id || "").trim();
      if (!dishId) return err("dish required");
      const line = {
        id: dishId,
        qty: Math.max(1, Math.round(Number(body?.qty) || 1)),
        options: Array.isArray(body?.options) ? body.options : undefined,
        removed: Array.isArray(body?.removed) ? body.removed : undefined,
        note: body?.note ? String(body.note) : undefined,
      };
      const { data, error } = await sb.rpc("lfh_staff_add_item_to_order", { p_order: b, p_items: [line] });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await logAction("editor", "order_add_item", { order_id: b, detail: dishId, device_id: dev });
      await stampEdited(b);
      return ok(data);
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
         
        const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
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
      const device = body.device_id ? String(body.device_id).trim() : null; // block a staff device (tablet/kitchen)
      if (!phone && !table && !device && !body.member_id) return err("phone, table, device_id, or member_id required");
      const row = must(await sb.from("blocklist").insert({ phone, table_number: table, device_id: device, member_id: body.member_id || null, reason: body.reason || null }).select())[0];
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
        // Log retention (in days): clamp to 1..90. 90 = the "3 months" max the UI
        // offers. The nightly cleanup job (migration 053) reads these each run.
        for (const rk of ["oplog_retention_days", "custlog_retention_days"]) {
          if (rk in body) {
            const n = Math.round(Number(body[rk]));
            body[rk] = Number.isFinite(n) ? Math.min(Math.max(n, 1), 90) : 90;
          }
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
  const denied = await gate(req); if (denied) return denied;
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
      // Reverting a PAID bill to unpaid is a refund/correction, not a routine edit:
      // require a reason and ALWAYS log it, so collected cash can't be quietly
      // un-booked without a trace (theft control).
      if (patch.payment_status === "pending" && cur.payment_status === "paid") {
        const reason = String((body && body.revert_reason) || "").trim();
        if (!reason) return err("Reverting a PAID bill needs a reason (refund/correction).", 409);
        await logAction("editor", "payment_revert", { order_id: id, detail: reason, device_id: deviceIdFrom(req) });
      }
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
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = await gate(req); if (denied) return denied;
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
