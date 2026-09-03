# docs/ — what is in here, and which of it is still true

Two kinds of document live in this folder and telling them apart matters more than anything else on
this page:

- **LIVE** — a rule or spec that describes the app as it is now. Follow it.
- **HISTORY** — a snapshot of a decision or an audit, kept because it records *why* something is the
  way it is. Every one of them opens with a `⚠️ HISTORY — not a current specification` banner.
  **Do not follow a HISTORY document for new work.**

If you only read one thing: `CLAUDE.md` in the repo root is the rulebook, and
`docs/CLAUDE-DETAIL.md` is that same rulebook unabridged, under the same headings.

---

## LIVE — read these before working in the area

| document | what it is for |
|---|---|
| **`CLAUDE-DETAIL.md`** | the full text of every rule in `CLAUDE.md`, under the same heading. The one to open before acting. |
| **`GUARD-MAP.md`** | "I changed this file — which of the 175 checks covers it?" Start here before running anything. |
| **`REJECTED-IDEAS.md`** | what the owner has already said NO to. **Read before suggesting any improvement.** |
| `ACCESS-MODEL.md` | how permissions actually work now (the live model — replaces the retired ladder). |
| `ACCESS-REDESIGN-SPEC.md` | the access work still owed. A live working list, not history. |
| `STAFF-PROFILE.md` | one profile shape for every person who has one — and why the kitchen has none. |
| `NUMBERING.md` | the three numbers a restaurant hands out (KOT, bill, invoice) and why the series have honest gaps. |
| `COMPLIANCE-GUARDRAILS.md` | what we must never build, in Indian billing law. Read before touching billing. |
| `OFFLINE-SYNC.md` | how the app keeps working with no internet. Read before touching a panel or a write endpoint. |
| `SAAS-EFFICIENCY-PLAYBOOK.md` | how to write a query that does not re-read whole tables. Read before writing one. |
| `QA-500-PHASES.md` | what the big `verify:everything` suite covers. Its phase numbers move — `-- --list` is the truth. |
| `PROJECT-HISTORY.md` | 12 numbered sections: the story behind each rule. Cited from `CLAUDE.md` as `§N`. |
| `FUTURE-AGGREGATOR-FEATURES.md` | Zomato/Swiggy work the owner parked. Not built, not forgotten. |
| `SECURITY-CHECKLIST.md` | what "check the security" means here — his 20 points plus the 8 this app needs. Log every run in §4. |
| `KITCHEN-PRINT-SETUP.md` | how a restaurant's printing is set up. **Nothing is ever offered as a download** — the reader types the file by hand. |
| `PRINT-HELPER.md` | the helper program that lets a COMPUTER own the paper (mig 341). One basket, each kind of paper its own printer. |
| `PRINT-TEST-PLAN.md` | the whole printing test plan and what running it found. Re-run it after touching printing. |
| `CANCEL-AND-LOSS-SPEC.md` | was the food actually made? — cancelling, real loss, and the audit tags behind it. |

## STUDIES — a plan for work that is NOT built

Live documents, but nothing in the app answers to them yet. Read one only when its subject comes up;
never treat it as a description of what exists.

| document | what it is for |
|---|---|
| **`HRMEX-INDEX.md`** | 🔑 the keyword. Say **HRMEX** and this file plus its three companions is the whole HR + payroll study. Start here. |
| `HRMEX-HR-PAYROLL-STUDY.md` | the study itself — what HR and payroll would mean for a restaurant this size. |
| `HRMEX-MAP-AND-FLOWCHART.md` | the same study as a map: who does what, in what order. |
| `HRMEX-SCREEN-BY-SCREEN.md` | the same study screen by screen, so a build could start from it. |

## HISTORY — kept for the "why", never to follow

Each of these already carries its own banner at the top. Listed so nobody has to open one to find out.

| document | what it recorded | superseded by |
|---|---|---|
| `ACCESS-LADDER.md` | the 4-rung permission ladder | `ACCESS-MODEL.md` (retired 2026-07-31) |
| `MASTER-PLAN.md` | the original plan, before the app had a name | `CLAUDE.md` |
| `BUSINESS-LOGIC-AUDIT.md` | an audit snapshot of the business rules | the live rules in `CLAUDE-DETAIL.md` |
| `SECURITY-AUDIT-2026-06-26.md` | a login/permission audit | the access rebuild + `CLAUDE-DETAIL.md` "Security gate" |
| `NIGHT-AUDIT-2026-06-14.md`, `HANDOVER-2026-06-14.md` | one overnight session's findings and handover | long since shipped |
| `STRESS-TEST-2026-07-03.md` | early load numbers | the measured ceiling of 2026-08-01 (mig 246) |
| `OFFLINE-TABLET-TEST.md` | a manual offline test script | `verify:offline`, `verify:outbox`, `verify:warm-shell` |
| `SESSION-CONTEXT.md` | a rolling session snapshot (the snapshot is stale; the list it points at is not) | `.claude/REQUESTS.md` |

## Design artefacts, not documentation

| path | what it is |
|---|---|
| `SAAS-ARCHITECTURE-PLAN.html` | the multi-tenant plan as approved 2026-06-25. Open in a browser. |
| `TABLET-ORDER-REDESIGN.html` | a tablet-ordering exploration. |
| `mockups/` | design mockups. Not served by the app. |
| `history/` | dated session records. |
| `superpowers/` | plans and specs written by the superpowers workflow, mostly 2026-06. Historical. |
| `runtime-support/` | notes on runtime/hosting support. |

*Not here any more:* the competitor-research screenshots (`All_compitior_POs_INFO/`, 185 files / 26 MB) live on the owner's Mac only — they are gitignored, so a clone and a worktree never carry them. Nothing in the repo points at them.

## Where the other paperwork lives

| you want | it is at |
|---|---|
| the rulebook | `CLAUDE.md` (repo root) |
| how to run the app at all | `README.md` (repo root) |
| every request the owner has made, ticked when built | `.claude/REQUESTS.md` |
| what a sweep found and what is still open | `.claude/sweep/T*-findings.md` |

---

*Adding a document?* Put it in the right table above in the same commit. If it is a snapshot rather
than a rule, give it the `⚠️ HISTORY — not a current specification` banner on line 1 — that banner is
the only thing standing between a future reader and following a decision that was reversed.
