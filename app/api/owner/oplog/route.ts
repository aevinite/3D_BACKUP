// GET /api/owner/oplog — the owner's Activity log: every staff action across THEIR
// restaurant(s), so the owner can see who did what (and, for a tablet action, which
// manager's PIN unlocked it), then click any row for the full detail.
//
// SCOPE (ownerScope, lib/ownerScope):
//   • a real OWNER → only the restaurants they own (restaurant_owners, mig 097);
//   • the ADMIN act-as → the one restaurant they've entered (or all, scope=all).
// The owner sees their OWN owner-level actions AND their staff's (manager/kitchen/
// tablet) — but NOT the admin's actions or the raw 'db' manual-edit footprints (those
// stay in the admin's Everything Log). Unlike the admin feed, money is NOT redacted:
// it's the owner's own restaurant data.
//
// Egress-safe (data-cost-guard): scoped by restaurant_id, an explicit column list, and
// a hard limit — never a whole-table read.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScopeOr503, inScope, dbFail } from "@/lib/ownerScope";
import { entitledSubset, logViewSubset } from "@/lib/ownerEntitlements";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";
import { loadLogVisibility, logVisibilityUnavailable } from "@/lib/logVisibility";
import { restaurantNames } from "@/lib/restaurantNames";
import { safeSearch } from "@/lib/searchText";
import { trailOf } from "@/lib/logTrail";

// WHICH VISIBILITY SWITCH A ROW RIDES now lives in lib/logVisibility.ts, together with the decision
// about what to do when the switches cannot be read (T9 finding F23, fixed 2026-08-12).
//
// It moved out of this file for one reason: the old code did the filtering with
// `return !ents || ents[logKindKey(...)] !== false`, where `!ents` meant "show it". That expression
// cannot tell "this restaurant has nothing stored, so everything is on" (correct, deliberate) apart
// from "the read that would have told me failed" — and on the second one it SHOWED rows the admin
// had switched off. A switch that fails open is not a switch. The two states are now different
// TYPES, so they cannot be confused again, and `npm run verify:log-visibility` fails the build if a
// route goes back to reading `owner_entitlements` by hand to filter activity.

export const dynamic = "force-dynamic";

// The columns the Activity list + its detail popup render — nothing more crosses the wire.
const COLS = "id, panel, action, actor, actor_id, device_id, order_id, detail, table_number, restaurant_id, level, seen_at, resolved_at, created_at";

export async function GET(req: NextRequest) {
  // A SCOPE WE COULD NOT READ IS NOT "YOU ARE NOBODY" (T20 sweep, 2026-08-19). `ownerScope()` throws
  // OwnerScopeUnavailable when the act-as widen read fails — deliberately, so a blip can never
  // silently shrink the view — and `ownerScopeOr503()` was written in the same change to turn that
  // into a retryable 503 with a sentence a person can act on. It had NO callers: all twelve owner
  // routes still called `ownerScope()` bare, so the throw reached Next unhandled and the owner got a
  // blank 500 with no retry. Same 401 as before for a real "not you"; the only new answer is the 503.
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  let scope = sc.scope;

  // The owner's Log page is a listed switch (Access → Owner's menu → Logs) since the access
  // rebuild, so hiding the nav item is not enough — this endpoint has to refuse too, or the
  // page would still answer to anyone who typed the URL. A real owner loses restaurants whose
  // "logs" entitlement the admin switched off; the admin's own session is never gated.
  if (!scope.all && !scope.admin) {
    const allowed = await logViewSubset(await entitledSubset(scope.ids, "logs"), "activity");
    if (!allowed.length)
      return NextResponse.json({ error: "The activity log isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope = { ...scope, ids: allowed };
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1), 200);
  const level = url.searchParams.get("level");
  const qText = (url.searchParams.get("q") || "").trim().slice(0, 80);
  // ── PAGING (owner, 2026-08-12: "make it like pages, you can go to page 2 from bottom") ─────────
  // The log used to show the newest 200 and simply stop, with no way to reach last week — on the one
  // screen whose whole job is answering "who did that, and when?". 200 a page is the owner's own
  // number. `range()` is an indexed offset read on (restaurant_id, created_at DESC), which already
  // exists, so page 5 costs the same as page 1.
  const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);
  const from = (page - 1) * limit;

  // `count: "exact"` rides along on the same request — it is what lets the footer say "page 2 of 9"
  // instead of a bare "next", which is the difference between navigable and guessing.
  let q = sb.from("staff_actions").select(COLS, { count: "exact" })
    .order("created_at", { ascending: false }).range(from, from + limit - 1);
  // Owner never sees the admin's own actions or the direct-database-edit footprints.
  q = q.not("panel", "in", "(admin,db)");
  // …nor raw app/system FAULTS (level='error'). Those are technical support signals for the
  // admin side, not the owner — the owner's "problems" surface is Complaints (the issues
  // table), not the error log (owner 2026-07-26). Keep every non-error row, including rows
  // whose level is NULL (an OR so a plain `neq` doesn't silently drop the NULLs).
  q = q.or("level.is.null,level.neq.error");
  // …nor the raw BUTTON-TAP breadcrumbs (T9 sweep, 2026-08-05). `ui_taps` rows are written by
  // public/panels/errlog.js purely so a support person can see what someone was doing just before a
  // crash — they are level:'info' on a normal panel, so they passed both filters above and landed in
  // the owner's Activity list, where the editor's label renders them as "Button taps". Hundreds of
  // those push the real staff actions off this 200-row page, which is the same "a board full of
  // non-faults is a board nobody reads" problem the errlog noise filter exists for. They stay in the
  // ADMIN's Everything Log, exactly like the 'admin'/'db' rows excluded above.
  q = q.neq("action", "ui_taps");
  // Optional ?rid= — narrow to ONE selected restaurant (the top-strip restaurant pick / an
  // admin act-as one restaurant), mirroring how /api/owner/reports scopes. Only honoured when
  // that id is already in the caller's scope (an admin's scope is every restaurant), so it can
  // only NARROW, never widen. Without it, fall back to the owner's full restaurant set.
  const pinRid = url.searchParams.get("rid");
  if (pinRid) {
    if (!inScope(scope, pinRid)) return NextResponse.json({ actions: [], page: 1, pageSize: limit, total: 0, pages: 1 });
    q = q.eq("restaurant_id", pinRid);
  } else if (!scope.all) {
    // Restrict to the owner's restaurant(s). A real owner (or admin act-as one restaurant) is
    // always scope.all === false with a concrete id list; only an admin scope=all skips this.
    if (!scope.ids.length) return NextResponse.json({ actions: [], page: 1, pageSize: limit, total: 0, pages: 1 });
    q = q.in("restaurant_id", scope.ids);
  }
  // Only the owner-visible severities are selectable (never "error" — excluded above).
  if (level === "warn" || level === "info") q = q.eq("level", level);
  // Optional ?actor=<staff uuid> — ONE person's record, for the Activity tab on their profile
  // (mig 220). Indexed by (restaurant_id, actor_id, created_at); it can only NARROW what the
  // scope above already allows, so it needs no extra permission of its own.
  const actorId = url.searchParams.get("actor");
  if (actorId) {
    if (!/^[0-9a-f-]{36}$/i.test(actorId)) return NextResponse.json({ actions: [], page: 1, pageSize: limit, total: 0, pages: 1 });
    q = q.eq("actor_id", actorId);
  }
  if (qText) {
    // ONE sanitiser for every owner search box (T9 finding F15, fixed 2026-08-12). The old local
    // copy stripped `%,()` but left `*` alone — and PostgREST translates `*` to `%` inside `ilike`,
    // so searching for `*` matched EVERY row instead of the literal character. lib/searchText.ts is
    // now the only place that decides what a typed search may contain.
    const safe = safeSearch(qText);
    if (safe) q = q.or(`action.ilike.%${safe}%,detail.ilike.%${safe}%`);
  }

  const r = await q;
  if (r.error) return dbFail("owner/oplog", r.error, { message: "Couldn't load the activity log just now — please try again." });
  const fetched = r.data ?? [];

  const ids = Array.from(new Set(fetched.map((a) => a.restaurant_id).filter(Boolean))) as string[];

  // ── WHAT THIS OWNER IS ALLOWED TO SEE ────────────────────────────────────────────────────────
  // Its own module, and it fails CLOSED: if the switches can't be read we answer "try again"
  // rather than showing rows we could not check (T9 finding F23). The ADMIN's own session is
  // X-ray and needs no read at all.
  const vis = await loadLogVisibility(ids, !!scope.admin);
  if (!vis.ok) return logVisibilityUnavailable();
  const rows = vis.visibility.filter(fetched);

  // Stamp each row with its restaurant NAME so a multi-restaurant owner can tell them apart (one
  // batched lookup, no N+1). A FAILED lookup used to render every row's restaurant as "—", which on
  // a multi-restaurant estate makes the list unreadable with nothing saying why (T9 finding F17);
  // the shared helper reports that instead of hiding it.
  const names = await restaurantNames(ids);
  // ── EVERY ROW CARRIES ITS TRAIL (owner, 2026-08-12) ──────────────────────────────────────────
  // "there should be restaurant name, which panel, inside panel which menu … he clicked take order
  // but from where, table detail." A row used to say `order_place` → "Placed order", which is true
  // and nearly useless: it never said WHERE the person was standing. `trailOf` resolves the path —
  // restaurant › panel › area › screen › which table — from what the row already carries, so all
  // 30,000 rows already in the table get one too, not just the ones written from today.
  const actions = rows.map((a) => {
    const withName = { ...a, restaurant_name: a.restaurant_id ? names.get(a.restaurant_id) : null };
    return { ...withName, trail: trailOf(withName) };
  });
  // Actions the ADMIN performed from a panel view carry actor_id='admin:view' (2026-07-28).
  // Only the admin may see that marker — a REAL owner gets the row as a plain, neutral
  // panel action (the admin stays invisible, per the standing rule).
  if (!scope.admin) for (const a of actions) if (a.actor_id === ADMIN_VIEW_ACTOR_ID) a.actor_id = null;
  // The FILTERED count, not the raw one: `total` is what the footer divides into pages, and the
  // per-kind visibility filter above can remove rows from this page. Reporting the unfiltered count
  // would promise pages that render empty. When something was filtered we fall back to the count of
  // what we can actually show, which is the honest floor.
  const rawTotal = r.count ?? actions.length;
  const filteredOut = fetched.length - rows.length;
  const total = filteredOut > 0 ? Math.max(actions.length, rawTotal - filteredOut) : rawTotal;
  return NextResponse.json({
    actions,
    page, pageSize: limit, total, pages: Math.max(1, Math.ceil(total / limit)),
    ...(names.partial ? { partial: ["restaurantNames"] } : {}),
  });
}
