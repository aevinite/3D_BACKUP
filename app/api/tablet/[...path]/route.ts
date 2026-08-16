// Tablet API — the tablet/server.js surface, ported into one Next catch-all so it
// runs inside the single app (no separate :4003 server). Faithful to the
// original: same paths (under /api/tablet/*), shapes, and the service-role
// pricing RPC. The tablet UI calls fetch("/api/tablet"+path).

import { NextRequest, NextResponse } from "next/server";
// sha1 for the menu digest served by /menu-sig (see the note there) — node:crypto, so no dep.
import { createHash } from "node:crypto";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { withIdempotency } from "@/lib/idempotency";
import { replayClash, clashJson, expectClash } from "@/lib/clash";
import { offPlanTable } from "@/lib/planTable";
import { logAction, logError, deviceIdFrom, deviceBlocked } from "@/lib/oplog";
import { recordRemoval, reasonFromBody } from "@/lib/removalAudit";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { discountCapPct, discountRole, overDiscountCap } from "@/lib/discountCap";
import { liveOrdersAndItems } from "@/lib/liveBoard";
import { requireRole, type StaffUser } from "@/lib/userAuth";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { verifyManagerPin, anyManagerHasPin } from "@/lib/managerPin";
import { closeSession, clearTableSignals } from "@/lib/sessionClose";
import { softDeleteOrders } from "@/lib/softDelete";
import { panelRestaurantId, emptyIdSegment } from "@/lib/panelScope";
import { mergeParentTable } from "@/lib/tableMerge";
import { rateAllowed } from "@/lib/rateLimit";
import { openTableSession } from "@/lib/openSession";
import { raiseIssue } from "@/lib/issues";
// ONE resolver for what a waiter may do, shared with the Access screen — see the note above
// tabletPerm(). WAITER_NEVER is the owner's "no printing, no reopening" rule made structural.
import { waiterCapValue, waiterConfigCapValue, resolveWaiterCaps, WAITER_NEVER, WAITER_FEATURE_OF, waiterFeatureOffCols, type WaiterCap } from "@/lib/accessTree";
import { worthLogging, pgError } from "@/lib/dbRefusal";
// ONE answer for a caught failure, so a database that didn't reply is told apart from a bug
// and the device can fall back to what it already has (lib/panelFailure.ts).
import { panelFailure } from "@/lib/panelFailure";
import { PAYMENT_METHODS } from "@/lib/payments";
import { settleBillInParts, reverseSplitLegs, badSplitShape } from "@/lib/paySplit";
import { isTableTag, tableTagsLadder, khataLadder, banquetLadder, tableOpsLadder, takeOrdersLadder, parcelLadder, COMP_TAGS, ON_THE_HOUSE_METHOD, type TableTag } from "@/lib/tableTags";
import { TABLET_PERM_KEYS } from "@/lib/accessModel";
import { TAX_SETTINGS_COLUMNS, resolveTaxMode, isMrpDish, splitBill } from "@/lib/tax";
import { getOwnerEntitlements } from "@/lib/ownerEntitlements";
import { waiterTables, allows, blockedReason, type SectionLimit } from "@/lib/tableAssign";
import { saveBillCustomer } from "@/lib/billCustomer";
import { sharedFloorSummary, invalidateFloor } from "@/lib/floorSummary";
import { viewAsPerson, personLabel } from "@/lib/viewAsPerson";
// What never leaves the server inside a settings row (the delivery apps' connection keys).
import { panelSafeSettings } from "@/lib/panelSettings";
import { safeSearch } from "@/lib/searchText";

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
// PARCEL module rung (migs 197/259), from an already-fetched settings row. Its OWN columns:
// the counter parcel is not the delivery apps — see the box at the top of lib/tableTags.ts.
// Reading takeaway_* here (as it did between migs 235 and 259) hides the 🥡 button on every
// restaurant that simply isn't on Zomato/Swiggy.
// PERMANENT since 2026-08-03 (owner: "the parcel counter should not have a toggle option…
// permanently there"). Kept as a named helper rather than deleted so every caller still reads
// one thing, and so this comment sits where the old gate was. The parcel_* columns still exist
// in settings and an old row may say false — reading it again would let a retired switch take a
// live feature away. See the box at the top of lib/tableTags.ts before changing this.
const parcelEffectiveFromRow = (_s: Record<string, unknown> | null) => true;
// WHAT A WAITER MAY DO — one resolver, shared with the screen (2026-08-04).
//
// This used to read `settings[key] || "off"`, which is the bug the sweep found: a capability with
// NO row on the Access screen resolved to OFF and nothing could turn it on. Eight of nine
// restaurants had tablet_mark_paid / tablet_invoice / tablet_table_ops = 'off' with no switch
// anywhere, so a waiter could not settle a bill — while the panel's own admin ribbon said
// "⚙ change in Access". `waiterCapValue()` (lib/accessTree.ts) is now the single answer for both
// sides: never-list → off, listed row → stored-or-its-default, unlisted → on.
//
// TWO RUNGS ABOVE THE WAITER, in this order:
//   1. WAITER_NEVER — printing an invoice is refused for a real waiter, always. Owner's rule
//      (2026-08-04): "tablet will not have option of print and reopen bill and stuff."
//   2. the FEATURE half — access_config[<row>].on === false means the restaurant does not have
//      the thing AT ALL, so nobody has it whatever their own override says. managerCan() has
//      always checked this; the tablet did not, so switching a money row's Feature off removed it
//      from every screen and left a waiter with a stored 'on' still able to do it.
async function tabletPerm(key: string, req: NextRequest, body: any, rid: string, user: StaffUser | null): Promise<PinGate> {
  // Admin super-user (no staff cookie — the gate already vetted the admin token):
  // never blocked by a waiter tri-state. This is what makes the X-ray's tinted
  // buttons honest — a revealed control the admin clicks genuinely works.
  if (!user) return { allow: true, managerName: "admin" };
  // The never-list is about WAITERS. A manager or owner can also reach this route (roleSatisfies:
  // manager ⊇ tablet), and they are allowed to issue an invoice — the rule is that a TABLET
  // account can't, not that this URL can't. Scoped so the owner's rule takes nothing away from
  // anyone he didn't name.
  if (user.role === "tablet" && WAITER_NEVER.includes(key)) {
    return { allow: false, resp: NextResponse.json({ error: key === "tablet_invoice" ? "Only a manager can issue the invoice." : "A waiter can't do this — ask a manager.", disabled: true }, { status: 403 }) };
  }
  const feat = WAITER_FEATURE_OF[key];
  if (feat) {
    const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as Record<string, { on?: boolean }> | null;
    if (cfg?.[feat]?.on === false) return { allow: false, resp: NextResponse.json({ error: "This isn't part of this restaurant — ask a manager.", disabled: true }, { status: 403 }) };
  }
  const override = (user?.permissions ?? {})[key];
  let mode: WaiterCap;
  if (isPermMode(override)) mode = override as WaiterCap;
  else {
    const s = await sb.from("settings").select(key).eq("restaurant_id", rid).maybeSingle();
    mode = waiterCapValue(key, (s.data as Record<string, string> | null)?.[key]);
  }
  if (mode === "off") return { allow: false, resp: NextResponse.json({ error: "This isn't enabled for you — ask a manager.", disabled: true }, { status: 403 }) };
  if (mode === "pin") return managerPinGate(req, body, rid);
  return { allow: true }; // 'on'
}
// WAITER_FEATURE_OF now comes from lib/accessTree (imported above), DERIVED from the rows' own
// `featureBind`. It was a hand-typed map here covering exactly one column — which was correct for
// today's single row and silently wrong for any future waiter row that shares a Feature half.
// (sweep T6, 2026-08-10)

// Force-closing a table that still owes money on the TABLET (a walk-out / write-off).
//
// It has its OWN Access row since 2026-08-04 — "Close a table that still owes money", stored at
// access_config.close_unpaid.tablet, default 'pin'. It used to hang off
// access_config.void_bills.tablet, i.e. off the row labelled "Reopen a bill", which is a different
// act entirely: the screen said one thing and the switch did another, and when the owner removed
// the waiter's reopen row (he never wanted a tablet reopening bills) the walk-out would have gone
// with it. Migration 268 copies any stored void_bills.tablet value into the new key so no
// restaurant's behaviour moves. A per-person override lives under `cap:close_unpaid`.
async function closeUnpaidGate(req: NextRequest, body: any, rid: string, user: StaffUser | null): Promise<PinGate> {
  if (!user) return { allow: true, managerName: "admin" }; // admin super-user
  const own = (user.permissions ?? {})["cap:close_unpaid"];
  let mode: WaiterCap;
  if (isPermMode(own)) mode = own as WaiterCap;
  else {
    const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config;
    mode = waiterConfigCapValue("close_unpaid", cfg);
  }
  if (mode === "off") return { allow: false, resp: NextResponse.json({ error: "Closing an unpaid table isn't enabled on the tablet — ask a manager.", disabled: true }, { status: 403 }) };
  if (mode === "on") return { allow: true };
  return managerPinGate(req, body, rid); // 'pin' or unset → manager PIN (the default)
}

// What the tablet client is TOLD it may do — resolved server-side, so the panel needs no rule of
// its own. Its `tperm(k)` is `settings[k] || "off"`, so every tablet_* key is passed through
// waiterCapValue() first (an unlisted floor capability becomes "on", `tablet_invoice` becomes
// "off" and its button disappears), and THEN the logged-in waiter's own overrides are laid on top.
// `user` is the real waiter, or — on an admin tab opened from someone's profile (?as=) — the
// waiter being looked through. The server gates above stay the real guard either way.
//
// `accessConfig` IS THE RESTAURANT-LEVEL RUNG and it was missing (sweep T6, 2026-08-10). The
// manager panel has always folded the Feature half into what it SHOWS
// (`effectivePowers[flag] = hasFeature && granted` in app/api/editor/whoami). The tablet did not:
// switching "Discount a bill" off for a restaurant left the Discount button sitting on the tablet,
// and the waiter found out by tapping it in front of a guest. It is applied LAST, after the
// per-person overrides, for the same reason managerCan() checks it FIRST — "this restaurant does
// not have the thing" beats anything one person was given.
function overlayUserPerms<T extends Record<string, any> | null>(settings: T, user: StaffUser | null, accessConfig?: unknown): T {
  if (!settings) return settings;
  // A manager/owner looking in through this panel keeps their own reach (see tabletPerm), so the
  // waiter resolution is applied only when a real waiter is asking.
  const asWaiter = !user || user.role === "tablet";
  const out: Record<string, any> = asWaiter ? resolveWaiterCaps({ ...settings }) : { ...settings };
  if (user?.permissions) {
    for (const k of TABLET_PERM_KEYS) {
      if (asWaiter && WAITER_NEVER.includes(k)) continue;      // an override can't grant a never
      if (isPermMode(user.permissions[k])) out[k] = user.permissions[k];
    }
  }
  // The admin super-user is never blocked by a waiter rung (X-ray honesty — the same bypass
  // tabletPerm gives it), so the Feature half applies to every real login and not to the admin.
  if (user && accessConfig !== undefined) {
    for (const k of waiterFeatureOffCols(accessConfig)) out[k] = "off";
  }
  return out as T;
}

// ── Waiter sections (mig 222) — narrowing the floor reads ────────────────────
// `limit === null` means "not a restricted caller" (admin, manager/owner looking in, or
// the module is off for this restaurant) and every function below returns untouched —
// which is why wiring these in changes nothing for anyone not using sections.
//
// Rows are filtered by their own `table_number`, so a row whose table the waiter doesn't
// hold simply never reaches the device. `blocklist` is deliberately LEFT ALONE: it is a
// restaurant-wide ban list keyed by phone/device with no table at all, and the waiter
// needs it to see that the guest in front of them is blocked.
function narrowSummary(summary: Record<string, any>, limit: SectionLimit | null): void {
  if (limit === null || !summary) return;
  const keep = (t: unknown) => allows(limit, t);
  const tiles = summary.tiles && typeof summary.tiles === "object" ? summary.tiles : {};
  const outTiles: Record<string, unknown> = {};
  for (const k of Object.keys(tiles)) if (keep(k)) outTiles[k] = tiles[k];
  summary.tiles = outTiles;
  for (const key of ["calls", "requests", "joiners"]) {
    if (Array.isArray(summary[key])) {
      summary[key] = summary[key].filter((r: { table_number?: unknown }) => keep(r?.table_number));
    }
  }
  // The RPC's last two fields are restaurant-wide (a count over ALL live orders, and the
  // newest order's table). Left as-is they'd hand a waiter a number and a table pointer
  // from outside their section. Neither is rendered by the tablet today, so narrowing
  // them costs nothing and stops them becoming a way back to the whole floor later:
  // order_count becomes "how many of MY tables are busy", and the pointer only survives
  // if it points at one of mine.
  summary.order_count = Object.values(outTiles).filter((t: any) => {
    const c = t?.counts || {};
    return (Number(c.nw) || 0) + (Number(c.ck) || 0) + (Number(c.rd) || 0) + (Number(c.sv) || 0) > 0;
  }).length;
  if (!keep(summary.latest_order_table)) summary.latest_order_table = null;
}

// (narrowRows lived here — it existed ONLY for the whole-floor /state branch, which went with
//  T4 improvement 4. The remaining per-table reads are already scoped by their own table_number,
//  and the summary is narrowed by narrowSummary above. Nothing else needs a row filter.)

const nowIso = () => new Date().toISOString();
// Mark an order EDITED after placement → bumps orders.edited_at so the "✎ Edited"
// badge shows on every panel (mirrors the manager). Best-effort; never fails the edit.
const stampEdited = async (orderId?: string | null, rid?: string) => {
  if (!orderId) return;
  try { let q = sb.from("orders").update({ edited_at: nowIso() }).eq("id", orderId); if (rid) q = q.eq("restaurant_id", rid); await q; } catch {}
};

// Keep the SQLSTATE on the thrown error: lib/dbRefusal reads it to tell a refused VALUE (400,
// the person must see it) from the server failing to answer (500, saved and retried).
const must = (r: any) => {
  if (r.error) throw pgError(r.error); // pgError keeps code/details/hint — see lib/dbRefusal
  return r.data;
};
 
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
  // mig 264 — merged parties don't shift, and a joined table is never a free target.
  : reason === "party_merged" ? "This party spans merged tables — unmerge first, then move it."
  : reason === "merged_child" ? "That table is joined with another and shares its bill — unmerge it first."
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
  // mig 215: an open-price dish reached the server with no price typed on the line.
  : reason === "price_required" ? "That dish needs a price typed in before it can be added."
  : (reason || "Couldn't edit the order.");

async function readBody(req: NextRequest): Promise<any> { try { return await req.json(); } catch { return {}; } }

type Ctx = { params: Promise<{ path?: string[] }> };

// ── GET /api/tablet/state — everything the tablet floor needs in one call ─────
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  if (!rid) return err("No restaurant scope — open this panel from the admin console.", 400);
  // WHOSE tablet is the admin looking at? ?as=<staff id> (owner, 2026-08-02 — the
  // profile's "Visit their panel"). Null for everyone else and for an unpinned admin
  // tab, and it costs NOTHING when the param is absent (no DB read). It shapes what is
  // SHOWN below — this waiter's tables and their own permission overrides — never who
  // is writing: every write gate further down still sees the admin.
  const asPerson = await viewAsPerson(req, rid, g, "tablet");
  const viewer = asPerson ?? g.user;
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
      // ...and ?as=<staff id> names WHOSE access the marks describe — it does NOT imply the
      // real view (owner, 2026-08-02). The admin keeps the whole tablet and sees what this
      // waiter lacks in cyan; only the ribbon's toggle strips it to their real tablet. The
      // first cut chained the two, so a profile visit lost the comparison it was opened for.
      const simulate = !g.user && new URL(req.url).searchParams.get("view") === "real";
      const actor = g.user ? g.user.role : simulate ? "tablet" : "admin"; // no staff cookie = admin super-user
      // asName is the SERVER's confirmation of the pin — the ribbon names a person only
      // when the view really is theirs.
      return ok({ actor, higherView: !g.user && !simulate, simulated: simulate, asName: personLabel(asPerson) });
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
    // customer-search?q=98250 — "who is this number?" while the waiter types it into the
    // bill's customer box. Same tiny prefix lookup the manager panel uses (mig 227): at most
    // 6 rows of phone + name + visit count, prefix-anchored on the index.
    if (path.join("/") === "customer-search") {
      const q = (new URL(req.url).searchParams.get("q") || "").replace(/\D/g, "").slice(0, 15);
      if (q.length < 3) return ok({ matches: [] });
      const { data, error } = await sb.rpc("lfh_customer_phone_search", { p_restaurant_id: rid, p_prefix: q, p_limit: 6 });
      if (error) throw new Error(error.message);
      return ok({ matches: Array.isArray(data) ? data : [] });
    }

    // ── GET /api/tablet/menu-sig — "has the menu changed?" in about forty bytes ──────────
    // THE SELF-HEAL USED TO COST 50 KB TO ANSWER "no" (T4 improvement 7, 2026-08-11).
    //
    // The tablet refetches the whole dish list every ~10 minutes as a safety net for a realtime
    // `menu` breadcrumb it might have missed. The net is worth keeping — a waiter selling a dish
    // that went sold-out an hour ago is a real fault — but it does not need to CARRY the menu to
    // find out nothing changed, and a menu changes a few times a week, not every ten minutes. Ten
    // tablets on a floor were paying roughly 1,440 needless dish-list downloads a day between them.
    //
    // Why a computed digest and not a timestamp: `menu_items` has no `updated_at` column, and the
    // breadcrumb table is pruned after 15 minutes (mig 057), so neither could answer this honestly.
    // The digest is built from the SLIM identifying columns — the ones whose change a waiter must
    // see (a dish appearing or leaving, its price, its sold-out/hidden tags, its name) — read
    // inside the database and hashed here, so what crosses the wire is one short string. Categories
    // ride along because the dish browser groups by them.
    //
    // DELIBERATELY NOT the fat columns (`options`, `veg`, `tax_mode`): they are what make the full
    // list 50 KB, and an edit to them lands via the realtime `menu` breadcrumb like any other. This
    // is the BACKSTOP for a missed breadcrumb, not a replacement for it — so it is allowed to be
    // slightly coarse, and it must never be the only path (it isn't).
    if (path.join("/") === "menu-sig") {
      const [mi, cat] = await Promise.all([
        sb.from("menu_items").select("id,title,price,tags").eq("restaurant_id", rid).order("id").limit(2000),
        sb.from("categories").select("slug,name,sort_order,active").eq("restaurant_id", rid).order("slug"),
      ]);
      const rows = (must(mi) || []) as { id: string; title: string | null; price: unknown; tags: unknown[] | null }[];
      const cats = (must(cat) || []) as { slug: string; name: unknown; sort_order: unknown; active: unknown }[];
      const h = createHash("sha1");
      h.update(String(rows.length) + "|");
      for (const r of rows) h.update(`${r.id}${r.title ?? ""}${String(r.price ?? "")}${(r.tags || []).join(",")}`);
      h.update("||" + String(cats.length) + "|");
      for (const c of cats) h.update(`${c.slug}${JSON.stringify(c.name ?? "")}${String(c.sort_order ?? "")}${String(c.active)}`);
      // 16 hex chars is plenty: this only has to differ when the menu differs, and a collision
      // would cost one skipped self-heal, which the realtime breadcrumb covers anyway.
      return ok({ sig: h.digest("hex").slice(0, 16), dishes: rows.length });
    }

    if (path.join("/") === "summary") {
      // ?table= must be a NUMBER (a non-numeric value reached the query and Postgres threw
      // "invalid input syntax for type integer", turning a refetch into a 500). A bad param
      // means "no targeted table" — a full, correct refresh — never an error.
      const tblRaw = new URL(req.url).searchParams.get("table");
      const tbl = tblRaw !== null && /^\d{1,6}$/.test(tblRaw.trim()) ? tblRaw.trim() : null;
      // ?nomenu=1 → skip the big dishes list (the panel keeps its on-device cached menu and
      // refetches dishes only when the realtime `menu` topic says it changed, boot, or a ~10min
      // safety-net). The recurring floor refresh (60s poll / ops reloads) is the common case, and
      // the dish list was ~50KB of the ~77KB payload — so this cuts that recurring egress ~2.5x. (perf 2026-07-20)
      const nomenu = new URL(req.url).searchParams.get("nomenu") === "1";
      // Whole-floor reads for the SAME restaurant inside a 1.5s window share ONE database
      // call (lib/floorSummary.ts) — several devices polling together used to queue 1,800
      // statements each and cross the statement timeout. A targeted ?table= refetch is never
      // shared, so a tile still updates the instant its order lands.
      const { data, error } = tbl
        ? await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: tbl })
        : await sharedFloorSummary(`floor:${rid}`, async () => await sb.rpc("lfh_table_view_summary", { p_restaurant_id: rid, p_table: null }));
      if (error) throw new Error(error.message);
      const shared = data || { tiles: {}, order_count: 0, latest_order_table: null, calls: [], requests: [], joiners: [], blocklist: [] };
      // WAITER SECTIONS (mig 222): keep only the tables this waiter was given. `limit` is
      // null — and this is a total no-op — for the admin, for a manager/owner looking in,
      // and for every restaurant with the module off. Note the RPC applies `p_table` ONLY
      // to the tile loop: calls/requests/joiners/order_count are restaurant-wide and ride
      // along on the targeted response too, so they must be narrowed on BOTH paths.
      // `viewer` = the real waiter, or the one the admin is looking through (?as=) — so
      // "visit their panel" shows THEIR section, which is the main thing a section is.
      const myTables = await waiterTables(viewer, rid); // resolved ONCE for this request
      // NARROW A COPY, NEVER THE SHARED OBJECT (found 2026-08-02, live bug).
      // The whole-floor read is shared BY REFERENCE for 1.5s (lib/floorSummary), so
      // narrowing it in place edited the snapshot every other device was about to be
      // handed: a waiter holding tables 4–6 polled, and for the next second and a half
      // the MANAGER's floor — and every other waiter's — came back with three tiles out
      // of three hundred, the rest looking free. Only a restricted viewer pays for the
      // copy; the manager/admin path (limit null) is untouched and narrowSummary is a
      // no-op for them anyway.
      const summary = myTables ? structuredClone(shared) : shared;
      narrowSummary(summary, myTables);
      // WHICH TABLES ARE SERVED AS ONE PARTY (mig 249) — same ride-along the manager's summary
      // carries. Without it the waiter's floor called a merged child "free": a waiter could seat
      // new guests on it, and any order taken there silently joins the OLD party's bill (mig 250).
      // Restaurant-scoped, live rows only, a handful at most. Deliberately NOT narrowed to the
      // waiter's section: a join can cross sections, and hiding half of it hides the bill's truth.
      // Attached to a shallow COPY — `summary` may BE the shared 1.5s floor snapshot, and the
      // one rule of that cache is that a handler never writes into it (owner bug, 2026-08-02).
      // SHARED like the floor read beside it. This list is restaurant-wide and identical in every
      // answer, but it rode on EVERY call including the targeted ?table=N one — and loadTables()
      // expands a breadcrumb to the whole party and fires one targeted call per table (realtime
      // allows up to 20 in a window), so one bulk change issued twenty identical reads for the
      // same handful of rows. Same 1.5s window, and invalidateFloor() drops this key too, so a
      // just-made merge is never served stale after a write.
      const merges = await sharedFloorSummary(`merges:${rid}`, async () => (await sb.from("table_merges")
        .select("parent_table, child_table, merged_at, merged_by")
        .eq("restaurant_id", rid).is("ended_at", null).limit(200)).data || []);
      const summaryOut = { ...(summary as Record<string, unknown>), merges };
      // Targeted (?table=N): tile only — the panel keeps its cached agnostic bundle.
      if (tbl) return ok(summaryOut);
      // Full floor: attach the small table-agnostic collections in ONE round-trip. The dishes
      // query is STARTED here only on a full load (so it runs in parallel with the rest); on a
      // slim (nomenu) load it's never issued at all.
      const dishesP = nomenu
        ? null
        : sb.from("menu_items").select("id,title,price,category,tags,veg,options,open_price,tax_mode").eq("restaurant_id", rid).order("category");
      const [settings, categories, restaurant] = await Promise.all([
        sb.from("settings").select("*").eq("restaurant_id", rid).maybeSingle(),
        sb.from("categories").select("slug,name,icon,sort_order,active").eq("restaurant_id", rid).order("sort_order"),
        sb.from("restaurants").select("id, slug, name, logo_text, accent_color, access_config").eq("id", rid).maybeSingle(),
      ]);
      // KOT ▾ module rung resolved server-side from the settings row itself (canonical
      // ladder, mig 177 — no extra query): when the module isn't effective the tri-state
      // ships 'off', so the client needs zero ladder logic and a stale manager grant
      // can't surface the menu (same server-resolution trick as overlayUserPerms).
      // Applied AFTER the per-user overlay on purpose. table_ops_tablet_allowed is the
      // synthetic client flag (like banquet_allowed): module off = no dead UI/X-ray zone.
      // The restaurant row is fetched WITH access_config in the SAME batch, so resolving the
      // waiter rungs below costs no extra query — but access_config is this restaurant's whole
      // permission record and has no business in a tablet payload, so it is peeled off before
      // the row is sent. (sweep T6, 2026-08-10)
      const restRow = must(restaurant) as Record<string, any> | null;
      const restCfg = restRow?.access_config ?? {};
      const restaurantOut = restRow
        ? Object.fromEntries(Object.entries(restRow).filter(([k]) => k !== "access_config"))
        : null;
      // …AND THE SAME RULE FOR THE SETTINGS ROW (T17 sweep, 2026-08-13). `select("*")` above is
      // deliberate — this panel reads dozens of columns and a hand-typed list goes stale — but the
      // row also carries `platform_channels`, i.e. the delivery apps' connection KEYS, which the two
      // admin screens that manage them never hand back (they answer `hasKey` / `••••1234`). Nothing
      // in public/panels reads it, so it was pure weight on the tablet's once-a-minute refresh that
      // happened to be a credential. lib/panelSettings.ts states the list once for both panels.
      const setOut = overlayUserPerms(panelSafeSettings(must(settings)), viewer, restCfg);
      if (setOut) {
        const tOpsOk = tableOpsEffectiveFromRow(setOut);
        if (!tOpsOk) setOut.tablet_table_ops = "off";
        setOut.table_ops_tablet_allowed = tOpsOk;
        // Order-taking module off → the tablet's ＋Take order button hides (tri-state 'off').
        if (!takeOrdersEffectiveFromRow(setOut)) setOut.tablet_take_orders = "off";
        // Parcel module off → the tablet's 🥡 Parcel button hides (tri-state 'off').
        if (!parcelEffectiveFromRow(setOut)) setOut.tablet_parcel = "off";
      }
      // WAITER SECTIONS: the client MUST be told the list, not just given fewer tiles.
      // renderFloor() draws 1…table_count and treats a missing tile as an EMPTY table, so
      // narrowing the payload alone would leave every other table on screen looking free.
      // `null` = not restricted (admin / manager looking in / module off) → draw everything.
      const body: Record<string, unknown> = {
        ...summaryOut,
        // Just the numbers — the client already knows table_count from settings, so it can
        // apply the same "off the floor plan stays visible" rule without a second field.
        my_tables: myTables ? myTables.tables : null,
        // Per-user overrides resolved into the tri-state keys (see overlayUserPerms).
        settings: setOut, categories: must(categories),
        restaurant: restaurantOut,
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
      if (g.user && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
      const kperm = (g.user?.permissions ?? {})[`tablet_khata`];
      let kmode: string;
      if (kperm === "on" || kperm === "pin" || kperm === "off") kmode = kperm;
      else kmode = String(((await sb.from("settings").select("tablet_khata").eq("restaurant_id", rid).maybeSingle()).data as Record<string, string> | null)?.tablet_khata || "off");
      if (kmode === "off" && g.user) return err("This isn't enabled for you — ask a manager.", 403);
      const q = safeSearch(new URL(req.url).searchParams.get("q"), 60);
      let sel = sb.from("khata_customers").select("id,name,phone,note").eq("restaurant_id", rid).order("created_at", { ascending: false }).limit(8);
      if (q) sel = sel.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
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
      // ?table= must be a NUMBER (a non-numeric value reached the query and Postgres threw
      // "invalid input syntax for type integer", turning a refetch into a 500). A bad param
      // means "no targeted table" — a full, correct refresh — never an error.
      const tblRaw = new URL(req.url).searchParams.get("table");
      const tbl = tblRaw !== null && /^\d{1,6}$/.test(tblRaw.trim()) ? tblRaw.trim() : null;
      // WAITER SECTIONS (mig 222). Resolved once for both branches below.
      const limit = await waiterTables(viewer, rid);
      if (tbl) {
        // A table outside the waiter's section answers as an EMPTY table rather than an
        // error. Deliberate: the tablet treats a failed slice fetch as "something's wrong,
        // reload everything", so a 403 here would spin a reload loop if a stale realtime
        // breadcrumb ever named someone else's table. Nothing is disclosed either way —
        // and the WRITE path (below) does refuse outright.
        if (!allows(limit, tbl)) return ok({ sessions: [], members: [], calls: [], orders: [], items: [], requests: [] });
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
      // ── NO TABLE = NO ANSWER, AND THAT IS THE POINT (T4 improvement 4, 2026-08-11) ─────────
      // There used to be a whole-floor branch here: nine parallel reads including
      // liveOrdersAndItems(rid) for EVERY table plus the entire menu_items list — comfortably the
      // heaviest read in this file. Nothing has called it since the two-tier floor landed (#59):
      // the panel asks for one table at a time (/state?table=N) and gets the floor from the slim
      // /summary. A repo-wide search for a table-less /state found only that branch's own comment.
      //
      // Deleting it rather than leaving it is deliberate. Dead code that LOOKS like the main path is
      // how a later session spends a day optimising a branch that never runs — the same reasoning
      // that took the dead /api/menu pattern out of public/sw.js. And a heavy read reachable behind
      // a live gate is worth removing on its own merits.
      //
      // Answering with a refusal instead of silence: a caller that genuinely wants the floor should
      // be told where it lives, not handed a 404 to guess at.
      return err("Ask for one table (/state?table=N) — the whole floor comes from /summary.", 400);
    }
    return err("unknown GET endpoint", 404);
  } catch (e) {
    if (worthLogging(e)) logError("tablet", "route_error", e, { restaurant_id: rid, detail: `GET ${path.join("/") || "/"}` });
    return panelFailure(e);
  }
}

// Drop this restaurant's shared floor snapshot AFTER the write has landed, as well as before
// it (see the long note on the same wrapper in app/api/editor/[...path]/route.ts): dropping it
// only at the start leaves a window where another device's whole-floor poll re-shares the
// pre-write floor for up to 1.5s, and the waiter who just marked a table paid is handed it.
// The rid rides on a WeakMap keyed by the request, so concurrent requests never mix.
const writeRid = new WeakMap<NextRequest, string>();
function invalidateFloorAfter(fn: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await fn(req, ctx);
    } finally {
      const rid = writeRid.get(req);
      if (rid) invalidateFloor(rid);
    }
  };
}

// ── POST: place order / attend call / approve member / open session ──────────
// Wrapped so a replayed offline action runs at most once (see lib/idempotency.ts).
export const POST = withIdempotency(invalidateFloorAfter(postImpl), "tablet");
async function postImpl(req: NextRequest, ctx: Ctx) {
  const g = await gate(req); if (g instanceof NextResponse) return g;
  const rid = panelRestaurantId(req, g);
  // A write to this restaurant drops its shared floor snapshot, so the very next read
  // recomputes. Dropping it here is not enough on its own — invalidateFloorAfter() above
  // drops it again once the handler has finished, which is what makes "read your own
  // write" actually true.
  if (rid) { invalidateFloor(rid); writeRid.set(req, rid); }
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
    logAction(tabletPanel, action, {
      ...(!actor && !pinAuth ? { actor_id: ADMIN_VIEW_ACTOR_ID } : {}),
      // WHO did it — the signed-in waiter. Tablet rows used to name only the PANEL, so a
      // person's own Activity and the performance report had nothing to join on. (2026-07-29)
      ...(actor ? { actor: actor.name || actor.username, actor_id: actor.id } : {}),
      // A PIN-gated action still records the MANAGER who approved it (that IS the PIN pill's
      // whole point), so pinAuth deliberately still wins over the acting waiter here.
      ...(pinAuth ?? {}), ...fields, restaurant_id: rid });
  // Resolved OUTSIDE the try so the catch below can name the endpoint that failed.
  const { path = [] } = await ctx.params;
  try {
    const [a, b, c] = path;
    // A missing client id arrives as the literal "undefined"/"null"/"NaN" — reject before it
    // reaches a uuid query and throws the "invalid input syntax for type uuid" route_error.
    if (emptyIdSegment(b) || emptyIdSegment(c)) return err("Missing id — please refresh and try again.");
    const body = await readBody(req);
    const dev = deviceIdFrom(req); // which tablet/device is acting
    // A staff-blocked device can't do anything from the tablet — but only where it was BLOCKED.
    // `rid` is resolved above (the route already refuses without one), so the ban is read against
    // this restaurant instead of platform-wide; see the note on deviceBlocked in lib/oplog.ts.
    if (await deviceBlocked(dev, rid)) return err("This device has been blocked by staff.", 403);

    // ── WAITER SECTIONS (mig 222) — ONE gate for every table-scoped write ──────
    // Deliberately checked HERE, once, instead of inside each of the ~38 action branches
    // below. Two reasons: a branch is easy to forget (and a forgotten one is a silent
    // hole), and a NEW `orders/:id/…` or `tables/:t/…` action added next year is covered
    // the day it's written without anyone remembering this feature exists.
    //
    // blockedReason() resolves the affected table from the same [a, b, c] segments the
    // dispatcher already has — following order/item/session/call/request/member ids to
    // their table, and checking BOTH ends of a move (shift / merge / move dish / move
    // ticket) so a party can't be pushed onto a table the waiter can no longer see. It
    // returns null immediately for the admin, for a manager/owner looking in, and for
    // every restaurant with the module off, so this costs one lookup only for a real
    // waiter at a restaurant that actually uses sections.
    const sectionLimit = await waiterTables(actor, rid);
    if (sectionLimit !== null) {
      const blocked = await blockedReason(sectionLimit, a, b, c, body);
      if (blocked) return err(blocked, 403);
    }

    // ── OFFLINE REPLAY CLASH (offline sync 2026-07-30) — ONE gate, same reasoning ──
    // A change that was saved on a tablet with no signal and is only arriving now must
    // not be applied if the ground moved underneath it: the table was closed and billed,
    // or a DIFFERENT party is sitting there now. Applying it would put one party's dishes
    // on another party's bill, or re-open a settled bill. Instead we refuse with a plain
    // reason and the panel asks a person to redo it (see lib/clash.ts).
    // A LIVE write never reaches this — it carries no replay marker, so replayClash()
    // returns immediately without a single extra query.
    const clash = await replayClash(req, rid, a, b, c, body as Record<string, unknown> | null);
    if (clash) return clashJson(clash);

    // A dine-in table must be one this restaurant could actually have. The suite found 20
    // orders on tables like 9,754,262 — unreachable from the floor, so their money sits in the
    // books with no tile to serve or settle it from. Generous by design (parcel counters number
    // above the plan); only the absurd is refused. See lib/planTable.ts.
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
      // A REFUSAL (sold_out / unknown_item / price_required …) fell through as a SUCCESS with
      // no order_id: the waiter saw "Order sent to the kitchen" and nothing was placed — a tap
      // that vanished in silence. Surface it as a real error so the refusal is readable.
      if (data && (data as { ok?: boolean }).ok === false) {
        return err(editErrMsg((data as { reason?: string }).reason), 400);
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
        // WHO punched this order rides along on the SAME update (no extra round trip), so the
        // performance report can say "this waiter punched 412 bills". NULL keeps meaning
        // "the guest ordered it themselves". (mig 220 added the columns; 2026-07-29)
        await sb.from("orders")
          .update({ items: its, status: "preparing", placed_by_id: actor?.id ?? null, placed_by: actor ? (actor.name || actor.username) : null })
          .eq("id", placedId).eq("restaurant_id", rid);
        await sb.from("order_items").update({ status: "preparing" }).eq("order_id", placedId).eq("restaurant_id", rid).eq("status", "received");
      }
      await log("order_place", { table_number: t, device_id: dev, order_id: placedId ?? null });
      return ok(data);
    }

    // parcel — a waiter-placed TAKEAWAY order (no table) → the Platform system, exactly like
    // the manager's /parcel (mig 197). Its own module + tablet cap; titles/prices resolved
    // server-side; total = item subtotal (matches every other platform order).
    if (a === "parcel" && path.length === 1) {
      // The MODULE is enforced for everyone, admin included (no `actor &&` here since mig 259).
      // X-ray reveals what a role is not GRANTED; it never conjures a feature the restaurant
      // does not have — and the manager panel's parcel endpoint has always refused the admin
      // too, so letting the tablet through made the same tap succeed on one panel and fail on
      // the other. The client hides the button by the same rule, so this is the belt.
      if (!(await parcelLadder(rid)).effective) return err("Parcel orders aren't switched on for this restaurant.", 403);
      { const g2 = recordPin(await tabletPerm("tablet_parcel", req, body, rid, actor)); if (!g2.allow) return g2.resp; }
      const { items, customer, phone, note, allergies, paid, method } = body || {};
      if (!Array.isArray(items) || !items.length) return err("items required");
      const ids = [...new Set(items.map((i: any) => String(i?.id || "")).filter(Boolean))];
      // `tags` IS NEEDED, not optional. Every other way into an order prices through the shared
      // server-side pricer, which refuses a dish tagged sold-out — that is why the guest cart, a
      // table order and ⚡ QO/P all answer "That dish is sold out". Parcel prices itself and had
      // never read the 86 board, so a takeaway could be taken for a dish the kitchen had just
      // marked off: a clean "sent", and a ticket nobody can cook, with the customer at the counter.
      // `tax_mode` so a parcel prices an MRP bottle the same way a table does (mig 270). This
      // path prices itself instead of calling lfh_price_order, so it must apply that rule by hand.
      const menu = (must(await sb.from("menu_items").select("id,title,price,open_price,tags,tax_mode").eq("restaurant_id", rid).in("id", ids)) || []) as { id: string; title: string; price: unknown; open_price?: boolean; tags?: string[]; tax_mode?: string }[];
      const byId = new Map(menu.map((d) => [String(d.id), d]));
      const parcelSet = (await sb.from("settings")
        .select(`${TAX_SETTINGS_COLUMNS}, item_tax_modes_allowed, mrp_tax_treatment`)
        .eq("restaurant_id", rid).maybeSingle()).data || {};
      const picked: { title: string; qty: number; price: number; note?: string; tax_mode?: string; is_mrp?: boolean }[] = [];
      let total = 0;
      for (const it of items) {
        const d = byId.get(String(it?.id || ""));
        // A dish we can't resolve was SILENTLY DROPPED here — the parcel went through one line
        // short and the customer paid for something they never got. Every other order path
        // answers `unknown_item`; so does this one now.
        if (!d) return err(editErrMsg("unknown_item"), 400);
        if (Array.isArray(d.tags) && d.tags.includes("sold-out")) return err(`"${d.title}" is sold out — can't add it.`, 400);
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
        const line: { title: string; qty: number; price: number; note?: string; tax_mode?: string; is_mrp?: boolean } = {
          title: d.title, qty, price,
          // Resolved and FROZEN onto the line, exactly as lfh_price_order does for a table.
          tax_mode: resolveTaxMode(d.tax_mode, parcelSet),
        };
        if (isMrpDish(d.tax_mode, parcelSet)) line.is_mrp = true;
        const ln = String(it?.note || "").trim().slice(0, 200);
        if (ln) line.note = ln;
        picked.push(line);
        total += price * qty;
      }
      if (!picked.length) return err("no valid dishes", 400);
      total = Math.round(total * 100) / 100;
      // THE RECORD MUST EQUAL THE PAPER (fixed 2026-08-02). A parcel was stored at the item
      // subtotal with no tax, while the bill handed to the customer runs through the same
      // billMath() a table's bill does and ADDS tax on top — so ₹250 of food was charged as
      // ₹262.50 and recorded as ₹250. For a tax tool that is the wrong way round: the sale was
      // understated by exactly the tax collected. A counter takeaway is a taxable sale like any
      // other, so it is stored like any other — subtotal + tax — using the ONE tax source
      // (lib/tax.ts), never a rate typed in here. aggregator_orders has a single `total` column
      // and for every delivery row it already means the final amount; a parcel now agrees.
      // The printed bill takes its subtotal from the LINES (never this stored total, or it would
      // tax it twice), so paper and record land on the same number.
      // The split (mig 270): only the taxable part is taxed, so a sealed bottle sold at the
      // counter is not taxed any more than the same bottle sold at a table.
      const parcelSplit = splitBill(picked, parcelSet, 0);
      total = parcelSplit.total;

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
      // .eq("status", "pending") IS THE POINT (added 2026-08-06, T4 sweep). The manager's identical
      // endpoint has always had it; this one did not, so an ALREADY-resolved request could be
      // resolved again — and because "approved" + type "open" goes on to OPEN A TABLE, a waiter
      // tapping Approve on a stale screen could seat a party on a request a colleague had just
      // DENIED. That produces exactly the state the owner had removed on 2026-08-01: a table the
      // floor draws as Free while the database calls it open. Two waiters on one floor is all it
      // takes. With the filter, the second tap matches no row and is refused out loud below.
      const reqRow = must(await sb.from("requests").update({ status }).eq("id", b).eq("restaurant_id", rid).eq("status", "pending").select())[0];
      // ALREADY ANSWERED — and the two cases are NOT the same (twin-parity pass, 2026-08-07).
      // The update is scoped `.eq("status","pending")`, so a request somebody already answered matches
      // no row. What happens next depends on WHO answered and HOW:
      //   · same answer  → this is a double-tap or a re-poll of your own action. The outcome you wanted
      //     already holds, so say OK. (That idempotence is deliberate — B22 — and it is what stops a
      //     re-approve running the open-session insert twice.)
      //   · different answer → somebody ELSE decided the other way. Reporting success would hide that:
      //     the waiter taps Approve on a request a colleague just DENIED, is told it worked, and on the
      //     tablet that used to go on to OPEN A TABLE nobody asked for.
      // So: idempotent for your own repeat, refused out loud when the ground actually moved.
      if (!reqRow) {
        const now = must(await sb.from("requests").select("status").eq("id", b).eq("restaurant_id", rid).maybeSingle()) as { status?: string } | null;
        if (!now) return err("That request is no longer there — refresh.", 404);
        if (now.status !== status) return err(`Someone already ${now.status === "approved" ? "approved" : "denied"} that request — refresh to see where it stands.`, 409);
        return ok(null);   // same answer, already recorded — nothing more to do
      }
      if (status === "approved" && reqRow.type === "open") {
        const existing = must(await sb.from("sessions").select("id").eq("table_number", reqRow.table_number).eq("restaurant_id", rid).neq("status", "closed").limit(1));
        if (!existing.length) await openTableSession(rid, String(reqRow.table_number)); // race-tolerant (2026-07-30)
      }
      return ok(reqRow);
    }

    // calls/:id/attend
    if (a === "calls" && c === "attend") {
      const row = must(await sb.from("waiter_calls").update({ resolved: true }).eq("id", b).eq("restaurant_id", rid).select());
      // The call is GONE (a manager deleted it — the editor route really does hard-delete these).
      // This used to answer 200, so the waiter got a success AND an undo bar offering to put a call
      // back that no longer exists — and the undo (calls/:id/reopen) was equally silent. Two taps,
      // neither of which did anything, both reported as done. (2026-08-06, T4 sweep)
      if (!row[0]) return err("That call is no longer on the board — refresh and try again.", 404);
      await log("call_attend", { table_number: row[0]?.table_number ?? null, device_id: dev });
      return ok(row[0]);
    }
    // calls/:id/reopen — take back an accidental "attend" (owner undo bar, 2026-07-22):
    // put the guest's call back on the board so a mis-tap can't silently drop a real
    // water/bill request. Just flips resolved back to false.
    if (a === "calls" && c === "reopen") {
      const row = must(await sb.from("waiter_calls").update({ resolved: false }).eq("id", b).eq("restaurant_id", rid).select());
      // Same rule as attend above: an undo that reopened nothing must say so, or the waiter believes
      // the guest's call is back on the board when it isn't.
      if (!row[0]) return err("That call no longer exists, so it can't be put back — refresh.", 404);
      return ok(row[0]);
    }

    // members/:id/approve  (rid-scoped — service-role bypasses RLS, so this is the boundary)
    if (a === "members" && c === "approve") {
      const row = must(await sb.from("session_members").update({ approved: true }).eq("id", b).eq("restaurant_id", rid).select());
      // The guest left the party (or the table closed) between the paint and the tap. 200 here made
      // the waiter think they had let someone in. Same 404 as make-head/ban two branches down.
      if (!row[0]) return err("That guest is no longer on this table — refresh and try again.", 404);
      return ok(row[0]);
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
      if (!row[0]) return err("That guest is no longer on this table — refresh and try again.", 404);
      await log("member_remove", { detail: "kicked", device_id: dev });
      return ok(row[0]);
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
      // The table was closed while the toggle was on screen — the setting had nowhere to land.
      if (!row[0]) return err("That table has closed — the setting wasn't saved.", 404);
      await log("auto_approve", { detail: value ? "on" : "off", device_id: dev });
      return ok(row[0]);
    }

    // orders/:id/discount — reduce ONE order's bill (comp/loyalty/fix). Clamped to
    // 0..order total, money-safe. Mirrors the editor endpoint. (owner, 2026-06-17)
    if (a === "orders" && c === "discount") {
      const g = recordPin(await tabletPerm("tablet_discount", req, body, rid, actor)); if (!g.allow) return g.resp; // off/pin/on per settings
      // .eq(restaurant_id, rid) is the tenant boundary (service-role bypasses RLS); the perm
      // gate above is a FEATURE gate, not a tenant one, so a foreign ?rid= must still be blocked.
      const cur = must(await sb.from("orders").select("total, subtotal, taxable_base, session_id").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't there anymore — refresh.", 404);
      // Per-ticket and whole-bill discount are mutually exclusive (the whole-bill discount
      // owns every ticket's discount via the split) — so block a single-ticket discount while
      // a bill discount is active, or the two would fight / double-count. (mig 143)
      if (cur.session_id) {
        const sd = (await sb.from("sessions").select("discount").eq("id", cur.session_id).eq("restaurant_id", rid).maybeSingle()).data as { discount?: number } | null;
        if (sd && Number(sd.discount) > 0) return err("Clear the whole-bill discount first, then discount a single ticket.", 409);
      }
      const raw = Number(body && body.amount);
      // Clamp to the TAXABLE base, NOT the tax-inclusive total and no longer the whole subtotal:
      // the bill drops by discount×(1+rate), so a discount above that base would drive the due
      // negative — and with untaxed MRP lines in the ticket (mig 270) the subtotal INCLUDES money
      // that is legally final, so discounting against it would quietly cut an MRP price.
      // taxable_base is NULL on every order placed before mig 270, and NULL there means "all of
      // it was taxable" — which is exactly what subtotal says, so the fallback is not a guess.
      // Defense-in-depth — the modal already caps the UI, this guards a replay / hand-formed body.
      const base = Number(cur.taxable_base ?? cur.subtotal) || 0;
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), base) : 0;
      // Per-role %-cap (owner 2026-07-24): a waiter can't exceed their configured discount limit
      // (non-breaking — no cap → no block; admin uncapped). actor?.role: tablet → waiter bucket.
      { const cap = await discountCapPct(rid, discountRole(actor?.role)); if (overDiscountCap(amount, base, cap)) return err(`That's over your ${cap}% discount limit — ask a manager.`, 403); }
      const note = String((body && body.note) || "").slice(0, 200) || null;
      const row = must(await sb.from("orders").update({ discount: amount, discount_note: note }).eq("id", b).eq("restaurant_id", rid).select());
      await log("order_discount", { order_id: b, detail: `₹${amount}`, device_id: dev });
      // Money off a bill is a money-lowering change wherever it is taken, so the WAITER's discount
      // is recorded exactly like the manager's (2026-08-03 — the manager side went server-side in
      // PR #727 and this side was left behind, so a waiter could take ₹500 off a bill and the
      // Removals record stayed empty). Removing a discount puts money BACK, so amount 0 is not a
      // removal — the activity log above carries that.
      if (amount > 0) await recordRemoval({
        rid, kind: "discount_given",
        reason: { code: reasonFromBody(body).code, note: reasonFromBody(body).note || note },
        user: actor ?? null, deviceId: dev, orderId: b, sessionId: cur.session_id ?? null, amount,
        meta: { discount: amount, from: "waiter tablet", scope: "one ticket" },
      });
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
      // Clamp to the table's Σ TAXABLE base over its UNPAID, non-cancelled orders (defense in
      // depth — the modal already caps the UI; this guards a replay / hand-formed body). Same
      // reason as the per-ticket clamp above: an MRP line's money sits in `subtotal` but is a
      // final price, so it may never be part of what a discount is measured against (mig 270).
      // NULL taxable_base = an order from before that migration = all of it was taxable.
      const subs = must(await sb.from("orders").select("subtotal, taxable_base").eq("session_id", b).eq("restaurant_id", rid).neq("status", "cancelled").neq("payment_status", "paid"));
      const maxBase = subs.reduce((s: number, o: any) => s + (Number(o.taxable_base ?? o.subtotal) || 0), 0);
      const raw = Number(body && body.amount);
      const amount = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), maxBase) : 0;
      const note = String((body && body.note) || "").slice(0, 200) || null;
      const { data, error } = await sb.rpc("lfh_staff_bill_discount", { p_session: b, p_amount: amount, p_note: note });
      if (error) throw new Error(error.message);
      await log("bill_discount", { detail: `whole bill ₹${amount} (session ${b})`, device_id: dev });
      if (amount > 0) await recordRemoval({
        rid, kind: "discount_given",
        reason: { code: reasonFromBody(body).code, note: reasonFromBody(body).note || note },
        user: actor ?? null, deviceId: dev, sessionId: b, amount,
        meta: { discount: amount, from: "waiter tablet", scope: "whole bill" },
      });
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
      // Same rule as the manager panel: when the restaurant requires it, no invoice without
      // the customer's mobile + name (lib/billCustomer.ts, mig 227). Saved first, so an
      // issued invoice always carries the customer it was made out to.
      const custSaveT = await saveBillCustomer(sb, rid, b as string, body);
      if (!custSaveT.ok) return err(custSaveT.message, 400);
      // A RE-issue (only possible after a manager voided the invoice) has to say WHY — the
      // manager's own path captures it and this one hardcoded null, so the append-only invoice
      // history read "generated · reopened · generated" with the last reason blank.
      const genReasonT = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
      const { data, error } = await sb.rpc("lfh_generate_invoice", { p_session: b, p_reason: genReasonT || null, p_actor: actor?.name || actor?.username || null });
      if (error) { if (error.code === "LFH01" || /invoice locked/i.test(error.message)) return err("This bill is settled — its invoice can't be reopened.", 409); throw pgError(error); }
      await log("invoice_generate", { detail: `session ${b}`, device_id: dev });
      return ok(Array.isArray(data) ? data[0] : data);
    }

    // tables/:t/restart — clear the round off the floor but KEEP the table open:
    // every active order on the CURRENT party's session becomes served + archived
    // (a completed order kept in records/revenue — NOT cancelled). Mirrors the
    // editor's restartTable, done as one scoped bulk update. (owner, 2026-06-17)
    if (a === "tables" && c === "restart") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // A merged child's party lives on its parent — act on the whole party (lib/tableMerge).
      const t = await mergeParentTable(sb, rid, tRaw);
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
      // restart and close paths can't drift apart.
      await clearTableSignals(rid, t);
      // ...and CLOSE the party. It used to stay open with no orders and no guests — invisible to
      // every screen (the floor draws it Free) but "open" in the database, which is the mismatch
      // the owner caught on table 30 (2026-08-01). One truth: the round ends, the table is free.
      if (openSess) must(await sb.from("sessions").update({ status: "closed", closed_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }).eq("id", openSess.id).select());
      await log("table_restart", { table_number: t, detail: `${rows.length} ${rows.length === 1 ? "order" : "orders"} cleared${owed > 0 ? `, ≈₹${Math.round(owed)} was unpaid` : ""}`, device_id: dev });
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
      // LOGGED, like the manager's twin (twin-parity pass, 2026-08-07). Moving a whole party — its
      // session, its orders, its calls and its bill — is one of the largest things anyone does to a
      // floor, and from the tablet it left no row at all, so "who moved table 6 to 12?" had no answer.
      await log("table_shift", { table_number: to, detail: `party moved to T${to}`, device_id: dev });
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
      // WHO joined them (mig 308) — the same names this panel's log() uses, so the merge record and
      // the Activity row agree about who was standing there. A PIN-approved action names the MANAGER
      // who approved it, exactly as log() does, because that is the whole point of the PIN pill.
      // `pinAuth` is assigned inside recordPin(), a closure — so TypeScript's control-flow analysis
      // still believes it is the `null` it was initialised to and narrows it to `never` here. Read
      // it through its declared type; log() dodges the same thing by only touching it inside its own
      // closure. Runtime behaviour is unchanged either way.
      const pin = pinAuth as { actor: string; actor_id: string | null } | null;
      const mergeActor = pin?.actor || actor?.name || actor?.username || "waiter";
      const mergeActorId = pin?.actor_id || actor?.id || null;
      const { data: mg, error: mgErr } = await sb.rpc("lfh_staff_merge_tables", {
        p_session: b, p_to: to, p_rid: rid, p_actor: mergeActor, p_actor_id: mergeActorId,
      });
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
      // A TAP THAT MOVED NOTHING MUST NOT REPORT SUCCESS (sweep 2026-08-05). The update is scoped by
      // rid, so it matches no row when the dish is gone — a stale tile, a KOT the manager just
      // cancelled, a dish deleted a second earlier. This fell through to `ok({ ok: true })`: the
      // waiter watched the dish go green, nothing moved, and the kitchen never heard about it.
      // The kitchen and manager twins of this exact endpoint were both fixed on 2026-08-04
      // (kitchen route ~l.315, editor route ~l.3261) and the waiter tablet — the panel standing at
      // a stale tile most often — was the one left behind. Same answer, same words.
      if (!item) return err("That dish isn't on this restaurant's board any more — refresh and try again.", 404);
      if (item.order_id) {
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
      const cur = must(await sb.from("orders").select("items,status").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!cur) return err("That order isn't there anymore — refresh.", 404);
      // A VOIDED TICKET MAY NOT BE SERVED BACK TO LIFE (sweep 2026-08-04). This panel's client
      // already filters cancelled orders out of its Serve-all fan-out, but hiding is never the only
      // guard — the endpoint has to refuse too, or an offline replay / a future caller can still
      // write status='served' onto a cancelled order and quietly put its money back on the bill
      // with no audit row. Same refusal as the manager route.
      if (cur.status === "cancelled") return err("That ticket was voided — restore it first if it should be served.", 409);
      const items = Array.isArray(cur.items) ? cur.items.map((i: any) => ({ ...i, status: "served" })) : [];
      must(await sb.from("orders").update({ items, status: "served" }).eq("id", b).eq("restaurant_id", rid));
      await sb.from("order_items").update({ status: "served", served_at: nowIso() }).eq("order_id", b).eq("restaurant_id", rid).neq("status", "served");
      await log("order_serve", { order_id: b, device_id: dev });
      // A READ THAT WAS THROWN AWAY, DELETED (T4 sweep, 2026-08-11). This used to re-select
      // session_id into a `served` variable nothing ever looked at. Its comment said "for
      // auto-settle" — and auto-settle was deleted on 2026-08-02 (see the note by offerPayUndo in
      // public/panels/tablet/app.js), so the query outlived its only reader. It cost a round trip on
      // every Serve-all, and the table-wide button fans one of those out PER ORDER. eslint had been
      // reporting it as an unused variable the whole time; a warning is easy not to read.
      return ok({ ok: true });
    }

    // orders/:id/allergies — staff edit of the order-wide "avoid" list (add a
    // missed allergen / fix a wrong one). Mirrors the editor endpoint exactly.
    // (owner, 2026-06-16)
    if (a === "orders" && c === "allergies") {
      const raw = Array.isArray(body?.allergies) ? body.allergies : [];
      const allergies = [...new Set(raw.map((x: any) => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      // THIS USED TO BE A WEAKER TWIN OF THE MANAGER'S IDENTICAL ENDPOINT (sweep 2026-08-05).
      // It wrote the column and nothing else, so the SAME change did less when a WAITER made it
      // than when a manager did — and the waiter is the one standing at the table hearing about
      // the allergy. Three things were missing, all of them things the kitchen reads:
      //   · no existence check → an order that had just been voided or moved answered ok:true and
      //     the avoid-list went nowhere ("a tap must never vanish in silence");
      //   · no `edited_at` → no persistent "✎ Edited" badge on the ticket, though every other
      //     edit on this panel stamps it (qty / note / removed / add-item all call stampEdited);
      //   · no per-dish ＋ / ✎− marks → the cook saw no sign which dishes changed.
      // Now identical to the manager's branch (editor route, `orders/:id/allergies`), which is the
      // whole point: one action, one behaviour, whichever panel it came from.
      const prev = must(await sb.from("orders").select("allergies").eq("id", b).eq("restaurant_id", rid).maybeSingle());
      if (!prev) return err("That order isn't there anymore — refresh.", 404);
      const oldOW = new Set((Array.isArray(prev.allergies) ? prev.allergies : []).map((x: any) => String(x).toLowerCase()));
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
      await log("order_allergies", { order_id: b, detail, device_id: dev });
      return ok({ ok: true });
    }

    // items/:id/delete — remove ONE dish and reconcile the bill. Same as the
    // editor: the lfh_delete_order_item RPC re-prices the order and refuses a
    // PAID bill (orders.total is a stored, server-priced number).
    if (a === "items" && c === "delete") {
      // Confirm the dish belongs to THIS restaurant before the RPC (which looks it up by id
      // alone) — the manager's twin of this endpoint has always done so and this one did not
      // (2026-08-02). Reading it here also captures what it WAS, for the Audit row below.
      const gone = (await sb.from("order_items").select("id, title, qty, unit_price, order_id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data as
        { id: string; title: string | null; qty: number | null; unit_price: number | null; order_id: string | null } | null;
      if (!gone) return err("That dish was already removed.", 404);
      const { data, error } = await sb.rpc("lfh_delete_order_item", { p_item_id: b });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) {
        const reason = data.reason || "could not delete";
        const msg = reason === "order_paid" ? "Won't change a PAID bill — mark it unpaid first."
          : reason === "item_not_found" ? "That dish was already removed." : reason;
        return err(msg, reason === "order_paid" ? 409 : 400);
      }
      await log("order_item_delete", { order_id: data?.order_id, detail: data?.order_cancelled ? "order emptied → cancelled" : `dish removed, ${data?.items_left} left`, device_id: dev });
      // The waiter panel recorded NOTHING in the Audit for anything until 2026-08-02 — a dish
      // could come off a bill from the tablet with no record of who or why. Same row the manager
      // writes, from the same shared recorder.
      await recordRemoval({
        rid, kind: "dish_removed", reason: reasonFromBody(body), user: actor ?? null, deviceId: dev,
        orderId: data?.order_id ?? gone.order_id, itemId: gone.id, itemTitle: gone.title, qty: gone.qty,
        amount: (Number(gone.unit_price) || 0) * (Number(gone.qty) || 1),
        meta: { items_left: data?.items_left ?? null, order_cancelled: !!data?.order_cancelled, from: "waiter tablet" },
      });
      // "✎ Edited" must appear whichever panel took the dish off (twin-parity pass, 2026-08-07). The
      // manager's identical endpoint stamps this; the waiter's did not, so the SAME removal marked the
      // ticket as edited when a manager did it and left it looking untouched when a waiter did — and
      // the kitchen reads that badge to know a ticket changed after it was rung.
      await stampEdited(data?.order_id ?? gone.order_id, rid);
      return ok(data);
    }

    // items/:id/qty — STAFF EDIT: change ONE dish's quantity on a PLACED order.
    // Money-safe via the RPC (clamps 1..99, re-prices the bill). Mirrors the editor.
    if (a === "items" && c === "qty") {
      const qty = Math.round(Number(body?.qty));
      if (!Number.isFinite(qty) || qty < 1) return err("invalid quantity");
      // What it WAS, read before the RPC re-prices it — the Audit row says 2 → 1, not just "1".
      // (Same shape as the manager's twin; this side recorded nothing until 2026-08-03, so a
      //  waiter halving a quantity took money off a bill and left no trace in the Audit.)
      const wasRow = (await sb.from("order_items").select("id, title, qty, unit_price").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data as
        { id: string; title: string | null; qty: number | null; unit_price: number | null } | null;
      if (!wasRow) return err("That dish was already removed.", 404);
      const { data, error } = await sb.rpc("lfh_staff_edit_item_qty", { p_item: b, p_qty: qty });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("order_item_qty", { order_id: data?.order_id, detail: `qty → ${data?.qty}`, device_id: dev });
      // Lowering takes money off the bill; raising adds money and is not a removal.
      const wasQty = Number(wasRow.qty) || 0;
      if (qty < wasQty) await recordRemoval({
        rid, kind: "qty_reduced", reason: reasonFromBody(body), user: actor ?? null, deviceId: dev,
        orderId: data?.order_id ?? null, itemId: wasRow.id, itemTitle: wasRow.title, qty: wasQty - qty,
        amount: (Number(wasRow.unit_price) || 0) * (wasQty - qty),
        meta: { qty_before: wasQty, qty_after: qty, from: "waiter tablet" },
      });
      await stampEdited(data?.order_id, rid);
      return ok(data);
    }

    // items/:id/note — STAFF EDIT: change ONE dish's note on a PLACED order.
    if (a === "items" && c === "note") {
      // lfh_staff_edit_item_note(p_item, p_note) finds the row by id ALONE — it takes no
      // restaurant argument — so without this read the dish that gets edited is decided by the
      // id in the URL rather than by which restaurant the request belongs to. Every sibling on
      // this endpoint family already does it (status/removed are .eq-scoped; delete and qty
      // pre-read the row); note was the one left behind. See the note on items/:id/removed.
      const ownNote = (await sb.from("order_items").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data;
      if (!ownNote) return err(editErrMsg("item_not_found"), 404);
      const { data, error } = await sb.rpc("lfh_staff_edit_item_note", { p_item: b, p_note: String(body?.note ?? "") });
      if (error) throw new Error(error.message);
      if (data && data.ok === false) return err(editErrMsg(data.reason), data.reason === "order_paid" ? 409 : 400);
      await log("order_item_note", { order_id: data?.order_id, device_id: dev });
      // EDITING AFTER THE BILL IS ALLOWED, AND RECORDED (owner, 2026-08-13) — the SAME rule the
      // manager's identical endpoint got that day. It was added there and not here, so for one day a
      // waiter could annotate an already-SETTLED bill and leave no record while a manager doing the
      // exact same thing left one. Two panels, one action, two different truths in the Audit — which
      // is the whole reason verify:twins exists. (Found 2026-08-13 by the T10 sweep, the first run
      // after verify:twins was wired into verify:static; it had been running nowhere at all.)
      //
      // Risk level `record`, never `money`: mig 312 patches just this line's note and touches no
      // total, tax or discount (auditsort.js KIND_RISK / SQL lfh_audit_risk).
      if (data?.settled) {
        await recordRemoval({
          rid, kind: "bill_annotated", user: g.user, deviceId: dev,
          orderId: data?.order_id, itemId: b,
          reason: reasonFromBody(body),
          meta: { field: "note", note_now: data?.note ?? null },
        });
      }
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
      // lfh_staff_add_item_to_order(p_order, p_items) resolves the order by id ALONE — no
      // restaurant argument — so confirm the order is THIS restaurant's before adding a dish to
      // it. Without this the bill a dish lands on is decided by the id in the URL. (The `parent`
      // read below is already rid-scoped, but it runs AFTER the dish has been added.)
      const ownAdd = (await sb.from("orders").select("id").eq("id", b).eq("restaurant_id", rid).maybeSingle()).data;
      if (!ownAdd) return err(editErrMsg("order_not_found"), 404);
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
      const cur = must(await sb.from("orders").select("payment_status, total, session_id, table_number").eq("id", b).eq("restaurant_id", rid).single());
      if (cur && cur.payment_status === "paid") return err("Won't delete a PAID order — mark it unpaid first.", 409);
      const reason = String(body?.reason ?? "").trim();
      const who = actor?.name || actor?.username || "staff";
      await softDeleteOrders(rid, [b], { actor: who, actorId: actor?.id ?? null, reason });
      await log("order_delete", { order_id: b, device_id: dev, detail: reason || undefined });
      // Taking a bill out of the reports is the biggest removal there is — recorded here, from the
      // tablet, exactly as the manager's twin records it (2026-08-03).
      await recordRemoval({
        rid, kind: "order_deleted", reason: reasonFromBody(body), user: actor ?? null, deviceId: dev,
        orderId: b, sessionId: cur?.session_id ?? null,
        tableNumber: cur?.table_number != null ? String(cur.table_number) : null,
        amount: Number(cur?.total) || 0, meta: { from: "waiter tablet" },
      });
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

    // tables/:t/pay-split — the same bill, collected in PARTS: ₹200 UPI + ₹200 cash + …
    // (owner, 2026-08-02, "Other → Split the payment"). Same permission as a plain settle —
    // it IS a settle, so splitting must never become a way round tablet_mark_paid. The
    // arithmetic and the write are lib/paySplit.ts, shared with the manager panel: the server
    // recomputes the due itself and refuses parts that don't add up.
    if (a === "tables" && c === "pay-split") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // A merged child's bill lives on its parent — split the PARTY's bill (lib/tableMerge).
      const t = await mergeParentTable(sb, rid, tRaw);
      const gs = recordPin(await tabletPerm("tablet_mark_paid", req, body, rid, actor)); if (!gs.allow) return gs.resp;
      const rSp = await settleBillInParts(sb, { rid, table: t, splits: Array.isArray(body?.splits) ? body.splits : [] });
      if (!rSp.ok) return err(rSp.message, rSp.status);
      await log("bill_split", { table_number: t, detail: rSp.note.slice(0, 120), device_id: dev });
      return ok({ ok: true, count: rSp.count, due: rSp.due });
    }

    // tables/:t/pay — settle the WHOLE bill: mark every unpaid, non-cancelled
    // order for the table as paid. The waiter confirms on-screen that the money
    // was actually collected before this fires.
    if (a === "tables" && c === "pay") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // A merged child's bill lives on its parent — settle the PARTY's bill, never half of it
      // (found live 2026-08-03: paying at the child covered ₹662 of a ₹1,323 joint bill).
      const t = await mergeParentTable(sb, rid, tRaw);
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
        // ONE MONEY PATH (2026-08-04). This branch used to carry a full SECOND implementation of
        // the split arithmetic — its own validation, its own order read, its own aggregate
        // rounding, its own ±0.02 gate, its own session_payments insert — sitting a couple of
        // hundred lines from the dedicated tables/:t/pay-split handler that already called the
        // shared lib/paySplit.ts. Whose own header says why: "a money path that exists twice is a
        // money path that drifts." It had already drifted — neither copy accounted for the MRP /
        // tax-inclusive columns (migs 270/272), and only the shared one has now been taught to.
        //
        // The stricter permission is KEPT: the extra tablet_table_ops gate below is what this
        // route always required on top of tablet_mark_paid (already checked above), so delegating
        // does not loosen anything.
        if (actor && !(await tableOpsTabletAllowed(rid))) return err("Table & KOT operations aren't enabled for the tablet here.", 403); // actor null = admin (X-ray)
        const gs = recordPin(await tabletPerm("tablet_table_ops", req, body, rid, actor)); if (!gs.allow) return gs.resp;
        const shape = badSplitShape(splits);
        if (shape) return err(shape, 400);
        const rSp = await settleBillInParts(sb, { rid, table: t, splits });
        if (!rSp.ok) return err(rSp.message, rSp.status);
        await log("bill_split", { table_number: t, detail: rSp.note.slice(0, 120), device_id: dev });
        invalidateFloor(rid);
        return ok({ ok: true, count: rSp.count, due: rSp.due });
      } else if (body && body.payment_method !== undefined) {
        if (!PAYMENT_METHODS.includes(body.payment_method)) return err("invalid payment_method");
        payUpdate.payment_method = body.payment_method;
        payUpdate.payment_note = String(body.payment_note || "").slice(0, 200) || null;
      }
      let q = sb.from("orders").update(payUpdate)
        .neq("status", "cancelled").neq("status", "received").neq("payment_status", "paid").eq("restaurant_id", rid);
      q = openSess ? q.eq("session_id", openSess.id) : q.eq("table_number", t).eq("archived", false);
      const rows = must(await q.select());
      // A SETTLE THAT SETTLED NOTHING IS NOT A SETTLE (T17 sweep, 2026-08-13, finding F2).
      //
      // The update is filtered `.neq("payment_status","paid")`, so when someone else settled this
      // bill a moment ago it matches NO row — and this used to answer `{ok:true, count:0}`. The
      // tablet does not read `count`: it toasts "Bill paid via cash" and offers the undo bar on any
      // 200 (public/panels/tablet/app.js, optimisticPay + payBill). So on a floor where a waiter and
      // the manager both reach for the bill — or two waiters on one party — the second person is
      // told the money is in, and the method THEY collected in is never recorded against it. Cash
      // taken while the first booked UPI leaves the day's payment-method breakdown wrong with nobody
      // aware, which is exactly the kind of quiet money mismatch this panel refuses everywhere else.
      //
      // Every sibling on this route already refuses it out loud — khata (nothing unpaid to park),
      // on-the-house (nothing to settle), unpay (nothing inside the grace window) — and so does the
      // MANAGER's own bulk settle, `khata/pay`, with "Nothing outstanding on that bill." This branch
      // was the last one still reporting success for a no-op. 409, because the request was
      // well-formed and it is the bill's state that says no (the panels already treat 409 as
      // "a person must read this", and the outbox never silently retries it).
      if (!rows.length) {
        return err("Nothing to settle on this bill — someone may have just settled it. Refresh to see where it stands.", 409);
      }
      await log(splits ? "bill_split" : "bill_paid", { table_number: t, device_id: dev, detail: splits ? String(payUpdate.payment_note || "").slice(0, 120) : (body?.payment_method ? `via ${body.payment_method}` : undefined) });
      return ok({ ok: true, count: rows.length });
    }

    // tables/:t/customer-capture — save the guest's name+number at bill time, with
    // consent (Customer CRM, mig 212). DPDP: the RPC stores NOTHING without consent.
    // Records one visit for this table's session (idempotent), links the guests'
    // devices, and bumps the returning-customer count. Gated by the restaurant's
    // "customers" entitlement (default on). Fire-and-forget from the pay sheet — a
    // failure here NEVER blocks the settle that already happened.
    if (a === "tables" && c === "customer-capture") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // The bill (and its visit) belongs to the party's session — resolve a merged child first.
      const t = await mergeParentTable(sb, rid, tRaw);
      const ent = await getOwnerEntitlements(rid);
      if (!ent.customers) return err("The customer directory isn't enabled for this restaurant.", 403);
      const phone = String(body?.phone || "").slice(0, 20);
      const name = String(body?.name || "").slice(0, 80);
      const consent = body?.consent === true;
      // The party being billed, taken from the table's OPEN session (never "the latest party
      // ever seated here" — that booked the visit onto the NEXT party, mig 233).
      const capSess = (await sb.from("sessions").select("id").eq("restaurant_id", rid)
        .eq("table_number", t).eq("status", "open").order("last_activity_at", { ascending: false })
        .limit(1)).data?.[0] as { id: string } | undefined;
      const { data, error } = await sb.rpc("lfh_capture_customer", {
        p_restaurant_id: rid, p_table: t, p_phone: phone, p_name: name, p_consent: consent,
        p_session: capSess?.id ?? null,
      });
      // NEVER HAND A DATABASE MESSAGE TO A WAITER (T17 sweep, 2026-08-13, finding F10). This sent
      // `error.message` straight into the toast on the payment sheet — the same fault /api/maintenance
      // was fixed for on 2026-08-05, and the only two places left on this route (the other is the
      // khata person insert below). The detail stays in our log where it is useful.
      if (error) {
        console.error("[tablet] customer-capture failed:", error.message);
        return err("Couldn't save the guest's details — the bill itself is fine. Try again in a moment.", 500);
      }
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
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // The comp settles the PARTY's bill — resolve a merged child to the table holding it.
      const t = await mergeParentTable(sb, rid, tRaw);
      if (actor && !(await tableTagsLadder(rid)).effective) return err("Table types aren't enabled for this restaurant.", 403);
      const hg = recordPin(await tabletPerm("tablet_mark_paid", req, body, rid, actor)); if (!hg.allow) return hg.resp;
      // The mark may sit on ANY member of a merged party (same rule as the manager route).
      const partyKids = ((await sb.from("table_merges").select("child_table")
        .eq("restaurant_id", rid).eq("parent_table", t).is("ended_at", null).limit(20)).data || []) as { child_table: string }[];
      const tagRows = ((await sb.from("table_tags").select("tag")
        .eq("restaurant_id", rid).in("table_number", [t, ...partyKids.map((k) => k.child_table)])).data || []) as { tag?: TableTag }[];
      const tagRow = tagRows.find((r) => r.tag && COMP_TAGS.includes(r.tag)) || null;
      if (!tagRow) return err("On the house is only for tables marked Family or Owner's Guest.", 409);
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
      await log("on_the_house", { table_number: t, device_id: dev, detail: `${unpaid.length} ${unpaid.length === 1 ? "order" : "orders"} · ${tagRow.tag}` });
      // Settling with no money collected is the largest money-lowering action there is — one Audit
      // row per order, from the tablet too (2026-08-03; only the manager's twin recorded it).
      for (const o of unpaid) {
        await recordRemoval({
          rid, kind: "on_the_house",
          reason: { code: reasonFromBody(body).code, note: reasonFromBody(body).note || `On the house · ${tagRow.tag}` },
          user: actor ?? null, deviceId: dev, orderId: o.id, tableNumber: t, amount: Number(o.subtotal) || 0,
          meta: { table_tag: tagRow.tag, orders_on_bill: unpaid.length, from: "waiter tablet" },
        });
      }
      return ok({ ok: true, count: unpaid.length });
    }

    // tables/:t/khata — "Collect later": park the unpaid bill on a person and free the
    // table (same flow as the manager's; see the editor route). Gated by the manager's
    // tablet_khata tri-state. body { customer_id } OR { name, phone?, note? }.
    if (a === "tables" && c === "khata") {
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // Parking "collect later" parks the PARTY's bill — resolve a merged child first.
      const t = await mergeParentTable(sb, rid, tRaw);
      if (actor && !(await khataLadder(rid)).effective) return err("Pay later (khata) isn't enabled for this restaurant.", 403);
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
          // Same rule as customer-capture above (T17, finding F10): the waiter reads a sentence,
          // never Postgres. Detail to our log.
          if (ins.error) {
            console.error("[tablet] khata customer insert failed:", ins.error.message);
            return err("Couldn't add that person to the khata book — try again in a moment.", 500);
          }
          customer = (ins.data as any[])[0];
        }
      }
      const stamp = nowIso();
      must(await sb.from("orders").update({ khata_at: stamp, khata_customer_id: customer!.id, archived: true, archived_at: stamp })
        .in("id", kunpaid.map((o) => o.id)).eq("restaurant_id", rid).select("id"));
      if (openSess) {
        const closed = await closeSession(openSess.id, { force: true }, { panel: "tablet", deviceId: dev, restaurantId: rid, user: actor ?? null, reason: reasonFromBody(body) });
        if (!closed.ok) return err(closed.message, closed.status);
      } else {
        await clearTableSignals(rid, t);
      }
      await log("khata_park", { table_number: t, device_id: dev, detail: `${kunpaid.length} ${kunpaid.length === 1 ? "order" : "orders"} → ${customer!.name}` });
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
      const tRaw = String(b || "").trim();
      if (!/^\d+$/.test(tRaw)) return err("valid table required");
      // Reopening the bill reopens the PARTY's bill — resolve a merged child first.
      const t = await mergeParentTable(sb, rid, tRaw);
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
      // A split settle recorded payment LEGS in session_payments. They are REVERSED, not deleted
      // (mig 285): this used to be a hard DELETE, which erased the only record of what had been
      // collected and in what parts — while the manager panel's twin left the legs standing and
      // went on claiming the money was in. One shared helper now, so both read the same.
      // The return value is not read — reverseSplitLegs does the writing. (Named nothing rather
      // than a variable eslint has to warn about; T4 sweep, 2026-08-11.)
      await reverseSplitLegs(sb, {
        rid, sessionId: openSess.id, since: cutoff,
        actor: actor?.name || actor?.username || null,
        reason: String((body && body.reason) || "undo settle (within the 30-minute window)").slice(0, 200),
      });
      // The quick undo bar sends no reason; the explicit "Mark unpaid" button sends one
      // (a refund/correction) — record it for the money-accountability trail either way.
      const reason = String((body && body.reason) || "").trim().slice(0, 120);
      await log("payment_revert", { table_number: t, device_id: dev, detail: reason ? `unpaid: ${reason}` : "undo settle (within grace)" });
      // Un-booking collected money belongs in the Audit, not only in the activity log — the same
      // question ("who took money off this bill, and why?") whichever panel did it. One row per
      // order, so the trail matches the manager's twin. (2026-08-03)
      for (const o of paid) {
        await recordRemoval({
          rid, kind: "payment_reverted",
          reason: { code: reasonFromBody(body).code, note: reason || "undo settle (within the 30-minute window)" },
          user: actor ?? null, deviceId: dev, orderId: o.id, sessionId: openSess.id, tableNumber: t,
          meta: { was_method: o.payment_method ?? null, orders_reverted: paid.length, from: "waiter tablet" },
        });
      }
      // Reversing the settle reverses the visit it counted (Customer CRM, mig 212) — for THIS
      // party. Passing the session is what stops it deleting the visit of whoever is seated at
      // the table by then (mig 233).
      await sb.rpc("lfh_uncapture_customer", { p_restaurant_id: rid, p_table: t, p_session: openSess.id });
      return ok({ ok: true, count: paid.length });
    }

    // sessions/:id/close — free the table (end the dining session). Uses the SHARED
    // closeSession so the rule is identical to the manager's. On the tablet the
    // "close anyway" override (force) for an unpaid/cooking table needs a manager PIN.
    if (a === "sessions" && c === "close") {
      const force = !!(body && body.force === true);
      if (force) { const g = recordPin(await closeUnpaidGate(req, body, rid, actor)); if (!g.allow) return g.resp; } // override → admin-laddered (default: manager PIN)
      const result = await closeSession(b, { force }, { panel: "tablet", deviceId: dev, restaurantId: rid, user: actor ?? null, reason: reasonFromBody(body) });
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
      // openTableSession tolerates the concurrent-open race: two devices tapping Open on the
      // same table used to make the SECOND one crash on the unique index
      // (idx_one_open_session_per_table). Opening is idempotent — the loser now just gets the
      // session that won. (2026-07-30)
      const row = await openTableSession(rid, t);
      await log("table_open", { table_number: t, device_id: dev });
      return ok(row);
    }

    return err("unknown POST endpoint", 404);
  } catch (e) {
    // Known, user-actionable failures already returned via err(...) with a friendly message +
    // proper status ABOVE. Anything reaching here is an UNEXPECTED throw (e.g. a raw PostgREST
    // error from a since-deleted row) — don't leak the internal message to the waiter's toast;
    // log it server-side and return a generic 500. (NB2)
    console.error("[tablet POST]", e instanceof Error ? e.message : e);
    if (worthLogging(e)) logError("tablet", "route_error", e, { restaurant_id: rid, detail: `POST ${path.join("/") || "/"}` });
    // The generic sentence stays for anything we can't classify (NB2 above). A database that
    // didn't answer, or a value it refused, now says so instead — see lib/panelFailure.ts.
    return panelFailure(e, { unknown: "Something went wrong — try again." });
  }
}
