# H14 — HRMex: the employee record, joining, and leaving

**Product:** HRMex 10.0.0.0 — `https://demo.hrmexweb.in` (Cloudmex's demo, ASP.NET WebForms).
**Captured:** 2026-09-07, signed in once as `Superadmin` through the shared capture helper.
**Scope:** Master ▸ Employee Master (the big one) · Employee Onboarding · Employee Offboarding
(Full & Final Master + Full & Final Settlement), plus the two screens that hang directly off the
employee list (Employee Export, Employee Import).

**How each screen was verified** — stated per screen. Every screen below was **opened live in a real
browser**; where I describe something I did *not* click (because clicking it would write to somebody
else's records), I say so in that line. Nothing was saved, submitted, deleted, sent, run, locked or
uploaded anywhere on this site.

**Menu addresses (read from the live sidebar):**

| Menu path | Address |
|---|---|
| Master ▸ Employee Master | `/Master/Employee_Mst.aspx?MenuId=15` |
| Master ▸ Employee Master ▸ `+` (shortcut) | `/Master/Employee_Mst.aspx?MenuId=15&action=add` |
| (the record itself) | `/Master/Employee_AU.aspx?MenuId=15` |
| (from the list) Export | `/Master/Export_Employee.aspx` |
| (from the list) Import | `/Master/Import_Employee.aspx` |
| Master ▸ Employee Onboarding | `/Master/Employee_Onboard_Home.aspx?MenuId=101` |
| Master ▸ Employee Onboarding ▸ New Onboard | `/Master/Employee_Onboard.aspx?MenuId=101` |
| Master ▸ Employee Offboarding | `#` (a group heading, not a screen) |
| Master ▸ Employee Offboarding ▸ Full and Final Master | `/FullNFinal/FullNFinal_Mst.aspx?MenuId=201` |
| Master ▸ Employee Offboarding ▸ Full and Final Settlement | `/FullNFinal/FullandFinal.aspx?MenuId=202` |

---

## 1. Employee Master — the list — `/Master/Employee_Mst.aspx`

**Where:** Master → Employee Master. **Driven live.**

**What you see on arrival:** one full-width white card holding a single wide table, nothing else — no
tiles, no filter bar above it. The table's first header row is a blue band of column names; a second
header row underneath is the filter row (a search box or a value-picker per column). A round blue
cog button floats at the top-right corner **inside** the table area — that cog is the whole toolbar.
A footer strip runs under the table with the licence count, the selected count and the pager.

**Numbers on the page (live values):**

| Where | Reads | What it counts |
|---|---|---|
| Footer left | `License / Active Emp : 1000 / 124` | licence seats bought vs. employees currently counted as active |
| Footer right | `Selected : 0` | rows ticked (survives paging — the server remembers the tick list) |
| Footer right | `Showing 1-30 of 124` · `Page 1 of 5` | the current page |

**Columns.** **31 named columns exist**; only **8 of them plus the tick box and Action** are shown
by default. The other 23 are in the markup marked hidden and are switched on from the cog panel.

- **Shown by default:** Emp Code · Employee Name · Location · Company · Department · Category ·
  Status · Last Punch, then **Action**.
- **The full 31, in the cog panel's own four groups:**
  - **Basic** — Employee Code · Employee Name · Status · Device Code · Gender · Date of Birth ·
    Joining Date · Resign Date · Mobile No · Email Address
  - **Organization** — Location · Company · Department · Category · Division · Designation · Section
  - **Work** — Last Punch · Shift Group · Weekly Off · Holiday Group · Level · Leave Level
  - **Documents** — Aadhar No · UAN · Pan Card · ESIC No · Driving Licence · Bank Account ·
    IFSC Code · Bank Name
- The tick-box column, **Emp Code** and **Employee Name** are **frozen** to the left edge and
  **Action** is frozen to the right edge, so they stay put while you scroll sideways.
- Every column in the panel has its own **Pin** control, so the owner can freeze any column he likes.

**Live row values look like:** `EMP082 | Test 82 | Location 3 | Company 1 | Production | Category 1 |
Working | 01-08-2026 09:00 - ME | 37`. The Last Punch cell carries the **date, time, the device name
and a number** (`30-06-2026 09:11 - Vapi | 69`) — the trailing number is days-since, which is what
the Last-Punch filter below buckets on.

**The filter row (second header row) — per column:**

- **Emp Code** and **Employee Name** get a free-text box (`Search Emp Code`) with a magnifier button.
- Every other column gets: a text box (disabled), a **funnel button**, a value dropdown that starts
  at `All`, and a small **Clear** link that appears once that column is filtered.
- A **`×` Clear filters** button sits in the tick-box cell and appears once anything is filtered.

**The funnel popover** (opened live on Location, Status and Last Punch): a titled panel with a
`Search…` box and a checkbox list headed **`(Select All)`**, plus a `×` to close.

- **Location** → `(Select All)` · Location 2 · Location 3 · Location 4 · Location 5 — all ticked.
- **Status** → `(Select All)` · Resign · **Working (ticked)** — so **the list arrives pre-filtered to
  working staff only**; resigned people are hidden until you tick Resign.
- **Last Punch** → not a value list but six ranges: `(Select All)` · **Last 15 Days · Last 30 Days ·
  Last 45 Days · Last 60 Days · Last 90 Days · Above 90 Days** — none ticked.
- The screen's own code also carries a date-range picker per date column and a separate rule set for
  Last Punch (`ajaxHeaderDateRangeByIdx`, `ajaxHeaderLastPunchRulesByIdx`). I saw the Last-Punch one;
  the date-range one sits on hidden columns (Date of Birth / Joining / Resign) and I did not switch
  those columns on, because switching a column on saves a preference on the demo user's account.

**The cog panel — `Columns Panel`** (opened live). Headed `Columns Panel` with a `✖`. Top block:

1. **`New Employee`** (full-width blue) → opens the blank record.
2. **`Bulk Employees`** dropdown — *the bulk-change engine*. **All 18 options:**
   Update Company · Update Designation · Update Division · Update Department ·
   Update Section_Master · Update Costcenter · Update ShiftGroup · Update Holiday Group ·
   Update Level · Update LeaveLevel · Update ReportingManager · Update Gender · Update Weeklyoff ·
   Update 2ndWeeklyoff · Update OT · **Bulk Resign** · Update Category · Update Hierarchy.
3. **`Export`** (green) → `Export_Employee.aspx` · **`Import`** (blue) → `Import_Employee.aspx`.
4. **`Grid`** / **`List`** view toggle (List is the active one).
5. **`Responsive (+) Mode`** switch · **`Reset`** (undo icon, "Reset columns").
6. A `Search…` box with live suggestions over the column names.
7. Then the four-group column list described above, each row a checkbox + a **Pin**.

**Row menu** (the `☰` in Action, opened live) — four items:
`👁 View` · `✏ Edit` · `👤✕ Resign` · `🗑 Delete`. The server sends **per-row rights**
(`CanView` / `CanEdit` / `CanDelete`), so a lesser user sees fewer of these.

- **View** → goes to the record screen with the **Update button absent** (see §2).
- **Edit** → the same record screen **with** Update.
- **Resign** → opens the *Resign Options* dialog below.
- **Delete** → a browser confirm, **"Are you sure you want to delete this employee?"**, then a
  hard delete of the row. **Not pressed.**

**Dialog — `Resign Options`** (opened live from a row; identical dialog also lives on the record):

| Part | Detail |
|---|---|
| Employee line | the person's name/code |
| `Resign Date Options` | ○ `Last Punch Date` · ● **`Custom Resign Date` (default)** · ○ `Last Punch Date to Month End` |
| Info lines (appear on the two automatic modes) | `Last Punch: …` and `Assigned End Date: …` |
| `Resign Date` | date box with a calendar button (hidden on the automatic modes) |
| Footer buttons | **`Update`** (blue) · **`Update & Block`** (amber) · **`Update & Delete`** (red) |
| Red note | *"Note: The Block or Delete command affects to the biometric machine only, not the software."* |

**None of the three pressed.** The note is the important bit: *Block* and *Delete* here act on the
fingerprint/face machine, not on the HRMex record.

**Dialog — `Update Multiple Employee`** (the bulk dialog; described from the screen without firing it):
subtitle *"Apply a bulk change to selected employees"*, a `N Employees selected` line, a tip
*"Tip: use search inside the dropdown"*, then **either**

- the standard shape — one label + one searchable dropdown of the chosen master's values, **or**
- the **Bulk Resign** shape — `Resign Date Options`: ● `Custom resign date` (default) ·
  ○ `Last punch date` · ○ `The resign date will be the last day of the month.`, plus a
  `Resign Date` picker and the hint *"Choose a common resign date, use each employee's last punch date"*.

Footer: `Cancel` · **`Update`**. Choosing a bulk option with nothing ticked pops
**"No Employee Selected"** and resets the dropdown.

**Grid (card) view** — *not driven, deliberately*: switching view calls `SaveViewModeAjax`, which
**saves the choice onto the signed-in user**, so I left the demo in List view. From the screen's own
code, the card view replaces the table with a `Search employee…` bar and a grid of cards, each card
carrying: photo (a fallback avatar if none) · Employee Name · Emp Code · Company · Location ·
Department · Category · a Status badge · Last Punch · Resign Date · and the same View/Edit/Delete
menu subject to the same per-row rights.

**Pager:** `<<` · numbered pages · `>>` · page size **10 / 20 / 30 / 50 / 100 / 500 / 1000**
(30 is the default).

**Empty state:** not seen — 124 rows present.

**Realtime/auto:** nothing polls. Last Punch is whatever the last page load fetched.

---

## 2. ⭐ The employee record — `/Master/Employee_AU.aspx?MenuId=15`

**Where:** Master → Employee Master → a row's `View` or `Edit` (or `New Employee`).
**Driven live** on two real records (`EMP082`, and `EMP001` which has a salary structure), in
**View mode, Edit mode and New mode**.

**What you see on arrival:** a breadcrumb `Home ▸ Employee List ▸ Employee`, then **11 blue-headed
collapsible cards stacked down the page — not tabs**. `Employee Detail` is open, the other ten are
collapsed to their headers. Each card has a `+`/`−` collapse control and a refresh control in its
header, and **its own Update/Save button in its own footer** — so the record is saved **section by
section**, not with one Save at the bottom.

**The three modes differ only in the save buttons:**

| Mode | Sections | Save buttons visible |
|---|---|---|
| **View** | all 11 | **only `Upload to Device`** — the `Update` is simply gone (the fields are *not* locked, the save is absent) |
| **Edit** | all 11 | `Update` + `Upload to Device` |
| **New** | **only 8** — *Family Details, Salary Details and Leave Detail do not exist yet* | `Save` only (no device picker, no `Upload to Device`) |

**The screen marks nothing as required.** There are **zero** asterisks and **zero** client-side
required-field validators anywhere on the record, in any of the three modes. Whatever is compulsory
is decided on the server after you press Save.

### 2.1 Card 1 — `Employee Detail`

| Field | Control | Default / live value | Notes |
|---|---|---|---|
| Aadhar No | text | empty | placeholder *Enter Aadhar Number* |
| PAN No | text | empty | *Enter Pan Number* |
| Emp Code | text | `EMP082` | *Enter Emp Code*; blank on a new record |
| Device Code | text | `dr` | the biometric machine's id for this person |
| Employee Name | text | `Test 82` | *Enter Employee Name* |
| Gender | dropdown | Male | **Male · Female** |
| Designation | dropdown | (per person) | **60 options** — Default · Operation Head · Manager Accounts & finance · Purchase Manager · Store Manager · Maintenance manager · Dispatch Head · HR HEAD · GM Marketing · Sr. Sales Executive · Zonal Head · AGM Marketing · Sr. Operator · Operator · Sr. Accounts Executive · Sr. Slitting Operator · Accounts Executive · Jr. Operator · Slitting Operator · Sales Executive · Store Executive · Unloading INCHARGE · Sr. Quality Incharge · Asst. Store Manager · Sr. Quality Executive · Packing Supervisor · Sr. Dispatch Executive · Asst. Manager Maintenance · Purchase Executive · Safety Head · QC Executive · HR Executive · Sr. HR Executive · Commercial Officer · Plant Head · Sr. Electrician · HELPER · Office Assistant · Fitter Maintenance · SALES COORDINATOR EXPORT · Loading Supervisor Incharge · ELECTRICIAN · DISPATCH EXECUTIVE · Sr. Maintenance Executive · Qc Head · Electrical Engineer · QA Executive · Supervisor · Asst. Supervisor · Safety Officer Trainee · HR Generalist · Store Keeper · Asst. Trainee Operator · IT Support Engineer · Data Entry Operator · Driver · Trainee Operator · Shift Incharge · Store Incharge · Safety Officer |
| Date of Birth | date box | `01-01-1991` | dd-MM-yyyy |
| Status | dropdown | Working | **Working · Resign** |
| Joining Date | date box | `01-01-2016` | |
| **Photo** | image + file chooser + hidden `Upload` | — | the photo is a clickable image; the Upload button is hidden and fired by the file chooser. Clicking a photo opens a **590×500 lightbox** with a `close` button |
| Location | dropdown | Location 3 | **Location 1 · Location 2 · Location 3 · Location 4 · Location 5** |
| Company Name | dropdown | Company 1 | **Company 1 · Company 2** |
| Division | dropdown | Division 1 | **Division 1 … Division 9** (9) |
| Department | dropdown | Production | **21 options** — Default · Marketing · Dispatch · Production · Accounts · Loading · STORE · Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing · Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT |
| Section | dropdown | Default | **Default** (only one exists on this demo) |
| **Category** | dropdown, **disabled** | Category 1 | **Category 1 … Category 7**. On an existing record this is **locked** — it is changed only through the `Change Category` dialog (§2.12) |
| Shift Group | dropdown | GS | **GS · GS1 · DS · NIS · DN · GSHOD · GS2 · GS19T · GS9T · NGS · PGSH** (11) |
| Holiday Group | dropdown | All | **All · Default · BAKRA EID · Eid ul Fittar · specila** (5) |
| Level | dropdown | Default | **Default** + one blank entry (2) |
| Leave Level | dropdown | Office Staff | **Office Staff · HOD · Worker · Maintenance & QC Staff · Production Staff** (5) |
| CostCenter | dropdown | Default | **Default** only |
| Reporting Manager | dropdown | Test 1 | **173 entries** — every employee by name (`Test 1` … `Test 173`) |
| Weeklyoff | dropdown | Sunday | **Sunday · Monday · Tuesday · Wednesday · Thursday · Friday · Saturday · No WO · as Category** (9) |
| OT | dropdown | Not Applicable | **Not Applicable · Applicable** |
| `2nd WO` | checkbox | off | turns on the second weekly off |
| Weeklyoff 2 | dropdown | Sunday | **Sunday … Saturday** (7 — no *No WO* / *as Category* here) |
| Which weeks | 5 checkboxes | all off | **First · Second · Third · Fourth · Fifth** — the second weekly off applies only in the ticked weeks of the month |

**Card footer (existing record):** `Update` · a **device dropdown** (`Sarigam - Offline`,
`Vapi - Offline` — the machine names, each with its live online/offline state shown in red) ·
**`Upload to Device`**, which pushes this person to the chosen biometric machine. **Not pressed.**

### 2.2 Card 2 — `Address`

Two mirrored columns, **Current** and **Permanent**, with a **`Same As Current Address`** checkbox
between them. Each side: a free-text address box (textarea), `Address Line 1`, `Address Line 2`,
`Landmark`, `District`, `City`, `State`, `Country`, `Pincode` — all plain text, all empty on this
record, all with `Enter …` placeholders. Footer: `Update`.

> One small wart, worth copying *correctly* rather than copying: on the live screen the second
> address line's label reads `Address Line 1` on three of the four boxes and every placeholder says
> `Enter Address Line 2`. See *Odd things I noticed*.

### 2.3 Card 3 — `Contact Detail`

`Mobile Number` (`9999999999`) · `Email Address` (`test82@mail.com`) · `Emergency Contact` ·
`Emergency Contact 2` · `Driving Licence` — five plain text boxes. Footer: `Update`.

### 2.4 Card 4 — `Documents`

One add-a-document row, then the list of what is already attached, then a lightbox for viewing one.

- `Document Name` dropdown — **14 options**: PAN · Aadhar · Driving Liences ·
  Bank Passbook /Cheque book · OFFER LETTER · Appointment Letter · Termination Letter ·
  Warning Letter · Voter Id · 10TH · 12TH · GRADUATION · **POST GRADUATION** · **DIPLOMA**
- `Document Number` (text, *Enter Doc. number*) · `Choose file` (file) · **`Upload`**. *Not pressed.*
- Below a rule, the **already-uploaded list**. It was **empty on every record I opened**, so I
  cannot honestly name its column headers — see *Could not reach*.
- A lightbox (`close` button) shows an uploaded document full size.

### 2.5 Card 5 — `Education Detail`

Same shape as Documents. `Education Name` dropdown — **5 options**: Graduate Degree · Master Degree ·
Diploma · 12th · 10th. Then `Document Number`, `Choose file`, **`Upload`**, the uploaded list
(empty here) and the same lightbox.

### 2.6 Card 6 — `Family Details` *(does not exist on a new record)*

- **Spouse:** Spouse Name · Spouse Mobile · Spouse DOB
- **`No. of Children`** (number)
- **Parents:** Father Name · Father Mobile · Mother Name · Mother Mobile
- **Emergency Contact 1 · Emergency Contact 2** (again, separate from the ones on Contact Detail)
- **Nominee 1** and **Nominee 2**, identical five-field blocks each:
  `Name` · `Relationship` (free text, not a dropdown) · `DOB` · `Mobile` · **`Is Minor?`** checkbox,
  and when a nominee is a minor, `Guardian Name` + `Guardian Rel`.
- Footer: `Update`.

### 2.7 Card 7 — `Assets Detaill` *(the misspelling is the product's)*

`Asset Name` dropdown — **7 options**: **SAMART MOBILE PHONES** *(sic)* · KEYPAD MOBILE PHONES ·
MOTORCYCLES · SCOOTY · LAPTOP · DESKTOP · SIM CARD. Then `Make` · `Model No` · `Serial No` ·
`Value` (number) · `Remark` (textarea, *Optional notes or comments*) · **`Save`**. One asset is
entered at a time and saved to a list.

### 2.8 Card 8 — `Salary Details` *(does not exist on a new record)*

**Statutory + bank block:**

| Field | Control | Notes |
|---|---|---|
| UAN Number | text | *Enter UAN Number* |
| PF Number | text | *Enter PF Number* |
| ESIC Number | text | *Enter ESIC Number* |
| Bank Name | dropdown | **20 options** — `Please Select Bank` + Bank 1 … Bank 19 |
| Bank A/c Number | text | |
| IFSC Code | text | |

**The pay block:**

| Field | Control | Live value (EMP001) | Notes |
|---|---|---|---|
| **CTC Amount** | number, **disabled**, with a **`Revise`** link beside the label | `80520` | you cannot type into CTC; you press **`Revise`** first, which unlocks it. Changing it re-posts the page |
| CTC Type | dropdown | Monthly | **Daily · Monthly · Yearly** |
| Daily CTC | number | 0 | |
| **OT Per-hour rate** | number | 0 | |
| Pay scale | text | empty | |
| **`Calculate`** | button | — | asks **"Are you sure you want to proceed?"** then rebuilds every head from the formulas. **Not pressed.** |

**The salary structure — two grids. This is the part to copy carefully.**

`Allowence` grid, columns **`Heads Name` · `Condition` · `Wages Amount`** — one row per earning head
defined for this person's category, with **an editable amount box per row** and a total row:

```
Heads Name          Condition   Wages Amount
WRD                     0              0
BASICDA                 0         40,260      ← 50% of CTC
HRA                     0         16,104      ← 40% of BASICDA
OTHERS                  0              0
FIX_INCENTIVE           0              0
Monthly Incentive       0              0
SpecialAllowence        0         24,156      ← the balancing figure
Reimbursement           0              0
WD                      0              0
Gross                             80,520.00   ← equals CTC ✔
```

`Deduction` grid, columns **`Heads Name` · `Condition` · `Wages Amount` · `CTC Component`**:

```
Heads Name        Condition   Wages Amount   CTC Component
LOAN                  0              0             0
PF                    1           1800             0        ← Condition 1 = a fixed amount, not a formula
Advance               0              0             0
Other Deduction       0              0             0
Canteen               0              0             0
CTC                                             80,520.00
```

**Answering the question directly: there is ONE number per head, not two.** The record holds only the
**structure amount** (`Wages Amount`). There is **no earned column** on the employee record — what a
person actually earned in a month is computed in Payroll, not stored here. `Condition` is the switch
that flips a head between *formula-driven* (0) and *fixed amount* (1), and `CTC Component` on the
deduction side is how much of that deduction counts inside CTC.

**Both grids exist only once the person has a salary structure.** On `EMP082` (CTC 0) the two grids
are **not rendered at all** — the card shows the statutory/bank/pay block and nothing else.

Footer: `Update`.

### 2.9 Card 9 — `Leave Detail` *(does not exist on a new record)*

A two-column grid `Leave Name | Balance` with **6 rows** — **PL · COFF · CL · SL · ML · LOP** — each
with an editable balance box, all `0` on this record. These are the **opening balances**.
Footer: **`Save`**.

### 2.10 Card 10 — `Hierarchy Level and Notification`

| Field | Control | Live value | Options |
|---|---|---|---|
| Hirarchy Group *(sic)* | dropdown | Admin | **16** — Admin · Default · Accounts · RM Store · PRODUCTION · MAINTENANCE · Purchase · HR · Dispatch · Loading / Unloading · Loading / Unloading *(listed twice)* · QC · Store · Safety · Production Pardi · Marketing |
| **Level In Hierarchy** | dropdown | Level 1 (L1) | **General · Level 1 (L1) · Level 2 (L2) · Level 3 (L3) · Level 4 (L4) · Level 5 (L5)** |
| Notification | dropdown | Yes | **No · Yes** |
| **ESS Password** | text, **disabled** | `123` | the employee's own self-service password, shown in the clear and not editable from here |
| **`Block Employee ESS`** | checkbox | off | shuts this person out of self-service |

Footer: `Update`.

### 2.11 Card 11 — `Other Details`

`Caste` dropdown — **General Class · Other Backward Class (OBC) · Scheduled Castes (SC) ·
Scheduled Tribes (ST)**. `Blood Group` — plain text (*Enter Blood Group*), not a dropdown.
Footer: `Update`.

### 2.12 The record's five dialogs

All five are in the record's markup and all five are **opened by the server** in response to what you
do (there is no button on the page that opens them client-side), so I could describe each in full but
could not make any of them appear without saving something. Each is stated as such.

| Dialog | Fields | Buttons |
|---|---|---|
| **`Resign Options`** | `Resign Date` (date, pre-filled — `29-03-2025` on this record) | `Close` · **`Update`** · **`Update & Block`** · **`Update & Delete`** + the same red note about the biometric machine only |
| **`Change Category`** | `Category` — searchable dropdown, Category 1 … Category 7 | `Close` · **`Update`** (confirms *"Are you sure you want to proceed?"*) |
| **`Revise Empcode`** | `Existing Empcode` (locked) · `Revise Empcode` · `Revise Devicecode` | `Close` · **`Revise Empcode`** · **`Revise Both`** — both confirm; red note: *"Note: Changing the device code may affect previous data. Please proceed with caution."* |
| **`Hold Salary`** | `Date` (date picker) | `Close` · **`Save`** — freezes this person's pay from that date |
| **`Rejoin`** | `Date` (date picker) | `Close` · **`Save`** — brings a resigned person back from that date |

**`Hold Salary` and `Rejoin` are not in the 2026-08-16 capture at all.** They are the two halves of
the employment lifecycle that the old document is missing.

---

## 3. Employee Export — `/Master/Export_Employee.aspx`

**Where:** Master → Employee Master → cog → `Export`. **Driven live** (nothing exported).

**What you see:** breadcrumb `Home ▸ Employee Master ▸ Employee Export`, then one `Filters` card:
a row of six multi-pick filters, a search-one-field row, then a **field picker** with four tabs, a
`Selected Fields:` chip strip, and the action buttons.

**The six filters** — each is a searchable tick-list, not a plain dropdown (`Search Company`, …):

| Filter | Options |
|---|---|
| COMPANY | All Companies · Company 1 · Company 2 |
| DIVISION | All Divisions · Division 1 … Division 9 |
| DEPARTMENT | All Departments · Default · Marketing · Dispatch · Production · Accounts · Loading · STORE · Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing · Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT |
| CATEGORY | All Categories · Category 1 … Category 7 |
| LOCATION | All Locations · Location 1 … Location 5 |
| STATUS | All · Working · Resign |

**`SEARCH CRITERIA`** dropdown — **9 options**: Emp Code · Employee Name · Joining Date · Mobile No ·
Gender · Email Address · Company · Location · Department — with a **`SEARCH VALUE`** box
(*Enter search value*).

**The field picker — four tabs**, each with group headers that tick a whole block:

1. **`Basic / Organization / Documents`**
   - **All Basic** → Employee Code *(locked on — it is always exported)* · Device Code ·
     Employee Name · Gender · Date of Birth · Joining Date · Resign Date · Mobile No ·
     Email Address · Status
   - **All Organization** → Company · Division · Department · Designation · Section
   - **All Work Details** → Shift Group · Weekly Off · Holiday Group · Level · Leave Level
   - **All Documents** → Aadhar No · UAN · Pan Card · ESIC No · Driving Licence · Bank Account ·
     IFSC Code · Bank Name
2. **`Address & Other Details`** — the whole current-address block (address, line 1, line 2,
   landmark, district, city, state, country, pincode), the whole permanent-address block (same nine),
   then Emergency Contact, Emergency Contact 2, Caste
3. **`Family Details`** — Spouse Name · Spouse Mobile · Spouse DOB · No. of Children ·
   Father Name · Father Mobile · Mother Name · Mother Mobile
4. **`Nominee Details`** — Nominee 1: Name · Relationship · DOB · Mobile · Is Minor ·
   Guardian Name · Guardian Relationship, then the identical seven for Nominee 2

A **`Selected Fields:`** strip shows the chosen columns as chips (starts at *Employee Code,
Employee Name*) with a **`Clear All`**.

**Buttons:** **`Show Data`** → a preview grid with columns `Employee Name · Department ·
Designation · Mobile No · Joining Date` · **`Close`** · **`Export to Excel`** (hidden until data is
shown). **Neither Show Data nor Export pressed.**

---

## 4. Employee Import — `/Master/Import_Employee.aspx`

**Where:** Master → Employee Master → cog → `Import`. **Driven live** (nothing uploaded).

**What you see:** breadcrumb `Home ▸ Employee Master ▸ Employee Import`, one `Import Employees` card
with two ways in, separated by a literal `----- OR -----`:

1. **`Import File`** → `Choose file`
2. **`Paste Data Here`** → a big textarea, *"Paste Data Here with Header"*

**Buttons, in order:** **`Preview`** (a client-side "smart preview" of what it read) → a preview
panel with **`Import from Excel`** and **`Cancel`**. Pressing `Import from Excel` does **not** import
— it opens a confirmation dialog.

**The confirmation dialog is the notable part:** it asks for **`Enter User ID`** and
**`Enter Password`** again before **`Confirm Import`**. A bulk employee import is re-authenticated.
Then a result popup with an `OK`. **Nothing pressed.**

---

## 5. Employee Onboarding — `/Master/Employee_Onboard_Home.aspx`

**Where:** Master → Employee Onboarding. **Driven live.**

**What you see:** breadcrumb `Home ▸ Employee Onboard`, one card headed `Employee Onboard` with a
**`New Onboard`** button top-right, a `Search (TempID / Name):` box (*Type and press Enter…*), a
**`Total: 13`** count, and one table.

**Table `TempID · Employee Name · Company · Status · Emp Respond · Action`** — live rows:

```
TMP14  Yogesh patil   Company 1  Pending  Pending
TMP13  avinashpatil   Company 1  Pending  Pending
TMP12  badmash        Company 1  Pending  Pending
TMP11  avinashpatil   Company 1  Pending  Pending
TMP10  avinashpatil   Company 1  Pending  Pending
TMP9   avinashpatil   Company 1  Pending  Pending
TMP8   avinashpatil   Company 1  Pending  Pending
TMP7   test           Company 2  Pending  Pending
TMP6   avinashpatil   Company 2  Pending  Pending
TMP5   fgggg          Company 2  Pending  Pending
TMP4   test           Company 2  Pending  Pending
TMP3   test           Company 2  Pending  Pending
TMP2   Test1          Company 2  Pending  Pending
```

**Two independent statuses, and that is the design:** `Status` is *HR's* side of the flow and
`Emp Respond` is *the candidate's* side. Both render as amber `Pending` badges. All 13 rows on this
demo are Pending/Pending, so **no row has ever progressed** and I could not observe what the other
states are called.

**Row menu (`⋮` Actions) — five items** (read from the live row, none pressed):
**`✅ Approval`** · **`✉ ReMail`** *(re-sends the invitation email — deliberately not pressed)* ·
**`👁 View`** · **`✏ Edit`** · a divider · **`🗑 Delete`**, which confirms
*"Are you sure you want to delete this onboard record?"*.

### 5.1 New Onboard — `/Master/Employee_Onboard.aspx?MenuId=101`

**Driven live.** One card, `Onboard Details`. **The form is deliberately tiny — six fields:**

| Field | Control | Options |
|---|---|---|
| Employee Name | text | *Enter Employee Name* |
| Email | text | *Enter Email* |
| Phone Number | text | *Enter Phone Number* |
| Company | dropdown | `Please Select Company` · Company 1 · Company 2 |
| Department | dropdown | `Please Select Department` + the 21 departments, **sorted A–Z** here (Accounts, Admin, Consumables Store, Default, Dispatch, House Keeping, HR, IT, Loading, Maintenance, Marketing, Packing, Production, Production Pardi, Purchase, QC, QC PARDI, RM & Con Store, RM Store, Safety, STORE) |
| Designation | dropdown | `Please Select Designation` + the 60 designations, **sorted A–Z** |

There is also a hidden `Employee Code` box. One button: **`Onboard`** (shows a spinner while it
works). **Not pressed** — it emails the candidate.

**How it differs from just adding an employee directly:** adding directly means *you* type all ~130
fields of the record. Onboarding creates a **temporary record with a TempID (`TMP14`)**, emails the
person a link, and **the candidate fills their own details** — which fields they are asked for is
configured elsewhere (Master Setting ▸ Employee Setting ▸ Onboard, H12's scope). HR then reviews with
`View`, corrects with `Edit`, and presses `Approval`, at which point the temporary record becomes a
real employee. **I could not watch that conversion happen**, because every row on the demo is still
Pending and pressing `Approval` would create a real employee in somebody's data.

---

## 6. Full and Final Master — `/FullNFinal/FullNFinal_Mst.aspx`

**Where:** Master → Employee Offboarding → Full and Final Master. **Driven live**, both dialogs opened.

**What you see:** a page title **`Full N Final Master`** with the subtitle
*"Manage settlement heads and configurations"*, breadcrumb `Home ▸ FNF Heads`, then one card headed
`FNF Heads List` with two buttons top-right: **`FNF Settings`** and **`Add New Head`**. Under that a
filter row, then the heads table, then a `Showing 0 to 0 of 0 entries` footer.

**Filters:** `SELECT TYPE` (a custom picker, default **`-- All Types --`**, with a type-search box) ·
`ORDER BY` (**Order No · Head Name**) · `SORT DIRECTION` (**Ascending · Descending**) ·
**`Apply Filter`**. *(There is no `Clear` button on the live screen.)*

**Table `# · HEADS NAME · PRINT LABEL · TYPE · ORDER NO · ACTIONS`.**

**Empty state (live):** the table shows

```
No Records Found
Start by adding a new FNF head using the button above.
```

**FNF has no heads at all on this demo**, so the settlement side has nothing to compute with.

**Dialog — `Add New Head`** (opened live):

| Field | Control | Default |
|---|---|---|
| Type | dropdown | **Deduction · Earnings** (Earnings selected) |
| Heads Name | text | *Enter head name* |
| Print Label | text | *Enter print label* |
| Order No | number | `0` |

Buttons: `Cancel` · **`Save`**. **Not saved.** *(Print Label is what appears on the printed
settlement, separate from the internal head name — that is the point of the field.)*

**Dialog — `FNF Configuration`** (the `FNF Settings` button; opened live). Three formula boxes, then
the rules, then what the settlement form shows:

| Setting | Control | Live value |
|---|---|---|
| **Gratuity** | textarea + a **`Verify`** link | empty (*Enter gratuity formula…*) |
| **Notice Pay** | textarea + **`Verify`** | empty (*Enter notice pay formula…*) |
| **Bonus** | textarea + **`Verify`** | empty (*Enter bonus formula…*) |
| `Gratuity Eligibility (Years)` | number | **60** (placeholder suggests `5`) |
| `Round off Months` | number | **6** |
| **`Has Notice Period`** | checkbox | **off**. Ticking it reveals a hidden **category tick-list** (`All Categories` · Category 1 … Category 7, with a `Search categories…` box) — i.e. notice period applies only to the chosen categories |
| **`Is FNF Required`** | checkbox | **off** |
| `FNF Required Category` | category tick-list + **`Select Categories`** placeholder | nothing chosen (`All Categories` · Category 1 … Category 7) |
| **`FNF form display`** — five switches | checkboxes | **`Show Salary Structure` ✅ · `Show Earnings` ✅ · `Show Deductions` ✅ · `Show Asset Details` ✅ · `Show Loan Recovery` ✅** — all five on |

Buttons: `Cancel` · **`Save Configuration`**. **Not saved, and `Verify` not pressed** — the
`Verify` link beside each formula checks the expression is valid before you are allowed to save it,
which is the one guard on the whole formula feature.

**Those five `FNF form display` switches are the table of contents of the settlement form**: salary
structure, earnings, deductions, asset details, loan recovery.

---

## 7. Full and Final Settlement — `/FullNFinal/FullandFinal.aspx`

**Where:** Master → Employee Offboarding → Full and Final Settlement. **Driven live**, all three
buckets clicked.

**What you see:** breadcrumb `Home ▸ Full & Final List`, one card headed `Full & Final List`, three
clickable count tiles across the top, and a `SEARCH` box. **That is the entire screen.**

| Tile | Live count |
|---|---|
| **FNF not started** | **0** |
| **FNF in progress** | **0** |
| **FNF completed** | **0** |

Behind the tiles is a status selector with exactly three states:
**`Settlement Not Yet Started` · `Settlement Started` · `Settlement Completed`**. Clicking a tile
switches the list to that bucket.

**I clicked all three buckets. Every one is empty, and there is no table and no message** — just the
three tiles and the search box over blank card space. Nobody on this demo has resigned, so there is
no candidate for a settlement.

**Consequence, stated plainly: the per-person Full & Final calculation screen could not be opened.**
It does not exist as its own menu item, it is reached only from a row in one of these three buckets,
there are no rows, and there is no reference to any other address in the page. Creating one would
mean resigning a real person in somebody else's records, which I did not do. What the settlement
form contains is therefore recorded from the Master's own configuration (§6) rather than observed:
salary structure, earnings, deductions, asset details, loan recovery, plus gratuity / notice pay /
bonus from the three formulas, gratuity eligibility measured in years with months rounded, and
notice period only for the chosen categories. **The buttons that would finalise a settlement were
never seen, so I am not naming them.**

---

## Corrections to the 2026-08-16 capture

The old §2.7–2.9 was written mostly from markup. Nine things are now wrong or incomplete.

1. **"31 columns" is right but misleading.** The old doc lists 31 columns as if the grid showed them.
   Live, **8 are shown** (Emp Code, Employee Name, Location, Company, Department, Category, Status,
   Last Punch) and the other 23 are hidden until switched on in a **`Columns Panel`** that the old
   doc does not mention. The panel also groups them (**Basic / Organization / Work / Documents**) and
   gives each a **Pin** to freeze it.

2. **The toolbar has moved.** The old doc has a toolbar of
   `[New Employee] [Export] [Import] [Grid] [List] [Reset]` + `☐ Responsive (+) Mode` sitting on the
   page. Live, **all of that is inside the cog panel** — there is no toolbar on the page at all, just
   a round blue cog floating over the table's top-right corner.

3. **Bulk resign is not the only bulk thing — and its buttons are wrong.** The old doc describes a
   *"Bulk resign modal"* with `[Update] [Update & Block] [Update & Delete]`. Live:
   - there is a **`Bulk Employees` dropdown with 18 bulk operations** (company, designation,
     division, department, section, cost centre, shift group, holiday group, level, leave level,
     reporting manager, gender, weekly off, 2nd weekly off, OT, **bulk resign**, category,
     hierarchy) — the old doc records none of the other 17;
   - the **bulk** dialog is called **`Update Multiple Employee`** and its footer is only
     **`Cancel` / `Update`**;
   - the three buttons `Update` / `Update & Block` / `Update & Delete` belong to the
     **single-employee `Resign Options`** dialog, not the bulk one.

4. **The three bulk-resign date options are worded differently** from the single-employee ones. Bulk:
   `Custom resign date` (default) · `Last punch date` · **`The resign date will be the last day of
   the month.`** Single: `Last Punch Date` · `Custom Resign Date` (default) ·
   `Last Punch Date to Month End`. The old doc gives only one set.

5. **"Employee detail — 10 collapsible sections" undercounts.** There are **11**, and the old doc's
   own table actually lists 12 rows (it double-counts by splitting Employee Detail). The real 11, in
   order: Employee Detail · Address · Contact Detail · Documents · Education Detail · Family Details ·
   Assets Detaill · **Salary Details** · Leave Detail · Hierarchy Level and Notification ·
   Other Details.

6. **The old doc misses that the record saves section by section.** Each of the 11 cards has **its
   own Update/Save button in its own footer**. There is no single Save for the record.

7. **The old doc misses the three-mode difference.** A **new** record shows only **8 sections** —
   *Family Details, Salary Details and Leave Detail do not exist until the employee is saved*. A
   **View** shows all 11 but **without the Update button**. And **nothing on the record is marked
   required** — zero asterisks, zero validators.

8. **Five dialogs on the record are missing entirely from the old doc**, two of which are real
   features: **`Hold Salary`** (freeze someone's pay from a date) and **`Rejoin`** (bring a resigned
   person back from a date), plus **`Change Category`** (the *only* way to change Category, which is
   locked on the record itself), **`Revise Empcode`** (`Revise Empcode` / `Revise Both`, with a
   caution note about the device code affecting past data) and the record's own `Resign Options`.

9. **Smaller list corrections:**
   - `Document Name` has **14** options, not 12 — the old doc misses **POST GRADUATION** and
     **DIPLOMA**.
   - `Level In Hierarchy` reads **`General · Level 1 (L1) … Level 5 (L5)`**, not `L1…L5`.
   - `Caste` reads out in full: **`General Class · Other Backward Class (OBC) ·
     Scheduled Castes (SC) · Scheduled Tribes (ST)`**.
   - `Weeklyoff 2` has only the **7 weekdays** — the old doc implies it shares the main list's
     `No WO` / `as Category`.
   - The old doc's `CTC Amount` entry misses that the field is **disabled behind a `Revise` link**.
   - `Blood Group` is a **free-text box**, not a dropdown.
   - The `Leave Detail` grid's six rows are **PL · COFF · CL · SL · ML · LOP**.
   - The `Assets` list's first option is spelled **`SAMART MOBILE PHONES`** on the live screen, not
     `SMART`.
   - The old doc's `Salary Details` grid headers are right, but it does not say that **both grids
     disappear when the person has no structure** (verified on `EMP082`, CTC 0).
   - The FNF head `Type` values are **`Deduction` / `Earnings`**; the old doc leaves `Type` unfilled.
   - `Add New Head`'s footer is `Cancel` / `Save`; the old doc's `[Add New Head]` field list omits
     that `Order No` defaults to `0`.
   - **FNF Settings has an extra, hidden category picker** tied to `Has Notice Period` — the old doc
     records only the `FNF Required Category` one.
   - The FNF Heads filter row has **no `Clear` button** any more, only `Apply Filter`.

**Two things that changed since 2026-08-16 rather than being recorded wrong:**

- **The FNF heads list is now empty** (`No Records Found`). The old doc implies rows existed.
- **The FNF Settings formulas are now all blank.** The old doc shows the three formula boxes as if
  filled, and `Gratuity Eligibility (Years) = 60` / `Round off Months = 6` are still there.
- **`View` no longer opens a modal.** The old doc's `employeeRowCommandAjax(id,'ViewData')` note is
  still accurate as a command name, but it now **navigates to the record screen** — the page still
  carries an unused `Full Details` modal shell that nothing opens.

---

## Odd things I noticed

- **Three of the four address-line boxes are labelled `Address Line 1`**, and all four placeholders
  say *Enter Address Line 2*. Copy the layout, not the labels.
- **`Hirarchy Group` lists `Loading / Unloading` twice** — two separate entries with the same name.
- **`Level` has a blank second option** (an unnamed row in the Level master).
- **The `ESS Password` is displayed in the clear** on the record, in a disabled box (`123` here).
- **`Assets Detaill`** and **`SAMART MOBILE PHONES`** and **`Hirarchy`** and **`Driving Liences`**
  are all the product's own spellings.
- **`Gratuity Eligibility (Years)` is set to 60** while its own placeholder suggests `5` — 60 years
  of service is not a plausible eligibility, so this demo's value looks like a typo for 5 (or the
  field is really months).
- **The Full & Final Settlement list has no empty state** — three zero tiles and a search box over
  blank space, with no "nothing here yet" line. The FNF Heads list, by contrast, has a proper one.
- **The `Documents` and `Education Detail` cards have an upload row but the uploaded-list area was
  empty on every record I opened**, so a person browsing the demo cannot tell those lists exist.
- **`Section` and `CostCenter` each have exactly one option (`Default`)** on this demo, so those two
  dropdowns are decoration here.
- The list arrives **pre-filtered to `Status = Working`**, which is why the count reads 124 — a
  resigned employee is invisible until you tick `Resign` in the Status funnel.

---

## What I did not press, and what I could not reach

**Deliberately not pressed** (each would write to, email from, or re-configure somebody else's
records — described from the screen instead): every `Update` / `Save` / `Save Configuration` on all
11 record cards and all 5 record dialogs · `Calculate` on the salary structure · the `Revise` link on
CTC · `Upload` on photo/documents/education · `Save` on assets · `Upload to Device` · `Delete` (both
the employee one and the onboard one) · every `Resign` button including `Update & Block` and
`Update & Delete` · the whole `Bulk Employees` dropdown including `Bulk Resign` · `Show Data` and
`Export to Excel` · `Preview`, `Import from Excel` and `Confirm Import` · `New Onboard`'s `Onboard`
button · the onboard row's `Approval` and `ReMail` · `Add New Head`'s `Save` · the three `Verify`
links on the FNF formulas · the `Grid`/`List` view toggle (it saves a view preference onto the
signed-in user) · switching any hidden column on (same reason).

**Could not reach, honestly:**

1. **The per-person Full & Final Settlement calculation.** All three buckets read 0, there is no
   table, and no other address is referenced. Getting one would mean resigning a real person.
   What it contains is inferred from the Master's five display switches, stated as inference in §7.
2. **The onboarding candidate's own form, and the `Approval` review screen.** All 13 rows are
   `Pending / Pending`; the candidate-facing form is served by a link in an email and its field list
   is configured on a screen in H12's scope.
3. **The column headers of the uploaded-documents and uploaded-education lists.** Empty on every
   record I opened, so I will not guess them.
4. **The names of the onboarding statuses other than `Pending`.** Nothing has progressed on the demo.
5. **The date-range funnel on the date columns.** Those columns are hidden by default and switching
   one on saves a preference. The screen's own code confirms a date-range filter and a separate
   Last-Punch rule set exists; I observed the Last-Punch one live (six ranges) and not the other.
6. **`Grid` (card) view rendered.** Described from the screen's own card builder — photo, name, code,
   company, location, department, category, status badge, last punch, resign date, same row menu.

---

## In human language — every feature in this area, as points

- **The staff list** — one long table of everybody who works here, with the code, name, place,
  company, department, grade, whether they are still working, and when they last touched the
  attendance machine. Master → Employee Master. It is the front door to every person's file.
- **Only the columns you care about** — the table can show 31 different things about a person but
  starts with eight. A settings button lets you tick on the rest — birth date, joining date, bank
  account, PAN, Aadhaar and so on. Master → Employee Master → the round blue button on the table.
  For an office that only ever looks at three things, the table stays short.
- **Pin a column so it never scrolls away** — the code, the name and the actions button stay stuck to
  the edges while you scroll sideways, and you can stick any other column too. Same settings button.
  Stops you losing track of whose row you are reading.
- **Search inside a single column** — the row of boxes under the headings lets you search the code or
  the name directly, instead of hunting the whole table.
- **Tick-list filters per column** — every other column has a small funnel that opens a tick-list of
  the values actually in use, with its own search. Tick Location 3 and Production and you get that
  department at that plant.
- **The list hides resigned people by default** — the Status filter arrives with only "Working"
  ticked. Tick "Resign" to see people who have left. So the number at the bottom is your live
  headcount, not everyone you ever employed.
- **Find people who have stopped showing up** — the Last Punch funnel offers six ready-made
  questions: not seen in 15, 30, 45, 60 or 90 days, or longer than 90 days. Master → Employee
  Master → the funnel on Last Punch. This is how you catch absconders before payroll pays them.
- **How many licences you have used** — the bottom of the list says how many staff your subscription
  allows and how many are counted right now (1000 allowed, 124 used here). Tells you when you need to
  buy more before you can add anybody.
- **Page size you choose** — 10, 20, 30, 50, 100, 500 or 1000 people per page.
- **Card view instead of a table** — the same list as photo cards with the key facts and the same
  menu, for people who prefer faces to rows. Same settings button → Grid.
- **A person's complete file** — click a name and you get everything the company holds about them, in
  eleven stacked sections you open one at a time. Master → Employee Master → View or Edit on a row.
- **Each section saves on its own** — every one of the eleven sections has its own save button, so
  you can fix somebody's phone number without touching their salary. Nothing you have not saved in
  one section is lost by saving another.
- **View-only opening of a file** — opening a person with View shows the same eleven sections with no
  save button, so you can read a file without any risk of changing it.
- **A shorter form for a brand-new joiner** — a new person's form only offers eight sections; family,
  salary and leave-balance sections appear once the person exists. You are not asked for a salary
  structure before the person is even created.
- **The joining and job details** — code, machine code, name, gender, birth date, joining date,
  status, and where they sit in the company: plant, company, division, department, section, grade,
  designation, cost centre and who they report to. This is the block payroll and attendance both
  read from.
- **A photo on the file** — upload a picture and click it to see it full size.
- **Weekly off, including a second one** — pick the person's weekly off day, or "no weekly off", or
  "same as their grade". Then optionally a second weekly off day, and which weeks of the month it
  applies in (1st, 2nd, 3rd, 4th, 5th). This is how alternate-Saturday offices are set up.
- **Overtime on or off per person** — a simple applicable / not applicable switch, plus an
  hourly overtime rate further down the file.
- **Which shift pattern and which holiday calendar they follow** — a shift group and a holiday group
  are chosen per person, so a factory line and the office can keep different calendars and different
  holidays under one company.
- **Two addresses, with a copy button** — a current address and a permanent address, each with lines,
  landmark, district, city, state, country and pincode, and a tick to copy one into the other.
- **Contact details and emergency numbers** — mobile, email, two emergency numbers and a driving
  licence number.
- **Attach the person's documents** — pick the kind (PAN, Aadhaar, driving licence, bank passbook,
  offer letter, appointment letter, termination letter, warning letter, voter ID, 10th, 12th,
  graduation, post-graduation, diploma), type the number, attach the file. Click an attached file to
  see it full size. Keeps the paper file inside the software.
- **Attach the person's qualifications** — the same, for graduate degree, master's, diploma, 12th and
  10th.
- **Family on record** — spouse name, number and birthday, number of children, both parents' names
  and numbers, and two more emergency contacts.
- **Two nominees, with a guardian if the nominee is a child** — name, relationship, birth date and
  number for each, plus a "is a minor" tick that asks for a guardian's name and relationship. This is
  what a PF or gratuity claim needs.
- **Company property issued to a person** — record each item given out: phone, keypad phone,
  motorcycle, scooter, laptop, desktop or SIM card, with make, model, serial number, value and a
  note. So when somebody leaves you know what to collect back.
- **Statutory numbers in one place** — UAN, PF number, ESIC number.
- **Bank details for paying them** — bank name from a list, account number and IFSC code.
- **Their cost to company, and the pay split** — one CTC figure and whether it is daily, monthly or
  yearly, plus a daily rate, an overtime hourly rate and a pay scale.
- **CTC is locked until you deliberately unlock it** — you cannot type into the CTC box; you press
  "Revise" first. Stops a salary being changed by accident while somebody is fixing an address.
- **The salary breakdown, head by head** — under the CTC sit two lists: what they earn (basic, HRA,
  special allowance, incentives, reimbursement and so on) and what is deducted (PF, loan, advance,
  canteen, other), each with its own amount, and totals that must add up to the CTC. Note that this
  is the **agreed** amount per head, not what they actually earned in a month — the actual earning is
  worked out by payroll.
- **A head can be a formula or a fixed number** — a switch on each line decides whether that head is
  calculated from the CTC or just held at a fixed amount (PF fixed at 1800 here).
- **Rebuild the whole breakdown from the rules** — a "Calculate" button re-derives every head from the
  company's formulas, after asking you to confirm.
- **Opening leave balances** — a small grid of the leave types (privilege, comp-off, casual, sick,
  medical, loss of pay) with a balance box each, for entering what a person is carrying in on day one.
- **Where they sit in the approval chain** — a hierarchy group and a level from General up to Level 5,
  which is what decides whose leave and attendance requests land on whose screen.
- **Whether they get notified** — a yes/no switch for notifications to that person.
- **Their self-service password, and a switch to lock them out** — the file holds the password the
  employee uses for the self-service app, and a "block employee self-service" tick that shuts their
  access off without deleting anything.
- **Caste and blood group** — kept for statutory reporting and for emergencies.
- **Send a person to the fingerprint machine** — pick a machine by name (it shows you whether that
  machine is online) and press "Upload to Device" to push the person onto it. This is how a new
  joiner starts being able to punch in.
- **Resign somebody, three ways** — from the list or from the file, mark a leaving date: type it
  yourself, use the last day they actually punched in, or use the end of that month. The screen tells
  you the last punch and the end date it worked out before you commit.
- **Resign and also clear them off the machine** — the same box offers "update and block" and
  "update and delete", which act on the fingerprint machine only, not on the software record. So the
  person stops being able to punch in, and their history survives.
- **Delete a person** — a last-resort option on the row menu, behind a confirmation.
- **Hold somebody's salary from a date** — a small dialog that freezes a person's pay from a chosen
  date, for a dispute or an unexplained absence. Nothing is deleted; the pay just stops.
- **Bring a leaver back** — a "rejoin" dialog with a date, for a person who returns.
- **Move somebody to a different grade** — the grade on the file is locked, because changing it
  changes their salary heads. It is changed only through its own dialog, behind a confirmation.
- **Change somebody's code, or their machine code** — its own dialog, showing the old code and the
  new one, with a warning that changing the machine code can affect their past attendance. You can
  change just the code, or both.
- **Change one thing for many people at once** — pick people with the tick boxes, then choose from
  eighteen bulk actions: move them to another company, designation, division, department, section,
  cost centre, shift group, holiday group, grade, leave grade or reporting manager, or change gender,
  weekly off, second weekly off, overtime, grade or hierarchy — or resign the whole group in one go.
  Master → Employee Master → the settings button → "Bulk Employees". Saves opening 40 files to move
  one production line to a new shift.
- **Export staff data to Excel, choosing your own columns** — six filters (company, division,
  department, grade, plant, working/resigned), a search on any one field, then a tick-list of about
  70 possible columns grouped into basic, organisation, work, documents, addresses, family and
  nominees, with group-level ticks and a chip list of what you picked. Preview on screen, then send
  to Excel. Master → Employee Master → settings button → Export. For giving the auditor exactly the
  eight columns they asked for and nothing else.
- **Import staff from a spreadsheet, or from a paste** — attach an Excel file, or just paste rows
  with their heading line, preview what the system read, then import. Master → Employee Master →
  settings button → Import.
- **An import asks for your password again** — before a bulk import actually runs, it asks you to
  re-enter your user ID and password. A mass change to the staff list cannot happen because somebody
  walked past an unlocked screen.
- **Invite a new joiner to fill in their own file** — instead of typing everything yourself, enter
  just their name, email, phone, company, department and designation, and press Onboard. Master →
  Employee Onboarding → New Onboard. The person gets a link and does the typing.
- **A waiting list of people who are joining** — a table of everyone invited, with a temporary
  reference (TMP14), their name and company. Master → Employee Onboarding. Thirteen people are
  waiting on this demo.
- **Two separate progress marks per joiner** — one for your side ("has HR dealt with this?") and one
  for theirs ("has the person filled it in?"). So you can see at a glance whether you are waiting on
  the candidate or the candidate is waiting on you.
- **Search the joining list** — by the temporary reference or by name.
- **Chase a joiner who has not replied** — a "re-mail" action re-sends the invitation.
- **Read what a joiner submitted, and correct it** — view and edit actions on each waiting row, so HR
  can fix a spelling before the person becomes a real employee.
- **Turn a joiner into an employee** — an "approval" action on the row is what converts the temporary
  record into a full staff file.
- **Drop a joiner who never came** — a delete action, behind a confirmation.
- **Decide what a final settlement is made of** — a list of settlement lines you define yourself,
  each marked as something paid or something recovered, with a name, the wording that should appear on
  the printed settlement, and a display order. Master → Employee Offboarding → Full and Final Master.
  Nothing is defined on this demo yet.
- **Sort and filter your settlement lines** — filter by paid-versus-recovered, order by number or by
  name, ascending or descending.
- **Write the gratuity rule** — a formula box for how gratuity is worked out, plus how many years of
  service qualify and how part-months are rounded. Master → Employee Offboarding → Full and Final
  Master → FNF Settings.
- **Write the notice-pay rule** — a formula box for what is recovered when somebody leaves without
  serving notice, plus a switch for whether notice period applies at all, and a tick-list to make it
  apply only to certain grades.
- **Write the bonus rule** — a formula box for any bonus owed on the way out.
- **Check a formula before you save it** — a "verify" link beside each of the three formulas tells
  you whether the expression makes sense, instead of finding out when somebody's last payment is
  wrong.
- **Make a settlement compulsory for certain grades** — a switch plus a grade tick-list, so no one in
  those grades can be closed off without a settlement being done.
- **Choose what the settlement sheet shows** — five switches: their salary structure, their earnings,
  their deductions, the company property they hold, and money to be recovered from loans. All five
  are on. This is the table of contents of the final settlement.
- **Track every leaver's settlement in three stages** — three counters you can click through: not
  started, in progress, and completed. Master → Employee Offboarding → Full and Final Settlement.
  All three are zero on this demo, so the actual per-person calculation screen could not be opened —
  it appears when there is somebody in one of these three groups.
- **Search a leaver in the settlement list** — a search box over the three groups.

---

*(68 plain-language points above.)*
