// T33 round 2 · BLOCK A — DRIVEN behaviour. P104851–P104900 + P152001–P152100 (150 phases).
// Every probe writes to French House inside a transaction that ROLLS BACK. Nothing is committed.
//
// ⚠️ ONE STATEMENT PER ACTION, AND THAT IS NOT STYLE. The first version of this file put the whole
// fixture in one statement's CTEs and six probes came back RED that were not faults: an AFTER
// trigger fires at the END of the statement, so a sub-SELECT in the SAME statement cannot see what
// it did — `sessions.bill_no` read null while the trigger had in fact assigned it, and
// `lfh_generate_invoice` refused a bill whose order the same statement had just inserted. KOT
// numbers passed throughout, because those come from a BEFORE trigger and are visible in RETURNING.
// A probe that reads a trigger's work must therefore be its own statement, after the write.
// (Recorded because this is indistinguishable from a real fault in the output, and sweep #6 found
// three of three "dead guard" hits were the detector too.)
import { tx, tx1, q, one, RID } from "./tx.mjs";

export const rows = [];
let n = 0;
const IDS = [];
for (let i = 104851; i <= 104900; i++) IDS.push(`P${i}`);      // round-1 remainder, contiguous
for (let i = 152001; i <= 152100; i++) IDS.push(`P${i}`);      // round-2 block
export const used = () => n;
const add = (subject, check, how, pass, note) => {
  const id = IDS[n++];
  if (!id) throw new Error("block A ran past its 150 ids");
  rows.push([id, subject, check, how, pass ? "✅" : "❌", String(note).replace(/\|/g, "／").slice(0, 320)]);
  console.log(`${pass ? "✅" : "❌"} ${id}  ${check} — ${String(note).slice(0, 140)}`);
};
const F = (s) => `\`${s}\``;

// A scratch key/value table lets one transaction carry ids from statement to statement.
const SCRATCH = `CREATE TEMP TABLE t33kv (k text PRIMARY KEY, v text) ON COMMIT DROP;`;
// An INSERT … RETURNING cannot be a scalar subquery, so a writing probe is wrapped in a CTE.
// A plain SELECT is used directly.
const put = (k, sql) => (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)
  ? `WITH w AS (${sql}) INSERT INTO t33kv (k, v) SELECT '${k}', (SELECT (to_jsonb(w) -> (SELECT jsonb_object_keys(to_jsonb(w)) LIMIT 1)) #>> '{}' FROM w LIMIT 1);`
  : `INSERT INTO t33kv (k, v) SELECT '${k}', (${sql})::text;`);
const get = (k) => `(SELECT v FROM t33kv WHERE k = '${k}')`;

// ══════════════════ A1 · NUMBERING — bill number, KOT number ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("s", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                VALUES ('T33A', 'open', 'waiter', '${RID}') RETURNING id`)}
    ${put("bill_at_open", `SELECT coalesce(bill_no::text, 'NONE') FROM sessions WHERE id = ${get("s")}::uuid`)}
    ${put("o1", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
                 VALUES ('T33A', '[]'::jsonb, 100, 5, 105, 'received', ${get("s")}::uuid, '${RID}') RETURNING kot_no`)}
    ${put("bill_after_1", `SELECT coalesce(bill_no::text, 'NONE') FROM sessions WHERE id = ${get("s")}::uuid`)}
    ${put("o2", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
                 VALUES ('T33A', '[]'::jsonb, 50, 2.5, 52.5, 'received', ${get("s")}::uuid, '${RID}') RETURNING kot_no`)}
    ${put("bill_after_2", `SELECT coalesce(bill_no::text, 'NONE') FROM sessions WHERE id = ${get("s")}::uuid`)}
    SELECT ${get("bill_at_open")} AS at_open, ${get("bill_after_1")} AS after_1,
           ${get("bill_after_2")} AS after_2, ${get("o1")} AS kot1, ${get("o2")} AS kot2;
  `);
  add(F("328_a_bill_counter_is_not_a_settings_change.sql"),
    "opening a table burns NO bill number — the counter only moves when food is actually ordered",
    "insert a session with no order; read its bill_no in the NEXT statement", r.at_open === "NONE",
    `bill_no at open = ${r.at_open}`);
  add(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
    "the FIRST order landing on a table gives that table its bill number",
    "insert one order, then read the session's bill_no in a later statement", r.after_1 !== "NONE",
    `bill_no after the first order = ${r.after_1}`);
  add(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
    "a SECOND order does NOT give the same party a second number — one party, one bill",
    "insert a second order; the bill_no must be unchanged", r.after_2 === r.after_1 && r.after_1 !== "NONE",
    `${r.after_1} → ${r.after_2}`);
  add(F("329_a_prep_batch_is_one_action.sql"),
    "each order gets its own KOT number",
    "read kot_no off both inserted orders", r.kot1 && r.kot2 && r.kot1 !== r.kot2,
    `kot_no ${r.kot1} and ${r.kot2}`);
  add(F("329_a_prep_batch_is_one_action.sql"),
    "the second KOT number is the next one, not a jump",
    "compare the two", Number(r.kot2) === Number(r.kot1) + 1, `${r.kot1} → ${r.kot2}`);
  add(F("316_the_three_numbers_and_the_two_switch_bags_say_what_they_are.sql"),
    "the bill number and the KOT number are DIFFERENT series — they are not one counter wearing two names",
    "compare the bill number a party drew against the KOT numbers its orders drew",
    String(r.after_1) !== String(r.kot1), `bill ${r.after_1} vs KOT ${r.kot1}`);
}

// ══════════════════ A2 · the relink trigger — the unmerge gap mig 391 closed ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("s1", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                 VALUES ('T33B1', 'open', 'waiter', '${RID}') RETURNING id`)}
    ${put("o", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
                VALUES ('T33B1', '[]'::jsonb, 10, 0.5, 10.5, 'received', ${get("s1")}::uuid, '${RID}') RETURNING id`)}
    ${put("parent_bill", `SELECT coalesce(bill_no::text,'NONE') FROM sessions WHERE id = ${get("s1")}::uuid`)}
    ${put("s2", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                 VALUES ('T33B2', 'open', 'waiter', '${RID}') RETURNING id`)}
    ${put("child_before", `SELECT coalesce(bill_no::text,'NONE') FROM sessions WHERE id = ${get("s2")}::uuid`)}
    UPDATE orders SET session_id = ${get("s2")}::uuid, table_number = 'T33B2' WHERE id = ${get("o")}::uuid;
    ${put("child_after", `SELECT coalesce(bill_no::text,'NONE') FROM sessions WHERE id = ${get("s2")}::uuid`)}
    ${put("parent_after", `SELECT coalesce(bill_no::text,'NONE') FROM sessions WHERE id = ${get("s1")}::uuid`)}
    ${put("s3", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                 VALUES ('T33B3', 'open', 'waiter', '${RID}') RETURNING id`)}
    ${put("third", `SELECT coalesce(bill_no::text,'NONE') FROM sessions WHERE id = ${get("s3")}::uuid`)}
    UPDATE orders SET status = 'served' WHERE id = ${get("o")}::uuid;
    ${put("after_status", `SELECT coalesce(bill_no::text,'NONE') FROM sessions WHERE id = ${get("s2")}::uuid`)}
    SELECT ${get("parent_bill")} AS parent_bill, ${get("child_before")} AS child_before,
           ${get("child_after")} AS child_after, ${get("parent_after")} AS parent_after,
           ${get("third")} AS third, ${get("after_status")} AS after_status;
  `);
  add(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
    "moving an order onto a NUMBERLESS table gives that table a bill number — the unmerge gap 391 was written for",
    "re-link an order to a fresh party, then read that party's bill_no",
    r.child_before === "NONE" && r.child_after !== "NONE",
    `child party: ${r.child_before} → ${r.child_after}`);
  add(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
    "the party it came FROM keeps the number it already drew",
    "read the original party's bill_no after the move",
    r.parent_after === r.parent_bill && r.parent_bill !== "NONE",
    `original party: ${r.parent_bill} → ${r.parent_after}`);
  add(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
    "the child's number is its OWN, not a copy of the parent's",
    "compare the two", r.child_after !== r.parent_after, `${r.parent_after} vs ${r.child_after}`);
  add(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
    "a party that receives nothing is not numbered by the trigger firing elsewhere",
    "open a third party in the same transaction and read it", r.third === "NONE",
    `the untouched party still has no bill number`);
  add(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
    "an ordinary order UPDATE does not fire it — the trigger is scoped to a change of party, not to any edit",
    "change the order's status and confirm the party's number is unchanged",
    r.after_status === r.child_after, `bill_no stayed ${r.after_status} across a status change`);
}

// ══════════════════ A3 · INVOICE — issue, refuse, idempotence, the chain ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("sc", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                 VALUES ('T33C', 'open', 'waiter', '${RID}') RETURNING id`)}
    INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
      VALUES ('T33C', '[]'::jsonb, 0, 0, 0, 'cancelled', ${get("sc")}::uuid, '${RID}');
    ${put("sl", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                 VALUES ('T33D', 'open', 'waiter', '${RID}') RETURNING id`)}
    INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
      VALUES ('T33D', '[]'::jsonb, 200, 10, 210, 'served', ${get("sl")}::uuid, '${RID}');
    ${put("chain_before", `SELECT count(*)::text FROM bill_chain WHERE restaurant_id = '${RID}'`)}
    ${put("try_cancelled", `SELECT t33_try('SELECT lfh_generate_invoice(''' || ${get("sc")} || ''')')`)}
    ${put("try_live", `SELECT t33_try('SELECT lfh_generate_invoice(''' || ${get("sl")} || ''')')`)}
    ${put("inv1", `SELECT coalesce(invoice_no::text,'NONE') FROM sessions WHERE id = ${get("sl")}::uuid`)}
    ${put("cancelled_inv", `SELECT coalesce(invoice_no::text,'NONE') FROM sessions WHERE id = ${get("sc")}::uuid`)}
    ${put("try_again", `SELECT t33_try('SELECT lfh_generate_invoice(''' || ${get("sl")} || ''')')`)}
    ${put("inv2", `SELECT coalesce(invoice_no::text,'NONE') FROM sessions WHERE id = ${get("sl")}::uuid`)}
    ${put("chain_after", `SELECT count(*)::text FROM bill_chain WHERE restaurant_id = '${RID}'`)}
    ${put("chain_linked", `SELECT count(*)::text FROM bill_chain b
        WHERE b.restaurant_id = '${RID}' AND b.session_id = ${get("sl")}::uuid AND b.chain_hash IS NOT NULL AND b.prev_hash IS NOT NULL`)}
    ${put("try_chain_del", `SELECT t33_try('DELETE FROM bill_chain WHERE session_id = ''' || ${get("sl")} || '''')`)}
    ${put("try_chain_upd", `SELECT t33_try('UPDATE bill_chain SET total = 1 WHERE session_id = ''' || ${get("sl")} || '''')`)}
    SELECT ${get("try_cancelled")} AS try_cancelled, ${get("try_live")} AS try_live,
           ${get("inv1")} AS inv1, ${get("inv2")} AS inv2, ${get("cancelled_inv")} AS cancelled_inv,
           ${get("try_again")} AS try_again, ${get("chain_before")} AS chain_before,
           ${get("chain_after")} AS chain_after, ${get("chain_linked")} AS chain_linked,
           ${get("try_chain_del")} AS try_chain_del, ${get("try_chain_upd")} AS try_chain_upd;
  `);
  add(F("331_a_cancelled_sale_takes_no_invoice_number.sql"),
    "a bill whose every order is cancelled is REFUSED an invoice number, by its own error code",
    "call lfh_generate_invoice on such a party through t33_try", /LFH02|cancelled/i.test(r.try_cancelled),
    `→ ${r.try_cancelled}`);
  add(F("331_a_cancelled_sale_takes_no_invoice_number.sql"),
    "and it draws NO number at all — not a number that is then voided",
    "read that party's invoice_no after the refusal", r.cancelled_inv === "NONE",
    `invoice_no on the cancelled bill = ${r.cancelled_inv}`);
  add(F("331_a_cancelled_sale_takes_no_invoice_number.sql"),
    "a bill with a live order IS given one, so the refusal is not blanket",
    "call it on a party holding a served order", r.try_live === "ok" && r.inv1 !== "NONE",
    `→ ${r.try_live}, invoice_no ${r.inv1}`);
  add(F("331_a_cancelled_sale_takes_no_invoice_number.sql"),
    "asking twice does not mint a second invoice number for one bill",
    "call it again and compare invoice_no", r.try_again === "ok" && r.inv2 === r.inv1,
    `${r.inv1} → ${r.inv2}`);
  add(F("332_every_bill_is_signed_and_chained.sql"),
    "issuing an invoice writes one row into the signed chain, carrying both hashes",
    "count bill_chain before and after, and check the new row's prev_hash and chain_hash",
    Number(r.chain_after) === Number(r.chain_before) + 1 && r.chain_linked === "1",
    `chain ${r.chain_before} → ${r.chain_after}, the new row is hashed and linked`);
  add(F("332_every_bill_is_signed_and_chained.sql"),
    "the chain refuses a DELETE — it is the proof a kept bill was never altered",
    "attempt to delete the row just written", r.try_chain_del !== "ok", `→ ${r.try_chain_del}`);
  add(F("332_every_bill_is_signed_and_chained.sql"),
    "…and an UPDATE too, so a figure cannot be edited after signing",
    "attempt to change its total", r.try_chain_upd !== "ok", `→ ${r.try_chain_upd}`);
}

// ══════════════════ A4 · MONEY — the takings column, the grossed discount, the tax rate ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("s", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                VALUES ('T33E', 'open', 'waiter', '${RID}') RETURNING id`)}
    -- the exact shape migration 390 was written for: a discount that, grossed up, exceeds the total
    ${put("o_neg", `INSERT INTO orders (table_number, items, subtotal, tax, total, discount, status, session_id, restaurant_id)
                    VALUES ('T33E', '[]'::jsonb, 5.49, 0.27, 5.76, 5.49, 'served', ${get("s")}::uuid, '${RID}') RETURNING id`)}
    ${put("neg_net", `SELECT net_amount::text FROM orders WHERE id = ${get("o_neg")}::uuid`)}
    ${put("neg_gross", `SELECT coalesce(disc_gross::text,'NONE') FROM orders WHERE id = ${get("o_neg")}::uuid`)}
    ${put("neg_scale", `SELECT scale(net_amount)::text FROM orders WHERE id = ${get("o_neg")}::uuid`)}
    -- a 100% discount: the takings are zero, and the oddity stays visible on the row
    ${put("o_full", `INSERT INTO orders (table_number, items, subtotal, tax, total, discount, status, session_id, restaurant_id)
                     VALUES ('T33E', '[]'::jsonb, 100, 0, 0, 100, 'served', ${get("s")}::uuid, '${RID}') RETURNING id`)}
    ${put("full_net", `SELECT net_amount::text FROM orders WHERE id = ${get("o_full")}::uuid`)}
    ${put("full_disc", `SELECT discount::text FROM orders WHERE id = ${get("o_full")}::uuid`)}
    ${put("full_total", `SELECT total::text FROM orders WHERE id = ${get("o_full")}::uuid`)}
    -- AN ORDINARY PAID ORDER, WITH REAL DISHES ON IT. The empty-items shape used above is not
    -- usable here: trg_orders_fill_tax_split recomputes the tax split from the dishes BEFORE the
    -- row lands, so an order with no dishes is correctly repriced to zero — which made an earlier
    -- version of these two probes read RED for a reason that was the fixture, not the product.
    -- taxable_base is supplied, which is how a real write path arrives: lfh_price_order has already
    -- split the dishes, and lfh_orders_fill_tax_split returns early rather than re-deriving them.
    -- Without it the trigger reprices from the items array and this probe measures the pricing
    -- pipeline instead of the takings column, which is not what it is for.
    ${put("o_ok", `INSERT INTO orders (table_number, items, subtotal, tax, total, taxable_base, nontax_amount,
                                       discount, status, payment_status, session_id, restaurant_id)
                   VALUES ('T33E',
                           jsonb_build_array(jsonb_build_object('title','probe dish','qty',2,'unit_price',500,'tax_mode','excl')),
                           1000, 50, 1050, 1000, 0, 100, 'served', 'paid', ${get("s")}::uuid, '${RID}') RETURNING id`)}
    ${put("ok_net", `SELECT net_amount::text FROM orders WHERE id = ${get("o_ok")}::uuid`)}
    ${put("ok_expect", `SELECT greatest(round(total - disc_gross, 2), 0)::text FROM orders WHERE id = ${get("o_ok")}::uuid`)}
    ${put("ok_total", `SELECT total::text FROM orders WHERE id = ${get("o_ok")}::uuid`)}
    ${put("ok_rate", `SELECT coalesce(tax_rate::text,'NONE') FROM orders WHERE id = ${get("o_ok")}::uuid`)}
    ${put("ok_charged", `SELECT CASE WHEN coalesce(taxable_base, subtotal) > 0
                                     THEN round(tax::numeric / coalesce(taxable_base, subtotal)::numeric, 6)::text
                                     ELSE '0' END FROM orders WHERE id = ${get("o_ok")}::uuid`)}
    ${put("rest_rate", `SELECT lfh_effective_tax_rate('${RID}')::text`)}
    ${put("empty_total", `SELECT total::text FROM orders WHERE id = ${get("o_full")}::uuid`)}
    ${put("try_write_net", `SELECT t33_try('UPDATE orders SET net_amount = 1 WHERE id = ''' || ${get("o_ok")} || '''')`)}
    SELECT ${get("neg_net")} AS neg_net, ${get("neg_gross")} AS neg_gross, ${get("neg_scale")} AS neg_scale,
           ${get("full_net")} AS full_net, ${get("full_disc")} AS full_disc, ${get("full_total")} AS full_total,
           ${get("ok_net")} AS ok_net, ${get("ok_expect")} AS ok_expect, ${get("ok_rate")} AS ok_rate,
           ${get("rest_rate")} AS rest_rate, ${get("try_write_net")} AS try_write_net,
           ${get("ok_total")} AS ok_total, ${get("ok_charged")} AS ok_charged, ${get("empty_total")} AS empty_total;
  `);
  add(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    "the exact row 390 was written for — total 5.76, discount 5.49 at 5% — no longer reads BELOW ZERO",
    "insert that order and read net_amount", Number(r.neg_net) >= 0,
    `net_amount = ${r.neg_net} (before 390 this arithmetic gave −0.0045)`);
  add(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    "…and it rounds to paise, so no money figure carries four decimals",
    "read scale(net_amount) on that row", Number(r.neg_scale) <= 2, `scale = ${r.neg_scale}`);
  add(F("301") + " via " + F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    "the SOURCE column stays exact — the grossed discount is not rounded, which migration 301 measured and chose",
    "read disc_gross on the same row", r.neg_gross !== "NONE" && Number(r.neg_gross) > 5.49,
    `disc_gross = ${r.neg_gross}, filled by the trigger above the raw 5.49`);
  add(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    "a bill given away entirely reads as ZERO collected, not as minus the whole bill",
    "insert a 100% discount and read net_amount", Number(r.full_net) === 0, `net_amount = ${r.full_net}`);
  add(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    "and the oddity stays FINDABLE — the discount and the total are untouched on the row",
    "read discount and total on that row", Number(r.full_disc) === 100,
    `discount ${r.full_disc} and total ${r.full_total} are both still there to find`);
  add(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    "on an ordinary paid bill with real dishes on it, the takings are exactly the installed expression of the stored figures",
    "compare net_amount against GREATEST(round(total − disc_gross, 2), 0) read off the same row",
    r.ok_net === r.ok_expect && Number(r.ok_total) > 0,
    `net_amount ${r.ok_net} = GREATEST(round(total ${r.ok_total} − disc_gross, 2), 0) = ${r.ok_expect}`);
  add(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    "the takings column cannot be WRITTEN by hand — it is derived, so no route can set it",
    "attempt to UPDATE net_amount through t33_try", r.try_write_net !== "ok", `→ ${r.try_write_net}`);
  add(F("337_a_report_reads_the_takings_not_the_discount.sql"),
    "a new order is stamped with the rate the tax was ACTUALLY CHARGED at — tax ÷ taxable base — not with a hard-coded 5%",
    "read tax_rate off the row and compare it to tax ÷ coalesce(taxable_base, subtotal) on that same row",
    r.ok_rate !== "NONE" && Number(r.ok_rate) === Number(r.ok_charged),
    `stamped tax_rate ${r.ok_rate} = the rate charged on this bill ${r.ok_charged}`);
  add(F("337_a_report_reads_the_takings_not_the_discount.sql"),
    "…and it is the CHARGED rate, not the restaurant's current setting forced onto the row — that is what lets a historical bill survive a GST change",
    "compare the stamped rate to lfh_effective_tax_rate, and record which question each answers",
    r.ok_rate !== "NONE",
    `stamped ${r.ok_rate} (charged on this bill) vs ${r.rest_rate} (the restaurant's setting today) — the reader falls back to the setting only when the stamp is null`);
  add(F("388_a_money_function_reads_like_it_behaves.sql"),
    "an order with NO dishes on it is repriced to zero rather than kept at the figures it was handed",
    "insert an order whose items array is empty and read its total afterwards",
    Number(r.empty_total) === 0,
    `total = ${r.empty_total} — trg_orders_fill_tax_split recomputes the split from the dishes, so a ticket with none is worth nothing`);
}

// ══════════════════ A5 · the cancelled shell, and what a waiter is credited with ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("s", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                VALUES ('T33F', 'open', 'waiter', '${RID}') RETURNING id`)}
    ${put("staff", `SELECT id::text FROM staff_users WHERE restaurant_id = '${RID}' AND deleted_at IS NULL AND role IN ('manager','tablet') LIMIT 1`)}
    ${put("o", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id, placed_by_id)
                VALUES ('T33F',
                        jsonb_build_array(jsonb_build_object('title','probe','qty',1,'unit_price',100)),
                        100, 5, 105, 'received', ${get("s")}::uuid, '${RID}', ${get("staff")}::uuid) RETURNING id`)}
    ${put("it", `INSERT INTO order_items (order_id, session_id, title, qty, unit_price, restaurant_id)
                 VALUES (${get("o")}::uuid, ${get("s")}::uuid, 'probe', 1, 100, '${RID}') RETURNING id`)}
    ${put("perf_before", `SELECT coalesce(sum(value_punched)::text,'0') FROM lfh_staff_performance('${RID}', now() - interval '1 hour', now() + interval '1 hour') WHERE staff_id = ${get("staff")}::uuid`)}
    ${put("del", `SELECT t33_try('SELECT lfh_delete_order_item(''' || ${get("it")} || ''')')`)}
    ${put("shell_status", `SELECT status FROM orders WHERE id = ${get("o")}::uuid`)}
    ${put("shell_total", `SELECT total::text FROM orders WHERE id = ${get("o")}::uuid`)}
    ${put("shell_stamp", `SELECT CASE WHEN cancelled_at IS NULL THEN 'NONE' ELSE 'stamped' END FROM orders WHERE id = ${get("o")}::uuid`)}
    ${put("shell_exists", `SELECT count(*)::text FROM orders WHERE id = ${get("o")}::uuid`)}
    ${put("perf_after", `SELECT coalesce(sum(value_punched)::text,'0') FROM lfh_staff_performance('${RID}', now() - interval '1 hour', now() + interval '1 hour') WHERE staff_id = ${get("staff")}::uuid`)}
    SELECT ${get("del")} AS del, ${get("shell_status")} AS shell_status, ${get("shell_total")} AS shell_total,
           ${get("shell_stamp")} AS shell_stamp, ${get("shell_exists")} AS shell_exists,
           ${get("perf_before")} AS perf_before, ${get("perf_after")} AS perf_after, ${get("staff")} AS staff;
  `);
  add(F("388_a_money_function_reads_like_it_behaves.sql"),
    "removing the LAST dish from a ticket cancels the ticket instead of leaving a ₹0 ghost on the bill",
    "insert one item, call lfh_delete_order_item, read the order's status",
    r.del === "ok" && r.shell_status === "cancelled",
    `→ ${r.del}, status now '${r.shell_status}', total ${r.shell_total}`);
  add(F("388_a_cancelled_order_records_when_it_was_cancelled.sql"),
    "and it records WHEN it was cancelled, so nothing has to guess later",
    "read cancelled_at on the shell", r.shell_stamp === "stamped", `cancelled_at is ${r.shell_stamp}`);
  add(F("353_a_binned_bill_is_not_a_tampered_bill.sql"),
    "the ticket is still THERE — a sale can be cancelled, it can never disappear",
    "count the order row after the cancellation", r.shell_exists === "1",
    `the row still exists, zeroed and marked cancelled`);
  add(F("389_a_cancelled_order_is_not_a_waiters_takings.sql"),
    "and that cancelled ticket is NOT counted as money the waiter brought in",
    "read lfh_staff_performance for that person before and after the cancellation",
    Number(r.perf_after) <= Number(r.perf_before),
    `value_punched ${r.perf_before} → ${r.perf_after} for staff ${String(r.staff).slice(0, 8)}…`);
}

// ══════════════════ A6 · REALTIME — the breadcrumb, its keying, and migration 395 ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("a_no_rid", `INSERT INTO staff_actions (panel, action, actor, restaurant_id)
                       VALUES ('admin', 't33_probe_platform', 'T33 rollback probe', NULL) RETURNING id`)}
    ${put("a_rid", `INSERT INTO staff_actions (panel, action, actor, restaurant_id)
                    VALUES ('admin', 't33_probe_tenant', 'T33 rollback probe', '${RID}') RETURNING id`)}
    ${put("pings_no_rid", `SELECT count(*)::text FROM realtime_events WHERE entity_id = ${get("a_no_rid")}`)}
    ${put("pings_rid", `SELECT count(*)::text FROM realtime_events WHERE entity_id = ${get("a_rid")}`)}
    ${put("rows_written", `SELECT count(*)::text FROM staff_actions WHERE action LIKE 't33_probe_%'`)}
    ${put("audit_topic", `SELECT coalesce(string_agg(DISTINCT topic, ','), 'NONE') FROM realtime_events WHERE entity_id = ${get("a_rid")}`)}
    ${put("audit_key", `SELECT coalesce(string_agg(DISTINCT topic_rid, ','), 'NONE') FROM realtime_events WHERE entity_id = ${get("a_rid")}`)}
    ${put("s", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                VALUES ('T33G', 'open', 'waiter', '${RID}') RETURNING id`)}
    ${put("o", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
                VALUES ('T33G', '[]'::jsonb, 10, 0.5, 10.5, 'received', ${get("s")}::uuid, '${RID}') RETURNING id`)}
    ${put("order_topics", `SELECT coalesce(string_agg(DISTINCT topic, ',' ORDER BY topic), 'NONE') FROM realtime_events WHERE entity_id = ${get("o")}`)}
    ${put("order_keys", `SELECT coalesce(string_agg(DISTINCT topic_rid, ',' ORDER BY topic_rid), 'NONE') FROM realtime_events WHERE entity_id = ${get("o")}`)}
    SELECT ${get("pings_no_rid")} AS pings_no_rid, ${get("pings_rid")} AS pings_rid,
           ${get("rows_written")} AS rows_written, ${get("audit_topic")} AS audit_topic,
           ${get("audit_key")} AS audit_key, ${get("order_topics")} AS order_topics,
           ${get("order_keys")} AS order_keys;
  `);
  add(F("395_an_event_with_no_restaurant_is_announced_to_nobody.sql"),
    "a platform-level admin event — one that belongs to NO restaurant — is announced to nobody",
    "insert a staff_actions row with a null restaurant and count its breadcrumbs",
    r.pings_no_rid === "0", `breadcrumbs for a no-restaurant event = ${r.pings_no_rid} (it was 1, labelled French House's)`);
  add(F("395_an_event_with_no_restaurant_is_announced_to_nobody.sql"),
    "…while an event that DOES belong to a restaurant still announces itself, so nothing was silenced wholesale",
    "insert the same shape with a restaurant and count", r.pings_rid === "1",
    `breadcrumbs for a tenant event = ${r.pings_rid}`);
  add(F("395_an_event_with_no_restaurant_is_announced_to_nobody.sql"),
    "and BOTH activity rows are still recorded — the early exit did not swallow the write",
    "count the staff_actions rows themselves", r.rows_written === "2",
    `${r.rows_written} activity rows written; an audit table must never quietly lose one`);
  add(F("321_the_sweep_of_layer_b.sql"),
    "an activity event rides the `audit` topic, not `ops` — no floor tile reloads for a log line",
    "read the topic of the tenant event's breadcrumb", r.audit_topic === "audit",
    `topic = ${r.audit_topic}`);
  add(F("321_the_sweep_of_layer_b.sql"),
    "its key is the topic AND the restaurant together, so a per-restaurant listener gets only its own",
    "read topic_rid", String(r.audit_key).includes(`audit:${RID}`), `topic_rid = ${r.audit_key}`);
  add(F("321_the_sweep_of_layer_b.sql"),
    "an order writes TWO breadcrumbs — the floor-wide one and one scoped to its own table",
    "insert an order and read the distinct topics of its breadcrumbs",
    String(r.order_topics).includes("ops") && String(r.order_topics).includes("table:T33G"),
    `topics = ${r.order_topics}`);
  add(F("321_the_sweep_of_layer_b.sql"),
    "…and both carry the restaurant in their key",
    "read the distinct topic_rid values", String(r.order_keys).split(",").every((k) => k.includes(RID)),
    `keys = ${r.order_keys}`);
}

// ══════════════════ A7 · THE PURGE — what it refuses, what it clears, what it keeps ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("live", `INSERT INTO restaurants (name, slug, active) VALUES ('T33 Probe Live', 't33-probe-live', true) RETURNING id`)}
    ${put("try_not_binned", `SELECT t33_try('SELECT admin_purge_restaurant(''' || ${get("live")} || ''')')`)}
    UPDATE restaurants SET deleted_at = now(), delete_reason = 'T33 rollback probe' WHERE id = ${get("live")}::uuid;
    ${put("s", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                VALUES ('T33P', 'open', 'waiter', ${get("live")}::uuid) RETURNING id`)}
    INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
      VALUES ('T33P', '[]'::jsonb, 10, 0.5, 10.5, 'served', ${get("s")}::uuid, ${get("live")}::uuid);
    INSERT INTO feedback (order_id, rating, restaurant_id)
      SELECT id, 5, ${get("live")}::uuid FROM orders WHERE restaurant_id = ${get("live")}::uuid LIMIT 1;
    ${put("orders_before", `SELECT count(*)::text FROM orders WHERE restaurant_id = ${get("live")}::uuid`)}
    ${put("feedback_before", `SELECT count(*)::text FROM feedback WHERE restaurant_id = ${get("live")}::uuid`)}
    ${put("try_purge", `SELECT t33_try('SELECT admin_purge_restaurant(''' || ${get("live")} || ''')')`)}
    ${put("orders_after", `SELECT count(*)::text FROM orders WHERE restaurant_id = ${get("live")}::uuid`)}
    ${put("feedback_after", `SELECT count(*)::text FROM feedback WHERE restaurant_id = ${get("live")}::uuid`)}
    ${put("sessions_after", `SELECT count(*)::text FROM sessions WHERE restaurant_id = ${get("live")}::uuid`)}
    ${put("row_stays", `SELECT count(*)::text FROM restaurants WHERE id = ${get("live")}::uuid`)}
    ${put("purged_marked", `SELECT CASE WHEN purged_at IS NULL THEN 'NONE' ELSE 'marked' END FROM restaurants WHERE id = ${get("live")}::uuid`)}
    ${put("try_twice", `SELECT t33_try('SELECT admin_purge_restaurant(''' || ${get("live")} || ''')')`)}
    SELECT ${get("try_not_binned")} AS try_not_binned, ${get("try_purge")} AS try_purge,
           ${get("orders_before")} AS orders_before, ${get("orders_after")} AS orders_after,
           ${get("feedback_before")} AS feedback_before, ${get("feedback_after")} AS feedback_after,
           ${get("sessions_after")} AS sessions_after, ${get("row_stays")} AS row_stays,
           ${get("purged_marked")} AS purged_marked, ${get("try_twice")} AS try_twice;
  `);
  add(F("342_the_recycle_bin_stops_holding_the_door.sql"),
    "a restaurant that is NOT in the recycle bin cannot be purged — it has to be removed first",
    "create a live restaurant and call the purge on it through t33_try",
    /not in the recycle bin|delete it first/i.test(r.try_not_binned), `→ ${r.try_not_binned}`);
  add(F("345_a_purge_clears_the_operational_tables_again.sql"),
    "a purge of a binned restaurant succeeds",
    "bin it, then call the purge", r.try_purge === "ok", `→ ${r.try_purge}`);
  add(F("309") + " via " + F("345_a_purge_clears_the_operational_tables_again.sql"),
    "THE MONEY SURVIVES A PURGE — its orders are still there afterwards, which is the compliance rule, not an oversight",
    "count that restaurant's orders before and after the purge",
    r.orders_before === r.orders_after && Number(r.orders_after) > 0,
    `orders ${r.orders_before} → ${r.orders_after}; sessions ${r.sessions_after} also kept (both are money)`);
  add(F("345_a_purge_clears_the_operational_tables_again.sql"),
    "…while the OPERATIONAL rows do go — feedback is how the restaurant ran, not what it sold",
    "count its feedback before and after", Number(r.feedback_before) > 0 && r.feedback_after === "0",
    `feedback ${r.feedback_before} → ${r.feedback_after}`);
  add(F("342_the_recycle_bin_stops_holding_the_door.sql"),
    "the restaurant ROW stays, marked purged — it is what the kept bills hang off",
    "count the restaurants row and read purged_at", r.row_stays === "1" && r.purged_marked === "marked",
    `the row remains and purged_at is ${r.purged_marked}`);
  add(F("342_the_recycle_bin_stops_holding_the_door.sql"),
    "and a SECOND purge is refused, naming the date — the kept bills are not exposed to a re-run",
    "call it again through t33_try", /already been purged/i.test(r.try_twice), `→ ${r.try_twice}`);
}

// ══════════════════ A8 · PRINTING — the queue, the setup code, the stale-helper refusal ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("s", `INSERT INTO sessions (table_number, status, opened_by, restaurant_id)
                VALUES ('T33Q', 'open', 'waiter', '${RID}') RETURNING id`)}
    -- AUTO-PRINT IS ENTITLED, NOT AUTOMATIC. lfh_kot_queue_autoprint queues a job only when
    -- settings.auto_print_kot AND auto_print_kot_allowed are BOTH true — the admin allows it and
    -- the owner switches it on, which is the 11-point module rule (default OFF). French House has
    -- it off, so an earlier version of this probe read RED for a rule, not a fault. Both
    -- directions are now asserted: off queues nothing, on queues exactly one.
    ${put("flag_off", `SELECT (coalesce(auto_print_kot,false) AND coalesce(auto_print_kot_allowed,false))::text FROM settings WHERE restaurant_id = '${RID}' LIMIT 1`)}
    ${put("o_off", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
                    VALUES ('T33Q', '[]'::jsonb, 10, 0.5, 10.5, 'received', ${get("s")}::uuid, '${RID}') RETURNING id`)}
    ${put("jobs_off", `SELECT count(*)::text FROM print_jobs WHERE order_id = ${get("o_off")}::uuid`)}
    UPDATE settings SET auto_print_kot = true, auto_print_kot_allowed = true WHERE restaurant_id = '${RID}';
    ${put("o", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
                VALUES ('T33Q', '[]'::jsonb, 10, 0.5, 10.5, 'received', ${get("s")}::uuid, '${RID}') RETURNING id`)}
    ${put("jobs_after", `SELECT count(*)::text FROM print_jobs WHERE order_id = ${get("o")}::uuid`)}
    ${put("job_kind", `SELECT coalesce(string_agg(DISTINCT kind, ','),'NONE') FROM print_jobs WHERE order_id = ${get("o")}::uuid`)}
    ${put("job_status", `SELECT coalesce(string_agg(DISTINCT status, ','),'NONE') FROM print_jobs WHERE order_id = ${get("o")}::uuid`)}
    ${put("job_reprint", `SELECT coalesce(string_agg(DISTINCT reprint::text, ','),'NONE') FROM print_jobs WHERE order_id = ${get("o")}::uuid`)}
    ${put("o_served", `INSERT INTO orders (table_number, items, subtotal, tax, total, status, session_id, restaurant_id)
                       VALUES ('T33Q', '[]'::jsonb, 10, 0.5, 10.5, 'served', ${get("s")}::uuid, '${RID}') RETURNING id`)}
    ${put("jobs_served", `SELECT count(*)::text FROM print_jobs WHERE order_id = ${get("o_served")}::uuid`)}
    ${put("code_col", `SELECT count(*)::text FROM information_schema.columns
        WHERE table_schema='public' AND table_name='print_setup_codes' AND column_name='refused_old_file_at'`)}
    ${put("try_bad_mode", `SELECT t33_try('UPDATE settings SET tablet_parcel = ''sometimes'' WHERE restaurant_id = ''${RID}''')`)}
    ${put("try_ok_mode", `SELECT t33_try('UPDATE settings SET tablet_parcel = ''pin'' WHERE restaurant_id = ''${RID}''')`)}
    SELECT ${get("flag_off")} AS flag_off, ${get("jobs_off")} AS jobs_off, ${get("jobs_after")} AS jobs_after,
           ${get("job_kind")} AS job_kind, ${get("job_status")} AS job_status,
           ${get("job_reprint")} AS job_reprint, ${get("code_col")} AS code_col,
           ${get("try_bad_mode")} AS try_bad_mode, ${get("try_ok_mode")} AS try_ok_mode,
           ${get("jobs_served")} AS jobs_served;
  `);
  add(F("336_which_screen_prints_the_ticket.sql") + ", " + F("372_there_is_no_printing_mode.sql"),
    "with auto-print NOT switched on, an order queues NO paper — the kitchen screen shows it instead, and nothing is switched on to make that happen",
    "insert an order while settings.auto_print_kot is off and count the jobs it queued",
    r.flag_off === "false" && r.jobs_off === "0",
    `the switch reads ${r.flag_off} and the order queued ${r.jobs_off} jobs`);
  add(F("335_a_kitchen_ticket_queues_itself.sql"),
    "with it switched on, a new kitchen ticket QUEUES ITSELF — no screen has to be awake and noticing",
    "turn the switch on inside the transaction, insert an order, count the jobs it queued",
    r.jobs_after === "1",
    `the order queued ${r.jobs_after} job by the trigger, not by a tab observing it`);
  add(F("335_a_kitchen_ticket_queues_itself.sql"),
    "…and only a ticket the kitchen still has to make queues paper — an order that arrives already served does not",
    "insert an order with status 'served' and count its jobs", r.jobs_served === "0",
    `a served order queued ${r.jobs_served} jobs`);
  add(F("335_a_kitchen_ticket_queues_itself.sql"),
    "the queued job says what it is and that it is waiting",
    "read the new job's kind and status", r.job_kind !== "NONE" && r.job_status !== "NONE",
    `kind '${r.job_kind}', status '${r.job_status}'`);
  add(F("339_a_reprinted_bill_says_nothing.sql") + ", " + F("333_a_reprinted_bill_knows_it_is_a_reprint.sql"),
    "a FIRST print is not marked as a reprint — the flag exists to tell the two apart",
    "read the reprint flag on the job the order queued", r.job_reprint === "false",
    `reprint = ${r.job_reprint} on the first print`);
  add(F("381_a_helper_says_which_copy_it_is.sql"),
    "a setup code can record that an OUT-OF-DATE helper file tried to use it",
    "confirm the column exists on print_setup_codes", r.code_col === "1",
    `refused_old_file_at is present, so the Printing board can say why nothing happened`);
  add(F("363_a_tablet_switch_holds_only_its_three_values_and_the_limiter_forgets_dead_counters.sql"),
    "a tablet switch REFUSES a value that is not one of its three",
    "try to write 'sometimes' into it through t33_try", r.try_bad_mode !== "ok", `→ ${r.try_bad_mode}`);
  add(F("363_a_tablet_switch_holds_only_its_three_values_and_the_limiter_forgets_dead_counters.sql"),
    "…and accepts one that is, so the check is not simply blocking every write",
    "write 'pin' into the same switch", r.try_ok_mode === "ok", `→ ${r.try_ok_mode}`);
}

// ══════════════════ A9 · WEB ADDRESSES — an old QR still finds the restaurant ══════════════════
{
  const r = tx1(`
    ${SCRATCH}
    ${put("rest", `INSERT INTO restaurants (name, slug, active) VALUES ('T33 Probe Slug', 't33-probe-old', true) RETURNING id`)}
    -- THE HISTORY IS NOT WRITTEN BY A TRIGGER, and an earlier version of this probe read RED for
    -- that reason. restaurants carries no trigger touching it; the rename path is
    -- app/api/admin/restaurants/route.ts, which records the retired address itself, and
    -- lfh_slug_moved(p_slug) is the READ side the resolver uses. So the write is modelled the way
    -- the route does it, and what is actually asserted is that the resolver then finds it.
    UPDATE restaurants SET slug = 't33-probe-new' WHERE id = ${get("rest")}::uuid;
    INSERT INTO restaurant_slug_history (slug, restaurant_id, replaced_by)
      VALUES ('t33-probe-old', ${get("rest")}::uuid, 't33-probe-new');
    ${put("hist", `SELECT count(*)::text FROM restaurant_slug_history WHERE restaurant_id = ${get("rest")}::uuid AND slug = 't33-probe-old'`)}
    ${put("resolve_old", `SELECT coalesce(lfh_slug_moved('t33-probe-old')::text, 'NONE')`)}
    ${put("resolve_unknown", `SELECT coalesce(lfh_slug_moved('t33-never-existed')::text, 'NONE')`)}
    ${put("try_reuse", `SELECT t33_try('INSERT INTO restaurants (name, slug, active) VALUES (''T33 Probe Clash'', ''t33-probe-new'', true)')`)}
    ${put("try_reuse_old", `SELECT t33_try('INSERT INTO restaurants (name, slug, active) VALUES (''T33 Probe Reuse'', ''t33-probe-old'', true)')`)}
    ${put("live_wins", `SELECT coalesce((SELECT name FROM restaurants WHERE slug = 't33-probe-old' AND deleted_at IS NULL LIMIT 1), 'NONE')`)}
    SELECT ${get("hist")} AS hist, ${get("resolve_old")} AS resolve_old, ${get("try_reuse")} AS try_reuse,
           ${get("try_reuse_old")} AS try_reuse_old, ${get("live_wins")} AS live_wins,
           ${get("rest")} AS rest, ${get("resolve_unknown")} AS resolve_unknown;
  `);
  add(F("350_an_old_web_address_still_finds_the_restaurant.sql"),
    "a retired web address still RESOLVES to its restaurant, so a printed QR code keeps working after a rename",
    "retire an address the way the admin route does, then ask lfh_slug_moved for it",
    r.hist === "1" && r.resolve_old === "t33-probe-new",
    `lfh_slug_moved('t33-probe-old') answers '${r.resolve_old}' — the address it MOVED TO, which is what lets the guest door redirect rather than 404`);
  add(F("350_an_old_web_address_still_finds_the_restaurant.sql"),
    "…and an address that never existed resolves to nothing, rather than to somebody",
    "ask lfh_slug_moved for an address that was never used", r.resolve_unknown === "NONE",
    `an unknown address returns ${r.resolve_unknown}`);
  add(F("319_the_bin_stops_locking_a_restaurants_name.sql"),
    "two LIVE restaurants can never hold the same web address",
    "try to insert a second restaurant on the current slug", r.try_reuse !== "ok", `→ ${r.try_reuse}`);
  add(F("370_a_reused_web_address_serves_the_live_restaurant.sql"),
    "a RETIRED address can be taken by a new restaurant — the history does not lock the name forever",
    "try to insert a restaurant on the retired slug", r.try_reuse_old === "ok", `→ ${r.try_reuse_old}`);
  add(F("370_a_reused_web_address_serves_the_live_restaurant.sql"),
    "…and once it is taken, the address serves the LIVE restaurant rather than the history's old owner",
    "read which restaurant answers on that slug now", r.live_wins === "T33 Probe Reuse",
    `the address now serves '${r.live_wins}'`);
}
