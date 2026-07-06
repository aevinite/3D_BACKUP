// Tablet API — the tablet/server.js surface, ported into one Next catch-all so it
// runs inside the single app (no separate :4003 server). Faithful to the
// original: same paths (under /api/tablet/*), shapes, and the service-role
// pricing RPC. The tablet UI calls fetch("/api/tablet"+path).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction, deviceIdFrom, deviceBlocked } from "@/lib/oplog";
import { liveOrdersAndItems } from "@/lib/liveBoard";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { verifyManagerPin, anyManagerHasPin } from "@/lib/managerPin";
import { closeSession } from "@/lib/sessionClose";
import { maybeAutoSettle } from "@/lib/autoSettle";
import { panelRestaurantId } from "@/lib/panelScope";
import { PAYMENT_METHODS } from "@/lib/payments";

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
type PinGate = { allow: true; managerName?: string } | { allow: false; resp: NextResponse };
async function managerPinGate(req: NextRequest, body: any, rid: string): Promise<PinGate> {
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) return { allow: true, managerName: "admin" };
  if (!(await anyManagerHasPin(rid))) return { allow: true }; // no manager PIN set yet for THIS restaurant → open
  const check = await verifyManagerPin(body?.managerPin || "", rid);
  if (!check.ok) return { allow: false, resp: NextResponse.json({ error: "A manager PIN is required for this.", needPin: true }, { status: 403 }) };
  return { allow: true, managerName: check.managerName };
}
const byNote = (g: { managerName?: string }) => (g.managerName && g.managerName !== "admin" ? ` (by ${g.managerName})` : "");

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
const TABLET_PERM_KEYS = ["tablet_discount", "tablet_mark_paid", "tablet_invoice", "tablet_banquet"] as const;
const isPermMode = (v: unknown): v is "on" | "pin" | "off" => v === "on" || v === "pin" || v === "off";
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
  try {
    const { path = [] } = await ctx.params;

    // whoami — boot signal for the tablet's hierarchy X-ray (Phase 3, 2026-07-06).
    // Same contract as the manager panel's: WHO is viewing, so the client can HIDE an
    // off capability from the real waiter but show it TINTED to the admin looking in.
    // higherView is ADMIN-ONLY on purpose: tabletPerm's bypass is admin-only, so an
    // owner/manager tint would promise a button that 403s on tap (work-checker).
    if (path.join("/") === "whoami") {
      const actor = g.user ? g.user.role : "admin"; // no staff cookie = admin super-user
      return ok({ actor, higherView: !g.user });
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
      const { data, error } = await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: tbl || null });
      if (error) throw new Error(error.message);
      const summary = data || { tiles: {}, order_count: 0, latest_order_table: null, calls: [], requests: [], joiners: [], blocklist: [] };
      // Targeted (?table=N): tile only — the panel keeps its cached agnostic bundle.
      if (tbl) return ok(summary);
      // Full floor: attach the small table-agnostic collections in ONE round-trip.
      const [settings, dishes, categories, restaurant] = await Promise.all([
        sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
        sb.from("menu_items").select("id,title,price,category,tags,veg,options").eq("restaurant_id", rid).order("category"),
        sb.from("categories").select("slug,name,icon,sort_order,active").eq("restaurant_id", rid).order("sort_order"),
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color").eq("id", rid).maybeSingle(),
      ]);
      return ok({
        ...summary,
        // Per-user overrides resolved into the tri-state keys (see overlayUserPerms).
        settings: overlayUserPerms(must(settings), g.user), dishes: must(dishes), categories: must(categories),
        restaurant: must(restaurant) || null,
      });
    }

    // ── GET /api/tablet/banquet-items — the banquet menu (mig 130), fetched ONLY
    // when the waiter opens the banquet screen (no polling, scoped, slim columns).
    // Server-gated the same as placing: entitlement + the tablet_banquet capability
    // ('pin' may still READ the list — the PIN protects the billing action itself).
    if (path.join("/") === "banquet-items") {
      const flags = await sb.from("settings").select("banquet_allowed, tablet_banquet").eq("restaurant_id", rid).maybeSingle();
      const f = overlayUserPerms((flags.data as Record<string, any> | null), g.user);
      if (!f?.banquet_allowed) return err("Banquet billing isn't enabled for this restaurant.", 403);
      if ((f.tablet_banquet || "off") === "off" && g.user) return err("Banquet billing is off for the tablet — ask a manager.", 403);
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
      return ok({
        // Per-user overrides resolved into the tri-state keys (see overlayUserPerms).
        settings: overlayUserPerms(must(settings), g.user), sessions: must(sessions), members: must(members),
        orders: live.orders, items: live.items, calls: must(calls), dishes: must(dishes),
        categories: must(categories), requests: must(requests),
        restaurant: must(restaurant) || null,
      });
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}

// ── POST: place order / attend call / approve member / open session ──────────
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  // The logged-in waiter, for per-user permission checks. Bound here because the
  // tabletPerm call sites below shadow `g` with their own gate result.
  const actor = g.user;
  try {
    const { path = [] } = await ctx.params;
    const [a, b, c] = path;
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which tablet/device is acting
    // A staff-blocked device can't do anything from the tablet.
    if (await deviceBlocked(dev)) return err("This device has been blocked by staff.", 403);

    // order — server-side priced via lfh_staff_place_order (never trusts prices)
    if (a === "order" && path.length === 1) {
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
      // Double-tap guard: refuse an IDENTICAL order for the same table within 8s
      // (prevents a fat-fingered "Send" from issuing two KOTs / double-charging).
      const sig = JSON.stringify(items.map((i: any) => ({ id: i.id, qty: i.qty, options: i.options })));
      const recent = must(await sb.from("orders").select("items")
        .eq("table_number", t).eq("restaurant_id", rid).gte("created_at", new Date(Date.now() - 8000).toISOString()).limit(5));
      if (recent.some((o: any) => JSON.stringify((o.items || []).map((i: any) => ({ id: i.id, qty: i.qty, options: i.options }))) === sig)) {
        return err("That order was just sent — check the ticket before re-sending.", 409);
      }
      const { data, error } = await sb.rpc("lfh_staff_place_order", {
        p_table: t, p_items: items, p_allergies: Array.isArray(allergies) ? allergies : [], p_note: note || null,
        p_restaurant_id: rid,
      });
      if (error) throw new Error(error.message);
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
      await logAction("tablet", "order_place", { table_number: t, device_id: dev });
      return ok(data);
    }

    // banquet/place — generate a banquet bill (mig 130). Priced server-side from
    // banquet_items by the RPC (which also re-checks the admin entitlement); the
    // tablet needs the tablet_banquet capability (tri-state + per-user override,
    // same gate family as discount/mark-paid — 'pin' rides the actGated PIN flow).
    if (a === "banquet" && b === "place") {
      const gate2 = await tabletPerm("tablet_banquet", req, body, rid, actor);
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
      await logAction("tablet", "banquet_place", { table_number: t || null, device_id: dev, detail: `total ${(data as any)?.total}${byNote(gate2)}` });
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
      await logAction("tablet", "call_attend", { table_number: row[0]?.table_number ?? null, device_id: dev });
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
      await logAction("tablet", "member_remove", { detail: "kicked", device_id: dev });
      return ok(row[0] || null);
    }

    // members/:id/ban — KICK + add to the blocklist so they can't rejoin. Mirrors
    // the editor's banMember, but done server-side in one call: we look up the
    // member's phone here (the editor passes it from its row). (owner, 2026-06-17)
    if (a === "members" && c === "ban") {
      const g = await managerPinGate(req, body, rid); if (!g.allow) return g.resp; // manager PIN required
      const found = must(await sb.from("session_members").select("id,phone,device_id").eq("id", b).eq("restaurant_id", rid).limit(1));
      const m = found[0];
      if (!m) return err("member not found", 404);
      const phone = m.phone ? String(m.phone).trim() : null;
      // Capture the guest's DEVICE id too, so the ban targets their device (and the
      // guest "you're blocked" wall sticks), not just a phone they may not have. (077)
      const device = m.device_id ? String(m.device_id).trim() : null;
      must(await sb.from("blocklist").insert({ member_id: b, phone, device_id: device, reason: "banned from tablet" }).select());
      if (phone) await sb.from("customers").upsert({ phone, blocked: true, restaurant_id: rid }, { onConflict: "restaurant_id,phone" });
      const row = must(await sb.from("session_members").update({ removed: true }).eq("id", b).eq("restaurant_id", rid).select());
      await logAction("tablet", "member_ban", { detail: (phone ? `banned ${phone}` : "banned") + byNote(g), device_id: dev });
      return ok(row[0] || null);
    }

    // sessions/:id/auto-approve — toggle "join without staff approval". Mirrors the
    // editor endpoint exactly. (owner, 2026-06-17 — parity)
    if (a === "sessions" && c === "auto-approve") {
      const value = !!(body && body.value === true);
      const row = must(await sb.from("sessions").update({ auto_approve: value }).eq("id", b).eq("restaurant_id", rid).select());
      await logAction("tablet", "auto_approve", { detail: value ? "on" : "off", device_id: dev });
      return ok(row[0] || null);
    }

    // orders/:id/discount — reduce ONE order's bill (comp/loyalty/fix). Clamped to
    // 0..order total, money-safe. Mirrors the editor endpoint. (owner, 2026-06-17)
    if (a === "orders" && c === "discount") {
      const g = await tabletPerm("tablet_discount", req, body, rid, actor); if (!g.allow) return g.resp; // off/pin/on per settings
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS); the perm
      // gate above is a FEATURE gate, not a tenant one, so a foreign ?rid= must still be blocked.
      const cur = must(await sb.from("orders").select("total").eq("id", b).eq("restaurant_id", rid).single());
      const raw = Number(body && body.amount);
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), Number(cur.total) || 0) : 0;
      const note = String((body && body.note) || "").slice(0, 200) || null;
      const row = must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", b).eq("restaurant_id", rid).select());
      await logAction("tablet", "order_discount", { order_id: b, detail: `₹${amount}` + byNote(g), device_id: dev });
      return ok(row[0] || null);
    }

    // sessions/:id/invoice — waiter-side invoice generation, gated by tablet_invoice
    // (off/pin/on), independent of Mark bill paid. Calls the SAME server-authoritative
    // RPC the manager panel uses; it's idempotent (a repeat call just returns the
    // existing invoice), so there's no double-invoice risk.
    if (a === "sessions" && c === "invoice") {
      const g = await tabletPerm("tablet_invoice", req, body, rid, actor); if (!g.allow) return g.resp;
      const { data, error } = await sb.rpc("lfh_generate_invoice", { p_session: b });
      if (error) throw new Error(error.message);
      await logAction("tablet", "invoice_generate", { detail: `session ${b}` + byNote(g), device_id: dev });
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
      let peek = sb.from("orders").select("status,payment_status").neq("status", "cancelled").eq("archived", false).eq("restaurant_id", rid);
      peek = openSess ? peek.eq("session_id", openSess.id) : peek.eq("table_number", t);
      const pending = must(await peek);
      const needsPin = pending.some((o: any) => o.status === "received" || o.status === "preparing" || o.payment_status !== "paid");
      let by = "";
      if (needsPin) { const g = await managerPinGate(req, body, rid); if (!g.allow) return g.resp; by = byNote(g); }
      let q = sb.from("orders").update({ status: "served", archived: true, archived_at: new Date().toISOString() }).neq("status", "cancelled").eq("archived", false).eq("restaurant_id", rid);
      q = openSess ? q.eq("session_id", openSess.id) : q.eq("table_number", t);
      const rows = must(await q.select());
      // A restart ends the round (fresh round, fresh party) — release the head +
      // partners from this session, same as a close. (owner, 2026-06-18)
      if (openSess) must(await sb.from("session_members").update({ removed: true }).eq("session_id", openSess.id).eq("removed", false).select());
      await logAction("tablet", "table_restart", { table_number: t, detail: `${rows.length} order(s) cleared` + by, device_id: dev });
      return ok({ ok: true, count: rows.length });
    }

    // sessions/:id/shift — move the whole party (session + orders + calls) to
    // another table, atomically, via the service-role RPC.
    if (a === "sessions" && c === "shift") {
      const to = String((body && body.to) || "").trim();
      // lfh_staff_shift_table derives the restaurant from the session itself and
      // checks the target table within that same restaurant — no rid needed here.
      const { data, error } = await sb.rpc("lfh_staff_shift_table", { p_session: b, p_to: to });
      if (error) throw new Error(error.message);
      return ok(data);
    }

    // items/:id/status — advance ONE dish (received→preparing→served) from the
    // tablet, then roll the parent order's overall status up. Mirrors the kitchen
    // endpoint exactly so kitchen + tablet stay perfectly consistent.
    if (a === "items" && c === "status") {
      const status = body && body.status;
      if (!["received", "preparing", "ready", "served"].includes(status)) return err("invalid status");
      const patch: any = { status };
      if (status === "served") patch.served_at = nowIso();
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
      await logAction("tablet", "item_status", { detail: status, device_id: dev });
      if (status === "served") await maybeAutoSettle(item?.session_id, { panel: "tablet", deviceId: dev }); // last dish served may complete the table
      return ok({ ok: true });
    }

    // orders/:id/accept — accept a (often phone/online) order: everything not yet
    // served → preparing, so it shows up on the kitchen pass. Mirrors the kitchen.
    if (a === "orders" && c === "accept") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());
      const its = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: i.status === "served" ? "served" : "preparing" })) : [];
      // return=minimal: client re-fetches → skip both the .select() and the full-row re-read.
      must(await sb.from("orders").update({ items: its, status: "preparing" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "preparing" }).eq("order_id", b).eq("restaurant_id", rid).eq("status", "received");
      await logAction("tablet", "order_accept", { order_id: b, device_id: dev });
      return ok({ ok: true });
    }

    // orders/:id/serve-all — mark EVERY dish on one order served in a single call
    // (the table-wide "Serve all" fans these out, one per order). Mirrors the editor.
    if (a === "orders" && c === "serve-all") {
      const cur = must(await sb.from("orders").select("items").eq("id", b).eq("restaurant_id", rid).single());
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await logAction("tablet", "order_serve", { order_id: b, device_id: dev });
      // Only session_id needed (for auto-settle); client discards the body → not the full row.
      const served = must(await sb.from("orders").select("session_id").eq("id", b).eq("restaurant_id", rid).single());
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
      await logAction("tablet", "order_allergies", { order_id: b, detail: allergies.join(", ") || "(none)", device_id: dev });
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
      await logAction("tablet", "order_item_delete", { order_id: data?.order_id, detail: data?.order_cancelled ? "order emptied → cancelled" : `dish removed, ${data?.items_left} left`, device_id: dev });
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
      await logAction("tablet", "order_item_qty", { order_id: data?.order_id, detail: `qty → ${data?.qty}`, device_id: dev });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/note — STAFF EDIT: change ONE dish's note on a PLACED order.
    if (a === "items" && c === "note") {
      const { data, error } = await sb.rpc("lfh_staff_edit_item_note", { p_item: b, p_note: String(body?.note ?? "") });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await logAction("tablet", "order_item_note", { order_id: data?.order_id, device_id: dev });
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
      await logAction("tablet", "order_item_removed", { order_id: item.order_id, detail, device_id: dev });
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
        options: Array.isArray(body?.options) ? body.options : undefined,
        removed: Array.isArray(body?.removed) ? body.removed : undefined,
        note: body?.note ? String(body.note) : undefined,
      };
      const { data, error } = await sb.rpc("lfh_staff_add_item_to_order", { p_order: b, p_items: [line] });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await logAction("tablet", "order_add_item", { order_id: b, detail: dishId, device_id: dev });
      await stampEdited(b, rid);
      return ok(data);
    }

    // orders/:id/delete — remove a WHOLE order (and its dishes). Refuses a PAID
    // order (it's a financial record); otherwise hard-deletes order + items.
    if (a === "orders" && c === "delete") {
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS) — without
      // it a foreign order id could be HARD-DELETED from another restaurant. Scope the
      // gate read AND both deletes.
      const cur = must(await sb.from("orders").select("payment_status").eq("id", b).eq("restaurant_id", rid).single());
      if (cur && cur.payment_status === "paid") return err("Won't delete a PAID order — mark it unpaid first.", 409);
      await sb.from("order_items").delete().eq("order_id", b).eq("restaurant_id", rid);
      must(await sb.from("orders").delete().eq("id", b).eq("restaurant_id", rid).select());
      await logAction("tablet", "order_delete", { order_id: b, device_id: dev });
      return ok({ ok: true });
    }

    // orders/:id/move — move a SINGLE order (and its dish rows) to another table's
    // open session. Distinct from sessions/:id/shift (which moves the whole party).
    if (a === "orders" && c === "move") {
      const to = String((body && body.to) || "").trim();
      if (!/^\d+$/.test(to)) return err("valid target table required");
      // Find (or open) the target table's session, then re-home the order onto it.
      let target = (must(await sb.from("sessions").select("id").eq("table_number", to).eq("restaurant_id", rid).neq("status", "closed").limit(1)))[0];
      if (!target) target = (must(await sb.from("sessions").insert({ table_number: to, status: "open", opened_by: "waiter", opened_at: nowIso(), restaurant_id: rid }).select()))[0];
      // Scope the SOURCE order by rid (target session is already rid-scoped above): without
      // it a foreign order id could be re-homed onto this restaurant's table (service-role
      // bypasses RLS). 0 rows moved on a foreign id → guarded below.
      const moved = must(await sb.from("orders").update({ table_number: to, session_id: target.id }).eq("id", b).eq("restaurant_id", rid).select());
      if (!moved.length) return err("That order isn't for this restaurant.", 404);
      await sb.from("order_items").update({ session_id: target.id }).eq("order_id", b).eq("restaurant_id", rid);
      // The target now has an order, so make sure it has a bill number (the bill
      // trigger only fires on INSERT, not on this move — assign it if missing).
      const tb = (must(await sb.from("sessions").select("bill_no").eq("id", target.id).limit(1)))[0];
      if (tb && tb.bill_no == null) {
        try { const { data: bn } = await sb.rpc("lfh_next_counter", { p_rid: rid, p_key: "bill" }); if (bn != null) await sb.from("sessions").update({ bill_no: bn }).eq("id", target.id).eq("restaurant_id", rid).is("bill_no", null); } catch { /* bill stays lazy if the counter isn't callable */ }
      }
      await logAction("tablet", "order_move", { order_id: b, table_number: to, device_id: dev });
      return ok(moved[0] || null);
    }

    // tables/:t/pay — settle the WHOLE bill: mark every unpaid, non-cancelled
    // order for the table as paid. The waiter confirms on-screen that the money
    // was actually collected before this fires.
    if (a === "tables" && c === "pay") {
      const t = String(b || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const g = await tabletPerm("tablet_mark_paid", req, body, rid, actor); if (!g.allow) return g.resp; // off/pin/on per settings
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
      if (body && body.payment_method !== undefined) {
        if (!PAYMENT_METHODS.includes(body.payment_method)) return err("invalid payment_method");
        payUpdate.payment_method = body.payment_method;
        payUpdate.payment_note = String(body.payment_note || "").slice(0, 200) || null;
      }
      let q = sb.from("orders").update(payUpdate)
        .neq("status", "cancelled").neq("status", "received").neq("payment_status", "paid").eq("restaurant_id", rid);
      q = openSess ? q.eq("session_id", openSess.id) : q.eq("table_number", t).eq("archived", false);
      const rows = must(await q.select());
      await logAction("tablet", "bill_paid", { table_number: t, device_id: dev, detail: body?.payment_method ? `via ${body.payment_method}` : undefined });
      await maybeAutoSettle(openSess?.id, { panel: "tablet", deviceId: dev }); // auto close/restart if paid + all served
      return ok({ ok: true, count: rows.length });
    }

    // sessions/:id/close — free the table (end the dining session). Uses the SHARED
    // closeSession so the rule is identical to the manager's. On the tablet the
    // "close anyway" override (force) for an unpaid/cooking table needs a manager PIN.
    if (a === "sessions" && c === "close") {
      const force = !!(body && body.force === true);
      if (force) { const g = await managerPinGate(req, body, rid); if (!g.allow) return g.resp; } // override → manager PIN
      const result = await closeSession(b, { force }, { panel: "tablet", deviceId: dev });
      if (!result.ok) return err(result.message, result.status);
      return ok(result.session);
    }

    // sessions/open
    if (a === "sessions" && b === "open") {
      const t = String((body && body.table) || "").trim();
      if (!/^\d+$/.test(t)) return err("valid table required");
      const existing = must(await sb.from("sessions").select("id").eq("table_number", t).eq("restaurant_id", rid).neq("status", "closed").limit(1));
      if (existing.length) return ok(existing[0]);
      const row = must(await sb.from("sessions").insert({ table_number: t, status: "open", opened_by: "waiter", opened_at: nowIso(), restaurant_id: rid }).select());
      await logAction("tablet", "table_open", { table_number: t, device_id: dev });
      return ok(row[0] || null);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e), 500);
  }
}
