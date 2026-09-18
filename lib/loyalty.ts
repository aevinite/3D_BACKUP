// lib/loyalty.ts — LOYALTY POINTS, server side (owner, 2026-09-19).
//
// Points are earned on a settled bill and spent as a discount on a later visit. There is NO
// messaging anywhere in this feature and that is deliberate: the balance is printed on the bill
// the guest is already holding and shown to the cashier at the till, which is why it costs ₹0 a
// month to run. Costing + the parked guest-screen version: docs/LOYALTY-PLAN.md.
//
// OFF MUST MEAN NOTHING CHANGES (owner, 2026-09-19: "if it's on then only everything will change
// otherwise everything will be as it is right now"). Every entry point here asks loyaltyLadder()
// first and returns `{ on: false }` without touching the database. mig 400's functions ask the
// same question again in SQL, so a caller that forgets still cannot write a point — belt AND
// braces, because this decides who gets money off a bill.
//
// SERVER-ONLY (imports supabaseAdmin).
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { loyaltyLadder } from "@/lib/tableTags";
import { netOf, type BillOrder } from "@/lib/billLedger";

/** What the till shows beside a recognised guest, or `on: false` when the module is off. */
export type LoyaltyState = {
  on: boolean;
  balance?: number;
  earn_per_100?: number;
  point_value_paise?: number;
  min_redeem?: number;
  max_redeem_pct?: number;
};

/** Is loyalty switched on for this restaurant? The ONE question every surface asks. */
export async function loyaltyOn(rid: string): Promise<boolean> {
  return (await loyaltyLadder(rid)).effective;
}

/**
 * What this bill actually came to — computed HERE, never taken from the browser.
 *
 * A number the panel sends is a number a panel can get wrong, and this one decides how much money
 * a guest gets off later. `netOf()` is the ONE definition of an order's net (mig 310's generated
 * column first), the same one the bill record and the audit use, so points can never be earned on
 * a different figure from the one printed.
 *
 * Scoped, explicit columns, and bounded by the session — never a table scan.
 */
export async function settledTotalOf(rid: string, sessionId: string): Promise<number> {
  const { data } = await sb
    .from("orders")
    .select("id, session_id, total, discount, tax_rate, net_amount, disc_gross, status, payment_status, payment_method, khata_at, deleted_at, deleted_by, delete_reason")
    .eq("restaurant_id", rid)
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .limit(500);
  const rows = (data || []) as unknown as BillOrder[];
  // Only what was really sold: a cancelled line earns nothing.
  const live = rows.filter((o) => o.status !== "cancelled");
  return Math.round(live.reduce((s, o) => s + netOf(o), 0) * 100) / 100;
}

/**
 * EARN on a settled bill. Fire-and-forget from the pay sheet: it rides the settle that already
 * happened, so a failure here must never surface as a billing error. Idempotent per bill in SQL,
 * so a retried or replayed settle cannot pay points twice.
 */
export async function earnOnSettle(
  rid: string, table: string, phone: string, sessionId: string | null,
): Promise<{ ok: boolean; earned?: number; balance?: number }> {
  if (!phone || !sessionId) return { ok: false };
  if (!(await loyaltyOn(rid))) return { ok: false };
  const total = await settledTotalOf(rid, sessionId);
  if (total <= 0) return { ok: false };
  const { data, error } = await sb.rpc("lfh_loyalty_earn", {
    p_restaurant_id: rid, p_table: table, p_phone: phone, p_total: total, p_session: sessionId,
  });
  if (error) {
    // The guest's points are not worth failing a settled bill over. Logged, never shown.
    console.error("[loyalty] earn failed:", error.message);
    return { ok: false };
  }
  return (data as { ok: boolean; earned?: number; balance?: number }) || { ok: false };
}

/** Un-paying a bill takes back exactly the points that bill granted — see mig 400 §7. */
export async function reverseOnUnpay(rid: string, table: string, sessionId: string | null): Promise<void> {
  if (!(await loyaltyOn(rid))) return;
  const { error } = await sb.rpc("lfh_loyalty_reverse", {
    p_restaurant_id: rid, p_table: table, p_session: sessionId,
  });
  if (error) console.error("[loyalty] reverse failed:", error.message);
}

/** The balance + rules for one guest, for the pay sheet. One row, no scan. */
export async function loyaltyStateFor(rid: string, phone: string): Promise<LoyaltyState> {
  if (!(await loyaltyOn(rid))) return { on: false };
  const { data, error } = await sb.rpc("lfh_loyalty_state", { p_restaurant_id: rid, p_phone: phone });
  if (error) { console.error("[loyalty] state failed:", error.message); return { on: false }; }
  return (data as LoyaltyState) || { on: false };
}

/**
 * SPEND points on the bill in front of the guest. Returns the discount in rupees for the caller
 * to apply through the panel's EXISTING discount path — this never touches the bill itself, so
 * tax order, the cap and the audit row all stay where they already work correctly.
 *
 * `reason` is a plain sentence when it refuses, because a cashier is standing in front of a guest.
 */
export async function redeemPoints(
  rid: string, table: string, phone: string, points: number, by: string, sessionId: string | null,
): Promise<{ ok: boolean; rupees?: number; balance?: number; reason?: string }> {
  if (!(await loyaltyOn(rid))) return { ok: false, reason: "Loyalty points aren't switched on for this restaurant." };
  const { data, error } = await sb.rpc("lfh_loyalty_redeem", {
    p_restaurant_id: rid, p_table: table, p_phone: phone,
    p_points: Math.floor(Number(points) || 0), p_by: by, p_session: sessionId,
  });
  if (error) {
    console.error("[loyalty] redeem failed:", error.message);
    return { ok: false, reason: "Couldn't use the points just now — the bill itself is fine. Try again in a moment." };
  }
  const r = (data as { ok: boolean; rupees?: number; balance?: number; spent?: number; reason?: string; min?: number }) || { ok: false };
  if (r.ok) return { ok: true, rupees: Number(r.rupees) || 0, balance: r.balance };
  // Turn the machine reason into the sentence a cashier can read out loud (lib/plainError's rule:
  // translate on DISPLAY, keep the exact text in the log).
  const say: Record<string, string> = {
    below_minimum: `They need at least ${r.min ?? 0} points before these can be used.`,
    not_enough_points: `They only have ${r.balance ?? 0} points.`,
    unknown_guest: "Save the guest's number on this bill first, then the points can be used.",
    nothing_to_spend: "Choose how many points to use.",
    no_session: "This table's bill couldn't be found — reopen the pay sheet and try again.",
    loyalty_off: "Loyalty points aren't switched on for this restaurant.",
  };
  return { ok: false, reason: say[String(r.reason)] || "Those points couldn't be used." };
}
