// Editor API — the whole editor/server.js Express surface, ported into ONE Next
// catch-all route handler so it runs inside the single app (no separate :4001
// server). Faithful to the original: same paths (under /api/editor/*), same
// request/response shapes, same business guards. Uses the server-only
// service-role client.
//
// The editor's browser UI (public/panels/editor/app.js) calls fetch("/api/editor"
// + path), so e.g. /api/editor/all, /api/editor/orders/:id, etc. land here.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { menuTag } from "@/lib/menuDataServer";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { businessDayStartIso } from "@/lib/businessDay";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { panelRestaurantId } from "@/lib/panelScope";
import { effectiveTaxRate } from "@/lib/tax";
import { closeSession } from "@/lib/sessionClose";
import { maybeAutoSettle } from "@/lib/autoSettle";
import { notifyAggregator } from "@/lib/aggregators";
import { PAYMENT_METHODS } from "@/lib/payments";
import { MANAGER_POWER_FLAGS, powerEntitlementKey } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic"; // always live, never cached

// Gate: only a logged-in MANAGER (or the admin super-user) may touch this API.
// Returns a 401 response to short-circuit, or null to let the handler proceed.
async function gate(req: NextRequest): Promise<{ user: StaffUser | null } | NextResponse> {
  const g = await requireRole(req, "manager");
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
//  also honours the admin's "view as" restaurant. DEFAULT_RESTAURANT_ID is still used
//  below for menu-item id namespacing.)
// Whether the acting staff may perform an owner-gated MANAGER action. The admin
// super-user (g.user===null) and the OWNER always may; a plain manager only if the
// owner switched that capability flag ON for this restaurant (mig 091 + the owner's
// "Staff & powers" page) AND the admin still entitles that power at all (mig 133 —
// power_<flag> in owner_entitlements; absent = entitled). Both columns come back in
// ONE select, so the ladder check adds no extra round trip. Enforces give_discounts /
// void_bills / edit_menu / view_dashboard server-side so hiding a button is never
// the only guard.
async function managerCan(g: { user: StaffUser | null }, rid: string, flag: string): Promise<boolean> {
  const u = g.user;
  if (!u || u.role === "owner") return true;
  const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle()).data as
    { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean> } | null;
  if (r?.owner_entitlements?.[powerEntitlementKey(flag)] === false) return false;
  return !!r?.manager_permissions?.[flag];
}
const permDenied = (what: string) => err(`Your owner hasn't given managers permission to ${what}.`, 403);

// Friendly message for the banquet RPC's { ok:false, reason } (mig 130).
const banquetErrMsg = (reason?: string) =>
  reason === "not_allowed" ? "Banquet isn't enabled for this restaurant."
  : reason === "empty_order" ? "Add at least one banquet line."
  : reason === "unknown_item" ? "That banquet item no longer exists — reload and try again."
  : reason === "bad_table" ? "Pick a valid table."
  : (reason || "Couldn't create the banquet bill.");

const nowIso = () => new Date().toISOString();
// Mark an order as EDITED after it was placed → drives the persistent "✎ Edited"
// badge on the kitchen/tablet/manager ticket so staff re-check what changed.
// Best-effort: a stamp failure must never fail the edit itself.
const stampEdited = async (orderId?: string | null, rid?: string) => {
  if (!orderId) return;
  try { let q = sb.from("orders").update({ edited_at: nowIso() }).eq("id", orderId); if (rid) q = q.eq("restaurant_id", rid); await q; } catch {}
};
// Unwrap a Supabase { data, error } reply — throw on error so the catch turns it
// into a clean 500 (mirrors the editor server's `must`).

const must = (r: any) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// Owner edited the SHARED menu (a dish/category/filter/guest-safe setting) → bust
// THIS restaurant's cached menu bundle so guests get the change within seconds via
// their realtime 'menu' refetch (which would otherwise hit a stale 120s cache),
// not after the 120s revalidate window. Scoped to one restaurant's tag — never
// invalidates anyone else's menu. Best-effort: a bust failure must never fail the
// save (the 120s revalidate is the backstop).
const bustMenuCache = (rid: string) => {
  // 'max' = stale-while-revalidate: purge the tag and let the next read refresh
  // it (the documented profile for route-handler / webhook busting in Next 16).
  try { revalidateTag(menuTag(rid), "max"); } catch {}
};

// Money-integrity lock: while a session holds a LIVE (non-voided) invoice, its bill
// is frozen — reject any money-changing edit so the printed invoice total can't drift.
// Reopen (void) the invoice first. (work-checker 2026-06-21)
const LOCKED_MSG = "This bill is invoiced — reopen it (void the invoice) before changing the order.";
async function invoiceLockedByOrder(orderId: string): Promise<boolean> {
  const o = (await sb.from("orders").select("session_id").eq("id", orderId).maybeSingle()).data as { session_id?: string } | null;
  if (!o?.session_id) return false;
  const s = (await sb.from("sessions").select("invoice_no,invoice_voided").eq("id", o.session_id).maybeSingle()).data as { invoice_no?: number | null; invoice_voided?: boolean } | null;
  return !!(s && s.invoice_no != null && !s.invoice_voided);
}
async function invoiceLockedByItem(itemId: string): Promise<boolean> {
  const it = (await sb.from("order_items").select("order_id").eq("id", itemId).maybeSingle()).data as { order_id?: string } | null;
  return it?.order_id ? invoiceLockedByOrder(it.order_id) : false;
}

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
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  try {
    const { path = [] } = await ctx.params;
    const p = path.join("/");

    // whoami — boot signal for the panel's hierarchy X-ray (2026-07-05). Tells the
    // client WHO is viewing (admin super-user / owner / manager) and this restaurant's
    // manager_permissions, so the nav can HIDE a disabled feature for the real manager
    // but show it GREYED to a higher role (admin/owner) looking in. Read-only; the
    // server still enforces every capability (managerCan) regardless of what the UI shows.
    if (p === "whoami") {
      const actor = g.user ? g.user.role : "admin"; // no staff user cookie = admin super-user
      const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle()).data as
        { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean> } | null;
      // The ladder, resolved per power (mig 133): effective = admin entitles it AND the
      // owner granted it. The X-ray tints on !effective and can say WHO turned it off.
      const perms = r?.manager_permissions || {};
      const ents = r?.owner_entitlements || {};
      const effectivePowers: Record<string, boolean> = {};
      const offByAdmin: Record<string, boolean> = {};
      for (const flag of MANAGER_POWER_FLAGS) {
        const entitled = ents[powerEntitlementKey(flag)] !== false;
        effectivePowers[flag] = entitled && perms[flag] === true;
        offByAdmin[flag] = !entitled;
      }
      return ok({
        actor,
        role: actor,
        // A higher role is "viewing" a lower panel when it's the admin super-user or an
        // owner opening the manager panel — those see greyed (not hidden) disabled items.
        higherView: actor === "admin" || actor === "owner",
        managerPermissions: perms,
        effectivePowers,
        offByAdmin,
      });
    }

    // banquet/items — the banquet menu (mig 130). Manager-panel surface; only
    // exists when the admin entitlement is on (renders nothing otherwise, and the
    // place RPC re-checks server-side anyway). Includes inactive rows so the
    // manager can toggle them back on.
    if (p === "banquet/items") {
      const flags = await sb.from("settings").select("banquet_allowed").eq("restaurant_id", rid).maybeSingle();
      if (!(flags.data as { banquet_allowed?: boolean } | null)?.banquet_allowed) {
        return err("Banquet isn't enabled for this restaurant.", 403);
      }
      const items = must(await sb.from("banquet_items")
        .select("id,title,price,unit,sort_order,active").eq("restaurant_id", rid)
        .order("sort_order").limit(200));
      return ok({ items });
    }

    if (p === "all") {
      const [items, categories, filters, settings, restaurant] = await Promise.all([
        sb.from("menu_items").select("*").eq("restaurant_id", rid).order("sort_order"),
        sb.from("categories").select("*").eq("restaurant_id", rid).order("sort_order"),
        sb.from("filters").select("*").eq("restaurant_id", rid).order("sort_order"),
        sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
        // The restaurant's own identity, so the printed bill is white-labelled to
        // THIS restaurant (its name/logo/footer) instead of the French House default.
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color").eq("id", rid).maybeSingle(),
      ]);
      return ok({
        items: must(items),
        categories: must(categories),
        filters: must(filters),
        settings: must(settings) || { id: "site", bubbles_enabled: true, service_mode: false },
        restaurant: must(restaurant) || null,
      });
    }

    if (p === "orders") {
      // TARGETED REFETCH (owner 2026-06-26 — egress cut): when a realtime breadcrumb
      // names ONE table, the panel asks for just that table's orders (?table=N) instead
      // of re-reading the whole floor. No param = full board (unchanged). Scopes the
      // 159 KB-and-growing whole-orders read down to a few rows.
      const sp = new URL(req.url).searchParams;
      const tbl = sp.get("table");
      // BILLS-HISTORY SEARCH (owner, 2026-07-03): the Bills tab only fetched the newest 200
      // orders, so searching for an OLDER bill found nothing (the row was never fetched). When
      // ?history=1&q=…&type=… is set, query the DB directly for the match (scoped by rid),
      // returning up to 200 matching bill records — so any bill is findable, however old.
      let oq = sb.from("orders").select("*").eq("restaurant_id", rid);
      const histQ = sp.get("history") ? (sp.get("q") || "").trim() : "";
      if (histQ) {
        const type = sp.get("type") || "inv";
        if (type === "inv" || type === "bill") {
          // invoice_no / bill_no live on the SESSION → find matching sessions, then their orders.
          const col = type === "inv" ? "invoice_no" : "bill_no";
          // Match the LAST run of digits so a full formatted invoice pasted in
          // ("INV/2025-26/000042") resolves to its sequence number (42) — the old
          // strip-ALL-non-digits turned that into 2025260000042 and found nothing (2026-07-06).
          const m = histQ.match(/(\d+)(?!.*\d)/);
          const n = m ? parseInt(m[1], 10) : NaN;
          if (!Number.isFinite(n)) return ok([]);
          const sess = must(await sb.from("sessions").select("id").eq("restaurant_id", rid).eq(col, n).limit(200));
          const ids = (sess as any[]).map((s) => s.id);
          if (!ids.length) return ok([]);
          oq = oq.in("session_id", ids);
        } else if (type === "table") {
          oq = oq.eq("table_number", histQ);
        } else if (type === "cust") {
          // Customer name lives on the session's member rows (session_members.name), NOT on
          // orders — orders.customer_name is a SYNTHETIC field attached during enrichment
          // below, so it can't be queried. Resolve matching sessions by member name (rid-
          // scoped), then return those sessions' orders. No match → no bills.
          const mem = must(await sb.from("session_members").select("session_id").eq("restaurant_id", rid).ilike("name", `%${histQ}%`).limit(200));
          const sIds = [...new Set((mem as any[]).map((m) => m.session_id).filter(Boolean))];
          if (!sIds.length) return ok([]);
          oq = oq.in("session_id", sIds);
        } else if (type === "date") {
          const d = new Date(histQ);
          if (isNaN(d.getTime())) return ok([]);
          const start = new Date(d); start.setHours(0, 0, 0, 0);
          const end = new Date(start); end.setDate(end.getDate() + 1);
          oq = oq.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
        }
      } else if (tbl) {
        oq = oq.eq("table_number", tbl);
      }
      const orders = must(await oq.order("created_at", { ascending: false }).limit(200));
      // Attach each order's SESSION invoice/bill state so the merged bill card knows
      // whether it's invoiced/locked (invoice lives on the session, not the order).
      const sids = [...new Set(orders.map((o: any) => o.session_id).filter(Boolean))];
      if (sids.length) {
        const [sessQ, memQ] = await Promise.all([
          sb.from("sessions").select("id,invoice_no,invoice_voided,invoice_at,bill_no").in("id", sids),
          sb.from("session_members").select("session_id,name,role").in("session_id", sids).eq("role", "owner"),
        ]);
        const map: Record<string, any> = Object.fromEntries(((must(sessQ) || []) as any[]).map((s) => [s.id, s]));
        const nameMap: Record<string, string> = {};
        for (const m of (must(memQ) || []) as any[]) { if (m.name && !nameMap[m.session_id]) nameMap[m.session_id] = m.name; }
        for (const o of orders as any[]) {
          const s = map[o.session_id];
          if (s) { o.invoice_no = s.invoice_no; o.invoice_voided = s.invoice_voided; o.invoice_at = s.invoice_at; o.bill_no = s.bill_no; }
          if (nameMap[o.session_id]) o.customer_name = nameMap[o.session_id];
        }
      }
      return ok(orders);
    }

    if (p === "calls") {
      const tbl = new URL(req.url).searchParams.get("table"); // targeted refetch (see /orders)
      let cq = sb.from("waiter_calls").select("*").eq("restaurant_id", rid);
      if (tbl) cq = cq.eq("table_number", tbl);
      return ok(must(await cq.order("created_at", { ascending: false }).limit(100)));
    }

    // Issues this restaurant has raised (newest first, open before resolved) — so the
    // manager can see what they've reported + its status. Scoped to THIS restaurant.
    if (p === "issues") {
      return ok(must(await sb.from("issues").select("*").eq("restaurant_id", rid).order("status", { ascending: true }).order("created_at", { ascending: false }).limit(100)));
    }

    // Platform (Zomato/Swiggy/takeaway) orders + the two operator toggles. Read
    // from the separate aggregator_orders table — dine-in `orders` is untouched.
    if (p === "platform") {
      // Active orders (any age) + just-handed-over ones (last 6 min): a handed-over
      // ticket lingers ~6 min in the board's "Handed over" column for a final glance,
      // then drops off the live board. Cancelled never show. (owner, 2026-06-21)
      const handoverCutoff = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const [rows, settings] = await Promise.all([
        sb.from("aggregator_orders").select("*").eq("restaurant_id", rid)
          .or(`status.eq.new,status.eq.accepted,status.eq.preparing,status.eq.ready,and(status.eq.handed_over,updated_at.gte.${handoverCutoff})`)
          .order("created_at", { ascending: false }).limit(200),
        sb.from("settings").select("kitchen_can_accept_platform, platform_in_bills").eq("restaurant_id", rid).maybeSingle(),
      ]);
      return ok({ orders: must(rows) || [], toggles: must(settings) || {} });
    }

    // Day-close "Z report": the business-day totals, computed SERVER-SIDE from the DB
    // (discount BEFORE tax, same as billMath). Dine-in + platform + invoices/voids.
    if (p === "zreport") {
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      const since = businessDayStartIso();
      const [ordQ, invQ, voidQ, platQ, setQ] = await Promise.all([
        sb.from("orders").select("id,session_id,subtotal,discount,status,payment_status").eq("restaurant_id", rid).gte("created_at", since),
        sb.from("sessions").select("id").eq("restaurant_id", rid).gte("invoice_at", since),     // invoices GENERATED today
        sb.from("sessions").select("id").eq("restaurant_id", rid).gte("void_at", since),        // invoices VOIDED today
        sb.from("aggregator_orders").select("total,status").eq("restaurant_id", rid).gte("created_at", since),
        sb.from("settings").select("tax_rate,tax_components,restaurant_name,gstin,invoice_prefix").eq("restaurant_id", rid).maybeSingle(),
      ]);
      const orders = (must(ordQ) || []) as any[];
      const set = (must(setQ) || {}) as any;
      // Effective rate = sum of named tax components (CGST/SGST/…), else the fallback
      // rate, else 5% — the SAME rule as billMath/the printed bill (lib/tax.ts), so the
      // Z-report tax matches what the day's bills actually charged. Was flat tax_rate/5%.
      const rate = effectiveTaxRate(set);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      // Group orders into BILLS by session_id (a solo order is its own bill) so the
      // tax is computed per-bill — IDENTICAL to billMath()/the printed receipt — and the
      // Z-report net reconciles to the penny with the sum of the day's printed bills.
      // (Taxing each order separately could drift a rupee or two on multi-order tables.)
      const groups = new Map<string, any[]>();
      let orderCount = 0, cancelled = 0;
      for (const o of orders) {
        if (o.status === "cancelled") { cancelled++; continue; }
        orderCount++;
        const key = o.session_id || ("solo:" + o.id);
        (groups.get(key) || (groups.set(key, []), groups.get(key)!)).push(o);
      }
      let gross = 0, disc = 0, taxable = 0, tax = 0, net = 0;
      let paidCount = 0, paidNet = 0, unpaidCount = 0, unpaidNet = 0; // counts are BILLS, not orders
      for (const g of groups.values()) {
        const sub = g.reduce((a, o) => a + (Number(o.subtotal) || 0), 0);
        const d = g.reduce((a, o) => a + (Number(o.discount) || 0), 0);
        const tx = Math.max(0, sub - d), t = r2(tx * rate), tot = r2(tx + t);
        gross += sub; disc += d; taxable += tx; tax += t; net += tot;
        // A bill counts as collected only when EVERY order on it is paid (a table
        // settles in one go via maybeAutoSettle, so this matches real behaviour).
        if (g.every((o) => o.payment_status === "paid")) { paidCount++; paidNet += tot; }
        else { unpaidCount++; unpaidNet += tot; }
      }
      const plat = (must(platQ) || []) as any[];
      const platActive = plat.filter((p2) => p2.status !== "cancelled");
      const platRevenue = r2(platActive.reduce((a, p2) => a + (Number(p2.total) || 0), 0));
      return ok({
        date: new Date().toLocaleDateString(), since,
        dineIn: { orderCount, bills: groups.size, gross: r2(gross), discount: r2(disc), taxable: r2(taxable), tax: r2(tax), net: r2(net),
          paidCount, paidNet: r2(paidNet), unpaidCount, unpaidNet: r2(unpaidNet), cancelled },
        platform: { count: platActive.length, revenue: platRevenue },
        invoicesGenerated: (must(invQ) || []).length,
        invoicesVoided: (must(voidQ) || []).length,
        // GRAND TOTAL = money actually COLLECTED today, so use paidNet (paid-only dine-in),
        // NOT net (which includes still-open/unpaid bills). Matches mig 113's paid-only rule +
        // the /stats endpoint; the old `net + platRevenue` overstated the day-close cash by the
        // value of any unpaid bills open at print time (owner-facing till mismatch). (2026-07-03)
        grandTotal: r2(paidNet + platRevenue), rate,
        restaurant: { name: set.restaurant_name || "Little French House", gstin: set.gstin || "" },
      });
    }

    if (p === "summary") {
      // TIER 1 of the two-tier Table view (mig 101, lfh_table_view_summary): a MINIMAL
      // per-tile summary for the GRID — each tile's computed state/label/meta/counts/due/
      // pay/badge-flags (NOT the heavy session/member/order_item rows), plus the small
      // restaurant-wide aggregates the side panel + chimes need (pending calls / requests /
      // joiners, blocklist, a diffable live-order count + the latest order's table). ~84 kB
      // at 300 tables vs ~315 kB for the full bundle. The selected table's FULL detail still
      // comes from /sessions?table=N (tier 2). ?table=N → just that ONE tile (targeted refetch,
      // ~5 kB) for pollTables; no param → the whole-floor grid. Aggregates always returned.
      const tbl = new URL(req.url).searchParams.get("table");
      const { data, error } = await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: tbl || null });
      if (error) throw new Error(error.message);
      return ok(data || { tiles: {}, order_count: 0, latest_order_table: null, calls: [], requests: [], joiners: [], blocklist: [] });
    }

    if (p === "sessions") {
      // ONE ROUND-TRIP (mig 100, lfh_floor_bundle): the whole floor — sessions + members +
      // items + pending requests + blocklist — is assembled SERVER-SIDE in a single DB call,
      // so the panel doesn't make ~4 sequential trips to the (Sydney, ~250ms RTT) DB. That was
      // the panel-jam-under-load cause (~950ms → ~300ms). Same JSON shape as before.
      // ?table=N → that table's slice (targeted refetch); no param → full board.
      const tbl = new URL(req.url).searchParams.get("table");
      const { data, error } = await sb.rpc("lfh_floor_bundle", { p_restaurant_id: rid, p_table: tbl || null });
      if (error) throw new Error(error.message);
      return ok(data || { sessions: [], members: [], items: [], requests: [], blocklist: [] });
    }

    if (p === "stats") {
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      // Range: today | 30d | year. Buckets the revenue series by hour / day / month.
      const range = new URL(req.url).searchParams.get("range") || "30d";
      const now = new Date();
      let since: Date;
      if (range === "today") { since = new Date(businessDayStartIso()); } // 05:00 IST business day
      else if (range === "year") { since = new Date(now.getFullYear(), now.getMonth() - 11, 1); }
      else { since = new Date(Date.now() - 29 * 864e5); since.setHours(0, 0, 0, 0); }

      // Crazy-dashboard upgrade (owner, 2026-07-05): fetch ONE window covering the
      // current period AND the one before it, split in code. This doubles the rows
      // of this on-demand (never polled) endpoint in exchange for honest deltas —
      // the previous period is cut at the SAME elapsed time ("today till 5pm vs
      // yesterday till 5pm", the Restroworks trick), so a half-day never gets
      // compared against a full day. Channel split needs one extra SCOPED query
      // on aggregator_orders (column list + limit, indexed by restaurant+time).
      let prevSince: Date;
      if (range === "today") prevSince = new Date(since.getTime() - 864e5);
      else if (range === "year") prevSince = new Date(since.getFullYear() - 1, since.getMonth(), 1);
      else prevSince = new Date(since.getTime() - 30 * 864e5);
      const elapsedMs = now.getTime() - since.getTime();
      const [ordersQ, dishesQ, setQ, platRangeQ] = await Promise.all([
        // NEWEST-FIRST + explicit high bound. Without an .order()/.limit() PostgREST
        // silently returns an ARBITRARY capped page (db-max-rows), so on a busy restaurant
        // the totals/deltas were computed on a random subset → wrong, non-deterministic
        // numbers. Ordering desc means any truncation drops only the OLDEST rows, keeping
        // the recent window complete and the result reproducible. (Follow-up for extreme
        // scale: pre-aggregated daily summary table per CLAUDE.md — this endpoint is
        // on-demand, never polled, so a bounded scan is acceptable until then.)
        sb.from("orders").select("id,session_id,subtotal,total,discount,status,payment_status,payment_method,created_at,items,table_number").eq("restaurant_id", rid).gte("created_at", prevSince.toISOString()).order("created_at", { ascending: false }).limit(50000),
        sb.from("menu_items").select("id,title,category").eq("restaurant_id", rid),
        sb.from("settings").select("tax_rate,tax_components").eq("restaurant_id", rid).maybeSingle(),
        sb.from("aggregator_orders").select("source,total,status,created_at").eq("restaurant_id", rid).gte("created_at", since.toISOString()).limit(5000),
      ]);
      const allRows = must(ordersQ), dishes = must(dishesQ);
      const sinceMs = since.getTime(), prevSinceMs = prevSince.getTime();
      const orders = allRows.filter((o: { created_at: string }) => new Date(o.created_at).getTime() >= sinceMs);
      const prevRows = allRows.filter((o: { created_at: string }) => {
        const t = new Date(o.created_at).getTime();
        return t < sinceMs && t - prevSinceMs <= elapsedMs; // same-elapsed-time cut
      });
      // Same effective rate + discount-before-tax rule as billMath/Z-report (lib/tax.ts),
      // so the dashboard revenue agrees with the Bills tab and the printed bills. Was
      // summing the STORED order total (taxed at a flat 5% on the pre-discount subtotal).
      const rate = effectiveTaxRate(must(setQ) || {});
      const catOf: Record<string, string> = Object.fromEntries(dishes.map((d: { id: string; category?: string }) => [d.id, d.category || "other"]));
      const hours = Array(24).fill(0);
      const topD: Record<string, number> = {}, cats: Record<string, number> = {}, seriesMap: Record<string, number> = {};
      // Payment-method breakdown (owner, 2026-07-01): revenue + bill count per method
      // for whatever's ALREADY marked paid in this range — no extra query, same orders array.
      const paymentMethods: Record<string, { rev: number; bills: number }> = {};
      const bucket = range === "today" ? "hour" : range === "year" ? "month" : "day";
      // ALL hour-of-day stats bucket in IST explicitly — dt.getHours() was server-local,
      // which on Vercel (UTC) shifted the busy-hours chart by 5½ hours (latent bug).
      const IST_OFF = 5.5 * 3600e3;
      const istHour = (d: Date) => new Date(d.getTime() + IST_OFF).getUTCHours();
      const istDay = (d: Date) => (new Date(d.getTime() + IST_OFF).getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
      const keyFor = (d: Date) => bucket === "hour" ? String(istHour(d))
        : bucket === "month" ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : d.toISOString().slice(0, 10);
      // Day parts (PetPooja pattern): 7–11 breakfast · 11–15 lunch · 15–19 evening ·
      // 19–23 dinner · 23–7 late. Weekday×hour heatmap fills for 30d/year only —
      // today's window is too thin to mean anything.
      const DAY_PARTS = ["Breakfast 7–11", "Lunch 11–15", "Evening 15–19", "Dinner 19–23", "Late 23–7"] as const;
      const partOf = (h: number) => (h >= 7 && h < 11 ? 0 : h >= 11 && h < 15 ? 1 : h >= 15 && h < 19 ? 2 : h >= 19 && h < 23 ? 3 : 4);
      const dayParts = DAY_PARTS.map((label) => ({ label, revenue: 0, orders: 0 }));
      const heatmap: number[][] = range === "today" ? [] : Array.from({ length: 7 }, () => Array(24).fill(0));
      let paid = 0, unpaid = 0, cancelled = 0, revenue = 0, cancelledValue = 0, taxCollected = 0;
      let discTotal = 0, discCount = 0;
      let discMax: { amt: number; table: string } | null = null;
      let biggestBill: { amt: number; table: string } | null = null;
      // Counts + kitchen volume (hours/top-dishes/categories/day-part order counts) are
      // PER ORDER; every ₹ figure (revenue, series, payment methods, biggest bill, tax,
      // day-part revenue) is computed PER BILL below — a whole-bill discount is stored on
      // ONE order, so per-order clamping would drop the excess and overstate revenue.
      for (const o of orders) {
        const dt = new Date(o.created_at);
        const h = istHour(dt);
        if (o.status === "cancelled") {
          // What the cancelled order WOULD have billed (its own net, gross of tax) —
          // "lost business", shown on the dashboard as cancelledValue.
          cancelled++;
          cancelledValue += Math.max(0, (Number(o.subtotal) || 0) - (Number(o.discount) || 0)) * (1 + rate);
          continue;
        }
        if (o.payment_status === "paid") paid++; else unpaid++;
        const disc = Number(o.discount) || 0;
        if (disc > 0) {
          discTotal += disc * (1 + rate); discCount++;
          if (!discMax || disc * (1 + rate) > discMax.amt) discMax = { amt: disc * (1 + rate), table: String(o.table_number || "").trim() };
        }
        hours[h] += 1;
        dayParts[partOf(h)].orders++;
        if (heatmap.length) heatmap[istDay(dt)][h] += 1;
        for (const it of (Array.isArray(o.items) ? o.items : [])) {
          const q = Number(it.qty) || 1;
          if (it.title) topD[it.title] = (topD[it.title] || 0) + q;
          const c = catOf[it.id] || "other";
          cats[c] = (cats[c] || 0) + q;
        }
      }
      // Revenue / series / payment-methods / tax / day-part ₹ / biggest bill are PER BILL
      // (session), not per order. A whole-bill discount is stored on ONE order but is
      // capped at the whole-bill total, so clamping max(0, subtotal−discount) PER ORDER
      // dropped the excess and OVERSTATED revenue on multi-order tables. Group paid,
      // non-cancelled orders into bills and apply the discount to the bill,
      // discount-before-tax — matches billMath/Z-report.
      const billAgg = new Map<string, { sub: number; disc: number; dt: Date; method: string; table: string }>();
      for (const o of orders) {
        if (o.status === "cancelled" || o.payment_status !== "paid") continue;
        const key = o.session_id || ("solo:" + o.id);
        const b = billAgg.get(key) || { sub: 0, disc: 0, dt: new Date(o.created_at), method: o.payment_method || "Not recorded", table: String(o.table_number || "").trim() };
        b.sub += Number(o.subtotal) || 0;
        b.disc += Number(o.discount) || 0;
        const d = new Date(o.created_at); if (d < b.dt) b.dt = d; // earliest order = the bill's time
        if (!b.table) b.table = String(o.table_number || "").trim();
        billAgg.set(key, b);
      }
      for (const b of billAgg.values()) {
        const net = Math.max(0, b.sub - b.disc);
        const amt = net * (1 + rate);
        revenue += amt;
        taxCollected += net * rate;
        const k = keyFor(b.dt); seriesMap[k] = (seriesMap[k] || 0) + amt;
        const pm = paymentMethods[b.method] || (paymentMethods[b.method] = { rev: 0, bills: 0 });
        pm.rev += amt; pm.bills++;
        dayParts[partOf(istHour(b.dt))].revenue += amt;
        if (!biggestBill || amt > biggestBill.amt) biggestBill = { amt, table: b.table };
      }
      // Previous period (already cut at the same elapsed time): totals for the delta
      // chips + a bucket-aligned series so the sales chart can draw it as the dashed
      // "last time" ghost line. Same PER-BILL rule as above so the delta compares
      // like with like.
      const prevLen = bucket === "hour" ? 24 : bucket === "day" ? 30 : 12;
      const prevSeries = Array(prevLen).fill(0);
      let prevRevenue = 0, prevOrders = 0, prevCancelled = 0;
      const prevBills = new Map<string, { sub: number; disc: number; dt: Date }>();
      for (const o of prevRows) {
        if (o.status === "cancelled") { prevCancelled++; continue; }
        prevOrders++;
        if (o.payment_status !== "paid") continue;
        const key = o.session_id || ("solo:" + o.id);
        const b = prevBills.get(key) || { sub: 0, disc: 0, dt: new Date(o.created_at) };
        b.sub += Number(o.subtotal) || 0;
        b.disc += Number(o.discount) || 0;
        const d = new Date(o.created_at); if (d < b.dt) b.dt = d;
        prevBills.set(key, b);
      }
      for (const b of prevBills.values()) {
        const amt = Math.max(0, b.sub - b.disc) * (1 + rate);
        prevRevenue += amt;
        const idx = bucket === "hour" ? istHour(b.dt)
          : bucket === "day" ? Math.min(29, Math.max(0, Math.floor((b.dt.getTime() - prevSinceMs) / 864e5)))
          : Math.min(11, Math.max(0, (b.dt.getFullYear() - prevSince.getFullYear()) * 12 + b.dt.getMonth() - prevSince.getMonth()));
        prevSeries[idx] += amt;
      }
      // Channel split for the WHOLE range: dine-in from the same orders rows, the
      // three platform channels from the one scoped aggregator query above.
      const platRows = (must(platRangeQ) || []) as { source: string; total: number; status: string }[];
      const channels: Record<string, { rev: number; count: number }> = {
        dinein: { rev: 0, count: 0 }, zomato: { rev: 0, count: 0 }, swiggy: { rev: 0, count: 0 }, takeaway: { rev: 0, count: 0 },
      };
      for (const pr of platRows) {
        if (pr.status === "cancelled" || pr.status === "rejected") continue;
        const ch = channels[pr.source] || (channels[pr.source] = { rev: 0, count: 0 });
        ch.rev += Number(pr.total) || 0; ch.count++;
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
      const avgOrder = paid > 0 ? r2(revenue / paid) : 0;
      // Live per-channel snapshot for the Today summary box: open dine-in tables,
      // active platform orders by source, and today's platform totals (platform
      // orders live in aggregator_orders, separate from dine-in `orders`).
      const todayStart = new Date(businessDayStartIso()).toISOString();
      const [openSessQ, platActiveQ, platTodayQ] = await Promise.all([
        sb.from("sessions").select("id").eq("status", "open").eq("restaurant_id", rid),
        sb.from("aggregator_orders").select("source").eq("restaurant_id", rid).in("status", ["new", "accepted", "preparing", "ready"]),
        sb.from("aggregator_orders").select("total,status").eq("restaurant_id", rid).gte("created_at", todayStart),
      ]);
      const platActive = (must(platActiveQ) || []) as { source: string }[];
      // Platform revenue counts a delivery order only once it's ACCEPTED+ (never a
      // still-"new" ticket, never a cancelled one) — owner 2026-07-05, so today's
      // platform ₹ matches the Z-report's platform basis (both exclude cancelled).
      const platToday = ((must(platTodayQ) || []) as { total: number; status: string }[])
        .filter((r) => r.status !== "cancelled" && r.status !== "new");
      const live = {
        dineIn: ((must(openSessQ) || []) as unknown[]).length,
        zomato: platActive.filter((r) => r.source === "zomato").length,
        swiggy: platActive.filter((r) => r.source === "swiggy").length,
        takeaway: platActive.filter((r) => r.source === "takeaway").length,
      };
      const platformToday = { count: platToday.length, revenue: r2(platToday.reduce((sum, r) => sum + (Number(r.total) || 0), 0)) };
      // Dine-in channel = the collected dine-in figures computed above.
      channels.dinein = { rev: r2(revenue), count: paid };
      return ok({
        range, series, hours, cats, paid, unpaid, cancelled, revenue: r2(revenue),
        orderCount: orders.length, avgOrder,
        topDishes: Object.entries(topD).sort((a, b) => b[1] - a[1]).slice(0, 10),
        // [method, revenue, billCount] triples, biggest first (bill count shipped 2026-07-05
        // for the donut legend — same rows, no extra read; old clients ignore the 3rd slot).
        paymentMethods: Object.entries(paymentMethods).map(([method, v]) => [method, r2(v.rev), v.bills]).sort((a, b) => (b[1] as number) - (a[1] as number)),
        live, platformToday,
        // Crazy-dashboard fields (2026-07-05). prev is cut at the same elapsed time as
        // the current period, so deltas stay honest mid-day/mid-month.
        prev: { revenue: r2(prevRevenue), orders: prevOrders, cancelled: prevCancelled, series: prevSeries.map(r2) },
        dayParts: dayParts.map((d) => ({ ...d, revenue: r2(d.revenue) })),
        heatmap, // [] for today range; 7×24 Mon-first IST order counts otherwise
        discounts: { total: r2(discTotal), count: discCount, max: discMax ? { amt: r2(discMax.amt), table: discMax.table } : null },
        taxCollected: r2(taxCollected),
        biggestBill: biggestBill ? { amt: r2(biggestBill.amt), table: biggestBill.table } : null,
        cancelledValue: r2(cancelledValue),
        channels: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, { rev: r2(v.rev), count: v.count }])),
        updatedAt: now.toISOString(),
      });
    }


    if (p === "users") {
      const members = must(
        await sb.from("session_members")
          .select("id, name, phone, phone_verified, role, approved, removed, location_ok, joined_at, session:sessions(table_number, status)")
          .eq("restaurant_id", rid).order("joined_at", { ascending: false }).limit(120)
      );
      const customers = must(await sb.from("customers").select("*").eq("restaurant_id", rid).order("last_seen_at", { ascending: false }).limit(120));
      const blocklist = must(await sb.from("blocklist").select("*").eq("restaurant_id", rid).order("blocked_at", { ascending: false }));
      const orders = must(await sb.from("orders").select("member_id, total, created_at").eq("restaurant_id", rid).not("member_id", "is", null).order("created_at", { ascending: false }).limit(400));
      const calls = must(await sb.from("waiter_calls").select("member_id, note, created_at").eq("restaurant_id", rid).not("member_id", "is", null).order("created_at", { ascending: false }).limit(400));
      return ok({ members, customers, blocklist, orders, calls });
    }

    if (p === "oplog") {
      // The operation log: recent staff actions across all panels. HIERARCHY RULE
      // (owner, 2026-07-03 — "in the manager's logs there shouldn't be owner or admin
      // actions"): a lower role must never observe a higher role's activity. So the
      // ADMIN's actions (panel='admin') AND the OWNER's actions (panel='owner' —
      // staff changes, permission grants…) are both hidden here; they show only in
      // their own panels' logs.
      return ok(must(await sb.from("staff_actions").select("*").eq("restaurant_id", rid).not("panel", "in", "(admin,owner)").order("created_at", { ascending: false }).limit(200)));
    }

    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Wrapped so a replayed offline action runs at most once (see lib/idempotency.ts).
export const POST = withIdempotency(postImpl, "editor");
async function postImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which device (this editor screen) is acting

    // ── Raise an issue / complaint ────────────────────────────────────────────
    // A manager (or any staff) flags an operational problem for THIS restaurant; the
    // owner sees it on their issues page and the admin sees it as a platform complaint.
    if (a === "issue") {
      const subject = String((body as { subject?: string })?.subject || "").trim();
      if (!subject) return err("Please add a subject.", 400);
      const ins = await sb.from("issues").insert({
        restaurant_id: rid,
        subject,
        body: String((body as { body?: string })?.body || "").trim(),
        raised_by: g.user?.name || g.user?.username || "Manager",
        raised_role: g.user?.role || "manager",
      });
      if (ins.error) throw new Error(ins.error.message);
      return ok({ ok: true });
    }

    // ── Platform (Zomato/Swiggy/takeaway) orders ──────────────────────────────
    // platform/test — drop a random test order in (stands in for the real
    // aggregator webhook until API keys exist). Same insert path the webhook will use.
    if (a === "platform" && b === "test") {
      const SRC = ["zomato", "swiggy", "takeaway"];
      const src = SRC[Math.floor(Math.random() * SRC.length)];
      const dishes = must(await sb.from("menu_items").select("title, price").eq("restaurant_id", rid).limit(50)) || [];
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
        p_items: pick, p_total: total, p_restaurant_id: rid,
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
      // lfh_platform_set_status updates by id with NO tenant scope (mig 071); confirm this
      // platform order is THIS restaurant's before advancing it (service-role bypasses RLS).
      const owns = must(await sb.from("aggregator_orders").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!owns) return err("That platform order isn't for this restaurant.", 404);
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
      must(await sb.from("settings").update(patch).eq("restaurant_id", rid).select());
      await logAction("manager", "platform_toggle", { detail: JSON.stringify(patch), device_id: dev });
      return ok({ ok: true, ...patch });
    }

    // ── banquet (mig 130): item CRUD + bill generation. All rid-scoped; the
    // entitlement is re-checked here (and again inside the place RPC) so a
    // restaurant without the module can't be driven even by a forged client.
    if (a === "banquet") {
      const flags = await sb.from("settings").select("banquet_allowed").eq("restaurant_id", rid).maybeSingle();
      if (!(flags.data as { banquet_allowed?: boolean } | null)?.banquet_allowed) {
        return err("Banquet isn't enabled for this restaurant.", 403);
      }
      // banquet/item-save — create/update one banquet line ({ id?, title, price, unit, active, sort_order })
      if (b === "item-save") {
        if (!(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the banquet menu");
        const title = String(body?.title || "").trim().slice(0, 120);
        if (!title) return err("title required");
        const price = Math.max(0, Math.min(1_000_000, Number(body?.price) || 0));
        const unit = String(body?.unit ?? "per plate").trim().slice(0, 40);
        const patch = { title, price, unit, active: body?.active !== false, sort_order: Math.round(Number(body?.sort_order) || 0) };
        const row = body?.id
          ? must(await sb.from("banquet_items").update(patch).eq("id", String(body.id)).eq("restaurant_id", rid).select("id,title,price,unit,sort_order,active"))[0]
          : must(await sb.from("banquet_items").insert({ ...patch, restaurant_id: rid }).select("id,title,price,unit,sort_order,active"))[0];
        if (!row) return err("banquet item not found", 404);
        await logAction("manager", "banquet_item_save", { restaurant_id: rid, detail: `"${title}" ₹${price}`, device_id: dev });
        return ok(row);
      }
      // banquet/item-delete — { id }
      if (b === "item-delete") {
        if (!(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the banquet menu");
        must(await sb.from("banquet_items").delete().eq("id", String(body?.id || "")).eq("restaurant_id", rid).select("id"));
        await logAction("manager", "banquet_item_delete", { restaurant_id: rid, device_id: dev });
        return ok({ ok: true });
      }
      // banquet/place — { table?, lines:[{id, qty}] }. With a table the bill lands on
      // it like a normal order; WITHOUT one (mig 133) it lands as a standalone
      // "Walk-in / no table" bill in the Bills tab — no phantom table needed.
      if (b === "place") {
        const t = String(body?.table || "").trim();
        if (t) {
          if (!/^\d+$/.test(t)) return err("valid table required");
          const tcRow = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
          const tableCount = Number((tcRow.data as { table_count?: number } | null)?.table_count) || 0;
          if (tableCount > 0 && (Number(t) < 1 || Number(t) > tableCount)) return err(`Table ${t} doesn't exist (this place has ${tableCount} tables).`, 400);
        }
        const lines = Array.isArray(body?.lines) ? body.lines : [];
        if (!lines.length) return err("lines required");
        const { data, error } = await sb.rpc("lfh_banquet_place_order", { p_table: t || null, p_lines: lines, p_restaurant_id: rid });
        if (error) throw new Error(error.message);
        if (!(data as any)?.ok) return err(banquetErrMsg((data as any)?.reason), 400);
        await logAction("manager", "banquet_place", { restaurant_id: rid, table_number: t || null, detail: `total ${(data as any)?.total}`, device_id: dev });
        return ok(data);
      }
      return err("unknown banquet action", 404);
    }

    // orders/delete (bulk/clear) — keep settled bills.
    if (a === "orders" && b === "delete") {
      const { ids, all } = body || {};
       
      let candidates: any[];
      if (all) candidates = must(await sb.from("orders").select("id,payment_status,status").eq("restaurant_id", rid));
      else if (Array.isArray(ids) && ids.length) candidates = must(await sb.from("orders").select("id,payment_status,status").eq("restaurant_id", rid).in("id", ids));
      else return err("no ids");
      const deletable = candidates.filter((o) => !(o.payment_status === "paid" && o.status !== "cancelled")).map((o) => o.id);
      const kept = candidates.length - deletable.length;
      if (deletable.length) must(await sb.from("orders").delete().in("id", deletable));
      return ok({ ok: true, deleted: deletable.length, kept });
    }

    // orders/:id/discount | accept | serve-all | item
    if (a === "orders" && c === "discount") {
      if (!(await managerCan(g, rid, "give_discounts"))) return permDenied("give discounts");
      if (await invoiceLockedByOrder(b)) return err(LOCKED_MSG, 409);
      // .eq(restaurant_id, rid) on every by-id write: sb is service-role (RLS bypassed), so
      // this is the only tenant boundary — a foreign order id can't be discounted/edited.
      const cur = must(await sb.from("orders").select("total, session_id").eq("id", b).eq("restaurant_id", rid).single());
      // The discount is stored on ONE order but billMath sums every order's discount and
      // applies it to the WHOLE table's bill — so the cap must be the TABLE's total, not
      // this one order's (capping at the single order's total made a multi-order table's
      // discount silently clamp to the first order's amount — bug H8, 2026-07-05).
      let billCap = Number(cur.total) || 0;
      if (cur.session_id) {
        const sessOrders = must(await sb.from("orders").select("total, status").eq("restaurant_id", rid).eq("session_id", cur.session_id));
        billCap = sessOrders.filter((o: { status: string }) => o.status !== "cancelled")
          .reduce((a: number, o: { total: number | null }) => a + (Number(o.total) || 0), 0);
      }
      const raw = Number(body && body.amount);
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), billCap) : 0;
      const note = String((body && body.note) || "").slice(0, 200) || null;
      // return=minimal: client re-fetches the board; no need to pull the full order row back.
      must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", b).eq("restaurant_id", rid));
      return ok({ ok: true });
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
      const prev = must(await sb.from("orders").select("allergies").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      const oldOW = new Set((Array.isArray(prev?.allergies) ? prev.allergies : []).map((x: any) => String(x).toLowerCase()));
      const addedOW = allergies.filter((s) => !oldOW.has(s));
      const removedOW = [...oldOW].filter((s) => !allergies.includes(s));
      must(await sb.from("orders").update({ allergies, edited_at: nowIso() }).eq("id", b).eq("restaurant_id", rid));
      if (addedOW.length || removedOW.length) {
        const items = must(await sb.from("order_items").select("id, added_allergens, removed_flag").eq("order_id", b).eq("restaurant_id", rid));
        for (const it of items) {
          const mark = new Set((Array.isArray(it.added_allergens) ? it.added_allergens : []).map((x: any) => String(x).toLowerCase()));
          let rf = !!it.removed_flag;
          for (const s of addedOW) mark.add(s);
          for (const s of removedOW) { if (mark.has(s)) mark.delete(s); else rf = true; }
          await sb.from("order_items").update({ added_allergens: [...mark], removed_flag: rf }).eq("id", it.id).eq("restaurant_id", rid);
        }
      }
      const detail = [addedOW.length ? `added ${addedOW.join(", ")}` : "", removedOW.length ? `removed ${removedOW.join(", ")}` : ""].filter(Boolean).join("; ") || (allergies.join(", ") || "(none)");
      await logAction("editor", "order_allergies", { order_id: b, detail, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());

      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // return=minimal: client re-fetches the board → skip both the .select() and the full-row re-read.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      await logAction("editor", "order_accept", { order_id: b, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "serve-all") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());

      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await logAction("editor", "order_serve", { order_id: b, device_id: dev });
      // Only session_id is needed (for auto-settle); the client discards the body → not the full row.
      const servedRow = must(await sb.from("orders").select("session_id").eq("id", b).eq("restaurant_id", rid).single());
      await maybeAutoSettle((servedRow as any)?.session_id, { panel: "editor", deviceId: dev }); // serving may complete the table
      return ok({ ok: true });
    }
    if (a === "orders" && c === "item") {
      const idx = Number(body && body.index);
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());
      const items = Array.isArray(cur.items) ? cur.items : [];
      if (!items[idx]) return err("bad item index");
      items[idx] = { ...items[idx], status };

      const servedCount = items.filter((i: any) => i.status === "served").length;

      const orderStatus = servedCount === items.length ? "served"
        : items.some((i: any) => i.status === "preparing" || i.status === "served") ? "preparing" : "received";
      // Only session_id is needed (for auto-settle); the client discards the body.
      const row = must(await sb.from("orders").update({ items, status: orderStatus }).eq("id", b).eq("restaurant_id", rid).select("session_id"));
      if (status === "served") await maybeAutoSettle(row[0]?.session_id, { panel: "editor", deviceId: dev }); // serving may complete the table
      return ok({ ok: true });
    }

    // sessions/open — was 4 sequential DB round-trips (table_count check, existing-session
    // check, insert-or-update, approve requests); now ONE, via lfh_staff_open_table
    // (migration 114 — mirrors lfh_staff_open_all_tables' single-round-trip pattern for
    // the single-table case). Cut the "tap Open → table shows as open" latency roughly
    // in half (owner report, 2026-07-02 — felt like a 5+ second lag).
    if (a === "sessions" && b === "open") {
      const table = String((body && body.table) || "").trim();
      if (!table) return err("table required");
      if (!/^\d+$/.test(table) || Number(table) < 1) return err("invalid table number");
      const { data, error } = await sb.rpc("lfh_staff_open_table", { p_restaurant_id: rid, p_table: table });
      if (error) throw new Error(error.message);
      if (data && data.error) return err(data.error);
      await logAction("editor", "table_open", { table_number: table, device_id: dev });
      return ok(data || null);
    }

    // sessions/open-all — open EVERY not-yet-open table in ONE round-trip (mig 102), instead
    // of the client firing one POST /sessions/open per table (300 tables = 300 round-trips to
    // Sydney). The RPC mirrors the single-open logic + approves pending requests; the client
    // pairs it with optimistic tiles so the floor flips to "open" instantly.
    if (a === "sessions" && b === "open-all") {
      const { data, error } = await sb.rpc("lfh_staff_open_all_tables", { p_restaurant_id: rid });
      if (error) throw new Error(error.message);
      await logAction("editor", "table_open_all", { detail: `opened ${(data && data.opened) || 0}`, device_id: dev });
      return ok(data || { opened: 0 });
    }

    // sessions/close-all — close every CLOSEABLE open table in ONE round-trip (mig 103). Mirrors
    // closeSession's guard (skips tables that owe money or are still cooking) + archiving; returns
    // { closed, skipped, closed_tables } so the client can offer UNDO. force=false → same safety as
    // the per-table close (won't force-close unpaid/cooking tables).
    if (a === "sessions" && b === "close-all") {
      const { data, error } = await sb.rpc("lfh_staff_close_all_tables", { p_restaurant_id: rid, p_force: false });
      if (error) throw new Error(error.message);
      await logAction("editor", "table_close_all", { detail: `closed ${(data && data.closed) || 0}, skipped ${(data && data.skipped) || 0}`, device_id: dev });
      return ok(data || { closed: 0, skipped: 0, closed_tables: [] });
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
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS) — the
      // same rule applied to order/dish writes; a foreign session id can't be flipped.
      const row = must(await sb.from("sessions").update({ auto_approve: value }).eq("id", b).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }
    // sessions/:id/invoice — GENERATE the tax invoice (assign a permanent number,
    // lock the bill). Server-authoritative (totals computed from DB order rows).
    if (a === "sessions" && c === "invoice") {
      // lfh_generate_invoice takes only p_session (no tenant param) — confirm the session
      // is THIS restaurant's first (service-role bypasses RLS; a foreign session id must not
      // get an invoice generated against it).
      const ownsGen = must(await sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!ownsGen) return err("That table isn't for this restaurant.", 404);
      const { data, error } = await sb.rpc("lfh_generate_invoice", { p_session: b });
      if (error) throw new Error(error.message);
      await logAction("editor", "invoice_generate", { detail: `session ${b}`, device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
    }
    // sessions/:id/void-invoice — VOID it (reopen the bill for edits; number kept in record).
    if (a === "sessions" && c === "void-invoice") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("void bills");
      // Confirm the session belongs to THIS restaurant before voiding (RPC has no tenant param).
      const ownsVoid = must(await sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!ownsVoid) return err("That table isn't for this restaurant.", 404);
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
      // rid-scoped like every by-id write (service-role bypasses RLS → this is the boundary).
      const row = must(await sb.from("session_members").update({ approved: true }).eq("id", b).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }
    if (a === "members" && c === "remove") {
      const row = must(await sb.from("session_members").update({ removed: true }).eq("id", b).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }
    if (a === "members" && c === "make-head") {
      const found = must(await sb.from("session_members").select("id,session_id,role,removed").eq("id", b).eq("restaurant_id", rid).limit(1));
      const m = found[0];
      if (!m) return err("member not found", 404);
      const sessRows = must(await sb.from("sessions").select("status").eq("id", m.session_id).eq("restaurant_id", rid).limit(1));
      if (!sessRows[0] || sessRows[0].status !== "open") return err("table is not open");
      if (m.role === "owner" && !m.removed) return ok(m);
      must(await sb.from("session_members").update({ removed: true }).eq("session_id", m.session_id).eq("restaurant_id", rid).eq("role", "owner").eq("removed", false).select());
      const row = must(await sb.from("session_members").update({ role: "owner", approved: true, removed: false }).eq("id", m.id).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }

    // items/:id/delete — remove ONE dish (order_item) from a table's order and
    // reconcile the bill. CRITICAL (money): orders.total is a stored server-priced
    // number, so we DON'T just delete the row — the lfh_delete_order_item RPC
    // deletes it AND recomputes the order's subtotal/tax/total from the remaining
    // dishes (and cancels the order if it's now empty), all in one transaction.
    // The RPC refuses to touch a PAID bill. Returns { ok, items_left, total, ... }.
    if (a === "items" && c === "delete") {
      if (await invoiceLockedByItem(b)) return err(LOCKED_MSG, 409);
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
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/qty — STAFF EDIT: change ONE dish's quantity on a PLACED order.
    // Money-safe: the RPC clamps 1..99, updates the row, then re-prices the bill
    // from order_items (orders.total is a stored server-priced number). Refuses a
    // PAID/cancelled order. (owner, 2026-06-17 — gated behind the UI confirm.)
    if (a === "items" && c === "qty") {
      if (await invoiceLockedByItem(b)) return err(LOCKED_MSG, 409);
      const qty = Math.round(Number(body?.qty));
      if (!Number.isFinite(qty) || qty < 1) return err("invalid quantity");
      const { data, error } = await sb.rpc("lfh_staff_edit_item_qty", { p_item: b, p_qty: qty });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await logAction("editor", "order_item_qty", { order_id: data?.order_id, detail: `qty → ${data?.qty}`, device_id: dev });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/note — STAFF EDIT: change ONE dish's note on a PLACED order.
    if (a === "items" && c === "note") {
      const { data, error } = await sb.rpc("lfh_staff_edit_item_note", { p_item: b, p_note: String(body?.note ?? "") });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await logAction("editor", "order_item_note", { order_id: data?.order_id, device_id: dev });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/removed — STAFF EDIT: change ONE dish's removed/allergen list ("NO X")
    // on a PLACED order — add a missed allergen on just this dish, or UNDO one added by
    // mistake (the order-wide list has its own endpoint above). Removals don't change
    // the price, so a direct table write (service-role, already gated) is enough.
    // Allowed at ANY dish/order status (owner, 2026-07-03 — "allergy can be added to
    // all items"): unlike qty, this never touches money, so served/ready/paid is fine.
    // Still refused for a cancelled order — nothing was ever served, nothing to annotate.
    if (a === "items" && c === "removed") {
      const raw = Array.isArray(body?.removed) ? body.removed : [];
      const removed = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      // Fetch the CURRENT state so we can diff old→new and keep the per-dish edit
      // markers: which allergens were ADDED after placement (added_allergens, → a "＋"
      // beside each) and whether one was REMOVED (removed_flag, → a "✎−" on the name).
      // maybeSingle: a stale id returns null so the friendly "dish not found" 400 fires.
      const item = must(await sb.from("order_items").select("id, order_id, removed, added_allergens, removed_flag, status").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!item) return err(editErrMsg("item_not_found"), 400);
      // MERGE NOTE: the allergen branch removed the ready/served/paid rejections
      // (edits allowed at ANY status — see header comment); main independently added
      // restaurant_id scoping to this order lookup (tenancy hardening). Both kept.
      const order = must(await sb.from("orders").select("payment_status, status").eq("id", item.order_id).eq("restaurant_id", rid).maybeSingle());
      if (order?.status === "cancelled") return err(editErrMsg("order_cancelled"), 400);
      const oldSet = new Set((Array.isArray(item.removed) ? item.removed : []).map((x: any) => String(x).toLowerCase()));
      const justAdded = removed.filter((s) => !oldSet.has(s));
      const justRemoved = [...oldSet].filter((s) => !removed.includes(s));
      const addedMark = new Set((Array.isArray(item.added_allergens) ? item.added_allergens : []).map((x: any) => String(x).toLowerCase()));
      let removedFlag = !!item.removed_flag;
      for (const s of justAdded) addedMark.add(s);   // staff-added allergen → mark it "added"
      for (const s of justRemoved) { if (addedMark.has(s)) addedMark.delete(s); else removedFlag = true; } // un-mark a re-removed add; else flag a real removal
      const added_allergens = [...addedMark].filter((s) => removed.includes(s)); // keep only ones still present
      const rowU = must(await sb.from("order_items").update({ removed, added_allergens, removed_flag: removedFlag }).eq("id", b).eq("restaurant_id", rid).select());
      const detail = [justAdded.length ? `added ${justAdded.join(", ")}` : "", justRemoved.length ? `removed ${justRemoved.join(", ")}` : ""].filter(Boolean).join("; ") || "no change";
      await logAction("editor", "order_item_removed", { order_id: item.order_id, detail, device_id: dev });
      await stampEdited(item.order_id, rid);
      return ok(rowU[0] || { ok: true });
    }

    // orders/:id/add-item — STAFF EDIT: ADD a new dish to an already-placed order.
    // Server-priced (rejects unknown/sold-out), inserted as 'received', then the
    // bill is re-priced. Body: { dishId, qty, options?, removed?, note? }.
    if (a === "orders" && c === "add-item") {
      if (await invoiceLockedByOrder(b)) return err(LOCKED_MSG, 409);
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
      await stampEdited(b, rid);
      return ok(data);
    }

    // items/:id/status (session order_items)
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
       
      const patch: any = { status };
      if (status === "served") patch.served_at = nowIso();
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).eq("restaurant_id", rid).select());
      const item = updated[0];
      if (item && item.order_id) {
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id).eq("restaurant_id", rid));
        const total = rows.length;

        const served = rows.filter((r: any) => r.status === "served").length;

        const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
        const orderStatus = total > 0 && served === total ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: orderStatus }).eq("id", item.order_id).eq("restaurant_id", rid);
      }
      return ok(item || null);
    }

    // requests/:id/resolve
    if (a === "requests" && c === "resolve") {
      const status = body && body.status;
      if (!["approved", "denied"].includes(status)) return err("invalid status");
      const reqRow = must(await sb.from("requests").update({ status }).eq("id", b).eq("restaurant_id", rid).select())[0];
      if (status === "approved" && reqRow && reqRow.type === "open") {
        const existing = must(await sb.from("sessions").select("id").eq("table_number", reqRow.table_number).eq("restaurant_id", rid).neq("status", "closed").limit(1));
        if (!existing.length) must(await sb.from("sessions").insert({ table_number: reqRow.table_number, status: "open", opened_by: "waiter", opened_at: nowIso(), restaurant_id: rid }));
      }
      return ok(reqRow || null);
    }

    // blocklist (add)
    if (a === "blocklist" && path.length === 1) {
      const table = body.table ? String(body.table).trim() : null;
      let phone = body.phone ? String(body.phone).trim() : null;
      let device = body.device_id ? String(body.device_id).trim() : null; // block a staff device (tablet/kitchen)
      const memberId = body.member_id || null;
      if (!phone && !table && !device && !memberId) return err("phone, table, device_id, or member_id required");
      // Banning a specific member → also pull THEIR guest device id (and phone) so the
      // ban targets the device the guest actually uses, not just a phone they may never
      // have given. This is what makes the guest "you're blocked" wall stick. (077)
      if (memberId && !device) {
        const m = (await sb.from("session_members").select("device_id, phone").eq("id", memberId).maybeSingle()).data as { device_id?: string | null; phone?: string | null } | null;
        if (m?.device_id) device = m.device_id;
        if (!phone && m?.phone) phone = m.phone;
      }
      const row = must(await sb.from("blocklist").insert({ phone, table_number: table, device_id: device, member_id: memberId, reason: body.reason || "banned", restaurant_id: rid }).select())[0];
      if (phone) await sb.from("customers").upsert({ phone, blocked: true, restaurant_id: rid }, { onConflict: "restaurant_id,phone" });
      return ok(row || null);
    }

    // generic upsert: POST /:kind  (items | categories | filters | settings)
    if (path.length === 1) {
      const t = TABLES[a];
      if (!t) return err("unknown kind", 404);
      if ((a === "items" || a === "categories" || a === "filters") && !(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the menu");
      // Is the client CREATING a brand-new row vs EDITING an existing one? Read + strip the
      // transient hint once for every kind (it's never a real column). Lets a create refuse
      // to silently overwrite an existing row via the upsert's DO UPDATE arm.
      const isCreate = !!(body && typeof body === "object" && (body as Record<string, unknown>).__create === true);
      if (body && typeof body === "object") delete (body as Record<string, unknown>).__create;
      // A new category/filter must not clobber an existing one with the same slug (the upsert
      // keys on (restaurant_id,slug), so a dup-slug create would DO UPDATE over it — silent
      // data loss, 2026-07-06). Tell the user instead.
      if (isCreate && (a === "categories" || a === "filters") && body && typeof body === "object" && body.slug) {
        const clash = (await sb.from(t.name).select("slug").eq("restaurant_id", rid).eq("slug", String(body.slug)).maybeSingle()).data;
        if (clash) return err(`A ${a === "categories" ? "category" : "filter"} with that name already exists.`, 409);
      }
      // Settings save is owner-only unless the owner has granted a manager the power
      // (owner role always passes managerCan). Previously this endpoint had NO gate — any
      // authenticated staff could PATCH the settings row. (2026-07-04 audit #4)
      if (a === "settings" && !(await managerCan(g, rid, "edit_settings"))) return permDenied("change settings");
      if (a === "settings" && body && typeof body === "object") {
        // settings is ONE row per restaurant (UNIQUE restaurant_id) whose PRIMARY KEY id is
        // legacy ('site' for #1, the slug for others). It must NEVER come from the client:
        // the retention save sent id:'site', which collided with #1's PK on every OTHER
        // restaurant and 500'd the save (2026-07-06). Always use the EXISTING row's real id
        // (looked up by restaurant_id) so the upsert UPDATEs the right row; for a brand-new
        // restaurant with no row yet, fall back to the restaurant id (guaranteed unique, so
        // the INSERT can't collide with 'site').
        const existingSet = (await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle()).data as { id?: string } | null;
        (body as Record<string, unknown>).id = existingSet?.id || rid;
        // Admin-only ENTITLEMENTS (mig 107, e.g. auto_print_kot_allowed) are granted ONLY
        // from the admin panel (/aevinite). Strip them here so a manager/owner can't
        // self-grant an entitlement the admin controls. Any `*_allowed` flag is admin-only.
        for (const k of Object.keys(body)) if (/_allowed$/.test(k)) delete (body as Record<string, unknown>)[k];
        // settings is one row per restaurant (UNIQUE restaurant_id); matched by
        // restaurant_id at the upsert below — don't force the legacy id='site'
        // (that only ever matches restaurant #1's row).
        if ("table_count" in body) {
          const n = Math.round(Number(body.table_count));
          body.table_count = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 12;
        }
        for (const k of ["sessions_enabled", "require_location", "require_otp", "auto_print_kot"]) {
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
        // "Table setting" — per-table seat counts, keyed by table number ("1", "2", …).
        // Rebuild from scratch rather than trust the client shape: drops non-numeric
        // keys/values and clamps seats to 1..30, so a malformed request can't write an
        // array (setPath's array-vs-object ambiguity) or garbage into this JSONB column.
        // tax_components — the named tax breakdown [{label,rate%},…] (mig 117). Rebuild from
        // scratch (don't trust client shape): keep only entries with a non-empty label + a
        // finite rate in 0..100, cap the label length and the count (max 6 taxes), so a
        // malformed request can't write garbage into this JSONB column. Empty array = "not
        // configured" (the app falls back to tax_rate/5%).
        if ("tax_components" in body) {
          const raw = Array.isArray(body.tax_components) ? body.tax_components : [];
          body.tax_components = raw
            .map((c: any) => ({ label: String(c && c.label || "").trim().slice(0, 24), rate: Math.round((Number(c && c.rate) || 0) * 100) / 100 }))
            .filter((c: { label: string; rate: number }) => c.label && c.rate > 0 && c.rate <= 100)
            .slice(0, 6);
        }
        // bill_footer — free-text sign-off printed at the bottom of the customer bill
        // (mig 124). Blank/whitespace → null so the print falls back to its default.
        if ("bill_footer" in body) {
          const v = String(body.bill_footer ?? "").trim().slice(0, 200);
          body.bill_footer = v || null;
        }
        // tax_label — the word the ON-SCREEN merged tax line uses ("Tax"/"GST"/"VAT"…,
        // mig 125). Blank → null = the neutral default "Tax". Print is unaffected.
        if ("tax_label" in body) {
          const v = String(body.tax_label ?? "").trim().slice(0, 20);
          body.tax_label = v || null;
        }
        if ("table_seats" in body) {
          const raw = body.table_seats;
          const clean: Record<string, number> = {};
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw)) {
              const tn = parseInt(k, 10);
              const n = Math.round(Number(v));
              if (Number.isFinite(tn) && tn >= 1 && Number.isFinite(n)) clean[String(tn)] = Math.min(Math.max(n, 1), 30);
            }
          }
          body.table_seats = clean;
        }
        // table_names (mig 131) — display labels per table. Trimmed, capped at 24
        // chars; blank entries are dropped (the panel falls back to "T<n>").
        if ("table_names" in body) {
          const raw = body.table_names;
          const clean: Record<string, string> = {};
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw)) {
              const tn = parseInt(k, 10);
              const name = String(v ?? "").trim().slice(0, 24);
              if (Number.isFinite(tn) && tn >= 1 && name) clean[String(tn)] = name;
            }
          }
          body.table_names = clean;
        }
      }
      if (a === "items" && body && typeof body === "object") {
        // isCreate (create vs edit) was resolved + stripped above, shared across kinds.
        const slugify = (s: string) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (!body.slug && body.title) body.slug = slugify(body.title);
        // menu_items.id is the GLOBAL primary key. A bare slug-as-id would let a save
        // silently OVERWRITE another restaurant's (or this restaurant's own existing)
        // dish that happens to share the name. So we never trust a client-supplied id
        // to decide create-vs-overwrite:
        //   • CREATE → mint an id that is unique across ALL restaurants (namespaced for
        //     non-default tenants) and a slug unique WITHIN this restaurant, so a new
        //     dish can never clobber an existing row.
        //   • EDIT   → keep the id, but refuse if that id belongs to a DIFFERENT tenant.
        if (isCreate) {
          const base = body.slug || slugify(body.title) || "item";
          const nsBase = rid === DEFAULT_RESTAURANT_ID ? base : `${base}__${rid.slice(0, 8)}`;
          let candidate = nsBase, n = 1;
          // id is a global PK → the candidate must be free for EVERY restaurant.
          while ((await sb.from("menu_items").select("id").eq("id", candidate).maybeSingle()).data) {
            n += 1; candidate = `${nsBase}-${n}`;
          }
          body.id = candidate;
          // Keep the guest-facing slug unique within this restaurant so /item/<slug> is 1:1.
          let slugCand = body.slug || base, m = 1;
          while ((await sb.from("menu_items").select("id").eq("restaurant_id", rid).eq("slug", slugCand).maybeSingle()).data) {
            m += 1; slugCand = `${body.slug || base}-${m}`;
          }
          body.slug = slugCand;
        } else {
          if (!body.id) {
            const base = body.slug || slugify(body.title);
            body.id = rid === DEFAULT_RESTAURANT_ID ? base : `${base}__${rid.slice(0, 8)}`;
          }
          const owner = (await sb.from("menu_items").select("restaurant_id").eq("id", String(body.id)).maybeSingle()).data as { restaurant_id?: string } | null;
          if (owner && owner.restaurant_id !== rid) return err("That dish belongs to another restaurant", 409);
        }
      }
      // Stamp ownership + match the per-restaurant unique key: categories/filters are
      // keyed (restaurant_id, slug); settings is keyed (restaurant_id); menu_items
      // keeps its global id PK. So a save only ever touches THIS restaurant's row.
      body.restaurant_id = rid;
      const onConflict = a === "settings" ? "restaurant_id"
        : (a === "categories" || a === "filters") ? "restaurant_id,slug"
        : t.key;
      const data = must(await sb.from(t.name).upsert(body, { onConflict }).select());
      // Any of items/categories/filters/settings changes the SHARED guest menu →
      // bust this restaurant's cached bundle so guests see it within seconds.
      bustMenuCache(rid);
      return ok(data[0]);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export const PATCH = withIdempotency(patchImpl, "editor");
async function patchImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
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
        // How the money came in — asked by the "Mark paid" flow (owner, 2026-07-01). Optional:
        // the per-order correction toggle doesn't pass it, and that's fine — it buckets under
        // "Not recorded" in the payment-method breakdown (see lfh_owner_payment_breakdown).
        if (body.payment_status === "paid" && body.payment_method !== undefined) {
          if (!PAYMENT_METHODS.includes(body.payment_method)) return err("invalid payment_method");
          patch.payment_method = body.payment_method;
          patch.payment_note = String(body.payment_note || "").slice(0, 200) || null;
        }
      }
      if (body.archived !== undefined) patch.archived = body.archived === true;
      if (!Object.keys(patch).length) return err("nothing to update");
      const cur = must(await sb.from("orders").select("status,payment_status,archived,paid_at,archived_at,cancelled_at").eq("id", id).eq("restaurant_id", rid).single());
      if (patch.status === "cancelled" && cur.payment_status === "paid")
        return err("Can't cancel a paid order — mark it unpaid (refund) first.", 409);
      if (patch.payment_status === "paid" && cur.status === "cancelled")
        return err("Can't take payment on a cancelled order.", 409);
      // RULE (owner 2026-06-29): a bill can only be paid once the order is ACCEPTED (gone to
      // prepare). A brand-new 'received' order must be accepted first — you can't take payment
      // on something the kitchen hasn't confirmed. (No payment system yet; when one is added it
      // will auto-accept on payment and skip this phase — not now.)
      if (patch.payment_status === "paid" && cur.status === "received")
        return err("Accept the order first — a bill can only be paid once the order is accepted.", 409);
      // A settled bill (paid / freed / cancelled) can only be undone within a 30-min
      // grace window — after that it's aged into "Today's bills" for good (owner,
      // 2026-07-02). NULL timestamp (never settled, or settled before this shipped)
      // fails closed: treated as expired, not as "always restorable".
      const RESTORE_WINDOW_MS = 30 * 60 * 1000;
      const tooOld = (iso: string | null | undefined) =>
        !iso || (Date.now() - new Date(iso).getTime()) > RESTORE_WINDOW_MS;
      // Reverting a PAID bill to unpaid is a refund/correction, not a routine edit:
      // require a reason and ALWAYS log it, so collected cash can't be quietly
      // un-booked without a trace (theft control).
      if (patch.payment_status === "pending" && cur.payment_status === "paid") {
        if (tooOld(cur.paid_at)) return err("This bill was marked paid more than 30 minutes ago and can no longer be reverted.", 409);
        const reason = String((body && body.revert_reason) || "").trim();
        if (!reason) return err("Reverting a PAID bill needs a reason (refund/correction).", 409);
        await logAction("editor", "payment_revert", { order_id: id, detail: reason, device_id: deviceIdFrom(req) });
      }
      if (patch.archived === false && cur.archived === true) {
        if (tooOld(cur.archived_at)) return err("This bill was freed more than 30 minutes ago and can no longer be restored.", 409);
      }
      if (patch.status === "received" && cur.status === "cancelled") {
        if (tooOld(cur.cancelled_at)) return err("This order was cancelled more than 30 minutes ago and can no longer be restored.", 409);
      }
      // Stamp/clear the settle timestamps as their gating flags flip.
      if (patch.payment_status === "paid") patch.paid_at = new Date().toISOString();
      if (patch.payment_status === "pending") patch.paid_at = null;
      if (patch.archived === true) patch.archived_at = new Date().toISOString();
      if (patch.archived === false) patch.archived_at = null;
      if (patch.status === "cancelled") patch.cancelled_at = new Date().toISOString();
      if (patch.status === "received" && cur.status === "cancelled") patch.cancelled_at = null;
      // Only session_id is needed (for auto-settle on pay); the client discards the body → no full row.
      const data = must(await sb.from("orders").update(patch).eq("id", id).eq("restaurant_id", rid).select("session_id"));
      if (patch.payment_status === "paid") await maybeAutoSettle(data[0]?.session_id, { panel: "editor", deviceId: deviceIdFrom(req) }); // paying may complete the table
      return ok({ ok: true });
    }

    if (a === "calls" && id) {
      const data = must(await sb.from("waiter_calls").update({ resolved: body?.resolved === true }).eq("id", id).eq("restaurant_id", rid).select());
      return ok(data[0] || null);
    }

    return err("unknown PATCH endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export const DELETE = withIdempotency(deleteImpl, "editor");
async function deleteImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  try {
    const { path = [] } = await ctx.params;
    const [a, id] = path;

    if (a === "orders" && id) {
      const cur = must(await sb.from("orders").select("payment_status,status").eq("id", id).eq("restaurant_id", rid).single());
      if (cur && cur.payment_status === "paid" && cur.status !== "cancelled")
        return err("Won't delete a PAID bill — it's a financial record. Mark it unpaid or void it first.", 409);
      must(await sb.from("orders").delete().eq("id", id).eq("restaurant_id", rid));
      return ok({ ok: true });
    }

    if (a === "calls" && id) {
      must(await sb.from("waiter_calls").delete().eq("id", id).eq("restaurant_id", rid));
      return ok({ ok: true });
    }

    if (a === "blocklist" && id) {
      const existing = must(await sb.from("blocklist").select("*").eq("id", id).eq("restaurant_id", rid).limit(1));
      must(await sb.from("blocklist").delete().eq("id", id).eq("restaurant_id", rid));
      const phone = existing[0] && existing[0].phone;
      if (phone) {
        const others = must(await sb.from("blocklist").select("id").eq("phone", phone).eq("restaurant_id", rid).limit(1));
        if (!others.length) await sb.from("customers").update({ blocked: false }).eq("phone", phone).eq("restaurant_id", rid);
      }
      return ok({ ok: true });
    }

    // generic delete: DELETE /:kind/:id  (items | categories | filters | settings)
    if (a && id) {
      const t = TABLES[a];
      if (!t) return err("unknown kind", 404);
      if ((a === "items" || a === "categories" || a === "filters") && !(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the menu");
      // slug is unique only PER restaurant now (categories/filters), so a delete by
      // key MUST also pin the restaurant or it would wipe that slug everywhere.
      must(await sb.from(t.name).delete().eq(t.key, id).eq("restaurant_id", rid));
      // Reconcile dishes that still referenced the deleted category/filter, else they'd
      // keep a dead slug (a category chip that no longer exists / an orphan tag) — 2026-07-06.
      // Best-effort (the delete already succeeded): never fail the request on cleanup.
      try {
        if (a === "categories") {
          await sb.from("menu_items").update({ category: null }).eq("restaurant_id", rid).eq("category", id);
        } else if (a === "filters") {
          const { data: tagged } = await sb.from("menu_items").select("id,tags").eq("restaurant_id", rid).contains("tags", [id]);
          for (const d of ((tagged || []) as { id: string; tags: string[] | null }[])) {
            await sb.from("menu_items").update({ tags: (d.tags || []).filter((x) => x !== id) }).eq("id", d.id).eq("restaurant_id", rid);
          }
        }
      } catch { /* orphan cleanup is best-effort */ }
      // Deleting a dish/category/filter changes the SHARED guest menu → bust cache.
      bustMenuCache(rid);
      return ok({ ok: true });
    }

    return err("unknown DELETE endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
