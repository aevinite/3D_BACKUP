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

export const dynamic = "force-dynamic";
const ok = (d: unknown, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
// Parse a money amount tolerantly: strip thousands separators / stray symbols so
// "12,000" or "₹12,000" becomes 12000. Returns null when no valid number remains, so a
// comma-formatted amount no longer silently saves as blank (audit 2026-07-08).
const parseAmount = (v: unknown): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
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
    if (billingQ.error) return bad(billingQ.error.message, 500);
    if (paymentsQ.error) return bad(paymentsQ.error.message, 500);
    return ok({ billing: billingQ.data || null, payments: paymentsQ.data || [] });
  }

  // Use the IST calendar year (owner + the page label are IST) so "Collected this year"
  // doesn't sum the PREVIOUS year for the first ~5.5h after IST New Year while the heading
  // already shows the new one (QA 2026-07-24). IST = UTC+5:30, no DST.
  const yearStart = `${new Date(Date.now() + 330 * 60000).getUTCFullYear()}-01-01`;
  const [restQ, billingQ, yearPaymentsQ] = await Promise.all([
    // Live restaurants only (bug H4, 2026-07-06): a binned restaurant must not appear
    // as a billable row in the SaaS billing table.
    sb.from("restaurants").select("id, name, slug, active").is("deleted_at", null).order("name"),
    // Named columns + a bound (sweep 2026-08-04). This whole-platform read had no .eq(), no column
    // list and no .limit() — the only read in the admin tree missing all three. One row per
    // restaurant makes it small today, but it grows with exactly the number this product is built
    // to increase. BILLING_COLS is the list the page renders.
    sb.from("restaurant_billing").select(BILLING_COLS).limit(2000),
    sb.from("restaurant_payments").select("restaurant_id, amount").gte("paid_on", yearStart).limit(5000),
  ]);
  for (const q of [restQ, billingQ, yearPaymentsQ]) if (q.error) return bad(q.error.message, 500);

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
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
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
    const patch = {
      restaurant_id: rid,
      plan: body.plan ? String(body.plan) : null,
      status,
      amount,
      currency: body.currency ? String(body.currency) : "INR",
      cycle,
      started_on: body.started_on ? String(body.started_on) : null,
      next_due_on: body.next_due_on ? String(body.next_due_on) : null,
      notes: body.notes ? String(body.notes) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("restaurant_billing").upsert(patch, { onConflict: "restaurant_id" });
    if (error) return bad(error.message, 500);
    await logAction("admin", "billing_set_plan", { detail: `${patch.plan || "plan"} · ${status}`, restaurant_id: rid });
    return ok({ ok: true });
  }

  if (action === "add_payment") {
    const rid = String(body.restaurant_id || "");
    const amount = parseAmount(body.amount);
    const paidOn = String(body.paid_on || "");
    if (!isUuid(rid)) return bad("valid restaurant_id required");
    if (amount == null || !(amount > 0)) return bad("Amount must be a number greater than 0 (e.g. 12000).");
    if (!paidOn) return bad("paid_on required");
    const row = {
      restaurant_id: rid, amount, paid_on: paidOn,
      method: body.method ? String(body.method) : null,
      period_label: body.period_label ? String(body.period_label) : null,
      note: body.note ? String(body.note) : null,
    };
    const ins = await sb.from("restaurant_payments").insert(row).select("id").single();
    if (ins.error) return bad(ins.error.message, 500);

    if (body.roll_next_due) {
      const billing = (await sb.from("restaurant_billing").select("cycle").eq("restaurant_id", rid).maybeSingle()).data as { cycle?: string } | null;
      const cycle = billing?.cycle === "monthly" ? "monthly" : "yearly";
      const nextDue = rollForward(paidOn, cycle);
      await sb.from("restaurant_billing").upsert({ restaurant_id: rid, next_due_on: nextDue, updated_at: new Date().toISOString() }, { onConflict: "restaurant_id" });
    }
    await logAction("admin", "billing_add_payment", { detail: `₹${amount} · ${paidOn}`, restaurant_id: rid });
    return ok({ ok: true, id: ins.data?.id });
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
    if (gone.error) return bad(gone.error.message, 500);
    if (!gone.data) return bad("That payment is already gone — refresh the page.", 404);
    await logAction("admin", "billing_delete_payment", { detail: "removed a payment", restaurant_id: (gone.data as { restaurant_id: string }).restaurant_id || null });
    return ok({ ok: true });
  }

  return bad("unknown action");
}, "admin");
