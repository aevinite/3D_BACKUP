# HRMex — every menu, every sub-menu, every screen, every report

**Companion to `docs/HRMEX-HR-PAYROLL-STUDY.md`** (that one explains the *engines* and our build plan;
**this one is the exhaustive catalogue**).

Studied on the live demo `https://demo.hrmexweb.in/` as Superadmin, **2026-08-16**.
Every screen below was either **opened live in the browser** or its markup fetched and parsed; the
reports section records **what actually came back when the report was run**, not just its filters.
A temporary record was created and deleted to observe validation and delete behaviour (§17).

> **Plain-English summary of the whole product is at the very end — §19.** Read that first if you want
> the shape before the detail.

Legend: `▸` sub-menu · **bold** = screen name in the left nav · `[btn]` = button ·
`{a | b}` = dropdown options · ⚠️ = a bug or weakness verified live.

---

# 0. HOW THE APP IS BUILT (verified)

| | |
|---|---|
| Stack | ASP.NET **WebForms** (`.aspx`, `__doPostBack`, ViewState) · AdminLTE 3 / Bootstrap 4 · jQuery · Chart.js |
| Shell | `Default.aspx` = a **tabbed iframe host**; each menu item opens as a tab |
| Screens | ~130 `.aspx` pages in 13 modules |
| Naming | `X_Mst.aspx` (list) → `X_AU.aspx` (Add/Update). Totally consistent. |
| **Reports** | **Microsoft RDLC / SSRS `ReportViewer`** rendered in `/Reports/Report_Viewer.aspx` — paging (`1 of 2`), Find/Next, and an export ▾ offering **Excel · PDF · Word** |
| Errors | A global friendly error page `Oops.aspx?ref=HRM-OOPS-XXXXXXXX` — *"Plot twist: something broke!"* + the actual .NET message + a **traceable reference code** |
| Scheduler | Two real cron jobs (§1.6) — attendance collection 02:00, salary calculation 03:00 |
| Licensing | Metered by **active employees** — `License / Active Emp : 1000 / 124` |
| Version | 10.0.0.0 |

---

# 1. ADMIN

### 1.1 **Masters Permission** — `/Admin/Masters.aspx`
List `Master Name | Master Short Name`. `[Add Masters Combination] [Edit] [Delete]`.
Form: `Masters Name`, `Masters short Name`, `Location {Location 1..5}`.
*A "Masters" record is a named **data scope** — one Location. Assigning it to a user limits what that
user sees. This is the whole of HRMex's multi-tenancy.* ⚠️ App-level only, no DB enforcement.

### 1.2 **UsersTypes** — `/Admin/User_Types.aspx`
List `UserType Name | UserTypeLevel | ReportType`. `[Add User] [Edit] [Delete]`.
Form: `UserType Name`, `UserType Level` (number = seniority), **`Report Type`** = multi-select list of
allowed export formats `{PDF | Excel | Word | View | CSV …}`.
*Export rights are a **role property**, not a global setting.*

### 1.3 **Users** — `/Admin/User_Master.aspx`
List `Username | First Name | Last Name | Contact No | Admin? | Actions`, search, page size `{10|15|25}`.
Delete asks *"Delete User?"* → `[Cancel] [Yes, Delete]`.
Form, three fieldsets:
- **Account Credentials** — `User Name*`, `Password*`
- **Personal Information** — `First Name*`, `Last Name*`, `Contact No`, `Mail ID`
- **Role & Settings** — `Masters` (scope, §1.1), `User Type` (§1.2),
  flags `☐ Is Admin · ☐ Is Super Admin · ☐ Is Active`

### 1.4 **Change Password** — `/Admin/Password_Change.aspx` — self-service for the back-office user.

### 1.5 **Audit Logs** — `/Admin/Logs_Audit.aspx`  ⚠️ **the biggest weakness in the product**
`Date From` / `Date To` + `[Filter]` + free-text search.
Grid **`LogDateTime | User Name | IP Address | Operation Type | Status`**.

**Verified live:** filtering the whole of 2026 returned **exactly two rows** — my own two logins
(`16/08/2026 08:27` and `08:30`, `SuperAdmin`, IP `49.36.83.215`, Operation Type `Login`, Status
`Success`). **It records logins and nothing else.** No employee edit, no salary change, no payroll
lock/unlock, no deletion is recorded anywhere. For a system that pays people, this is a serious gap.

### 1.6 **System** — `/Admin/System_Mst.aspx` — three tabs, all verified live

**Tab: Custom Report** — `[New Report]`; grid `Custom Report Name | Report Text | Report Name`.
Form: `Custom Report Name`, `Custom Report Text` (the SQL/proc), `Report Group {Employee Report |
Leave Report | Payroll Report | OT Report | Daily Att Report | Monthly Att Report | Yearly Att Report
| Statutory Report | Canteen Report | MIS | TDS Report | Access Control}`, `Custom Report Short ID`,
`Report Name`, `☐ Filter Month`, `☐ From Date - TO Date`, `Custom Report Action`.
*A customer can add a whole new report without a software release.*
⚠️ Live row: name `edgrf`, report text `dthffyjh`, report name `sdf` — test junk shipped to the demo.

**Tab: Auto Mail** — grid `Name | Subject | Email From | Email Time | Mail ON/OFF`. Live rows:
```
Birthday_Mail        "Wishing You a Wonderful Birthday!"   00:01   OFF
Inactive-user-email  "We Miss You at Our HRMex!"           07:00   OFF
Daily Report Email   "Daily Attendance Report"             09:00   OFF
```
Form: `Name`, `Subject`, **`Email From {Location | Company | User | Employee | isHOD |
ReportingManager}`**, `Email Time`, `☐ Mail-ON/OFF`.
*Recipients are addressed by **role**, never by typing an address. Copy this.*

**Tab: Auto Jobs** — the cron table. Live rows:
```
Collect_Attendance_Full_Month    02:00   OFF
Calculate_Full_Month_Salary      03:00   OFF
```
Form: `Auto Job Name`, `Auto Job(Hrs)`, `Auto Job(Min)`, `☐ Status`, `[Start]`.
**⭐ So the whole month's payroll can run unattended overnight** — collect attendance at 2am,
calculate salary at 3am. Both are off by default.

---

# 2. MASTER

### 2.1 **Master Setting** — `/Master/Master_Settings.aspx` — 6 tabs + 3 pop-outs (all values read live)

**Tab: Master** — `Salary Heads Column in Excel = 33` · `Email To / CC / BCC` ·
`☑ Show MyDepartment to All` · `☐ Send Mail on Master Change` · `☐ Check User Wise Entry` ·
`☑ Show Badges on ESS` · `Punch mode = 0` · `☐ Manual attendance on ESS` ·
`☐ Notify on bio punch` · `☐ Notify on mobile punch` · `☐ Notify on leave approval` ·
`☐ Notify on request approval` · `☐ Notify birthday` · `☐ Notify salary slip`

**Tab: ESS** — choose a `Category`, then tick which of the **17 day-actions** its employees may
request for themselves: `Add Punch · Leave Entry · Change Shift · Assign WO · Cancel WO · OD Entry ·
OT Sanction · OT Cancel · COFF Generate · OT Cutoff · Delete Leave Entry · Delete OD Entry ·
COFF Cutoff · Delete COFF · Hourly Leave` (+ a search over the options).

**Tab: Leave** — `Leave Type` (which head-type means "leave") · `Auto Leave {Disable | Enable}` ·
`Auto Leave Name {PL|COFF|CL|SL|ML|LOP}` · `COFF Head {…}` · `☑ Attendance Year Same For All`

**Tab: Attendance** — `Attendance Type` · `Absent Head` · `Present Head` · `Extra Hrs Head` ·
`Attendance Order By {Emp Code | Emp Name}` · `☑ Auto Mobile Punch Approve` ·
`☐ Separate Holiday Minutes` · `☐ Separate Holiday OT` · `☑ Show Report With Full Absent` ·
`☐ Delete Shift Schedule On Blank` · `Min Difference Between Punches = 1` ·
`Max Difference Between Punches = 3` · `Auto OT Limit = 1440` · `Round Total Duration = -1` ·
`☑ Auto OT Sanction`

**Tab: Payroll** — `Pay Cycle {Default | Custom}` · `Cycle Start Date {0..31}` ·
`Cycle End Date {0..31}` · `Allowance Type` · `Deduction Type` · then the **head map**:
`PT Head · PF Head · Loan Head · OT Hrs Head · OT Head · Bonus Head · ESIC Head` ·
and the divisor basis **`○ Month Day  ● Work Day`**.
*(Month Day = salary ÷ calendar days; Work Day = salary ÷ working days. One radio, every payslip.)*

**Tab: Canteen** — `○ On Timing / ○ On Workcode` · `☐ Enable Print Receipt` · `Select Printer` ·
`[Test Printer]`

**Pop-out: OT Slab Configuration** *(opened live)* — per `Company` × `Category`, rows of
`From OT (in minutes) | To OT (in minutes) | Set OT (in minutes) | Total Hrs` (shows `0h 00m (0.00 hrs)`).
*Banding/rounding of overtime.*
**Pop-out: Holiday Slab Configuration** — same shape for holiday working.
**Pop-out: Late/Early Reason Master** — the reason list used by Late/Early Entry.

### 2.2 **Employee Setting** — `/Master/Employee_Settings.aspx` — 2 tabs

**Emp Master** — `Code Length` · `☐ Enable Auto Code` · `Short Code Source` ·
`☐ Aadhar Card Mandatory` · `☐ PAN Card Mandatory` · `☐ Bank Details Mandatory` ·
`☐ Joining Date Required` · `☐ Age Restriction` · `☐ Verify Aadhar on Resignation` ·
`☐ Verify Aadhar by Location` · `Primary Weekly Off` · `☐ Enable 2nd Week Off` + `2nd Week Off Day`
+ which weeks `☐1st ☐2nd ☐3rd ☐4th ☐5th` · `Calculation Method`

**Onboard** — which fields the *candidate* must complete on their own onboarding form:
`☐ Bank Details · ☐ Employee Photo · ☐ Date of Birth · ☐ Gender · ☐ Emergency Contact · ☐ Nominee ·
☐ Cast · ☐ Blood Group · ☐ Address · ☐ Emergency Contact 2`

## 2.3 Master ▸ Master — the 20 reference tables

All share one shape: searchable list, `Items per page {5|10|13|15|25}`, `[New X]`, inline modal form,
row `[✏ Edit] [🗑 Delete]`. **Verified behaviour** (§17): required-field validation via toast,
duplicate names rejected, delete asks a **named** confirmation.

| # | Screen | Fields | Grid |
|---|---|---|---|
| 1 | **Location Master** | `Location Name*`, `Print Label`, `Mail ID`, `CC Mail ID`, `Employee Short Code` | Location Name · Print Label · Actions |
| 2 | **Company Master** | (list only in demo) | Company Name · Location · Actions |
| 3 | **Division Master** | `Division Name*`, `Print Label` | Division Name · Print Label · Actions |
| 4 | **Department Master** | `Department Name*`, `Print Label` | Department Name · Print Label · Actions |
| 5 | **Section Master** | `Section Name*`, `Print Label` | Section Name · Print Label · Actions |
| 6 | **Designation Master** | `Designation Name*`, **`☐ Is HOD?`** | Designation Name · Is HOD · Actions |
| 7 | **Costcenter Master** | `Cost Center Name*`, `Print Label` | Cost Center Name · Print Label · Actions |
| 8 | **Shift Master** | see below | Shift Name · Short Name · Begin · End · Actions |
| 9 | **Shift Group** | `Shift Group Name*`, `Short Name*` + child grid `Shift Name | Action` | Shift Group Name · Short Name · Actions |
| 10 | **Holiday Group** | `Holiday Group Name*` | Holiday Group Name · Actions |
| 11 | **Salary Heads** | §2.4 | Heads Name · Type · Order No. · Actions |
| 12 | **Category Master** | `Category Name` | Category 1..7 in demo |
| 13 | **Bank Master** | `Bank Name*` | Bank Name · Actions (19 banks in demo) |
| 14 | **Level Master** | `Level Name*` | Level Name · Actions |
| 15 | **Leave Level Master** | `Level Name`, `☐ Allow Quarter leave` → the leave policy grid (§5.2) | Level list |
| 16 | **Hierarchy Master** | §2.5 | Hierarchy Name · Edit · Delete |
| 17 | **Document Master** | `Document Name`, `Document Print Lable` | Document Name · Print Lable |
| 18 | **Education Master** | `Education Name`, `Education Print Lable`, `Edu_order BY` | Name · Print Lable · OrderBy |
| 19 | **Asset Master** | `Asset Name*` | Asset Name · Actions |
| 20 | **Reimbursement Master** | `Reimbursement Name*`, `Print Label`, `Reimbursement Head*`, `☐ Show Date Selection` + `Date Selection Mode {Single Date | Date Range}`, `☐ Show Amount` + `Amount Source {Manual Entry | From Payroll (Auto)}`, `☐ Show Kilometers` | Name · Head · Actions |

**Shift Master — the full form** (the richest in the product):
```
Shift Name*      Short Name*     Begin Time*    End Time*
First Half Out   Second Half In  ☐ Enable
Break Out        Break In        ☐ Duration + Mins      ☐ Deduct Lunch
☐ Begin Before   ☐ End After     ☐ Shift End            ☐ Grace Time
Halfday Mins     Absent Mins     Quarter Mins           Quarter Absent
☐ Next Day OT    ☐ Night Shift   Extra Dur
```
`Halfday Mins` = work below this ⇒ half day. `Absent Mins` = below this ⇒ absent.
`Begin Before / End After / Shift End` = how far outside the shift a punch still counts.
`Night Shift` + `Next Day OT` handle shifts crossing midnight.
Live shift codes: `GS · NS · DS · NIS · GS1 · GS2 · GSH · GS19T · GS9T · NGS · PGSH`.

**Reimbursement Master is the clever one** — it *defines the shape of the claim form*: single date or
range, typed amount or auto-from-payroll, and whether kilometres are collected (travel claims).

### 2.4 **Salary Heads Master** — `/Master/SalaryHeads_Mst.aspx`
List with `Search`, `Type:`, `Order By: {OrderNo | Heads Name}`, `Sort: {Ascending | Descending}`,
`[Add Salary Head]`. Grid `Heads Name | Type | Order No. | Actions`.

**Form** (`SalaryHeads_AU.aspx`):
```
Type* {Allowence | Deduction | Attendance | Leave | SYSTEMS}   Heads Name*
Print Label*                                                   Formula Field*
Order No*
☐ Is Gross           ☐ Is Visible
☐ Is Basic           ☐ Is Time Field
☐ Is CTC Component   ☑ Roundoff value           ← default ON
☑ Is Calculable      ☐ Is TDS Calculable        ← Is Calculable default ON
☐ Is Reimbursement Head    ☐ Is Reimbursement Calculable
```
⚠️ **This screen is dead in the live demo** — red toast *"Error loading salary heads: Invalid column
name 'IsSystemGenerated'"*, grid reads `1-5 of 0 items`. Their code is ahead of their database.

Live heads observed elsewhere: `BASIC · BASICDA · VDA · HRA · Conveyance · Education · OTHERS ·
PERQUISITES · PRODUCTION · SpecialAllowence · FIX_INCENTIVE · Monthly Incentive · Travel Allowance ·
ROOM_RENT · Attendance Bonus · OT · OT HRS · WD · Bonus · Reimbursement · Canteen` (earnings);
`PF · ESIC · PT · TDS · LOAN · HOME_LOAN · Advance · Other Deduction` (deductions);
`P · A · H · MD · WO · WOP · HP · OD · COFF · LTD · SHL · ExtraHRS · DLD · SPL` (attendance);
`PL · CL · SL · ML · LOP · COFF` (leave). **43 heads total.**

### 2.5 **Hierarchy Master** — `/Master/Hierarchy_Mst.aspx`
Live list: `Admin · Default · Accounts · RM Store · PRODUCTION · MAINTENANCE · Purchase · HR ·
Dispatch · Loading / Unloading · Loading / Unloading · QC` ⚠️ (duplicated row).
Form:
```
Hierarchy Name
☐ Allow Approval Before Authentication?
☐ is L1 Authentication Required? → Level1 Authenticator1 / Authenticator2
☐ is L2 …                        → Level2 Authenticator1 / Authenticator2
☐ is L3 … , ☐ is L4 …            (each with two named employees)
Approver 1 · Approver 2 · Approver 3 · Approver 4
```
Two authenticators per level so one absence doesn't stall approvals.

### 2.6 **Department Man power** — `/Master/Department_Designations.aspx`
Grid `Company Name | Department Name | Designation Name | Male | Female` with sortable columns and a
search. `[Update Man Power]` → modal grid `Designation Name | Male | Female`.
*This is **planned** headcount by gender; the dashboard's "Department Vacancies: 80" = plan − actual.*

### 2.7 **Employee Master** — `/Master/Employee_Mst.aspx` (930 KB page)
- **31 columns**: Emp Code, Device Code, Employee Name, Location, Gender, DOB, Joining Date, Resign
  Date, Mobile, Email, Status, Company, Division, Department, Category, Designation, Section, Shift
  Group, Weekly Off, Holiday Group, Level, Leave Level, Aadhar, UAN, PAN, ESIC No, Driving Licence,
  Bank Account, IFSC, Bank Name, Last Punch.
- Second header row = **per-column search box + per-column filter icon**.
- `[New Employee] [Export] [Import] [Grid] [List] [Reset]`, `☐ Responsive (+) Mode`.
- Row menu → **View · Edit · Resign · Delete** (`employeeRowCommandAjax(id,'ViewData')`).
- **Bulk resign** modal: `○ Last Punch Date · ○ Custom Resign Date · ○ Last Punch Date to Month End`,
  then `[Update] [Update & Block] [Update & Delete]`.
- Footer: `License / Active Emp : 1000 / 124` · `Selected : 0` · `Showing 1-30 of 124` · `Page 1 of 5`.
- Live "Last Punch" per row with device (`30-06-2026 09:11 - Vapi`).

**Employee detail** (`Employee_AU.aspx`) — header block + **10 collapsible sections**:

| Section | Fields |
|---|---|
| **Employee Detail** | Aadhar No · PAN No · Emp Code · Device Code · Employee Name · Gender · Designation · DOB · Status {Working\|Resign} · Joining Date · photo upload · **`[Upload to Device]`** + device picker · then Location · Company · Division · Department · Section · Category · Shift Group · Holiday Group · Level · Leave Level · CostCenter · Reporting Manager · Weekly Off `{Sun..Sat \| No WO \| as Category}` · OT `{Not Applicable \| Applicable}` · `☐ 2nd WO` + Weekly Off 2 + which weeks `☐1st..☐5th` |
| **Address** | Current Address · Permanent Address · `☐ Same As Current Address` · Address Line 1/2 · Landmark · District · City · State · Country · Pincode |
| **Contact Detail** | Mobile Number · Email Address · Emergency Contact · Emergency Contact 2 · Driving Licence Number |
| **Documents** | repeating: Document Name `{PAN \| Aadhar \| Driving Liences \| Bank Passbook/Cheque book \| OFFER LETTER \| Appointment Letter \| Termination Letter \| Warning Letter \| Voter Id \| 10TH \| 12TH \| GRADUATION}` + Document Number + file |
| **Education Detail** | Education Name `{Graduate Degree \| Master Degree \| Diploma \| 12th \| 10th}` + number + file |
| **Family Details** | Spouse Name/Mobile/DOB · No. of Children · Father Name/Mobile · Mother Name/Mobile · Emergency Contact 1 & 2 · **Nominee 1 & 2**: Name, Relationship, DOB, Mobile, `☐ Is Minor?` → Guardian Name + Guardian Rel |
| **Assets Detaill** | Asset Name `{SMART MOBILE PHONES \| KEYPAD MOBILE PHONES \| MOTORCYCLES \| SCOOTY \| LAPTOP \| DESKTOP \| SIM CARD}` · Make · Model No · Serial No · Value · Remark |
| **Salary Details** | UAN Number · PF Number · ESIC Number · Bank Name · Bank A/c Number · IFSC Code · **CTC Amount** · `CTC Type {Daily \| Monthly \| Yearly}` · Daily CTC · **OT Per-hour rate** · Pay scale · then two grids: **ALLOWANCE** `Heads Name \| Condition \| Wages Amount` and **DEDUCTION** `Heads Name \| Condition \| Wages Amount \| CTC Component` |
| **Leave Detail** | grid `Leave Name \| Balance` (editable opening balances) |
| **Hierarchy Level and Notification** | Hirarchy Group · **Level In Hierarchy** `{General \| L1 \| L2 \| L3 \| L4 \| L5}` · Notification `{No \| Yes}` · **ESS Password** · `☐ Block Employee ESS` |
| **Other Details** | Caste `{General Class \| OBC \| SC \| ST}` · Blood Group |

**Live salary example (EMP001, CTC ₹80,520/month):**
```
BASICDA          40,260   (50% of CTC)
HRA              16,104   (40% of BASICDA)
SpecialAllowence 24,156   (balancing figure)
                 ------
                 80,520 = CTC ✔
PF   Condition=1  Amount=1800    ← Condition flips a head between formula-driven and fixed
```

### 2.8 **Employee Onboarding** — `/Master/Employee_Onboard_Home.aspx`
Grid `TempID | Employee Name | Company | Status | Emp Respond | Action`, search by TempID/Name,
`Total: 13`, `[New Onboard]`. Live rows all show `Status = Pending`, `Emp Respond = Pending`.
**New Onboard form is deliberately tiny:** `Employee Name`, `Email` ✉, `Phone Number` ☎, `Company`,
`Department`, `Designation`, `[Onboard]`. The candidate then fills the fields chosen in
Employee Settings ▸ Onboard. **Two independent statuses** — HR side and candidate side.

## 2.9 Master ▸ Employee Offboarding

**Full and Final Master** — `/FullNFinal/FullNFinal_Mst.aspx`
FNF has its **own head list**: `# | Heads Name | Print Label | Type | Order No | Actions`,
`[Add New Head]` (`Type`, `Heads Name`, `Print Label`, `Order No`), filters
`Order By {Order No | Head Name}` + `Sort Direction` + `-- All Types --` + `[Apply Filter] [Clear]`.

`[FNF Settings]` modal *(opened live)*:
```
Gratuity   [formula textarea]  ✔ Verify
Notice Pay [formula textarea]  ✔ Verify
Bonus      [formula textarea]  ✔ Verify
Gratuity Eligibility (Years) = 60     Round off Months = 6      ☐ Has Notice Period
☐ Is FNF Required        FNF Required Category [multi-select]
FNF form display: ☑ Show Salary Structure ☑ Show Earnings ☑ Show Deductions
                  ☑ Show Asset Details   ☑ Show Loan Recovery
```
**⭐ The `✔ Verify` link beside each formula validates the expression before saving.**

**Full and Final Settlement** — `/FullNFinal/FullandFinal.aspx`
Three-bucket board with counts: **FNF not started (0) · FNF in progress (0) · FNF completed (0)** +
status dropdown `{Settlement Not Yet Started | Settlement Started | Settlement Completed}` + search.

---

# 3. HRMS

### 3.1 **IT Declaration** — `/HRMS/IT_Declare_List.aspx` → `/HRMS/IT_Declaration.aspx`
**A complete Indian income-tax / TDS engine.** Opened live for EMP001.

**List screen:** filters `Category · Company · Division · Department · Status {All|Working|Resign} ·
Year {2024-25 | 2023-24 | 2022-23}` + `[Filter]`.
Grid `☐ Lock | Emp Code | Employee Name | Location | Company | Division | Department | Category |
[IT Declaration]` — a **per-employee Lock** so a declaration can't change after cut-off.
Buttons `[TaxProjection] [Reprocess TDS] [HRMS Settings]`.
**HRMS Settings** modal: `☐ Round the values?`, `Type of rounding {Round to Nearest (Round Off) |
Round Down (Floor) | Round Up (Ceil)}`, `Round To`.

**The declaration screen itself:**
- Header: `Year {2024-25 | 2023-24 | 2022-23}` · `Emp Code` · `Employee Name` ·
  **`Regime {Old Regime | New Regime}`** · **`[Compare]`** (compares the two regimes) ·
  **`Form 16`** link.
- **8 tabs:** `IT Declaration · HRA Declaration · Housing Property - SelfOccupied ·
  Housing Property - LetOut · Income From Previous Employment · Other Income · Other Deduction ·
  Already Paid Tax`
- **Exemption accordions:** `80EE - Interest on Housing Loan · C - Deduction Under Chapter VI A ·
  D - Rajiv Gandhi Equity Saving Scheme · E - Medical Insurance Premium ·
  F - Medical Treatment for Handicapped Dependents`
- Each accordion holds a grid **`Particular | Max. Limit | Declared Amount | Actual Amount |
  [Download]`** — e.g. `80EE - interest on home loan | 200000 | 0 | 0`.
  **⭐ Declared vs Actual is the right model**: employee declares in April, submits proof later, HR
  enters Actual, TDS recomputes. `[Download]` fetches the uploaded proof.
- **`[Calculate]`** then a computation strip (live values for EMP001):
```
Total Income 676368 | ITD Exempt 0 | HRA Exempt 0 | Std Dedc 50000 | Total Exempt 50000
Taxable inc 626368 | Net Tax 11318 | Rebate 11318 | Surcharge 0 | Edu Cess 0
Total Tax 0 | Already Paid Tax 0 | Payable Tax 0
```

## 3.2 HRMS ▸ PMS (performance)

**KRA Master** — `KRA Name`, `Description`, `Department`, **`Weightage %`**, `☐ Active`,
`[Save] [Clear / New]`. Grid `KRA Name | Description | Department | Weightage % | Status |
Created By | Created Date | Action`.

**KPI Master** *(opened live)* — `KRA*` (parent), `KPI Name*`, `Description`, `Target value`,
**`Unit of measure* {Count (#) | Hours (hr) | Percentage (%) | Rupee (₹)}`**,
**`Calculation Type* {Higher is better | Lower is better | Range}`**,
`Weightage (%)` shown as *"(from KRA Master)"* — inherited, not typed. `☐ Active`.
Grid `KRA | KPI Name | Target | Unit | Weight % | Calculation Type | Min | Max | Status |
Created By | Created | Action`, with **per-column sort arrows AND per-column filter dropdowns**.
Live rows: `Test2 / Increase production / 100.0000 / Hours / 100.00 / HIGHER_IS_BETTER / Active`.
⚠️ Min and Max render as `â€"` (encoding bug).

**PMS Report** — `Emp Code | Employee Name | Department | Designation | Period | Assigned KPI |
KPI created by | KPI definition status | Total KPI Score | Total KRA Score | Final rating (Feedback)
| Approval | Stage | Review Date`. `[Filters] [Refresh]`.

---

# 4. ATTENDANCE

### 4.1 **Device Logs** — `/Attendance/Device_Logs.aspx`
Filters `Date From/To · Employee Name · Category · Company · Division · Department`, `[Show] [Excel]`.
`[Add Manual Punch]` modal: `Device Code {GPPI0001…}`, `Employee Name`, `Log Date`,
`Device Name {ME | ME(IN) | ME(OUT)}`, `Remark`.

### 4.2 **Late Early Entry** — `/Attendance/LateEarlyEntry.aspx`
`Date From/To` + `[Show]`, `[New Entry]`, search. Reasons come from the Late/Early Reason Master.

### 4.3 **Logs Approval** — `/Attendance/Logs_Approval.aspx`
Same filter bar + `[Show] [Excel]`. Where manual/mobile punches wait for approval before counting.

### 4.4 **Holiday** — `/Attendance/Holiday_Mst.aspx`
`Holiday Group {All | Default | BAKRA EID | Eid ul Fittar | specila}` + `Year {2022..2027}`.
Grid `Holiday Name | Holiday Date`. Form: `Holiday Group`, `Holiday Name`, `Holiday Date`,
**`Holiday Type {FullDay | HalfDay}`**.

### 4.5 **OD Entry** (on duty) — `/Attendance/OD_Entry.aspx`
Full filter bar. Grid `Emp Code | Emp Name | OD Date | OD Status`.
Form: `Employee Name`, `OD Date From`, `OD Date To`, `OD Status {FullDay | HalfDay}`,
`OT Minutes`, `Extra Work`, `Remark`.

### 4.6 **COFF** (compensatory off) — `/Attendance/COFFGenerate.aspx` *(opened live)*
Filters `Date From/To · Employee · Category · Company · Division · Department`.
Buttons `[Show] [Generate All] [Remove All]` and print links
`[Print this list] [Print consumed & expired] [Print all lists] [Hide lists]`.
Empty state: *"Click **Show** to load COFF data."*
Five tabs with live counts, each its own grid:
```
candidates              EMPCODE | EMPLOYEE NAME | DATE | IN TIME | OUT TIME | STATUS | SHIFT
Consumed COFF (0)       EMPCODE | NAME | COFF DATE | CREDIT | EXPIRY | CONSUMED ON
Upcoming expiry (0)     EMPCODE | NAME | COFF DATE | CREDIT | EXPIRY | DAYS LEFT | EXTENDED
Already expired (0)     EMPCODE | NAME | COFF DATE | CREDIT | EXPIRY | DAYS OVER | EXTENDED
Generated (by employee) EMPCODE | EMPLOYEE NAME | NO. OF COFF (ROWS) | TOTAL CREDIT (DAYS)
```

### 4.7 **Attendace Voucher** *(sic)* — `/Attendance/MonthlyAttVoucher.aspx` (403 KB)
The operational heart. Month stepper `[<] Aug-2026 [>]`, search + `[Filter]`, download.
**Drill-down tree** with breadcrumb, verified live:
`Home / Location 2 / Company 2 / Division 2 / Marketing / EMP001:Test 1`.
Page toggles `Multiple Punch` · `Punch Device`. Links `[Device logs] [Print] [Recalculate]`.

**Per-employee month grid:**
`Date | In Time | Out Time | Work Duration | OT | COFF | E-Work | Total Dur | Status | Shift |
Late By | Early By | SS | Day | HPMinutes | [Action ▾]`

Footer chips (live for EMP001 Aug-2026): `✖ A = 12 · 🏠 WO = 3 · H = 1 · 🕐 OT = 0:0 · E-Work = 0:0`

**⭐ The `[Action ▾]` on every single day — all 17 options, read from the live `<select>`:**
```
--Select--        Add Punch          Leave Entry        Change Shift
Assign WO         Cancel WO          OD Entry           OT Sanction
OT Cancel         COFF Generate      OT Cutoff          Delete Leave Entry
Delete OD Entry   COFF Cutoff        Delete COFF        Re-Assign Holiday
Cancel Holiday    Short Leave
```
Their modals: **Apply Leave** (`Leave Status`, `Entry From/To Date`, `Leave Type`, `Remark`) ·
**COFF Generate** (`COFF Status {FullDay|HalfDay}`, `WOP Date`, `Remark`) ·
**Manual Log Entry** (`Log Date`, `○ Punch IN / ○ Punch OUT`) ·
**Change Shift** (`Shift {GS|NS|DS|NIS|GS1|GS2|GSH|GS19T|GS9T|NGS|PGSH}`) ·
**Official Gatepass Entry** (`Gate Out`, `Gate In`, `Duration`, `Approved Duration`) ·
**OD Entry** (`OD Date`, `OD Status`, `OT Minutes`, `Extra Work`) ·
**OT Sanction** (`OT Date`, `OT Hrs` / `OT Duration`) ·
**COFF Cutoff** (`COFF Date`, `COFF Minutes`, `COFF Hrs`) · **Apply Short Leave** (`Hourly Leave Date`).

Statuses seen live: `P · A · H · WO · WOP · HP · OD · COFF · MissPunch · NSF · SHL · LTD · SPL · MD`.

### 4.8 **Attendance Checklist** — `/Attendance/AttendanceChecklist.aspx`
`Att From/To · Location · Category · Company · Division · Department ·`
**`Status {All | Present | Absent | WeeklyOFF | Holiday | OnLeave | MissPunch | NSF | Miss Punch &
NSF}`** · `Order By {Company_Name,EmployeeName | EmpCode | EmployeeName | Company_Name |
Company_Name,EmpCode | intime | Company_Name,Category_Name | Company_Name,Department_Name |
Department_Name}` · `Sort by`. *The "who is wrong today" screen.*

### 4.9 **Shift Shedule** *(sic)* — `/Attendance/Shift_Shedule_View.aspx` (227 KB)
Month picker + search + `[Filter]`. **Three ways to fill the roster:**
`[Excel Import]` · `[Manual Generate]` (`Employee`, `Entry From Date`, `Shift`, `☐ WO`) ·
**`[Auto Generate]`** (modal: `Month`, `Company`, `Department`, `Category`, `Employee`, `[Generate]`).

## 4.10 Attendance ▸ Leave

**Leave Type** — `/Leave/LeaveTypes_Mst.aspx` · Grid `Leave Type Name | Short Name`.
Form (opened live): `Leave Type Name`, `Short Name`, `☐ Is Hourly Leave`. **That's all** — the rules
live one layer up. Demo types: **PL · COFF · CL · SL · ML · LOP**.

**Leave Entry** — `/Leave/LeaveEntry_Mst.aspx` → `LeaveEntry_AU.aspx` *(opened live)*
**A bulk-apply screen**: set `Leave Status {FullDay|…}`, `From Date`, `To Date`, `Leave Type {PL…}`,
then tick employees in a grid
`☐ | Emp ID | Emp Code | Employee Name | Location | Company | Division | Department | Category |
**Balance Leave**` and `[Save]`.
*One date range applied to many people, with each person's balance visible while you choose. Copy this.*

**Leave Opening** — `Leave Year {2022..2027}`, `Leave Type`, org filters, `[Filter]`, `[Excel Import]`.

**Leave CarryForward** — `/Leave/Leave_Transaction.aspx` *(opened live)* — the best-designed bulk job.
Helper text on screen: *"Select rows in the grid to create a leave-type batch. **One batch is created
per leave type** (e.g. EL separately from PL). Batch is optional for direct processing."*
Filters `Leave Month · Leave Year · Leave Type (carry forward) · Category · Company · Division ·
Department` + search, `[Show] [Export] [Show Batch Panel]`.
Main grid `☐ | EMP CODE | EMPLOYEE NAME | COMPANY NAME | LEAVE | OPENING PRESENT | OPENING ABSENT |
PRESENT | ABSENT | PREV. BALANCE | THIS YEAR | TOTAL BALANCE`.
`[Preview & create batch]` → modal `Include | Emp code | Employee | Company | Leave type | Balance` +
`Batch name prefix` → `[Create batch(es)]`.
Batch panel `Batch Name | Leave Type | Status | Total | Pending | Done | Failed | Action` with
`[Run full batch] [Proceed selected]`, per-row results
`Emp Code | Employee | Leave | Allowed | Status | Message | Rev | Rem`,
plus `[Carry forward history report]`.
Empty state: *"No data loaded. Set filters and click Show."*
⚠️ The `Leave Type` dropdown's default option renders as `â€"`.

**Leave Credit** — `Salary Month`, `Leave Type`, `[Show]`, `[Excel Import]`. Monthly accrual posting.

**Leave enCashment** — `Select Date`, `Emp Name`, `Leave Type`, `Leaves to Encash`, org filters,
`[Apply Filter] [Excel Import] [Save]`.
Grid `EMP CODE | EMPLOYEE NAME | AVAILABLE BALANCE | LEAVES ENCASHED | AMOUNT`.

**Leave Statement** — `/Leave/Leave_Statement.aspx` *(run live)*
Advanced Filters `Leave Month · Leave Year · Leave Type · Category · Company · Division · Department`
+ `[Show] [Export]` + a `[Settings]` modal (`☐ Show Present`) + a type-to-filter box.
**Real output columns:**
`EmpCode | EmployeeName | Company_Name | LeaveName | OpeningLeave | CreditLeave | DebitLeave |
EnCashLeave | **AdvanceLeave** | balanceLeave` — one row per employee per leave type, employee cell
row-span merged. (`AdvanceLeave` = leave taken before it accrued.)

**Leave Ledger** — `Employee Name`, `Leave Year`, `Salary Month to`, `Leave Type`, `[Show] [Print]`.
Grid `Period | Leave Type | Opening Balance | Credit | Debit | Encash | Closing Balance`.

### 4.11 **Attendance Calculation** — `/Attendance/Attendance_Calculation.aspx` *(opened live)*
`Date From` / `Date To`, then checkbox trees for `Employee · Category · Company · Division ·
Department` (each with **Select All**), a radio **`○ Pending Entries · ○ All Entries`**,
`[Calculate]`, a **progress bar (0%)** and an **error textarea**.
*The button that turns raw punches into attendance-day rows. Incremental vs full recompute + visible
progress + a visible error log — copy all three.*

---

# 5. LOAN AND ADVANCE

Types throughout: **`LOAN` · `ADVANCE` · `HOME_LOAN`**.

| Screen | Contents |
|---|---|
| **Loan** `/Transaction/Emp_Loan.aspx` | Grid `EmpCode \| Employee Name \| Loan \| Installment \| Date`, `[Add] [Edit] [Delete]`. **Form** *(opened live)*: `Select Employee`, `Loan Type {LOAN\|ADVANCE\|HOME_LOAN}`, `Loan Amount`, `Installment Amount`, `Date`. ⚠️ **No interest-rate field**, yet the payslip has an Interest column. |
| **Loan Manage** `/Transaction/Loan_Advance_Manage.aspx` | `Manage Month`, `Emp Name`, `Trans type`, `Amount`, `[Save]` + search block with org filters, `[Show] [Excel Export]` — adjust this month's deduction |
| **Loan Prepayment** `/Transaction/Loan_Prepayment.aspx` | `payment date`, `Emp Name`, `Trans type`, `Amount`, `Remark`, `[Save]` + the same search block |
| **Advance** `/Transaction/Emp_Advance.aspx` | Grid `EmpCode \| Employee Name \| Advance`, `[Add] [Edit] [Delete]` |
| **Loan Opening** `/Transaction/Loan_Opening.aspx` | Grid `Emp Code \| Employee Name \| Type \| Loan \| Installment \| Date`, `[Add] [Excel Import]` |
| **Loan Statement** `/Transaction/Loan_Statement.aspx` | `MMM/yyyy`, `Loan Type {All\|LOAN\|ADVANCE\|HOME_LOAN}` + org filters, `[Show] [Excel Export]` |
| **Loan Ledger** `/Transaction/Loan_Ledger.aspx` | `Employee Name`, `Att Month From/To`, `Loan Type`, `[Show] [Print]` |

Reaches payroll via the **`Loan Head`** map. Payslip shows
`LOAN NAME | NEW LOAN | INSTALLMENT | INTEREST | BALANCE`.

---

# 6. UTILITY

### 6.1 **Device Management** — `/Utilitty/DeviceManagement.aspx` *(opened live)*
Tabs **Active Devices / Inactive Devices**. Grid `Device ID | Device Name | Type | IP Address |
Company | Serial No | **Last Ping** | **Connection** | Active Status | Actions`.
`[New Device] [Refresh] [Active Registration]`.
**Device form:**
```
Device Name       Attndance Direction {Alter | In | Out | Canteen | Access Control}
Device Type {Normal | AI}     Serial No       IP Address
☐ Is Attendance   TimeZone    Device Company {Others | HikVision | Dahua}
☐ Is Active       Device Password
```
**Dahua Active Registration** panel: `Server IP (0.0.0.0 = all interfaces)`, `Server Port (TCP)`,
`[Start] [Stop]` — a push server the devices dial into. A device may have **slave devices**.

### 6.2 **Device Commands** — `/Utilitty/Device_Commands.aspx`
`Command Name {Reset Att Logs | Upload Users to Device | Restart Device | Delete User | Block User |
UnBlock User | Enroll User Face | Enroll User Finger Print | Clear Logs From Device}` → `[Execute]`.
Device grid `Device ID | Device Name | Serial No | Out Time | Status`; employee grid
`Device Code | Emp Code | Employee Name | Location | Company | Division | Department | Category`.
Command log filtered by `Device {All | Sarigam | Vapi}` + `Date From/To`.
**User Enrollment** modal: `Device`, `Device Code`, `FP Index No`, `☐ Overwite`.

### 6.3 **DC(Hikvision)** — `/Utilitty/Device_Commands_Hikvision.aspx` — same screen, HikVision variant.

### 6.4 **Upload User To Device** — `/Utilitty/Upload_User.aspx` (259 KB)
Org filters + `Status {All | Working | Resign}`. What to push:
`☐ List All Employees With Bio`, `☐ UserInfo`, `☐ User Pic`, and `○ Cards / ○ FingerPrints / ○ Face`.
Employee grid adds `CardNo | Finger | Face | AI Face` per person. `[Upload]`.

### 6.5 **Blocked Employee** — `/Utilitty/Block_Users.aspx` — device-level block/unblock.

### 6.6 **Employee Import** — `/Utilitty/Employee_Import.aspx`
`Import Employee` (file) **or** `Paste Data Here` → `[Preview]`, with an
**Employee Import File Format** help block and an **Error Occured** textarea.

### 6.7 **Payroll Month** — `/Utilitty/Payroll_Months.aspx` *(opened live)* ⚠️ **important**
Grid `Salary Month Name | IsLock | IsFinal | [Edit]`.
Live: Jun-2026 back through Nov-2025 all show **IsLock ON and IsFinal ON**.
`[Edit]` opens *"Salary Month - 2 companies found"* → a per-company grid
`Company Name | IsLock | IsFinal` with **the toggles directly editable**.
**⚠️ So a locked-and-finalised payroll month can be re-opened with one toggle, per company, with no
reason, no second confirmation, no approval — and (see §1.5) nothing is written to the audit log.
The "immutability" is policy, not enforcement.**

### 6.8 **Attendance Year** — `/Utilitty/Att_YearCreate.aspx` *(opened live)*
Grid `Year | Company | Start Month | End Month | Active | Carry Forward | Actions`.
Live: 2022–2027 exist, **only 2026 is Active**, and **every year shows Carry Forward = Pending**
(which is what the login pop-up nags about).
Form: `Company`, `Year`, **`Year type {Calendar year (Jan - Dec) | Financial year}`**,
`FY starts in (month) {January..December}`, `☐ Active/Inactive`, `☐ Done/Pending`.
⚠️ End Month renders as `01 Dec 2027` (should be 31 Dec). ⚠️ `[Delete]` is offered on closed years
with no warning about the leave balances that hang off them.

---

# 7. PAYROLL

### 7.1 **Salary Process** — `/Payroll/PayrollProcess.aspx` *(opened live)*
Month chip strip (`All Months · Aug/2026 · Jun/2026 · May/2026 · … · Dec/2024`) + `[Clear Filter]`
+ `[Add Month]` (modal `Select Month & Year` → `[Save Month]`).
**Grid = one row per Salary Month × Company:**
`Salary Month | Company Name | Employee Count | Batch Remaining | Salary Calculated | Salary Verified
| [+ New Batch] | [⚙ Process Batches] | Lock Status ⏻ | Finalization Status ⏻`
`Batch Remaining` renders **red**; `Salary Calculated = 0` cells shade **pink**.
Live May/2026 Company 2: 124 employees · 13 batch remaining · 121 calculated · 124 verified.
`[+ New Batch]`: `Batch Name`, `Calculation Month`, `[Show]`, then checkbox trees over
`Category / Company / Division / Department`.

### 7.2 **Payroll Batch Details** — `/Payroll/PayrollBatchDetails.aspx?SalaryMonthID=…`
Grid `Batch Name | Total Employees | Month Days | Working Days | Weekly Offs | Holidays |
[Actions ▾ → Batch Emp List · View Batch]`.
Live batches for May-2026 — note how a factory actually thinks:
```
ALL PF STAFF & HOD PARDI       16
ALL PF STAFF & HOD SARIGAM     45
ALL NON PF STAFF & HOD SARIGAM 22
ALL PF WORKERS SARIGAM         10
ALL NON PF WORKERS SARIGAM     18
```

### 7.3 ⭐ **Salary Process (batch runner)** — `/Payroll/SalaryProcessNew.aspx?BatchID=…&ProcessMonth=…`
Stepper: **① Collect Attendance → ② Manual Import → ③ Loan and Advance → ④ Salary Calculation →
⑤ Finilization** *(sic)*. Completed batches mark every step green and read-only
(`step-item disabled completed`).

Header strip: `Month Days · Working Days · Weekly Offs · Holidays` +
`Total Employees · Companies · Categories · New Joinings · Resignations`.
**Footer strip, always visible: `Total Employees · Zero Days In Total · MP/NSF Status`**
— i.e. *how many people would be paid nothing* and *how many have missing punches*. Copy that footer.

- **① Collect Attendance** — `[COLLECT ATTENDANCE] [REFRESH]` + a file/paste importer
  (`Choose file`, `Paste Data Here with Header`, `[Preview]`).
- **② Manual Import** — one block **per manual head**, each with a **Mandatory** badge, a
  *"File is not uploaded"* status, `File Format` link, `Choose file` **or** `Paste Data Here`,
  `[Preview] [Import Data] [Clear]`, a running **Total**, and a grid `Emp Code | Employee Name |
  Amount`. Live blocks: **Advance · Canteen · Monthly Incentive (Total: 80) · OTHERS · Reimbursement**.
- **③ Loan and Advance** — `Loan Month`, `[Show] [Export CSV] [Export Excel]`. Live empty state
  explains itself: *"No Loan Data Available… Employees in this batch may not have any active loans
  for May-2026. Try selecting a different month or check if loans are configured for this batch."*
- **④ Salary Calculation** — progress bar + *"Remaining time: calculating…"*.
- **⑤ Finilization** — five cards + `[✓ Verified & Completed]`. Live figures, batch
  *ALL PF STAFF & HOD PARDI*, May-2026, 16 employees:
```
Total Payroll Summary   Gross ₹3,53,646 · Other Earning ₹0 · Total Earning ₹3,53,646
                        Total Deductions ₹17,674 · Net Salary ₹3,35,972
Allowances Breakdown    BASICDA ₹3,92,540 · HRA ₹1,57,020 · SpecialAllowence ₹2,35,512 ·
                        WD ₹189 · **Earned Gross ₹3,53,646**
Other Earnings          OTHERS ₹0 · Monthly Incentive ₹80 · Reimbursement ₹0
Deductions Breakdown    PF ₹16,481 · ESIC ₹1,193 · Total Deduction ₹17,674
Total Liabilities       "No liabilities found"
Total Company Expense   Net Salary ₹3,35,972 + Liabilities ₹0 = ₹3,35,972
```
**Note the two different numbers**: the breakdown shows the *full structure* (₹3,92,540 of BASICDA)
while Gross shows the *attendance-earned* figure (₹3,53,646). See §8.2 — this is the `E`-prefix model.

### 7.4 – 7.17 the rest of Payroll

| Screen | Contents |
|---|---|
| **Employee Wages Edit** `/Payroll/Employee_MstEdit.aspx` | org filters + `[Show] [Excel]` — bulk structure edit |
| **Attendance Import** `/Payroll/AttendanceSummaryImport.aspx` | `Attendance Month` + file **or** paste → `[Preview]` + **Error occured** box |
| **Collect Attendance** `/Payroll/Attendance_Import.aspx` | `Attendance Month`, `Employee`, `Category` + checkbox trees → `[Import]` |
| **Attendance List** `/Payroll/Attendance_View.aspx` | `Att Month` + org filters + `Order By {EmpCode\|EmployeeName\|Department\|Designation\|DOJ\|Division\|Company}` |
| **Wages Import List** `/Payroll/Import_List.aspx` | `Salary Month` + **`Heads {BASIC\|HRA\|Conveyance\|PF\|Education\|OTHERS\|PERQUISITES\|PRODUCTION\|PT\|TDS\|HOME LOAN\|BASICDA\|VDA\|Advance\|Attendance Bonus\|Other Deduction\|OT\|Monthly Incentive\|Travel Allowance\|ROOM RENT}`** → `[Show] [Excel Import]` |
| **Manual Attendance** `/Payroll/Manual_Attendance.aspx` *(live)* | Top card: `Transaction Month`, `Emp Name`, **`Attendance Head {P\|A\|H\|OT HRS\|PL\|WO\|WOP\|HP\|CL\|OD\|COFF\|LTD\|SL\|LateBy\|SHL\|ExtraHRS\|DLD\|SPL\|ML}`**, `Totals`, `[Save] [Excel Import]`. Bottom card: search by month + org filters, `[Show] [Excel Export]` |
| **Manual Wages** `/Payroll/Manual_Wages.aspx` | identical shape for money heads |
| **Salary calculation** `/Reports/Salary_Calculation.aspx` | `Calculation Month`, `Employee`, `Category` + checkbox trees, `[Calculate]`, **Error Occured** textarea, and a **Working days** modal (`Year {2026\|2025\|2024}`, `Working days`, grid `Month \| Working Days`) — *this is how you override the divisor for a short month* |
| **Salary List** `/Payroll/Salary_View.aspx` | `Salary Month` + org filters + `Order By`, `[Show] [Excel Export]` |
| **Salary Import** `/Payroll/Employee_WagesUpdate.aspx` | `INC Month` + file **or** paste → `[Preview]` |
| **Increment Initialize** `/Payroll/IncrementInitialize.aspx` *(live)* | `[New Increment]` → `Increment Name`, `Increment Month`, **`Increment Effective Month`**, `Remark`, then pick employees by `Company/Category/Department/Division` + search + check-all **or** `Paste data` → `[Select from pasted data]`. Batch grid `Name \| Increment Month \| Effective Month \| Remark \| [View] [Proceed] [Cancel]`. **View** modal shows `INCREMENT NAME / MONTH / EFFECTIVE MONTH / CREATED / REMARK` + `Selected employees — 2 employees in this batch` grid `EMP CODE \| EMPLOYEE NAME \| LOCATION \| COMPANY \| DEPARTMENT \| CATEGORY \| STATUS \| **INCREMENT STATUS (Pending)**` |
| **Arrears Calculation** `/Payroll/Arrears.aspx` | Same shape (`Increment Name`, `Increment Month`, `Effective Month`, `Remark`, filter or paste, `[Check] [Save] [Cancel Arrear]`). **Because Effective Month can precede Increment Month, the difference is paid as arrears in the current month — never by editing a closed month.** |
| **Payroll Voucher** `/Payroll/PayRoll_Voucher.aspx` (477 KB) | §7.16 below |
| **Email Salary Slip** `/Payroll/Email_Salary_Slip.aspx` *(live)* | Filters `Salary Month · Company · Department · Category · Division · **Payslip Type {Custom \| With Balance \| Without Balance}** (+ 👁 preview) · Email Status {All\|Pending\|Success}` + page size `{20..1000}`. Buttons `[Apply & Load] [Send Mail (Immediate)] [Send Mail All] [Pause All] [Stop All]`. Grid `☐ \| EMP CODE \| EMPLOYEE NAME \| COMPANY \| DEPARTMENT \| CATEGORY \| EMAIL \| STATUS \| ACTION ▶` — **per-row send button and per-row status**. A pausable, resumable bulk mailer. |

### 7.16 **Payroll Voucher** — the per-employee slip *(opened live for EMP001, May-2026)*
Left: slide-out tree `Location → Company → Division → Department → Employee` with search + `[Filter]`.
Toggles `Leave Hide` / `Loan Hide`; `OrderBY {Emp Code | Emp Name}`; `[Recalculate]`.
Banner: **"Editable Fields: Double-click on highlighted fields to edit → Press Enter to save →
Press Esc to cancel."** Locked months show a **red padlock** on the editable cells.

```
Company header
Employee Information
   LEAVE NAME | OPENING | CREDIT | DEBIT | ENCASH | BALANCE      ("No leave data available")
   LOAN NAME  | NEW LOAN | INSTALLMENT | INTEREST | BALANCE      (PERSONALE LOAN | 0 | 5000 | 0 | 60500)
Attendance          ATTENDANCE | VALUE
Fixed & Earnings    FIXED: BASICDA 40260 · HRA 16104 · FIX_INCENTIVE 0 · OTHERS 0 ·
                           Monthly Incentive 0 · SpecialAllowence 24156 · Reimbursement 0 · WD 0
                    EARNINGS (editable 🔒): OTHERS · Monthly Incentive · Reimbursement
Fixed Deduction &   FIXED DEDUCTION: LOAN 0 · PF 1 · Advance 0 · Other Deduction 0 · Canteen 0
Deduction           DEDUCTION: LOAN 5000 · PF 1800 · Advance (editable) · Canteen (editable)
TotalDays 0 | TotalFixed 80520 | TotalEarnings 0 | TotalDeductions 6801
Net Salary :- ₹ -6,801.00
```
⚠️ **That negative net salary is rendered in green**, with nothing blocking it.
⚠️ The header read *"Salary Slip for Month of Aug-2026"* while the picker read *May-2026*.
⚠️ Pressing next/prev month with no employee selected throws a blocking modal
*"No employee list available. Please select an employee from the tree."*

---

# 8. REPORTS — the complete catalogue, **with what each one actually returns**

**Architecture:** `/Reports/Reports.aspx` lists 14 coloured collapsible groups holding **72 links**,
which map to **~30 distinct `.aspx` report pages** (most links are the same page with a preselected
`ReportType`; several pages expose *more* variants in their dropdown than the menu shows).
Output renders in **`/Reports/Report_Viewer.aspx` — a Microsoft RDLC/SSRS ReportViewer** with paging,
Find/Next, and export to **Excel / PDF / Word**. Which formats a user may pick is limited by their
**UserType ▸ Report Type** (§1.2).

**The universal report screen** = report parameters → a collapsible **Filter** card (the six org
dropdowns, often as checkbox trees with *Select All*) → `Report Format {PDF | Excel}` → `[Generate]`
(or `[Show]` for the ones that render an HTML grid in-page).

## 8.1 Employee Reports
| Report | Page | Parameters |
|---|---|---|
| Employee Details | `Employee_Report.aspx` | Category · Company · Division · Department · **Location** · Status {All\|Working\|Resign} · `[Filter] [Add] [Excel]` |
| Employee form | `Employee_Form.aspx` | Category · Company · Division · Department · Status |
| Employee ID Card | `Employee_ID_Card.aspx` | same + **`ID Format {Vertical | Horizontal}`** |
| ⚠️ `dthffyjh` | (custom report) | test junk left in the live demo |

## 8.2 ⭐ Payroll Reports — and the single most important discovery
| Report | Page | Parameters |
|---|---|---|
| **Salary Statement** | `Salary_Statement.aspx?ReportType=SalaryStatement` | Salary Month · **`Report Type {Normal \| CTC \| Balance With CTC \| Balance}`** · Employee · Category/Company/Division/Department trees · `Report Format {PDF\|Excel}` |
| Salary Slip | `…?ReportType=SalarySlip` | + `Report Type {Salary Slip With Balance \| Salary Slip}` |
| Loan Report | `…?ReportType=LoanReport` | `Report Type {Loan Report}` |
| **Department / Designation / Costcentre Wise Summary** | `Payroll_Summary_Report.aspx` | Month · `Report Type {Summary Report}` · **`Group By {Costcentre \| Designation \| Department}`** · Category ⚠️ · Company · Division · Department · Search · `[Generate] [Excel Export]` |
| Wages Register | `WagesRegister.aspx` | Salary Month · Category · Company · Division · Department · `Excel Files` picker |
| **ICICI** | `BANKStatement.aspx?ReportType=ICICI` | **Attendance Month + separate Payment Month** · org filters · **`Cheque NO`** · **`BANK ACC NO`** (the paying account) · `Export {PDF\|Excel}` |
| **HDFC** | `BANKStatement_HDFC.aspx` | Att Month · Payment Month · org filters |
| BANK Statement | `BANKStatement.aspx?ReportType=BankAC` | as ICICI |
| **SUDICO** | `BANKStatement_Sudico.aspx` | as ICICI **+ a `Bank {Bank 1..19}` picker** |
| Consolidated Salary Statement | `Consolidated_SalaryStament.aspx` | **Salary Month FROM + TO** (a range) · Employee · trees |
| Pay Slip | `Pay_Slip.aspx` | Salary Month · **`Report Type {With Balance \| Without Balance \| Custom}`** · Employee · trees · Format |

**⭐⭐ Run live — Department Wise Summary, May/2026, Category 4. The real column list:**
```
Department | P | A | WO | WOP | H | HP | OD | PL | CL | COFF | SL | TotalDays
| BASICDA | HRA | FIX_INCENTIVE | OTHERS | Monthly Incentive | SpecialAllowence | Reimbursement | WD | Gross
| EBASICDA | EHRA | EFIX_INCENTIVE | EOTHERS | EMonthly Incentive | ESpecialAllowence | EReimbursement | EWD | EGross
| LOAN | PF | Advance | Other Deduction | Canteen | TotalDeduction | NetSalary
```
Real row (Marketing): `P 95 · A 2 · WO 20 · H 4 · HP 1 · OD 3 · TotalDays 122 ·
BASICDA 18,43,380 · Gross 36,86,760 · **EBASICDA 1,61,413 · EGross 3,22,826** ·
LOAN 40,000 · PF 1,800 · TotalDeduction 41,800 · **NetSalary 2,81,026**` — and
`3,22,826 − 41,800 = 2,81,026` ✔.

> **This is the modelling insight of the whole study: every earning head has TWO columns — the
> structure amount and an `E`-prefixed EARNED amount. `Gross` is the full structure; `EGross` is what
> attendance actually earned; Net = EGross − TotalDeduction.** Build `hr_pay_line` with both
> `fixed_amount` and `earned_amount` from day one.

⚠️ **Two live faults here:** the Category dropdown on this report has **no "All" option** (only
Category 1–7), so you can never see the whole company on one page; and it defaults to Category 1,
which returns all-zeros and looks like "no data". Also ⚠️ one department shows `P 25, A 30` in a
31-day month — present + absent exceeds the month.

## 8.3 Leave / Loan Reports
| Report | Page | Parameters |
|---|---|---|
| Leave Yearly Report | `LeaveReport.aspx` | `Leave Year {2022..2027}` · Salary Month to · Employee · Category/Company/Division/Department trees |
| Leave EnCashment | `Leave_Encashment.aspx` | Date From/To · Employee · trees |
| Leave Ledger | `/Leave/LeaveLedger.aspx` | (the operational screen doubles as the report) |
| Coff Report | `Coffreport.aspx` | Date From/To · Employee · trees |
| Loan Yearly | `Loan_Yearly_Report.aspx` | From Month / To Month · Employee · **Company · Location · Department · Division · Category trees** |

## 8.4 OT Reports
| Report | Page | Parameters |
|---|---|---|
| OT Report | `OT_Report.aspx?ReportType=OTReport` | Att Month · Category · Company · Division · Department · `[Show] [Excel Export]` |
| OT Bank Statement | `…?ReportType=OTReportBank` | same |
⚠️ **Run live for May/2026: the page rendered a completely blank card** — no headers, no rows, no
"no data" message, no error. Nothing at all.

## 8.5 Attendance Reports (Daily / Monthly / Yearly — 32 links, 10 pages)
| Page | Report Type dropdown (the *real* list, wider than the menu) | Other params |
|---|---|---|
| `Daily_Att_Viewer.aspx` | `Daily Basic Report \| Daily Detail Report` | Date From/To · **`Group By {Shift Wise \| Category Wise \| Designation Wise \| Department Wise}`** · **`Status {All \| Miss Punch \| On Leave \| Early Going \| Late Coming \| Absent \| Present}`** · Employee · Category · **Shift tree** + Company/Division/Department trees |
| `Department_Summary.aspx` | — | Date From/To · Company + Department trees |
| `Department_vs_Company_Summary.aspx` | — | a single Date · Company + Department trees |
| `DailyAttReport.aspx` | `Daily Basic Report` | + `Group By {Designation \| Department}` |
| `DailySpecialReport.aspx` | `Daily Basic \| Daily Detail` | + Group By + Status + **Shift and Section trees** · `[Recalculate]` |
| `Daily_Attendance.aspx` | `Daily Attendance Summary Report \| Employee Summary \| Daily Detail Report \| Daily Basic Summary Report \| Daily Basic Report` | Group By + Status + trees |
| `Employee_Att_Summary.aspx` | `Employee Summary` | Date From/To · Employee · trees |
| `Daily_Attendance_Summary.aspx` | `Daily Attendance Report` | Group By + Status + `Report Format {PDF\|Excel}` |
| `MonthlyAttReport.aspx` | `Form 1 \| Monthly OT Report \| Monthly Detail Report \| Monthly Summary Report \| Monthly Basic Report` | Date From/To · `Order By {Emp Code \| Emp Name}` · Employee · Category · trees · Format |
| **`Attendance_View.aspx`** | **15 types:** `Manual Entry Report \| Monthly Basic With Status \| Monthly Basic With ExtraWork \| Monthly In Out \| Monthly Total Duartion \| Monthly Basic with OT \| Monthly Report \| **Monthly Loss Report** \| **Head Count Report** \| Performance \| Form 1 \| Monthly OT Report \| Monthly Detail Report \| Monthly Summary Report \| Monthly Basic Report` | Date From/To · Order By · Employee · Category · trees |
| `Manual_Entry_Report.aspx` | *"Manual Entry (Manual Punch) Report"* | Date From/To · Employee · Category · trees |
| `Monthly_Late_coming_report.aspx` | — | Date From/To · Employee · Category · **Shift tree** + trees |
| `Attendance_View_New.aspx` | `Yearly Summary \| Performance \| Form 1 \| Monthly OT \| Monthly Detail \| Monthly Summary \| Monthly Basic` | Date From/To · Order By · Employee · Category · trees |

**⭐ Run live — Monthly Attendance Report, 01-05-2026 to 31-05-2026, in the ReportViewer.**
The output is a **colour-coded calendar strip, one block per employee, 2 pages**:
```
Com | EMP082 | Emp Name | Test 82 | Department: Production | P- 0 | A- 25 | WO- 5 | H- 1 | Leaves- 0 | OT-
Days   | 1  2  3  4  5 … 31
Status | H  A  WO A  A … WO      ← red = Absent, purple = Weekly Off
In Time  | (per day)
Out Time | (per day)
```

## 8.6 Statutory Reports — **the actual government file formats**
| Report | Page | Parameters | **Real output (run live)** |
|---|---|---|---|
| **PF Report** | `PFReport.aspx` | Att Month · org filters · `[Show] [Excel Export]` | `EmpCode \| UAN \| MemberID \| EmployeeName \| Gross Wages \| Basic \| PF Employer \| PF Employee` — 66 rows, e.g. `EMP001 \| \| \| Test 1 \| 80520 \| 40260 \| 1800 \| 1800` |
| **PF ECR** | `PFStatement.aspx` | Att Month · org filters · `Export {Excel \| CSV}` | **the literal EPFO ECR spec:** `PFNumber \| UAN \| MEMBER_NAME \| GROSS_WAGES \| EPF_WAGES \| EPS_WAGES \| EDLI_WAGES \| EPF_CONTRI_REMITTED \| EPS_CONTRI_REMITTED \| EPF_EPS_DIFF_REMITTED \| NCP_DAYS \| REFUND_OF_ADVANCE \| DATE OF PAYMENT` |
| **PT Statement** | `PTStatement.aspx` | Att Month · org filters | `EmployeeName \| Amount` (+ TOTAL row) |
| PT Report | `PTReport.aspx` | Att Month · **Company only** | — |
| **ESIC ECR** | `ESIC_Challan.aspx` | Att Month · org filters · `Export {Excel \| CSV}` | rendered no table for Aug/2026 |
| **Monthly Register** | `MonthlyRegister.aspx` | **From Month + To Month** · **`Head Name` (43 heads)** · org filters | **a pivot of ONE head across months:** `Empcode \| EmployeeName \| Department_Name \| Jan \| Feb \| Mar \| Apr \| May \| Jun \| Total` — e.g. `EMP010 \| Test 10 \| Production \| 9018 \| 6513 \| 7766 \| 7530 \| 7028 \| 0 \| 37855` |
| EPFO | `EPFO.aspx` | Salary Month · Company · `[Calculate]` | produces a file, nothing on screen |

## 8.7 Canteen · MIS · TDS · Access Control
| Report | Page | Parameters |
|---|---|---|
| **Canteen** (4 menu links) | `CanteenReport.aspx` | Date From/To · **`Report Type` has 6 options — two of which aren't in the menu: `Monthly Billing Report \| Meal Consumption Report \| Canteen Monthly Detail Report \| Canteen Report with Free Meal \| Canteen Daily Report \| Canteen Monthly Punch Report`** · `Order By` · Employee · Category · trees · Format · `[Generate] [Export Excel] [Print]` |
| Head Count / Monthly Loss | `Attendance_View.aspx?ReportType=HeadCount / MonthlyLoss` | as §8.5 |
| **TDS Quarter Return** | `TDS_Report.aspx` | From Date / To Date · Employee · trees · `[Generate]` + a **`Month` picker → `[Show Challan Details]`** |
| Access Control ▸ Department Wise | `Access_Control_Report.aspx` | From Month / To Month · Department · `[Show] [Print]` |
| Access Control ▸ Employee Wise | `EmployeeWise_Access_Control_Report.aspx` | From Month / To Month · Employee · `[Show] [Print]` |
| Access Control ▸ Device Wise | `Access_Control_Report_Device.aspx` | Employees · **`Device {All \| Sarigam \| Vapi}`** · `[Show] [Print]` |

---

# 9. ESS

### 9.1 **ESS Requests** — `/ESS/ESSRequestDetails.aspx` *(opened live)*
Filters: a date · **`Request Type {All Types | Leave | Miss Punch | OD | Reimbursement | OT
Sanction}`** · `Leave Type` · **`Status {All | Pending | Approved | Disapproved}`** ·
**`Pending Level {All Levels | Pending at L1 | L2 | L3 | L4 | L5}`** · `[Apply] [Reset]`.
Grid `# | Request Type | Emp Code | Employee Name | Department | From Date | To Date | Extra Info |
Entry Date | Status | Pending Level`. Live empty state: *"No records found for the selected filters."*

*What an employee may raise is set per **Category** on Master Settings ▸ ESS (§2.1) using the same 17
day-actions from §4.7. Employee-level kill switches: **ESS Password** and **Block Employee ESS** on
their record.*

### 9.2 **Announcement** — `/Announcement/Announcement.aspx`
Grid `ID | Title | Date | Priority | Status | Description | Actions`, search, `[Refresh] [Add]`,
record navigation `[First] [Previous] [Next] [Last]`.
Form: `Title*`, `Announcement Date`, **`Priority {Normal | High | Low}`**,
`Status {Active | Inactive}`, `Description`.

### 9.3 **Company policies** — `/NotificationSender/Notification_Sender.aspx`
**Upload New Policy:** `Policy Name`, `Choose file`, `Policy Description`, `[Clear] [Upload Policy]`.
**Uploaded Policies:** `ID | Policy Name | File Name | File Type | Upload Date | [View][Edit][Delete]`.

---

# 10. INVOICE

**Invoice List** — `/TaxInvoice/Invoicelist.aspx`
`Date From` / `Invoice Month` + `[Show]` + search + `[Generate Invoice]`.
This is HRMex invoicing **its own customers** (SaaS billing), not employee-facing.
⚠️ `[Generate Invoice]` → `Invoicelist_AU.aspx` titled **"Invoice Genration"** *(sic)* renders a
**completely empty card**. Dead screen.

---

# 11. ACCESS CONTROL (the canteen / staff-meal module)

### 11.1 **Settings** — `/Canteen/Settings.aspx` — `Selection Mode` (radio) · `☐ Is Top-Up`.

### 11.2 **Canteen Items** *(really meal windows)* — `/Canteen/Items.aspx` *(opened live)*
Form: `Meal Name`, `Meal Start`, `Meal End`, **`Rate`**, `☐ Gate Count`, `Gate Start`, `Gate End`.
Grid `ID | MEAL NAME | MEAL START | MEAL END | RATE | GATE COUNT | GATE START | GATE END | ACTIONS`
with DataTables paging + search. Live rows:
```
BreakFast  07:00–10:00   Rate: NaN ⚠️   Gate Count: No
Lunch      11:00–15:00   Rate: NaN ⚠️   Gate Count: No
Dinner     20:00–23:30   Rate: NaN ⚠️   Gate Count: No
```
⚠️ **Every rate renders as `NaN`.** *A punch inside a meal window = a meal consumed at that rate.*

### 11.3 **Canteen Work Code** — `/Canteen/Workcode.aspx`
Form: `Workcode {1..9}`, `Workcode Name`, `Rate`, **`Employee Contribution`**,
**`Employer Contribution`**, `Category`.
Grid `ID | Workcode | Name | Rate | Employee Contribution | Employer Contribution | Category Name |
Actions`. *The subsidy split is configured per work code per category.* Charged via the `Canteen`
deduction head; billed on the payslip; six canteen report variants.

---

# 12. TEMPLATE MANAGEMENT

### 12.1 **Template Creation** — `/TemplateGeneration/TemplateGeneration.aspx` *(opened live)*
A genuine WYSIWYG document editor.
- Top bar: `Template name…` · `Template Type {Offer Letter | Appointment Letter | Confirmation Letter
  | Relieving Letter | Experience Letter}` · `Paper Size {A4 | Letter | Legal | A5 | A3 | Custom}` ·
  `Orientation {Portrait | Landscape}` · an **Unsaved** indicator ·
  `[Add Logo] [Variables] [Preview] [Save] [Template List]`
- Second bar: `MARGINS (MM) T/B/L/R` (default 20) · `Page border {None | Thin | Medium | Thick |
  Double (letterhead)}` + border colour `#94a3b8` + `PAGE FILL #ffffff` · `Header & Footer
  {Add/Remove Header, Add/Remove Footer}` · `Line Spacing {Remove spacing (0) | 0.5 | 1.0 (Single) |
  1.15 | 1.5 | 2.0 (Double) | 2.5 | 3.0 (Triple)}` ·
  **`Watermark {CONFIDENTIAL ×2 | DO NOT COPY ×2 | DRAFT ×2 | SAMPLE | Custom… | Remove}`**
  (diagonal or horizontal, with size/colour) · `☐ Repeat logo every page` · `[Add Page] [Remove Page]`
- Formatting row: font colour · highlight · `Shading` · `Callout` · `Callout Left` · `Callout Size` ·
  `Callout Edge` · `Section` · `Box` · `Clear` · `Logo`
- Canvas placeholder: *"Your template content will appear here. Use {{VariableName}} placeholders for
  dynamic fields."*

**The variable palette (searchable, drag-and-drop) — the full data dictionary:**
```
SYSTEM VARIABLES
  {{CurrentDate}} {{CurrentDateTime}} {{PrintDateTime}} {{Year}} {{MonthName}}
  {{PageNumber}} {{TotalPages}} {{PageNumberOfTotal}} {{DocumentTitle}} {{DocumentId}}
  {{TemplateName}} {{GeneratedByUser}} {{RefNo}}
MANUAL VARIABLES   — user-defined, added with +
DATA VARIABLES
  {{CompanyName}} {{CompanyAddress}} {{CompanyEmail}} {{CompanyPhone}} {{CompanyWebsite}}
  {{EmpName}} {{EmpCode}} {{EmpDesignation}} {{EmpDepartment}} {{EmpDOJ}} {{EmpFatherName}}
  {{EmpCategory}} {{EmpDivision}} {{EmpGender}} {{EmpEmail}} {{EmpMobile}}
  {{ReportingManager}} {{EmpLocation}} {{LetterDate}}
ALLOWANCES TABLE
  {{BASIC}} {{BASICDA}} {{HRA}} {{FIX_INCENTIVE}} {{OTHERS}} {{Monthly Incentive}}
  {{SpecialAllowence}} {{OT}} {{Reimbursement}} {{WD}} {{Bonus}} {{Canteen}}
  {{Salary.Allowances}}          ← the whole table as ONE variable
DEDUCTIONS TABLE
  {{LOAN}} {{PF}} {{Advance}} {{Other Deduction}} {{ESIC}}   {{Salary.Deductions}}
TOTALS
  {{Salary.NetSalary}}  {{Salary.GrossSalary}}  {{Salary.CTC}}
```
*Note the pattern: **individual heads AND a whole-table variable** — that's how one template survives
every company having a different head list.*

### 12.2 **Letter Generation** — `/TemplateGeneration/LetterGeneration.aspx` *(opened live)*
A 4-step wizard with a numbered progress bar: **1 Template → 2 Employees → 3 Preview → 4 Export**.
- **Step 1** `Document Type {-- Select Type -- | Offer Letter | Offer Letter Annexure | Appointment
  Letter | Confirmation Letter | Termination Letter | No Dues Certificate | Relieving Letter |
  Experience Letter | Appraisal Letter | KRA Format | Resignation Format | Advance Letter}` ·
  `Template Name` · `Letter Date` · `Ref No (optional, "Auto")` · `Options ☑ Header ☑ Footer` ·
  `[View Templates] [Next: Select Employees →]`
- **Step 2** `○ Single Employee` (picker) or batch by `Department` + `Designation`, `[All] [None]
  [Load Employees]`, `[Back] [Next: Preview]`
- **Step 3** live letter preview · `[Generate Letter]`
- **Step 4** `[Export PDF] [Export Word] [Export HTML] [Print]` · `[Generate More Letters]
  [Back to Templates]` · history grid `Ref No | Template | Employee | Department | Generated |
  Status | Actions` with `Status {All Status | Generated | Exported | Printed | **Voided**}`

> **⭐ A generated letter is never deleted — only Voided.** Exactly our billing instinct.

---

# 13. DASHBOARD (for completeness — it's the first screen)

Eight KPI tiles, each click-through: **Total Employees 124** (View All Employees) · **Present Today 0**
(View Present Details) · **Absent Today 93 "Needs attention"** (View Absent Details) ·
**On Leave / WO 0/31** (View Leave/WO Details) · **Late/Early 0/0** (Late/Early Entry) ·
**Birthdays Today 0** (Employee Master) · **Active devices Online/Offline 0/2** (Device Management) ·
**OT Hours 0:00** (Monthly Att Voucher).

Then: **Quicklinks** (9 user-chosen shortcuts, editable) · **Active Year and Payroll Month**
(`01 Jan 2026 – 31 Dec 2026`, `Aug 2026`) · **Payroll Process** card with `[Go to Payroll Process]` ·
**Attendance Trend** line chart (Mon→Sun, series Present/Absent/Leave/Weekly Off, `[Week] [Month]`) ·
and a bottom row: **Today's & Tomorrow's Birthdays (1)** · **Missed Punches (0)** ·
**Department Vacancies (80)** · **Upcoming Holidays (3/13)**.
Floating right rail: notification bell with a **99+** badge, and a ⚙ **card-settings panel** to
show/hide dashboard cards.
Shell top bar: hamburger · `[Close ▾]` (tab management) · open tabs · date picker · **All Companies**
selector · refresh · fullscreen. Left rail bottom: live clock · `[Log out]` · `Version: 10.0.0.0`.
**On login a modal appears** — *"Leave Carry Forward Reminder"* with
`[Open Leave Transaction (Carry Forward)]`. ⚠️ It cannot be permanently dismissed.

---

# 14. Cross-cutting patterns worth copying

1. **One filter component reused ~60 times**: `Category · Company · Division · Department · Location ·
   Employee` + a date/month + `[Show]` — sometimes as dropdowns, sometimes as checkbox trees with
   *Select All*.
2. **`X_Mst.aspx` (list) → `X_AU.aspx` (add/update)** for every master. Predictable and cheap.
3. **Every importer offers file *or* paste**, with `[Preview]` before commit and a visible error box.
   (Paste-from-Excel is what real users actually do.)
4. **Every long job shows a progress bar and an error log** — Attendance Calculation, Salary
   Calculation, Leave Carry Forward, Email Salary Slip.
5. **Bulk jobs are named batches**: preview → create → run partially → per-row status + message →
   history. Never one irreversible button.
6. **Settings point at data rows**, so PF/ESIC/PT/OT/Bonus/Present/Absent are configuration, not code.
7. **Two-status rows wherever two parties act** — Onboarding (`Status` + `Emp Respond`), Payroll
   (`Lock` + `Finalize`), Salary Process (`Calculated` + `Verified`), Increment (batch + per-employee
   `Increment Status`).
8. **Records are voided/locked rather than deleted** — letters, payroll months, IT declarations.
9. **Formula fields ship with a `✔ Verify` button.**
10. **Empty states explain themselves** — *"No loan records found… Employees in this batch may not
    have any active loans for May-2026."*
11. **Recipients are addressed by role** (`Email From {Location | Company | User | Employee | isHOD |
    ReportingManager}`), never by typing addresses.
12. **A global friendly error page with a traceable reference code** (`HRM-OOPS-D1C66124`).

---

# 15. Everything verified broken or weak — **do not copy**

Each of these was seen live, in normal use, on 2026-08-16:

| # | What | Where |
|---|---|---|
| 1 | **Salary Heads Master is dead** — *"Error loading salary heads: Invalid column name 'IsSystemGenerated'"*, grid shows `1-5 of 0 items`. Code ahead of database. | Master ▸ Salary Heads |
| 2 | **Net Salary ₹-6,801 rendered in green**, nothing blocks it, no warning. Zero attendance days still produces a negative payable. | Payroll Voucher, EMP001 |
| 3 | **A locked + finalised payroll month can be re-opened with one toggle**, per company, no reason, no confirmation, no approval. | Utility ▸ Payroll Month → `[Edit]` |
| 4 | **The audit log records ONLY logins.** Filtering all of 2026 returned my two logins and nothing else. No data change of any kind is recorded. | Admin ▸ Audit Logs |
| 5 | **Wages Register crashes** — *"Input string was not in a correct format."* on `May/2026 + Category 4`; works on its default month. | Reports ▸ Wages Register |
| 6 | **OT Report renders a completely blank card** — no header, no rows, no message, no error. | Reports ▸ OT Report |
| 7 | **Invoice Generate is an empty screen**, titled *"Invoice Genration"*. | Invoice ▸ Generate Invoice |
| 8 | **Canteen rates all show `NaN`.** | Access Control ▸ Canteen Items |
| 9 | **A report with no "All" for Category** (Payroll Summary) — you can never see the whole company; and it defaults to Category 1, which looks like "no data". | Reports ▸ Dept/Desig/Costcentre Summary |
| 10 | **Impossible attendance passes through**: a department showing `P 25, A 30` in a 31-day month. | Payroll Summary Report |
| 11 | **Encoding bugs in production** — `â€"` appears as leave-type option text, in KPI Min/Max, in the attendance block, on the error page, and in the page title `HRMex â€“ User Master`. | everywhere |
| 12 | **Month label desynchronises** — voucher header said *Aug-2026* while the picker said *May-2026*. | Payroll Voucher |
| 13 | **An action that needs a selection is still clickable** → blocking error modal *"No employee list available. Please select an employee from the tree."* | Payroll Voucher |
| 14 | **Data scoping is app-level only** — one Location per user via a "Masters" record, enforced in page code. No row-level database enforcement. | Admin ▸ Masters Permission |
| 15 | **Test junk shipped to a live demo** — a report named `dthffyjh` (custom report `edgrf`/`sdf`), an employee named `badmash`, a duplicated `Loading / Unloading` hierarchy row. | Reports, Employee Master, Hierarchy |
| 16 | **Enormous pages, full postback on every click** — Employee Master **930 KB**, Payroll Voucher **477 KB**, Attendance Voucher **403 KB**, Upload User **259 KB**. Unusable on a phone. | throughout |
| 17 | **The login modal cannot be permanently dismissed.** | Dashboard |
| 18 | **`[Delete]` offered on closed attendance years** with no warning about dependent leave balances; `End Month` displays as `01 Dec` not `31 Dec`. | Utility ▸ Attendance Year |
| 19 | **Typos welded into the schema and URLs** — `Allowence`, `Finilization`, `Categorgy`, `Shift Shedule`, `Assets Detaill`, `Utilitty` (a real folder name), `Genration`, `Duartion`, `Overwite`, `Lable`. | everywhere |
| 20 | **Validation is a transient toast, not an inline field error** — correct, but easy to miss. | all master forms |

---

# 16. What I did NOT do, and why

- **I did not delete any of their existing data.** The referential-integrity question was instead
  answered with **throwaway records of my own** (temp department + temp employee inside it):
  deleting the in-use department was **correctly blocked** with
  *"Unable to delete Department as it is currently being used in Employee Master"*.
  Both test records were then removed. Full write-up: `docs/HRMEX-MAP-AND-FLOWCHART.md` §6.
- **I did not run payroll, lock/unlock a month, or send emails** — all would alter their data or mail
  real addresses.
- **I did not test the employee-facing ESS portal** — the demo only exposes the admin side of ESS;
  there was no employee login available.
- Reports that export straight to a file (EPFO, some bank formats) were opened and parameterised but
  the produced file was not downloaded.

---

# 17. Behaviour actually tested (a temp record, created and removed)

On **Master ▸ Department Master**:

| Test | Result |
|---|---|
| Save with the required name empty | ✅ Blocked, toast **"Department Name is required"**. Modal stays open. Not silent. |
| Save a duplicate name (`HR`) | ✅ Blocked, dialog **"Error — Department Name Already Exists"** + `[OK]`. Uniqueness is enforced. |
| Create `ZZ CLAUDE TEST` | ✅ Saved, appears in the grid and in search immediately |
| Delete it | ✅ Named confirmation: **"Delete Department? Are you sure you want to delete `ZZ CLAUDE TEST`?"** → `[Yes, Delete] [Cancel]` |
| After confirming | ✅ Removed from the grid |

**The test row was deleted; nothing of mine remains in their system.**

---

# 18. Coverage of this study

| Area | Status |
|---|---|
| 13 modules / ~130 screens | structure captured for **all**; **~45 opened live** in the browser |
| 72 report links / ~30 report pages | **all 30 pages' parameters captured**; **7 run with real output** recorded (Payroll Summary, PF Report, PF ECR, PT Statement, Monthly Register, Wages Register, Monthly Attendance via ReportViewer); 2 found broken |
| Deep flows | Employee record (all 10 sections) · Payroll 5-stage runner (all steps) · Payroll Voucher · Attendance Voucher + all 17 day-actions · Leave policy engine · IT Declaration · FNF settings · Letter templates + variables |
| Config | Master Settings (all 6 tabs + OT slab) · Employee Settings (2 tabs) · System (all 3 tabs incl. the cron table) |
| Behaviour | validation · duplicates · delete confirmation · lock reversibility · audit-log contents |

---

# 19. ⭐ THE WHOLE THING IN PLAIN ENGLISH

*(If you read nothing else, read this.)*

**What HRMex actually is:** software that answers three questions for a company —
**Who works here? · Did they show up? · What do we pay them?** — and then prints the paperwork.
All 130 screens are one of those three things, or a report about them.

**How it hangs together, in the order a real person moves through it:**

1. **You set up the company skeleton once.** Locations, companies, divisions, departments, sections,
   designations, cost centres, shifts, holidays, leave types, banks, document types. Boring and
   one-time, but everything else points back at it.

2. **You invite a person.** You type only their name, email, phone and job. They get a link and fill
   in their own address, bank, documents and nominee — and *you* decide beforehand which of those
   fields are compulsory. Two separate statuses track it: yours and theirs.

3. **The person becomes an employee record** with ten sections — who they are, where they live, their
   family and nominees, their documents, the company assets they hold (laptop, SIM, bike), their
   salary structure, their leave balances, who approves their requests, and their blood group.

4. **Every day, punches arrive** — from a fingerprint/face machine, a phone, or typed by hand.
   Raw punches mean nothing on their own.

5. **You press one button — "Calculate" — and punches become days.** The software compares each punch
   to that person's shift and decides: present, half day, quarter day, absent, late by X, overtime Y,
   weekly off, holiday, on leave, missing punch. You can redo just the unfinished days or everything,
   and it shows a progress bar and an error list while it works.

6. **When a day is wrong, you fix it from one dropdown.** On any date there are **17** corrections —
   add a punch, apply leave, change the shift, mark a day off, sanction overtime, grant a comp-off,
   and cancel any of those. **The same 17 are what an employee can *request* for themselves** — you
   just tick which ones each staff class is allowed to ask for. One list, two uses.

7. **Leave runs on rules, not arguments.** For each staff class × each leave type you set about
   fifteen switches: days per year, does it carry forward, after how many days of service does it
   unlock, does it accrue monthly, can the balance go negative, does a weekly off inside a leave count
   as leave, must comp-off be used before earned leave, does comp-off expire (and can that be
   extended), can it be encashed. Once set, the software ends the argument.

8. **Money is one list called "salary heads".** BASIC, HRA, PF, PT, loan, overtime, bonus, canteen —
   43 of them — each just a row with a name, a type (earning / deduction / attendance counter / leave
   counter) and a **formula**. Nothing is hard-coded: the settings screen simply says *"the PF head is
   this row"*. Adding a new allowance next year is typing a row, not rewriting software.

9. **Each employee gets their share of those heads.** Their CTC is split across the earning heads
   (real example: ₹80,520 = BASICDA ₹40,260 + HRA ₹16,104 + Special ₹24,156) and their deductions sit
   beside it. A little "Condition" flag switches any head between formula-driven and a fixed amount.

10. **Payroll runs monthly, in five fixed steps, per group of staff:**
    **① pull in attendance → ② upload the manual bits (advances, canteen, incentives, reimbursements)
    → ③ pull in loan instalments → ④ calculate → ⑤ review the totals and tick "Verified".**
    Splitting staff into groups ("PF staff", "non-PF workers", per site) means one problem group
    doesn't hold up everybody. Throughout, the screen keeps two numbers in front of you:
    **how many people would be paid ₹0** and **how many have missing punches**.

11. **Two numbers exist for every earning, and this is the bit worth understanding.** For BASICDA
    there is `BASICDA` (what the contract says) and `EBASICDA` (what attendance actually earned this
    month). Take-home = *earned* gross minus deductions. Get that right in the database and
    everything downstream — payslip, reports, statutory files — falls out for free.

12. **Then you lock the month.** Two switches, *Lock* and *Finalize*. In theory it's finished.
    **In practice I found you can flip both back with one click, per company, with no reason asked and
    nothing written to the audit log — which only records logins anyway.** So their immutability is a
    convention, not a guarantee. **That is the single thing we must build properly and they didn't.**
    The right pattern is already in their product: if a raise was backdated, they pay the difference
    as **arrears next month** rather than reopening a closed one.

13. **Then it prints everything.** Payslips (emailed in a pausable, resumable batch with per-person
    sent/failed status), ~85 reports, salary-transfer files in each bank's own format (ICICI, HDFC,
    SUDICO), and the actual government filings — PF ECR, ESIC ECR, PT, and a TDS quarterly return.
    There's a complete income-tax module too: old vs new regime with a **Compare** button, house
    property, previous employment, all the 80-series exemptions with **declared vs actual** amounts
    and proof uploads, and Form 16.

14. **When someone leaves**, Full & Final closes the loop: recover the laptop, recover the outstanding
    loan, encash the leave balance, apply the gratuity and notice-pay formulas — each formula having
    its own **Verify** button so you find out it's wrong before payday, not after.

15. **Around all that** sit four side-modules: a proper **letter writer** (offer/experience letters,
    with a real page designer, watermarks, `{{merge fields}}`, and letters that can only be *voided*,
    never deleted), a **staff canteen** (meal windows and rates, employer/employee subsidy split,
    deducted from salary), **goal-setting** (KRAs and KPIs scored as "higher is better / lower is
    better / in range"), and **device management** for the biometric machines — including a nightly
    scheduler that can collect attendance at 2am and calculate the whole month's salary at 3am,
    unattended.

**The five things genuinely worth stealing:**
- One configurable list of "salary heads" driving money, attendance *and* leave.
- Payroll as a month × group **batch** with five explicit steps that ends locked.
- 17 named day-corrections that double as the employee's self-service permissions.
- Leave policy as ~15 switches per staff class, not code.
- Structure amount and *earned* amount stored as two separate numbers per head.

**The five things to avoid:**
- Desktop-only. Full page reloads; a 930 KB employee list. Dead on a phone in a restaurant.
- Security enforced in page code, not the database.
- A "lock" anyone can undo, and an audit log that only remembers logins.
- Broken screens shipped live — the salary-heads list literally errors, two reports are blank or
  crash, canteen rates read `NaN`, and a negative salary displays in green.
- Typos frozen into the database and URLs forever (`Allowence`, `Utilitty`, `Finilization`).

**What this means for us:** we already own the hard parts — one staff identity, a permission tree, a
real audit log, offline writes, and a culture that says a financial record is never deleted. Building
HR inside Aevidine is mostly **new tables plus one calculation engine**. Built phone-first,
offline-capable and RLS-protected, with a lock that actually locks, it beats this product on every
axis a restaurant owner cares about — and needs no biometric hardware on day one.

**Suggested build order:** rota/shifts → attendance → leave → salary heads → the monthly payroll run →
payslips & letters → advances & staff meals → statutory → staff self-service → offboarding.
Reasoning and table design: `docs/HRMEX-HR-PAYROLL-STUDY.md` §13–14.
