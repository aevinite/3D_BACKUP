# Sweep 7 · Terminal 24 — findings

**Territory:** `lib/{clash,clashCompare,paySplit,tax,taxFiling,idempotency,idempotencyRule,logTrail,userAuth,rateLimit}.ts`
· `docs/COMPLIANCE-GUARDRAILS.md` · `docs/SAAS-EFFICIENCY-PLAYBOOK.md`
**Branch:** `sweep7/t24-money-libraries` · **ids:** `P26601`–`P27100` · **port:** 4224
**Ledger:** `.claude/sweep/LEDGER/T24.md` — 1,000 rows now (500 re-run in place, 500 new).

---

## The regression

**`P11997` — the rulebook claimed a shipped feature was not built.** It was ✅ in August.
`docs/COMPLIANCE-GUARDRAILS.md` §3.0b rule 11 ("reopen the TABLE, not the bill") carried a
**⚠️ NOT BUILT YET** banner and told the reader that `lfh_void_invoice`'s closed-session refusal
"is what changes". It shipped on 2026-08-26 as
`supabase/migrations/365_reopen_puts_the_table_back_not_the_bill.sql` — a migration file. Anyone
reading the rulebook would have gone and built it a second time.

Checked against the **installed** functions rather than the migration's own prose, and that
mattered: 365 did **not** loosen `lfh_void_invoice` (still refuses on a closed session, LFH01,
deliberately) — it added a separate `lfh_reopen_table`. Fixed in item 3, and now guarded.

---

## Problems found and fixed — one commit each

| # | what was wrong | where | commit |
|---|---|---|---|
| 1 | Removing a restaurant for good left its **pending printer handshakes** behind. `verify:purge` has been RED on `main` since migration 368 merged. Same shape as migrations 346 and 354: `print_pairings` declares `ON DELETE CASCADE` on `restaurants(id)`, and migration 309 stopped deleting that row, so the cascade never fires. An allowed-but-uncollected pairing holds a one-time token that would mint a printing code for a restaurant that no longer exists, and `code` is UNIQUE, so the row also holds a pairing code for ever. | Admin console → Restaurants → Recycle bin → "Remove permanently". Nothing on screen changes. | `4534f964` — migration 369 |
| 2 | **Three comments sent a reader to the wrong migration file.** The pay-later-part migration was renumbered 352 → 364 on 2026-08-22; eleven comments across five files never followed. "mig 352" now points at a file about re-seeding and tax filing. Three of the eleven are in `lib/paySplit.ts`. | Backend only, nothing on screen. | `f0108d02` |
| 3 | The regression above. | Backend only, nothing on screen. | `e9a2f3e4` |

**The other eight stale "mig 352" pointers** sit in `app/api/editor/[...path]/route.ts` and
`app/api/tablet/[...path]/route.ts`, plus `docs/GUARD-MAP.md` and `scripts/verify-split-payment.mjs`.
Fifteen sweep-#7 branches are rewriting those two route files this week, so they are **reported, not
touched** — reaching in would hand the merge terminal a conflict on a comment. Item 8 in the report.

---

## Improvements made

| # | what | commit |
|---|---|---|
| 4 | `npm run verify:t24b` — 432 new re-runnable checks (`--ids` prints each id). Its centre is that **the money rules now face 30,000 randomly generated bills and 20,000 random filing periods** instead of worked examples. Nothing broke. | `41680a5c` |
| 5 | `npm run verify:t24b-live -- --base <url>` — 66 live checks, READ-ONLY by construction (every write it attempts is one the server refuses). It reads the owner's Tax/GST sheet off the real screen and reconciles it **both ways** — the fault that screen was built to end. | `37abb3f3` |

---

## Looked at and deliberately NOT filed

- **The MRP figure can exceed the subtotal** on an all-MRP bill of GST-inside lines, because it
  accumulates the GROSS line amount while a GST-inside line contributes only its NET. Found by the
  random bills. It is only used in arithmetic at a **zero rate**, where the two are the same number,
  and two independent locks stop the other case existing: a GST-inside MRP line needs
  `mrp_tax_treatment = 'inclusive'`, and a restaurant that is not on the composition scheme can never
  reach a zero rate (`NULLIF(tax_rate, 0)` falls back to 5%), while a composition restaurant forces
  every line to exempt. The TypeScript and the SQL agree exactly, so changing one alone would break
  parity. **Both locks are now asserted** (P26825–P26828). Ledger row **P27099**. Do not re-file.
- **A negative `tax_rate` passes straight through** `effectiveTaxRate`. The only write path already
  clamps it (`v >= 0 && v <= 1`, else null), and `lfh_effective_tax_rate` behaves identically, so
  parity holds and the value is unstorable. A CHECK constraint would close it at the database without
  touching either side — carried to the owner as a decision (item 10), not changed unilaterally.
- **`pingLatestGuestLimit` drops its restaurant filter when `rid` is null.** Already documented at
  the one caller that matters (`/api/guest/place-order` passes the RPC's own restaurant precisely for
  this). The public beacon can still omit it, but that door is capped and the alert is deduped.

---

## What this run left behind

**Nothing.** No row was written to any restaurant — every write attempted was one the server refuses
(400/409). Aangan was never read from or written to. The four screenshots were read and deleted. The
4224 dev server was stopped. One migration was applied to the **dev** database only:
`369_a_purge_clears_the_pending_printer_handshakes.sql`. AV live was never touched, not even read.
