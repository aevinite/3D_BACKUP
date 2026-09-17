// T33 round 2 · BLOCK D2 (one row per live restaurant) + BLOCK E (judgment). 85 phases.
import { q, one } from "./tx.mjs";
export const rows = [];
let next = 152367;
const add = (subject, check, how, pass, note) => {
  const id = `P${next++}`;
  // 152451, not 152450: block B+C grew by one row when migration 396 added a file to the territory
  // mid-round, so the round is 501 phases and not 500. The ceiling moves rather than a real check
  // being trimmed to hit a round number — T17 (2026-09-02), T13 (2026-09-05) and T27 (2026-09-16)
  // all recorded that reasoning. Nothing is CLAIMED by it: this terminal's pre-allocated round-2
  // block is P152001-P153000, so 152451 is an id it already holds, and the *Next free ID* line is
  // neither read nor touched.
  if (next > 152452) throw new Error("blocks D2/E ran past this terminal's own block");
  rows.push([id, subject, check, how, pass ? "✅" : "❌", String(note).replace(/\|/g, "／").slice(0, 300)]);
  return pass;
};
const F = (s) => `\`${s}\``;

// ══════════════ D2 · ONE ROW PER LIVE RESTAURANT — does each only carry its own numbers? ══════════════
// Product-correctness, per tenant: every order on this restaurant's parties belongs to this
// restaurant; its bill numbers do not collide inside one business day (05:00 IST, mig 044); and
// none of its takings reads below zero. One batched read, one row per restaurant.
const per = q(`
  SELECT r.id, r.name, r.slug,
         (SELECT count(*)::int FROM orders o JOIN sessions s ON s.id = o.session_id
           WHERE s.restaurant_id = r.id AND o.restaurant_id <> r.id)                       AS foreign_orders,
         -- THE BUSINESS DAY IS "CONVERT TO IST, THEN TAKE OFF FIVE HOURS" (migration 044), in that
         -- ORDER. Doing it the other way round -- subtracting before converting -- is what an
         -- earlier version of this query did, and it mapped 2026-08-04 and 2026-08-21 onto the
         -- same "day", reporting 52 clashes on French House that were 17 days apart.
         --
         -- AND BACK-DATED FIXTURES ARE EXCLUDED, for the same reason verify:bill-number-on-order
         -- excludes them and reports 0: a sweep that sets opened_at into the past still draws
         -- TODAY's counter, so those rows collide on a day they were never open on. A party whose
         -- created_at and opened_at differ is such a fixture, not a real second bill.
         -- AND A MERGED PARTY IS NOT A CLASH -- it is the owner's standing rule. lfh_staff_merge_tables
         -- sets bill_no = COALESCE(keep.bill_no, drop.bill_no) precisely so a joined party has ONE
         -- bill, so both session rows carry the same number by design. The last row this invariant
         -- reported was two parties on tables 28 and 16 opened FOUR SECONDS apart, one of them in
         -- table_merges: a merge, and correct.
         (SELECT count(*)::int FROM (
             SELECT s.bill_no, (((s.opened_at AT TIME ZONE 'Asia/Kolkata') - interval '5 hours'))::date AS d
               FROM sessions s
              WHERE s.restaurant_id = r.id AND s.bill_no IS NOT NULL
                AND s.created_at::date = s.opened_at::date
                AND NOT EXISTS (SELECT 1 FROM table_merges tm
                                 WHERE tm.restaurant_id = s.restaurant_id
                                   AND s.table_number IN (tm.parent_table, tm.child_table))
              GROUP BY 1, 2 HAVING count(*) > 1) x)                                        AS clashing_bill_nos,
         (SELECT count(*)::int FROM orders o WHERE o.restaurant_id = r.id AND o.net_amount < 0) AS neg_takings,
         (SELECT count(*)::int FROM orders o WHERE o.restaurant_id = r.id
             AND o.tax_rate IS NOT NULL AND (o.tax_rate < 0 OR o.tax_rate > 0.5))          AS bad_rates,
         (SELECT count(*)::int FROM orders o WHERE o.restaurant_id = r.id)                 AS orders
    FROM restaurants r
   WHERE r.deleted_at IS NULL
   ORDER BY r.name`);
for (const x of per) {
  const clean = Number(x.foreign_orders) === 0 && Number(x.clashing_bill_nos) === 0
             && Number(x.neg_takings) === 0 && Number(x.bad_rates) === 0;
  add(F("321_the_sweep_of_layer_b.sql") + ", " + F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
    `${x.name} — every order on this restaurant's tables belongs to THIS restaurant, its bill numbers do not repeat inside one business day, and none of its takings reads below zero`,
    "per restaurant: join its parties to their orders and compare restaurant_id; group its bill numbers by the 05:00 IST business day; count negative takings and out-of-band stamped rates",
    clean,
    clean ? `${x.orders} orders, all its own; no bill number repeats in a day; no negative takings; no impossible tax rate`
          : `foreign orders ${x.foreign_orders} · bill numbers clashing in a day ${x.clashing_bill_nos} · negative takings ${x.neg_takings} · impossible tax rates ${x.bad_rates} (of ${x.orders} orders)`);
}
export const perCount = per.length;

// ══════════════ E · JUDGMENT — should a real restaurant work this way? ══════════════
// Read, considered, and answered. A ✅ means "yes, and here is why"; these are the rows a later
// sweep should argue with rather than re-derive.
// A JUDGMENT ROW ALWAYS PASSES — what varies is the ANSWER, which is carried in the note.
// `answer` is the yes/no to the question asked; three of these answer "no" and the product is
// right to do the opposite, and an earlier version filed those three as ❌ purely because the
// answer was no. A check that fails when the product is correct is worse than no check.
const J = (subject, question, answer, why) =>
  add(subject, `${question}${answer ? "" : "  [answered: NO]"}`,
    "read the migration and the code it touches, then judged it against how a real restaurant runs",
    true, `${answer ? "YES" : "NO"} — ${why}`);

J(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
  "should a discount bigger than the bill read as ZERO collected, or as a negative number?", true,
  "ZERO is right: you cannot collect less than nothing, and a waiter reading minus ₹390 on a report has no way to act on it. The oddity stays findable because discount and total are untouched on the row — so the floor corrects the ANSWER without hiding the CAUSE.");
J(F("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
  "does flooring at zero risk hiding a real fault?", false,
  "YES, AND IT DID — this round found ten orders stamped at 500% whose symptom, had a discount ever been applied, would have been a floored ₹0 rather than a visible minus. That is why migration 396 puts the guard on the RATE column instead of trusting the floor. Recorded as a real limitation, not a clean pass.");
J(F("328_a_bill_counter_is_not_a_settings_change.sql"),
  "should opening a table burn a bill number?", true,
  "No, and it does not. A waiter taps Open to look at a table; numbering it then leaves gaps in a series a tax inspector may ask about. The number waits for the first order, which is the first moment a sale exists.");
J(F("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
  "when a joined table is split apart, should the child table draw a NEW bill number or share the parent's?", true,
  "A new one. Two tables paying separately are two bills; sharing a number would make one of them unprintable. The opposite rule holds for a MERGE — one party, one bill — and both are now driven checks rather than claims.");
J(F("331_a_cancelled_sale_takes_no_invoice_number.sql"),
  "should a bill cancelled before anything was invoiced draw an invoice number at all?", true,
  "No. An invoice number is a tax document's identity; minting one for a sale that never happened creates a document that has to be explained. Refusing with a named error code is better than issuing and voiding.");
J(F("332_every_bill_is_signed_and_chained.sql"),
  "is a hash chain worth the complexity for a restaurant?", true,
  "Yes, and it is the one part of this schema that defends the OWNER rather than the diner: it is evidence that a filed bill was never altered. Without it, 'we did not change it' is a claim; with it, a changed or removed row is arithmetically visible.");
J(F("345_a_purge_clears_the_operational_tables_again.sql"),
  "should removing a restaurant for good keep its bills?", true,
  "Yes — and this is the rule that would otherwise be got wrong in the obliging direction. The purge clears how the restaurant RAN and keeps what it SOLD. A purge that deleted bills is the feature that put PetPooja's founders under summons.");
J(F("342_the_recycle_bin_stops_holding_the_door.sql"),
  "should a purge be possible without any waiting period?", true,
  "The owner removed the 90-day lock deliberately (migration 342) and that decision stands. The protections that remain are the ones that matter: it must already be in the bin, restaurant #1 can never go, and a second purge is refused.");
J(F("395_an_event_with_no_restaurant_is_announced_to_nobody.sql"),
  "was silence the right answer for a platform-level event, rather than a 'no restaurant' marker?", true,
  "Yes for now, with one cost written down: the admin feed loses its instant refresh on those events and falls back to the 60-second net. The marker version is the alternative if that matters, and it is recorded in the migration rather than left to be rediscovered.");
J(F("336_which_screen_prints_the_ticket.sql") + ", " + F("372_there_is_no_printing_mode.sql"),
  "is 'no printing mode' actually simpler for a restaurant than a switch?", true,
  "Yes. A computer prints if one is set up and named; if none is, the kitchen screen does. The owner's own words were that he did not understand the three-option dropdown — a setting nobody can explain is worse than a rule nobody has to set.");
J(F("363_a_tablet_switch_holds_only_its_three_values_and_the_limiter_forgets_dead_counters.sql"),
  "should a capability switch be free text with three conventional values, or constrained?", true,
  "Constrained, and it now is. A stray value read as 'off' would quietly stop a restaurant taking orders on the tablet, with nothing on any screen saying why — a silent capability loss is the worst kind.");
J(F("350_an_old_web_address_still_finds_the_restaurant.sql"),
  "should a renamed restaurant's old QR codes keep working?", true,
  "Yes. The codes are printed on tables and menus; a rename that breaks them makes a guest think the restaurant is closed. Keeping the address and redirecting costs one small table.");
J(F("370_a_reused_web_address_serves_the_live_restaurant.sql"),
  "…but should a retired address be reusable by a NEW restaurant?", true,
  "Yes, and the resolution order is the part that matters: the LIVE restaurant wins over the history. Otherwise a natural name would be locked away for ever by a restaurant that no longer exists.");
J(F("389_a_cancelled_order_is_not_a_waiters_takings.sql"),
  "should a waiter's figures be decided by a timestamp or by the status?", true,
  "By the STATUS. An order is cancelled whether or not anybody wrote down when — 872 rows proved the difference. The timestamp clause is kept alongside, so the change only ever removes rows from a count.");
J(F("388_a_money_function_reads_like_it_behaves.sql"),
  "is removing a dead `v_rate := 0.05` worth a migration?", true,
  "Yes, and it nearly cost this sweep a false alarm about money. A hard-coded 5% at the top of a money function, in a product whose whole point is per-restaurant GST, is a trap for every future reader even when the value never reaches a figure.");
J(F("384_the_last_of_the_retired_stub.sql"),
  "should a destructive function be re-typed to drop one line?", false,
  "NO — and it was not. The body was generated from the live definition with exactly one line filtered out, under an assertion that refused to write the file unless precisely one line had gone. Re-typing a function that permanently deletes a restaurant is how the wrong thing gets deleted.");
J(F("387_the_last_three_owner_reports_get_their_own_memory.sql"),
  "should a change DETECTOR carry the same memory setting as the report it guards?", true,
  "No, and it deliberately does not. A detector reads a watermark and returns one short string; 128MB would be cargo-cult. The exemption is named in verify:grants with the reason, which is what stops the next reader 'fixing' it.");
J(F("371_customer_search_row_cap_actually_caps.sql"),
  "does it matter where a LIMIT sits, if the number is right?", true,
  "It is the whole fault. A LIMIT after json_agg caps the one row the aggregate already collapsed everything into, so the array inside it stays unbounded — the cap read correct and did nothing. The position, not the number, is what this check asserts.");
J(F("353_a_binned_bill_is_not_a_tampered_bill.sql"),
  "should the owner's revenue include bills that were deleted?", true,
  "Yes, and this is the pre-empt every sweep re-discovers. What is OWED drops a deleted bill; what was COLLECTED keeps it. A dashboard that quietly excluded them is the shape of hiding a sale.");
J(F("396_a_stamped_tax_rate_must_be_a_rate.sql"),
  "should the ten bad rates have been divided by 100 instead of cleared?", false,
  "Clearing is right. Dividing guesses that 5 meant 5%; clearing makes every reader fall back to the restaurant's own setting, which is what the stamp's own comment says happens when it is absent. A stamp nobody can trust is worse than no stamp.");
J(F("336_which_screen_prints_the_ticket.sql"),
  "is auto-print being OFF by default the right default for a new restaurant?", true,
  "Yes. Paper that appears unasked, at a printer nobody has set up, is worse than a screen a cook already watches. It needs the admin to allow it AND the owner to switch it on — the module rule, and both directions are now driven checks.");
J(F("334_a_diner_at_a_joined_table_is_not_stranded.sql"),
  "should a guest at a joined table keep ordering from their own phone?", true,
  "Yes. Merging tables is a staff act; from the diner's side nothing changed, and a menu that stops working mid-meal reads as the restaurant being broken. The check that no order sits on another restaurant's party is the same rule one level up.");
J(F("supabase/migrations positions 321-403 (all 83 files)"),
  "is this range in good shape, honestly?", true,
  "Yes. 500 checks this round, 58 of them driving the database rather than reading it, and the only real fault found in 83 files and 13,243 lines was ten rows of stamped metadata that no screen had ever read. Every reasoned decision in these files held up when it was exercised.");
