// /api/admin/billing — SaaS billing (what each restaurant PAYS US), admin-only.
// This is PLATFORM income, not restaurant food revenue (CLAUDE.md hard rule keeps
// those separate — food revenue never appears in /aevinite). The owner enters
// payments manually; there's no payment gateway yet.
//
//   GET                       → every restaurant + its billing row + paid-this-year
//                                + last payment + next-due, for the dense table.
//   GET ?restaurant_id=<uuid> → { billing, payments } for ONE restaurant (the
//                                "Manage billing" editor's payment history).
//   POST { action: "set_plan",      restaurant_id, plan, status, amount, currency, cycle, started_on, next_due_on, notes }
//   POST { action: "add_payment",   restaurant_id, amount, paid_on, method, period_label, note, roll_next_due? }
//   POST { action: "delete_payment", payment_id }
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
import { withIdempotency } from "@/lib/idempotency";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
// The IST calendar date, from the one helper that already knows the rule.
import { todayIST } from "@/lib/staffProfileShared";

export const dynamic = "force-dynamic";
const ok = (d: unknown, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// Parse a money amount tolerantly: strip thousands separators / stray symbols so
// "12,000" or "₹12,000" becomes 12000. Returns null when no valid number remains, so a
// comma-formatted amount no longer silently saves as blank (audit 2026-07-08).
//
// ── "TOLERANTLY" WAS TOO TOLERANT (T16 sweep #7, 2026-08-29) ───────────────────────────────────
// It stripped EVERY character that was not a digit, a dot or a minus, and then took whatever was
// left. That is not tolerance, it is invention:
//
//     "abc"    →  ""     → Number("")  →  0        stored as a ₹0 plan
//     "₹"      →  ""     → Number("")  →  0        stored as a ₹0 plan
//     "x1y2"   →  "12"                 →  12       stored as a ₹12 plan
//
// and none of those reached the refusal below, because it only fires when this returns null. A
// plan amount of 0 is allowed on purpose (free / comped), so a typo did not even look wrong —
// the screen said "Saved." and the restaurant was on a comped plan. This is the platform's own
// subscription money.
//
// So: strip only what a person legitimately types AROUND a number — spaces, thousands separators
// and a leading currency symbol — and then require what is left to BE a number. Everything the
// old one accepted for good reasons still works ("12,000", "₹12,000", "12000.50", " 12000 ").
const parseAmount = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const cleaned = String(v).trim().replace(/[\s,]/g, "").replace(/^[₹$€£]/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

type Billing = {
  restaurant_id: string; plan: string | null; status: string; amount: number | null;
  currency: string; cycle: string; started_on: string | null; next_due_on: string | null; notes: string | null;
};
// Exactly the fields the Billing type declares — i.e. everything the page renders and nothing more.
// Kept next to the type so the two can't drift: add a field there, add it here.
const BILLING_COLS = "restaurant_id, plan, status, amount, currency, cycle, started_on, next_due_on, notes";
export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const rid = new URL(req.url).searchParams.get("restaurant_id");

  if (rid) {
    // Reject a malformed id up front — else Postgres returns a raw "invalid input syntax
    // for type uuid" that leaks straight into the 500 body.
    if (!isUuid(rid)) return bad("Invalid restaurant_id.");
    const [billingQ, paymentsQ] = await Promise.all([
      sb.from("restaurant_billing").select("*").eq("restaurant_id", rid).maybeSingle(),
      sb.from("restaurant_payments").select("id, restaurant_id, amount, paid_on, method, period_label, note, created_at").eq("restaurant_id", rid).order("paid_on", { ascending: false }).limit(200),
    ]);
    // PLAIN WORDS FOR THE CONSOLE (sweep #6, T19). These six sites answered with the database's
    // own sentence, so a failure on the platform-billing page read as e.g. `duplicate key value
    // violates unique constraint "restaurant_billing_pkey"` in a red toast. adminFail keeps that
    // text where it is useful (the response `detail` and the server log) and gives the screen a
    // sentence that names the thing AND says whether anything changed — which on a money page is
    // the part the owner actually needs.
    if (billingQ.error) return adminFail("this restaurant's billing", billingQ.error, { action: "load" });
    if (paymentsQ.error) return adminFail("this restaurant's payment history", paymentsQ.error, { action: "load" });
    return ok({ billing: billingQ.data || null, payments: paymentsQ.data || [] });
  }

  // Use the IST calendar year (owner + the page label are IST) so "Collected this year"
  // doesn't sum the PREVIOUS year for the first ~5.5h after IST New Year while the heading
  // already shows the new one (QA 2026-07-24). IST = UTC+5:30, no DST.
  const yearStart = `${new Date(Date.now() + 330 * 60000).getUTCFullYear()}-01-01`;
  const [restQ, billingQ, yearPaymentsQ] = await Promise.all([
    // Live restaurants only (bug H4, 2026-07-06): a binned restaurant must not appear
    // as a billable row in the SaaS billing table.
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null).order("name").limit(2000),
    // Named columns + a bound (sweep 2026-08-04). This whole-platform read had no .eq(), no column
    // list and no .limit() — the only read in the admin tree missing all three. One row per
    // restaurant makes it small today, but it grows with exactly the number this product is built
    // to increase. BILLING_COLS is the list the page renders.
    sb.from("restaurant_billing").select(BILLING_COLS).limit(2000),
    sb.from("restaurant_payments").select("restaurant_id, amount").gte("paid_on", yearStart).limit(5000),
  ]);
  for (const q of [restQ, billingQ, yearPaymentsQ]) if (q.error) return adminFail("the billing table", q.error, { action: "load" });

  const billingByRid = new Map<string, Billing>((billingQ.data || []).map((b: Billing) => [b.restaurant_id, b]));
  const paidThisYearByRid = new Map<string, number>();
  for (const p of yearPaymentsQ.data || []) paidThisYearByRid.set(p.restaurant_id, (paidThisYearByRid.get(p.restaurant_id) || 0) + (Number(p.amount) || 0));
  const rows = (restQ.data || []).map((r: { id: string; name: string; slug: string; active: boolean }) => {
    const b = billingByRid.get(r.id) || null;
    return {
      id: r.id, name: r.name, slug: r.slug, active: r.active,
      plan: b?.plan ?? null, status: b?.status ?? "trial", amount: b?.amount ?? null, currency: b?.currency ?? "INR",
      cycle: b?.cycle ?? "yearly", startedOn: b?.started_on ?? null, nextDueOn: b?.next_due_on ?? null, notes: b?.notes ?? null,
      paidThisYear: Math.round((paidThisYearByRid.get(r.id) || 0) * 100) / 100,
    };
  });

  // The headline total is shown with a ₹ symbol, so only sum restaurants billed in INR —
  // mixing a USD/EUR amount into a ₹ figure as if 1:1 would be simply wrong (audit
  // 2026-07-06). Every row is INR today; this keeps the number honest if a non-INR plan
  // is ever entered (that currency would need its own line, a later feature).
  const totalCollectedThisYear = Math.round(
    rows.filter((r) => (r.currency || "INR") === "INR").reduce((s, r) => s + r.paidThisYear, 0) * 100
  ) / 100;
  const statusCounts = rows.reduce((m: Record<string, number>, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  // THE SAME CALENDAR AS THE YEAR TOTAL ABOVE (T19 sweep #7, 2026-09-01). `next_due_on` is a plain
  // date entered in IST, and these two lines took the UTC date — so between 00:00 and 05:30 IST the
  // comparison ran against YESTERDAY, and a plan that had just become overdue was counted under
  // "Due soon" instead. Five and a half hours a night on the card that says who owes us money. The
  // year total a few lines up already reasons about exactly this; these did not.
  const today = todayIST();
  // 30 days on, on the same calendar: shift into IST first, then take the date — the arithmetic
  // todayIST() uses, one month later.
  const in30 = new Date(Date.now() + 5.5 * 3600 * 1000 + 30 * 86400000).toISOString().slice(0, 10);
  // "Due soon" = due within the next 30 days but NOT already overdue — a lower bound of
  // today keeps overdue rows out of it (they're counted separately in `overdue`), so the
  // "5 (2 overdue)" card no longer double-counts the same restaurants (audit 2026-07-06).
  const dueSoon = rows.filter((r) => r.nextDueOn && r.nextDueOn >= today && r.nextDueOn <= in30).length;
  const overdue = rows.filter((r) => r.nextDueOn && r.nextDueOn < today).length;

  return ok({ restaurants: rows, summary: { totalCollectedThisYear, statusCounts, dueSoon, overdue } });
}

function rollForward(dateStr: string, cycle: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  if (cycle === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// Wrapped so a lost-response RETRY of "add_payment" (same X-LFH-Action-Id) can't record
// the payment twice (audit 2026-07-08). set_plan / delete_payment send no id → pass through.
export const POST = withIdempotency(async (req: NextRequest) => {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  const action = String(body?.action || "");

  if (action === "set_plan") {
    const rid = String(body.restaurant_id || "");
    if (!isUuid(rid)) return bad("valid restaurant_id required");
    const status = ["trial", "active", "paused", "cancelled"].includes(String(body.status)) ? String(body.status) : "trial";
    const cycle = body.cycle === "monthly" ? "monthly" : "yearly";
    // Reject an amount that isn't a number (rather than silently storing blank — the old
    // Number("12,000") → NaN bug). Empty is allowed (it clears the amount).
    const amount = parseAmount(body.amount);
    if (body.amount !== "" && body.amount != null && amount == null) return bad("Amount isn't a valid number — e.g. 12000 or 12,000.");
    // A plan can be 0 (free/comped) but never negative — a negative would flow straight into
    // Revenue's MRR/ARR as a subtraction and quietly understate the platform's income.
    if (amount != null && amount < 0) return bad("Amount can't be negative.");
    // A DATE, OR NOTHING — the same rule add_payment already keeps for `paid_on` (T19 sweep #7,
    // 2026-09-01). These two went straight at `date` columns with no check, so a typed "27/08/2026"
    // or "next month" answered "Couldn't save this restaurant's plan" — true, but it names no field
    // and gives the admin nothing to correct. Emptying a date is still allowed: that is how a plan's
    // next-due is cleared.
    const dateOr = (v: unknown, field: string): { value: string | null } | { error: string } => {
      if (v === "" || v == null) return { value: null };
      const t = String(v);
      return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t))
        ? { value: t }
        : { error: `Enter ${field} as YYYY-MM-DD (e.g. 2026-08-19), or leave it empty.` };
    };
    const started = dateOr(body.started_on, "the start date");
    if ("error" in started) return bad(started.error);
    const nextDue = dateOr(body.next_due_on, "the next-due date");
    if ("error" in nextDue) return bad(nextDue.error);
    const patch = {
      restaurant_id: rid,
      plan: body.plan ? String(body.plan) : null,
      status,
      amount,
      currency: body.currency ? String(body.currency) : "INR",
      cycle,
      started_on: started.value,
      next_due_on: nextDue.value,
      notes: body.notes ? String(body.notes) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("restaurant_billing").upsert(patch, { onConflict: "restaurant_id" });
    if (error) return adminFail("this restaurant's plan", error, { action: "save" });
    await logAction("admin", "billing_set_plan", { detail: `${patch.plan || "plan"} · ${status}`, restaurant_id: rid });
    return ok({ ok: true });
  }

  if (action === "add_payment") {
    const rid = String(body.restaurant_id || "");
    const amount = parseAmount(body.amount);
    const paidOn = String(body.paid_on || "");
    if (!isUuid(rid)) return bad("valid restaurant_id required");
    if (amount == null || !(amount > 0)) return bad("Amount must be a number greater than 0 (e.g. 12000).");
    // A DATE, not just "something". Anything non-empty used to go straight at a `date` column, so a
    // typo answered with the database's own "invalid input syntax for type date" in a red toast —
    // a sentence that names no field and tells the admin nothing to change.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn)))
      return bad("Enter the payment date as YYYY-MM-DD (e.g. 2026-08-19).");
    const row = {
      restaurant_id: rid, amount, paid_on: paidOn,
      method: body.method ? String(body.method) : null,
      period_label: body.period_label ? String(body.period_label) : null,
      note: body.note ? String(body.note) : null,
    };
    const ins = await sb.from("restaurant_payments").insert(row).select("id").single();
    if (ins.error) return adminFail("this payment", ins.error, { action: "save" });

    // "Also move the next-due date" is a SECOND write, and its failure used to be swallowed: the
    // payment saved, the reply said ok, and next-due quietly stayed where it was — so the restaurant
    // read as due (or overdue) on the Billing table the moment after being paid, and the only way to
    // find out was to notice. The payment itself is already recorded and must not be undone, so this
    // says what happened instead: the payment is in, the date is not.
    let dueMoved: string | null = null;
    if (body.roll_next_due) {
      const billing = (await sb.from("restaurant_billing").select("cycle").eq("restaurant_id", rid).maybeSingle()).data as { cycle?: string } | null;
      const cycle = billing?.cycle === "monthly" ? "monthly" : "yearly";
      const nextDue = rollForward(paidOn, cycle);
      const roll = await sb.from("restaurant_billing").upsert({ restaurant_id: rid, next_due_on: nextDue, updated_at: new Date().toISOString() }, { onConflict: "restaurant_id" });
      if (roll.error) {
        console.error("[admin/billing] payment saved but next-due could not be moved:", roll.error.message);
        await logAction("admin", "billing_add_payment", { detail: `₹${amount} · ${paidOn} · next-due NOT moved`, restaurant_id: rid });
        return ok({ ok: true, id: ins.data?.id, warning: "The payment was saved, but the next-due date could not be moved — set it by hand on the plan." });
      }
      dueMoved = nextDue;
    }
    await logAction("admin", "billing_add_payment", { detail: `₹${amount} · ${paidOn}${dueMoved ? ` · next due ${dueMoved}` : ""}`, restaurant_id: rid });
    return ok({ ok: true, id: ins.data?.id, nextDueOn: dueMoved });
  }

  if (action === "delete_payment") {
    const id = String(body.payment_id || "");
    // Shape-checked like every other id on this route, so a stale row id can't reach a uuid column.
    if (!isUuid(id)) return bad("valid payment_id required");
    // A REMOVAL MUST NOT REPORT ITSELF WHEN NOTHING WENT (sweep #6, T19). This deleted by id and
    // answered ok:true whatever came back, then wrote "removed a payment" to the record. So the
    // page took the row off screen, the year's collected total silently disagreed with the history
    // below it, and the platform's money record carried a removal that never happened. Asking the
    // delete which row it took is one word (`.select`) and makes the answer honest.
    const gone = await sb.from("restaurant_payments").delete().eq("id", id).select("restaurant_id").maybeSingle();
    if (gone.error) return adminFail("this payment", gone.error, { action: "save" });
    if (!gone.data) return bad("That payment is already gone — refresh the page.", 404);
    await logAction("admin", "billing_delete_payment", { detail: "removed a payment", restaurant_id: (gone.data as { restaurant_id: string }).restaurant_id || null });
    return ok({ ok: true });
  }

  return bad("unknown action");
}, "admin");
