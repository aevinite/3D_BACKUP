// lib/loyalty.ts — LOYALTY POINTS, server side (owner, 2026-09-19).
//
// Points are earned on a settled bill and spent as a discount on a later visit. There is NO
// messaging anywhere in this feature and that is deliberate: the balance is printed on the bill
// the guest is already holding and shown to the cashier at the till, which is why it costs ₹0 a
// month to run. Costing + the parked guest-screen version: docs/LOYALTY-PLAN.md.
//
// OFF MUST MEAN NOTHING CHANGES (owner, 2026-09-19: "if it's on then only everything will change
// otherwise everything will be as it is right now"). Every entry point here asks loyaltyLadder()
// first and returns `{ on: false }` without touching the database. mig 401's functions ask the
// same question again in SQL, so a caller that forgets still cannot write a point — belt AND
// braces, because this decides who gets money off a bill.
//
// SERVER-ONLY (imports supabaseAdmin).
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { loyaltyLadder } from "@/lib/tableTags";
import { readInChunks } from "@/lib/inChunks";
import { netOf, type BillOrder } from "@/lib/billLedger";
import { recordRemoval } from "@/lib/removalAudit";
import type { StaffUser } from "@/lib/userAuth";

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

/** Un-paying a bill takes back exactly the points that bill granted — see mig 401 §7. */
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

/**
 * THE MOST MONEY POINTS MAY TAKE OFF THIS BILL, in rupees.
 *
 * The same base the discount button itself is clamped to: the Σ TAXABLE base of the unpaid,
 * non-cancelled orders — NOT the tax-inclusive total, and not the subtotal, because an MRP line's
 * money is legally final and may never be discounted (mig 270). A NULL taxable_base predates that
 * migration and means "all of it was taxable", which is what subtotal says.
 *
 * Asking this BEFORE spending anything is what stops the guest paying 300 points for a ₹120
 * discount: lfh_staff_bill_discount would silently clamp the rupees while the points were already
 * gone.
 */
export async function maxSpendRupees(rid: string, sessionId: string, maxPct: number): Promise<number> {
  const { data } = await sb
    .from("orders")
    .select("subtotal, taxable_base")
    .eq("restaurant_id", rid).eq("session_id", sessionId)
    .neq("status", "cancelled").neq("payment_status", "paid")
    .limit(500);
  const base = (data || []).reduce(
    (t: number, o: Record<string, unknown>) => t + (Number(o.taxable_base ?? o.subtotal) || 0), 0);
  return Math.round(base * (Math.max(1, Math.min(100, maxPct)) / 100) * 100) / 100;
}

/**
 * SPEND POINTS AND TAKE THE MONEY OFF — one call, so the two can never half-happen.
 *
 * The panel used to have to do this in two requests and there is no safe order for that: spend
 * first and a failed discount leaves a guest robbed of points; discount first and a failed spend
 * hands the money off twice. So both happen here, and if the money-off write fails after the
 * points are gone, the points are PUT BACK as an audited `adjust` row rather than silently lost.
 *
 * The discount itself goes through `lfh_staff_bill_discount` — the very RPC the Discount button
 * calls — so the split across tickets, the tax order and the clamp are the proven ones and there
 * is no second definition of what a discount is.
 *
 * CALLERS MUST HAVE CHECKED THE DISCOUNT PERMISSION FIRST. Spending points is taking money off a
 * bill; this helper does not know who is asking.
 */
export async function redeemOntoBill(
  rid: string, table: string, phone: string, points: number, by: string, sessionId: string | null,
  audit?: { user?: StaffUser | null; deviceId?: string | null; from?: string },
): Promise<{ ok: boolean; rupees?: number; balance?: number; spent?: number; reason?: string }> {
  if (!(await loyaltyOn(rid))) return { ok: false, reason: "Loyalty points aren't switched on for this restaurant." };
  if (!sessionId) return { ok: false, reason: "This table's bill couldn't be found — reopen the pay sheet and try again." };

  const st = await loyaltyStateFor(rid, phone);
  if (!st.on) return { ok: false, reason: "Loyalty points aren't switched on for this restaurant." };

  // Clamp the ASK to what this bill can actually absorb, before a single point is spent.
  const perPoint = (st.point_value_paise ?? 100) / 100;
  const ceilingRupees = await maxSpendRupees(rid, sessionId, st.max_redeem_pct ?? 100);
  const askPoints = Math.floor(Number(points) || 0);
  const affordable = Math.min(askPoints, Math.floor(ceilingRupees / Math.max(perPoint, 0.01)));
  if (affordable <= 0) {
    return { ok: false, reason: "There is nothing left on this bill for points to come off." };
  }

  const r = await redeemPoints(rid, table, phone, affordable, by, sessionId);
  if (!r.ok) return r;

  const rupees = Number(r.rupees) || 0;
  const { error } = await sb.rpc("lfh_staff_bill_discount", {
    p_session: sessionId, p_amount: rupees, p_note: `${affordable} loyalty points`,
  });
  if (error) {
    // PUT THE POINTS BACK. A compensating ledger row, not a quiet edit of the balance: the guest's
    // history must still read as what happened — spent, then returned because the money-off failed.
    console.error("[loyalty] money-off failed after redeem, returning the points:", error.message);
    await sb.from("loyalty_ledger").insert({
      restaurant_id: rid, phone, session_id: null, kind: "adjust", points: affordable,
      note: "money off the bill failed — points returned", by_staff: by,
    });
    const cur = (await sb.from("customers").select("points").eq("restaurant_id", rid).eq("phone", phone).maybeSingle())
      .data as { points?: number } | null;
    await sb.from("customers").update({ points: (Number(cur?.points) || 0) + affordable })
      .eq("restaurant_id", rid).eq("phone", phone);
    return { ok: false, reason: "The money couldn't be taken off just now — their points are untouched. Try again in a moment." };
  }

  // ── THE REMOVALS ROW. A DISCOUNT IS A MONEY CHANGE WHEREVER IT COMES FROM ─────────────────────
  // Caught in testing, 2026-09-19: the money came off the bill correctly and the Removals record
  // stayed EMPTY. Going straight to `lfh_staff_bill_discount` skipped the recordRemoval() the
  // bill-discount ROUTE does right after its own call — so "₹268 off" would have been invisible
  // to the audit, to the owner's Removals screen and to a GST inspector, which is exactly the
  // class of thing docs/COMPLIANCE-GUARDRAILS.md exists to prevent. Reusing an RPC does NOT
  // inherit the route's bookkeeping; the bookkeeping has to come with it.
  await recordRemoval({
    rid, kind: "discount_given",
    reason: { code: "loyalty_points", note: `${affordable} loyalty points` },
    user: audit?.user ?? null, deviceId: audit?.deviceId ?? null,
    sessionId, amount: rupees, tableNumber: table,
    meta: { discount: rupees, from: audit?.from || "loyalty", scope: "whole bill", points: affordable, by },
  });
  return { ok: true, rupees, spent: affordable, balance: r.balance };
}

/** The rules one restaurant runs on, with the defaults filled in. `on:false` when the module is off. */
export type LoyaltyRules = {
  on: boolean;
  earn_per_100?: number; point_value_paise?: number; min_redeem?: number; max_redeem_pct?: number;
};

/** Read the rules (mig 401 §5 fills the defaults, so a restaurant that never opened the screen
 *  still answers). Ladder-gated like everything else here. */
export async function loyaltyRules(rid: string): Promise<LoyaltyRules> {
  if (!(await loyaltyOn(rid))) return { on: false };
  const { data, error } = await sb.rpc("lfh_loyalty_state", { p_restaurant_id: rid, p_phone: "" });
  if (error) { console.error("[loyalty] rules read failed:", error.message); return { on: false }; }
  const r = (data as LoyaltyState) || { on: false };
  return r.on
    ? { on: true, earn_per_100: r.earn_per_100, point_value_paise: r.point_value_paise,
        min_redeem: r.min_redeem, max_redeem_pct: r.max_redeem_pct }
    : { on: false };
}

/**
 * SAVE the rules (mig 403). Refusals come back as sentences — this screen belongs to the restaurant
 * owner, and a CHECK-constraint violation reaches a person as a Postgres string.
 */
export async function saveLoyaltyRules(
  rid: string,
  v: { earn_per_100: number; point_value_paise: number; min_redeem: number; max_redeem_pct: number },
): Promise<{ ok: boolean; reason?: string }> {
  if (!(await loyaltyOn(rid))) return { ok: false, reason: "Loyalty points aren't switched on for this restaurant." };
  const { data, error } = await sb.rpc("lfh_loyalty_set_rules", {
    p_restaurant_id: rid,
    p_earn_per_100: Math.floor(Number(v.earn_per_100)),
    p_point_value_paise: Math.floor(Number(v.point_value_paise)),
    p_min_redeem: Math.floor(Number(v.min_redeem)),
    p_max_redeem_pct: Math.floor(Number(v.max_redeem_pct)),
  });
  if (error) { console.error("[loyalty] rules save failed:", error.message); return { ok: false, reason: "Couldn't save just now — try again in a moment." }; }
  const r = (data as { ok: boolean; reason?: string }) || { ok: false };
  if (r.ok) return { ok: true };
  const say: Record<string, string> = {
    loyalty_off: "Loyalty points aren't switched on for this restaurant.",
    out_of_range: "Check the numbers: points per ₹100 up to 1000, a point worth 1 paisa to ₹1,000, and points may cover 1–100% of a bill.",
  };
  return { ok: false, reason: say[String(r.reason)] || "Those settings couldn't be saved." };
}

/**
 * CORRECT a balance by hand (mig 403) — the only way points move with no bill behind them.
 *
 * It writes a LEDGER ROW, never a quiet edit of the cached balance, so a guest's history can still
 * explain itself. And it leaves a Removals row: points are worth money, so moving them by hand is a
 * money change like any other — the lesson from the loyalty discount that moved ₹268 and recorded
 * nothing (2026-09-19). A reason is required by the function, not just by the form.
 */
export async function adjustPoints(
  rid: string, phone: string, delta: number, note: string, by: string,
  audit?: { user?: StaffUser | null; deviceId?: string | null; from?: string },
): Promise<{ ok: boolean; moved?: number; balance?: number; reason?: string }> {
  if (!(await loyaltyOn(rid))) return { ok: false, reason: "Loyalty points aren't switched on for this restaurant." };
  const { data, error } = await sb.rpc("lfh_loyalty_adjust", {
    p_restaurant_id: rid, p_phone: phone, p_delta: Math.trunc(Number(delta) || 0),
    p_note: String(note || ""), p_by: by,
  });
  if (error) { console.error("[loyalty] adjust failed:", error.message); return { ok: false, reason: "Couldn't change the points just now — try again in a moment." }; }
  const r = (data as { ok: boolean; moved?: number; balance?: number; reason?: string }) || { ok: false };
  if (!r.ok) {
    const say: Record<string, string> = {
      loyalty_off: "Loyalty points aren't switched on for this restaurant.",
      nothing_to_change: "Enter how many points to add or take away.",
      reason_required: "Say why the points are being changed — it is the only record of it.",
      unknown_guest: "That guest isn't saved on this restaurant.",
    };
    return { ok: false, reason: say[String(r.reason)] || "Those points couldn't be changed." };
  }
  const moved = Number(r.moved) || 0;
  if (moved !== 0) {
    await recordRemoval({
      rid, kind: "discount_given",
      reason: { code: "loyalty_adjust", note: `${moved > 0 ? "+" : ""}${moved} points — ${String(note).slice(0, 160)}` },
      user: audit?.user ?? null, deviceId: audit?.deviceId ?? null,
      amount: null, meta: { points: moved, balance: r.balance, phone_last4: String(phone).slice(-4), from: audit?.from || "owner panel", by },
    });
  }
  return { ok: true, moved, balance: r.balance };
}

/** One guest's points history, newest first — capped in SQL. For justifying a correction. */
export async function loyaltyHistory(rid: string, phone: string, limit = 20): Promise<Array<Record<string, unknown>>> {
  if (!(await loyaltyOn(rid))) return [];
  const { data, error } = await sb.rpc("lfh_loyalty_history", { p_restaurant_id: rid, p_phone: phone, p_limit: limit });
  if (error) { console.error("[loyalty] history failed:", error.message); return []; }
  return (data as Array<Record<string, unknown>>) || [];
}

/**
 * WHICH of these restaurants have Loyalty on — one chunked read for a whole scope.
 *
 * `loyaltyOn()` is per restaurant, so asking it in a loop costs a round-trip each: fine for one
 * restaurant, wrong for the owner list, which can hold several (and the admin's view holds every
 * restaurant on the platform). Same shape and same reason as payrollEffectiveByRid in
 * lib/tableTags.ts — chunked and limited, because an `.in()` list of hundreds of uuids answers
 * "Bad Request" and an unlimited select is silently capped at 1,000 rows. A truncated answer here
 * reads as `undefined` → falsy → a restaurant whose loyalty IS on would show no points at all.
 */
export async function loyaltyOnByRid(ids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  if (!ids.length) return out;
  const { rows } = await readInChunks<Record<string, unknown>>(ids, (chunk) =>
    sb.from("settings").select("restaurant_id, modules").in("restaurant_id", chunk).limit(chunk.length));
  for (const r of rows || []) {
    const bag = (r.modules && typeof r.modules === "object" ? r.modules : {}) as Record<string, { allowed?: boolean; enabled?: boolean }>;
    const e = bag.loyalty || {};
    out[String(r.restaurant_id)] = e.allowed === true && e.enabled !== false;
  }
  return out;
}
