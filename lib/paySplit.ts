// ============================================================================
// lib/paySplit.ts — settle ONE bill as SEVERAL payment parts.
//
// "Half in UPI, half in something else — ₹200 from this, ₹200 from that" (owner,
// 2026-08-02). It is the SAME bill either way: the orders are marked paid once with
// method 'Split', and each part lands in session_payments so the money trail says
// exactly how the money came in.
//
// This lives here, not in a route, because BOTH the manager panel and the waiter
// tablet offer it and a money path that exists twice is a money path that drifts.
// Each route keeps its OWN permission gate (managerCan / tabletPerm) and its own
// log line — this only does the arithmetic and the write.
//
// COMPLIANCE (docs/COMPLIANCE-GUARDRAILS.md): the due is recomputed HERE from the
// stored order rows; the browser's number is never trusted, and parts that don't
// add up are refused. Splitting cannot lower, hide or erase a sale.
// ============================================================================

import { PAYMENT_METHODS } from "@/lib/payments";
import { effectiveTaxRate } from "@/lib/tax";

export type SplitLeg = { amount: number; method: string; note?: string | null };
export type SplitResult =
  | { ok: true; count: number; due: number; note: string; sessionId: string; orderIds: string[] }
  | { ok: false; message: string; status: number };

/** Validate the parts a client sent. Returns null when they're structurally fine. */
export function badSplitShape(splits: unknown): string | null {
  if (!Array.isArray(splits) || splits.length < 2 || splits.length > 12) return "Give at least two parts (max 12).";
  for (const s of splits as SplitLeg[]) {
    if (!(Number(s?.amount) > 0)) return "Every part needs an amount above zero.";
    if (!(PAYMENT_METHODS as readonly string[]).includes(String(s?.method))) return "invalid payment method in a split part";
    if (s?.note != null && String(s.note).length > 200) return "split note too long";
  }
  return null;
}

/**
 * Settle a table's whole bill in parts.
 *
 * `sb` is the service-role client. The caller has ALREADY checked that this person
 * may mark a bill paid — this makes no permission decision of its own.
 */
export async function settleBillInParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  opts: { rid: string; table: string; splits: SplitLeg[] },
): Promise<SplitResult> {
  const { rid, table: t, splits } = opts;
  const shape = badSplitShape(splits);
  if (shape) return { ok: false, message: shape, status: 400 };

  // Same scoping as a normal settle: the table's OPEN session's orders (fallback:
  // its active un-archived orders), only accepted + unpaid + non-cancelled ones.
  const openSess = (await sb.from("sessions").select("id")
    .eq("table_number", t).eq("status", "open").eq("restaurant_id", rid)
    .order("last_activity_at", { ascending: false }).limit(1)).data?.[0] as { id: string } | undefined;
  let oq = sb.from("orders").select("id,subtotal,total,discount,status,payment_status,session_id")
    .neq("status", "cancelled").neq("status", "received").neq("payment_status", "paid").eq("restaurant_id", rid);
  oq = openSess ? oq.eq("session_id", openSess.id) : oq.eq("table_number", t).eq("archived", false);
  const rows = (await oq.limit(200)).data as { id: string; subtotal: number; discount: number; session_id: string | null }[] | null;
  if (!rows || !rows.length) return { ok: false, message: "Nothing to settle — already paid, or accept the order first.", status: 409 };
  const sid = openSess?.id || rows.find((o) => o.session_id)?.session_id;
  if (!sid) return { ok: false, message: "This table has no live bill session — settle it normally instead.", status: 409 };

  // Due — the SAME aggregate rounding as billMath (app.js) and the Z-report: taxable =
  // Σsub − Σdisc, tax rounded ONCE over the whole bill. Summing each order's already-
  // rounded total instead drifts ±½ paise per order and can reject parts that exactly
  // equal the printed bill.
  const set = (await sb.from("settings").select("tax_components, tax_rate").eq("restaurant_id", rid).maybeSingle()).data || {};
  const rate = effectiveTaxRate(set);
  const sub = rows.reduce((s, o) => s + (Number(o.subtotal) || 0), 0);
  const disc = rows.reduce((s, o) => s + (Number(o.discount) || 0), 0);
  const taxable = Math.max(0, sub - disc);
  const due = Math.round((taxable + Math.round(taxable * rate * 100) / 100) * 100) / 100;
  const sum = splits.reduce((s, x) => s + Number(x.amount), 0);
  if (Math.abs(sum - due) > 0.02) {
    return { ok: false, status: 409, message: `The parts add up to ₹${sum.toFixed(2)} but the bill due is ₹${due.toFixed(2)} — they must match.` };
  }

  const legs = splits.map((s) => ({
    session_id: sid, restaurant_id: rid, amount: Math.round(Number(s.amount) * 100) / 100,
    method: String(s.method), note: String(s.note || "").slice(0, 200) || null,
  }));
  const ins = await sb.from("session_payments").insert(legs);
  if (ins.error) return { ok: false, message: ins.error.message, status: 500 };

  const note = `${splits.length}-way split: ` + splits.map((s) => `₹${Number(s.amount).toFixed(0)} ${s.method}`).join(" + ");
  const ids = rows.map((o) => o.id);
  const upd = await sb.from("orders")
    .update({ payment_status: "paid", paid_at: new Date().toISOString(), payment_method: "Split", payment_note: note.slice(0, 200) })
    .in("id", ids).eq("restaurant_id", rid);
  if (upd.error) return { ok: false, message: upd.error.message, status: 500 };

  return { ok: true, count: ids.length, due, note, sessionId: sid, orderIds: ids };
}
