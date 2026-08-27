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
// The rate ONE order was charged at is decided in the same file the printed bill uses, so this
// path and the paper can never answer differently — see orderTaxRate's own note for why it moved.
import BILLDOC from "@/public/panels/billdoc.js";

export type SplitLeg = {
  amount: number;
  method: string;
  note?: string | null;
  // A PAY-LATER part (supabase/migrations/364_a_split_part_can_be_pay_later.sql — a MIGRATION
  // FILE, and it was renumbered 352 → 364 on 2026-08-22 because two migrations landed as 352
  // twenty minutes apart; every 'mig 352' in this file used to point at the OTHER one, which is
  // about re-seeding and tax filing): this slice was not collected, it is owed. Either an existing person
  // from the khata book, or a name (+ optional phone) to add. Ignored on any other method.
  khataCustomerId?: string | null;
  khataName?: string | null;
  khataPhone?: string | null;
};
export type SplitResult =
  | {
      ok: true; count: number; due: number; note: string; sessionId: string; orderIds: string[];
      /** true = a part was left on someone's tab, so the bill is NOT marked paid and the caller
       *  must close the table (the same thing the whole-bill Pay Later button does). */
      parked: boolean;
      /** who owes the parked part, when there is one — for the caller's log line. */
      customer: { id: string; name: string } | null;
      owed: number;
      collected: number;
    }
  | { ok: false; message: string; status: number };

/** The method that means "not collected — it goes on a tab" (owner, 2026-08-21).
 *
 *  Deliberately NOT added to PAYMENT_METHODS: that list is what a WHOLE bill can be settled with,
 *  and pay-later already has its own button there. This is a method a single PART of a split may
 *  carry, which is a different question. Keeping the lists apart is what stops "Pay later" quietly
 *  becoming a whole-bill payment method that records money nobody collected. */
export const PAY_LATER = "Pay later";
export const SPLIT_METHODS: readonly string[] = [...PAYMENT_METHODS, PAY_LATER];

/** Is this part a tab rather than money? */
const isPayLater = (s: SplitLeg) => String(s?.method) === PAY_LATER;

/** Validate the parts a client sent. Returns null when they're structurally fine. */
export function badSplitShape(splits: unknown): string | null {
  if (!Array.isArray(splits) || splits.length < 2 || splits.length > 12) return "Give at least two parts (max 12).";
  for (const s of splits as SplitLeg[]) {
    if (!(Number(s?.amount) > 0)) return "Every part needs an amount above zero.";
    if (!SPLIT_METHODS.includes(String(s?.method))) return "invalid payment method in a split part";
    if (s?.note != null && String(s.note).length > 200) return "split note too long";
    // A tab has to be owed by SOMEBODY. Without this the amount would go into the book against
    // nobody, which is the one way a debt can quietly disappear.
    if (isPayLater(s) && !String(s?.khataCustomerId || "").trim() && !String(s?.khataName || "").trim())
      return "A pay-later part needs a person — pick who owes it.";
  }
  const later = (splits as SplitLeg[]).filter(isPayLater);
  // ONE tab per bill, for now. The khata book groups a debt by `orders.khata_customer_id`, and one
  // bill's orders can only name one person — so two tabs on one bill would show the whole remainder
  // against whichever name won. Refusing out loud beats recording it against the wrong person.
  // …which also means a split can never be ENTIRELY a tab: that would need every part to be
  // pay-later, and a split needs at least two parts, so the rule above catches it first. (The
  // whole bill on a tab is the Pay Later button, and it is still there.)
  if (later.length > 1) return "Only one part can be pay-later — put the rest on a card, cash or UPI.";
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
  // lockstep with the same fault on the printed bill. Bucketed per rate so tax still rounds ONCE per
  // rate — never per order, which drifts ±½ paise an order and can reject a correct split.
  //
  // ONE DEFINITION, SHARED WITH THE PAPER (2026-08-06). This used to spell the rule out here as
  // `rate > 0 ? stamped : settings`, and the note that followed — "a genuine 0 falls through to the
  // settings, which also answer 0" — stopped being true when billdoc.js was taught to honour a
  // stamped ZERO from an order that carries money. The two still agreed on every input I could
  // construct, but "agrees by luck" is not something to rest a payment screen on: had it diverged,
  // the paper would say ₹1,000 while this refused every split until the parts made ₹1,050.
  const rateOf = (o: MoneyRow) => BILLDOC.orderTaxRate(o, settingsRate);
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
  // ROUND EACH PART ONCE, AND CHECK THE ROUNDED PARTS. The sum used to be taken from the amounts
  // exactly as they arrived while the rows were rounded to the paise on the way in — two different
  // numbers for one settle, so a client sending three decimals could pass the ±2p gate and leave a
  // money trail adding up to something the bill was never settled at. One rounding, used for the
  // check AND for the row. Every panel sends whole rupees, so nothing normal moves.
  const parts = splits.map((s) => ({ ...s, amount: r2(Number(s.amount)) }));
  const sum = r2(parts.reduce((s, x) => s + x.amount, 0));
  if (Math.abs(sum - due) > 0.02) {
    return { ok: false, status: 409, message: `The parts add up to ₹${sum.toFixed(2)} but the bill due is ₹${due.toFixed(2)} — they must match.` };
  }

  // ── IS ONE OF THE PARTS A TAB? (mig 364) ────────────────────────────────────────────────────
  // Split payment IS mark-paid — the bill is settled and the table frees either way (owner,
  // 2026-08-21: "it should work like mark as paid but the amount is being split"). The one
  // difference a tab makes is that its slice was not collected, so the bill cannot be stamped paid
  // and the remainder goes into the khata book, exactly as the whole-bill Pay Later button does.
  const laterPart = parts.find(isPayLater) || null;
  const owed = laterPart ? laterPart.amount : 0;
  const collected = r2(sum - owed);

  // Resolve WHO owes it — an existing person, or add them. Same rule as the khata handler: a phone
  // that already exists reuses that person rather than creating a second row for one human.
  let customer: { id: string; name: string } | null = null;
  if (laterPart) {
    const wantId = String(laterPart.khataCustomerId || "").trim();
    if (wantId) {
      const got = (await sb.from("khata_customers").select("id,name")
        .eq("restaurant_id", rid).eq("id", wantId).maybeSingle()).data as { id: string; name: string } | null;
      if (!got) return { ok: false, status: 404, message: "That person isn't in this restaurant's pay-later book." };
      customer = got;
    } else {
      const name = String(laterPart.khataName || "").trim().slice(0, 80);
      if (!name) return { ok: false, status: 400, message: "A pay-later part needs a person — pick who owes it." };
      const phone = String(laterPart.khataPhone || "").trim().slice(0, 20) || null;
      if (phone) {
        customer = (await sb.from("khata_customers").select("id,name")
          .eq("restaurant_id", rid).eq("phone", phone).maybeSingle()).data as { id: string; name: string } | null;
      }
      if (!customer) {
        const made = await sb.from("khata_customers").insert({ restaurant_id: rid, name, phone }).select("id,name");
        if (made.error) return { ok: false, message: made.error.message, status: 500 };
        customer = (made.data as { id: string; name: string }[])[0];
      }
    }
  }

  // Every part of ONE tap shares a settle group, so the book can subtract what arrived ALONGSIDE
  // the tab and nothing else (see mig 364 — without it an earlier settle on the same session would
  // be subtracted from this debt).
  const group = crypto.randomUUID();
  const legs = parts.map((s) => ({
    session_id: sid, restaurant_id: rid, amount: s.amount,
    method: String(s.method), note: String(s.note || "").slice(0, 200) || null,
    settle_group: group,
    khata_customer_id: isPayLater(s) ? customer!.id : null,
  }));
  const ins = await sb.from("session_payments").insert(legs).select("id");
  if (ins.error) return { ok: false, message: ins.error.message, status: 500 };
  const legIds = ((ins.data || []) as { id: string }[]).map((l) => l.id);

  const note = `${parts.length}-way split: ` + parts.map((s) => `₹${s.amount.toFixed(0)} ${s.method}`).join(" + ")
    + (customer ? ` (${customer.name}'s tab)` : "");
  const ids = rows.map((o) => o.id);
  const stamp = new Date().toISOString();

  // A TAB PARKS THE BILL; NO TAB PAYS IT. The parked shape is the khata handler's, byte for byte:
  // payment_status stays 'pending' so the money is not claimed, khata_at / khata_customer_id put it
  // in the book, and `archived` takes it off the live floor. The CALLER closes the session — that is
  // where the close reason, the ladder and the log line already live.
  const upd = laterPart
    ? await sb.from("orders")
        .update({ khata_at: stamp, khata_customer_id: customer!.id, archived: true, archived_at: stamp })
        .in("id", ids).eq("restaurant_id", rid)
    : await sb.from("orders")
        .update({ payment_status: "paid", paid_at: stamp, payment_method: "Split", payment_note: note.slice(0, 200) })
        .in("id", ids).eq("restaurant_id", rid);
  if (upd.error) {
    // THE TRAIL MUST NOT CLAIM MONEY THAT WAS NEVER TAKEN. The parts land first and the stamp
    // second, with no transaction across the two. Left alone, a failed stamp leaves the bill unpaid
    // while session_payments says the parts were collected on it — so "how did table 6 pay?"
    // answers for a settle that never happened. Stamp them reversed (mig 285's rule: a money record
    // is corrected, never deleted), then still answer 500 so the person knows to retry.
    if (legIds.length) {
      try {
        await sb.from("session_payments").update({
          reversed_at: stamp,
          reversed_by: "auto · the bill was not settled",
          reversed_reason: "the settle failed after the parts were recorded",
        }).in("id", legIds).eq("restaurant_id", rid);
      } catch { /* best-effort: the 500 below is what tells the person, and nothing is deleted */ }
    }
    return { ok: false, message: upd.error.message, status: 500 };
  }

  return {
    ok: true, count: ids.length, due, note, sessionId: sid, orderIds: ids,
    parked: !!laterPart, customer, owed, collected,
  };
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
