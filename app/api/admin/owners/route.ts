// /api/admin/owners — the admin's OWNER manager (one owner ⇄ 1..N restaurants).
// The scoping source of truth is the restaurant_owners join table (migration 097);
// restaurants.owner_user_id stays in sync as the display/back-compat "primary".
//   GET   → every owner (incl. suspended) + the restaurants each one owns, plus the
//           live restaurant list (for attach pickers + the "no owner" warning).
//   POST  → { action:"create_owner", name, password?, restaurant_ids?[] } — mint the
//           login ONCE (password shown once) and attach any number of restaurants.
//   PATCH → { owner_id, action: "attach"|"detach"|"set_primary" (+restaurant_id) |
//             "reset_password" (+password?) | "set_active" (+active) | "rename" (+name) }
//   POST  → also { action:"restore_owner"|"purge_owner", owner_id } for the recycle bin.
//           restore_owner answers 409 + { conflict } when the binned name was taken
//           while it sat in the bin; re-send with resolve:{ mode:"rename_restored"|
//           "rename_existing", name } to say who keeps the name (mig 245).
//   GET ?id=<owner_id>  → one owner's ACTIVITY feed (staff_actions rows that name
//           them — their own logins/actions + admin actions done TO them).
//   GET ?deleted=1      → the RECYCLE BIN: owners that were soft-deleted (mig 208),
//           with how long each has sat there.
//   GET ?bin_detail=<owner_id> → WHAT IS INSIDE one binned owner: their restaurants,
//           which of those are live, and how to open each one's panels (owner, 2026-08-20).
//   DELETE ?id=<owner_id> → move the owner to the RECYCLE BIN (soft-delete, mig 208;
//           owner rule 2026-07-06: suspend FIRST). Reversible via restore_owner at any
//           time, and purge_owner erases it for good whenever the admin chooses (that
//           permanent step hands their restaurants to a co-owner or to "no owner").
// Admin-gated (same cookie as the rest of /aevinite), service-role.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { normalizeLoginName } from "@/lib/userAuth";
import { passwordFields } from "@/lib/passwordVault";
import { logAction, redactMoney } from "@/lib/oplog";
import { resolveOwnerHomeRid, loginNameTaken, liveHoldersOfName, nameTakenMessage } from "@/lib/ownerHome";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ── NO WAIT BEFORE A PERMANENT REMOVAL (owner, 2026-08-20) ────────────────────────────────────
// A binned owner used to be purgeable only after 90 days. His instruction was to be able to delete
// from the recycle bin whenever he wants; the mirror of the same change in
// app/api/admin/restaurants/route.ts carries the full note. What SURVIVES: type-the-exact-username
// to confirm, the owner's restaurants are handed to a co-owner rather than deleted, and the purge
// is written to the audit trail. Kept as a named constant, at 0, so nothing has to relearn the
// shape of this response and a future "hold things for N days" is one number.
const RETENTION_DAYS = 0;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// A login name needs 2 real LETTERS OR DIGITS — the same rule the staff pages already
// use (app/api/owner/staff realCharCount). Counting raw characters let an owner be
// created or restored as "🙂🙂" or "--", a name nobody can type at the login box.
const realCharCount = (s: string) => (String(s).match(/[\p{L}\p{N}]/gu) || []).length;
const ok = (d: unknown, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
// The database's words go to the LOG (searchable, ours) and a short note comes back for the caller.
// Used by the two internal helpers below, whose return value used to be the raw Postgres sentence.
function dbNote(step: string, e: { message?: string; code?: string } | null): string {
  console.error(`[admin/owners] couldn't ${step}:`, e?.code || "", e?.message || "no reason given");
  return `couldn't ${step}`;
}

function genPassword(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = ""; const r = crypto.getRandomValues(new Uint8Array(10));
  for (const b of r) s += a[b % a.length];
  return s;
}


export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);

  // ── ?id=<owner> → that owner's ACTIVITY (admin clicked into an owner card).
  // One-shot on open, never polled. Two match rules: rows THEY caused (actor =
  // their name/username — logins + owner-panel actions) and rows ABOUT them
  // (detail carries their uuid — owner_create/reset/suspend/attach…). Capped.
  const ownerId = new URL(req.url).searchParams.get("id");
  if (ownerId) {
    // Validate the id is a real UUID BEFORE it touches any query — stops a crafted value
    // from injecting PostgREST filter syntax into the .or() below, and returns a clean 400
    // instead of leaking a raw "invalid input syntax for type uuid" Postgres error.
    if (!isUuid(ownerId)) return bad("Invalid owner id.", 400);
    const o = (await sb.from("staff_users")
      .select("id, username, name, active, last_seen_at, created_at")
      .eq("id", ownerId).eq("role", "owner").limit(1)).data?.[0];
    if (!o) return bad("Owner not found.", 404);
    // Match by the owner's STABLE id: actor_id on their own panel actions (mig 156), plus the
    // owner id embedded in the detail of admin-on-owner actions + their login rows. Replaces the
    // old display-NAME match, which missed role-logged actions AND surfaced a same-named staff
    // member's rows under the wrong owner (audit 2026-07-09). ownerId is a validated UUID — safe
    // in the .or() filter (no delimiter chars to escape).
    const actQ = await sb.from("staff_actions")
      .select("id, panel, action, actor, detail, restaurant_id, created_at")
      .or(`actor_id.eq.${ownerId},detail.ilike.%${ownerId}%`)
      .order("created_at", { ascending: false })
      .limit(100);
    if (actQ.error) return adminFail("this owner's activity", actQ.error, { action: "load" });
    // Restaurant names for the rows' restaurant_id chips (one scoped lookup).
    const rids = Array.from(new Set((actQ.data || []).map((a) => a.restaurant_id).filter(Boolean)));
    const restNames = rids.length
      ? new Map(((await sb.from("restaurants").select("id, name").in("id", rids).limit(2000)).data || []).map((r) => [r.id, r.name]))
      : new Map();
    return ok({
      owner: { id: o.id, username: o.username, name: o.name || o.username, active: o.active === true, lastSeenAt: o.last_seen_at, createdAt: o.created_at },
      activity: (actQ.data || []).map((a) => ({
        id: a.id, panel: a.panel, action: a.action, actor: a.actor, detail: redactMoney(a.detail),
        restaurant: a.restaurant_id ? (restNames.get(a.restaurant_id) || null) : null, at: a.created_at,
      })),
    });
  }

  // ── ?bin_detail=<owner_id> — WHAT IS ATTACHED TO A BINNED OWNER (owner, 2026-08-20) ──────────
  // *"when you click owner and resrurant in recycle bin you could able to see inside it my clicking
  // iindiviual able to vivit there panel too"*. A binned owner's row said only how many restaurants
  // were "still linked". Which ones? Are any of them live and serving guests right now? That
  // matters before a permanent removal, because purging the owner hands each restaurant to a
  // co-owner or to "no owner" — and this is the list of restaurants that happens to.
  //
  // EGRESS: two scoped reads with column lists and a cap, run once when he opens the row.
  {
    const detailId = new URL(req.url).searchParams.get("bin_detail");
    if (detailId) {
      if (!UUID.test(detailId)) return bad("That user isn't an owner.", 404);
      const oQ = await sb.from("staff_users").select("id, username, name, role, active, deleted_at, deleted_by, delete_reason, created_at, last_seen_at").eq("id", detailId).limit(1);
      if (oQ.error) return adminFail("what is attached to this owner", oQ.error, { action: "load" });
      const o = oQ.data?.[0];
      if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
      const linksQ = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", detailId).limit(200);
      if (linksQ.error) return adminFail("this owner's restaurants", linksQ.error, { action: "load" });
      const rids = (linksQ.data || []).map((l) => l.restaurant_id).filter(Boolean);
      let restaurants: { id: string; name: string; slug: string; active: boolean; binned: boolean; purged: boolean; primary: boolean }[] = [];
      if (rids.length) {
        const rQ = await sb.from("restaurants").select("id, name, slug, active, deleted_at, purged_at, owner_user_id").in("id", rids).order("name").limit(200);
        if (rQ.error) return adminFail("this owner's restaurants", rQ.error, { action: "load" });
        restaurants = (rQ.data || []).map((r) => ({
          id: r.id, name: r.name, slug: r.slug, active: r.active === true,
          binned: !!r.deleted_at, purged: !!r.purged_at,
          // ★ primary is DISPLAY + tie-break only — real access is the restaurant_owners row above.
          primary: r.owner_user_id === detailId,
        }));
      }
      return ok({
        owner: {
          id: o.id, username: o.username, name: o.name || o.username, active: o.active === true,
          deletedAt: o.deleted_at, deletedBy: o.deleted_by || null, reason: o.delete_reason || null,
          createdAt: o.created_at || null, lastSeenAt: o.last_seen_at || null,
        },
        restaurants,
      });
    }
  }

  // ── ?deleted=1 → the RECYCLE BIN: only binned owners, with how long each has sat there.
  // Kept separate from the main list so a binned owner never leaks back into the live table.
  if (new URL(req.url).searchParams.get("deleted") === "1") {
    const [binQ, linksQ] = await Promise.all([
      sb.from("staff_users").select("id, username, name, deleted_at, deleted_by, delete_reason")
        .eq("role", "owner").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(2000),
      sb.from("restaurant_owners").select("user_id").limit(20000),
    ]);
    if (binQ.error) return adminFail("the owners recycle bin", binQ.error, { action: "load" });
    const owned = new Map<string, number>();
    for (const l of linksQ.data || []) owned.set(l.user_id, (owned.get(l.user_id) || 0) + 1);
    const now = Date.now();
    const trashed = (binQ.data || []).map((o) => {
      const deletedAt = o.deleted_at as string;
      // How long they have SAT in the bin — a fact the admin can use, not a countdown to a
      // permission. `daysLeft` is gone rather than pinned at 0 for a screen to render.
      const daysHeld = Math.max(0, Math.floor((now - new Date(deletedAt).getTime()) / 86400000));
      return {
        id: o.id, username: o.username, name: o.name || o.username,
        deletedAt, deletedBy: o.deleted_by || null, reason: o.delete_reason || null,
        restaurants: owned.get(o.id) || 0,
        daysHeld, canPurge: true,
      };
    });
    return ok({ trashed, retentionDays: RETENTION_DAYS });
  }

  const [ownersQ, linksQ, restQ] = await Promise.all([
    // deleted_at IS NULL → the live/suspended list; binned owners are hidden here
    // (they live in the recycle bin above).
    sb.from("staff_users")
      .select("id, username, name, active, last_seen_at, created_at")
      // PAGED, like lib/ownerScope's scopedRestaurantIds (2026-08-05). A bare select with no
      // .limit() stops at PostgREST's cap and silently drops everyone past it — the same bug that
      // "silently dropped every restaurant past the 100th" in the owner reports. 2000 is far above
      // any real estate and still an explicit ceiling rather than a hidden one.
      .eq("role", "owner").is("deleted_at", null).order("created_at", { ascending: true }).limit(2000),
    sb.from("restaurant_owners").select("restaurant_id, user_id").limit(20000),
    sb.from("restaurants").select("id, slug, name, active, owner_user_id").is("deleted_at", null).order("name").limit(2000),
  ]);
  // PLAIN WORDS FOR THE CONSOLE (sweep #6, T19). Every failure on this page answered with the
  // database's own sentence — `insert or update on table "restaurant_owners" violates foreign key
  // constraint …` in a red toast. adminFail keeps that text in the response `detail` and the server
  // log and gives the screen a sentence naming the thing and saying whether anything changed; on the
  // page that hands out ownership of a restaurant, "nothing was changed" is the important half.
  if (ownersQ.error) return adminFail("the owners list", ownersQ.error, { action: "load" });
  if (linksQ.error) return adminFail("who owns what", linksQ.error, { action: "load" });
  if (restQ.error) return adminFail("the restaurant list", restQ.error, { action: "load" });

  const restById = new Map((restQ.data || []).map((r) => [r.id, r]));

  // Who holds each restaurant's PRIMARY slot right now — including accounts the list
  // above hides (a binned owner keeps its links so Restore works). Without this the
  // screen could only say "Co-owner" with no way to see WHO the primary is, which is
  // exactly the confusion Aangan caused (its binned starter "owner" still held it).
  const primaryIds = Array.from(new Set((restQ.data || []).map((r) => r.owner_user_id).filter(Boolean) as string[]));
  const primaryUser = new Map<string, { name: string; binned: boolean }>();
  if (primaryIds.length) {
    const pq = await sb.from("staff_users").select("id, username, name, deleted_at").in("id", primaryIds).limit(2000);
    for (const u of pq.data || []) primaryUser.set(u.id as string, { name: (u.name as string) || (u.username as string), binned: !!u.deleted_at });
  }

  type OwnedRow = { id: string; slug: string; name: string; active: boolean; primary: boolean; primaryHolder: string | null; primaryBinned: boolean };
  const byOwner = new Map<string, OwnedRow[]>();
  for (const l of linksQ.data || []) {
    const r = restById.get(l.restaurant_id);
    if (!r) continue; // deleted/binned restaurants don't show as owned
    const holder = r.owner_user_id ? primaryUser.get(r.owner_user_id as string) : undefined;
    const list = byOwner.get(l.user_id) || [];
    list.push({
      id: r.id, slug: r.slug, name: r.name, active: r.active === true,
      primary: r.owner_user_id === l.user_id,
      primaryHolder: r.owner_user_id === l.user_id ? null : (holder?.name ?? null),
      primaryBinned: r.owner_user_id === l.user_id ? false : holder?.binned === true,
    });
    byOwner.set(l.user_id, list);
  }
  const owners = (ownersQ.data || []).map((o) => ({
    id: o.id, username: o.username, name: o.name || o.username, active: o.active === true,
    lastSeenAt: o.last_seen_at || null, createdAt: o.created_at,
    restaurants: (byOwner.get(o.id) || []).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const ownedIds = new Set((linksQ.data || []).map((l) => l.restaurant_id));
  const restaurants = (restQ.data || []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    hasOwner: ownedIds.has(r.id),
  }));
  return ok({ owners, restaurants });
}

// Is this user still a LIVE holder of the primary slot? A binned (recycle-bin) or
// missing staff_users row must not keep it: binning deliberately preserves an owner's
// links so Restore works, so without this check the primary pointer stays on a ghost
// and the newly-assigned real owner reads as "Co-owner" everywhere (seen on Aangan
// 2026-07-31: the starter "owner" login was binned 29 Jul but still held primary).
async function isLivePrimaryHolder(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const u = (await sb.from("staff_users").select("id, deleted_at").eq("id", userId).limit(1)).data?.[0];
  return !!u && !u.deleted_at;
}

// Attach ONE restaurant to an owner: join-table membership + become the primary if
// the slot is free OR only held by a binned/deleted account (so act-as, the admin's
// Restaurants tab and every "who owns this?" display always resolve to a real owner).
// Returns null on success, or a sentence FOR THE SCREEN. The database's own words used to be the
// return value, and they travelled two ways: `bad(e, 500)` on the attach button, and the
// `attachErrors` array in the create-owner reply, which the page lists next to the new login. So
// creating an owner could show `insert or update on table "restaurant_owners" violates foreign key
// constraint "restaurant_owners_restaurant_id_fkey"` under a freshly-minted password. The raw text
// goes to the server log, where it is searchable, and the caller gets words (sweep #6, T19).
async function attach(ownerId: string, rid: string): Promise<string | null> {
  const up = await sb.from("restaurant_owners")
    .upsert({ restaurant_id: rid, user_id: ownerId }, { onConflict: "restaurant_id,user_id", ignoreDuplicates: true });
  if (up.error) {
    console.error("[admin/owners] attach failed:", up.error.code || "", up.error.message);
    return "Couldn't attach that restaurant — nothing was changed. Please try again.";
  }
  const r = (await sb.from("restaurants").select("owner_user_id").eq("id", rid).limit(1)).data?.[0];
  if (r && !(await isLivePrimaryHolder(r.owner_user_id as string | null))) {
    const set = await sb.from("restaurants").update({ owner_user_id: ownerId }).eq("id", rid);
    if (set.error) {
      console.error("[admin/owners] primary-owner set failed:", set.error.code || "", set.error.message);
      return "The restaurant was attached, but its main owner could not be set — set it with ★ Make primary.";
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const action = String(body?.action || "");

  // ── restore_owner — bring a binned owner back. They return SUSPENDED (active
  // stays false, exactly as they were before binning) so they can't silently sign
  // in; the admin flips Restore in the Owners list to reactivate. Their restaurant
  // links were kept intact, so ownership comes straight back. Clears bin fields.
  //
  // NAME CLASH (owner, 2026-08-01): a binned account no longer reserves its name
  // (mig 245 + loginNameTaken), so by the time it's restored someone else may be
  // called "rishi" too. Two live logins can't share a name, so instead of failing —
  // or silently renaming somebody — this answers 409 with a `conflict` block and the
  // admin picks WHO gets renamed, then re-sends with `resolve`:
  //   resolve { mode:"rename_restored", name }  → the returning owner takes a new name
  //   resolve { mode:"rename_existing", name }  → the live owner is renamed, freeing it
  // Same first-save-wins spirit as the rest of the app: the person who took the name
  // while it was free keeps it unless the admin deliberately says otherwise. ──────
  if (action === "restore_owner") {
    const ownerId = String(body?.owner_id || "");
    if (!ownerId) return bad("Missing owner_id.");
    const o = (await sb.from("staff_users").select("id, username, name, role, deleted_at, restaurant_id").eq("id", ownerId).limit(1)).data?.[0];
    if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
    if (!o.deleted_at) return bad("That owner isn't in the recycle bin.", 409);

    const resolve = body?.resolve && typeof body.resolve === "object" ? body.resolve : null;
    const mode = resolve ? String(resolve.mode || "") : "";
    // The restore's OWN name — a rename_restored changes it before we look for clashes.
    let restoredDisplay = (o.name as string) || (o.username as string);
    let restoredKey = o.username as string;
    if (mode === "rename_restored") {
      restoredDisplay = String(resolve.name ?? "").trim().slice(0, 80);
      restoredKey = normalizeLoginName(restoredDisplay);
      if (realCharCount(restoredKey) < 2) return bad("The new name needs at least 2 letters or numbers.");
    }

    // Who would this name collide with, LIVE? Only where a name actually has to be
    // unique: the same tenant anchor (the DB rule, mig 245) or another OWNER (all
    // owners share one home namespace, and the Owners page treats a name as a person).
    const holders = (await liveHoldersOfName(restoredKey))
      .filter((h) => h.id !== ownerId && (h.role === "owner" || h.restaurant_id === o.restaurant_id));
    const blocker = holders[0] || null;

    if (blocker && mode !== "rename_existing") {
      // Nothing has changed yet — the admin decides, then re-sends.
      return NextResponse.json({
        error: `The name “${restoredDisplay}” now belongs to someone else — choose which one keeps it.`,
        conflict: {
          username: restoredKey,
          restored: { id: o.id, name: (o.name as string) || (o.username as string), username: o.username },
          existing: {
            id: blocker.id, name: blocker.name || blocker.username, username: blocker.username,
            role: blocker.role, active: blocker.active,
          },
          // Renaming the LIVE side from here is only offered for another owner —
          // a restaurant's staff login isn't this page's to rename.
          canRenameExisting: blocker.role === "owner",
        },
      }, { status: 409 });
    }

    if (mode === "rename_existing") {
      if (!blocker) return bad("That name is already free — press Restore again.", 409);
      if (blocker.role !== "owner") return bad("That name belongs to a restaurant's staff login — rename the returning owner instead.", 409);
      const newDisplay = String(resolve.name ?? "").trim().slice(0, 80);
      const newKey = normalizeLoginName(newDisplay);
      if (realCharCount(newKey) < 2) return bad("The new name needs at least 2 letters or numbers.");
      if (newKey === restoredKey) return bad("Pick a DIFFERENT name for the current owner — that's the one being freed up.");
      if (await loginNameTaken(newKey)) return bad("That new name is taken too — pick another.", 409);
      const ren = await sb.from("staff_users").update({ name: newDisplay, username: newKey }).eq("id", blocker.id);
      if (ren.error) return adminFail("the other owner's name", ren.error, { action: "save" });
      await logAction("admin", "owner_rename", { actor: "admin", restaurant_id: null, detail: `renamed owner "${blocker.name || blocker.username}" → "${newDisplay}" to free the name for a restore · owner ${blocker.id}` });
    }

    // 23505 = the unique index caught a clash we didn't (two admins at once) — say so
    // in plain words instead of leaking the constraint name.
    const patch: Record<string, unknown> = { deleted_at: null, deleted_by: null, delete_reason: null };
    if (mode === "rename_restored") { patch.name = restoredDisplay; patch.username = restoredKey; }
    const { error } = await sb.from("staff_users").update(patch).eq("id", ownerId);
    if (error) return error.code === "23505"
      ? bad("Someone just took that name — pick another.", 409)
      : adminFail("this owner's restore", error, { action: "save" });
    const renamedNote = mode === "rename_restored" ? ` as "${restoredDisplay}"` : mode === "rename_existing" ? " (the other owner was renamed to free the name)" : "";
    await logAction("admin", "owner_restore_from_bin", { actor: "admin", restaurant_id: null, detail: `restored owner "${o.name || o.username}"${renamedNote} from recycle bin (still suspended) · owner ${ownerId}` });
    return ok({ ok: true, restored: true, name: restoredDisplay });
  }

  // ── purge_owner — PERMANENT, irreversible erase of a binned owner. Available AS SOON AS they
  // are in the bin (owner, 2026-08-20 — the 90-day wait is gone; see RETENTION_DAYS above). This
  // is the old permanent delete: hand each restaurant's primary to a co-owner (or clear it), drop
  // the join rows, delete the staff_users row. The audit trail (staff_actions) is kept on purpose,
  // and so are the restaurants themselves — an owner is a login, not the business. ─────────────
  if (action === "purge_owner") {
    const ownerId = String(body?.owner_id || "");
    if (!ownerId) return bad("Missing owner_id.");
    if (!UUID.test(ownerId)) return bad("That user isn't an owner.", 404);
    // A FAILED read is told apart from a MISSING row — deciding a refusal from an unchecked read is
    // the fault fixed in the restaurants route's banquet gate (T20 item 4).
    const oQ = await sb.from("staff_users").select("id, username, name, role, deleted_at").eq("id", ownerId).limit(1);
    if (oQ.error) return adminFail("this owner", oQ.error, { action: "load" });
    const o = oQ.data?.[0];
    if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
    if (!o.deleted_at) return bad("Only an owner in the recycle bin can be removed. Move them to the recycle bin first.", 409);
    const who = o.name || o.username;
    const res = await hardDeleteOwner(ownerId);
    // hardDeleteOwner hands back the database's sentence for the SERVER's benefit; the console gets
    // plain words and the raw text goes to the log, same as every other failure on this page.
    if (res.error) { console.error("[admin/owners] purge failed:", res.error); return bad("Couldn't remove that owner permanently — nothing was changed. Please try again.", 500); }
    await logAction("admin", "owner_purge", { actor: "admin", restaurant_id: null, detail: `PERMANENTLY purged owner "${who}" (${ownerId}) · ${res.released} restaurant(s) released` });
    return ok({ ok: true, purged: true });
  }

  if (action !== "create_owner") return bad("Unknown action.");

  const display = String(body?.name ?? "").trim().slice(0, 80);
  const key = normalizeLoginName(display);
  if (realCharCount(key) < 2) return bad("The name needs at least 2 letters or numbers.");
  const takenMsg = await nameTakenMessage(key);
  if (takenMsg) return bad(takenMsg, 409);
  const password = String(body?.password || "").trim() || genPassword();
  if (password.length < 6) return bad("Password must be at least 6 characters.");

  const rids: string[] = Array.isArray(body?.restaurant_ids) ? body.restaurant_ids.map(String) : [];
  // The owner's row still needs SOME restaurant in its NOT NULL + FK column; it's only
  // an anchor (real ownership = the restaurant_owners rows attached just below), so ask
  // the DB for one that exists instead of assuming #1 is there. See lib/ownerHome.ts.
  const home = await resolveOwnerHomeRid(rids);
  if (!home.rid) return bad(home.error || "Couldn't work out where to file this owner.", 500);
  const ins = await sb.from("staff_users")
    .insert({ username: key, name: display, role: "owner", restaurant_id: home.rid, ...(await passwordFields(password)), active: true })
    .select("id, name").single();
  // 23505 = the global unique index on lower(username) — the friendly version of
  // "that username is taken" for the rare race between the check above and this insert.
  if (ins.error) return ins.error.code === "23505"
    ? bad("That username is taken — pick another.", 409)
    : adminFail("this new owner", ins.error, { action: "save" });
  const ownerId = ins.data.id as string;

  // Attach every picked restaurant; report per-restaurant failures instead of
  // failing the whole create (the login itself already exists at this point).
  const attachErrors: string[] = [];
  for (const rid of rids) {
    const e = await attach(ownerId, rid);
    if (e) attachErrors.push(`${rid}: ${e}`);
  }
  await logAction("admin", "owner_create", {
    actor: "admin", restaurant_id: null, // platform-level: not tied to one restaurant (mig 156)
    detail: `created owner "${display}" · id ${ownerId}${rids.length ? ` · attached ${rids.length} restaurant(s)` : ""}`,
  });
  return ok({ ok: true, id: ownerId, name: display, password, attachErrors });
}

export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: any = {}; try { body = await req.json(); } catch {}
  const ownerId = String(body?.owner_id || "");
  const action = String(body?.action || "");
  if (!ownerId) return bad("Missing owner_id.");
  const owner = (await sb.from("staff_users").select("id, name, username, role").eq("id", ownerId).limit(1)).data?.[0];
  if (!owner || owner.role !== "owner") return bad("That user isn't an owner.", 404);
  const who = owner.name || owner.username;

  if (action === "attach") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    const r = (await sb.from("restaurants").select("id, name").eq("id", rid).is("deleted_at", null).limit(1)).data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    const e = await attach(ownerId, rid);
    if (e) return bad(e, 500);
    await logAction("admin", "owner_attach_restaurant", { restaurant_id: rid, actor: "admin", detail: `${r.name} attached to owner "${who}" · owner ${ownerId}` });
    return ok({ ok: true });
  }

  // ── set_primary — make THIS owner the restaurant's primary owner. Every real
  // permission is membership-based (restaurant_owners, mig 097), so this changes no
  // access; it fixes the SINGLE-owner displays that read restaurants.owner_user_id
  // (admin Restaurants tab, dashboard, restaurant report, "Visit panel" home pick)
  // and the act-as tie-break that prefers the primary member. Membership is required
  // — owner_user_id must never point at someone with no link. ──────────────────
  if (action === "set_primary") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    const r = (await sb.from("restaurants").select("id, name, owner_user_id").eq("id", rid).is("deleted_at", null).limit(1)).data?.[0];
    if (!r) return bad("Restaurant not found.", 404);
    if (r.owner_user_id === ownerId) return ok({ ok: true, already: true });
    const member = (await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).eq("user_id", ownerId).limit(1)).data?.[0];
    if (!member) return bad("Assign this restaurant to the owner first — only a linked owner can be made primary.", 409);
    const { error } = await sb.from("restaurants").update({ owner_user_id: ownerId }).eq("id", rid);
    if (error) return adminFail("this restaurant's primary owner", error, { action: "save" });
    const prevId = (r.owner_user_id as string | null) || null;
    const prev = prevId ? (await sb.from("staff_users").select("name, username, deleted_at").eq("id", prevId).limit(1)).data?.[0] : null;
    const prevWho = prev ? `${prev.name || prev.username}${prev.deleted_at ? " (in recycle bin)" : ""}` : "nobody";
    await logAction("admin", "owner_set_primary", { restaurant_id: rid, actor: "admin", detail: `${r.name}: primary owner ${prevWho} → "${who}" · owner ${ownerId}` });
    return ok({ ok: true });
  }

  if (action === "detach") {
    const rid = String(body?.restaurant_id || "");
    if (!rid) return bad("Missing restaurant_id.");
    // SECURITY-CRITICAL revoke (same rule as /api/admin/restaurants PATCH): if this
    // delete fails the owner keeps seeing the restaurant — surface it, never swallow.
    const del = await sb.from("restaurant_owners").delete().eq("restaurant_id", rid).eq("user_id", ownerId);
    if (del.error) return adminFail("the owner's link to this restaurant", del.error, { action: "save" });
    // If they were the PRIMARY, hand primary to a remaining co-owner (or clear it)
    // so restaurants.owner_user_id never points at someone with no membership.
    const r = (await sb.from("restaurants").select("owner_user_id, name").eq("id", rid).limit(1)).data?.[0];
    if (r?.owner_user_id === ownerId) {
      const next = (await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).limit(1)).data?.[0];
      const set = await sb.from("restaurants").update({ owner_user_id: next?.user_id ?? null }).eq("id", rid);
      if (set.error) return adminFail("the restaurant's primary owner", set.error, { action: "save" });
    }
    await logAction("admin", "owner_detach_restaurant", { restaurant_id: rid, actor: "admin", detail: `${r?.name || rid} detached from owner "${who}" · owner ${ownerId}` });
    return ok({ ok: true });
  }

  if (action === "reset_password") {
    const password = String(body?.password || "").trim() || genPassword();
    if (password.length < 6) return bad("Password must be at least 6 characters.");
    // token_version bump = "log out everywhere" (same rule as /api/admin/users).
    const cur = (await sb.from("staff_users").select("token_version").eq("id", ownerId).limit(1)).data?.[0];
    const { error } = await sb.from("staff_users")
      .update({ ...(await passwordFields(password)), token_version: ((cur?.token_version as number) || 0) + 1, failed_count: 0, locked_until: null })
      .eq("id", ownerId);
    if (error) return adminFail("this owner's password", error, { action: "save" });
    await logAction("admin", "owner_reset_password", { actor: "admin", restaurant_id: null, detail: `reset password for owner "${who}" · owner ${ownerId}` });
    return ok({ ok: true, password });
  }

  if (action === "set_active") {
    const active = body?.active === true;
    const cur = (await sb.from("staff_users").select("token_version").eq("id", ownerId).limit(1)).data?.[0];
    // Suspending also bumps token_version so any live session dies immediately.
    const patch: Record<string, unknown> = { active };
    if (!active) patch.token_version = ((cur?.token_version as number) || 0) + 1;
    const { error } = await sb.from("staff_users").update(patch).eq("id", ownerId);
    if (error) return adminFail("this owner's status", error, { action: "save" });
    await logAction("admin", active ? "owner_restore" : "owner_suspend", { actor: "admin", restaurant_id: null, detail: `${active ? "restored" : "suspended"} owner "${who}" · owner ${ownerId}` });
    return ok({ ok: true, active });
  }

  if (action === "delete_forever") {
    // Kept for API symmetry — reject here so no one wires a PATCH to a destructive
    // action by accident. DELETE now moves to the recycle bin; POST purge_owner is
    // the permanent step (after 90 days).
    return bad("Use DELETE /api/admin/owners?id=… to bin, or POST purge_owner to remove permanently.", 405);
  }

  if (action === "rename") {
    const display = String(body?.name ?? "").trim().slice(0, 80);
    const key = normalizeLoginName(display);
    if (realCharCount(key) < 2) return bad("The name needs at least 2 letters or numbers.");
    if (key !== owner.username) { const m = await nameTakenMessage(key); if (m) return bad(m, 409); }
    const { error } = await sb.from("staff_users").update({ name: display, username: key }).eq("id", ownerId);
    if (error) return adminFail("this owner's name", error, { action: "save" });
    await logAction("admin", "owner_rename", { actor: "admin", restaurant_id: null, detail: `renamed owner "${who}" → "${display}" · owner ${ownerId}` });
    return ok({ ok: true });
  }

  return bad("Unknown action.");
}

// The old permanent-delete guts, now used ONLY by purge_owner (after the 90-day
// bin lock). Hands each restaurant's PRIMARY pointer to a remaining co-owner (or
// clears it — owner_user_id must never point at someone with no membership), drops
// the join rows, then deletes the staff_users row. Returns how many restaurants
// were released. staff_actions rows are kept on purpose (audit outlives account).
async function hardDeleteOwner(ownerId: string): Promise<{ error?: string; released: number }> {
  const links = (await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", ownerId).limit(2000)).data || [];
  for (const l of links) {
    const rid = l.restaurant_id as string;
    const r = (await sb.from("restaurants").select("owner_user_id").eq("id", rid).limit(1)).data?.[0];
    if (r?.owner_user_id === ownerId) {
      const next = (await sb.from("restaurant_owners").select("user_id").eq("restaurant_id", rid).neq("user_id", ownerId).limit(1)).data?.[0];
      const set = await sb.from("restaurants").update({ owner_user_id: next?.user_id ?? null }).eq("id", rid);
      if (set.error) return { error: dbNote("release a restaurant", set.error), released: 0 };
    }
  }
  const delLinks = await sb.from("restaurant_owners").delete().eq("user_id", ownerId);
  if (delLinks.error) return { error: dbNote("drop the ownership links", delLinks.error), released: 0 };
  const delUser = await sb.from("staff_users").delete().eq("id", ownerId);
  if (delUser.error) return { error: dbNote("delete the owner row", delUser.error), released: 0 };
  return { released: links.length };
}

// ── DELETE ?id=<owner_id> — move the owner to the RECYCLE BIN (soft-delete). ──
// Owner's rule (2026-07-06): the account must be SUSPENDED first (the reversible
// step). Binning sets deleted_at so the owner drops out of the Owners list; their
// login is already dead (suspended). NOTHING is erased — restaurant links + primary
// pointers stay intact, so a Restore from the bin brings ownership straight back.
// After 90 days they can be permanently purged (POST purge_owner). Mirrors the
// restaurant recycle bin (soft_delete_restaurant, mig 128/208).
export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const url = new URL(req.url);
  const ownerId = url.searchParams.get("id") || "";
  if (!ownerId) return bad("Missing id.");
  const o = (await sb.from("staff_users").select("id, username, name, role, active, deleted_at").eq("id", ownerId).limit(1)).data?.[0];
  if (!o || o.role !== "owner") return bad("That user isn't an owner.", 404);
  if (o.active) return bad("Suspend this owner first — deleting only moves a suspended account to the recycle bin.", 409);
  if (o.deleted_at) return bad("That owner is already in the recycle bin.", 409);
  const reason = (url.searchParams.get("reason") || "").trim().slice(0, 300) || null;
  const who = o.name || o.username;
  const { error } = await sb.from("staff_users")
    .update({ deleted_at: new Date().toISOString(), deleted_by: "admin", delete_reason: reason }).eq("id", ownerId);
  if (error) return adminFail("this owner's move to the recycle bin", error, { action: "save" });
  await logAction("admin", "owner_soft_delete", {
    actor: "admin", restaurant_id: null, // platform-level (mig 156)
    detail: `moved owner "${who}" to recycle bin${reason ? ` · reason: ${reason}` : ""} · owner ${ownerId}`,
  });
  return ok({ ok: true, deleted: true });
}
