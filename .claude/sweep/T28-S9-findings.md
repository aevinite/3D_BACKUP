# SWEEP #9 · TERMINAL 28 — the owner server routes, and every remaining route

**Territory** (re-derived, not inherited): all 13 `app/api/owner/**/route.ts` · `app/api/log/client-error`
· `app/api/health` · `app/api/maintenance` · `app/api/blocked` ·
`app/api/aggregators/webhook/[source]` · `lib/aggregators.ts` · `lib/ownerScope.ts`.
Twenty files, **6,685 lines**. `app/api/print-agent` is S9-T11's, so it is excluded.

**Branch** `sweep9/t28-owner-api-and-the-rest` · **port** 4428 · **ids** P104301–P104350 (of
P104301–P104400; fifty left free).

| | |
|---|---|
| Ledger rows re-run | **503 of 503** (217 of them DRIVEN, the rest by reading all 6,685 lines + 26 repo guards) |
| REGRESSIONS | **1** — P21225, ✅ when filed, ❌ on clean `main` since 2026-09-14 |
| New checks | **50**, all green, aimed by measurement at the files carrying 0–5 rows |
| Problems found | **6** · fixed **6** |
| Improvements built | **0**, by the owner's instruction for this run |

## Problems found and fixed — one commit each

1. **`verify:owner-s7` has been red on `main` since the printing rework landed** (REGRESSION).
   14 of its 300 assertions failed on a clean checkout, so this folder's PostToolUse hook was red
   for every session. The 2026-09-14 printing rework deliberately retired `KIND_WORDS`, the
   `printing.routes` list and the "no buttons" rule (the owner asked for the Test buttons), and the
   guard — last touched 2026-09-01 — was not moved with it. One of the fourteen, P21225, is about
   this territory's own file. One assertion (P21199) was GREEN and should not have been: it claimed
   "the card writes nothing" while `sendSample()` POSTs, and passed only because that function sits
   above the slice the guard cuts. Now 300/300, and judged by breaking it.
2. **The Activity log named a person by their database id.** `module_toggle` recorded
   `actor: "c0af7b5b-c0d8-40f6-b831-f475e48bab53"` — the sixth call site of the five
   `ownerActorName()` fixed on 2026-08-27, missed then, measured still wrong on French House today.
   `actor_id` now rides along too, so the person's own Activity tab can find the row.
3. **The owner's Activity log told him "admin put the guest menu back online".** `/api/maintenance`
   recorded an admin flip as `panel: "manager"`, and `/api/owner/oplog` excludes only
   `panel in (admin,db)`, so it reached his feed. Measured. `ownerLogPanel()` closed this on
   2026-08-12 for `/api/owner/*` only, and this switch is reached from the manager panel.
4. **The test-print record named nobody.** `print_test` (new on 2026-09-14) passed no `actor` at
   all, so the Who column rendered "—", and hard-coded `panel: "owner"`, so an admin's sample print
   would land in the owner's feed. Read, not driven — see the commit for the honest reason.
5. **A blip could show the admin ONE restaurant's team for an owner who has five.** The Team page's
   own `scope()` dropped `.error` on the two reads that resolve who owns the entered restaurant —
   the identical pair `lib/ownerScope.ts` was corrected for by T25 on 2026-08-28. Half the finding
   is the GUARD: `verify:owner-scope` exempted this route on the written grounds that it "answers
   transient() 503 on every failed read", and checked that by proving the helper EXISTS. It did. It
   just was not reached.
6. **A database hiccup would tell Zomato an outlet does not exist, and lose the order.**
   `resolveWebhookRestaurant` answered one `null` for "no such outlet" and for "the read failed",
   and the route turned both into a 404 — final to every platform. Dormant today; fixed while
   dormant for the reason finding F11 was.

## Guards left behind

| guard | what it now watches |
|---|---|
| `verify:owner-s7` | 14 expectations moved to the shipped code; 300/300 |
| `verify:plain-logs` | a sixth section: every owner-reachable log write names a PERSON (never a uuid, never nobody) and takes its panel from `ownerLogPanel()`; 16 call sites |
| `verify:owner-scope` | the twin resolver in `owner/staff` held to the same property as `ownerScope()`, plus both join-table ceilings |
| `verify:outbound` | the mirror of its own section 1 — a refusal that means STOP is only sent when we actually know |
| `verify:t28-new50` (new) | the fifty, re-runnable: `npm run verify:t28-new50 -- --base <url>` |

## Two guards that are RED on `main` and are NOT mine

Both were red before this branch existed, and a red guard here blocks every session in this folder.

- **`verify:ledger-index` — 517 problems.** Every one is an id collision between `T1.md` and
  `T3.md` in the range P110001–P110500: sweep #9's terminals 1 and 3 both filed rows there. None of
  my ids are involved, and the count is identical before and after this branch. It needs T1 and T3
  to agree which of them renumbers.
- **`verify:scoped-reads` — 2 problems**, both `print_agents` writes in `lib/printHelpers.ts` and
  `lib/printSetupCode.ts` with no `restaurant_id` in the WHERE clause. That is S9-T11's territory.
- **`verify:abort-guard` — 2 problems**, both `fetch(input, init)` in `lib/netRetry.ts`. Not named
  by any S9 prompt.
