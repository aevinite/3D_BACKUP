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
import { replayClash, clashJson, expectClash } from "@/lib/clash";
import { offPlanTable } from "@/lib/planTable";
import { menuTag } from "@/lib/menuDataServer";
import { logAction, logError, deviceIdFrom } from "@/lib/oplog";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { discountCapPct, discountRole, overDiscountCap } from "@/lib/discountCap";
import { businessDayStartIso } from "@/lib/businessDay";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { panelRestaurantId, emptyIdSegment } from "@/lib/panelScope";
import { enabledOwnedRestaurantIds } from "@/lib/panelAccess";
import { raiseIssue } from "@/lib/issues";
import { effectiveTaxRate, taxComponents } from "@/lib/tax";
import { closeSession, clearTableSignals } from "@/lib/sessionClose";
import { openTableSession } from "@/lib/openSession";
import { softDeleteOrders } from "@/lib/softDelete";
import { maybeAutoSettle } from "@/lib/autoSettle";
import { notifyAggregator } from "@/lib/aggregators";
import { PAYMENT_METHODS } from "@/lib/payments";
import { clampPerRow } from "@/lib/floorLayout";
import { MANAGER_POWER_FLAGS, powerEntitlementKey, getOwnerEntitlements } from "@/lib/ownerEntitlements";
import { isTableTag, tableTagsLadder, khataLadder, banquetLadder, tableOpsLadder, takeOrdersLadder, parcelLadder, platformLadder, allModuleLadders, COMP_TAGS, ON_THE_HOUSE_METHOD, type TableTag } from "@/lib/tableTags";
import { tableAssignLadder } from "@/lib/tableAssign";
import { PERMISSIONS, moduleKey, ABSENT_ON_POWERS } from "@/lib/accessModel";
import { managerTabsOff, managerTabOn, type ManagerTabKey } from "@/lib/accessTree";
import { saveBillCustomer } from "@/lib/billCustomer";
import { sharedFloorSummary, invalidateFloor } from "@/lib/floorSummary";

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
  if (!u) return true; // admin super-user — X-ray honesty, always passes
  if (u.role === "owner") {
    // The owner passes every power automatically EXCEPT menu editing, which now cascades
    // from the ADMIN rung (owner, 2026-07-25): when the admin turns menu editing OFF the
    // owner also drops to a read-only "View menu" — matching the ladder (a rung that's off
    // is refused by the server, not merely hidden). No extra DB read for any other power.
    if (flag !== "edit_menu") return true;
    const e = (await sb.from("restaurants").select("owner_entitlements").eq("id", rid).maybeSingle()).data as
      { owner_entitlements?: Record<string, boolean> } | null;
    return e?.owner_entitlements?.[powerEntitlementKey("edit_menu")] !== false;
  }
  const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle()).data as
    { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean> } | null;
  if (r?.owner_entitlements?.[powerEntitlementKey(flag)] === false) return false; // admin cap — nothing below re-grants
  // Per-person override (access panel → Per person, mig 115 staff_users.permissions):
  // an individual's setting WINS over the restaurant-wide owner→manager grant, but never
  // over the admin cap above. 'on'/'pin' = allow this person, 'off' = deny them, absent/
  // 'default' = fall through to the grant. Rides free on u.permissions (no extra query).
  const ov = u.permissions?.[flag];
  if (ov === "on" || ov === "pin") return true;
  if (ov === "off") return false;
  return !!r?.manager_permissions?.[flag];
}
const permDenied = (what: string) => err(`Your owner hasn't given managers permission to ${what}.`, 403);

// A row on the Platform board is gated by different rungs depending on what it is: a staff
// PARCEL (source 'parcel') rides the parcel module + power; a delivery order (zomato/swiggy/
// website=takeaway) rides the platform module + power. Admin/owner pass via managerCan's
// higher-view bypass; for a real manager the module must ALSO be effective (mig 209).
async function platformOrParcelCan(g: { user: StaffUser | null }, rid: string, source?: string): Promise<boolean> {
  const isParcel = source === "parcel";
  const flag = isParcel ? "parcel" : "platform";
  if (g.user) { const ladder = await (isParcel ? parcelLadder : platformLadder)(rid); if (!ladder.effective) return false; }
  return managerCan(g, rid, flag);
}

// Activity-log visibility (owner 2026-07-24, access panel "Activity log" power). Deliberately
// NON-BREAKING: a manager keeps the log UNLESS the admin or owner has EXPLICITLY switched
// view_logs off in the access panel (owner_entitlements.power_view_logs === false, or
// manager_permissions.view_logs === false). An absent flag = keep it (every restaurant that
// never touched the new panel is unchanged). Owner + admin (no staff cookie) always see it.
async function canViewLogs(g: { user: StaffUser | null }, rid: string): Promise<boolean> {
  const u = g.user;
  if (!u || u.role === "owner") return true;
  const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements").eq("id", rid).maybeSingle()).data as
    { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean> } | null;
  if (r?.owner_entitlements?.power_view_logs === false) return false;   // admin removed the whole power
  // Per-person override (mig 115) — same precedence as managerCan: the individual's
  // setting wins over the restaurant-wide grant but never over the admin cap above (it
  // was accepted by set_permissions but never read here — a stored-but-dead key, fixed
  // 2026-07-26).
  const ov = u.permissions?.view_logs;
  if (ov === "on" || ov === "pin") return true;
  if (ov === "off") return false;
  if (r?.manager_permissions?.view_logs === false) return false;        // owner pulled it back from managers
  return true;
}

// ── MANAGER'S MENU rung (access rebuild, 2026-07-31) ────────────────────────
// Which manager tabs this RESTAURANT has. Hiding a tab in the panel is never the only
// guard, so a switched-off tab's endpoints refuse here too — otherwise typing the URL
// still reached it. Deliberately ONE gate called from every handler rather than a check
// sprinkled per endpoint: a new endpoint under an existing tab is covered automatically.
// The lookup only runs for paths that belong to a tab, so ordinary requests pay nothing.
const TAB_PATHS: { tab: ManagerTabKey; test: (p: string) => boolean }[] = [
  { tab: "ratings", test: (p) => p === "ratings" || p.startsWith("ratings/") },
  { tab: "log", test: (p) => p === "oplog" || p.startsWith("oplog/") },
  { tab: "editor", test: (p) => /^(items|categories|filters)(\/|$)/.test(p) },
];
async function tabGate(g: { user: StaffUser | null }, rid: string, path: string[]): Promise<NextResponse | null> {
  if (!g.user) return null;                         // admin super-user keeps every tab
  const p = path.join("/");
  const hit = TAB_PATHS.find((t) => t.test(p));
  if (!hit) return null;
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config;
  if (managerTabOn(cfg, hit.tab)) return null;
  const LABEL: Record<ManagerTabKey, string> = { editor: "the menu editor", ratings: "guest ratings", log: "the activity log" };
  return err(`${LABEL[hit.tab]} isn't part of this restaurant's manager panel.`, 403);
}

// Granular Edit-the-menu sub-option gate (owner 2026-07-24). Only restricts a plain MANAGER:
// admin (no cookie) + owner pass fully. NON-BREAKING: if the owner hasn't configured
// access_config.edit_menu.manager_opts for this restaurant, allow everything (current behaviour
// for every un-migrated restaurant). When configured, a sub-option is allowed only if explicitly
// true. Caller must already have passed managerCan(edit_menu). Sub-actions: add_dish / edit_dish /
// delete_dish / manage_categories / manage_filters / edit_3d (edit_price & mark_86 ride edit_dish).
async function menuSubAllowed(g: { user: StaffUser | null }, rid: string, action: string): Promise<boolean> {
  const u = g.user;
  if (!u || u.role !== "manager") return true; // admin/owner: full menu editing
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
    { edit_menu?: { manager_opts?: Record<string, boolean> } } | null;
  const mo = cfg?.edit_menu?.manager_opts;
  if (!mo || typeof mo !== "object") return true; // not configured → non-breaking allow-all
  return mo[action] === true;
}

// Delete-a-bill sub-permission (owner 2026-07-24). Deleting a bill is the MOST destructive
// money action, so unlike the other void_bills sub-options (and unlike menuSubAllowed above)
// it defaults OFF: a plain manager may delete a bill ONLY when the owner has explicitly ticked
// "Delete a bill" (access_config.void_bills.manager_opts.delete_bill === true). Admin (no
// cookie) + owner always may. The caller must already have passed managerCan("void_bills").
async function canDeleteBill(g: { user: StaffUser | null }, rid: string): Promise<boolean> {
  const u = g.user;
  if (!u || u.role !== "manager") return true; // admin / owner: full power
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
    { void_bills?: { manager_opts?: Record<string, boolean> } } | null;
  return cfg?.void_bills?.manager_opts?.delete_bill === true; // absent → OFF (deliberate default)
}

// Gate for the KOT ▾ menu (Table & KOT operations — canonical module ladder, mig 177).
// ADMIN X-RAY rule (owner, 2026-07-22): the admin super-user (no staff cookie) passes
// every rung — from the admin console the greyed-out button must genuinely work, the
// same bypass tabletPerm gives the admin. Everyone else follows the ladder:
// Rung 1: the module must be effective (admin's allowed switch AND, when transferred,
// the owner's toggle) — stops the OWNER and managers alike (the admin caps the reach).
// Rung 2: a plain manager additionally needs the owner's table_ops grant (managerCan;
// the owner passes that rung automatically). Returns a response to short-circuit, or
// null to proceed.
async function tableOpsGate(g: { user: StaffUser | null }, rid: string): Promise<NextResponse | null> {
  if (!g.user) return null; // admin super-user: X-ray honesty — visible = usable
  if (!(await tableOpsLadder(rid)).effective) return err("Table & KOT operations aren't enabled for this restaurant.", 403);
  if (!(await managerCan(g, rid, "table_ops"))) return permDenied("use table & KOT operations");
  return null;
}

// Friendly message for the move/merge RPCs' { ok:false, reason } (migs 173/175).
const moveErrMsg = (reason?: string) =>
  reason === "no_order" ? "That order isn't there anymore — refresh."
  : reason === "item_not_found" ? "That dish is no longer on the order."
  : reason === "order_not_found" ? "That order no longer exists."
  : reason === "order_cancelled" ? "This order was cancelled — nothing to move."
  : reason === "order_paid" ? "Won't move a PAID order — mark it unpaid first."
  : reason === "bad_table" ? "Pick a valid table."
  : reason === "same_table" ? "That order is already on that table."
  : reason === "source_invoiced" ? "This bill is already invoiced — void or regenerate its invoice before moving an order off it."
  : reason === "target_invoiced" ? "The target table's bill is already invoiced — void or regenerate its invoice before moving an order onto it."
  : (reason || "Couldn't move the order.");

// Friendly message for lfh_staff_merge_tables' { ok:false, reason } (mig 174).
const mergeErrMsg = (reason?: string) =>
  reason === "no_session" ? "That table's session isn't there anymore — refresh."
  : reason === "session_closed" ? "This table is already closed — nothing to merge."
  : reason === "bad_table" ? "Pick a valid table."
  : reason === "same_table" ? "That's the same table."
  : reason === "target_not_open" ? "That table has no party — use Change table to move there instead."
  : reason === "source_invoiced" ? "This bill is already invoiced — void its invoice before merging."
  : reason === "target_invoiced" ? "The target table's bill is already invoiced — void its invoice before merging."
  : (reason || "Couldn't merge the tables.");

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

// Which restaurant this editor request acts on — the SINGLE choke point that also proves
// an OWNER's right to it. The owner menu editor (owner panel → Menu, 2026-07-25) opens the
// panel with ?rid=<one restaurant the owner owns>. Owner rows are pinned to a shared "home"
// namespace, so panelRestaurantId ignores their rid; instead we honor the ?rid HERE but ONLY
// after validating it against the owner's own portfolio (enabledOwnedRestaurantIds) — so a
// hand-forged rid for a restaurant they don't own is refused, never silently scoped. Other
// staff (manager/kitchen/tablet) stay pinned to their own restaurant; the admin super-user
// keeps the act-as path. Returns a rid, or a NextResponse (403/400) to short-circuit.
async function editorScope(req: NextRequest, g: { user: StaffUser | null }): Promise<string | NextResponse> {
  const u = g.user;
  if (u && u.role === "owner") {
    const urlRid = req.nextUrl.searchParams.get("rid");
    if (urlRid) {
      const owned = await enabledOwnedRestaurantIds(u.id);
      if (!owned.includes(urlRid)) return err("You can only edit restaurants you own.", 403);
      return urlRid;
    }
  }
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  return rid;
}

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
  // An open-price (as-per-MRP) dish carries no menu price, so the pricer refuses a line with
  // none. Without this the raw token "price_required" reached the staff toast.
  : reason === "price_required" ? "Type a price for that dish first — it's priced as-per-MRP."
  : "Couldn't edit the order — please try again.";

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
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  // Without this a failure was logged as bare "canceling statement due to statement
  // timeout" with no hint of WHICH read timed out, so the admin Repair page could only
  // offer an unfixable mystery — nobody could tell if it was the Dashboard, the Z-report
  // or the log. (bug 2026-07-28)
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path); if (tg) return tg; }
  const p = path.join("/");
  try {
    // customer-recognize?phone=… — repeat-customer lookup for the pay sheet
    // (Customer CRM, mig 212). Read-only, scoped by rid via the RPC. Never lists.
    if (p === "customer-recognize") {
      const phone = (new URL(req.url).searchParams.get("phone") || "").trim().slice(0, 20);
      if (!phone) return ok({ known: false });
      const { data, error } = await sb.rpc("lfh_recognize_customer", { p_phone: phone, p_restaurant_id: rid });
      if (error) throw new Error(error.message);
      return ok(data || { known: false });
    }

    // ── table-sections — who serves which table (waiter sections, mig 222) ────
    // The roster the section editor needs, and NOTHING else: id, display name, login,
    // active, assigned_tables. Deliberately not the full staff roster (that's
    // /api/owner/staff, gated by manage_staff) — a manager who may hand out sections
    // shouldn't thereby gain phone numbers and per-user permissions. Waiters only:
    // sections are a tablet concept.
    //
    // The ADMIN always gets an answer even when the module is off (x-ray rule: the admin
    // sees every feature, tinted, and it genuinely works); a real owner/manager needs the
    // module effective AND — for a manager — the granted power.
    if (p === "table-sections") {
      if (!(await managerCan(g, rid, "table_assign"))) return permDenied("give waiters their own tables");
      const [staff, settings] = await Promise.all([
        sb.from("staff_users").select("id, username, name, role, active, assigned_tables")
          .eq("restaurant_id", rid).eq("role", "tablet").is("deleted_at", null)
          .order("name", { ascending: true }).limit(200),
        sb.from("settings").select("table_count, table_names").eq("restaurant_id", rid).maybeSingle(),
      ]);
      return ok({
        moduleOn: true,   // sections are always on (owner 2026-07-30)
        waiters: must(staff) || [],
        tableCount: Number(must(settings)?.table_count) || 12,
        tableNames: must(settings)?.table_names || {},
      });
    }

    // customer-search?q=98250 — "who is this number?" for the bill's customer box.
    // Fired while the waiter is still typing, so it must stay tiny and quick: prefix-anchored
    // on the (restaurant_id, phone) index, at most 6 rows, only phone + name + visit count.
    // A complete number is normalised first, so +91 / leading-0 spellings find the same row.
    if (p === "customer-search") {
      const q = (new URL(req.url).searchParams.get("q") || "").replace(/\D/g, "").slice(0, 15);
      if (q.length < 3) return ok({ matches: [] });
      const { data, error } = await sb.rpc("lfh_customer_phone_search", { p_restaurant_id: rid, p_prefix: q, p_limit: 6 });
      if (error) throw new Error(error.message);
      return ok({ matches: Array.isArray(data) ? data : [] });
    }

    // whoami — boot signal for the panel's hierarchy X-ray (2026-07-05). Tells the
    // client WHO is viewing (admin super-user / owner / manager) and this restaurant's
    // manager_permissions, so the nav can HIDE a disabled feature for the real manager
    // but show it GREYED to a higher role (admin/owner) looking in. Read-only; the
    // server still enforces every capability (managerCan) regardless of what the UI shows.
    if (p === "whoami") {
      // ACTUAL-VIEW mode (owner, 2026-07-28): an admin-view tab may ask ?view=real —
      // answer exactly as the REAL manager would be answered (restaurant-wide grants, no
      // higher-view tinting), plus simulated:true so the client keeps its ribbon (the way
      // back to the full admin view). Read-only; every write gate still sees the admin.
      const simulate = !g.user && new URL(req.url).searchParams.get("view") === "real";
      const actor = g.user ? g.user.role : simulate ? "manager" : "admin"; // no staff user cookie = admin super-user
      const r = (await sb.from("restaurants").select("manager_permissions, owner_entitlements, access_config").eq("id", rid).maybeSingle()).data as
        { manager_permissions?: Record<string, boolean>; owner_entitlements?: Record<string, boolean>; access_config?: { edit_menu?: { manager_opts?: Record<string, boolean> } } } | null;
      // The ladder, resolved per power (mig 133): effective = admin entitles it AND the
      // owner granted it. The X-ray tints on !effective and can say WHO turned it off.
      const perms = r?.manager_permissions || {};
      const ents = r?.owner_entitlements || {};
      const effectivePowers: Record<string, boolean> = {};
      const offByAdmin: Record<string, boolean> = {};
      // The acting person's per-person overrides (mig 115) — so the manager UI hides a power
      // pulled from THIS individual, matching what managerCan enforces. Only for a real staff
      // login (admin/owner see the restaurant-wide picture; they bypass the gate anyway).
      const myOv = (g.user && g.user.role !== "owner") ? (g.user.permissions || {}) : {};
      for (const flag of MANAGER_POWER_FLAGS) {
        const entitled = ents[powerEntitlementKey(flag)] !== false;
        // absentOn flags (view_logs) keep the power unless someone EXPLICITLY switched it
        // off — matching canViewLogs, so the X-ray never hides a log the server allows.
        let granted = ABSENT_ON_POWERS.has(flag) ? perms[flag] !== false : perms[flag] === true;
        const ov = myOv[flag];
        if (ov === "on" || ov === "pin") granted = true;
        else if (ov === "off") granted = false;
        effectivePowers[flag] = entitled && granted;
        offByAdmin[flag] = !entitled;
      }
      // Feature-module rung (canonical ladder): a capability whose MODULE is off for this
      // restaurant renders nothing anywhere in the panel — the power flags above are the
      // owner→manager rung, this is the admin(/owner) application rung. ONE settings select
      // covers every module (accessModel MODULE_DEFS), and a module added there wires itself
      // here — this used to be five hand-written selects of the same row.
      const ladders = await allModuleLadders(rid);
      for (const mp of PERMISSIONS) {
        if (!mp.module || !mp.power) continue;
        if (!ladders[moduleKey(mp)]?.effective) effectivePowers[mp.power] = false;
      }
      // Finer edit-menu sub-limits (owner 2026-07-24): mirror menuSubAllowed's resolution so
      // the panel can HIDE a create/delete button a restricted MANAGER isn't allowed, instead
      // of showing-then-refusing it. Same rule as the server: admin/owner get full menu editing
      // (all true); a manager is limited only when the owner configured manager_opts, and then
      // only an EXPLICIT true allows it (an absent/unconfigured key stays ALLOWED = default).
      // "edit_options" (a dish's Size/Milk/Extras choice groups) joined this list in the
      // access rebuild — it is the "Customisation" row under Default set for user → Manager
      // → Edit menu, and without it here that row would save and never be read.
      const MENU_SUB_KEYS = ["edit_options", "add_dish", "edit_dish", "edit_price", "delete_dish", "mark_86", "manage_categories", "manage_filters", "edit_3d"];
      const mo = ((g.user && g.user.role === "manager") || simulate) ? r?.access_config?.edit_menu?.manager_opts : null;
      const menuRestricted = !!(mo && typeof mo === "object");
      const menuSub: Record<string, boolean> = {};
      for (const k of MENU_SUB_KEYS) menuSub[k] = menuRestricted ? mo![k] === true : true;
      return ok({
        actor,
        role: actor,
        // A higher role is "viewing" a lower panel when it's the admin super-user or an
        // owner opening the manager panel — those see greyed (not hidden) disabled items.
        // (In the simulate mode actor is already "manager", so this resolves false.)
        higherView: actor === "admin" || actor === "owner",
        simulated: simulate,
        managerPermissions: perms,
        effectivePowers,
        offByAdmin,
        menuSub,
        // MANAGER'S MENU (access rebuild): which tabs this RESTAURANT has at all — a
        // different question from what a PERSON may do, which is the powers above. The panel
        // removes these tabs entirely (never greys them), and the guards below refuse their
        // endpoints so a hidden tab can't be reached by typing a URL. The admin keeps
        // everything (admin = top power), so a switched-off tab stays inspectable.
        tabsOff: actor === "admin" ? [] : managerTabsOff(r?.access_config),
        // Delete-a-bill sub-permission (default OFF) — lets the panel show the "🗑 Delete bill"
        // button only when the owner ticked it (admin/owner always true; the simulate mode
        // resolves it like a real manager: only when the owner explicitly ticked it).
        canDeleteBill: simulate
          ? ((r?.access_config as { void_bills?: { manager_opts?: Record<string, boolean> } } | null)?.void_bills?.manager_opts?.delete_bill === true)
          : await canDeleteBill(g, rid),
        // One entry per module-backed capability (same keys as before: table_tags, khata,
        // banquet, table_ops, take_orders, parcel) — derived, so new modules appear here.
        features: Object.fromEntries(PERMISSIONS.filter((mp) => mp.module).map((mp) => [mp.id, !!ladders[moduleKey(mp)]?.effective])),
      });
    }

    // banquet/items — the banquet menu (mig 130). Manager-panel surface; only
    // exists when the admin entitlement is on (renders nothing otherwise, and the
    // place RPC re-checks server-side anyway). Includes inactive rows so the
    // manager can toggle them back on.
    if (p === "banquet/items") {
      // Full ladder (mig 167): admin switch AND (owner's toggle when transferred)
      // AND the owner->manager grant (backfilled true, so nothing changed by itself).
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
      const items = must(await sb.from("banquet_items")
        .select("id,title,price,unit,sort_order,active").eq("restaurant_id", rid)
        .order("sort_order").limit(200));
      return ok({ items });
    }

    // banquet/bills — the restaurant's own banquet bill ledger (mig 237), newest
    // first. Its own section, separate from table bills, with the numbers this
    // restaurant printed. Scoped + explicit columns + hard limit (egress rule);
    // `?q=` filters on the server so a search never pulls the whole ledger.
    if (p === "banquet/bills") {
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
      const q = String(new URL(req.url).searchParams.get("q") || "").trim().slice(0, 40);
      const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 40));
      let sel = sb.from("banquet_bills")
        .select("id,bill_no,issued_at,total,received,cust_name,cust_phone,hall,func,fn_date,pax,order_id,voided_at,void_reason")
        .eq("restaurant_id", rid);
      if (q) sel = sel.or(`cust_name.ilike.%${q}%,cust_phone.ilike.%${q}%,bill_no.ilike.%${q}%`);
      const bills = must(await sel.order("issued_at", { ascending: false }).limit(limit));
      return ok({ bills });
    }

    // banquet/bill?id= — ONE bill, everything needed to re-print exactly what was
    // printed the first time (frozen totals + the lines from its order).
    if (p === "banquet/bill") {
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
      const id = String(new URL(req.url).searchParams.get("id") || "");
      if (!id) return err("id required");
      const bill = must(await sb.from("banquet_bills").select("*").eq("id", id).eq("restaurant_id", rid).limit(1))[0];
      if (!bill) return err("bill not found", 404);
      const order = bill.order_id
        ? must(await sb.from("orders").select("id,items,subtotal,tax,total,discount,status").eq("id", bill.order_id).eq("restaurant_id", rid).limit(1))[0]
        : null;
      return ok({ bill, order });
    }

    // khata — the pay-later book, grouped by person (mig 166). Feature + khata power gated
    // (admin/owner pass managerCan automatically). Outstanding bills only; a bill = the
    // orders parked together (grouped by session, solo orders by their own id).
    if (p === "khata") {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("see the khata book");
      // ONE source of truth for the net-due math (mig 184): the RPC returns per-BILL open
      // rows; we group them into person → bills for the Pay Later view. The owner panel
      // calls the SAME RPC, so the two panels can never disagree on what's owed.
      const rows = (must(await sb.rpc("lfh_khata_outstanding", { p_restaurant_ids: [rid] })) || []) as any[];
      const byCust = new Map<string, any>();
      for (const r of rows) {
        let cst = byCust.get(r.khata_customer_id);
        if (!cst) { cst = { id: r.khata_customer_id, name: r.name, phone: r.phone, note: r.note, outstanding: 0, bills: [] }; byCust.set(r.khata_customer_id, cst); }
        const amt = Number(r.bill_amount) || 0;
        cst.bills.push({ key: r.bill_key, session_id: r.session_id, order_ids: r.order_ids || [], bill_no: r.bill_no, table_number: r.table_number, khata_at: r.khata_at, amount: amt });
        cst.outstanding = Math.round((cst.outstanding + amt) * 100) / 100;
      }
      const customers = [...byCust.values()].sort((x, y) => y.outstanding - x.outstanding);
      // "Collected today" — money actually received today (by paid_at), for the summary bar.
      const coll = (must(await sb.rpc("lfh_khata_collected", { p_restaurant_ids: [rid], p_from: businessDayStartIso(), p_to: nowIso() })) || []) as any[];
      const collectedToday = Math.round(coll.reduce((s, c) => s + (Number(c.collected) || 0), 0) * 100) / 100;
      return ok({ customers, total: Math.round(customers.reduce((s, cst) => s + cst.outstanding, 0) * 100) / 100, collectedToday });
    }

    // khata/customers?q= — the person picker's search (scoped, limited, debounced client-side).
    if (p === "khata/customers") {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("use the khata book");
      const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 60);
      let sel = sb.from("khata_customers").select("id,name,phone,note").eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(8);
      if (q) sel = sel.or(`name.ilike.%${q.replace(/[%,()]/g, "")}%,phone.ilike.%${q.replace(/[%,()]/g, "")}%`);
      const people = (must(await sel) || []) as any[];
      // Show each shown person's CURRENT tab so staff see they're adding to an existing
      // debt. Scoped to just the ≤8 shown people, riding the open-khata index (mig 166).
      if (people.length) {
        const openRows = (must(await sb.from("orders")
          .select("khata_customer_id,subtotal,tax,total,discount")
          .eq("restaurant_id", rid).in("khata_customer_id", people.map((p2) => p2.id))
          .not("khata_at", "is", null).neq("payment_status", "paid").neq("status", "cancelled")) || []) as any[];
        const owed = new Map<string, number>();
        for (const o of openRows) {
          const sub = Number(o.subtotal) || 0, tax = Number(o.tax) || 0, rate = sub > 0 ? tax / sub : 0;
          const due = Math.round(((Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate)) * 100) / 100;
          owed.set(o.khata_customer_id, Math.round(((owed.get(o.khata_customer_id) || 0) + due) * 100) / 100);
        }
        people.forEach((p2) => { p2.outstanding = owed.get(p2.id) || 0; });
      }
      return ok({ customers: people });
    }

    // onhouse?days=N — the "On the house" report (comp bills; would-be amount = the bill's
    // pre-discount value). Keyed on the reserved payment method, so it lists exactly the
    // bills settled through the on-the-house button. Dashboard power gates it.
    if (p === "onhouse") {
      if (g.user && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      const days = Math.min(Math.max(Math.round(Number(new URL(req.url).searchParams.get("days"))) || 30, 1), 365);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const rows = must(await sb.from("orders")
        .select("id,session_id,table_number,subtotal,tax,total,items,paid_at,payment_note")
        .eq("restaurant_id", rid).eq("payment_method", ON_THE_HOUSE_METHOD).eq("payment_status", "paid")
        .gte("paid_at", since).order("paid_at", { ascending: false }).limit(1000)) as any[];
      // Group orders into bills by session (solo orders stand alone), like the bills views.
      const bills = new Map<string, any>();
      for (const o of rows) {
        const key = o.session_id || o.id;
        const items = Array.isArray(o.items) ? o.items.reduce((s: number, it: any) => s + (Number(it.qty) || 1), 0) : 0;
        const bl = bills.get(key) || { key, table_number: o.table_number, paid_at: o.paid_at, note: o.payment_note || "", items: 0, would_be: 0 };
        bl.items += items;
        bl.would_be = Math.round((bl.would_be + (Number(o.total) || 0)) * 100) / 100; // pre-discount value
        bills.set(key, bl);
      }
      const list = [...bills.values()];
      return ok({ bills: list, count: list.length, total: Math.round(list.reduce((s, bl) => s + bl.would_be, 0) * 100) / 100 });
    }

    if (p === "all") {
      const [items, categories, filters, settings, restaurant] = await Promise.all([
        // SELECT * is kept here (the editor form edits every column), but bounded with a high
        // .limit() so this boot/refresh bundle can never become an unbounded whole-table read.
        sb.from("menu_items").select("*").eq("restaurant_id", rid).order("sort_order").limit(5000),
        sb.from("categories").select("*").eq("restaurant_id", rid).order("sort_order").limit(500),
        sb.from("filters").select("*").eq("restaurant_id", rid).order("sort_order").limit(500),
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

    // ── Guest ratings (mig 140) — manager view, gated by the view_ratings power ──
    // The owner grants a manager the ability to see + handle guest star-ratings.
    // Scoped to THIS restaurant; explicit columns + limit (egress-safe).
    if (p === "ratings") {
      if (!(await managerCan(g, rid, "view_ratings"))) return permDenied("see guest ratings");
      const onlyUnhandled = new URL(req.url).searchParams.get("filter") === "unhandled";
      const sum = await sb.rpc("lfh_ratings_summary", { p_ids: [rid] });
      if (sum.error) return err(sum.error.message, 500);
      const s = (sum.data?.[0] ?? {}) as Record<string, any>;
      const summary = {
        total: Number(s.total) || 0, avg: Number(s.avg) || 0,
        dist: [Number(s.s1) || 0, Number(s.s2) || 0, Number(s.s3) || 0, Number(s.s4) || 0, Number(s.s5) || 0],
        unhandled: Number(s.unhandled) || 0,
      };
      let rq = sb.from("feedback")
        .select("id, rating, comment, name, table_number, created_at, acknowledged, acknowledged_at, acknowledged_by, staff_note")
        .eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(200);
      if (onlyUnhandled) rq = rq.eq("acknowledged", false);
      return ok({ summary, ratings: must(await rq) || [] });
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
        // THE FLOOR SLICE — only the party sitting there NOW.
        //
        // This branch is used ONLY by the panel's live table slice (loadTableSlice /
        // pollTables); bill history goes through the ?history= branch above or the unscoped
        // list. It used to return the newest 200 orders EVER placed at that table number,
        // archived ones included — so the browser was handed nine-day-old food belonging to a
        // party that had long left, and one missing filter in the panel put it on the new
        // guests' screen and nearly on their bill (owner report, 2026-07-30; PR #578 fixed the
        // panel, this closes the door on the server side so no future panel can repeat it).
        //
        // Rule, identical to lfh_table_view_summary and to the panels: the table's CURRENT open
        // party, plus a party-LESS row at that table — but only one that appeared AFTER the party
        // sat down (owner report, 2026-07-31).
        //
        // "plus every session-less row" was too generous and it showed: table 2 carried two live
        // orders from 7 JULY with no session at all. The tile counted the party's 1 dish (correct);
        // this slice handed the browser all three, so the detail said 7 dishes / ₹6,048 and
        // "Mark all paid" would have charged tonight's guests for food ordered 24 days earlier.
        // An order older than the party cannot be the party's — while a genuinely party-less row
        // taken DURING this sitting (banquet, a legacy path) still counts, so nothing is hidden.
        // The 60s of slack covers an order that landed a moment before its session row existed.
        oq = oq.eq("table_number", tbl).eq("archived", false).is("deleted_at", null);
        {
          const liveSess = (await sb.from("sessions").select("id,opened_at").eq("restaurant_id", rid)
            .eq("table_number", tbl).eq("status", "open")
            .order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string; opened_at?: string } | undefined;
          if (liveSess) {
            const since = new Date(new Date(liveSess.opened_at || 0).getTime() - 60_000).toISOString();
            oq = oq.or(`session_id.eq.${liveSess.id},and(session_id.is.null,created_at.gte.${since})`);
          } else {
            const setRow = (await sb.from("settings").select("sessions_enabled").eq("restaurant_id", rid).maybeSingle()).data as { sessions_enabled?: boolean } | null;
            // No open party: with sessions ON there is nobody to own anything (the tile reads
            // free). With sessions OFF a table can still legitimately hold party-less legacy rows.
            if (setRow?.sessions_enabled) oq = oq.is("session_id", null);
          }
        }
      }
      const orders = must(await oq.order("created_at", { ascending: false }).limit(200));
      // Attach each order's SESSION invoice/bill state so the merged bill card knows
      // whether it's invoiced/locked (invoice lives on the session, not the order).
      const sids = [...new Set(orders.map((o: any) => o.session_id).filter(Boolean))];
      if (sids.length) {
        const [sessQ, memQ] = await Promise.all([
          sb.from("sessions").select("id,invoice_no,invoice_voided,invoice_at,bill_no,cust_name,cust_phone").in("id", sids),
          sb.from("session_members").select("session_id,name,role").in("session_id", sids).eq("role", "owner"),
        ]);
        const map: Record<string, any> = Object.fromEntries(((must(sessQ) || []) as any[]).map((s) => [s.id, s]));
        const nameMap: Record<string, string> = {};
        for (const m of (must(memQ) || []) as any[]) { if (m.name && !nameMap[m.session_id]) nameMap[m.session_id] = m.name; }
        for (const o of orders as any[]) {
          const s = map[o.session_id];
          if (s) {
            o.invoice_no = s.invoice_no; o.invoice_voided = s.invoice_voided; o.invoice_at = s.invoice_at; o.bill_no = s.bill_no;
            // who the BILL is made out to (captured at invoice time, mig 227). Kept apart
            // from customer_name below, which is the guest's own name on their phone.
            o.bill_cust_name = s.cust_name; o.bill_cust_phone = s.cust_phone;
          }
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
      // The Platform board is a ladder MODULE (mig 209). It shows delivery-app orders
      // (Zomato/Swiggy/website) when the platform module is effective AND that channel is on,
      // plus staff PARCELS (own source, own `parcel` module). Refuse only when BOTH are off.
      const [plat, parc] = await Promise.all([platformLadder(rid), parcelLadder(rid)]);
      if (!plat.effective && !parc.effective) return err("The Platform board isn't enabled for this restaurant.", 403);
      // Which delivery channels are live for this restaurant (settings.platform_channels).
      // website is stored under source 'takeaway' (the existing plumbing) but labelled "Website".
      const settingsRow = must(await sb.from("settings")
        .select("kitchen_can_accept_platform, platform_in_bills, platform_channels").eq("restaurant_id", rid).maybeSingle()) as
        { kitchen_can_accept_platform?: boolean; platform_in_bills?: boolean; platform_channels?: Record<string, { on?: boolean }> } | null;
      const chan = settingsRow?.platform_channels || {};
      const chOn = (k: string) => chan?.[k]?.on === true;
      // Build the set of sources this board may show: enabled delivery channels ∪ parcels.
      const sources: string[] = [];
      if (plat.effective) { if (chOn("zomato")) sources.push("zomato"); if (chOn("swiggy")) sources.push("swiggy"); if (chOn("website")) sources.push("takeaway"); }
      if (parc.effective) sources.push("parcel");
      const channels = { zomato: plat.effective && chOn("zomato"), swiggy: plat.effective && chOn("swiggy"), website: plat.effective && chOn("website") };
      // Nothing to show (module on but every channel off, parcel off) → empty board, no query.
      if (!sources.length) return ok({ orders: [], toggles: { ...(settingsRow || {}) }, channels, platform_on: plat.effective, parcel_on: parc.effective });
      // Active orders (any age) + just-handed-over ones (last 6 min): a handed-over
      // ticket lingers ~6 min in the board's "Handed over" column for a final glance,
      // then drops off the live board. Cancelled never show. (owner, 2026-06-21)
      const handoverCutoff = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      // Explicit column list (NOT select("*")) on this POLLED path — the board only renders
      // these, and select("*") pulled the heavy `payload` (full webhook body) + growing
      // `status_history` on every 60s/2s poll for nothing (egress). updated_at is only used
      // in the server-side filter below, so it doesn't need selecting. Scoped to the live sources.
      const rows = sb.from("aggregator_orders").select("id,source,items,total,status,kot_no,created_at,customer_name,paid").eq("restaurant_id", rid)
        .in("source", sources)
        .or(`status.eq.new,status.eq.accepted,status.eq.preparing,status.eq.ready,and(status.eq.handed_over,updated_at.gte.${handoverCutoff})`)
        .order("created_at", { ascending: false }).limit(200);
      return ok({ orders: must(await rows) || [], toggles: { kitchen_can_accept_platform: settingsRow?.kitchen_can_accept_platform, platform_in_bills: settingsRow?.platform_in_bills }, channels, platform_on: plat.effective, parcel_on: parc.effective });
    }

    // Day-close "Z report": the business-day totals, computed SERVER-SIDE from the DB
    // (discount BEFORE tax, same as billMath). Dine-in + platform + invoices/voids.
    if (p === "zreport") {
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      const since = businessDayStartIso();
      // The day-close report MUST see the WHOLE business day. A plain select is capped at
      // PostgREST's db-max-rows (~1000 rows), which on a busy day (>1000 orders) silently
      // computed the till on a truncated sample → understated cash. Page through every order
      // so the Z-report money is COMPLETE, not a partial read. (owner 2026-07-06)
      const orders: any[] = [];
      // Advance by the ACTUAL number of rows returned and stop only on an EMPTY page — so this
      // stays complete even if PostgREST's db-max-rows is configured below 1000 (a fixed +1000
      // step would break early and undercount there). Hard cap the loop as a safety belt.
      for (let from = 0, guard = 0; guard < 500; guard++) {
        const page = (must(await sb.from("orders").select("id,session_id,subtotal,discount,status,payment_status,tip")
          .eq("restaurant_id", rid).gte("created_at", since)
          .order("created_at", { ascending: true }).range(from, from + 999)) as any[] | null) || [];
        orders.push(...page);
        if (page.length === 0) break;
        from += page.length;
      }
      const [invQ, voidQ, platQ, setQ] = await Promise.all([
        sb.from("sessions").select("id").eq("restaurant_id", rid).gte("invoice_at", since).limit(50000),     // invoices GENERATED today
        sb.from("sessions").select("id").eq("restaurant_id", rid).gte("void_at", since).limit(50000),        // invoices VOIDED today
        sb.from("aggregator_orders").select("total,status").eq("restaurant_id", rid).gte("created_at", since).limit(5000),
        sb.from("settings").select("tax_rate,tax_components,restaurant_name,gstin,invoice_prefix").eq("restaurant_id", rid).maybeSingle(),
      ]);
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
      // Exclude cancelled AND still-"new" (pending, unaccepted) delivery orders — the same
      // filter the dashboard /stats uses — so the Z-report platform revenue matches the
      // dashboard's "today" box instead of counting money that hasn't been accepted yet.
      const platActive = plat.filter((p2) => p2.status !== "cancelled" && p2.status !== "new");
      const platRevenue = r2(platActive.reduce((a, p2) => a + (Number(p2.total) || 0), 0));
      // Tips collected today = SUM(orders.tip) over PAID, non-cancelled orders. Tips are EXTRA staff
      // money on top of the bill (never part of revenue/tax), so reported as their own figure.
      const tips = r2(orders.filter((o) => o.status !== "cancelled" && o.payment_status === "paid").reduce((a, o) => a + (Number(o.tip) || 0), 0));
      return ok({
        date: new Date().toLocaleDateString(), since,
        dineIn: { orderCount, bills: groups.size, gross: r2(gross), discount: r2(disc), taxable: r2(taxable), tax: r2(tax), net: r2(net),
          paidCount, paidNet: r2(paidNet), unpaidCount, unpaidNet: r2(unpaidNet), cancelled, tips },
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

    // MONTHLY GST REPORT (restaurant's OWN dine-in sales only — excludes aggregators). Paid bills
    // only, discount BEFORE tax, per-bill tax — the SAME single-source math as the Z-report/printed
    // bill. GST is filed per CALENDAR month, so the window is [month-01 00:00 IST, next-month-01 IST).
    if (p === "gst-report") {
      if (!(await managerCan(g, rid, "view_dashboard"))) return permDenied("view the dashboard");
      const sp = new URL(req.url).searchParams;
      const monthStr = /^\d{4}-\d{2}$/.test(sp.get("month") || "") ? sp.get("month")! : new Date().toISOString().slice(0, 7);
      const [y, m] = monthStr.split("-").map(Number);
      const startIso = new Date(`${monthStr}-01T00:00:00+05:30`).toISOString();
      const endIso = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00+05:30`).toISOString();
      // Complete read (page past PostgREST's ~1000-row cap) so a busy month isn't undercounted.
      const orders: any[] = [];
      for (let from = 0, guard = 0; guard < 500; guard++) {
        const page = (must(await sb.from("orders").select("id,session_id,subtotal,discount,status,payment_status,created_at")
          .eq("restaurant_id", rid).eq("payment_status", "paid").neq("status", "cancelled")
          .gte("created_at", startIso).lt("created_at", endIso)
          .order("created_at", { ascending: true }).range(from, from + 999)) as any[] | null) || [];
        orders.push(...page);
        if (page.length === 0) break;
        from += page.length;
      }
      const set = (must(await sb.from("settings").select("tax_rate,tax_components,restaurant_name,gstin").eq("restaurant_id", rid).maybeSingle()) || {}) as any;
      const rate = effectiveTaxRate(set);
      const comps = taxComponents(set);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const istDay = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
      // Group orders into BILLS by session (per-bill tax = printed-bill parity), remembering each bill's IST day.
      const bills = new Map<string, { sub: number; disc: number; day: string }>();
      for (const o of orders) {
        const key = o.session_id || ("solo:" + o.id);
        const b = bills.get(key) || { sub: 0, disc: 0, day: istDay(o.created_at) };
        b.sub += Number(o.subtotal) || 0; b.disc += Number(o.discount) || 0; b.day = istDay(o.created_at);
        bills.set(key, b);
      }
      const byDay = new Map<string, { taxable: number; tax: number; gross: number; bills: number }>();
      let taxable = 0, tax = 0, gross = 0;
      for (const b of bills.values()) {
        const tx = Math.max(0, b.sub - b.disc), t = r2(tx * rate), tot = r2(tx + t);
        taxable += tx; tax += t; gross += tot;
        const d = byDay.get(b.day) || { taxable: 0, tax: 0, gross: 0, bills: 0 };
        d.taxable += tx; d.tax += t; d.gross += tot; d.bills += 1; byDay.set(b.day, d);
      }
      // CGST/SGST must add back to the SAME total tax shown (and thus to the grand total). The
      // total tax is summed with PER-BILL rounding; computing each component off the whole-month
      // taxable base rounds at a different point, so the split wouldn't reconcile on the filing
      // document (off by a few paise/rupees). Split the ACTUAL rounded total tax by component rate
      // instead, with the last component absorbing the remainder → the parts sum to tax exactly.
      const taxR2 = r2(tax);
      const compRateSum = comps.reduce((s, c) => s + c.rate, 0);
      let compAllocated = 0;
      const components = comps.map((c, i) => {
        const amount = compRateSum > 0 && i < comps.length - 1 ? r2(taxR2 * (c.rate / compRateSum)) : r2(taxR2 - compAllocated);
        compAllocated += amount;
        return { label: c.label, rate: c.rate, amount };
      });
      return ok({
        month: monthStr,
        restaurant: { name: set.restaurant_name || "Little French House", gstin: set.gstin || "" },
        ratePct: Math.round(rate * 10000) / 100,
        components,
        totals: { bills: bills.size, taxable: r2(taxable), tax: r2(tax), gross: r2(gross) },
        days: [...byDay.entries()].sort().map(([date, v]) => ({ date, taxable: r2(v.taxable), tax: r2(v.tax), gross: r2(v.gross), bills: v.bills })),
        note: "Paid dine-in bills only (this restaurant's own sales; excludes Zomato/Swiggy). Discount applied before tax.",
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
      // ?table= must be a NUMBER. A non-numeric value reached the RPC and Postgres threw
      // "invalid input syntax for type integer" — 15 of those landed in the error log in one
      // burst, and each one is a 500 that blanks the caller's refetch. A bad param should
      // simply mean "no targeted table" (a full, correct refresh), never an error.
      const tblRaw = new URL(req.url).searchParams.get("table");
      const tbl = tblRaw !== null && /^\d{1,6}$/.test(tblRaw.trim()) ? tblRaw.trim() : null;
      // Whole-floor reads for the SAME restaurant inside a 1.5s window share ONE database call
      // (lib/floorSummary.ts). Several devices polling the 300-table floor together used to
      // queue ~1,800 statements each and cross the statement timeout — that is what filled the
      // error log and pinged the owner. A targeted ?table= refetch is never shared, so a tile
      // still updates the instant its order lands.
      const { data, error } = tbl
        ? await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: tbl })
        : await sharedFloorSummary(`floor:${rid}`, async () => await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: null }));
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
      // TODAY ONLY for real staff (owner 2026-07-29): the 30-day and 12-month dashboards are
      // admin/owner reporting surfaces — the manager panel shows today's numbers. The panel
      // hides the other two sub-nav rows; this is the matching server rule, so asking for a
      // wide range in the URL just returns today instead. The OWNER (their own restaurants)
      // and the admin super-user (no staff cookie) keep every range.
      const askedRange = new URL(req.url).searchParams.get("range") || "30d";
      const range = g.user && g.user.role !== "owner" ? "today" : askedRange;
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
      const [dishesQ, setQ, platRangeQ] = await Promise.all([
        sb.from("menu_items").select("id,title,category").eq("restaurant_id", rid),
        sb.from("settings").select("tax_rate,tax_components,takeaway_allowed,takeaway_owner_control,takeaway_enabled,platform_channels").eq("restaurant_id", rid).maybeSingle(),
        sb.from("aggregator_orders").select("source,total,status,created_at").eq("restaurant_id", rid).gte("created_at", since.toISOString()).limit(5000),
      ]);
      // Page through EVERY order in the window. A single .limit(50000) is silently capped by
      // PostgREST's db-max-rows (~1000), so on a busy restaurant the dashboard read only the newest
      // ~1000 orders and UNDER-counted revenue / orders / deltas (this made the Dashboard disagree
      // with the owner panel, whose SQL SUM has no row cap). The Z-report already pages around this;
      // /stats now does too. (B9 root cause — dashboard truncation.) On-demand endpoint, never polled;
      // pre-aggregated summary table is the extreme-scale follow-up per CLAUDE.md.
      const allRows: any[] = [];
      // Page NEWEST-first, capped at STATS_ROW_CAP rows. A single big .limit() is silently capped by
      // PostgREST's db-max-rows (~1000) — which truncated the dashboard to the newest ~1000 orders and
      // under-counted a busy restaurant (why it disagreed with the owner panel). Paging fixes that; the
      // cap stops a huge range from turning the dashboard into a slow, egress-heavy full-table scan.
      // Newest-first keeps the RECENT window complete + deterministic. So "Today" and "30 days" are
      // exact for a normal restaurant. A very-high-volume FULL YEAR can still exceed the cap → its
      // totals reflect only the most recent STATS_ROW_CAP orders, so we return truncated:true and the
      // dashboard shows an HONEST "most recent N orders" note instead of a silently-too-low number.
      // Penny-exact big-range totals are the planned pre-aggregated-summary follow-up (CLAUDE.md:
      // dashboards read summaries, not live scans) — that fix needs the owner to sign off on the numbers.
      // Cap = 12k (was 5k): a busy/demo restaurant's 30-day window spans ~60 days of rows (current +
      // previous period for the delta chips), which exceeded 5k and truncated the 30-day total; 12k keeps
      // the common Today/30-day demo views COMPLETE (no truncation note) while still bounding a full scan.
      const STATS_ROW_CAP = 12000;
      const STATS_PAGE = 1000;
      let statsTruncated = false;
      const statsPage = (from: number) => sb.from("orders").select("id,session_id,subtotal,total,discount,status,payment_status,payment_method,created_at,items,table_number").eq("restaurant_id", rid).gte("created_at", prevSince.toISOString()).order("created_at", { ascending: false }).range(from, from + STATS_PAGE - 1);
      // Fetch those pages in DOUBLING PARALLEL WAVES — 1, then 2, then 4, then 8 at a time —
      // stopping the moment a wave comes back short. This used to be up to 12 STRICTLY
      // SEQUENTIAL round-trips: on the busiest restaurant a full-year Dashboard spent ~5.5s
      // just queueing, close enough to Postgres' statement timeout that a burst of panel
      // traffic tipped it over into "canceling statement due to statement timeout" (the error
      // the owner kept seeing, 2026-07-28). Same page size, same rows, same order, same
      // numbers — only the WAITING is now concurrent. Measured on the busiest demo restaurant:
      // full-year Dashboard 5.5s → 2.3s under load, 3.0s → 1.0s idle.
      //
      // Why doubling instead of firing all 12 at once: an OFFSET page still has to walk the
      // rows before it, so pages past the end of the data are not free. Doubling bounds the
      // wasted reads (at most one extra wave past the end) while cutting round-trips from 12
      // to at most 4. A restaurant with under a page of orders in the window still issues
      // exactly ONE query, exactly as before.
      let statsFrom = 0;
      let statsWave = 1;
      while (statsFrom < STATS_ROW_CAP) {
        const offsets: number[] = [];
        for (let i = 0; i < statsWave && statsFrom < STATS_ROW_CAP; i++, statsFrom += STATS_PAGE) offsets.push(statsFrom);
        const pages = (await Promise.all(offsets.map((from) => statsPage(from))))
          .map((r) => ((must(r) as any[] | null) || []));
        for (const page of pages) allRows.push(...page); // offset order = the old loop's order
        // A short page means the data ran out — nothing after it can be full, so stop here.
        if (pages.some((page) => page.length < STATS_PAGE)) break;
        // Every page full AND the cap is consumed → older orders exist beyond it, so the
        // dashboard shows its honest "most recent N orders" note. Same rule as the old loop.
        if (statsFrom >= STATS_ROW_CAP) statsTruncated = true;
        statsWave *= 2;
      }
      const oldestLoadedIso = allRows.length ? allRows[allRows.length - 1].created_at : null;
      const dishes = must(dishesQ);
      const sinceMs = since.getTime(), prevSinceMs = prevSince.getTime();
      const orders = allRows.filter((o: { created_at: string }) => new Date(o.created_at).getTime() >= sinceMs);
      const prevRows = allRows.filter((o: { created_at: string }) => {
        const t = new Date(o.created_at).getTime();
        return t < sinceMs && t - prevSinceMs <= elapsedMs; // same-elapsed-time cut
      });
      // Same effective rate + discount-before-tax rule as billMath/Z-report (lib/tax.ts),
      // so the dashboard revenue agrees with the Bills tab and the printed bills. Was
      // summing the STORED order total (taxed at a flat 5% on the pre-discount subtotal).
      const setRow = (must(setQ) || {}) as Record<string, any>;
      const rate = effectiveTaxRate(setRow);
      // Which platform surfaces are live (mig 209) — so the dashboard hides dead channels for a
      // restaurant that isn't on the delivery apps. moduleLadder formula, computed from the
      // columns already fetched above (no extra query).
      // ONE module (takeaway_*) since mig 235; the retired columns are no longer written, so
      // reading them made the dashboard disagree with the board it was summarising.
      const takeawayOnDash = setRow.takeaway_allowed === true && (setRow.takeaway_owner_control !== true || setRow.takeaway_enabled !== false);
      const platOnDash = takeawayOnDash, parcelOnDash = takeawayOnDash;
      const dashChan = (setRow.platform_channels || {}) as Record<string, { on?: boolean }>;
      const channelsOn = { zomato: platOnDash && dashChan.zomato?.on === true, swiggy: platOnDash && dashChan.swiggy?.on === true, website: platOnDash && dashChan.website?.on === true, parcel: parcelOnDash };
      const catOf: Record<string, string> = Object.fromEntries(dishes.map((d: { id: string; category?: string }) => [d.id, d.category || "other"]));
      const hours = Array(24).fill(0);
      const topD: Record<string, number> = {}, cats: Record<string, number> = {}, seriesMap: Record<string, number> = {};
      const dishAgg: Record<string, { units: number; rev: number }> = {}; // per-dish PAID units + gross ₹ → menu star/dog matrix
      // Payment-method breakdown (owner, 2026-07-01): revenue + bill count per method
      // for whatever's ALREADY marked paid in this range — no extra query, same orders array.
      const paymentMethods: Record<string, { rev: number; bills: number }> = {};
      const bucket = range === "today" ? "hour" : range === "year" ? "month" : "day";
      // ALL hour-of-day stats bucket in IST explicitly — dt.getHours() was server-local,
      // which on Vercel (UTC) shifted the busy-hours chart by 5½ hours (latent bug).
      const IST_OFF = 5.5 * 3600e3;
      const istHour = (d: Date) => new Date(d.getTime() + IST_OFF).getUTCHours();
      const istDay = (d: Date) => (new Date(d.getTime() + IST_OFF).getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
      // Day/month bucket KEYS in IST too (they used to be UTC via toISOString()/getMonth(),
      // while the hour buckets were already IST — so a post-midnight sale landed on the wrong
      // day/bar and the axis labels were off by a day). One time zone everywhere now.
      const istParts = (d: Date) => { const i = new Date(d.getTime() + IST_OFF); return { y: i.getUTCFullYear(), m: i.getUTCMonth(), day: i.getUTCDate() }; };
      const dayKey = (d: Date) => { const p = istParts(d); return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; };
      const monthKey = (d: Date) => { const p = istParts(d); return `${p.y}-${String(p.m + 1).padStart(2, "0")}`; };
      const keyFor = (d: Date) => bucket === "hour" ? String(istHour(d))
        : bucket === "month" ? monthKey(d)
        : dayKey(d);
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
        const oPaid = o.payment_status === "paid";
        for (const it of (Array.isArray(o.items) ? o.items : [])) {
          const q = Number(it.qty) || 1;
          if (it.title) topD[it.title] = (topD[it.title] || 0) + q;
          const c = catOf[it.id] || "other";
          cats[c] = (cats[c] || 0) + q;
          // menu-matrix: gross ₹ per dish on PAID bills (menu price × qty; discounts are bill-level).
          if (oPaid) { const key = it.title || it.slug || "?"; const dd = dishAgg[key] || (dishAgg[key] = { units: 0, rev: 0 }); dd.units += q; dd.rev += q * (Number(it.price) || 0); }
        }
      }
      // Revenue / series / payment-methods / tax / day-part ₹ / biggest bill are PER BILL
      // (session), not per order. A whole-bill discount is stored on ONE order but is
      // capped at the whole-bill total, so clamping max(0, subtotal−discount) PER ORDER
      // dropped the excess and OVERSTATED revenue on multi-order tables. Group paid,
      // non-cancelled orders into bills and apply the discount to the bill,
      // discount-before-tax — matches billMath/Z-report.
      const billAgg = new Map<string, { sub: number; disc: number; tot: number; dt: Date; method: string; table: string }>();
      for (const o of orders) {
        if (o.status === "cancelled" || o.payment_status !== "paid") continue;
        const key = o.session_id || ("solo:" + o.id);
        const b = billAgg.get(key) || { sub: 0, disc: 0, tot: 0, dt: new Date(o.created_at), method: o.payment_method || "Not recorded", table: String(o.table_number || "").trim() };
        b.sub += Number(o.subtotal) || 0;
        b.disc += Number(o.discount) || 0;
        b.tot += Number(o.total) || 0; // stored gross total (frozen at payment) — the collected basis (B9)
        const d = new Date(o.created_at); if (d < b.dt) b.dt = d; // earliest order = the bill's time
        if (!b.table) b.table = String(o.table_number || "").trim();
        billAgg.set(key, b);
      }
      for (const b of billAgg.values()) {
        const net = Math.max(0, b.sub - b.disc);
        // Revenue = WHAT WAS COLLECTED, frozen at payment time: the stored bill total minus the
        // (grossed) discount — the SAME basis the owner panel uses (mig 140: total − discount×(1+rate)),
        // so the two screens always agree and a later tax-rate change never rewrites a past month.
        // (B9; was net*(1+currentRate), which retroactively re-taxed old bills at today's rate.)
        const amt = Math.max(0, (Number(b.tot) || 0) - b.disc * (1 + rate));
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
      const prevBills = new Map<string, { sub: number; disc: number; tot: number; dt: Date }>();
      for (const o of prevRows) {
        if (o.status === "cancelled") { prevCancelled++; continue; }
        prevOrders++;
        if (o.payment_status !== "paid") continue;
        const key = o.session_id || ("solo:" + o.id);
        const b = prevBills.get(key) || { sub: 0, disc: 0, tot: 0, dt: new Date(o.created_at) };
        b.sub += Number(o.subtotal) || 0;
        b.disc += Number(o.discount) || 0;
        b.tot += Number(o.total) || 0;
        const d = new Date(o.created_at); if (d < b.dt) b.dt = d;
        prevBills.set(key, b);
      }
      for (const b of prevBills.values()) {
        const amt = Math.max(0, (Number(b.tot) || 0) - b.disc * (1 + rate)); // collected basis (B9), matches billAgg + owner
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
        dinein: { rev: 0, count: 0 }, zomato: { rev: 0, count: 0 }, swiggy: { rev: 0, count: 0 }, takeaway: { rev: 0, count: 0 }, parcel: { rev: 0, count: 0 },
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
        // Build the last-30 IST days with the SAME dayKey the data was bucketed by (IST has no
        // DST, so stepping back 24h holds the IST wall-clock and gives consecutive IST dates).
        for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = dayKey(d); series.push({ label: k.slice(5), revenue: r2(seriesMap[k] || 0) }); }
      } else {
        const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const istNow = new Date(Date.now() + IST_OFF);
        for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - i, 1)); const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; series.push({ label: MN[d.getUTCMonth()], revenue: r2(seriesMap[k] || 0) }); }
      }
      // Average per BILL (revenue is aggregated per bill): divide by the number of paid BILLS,
      // not paid ORDERS — dividing by orders understated the average on any multi-order table,
      // and the card is labelled "/bill". billAgg holds exactly one entry per paid bill.
      const avgOrder = billAgg.size > 0 ? r2(revenue / billAgg.size) : 0;
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
        takeaway: platActive.filter((r) => r.source === "takeaway").length,   // website channel
        parcel: platActive.filter((r) => r.source === "parcel").length,       // staff parcels
      };
      const platformToday = { count: platToday.length, revenue: r2(platToday.reduce((sum, r) => sum + (Number(r.total) || 0), 0)) };
      // Dine-in channel = the collected dine-in figures computed above.
      channels.dinein = { rev: r2(revenue), count: paid };
      // Menu star/dog matrix (menu engineering): classify each PAID dish by popularity (units) × gross
      // revenue, split at the medians → star / workhorse / puzzle / dog. Revenue (NOT profit — dish cost
      // isn't tracked yet; that's the future inventory module), labelled honestly in the UI.
      const mmArr = Object.entries(dishAgg).map(([title, d]) => ({ title, units: d.units, rev: r2(d.rev) }));
      const _med = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
      const medU = _med(mmArr.map((d) => d.units)), medR = _med(mmArr.map((d) => d.rev));
      const menuMatrix = mmArr.map((d) => ({ ...d, q: d.units >= medU ? (d.rev >= medR ? "star" : "workhorse") : (d.rev >= medR ? "puzzle" : "dog") })).sort((a, b) => b.rev - a.rev);
      return ok({
        menuMatrix,
        range, series, hours, cats, paid, unpaid, cancelled, revenue: r2(revenue),
        // Non-cancelled only, so it equals paid+unpaid (the card's own sub-line) AND compares
        // like-for-like against prev.orders (also non-cancelled). Counting cancelled here made
        // the big number disagree with its sub-line and skewed the up/down delta chip.
        orderCount: paid + unpaid, avgOrder,
        topDishes: Object.entries(topD).sort((a, b) => b[1] - a[1]).slice(0, 10),
        // [method, revenue, billCount] triples, biggest first (bill count shipped 2026-07-05
        // for the donut legend — same rows, no extra read; old clients ignore the 3rd slot).
        paymentMethods: Object.entries(paymentMethods).map(([method, v]) => [method, r2(v.rev), v.bills]).sort((a, b) => (b[1] as number) - (a[1] as number)),
        live, platformToday, channelsOn,
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
        // Honesty flag: on a very busy restaurant a wide range can exceed STATS_ROW_CAP, so these
        // totals + the menu-winners split reflect only the most recent N orders. The dashboard shows
        // a plain note when truncated is true, instead of a silently-too-low number. (review #2)
        truncated: statsTruncated, statsCap: STATS_ROW_CAP, oldestLoaded: oldestLoadedIso,
        updatedAt: now.toISOString(),
      });
    }


    if (p === "users") {
      // The per-guest order/call tallies below are computed from these windows. The old 400/120
      // caps undercounted an active restaurant (a guest whose orders fell outside the latest 400
      // showed "0 orders"). Raised to a safer bound — this is an on-demand tab (not polled), and
      // the order/call rows are 3 tiny columns. (A perfectly-accurate count needs a GROUP BY
      // aggregate RPC; that's the follow-up if these windows ever prove too small.)
      const members = must(
        await sb.from("session_members")
          .select("id, name, phone, phone_verified, role, approved, removed, location_ok, joined_at, session:sessions(table_number, status)")
          .eq("restaurant_id", rid).order("joined_at", { ascending: false }).limit(500)
      );
      const customers = must(await sb.from("customers").select("*").eq("restaurant_id", rid).order("last_seen_at", { ascending: false }).limit(500));
      const blocklist = must(await sb.from("blocklist").select("*").eq("restaurant_id", rid).order("blocked_at", { ascending: false }));
      const orders = must(await sb.from("orders").select("member_id, total, created_at").eq("restaurant_id", rid).not("member_id", "is", null).order("created_at", { ascending: false }).limit(3000));
      const calls = must(await sb.from("waiter_calls").select("member_id, note, created_at").eq("restaurant_id", rid).not("member_id", "is", null).order("created_at", { ascending: false }).limit(3000));
      return ok({ members, customers, blocklist, orders, calls });
    }

    if (p === "oplog") {
      if (!(await canViewLogs(g, rid))) return permDenied("view the activity log");
      // The operation log: recent staff actions across all panels. HIERARCHY RULE
      // (owner, 2026-07-03 — "in the manager's logs there shouldn't be owner or admin
      // actions"): a lower role must never observe a higher role's activity. So the
      // ADMIN's actions (panel='admin') AND the OWNER's actions (panel='owner' —
      // staff changes, permission grants…) are both hidden here; they show only in
      // their own panels' logs.
      const rows = (must(await sb.from("staff_actions").select("*").eq("restaurant_id", rid).not("panel", "in", "(admin,owner,db)").order("created_at", { ascending: false }).limit(200)) || []) as { actor_id?: string | null }[];
      // Actions the ADMIN performed from a panel view carry actor_id='admin:view' (owner,
      // 2026-07-28). Only the admin's own view may see that marker — for staff/owner
      // viewers the row must stay a plain, neutral panel row (the admin stays invisible).
      if (g.user) for (const row of rows) if (row.actor_id === ADMIN_VIEW_ACTOR_ID) row.actor_id = null;
      return ok(rows);
    }

    if (p === "staff-risk") {
      // Staff-watch aggregation: count the risk actions (discounts / voids / deletes / paid-reverts)
      // per staff member over a DATE RANGE, aggregated SERVER-SIDE so the browser gets a tiny summary
      // instead of thousands of log rows (egress-safe). Scoped to this restaurant; hides admin + owner
      // rows exactly like /oplog. Replaces the old client that aggregated only the newest 200 rows with
      // NO date window (which silently undercounted, and could miss a staff member, on a busy day). (review #4)
      const range = new URL(req.url).searchParams.get("range") || "today";
      const DAY = 864e5;
      let sinceMs: number;
      if (range === "year") sinceMs = Date.now() - 365 * DAY;
      else if (range === "30d") sinceMs = Date.now() - 30 * DAY;
      else { const ist = new Date(Date.now() + 5.5 * 3600e3); sinceMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3600e3; } // "today" = IST midnight
      const sinceIso = new Date(sinceMs).toISOString();
      const RISK: Record<string, "disc" | "void" | "del" | "rev"> = { order_discount: "disc", invoice_void: "void", void_invoice: "void", order_delete: "del", orders_delete: "del", payment_revert: "rev" };
      const by: Record<string, { disc: number; void: number; del: number; rev: number; total: number }> = {};
      let truncated = false;
      for (let from = 0; from < 20000; from += 1000) {
        const page = (must(await sb.from("staff_actions").select("action,actor,created_at").eq("restaurant_id", rid).not("panel", "in", "(admin,owner,db)").gte("created_at", sinceIso).order("created_at", { ascending: false }).range(from, from + 999)) as { action: string; actor: string | null }[] | null) || [];
        for (const r of page) { const k = RISK[r.action]; if (!k) continue; const who = r.actor || "— (device only)"; const a = by[who] || (by[who] = { disc: 0, void: 0, del: 0, rev: 0, total: 0 }); a[k]++; a.total++; }
        if (page.length < 1000) break;
        if (from + 1000 >= 20000) truncated = true;
      }
      const rows = Object.entries(by).map(([who, v]) => ({ who, ...v })).sort((a, b) => b.total - a.total);
      return ok({ range, rows, truncated });
    }

    return err("unknown GET endpoint", 404);
  } catch (e) {
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    logError("manager", "route_error", e, { restaurant_id: rid, detail: `GET ${p || "/"}` });
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────
// Wrapped so a replayed offline action runs at most once (see lib/idempotency.ts).
export const POST = withIdempotency(postImpl, "editor");
async function postImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  // Attribute every logged action to the signed-in staff member (name = their login;
  // admin super-user has no per-user cookie). Before this, `actor` was never filled, so
  // the Operation-log "By" column and the Staff-watch tool saw only an anonymous row.
  const actorName = g.user?.name || g.user?.username || null;
  // Admin panel-view actions (no staff cookie) get the actor_id='admin:view' marker so the
  // ADMIN's log surfaces can attribute them; staff/owner log reads mask it (owner 2026-07-28).
  // actor_id (the STABLE staff uuid) rides along too, not just the display name: a rename
  // used to orphan every past row, and "what did this person do" / the performance report
  // can only join on an id. (2026-07-29)
  const log = (...a: Parameters<typeof logAction>) => logAction(a[0], a[1], { actor: actorName, ...(g.user ? { actor_id: g.user.id } : { actor_id: ADMIN_VIEW_ACTOR_ID }), ...(a[2] || {}) });
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes — a device can never be handed a floor computed before its own action.
  invalidateFloor(rid);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path); if (tg) return tg; }
  try {
    const [a, b, c] = path;
    // A missing client id arrives as literal "undefined"/"null"/"NaN" — reject before it
    // reaches a uuid query and throws the "invalid input syntax for type uuid" route_error.
    if (emptyIdSegment(b) || emptyIdSegment(c)) return err("Missing id — please refresh and try again.");
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which device (this editor screen) is acting

    // ── OFFLINE REPLAY CLASH (offline sync 2026-07-30) ────────────────────────────
    // A change saved on a device with no signal, arriving only now, must not be applied
    // if the ground moved underneath it (the table was closed and billed, or a different
    // party is sitting there now). We refuse with a plain reason and the panel asks a
    // person to redo it — never a silent overwrite, never a silent drop. See lib/clash.ts.
    // A LIVE write carries no replay marker, so this returns without a single query.
    const clash = await replayClash(req, rid, a, b, c, body as Record<string, unknown> | null);
    if (clash) return clashJson(clash);

    // Same floor-plan sanity check as the waiter panel (see lib/planTable.ts).
    if ((a === "order" || (a === "sessions" && b === "open")) && body && (body as Record<string, unknown>).table != null) {
      const offPlan = await offPlanTable(rid, (body as Record<string, unknown>).table);
      if (offPlan) return err(offPlan, 400);
    }

    // ── NO SILENT OVERWRITES (owner, 2026-07-30) ──────────────────────────────────
    // If the screen told us what it was editing FROM, refuse when someone else has since
    // changed it — and tell that person what it says now. One gate for every action here:
    // a feature opts in from its CALL SITE (see the NEW-FEATURE CHECKLIST in CLAUDE.md), so
    // this cannot be forgotten on the server side when a new endpoint is added.
    const overwrite = await expectClash(req, rid);
    if (overwrite) return clashJson(overwrite);

    // customer-capture — save the guest's name+number at bill time, with consent
    // (Customer CRM, mig 212). DPDP: the RPC stores NOTHING without consent. Records
    // one visit for the table's session (idempotent), links devices, bumps the
    // returning count. Gated by the "customers" entitlement (default on). Called once
    // after the bill closes; a failure never blocks the settle that already happened.
    // ── table-sections — set ONE waiter's tables (waiter sections, mig 222) ────
    // Body: { user_id, tables: number[] }. The whole set is replaced, so the client can
    // send the result of a tick/untick without any merge logic. Same ladder as the GET.
    //
    // Numbers are sanitised and clamped to 1…table_count here, not trusted from the
    // client: a stale panel could otherwise write table 40 into a 12-table restaurant and
    // the waiter would hold a table that doesn't exist. Duplicates collapse, order is
    // stable, and an empty list is a legitimate "this waiter serves nothing yet".
    if (a === "table-sections") {
      if (!(await managerCan(g, rid, "table_assign"))) return permDenied("give waiters their own tables");
      const uid = String(body?.user_id || "").trim();
      if (!uid) return err("Which person? — user_id is required.");
      const cnt = Number((await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle()).data?.table_count) || 12;
      const seen = new Set<number>();
      const tables: number[] = [];
      for (const v of Array.isArray(body?.tables) ? body.tables : []) {
        const n = parseInt(String(v), 10);
        if (Number.isFinite(n) && n >= 1 && n <= cnt && !seen.has(n)) { seen.add(n); tables.push(n); }
      }
      tables.sort((x, y) => x - y);
      // Scoped to THIS restaurant and to a waiter: a manager can't reach another
      // restaurant's staff row, nor give a manager/kitchen login a section.
      const upd = await sb.from("staff_users").update({ assigned_tables: tables })
        .eq("id", uid).eq("restaurant_id", rid).eq("role", "tablet")
        .select("id, username, name, assigned_tables");
      if (upd.error) return err(upd.error.message, 500);
      const row = (upd.data || [])[0];
      if (!row) return err("That waiter is no longer on this restaurant's team.", 404);
      await log("editor", "table_sections_set", {
        restaurant_id: rid, device_id: dev,
        detail: `${row.name || row.username}: ${tables.length ? tables.map((t) => `T${t}`).join(" ") : "no tables"}`,
      });
      return ok({ ok: true, user: row });
    }

    if (a === "customer-capture") {
      const t = String(body?.table || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const ent = await getOwnerEntitlements(rid);
      if (!ent.customers) return err("The customer directory isn't enabled for this restaurant.", 403);
      // WHOSE BILL: the panel sends the session it just settled. Verified against this
      // restaurant + table before it is used, and the RPC falls back to the table's OPEN
      // session when a caller sends nothing. Resolving by table alone used to book the visit
      // (and the device links) onto whichever party was seated at that table NEXT — mig 233.
      let capSession: string | null = null;
      const capSessionRaw = String(body?.session || "").trim();
      if (/^[0-9a-f-]{36}$/i.test(capSessionRaw)) {
        const owns = (await sb.from("sessions").select("id").eq("id", capSessionRaw)
          .eq("restaurant_id", rid).eq("table_number", t).maybeSingle()).data as { id: string } | null;
        capSession = owns?.id ?? null;
      }
      const { data, error } = await sb.rpc("lfh_capture_customer", {
        p_restaurant_id: rid, p_table: t,
        p_phone: String(body?.phone || "").slice(0, 20),
        p_name: String(body?.name || "").slice(0, 80),
        p_consent: body?.consent === true,
        p_session: capSession,
      });
      if (error) return err(error.message, 500);
      if ((data as { ok?: boolean })?.ok) await log("editor", "customer_saved", { restaurant_id: rid, table_number: t, device_id: dev });
      return ok(data || { ok: false });
    }

    // ── Raise an issue / complaint ────────────────────────────────────────────
    // A manager (or any staff) flags an operational problem for THIS restaurant; the
    // owner sees it on their issues page and the admin sees it as a platform complaint.
    if (a === "issue") {
      const ib = body as { subject?: string; body?: string; image_url?: string; audio_url?: string };
      try {
        await raiseIssue({
          rid,
          subject: String(ib?.subject || ""),
          body: ib?.body,
          raisedBy: g.user?.name || g.user?.username || "Manager",
          raisedRole: g.user?.role || "manager",
          imageUrl: ib?.image_url,
          audioUrl: ib?.audio_url,
        });
      } catch (e) { return err(e instanceof Error ? e.message : "Couldn't raise the issue.", 400); }
      return ok({ ok: true });
    }

    // ── order — take a BRAND-NEW dine-in order from the manager panel ───────────
    // Same behaviour as the waiter tablet's POST /order (server-priced via
    // lfh_staff_place_order — never trusts client prices), so the manager can run a
    // table the same way a waiter does. Gated by the take_orders manager power (admin
    // entitles it AND the owner grants it; managerCan, 2026-07-22). Wrapped by
    // withIdempotency like every editor write, so a replayed offline action places once.
    if (a === "order" && path.length === 1) {
      // Module rung (mig 179): ordering must be enabled for this restaurant at all,
      // then the manager needs the take_orders power (admin exists + owner grant).
      if (!(await takeOrdersLadder(rid)).effective) return err("Order-taking isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "take_orders"))) return permDenied("take new orders");
      const { table, items, allergies, note } = body || {};
      const t = String(table || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      // Reject a table that doesn't exist (1..table_count) — a typo would otherwise float
      // a phantom order on a non-existent table (mirrors the tablet guard).
      const tcRow = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tableCount = Number((tcRow.data as { table_count?: number } | null)?.table_count) || 0;
      const tn = Number(t);
      if (tableCount > 0 && (tn < 1 || tn > tableCount)) return err(`Table ${t} doesn't exist (this place has ${tableCount} tables).`, 400);
      if (!Array.isArray(items) || !items.length) return err("items required");
      // Overridable double-tap guard: refuse an IDENTICAL order for the same table within
      // 3s unless confirmDuplicate:true (two guests ordering the same drink is legitimate).
      const optSig = (opts: any) => (Array.isArray(opts) && opts.length)
        ? opts.map((o: any) => ({ group: o?.group ?? null, label: o?.label ?? null })) : null;
      const remSig = (r: any) => (Array.isArray(r) ? r.map((x: any) => String(x).toLowerCase()).sort() : []);
      // NOTE: price is deliberately NOT part of the signature. The stored rows always carry a
      // server-formatted price while an incoming line usually carries none, so comparing it
      // would make every order look "new" and disable this guard. Two open-price lines at
      // different prices can therefore trip the warning — it's overridable (confirmDuplicate).
      const lineSig = (i: any) => ({ id: i.id, qty: Number(i.qty) || 1, options: optSig(i.options), removed: remSig(i.removed) });
      const sig = JSON.stringify({ items: items.map(lineSig), allergies: Array.isArray(allergies) ? allergies : [] });
      if (!(body && body.confirmDuplicate === true)) {
        const recent = (await sb.from("orders").select("items, allergies")
          .eq("table_number", t).eq("restaurant_id", rid).gte("created_at", new Date(Date.now() - 3000).toISOString()).limit(5)).data || [];
        if (recent.some((o: any) => JSON.stringify({
          items: (o.items || []).map(lineSig),
          allergies: Array.isArray(o.allergies) ? o.allergies : [],
        }) === sig)) {
          return NextResponse.json({ error: "This looks identical to an order you just sent.", duplicateWarning: true }, { status: 409 });
        }
      }
      const { data, error } = await sb.rpc("lfh_staff_place_order", {
        p_table: t, p_items: items, p_allergies: Array.isArray(allergies) ? allergies : [], p_note: note || null,
        p_restaurant_id: rid,
        // Pass the "send anyway" flag through, exactly like the tablet route: the RPC runs its
        // OWN double-tap guard atomically under a per-table lock (mig 202), which is what
        // catches two truly-simultaneous identical sends (the JS pre-check above races). Without
        // this, confirming "Send it anyway?" skipped only the JS guard and the RPC still refused
        // — so a deliberate re-send was impossible for 3s and answered {ok:false}.
        p_confirm_duplicate: body?.confirmDuplicate === true,
      });
      if (error) throw new Error(error.message);
      // A manager placed this, so it's already confirmed — skip the kitchen "accept" step
      // and push it straight onto the pass as "preparing" (same as the tablet).
      const placedId = (data as any)?.order_id;
      if (placedId) {
        const cur = (await sb.from("orders").select("items").eq("id", placedId).eq("restaurant_id", rid).single()).data as { items?: any[] } | null;
        const its = Array.isArray(cur?.items) ? cur!.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
        // WHO punched this order rides along on the SAME update (no extra round trip), so the
        // performance report can say "this manager punched 412 bills". NULL keeps meaning
        // "the guest ordered it themselves". (mig 220 added the columns; 2026-07-29)
        await sb.from("orders")
          .update({ items: its, status: "preparing", placed_by_id: g.user?.id ?? null, placed_by: actorName })
          .eq("id", placedId).eq("restaurant_id", rid);
        await sb.from("order_items").update({ status: "preparing" }).eq("order_id", placedId).eq("restaurant_id", rid).eq("status", "received");
      }
      await log("editor", "order_place", { restaurant_id: rid, table_number: t, device_id: dev, order_id: placedId ?? null });
      return ok(data);
    }

    // ── Parcel (a staff-placed counter PARCEL) ────────────────────────────────
    // A "New Parcel" is a manually-created order in the Platform system with its OWN
    // source 'parcel' (mig 209) — so it lands on the Platform board / kitchen labelled
    // "Parcel" (never confused with the website "Takeaway" channel). Gated by the parcel
    // module + power (its own ladder), separate from the platform delivery module.
    // Titles/prices are resolved SERVER-SIDE (never trust the client cart); total is the
    // item subtotal, matching how every other platform order stores `total`.
    if (a === "parcel" && path.length === 1) {
      if (!(await parcelLadder(rid)).effective) return err("Parcel / takeaway isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "parcel"))) return permDenied("take parcel / takeaway orders");
      const { items, customer, phone, note, allergies, paid, method } = body || {};
      if (!Array.isArray(items) || !items.length) return err("items required");
      // The client sends only {id, qty, note} (+ price for an open-price dish); resolve
      // title+price from OUR menu (rid-scoped).
      const ids = [...new Set(items.map((i: any) => String(i?.id || "")).filter(Boolean))];
      const menu = (must(await sb.from("menu_items").select("id,title,price,open_price").eq("restaurant_id", rid).in("id", ids)) || []) as { id: string; title: string; price: unknown; open_price?: boolean }[];
      const byId = new Map(menu.map((d) => [String(d.id), d]));
      const picked: { title: string; qty: number; price: number; note?: string }[] = [];
      let total = 0;
      for (const it of items) {
        const d = byId.get(String(it?.id || ""));
        if (!d) continue;
        const qty = Math.max(1, Math.min(99, Number(it?.qty) || 1));
        // Open-price dish: the manager typed the price at order time — honour it (clamped),
        // don't read the (empty) DB price. A missing/zero price on such a line is refused.
        let price: number;
        if (d.open_price) {
          price = Math.max(0, Math.min(100000, Number(String(it?.price ?? "").replace(/[^0-9.]/g, "")) || 0));
          if (price <= 0) return err(`Enter a price for "${d.title}".`, 400);
          price = Math.round(price * 100) / 100;
        } else {
          price = Number(String(d.price).replace(/[^0-9.]/g, "")) || 0;
        }
        const line: { title: string; qty: number; price: number; note?: string } = { title: d.title, qty, price };
        const ln = String(it?.note || "").trim().slice(0, 200);
        if (ln) line.note = ln;
        picked.push(line);
        total += price * qty;
      }
      if (!picked.length) return err("no valid dishes", 400);
      total = Math.round(total * 100) / 100;
      const cust = String(customer || "").trim().slice(0, 120) || "Parcel";
      const ext = `PARCEL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const ins = await sb.rpc("lfh_platform_insert", {
        p_source: "parcel", p_external_id: ext, p_customer: cust,
        p_phone: String(phone || "").trim().slice(0, 40) || null,
        p_items: picked, p_total: total, p_restaurant_id: rid,
      });
      if (ins.error) throw new Error(ins.error.message);
      const row = Array.isArray(ins.data) ? ins.data[0] : ins.data;
      // Post-insert: keep the whole-order kitchen note + allergies + a 'parcel' channel
      // marker in payload, and — when paid at the counter — stamp the paid columns. ONE
      // scoped UPDATE (service-role bypasses RLS, so id + restaurant_id is the fence).
      const wholeNote = String(note || "").trim().slice(0, 300);
      const alg = Array.isArray(allergies) ? allergies.map((x: unknown) => String(x)).slice(0, 20) : [];
      const patch: Record<string, unknown> = { payload: { channel: "parcel", note: wholeNote || null, allergies: alg } };
      if (paid === true) { patch.paid = true; patch.paid_at = new Date().toISOString(); patch.payment_method = String(method || "cash").slice(0, 20); }
      if (row?.id) { const up = await sb.from("aggregator_orders").update(patch).eq("id", row.id).eq("restaurant_id", rid); if (up.error) throw new Error(up.error.message); }
      await log("manager", "parcel_place", { restaurant_id: rid, detail: `${paid === true ? "paid" : "unpaid"} · ₹${total}`, device_id: dev });
      return ok({ ...row, paid: paid === true });
    }

    // ── Handle a guest rating (mig 140) — mark handled / add an internal note ──
    // Gated by the view_ratings power; the feedback row must belong to THIS restaurant.
    if (a === "ratings" && b === "ack") {
      if (!(await managerCan(g, rid, "view_ratings"))) return permDenied("handle guest ratings");
      const rb = body as { id?: string; acknowledged?: unknown; note?: unknown };
      const id = String(rb?.id || "");
      if (!id) return err("id required", 400);
      const hasAck = "acknowledged" in (rb || {});
      if (hasAck && typeof rb.acknowledged !== "boolean") return err("acknowledged must be true/false", 400);
      const hasNote = "note" in (rb || {});
      if (hasNote && typeof rb.note !== "string") return err("note must be text", 400);
      const row = (await sb.from("feedback").select("id, restaurant_id").eq("id", id).maybeSingle()).data as { restaurant_id: string } | null;
      if (!row) return err("not found", 404);
      if (row.restaurant_id !== rid) return err("forbidden", 403);
      const who = g.user?.name || g.user?.username || "Manager";
      const patch: Record<string, unknown> = {};
      if (hasAck) { patch.acknowledged = rb.acknowledged; patch.acknowledged_at = rb.acknowledged ? new Date().toISOString() : null; patch.acknowledged_by = rb.acknowledged ? who : null; }
      if (hasNote) patch.staff_note = (rb.note as string).trim() || null;
      if (!Object.keys(patch).length) return err("nothing to update", 400);
      const upd = await sb.from("feedback").update(patch).eq("id", id);
      if (upd.error) throw new Error(upd.error.message);
      return ok({ ok: true });
    }

    // ── Platform (Zomato/Swiggy/website) orders ───────────────────────────────
    // platform/test — the "Simulate order" control: drop a realistic demo order in on a chosen
    // channel (stands in for the real aggregator webhook until API keys exist). Same insert path
    // the webhook will use. Gated by the platform module + channel + the manager `platform` power
    // (admin/owner pass via managerCan's higher-view bypass). Marked payload.demo so a later real
    // integration can tell demo orders apart.
    if (a === "platform" && b === "test") {
      if (g.user && !(await platformLadder(rid)).effective) return err("The Platform board isn't enabled for this restaurant.", 403);
      // Simulate is a DEMO/representation tool, NOT an operational action — restrict it to the
      // admin (g.user === null) and the owner. Real floor staff must never be able to add fake
      // orders to live revenue (the reason the old "test order" button was removed). The manager
      // panel hides the button for them too; this is the server-side guard.
      if (g.user && g.user.role !== "owner") return err("Only the owner or admin can add demo platform orders.", 403);
      // Only simulate on a channel that's actually turned on for this restaurant.
      const chRow = must(await sb.from("settings").select("platform_channels").eq("restaurant_id", rid).maybeSingle()) as { platform_channels?: Record<string, { on?: boolean }> } | null;
      const chan = chRow?.platform_channels || {};
      const CH2SRC: Record<string, string> = { zomato: "zomato", swiggy: "swiggy", website: "takeaway" };
      const onChannels = Object.keys(CH2SRC).filter((k) => chan?.[k]?.on === true);
      const reqCh = String((body && body.channel) || "").toLowerCase();
      // A named channel that's OFF is refused (don't silently simulate a different one); no name
      // = pick any live channel (the UI only ever offers channels that are on).
      if (reqCh && !onChannels.includes(reqCh)) return err("That channel is turned off for this restaurant.", 400);
      const channel = reqCh || onChannels[Math.floor(Math.random() * onChannels.length)];
      if (!channel) return err("No delivery channel is turned on for this restaurant.", 400);
      const src = CH2SRC[channel];
      // open_price dishes are skipped: they carry no menu price, so a demo order built from
      // one would show a ₹0 line.
      const dishes = must(await sb.from("menu_items").select("title, price").eq("restaurant_id", rid).eq("open_price", false).limit(50)) || [];
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
      const cust = NAMES[Math.floor(Math.random() * NAMES.length)];
      const ext = `${channel.toUpperCase()}-DEMO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const { data, error } = await sb.rpc("lfh_platform_insert", {
        p_source: src, p_external_id: ext, p_customer: cust,
        p_phone: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`,
        p_items: pick, p_total: total, p_restaurant_id: rid,
      });
      if (error) throw new Error(error.message);
      const testRow = Array.isArray(data) ? data[0] : data;
      // Mark the row as a demo/representation order + remember which channel it came in on
      // (website vs the takeaway source), so the board labels it and a later real integration
      // can distinguish it. One scoped update (id + restaurant_id is the fence).
      if (testRow?.id) await sb.from("aggregator_orders").update({ payload: { demo: true, channel } }).eq("id", testRow.id).eq("restaurant_id", rid);
      await log("manager", "platform_test_order", { restaurant_id: rid, detail: `${channel} demo order`, device_id: dev });
      return ok(testRow);
    }

    // platform/:id/status — advance a platform order (accept/preparing/ready/handed_over/cancelled)
    if (a === "platform" && c === "status") {
      const status = body && body.status;
      const ALLOWED = ["new", "accepted", "preparing", "ready", "handed_over", "cancelled"];
      if (!ALLOWED.includes(status)) return err("invalid status");
      // lfh_platform_set_status updates by id with NO tenant scope (mig 071); confirm this
      // platform order is THIS restaurant's before advancing it (service-role bypasses RLS).
      const owns = must(await sb.from("aggregator_orders").select("id,source").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { source?: string } | null;
      if (!owns) return err("That platform order isn't for this restaurant.", 404);
      // A parcel is gated by the parcel module/power; a delivery order by the platform one.
      if (!(await platformOrParcelCan(g, rid, owns.source))) return permDenied("manage this order");
      const { data, error } = await sb.rpc("lfh_platform_set_status", { p_id: b, p_status: status, p_by: "manager" });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      void notifyAggregator(row?.source, row?.external_id, status); // best-effort push back to the platform (dormant w/o keys)
      await log("manager", "platform_status", { restaurant_id: rid, detail: status, device_id: dev });
      return ok(row);
    }

    // platform/:id/pay — collect a "pay on pickup" parcel (or any unpaid takeaway) at handover.
    // Scoped ownership check first (the set is service-role, so this eq() pair is the fence).
    if (a === "platform" && c === "pay") {
      const owns = must(await sb.from("aggregator_orders").select("id,total,source").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { total?: number; source?: string } | null;
      if (!owns) return err("That order isn't for this restaurant.", 404);
      if (!(await platformOrParcelCan(g, rid, owns.source))) return permDenied("collect this order");
      const method = String((body && body.method) || "cash").slice(0, 20);
      const up = await sb.from("aggregator_orders").update({ paid: true, paid_at: new Date().toISOString(), payment_method: method }).eq("id", b).eq("restaurant_id", rid);
      if (up.error) throw new Error(up.error.message);
      await log("manager", "parcel_collect", { restaurant_id: rid, detail: `₹${owns.total ?? 0} · ${method}`, device_id: dev });
      return ok({ ok: true, id: b, paid: true });
    }

    // platform/toggles — flip "kitchen can accept" / "show in bills"
    if (a === "platform" && b === "toggles") {
      const patch: Record<string, boolean> = {};
      if (typeof body.kitchen_can_accept_platform === "boolean") patch.kitchen_can_accept_platform = body.kitchen_can_accept_platform;
      if (typeof body.platform_in_bills === "boolean") patch.platform_in_bills = body.platform_in_bills;
      if (!Object.keys(patch).length) return err("no toggle given");
      must(await sb.from("settings").update(patch).eq("restaurant_id", rid).select());
      await log("manager", "platform_toggle", { restaurant_id: rid, detail: JSON.stringify(patch), device_id: dev });
      return ok({ ok: true, ...patch });
    }

    // ── banquet (mig 130): item CRUD + bill generation. All rid-scoped; the
    // entitlement is re-checked here (and again inside the place RPC) so a
    // restaurant without the module can't be driven even by a forged client.
    if (a === "banquet") {
      // Full ladder (mig 167) — see the GET gate above; the place RPC still re-checks
      // the admin switch inside SQL as the final backstop.
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "banquet"))) return permDenied("use banquet billing");
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
        await log("manager", "banquet_item_save", { restaurant_id: rid, detail: `"${title}" ₹${price}`, device_id: dev });
        return ok(row);
      }
      // banquet/item-delete — { id }
      if (b === "item-delete") {
        if (!(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the banquet menu");
        must(await sb.from("banquet_items").delete().eq("id", String(body?.id || "")).eq("restaurant_id", rid).select("id"));
        await log("manager", "banquet_item_delete", { restaurant_id: rid, device_id: dev });
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
        await log("manager", "banquet_place", { restaurant_id: rid, table_number: t || null, detail: `total ${(data as any)?.total}`, device_id: dev });
        return ok(data);
      }
      // banquet/bill — issue a numbered banquet bill (mig 237).
      // { table?, lines:[{id,qty,price?}], meta:{…} }. The RPC prices every line from
      // banquet_items, keeps ONLY the meta keys this restaurant is allowed to fill
      // (settings.banquet_fields), takes the next number from the restaurant's own
      // counter under a row lock, and lands the sale as a normal 'served' order so
      // Bills, the day-book and the GST report see it with no changes. POST is already
      // wrapped in withIdempotency, so an offline replay bills exactly once.
      if (b === "bill") {
        const t = String(body?.table || "").trim();
        if (t) {
          if (!/^\d+$/.test(t)) return err("valid table required");
          const tcRow = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
          const tableCount = Number((tcRow.data as { table_count?: number } | null)?.table_count) || 0;
          if (tableCount > 0 && (Number(t) < 1 || Number(t) > tableCount)) return err(`Table ${t} doesn't exist (this place has ${tableCount} tables).`, 400);
        }
        const lines = Array.isArray(body?.lines) ? body.lines : [];
        if (!lines.length) return err("Add at least one banquet line.");
        // prepared_by is recorded from the LOGIN, never from the browser (the field
        // switch only decides whether it prints).
        const meta = { ...(body?.meta && typeof body.meta === "object" ? body.meta : {}), prepared_by: g.user?.name || g.user?.username || "Manager" };
        const { data, error } = await sb.rpc("lfh_banquet_bill_create", {
          p_lines: lines, p_meta: meta, p_table: t || null, p_restaurant_id: rid,
          p_by: g.user?.name || g.user?.username || "Manager",
        });
        if (error) throw new Error(error.message);
        if (!(data as any)?.ok) return err(banquetErrMsg((data as any)?.reason), 400);
        await log("manager", "banquet_bill", {
          restaurant_id: rid, table_number: t || null,
          detail: `${(data as any)?.bill_no} · total ${(data as any)?.total}`, device_id: dev,
        });
        // prepared_by comes back so the FIRST print carries the same name a re-print
        // will show (the panel has no reliable copy of who is logged in).
        return ok({ ...(data as object), prepared_by: meta.prepared_by });
      }
      return err("unknown banquet action", 404);
    }

    // orders/delete (bulk/clear) — keep settled bills. Removing bill records is
    // owner-gated (least-privilege): a plain manager needs the void_bills power.
    // Managers can always CANCEL an order (routine, ungated) — only a DELETE needs
    // the power. A "delete" here is a SOFT delete (mig 188): rows are stamped, never
    // erased, so a deleted bill is retained for tax/audit and shows as a tombstone.
    // Every clear is written to the Log for accountability.
    if (a === "orders" && b === "delete") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("delete or clear bills");
      if (!(await canDeleteBill(g, rid))) return permDenied("delete bills");
      const { ids, all } = body || {};
      // Reason the manager typed (owner 2026-07-23 — deletes must carry a why for the bill audit).
      const delReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      let deletable: string[]; let kept: number;
      if (all) {
        // Scoped read: fetch ONLY the deletable rows (unpaid OR cancelled) that aren't
        // ALREADY soft-deleted, so a "clear all" never re-picks tombstoned rows and never
        // scans the whole orders table; cap at 5000 as a safety bound. The count of KEPT
        // paid bills comes from a rows-free head count (no row egress).
        const del = must(await sb.from("orders").select("id").eq("restaurant_id", rid).is("deleted_at", null).or("payment_status.neq.paid,status.eq.cancelled").limit(5000)) as { id: string }[];
        deletable = del.map((o) => o.id);
        const keptQ = await sb.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", rid).is("deleted_at", null).eq("payment_status", "paid").neq("status", "cancelled");
        kept = keptQ.count || 0;
      } else if (Array.isArray(ids) && ids.length) {
        const candidates = must(await sb.from("orders").select("id,payment_status,status").eq("restaurant_id", rid).is("deleted_at", null).in("id", ids)) as { id: string; payment_status: string; status: string }[];
        deletable = candidates.filter((o) => !(o.payment_status === "paid" && o.status !== "cancelled")).map((o) => o.id);
        kept = candidates.length - deletable.length;
      } else return err("no ids");
      // SOFT delete — the row stays; a restore can bring it back.
      const res = deletable.length ? await softDeleteOrders(rid, deletable, { actor: actorName, actorId: g.user?.id ?? null, reason: delReason }) : { deleted: 0 };
      await log("editor", "orders_delete", { restaurant_id: rid, detail: (all ? `cleared all freed records (${res.deleted})` : `deleted ${res.deleted} bill(s)`) + (delReason ? ` — ${delReason}` : ""), device_id: dev });
      return ok({ ok: true, deleted: res.deleted, kept });
    }

    // orders/:id/discount | accept | serve-all | item
    // orders/:id/tip — record an optional TIP (extra staff money on top of a bill), captured at
    // payment. Stored on this one order (a table bill puts its whole tip on the first paid order);
    // completely separate from subtotal/tax/discount/total, so it never affects the bill math.
    if (a === "orders" && c === "tip") {
      const amt = Math.max(0, Number(body?.amount) || 0);
      must(await sb.from("orders").update({ tip: amt }).eq("id", b).eq("restaurant_id", rid));
      await log("manager", "order_tip", { restaurant_id: rid, order_id: b, detail: `tip ₹${amt}`, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "discount") {
      if (!(await managerCan(g, rid, "give_discounts"))) return permDenied("give discounts");
      if (await invoiceLockedByOrder(b)) return err(LOCKED_MSG, 409);
      // .eq(restaurant_id, rid) is the only tenant boundary (sb is service-role, RLS bypassed) —
      // a foreign order id can't be discounted.
      const cur = must(await sb.from("orders").select("subtotal, session_id").eq("id", b).eq("restaurant_id", rid).single());
      const raw = Number(body && body.amount);
      // Per-role %-cap (owner 2026-07-24): refuse a discount over this actor's configured limit
      // (non-breaking — no cap → no block). Admin (g.user null) is uncapped.
      { const cap = await discountCapPct(rid, discountRole(g.user?.role)); const base0 = Number(cur.subtotal) || 0;
        if (Number.isFinite(raw) && overDiscountCap(Math.max(raw, 0), base0, cap)) return err(`That discount is over your ${cap}% limit — ask the owner.`, 403); }
      const note = String((body && body.note) || "").slice(0, 200) || null;
      // WHOLE-BILL (session) discount path — the FIX for the "discount shrinks when marked paid"
      // bug (2026-07-08). A table's discount is conceptually on the whole BILL, but the manager
      // panel used to write the entire amount onto ONE order (the first non-cancelled one). When
      // that order's own subtotal was smaller than the discount, mig 148's re-price trigger clamped
      // the discount down to that order's subtotal on the next subtotal/payment change (e.g. Mark
      // paid) — so the recorded + printed total jumped ABOVE what the guest actually paid. Routing
      // through lfh_staff_bill_discount (mig 143 — the SAME path the tablet uses) stores the amount
      // on the SESSION and splits it proportionally across the unpaid orders, each clamped to its
      // OWN subtotal. That is clamp-safe, partial-payment safe, and mutually exclusive with a
      // tablet-entered bill discount (so a manager discount can no longer be silently reverted — B5).
      if (cur.session_id) {
        const amount = Number.isFinite(raw) ? Math.max(raw, 0) : 0;
        const res = must(await sb.rpc("lfh_staff_bill_discount", { p_session: cur.session_id, p_amount: amount, p_note: note }));
        await log("manager", "order_discount", { restaurant_id: rid, order_id: b, detail: amount > 0 ? `bill discount ₹${amount}${note ? ` · ${note}` : ""}` : "discount removed", device_id: dev });
        return ok({ ok: true, discount: (res && (res as { discount?: number }).discount) ?? amount });
      }
      // Legacy standalone order (no table session): keep the per-order write, capped at its OWN
      // pre-tax subtotal (a lone order can't carry more discount than its food value).
      const billCap = Number(cur.subtotal) || 0;
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), billCap) : 0;
      must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", b).eq("restaurant_id", rid));
      await log("manager", "order_discount", { restaurant_id: rid, order_id: b, detail: amount > 0 ? `discount ₹${amount}${note ? ` · ${note}` : ""}` : "discount removed", device_id: dev });
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
      await log("editor", "order_allergies", { restaurant_id: rid, order_id: b, detail, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());

      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // return=minimal: client re-fetches the board → skip both the .select() and the full-row re-read.
      must(await sb.from("orders").update({ items, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      await log("editor", "order_accept", { restaurant_id: rid, order_id: b, device_id: dev });
      return ok({ ok: true });
    }
    if (a === "orders" && c === "serve-all") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());

      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await log("editor", "order_serve", { restaurant_id: rid, order_id: b, device_id: dev });
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
      await log("editor", "table_open", { restaurant_id: rid, table_number: table, device_id: dev });
      return ok(data || null);
    }

    // sessions/open-all — open EVERY not-yet-open table in ONE round-trip (mig 102), instead
    // of the client firing one POST /sessions/open per table (300 tables = 300 round-trips to
    // Sydney). The RPC mirrors the single-open logic + approves pending requests; the client
    // pairs it with optimistic tiles so the floor flips to "open" instantly.
    if (a === "sessions" && b === "open-all") {
      const { data, error } = await sb.rpc("lfh_staff_open_all_tables", { p_restaurant_id: rid });
      if (error) throw new Error(error.message);
      await log("editor", "table_open_all", { restaurant_id: rid, detail: `opened ${(data && data.opened) || 0}`, device_id: dev });
      return ok(data || { opened: 0 });
    }

    // sessions/close-all — close every CLOSEABLE open table in ONE round-trip (mig 103). Mirrors
    // closeSession's guard (skips tables that owe money or are still cooking) + archiving; returns
    // { closed, skipped, closed_tables } so the client can offer UNDO. force=false → same safety as
    // the per-table close (won't force-close unpaid/cooking tables).
    if (a === "sessions" && b === "close-all") {
      const { data, error } = await sb.rpc("lfh_staff_close_all_tables", { p_restaurant_id: rid, p_force: false });
      if (error) throw new Error(error.message);
      await log("editor", "table_close_all", { restaurant_id: rid, detail: `closed ${(data && data.closed) || 0}, skipped ${(data && data.skipped) || 0}`, device_id: dev });
      return ok(data || { closed: 0, skipped: 0, closed_tables: [] });
    }

    // sessions/:id/close | auto-approve | shift
    // Uses the SHARED closeSession so the manager's rule is identical to the tablet's
    // (blocked on unpaid OR still-cooking unless force). The manager needs no PIN —
    // they're already the manager; force=true is their "close anyway" override.
    if (a === "sessions" && c === "close") {
      const result = await closeSession(b, { force: !!(body && body.force === true) }, { panel: "editor", deviceId: dev, restaurantId: rid });
      // Carry the REASON CODE, not just the sentence. The panel used to decide whether to
      // offer "close anyway" by searching the message for the words "owes money" — so the
      // cooking-only refusal ("still has orders cooking — serve them, or close anyway")
      // matched nothing and the override button never appeared, leaving the table stuck.
      // reason is 'unpaid' | 'cooking' | 'both' | 'not_found' (lib/sessionClose.ts).
      if (!result.ok) return NextResponse.json({ error: result.message, reason: result.reason }, { status: result.status });
      return ok(result.session);
    }
    if (a === "sessions" && c === "auto-approve") {
      const value = !!(body && body.value === true);
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS) — the
      // same rule applied to order/dish writes; a foreign session id can't be flipped.
      const row = must(await sb.from("sessions").update({ auto_approve: value }).eq("id", b).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }
    // sessions/:id/invoice — GENERATE the tax invoice (assign a permanent number, lock the
    // bill). Server-authoritative. A RE-issue (after a void) carries a reason and is REFUSED
    // once the bill is settled (mig 189 enforces both — the invoice locks at settlement).
    if (a === "sessions" && c === "invoice") {
      // lfh_generate_invoice has no tenant param — confirm the session is THIS restaurant's
      // first (service-role bypasses RLS; a foreign session id must not get an invoice).
      const ownsGen = must(await sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!ownsGen) return err("That table isn't for this restaurant.", 404);
      // The bill is made out to a named customer (mig 227). When the restaurant requires it,
      // NO invoice is issued without a mobile + name — enforced here, not just in the UI, so
      // a stale panel or a direct call can't skip it. Saved before the number is assigned, so
      // an issued invoice always carries its customer.
      const custSave = await saveBillCustomer(sb, rid, b as string, body);
      if (!custSave.ok) return err(custSave.message, 400);
      const genReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      const { data, error } = await sb.rpc("lfh_generate_invoice", { p_session: b, p_reason: genReason || null, p_actor: actorName });
      if (error) { if (/invoice locked/i.test(error.message)) return err("This bill is settled — its invoice can't be reopened. Make a credit note instead.", 409); throw new Error(error.message); }
      await log("editor", "invoice_generate", { restaurant_id: rid, detail: `session ${b}` + (genReason ? ` · ${genReason}` : ""), device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
    }
    // sessions/:id/void-invoice — VOID it (reopen the bill for edits; number kept in record).
    // A reason is REQUIRED (owner: every reopen must say why). Refused once settled (mig 189).
    if (a === "sessions" && c === "void-invoice") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("void bills");
      // Confirm the session belongs to THIS restaurant before voiding (RPC has no tenant param).
      const ownsVoid = must(await sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!ownsVoid) return err("That table isn't for this restaurant.", 404);
      const voidReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      if (!voidReason) return err("A reason is required to void / reopen an invoice.", 400);
      const { data, error } = await sb.rpc("lfh_void_invoice", { p_session: b, p_reason: voidReason, p_actor: actorName });
      if (error) { if (/invoice locked/i.test(error.message)) return err("This bill is settled — its invoice can't be reopened. Make a credit note instead.", 409); throw new Error(error.message); }
      await log("editor", "invoice_void", { restaurant_id: rid, detail: `session ${b} · ${voidReason}`, device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
    }
    // sessions/:id/credit-note — issue a CREDIT NOTE against a bill (the legal correction
    // path once the invoice/bill is settled and locked; mig 194). Money action → void_bills.
    // The bill is NEVER edited — a new, numbered, immutable credit document is recorded.
    if (a === "sessions" && c === "credit-note") {
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("issue credit notes");
      const ownsCn = must(await sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!ownsCn) return err("That table isn't for this restaurant.", 404);
      const cnAmount = Math.round((Number(body?.amount) || 0) * 100) / 100;
      const cnReason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      if (cnAmount <= 0) return err("Enter a credit amount greater than zero.", 400);
      if (!cnReason) return err("A reason is required to issue a credit note.", 400);
      const { data: cnData, error: cnErr } = await sb.rpc("lfh_issue_credit_note", { p_session: b, p_amount: cnAmount, p_reason: cnReason, p_actor: actorName });
      if (cnErr) { if (/cannot exceed/i.test(cnErr.message)) return err("The credit can't be more than the bill total.", 400); throw new Error(cnErr.message); }
      const cnRow = Array.isArray(cnData) ? cnData[0] : cnData;
      await log("editor", "credit_note", { restaurant_id: rid, order_id: undefined, detail: `session ${b} · credit ₹${cnAmount} · ${cnReason}`, device_id: dev });
      return ok(cnRow);
    }
    if (a === "sessions" && c === "shift") {
      const to = String((body && body.to) || "").trim();
      // Validate the destination is a plain positive integer (the RPC trusts whatever arrives).
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to move to.", 400);
      // lfh_staff_shift_table takes no tenant param — confirm the session belongs to THIS
      // restaurant AND the target is within its table count before shifting (service-role
      // bypasses RLS; a foreign session id or an out-of-range table must be refused).
      const [ownsShift, setRow] = await Promise.all([
        sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle(),
        sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle(),
      ]);
      if (!must(ownsShift)) return err("That table isn't for this restaurant.", 404);
      const tableCount = Number((must(setRow) || {}).table_count) || 0;
      if (tableCount && Number(to) > tableCount) return err("That table number is out of range.", 400);
      const { data, error } = await sb.rpc("lfh_staff_shift_table", { p_session: b, p_to: to });
      if (error) throw new Error(error.message);
      await log("editor", "table_shift", { restaurant_id: rid, detail: "→ table " + to, device_id: dev });
      return ok(data);
    }

    // orders/:id/move — move ONE order (a single KOT) and its dish rows to another
    // table, leaving the rest of the party's bill behind. Part of the KOT ▾ menu
    // (ladder-gated, mig 172); the whole-party variant is sessions/:id/shift above.
    // The RPC (mig 173) is atomic, re-splits both bills' discounts and nudges BOTH
    // tables' tiles — the same shared implementation the tablet route calls.
    if (a === "orders" && c === "move") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to move to.", 400);
      // Reject a target table that doesn't exist (1..table_count) — the RPC checks
      // digits/occupancy but doesn't know the restaurant's table count.
      const setRowMv = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tableCountMv = Number((must(setRowMv) || {}).table_count) || 0;
      if (tableCountMv && Number(to) > tableCountMv) return err("That table number is out of range.", 400);
      const { data, error } = await sb.rpc("lfh_staff_move_order", { p_order: b, p_to: to, p_rid: rid });
      if (error) throw new Error(error.message);
      if (data && (data as { ok?: boolean }).ok === false) return err(moveErrMsg((data as { reason?: string }).reason), 409);
      await log("editor", "order_move", { restaurant_id: rid, order_id: b, detail: "KOT → table " + to, device_id: dev });
      return ok(data);
    }

    // sessions/:id/merge — MERGE this table's party into an OCCUPIED table: one table,
    // one bill (KOT ▾ menu; the complement of shift, which needs a FREE target).
    // The RPC (mig 174) moves orders/items/calls/members/cart, sums + re-splits the
    // discounts, closes the source session, and nudges both tables' tiles.
    if (a === "sessions" && c === "merge") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to merge into.", 400);
      const [ownsMerge, setRowMg] = await Promise.all([
        sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle(),
        sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle(),
      ]);
      if (!must(ownsMerge)) return err("That table isn't for this restaurant.", 404);
      const tableCountMg = Number((must(setRowMg) || {}).table_count) || 0;
      if (tableCountMg && Number(to) > tableCountMg) return err("That table number is out of range.", 400);
      const { data, error } = await sb.rpc("lfh_staff_merge_tables", { p_session: b, p_to: to, p_rid: rid });
      if (error) throw new Error(error.message);
      if (data && (data as { ok?: boolean }).ok === false) return err(mergeErrMsg((data as { reason?: string }).reason), 409);
      await log("editor", "table_merge", { restaurant_id: rid, detail: `T${(data as { from?: string }).from} → T${to} (one bill)`, device_id: dev });
      return ok(data);
    }

    // tables/:t/pay-split — settle the whole bill as SEVERAL payment legs (equal /
    // custom / by-dish shares computed client-side; KOT ▾ menu, mig 176). The bill
    // stays ONE bill: orders are marked paid once (method 'Split'), the legs land in
    // session_payments for the money trail. Σ legs must equal the due (±2p) — the
    // server recomputes the due itself, never trusting the client's number.
    if (a === "tables" && c === "pay-split") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const splits = Array.isArray(body?.splits) ? body.splits : [];
      if (splits.length < 2 || splits.length > 12) return err("Give at least two split shares (max 12).");
      for (const s of splits) {
        if (!(Number(s?.amount) > 0)) return err("Every split share needs an amount above zero.");
        if (!PAYMENT_METHODS.includes(s?.method)) return err("invalid payment method in a split share");
        if (s?.note != null && String(s.note).length > 200) return err("split note too long");
      }
      // Same scoping as a normal settle: the table's OPEN session's orders (fallback:
      // active table orders), only accepted+unpaid+non-cancelled ones count.
      const openSessSp = (await sb.from("sessions").select("id")
        .eq("table_number", t).eq("status", "open").eq("restaurant_id", rid)
        .order("last_activity_at", { ascending: false }).limit(1)).data?.[0];
      // Exclude un-accepted (received) orders from the split scope — the same graceful rule
      // as mark-paid and the client split modal: settle the ACCEPTED part in legs, leave a
      // just-added order to be accepted + paid separately (was: reject the whole split with a
      // 409 the client could never satisfy — owner deep-QA 2026-07-23).
      let oq = sb.from("orders").select("id,subtotal,total,discount,status,payment_status,session_id")
        .neq("status", "cancelled").neq("status", "received").neq("payment_status", "paid").eq("restaurant_id", rid);
      oq = openSessSp ? oq.eq("session_id", openSessSp.id) : oq.eq("table_number", t).eq("archived", false);
      const rowsSp = (must(await oq.limit(200)) as { id: string; subtotal: number; total: number; discount: number; status: string; session_id: string | null }[]) || [];
      if (!rowsSp.length) return err("Nothing to settle — already paid, or accept the order first.", 409);
      const sidSp = openSessSp?.id || rowsSp.find((o) => o.session_id)?.session_id;
      if (!sidSp) return err("This table has no live bill session — settle it normally instead.", 409);
      // Due — computed with the SAME aggregate rounding as billMath (app.js) / the Z-report:
      // taxable = Σsub − Σdisc, tax rounded ONCE over the whole bill. Summing each order's
      // already-rounded stored total instead drifts ±½ paise per order and could 409-reject
      // a split whose legs exactly equal the printed bill (owner deep-QA 2026-07-23).
      const setSp = (await sb.from("settings").select("tax_components, tax_rate").eq("restaurant_id", rid).maybeSingle()).data || {};
      const rateSp = effectiveTaxRate(setSp);
      const subSp = rowsSp.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
      const discSp = rowsSp.reduce((s, o) => s + (Number(o.discount) || 0), 0);
      const taxableSp = Math.max(0, subSp - discSp);
      const dueSp = Math.round((taxableSp + Math.round(taxableSp * rateSp * 100) / 100) * 100) / 100;
      const sumSp = splits.reduce((s: number, x: { amount: number }) => s + Number(x.amount), 0);
      if (Math.abs(sumSp - dueSp) > 0.02) return err(`The shares add up to ₹${sumSp.toFixed(2)} but the bill due is ₹${dueSp.toFixed(2)} — they must match.`, 409);
      const legs = splits.map((s: { amount: number; method: string; note?: string }) => ({
        session_id: sidSp, restaurant_id: rid, amount: Math.round(Number(s.amount) * 100) / 100,
        method: String(s.method), note: String(s.note || "").slice(0, 200) || null,
      }));
      const insSp = await sb.from("session_payments").insert(legs);
      if (insSp.error) return err(insSp.error.message, 500);
      const noteSp = `${splits.length}-way split: ` + splits.map((s: { amount: number; method: string }) => `₹${Number(s.amount).toFixed(0)} ${s.method}`).join(" + ");
      must(await sb.from("orders").update({ payment_status: "paid", paid_at: nowIso(), payment_method: "Split", payment_note: noteSp.slice(0, 200) })
        .in("id", rowsSp.map((o) => o.id)).eq("restaurant_id", rid));
      await log("editor", "bill_split", { restaurant_id: rid, table_number: t, detail: noteSp.slice(0, 120), device_id: dev });
      await maybeAutoSettle(sidSp, { panel: "editor", deviceId: dev });
      return ok({ ok: true, count: rowsSp.length, due: dueSp });
    }

    // order-items/:id/move — move ONE dish line to another table (KOT ▾ menu; the
    // finest-grained transfer). Lands under a FRESH KOT on the target; both bills
    // re-price server-side (mig 175).
    if (a === "order-items" && c === "move") {
      const gateResp = await tableOpsGate(g, rid); if (gateResp) return gateResp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to) || Number(to) < 1) return err("Pick a valid table to move to.", 400);
      const setRowIm = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tableCountIm = Number((must(setRowIm) || {}).table_count) || 0;
      if (tableCountIm && Number(to) > tableCountIm) return err("That table number is out of range.", 400);
      const { data, error } = await sb.rpc("lfh_staff_move_order_item", { p_item: b, p_to: to, p_rid: rid });
      if (error) throw new Error(error.message);
      if (data && (data as { ok?: boolean }).ok === false) return err(moveErrMsg((data as { reason?: string }).reason), 409);
      await log("editor", "order_item_move", { restaurant_id: rid, detail: `dish → table ${to} (new KOT)`, device_id: dev });
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
      // Confirm the dish belongs to THIS restaurant before the RPC (which looks it up by id alone) —
      // the same tenant boundary the sibling money endpoints enforce. (B15 scoping consistency.)
      if (!(await sb.from("order_items").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data) return err("That dish was already removed.", 404);
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
      await log("editor", "order_item_delete", { restaurant_id: rid, order_id: data?.order_id, detail: data?.order_cancelled ? "order emptied → cancelled" : `dish removed, ${data?.items_left} left`, device_id: dev });
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
      if (!(await sb.from("order_items").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data) return err("That dish was already removed.", 404); // B15 scoping
      const { data, error } = await sb.rpc("lfh_staff_edit_item_qty", { p_item: b, p_qty: qty });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("editor", "order_item_qty", { restaurant_id: rid, order_id: data?.order_id, detail: `qty → ${data?.qty}`, device_id: dev });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/note — STAFF EDIT: change ONE dish's note on a PLACED order.
    if (a === "items" && c === "note") {
      if (!(await sb.from("order_items").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data) return err("That dish was already removed.", 404); // B15 scoping
      const { data, error } = await sb.rpc("lfh_staff_edit_item_note", { p_item: b, p_note: String(body?.note ?? "") });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("editor", "order_item_note", { restaurant_id: rid, order_id: data?.order_id, device_id: dev });
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
      await log("editor", "order_item_removed", { restaurant_id: rid, order_id: item.order_id, detail, device_id: dev });
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
      if (!(await sb.from("orders").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data) return err("That order was not found.", 404); // B15 scoping
      const line = {
        id: dishId,
        qty: Math.max(1, Math.round(Number(body?.qty) || 1)),
        // Staff-typed price for open-price (as-per-MRP) dishes; the RPC's pricer honours it
        // ONLY when the dish is flagged open_price, and clamps it — normal dishes stay DB-priced.
        price: body?.price != null ? String(body.price) : undefined,
        options: Array.isArray(body?.options) ? body.options : undefined,
        removed: Array.isArray(body?.removed) ? body.removed : undefined,
        note: body?.note ? String(body.note) : undefined,
      };
      const { data, error } = await sb.rpc("lfh_staff_add_item_to_order", { p_order: b, p_items: [line] });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("editor", "order_add_item", { restaurant_id: rid, order_id: b, detail: dishId, device_id: dev });
      await stampEdited(b, rid);
      return ok(data);
    }

    // items/:id/status (session order_items)
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "served"].includes(status)) return err("invalid status");
       
      const patch: any = { status };
      // Serving stamps served_at; an undo that sends the dish back must clear it
      // again so the row never keeps a stale served time (owner undo bar, 2026-07-22).
      patch.served_at = status === "served" ? nowIso() : null;
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
      // Only resolve a STILL-PENDING request (B22): a double-tap or a re-poll re-approve then updates
      // 0 rows (reqRow undefined) and returns cleanly, instead of re-running the open-session insert.
      const reqRow = must(await sb.from("requests").update({ status }).eq("id", b).eq("restaurant_id", rid).eq("status", "pending").select())[0];
      if (status === "approved" && reqRow && reqRow.type === "open") {
        const existing = must(await sb.from("sessions").select("id").eq("table_number", reqRow.table_number).eq("restaurant_id", rid).neq("status", "closed").limit(1));
        if (!existing.length) {
          // A concurrent open (two waiters, or a waiter tap-open racing the guest's own open) can both
          // pass the check above; the one-open-session-per-table unique index (mig 082) rejects the
          // loser. Treat that as success ("already open") rather than a raw duplicate-key 500. (B22)
          const ins = { error: await openTableSession(rid, String(reqRow.table_number)).then(() => null).catch((e: unknown) => ({ message: e instanceof Error ? e.message : String(e) })) }; // race-tolerant (2026-07-30)
          if (ins.error && !/duplicate|unique/i.test(ins.error.message)) throw new Error(ins.error.message);
        }
      }
      return ok(reqRow || null);
    }

    // blocklist (add)
    // tables/:t/restart — clear the round off the floor but KEEP the table open (fresh party). ONE
    // atomic server call: archive the round (served + archived, NOT cancelled), release the party's
    // members, CLEAR the table's live signals (open waiter-calls + pending requests) so no ghost 🔔
    // remains, and reopen a session if sessions are on. The manager panel used to do this as a
    // client loop that never cleared the signals → a stuck bell on the emptied table. (B12)
    if (a === "tables" && c === "restart") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const openSess = (await sb.from("sessions").select("id").eq("table_number", t).eq("status", "open").eq("restaurant_id", rid).order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string } | undefined;
      let q = sb.from("orders").update({ status: "served", archived: true, archived_at: nowIso() }).neq("status", "cancelled").eq("archived", false).eq("restaurant_id", rid);
      q = openSess ? q.eq("session_id", openSess.id) : q.eq("table_number", t);
      const rows = must(await q.select());
      if (openSess) must(await sb.from("session_members").update({ removed: true }).eq("session_id", openSess.id).eq("removed", false).select());
      await clearTableSignals(rid, t); // the B12 fix — no ghost waiter-call bell on the emptied table
      const setg = (await sb.from("settings").select("sessions_enabled").eq("restaurant_id", rid).maybeSingle()).data as { sessions_enabled?: boolean } | null;
      if (setg?.sessions_enabled && !openSess) await openTableSession(rid, String(t)); // race-tolerant (2026-07-30)
      await log("manager", "table_restart", { restaurant_id: rid, table_number: t, detail: `${rows.length} order(s) cleared`, device_id: dev });
      return ok({ ok: true, count: rows.length });
    }

    // ── Table types (VIP / Family / Owner's Guest) + khata — mig 166 ─────────────
    // tables/:t/tag — mark or clear a table's special type. body { tag: 'vip'|'family'|
    // 'guest' } to mark, { tag: null } to clear. Feature-laddered + table_tags power.
    if (a === "tables" && c === "tag") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (g.user && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "table_tags"))) return permDenied("mark tables");
      const tag = body?.tag ?? null;
      if (tag === null || tag === "") {
        must(await sb.from("table_tags").delete().eq("restaurant_id", rid).eq("table_number", t).select());
        await log("manager", "table_tag_clear", { restaurant_id: rid, table_number: t, device_id: dev });
        return ok({ ok: true, tag: "" });
      }
      if (!isTableTag(tag)) return err("invalid tag");
      must(await sb.from("table_tags")
        .upsert({ restaurant_id: rid, table_number: t, tag, tagged_by: actorName || "admin", tagged_at: nowIso() }, { onConflict: "restaurant_id,table_number" })
        .select());
      await log("manager", "table_tag_set", { restaurant_id: rid, table_number: t, detail: tag, device_id: dev });
      return ok({ ok: true, tag });
    }

    // tables/:t/on-the-house — settle a Family / Owner's-Guest table at no charge:
    // 100% pre-tax discount per order (the SAME stored shape as a whole-bill discount,
    // so every money view — already net-of-discount, paid-only — reads ₹0 with no
    // changes) + mark paid under the reserved "On the house" method (the report keys
    // on it). Same accept rule as mark-paid: nothing still 'received'.
    if (a === "tables" && c === "on-the-house") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (g.user && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "table_tags"))) return permDenied("settle a bill on the house");
      const tagRow = (await sb.from("table_tags").select("tag").eq("restaurant_id", rid).eq("table_number", t).maybeSingle()).data as { tag?: TableTag } | null;
      if (!tagRow?.tag || !COMP_TAGS.includes(tagRow.tag)) return err("On the house is only for tables marked Family or Owner's Guest.", 409);
      const openSess = (await sb.from("sessions").select("id").eq("table_number", t).eq("status", "open").eq("restaurant_id", rid).order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string } | undefined;
      let oq = sb.from("orders").select("id,subtotal,status,payment_status").eq("restaurant_id", rid).eq("archived", false).neq("status", "cancelled");
      oq = openSess ? oq.eq("session_id", openSess.id) : oq.eq("table_number", t);
      const orders = must(await oq) as { id: string; subtotal: number; status: string; payment_status: string }[];
      const unpaid = orders.filter((o) => o.payment_status !== "paid");
      if (!unpaid.length) return err("Nothing to settle on this table.", 409);
      if (unpaid.some((o) => o.status === "received")) return err("Accept the order first — a bill can only be settled once the order is accepted.", 409);
      for (const o of unpaid) {
        must(await sb.from("orders").update({
          discount: Number(o.subtotal) || 0, discount_note: "On the house",
          payment_status: "paid", paid_at: nowIso(), payment_method: ON_THE_HOUSE_METHOD,
        }).eq("id", o.id).eq("restaurant_id", rid).select("id"));
      }
      await log("manager", "on_the_house", { restaurant_id: rid, table_number: t, detail: `${unpaid.length} order(s) · ${tagRow.tag}`, device_id: dev });
      if (openSess) await maybeAutoSettle(openSess.id, { panel: "editor", deviceId: dev });
      return ok({ ok: true, count: unpaid.length });
    }

    // tables/:t/khata — "Collect later": park the table's unpaid bill on a PERSON and
    // free the table. body { customer_id } OR { name, phone?, note? } (adds the person).
    // Orders keep payment_status='pending' but gain khata markers, so they leave the
    // pending-bills warnings and live in the khata book until collected. The close
    // itself reuses closeSession(force) — orders were archived here first, so nothing
    // gets cancelled by the close's cook-guard.
    if (a === "tables" && c === "khata") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("park bills to collect later");
      const openSess = (await sb.from("sessions").select("id").eq("table_number", t).eq("status", "open").eq("restaurant_id", rid).order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string } | undefined;
      let kq = sb.from("orders").select("id,status,payment_status").eq("restaurant_id", rid).eq("archived", false).neq("status", "cancelled");
      kq = openSess ? kq.eq("session_id", openSess.id) : kq.eq("table_number", t);
      const korders = must(await kq) as { id: string; status: string; payment_status: string }[];
      const kunpaid = korders.filter((o) => o.payment_status !== "paid");
      if (!kunpaid.length) return err("Nothing unpaid to park on this table.", 409);
      if (korders.some((o) => o.status === "received" || o.status === "preparing"))
        return err("This table still has orders cooking — serve them first, then park the bill.", 409);
      // Resolve the person: existing id, or create (a phone that already exists reuses
      // that person — the picker's search should catch it, this is the race-safe net).
      let customer: { id: string; name: string; phone: string | null } | null = null;
      if (body?.customer_id) {
        customer = (await sb.from("khata_customers").select("id,name,phone").eq("restaurant_id", rid).eq("id", String(body.customer_id)).maybeSingle()).data as any;
        if (!customer) return err("That person isn't in this restaurant's khata book.", 404);
      } else {
        const name = String(body?.name || "").trim().slice(0, 80);
        if (!name) return err("A name is required to park a bill.");
        const phone = String(body?.phone || "").trim().slice(0, 20) || null;
        const note = String(body?.note || "").trim().slice(0, 200) || null;
        if (phone) customer = (await sb.from("khata_customers").select("id,name,phone").eq("restaurant_id", rid).eq("phone", phone).maybeSingle()).data as any;
        if (!customer) {
          const ins = await sb.from("khata_customers").insert({ restaurant_id: rid, name, phone, note }).select("id,name,phone");
          if (ins.error) return err(ins.error.message, 500);
          customer = (ins.data as any[])[0];
        }
      }
      const stamp = nowIso();
      // Mark + archive the unpaid orders in one update (archived = off the live floor;
      // khata_at = in the book). Paid orders on the same bill just archive via the close.
      must(await sb.from("orders").update({ khata_at: stamp, khata_customer_id: customer!.id, archived: true, archived_at: stamp })
        .in("id", kunpaid.map((o) => o.id)).eq("restaurant_id", rid).select("id"));
      if (openSess) {
        const closed = await closeSession(openSess.id, { force: true }, { panel: "editor", deviceId: dev, restaurantId: rid });
        if (!closed.ok) return err(closed.message, closed.status);
      } else {
        await clearTableSignals(rid, t);
      }
      await log("manager", "khata_park", { restaurant_id: rid, table_number: t, detail: `${kunpaid.length} order(s) → ${customer!.name}`, device_id: dev });
      return ok({ ok: true, customer, count: kunpaid.length });
    }

    // khata/customers — add a person to the book directly (the picker's "add new").
    if (a === "khata" && b === "customers" && !c) {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("use the khata book");
      const name = String(body?.name || "").trim().slice(0, 80);
      if (!name) return err("name required");
      const phone = String(body?.phone || "").trim().slice(0, 20) || null;
      const note = String(body?.note || "").trim().slice(0, 200) || null;
      if (phone) {
        const existing = (await sb.from("khata_customers").select("id,name,phone,note").eq("restaurant_id", rid).eq("phone", phone).maybeSingle()).data;
        if (existing) return ok({ customer: existing, existed: true });
      }
      const ins = await sb.from("khata_customers").insert({ restaurant_id: rid, name, phone, note }).select("id,name,phone,note");
      if (ins.error) return err(ins.error.message, 500);
      return ok({ customer: (ins.data as any[])[0], existed: false });
    }

    // khata/pay — collect a parked bill. body { session_id } (a bill) or { order_id }
    // (a solo parked order), + { method, note? }. Normal payment methods only.
    if (a === "khata" && b === "pay") {
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      if (!(await managerCan(g, rid, "khata"))) return permDenied("collect khata payments");
      const method = String(body?.method || "");
      if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) return err("invalid payment_method");
      const note = String(body?.note || "").slice(0, 200) || null;
      let pq = sb.from("orders").update({ payment_status: "paid", paid_at: nowIso(), payment_method: method, payment_note: note })
        .eq("restaurant_id", rid).not("khata_at", "is", null).neq("payment_status", "paid").neq("status", "cancelled");
      if (body?.session_id) pq = pq.eq("session_id", String(body.session_id));
      else if (body?.order_id) pq = pq.eq("id", String(body.order_id));
      else return err("session_id or order_id required");
      const paidRows = must(await pq.select("id,table_number")) as { id: string; table_number: string }[];
      if (!paidRows.length) return err("Nothing outstanding on that bill.", 409);
      await log("manager", "khata_collect", { restaurant_id: rid, table_number: paidRows[0]?.table_number ?? null, detail: `${paidRows.length} order(s) · ${method}`, device_id: dev });
      return ok({ ok: true, count: paidRows.length });
    }

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
        const m = (await sb.from("session_members").select("device_id, phone").eq("id", memberId).eq("restaurant_id", rid).maybeSingle()).data as { device_id?: string | null; phone?: string | null } | null;
        if (m?.device_id) device = m.device_id;
        if (!phone && m?.phone) phone = m.phone;
      }
      const row = must(await sb.from("blocklist").insert({ phone, table_number: table, device_id: device, member_id: memberId, reason: body.reason || "banned", restaurant_id: rid }).select())[0];
      // Kick the banned guest from their seat in the SAME request (B23) — the manager panel used to
      // do this as a separate client call, so a network blip could leave them banned-but-still-seated.
      if (memberId) await sb.from("session_members").update({ removed: true }).eq("id", memberId).eq("restaurant_id", rid);
      if (phone) await sb.from("customers").upsert({ phone, blocked: true, restaurant_id: rid }, { onConflict: "restaurant_id,phone" });
      // Record WHO banned WHAT in the Log (accountability). Describe the target type only —
      // never write the raw phone number into the log (no PII in the audit trail).
      const banTarget = [table ? `table ${table}` : "", phone ? "a phone" : "", device ? "a device" : "", memberId ? "a guest" : ""].filter(Boolean).join(", ") || "a guest";
      await log("editor", "blocklist_add", { restaurant_id: rid, detail: `banned ${banTarget}${body.reason ? ` · ${String(body.reason).slice(0, 60)}` : ""}`, device_id: dev });
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
      // Granular edit-menu sub-option gate (non-breaking; only a restricted manager is stopped).
      if (a === "items") { const act = isCreate ? "add_dish" : "edit_dish"; if (!(await menuSubAllowed(g, rid, act))) return permDenied(isCreate ? "add a new dish" : "edit dishes"); }
      else if (a === "categories") { if (!(await menuSubAllowed(g, rid, "manage_categories"))) return permDenied("manage categories"); }
      else if (a === "filters") { if (!(await menuSubAllowed(g, rid, "manage_filters"))) return permDenied("manage filters"); }
      // edit_3d is ADMIN-ONLY ("that 3D thing is mine" — owner 2026-07-24). A non-admin (owner OR
      // manager) editing a dish may NOT change its 3D model — strip those fields so only the
      // platform admin sets them. Non-breaking: a normal dish edit never carries these.
      if (a === "items" && g.user) for (const k of ["model_folder", "model_small_url", "model_optimized_url"]) { if (body && typeof body === "object" && k in (body as Record<string, unknown>)) delete (body as Record<string, unknown>)[k]; }
      // Field-level menu limits (owner 2026-07-25): a manager may hold edit_dish yet NOT
      // edit_price / mark_86. On an EDIT, if they'd change the price or the sold-out flag
      // without that sub-permission, revert JUST that field to the stored value (the rest of
      // their edit still saves) — so the limit holds even if the hidden control is forced.
      if (a === "items" && g.user && g.user.role === "manager" && !isCreate && body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        const wantsPrice = "price" in b;
        const wantsTags = Array.isArray(b.tags);
        if (wantsPrice || wantsTags) {
          const cur = (await sb.from(t.name).select("price, tags").eq("restaurant_id", rid).eq("id", String(b.id ?? "")).maybeSingle()).data as
            { price?: number | null; tags?: string[] | null } | null;
          if (cur) {
            if (wantsPrice && !(await menuSubAllowed(g, rid, "edit_price"))) b.price = cur.price ?? null;
            if (wantsTags && !(await menuSubAllowed(g, rid, "mark_86"))) {
              const hadSold = Array.isArray(cur.tags) && cur.tags.includes("sold-out");
              const kept = (b.tags as string[]).filter((x) => x !== "sold-out"); // keep their OTHER tag edits
              if (hadSold) kept.push("sold-out");                                // but hold the stored 86 state
              b.tags = kept;
            }
          }
        }
      }
      // A new category/filter must not clobber an existing one with the same slug (the upsert
      // keys on (restaurant_id,slug), so a dup-slug create would DO UPDATE over it — silent
      // data loss, 2026-07-06). Tell the user instead.
      if (isCreate && (a === "categories" || a === "filters") && body && typeof body === "object" && body.slug) {
        const clash = (await sb.from(t.name).select("slug").eq("restaurant_id", rid).eq("slug", String(body.slug)).maybeSingle()).data;
        if (clash) return err(`A ${a === "categories" ? "category" : "filter"} with that name already exists.`, 409);
      }
      // Same required-column courtesy the dish create gets: categories/filters need slug + name
      // (both NOT NULL, no default). Without this a create that omitted one reached the DB as a
      // raw "null value in column ... violates not-null constraint" 500. (2026-07-30)
      if (isCreate && (a === "categories" || a === "filters") && body && typeof body === "object") {
        const kindWord = a === "categories" ? "category" : "tag";
        const nm = (body as { name?: unknown }).name;
        const nameEmpty = nm == null
          || (typeof nm === "string" && !nm.trim())
          || (typeof nm === "object" && !Object.values(nm as Record<string, unknown>).some((v) => String(v ?? "").trim()));
        if (nameEmpty) return err(`Give the ${kindWord} a name first.`, 400);
        if (!String((body as { slug?: unknown }).slug ?? "").trim()) return err(`Give the ${kindWord} a name first.`, 400);
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
        // The feature ladder's higher rungs are not editable from this panel either:
        // table_tags_owner_control is the ADMIN's power-transfer switch; table_tags_enabled
        // is the OWNER's toggle (owner panel) — a manager must not flip rungs above them. (mig 166)
        delete (body as Record<string, unknown>).table_tags_owner_control;
        delete (body as Record<string, unknown>).table_tags_enabled;
        // Admin/owner-only settings (owner 2026-07-28): a REAL MANAGER may edit only per-table
        // NAME + seats + auto-close from this panel — never the billing identity, KOT printing,
        // the dining-session system, or the table COUNT. Those live in the admin panel
        // (components/admin/RestaurantSettings.tsx). The manager UI hides them (XRAY_CONTROLS in
        // public/panels/editor/app.js); this is the matching SERVER guard so the limit holds even
        // if the hidden control is forced. Admin (no staff cookie) and owner (role "owner") keep
        // full access — only a real manager's patch is stripped.
        if (g.user && g.user.role !== "owner") {
          const MANAGER_BLOCKED_SETTINGS = [
            // How many tables exist and how many tiles sit on a row of the floor are both
            // ADMIN-owned (mig 226): the per-row number replaced a per-device S/M/L toggle
            // precisely so one restaurant has one answer, not one per manager's phone.
            "table_count", "floor_per_row", "floor_layout_mode",
            "tax_label", "restaurant_name", "restaurant_address", "restaurant_phone",
            "gstin", "invoice_prefix", "bill_footer", "tax_components", "tax_rate",
            "auto_print_kot",
            "sessions_enabled", "require_location", "require_otp", "geo_lat", "geo_lng", "geo_radius_m",
            // How long the activity log and customer log are KEPT. A manager must never be able
            // to shorten the record that audits them — dropping this to 1 day makes the nightly
            // cleanup (mig 053) erase the evidence of a discount/void/delete they made yesterday.
            // docs/COMPLIANCE-GUARDRAILS.md §3: the audit log has no "off" switch — and a
            // retention dial the audited party controls is an off switch with extra steps.
            // Owner + admin keep it (the owner is the one being protected, not policed).
            "oplog_retention_days", "custlog_retention_days",
          ];
          for (const k of MANAGER_BLOCKED_SETTINGS) delete (body as Record<string, unknown>)[k];
          // A manager must not renumber invoices — the series is the thing an audit
          // checks, and the audited party doesn't get to set it (same reasoning as the
          // log-retention block above). Owner + admin may. (mig 237)
          for (const k of ["banquet_bill_prefix", "banquet_bill_style", "banquet_bill_next"]) delete (body as Record<string, unknown>)[k];
        }
        // WHAT a restaurant is asked for, and WHICH paper it prints on, are the ADMIN's
        // (owner 2026-07-31: "one info-format option in banquet in Access & permissions
        // in the admin panel"). Strip them from ANY staff-cookie save — manager or owner
        // — so the only way in is the admin route. (mig 237)
        if (g.user) {
          for (const k of Object.keys(body)) if (k === "banquet_fields" || k === "banquet_tax_components" || /^banquet_paper/.test(k)) delete (body as Record<string, unknown>)[k];
        }
        // The banquet series: shape it here so a bad value can never reach the CHECK
        // constraint, and REFUSE (never silently drop) a start-number change once bills
        // exist — the counter is the part that must stay gapless.
        if ("banquet_bill_prefix" in body) {
          body.banquet_bill_prefix = String(body.banquet_bill_prefix || "BQB").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "BQB";
        }
        if ("banquet_bill_style" in body) {
          const st = String(body.banquet_bill_style || "fy");
          body.banquet_bill_style = ["fy", "date", "plain"].includes(st) ? st : "fy";
        }
        if ("banquet_bill_next" in body) {
          const n = Math.round(Number(body.banquet_bill_next));
          const issued = await sb.from("banquet_bills").select("id", { count: "exact", head: true }).eq("restaurant_id", rid);
          const already = Number(issued.count) || 0;
          const current = Number((await sb.from("settings").select("banquet_bill_next").eq("restaurant_id", rid).maybeSingle()).data?.banquet_bill_next) || 1;
          if (already > 0 && Number.isFinite(n) && n !== current) {
            return err(`${already} banquet ${already === 1 ? "bill has" : "bills have"} already been issued, so the starting number can't be changed. The prefix and the style can.`, 409);
          }
          body.banquet_bill_next = Number.isFinite(n) ? Math.min(Math.max(n, 1), 99_999_999) : 1;
        }
        // settings is one row per restaurant (UNIQUE restaurant_id); matched by
        // restaurant_id at the upsert below — don't force the legacy id='site'
        // (that only ever matches restaurant #1's row).
        if ("table_count" in body) {
          const n = Math.round(Number(body.table_count));
          body.table_count = Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 12;
        }
        // Same clamp as the admin route (mig 226 also has a CHECK constraint) — an
        // owner/admin saving through this path can't write an out-of-range number either.
        if ("floor_per_row" in body) body.floor_per_row = clampPerRow(body.floor_per_row);
        if ("floor_layout_mode" in body) body.floor_layout_mode = body.floor_layout_mode === "custom" ? "custom" : "classic";
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
          const incoming = f && typeof f === "object" && !Array.isArray(f)
            ? Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === "boolean"))
            : {};
          // MERGE the incoming switch(es) into the CURRENT features (read-modify-write) instead of
          // replacing the whole bag — so the client can send just the ONE changed key and two people
          // toggling DIFFERENT switches don't clobber each other. (B17)
          const curF = ((await sb.from("settings").select("features").eq("restaurant_id", rid).maybeSingle()).data?.features) as Record<string, unknown> | null;
          body.features = { ...(curF && typeof curF === "object" && !Array.isArray(curF) ? curF : {}), ...incoming };
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
              const n = Math.round(Number(v));
              if (!Number.isFinite(n)) continue;
              const seats = Math.min(Math.max(n, 1), 30);
              // "default" = how many people fit at a NORMAL table on this floor (owner,
              // 2026-08-01). It lives in this same JSONB beside the per-table numbers so the
              // floor-wide answer needs no new column in either database. Anything else must
              // be a table number; a stray key is dropped, as before.
              if (k === "default") { clean.default = seats; continue; }
              const tn = parseInt(k, 10);
              if (Number.isFinite(tn) && tn >= 1) clean[String(tn)] = seats;
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
        // Price sanity (B7): the price column is read downstream as ::numeric, so a blank, negative,
        // or multi-separator value ("", "12.5.5", "1,299") either sold the dish for ₹0 or CRASHED
        // every guest order that included it. Validate + normalise to one clean number here. Only
        // when a price is actually being set (a tag-only edit omits it, so partial saves still work).
        if ("price" in body) {
          const cleaned = String(body.price ?? "").replace(/[^0-9.]/g, "");
          const n = Number(cleaned);
          if (cleaned === "" || !Number.isFinite(n) || n < 0 || (cleaned.match(/\./g) || []).length > 1) {
            return err("Enter a valid price — a number like 1299 or 129.99.", 400);
          }
          body.price = String(Math.round(n * 100) / 100);
        }
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
          // No such dish → it was deleted (another device removed it while this one had it open, or a
          // tag-toggle raced a delete). Refuse with a friendly message instead of letting the upsert
          // INSERT a partial row (missing title/slug/price → a raw NOT NULL 500). (B21)
          if (!owner) return err("That dish was removed — reload to see the current menu.", 404);
          if (owner.restaurant_id !== rid) return err("That dish belongs to another restaurant", 409);
        }
        // Required-column safety net (B26): menu_items has NOT NULL, no-default columns
        // (title, price, image, category — slug/id are already set above). A CREATE that
        // omitted one, or an EDIT that sent an explicit null, used to reach the DB as a raw
        // "null value in column X" 500 (the reported image-on-create + slug crashes — often a
        // programmatic/restore save that skips a field). Coalesce/validate here so a save
        // either succeeds or returns a friendly message, never a scary constraint error.
        if (isCreate) {
          if (!String(body.title ?? "").trim()) return err("Give the dish a name first.", 400);
          if (!("price" in body)) return err("Enter a price for the dish.", 400);
          if (body.image == null) body.image = "";      // no photo → saves blank; the panel shows the default mark (owner 2026-07-24)
          if (body.category == null) body.category = ""; // uncategorised bucket, not a crash
        } else {
          // EDIT: never let an explicit null wipe a required column — drop the key so the
          // upsert keeps the stored value (a tag-only / partial save already omits these).
          for (const k of ["title", "price", "image", "category", "slug"] as const) {
            if (k in body && (body as Record<string, unknown>)[k] == null) delete (body as Record<string, unknown>)[k];
          }
        }
      }
      // Sort order (B20): the "Sort order" box is a number input, so clearing it sends "" —
      // which the numeric sort_order column rejects (a raw 500) or stores as null (the row
      // then sorts unpredictably and can vanish to the bottom). Coalesce a blank/invalid
      // value to 0 so a save never breaks the list order. Only when the field is actually
      // present, so a partial save (e.g. a tag-only toggle) leaves the stored value alone.
      if ((a === "items" || a === "categories" || a === "filters") && body && typeof body === "object" && "sort_order" in body) {
        const so = Number((body as { sort_order?: unknown }).sort_order);
        (body as { sort_order?: number }).sort_order = Number.isFinite(so) ? Math.round(so) : 0;
      }
      // Stamp ownership + match the per-restaurant unique key: categories/filters are
      // keyed (restaurant_id, slug); settings is keyed (restaurant_id); menu_items
      // keeps its global id PK. So a save only ever touches THIS restaurant's row.
      body.restaurant_id = rid;
      const onConflict = a === "settings" ? "restaurant_id"
        : (a === "categories" || a === "filters") ? "restaurant_id,slug"
        : t.key;
      // EDITING an existing row UPDATEs it; only a genuinely new row goes through upsert.
      //
      // WHY (crash fixed 2026-07-30): an upsert is an INSERT with ON CONFLICT, so PostgREST
      // has to build a COMPLETE row — and Postgres checks NOT NULL while forming that row,
      // before the conflict is resolved. So any PARTIAL save of an existing row (a sold-out /
      // tag toggle, a reorder, an active flip — all of which send just a few columns) blew up
      // with a raw `null value in column "title"/"slug"/"image" violates not-null constraint`
      // 500 instead of saving. Reproduced against the dev DB: the same body as an UPDATE
      // returns 200, as an upsert it returns 23502. It hit a live client's menu on 2026-07-30.
      // menu_items requires id, slug, title, price, image, category; categories/filters
      // require slug + name — so all three kinds were exposed. An UPDATE only touches the
      // columns actually sent, which is what a partial save means.
      const existingRow = (a === "items" || a === "categories" || a === "filters") && !isCreate
        ? (a === "items"
            ? (await sb.from(t.name).select("id").eq("restaurant_id", rid).eq("id", String(body.id ?? "")).maybeSingle()).data
            : (await sb.from(t.name).select("slug").eq("restaurant_id", rid).eq("slug", String(body.slug ?? "")).maybeSingle()).data)
        : null;
      const data = must(existingRow
        ? await (a === "items"
            ? sb.from(t.name).update(body).eq("restaurant_id", rid).eq("id", String(body.id)).select()
            : sb.from(t.name).update(body).eq("restaurant_id", rid).eq("slug", String(body.slug)).select())
        : await sb.from(t.name).upsert(body, { onConflict }).select());
      // Any of items/categories/filters/settings changes the SHARED guest menu →
      // bust this restaurant's cached bundle so guests see it within seconds.
      bustMenuCache(rid);
      // Record menu changes in the operation log (B25) — dish/category/tag creates + edits now leave a
      // "who changed the menu, and when" trail, like orders/bans/payments/discounts already do.
      if (a === "items" || a === "categories" || a === "filters") {
        const kind = a === "items" ? "dish" : a === "categories" ? "category" : "tag";
        const label = String(body.title || (body.name && (body.name.en || body.name)) || body.slug || (data[0] && data[0].id) || "").slice(0, 80);
        await log("manager", isCreate ? "menu_create" : "menu_edit", { restaurant_id: rid, detail: `${isCreate ? "added" : "edited"} ${kind}: ${label}`, device_id: dev });
      }
      return ok(data[0]);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    logError("manager", "route_error", e, { restaurant_id: rid, detail: `POST ${path.join("/") || "/"}` });
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export const PATCH = withIdempotency(patchImpl, "editor");
async function patchImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const actorName = g.user?.name || g.user?.username || null;
  // Admin panel-view actions (no staff cookie) get the actor_id='admin:view' marker so the
  // ADMIN's log surfaces can attribute them; staff/owner log reads mask it (owner 2026-07-28).
  // actor_id (the STABLE staff uuid) rides along too, not just the display name: a rename
  // used to orphan every past row, and "what did this person do" / the performance report
  // can only join on an id. (2026-07-29)
  const log = (...a: Parameters<typeof logAction>) => logAction(a[0], a[1], { actor: actorName, ...(g.user ? { actor_id: g.user.id } : { actor_id: ADMIN_VIEW_ACTOR_ID }), ...(a[2] || {}) });
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes — a device can never be handed a floor computed before its own action.
  invalidateFloor(rid);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path); if (tg) return tg; }
  try {
    const [a, id] = path;
    // "undefined"/"null"/"NaN" id → clean 400 (a truthy string would slip past `&& id` below).
    if (emptyIdSegment(id)) return err("Missing id — please refresh and try again.");
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
      // session_id is read here so a payment revert can reverse THAT party's customer visit
      // (mig 233) instead of whoever is sitting at the table by the time it happens.
      const cur = must(await sb.from("orders").select("status,payment_status,archived,paid_at,archived_at,cancelled_at,table_number,session_id").eq("id", id).eq("restaurant_id", rid).single());
      if (patch.status === "cancelled" && cur.payment_status === "paid")
        return err("Can't cancel a paid order — mark it unpaid (refund) first.", 409);
      // Voiding a ticket needs the void_bills power (2026-07-31). The manager panel grew a
      // "✕ Cancel" button on each ticket when "close table" was removed — it is how a walk-out
      // is cleared now — so the endpoint has to refuse it for a role that isn't allowed to void
      // a bill, not just hide the button. void_bills is the right power: its own description is
      // "reopening a settled bill, voiding a generated one, or closing a table unpaid after a
      // walk-out". Admin and owner pass automatically (managerCan).
      if (patch.status === "cancelled" && cur.status !== "cancelled" && !(await managerCan(g, rid, "void_bills")))
        return permDenied("cancel an order");
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
        await log("editor", "payment_revert", { restaurant_id: rid, order_id: id, detail: reason, device_id: deviceIdFrom(req) });
        // Reversing the settle reverses the visit it counted (Customer CRM, mig 212).
        // Idempotent per session, so reverting each order of a multi-order bill is safe.
        // Reverse THIS bill's visit — the order row already tells us whose party it was.
        // Without the session id this deleted the visit of whoever is sitting there NOW (mig 233).
        if (cur.table_number != null || cur.session_id) {
          await sb.rpc("lfh_uncapture_customer", {
            p_restaurant_id: rid,
            p_table: cur.table_number != null ? String(cur.table_number) : "",
            p_session: cur.session_id ?? null,
          });
        }
      }
      if (patch.archived === false && cur.archived === true) {
        if (tooOld(cur.archived_at)) return err("This bill was freed more than 30 minutes ago and can no longer be restored.", 409);
      }
      if (patch.status === "received" && cur.status === "cancelled") {
        if (tooOld(cur.cancelled_at)) return err("This order was cancelled more than 30 minutes ago and can no longer be restored.", 409);
      }
      // Stamp/clear the settle timestamps as their gating flags flip.
      if (patch.payment_status === "paid") patch.paid_at = new Date().toISOString();
      // Reverting to unpaid un-collects the payment — the TIP went with that payment, so
      // clear it too. Otherwise a re-pay without a new tip leaves the old tip on the order
      // and the Z-report's "tips collected" (SUM orders.tip over paid) counts it again. (sweep C2)
      if (patch.payment_status === "pending") { patch.paid_at = null; patch.tip = 0; }
      if (patch.archived === true) patch.archived_at = new Date().toISOString();
      if (patch.archived === false) patch.archived_at = null;
      if (patch.status === "cancelled") patch.cancelled_at = new Date().toISOString();
      if (patch.status === "received" && cur.status === "cancelled") patch.cancelled_at = null;
      // Cancelling takes a bill OUT of revenue, so it is a money-affecting action and must name
      // a person — it was previously the ONE such action that wrote no log line at all (only the
      // row's cancelled_at showed it happened, with no actor). Cancel stays UNGATED for managers
      // on purpose (it's routine floor work; only DELETE needs the power) — this records it, it
      // does not restrict it. Un-cancelling is logged too, so a cancel/restore pair can't be used
      // to move a bill in and out of the takings unobserved. (docs/COMPLIANCE-GUARDRAILS.md §3)
      if (patch.status === "cancelled" && cur.status !== "cancelled") {
        await log("editor", "order_cancel", { restaurant_id: rid, order_id: id, table_number: cur.table_number ?? null, detail: `cancelled${cur.payment_status === "paid" ? " (was marked paid)" : ""}`, device_id: deviceIdFrom(req) });
      } else if (patch.status === "received" && cur.status === "cancelled") {
        await log("editor", "order_uncancel", { restaurant_id: rid, order_id: id, table_number: cur.table_number ?? null, detail: "cancel undone — back on the floor", device_id: deviceIdFrom(req) });
      }
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
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    logError("manager", "route_error", e, { restaurant_id: rid, detail: `PATCH ${path.join("/") || "/"}` });
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export const DELETE = withIdempotency(deleteImpl, "editor");
async function deleteImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const actorName = g.user?.name || g.user?.username || null;
  // Admin panel-view actions (no staff cookie) get the actor_id='admin:view' marker so the
  // ADMIN's log surfaces can attribute them; staff/owner log reads mask it (owner 2026-07-28).
  // actor_id (the STABLE staff uuid) rides along too, not just the display name: a rename
  // used to orphan every past row, and "what did this person do" / the performance report
  // can only join on an id. (2026-07-29)
  const log = (...a: Parameters<typeof logAction>) => logAction(a[0], a[1], { actor: actorName, ...(g.user ? { actor_id: g.user.id } : { actor_id: ADMIN_VIEW_ACTOR_ID }), ...(a[2] || {}) });
  const rid = await editorScope(req, g);
  if (rid instanceof NextResponse) return rid;
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes — a device can never be handed a floor computed before its own action.
  invalidateFloor(rid);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  // Manager's-menu rung: refuse a tab this restaurant switched off (see tabGate).
  { const tg = await tabGate(g, rid, path); if (tg) return tg; }
  try {
    const [a, id] = path;
    // "undefined"/"null"/"NaN" id → clean 400 (a truthy string would slip past `&& id` below).
    if (emptyIdSegment(id)) return err("Missing id — please refresh and try again.");

    if (a === "orders" && id) {
      // Bill deletion is owner-gated (least-privilege) + always logged — same rule as the
      // bulk clear above. A manager can still CANCEL an order without this power. This is a
      // SOFT delete (mig 188): the row is stamped, never erased, so the bill is retained for
      // tax/audit and shows as a tombstone in the admin ledger; a restore brings it back.
      if (!(await managerCan(g, rid, "void_bills"))) return permDenied("delete bills");
      if (!(await canDeleteBill(g, rid))) return permDenied("delete bills");
      const cur = must(await sb.from("orders").select("payment_status,status").eq("id", id).eq("restaurant_id", rid).single());
      if (cur && cur.payment_status === "paid" && cur.status !== "cancelled")
        return err("Won't delete a PAID bill — it's a financial record. Mark it unpaid or void it first.", 409);
      // Reason from the client (?reason=) → onto the tombstone + into the log so the audit shows WHY.
      const delReason = (req.nextUrl.searchParams.get("reason") || "").trim().slice(0, 200);
      await softDeleteOrders(rid, [id], { actor: actorName, actorId: g.user?.id ?? null, reason: delReason });
      await log("editor", "order_delete", { restaurant_id: rid, order_id: id, detail: delReason || undefined, device_id: deviceIdFrom(req) });
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
      // Unbanning is recorded too, so a ban that's quietly lifted still leaves a trace.
      await log("editor", "blocklist_remove", { restaurant_id: rid, detail: "unbanned", device_id: deviceIdFrom(req) });
      return ok({ ok: true });
    }

    // generic delete: DELETE /:kind/:id  (items | categories | filters | settings)
    if (a && id) {
      const t = TABLES[a];
      if (!t) return err("unknown kind", 404);
      if ((a === "items" || a === "categories" || a === "filters") && !(await managerCan(g, rid, "edit_menu"))) return permDenied("edit the menu");
      // Granular delete gate (non-breaking): a restricted manager can be blocked from deleting.
      if (a === "items" && !(await menuSubAllowed(g, rid, "delete_dish"))) return permDenied("delete dishes");
      if (a === "categories" && !(await menuSubAllowed(g, rid, "manage_categories"))) return permDenied("manage categories");
      if (a === "filters" && !(await menuSubAllowed(g, rid, "manage_filters"))) return permDenied("manage filters");
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
      // Record the menu deletion in the operation log (B25) — like create/edit above.
      if (a === "items" || a === "categories" || a === "filters") {
        await log("manager", "menu_delete", { restaurant_id: rid, detail: `deleted ${a === "items" ? "dish" : a === "categories" ? "category" : "tag"}: ${id}`, device_id: deviceIdFrom(req) });
      }
      // Deleting a dish/category/filter changes the SHARED guest menu → bust cache.
      bustMenuCache(rid);
      return ok({ ok: true });
    }

    return err("unknown DELETE endpoint", 404);
  } catch (e) {
    // Record the unexpected failure as an error-level diary line (mig 159) so it shows red in
    // the admin log and can drive the alert / nightly-fix tooling. Fire-and-forget.
    logError("manager", "route_error", e, { restaurant_id: rid, detail: `DELETE ${path.join("/") || "/"}` });
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
