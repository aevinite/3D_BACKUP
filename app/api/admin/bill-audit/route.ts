// GET /api/admin/bill-audit — a read-only trail of every BILL-affecting action across all
// restaurants (paid / deleted / discounted / reverted / closed-unpaid / moved), from the
// existing staff_actions log. Emphasises the TAMPER-RISK ones (removals & reverts) so the
// operator can spot bills being quietly deleted. Money is redacted (admin sees no ₹, hard
// rule). This is the SAFE v1 of the tamper-proof log: read-only, no triggers, no new table.
// A cryptographically un-editable append-only ledger is a larger follow-up.
//   ?restaurant_id=<uuid>  scope to one restaurant
//   ?type=risk             only deletions/reverts/closed-unpaid
//   ?page=N&per=100        one page of the log, newest first (page 1 = the newest)
//   ?count=1               also return the exact total, so the page can print a last page number
//
// PAGED, NOT CAPPED (owner, 2026-08-20: "I want all logs to be shown … page wise, like for example
// hundred will show and you can go to next page 1 2 3 4 … there will be last page number … you can
// type the page number … till the time it is auto deleted"). It used to read the newest 500 and
// stop, so the only way to reach an older change was to narrow the filter until it fitted.
//
// WHY AN EXACT COUNT IS AFFORDABLE HERE, AND HOW IT IS KEPT THAT WAY (the egress rules):
//   · Migration 158 caps every restaurant's log at 30 days and prunes daily at 04:00, so the set
//     behind this screen cannot grow without limit. Measured when this was written: 2,242
//     bill-change rows in the whole 30-day window.
//   · Migration 349 adds `staff_actions (action, created_at DESC)`, so both the count and each page
//     are an index range scan per action instead of walking rows of every other action.
//   · The count is only computed when the caller asks (`?count=1`). Turning a page does NOT ask —
//     the total cannot have changed the shape of the thing being paged in the meantime, and the
//     newest page re-asks on its own refresh anyway. A page hop is one indexed range read.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
// ONE ANSWER TO "DID EVERY ONE OF THESE READS WORK?" — lib/readGuard (item 15, owner-approved
// 2026-09-01). One retry on a transient connection failure, one log line naming WHICH read went, and
// a tolerated read that says so at the call site. The console's answer is unchanged.
import { ReadSet, rd } from "@/lib/readGuard";
import { redactMoney } from "@/lib/oplog";

export const dynamic = "force-dynamic";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// Bill CHANGES/removals only — NOT "paid". (The manager panel, the main billing surface,
// doesn't emit bill_paid, so including it would show a misleading partial list; payments live
// on Revenue/Billing.) table_shift = the manager's move; order_move = the tablet's (audit).
const BILL_ACTIONS = ["order_delete", "orders_delete", "bill_restore", "payment_revert", "close_unpaid", "order_discount", "order_move", "table_shift",
  // Cancelling / clearing a bill: voiding a generated invoice (reopen), and closing/restarting
  // a table (which cancels its unpaid orders). Shown so the "what happened" category is visible
  // here too, not just in the per-restaurant log (owner, 2026-07-24).
  "invoice_void", "table_restart", "table_close",
  // Cancelling ONE bill (and undoing that) — newly logged 2026-07-28. Cancelling takes a bill
  // out of the takings, so it belongs in the tamper log; order_cancel is RISK, the undo is not.
  "order_cancel", "order_uncancel",
  // Admin Repair Kit actions that touch bills/orders (mig 159 tooling) — surfaced here so the
  // tamper log shows emergency surgery too.
  "repair_void_bill", "repair_delete_order", "repair_refire_order", "repair_edit_time"];
const RISK = new Set(["order_delete", "payment_revert", "close_unpaid", "invoice_void", "order_cancel",
  "repair_delete_order", "repair_void_bill", "repair_edit_time"]); // removals / voids / edits = the tamper-risk signals
const PER_PAGE = 100;            // what a page shows unless the caller says otherwise
const MAX_RETENTION_DAYS = 30;   // mig 158's hard cap — the age at which a log line is pruned

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rid = url.searchParams.get("restaurant_id");
  const type = url.searchParams.get("type");
  const actions = type === "risk" ? [...RISK] : BILL_ACTIONS;

  // One page, newest first. `per` is clamped so a hand-typed URL cannot ask for the whole log in
  // one read, and `page` is 1-based because that is what the numbers on screen say.
  const per = Math.min(200, Math.max(20, Number(url.searchParams.get("per")) || PER_PAGE));
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const wantCount = url.searchParams.get("count") === "1";
  const offset = (page - 1) * per;

  let q = sb.from("staff_actions")
    .select("id, action, actor, detail, table_number, restaurant_id, created_at")
    .in("action", actions)
    .order("created_at", { ascending: false })
    // Ordering by created_at alone is not a total order — several bill actions can land in the same
    // millisecond (a table close cancels its unpaid orders, so close_unpaid and table_close are
    // written together). With ties broken arbitrarily, one row could appear on two pages while
    // another appeared on none, which on a tamper log is the worst possible kind of wrong. `id` is
    // the tiebreak, in the same direction, so the order is stable across page reads.
    .order("id", { ascending: false })
    .range(offset, offset + per - 1);
  if (rid && isUuid(rid)) q = q.eq("restaurant_id", rid);

  // THE TOTAL, AND THE RISK TOTAL, ONLY WHEN ASKED. Head counts — no rows cross the wire. The risk
  // count has to be its own count now: it used to be `rows.filter(...).length` over the 500 loaded
  // rows, which on a paged list would have meant "the removals ON THIS PAGE" under a banner that
  // reads "in this view". A tamper banner counting a hundred rows out of two thousand is worse
  // than no banner.
  const countOf = (acts: string[]) => {
    let c = sb.from("staff_actions").select("id", { count: "exact", head: true }).in("action", acts);
    if (rid && isUuid(rid)) c = c.eq("restaurant_id", rid);
    return c;
  };
  const reads = new ReadSet("admin/bill-audit", await Promise.all([
    rd("rows", () => q),
    // Every restaurant, binned ones included — see the note under `nameById` below.
    rd("restaurants", () => sb.from("restaurants").select("id, name, deleted_at").limit(2000)),
    // The two totals are asked for only when the caller wants them, and they are TOLERATED: a failed
    // count travels as null so the page says it does not know, rather than "no removals".
    rd("total", () => (wantCount ? countOf(actions) : Promise.resolve({ data: null, error: null, count: null }))),
    rd("riskTotal", () => (wantCount ? countOf([...RISK]) : Promise.resolve({ data: null, error: null, count: null }))),
  ]));
  if (reads.failed("rows")) return adminFail("the bill trail", reads.error("rows"), { action: "load" });
  // BOTH reads, not just the rows. This is a cross-restaurant screen: the restaurant NAME is how
  // the admin tells one tenant's bill changes from another's, and it feeds the filter dropdown as
  // well. With this read unchecked a failure left every row labelled "—" and the dropdown empty,
  // so the page looked like a working list of anonymous events and the admin had no way to narrow
  // it. Same rule the sibling account-health route already states for its three reads.
  if (reads.failed("restaurants")) return adminFail("the bill trail", reads.error("restaurants"), { action: "load" });

  // THE NAME MAP KEEPS BINNED RESTAURANTS; THE DROPDOWN DOES NOT (T19 sweep #7, 2026-09-01). This
  // read excluded them, so a bill change made at a restaurant that has since been deleted rendered
  // "—" — anonymous, on the one screen whose job is noticing a bill being quietly removed, and
  // precisely for the tenant whose disappearance makes that question worth asking. Same split, same
  // reasoning, as app/api/admin/customers/route.ts and the bill ledger beside it.
  const restRows = reads.rows<{ id: string; name: string; deleted_at: string | null }>("restaurants");
  const nameById = new Map<string, string>(restRows.map((r) => [r.id, r.name]));
  const rows = reads.rows<{ id: number; action: string; actor: string | null; detail: string | null; table_number: string | null; restaurant_id: string | null; created_at: string }>("rows").map((a) => ({
    id: a.id,
    action: a.action,
    restaurantName: (a.restaurant_id && nameById.get(a.restaurant_id)) || "—",
    table: a.table_number ?? null,
    actor: a.actor || "—",
    detail: redactMoney(a.detail), // strip ₹ — admin never sees food money
    at: a.created_at,
    risk: RISK.has(a.action),
  }));
  // Restaurants list for the filter dropdown (id + name only).
  const restaurants = restRows
    .filter((r) => r.deleted_at == null)
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // A COUNT THAT FAILED IS NOT A ZERO. This screen's whole purpose is noticing bills being quietly
  // removed, and the sibling ledger route says the same thing in its own words ("a silent zero is
  // the failure mode that matters most"). `null` travels to the page, which then says it does not
  // know rather than "no removals" or "1 page".
  const total = wantCount && !reads.failed("total") ? reads.count("total") : null;
  const riskCount = wantCount && !reads.failed("riskTotal") ? reads.count("riskTotal") : null;
  return NextResponse.json({
    rows, riskCount, restaurants,
    total, page, per,
    pages: total == null ? null : Math.max(1, Math.ceil(total / per)),
    // Mig 158: nothing here is older than a month, whatever the per-restaurant setting says. The
    // page prints this so "the list ended" and "the record ends here" are never the same sentence.
    retentionDays: MAX_RETENTION_DAYS,
    generatedAt: new Date().toISOString(),
  });
}
