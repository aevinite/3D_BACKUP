// Tablet API — the tablet/server.js surface, ported into one Next catch-all so it
// runs inside the single app (no separate :4003 server). Faithful to the
// original: same paths (under /api/tablet/*), shapes, and the service-role
// pricing RPC. The tablet UI calls fetch("/api/tablet"+path).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { logAction, logError, deviceIdFrom, deviceBlocked } from "@/lib/oplog";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { discountCapPct, discountRole, overDiscountCap } from "@/lib/discountCap";
import { liveOrdersAndItems } from "@/lib/liveBoard";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { verifyManagerPin, anyManagerHasPin } from "@/lib/managerPin";
import { closeSession, clearTableSignals } from "@/lib/sessionClose";
import { softDeleteOrders } from "@/lib/softDelete";
import { maybeAutoSettle } from "@/lib/autoSettle";
import { panelRestaurantId, emptyIdSegment } from "@/lib/panelScope";
import { rateAllowed } from "@/lib/rateLimit";
import { raiseIssue } from "@/lib/issues";
import { PAYMENT_METHODS } from "@/lib/payments";
import { isTableTag, tableTagsLadder, banquetLadder, tableOpsLadder, takeOrdersLadder, parcelLadder, COMP_TAGS, ON_THE_HOUSE_METHOD, type TableTag } from "@/lib/tableTags";
import { TABLET_PERM_KEYS } from "@/lib/accessModel";
import { effectiveTaxRate } from "@/lib/tax";
import { getOwnerEntitlements } from "@/lib/ownerEntitlements";

export const dynamic = "force-dynamic";

// Gate: only a logged-in TABLET (waiter) user (or admin super-user) may touch this.
async function gate(req: NextRequest): Promise<{ user: StaffUser | null } | NextResponse> {
  const g = await requireRole(req, "tablet");
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

// Manager-PIN gate for the tablet's sensitive actions (ban, discount, and the
// unpaid/cooking close|restart override). The admin super-user bypasses it; and
// until ANY active manager has a PIN we stay open (bootstrap) so a waiter is never
// locked out before setup. Returns { allow:true, managerName? } or a 403 to relay.
type PinGate =
  | { allow: true; managerName?: string; managerNames?: string[]; managerId?: string; managerIds?: string[]; sharedPin?: boolean }
  | { allow: false; resp: NextResponse };
async function managerPinGate(req: NextRequest, body: any, rid: string): Promise<PinGate> {
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) return { allow: true, managerName: "admin" };
  if (!(await anyManagerHasPin(rid))) return { allow: true }; // no manager PIN set yet for THIS restaurant → open
  // Lock a device out after too many wrong PINs (a 4-digit PIN is otherwise guessable).
  const throttleKey = `pin:${rid}:${deviceIdFrom(req) || "nodev"}`;
  const check = await verifyManagerPin(body?.managerPin || "", rid, throttleKey);
  if (!check.ok) {
    // Configurable manager-PIN limit (mig 205), layered on the built-in lockout so a device
    // that keeps trying wrong PINs surfaces in the admin Problems section. Only counts a real
    // PIN attempt (managerPin present), never every gated action.
    const overLimit = body?.managerPin
      ? !(await rateAllowed("manager_pin", `${rid}:${deviceIdFrom(req) || "nodev"}`, { restaurantId: rid, label: "Tablet PIN device" }))
      : false;
    return (check.locked || overLimit)
      ? { allow: false, resp: NextResponse.json({ error: "Too many wrong PINs — wait a minute and try again.", locked: true }, { status: 429 }) }
      : { allow: false, resp: NextResponse.json({ error: "A manager PIN is required for this.", needPin: true }, { status: 403 }) };
  }
  return { allow: true, managerName: check.managerName, managerNames: check.managerNames, managerId: check.managerId, managerIds: check.managerIds, sharedPin: check.sharedPin };
}
// Turn a passed gate into the log's structured "who authorised by PIN" fields, so the
// Operation log can render a manager PIN pill from real columns instead of parsing free
// text. A unique PIN names the one manager it belongs to (with a stable id for the
// bill-audit match); a PIN shared by two+ managers is genuinely ambiguous, so we name
// every one it could have been and leave the id null (no single truth). Admin bypass
// (managerName "admin") and 'on'-mode actions (no PIN) → null, nothing recorded.
type PinActor = { actor: string; actor_id: string | null; pin_shared: boolean };
function pinActorFrom(g: PinGate): PinActor | null {
  if (!g.allow || !g.managerName || g.managerName === "admin") return null;
  const names = g.managerNames && g.managerNames.length ? g.managerNames : [g.managerName];
  const shared = names.length > 1 || !!g.sharedPin;
  return { actor: names.join(" / "), actor_id: shared ? null : (g.managerId ?? g.managerIds?.[0] ?? null), pin_shared: shared };
}

// Setting-aware gate for a tablet BILLING action. The manager's Access settings
// hold a tri-state per action (tablet_discount / tablet_mark_paid / tablet_invoice):
//   'off' → blocked (default; waiter has no access)   'pin' → manager PIN required
//   'on'  → allowed directly.  Server-enforced so hiding the button isn't the only guard.
//
// PER-USER OVERRIDE (owner, 2026-07-03 · migration 115): the logged-in waiter's own
// staff_users.permissions[key] wins when set ('on'|'pin'|'off'); an absent key falls
// back to the restaurant-wide tri-state. `user` comes from the request gate — its row
// is re-read from the DB on every request by userFromCookie, so revoking someone's
// access takes effect on their very next tap (no re-login needed). Admin bypasses via
// managerPinGate as before.
// TABLET_PERM_KEYS is DERIVED from lib/accessModel.ts (2026-07-26, imported above) —
// one source of truth with the admin access panel, so a new waiter cap added there is
// honoured here automatically.
const isPermMode = (v: unknown): v is "on" | "pin" | "off" => v === "on" || v === "pin" || v === "off";
// The KOT ▾ menu's module rung (canonical ladder, mig 177): admin's allowed switch
// AND, when transferred, the owner's toggle. One tiny single-row select on a rare
// path (a merge/move tap, not a poll); the tri-state gate runs separately after it.
async function tableOpsTabletAllowed(rid: string): Promise<boolean> {
  return (await tableOpsLadder(rid)).effective;
}
// The same rule computed from an ALREADY-FETCHED settings row (the board GETs) — no
// extra query on the hot path.
const tableOpsEffectiveFromRow = (s: Record<string, unknown> | null) =>
  !!s && s.table_ops_allowed === true && (s.table_ops_owner_control !== true || s.table_ops_enabled !== false);
// Order-taking module rung (mig 179), from an already-fetched settings row. Note the
// _allowed side is backfilled true, so ordering stays on unless the admin turns it off.
const takeOrdersEffectiveFromRow = (s: Record<string, unknown> | null) =>
  !!s && s.take_orders_allowed === true && (s.take_orders_owner_control !== true || s.take_orders_enabled !== false);
// Parcel / takeaway module rung (mig 197), from an already-fetched settings row. Brand-new
// module → _allowed defaults FALSE, so the 🥡 Parcel button stays hidden until the admin grants it.
const parcelEffectiveFromRow = (s: Record<string, unknown> | null) =>
  !!s && s.parcel_allowed === true && (s.parcel_owner_control !== true || s.parcel_enabled !== false);
async function tabletPerm(key: string, req: NextRequest, body: any, rid: string, user: StaffUser | null): Promise<PinGate> {
  // Admin super-user (no staff cookie — the gate already vetted the admin token):
  // never blocked by a waiter tri-state. This is what makes the X-ray's tinted
  // buttons honest — a revealed control the admin clicks genuinely works.
  if (!user) return { allow: true, managerName: "admin" };
  const override = (user?.permissions ?? {})[key];
  let mode: string;
  if (isPermMode(override)) mode = override;
  else {
    const s = await sb.from("settings").select(key).eq("restaurant_id", rid).maybeSingle();
    mode = ((s.data as Record<string, string> | null)?.[key]) || "off";
  }
  if (mode === "off") return { allow: false, resp: NextResponse.json({ error: "This isn't enabled for you — ask a manager.", disabled: true }, { status: 403 }) };
  if (mode === "pin") return managerPinGate(req, body, rid);
  return { allow: true }; // 'on'
}

// Force-closing a table that still owes money on the TABLET (a walk-out / write-off) is
// admin-laddered via the void_bills tablet tri-state (access_config.void_bills.tablet, set on
// /aevinite → Access — the same tri-state the access screen already stores for this card).
// DEFAULT 'pin': a walk-out must stay closable by a waiter WITH a manager's PIN — this keeps
// the previous always-PIN behaviour while letting the admin switch it to direct 'on' or fully
// 'off'. Admin super-user + 'on' pass; 'off' denies; 'pin' (and unset = default) require a PIN.
// Owner/manager use the manager panel's own close, which is deliberately un-gated. (owner, 2026-07-24)
async function closeUnpaidGate(req: NextRequest, body: any, rid: string, user: StaffUser | null): Promise<PinGate> {
  if (!user) return { allow: true, managerName: "admin" }; // admin super-user
  const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
    { void_bills?: { tablet?: string } } | null;
  const mode = cfg?.void_bills?.tablet;
  if (mode === "off") return { allow: false, resp: NextResponse.json({ error: "Closing an unpaid table isn't enabled on the tablet — ask a manager.", disabled: true }, { status: 403 }) };
  if (mode === "on") return { allow: true };
  return managerPinGate(req, body, rid); // 'pin' or unset → manager PIN (the default)
}

// Overlay the logged-in waiter's per-user overrides ONTO the settings object the
// board GETs send to the tablet client. The client's tperm() reads settings[key] to
// show/hide the Mark-paid / Discount / Invoice buttons — resolving here means the
// buttons follow the PER-USER truth with zero client changes (the server gate above
// stays the real guard either way).
function overlayUserPerms<T extends Record<string, any> | null>(settings: T, user: StaffUser | null): T {
  if (!settings || !user?.permissions) return settings;
  const out: Record<string, any> = { ...settings };
  for (const k of TABLET_PERM_KEYS) if (isPermMode(user.permissions[k])) out[k] = user.permissions[k];
  return out as T;
}

const nowIso = () => new Date().toISOString();
// Mark an order EDITED after placement → bumps orders.edited_at so the "✎ Edited"
// badge shows on every panel (mirrors the manager). Best-effort; never fails the edit.
const stampEdited = async (orderId?: string | null, rid?: string) => {
  if (!orderId) return;
  try { let q = sb.from("orders").update({ edited_at: nowIso() }).eq("id", orderId); if (rid) q = q.eq("restaurant_id", rid); await q; } catch {}
};

const must = (r: any) => { if (r.error) throw new Error(r.error.message); return r.data; };
 
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// Friendly message for the banquet RPC's { ok:false, reason }.
const banquetErrMsg = (reason?: string) =>
  reason === "not_allowed" ? "Banquet billing isn't enabled for this restaurant."
  : reason === "empty_order" ? "Add at least one banquet line."
  : reason === "unknown_item" ? "That banquet item no longer exists — reopen the banquet screen."
  : reason === "bad_table" ? "Pick a valid table."
  : (reason || "Couldn't create the banquet bill.");

// Friendly message for the shift-table RPC's { ok:false, reason } (#1 — used to be
// swallowed as a 200, so a failed "Move table" looked like it worked then snapped back).
const shiftErrMsg = (reason?: string) =>
  reason === "target_occupied" ? "That table is already taken — pick a free one."
  : reason === "session_closed" ? "This table was just closed or settled — reopen it and try again."
  : reason === "bad_table" ? "Pick a valid table to move to."
  : reason === "same_table" ? "That party is already on that table."
  : (reason || "Couldn't move the table — try again.");

// Friendly message for a staff-edit RPC's { ok:false, reason } (edit-qty/note/add).
const editErrMsg = (reason?: string) =>
  reason === "order_paid" ? "Won't change a PAID bill — mark it unpaid first."
  : reason === "order_cancelled" ? "This order was cancelled — nothing to edit."
  : reason === "item_not_found" ? "That dish is no longer on the order."
  : reason === "order_not_found" ? "That order no longer exists."
  : reason === "sold_out" ? "That dish is sold out — can't add it."
  : reason === "unknown_item" ? "That dish isn't on the menu."
  : reason === "empty_order" ? "Nothing to add."
  : (reason || "Couldn't edit the order.");

async function readBody(req: NextRequest): Promise<any> { try { return await req.json(); } catch { return {}; } }

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET /api/tablet/state — everything the tablet floor needs in one call ─────
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  try {

    // whoami — boot signal for the tablet's hierarchy X-ray (Phase 3, 2026-07-06).
    // Same contract as the manager panel's: WHO is viewing, so the client can HIDE an
    // off capability from the real waiter but show it TINTED to the admin looking in.
    // higherView is ADMIN-ONLY on purpose: tabletPerm's bypass is admin-only, so an
    // owner/manager tint would promise a button that 403s on tap (work-checker).
    if (path.join("/") === "whoami") {
      // ACTUAL-VIEW mode (owner, 2026-07-28): an admin-view tab with ?view=real is answered
      // as the REAL waiter tablet (no tinted extras); simulated keeps the client's ribbon.
      const simulate = !g.user && new URL(req.url).searchParams.get("view") === "real";
      const actor = g.user ? g.user.role : simulate ? "tablet" : "admin"; // no staff cookie = admin super-user
      return ok({ actor, higherView: !g.user && !simulate, simulated: simulate });
    }

    // customer-recognize?phone=… — repeat-customer lookup for the payment sheet
    // (Customer CRM, mig 212). Read-only, scoped by rid via the RPC. Returns
    // {known,name,visits,blocked}; never lists customers. The number is only
    // used to greet a returning guest — nothing is stored on a read.
    if (path.join("/") === "customer-recognize") {
      const phone = (new URL(req.url).searchParams.get("phone") || "").trim().slice(0, 20);
      if (!phone) return ok({ known: false });
      const { data, error } = await sb.rpc("lfh_recognize_customer", { p_phone: phone, p_restaurant_id: rid });
      if (error) throw new Error(error.message);
      return ok(data || { known: false });
    }

    // ── GET /api/tablet/summary — TIER 1 of the two-tier floor (mig 101) ──────
    // The slim per-tile SUMMARY drives the tablet GRID (each tile's state/label/meta/counts/
    // due/pay/badge-flags), exactly like the manager. REUSES lfh_table_view_summary — no new
    // function. ?table=N → just that ONE tile (targeted refetch, ~5 kB); no param → the whole
    // floor + the table-AGNOSTIC bundle (settings/dishes/categories/restaurant) the grid +
    // order-taking + header need (so the grid no longer pulls the whole board just to get them).
    // The selected table's FULL detail still comes from /state?table=N (tier 2).
    if (path.join("/") === "summary") {
      const tbl = new URL(req.url).searchParams.get("table");
      // ?nomenu=1 → skip the big dishes list (the panel keeps its on-device cached menu and
      // refetches dishes only when the realtime `menu` topic says it changed, boot, or a ~10min
      // safety-net). The recurring floor refresh (60s poll / ops reloads) is the common case, and
      // the dish list was ~50KB of the ~77KB payload — so this cuts that recurring egress ~2.5x. (perf 2026-07-20)
      const nomenu = new URL(req.url).searchParams.get("nomenu") === "1";
      const { data, error } = await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: tbl || null });
      if (error) throw new Error(error.message);
      const summary = data || { tiles: {}, order_count: 0, latest_order_table: null, calls: [], requests: [], joiners: [], blocklist: [] };
      // Targeted (?table=N): tile only — the panel keeps its cached agnostic bundle.
      if (tbl) return ok(summary);
      // Full floor: attach the small table-agnostic collections in ONE round-trip. The dishes
      // query is STARTED here only on a full load (so it runs in parallel with the rest); on a
      // slim (nomenu) load it's never issued at all.
      const dishesP = nomenu
        ? null
        : sb.from("menu_items").select("id,title,price,category,tags,veg,options,open_price").eq("restaurant_id", rid).order("category");
      const [settings, categories, restaurant] = await Promise.all([
        sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
        sb.from("categories").select("slug,name,icon,sort_order,active").eq("restaurant_id", rid).order("sort_order"),
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color").eq("id", rid).maybeSingle(),
      ]);
      // KOT ▾ module rung resolved server-side from the settings row itself (canonical
      // ladder, mig 177 — no extra query): when the module isn't effective the tri-state
      // ships 'off', so the client needs zero ladder logic and a stale manager grant
      // can't surface the menu (same server-resolution trick as overlayUserPerms).
      // Applied AFTER the per-user overlay on purpose. table_ops_tablet_allowed is the
      // synthetic client flag (like banquet_allowed): module off = no dead UI/X-ray zone.
      const setOut = overlayUserPerms(must(settings), g.user);
      if (setOut) {
        const tOpsOk = tableOpsEffectiveFromRow(setOut);
        if (!tOpsOk) setOut.tablet_table_ops = "off";
        setOut.table_ops_tablet_allowed = tOpsOk;
        // Order-taking module off → the tablet's ＋Take order button hides (tri-state 'off').
        if (!takeOrdersEffectiveFromRow(setOut)) setOut.tablet_take_orders = "off";
        // Parcel module off → the tablet's 🥡 Parcel button hides (tri-state 'off').
        if (!parcelEffectiveFromRow(setOut)) setOut.tablet_parcel = "off";
      }
      const body: Record<string, unknown> = {
        ...summary,
        // Per-user overrides resolved into the tri-state keys (see overlayUserPerms).
        settings: setOut, categories: must(categories),
        restaurant: must(restaurant) || null,
      };
      // Only attach dishes on a FULL load. On nomenu the key is ABSENT (not []), so the client
      // can tell "menu not sent, keep the cached one" apart from "menu is genuinely empty".
      if (dishesP) body.dishes = must(await dishesP);
      return ok(body);
    }

    // ── GET /api/tablet/banquet-items — the banquet menu (mig 130), fetched ONLY
    // when the waiter opens the banquet screen (no polling, scoped, slim columns).
    // Server-gated the same as placing: entitlement + the tablet_banquet capability
    // ('pin' may still READ the list — the PIN protects the billing action itself).
    // khata/customers?q= — the "Collect later" person picker's search (mig 166). Read-only,
    // scoped + limited. Available whenever the manager's tablet_khata rung isn't off (the
    // park action itself re-runs the full tri-state gate incl. PIN mode).
    if (path.join("/") === "khata/customers") {
      if (g.user && !(await tableTagsLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      const kperm = (g.user?.permissions ?? {})[`tablet_khata`];
      let kmode: string;
      if (kperm === "on" || kperm === "pin" || kperm === "off") kmode = kperm;
      else kmode = String(((await sb.from("settings").select("tablet_khata").eq("restaurant_id", rid).maybeSingle()).data as Record<string, string> | null)?.tablet_khata || "off");
      if (kmode === "off" && g.user) return err("This isn't enabled for you — ask a manager.", 403);
      const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 60);
      let sel = sb.from("khata_customers").select("id,name,phone,note").eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(8);
      if (q) sel = sel.or(`name.ilike.%${q.replace(/[%,()]/g, "")}%,phone.ilike.%${q.replace(/[%,()]/g, "")}%`);
      return ok({ customers: must(await sel) });
    }

    if (path.join("/") === "banquet-items") {
      const flags = await sb.from("settings").select("banquet_allowed, tablet_banquet").eq("restaurant_id", rid).maybeSingle();
      const f = overlayUserPerms((flags.data as Record<string, any> | null), g.user);
      // Full ladder (mig 167): the owner's toggle counts too, not just the admin switch.
      if (g.user && !(await banquetLadder(rid)).effective) return err("Banquet billing isn't enabled for this restaurant.", 403);
      if ((f?.tablet_banquet || "off") === "off" && g.user) return err("Banquet billing is off for the tablet — ask a manager.", 403);
      const items = must(await sb.from("banquet_items")
        .select("id,title,price,unit,sort_order,active").eq("restaurant_id", rid).eq("active", true)
        .order("sort_order").limit(200));
      return ok({ items });
    }

    if (path.join("/") === "state") {
      // TARGETED REFETCH (owner 2026-06-26 — egress cut): when a realtime breadcrumb names
      // ONE table, the tablet asks for just that table's slice (?table=N) instead of re-reading
      // the whole floor. Only the PER-TABLE collections are scoped — sessions/members/calls/
      // orders/items/requests; settings/dishes/categories/restaurant are table-agnostic and a
      // menu event always forces a FULL pass, so they're left OUT of a targeted slice (the panel
      // keeps its cached copies). Members/items are scoped by the table's open-session ids.
      const tbl = new URL(req.url).searchParams.get("table");
      if (tbl) {
        const live = await liveOrdersAndItems(rid, [tbl]);
        const sessions = must(await sb.from("sessions").select("*").neq("status", "closed").eq("restaurant_id", rid).eq("table_number", tbl));
        const sids = (sessions || []).map((s: { id: string }) => s.id);
        const [members, calls, requests] = await Promise.all([
          sids.length ? sb.from("session_members").select("id, session_id, phone, phone_verified, name, role, approved, location_ok, removed, joined_at, device_id, restaurant_id").eq("removed", false).eq("restaurant_id", rid).in("session_id", sids) : Promise.resolve({ data: [] }),
          sb.from("waiter_calls").select("*").eq("resolved", false).eq("restaurant_id", rid).eq("table_number", tbl),
          sb.from("requests").select("*").eq("status", "pending").eq("restaurant_id", rid).eq("table_number", tbl),
        ]);
        return ok({
          sessions, members: must(members) || [], calls: must(calls),
          orders: live.orders, items: live.items, requests: must(requests),
        });
      }
      // Orders + dishes come from the shared "live board" helper so the tablet shows
      // EXACTLY what the manager shows — today's orders plus any still-open session's
      // orders, even past the 05:00 IST rollover. (This used to be a day-clipped fetch
      // here, which hid an overnight open table's orders → tablet-vs-manager desync.)
      const [live, settings, sessions, members, calls, dishes, categories, requests, restaurant] = await Promise.all([
        liveOrdersAndItems(rid),
        sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
        sb.from("sessions").select("*").neq("status", "closed").eq("restaurant_id", rid),
        sb.from("session_members").select("id, session_id, phone, phone_verified, name, role, approved, location_ok, removed, joined_at, device_id, restaurant_id").eq("removed", false).eq("restaurant_id", rid),
        sb.from("waiter_calls").select("*").eq("resolved", false).eq("restaurant_id", rid),
        sb.from("menu_items").select("id,title,price,category,tags,veg,options").eq("restaurant_id", rid).order("category"),
        sb.from("categories").select("slug,name,icon,sort_order,active").eq("restaurant_id", rid).order("sort_order"),
        sb.from("requests").select("*").eq("status", "pending").eq("restaurant_id", rid).order("created_at"),
        // THIS restaurant's identity, so the tablet header shows which restaurant the
        // panel is scoped to (multi-tenant — never a hardcoded brand). Single-row PK lookup.
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color").eq("id", rid).maybeSingle(),
      ]);
      // Same server-side KOT-menu module resolution as /summary (canonical ladder, mig 177).
      const setSt = overlayUserPerms(must(settings), g.user);
      if (setSt) {
        const tOpsOkSt = tableOpsEffectiveFromRow(setSt);
        if (!tOpsOkSt) setSt.tablet_table_ops = "off";
        setSt.table_ops_tablet_allowed = tOpsOkSt; // synthetic flag, see /summary
        if (!takeOrdersEffectiveFromRow(setSt)) setSt.tablet_take_orders = "off";
        if (!parcelEffectiveFromRow(setSt)) setSt.tablet_parcel = "off";
      }
      return ok({
        // Per-user overrides resolved into the tri-state keys (see overlayUserPerms).
        settings: setSt, sessions: must(sessions), members: must(members),
        orders: live.orders, items: live.items, calls: must(calls), dishes: must(dishes),
        categories: must(categories), requests: must(requests),
        restaurant: must(restaurant) || null,
      });
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    logError("tablet", "route_error", e, { restaurant_id: rid, detail: `GET ${path.join("/") || "/"}` });
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST: place order / attend call / approve member / open session ──────────
// Wrapped so a replayed offline action runs at most once (see lib/idempotency.ts).
export const POST = withIdempotency(postImpl, "tablet");
async function postImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  // The logged-in waiter, for per-user permission checks. Bound here because the
  // tabletPerm call sites below shadow `g` with their own gate result.
  const actor = g.user;
  // Scope EVERY tablet action-log row to the acting restaurant. staff_actions.restaurant_id
  // is NOT NULL DEFAULT #1 (mig 078), so a bare logAction("tablet", …) wrote the row under
  // restaurant #1 — a non-#1 restaurant's Log missed its own tablet actions and #1's Log
  // showed other restaurants'. This wrapper carries `rid` on all of them. (2026-07-07)
  const tabletPanel = "tablet" as const;
  // WHO authorised a PIN-gated action. Recorded ONCE per request by recordPin (wrapped
  // around every PIN gate below) and auto-attached to every log row as structured
  // actor/actor_id — so the Operation log renders a manager PIN pill from real columns,
  // not by parsing free text. Stays null for 'on'-mode or admin-bypass actions (no PIN).
  let pinAuth: { actor: string; actor_id: string | null } | null = null;
  const recordPin = <T extends PinGate>(g: T): T => { const p = pinActorFrom(g); if (p) pinAuth = { actor: p.actor, actor_id: p.actor_id }; return g; };
  // Admin panel-view actions (no staff cookie, no PIN) get the actor_id='admin:view' marker
  // so the ADMIN's log surfaces can attribute them; staff/owner reads mask it (2026-07-28).
  const log = (action: string, fields: Record<string, unknown> = {}) =>
    logAction(tabletPanel, action, { ...(!actor && !pinAuth ? { actor_id: ADMIN_VIEW_ACTOR_ID } : {}), ...(pinAuth ?? {}), ...fields, restaurant_id: rid });
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  try {
    const [a, b, c] = path;
    // A missing client id arrives as the literal "undefined"/"null"/"NaN" — reject before it
    // reaches a uuid query and throws the "invalid input syntax for type uuid" route_error.
    if (emptyIdSegment(b) || emptyIdSegment(c)) return err("Missing id — please refresh and try again.");
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which tablet/device is acting
    // A staff-blocked device can't do anything from the tablet.
    if (await deviceBlocked(dev)) return err("This device has been blocked by staff.", 403);

    // ── Raise an issue / complaint (photo + voice note optional) ────────────────
    // A waiter flags a floor problem for THIS restaurant; owner + admin see it. Media
    // is uploaded first via /api/issue-media; the URLs arrive on the body here.
    if (a === "issue") {
      const ib = body as { subject?: string; body?: string; image_url?: string; audio_url?: string };
      try {
        await raiseIssue({
          rid, subject: String(ib?.subject || ""), body: ib?.body,
          raisedBy: actor?.name || actor?.username || "Waiter",
          raisedRole: actor?.role || "tablet",
          imageUrl: ib?.image_url, audioUrl: ib?.audio_url,
        });
      } catch (e) { return err(e instanceof Error ? e.message : "Couldn't raise the issue.", 400); }
      return ok({ ok: true });
    }

    // order — server-side priced via lfh_staff_place_order (never trusts prices)
    if (a === "order" && path.length === 1) {
      // Module rung (mig 179): ordering must be enabled for this restaurant at all. Admin
      // super-user bypasses (actor === null) so its X-ray act-as still works.
      if (actor && !(await takeOrdersLadder(rid)).effective) return err("Taking orders is switched off for this restaurant.", 403);
      // The manager→tablet rung (mig 178): a real waiter may take orders only when the
      // tablet_take_orders cap allows it (tri-state off/on/pin, default 'on'; per-user
      // override honoured). The admin super-user bypasses, like every other tablet cap.
      { const g2 = recordPin(await tabletPerm("tablet_take_orders", req, body, rid, actor)); if (!g2.allow) return g2.resp; }
      const { table, items, allergies, note } = body || {};
      const t = String(table || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      // Reject a table that doesn't EXIST (must be 1..table_count). Digits alone let a
      // typo like "9932" create a phantom order floating on a non-existent table — it
      // showed orphaned in the order section and couldn't be cleared. (owner, 2026-06-18)
      const tcRow = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tableCount = Number((tcRow.data as { table_count?: number } | null)?.table_count) || 0;
      const tn = Number(t);
      if (tableCount > 0 && (tn < 1 || tn > tableCount)) return err(`Table ${t} doesn't exist (this place has ${tableCount} tables).`, 400);
      if (!Array.isArray(items) || !items.length) return err("items required");
      // Double-tap guard: refuse an IDENTICAL order for the same table within 3s
      // (prevents a fat-fingered "Send" / a network retry from issuing two KOTs). The
      // window used to be 8s, which wrongly blocked a LEGITIMATE second identical order
      // — e.g. a second guest at the same table ordering the same drink a few seconds
      // later (bug, 2026-07-06). A true fat-finger double-fire is sub-second, and the
      // client already disables the button + clears the cart on success, so 3s is ample.
      // The signature now also folds in the whole-order allergies, so an order that
      // differs only by its allergy/avoid list is no longer wrongly treated as a dupe.
      // (There is no orders.note column — the note rides on each order_item — so it isn't
      // part of this order-level signature.)
      // Normalise each line to {id, qty, options}. The INCOMING order sends options as
      // [{group,label}] while the STORED row keeps [{group,label,PRICE}] — so a naive compare
      // never matched for any dish with add-ons and the guard silently never fired for them
      // (found 2026-07-06 for the null case, 2026-07-07 for the option-shape case). Fold both
      // sides to {group,label} (drop price + coerce empty→null) so identical orders compare equal.
      const optSig = (opts: any) => (Array.isArray(opts) && opts.length)
        ? opts.map((o: any) => ({ group: o?.group ?? null, label: o?.label ?? null }))
        : null;
      // Fold each line's own allergen/avoid list (`removed`) into the signature too, so a
      // genuine second order that differs ONLY by a per-dish allergy ("Pasta no-nuts" vs a
      // plain "Pasta") is NOT flagged as a duplicate. (2026-07-07)
      const remSig = (r: any) => (Array.isArray(r) ? r.map((x: any) => String(x).toLowerCase()).sort() : []);
      const lineSig = (i: any) => ({ id: i.id, qty: Number(i.qty) || 1, options: optSig(i.options), removed: remSig(i.removed) });
      const sig = JSON.stringify({
        items: items.map(lineSig),
        allergies: Array.isArray(allergies) ? allergies : [],
      });
      // #15: this guard can also block a GENUINE second identical order (two guests at one
      // table order the same drink seconds apart). So it's now an OVERRIDABLE warning, not a
      // hard wall: on the first hit we return duplicateWarning:true and the client asks "send
      // anyway?"; when the waiter confirms it re-sends with confirmDuplicate:true and we skip
      // the check. The at-most-once idempotency (X-LFH-Action-Id) still dedupes an auto-replay
      // of the SAME queued action, so only the human "yes, really send again" path bypasses.
      if (!(body && body.confirmDuplicate === true)) {
        const recent = must(await sb.from("orders").select("items, allergies")
          .eq("table_number", t).eq("restaurant_id", rid).gte("created_at", new Date(Date.now() - 3000).toISOString()).limit(5));
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
        // Pass the "send anyway" flag through: the RPC now runs the double-tap guard
        // ATOMICALLY under a per-table lock (mig 202), which is what actually catches two
        // truly-simultaneous identical sends (the pre-check above races). confirmDuplicate
        // bypasses both layers for a deliberate re-send.
        p_confirm_duplicate: body?.confirmDuplicate === true,
      });
      if (error) throw new Error(error.message);
      // The RPC's atomic guard fired (a concurrent identical order beat this one): surface it
      // as the SAME overridable warning shape the client already handles (send anyway → retry
      // with confirmDuplicate:true), instead of returning it as a success.
      if (data && (data as { duplicateWarning?: boolean }).duplicateWarning === true) {
        return NextResponse.json({ error: (data as { error?: string }).error || "This looks identical to an order you just sent.", duplicateWarning: true }, { status: 409 });
      }
      // A WAITER placed this on the tablet, so it's already confirmed — skip the
      // kitchen "accept" step and push it straight onto the pass as "preparing"
      // (same effect as orders/:id/accept). Guest/head orders still arrive as
      // "received" and need accepting. (owner, 2026-06-16 — tablet-only)
      const placedId = (data as any)?.order_id;
      if (placedId) {
        // placedId is server-generated by the scoped placement RPC, but scope by rid anyway
        // for consistency with every other by-id write (defense in depth).
        const cur = must(await sb.from("orders").select("items").eq("id", placedId).eq("restaurant_id", rid).single());
        const its = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
        await sb.from("orders").update({ items: its, status: "preparing" }).eq("id", placedId).eq("restaurant_id", rid);
        await sb.from("order_items").update({ status: "preparing" }).eq("order_id", placedId).eq("restaurant_id", rid).eq("status", "received");
      }
      await log("order_place", { table_number: t, device_id: dev });
      return ok(data);
    }

    // parcel — a waiter-placed TAKEAWAY order (no table) → the Platform system, exactly like
    // the manager's /parcel (mig 197). Its own module + tablet cap; titles/prices resolved
    // server-side; total = item subtotal (matches every other platform order).
    if (a === "parcel" && path.length === 1) {
      if (actor && !(await parcelLadder(rid)).effective) return err("Parcel / takeaway isn't enabled for this restaurant.", 403);
      { const g2 = recordPin(await tabletPerm("tablet_parcel", req, body, rid, actor)); if (!g2.allow) return g2.resp; }
      const { items, customer, phone, note, allergies, paid, method } = body || {};
      if (!Array.isArray(items) || !items.length) return err("items required");
      const ids = [...new Set(items.map((i: any) => String(i?.id || "")).filter(Boolean))];
      const menu = (must(await sb.from("menu_items").select("id,title,price,open_price").eq("restaurant_id", rid).in("id", ids)) || []) as { id: string; title: string; price: unknown; open_price?: boolean }[];
      const byId = new Map(menu.map((d) => [String(d.id), d]));
      const picked: { title: string; qty: number; price: number; note?: string }[] = [];
      let total = 0;
      for (const it of items) {
        const d = byId.get(String(it?.id || ""));
        if (!d) continue;
        const qty = Math.max(1, Math.min(99, Number(it?.qty) || 1));
        // Open-price dish: staff typed the price at order time — honour it (clamped), don't
        // read the (empty) DB price. A missing/zero price on an open-price line is refused.
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
      const wholeNote = String(note || "").trim().slice(0, 300);
      const alg = Array.isArray(allergies) ? allergies.map((x: unknown) => String(x)).slice(0, 20) : [];
      const patch: Record<string, unknown> = { payload: { channel: "parcel", note: wholeNote || null, allergies: alg } };
      if (paid === true) { patch.paid = true; patch.paid_at = new Date().toISOString(); patch.payment_method = String(method || "cash").slice(0, 20); }
      if (row?.id) { const up = await sb.from("aggregator_orders").update(patch).eq("id", row.id).eq("restaurant_id", rid); if (up.error) throw new Error(up.error.message); }
      await log("parcel_place", { device_id: dev });
      return ok({ ...row, paid: paid === true });
    }

    // banquet/place — generate a banquet bill (mig 130). Priced server-side from
    // banquet_items by the RPC (which also re-checks the admin entitlement); the
    // tablet needs the tablet_banquet capability (tri-state + per-user override,
    // same gate family as discount/mark-paid — 'pin' rides the actGated PIN flow).
    if (a === "banquet" && b === "place") {
      // Full ladder (mig 167): owner's toggle counts; the RPC re-checks the admin
      // switch in SQL as the backstop.
      if (actor && !(await banquetLadder(rid)).effective) return err("Banquet billing isn't enabled for this restaurant.", 403);
      const gate2 = recordPin(await tabletPerm("tablet_banquet", req, body, rid, actor));
      if (!gate2.allow) return gate2.resp;
      // Table is OPTIONAL (mig 132): blank → a standalone walk-in-style bill the
      // manager settles from the Bills tab; given → lands on that table as before.
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
      await log("banquet_place", { table_number: t || null, device_id: dev, detail: `total ${(data as any)?.total}` });
      return ok(data);
    }

    // requests/:id/resolve — approve/deny a guest's open/join request (approving
    // an "open" request opens that table). Mirrors the editor.
    if (a === "requests" && c === "resolve") {
      const status = body && body.status;
      if (!["approved", "denied"].includes(status)) return err("invalid status");
      // rid-scoped: service-role bypasses RLS so .eq(restaurant_id) is the tenant boundary.
      const reqRow = must(await sb.from("requests").update({ status }).eq("id", b).eq("restaurant_id", rid).select())[0];
      if (status === "approved" && reqRow && reqRow.type === "open") {
        const existing = must(await sb.from("sessions").select("id").eq("table_number", reqRow.table_number).eq("restaurant_id", rid).neq("status", "closed").limit(1));
        if (!existing.length) must(await sb.from("sessions").insert({ table_number: reqRow.table_number, status: "open", opened_by: "waiter", opened_at: nowIso(), restaurant_id: rid }));
      }
      return ok(reqRow || null);
    }

    // calls/:id/attend
    if (a === "calls" && c === "attend") {
      const row = must(await sb.from("waiter_calls").update({ resolved: true }).eq("id", b).eq("restaurant_id", rid).select());
      await log("call_attend", { table_number: row[0]?.table_number ?? null, device_id: dev });
      return ok(row[0] || null);
    }
    // calls/:id/reopen — take back an accidental "attend" (owner undo bar, 2026-07-22):
    // put the guest's call back on the board so a mis-tap can't silently drop a real
    // water/bill request. Just flips resolved back to false.
    if (a === "calls" && c === "reopen") {
      const row = must(await sb.from("waiter_calls").update({ resolved: false }).eq("id", b).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }

    // members/:id/approve  (rid-scoped — service-role bypasses RLS, so this is the boundary)
    if (a === "members" && c === "approve") {
      const row = must(await sb.from("session_members").update({ approved: true }).eq("id", b).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }

    // members/:id/make-head — transfer the table head to another member (kick the
    // current head, promote this one). Mirrors the editor's make-head.
    if (a === "members" && c === "make-head") {
      const found = must(await sb.from("session_members").select("id,session_id,role,removed").eq("id", b).eq("restaurant_id", rid).limit(1));
      const m = found[0];
      if (!m) return err("member not found", 404);
      const sessRows = must(await sb.from("sessions").select("status").eq("id", m.session_id).eq("restaurant_id", rid).limit(1));
      if (!sessRows[0] || sessRows[0].status !== "open") return err("table is not open");
      if (m.role === "owner" && !m.removed) return ok(m);
      must(await sb.from("session_members").update({ removed: true }).eq("session_id", m.session_id).eq("restaurant_id", rid).eq("role", "owner").eq("removed", false).select());
      const row = must(await sb.from("session_members").update({ role: "owner", approved: true, removed: false }).eq("id", b).eq("restaurant_id", rid).select());
      return ok(row[0] || null);
    }

    // members/:id/remove — KICK a guest off the table (works for the head too; the
    // table stays open). Mirrors the editor's remove. (owner, 2026-06-17 — parity)
    if (a === "members" && c === "remove") {
      const row = must(await sb.from("session_members").update({ removed: true }).eq("id", b).eq("restaurant_id", rid).select());
      await log("member_remove", { detail: "kicked", device_id: dev });
      return ok(row[0] || null);
    }

    // members/:id/ban — KICK + add to the blocklist so they can't rejoin. Mirrors
    // the editor's banMember, but done server-side in one call: we look up the
    // member's phone here (the editor passes it from its row). (owner, 2026-06-17)
    if (a === "members" && c === "ban") {
      const g = recordPin(await managerPinGate(req, body, rid)); if (!g.allow) return g.resp; // manager PIN required
      const found = must(await sb.from("session_members").select("id,phone,device_id").eq("id", b).eq("restaurant_id", rid).limit(1));
      const m = found[0];
      if (!m) return err("member not found", 404);
      const phone = m.phone ? String(m.phone).trim() : null;
      // Capture the guest's DEVICE id too, so the ban targets their device (and the
      // guest "you're blocked" wall sticks), not just a phone they may not have. (077)
      const device = m.device_id ? String(m.device_id).trim() : null;
      // restaurant_id MUST be set: blocklist.restaurant_id defaults to restaurant #1, so
      // omitting it stamped every tablet ban onto #1 — the ban did nothing at the acting
      // restaurant (guest could re-scan and rejoin) and put a phantom ban on #1. The editor
      // path was fixed in mig 142; this is the matching tablet fix. (2026-07-07)
      must(await sb.from("blocklist").insert({ member_id: b, phone, device_id: device, reason: "banned from tablet", restaurant_id: rid }).select());
      if (phone) await sb.from("customers").upsert({ phone, blocked: true, restaurant_id: rid }, { onConflict: "restaurant_id,phone" });
      const row = must(await sb.from("session_members").update({ removed: true }).eq("id", b).eq("restaurant_id", rid).select());
      await log("member_ban", { detail: (phone ? `banned ${phone}` : "banned"), device_id: dev });
      return ok(row[0] || null);
    }

    // sessions/:id/auto-approve — toggle "join without staff approval". Mirrors the
    // editor endpoint exactly. (owner, 2026-06-17 — parity)
    if (a === "sessions" && c === "auto-approve") {
      const value = !!(body && body.value === true);
      const row = must(await sb.from("sessions").update({ auto_approve: value }).eq("id", b).eq("restaurant_id", rid).select());
      await log("auto_approve", { detail: value ? "on" : "off", device_id: dev });
      return ok(row[0] || null);
    }

    // orders/:id/discount — reduce ONE order's bill (comp/loyalty/fix). Clamped to
    // 0..order total, money-safe. Mirrors the editor endpoint. (owner, 2026-06-17)
    if (a === "orders" && c === "discount") {
      const g = recordPin(await tabletPerm("tablet_discount", req, body, rid, actor)); if (!g.allow) return g.resp; // off/pin/on per settings
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS); the perm
      // gate above is a FEATURE gate, not a tenant one, so a foreign ?rid= must still be blocked.
      const cur = must(await sb.from("orders").select("total, subtotal, session_id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't there anymore — refresh.", 404);
      // Per-ticket and whole-bill discount are mutually exclusive (the whole-bill discount
      // owns every ticket's discount via the split) — so block a single-ticket discount while
      // a bill discount is active, or the two would fight / double-count. (mig 143)
      if (cur.session_id) {
        const sd = (await sb.from("sessions").select("discount").eq("id", cur.session_id).eq("restaurant_id", rid).maybeSingle()).data as { discount?: number } | null;
        if (sd && Number(sd.discount) > 0) return err("Clear the whole-bill discount first, then discount a single ticket.", 409);
      }
      const raw = Number(body && body.amount);
      // Clamp to the PRE-TAX food base (subtotal), NOT the tax-inclusive total: the bill drops
      // by discount×(1+rate), so a discount above the pre-tax base would drive the due negative.
      // Defense-in-depth — the modal already caps the UI, this guards a replay / hand-formed body.
      const base = Number(cur.subtotal) || 0;
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), base) : 0;
      // Per-role %-cap (owner 2026-07-24): a waiter can't exceed their configured discount limit
      // (non-breaking — no cap → no block; admin uncapped). actor?.role: tablet → waiter bucket.
      { const cap = await discountCapPct(rid, discountRole(actor?.role)); if (overDiscountCap(amount, base, cap)) return err(`That's over your ${cap}% discount limit — ask a manager.`, 403); }
      const note = String((body && body.note) || "").slice(0, 200) || null;
      const row = must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", b).eq("restaurant_id", rid).select());
      await log("order_discount", { order_id: b, detail: `₹${amount}`, device_id: dev });
      return ok(row[0] || null);
    }

    // sessions/:id/bill-discount — WHOLE-BILL discount: one discount applied to the entire
    // table at once. Stored on the session; the RPC splits it proportionally across the
    // table's unpaid tickets' orders.discount, so every money view stays correct. Gated the
    // same as the per-ticket discount (off/on/pin). (mig 143)
    if (a === "sessions" && c === "bill-discount") {
      const g = recordPin(await tabletPerm("tablet_discount", req, body, rid, actor)); if (!g.allow) return g.resp;
      const sess = must(await sb.from("sessions").select("id, discount").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!sess) return err("That table isn't there anymore — refresh.", 404);
      // Reciprocal of the per-ticket guard above: the two discounts are mutually exclusive (the
      // whole-bill discount OWNS every ticket's orders.discount via the split, so applying one over
      // a manually-set per-ticket discount silently overwrites it — audit 2026-07-09). When there's
      // no active bill discount yet (session.discount == 0) but a ticket already carries a hand-set
      // discount, block until it's cleared. (session.discount > 0 → those ticket discounts ARE the
      // existing split, so re-applying / clearing the bill discount stays fine.)
      if (!(Number(sess.discount) > 0)) {
        const perTicket = must(await sb.from("orders").select("id").eq("session_id", b).eq("restaurant_id", rid)
          .neq("status", "cancelled").neq("payment_status", "paid").gt("discount", 0).limit(1));
        if (perTicket.length) return err("Clear the single-ticket discount first, then apply a whole-bill discount.", 409);
      }
      // Clamp to the table's Σ pre-tax subtotal of UNPAID, non-cancelled orders (defense in
      // depth — the modal already caps the UI; this guards a replay / hand-formed body).
      const subs = must(await sb.from("orders").select("subtotal").eq("session_id", b).eq("restaurant_id", rid).neq("status", "cancelled").neq("payment_status", "paid"));
      const maxBase = subs.reduce((s: number, o: any) => s + (Number(o.subtotal) || 0), 0);
      const raw = Number(body && body.amount);
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), maxBase) : 0;
      const note = String((body && body.note) || "").slice(0, 200) || null;
      const { data, error } = await sb.rpc("lfh_staff_bill_discount", { p_session: b, p_amount: amount, p_note: note });
      if (error) throw new Error(error.message);
      await log("bill_discount", { detail: `whole bill ₹${amount} (session ${b})`, device_id: dev });
      return ok(data);
    }

    // sessions/:id/invoice — waiter-side invoice generation, gated by tablet_invoice
    // (off/pin/on), independent of Mark bill paid. Calls the SAME server-authoritative
    // RPC the manager panel uses; it's idempotent (a repeat call just returns the
    // existing invoice), so there's no double-invoice risk.
    if (a === "sessions" && c === "invoice") {
      const g = recordPin(await tabletPerm("tablet_invoice", req, body, rid, actor)); if (!g.allow) return g.resp;
      // lfh_generate_invoice takes only p_session (no tenant param) — confirm the session is
      // THIS restaurant's first (service-role bypasses RLS), mirroring the editor invoice guard.
      const ownsGen = (await sb.from("sessions").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data;
      if (!ownsGen) return err("That table isn't for this restaurant.", 404);
      const { data, error } = await sb.rpc("lfh_generate_invoice", { p_session: b, p_reason: null, p_actor: actor?.name || actor?.username || null });
      if (error) { if (/invoice locked/i.test(error.message)) return err("This bill is settled — its invoice can't be reopened.", 409); throw new Error(error.message); }
      await log("invoice_generate", { detail: `session ${b}`, device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
    }

    // tables/:t/restart — clear the round off the floor but KEEP the table open:
    // every active order on the CURRENT party's session becomes served + archived
    // (a completed order kept in records/revenue — NOT cancelled). Mirrors the
    // editor's restartTable, done as one scoped bulk update. (owner, 2026-06-17)
    if (a === "tables" && c === "restart") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const openSess = (await sb.from("sessions").select("id")
        .eq("table_number", t).eq("status", "open").eq("restaurant_id", rid)
        .order("last_activity_at", { ascending: false }).limit(1)).data?.[0];
      // A restart needs a manager PIN only when there's an order GOING ON or an
      // UNPAID bill to clear — an empty table can be restarted freely.
      let peek = sb.from("orders").select("status,payment_status,total,discount").neq("status", "cancelled").eq("archived", false).eq("restaurant_id", rid);
      peek = openSess ? peek.eq("session_id", openSess.id) : peek.eq("table_number", t);
      const pending = must(await peek);
      const needsPin = pending.some((o: any) => o.status === "received" || o.status === "preparing" || o.payment_status !== "paid");
      // Audit trail: a restart archives the round even if money was still owed. Record how much
      // was outstanding so a cleared-unpaid bill isn't invisible in the log (unlike a close,
      // which logs close_unpaid). Gross total minus stored (pre-tax) discount — an "≈" figure.
      const owed = pending
        .filter((o: any) => o.payment_status !== "paid")
        .reduce((s: number, o: any) => s + ((Number(o.total) || 0) - (Number(o.discount) || 0)), 0);
      if (needsPin) { const g = recordPin(await managerPinGate(req, body, rid)); if (!g.allow) return g.resp; } // manager PIN → recorded via recordPin
      let q = sb.from("orders").update({ status: "served", archived: true, archived_at: new Date().toISOString() }).neq("status", "cancelled").eq("archived", false).eq("restaurant_id", rid);
      q = openSess ? q.eq("session_id", openSess.id) : q.eq("table_number", t);
      const rows = must(await q.select());
      // A restart ends the round (fresh round, fresh party) — release the head +
      // partners from this session, same as a close. (owner, 2026-06-18)
      if (openSess) must(await sb.from("session_members").update({ removed: true }).eq("session_id", openSess.id).eq("removed", false).select());
      // ...and resolve this table's open waiter-calls + deny its pending requests (#7), the
      // same cleanup a close does (mig 020 trigger). Without this, an unanswered call from the
      // old party left a ghost 🔔 badge + ATTEND on the now-empty table. Shared helper so the
      // manual + auto (lib/autoSettle) restart paths can't drift apart.
      await clearTableSignals(rid, t);
      await log("table_restart", { table_number: t, detail: `${rows.length} order(s) cleared${owed > 0 ? `, ≈₹${Math.round(owed)} was unpaid` : ""}`, device_id: dev });
      return ok({ ok: true, count: rows.length });
    }

    // sessions/:id/shift — move the whole party (session + orders + calls) to
    // another table, atomically, via the service-role RPC.
    if (a === "sessions" && c === "shift") {
      // Table-ops gate, same as merge / move-dish (they're all KOT ▾ table operations):
      // shifting a whole party is a table-op, so it must honour the tablet_table_ops ladder
      // (off/pin/on) — it was ungated before, so a restaurant with table-ops set to PIN/off
      // could still shift parties from the tablet. actor null = admin act-as (X-ray bypass).
      if (actor && !(await tableOpsTabletAllowed(rid))) return err("Table & KOT operations aren't enabled for the tablet here.", 403);
      { const gsh = recordPin(await tabletPerm("tablet_table_ops", req, body, rid, actor)); if (!gsh.allow) return gsh.resp; }
      const to = String((body && body.to) || "").trim();
      // lfh_staff_shift_table derives the restaurant from the session itself and
      // checks the target table within that same restaurant — no rid needed here.
      const { data, error } = await sb.rpc("lfh_staff_shift_table", { p_session: b, p_to: to });
      if (error) throw new Error(error.message);
      // The RPC signals a refused move (target occupied / session closed / bad table) as
      // { ok:false, reason } with HTTP 200 — DON'T pass that through as success, or the
      // client's optimistic move sticks visually then silently snaps back (#1). Surface a
      // real 4xx so the client reverts AND shows a toast (matches orders/:id/move).
      if (data && (data as any).ok === false) return err(shiftErrMsg((data as any).reason), 409);
      return ok(data);
    }

    // sessions/:id/merge — MERGE this party into an OCCUPIED table (one bill). Part of
    // the KOT ▾ menu: ladder-gated by the admin depth knob + the manager's tri-state
    // (tabletPerm handles off/pin/on + per-waiter overrides + the admin bypass).
    if (a === "sessions" && c === "merge") {
      // actor null = admin act-as (X-ray rule: the greyed button genuinely works).
      if (actor && !(await tableOpsTabletAllowed(rid))) return err("Table & KOT operations aren't enabled for the tablet here.", 403);
      const gm = recordPin(await tabletPerm("tablet_table_ops", req, body, rid, actor)); if (!gm.allow) return gm.resp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to)) return err("valid target table required");
      const mtc2 = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tc2 = Number((mtc2.data as { table_count?: number } | null)?.table_count) || 0;
      if (tc2 > 0 && (Number(to) < 1 || Number(to) > tc2)) return err(`Table ${to} doesn't exist (this place has ${tc2} tables).`, 400);
      // Session ownership is enforced INSIDE the RPC via p_rid (returns no_session otherwise).
      const { data: mg, error: mgErr } = await sb.rpc("lfh_staff_merge_tables", { p_session: b, p_to: to, p_rid: rid });
      if (mgErr) throw new Error(mgErr.message);
      if (mg && (mg as any).ok === false) {
        const reason = (mg as any).reason;
        const msg = reason === "target_not_open" ? "That table has no party — use Move table instead."
          : reason === "session_closed" ? "This table is already closed — nothing to merge."
          : reason === "source_invoiced" ? "This bill is already invoiced — a manager must void it before merging."
          : reason === "target_invoiced" ? `Table ${to}'s bill is already invoiced — a manager must void it before merging.`
          : reason === "same_table" ? "That's the same table."
          : "Couldn't merge: " + (reason || "refused");
        return err(msg, 409);
      }
      await log("table_merge", { table_number: to, detail: `T${(mg as any).from} → T${to} (one bill)`, device_id: dev });
      return ok(mg);
    }

    // order-items/:id/move — move ONE dish line to another table's bill (KOT ▾ menu).
    // Same ladder gate as merge; the RPC (mig 175) reprices both KOTs server-side.
    if (a === "order-items" && c === "move") {
      if (actor && !(await tableOpsTabletAllowed(rid))) return err("Table & KOT operations aren't enabled for the tablet here.", 403); // actor null = admin (X-ray)
      const gi = recordPin(await tabletPerm("tablet_table_ops", req, body, rid, actor)); if (!gi.allow) return gi.resp;
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to)) return err("valid target table required");
      const mtc3 = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const tc3 = Number((mtc3.data as { table_count?: number } | null)?.table_count) || 0;
      if (tc3 > 0 && (Number(to) < 1 || Number(to) > tc3)) return err(`Table ${to} doesn't exist (this place has ${tc3} tables).`, 400);
      const { data: im, error: imErr } = await sb.rpc("lfh_staff_move_order_item", { p_item: b, p_to: to, p_rid: rid });
      if (imErr) throw new Error(imErr.message);
      if (im && (im as any).ok === false) {
        const reason = (im as any).reason;
        const msg = reason === "order_paid" ? "Won't move a dish off a PAID bill."
          : reason === "item_not_found" ? "That dish is no longer on the order."
          : reason === "order_cancelled" ? "This order was cancelled — nothing to move."
          : reason === "source_invoiced" ? "This bill is already invoiced — a manager must void it before moving a dish off it."
          : reason === "target_invoiced" ? `Table ${to}'s bill is already invoiced — a manager must void it first.`
          : reason === "same_table" ? "That dish is already on that table."
          : "Couldn't move the dish: " + (reason || "refused");
        return err(msg, 409);
      }
      await log("order_item_move", { table_number: to, detail: `dish → table ${to} (new KOT)`, device_id: dev });
      return ok(im);
    }

    // items/:id/status — advance ONE dish (received→preparing→served) from the
    // tablet, then roll the parent order's overall status up. Mirrors the kitchen
    // endpoint exactly so kitchen + tablet stay perfectly consistent.
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "ready", "served"].includes(status)) return err("invalid status");
      const patch: any = { status };
      // Serving stamps served_at; sending a dish BACK (undo a mis-tap) must clear it
      // again, or the row keeps a stale "served at" time (owner undo bar, 2026-07-22).
      patch.served_at = status === "served" ? nowIso() : null;
      // Only order_id + session_id are needed below; the client discards the body → no full row.
      // .eq(restaurant_id, rid) on every by-id write: sb is service-role (RLS bypassed), so
      // this is the only tenant boundary — stops a foreign dish/order id being advanced.
      const updated = must(await sb.from("order_items").update(patch).eq("id", b).eq("restaurant_id", rid).select("order_id, session_id"));
      const item = updated[0];
      if (item && item.order_id) {
        // Order-level status stays coarse (received/preparing/served) so the guest
        // tracker + floor never see the internal "ready": a cooked-but-unserved
        // dish keeps the order "preparing".
        const rows = must(await sb.from("order_items").select("status").eq("order_id", item.order_id).eq("restaurant_id", rid));
        const served = rows.filter((r: any) => r.status === "served").length;
        const anyActive = rows.some((r: any) => ["preparing", "ready", "served"].includes(r.status));
        const overall = served === rows.length && rows.length > 0 ? "served" : anyActive ? "preparing" : "received";
        await sb.from("orders").update({ status: overall }).eq("id", item.order_id).eq("restaurant_id", rid);
      }
      await log("item_status", { detail: status, device_id: dev });
      if (status === "served") await maybeAutoSettle(item?.session_id, { panel: "tablet", deviceId: dev }); // last dish served may complete the table
      return ok({ ok: true });
    }

    // orders/:id/accept — accept a (often phone/online) order: everything not yet
    // served → preparing, so it shows up on the kitchen pass. Mirrors the kitchen.
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't there anymore — refresh.", 404);
      const its = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // return=minimal: client re-fetches → skip both the .select() and the full-row re-read.
      must(await sb.from("orders").update({ items: its, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      await log("order_accept", { order_id: b, device_id: dev });
      return ok({ ok: true });
    }

    // orders/:id/serve-all — mark EVERY dish on one order served in a single call
    // (the table-wide "Serve all" fans these out, one per order). Mirrors the editor.
    if (a === "orders" && c === "serve-all") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't there anymore — refresh.", 404);
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await log("order_serve", { order_id: b, device_id: dev });
      // Only session_id needed (for auto-settle); client discards the body → not the full row.
      const served = must(await sb.from("orders").select("session_id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      await maybeAutoSettle((served as any)?.session_id, { panel: "tablet", deviceId: dev }); // serving the order may complete the table
      return ok({ ok: true });
    }

    // orders/:id/allergies — staff edit of the order-wide "avoid" list (add a
    // missed allergen / fix a wrong one). Mirrors the editor endpoint exactly.
    // (owner, 2026-06-16)
    if (a === "orders" && c === "allergies") {
      const raw = Array.isArray(body?.allergies) ? body.allergies : [];
      const allergies = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      must(await sb.from("orders").update({ allergies }).eq("id", b).eq("restaurant_id", rid));
      await log("order_allergies", { order_id: b, detail: allergies.join(", ") || "(none)", device_id: dev });
      return ok({ ok: true });
    }

    // items/:id/delete — remove ONE dish and reconcile the bill. Same as the
    // editor: the lfh_delete_order_item RPC re-prices the order and refuses a
    // PAID bill (orders.total is a stored, server-priced number).
    if (a === "items" && c === "delete") {
      const { data, error } = await sb.rpc("lfh_delete_order_item", { p_item_id: b });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) {
        const reason = data.reason || "could not delete";
        const msg = reason === "order_paid" ? "Won't change a PAID bill — mark it unpaid first."
          : reason === "item_not_found" ? "That dish was already removed." : reason;
        return err(msg, reason === "order_paid" ? 409 : 400);
      }
      await log("order_item_delete", { order_id: data?.order_id, detail: data?.order_cancelled ? "order emptied → cancelled" : `dish removed, ${data?.items_left} left`, device_id: dev });
      return ok(data);
    }

    // items/:id/qty — STAFF EDIT: change ONE dish's quantity on a PLACED order.
    // Money-safe via the RPC (clamps 1..99, re-prices the bill). Mirrors the editor.
    if (a === "items" && c === "qty") {
      const qty = Math.round(Number(body?.qty));
      if (!Number.isFinite(qty) || qty < 1) return err("invalid quantity");
      const { data, error } = await sb.rpc("lfh_staff_edit_item_qty", { p_item: b, p_qty: qty });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("order_item_qty", { order_id: data?.order_id, detail: `qty → ${data?.qty}`, device_id: dev });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/note — STAFF EDIT: change ONE dish's note on a PLACED order.
    if (a === "items" && c === "note") {
      const { data, error } = await sb.rpc("lfh_staff_edit_item_note", { p_item: b, p_note: String(body?.note ?? "") });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("order_item_note", { order_id: data?.order_id, device_id: dev });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/removed — STAFF EDIT: change ONE dish's removed/allergen list ("NO X")
    // on a PLACED order. IDENTICAL to the manager (editor) endpoint so the tablet's
    // "✎ Edit" modal saves the same way; keeps the per-dish edit markers
    // (added_allergens "＋" / removed_flag "✎−"). Refuses a PAID/cancelled order.
    if (a === "items" && c === "removed") {
      const raw = Array.isArray(body?.removed) ? body.removed : [];
      const removed = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS) — no perm
      // gate fronts this endpoint, so a foreign ?rid= would otherwise read+write another
      // restaurant's dish. Scoped to match the identical editor endpoint.
      const item = must(await sb.from("order_items").select("id, order_id, removed, added_allergens, removed_flag, status").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!item) return err(editErrMsg("item_not_found"), 400);
      // Once a dish is READY or SERVED it's cooked/out — too late to change it.
      if (item.status === "ready" || item.status === "served") return err("That dish is already " + item.status + " — too late to edit.", 409);
      const order = must(await sb.from("orders").select("payment_status, status").eq("id", item.order_id).eq("restaurant_id", rid).maybeSingle());
      if (order?.payment_status === "paid") return err(editErrMsg("order_paid"), 409);
      if (order?.status === "cancelled") return err(editErrMsg("order_cancelled"), 400);
      const oldSet = new Set((Array.isArray(item.removed) ? item.removed : []).map((x: any) => String(x).toLowerCase()));
      const justAdded = removed.filter((s) => !oldSet.has(s));
      const justRemoved = [...oldSet].filter((s) => !removed.includes(s));
      const addedMark = new Set((Array.isArray(item.added_allergens) ? item.added_allergens : []).map((x: any) => String(x).toLowerCase()));
      let removedFlag = !!item.removed_flag;
      for (const s of justAdded) addedMark.add(s);
      for (const s of justRemoved) { if (addedMark.has(s)) addedMark.delete(s); else removedFlag = true; }
      const added_allergens = [...addedMark].filter((s) => removed.includes(s));
      const rowU = must(await sb.from("order_items").update({ removed, added_allergens, removed_flag: removedFlag }).eq("id", b).eq("restaurant_id", rid).select());
      const detail = [justAdded.length ? `added ${justAdded.join(", ")}` : "", justRemoved.length ? `removed ${justRemoved.join(", ")}` : ""].filter(Boolean).join("; ") || "no change";
      await log("order_item_removed", { order_id: item.order_id, detail, device_id: dev });
      await stampEdited(item.order_id, rid);
      return ok(rowU[0] || { ok: true });
    }

    // orders/:id/add-item — STAFF EDIT: ADD a new dish to an already-placed order.
    // Server-priced + re-priced. Body: { dishId, qty, options?, removed?, note? }.
    if (a === "orders" && c === "add-item") {
      const dishId = String(body?.dishId || body?.id || "").trim();
      if (!dishId) return err("dish required");
      const line = {
        id: dishId,
        qty: Math.max(1, Math.round(Number(body?.qty) || 1)),
        // Staff-typed price for open-price dishes; the RPC's pricer honours it only when the
        // dish is flagged open_price, and clamps it — normal dishes stay DB-priced.
        price: body?.price != null ? String(body.price) : undefined,
        options: Array.isArray(body?.options) ? body.options : undefined,
        removed: Array.isArray(body?.removed) ? body.removed : undefined,
        note: body?.note ? String(body.note) : undefined,
      };
      const { data, error } = await sb.rpc("lfh_staff_add_item_to_order", { p_order: b, p_items: [line] });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      // A dish ADDED by a WAITER on the tablet is already confirmed — push it straight to the
      // kitchen (received→preparing), never leave it stuck at 'received' with a dead Accept.
      // Only when the parent order is ALREADY accepted (status 'preparing'/'served'); a still-
      // 'received' online order accepts as a whole via the normal Accept flow, so we leave it.
      const parent = must(await sb.from("orders").select("items, status").eq("id", b).eq("restaurant_id", rid).single());
      if (parent && parent.status !== "received" && parent.status !== "cancelled") {
        const its = Array.isArray(parent.items)
          ? parent.items.map((i: any) => (i.status === "received" ? { ...i, status: "preparing" } : i)) : [];
        await sb.from("orders").update({ items: its }).eq("id", b).eq("restaurant_id", rid);
        await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      }
      await log("order_add_item", { order_id: b, detail: dishId, device_id: dev });
      await stampEdited(b, rid);
      return ok(data);
    }

    // orders/:id/delete — remove a WHOLE order (and its dishes). Refuses a PAID
    // order (it's a financial record); otherwise SOFT-deletes it (mig 188): the row
    // is stamped deleted, never erased, so the bill is retained for tax/audit and
    // still shows as a tombstone in the admin ledger. Never a real SQL DELETE.
    if (a === "orders" && c === "delete") {
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS) — without
      // it a foreign order id could be touched from another restaurant. Scope the gate read.
      const cur = must(await sb.from("orders").select("payment_status").eq("id", b).eq("restaurant_id", rid).single());
      if (cur && cur.payment_status === "paid") return err("Won't delete a PAID order — mark it unpaid first.", 409);
      const reason = String(body?.reason ?? "").trim();
      const who = actor?.name || actor?.username || "staff";
      await softDeleteOrders(rid, [b], { actor: who, actorId: actor?.id ?? null, reason });
      await log("order_delete", { order_id: b, device_id: dev, detail: reason || undefined });
      return ok({ ok: true });
    }

    // orders/:id/move — move a SINGLE order (and its dish rows) to another table's
    // open session. Distinct from sessions/:id/shift (which moves the whole party).
    if (a === "orders" && c === "move") {
      // Table-ops gate, same as merge / move-dish / shift: moving a whole order to another
      // table is a KOT ▾ table-op and must honour the tablet_table_ops ladder (off/pin/on).
      // It was ungated before. actor null = admin act-as (X-ray bypass).
      if (actor && !(await tableOpsTabletAllowed(rid))) return err("Table & KOT operations aren't enabled for the tablet here.", 403);
      { const gmo = recordPin(await tabletPerm("tablet_table_ops", req, body, rid, actor)); if (!gmo.allow) return gmo.resp; }
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to)) return err("valid target table required");
      // Reject a target table that doesn't exist (1..table_count) — same guard as place-order.
      const mtc = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const mTableCount = Number((mtc.data as { table_count?: number } | null)?.table_count) || 0;
      if (mTableCount > 0 && (Number(to) < 1 || Number(to) > mTableCount)) return err(`Table ${to} doesn't exist (this place has ${mTableCount} tables).`, 400);
      // All the move logic lives in the shared RPC (mig 173) — atomic, tenant-checked
      // against rid, re-splits both bills' discounts, and nudges BOTH tables' tiles
      // (the old inline version here forgot the SOURCE-table breadcrumb, so the moved
      // ticket lingered on the old tile for up to 60s). Editor shares the same RPC.
      const { data: mv, error: mvErr } = await sb.rpc("lfh_staff_move_order", { p_order: b, p_to: to, p_rid: rid });
      if (mvErr) throw new Error(mvErr.message);
      if (mv && (mv as any).ok === false) {
        const reason = (mv as any).reason;
        if (reason === "no_order") return err("That order isn't for this restaurant.", 404);
        if (reason === "order_paid") return err("Won't move a PAID order — mark it unpaid first.", 409);
        if (reason === "same_table") return err("That order is already on that table.", 400);
        if (reason === "source_invoiced") return err("This bill is already invoiced — void or regenerate its invoice before moving an order off it.", 409);
        if (reason === "target_invoiced") return err(`Table ${to}'s bill is already invoiced — void or regenerate its invoice before moving an order onto it.`, 409);
        return err(reason || "Couldn't move the order.", 400);
      }
      await log("order_move", { order_id: b, table_number: to, device_id: dev });
      return ok(mv);
    }

    // tables/:t/pay — settle the WHOLE bill: mark every unpaid, non-cancelled
    // order for the table as paid. The waiter confirms on-screen that the money
    // was actually collected before this fires.
    if (a === "tables" && c === "pay") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const g = recordPin(await tabletPerm("tablet_mark_paid", req, body, rid, actor)); if (!g.allow) return g.resp; // off/pin/on per settings
      // Settle only the CURRENT party's bill: scope to the table's open session
      // so we never mark a previous party's leftover order paid. Sessions-off
      // mode (no open session) falls back to the table's active orders.
      const openSess = (await sb.from("sessions").select("id")
        .eq("table_number", t).eq("status", "open").eq("restaurant_id", rid)
        .order("last_activity_at", { ascending: false }).limit(1)).data?.[0];
      // RULE (owner 2026-06-29): can't settle a bill while ANY order on it is still 'received'
      // (not yet accepted). The order must be accepted (gone to prepare) before payment. (When a
      // payment system is added it will auto-accept on pay and skip this — not now.)
      let rq = sb.from("orders").select("id").eq("status", "received").eq("restaurant_id", rid);
      rq = openSess ? rq.eq("session_id", openSess.id) : rq.eq("table_number", t).eq("archived", false);
      if (((await rq.limit(1)).data || []).length)
        return err("Accept the order first — a bill can only be paid once the order is accepted.", 409);
      // Never mark a 'received' order paid even if the check above is bypassed (belt-and-suspenders).
      // How the money came in — asked by the "Mark paid" flow (owner, 2026-07-01). Optional so
      // older/other callers of this endpoint don't break; unset just buckets under "Not recorded"
      // in the payment-method breakdown. paid_at starts the 30-min "restore to floor" grace
      // window (migration 112 + the editor's PATCH /orders handler, which enforces + clears it).
      const payUpdate: Record<string, unknown> = { payment_status: "paid", paid_at: new Date().toISOString() };
      // SPLIT settle (KOT ▾ menu, mig 176): several payment legs against the one bill.
      // Ladder-gated on top of tablet_mark_paid; Σ legs is re-checked server-side.
      const splits = Array.isArray(body?.splits) ? body.splits : null;
      if (splits) {
        if (actor && !(await tableOpsTabletAllowed(rid))) return err("Table & KOT operations aren't enabled for the tablet here.", 403); // actor null = admin (X-ray)
        const gs = recordPin(await tabletPerm("tablet_table_ops", req, body, rid, actor)); if (!gs.allow) return gs.resp;
        if (splits.length < 2 || splits.length > 12) return err("Give at least two split shares (max 12).");
        for (const s of splits) {
          if (!(Number(s?.amount) > 0)) return err("Every split share needs an amount above zero.");
          if (!PAYMENT_METHODS.includes(s?.method)) return err("invalid payment method in a split share");
        }
        let dq = sb.from("orders").select("id,subtotal,total,discount,session_id")
          .neq("status", "cancelled").neq("status", "received").neq("payment_status", "paid").eq("restaurant_id", rid);
        dq = openSess ? dq.eq("session_id", openSess.id) : dq.eq("table_number", t).eq("archived", false);
        const drows = (must(await dq.limit(200)) as { id: string; subtotal: number; total: number; discount: number; session_id: string | null }[]) || [];
        const sidSp = openSess?.id || drows.find((o) => o.session_id)?.session_id;
        if (!drows.length || !sidSp) return err("This table has no live bill to split.", 409);
        const setSp = (await sb.from("settings").select("tax_components, tax_rate").eq("restaurant_id", rid).maybeSingle()).data || {};
        const rateSp = effectiveTaxRate(setSp);
        // Aggregate rounding — match billMath / the printed bill (see editor route note).
        const taxableSp = Math.max(0, drows.reduce((s, o) => s + (Number(o.subtotal) || 0), 0) - drows.reduce((s, o) => s + (Number(o.discount) || 0), 0));
        const dueSp = Math.round((taxableSp + Math.round(taxableSp * rateSp * 100) / 100) * 100) / 100;
        const sumSp = splits.reduce((s: number, x: { amount: number }) => s + Number(x.amount), 0);
        if (Math.abs(sumSp - dueSp) > 0.02) return err(`The shares add up to ₹${sumSp.toFixed(2)} but the bill due is ₹${dueSp.toFixed(2)} — they must match.`, 409);
        const insSp = await sb.from("session_payments").insert(splits.map((s: { amount: number; method: string; note?: string }) => ({
          session_id: sidSp, restaurant_id: rid, amount: Math.round(Number(s.amount) * 100) / 100,
          method: String(s.method), note: String(s.note || "").slice(0, 200) || null,
        })));
        if (insSp.error) return err(insSp.error.message, 500);
        payUpdate.payment_method = "Split";
        payUpdate.payment_note = (`${splits.length}-way split: ` + splits.map((s: { amount: number; method: string }) => `₹${Number(s.amount).toFixed(0)} ${s.method}`).join(" + ")).slice(0, 200);
      } else if (body && body.payment_method !== undefined) {
        if (!PAYMENT_METHODS.includes(body.payment_method)) return err("invalid payment_method");
        payUpdate.payment_method = body.payment_method;
        payUpdate.payment_note = String(body.payment_note || "").slice(0, 200) || null;
      }
      let q = sb.from("orders").update(payUpdate)
        .neq("status", "cancelled").neq("status", "received").neq("payment_status", "paid").eq("restaurant_id", rid);
      q = openSess ? q.eq("session_id", openSess.id) : q.eq("table_number", t).eq("archived", false);
      const rows = must(await q.select());
      await log(splits ? "bill_split" : "bill_paid", { table_number: t, device_id: dev, detail: splits ? String(payUpdate.payment_note || "").slice(0, 120) : (body?.payment_method ? `via ${body.payment_method}` : undefined) });
      await maybeAutoSettle(openSess?.id, { panel: "tablet", deviceId: dev }); // auto close/restart if paid + all served
      return ok({ ok: true, count: rows.length });
    }

    // tables/:t/customer-capture — save the guest's name+number at bill time, with
    // consent (Customer CRM, mig 212). DPDP: the RPC stores NOTHING without consent.
    // Records one visit for this table's session (idempotent), links the guests'
    // devices, and bumps the returning-customer count. Gated by the restaurant's
    // "customers" entitlement (default on). Fire-and-forget from the pay sheet — a
    // failure here NEVER blocks the settle that already happened.
    if (a === "tables" && c === "customer-capture") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const ent = await getOwnerEntitlements(rid);
      if (!ent.customers) return err("The customer directory isn't enabled for this restaurant.", 403);
      const phone = String(body?.phone || "").slice(0, 20);
      const name = String(body?.name || "").slice(0, 80);
      const consent = body?.consent === true;
      const { data, error } = await sb.rpc("lfh_capture_customer", {
        p_restaurant_id: rid, p_table: t, p_phone: phone, p_name: name, p_consent: consent,
      });
      if (error) return err(error.message, 500);
      if ((data as { ok?: boolean })?.ok) await log("customer_saved", { table_number: t, device_id: dev });
      return ok(data || { ok: false });
    }

    // ── Table types (VIP / Family / Owner's Guest) + khata — mig 166 ─────────────
    // tables/:t/tag — the waiter marks/clears a table's special type. Feature-laddered
    // + the manager's tablet_table_tags tri-state (off default | on | pin).
    if (a === "tables" && c === "tag") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (actor && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      const tg = recordPin(await tabletPerm("tablet_table_tags", req, body, rid, actor)); if (!tg.allow) return tg.resp;
      const tag = body?.tag ?? null;
      if (tag === null || tag === "") {
        must(await sb.from("table_tags").delete().eq("restaurant_id", rid).eq("table_number", t).select());
        await log("table_tag_clear", { table_number: t, device_id: dev });
        return ok({ ok: true, tag: "" });
      }
      if (!isTableTag(tag)) return err("invalid tag");
      must(await sb.from("table_tags")
        .upsert({ restaurant_id: rid, table_number: t, tag, tagged_by: actor?.name || actor?.username || "waiter", tagged_at: nowIso() }, { onConflict: "restaurant_id,table_number" })
        .select());
      await log("table_tag_set", { table_number: t, detail: tag, device_id: dev });
      return ok({ ok: true, tag });
    }

    // tables/:t/on-the-house — settle a Family / Owner's-Guest table at no charge.
    // The table's mark (set by a manager or a permitted waiter) is the authorization;
    // the money-side gate is the same tablet_mark_paid tri-state as a normal settle.
    // Stored as a 100% pre-tax discount + the reserved "On the house" method, so every
    // money view (net-of-discount, paid-only) reads ₹0 — identical to the manager path.
    if (a === "tables" && c === "on-the-house") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (actor && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      const hg = recordPin(await tabletPerm("tablet_mark_paid", req, body, rid, actor)); if (!hg.allow) return hg.resp;
      const tagRow = (await sb.from("table_tags").select("tag").eq("restaurant_id", rid).eq("table_number", t).maybeSingle()).data as { tag?: TableTag } | null;
      if (!tagRow?.tag || !COMP_TAGS.includes(tagRow.tag)) return err("On the house is only for tables marked Family or Owner's Guest.", 409);
      const openSess = (await sb.from("sessions").select("id")
        .eq("table_number", t).eq("status", "open").eq("restaurant_id", rid)
        .order("last_activity_at", { ascending: false }).limit(1)).data?.[0];
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
      await log("on_the_house", { table_number: t, device_id: dev, detail: `${unpaid.length} order(s) · ${tagRow.tag}` });
      if (openSess) await maybeAutoSettle(openSess.id, { panel: "tablet", deviceId: dev });
      return ok({ ok: true, count: unpaid.length });
    }

    // tables/:t/khata — "Collect later": park the unpaid bill on a person and free the
    // table (same flow as the manager's; see the editor route). Gated by the manager's
    // tablet_khata tri-state. body { customer_id } OR { name, phone?, note? }.
    if (a === "tables" && c === "khata") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      if (actor && !(await tableTagsLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      const kg = recordPin(await tabletPerm("tablet_khata", req, body, rid, actor)); if (!kg.allow) return kg.resp;
      const openSess = (await sb.from("sessions").select("id")
        .eq("table_number", t).eq("status", "open").eq("restaurant_id", rid)
        .order("last_activity_at", { ascending: false }).limit(1)).data?.[0];
      let kq = sb.from("orders").select("id,status,payment_status").eq("restaurant_id", rid).eq("archived", false).neq("status", "cancelled");
      kq = openSess ? kq.eq("session_id", openSess.id) : kq.eq("table_number", t);
      const korders = must(await kq) as { id: string; status: string; payment_status: string }[];
      const kunpaid = korders.filter((o) => o.payment_status !== "paid");
      if (!kunpaid.length) return err("Nothing unpaid to park on this table.", 409);
      if (korders.some((o) => o.status === "received" || o.status === "preparing"))
        return err("This table still has orders cooking — serve them first, then park the bill.", 409);
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
      must(await sb.from("orders").update({ khata_at: stamp, khata_customer_id: customer!.id, archived: true, archived_at: stamp })
        .in("id", kunpaid.map((o) => o.id)).eq("restaurant_id", rid).select("id"));
      if (openSess) {
        const closed = await closeSession(openSess.id, { force: true }, { panel: "tablet", deviceId: dev, restaurantId: rid });
        if (!closed.ok) return err(closed.message, closed.status);
      } else {
        await clearTableSignals(rid, t);
      }
      await log("khata_park", { table_number: t, device_id: dev, detail: `${kunpaid.length} order(s) → ${customer!.name}` });
      return ok({ ok: true, customer, count: kunpaid.length });
    }

    // tables/:t/unpay — take back a just-made "Mark paid" (owner undo bar, 2026-07-22).
    // Reverts the CURRENT open session's paid orders back to pending within the same
    // 30-minute grace window the manager's "restore to floor" uses (migration 112), and
    // clears paid_at. Deliberately narrow: it will NOT reopen a session that already
    // auto-closed (the client only offers the undo while the table is still open) — that
    // heavier restore stays the manager panel's job. Gated by the same tablet_mark_paid
    // permission as pay, so a mistaken revert is no easier than a mistaken payment.
    if (a === "tables" && c === "unpay") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const g = recordPin(await tabletPerm("tablet_mark_paid", req, body, rid, actor)); if (!g.allow) return g.resp;
      const openSess = (await sb.from("sessions").select("id")
        .eq("table_number", t).eq("status", "open").eq("restaurant_id", rid)
        .order("last_activity_at", { ascending: false }).limit(1)).data?.[0];
      if (!openSess) return err("This table's bill is already closed — reopen it from the manager panel.", 409);
      const GRACE_MS = 30 * 60 * 1000;
      const cutoff = new Date(Date.now() - GRACE_MS).toISOString();
      // The orders settled within the grace window — the ones this undo can take back.
      // We read payment_method too so we can reverse the settle type correctly.
      const paid = must(await sb.from("orders").select("id, payment_method")
        .eq("session_id", openSess.id).eq("restaurant_id", rid)
        .eq("payment_status", "paid").gte("paid_at", cutoff)) as { id: string; payment_method: string | null }[];
      // Nothing within the grace window to reopen. Returning ok({count:0}) made the client
      // show a green "Bill reopened" toast while NOTHING changed — a silent money mismatch.
      // Match the editor's behaviour: tell the user plainly it can't be reopened here. (sweep C2)
      if (!paid.length) return err("This bill was settled more than 30 minutes ago and can no longer be reopened here — ask an admin to correct it.", 409);
      // Common revert: unpaid again + clear the paid stamp and HOW it was paid.
      // tip:0 — reverting the settle un-collects the payment, and the TIP went with it; leaving
      // it makes a re-pay-without-tip keep the old tip, which the Z-report counts again. (sweep C2)
      const base = { payment_status: "pending", paid_at: null, payment_method: null, payment_note: null, tip: 0 };
      // "On the house" ALSO stamped a 100% discount (discount = subtotal); reversing the
      // settle must strip that too, or the bill would read ₹0 due yet unpaid. Regular /
      // split settles keep whatever discount they had.
      const onHouseIds = paid.filter((o) => o.payment_method === ON_THE_HOUSE_METHOD).map((o) => o.id);
      const otherIds = paid.filter((o) => o.payment_method !== ON_THE_HOUSE_METHOD).map((o) => o.id);
      if (otherIds.length) must(await sb.from("orders").update(base).in("id", otherIds).eq("restaurant_id", rid).select("id"));
      if (onHouseIds.length) must(await sb.from("orders").update({ ...base, discount: 0, discount_note: null }).in("id", onHouseIds).eq("restaurant_id", rid).select("id"));
      // A split settle recorded payment LEGS in session_payments — drop the ones from the
      // settle we just undid so the money trail doesn't double-count. A plain pay has none;
      // older legs are outside the grace window and left alone.
      await sb.from("session_payments").delete().eq("session_id", openSess.id).eq("restaurant_id", rid).gte("created_at", cutoff);
      // The quick undo bar sends no reason; the explicit "Mark unpaid" button sends one
      // (a refund/correction) — record it for the money-accountability trail either way.
      const reason = String((body && body.reason) || "").trim().slice(0, 120);
      await log("payment_revert", { table_number: t, device_id: dev, detail: reason ? `unpaid: ${reason}` : "undo settle (within grace)" });
      // Reversing the settle reverses the visit it counted (Customer CRM, mig 212).
      await sb.rpc("lfh_uncapture_customer", { p_restaurant_id: rid, p_table: t });
      return ok({ ok: true, count: paid.length });
    }

    // sessions/:id/close — free the table (end the dining session). Uses the SHARED
    // closeSession so the rule is identical to the manager's. On the tablet the
    // "close anyway" override (force) for an unpaid/cooking table needs a manager PIN.
    if (a === "sessions" && c === "close") {
      const force = !!(body && body.force === true);
      if (force) { const g = recordPin(await closeUnpaidGate(req, body, rid, actor)); if (!g.allow) return g.resp; } // override → admin-laddered (default: manager PIN)
      const result = await closeSession(b, { force }, { panel: "tablet", deviceId: dev, restaurantId: rid });
      if (!result.ok) return err(result.message, result.status);
      return ok(result.session);
    }

    // sessions/open
    if (a === "sessions" && b === "open") {
      const t = String((body && body.table) || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      // Reject an out-of-range table (1..table_count) so a bad QR / hand-formed body can't
      // open a phantom session on a table that doesn't exist — same guard as place-order/move.
      const otc = await sb.from("settings").select("table_count").eq("restaurant_id", rid).maybeSingle();
      const oTableCount = Number((otc.data as { table_count?: number } | null)?.table_count) || 0;
      if (oTableCount > 0 && (Number(t) < 1 || Number(t) > oTableCount)) return err(`Table ${t} doesn't exist (this place has ${oTableCount} tables).`, 400);
      // Clear any still-pending "asked to open" request for this table (the editor's open RPC
      // does this via lfh_staff_open_table). Without it, opening a table with the quick "Open"
      // button left the guest's open-request pending — so after the table later closed, the tile
      // wrongly showed "Wants in / Asked to open" again from that old guest. (2026-07-07)
      await sb.from("requests").update({ status: "approved" }).eq("restaurant_id", rid).eq("table_number", t).eq("status", "pending").eq("type", "open");
      const existing = must(await sb.from("sessions").select("id").eq("table_number", t).eq("restaurant_id", rid).neq("status", "closed").limit(1));
      if (existing.length) return ok(existing[0]);
      const row = must(await sb.from("sessions").insert({ table_number: t, status: "open", opened_by: "waiter", opened_at: nowIso(), restaurant_id: rid }).select());
      await log("table_open", { table_number: t, device_id: dev });
      return ok(row[0] || null);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    // Known, user-actionable failures already returned via err(...) with a friendly message +
    // proper status ABOVE. Anything reaching here is an UNEXPECTED throw (e.g. a raw PostgREST
    // error from a since-deleted row) — don't leak the internal message to the waiter's toast;
    // log it server-side and return a generic 500. (NB2)
    console.error("[tablet POST]", e instanceof Error ? e.message : e);
    logError("tablet", "route_error", e, { restaurant_id: rid, detail: `POST ${path.join("/") || "/"}` });
    return err("Something went wrong — try again.", 500);
  }
}
