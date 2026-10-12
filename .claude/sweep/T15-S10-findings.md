# Sweep #10 · T15 — the print queue and the print helper · findings (2026-10-12)

Nine problems, each fixed in its own commit on `sweep10/t15-print-queue-and-the-print`, each with a guard
that was broken on purpose once and went red. Improvements are NOT here — they were listed in the
terminal report only, by the sweep's rule.

| # | what was wrong | fix | guard (sabotage-tested) |
|---|---|---|---|
| 1 | The Windows **print-station** file wrote its start-up log to `%LOCALAPPDATA%\AevidinePrintHelperstation.log` — a template string ate the backslash — so its log folder stayed empty | `\\station.log` | `verify:print-helper` 8i — generates both Windows files; no `%VAR%` glued to a name |
| 2 | A kitchen slip **cleared while its printer was failing** could be requeued and print: `finishKotJob` read the status, then requeued in a second write. Also re-queued a slip already printed on a late failure report | the requeue is itself `.in("status", [queued, printing, failed])` | `verify:print-queue` §11; driven model P184207/P184208 fail on the old code |
| 3 | The owner's **Test** printed at their FIRST restaurant when the named one was out of scope (its own comment said "told no") | a named rid out of scope → 403; only no rid gets the default | `verify:print-helper` (paper-status block) |
| 4 | A computer that lost a **same-hostname setup race** was created without the issuing device, so its own panel said "not set up" | the retry passes the same issuer | `verify:print-helper` — every `createAgent` in printSetupCode carries it |
| 5 | The **Windows helper unlinked itself** when the PC started before its Wi-Fi (any non-`ok` hello deleted the token; Mac/Linux were fixed 2026-09-13, Windows was not) | HTTP status captured; only 401 unlinks; anything else waits 30 s and retries | `verify:print-helper` — on the generated Windows file |
| 6 | "**541h**" for a computer off for weeks on the admin overview, the board's computer row and the shared status row | `waitedWords` / `waitedShort` | `verify:print-queue` — no hour count built by hand in the board or printHelpers |
| 7 | `verify:printing-sweep` phase 334 **red** at 41 controls: it counted the print-history table and every linked PC, not the setup | the history table is not counted | full run 487/0/4 skip on :4415 |
| 8 | Tapping **Copy twice** in the printer guide copied "Copied ✓" onto the end of the command | read a clone of the block without its button | `verify:print-helper`; driven P184460 reads the clipboard |
| 9 | `docs/PRINT-HELPER.md`'s **reference tables** described the first draft (deleted install code, no `pair/claim`, no batch, typed route count, "to be settled in stage 5") | rewritten to today; dated history untouched | `verify:print-helper` — the Endpoints table |

Re-run: 193 older rows (13 ledger files) — 193 ✅, 0 regressions. Six of them live in the GENERATED
`T17-R2.md` and are re-run by `verify:admin-sweep` itself, not edited by hand.

Out of this boundary, named and left alone: `app/owner/settings/page.tsx` still says "asleep — last seen
541h ago" (same fault as item 6, owner panel); `scripts/sweep/t11/` (sweep #8's printing harness) can no
longer run — banks J–N number rows by position and have drifted.
