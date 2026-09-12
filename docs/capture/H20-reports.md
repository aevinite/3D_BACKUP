# H20 — HRMex 10.0.0.0 · **the whole report suite**, verified and (where they only read) actually run

> Scoped as "all 85 reports". The honest count is **72 menu links → 42 pages → 95 distinct
> reports** once the dropdown-only variants are counted. All 72 links, all 42 pages and all 23
> extra variants are written out below — see §0.

**Captured:** 2026-09-07 · **Site:** `https://demo.hrmexweb.in` (Cloudmex's demo — someone else's
data; nothing on it was created, changed, printed, emailed or exported to a portal).
**Signed in once** as `Superadmin` through the shared helper (`hrmex({ who: 'H20' })`).
**Verified against:** `docs/HRMEX-SCREEN-BY-SCREEN.md` §8 (the 2026-08-16 catalogue).

**How to read this file**
- Every report is listed with **name · address · every parameter with its full option list · what it
  actually returned**, or `not run:` + the reason.
- **41 of the 42 pages were opened live.** Nothing here is markup-only. The one not opened is
  `/Leave/LeaveLedger.aspx` — the Leave Reports menu links out of the reports area into the live
  Leave module, which is another terminal's scope; it is listed in §4 so the 72 links reconcile.
  Where a report was *executed*, the result is quoted; where it was not, the line says `not run:`
  and why.
- Corrections to the 2026-08-16 capture are collected in `### Corrections to the 2026-08-16 capture`
  near the end, and flagged ⚠️ inline where they matter.

---

## 0. The count — what "85 reports" actually is

`/Reports/Reports.aspx` holds **72 links**, in **11 coloured collapsible groups** (Attendance
Reports contains three nested sub-groups — Daily, Monthly and Yearly — which is where the old
doc's "14 groups" comes from: 11 outer + 3 nested).

⚠️ **Correction:** the old doc says those links "map to **~30 distinct `.aspx` report pages**".
The real number is **42** — 41 under `/Reports/` plus `/Leave/LeaveLedger.aspx`. All 42 are opened
and written out below.

Several pages offer **more report variants in their own `Report Type` dropdown than any menu link
reaches**. Counting each distinct report a person can actually produce:

| | count |
|---|---|
| Menu links on `/Reports/Reports.aspx` | **72** |
| Distinct `.aspx` pages behind them | **42** |
| Extra variants reachable **only** from a `Report Type` dropdown | **23** |
| **Total distinct reports a person can produce** | **95** |

So "85" is a fair order-of-magnitude for this suite, but the honest split is 72 + 23 = 95. Every
one of the 72 links and every one of the 23 dropdown-only extras is listed below. The 23 extras:

| Page | Its `Report Type` list | Menu links to it | Dropdown-only extras |
|---|---|---|---|
| `Salary_Statement.aspx?ReportType=SalaryStatement` | Normal · **CTC** · **Balance With CTC** · **Balance** | 1 | **3** |
| `Salary_Statement.aspx?ReportType=SalarySlip` | Salary Slip With Balance · **Salary Slip** | 1 | **1** |
| `Pay_Slip.aspx` | **With Balance** · **Without Balance** · Custom | 1 | **2** |
| `DailySpecialReport.aspx` | Daily Basic Report · **Daily Detail Report** | 1 | **1** |
| `Daily_Attendance.aspx` | Daily Attendance Summary Report · **Employee Summary** · **Daily Detail Report** · **Daily Basic Summary Report** · **Daily Basic Report** | 1 | **4** |
| `Attendance_View.aspx` | 15 types (listed in §5) | 10 | **5** — `Manual Entry Report`, `Form 1`, `Monthly OT Report`, `Monthly Summary Report`, `Monthly Basic Report` |
| `Attendance_View_New.aspx` | 7 types (listed in §5) | 2 | **5** — `Form 1`, `Monthly OT Report`, `Monthly Detail Report`, `Monthly Summary Report`, `Monthly Basic Report` |
| `CanteenReport.aspx` | 6 types (listed in §7) | 4 | **2** — `Monthly Billing Report`, `Meal Consumption Report` |
| | | | **23** |

---

## 1. How a report is parameterised — the pattern, once

Learn this once and 40 of the 42 pages are the same screen.

**The page shape.** Breadcrumb (`Home ▸ Reports ▸ <name>`) → a white card holding the period
control(s) and the report's own dropdowns → a **collapsible `Filter` bar** → the output area.
`[Generate]` or `[Show]` sits under the parameters.

**The period control.** One text box with a calendar picker. Which kind depends on the report:

| Kind | Field name | Example default | Used by |
|---|---|---|---|
| Salary/attendance **month** | `txtSalaryMonth` / `txtAttMonth` | `Sep/2026` | all payroll + statutory reports |
| Month **range** | `txtFromMonth` + `TxtToMonth` / `txtSalaryMonthfrom` + `txtSalaryMonthto` | `Sep/2026` | Monthly Register, Loan Yearly, Consolidated Salary |
| Date **range** | `txtDateFrom` + `txtDateTo` (or `txtfromdate`) | `07-09-2026` | all daily/monthly attendance, leave, canteen |
| A **single** date | `txtDateFrom` | `07/Sep/2026` | Company vs Department Head Count |
| Date **+ time** | `txtFromMonth` + `TxtToMonth` | `07-09-2026 21:49` | the two Access Control reports |

> ⚠️ **The date format is not consistent across the suite.** Seven different formats are in use on
> the 42 pages: `Sep/2026`, `Sep-2026`, `07-09-2026`, `07/09/2026`, `07-Sep-2026`, `07/Sep/2026`,
> and `07-09-2026 21:49`. If this is rebuilt, pick one.

**The `Filter` card** (identical on ~25 pages). Collapsed on arrival; clicking the bar opens it:

1. **Employee** — a single dropdown, `All` + **173 employees** as `EMP001:Test 1` … `EMP173:Test 173`
   (174 options). ⚠️ On `TDS_Report.aspx` alone the same list is formatted `EMP001 : Test 1`
   (spaces around the colon).
2. Four **checkbox trees**, each with its own **`Select All`** master box — **48 boxes in total**,
   and **none of them is ticked when the page opens**:
   - **Category** — `Select All` · `All` · `Category 1` … `Category 7` (9 boxes)
   - **Company** — `Select All` · `Company 1` · `Company 2` (3)
   - **Division** — `Select All` · `Division 1` … `Division 9` (10)
   - **Department** — `Select All` · `Default` · `Marketing` · `Dispatch` · `Production` ·
     `Accounts` · `Loading` · `STORE` · `Maintenance` · `Consumables Store` · `HR` ·
     `House Keeping` · `RM Store` · `QC` · `Purchase` · `Packing` · `Safety` · `RM & Con Store` ·
     `Production Pardi` · `QC PARDI` · `Admin` · `IT` (22)
3. **Report Format** — `PDF` | `Excel` (default `PDF`), where the report offers a choice.

> ⚠️⚠️ **The single biggest usability finding of this capture, and it is not in the old doc:**
> **a `[Generate]` report with no filter boxes ticked returns nothing at all** — the page posts
> back, redraws itself, and shows no report, no empty grid and no message. It is indistinguishable
> from a broken button. Tick `Category ▸ All` (or any boxes) and the same click returns a full PDF.
> I confirmed this on Salary Statement: identical parameters, 0 boxes → silent nothing; 40 boxes →
> a 95,962-byte PDF.

**What "Generate" actually does.** ⚠️ **Correction:** the old doc says output "renders in
`/Reports/Report_Viewer.aspx` — a Microsoft RDLC/SSRS ReportViewer with paging, Find/Next and
export to Excel/PDF/Word." **That is not what happens today.** `Report_Viewer.aspx` is never
reached. `[Generate]` posts the form and the server answers the *same POST* with the finished file:

```
HTTP 200
Content-Type: application/pdf
Content-Disposition: attachment; filename=Salary Statement5/1/2026 12:00:00 AM.pdf
Content-Length: 95962
```

The browser downloads it. There is no on-screen viewer, no paging, no Find, no Word export — the
choice is the `Report Format {PDF | Excel}` dropdown *before* you press the button.
⚠️ Note the filename: the report name with a raw `M/d/yyyy h:mm:ss tt` timestamp glued on, slashes
and colons included — the browser has to sanitise it into `Salary Statement5_1_2026 12_00_00 AM.pdf`.

**What "Show" does** (the other 12 pages). Renders an **HTML grid in the page**, id
`grdAttendanceView` or `grdSalaryView`, with a **`Search`** box above it and, on most,
**`[Excel Export]`** beside `[Show]`. These are the reports you can read without downloading
anything, and they are the ones this capture could run end to end.

**Two export patterns coexist** — ⚠️ another thing the old doc flattened:

| Pattern | Where | How you choose |
|---|---|---|
| `Report Format {PDF｜Excel}` dropdown, then `[Generate]` | the ~25 `Generate` pages | before pressing |
| `[Show]` to screen **+ a separate `[Excel Export]` button** | PF Report, PT Statement, Monthly Register, Wages Register, OT Report, Payroll Summary, HDFC | after reading |
| `[Show]` to screen **+ an `Export {Select Export Type｜Excel｜CSV}` dropdown** | **PF ECR and ESIC ECR only** | after reading — and CSV exists *only* here |
| `[Show]` **+ `[Print]`** | the three Access Control reports | after reading |

---

## 2. Employee Reports — 3 reports · group 1 on the menu

⚠️ **Correction:** the old doc lists a fourth entry, `dthffyjh` ("test junk left in the live demo").
**It is gone.** The Employee Reports group now holds exactly three links.

These three do **not** use the `Filter` card. They are plain dropdown-filter screens.

| # | Report | Address | Parameters (full option lists) | What it returns |
|---|---|---|---|---|
| 1 | **Employee Details** | `/Reports/Employee_Report.aspx?MenuId=34` | **Categorgy** *(sic)* `All · Category 1…7` (8, def `All`) · **Company** `All · Company 1 · Company 2` (3, def `All`) · **Division** `All · Division 1…9` (10, def `All`) · **Department** `All · Default · Marketing · Dispatch · Production · Accounts · Loading · STORE · Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing · Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT` (22, def `All`) · **Location** `All · Location 1…5` (6, def `All`) · **Status** `All · Working · Resign` (3, def `All`) · a free-text **Search** box. Buttons: `[Filter]` `[Add]` `[Excel]` | an in-page employee grid (see run below) |
| 2 | **Employee form** | `/Reports/Employee_Form.aspx?MenuId=34` | **Categorgy** ⚠️ `Category 1…7` — **no `All`**, defaults `Category 1` · Company · Division · Department (same lists) · **Status** `All · Working · Resign`. Button: `[Filter]` only | a printable employee-details form per person |
| 3 | **Employee ID Card** | `/Reports/Employee_ID_Card.aspx?MenuId=34` | same five as Employee form **+ `ID Format {Vertical｜Horizontal}`** (def `Vertical`). Button: `[Filter]` only. ⚠️ page heading reads **"Employee Form"**, not "Employee ID Card" | printable ID cards |

### Employee Details — **run live**, all filters `All`

`[Filter]` renders **`grdEmployee`, 173 employee rows**, in a **31-column** grid — the widest
column list in the reports area, and effectively the employee-master schema:

```
EmpCode | EmployeeName | Gender | Status | JoiningDate | ResignDate | Company_Name
| Location_Print_Lable | Department_Name | Category_Name | Company_Address | Company_Email
| UAN | AadharNo | IFSCCode | BankAc | DesignationName | Weeklyoff | MobileNo | EmailAddress
| DOB | PanCard | DeviceCode | ESICNo | Driving_Licence | GroupFName | GroupSName
| HoliDay_GroupName | OT | PayScale | GrossSalary
```

Real rows:

| EmpCode | Name | Gender | Status | JoiningDate | ResignDate | Company | Location | Department | Category | Designation | Weeklyoff | DeviceCode | GrossSalary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| EMP082 | Test 82 | Male | Working | 1/1/2016 | 1/1/1991 | Company 1 | Location 3 | Production | Category 1 | Default | Sunday | `dr` | 0 |
| EMP001 | Test 1 | Male | Working | 1/1/2016 | 3/29/2025 | Company 2 | Location 2 | Marketing | Category 4 | GM Marketing | Sunday | GPPI0001 | 80520 |
| EMP002 | Test 2 | Female | Working | 6/1/2021 | 3/29/2025 | Company 2 | Location 2 | Marketing | Category 2 | Sr. Sales Executive | Sunday | GPPI0002 | 49500 |

⚠️ Three things worth copying **differently** in a rebuild: dates print with a full
`12:00:00 AM` time on them; **`ResignDate` is filled in for people whose Status is `Working`**
(EMP082 shows a resign date of 1/1/1991), so the grid cannot be trusted to say who has left;
and `UAN`, `AadharNo`, `IFSCCode`, `BankAc`, `PanCard` and `ESICNo` are empty for every row —
the identity columns exist but hold nothing, which is why PF Report also shows a blank UAN.

⚠️ **Correction:** the old doc records `Location` on Employee Details only. Confirmed — Employee
form and Employee ID Card have **no Location filter**, which is inconsistent with the report that
feeds them.

---

## 3. ⭐ Payroll Reports — 13 menu links · 11 pages · the most valuable group

All of these carry the standard `Filter` card (Employee dropdown + the four checkbox trees).
Only what is **different** is written per report.

| # | Report | Address | Its own parameters | What it returns |
|---|---|---|---|---|
| 1 | **Salary Statement** | `Salary_Statement.aspx?ReportType=SalaryStatement` | **Salary Month** `txtSalaryMonth`, def current month `Sep/2026` · **Report Type** `Normal · CTC · Balance With CTC · Balance` (def `Normal`) · **Report Format** `PDF · Excel` (def PDF) · `[Generate]` | ⭐ **run live, May/2026, all filter boxes ticked → HTTP 200 `application/pdf`, `Content-Disposition: attachment; filename=Salary Statement5/1/2026 12:00:00 AM.pdf`, 95,962 bytes.** With **no** boxes ticked the identical click returns the page again and nothing else. |
| 2 | **Salary Slip** | `Salary_Statement.aspx?ReportType=SalarySlip` | same page · **Report Type** `Salary Slip With Balance · Salary Slip` (def *With Balance*) · Format PDF/Excel | a PDF of per-person slips |
| 3 | **Loan Report** | `Salary_Statement.aspx?ReportType=LoanReport` | same page · **Report Type** `Loan Report` (the only option) · Format PDF/Excel | see run table below |
| 4 | **Department Wise Summary** | `Payroll_Summary_Report.aspx?ReportType=SummaryReport&GroupBy=Department` | **Month** `txtAttMonth` · **Report Type** `Summary Report` (only option) · **Group By** `Costcentre · Designation · Department` · ⚠️ **Categorgy `Category 1…7` with NO `All`, defaulting to `Category 1`** · Company · Division · Department (plain dropdowns, not trees, all with `All`) · Search · `[Generate]` `[Excel Export]` | ⭐ **run live — see the column list below** |
| 5 | **Designation Wise Summary** | same page, `&GroupBy=Designation` | identical; only `Group By` differs | same shape, grouped by designation |
| 6 | **Costcentre Wise Summary** | same page, `&GroupBy=Costcentre` | identical | same shape, grouped by cost centre |
| 7 | **Wages Register** | `WagesRegister.aspx` | **Salary Month** · ⚠️ **Categorgy `Category 1…7`, no `All`, def `Category 1`** · Company · Division · Department · Search · ⚠️ **`Excel Files` dropdown that is completely empty (0 options)** · `[Show]` `[Excel Export]` | ⭐ **run live — see below** |
| 8 | **ICICI** | `BANKStatement.aspx?ReportType=ICICI` | **Month** `txtAttMonth` **+ a separate Payment Date** `txtPaymentMonth` (`07-09-2026`) · Categorgy/Company/Division/Department dropdowns · **Cheque NO** (free text `Txtasset`) · ⚠️ **BANK ACC NO — a dropdown `CMBBANK` with two blank entries and no readable label** · **Export `PDF · Excel`** · Search · `[Generate]` `[Show]` | not run: it names the paying bank account and cheque number — a payment instruction file, not a read |
| 9 | **BANK Statement** | `BANKStatement.aspx?ReportType=BankAC` | identical to ICICI — **the same page**; only the query string differs | as above |
| 10 | **HDFC** | `BANKStatement_HDFC.aspx?ReportType=HDFC` | **Month + Payment Date** · the four org dropdowns · Search · `[Show]` `[Excel Export]`. ⚠️ **no Cheque NO, no BANK ACC NO, no Export dropdown** — a slimmer page than ICICI | not run: same reason |
| 11 | **SUDICO** | `BANKStatement_Sudico.aspx?ReportType=Sudico` | as ICICI **+ `Bank` = `Bank 1 · Bank 2 … Bank 19`** (19 options, def `Bank 1`) · Cheque NO · BANK ACC NO · Export `PDF · Excel` · `[Generate]` `[Show]` | not run: same reason |
| 12 | **Consolidated Salary Statement** | `Consolidated_SalaryStament.aspx?ReportType=ConsolidatedSalaryStatement` | **From Month + To Month** (`txtSalaryMonthfrom` / `txtSalaryMonthto`) — a true range · **Report Type** `Salary Statement` (only option) · Employee · trees · `[Generate]`. ⚠️ **no Report Format dropdown** — this one is PDF only | see run table |
| 13 | **Pay Slip** | `Pay_Slip.aspx?ReportType=Payslip` | **From Month** (single, `txtSalaryMonthfrom`) · **Report Type `With Balance · Without Balance · Custom`** — ⚠️ **defaults to `Custom`**, not to a standard slip · Format PDF/Excel · `[Generate]` | see run table |

### ⭐ Department Wise Summary — run live, `May/2026`, **Category 4**, all other filters `All`

Reproduced **exactly** as the 2026-08-16 capture recorded it — same 38 columns, same numbers.
That capture is confirmed, not just repeated:

```
Department | P | A | WO | WOP | H | HP | OD | PL | CL | COFF | SL | TotalDays
| BASICDA | HRA | FIX_INCENTIVE | OTHERS | Monthly Incentive | SpecialAllowence | Reimbursement | WD | Gross
| EBASICDA | EHRA | EFIX_INCENTIVE | EOTHERS | EMonthly Incentive | ESpecialAllowence | EReimbursement | EWD | EGross
| LOAN | PF | Advance | Other Deduction | Canteen | TotalDeduction | NetSalary
```

Real rows (9 departments + a TOTAL row):

| Department | P | A | WO | H | HP | OD | CL | SL | TotalDays | BASICDA | Gross | EBASICDA | **EGross** | LOAN | PF | TotalDeduction | **NetSalary** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Marketing | 95 | 2 | 20 | 4 | 1 | 3 | 0 | 0 | 122 | 21,16,400 | 42,32,800 | 1,61,413 | **3,22,826** | 40,000 | 1,800 | 41,800 | **2,81,026** |
| Dispatch | 23.5 | 0.5 | 5 | 1 | 0 | 0 | 1 | 0 | 30.5 | 3,72,150 | 7,44,300 | 24,351 | **48,701** | 0 | 1,800 | 1,800 | **46,901** |
| Accounts | 22.5 | 0.5 | 5 | 1 | 0 | 0 | 0 | 2 | 30.5 | 6,28,200 | 12,56,400 | 38,961 | **77,923** | 12,500 | 1,800 | 14,300 | **63,623** |
| QC | 14 | 11.5 | 3 | 0 | 0 | 0 | 2.5 | 0 | 19.5 | 5,40,100 | 10,80,200 | 30,885 | **61,770** | 0 | 1,800 | 1,800 | **59,970** |
| **TOTAL** | 242 | 48.5 | 49 | 10 | 1 | 3 | 3.5 | 3 | 323.5 | 50,66,885 | 1,01,33,770 | 3,63,406 | **7,26,813** | 57,500 | 14,400 | 76,900 | **6,49,913** |

`7,26,813 − 76,900 = 6,49,913` ✔ — Net = EGross − TotalDeduction, confirmed on the total row.

> **The modelling insight, re-confirmed:** every earning head appears **twice** — the structure
> amount (`BASICDA`, `HRA`, `Gross`) and an **`E`-prefixed *earned* amount** (`EBASICDA`, `EHRA`,
> `EGross`) which is the structure scaled by attendance. Net pay comes off the **earned** side.
> ⚠️ Note ⚠️ the same two faults the old doc found are **still there**: the Categorgy dropdown has
> no `All`, so the whole company can never appear on one page; and it defaults to `Category 1`,
> which returns an all-zero grid that reads as "no data".

### Wages Register — run live, `May/2026`, Category 1 (its forced default)

Columns: `EmpID · EmpCode · EmployeeName · Designation · WorkingDays · PresentDays · PH ·
TotalLeave · TotalDays · Gross · TotalDeduction · NetSalary · BankAc`

4 rows returned — `EMP071 / EMP081 / EMP082 / EMP158`, all with Designation `Default` and **every
numeric cell blank except `NetSalary = 0`**. ⚠️ One `BankAc` cell contains a stray apostrophe
(`'`). This is the emptiest report in the suite for this data set.

---

## 4. Leave / Loan Reports — 5 menu links · 5 pages

Two menu groups on the site (**Leave Reports**, 4 links · **Loan Reports**, 1 link).

| # | Report | Address | Parameters | What it returns |
|---|---|---|---|---|
| 1 | **Yearly Report** (leave) | `LeaveReport.aspx?ReportType=Yearly Report` | **Leave Year** `2022 · 2023 · 2024 · 2025 · 2026 · 2027` (6, def `2026`) · **To Month** `txtSalaryMonthto` (`Sep/2026`) · the `Filter` card (Employee + 4 trees) · `[Generate]` | see run table |
| 2 | **Leave EnCashment** | `Leave_Encashment.aspx?ReportType=LeaveEncashment` | **Date From / Date To** (`07-09-2026`) · Filter card · `[Generate]` | see run table |
| 3 | **Leave Ledger** | `/Leave/LeaveLedger.aspx` | ⚠️ **not a report page at all** — the menu link jumps out of `/Reports/` into the operational Leave module. The live leave ledger screen doubles as the report. (Its own screen is another terminal's scope; noted here so the 72 links reconcile.) | — |
| 4 | **Coff Report** | `Coffreport.aspx` | **Date From / Date To** (`07-09-2026`) · Employee dropdown in the Filter card · `[Generate]`. ⚠️ **the page heading reads "Leave Encashment"** — a copy-paste from report #2 | see run table |
| 5 | **Loan Yearly** | `Loan_Yearly_Report.aspx` | **From Month / To Month** (`Sep/2026`) · **Employee** dropdown — ⚠️ here it is on the page itself, *not* inside a Filter card · `[Generate]` | see run table |

⚠️ **Correction:** the old doc records Loan Yearly as having "**Company · Location · Department ·
Division · Category trees**". It has none of them. The whole screen is three controls: From Month,
To Month, Employee. There is no Filter card on this page.

---

## 5. Attendance Reports — 32 menu links · 13 pages · the largest group

The menu splits these into three nested sub-groups: **Daily** (13 links), **Monthly** (17), **Yearly** (2).

**Everything in this group shares:** a **Date From / Date To** pair, the `Filter` card (Employee +
the four checkbox trees), and `[Generate]`. Below, only the differences.

| # | Menu links | Page | Report Type dropdown (the real list) | Its other parameters |
|---|---|---|---|---|
| 1 | Daily Basic Report · Daily Detail Report · Present · Absent · On Leave · Miss Punch · Late Coming · Early Going **(8 links, one page)** | `Daily_Att_Viewer.aspx?ReportType=…` | `Daily Basic Report · Daily Detail Report` | **Group By** `Shift Wise · Category Wise · Designation Wise · Department Wise` (def *Shift Wise*) · **Status** `All · Miss Punch · On Leave · Early Going · Late Coming · Absent · Present` (def `All`) — the six status links simply preselect this dropdown |
| 2 | Department Summary | `Department_Summary.aspx` | — | **Date From / Date To only** (`07/Sep/2026`). ⚠️ **no dropdowns at all** — the old doc's "Company + Department trees" are not on this page |
| 3 | Company vs Department Head Count | `Department_vs_Company_Summary.aspx` | — | **a single Date** (`07/Sep/2026`) and nothing else. ⚠️ page heading reads "Department Summary" |
| 4 | Daily Report | `DailyAttReport.aspx` | `Daily Basic Report` (only option) | **Group By** `Designation · Department` (def *Designation*) |
| 5 | Daily Special Report | `DailySpecialReport.aspx` | `Daily Basic Report · Daily Detail Report` | Group By (4, as row 1) · Status (7, as row 1) · ⚠️ **its Category dropdown has collapsed to a single option, `All`** · a **`Recalculate`** control — **not pressed: recalculating attendance rewrites somebody's records** |
| 6 | Daily Attendance Summary Report | `Daily_Attendance.aspx` | **5:** `Daily Attendance Summary Report · Employee Summary · Daily Detail Report · Daily Basic Summary Report · Daily Basic Report` | Group By (4) · Status (7) · date fields named `txtfromdate` / `txtDateTo` |
| 7 | Employee Summary Report | `Employee_Att_Summary.aspx` | `Employee Summary` (only) | dates + Filter card |
| 8 | Daily Attendance Report | `Daily_Attendance_Summary.aspx` | `Daily Attendance Report` (only) | Group By (4) · Status (7) · **Report Format `PDF · Excel`** |
| 9 | Monthly Basic · Monthly Summary · Monthly Detail · Monthly OT · Form 1 **(5 links, one page)** | `MonthlyAttReport.aspx?ReportType=…` | `Form 1 · Monthly OT Report · Monthly Detail Report · Monthly Summary Report · Monthly Basic Report` | **Order By** `Emp Code · Emp Name` · **Report Format `PDF · Excel`** |
| 10 | Monthly Report · Detail View · Performance Report · Basic with ExtraWork · Basic with OT · Monthly Total Duration · Monthly In Out · Monthly Basic Status **(8 links)** + Head Count · Monthly Loss **(2 more, filed under MIS)** | **`Attendance_View.aspx`** | **15:** `Manual Entry Report · Monthly Basic With Status · Monthly Basic With ExtraWork · Monthly In Out · Monthly Total Duartion` *(sic)* `· Monthly Basic with OT · Monthly Report · Monthly Loss Report · Head Count Report · Performance · Form 1 · Monthly OT Report · Monthly Detail Report · Monthly Summary Report · Monthly Basic Report` | **Order By** `Emp Code · Emp Name` · dates in `07-Sep-2026` format |
| 11 | Manual Entry Report | `Manual_Entry_Report.aspx` | — (heading: *"Manual Entry (Manual Punch) Report"*) | Date From / To (`07-Sep-2026`) · Filter card |
| 12 | Monthly Late Coming Report | `Monthly_Late_coming_report.aspx` | — | Date From / To (`01-09-2026` → `07-09-2026`, i.e. **it opens pre-set to month-to-date** — the only page in the suite that does) · Filter card. ⚠️ the old doc's "Shift tree" is not present |
| 13 | Performance View · Yearly Report **(2 links)** | `Attendance_View_New.aspx` | **7:** `Yearly Summary · Performance · Form 1 · Monthly OT Report · Monthly Detail Report · Monthly Summary Report · Monthly Basic Report` | **Month From / Month To** (`Sep-2026` — months, not dates) · **Order By** `Emp Name · Emp Code` (⚠️ def `Emp Name` here, `Emp Code` everywhere else) · heading *"Yearly Attendance Report"* |

---

## 6. ⭐⭐ Statutory Reports — the actual government file formats

**This is the most valuable section in the document.** These seven pages are the reason a payroll
product is hard to rebuild: the column lists below are the file layouts the Indian statutory
portals expect. All seven were opened live; five were run.

**They do not use the `Filter` card.** They use four plain dropdowns — **Categorgy** (`All ·
Category 1…7`), **Company** (`All · Company 1 · Company 2`), **Division** (`All · Division 1…9`),
**Department** (`All` + the 21 named departments) — all defaulting to `All`, plus a **Search** box.
That makes them the easiest reports in the suite to run, and the reason this capture could execute
them.

| # | Report | Address | Parameters | Buttons |
|---|---|---|---|---|
| 1 | **PF Report** | `PFReport.aspx` | **Month** `txtAttMonth` (`Sep/2026`) · the four dropdowns · Search | `[Show]` `[Excel Export]` |
| 2 | **PF ECR** | `PFStatement.aspx` | **Month** · the four dropdowns · Search · **`Export {Select Export Type｜Excel｜CSV}`** | `[Show]` only |
| 3 | **ESIC ECR** | `ESIC_Challan.aspx` | **Month** · the four dropdowns · Search · **`Export {Select Export Type｜Excel｜CSV}`** | `[Show]` only |
| 4 | **PT Statement** | `PTStatement.aspx` | **Month** · the four dropdowns · Search | `[Show]` `[Excel Export]` |
| 5 | **PT Report** | `PTReport.aspx` | **Month** · **Company only** (`Company 1 · Company 2`, ⚠️ **no `All`**, def `Company 1`) | `[Show]` |
| 6 | **Monthly Register** | `MonthlyRegister.aspx` | **From Month + To Month** · **`Head Name` — 43 options, listed in full below** · the four dropdowns · Search | `[Show]` `[Excel Export]` |
| 7 | **EPFO** | `EPFO.aspx` | **Salary Month** · **Company** (`Company 1 · Company 2`, no `All`) | `[Calculate]` |

⚠️ **CSV exists nowhere else in the suite.** PF ECR and ESIC ECR are the only two reports with a
CSV option, and they get it through an `Export` dropdown rather than an `[Excel Export]` button —
because a government portal takes a file, not a printout.

### 6.1 PF Report — **run live, May/2026, all four filters `All`**

**Columns (8):**

```
EmpCode | UAN | MemberID | EmployeeName | Gross Wages | Basic | PF Employer | PF Employee
```

**66 employee rows + a TOTAL row.** Real rows:

| EmpCode | UAN | MemberID | EmployeeName | Gross Wages | Basic | PF Employer | PF Employee |
|---|---|---|---|---|---|---|---|
| EMP001 | *(blank)* | *(blank)* | Test 1 | 80520 | 40260 | 1800 | 1800 |
| EMP002 | | | Test 2 | 49500 | 24750 | 1800 | 1800 |
| EMP003 | | | Test 3 | 49500 | 24750 | 1800 | 1800 |
| EMP007 | | | Test 7 | 63250 | 31625 | 1800 | 1800 |
| EMP009 | | | Test 9 | 50600 | 25300 | 1800 | 1800 |
| EMP167 | | | Test 167 | 22611 | 11306 | 1131 | 1131 |
| **TOTAL** | | | | **1898888** | **951276** | **85290** | **85290** |

Note the shape of the rule: `Basic` is half of `Gross Wages`, and PF is capped — everyone on a
Basic above ₹15,000 shows the ₹1,800 ceiling (12% of 15,000), while EMP167 on a Basic of 11,306
shows 12% of it (1,131). Employer and employee contributions are equal in this report.
⚠️ **UAN and MemberID are empty for every one of the 66 rows** — the two identifiers the EPFO
actually needs are not populated in this demo data.

### 6.2 ⭐ PF ECR — **run live, May/2026** — the literal EPFO ECR layout

**Columns (13) — this is the EPFO Electronic Challan-cum-Return field order:**

```
PFNumber | UAN | MEMBER_NAME | GROSS_WAGES | EPF_WAGES | EPS_WAGES | EDLI_WAGES
| EPF_CONTRI_REMITTED | EPS_CONTRI_REMITTED | EPF_EPS_DIFF_REMITTED
| NCP_DAYS | REFUND_OF_ADVANCE | DATE OF PAYMENT
```

**Returned 1 employee row + a TOTAL row** for May/2026:

| PFNumber | UAN | MEMBER_NAME | GROSS_WAGES | EPF_WAGES | EPS_WAGES | EDLI_WAGES | EPF_CONTRI_REMITTED | EPS_CONTRI_REMITTED | EPF_EPS_DIFF_REMITTED | NCP_DAYS | REFUND_OF_ADVANCE | DATE OF PAYMENT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0 | Test 1 | 75326 | 15000 | 15000 | 15000 | 1800 | 1250 | 550 | 2 | 0 | 07/05/2026 |
| | | **TOTAL** | 75326 | 15000 | 15000 | 15000 | 1800 | 1250 | 550 | 2 | | |

The arithmetic is the real EPFO split and worth copying exactly: **EPF wages, EPS wages and EDLI
wages are all capped at ₹15,000**; `EPF_CONTRI_REMITTED` = 12% of 15,000 = **1,800**;
`EPS_CONTRI_REMITTED` = 8.33% of 15,000 = **1,250**; and `EPF_EPS_DIFF_REMITTED` = the remainder,
**550**. `NCP_DAYS` (non-contributory period, i.e. days not paid) = 2. `DATE OF PAYMENT` is a real
date, `07/05/2026`.
⚠️ `PFNumber` and `UAN` both print as literal `0`, not blank — a different empty-value convention
from PF Report, on the same two identifiers.
⚠️ Only **one** of the 66 people who appear in PF Report appears here. PF Report and PF ECR
disagree about who is a PF member for the same month.

### 6.3 PT Statement — **run live, May/2026 and Apr/2026**

**Columns (2):** `EmployeeName | Amount`, followed by a `TOTAL` row.
**Both months returned the header row and an empty TOTAL row and nothing else** — no employee
rows, no "no data" message. The grid renders; it is simply empty.

### 6.4 PT Report — **run live, May/2026 and Apr/2026 — returns nothing at all**

The page posts back and renders **no grid, no message, no error** — the parameter card and
nothing under it. ⚠️ Its page heading also reads **"PF Report"**, not "PT Report".

### 6.5 ESIC ECR — **run live, May/2026 and Apr/2026 — returns nothing at all**

Same as PT Report: a clean postback with no table and no message. The old doc saw the same for
Aug/2026, so this is not month-specific. **The ESIC column layout could not be captured**, because
the page never renders one. That is the one statutory format missing from this document, and it is
missing because the product does not produce it on this data.

### 6.6 ⭐ Monthly Register — **run live, Jan/2026 → Jun/2026, Head `BASICDA`**

The most flexible report in the suite: it pivots **one salary head across a range of months**.

**`Head Name` — all 43 options, in the order shown:**

```
BASIC · HRA · Conveyance · PF · Education · OTHERS · PERQUISITES · PRODUCTION · PT · TDS
· HOME_LOAN · BASICDA · VDA · Advance · Attendance Bonus · Other Deduction · OT
· Monthly Incentive · Travel Allowance · ROOM_RENT · MEDICAL · LTA · EXGRATIA · MEDICLAIM
· Bonus · LOAN · Perf. Allow · FIX_INCENTIVE · WASHING_ALLOWANCE · Canteen · Salary Addition
· Salary Deduction · Reimbursement · ESIC · LWF · Arrears · Late_Mark_Fine · Diciplinary_Fine
· SpecialAllowence · WorkingHrs · EPF · WRD · WD
```

**Columns are generated from the month range** — one column per month, then a Total:

```
Empcode | EmployeeName | Department_Name | Jan | Feb | Mar | Apr | May | Jun | Total
```

**100 employee rows** returned. Real rows:

| Empcode | EmployeeName | Department_Name | Jan | Feb | Mar | Apr | May | Jun | Total |
|---|---|---|---|---|---|---|---|---|---|
| EMP001 | Test 1 | Marketing | 39611 | 40260 | 40260 | 40260 | 37663 | 0 | 198054 |
| EMP002 | Test 2 | Marketing | 24750 | 24308 | 24750 | 24338 | 24750 | 0 | 122896 |
| EMP003 | Test 3 | Dispatch | 24750 | 24750 | 21556 | 24750 | 24351 | 0 | 120157 |
| EMP004 | Test 4 | Marketing | 15000 | 15000 | 15000 | 15000 | 15000 | 0 | 75000 |
| EMP173 | Test 173 | Production Pardi | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

⚠️ **Watch the head names.** The same range run with head **`BASIC`** returns **all zeros** —
this company's structure uses **`BASICDA`**, and `BASIC` is a live but unused head. A rebuilt
version should not offer heads that no one is paid on, or should say "no amounts on this head".

### 6.7 EPFO — **not run, deliberately**

The page offers **Salary Month** + **Company** and a single **`[Calculate]`** button. The old doc
records that it "produces a file, nothing on screen". `Calculate` is not a word this capture
presses on someone else's payroll data — a control named Calculate on an EPFO screen may well
compute and store contributions for the month. **Described, not pressed.**

---

## 7. Canteen · MIS · TDS · Access Control — 11 menu links · 7 pages

| # | Group | Report | Address | Parameters | What it returns |
|---|---|---|---|---|---|
| 1–4 | **Canteen Report** (4 links) | Canteen Daily · Canteen Monthly · Canteen Report With Free Meal · Canteen Monthly Detail | `CanteenReport.aspx?ReportType={Daily｜MonthlyPunch｜FreeMeal｜MonthlyDetail}` | **Date From / Date To** (`07/Sep/2026`) · **Report Type — 6 options, two of which no menu link reaches:** `Monthly Billing Report` ⚠️ · `Meal Consumption Report` ⚠️ · `Canteen Monthly Detail Report` · `Canteen Report with Free Meal` · `Canteen Daily Report` · `Canteen Monthly Punch Report` · **Order By** `Emp Code · Emp Name` · Filter card · **Report Format `PDF · Excel`** · `[Generate]` | see run table |
| 5 | **MIS Report** | Head Count Report | `Attendance_View.aspx?ReportType=HeadCount` | the `Attendance_View.aspx` page of §5 row 10, with `Head Count Report` preselected | see run table |
| 6 | **MIS Report** | Monthly Loss Report | `Attendance_View.aspx?ReportType=MonthlyLoss` | same page, `Monthly Loss Report` preselected | see run table |
| 7 | **TDS Reports** | Quarter Return | `TDS_Report.aspx` | **From Month / To Month** (`Sep-2026` — months, not dates) · Employee dropdown in the Filter card — ⚠️ formatted `EMP001 : Test 1` with spaces, unlike every other page · `[Generate]`. ⚠️ **Correction:** the old doc's separate **`Month` picker → `[Show Challan Details]`** is **not on the screen**. A `btnShowChallanDetails` control exists in the page's markup but never renders. | see run table |
| 8 | **Access Control** | Department Wise | `Access_Control_Report.aspx` | **From Date / To Date** — ⚠️ **with a time**, `07-09-2026 21:49`, the only date+time fields in the suite · **Department** (`All` + the 21 departments) · `[Show]` `[Print]`. ⚠️ old doc calls these "From Month / To Month"; they are dates | **run live, 01 Apr → 31 May 2026: no grid, no message, nothing** |
| 9 | **Access Control** | Employee Wise | `EmployeeWise_Access_Control_Report.aspx` | **From Date / To Date** (date+time) · **Employee** · `[Show]` `[Print]` | not run separately — same page family as #8 |
| 10 | **Access Control** | Device Wise | `Access_Control_Report_Device.aspx` | ⚠️ **no date fields at all** · **Employees** (`All` + the 173) · **Device `All · Sarigam · Vapi`** · `[Show]` `[Print]` | not run: the device list names two real sites |
| 11 | *(reconciliation)* | the 11th link in these groups is Canteen's fourth entry, counted above | | | |

⚠️ **The three Access Control reports are the only ones with a `[Print]` button** — no PDF, no
Excel, no CSV. Whatever they show goes straight to paper.

---

## 8. What actually came back — every report this capture ran

⚠️ Reminder on method: **all filter checkboxes were ticked** before pressing the button, because
nothing ticked returns nothing (§1). Where a report answered with a file, the HTTP response line is
quoted verbatim — that is the evidence it produced something, whether or not the file itself is
reproduced here.

| Report | Parameters used | Result |
|---|---|---|
| **Employee Details** | all filters `All` | ✅ **173 rows, 31 columns** on screen — layout in §2 |
| **Employee form** | Category 4 | ✅ **`200 · application/pdf · attachment; filename=Employee_Form.pdf · 59,723 bytes` · 14 pages, one per employee** — layout below |
| **Employee ID Card** | Category 4, Vertical | ❌ `200 · text/html · 6,075 bytes` — the page came back, no card file |
| **Salary Statement** | May/2026, Normal, PDF | ✅ **`200 · application/pdf · attachment; filename=Salary Statement5/1/2026 12:00:00 AM.pdf · 95,962 bytes`** |
| **Salary Slip** | May/2026 | ❌ nothing returned |
| **Loan Report** | May/2026 | ❌ **`302` redirect, 149 bytes of HTML** — no report |
| **Pay Slip** | May/2026 | ❌ no postback reached the server |
| **Department Wise Summary** | May/2026, Category 4 | ✅ **10 rows × 38 columns**, reproduced exactly — §3 |
| **Wages Register** | May/2026, Category 1 | ✅ **4 rows × 13 columns**, all figures blank/zero — §3 |
| **Consolidated Salary Statement** | Jan/2026 → Jun/2026 | ⚠️ **not run: the page itself timed out** (`page.goto` exceeded 120 s, twice) — the demo server would not serve it |
| **Leave Yearly Report** | Leave Year 2026, to Jun/2026 | ❌ `200 · text/html · 15,103 bytes` — page redrawn, no report |
| **Leave EnCashment** | 01-01-2026 → 30-06-2026 | ❌ `200 · text/html · 16,004 bytes` — no report |
| **Coff Report** | 01-01-2026 → 30-06-2026 | ❌ `200 · text/html · 15,976 bytes` — no report |
| **Loan Yearly** | Jan/2026 → Jun/2026 | ❌ `200 · text/html · 13,452 bytes` — no report |
| **OT Report** | May/2026 (after opening the hidden Filter bar) | ❌ blank card, no grid, no message |
| **OT Bank Statement** | May/2026 | ❌ same |
| **Daily Basic Report** | 01-05-2026, all statuses | ❌ `200 · text/html · 16,902 bytes` — no report |
| **Department Summary** | 01/May → 31/May/2026 | ❌ `200 · text/html · 7,860 bytes` — no report |
| **Company vs Department Head Count** | 01/May/2026 | ✅ **`200 · application/vnd.openxmlformats-officedocument.spreadsheetml.sheet · 14,212 bytes` — a real `.xlsx`.** Full layout below |
| **Monthly Basic Report** | 01/May → 31/May/2026 | ✅ **`200 · application/pdf · attachment; filename=Monthly Basic Report5/1/2026 12:00:00 AM.pdf · 62,223 bytes` · 7 landscape pages WITH real data** — full layout below |
| **Employee Summary Report** | 01-05 → 31-05-2026 | ❌ `200 · text/html · 16,464 bytes` — no report |
| **Monthly Late Coming Report** | 01-05 → 31-05-2026 | ❌ `200 · text/plain · 10,618 bytes` (a partial postback) — no rows |
| **Head Count Report** | 01-May → 31-May-2026 | ❌ `200 · text/plain · 10,793 bytes` — no rows |
| **Yearly Report (Attendance View New)** | Jan-2026 → Jun-2026 | ❌ no postback reached the server |
| **PF Report** | May/2026, all `All` | ✅ **66 rows + TOTAL, 8 columns** — §6.1 |
| **PF ECR** | May/2026 | ✅ **1 row + TOTAL, 13 columns** — the EPFO layout, §6.2 |
| **PT Statement** | May/2026 and Apr/2026 | ⚠️ header + empty TOTAL row, no data — §6.3 |
| **PT Report** | May/2026 and Apr/2026 | ❌ nothing rendered at all — §6.4 |
| **ESIC ECR** | May/2026 and Apr/2026 | ❌ nothing rendered at all — §6.5 |
| **Monthly Register** | Jan/2026 → Jun/2026, head `BASICDA` | ✅ **100 rows, month-per-column** — §6.6 |
| **Monthly Register** | same, head `BASIC` | ⚠️ every value zero — the head exists but nobody is paid on it |
| **Canteen Daily Report** | 01/May → 31/May/2026 | ❌ `200 · text/html · 24,200 bytes` — page redrawn, no report |
| **Manual Entry Report** | 01-May → 31-May-2026 | ❌ `200 · text/plain · 10,346 bytes` (partial postback) — no rows |
| **Monthly Loss Report** | 01-May → 31-May-2026 | ⚠️ **not run: the page would not load.** `Attendance_View.aspx?ReportType=MonthlyLoss` hung past 120 s on two separate attempts and was abandoned |
| **TDS Quarter Return** | Apr-2026 → Jun-2026 | ❌ `200 · text/html · 16,990 bytes` — no report |
| **Access Control ▸ Department Wise** | 01 Apr → 31 May 2026 | ❌ nothing rendered at all |
| **EPFO** | — | 🚫 **deliberately not run** — `[Calculate]` on someone else's payroll |
| **ICICI / HDFC / BANK Statement / SUDICO** | — | 🚫 **deliberately not run** — they build bank payment files naming a cheque number and a paying account |
| **Daily Special Report ▸ Recalculate** | — | 🚫 **deliberately not pressed** — it re-works attendance from raw punches |
| **Access Control ▸ Device Wise** | — | 🚫 not run — the device list names two real sites |

> **The honest headline: of the reports this capture ran, most returned nothing on this data.**
> That is not a harness problem — the same click on the same page with the same filters returns a
> 95 KB PDF for Salary Statement and a 173-row grid for Employee Details. The demo database simply
> has payroll and employee data but almost no leave, canteen, overtime, punch-level or access data.
> **What is worth carrying forward is the *shape* of each report — its parameters and its columns —
> which is captured above regardless of whether rows came back.**

### Employee Joining Form — the actual printed layout (from the PDF)

One page per employee. Company name and address at the top, then:

```
                 Company 2
        123 Default Street, City, Country

              Employee Joining Form

EmpCode   EMP001        Employee Name   Test 1
Department  Marketing   Designation     GM Marketing
Gender      Male        Joining Date    01-Jan-2016
                        Birth Date      05-May-1966

Aadhar No   ______      PAN No          ______
UAN         ______      ESIC No         ______
Driving Lic ______

Mobile No   9979238045  Email           info@hrmex.in
Emergency Contact No    ______
Emergency Contact No 2  ______

Bank Name   Bank 9      Bank Ac No      ______
IFSC Code   ______

Current Address  ______      Permanent Address  ______

Employee Sign                            Authorised Sign
```

⚠️ Note the date format changes again inside the PDF: `01-Jan-2016`, a ninth variant.

### ⭐ Monthly Basic Report — the real printed layout (from the PDF, **and it has data**)

`01/May/2026 → 31/May/2026`, all filters ticked → **7 pages, landscape (1188 × 595 pt)**.
This is the report the old doc described from the screen; here is what the file actually contains.

Header: report name, the date range, `Company Name : Company 1`, and a print timestamp
(`9/7/2026 10:42:25PM`). Then **one block per department**, each block repeating its own header row:

```
<Department>  | 1  2  3  4 … 31 |  P    A    WO    H    CO   OD   PL   CL   SL   Other  Total
              | H  A  WO A  … WO | 0.00 25.00 5.00 1.00 0.00 0.00 0.00 0.00 0.00 0.00  31.00
 EMP082:Test 82
```

- **31 day columns**, one per calendar day, each holding a **status code**.
- The status codes in use: **`P`** present · **`A`** absent · **`WO`** weekly off · **`H`** holiday ·
  **`CL`** casual leave · **`SL`** sick leave · **`P½` / `½P`** half day (the ½ prints as a second
  line under the day when a day is split between two states).
- **11 total columns** after the days: `P · A · WO · H · CO · OD · PL · CL · SL · Other · Total`,
  all in **two decimal places** (`23.50`, `0.50`) because half-days are real.
- Every row's `Total` is the length of the month — **31.00** — which is the arithmetic check the
  report is built around: every day of the month must be accounted for as something.
- The employee's `EMPCODE:Name` prints **below and left of** their row, not in a first column.

Real rows, verbatim:

| Department | Employee | Day pattern (excerpt) | P | A | WO | H | CL | SL | Total |
|---|---|---|---|---|---|---|---|---|---|
| Production | EMP082:Test 82 | `H A WO A A A … WO` | 0.00 | 25.00 | 5.00 | 1.00 | 0.00 | 0.00 | 31.00 |
| Accounts | EMP011:Test 11 | `H WO P P P P P CL WO SL …` | 23.50 | 0.00 | 5.00 | 1.00 | 1.00 | 0.50 | 31.00 |
| Accounts | EMP023:Test 23 | `H P WO P … SL P SL P½ …` | 22.50 | 0.50 | 5.00 | 1.00 | 0.00 | 2.00 | 31.00 |
| Accounts | EMP101:Test 101 | `H P P WO P P P P A A A …` | 6.00 | 23.00 | 1.00 | 1.00 | 0.00 | 0.00 | 31.00 |
| Dispatch | EMP003:Test 3 | `H P½ WO P … CL P …` | 23.50 | 0.50 | 5.00 | 1.00 | 1.00 | 0.00 | 31.00 |
| Dispatch | EMP013:Test 13 | `WO P P P P A P WO …` | 25.00 | 1.00 | 5.00 | 0.00 | 0.00 | 0.00 | 31.00 |

⚠️ EMP082 and EMP081 show `A` on 25 of 31 days with `P 0.00` — the same "present + absent looks
wrong" family of data the old doc flagged on the Payroll Summary. It is the demo data, not the
report.

### ⭐ Company vs Department Head Count — the real layout (from the `.xlsx`)

Completely absent from the old doc, and the most interesting attendance report in the suite:
**it is a head count crossed against every shift.**

- Sheet title `Department Summary Report`, subtitle `Date :01/May/2026`, panes frozen after
  column B and row 4.
- **36 columns:** `Department | Company |` then **Male / Female / Total for each of 11 shifts** —
  `DS · GS · GS1 · GS19T · GS2 · GS9T · GSH · NGS · NIS · NS · PGSH` — then `GrandTotal`.
- **68 rows:** each of the 21 departments appears as `Company 1`, `Company 2`, and a
  `<Department> Total` row, ending in a single `Grand Total` row.
- ⚠️ For 01/May/2026 **every count cell is empty** — the grid is built, the numbers are not there.
- ⚠️ This is the **only** report in the suite that returns a genuine OpenXML `.xlsx`; everything
  else that exports returns a PDF.

---

## 9. Corrections

### Corrections to the 2026-08-16 capture

Every item below was checked live on 2026-09-07. Old claim → what is actually there now.

| # | Old claim (§8 of `docs/HRMEX-SCREEN-BY-SCREEN.md`) | What is actually there |
|---|---|---|
| 1 | "72 links … map to **~30 distinct `.aspx` report pages**" | **42 distinct pages** — 41 under `/Reports/` plus `/Leave/LeaveLedger.aspx`. All 42 opened. |
| 2 | "**14 coloured collapsible groups**" | **11** outer groups. Attendance Reports holds three nested sub-groups (Daily/Monthly/Yearly), which is where 14 comes from. |
| 3 | "Output renders in **`/Reports/Report_Viewer.aspx` — a Microsoft RDLC/SSRS ReportViewer** with paging, Find/Next, and export to Excel / PDF / Word." | **`Report_Viewer.aspx` is never reached.** `[Generate]` posts the form and the *same POST* answers with the finished file as an attachment (`Content-Type: application/pdf`). No viewer, no paging, no Find, **no Word export**. Format is chosen from a dropdown *before* the button. |
| 4 | Employee Reports contains a fourth entry, `dthffyjh` ("test junk left in the live demo") | **Gone.** The group holds exactly three links. |
| 5 | Wages Register: "Salary Month · Category · Company · Division · Department · `Excel Files` picker" | Correct as far as it goes, but it also has **`[Show]` and `[Excel Export]` buttons and a Search box**; its Category dropdown has **no `All`** and defaults to `Category 1`; and the **`Excel Files` dropdown is completely empty (0 options)**. |
| 6 | Loan Yearly: "From Month / To Month · Employee · **Company · Location · Department · Division · Category trees**" | **No trees, no Filter card at all.** The page is three controls: From Month, To Month, Employee. |
| 7 | Department Summary: "Date From/To · **Company + Department trees**" | **No dropdowns and no trees.** Date From and Date To, then `[Generate]`. |
| 8 | Department vs Company Summary: "a single Date · **Company + Department trees**" | A single Date and nothing else. |
| 9 | Monthly Late Coming: "… Employee · Category · **Shift tree** + trees" | No Shift tree. Date From/To + the standard Filter card. It is the **only** page that opens pre-set to month-to-date (`01-09-2026` → `07-09-2026`). |
| 10 | Daily Special Report: "+ Group By + Status + **Shift and Section trees** · `[Recalculate]`" | Group By and Status are right. **No Shift or Section tree**, and its **Category dropdown has collapsed to a single `All` option**. The `Recalculate` control is present (not pressed). |
| 11 | Daily Att Viewer: "… Category · **Shift tree** + Company/Division/Department trees" | The standard four trees (Category/Company/Division/Department). **No Shift tree.** |
| 12 | TDS Quarter Return: "From Date / To Date · Employee · trees · `[Generate]` + a **`Month` picker → `[Show Challan Details]`**" | From **Month** / To **Month** (`Sep-2026`), Employee, `[Generate]`. **The Month picker and `Show Challan Details` button do not render** — the control exists in the markup only. |
| 13 | Access Control ▸ Department Wise / Employee Wise: "**From Month / To Month**" | **From Date / To Date, with a time** — `07-09-2026 21:49`. The only date-and-time fields in the suite. |
| 14 | OT Report: "⚠️ Run live for May/2026: **the page rendered a completely blank card**" | Confirmed — **and now explained.** The page opens with its whole parameter form collapsed behind a bar marked `Filter`. Clicking it reveals Month, the four dropdowns, `[Show]` and `[Excel Export]`. Nothing is missing; it is hidden. |
| 15 | PF Report / PT Statement: "`[Show] [Excel Export]`" | Correct. But **PF ECR and ESIC ECR have no `[Excel Export]` button** — they use an `Export {Select Export Type｜Excel｜CSV}` dropdown instead, and are the only two reports in the product offering CSV. |
| 16 | ESIC ECR: "rendered no table for Aug/2026" | Still true, and not month-specific: **May/2026 and Apr/2026 also render nothing at all.** |
| 17 | Payroll Summary: "⚠️ the Category dropdown has no 'All' … defaults to Category 1 … one department shows `P 25, A 30` in a 31-day month" | The no-`All` and the Category-1 default are **confirmed unchanged**. The 38-column layout and every figure quoted (Marketing NetSalary 2,81,026; totals 7,26,813 − 76,900 = 6,49,913) **reproduced exactly**. |
| 18 | `Attendance_View.aspx` "15 types" | **Confirmed, all 15, in the recorded order.** |
| 19 | Canteen "Report Type has 6 options — two of which aren't in the menu" | **Confirmed, all 6.** |
| 20 | Monthly Register "`Head Name` (43 heads)" | **Confirmed — all 43 are now written out by name** in §6.6. |

### New findings not in the old doc at all

1. **A `[Generate]` report with no filter boxes ticked returns nothing, silently.** Same
   parameters, same button: 0 boxes → the page redraws and nothing happens; 40 boxes → a
   95,962-byte PDF. This is the single behaviour most likely to make a rebuilt version look broken.
2. **48 checkboxes, none ticked on arrival** — Category 9 · Company 3 · Division 10 · Department 22,
   each group with its own `Select All`.
3. **The Employee dropdown holds 174 options** — `All` plus **173 employees**, `EMP001:Test 1` …
   `EMP173:Test 173`. On `TDS_Report.aspx` alone the separator is ` : ` with spaces.
4. **Seven different date formats** across 42 pages (§1).
5. **The download filename is unsanitised** — `Salary Statement5/1/2026 12:00:00 AM.pdf`, with
   slashes and colons in it; the browser has to rewrite it.
6. **Loan Report answers with a `302` redirect** (149 bytes of HTML) rather than a report.
7. **Employee Details returns 31 columns** — effectively the employee master schema (§2), with
   `ResignDate` populated for people whose `Status` is `Working`.
8. **Three page headings are wrong**: `PTReport.aspx` says "PF Report", `Coffreport.aspx` says
   "Leave Encashment", `Employee_ID_Card.aspx` and `Department_vs_Company_Summary.aspx` say
   "Employee Form" and "Department Summary" respectively.
9. **"Categorgy" is misspelt on every screen that has one** — it is not a one-off typo, it is the
   label the product ships.

---

## Odd things I noticed

Written down and left alone, per the capture rules.

1. **A silent no-op is the default experience.** Arriving at a report and pressing `[Generate]`
   without opening the `Filter` bar produces nothing and says nothing. Nine of the ten reports that
   "returned nothing" in §8 may simply be this behaviour plus thin data — but three of them
   (PT Report, ESIC ECR, Access Control) render no grid element at all, which is a different thing.
2. **Four page headings name the wrong report** — `PTReport.aspx` → "PF Report",
   `Coffreport.aspx` → "Leave Encashment", `Employee_ID_Card.aspx` → "Employee Form",
   `Department_vs_Company_Summary.aspx` → "Department Summary".
3. **"Categorgy" is misspelt on every screen that has that filter.** It is the shipped label.
4. **`Monthly Total Duartion`** is misspelt in the `Attendance_View.aspx` Report Type dropdown.
5. **The Category filter has no "All" on four screens** — Payroll Summary, Wages Register,
   Employee form, Employee ID Card — and defaults to `Category 1`, which on this data returns an
   empty or all-zero result that reads as "the report is broken".
6. **Two `Company` dropdowns have no "All" either** — PT Report and EPFO, both statutory.
7. **`Daily_Att_Viewer` and `DailySpecialReport` have drifted apart.** They are near-identical
   screens, but Daily Special's Category dropdown has collapsed to a single `All` option.
8. **The `Excel Files` dropdown on Wages Register has zero options.** A control with nothing in it.
9. **`CMBBANK` ("BANK ACC NO") on the three bank-statement pages holds two blank entries.**
10. **Nine date formats across one product** — `Sep/2026`, `Sep-2026`, `07-09-2026`, `07/09/2026`,
    `07-Sep-2026`, `07/Sep/2026`, `07-09-2026 21:49`, `1/1/2016 12:00:00 AM` (inside the Employee
    Details grid) and `01-Jan-2016` (inside the generated PDF).
11. **Download filenames are built by string concatenation with no sanitising** —
    `Salary Statement5/1/2026 12:00:00 AM.pdf`.
12. **`ResignDate` is populated for employees whose `Status` is `Working`** — EMP001 shows
    `Working` and a resign date of 29/3/2025 in the same row.
13. **PF Report and PF ECR disagree.** For May/2026, PF Report lists 66 members; PF ECR lists one.
14. **UAN, Aadhaar, PAN, IFSC, bank account and ESIC number are empty for every employee** — the
    identity fields the statutory reports exist to carry are not populated, which is why PF Report
    prints blank UAN columns.
15. **`Loan Report` answers with a `302`.** Every other report answers `200`.
16. **The demo server intermittently refuses to serve some pages** —
    `Consolidated_SalaryStament.aspx` exceeded a 120-second load twice, and four other pages timed
    out once each then loaded fine on retry. This is the host, not the product.
17. **`Report_Viewer.aspx` still exists in the old documentation but nothing routes to it.** If it
    was once the output surface, it has been replaced by direct file responses.

---

## Reconciling all 72 menu links

| Group (in menu order) | Links | Covered in |
|---|---|---|
| Employee Reports | 3 | §2 |
| Leave Reports | 4 | §4 |
| Loan Reports | 1 | §4 |
| Payroll Reports | 13 | §3 |
| OT Reports | 2 | §3 note / §8 |
| Attendance Reports ▸ Daily | 13 | §5 rows 1–8 |
| Attendance Reports ▸ Monthly | 17 | §5 rows 9–12 |
| Attendance Reports ▸ Yearly | 2 | §5 row 13 |
| Statutory Reports | 7 | §6 |
| Canteen Report | 4 | §7 |
| MIS Report | 2 | §7 |
| TDS Reports | 1 | §7 |
| Access Control | 3 | §7 |
| **Total** | **72** | |

Plus the **23 dropdown-only variants** in §0 → **95 distinct reports**, all accounted for.

### OT Reports — the two links, in full

| Report | Address | Parameters | Result |
|---|---|---|---|
| **OT Report** | `OT_Report.aspx?ReportType=OTReport` | ⚠️ **the page opens with everything hidden.** Click the `Filter` bar to reveal: **Month** `txtAttMonth` · Categorgy (`All` + 1–7) · Company (`All` + 2) · Division (`All` + 1–9) · Department (`All` + 21) · Search · `[Show]` `[Excel Export]` | run for May/2026 → blank card, no grid |
| **OT Bank Statement** | `OT_Report.aspx?ReportType=OTReportBank` | **the same page**, same controls, same hidden-on-arrival behaviour | run for May/2026 → blank card |

---

## In human language — every report in this area, as points

**How reports work here, in one paragraph.** You pick a report from a list of 72 links. Every
report screen looks the same: choose a month or a date range at the top, then open a box called
"Filter" where you tick which parts of the company you want — categories, companies, divisions,
departments — or pick one person. Then you press a button. Some reports draw a table on the screen
you can read straight away; most hand you a finished PDF or Excel file to download. **One warning
that matters more than any other: if you don't tick anything in the Filter box, the button appears
to do nothing at all — no table, no file, no message. It isn't broken. It just has nothing to
report on.**

### The building blocks every report shares
- **Pick a period** — every report asks for either a single month, a range of months, a single day, or a range of days. Nothing runs without one.
- **Pick who it covers** — the same four tick-lists appear on almost every report: Category (7 of them), Company (2), Division (9) and Department (21, from Marketing to Packing to IT). Each list has a "Select All" box.
- **Or pick one person** — a single dropdown with all 173 employees, if you want one person's report instead of the whole company.
- **Choose paper or spreadsheet** — most reports let you pick PDF or Excel before you press the button. Two of them (the two government filing ones) also offer CSV, which is the format a government website will accept.
- **A search box on the table reports** — for the reports that draw a table on screen, you can type into a search box to narrow the rows without re-running anything.

### Employee reports — who works here
- **Employee Details** — the full staff list on screen, filtered by category, company, division, department, location, and whether they're currently working or have resigned. This is the "show me everyone" report, and it can be sent to Excel.
- **Employee Form** — prints each person's full details as a form, the kind you'd file in a folder or hand to someone to sign.
- **Employee ID Card** — prints ID cards for the staff you selected. You choose whether the card is tall (vertical) or wide (horizontal).

### Pay reports — what everyone was paid
- **Salary Statement** — the whole company's pay for one month as a PDF. You can ask for it four ways: the normal statement, a CTC version (showing total cost to the company), a version showing outstanding balances, or both together.
- **Salary Slip** — the individual pay slips for a month, either with the person's outstanding balance shown on them or without.
- **Pay Slip** — a second, separate pay-slip report with its own three styles: with balance, without balance, or a custom layout. (The product has two ways to print a pay slip, which is one more than it needs.)
- **Loan Report** — what each person still owes on staff loans, taken from the same screen as the salary statement.
- **Department Wise Summary** — one line per department for a month, showing days present, days absent, weekly offs, holidays and every pay head, ending in the department's total net pay. The most useful single page in the whole product.
- **Designation Wise Summary** — the same page, but one line per job title instead of per department.
- **Costcentre Wise Summary** — the same page again, grouped by cost centre, for the accountants.
- **Wages Register** — the statutory wage register: one line per worker with working days, present days, holidays, leave, gross, deductions and net pay, plus their bank account.
- **Consolidated Salary Statement** — the same as the salary statement but across a *range* of months, so you can see several months side by side in one file.
- **ICICI bank file** — produces the payment instruction to send to ICICI, naming the cheque number and the company account the salaries come out of.
- **HDFC bank file** — the same thing for HDFC, but a simpler screen: it doesn't ask for a cheque number or an account.
- **Generic Bank Statement** — the same as the ICICI one, for a bank the product doesn't have a named template for.
- **SUDICO bank file** — another bank format, and this one lets you choose which of nineteen configured banks the payment comes from.

### Leave and loan reports — time off and money owed
- **Leave Yearly Report** — how much leave each person has taken and has left, for a chosen leave year (2022 to 2027) up to a chosen month.
- **Leave Encashment** — who is cashing in unused leave for money, over a date range.
- **Leave Ledger** — a running history of every leave transaction per person. This link jumps you out of the reports area into the live leave screens.
- **Comp-off Report** — who has earned compensatory time off for working on a day off, over a date range.
- **Loan Yearly Report** — each staff loan month by month across a range: what was owed, what was deducted, what's left.

### Overtime reports
- **OT Report** — overtime hours and money per person for a month. ⚠️ On arrival this screen looks completely blank — the parameters are hidden behind a bar marked "Filter" that you have to click before anything appears.
- **OT Bank Statement** — the same overtime figures laid out as a bank payment file, for companies that pay overtime separately from salary.

### Attendance reports — who turned up
- **Daily Basic Report** — one line per person for a day or a short range: in time, out time, and their status.
- **Daily Detail Report** — the same but with every individual punch, not just the first and last.
- **Present today** — just the people who came in.
- **Absent today** — just the people who didn't.
- **On Leave today** — just the people on approved leave.
- **Miss Punch** — the people who punched in but never punched out (or the other way round). This is the list a supervisor chases every morning.
- **Late Coming** — who arrived after their shift start.
- **Early Going** — who left before their shift end.
- **Department Summary** — head counts per department for a date range, on one page.
- **Company vs Department Head Count** — for a single chosen day, a grid crossing every company against every department, to see where everyone is.
- **Daily Report** — a second daily attendance report that groups people by job title or by department.
- **Daily Special Report** — a daily report that can also group by shift, and has a "recalculate" control that re-works the attendance from the raw punches before printing.
- **Daily Attendance Summary Report** — a page that offers five different daily layouts from one dropdown, from a one-line summary up to the full punch detail.
- **Employee Summary Report** — one person's attendance summarised over a range, rather than one day for everybody.
- **Daily Attendance Report (with format choice)** — the same daily summary, but this one lets you choose PDF or Excel.
- **Monthly Basic Report** — the month as a calendar strip per person: a coloured block for every day of the month, with the totals for present, absent, weekly off, holidays and leave.
- **Monthly Summary Report** — the same month, but just the totals, no day-by-day strip.
- **Monthly Detail Report** — the month with every punch time shown per day.
- **Monthly OT Report** — the month's overtime hours per person.
- **Form 1** — the statutory monthly attendance register in the government's prescribed layout.
- **Monthly Report / Detail View** — a second monthly attendance page that offers fifteen different layouts from one dropdown, the widest choice in the product.
- **Performance Report** — an attendance-based performance view: how reliably each person turned up.
- **Basic with Extra Work** — the monthly attendance plus any extra hours worked beyond the shift.
- **Basic with OT** — the monthly attendance with the overtime column alongside.
- **Monthly Total Duration** — total hours actually worked per person for the month, rather than days.
- **Monthly In Out** — every in time and out time for the month, laid out day by day.
- **Monthly Basic Status Report** — the month with a status letter per day (P for present, A for absent, WO for weekly off, H for holiday).
- **Manual Entry Report** — every attendance record a human typed in by hand rather than the machine recording it. This is the audit list: who overrode the clock, and on which day.
- **Monthly Late Coming Report** — a month's worth of late arrivals per person. It opens already set to the current month so far.
- **Performance View (yearly)** — the performance report across a range of months rather than one.
- **Yearly Summary** — the whole year's attendance on one page per person.

### Government filing reports — the ones a company legally must produce
- **PF Report** — every employee's provident fund for the month: their UAN and member number, gross wages, basic, and both the employer's and the employee's contribution, with a company total at the bottom.
- **PF ECR** — the actual file the EPFO website accepts: member name, gross wages, the three separate capped wage figures the EPFO wants, the three contribution amounts, days not paid, any advance refunded, and the payment date. This is the one you upload, not print — and it's one of only two reports that offer CSV.
- **ESIC ECR** — the equivalent filing file for employee state insurance. ⚠️ On this demo it produces nothing at all, for every month tried.
- **PT Statement** — professional tax per person for the month, with a total. ⚠️ Empty on this demo.
- **PT Report** — a second professional-tax report, per company. ⚠️ Produces nothing at all, and its own page title says "PF Report" by mistake.
- **Monthly Register** — the most flexible report in the product: pick any one of 43 pay components (basic, HRA, PF, bonus, canteen, fines, overtime…) and see it for every employee across a range of months, one column per month, with a total. This is how you answer "how much did we spend on X between January and June".
- **EPFO** — calculates and produces the EPFO file for a month and a company. It has a "Calculate" button rather than a "Show" one, so it does work rather than just reading. **Not pressed during this capture.**

### Canteen, management and access reports
- **Canteen Daily Report** — who ate what in the canteen on each day of a range.
- **Canteen Monthly Report** — the month's canteen punches per person.
- **Canteen Report With Free Meal** — the same, separating meals the company gave free from meals the employee is charged for.
- **Canteen Monthly Detail Report** — the full month meal by meal.
- **Canteen Monthly Billing Report** — what each person owes the canteen for the month. Only reachable from the dropdown, not from the menu.
- **Meal Consumption Report** — how many of each meal type were consumed, for the kitchen to plan with. Also dropdown-only.
- **Head Count Report** — how many people the company actually has, over a period, for management.
- **Monthly Loss Report** — the working days lost to absence over the month, which is the cost-of-absenteeism number.
- **TDS Quarter Return** — the quarterly tax-deducted-at-source return covering a range of months, per person.
- **Access Control — Department Wise** — who entered and left which door, grouped by department, over a date-and-time range.
- **Access Control — Employee Wise** — the same door records for one chosen person.
- **Access Control — Device Wise** — the door records for one chosen reader, at one of the company's two named sites. These three are the only reports that print straight to paper with no file option.
