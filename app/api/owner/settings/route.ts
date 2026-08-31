// /api/owner/settings
//   GET  → the signed-in owner's account view: their name, the owner-panel sections the
//          admin has enabled for them (read-only — the admin controls these), and the list
//          of restaurants they own. Scoped via ownerScope; no money, no other tenant.
//   POST → self password change (the logged-in OWNER only): verify current, set new, bump
//          token_version. That invalidates the current cookie, so the client re-logs in.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScopeOr503, dbFail, scopedRestaurantIds, RestaurantListIncomplete, incompleteListResponse , ownerLogPanel } from "@/lib/ownerScope";
import { restaurantNames } from "@/lib/restaurantNames";
import { getOwnerEntitlementsUnion, OWNER_SECTION_KEYS, entitledSubset } from "@/lib/ownerEntitlements";
import { USER_COOKIE, userFromCookie, verifySecret } from "@/lib/userAuth";
import { passwordFields } from "@/lib/passwordVault";
import { MODULE_DEFS } from "@/lib/accessModel";
import { logAction } from "@/lib/oplog";
import { rateAllowed, rateResetOnSuccess } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// The laddered modules an admin can hand to an owner (…_owner_control) — MODULE_DEFS,
// DERIVED from lib/accessModel.ts (2026-07-26). The old hand-typed copy here was
// missing parcel: an admin who transferred parcel control gave the owner a toggle
// that never appeared on this page. The PATCH below only accepts these keys, and
// only while the transfer is on.

export async function GET(req: NextRequest) {
  // A SCOPE WE COULD NOT READ IS NOT "YOU ARE NOBODY" (T20 sweep, 2026-08-19). `ownerScope()` throws
  // OwnerScopeUnavailable when the act-as widen read fails — deliberately, so a blip can never
  // silently shrink the view — and `ownerScopeOr503()` was written in the same change to turn that
  // into a retryable 503 with a sentence a person can act on. It had NO callers: all twelve owner
  // routes still called `ownerScope()` bare, so the throw reached Next unhandled and the owner got a
  // blank 500 with no retry. Same 401 as before for a real "not you"; the only new answer is the 503.
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  const scope = sc.scope;
  try {
  const owner = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  const name = owner?.name || owner?.username || (scope.admin ? "Admin" : "Owner");

  const sections: Record<string, boolean> = {};
  let restaurants: { id: string; name: string }[] = [];
  if (scope.all) {
    for (const k of OWNER_SECTION_KEYS) sections[k] = true; // admin all-view: everything on
    // ── THE ADMIN GOT AN EMPTY PAGE (T9 finding F16, fixed 2026-08-12) ──────────────────────────
    // `restaurants` was only ever filled in the `else` branch, so a plain admin session (scope.all,
    // no act-as) left it `[]` — which then made `modIds` empty and skipped the module-toggle block
    // entirely. The admin's own Settings page listed no restaurants and no switches: not obviously
    // broken, just silently empty, which is the opposite of "admin = top power".
    // Paged through the shared helper so a platform with more restaurants than PostgREST's row cap
    // doesn't lose the tail (the same cap that bit `scopedRestaurantIds`).
    const all = await restaurantNames(await scopedRestaurantIds(scope));
    restaurants = all.ids.map((id) => ({ id, name: all.get(id) || "" })).sort((a, b) => a.name.localeCompare(b.name));
  } else {
    const ent = await getOwnerEntitlementsUnion(scope.ids);
    for (const k of OWNER_SECTION_KEYS) sections[k] = ent[k] !== false;
    // Ladder rule (docs/ACCESS-MODEL.md): a section that's OFF is REFUSED by the server,
    // not just hidden from the nav. The "settings" section had no server gate — a real
    // owner whose Settings section the admin switched off could still open this page
    // directly and change their password. Refuse here (matches customers/reports/issues)
    // so both this GET and the self password-change POST below are truly closed. (The
    // module-toggle PATCH already checks the per-restaurant "settings" entitlement.)
    if (ent.settings === false)
      return NextResponse.json({ error: "Settings isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    // Per-restaurant privacy (Stage 7): the settings page only lists restaurants whose
    // "settings" section the admin granted this owner — so they can't view/edit another
    // restaurant's appearance/config that the admin withheld. Union above still decides
    // whether the nav item exists at all; this decides WHICH restaurants appear inside.
    const settingsIds = scope.admin ? scope.ids : await entitledSubset(scope.ids, "settings");
    // ── A BLIP MUST NOT EMPTY THE PAGE (T20 sweep, 2026-08-19) ──────────────────────────────────
    // `r.error` was never inspected, so a failed read left `restaurants` as `[]` — and everything
    // below is keyed off that list: `modIds`, so the module-toggle block is skipped; `nameOf`, so
    // any surviving row is nameless; and the printing block, which reads `restaurants` directly. The
    // owner opened Settings and saw a page with no restaurants, no feature switches and no printing
    // rows, with nothing saying why.
    //
    // This is EXACTLY finding F16 (2026-08-12) in the branch F16 did not cover: that fix filled the
    // list for the ADMIN's `scope.all` view and left the real owner's `else` branch — the majority
    // case — reading the same way it always had. The list is the page here, so a failed read is a
    // retryable answer, not a shorter page (the same rule `part.error` follows a few lines down).
    const r = await sb.from("restaurants").select("id, name")
      .in("id", settingsIds.length ? settingsIds : [" "]).order("name").limit(Math.max(settingsIds.length, 1));
    if (r.error) return dbFail("owner/settings.restaurants", r.error, {
      message: "Couldn't load your restaurants just now — please try again.",
    });
    restaurants = (r.data || []) as { id: string; name: string }[];
  }
  // Only a REAL logged-in owner (not the admin act-as, which has no password row here) may
  // change their password from this page.
  const canChangePassword = !!owner && owner.role === "owner";

  // Feature ladder (mig 166): modules whose on/off the admin TRANSFERRED to this owner
  // (table_tags_owner_control) — those get a toggle on the owner's settings page. A
  // restaurant without the transfer never appears here (admin keeps the switch).
  const modIds = scope.all ? restaurants.map((r) => r.id) : scope.ids;
  const modules: { restaurant_id: string; name: string; key: string; label: string; enabled: boolean }[] = [];
  // One row per (restaurant, transferred module) — generalised for every laddered
  // module (mig 166 table_tags, mig 167 banquet); add new modules to MODULE_DEFS.
  if (modIds.length) {
    const modCols = MODULE_DEFS.flatMap((d) => [d.allowed, d.control, d.enabled]);
    // ── PAGED, NOT A FLAT .limit(200) (T9 improvement 10, 2026-08-06) ────────────────────────────
    // This read used to end in `.limit(200)`. An owner past 200 restaurants would silently lose the
    // module toggles for the rest — the switches would simply not be on the page, with nothing
    // saying so, which is the exact class `scopedRestaurantIds` was written to page around ("a flat
    // .limit(100) silently dropped every restaurant past the 100th"). Unreachable today; closed
    // before it isn't, because the symptom is invisible.
    //
    // Chunked by INPUT ids rather than range(), because the filter is an `.in(...)` list: a URL with
    // a thousand ids in it is its own problem, so this also keeps each request small.
    // Dynamic column list → supabase can't infer the row shape; cast via unknown.
    const CHUNK = 200;
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < modIds.length; i += CHUNK) {
      const part = await sb.from("settings")
        .select(["restaurant_id", ...modCols].join(", "))
        .in("restaurant_id", modIds.slice(i, i + CHUNK));
      // A failed chunk must not quietly hide a switch the admin handed over, so say so rather than
      // render a page that is missing toggles for no visible reason.
      if (part.error) return dbFail("owner/settings.modules", part.error, {
        message: "Couldn't load your feature switches just now — please try again.",
      });
      rows.push(...((part.data || []) as unknown as Record<string, unknown>[]));
    }
    const nameOf = new Map(restaurants.map((r) => [r.id, r.name]));
    for (const s of rows as Record<string, unknown>[]) {
      for (const def of MODULE_DEFS) {
        if (s[def.allowed] !== true || s[def.control] !== true) continue;
        modules.push({
          restaurant_id: String(s.restaurant_id),
          name: nameOf.get(String(s.restaurant_id)) || "",
          key: def.key,
          label: def.label,
          enabled: s[def.enabled] !== false,
        });
      }
    }
  }
  // ── KITCHEN PRINTING, per restaurant (owner, 2026-08-19) ──────────────────────────────────────
  // He asked for printing to be visible in the owner panel too — "divide whole printing in both
  // manager as well as owner and kitchen" — and for nothing to show when it is off. So one row per
  // restaurant that HAS it on, saying which screen is printing right now (mig 338). No controls: the
  // owner is not standing at the printer, and the switch is the admin's (mig 107).
  // Two small indexed reads over restaurants this owner already has, and only when there is one.
  const printing: { restaurant_id: string; name: string; target: string; station: string | null; stale: boolean }[] = [];
  // WAS THE LIST SHORTENED, OR IS PRINTING SIMPLY OFF? Those two produce the identical answer — an
  // empty array — and the page showed the identical thing for both: no Kitchen printing section at
  // all. So a wobble on either read made a section the owner had been given silently disappear and
  // come back, which reads as "the feature was taken away from me". Neither read checked itself:
  // `.data || []` turns a failed query into an empty list with no error anywhere.
  // The page needs the difference, so it is answered here. A restaurant with printing genuinely off
  // still shows nothing — that rule is his and does not change.
  let printingOk = true;
  try {
    const ids = restaurants.map((r) => r.id);
    if (ids.length) {
      const [setRows, stRows] = await Promise.all([
        sb.from("settings").select("restaurant_id, auto_print_kot, auto_print_kot_allowed, modules").in("restaurant_id", ids),
        sb.from("print_stations").select("restaurant_id, label, panel, claimed_by, last_seen_at").in("restaurant_id", ids).eq("active", true),
      ]);
      // A read that failed is not a restaurant with no printing. `print_stations` is the softer of
      // the two: without it the rows still render and just cannot say WHICH screen is printing, so
      // it does not shorten anything and must not raise the flag.
      if (setRows.error) printingOk = false;
      const byRid = new Map(((stRows.data || []) as Record<string, unknown>[]).map((r) => [String(r.restaurant_id), r]));
      const nameOf2 = new Map(restaurants.map((r) => [r.id, r.name]));
      for (const row of (setRows.data || []) as Record<string, unknown>[]) {
        if (row.auto_print_kot !== true || row.auto_print_kot_allowed !== true) continue;   // off → not mentioned at all
        const rid2 = String(row.restaurant_id);
        const st = byRid.get(rid2) as { label?: string; panel?: string; claimed_by?: string; last_seen_at?: string } | undefined;
        printing.push({
          restaurant_id: rid2,
          name: nameOf2.get(rid2) || "",
          // DERIVED FROM THE KITCHEN SLIPS ROUTE (mig 369), never from the retired column. The three
          // words the owner's page prints are unchanged, so nothing there had to be reworded.
          target: (() => {
            const bag = row.modules && typeof row.modules === "object" ? row.modules as Record<string, Record<string, unknown>> : {};
            const k = ((bag.printing?.routes || {}) as Record<string, Record<string, unknown>>).kot || {};
            if (k.via !== "screen") return "kitchen";
            // "both" IS UNREACHABLE and stays deleted (owner, 2026-08-30). It meant "the kitchen
            // prints and the counter picks up what it leaves" — the backup screen, which is gone.
            // `k.backupPanel` had already stopped existing, so this read undefined every time and
            // the branch was dead code that still LOOKED like a supported answer.
            // (Found twice on 2026-08-31, an hour apart: by pulling the thread of his question about
            // the Kitchen printing section, and by T25 round 3's re-run of the four old rows that were
            // still defending the backup printer.)
            return k.panel === "manager" ? "counter" : "kitchen";
          })(),
          station: st ? (st.label || (st.panel === "editor" ? "A counter screen" : "A kitchen screen")) + (st.claimed_by ? ` · ${st.claimed_by}` : "") : null,
          stale: !!(st?.last_seen_at && Date.now() - Date.parse(st.last_seen_at) > 3 * 60 * 1000),
        });
      }
    }
  } catch { printingOk = false; /* a printing row is a nicety; never let it shorten the page — but SAY it was shortened */ }
  return NextResponse.json({ name, isAdmin: !!scope.admin, canChangePassword, sections, restaurants, modules, printing, printingOk });
  } catch (e) {
    // A half-read restaurant list must not silently shorten the admin's page (same rule as
    // `scopedRestaurantIds` everywhere else).
    if (e instanceof RestaurantListIncomplete) return incompleteListResponse();
    throw e;
  }
}

// PATCH — the owner flips a module the admin transferred to them (mig 166).
//   { restaurant_id, key: "table_tags", enabled: boolean }
export async function PATCH(req: NextRequest) {
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  const scope = sc.scope;
  const body = await req.json().catch(() => ({}));
  const rid = String(body?.restaurant_id || "");
  const def = MODULE_DEFS.find((d) => d.key === String(body?.key || ""));
  const enabled = body?.enabled;
  if (!rid || !def || typeof enabled !== "boolean")
    return NextResponse.json({ error: "restaurant_id, key and enabled (true/false) required." }, { status: 400 });
  if (!scope.all && !scope.ids.includes(rid))
    return NextResponse.json({ error: "That restaurant isn't yours." }, { status: 403 });
  // Per-restaurant privacy (Stage 7): a REAL owner can only touch the settings of a restaurant
  // whose "settings" section the admin granted them (admin act-as is unrestricted).
  if (!scope.all && !scope.admin && !(await entitledSubset([rid], "settings")).length)
    return NextResponse.json({ error: "The admin hasn't given you settings for this restaurant." }, { status: 403 });
  // The toggle only works while the admin has transferred control (and the feature exists).
  const s = (await sb.from("settings").select(`${def.allowed}, ${def.control}`).eq("restaurant_id", rid).maybeSingle()).data as Record<string, boolean> | null;
  if (!s?.[def.allowed]) return NextResponse.json({ error: "This feature isn't enabled for that restaurant." }, { status: 403 });
  if (!s[def.control]) return NextResponse.json({ error: "The admin hasn't handed you this switch." }, { status: 403 });
  const { error } = await sb.from("settings").update({ [def.enabled]: enabled }).eq("restaurant_id", rid);
  if (error) return dbFail("owner/settings.module", error, { message: "Couldn't change that switch — please try again." });
  // A module turning itself off changes what a whole panel offers, and nothing recorded it — so with
  // two co-owners nobody could say who flipped it (sweep 2026-08-04). Unlike issues/ratings there is
  // no in-row stamp to fall back on: the settings column holds only the value.
  await logAction(ownerLogPanel(scope), "module_toggle", {
    restaurant_id: rid, actor: scope.admin ? "admin" : (("ownerId" in scope && scope.ownerId) || "owner"),
    detail: `${def.label} → ${enabled ? "on" : "off"}`,
  });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const owner = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!owner || owner.role !== "owner")
    return NextResponse.json({ error: "Only a signed-in owner can change their password here." }, { status: 403 });
  // Same rung as GET: if the admin switched this owner's Settings section off, the self
  // password-change is refused server-side too (not just hidden from the nav).
  // Same T20 note as the GET above, with one difference that matters: here a NULL scope is
  // deliberately tolerated — an owner who currently has no enabled restaurant may still change their
  // own password, and the guard at the top of POST is what proves they are an owner. So only the
  // "we couldn't work out your restaurants" answer (503) is returned early; a 401 falls through
  // exactly as `!scope` did before.
  const sc = await ownerScopeOr503(req);
  if (sc.resp && sc.resp.status !== 401) return sc.resp;
  const scope = sc.scope ?? null;
  if (scope && !scope.all) {
    const ent = await getOwnerEntitlementsUnion(scope.ids);
    if (ent.settings === false)
      return NextResponse.json({ error: "Settings isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const current = String(body?.current || "");
  const next = String(body?.next || "");
  if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
  if (next === current) return NextResponse.json({ error: "New password must be different from the current one." }, { status: 400 });

  const row = (await sb.from("staff_users").select("password_hash, token_version").eq("id", owner.id).maybeSingle()).data as
    { password_hash: string | null; token_version: number } | null;
  if (!row) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  // Same wall as app/api/panel-profile (sweep 2026-08-04, mig 277) — see the note there for why an
  // already-signed-in password box still needs one. Counted per account, before the check.
  if (!(await rateAllowed("password_change", owner.id, {
    restaurantId: owner.restaurant_id ?? null,
    label: `Owner ${owner.name || owner.username} changing their own password`,
  }))) {
    return NextResponse.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });
  }
  if (!(await verifySecret(current, row.password_hash)))
    return NextResponse.json({ error: "Your current password is wrong." }, { status: 403 });
  // The SAME restaurant the wall was counted under (see rateAllowed just above), so the reset
  // provably clears this account's own row and not one another restaurant happens to share.
  await rateResetOnSuccess("password_change", owner.id, owner.restaurant_id ?? null);

  const { error } = await sb.from("staff_users")
    .update({ ...(await passwordFields(next)), token_version: (row.token_version || 0) + 1 })
    .eq("id", owner.id);
  if (error) return dbFail("owner/settings.password", error, { message: "Couldn't change your password — please try again." });
  // Bumping token_version ends EVERY session on this account, so the visible symptom is "everyone
  // got logged out" with nothing to explain it. app/api/panel-profile already logs its equivalent
  // self-change as `password_change`; this one didn't (sweep 2026-08-04).
  // Always the OWNER's own log: this route refuses anyone who is not a signed-in owner (the guard at
  // the top of POST), so there is no admin path to hide here — and "everyone got logged out" is
  // exactly the event the owner needs to find an explanation for.
  await logAction("owner", "password_change", {
    restaurant_id: owner.restaurant_id ?? undefined,
    actor: owner.name || owner.username, actor_id: owner.id,
    detail: `${owner.name || owner.username} changed their own password (all their sessions ended)`,
  });
  // token_version bumped → the current cookie no longer validates; the client re-logs in.
  return NextResponse.json({ ok: true, reauth: true });
}
