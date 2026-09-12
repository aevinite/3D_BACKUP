# HRMex 10.0.0.0 — the 20 reference tables, Salary Heads, Hierarchy & Department Man power

**Captured live on `https://demo.hrmexweb.in` as Superadmin, 2026-09-07** (terminal H13).
Every screen below was **opened in a real browser** and every dialog listed was **actually opened**.
Nothing was saved, submitted, deleted or run. Where a value could only be read from the page's
markup (a panel the screen keeps hidden until a switch is turned on), it is marked
**`[markup only]`** — I did not turn anyone's switch on to see it.

**Screens in this file: 26 addresses.** The 20 reference tables + the 3 add/update pages that sit
behind them (`Company_AU`, `Category_AU`, `LeaveLevel_AU`), the Salary Heads add page
(`SalaryHeads_AU`), the **Formula Builder** (a screen the 2026-08-16 capture never found), and
Department Man power.

> Reading order if you only want the point: **§4 Salary Heads** is the engine of the whole product,
> and **§4.4 the Formula Builder** is where the money rules are actually written. The plain-English
> list is **§8**.

---

## Corrections to the 2026-08-16 capture

`docs/HRMEX-SCREEN-BY-SCREEN.md` §2.3–§2.6 was right about the *shape* of these screens and wrong
or out of date on eleven specific things. Old claim → what is there today:

| # | Old claim (2026-08-16) | What is actually there (2026-09-07) |
|---|---|---|
| 1 | "**Salary Heads** … **43 heads total**" | **63 heads.** 43 is only the *money* subset (25 Allowence + 18 Deduction). The other 20 are attendance/leave counters. Evidence: the head picker on Master Setting lists 63 (`ddlAbsentHead`, ids 1003→3052); the head picker on Manual Wages lists exactly those 43. The three grids on Category Master hold 25 + 18 + 19 = 62, the 63rd (`MD`) appearing in none of them. |
| 2 | "`LOP`" listed as a salary head (leave group) | `LOP` is **not** a salary head. It is a row in the separate **Leave Type** master (ids 3–8: PL, COFF, CL, SL, ML, LOP). The salary-head list has no LOP. |
| 3 | Salary Heads form: "the **✔ Verify** button on formula fields" | **There is no Verify button on the salary-head form.** The salary-head record holds a *name* for the formula field, not the formula. Verify lives in two other places: `[Verify Formula]` on the **Formula Builder** screen, and a `Check` link on the three formula boxes of the **Leave Level** configuration dialog (that one prints *"Verify Successful."*). |
| 4 | "**Category Master** — Fields: `Category Name`" | Massively understated. Category Master's form is the **second biggest screen in the product** — ~40 attendance/OT/weekly-off/CTC settings **plus three salary-head grids carrying every payroll formula** (Structure / Calculation / Increment) and a per-row Formula Builder. This is where money rules live, not on the Salary Heads screen. |
| 5 | "**Company Master** — (list only in demo)" | Company has a full add/update page, `/Master/Company_AU.aspx`, with 4 cards: Company Information (incl. parent-company nesting + logo), **Configuration** (which modules this company is licensed for), More Details (statutory / SMTP mail / WhatsApp API), and **TDS Deduction** (a switch per month, April→March). |
| 6 | Shift codes "`GS · NS · DS · NIS · GS1 · GS2 · GSH · GS19T · GS9T · NGS · PGSH`" (11) | **10 shifts** on the list today; `NS` is gone from Shift Master. ⚠️ `NS` still appears in the Shift Group picker's "Available Shifts" list — see §7. |
| 7 | "**Leave Level Master** — `Level Name`, `☐ Allow Quarter leave` → the leave policy grid" | Rebuilt. Edit now opens a separate page, **`/Master/LeaveLevel_AU.aspx` "Leave Level Management"**, with a `Leave Type Management` grid (`Active · Leave Type · Yearly Limit · Carry Limit · Configure`) and a per-leave-type **Leave Configuration Details** dialog of ~24 controls in 5 labelled sections. |
| 8 | Hierarchy list = 12 rows | **16 rows.** Four are new: `Store`, `Safety`, `Production Pardi`, `Marketing`. The duplicated `Loading / Unloading` row is still duplicated. |
| 9 | "**Reimbursement Master** … Name · Head · Actions (rows)" | **Zero rows** — *"No Reimbursements Found"*. And its `Reimbursement Head *` dropdown is **empty** (`-- Select Reimbursement Head --` only), so the screen cannot be used at all right now: it needs heads flagged `Is Reimbursement Head`, and the salary-head read is broken. |
| 10 | Reimbursement `Amount Source {Manual Entry \| From Payroll (Auto)}` | Correct list, but the **default is `From Payroll (Auto)`**, not Manual Entry. |
| 11 | "**Shift Master** / **Shift Group** are Master ▸ Master screens" | They are, in the menu — but their addresses are under `/Attendance/`, not `/Master/`: `Shift_Mst.aspx` and `Shift_Group.aspx`. Worth knowing when rebuilding. |

**Still true, verified again today:** the Salary Heads list is **still dead** — red toast
*"Error loading salary heads: Invalid column name 'IsSystemGenerated'."*, grid reads `1-5 of 0 items`
(§4.1). Three weeks on, unfixed.

**Filled in (never opened live in the 2026-08-16 pass):** `Company_AU`, `Category_AU` and its three
formula grids, `FormulaBuilder.aspx`, `LeaveLevel_AU`, `SalaryHeads_AU`, and the Update Man Power dialog.

---

## 1. The shape all 20 tables share — and the two generations of it

Master ▸ Master holds 20 reference tables. **They are not one design; they are two**, and you can
tell which generation a screen belongs to at a glance:

**Generation 2 (rebuilt, 11 screens)** — Location, Company, Division, Department, Section,
Designation, CostCenter, Shift, Shift Group, Holiday Group, Bank, Level, Asset, Reimbursement,
Salary Heads, Department Man power.
- A card titled *"X Master"*, a `[New X]` button top-right.
- A **search box** with a screen-specific placeholder (`Search locations...`, `Search shift groups...`).
- A **pagination bar** at the bottom: `Items per page: {5 | 10 | 13 | 15 | 25}` (default **15**;
  Reimbursement and Department Man power offer `{5 | 10 | 15 | 25}` — no 13), a count
  `1-15 of 21 items`, a page count `1 of 2 pages`, and two icon buttons `‹ ›`
  (`prevPage()` / `nextPage()`).
- Rows: the **name is itself a link** that opens the edit form, plus a pencil **Edit** and a bin
  **Delete** icon at the right.
- Add/Edit is a **Bootstrap modal**, mostly `#modal-default`, titled `New X` / `Edit X`, buttons
  `[Cancel] [Save]` (or `[Update]` when editing) and a `×`.
- Delete is a **named** confirmation — the button carries the row's own name,
  e.g. `deleteLocation(1002, 'Location 1')`.

**Generation 1 (classic ASP.NET GridView, 5 screens)** — Category, Leave Level, Hierarchy,
Document, Education.
- `Search :` label with a `Search Here...` box, no items-per-page control.
- Numbered page links (`1 2`) instead of arrows.
- `[Edit]` / `[Delete]` are grey `input` buttons, and **Delete is a raw browser dialog**:
  `confirm('Do you want to Delete ?')` — not a named confirmation.
- Add/Edit is either the same `#modal-default` (Document, Education, Leave Level name, Hierarchy)
  or a **whole separate page** (`Category_AU.aspx`, `LeaveLevel_AU.aspx`).

**Empty state:** the rebuilt screens print a two-line block inside the table —
e.g. Reimbursement Master: **"No Reimbursements Found" / "Click \"New Reimbursement\" to add your
first reimbursement."**, and the pager reads `0-0 of 0 items` / `0 of 0 pages`.

**Realtime/auto:** none of these screens move on their own. Every one of them is a plain
request/response page; no polling, no live counters.

---

## 2. The 20 reference tables, one by one

### 2.1 Location Master — `/Master/Location_Mst.aspx?MenuId=10`
**Where:** Master → Master → Location Master.
**On arrival:** card *"Location Master"*, `[New Location]` top-right, search box, 3-column grid, pager.
**Grid:** `Location Name · Print Label · Actions` — 5 rows, `1-5 of 5 items`.
**Rows:** Location 1 · Location 2 · Location 3 · Location 4 · Location 5 (print label = same text).
**Controls:** `[New Location]` → modal `#locationModal`; row pencil → same modal in Edit mode; row bin → named delete confirm.
**Modal — `Add Location` / `Edit Location`:**
| Field | Type | Placeholder | Default |
|---|---|---|---|
| `Location Name *` | text | Enter location name | empty |
| `Print Label` | text | Enter print label | empty |
| `Mail ID` | email | Enter email address | empty |
| `CC Mail ID` | email | Enter CC email address | empty |
| `Employee Short Code` | text | Enter short code | empty |

Buttons: `[Cancel] [Save Location]` (`saveLocation()`), `×`.
*Location is the top of the tree and the multi-tenancy boundary — Admin ▸ Masters Permission scopes a back-office user to one Location.*

### 2.2 Company Master — `/Master/Company_Mst.aspx?MenuId=11`
**Where:** Master → Master → Company Master.
**Grid:** `Company Name · Location · Actions` — 2 rows, `1-2 of 2 items`.
**Rows:** Company 1 → Location 1 · Company 2 → Location 2.
**Controls:** `[New Company]` and the row pencil are both plain links to the **full page**
`/Master/Company_AU.aspx?MenuId=11` (`&CompanyID=111` when editing) — Company is the one reference
table with no modal. Row bin → `deleteCompany(111, 'Company 1')`.

### 2.3 Company add/update — `/Master/Company_AU.aspx` **(never opened in the old capture)**
**Where:** Company Master → `[New Company]`, or click a company's name.
**On arrival:** four stacked cards; `[Save Company]` sits inside the first one.

**Card 1 — Company Information**
| Field | Type | Options / default |
|---|---|---|
| `Location *` | dropdown | **Location 1 · Location 2 · Location 3 · Location 4 · Location 5** (default Location 1) |
| `Is Parent Company` | checkbox | **ticked by default on New**; unticking reveals ⇩ |
| `Parent Company` | dropdown | `Select Parent Company` + every *other* company (on Company 1: `Company 2`) |
| `Company Name *` | text | — |
| `Print Label` | text | — |
| `Short Name` | text | Company 1 = `C1` |
| `Email Address` | email | Company 1 = `info@company.com` |
| `Admin Contact` | tel | Company 1 = `0000000000` |
| `Address` | textarea | Company 1 = `123 Default Street, City, Country` |
| `Emp Short Code` | text | — |
| **Info & Logo** → `Choose logo...` | file | helper text *"Recommended size 240x150 px"* |

**Card 2 — Configuration → `Enable Features:`** one radio group, five choices:
**Attendance Only · Payroll Only · Both · Canteen Only · Trio (Attendance + Payroll + Canteen)**.
Company 1 = **Both**. *This is per-company module licensing — the company row decides which halves of
the product exist for it.*

**Card 3 — More Details** — three collapsed panels. `[markup only]` (they stay closed until clicked;
I read their fields without opening someone's mail settings):
- *Other Statutory Details* — `Bank Name`, `Account No`, `LIN`, `Establishment Code`, `Reg. Cert No`, `GIR No`, `TAN`.
- *Mail Server Settings* — `Email Address (Sender)` (=`test@hrmex.in`), `CC Email`, `SMTP Host` (=`mail.hrmex.in`), `Port` (=`587`), `Encryption {None | SSL | TLS}` (=TLS), `Password` (not read — masked), `Test Email Recipient`.
- *WhatsApp API Settings* — `API Link`, `API Key`, `Source Number`, `App Name` (all empty).

**Card 4 — TDS Deduction** — a toggle per month in **financial-year order**:
`April · May · June · July · August · September · October · November · December · January · February · March`.
All 12 are **on** for Company 1. *TDS is deducted only in the months switched on here.*

### 2.4 Division Master — `/Master/Division_Mst.aspx?MenuId=35`
**Grid:** `Division Name · Print Label · Actions` — `1-9 of 9 items`.
**Rows:** Division 1 … Division 9.
**Modal `#divisionModal` — `New Division` / `Edit Division`:** `Division Name *` (text, *Enter division name*), `Print Label` (text). Buttons `[Cancel] [Save Division]` (`saveDivision()`).

### 2.5 Department Master — `/Master/Department_Mst.aspx?MenuId=12`
**Grid:** `Department Name · Print Label · Actions` — `1-15 of 21 items`, 2 pages.
**All 21 rows:** Default · Marketing · Dispatch · Production · Accounts · Loading · STORE ·
Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing ·
Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT.
**Modal `#departmentModal`:** `Department Name *`, `Print Label`. `[Cancel] [Save Department]`.

### 2.6 Section Master — `/Master/Section_Mst.aspx?MenuId=36`
**Grid:** `Section Name · Print Label · Actions` — `1-1 of 1 items`. **Row:** `Default`.
**Modal `#sectionModal`:** `Section Name *`, `Print Label`. `[Cancel] [Save Section]`.
*Section is a sub-division of Department; this demo never used it.*

### 2.7 Designation Master — `/Master/Designation_Mst.aspx?MenuId=37`
**Grid:** `Designation Name · Is HOD · Actions` — `1-13 of 60 items`, 5 pages.
`Is HOD` renders as a **disabled toggle switch** in the row (read-only indicator, not clickable there).
**All 60 rows, in list order:** Default · Operation Head · Manager Accounts & finance · Purchase
Manager · Store Manager · Maintenance manager · Dispatch Head · HR HEAD · GM Marketing ·
Sr. Sales Executive · Zonal Head · AGM Marketing · Sr. Operator · Operator · Sr. Accounts Executive ·
Sr. Slitting Operator · Accounts Executive · Jr. Operator · Slitting Operator · Sales Executive ·
Store Executive · Unloading INCHARGE · Sr. Quality Incharge · Asst. Store Manager ·
Sr. Quality Executive · Packing Supervisor · Sr. Dispatch Executive · Asst. Manager Maintenance ·
Purchase Executive · Safety Head · QC Executive · HR Executive · Sr. HR Executive ·
Commercial Officer · Plant Head · Sr. Electrician · HELPER · Office Assistant · Fitter Maintenance ·
SALES COORDINATOR EXPORT · Loading Supervisor Incharge · ELECTRICIAN · DISPATCH EXECUTIVE ·
Sr. Maintenance Executive · Qc Head · Electrical Engineer · QA Executive · Supervisor ·
Asst. Supervisor · Safety Officer Trainee · HR Generalist · Store Keeper · Asst. Trainee Operator ·
IT Support Engineer · Data Entry Operator · Driver · Trainee Operator · Shift Incharge ·
Store Incharge · Safety Officer.
**Modal `#designationModal`:** `Designation Name *` (text), **`☐ Is HOD?`** (checkbox, default off).
`[Cancel] [Save Designation]`.
*`Is HOD` is what makes a person's approvals behave as a head-of-department; `Default` is off, almost every real designation is on.*

### 2.8 Costcenter Master — `/Master/CostCenter_Mst.aspx?MenuId=38`
**Grid:** `Cost Center Name · Print Label · Actions` — `1-1 of 1 items`. **Row:** `Default`.
**Modal `#costCenterModal`:** `Cost Center Name *`, `Print Label`. `[Cancel] [Save Cost Center]`.

### 2.9 ⭐ Shift Master — `/Attendance/Shift_Mst.aspx?MenuId=39` (one of the two rule-carrying tables)
**Where:** Master → Master → Shift Master (address lives under Attendance).
**Grid:** `Shift Name · Short Name · Begin Time · End Time · Actions` — `1-10 of 10 items`.
**Modal `#shiftModal` — `New Shift` / `Edit Shift`, 5 labelled sections, 27 controls:**

```
Basic Information   Shift Name *        Short Name *  (placeholder "e.g. GS")
Shift Timing        Begin Time *        End Time *        First Half Out    Second Half In     [all type=time]
Break Settings      ☐ Enable            Break Out         Break In          ☐ Duration + Mins  [time / number]
Punch Settings      ☐ Begin Before +Mins   ☐ End After +Mins   ☐ Shift End +Mins   ☐ Grace Time +Mins
Attendance Rules    Halfday Mins   Absent Mins   Quarter Mins   Quarter Absent
                    ☐ Deduct Lunch   ☐ Next Day OT   ☐ Night Shift   Extra Dur
```
Every checkbox defaults **off**; every minutes box defaults **0**; every time box defaults empty.
Buttons `[Cancel] [Save Shift]` (`saveShift()`).

**What the rules mean:** `First Half Out` / `Second Half In` split the day for half-day marking.
`Break Out`/`Break In` (or a flat `Duration` in minutes) is unpaid break; `Deduct Lunch` takes it off
the worked total. The four Punch settings are the window in which a punch still belongs to this
shift — `Begin Before` = how many minutes early a punch counts, `End After` = how late,
`Shift End` = the hard cut-off for the whole shift, `Grace Time` = minutes of lateness forgiven.
`Halfday Mins` = work below this many minutes is a half day; `Absent Mins` = below this is absent;
`Quarter Mins` / `Quarter Absent` are the same two thresholds for quarter-day marking.
`Night Shift` + `Next Day OT` + `Extra Dur` handle a shift that crosses midnight.

**All 10 live shifts, with every rule** (`✓`=on, minutes as stored):

| Shift | Code | Begin | End | 1st Half Out | 2nd Half In | Break | Break Out–In | Dur mins | Begin Before | End After | Shift End | Grace | Halfday | Absent | Qtr | Qtr Abs | Deduct Lunch | Next Day OT | Night | Extra |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| General | GS | 09:00 | 18:00 | 12:00 | 14:00 | ✓ | 12:30–14:30 | ✓120 | ✓240 | ✓420 | ✓1400 | ✓21 | 360 | 240 | 0 | 30 | – | – | – | 0 |
| Day Shift | DS | 08:00 | 20:00 | 13:00 | 14:00 | – | 00:00–00:00 | 30 | ✓240 | ✓365 | ✓1450 | ✓21 | 370 | 254 | 0 | 0 | – | – | – | 0 |
| Night Shift | NIS | 20:00 | 08:00 | 00:00 | 00:00 | – | — | 30 | ✓240 | ✓240 | ✓1440 | ✓21 | 360 | 254 | 0 | 0 | – | – | – | 0 |
| General 1 | GS1 | 08:00 | 18:00 | 13:00 | 14:30 | – | — | 0 | ✓240 | ✓240 | ✓1400 | ✓21 | 300 | 120 | 0 | 0 | – | – | – | 0 |
| General Shift2 | GS2 | 09:00 | 19:00 | 12:00 | 14:00 | – | — | 0 | ✓240 | ✓2400 | ✓1800 | ✓21 | 395 | 254 | 0 | 0 | – | – | – | 0 |
| General Shift HOD | GSH | 09:00 | 18:00 | 12:00 | 14:30 | – | — | 0 | ✓240 | ✓660 | ✓1400 | ✓21 | 480 | 0 | 0 | 0 | – | – | – | 0 |
| GS Shift NIGHT | GS19T | 20:00 | 06:00 | 00:00 | 00:00 | – | — | 0 | ✓240 | ✓1000 | ✓1400 | ✓21 | 300 | 120 | 0 | 0 | – | – | – | 0 |
| General Night | GS9T | 21:00 | 06:00 | 01:30 | 02:30 | – | 00:30–01:00 | 0 | ✓240 | ✓300 | ✓1400 | ✓21 | 360 | 240 | 0 | 30 | – | – | – | 0 |
| NORMAL GS SHIFT | NGS | 10:00 | 20:00 | 15:00 | 15:30 | – | — | 0 | ✓240 | ✓240 | ✓2400 | ✓21 | 300 | 120 | 0 | 30 | – | – | – | 0 |
| Production General Shift HOD | PGSH | 09:00 | 18:00 | 13:30 | 14:30 | – | 12:30–14:30 | 0 | ✓240 | ✓660 | ✓1400 | – | 430 | 180 | 0 | 0 | – | – | – | 0 |

⚠️ Note what that table shows: **the two night shifts (NIS 20:00→08:00, GS19T 20:00→06:00, GS9T 21:00→06:00) do not have `Night Shift` ticked.** See §7.

### 2.10 Shift Group — `/Attendance/Shift_Group.aspx?MenuId=40`
**Grid:** `Shift Group Name · Short Name · Actions` — `1-11 of 11 items`.
**All 11 rows:** GS/GS · General 1/GS1 · Day Shift/DS · Night Shift/NIS · Day/Night/DN ·
GS-HOD/GSHOD · General Shift2/GS2 · GS Shift NIGHT/GS19T · General Night/GS9T ·
NORMAL GS SHIFT/NGS · Production General Shift HOD/PGSH.
**Modal `#modal-default` — `New Shift Group` / `Edit Shift Group`:**
- *Basic Information*: `Shift Group Name *`, `Short Name *`.
- *Shift Selection*: **two side-by-side tables**, `Available Shifts` and `Allowed Shifts`, each
  `Shift Name | Action`, moved across by a `>` / `<` button per row (`moveToAllowed(n)` /
  `moveToAvailable(n)`).
- Buttons `[Cancel] [Save]` (New) / `[Cancel] [Update]` (Edit).
**Live example — group `GS`:** Allowed = `General`, `NS`, `General Night`; Available = the other 8.
*A Shift Group is the set of shifts one employee may legally be scheduled onto — the employee record
points at a group, not at a shift.*

### 2.11 Holiday Group — `/Master/HolidayGroup_Mst.aspx?MenuId=41`
**Grid:** `Holiday Group Name · Actions` — `1-5 of 5 items`.
**Rows:** All · Default · BAKRA EID · Eid ul Fittar · specila *(sic — the demo's own typo)*.
**Modal `#modal-default` — `New Holiday Group` / `Edit Holiday Group`:** one field,
`Holiday Group Name *` (*Enter Holiday Group Name*). `[Cancel] [Save]` / `[Update]`.
*The group is only a name here — the dated holidays that belong to it are entered on
Attendance ▸ Holiday, and each employee is assigned one group.*

### 2.12 Salary Heads — see **§4** (the big one).

### 2.13 Category Master — `/Master/Category_Mst.aspx?MenuId=14` → **§5** (the second big one).
**Grid:** `Category Name` + two unlabelled action columns — 7 rows, no pager.
**Rows:** Category 1 · Category 2 · Category 3 · Category 4 · Category 5 · Category 6 · Category 7.
`[New Category]` and `[Edit]` both go to the full page `/Master/Category_AU.aspx?MenuId=14`.
Delete = `confirm('Do you want to Delete ?')`.

### 2.14 Bank Master — `/Master/Bank_Mst.aspx?MenuId=42`
**Grid:** `Bank Name · Actions` — `1-15 of 19 items`, 2 pages.
**All 19 rows:** Bank 1 … Bank 19.
**Modal `#modal-default` — `New Bank` / `Edit Bank`:** `Bank Name *` (*Enter Bank Name*). `[Cancel] [Save]` / `[Update]`.

### 2.15 Level Master — `/Master/Level_Mst.aspx?MenuId=43`
**Grid:** `Level Name · Actions` — `1-1 of 1 items`. **Row:** `Default`.
**Modal `#modal-default` — `New Level` / `Edit Level`:** `Level Name *`. `[Cancel] [Save]` / `[Update]`.
*A grading band on the employee record. Do not confuse it with **Leave Level** (§2.16) or with
`Level In Hierarchy` (§6) — three different "levels".*

### 2.16 ⭐ Leave Level Master — `/Master/LeaveLevel_Mst.aspx?MenuId=44` (the other rule-carrying table)
**Where:** Master → Master → Leave Level Master. Generation-1 grid.
**Grid:** `Leave Level Name` + 2 action columns, `Search :` box, no pager.
**All 5 rows:** Office Staff · HOD · Worker · Maintenance & QC Staff · Production Staff.
`[New Leave Level]` (`#Button1`) opens modal `#modal-default` **"Leave Level"** with just
`Level Name` (text) and `☐ Allow Quarter leave` → `[Close] [Save]`.
`[Edit]` goes to a **whole separate page**, below.

### 2.17 Leave Level Management — `/Master/LeaveLevel_AU.aspx?MenuId=44` **(rebuilt since the old capture)**
**Where:** Leave Level Master → `[Edit]` on a row.
**On arrival:** breadcrumb *Leave Level Management*, a `Configure` chip, then two blocks.
- **Leave Level Configuration** — `Leave Level Name` (text, = `Office Staff`), `☐ Allow Quarter Leave`
  (off), `[Save Configuration]`.
- **Leave Type Management** — grid `Active · Leave Type · Yearly Limit · Carry Limit · (Configure)`
  with **one row per leave type** — PL, COFF, CL, SL, ML, LOP. Every row on Office Staff:
  Active **ticked**, Yearly Limit `0`, Carry Limit `0`. Each row's last cell is a `[Configure]` button.

**`[Configure]` → dialog "Leave Configuration Details"** — this is the ~15-switches-per-leave-type
block the old capture pointed at, and it is now 24 controls in **5 named sections**. Values shown are
Office Staff → PL:

| Section | Field | Type | Office Staff / PL |
|---|---|---|---|
| **LEAVE & LIMITS** | `Leave Name` | text | `PL` |
| | `Yearly Limit` | number | 0 |
| | `☐ Is Carry Forward` | checkbox | off |
| | `Carry Limit` | number | 0 — **shown only when Is Carry Forward is ticked** `[markup only]` |
| | `Allowed After (days)` | number | **180** |
| **ACCRUAL & VISIBILITY** | `☐ Auto Deduction (Monthly)` | checkbox | off |
| | `☐ Auto Credit (Monthly)` | checkbox | off |
| | `☐ Is Visible` | checkbox | off |
| | `☐ Include WO in Leave` | checkbox | **on** |
| | `☐ Credit Leave With Formula (Yearly)` | checkbox | off |
| | `☐ Allow Negative Balance` | checkbox | off |
| | `☐ Auto Credit Opening` | checkbox | off |
| **(hourly-leave block)** `[markup only]` | `☐ Late` · `☐ MidDay` · `☐ Early` | checkbox ×3 | hidden for PL |
| | `Limit` · `Duration (Mins)` | number ×2 | hidden |
| | `Hourly Leave Restriction` | dropdown | **`Do not approve request` · `Mark Late Beyond Time Duration`** |
| **DEBIT & COFF** | `Monthly Debit Limit` | number | 0 |
| | `Batch Debit Limit` | number | 0 |
| | `Batch Debit Duration` | number | 0 |
| | `☐ Is Coff Enjoy First` | checkbox | off |
| | `Coff Expiry (days)` | number | 0 |
| **ENCASHMENT** | `☐ Is Encashable` | checkbox | off |
| | `Encash Limit` | number | shown only when Is Encashable is ticked `[markup only]` |
| | `Encash Formula` + `Check` | textarea + link | hidden `[markup only]` |
| **FORMULAS** | `Credit Formula (yearly)` + **`Check`** | textarea + link | empty |
| | `Opening Credit Formula` + **`Check`** | textarea + link | empty |

Dialog buttons: `[Close] [Update Configuration]`.
**`Check` is the formula verifier.** I clicked the one on `Credit Formula (yearly)` with the box
empty: the page answered **"Verify Successful."** — i.e. it accepts an empty formula as valid.
(The three `Check` links are `Lnkcheckencashformula`, `LnkCheckCreditFormula`,
`LnkCheckOpeningCreditFormula`.)

*A Leave Level is a complete leave policy — how much of each leave type per year, whether it carries
over and how much, when a new joiner becomes eligible, whether it accrues monthly, whether the
balance may go negative, how much may be taken in one go, when comp-off expires, and whether it can
be cashed out. Every employee points at one Leave Level; that is their whole leave entitlement.*

### 2.18 Hierarchy Master — see **§6.1**.

### 2.19 Document Master — `/Master/Doc_Mst.aspx?MenuId=45`
Generation-1 grid, `Search :` box, page links `1 2`.
**Grid:** `Document Name · Document Print Lable` *(sic)* + 2 action columns.
**All 14 rows** (page 1 then page 2):
PAN → `PAN CARD` · Aadhar → `AADHAR CARD` · Driving Liences *(sic)* → `DL` ·
Bank Passbook /Cheque book → same · OFFER LETTER → same · Appointment Letter → same ·
Termination Letter → same · Warning Letter → same · Voter Id → same · 10TH → `10TH CERTIFICATE` ·
12TH → `12TH CERTIFICATE` · GRADUATION → same · POST GRADUATION → same · DIPLOMA → same.
**Modal `#modal-default` "Document":** `Document Name` (text), `Document Print Lable` (text), `[Close] [Save]`.
*This list is exactly the set of file slots that appear in the Documents section of every employee record.*

### 2.20 Education Master — `/Master/Edu_Mst.aspx?MenuId=46`
**Grid:** `Education Name · Education Print Lable · Edu_OrderBy` + 2 action columns — 5 rows, no pager.
**All 5 rows:** Graduate Degree / Graduation / 1 · Master Degree / Master Degree / 2 ·
Diploma / Diploma / 3 · 12th / 12th / 4 · 10th / 10th / 5.
**Modal `#modal-default` "Education":** `Education Name`, `Education Print Lable`,
`Edu_order BY` *(sic — the field label is the raw column name)*. `[Close] [Save]`.
*`Edu_order BY` is the sort order the qualification appears in on the employee's Education section — 1 = highest.*

### 2.21 Asset Master — `/Master/Asset_Mst.aspx?MenuId=47`
**Grid:** `Asset Name · Actions` — `1-7 of 7 items`.
**All 7 rows:** SAMART MOBILE PHONES *(sic)* · KEYPAD MOBILE PHONES · MOTORCYCLES · SCOOTY ·
LAPTOP · DESKTOP · SIM CARD.
**Modal `#modal-default` "Asset":** `Asset Name *` (*Enter Asset Name*). `[Close] [Save]` / `[Update]` (`saveAsset()`).
*These are the kinds of company property that can be handed to a person; the employee record then adds Make, Model No, Serial No, Value and Remark.*

### 2.22 Reimbursement Master — `/Master/Reimbursement_Master.aspx?MenuId=100`
**Grid:** `Reimbursement Name · Reimbursement Head · Actions`.
**Rows: none.** Empty state: *"No Reimbursements Found / Click \"New Reimbursement\" to add your first
reimbursement."*, pager `0-0 of 0 items` / `0 of 0 pages`, `Items per page {5 | 10 | 15 | 25}`.
**Modal `#modal-default` — `New Reimbursement`:**
| Field | Type | Options / default |
|---|---|---|
| `Reimbursement Name *` | text (max 150) | *Enter reimbursement name* |
| `Print Label` | text (max 150) | *Enter print label* |
| `Reimbursement Head *` | dropdown | **`-- Select Reimbursement Head --` and nothing else** ⚠️ |
| *Configuration Options* | | |
| `☐ Enable Date Selection` | checkbox | off |
| `Date Selection Mode:` | dropdown | **`Single Date` (default) · `Date Range`** |
| `☐ Show Amount Field` | checkbox | off |
| `Amount Source:` | dropdown | `Manual Entry` · **`From Payroll (Auto)` (default)** |
| `☐ Show Kilometers Field` | checkbox | off |

Buttons `[Cancel] [Save]`.
*Reimbursement Master **designs the claim form**: one date or a date range, an amount the person types
or one payroll works out, and whether kilometres are collected (travel claims). It cannot be used
today because the head dropdown is empty — it is fed by salary heads flagged `Is Reimbursement Head`,
and that read is broken (§4.1).*

---

## 3. Where every reference table is used

Read this before rebuilding: it is the reason these 20 tables exist.

- **Location** → scopes back-office users (Admin ▸ Masters Permission); parents Company.
- **Company** → module licensing, statutory numbers, the mail sender, TDS months, headcount plan.
- **Division / Department / Section / Designation / CostCenter / Category / Level** → the posting
  block of every employee record, and the filter row of every list and report in the product
  (`All · <each row>` — I saw the same `CmbDepartment` list of 22 on five different screens).
- **Shift → Shift Group** → the employee's schedulable shifts; the shift's own thresholds decide
  present / half-day / absent / late.
- **Holiday Group** → which dated holidays a person gets.
- **Leave Level** → the person's whole leave policy.
- **Category** → the person's attendance + OT + weekly-off rules **and every salary formula**.
- **Salary Heads** → the columns of pay, attendance and leave that everything else refers to.
- **Bank** → the payment file.
- **Hierarchy** → who authenticates and who approves the person's requests.
- **Document / Education / Asset** → the file slots, qualification rows and property rows on the record.
- **Reimbursement** → the shape of a claim form.

---

## 4. ⭐ Salary Heads Master — `/Master/SalaryHeads_Mst.aspx?MenuId=13`

**Where:** Master → Master → Salary Heads.

### 4.1 What you actually see today — the screen is broken
**On arrival:** card *"Salary Heads Master"*, `[Add Salary Head]` top-right, a filter row, an empty
grid, and at the bottom a **red error line**:

> **Error loading salary heads: Invalid column name 'IsSystemGenerated'.**

The pager reads **`1-5 of 0 items` / `1 of 1 pages`**. The grid `Heads Name · Type · Order No. ·
Actions` has **no rows at all**, so there are no row actions to open. Their code asks the database
for a column the database does not have. Verified again 2026-09-07 — three weeks after the same
error was recorded on 2026-08-16.

**Filter row (all four still work, they just filter nothing):**
| Control | Options |
|---|---|
| search box | *Search salary heads...* |
| `Type:` | **`--Select--` (default) · Allowence · Deduction · Attendance · Leave · SYSTEMS** |
| `Order By:` | **`OrderNo` (default) · `Heads Name`** |
| `Sort:` | **`Ascending` (default) · `Descending`** |
| `Items per page:` | `5 · 10 · 13 · 15` (default) `· 25` |

### 4.2 The add form — `/Master/SalaryHeads_AU.aspx?MenuId=13`
`[Add Salary Head]` navigates to a full page titled **"New Salary Head"**. Buttons: `[Save]`
(`#btnSave`) and `[Cancel]` (returns to the list).

| Field | Type | Options / default |
|---|---|---|
| `Type` | dropdown | **`--Select--` · Allowence · Deduction · Attendance · Leave · SYSTEMS** |
| `Heads Name` | text | *Enter Heads Name* |
| `Print Label` | text | *Enter Print Label* |
| `Formula Field` | text | *Enter Formula Field* |
| `Order No` | number | *Enter Order No* |
| `☐ Is Gross` | checkbox | off |
| `☐ Is Visible` | checkbox | off |
| `☐ Is Basic` | checkbox | off |
| `☐ Is Time Field` | checkbox | off |
| `☐ Is CTC Component` | checkbox | off |
| `☑ Roundoff value` | checkbox | **ON by default** |
| `☑ Is Calculable` | checkbox | **ON by default** |
| `☐ Is TDS Calculable` | checkbox | off |
| `☐ Is Reimbursement Head` | checkbox | off |
| `☐ Is Reimbursement Calculable` | checkbox | off |

**There is no `✔ Verify` button on this form** — I selected each of the five Types in turn and the
form never changed: same 15 fields, same two buttons, no formula box, no verifier. The salary-head
record holds the *name* a formula may use (`Formula Field`), not a formula. Formulas live on
Category Master (§5) and are verified in the Formula Builder (§4.4).

**What the flags mean, read off how they are used elsewhere:** `Is Gross` = counts into the gross
line · `Is Basic` = this is the head other formulas treat as basic · `Is CTC Component` = part of the
CTC breakup on the employee record · `Is Time Field` = the value is minutes/hours, not rupees (OT HRS,
WorkingHrs, LateBy) · `Is Calculable` = payroll runs a formula for it instead of taking a typed number
· `Is TDS Calculable` = included in the TDS base · `Roundoff value` = round the result ·
`Is Reimbursement Head` = may be picked as the head of a reimbursement (§2.22) ·
`Is Visible` = show it on screens/slips · `Order No` = the column order everywhere.

### 4.3 All the heads — 63, read live from the head pickers
Because the list screen is dead, I read the heads from the two places the product itself lists them.
Both were live today:

**(a) `Master Setting → Absent Head / Present Head / Extra Hrs Head / PT Head / PF Head / Loan Head /
OT Hrs Head / OT Head / Bonus Head / ESIC Head`** — ten identical dropdowns, each listing **63 heads**
with their record ids. **(b) `Manual Wages → Head`** — **43 heads**, the money-only subset.
**(c) The three grids on Category Master** — 19 attendance/leave + 25 allowance + 18 deduction = 62.
**(d) The Formula Builder's Dynamic Field list** — 63 tokens over 7 pages, in id order.

Those four cross-check exactly: **63 total = 25 Allowence + 18 Deduction + 19 Attendance/Leave + 1
SYSTEMS (`MD`, the only head in none of the three grids).** 25 + 18 = the 43 money heads.

**All 63, in the product's own order — `id` · `Heads Name` · `Formula Field` (the token you type in a
formula) · Type:**

| id | Heads Name | Formula token | Type |
|---|---|---|---|
| 1003 | BASIC | `BASIC` | Allowence |
| 1004 | HRA | `HRA` | Allowence |
| 1005 | Conveyance | `Conveyance` | Allowence |
| 1006 | P | `P` | Attendance |
| 1007 | A | `A` | Attendance |
| 1009 | H | `H` | Attendance |
| 1010 | MD | `MD` | **SYSTEMS** (month days) |
| 2002 | PF | `PF` | Deduction |
| 2003 | Education | `Education` | Allowence |
| 2004 | OTHERS | `OTHERS` | Allowence |
| 2005 | PERQUISITES | `PERQUISITES` | Allowence |
| 2006 | PRODUCTION | `PRODUCTION` | Allowence |
| 2007 | PT | `PT` | Deduction |
| 2008 | TDS | `TDS` | Deduction |
| 2009 | HOME_LOAN | `HOME_LOAN` | Deduction |
| 2010 | BASICDA | `BASICDA` | Allowence |
| 2011 | VDA | `VDA` | Allowence |
| 2012 | Advance | `Advance` | Deduction |
| 2013 | Attendance Bonus | `AttBonus` | Allowence |
| 2014 | Other Deduction | `OtherDed` | Deduction |
| 3010 | OT | `OT` | Allowence |
| 3011 | OT HRS | `OTHRS` | Attendance |
| 3012 | PL | `PL` | Leave |
| 3013 | WO | `WO` | Attendance |
| 3014 | WOP | `WOP` | Attendance |
| 3015 | HP | `HP` | Attendance |
| 3016 | CL | `CL` | Leave |
| 3017 | OD | `OD` | Attendance |
| 3018 | COFF | `CO` | Leave |
| 3019 | Monthly Incentive | `MonthlyIn` | Allowence |
| 3020 | Travel Allowance | `Travel` | Allowence |
| 3021 | LTD | `LTD` | Attendance |
| 3022 | ROOM_RENT | `ROOM_RENT` | Allowence |
| 3023 | MEDICAL | `MEDICAL` | Allowence |
| 3024 | LTA | `LTA` | Deduction |
| 3025 | EXGRATIA | `EXGRATIA` | Deduction |
| 3026 | MEDICLAIM | `MEDICLAIM` | Deduction |
| 3027 | Bonus | `Bonus` | Deduction |
| 3028 | LOAN | `LOAN` | Deduction |
| 3029 | Perf. Allow | `PerfAllow` | Allowence |
| 3030 | FIX_INCENTIVE | `FIX_INCENTIVE` | Allowence |
| 3031 | WASHING_ALLOWANCE | `WASHING_ALLOWANCE` | Allowence |
| 3032 | Canteen | `Canteen` | Deduction |
| 3033 | SL | `SL` | Leave |
| 3034 | LateBy | `LateBy` | Attendance |
| 3035 | SHL | `SHL` | Attendance |
| 3036 | Salary Addition | `SalaryAdd` | Allowence |
| 3037 | Salary Deduction | `SalaryDed` | Deduction |
| 3038 | Reimbursement | `Reimbursement` | Allowence |
| 3039 | ESIC | `ESIC` | Deduction |
| 3040 | LWF | `LWF` | Deduction |
| 3041 | ExtraHRS | `ExtraHRS` | Attendance |
| 3042 | Arrears | `Arrears` | Allowence |
| 3043 | Late_Mark_Fine | `Late_Mark_Fine` | Deduction |
| 3044 | Diciplinary_Fine *(sic)* | `Diciplinary_Fine` | Deduction |
| 3045 | DLD | `DLD` | Attendance |
| 3046 | SPL | `SPL` | Attendance |
| 3047 | ML | `ML` | Leave |
| 3048 | SpecialAllowence *(sic)* | `SpecialAllowence` | Allowence |
| 3049 | WorkingHrs | `WorkingHrs` | Allowence (a time field) |
| 3050 | EPF | `EPF` | Deduction |
| 3051 | WRD | `WRD` | Allowence (working days) |
| 3052 | WD | `WD` | Allowence (a 1/0 flag — see §4.5) |

**Honesty note.** `id`, `Heads Name` and `Formula token` are read straight off live controls. **Type**
is derived: Allowence = the 25 in Category Master's Allowence grid, Deduction = the 18 in its
Deduction grid, Attendance/Leave = the 19 in its Attendance grid split by what the head plainly is
(PL/CL/SL/ML/COFF are the five that also exist as Leave Types), SYSTEMS = `MD`, the one head in no
grid. **`Order No`, `Print Label` and the 10 flags per head cannot be read while the list screen is
broken** — I have not guessed them.

**Id gaps:** 1008, 2001 and 3001–3009 are missing from the sequence. Heads have been deleted over the
life of this database; the ids are not contiguous.

### 4.4 ⭐ The Formula Builder — `/Master/FormulaBuilder.aspx`
**The old capture never found this screen.** It is where every money rule in HRMex is written.

**Where:** Master → Master → Category Master → `[Edit]` a category → the **Salary Heads** card →
`[SF]`, `[CF]` or `[IF]` on any head's row.
**On arrival:** breadcrumb *Home → Category List → Category Add and Update → Formula Builder*, then a
heading that names exactly what you are editing — **"Formula Builder For HRA Structure Formula."**
(`[CF]` gives *"...For HRA Calculation."*, `[IF]` gives *"...For HRA Increment Formula."*, and the
Attendance grid's `[CF]` gives *"...For P Calculation."*).

**Controls, in order:**
1. **`txtFormula`** — one big textarea holding the formula (HRA structure = `Result  = BASICDA  *40 /100`).
2. **`[IF Else]`** — appends an empty branch skeleton to the textarea:
   `if () ⏎ { ⏎ } ⏎ else ⏎ { ⏎ };`. It appends with no separator, so it lands straight onto the end of
   whatever is already there. *(I clicked this once to see what it does; it changes the text on screen
   only. I did not press Update, so nothing was saved.)*
3. **`[Verify Formula]`** — the validator. On HRA's existing, valid formula it printed **no message at
   all** (no toast, no dialog). Compare the Leave Level `Check` link, which does say
   *"Verify Successful."* — same job, two different behaviours.
4. **`[Update]`** — saves. **Not pressed.**
5. **"Formula Dynamic Field"** — a paged grid `Formula Name | (Use)`, **7 pages of 10**, one row per
   salary head, each with a **`[Use]`** button that drops that token into the formula. This is the
   authoritative "what may appear in a formula" list:

| page | tokens |
|---|---|
| 1 | `BASIC` `HRA` `Conveyance` `P` `A` `H` `MD` `PF` `Education` `OTHERS` |
| 2 | `PERQUISITES` `PRODUCTION` `PT` `TDS` `HOME_LOAN` `BASICDA` `VDA` `Advance` `AttBonus` `OtherDed` |
| 3 | `OT` `OTHRS` `PL` `WO` `WOP` `HP` `CL` `OD` `CO` `MonthlyIn` |
| 4 | `Travel` `LTD` `ROOM_RENT` `MEDICAL` `LTA` `EXGRATIA` `MEDICLAIM` `Bonus` `LOAN` `PerfAllow` |
| 5 | `FIX_INCENTIVE` `WASHING_ALLOWANCE` `Canteen` `SL` `LateBy` `SHL` `SalaryAdd` `SalaryDed` `Reimbursement` `ESIC` |
| 6 | `LWF` `ExtraHRS` `Arrears` `Late_Mark_Fine` `Diciplinary_Fine` `DLD` `SPL` `ML` `SpecialAllowence` `WorkingHrs` |
| 7 | `EPF` `WRD` `WD` |

### 4.5 The formula language, as precisely as the live formulas show it
It is **JavaScript**, evaluated with the head tokens pre-loaded as variables, and the answer read back
out of a variable called `Result`. Every one of these is a real formula copied off the demo today
(Category 2 and Category 3):

```js
// Structure formula — how a CTC splits into heads
Result = CTC * 50 / 100                                  // BASICDA
Result = BASICDA * 40 / 100                              // HRA
Result = CTC - (BASICDA + HRA)                           // SpecialAllowence
Result = BASICDA * 8.33 / 100                            // Bonus

// Calculation formula — what this month actually pays
if (WD == 1) { Result = (HRA/CWRD)*(P+H+PL+CL+ SL+CO+OD) }
else         { Result = (HRA/MD) *(P+WO+H+PL+CL+SL+CO+OD) };

var Gross = CBASICDA + CHRA + CSpecialAllowence + CFIX_INCENTIVE + CMonthlyIn;
if (OT == 1) {
  if (WD == 1) { Result = (Gross / CWRD / WorkingHrs) * (OTHRS / 60); }
  else         { Result = (Gross / MD  / WorkingHrs) * (OTHRS / 60); }
} else { Result = 0; }

if (PF == 1) { Result = (CBASICDA/100) * 12; if (Result > 1800) { Result = 1800 } }
else         { Result = 0; }

var gross = CBASICDA + CHRA + CSpecialAllowence + CMonthlyIn + CFIX_INCENTIVE + COT + OTHERS;
if (ESIC == 1) { Result = gross * 0.75/100; } else { Result = 0; }

Result = Math.round((gross /12)*(OTHRS/60));             // Math.* is available
Result = OtherDed;   Result = CLOAN;   Result = Canteen;  // pass a typed value straight through
```

**The rules the formulas reveal:**
- **`Result` is the output.** Assign to it; whatever it holds is the head's value.
- **`var` locals, `if/else`, arithmetic, comparison and `Math.*` all work.** Semicolons are optional.
- **A bare head token = that head's *structure* (agreed) amount** — `BASICDA`, `HRA`, `SpecialAllowence`.
- **`C` + head token = that head's *calculated* amount in this same run** — `CBASICDA`, `CHRA`,
  `CSpecialAllowence`, `CFIX_INCENTIVE`, `CMonthlyIn`, `COT`, `CLOAN`, `CBASIC`. **This is how one head
  refers to another**, and it is what forces `Order No` to matter: a head can only read `C…` of a head
  calculated before it.
- **`CTC`** is available in structure formulas even though it is not a head.
- **Attendance counters come in as numbers of days** — `P` present, `H` holiday, `WO` weekly off,
  `HP` half-day present, `PL`/`CL`/`SL`/`ML` leave days, `CO` comp-off, `OD` on-duty, `OTHRS` overtime
  minutes, `WorkingHrs` hours in a shift.
- **`MD` = days in the month, `WRD` = working days, `CWRD` = calculated working days.**
- **Some tokens act as 1/0 switches, not amounts** — `WD` ("pay by working days?"), `PF`, `ESIC`, `OT`
  ("is this deduction/allowance applicable to this person?"). The same word is both a head and a flag.
- Formulas are **per category**, so a factory worker and an office staffer can compute HRA differently
  from the same head.

⚠️ The demo's own live formulas contain typos the product accepted and saved — `Resul=Reimbursement`
(missing `t`, so `Result` is never set), the `WD` head computing `Result = WRD;`, and
`var gross = BASIC + HRA` with no semicolon before the next statement. See §7.

---

## 5. Category Master's add/update page — `/Master/Category_AU.aspx?MenuId=14`
**(the old capture recorded this as one field; it is the second-largest screen in the product)**

**Where:** Master → Master → Category Master → `[New Category]` or `[Edit]`.
**On arrival:** breadcrumb *Home → Category List*, then **two cards**.

**Card 1 header — "Category Master"**, with two links in the header bar:
- **`[Import Settings]`** (`#LnkImportSettings`) — on the edit page. Clicked it: the page posted back
  and **nothing visible happened** (no dialog, no panel, no message). See §7.
- **`[Category Copy]`** (`#CopyCategory`) — **on the New page only**. Opens modal `#modal-default`
  "Category": `Category Name`, `Category Print Label`, `Category` (dropdown: **Category 1 · Category 2
  · Category 3 · Category 4 · Category 5 · Category 6 · Category 7**, default Category 1), `[Save]`
  / `[Close]`. *Clone an existing category's whole rule set under a new name.*

**Card 1 body — ~40 controls. Full list with type, options and Category 1's live values:**

| Field | Type | Options | Category 1 | Category 2 |
|---|---|---|---|---|
| `Category Name` | text | | Category 1 | Category 2 |
| `Print Lable` *(sic)* | text | | Category 1 | |
| `Employee Short Code` | text | | empty | |
| `OT Assign` | dropdown | **Category wise · Employee wise** | Category wise | |
| `OT` | dropdown | **Applicable · Not Applicable** | Applicable | Applicable |
| `OT Formula` | dropdown | **Total Duration from Shift Start-Shift Hrs · Total Duration-Shift Hrs · Out Punch-Shift EndTime · Early Coming+Late Going** | Out Punch-Shift EndTime | Total Duration-Shift Hrs |
| `Min OT` | number | | 0 | |
| `Max OT` | number | | 0 | |
| `OT Round off` | number | | 0 | |
| `☐ Roundoff overtime` | checkbox | | **on** | |
| `☐ Extra Working Hrs` | checkbox | | **on** | |
| `☐ Convert Duration to Extra Work if less than Absent Minutes` | checkbox | | **on** | |
| `☐ Convert Duration to OT if less than Absent Minutes` | checkbox | | off | |
| `WO Assign` | dropdown | **Category wise · Employee wise** | Employee wise | |
| `Weekly off` | dropdown | **Sunday · Monday · Tuesday · Wednesay *(sic)* · Thursday · Friday · Saturday · No WO · Indivisual *(sic)*** | Monday | No WO |
| `☐ Mark WO absent if Prefix and Sufix day Absent` | checkbox | | off | |
| `☐ Mark Holiday absent if Prefix and Sufix day Absent` | checkbox | | off | |
| `☐ Alter Punch Deduction` | checkbox | | off | |
| `☐ 2nd WO` | checkbox | | off | |
| `Weeklyoff 2` | dropdown | **Sunday · Monday · Tuesday · Wednesay · Thursday · Friday · Saturday** (no "No WO") | Sunday | |
| `☐ First ☐ Second ☐ Third ☐ Fourth ☐ Fifth` | 5 checkboxes | which weeks the 2nd WO applies | all off | |
| `Half/Full Day Assign From` | dropdown | **Category wise · Shift wise** | Category wise | |
| `Halfday Mins` | number | | 0 | 520 |
| `Absent Mins` | number | | 0 | 240 |
| `☐ Holiday Separte Minutes` *(sic)* | checkbox | | off | |
| `☐ Holiday Separate OT` | checkbox | | off | |
| `☐ is Payroll Category` | checkbox | | **on** | on |
| `☐ Continuous Late/Early Deduction` | checkbox | | off | |
| `☐ Auto Action for Multiple Late / Early` | checkbox | | off | |
| `Late / Early Days` | number | | 30 | |
| `Deduct` | dropdown | **Halfday · Absent** | Halfday | |
| `☐ Flexible to Complete Shift Duration` | checkbox | | off | |
| `☐ Set Salary from CTC` | checkbox | | off | |
| `☐ Convert Duartion of More Than Half Day To` *(sic)* | checkbox | | off | |
| `☐ Master WO as Default for Attendance` | checkbox | | **on** | |
| `Round Total Dur` | number | | 0 | |
| `☐ Is One Punch Present` | checkbox | | off | |

Button: `[Save]` on New, `[Update]` on Edit.

**Card 2 header — "Salary Heads"**, with one header link **`[Import Formula]`** (`#LnkFormulaImport`)
— copies a formula set in from elsewhere. Clicked it: posted back, **nothing visible happened** (§7).

**Card 2 body — three grids. This is the formula table of the whole product.**

**Grid A — Attendance** (`Heads Name · Structure Formula · Calculation Formula · [CF] · [UE]`), 19 rows:
`P · A · H · OT HRS · PL · WO · WOP · HP · CL · OD · COFF · LTD · SL · LateBy · SHL · ExtraHRS · DLD ·
SPL · ML`. Each row has a tick box (is this counter used by this category?), the two formula cells,
and two buttons — no `Check`, no `SF`, no `IF`.

**Grid B — Allowence** (`Heads Name · Structure Formula · Calculation Formula · Increment Formula ·
[Check] · [SF] · [CF] · [IF] · [UE]`), 25 rows:
`BASIC · HRA · Conveyance · Education · OTHERS · PERQUISITES · PRODUCTION · BASICDA · VDA ·
Attendance Bonus · OT · Monthly Incentive · Travel Allowance · ROOM_RENT · MEDICAL · Perf. Allow ·
FIX_INCENTIVE · WASHING_ALLOWANCE · Salary Addition · Reimbursement · Arrears · SpecialAllowence ·
WorkingHrs · WRD · WD`.

**Grid C — Deduction** (same 9 columns), 18 rows:
`PF · PT · TDS · HOME_LOAN · Advance · Other Deduction · LTA · EXGRATIA · MEDICLAIM · Bonus · LOAN ·
Canteen · Salary Deduction · ESIC · LWF · Late_Mark_Fine · Diciplinary_Fine · EPF`.

**The five row buttons:**
| Button | What it does |
|---|---|
| `[Check]` | verifies the row's formula in place (Allowence/Deduction only) |
| `[SF]` | opens **Formula Builder** for this head's **Structure Formula** |
| `[CF]` | opens **Formula Builder** for this head's **Calculation** |
| `[IF]` | opens **Formula Builder** for this head's **Increment Formula** |
| `[UE]` | posts back (`EditData2$n`) and **stays on the same page with nothing visibly changed** — I could not establish what it does and am not guessing (§7) |

**Which heads each category actually switches on** — the demo's own worked examples:

| Category | Attendance on | Allowence on | Deduction on | Weekly off | OT formula | Halfday / Absent mins |
|---|---|---|---|---|---|---|
| Category 1 | 0 | 0 | 0 | Monday | Out Punch-Shift EndTime | 0 / 0 |
| Category 2 | 13 | 11 | 7 | No WO | Total Duration-Shift Hrs | 520 / 240 |
| Category 3 | 8 | 4 | 6 | | | |
| Category 4 | 12 | 9 | 5 | | | |
| Category 5 | 13 | 10 | 6 | | | |
| Category 6 | 12 | 10 | 6 | | | |
| Category 7 | 11 | 9 | 5 | | | |

**Category 2 in full** — Attendance on: `P A H OT HRS PL WO WOP HP CL OD COFF SL ML`;
Allowence on: `HRA OTHERS BASICDA OT Monthly Incentive FIX_INCENTIVE Reimbursement SpecialAllowence
WorkingHrs WRD WD`; Deduction on: `PF Advance Other Deduction Bonus LOAN Canteen ESIC`.
Its formulas are the ones quoted in §4.5.
**Category 1 has every head switched off and every formula blank** — it is an unused placeholder, and
that is why the Formula Builder cannot be reached from it: `[SF]` on an un-ticked row does nothing.

---

## 6. Hierarchy Master & Department Man power

### 6.1 Hierarchy Master — `/Master/Hierarchy_Mst.aspx?MenuId=94`
**Where:** Master → Master → Hierarchy Master. Generation-1 grid, no search box, no pager.
**On arrival:** breadcrumb, card *"Hierarchy Master"*, sub-card *"Hierarchy List"*, `[New Hierarchy]`
(`#BtnAdd`), grid `Hierarchy Name` + `[Edit]` `[Delete]`.
**All 16 rows:** Admin · Default · Accounts · RM Store · PRODUCTION · MAINTENANCE · Purchase · HR ·
Dispatch · **Loading / Unloading · Loading / Unloading** ⚠️ (two identical rows) · QC · Store ·
Safety · Production Pardi · Marketing.

**Modal `#modal-default` "Hierarchy" — 19 controls:**
| Field | Type | Options |
|---|---|---|
| `Hierarchy Name` | text | |
| `☐ Allow Approval Before Authentication?` | checkbox | off |
| `☐ is L1 Authentication Required?` | checkbox | off |
| `Level1 Authenticator1` / `Level1 Authenticator2` | 2 dropdowns | `-- Select --` + **EMP003:Test 3 · EMP015:Test 15 · EMP023:Test 23 · EMP044:Test 44 · EMP047:Test 47 · EMP049:Test 49 · EMP057:Test 57 · EMP061:Test 61 · EMP062:Test 62 · EMP065:Test 65 · EMP081:Test 81 · EMP082:Test 82 · EMP158:Test 158 · EMP138:Test 138** (14 people) |
| `☐ is L2 Authentication Required?` | checkbox | off |
| `Level2 Authenticator1 / 2` | 2 dropdowns | `-- Select --` only — **empty** ⚠️ |
| `☐ is L3 Authentication Required?` | checkbox | off |
| `Level3 Authenticator1 / 2` | 2 dropdowns | `-- Select --` only — empty |
| `☐ is L4 Authentication Required?` | checkbox | off |
| `Level4 Authenticator1 / 2` | 2 dropdowns | `-- Select --` only — empty |
| `Approver 1` · `Approver 2` · `Approver 3` · `Approver 4` | 4 dropdowns | `-- Select --` + **EMP066:Test 66 · EMP095:Test 95** (2 people) |

Buttons `[Close] [Save]`.
*The dropdowns are populated from the employee records: an **authenticator** list per level and a
separate **approver** list. Only people marked at that `Level In Hierarchy` on their own record show
up — which is why L2–L4 are empty here: nobody in this demo is marked L2 or above.*

**Live example — the `Admin` hierarchy:** L1 required **on**; L1 Authenticator1 = `EMP081:Test 81`,
Authenticator2 = `EMP082:Test 82`; L2/L3/L4 off and unset; Approver 1 = `EMP066:Test 66`,
Approver 2 = `EMP095:Test 95`, Approvers 3–4 unset; `Allow Approval Before Authentication?` off.

**How the ladder works.** Two names per level so one person's absence cannot stall the queue —
either authenticator can act. Up to four **authentication** levels (L1→L4, the checks) then up to four
**approvers** (the decisions). `Allow Approval Before Authentication?` lets an approver sign off before
the lower checks are done — the escape hatch for an urgent request. The employee record carries two
matching fields, `Hierarchy Group` (which of these 16 rows applies to them) and
`Level In Hierarchy` (`General, L1…L5` — where *they* sit, i.e. what they can authenticate).

### 6.2 Department Man power — `/Master/Department_Designations.aspx?MenuId=48`
**Where:** Master → Master → Department Man power.
**On arrival:** card *"Department Designations"*, `[Update Man Power]` top-right,
`Search department designations...`, a 5-column grid, pager `1-15 of 42 items` / `1 of 3 pages`,
`Items per page {5 | 10 | 15 | 25}`.
**Grid:** `Company Name · Department Name · Designation Name · Male · Female` — all five headers are
sortable. **No row actions at all** — the only way to change a number is the top button.

**All 42 rows.** One row is `Company 1 · Marketing · Default · 1 male · 0 female`; the other 41 are all
`Company 2 · Accounts · <designation>`:
Accounts Executive 0/1 · AGM Marketing 2/0 · Asst. Manager Maintenance 2/0 · Asst. Store Manager 1/0 ·
Asst. Trainee Operator 1/0 · Data Entry Operator 1/0 · Default 1/0 · DISPATCH EXECUTIVE 1/0 ·
Dispatch Head 1/0 · **ELECTRICIAN 10/0** · Fitter Maintenance 3/0 · GM Marketing 1/0 ·
HR Executive 1/0 · HR Generalist 1/0 · IT Support Engineer 1/0 · **Jr. Operator 12/0** ·
Maintenance manager 1/0 · Manager Accounts & finance 1/0 · Operation Head 1/0 · **Operator 8/0** ·
Packing Supervisor 1/0 · Purchase Executive 0/1 · Purchase Manager 1/0 · QA Executive 3/0 ·
QC Executive 2/0 · Qc Head 1/0 · Safety Head 1/0 · **Sales Executive 0/4** · Slitting Operator 1/0 ·
Sr. Accounts Executive 1/0 · Sr. Electrician 1/0 · Sr. HR Executive 1/0 · Sr. Operator 3/0 ·
Sr. Quality Executive 1/0 · Sr. Quality Incharge 1/0 · Sr. Sales Executive 1/0 ·
Sr. Slitting Operator 1/0 · Store Executive 2/0 · Store Manager 1/0 · Unloading INCHARGE 1/0 ·
Zonal Head 2/0.

**`[Update Man Power]` → modal `#modal-default` "Update Man Power":**
| Field | Type | Options |
|---|---|---|
| `Company` | dropdown | `-- Select Company --` · **Company 1 · Company 2** |
| `Department` | dropdown | `-- Select Department --` · **Default · Marketing · Dispatch · Production · Accounts · Loading · STORE · Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing · Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT** (all 21) |
| grid `tblDesignations` | table | `Designation Name · Male · Female` — **empty until a company and department are chosen**; then one editable row per designation |

Buttons: `[Close]` only (the save button appears with the grid).
*This is the **sanctioned** headcount — how many men and women each designation in each department is
budgeted for. Actual headcount comes from the employee records; the dashboard's "Department Vacancies"
tile is plan minus actual.*

---

## 7. Odd things I noticed

1. **Salary Heads Master has been dead for at least three weeks** — *"Error loading salary heads:
   Invalid column name 'IsSystemGenerated'."* The list reads `1-5 of 0 items`. The add form still
   works, so heads can be created but not seen or edited. The same product build is running code
   ahead of its own database.
2. **Reimbursement Master is unusable as a consequence** — zero rows, and its required
   `Reimbursement Head *` dropdown offers only the placeholder, because it is fed by heads flagged
   `Is Reimbursement Head`.
3. **A shift exists that Shift Master does not list.** `NS` appears in the Shift Group picker's
   "Available Shifts" and is one of the three shifts allowed in the `GS` group, but Shift Master shows
   only 10 shifts and `NS` is not among them.
4. **None of the three night shifts has `Night Shift` ticked.** NIS (20:00→08:00), GS19T (20:00→06:00)
   and GS9T (21:00→06:00) all cross midnight with `Night Shift` and `Next Day OT` off.
5. **Hierarchy Master has two identical `Loading / Unloading` rows** — recorded on 2026-08-16, still
   there.
6. **The demo's own saved formulas contain typos the product accepted**: `Resul=Reimbursement`
   (`Result` never assigned, so that head can only come out blank/0), the `WD` head computing
   `Result = WRD;`, and `var gross = BASIC + HRA` with no terminator before the next statement.
7. **`[Import Settings]` (Category edit), `[Import Formula]` (Category edit) and `[UE]` (every
   formula row) all post back and change nothing visible.** Three controls I opened and could not
   attribute a behaviour to. I did not tick a head or save anything to force them.
8. **`[Verify Formula]` on the Formula Builder printed no message** on a valid formula, while the
   equivalent `Check` link on the Leave Level dialog said *"Verify Successful."* — and that one said it
   about an **empty** formula box.
9. **Two verify paths, two answers, and no formula box on the screen named "Salary Heads"** — the
   product's naming points you at the wrong screen. Anyone rebuilding this should put the formula on
   the head, or at least name the Category screen for what it holds.
10. **Spelling in shipped labels and data**: `Print Lable`, `Edu_order BY`, `Wednesay`, `Indivisual`,
    `Holiday Separte Minutes`, `Convert Duartion of More Than Half Day To`, `Driving Liences`,
    `SAMART MOBILE PHONES`, `specila`, `Diciplinary_Fine`, `SpecialAllowence`, `Allowence`. The
    misspellings are in the **formula tokens** too, so they cannot simply be corrected later.
11. **Delete is safer on the rebuilt screens than the old ones.** Generation 2 confirms with the row's
    own name; Generation 1 (Category, Leave Level, Hierarchy, Document, Education) uses a bare browser
    `confirm('Do you want to Delete ?')` with no name in it. Hierarchy Master's delete has **no
    confirmation wired at all** in the markup.
12. **Two different meanings of "Level"** (Level Master, Leave Level Master, `Level In Hierarchy`) and
    two different meanings of several heads (`WD`, `PF`, `ESIC`, `OT` are each both an amount and a
    1/0 flag inside formulas). Both are real traps for a rebuild.

---

## 8. In human language — every feature in this area, as points

- **A list of your offices (Location Master)** — you write down each office or plant once. Master menu
  → Location Master. Everything else in the system hangs under an office, and a back-office user can
  be limited to just one of them, so a branch manager never sees another branch's people.
- **A list of your companies (Company Master)** — each legal company you run, sitting under an office.
  Master menu → Company Master. This is what appears on payslips and reports as "who is paying you".
- **Companies inside companies** — a company can be marked as the parent and others placed under it,
  so a group with subsidiaries stays one system instead of five.
- **Turning halves of the product on per company** — inside a company you pick one of: attendance
  only, payroll only, both, canteen only, or all three. Master → Company Master → open a company →
  Configuration. A client who only wants attendance never sees payroll at all.
- **Your company's official numbers in one place** — bank account, labour identification number,
  establishment code, registration certificate, TAN. Kept on the company so every statutory report
  can print them without anyone re-typing.
- **The company's own email account** — the mail server, port, encryption, sender address and a test
  recipient. This is what payslip emails actually go out through, so payslips arrive from your
  address, not the software's.
- **WhatsApp sending details** — space for a WhatsApp business connection per company, so messages to
  staff can go out on WhatsApp instead of email.
- **Your company logo on documents** — upload a logo (240×150 pixels suits it) and it appears on the
  paperwork the system prints.
- **Choosing which months tax comes out** — a switch per month from April to March. Turn a month off
  and income tax is not deducted that month. Useful when tax is settled in a lump at year end.
- **A list of your divisions, departments and sections (three tables)** — three levels of "which part
  of the business", from broad to narrow. Master menu → Division / Department / Section Master. Every
  person sits in one of each, and every list and report in the product can be filtered by them.
- **A list of job titles (Designation Master)** — the 60-odd roles people hold, from Operation Head to
  Driver. Master menu → Designation Master.
- **Marking a job title as a department head** — one switch on a job title. It changes how that
  person's approvals behave, so you set it once on the title instead of on every person who holds it.
- **A list of cost centres (Costcenter Master)** — the accounting bucket a person's salary is charged
  to, so finance can see what each part of the business really costs.
- **A list of grades (Level Master)** — a seniority band you can put on a person, for reports and
  policies that go by grade.
- **Working-time patterns (Shift Master)** — the richest small screen in the product. For each shift
  you set the start and end time, the two times that split the morning from the afternoon, the lunch
  break, how many minutes early or late a punch still counts as this shift, how much lateness is
  forgiven, and the two thresholds that decide half day and absent. Master menu → Shift Master. This
  is where "who was late" and "who gets half a day" is actually decided.
- **Shifts that run past midnight** — a shift can end the next morning, and there is a switch for
  night shifts and for overtime that spills into the next day, so a 20:00–08:00 shift is counted as
  one night, not two broken days.
- **Bundles of shifts a person may work (Shift Group)** — you tick which shifts belong in a bundle by
  moving them from an "available" list to an "allowed" list, then give the person the bundle. A person
  on the day/night bundle can be scheduled onto either; nobody can be put on a shift their bundle
  does not allow.
- **Groups of holidays (Holiday Group)** — a named holiday calendar, so a factory and a head office
  can have different holidays. Master menu → Holiday Group; the actual dates go in under Attendance.
- **A list of banks (Bank Master)** — the banks your staff are paid into, used by the salary payment
  file.
- **A list of what documents you collect (Document Master)** — PAN, Aadhar, driving licence, passbook,
  offer letter, warning letter, certificates. Master menu → Document Master. This list becomes the set
  of upload slots on every employee's file, so everyone is asked for the same things.
- **A list of qualifications (Education Master)** — graduate, master's, diploma, 12th, 10th, with the
  order they should be listed in. It becomes the education section of the employee's file.
- **A list of company property (Asset Master)** — phones, laptops, motorcycles, SIM cards. It becomes
  the "what have we given this person" section of their file, where you add the make, serial number
  and value.
- **The claim form designer (Reimbursement Master)** — you invent a kind of expense claim and decide
  what the form asks for: one date or a date range, an amount the person types or one the payroll
  works out, and whether kilometres are collected for travel. Master menu → Reimbursement Master.
  *Right now this screen cannot be used, because it needs the salary-heads list and that list is
  broken.*
- **The list of everything that can appear on a payslip (Salary Heads)** — 63 named lines: 25 kinds of
  pay, 18 kinds of deduction, 19 attendance and leave counters, plus "days in the month". Master menu
  → Salary Heads. Every other money screen in the product refers back to this list. **This screen is
  currently broken and shows nothing** — the software asks the database for something the database
  does not have.
- **Adding a new payslip line** — you give it a type, a name, the wording that prints, a short code
  that formulas can use, a position in the order, and a set of switches: does it count towards gross,
  is it part of CTC, is it a time rather than money, should the answer be rounded, is it taxable, can
  it be claimed as a reimbursement. Master → Salary Heads → Add Salary Head.
- **Attendance and leave counted by the same machinery as money** — "present", "absent", "weekly off",
  "paid leave", "overtime hours" are lines on the same list as basic and HRA. That is why a formula
  can divide a month's pay by working days and multiply by days present: the counters are right there
  as numbers.
- **Rule sets for different kinds of staff (Category Master)** — you define, say, "office staff" and
  "factory worker" once, and each gets its own overtime rules, weekly off, half-day and absent
  thresholds, late-arrival penalties, and salary formulas. Master menu → Category Master. Every person
  gets one category, and that category decides how their attendance is judged and their pay computed.
- **Four different ways to calculate overtime** — from shift start, from total worked hours, from the
  out-punch against shift end, or early-in plus late-out. Chosen per category, with a minimum, a
  maximum and a rounding.
- **Automatic action when someone is repeatedly late** — count late or early days over a period and
  automatically deduct a half day or a full day. Set per category, so factory and office can differ.
- **Second weekly off, only in some weeks** — a second day off, and you tick which weeks of the month
  it applies to. That is how alternate-Saturday-off is expressed.
- **Writing the actual pay rules (the Formula Builder)** — for each pay line in each category you
  write a small calculation: split a CTC into basic, HRA and the rest; work out HRA for the days
  actually present; cap PF at ₹1,800; work out ESIC at 0.75% of a gross you define. Master → Category
  Master → open a category → Salary Heads → the SF/CF/IF button on a line. There is a picker of all 63
  line names to drop into the calculation, an if/else helper, and a button that checks the
  calculation before you save it.
- **Three separate rules per pay line** — one for how the agreed salary is broken up, one for what
  this month actually pays, and one for what happens at an increment. They are edited separately so a
  raise does not have to re-derive the whole structure.
- **Rules that read each other** — a calculation can use another line's answer from the same run (a
  gross built out of basic, HRA and allowances) which is why the order of the lines matters.
- **Copying a rule set (Category Copy / Import Formula)** — clone an existing category under a new
  name instead of re-entering forty settings and dozens of formulas.
- **Leave policies (Leave Level Master)** — a named leave policy such as "Office Staff", "Worker" or
  "HOD". Master menu → Leave Level Master. Every person points at one, and that is their entire leave
  entitlement.
- **What one policy controls, per leave type** — for each of paid leave, casual, sick, maternity,
  comp-off and loss-of-pay: how many days a year, whether unused days carry into next year and how
  many, how long a new joiner must wait before they can use it, whether it accrues monthly, whether
  it is visible to staff, whether a weekly off inside a leave counts as leave, whether the balance may
  go negative, how much can be taken in one stretch, when comp-off expires, and whether it can be
  cashed out.
- **Leave granted by a calculation** — instead of a flat number of days, a policy can credit leave by
  a formula (e.g. earned against days worked), with a "check this is valid" button next to it.
- **Half-day and quarter-day leave** — a policy can allow leave in quarters, and there is a mode for
  hourly leave where lateness beyond a set number of minutes is either refused or simply marked late.
- **Who has to approve what (Hierarchy Master)** — a named approval chain per department: up to four
  checking levels then up to four approvers. Master menu → Hierarchy Master.
- **Two people at every checking level** — so one person on holiday cannot freeze everyone's leave
  requests; either name can act.
- **An override for urgent cases** — a switch that lets an approver sign off before the lower checks
  are finished.
- **Only the right people appear in the approver lists** — the names offered come from what each
  person's own record says about where they sit in the chain, so you cannot accidentally make a junior
  the level-1 checker.
- **Budgeted headcount per role (Department Man power)** — for each company, department and job title
  you record how many men and women are sanctioned. Master menu → Department Man power → Update Man
  Power. Compared against the people actually on the books, this is what the dashboard's vacancy
  count is measuring — it tells you where you are under-staffed before anybody complains.
- **Search, sort and page on every one of these lists** — a search box, a choice of 5/10/13/15/25 rows
  a page, sortable columns on the bigger grids, and a count so you always know how many rows exist.
- **Deleting asks first, and the newer screens name the thing** — the rebuilt screens say which row
  you are about to remove; the five older screens just ask "Do you want to Delete?".

---

```
H13 — the 20 reference tables + Salary Heads + Hierarchy — DONE
Screens captured: 26 / expected 23     Dialogs/forms opened: 39     Dropdowns fully listed: 30
File: docs/capture/H13-reference-tables-salary-heads.md
Could not reach: Salary Heads GRID (all 63 rows with Type/Order No./flags per row) — the screen
  errors out server-side ("Invalid column name 'IsSystemGenerated'") and shows 0 rows; the 63 names,
  ids, formula tokens and type split were recovered from four other live pickers instead, and the
  per-head Order No., Print Label and 10 flags are recorded as NOT READ rather than guessed.
  Also not established: what [UE], [Import Settings] and [Import Formula] do — all three post back
  with no visible result, and I did not tick a head or save anything to force them.
Browser closed: yes
```
