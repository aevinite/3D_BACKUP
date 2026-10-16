# T12 round 3 — the waiter tablet, MEASURED (sweep #10, 2026-10-16)

Owner, 2026-10-16: *"do it again, maybe replan whole thing and do it again because maybe some error
will be left. I want it completely error free and replan whole test, like everything should be covered,
every single bit of thing."*

Round 1 (P181001–P181500) checked behaviour; round 2 (P181501–P181952) enumerated every function,
data attribute and message. Both are lists someone wrote, and a list can only hold what its writer
thought of. Round 3 is planned from what the MACHINE reports instead:

| band | what | how it is "every bit" |
|---|---|---|
| **C** coverage | Run rounds 1 + 2 with `T12_COV` on, union the runs, list every line of `app.js` and of the inline scripts in `index.html` that no check has ever executed (`cov.mjs report --list`). | A number, not a claim: lines run / code lines. |
| **F** fixture world | The panel opened against a FAKE server — every `/api/tablet/*` answer written by the test, service worker blocked — so states the dev database does not hold can be built on demand and nothing is written anywhere: 0 / 1 / 300 tables, sections, merged parties, every bill state, every server answer (200, 4xx, 409 clash, 5xx, timeout, offline). One row per never-run region from C, until every reachable line has run or is explained. | Coverage re-measured after F. |
| **M** mutation | Small deliberate breaks in a COPY of `app.js` (a comparison flipped, a "not" dropped, and/or swapped, true/false, `??`→`\|\|`, a number ±1) served in place of the real file, against F. A CONTROL (an unchanged copy) must pass first. A break nobody notices is a missing check or a line that does nothing — both get a row. Repeat with fresh seeds until a pass finds nothing new. | Survivors / mutants, converged. |
| **T** host pages | `app/tablet/page.tsx`, `app/tablet/layout.tsx`, `app/r/[restaurant]/tablet/page.tsx` — every restaurant state the address can be in, read from the rendered HTML. | Every branch of the three files. |
| **R** regression | Every earlier row (rounds 1 + 2) re-run live on :4412. | Rows re-run / rows. |
| **X** item 25 | The manager Dashboard's seven charts against real bills (`dash-charts.mjs`, 165 checks), re-run at the end on backup. | — |

Rules: ids P213001–P213999 (claimed on main first, owner's yes). French House only is written to (bands
R and X); Aangan is read, never written. Band F and M write NOTHING — the server they talk to is the
test's own. Every red is proved against the product before anything is changed; a check that was
wrong says so in its own row.
