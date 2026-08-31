// /api/admin/restaurants — the admin super-panel's Restaurants tab.
//   GET   → every restaurant {id, slug, name, active, hasSettings, ownerUserId, ownerName}
//           + the list of existing owners (to pick from). Admin-gated.
//   PATCH → { restaurant_id, owner_user_id|null }  assign / clear a restaurant's OWNER.
//   POST  → { action:"create_owner", name, password? }  mint a new owner login
//           (role=owner; returned password shown ONCE). Admin then assigns it above.
// Admin-gated (STAFF_PASSWORD cookie, same as the rest of /aevinite), service role.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { normalizeLoginName } from "@/lib/userAuth";
import { passwordFields } from "@/lib/passwordVault";
import { resolveOwnerHomeRid, nameTakenMessage } from "@/lib/ownerHome";
import { logAction } from "@/lib/oplog";
import { loadStarterMenu, toCategoryRows, toFilterRows, toItemRows } from "@/lib/starterMenu";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { MP_DEFAULT } from "@/lib/accessConfig";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";
// Read every row of a one-row-per-restaurant table, past PostgREST's cap — see lib/pageAll.ts.
import { pageAll } from "@/lib/pageAll";

// The remembered "New restaurant" setup (panels + sample-menu), stored in
// app_config (mig 186) so the create form auto-fills from the admin's last choice.
const CREATE_DEFAULTS_KEY = "restaurant_creation_defaults";

export const dynamic = "force-dynamic";
const DEFAULT_RID = "00000000-0000-0000-0000-000000000001";
const ok = (d: any, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── THE RECYCLE BIN NO LONGER LOCKS THE DOOR (owner, 2026-08-20) ──────────────────────────────
// It used to be a 90-DAY WAIT: a binned restaurant could only be permanently removed once 90 days
// had passed, enforced here AND in the SQL function admin_purge_restaurant (mig 128), with no
// override anywhere. His instruction: *"i wanna chnage the rule that you camn't permamnetly delete
// from recycle bin what i wanna do is you can able to dlete from recycyle bin"* — the bin is his
// own console, on his own platform, and waiting three months to clear out a restaurant he deleted
// this morning is a lock he never wanted. Migration 342 drops the SQL half of it.
//
// WHAT DID **NOT** GO WITH IT, because none of it was the thing he objected to:
//   · type-the-exact-name to confirm, and the offer to download a full backup first;
//   · the money is still KEPT (mig 309) — bills, invoices, payments and credit notes survive a
//     purge and stay readable in the Bills ledger. A sale can never disappear
//     (docs/COMPLIANCE-GUARDRAILS.md §3.0), and removing a restaurant was never a route around it;
//   · restaurant #1 (the default) can still never be purged;
//   · the purge is still written to the admin's own audit trail.
// `daysHeld` below replaces `daysLeft`: the bin now REPORTS how long something has sat there
// instead of counting down to a permission.
const RETENTION_DAYS = 0;

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);

  // ── ?bin_detail=<rid> — WHAT IS ACTUALLY INSIDE A BINNED RESTAURANT (owner, 2026-08-20) ──────
  // *"when you click owner and resrurant in recycle bin you could able to see inside it"*. Before
  // this the bin was a name, a date and two buttons: nothing told him whether the thing he was
  // about to remove for good was an empty test restaurant or a real one with six months of trade
  // in it. Permanent removal is the one irreversible button in the console, and he had to press it
  // blind.
  //
  // EGRESS: every figure here is a HEAD COUNT — `select("id", { count: "exact", head: true })`
  // scoped `.eq("restaurant_id", rid)` — so the database returns a number and no rows at all. The
  // only real rows read are the settings cell and up to 12 owner names. It runs once, when he
  // opens a row, and never polls.
  //
  // NO MONEY FIGURES, deliberately. The admin console does not show a tenant's takings anywhere
  // (the same rule the Full report states in its own header), and "what is in the bin" is not the
  // exception. It reports HOW MANY bills are kept, never what they came to.
  {
    const detailRid = new URL(req.url).searchParams.get("bin_detail");
    if (detailRid) {
      if (!UUID.test(detailRid)) return bad("Restaurant not found.", 404);
      const rQ = await sb.from("restaurants")
        .select("id, name, slug, active, created_at, deleted_at, deleted_by, delete_reason, purged_at, owner_user_id")
        .eq("id", detailRid).limit(1);
      if (rQ.error) return adminFail("what is inside this restaurant", rQ.error, { action: "load" });
      const r = rQ.data?.[0];
      if (!r) return bad("Restaurant not found.", 404);

      const [ownersQ, setQ, catsQ, dishesQ, staffQ, ordersQ, sessionsQ, custQ, khataQ, feedbackQ] = await Promise.all([
        sb.from("restaurant_owners").select("user_id").eq("restaurant_id", detailRid).limit(12),
        sb.from("settings").select("table_count, enabled_panels").eq("restaurant_id", detailRid).maybeSingle(),
        // EVERY COUNT NAMES `restaurant_id`, NOT `id`. Found live before this shipped: `categories`
        // and `customers` have no `id` column, so counting on it failed — and because a head-count
        // response carries NO BODY, PostgREST's explanation comes back EMPTY. The row would have
        // shown "?" for those two forever with nothing anywhere saying why. `restaurant_id` is the
        // column being filtered on, so it is present on all of these by definition.
        sb.from("categories").select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", detailRid),
        sb.from("menu_items").select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", detailRid),
        sb.from("staff_users").select("role").eq("restaurant_id", detailRid).is("deleted_at", null).limit(500),
        sb.from("orders").select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", detailRid).is("deleted_at", null),
        sb.from("sessions").select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", detailRid),
        sb.from("customers").select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", detailRid),
        // Bills still parked on somebody's tab. mig 309's predicate, so this can never disagree
        // with what Pay Later shows — a COUNT, not a total: the console never prints their money.
        sb.from("orders").select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", detailRid)
          .not("khata_at", "is", null).neq("payment_status", "paid").neq("status", "cancelled").is("deleted_at", null),
        sb.from("feedback").select("restaurant_id", { count: "exact", head: true }).eq("restaurant_id", detailRid),
      ]);
      // A figure that could not be read says so rather than drawing a confident 0 — the same rule
      // the Full report adopted (T20 item 14). This screen decides a PERMANENT DELETE, so a 0 that
      // really means "couldn't read it" is the worst possible thing for it to print.
      const unread: string[] = [];
      const n = (q: { count?: number | null; error: unknown }, key: string): number | null => {
        if (q.error) { console.error(`[admin/bin_detail] ${key} failed:`, (q.error as { message?: string })?.message); unread.push(key); return null; }
        return q.count || 0;
      };
      let ownerNames: { id: string; name: string; binned: boolean }[] = [];
      if (ownersQ.error) unread.push("owners");
      else {
        const ids = (ownersQ.data || []).map((o) => o.user_id).filter(Boolean);
        if (ids.length) {
          const uQ = await sb.from("staff_users").select("id, name, username, deleted_at").in("id", ids).limit(12);
          if (uQ.error) unread.push("owners");
          else ownerNames = (uQ.data || []).map((u) => ({ id: u.id, name: u.name || u.username, binned: !!u.deleted_at }));
        }
      }
      const staffByRole: Record<string, number> = {};
      if (staffQ.error) unread.push("staff");
      else for (const st of staffQ.data || []) staffByRole[st.role] = (staffByRole[st.role] || 0) + 1;

      return ok({
        restaurant: {
          id: r.id, name: r.name, slug: r.slug, active: r.active === true,
          createdAt: r.created_at || null, deletedAt: r.deleted_at, deletedBy: r.deleted_by || null,
          reason: r.delete_reason || null, purged: !!r.purged_at,
        },
        owners: ownerNames,
        inside: {
          categories: n(catsQ, "categories"),
          dishes: n(dishesQ, "dishes"),
          staff: staffQ.error ? null : (staffQ.data || []).length,
          staffByRole,
          tables: setQ.error ? null : Number(setQ.data?.table_count) || 0,
          panels: setQ.error ? null : ((setQ.data as { enabled_panels?: Record<string, boolean> | null } | null)?.enabled_panels || null),
          orders: n(ordersQ, "orders"),
          sessions: n(sessionsQ, "sessions"),
          savedCustomers: n(custQ, "savedCustomers"),
          unpaidPayLaterBills: n(khataQ, "unpaidPayLaterBills"),
          feedback: n(feedbackQ, "feedback"),
        },
        ...(setQ.error ? { settingsUnread: true } : {}),
        ...(unread.length ? { unread } : {}),
      });
    }
  }

  // ?deleted=1 → the RECYCLE BIN: only trashed restaurants, with how long each has sat there.
  // Kept separate from the main list so a deleted restaurant never leaks back into the live table.
  if (new URL(req.url).searchParams.get("deleted") === "1") {
    // A PURGED RESTAURANT IS NOT IN THE BIN ANY MORE (T20 sweep, 2026-08-16).
    //
    // Migration 309 changed the purge so the restaurants ROW SURVIVES, marked `purged_at`, because
    // its bills hang off it and those are kept for the 6-8 year retention. Nothing on this side was
    // ever taught about that column, so the bin still listed the row: pressing "Delete permanently"
    // appeared to do nothing (the row came back, still "Ready to purge"), a second press showed the
    // raw `already been purged` exception, and "Restore" brought back a shell with no menu, no
    // staff, no settings and no owner. Filtering it here is what makes the purge look like what it
    // is — gone from every list a person can see.
    // ── ONE-ROW-PER-RESTAURANT, SO IT IS PAGED — THE COMBINED VERSION (T16 + T20, 2026-08-31) ────
    // Two sessions fixed this independently and reached different answers. T16 (2026-08-29) added
    // `.limit(2000)` with the right reasoning: "one row per restaurant makes it small today, but it
    // grows with exactly the number this product is built to increase" — egress is this product's
    // cost, and a console read with no ceiling gets expensive quietly. T20 (2026-08-27) moved it onto
    // lib/pageAll.
    //
    // PAGING WINS, and T16's concern is fully answered by it: pageAll costs NO extra round trip below
    // a thousand restaurants, so the cost argument is neutral — and `.limit(2000)` merely moves the
    // silent cut from PostgREST's default to ours. lib/pageAll.ts's own header names this exact case
    // ("USE IT for a table with ONE ROW PER RESTAURANT that must be complete: restaurants,
    // restaurant_billing, settings"), it refuses past 50,000 rather than truncating, and it can never
    // return a partial list with no error. The recycle bin is a list a person acts on, and a bin that
    // silently stops listing is how something gets permanently removed that nobody meant to touch.
    const binQ = await pageAll<{ id: string; slug: string; name: string; deleted_at: string; deleted_by: string | null; delete_reason: string | null; purged_at: string | null }>(
      "restaurants (bin)", (from, to) => sb.from("restaurants").select("id, slug, name, deleted_at, deleted_by, delete_reason, purged_at")
        .not("deleted_at", "is", null).is("purged_at", null).order("deleted_at", { ascending: false }).range(from, to));
    // Plain sentence to the screen, raw text to `detail` + the log — see lib/adminFail.
    if (binQ.error) return adminFail("the recycle bin", binQ.error as { message?: string }, { action: "load" });
    const now = Date.now();
    const trashed = (binQ.rows || []).map((r) => {
      const deletedAt = r.deleted_at as string;
      // How long it has SAT here — a fact, not a permission. `canPurge` is now always true (the
      // default restaurant is the one thing the purge itself still refuses, and it can't be binned
      // in the first place), and `daysLeft` is gone rather than left lying at 0 for a screen to
      // render as "0 days left". Both fields kept their names where they still mean something.
      const daysHeld = Math.max(0, Math.floor((now - new Date(deletedAt).getTime()) / 86400000));
      return {
        id: r.id, slug: r.slug, name: r.name,
        deletedAt, deletedBy: r.deleted_by || null, reason: r.delete_reason || null,
        daysHeld, canPurge: true,
      };
    });
    return ok({ trashed, retentionDays: RETENTION_DAYS });
  }

  // Paged for the reason spelled out on the recycle-bin read above (T16 + T20, 2026-08-31).
  // (`staff_users` filtered to active OWNERS is not one-row-per-restaurant, but it is the same shape
  //  of small complete list, and the dropdown it fills has to hold every owner or you cannot assign
  //  one — so it is paged too.)
  const [restQ, setQ, ownersQ] = await Promise.all([
    // deleted_at IS NULL → the live/suspended list; trashed restaurants are hidden
    // here (they live in the recycle bin above).
    pageAll<{ id: string; slug: string; name: string; active: boolean; owner_user_id: string | null; created_at: string | null }>(
      "restaurants", (from, to) => sb.from("restaurants").select("id, slug, name, active, owner_user_id, created_at")
        .is("deleted_at", null).order("name").range(from, to)),
    // enabled_panels rides along (tiny JSONB) so the admin home can show each
    // restaurant's M/K/T/O panel chips WITHOUT a per-row fetch. Read-only add.
    pageAll<{ restaurant_id: string | null; enabled_panels: Record<string, boolean> | null }>(
      "settings", (from, to) => sb.from("settings").select("restaurant_id, enabled_panels").order("restaurant_id").range(from, to)),
    pageAll<{ id: string; name: string | null; username: string }>(
      "owners", (from, to) => sb.from("staff_users").select("id, name, username").eq("role", "owner").eq("active", true).order("name").range(from, to)),
  ]);
  if (restQ.error) return adminFail("the restaurant list", restQ.error as { message?: string }, { action: "load" });
  // ── THE OWNER COLUMN WENT BLANK AND NOTHING SAID WHY (T20 sweep #7, 2026-08-27) ─────────────────
  // Only `restQ` answered for itself. The other two are what the list is actually made of:
  //   · `ownersQ` fills BOTH the owner-picker dropdown and the per-row owner name, so a failed read
  //     drew "—" in the Owner column of every restaurant that HAS one — a confident "nobody owns
  //     this" on the screen where the admin assigns ownership — and an empty dropdown to fix it with.
  //   · `setQ` decides `hasSettings` and the M/K/T/O panel chips, so a failed read reported every
  //     restaurant as un-set-up with no panels.
  // Neither is worth throwing the whole list away for — the names, slugs and active flags are all
  // perfectly readable — so they degrade and NAME themselves, the same `partial` convention this
  // console's own Full report adopted (`/api/admin/restaurants/report`, T20 item 14).
  const unread: string[] = [];
  if (setQ.error) { console.error("[admin/restaurants] settings read failed:", (setQ.error as { message?: string })?.message); unread.push("panels"); }
  if (ownersQ.error) { console.error("[admin/restaurants] owners read failed:", (ownersQ.error as { message?: string })?.message); unread.push("owners"); }
  const withSettings = new Set((setQ.rows || []).map((r) => r.restaurant_id).filter(Boolean));
  const panelsByRid = new Map((setQ.rows || []).map((r) => [r.restaurant_id, r.enabled_panels || null]));
  const owners = (ownersQ.rows || []).map((o) => ({ id: o.id, name: o.name || o.username }));
  const ownerName = new Map(owners.map((o) => [o.id, o.name]));
  const restaurants = (restQ.rows || []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    createdAt: r.created_at || null, // lets the list tell "New" (just set up) from long-Dormant
    hasSettings: withSettings.has(r.id),
    ownerUserId: r.owner_user_id || null,
    // `null` when the name could not be READ, so the screen shows nothing rather than the "—" it
    // draws for a genuinely un-owned restaurant. `unread` below is what lets it say so.
    ownerName: r.owner_user_id ? (ownersQ.error ? null : (ownerName.get(r.owner_user_id) || "—")) : null,
    // Panel flags: a panel is ON unless explicitly false (matches /panels route semantics).
    panels: panelsByRid.get(r.id) || null,
  }));
  return ok({ restaurants, owners, ...(unread.length ? { unread } : {}) });
}

export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const rid = String(body?.restaurant_id || "");
  if (!rid) return bad("Missing restaurant_id.");
  // Shape-checked before it reaches a uuid column, like every sibling admin route — otherwise a
  // stale link produces a raw Postgres 500 body instead of the tidy "Restaurant not found." below.
  if (!UUID.test(rid)) return bad("Restaurant not found.", 404);
  // owner_user_id may be a uuid (assign) or null/"" (clear the owner).
  const raw = body?.owner_user_id;
  const ownerId = raw == null || raw === "" ? null : String(raw);
  if (ownerId) {
    if (!UUID.test(ownerId)) return bad("That user isn't an owner.", 400);
    const owner = (await sb.from("staff_users").select("id, name").eq("id", ownerId).eq("role", "owner").limit(1)).data?.[0];
    if (!owner) return bad("That user isn't an owner.", 400);
  }
  // The PRIMARY owner is stored on the restaurant (display / back-compat); the
  // SCOPING source of truth is the restaurant_owners join table (migration 097).
  // This dropdown sets a SINGLE primary owner, so we must keep the two in sync:
  // read the CURRENT primary, swap it in the join table, and leave any hand-added
  // co-owners (a different user_id) untouched. Skipping this would let the OLD
  // primary keep seeing this restaurant after a reassign/clear — the exact
  // cross-owner leak we must prevent now that scope reads the join table.
  // ── "SAVED" MUST MEAN SAVED (T20 sweep item 15, owner-approved 2026-08-20) ──────────────────
  // This read was already here, but only its `.data` was used: an unknown-but-valid uuid made
  // `prev` undefined, the UPDATE below matched 0 rows, and the handler still answered {ok:true}.
  // The console said "Saved" and the owner still could not see the restaurant — the same silent-
  // success shape the branding route was fixed for on 2026-07-06. A FAILED read is now told apart
  // from a MISSING row, because answering "not found" on a blip would be its own lie.
  const prevQ = await sb.from("restaurants").select("owner_user_id, name").eq("id", rid).limit(1);
  if (prevQ.error) return adminFail("this restaurant's owner", prevQ.error, { action: "load" });
  const prev = prevQ.data?.[0];
  if (!prev) return bad("Restaurant not found — it may have been removed. Reload the list and try again.", 404);
  const oldOwner = (prev?.owner_user_id as string | null) || null;
  const { error } = await sb.from("restaurants").update({ owner_user_id: ownerId }).eq("id", rid);
  if (error) return adminFail("this restaurant's owner", error, { action: "save" });
  // Remove the PREVIOUS primary's membership if it's being replaced/cleared
  // (leave it if it's the same user we're re-assigning, and never touch co-owners).
  if (oldOwner && oldOwner !== ownerId) {
    // This delete is the SECURITY-CRITICAL write: it revokes the previous owner's
    // scope. If it silently fails the old owner keeps seeing this restaurant — the
    // cross-owner leak we must never ship — so surface the error instead of swallowing it.
    const del = await sb.from("restaurant_owners").delete().eq("restaurant_id", rid).eq("user_id", oldOwner);
    if (del.error) return adminFail("this restaurant's owner", del.error, { action: "save" });
  }
  // Add the NEW primary's membership (idempotent — composite PK + ignoreDuplicates).
  if (ownerId) {
    await sb.from("restaurant_owners").upsert({ restaurant_id: rid, user_id: ownerId }, { onConflict: "restaurant_id,user_id", ignoreDuplicates: true });
  }
  await logAction("admin", "restaurant_set_owner", { restaurant_id: rid, actor: "admin", detail: ownerId ? `assigned owner ${ownerId}` : "cleared owner" });
  return ok({ ok: true, ownerUserId: ownerId });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const action = String(body?.action || "");

  // ── set_restaurant_active — the platform kill switch (owner 2026-07-04: "where is
  // the button to suspend?"). active=false stops the tenant resolver serving the
  // guest menu; the admin can still reach every panel via act-as to inspect/fix. ──
  if (action === "set_restaurant_active") {
    const rid = String(body?.restaurant_id || "");
    const active = !!body?.active;
    if (!rid) return bad("Missing restaurant_id.");
    if (!UUID.test(rid)) return bad("Restaurant not found.", 404);
    // A FAILED READ IS NOT "NOT FOUND" — the rule this file's own purge branch states, applied to the
    // three siblings that were left deciding a refusal from an unchecked `.data` (T20 sweep #7,
    // 2026-08-27). Answering "Restaurant not found." on a blip sends the admin looking for a row that
    // is right there, and no client retries a 404.
    const rQ0 = await sb.from("restaurants").select("id, name").eq("id", rid).limit(1);
    if (rQ0.error) return adminFail("this restaurant", rQ0.error, { action: "load" });
    const r = rQ0.data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    const { error } = await sb.from("restaurants").update({ active }).eq("id", rid);
    if (error) return adminFail(active ? "reactivating this restaurant" : "suspending this restaurant", error, { action: "save" });
    await logAction("admin", active ? "restaurant_reactivate" : "restaurant_suspend", { restaurant_id: rid, actor: "admin", detail: `${r.name} ${active ? "reactivated" : "suspended"}` });
    return ok({ ok: true, active });
  }

  // ── soft_delete_restaurant — move a restaurant to the 90-day RECYCLE BIN. It
  // disappears from the guest menu (resolver returns null → 404) and staff can no
  // longer log in, but nothing is erased. Reversible via restore for 90 days, then
  // purgeable. Restaurant #1 (the default) can never be binned. ─────────────────
  if (action === "soft_delete_restaurant") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    if (rid === DEFAULT_RID) return bad("The default restaurant can't be deleted.", 400);
    const reason = String(body?.reason ?? "").trim().slice(0, 300) || null;
    if (!UUID.test(rid)) return bad("Restaurant not found.", 404);
    const rQ1 = await sb.from("restaurants").select("id, name, deleted_at").eq("id", rid).limit(1);
    if (rQ1.error) return adminFail("this restaurant", rQ1.error, { action: "load" });   // see set_restaurant_active
    const r = rQ1.data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    if (r.deleted_at) return bad("That restaurant is already in the recycle bin.", 409);
    // deleted_at drives the resolver + login gates; active=false too so nothing
    // (e.g. a cached panel session) treats a binned restaurant as live.
    const { error } = await sb.from("restaurants")
      .update({ deleted_at: new Date().toISOString(), deleted_by: "admin", delete_reason: reason, active: false })
      .eq("id", rid);
    if (error) return adminFail("moving this restaurant to the recycle bin", error, { action: "save" });
    await logAction("admin", "restaurant_soft_delete", { restaurant_id: rid, actor: "admin", detail: `${r.name} moved to recycle bin${reason ? ` · reason: ${reason}` : ""}` });
    return ok({ ok: true, deleted: true });
  }

  // ── restore_restaurant — bring a binned restaurant back. It returns SUSPENDED
  // by default (active=false) so it can't silently go live; pass activate:true to
  // reactivate it in one step. Clears the recycle-bin fields. ───────────────────
  if (action === "restore_restaurant") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    const activate = body?.activate === true;
    if (!UUID.test(rid)) return bad("Restaurant not found.", 404);
    const rQ2 = await sb.from("restaurants").select("id, name, slug, deleted_at, purged_at").eq("id", rid).limit(1);
    if (rQ2.error) return adminFail("this restaurant", rQ2.error, { action: "load" });   // see set_restaurant_active
    const r = rQ2.data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    if (!r.deleted_at) return bad("That restaurant isn't in the recycle bin.", 409);
    // Restoring a PURGED restaurant would hand back a shell — its menu, staff, settings and owner
    // links were deleted at purge time and only the bills were kept (mig 309). Refuse it in words,
    // rather than quietly returning an empty restaurant to the live list (T20 sweep, 2026-08-16).
    if (r.purged_at) return bad("This restaurant was permanently removed — its menu, staff and settings are gone, so it can't be brought back. Its bills are still on record in the Bills ledger.", 409);
    // ── THE NAME MAY HAVE BEEN TAKEN WHILE IT SAT IN THE BIN ──────────────────────────────────
    // Since mig 319 only a LIVE restaurant reserves a web address, so a name freed by binning can
    // be handed to somebody else — and restoring then collides on the unique index.
    //
    // THIS USED TO RENAME THE RETURNING RESTAURANT SILENTLY (aangan → aangan-2) and mention it in
    // the response. The owner's instruction on 2026-08-20 replaces that with a QUESTION: *"if the
    // name is available in the resutrant and recycle and recycle want to restore so it say like
    // name already tke 2 option can show 1 opion close 2nd chnage name and restore which will
    // change anme and restore that stuff"*. So: 409 + `conflict`, the screen asks, and NOTHING is
    // written until he presses a button. The same shape the OWNER bin has used since 2026-08-01
    // (mig 245) — one recycle bin, one way of answering a clash.
    //
    // Only TWO ways out, deliberately, and they are the two he named: close (nothing happens), or
    // change the returning restaurant's name and restore under it. The LIVE restaurant currently
    // serving guests at that address is never touched — its QR codes are on real tables.
    const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const takenBy = async (s: string) => {
      const q = await sb.from("restaurants").select("id, name, active").eq("slug", s).is("deleted_at", null).neq("id", rid).limit(1);
      // A clash check that cannot read is NOT "the name is free" — writing on that assumption is
      // how you hit the raw unique-index error this whole branch exists to avoid.
      if (q.error) throw q.error;
      return (q.data || [])[0] || null;
    };
    // The admin's answer to a previous 409: { resolve: { name: "Aangan (old)", slug?: "aangan-old" } }.
    const resolve = (body?.resolve && typeof body.resolve === "object") ? body.resolve as { name?: unknown; slug?: unknown } : null;
    let name = r.name as string;
    let slug = r.slug as string;
    if (resolve) {
      const wantName = String(resolve.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (wantName.length < 2) return bad("The new name must be at least 2 characters.");
      const wantSlug = slugOf(String(resolve.slug ?? "") || wantName);
      if (wantSlug.length < 2) return bad("That name doesn't make a usable web address — add some letters or numbers.");
      name = wantName;
      slug = wantSlug;
    }
    let holder: { id: string; name: string; active: boolean } | null;
    try { holder = await takenBy(slug) as { id: string; name: string; active: boolean } | null; }
    catch (e) { return adminFail("this restaurant's web address", e as { message?: string }, { action: "load" }); }
    if (holder) {
      // A suggestion the admin can accept with one press, and it is checked to be free itself —
      // otherwise the dialog offers a name that fails the moment it is submitted.
      const base = slug.replace(/-\d+$/, "");
      let suggested = `${base}-2`;
      try { for (let n = 2; n < 50 && (await takenBy(suggested)); n++) suggested = `${base}-${n + 1}`; } catch { /* keep the plain suggestion */ }
      return NextResponse.json({
        error: `The web address /r/${slug}/menu is taken by "${holder.name}".`,
        conflict: {
          slug, restored: { id: rid, name: r.name, slug: r.slug },
          // THE PRINTED CODES ARE THE PART NOBODY THINKS OF (owner, 2026-08-21). Renaming the
          // returning restaurant is the right call and is not changing — mig 319's own comment says
          // the RETURNING one gets renamed, never the one currently trading. But a QR code encodes
          // the ADDRESS, not the restaurant, so the consequence is that this restaurant's old codes
          // now open "<holder>"'s menu: a diner scanning the laminated card on the table orders from
          // a different restaurant's list. The dialog has to say that, because the admin is about to
          // agree to it and there is no way back except reprinting.
          qrWarning: `Its old address /r/${r.slug}/menu now belongs to "${holder.name}", so any QR codes or printed menus still carrying it will open THAT restaurant's menu. They have to be reprinted with the new address.`,
          holder: { id: holder.id, name: holder.name, active: holder.active === true },
          suggestedName: `${r.name} (old)`, suggestedSlug: suggested,
          // Told the admin so a second clash reads as "you picked one that is also taken", not as
          // the dialog silently reopening on itself.
          retry: !!resolve,
        },
      }, { status: 409 });
    }
    const { error } = await sb.from("restaurants")
      .update({ deleted_at: null, deleted_by: null, delete_reason: null, active: activate, name, slug })
      .eq("id", rid);
    if (error) return adminFail("restoring this restaurant", error, { action: "save" });
    const renamed = slug !== r.slug ? slug : null;
    // ── THE ADDRESS IT LEFT BEHIND GOES ON RECORD (mig 350) ────────────────────────────────────
    // This is the only place in the product where a restaurant's web address changes, so it is the
    // only place that can remember the old one. With this row, an old printed QR code still finds
    // the restaurant the moment its old address becomes free again — and it stays silent while
    // somebody else is using it (lfh_slug_moved refuses in that case; see the migration).
    //
    // Best-effort on purpose: the restore has ALREADY succeeded above. Failing to write a
    // convenience row must never turn a completed restore into an error on the admin's screen —
    // he would press it again and the second press would find the restaurant already live.
    if (renamed) {
      const hist = await sb.from("restaurant_slug_history")
        // The old address may already be on record from an earlier rename of this same restaurant,
        // so the key is updated rather than inserted twice — and `replaced_by` moves with it.
        .upsert({ slug: r.slug, restaurant_id: rid, replaced_by: slug, retired_at: new Date().toISOString() }, { onConflict: "slug" });
      if (hist.error) console.error("[restaurants] slug history not recorded for", r.slug, hist.error.message);
    }
    await logAction("admin", "restaurant_restore", { restaurant_id: rid, actor: "admin", detail: `${r.name} restored${activate ? " and reactivated" : " (suspended)"}${renamed ? ` — renamed to "${name}" at /r/${renamed}/menu because its old web address was taken. Its old QR codes (/r/${r.slug}/menu) now open a different restaurant and must be reprinted` : ""}` });
    return ok({
      ok: true, restored: true, active: activate, name, slug, ...(renamed ? { renamed } : {}),
      // Said again on the way out, not only in the dialog: the admin who agreed to the rename is
      // the one who has to get the codes reprinted, and by now the dialog has closed.
      ...(renamed ? { oldAddress: `/r/${r.slug}/menu`, reprintQr: true } : {}),
    });
  }

  // ── purge_restaurant — PERMANENT, irreversible removal of a binned restaurant's
  // OPERATIONAL data: its menu, staff logins, settings, customers, feedback and
  // activity log. Its MONEY IS DELIBERATELY KEPT (migration 309, owner 2026-08-11:
  // "keep bills forever, purge only the rest") — orders, sessions, payments, credit
  // notes, invoice history and the Removals audit all survive, which is why the
  // restaurants row itself survives too, marked `purged_at`, for them to hang off.
  // The atomic SQL function admin_purge_restaurant enforces the two hard rules that
  // remain (never the default, never twice) independently of this handler. THE 90-DAY
  // WAIT IS GONE (owner, 2026-08-20 — see the note on RETENTION_DAYS at the top of this
  // file); migration 342 removed its SQL half so the two sides can't disagree. ────────
  if (action === "purge_restaurant") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    if (!UUID.test(rid)) return bad("Restaurant not found.", 404);
    if (rid === DEFAULT_RID) return bad("The default restaurant can’t be permanently removed.", 400);
    // A FAILED READ IS NOT "NOT FOUND". Deciding a refusal from an unchecked read is the fault
    // fixed in this same file's banquet-numbering gate (T20 item 4) — here it would mean answering
    // "Restaurant not found" for a blip, which sends the admin looking for a row that is right there.
    const rQ = await sb.from("restaurants").select("id, name, deleted_at").eq("id", rid).limit(1);
    if (rQ.error) return adminFail("this restaurant", rQ.error, { action: "load" });
    const r = rQ.data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    if (!r.deleted_at) return bad("Only a restaurant in the recycle bin can be removed. Move it to the recycle bin first.", 409);
    // Atomic hard delete (children → parents → the row) in one transaction.
    const { error } = await sb.rpc("admin_purge_restaurant", { p_rid: rid });
    // The SQL function raises in words a person can act on ("already been purged", "Retention
    // lock: …"). Passing `error.message` through unchanged is what put a raw database sentence on
    // the admin's screen; the page now shows this text, so keep it readable and add the one thing
    // the exception can't know — where the bills went (T20 sweep, 2026-08-16).
    if (error) {
      const m = String(error.message || "");
      if (/already been purged/i.test(m)) return bad("This restaurant has already been permanently removed. Its bills are still on record in the Bills ledger.", 409);
      // Kept as a SAFETY NET, not as a rule: migration 342 drops the retention lock, but a database
      // that has not had 342 applied yet (a stack mid-release) would still raise it, and the admin
      // deserves that sentence rather than a raw exception. It should now be unreachable here.
      if (/Retention lock/i.test(m)) return bad("This database still has the old 90-day wait on it — its migrations are behind. Nothing was removed.", 423);
      if (/never be purged/i.test(m)) return bad("The default restaurant can never be removed.", 400);
      if (/not in the recycle bin/i.test(m)) return bad("Only a restaurant in the recycle bin can be removed.", 409);
      return bad(m, 500);
    }
    await logAction("admin", "restaurant_purge", { actor: "admin", detail: `permanently removed restaurant "${r.name}" (${rid}) — menu, staff and settings deleted; bills, invoices and the removals audit kept` });
    return ok({ ok: true, purged: true, billsKept: true });
  }

  // ── create_restaurant — the admin onboards a NEW restaurant in one go (owner 2026-06-29):
  // make the restaurant row, its settings (cloned from #1 so every NOT NULL column is satisfied,
  // with the chosen enabled_panels), and ONE starter login per ENABLED panel (passwords shown
  // ONCE). Default panels: Manager+Kitchen+Tablet on, Owner OFF (owner's choice). ───────────────
  if (action === "create_restaurant") {
    const name = String(body?.name ?? "").trim().slice(0, 80);
    if (name.length < 2) return bad("Restaurant name must be at least 2 characters.");
    // slug from the name (lowercase, hyphenated), made unique with a numeric suffix if taken.
    const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)) || "restaurant";
    let slug = base, n = 1;
    // Only a LIVE restaurant reserves a name (mig 319 made the unique index partial, the same rule
    // mig 245 gave staff logins). A restaurant sitting in the 90-day recycle bin no longer blocks
    // the name, so "Aangan" deleted this morning can be created again this afternoon without
    // silently becoming "aangan-2".
    while (((await sb.from("restaurants").select("id").eq("slug", slug).is("deleted_at", null).limit(1)).data || []).length) slug = `${base}-${++n}`;
    // ── A REUSED WEB ADDRESS INHERITS SOMEBODY ELSE'S PRINTED QR CODES (owner, 2026-08-21) ──────
    // Freeing a binned restaurant's name is deliberate (mig 319, and he asked for it) and that is
    // NOT changed here — this only makes the consequence visible, because it is silent and it is
    // sharp: a QR code encodes the ADDRESS, not the restaurant (`/r/<slug>/menu?table=N`). So the
    // moment a new restaurant takes an address a binned one used to hold, every laminated code and
    // printed menu still carrying that address opens the NEW restaurant's menu — a diner at the old
    // place orders from the new place's list. That is worse than a dead link, and nothing on screen
    // said a word about it.
    //
    // Binning renames nothing (mig 319's own header: "Nothing is renamed by this"), so the previous
    // occupant is simply the binned row still holding this slug. `restaurants` is a tiny table — the
    // health route calls it exactly that — so this is one small read on a create, not a hot path,
    // and it is skipped entirely when the address is brand new.
    const previousHolder = ((await sb.from("restaurants")
      .select("name, deleted_at")
      .eq("slug", slug).not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .limit(1)).data || [])[0] as { name: string; deleted_at: string } | null;
    // Chosen panels (default M+K+T on, Owner off). Coerce to honest booleans.
    const wp = (body?.panels && typeof body.panels === "object") ? body.panels as Record<string, unknown> : {};
    const panels = {
      manager: wp.manager !== false, kitchen: wp.kitchen !== false,
      tablet: wp.tablet !== false, owner: wp.owner === true,
    };
    // Seed a starter menu unless the admin turned the toggle off (default ON).
    const seedMenu = body?.seedMenu !== false;
    // ── A NEW RESTAURANT IS BORN ON THE MODEL'S OWN DEFAULTS, AND NOTHING ELSE ──────────────
    // (sweep T6, 2026-08-06.) This used to accept a whole `access` blob from the create form —
    // owner sections + power_<flag>, a manager grant map, nine tablet tri-states and the module
    // ladder — and the form's hand-typed presets had drifted badly from the model:
    //
    //   · its tablet preset was PRE-MIGRATION-295 (table_ops / table_tags / khata / parcel /
    //     banquet = 'off') and was spread OVER cleanClonedSettings below, so every restaurant
    //     created here was born with the exact fault migration 295 exists to repair;
    //   · it seeded view_ratings:false against the model's true, so new managers had no Rating
    //     review tab (measured on pizza-palace / taco-fiesta / demo-bistro);
    //   · owner sections and power_<flag> could ONLY be set here — no Access row writes them and
    //     the server honours them, so one untick stranded a manager with nothing able to undo it.
    //
    // So creation sets NO permission of its own. `manager_permissions` is seeded from MP_DEFAULT,
    // which DERIVES from managerGrantValue() — i.e. it stores exactly what the Access screen
    // displays, so the row and the screen agree from the first second. `owner_entitlements` is
    // left absent, which the model reads as "all on". Everything on `settings` comes from
    // cleanClonedSettings (money caps off, floor caps on, and each module's admin rung DERIVED
    // from its own row on the Access screen — the three floor ones on, the premium ones off;
    // said "modules off" until 2026-08-28, when that stopped being true for take-orders,
    // move/merge/split and table types). Permissions are changed afterwards on ONE screen:
    // /aevinite/access.
    const managerPerms: Record<string, boolean> = { ...MP_DEFAULT };
    // 1) the restaurant row (id auto-uuid, active) + the model's own grant baseline.
    const rest = await sb.from("restaurants").insert({
      slug, name, active: true, manager_permissions: managerPerms,
    }).select("id, slug, name").single();
    if (rest.error) {
      // Slug uniqueness is a read-then-insert (not atomic), so two admins creating the same
      // name at the same instant can both pass the while-loop and collide on the UNIQUE
      // constraint. Turn Postgres's raw 23505 into a friendly "try again" instead of a 500.
      if (rest.error.code === "23505") return bad("That name was just taken — please try a slightly different name.", 409);
      return adminFail("the new restaurant", rest.error, { action: "save" });
    }
    const rid = rest.data.id as string;
    // 2) its settings row — clone #1 as a template, then override id/restaurant_id/enabled_panels
    //    and start with a modest table_count (a new restaurant shouldn't inherit #1's big floor).
    const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RID).maybeSingle();
    // cleanClonedSettings strips #1's tenant-specific identity/geo/tax (and sets table_count:10)
    // so a new restaurant never inherits #1's invoice name/GSTIN or café geofence coordinates.
    const baseRow = cleanClonedSettings(template.data);
    // NOTHING IS SPREAD OVER baseRow ANY MORE (sweep T6): the create form's tablet/module
    // preset used to land here, last, and overwrite the very defaults cleanClonedSettings sets.
    // THE SETTINGS ROW IS KEYED BY THE RESTAURANT'S OWN ID, NOT ITS SLUG (T20 sweep, 2026-08-16).
    //
    // It used to be `id: slug`, and `settings.id` is that table's PRIMARY KEY (mig 003). Migration
    // 319 then freed a restaurant's slug the moment it goes to the recycle bin — but a binned
    // restaurant KEEPS its settings row, so the slug was free in `restaurants` and still taken in
    // `settings`. Binning "Aangan" and creating "Aangan" again therefore passed the slug check and
    // died on `settings_pkey`, rolling the whole create back and putting
    // `duplicate key value violates unique constraint "settings_pkey"` on the admin's screen —
    // precisely the "database error on the admin's screen, which is worse than the lock it
    // replaces" that migration 319's own header says it exists to avoid.
    //
    // The uuid can never collide, and nothing anywhere looks a settings row up by slug: every read
    // is `.eq("restaurant_id", …)` except the four legacy `id='site'` reads, which are restaurant
    // #1's own row and are untouched by this. So the name stays free, as he asked for.
    const settingsRow = { ...baseRow, id: rid, restaurant_id: rid, enabled_panels: panels };
    const setRes = await sb.from("settings").upsert(settingsRow, { onConflict: "restaurant_id" });
    if (setRes.error) {
      // Roll back the orphaned restaurant row (bug #5, 2026-07-06): without a settings
      // row the tenant is unusable, and leaving it made the admin — who just saw
      // "couldn't create" — retry and produce a duplicate with a "-2" slug.
      await sb.from("restaurants").delete().eq("id", rid);
      return adminFail("the new restaurant's settings", setRes.error, { action: "save" });
    }
    // 2b) Seed the starter menu (categories → filters → items), scoped to this restaurant.
    //     Best-effort: a seed failure must NOT orphan the already-created restaurant — we
    //     report it in the response so the admin knows, and the restaurant is still usable
    //     and editable from its manager panel. Egress-safe: scoped inserts, no reads.
    let menuSeeded = false;
    let seedError: string | null = null;
    if (seedMenu) {
      try {
        const menu = loadStarterMenu();
        const cats = toCategoryRows(menu, rid);
        const filters = toFilterRows(menu, rid);
        const items = toItemRows(menu, rid);
        if (cats.length) {
          const r1 = await sb.from("categories").upsert(cats, { onConflict: "restaurant_id,slug" });
          if (r1.error) throw new Error(r1.error.message);
        }
        if (filters.length) {
          const r2 = await sb.from("filters").upsert(filters, { onConflict: "restaurant_id,slug" });
          if (r2.error) throw new Error(r2.error.message);
        }
        if (items.length) {
          const r3 = await sb.from("menu_items").upsert(items, { onConflict: "restaurant_id,slug" });
          if (r3.error) throw new Error(r3.error.message);
        }
        menuSeeded = true;
      } catch (e) {
        seedError = e instanceof Error ? e.message : String(e);
      }
    }
    // 3) one starter login per ENABLED panel. Username = the panel name (unique PER restaurant),
    //    random password returned once. The owner login is also mapped as the restaurant's owner.
    const logins: { panel: string; role: string; username: string; password: string }[] = [];
    const loginErrors: string[] = []; // panels whose starter login failed (bug #5) — reported so the admin isn't left with an enabled panel nobody can sign into
    for (const panel of ["manager", "kitchen", "tablet", "owner"] as const) {
      if (!panels[panel]) continue;
      const pw = genPassword();
      const ins = await sb.from("staff_users")
        .insert({ username: panel, name: `${name} ${panel}`, role: panel, restaurant_id: rid, ...(await passwordFields(pw)), active: true })
        .select("id").single();
      if (ins.error) { loginErrors.push(panel); continue; } // don't fail the whole create over one login; report what we made
      logins.push({ panel, role: panel, username: panel, password: pw });
      if (panel === "owner") {
        // THE LOGIN EXISTS BUT NOBODY OWNS THE RESTAURANT (T20 sweep #7, 2026-08-27). Both writes'
        // errors were dropped, so the owner login could be created and handed over while
        // `owner_user_id` and the `restaurant_owners` membership stayed empty — and membership is the
        // SCOPING source of truth (mig 097), so that owner signs in and sees nothing. It is reported
        // rather than fatal (the restaurant and its logins are real and usable), through the same
        // `loginErrors` channel the create already answers with, so the console can say so.
        const link = await sb.from("restaurants").update({ owner_user_id: ins.data.id }).eq("id", rid);
        const mem = await sb.from("restaurant_owners").upsert({ restaurant_id: rid, user_id: ins.data.id }, { onConflict: "restaurant_id,user_id", ignoreDuplicates: true });
        if (link.error || mem.error) {
          console.error("[admin/restaurants] owner link failed:", link.error?.message || mem.error?.message);
          loginErrors.push("owner-link");
        }
      }
    }
    const onPanels = (Object.keys(panels) as (keyof typeof panels)[]).filter((k) => panels[k]);
    // The reused address goes in the RECORD as well as on the screen: months later, "why is this
    // restaurant getting the other one's diners" is answered by this line and nothing else.
    await logAction("admin", "restaurant_create", { actor: "admin", restaurant_id: rid, detail: `created restaurant "${name}" (${slug}) · panels ${onPanels.join("+")}${seedMenu ? (menuSeeded ? " · menu seeded" : " · menu seed FAILED") : " · no menu"}${previousHolder ? ` · REUSED the web address /r/${slug}/menu, last held by "${previousHolder.name}" (binned ${new Date(previousHolder.deleted_at).toISOString().slice(0, 10)}) — that restaurant's printed QR codes now open THIS menu` : ""}` });
    // Remember this setup (panels + sample-menu) so the next "New restaurant" form auto-fills
    // from it. Best-effort — a save failure must never fail the create. NO `access` any more
    // (sweep T6, 2026-08-06): remembering a permission set is what let one stale shape pre-fill
    // every future restaurant, and permissions are not this form's to decide.
    if (body?.saveDefaults !== false) {
      try {
        await sb.from("app_config").upsert(
          { key: CREATE_DEFAULTS_KEY, value: { panels, seedMenu }, updated_at: new Date().toISOString() },
          { onConflict: "key" },
        );
      } catch { /* remembering defaults is a convenience, not critical */ }
    }
    return ok({
      ok: true, id: rid, slug, name, panels, logins, loginErrors, menuSeeded, seedError,
      // Present ONLY when this address had a previous occupant, so the console can say so once and
      // then never mention it again. Not an error and not a refusal — freeing a binned name is his
      // rule; this is the consequence stated out loud so reprinting the codes is a decision.
      ...(previousHolder ? { reusedAddress: { name: previousHolder.name, binnedOn: previousHolder.deleted_at } } : {}),
    });
  }

  if (action !== "create_owner") return bad("Unknown action.");
  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  if (key.length < 2) return bad("Username must be at least 2 characters.");
  // An owner's `restaurant_id` is only a "home" anchor for the NOT NULL + FK column;
  // their OWNED restaurants come from restaurants.owner_user_id / restaurant_owners
  // (assigned via PATCH). Login names are globally unique, so clash-check globally.
  const taken = await nameTakenMessage(key);
  if (taken) return bad(taken, 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");
  const home = await resolveOwnerHomeRid();
  if (!home.rid) return bad(home.error || "Couldn't work out where to file this owner.", 500);
  const { data, error } = await sb.from("staff_users")
    .insert({ username: key, name: display, role: "owner", restaurant_id: home.rid, ...(await passwordFields(password)), active: true })
    .select("id, name").single();
  // A taken name keeps its own sentence; anything else goes through adminFail, so the console gets a
  // plain line and the database's words stay in `detail` + the log (T20 sweep #7, 2026-08-27 — this
  // was the last handler in the file still answering `error.message` raw).
  if (error) {
    if (error.code === "23505") return bad("That username is taken — pick another.", 409);
    return adminFail("the new owner login", error, { action: "save" });
  }
  await logAction("admin", "owner_create", { actor: "admin", detail: `created owner "${display}" · id ${data!.id}` });
  return ok({ ok: true, id: data!.id, name: display, password });
}
