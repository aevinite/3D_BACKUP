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

export const dynamic = "force-dynamic";
const ok = (d: unknown, status = 200) => NextResponse.json(d, { status });
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

type Billing = {
  restaurant_id: string; plan: string | null; status: string; amount: number | null;
  currency: string; cycle: string; started_on: string | null; next_due_on: string | null; notes: string | null;
};
export async function GET(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  const rid = new URL(req.url).searchParams.get("restaurant_id");

  if (rid) {
    const [billingQ, paymentsQ] = await Promise.all([
      sb.from("restaurant_billing").select("*").eq("restaurant_id", rid).maybeSingle(),
      sb.from("restaurant_payments").select("id, restaurant_id, amount, paid_on, method, period_label, note, created_at").eq("restaurant_id", rid).order("paid_on", { ascending: false }).limit(200),
    ]);
    if (billingQ.error) return bad(billingQ.error.message, 500);
    if (paymentsQ.error) return bad(paymentsQ.error.message, 500);
    return ok({ billing: billingQ.data || null, payments: paymentsQ.data || [] });
  }

  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const [restQ, billingQ, yearPaymentsQ, lastPaymentsQ] = await Promise.all([
    sb.from("restaurants").select("id, name, slug, active").order("name"),
    sb.from("restaurant_billing").select("*"),
    sb.from("restaurant_payments").select("restaurant_id, amount").gte("paid_on", yearStart).limit(5000),
    sb.from("restaurant_payments").select("restaurant_id, amount, paid_on").order("paid_on", { ascending: false }).limit(1000),
  ]);
  for (const q of [restQ, billingQ, yearPaymentsQ, lastPaymentsQ]) if (q.error) return bad(q.error.message, 500);

  const billingByRid = new Map<string, Billing>((billingQ.data || []).map((b: Billing) => [b.restaurant_id, b]));
  const paidThisYearByRid = new Map<string, number>();
  for (const p of yearPaymentsQ.data || []) paidThisYearByRid.set(p.restaurant_id, (paidThisYearByRid.get(p.restaurant_id) || 0) + (Number(p.amount) || 0));
  const lastPaymentByRid = new Map<string, { amount: number; paid_on: string }>();
  for (const p of lastPaymentsQ.data || []) if (!lastPaymentByRid.has(p.restaurant_id)) lastPaymentByRid.set(p.restaurant_id, { amount: Number(p.amount) || 0, paid_on: p.paid_on });

  const rows = (restQ.data || []).map((r: { id: string; name: string; slug: string; active: boolean }) => {
    const b = billingByRid.get(r.id) || null;
    return {
      id: r.id, name: r.name, slug: r.slug, active: r.active,
      plan: b?.plan ?? null, status: b?.status ?? "trial", amount: b?.amount ?? null, currency: b?.currency ?? "INR",
      cycle: b?.cycle ?? "yearly", startedOn: b?.started_on ?? null, nextDueOn: b?.next_due_on ?? null, notes: b?.notes ?? null,
      paidThisYear: Math.round((paidThisYearByRid.get(r.id) || 0) * 100) / 100,
      lastPayment: lastPaymentByRid.get(r.id) || null,
    };
  });

  const totalCollectedThisYear = Math.round(rows.reduce((s, r) => s + r.paidThisYear, 0) * 100) / 100;
  const statusCounts = rows.reduce((m: Record<string, number>, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = rows.filter((r) => r.nextDueOn && r.nextDueOn <= in30).length;
  const overdue = rows.filter((r) => r.nextDueOn && r.nextDueOn < today).length;

  return ok({ restaurants: rows, summary: { totalCollectedThisYear, statusCounts, dueSoon, overdue } });
}

function rollForward(dateStr: string, cycle: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  if (cycle === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized", 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {}
  const action = String(body?.action || "");

  if (action === "set_plan") {
    const rid = String(body.restaurant_id || "");
    if (!rid) return bad("restaurant_id required");
    const status = ["trial", "active", "paused", "cancelled"].includes(String(body.status)) ? String(body.status) : "trial";
    const cycle = body.cycle === "monthly" ? "monthly" : "yearly";
    const patch = {
      restaurant_id: rid,
      plan: body.plan ? String(body.plan) : null,
      status,
      amount: body.amount === "" || body.amount == null ? null : Number(body.amount),
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
    const amount = Number(body.amount);
    const paidOn = String(body.paid_on || "");
    if (!rid) return bad("restaurant_id required");
    if (!(amount > 0)) return bad("amount must be greater than 0");
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
    if (!id) return bad("payment_id required");
    const row = (await sb.from("restaurant_payments").select("restaurant_id").eq("id", id).maybeSingle()).data as { restaurant_id: string } | null;
    const { error } = await sb.from("restaurant_payments").delete().eq("id", id);
    if (error) return bad(error.message, 500);
    await logAction("admin", "billing_delete_payment", { detail: "removed a payment", restaurant_id: row?.restaurant_id || null });
    return ok({ ok: true });
  }

  return bad("unknown action");
}
