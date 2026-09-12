# H19 — HRMex 10.0.0.0 · ⭐ PAYROLL (all 18 screens, the 5 stages, the payslip verified)

**Captured live 2026-09-07** on `https://demo.hrmexweb.in` as `Superadmin`, one signed-in session.
**Nothing was run, saved, sent, locked, finalised, uploaded or deleted.** Where a control would
write, the control and its own wording are recorded and the control was left alone.

**How to read the labels below:** `(live)` = the screen was driven in a real browser and the values
are what was on it. `(markup only)` = the fields were read from the page's own markup without the
screen being exercised. Every number quoted is a real value that was on screen on 2026-09-07.

**Scope note.** The old catalogue counted 17 payroll screens. There are **18** — `Arrears.aspx`
holds only the arrear *batch list*; its **Proceed** action opens a separate
`Arrears_Calculation.aspx` screen that the 2026-08-16 capture never reached. All 18 were opened live.

---

## ⭐⭐ THE HEADLINE — the two amounts per earning head, verified by arithmetic

The 2026-08-16 study's central claim was that **every earning head exists twice** — the structure
amount (`BASICDA`) and the actually-earned amount (`EBASICDA`) — and that **Net = EGross −
Deductions**. That claim is **CONFIRMED**, and it was verified three independent ways.

### Proof 1 — every employee in a whole month's register (121 rows, zero exceptions)

`Payroll → Salary List`, Salary Month `May/2026`, Show. The grid is a 50-column register. Every row
was checked by machine:

| Relationship tested | Rows checked | Rows that failed |
|---|---|---|
| `EGross = EBASIC + EBASICDA + EHRA + EFIX_INCENTIVE + EOTHERS + EMonthly Incentive + ESpecialAllowence` | 121 | **0** |
| `TotalEarning = EGross` | 121 | **0** |
| `NetSalary = EGross − TotalDeduction` | 121 | **0** |

**The four heads that sit OUTSIDE the earned gross: `EOT`, `EReimbursement`, `EWD`, `EGrossOther`.**
This is not "they happened to be zero" — **`EWD` carries a real non-zero amount on 30 of the 121
rows** (EMP007 ₹27, EMP013 ₹26, EMP015 ₹27, EMP029 ₹26 …) and is still excluded from `EGross`, from
`TotalEarning` and therefore from `NetSalary`. Money computed under the `WD` head is displayed and
not paid.

### Proof 2 — the batch total (`ALL PF STAFF & HOD PARDI`, May-2026, 16 employees)

Read off the batch runner's stage-4 grid (`ajaxSalaryTable`), TOTAL row:

```
STRUCTURE   BASICDA 215,755 · HRA  86,304 · SpecialAllowence 129,447            → Gross   431,506
EARNED     EBASICDA 176,785 · EHRA 70,716 · ESpecialAllowence 106,065
                            + EMonthly Incentive 80                             → EGross  353,646
                            (EWD 189 — shown, NOT added)
DEDUCTIONS  PF 16,481 · ESIC 1,193                                              → Total    17,674
NET                                                            353,646 − 17,674 = 335,972 ✔
```

Per-employee, all 16 rows satisfied `NetSalary = EGross − TotalDeduction` exactly.

### Proof 3 — the payslip itself, three employees, arithmetic written out

`Payroll → Payroll Voucher`, month stepped back to **May-2026** with the ◀ arrow.

**EMP065 · Test 65 · Plant Head · Company 2 · Production Pardi · joined 01-Dec-2024**

```
ATTENDANCE          P 26 · WO 4 · H 1                                   (= 31)
FIXED               BASICDA 54,100 · HRA 21,640 · FIX_INCENTIVE 0 · OTHERS 0 ·
                    Monthly Incentive 0 · SpecialAllowence 32,460 ·
                    Reimbursement 0 · WD 0
EARNINGS            BASICDA 54,100 · HRA 21,640 · OTHERS 0 🔒 ·
                    Monthly Incentive 0 🔒 · SpecialAllowence 32,460 · Reimbursement 0 🔒
FIXED DEDUCTION     LOAN 0 · PF 1 · Advance 0 · Other Deduction 0 · Canteen 0
DEDUCTION           PF 1,800 · Advance 0 🔒 · Canteen 0 🔒
SUMMARY             TotalDays 31 | TotalFixed 108,200 | TotalEarnings 108,200 | TotalDeductions 1,801
NET                 ₹ 106,399.00
```
Arithmetic: earnings column 54,100 + 21,640 + 0 + 0 + 32,460 + 0 = **108,200 = TotalEarnings**.
Deduction column 1,800 + 0 + 0 = 1,800; fixed-deduction column 0+1+0+0+0 = 1; **TotalDeductions
1,801 = 1,800 + 1**. Net 108,200 − 1,801 = **106,399** ✔ printed.

**EMP148 · Test 148 · Supervisor · joined 15-Nov-2025** — the one employee with a manually
imported incentive, and one with ESIC:

```
ATTENDANCE          P 15.5 · A 11.5 · WO 4                              (= 31)
FIXED               BASICDA 7,500 · HRA 3,000 · OTHERS 0 · FIX_INCENTIVE 0 ·
                    Monthly Incentive 0 · SpecialAllowence 4,500 · OT 0 · Reimbursement 0 · WD 1
EARNINGS            BASICDA 4,306 · HRA 1,722 · OTHERS 0 🔒 ·
                    Monthly Incentive 80 · SpecialAllowence 2,583 · WD 27
FIXED DEDUCTION     Bonus 0 · LOAN 0 · PF 1 · Advance 0 · Other Deduction 0 · Canteen 0 · ESIC 1
DEDUCTION           PF 517 · Advance 0 🔒 · Canteen 0 🔒 · ESIC 65
SUMMARY             TotalDays 31 | TotalFixed 15,000 | TotalEarnings 8,691 | TotalDeductions 584
NET                 ₹ 8,107.00
```
Arithmetic: 4,306 + 1,722 + 0 + 80 + 2,583 = 8,691 — **and the WD 27 on the same list is left out**,
which is exactly what `TotalEarnings 8,691` shows. Deductions 517 + 65 = 582, plus the
fixed-deduction column (1 + 1) = **584**. Net 8,691 − 584 = **8,107** ✔ printed.
**The ₹80 imported at stage 2 "Manual Import → Monthly Incentive" landed on the earned head
`EMonthly Incentive`, and nowhere else.**

**EMP001 · Test 1 · GM Marketing · Bank 9 · joined 01-Jan-2016** — the one with a loan:

```
LOAN BLOCK          PERSONALE LOAN | New Loan 0 | Installment 5,000 | Interest 0 | Balance 70,000
ATTENDANCE          P 20 · A 2 · WO 5 · H 1 · OD 3                      (= 29 paid)
FIXED               BASICDA 40,260 · HRA 16,104 · FIX_INCENTIVE 0 · OTHERS 0 ·
                    Monthly Incentive 0 · SpecialAllowence 24,156 · Reimbursement 0 · WD 0
EARNINGS            BASICDA 37,663 · HRA 15,065 · OTHERS 0 🔒 ·
                    Monthly Incentive 0 🔒 · SpecialAllowence 22,598 · Reimbursement 0 🔒
FIXED DEDUCTION     LOAN 0 · PF 1 · Advance 0 · Other Deduction 0 · Canteen 0
DEDUCTION           LOAN 5,000 · PF 1,800 · Advance 0 🔒 · Canteen 0 🔒
SUMMARY             TotalDays 31 | TotalFixed 80,520 | TotalEarnings 75,326 | TotalDeductions 6,801
NET                 ₹ 68,525.00
```
Arithmetic: 37,663 + 15,065 + 22,598 = **75,326 = TotalEarnings**. 5,000 + 1,800 = 6,800, + the
fixed-deduction column 1 = **6,801**. Net 75,326 − 6,801 = **68,525** ✔ printed.
**A loan instalment arrives as a deduction line on the head `LOAN`** — the same name as the
fixed-deduction row above it — and the loan block shows the remaining balance beside it.
And `40,260 × 29 ÷ 31 = 37,663` exactly, which is the proration in the open.

### ⚠️ The payslip and the register disagree by the fixed-deduction column

| Employee | Register (`Salary List` / batch grid) | Payslip (`Payroll Voucher`) | Gap |
|---|---|---|---|
| EMP065 | Net **106,400** (108,200 − 1,800) | Net **106,399** (108,200 − 1,801) | ₹1 |
| EMP148 | Net **8,109** (8,691 − 582) | Net **8,107** (8,691 − 584) | ₹2 |
| EMP001 | Net **68,526** (75,326 − 6,800) | Net **68,525** (75,326 − 6,801) | ₹1 |

The register's `TotalDeduction` counts **only** the earned DEDUCTION column. The payslip's
`TotalDeductions` adds the **FIXED DEDUCTION** column on top of it. So **the number the employee is
handed is not the number the register pays**. Reproduced on three employees in one month.

### ⚠️ The Finalization card's "Allowances Breakdown" adds structure to earned

The five-card summary on stage 5 shows `BASICDA ₹3,92,540`. Neither the structure total (₹2,15,755)
nor the earned total (₹1,76,785). It is **the two added together**:

```
BASICDA           215,755 + 176,785 = 392,540   ← the figure on the card
HRA                86,304 +  70,716 = 157,020   ← the figure on the card
SpecialAllowence  129,447 + 106,065 = 235,512   ← the figure on the card
WD                      0 +     189 =     189   ← the figure on the card
Earned Gross                          353,646   ← correct
```
The 2026-08-16 note read this card as "the full structure". It is neither one — it is a sum of the
two, and it is not a payable amount. Only the `Earned Gross` line on that card is real money.

### ⚠️ The structure column's UNIT changes between employees, and nothing says so

On 30 of the 121 May-2026 rows the `BASIC` column holds a **per-day rate**, not a monthly amount:

| Emp | P | TotalDays | BASIC | EBASIC | EBASIC ÷ BASIC | Gross | EGross |
|---|---|---|---|---|---|---|---|
| EMP027 | 8 | 13 | **502** | 4,518 | 9.00 | **640** | 5,760 |
| EMP028 | 24 | 29 | **490** | 12,250 | 25.00 | **600** | 15,000 |
| EMP025 | 26 | 31 | **502** | 13,554 | 27.00 | **680** | 18,360 |
| EMP021 | 15 | 20 | **502** | 8,032 | 16.00 | **730** | 11,680 |

`Gross` for these people is a **daily gross** (₹640, ₹600, ₹680, ₹730) and `EGross` is that rate ×
a whole number of days. Their `BASICDA`/`EBASICDA` are 0 — their pay hangs off `BASIC` instead.
Monthly-staff rows and daily-wage rows sit in the same grid under the same column headings with
different units, and the screen never labels which is which.

### The paid-day formula, in the product's own words

Hovering any `Total` cell on stage 1 shows the formula the product uses, per employee:

```
P + WO + H + OD + PL + CL + COFF + SL + ML = Total
26 + 4  + 1 + 0  + 0  + 0  + 0    + 0  + 0  = 31
```
**`A` (absent) and `WOP` are not in the sum.** So a paid day = present, weekly off, holiday, on-duty,
privilege/casual/sick leave, comp-off or maternity leave.

⚠️ **The proration divisor is only sometimes 31.** EMP001: `40,260 × 29 ÷ 31 = 37,663` exactly.
EMP102: `11,912 × 28 ÷ 31 = 10,759`, but the screen shows `EBASICDA 10,588`. So a second
per-employee factor exists (the `Working days` override, category rules, or a joining-date
pro-rata) that **no payroll screen displays**. If you rebuild this, put the divisor on the slip.

---

## 1. Payroll = Month × Company × Batch — verified, with a wrinkle

The shape holds, but the board is not a flat Month × Company grid. `Salary Month` spans two rows
(one per company) with `rowspan=2`, and so do **Create** and **View** — so:

- **Employee Count · Batch Remaining · Salary Calculated · Salary Verified · Lock · Finalization**
  are **per Month × Company**.
- **New Batch** and **Process Batches** are **per Month only** — one pair of buttons for both
  companies. A batch is therefore created against a *month*, and its company comes from the
  checkbox tree inside the New Batch dialog, not from the row you clicked.
- A **Batch** is a saved selection of employees by Category × Company × Division × Department,
  named by hand, tied to one calculation month.

---

## 2. Salary Process — `/Payroll/PayrollProcess.aspx` *(live)*

**Where:** Payroll → Salary Process. This is the control board for the whole module.

**What you see on arrival:** a breadcrumb `Home / Salary Process`, then a card titled **Salary
Process Details**. Below the title, a `Filter by Month:` line with the help text *"Use this dropdown
to filter payroll records by month. Press Escape to clear the filter."*, a `[Clear Filter]` button
and an `[Add Month]` button. Under that, a horizontally-scrolling **month chip strip** with ◀ ▶
arrows (`Scroll tabs left` / `Scroll tabs right`), then the grid.

**The month chip strip — all 17 chips, in screen order:**
`All Months · Sep/2026 · Aug/2026 · Jun/2026 · May/2026 · Apr/2026 · Mar/2026 · Feb/2026 · Jan/2026
· Dec/2025 · Nov/2025 · Oct/2025 · Sep/2025 · Aug/2025 · Jul/2025 · Jun/2025 · Dec/2024`
Each chip carries a state class: `tab-status-complete` (Jun/2026 back to Dec/2024),
`tab-status-incomplete` (Aug/2026), and `active` on the one selected. **Sep/2026 is selected on
arrival and its grid says `No data found`** — so the board opens empty on a brand-new month.
The same 17 entries also exist as two hidden `<select>`s (`ddlMonthFilter`, `ddlMonthFilterAjax`)
whose first option reads `-- All Months --`.
*(2026-08-16 said the strip began at Aug/2026 — `Sep/2026` has since been added.)*

**Grid columns (10):** `Salary Month | Company Name | Employee Count | Batch Remaining | Salary
Calculated | Salary Verified | Create | View | Lock Status | Finalization Status`
*(2026-08-16 wrote the last four as `[+ New Batch] | [⚙ Process Batches] | Lock Status | Finalization
Status`. The headers on screen today are the single words **Create** and **View**; the buttons
inside them read `New Batch` and `Process Batches`.)*

**All 32 live rows, `All Months`, 2026-09-07** (`Emp / Remaining / Calculated / Verified`, then
Lock and Final as `ON`/`off`, `†` = the toggle is greyed out):

| Month | Company 1 | Company 2 |
|---|---|---|
| Aug/2026 | 1 / 1 / 0 / 0 — off† off† | 123 / 123 / 121 / 1 — off† off† |
| Jun/2026 | 1 / 1 / 0 / 1 — ON ON | 125 / 125 / 0 / 125 — ON ON |
| May/2026 | 1 / 1 / 0 / 0 — ON† ON† | 124 / 13 / 121 / 124 — ON ON |
| Apr/2026 | 1 / 1 / 0 / 1 — ON ON | 123 / 5 / 119 / 124 — ON† ON† |
| Mar/2026 | 1 / 1 / 0 / 1 — ON ON | 121 / 4 / 118 / 122 — ON† ON† |
| Feb/2026 | 1 / 1 / 0 / 1 — ON ON | 120 / 4 / 117 / 121 — ON† ON† |
| Jan/2026 | 1 / 1 / 0 / 0 — ON† ON† | 118 / 5 / 116 / 114 — ON† ON† |
| Dec/2025 | 1 / 1 / 0 / 0 — ON† ON† | 114 / 32 / 112 / 116 — ON† ON† |
| Nov/2025 | 1 / 1 / 0 / 1 — ON ON | 113 / 16 / 109 / 119 — ON† ON† |
| Oct/2025 | 1 / 1 / 0 / 1 — ON ON | 110 / 40 / 104 / 110 — ON ON |
| Sep/2025 | 1 / 1 / 0 / 0 — ON† ON† | 113 / 28 / 100 / 104 — ON† ON† |
| Aug/2025 | 1 / 1 / 0 / 0 — ON† ON† | 110 / 110 / 100 / 0 — ON† ON† |
| Jul/2025 | 1 / 1 / 0 / 0 — ON† ON† | 106 / 106 / 82 / 1 — ON† ON† |
| Jun/2025 | 1 / 1 / 0 / 0 — ON† ON† | 106 / 106 / 88 / 2 — ON† ON† |
| Dec/2024 | 1 / 1 / 0 / 0 — ON† ON† | 94 / 94 / 0 / 0 — ON† ON† |
| Sep/2026 | *(the chip is selected by default and the grid says `No data found`)* | |

`Batch Remaining` renders red; `Salary Calculated = 0` cells shade pink.
May/2026 Company 2 (124 / 13 / 121 / 124) is unchanged from the 2026-08-16 reading — verified.

**⭐ Lock Status and Finalization Status — the exact wording (new; not in the old capture).**
Each is a `custom-switch` toggle with a tooltip that changes with its state. All four wordings, read
off the live page:

| State | Lock Status tooltip | Finalization Status tooltip |
|---|---|---|
| greyed out | *"Lock can only be enabled when all employees' salaries are verified"* | *"Finalization can only be enabled when all employees' salaries are verified"* |
| live, already on | *"Click to lock/unlock this payroll month"* | *"Click to unmark this payroll month as final"* |

**So the board does gate it:** a month × company whose `Salary Verified` is short of its
`Employee Count` has both toggles disabled, and the tooltip says why. Where verified = employee
count (May/2026 Company 2: 124 of 124) both toggles are live and both read ON. **A month that is
already final can be un-finalised from this switch in one click** — the tooltip says so in those
words — with **no confirmation dialog and no reason field anywhere on the screen**. Neither toggle
was touched. **What a finalised month looks like:** the switch sits ON, and on the Payroll Voucher
its editable cells render with a **padlock** instead of a double-click target.

**Controls, in the order they appear:**
1. `Filter by Month:` dropdown → filters the grid to one month; Escape clears it.
2. `[Clear Filter]` (`btnClearFilterAjax`) → returns the grid to all months.
3. `[Add Month]` (`AddMonth`, an `input type=submit`) → opens **Add Salary Month**.
4. Month chips → switch the grid to that month.
5. `[New Batch]` per month → opens **Salary Process** (the batch builder).
6. `[Process Batches]` per month → navigates to **Payroll Batch Details** for that month, at
   `…?SalaryMonthID=<n>&SalaryMonth=<Mon%2FYYYY>` (May/2026 = 13, Aug/2026 = 15, Jun/2026 = 14,
   Feb/2026 = 11, Dec/2025 = 9, Oct/2025 = 7).
7. The two toggles, above.

**Dialog — `Add Salary Month`** (`#modal-default`) *(read from markup; `[Add Month]` was not pressed
because it posts)*: one field `monthadd`, a text box with placeholder **`Select Month & Year`**, not
marked required, empty by default. Buttons `[Close]` and `[Save Month]` (`btnSaveMonth`).

**Dialog — `Salary Process`, the batch builder** (`#modal-batch`) *(markup)*:
- `Batch Name` — `txtBatchName`, text, empty.
- **`Salary Month`** — `txtCalculationMonth`, a month picker, empty.
  *(2026-08-16 called this field "Calculation Month" — that is the control's internal name; the
  label printed beside it on screen is **Salary Month**.)*
- Four checkbox trees, each with its own `Select All`:
  - **Category (7):** Category 1 · Category 2 · Category 3 · Category 4 · Category 5 · Category 6 · Category 7
  - **Company (2):** Company 1 · Company 2
  - **Division (9):** Division 1 … Division 9
  - **Department (22):** Default · Marketing · Dispatch · Production · Accounts · Loading · STORE ·
    Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing ·
    Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT
- Buttons `[Show]` (`btnShowEmp`, lists the employees the filter catches) and `[Save]` (`btnSaveBatch`).

**Dialog — the month picker** (`#modal-default1`) *(markup)*: one labelled field `Salary Month`
(`txtProcessMonth`) and a `×`.

**Empty state:** the grid prints a single row, `No data found`. **Realtime/auto:** none — the chips
and Clear Filter refresh the grid over AJAX on click; nothing moves on its own.

---

## 3. Payroll Batch Details — `/Payroll/PayrollBatchDetails.aspx?SalaryMonthID=…&SalaryMonth=…` *(live)*

**Where:** Payroll → Salary Process → `[Process Batches]` on a month row.

**What you see:** breadcrumb `Salary Process > Payroll Batch Details` (the first crumb links back to
`/Payroll/PayrollProcess.aspx?month=2026-05-01`), a `[< Back to Process]` button (`btnBack`), a card
**Payroll Batch Processing Details** holding a single labelled field **`Salary Month`**
(`txtProcessMonth`, showing `May/2026`), then a **Payroll Batches** grid.

**Grid columns (7):** `Batch Name | Total Employees | Month Days | Working Days | Weekly Offs |
Holidays | Actions`

**Live batches, May-2026 (`SalaryMonthID=13`)** — how a factory actually cuts up its payroll:

| Batch Name | Employees | Month Days | Working Days | Weekly Offs | Holidays |
|---|---|---|---|---|---|
| ALL PF STAFF & HOD PARDI | 16 | 31 | 0 | 0 | 0 |
| ALL PF STAFF & HOD SARIGAM | 45 | 31 | 0 | 0 | 0 |
| ALL NON PF STAFF & HOD SARIGAM | 22 | 31 | 0 | 0 | 0 |
| ALL PF WORKERS SARIGAM | 10 | 31 | 0 | 0 | 0 |
| ALL NON PF WORKERS SARIGAM | 18 | 31 | 0 | 0 | 0 |

⚠️ **`Month Days` reads 31 on every batch in every month checked** — including **February-2026**
(6 batches, all "31") — and `Working Days`, `Weekly Offs` and `Holidays` read **0 everywhere**. The
four calendar columns are decoration on this install; the calculation is not using them from here.

**Row actions — `[Actions ▾]` (4 items, was 2 in the old capture):**
| Item | What it does |
|---|---|
| **Batch Emp List** | opens the **Batch Employee Preview** dialog (a read) |
| **Revise** *(new)* | `btnRevise` — re-opens the batch's employee selection |
| **View Batch** | navigates to the batch runner, `SalaryProcessNew.aspx?BatchID=<n>&ProcessMonth=YYYY-MM-01` |
| **Delete** *(new)* | `btnDelete` — removes the batch. Not pressed. |

**Dialog — `Batch Employee Preview`** (`#employeePreviewModal`) *(live, PARDI batch)*:
a `Summary` chip that expands to `Employees · Companies · Departments · Divisions · Categories`
counts, then a grid `EMPLOYEE CODE | EMPLOYEE NAME | COMPANY | DEPARTMENT | DIVISION | CATEGORY |
STATUS` and `[CLOSE]`. All 16 live rows:

```
EMP065 Test 65  Company 2 Production Pardi Division 3 Category 4 Working
EMP069 Test 69  Company 2 Production Pardi Division 3 Category 5 Working
EMP101 Test 101 Company 2 Accounts         Division 3 Category 2 Resign
EMP102 Test 102 Company 2 Production Pardi Division 3 Category 5 Working
EMP103 Test 103 Company 2 QC PARDI         Division 3 Category 5 Working
EMP104 Test 104 Company 2 Packing          Division 3 Category 2 Working
EMP131 Test 131 Company 2 Production Pardi Division 3 Category 2 Working
EMP133 Test 133 Company 2 Production       Division 3 Category 2 Working
EMP144 Test 144 Company 2 Production Pardi Division 3 Category 5 Working
EMP148 Test 148 Company 2 Production Pardi Division 3 Category 2 Working
EMP149 Test 149 Company 2 Production Pardi Division 3 Category 5 Working
EMP150 Test 150 Company 2 Production Pardi Division 3 Category 5 Working
EMP151 Test 151 Company 2 Production Pardi Division 3 Category 5 Working
EMP156 Test 156 Company 2 Production Pardi Division 3 Category 2 Working
EMP161 Test 161 Company 2 Production       Division 3 Category 5 Working
EMP167 Test 167 Company 2 Production Pardi Division 3 Category 6 Working
```
Note **EMP101 sits in the batch with status `Resign`** — a leaver is still paid through the batch.

**Empty state (live, Aug/2026 = id 15 and Jun/2026 = id 14):** the page shows the heading
`Payroll Batches` and then **nothing at all** — no column headers, no "no records" message. Both
months show 121 / 0 `Salary Calculated` on the board with **zero batches**, so calculation on this
install has also been run outside a batch, from `Reports → Salary calculation`.

**Sort/filter/paging:** none on this grid.

---

## 4. ⭐ Salary Process (the batch runner) — `/Payroll/SalaryProcessNew.aspx?BatchID=…&ProcessMonth=…` *(live)*

**Where:** Payroll → Salary Process → Process Batches → Actions ▾ → **View Batch**.
Captured on `BatchID=49&ProcessMonth=2026-05-01` = *ALL PF STAFF & HOD PARDI*, May-2026, 16 people.

**What you see:** a title strip `SALARY PROCESS` / `Batch: ALL PF STAFF & HOD PARDI` / `May-2026`,
then the five-step stepper, then two number strips, then the active step's panel, then a permanent
footer strip.

### The five stages — the names exactly as printed
```
① Collect Attendance  ② Manual Import  ③ Loan and Advance  ④ Salary Calculation  ⑤ Finilization
```
**`Finilization` is spelled that way on screen** (sic) — confirmed again today. The heading list on
the page reads `Collect Attendance · Manual Import · Loan and Advance · Salary Calculation ·
Finilization`, and the panes are `step1…step5Content`. The 2026-08-16 names are correct.

On this completed batch every step carries `step-item disabled completed` and step 5 also `active` —
i.e. **a finished batch shows all five green and read-only, and lands you on Finalization.**
⚠️ **I could not find a batch anywhere in the demo whose stepper was not fully complete** (checked
May/2026, Feb/2026, Dec/2025, Oct/2025; Aug/2026 and Jun/2026 have no batches at all). The
stage 1–4 descriptions below therefore come from the panes' own markup and tooltips, which are all
present in the page — **they are not "seen working"** and are labelled accordingly.

**Header strip (live):** `Month Days: 31 · Working Days: 0 · Weekly Offs: 0 · Holidays: 0` + `[Back]`
**Second strip (live):** `Total Employees: 16 · Companies: 1 · Categories: 4 · New Joinings: 0 ·
Resignations: 1`
- `Companies:` is a link → dialog `Company` → `Company 2 — 16 employees`.
- `Categories:` is a link → dialog `Categories` → `Category 5 — 8 employees · Category 2 — 6 ·
  Category 4 — 1 · Category 6 — 1`.

**⭐ Footer strip, always visible (live):** `Total Employees 16 · Zero Days In Total 0 ·
MP/NSF Status 0` — i.e. *how many people would be paid nothing* and *how many have missing punches*.
⚠️ **`Zero Days In Total` counts people whose day-total is 0, not people who earn nothing.** EMP151
has `P 0 · A 27 · WO 4 → Total 4` and `EGross 0` — paid nothing, and the counter still reads 0.
A "nobody is being paid ₹0" check on this screen would pass while one person is.

### ① Collect Attendance — *(markup + live grid)*
- `[COLLECT ATTENDANCE]` (`btnCollectAtt`, greyed on a done batch) · `[Refresh]` (`btnRefreshAttendance`).
- An importer: `Choose file` (`exampleInputFile`) **or** a textarea `Paste Data Here with Header`
  (`TxtCopyData`), and `[Preview]` (`btnPreview`) + **`[Revise Data]`** (`btnReviseData2`, new).
  Both are disabled here and say why: *"Cannot preview when all employees are selected"* /
  *"Cannot revise when all employees are selected"*.
- A search box: *"Search by Employee Code, Name, Department, or Division…"* with a clear ✕.
- `[CSV]` and `[Excel]` export chips.
- **The attendance grid `grdAttendanceView`** — `☐ | EmpCode | EmployeeName | P | A | WO | WOP | H |
  HP | OD | PL | CL | COFF | SL | OT HRS | ML | Total`, with a check-all and a checkbox per row (all
  ticked). Every `Total` cell carries the formula tooltip quoted above. Every row is
  *"Click to view attendance voucher"* → opens a right-hand slide-out **`Attendance Voucher`** panel
  (`attendanceDetailPanel` + an iframe `attendanceVoucherFrame`) that first shows
  *"Loading attendance voucher…"*.
- Live rows (May-2026, PARDI):
```
EMP065 26   0    4 0 1 0 0 0 0   0 0 00:00 0 31
EMP069 25   0    4 0 1 0 0 0 1   0 0 00:00 0 31
EMP101  6  23    1 0 1 0 0 0 0   0 0 00:00 0  8
EMP102 22.5 3    4 0 1 0 0 0 0.5 0 0 00:00 0 28
EMP103 22.5 0.5  4 0 2 0 0 0 1   0 1 00:00 0 30.5
EMP104 24.5 1.5  4 0 1 0 0 0 0   0 0 00:00 0 29.5
EMP131 22.5 1.5  4 1 1 0 0 0 2   0 0 00:00 0 29.5
EMP133 23   1    4 0 1 0 0 0 0   0 2 00:00 0 30
EMP144 24   2    4 0 1 0 0 0 0   0 0 00:00 0 29
EMP148 15.5 11.5 4 0 0 0 0 0 0   0 0 00:00 0 19.5
EMP149 14  13    4 0 0 0 0 0 0   0 0 00:00 0 18
EMP150 22   4    4 0 1 0 0 0 0   0 0 00:00 0 27
EMP151  0  27    4 0 0 0 0 0 0   0 0 00:00 0  4
EMP156 26   0    4 0 1 0 0 0 0   0 0 00:00 0 31
EMP161 19   7    4 0 1 0 0 0 0   0 0 00:00 0 24
EMP167 21.5 4.5  4 0 1 0 0 0 0   0 0 00:00 0 26.5
```
- Footer nav `[Back]` (`btnBack`) · `[Next]` (`btnNext`).
- **What it needs before it can run:** attendance must exist for the month (punches collected, or a
  file/paste imported here). **What it shows once run:** the grid above, filled, with a per-person
  Total.
- ⚠️ **The rounding changes between this grid and the calculation grid.** EMP102 reads `P 22.5 ·
  CL 0.5 · Total 28` here and `P 23 · CL 1 · TotalDays 28` on stage 4. EMP148 reads `Total 19.5`
  here and `TotalDays 20` there. Half-days are rounded up per head downstream.

### ② Manual Import — *(markup + live totals)*
One block **per manual money head**. Live blocks, in order: **Advance · Canteen · Monthly Incentive
· OTHERS · Reimbursement**. Each block has:
- the head name + a **`Mandatory`** badge + a status line **`File is not uploaded`**
  (this batch shows *"File Imported Successfully — This file has been processed and imported into
  the system"* on the ones that were done);
- a **`File Format`** link (the template);
- `Choose file` (`rptFileUpload_exampleInputFileManualAtt_n`) **or** a textarea
  `Paste Data Here with Header` (`rptFileUpload_TxtCopyData1_n`);
- `[Preview]` · `[Import Data]` · `[Clear]`;
- a running **`Total:`** — live, **Monthly Incentive shows `Total: 80`**;
- a preview grid `Emp Code | Employee Name | Amount` — live, Monthly Incentive holds one row:
  `EMP148 | Test 148 | 80`;
- two per-block flags in the markup, `chkSkipUpload_n` and `chkImported_n`, both disabled.
- ⚠️ **The badge says `Mandatory` and the file picker's own tooltip says *"File upload is now
  optional"*.** The screen contradicts itself about whether a head must be filled.
- **Where each head lands:** the ₹80 imported to *Monthly Incentive* appears on the payslip and in
  the register as **`EMonthly Incentive`** — an *earned* head. Same pattern for **Advance** →
  `Advance` (deduction), **Canteen** → `Canteen` (deduction), **OTHERS** → `EOTHERS`,
  **Reimbursement** → `EReimbursement`.

### ③ Loan and Advance — *(markup + live empty state)*
`Loan Month` (`txtAttMonth`), `[Show]` (`BtnShow`), `[Export CSV]` *("Export loan data to CSV
format")*, `[Export Excel]` *("Export loan data to Excel format")*, and a `Refresh List` control.
Live empty state, verbatim:
> **No Loan Data Available** — *No loan records found for the selected month and batch.
> Employees in this batch may not have any active loans for May-2026.
> Try selecting a different month or check if loans are configured for this batch.*

**Where loans arrive:** the instalment does not come from here as money — it lands on the deduction
head **`LOAN`** (EMP001, ₹5,000, with the loan's remaining balance ₹70,000 shown on the payslip).

### ④ Salary Calculation — *(markup)*
A single button that reads **`Calculation Completed`** when done (`btnSalaryCalculateAjax`, disabled)
over a progress bar showing `0%` and **`Remaining time: calculating…`**, plus a `[Try Again]` /
`[Retry]` pair for a failed run, an `Oops! Something went wrong` panel, a `Loading Salary Data`
panel, a search box (*"Search by Employee Code, Name, Department, or Division…"*), and
**`[Export Results]`** (`btnExcelExport`) + **`[Export Results (Old)]`** — two export buttons side by
side, one labelled as the previous version.
**⭐ Its output grid `ajaxSalaryTable` is the whole model — 50 columns:**
```
☐ | EmpCode | EmployeeName | Company | Department | Designation
| P | A | WO | WOP | H | HP | OD | PL | CL | COFF | SL | OT HRS | ML | TotalDays
| BASIC | BASICDA | HRA | FIX_INCENTIVE | OTHERS | Monthly Incentive | SpecialAllowence | Gross
| EBASIC | EBASICDA | EHRA | EFIX_INCENTIVE | EOTHERS | EMonthly Incentive | ESpecialAllowence | EGross
| EOT | EReimbursement | EWD | EGrossOther | Total Earning
| Bonus | LOAN | PF | Advance | Other Deduction | Canteen | ESIC | TotalDeduction | NetSalary
```
A `Details` dialog (`salaryDetailModal`) and an `Employee Details` panel open per row.

### ⑤ Finilization — *(live)*
Five cards, then one button. Live figures, PARDI batch, May-2026:
```
Total Payroll Summary      Total Employees 16 · Gross Salary ₹3,53,646.00 · Other Earning ₹0.00 ·
                           Total Earning ₹3,53,646.00 · Total Deductions ₹17,674.00 ·
                           Net Salary ₹3,35,972.00
Allowances Breakdown       "Earnings & Benefits"
                           BASICDA ₹3,92,540.00 · HRA ₹1,57,020.00 · SpecialAllowence ₹2,35,512.00 ·
                           WD ₹189.00 · Earned Gross ₹3,53,646.00
Other Earnings             "Additional Compensation"
                           OTHERS ₹0.00 · Monthly Incentive ₹80.00 · Reimbursement ₹0.00
Deductions Breakdown       "Taxes & Deductions"  PF ₹16,481.00 · ESIC ₹1,193.00 ·
                           Total Deduction ₹17,674.00
Total Liabilities          "Outstanding Obligations"  → "No liabilities found"
Total Company Expense      "Net Salary + Total Liabilities"
                           Net Salary ₹3,35,972.00 + Total Liabilities ₹0.00 = ₹3,35,972.00
                           [ Verified & Completed ]   ← already done, disabled
```
⚠️ Two things do not line up on this card: the `Allowances Breakdown` figures are
structure + earned added together (see the headline section), and **`Other Earning: ₹0.00` in the
summary sits directly above `Monthly Incentive ₹80.00` in the Other Earnings card**.

**The Finalize control's exact words.** The button reads **`Verified & Completed`** (`btnVerified`).
Pressing it opens `#verificationConfirmModal`:
> **Confirm Verification** — *"Are you sure you want to verify and complete this salary process?"*
> `[Cancel]` `[Yes, Verify & Complete]`

**That is the whole confirmation** — no reason field, no second step, and there is no matching
"un-verify" control on this screen (the un-finalise route is the toggle on the board, §2).
Nothing here was pressed. A batch that is already verified shows the button greyed with class
`completed` and every step green.

**Other dialogs on this screen:** `Attendance Import` → `Error occured` textarea + `[Close]`
(`modal-Error`, `txtError`); `Data Preview`; `Congratulations!`; `Employee Details`.

---

## 5. Employee Wages Edit — `/Payroll/Employee_MstEdit.aspx?MenuId=74` *(live)*

**Where:** Payroll → Employee Wages Edit. **The page's own title is `Employee Master`**, not the
menu's name.
**Fields:** `Categorgy` *(sic — spelled that way on screen)* `CmbCategory` — **7 options, no "All":**
Category 1 … Category 7, **defaulting to Category 1**; `Company` `CmbCompany` — All · Company 1 ·
Company 2; `Division` `CmbDivision` — All · Division 1 … Division 9; `Department` `CmbDepartment` —
All + the 22 departments. **There is no Employee picker and no month.**
**Buttons:** `[Show]` (`BtnShow`) · `[Excel]` (`BtnExcel`).
**Grid:** `grdEmployee`. **Empty state: `No Records Found`** — and because Category defaults to
Category 1, **that is what the screen says the moment you open it**. This is a bulk structure editor
that opens looking like it has no data.

---

## 6. Attendance Import — `/Payroll/AttendanceSummaryImport.aspx` *(live)*

**Where:** Payroll → Attendance Import. Card **`Attendance Summary Import`**.
**Fields:** `Attendance Month` (`txtINCMonth`, month picker, empty on arrival); then a block
`Import Attendance` with `Choose file` (`exampleInputFile`), a `-----OR-----` divider, and a textarea
`Paste Data Here with Header` (`TxtCopyData`).
**Button:** `[Preview]` (`BtnImport`) — not pressed.
**Dialog:** `Attendance Import` → an **`Error occured`** textarea (`txtError`) + `[Close]` — the
screen's only feedback channel for a bad file.
**Empty state / realtime:** none.

---

## 7. Collect Attendance — `/Payroll/Attendance_Import.aspx` *(live)*

**Where:** Payroll → Collect Attendance. Card heading also reads **`Attendance Summary Import`** (the
same title as §6, a different screen).
**Fields:** `Attendance Month` (`txtAttendanceMonth`, **defaults to `Sep/2026`**); a collapsed
`Filter` panel holding `Employee` (`CmbEmployee`, **174 options** = `All` + EMP001…EMP173 as
`EMPnnn:Test n`), `Category` (`CmbCategory`, All + Category 1…7), and three checkbox trees each with
`Select All`: **Company** (Company 1, Company 2), **Division** (Division 1…9), **Department** (the 22).
**Button:** `[Import]` (`BtnCalculate`) — pulls attendance for the filtered people into the month.
Not pressed.

---

## 8. Attendance List — `/Payroll/Attendance_View.aspx?MenuId=75` *(live)*

**Where:** Payroll → Attendance List. Title `Attendance List`, then a collapsed **`Filter`** button.
**Filter fields:** `Att Month` (`txtAttMonth`, defaults `Sep/2026`), `Category` (All + 7), `Company`
(All + 2), `Division` (All + 9), `Department` (All + 22), and
**`Order By` (`CmbOrderBy`, 7 options): `EmpCode · EmployeeName · Department · Designation · DOJ ·
Division · Company`**. Plus a `Search` box, `[Show]` (`BtnShow`) and `[Excel Export]` (`BtnExcel`).
**Grid `grdAttendanceView` (17 columns):** `☐ | EmpCode | EmployeeName | P | A | WO | WOP | H | HP |
OD | PL | CL | COFF | SL | OT HRS | ML | Total` — plus an **`Actions`** column.
**⭐ Row action `Re-collect` (new; not in the old capture)** — present on some rows only. Live for
May/2026 it appeared on the seven rows at the top of the list (EMP117, EMP120, EMP122, EMP145,
EMP163, EMP147 — all `P 0 · A 27 · WO 4 · Total 4` — and EMP171 at `Total 31`) and on no others. It
re-pulls one person's attendance for the month.
Live sample: `EMP001 | 20 | 2 | 5 | 0 | 1 | 0 | 3 | 0 | 0 | 0 | 0 | 00:00 | 0 | 29`.

---

## 9. Wages Import List — `/Payroll/Import_List.aspx?MenuId=76` *(live)*

**Where:** Payroll → Wages Import List. Shows what was imported onto one money head in one month.
**Fields:** `Salary Month` (`txtSalaryMonth`, defaults `Sep/2026`); **`Heads` (`CmbHeads`) — the full
salary-head list, 43 options, defaulting to `BASIC`:**
```
BASIC · HRA · Conveyance · PF · Education · OTHERS · PERQUISITES · PRODUCTION · PT · TDS ·
HOME LOAN · BASICDA · VDA · Advance · Attendance Bonus · Other Deduction · OT · Monthly Incentive ·
Travel Allowance · ROOM RENT · MEDICAL · LTA · EXGRATIA · MEDICLAIM · Bonus · LOAN · Perf. Allow ·
FIX_INCENTIVE · WASHING_ALLOWANCE · Canteen · Salary Addition · Salary Deduction · Reimbursement ·
ESIC · LWF · Arrears · Late_Mark_Fine · Diciplinary_Fine · SpecialAllowence · WorkingHrs · EPF ·
WRD · WD
```
*(2026-08-16 listed 20 of these. **All 43 are above.** `Arrears`, `EPF`, `LWF`, `Late_Mark_Fine`,
`Diciplinary_Fine`, `WASHING_ALLOWANCE`, `Salary Addition`, `Salary Deduction`, `WRD`, `WD`,
`WorkingHrs`, `MEDICLAIM`, `EXGRATIA`, `LTA`, `MEDICAL`, `Perf. Allow`, `Attendance Bonus`,
`Reimbursement`, `ESIC`, `SpecialAllowence`, `FIX_INCENTIVE`, `Bonus`, `Canteen` were missing.)*
Plus a `Search` box, `[Show]` (`BtnShow`) and `[Excel Import]` (`BtnAdd`).
**Grid `grdWagesImport`:** `Emp Code | Employee Name | Company Name | Department Name | Amount`.
Live, May/2026 + head `BASICDA`: every employee is listed with a **blank `Amount`** — the screen
lists all employees whether or not anything was imported on that head.

---

## 10. Manual Attendance — `/Payroll/Manual_Attendance.aspx?MenuId=77` *(live)*

**Where:** Payroll → Manual Attendance. Two cards.
**Top card, `Manual Attendance Manage`** — type one attendance value for one person:
- `Transaction Month` — `TxtManageMonth`, empty.
- `Emp Name` — `DdlEmployee`, **173 options**, `EMP001:Test 1` … `EMP173:…`, first selected.
- **`Attendance Head` — `CmbHeadID`, 19 options, defaulting to `P`:**
  `P · A · H · OT HRS · PL · WO · WOP · HP · CL · OD · COFF · LTD · SL · LateBy · SHL · ExtraHRS ·
  DLD · SPL · ML` *(matches 2026-08-16 exactly)*
- `Totals` — `TxtTotals`, placeholder **`Enter Totals`**.
- `[Save]` (`BtnSave`) · `[Excel Import]` (`Button1`). Neither pressed.
**Bottom card, `Manual Attendance Search`:** `Att Month` (`txtAttMonth`, `Sep/2026`), a second head
picker (`cmbattendancehead`, the same 19), `Category` (All + 7), `Company` (All + 2), `Division`
(All + 9), `Department` (All + 22), a `Search` box, `[Show]` (`BtnShow`) and `[Excel Export]`
(`BtnExcel`).

---

## 11. Manual Wages — `/Payroll/Manual_Wages.aspx?MenuId=78` *(live)*

Identical shape to §10 for money instead of days. Cards `Manual Wages Manage` / `Manual Wages Search`.
`Transaction Month` · `Emp Name` (173) · **`CmbHeadID` — the same 43 heads**, defaulting to `BASIC`
· `Totals` (`Enter Totals`) · `[Save]`. Search half: `Att Month` `Sep/2026`, Category/Company/
Division/Department, `Search`, `[Show]`, `[Excel Export]`.
⚠️ **The head names differ between screens.** Here they are `HOME_LOAN` and `ROOM_RENT`; on Wages
Import List (§9) the same two read `HOME LOAN` and `ROOM RENT` (space, not underscore). Also
**Manual Wages has no `[Excel Import]` button** while Manual Attendance does — money can only be
typed one at a time here, or bulk-loaded from §9's `[Excel Import]`.

---

## 12. Salary calculation — `/Reports/Salary_Calculation.aspx?MenuId=30` *(live)*

**Where:** Payroll → Salary calculation. **This is the only place the divisor can be overridden.**
**What you see:** title `Salary Calculation`, then a **`Working Days`** link, a `Salary Month` field
(`txtCalculationMonth`, defaults `Sep/2026`), a collapsed `Filter`, then a progress bar reading
`0%` / **`Remaining time: calculating…`**.
**Filter panel:** `Employee` (`CmbEmployee`, 174 = All + 173), `Category` (All + 7), and Company /
Division / Department checkbox trees with `Select All`.
**Button:** `[Calculate]` (`BtnCalculate`) — runs the calculation. **Not pressed.**
**Dialog — `Error Occured`** (`modal-error`): a textarea + `[Close]`.
**⭐ Dialog — `Working days`** (`modal-workdays`) *(live)*: `Year` (`CmbYear`) = **`2026 · 2025 · 2024`**,
then a grid `Month | Working Days` where each Working Days cell is an editable text box:
```
January-2026   0        April-2026  0        August-2026  0
February-2026  0        May-2026    0
March-2026     0        June-2026   0
```
⚠️ **Only 7 months are listed for 2026 — July and September are missing entirely**, and **every
value is 0**. ⚠️ **The dialog's only buttons are `×` and `[Close]` — there is no Save.** So the one
screen that is supposed to let you override the divisor for a short month has editable cells, no
commit control, and no data in it. This is also why every batch header reads `Working Days: 0`.

---

## 13. Salary List — `/Payroll/Salary_View.aspx?MenuId=79` *(live)*

**Where:** Payroll → Salary List. **This is the payroll register** — the same 50 columns as the batch
runner's stage-4 grid, for a whole month across every batch.
**Filter (collapsed behind `Filter`):** `Salary Month` (`txtSalaryMonth`, defaults `Sep/2026`),
Category (All + 7), Company (All + 2), Division (All + 9), Department (All + 22),
`Order By` (`CmbOrderBy`) = `EmpCode · EmployeeName · Department · Designation · DOJ · Division ·
Company`, a `Search` box, `[Show]` and `[Excel Export]`.
**⭐ Top-of-page `Recalculate` button (new; not in the old capture)** — sits above the grid.
Not pressed.
**Grid `grdSalaryView`, all 50 headers, in order:**
```
☐ | EmpCode | EmployeeName | Company | Department | Designation
| P | A | WO | WOP | H | HP | OD | PL | CL | COFF | SL | OT HRS | ML | TotalDays
| BASIC | BASICDA | HRA | FIX_INCENTIVE | OTHERS | Monthly Incentive | SpecialAllowence | Gross
| EBASIC | EBASICDA | EHRA | EFIX_INCENTIVE | EOTHERS | EMonthly Incentive | ESpecialAllowence | EGross
| EOT | EReimbursement | EWD | EGrossOther | TotalEarning
| Bonus | LOAN | PF | Advance | Other Deduction | Canteen | ESIC | TotalDeduction | NetSalary
```
*(Note the header is `TotalEarning` here and `Total Earning` on the batch runner — same number,
two spellings.)*
**Live, May/2026 — 121 employees.** This grid is the source of the whole-month verification at the
top of this file. Sample rows:
```
EMP001 Test 1 Marketing GM Marketing  … TotalDays 29 · BASICDA 40260 · Gross 80520 ·
       EBASICDA 37663 · EGross 75326 · LOAN 5000 · PF 1800 · TotalDeduction 6800 · NetSalary 68526
EMP002 Test 2 Marketing Sr. Sales Exec … TotalDays 31 · Gross 49500 · EGross 49500 ·
       PF 1800 · TotalDeduction 1800 · NetSalary 47700
EMP005 Test 5 Production Operation Head … EBASICDA 44000 · EHRA 17600 · EFIX_INCENTIVE 10000 ·
       ESpecialAllowence 26400 · EGross 98000 · TotalDeduction 0 · NetSalary 98000
```
**Which deduction heads are actually in use, May/2026 (of 121 rows):** `PF` on nearly all ·
`ESIC` on 29 · `Advance` on 17 (₹2,500–₹15,000) · `LOAN` on 14 (₹5,000 each) · `Canteen` on 7
(₹323–₹2,529) · `Other Deduction` on 1 (₹5,000) · `Bonus` on 0.
**Where canteen deductions arrive:** imported at stage 2 *Manual Import → Canteen*, and they land on
the deduction head **`Canteen`** — which is also an editable cell on the payslip.

---

## 14. Salary Import — `/Payroll/Employee_WagesUpdate.aspx?MenuId=81` *(live)*

**Where:** Payroll → Salary Import. **The page's own title is `Employee Import`.**
**Fields:** **`Increment Month`** (`txtINCMonth`, empty) — *2026-08-16 recorded this label as
"INC Month"; the label printed on screen is `Increment Month`*; then `Import Wages` with
`Choose file` (`exampleInputFile`), `-----OR-----`, and a textarea `Paste Data Here with Header`
(`TxtCopyData`).
**Button:** `[Preview]` (`BtnImport`). Not pressed. This is how a new salary structure is loaded in
bulk.

---

## 15. Increment Initialize — `/Payroll/IncrementInitialize.aspx?MenuId=95` *(live)*

**Where:** Payroll → Increment Initialize.
**What you see:** title `Increment Initialize`, a `[New Increment]` button, a search box
*"Search by name, month"*, then a grid of increment batches.
**Grid `grdIncrementInit`:** `Name | Increment Month | Effective Month | Remark | Action`.
Live, one row: `Test 82 | Jul-2026 | Jul-2026 | (blank)` with `[View] [Proceed] [Cancel]`.
**⭐ Dialog — `Increment batch details`** (`modal-view-increment`) *(live)*:
```
INCREMENT NAME   Test 82
INCREMENT MONTH  Jul-2026
EFFECTIVE MONTH  Jul-2026
CREATED          10-Jul-2026 23:59
REMARK           —
Selected employees — "2 employees in this batch."
EMP CODE | EMPLOYEE NAME | LOCATION | COMPANY | DEPARTMENT | CATEGORY | STATUS | INCREMENT STATUS
EMP027   | Test 27       | Location 3 | Company 2 | Production       | Category 3 | Working | Pending
EMP156   | Test 156      | Location 5 | Company 2 | Production Pardi | Category 2 | Working | Pending
                                                                                          [Close]
```
**Dialog — `Increment`** (`modal-default`) *(markup; `[New Increment]` opens it, nothing saved)*:
subtitle *"Configure increment details and select employees"* with a live **`0 selected`** counter.
- `Increment Name` — `txtIncrementInitName`, placeholder `Enter Name`.
- `Increment Month` — `txtIncrementMonth`.
- **`Effective Month`** — `txtIncEffectiveMonth`.
- `Remark` — `txtIncrementInitRemark`, placeholder `Enter remark`.
- A **`Filters`** block, four multi-selects each with its own `Search` box and check-all:
  `Company` (All · Company 1 · Company 2) · `Category` (All · Category 1…7) ·
  `Department` (All + the 22) · `Division` (All · Division 1…9), then **`[Apply filters]`**.
- An employee grid `☐ | Empcode | Employee | Department | Designation | Category | Location` (live:
  EMP082, EMP158, EMP001, EMP002, EMP003, EMP004 …).
- **or** a textarea `Paste Empcode with Header to select in list…` (`TxtCopyData`) +
  **`[Select from pasted data]`**.
- `[Close]` · `[Save]` (`BtnSaveIncrementInit`).
**Row actions:** `[View]` (above) · **`[Proceed]`** — an `input type=submit` with no address, i.e. it
posts and applies the increment; **deliberately not pressed** · `[Cancel]` (`BtnCancel`,
"Cancel increment") with a bare confirm dialog (`modal-cancel`, `×` + `Close` only).

---

## 16. Arrears Calculation (the batch list) — `/Payroll/Arrears.aspx?MenuId=82` *(live)*

**Where:** Payroll → Arrears Calculation. Title **`Arrear`**.
Same shape as §15 — a grid `☐ | Name | Increment Month | Effective Month | Remark | Action`, live
row `Test 82 | Jul-2026 | Jul-2026`, and a search box *"Search by name, month"*.
**Row action `[Actions ▾]` (3 items):**
| Item | Where it goes |
|---|---|
| **View** | dialog **`Arrear batch details`** — `Batch name · Increment month · Effective month · Created · Remark · Selected employees` + `[Close]` |
| **Proceed** | **navigates to `/Payroll/Arrears_Calculation.aspx?IncInitID=1&MenuId=82`** — §17 |
| **Cancel** | `BtnCancel`, *"Cancel Arrear"*, with the bare confirm dialog |
**Dialog — `Increment`** (the create form, `modal-default`) *(markup)*: `Filter` (Company / Category
/ Department multi-selects), `Increment Name`, `Increment Month`, `Effective Month`, `Remark`
(a textarea here), the employee grid, the paste box + `[Select from pasted data]` (`BtnCheck`),
`[Save]` (`BtnSaveIncrementInit`), `[Cancel Arrear]` (`BtnCancel`).
**Why the module exists:** `Effective Month` can be *earlier* than `Increment Month`, so the
difference for the months already paid is paid out as **arrears in the current month** — a closed
month is never edited. That model is confirmed by the screen below.

---

## 17. ⭐ Arrear calculation — `/Payroll/Arrears_Calculation.aspx?IncInitID=…&MenuId=82` *(live — NEW, missing from the 2026-08-16 capture)*

**Where:** Payroll → Arrears Calculation → Actions ▾ → **Proceed**.
**What you see:** title `Arrear calculation`, a card **`Employees in this batch`**, three buttons
`[Excel]` (`btnExportExcel`) · `[PDF]` (`btnExportPdf`) · **`[Bulk Settlement]`**
(`btnBulkSettlement`), a search box *"Search by emp code or name…"*, then the grid.
**⭐ Grid `grdEmployees`, 15 columns — the before/after pairing is the whole arrears model:**
```
☐ | Emp code | Employee name | Company | Department
| Gross | Allowance | Deduction | Net pay                                  ← what the month already paid
| Arrear gross | Arrear allowance | Arrear deduction | Arrear net pay      ← the difference now owed
| Status | Action
```
Live rows (batch `Test 82`, Jul-2026): `EMP027 Test 27 Company 2 Production 0.00 0.00 0.00 0.00 |
0.00 0.00 0.00 0.00 | **pending**` and `EMP156 Test 156 Company 2 Production Pardi 0.00 … pending`.
**Row action:** `[Settlement]` (per row) — plus `[Bulk Settlement]` for the whole batch. Neither
pressed. `Status` reads **`pending`** until settled.
**Which head arrears land on:** the salary-head list carries a dedicated **`Arrears`** head (§9), so
an arrear is paid as its own line, not by editing the original month.

---

## 18. ⭐ Payroll Voucher — `/Payroll/PayRoll_Voucher.aspx?MenuId=98` *(live)*

**Where:** Payroll → Payroll Voucher. **This is the per-employee payslip and the one place a
calculated figure can be typed over.**

**What you see on arrival:** a `>` button (`returnTreeview`) opens a left slide-out panel
**`PayRoll Voucher`** holding a `Search here…` box, a `[Filter]` button and the tree
**`Location → Company → Division → Department → Employee`** (top level: `Location 1`, `Location 2`).
Across the top: `◀`/`▶` **month steppers** (`MonthPrev` / `MonthNext`) around a month field
(`txtAttendanceMonth1`) that **defaults to `Sep-2026`**, `[Previous Employee]` (`BtnPrev`) /
`[Next Employee]` (`BtnNext`), a clickable header label (`LblEmployeeDtail`, reads `DeviceCode`
before an employee is picked) and `[Recalculate]` (`BtnRecalculate`).
Bottom bar: the legend **"Editable Fields: Double-click on highlighted fields to edit → Press Enter
to save → Press Esc to cancel"**, plus `Leave Hide` (`ChkLeave`) and `Loan Hide` (`ChkLoan`)
checkboxes, both unticked.

**On arrival with nothing selected it shows `No Salary Record Found`.**

**The slip, block by block** (all live, EMP065 / May-2026 unless noted):

| Block | Contents |
|---|---|
| Header | `EMP065 - Test 65` · **`Salary Slip for Month of May-2026`** · `Company 2` |
| `Employee Information` (`employee-info-table`) | `Location:` Location 5 · `Emp Code:` EMP065 · `Company:` Company 2 · `Emp Name:` Test 65 · `Designation:` Plant Head · `Emp UAN:` (blank) · `Bank A/c No:` (blank) · `Bank Name:` (blank / `Bank 9` for EMP001) · `PAN:` (blank) · `Aadhar No:` (blank) · `Date of joining:` 01-Dec-2024 · `Department:` Production Pardi |
| Leave block | `LEAVE NAME \| OPENING \| CREDIT \| DEBIT \| ENCASH \| BALANCE` → **`No leave data available`** |
| Loan block | `LOAN NAME \| NEW LOAN \| INSTALLMENT \| INTEREST \| BALANCE` → EMP065 `- \| 0 \| 0 \| 0 \| 0`; EMP001 `PERSONALE LOAN \| 0 \| 5000 \| 0 \| 70000` |
| `Attendance` | `ATTENDANCE \| VALUE` — only the heads that apply: EMP065 `P 26 · WO 4 · H 1`; EMP148 `P 15.5 · A 11.5 · WO 4`; EMP001 `P 20 · A 2 · WO 5 · H 1 · OD 3` |
| `Fixed & Earnings` | two side-by-side tables: **`FIXED \| VALUE`** (the structure) and **`EARNINGS \| VALUE`** (what was earned). Head list varies per employee — EMP065: BASICDA, HRA, FIX_INCENTIVE, OTHERS, Monthly Incentive, SpecialAllowence, Reimbursement, WD; EMP148 adds **OT** |
| `Fixed Deduction & Deduction` | **`FIXED DEDUCTION \| VALUE`** and **`DEDUCTION \| VALUE`**. EMP065: LOAN, PF, Advance, Other Deduction, Canteen / PF, Advance, Canteen. EMP148 adds **Bonus** and **ESIC** to both |
| Summary strip | `TotalDays \| TotalFixed \| TotalEarnings \| TotalDeductions` |
| Net line | **`Net Salary :- ₹ <amount>`** |

**Which cells are editable, exactly.** Only the **EARNINGS** and **DEDUCTION** columns, and only
some heads inside them. On EMP065/May-2026 the editable cells are `EARNINGS → OTHERS · Monthly
Incentive · Reimbursement` and `DEDUCTION → Advance · Canteen`. Their wrappers carry
`editable-field-wrapper locked` — **because May-2026 is a locked month, they render with a padlock
instead of a double-click target.** The structure columns (`FIXED`, `FIXED DEDUCTION`) and the
computed heads (BASICDA, HRA, SpecialAllowence, PF, LOAN, ESIC) are never editable here.

**Print / email controls on this screen: there are none.** Searched every button, link and icon —
no print, no PDF, no download, no mail. The slip is printed from `Reports → Pay Slip`
(`/Reports/Pay_Slip.aspx`, with `Report Type {With Balance | Without Balance | Custom}`) and mailed
from `Payroll → Email Salary Slip` (§19). *2026-08-16 did not say this either way; worth stating
plainly because it is the first thing you look for on a payslip screen.*

**⭐ Every dialog reachable from the voucher (14 — the old capture listed none of these).** The
voucher doubles as the attendance-correction desk: clicking a day or the header label opens one of
these. Each has `[Close]` and a `[Save]`, and **none was saved.**

| Dialog | Fields |
|---|---|
| `Employee Details` (`employeeModal`) | `Basic Information` — Gender · Status · Joining Date · Category · Shift Group · Weekly Off · Weeklyoff 2 · OT Applicable, with *"Click Category or Shift Group for details"* |
| `Apply Leave` (`modal-leave`) | `Employee Name` (173) · `Leave Status` · `Leave Type` · `From Date` (`txtEntryFromDate`) · `To Date` (`txtEntryTodate`) · `Remark` (`Enter Remark`) · `[Save]` |
| `COFF Generate` (`modal-default2`) | **`COFF Status` = `FullDay · HalfDay`** · `WOP Date` (`txtWOPDate`) · `Remark` · `[Save]` |
| `Manual Log Entry` (`modal-punch`) | `Employee Name` (173) · `Log Date` (`txtLogDate`) · radio **`Check In` / `Check Out`** · `Remark` (`Enter Remark Here`) · `[Save]` |
| `DeviceCode` / shift change (`modal-shiftchange`) | **`Shift` = `GS · NS · DS · NIS · GS1 · GS2 · GSH · GS19T · GS9T · NGS · PGSH`** (11) · `[Save]` |
| `Official Gatepass Entry` (`modal-gatepass`) | `Employee Name` (173) · `Gate Out` (`txtGateOut`) · `Gate In` (`txtGateIn`) · `Duration` (number, `Enter Here`) · `Approved Duration` (number) · `Remark` · `[Save]` |
| `OD Entry` (`modal-odentry`) | `Employee Name` (173) · **`OD Status` = `FullDay · HalfDay`** · `OD Date` · `OT Mins` (number) · `Extra Works` (number) · `Remark` · `[Save]` |
| `OT Saction` *(sic)* (`modal-otcutoff`) | `Employee Name` (173) · `OT Date` · `OT Minutes` (number) · `OT HRs` (`Enter Here`) · `[Save]` |
| `COFF Cutoff` (`modal-coffcutoff`) | `Employee Name` (173) · `[Save]` (`BtnCOFFCutoff`) |
| `OT Sanction` (`modal-otsanction`) | `Employee Name` (173) · `[Save]` (`BtnOTSanction`) |
| `Apply Leave` — hourly (`modal-hourlyleave`) | `Employee Name` (173) · `CmbHourlyLeaveStatus` · `CmbHourlyLeavetype` · `[Save]` (`BtnSaveHourlyLeave`) |
| `Settings` (`modal-OrderBy`) | **`OrderBY` = `Emp Code · Emp Name`** · `[Close]` |
| `COFF Gen Status` | `cmbCOFFGenStatus` = `FullDay · HalfDay` |
| (empty state) | `No Salary Record Found` |

**⚠️ A month with no calculation prints a negative net.** EMP065 at **Sep-2026** (the default month):
Attendance shows a single `—`, the whole `EARNINGS` column is blank, `TotalEarnings 0`, but
`FIXED DEDUCTION → PF 1` still counts, so `TotalDeductions 1801` and the slip reads
**`Net Salary :- ₹ -1,801.00`** — rendered in green, with nothing on the screen objecting.
Confirmed again on a second employee and a different month from the 2026-08-16 report.

**✅ One 2026-08-16 fault is fixed.** That report saw the header read *"Salary Slip for Month of
Aug-2026"* while the picker read *May-2026*. Today the header and the picker agree at every step
(Sep → Aug → Jul → Jun → May, checked one by one). The old negative-net slip was Aug-2026 data
under a May-2026 label; the label bug is gone, the negative net remains.

**⚠️ EMP001's loan balance moved:** 2026-08-16 recorded `PERSONALE LOAN | 0 | 5000 | 0 | 60500`;
today the same slip reads `… | 5000 | 0 | 70000`. Live demo data, not a fault — noted so the number
is not quoted as fixed.

---

## 19. Email Salary Slip — `/Payroll/Email_Salary_Slip.aspx?MenuId=117` *(live)*

**Where:** Payroll → Email Salary Slip. A pausable, resumable bulk mailer with per-person status.
**Filters card** (behind `btnToggleFilterCard`):
- `Salary Month` — `txtSalaryMonth`, defaults `Sep/2026`.
- `Company` — `[All Companies]` button opening a checkbox list: All Companies · Company 1 · Company 2.
- `Department` — `[All Departments]`, **22 options** listed alphabetically here (Accounts · Admin ·
  Consumables Store · Default · Dispatch · House Keeping · HR · IT · Loading · Maintenance ·
  Marketing · Packing · Production · Production Pardi · Purchase · QC · QC PARDI · RM & Con Store ·
  RM Store · Safety · STORE) — note the ordering differs from every other screen.
- `Category` — `[All Categories]` + Category 1…7.
- `Division` — `[All Divisions]` + Division 1…9.
- **`Payslip Type` — `Custom` (default, value 3) · `With Balance` (1) · `Without Balance` (2)**,
  with a 👁 preview button (`BtnPreview`) beside it.
- **`Email Status` — `All` (default) · `Pending` · `Success`.**
- **`Rows / page` — `20` (default) · 40 · 60 · 80 · 100 · 200 · 500 · 1000.**
**Buttons:** `[Apply & Load]` (`BtnLoadEmployees`) · `[Send Mail (Immediate)]` (`BtnSendMail`,
hidden until a row is selected) · **`[Send Mail All]`** (`btnSendMail`) · **`[Pause All]`**
(`btnPauseAll`) · **`[Stop All]`** (`btnStopAll`). **None of the four send/pause/stop buttons was
pressed.**
**Grid `gvEmployees` (live, May/2026 loaded):** `☐ | EMP CODE | EMPLOYEE NAME | COMPANY | DEPARTMENT
| CATEGORY | EMAIL | STATUS | ACTION` with a **per-row `Send mail` button** and a per-row `STATUS`.
Live rows: `EMP001 · Test 1 · Company 2 · Marketing · Category 4 · info@hrmex.in · **Pending**`,
`EMP002 · test2@mail.com · Pending`, `EMP003 · test3@mail.com · Pending` … Pager `1 2 3 4 5 6 7`
at 20 per page (≈ 121–140 people).
**⚠️ The 👁 payslip preview is broken.** It opens `…Email_Salary_Slip.aspx?preview=1&month=May%2F2026
&payslipTypeId=<n>` in a new tab and returns **HTTP 500 — "Server Error / 500 - Internal server
error."** for **all three** payslip types (checked `payslipTypeId=1`, `2` and `3`). So there is no
way to see what will be emailed before emailing it.

---

## Lock and Finalize — the complete picture, in the product's own words

| Question | Answer from the screens |
|---|---|
| Where do they live? | `Payroll → Salary Process`, two switch columns on the grid, **per Month × Company** |
| What does Lock claim to do? | greyed: *"Lock can only be enabled when all employees' salaries are verified"* · live: *"Click to lock/unlock this payroll month"* |
| What does Finalize claim to do? | greyed: *"Finalization can only be enabled when all employees' salaries are verified"* · live: *"Click to unmark this payroll month as final"* |
| What must happen first? | `Salary Verified` must equal `Employee Count` for that month × company — the switch is disabled until then and says so |
| What does an already-finalised month show? | switch ON, tooltip offering to **unmark** it, and on the Payroll Voucher its editable cells render **padlocked** |
| Is there a confirmation? | **No.** The switch acts on click. No dialog, no reason box, no second step anywhere on the screen |
| And the batch-level equivalent? | stage 5's `[Verified & Completed]` → `Confirm Verification` — *"Are you sure you want to verify and complete this salary process?"* `[Cancel]` `[Yes, Verify & Complete]` |
| Anything mirrored elsewhere? | `Utility → Payroll Month` lists `Salary Month Name \| IsLock \| IsFinal` — that screen belongs to another terminal's scope and was not opened here |

---

## Where each thing lands — the head map

| Where it is entered | Screen | Salary head it lands on |
|---|---|---|
| Monthly incentive | batch stage 2 → *Monthly Incentive* block | **`EMonthly Incentive`** (verified: EMP148 ₹80) |
| Advance | batch stage 2 → *Advance* block, or Manual Wages | **`Advance`** (deduction; 17 people in May/2026) |
| Canteen | batch stage 2 → *Canteen* block | **`Canteen`** (deduction; 7 people, ₹323–₹2,529) |
| Anything else earned | batch stage 2 → *OTHERS* / *Reimbursement* | **`EOTHERS`** / **`EReimbursement`** — and `EReimbursement` is **outside** `EGross` |
| Loan instalment | Loan & Advance master, pulled at stage 3 | **`LOAN`** (deduction; EMP001 ₹5,000, balance ₹70,000 on the slip) |
| Arrears | Arrears Calculation → Settlement | the dedicated **`Arrears`** head |
| Increment | Increment Initialize → Proceed | rewrites the structure heads (`BASICDA`, `HRA`, …) from `Effective Month` |
| Bulk structure change | Salary Import (`Employee_WagesUpdate`) | any of the 43 heads, from a file or paste |
| One value for one person | Manual Wages (money) / Manual Attendance (days) | any of the 43 money heads / the 19 day heads |
| PF / ESIC | computed | **`PF`**, **`ESIC`** (deductions; ESIC on 29 of 121) |
| Bank file / NEFT | **not in the Payroll menu** | `Reports → ICICI / HDFC / SUDICO / BANK Statement`, each with an *Attendance Month* **and** a separate *Payment Month*, `Cheque NO` and `BANK ACC NO`. Out of this scope — captured by the Reports terminal |

---

## Corrections to the 2026-08-16 capture

1. **The count is 18 screens, not 17.** `Arrears.aspx` is only the arrear *batch list*; its
   **Proceed** opens a separate screen, **`/Payroll/Arrears_Calculation.aspx?IncInitID=…`**, with the
   before/after grid `Gross · Allowance · Deduction · Net pay` / `Arrear gross · Arrear allowance ·
   Arrear deduction · Arrear net pay` + `Status` + `[Settlement]` / `[Bulk Settlement]` /
   `[Excel]` / `[PDF]`. Never captured before.
2. **⭐ The Finalization card's "Allowances Breakdown" is not "the full structure".** The old note
   read `BASICDA ₹3,92,540` as the structure figure. It is **structure + earned added together**
   (215,755 + 176,785 = 392,540; same for HRA and SpecialAllowence). Only that card's
   `Earned Gross` line is a payable number.
3. **⭐ The payslip's net is not the register's net.** The register's `TotalDeduction` uses only the
   earned DEDUCTION column; the payslip's `TotalDeductions` adds the FIXED DEDUCTION column too.
   Verified on three employees in one month (₹1, ₹2, ₹1 apart). The old capture recorded the slip's
   `TotalDeductions 6801` without noticing it disagrees with `Salary List`'s `6800`.
4. **⭐ Lock and Finalize DO have a stated precondition.** The old study concluded the lock is
   "advisory, not enforced" with the UI inviting you to break it. Half of that is now visibly wrong:
   on the board both switches are **disabled** whenever `Salary Verified < Employee Count`, and the
   tooltip says *"…can only be enabled when all employees' salaries are verified"*. What the old
   study got right is the other half — **a month that IS final can be un-marked from that switch in
   one click, with no confirmation and no reason field.**
5. **The board's last two grid headers read `Create` and `View`**, not `[+ New Batch]` and
   `[⚙ Process Batches]`. Those are the buttons *inside* those columns. And `Create`/`View` are
   `rowspan=2` — **one pair per month, not per company** — while Lock/Finalization are per company.
6. **The New Batch dialog's month field is labelled `Salary Month`**, not "Calculation Month"
   (`txtCalculationMonth` is only the control's internal name).
7. **Batch Details' `[Actions ▾]` has four items, not two:** `Batch Emp List · **Revise** ·
   View Batch · **Delete**`.
8. **The salary-head list is 43 heads, not 20.** Full list in §9. The 23 the old doc missed include
   `Arrears`, `ESIC`, `EPF`, `LWF`, `Bonus`, `Canteen`, `Reimbursement`, `SpecialAllowence`,
   `FIX_INCENTIVE`, `WASHING_ALLOWANCE`, `Late_Mark_Fine`, `Diciplinary_Fine`, `Salary Addition`,
   `Salary Deduction`, `WD`, `WRD`, `WorkingHrs`, `MEDICLAIM`, `EXGRATIA`, `LTA`, `MEDICAL`,
   `Perf. Allow`, `Attendance Bonus`.
9. **`Salary List` now has a top-of-page `Recalculate` button** — not in the old capture.
10. **`Attendance List` now has a per-row `Re-collect` action** — not in the old capture.
11. **The Payroll Voucher's `Recalculate` is joined by 14 dialogs the old capture never listed** —
    Apply Leave, COFF Generate, Manual Log Entry, Shift Change, Official Gatepass Entry, OD Entry,
    OT Saction, COFF Cutoff, OT Sanction, hourly Apply Leave, Employee Details, Settings/OrderBY,
    plus the `No Salary Record Found` empty state. The voucher is an attendance-correction desk as
    well as a payslip.
12. **The Payroll Voucher has no print or email control at all.** Printing is `Reports → Pay Slip`;
    mailing is `Payroll → Email Salary Slip`.
13. **✅ Fixed since 2026-08-16:** the voucher's header no longer disagrees with its month picker
    (checked across four month steps). **Still true:** an uncalculated month prints a negative net
    (₹ -1,801.00 for EMP065/Sep-2026), in green, unblocked.
14. **`Employee Wages Edit`'s page title is `Employee Master`, its Category dropdown has no "All"
    and defaults to Category 1**, so the screen opens on `No Records Found`. Also the label is
    misspelled **`Categorgy`**.
15. **`Salary Import`'s label is `Increment Month`** (old doc: "INC Month"), and its page title is
    `Employee Import`.
16. **Head names differ between screens:** `HOME_LOAN`/`ROOM_RENT` on Manual Wages vs
    `HOME LOAN`/`ROOM RENT` on Wages Import List. `Total Earning` (batch runner) vs `TotalEarning`
    (Salary List).
17. **`Sep/2026` has been added to the month strip** (17 chips now; the old capture began at
    Aug/2026). `May/2026` Company 2 is unchanged at 124 / 13 / 121 / 124 — verified.
18. **EMP001's loan balance is now ₹70,000** (was ₹60,500) — live data moving, recorded so the
    figure isn't quoted as fixed.

---

## Odd things I noticed

- **`Finilization`** is misspelled on the stepper; **`OT Saction`** on a voucher dialog;
  **`Categorgy`** on Employee Wages Edit; **`Diciplinary_Fine`** and **`PERSONALE LOAN`** in the
  data. Batch names carry their own typos (`ALL PF SATFF & HOD PARDI`).
- **Five payroll screens answer an error page when opened by address alone** —
  `Employee_MstEdit`, `Attendance_View`, `Salary_View`, `IncrementInitialize`, `Arrears` all returned
  a friendly *"Well, this is awkward… / Object reference not set to an instance of an object"* page
  with a reference code. **Adding the menu's own `?MenuId=<n>` makes all five work.** They are not
  broken — they read page state out of the menu id. For a rebuild: don't hang a screen's state off a
  menu row's number.
- **`Month Days` is 31 on every batch in every month**, including February-2026.
  `Working Days`/`Weekly Offs`/`Holidays` are 0 everywhere, and the one screen that could set
  Working Days (§12) has **no Save button** and lists **only 7 months for 2026** (July and September
  absent), all zero.
- **The `Mandatory` badge and the tooltip contradict each other** on every stage-2 manual-import
  block: the badge says Mandatory, the file picker says *"File upload is now optional"*.
- **`Zero Days In Total` reads 0 while EMP151 is paid ₹0** (P 0 · A 27 · WO 4 → Total 4). The counter
  watches the day-total, not the money.
- **Half-days are rounded up between screens:** EMP102 is `P 22.5 / CL 0.5` on the attendance grid
  and `P 23 / CL 1` on the calculation grid; EMP148 is `Total 19.5` vs `TotalDays 20`.
- **The 👁 payslip preview returns HTTP 500** for all three payslip types.
- **`[Export Results]` sits next to `[Export Results (Old)]`** on stage 4 — two exports, one marked
  as the previous version, both live.
- **A resigned employee (EMP101, status `Resign`) sits inside a live batch** and is paid through it.
- **Aug/2026 and Jun/2026 show 121 and 0 `Salary Calculated` with zero batches existing** — so pay
  has been calculated outside any batch, from `Reports → Salary calculation`.
- **`Payroll Batch Details`' empty state is genuinely empty** — heading `Payroll Batches` and no
  table, no headers, no message.

---

## In human language — every feature in this area, as points

- **The payroll control board** — one screen listing every pay month you have ever run, one line per
  month per company, showing how many people are in it, how many still need putting into a group,
  how many have had their pay worked out, and how many have been checked. Payroll → Salary Process.
  It is the place you stand to see whether this month's pay is ready.
- **Adding a new pay month** — a small box where you pick a month and year and it appears on the
  board. Without it, the month doesn't exist and nothing can be paid for it.
- **Splitting the staff into pay groups** — instead of paying 124 people in one go, you make named
  groups ("all provident-fund staff at the Pardi site", "all non-PF workers at Sarigam") by ticking
  category, company, division and department. You pay one group at a time. It is how a real factory
  works: the office and the shop floor are paid on different rules.
- **Seeing who is in a group before you pay them** — a list of every person the group caught, with
  their code, name, site, department and whether they are still working or have resigned, plus a
  count of how many companies and departments got pulled in. It stops the classic mistake of paying
  a group you built with the wrong tick.
- **Editing or deleting a pay group** — you can re-pick the people in a group, or throw the group
  away, from the same menu you use to open it.
- **The five-step pay run** — every group walks the same five steps in the same order: bring in the
  attendance, load the things typed in by hand, pull in loan instalments, work out the pay, then
  check and sign it off. The screen shows all five as a row of numbered steps and greys out the ones
  already done, so you can never lose your place.
- **Step 1: bringing in the attendance** — pulls each person's days for the month from the punch
  machines, or takes a spreadsheet or a pasted block of data if you keep attendance elsewhere. It
  then shows a table of everybody: days present, absent, weekly off, holiday, on-duty, and each kind
  of leave, with a total. Hovering a total tells you the sum it used, and clicking a person opens
  their day-by-day card on the right.
- **Step 2: the things somebody has to type in** — five separate baskets: advance taken, canteen
  bill, monthly incentive, "others", and expense reimbursement. Each basket takes a spreadsheet or a
  pasted list, shows you a preview and a running total before you accept it, and has a link to the
  file layout it expects. It is the honest answer to "some numbers just don't come from a machine".
- **Step 3: loan instalments** — pulls in this month's instalment for anyone repaying a loan. When
  there is nothing to pull it says so in plain words and suggests why, instead of showing an empty
  box.
- **Step 4: working out the pay** — one button, a progress bar and a time estimate, then a very wide
  table with every number for every person: their days, their agreed salary, what they actually
  earned, and every deduction. You can search it, tick rows, and export it to a spreadsheet.
- **Step 5: checking and signing off** — five summary cards: the totals for the group, the breakdown
  by pay item, the extras, the deductions, any outstanding obligations, and what the whole thing
  costs the company. Then one button that asks "are you sure you want to verify and complete this
  salary process?" before it locks the group as done.
- **Two amounts for every pay item** — the single most important idea in the whole product. For each
  thing you pay (basic, house rent, special allowance…) the system keeps *what the contract says*
  and *what this month's attendance actually earned*, side by side. The take-home pay is built from
  the earned side only. It is why somebody who was away for a fortnight is paid correctly without
  anybody editing their salary.
- **The payslip** — one person, one month, on one page: who they are and where they work, their
  leave balances, their loan balance, their days, their agreed pay against their earned pay, their
  deductions, and the net figure. Payroll → Payroll Voucher, then pick the person from the tree on
  the left and step the month with the arrows.
- **Correcting one number on a payslip** — a handful of cells (the incentive, the "others", the
  reimbursement, the advance, the canteen) can be corrected by double-clicking them, typing and
  pressing Enter. It saves a whole re-run for a single wrong figure.
- **Freezing a month so nobody can change it** — a switch per month per company. Once it is on, the
  correctable cells on the payslip show a padlock instead. It only becomes available after everybody
  in that month has been checked.
- **Marking a month as final** — a second switch beside the first. Same rule: it stays unavailable
  until everyone is checked. Worth knowing: a month already marked final can be un-marked with one
  click, and the screen asks nothing before doing it.
- **Hiding the leave or loan block on a slip** — two tick boxes, for when you don't want those
  sections printed for a particular person.
- **Recalculating one person** — a button on the payslip that redoes just that person's pay, for when
  you have fixed their attendance and don't want to re-run the whole group.
- **Fixing attendance from inside the payslip** — the payslip doubles as the correction desk: apply
  a leave, generate a comp-off, add a missing punch, change somebody's shift, record an official
  gate pass, record an on-duty day, sanction overtime, or apply an hourly leave. All of them from
  the same screen where you spotted the wrong number.
- **Seeing one person's basic details** — a small card on the payslip: gender, working status,
  joining date, category, shift group, weekly off days, and whether they are entitled to overtime.
- **Typing one attendance value for one person** — pick the month, the person and the kind of day
  (present, absent, holiday, overtime hours, privilege/casual/sick leave, comp-off, and eleven
  more), type the number, save. There are nineteen kinds of day.
- **Typing one money value for one person** — the same thing for money, across forty-three pay
  items. Used for the one-off that no import covers.
- **Loading attendance in bulk from a spreadsheet** — pick a month, drop a file in or paste the rows,
  preview it. Used by companies whose attendance lives in another system.
- **Loading a whole new salary structure from a spreadsheet** — the same idea for pay: pick the month
  the change starts, drop the file in, preview. This is how you apply an across-the-board revision
  without opening 124 employee records.
- **Loading amounts onto one pay item in bulk** — pick a month and a pay item, and see or import the
  amount for every person on that one item. The cleanest way to load, say, everybody's canteen bill.
- **Bulk-editing salary structures on screen** — filter by category, company, division or department
  and edit the pay setup for everyone the filter catches. Note it opens showing nothing until you
  change the category it starts on.
- **The month's attendance register** — one screen listing every person's days for a month, sortable
  by code, name, department, designation, joining date, division or company, exportable to a
  spreadsheet, with a per-person "re-collect" for anyone whose attendance came in wrong.
- **The month's pay register** — the same idea for money: every person, every pay item, agreed and
  earned side by side, every deduction and the net, exportable. This is the sheet an accountant
  actually wants.
- **Running the pay calculation for a filtered set of people** — outside the five-step flow, you can
  calculate pay for a month for a chosen company, division, department, category or single person.
  Useful for the person who joined late and got missed.
- **Setting the working days for a short month** — a small table of the months of a year with a
  working-days figure against each, meant for the month where the normal divisor would be wrong.
  Be aware it currently holds nothing and offers no way to save what you type.
- **Giving people a raise, as a batch** — name an increment, say which month it belongs to and which
  month it takes effect from, pick the people by filter or by pasting a list of codes, add a note,
  and save it as a batch that is applied in one go. Each person shows as "pending" until it is.
- **Reviewing a raise batch before applying it** — a card showing the increment's name, its month,
  its effective month, when it was created, the note, and the exact list of people in it with their
  current status.
- **Back-paying a raise that started in the past** — because the effective month can be earlier than
  the increment month, the months already paid are short. Rather than reopening a closed month, the
  difference is paid as arrears in the current month. This is the right shape and worth copying.
- **The arrears working screen** — for each person in the batch it shows what the month already paid
  (gross, allowance, deduction, net) beside what is still owed (arrear gross, arrear allowance,
  arrear deduction, arrear net), with a status, a settle button per person and a settle-everybody
  button, plus spreadsheet and PDF exports.
- **Emailing payslips to everybody** — pick a month, narrow it by company, department, category or
  division, choose which kind of payslip to send, then load the list. Every person shows their email
  address and whether their slip has been sent. You can send one person's, send them all, pause the
  whole run, or stop it. You can also list only the ones still pending, which is how you resume
  after a pause. The 20-to-1000-per-page setting is there for the same reason.
- **A per-person send button and a per-person status** — the reason this feature is worth copying:
  when a bulk send half-fails, you can see exactly who missed out and re-send only them, instead of
  mailing everyone twice.
- **Preview a payslip before mailing it** — the button exists beside the payslip-type picker. It is
  currently not working on this demo.
- **Splitting the group summary by company and by category** — on the pay-run screen the "companies"
  and "categories" counts are clickable and open a small breakdown of how many people fall in each.
  A sanity check that the group you built is the group you meant.
- **A permanent "who would be paid nothing" and "who has missing punches" strip** — always visible
  at the bottom of the pay run, so the two things that most often go wrong are never more than a
  glance away. Worth copying; worth making it count the money, not just the days.
- **Exporting almost everything** — nearly every list on these screens has a spreadsheet button, and
  the arrears screen also has a PDF. Payroll people live in spreadsheets and the product accepts it.

---

```
H19 — Payroll — DONE
Screens captured: 18 / expected 17   (all 18 opened live; the extra one,
  Arrears_Calculation.aspx, was undocumented before today)
Dialogs recorded: 29 — of which 3 were clicked open (Batch Employee Preview, Increment batch
  details, the Payroll Voucher employee tree) and 26 were read out of the page's own markup
  rather than opened, because their opener posts or writes. Each is marked in the text.
Dropdowns fully listed: 25 (every option written out). Six more are recorded by pattern and
  count, not name: the 173-employee pickers on the Voucher, Collect Attendance, Salary
  calculation, Manual Attendance, Manual Wages and the Increment employee grid — all are the
  same "EMPnnn:Test n" list of every employee.
File: docs/capture/H19-payroll.md
Payslips verified with arithmetic written out: 3 (EMP065, EMP148, EMP001 — all May-2026)
Whole-month arithmetic verified by machine: 121 employees, 3 relationships, 0 exceptions
Could not reach:
  · No batch anywhere in the demo had an unfinished stepper (checked May/2026, Feb/2026,
    Dec/2025, Oct/2025; Aug/2026 and Jun/2026 have no batches at all), so stages 1-4 are
    described from their own markup, tooltips and live grids, not from a running pay run.
  · The payslip preview on Email Salary Slip answers HTTP 500 for all three payslip types,
    so the emailed payslip's own layout was not seen.
  · Utility → Payroll Month (the mirror of the Lock/Final flags) is another terminal's scope
    and was deliberately not opened.
Nothing was run, saved, sent, uploaded, locked, finalised or deleted.
Browser closed: yes
```
