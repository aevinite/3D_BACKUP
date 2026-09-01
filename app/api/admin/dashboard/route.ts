// GET /api/admin/dashboard — ONE call that returns everything the admin home screen needs,
// so the dashboard makes a single round-trip instead of six (audit 2026-07-07). This cuts
// repeated egress on the 60s refresh: notably it returns ONLY the currently-online staff
// (a small, time-filtered list, ≤200) instead of hauling the whole staff_users table every
// cycle, and it reuses the pre-aggregated lfh_owner_overview RPC for per-restaurant open counts.
// Admin-gated (each admin route checks the cookie itself — there is no middleware).
// NO food money anywhere (hard rule): only counts, and lfh_owner_overview's revenue columns
// are deliberately dropped here. Activity `detail` is redacted for money.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
// ONE ANSWER TO "DID EVERY ONE OF THESE READS WORK?" — lib/readGuard (item 15, owner-approved
// 2026-09-01). One retry on a transient connection failure, one log line naming WHICH read went, and
// a tolerated read that says so at the call site. The console's answer is unchanged.
import { ReadSet, rd } from "@/lib/readGuard";
import { businessDayStartIso } from "@/lib/businessDay";
import { redactMoney } from "@/lib/oplog";
// The SAME grouping the Repair board uses, so the button and the board can never disagree.
import { errorGroupKey } from "@/lib/errorSignature";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sinceIso = businessDayStartIso();
  const onlineSinceIso = new Date(Date.now() - 180_000).toISOString(); // "online" = seen in last 3 min
  const head = { count: "exact" as const, head: true };

  const reads = new ReadSet("admin/dashboard", await Promise.all([
    rd("restaurants", () => sb.from("restaurants").select("id, slug, name, active, owner_user_id").is("deleted_at", null).order("name").limit(2000)),
    rd("settings", () => sb.from("settings").select("restaurant_id, enabled_panels").limit(2000)),
    rd("owners", () => sb.from("staff_users").select("id, name, username").eq("role", "owner").eq("active", true).limit(2000)),
    // The owner⇄restaurant join (mig 097) — so the "Owner" quick-open knows when a
    // restaurant has SEVERAL owners and shows a "which owner?" chooser (owner 2026-07-25).
    rd("ownerLinks", () => sb.from("restaurant_owners").select("restaurant_id, user_id").limit(20000)),
    // "Orders today" — the SAME population the Platform analytics tile counts, and the same
    // population its Busiest-restaurants table lists (mig 348). This was a bare head count with
    // no restaurant test, so a restaurant in the recycle bin still added its orders to the
    // admin's home screen; the card links straight through to that page, where the number would
    // then disagree with the table under it. Today's figures happened to match, which is exactly
    // what kept it quiet.
    rd("ordersToday", () => sb.rpc("lfh_admin_orders_count", { p_from: sinceIso, p_to: new Date().toISOString() })),
    rd("maintenance", () => sb.from("settings").select("restaurant_id").eq("service_mode", true).limit(2000)),
    // Only the staff CURRENTLY online (seen in the last 3 min) — a small list, instead of
    // hauling the ENTIRE staff_users table every 60s just to filter it on the client.
    rd("onlineStaff", () => sb.from("staff_users").select("name, username, role, restaurant_id, last_seen_at", { count: "exact" }).eq("active", true).gte("last_seen_at", onlineSinceIso).limit(200)),
    rd("issues", () => sb.from("issues").select("id, restaurant_id, subject, status, created_at", { count: "exact" }).eq("status", "open").order("created_at", { ascending: false }).limit(50)),
    // Only the columns the activity feed renders (not select("*")) — trims wire size.
    rd("activity", () => sb.from("staff_actions").select("id, panel, action, actor, detail, table_number, restaurant_id, created_at").order("created_at", { ascending: false }).limit(18)),
    // Two HEAD counts for the red "Fix problems" button (owner 2026-07-22): recent app
    // errors (partial error index, mig 159) + problems reported but not yet solved.
    // ONE DEFINITION OF "A PROBLEM", SHARED WITH THE REPAIR BOARD (T20 sweep, 2026-08-16).
    // This counted errors from the last 24 HOURS while /aevinite/repair listed every UNRESOLVED
    // error whatever its age — so the console said "7 problems" on one screen and showed the
    // quiet grey "Repair" button on the other, at the same moment, about the same errors (they
    // were 3-9 days old). Two numbers for one fact is how a person stops trusting either.
    // A problem is now simply "an error nobody has resolved", on both screens. Nothing is
    // hidden by age any more, which is the safer half of the fix: an unresolved error from last
    // week is still a problem, and the old count quietly dropped it.
    // (2) UNIT — the second half of the same fault. Even once age was gone, this counted raw
    // ROWS (18) while the board counts GROUPED problems (7): repeats of one fault rolled into
    // one tile. Two true numbers for one fact is still how a person stops trusting either. So
    // the rows are grouped HERE with errorGroupKey — the same function the board uses — and
    // only the NUMBER crosses the wire. Bounded at 200: this button asks "is there something
    // to fix, and roughly how much", and a console with 200+ distinct unresolved faults has
    // bigger problems than an exact total.
    // (3) A PROBLEM SET TO WAIT IS NOT ON THE BOARD, SO IT IS NOT ON THIS BUTTON EITHER (mig 344,
    // 2026-08-20). "Remind me later" was added because the only two answers were "mark it
    // resolved" (a false record) and "leave it red for ever". If a waiting problem still counted
    // here, the console would be back to two numbers for one fact — the very thing notes (1) and
    // (2) above were written to end. The wait expires by itself and the tile, and this count,
    // come straight back; the Repair board states how many are waiting so nothing is silent.
    rd("errors", () => sb.from("staff_actions").select("panel, action, detail, restaurant_id")
          .eq("level", "error").is("resolved_at", null)
          .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`)
          .order("created_at", { ascending: false }).limit(200)),
    rd("openFixRequests", () => sb.from("fix_requests").select("id", head).eq("status", "open")),
    ]));

  // Surface a failed read on any number/banner the home screen relies on — otherwise a backend
  // hiccup shows a confident "0 open tables / 0 orders / no maintenance" all-clear with a 200
  // (the anti-pattern the floor route avoids). The two soft LISTS below (online staff, issues)
  // may still degrade to empty; the notifications bell is the primary issues surface (audit 2026-07-09).
  const critErr = reads.failed("restaurants") ? reads.error("restaurants")
    : reads.failed("ordersToday") ? reads.error("ordersToday")
      : reads.failed("maintenance") ? reads.error("maintenance") : null;
  // PLAIN WORDS FOR THE CONSOLE (sweep #6, T19). This answered with the database's own
  // sentence, so a failure here read as e.g. `relation "…" does not exist` in a red toast —
  // right for a developer, useless on the screen the owner runs his platform from. adminFail
  // keeps the raw text where it is actually useful (the response `detail` and the server log)
  // and gives the screen a sentence that names the thing and says whether anything changed.
  if (critErr) return adminFail("the console home screen", critErr, { action: "load" });

  // rows() for the three CRITICAL reads (checked above, so it cannot throw); rowsOr() for the ones
  // this screen deliberately lives without, which is now visible at the call site.
  const restRows = reads.rows<{ id: string; slug: string; name: string; active: boolean | null; owner_user_id: string | null }>("restaurants");
  const setRows = reads.rowsOr<{ restaurant_id: string; enabled_panels?: Record<string, boolean> | null }>("settings", []);
  const withSettings = new Set(setRows.map((r) => r.restaurant_id).filter(Boolean));
  const panelsByRid = new Map(setRows.map((r) => [r.restaurant_id, r.enabled_panels || null]));
  const ownerName = new Map(reads.rowsOr<{ id: string; name: string | null; username: string }>("owners", []).map((o) => [o.id, o.name || o.username]));
  const nameByRid = new Map(restRows.map((r) => [r.id, r.name]));

  // Owners per restaurant (ACTIVE owners only — a suspended one can't log in, so it's not
  // an option in the chooser). primary = the restaurant's owner_user_id. Sorted primary-first
  // then A–Z so the chooser lists the main owner at the top.
  const primaryByRid = new Map(restRows.map((r) => [r.id, r.owner_user_id || null]));
  const ownersByRid = new Map<string, { id: string; name: string; primary: boolean }[]>();
  for (const l of reads.rowsOr<{ restaurant_id: string; user_id: string }>("ownerLinks", [])) {
    const nm = ownerName.get(l.user_id); // undefined → suspended/deleted owner, skip
    if (!nm) continue;
    const list = ownersByRid.get(l.restaurant_id) || [];
    list.push({ id: l.user_id, name: nm, primary: primaryByRid.get(l.restaurant_id) === l.user_id });
    ownersByRid.set(l.restaurant_id, list);
  }
  for (const list of ownersByRid.values())
    list.sort((a, b) => (a.primary === b.primary ? a.name.localeCompare(b.name) : a.primary ? -1 : 1));

  const restaurants = restRows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, active: r.active === true,
    hasSettings: withSettings.has(r.id),
    ownerUserId: r.owner_user_id || null,
    ownerName: r.owner_user_id ? (ownerName.get(r.owner_user_id) || "—") : null,
    owners: ownersByRid.get(r.id) || [],
    panels: panelsByRid.get(r.id) || null,
  }));

  // Live restaurants currently in maintenance, by name.
  const maintenanceNames = reads.rows<{ restaurant_id: string | null }>("maintenance")
    .map((s) => s.restaurant_id && nameByRid.get(s.restaurant_id))
    .filter((n): n is string => !!n);

  const issues = reads.rowsOr<{ id: string; restaurant_id: string | null; subject: string; status: string; created_at: string }>("issues", []).map((i) => ({
    id: i.id, restaurantName: (i.restaurant_id && nameByRid.get(i.restaurant_id)) || "—",
    subject: i.subject, status: i.status, created_at: i.created_at,
  }));

  const online = reads.rowsOr<{ name: string | null; username: string; role: string; restaurant_id: string | null; last_seen_at: string | null }>("onlineStaff", []).map((u) => ({
    name: u.name, username: u.username, role: u.role,
    restaurantName: (u.restaurant_id && nameByRid.get(u.restaurant_id)) || null,
    last_seen_at: u.last_seen_at,
  }));

  const restMeta = new Map(restRows.map((r) => [r.id, { name: r.name, slug: r.slug }]));
  const activity = reads.rowsOr<{ id: string; panel: string; action: string; actor: string | null; detail: string | null; table_number: string | null; restaurant_id: string | null; created_at: string }>("activity", []).map((a) => {
    const meta = a.restaurant_id ? restMeta.get(a.restaurant_id) : undefined;
    return { ...a, detail: redactMoney(a.detail), restaurant_name: meta?.name ?? null, restaurant_slug: meta?.slug ?? null };
  });

  return NextResponse.json({
    restaurants,
    maintenance: maintenanceNames.length > 0,
    maintenanceNames,
    ordersToday: Number(reads.value<number>("ordersToday")) || 0,   // the RPC returns the number (mig 348)
    online,
    onlineCount: reads.failed("onlineStaff") ? online.length : reads.count("onlineStaff"), // exact total (list capped at 200)
    issues,
    openIssuesCount: reads.failed("issues") ? issues.length : reads.count("issues"), // exact open total (list capped at 50)
    activity,
    // Red "Fix problems" button: soft counts — a failed read shows the quiet button, never a 500.
    // Renamed from errorCount24h: it is not a 24h count any more, and a name that says the
    // wrong thing is how the last person got this wrong.
    problemCount: new Set(reads.rowsOr<{ panel: string; action: string; detail: string | null; restaurant_id: string | null }>("errors", [])
      .map((a) => errorGroupKey(a))).size,
    openFixRequests: reads.failed("openFixRequests") ? 0 : reads.count("openFixRequests"),
  });
}
