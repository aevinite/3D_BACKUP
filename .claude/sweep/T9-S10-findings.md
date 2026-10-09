# Sweep #10 · T9 — problems found and fixed (the manager panel's server route, part 1 of 2)

Ledger: `.claude/sweep/LEDGER/T9-S10.md` (562 new rows) · re-run: 868 rows of T24-S8 + 87 rows in
16 other ledgers, 0 regressions. Guard for all three: `npm run verify:manager-gates` (37 checks).

1. **The Sections settings switch was only a hidden card.** Access → Manager settings → "Sections —
   who serves which table" promises its endpoints refuse when it is off. GET and POST
   `/table-sections` checked only the table_assign power. Now `managerSectionOff()` refuses a real
   manager (owner and admin console unaffected, like the Tables switch). Sabotage: 3 red.
2. **The On-the-house card reached 30 days for a today-only manager.** `/onhouse` sits behind
   view_dashboard but was missed when /stats, /staff-risk and /gst-report were clamped to the
   dashboard reach on 2026-09-23. Clamped server-side for everyone, in whole business days; the card
   prints the server's `windowLabel` instead of a hard-coded "Last 30 days" (two strings in
   public/panels/editor/app.js, part of the fix; panel ?v= hash refreshed). Sabotage: 3 red.
3. **The dish-photo upload ignored the Edit menu switch.** It was the one menu-editor door missing
   from tabGate's list, so with Edit menu off (read-only for everyone below the admin) a photo was
   still accepted and stored in the restaurant's public folder. Now on the list. Sabotage: 2 red.

Tooling fixed on the way (no product change): the T24 runner's POST slice (empty since 2026-09-17),
its net_amount check, its statement-count lock (re-locked with every move explained), its
signed-out rows (now driven in memory), and an opt-in `.range()` for the panel stub.

## Round 2 (owner, 2026-10-09: "do all … make sure there shouldn't be any error left within the boundaries")

4. **Lint cap (fixed on main, PR #1459)** — T9's merged files + T39's new cap took main's lint red; T9's warnings removed.
5. **Repeat-customer chip ignored the Customer directory switch** — GET customer-recognize now answers "not known" when it is off.
6. **Banquet bills reached any date** — the list, one bill and the banquet print door now follow the Bills reach (owner "do all").
7. **Five reads took every column** — calls, complaints, customer log, activity log, one banquet bill now name their columns.
8. **A Platform-board refusal that could never fire** — removed, with an obituary.
9. **A comment above the wrong code** — the customer-capture explanation moved back above customer-capture.
10. **A refused waiter id answered 500** (the offline queue would retry it forever) — now 404 in plain words.
11. **Restaurant #1's name on other restaurants' tax documents** — the Z-report and the GST report fell back to "Little
    French House" for any restaurant with no Billing name (six live dev restaurants). Now billdoc's billIdentity(),
    the printed bill's own rule. Found by the branch-coverage pass.
12. **Two Bills-record reads keyed on session ids alone** — now name the restaurant and a bound. Found by the
    whole-suite query audit (2,599 statements, 3 unscoped shapes: these two, and `select menu_items [eq:id]` from
    POST items in the OTHER half — left for its owner).

Guard for all of 5–12: `npm run verify:manager-gates` (58 checks), each sabotage-tested.

How "no error left" was measured, not claimed: 100% of the half's 1,342 code lines executed (V8 coverage on the real
file), every reachable branch arm taken, 438 of 456 mutants caught with a CONTROL run first (the 18 survivors read by
hand and equivalent — listed in LEDGER/T9-S10.md), and one query audit over the whole suite.
Tools: `scripts/sweep/t9s10/{coverage,mutate,hooks}.mjs`. Trap recorded: Node will not strip TypeScript types under
node_modules — the first mutation run "killed" 454/454 because every copy failed to load.
