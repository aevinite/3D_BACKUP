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
