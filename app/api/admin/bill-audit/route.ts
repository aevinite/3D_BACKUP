// GET /api/admin/bill-audit — a read-only trail of every BILL-affecting action across all
// restaurants (paid / deleted / discounted / reverted / closed-unpaid / moved), from the
// existing staff_actions log. Emphasises the TAMPER-RISK ones (removals & reverts) so the
// operator can spot bills being quietly deleted. Money is redacted (admin sees no ₹, hard
// rule). This is the SAFE v1 of the tamper-proof log: read-only, no triggers, no new table.
// A cryptographically un-editable append-only ledger is a larger follow-up.
//   ?restaurant_id=<uuid>  scope to one restaurant
//   ?type=risk             only deletions/reverts/closed-unpaid
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { redactMoney } from "@/lib/oplog";

export const dynamic = "force-dynamic";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// Bill CHANGES/removals only — NOT "paid". (The manager panel, the main billing surface,
// doesn't emit bill_paid, so including it would show a misleading partial list; payments live
// on Revenue/Billing.) table_shift = the manager's move; order_move = the tablet's (audit).
const BILL_ACTIONS = ["order_delete", "payment_revert", "close_unpaid", "order_discount", "order_move", "table_shift",
  // Cancelling / clearing a bill: voiding a generated invoice (reopen), and closing/restarting
  // a table (which cancels its unpaid orders). Shown so the "what happened" category is visible
  // here too, not just in the per-restaurant log (owner, 2026-07-24).
  "invoice_void", "table_restart", "table_close",
  // Admin Repair Kit actions that touch bills/orders (mig 159 tooling) — surfaced here so the
  // tamper log shows emergency surgery too.
  "repair_void_bill", "repair_delete_order", "repair_refire_order", "repair_edit_time"];
const RISK = new Set(["order_delete", "payment_revert", "close_unpaid", "invoice_void",
  "repair_delete_order", "repair_void_bill", "repair_edit_time"]); // removals / voids / edits = the tamper-risk signals

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const rid = url.searchParams.get("restaurant_id");
  const type = url.searchParams.get("type");
  const actions = type === "risk" ? [...RISK] : BILL_ACTIONS;

  let q = sb.from("staff_actions")
    .select("id, action, actor, detail, table_number, restaurant_id, created_at")
    .in("action", actions)
    .order("created_at", { ascending: false })
    .limit(500);
  if (rid && isUuid(rid)) q = q.eq("restaurant_id", rid);

  const [aQ, restsQ] = await Promise.all([q, sb.from("restaurants").select("id, name").is("deleted_at", null)]);
  if (aQ.error) return NextResponse.json({ error: aQ.error.message }, { status: 500 });

  const nameById = new Map<string, string>((restsQ.data || []).map((r) => [r.id, r.name]));
  const rows = (aQ.data || []).map((a) => ({
    id: a.id,
    action: a.action,
    restaurantName: (a.restaurant_id && nameById.get(a.restaurant_id)) || "—",
    table: a.table_number ?? null,
    actor: a.actor || "—",
    detail: redactMoney(a.detail), // strip ₹ — admin never sees food money
    at: a.created_at,
    risk: RISK.has(a.action),
  }));
  const riskCount = rows.filter((r) => r.risk).length;

  // Restaurants list for the filter dropdown (id + name only).
  const restaurants = (restsQ.data || []).map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ rows, riskCount, restaurants, generatedAt: new Date().toISOString() });
}
