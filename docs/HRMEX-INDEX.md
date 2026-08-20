# 🔑 HRMEX — the keyword. Say "HRMEX" and this is what you get.

**This is the entry point for the whole HRMex HR + payroll study.**
Say the word **`HRMEX`** in any session and this file, plus the three documents below, is the
complete package. Nothing else needs to be re-explored.

> **Why it exists:** the owner wants to build a **full HR + payroll suite inside Aevidine** (the
> restaurant POS). HRMex (`https://demo.hrmexweb.in/`, Superadmin / 12345) was studied end to end on
> **2026-08-16** as the reference product. Nothing in Aevidine's code was changed.

---

## The four documents

| # | File | What's in it | Lines |
|---|---|---|---|
| 0 | **`docs/HRMEX-INDEX.md`** | this page — the keyword entry point | — |
| 1 | **`docs/HRMEX-HR-PAYROLL-STUDY.md`** | **The engines and our build plan.** How the payroll/attendance/leave calculations actually work, the ~50-table data model we'd need, the 10-phase build order for Aevidine, and the non-negotiables. **Read this before designing any HR feature.** | 909 |
| 2 | **`docs/HRMEX-SCREEN-BY-SCREEN.md`** | **The exhaustive catalogue.** All 13 modules, ~130 screens, every field, every dropdown option, every grid column. All 85 reports with their parameters and, for 7 of them, the real output. Plain-English summary of the whole product in **§19**. | 1,164 |
| 3 | **`docs/HRMEX-MAP-AND-FLOWCHART.md`** | **The click-map.** Depth-first ASCII trees: menu → screen → button → dialog → field, with arrows. Six cross-screen journey flowcharts. The 500-phase register. The 25-bug list. Referential-integrity test results. | 1,178 |

**Reading order if you're new to it:** §19 of doc 2 (plain English, whole product in 15 steps) →
§2 of doc 3 (the one-page master map) → doc 1 §13–14 (data model + build order).

---

## The 60-second version

HRMex answers three questions — **who works here · did they show up · what do we pay them** — and
then prints the paperwork. ~130 screens, ASP.NET WebForms, licensed per active employee.

**The five ideas worth stealing:**
1. **One `salary_heads` table** (43 rows) drives money, attendance counters *and* leave counters.
   Each row = name + type (`Allowence | Deduction | Attendance | Leave | SYSTEMS`) + a **formula**.
   Nothing is hard-coded — settings just *point* at a row ("the PF head is this one").
2. **Payroll = Month × Company × Batch**, run through **5 fixed stages**
   (Collect Attendance → Manual Import → Loan & Advance → Salary Calculation → Finalization),
   ending in **Lock + Finalize**.
3. **Two amounts per earning head**: the structure amount and the `E`-prefixed **earned** amount
   (`BASICDA` vs `EBASICDA`, `Gross` vs `EGross`). **Net = EGross − Deductions.** Verified by
   arithmetic on their own report. Get this wrong and every report has to be rebuilt.
4. **17 named day-corrections** on one dropdown per attendance day — and *the same 17* are the
   employee self-service permission list, ticked per staff Category.
5. **Leave policy = ~15 switches per Leave Level × Leave Type**, not code. Plus: formula fields ship
   with a **✔ Verify** button, and generated letters are **Voided, never deleted**.

**The one thing they got wrong that we must get right:** their payroll "lock" is **advisory**. A
finalised month can be reopened with one toggle — no reason, no confirmation, no approval — and the
audit log records **logins only**, so nothing is traceable. Their own product already contains the
correct answer (pay corrections as **arrears next month**); they just didn't enforce it.

---

## Our build order (detail in doc 1 §14)

```
1 rota/shifts → 2 attendance → 3 leave → 4 salary heads → 5 the monthly payroll run
→ 6 payslips & letters → 7 advances & staff meals → 8 statutory (PF/ESI/PT/TDS)
→ 9 staff self-service → 10 offboarding (Full & Final) + PMS
```

**Non-negotiables when we build it:**
- A finalised payroll month is **immutable, enforced at the database level**. Corrections = arrears.
- **Every money change hits the audit log** (theirs doesn't).
- **Refuse to finalise a negative net salary** (theirs shows ₹-6,801 in green).
- **Store both amounts per head** (structure + earned).
- **Nothing hard-coded** — PF/ESI/tips/meal deductions are rows + a head map.
- **RLS, not app filtering.** **Phone-first.** **Offline-capable.**

---

## Coverage, stated honestly

- Every one of the ~130 screens is accounted for; **~55 driven live** in the browser, the rest
  captured by authenticated markup parse (exact fields/options, but wouldn't reveal a runtime-only
  failure).
- **All 30 report pages'** parameters captured; **7 reports actually executed** and their real output
  recorded.
- **CRUD behaviour tested with throwaway records** (created and deleted): required-field validation,
  duplicate rejection, named delete confirmation, and **referential integrity** — deleting a
  department that had an employee in it was correctly **blocked**.
- **25 bugs verified live** (doc 3 §7).
- Not tested: running payroll / locking a month / sending emails / firing device commands — all
  would alter their data or mail real people. No employee-facing ESS portal exists in the demo.

---

## Related memories

`hr-payroll-module-planned` · `billing-compliance-guardrail` · `person-profile-one-shape` ·
`staff-profiles-payroll-shipped` · `manager-bills-cannot-hide-a-sale`
