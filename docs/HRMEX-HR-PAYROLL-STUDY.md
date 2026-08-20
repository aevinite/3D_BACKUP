# HRMex — complete teardown of a working Indian HR + Payroll product

**Studied:** 2026-08-16, live demo at `https://demo.hrmexweb.in/` (Superadmin login, read-only exploration).
**Why:** the owner wants to build a **full HR + payroll module inside Aevidine** (the restaurant POS/SaaS).
This document is the **build spec**, not a summary. Every module, every screen, every field, every rule
observed, plus what to copy and what to deliberately do differently.

> Nothing in Aevidine's code was changed while producing this. This is a research doc only.

---

## 0. The one-paragraph verdict

HRMex is a **head-driven payroll engine wrapped in a month-batch state machine**. Almost nothing is
hard-coded: PF, ESIC, PT, OT, bonus, loans, present/absent counters are all just *rows in one
`SalaryHeads` table*, and Settings simply **points a role at a row** ("PF Head = this row"). Attendance,
leave and loan modules all feed numbers into those same heads. Payroll then runs per **Month × Company
× Batch** through five fixed stages and ends in a **Lock + Finalize** pair of toggles. That single idea —
*one configurable head table + a locked monthly run* — is the thing worth copying. The UI is dated
ASP.NET WebForms and has real bugs (documented in §12); the **model** is excellent, the **execution** is not.

---

## 1. What it is technically

| | |
|---|---|
| Stack | ASP.NET WebForms (`.aspx`, `__doPostBack`, ViewState), AdminLTE 3 + Bootstrap 4, jQuery, Chart.js |
| Shell | A tabbed iframe host (`Default.aspx`) — each menu item opens as a *tab* inside an iframe |
| Pages | ~130 distinct `.aspx` screens across 13 top-level modules |
| Version shown | 10.0.0.0 |
| Licensing | Metered **by active employee count** — footer of Employee Master reads `License / Active Emp : 1000 / 124` |
| Multi-company | One install serves many **Companies** under many **Locations** (see §3) |
| Devices | Talks directly to biometric hardware (ZKTeco-style, HikVision, Dahua) over TCP |

**Pattern worth noting:** every list screen is `X_Mst.aspx` (list) → `X_AU.aspx` (Add/Update form).
Consistent, predictable, and cheap to generate. Our Next.js equivalent: `/hr/<thing>` and
`/hr/<thing>/[id]`.

---

## 2. Full module map (the whole product, top to bottom)

```
Dashboard
Admin ........... Masters Permission · UserTypes · Users · Change Password · Audit Logs · System
Master .......... Master Settings · Employee Settings
                  Master ▸ Location · Company · Division · Department · Section · Designation ·
                           CostCenter · Shift · Shift Group · Holiday Group · Salary Heads ·
                           Category · Bank · Level · Leave Level · Hierarchy · Document ·
                           Education · Asset · Reimbursement
                  Department Man power · Employee Master · Employee Onboarding
                  Employee Offboarding ▸ Full & Final Master · Full & Final Settlement
HRMS ............ IT Declaration · PMS ▸ KRA Master · KPI Master · PMS Report
Attendance ...... Device Logs · Late/Early Entry · Logs Approval · Holiday · OD Entry · COFF ·
                  Attendance Voucher · Attendance Checklist · Shift Schedule ·
                  Leave ▸ Leave Type · Leave Entry · Leave Opening · Leave CarryForward ·
                          Leave Credit · Leave Encashment · Leave Statement · Leave Ledger
                  Attendance Calculation
Loan & Advance .. Loan · Loan Manage · Loan Prepayment · Advance · Loan Opening ·
                  Loan Statement · Loan Ledger
Utility ......... Device Management · Device Commands · DC(Hikvision) · Upload User To Device ·
                  Blocked Employee · Employee Import · Payroll Month · Attendance Year
Payroll ......... Salary Process · Employee Wages Edit · Attendance Import · Collect Attendance ·
                  Attendance List · Wages Import List · Manual Attendance · Manual Wages ·
                  Salary Calculation · Salary List · Salary Import · Increment Initialize ·
                  Arrears Calculation · Payroll Voucher · Email Salary Slip
ESS ............. ESS Requests · Announcement · Company Policies
Reports ......... 14 groups, ~85 individual reports (§11)
Invoice ......... Invoice List
Access Control .. Canteen Settings · Canteen Items · Canteen Work Code
Template Mgmt ... Template Creation · Letter Generation
```

---

## 3. The organisation model (the spine everything hangs off)

Seven independent dimensions, each its own master table, each just `{ name, print_label }`:

```
Location  →  Company  →  Division  →  Department  →  Section
Designation (+ is_HOD flag)
CostCenter
Category   (Category 1..7 — this is the "employee class", used everywhere as a filter AND a rule scope)
Level / Leave Level
Shift Group / Holiday Group
```

**Key facts learned:**

- Every filter bar in the entire product is the same six dropdowns: **Category, Company, Division,
  Department, Location, Employee** + a date/month. Build this once as a component.
- **Category is the most load-bearing dimension.** OT slabs, ESS permissions, FnF requirement and
  canteen rates are all configured *per Category*, not per employee.
- **Designation carries `Is HOD`** — that one boolean drives approval routing and "show my department".
- **Department Man power** stores planned headcount as `Department × Designation → Male / Female`,
  and the dashboard shows *Department Vacancies* (80) by comparing plan vs actual. Cheap, useful.
- The drill-down used on operational screens is always the same chain:
  `Location → Company → Division → Department → Employee`.

**For Aevidine:** we already have `restaurant_id`. The equivalent chain is
`restaurant → (optional) outlet → section (kitchen/floor/bar) → role → staff`. Do **not** copy seven
levels; copy the *idea* that the filter bar is one component and that one dimension ("Category" ≈ our
staff class: chef / waiter / manager / part-timer) carries the rule scoping.

---

## 4. ⭐ The Salary Head model — the single most important idea

Screen: **Master → Master ▸ Salary Heads** (`SalaryHeads_Mst.aspx` → `SalaryHeads_AU.aspx`).

One table drives money, attendance counters and leave counters. A head row is:

| Field | Notes |
|---|---|
| **Type** | `Allowence` · `Deduction` · `Attendance` · `Leave` · `SYSTEMS` |
| Heads Name | e.g. `BASICDA`, `HRA`, `PF`, `PT`, `OT`, `P`, `A`, `H`, `WO`, `PL`, `CL` |
| Print Label | what appears on the payslip/report (separate from the internal name) |
| **Formula Field** | free-text expression — this is how a head computes itself |
| Order No | display order on slip and in Excel |
| `Is Gross` | counts toward gross |
| `Is Basic` | this row is the basic used by other formulas |
| `Is CTC Component` | included in CTC |
| `Is Calculable` | engine computes it (vs. entered manually) — **default ON** |
| `Is Reimbursement Head` | routes to the reimbursement flow |
| `Is Visible` | show on screens/slip |
| `Is Time Field` | value is minutes/hours, not rupees (e.g. `OT HRS`) |
| `Roundoff value` | round the result — **default ON** |
| `Is TDS Calculable` | included in taxable income |
| `Is Reimbursement Calculable` | |

Observed live heads: `BASIC, BASICDA, VDA, HRA, Conveyance, Education, OTHERS, PERQUISITES,
PRODUCTION, SpecialAllowence, FIX_INCENTIVE, Monthly Incentive, Travel Allowance, ROOM_RENT,
Attendance Bonus, OT, OT HRS, WD, Bonus, Reimbursement, Canteen` (allowances) and
`PF, ESIC, PT, TDS, LOAN, HOME_LOAN, Advance, Other Deduction` (deductions), plus attendance heads
`P, A, H, MD, WO, WOP, HP, OD, COFF, LTD, SHL, ExtraHRS, DLD, SPL` and leave heads `PL, CL, SL, ML, LOP, COFF`.

### 4.1 Settings *point* at heads — nothing is hard-coded

**Master → Master Settings → Payroll tab** maps roles onto head rows:

```
Allowance Type → (head type)      Deduction Type → (head type)
PT Head → PT      PF Head → PF      Loan Head → LOAN
OT Hrs Head → OT HRS              OT Head → OT
Bonus Head → Attendance Bonus     ESIC Head → (unset in demo)
```

**Attendance tab** does the same for counters: `Absent Head`, `Present Head`, `Extra Hrs Head`.
**Leave tab**: `COFF Head`, `Auto Leave Name`.

> **Copy this.** It means adding "ESI" or "Tips deduction" later is a data row, not a code change.
> Our version: a `hr_pay_heads` table + a `settings.hr.head_map` JSON that names the special roles.

### 4.2 Per-employee salary structure

On **Employee Master → Salary Details**, each employee gets two grids:

```
ALLOWANCE:  Heads Name | Condition | Wages Amount
DEDUCTION:  Heads Name | Condition | Wages Amount | CTC Component
```

Real example observed (EMP001, CTC ₹80,520/month):

```
BASICDA          40,260      (= 50% of CTC)
HRA              16,104      (= 40% of BASICDA)
SpecialAllowence 24,156      (= balancing figure)
                 ------
                 80,520  = CTC ✔

PF   condition=1  amount=1800   (flag + capped amount)
```

`Condition` is a small integer flag beside every head — it switches the head between *formula-driven*
and *fixed amount* for that employee (PF shows `1` + a hard 1800; everything else shows `0`).

Also on that panel: `UAN Number, PF Number, ESIC Number, Bank Name, Bank A/c, IFSC, CTC Amount,
CTC Type (Daily|Monthly|Yearly), Daily CTC, OT Per-hour rate, Pay scale`.

### 4.3 Formulas have a **Verify** button

Seen on **Full & Final Master → FNF Settings**: three formula boxes (Gratuity / Notice Pay / Bonus),
each with its own **✔ Verify** link that validates the expression before you can save it.
**Copy this pattern** — a formula field without a validator is a support ticket generator.

---

## 5. The employee record (complete field list)

Screen: **Master → Employee Master** → row menu **View / Edit / Resign / Delete** →
`Employee_AU.aspx`. One header block + **10 collapsible sections**.

**Header:** Aadhar No · PAN No · Emp Code · Device Code · Employee Name · Gender · Designation ·
Date of Birth · Status (Working|Resign) · Joining Date · Photo upload · **Upload to Device** button
(pushes this person to a chosen biometric reader).

**Posting block:** Location · Company · Division · Department · Section · Category · Shift Group ·
Holiday Group · Level · Leave Level · CostCenter · Reporting Manager · Weekly Off · OT (Applicable /
Not Applicable) · 2nd WO checkbox · Weekly Off 2 · which weeks the 2nd WO applies (1st/2nd/3rd/4th/5th).

| Section | Fields |
|---|---|
| **Address** | Current Address, Permanent Address, *Same As Current* checkbox, Address Line 1/2, Landmark, District, City, State, Country, Pincode |
| **Contact Detail** | Mobile, Email, Emergency Contact, Emergency Contact 2, Driving Licence No |
| **Documents** | repeating rows: Document Name (from Document Master: PAN, Aadhar, Driving Licence, Bank Passbook, Offer Letter, Appointment Letter, Termination Letter, Warning Letter, Voter Id, 10th, 12th, Graduation) + Document Number + file upload |
| **Education Detail** | Education Name (Graduate/Master/Diploma/12th/10th) + number + file |
| **Family Details** | Spouse Name/Mobile/DOB, No. of Children, Father Name/Mobile, Mother Name/Mobile, Emergency Contact 1 & 2, **Nominee 1 & 2**: Name, Relationship, DOB, Mobile, *Is Minor?* → Guardian Name + Guardian Relation |
| **Assets Detail** | Asset Name (from Asset Master: mobile, laptop, motorcycle, SIM…), Make, Model No, Serial No, Value, Remark |
| **Salary Details** | see §4.2 |
| **Leave Detail** | grid `Leave Name | Balance` — editable opening balances |
| **Hierarchy Level & Notification** | Hierarchy Group, **Level In Hierarchy** (General, L1…L5), Notification (Yes/No), **ESS Password**, **Block Employee ESS** |
| **Other Details** | Caste (General / OBC / SC / ST), Blood Group |

### 5.1 Employee list screen behaviours

- **31 columns** available: Emp Code, Device Code, Name, Location, Gender, DOB, Joining, Resign,
  Mobile, Email, Status, Company, Division, Department, Category, Designation, Section, Shift Group,
  Weekly Off, Holiday Group, Level, Leave Level, Aadhar, UAN, PAN, ESIC No, Driving Licence,
  Bank A/c, IFSC, Bank Name, Last Punch.
- **Per-column search box + per-column filter icon** in a second header row. Grid/List view toggle.
  Export / Import. 30 rows per page.
- **Bulk resign** with three date policies: *Custom resign date* · *Last punch date* ·
  *Last day of the month*, and three outcomes: **Update**, **Update & Block** (block on device),
  **Update & Delete**.
- Live "Last Punch" per row showing time + device (`30-06-2026 09:11 - Vapi`).

### 5.2 Employee Settings (Master → Employee Settings)

Two tabs that govern *how employees are created*:

**Emp Master tab** — Code Length, **Enable Auto Code**, Short Code Source, Aadhar Mandatory,
PAN Mandatory, Bank Details Mandatory, Joining Date Required, Age Restriction,
**Verify Aadhar on Resignation**, Verify Aadhar by Location, Primary Weekly Off,
Enable 2nd Week Off + which day + which weeks (1st–5th), Calculation Method.

**Onboard tab** — which fields the *candidate* must fill on their self-service onboarding form:
Bank Details, Employee Photo, Date of Birth, Gender, Emergency Contact, Nominee, Cast, Blood Group,
Address, Emergency Contact 2.

---

## 6. Attendance — the engine and its correction surface

### 6.1 Shift Master (the richest single form in the product)

`Attendance → Shift Master`. Fields:

```
Shift Name, Short Name, Begin Time, End Time
First Half Out, Second Half In          ← half-day boundary punches
Break Out, Break In, Duration(chk) + Mins, Deduct Lunch
Begin Before (chk), End After (chk), Shift End (chk)   ← how far outside the shift a punch counts
Grace Time (chk)
Halfday Mins, Absent Mins               ← < Halfday Mins ⇒ half day; < Absent Mins ⇒ absent
Quarter Mins, Quarter Absent            ← quarter-day support
Next Day OT (chk), Night Shift (chk), Extra Dur
```

**Shift Group** = an ordered set of shifts (for rotation). **Shift Schedule** assigns shifts per
employee per day, with *Excel Import*, *Manual Generate* and **Auto Generate** (by Company /
Department / Category / Employee for a month).

### 6.2 The daily attendance record

`Attendance → Attendance Voucher` → drill `Location → Company → Division → Department → Employee`
→ a month of rows:

```
Date | In Time | Out Time | Work Duration | OT | COFF | E-Work | Total Dur |
Status | Shift | Late By | Early By | SS | Day | HPMinutes | [Action ▾]
```

Footer chips summarise the month: `A = 12 · WO = 3 · H = 1 · OT = 0:0 · E-Work = 0:0`.
Toggles: **Multiple Punch**, **Punch Device**. Buttons: **Device logs**, **Print**, **Recalculate**.

Statuses seen: `P` (present), `A` (absent), `H` (holiday), `WO` (weekly off), `WOP`, `HP` (half
present), `OD` (on duty), `COFF`, `MissPunch`, `NSF`, `SHL` (short leave), `LTD`, `SPL`, `MD`.

### 6.3 ⭐ The 17 per-day corrections (one dropdown per row)

This is the entire attendance-correction surface, and it is worth copying wholesale:

```
Add Punch          Leave Entry        Change Shift       Assign WO
Cancel WO          OD Entry           OT Sanction        OT Cancel
COFF Generate      OT Cutoff          Delete Leave Entry Delete OD Entry
COFF Cutoff        Delete COFF        Re-Assign Holiday  Cancel Holiday
Short Leave
```

Every one of these opens a small modal with a date, a value and a Remark, and every one is
**individually permissionable per Category on the ESS tab of Master Settings** — i.e. the same 17
actions define what an *employee* may request for themselves. One list, two uses. Elegant.

### 6.4 Attendance Calculation (the recompute trigger)

`Attendance → Attendance Calculation`: Date From/To + the org filter (checkbox trees for Company /
Division / Department, each with *Select All*) + a radio **Pending Entries | All Entries** +
**Calculate**, with a **progress bar and an error textarea**.

> **Copy:** the *Pending vs All* distinction (incremental vs full recompute) and the visible progress
> bar. A payroll recompute that gives no feedback is the #1 source of "did it work?" support calls.

### 6.5 Other attendance screens

- **Device Logs** — raw punches; supports **Add Manual Punch** (device code + employee + datetime +
  device name `ME / ME(IN) / ME(OUT)` + remark). Excel export.
- **Logs Approval** — manual/mobile punches awaiting approval.
- **Late Early Entry** — reasons master + entries.
- **OD Entry** (on-duty / field work) — date range, FullDay|HalfDay, OT Minutes, Extra Work, Remark.
- **Attendance Checklist** — one screen filtered by Status (Present / Absent / WeeklyOFF / Holiday /
  OnLeave / MissPunch / NSF / Miss Punch & NSF) with configurable Order By.
- **Holiday Master** — holidays per **Holiday Group** per year, each `FullDay | HalfDay`.
- **Attendance Year** (`Utility`) — per company, `Calendar year (Jan–Dec)` or `Financial year` with a
  chosen start month; carries an **Active** flag and a **Carry Forward done/pending** flag.

### 6.6 COFF (compensatory off) — a proper little engine

`Attendance → COFF`. Filter a date range → **Show** finds everyone who worked on a WO/holiday →
**Generate All** credits comp-off (or **Remove All**). Five lists, each printable:

```
Candidates:  EMPCODE | NAME | DATE | IN | OUT | STATUS | SHIFT
Consumed:    … | COFF DATE | CREDIT | EXPIRY | CONSUMED ON
Upcoming expiry: … | DAYS LEFT | EXTENDED
Already expired: … | DAYS OVER | EXTENDED
Generated (by employee): EMPCODE | NAME | NO. OF COFF (ROWS) | TOTAL CREDIT (DAYS)
```

COFF **expires** (days configured per Leave Level, §7) and expiry can be **extended**.

---

## 7. ⭐ Leave — a fully configurable policy engine

Three layers, and the depth is all in layer 2.

**Layer 1 — Leave Type** (`Leave → Leave Type`) is deliberately thin:
`Leave Type Name`, `Short Name`, `Is Hourly Leave`. Demo types: **PL, CL, SL, ML, LOP, COFF**.

**Layer 2 — Leave Level × Leave Type** (`Master → Leave Level Master` → edit a level).
A Leave Level (e.g. *Office Staff, HOD, Worker, Maintenance & QC Staff, Production Staff*) has
`Allow Quarter Leave`, then a grid of every leave type with `Active | Yearly Limit | Carry Limit |
[Configure]`. **Configure** opens the real policy:

```
LEAVE & LIMITS
  Yearly Limit
  Is Carry Forward
  Allowed After (days)        ← probation gate; demo value 180

ACCRUAL & VISIBILITY
  Auto Deduction (Monthly)    Auto Credit (Monthly)    Is Visible
  Include WO in Leave         Credit Leave With Formula (Yearly)
  Allow Negative Balance      Auto Credit Opening

DEBIT & COFF
  Monthly Debit Limit    Batch Debit Limit    Batch Debit Duration
  Is Coff Enjoy First    Coff Expiry (days)

ENCASHMENT
  Is Encashable
```

**Layer 3 — the employee** just picks a Leave Level. Balances live on the employee's *Leave Detail*
section and in the Leave Ledger.

**Copy every one of those flags.** `Include WO in Leave` (does a weekly off inside a leave span count
as leave?), `Is Coff Enjoy First` (burn comp-off before earned leave) and `Allow Negative Balance` are
exactly the arguments a restaurant owner will have with staff, and having them as switches ends the
argument.

### 7.1 Leave operations

- **Leave Entry** — apply/record leave for an employee.
- **Leave Opening** — set opening balances per year × type (Excel import supported).
- **Leave CarryForward** (`Leave_Transaction.aspx`) — the year-end roll. Shows
  `Opening Present | Opening Absent | Present | Absent | Prev. Balance | This Year | Total Balance |
  Allowed (batch)`, then **Preview & create batch** → named batches → **Run full batch** /
  **Proceed selected**, with per-row `Status | Message | Rev | Rem` and a **Carry forward history
  report**. This is a *reviewable, resumable, reversible bulk job* — copy the shape.
- **Leave Credit** — monthly accrual posting.
- **Leave Encashment** — grid `EMP CODE | NAME | AVAILABLE BALANCE | LEAVES ENCASHED | AMOUNT`.
- **Leave Statement** — matrix view, with a *Show Present* setting.
- **Leave Ledger** — per employee: `Period | Leave Type | Opening | Credit | Debit | Encash | Closing`.

> The dashboard even nags: a modal on login says *"Reminder: Carry forward remaining leaves to the new
> attendance year…"* with a direct button to the carry-forward screen. Good habit — surface the
> once-a-year job at the right time of year.

---

## 8. ⭐ Payroll — the month-batch state machine

### 8.1 Salary Process (the control board)

`Payroll → Salary Process`. A month-chip strip (`All Months · Aug/2026 · Jun/2026 · …`) + **Add Month**.
Grid is **one row per Salary Month × Company**:

```
Salary Month | Company Name | Employee Count | Batch Remaining | Salary Calculated |
Salary Verified | [+ New Batch] | [⚙ Process Batches] | Lock Status ⏻ | Finalization Status ⏻
```

Real numbers seen for May/2026 · Company 2: 124 employees, 13 batch remaining, 121 calculated,
124 verified. `Batch Remaining` renders in red — an at-a-glance "this month isn't done".

### 8.2 Batches

**New Batch** = Batch Name + month + a checkbox tree over Category / Company / Division / Department.
Real batch names from the demo tell you exactly how a factory thinks:

```
ALL PF STAFF & HOD PARDI      (16 employees)
ALL PF STAFF & HOD SARIGAM    (45)
ALL NON PF STAFF & HOD SARIGAM(22)
ALL PF WORKERS SARIGAM        (10)
ALL NON PF WORKERS SARIGAM    (18)
```

Batch grid: `Batch Name | Total Employees | Month Days | Working Days | Weekly Offs | Holidays |
[Actions ▾ → Batch Emp List · View Batch]`.

### 8.3 ⭐⭐ The five stages (`SalaryProcessNew.aspx`)

```
① Collect Attendance → ② Manual Import → ③ Loan and Advance → ④ Salary Calculation → ⑤ Finalization
```

Rendered as a stepper with green ticks; completed batches lock the earlier steps (`step-item disabled
completed`). Header strip always shows: `Month Days · Working Days · Weekly Offs · Holidays` and
`Total Employees · Companies · Categories · New Joinings · Resignations`.
Footer strip: `Total Employees · Zero Days In Total · MP/NSF Status` — i.e. **"how many people would
be paid nothing"** and **"how many have missing punches"**, always visible. Copy that footer.

**① Collect Attendance** — a `COLLECT ATTENDANCE` button + `REFRESH`, and on the right a file/paste
importer for bringing attendance in from outside.

**② Manual Import** — one block **per manual head**, each with a *Mandatory* flag, a
*File is not uploaded* status, File Format link, file picker **or paste-area**, Preview → Import Data
→ Clear, a running **Total**, and a preview grid `Emp Code | Employee Name | Amount`.
Blocks seen: **Advance · Canteen · Monthly Incentive · OTHERS · Reimbursement**.

> The *Mandatory* flag per head is the good bit: the batch tells you what's still missing before it
> will let you finish.

**③ Loan and Advance** — Loan Month + Show + Export CSV/Excel; when empty it says exactly why
("Employees in this batch may not have any active loans for May-2026").

**④ Salary Calculation** — a progress bar with **"Remaining time: calculating…"**.

**⑤ Finalization** — the summary screen:

```
Total Payroll Summary : Total Employees · Gross Salary · Other Earning · Total Earning ·
                        Total Deductions · Net Salary
Allowances Breakdown  : per head + "Earned Gross"
Other Earnings        : OTHERS · Monthly Incentive · Reimbursement
Deductions Breakdown  : PF · ESIC · Total Deduction
Total Liabilities     : outstanding obligations
Total Company Expense : Net Salary + Total Liabilities
                        [✓ Verified & Completed]
```

Real figures (16 employees, May-2026): structure totals BASICDA ₹3,92,540 / HRA ₹1,57,020 /
SpecialAllowence ₹2,35,512, but **Earned Gross ₹3,53,646** — i.e. the breakdown shows *full structure*
while gross shows *attendance-prorated earned*. Net ₹3,35,972 after PF ₹16,481 + ESIC ₹1,193.

### 8.4 Lock and Finalize — ⚠️ and why it does NOT actually hold

Two independent toggles per Month × Company on the control board, mirrored in
`Utility → Payroll Month` as `Salary Month Name | IsLock | IsFinal`. Locked months render their
editable payroll fields with a **red padlock**.

**Correction after re-testing on 2026-08-16:** this lock is *advisory, not enforced*. On
`Utility → Payroll Month`, every past month shows `IsLock ON` + `IsFinal ON`, but the `[Edit]` button
beside each row opens *"Salary Month — 2 companies found"* with **both toggles directly editable per
company**. A finalised month can be re-opened in one click, with **no reason field, no second
confirmation, no approval step — and nothing written to the audit log**, which (verified) records
*only login events*. So HRMex's immutability is a convention its own UI invites you to break.

> **This is our compliance analogue, and it is where we must be strictly better.** Aevidine already
> refuses to let a sale disappear; payroll needs the same, *enforced*: a finalized month is immutable
> at the database level, corrections happen as a *next-month arrear* (§8.6), and any reopen — if we
> allow one at all — demands a reason and writes to the audit log.

### 8.5 Payroll Voucher (the per-employee slip + the editing surface)

`Payroll → Payroll Voucher`. Left: a searchable tree (`Location → Company → Division → Department →
Employee`). Right: the slip:

```
Employee Information
  Leave block:  LEAVE NAME | OPENING | CREDIT | DEBIT | ENCASH | BALANCE
  Loan block:   LOAN NAME | NEW LOAN | INSTALLMENT | INTEREST | BALANCE
Attendance:     ATTENDANCE | VALUE
Fixed & Earnings
  FIXED (structure)        vs   EARNINGS (this month, editable)
Fixed Deduction & Deduction
  FIXED DEDUCTION          vs   DEDUCTION (this month, editable)
TotalDays | TotalFixed | TotalEarnings | TotalDeductions
Net Salary :- ₹ …
```

Editing model: *"Double-click on highlighted fields to edit → Enter to save → Esc to cancel."*
Toggles **Leave Hide / Loan Hide** collapse those blocks. **Recalculate** re-runs one person.

### 8.6 The rest of Payroll

- **Manual Attendance** — post attendance-head totals by hand per employee per month
  (heads: `P, A, H, OT HRS, PL, WO, WOP, HP, CL, OD, COFF, LTD, SL, LateBy, SHL, ExtraHRS, DLD, SPL, ML`).
- **Manual Wages** — same, for money heads.
- **Wages Import List** — bulk import a single head for a month.
- **Salary Import / Employee Wages Update** — bulk revise structures.
- **Increment Initialize** — create a named increment batch (Increment Month + **Effective Month** +
  Remark), pick employees by filter *or* **paste data**, then **View / Proceed / Cancel**.
- **Arrears Calculation** — same shape; because the effective month can precede the increment month,
  arrears are computed and paid as a separate head. **This is the correct answer to "we forgot to pay
  X last month"** — not editing a finalized month.
- **Email Salary Slip** — filter → Load Employees → payslip type (`Custom | With Balance | Without
  Balance`) → **Send Mail (Immediate) / Send Mail All / Pause All / Stop All**, with per-employee
  `Email Status: Pending | Success`. A pausable, resumable bulk mailer.
- **Payroll Month / Attendance Year** (Utility) — open/close periods.

---

## 9. Loans & advances

Types: `LOAN`, `ADVANCE`, `HOME_LOAN`.

- **Loan** — `EmpCode | Employee Name | Loan | Installment | Date`.
- **Loan Opening** — carry-in balances (Excel import).
- **Loan Manage** — per month, per employee, per type, adjust the **Amount** deducted this month.
- **Loan Prepayment** — a lump payment with a date + remark, outside the instalment schedule.
- **Loan Statement** — month view across employees.
- **Loan Ledger** — per employee across a month range.

The loan deduction lands in payroll via the `Loan Head` mapping (§4.1), and the voucher shows
`NEW LOAN | INSTALLMENT | INTEREST | BALANCE`.

---

## 10. The other modules

### 10.1 Approvals — Hierarchy Master

`Master → Master ▸ Hierarchy Master`. A named hierarchy holds:

```
Allow Approval Before Authentication?
is L1 Authentication Required?  → Level1 Authenticator 1 & 2
is L2 …                          → Level2 Authenticator 1 & 2
is L3 …, is L4 …                 (each with two named employees)
Approver 1 · Approver 2 · Approver 3 · Approver 4
```

Employees join a hierarchy via their *Hierarchy Level and Notification* section (`Hierarchy Group` +
`Level In Hierarchy` General/L1–L5). ESS requests then show **Pending Level: Pending at L1…L5**.
Two authenticators per level = either can approve (cover for absence). Simple and effective.

### 10.2 ESS (employee self-service)

Admin side only in this demo (`ESS → ESS Requests`): filter by **Request Type**
(`Leave · Miss Punch · OD · Reimbursement · OT Sanction`), Leave Type, **Status**
(`Pending · Approved · Disapproved`) and **Pending Level** (L1–L5). Grid:
`Request Type | Emp Code | Name | Department | From | To | Extra Info | Entry Date | Status | Pending Level`.

What the employee may do is controlled by **Master Settings → ESS tab**, *per Category*, using the same
17 actions from §6.3, plus **Hourly Leave**. Additional ESS switches on the Master tab:
`Show Badges on ESS`, `Punch mode`, `Manual attendance on ESS`, and notification toggles
(`Notify on bio punch / mobile punch / leave approval / request approval / birthday / salary slip`).
Employee-level kill switches: **ESS Password** and **Block Employee ESS**.

- **Announcement** — Title, Date, Priority (`Normal|High|Low`), Status (`Active|Inactive`), Description.
- **Company Policies** — upload named policy files, listed with type/date and View/Edit/Delete.

### 10.3 Performance (PMS)

- **KRA Master** — KRA Name, Description, **Department**, **Weightage %**, Active.
- **KPI Master** — under a KRA: KPI Name, Description, **Target value**, **UOM** (`Count (#) · Hours
  (hr) · Percentage (%) · Rupee (₹)`), **Calculation Type** (`Higher is better · Lower is better ·
  Range`) with Min/Max, Weight %, Active.
- **PMS Report** — `Emp Code | Name | Department | Designation | Period | Assigned KPI | KPI created
  by | KPI definition status | Total KPI Score | Total KRA Score | Final rating (Feedback) | Approval
  | Stage | Review Date`.

> `Higher is better / Lower is better / Range` is the whole trick to scoring arbitrary KPIs. For a
> restaurant: *covers served* (higher), *wastage %* (lower), *avg ticket time* (range).

### 10.4 Income tax / TDS

`HRMS → IT Declaration` — a per-employee, per-year (`2024-25`…) declaration list with a **Lock**
checkbox per row, and buttons **TaxProjection**, **Reprocess TDS**, plus **HRMS Settings**
(round values? · Round to Nearest / Floor / Ceil · Round To). TDS lands as the `TDS` deduction head.
Reports: **TDS ▸ Quarter Return**.

### 10.5 Statutory

Head mappings for PF / ESIC / PT, and reports: **PT Statement, PF ECR, ESIC ECR, PF Report,
Monthly Register, PT Report, EPFO Report**. (ECR = the government upload file formats.)

### 10.6 Full & Final (offboarding)

- **FNF Master** — its own head list (`# | Heads Name | Print Label | Type | Order No`) plus
  **FNF Settings**: Gratuity / Notice Pay / Bonus **formulas each with Verify**,
  `Gratuity Eligibility (Years)`, `Round off Months`, `Has Notice Period`, `Is FNF Required` +
  **FNF Required Category**, and *FNF form display* toggles (`Show Salary Structure · Show Earnings ·
  Show Deductions · Show Asset Details · Show Loan Recovery`).
- **Full & Final Settlement** — a three-bucket board: **FNF not started · FNF in progress ·
  FNF completed**.

Note the loop closes: assets issued in §5 are recovered here, loans outstanding in §9 are recovered
here, leave balance from §7 is encashed here.

### 10.7 Devices & biometrics

- **Device Management** — tabs Active/Inactive. A device is `Device Name, Attendance Direction
  (Alter | In | Out | Canteen | Access Control), Device Type (Normal | AI), Serial No, IP Address,
  Is Attendance, TimeZone, Device Company (Others | HikVision | Dahua), Is Active, Device Password`.
  Grid shows **Last Ping** and **Connection**. There is a **push-server** panel
  (`Server IP (0.0.0.0 = all interfaces)`, `Server Port (TCP)`, Start/Stop) — devices dial in.
  Devices can have **slave devices**.
- **Device Commands** — pick a command and target devices/employees:
  `Reset Att Logs · Upload Users to Device · Restart Device · Delete User · Block User · UnBlock User ·
  Enroll User Face · Enroll User Finger Print · Clear Logs From Device`. Separate HikVision variant.
- **Upload User To Device** — choose what to push: `UserInfo`, `User Pic`, and one of
  `Cards / FingerPrints / Face`; grid shows per-employee `CardNo | Finger | Face | AI Face`.
- **Blocked Employee** — device-level blocking.

### 10.8 Canteen (they built a mini-POS inside the HR system)

- **Canteen Settings** — Selection Mode radio + `Is Top-Up`.
- **Canteen Items** = meal *timings*: `Meal Name, Meal Start, Meal End, Rate, Gate Count (chk),
  Gate Start, Gate End`. A punch inside a meal window = a meal consumed at that rate.
- **Canteen Work Code** — `Workcode (1–9), Name, Rate, Employee Contribution, Employer Contribution,
  Category`. So the subsidy split is configured per work code per category.
- Charged via the `Canteen` deduction head; billed on the payslip; four canteen reports.
- Master Settings → Canteen tab: bill `On Timing` vs `On Workcode`, `Enable Print Receipt`, printer.

**This is directly reusable for staff meals in a restaurant** — arguably the single most
"already-fits-Aevidine" module in the product.

### 10.9 Templates & letters

- **Template Creation** — a genuine WYSIWYG document editor: template type (Offer / Appointment /
  Confirmation / Relieving / Experience), paper size (A4/Letter/Legal/A5/A3/Custom), orientation,
  margins in mm, page border, header/footer, line spacing, **watermarks** (CONFIDENTIAL / DO NOT COPY
  / DRAFT / SAMPLE / custom, diagonal or horizontal), multi-page, logo (+ repeat on every page),
  and a **searchable, drag-and-drop variable palette**.
- **Letter Generation** — 4 steps: **Select Template → Select Employees (single or batch by
  Department/Designation) → Preview & Generate → Export & History**. Exports PDF / Word / HTML /
  Print. History grid `Ref No | Template | Employee | Department | Generated | Status` with statuses
  `Generated · Exported · Printed · **Voided**`.

> **A generated letter is never deleted, only Voided.** Same instinct as our billing rule. Copy it.

**The variable dictionary** (this is effectively their data contract):

```
SYSTEM:  {{CurrentDate}} {{CurrentDateTime}} {{PrintDateTime}} {{Year}} {{MonthName}}
         {{PageNumber}} {{TotalPages}} {{PageNumberOfTotal}} {{DocumentTitle}} {{DocumentId}}
         {{TemplateName}} {{GeneratedByUser}} {{RefNo}}
MANUAL:  user-defined, added with +
DATA:    {{CompanyName}} {{CompanyAddress}} {{CompanyEmail}} {{CompanyPhone}} {{CompanyWebsite}}
         {{EmpName}} {{EmpCode}} {{EmpDesignation}} {{EmpDepartment}} {{EmpDOJ}} {{EmpFatherName}}
         {{EmpCategory}} {{EmpDivision}} {{EmpGender}} {{EmpEmail}} {{EmpMobile}}
         {{ReportingManager}} {{EmpLocation}} {{LetterDate}}
ALLOWANCES: one variable per head + {{Salary.Allowances}} (whole table)
DEDUCTIONS: one variable per head + {{Salary.Deductions}}
TOTALS:  {{Salary.NetSalary}} {{Salary.GrossSalary}} {{Salary.CTC}}
```

Note the pattern: **individual heads AND a whole-table variable**. That's how one template works for
every company's different head list.

### 10.10 Admin

- **UserTypes** — `UserType Name`, `UserType Level` (numeric), and **Report Type** = a multi-select of
  which export formats that type may use (PDF / Excel / Word / View / CSV…). Export rights are a role
  property.
- **Users** — Username, Password, First/Last Name, Contact, Mail ID, **Masters** (data scope),
  **User Type**, and flags `Is Admin` / `Is Super Admin` / `Is Active`.
- **Masters Permission** — a *Masters* record is `{ Masters Name, Short Name, Location }`. Assigning a
  Masters to a user is how their visible data is scoped. **This is their multi-tenancy, and it is
  weak** — scope by a single Location only, enforced in app code. See §12.
- **Audit Logs** — `LogDateTime | User Name | IP Address | Operation Type | Status`, date-filtered.
- **System** — three tabs:
  - **Custom Report**: define a report by *name + report text (SQL/proc) + Report Group + short id +
    which filters to show (Filter Month, From–To Date) + a Report Action*. Users can add reports
    without a release.
  - **Auto Mail**: `Name, Subject, Email From (Location | Company | User | Employee | isHOD |
    ReportingManager), Email Time, Mail ON/OFF` — scheduled report mailing, addressed by *role*.
  - **Auto Jobs**: `Auto Job Name, Job Time (Hours), Job Time (Min), Status` — the cron table.

### 10.11 Invoice
`Invoice → Invoice List` — Generate Invoice for a month. This is HRMex billing *its own customers*
(the SaaS's invoicing), not employee-facing.

---

## 11. Report catalogue (all 85, verbatim)

| Group | Reports |
|---|---|
| **Employee** | Employee Details · Employee form · Employee ID Card |
| **Leave** | Yearly Report · Leave EnCashment · Leave Ledger · Coff Report |
| **Loan** | Loan Yearly |
| **Payroll** | Salary Statement · Department Wise Summary · Designation Wise Summary · Costcentre Wise Summary · Salary Slip · Loan Report · Wages Register · **ICICI** · **HDFC** · BANK Statement · **SUDICO** · Consolidated Salary Statement · Pay Slip |
| **OT** | OT Report · OT Bank Statement |
| **Daily** | Daily Basic · Daily Detail · Department Summary · Company vs Department Head Count · Present · Absent · On Leave · Miss Punch · Late Coming · Early Going · Daily Report · Daily Special · Daily Attendance Summary · Employee Summary · Daily Attendance |
| **Monthly** | Monthly Basic · Monthly Summary · Monthly Detail · Monthly OT · Form 1 · Monthly Report · Detail View · Performance Report · Basic with ExtraWork · Basic with OT · Monthly Total Duration · Monthly In Out · Monthly Basic Status · Manual Entry · Monthly Late Coming |
| **Yearly** | Performance View · Yearly Report |
| **Statutory** | PT Statement · PF ECR · ESIC ECR · PF Report · Monthly Register · PT Report · EPFO Report |
| **Canteen** | Canteen Daily · Canteen Monthly · Canteen Report With Free Meal · Canteen Monthly Detail |
| **MIS** | Head Count Report · Monthly Loss Report |
| **TDS** | Quarter Return |
| **Access Control** | Department Wise · Employee Wise · Device Wise |

**Every report is the same three-part screen:** parameters (month / date range / report variant) →
a collapsible **Filter** card (the six org dropdowns) → **Report Format** (PDF | Excel) → **Generate**.
Salary Statement additionally offers variants `Normal · CTC · Balance With CTC · Balance`.

**Bank-specific reports (ICICI / HDFC / SUDICO) are a real product requirement**, not a nicety — the
salary-transfer file format differs per bank.

---

## 12. What is *broken* or weak — do NOT copy these

Found while exploring normally, no trickery:

1. **Their code is ahead of their database.** Salary Heads Master shows a red toast:
   *"Error loading salary heads: Invalid column name 'IsSystemGenerated'."* — and the list renders
   empty (`1-5 of 0 items`). A shipped screen, dead. *Lesson: our migration discipline (one folder,
   run-one-migration) exists precisely to prevent this.*
2. **Negative net salary rendered in green.** Payroll Voucher for EMP001 with `TotalDays 0`,
   `TotalEarnings 0`, `TotalDeductions 6801` shows **"Net Salary :- ₹ -6,801.00"** in green success
   styling. Nothing blocks it, nothing warns. *We must refuse to finalize a negative net, or force it
   to a carry-forward recovery.*
3. **Month label desynchronises from the picker.** The voucher header said *"Salary Slip for Month of
   Aug-2026"* while the month control read *May-2026*.
4. **An action that needs a selection is still clickable.** Pressing next/prev month on the voucher
   without choosing an employee throws a blocking modal *"No employee list available. Please select an
   employee from the tree."* — that's our own **"a tap must never vanish in silence"** rule violated in
   the other direction: don't offer the tap at all.
5. **Character-encoding bugs in production** — `â€"` appears in the attendance block, `HRMex â€“ User
   Master` in a page title. Latin-1/UTF-8 mix.
6. **Data scoping is app-level and single-dimension.** A user's scope is one *Masters* record → one
   Location, enforced in page code. There is no row-level database enforcement. **Our RLS approach is
   strictly better and must not be traded away for convenience.**
7. **Placeholder junk shipped to a live demo**: a report literally named `dthffyjh`, employees named
   `badmash`, duplicate `Loading / Unloading` entries in the hierarchy dropdown.
8. **Full-page postbacks everywhere.** Every filter click reloads. The Employee Master page is a
   **930 KB** HTML document; Payroll Voucher **477 KB**; Attendance Voucher **403 KB**. On a phone in a
   restaurant this is unusable. *Our egress rules already forbid this shape.*
9. **The modal that greets you on login** (leave carry-forward reminder) is unskippable and reappears.
   Good idea, bad implementation — make it a dismissible banner with a "remind me next month".
10. **Typos baked into the schema/UI**: `Allowence`, `Finilization`, `Categorgy`, `Shift Shedule`,
    `Assets Detaill`, `Utilitty` (an actual folder name). Once a typo is in a column name it's forever.

---

## 13. The implied data model (what we'd actually build)

Tables, in dependency order. All get `restaurant_id` and RLS, per our SaaS architecture rules.

```
ORG
  hr_department, hr_designation (is_hod), hr_section, hr_cost_center
  hr_category            -- the rule-scope dimension (chef / waiter / manager / part-time)
  hr_level, hr_leave_level
  hr_shift               -- the full §6.1 field set
  hr_shift_group, hr_shift_group_item
  hr_holiday_group, hr_holiday (date, full|half)
  hr_bank, hr_document_type, hr_education_type, hr_asset_type
  hr_attendance_year     -- calendar|financial, start month, active, carry_forward_done

PEOPLE
  hr_employee            -- links to our existing staff/user identity, NOT a second identity
  hr_employee_address, hr_employee_contact, hr_employee_family, hr_employee_nominee
  hr_employee_document, hr_employee_education, hr_employee_asset
  hr_employee_bank       -- uan, pf_no, esic_no, bank, ac, ifsc
  hr_onboarding          -- temp_id, invite status, employee_response status

PAY MODEL  ⭐
  hr_pay_head            -- §4 field set incl. formula + all flags
  hr_employee_pay_head   -- employee × head → condition, amount, is_ctc_component
  hr_head_map            -- role → head_id  (pf, esic, pt, loan, ot, ot_hrs, bonus, present, absent, coff…)
  hr_ot_slab             -- company × category × from_min × to_min → set_min
  hr_holiday_slab

TIME
  hr_punch               -- raw device log: employee, datetime, device, direction, source
  hr_attendance_day      -- computed: date, in, out, work_dur, ot, coff, e_work, total_dur,
                         --           status, shift_id, late_by, early_by, hp_minutes
  hr_shift_schedule      -- employee × date → shift, is_wo
  hr_attendance_action   -- the 17 corrections: type, date, values, remark, actor, approved_by
  hr_od, hr_gatepass, hr_short_leave

LEAVE
  hr_leave_type          -- name, short, is_hourly
  hr_leave_policy        -- leave_level × leave_type → the entire §7 flag set
  hr_leave_balance       -- employee × year × type → opening, credit, debit, encash, closing
  hr_leave_entry         -- application/record + approval state
  hr_coff                -- credit date, credit days, expiry, extended, consumed_on

LOANS
  hr_loan                -- type, principal, installment, interest, start
  hr_loan_txn            -- month, installment/prepayment, amount, balance

PAYROLL  ⭐
  hr_pay_period          -- month × company: is_locked, is_final  (immutable once final)
  hr_pay_batch           -- name, period, filter json, month_days, working_days, wo, holidays
  hr_pay_batch_employee
  hr_pay_run_stage       -- batch × stage(1..5) → status, started, finished, error
  hr_pay_line            -- employee × period × head → fixed_amount, earned_amount   ← the ledger
  hr_pay_summary         -- employee × period → total_days, gross, earnings, deductions, net
  hr_increment_batch, hr_arrear_batch

APPROVALS
  hr_hierarchy           -- + levels L1..L4, two authenticators each
  hr_request             -- type(leave|misspunch|od|reimbursement|ot), state, pending_level

OFFBOARD
  hr_fnf_head, hr_fnf_config (gratuity/notice/bonus formulas), hr_fnf_case

DOCS
  hr_template, hr_letter -- letter status incl. VOIDED, never deleted

STAFF MEALS (canteen)
  hr_meal_window         -- name, start, end, rate, gate window
  hr_meal_workcode       -- rate, employee_contribution, employer_contribution, category
  hr_meal_consumption
```

---

## 14. How this maps into Aevidine — recommended build order

We already own three quarters of the prerequisites: staff identity (`lib/staffProfileShared.ts`,
`PROFILE_ROLES`), permissions (`lib/accessTree.ts`, `lib/staffCaps.ts`), the audit log, the offline
write layer, the clash guard, and a compliance culture that maps *exactly* onto payroll locking.

**Every phase below is a module under our 11-point checklist** — admin entitlement default OFF,
permission-scoped, RPC-backed, egress-safe, offline-capable, back-button-registered, clash-guarded.

| Phase | What | Why this order |
|---|---|---|
| **1. Roster & shifts** | `hr_shift`, shift groups, weekly-off rules, holiday groups, schedule per staff per day | A restaurant's real pain is *rota*, not payroll. Highest value, lowest risk, and it needs no money logic. |
| **2. Attendance capture** | punches (phone/tablet PIN first, biometric later), `hr_attendance_day` computation, the **17 corrections** with permissions, `Pending vs All` recalculation with a progress bar | Everything downstream is a function of this table. |
| **3. Leave** | leave types + the full §7 policy engine per level, balances, ledger, carry-forward as a **reviewable batch** | Self-contained; owners will use it immediately. |
| **4. Pay heads & structures** | `hr_pay_head` + head map + per-employee structure + **formula field with a Verify button** | The foundation. Build no payroll math before this exists. |
| **5. Payroll run** | period × batch, the 5 stages, the finalization summary, **Lock + Finalize**, the "Zero Days / Missing Punch" footer | Copy the state machine exactly. |
| **6. Payslip & letters** | payslip document (reuse `public/panels/billdoc.js` thinking: **one print document**), templates with `{{variables}}`, letters that **Void, never delete** | Reuses patterns we already have. |
| **7. Advances & staff meals** | loans/advances (very common in Indian restaurants) + canteen/staff-meal deduction | Both are direct payroll inputs and both already fit our POS. |
| **8. Statutory** | PF / ESI / PT heads and the bank-transfer file per bank | Only when a real client needs it; it's a lot of format work. |
| **9. Self-service** | staff app: view payslip, apply leave, regularise a punch, see balance — routed through the L1–L5 hierarchy | Needs 2–5 to be trustworthy first. |
| **10. Offboarding & PMS** | Full & Final (recovers assets + loans, encashes leave) and KRA/KPI scoring | Last, and honestly optional for v1. |

### 14.1 Non-negotiables when we build it

1. **A finalized payroll month is immutable — enforced, not just labelled.** No edit, ever.
   Corrections are next-month **arrears** — HRMex models the arrears part correctly but leaves the
   lock reversible by one untracked click (§8.4). Same principle as *"a sale can be cancelled, never
   deleted"* (`docs/COMPLIANCE-GUARDRAILS.md`). Wage records are statutory records in India too.
2. **The audit log must record every money change**, not just logins. HRMex's records *only* login
   events — verified live — which means an unlocked-and-edited payroll month leaves no trace at all.
3. **Refuse to finalize a negative net salary** (their bug #2). Show it red, block the toggle, offer a
   recovery-next-month path.
4. **Store TWO amounts per head per person per month** — the structure amount and the *earned*
   (attendance-prorated) amount. HRMex proves this with its `E`-prefixed report columns
   (`BASICDA` vs `EBASICDA`, `Gross` vs `EGross`; Net = EGross − Deductions). Getting this wrong
   later means rebuilding every report.
5. **Nothing hard-coded.** PF/ESI/tips/meal-deduction are all rows in `hr_pay_head` + a head map.
6. **RLS, not app filtering.** Their Masters/Location scoping is exactly what our SaaS rules forbid.
7. **Egress**: no 930 KB pages. Scoped reads, column lists, `.limit()`, per-table fetch + merge —
   `docs/SAAS-EFFICIENCY-PLAYBOOK.md`. Invoke `data-cost-guard` before writing a single query.
8. **Every listing must say WHERE it lives** — panel → screen → what the owner would see → then the file.

### 14.2 What we should deliberately do *better* than HRMex

- **Phone-first.** Their entire product assumes a desktop with a mouse. A restaurant manager has a
  phone at 390 px. This is our biggest differentiator on day one.
- **Punch without hardware.** Tablet/phone PIN + geofence beats a ₹15,000 biometric box for a
  30-seat restaurant. Keep the device layer as an *optional* later module.
- **One identity.** HRMex has back-office `Users` and `Employees` as separate worlds. We already
  have one identity model (`docs/STAFF-PROFILE.md`) — do not fork it.
- **Explain the money.** Their payslip shows numbers; ours should show *why* ("₹1,200 deducted:
  3 days LOP × ₹400"). Same instinct as our discount/tax transparency work.
- **Offline.** A payroll screen that dies without internet is useless in an Indian restaurant.
  Our offline layer already covers this shape (`docs/OFFLINE-SYNC.md`).

---

## 15. Quick reference — the five ideas actually worth stealing

1. **One `pay_head` table with type + formula + flags**, and settings that *point* at heads.
2. **Period × Batch payroll with 5 explicit stages and a Lock/Finalize pair.**
3. **17 named attendance corrections** that double as the employee self-service permission list.
4. **Leave policy as Level × Type with ~15 switches**, not code.
5. **Formula fields with a Verify button; letters that Void, never delete.**

---

*Raw crawl output (structure of all ~130 screens, field-by-field) was captured during this study and
deleted after being written up here. Re-runnable from the same demo login if needed.*
