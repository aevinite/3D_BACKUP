// GET /api/admin/usage — per-restaurant USAGE (order volume, staff, tables) from the
// lfh_admin_usage RPC (mig 153). A cost/egress PROXY for the operator (which restaurants
// are heavy to serve) — counts only, NO food money (admin sees no earnings). One aggregated
// RPC round-trip, no per-restaurant fan-out.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log (lib/adminFail).
import { adminFail } from "@/lib/adminFail";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ── ?from / ?to — ANY WINDOW, not just the last 30 days (owner, 2026-08-20 — decision 19) ────
  // Absent → the original two-column view (7-day + 30-day), unchanged, still one call to mig 153.
  // Present → mig 347's lfh_admin_usage_range, which is the same function with the window as
  // arguments: same live-tenant filter, same counts, same single round-trip.
  //
  // Both dates are validated and CLAMPED before they reach SQL: a window is at most 400 days, so a
  // typo (or a hand-edited URL) can never turn this screen into an all-time scan of `orders`.
  const url = new URL(req.url);
  const parseDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : null);
  const fromDay = parseDay(url.searchParams.get("from"));
  const toDay = parseDay(url.searchParams.get("to"));
  let range: { from: string; to: string } | null = null;
  if (fromDay && toDay) {
    // IST business days: the window runs from 00:00 on `from` to 00:00 on the day AFTER `to`, so
    // "1 Aug to 1 Aug" is that whole day rather than an empty instant.
    const start = new Date(`${fromDay}T00:00:00+05:30`);
    const endEx = new Date(`${toDay}T00:00:00+05:30`);
    endEx.setDate(endEx.getDate() + 1);
    if (endEx <= start) return NextResponse.json({ error: "that date range ends before it starts" }, { status: 400 });
    const MAX_DAYS = 400;
    if ((endEx.getTime() - start.getTime()) / 86_400_000 > MAX_DAYS) {
      return NextResponse.json({ error: `that range is longer than ${MAX_DAYS} days — pick a shorter one` }, { status: 400 });
    }
    range = { from: start.toISOString(), to: endEx.toISOString() };
  }

  const [usageQ, restsQ] = await Promise.all([
    range
      ? sb.rpc("lfh_admin_usage_range", { p_from: range.from, p_to: range.to })
      : sb.rpc("lfh_admin_usage"),
    sb.from("restaurants").select("id, name, slug").is("deleted_at", null),
  ]);
  const anyErr = usageQ.error || restsQ.error;
  // THE CONSOLE GETS A SENTENCE, NOT A POSTGRES ERROR (T20 sweep, 2026-08-19). This answered the
  // database's own words verbatim, so the toast read something like `relation "lfh_admin_usage" does
  // not exist`. adminFail keeps BOTH halves — a plain sentence in `error` (which lib/adminFetch is
  // what every screen surfaces) and the raw text in `detail` plus the server log, which is where it
  // is actually useful. Rolled out to forty-odd handlers on 2026-08-14; this one was missed.
  if (anyErr) return adminFail("the usage figures", anyErr, { action: "load" });

  const meta = new Map<string, { name: string; slug: string }>((restsQ.data || []).map((r) => [r.id, { name: r.name, slug: r.slug }]));
  const rows = ((usageQ.data as { restaurant_id: string; orders_7d?: number; orders_30d?: number; orders_range?: number; staff_total: number; table_count: number }[]) || [])
    // Keep only LIVE restaurants: if the RPC ever returns a binned tenant it would otherwise
    // show as a nameless "—" row AND inflate the totals below (every sibling route filters to
    // live ids — usage was trusting the RPC; audit 2026-07-23).
    .filter((u) => meta.has(u.restaurant_id))
    .map((u) => ({
    id: u.restaurant_id,
    name: meta.get(u.restaurant_id)?.name || "—",
    slug: meta.get(u.restaurant_id)?.slug || "",
    // In range mode there is ONE order figure, and it is the range's. The two fixed columns are
    // left at 0 and the page hides them — better than repeating the range number under a "7-day"
    // heading, which would be a wrong label on a right number.
    orders7d: Number(u.orders_7d) || 0,
    orders30d: Number(u.orders_30d) || 0,
    ordersRange: range ? Number(u.orders_range) || 0 : null,
    staff: Number(u.staff_total) || 0,
    tables: Number(u.table_count) || 0,
  }));
  const totals = {
    orders7d: rows.reduce((s, r) => s + r.orders7d, 0),
    orders30d: rows.reduce((s, r) => s + r.orders30d, 0),
    ordersRange: range ? rows.reduce((s, r) => s + (r.ordersRange || 0), 0) : null,
    staff: rows.reduce((s, r) => s + r.staff, 0),
    restaurants: rows.length,
  };
  // `range` echoes back what was actually used, so the page labels its own columns from the
  // server's answer rather than from what it hoped it asked for.
  return NextResponse.json({ rows, totals, range: range ? { from: fromDay, to: toDay } : null, generatedAt: new Date().toISOString() });
}
