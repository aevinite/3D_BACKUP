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
import { ownerScope, inScope, dbFail } from "@/lib/ownerScope";
import { entitledSubset, logViewSubset, mergeOwnerEntitlements } from "@/lib/ownerEntitlements";
import { ADMIN_VIEW_ACTOR_ID } from "@/lib/logMarks";

// Which VISIBILITY switch (Access → Owner → Owner's menu → Audit and log) a log row rides.
// These filter what the owner's page SHOWS — never what gets recorded (the money/bill audit
// trail is not switchable, docs/COMPLIANCE-GUARDRAILS.md). Absent key = ON, so nothing
// changes for a restaurant until the admin switches a kind off.
function logKindKey(action: string): "logs_signins" | "logs_staff_changes" | "logs_service" {
  if (action === "login" || action === "login_failed") return "logs_signins";
  if (action.startsWith("staff_") || action.startsWith("user_")) return "logs_staff_changes";
  return "logs_service";
}

export const dynamic = "force-dynamic";

// The columns the Activity list + its detail popup render — nothing more crosses the wire.
const COLS = "id, panel, action, actor, actor_id, device_id, order_id, detail, table_number, restaurant_id, level, seen_at, resolved_at, created_at";

export async function GET(req: NextRequest) {
  let scope = await ownerScope(req);
  if (!scope) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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

  let q = sb.from("staff_actions").select(COLS).order("created_at", { ascending: false }).limit(limit);
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
    if (!inScope(scope, pinRid)) return NextResponse.json({ actions: [] });
    q = q.eq("restaurant_id", pinRid);
  } else if (!scope.all) {
    // Restrict to the owner's restaurant(s). A real owner (or admin act-as one restaurant) is
    // always scope.all === false with a concrete id list; only an admin scope=all skips this.
    if (!scope.ids.length) return NextResponse.json({ actions: [] });
    q = q.in("restaurant_id", scope.ids);
  }
  // Only the owner-visible severities are selectable (never "error" — excluded above).
  if (level === "warn" || level === "info") q = q.eq("level", level);
  // Optional ?actor=<staff uuid> — ONE person's record, for the Activity tab on their profile
  // (mig 220). Indexed by (restaurant_id, actor_id, created_at); it can only NARROW what the
  // scope above already allows, so it needs no extra permission of its own.
  const actorId = url.searchParams.get("actor");
  if (actorId) {
    if (!/^[0-9a-f-]{36}$/i.test(actorId)) return NextResponse.json({ actions: [] });
    q = q.eq("actor_id", actorId);
  }
  if (qText) {
    const safe = qText.replace(/[%,()]/g, " ");
    q = q.or(`action.ilike.%${safe}%,detail.ilike.%${safe}%`);
  }

  const r = await q;
  if (r.error) return dbFail("owner/oplog", r.error, { message: "Couldn't load the activity log just now — please try again." });
  let rows = r.data ?? [];

  // Stamp each row with its restaurant NAME so a multi-restaurant owner can tell them apart
  // (one batched lookup, no N+1). Single-restaurant owners simply ignore it. The same lookup
  // now carries owner_entitlements for the per-kind visibility switches below — still one read.
  const ids = Array.from(new Set(rows.map((a) => a.restaurant_id).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  const entsById = new Map<string, Record<string, boolean>>();
  if (ids.length) {
    const rest = await sb.from("restaurants").select("id, name, owner_entitlements").in("id", ids);
    for (const x of rest.data ?? []) { nameById.set(x.id, x.name); entsById.set(x.id, mergeOwnerEntitlements(x.owner_entitlements)); }
  }
  // Per-kind VISIBILITY (owner, 2026-08-02): a kind the admin switched off for a restaurant
  // leaves the owner's view. Rows are ≤200 here, so this JS pass costs nothing. The ADMIN's
  // own session is never filtered (X-ray: the admin always sees the full record).
  if (!scope.admin) {
    rows = rows.filter((a) => {
      if (!a.restaurant_id) return true;
      const ents = entsById.get(a.restaurant_id);
      return !ents || ents[logKindKey(String(a.action || ""))] !== false;
    });
  }
  const actions = rows.map((a) => ({ ...a, restaurant_name: a.restaurant_id ? nameById.get(a.restaurant_id) ?? null : null }));
  // Actions the ADMIN performed from a panel view carry actor_id='admin:view' (2026-07-28).
  // Only the admin may see that marker — a REAL owner gets the row as a plain, neutral
  // panel action (the admin stays invisible, per the standing rule).
  if (!scope.admin) for (const a of actions) if (a.actor_id === ADMIN_VIEW_ACTOR_ID) a.actor_id = null;
  return NextResponse.json({ actions });
}
