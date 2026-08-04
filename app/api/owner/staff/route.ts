// /api/owner/staff — staff management scoped to the restaurants the caller owns.
//
// WHO can call (resolved by `scope()` below):
//   • ADMIN super-user (AUTH_COOKIE)  → every restaurant.
//   • OWNER (role=owner)              → every restaurant they're a member of in
//                                       restaurant_owners (migration 097).
//   • MANAGER (role=manager)          → ONLY their own restaurant, and ONLY if the
//     owner enabled manager_permissions.manage_staff for it (else 403).
//
//   GET    → { restaurants:[{id,name,slug,accentColor,managerPermissions}], staff:[…] }
//   POST   → create {name, role(manager|kitchen|tablet), restaurant_id, password?}
//            (password returned ONCE; stored hashed). Owners can't mint other owners.
//   PATCH  → {id, action}: reset_password | set_active | set_role | edit  (staff must be in scope)
//   DELETE → ?id=<uuid>  (staff must be in scope)
//
// Every staff row is created/looked-up WITH its restaurant_id, so one restaurant's
// manager can never see or touch another restaurant's people.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie, hashSecret, normalizeLoginName, type Role } from "@/lib/userAuth";
import { logAction } from "@/lib/oplog";
import { mergeOwnerEntitlements, MANAGER_POWER_FLAGS, powerEntitled } from "@/lib/ownerEntitlements";
import { managerSettingsOff } from "@/lib/accessTree";
import { enabledOwnedRestaurantIds, OwnedLookupFailed } from "@/lib/panelAccess";
import { banquetLadder, tableTagsLadder, khataLadder, tableOpsLadder, takeOrdersLadder, parcelLadder } from "@/lib/tableTags";
import { TABLET_PERM_KEYS } from "@/lib/accessModel";
import { newWaiterTables } from "@/lib/tableAssign";
import { viewAsPerson, isPersonId } from "@/lib/viewAsPerson";
import {
  PROFILE_FIELDS, hasProfile, completeness, mergeProfilePatch, jobPatchFrom, paymentFrom,
  payAccessWith, todayIST, type PayAccess,
} from "@/lib/staffProfile";

// GAP-B (owner ceiling): a tablet cap gated by an admin module may only be granted to a
// waiter if that module is EFFECTIVE for the restaurant. The money caps (discount/mark_paid/
// invoice) have no module gate. Keys with no entry here = ungated. Used for the OWNER actor
// only; the admin super-user is unrestricted.
const CAP_MODULE_GATE: Record<string, (rid: string) => Promise<{ effective: boolean }>> = {
  tablet_banquet: banquetLadder,
  tablet_table_tags: tableTagsLadder,
  tablet_khata: khataLadder,
  tablet_table_ops: tableOpsLadder,
  tablet_take_orders: takeOrdersLadder,
  tablet_parcel: parcelLadder,
};

import { withIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

// Roles an owner/manager may CREATE (never 'owner' — only the admin assigns owners).
const ASSIGNABLE: Role[] = ["manager", "kitchen", "tablet"];
// HIERARCHY RULE (owner, 2026-07-03 — "a lower role must NEVER control its own level
// or above"): what each actor may see/create/edit/delete here. A MANAGER manages only
// kitchen + tablet — never other managers (peer level) and never owners. This is the
// server truth; the panels' UIs merely reflect it.
const assignableFor = (actor: "admin" | "owner" | "manager"): Role[] =>
  actor === "manager" ? ["kitchen", "tablet"] : ASSIGNABLE;
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// Count REAL characters (Unicode letters/digits), not UTF-16 code units — a single
// emoji is one glyph but two code units, so the old `key.length < 2` let one emoji
// pass as a login name. Require at least this many alphanumerics to be a valid name.
const realCharCount = (s: string) => (String(s).match(/[\p{L}\p{N}]/gu) || []).length;

function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

type Restaurant = { id: string; name: string; slug: string; accent_color: string | null; manager_permissions: Record<string, boolean>; owner_entitlements: Record<string, boolean> | null; owner_user_id: string | null };
type Scope =
  // viewAs: an ADMIN tab that asked to be answered as the real manager (?view=real) or as ONE
  // NAMED MANAGER (?as=<id>) — see managerViewPin below. It changes only what is SHOWN
  // (shownActor); every write still runs and is logged as the admin, exactly as the pin's
  // contract in lib/viewAsPerson promises.
  | { ok: true; actor: "admin" | "owner" | "manager"; actorId: string | null; restaurants: Restaurant[]; viewAs?: "manager" | null }
  | { ok: false; resp: NextResponse };

// ONE answer for "we could not read your setup" — deliberately different from both
// "the feature is off" (403 + disabled) and "that isn't yours" (403). 503 tells the client to
// retry and the panel shows a normal try-again, never a false configuration message.
const transient = () => NextResponse.json(
  { error: "Couldn't load your team just now — please try again.", transient: true }, { status: 503 });

// SEEING THIS SCREEN AS THE MANAGER DOES (owner, 2026-08-04).
//
// An admin tab pinned to ONE restaurant may ask to be answered as the real manager
// (?view=real, 2026-07-28) or as ONE NAMED MANAGER (?as=<staff id>, the profile's "Visit
// their panel", 2026-08-02). whoami has honoured both pins since they shipped — this route
// did not, and the manager panel's Users card reads THIS route for who it thinks is looking.
// So a tab whose whole promise is "this is what they see" listed other managers and reported
// actor:"admin", which is how the owner came to see manager-creating and Remove controls
// inside a manager's panel. A pin can only ever NARROW what is shown.
async function managerViewPin(req: NextRequest, rid: string): Promise<"manager" | null> {
  const sp = req.nextUrl?.searchParams;
  const as = sp?.get("as");
  // A person pin is re-checked in full (admin cookie, active, same restaurant, role manager);
  // anything doubtful just means "no person", which is not the same as "no manager view".
  const person = isPersonId(as) ? await viewAsPerson(req, rid, { user: null }, "manager") : null;
  // EXACTLY the shape whoami uses (`!!person || view === "real"`), and it has to stay that way.
  // "Visit their panel" always sends BOTH pins, so if the person goes stale — deleted, disabled,
  // moved restaurant — a person-only test would hand this route back to the admin while whoami
  // still answered as the manager: one screen, two different ideas of who is looking. The tab
  // asked for the real view, so it gets the real view.
  return (person || sp?.get("view") === "real") ? "manager" : null;
}

// Who this answer should be SHAPED for: the pinned role when a manager view was asked for,
// else the real caller. Never used to decide whether a WRITE is allowed — that stays s.actor.
const shownActor = (s: { actor: "admin" | "owner" | "manager"; viewAs?: "manager" | null }) => s.viewAs || s.actor;

// Resolve which restaurants this caller may manage staff for (see header).
async function scope(req: NextRequest): Promise<Scope> {
  // owner_entitlements rides along for the mig-133 ladder checks below.
  const cols = "id, name, slug, accent_color, manager_permissions, owner_entitlements, owner_user_id";
  // Prefer a logged-in OWNER/MANAGER over a stray admin cookie in the SAME browser —
  // this mirrors lib/ownerScope + app/owner/layout (owner cookie → owner chrome). Before,
  // this checked the admin cookie FIRST, so a browser holding BOTH cookies rendered owner
  // chrome but listed EVERY restaurant's staff (inconsistent scoping, found 2026-07-06).
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (u?.role === "owner") {
    // Multi-owner (migration 097): the restaurants an owner may staff are EVERY
    // restaurant they're a member of in restaurant_owners — not just the one where
    // they're the primary owner. Resolve the ids first, then fetch those rows.
    // Mig 133: a restaurant whose "staff" section the admin removed drops out here,
    // so the section dies server-side too, not just in the nav.
    // Only LIVE restaurants whose owner panel the admin still allows (audit 2026-07-07) —
    // a binned or owner-panel-disabled restaurant drops out here, matching lib/ownerScope.
    let ownedIds: string[];
    try { ownedIds = await enabledOwnedRestaurantIds(u.id); }
    catch (e) {
      // OwnedLookupFailed = we couldn't tell what they own. Saying "no restaurants are assigned
      // to you yet" there would be a lie; ask them to retry instead.
      if (e instanceof OwnedLookupFailed) return { ok: false, resp: transient() };
      throw e;
    }
    if (!ownedIds.length) return { ok: true, actor: "owner", actorId: u.id, restaurants: [] };
    // A pinned context — e.g. the manager panel viewing ONE restaurant via ?rid= — narrows
    // to just that restaurant (if the owner actually owns it), so a multi-restaurant owner
    // sees/adds staff for the restaurant they're looking at, not a mixed list. The owner
    // panel sends no pin (or scope=all) and keeps the full set. (Mirrors the admin branch.)
    const osp = req.nextUrl?.searchParams;
    const opin = osp?.get("scope") || osp?.get("rid");
    const scopeIds = (opin && opin !== "all" && ownedIds.includes(opin)) ? [opin] : ownedIds;
    const { data, error } = await sb.from("restaurants").select(cols).in("id", scopeIds).order("name");
    // A failed READ is not a switched-off feature. Before this, `data` came back null on any DB
    // blip, `rows` was empty, and the owner was told "Staff management isn't enabled for your
    // restaurant — contact Aevidine" — a lie about their setup that would send them to support.
    // (Root-caused from two unexplained 403s in the 2026-07-31 sweep.)
    if (error) return { ok: false, resp: transient() };
    const rows = ((data || []) as Restaurant[]).filter((r) => mergeOwnerEntitlements(r.owner_entitlements).staff !== false);
    if (!rows.length)
      // `disabled` = a legitimate "not turned on" state → the page shows a calm info card,
      // not the scary red "Something went wrong" error (audit 2026-07-07).
      return { ok: false, resp: NextResponse.json({ error: "Staff management isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 }) };
    return { ok: true, actor: "owner", actorId: u.id, restaurants: rows };
  }
  if (u?.role === "manager") {
    const { data, error } = await sb.from("restaurants").select(`${cols}, access_config`).eq("id", u.restaurant_id).limit(1);
    // …and a failed read here must not read as "your owner hasn't given you staff management".
    if (error) return { ok: false, resp: transient() };
    const r = (data || [])[0] as (Restaurant & { access_config?: unknown }) | undefined;
    // THE ONE SWITCH is the Users SECTION row (Access → Manager settings → Users), read by the
    // same helper the panel's sidebar reads. The old gate demanded a STORED
    // manager_permissions.manage_staff === true — an ABSENT key read as NO while the Access
    // screen showed the section ON, so on any restaurant never hand-fixed a manager opening
    // Settings → Users was told "your owner hasn't given you staff management" (the exact
    // absent-key bug managerGrantValue() was built to kill; manage_staff itself is RETIRED —
    // no row offers it, so the model answers it permanently on). Found in the 2026-08-02
    // "everything must be linked" sweep. The admin entitlement cap (mig 133) still applies.
    if (!r || mergeOwnerEntitlements(r.owner_entitlements).power_manage_staff === false
      || managerSettingsOff(r.access_config).includes("users"))
      return { ok: false, resp: bad("Your owner hasn't given you staff management.", 403) };
    return { ok: true, actor: "manager", actorId: u.id, restaurants: [r] };
  }
  // Admin super-user (no owner/manager session) → all restaurants, UNLESS a per-tab scope
  // pin (?scope=/?rid=) says the admin is viewing ONE restaurant (bug C1): then show only
  // that owner's set, so two admin tabs on different restaurants don't cross-list staff.
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) {
    const sp = req.nextUrl?.searchParams;
    const pin = sp?.get("scope") || sp?.get("rid");
    if (pin && pin !== "all") {
      // Resolve the pinned restaurant's OWNER via the restaurant_owners JOIN (the scoping
      // source of truth, mig 097) — prefer the primary owner_user_id when it's a member,
      // else any co-owner — then widen to every restaurant that owner owns. Keying off
      // owner_user_id alone (the old code) missed hand-attached co-ownerships and could
      // list a stale set for a reassigned restaurant (audit 2026-07-07). Mirrors lib/ownerScope.
      const [primaryQ, membersQ] = await Promise.all([
        sb.from("restaurants").select("owner_user_id").eq("id", pin).maybeSingle(),
        sb.from("restaurant_owners").select("user_id").eq("restaurant_id", pin),
      ]);
      const members = (membersQ.data || []).map((m) => m.user_id as string);
      const primary = primaryQ.data?.owner_user_id as string | null | undefined;
      const ownerId = primary && members.includes(primary) ? primary : (members[0] ?? null);
      let ids: string[] = [];
      if (ownerId) ids = ((await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId)).data || []).map((x) => x.restaurant_id as string);
      if (!ids.includes(pin)) ids.push(pin); // never lose the entered restaurant
      const { data, error } = await sb.from("restaurants").select(cols).in("id", ids).order("name");
      if (error) return { ok: false, resp: transient() };
      const rows = (data || []) as Restaurant[];
      // Answering as a manager also narrows to the ONE pinned restaurant — a manager only
      // ever has their own, so the sibling restaurants this admin owns must not be listed.
      const viewAs = await managerViewPin(req, pin);
      return { ok: true, actor: "admin", actorId: null, viewAs, restaurants: viewAs ? rows.filter((r) => r.id === pin) : rows };
    }
    const { data, error } = await sb.from("restaurants").select(cols).order("name");
    if (error) return { ok: false, resp: transient() };
    return { ok: true, actor: "admin", actorId: null, restaurants: (data || []) as Restaurant[] };
  }
  if (!u) return { ok: false, resp: bad("Not authorised — please log in.", 401) };
  return { ok: false, resp: bad("Not authorised.", 403) };
}

// ownerEntitlements rides along so the Staff & powers page can HIDE an unentitled
// power toggle from the real owner and TINT it for the admin (mig 133).
const slim = (r: Restaurant) => ({ id: r.id, name: r.name, slug: r.slug, accentColor: r.accent_color || "#e3c06f", managerPermissions: r.manager_permissions || {}, ownerEntitlements: mergeOwnerEntitlements(r.owner_entitlements) });

// ── Staff profiles & pay (mig 220) ───────────────────────────────────────────
// Columns the ROSTER needs on every person. Kept explicit (never select *) and free of the
// pay numbers, which are stripped again below for a caller who may not see money.
const PROFILE_COLS =
  "profile, joined_on, left_on, designation, employment_type, shift_label, weekly_off, " +
  "pay_type, pay_amount, pay_day, pay_mode, pay_extras, can_see_own_pay, " +
  // mig 221 — being on the PAY LIST is opt-in per person. Having a profile is not the same
  // as being paid through the app, and only pay-list members count as an expense.
  "in_payroll, payroll_added_at, payroll_added_by";

// Batch-read whether the payroll module is effective for several restaurants at once, so the
// roster costs ONE settings read instead of one ladder read per restaurant.
async function payrollByRid(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!ids.length) return out;
  const { data } = await sb.from("settings")
    .select("restaurant_id, payroll_allowed, payroll_owner_control, payroll_enabled").in("restaurant_id", ids);
  for (const r of (data || []) as any[]) {
    out[r.restaurant_id] = r.payroll_allowed === true && (r.payroll_owner_control !== true || r.payroll_enabled !== false);
  }
  return out;
}

// Strip everything about money from one person's row — used for a caller without the
// "See staff pay" power, so salary never even travels to their browser.
const withoutPay = (row: Record<string, unknown>) => {
  const out = { ...row };
  for (const k of ["pay_type", "pay_amount", "pay_day", "pay_mode", "pay_extras", "paidThisMonth", "advanceOutstanding", "lastPaidOn"]) delete out[k];
  out.payHidden = true;
  return out;
};

export async function GET(req: NextRequest) {
  const s = await scope(req); if (!s.ok) return s.resp;
  const ids = s.restaurants.map((r) => r.id);
  const sp = req.nextUrl.searchParams;

  // ── ONE person's full profile (the profile page). Loads only when opened, so the roster
  //    never carries payment histories it doesn't show. ────────────────────────────────
  const detailId = sp.get("staff");
  if (detailId) return await staffDetail(s, detailId, sp);

  let staff: any[] = [];
  if (ids.length) {
    // Hierarchy: a manager's list contains ONLY the roles they may manage (kitchen +
    // tablet) — they never even SEE other managers' or owners' accounts.
    //
    // `deleted_at IS NULL`: a login the admin put in the recycle bin must vanish from the
    // owner's team page AND the manager panel's Users section the moment it is binned. This
    // filter was missing, which is exactly what the owner hit (2026-08-02: "I have deleted
    // one user, and that user is still showing in the manager panel user option") — every
    // list that shows people must read the same rows the login door reads.
    const { data, error } = await sb.from("staff_users")
      .select(`id, username, role, name, phone, active, restaurant_id, last_seen_at, created_at, pin_hash, permissions, ${PROFILE_COLS}`)
      .in("restaurant_id", ids).in("role", assignableFor(shownActor(s))).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(2000);
    if (error) return bad("Something went wrong, please try again.", 500);
    // Never ship hashes; expose only whether a PIN exists.
    staff = (data || []).map(({ pin_hash, ...u }) => ({ ...u, hasPin: !!pin_hash }));
  }
  // Module-effective per restaurant (one batched read) so the per-user override UI can GREY
  // any waiter cap the admin hasn't enabled for the restaurant (the ceiling GAP-B refuses).
  const modsByRid: Record<string, Record<string, boolean>> = {};
  if (ids.length) {
    const { data: setRows } = await sb.from("settings")
      .select("restaurant_id, banquet_allowed, banquet_owner_control, banquet_enabled, table_tags_allowed, table_tags_owner_control, table_tags_enabled, table_ops_allowed, table_ops_owner_control, table_ops_enabled, take_orders_allowed, take_orders_owner_control, take_orders_enabled")
      .in("restaurant_id", ids);
    const eff = (r: any, a: string, c: string, e: string) => r?.[a] === true && (r?.[c] !== true || r?.[e] !== false);
    for (const r of (setRows || []) as any[]) modsByRid[r.restaurant_id] = {
      banquet: eff(r, "banquet_allowed", "banquet_owner_control", "banquet_enabled"),
      table_tags: eff(r, "table_tags_allowed", "table_tags_owner_control", "table_tags_enabled"),
      table_ops: eff(r, "table_ops_allowed", "table_ops_owner_control", "table_ops_enabled"),
      take_orders: eff(r, "take_orders_allowed", "take_orders_owner_control", "take_orders_enabled"),
      // PARCEL = the counter parcel, its own module again (parcel_*, mig 259). This is the
      // waiter cap tablet_parcel's ceiling — it must read the same columns the tablet's own
      // gate does, or a cap shows as available on a restaurant whose server refuses it.
      parcel: true,   // the parcel/platform board is PERMANENT (owner, 2026-08-03) — see the box in lib/tableTags.ts
    };
  }
  // ── Profiles & pay: the module state + this caller's rights, per restaurant ─────────
  const payrollOn = await payrollByRid(ids);
  const accessByRid: Record<string, PayAccess> = {};
  for (const r of s.restaurants) accessByRid[r.id] = payAccessWith(shownActor(s), r, payrollOn[r.id] === true);

  // Money totals per person, for the restaurants where this caller may see money. One RPC per
  // restaurant (a tiny grouped result), never one per person.
  const money: Record<string, { paid: number; advance: number; last: string | null }> = {};
  const from = todayIST().slice(0, 8) + "01";                 // 1st of this month
  const to = todayIST();
  for (const r of s.restaurants) {
    if (!accessByRid[r.id]?.canSeePay) continue;
    const { data } = await sb.rpc("lfh_staff_pay_summary", { p_restaurant: r.id, p_from: from, p_to: to });
    for (const row of (data || []) as any[]) {
      money[row.staff_id] = { paid: Number(row.paid || 0), advance: Number(row.advance_outstanding || 0), last: row.last_paid_on || null };
    }
  }

  const staffOut = staff.map((u) => {
    const acc = accessByRid[u.restaurant_id];
    // KITCHEN keeps its login row (so accounts stay manageable) but has NO profile — the
    // owner ruled that out. `profileEligible:false` is what hides the profile UI for them.
    const eligible = hasProfile(u.role) && acc?.moduleOn === true;
    const c = completeness(u);
    const m = money[u.id];
    const row: Record<string, unknown> = {
      ...u,
      profileEligible: eligible,
      completeness: eligible ? { filled: c.filled, total: c.total } : null,
      paidThisMonth: m?.paid ?? 0,
      advanceOutstanding: m?.advance ?? 0,
      lastPaidOn: m?.last ?? null,
    };
    return acc?.canSeePay ? row : withoutPay(row);
  });

  // Waiter sections: the Add form needs each restaurant's floor size to draw the table
  // picker. One tiny scoped read for the restaurants already in scope.
  const tcRows = (await sb.from("settings").select("restaurant_id, table_count").in("restaurant_id", s.restaurants.map((r) => r.id))).data || [];
  const tcByRid: Record<string, number> = Object.fromEntries(tcRows.map((t) => [t.restaurant_id as string, Number(t.table_count) || 0]));

  return ok({
    // The PANEL reads this to decide what its Users card offers, so a pinned manager view
    // must say "manager" here — that is the whole point of the pin.
    actor: shownActor(s),
    restaurants: s.restaurants.map((r) => ({
      ...slim(r), modules: { ...(modsByRid[r.id] || {}), payroll: payrollOn[r.id] === true },
      payAccess: accessByRid[r.id],
      tableCount: tcByRid[r.id] || 0,
    })),
    staff: staffOut,
  });
}

// ── One person: profile + pay history + their own performance ─────────────────
// Separate from the roster on purpose (egress): a payment list and a performance query only
// run when someone actually opens that person.
async function staffDetail(s: Extract<Scope, { ok: true }>, id: string, sp: URLSearchParams) {
  const ids = s.restaurants.map((r) => r.id);
  const { data: rows } = await sb.from("staff_users")
    .select(`id, username, role, name, phone, active, restaurant_id, last_seen_at, created_at, pin_hash, permissions, can_self_reset, can_self_set_pin, ${PROFILE_COLS}`)
    .eq("id", id).in("restaurant_id", ids).limit(1);
  const u = (rows || [])[0] as any;
  if (!u) return bad("That person isn't on your staff.", 404);
  // shownActor, not s.actor: a pinned "as this manager" tab must answer this READ the way the
  // manager is answered (they can't open a peer's or an owner's record), so the view can't show
  // a person the real panel would refuse. Writes below still run with the admin's own power.
  if (!assignableFor(shownActor(s)).includes(u.role)) return bad("You can't open accounts at or above your own level.", 403);
  const r = s.restaurants.find((x) => x.id === u.restaurant_id)!;
  const acc = await (async () => {
    const on = (await payrollByRid([u.restaurant_id]))[u.restaurant_id] === true;
    return payAccessWith(shownActor(s), r, on);
  })();
  if (!acc.moduleOn) return ok({ disabled: true, error: "Staff profiles & pay aren't enabled for this restaurant — contact Aevidine." }, 403);
  if (!hasProfile(u.role)) return ok({ notEligible: true, error: "Kitchen logins don't have a profile.", role: u.role }, 200);

  // Kicked off BEFORE the pay reads so it overlaps them instead of queueing behind.
  const perfQ = (shownActor(s) === "owner" || shownActor(s) === "admin") && sp.get("perf") !== "0"
    ? sb.rpc("lfh_staff_performance", {
        p_restaurant: u.restaurant_id,
        p_from: new Date(todayIST().slice(0, 8) + "01T00:00:00+05:30").toISOString(),
        p_to: new Date().toISOString(),
      })
    : null;

  const { pin_hash, ...safe } = u;
  const c = completeness(u);
  const person = { ...safe, hasPin: !!pin_hash, completeness: c };
  const out: Record<string, unknown> = {
    // Strip the pay SETUP too when this caller may not see money. The roster already did
    // this; the detail didn't, so a manager without "See staff pay" was handed the salary
    // in the JSON even though no UI showed it — hidden in the UI is not hidden. (found while
    // verifying, 2026-07-29)
    staff: acc.canSeePay ? person : withoutPay(person),
    payAccess: acc,
    restaurant: slim(r),
  };

  if (acc.canSeePay) {
    // All four reads fire TOGETHER. Run one after another they added up to ~1.9s on the
    // Mumbai DB and the page sat on "Loading…"; in parallel it's one round-trip's worth.
    const yearStart = todayIST().slice(0, 4) + "-01-01";
    const monthStart = todayIST().slice(0, 8) + "01";
    const [paysQ, sumQ, sumMQ] = await Promise.all([
      // Newest 60 entries — a year of monthly salary plus advances, and enough to scroll.
      sb.from("staff_payments")
        .select("id, kind, amount, for_period, mode, paid_on, note, recorded_by, created_at, voided_at, void_reason, voided_by")
        .eq("staff_id", id).eq("restaurant_id", u.restaurant_id)
        .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(60),
      sb.rpc("lfh_staff_pay_summary", { p_restaurant: u.restaurant_id, p_from: yearStart, p_to: todayIST() }),
      sb.rpc("lfh_staff_pay_summary", { p_restaurant: u.restaurant_id, p_from: monthStart, p_to: todayIST() }),
    ]);
    out.payments = paysQ.data || [];
    const mine = ((sumQ.data || []) as any[]).find((x) => x.staff_id === id) || null;
    const mineM = ((sumMQ.data || []) as any[]).find((x) => x.staff_id === id) || null;
    out.summary = {
      thisMonth: Number(mineM?.paid || 0),
      thisYear: Number(mine?.paid || 0),
      advanceOutstanding: Number(mine?.advance_outstanding || 0),
      lastPaidOn: mine?.last_paid_on || null,
      entries: Number(mine?.entries || 0),
    };
  }

  // Performance is OWNER-ONLY (owner's call 2026-07-29 — a manager gets no access to it).
  if (perfQ) out.performance = (((await perfQ).data || []) as any[]).find((x) => x.staff_id === id) || null;
  return ok(out);
}

// A human label for whoever is acting, resolved from the SESSION (never the request body) —
// it lands in the pay ledger's "recorded by" and must be trustworthy.
async function actorLabel(s: Extract<Scope, { ok: true }>): Promise<string> {
  if (!s.actorId) return "Aevidine admin";
  const a = (await sb.from("staff_users").select("name, username, role").eq("id", s.actorId).maybeSingle()).data as
    { name?: string | null; username?: string; role?: string } | null;
  if (!a) return s.actor;
  const nm = a.name || a.username || s.actor;
  return a.role === "manager" ? `${nm} (manager)` : nm;
}

// Resolve one target person + this caller's pay rights for their restaurant. Every
// profile/pay write goes through here, so scoping + the ladder are checked exactly once.
async function target(s: Extract<Scope, { ok: true }>, id: string) {
  const ids = s.restaurants.map((r) => r.id);
  const u = (await sb.from("staff_users").select(`id, username, role, name, restaurant_id, profile, ${PROFILE_COLS}`)
    .eq("id", id).in("restaurant_id", ids).limit(1)).data?.[0] as any;
  if (!u) return { err: bad("That person isn't on your staff.", 404) };
  if (!assignableFor(s.actor).includes(u.role)) return { err: bad("You can't manage accounts at or above your own level.", 403) };
  const r = s.restaurants.find((x) => x.id === u.restaurant_id)!;
  const on = (await payrollByRid([u.restaurant_id]))[u.restaurant_id] === true;
  const acc = payAccessWith(s.actor, r, on);
  if (!acc.moduleOn) return { err: bad("Staff profiles & pay aren't enabled for this restaurant.", 403) };
  if (!hasProfile(u.role)) return { err: bad("Kitchen logins don't have a profile or pay record.", 400) };
  return { u, acc };
}

// AT MOST ONCE. The manager panel's staff writes now travel through its offline queue like every
// other write there, so a replay after a lost reply must not create the same person twice (or
// re-run a reset/disable). No X-LFH-Action-Id header → passes straight through, unchanged.
export const POST = withIdempotency(postImpl, "owner");
async function postImpl(req: NextRequest): Promise<Response> {
  const s = await scope(req); if (!s.ok) return s.resp;
  let body: any = {}; try { body = await req.json(); } catch {}

  // ── Record a payment (salary / advance / bonus / overtime / reimbursement / deduction) ──
  // Append-only: nothing here can ever edit or delete an existing entry (see void_payment).
  if (String(body?.action || "") === "record_payment") {
    const t = await target(s, String(body?.staff_id || "")); if (t.err) return t.err;
    if (!t.acc.canRecordPay) return bad("Your owner hasn't given managers permission to record staff payments.", 403);
    // Opt-in gate (mig 221): no payment can exist for someone the owner hasn't put on the pay
    // list. Enforced HERE, not just hidden in the UI, so the expense totals can never include
    // a person the owner never enrolled.
    if (!t.u.in_payroll)
      return bad(`${t.u.name || t.u.username} isn't on the pay list yet — add them to it first.`, 409);
    let p: ReturnType<typeof paymentFrom>;
    try { p = paymentFrom(body); } catch (e) { return bad(e instanceof Error ? e.message : "Bad payment."); }
    // WHO recorded it comes from the SESSION, never from the request body — a label the
    // client could set would make the ledger's "recorded by" worthless.
    const who = await actorLabel(s);
    const { data, error } = await sb.from("staff_payments").insert({
      restaurant_id: t.u.restaurant_id, staff_id: t.u.id, kind: p.kind, amount: p.amount,
      for_period: p.for_period, mode: p.mode, paid_on: p.paid_on, note: p.note,
      recorded_by: who, recorded_by_id: s.actorId,
    }).select("id, kind, amount, for_period, mode, paid_on, note, recorded_by, created_at").single();
    if (error) return bad("Couldn't save that payment — please try again.", 500);
    await logAction("owner", "staff_payment", {
      restaurant_id: t.u.restaurant_id, actor: s.actor, actor_id: s.actorId,
      detail: `recorded ₹${p.amount} ${p.kind} for "${t.u.username}" (${p.mode}, paid ${p.paid_on})`,
    });
    return ok({ ok: true, payment: data });
  }

  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  const role = String(body?.role || "") as Role;
  const rid = String(body?.restaurant_id || "");
  if (realCharCount(key) < 2) return bad("Username must be at least 2 characters.");
  // Hierarchy: a manager may only create BELOW their level (kitchen/tablet).
  if (!assignableFor(s.actor).includes(role)) return bad(s.actor === "manager" ? "Managers can only add kitchen or tablet logins." : "Pick a valid role (manager, kitchen, or tablet).");
  if (!s.restaurants.some((r) => r.id === rid)) return bad("That restaurant isn't yours to staff.", 403);
  // Names are unique PER restaurant (mig 091) — only clash-check within this one.
  // Binned rows don't count: since mig 245 a recycle-bin name is free to re-use.
  const dup = (await sb.from("staff_users").select("id").eq("username", key).eq("restaurant_id", rid).is("deleted_at", null).limit(1)).data?.[0];
  if (dup) return bad("That username is taken at this restaurant — pick another.", 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  if (password.length > 128) return bad("Password is too long (max 128 characters).");
  const row: Record<string, unknown> = { username: key, role, restaurant_id: rid, password_hash: await hashSecret(password), name: display, phone: String(body?.phone || "").trim().slice(0, 20) || null };
  // ── Fill the profile RIGHT HERE at creation (owner 2026-07-29: "while creating the user…
  //    make it almost perfect"). Every part is optional — an owner in a hurry still just types
  //    a name and a role. Personal details need the profile power; job & pay are owner/admin only.
  {
    const r = s.restaurants.find((x) => x.id === rid)!;
    const on = (await payrollByRid([rid]))[rid] === true;
    const acc = payAccessWith(s.actor, r, on);
    if (acc.moduleOn && hasProfile(role)) {
      if (acc.canEditProfile && body?.profile && typeof body.profile === "object") {
        row.profile = mergeProfilePatch({}, body.profile as Record<string, unknown>, PROFILE_FIELDS);
      }
      if (acc.canEditJobPay) {
        try { Object.assign(row, jobPatchFrom(body)); }
        catch (e) { return bad(e instanceof Error ? e.message : "Bad job details."); }
      }
    }
  }
  // Waiter sections (migs 222-225): with sections ON you CHOOSE this waiter's tables as you
  // create them (body.tables, "Select all" is one tap in the form) and an empty pick is
  // refused; with sections off there's nothing to choose, so they're seeded with the whole
  // floor. One rule, shared with the admin screen — see newWaiterTables().
  if (role === "tablet") {
    try { row.assigned_tables = await newWaiterTables(rid, body?.tables); }
    catch (e) { return bad(e instanceof Error ? e.message : "Pick at least one table."); }
  }
  const { data, error } = await sb.from("staff_users").insert(row).select("id, username, role, name, restaurant_id").single();
  if (error) {
    // The pre-check above and this insert aren't atomic — two staff added at once (or a
    // fast double-click) can both pass the check and race here. Postgres code 23505 =
    // unique_violation on (restaurant_id, username): show the SAME friendly 409, never the
    // raw "duplicate key value violates unique constraint …" DB message. Any other DB error
    // is unexpected → a generic message, not the internals.
    if ((error as { code?: string }).code === "23505") return bad("That username is taken at this restaurant — pick another.", 409);
    return bad("Something went wrong, please try again.", 500);
  }
  await logAction("owner", "staff_create", { restaurant_id: rid, actor: s.actor, actor_id: s.actorId, detail: `created ${role} "${display}"` });
  return ok({ ok: true, id: data!.id, name: display, role, restaurant_id: rid, password });
}

export const PATCH = withIdempotency(patchImpl, "owner");
async function patchImpl(req: NextRequest): Promise<Response> {
  const s = await scope(req); if (!s.ok) return s.resp;
  let body: any = {}; try { body = await req.json(); } catch {}
  const id = String(body?.id || ""); const action = String(body?.action || "");

  // ── Profile & pay actions (mig 220) ─────────────────────────────────────────────────
  // set_profile  — personal details (owner/admin, or a manager granted "Edit staff profiles")
  // set_job      — job + pay SETUP (owner/admin only; never a manager)
  // set_own_pay  — may this person see their own pay in their panel (owner/admin only)
  // void_payment — cancel a ledger entry WITH a reason; the row stays, struck through
  if (action === "set_profile" || action === "set_job" || action === "set_own_pay") {
    const t = await target(s, id); if (t.err) return t.err;
    if (action === "set_profile") {
      if (!t.acc.canEditProfile) return bad("Your owner hasn't given managers permission to edit staff profiles.", 403);
      const patch = body?.profile;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return bad("Missing profile fields.");
      const merged = mergeProfilePatch(t.u.profile, patch as Record<string, unknown>, PROFILE_FIELDS);
      const { error } = await sb.from("staff_users").update({ profile: merged }).eq("id", id);
      if (error) return bad("Couldn't save those details — please try again.", 500);
      const changed = Object.keys(patch).slice(0, 8).join(", ");
      await logAction("owner", "staff_profile_edit", {
        restaurant_id: t.u.restaurant_id, actor: s.actor, actor_id: s.actorId,
        detail: `updated "${t.u.username}" profile (${changed})`,
      });
      const c = completeness({ ...t.u, profile: merged });
      return ok({ ok: true, profile: merged, completeness: c });
    }
    if (action === "set_job") {
      if (!t.acc.canEditJobPay) return bad("Only the owner can set someone's job and pay.", 403);
      let patch: Record<string, unknown>;
      try { patch = jobPatchFrom(body); } catch (e) { return bad(e instanceof Error ? e.message : "Bad value."); }
      if (!Object.keys(patch).length) return bad("Nothing to change.");
      // Only a pay-list member gets a RATE. Their joining date, shift and designation are
      // ordinary job facts and stay editable either way (mig 221).
      const PAY_ONLY = ["pay_type", "pay_amount", "pay_day", "pay_mode", "pay_extras"];
      if (!t.u.in_payroll && PAY_ONLY.some((k) => k in patch))
        return bad(`${t.u.name || t.u.username} isn't on the pay list — add them to it before setting a rate.`, 409);
      const { error } = await sb.from("staff_users").update(patch).eq("id", id);
      if (error) return bad("Couldn't save those changes — please try again.", 500);
      await logAction("owner", "staff_job_edit", {
        restaurant_id: t.u.restaurant_id, actor: s.actor, actor_id: s.actorId,
        detail: `updated "${t.u.username}" job/pay (${Object.keys(patch).join(", ")})`,
      });
      const c = completeness({ ...t.u, ...patch } as any);
      return ok({ ok: true, ...patch, completeness: c });
    }
    // set_own_pay
    if (!t.acc.canEditJobPay) return bad("Only the owner can change this.", 403);
    if (typeof body?.can_see_own_pay !== "boolean") return bad("`can_see_own_pay` must be true or false.");
    const { error } = await sb.from("staff_users").update({ can_see_own_pay: body.can_see_own_pay }).eq("id", id);
    if (error) return bad("Couldn't save that — please try again.", 500);
    await logAction("owner", "staff_own_pay_visibility", {
      restaurant_id: t.u.restaurant_id, actor: s.actor, actor_id: s.actorId,
      detail: `"${t.u.username}" can${body.can_see_own_pay ? "" : "not"} see their own pay`,
    });
    return ok({ ok: true, can_see_own_pay: body.can_see_own_pay });
  }

  // ── the pay list itself (mig 221) ───────────────────────────────────────────
  // Owner/admin only. Removing someone KEEPS their history (nothing is erased) but stops
  // them counting as an expense and stops new payments — the same "never delete money"
  // discipline as a cancelled entry.
  if (action === "set_payroll") {
    const t = await target(s, id); if (t.err) return t.err;
    if (!t.acc.canEditJobPay) return bad("Only the owner can change who is on the pay list.", 403);
    if (typeof body?.in_payroll !== "boolean") return bad("`in_payroll` must be true or false.");
    const on = body.in_payroll;
    if (t.u.in_payroll === on) return ok({ ok: true, in_payroll: on });   // already there
    const who = await actorLabel(s);
    const { error } = await sb.from("staff_users").update({
      in_payroll: on,
      payroll_added_at: on ? new Date().toISOString() : null,
      payroll_added_by: on ? who : null,
    }).eq("id", id);
    if (error) return bad("Couldn't update the pay list — please try again.", 500);
    await logAction("owner", on ? "payroll_add" : "payroll_remove", {
      restaurant_id: t.u.restaurant_id, actor: s.actor, actor_id: s.actorId, level: on ? "info" : "warn",
      detail: `${on ? "added" : "removed"} "${t.u.username}" ${on ? "to" : "from"} the pay list`,
    });
    return ok({ ok: true, in_payroll: on, payroll_added_by: on ? who : null });
  }

  if (action === "void_payment") {
    const t = await target(s, String(body?.staff_id || "")); if (t.err) return t.err;
    if (!t.acc.canRecordPay) return bad("Your owner hasn't given managers permission to change staff payments.", 403);
    const payId = String(body?.payment_id || "");
    const reason = String(body?.reason || "").trim().slice(0, 200);
    // A reason is REQUIRED: a voided entry with no explanation is exactly the hole this
    // ledger is designed not to have.
    if (!payId) return bad("Missing payment id.");
    if (reason.length < 3) return bad("Say why you're cancelling this entry (a few words is enough).");
    const existing = (await sb.from("staff_payments").select("id, amount, kind, voided_at")
      .eq("id", payId).eq("staff_id", t.u.id).eq("restaurant_id", t.u.restaurant_id).limit(1)).data?.[0] as any;
    if (!existing) return bad("That payment entry doesn't exist.", 404);
    if (existing.voided_at) return bad("That entry is already cancelled.");
    const { error } = await sb.from("staff_payments").update({
      voided_at: new Date().toISOString(), void_reason: reason,
      voided_by: await actorLabel(s), voided_by_id: s.actorId,
    }).eq("id", payId).eq("restaurant_id", t.u.restaurant_id);
    if (error) return bad("Couldn't cancel that entry — please try again.", 500);
    await logAction("owner", "staff_payment_void", {
      restaurant_id: t.u.restaurant_id, actor: s.actor, actor_id: s.actorId, level: "warn",
      detail: `cancelled a ₹${existing.amount} ${existing.kind} entry for "${t.u.username}" — ${reason}`,
    });
    return ok({ ok: true });
  }

  if (!id) return bad("Missing staff id.");
  const ids = s.restaurants.map((r) => r.id);
  // Explicit column list — exactly the five fields the handlers below read. It used to be
  // `select("*")`, which needlessly pulled `password_hash` into the route (it was never
  // echoed to the client, but there is no reason to move secret material at all), and broke
  // the project's own explicit-column rule (found 2026-08-04).
  const u = (await sb.from("staff_users")
    .select("id, username, role, restaurant_id, token_version, permissions")
    .eq("id", id).in("restaurant_id", ids).limit(1)).data?.[0];
  if (!u) return bad("That person isn't on your staff.", 404);
  // Hierarchy: the TARGET must be below the actor's level — a manager can never
  // touch another manager's (or an owner's) account, in any way.
  if (!assignableFor(s.actor).includes(u.role)) return bad("You can't manage accounts at or above your own level.", 403);

  // A MANAGER'S FINER STAFF POWERS (owner, 2026-08-01). "Manage staff" used to be one yes covering
  // creating a login, resetting somebody's password and deleting them outright. Those are three
  // very different amounts of trust, so each is its own switch now
  // (access_config.manage_staff.manager_opts.*). The OWNER and the admin are unaffected — this
  // only ever narrows a manager, and an unset option keeps the row's own default.
  const mgrStaffOpt = async (key: "create" | "reset_pw" | "delete", dflt: boolean): Promise<boolean> => {
    if (s.actor !== "manager") return true;
    const rid = s.restaurants[0]?.id;
    if (!rid) return false;
    const cfg = (await sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle()).data?.access_config as
      { manage_staff?: { manager_opts?: Record<string, boolean> } } | null;
    const v = cfg?.manage_staff?.manager_opts?.[key];
    return typeof v === "boolean" ? v : dflt;
  };

  if (action === "reset_password") {
    if (!(await mgrStaffOpt("reset_pw", true)))
      return bad("Resetting a password isn't part of your staff access.", 403);
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    if (password.length > 128) return bad("Password is too long (max 128 characters).");
    // Capture the write error: without this, a failed UPDATE (row lock / timeout) still
    // returned {ok:true, password} — the owner read out a password the DB never saved, so
    // the staffer couldn't log in and the OLD password still worked (audit 2026-07-07).
    const { error } = await sb.from("staff_users").update({ password_hash: await hashSecret(password), token_version: (u.token_version || 0) + 1, failed_count: 0, locked_until: null }).eq("id", id);
    if (error) return bad("Couldn't reset the password — please try again.", 500);
    await logAction("owner", "staff_reset_password", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `reset "${u.username}"` });
    return ok({ ok: true, password });
  }
  if (action === "set_active") {
    // Must be a REAL boolean — the old `!!body?.active` silently coerced junk (e.g.
    // active:"false" is a truthy string → enabled), flipping state the wrong way.
    if (typeof body?.active !== "boolean") return bad("`active` must be true or false.");
    const active = body.active;
    const { error } = await sb.from("staff_users").update({ active, token_version: active ? u.token_version : (u.token_version || 0) + 1 }).eq("id", id);
    if (error) return bad("Couldn't update that account — please try again.", 500);
    await logAction("owner", active ? "staff_enable" : "staff_disable", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `${active ? "enabled" : "disabled"} "${u.username}"` });
    return ok({ ok: true });
  }
  if (action === "set_role") {
    const role = String(body?.role || "") as Role;
    // Hierarchy: the NEW role must also stay below the actor (a manager can't
    // promote someone up to manager).
    if (!assignableFor(s.actor).includes(role)) return bad("Pick a valid role.");
    const { error } = await sb.from("staff_users").update({ role, token_version: (u.token_version || 0) + 1 }).eq("id", id);
    if (error) return bad("Couldn't change the role — please try again.", 500);
    await logAction("owner", "staff_set_role", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `set "${u.username}" → ${role}` });
    return ok({ ok: true });
  }
  // set_permissions — per-user capability overrides (migration 115). Body:
  //   { id, action:"set_permissions", permissions: { tablet_mark_paid: "on"|"pin"|"off"|null, … } }
  // null (or absent-after-merge) deletes the key → the user goes back to "Default"
  // (inherits the restaurant-wide tri-state). Keys/values are strictly validated so a
  // buggy client can never write junk into the JSONB.
  if (action === "set_permissions") {
    // Per-user override keys come in TWO families, both stored in staff_users.permissions:
    //   • TABLET caps (tablet_*) — the waiter rung, tri-state on|pin|off; enforced by
    //     tabletPerm (keep in lockstep with TABLET_PERM_KEYS in the tablet route).
    //   • MANAGER powers (the bare flag, e.g. give_discounts) — per-person override for a
    //     MANAGER, two-state on|off; enforced by managerCan (Option B, 2026-07-24). A key
    //     the enforcer doesn't read would be a dead grant, so both lists are the enforced set.
    const TABLET_KEYS = TABLET_PERM_KEYS; // derived from lib/accessModel (2026-07-26) — lockstep with tabletPerm by construction
    const POWER_KEYS = MANAGER_POWER_FLAGS as readonly string[];
    const patch = body?.permissions;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return bad("Missing permissions object.");
    const merged: Record<string, string> = { ...(u.permissions && typeof u.permissions === "object" ? u.permissions : {}) };
    const noted: string[] = [];
    // Load this restaurant's admin entitlements once, only if an owner grants a manager power.
    let entsCache: unknown; let entsLoaded = false;
    const ents = async () => { if (!entsLoaded) { entsCache = (await sb.from("restaurants").select("owner_entitlements").eq("id", u.restaurant_id).maybeSingle()).data?.owner_entitlements ?? null; entsLoaded = true; } return entsCache; };
    for (const [k, v] of Object.entries(patch)) {
      const isTablet = TABLET_KEYS.includes(k);
      const isPower = POWER_KEYS.includes(k);
      if (!isTablet && !isPower) return bad(`Unknown permission "${k}".`);
      if (v === null || v === "" || v === "default") { delete merged[k]; noted.push(`${k}→default`); continue; }
      // Tablet caps allow the PIN state; manager-power overrides are plain on/off.
      const modes = isTablet ? ["on", "pin", "off"] : ["on", "off"];
      if (!modes.includes(String(v))) return bad(`Bad value for "${k}" — use ${modes.join(", ")}, or null.`);
      // Least-privilege (audit 2026-07-07): a MANAGER may REDUCE a junior's power (off) or
      // reset it to default, but may NOT GRANT (on/pin) — only the owner/admin grants powers.
      if (s.actor === "manager" && (v === "on" || v === "pin"))
        return bad("Only the owner can grant extra powers to staff.", 403);
      // Owner actor granting on/pin: role-relevance + the admin ceiling. Server-refused, not
      // just hidden. Admin super-user is unrestricted (skips this whole block).
      if (s.actor === "owner" && (v === "on" || v === "pin")) {
        if (isTablet) {
          if (u.role !== "tablet")
            return bad("These per-user caps apply to waiter (tablet) accounts only.", 400);
          const gate = CAP_MODULE_GATE[k];
          if (gate && !(await gate(u.restaurant_id)).effective)
            return bad("That feature isn't enabled for this restaurant by the admin — you can't grant it.", 403);
        } else { // manager-power override
          if (u.role !== "manager")
            return bad("These per-person powers apply to manager accounts.", 400);
          if (!powerEntitled(await ents(), k))
            return bad("The admin hasn't allowed this power for the restaurant — you can't grant it.", 403);
        }
      }
      merged[k] = String(v); noted.push(`${k}→${v}`);
    }
    if (!noted.length) return bad("Nothing to change.");
    const { error } = await sb.from("staff_users").update({ permissions: merged }).eq("id", id);
    if (error) return bad("Couldn't update permissions — please try again.", 500);
    await logAction("owner", "staff_set_permissions", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `"${u.username}": ${noted.join(", ")}` });
    return ok({ ok: true, permissions: merged });
  }
  if (action === "edit") {
    const patch: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      const display = String(body.name || "").trim().slice(0, 80);
      const nkey = normalizeLoginName(display);
      if (realCharCount(nkey) < 2) return bad("Username must be at least 2 characters.");
      const clash = (await sb.from("staff_users").select("id").eq("username", nkey).eq("restaurant_id", u.restaurant_id).neq("id", id).is("deleted_at", null).limit(1)).data?.[0];
      if (clash) return bad("That username is taken at this restaurant.", 409);
      patch.name = display; patch.username = nkey;
    }
    if (body?.phone !== undefined) patch.phone = String(body.phone || "").trim().slice(0, 20) || null;
    if (!Object.keys(patch).length) return bad("Nothing to change.");
    const { error } = await sb.from("staff_users").update(patch).eq("id", id);
    if (error) return bad("Couldn't save those changes — please try again.", 500);
    return ok({ ok: true });
  }
  return bad("Unknown action.");
}

export const DELETE = withIdempotency(deleteImpl, "owner");
async function deleteImpl(req: NextRequest) {
  const s = await scope(req); if (!s.ok) return s.resp;
  // A MANAGER can never DELETE a login (owner, 2026-08-02: "it can disable the user, it
  // can't delete the user"). Disabling is their tool — it keeps the row, the name and the
  // audit trail, and the person is told they're disabled when they try to sign in. Refused
  // here first so no hierarchy quirk below can ever let it through.
  if (s.actor === "manager") return bad("Managers can disable a login, not delete it — ask the owner or admin to remove someone.", 403);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return bad("Missing staff id.");
  const ids = s.restaurants.map((r) => r.id);
  const u = (await sb.from("staff_users").select("username, role, restaurant_id").eq("id", id).in("restaurant_id", ids).limit(1)).data?.[0];
  if (!u) return bad("That person isn't on your staff.", 404);
  // Hierarchy: can only delete accounts BELOW your level (see assignableFor).
  if (!assignableFor(s.actor).includes(u.role as Role)) return bad("You can't manage accounts at or above your own level.", 403);
  const { error } = await sb.from("staff_users").delete().eq("id", id);
  if (error) return bad("Couldn't remove that account — please try again.", 500);
  await logAction("owner", "staff_delete", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `deleted "${u.username}"` });
  return ok({ ok: true });
}
