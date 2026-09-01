// GET /api/admin/notifications — feed for the top-bar notification bell on every admin
// page. TWO things in ONE cheap round-trip (the bell polls this every 60s):
//   • tickets — the newest OPEN issues across all restaurants (subject, who/where
//     raised it, and any photo/voice-note URL), so the admin can act without opening
//     the full issues page.
//   • alerts  — actionable system warnings: a restaurant that's SUSPENDED (guest menu
//     off). "Dormant" (no recent orders) was REMOVED from the bell (audit 2026-07-08):
//     it nagged constantly for normal new/demo/quiet restaurants. Dormancy still shows
//     on the Restaurants list, and real churn signals belong in account-health. No
//     money — just signals. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { signRows } from "@/lib/mediaLinks";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
// ONE ANSWER TO "DID EVERY ONE OF THESE READS WORK?" — lib/readGuard (item 15, owner-approved
// 2026-09-01). One retry on a transient connection failure, one log line naming WHICH read went, and
// a tolerated read that says so at the call site. The console's answer is unchanged.
import { ReadSet, rd } from "@/lib/readGuard";

export const dynamic = "force-dynamic";
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

const TICKET_LIMIT = 30; // newest open tickets shown in the bell

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Bounded, scoped reads only. Tickets: open, newest, capped, explicit columns.
  // A separate head-count gives the TRUE open total for the badge without pulling >30 rows.
  // errorsQ/errorCountQ: recent app errors that are still UNSEEN (mig 182) AND UNRESOLVED (mig 181)
  // — cheap via the partial idx_staff_actions_error_unseen index. Opening the bell marks the shown
  // errors seen (POST /api/admin/oplog/ack), so the badge clears and only genuinely-new errors
  // re-raise it; "mark unread" clears seen_at to re-surface one. Excluding resolved keeps the bell
  // in step with the dashboard "Fix problems" count, so resolving an error clears it everywhere.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const reads = new ReadSet("admin/notifications", await Promise.all([
    rd("tickets", () => sb.from("issues")
      .select("id, restaurant_id, subject, body, raised_by, raised_role, created_at, image_url, audio_url")
      .eq("status", "open").order("created_at", { ascending: false }).limit(TICKET_LIMIT)),
    rd("ticketCount", () => sb.from("issues").select("id", { count: "exact", head: true }).eq("status", "open")),
    rd("restaurants", () => sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null).limit(2000)),
    // These four are DELIBERATELY soft — the bell still shows the rest if one of them goes (this
    // route's own rule, audit 2026-07-09). rowsOr/failed is how that is now stated at the call site.
    rd("errors", () => sb.from("staff_actions").select("id, panel, action, detail, restaurant_id, created_at")
      .eq("level", "error").is("seen_at", null).is("resolved_at", null).gte("created_at", since24h).order("created_at", { ascending: false }).limit(10)),
    rd("errorCount", () => sb.from("staff_actions").select("id", { count: "exact", head: true }).eq("level", "error").is("seen_at", null).is("resolved_at", null).gte("created_at", since24h)),
    // Rate-limit hits (mig 205): open events, newest first, capped + true count for the badge.
    rd("rateLimits", () => sb.from("rate_limit_events").select("id, restaurant_id, key, subject_label, subject, hit_count, max_count, last_at")
      .eq("status", "open").order("last_at", { ascending: false }).limit(10)),
    rd("rateLimitCount", () => sb.from("rate_limit_events").select("id", { count: "exact", head: true }).eq("status", "open")),
  ]));
  // Surface a failed read — otherwise a broken tickets/restaurants query silently shows an
  // empty bell (no tickets, and NO suspended-restaurant alerts) as if everything's clear (audit).
  // Errors are non-fatal to the feed: if that read fails we still return the rest.
  const nErr = reads.failed("tickets") ? reads.error("tickets")
    : reads.failed("ticketCount") ? reads.error("ticketCount")
      : reads.failed("restaurants") ? reads.error("restaurants") : null;
  // PLAIN WORDS FOR THE CONSOLE (sweep #6, T19). This answered with the database's own
  // sentence, so a failure here read as e.g. `relation "…" does not exist` in a red toast —
  // right for a developer, useless on the screen the owner runs his platform from. adminFail
  // keeps the raw text where it is actually useful (the response `detail` and the server log)
  // and gives the screen a sentence that names the thing and says whether anything changed.
  if (nErr) return adminFail("the notifications", nErr, { action: "load" });

  const restaurants = reads.rows<{ id: string; name: string; slug: string; active: boolean }>("restaurants");
  const nameOf: Record<string, string> = {};
  const slugOf: Record<string, string> = {};
  for (const r of restaurants) { nameOf[r.id] = r.name; slugOf[r.id] = r.slug; }

  // The bell shows a complaint's photo/voice note, so those links are signed too — short-lived,
  // never the permanent public URL (lib/mediaLinks.ts).
  const signedTickets = await signRows("issue-media", reads.rows<Record<string, unknown>>("tickets"), ["image_url", "audio_url"]);
  const tickets = signedTickets.map((t: any) => ({ ...t, restaurantName: nameOf[t.restaurant_id] || "—", restaurantSlug: slugOf[t.restaurant_id] || "" }));

  // Recent app errors (last 24h) — a signal that something broke, with a jump into the log.
  const errors = reads.rowsOr<{ id: string; panel: string; action: string; detail: string | null; restaurant_id: string | null; created_at: string }>("errors", [])
    .map((e) => ({ ...e, restaurantName: e.restaurant_id ? (nameOf[e.restaurant_id] || "—") : "Platform" }));
  const errorCount = reads.failed("errorCount") ? errors.length : reads.count("errorCount");

  // Alerts = restaurants that are SUSPENDED (guest menu off) — the one actionable state.
  const alerts: Array<{ restaurant_id: string; restaurantName: string; restaurantSlug: string; kind: "suspended"; detail: string }> = [];
  for (const r of restaurants) {
    if (r.active === false) alerts.push({ restaurant_id: r.id, restaurantName: r.name, restaurantSlug: r.slug, kind: "suspended", detail: "Suspended — guest menu is off" });
  }
  alerts.sort((a, b) => a.restaurantName.localeCompare(b.restaurantName));

  // Rate-limit hits (non-fatal): a configurable limit was reached.
  const rateLimits = reads.rowsOr<{ id: string; restaurant_id: string | null; key: string; subject_label: string | null; subject: string; hit_count: number; max_count: number; last_at: string }>("rateLimits", []).map((e) => ({
    id: e.id, key: e.key, subject: e.subject_label || e.subject, hit_count: e.hit_count, max_count: e.max_count, last_at: e.last_at,
    restaurantName: e.restaurant_id && e.restaurant_id !== "00000000-0000-0000-0000-000000000000" ? (nameOf[e.restaurant_id] || "—") : "Platform",
  }));
  const rateLimitCount = reads.failed("rateLimitCount") ? rateLimits.length : reads.count("rateLimitCount");

  return NextResponse.json({
    tickets,                                          // up to 30 newest open tickets (for the list)
    openTicketCount: reads.count("ticketCount"),      // TRUE open total (for the badge) — checked above
    alerts,
    alertCount: alerts.length,
    errors,                                           // up to 10 newest app errors (last 24h)
    errorCount,                                        // TRUE error total in the last 24h
    rateLimits,                                        // up to 10 newest rate-limit hits
    rateLimitCount,                                    // TRUE open rate-limit-hit total
    healthOk: true,
    checkedAt: new Date().toISOString(),
  });
}
