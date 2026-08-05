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
import { effectiveTaxRate, TAX_SETTINGS_COLUMNS } from "@/lib/tax";

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
  // A SOFT-DELETED ORDER IS NOT PART OF THE BILL (2026-08-05) — it was neither excluded from the
  // due nor from the rows marked paid, so a split settle collected for a tombstoned line. The
  // printed bill and lib/billLedger.ts both drop it now; this is the third door onto the same rule.
  let oq = sb.from("orders").select("id,subtotal,total,discount,status,payment_status,session_id,taxable_base,nontax_amount,mrp_amount,tax_rate")
    .neq("status", "cancelled").neq("status", "received").neq("payment_status", "paid")
    .is("deleted_at", null).eq("restaurant_id", rid);
  oq = openSess ? oq.eq("session_id", openSess.id) : oq.eq("table_number", t).eq("archived", false);
  // 400, not 200: the cap silently CHANGES the answer rather than refusing — the due would be
  // summed over a partial set and only those rows marked paid. 200 KOTs on one open table is
  // implausible, but a cap that quietly under-collects is the wrong failure mode for money.
  const rows = (await oq.limit(400)).data as { id: string; subtotal: number; discount: number; session_id: string | null }[] | null;
  if (rows && rows.length >= 400) {
    return { ok: false, status: 409, message: "This bill has too many orders to split in one go — settle it in parts from the table instead." };
  }
  if (!rows || !rows.length) return { ok: false, message: "Nothing to settle — already paid, or accept the order first.", status: 409 };
  const sid = openSess?.id || rows.find((o) => o.session_id)?.session_id;
  if (!sid) return { ok: false, message: "This table has no live bill session — settle it normally instead.", status: 409 };

  // Due — the SAME aggregate rounding as billMath (app.js) and the Z-report: tax rounded ONCE
  // over the whole bill. Summing each order's already-rounded total instead drifts ±½ paise per
  // order and can reject parts that exactly equal the printed bill.
  //
  // TAXED ON THE TAXABLE BASE, NOT THE SUBTOTAL (migs 270/272, fixed here 2026-08-04). A bill can
  // carry MRP / nil-rated lines that are never taxed, or prices that already contain the tax, so
  // `Σsubtotal` stopped being the taxable figure — this asked for a due that no longer matched what
  // the bill printed the moment either was in play, and then refused parts that added up correctly.
  // Legacy rows (taxable_base NULL) fall back to subtotal with no untaxed part, which is exactly
  // what those bills charged.
  //
  // AND AT THE RATE THE ORDER WAS ACTUALLY CHARGED (orders.tax_rate, mig 284), so a banquet — its
  // own 18% — is not asked for at the dine-in 5%, and a rate corrected today cannot re-price a bill
  // taken this morning. `> 0` on purpose: a genuine 0 (composition) falls through to the settings,
  // which also return 0, rather than being read as "not stamped".
  const set = (await sb.from("settings").select(TAX_SETTINGS_COLUMNS).eq("restaurant_id", rid).maybeSingle()).data || {};
  const settingsRate = effectiveTaxRate(set);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  type MoneyRow = { taxable_base?: number | null; nontax_amount?: number | null; mrp_amount?: number | null; subtotal?: number; discount?: number; tax_rate?: number | null };
  // THE RATE EACH ORDER WAS CHARGED AT, per order (mig 284) — not one rate borrowed from whichever
  // order came first (2026-08-05). `find(> 0)` asked for the whole bill at that order's rate, so a
  // banquet at 18% sharing a session with 5% food demanded the wrong money, and it demanded it in
  // lockstep with the same fault on the printed bill. `> 0` is kept: a genuine 0 (composition) falls
  // through to the settings, which also answer 0. Bucketed per rate so tax still rounds ONCE per
  // rate — never per order, which drifts ±½ paise an order and can reject a correct split.
  const rateOf = (o: MoneyRow) => (Number(o.tax_rate) > 0 ? Number(o.tax_rate) : settingsRate);
  const base = rows.reduce((s, o) => {
    const r = o as MoneyRow;
    return s + (r.taxable_base == null ? (Number(r.subtotal) || 0) : (Number(r.taxable_base) || 0));
  }, 0);
  const nontax = rows.reduce((s, o) => s + (Number((o as MoneyRow).nontax_amount) || 0), 0);
  const mrp = rows.reduce((s, o) => s + (Number((o as MoneyRow).mrp_amount) || 0), 0);
  const sub = r2(base + nontax);
  const anyTax = rows.some((o) => rateOf(o as MoneyRow) > 0);
  // CLAMP THE DISCOUNT TO ITS OWN BASE, exactly as the printed bill does (billdoc's billMoney) —
  // this used the RAW sum in `sub - disc` (2026-08-05). On an on-the-house bill carrying a sealed
  // MRP item the stored discount is the whole subtotal while the cap is only the food, so the paper
  // asked ₹80 and this asked ₹0; on a legacy over-cap row it produced a NEGATIVE due, and the ±2p
  // gate then refused every split with "the bill due is ₹-200.00" — a tap no waiter could satisfy.
  const discountBase = anyTax ? r2(base) : Math.max(0, r2(sub - mrp));
  const rawDisc = r2(rows.reduce((s, o) => s + (Number(o.discount) || 0), 0));
  const disc = Math.min(Math.max(0, rawDisc), discountBase);
  // Tax per rate bucket, each rounded once, each capping its own discount at its own base.
  const buckets = new Map<number, { base: number; disc: number }>();
  for (const o of rows as MoneyRow[]) {
    const r = rateOf(o);
    const b = buckets.get(r) || { base: 0, disc: 0 };
    b.base += o.taxable_base == null ? (Number(o.subtotal) || 0) : (Number(o.taxable_base) || 0);
    b.disc += Number(o.discount) || 0;
    buckets.set(r, b);
  }
  let tax = 0;
  for (const [r, b] of buckets) {
    const bBase = r2(b.base);
    const bTaxable = Math.max(0, r2(bBase - Math.min(Math.max(0, r2(b.disc)), bBase)));
    tax = r2(tax + r2(bTaxable * r));
  }
  // subtotal − discount + tax: one formula that also holds at a zero rate, where the discount can
  // legitimately land outside the taxable base.
  const due = r2(sub - disc + tax);
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

/**
 * Undo the payment LEGS of a settle that has just been reverted — by stamping them, never by
 * deleting them (mig 285).
 *
 * This existed twice and did two different things: the waiter tablet hard-DELETED the legs over a
 * time window, and the manager panel left them alone entirely. So the same action either erased a
 * money record or left the trail claiming money was collected on a bill now marked unpaid. Both
 * panels call this now, so "how did table 6 pay?" reads the same whoever undid it, and the amounts
 * survive for anyone asking later — which is the whole point of a money trail.
 *
 * `since` scopes it to the settle being undone (the grace window), so older legs on the same bill
 * are left standing. Returns how many were reversed, so the caller can log honestly.
 */
export async function reverseSplitLegs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  opts: { rid: string; sessionId: string; since: string; actor?: string | null; reason?: string | null },
): Promise<{ reversed: number; amount: number }> {
  const { rid, sessionId, since } = opts;
  const live = (await sb.from("session_payments").select("id, amount")
    .eq("session_id", sessionId).eq("restaurant_id", rid)
    .is("reversed_at", null).gte("created_at", since)).data as { id: string; amount: number }[] | null;
  const ids = (live || []).map((l) => l.id);
  if (!ids.length) return { reversed: 0, amount: 0 };
  const amount = Math.round((live || []).reduce((s, l) => s + (Number(l.amount) || 0), 0) * 100) / 100;
  const upd = await sb.from("session_payments").update({
    reversed_at: new Date().toISOString(),
    reversed_by: (opts.actor || "").slice(0, 80) || null,
    reversed_reason: (opts.reason || "").slice(0, 200) || null,
  }).in("id", ids).eq("restaurant_id", rid);
  // Not swallowed: if the trail cannot be corrected, the person undoing the payment must know —
  // silently leaving legs that say money was collected is how the two panels disagreed for months.
  if (upd.error) throw new Error(`couldn't reverse the payment legs: ${upd.error.message}`);
  return { reversed: ids.length, amount };
}
