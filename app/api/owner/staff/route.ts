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
import { USER_COOKIE, userFromCookie, normalizeLoginName, type Role } from "@/lib/userAuth";
import { passwordFields } from "@/lib/passwordVault";
import { logAction } from "@/lib/oplog";
// MANAGER_POWER_FLAGS is deliberately NOT imported here any more: the per-person allow-list is
// `capsForRole()` (lib/staffCaps), the one list the Access screen and the admin write route use.
// A second hand-picked constant is what let `delete_bill` be a manager row on screen and an
// "Unknown permission" here (fixed 2026-08-04).
import { mergeOwnerEntitlements, entitledSubset, logViewSubset } from "@/lib/ownerEntitlements";
import { managerSettingsOff, type MgrStaffPower } from "@/lib/accessTree";
import { enabledOwnedRestaurantIds, OwnedLookupFailed } from "@/lib/panelAccess";
import { banquetLadder, tableTagsLadder, khataLadder, tableOpsLadder, takeOrdersLadder, parcelLadder } from "@/lib/tableTags";
import { capsForRole, capGroupsForRole, capVisible, roleDefault, effectiveCap } from "@/lib/staffCaps";
import { accessStateFor } from "@/lib/accessState";
import { newWaiterTables } from "@/lib/tableAssign";
import { viewAsPerson, isPersonId } from "@/lib/viewAsPerson";
import { rd, ReadSet } from "@/lib/readGuard";
import { loadLogVisibility } from "@/lib/logVisibility";
import {
  PROFILE_FIELDS, hasProfile, completeness, mergeProfilePatch, jobPatchFrom, paymentFrom,
  payAccessWith, todayIST, payHistoryBlocksDelete, PAY_HISTORY_DELETE_MESSAGE, type PayAccess,
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
import { expectClash, clashJson } from "@/lib/clash";

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
    // THE LAST `power_<flag>` READER IS GONE (sweep T6, 2026-08-10). This still asked
    // `owner_entitlements.power_manage_staff !== false` — the pre-rebuild "may the admin allow
    // this power at all" rung, which docs/ACCESS-MODEL.md already recorded as deleted from all
    // five readers INCLUDING this file. One of this file's two went on 2026-08-06; this one was
    // missed. It is unwritable by any code path (the sole writer of owner_entitlements allow-lists
    // owner PAGE keys from SECTION_ENTITLEMENTS) and an absent key merges to `true`, so it could
    // never fire — verified before removing: no restaurant on the backup database has any
    // `power_*` stored at all, let alone false. Left in place it was a trap, not a gate: a
    // restaurant that ever acquired a stored `false` would have its managers permanently refused
    // Settings → Users with NO screen able to give it back, which is precisely the
    // stored-but-unswitchable shape this model removed everywhere else. The admin's real switch
    // for this section is the row it already checks below — Access → Manager settings → Users.
    if (!r || managerSettingsOff(r.access_config).includes("users"))
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
      // ?as=<ownerId> — WHICH owner's cockpit this tab was opened for (T19 sweep, 2026-08-14).
      // lib/ownerScope.ts has honoured this since 2026-07-25 (the dashboard's "which owner?"
      // chooser); this route had its own copy of the resolution and never looked at it, so on a
      // restaurant with two owners the Dashboard and Reports showed the picked owner while the
      // Team page silently showed the PRIMARY owner's estate — a restaurant of theirs the picked
      // owner doesn't own would list its whole team under the wrong person's name. Honoured ONLY
      // when that owner really co-owns this restaurant, exactly as ownerScope does, so a stale or
      // hand-typed id can never widen the set; otherwise fall back to primary/first as before.
      const asOwner = sp?.get("as");
      const ownerId = (asOwner && members.includes(asOwner))
        ? asOwner
        : (primary && members.includes(primary) ? primary : (members[0] ?? null));
      let ids: string[] = [];
      if (ownerId) {
        // A BLIP MUST NOT SILENTLY SHRINK THE VIEW (T19 sweep, 2026-08-14 — the twin of T9's F22,
        // which was fixed in lib/ownerScope.ts on 2026-08-12 and missed here). This read's
        // `.error` was ignored, so a failed widen left `ids` as just the entered restaurant and
        // the page rendered a complete-looking Team screen for ONE restaurant, with nothing
        // saying the others had been dropped rather than never existed. Every other read in this
        // function already answers `transient()`; this one allowed a wrong answer through.
        const owned = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId);
        if (owned.error) {
          console.error("[owner/staff] could not widen the act-as set:", owned.error.message);
          return { ok: false, resp: transient() };
        }
        ids = (owned.data || []).map((x) => x.restaurant_id as string);
      }
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
//
// ── "COULDN'T READ IT" IS NOT "YOU DON'T HAVE IT" (T20 sweep #7, 2026-08-27) ──────────────────────
// This read's `.error` was never inspected, so a database blip returned an EMPTY map — and every
// caller reads that as `payroll_allowed !== true`, i.e. the module is off. The consequences are not
// cosmetic, and the worst one is on a WRITE:
//   · `target()` — the front door for every profile and pay write — then refuses with
//     "Staff profiles & pay aren't enabled for this restaurant." (403). Wrong reason, and a status
//     nothing retries, so saving a salary during a blip is simply lost. That is EXACTLY finding F7,
//     which was fixed on 2026-08-12 for the person read ONE LINE ABOVE this one and missed here.
//   · `staffDetail()` — the same 403 for opening a person who does have a profile;
//   · `postImpl` — a person is created with their profile and job fields silently dropped;
//   · the roster — every person comes back `profileEligible: false`, so the profile UI disappears.
//
// `null` = "we could not check", and every caller answers `transient()` (a retryable 503) instead of
// a sentence about the restaurant's setup. Refuse on doubt, which is the rule the four other rungs in
// this file already keep (`mgrStaffPower`, `scope()`, `target()`, the feature gate).
//
// NOT the same thing as `payUnread` further down: that one is about a pay AMOUNT that could not be
// read, where the roster deliberately stays up and names the gap. This is about whether the feature
// exists at all, and inventing an answer to that decides permissions.
async function payrollByRid(ids: string[]): Promise<Record<string, boolean> | null> {
  const out: Record<string, boolean> = {};
  if (!ids.length) return out;
  const { data, error } = await sb.from("settings")
    .select("restaurant_id, payroll_allowed, payroll_owner_control, payroll_enabled").in("restaurant_id", ids);
  if (error) {
    console.error("[owner/staff] could not read the payroll module state:", error.message);
    return null;
  }
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
    // ── A GREYED-OUT SWITCH IS A STATEMENT ABOUT THE ADMIN'S GRANT (T20 sweep #7, 2026-08-27) ────────
    // `.error` was never inspected, so a failed read left `modsByRid` empty — and the per-person
    // override UI GREYS every waiter power whose module reads as off. So a blip made it look as though
    // Aevidine had granted this restaurant none of banquet / table types / table ops / take orders, on
    // the screen where the owner hands those powers to a waiter. The server's own ceiling (GAP-B, the
    // CAP_MODULE_GATE below) re-reads the ladder per grant and is unaffected, so nothing wrong could
    // be SAVED — only shown. Refuse on doubt, like every other rung here.
    const setQ = await sb.from("settings")
      .select("restaurant_id, banquet_allowed, banquet_owner_control, banquet_enabled, table_tags_allowed, table_tags_owner_control, table_tags_enabled, table_ops_allowed, table_ops_owner_control, table_ops_enabled, take_orders_allowed, take_orders_owner_control, take_orders_enabled")
      .in("restaurant_id", ids);
    if (setQ.error) {
      console.error("[owner/staff] could not read which waiter powers this restaurant has:", setQ.error.message);
      return transient();
    }
    const setRows = setQ.data;
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
  if (!payrollOn) return transient();   // see payrollByRid — never guess whether a feature exists
  const accessByRid: Record<string, PayAccess> = {};
  for (const r of s.restaurants) accessByRid[r.id] = payAccessWith(shownActor(s), r, payrollOn[r.id] === true);

  // Money totals per person, for the restaurants where this caller may see money. One RPC per
  // restaurant (a tiny grouped result), never one per person.
  //
  // TOGETHER, not one after another (2026-08-05). A multi-restaurant owner paid one full
  // round trip per restaurant before their roster could paint — twelve restaurants meant twelve
  // sequential Mumbai round trips. They are independent grouped reads, so they overlap.
  //
  // Deliberately NOT behind the snapshot cache, even though these are money aggregates: the
  // fingerprint that gates `cachedOwnerPayload` watches ORDERS, so recording a salary would not
  // invalidate it and the roster would keep showing yesterday's "paid this month" — a stale
  // money figure is worse than a small live query. It stays live, indexed
  // (idx_staff_payments_rest_paid) and month-scoped.
  const money: Record<string, { paid: number; advance: number; last: string | null }> = {};
  const from = todayIST().slice(0, 8) + "01";                 // 1st of this month
  const to = todayIST();
  const payable = s.restaurants.filter((r) => accessByRid[r.id]?.canSeePay);
  const paySummaries = await Promise.all(
    payable.map((r) => sb.rpc("lfh_staff_pay_summary", { p_restaurant: r.id, p_from: from, p_to: to })));
  // A ZEROED SALARY IS A CLAIM, NOT AN ABSENCE (T9 sweep, 2026-08-06). Nothing inspected `error`
  // here, so a failed summary left that restaurant out of the `money` map and every one of its
  // people fell back to `paidThisMonth: 0` — the roster then printed "₹0 paid this month" for
  // people who HAD been paid. That is the shape that starts a "you never paid me" argument, and it
  // is the same fault this very block's comment argues against ("a stale money figure is worse than
  // a small live query"): a silently zeroed one is worse than either.
  //
  // The roster is mostly NOT money, so a pay blip must not fail the whole screen (unlike
  // /api/owner/khata, where the page IS the money). Instead the figures are left OFF the row and
  // `payUnread` says why, so the screen can state it plainly instead of stating a zero.
  const payUnread = paySummaries.some((q) => q.error);
  if (payUnread) {
    console.error("[owner/staff] pay summary read failed:",
      paySummaries.find((q) => q.error)?.error?.message);   // detail our side, not the owner's screen
  }
  for (const { data } of paySummaries) {
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
      // When the summary couldn't be read, send NO figure at all + the reason. `money(undefined)`
      // renders "₹0" just like `money(0)` does, so leaving the key out is not enough on its own —
      // `payUnread` is what lets the screen say "couldn't read" instead of naming an amount.
      ...(payUnread
        ? { payUnread: true }
        : { paidThisMonth: m?.paid ?? 0, advanceOutstanding: m?.advance ?? 0, lastPaidOn: m?.last ?? null }),
    };
    return acc?.canSeePay ? row : withoutPay(row);
  });

  // Waiter sections: the Add form needs each restaurant's floor size to draw the table
  // picker. One tiny scoped read for the restaurants already in scope.
  // ── CLOSING T13'S HANDOFF: THE FLOOR-SIZE READ NOW ANSWERS FOR ITSELF (T20 sweep #7, 2026-08-27) ─
  // `.error` was never inspected, so a blip answered `tableCount: 0` for every restaurant — and the
  // Add-a-waiter form draws its table picker from that number. The owner then got an empty box,
  // "0 of 0 picked", and the line "Pick at least one table": told to do the one thing the screen was
  // not offering, with Add disabled and nothing saying why. app/owner/staff/page.tsx already prints an
  // honest sentence for the empty case and its comment ends "🔗 see the HANDOFF for the server-side
  // read" — this is that read. `tableCountUnread` lets the page tell "we couldn't read the floor" apart
  // from "this restaurant genuinely has no tables" (which is not a normal state: the column is NOT
  // NULL DEFAULT 12 and the admin clamps it to 1–500).
  const tcQ = await sb.from("settings").select("restaurant_id, table_count").in("restaurant_id", s.restaurants.map((r) => r.id));
  if (tcQ.error) console.error("[owner/staff] could not read the floor size:", tcQ.error.message);
  const tcRows = tcQ.data || [];
  const tcByRid: Record<string, number> = Object.fromEntries(tcRows.map((t) => [t.restaurant_id as string, Number(t.table_count) || 0]));

  return ok({
    // The PANEL reads this to decide what its Users card offers, so a pinned manager view
    // must say "manager" here — that is the whole point of the pin.
    actor: shownActor(s),
    restaurants: s.restaurants.map((r) => ({
      ...slim(r), modules: { ...(modsByRid[r.id] || {}), payroll: payrollOn[r.id] === true },
      payAccess: accessByRid[r.id],
      tableCount: tcByRid[r.id] || 0,
      // Only when it is genuinely true, so a healthy answer is byte-for-byte what it was.
      ...(tcQ.error ? { tableCountUnread: true } : {}),
    })),
    staff: staffOut,
  });
}

// ── One person: profile + pay history + their own performance ─────────────────
// Separate from the roster on purpose (egress): a payment list and a performance query only
// run when someone actually opens that person.
async function staffDetail(s: Extract<Scope, { ok: true }>, id: string, sp: URLSearchParams) {
  const ids = s.restaurants.map((r) => r.id);
  // "I COULDN'T ASK" IS NOT "THEY AREN'T YOURS" (T9 finding F7, fixed 2026-08-12). This read's
  // `.error` was never inspected, so a database blip produced `u === undefined` and answered
  // "That person isn't on your staff." with a 404 — a sentence that sends the owner looking for a
  // permissions problem that does not exist, and a status no client retries. Same rule this file
  // already applies in `scope()` via transient().
  const detail = await rd("person", () => sb.from("staff_users")
    .select(`id, username, role, name, phone, active, restaurant_id, last_seen_at, created_at, pin_hash, permissions, can_self_reset, can_self_set_pin, ${PROFILE_COLS}`)
    .eq("id", id).in("restaurant_id", ids).limit(1));
  if (detail.error) return transient();
  const u = (detail.data || [])[0] as any;
  if (!u) return bad("That person isn't on your staff.", 404);
  // shownActor, not s.actor: a pinned "as this manager" tab must answer this READ the way the
  // manager is answered (they can't open a peer's or an owner's record), so the view can't show
  // a person the real panel would refuse. Writes below still run with the admin's own power.
  if (!assignableFor(shownActor(s)).includes(u.role)) return bad("You can't open accounts at or above your own level.", 403);
  const r = s.restaurants.find((x) => x.id === u.restaurant_id)!;
  const payMap = await payrollByRid([u.restaurant_id]);
  if (!payMap) return transient();      // see payrollByRid
  const acc = payAccessWith(shownActor(s), r, payMap[u.restaurant_id] === true);
  if (!acc.moduleOn) return ok({ disabled: true, error: "Staff profiles & pay aren't enabled for this restaurant — contact Aevidine." }, 403);
  if (!hasProfile(u.role)) return ok({ notEligible: true, error: "Kitchen logins don't have a profile.", role: u.role }, 200);

  // ── EVERYTHING THAT DOES NOT DEPEND ON ANOTHER READ STARTS NOW (T13 handoff H4, 2026-08-19) ──
  //
  // Opening one person took 4–10 seconds, measured five times on the owner's own screen (3.9s, 6.4s,
  // 7.0s, 8.7s, 10.1s to the name appearing). Nothing was slow on its own: this function simply
  // awaited seven things in a ROW, and every one of them is a round trip to Mumbai —
  //   person → payroll → pay-set → performance → access tree → activity → log visibility.
  // The pay reads had already been bunched for exactly this reason ("run one after another they
  // added up to ~1.9s and the page sat on Loading…"); the four reads AROUND them had not.
  //
  // The person and the payroll gate must stay first — the early returns above depend on them, and
  // firing these for a kitchen login would be reads for an answer we then throw away. Everything
  // after those gates is keyed only on `u.restaurant_id` / `id`, so it all starts together and the
  // chain drops from seven sequential hops to four.
  //
  // `logsOn` still gates the ACTIVITY read (it must — a feed that ignored the switch would be a way
  // around something Aevidine turned off), so activity remains the one hop that waits.
  // `.catch(...)` on each: these are STARTED here and some are awaited later or not at all, and a
  // floating promise that rejects takes the process down rather than this one request. None of these
  // three throws today (each answers a shape on failure), so the catches are belt-and-braces that
  // keep the answer honest — a failure still arrives as "couldn't read", never as a silent default.
  const treeQ = accessStateFor(u.restaurant_id).catch(() => null);
  const logsOnQ = (s.actor === "admin")
    ? Promise.resolve(true)
    : (async () => (await logViewSubset(await entitledSubset([u.restaurant_id], "logs"), "activity")).length > 0)()
        .catch(() => false);
  // ONE extra single-row read in the minority case, deliberately. `visQ` used to run only after
  // `logsOn` came back true; starting it alongside costs one indexed `restaurants` read by id when
  // the admin HAS switched the owner's Activity view off, and saves a whole Mumbai round trip on
  // every profile open when it is on (which is the default for every restaurant).
  const visQ = loadLogVisibility([u.restaurant_id], s.actor === "admin")
    .catch(() => ({ ok: false as const, error: new Error("log visibility read failed") }));

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
    const pay = new ReadSet("owner/staff.detail", await Promise.all([
      // Newest 60 entries — a year of monthly salary plus advances, and enough to scroll.
      rd("payments", () => sb.from("staff_payments")
        .select("id, kind, amount, for_period, mode, paid_on, note, recorded_by, created_at, voided_at, void_reason, voided_by")
        .eq("staff_id", id).eq("restaurant_id", u.restaurant_id)
        .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(60)),
      rd("year", () => sb.rpc("lfh_staff_pay_summary", { p_restaurant: u.restaurant_id, p_from: yearStart, p_to: todayIST() })),
      rd("month", () => sb.rpc("lfh_staff_pay_summary", { p_restaurant: u.restaurant_id, p_from: monthStart, p_to: todayIST() })),
    ]));
    // ── A ZEROED SALARY IS A CLAIM, NOT AN ABSENCE — ON THIS PAGE TOO (T9 finding F6, 2026-08-12) ──
    // The ROSTER in this same file was given exactly this treatment on 2026-08-06 (`payUnread`), and
    // its comment spells out why: an invented "₹0 paid this month" is "the shape that starts a 'you
    // never paid me' argument". The person's OWN profile — the screen you would actually open to
    // settle that argument — was missed, and read `paysQ.data || []`, so a failed read rendered an
    // EMPTY payment history and "₹0 this month, ₹0 this year" for someone who had been paid all year.
    //
    // Now: no figures at all rather than wrong ones, and `payUnread` says why. Leaving the keys out
    // is not enough on its own — a missing `thisMonth` renders as "₹0" exactly like a real zero — so
    // the flag is what lets the screen say "couldn't read" instead of naming an amount.
    if (pay.anyFailed) {
      out.payUnread = true;
      out.partial = [...((out.partial as string[]) || []), "payHistory"];
    } else {
      out.payments = pay.rows("payments");
      const mine = pay.rows<any>("year").find((x) => x.staff_id === id) || null;
      const mineM = pay.rows<any>("month").find((x) => x.staff_id === id) || null;
      out.summary = {
        thisMonth: Number(mineM?.paid || 0),
        thisYear: Number(mine?.paid || 0),
        advanceOutstanding: Number(mine?.advance_outstanding || 0),
        lastPaidOn: mine?.last_paid_on || null,
        entries: Number(mine?.entries || 0),
      };
    }
  }

  // Performance is OWNER-ONLY (owner's call 2026-07-29 — a manager gets no access to it).
  if (perfQ) out.performance = (((await perfQ).data || []) as any[]).find((x) => x.staff_id === id) || null;

  // ── THE SHARED PROFILE'S SHAPE (2026-08-06) ────────────────────────────────────────────────
  // The owner cockpit now opens the SAME component the admin console does
  // (components/admin/StaffProfile — docs/STAFF-PROFILE.md's one shape), so this answer speaks
  // that component's language as well as the older keys:
  //   person      the row (it reads d.person everywhere)
  //   payrollOn   whether the pay card exists at all for this restaurant
  //   activity    the "what they did lately" card — 20 rows, scoped to this person
  //   tree        what the RESTAURANT gives their role, which is the "(On)" inside "Default (On)"
  // `tree` replaces the capGroups array added a day earlier: the component derives its rows from
  // lib/staffCaps against this state, exactly as the admin's copy does, so the two cannot drift.
  // CREDS ARE STRIPPED. accessStateFor returns masked "••••1234" hints of a restaurant's Zomato /
  // Swiggy keys; nothing on a person's profile shows them, so they have no business travelling to
  // this browser at all.
  const tree = await treeQ;                       // started right after the gates, above
  if (tree) out.tree = { ...tree, creds: {} };
  out.person = acc.canSeePay ? person : withoutPay(person);
  out.payrollOn = acc.moduleOn === true;
  // ACTIVITY — the same rows, the same rules, the same gate as the owner's own Activity page
  // (/api/owner/oplog): the table is `staff_actions`; the admin's own actions and direct-database
  // footprints are excluded, so are app FAULTS and the raw button-tap breadcrumbs. And it is gated
  // by the SAME "logs" entitlement — a per-person feed that ignored it would be a way around a
  // switch Aevidine turned off, which is precisely what "hiding is never the only guard" forbids
  // in reverse. Switched off → an empty list plus a flag, so the card says so instead of claiming
  // this person has done nothing.
  const logsOn = await logsOnQ;                   // started right after the gates, above
  if (!logsOn) { out.activity = []; out.activityOff = true; }
  else {
    // The row-level `action` column is needed so the per-KIND switches can be applied here exactly
    // as they are on the Activity page — this card used to apply the page-level "logs" entitlement
    // and then show every kind, so a sign-in the admin had hidden was still visible one tap deeper.
    const acts = await rd("activity", () => sb.from("staff_actions")
      .select("action, detail, created_at, panel, restaurant_id")
      .eq("restaurant_id", u.restaurant_id).eq("actor_id", id)
      .not("panel", "in", "(admin,db)")
      .or("level.is.null,level.neq.error")
      .neq("action", "ui_taps")
      .order("created_at", { ascending: false }).limit(20));
    if (acts.error) {
      // An unread activity list must not read as "this person has done nothing" (T9 finding F6's
      // neighbour). No list, and a reason.
      out.activity = [];
      out.activityUnread = true;
      out.partial = [...((out.partial as string[]) || []), "logVisibility"];
    } else {
      // Per-KIND visibility, through the one module that fails CLOSED (T9 finding F23).
      const vis = await visQ;                     // started right after the gates, above
      if (!vis.ok) {
        out.activity = [];
        out.activityUnread = true;
        out.partial = [...((out.partial as string[]) || []), "logVisibility"];
      } else {
        out.activity = vis.visibility.filter((acts.data || []) as { restaurant_id?: string | null; action?: string | null }[]);
      }
    }
  }
  return ok(out);
}

// ── THE PERMISSION ROWS FOR ONE PERSON — the SAME rows Aevidine's profile shows ────────────
//
// Resolved SERVER-side and sent as plain rows (key · name · help · pin · editable · what the
// restaurant gives · what this person actually has). Two reasons it is done here rather than in
// the browser:
//   • the owner page used to carry its own hand-written waiter list, and it had drifted — three
//     rows missing (table types, khata, banquet) and khata greyed by the WRONG module, so the
//     screen offered a switch the server then refused. `lib/staffCaps` is the one list
//     (docs/STAFF-PROFILE.md), and deriving from it makes that drift impossible.
//   • the browser never needs the whole TreeState to draw a row, and that state carries
//     things an owner has no reason to receive. Only the answers travel.
//
// A row the restaurant doesn't have at all is dropped (`capVisible`) — the owner's rule: "if the
// feature is closed, it should not even be seen there". `editable:false` rows (an owner's own
// pages, the manager-settings sections) are restaurant-wide, so they are shown for context and
// carry no control — never a dropdown that saves nothing.
async function capGroupsFor(role: string, rid: string, permissions: Record<string, string> | null | undefined) {
  const st = await accessStateFor(rid);
  return capGroupsForRole(role)
    .map((g) => ({
      group: g.group,
      rows: g.caps.filter((c) => capVisible(c, st)).map((c) => ({
        key: c.key,
        name: c.node.name,
        what: c.node.what || null,
        pin: c.pin,
        editable: c.perPerson,
        roleDefault: roleDefault(c, st),
        effective: effectiveCap(c, st, permissions),
      })),
    }))
    .filter((g) => g.rows.length > 0);
}

// WHICH LOG THIS BELONGS IN. An action the ADMIN performed is recorded against the admin panel even
// when it was done from the owner's screens, so it lands in Aevidine's Everything Log and stays out
// of the owner's feed — the standing "admin = top power, INVISIBLY" rule, which these routes were
// leaking through `logAction("owner", …, { actor: "admin" })` (owner, 2026-08-12). Same decision as
// ownerLogPanel() in lib/ownerScope; it takes this file's own Scope instead of an OwnerScope.
const logPanel = (s: Extract<Scope, { ok: true }>): "owner" | "admin" => (s.actor === "admin" ? "admin" : "owner");

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

// ── NO SILENT OVERWRITES, ON THE OWNER'S SCREENS TOO (2026-08-05) ──────────────────────────
// "First save wins, and the loser is told" reached the admin's person profile on 2026-08-04 but
// not this route — so the SAME edit (a salary, a phone number, an emergency contact) was refused
// when two people clashed on Aevidine's screen and silently overwritten when they clashed on the
// owner's. Whose change survived depended on which screen they happened to open, which is exactly
// the coin-toss the rule exists to remove.
//
// Same shape as the panel dispatchers and the admin route: it does NOTHING unless the screen said
// what it was editing FROM (the X-LFH-Expect header), so a caller that hasn't opted in is
// unaffected. Always scoped to the target person's own restaurant.
async function noOverwrite(req: NextRequest, rid: string): Promise<Response | null> {
  const overwrite = await expectClash(req, rid);
  return overwrite ? clashJson(overwrite) : null;
}

// Resolve one target person + this caller's pay rights for their restaurant. Every
// profile/pay write goes through here, so scoping + the ladder are checked exactly once.
async function target(s: Extract<Scope, { ok: true }>, id: string) {
  const ids = s.restaurants.map((r) => r.id);
  // THIS IS A WRITE PATH, AND IT WAS THE WORST PLACE FOR THIS BUG (T9 finding F7, fixed 2026-08-12).
  // `target()` is the front door for every profile and pay write. The read's `.error` was ignored,
  // so a transient database failure while SAVING A SALARY answered "That person isn't on your
  // staff." with a 404 — wrong reason, and a status nothing retries, so the save was simply lost.
  const found = await rd("target", () => sb.from("staff_users")
    .select(`id, username, role, name, restaurant_id, profile, ${PROFILE_COLS}`)
    .eq("id", id).in("restaurant_id", ids).limit(1));
  if (found.error) return { err: transient() };
  const u = (found.data || [])[0] as any;
  if (!u) return { err: bad("That person isn't on your staff.", 404) };
  if (!assignableFor(s.actor).includes(u.role)) return { err: bad("You can't manage accounts at or above your own level.", 403) };
  const r = s.restaurants.find((x) => x.id === u.restaurant_id)!;
  const payMap = await payrollByRid([u.restaurant_id]);
  if (!payMap) return { err: transient() };   // see payrollByRid — a lost salary save is the cost
  const acc = payAccessWith(s.actor, r, payMap[u.restaurant_id] === true);
  if (!acc.moduleOn) return { err: bad("Staff profiles & pay aren't enabled for this restaurant.", 403) };
  if (!hasProfile(u.role)) return { err: bad("Kitchen logins don't have a profile or pay record.", 400) };
  return { u, acc };
}

// AT MOST ONCE. The manager panel's staff writes now travel through its offline queue like every
// other write there, so a replay after a lost reply must not create the same person twice (or
// re-run a reset/disable). No X-LFH-Action-Id header → passes straight through, unchanged.
// ── ONE PLACE THAT ANSWERS "MAY THIS MANAGER DO THAT TO A LOGIN?" ──────────────────────────────
// Lifted to module scope on 2026-08-20 because the CREATE gate lives in postImpl and the reset /
// disable gates live in patchImpl, and two copies of a permission check is how the two ends of one
// switch quietly stop agreeing.
//
// A GATE MUST FAIL CLOSED (T9 finding F9, fixed 2026-08-12). This used to ignore its read error, so
// a database blip made `cfg` null and handed the manager the DEFAULT power — a failure to read the
// restriction removed the restriction. `null` means "couldn't check" and every caller refuses with
// cantCheckPower(); every other rung in this file refuses on doubt, and so does this one now.
async function mgrStaffPower(
  s: Extract<Scope, { ok: true }>, key: MgrStaffPower, dflt: boolean,
): Promise<boolean | null> {
  if (s.actor !== "manager") return true;             // the owner and the admin are never narrowed
  const rid = s.restaurants[0]?.id;
  if (!rid) return false;
  const got = await rd("access_config", () => sb.from("restaurants").select("access_config").eq("id", rid).maybeSingle());
  if (got.error) return null;                         // couldn't check → the caller must refuse
  const cfg = (got.data as { access_config?: unknown } | null)?.access_config as
    { manage_staff?: { manager_opts?: Record<string, boolean> } } | null;
  const v = cfg?.manage_staff?.manager_opts?.[key];
  return typeof v === "boolean" ? v : dflt;
}
/** "couldn't check" → a retryable refusal, never a silent grant. */
const cantCheckPower = () => NextResponse.json(
  { error: "Couldn't check your staff access just now — please try again.", transient: true }, { status: 503 });

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
    await logAction(logPanel(s), "staff_payment", {
      restaurant_id: t.u.restaurant_id, actor: s.actor, actor_id: s.actorId,
      detail: `recorded ₹${p.amount} ${p.kind} for "${t.u.username}" (${p.mode}, paid ${p.paid_on})`,
    });
    return ok({ ok: true, payment: data });
  }

  // THE "ADD A NEW LOGIN" SWITCH (owner-approved 2026-08-20). The server has read this option since
  // 2026-08-01 and NOTHING ever called it — the one switch of the three with no call site at all, so
  // a restaurant that switched it off still had its manager adding people. Checked before any of the
  // work below, so a refusal costs one indexed read and writes nothing.
  const mayCreate = await mgrStaffPower(s, "create", true);
  if (mayCreate === null) return cantCheckPower();
  if (!mayCreate) return bad("Adding a new login isn't part of your staff access.", 403);

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
  const row: Record<string, unknown> = { username: key, role, restaurant_id: rid, ...(await passwordFields(password)), name: display, phone: String(body?.phone || "").trim().slice(0, 20) || null };
  // ── Fill the profile RIGHT HERE at creation (owner 2026-07-29: "while creating the user…
  //    make it almost perfect"). Every part is optional — an owner in a hurry still just types
  //    a name and a role. Personal details need the profile power; job & pay are owner/admin only.
  {
    const r = s.restaurants.find((x) => x.id === rid)!;
    const payMap = await payrollByRid([rid]);
    if (!payMap) return transient();          // see payrollByRid
    const acc = payAccessWith(s.actor, r, payMap[rid] === true);
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
  await logAction(logPanel(s), "staff_create", { restaurant_id: rid, actor: s.actor, actor_id: s.actorId, detail: `created ${role} "${display}"` });
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
    { const c = await noOverwrite(req, t.u.restaurant_id); if (c) return c; }
    // NO SILENT OVERWRITES — THE OWNER'S PROFILE PAGE TOO (sweep 2026-08-05, T9 finding 1).
    // /api/admin/users got this gate in the 2026-08-04 sweep, but the OWNER panel has its OWN
    // profile page (app/owner/staff/[id]/page.tsx) writing the SAME columns through THIS route —
    // including pay_amount. So the identical salary field was protected through one door and
    // wide open through the other: two co-owners setting different monthly pay a minute apart,
    // second one silently wins, and the first screen keeps showing a number that never landed.
    // Same one-line shape as every other dispatcher; a caller that sends no X-LFH-Expect is
    // unaffected.
    {
      const overwrite = await expectClash(req, String(t.u.restaurant_id || ""));
      if (overwrite) return clashJson(overwrite);
    }
    if (action === "set_profile") {
      if (!t.acc.canEditProfile) return bad("Your owner hasn't given managers permission to edit staff profiles.", 403);
      const patch = body?.profile;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return bad("Missing profile fields.");
      const merged = mergeProfilePatch(t.u.profile, patch as Record<string, unknown>, PROFILE_FIELDS);
      const { error } = await sb.from("staff_users").update({ profile: merged }).eq("id", id);
      if (error) return bad("Couldn't save those details — please try again.", 500);
      const changed = Object.keys(patch).slice(0, 8).join(", ");
      await logAction(logPanel(s), "staff_profile_edit", {
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
      await logAction(logPanel(s), "staff_job_edit", {
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
    await logAction(logPanel(s), "staff_own_pay_visibility", {
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
    await logAction(logPanel(s), on ? "payroll_add" : "payroll_remove", {
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
    await logAction(logPanel(s), "staff_payment_void", {
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
  // ── "I COULDN'T ASK" IS NOT "THEY AREN'T YOURS" — ON THE ACCOUNT ACTIONS TOO (T20 sweep #7,
  //    2026-08-27) ────────────────────────────────────────────────────────────────────────────────
  // Finding F7 (2026-08-12) fixed exactly this read in `staffDetail()` and in `target()`, both of
  // which now go through `rd()` and answer `transient()`. THIS read — the one behind
  // reset_password / set_active / set_role / set_permissions / edit — was left as `.data?.[0]`, so a
  // database blip still answered "That person isn't on your staff." with a 404: the wrong reason (it
  // reads as a scoping or hierarchy problem and sends the owner looking for one), and a status no
  // client retries, so resetting a password or switching a login off during a blip is silently lost.
  const uq = await rd("account", () => sb.from("staff_users")
    .select("id, username, role, restaurant_id, token_version, permissions")
    .eq("id", id).in("restaurant_id", ids).limit(1));
  if (uq.error) return transient();
  const u = (uq.data || [])[0] as { id: string; username: string; role: Role; restaurant_id: string; token_version: number | null; permissions: unknown } | undefined;
  if (!u) return bad("That person isn't on your staff.", 404);
  // Hierarchy: the TARGET must be below the actor's level — a manager can never
  // touch another manager's (or an owner's) account, in any way.
  if (!assignableFor(s.actor).includes(u.role)) return bad("You can't manage accounts at or above your own level.", 403);
  { const c = await noOverwrite(req, String(u.restaurant_id || "")); if (c) return c; }

  // The same gate for the account actions below — `edit` types a name and a phone number into a
  // box, which is a value edit by the same rule (see the note in the profile branch above).
  // reset_password / set_active / set_role / set_permissions send no expectation, so they are
  // untouched: each is a transition whose second attempt the handler already answers for itself.
  {
    const overwrite = await expectClash(req, String(u.restaurant_id || ""));
    if (overwrite) return clashJson(overwrite);
  }

  // A MANAGER'S FINER STAFF POWERS (owner, 2026-08-01; FINISHED 2026-08-20). "Manage staff" used to
  // be one yes covering creating a login, resetting somebody's password and switching them off.
  // Those are three very different amounts of trust, so each is its own switch
  // (access_config.manage_staff.manager_opts.*). The OWNER and the admin are unaffected — this
  // only ever narrows a manager, and an unset option keeps the row's own default (open).
  //
  // FOR TWO AND A HALF WEEKS THIS WAS HALF-BUILT and T20 found it: only `reset_pw` had a call site,
  // and NO node in lib/accessTree.ts wrote the path at all, so the switches existed on the server
  // and nowhere else. All three now have both ends — a row under Access & permissions → Manager
  // settings → Users, and a gate here.
  //
  // The stub's fourth key, `delete`, is GONE rather than finished: deleting a login is refused for a
  // manager outright in deleteImpl below (owner, 2026-08-02 — "it can disable the user, it can't
  // delete the user"), so a switch for it would have been a box arguing with a decided rule.
  // A GATE MUST FAIL CLOSED (T9 finding F9, fixed 2026-08-12). This ignored its read error, so a
  // database blip made `cfg` null and handed the manager the DEFAULT power — i.e. a failure to read
  // the restriction removed the restriction. `null` is now returned for "couldn't check", and the
  // caller refuses. Every other rung in this file refuses on doubt; these two allowed on doubt.
  const mgrStaffOpt = (key: MgrStaffPower, dflt: boolean) => mgrStaffPower(s, key, dflt);

  if (action === "reset_password") {
    const mayReset = await mgrStaffOpt("reset_pw", true);
    if (mayReset === null) return cantCheckPower();
    if (!mayReset) return bad("Resetting a password isn't part of your staff access.", 403);
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    if (password.length > 128) return bad("Password is too long (max 128 characters).");
    // Capture the write error: without this, a failed UPDATE (row lock / timeout) still
    // returned {ok:true, password} — the owner read out a password the DB never saved, so
    // the staffer couldn't log in and the OLD password still worked (audit 2026-07-07).
    const { error } = await sb.from("staff_users").update({ ...(await passwordFields(password)), token_version: (u.token_version || 0) + 1, failed_count: 0, locked_until: null }).eq("id", id);
    if (error) return bad("Couldn't reset the password — please try again.", 500);
    await logAction(logPanel(s), "staff_reset_password", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `reset "${u.username}"` });
    return ok({ ok: true, password });
  }
  if (action === "set_active") {
    // Must be a REAL boolean — the old `!!body?.active` silently coerced junk (e.g.
    // active:"false" is a truthy string → enabled), flipping state the wrong way.
    if (typeof body?.active !== "boolean") return bad("`active` must be true or false.");
    const active = body.active;
    // THE "SWITCH A LOGIN OFF" SWITCH (owner-approved 2026-08-20 — see mgrStaffOpt above). Only the
    // OFF direction is gated: taking someone's access away is the act of trust this switch is about,
    // and a manager who may not do it must not be able to strand a waiter mid-shift. Turning a login
    // back ON is the undo, and refusing the undo while allowing nothing is a state nobody wants.
    if (!active) {
      const mayDisable = await mgrStaffOpt("disable", true);
      if (mayDisable === null) return cantCheckPower();
      if (!mayDisable) return bad("Switching a login off isn't part of your staff access.", 403);
    }
    const { error } = await sb.from("staff_users").update({ active, token_version: active ? u.token_version : (u.token_version || 0) + 1 }).eq("id", id);
    if (error) return bad("Couldn't update that account — please try again.", 500);
    await logAction(logPanel(s), active ? "staff_enable" : "staff_disable", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `${active ? "enabled" : "disabled"} "${u.username}"` });
    return ok({ ok: true });
  }
  if (action === "set_role") {
    const role = String(body?.role || "") as Role;
    // Hierarchy: the NEW role must also stay below the actor (a manager can't
    // promote someone up to manager).
    if (!assignableFor(s.actor).includes(role)) return bad("Pick a valid role.");
    const { error } = await sb.from("staff_users").update({ role, token_version: (u.token_version || 0) + 1 }).eq("id", id);
    if (error) return bad("Couldn't change the role — please try again.", 500);
    await logAction(logPanel(s), "staff_set_role", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `set "${u.username}" → ${role}` });
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
    // ONE LIST, derived from lib/staffCaps for the ROLE being edited (2026-08-04). It used to be
    // two hand-picked constants — TABLET_PERM_KEYS + MANAGER_POWER_FLAGS — and they had already
    // drifted from the rows the Access screen shows: `delete_bill` is a manager row on that screen
    // and is genuinely enforced by canDeleteBill(), but MANAGER_POWER_FLAGS does not contain it, so
    // this route answered `Unknown permission "delete_bill"`. The admin's Per-person tab posts
    // here, so tapping On for one manager said "That change didn't save" — while the identical
    // dropdown inside that person's profile (which allow-lists from staffCaps) saved fine. Deriving
    // both routes from the same list is what makes those two screens impossible to disagree again.
    const roleCaps = capsForRole(u.role).filter((c) => c.perPerson);
    const capByKey = new Map(roleCaps.map((c) => [c.key, c]));
    // Which family a key belongs to still decides the extra rules below.
    const isTabletKey = (k: string) => k.startsWith("tablet_") || k.startsWith("cap:");
    const patch = body?.permissions;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return bad("Missing permissions object.");
    const merged: Record<string, string> = { ...(u.permissions && typeof u.permissions === "object" ? u.permissions : {}) };
    const noted: string[] = [];
    // (The `owner_entitlements` loader that used to sit here is GONE — T20 sweep #7, 2026-08-27.
    //  It was the memo for `powerEntitled(power_<flag>)`, the rung the T6 pass removed on
    //  2026-08-06 when the grant check below moved to `access_config[flag].on`. Nothing has called
    //  it since: a never-invoked closure holding a never-run database read, sitting three lines
    //  above the check that replaced it — which is the shape that makes the next reader believe
    //  entitlements are still consulted here. See the note on the feature gate below.)
    for (const [k, v] of Object.entries(patch)) {
      const cap = capByKey.get(k);
      if (!cap) return bad(`"${k}" isn't a permission a ${u.role} has.`);
      const isTablet = isTabletKey(k);
      if (v === null || v === "" || v === "default") { delete merged[k]; noted.push(`${k}→default`); continue; }
      // The PIN state exists only where the row itself offers it (money rows) — the model says
      // which, so a floor row can't be set to "pin" and silently behave as "on".
      const modes = cap.pin ? ["on", "pin", "off"] : ["on", "off"];
      if (!modes.includes(String(v))) return bad(`"${k}" can only be set to ${modes.join(", ")} — or left unset, to go back to the default.`);
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
          // The admin's "may this restaurant have this power at all" rung is
          // access_config[flag].on — the Feature half of the row on the Access screen — and
          // managerCan() enforces it on every request this override could ever affect. It used to
          // be checked here as powerEntitled(power_<flag>), a key nothing has been able to write
          // since the old ladder went, so the refusal could never fire. (sweep T6, 2026-08-06)
          // FAIL CLOSED (T9 finding F9). This read's error was ignored, so `feat` came back null on a
          // blip, `feat?.[k]?.on === false` was false, and the grant went through — for a feature the
          // admin had switched OFF for that restaurant. A permission is the last thing that may be
          // handed out because a query happened to fail.
          const featRead = await rd("feature_gate", () =>
            sb.from("restaurants").select("access_config").eq("id", u.restaurant_id).maybeSingle());
          if (featRead.error) return cantCheckPower();
          const feat = (featRead.data as { access_config?: unknown } | null)?.access_config as
            Record<string, { on?: boolean }> | null;
          if (feat?.[k]?.on === false)
            return bad("That feature is switched off for this restaurant by the admin — you can't grant it.", 403);
        }
      }
      merged[k] = String(v); noted.push(`${k}→${v}`);
    }
    if (!noted.length) return bad("Nothing to change.");
    const { error } = await sb.from("staff_users").update({ permissions: merged }).eq("id", id);
    if (error) return bad("Couldn't update permissions — please try again.", 500);
    await logAction(logPanel(s), "staff_set_permissions", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `"${u.username}": ${noted.join(", ")}` });
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
    // THE ONE CHANGE HERE THAT STOPS SOMEONE SIGNING IN, AND IT WAS UNRECORDED (T9 sweep,
    // 2026-08-06). `username` IS the login key (normalizeLoginName, unique per restaurant), so a
    // rename means the name that person has always typed no longer works. Every sibling action in
    // this handler logs — staff_create, staff_reset_password, staff_enable/disable, staff_set_role,
    // staff_set_permissions, staff_profile_edit, staff_job_edit, staff_delete — and this one didn't,
    // so "my login stopped working" had no answer anywhere in the Activity log.
    // BOTH names are recorded, because the OLD one is what the person will tell you they were using.
    // (The admin's twin at app/api/admin/users `edit` stays deliberately unlogged — admin actions
    // are kept out of this log on purpose, per the standing "admin = top power, invisibly" rule.)
    if (patch.username && patch.username !== u.username) {
      await logAction(logPanel(s), "staff_rename", {
        restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId,
        detail: `login name "${u.username}" → "${patch.username}"${patch.phone !== undefined ? " (phone also updated)" : ""}`,
      });
    } else if (patch.phone !== undefined) {
      await logAction(logPanel(s), "staff_profile_edit", {
        restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId,
        detail: `updated "${u.username}" phone number`,
      });
    }
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
  // Same rule as patchImpl above (F7's third and fourth reads): a blip must not read as "they
  // aren't yours", least of all on the one action that removes an account for good.
  const dq = await rd("account", () => sb.from("staff_users").select("username, role, restaurant_id").eq("id", id).in("restaurant_id", ids).limit(1));
  if (dq.error) return transient();
  const u = (dq.data || [])[0] as { username: string; role: string; restaurant_id: string } | undefined;
  if (!u) return bad("That person isn't on your staff.", 404);
  // Hierarchy: can only delete accounts BELOW your level (see assignableFor).
  if (!assignableFor(s.actor).includes(u.role as Role)) return bad("You can't manage accounts at or above your own level.", 403);
  // A person with pay history is never deleted — see payHistoryBlocksDelete(). Same rule and same
  // wording as the admin route, because the ledger is just as unrecoverable from either screen.
  const pay = await payHistoryBlocksDelete(sb, id);
  if (pay.blocked) return bad(PAY_HISTORY_DELETE_MESSAGE(pay.count), 409);
  const { error } = await sb.from("staff_users").delete().eq("id", id);
  if (error) return bad("Couldn't remove that account — please try again.", 500);
  await logAction(logPanel(s), "staff_delete", { restaurant_id: u.restaurant_id, actor: s.actor, actor_id: s.actorId, detail: `deleted "${u.username}"` });
  return ok({ ok: true });
}
