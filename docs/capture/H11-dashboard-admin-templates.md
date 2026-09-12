# HRMex 10.0.0.0 — Dashboard · Admin · Template Management

**Terminal H11 · captured live 2026-09-07** on `https://demo.hrmexweb.in` signed in as `Superadmin`
(Super Admin). Look-only: nothing was saved, submitted, sent, run, locked or deleted. Two browser
`confirm()` prompts were opened to read their wording and then **dismissed**.

**Scope:** the Dashboard, the whole Admin menu (6 screens), and Template Management.
**Screens actually opened live: 12** (expected ~9 — three screens exist that the 2026-08-16 capture
never recorded: the Old Dashboard, the dashboard drill-down list, and the Template Section library).

Legend: `{a | b}` = the complete option list · `[btn]` = a button · **⚠️** = differs from the
2026-08-16 capture (all such items are collected again in *Corrections* near the end).

---

## 0. The app shell — `/Default.aspx`

**Where:** signing in lands here. Every menu item opens **inside this shell as a browser-style tab**,
in an iframe; the shell itself never reloads.

**What you see on arrival:** a dark sidebar down the left (logo `HRMex`, the signed-in person's photo
and name `Super Admin`, then the 13 menu groups); a white tab bar across the top of the working area;
the working area below it, filled by whichever screen's tab is active. On first arrival the only tab
is `NewDashboard`.

**The sidebar, top to bottom:**
- Round photo + `Super Admin`
- The 13 menu groups (each expands in place, accordion off — several can be open at once):
  `Dashboard · Admin · Master · HRMS · Attendance · Loan And Advance · Utility · Payroll · ESS ·
  Reports · Invoice · Access Control · Template Management`
- **A live countdown clock** — a box showing `09:52`, `09:54`, `09:58`… It is the **session timer**,
  counting down from 10 minutes of inactivity (the dashboard carries `hfSessionTimeout = 600`
  seconds). It turns amber and blinks near the end, then red.
- `[Log out]` (goes to `/User_Login.aspx`)
- `Version: 10.0.0.0`

**The tab bar, left to right:**
| Control | What it does |
|---|---|
| ☰ hamburger | Collapses the sidebar to icons only |
| red **`Close ▾`** | Menu: `Close All` · `Close All Other` |
| `«` | Scrolls the tab strip left |
| the tab strip | One tab per open screen, each with an `×` (title `Close`) |
| `»` | Scrolls the tab strip right |
| **date box** | A single date filter for the dashboard, placeholder `Date`, title *"Filter by date"* |
| **`All Companies ▾`** | The company picker — see below |
| ⟳ | Title *"Refresh Dashboard"* |
| 🔔 | Notifications — see below |
| ⛶ | Title *"iframe-fullscreen"* — puts the active tab full-screen |

**The company picker (`All Companies ▾`)** — a checkbox multi-select, not a single choice:
- `Select All` · `Clear` (two links across the top)
- a search box, placeholder `Search companies...`
- the complete company list, one checkbox each: **`{Company 1 | Company 2}`**
- Nothing is ticked by default, and the button then reads `All Companies`.

**The shell's notification bell:** header `🔔 Notifications` + a count badge (`0 New` here), a list
area, and a footer with `[🗑 Clear]` (title *"Clear all notifications"*) and a
`View All Notifications` link to `/NotificationSender/Notification_Sender.aspx`.
**On the visit I made the list read `Error loading notifications`** while the dashboard's own
notification panel inside the iframe was showing 59 items — see *Odd things I noticed*.

**Also present but not reachable from any visible control:** a right-hand "Customize AdminLTE"
control sidebar (`Dark Mode`, `Header Options → Fixed`, …). It is the AdminLTE demo panel, left in
the build; no button on the page opens it.

**Empty state:** with every tab closed the working area says **"No tab selected!"**. While a tab
loads it says **"Loading ⟳"**.

### The Admin menu, expanded (6 items, in order)
`Masters Permission` (MenuId 85) · `UsersTypes` (3) · `Users` (4) · `Change Password` (5) ·
`Audit Logs` (7) · `System` (87).

### The Template Management menu, expanded (2 items)
`Template Creation` (MenuId 114) · `Letter Generation` (116).

> **⚠️ Every Admin screen needs its `?MenuId=` on the address.** Opening `/Admin/Masters.aspx`,
> `/Admin/User_Types.aspx` or `/Admin/System_Mst.aspx` **without** it lands on the friendly error
> page — `Oops.aspx?ref=HRM-OOPS-…`, *"Well, this is awkward… Object reference not set to an instance
> of an object"* + `[Back to Home] [Go Back]`. Inside the app you always arrive with the MenuId, so a
> person never sees this; anyone rebuilding from the 2026-08-16 route list would.

---

## 1. Dashboard (new) — `/Dashboard/NewDashboard.aspx`

**Where:** sidebar → `Dashboard`. It is also the tab you land on at sign-in, titled `NewDashboard`.

**What you see on arrival:** first, a **modal that covers the page** (below). Behind it: a row of
eight big number tiles across the top; under them a row of three wide cards (Quicklinks · Active Year
and Payroll Month · Payroll Process); then two charts; then a grid of eight smaller information
cards; a notifications panel down the right. A gear/⚙ at the top right opens **Card Visibility**.

### 1.1 The modal that greets you — `Leave Carry Forward Reminder`
Word for word:

> **Leave Carry Forward Reminder**  ×
>
> Reminder: Carry forward remaining leaves to the new attendance year. You can carry forward
> employees' remaining leaves from the previous year (e.g. 2025) to the new year (e.g. 2026) so that
> balances are not lost.
>
> `Open Leave Transaction (Carry Forward)`
>
> `Close`

Three ways out: the `×`, the `Close` button, or the primary button, which navigates to
`/Leave/Leave_Transaction.aspx`. It is **not** un-skippable — `Close` dismisses it — but it reappears
on every fresh load of the dashboard.

### 1.2 The other four modals this screen carries
All four are built into the page and shown only when their condition is met. I read each one's exact
wording; I saw only the carry-forward one actually appear.

| Modal | Wording | Buttons |
|---|---|---|
| **Attendance Year Required** | *"A new attendance year needs to be created for the current period. The latest attendance year on record ends on -. Please create the new attendance year from -."* (the two dashes are where the dates belong) | `×` · `Create Attendance Year` · `Close` |
| **Complete Your Profile** | *"Your email address and contact number are required to continue."* Fields: `Email ID *` (placeholder `Enter email address`) · `Contact No *` (`Enter contact number`) | `Close` · `Save & Continue` |
| **HRMex Dashboard Information** (the ℹ) | Three sections — **Employee License Status** *"Used: 0 / 0 employees"* · **AMC / Subscription** · **About HRMex**: *"HRMex is an integrated HR & Payroll platform for attendance, leave, payroll processing, employee master, reports, and more. It supports multiple companies, departments, pay cycles, and attendance years. For support and renewal, please contact your administrator or HRMex support."* | `×` · `Close` |
| **Employees Aged 60+ (Retirement Period)** | A grid: `Emp Code · Employee Name · Age · Department · DOB · Joining Date`. Empty state: *"No employees aged 60+ found"* | `×` · `Close` |

### 1.3 Card Visibility (the ⚙ panel)
A checklist that turns each piece of the dashboard on and off, grouped exactly like this. Live state
on my visit in brackets.

- **Stat Cards Layout** — a link `Old Dashboard` (goes to `/Dashboard/Dashboard.aspx`, §2) and a
  radio pair **`{One Line | Two Lines}`**
- **Info Cards Per Row** — radios **`{4 Cards | 6 Cards | 8 Cards}`**
- **Statistics Cards** [on] — a master switch, then one per tile: `Present Today` [on] ·
  `Absent Today` [on] · `On Leave / WO` [on] · `Late / Early` [on] · `Total Employees` [on] ·
  `Birthdays Today` [on] · `Devices Online` [on] · `OT Hours` [on]
- **Charts** [on] — `Attendance Trend` [on] · `Department Distribution` [**off**]
- **Shortcut Links** [on] — `Quicklinks` [on]
- **Other for Future** [on] — `Payroll Coming Alert` [on]
- **Information Cards** [on] — `Today's & Tomorrow's Birthdays` [on] · `Missed Punches` [on] ·
  `Department Vacancies` [on] · `ESS Pending Approvals` [**off**] · `Upcoming Holidays` [on] ·
  `Team Performance` [on] · `Quick Stats` [on] · `Device Status` [on]
- Three buttons at the bottom: `[Show All] [Hide All] [Reset Layout]`

### 1.4 The eight number tiles — label, live value, and the link under each
| Tile | Live value | Sub-line | Link under it → where it goes |
|---|---|---|---|
| Total Employees | **124** | Active workforce | `View All Employees` → the drill-down list, DataType `Total` (§3) |
| Present Today | **0** | 0% attendance | `View Present Details` → drill-down, `Present` |
| Absent Today | **50** | Needs attention | `View Absent Details` → drill-down, `Absent` |
| On Leave / WO | **0 / 74** | leaves & WO | `View Leave / WO Details` → drill-down, `WOLeave` |
| Late / Early | **0 / 0** | Today's late & early | `Late / Early Entry` → `/Attendance/LateEarlyEntry.aspx` |
| Birthdays Today | **0** | Celebrate! | `Employee Master` → `/Master/Employee_Mst.aspx` |
| Active devices: Online / Offline | **0/2** | Online / Offline | `Device Management` → `/Utilitty/DeviceManagement.aspx` |
| OT Hours | **0:00** | Total overtime | `Monthly Att Voucher` → `/Attendance/MonthlyAttVoucher.aspx` |

### 1.5 The three wide cards
**Quicklinks** — *"9 quick links."* Nine round tiles, and the destination behind each:
`Salary Process` → `/Payroll/PayrollProcess.aspx` · `Attendance Voucher` →
`/Attendance/MonthlyAttVoucher.aspx` · `Attendance Calculation` →
`/Attendance/Attendance_Calculation.aspx` · `Device Logs` → `/Attendance/Device_Logs.aspx` ·
`Collect Attendance` → `/Payroll/Attendance_Import.aspx` · `Salary List` →
`/Payroll/Salary_View.aspx` · `Salary Calculation` → `/Reports/Salary_Calculation.aspx` ·
`Attendance List` → `/Payroll/Attendance_View.aspx` · `Payroll Voucher` →
`/Payroll/PayRoll_Voucher.aspx`.
A ✏ pencil in the card's corner (title *"Edit Quicklinks"*) switches the card into edit mode, where
**each tile shows how many times this person has opened that screen** — `74 visits`, `72 visits`,
`58 visits`, `49 visits`, `47 visits`, `13 visits`, `10 visits`, `1 visit`, `1 visit` — with a
`Quick` toggle per tile and `[Save] [Cancel]`. So the shortcut list is built from real usage and then
pinned by hand.

**Active Year and Payroll Month** — *"Current active year and payroll month."*
`CURRENT ACTIVE YEAR  01 Jan 2026 - 31 Dec 2026` · `CURRENT PAYROLL MONTH  Sep 2026`.

**Payroll Process** — *"Alert and link when payroll is due."* → `[Go to Payroll Process]`.

### 1.6 The two charts
- **Attendance Trend** — a line/bar canvas with a `{Week | Month}` toggle above it.
- **Department Distribution** — a second canvas, **switched off by default** in Card Visibility, so
  the card is not on the page until you turn it on.

### 1.7 The eight information cards
- **Today's & Tomorrow's Birthdays** — count `0`; empty state *"No birthdays today or tomorrow"*.
- **Missed Punches** — count `0`; a filter **`{All | In Missed | Out Missed}`** and a search box
  *"Search employee, code, dept..."*; empty state *"No missed punches found"*. Its header also opens
  **Clear Missed Punch** — see 1.8.
- **Department Vacancies** — count `0`; *"No vacancies found"*.
- **ESS Pending Approvals** — off by default; opens the three approval modals in 1.9.
- **Upcoming Holidays** — a period filter
  **`{Upcoming 3 | Upcoming 6 | Next 15 days | Next 30 days | Next 45 days | Next 60 days}`**;
  count `0`; empty state *"No holidays this month"*.
- **Department Performance** ("Team Performance" in the visibility list) — one row per department,
  each with a percentage bar and `Employees / Present / Absent / Late / On Time (%)`. All 18
  departments on the demo read 0% because nobody is marked present:
  `Default 1 · Marketing 16 · Dispatch 6 · Production 40 · Accounts 3 · Loading 2 · STORE 6 ·
  Maintenance 8 · Consumables Store 1 · HR 3 · House Keeping 1 · QC 8 · Purchase 2 · Packing 10 ·
  Safety 1 · Production Pardi 14 · QC PARDI 1 · IT 1`.
- **Quick Stats** — `On Time Today 0` · `New Employees 0` · `Total Resigned 0`.
- **Device Status** — `2` devices, `2 Active`, `0 Online`, `2 Offline`; then a row per device:
  `Sarigam — Offline — Alter 30-Jun-2026 10:25` and `Vapi — Offline — Alter 30-Jun-2026 10:25`.

### 1.8 Dialog: `Clear Missed Punch` (the Missed Punches card)
Two summary blocks — **Selected Month** `0 MissPunch Pending / 0 MissPunch Cleared` and
**Last 3 Months** `0 MissPunch Pending / 0 MissPunch Cleared` — over two filters (`Date range`,
`Department`). Below them the add-a-punch form, introduced by its own sentence:

> *"You are adding a manual punch to resolve the missed punch for the date below. Select In or Out
> based on which punch is missing."*

| Field | Type | Default / note |
|---|---|---|
| Employee | text with picker, placeholder `EmpCode : Employee Name` | empty |
| Date | text (date) | empty |
| Punch Type | radio `{In | Out}` | *"Used for ME device selection"* |
| Punch Time | text, placeholder `Select date and time` | helper text `Format: dd-mm-yyyy HH:mm:ss` |
| Remark | textarea, `Optional remark...` | empty |

Buttons `[Close] [Save Punch]`. **`Save Punch` writes a punch into somebody's attendance** — I opened
the dialog, wrote it down, and closed it.

### 1.9 Dialogs: the three ESS approval queues
Each opens from the ESS Pending Approvals card, each has the same shape — filters, then a grid, then
`[Apply]` and `[Close]`, and each loads with a `Loading...` spinner.

| Modal | Filters | Grid columns | Empty state |
|---|---|---|---|
| **Miss Punch Regularization (Add Punch) - Pending Approvals** | `Employee {All Employees}` · **`Pending at Auth {All | Pending at L1 | Pending at L2 | Pending at L3 | Pending at L4 | Pending at L5}`** · `Department {All Departments}` | `Emp Code · Employee · Department · Log Date · Log Time · Entry Date · Remark · Pending At` | *"No pending Miss Punch requests found"* |
| **Leave Request - Pending Approvals** | the same three **plus `Leave Type {All Types}`** | `Emp Code · Employee · Department · Entry Date · From Date · To Date · Days · Leave Type · Remark · Pending At` | *"No pending Leave requests found"* |
| **OD Request - Pending Approvals** | the same three | `Emp Code · Employee · Department · Entry Date · OD Date · Remark · Pending At` | *"No pending OD requests found"* |

The five `Pending at L1…L5` levels are the product's approval ladder — a request can be waiting at
any one of five rungs.

### 1.10 The notifications panel (inside the dashboard, right-hand side)
Count **59**, with a `[Clear]` button. Every entry is `Type: sentence` + a relative age. The kinds
that were live:
- **Device Offline:** *"Device Sarigam is offline since 30-06-2026 10:25"* — 4 days ago (and the same
  for Vapi)
- **Absent Alert:** *"Employee 'Test 6' has been absent for the last 10 days."* — 4 days ago
  (≈55 of the 59 entries are this, one per employee)
- **Employee Under 18 (DOB):** *"Employee 'Test 111' (EMP111) has DOB 16-Jul-2025 and appears to be
  under 18 years old. Please verify and correct the DOB to comply with company policy."* — 4 days ago

**Realtime/auto:** the session clock in the sidebar ticks down every second. Nothing else on the
dashboard moves on its own — the ⟳ button in the tab bar is how you refresh it.

**A "More Details" link** on the ESS card opens `/ESS/ESSRequestDetails.aspx`, and it does so **as a
new tab in the shell** rather than replacing the dashboard.

---

## 2. Old Dashboard — `/Dashboard/Dashboard.aspx`  ⚠️ never captured before

**Where:** Dashboard → the ⚙ Card Visibility panel → the `Old Dashboard` link (top left of the
panel). It is also the target of the app's `Home` breadcrumb on several screens.

**What you see on arrival:** a date box + `[Refresh]` at the top, then **three tabs**:
`Workforce · Diversity · Costing`. This is the previous generation of the dashboard, still shipped
and still live.

**Tab: Workforce** — four tiles, each with a `More info →` link: `Total Present 0` ·
`Employee Present Rate 0 %` · `On Leave & WO 74` · `Absent Employee 50`. Below them a stacked bar
chart **Department Stregth** *(spelt that way on screen)* and a **Missed Punch** card showing `3`.

**Tab: Diversity** — `Total Employees 124` · `Present Today 0` · `Males Present 0` ·
`Females Present 0`; then **Gender-wise Attendance** twice — once as figures
(`Males 0.0% — Total: 116, Present: 0` · `Females 0.0% — Total: 8, Present: 0`) and once as a chart.

**Tab: Costing** — the money tab, and the only place in my scope with live rupee figures. Eight
tiles, each with a period-on-period arrow:
| Tile | Value | Change |
|---|---|---|
| Today's Total | 2,939 | ▲ ₹712 (31.97%) |
| This Month Total | 48,314 | ▼ ₹986 (2%) |
| Previous Month | 54,198 | ▲ ₹13,004 (31.57%) |
| YTD Total | 572,288 | ▲ ₹131,808 (29.92%) |
| Today's OT Cost | 600 | Hours: 24 |
| This Week OT | 4,114 | Hours: 145 |
| This Month OT | 16,343 | Hours: 580 |
| Avg Daily OT | 458 | Hours: 18 |

Then **eight charts, each with its own export dropdown** —
**`{--Export-- | Export as PNG | Export as PDF | Export as Excel}`**:
`Weekly Comparison` · `This Month Daily Costs` · `Department Cost Distribution` ·
`Cost Category Breakdown` · `Regular vs OT Cost Trend` · `Department-wise OT Hours` ·
`Daily Cost Breakdown` · `Monthly OT Trend`.

**Controls:** `[Refresh]` (posts the page back for the chosen date). The page also carries hidden
`Attendance Logs` and `Alert` dialogs with `[Save]` and `[Recalculate]` buttons — both write, so I
did not open them beyond reading their labels.

---

## 3. Attendance drill-down list — `/Dashboard/Attendance_Data.aspx?DataType=…`  ⚠️ never captured before

**Where:** Dashboard → any of the top four tiles → its `View … Details` link. Four flavours, one per
tile: `DataType=Total` · `Present` · `Absent` · `WOLeave`.

**What you see on arrival:** a title **Attendance Tracker / Attendance Data**, a filter row, then one
long table of every employee in that state.

**Controls:** `Search` (text, *"Search across columns"*) · `Date` (text, defaults to today
`07-Sep-2026`) · a month dropdown
**`{January | February | March | April | May | June | July | August | September | October | November | December}`**
· a year number box (`2026`) · `[Show]` · `[Excel]`.

**Table columns (13):** `Emp Code · Employee Name · Location · Company · Division · Department ·
Designation · In Time · Shift · Late by · Out Time · Early by · Status`.
Live rows look like `EMP001 · Test 1 · Location 2 · Company 2 · Division 2 · Marketing ·
GM Marketing · (blank) · NS · 00:00 · (blank) · 00:00 · Absent`, and `Status` carries values
`Absent` and `WO`. All 124 rows render on one page — no paging.

---

## 4. Masters Permission — `/Admin/Masters.aspx?MenuId=85`

**Where:** sidebar → `Admin` → `Masters Permission`.

**What you see on arrival:** breadcrumb `Home / Masters`, a card titled **Masters**, one
`[Add Masters Combination]` button, and a small two-column table.

**Table:** `Master Name | Master Short Name` + two action cells (`Edit`, `Delete`). Live rows:
| Master Name | Master Short Name |
|---|---|
| Default | Default |
| ADMIN | AD |
| nji | j j n |

No search, no paging, no page-size control. `Delete` raises the browser's own confirm box —
**"Do you want to Delete ?"** with the browser's OK/Cancel (I dismissed it).

**⚠️ What this screen actually is.** A "Masters" record is a named **data scope** you attach to a
back-office user, and the scope is defined by ticking boxes across **twenty** different lists. But
the twenty lists **only appear when you EDIT an existing row** — the `[Add Masters Combination]` form
is just three fields. That is the single most important thing about this screen and it is not in the
old capture.

### 4.1 `[Add Masters Combination]` → `/Admin/Masters_AU.aspx`
| Field | Type | Required | Default |
|---|---|---|---|
| Masters Name | text, `Enter Masters Name` | yes in practice | empty |
| Masters short Name | text, `Enter Masters short Name` | yes in practice | empty |
| Location | dropdown **`{Location 1 | Location 2 | Location 3 | Location 4 | Location 5}`** | — | `Location 1` |

Button `[Save]`. The page also carries a **hidden copy-from dialog** — a `Master` dropdown (empty on
this demo) with `[Save]` and `[Close]` — i.e. a "start this scope from an existing one" path that no
visible button on the add form opens.

### 4.2 Edit an existing row → the same page, plus **`Masters Permission`** — the full grid
The three fields above (pre-filled; `[Save]` now reads **`Update`**), then a section headed
**Masters Permission** made of **20 blocks**. Each block is a titled checkbox list with a
**tick-all box in its header row**; the header row is the raw database column name, which is why some
read oddly (`costcenter_name`, `GroupFName`, `HoliDay_GroupName`).

**There are no view/add/edit/delete columns anywhere on this screen** — a box is ticked or it is not.
Below, every block with every one of its options, as it stood on 2026-09-07:

1. **Company Selection** — `Company Name`: **`{Company 1 | Company 2}`**
2. **Location Selection** — `Location Name`: **`{Location 1 | Location 2 | Location 3 | Location 4 | Location 5}`**
3. **Division Selection** — `Division Name`: **`{Division 1 | Division 2 | Division 3 | Division 4 | Division 5 | Division 6 | Division 7 | Division 8 | Division 9}`**
4. **Department Selection** — `Department Name` (21): **`{Default | Marketing | Dispatch | Production | Accounts | Loading | STORE | Maintenance | Consumables Store | HR | House Keeping | RM Store | QC | Purchase | Packing | Safety | RM & Con Store | Production Pardi | QC PARDI | Admin | IT}`**
5. **Section Selection** — `Section Name`: **`{Default}`**
6. **Costcentre Selection** — `costcenter_name`: **`{Default}`**
7. **Holiday Selection** — `HoliDay_GroupName`: **`{All | Default | BAKRA EID | Eid ul Fittar | specila}`**
8. **ShiftGroup Selection** — `GroupFName` (11): **`{GS | General 1 | Day Shift | Night Shift | Day/Night | GS-HOD | General Shift2 | GS Shift NIGHT | General Night | NORMAL GS SHIFT | Production General Shift HOD}`**
9. **Category Selection** — `Category_Name`: **`{Category 1 | Category 2 | Category 3 | Category 4 | Category 5 | Category 6 | Category 7}`**
10. **Bank Selection** — `BankName` (19): **`{Bank 1 … Bank 19}`** (literally `Bank 1` through `Bank 19`)
11. **Leavelevel Selection** — `LeaveLevelName`: **`{Office Staff | HOD | Worker | Maintenance & QC Staff | Production Staff}`**
12. **Designation Selection** — `DesignationName` (60): **`{Default | Operation Head | Manager Accounts & finance | Purchase Manager | Store Manager | Maintenance manager | Dispatch Head | HR HEAD | GM Marketing | Sr. Sales Executive | Zonal Head | AGM Marketing | Sr. Operator | Operator | Sr. Accounts Executive | Sr. Slitting Operator | Accounts Executive | Jr. Operator | Slitting Operator | Sales Executive | Store Executive | Unloading INCHARGE | Sr. Quality Incharge | Asst. Store Manager | Sr. Quality Executive | Packing Supervisor | Sr. Dispatch Executive | Asst. Manager Maintenance | Purchase Executive | Safety Head | QC Executive | HR Executive | Sr. HR Executive | Commercial Officer | Plant Head | Sr. Electrician | HELPER | Office Assistant | Fitter Maintenance | SALES COORDINATOR EXPORT | Loading Supervisor Incharge | ELECTRICIAN | DISPATCH EXECUTIVE | Sr. Maintenance Executive | Qc Head | Electrical Engineer | QA Executive | Supervisor | Asst. Supervisor | Safety Officer Trainee | HR Generalist | Store Keeper | Asst. Trainee Operator | IT Support Engineer | Data Entry Operator | Driver | Trainee Operator | Shift Incharge | Store Incharge | Safety Officer}`**
13. **SalaryHead Selection** — `HeadsName` (63) — **this is the product's entire chart of pay heads**: **`{BASIC | HRA | Conveyance | P | A | H | MD | PF | Education | OTHERS | PERQUISITES | PRODUCTION | PT | TDS | HOME_LOAN | BASICDA | VDA | Advance | Attendance Bonus | Other Deduction | OT | OT HRS | PL | WO | WOP | HP | CL | OD | COFF | Monthly Incentive | Travel Allowance | LTD | ROOM_RENT | MEDICAL | LTA | EXGRATIA | MEDICLAIM | Bonus | LOAN | Perf. Allow | FIX_INCENTIVE | WASHING_ALLOWANCE | Canteen | SL | LateBy | SHL | Salary Addition | Salary Deduction | Reimbursement | ESIC | LWF | ExtraHRS | Arrears | Late_Mark_Fine | Diciplinary_Fine | DLD | SPL | ML | SpecialAllowence | WorkingHrs | EPF | WRD | WD}`**
14. **Shift Selection** — `ShiftName` (11): **`{General | NS | Day Shift | Night Shift | General 1 | General Shift2 | General Shift HOD | GS Shift NIGHT | General Night | NORMAL GS SHIFT | Production General Shift HOD}`**
15. **Level Selection** — `LevelName`: **`{Default | (a blank-named row)}`**
16. **Document Selection** — `DocumentName` (14): **`{PAN | Aadhar | Driving Liences | Bank Passbook /Cheque book | OFFER LETTER | Appointment Letter | Termination Letter | Warning Letter | Voter Id | 10TH | 12TH | GRADUATION | POST GRADUATION | DIPLOMA}`**
17. **Education Selection** — `EducationName`: **`{Graduate Degree | Master Degree | Diploma | 12th | 10th}`**
18. **Assets Selection** — `AssetName`: **`{SAMART MOBILE PHONES | KEYPAD MOBILE PHONES | MOTORCYCLES | SCOOTY | LAPTOP | DESKTOP | SIM CARD}`**
19. **Device Selection** — `DeviceName`: **`{ME | Mobile | Sarigam | Vapi | ME(IN) | ME(OUT) | Mobile(IN) | Mobile(OUT)}`**
20. **Hierachy Selection** *(spelt that way on screen)* — `HierarchName` (16): **`{Admin | Default | Accounts | RM Store | PRODUCTION | MAINTENANCE | Purchase | HR | Dispatch | Loading / Unloading | Loading / Unloading | QC | Store | Safety | Production Pardi | Marketing}`** — `Loading / Unloading` genuinely appears twice.

---

## 5. UsersTypes — `/Admin/User_Types.aspx?MenuId=3`

**Where:** Admin → `UsersTypes`.

**What you see on arrival:** breadcrumb `Home / User Types`, card **User Types**, one
`[Add User]` button *(the label says "Add User" on a user-**types** screen)*, and a table.

**Table:** `UserType Name | UserTypeLevel | ReportType` + `Edit` and `Delete` cells. Live rows:
| UserType Name | UserTypeLevel | ReportType |
|---|---|---|
| SUPER ADMIN | 1 | *(blank)* |
| Admin | 1 | *(blank)* |

Both types sit at level 1, and neither has any export format granted. No search, no paging.

**Form — `/Admin/User_Types_AU.aspx`, card `UserType Master`:**
| Field | Type | Default |
|---|---|---|
| UserType Name | text, `Enter UserType Name` | empty |
| UserType Level | **number**, `Enter UserType` | empty — the seniority number |
| Report Type | a multi-select behind a `[Select Reports]` button | nothing chosen |

**⚠️ The complete `Report Type` list is five options: `{PDF | Excel | Word | View | CTRL+P}`.** The
dropdown itself has a search box and a `Select All` row. Note **`CTRL+P`** — printing straight from
the browser is treated as its own grantable export format. Button `[Save]`.

*What it is for: which file formats a role may take a report out in is a property of the **role**, not
a global setting — and "may print from the browser" is one of them.*

---

## 6. Users — `/Admin/User_Master.aspx?MenuId=4`

**Where:** Admin → `Users`.

**What you see on arrival:** breadcrumb `Home / User Master`, a `[+ New User]` button, a search box,
the table, then a footer row with the page size and the pager.

**Table:** `Username | First Name | Last Name | Contact No | Admin? | Actions`.
Live rows — **one**: `SuperAdmin · Super · Admin · 9999999999 · ✔ Yes`.
`Admin?` renders as a green ✔ Yes / red badge. `Actions` holds two icon buttons: a **pencil** (edit)
and a **red trash** (delete).

**Controls:** search box `Search users...` (filters live, no page reload) · page size
**`{10 | 15 | 25}`** (default 10) · a five-button pager `«  ‹  1  ›  »` · a count line
`Showing 1–1 of 1 users`.
**Empty state:** a struck-through-person icon and **"No users found."**

**Delete dialog:** heading **`Delete User?`**, buttons `[Cancel] [Yes, Delete]`.

**Form — `/Admin/User_Master_AU.aspx`, `Add User / New User Details`, with a `Back to List` link.**
Three labelled fieldsets:

**ACCOUNT CREDENTIALS**
| Field | Type | Required | Placeholder |
|---|---|---|---|
| User Name | text | * | `Enter username` |
| Password | password | * | `Enter password` |

**PERSONAL INFORMATION**
| Field | Type | Required | Placeholder |
|---|---|---|---|
| First Name | text | * | `First name` |
| Last Name | text | * | `Last name` |
| Contact No | text | — | `+91 00000 00000` |
| Mail ID | text | — | `user@example.com` |

**ROLE & SETTINGS**
| Field | Type | Options (complete) | Default |
|---|---|---|---|
| **Masters** (the data scope, §4) | dropdown | **`{Default | ADMIN | nji}`** — one entry per Masters row | `Default` |
| User Type (§5) | dropdown | **`{SUPER ADMIN | Admin}`** | `SUPER ADMIN` |
| Flags & Permissions | three checkboxes | `☐ Is Admin` · `☐ Is Super Admin` · `☐ Is Active` | all unticked |

Buttons `[Save]` and `[Cancel]`.

*So a back-office person is exactly four decisions: a login, a name, **which Masters scope they see**,
and which user type they are — plus three flags. Note that `Is Active` starts **unticked**.*

---

## 7. Change Password — `/Admin/Password_Change.aspx?MenuId=5`

**Where:** Admin → `Change Password`. It changes the **signed-in back-office user's own** password;
there is no "whose password" picker.

**What you see on arrival:** breadcrumb `Home / Change Password`, a card **Change Password**, three
stacked password boxes, and one button in the card footer.

| Field | Type | Placeholder |
|---|---|---|
| Old Password | password | `Enter Password` |
| New Password | password | `Enter New Password` |
| **Comfirm Password** *(spelt that way on screen)* | password | `Enter Comfirm Password` |

Button `[Change Password]`.

**Rules the screen states: none.** There is no minimum length, no character requirement, no strength
meter, no "passwords must match" hint, and no field is marked required. Nothing is said until you
press the button, at which point the app answers through its shared pop-up channel.

---

## 8. Audit Logs — `/Admin/Logs_Audit.aspx?MenuId=7`

**Where:** Admin → `Audit Logs`.

**What you see on arrival:** breadcrumb `Home / Logs Audit`, card **Logs Audit**, a filter row
(`Date From`, `Date To`, `[Filter]`), a `Search :` box on the right, then the grid and a numbered
pager.

**Controls:**
- `Date From` / `Date To` — plain text boxes, **both defaulting to today** (`07-Sep-2026`), format
  `dd-MMM-yyyy`. They carry a date-picker CSS class but **no calendar opens** when you click them, so
  the date is typed by hand.
- `[Filter]` — re-reads the grid for the range.
- `Search :` box, placeholder `Search Here...` — **it does not filter.** Typing a string that matches
  nothing leaves all ten rows showing; pressing Enter posts the page back, keeps the text in the box,
  resets the dates to today, and returns the same rows.

**Grid columns (5):** `LogDateTime | User Name | IP Address | Operation Type | Status`.
**Page size 10, fixed.** The pager shows ten page numbers plus `...`; the range 01-Jan-2025 →
31-Dec-2026 paged out past **140 pages**, i.e. well over 1,400 entries.

### ⚠️ What it actually records — verified live, and the old capture is wrong
The 2026-08-16 capture says *"It records logins and nothing else… no employee edit, no salary change,
no payroll lock/unlock, no deletion is recorded anywhere."* **That is no longer true.** Filtering
01-Jan-2025 → 31-Dec-2026 and reading through pages 1, 2, 12, 22, … 140, the `Operation Type` column
carries a full English sentence naming the record and the person. The kinds I saw:

| Kind of entry | Example, verbatim |
|---|---|
| Sign-in | `Login` — with `Status` `Success` **or** `Failed` |
| Attendance punch added | `Save Device log, EmpCode : Code = GPPI0057:Sanjay Paswan and Log Datetime = 2025-12-05 07:55:00` |
| Attendance punch removed | `Delete Device log, EmpCode = GPPI0057 and Employee Name = Sanjay Paswan and Log Datetime = 01-12-2025 20:10` |
| Punch refused | `Device log already exist` |
| **Pay changed** | `Update Employee salary` |
| Employee edited | `Update Employee` · `Update Employee Details` · `Update Multiple Employee` |
| Employee sub-records | `Save Address Details` · `Update Address Details` · `Save Education` |
| Master data | `Save Bank` · `Update Bank` · `Save Designation` · `Save Shift` · `Update Shift` · `Delete Shift` · `Save Shift Group` · `Update Shift Group` |
| Leave | `Save Leave Entry` |
| Device | `Save Device, Device Name Sarigam and DeviceID = 101` |
| Bulk imports | `Excel Import Employee` · `Excel Import Location, LocationName : Vapi and New LocationID = 1003` · `Excel Import Company` · `Excel Import Department` · `Excel Import Bank` |
| **A refusal, with its reason** | `Unable to Delete Shift as it is currently being utilized in the Employee Master.` · `Unable to delete ShiftGroup as it is currently being utilized in the Employee Master` |

So it does record money (`Update Employee salary`), it does record deletions
(`Delete Device log`, `Delete Shift`), and it even records **attempts that were blocked, with the
reason**. That last one is unusually good.

**What did NOT appear in the pages I sampled** (honest limit — I read roughly 140 of 1,400+ rows,
spread across the range, not all of them): a payroll month being locked or opened, a salary
calculation run, a letter being generated or voided, a back-office user being created or removed, and
a leave request being approved or rejected. Whether those are genuinely unrecorded or simply absent
from my sample, I cannot say from what I saw.

---

## 9. System — `/Admin/System_Mst.aspx?MenuId=87`

**Where:** Admin → `System`. Card **System Settings**, **three tabs**:
`Custom Report · Auto Mail · Auto Jobs`. Each tab has its own `Search :` box and its own grid; the
page keeps all three grids loaded and swaps which is visible.

### Tab 1 — Custom Report
`[New Report]`; grid `Custom Report Name | Report Text | Report Name` + `Edit` / `Delete`.
Live row: `edgrf | dthffyjh | sdf` — leftover test typing, still on the demo.

**Dialog `Report`:**
| Field | Type | Options / note |
|---|---|---|
| Custom Report Name | text | `Enter Custom Report Name` |
| Custom Report Text | text | `Enter Report Text` — this is the query the report runs |
| **Report Group** | dropdown | **`{Employee Report | Leave Report | Payroll Report | OT Report | Daily Att Report | Monthly Att Report | Yearly Att Report | Statutory Report | Canteen Report | MIS | TDS Report | Access Control}`** — default `Employee Report` |
| Custom Report Short ID | text | `Enter Report ShortID` |
| Report Name | text | `Enter Report Action` |
| ☐ Filter Month | checkbox | whether the report asks for a month |
| ☐ From Date - TO Date | checkbox | whether it asks for a date range |
| Custom Report Action | textarea | `Enter Report Action` |

Buttons `[Close] [Save]` + `×`.

*What it is for: a customer can add a completely new report — its query, which group it files under,
and which date filters it asks for — without waiting for a software release.*

### Tab 2 — Auto Mail
Grid `Name | Subject | Email From | Email Time | Mail ON/OFF` + `Edit` and **`Start`** per row.
Live rows (all three off):
| Name | Subject | Email From | Email Time | Mail ON/OFF |
|---|---|---|---|---|
| Birthday_Mail | Wishing You a Wonderful Birthday! | 1 | 00:01 | False |
| Inactive-user-email | We Miss You at Our HRMex! | 1 | 07:00 | False |
| Daily Report Email | Daily Attendance Report | 1 | 09:00 | False |

**Dialog `Mail`:**
| Field | Type | Options |
|---|---|---|
| Name | text | — |
| Subject | text | `Enter Subject` |
| **Email From** | dropdown | **`{Location | Company | User | Employee | isHOD | ReportingManager}`** — default `Location` |
| Email Time | **time** picker | — |
| ☐ Mail-ON/OFF | checkbox | off |

Buttons `[Close] [Save]` + `×`. `Start` on a row appears to fire the mail there and then — **I did
not press it.**

*What it is for: recipients are chosen **by role**, never by typing an address. "Send this to the
reporting manager" survives people changing jobs.*

### Tab 3 — Auto Jobs
The scheduled-job table. Grid `Auto job Name | Job Time(Hour) | Job Time(Min) | Status` + `Edit` and
`Start`. Live rows (both off):
| Auto job Name | Hour | Min | Status |
|---|---|---|---|
| Collect_Attendance_Full_Month | 2 | 0 | False |
| Calculate_Full_Month_Salary | 3 | 0 | False |

**Dialog `Auto Job`:** `Auto Job Name` (text, `Enter Job Name`) · `Auto Job(Hrs)` (text, hint
`[HH](00-23)`) · `Auto Job(Min)` (text, `[MM](00-59)`) · `☐ Status` · `[Close] [Save]`.

*What it is for: the whole month's payroll can run unattended overnight — collect every punch at
02:00, calculate every salary at 03:00. Both ship **off**.*

---

## 10. Template Creation — `/TemplateGeneration/TemplateGeneration.aspx?MenuId=114`

**Where:** sidebar → `Template Management` → `Template Creation`.

**What you see on arrival:** a real word-processor. Three toolbar rows across the top, then a white
page-shaped canvas in the middle at the chosen paper size, with a right-hand slide-out panel for
variables.

**Row 1 — the document's identity and the main actions**
| Control | Options / behaviour |
|---|---|
| `Template name…` | text box |
| **Template Type** | **`{Select Template Type | Offer Letter | Appointment Letter | Confirmation Letter | Relieving Letter | Experience Letter}`** — five types, default nothing chosen |
| **Paper Size** | **`{A4 | Letter | Legal | A5 | A3 | Custom}`** — default `A4` |
| **Orientation** | **`{Portrait | Landscape}`** — default Portrait |
| `[Add Logo]` | title *"Add logo box — drag, resize, or remove"* |
| `[Variables]` | opens the variable panel (§10.1) |
| `[Preview]` | opens **Template Preview (Sample Data)** |
| `[Save]` | saves the template |
| `Template List` | a link out to **Template Section** (§11) |

**Row 2 — the page itself**
- `MARGINS (MM)` — four number boxes `T` `B` `L` `R`, **all default 20**
- **Page border** — **`{None | Thin | Medium | Thick | Double (letterhead)}`** — plus a colour box
  and a hex field, default **`#94a3b8`**
- **PAGE FILL** — colour box + hex field, default **`#ffffff`**
- **Header & Footer** — **`{Add Header | Remove Header | Add Footer | Remove Footer}`**
- **Line Spacing** — **`{Remove spacing (0) | 0.5 | 1.0 (Single) | 1.15 | 1.5 | 2.0 (Double) | 2.5 | 3.0 (Triple)}`**
- **Watermark** (title *"Page background watermark"*) — **`{CONFIDENTIAL 1 | CONFIDENTIAL 2 | DO NOT COPY 1 | DO NOT COPY 2 | DRAFT 1 | DRAFT 2 | SAMPLE 1 | Custom Watermark… | Remove Watermark}`**
  (the two numbered variants are the diagonal and horizontal placements)
- `☐ Repeat logo every page`
- `[Add Page]` (*"Insert page break and add new page"*) · `[Remove Page]` (*"Remove last page break"*)

**Dialog `Custom Watermark`:** `Text` (placeholder `e.g. CONFIDENTIAL`) · layout radios
**`{Diagonal | Horizontal}`** · `[Cancel] [Apply]`.

**Row 3 — the editor toolbar** (CKEditor, with a set of custom buttons bolted on).
Standard: `Source` · Cut · Copy · Paste · Paste as plain text · Paste from Word · Undo · Redo ·
Bold · Italic · Strikethrough · Remove Format · Numbered List · Bulleted List · Decrease Indent ·
Increase Indent · Block Quote · Align Left · Center · Align Right · Justify · Link · Unlink ·
Anchor · Image · Table · Insert Horizontal Line · Insert Special Character · Format (paragraph) ·
Font · Size · Text Color · Background Color.
Custom, with the exact tooltip each carries:
| Button | Tooltip |
|---|---|
| `Cell` | Table cell properties (fill, border, alignment) |
| `Cell Fill` | Table cell background color — click in a cell, then pick a color |
| `Cell Border` | Table cell border color |
| `Shading` | Background color for selected paragraph(s) |
| `Callout` | Callout box with left accent — pick fill color (whole selection) |
| `Callout Left` | Thick left accent line — pick color (Automatic = darker shade of fill) |
| `Callout Size` | Callout width / height — or drag handles on the box corner & edges |
| `Callout Edge` | Callout outer border (top, right, bottom) — pick color or Automatic to remove |
| `Section` | Section header bar — pick background color |
| `Box` | Bordered box — pick fill color |
| `Clear` | Remove callout, section, box, or shading styling |
| `Logo` | Add logo box — drag, resize, or remove |

**Canvas empty state:** *"Your template content will appear here. Use {{VariableName}} placeholders
for dynamic fields."*

### 10.1 The variable panel — **every placeholder, with the label shown beside it**
Opened by `[Variables]`; a right-hand panel with a search box (`Search variables...`), a `×` to
close, and the placeholders grouped as below. Each row shows the placeholder and a plain-English
name; you drag a row into the page, or click it.

**SYSTEM VARIABLES (13)**
| Placeholder | Shown as |
|---|---|
| `{{CurrentDate}}` | Current Date |
| `{{CurrentDateTime}}` | Current Date & Time |
| `{{PrintDateTime}}` | Print Date & Time |
| `{{Year}}` | Current Year |
| `{{MonthName}}` | Current Month Name |
| `{{PageNumber}}` | Page Number |
| `{{TotalPages}}` | Total Pages |
| `{{PageNumberOfTotal}}` | Page X of Y |
| `{{DocumentTitle}}` | Document Title |
| `{{DocumentId}}` | Document ID |
| `{{TemplateName}}` | Template Name |
| `{{GeneratedByUser}}` | Generated By User |
| `{{RefNo}}` | Reference Number |

**MANUAL VARIABLES** — empty here; the panel says *"No manual variables yet — use + to add."* These
are placeholders you invent yourself and fill in by hand at letter time.

**DATA VARIABLES (19)**
| Placeholder | Shown as |
|---|---|
| `{{CompanyName}}` | Company Name |
| `{{CompanyAddress}}` | Company Address |
| `{{CompanyEmail}}` | Company Email |
| `{{CompanyPhone}}` | Company Phone |
| `{{CompanyWebsite}}` | Company Website |
| `{{EmpName}}` | Employee Name |
| `{{EmpCode}}` | Employee Code |
| `{{EmpDesignation}}` | Designation |
| `{{EmpDepartment}}` | Department |
| `{{EmpDOJ}}` | Date of Joining |
| `{{EmpFatherName}}` | Father's Name |
| `{{EmpCategory}}` | Category |
| `{{EmpDivision}}` | Division |
| `{{EmpGender}}` | Gender |
| `{{EmpEmail}}` | Email |
| `{{EmpMobile}}` | Mobile |
| `{{ReportingManager}}` | Reporting Manager |
| `{{EmpLocation}}` | Location |
| `{{LetterDate}}` | Letter Date |

**ALLOWANCES TABLE (13)**
`{{BASIC}}` BASIC · `{{BASICDA}}` BASICDA · `{{HRA}}` HRA · `{{FIX_INCENTIVE}}` FIX_INCENTIVE ·
`{{OTHERS}}` OTHERS · `{{Monthly Incentive}}` Monthly Incentive · `{{SpecialAllowence}}`
SpecialAllowence · `{{OT}}` OT · `{{Reimbursement}}` Reimbursement · `{{WD}}` WD · `{{Bonus}}`
Bonus · `{{Canteen}}` Canteen · **`{{Salary.Allowances}}` Allowances Table**

**DEDUCTIONS TABLE (6)**
`{{LOAN}}` LOAN · `{{PF}}` PF · `{{Advance}}` Advance · `{{Other Deduction}}` Other Deduction ·
`{{ESIC}}` ESIC · **`{{Salary.Deductions}}` Deductions Table**

**NET SALARY TABLE** — `{{Salary.NetSalary}}` Net Salary
**GROSS SALARY TABLE** — `{{Salary.GrossSalary}}` Gross Salary
**CTC TABLE** — `{{Salary.CTC}}` CTC

**54 placeholders in total**, plus however many manual ones you add.

*The pattern worth copying: for money there is **both** a variable per head **and** a single variable
that drops the whole table in. One template then survives every company having a different list of
pay heads.*

### 10.2 `[Preview]` → dialog `Template Preview (Sample Data)`
On this demo the dialog opens and its body reads, in full:
**`Preview failed: Could not find stored procedure 'sp_GetEmployeeDetails'.`**
So the preview is a real feature that is broken on the demo, not a feature that doesn't exist.

---

## 11. Template Section (the template library) — `/TemplateGeneration/TemplateSection.aspx`  ⚠️ never captured before

**Where:** Template Creation → the `Template List` link (top right). Also the target of
`View Templates` on the Letter Generation wizard. It is **not** in the sidebar menu.

**What you see on arrival:** breadcrumb `Home / Template Generation / Template Section`, a filter bar
across the top, a count line, and a card grid below it.

**Controls:**
- `SEARCH` — text, placeholder `Search templates by name or description...`
- **`DOCUMENT TYPE`** — **`{All Types | Offer Letter | Offer Letter Annexure | Appointment Letter | Confirmation Letter | Termination Letter | No Dues Certificate | Relieving Letter | Experience Letter | Appraisal Letter | KRA Format | Resignation Format | Advance Letter}`** — twelve types plus All.
  **⚠️ Note the mismatch:** the *editor* (§10) only lets you tag a template with five of these twelve.
- `[Apply]` · `[Clear]`
- a count line — **`0 templates`**
- `[Grid View]` / `[List View]` toggle
- **`Sort ▾`** — **`{Recently Modified (selected) | Newest First | Name A-Z | Name Z-A}`**
- `[New Template]` → back to the editor
- A per-card `Export ▾` menu exists in the markup for when cards are present:
  **`{Export HTML | Export Word | Print / PDF}`**

**Empty state / what is actually on screen:** `0 templates`, and beneath the grid the page prints
**`Could not find stored procedure 'SP_GetAllTemplates'.`** — the library cannot list anything on
this demo, which is also why every template dropdown elsewhere is empty.

---

## 12. Letter Generation — `/TemplateGeneration/LetterGeneration.aspx?MenuId=116`

**Where:** Template Management → `Letter Generation`.

**What you see on arrival:** breadcrumb `Home / Templates / Letter Generation`, then a numbered
progress bar **`1 Template → 2 Employees → 3 Preview → 4 Export`**, with only the current step's card
on screen.

### Step 1 — Select Template
| Control | Options / default |
|---|---|
| `[View Templates]` (title *"Browse all saved templates"*) | opens the library, §11 |
| **Document Type** | **`{-- Select Type -- | Offer Letter | Offer Letter Annexure | Appointment Letter | Confirmation Letter | Termination Letter | No Dues Certificate | Relieving Letter | Experience Letter | Appraisal Letter | KRA Format | Resignation Format | Advance Letter}`** |
| **Template Name** | **`{-- Select Template --}`** — empty on the demo (see §11) |
| Letter Date | a real date picker, defaults to **today** (`2026-09-07`) |
| Ref No (optional) | text, placeholder **`Auto`** — leave it and the app numbers the letter |
| Options | `☑ Header` `☑ Footer` — **both ticked by default** |
| `[Next: Select Employees →]` | |

Also on this step, a dialog **`All templates`** with the columns
`Document type | Template name | Created` and `[Close]`.

### Step 2 — Select Employees
A `0 selected` counter in the card header, then a choice of two modes:
- **`○ Single Employee`** — one dropdown, `-- Select Employee --`, listing every employee as
  `CODE - Name`. **124 employees** on the demo (`EMP001 - Test 1` … `EMP099 - Test 99`), sorted by
  name as text, which is why `EMP010 - Test 10` sits between `Test 1` and `Test 102`.
- **`○ Batch (Multiple)`** — pick a **Department** and a **Designation**, then `[All] [None]` and
  `[Load Employees]`, which fills a tick-list.
  **Department (21):** `{Accounts | Admin | Consumables Store | Default | Dispatch | House Keeping |
  HR | IT | Loading | Maintenance | Marketing | Packing | PP | Production | Purchase | QC | QC PARDI |
  RM & Con Store | RM Store | Safety | STORE}`
  **Designation (60):** `{Accounts Executive | AGM Marketing | Asst. Manager Maintenance |
  Asst. Store Manager | Asst. Supervisor | Asst. Trainee Operator | Commercial Officer |
  Data Entry Operator | Default | DISPATCH EXECUTIVE | Dispatch Head | Driver |
  Electrical Engineer | ELECTRICIAN | Fitter Maintenance | GM Marketing | HELPER | HR Executive |
  HR Generalist | HR HEAD | IT Support Engineer | Jr. Operator | Loading Supervisor Incharge |
  Maintenance manager | Manager Accounts & finance | Office Assistant | Operation Head | Operator |
  Packing Supervisor | Plant Head | Purchase Executive | Purchase Manager | QA Executive |
  QC Executive | Qc Head | Safety Head | Safety Officer | Safety Officer Trainee |
  SALES COORDINATOR EXPORT | Sales Executive | Shift Incharge | Slitting Operator |
  Sr. Accounts Executive | Sr. Dispatch Executive | Sr. Electrician | Sr. HR Executive |
  Sr. Maintenance Executive | Sr. Operator | Sr. Quality Executive | Sr. Quality Incharge |
  Sr. Sales Executive | Sr. Slitting Operator | Store Executive | Store Incharge | Store Keeper |
  Store Manager | Supervisor | Trainee Operator | Unloading INCHARGE | Zonal Head}`
- Buttons `[Back] [Next: Preview]`.

### Step 3 — Preview & Generate
Header counter `1 letter`; a pager `‹ 1 / 1 ›` for flicking between the letters in the batch; the
letter itself rendered in the middle. Empty state: **"Preview will appear here"**.
Buttons `[Back] [Generate Letter]`.

### Step 4 — Export & History
Four buttons in the card header: `[Export PDF] [Export Word] [Export HTML] [Print]`.
Then a filter row and the **history grid**:
- Status filter **`{All Status | Generated | Exported | Printed | Voided}`** and a 🔍 button.
- Columns: **`Ref No | Template | Employee | Department | Generated | Status | Actions`**.
  `Ref No` shows as code; `Template` and `Employee` each pack two lines (type + template name;
  employee name + code); `Status` is a coloured badge — green `Generated`, blue `Exported`, cyan
  `Printed`, **red `Voided`**.
- **Empty state (what is actually on the demo): `No history records found`.**
- Row actions, four icon buttons: 👁 `Preview` · 📄 `PDF` · 📝 `Word` · 🗑 **`Delete`**.
- Elsewhere on the page: `[Generate More Letters] [View Templates] [Back to Templates]`, and a
  `[Go to Export / History]` button on a confirmation dialog.

### ⚠️ "Voided, never deleted" does not hold as the product stands
The 2026-08-16 capture stars this: *"⭐ A generated letter is never deleted — only Voided."*
What is on the screen now:
- **`Voided` exists only as a status you can filter by**, and as a red badge colour. There is no
  `Void` button anywhere on the screen and no void action on a row.
- The row's fourth action is a **trash icon whose tooltip is `Delete`**, and its confirmation reads,
  word for word: **"Delete Letter? — This will permanently delete this letter from history."** with
  a red **`Yes, delete`** button.

I could not see this on a live row: the history grid is empty on the demo, and template storage is
broken there (§11), so no letter can be generated to void or delete. The row buttons and the confirm
wording above are **read from the page's own script** (`js/letter-generation.js`), which is what
draws the row — flagged so nobody treats it as a screen I watched behave. **What I can say from the
screen alone: the only status filter that mentions voiding is `Voided`, and the only row action that
mentions removing is `Delete`.**

---

## Odd things I noticed

- The shell's bell said **`Error loading notifications`** while the dashboard's own panel inside the
  same page was listing 59 notifications. Two separate notification readers, one of them failing.
- `Preview` on Template Creation answers `Could not find stored procedure 'sp_GetEmployeeDetails'`,
  and Template Section answers `Could not find stored procedure 'SP_GetAllTemplates'`. The whole
  template library reads as 0 items because of it.
- Three Admin screens (`Masters`, `User_Types`, `System_Mst`) fall to the friendly error page if the
  address arrives without its `?MenuId=`.
- The `Search :` box on **Audit Logs** is drawn, focusable, and filters nothing.
- The `Date From` / `Date To` boxes on Audit Logs carry a date-picker class but no calendar opens;
  the date has to be typed as `dd-MMM-yyyy`.
- Test typing is live on the demo: a Masters scope named `nji / j j n`, and a Custom Report named
  `edgrf` with report text `dthffyjh`.
- Spelling on shipped labels: `Comfirm Password`, `Department Stregth`, `Hierachy Selection`,
  `Driving Liences`, `Diciplinary_Fine`, `SpecialAllowence`, `specila` (a holiday group).
- `Hierachy Selection` lists `Loading / Unloading` twice.
- The `UsersTypes` screen's create button is labelled `[Add User]`.
- The **Users** list's row-edit control carries the row's stored password through the page markup as
  one of its arguments, so a person's password travels to the browser as part of rendering the list.
- Template Section can filter by twelve document types; the editor can only tag a template with five
  of them.
- The `Access Control` menu group in the sidebar points at Canteen screens
  (`Canteen/Settings`, `Canteen/Items`, `Canteen/Workcode`) — the label and its contents do not
  match. (Out of my scope; noted for whoever has Access Control.)
- A right-hand "Customize AdminLTE" panel (Dark Mode, header options) is in the shell with no button
  that opens it — the UI kit's demo panel, left in.

---

## Corrections to the 2026-08-16 capture

1. **§1.5 Audit Logs — "It records logins and nothing else… For a system that pays people, this is a
   serious gap."**
   **Wrong now.** Over 1,400 entries across 140+ pages, and the `Operation Type` column carries a
   full sentence per action: `Update Employee salary`, `Update Employee`, `Update Multiple Employee`,
   `Save/Delete Device log` (with employee code, name and punch time), `Save/Update Bank`,
   `Save Designation`, `Save/Update/Delete Shift`, `Save/Update Shift Group`, `Save Leave Entry`,
   `Save Address Details`, `Update Address Details`, `Save Education`, `Save Device`, and
   `Excel Import {Employee|Location|Company|Department|Bank}`. It also logs **failed** logins and
   **blocked** deletions with the reason (`Unable to Delete Shift as it is currently being utilized
   in the Employee Master.`). Full detail and the honest limit of my sample: §8.
2. **§1.1 Masters Permission — "List + a 3-field form" is only half the screen.**
   Editing an existing Masters row reveals a **`Masters Permission` grid of 20 checkbox blocks**
   (Company, Location, Division, Department, Section, Costcentre, Holiday, ShiftGroup, Category,
   Bank, Leavelevel, Designation, SalaryHead, Shift, Level, Document, Education, Assets, Device,
   Hierachy), each with a tick-all header. The **Add** form does not show them. Complete option lists
   for all 20: §4.2. There are **no view/add/edit/delete columns** on this screen.
3. **§1.2 UsersTypes — `Report Type {PDF | Excel | Word | View | CSV …}`.**
   The real, complete list is five options and **CSV is not one of them**:
   **`{PDF | Excel | Word | View | CTRL+P}`**.
4. **§1.3 Users — the list button.** It is `[+ New User]`, not "Add". The list also has a live search
   box, an empty state (*"No users found."*), a `Showing 1–1 of 1 users` counter, and a five-button
   pager. Live content is now **one** user (`SuperAdmin`). Row actions are a pencil and a trash icon,
   not text buttons. All three `Role & Settings` flags — including `Is Active` — start **unticked**.
5. **§1.4 Change Password — "self-service for the back-office user"** is right, and worth adding:
   the screen states **no password rules at all**, and the third field is labelled
   `Comfirm Password`. Fields and the button: §7.
6. **§12.2 Letter Generation — "⭐ A generated letter is never deleted — only Voided."**
   Not what the screen offers. `Voided` is only a value in the status **filter**; the row's action is
   a trash button tooltipped `Delete` whose confirm says *"This will permanently delete this letter
   from history."* No `Void` control exists. Caveat and how I established it: §12.
7. **§12.1 Template Creation — the "TOTALS" group.** There is no group called TOTALS; there are three
   separate groups, **`NET SALARY TABLE`**, **`GROSS SALARY TABLE`** and **`CTC TABLE`**, one
   variable each. Also missing from the old list: every placeholder's **plain-English label**, and
   the fact that MANUAL VARIABLES are added with a `+` and read *"No manual variables yet"*.
8. **§12.1 Watermarks.** The old note writes `{CONFIDENTIAL ×2 | DO NOT COPY ×2 | DRAFT ×2 | SAMPLE |
   Custom… | Remove}`. On screen they are nine separate menu items:
   `CONFIDENTIAL 1`, `CONFIDENTIAL 2`, `DO NOT COPY 1`, `DO NOT COPY 2`, `DRAFT 1`, `DRAFT 2`,
   `SAMPLE 1`, `Custom Watermark...`, `Remove Watermark`.
9. **§12 — a whole screen is missing:** `/TemplateGeneration/TemplateSection.aspx`, the template
   library, reached from `Template List`. Twelve document-type filters, a search, a Grid/List toggle,
   four sort orders, and a per-card Export menu. §11.
10. **§0 / Dashboard — two whole screens are missing:** `/Dashboard/Dashboard.aspx` (the **Old
    Dashboard**, three tabs, eight cost tiles and eight exportable charts — §2) and
    `/Dashboard/Attendance_Data.aspx` (the 13-column drill-down behind every dashboard tile — §3).
11. **§0 Shell.** Worth adding to "how the app is built": the sidebar carries a **live 10-minute
    session countdown** that blinks amber then red, and the tab bar carries a **date filter and a
    multi-select company picker** that apply to the dashboard.
12. **§1.6 System, Auto Mail grid.** The `Email From` column shows the raw stored code (`1`), not the
    label (`Location`), so all three live rows read `1`. Each Auto Mail and Auto Job row also has a
    **`Start`** button next to `Edit`.
13. **Routes.** `/Admin/Masters.aspx`, `/Admin/User_Types.aspx` and `/Admin/System_Mst.aspx` need
    `?MenuId=85 / 3 / 87` or they answer the `Oops.aspx` error page. The add/edit pages are
    `Masters_AU.aspx`, `User_Types_AU.aspx`, `User_Master_AU.aspx` — the `X_Mst → X_AU` naming rule
    in §0 holds.

---

## In human language — every feature in this area, as points

- **One window, many tabs** — the whole system opens inside a single page, and each screen you open
  becomes a tab along the top, like tabs in a web browser. Click the red *Close* to shut them all, or
  just one. You never lose your place, because opening a new screen does not throw away the old one.
  *Job it does: an HR person hops between attendance, salary and an employee's file all day without
  reloading and re-navigating every time.*
- **A ten-minute idle clock** — a countdown sits at the bottom of the menu. If you stop touching the
  system it runs out and you are signed out. It blinks amber, then red, before it does.
  *Job it does: an unattended screen in a shared office does not stay signed in.*
- **A company switcher at the top** — a tick-list of every company in the group, with *Select All* and
  *Clear* and a search box, so the dashboard numbers can be one company, several, or all of them.
- **A date box at the top** — the same dashboard, for whichever day you choose.
- **The welcome reminder about leave** — the first thing you see each time is a reminder to carry
  people's unused leave into the new year, with a button that takes you straight to the screen that
  does it. You can close it; it comes back next time.
- **Nagging reminders that only appear when they apply** — the system will also stop you with "you
  haven't set up this year's attendance year yet", "your own email and phone number are missing", and
  a list of "employees who are 60 or over" for retirement planning.
- **An 'about this system' box** — how many employee licences are in use, the support/renewal note,
  and a plain description of what the system is.
- **Eight big numbers across the top of the dashboard** — how many employees you have, how many are
  in today, how many are absent, how many are on leave or a weekly off, how many came in late or left
  early, whose birthday it is, how many attendance machines are online, and how many overtime hours
  have built up. Each one is clickable.
- **Click any number and get the actual list of people** — the same 124-row list of names, codes,
  department, designation, shift, in-time, out-time, how late, how early, and status — and a button
  to pull that list into Excel.
- **You choose which parts of the dashboard you can see** — a settings panel with a switch for every
  tile, every chart and every card, plus *Show All*, *Hide All* and *Reset*. You can also say whether
  the number tiles sit on one line or two, and whether the small cards come four, six or eight to a
  row.
- **Shortcuts that build themselves from what you actually use** — a card of nine shortcut buttons to
  the screens you go to most. Behind the pencil icon it shows how many times you have opened each one
  (74 times, 72 times, 58 times…) and lets you pin or unpin them. *Job it does: the five screens a
  payroll clerk lives in are one click away without anyone configuring anything.*
- **It tells you which pay period you are in** — one card states the attendance year you are working
  in and the payroll month that is currently open, so nobody enters a month's data into the wrong
  month.
- **A nudge when payroll is due** — a card that says payroll is coming and links straight to it.
- **An attendance trend chart** — attendance over the last week or the last month.
- **A department-by-department scorecard** — for each of your departments: how many people, how many
  in, how many absent, how many late, how many on time, and a percentage.
- **A machine health card** — each attendance machine, whether it is online, and since when it went
  offline. On the demo both machines have been offline since June, and it says so.
- **Cards for the small things that go wrong** — today's and tomorrow's birthdays, punches somebody
  forgot to make, empty positions, holidays coming up, and a quick-stats box (on time today, new
  joiners, people who have resigned).
- **A notice board that watches for problems** — a running list of things the system spotted by
  itself: a machine that went offline, an employee absent ten days in a row, and an employee whose
  date of birth makes them under 18 with a note to check it "to comply with company policy". You can
  clear the list.
- **Fixing a forgotten punch, from the dashboard** — pick the person, the date, whether the missing
  punch was an in or an out, the time, and a reason, and add it. It also shows how many missed punches
  are still pending this month and over the last three months, and how many have been dealt with.
- **Three approval queues** — requests waiting on you: people asking to have a forgotten punch added,
  people asking for leave, and people asking for an out-duty. Each queue can be filtered by employee,
  by department, and by **which of five approval levels** the request is stuck at.
- **A second, older dashboard is still there** — reached from the settings panel. It has three tabs:
  the workforce (present, absent, on leave, department strength), diversity (male/female headcount
  and attendance), and **money** — today's wage cost, this month's, last month's, year to date, plus
  overtime cost by day, week and month, each with the change against the previous period, and eight
  charts you can save as a picture, a PDF or an Excel file. *Job it does: this is where an owner sees
  what labour is costing, not just who turned up.*
- **Data scopes ("Masters")** — you build a named bundle that says which companies, locations,
  divisions, departments, sections, cost centres, holiday groups, shift groups, categories, banks,
  leave levels, designations, pay heads, shifts, levels, document types, education types, asset types,
  machines and reporting hierarchies a back-office person may see. Then you attach that bundle to the
  person. Twenty tick-lists, each with a tick-everything box.
  *Job it does: the Vapi HR clerk sees Vapi. The group accountant sees everything. Same system.*
  ⚠️ The tick-lists only appear once the bundle exists — the "create" form is just a name and a
  location.
- **Roles, and what each role may take out of the system** — you create a role, give it a seniority
  number, and tick which formats that role may export a report in: PDF, Excel, Word, view-on-screen,
  and even print-from-the-browser. *Job it does: a junior can read the payroll report on screen and
  still not be able to walk out with the Excel.*
- **Back-office users** — a list of everyone who can sign in to the admin side, with search, a page
  size, and a delete that asks "Delete User?" first. Creating one is: a login and password, their
  name, phone and email, **which data scope** they get, which role, and three switches — is admin, is
  super admin, is active. All three switches start off.
- **Change your own password** — old, new, confirm. The screen states no rules about what makes a
  valid password.
- **A history of what people did** — every sign-in (successful and failed) with the time and the
  internet address it came from, and, alongside them, plain-English lines for the real work: this
  person changed that employee's salary, added or removed that punch on that date and time for that
  named employee, edited that employee, saved that bank / designation / shift / shift group / leave
  entry / address / education, imported employees or locations from Excel. It even records the times
  the system **refused** — "can't delete this shift, employees are still on it". Filter by a date
  range; ten rows a page.
  ⚠️ Fair warning: the search box on that screen does nothing, and the date boxes have to be typed.
- **Build your own report without waiting for the software company** — give it a name, the query it
  should run, which group it files under (employee, leave, payroll, overtime, daily/monthly/yearly
  attendance, statutory, canteen, MIS, TDS, access control), and whether it should ask the person for
  a month or for a date range.
- **Emails the system sends by itself** — birthday wishes, a "we miss you" to people who have stopped
  signing in, and a daily attendance report. Each has a subject, a time of day, and an on/off switch.
  The clever part: you do not type an email address — you say *who by role* it goes to (the location,
  the company, the user, the employee, their head of department, their reporting manager).
  All three ship switched off.
- **The overnight robot** — two scheduled jobs: collect the whole month's attendance at 2am, and
  calculate the whole month's salary at 3am. Each has an hour, a minute and an on/off switch. Both
  ship off. *Job it does: payroll can be ready before anybody arrives.*
- **A letter designer** — a proper word processor for company letters: type the letter, choose the
  paper size (A4, Letter, Legal, A5, A3 or your own), portrait or landscape, set the four margins in
  millimetres, put a border round the page (including a thick double letterhead border) in any colour,
  colour the page, add a header and a footer, choose the line spacing, drop your logo in and optionally
  repeat it on every page, and add pages. Full text formatting, tables with coloured cells and borders,
  images, links, and custom flourishes — callout boxes with a coloured left bar, section header bars,
  bordered boxes, and shading.
- **A watermark across the page** — CONFIDENTIAL, DO NOT COPY, DRAFT or SAMPLE, diagonal or straight
  across, or type your own word, or take it off.
- **Fill-in-the-blank fields for letters** — 54 ready-made blanks you drag into the letter: today's
  date, the year, the page number, the reference number, who generated it; the company's name, address,
  email, phone and website; the employee's name, code, designation, department, joining date, father's
  name, category, division, gender, email, mobile, location and reporting manager; and every pay head —
  basic, HRA, incentives, overtime, reimbursement, bonus, canteen, loan, PF, advance, ESIC, and the net
  salary, gross salary and CTC. **Plus one blank that drops the entire allowances table in, and one for
  the entire deductions table** — so the same letter works at a company with a completely different
  pay structure. You can also invent your own blanks and fill them in by hand.
- **A library of your saved letter templates** — search them, filter by document type (offer letter,
  appointment, confirmation, termination, no-dues, relieving, experience, appraisal, KRA, resignation,
  advance, offer annexure), see them as cards or a list, sort by recently changed / newest / A–Z /
  Z–A, and export or print any one of them.
  ⚠️ On the demo this library cannot load — it shows 0 templates and a database error.
- **Generating the actual letters, in four steps** — pick the document type, the template, the letter
  date and a reference number (or let it number itself), and say whether to include the header and
  footer. Then choose one employee, **or a whole batch by department and designation**. Then read the
  letters through, flicking one by one. Then generate them, and export as PDF, Word or HTML, or print.
  *Job it does: 40 appointment letters for one department in one pass, each with the right name, code
  and salary in it.*
- **A record of every letter you have ever produced** — reference number, template, employee,
  department, when it was generated, and its status (generated, exported, printed, voided), with
  preview, PDF, Word and delete buttons on each row, and a filter by status.
  ⚠️ The status list includes *voided*, but the only button on a row that removes anything says
  **Delete**, and warns it will permanently delete the letter from the history.

---

### Files
Screenshots: `.claude/capture/shots/H11/` (dashboard, dashboard drill-downs, old-dashboard tabs,
Masters Permission grid, template variables panel, template library, audit log).
