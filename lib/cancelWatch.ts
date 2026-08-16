// lib/cancelWatch.ts — "a day with a lot of voids should reach the owner's phone once."
//
// The last piece of the cancellation rule (docs/COMPLIANCE-GUARDRAILS.md §3.0, owner 2026-08-16:
// "what can we do that the restaurant doesn't cheat, and at the same time we can keep the
// track?"). Cancelling is now the ONLY way a bill leaves the working list, which is the compliant
// design — but a rule nobody watches is a rule that gets leaned on. The Z-report and the owner's
// Cancellations report both state the value now; this is the half that does not wait to be looked
// at.
//
// WHAT IT IS NOT: it is not a block, not an approval step, and it never refuses a cancel. Voiding
// a ticket is ordinary, legitimate restaurant work — a mis-punched order, a walk-out, a dish that
// came out wrong — and a tool that made staff hesitate over it would push them toward the thing we
// actually don't want (settling food nobody paid for, or never ringing it in at all). It only
// says, once, "today looks unusual".
//
// THE THRESHOLD, and why it is two conditions and not one:
//   · at least MIN_COUNT cancelled bills, AND
//   · their value is at least MIN_SHARE of everything sold that day.
// Either alone cries wolf. A share test alone fires on a quiet Tuesday morning where one of two
// bills was voided; a count test alone fires on a busy night where twelve voids are 2% of the
// takings and nothing is wrong. Both together describe the shape the owner actually wants to hear
// about — a lot of money, cancelled, on a day that had money.
//
// EGRESS (docs/SAAS-EFFICIENCY-PLAYBOOK.md): a cancel is a rare write, and the common case costs a
// ROWS-FREE count. Only once that count crosses MIN_COUNT does it read the day's money, scoped and
// limited. So an ordinary service with one or two voids pays for one head request and nothing else.
//
// GROUPING: the key carries the restaurant and the business DAY, so a night that keeps voiding
// pings once, not once per void. (alerts.ts also suppresses an identical key for 15 minutes; the
// day in the key is what makes it once-a-day rather than once-a-quarter-hour.)
//
// SILENT, deliberately: this is a "good to know at the counter", not "run to the kitchen". It
// follows the owner's own rule for which alerts may buzz (lib/alerts.ts) — a thing that is BROKEN
// buzzes, a thing worth noticing arrives quietly and stays in the list. On the backup stacks no
// alert channel is configured at all, so this is a no-op there by design.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { sendOwnerAlert, alertText } from "@/lib/alerts";
import { businessDayStartIso, businessDayDate } from "@/lib/businessDay";

/** How many cancelled bills a day must carry before the value is even looked at. */
export const MIN_COUNT = 5;
/** …and how much of the day's takings they must be worth. 0.2 = a fifth. */
export const MIN_SHARE = 0.2;

const money = (o: { taxable_base?: number | null; nontax_amount?: number | null; subtotal?: number | null }) =>
  (o.taxable_base == null ? Number(o.subtotal) || 0 : Number(o.taxable_base) || 0) + (Number(o.nontax_amount) || 0);

/**
 * Look at today's cancellations for ONE restaurant and, if the day is unusual, ping the owner once.
 *
 * Fire-and-forget: it never throws and never blocks the cancel that triggered it. A watch that can
 * fail a real action is worse than no watch.
 */
export async function watchCancellations(rid: string): Promise<void> {
  try {
    const since = businessDayStartIso();
    // Cheap first: how many, with no rows returned.
    const head = await sb.from("orders").select("id", { count: "exact", head: true })
      .eq("restaurant_id", rid).eq("status", "cancelled").is("deleted_at", null).gte("created_at", since);
    const count = head.count || 0;
    if (count < MIN_COUNT) return;

    // Only now is the money worth reading. Column list + limit, indexed by restaurant + time.
    const rows = (await sb.from("orders")
      .select("status,payment_status,subtotal,taxable_base,nontax_amount,deleted_at")
      .eq("restaurant_id", rid).gte("created_at", since).limit(5000)).data as
      { status: string; payment_status: string; subtotal: number | null; taxable_base: number | null; nontax_amount: number | null; deleted_at: string | null }[] | null;
    if (!rows || !rows.length) return;

    let cancelledValue = 0, soldValue = 0;
    for (const o of rows) {
      if (o.deleted_at) continue;
      if (o.status === "cancelled") cancelledValue += money(o);
      else soldValue += money(o);
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    cancelledValue = r2(cancelledValue);
    soldValue = r2(soldValue);
    // A day that sold nothing at all cannot be "20% cancelled" in any meaningful sense, and firing
    // there would ping every restaurant that opens, voids a test ticket and closes again.
    if (soldValue <= 0) return;
    const share = cancelledValue / (cancelledValue + soldValue);
    if (share < MIN_SHARE) return;

    // The name is read ONLY here, on the one path that is about to send — an alert that says
    // "Restaurant: —" is useless to someone running three of them, and paying for the lookup on
    // every cancel would not be.
    const nameRow = (await sb.from("restaurants").select("name, slug").eq("id", rid).maybeSingle()).data as
      { name?: { en?: string } | string | null; slug?: string | null } | null;
    const restaurantName = typeof nameRow?.name === "string" ? nameRow.name
      : (nameRow?.name && typeof nameRow.name === "object" ? nameRow.name.en : null) || nameRow?.slug || null;
    // ONE per restaurant per business day. businessDayDate() is the same 05:00-IST day the
    // Z-report and the Bills tab use, so "today" means the same thing everywhere.
    const key = `cancel_watch:${rid}:${businessDayDate()}`;
    // NO customer data, no dish names, no table numbers — the rule at the top of lib/alerts.ts.
    // A count, a value and a share is everything the owner needs to decide whether to look.
    await sendOwnerAlert(
      alertText([
        ["Restaurant", restaurantName || "—"],
        ["Cancelled today", `${count} bill${count === 1 ? "" : "s"}`],
        ["Worth", `₹${Math.round(cancelledValue).toLocaleString("en-IN")}`],
        ["Share of the day", `${Math.round(share * 100)}%`],
      ], "Nothing is wrong with the app — this is the day's void level. Reports → Cancellations has the detail."),
      key,
      { silent: true, title: "Cancellations are high today" },
    );
  } catch {
    /* a watch must never be able to break the action it watches */
  }
}
