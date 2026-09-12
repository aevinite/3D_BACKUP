# H18 — HRMex 10.0.0.0: **Utility**, the **canteen module (Access Control)** and **Invoice**

Captured live on **2026-09-07** against `https://demo.hrmexweb.in`, signed in once as `Superadmin`
through the shared helper (`hrmex({ who: 'H18' })`), one page at a time.

**What I did and did not do.** Every screen below was **opened live in a real browser**. Every
dialog listed was **opened on screen** unless the line says otherwise. I pressed only reading
controls — a tab, a panel expander, a list filter (`Show` / `Refresh`), a report-type selector,
an `Edit`/`Slave` button that opens a dialog — and then closed the dialog. **I pressed no
`Execute`, no `Save`, no `Update`, no `Delete`, no `Upload`, no `Generate`, no `Start`/`Stop`, and
I moved no toggle on any payroll month.** Where a control writes, I describe the control and what
its own code says it will do; the wording quoted for confirmations is the app's own text read out
of the page, not text I triggered.

Screenshots: `.claude/capture/shots/H18/` (8 files).

---

# PART 1 — UTILITY (8 screens)

Menu group **Utility**, thirteenth-of-thirteen top menus. Note the **folder is spelt
`/Utilitty/`** with three t's — that is genuinely how the product ships it.

---

## 1.1 Device Management — `/Utilitty/DeviceManagement.aspx?MenuId=25`

**Where:** Utility → Device Management. Breadcrumb top-right reads `Home / Device Management`.

**What you see on arrival:** one blue card headed **Device List**. Its top strip is split — on the
left two pill buttons **`Active Devices`** (selected, blue) and **`Inactive Devices`** (grey); on
the right three buttons, **`Active Registration ON`** (teal, with a green `ON` badge welded into
the button), **`New Device`** (blue) and **`Refresh`** (green). Under that, a full-width blue-headed
grid of the biometric machines. Nothing else is on the page.

**Numbers/cards on the page:** none — no tiles, no counters. The only live indicators are the two
coloured pills inside each row (`Connection` and `Active Status`).

**Table — Device List** (10 columns):
`Device ID | Device Name | Type | IP Address | Company | Serial No | Last Ping | Connection | Active Status | Actions`

Live rows (2):
```
101  Sarigam  Alter  192.168.0.24   Others  QJT3244500601  30/06/2026 10:25  [Offline]  [Active]  Slave Edit Delete
102  Vapi     Alter  192.168.0.200  Others  QJT3244500598  30/06/2026 10:25  [Offline]  [Active]  Slave Edit Delete
```
`Connection` renders as a red **Offline** badge; `Active Status` as a green **Active** badge.
⚠️ The column headed **`Type`** does *not* show the Device Type (Normal/AI) — it shows the
**attendance direction** (`Alter`). Row 101 is stored as Device Type = *AI* yet the column says
`Alter`. There is no sort, no search box, no paging on this grid.

**Row actions:** `Slave` (blue) · `Edit` (blue) · `Delete` (red).

**Tabs:** `Active Devices` / `Inactive Devices`. Switching to **Inactive Devices** reloads the same
grid; the empty state is the single line **`No devices found.`** in a full-width row.

### Dialog — **Device** (opened live via `New Device`, and again via `Edit`)
Title bar `Device`, `×` at the right. Fields, in the order they appear:

| Field | Type | Default (new) | Notes |
|---|---|---|---|
| `Device Name` | text | empty | placeholder `Enter Device Name` |
| `Attndance Direction` *(sic)* | dropdown | **Alter** | **all 5 options: `Alter`, `In`, `Out`, `Canteen`, `Access Control`** |
| `Device Type` | dropdown | **Normal** | **both options: `Normal`, `AI`** |
| `Serial No` | text | empty | placeholder `Enter Serial Number` |
| `IP Address` | text | empty | placeholder `Enter IP Address` |
| `Is Attendance` | tick | **ticked** | |
| `TimeZone` | number | **330** | placeholder `Enter Time Zone` (330 = IST minutes) |
| `Device Company` | dropdown | **Others** | **all 3 options: `Others`, `HikVision`, `Dahua`** |
| `Device Status` | toggle switch | **Active** | caption under it reads **"Device is active and operational"**; the switch is titled `Click to toggle Active/Inactive` |
| `Device Password` | password | empty | placeholder `Password` |

Buttons on the dialog: **`Close`** and **`Save`**. Opened from `Edit`, the same dialog arrives
pre-filled (e.g. `Sarigam` / `QJT3244500601` / `192.168.0.24` / TimeZone 330) and **the Save button
is relabelled `Update`**; the password box comes back **blank**, it does not show a stored one.

### Dialog — **Slave devices for: \<device\>** (opened live)
Title `Slave devices for: Sarigam`. A two-column grid `☐ | Device ID | Device Name` listing the
*other* devices (here one row: `102 Vapi`) each with a tick-box, plus a tick-all box in the header.
Empty state before a master is picked: **"Select a master device and click Slave to load list."**
Buttons: `Close`, `Save`. *(A master device can therefore own slave readers — one machine's punches
roll up under another.)*

### Dialog — **Dahua Active Registration** (opened live, nothing pressed)
Reached by the `Active Registration ON` button. Contents, verbatim:
> This server listens on a dedicated TCP port. Configure Setup → Network → Platform Access on each
> Dahua device to point to this server IP and port. IIS ports (80, 443) cannot be used here — pick
> any free port (e.g. 8085).

| Field | Default |
|---|---|
| `Server IP (0.0.0.0 = all interfaces)` | `0.0.0.0` |
| `Server Port (TCP)` | `8085` |

Second note: *"Device user is admin and password is read from the saved device record
automatically."*
Buttons: **`Start`**, **`Stop`**, a circular refresh icon, `Close`.
**Live status while I looked:** the panel showed **`Running`**, and **`Connected Dahua devices:
None connected`**, with a timestamp line `Updated 9:46:50 PM` that **re-stamped itself on its own
every time I looked** (9:46:50 → 9:47:26 → 9:48:01) — i.e. the panel polls its own status while
open. I pressed neither Start nor Stop.

**Realtime/auto:** only that status poll. The device grid itself does not refresh on its own; the
`Refresh` button re-reads it.

---

## 1.2 Device Commands — `/Utilitty/Device_Commands.aspx?MenuId=67`

**Where:** Utility → Device Commands. Breadcrumb `Home / Device Commands`.

**What you see on arrival:** ⚠️ **the working half of this screen is collapsed shut.** You land on a
blue card headed just **`Device`** with a `+` and an `×` in its corner and *nothing under it*, and
below that a bare filter strip (`Device`, `Date From`, `Date To`, `Refresh`). You must click the
`Device` card header to open the screen up. That is not obvious.

**Once expanded** the card holds, top to bottom:
- `Command Name` — dropdown, **default `Reset Att Logs`**. **All 9 options, with the value each
  carries:**

  | Option (exact wording) | value | What it says it will do |
  |---|---|---|
  | `Reset Att Logs` | 9 | clear the attendance punch log held on the machine |
  | `Upload Users to Device` | 8 | push the selected people down to the machine |
  | `Restart Device` | 7 | reboot the machine |
  | `Delete User` | 6 | remove the selected person from the machine |
  | `Block User` | 5 | stop the selected person being accepted by the machine |
  | `UnBlock User` | 4 | allow them again |
  | `Enroll User Face` | 3 | start a face enrolment for one person |
  | `Enroll User Finger Print` | 2 | start a fingerprint enrolment for one person |
  | `Clear Logs From Device` | 1 | wipe the machine's log store |

  *(The dropdown does **not** post back — the page looks identical for all nine choices. What the
  command actually targets is decided when `Execute` is pressed.)*
- A **device grid** with a tick-box column: `☐ | Device ID | Device Name | Serial No | Out Time | Status` —
  live rows `101 Sarigam QJT3244500601 30/06/2026 10:25 Offline` and `102 Vapi QJT3244500598 …
  Offline`.
- **`Execute`** button. **Not pressed — a command here reaches a real machine in a real office.**

**Bottom strip — the command log filter:** `Device` dropdown (**all 3 options: `All`, `Sarigam`,
`Vapi`** — carrying the serial numbers as values), `Date From` and `Date To` (both pre-filled with
today, `07-09-2026`), and a **`Refresh`** button. I pressed `Refresh`: **no results table rendered
at all** — not an empty grid, no "no records" line, just the filter strip again. So on this demo
the log area shows nothing for today.

### Dialog — **Employee List** *(present in the page, opened by `Execute` — described from the page, not opened)*
`Search Here…` box, a grid `☐ | Device Code | Emp Code | Employee Name | Location | Company |
Division | Department | Category` (**124 people loaded**, e.g. `GPPI0001 EMP001 Test 1 Location 2
Company 2 Division 2 Marketing Category 4`), buttons `Close` and **`Execute`**.

### Dialog — **User Enrollment** *(same — in the page, opened by `Execute` on an enrol command)*
| Field | Type | Default |
|---|---|---|
| `Device` | dropdown | **`Sarigam`** — options `Sarigam`, `Vapi` |
| `Device Code` | text | empty, placeholder `Enter Device Code` |
| `FP Index No` | number | empty, placeholder `Enter Index Number` |
| `Overwite` *(sic)* | tick | unticked |

Buttons: `Close`, **`Execute`**.

**Empty state:** the command log shows nothing at all (see above). **Realtime/auto:** none.

---

## 1.3 DC (Hikvision) — `/Utilitty/Device_Commands_Hikvision.aspx?MenuId=92`

**Where:** Utility → DC(Hikvision). Page heading **`Device Commands(HikVision)`**.

Same skeleton as 1.2 — a collapsed `Device` card, then `Device` / `Date From` / `Date To` /
`Refresh`. **But opened live it is not a working twin:**
- **`Command Name` is completely empty** — the dropdown has zero options.
- The `Device` dropdown holds **only `All`** — no machines.
- **There is no device grid on the page at all** (the normal screen's `grdDevice` is absent).
- The employee grid exists behind the scenes (same 9 columns, 124 people) but nothing opens it.

That is consistent with the demo owning only two `Others`-brand machines and no HikVision one — but
as it stands the screen offers a person nothing to do.

---

## 1.4 Upload User To Device — `/Utilitty/Upload_User.aspx?MenuId=68`

**Where:** Utility → Upload User To Device. Heading `Upload User to Device`.

**What you see on arrival:** two collapsed cards, **`Filter`** and **`Device`**, then, always
visible, a `Search :` box, a row of choices, and a large employee grid. Both cards must be clicked
open.

**`Filter` card** — five dropdowns and a `Filter` button:

| Filter | Default | Complete option list |
|---|---|---|
| `Categorgy` *(sic)* | All | All, Category 1 … Category 7 |
| `Company` | All | All, Company 1, Company 2 |
| `Division` | All | All, Division 1 … Division 9 |
| `Department` | All | All, Default, Marketing, Dispatch, Production, Accounts, Loading, STORE, Maintenance, Consumables Store, HR, House Keeping, RM Store, QC, Purchase, Packing, Safety, RM & Con Store, Production Pardi, QC PARDI, Admin, IT *(22 entries)* |
| `Status` | All | All, Working, Resign |

**`Device` card** — the same tick-box device grid as 1.2:
`☐ | Device ID | Device Name | Serial No | Out Time | Status`, rows 101 Sarigam and 102 Vapi, both
`Offline`.

**What to push (the middle row of controls):**
- ☐ `List All Employees With Bio` — **off** (a filter on the grid, not a payload)
- ☑ `UserInfo` — **on by default**
- ☐ `User Pic` — off
- Then a **three-way radio, only one at a time**: `Cards` / `FingerPrints` / `Face` — **none
  pre-selected**.

**Table — employee grid** (13 columns, **173 people**):
`☐ | Device Code | Emp Code | Employee Name | Location | Company | Division | Department | Category | CardNo | Finger | Face | AI Face`

The last four are *counts held on file per person*, e.g.
`GPPI0001 EMP001 Test 1 … CardNo 0 | Finger 1 | Face 0 | AI Face 1`, and
`GPPI0011 EMP009 Test 9 … CardNo 0 | Finger 2 | Face 0 | AI Face 1`. A person with no biometrics
at all shows `0 0 0 0` (`EMP081 Test 81`). There is a tick-all box in the header and a
`Search Here…` box above the grid.

**Button:** **`Upload`**. **Not pressed.** It pushes the ticked people, in the ticked shapes, to the
ticked machines.

**Empty state:** not reachable — every filter combination I looked at still listed people.
**Realtime/auto:** none.

---

## 1.5 Blocked Employee — `/Utilitty/Block_Users.aspx?MenuId=69`

**Where:** Utility → Blocked Employee. Heading **`Block User`**.

**⚠️ Opened live, this screen is empty.** The whole page is: the breadcrumb `Home / Block User`, one
collapsed blue card headed `Device`, and a second white card with an empty body. I expanded the
`Device` card — **it has no body at all**; nothing appears. Measured on the live page: **0 visible
input fields, 0 visible buttons, 0 tables.**

The page markup does carry two dialogs — `Employee List` (search box + `Close` + `Execute`) and
`User Enrollment` (`Device` dropdown, which is also empty here, `Device Code`, `FP Index No`,
`Overwite`, `Close`, `Execute`) — but **there is no control anywhere on the screen that opens
either of them**. A person arriving here can do nothing.

*(Blocking and unblocking a person on a machine is genuinely available — as `Block User` /
`UnBlock User` on the **Device Commands** screen, 1.2.)*

---

## 1.6 Employee Import — `/Utilitty/Employee_Import.aspx?MenuId=26`

**Where:** Utility → Employee Import.

**What you see on arrival:** one card. Its header reads **`Employee Import   File Format`** —
and **"File Format" is a link**, not a label: it downloads
**`/Sample_Files/EmployeeImport.xlsx`**, the blank template. The body is three things stacked:
1. `Import Employee` — a **file picker** styled as `Choose file`.
2. A centred **`-----OR-----`**.
3. `Paste Data Here` — a **textarea**, placeholder **`Paste Data Here with Header`**. It posts back
   the moment you click out of it.
4. **`Preview`** button (blue). **Not pressed.**

Below the button sits a **fixed 300px-tall empty result area** waiting for the previewed rows.

**Dialog — `Error Occured`** *(sic)*: one large read-only-looking textarea and a `Close` button.
It is where the import's rejections are listed.

### The import template — every column it expects
I downloaded the template and read it. **45 columns, one header row, one worked example row:**

`EmpCode` · `EmpName` · `Devicecode` · `Company` · `Location` · `Division` · `Department` ·
`ShiftGroupName` · `Category` · `LevelName` · `LeaveLevelName` · `Weeklyoff` · `Designation` ·
`Section` · `CostCenter` · `Gender` · `Status` · `DOB` · `MobileNo` · `EmailAddress` ·
`JoiningDate` · `OT` · `HolidayGroup` · `DOE` · `Member ID` · `UAN` · `AadharNo` · `PanCard` ·
`ESICNUMBER` · `BankName` · `BankAC` · `IFSCCode` · `DrivingLicence` · **`BASICDA`** · `HRA` ·
`Education` · `PF` · `Advance` · `TDS` · `Bonus` · `ESIC` · `PT` · `LTA` · `EXGRATIA` ·
`Conveyance`

The template carries **7 built-in instructions** as cell notes, quoted exactly:
- `Devicecode` — *"Please enter the userID of the employee registered in the biometric device."*
- `ShiftGroupName` — *"GS : for general shift  DS : Day Shift  DN : Day Night Rotation  ABC :
  1st,2nd,3rd shift  All : All shift allowed"*
- `Category` — *"Staff Worker Contract"*
- `Weeklyoff` — *"Please enter weekdays in full (e.g., Monday, Tuesday). Leave this cell blank if
  not applicable."*
- `DOB` — *"date-month-year dd-mm-yyyy"*
- `JoiningDate` — *"date-month-year dd-mm-yyyy"*
- `OT` — *"0 : OT not applicable   1 : OT applicable"*
- `BASICDA` — *"From here starts the salary part of the employee. It can be changed according to
  the user."* — i.e. **everything from `BASICDA` rightwards is the pay structure**, and those
  columns are meant to be edited to match the client's own salary heads.

The example row shows the expected shapes: `123 / Default / 123 / Default … / Sunday / Male /
Working / 36526 (an Excel date serial = 01-01-2000) / 123456789 / default@gmail.com / 36526 / 0/1`.

**Empty state:** the result area is blank until Preview. **Realtime/auto:** none.

---

## 1.7 ⭐ Payroll Month — `/Utilitty/Payroll_Months.aspx?MenuId=70`

**Where:** Utility → Payroll Month. Breadcrumb `Home / Payroll Month`.

**What you see on arrival:** a single dark-blue card headed **`Payroll Month`**, holding one grid
and nothing else. **There is no `New` / `Add` / `Create Month` button anywhere on this screen** —
I checked every button element on the page; the only buttons that exist are one `Edit` per row.
No search, no filter, no paging, no date picker, no export.

**Table — 4 columns:** `Salary Month Name | IsLock | IsFinal | (action)`

`IsLock` and `IsFinal` render as **coloured slide switches** — green with the knob right for ON,
red with the knob left for OFF. **On the list they are display-only** (every one of them is
disabled in the page); you cannot flip a month from the list.

**Every row on the screen, exactly as it stands (15 rows, newest first):**

| Salary Month Name | IsLock | IsFinal | Action |
|---|---|---|---|
| **Aug-2026** | **OFF** | **OFF** | Edit |
| Jun-2026 | ON | ON | Edit |
| May-2026 | ON | ON | Edit |
| Apr-2026 | ON | ON | Edit |
| Mar-2026 | ON | ON | Edit |
| Feb-2026 | ON | ON | Edit |
| Jan-2026 | ON | ON | Edit |
| Dec-2025 | ON | ON | Edit |
| Nov-2025 | ON | ON | Edit |
| Oct-2025 | ON | ON | Edit |
| Sep-2025 | ON | ON | Edit |
| Aug-2025 | ON | ON | Edit |
| Jul-2025 | ON | ON | Edit |
| Jun-2025 | ON | ON | Edit |
| Dec-2024 | ON | ON | Edit |

Two things a person would notice: **Aug-2026 is the one open month**, and **there is no Jul-2026
row** — the list jumps Aug-2026 → Jun-2026. Dec-2024 sits alone below Jun-2025.

**The states a month can be in.** The screen exposes exactly two independent switches, so four
combinations: *neither* (Aug-2026 — the month being worked on), *IsLock only*, *IsFinal only*, and
*both* (every other month here). The screen never labels what either word means — there is no
legend, no tooltip, no help text on the page.

### Dialog — **`Salary Month - 2 companies found`** (opened live on two rows)
Reached by `Edit` on any row. Title bar is literally **`Salary Month - <n> companies found`**.
Inside, a small three-column grid:

`Company Name | IsLock | IsFinal`
```
Company 1   [switch]  [switch]
Company 2   [switch]  [switch]
```
Opened on **Aug-2026** all four switches are **red / OFF**. Opened on **Jun-2026** all four are
**green / ON**. So the lock is held **per company per month**, and the list's single pair of
switches is the summary of that.

**The exact wording of every control that changes a month's state** — there are only these, and I
pressed none of them:
- the **`IsLock` slide switch** on each company row — no label, no caption, no tooltip; the word
  `IsLock` is only the column header above it;
- the **`IsFinal` slide switch** on each company row — same, header word only;
- **`Close`** (the only button in the dialog's footer) and the **`×`** in the title bar.

**One honest paragraph on what this screen tells a person about reopening a finalised month.**
It tells them nothing. The screen carries no sentence about reopening — no warning, no help text,
no legend explaining `IsLock` or `IsFinal`, no note about what a locked or finalised month means
for the salary already calculated. The dialog offers **no `Save` and no `Cancel`**; its only footer
button is `Close`. Each switch is wired to submit the page **the instant it is clicked** (each one
carries its own `__doPostBack` on click), so there is no draft state, no confirmation step and no
second click to commit — the tick *is* the save. Nothing on the screen asks for a reason, and
nothing on the screen says the change was recorded anywhere. A person looking at Jun-2026, green
and green, is shown one blue `Edit` button, and behind it two switches that look exactly like the
switches used everywhere else in this product for ordinary settings.

**Empty state:** not reachable — months always exist. **Realtime/auto:** none.

---

## 1.8 Attendance Year — `/Utilitty/Att_YearCreate.aspx?MenuId=151`

**Where:** Utility → Attendance Year. Page title in the browser tab is
`Attendance Year Master - HRMex`, and ⚠️ **the breadcrumb on this one screen says `Dashboard`**
where every other Utility screen says `Home` — it is built on a slightly different shell, and it is
an **AJAX** screen (`PageMethods`), not the WebForms postback pattern used by its neighbours.

**What you see on arrival:** heading `Attendance Year Master`, one green **`Add Attendance Year`**
button top-right of the card, then a grid.

**Table — 7 columns:** `Year | Company | Start Month | End Month | Active | Carry Forward | Actions`

Every row live:

| Year | Company | Start Month | End Month | Active | Carry Forward | Actions |
|---|---|---|---|---|---|---|
| 2027 | N/A | 01 Jan 2027 | 01 Dec 2027 | Inactive | Pending | Edit Delete |
| **2026** | N/A | 01 Jan 2026 | 01 Dec 2026 | **Active** | Pending | Edit Delete |
| 2025 | N/A | 01 Jan 2025 | 01 Dec 2025 | Inactive | Pending | Edit Delete |
| 2024 | N/A | 01 Jan 2024 | 01 Dec 2024 | Inactive | Pending | Edit Delete |
| 2023 | N/A | 01 Jan 2023 | 01 Dec 2023 | Inactive | Pending | Edit Delete |
| 2022 | N/A | 01 Jan 2022 | 01 Dec 2022 | Inactive | Pending | Edit Delete |

**Exactly one year is Active (2026)**, every year reads `Carry Forward: Pending`, and **every row's
Company reads `N/A`** — the years here were created without a company against them.
⚠️ `End Month` prints as **`01 Dec 2027`** — the first of December, not the last. Start and end are
both rendered as the 1st.

### Dialog — **Add Attendance Year / Edit Attendance Year** (opened live)
The same dialog does both; the title swaps to `Add Attendance Year` or `Edit Attendance Year`.

| Field | Type | Default | Options / notes |
|---|---|---|---|
| `Company` | dropdown | `-- All Companies --` | **all 3: `-- All Companies --`, `Company 1`, `Company 2`** |
| `Year` | text | empty | placeholder `e.g. 2026` |
| `Year type` | dropdown | **`Calendar year (Jan - Dec)`** | **both: `Calendar year (Jan - Dec)`, `Financial year`** |
| `FY starts in (month)` | dropdown | `April` | **all 12: January … December.** ⚠️ **Hidden while Year type is Calendar; it appears only when you pick `Financial year`** |
| `Status` | toggle | **Active** | caption `Active Inactive` |
| `Leave Carry Forward` | toggle | **Pending** (off) | caption `Done Pending` |

The dialog also swaps its own help line as you change the year type — I watched both:
- Calendar: *"Calendar year: enter the year (1 Jan – 31 Dec)."*
- Financial: *"Financial year: enter the start year of the period (e.g. 2026 with April start =
  1 Apr 2026 to 31 Mar 2027). The table shows a short label like 2026-27."*

Buttons: **`Cancel`** and **`Save`**. Not pressed.

**`Delete`** asks first — the browser confirm reads exactly:
**"Are you sure you want to delete this attendance year?"** — `OK` / `Cancel`. It says nothing
about the leave balances or attendance that hang off that year. Not confirmed.

**Empty state:** not reachable (six years exist). **Realtime/auto:** the grid reloads itself after
a save or delete; otherwise nothing moves.

---

# PART 2 — ACCESS CONTROL: the canteen / staff-meal module

The menu is called **Access Control** and holds three settings screens. Its reports live under
**Reports** in two groups — **Canteen Report** (4 links onto one screen with 6 report types) and
**Access Control** (3 separate screens). All 10 are below.

**How a meal is recorded, end to end, as the screens describe it.** A biometric machine is given
`Attndance Direction = Canteen` (or `Access Control`) on the Device Management form — that is what
makes its punches meal punches rather than attendance punches. The canteen then runs in **one of
two modes**, chosen once on the Settings screen: **Timing Based** — a punch that lands inside a
named meal window counts as one meal of that meal's `Rate`; or **Workcode Based** — the person
enters a work code 1–9 at the machine and the code's rate applies, split into an employee share and
an employer share per staff category. Consumption and money are then read off the Canteen Report
screen, which shows a per-person **Meal Consumption** table and a per-person **Monthly Billing**
table and badges which of the two modes it is running in.

---

## 2.1 Canteen Settings — `/Canteen/Settings.aspx?MenuId=109`

**Where:** Access Control → Settings. **This is the switch that decides how the whole canteen
module behaves.**

**What you see on arrival:** one blue-headed card, `Canteen Settings`, split left/right.

**Left — `Selection Mode`** (a cog icon beside the label). Two large clickable **radio cards**,
side by side, each with an icon and a big tick-mark on the right:
- **`Timing Based`** — clock icon
- **`Workcode Based`** — briefcase icon

**Neither is selected when the screen loads.** There is no "current mode" indicator anywhere.

**Right — `Top-up Settings`** (a wallet icon). A bordered box with the heading **`Enable Top-up`**
on the left and a **slide switch on the right — off**.

**Button:** one green **`Save Settings`**. Not pressed.

**Everything else:** no explanation of what either mode means, no explanation of what Top-up does,
no per-person limit, no per-day limit, no free-meal allowance field. Choosing a mode reveals
nothing extra — the screen is exactly these three controls.

**Empty state / realtime:** neither applies.

---

## 2.2 Canteen Items *(the meal windows)* — `/Canteen/Items.aspx?MenuId=110`

**Where:** Access Control → Canteen Items. Browser tab title **`HRMex - Canteen Timings`** — inside,
the product calls these *timings*, not items.

**What you see on arrival:** two stacked cards. A **green** one, `⊕ Add New Canteen Timing`, holding
the whole add-form on a single line. Below it a **blue** one, `≡ Canteen Timings List`, holding a
DataTables grid with `Show __ entries` on the left and `Search:` on the right.

### Form — `Add New Canteen Timing` (all on one row, left to right)
| Field | Type | Default | Notes |
|---|---|---|---|
| `Meal Name` | text | empty | placeholder `e.g., Breakfast` |
| `Meal Start` | time picker | empty | placeholder `HH:mm`, **read-only — you pick, you cannot type** |
| `Meal End` | time picker | empty | placeholder `HH:mm`, read-only |
| `Rate` | number | empty | placeholder `0.00`, steps of `0.01` |
| `Gate Count` | slide switch | **OFF** (red) | |
| `Gate Start` | time picker | empty | **greyed out** until Gate Count is on |
| `Gate End` | time picker | empty | **greyed out** until Gate Count is on |
| — | — | — | green **`Save Timing`** button |

Its own checks, in the order they fire, each shown as a small warning toast titled `Validation` in
the top-right corner: **"Please enter Meal Name." → "Please enter Meal Start Time." → "Please enter
Meal End Time."** and then a rate check that refuses anything that is not a number greater than
zero. So **a rate above 0 is compulsory when you add a meal.**

### Table — `Canteen Timings List` (8 columns, every one sortable)
`MEAL NAME | MEAL START | MEAL END | RATE | GATE COUNT | GATE START | GATE END | ACTIONS`

Live rows (3, sorted by name):
```
BreakFast   07:00  10:00  NaN  [No]  -  -   ✎ 🗑
Dinner      20:00  23:30  NaN  [No]  -  -   ✎ 🗑
Lunch       11:00  15:00  NaN  [No]  -  -   ✎ 🗑
```
`GATE COUNT` prints as a grey **`No`** badge. `Gate Start`/`Gate End` print as `-` when unused.
Footer: `Showing 1 to 3 of 3 entries` with `Previous | 1 | Next`.
`Show __ entries` offers **`10`, `25`, `50`, `100`** — default **10**.

**⚠️ Every rate on this screen prints as `NaN`, and it is not a display bug.** The rate genuinely is
not stored for these three rows — each row's edit button carries `data-mealrate="null"`, and opening
the Edit dialog on `BreakFast` shows **the Meal Rate box empty**. So all three meal windows exist
with no price against them, even though the add-form refuses to save one without a price. The
Monthly Billing report multiplies count × rate.

**Row actions:** a teal **✎ (Edit)** and a red **🗑 (Delete)**, side by side.

### Dialog — `Edit Canteen Timing` (opened live on BreakFast)
Fields, all pre-filled from the row: `Meal Name` (`BreakFast`), `Meal Start Time` (`07:00`),
`Meal End Time` (`10:00`), `Meal Rate` (**empty**), `Gate Count` (off), `Gate Start Time` (empty),
`Gate End Time` (empty). Buttons: **`Cancel`** and **`Update`**. Its checks are the same three
validation toasts as the add-form.

**Delete** asks first, as a warning-styled pop-up:
title **"Delete Confirmation"**, text **"Are you sure you want to delete this timing? This action
cannot be undone."**, buttons **`Yes, delete it`** (red) and **`Cancel`**. Not confirmed.

**Empty state:** DataTables' own line would read `No data available in table`.
**Realtime/auto:** the grid reloads itself after each save/update/delete; nothing else moves.

---

## 2.3 Canteen Work Code — `/Canteen/Workcode.aspx?MenuId=111`

**Where:** Access Control → Canteen Work Code. Tab title `HRMex - Canteen Workcode`.

**What you see on arrival:** the same two-card shape — green `⊕ Add New Workcode` on top, blue
`Canteen Workcode List` below with a **`Refresh`** button in its header.

### Form — `Add New Workcode`
| Field | Type | Default | Complete option list |
|---|---|---|---|
| `Workcode` | dropdown | `Select Workcode` | **`Select Workcode`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`** — nine codes, the machine's own keys |
| `Workcode Name` | text | empty | placeholder `Enter name` |
| `Rate` | number | empty | placeholder `0.00` |
| **`Employee Contribution`** | number | empty | placeholder `0.00` |
| **`Employer Contribution`** | number | empty | placeholder `0.00` |
| `Category` | dropdown | `Select Category` | **`Select Category`, `Category 1` … `Category 7`** |

Button: green **`Save`**. Not pressed.

*This is where the subsidy is set: the full `Rate` of a meal, then how much of it the person pays
and how much the company pays, **per work code per staff category**. The same code can therefore
cost a Category 1 person one amount and a Category 5 person another.*

### Table — `Canteen Workcode List` (8 columns; the first is hidden)
`ID (hidden) | Workcode | Name | Rate | Employee Contribution | Employer Contribution | Category Name | Actions`

**Empty state, live: `No data available`** — a single centred row. **No work codes are configured
on this demo at all**, which fits the canteen being run (if at all) in Timing mode.

### Dialog — `Edit Workcode`
Same six fields as the add-form, pre-filled. Buttons **`Cancel`** and **`Update`**.

**Delete** asks first: title **"Delete Confirmation"**, text **"Are you sure you want to delete this
workcode? This action cannot be undone."**, buttons **`Yes, delete it`** / **`Cancel`**.

**Realtime/auto:** none — the `Refresh` button in the card header re-reads the list by hand.

---

## 2.4 Canteen Report — `/Reports/CanteenReport.aspx?ReportType=…`

**Where:** Reports → **Canteen Report** group. The menu shows **four** links, all landing on this one
screen with a different `ReportType`:
`Canteen Daily Report` (`Daily`) · `Canteen Monthly Report` (`MonthlyPunch`) ·
`Canteen Report With Free Meal` (`FreeMeal`) · `Canteen Monthly Detail Report` (`MonthlyDetail`).

⚠️ **The screen's own dropdown offers six, not four.** The two extra ones are the newest and the
richest, and **nothing in the Reports menu links to them** — you can only reach them by changing the
dropdown once you are already here.

**What you see on arrival:** a white card `Canteen Report` with four controls across the top, then a
collapsed **`Filter`** card, then a `Report Format` dropdown and a **`Generate`** button.

**Top controls:**
| Control | Default | Options |
|---|---|---|
| `Date From` | today (`07/Sep/2026`) | calendar picker |
| `Date To` | today | calendar picker |
| `Report Type` | whichever link you came in on | **all 6: `Monthly Billing Report`, `Meal Consumption Report`, `Canteen Monthly Detail Report`, `Canteen Report with Free Meal`, `Canteen Daily Report`, `Canteen Monthly Punch Report`** |
| `Order By` | `Emp Code` | **both: `Emp Code`, `Emp Name`** |

**`Filter` card** (collapsed on arrival) — four sub-panels, each switched on by its own tick-box in
its header, and everything inside is greyed until that box is ticked:
- **`Employee`** → `Employee Name` dropdown (`All`, then every person as `EMP001:Test 1` …
  **173 people**) and `Categorgy` *(sic)* dropdown (`All`, `Category 1`…`Category 7`).
- **`Company`** + a `Select All` box → a scrolling tick-list: `Company 1`, `Company 2`.
- **`Division`** + `Select All` → `Division 1` … `Division 9`.
- **`Department`** + `Select All` → all 21 departments (`Default`, `Marketing`, `Dispatch`,
  `Production`, `Accounts`, `Loading`, `STORE`, `Maintenance`, `Consumables Store`, `HR`,
  `House Keeping`, `RM Store`, `QC`, `Purchase`, `Packing`, `Safety`, `RM & Con Store`,
  `Production Pardi`, `QC PARDI`, `Admin`, `IT`).

**`Report Format`:** **`PDF`** (default) or **`Excel`**. **`Generate`** — not pressed.

**What each report type puts on the screen** (I switched the dropdown through all six and watched):

| Report type | What appears |
|---|---|
| **Monthly Billing Report** | an extra results card **`Monthly Billing Report`** with its own **`Print`** and **`Export`** buttons |
| **Meal Consumption Report** | an extra results card **`Meal Consumption Report`** with its own **`Export Excel`** button |
| Canteen Monthly Detail Report | nothing extra — `Generate` only |
| Canteen Report with Free Meal | nothing extra — `Generate` only |
| Canteen Daily Report | nothing extra — `Generate` only |
| Canteen Monthly Punch Report | nothing extra — `Generate` only |

So **four of the six are classic PDF/Excel documents**, and **two are live on-screen tables**.

### The two on-screen reports — their columns
*(read from the page's own table-building code, since I did not press Generate; both carry a badge
that reads **`Timing Mode`** or **`Workcode Mode`** depending on the Settings choice, plus a badge
showing the date range)*

**Meal Consumption Report — Timing mode (9 columns):**
`# | Emp Code | Employee Name | Department | Meal | Timing | Rate (₹) | Meals | Amount (₹)`

**Meal Consumption Report — Workcode mode (9 columns):**
`# | Emp Code | Employee Name | Department | Category | Avg Rate (₹) | Total Meals | Total Amount (₹) | Details`
— the `Details` cell opens a dialog.

**Monthly Billing Report — Timing mode:** one **block per person** (their code, name and department
as a header) with a small table under it: `Meal | Timing | Rate (₹) | Count | Amount (₹)`.

**Monthly Billing Report — Workcode mode (8 columns):**
`# | Emp Code | Employee | Department | Total Meals | Avg Rate (₹) | Total Amount (₹) | Detail`

**Dialog — `Day-wise Meal Detail`** (blue title bar, opened by the `Details`/`Detail` cell): a table
**`# | Date | Meal | Rate (₹) | Count | Amount (₹)`** for that one person, and a `Close` button.

**Export controls (described, not pressed):**
- `Export Excel` on Meal Consumption — writes the visible table out as a CSV; if there is no table
  it says **"No data to export."**
- `Export` on Monthly Billing — a CSV with the header
  `"Emp Code","Employee","Department","Meal","Start","End","Rate","Count","Amount"`.
- `Print` on Monthly Billing — opens a **new 900×700 browser window** with the billing blocks laid
  out for paper, each person's block kept off a page break.
None of these email anything.

**Empty state:** **`No meal records found for the selected criteria.`**, and for the billing report
**`No meal records found for <month>.`** While loading, a spinner with **"Loading meal data…"** /
**"Loading billing data…"**.

---

## 2.5 Access Control Report — Department Wise — `/Reports/Access_Control_Report.aspx`

**Where:** Reports → **Access Control** group → `Department Wise`. Heading `Access Control Report`.

**What you see:** one card, four controls on a line:
| Control | Default | Options |
|---|---|---|
| `From Date` | now, to the minute (`07-09-2026 22:10`) | date-and-time picker |
| `To Date` | now, to the minute | date-and-time picker |
| `Department` | `All` | **all 22: `All`, Default, Marketing, Dispatch, Production, Accounts, Loading, STORE, Maintenance, Consumables Store, HR, House Keeping, RM Store, QC, Purchase, Packing, Safety, RM & Con Store, Production Pardi, QC PARDI, Admin, IT** |

Buttons: **`Show`** and **`Print`**.

**Driven live.** With the default range (from-now to-now, so nothing can match) `Show` returns the
same empty screen — **no results table, and no "no records" message either**. When I widened
`From Date` to `01-01-2026` so the range genuinely covers punches, **`Show` fails**: the app leaves
the screen entirely and lands on its own error page —

> 😏 **Well, this is awkward…** · Page: `/Reports/Access_Control_Report.aspx` ·
> **"A field or property with the name 'DateTime' was not found on the selected data source."** ·
> Reference: `HRM-OOPS-DF3EB087` · buttons `Back to Home` / `Go Back`

So this report **cannot currently show a result**: empty range = blank screen, real range = error.
I did not press `Print`.

---

## 2.6 Access Control Report — Employee Wise — `/Reports/EmployeeWise_Access_Control_Report.aspx`

**Where:** Reports → Access Control → `Employee Wise`. Same heading, `Access Control Report`.

Same three-control shape, with the department swapped for a person:
`From Date` (now) · `To Date` (now) · **`Employee`** — `All`, then every person as
`EMP001:Test 1` … **173 entries**. Buttons **`Show`** and **`Print`**.

**Driven live — behaves exactly like 2.5.** Default range → blank, no message. Widened range →
the same error page: **"A field or property with the name 'DateTime' was not found on the selected
data source."**, reference `HRM-OOPS-84A97B71`.

---

## 2.7 Access Control Report — Device Wise — `/Reports/Access_Control_Report_Device.aspx`

**Where:** Reports → Access Control → `Device Wise`. Breadcrumb reads **`Device Wise Access Report`**,
the card heading reads **`Access Report`**.

| Control | Default | Options |
|---|---|---|
| `Employees` | `All` | `All` + all 173 people as `EMP001:Test 1` … |
| `Device` | `All` | **all 3: `All`, `Sarigam`, `Vapi`** |

⚠️ **This one has no date fields at all** — you cannot narrow it to a period.
Buttons: **`Show`** and **`Print`**.

**Driven live:** pressing `Show` produced **nothing** — no table appeared, no error, no empty-state
line, the page simply came back as it was. I did not press `Print`.

---

# PART 3 — INVOICE (2 screens)

## 3.1 Invoice List — `/TaxInvoice/Invoicelist.aspx?MenuId=89`

**Where:** Invoice → Invoice List. Breadcrumb `Home / Invoice List`.

**What this module invoices.** Not employees, and not anything to do with payroll. The only clue on
the screen itself is the folder it lives in (`/TaxInvoice/`) and the fact that it is scoped by a
single **Invoice Month** with no customer, no employee and no company selector at all. Read
together with the previous catalogue's note, this is **HRMex billing its own subscribers** —
the software vendor's licence invoicing, sitting inside the product. **I want to be straight about
this: the screen itself does not say so.** There is no customer name, no rate card, no licence
count and no company picker anywhere on it, so nothing on the live screen confirms who is being
invoiced.

**What you see on arrival:** a single white card with a thin blue top-border. Its header has the
title **`Invoice List`** on the left and one blue **`Generate Invoice`** button on the right. The
body has exactly three things:
- **`Invoice Month`** — a text box pre-filled **`Sep-2026`** with a calendar button beside it (a
  month picker).
- **`Show`** — a blue button.
- **`Search :`** — a full-width `Search Here...` box that filters as you type.

**Table:** ⚠️ **there is none.** No grid, no column headers, no empty-state row, no paging — the
page contains no table element at all. The `Search :` box is wired to filter a grid that does not
exist on the page.

**Driven live.** I pressed `Show` on the default `Sep-2026`: nothing appeared. I set the month back
to `Mar-2026` and pressed `Show` again: nothing appeared. **No invoice ever renders on this screen,
for any month.**

**Numbering, tax lines, print/export:** **none are present.** There is no invoice number field, no
series, no GST/tax line, no total, no PDF button, no print button, no export button, no email
button anywhere on this screen. Whatever numbering the module was meant to have is not visible here.

**Empty state:** the screen is its own empty state — it looks identical whether or not there is data.
**Realtime/auto:** none.

---

## 3.2 Invoice Generation — `/TaxInvoice/Invoicelist_AU.aspx`

**Where:** the destination of the `Generate Invoice` button on 3.1.

**Opened live by address** (I did **not** press `Generate Invoice`, since the word "Generate" on an
invoicing screen is a writing action on somebody else's system). **The page does not load.** It
redirects straight to the product's friendly error screen:

> 😏 **Oops! That page tripped over its shoelaces.**
> *Don't worry — your data is safe. Our code just took an unexpected coffee break.*
> *Even HR software needs a mental health day sometimes.*
> **ERROR DETAILS** — Page: `/TaxInvoice/Invoicelist_AU.aspx` ·
> **"Object reference not set to an instance of an object."** · Reference: `HRM-OOPS-E797476D`
> Buttons: **`Back to Home`**, **`Go Back`**
> *"If this keeps happening, tell IT with the reference code above. They speak fluent error. 😊"*

**So the Invoice module, as it stands, has no working screen:** a list that renders no list, and a
generator that errors before it draws.

---

# Corrections to the 2026-08-16 capture

These are things the old `docs/HRMEX-SCREEN-BY-SCREEN.md` §6, §10 and §11 state, checked against the
live product today. **I have not edited that file.**

1. **§6.1 Device Management — the button label.** Old: `[New Device] [Refresh] [Active Registration]`.
   Live: the button reads **`Active Registration ON`** and carries a green `ON` badge inside it, and
   the order on screen is `Active Registration ON`, `New Device`, `Refresh`. **The push server was
   also actually `Running` while I looked, with `Connected Dahua devices: None connected` and a
   status line that re-stamps itself every few seconds.** The old note described the panel as if it
   were idle.
2. **§6.1 — the device form is missing two things.** Old lists the fields but not that
   **`Device Status` is a slide switch with the caption "Device is active and operational"**, and
   not that opening the form from `Edit` **relabels `Save` to `Update`** and returns the password
   box blank.
3. **§6.1 — the grid's `Type` column.** Not previously noted: it shows the **attendance direction**
   (`Alter`), not the Device Type. Row 101 is stored as `AI` and the column still says `Alter`.
4. **§6.2 Device Commands — the screen arrives shut.** Old describes the command dropdown and grids
   as if they were on screen. **Live, the entire `Device` card is collapsed on arrival** and a person
   sees only a bare filter strip until they click the card header. Also: the command dropdown does
   **not** post back — the screen is identical for all nine commands.
5. **§6.2 — the command log.** Old: "Command log filtered by Device + Date From/To". Live, pressing
   `Refresh` renders **no table at all** — not an empty grid, not a "no records" line.
6. **§6.3 DC(Hikvision) — "same screen, HikVision variant" is wrong today.** Live, its
   **`Command Name` dropdown is completely empty (zero options)**, its `Device` dropdown holds only
   `All`, and **the device grid is absent from the page**. It offers a person nothing to do.
7. **§6.4 Upload User — the biometric choice is a radio, not tick-boxes.** Old writes
   `○ Cards / ○ FingerPrints / ○ Face` alongside the tick-boxes without saying they are **mutually
   exclusive and none is pre-selected**, while `UserInfo` **is ticked by default**. Also new: the
   employee grid holds **173 rows**, and `CardNo/Finger/Face/AI Face` are **counts** (values 0, 1, 2
   seen), not flags.
8. **§6.5 Blocked Employee — "device-level block/unblock" overstates it.** Live the screen is
   **empty**: 0 visible fields, 0 visible buttons, 0 tables, even after expanding its one collapsed
   card. Blocking is done from Device Commands instead.
9. **§6.6 Employee Import — "an Employee Import File Format help block" is not what is there.**
   **"File Format" is a download link** to `/Sample_Files/EmployeeImport.xlsx`. There is no help
   block on the page. The template's 45 columns and its 7 built-in instructions are listed in 1.6
   above — they were not in the old capture at all.
10. **§6.7 Payroll Month — the month list has moved on.** Old: "Jun-2026 back through Nov-2025 all
    show IsLock ON and IsFinal ON". Live: the list runs **Aug-2026 → Dec-2024 (15 rows)**,
    **Aug-2026 is OFF/OFF** (the open month), **there is no Jul-2026 row at all**, and the tail now
    reaches Jun-2025 plus a lone Dec-2024.
11. **§6.7 — two facts the old entry did not record.** (a) **There is no Add/New button on the
    screen** — the only button is one `Edit` per row, so a month cannot be created here. (b) The
    list's own `IsLock`/`IsFinal` switches are **disabled** (display only); they are editable only
    inside the dialog.
12. **§6.7 — the dialog has no Save.** Old says the toggles are "directly editable", which is right,
    but the dialog's only footer button is **`Close`**; each switch submits the page on click. Worth
    recording precisely, because it means there is no draft and no cancel.
13. **§6.7 — I have not repeated the old entry's closing claim.** The old text asserts what the
    absence of a confirmation *means*. My §1.7 paragraph describes only what the screen puts in front
    of a person: no legend, no help text, no Save, no reason field, a switch that submits on click.
14. **§6.8 Attendance Year — `[Delete]` does warn.** Old: "`[Delete]` is offered on closed years with
    no warning". Live it asks **"Are you sure you want to delete this attendance year?"**. The fair
    version of the old point survives: that message **says nothing about the leave balances** hanging
    off the year.
15. **§6.8 — three details to add.** The `FY starts in (month)` dropdown is **hidden until you pick
    `Financial year`**; the dialog swaps its own help sentence between the two year types (both
    quoted in 1.8); and **every row's `Company` reads `N/A`**. The old note's `End Month` observation
    (`01 Dec 2027`) is **confirmed still true**.
16. **§10 Invoice — the dead screen is worse than "an empty card".** Old: `Invoicelist_AU.aspx`
    "renders a completely empty card". Live it **does not render at all** — it redirects to the Oops
    page with *"Object reference not set to an instance of an object."* And the **Invoice List
    itself has no table element at all**; `Show` returns nothing for any month I tried.
17. **§11.2 Canteen Items — the product calls them timings.** The page title is
    **`HRMex - Canteen Timings`**, the cards are `Add New Canteen Timing` / `Canteen Timings List`,
    and the dialog is `Edit Canteen Timing`. The old heading "*(really meal windows)*" was the right
    instinct — the product agrees.
18. **§11.2 — the `NaN` rates, explained.** Confirmed still true for all three meals, and it is not
    a formatting slip: the stored rate is **null** (each row carries `data-mealrate="null"` and the
    Edit dialog opens with an empty Meal Rate), even though the add-form refuses to save a meal
    without a rate above zero.
19. **§11.2 — three fields the old entry missed.** `Gate Start`/`Gate End` are **greyed out until
    `Gate Count` is switched on**; all four time boxes are **read-only pickers**, not typed; and the
    grid is a DataTables one with `Show 10|25|50|100 entries`, a search box and `Previous | 1 | Next`.
20. **§11.3 Canteen Work Code — the list is empty.** Old describes the grid as though populated.
    Live: **`No data available`** — no work codes are configured. The `ID` column is present but
    hidden. Also new: a **`Refresh`** button sits in the list card's header.
21. **§11.3 — "six canteen report variants" needs splitting.** The **Reports menu links four**
    (`Canteen Daily`, `Canteen Monthly`, `Canteen Report With Free Meal`, `Canteen Monthly Detail`);
    the **screen's own dropdown offers six** — the two extra, `Monthly Billing Report` and
    `Meal Consumption Report`, are the newest, are the only ones that draw a live table on screen,
    and **nothing in the menu links to them**.
22. **§11.3 — "Charged via the `Canteen` deduction head; billed on the payslip" is not verifiable
    from these screens.** Nothing on Settings, Canteen Items or Canteen Work Code names a salary
    head. I opened **Master → Salary Heads** to check, and that screen is currently failing with
    *"Error loading salary heads: Invalid column name 'IsSystemGenerated'."*, so **I could not
    confirm a `Canteen` head exists.** What the canteen screens *do* show is the money split:
    `Rate`, `Employee Contribution`, `Employer Contribution`, per work code per category.
23. **§11 — three Access Control reports were never listed.** `Department Wise`, `Employee Wise` and
    `Device Wise` (2.5–2.7 above) are a separate report group and were absent from the old capture.

---

# Odd things I noticed

- **Payroll Month has no Jul-2026 row** — the list runs Aug-2026 straight to Jun-2026.
- **Payroll Month has no way to create a month** — only `Edit` per row.
- **The Payroll Month dialog has no `Save` and no `Cancel`** — only `Close`; each switch submits on click.
- **The two Access Control reports that filter by date both fail once the range covers real rows**,
  with *"A field or property with the name 'DateTime' was not found on the selected data source."*
  (references `HRM-OOPS-DF3EB087` and `HRM-OOPS-84A97B71`). With a range that matches nothing they
  return a blank screen and no message at all.
- **`Device Wise Access Report` has no date filter**, and pressing `Show` produced nothing — no
  table, no error, no empty-state line.
- **The Invoice module has no working screen**: the list draws no table for any month, and
  `Invoicelist_AU.aspx` errors before it draws (`HRM-OOPS-E797476D`).
- **Blocked Employee is a blank page** with two dialogs in it that nothing can open.
- **DC(Hikvision) has an empty command dropdown** and no device grid.
- **All three canteen meals have no rate** (`NaN` on screen, `null` underneath), while the form that
  creates them insists on one.
- **Canteen Settings loads with neither mode selected** and never shows which mode is currently in
  force.
- **Attendance Year prints `End Month` as the 1st of the month** (`01 Dec 2027`), and every row's
  `Company` is `N/A`.
- **Two Utility screens arrive with their working half collapsed** (Device Commands, Upload User),
  which reads as an empty page until you click the card header.
- **Spellings shipped in the interface:** the folder `Utilitty`, `Attndance Direction`, `Categorgy`,
  `Overwite`, `Shift Shedule`, and the Invoice generator's page title `Invoice Genration`.
- **Master → Salary Heads is currently erroring** (*Invalid column name 'IsSystemGenerated'*) — noted
  only because I opened it to answer a canteen question; it is another terminal's screen.

---

# In human language — every feature in this area, as points

**The machines side (Utility)**

- **Machine list** — A list of every fingerprint/face machine in the company: its name, where it sits
  on the office network, its serial number, when it last said hello, whether it is talking to the
  system right now, and whether it is switched on. Utility → Device Management. This is the page a
  manager opens to answer "is the reader at the Vapi gate working?"

- **Add a machine** — A form to tell the system about a new reader: what to call it, its serial
  number and network address, its brand, its time zone, and a password if the machine has one.
  Utility → Device Management → New Device. Without this the system has no idea the reader exists.

- **Say what a machine is FOR** — On the same form, one choice decides what the machine's taps mean:
  clocking in, clocking out, either one, **a canteen meal**, or a door. Utility → Device Management →
  New Device → Attndance Direction. This single choice is what turns a reader into a canteen reader.

- **Switch a machine off without deleting it** — Every machine has an on/off switch, and the list is
  split into two tabs, working machines and switched-off machines. Utility → Device Management →
  Active/Inactive tabs. Useful when a reader goes for repair.

- **Group machines under a main one** — You can nominate one machine as the main one and tie others
  to it, so several readers behave as one point. Utility → Device Management → Slave.

- **Let the machines dial in by themselves** — Instead of the system reaching out to each reader,
  the readers can call home to a listening address. There is a small panel to switch that listener
  on or off, see whether it is running, and see which readers have connected. Utility → Device
  Management → Active Registration. For offices where the readers sit behind a router.

- **Send an instruction to a machine** — Pick a machine, pick an instruction, press go. The nine
  instructions are: clear the attendance taps stored on it, push people down to it, restart it,
  remove a person from it, block a person, unblock a person, start a face enrolment, start a
  fingerprint enrolment, and wipe its log. Utility → Device Commands.

- **See what instructions were sent and when** — A history strip at the bottom of the same screen,
  filtered by machine and date range. Utility → Device Commands → bottom of the page. (On the demo
  it shows nothing.)

- **Enrol a person's finger or face from the office** — A small form that names the person's code on
  the machine and which finger slot to use, with a tick to overwrite what is already there. Utility →
  Device Commands → the enrolment box. Saves walking to the reader with the person.

- **A separate command page for one brand of machine** — There is a second, identical-looking command
  page just for HikVision readers. Utility → DC(Hikvision). On the demo it has no instructions in its
  list and no machines, so there is nothing to do on it.

- **Push a chosen group of people onto a chosen machine** — Filter people by category, company,
  division, department and whether they still work here, tick the ones you want, tick the machines
  you want, and choose what to send: their details, their photo, and either their cards, their
  fingerprints or their faces. Utility → Upload User To Device. This is how a new joiner starts
  being recognised at the gate.

- **See who has biometrics on file** — The same list shows, per person, how many cards, fingerprints
  and faces are stored. Utility → Upload User To Device. A row of zeros means that person cannot
  clock in yet.

- **A screen for blocking people at the gate** — Utility → Blocked Employee. **It is blank** — nothing
  to click. The blocking and unblocking actually happens on the Device Commands screen.

- **Bring in a whole workforce from a spreadsheet** — Either upload a file or paste rows straight in,
  press Preview, and see what would be created before anything is saved. Utility → Employee Import.
  This is how a new client's staff list gets into the system on day one instead of typing 200 people.

- **The blank spreadsheet to fill in** — A downloadable template with all 45 columns already headed,
  one worked example row, and little yellow notes on the tricky columns explaining the shift codes,
  the date format and the overtime yes/no. Utility → Employee Import → the "File Format" link in the
  card header.

- **A rejection list you can read** — If rows are refused, the reasons come back in a box you can read
  and copy, rather than one error at a time. Utility → Employee Import → the Error box.

- **The list of pay months and whether each one is closed** — Every salary month the company has run,
  newest first, each showing two states: locked, and finalised. Utility → Payroll Month. This is the
  register of "which months are we still allowed to touch".

- **Close or re-open a pay month, per company** — Click Edit on a month and you get one row per
  company with two switches each. Utility → Payroll Month → Edit. **Worth knowing before you build
  your own:** the switches save the moment you touch them, the box has no Save and no Cancel, only
  Close, nothing asks why, and nothing on the screen explains what "locked" or "finalised" means.

- **The attendance year** — The company's leave-and-attendance calendar year: which year it is, when
  it starts and ends, whether it is the current one, and whether last year's leave has been carried
  over yet. Utility → Attendance Year. Only one year is the live one at a time.

- **Calendar year or April-to-March** — When you add a year you choose between January-to-December and
  a financial year, and if you choose financial you also pick the starting month, and the screen
  explains in plain words what each choice will produce. Utility → Attendance Year → Add Attendance
  Year. Essential for Indian companies whose year runs April to March.

- **A carry-forward flag** — Each year is marked Done or Pending for whether leave balances have been
  rolled into it. Utility → Attendance Year → the Carry Forward column. On the demo every year is
  Pending, which is what the nagging pop-up at sign-in is about.

**The staff canteen (Access Control)**

- **Choose how the canteen charges** — One setting decides everything else: either meals are charged
  by the clock (a tap inside the breakfast window is a breakfast), or by a code the person keys into
  the machine. Access Control → Settings. Pick one and the reports change shape to match.

- **A wallet the staff can top up** — A single switch that turns on staff pre-paying into a canteen
  balance instead of it all coming out of the payslip. Access Control → Settings → Enable Top-up.

- **Set the meal windows and what each meal costs** — Name a meal, give it a start and end time, give
  it a price. Access Control → Canteen Items. Breakfast 07:00–10:00, Lunch 11:00–15:00, Dinner
  20:00–23:30 on the demo — though **none of the three has a price saved**, so every rate shows as
  nonsense in the list and the bill.

- **Count people through a gate at meal times** — An optional extra window per meal, with its own
  start and end, for counting who came through rather than what they ate. Access Control → Canteen
  Items → the Gate Count switch. Off for all three demo meals.

- **Edit or remove a meal window** — Pencil and bin buttons on each row, and the bin asks first and
  warns that it cannot be undone. Access Control → Canteen Items → the Actions column.

- **Meal codes with a company subsidy** — For canteens that run on codes rather than clock times:
  each code 1–9 gets a name, a full price, how much the employee pays, how much the employer pays,
  and which staff category it applies to. Access Control → Canteen Work Code. This is how a company
  gives factory staff a cheaper lunch than office staff, from the same counter. **Nothing is set up
  on the demo.**

- **Who ate what, and what it costs them** — A per-person table of meals taken with the rate, the
  count and the money, for any date range, that can be narrowed to one person, one category, chosen
  companies, divisions or departments. Reports → Canteen Report → Meal Consumption Report.

- **A month's canteen bill per person** — The same information laid out as a bill: a block per
  person listing each meal, its price, how many, and the amount, ready to be printed or sent to
  payroll. Reports → Canteen Report → Monthly Billing Report. This is the number that becomes the
  deduction on the payslip.

- **Drill into one person's month, day by day** — Click the detail link beside anyone's total and a
  box opens listing every date, which meal, the rate and the amount. Reports → Canteen Report →
  Details.

- **Take the canteen numbers away with you** — Export either report to a spreadsheet, or open the
  bill in a print-ready window laid out so nobody's block is split across two pages. Reports →
  Canteen Report → Export Excel / Export / Print.

- **Four older canteen reports as documents** — A daily one, a monthly one, a monthly detailed one,
  and one that accounts for free meals. Each comes out as a PDF or a spreadsheet rather than on
  screen. Reports → Canteen Report → the Report Type list.

- **Sort and filter any canteen report** — Order by employee code or by name, over any date range,
  narrowed to one person, one category, or any combination of companies, divisions and departments,
  with a tick-all for each. Reports → Canteen Report → the Filter panel.

- **Who went through which door** — Three door-access reports: by department, by person, and by
  machine. Reports → Access Control. **Two of the three currently fail whenever there is actually
  something to show, and the third returns nothing at all**, so this part is not usable as it stands.

**Billing the client (Invoice)**

- **A month-by-month invoice list** — Pick a month, press Show, search within the results. Invoice →
  Invoice List. **It never shows anything** — the screen has no results area at all.

- **Make an invoice** — One button in the corner of the same screen. Invoice → Invoice List →
  Generate Invoice. **The page it leads to does not open** — it lands on the error screen. So there
  is nothing here yet: no invoice numbers, no tax lines, no totals, no printing and no sending.
