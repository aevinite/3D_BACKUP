// T33 round 2 · BLOCK D — invariants over the REAL data, not a fixture. 60 phases.
// Read-only throughout. Scoped, column-listed, no full-table analytics.
import { q, one } from "./tx.mjs";
import { nextId } from "./ids.mjs";

export const rows = [];
export const add = (subject, check, how, pass, note) => {
  const id = nextId();
  rows.push([id, subject, check, how, pass ? "✅" : "❌", String(note).replace(/\|/g, "／").slice(0, 300)]);
  return pass;
};
const F = (s) => `\`${s}\``;
const n = (v) => Number(v);

// ── one batched read of the whole invariant set ────────────────────────────────────────────────
const d = one(`
SELECT
  (SELECT count(*)::int FROM orders WHERE net_amount < 0)                                          AS neg_takings,
  (SELECT count(*)::int FROM orders WHERE scale(net_amount) > 2)                                   AS fat_takings,
  (SELECT count(*)::int FROM orders WHERE scale(disc_gross) > 2)                                   AS exact_disc,
  (SELECT count(*)::int FROM orders WHERE restaurant_id IS NULL)                                   AS orders_no_rid,
  (SELECT count(*)::int FROM order_items WHERE restaurant_id IS NULL)                              AS items_no_rid,
  (SELECT count(*)::int FROM sessions WHERE restaurant_id IS NULL)                                 AS sessions_no_rid,
  (SELECT count(*)::int FROM orders o LEFT JOIN sessions s ON s.id = o.session_id
     WHERE o.session_id IS NOT NULL AND s.id IS NULL)                                              AS orphan_orders,
  (SELECT count(*)::int FROM order_items i LEFT JOIN orders o ON o.id = i.order_id
     WHERE o.id IS NULL)                                                                           AS orphan_items,
  (SELECT count(*)::int FROM orders o JOIN sessions s ON s.id = o.session_id
     WHERE o.restaurant_id <> s.restaurant_id)                                                     AS mixed_party,
  (SELECT count(*)::int FROM sessions s LEFT JOIN restaurants r ON r.id = s.restaurant_id
     WHERE r.id IS NULL)                                                                           AS sessions_no_home,
  -- AN INVOICE ALREADY ISSUED KEEPS ITS NUMBER when the sale is later cancelled — CLAUDE.md, in
  -- those words: "an invoice already issued keeps its number, retired and marked cancelled, and is
  -- corrected by a credit note, never an edit". So the invariant is NOT "no invoice on a cancelled
  -- bill" (the first version of this row asserted that and reported 18 correct rows as a fault). It
  -- is that such a bill was invoiced BEFORE the cancellation, i.e. nothing minted a number for an
  -- already-dead sale, which is what migration 331 actually forbids.
  (SELECT count(*)::int FROM sessions s
     WHERE s.invoice_no IS NOT NULL AND s.deleted_at IS NULL
       AND s.invoice_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id
                         AND o.deleted_at IS NULL AND o.status <> 'cancelled')
       -- ONLY WHERE THE DATA CAN ANSWER. cancelled_at arrived in migration 388 and 389 recorded
       -- that 1,424 historical cancellations carry no time at all, deliberately: "now() would be a
       -- lie about when a sale was cancelled … a missing timestamp is better left missing and read
       -- correctly than invented". So a bill whose cancellation was never timed cannot say whether
       -- it preceded the invoice, and counting it as a fault (the first version of this row did,
       -- reporting 17) blames the product for a gap 389 chose on purpose.
       -- MINTED FOR AN ALREADY-DEAD SALE means: at the moment the invoice was drawn, every order on
       -- the bill had ALREADY been cancelled. So every order must carry a cancellation time at or
       -- before invoice_at. (An earlier version asserted the negation of this and counted the
       -- CORRECT rows — invoiced first, cancelled after — as faults.)
       AND EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id AND o.cancelled_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id
                         AND (o.cancelled_at IS NULL OR o.cancelled_at > s.invoice_at)))           AS invoice_minted_for_dead_sale,
  (SELECT count(*)::int FROM sessions s
     WHERE s.invoice_no IS NOT NULL AND s.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id
                         AND o.deleted_at IS NULL AND o.status <> 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id AND o.cancelled_at IS NOT NULL)) AS untimed_cancellations,
  (SELECT count(*)::int FROM sessions s
     WHERE s.invoice_no IS NOT NULL AND s.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id
                         AND o.deleted_at IS NULL AND o.status <> 'cancelled'))                    AS invoiced_then_cancelled,
  (SELECT count(*)::int FROM sessions s
     WHERE s.invoice_no IS NOT NULL AND s.deleted_at IS NULL AND NOT s.invoice_voided AND s.void_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id
                         AND o.deleted_at IS NULL AND o.status <> 'cancelled')
       AND NOT EXISTS (SELECT 1 FROM credit_notes c WHERE c.session_id = s.id))                    AS cancelled_unmarked_uncredited,
  (SELECT count(*)::int FROM sessions s
     WHERE s.status = 'open' AND s.bill_no IS NULL
       AND EXISTS (SELECT 1 FROM orders o WHERE o.session_id = s.id
                     AND o.deleted_at IS NULL AND o.status <> 'cancelled'))                        AS live_order_no_bill,
  (SELECT count(*)::int FROM (
      SELECT restaurant_id, invoice_no FROM sessions
       WHERE invoice_no IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x)                          AS dup_invoice,
  (SELECT count(*)::int FROM (
      SELECT restaurant_id, seq FROM bill_chain GROUP BY 1, 2 HAVING count(*) > 1) x)              AS dup_chain_seq,
  (SELECT count(*)::int FROM bill_chain WHERE chain_hash IS NULL OR prev_hash IS NULL)             AS unhashed_chain,
  (SELECT count(*)::int FROM realtime_events
     WHERE topic_rid IS DISTINCT FROM topic || ':' || restaurant_id::text)                         AS miskeyed_breadcrumbs,
  -- MIGRATION 397 changed what the right answer is: a platform event IS announced again (so the
  -- admin console refreshes instantly) but must be keyed to NOBODY. The question is therefore not
  -- "is it announced" any more -- it is "is it announced AS SOMEBODY'S".
  (SELECT count(*)::int FROM realtime_events e JOIN staff_actions a ON a.id::text = e.entity_id
     WHERE e.topic = 'audit' AND a.restaurant_id IS NULL
       AND (e.restaurant_id IS NOT NULL OR e.topic_rid <> e.topic || ':platform'))                 AS platform_event_misattributed,
  (SELECT count(*)::int FROM information_schema.tables
     WHERE table_schema='public' AND table_name IN ('verification_codes','print_pairings'))        AS retired_tables_back,
  (SELECT count(*)::int FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema='public' AND t.table_type='BASE TABLE'
    WHERE c.table_schema='public' AND c.column_name='restaurant_id'
      AND c.column_default LIKE '%00000000-0000-0000-0000-000000000001%')                          AS columns_defaulting_r1,
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.prokind='f'
      -- …0001 EXACTLY, not any zero-ish uuid: lfh_remember_error_signature coalesces to the ZERO
      -- uuid, which is this schema's "no restaurant" SENTINEL and not a guess at French House.
      -- The first version of this invariant matched '00000000' and reported it as a fault.
      AND pg_get_functiondef(p.oid) ~ 'coalesce\\(\\s*p_restaurant_id\\s*,\\s*''00000000-0000-0000-0000-000000000001') AS bodies_guessing_r1,
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND pg_get_function_arguments(p.oid) ~* 'p_restaurant_id[^,)]*DEFAULT') AS sigs_defaulting,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity)                          AS tables_without_rls,
  (SELECT count(*)::int FROM cron.job WHERE jobname IN
     ('lfh-prune-logs','lfh-rt-prune','refresh-owner-daily-agg','refresh-owner-report-monthly-agg',
      'lfh-reindex-breadcrumbs','lfh-prune-audit'))                                                AS crons,
  (SELECT count(*)::int FROM cron.job WHERE command ILIKE '%close%session%' OR command ILIKE '%end%table%')  AS crons_ending_tables,
  (SELECT count(*)::int FROM restaurants WHERE purged_at IS NOT NULL)                              AS purged_restaurants,
  (SELECT count(*)::int FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
     WHERE r.purged_at IS NOT NULL)                                                                AS orders_kept_after_purge,
  (SELECT count(*)::int FROM feedback f JOIN restaurants r ON r.id = f.restaurant_id
     WHERE r.purged_at IS NOT NULL)                                                                AS operational_left_after_purge,
  -- NOT through lfh_plausible_tax_rate: the read-only role the management API uses has no EXECUTE
  -- on it (correctly — it is staff-only), so calling it turns a data invariant into a permission
  -- error. The band is asserted directly instead: India's GST slabs top out at 28%.
  (SELECT count(*)::int FROM orders WHERE tax_rate IS NOT NULL
     AND (tax_rate < 0 OR tax_rate > 0.28))                                                        AS implausible_rates,
  (SELECT count(*)::int FROM orders WHERE total < 0 OR subtotal < 0 OR tax < 0)                    AS negative_money,
  (SELECT count(*)::int FROM orders WHERE status = 'cancelled' AND deleted_at IS NULL)             AS cancelled_still_present,
  (SELECT count(*)::int FROM restaurant_slug_history h JOIN restaurants r ON r.id = h.restaurant_id
     WHERE r.slug = h.slug)                                                                        AS history_shadows_live,
  (SELECT count(*)::int FROM restaurants WHERE deleted_at IS NULL GROUP BY slug HAVING count(*) > 1 LIMIT 1) AS dup_live_slug
`);

// ── the rows ──────────────────────────────────────────────────────────────────────────────────
const M = (f) => F(f);
add(M("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
  "across every order in the database, none reads a takings figure below zero", "count orders WHERE net_amount < 0",
  n(d.neg_takings) === 0, `${d.neg_takings} of the whole table (31 before migration 390)`);
add(M("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
  "…and none carries more than two decimals", "count orders WHERE scale(net_amount) > 2",
  n(d.fat_takings) === 0, `${d.fat_takings} rows`);
add(M("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
  "the exact source column is STILL exact — rounding it was considered and rejected, with measurements",
  "count orders WHERE scale(disc_gross) > 2; it must be non-zero", n(d.exact_disc) > 0,
  `${d.exact_disc} rows hold more than two decimals, so migration 301's decision stands`);
add(M("358") + " via " + M("386_a_null_restaurant_is_refused_not_guessed.sql"),
  "not one order, order line or party in the database is missing its restaurant",
  "count nulls on restaurant_id across the three busiest tenant tables",
  n(d.orders_no_rid) === 0 && n(d.items_no_rid) === 0 && n(d.sessions_no_rid) === 0,
  `orders ${d.orders_no_rid}, order lines ${d.items_no_rid}, parties ${d.sessions_no_rid}`);
add(M("374_a_mark_must_not_outlive_its_party_on_the_delete_path.sql"),
  "no order points at a party that no longer exists",
  "left-join orders to sessions on session_id", n(d.orphan_orders) === 0, `${d.orphan_orders} orphans`);
add(M("323_one_definition_of_what_dishes_are_on_an_order.sql"),
  "no order line points at an order that no longer exists",
  "left-join order_items to orders", n(d.orphan_items) === 0, `${d.orphan_items} orphans`);
add(M("334_a_diner_at_a_joined_table_is_not_stranded.sql"),
  "no order sits on a party belonging to a DIFFERENT restaurant — one party is one restaurant's",
  "join orders to sessions and compare restaurant_id", n(d.mixed_party) === 0, `${d.mixed_party} mixed rows`);
add(M("358_a_forgotten_restaurant_fails_loudly.sql"),
  "no party belongs to a restaurant that is not in the restaurants table",
  "left-join sessions to restaurants", n(d.sessions_no_home) === 0, `${d.sessions_no_home} homeless parties`);
add(M("331_a_cancelled_sale_takes_no_invoice_number.sql"),
  "no invoice number in the database was MINTED for a sale that was already cancelled — which is the thing migration 331 forbids",
  "count invoiced bills with no surviving live order AND no cancellation that predates the invoice",
  n(d.invoice_minted_for_dead_sale) === 0,
  `${d.invoice_minted_for_dead_sale} such bills, of the ${d.invoiced_then_cancelled} that were invoiced and then had every order cancelled — those correctly KEEP their number (CLAUDE.md: retired and marked cancelled, corrected by a credit note, never an edit). ${d.untimed_cancellations} of them cannot be judged either way, because migration 389 deliberately left an untimed cancellation untimed rather than invent a date`);
add(M("331_a_cancelled_sale_takes_no_invoice_number.sql") + ", " + M("353_a_binned_bill_is_not_a_tampered_bill.sql"),
  "…and an invoice whose sale was cancelled afterwards is either marked void or carries a credit note, so the correction is on the record",
  "count invoiced-then-cancelled bills that are neither voided nor credited",
  n(d.cancelled_unmarked_uncredited) === 0,
  `${d.cancelled_unmarked_uncredited} invoiced bills have had every order cancelled and carry NO void mark and NO credit note — RECORDED for the owner's decision, not fixed here: who issues the credit note and when is a billing rule, not a bug`);
add(M("391_a_table_that_receives_an_order_gets_its_bill_number.sql"),
  "no OPEN table is holding a live order without a bill number",
  "count open sessions with a live order and no bill_no", n(d.live_order_no_bill) === 0,
  `${d.live_order_no_bill} tables`);
add(M("331_a_cancelled_sale_takes_no_invoice_number.sql"),
  "no restaurant has issued the same invoice number twice",
  "group sessions by restaurant and invoice_no and look for a count above one",
  n(d.dup_invoice) === 0, `${d.dup_invoice} duplicated invoice numbers`);
add(M("332_every_bill_is_signed_and_chained.sql"),
  "the signed chain has no duplicated position — one seq per restaurant, once",
  "group bill_chain by restaurant and seq", n(d.dup_chain_seq) === 0, `${d.dup_chain_seq} duplicates`);
add(M("332_every_bill_is_signed_and_chained.sql"),
  "every row in the signed chain carries both of its hashes, so the chain can actually be verified",
  "count bill_chain rows with a null hash", n(d.unhashed_chain) === 0, `${d.unhashed_chain} unhashed rows`);
add(M("321_the_sweep_of_layer_b.sql"),
  "every breadcrumb in the database is keyed to its topic AND its restaurant — realtime is per-restaurant, as the SaaS rule requires",
  "compare topic_rid against topic || ':' || restaurant_id on every row",
  n(d.miskeyed_breadcrumbs) === 0, `${d.miskeyed_breadcrumbs} miskeyed rows`);
add(M("397_a_platform_event_is_announced_to_nobodys_restaurant.sql"),
  "no platform-level activity event in the table is announced as a RESTAURANT'S — it is announced to the unscoped admin console and keyed to nobody",
  "join audit breadcrumbs to their staff_actions row, and for those whose action has no restaurant, check the breadcrumb carries no restaurant and is keyed '<topic>:platform'",
  n(d.platform_event_misattributed) === 0,
  `${d.platform_event_misattributed} misattributed breadcrumbs (migration 395 stopped the mislabel, 397 gave the instant refresh back without it)`);
add(M("384_the_last_of_the_retired_stub.sql") + ", " + M("380_a_setup_code_replaces_the_allow_page.sql"),
  "the two retired tables have not come back",
  "look for verification_codes and print_pairings in the catalogue", n(d.retired_tables_back) === 0,
  `${d.retired_tables_back} of the two are present`);
add(M("358") + " via " + M("385_no_function_guesses_the_restaurant.sql"),
  "no column, no function signature and no function body still guesses restaurant #1",
  "count defaulting columns, defaulting signatures and coalescing bodies",
  n(d.columns_defaulting_r1) === 0 && n(d.sigs_defaulting) === 0 && n(d.bodies_guessing_r1) === 0,
  `columns ${d.columns_defaulting_r1}, signatures ${d.sigs_defaulting}, bodies ${d.bodies_guessing_r1}`);
add(M("362_the_server_only_tables_lose_their_leftover_public_grant.sql"),
  "row-level security is on for every table in the schema",
  "count tables with relrowsecurity false", n(d.tables_without_rls) === 0, `${d.tables_without_rls} without RLS`);
add(M("363_a_tablet_switch_holds_only_its_three_values_and_the_limiter_forgets_dead_counters.sql"),
  "the six scheduled jobs these migrations rely on are all still scheduled",
  "count them in cron.job by name", n(d.crons) === 6, `${d.crons} of 6 scheduled`);
add(M("254") + " via " + M("345_a_purge_clears_the_operational_tables_again.sql"),
  "NOTHING is scheduled to end a table on its own — the owner's rule, and no cron may quietly break it",
  "search cron.job commands for a session close or table end", n(d.crons_ending_tables) === 0,
  `${d.crons_ending_tables} such jobs`);
add(M("345_a_purge_clears_the_operational_tables_again.sql"),
  "for every restaurant that has been purged, its MONEY is still there",
  "count orders belonging to purged restaurants", n(d.purged_restaurants) === 0 || n(d.orders_kept_after_purge) > 0,
  `${d.purged_restaurants} purged restaurants hold ${d.orders_kept_after_purge} orders between them`);
add(M("345_a_purge_clears_the_operational_tables_again.sql"),
  "…and its OPERATIONAL rows are gone",
  "count feedback belonging to purged restaurants", n(d.operational_left_after_purge) === 0,
  `${d.operational_left_after_purge} feedback rows left behind`);
add(M("337_a_report_reads_the_takings_not_the_discount.sql"),
  "every stamped tax rate in the database is inside the band a GST rate can be — none is negative or above 28%",
  "read tax_rate off every order carrying one and check the band directly (the staff-only plausibility function is not callable by a read-only role, correctly)",
  n(d.implausible_rates) === 0, `${d.implausible_rates} implausible rates`);
add(M("390_the_takings_column_rounds_to_paise_and_never_goes_negative.sql"),
  "no bill in the database carries a negative total, subtotal or tax",
  "count orders with any negative money column", n(d.negative_money) === 0, `${d.negative_money} rows`);
add(M("353_a_binned_bill_is_not_a_tampered_bill.sql"),
  "cancelled sales are still PRESENT as rows — a sale can be cancelled, never made to disappear",
  "count cancelled orders that are not soft-deleted", n(d.cancelled_still_present) > 0,
  `${d.cancelled_still_present} cancelled orders are on record, exactly as the compliance rule requires`);
add(M("370_a_reused_web_address_serves_the_live_restaurant.sql"),
  "no retired web address shadows the address a live restaurant is using right now",
  "join the history to restaurants on slug", n(d.history_shadows_live) === 0,
  `${d.history_shadows_live} shadowing rows`);
add(M("319_the_bin_stops_locking_a_restaurants_name.sql"),
  "no two live restaurants share a web address",
  "group live restaurants by slug", d.dup_live_slug == null || n(d.dup_live_slug) === 0,
  `${d.dup_live_slug == null ? "none" : d.dup_live_slug} duplicated live slugs`);
