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
import { maybeAutoSettle } from "@/lib/autoSettle";
import { notifyAggregator } from "@/lib/aggregators";

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
      const orders = must(await sb.from("orders").select("*").order("created_at", { ascending: false }).limit(200));
      // Attach each order's SESSION invoice/bill state so the merged bill card knows
      // whether it's invoiced/locked (invoice lives on the session, not the order).
      const sids = [...new Set(orders.map((o: any) => o.session_id).filter(Boolean))];
      if (sids.length) {
        const sess = must(await sb.from("sessions").select("id,invoice_no,invoice_voided,invoice_at,bill_no").in("id", sids)) || [];
        const map: Record<string, any> = Object.fromEntries((sess as any[]).map((s) => [s.id, s]));
        for (const o of orders as any[]) {
          const s = map[o.session_id];
          if (s) { o.invoice_no = s.invoice_no; o.invoice_voided = s.invoice_voided; o.invoice_at = s.invoice_at; o.bill_no = s.bill_no; }
        }
      }
      return ok(orders);
    }

    if (p === "calls") {
      return ok(must(await sb.from("waiter_calls").select("*").order("created_at", { ascending: false }).limit(100)));
    }

    // Platform (Zomato/Swiggy/takeaway) orders + the two operator toggles. Read
    // from the separate aggregator_orders table — dine-in `orders` is untouched.
    if (p === "platform") {
      // Active orders (any age) + just-handed-over ones (last 6 min): a handed-over
      // ticket lingers ~6 min in the board's "Handed over" column for a final glance,
      // then drops off the live board. Cancelled never show. (owner, 2026-06-21)
      const handoverCutoff = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const [rows, settings] = await Promise.all([
        sb.from("aggregator_orders").select("*")
          .or(`status.eq.new,status.eq.accepted,status.eq.preparing,status.eq.ready,and(status.eq.handed_over,updated_at.gte.${handoverCutoff})`)
          .order("created_at", { ascending: false }).limit(200),
        sb.from("settings").select("kitchen_can_accept_platform, platform_in_bills").eq("id", "site").maybeSingle(),
      ]);
      return ok({ orders: must(rows) || [], toggles: must(settings) || {} });
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
      // Live per-channel snapshot for the Today summary box: open dine-in tables,
      // active platform orders by source, and today's platform totals (platform
      // orders live in aggregator_orders, separate from dine-in `orders`).
      const todayStart = new Date(businessDayStartIso()).toISOString();
      const [openSessQ, platActiveQ, platTodayQ] = await Promise.all([
        sb.from("sessions").select("id").eq("status", "open"),
        sb.from("aggregator_orders").select("source").in("status", ["new", "accepted", "preparing", "ready"]),
        sb.from("aggregator_orders").select("total").gte("created_at", todayStart),
      ]);
      const platActive = (must(platActiveQ) || []) as { source: string }[];
      const platToday = (must(platTodayQ) || []) as { total: number }[];
      const live = {
        dineIn: ((must(openSessQ) || []) as unknown[]).length,
        zomato: platActive.filter((r) => r.source === "zomato").length,
        swiggy: platActive.filter((r) => r.source === "swiggy").length,
        takeaway: platActive.filter((r) => r.source === "takeaway").length,
      };
      const platformToday = { count: platToday.length, revenue: r2(platToday.reduce((sum, r) => sum + (Number(r.total) || 0), 0)) };
      return ok({
        range, series, hours, cats, paid, unpaid, cancelled, revenue: r2(revenue),
        orderCount: orders.length, avgOrder,
        topDishes: Object.entries(topD).sort((a, b) => b[1] - a[1]).slice(0, 10),
        live, platformToday,
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

    // ── Platform (Zomato/Swiggy/takeaway) orders ──────────────────────────────
    // platform/test — drop a random test order in (stands in for the real
    // aggregator webhook until API keys exist). Same insert path the webhook will use.
    if (a === "platform" && b === "test") {
      const SRC = ["zomato", "swiggy", "takeaway"];
      const src = SRC[Math.floor(Math.random() * SRC.length)];
      const dishes = must(await sb.from("menu_items").select("title, price").limit(50)) || [];
      const pick: { title: string; qty: number; price: number }[] = [];
      let total = 0;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n && dishes.length; i++) {
        const d = dishes[Math.floor(Math.random() * dishes.length)];
        const qty = 1 + Math.floor(Math.random() * 2);
        const price = Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;
        pick.push({ title: d.title, qty, price });
        total += price * qty;
      }
      const NAMES = ["Aarav S.", "Meera K.", "Priya R.", "Rohan B.", "Sana M.", "Kunal D.", "Diya P.", "Vikram J."];
      const cust = src === "takeaway" ? `Walk-in · ${NAMES[Math.floor(Math.random() * NAMES.length)].split(" ")[0]}` : NAMES[Math.floor(Math.random() * NAMES.length)];
      const ext = `${src.toUpperCase()}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const { data, error } = await sb.rpc("lfh_platform_insert", {
        p_source: src, p_external_id: ext, p_customer: cust,
        p_phone: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`,
        p_items: pick, p_total: total,
      });
      if (error) throw new Error(error.message);
      await logAction("manager", "platform_test_order", { detail: `${src} test order`, device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
    }

    // platform/:id/status — advance a platform order (accept/preparing/ready/handed_over/cancelled)
    if (a === "platform" && c === "status") {
      const status = body && body.status;
      const ALLOWED = ["new", "accepted", "preparing", "ready", "handed_over", "cancelled"];
      if (!ALLOWED.includes(status)) return err("invalid status");
      const { data, error } = await sb.rpc("lfh_platform_set_status", { p_id: b, p_status: status, p_by: "manager" });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      void notifyAggregator(row?.source, row?.external_id, status); // best-effort push back to the platform (dormant w/o keys)
      await logAction("manager", "platform_status", { detail: status, device_id: dev });
      return ok(row);
    }

    // platform/toggles — flip "kitchen can accept" / "show in bills"
    if (a === "platform" && b === "toggles") {
      const patch: Record<string, boolean> = {};
      if (typeof body.kitchen_can_accept_platform === "boolean") patch.kitchen_can_accept_platform = body.kitchen_can_accept_platform;
      if (typeof body.platform_in_bills === "boolean") patch.platform_in_bills = body.platform_in_bills;
      if (!Object.keys(patch).length) return err("no toggle given");
      must(await sb.from("settings").update(patch).eq("id", "site").select());
      await logAction("manager", "platform_toggle", { detail: JSON.stringify(patch), device_id: dev });
      return ok({ ok: true, ...patch });
    }

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
      // Diff the OLD order-wide list so the per-dish markers stay right: an order-wide
      // allergen distributes onto every dish, so an add/remove here marks ＋ / ✎− on
      // ALL the order's items (same rules as the per-dish endpoint).
      const prev = must(await sb.from("orders").select("allergies").eq("id", b).maybeSingle());
      const oldOW = new Set((Array.isArray(prev?.allergies) ? prev.allergies : []).map((x: any) => String(x).toLowerCase()));
      const addedOW = allergies.filter((s) => !oldOW.has(s));
      const removedOW = [...oldOW].filter((s) => !allergies.includes(s));
      const row = must(await sb.from("orders").update({ allergies, edited_at: nowIso() }).eq("id", b).select());
      if (addedOW.length || removedOW.length) {
        const items = must(await sb.from("order_items").select("id, added_allergens, removed_flag").eq("order_id", b));
        for (const it of items) {
          const mark = new Set((Array.isArray(it.added_allergens) ? it.added_allergens : []).map((x: any) => String(x).toLowerCase()));
          let rf = !!it.removed_flag;
          for (const s of addedOW) mark.add(s);
          for (const s of removedOW) { if (mark.has(s)) mark.delete(s); else rf = true; }
          await sb.from("order_items").update({ added_allergens: [...mark], removed_flag: rf }).eq("id", it.id);
        }
      }
      const detail = [addedOW.length ? `added ${addedOW.join(", ")}` : "", removedOW.length ? `removed ${removedOW.join(", ")}` : ""].filter(Boolean).join("; ") || (allergies.join(", ") || "(none)");
      await logAction("editor", "order_allergies", { order_id: b, detail, device_id: dev });
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
      const servedRow = must(await sb.from("orders").select("*").eq("id", b).single());
      await maybeAutoSettle((servedRow as any)?.session_id, { panel: "editor", deviceId: dev }); // serving may complete the table
      return ok(servedRow || null);
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
      if (status === "served") await maybeAutoSettle(row[0]?.session_id, { panel: "editor", deviceId: dev }); // serving may complete the table
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
    // sessions/:id/invoice — GENERATE the tax invoice (assign a permanent number,
    // lock the bill). Server-authoritative (totals computed from DB order rows).
    if (a === "sessions" && c === "invoice") {
      const { data, error } = await sb.rpc("lfh_generate_invoice", { p_session: b });
      if (error) throw new Error(error.message);
      await logAction("editor", "invoice_generate", { detail: `session ${b}`, device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
    }
    // sessions/:id/void-invoice — VOID it (reopen the bill for edits; number kept in record).
    if (a === "sessions" && c === "void-invoice") {
      const { data, error } = await sb.rpc("lfh_void_invoice", { p_session: b, p_reason: (body && body.reason) || null });
      if (error) throw new Error(error.message);
      await logAction("editor", "invoice_void", { detail: `session ${b}` + ((body && body.reason) ? ` · ${body.reason}` : ""), device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
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
      // Fetch the CURRENT state so we can diff old→new and keep the per-dish edit
      // markers: which allergens were ADDED after placement (added_allergens, → a "＋"
      // beside each) and whether one was REMOVED (removed_flag, → a "✎−" on the name).
      // maybeSingle: a stale id returns null so the friendly "dish not found" 400 fires.
      const item = must(await sb.from("order_items").select("id, order_id, removed, added_allergens, removed_flag, status").eq("id", b).maybeSingle());
      if (!item) return err(editErrMsg("item_not_found"), 400);
      // Once a dish is READY or SERVED it's cooked/out — too late to change it.
      if (item.status === "ready" || item.status === "served") return err("That dish is already " + item.status + " — too late to edit.", 409);
      const order = must(await sb.from("orders").select("payment_status, status").eq("id", item.order_id).maybeSingle());
      if (order?.payment_status === "paid") return err(editErrMsg("order_paid"), 409);
      if (order?.status === "cancelled") return err(editErrMsg("order_cancelled"), 400);
      const oldSet = new Set((Array.isArray(item.removed) ? item.removed : []).map((x: any) => String(x).toLowerCase()));
      const justAdded = removed.filter((s) => !oldSet.has(s));
      const justRemoved = [...oldSet].filter((s) => !removed.includes(s));
      const addedMark = new Set((Array.isArray(item.added_allergens) ? item.added_allergens : []).map((x: any) => String(x).toLowerCase()));
      let removedFlag = !!item.removed_flag;
      for (const s of justAdded) addedMark.add(s);   // staff-added allergen → mark it "added"
      for (const s of justRemoved) { if (addedMark.has(s)) addedMark.delete(s); else removedFlag = true; } // un-mark a re-removed add; else flag a real removal
      const added_allergens = [...addedMark].filter((s) => removed.includes(s)); // keep only ones still present
      const rowU = must(await sb.from("order_items").update({ removed, added_allergens, removed_flag: removedFlag }).eq("id", b).select());
      const detail = [justAdded.length ? `added ${justAdded.join(", ")}` : "", justRemoved.length ? `removed ${justRemoved.join(", ")}` : ""].filter(Boolean).join("; ") || "no change";
      await logAction("editor", "order_item_removed", { order_id: item.order_id, detail, device_id: dev });
      await stampEdited(item.order_id);
      return ok(rowU[0] || { ok: true });
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
      if (patch.payment_status === "paid") await maybeAutoSettle(data[0]?.session_id, { panel: "editor", deviceId: deviceIdFrom(req) }); // paying may complete the table
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
