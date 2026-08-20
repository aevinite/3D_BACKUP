# HRMex — the complete click-map, flowcharts, and 500-phase register

Third and final document in the HRMex study. The other two:
- `docs/HRMEX-SCREEN-BY-SCREEN.md` — every screen and field, written out
- `docs/HRMEX-HR-PAYROLL-STUDY.md` — the engines, our data model, our build order

**This one answers "what can I click, and what happens then".** It is the depth-first map:
menu → sub-menu → screen → every button → the dialog it opens → the controls inside that →
and where each one leads. Then §5 is the 500-phase register, and §6 is the plain summary.

Studied live at `https://demo.hrmexweb.in/` on **2026-08-16**.

---

# 1. HOW TO READ THE MAPS

```
MENU
 └─ Screen  (URL)
     ├─▶ [Button]            → what it opens
     │    └─◆ Dialog title
     │         ├─ field [type] {options}
     │         └─▶ [Save] → result
     ├─◈ grid: Col | Col | Col
     └─⚑ note / bug
```
- `└─▶` = a click
- `└─◆` = a dialog / modal that click opens
- `└─◈` = a data grid
- `└─⚑` = something notable or broken
- `⇢` = navigates to another screen (a jump out of this branch)

---

# 2. THE MASTER MAP — all 13 modules on one page

```
HRMex
│
├── DASHBOARD ─────────── 8 KPI tiles ⇢ 8 different screens · Quicklinks(9) · Attendance Trend chart
│                          · Birthdays · Missed Punches · Dept Vacancies · Upcoming Holidays
│
├── ADMIN ─────────────┬─ Masters Permission ..... data scope (1 Location per scope)
│                      ├─ UsersTypes ............. role + level + allowed export formats
│                      ├─ Users .................. login + scope + Admin/SuperAdmin/Active flags
│                      ├─ Change Password
│                      ├─ Audit Logs ⚑ ........... LOGINS ONLY
│                      └─ System ................. Custom Reports · Auto Mail · Auto Jobs (cron)
│
├── MASTER ────────────┬─ Master Setting ......... 6 tabs + OT Slab + Holiday Slab + Late/Early
│                      ├─ Employee Setting ....... 2 tabs (creation rules + onboarding fields)
│                      ├─ Master ▸ (20 tables) ... Location · Company · Division · Department ·
│                      │                            Section · Designation · CostCenter · Shift ·
│                      │                            Shift Group · Holiday Group · SALARY HEADS ·
│                      │                            Category · Bank · Level · Leave Level ·
│                      │                            Hierarchy · Document · Education · Asset ·
│                      │                            Reimbursement
│                      ├─ Department Man power ... planned headcount by gender
│                      ├─ Employee Master ........ THE record — 10 sections
│                      ├─ Employee Onboarding .... invite → candidate self-fills
│                      └─ Employee Offboarding ▸ .. FnF Master (formulas) · FnF Settlement
│
├── HRMS ──────────────┬─ IT Declaration ......... full TDS engine, 8 tabs, Old vs New regime
│                      └─ PMS ▸ ................. KRA Master · KPI Master · PMS Report
│
├── ATTENDANCE ────────┬─ Device Logs ............ raw punches (+ manual punch)
│                      ├─ Late Early Entry
│                      ├─ Logs Approval .......... manual/mobile punches await approval
│                      ├─ Holiday ................ per Holiday Group per year
│                      ├─ OD Entry ............... on-duty / field work
│                      ├─ COFF ................... comp-off engine, 5 lists, expiry
│                      ├─ Attendace Voucher ⭐ ... the day grid + THE 17 CORRECTIONS
│                      ├─ Attendance Checklist ... "who is wrong today"
│                      ├─ Shift Shedule .......... roster: import / manual / AUTO generate
│                      ├─ Leave ▸ ............... Type · Entry · Opening · CarryForward ·
│                      │                            Credit · Encashment · Statement · Ledger
│                      └─ Attendance Calculation . punches ➜ days  (Pending | All)
│
├── LOAN AND ADVANCE ──── Loan · Loan Manage · Loan Prepayment · Advance · Loan Opening ·
│                          Loan Statement · Loan Ledger        [LOAN | ADVANCE | HOME_LOAN]
│
├── UTILITY ───────────┬─ Device Management ...... biometric devices + push server
│                      ├─ Device Commands ........ 9 remote commands
│                      ├─ DC(Hikvision)
│                      ├─ Upload User To Device .. push UserInfo / Pic / Card / FP / Face
│                      ├─ Blocked Employee
│                      ├─ Employee Import ........ file OR paste
│                      ├─ Payroll Month ⚑ ....... IsLock / IsFinal — and they can be undone
│                      └─ Attendance Year ........ calendar or financial year, carry-forward flag
│
├── PAYROLL ───────────┬─ Salary Process ⭐ ...... month × company board ➜ batches ➜ 5-stage runner
│                      ├─ Employee Wages Edit
│                      ├─ Attendance Import · Collect Attendance · Attendance List
│                      ├─ Wages Import List
│                      ├─ Manual Attendance · Manual Wages
│                      ├─ Salary calculation ..... + Working-days override per month
│                      ├─ Salary List
│                      ├─ Salary Import
│                      ├─ Increment Initialize ... named batch, effective month
│                      ├─ Arrears Calculation .... the correct way to fix a closed month
│                      ├─ Payroll Voucher ........ the per-employee slip (editable)
│                      └─ Email Salary Slip ...... pausable bulk mailer, per-row status
│
├── ESS ───────────────┬─ ESS Requests ........... 5 request types × 5 pending levels
│                      ├─ Announcement
│                      └─ Company policies
│
├── REPORTS ─────────── 14 groups · 72 links · ~30 pages · RDLC ReportViewer ➜ Excel/PDF/Word
│
├── INVOICE ─────────── Invoice List ⚑ (Generate opens an empty screen)
│
├── ACCESS CONTROL ──── Canteen Settings · Canteen Items (meal windows) · Canteen Work Code
│
└── TEMPLATE MGMT ─────┬─ Template Creation ...... WYSIWYG page designer + {{variables}}
                       └─ Letter Generation ..... 4-step wizard, letters VOIDED not deleted
```

---

# 3. THE CLICK-MAPS — module by module, depth first

## 3.1 ADMIN

```
ADMIN
├─ Masters Permission  /Admin/Masters.aspx
│   ├─◈ Master Name | Master Short Name
│   ├─▶ [Add Masters Combination] ⇢ Masters_AU.aspx
│   │     └─◆ Masters
│   │          ├─ Masters Name [text]
│   │          ├─ Masters short Name [text]
│   │          ├─ Location [sel] {Location 1..5}
│   │          └─▶ [Save]
│   ├─▶ [Edit]   → same form, populated
│   └─▶ [Delete] → native confirm()
│
├─ UsersTypes  /Admin/User_Types.aspx
│   ├─◈ UserType Name | UserTypeLevel | ReportType   (2 rows: SUPER ADMIN·1, Admin·1)
│   ├─▶ [Add User] ⇢ User_Types_AU.aspx
│   │     └─◆ UserType Master
│   │          ├─ UserType Name [text]
│   │          ├─ UserType Level [text]      ← numeric seniority
│   │          ├─ Report Type [multi-select] {PDF | Excel | Word | View | CSV …}
│   │          └─▶ [Save]
│   ├─▶ [Edit]   → __doPostBack('grduser','EditData$0')
│   ├─▶ [Delete] → confirm('Do you want to Delete ?')   ⚑ native confirm, inconsistent with
│   │                                                      the SweetAlert dialogs used elsewhere
│   └─⚑ Opening User_Types_AU.aspx directly (no id) HANGS THE BROWSER TAB — JS never returns
│
├─ Users  /Admin/User_Master.aspx
│   ├─◈ Username | First Name | Last Name | Contact No | Admin? | Actions
│   ├─ search · Items per page {10|15|25}
│   ├─▶ [+ New User] ⇢ User_Master_AU.aspx
│   │     └─◆ New User Details
│   │          ├─ ACCOUNT CREDENTIALS ─ User Name* · Password*
│   │          ├─ PERSONAL INFORMATION ─ First Name* · Last Name* · Contact No · Mail ID
│   │          ├─ ROLE & SETTINGS ─ Masters [sel] · User Type [sel]
│   │          ├─ FLAGS ─ ☐ Is Admin · ☐ Is Super Admin · ☐ Is Active
│   │          └─▶ [Save] / [Cancel]
│   └─▶ [Delete] → ◆ "Delete User?" → [Cancel] [Yes, Delete]
│
├─ Change Password  /Admin/Password_Change.aspx
│
├─ Audit Logs  /Admin/Logs_Audit.aspx
│   ├─ Date From · Date To ─▶ [Filter]
│   ├─ Search Here…
│   ├─◈ LogDateTime | User Name | IP Address | Operation Type | Status
│   └─⚑ VERIFIED: contains LOGIN EVENTS ONLY. Filtering all of 2026 returned 2 rows —
│        my own two logins. No data change is recorded anywhere in the product.
│
└─ System  /Admin/System_Mst.aspx
    ├─◇ TAB: Custom Report
    │    ├─◈ Custom Report Name | Report Text | Report Name     ⚑ live junk: edgrf / dthffyjh / sdf
    │    └─▶ [New Report] └─◆ ├─ Custom Report Name · Custom Report Text (SQL) ·
    │                          │  Report Group [sel] {12 groups} · Short ID · Report Name ·
    │                          │  ☐ Filter Month · ☐ From Date-TO Date · Custom Report Action
    │                          └─▶ [Save]
    ├─◇ TAB: Auto Mail
    │    ├─◈ Name | Subject | Email From | Email Time | Mail ON/OFF
    │    │    Birthday_Mail 00:01 OFF · Inactive-user-email 07:00 OFF · Daily Report Email 09:00 OFF
    │    └─◆ Name · Subject · Email From [sel] {Location|Company|User|Employee|isHOD|ReportingManager}
    │         · Email Time · ☐ Mail-ON/OFF
    └─◇ TAB: Auto Jobs   ⭐ the cron table
         ├─◈ Auto job Name | Job Time(Hour) | Job Time(Min) | Status
         │    Collect_Attendance_Full_Month 02:00 OFF
         │    Calculate_Full_Month_Salary   03:00 OFF     ← the whole month can run unattended
         └─▶ [Start]
```

## 3.2 MASTER — settings

```
MASTER ▸ Master Setting   /Master/Master_Settings.aspx
├─◇ TAB Master ─ Salary Heads Column in Excel(33) · Email To/CC/BCC ·
│    ☑Show MyDepartment to All · ☐Send Mail on Master Change · ☐Check User Wise Entry ·
│    ☑Show Badges on ESS · Punch mode(0) · ☐Manual attendance on ESS ·
│    ☐Notify on bio punch · ☐mobile punch · ☐leave approval · ☐request approval ·
│    ☐birthday · ☐salary slip
├─◇ TAB ESS ─ pick Category ▶ tick which of the 17 day-actions its staff may request
├─◇ TAB Leave ─ Leave Type · Auto Leave{Disable|Enable} · Auto Leave Name · COFF Head ·
│    ☑Attendance Year Same For All
├─◇ TAB Attendance ─ Attendance Type · Absent Head · Present Head · Extra Hrs Head ·
│    Attendance Order By · ☑Auto Mobile Punch Approve · ☐Separate Holiday Minutes ·
│    ☐Separate Holiday OT · ☑Show Report With Full Absent · ☐Delete Shift Schedule On Blank ·
│    Min Diff Between Punches(1) · Max Diff(3) · Auto OT Limit(1440) ·
│    Round Total Duration(-1) · ☑Auto OT Sanction
├─◇ TAB Payroll ─ Pay Cycle{Default|Custom} · Cycle Start/End Date ·
│    Allowance Type · Deduction Type ·
│    ⭐ HEAD MAP: PT Head · PF Head · Loan Head · OT Hrs Head · OT Head · Bonus Head · ESIC Head
│    ⭐ DIVISOR: ○ Month Day  ● Work Day
├─◇ TAB Canteen ─ ○On Timing/○On Workcode · ☐Enable Print Receipt · Printer ─▶[Test Printer]
├─▶ [OT Slab] └─◆ OT Slab Configuration
│                  ├─ COMPANY [sel] · CATEGORY [sel]
│                  └─◈ From OT (min) | To OT (min) | Set OT (min) | Total Hrs
│                       "if OT lands between X and Y minutes, pay Z minutes"
├─▶ [Holiday Slab] └─◆ Holiday Slab Configuration ─ COMPANY [sel] · CATEGORY [sel] (rows load after)
├─▶ [Late Early Master] └─◆ Late/Early Reason Master  ⚑ OPENS COMPLETELY EMPTY — dead screen
└─▶ [Save Settings]

MASTER ▸ Employee Setting  /Master/Employee_Settings.aspx
├─◇ TAB Emp Master ─ Code Length · ☐Enable Auto Code · Short Code Source ·
│    ☐Aadhar Mandatory · ☐PAN Mandatory · ☐Bank Details Mandatory · ☐Joining Date Required ·
│    ☐Age Restriction · ☐Verify Aadhar on Resignation · ☐Verify Aadhar by Location ·
│    Primary Weekly Off · ☐Enable 2nd Week Off + Day + ☐1st☐2nd☐3rd☐4th☐5th ·
│    Calculation Method ─▶[Save Settings]
└─◇ TAB Onboard ─ which fields the CANDIDATE must fill:
     ☐Bank Details ☐Employee Photo ☐Date of Birth ☐Gender ☐Emergency Contact ☐Nominee
     ☐Cast ☐Blood Group ☐Address ☐Emergency Contact 2 ─▶[Save Onboard Settings]
```

## 3.3 MASTER — the 20 reference tables (one shape, verified)

```
Master ▸ Master ▸ <any table>          e.g. /Master/Department_Mst.aspx
├─ Search <thing>…            ├─ Items per page {5|10|13|15|25}
├─◈ Name | Print Label | Actions   (column headers are click-to-sort → sortData('col'))
├─▶ [New <Thing>]  → openAddModal()
│    └─◆ New <Thing>
│         ├─ <Thing> Name *  [text]        ← required
│         ├─ Print Label     [text]        (or the table's extra field, below)
│         └─▶ [Save <Thing>]   ┬─ empty name  → toast "…Name is required"      ✔tested
│            [Cancel]          ├─ duplicate   → ◆"Error — …Already Exists" [OK] ✔tested
│                              └─ valid       → row appears immediately        ✔tested
├─▶ [✏ Edit]   → same modal, populated
└─▶ [🗑 Delete] → ◆ "Delete <Thing>? Are you sure you want to delete <NAME>?"
                   └─▶ [Yes, Delete] / [Cancel]                                ✔tested

  THE EXTRA FIELD PER TABLE
  Location ..... + Mail ID · CC Mail ID · Employee Short Code
  Designation .. + ☐ Is HOD?          (renders as an inline toggle in the grid)
  Shift Group .. + Short Name + child grid: Shift Name | Action
  Education .... + Edu_order BY
  Asset/Bank/Level/Holiday Group .. name only
  Reimbursement  + Reimbursement Head [sel] · ☐Show Date Selection + Mode{Single Date|Date Range}
                   · ☐Show Amount + Source{Manual Entry|From Payroll (Auto)} · ☐Show Kilometers

  ⚑ Location Master is DEAD — "Object reference not set to an instance of an object.", 0 rows
  ⚑ Salary Heads Master is DEAD — "Invalid column name 'IsSystemGenerated'", 0 rows
```

### The two special ones

```
Master ▸ Shift Master  /Attendance/Shift_Mst.aspx      (10 shifts live)
└─▶ [New Shift] └─◆ New Shift — 29 fields in 5 named sections
     ├─ ℹ Basic Information ─ Shift Name* · Short Name* (e.g. GS)
     ├─ 🕐 Shift Timing ─ Begin Time* · End Time* · First Half Out · Second Half In
     ├─ ☕ Break Settings ─ ☐Enable · Break Out · Break In · ☐Duration · Mins
     ├─ 👆 Punch Settings ─ ☐Begin Before+Mins · ☐End After+Mins · ☐Shift End+Mins · ☐Grace Time+Mins
     └─ ⚙ Attendance Rules ─ Halfday Mins · Absent Mins · Quarter Mins · Quarter Absent ·
                              ☐Deduct Lunch · ☐Next Day OT · ☐Night Shift · Extra Dur

Master ▸ Salary Heads  /Master/SalaryHeads_Mst.aspx    ⭐ THE PAYROLL CORE
├─ Search · Type[sel] · Order By{OrderNo|Heads Name} · Sort{Asc|Desc}
├─◈ Heads Name | Type | Order No. | Actions        ⚑ ERRORS, 0 rows
└─▶ [Add Salary Head] ⇢ SalaryHeads_AU.aspx
     └─◆ New Salary Head
          ├─ Type* [sel] {Allowence | Deduction | Attendance | Leave | SYSTEMS}
          ├─ Heads Name* · Print Label* · Formula Field* · Order No*
          ├─ ☐Is Gross      ☐Is Visible
          ├─ ☐Is Basic      ☐Is Time Field
          ├─ ☐Is CTC Component   ☑Roundoff value
          ├─ ☑Is Calculable      ☐Is TDS Calculable
          ├─ ☐Is Reimbursement Head   ☐Is Reimbursement Calculable
          └─▶ [Save] / [Cancel]

Master ▸ Hierarchy Master  /Master/Hierarchy_Mst.aspx   (12 hierarchies live)
└─▶ [New Hierarchy] └─◆
     ├─ Hierarchy Name
     ├─ ☐ Allow Approval Before Authentication?
     ├─ ☐ is L1 Authentication Required? → Level1 Authenticator1 [sel] · Authenticator2 [sel]
     ├─ ☐ is L2 …  ☐ is L3 …  ☐ is L4 …   (each with two named employees)
     ├─ Approver 1 · Approver 2 · Approver 3 · Approver 4
     └─▶ [Save]
```

## 3.4 MASTER — the employee record

```
MASTER ▸ Employee Master   /Master/Employee_Mst.aspx        (930 KB page, 124 employees)
├─◈ 31 columns · per-column search box + per-column filter icon · click-to-sort
├─ footer: License / Active Emp : 1000 / 124 · Selected : 0 · Showing 1-30 of 124 · Page 1 of 5
├─▶ [New Employee] · [Export] · [Import] · [Grid] · [List] · [Reset] · ☐Responsive (+) Mode
└─▶ row ☰ menu
     ├─▶ View   → employeeRowCommandAjax(id,'ViewData')     ⇢ Employee_AU.aspx
     ├─▶ Edit   → editEmployeeAjax(id)
     ├─▶ Resign → employeeRowCommandAjax(id,'ResignOptions')
     │     └─◆ Resign Options
     │          ├─ ○ Last Punch Date
     │          ├─ ○ Custom Resign Date  → date box
     │          ├─ ○ Last Punch Date to Month End
     │          └─▶ [Update] · [Update & Block] · [Update & Delete]
     └─▶ Delete → deleteEmployeeAjax(id)

     ⇣ Employee_AU.aspx — header + 10 collapsible sections (each "+" opens)

     HEADER ─ Aadhar No · PAN No · Emp Code · Device Code · Employee Name · Gender ·
              Designation · Date of Birth · Status{Working|Resign} · Joining Date · 📷 photo
     POSTING ─ Location · Company Name · Division · Department · Section · Category ·
              Shift Group · Holiday Group · Level · Leave Level · CostCenter · Reporting Manager ·
              Weeklyoff{Sun..Sat|No WO|as Category} · OT{Not Applicable|Applicable} ·
              ☐2nd WO · Weeklyoff 2 · ☐First ☐Second ☐Third ☐Fourth ☐Fifth
              └─▶ [Upload to Device] + device picker {Sarigam - Offline | Vapi - Offline}
     │
     ├─◆ Address ......... Current Address · Permanent Address · ☐Same As Current ·
     │                     Address Line 1/2 · Landmark · District · City · State · Country · Pincode
     ├─◆ Contact Detail .. Mobile · Email · Emergency Contact · Emergency Contact 2 · Driving Licence
     ├─◆ Documents ....... Document Name[sel 12 types] · Document Number · 📎 file  (repeating)
     ├─◆ Education Detail  Education Name[sel 5] · Document Number · 📎 file       (repeating)
     ├─◆ Family Details .. Spouse Name/Mobile/DOB · No. of Children ·
     │                     Father Name/Mobile · Mother Name/Mobile ·
     │                     Emergency Contact 1 & 2 ·
     │                     NOMINEE 1 & 2: Name · Relationship · DOB · Mobile ·
     │                       ☐Is Minor? → Guardian Name · Guardian Rel
     ├─◆ Assets Detaill .. Asset Name[sel 7] · Make · Model No · Serial No · Value · Remark
     ├─◆ Salary Details ⭐ UAN · PF Number · ESIC Number · Bank Name[sel 19] · Bank A/c · IFSC ·
     │                     CTC Amount · CTC Type{Daily|Monthly|Yearly} · Daily CTC ·
     │                     OT Per-hour rate · Pay scale
     │                     ├─◈ ALLOWENCE : Heads Name | Condition | Wages Amount
     │                     └─◈ DEDUCTION : Heads Name | Condition | Wages Amount | CTC Component
     │                        live: BASICDA 40260 + HRA 16104 + Special 24156 = CTC 80520 ✔
     │                              PF Condition=1 Amount=1800  ← Condition flips formula ↔ fixed
     ├─◆ Leave Detail .... ◈ Leave Name | Balance   (editable opening balances)
     ├─◆ Hierarchy Level and Notification ─ Hirarchy Group[sel] ·
     │                     Level In Hierarchy{General|L1|L2|L3|L4|L5} · Notification{No|Yes} ·
     │                     ESS Password · ☐Block Employee ESS
     └─◆ Other Details ... Caste{General|OBC|SC|ST} · Blood Group

MASTER ▸ Employee Onboarding   /Master/Employee_Onboard_Home.aspx
├─◈ TempID | Employee Name | Company | Status | Emp Respond | Action     (Total: 13, all Pending)
└─▶ [New Onboard] ⇢ Employee_Onboard.aspx
     └─◆ Onboard Details — Employee Name · Email ✉ · Phone ☎ · Company · Department · Designation
          └─▶ [Onboard] → sends the link → candidate fills the fields set in Employee Settings ▸ Onboard
                          → two statuses move independently (HR side · candidate side)

MASTER ▸ Employee Offboarding
├─ Full and Final Master  /FullNFinal/FullNFinal_Mst.aspx
│   ├─◈ # | Heads Name | Print Label | Type | Order No | Actions
│   ├─▶ [Add New Head] └─◆ Type · Heads Name · Print Label · Order No
│   ├─ filters: Order By{Order No|Head Name} · Sort Direction · --All Types-- ─▶[Apply Filter][Clear]
│   └─▶ [FNF Settings] └─◆ FNF Configuration
│        ├─ Gratuity   [formula] ─▶ ✔Verify
│        ├─ Notice Pay [formula] ─▶ ✔Verify
│        ├─ Bonus      [formula] ─▶ ✔Verify
│        ├─ Gratuity Eligibility (Years)=60 · Round off Months=6 · ☐Has Notice Period
│        ├─ ☐Is FNF Required · FNF Required Category [multi]
│        ├─ FNF form display: ☑Salary Structure ☑Earnings ☑Deductions ☑Asset Details ☑Loan Recovery
│        └─▶ [Save Configuration] / [Cancel]
└─ Full and Final Settlement  /FullNFinal/FullandFinal.aspx
    └─ 3 buckets: [FNF not started 0] [FNF in progress 0] [FNF completed 0]
       + status[sel]{Settlement Not Yet Started|Started|Completed} + search
```

## 3.5 HRMS

```
HRMS ▸ IT Declaration  /HRMS/IT_Declare_List.aspx           ⭐ a complete TDS engine
├─ filters: Categorgy · Company · Division · Department · Status · Year{2024-25|2023-24|2022-23}
├─▶ [Filter] · [TaxProjection] · [Reprocess TDS]
├─▶ [HRMS Settings] └─◆ ☐Round the values? · Type of rounding{Round to Nearest|Floor|Ceil} · Round To
├─◈ ☐Lock | Emp Code | Employee Name | Location | Company | Division | Department | Category
└─▶ [IT Declaration] (per row) ⇢ /HRMS/IT_Declaration.aspx
     ├─ Year[sel] · Emp Code · Employee Name · Regime{Old Regime|New Regime}
     ├─▶ [Compare]  ← compares old vs new regime tax
     ├─▶ Form 16    ← link
     ├─◇ 8 TABS
     │    ├─ IT Declaration ─ accordions, each ◈ Particular | Max. Limit | Declared Amount |
     │    │                    Actual Amount | [Download]
     │    │    ├─ 80EE - Interest on Housing Loan       (Max 200000)
     │    │    ├─ C - Deduction Under Chapter VI A
     │    │    ├─ D - Rajiv Gandhi Equity Saving Scheme
     │    │    ├─ E - Medical Insurance Premium
     │    │    └─ F - Medical Treatment for Handicapped Dependents
     │    ├─ HRA Declaration
     │    ├─ Housing Property - SelfOccupied
     │    ├─ Housing Property - LetOut
     │    ├─ Income From Previous Employment
     │    ├─ Other Income
     │    ├─ Other Deduction
     │    └─ Already Paid Tax
     └─▶ [Calculate] → Total Income · ITD Exempt · HRA Exempt · Std Dedc · Total Exempt ·
                       Taxable inc · Net Tax · Rebate · Surcharge · Edu Cess · Total Tax ·
                       Already Paid Tax · Payable Tax
          live EMP001: 676368 → Std Dedc 50000 → Taxable 626368 → Net Tax 11318 →
                       Rebate 11318 → Total Tax 0 → Payable 0

HRMS ▸ PMS
├─ KRA Master ── KRA Name · Description · Department[sel] · Weightage % · ☐Active
│                 ─▶[Save][Clear / New]
│                 ◈ KRA Name | Description | Department | Weightage % | Status | Created By | Created Date
├─ KPI Master ── KRA*[sel] · KPI Name* · Description · Target value ·
│                 UOM*{Count (#)|Hours (hr)|Percentage (%)|Rupee (₹)} ·
│                 Calculation Type*{Higher is better|Lower is better|Range} ·
│                 Weightage (%) "(from KRA Master)" ← inherited · ☐Active
│                 ◈ KRA|KPI Name|Target|Unit|Weight %|Calculation Type|Min|Max|Status|Created By|Created
│                   with per-column sort AND per-column filter dropdowns
│                 ⚑ Min/Max render as â€" (encoding bug)
└─ Report ────── ◈ Emp Code|Employee Name|Department|Designation|Period|Assigned KPI|
                    KPI created by|KPI definition status|Total KPI Score|Total KRA Score|
                    Final rating (Feedback)|Approval|Stage|Review Date   ─▶[Filters][Refresh]
```

## 3.6 ATTENDANCE — ⭐ the 17 corrections, expanded

```
ATTENDANCE ▸ Attendace Voucher   /Attendance/MonthlyAttVoucher.aspx
├─ [<] Aug-2026 [>] · Search here ─▶[Filter] · ⤓
├─ TREE DRILL:  Location ─▶ Company ─▶ Division ─▶ Department ─▶ Employee
│                (breadcrumb: Home / Location 2 / Company 2 / Division 2 / Marketing / EMP001:Test 1)
├─ toggles: Multiple Punch · Punch Device
├─▶ [Device logs] · [Print] · [Recalculate]
├─◈ Date|In Time|Out Time|Work Duration|OT|COFF|E-Work|Total Dur|Status|Shift|
│    Late By|Early By|SS|Day|HPMinutes| [Action ▾]
├─ chips: ✖A=12 · 🏠WO=3 · H=1 · 🕐OT=0:0 · E-Work=0:0
│
└─▶ [Action ▾] on EVERY DAY — 17 options, each opening its own modal:
     ├─▶ Add Punch ──────────◆ Manual Log Entry ─ Log Date · ○Punch IN / ○Punch OUT ─▶[Save]
     ├─▶ Leave Entry ────────◆ Apply Leave ─ Employee · Leave Status · Entry From Date ·
     │                                        Entry To Date · Leave Type · Remark ─▶[Save]
     ├─▶ Change Shift ───────◆ Shift[sel]{GS|NS|DS|NIS|GS1|GS2|GSH|GS19T|GS9T|NGS|PGSH} ─▶[Save]
     ├─▶ Assign WO ──────────◆ mark the day a weekly off
     ├─▶ Cancel WO ──────────◆ undo that
     ├─▶ OD Entry ───────────◆ OD Date · OD Status{FullDay|HalfDay} · OT Minutes · Extra Work ─▶[Save]
     ├─▶ OT Sanction ────────◆ OT Sanction ─ OT Date · OT Duration [time] ─▶[Save]
     ├─▶ OT Cancel ──────────◆ undo a sanction
     ├─▶ COFF Generate ──────◆ COFF Status{FullDay|HalfDay} · WOP Date · Remark ─▶[Save]
     ├─▶ OT Cutoff ──────────◆ OT Date · OT Hrs ─▶[Save]      (cap the OT paid)
     ├─▶ Delete Leave Entry ─◆ remove the leave on this day
     ├─▶ Delete OD Entry ────◆ remove the OD on this day
     ├─▶ COFF Cutoff ────────◆ COFF Date · COFF Minutes · COFF Hrs ─▶[Save]
     ├─▶ Delete COFF ────────◆ remove the comp-off credit
     ├─▶ Re-Assign Holiday ──◆ move the holiday to this day
     ├─▶ Cancel Holiday ─────◆ this day is no longer a holiday
     └─▶ Short Leave ────────◆ Apply Short Leave ─ Hourly Leave Date ─▶[Save]
     (+ also reachable here: ◆ Official Gatepass Entry ─ Gate Out · Gate In · Duration ·
        Approved Duration ─▶[Save])

  ⭐ THE SAME 17 ARE THE ESS PERMISSION LIST (Master Settings ▸ ESS, per Category)

ATTENDANCE ▸ Attendance Calculation   /Attendance/Attendance_Calculation.aspx
├─ Date From · Date To
├─ checkbox trees: Employee · Category · Company · Division · Department (each ▸ Select All)
├─ ○ Pending Entries   ○ All Entries          ← incremental vs full recompute
└─▶ [Calculate] → ▓▓░░░░ 0%  +  error textarea

ATTENDANCE ▸ COFF   /Attendance/COFFGenerate.aspx
├─ Date From/To · Employee · Category · Company · Division · Department
├─▶ [Show] → candidates ◈ EMPCODE|EMPLOYEE NAME|DATE|IN TIME|OUT TIME|STATUS|SHIFT
├─▶ [Generate All] → credits comp-off for everyone listed
├─▶ [Remove All]
└─ lists ▸ [Consumed] [Upcoming expiry] [Expired] [Generated (by employee)]
     each ◈ … | COFF DATE | CREDIT | EXPIRY | (CONSUMED ON / DAYS LEFT / DAYS OVER) | EXTENDED
     ─▶[Print this list] [Print consumed & expired] [Print all lists] [Hide lists]

ATTENDANCE ▸ Shift Shedule   /Attendance/Shift_Shedule_View.aspx
├─ month picker · Search here ─▶[Filter]
├─▶ [Excel Import]
├─▶ [Manual Generate] └─◆ Employee · Entry From Date · Shift[sel] · ☐WO ─▶[Save]
└─▶ [Auto Generate]   └─◆ Month · Company · Department · Category · Employee ─▶[Generate]

ATTENDANCE ▸ Device Logs · Late Early Entry · Logs Approval · Holiday · OD Entry · Checklist
├─ Device Logs ──── filters ─▶[Show][Excel] · ▶[Add Manual Punch]└─◆ Device Code · Employee ·
│                    Log Date · Device Name{ME|ME(IN)|ME(OUT)} · Remark
├─ Logs Approval ── same shape; manual/mobile punches wait here before counting
├─ Holiday ─────── Holiday Group[sel] · Year[sel] ─◈ Holiday Name|Holiday Date
│                   ▶[New Holiday]└─◆ Group · Name · Date · Type{FullDay|HalfDay}
├─ OD Entry ────── ◈ Emp Code|Emp Name|OD Date|OD Status ▶[New Entry]└─◆ (as above)
└─ Checklist ───── + Status{All|Present|Absent|WeeklyOFF|Holiday|OnLeave|MissPunch|NSF|MP&NSF}
                    + Order By (9 options) + Sort by
```

## 3.7 ATTENDANCE ▸ LEAVE — the policy engine expanded

```
Leave ▸ Leave Type  /Leave/LeaveTypes_Mst.aspx
└─▶ [Add Leave Type] ⇢ LeaveType_AU.aspx
     └─◆ Leave Type ─ Leave Type Name · Short Name · ☐Is Hourly Leave ─▶[Save]
        (deliberately thin — all the rules live one layer up)

Master ▸ Leave Level Master  ⇢ LeaveLevel_AU.aspx        ⭐ THE LEAVE POLICY ENGINE
├─◆ Leave Level Configuration ─ Leave Level Name · ☐Allow Quarter Leave ─▶[Save Configuration]
└─◈ Leave Type Management: Active | Leave Type | Yearly Limit | Carry Limit | [Configure]
     └─▶ [Configure] └─◆ Leave Configuration Details
          ├─ LEAVE & LIMITS
          │   ├─ Yearly Limit [num]
          │   ├─ ☐ Is Carry Forward
          │   └─ Allowed After (days) = 180        ← probation gate
          ├─ ACCRUAL & VISIBILITY
          │   ├─ ☐ Auto Deduction (Monthly)   ☐ Auto Credit (Monthly)   ☐ Is Visible
          │   ├─ ☑ Include WO in Leave        ☐ Credit Leave With Formula (Yearly)
          │   ├─ ☐ Allow Negative Balance
          │   └─ ☐ Auto Credit Opening
          ├─ DEBIT & COFF
          │   ├─ Monthly Debit Limit · Batch Debit Limit · Batch Debit Duration
          │   └─ ☐ Is Coff Enjoy First · Coff Expiry (days)
          ├─ ENCASHMENT
          │   └─ ☐ Is Encashable
          └─▶ [Update Configuration] / [Close]
     (levels live: Office Staff · HOD · Worker · Maintenance & QC Staff · Production Staff)
     (types live:  PL · COFF · CL · SL · ML · LOP)

Leave ▸ Leave Entry  ⇢ LeaveEntry_AU.aspx     ⭐ BULK APPLY
├─ Leave Status[sel]{FullDay|…} · From Date · To Date · Leave Type[sel]{PL|COFF|CL|SL|ML|LOP}
├─◈ ☐ | Emp ID | Emp Code | Employee Name | Location | Company | Division | Department |
│      Category | **Balance Leave**        ← you see each person's balance while choosing
└─▶ [Save]  — one date range applied to everyone ticked

Leave ▸ Leave CarryForward  /Leave/Leave_Transaction.aspx     ⭐ THE MODEL BULK JOB
├─ note on screen: "One batch is created per leave type (e.g. EL separately from PL).
│                   Batch is optional for direct processing."
├─ Leave Month · Leave Year · Leave Type (carry forward) ⚑â€" · Category · Company ·
│  Division · Department · Search ─▶[Show][Export][Show Batch Panel]
├─◈ ☐|EMP CODE|EMPLOYEE NAME|COMPANY NAME|LEAVE|OPENING PRESENT|OPENING ABSENT|PRESENT|
│    ABSENT|PREV. BALANCE|THIS YEAR|TOTAL BALANCE
├─▶ [Preview & create batch]
│    └─◆ Preview batch ─ ◈ Include|Emp code|Employee|Company|Leave type|Balance
│         + Batch name prefix ─▶[Create batch(es)] / [Cancel]
└─ BATCH PANEL ─◈ Batch Name|Leave Type|Status|Total|Pending|Done|Failed|Action
     ├─▶ [Run full batch]
     ├─▶ [Proceed selected]
     ├─◈ per-row result: Emp Code|Employee|Leave|Allowed|Status|Message|Rev|Rem
     └─▶ [Carry forward history report]

Leave ▸ the rest
├─ Leave Opening ─── Leave Year · Leave Type · org filters ─▶[Filter] [Excel Import]
├─ Leave Credit ──── Salary Month · Leave Type ─▶[Show] [Excel Import]
├─ Leave Encashment  Select Date · Emp Name · Leave Type · Leaves to Encash ─▶[Save][Excel Import]
│                    ◈ EMP CODE|EMPLOYEE NAME|AVAILABLE BALANCE|LEAVES ENCASHED|AMOUNT
├─ Leave Statement ─ Advanced Filters ─▶[Show][Export] ▶[Settings]└─◆ ☐Show Present
│                    ◈ EmpCode|EmployeeName|Company_Name|LeaveName|OpeningLeave|CreditLeave|
│                      DebitLeave|EnCashLeave|**AdvanceLeave**|balanceLeave
└─ Leave Ledger ──── Employee · Leave Year · Salary Month to · Leave Type ─▶[Show][Print]
                     ◈ Period|Leave Type|Opening Balance|Credit|Debit|Encash|Closing Balance
```

## 3.8 LOAN AND ADVANCE

```
LOAN AND ADVANCE
├─ Loan  /Transaction/Emp_Loan.aspx
│   ├─◈ EmpCode|Employee Name|Loan|Installment|Date
│   └─▶ [Add] ⇢ Emp_Loan_AU.aspx?LoanType=Transaction
│        └─◆ Employee Loan Transaction
│             ├─ Select Employee [sel]
│             ├─ Loan Type [sel] {LOAN | ADVANCE | HOME_LOAN}
│             ├─ Loan Amount · Installment Amount · Date
│             └─▶ [Save]        ⚑ no interest-rate field, yet the payslip has an Interest column
├─ Loan Manage ──── Manage Month · Emp Name · Trans type · Amount ─▶[Save]
│                    + search block ─▶[Show][Excel Export]      (adjust THIS month's deduction)
├─ Loan Prepayment  payment date · Emp Name · Trans type · Amount · Remark ─▶[Save]
├─ Advance ──────── ◈ EmpCode|Employee Name|Advance ▶[Add][Edit][Delete]
├─ Loan Opening ─── ◈ Emp Code|Employee Name|Type|Loan|Installment|Date ▶[Add][Excel Import]
├─ Loan Statement ─ MMM/yyyy · Loan Type · org filters ─▶[Show][Excel Export]
└─ Loan Ledger ──── Employee · Att Month From/To · Loan Type ─▶[Show][Print]

   ⇢ feeds payroll through Master Settings ▸ Payroll ▸ "Loan Head"
   ⇢ shows on the payslip as: LOAN NAME | NEW LOAN | INSTALLMENT | INTEREST | BALANCE
```

## 3.9 UTILITY

```
UTILITY
├─ Device Management  /Utilitty/DeviceManagement.aspx
│   ├─◇ TAB Active Devices  /  TAB Inactive Devices
│   ├─◈ Device ID|Device Name|Type|IP Address|Company|Serial No|Last Ping|Connection|
│   │    Active Status|Actions
│   ├─▶ [New Device] └─◆ Device Name · Attndance Direction{Alter|In|Out|Canteen|Access Control} ·
│   │                     Device Type{Normal|AI} · Serial No · IP Address · ☐Is Attendance ·
│   │                     TimeZone · Device Company{Others|HikVision|Dahua} · ☐Is Active ·
│   │                     Device Password ─▶[Save]
│   ├─▶ [Active Registration] └─◆ Dahua ─ Server IP (0.0.0.0 = all interfaces) ·
│   │                                      Server Port (TCP) ─▶[Start][Stop]
│   ├─▶ [Refresh]
│   └─◆ Slave devices for: … ─◈ Device ID|Device Name + check-all
├─ Device Commands  /Utilitty/Device_Commands.aspx
│   ├─ Command Name[sel] {Reset Att Logs | Upload Users to Device | Restart Device | Delete User |
│   │   Block User | UnBlock User | Enroll User Face | Enroll User Finger Print |
│   │   Clear Logs From Device} ─▶[Execute]
│   ├─◈ Device ID|Device Name|Serial No|Out Time|Status
│   ├─◈ Device Code|Emp Code|Employee Name|Location|Company|Division|Department|Category
│   ├─ log filter: Device{All|Sarigam|Vapi} · Date From/To ─▶[Show]
│   ├─◆ User Enrollment ─ Device · Device Code · FP Index No · ☐Overwite ─▶[Save]
│   └─⚑ LIVE: only the log filter bar renders. The command panel, device grid and employee
│        list are all absent — presumably because 0 of 2 devices are online.
├─ DC(Hikvision) ─── the same screen, HikVision variant
├─ Upload User To Device ─ org filters + Status ─▶[Filter]
│    ├─ ☐List All Employees With Bio · ☐UserInfo · ☐User Pic
│    ├─ ○Cards / ○FingerPrints / ○Face
│    ├─◈ … | CardNo | Finger | Face | AI Face
│    └─▶ [Upload]
├─ Blocked Employee ─ device-level block/unblock
├─ Employee Import ── 📎 file  OR  Paste Data Here ─▶[Preview] + Error Occured box
│                     + an "Employee Import File Format" help block
├─ Payroll Month  /Utilitty/Payroll_Months.aspx        ⚑ THE COMPLIANCE HOLE
│   ├─◈ Salary Month Name | IsLock ⏻ | IsFinal ⏻ | [Edit]
│   │    live: Jun-2026 … Nov-2025 all Lock=ON Final=ON
│   └─▶ [Edit] └─◆ "Salary Month - 2 companies found"
│                  ◈ Company Name | IsLock ⏻ | IsFinal ⏻      ← BOTH DIRECTLY EDITABLE
│                  ─▶[Close]
│        ⚑ one toggle reopens a finalised month. No reason. No confirmation. No approval.
│          And the audit log (§3.1) records nothing but logins.
└─ Attendance Year  /Utilitty/Att_YearCreate.aspx
    ├─◈ Year|Company|Start Month|End Month|Active|Carry Forward|Actions
    │    live: 2022–2027, only 2026 Active, every year Carry Forward = Pending
    ├─▶ [Add Attendance Year] └─◆ Company · Year · Year type{Calendar year (Jan - Dec)|Financial
    │                              year} · FY starts in (month) · ☐Active/Inactive · ☐Done/Pending
    └─⚑ [Delete] offered on closed years, no warning about dependent leave balances;
        End Month displays "01 Dec 2027" instead of 31 Dec
```

## 3.10 PAYROLL — the whole run, expanded

```
PAYROLL ▸ Salary Process   /Payroll/PayrollProcess.aspx
├─ month chips: [All Months][Aug/2026][Jun/2026][May/2026]…[Dec/2024] ─▶[Clear Filter]
├─▶ [Add Month] └─◆ Select Month & Year ─▶[Save Month]
├─◈ Salary Month|Company Name|Employee Count|Batch Remaining(red)|Salary Calculated(pink if 0)|
│    Salary Verified| [+ New Batch] | [⚙ Process Batches] | Lock Status ⏻ | Finalization Status ⏻
│    live May/2026 Company 2: 124 · 13 remaining · 121 calculated · 124 verified
├─▶ [+ New Batch] └─◆ Batch Name · Calculation Month ─▶[Show]
│                     → checkbox trees Category / Company / Division / Department ─▶[Save]
└─▶ [⚙ Process Batches] ⇢ PayrollBatchDetails.aspx?SalaryMonthID=…
     ├─◈ Batch Name|Total Employees|Month Days|Working Days|Weekly Offs|Holidays|[Actions ▾]
     │    live: ALL PF STAFF & HOD PARDI 16 · …SARIGAM 45 · ALL NON PF STAFF & HOD SARIGAM 22 ·
     │          ALL PF WORKERS SARIGAM 10 · ALL NON PF WORKERS SARIGAM 18
     └─▶ [Actions ▾]
          ├─▶ Batch Emp List
          └─▶ View Batch ⇢ SalaryProcessNew.aspx?BatchID=..&ProcessMonth=..     ⭐ THE RUNNER
               │
               │  HEADER  Month Days · Working Days · Weekly Offs · Holidays
               │          Total Employees · Companies · Categories · New Joinings · Resignations
               │  FOOTER  Total Employees · **Zero Days In Total** · **MP/NSF Status**
               │
               ├─① Collect Attendance ─▶[COLLECT ATTENDANCE] ▶[REFRESH]
               │      + 📎Choose file / Paste Data Here with Header ─▶[Preview]
               ├─② Manual Import — one block PER MANUAL HEAD, each with:
               │      "Mandatory" badge · "File is not uploaded" · File Format link ·
               │      📎Choose file OR Paste Data Here ─▶[Preview][Import Data][Clear] ·
               │      running Total · ◈ Emp Code|Employee Name|Amount
               │      blocks live: Advance · Canteen · Monthly Incentive (Total: 80) ·
               │                   OTHERS · Reimbursement
               ├─③ Loan and Advance ─ Loan Month ─▶[Show][Export CSV][Export Excel]
               │      empty state explains itself
               ├─④ Salary Calculation ─ ▓▓░░ 0% "Remaining time: calculating…"
               └─⑤ Finilization
                    ├─◈ Total Payroll Summary ─ Total Employees · Gross · Other Earning ·
                    │    Total Earning · Total Deductions · Net Salary
                    ├─◈ Allowances Breakdown ─ per head + **Earned Gross**
                    ├─◈ Other Earnings ─ OTHERS · Monthly Incentive · Reimbursement
                    ├─◈ Deductions Breakdown ─ PF · ESIC · Total Deduction
                    ├─◈ Total Liabilities
                    ├─◈ Total Company Expense = Net Salary + Total Liabilities
                    └─▶ [✓ Verified & Completed]

PAYROLL ▸ Payroll Voucher   /Payroll/PayRoll_Voucher.aspx      (the per-person slip)
├─ [<] month [>] · slide-out TREE (Location→Company→Division→Department→Employee) + Search ▶[Filter]
├─ banner: "Editable Fields: Double-click … → Enter to save → Esc to cancel"
├─ toggles: Leave Hide · Loan Hide · OrderBY{Emp Code|Emp Name} ─▶[Recalculate]
├─◈ LEAVE NAME|OPENING|CREDIT|DEBIT|ENCASH|BALANCE
├─◈ LOAN NAME|NEW LOAN|INSTALLMENT|INTEREST|BALANCE
├─◈ ATTENDANCE|VALUE
├─◈ FIXED|VALUE          ‖  EARNINGS|VALUE  (editable 🔒 when the month is locked)
├─◈ FIXED DEDUCTION|VALUE ‖  DEDUCTION|VALUE (editable 🔒)
├─◈ TotalDays|TotalFixed|TotalEarnings|TotalDeductions
├─  Net Salary :- ₹ …
├─ (also hosts the same correction modals as the Attendance Voucher)
└─⚑ live: TotalDays 0 → **Net Salary ₹-6,801.00 shown in GREEN**, nothing blocks it
   ⚑ header said "Aug-2026" while the picker said "May-2026"
   ⚑ next/prev with no employee chosen → blocking modal "No employee list available…"

PAYROLL ▸ Increment Initialize            PAYROLL ▸ Arrears Calculation
├─▶ [New Increment] └─◆                   └─ same shape ─▶[Check][Save][Cancel Arrear]
│     Increment Name · Increment Month ·      because Effective Month can PRECEDE Increment
│     **Increment Effective Month** ·         Month, the difference is paid as ARREARS —
│     Remark                                  never by editing a closed month
│     ├─ pick by Company/Category/Department/Division + search + check-all
│     ├─ OR Paste data ─▶[Select from pasted data]
│     └─▶[Save]
├─◈ Name|Increment Month|Effective Month|Remark| [View] [Proceed] [Cancel]
└─▶ [View] └─◆ Increment batch details
     ├─ INCREMENT NAME · INCREMENT MONTH · EFFECTIVE MONTH · CREATED · REMARK
     └─◈ Selected employees (2 in this batch):
          EMP CODE|EMPLOYEE NAME|LOCATION|COMPANY|DEPARTMENT|CATEGORY|STATUS|**INCREMENT STATUS**
          live: EMP027 & EMP156 both "Pending"

PAYROLL ▸ Email Salary Slip
├─ Salary Month · Company · Department · Category · Division ·
│  Payslip Type{Custom|With Balance|Without Balance} 👁 · Email Status{All|Pending|Success} ·
│  page size{20..1000} ─▶[Apply & Load]
├─◈ ☐|EMP CODE|EMPLOYEE NAME|COMPANY|DEPARTMENT|CATEGORY|EMAIL|STATUS| [▶ send this one]
└─▶ [Send Mail (Immediate)] [Send Mail All] [Pause All] [Stop All]

PAYROLL ▸ Salary calculation  /Reports/Salary_Calculation.aspx
├─ Calculation Month · Employee · Category + checkbox trees ─▶[Calculate] + Error Occured box
└─▶ (Working days) └─◆ Year{2026|2025|2024} · Working days · ◈ Month|Working Days
     ⭐ this is how you override the divisor for a short month

PAYROLL ▸ Manual Attendance / Manual Wages   (identical shape, different head list)
├─ TOP CARD  Transaction Month · Emp Name · Attendance Head[sel 19] / Head Name[sel 20] ·
│            Totals ─▶[Save] [Excel Import]
└─ SEARCH CARD  month + Categorgy/Company/Division/Department ─▶[Show][Excel Export]
```

## 3.11 REPORTS

```
REPORTS  /Reports/Reports.aspx     14 groups → 72 links → ~30 pages
│
│  EVERY report is the same 3-part screen:
│     parameters  ▸  collapsible Filter card (the six org dropdowns / checkbox trees)
│                 ▸  Report Format {PDF | Excel}  ─▶ [Generate] or [Show]
│  Output ⇢ /Reports/Report_Viewer.aspx = Microsoft RDLC ReportViewer
│           ├─ paging  |◀ ◀ [1] of 2 ▶ ▶|
│           ├─ Find | Next
│           └─ 💾 export ▾ → Excel · PDF · Word
│  Which formats you may pick ⇠ UserType ▸ Report Type (Admin §3.1)
│
├─ Employee Reports ──── Employee Details · Employee form · Employee ID Card{Vertical|Horizontal}
├─ Leave Reports ─────── Yearly Report · Leave EnCashment · Leave Ledger · Coff Report
├─ Loan Reports ──────── Loan Yearly
├─ Payroll Reports ⭐ ── Salary Statement{Normal|CTC|Balance With CTC|Balance} ·
│                        Dept/Desig/Costcentre Wise Summary{Group By} ·
│                        Salary Slip{With Balance|plain} · Loan Report · Wages Register ·
│                        ICICI · HDFC · BANK Statement · SUDICO ·
│                        Consolidated Salary Statement (month FROM+TO) ·
│                        Pay Slip{With Balance|Without Balance|Custom}
│     bank reports add: Payment Month (separate from Attendance Month) · Cheque NO · BANK ACC NO
│     ⭐ Dept Summary real columns:
│        Department|P|A|WO|WOP|H|HP|OD|PL|CL|COFF|SL|TotalDays
│        |BASICDA|HRA|FIX_INCENTIVE|OTHERS|Monthly Incentive|SpecialAllowence|Reimbursement|WD|Gross
│        |EBASICDA|EHRA|EFIX_INCENTIVE|EOTHERS|EMonthly Incentive|ESpecialAllowence|EReimbursement
│        |EWD|EGross
│        |LOAN|PF|Advance|Other Deduction|Canteen|TotalDeduction|NetSalary
│        ⇒ TWO columns per earning: structure vs E-prefixed EARNED. Net = EGross − Deductions ✔
│     ⚑ its Category dropdown has NO "All" — you can never see the whole company
├─ OT Reports ────────── OT Report ⚑renders a blank card · OT Bank Statement
├─ Attendance ▸ Daily ── 15 reports, all on Daily_Att_Viewer / DailyAttReport / Daily_Attendance
│                        + Group By{Shift|Category|Designation|Department Wise}
│                        + Status{All|Miss Punch|On Leave|Early Going|Late Coming|Absent|Present}
├─ Attendance ▸ Monthly  15 reports; Attendance_View.aspx alone holds 15 Report Types
│                        (incl. Head Count Report and Monthly Loss Report, which the menu files
│                         under MIS)
├─ Attendance ▸ Yearly ─ Performance View · Yearly Report
├─ Statutory Reports ⭐ ─ PT Statement (◈EmployeeName|Amount) ·
│                        PF ECR (◈PFNumber|UAN|MEMBER_NAME|GROSS_WAGES|EPF_WAGES|EPS_WAGES|
│                                  EDLI_WAGES|EPF_CONTRI_REMITTED|EPS_CONTRI_REMITTED|
│                                  EPF_EPS_DIFF_REMITTED|NCP_DAYS|REFUND_OF_ADVANCE|DATE OF PAYMENT)
│                        ESIC ECR · PF Report (◈EmpCode|UAN|MemberID|EmployeeName|Gross Wages|
│                                  Basic|PF Employer|PF Employee) ·
│                        Monthly Register (pivot ONE head across months:
│                                  ◈Empcode|EmployeeName|Department_Name|Jan..Jun|Total) ·
│                        PT Report · EPFO
├─ Canteen Report ────── 4 menu links, but the dropdown holds 6 (incl. Monthly Billing Report
│                        and Meal Consumption Report, not in the menu)
├─ MIS Report ────────── Head Count Report · Monthly Loss Report
├─ TDS Reports ───────── Quarter Return + a Month picker ─▶[Show Challan Details]
└─ Access Control ────── Department Wise · Employee Wise · Device Wise{All|Sarigam|Vapi}
```

## 3.12 ESS · INVOICE · CANTEEN · TEMPLATES

```
ESS
├─ ESS Requests  /ESS/ESSRequestDetails.aspx
│   ├─ date · Request Type{All|Leave|Miss Punch|OD|Reimbursement|OT Sanction} · Leave Type ·
│   │  Status{All|Pending|Approved|Disapproved} ·
│   │  Pending Level{All|Pending at L1|L2|L3|L4|L5} ─▶[Apply][Reset]
│   └─◈ #|Request Type|Emp Code|Employee Name|Department|From Date|To Date|Extra Info|
│        Entry Date|Status|Pending Level
│   ⇠ what staff may raise = Master Settings ▸ ESS, per Category, from the same 17 day-actions
│   ⇠ routed by Master ▸ Hierarchy Master (L1..L4, two authenticators each)
│   ⇠ per-person kill switches on the employee record: ESS Password · ☐Block Employee ESS
├─ Announcement ── ◈ID|Title|Date|Priority|Status|Description|Actions
│                   ▶[Add]└─◆ Title* · Announcement Date · Priority{Normal|High|Low} ·
│                              Status{Active|Inactive} · Description
│                   nav: [First][Previous][Next][Last]
└─ Company policies ─ ◆Upload New Policy: Policy Name · 📎file · Policy Description
                       ─▶[Upload Policy][Clear]
                       ◈ID|Policy Name|File Name|File Type|Upload Date| [View][Edit][Delete]

INVOICE
└─ Invoice List ── Date From · Invoice Month ─▶[Show] · search
    └─▶ [Generate Invoice] ⇢ Invoicelist_AU.aspx  ⚑ "Invoice Genration" — EMPTY SCREEN

ACCESS CONTROL (staff canteen)
├─ Settings ────── Selection Mode(radio) · ☐Is Top-Up ─▶[Save Settings]
├─ Canteen Items ─ ◆Add New Canteen Timing: Meal Name · Meal Start · Meal End · Rate ·
│                   ☐Gate Count · Gate Start · Gate End ─▶[Save Timing]
│                   ◈ID|MEAL NAME|MEAL START|MEAL END|RATE|GATE COUNT|GATE START|GATE END|ACTIONS
│                   live: BreakFast 07:00-10:00 · Lunch 11:00-15:00 · Dinner 20:00-23:30
│                   ⚑ every RATE shows "NaN"
│                   ▶[✏]└─◆ Edit Canteen Timing (same fields) ─▶[Update]
└─ Canteen Work Code ─ Workcode{1..9} · Workcode Name · Rate · **Employee Contribution** ·
                        **Employer Contribution** · Category ─▶[Save]
                        ◈ID|Workcode|Name|Rate|Employee Contribution|Employer Contribution|
                          Category Name|Actions
    ⇢ charged to payroll via the "Canteen" deduction head

TEMPLATE MANAGEMENT
├─ Template Creation  /TemplateGeneration/TemplateGeneration.aspx
│   ├─ BAR 1: Template name… · Template Type{Offer|Appointment|Confirmation|Relieving|Experience}
│   │         · Paper Size{A4|Letter|Legal|A5|A3|Custom} · Orientation{Portrait|Landscape}
│   │         · ●Unsaved indicator
│   │         ─▶[Add Logo] [Variables] [Preview] [Save] [Template List]
│   ├─ BAR 2: MARGINS(MM) T·B·L·R=20 ·
│   │         ▶[Page border ▾]{None|Thin|Medium|Thick|Double (letterhead)} + colour #94a3b8
│   │         · PAGE FILL #ffffff
│   │         ▶[Header & Footer ▾]{Add Header|Remove Header|Add Footer|Remove Footer}
│   │         ▶[Line Spacing ▾]{Remove spacing (0)|0.5|1.0 (Single)|1.15|1.5|2.0 (Double)|2.5|3.0}
│   │         ▶[Watermark ▾]{CONFIDENTIAL ×2|DO NOT COPY ×2|DRAFT ×2|SAMPLE|Custom…|Remove}
│   │              └─◆ Custom Watermark ─ Text · ○Diagonal/○Horizontal · size · colour · opacity
│   │         · ☐Repeat logo every page ─▶[Add Page][Remove Page]
│   ├─ BAR 3: font colour · highlight · Shading · Callout · Callout Left · Callout Size ·
│   │         Callout Edge · Section · Box · Clear · Logo
│   ├─ CANVAS: "Your template content will appear here. Use {{VariableName}} placeholders…"
│   └─▶ [Variables] └─◆ searchable, drag-and-drop palette
│        ├─ SYSTEM (13): CurrentDate · CurrentDateTime · PrintDateTime · Year · MonthName ·
│        │   PageNumber · TotalPages · PageNumberOfTotal · DocumentTitle · DocumentId ·
│        │   TemplateName · GeneratedByUser · RefNo
│        ├─ MANUAL: user-defined, [+]
│        ├─ DATA (19): CompanyName/Address/Email/Phone/Website · EmpName · EmpCode ·
│        │   EmpDesignation · EmpDepartment · EmpDOJ · EmpFatherName · EmpCategory ·
│        │   EmpDivision · EmpGender · EmpEmail · EmpMobile · ReportingManager ·
│        │   EmpLocation · LetterDate
│        ├─ ALLOWANCES: one var per head + **{{Salary.Allowances}}** (whole table)
│        ├─ DEDUCTIONS: one var per head + **{{Salary.Deductions}}**
│        └─ TOTALS: {{Salary.NetSalary}} {{Salary.GrossSalary}} {{Salary.CTC}}
└─ Letter Generation  /TemplateGeneration/LetterGeneration.aspx
    │  ①Template ─▶ ②Employees ─▶ ③Preview ─▶ ④Export
    ├─① Document Type{12 types incl. Offer Letter Annexure · No Dues Certificate · Appraisal
    │     Letter · KRA Format · Resignation Format · Advance Letter} ·
    │     Template Name · Letter Date · Ref No (Auto) · Options ☑Header ☑Footer
    │     ─▶[View Templates] [Next: Select Employees →]
    ├─② ○Single Employee[sel]  OR  batch by Department + Designation
    │     ─▶[All][None][Load Employees] [← Back][Next: Preview]
    ├─③ live letter preview ─▶[Generate Letter]
    └─④ ─▶[Export PDF][Export Word][Export HTML][Print]
          ─▶[Generate More Letters][Back to Templates]
          ◈ Ref No|Template|Employee|Department|Generated|Status|Actions
             Status{All|Generated|Exported|Printed|**Voided**}   ⭐ voided, never deleted
```

---

# 4. THE SIX REAL JOURNEYS (cross-screen flowcharts)

## 4.1 Hire → first payslip

```
 Employee Setting ▸ Onboard          (decide which fields the candidate must fill)
          │
          ▼
 Employee Onboarding ─▶[New Onboard] ──✉──▶ candidate fills their own details
          │                                          │
          │  Status: Pending ──────────────────▶ Emp Respond: Pending ─▶ Completed
          ▼
 Employee Master ─▶ new employee record
          ├─ posting: Location/Company/Division/Department/Category/Shift Group/Holiday Group
          ├─ Leave Level  ──────────────▶ inherits the whole leave policy
          ├─ Hierarchy + Level (L1..L5) ─▶ decides who approves their requests
          └─ Salary Details ────────────▶ CTC split across ALLOWANCE + DEDUCTION heads
          │
          ▼
 Upload User To Device  ──▶ their face/finger/card is pushed to the biometric readers
          │
          ▼
 (they work) ──▶ Device Logs (raw punches)
          │
          ▼
 Attendance Calculation ──▶ attendance DAYS (P/A/H/WO/HP/OD/COFF/MissPunch…)
          │
          ▼
 Salary Process ▸ New Batch ──▶ 5-stage runner ──▶ Finilization ──▶ [✓ Verified & Completed]
          │
          ▼
 Payroll Month: Lock ⏻ + Finalize ⏻
          │
          ├──▶ Email Salary Slip  (pausable batch, per-person status)
          ├──▶ Reports ▸ Salary Statement / Pay Slip
          ├──▶ Reports ▸ ICICI / HDFC / SUDICO  (bank transfer file)
          └──▶ Reports ▸ PF ECR / ESIC ECR / PT  (government filings)
```

## 4.2 A wrong attendance day gets fixed

```
 Attendance Checklist  (Status = MissPunch)   ──┐
 Dashboard tile "Missed Punches"              ──┤
 Salary runner footer "MP/NSF Status"         ──┘
          │
          ▼
 Attendace Voucher ─▶ drill Location→Company→Division→Department→Employee
          │
          ▼
 the wrong day ─▶ [Action ▾] ─▶ one of 17 corrections ─▶ ◆ modal ─▶ [Save]
          │
          ▼
 Attendance Calculation (Pending Entries)  ──▶ that day is recomputed
          │
          ▼
 if the month is already calculated ──▶ Payroll Voucher ─▶ [Recalculate] (one person)
                                    └─▶ or re-run stage ④ for the batch
```

## 4.3 Employee asks for something (ESS)

```
 employee (ESS app) raises: Leave | Miss Punch | OD | Reimbursement | OT Sanction
          │   (only the types ticked for their CATEGORY in Master Settings ▸ ESS)
          ▼
 ESS Requests ─ Status: Pending, Pending Level: L1
          │
          ▼
 Hierarchy Master decides the route:
     L1 (Authenticator1 OR Authenticator2) ─▶ L2 ─▶ L3 ─▶ L4 ─▶ Approvers 1-4
          │                                   (only the levels ticked "required")
          ├─ Approved  ──▶ writes the day-action into the attendance record
          └─ Disapproved ──▶ nothing changes
```

## 4.4 Year-end leave carry forward

```
 login ──▶ ◆ "Leave Carry Forward Reminder" ─▶[Open Leave Transaction (Carry Forward)]
          │
          ▼
 Leave CarryForward ─ set Leave Month/Year/Type + org filters ─▶[Show]
          │
          ▼
 tick rows ─▶[Preview & create batch] ─▶ ◆ preview + Batch name prefix ─▶[Create batch(es)]
          │        (ONE BATCH PER LEAVE TYPE)
          ▼
 Batch panel ─▶[Run full batch]  or  [Proceed selected]
          │
          ├─ per row: Status · Message · Rev · Rem
          └─▶ [Carry forward history report]
          │
          ▼
 Attendance Year ▸ Carry Forward flag  Pending ─▶ Done
```

## 4.5 A backdated raise

```
 Increment Initialize ─▶[New Increment]
     Increment Month = Jul-2026        Effective Month = Apr-2026   ← earlier!
          │
          ├─ pick employees (filters OR paste) ─▶[Save]
          ▼
 batch row ─▶[View] (check who's in) ─▶[Proceed]
          │        per-employee Increment Status: Pending ─▶ Done
          ▼
 Arrears Calculation ─ same batch shape ─▶[Check]─▶[Save]
          │
          ▼
 the Apr–Jun difference is paid as an ARREARS head in the CURRENT month
          │
          ▼
  ✔ closed months are never reopened          ⚑ …although this product would let you
```

## 4.6 Someone leaves

```
 Employee Master ─▶ row ☰ ─▶ Resign
     ◆ ○Last Punch Date / ○Custom Resign Date / ○Last Punch Date to Month End
     ─▶[Update] | [Update & Block] | [Update & Delete]
          │                  └─ also blocks them on the biometric devices
          ▼
 Full and Final Settlement ─ bucket: FNF not started ─▶ in progress ─▶ completed
          │
          │  driven by FnF Master ▸ FNF Settings:
          ├─ Gratuity formula  (eligibility years, round-off months)
          ├─ Notice Pay formula
          ├─ Bonus formula
          └─ show: Salary Structure · Earnings · Deductions · Asset Details · Loan Recovery
          │
          ├──▶ Assets Detaill  ⇠ recover the laptop / SIM / bike
          ├──▶ Loan Ledger     ⇠ recover the outstanding balance
          └──▶ Leave Ledger    ⇠ encash the remaining balance
          │
          ▼
 Letter Generation ─▶ Relieving Letter · Experience Letter · No Dues Certificate
          │
          ▼
 history: Generated ─▶ Exported ─▶ Printed  (or **Voided** — never deleted)
```

---

# 5. THE 500-PHASE REGISTER

**How to read the Method column:**
`LIVE` = clicked in the browser and the rendered result recorded ·
`MARKUP` = page fetched authenticated and its DOM parsed (fields/grids/options are exact,
but a screen that only breaks at runtime would not show up) ·
`RUN` = the action was actually executed and its output captured.

| Phase | Area | What was checked | Method | Result |
|---|---|---|---|---|
| P001–P006 | Admin ▸ Masters Permission | list, Add form, Location scope, Edit, Delete | LIVE+MARKUP | scope = 1 Location per record |
| P007–P012 | Admin ▸ UsersTypes | list (2 rows), Add form, Level, Report Type multi-select, Edit, Delete | LIVE | delete uses native `confirm()`; ⚑ `User_Types_AU.aspx` direct = tab hang |
| P013–P020 | Admin ▸ Users | list, paging, search, New User (3 fieldsets), Masters scope, User Type, 3 flags, delete dialog | LIVE | complete |
| P021 | Admin ▸ Change Password | screen exists | MARKUP | — |
| P022–P026 | Admin ▸ Audit Logs | date filter, search, grid, **contents** | RUN | ⚑ **logins only — 2 rows for all of 2026** |
| P027–P036 | Admin ▸ System | 3 tabs, Custom Report form + groups, Auto Mail (3 rows, role-based recipients), **Auto Jobs (2 cron rows)** | LIVE | ⭐ nightly attendance 02:00 + salary 03:00 |
| P037–P048 | Master Setting | 6 tabs, every field + live value | LIVE | ⭐ head-map + Month Day/Work Day divisor |
| P049–P051 | Master Setting pop-outs | OT Slab, Holiday Slab, Late/Early Reason | LIVE | ⚑ Late/Early Reason opens **empty** |
| P052–P056 | Employee Setting | 2 tabs, all switches | MARKUP | complete |
| P057–P076 | Master ▸ the 20 tables | each table's fields + grid + extra field | MARKUP + 4 LIVE | ⚑ **Location Master dead** (null-ref, 0 rows) |
| P077–P082 | Master ▸ Salary Heads | list, sort/filter, Add form (5 types + 10 flags) | LIVE | ⚑ **list dead** (`IsSystemGenerated`) |
| P083–P088 | Master ▸ Shift Master | list (10 shifts), New Shift = 29 fields in 5 sections | LIVE | complete |
| P089–P092 | Master ▸ Hierarchy | list (12), L1–L4 + 2 authenticators each + 4 approvers | LIVE+MARKUP | ⚑ duplicate row in list |
| P093–P095 | Master ▸ Dept Man power | grid, Update Man Power modal | LIVE | plan vs actual → dashboard vacancies |
| P096–P100 | Master ▸ masters CRUD behaviour | required-field, duplicate, create, named delete confirm | **RUN** | all 4 verified; test row removed |
| P101–P118 | Employee Master (list) | 31 columns, per-column search+filter, sort, row menu (View/Edit/Resign/Delete), bulk-resign 3 policies × 3 actions, licence counter, paging | LIVE | complete |
| P119–P140 | Employee record | all 10 sections, every field, the two salary grids, Upload to Device | LIVE | ⭐ CTC split verified arithmetically |
| P141–P146 | Employee Onboarding | list, two statuses, New Onboard form | LIVE | complete |
| P147–P156 | Full & Final | FnF head list + Add Head, **FNF Settings** (3 formulas + ✔Verify, eligibility, display toggles), settlement 3 buckets | LIVE | complete |
| P157–P176 | HRMS ▸ IT Declaration | list + Lock, HRMS Settings rounding, **the declaration screen**: 8 tabs, Old/New regime, Compare, Form 16, 5 exemption accordions, Declared vs Actual + Download, the 13-figure computation strip | LIVE | ⭐ far bigger than first thought |
| P177–P190 | HRMS ▸ PMS | KRA form+grid, KPI form (UOM, Calculation Type, inherited weightage) + grid with per-column filters, PMS Report 14 columns | LIVE | ⚑ Min/Max show `â€"` |
| P191–P200 | HRMS spare | TaxProjection / Reprocess TDS buttons | MARKUP | not executed (would alter their data) |
| P201–P212 | Attendance ▸ Device Logs, Late/Early, Logs Approval | filters, grids, Add Manual Punch modal | MARKUP | complete |
| P213–P220 | Attendance ▸ Holiday, OD Entry | group/year filter, grids, both Add modals | MARKUP | complete |
| P221–P232 | Attendance ▸ COFF | filters, 5 tabbed lists + their columns, Generate All / Remove All, 4 print options | LIVE | complete |
| P233–P258 | **Attendace Voucher** | month stepper, 5-level tree drill, 15 grid columns, summary chips, **all 17 Action options enumerated from the live control**, each modal's fields | LIVE | ⭐ the core surface |
| P259–P264 | Attendance Checklist / Shift Schedule | status list, 9 order-bys, 3 roster-fill methods incl. Auto Generate | MARKUP | complete |
| P265–P268 | Attendance Calculation | date range, 5 checkbox trees, Pending vs All, progress bar, error box | LIVE | complete |
| P269–P300 | Leave (8 screens) | Leave Type form, **Leave Level × Type policy engine (15 switches)**, bulk Leave Entry with balances, CarryForward preview→batch→run→history, Credit, Encashment, Statement (**AdvanceLeave column**), Ledger | LIVE (5) + MARKUP (3) | ⭐ the policy engine |
| P301–P316 | Loan & Advance (7 screens) | Loan form, Manage, Prepayment, Advance, Opening, Statement, Ledger | LIVE (1) + MARKUP (6) | ⚑ no interest-rate field |
| P317–P340 | Utility (8 screens) | Device Management (2 tabs, device form, Dahua push server, slaves), 9 device commands, Upload User options, Blocked, Employee Import, **Payroll Month lock/unlock**, Attendance Year | LIVE (4) + MARKUP (4) | ⚑ **lock is reversible**; ⚑ Device Commands renders only its log filter |
| P341–P400 | Payroll (15 screens) | Salary Process board, batch creation, **the 5-stage runner incl. every stage's contents**, Payroll Voucher (all blocks + inline edit + padlock), Increment (batch + View modal + per-employee status), Arrears, Email Salary Slip (per-row send/status), Manual Attendance/Wages, Salary calculation + working-days override, the import screens | LIVE (8) + MARKUP (7) | ⚑ negative net in green; ⚑ month label desync |
| P401–P412 | ESS | ESS Requests (5 types × 5 levels), Announcement, Company policies | LIVE (1) + MARKUP (2) | admin side only — no employee portal in the demo |
| P413–P470 | **Reports** | all 14 groups, all 72 links resolved to ~30 pages, **every page's parameters captured**, the wider Report-Type dropdowns, the ReportViewer + export formats | MARKUP (30) + **RUN (7)** | outputs recorded for Payroll Summary, PF Report, PF ECR, PT Statement, Monthly Register, Wages Register, Monthly Attendance |
| P471–P474 | Invoice | list, Generate Invoice | LIVE | ⚑ **empty screen**, titled "Invoice Genration" |
| P475–P482 | Canteen | Settings, Items (meal windows + edit modal), Work Code (subsidy split) | LIVE (1) + MARKUP (2) | ⚑ all rates show `NaN` |
| P483–P496 | Templates | editor: 3 toolbar bars, every dropdown's options, watermarks, **the full variable palette**; Letter wizard: 4 steps, 12 document types, history + **Voided** status | LIVE (2) | complete |
| P497–P500 | Dashboard | 8 tiles + their links, Quicklinks, Active Year card, trend chart, 4 bottom cards, notification badge, card-settings panel, login modal | LIVE | complete |

**Honest coverage line:** every one of the ~130 screens is accounted for. **~55 were driven live**,
**7 reports were actually executed**, and **4 CRUD behaviours were tested with a real record that was
then deleted**. The rest were captured by authenticated markup parse — which gives exact fields,
options and grid columns, but would not reveal a screen that only fails at runtime. Where a screen
*was* driven live and turned out broken, that is marked ⚑; there may be more of those among the
markup-only screens.

---

# 6. REFERENTIAL INTEGRITY — tested, and they pass ✅

Done **without touching any of their data**: I created a throwaway department, created a throwaway
employee inside it, then tried to delete the department.

| Step | Action | Result |
|---|---|---|
| 1 | Create dept `ZZ CLAUDE TEST DEPT` | ✅ saved; immediately appears in the Employee form's Department dropdown |
| 2 | Create employee `ZZTEST01` — **name + code + department only** | ⚑ **silently discarded.** No error, no success message, no field highlighted. The page just re-rendered. |
| 3 | Create employee `ZZTEST01` — all posting fields filled (gender, designation, status, location, company, division, department, section, category, shift group, holiday group, level, leave level, cost centre, weekly off, DOB, joining date) | ✅ saved. Licence counter moved **124 → 125** |
| 4 | **Delete the department while the employee is in it** | ✅ **BLOCKED** — ◆ *"Error — Unable to delete Department as it is currently being used in Employee Master"*. The row stayed. |
| 5 | Delete employee `ZZTEST01` | ✅ native `confirm("Are you sure you want to delete this employee?")` → deleted; licence back to **124** |
| 6 | Delete the now-unused department | ✅ deleted cleanly |

**Verdict: HRMex does guard referential integrity on masters, and the error message even names the
dependent table ("…being used in Employee Master").** That is a better message than most products
give and is worth copying — *say where the thing is still used, don't just refuse.*

**But step 2 is a genuine new bug (#25):** the employee form **fails silently**. Missing required
posting fields produce no message at all — the user clicks Save, nothing visible happens, and the
record is not created. Combined with the fact that the audit log records nothing, an HR clerk could
believe they had onboarded someone who does not exist.

**Both test records were removed; nothing of mine remains in their system** (verified: employee gone,
licence 1000/124, department gone).

## 6b. What I still could not test (and why)

1. **Running payroll / locking / unlocking a month / sending emails.** All alter their data or mail
   real people.
3. **The employee-facing ESS app.** The demo exposes only the admin side; there is no employee login.
4. **Device commands.** No device is online (0 of 2), and firing commands at someone's hardware is
   not mine to do.
5. **File-producing reports** (EPFO, some bank formats) were parameterised but the file wasn't
   downloaded.

---

# 7. THE COMPLETE BUG LIST (25, all seen live)

| # | Bug | Where |
|---|---|---|
| 25 | **The employee form fails silently** — missing required posting fields produce no error, no highlight, no message; Save appears to work and the employee is never created | Master ▸ Employee Master ▸ New Employee |


| # | Bug | Where |
|---|---|---|
| 1 | Salary Heads Master dead — *Invalid column name 'IsSystemGenerated'* | Master ▸ Salary Heads |
| 2 | **Location Master dead** — *Object reference not set to an instance of an object* | Master ▸ Location |
| 3 | **Late/Early Reason Master opens completely empty** | Master Settings pop-out |
| 4 | **Invoice Generate is an empty screen** ("Invoice Genration") | Invoice |
| 5 | **OT Report renders a blank card** — no header, no message | Reports ▸ OT |
| 6 | **Wages Register crashes** — *Input string was not in a correct format* | Reports ▸ Wages Register |
| 7 | **Canteen rates all show `NaN`** | Canteen Items |
| 8 | **`User_Types_AU.aspx` opened directly hangs the browser tab** | Admin ▸ UserTypes |
| 9 | **Device Commands renders only its log filter** — command panel/grids absent | Utility |
| 10 | **Negative net salary (₹-6,801) shown in green**, nothing blocks it | Payroll Voucher |
| 11 | **A locked+finalised month can be reopened with one toggle** — no reason, no confirm | Utility ▸ Payroll Month |
| 12 | **Audit log records logins only** — no data change anywhere | Admin ▸ Audit Logs |
| 13 | Payroll Summary Category has **no "All"**, and defaults to Category 1 (looks like no data) | Reports |
| 14 | Impossible attendance passes: `P 25 + A 30` in a 31-day month | Payroll Summary |
| 15 | Month label desync — header "Aug-2026" vs picker "May-2026" | Payroll Voucher |
| 16 | Next/prev clickable with nothing selected → blocking error modal | Payroll Voucher |
| 17 | `â€"` encoding bug — leave-type option, KPI Min/Max, attendance block, error page, page title | everywhere |
| 18 | Data scoping is app-level only, one Location per user, no DB enforcement | Admin ▸ Masters |
| 19 | Test junk live: report `dthffyjh`, custom report `edgrf`/`sdf`, employee `badmash`, duplicate hierarchy row | several |
| 20 | Huge pages + full postback per click — 930 KB / 477 KB / 403 KB / 259 KB | throughout |
| 21 | Login modal cannot be permanently dismissed | Dashboard |
| 22 | `[Delete]` on closed attendance years, no dependency warning; End Month shows "01 Dec" | Utility ▸ Att Year |
| 23 | Native `confirm()` on some deletes vs styled dialogs on others — inconsistent | Admin ▸ UserTypes |
| 24 | Typos in schema & URLs: `Allowence` `Finilization` `Categorgy` `Shedule` `Detaill` `Utilitty` `Genration` `Duartion` `Overwite` `Lable` | everywhere |

---

# 8. IN PLAIN ENGLISH — what all these maps are telling you

Think of the whole product as **five boxes and a lock**.

**Box 1 — the skeleton.** Locations, companies, departments, designations, shifts, holidays, banks,
document types. Twenty little tables that all look identical: a list, a "New" button, a small
pop-up with a name field, and edit/delete. Boring, one-time, and everything else points at them.

**Box 2 — the people.** One employee record with ten drawers: who they are, where they live, family
and nominees, documents, the company kit they hold, their pay structure, their leave balances, who
approves their requests. You invite someone with just a name and email; they fill the rest themselves.

**Box 3 — the days.** Punches come in from machines or by hand. One "Calculate" button turns them
into days: present, half, absent, late, overtime, weekly off, holiday. When a day is wrong, one
dropdown on that row offers **seventeen** different fixes. Those same seventeen are what an employee
is allowed to *ask* for — you just tick which staff class may ask for which.

**Box 4 — the money.** One list of 43 "salary heads" (BASIC, HRA, PF, loan, overtime, canteen…),
each with a formula. Nothing is hard-coded — a settings page just says "the PF head is this row".
Every earning is stored **twice**: what the contract says, and what attendance actually earned.
Take-home comes from the second number.

**Box 5 — the paperwork.** Eighty-five reports, payslips emailed in a pausable batch, bank transfer
files in each bank's own format, the real government filings (PF, ESI, PT, TDS), plus a letter
writer with a proper page designer, and a full income-tax module with old-vs-new regime comparison.

**And the lock.** Payroll runs month by month, in five fixed steps, per group of staff, and ends
with two switches: Lock and Finalize. That's meant to be the end of it. **The reason this map matters
is that I found the lock doesn't hold** — one click reopens a finalised month, and the audit log only
remembers who logged in. Their own product already contains the right answer (pay corrections as
*arrears* next month), they just didn't enforce it.

So: **copy boxes 1–5 and the five-step run. Build the lock properly.** That single difference is the
one a restaurant owner will never see, and the one that matters most if anyone ever asks how a wage
figure was arrived at.
