# H17 — HRMex: Leave (8 screens) · Attendance Calculation · Loan And Advance

**Product:** HRMex 10.0.0.0 at `https://demo.hrmexweb.in` (ASP.NET WebForms, server-rendered).
**Captured:** 2026-09-07, signed in once as `Superadmin` through the shared helper.
**Scope:** Attendance part 2 of 2 — all of Leave, the month-end Attendance Calculation, the whole
Loan And Advance menu.
**Method:** every screen below was **opened live in a real browser**. Where a control would write
(Save / Update / Calculate / Create batch / Run batch / Import / Delete) the control is described and
was **never pressed**. Read-only actions (`Show`, `Filter`, `Add`→form, `Edit`→form, `Configure`) were
pressed, because that is the only way to see the form and the output columns.
**Evidence screenshots:** `.claude/capture/shots/H17/` (4 files).

**Screens opened live: 25 distinct addresses** (the 16 menu items in scope, plus the 8 add/edit/import
sub-screens they lead to, plus one confirming read of Master Settings). Expected ~14.

---

## Two things that are true on every screen in this scope (said once, not repeated)

- **The demo's people:** 173 employees, `EMP001 … EMP173`, all named `Test 1 … Test 173`. Wherever a
  screen has an `Employee Name` dropdown it is this same list. Two spellings exist across screens:
  `EMP001:Test 1` (no spaces, on the Leave screens) and `EMP001 : Test 1` (spaced, on the Loan
  screens and Leave Ledger). Some lists prepend `All`, some prepend `Select`, some have neither.
- **The demo's org lists**, used by every filter block: **Company** (2: `Company 1`, `Company 2`) ·
  **Division** (9: `Division 1 … Division 9`) · **Category** (7: `Category 1 … Category 7`) ·
  **Department** (21: `Default · Marketing · Dispatch · Production · Accounts · Loading · STORE ·
  Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing · Safety ·
  RM & Con Store · Production Pardi · QC PARDI · Admin · IT`). Filters prepend `All`.
  Note the app's own typo: the Category filter is labelled **`Categorgy`** on Leave Entry, Leave
  Opening, Loan Manage and Loan Prepayment (spelled correctly on Leave Statement and Loan Statement).
- **Leave types on this demo (6):** `PL · COFF · CL · SL · ML · LOP`.
- **Loan types on this demo (3):** `LOAN · ADVANCE · HOME_LOAN`.

---

# PART 1 — LEAVE

## 1.1 Leave Type — `/Leave/LeaveTypes_Mst.aspx?MenuId=17`

**Where:** Attendance ▸ Leave Type. The list of leave kinds the company recognises.

**What you see on arrival:** a page titled *Leave Types Master*, breadcrumb `Home / Leave Types
Master`, one blue **[Add Leave Type]** button at the top, and directly under it a single plain table.
No filters, no search box, no paging — six rows and that is the whole screen.

**Numbers/cards on the page:** none. This screen counts nothing.

**Table — `Leave Type Name | Short Name | (edit) | (delete)`** — 6 rows:

| Leave Type Name | Short Name |
|---|---|
| PL | PL |
| COFF | COFF |
| CL | CL |
| SL | SL |
| ML | ML |
| LOP | LOP |

**Row actions:** every row carries `[  Edit  ]` and `[  Delete  ]`. Delete asks first — the browser
confirm reads exactly **"Do you want to Delete ?"**.

**Controls, in order:**
1. **[Add Leave Type]** → navigates to `/Leave/LeaveType_AU.aspx?MenuId=17`.
2. **[Edit]** (per row) → the same address, pre-filled with that row.
3. **[Delete]** (per row) → confirm, then removes the row.

**The form — `Leave Type` on `/Leave/LeaveType_AU.aspx`** (opened live, Add and all six Edits):

| Field | Type | Required | Default |
|---|---|---|---|
| Leave Type Name | text | — | empty on Add |
| Short Name | text | — | empty on Add |
| ☐ Is Hourly Leave | checkbox | — | **unchecked** |

One button: **[Save]** (it reads `Update` when you arrived via Edit). No dropdowns on this form.

**I opened all six leave types' Edit forms.** `Is Hourly Leave` is **unchecked on every one** — no
leave type on this demo is hourly. That matters later (see §1.2, the hourly block).

**Empty state:** not observable — six rows exist.
**Realtime/auto:** nothing moves on its own.

> **⭐ The point of this screen: it is deliberately almost empty.** A leave type here is just a name
> and a short code. Every actual rule — how many days, when it accrues, whether it carries forward,
> whether it can be cashed — lives one layer up, on the screen below.

---

## 1.2 ⭐ Leave Level Master — the leave policy engine — `/Master/LeaveLevel_Mst.aspx?MenuId=44`

**Where:** Master ▸ Leave Level Master. *(Strictly a Master-menu screen, but it is where the whole
leave policy lives, so this document would be useless without it. Captured in full.)*

**What you see on arrival:** *Leave Level Master*, a **[New Leave Level]** button, a `Search :` box,
and a one-column table of staff classes.

**Table — `Leave Level Name | (edit) | (delete)`** — 5 rows:
`Office Staff · HOD · Worker · Maintenance & QC Staff · Production Staff`.
Each row has `[Edit]` and `[Delete]` (delete confirms with "Do you want to Delete ?").

**[New Leave Level]** opens a small dialog *Leave Level*: `Level Name` (text) + `☐ Allow Quarter
Leave` (checkbox, unchecked), buttons `[×] [Close] [Save]`. That is all a *new* level gets.

### The real screen: **[Edit] a level → `/Master/LeaveLevel_AU.aspx?MenuId=44`**

Titled **Leave Level Management**, with three stacked panels:

**Panel 1 — `Leave Level Configuration`**
- `Leave Level Name` (text, pre-filled — e.g. `Office Staff`)
- `☐ Allow Quarter Leave` (checkbox — unchecked on Office Staff)
- **[Save Configuration]**

**Panel 2 — `Leave Type Management`** — a grid with **one row per leave type**, 6 rows:

| Active | Leave Type | Yearly Limit | Carry Limit | |
|---|---|---|---|---|
| ☑ | PL | 0 | 0 | [Configure] |
| ☑ | COFF | 0 | 0 | [Configure] |
| ☑ | CL | 0 | 0 | [Configure] |
| ☑ | SL | 0 | 0 | [Configure] |
| ☑ | ML | 0 | 0 | [Configure] |
| ☑ | LOP | 0 | 0 | [Configure] |

*(that is Office Staff — all six ticked. On **Worker**, all six are **unticked** and the Yearly/Carry
Limit cells are **blank**, not `0`. So a level that has never been configured looks visibly different
from one that has.)*

**Panel 3 — the `[Configure]` dialog: `Leave Configuration Details`.** This is the policy.

### ⭐ EVERY SWITCH IN THE POLICY DIALOG — written out for two leave types

Opened live for **PL, COFF, CL and LOP** on the **Office Staff** level. The dialog is laid out in
**five labelled sections** (the headings are printed on screen in small grey capitals):

#### Section `LEAVE & LIMITS`

| # | Label on screen | Control | PL (Office Staff) | COFF (Office Staff) |
|---|---|---|---|---|
| 1 | **Leave Name** | text, **read-only / greyed** | `PL` | `COFF` |
| 2 | **Yearly Limit** | number box | `0` | `0` |
| 3 | **☐ Is Carry Forward** | checkbox | **unchecked** | **unchecked** |
| 4 | **Carry Limit** | number box — **hidden until `Is Carry Forward` is ticked** | `0` (hidden) | `0` (hidden) |
| 5 | **Allowed After (days)** | number box | **`180`** | **`0`** |

#### Section `ACCRUAL & VISIBILITY`

| # | Label on screen | Control | PL | COFF |
|---|---|---|---|---|
| 6 | **☐ Auto Deduction (Monthly)** | checkbox | unchecked | unchecked |
| 7 | **☐ Auto Credit (Monthly)** | checkbox | unchecked | unchecked |
| 8 | **☐ Is Visible** | checkbox | unchecked | unchecked |
| 9 | **☑ Include WO in Leave** | checkbox | **CHECKED** | **CHECKED** |
| 10 | **☐ Credit Leave With Formula (Yearly)** | checkbox | unchecked | unchecked |
| 11 | **☐ Allow Negative Balance** | checkbox | unchecked | unchecked |
| 12 | **☐ Auto Credit Opening** | checkbox | unchecked | unchecked |

#### Section `HOURLY` — *present in the dialog's markup, shown only for an hourly leave type*

These six controls exist in the dialog but **were not rendered for any of the four leave types I
configured**, because `Is Hourly Leave` is unchecked on all six leave types (§1.1). They are recorded
here from the dialog's own markup, and are labelled as markup-only:

| # | Label | Control | Default in markup |
|---|---|---|---|
| 13 | **☐ Late** | checkbox | unchecked |
| 14 | **☐ MidDay** | checkbox | unchecked |
| 15 | **☐ Early** | checkbox | unchecked |
| 16 | **Limit** | number box | empty |
| 17 | **Duration (Mins)** | number box | empty |
| 18 | **Hourly Leave Restriction** | dropdown — **2 options, both listed**: `Do not approve request` *(selected)* · `Mark Late Beyond Time Duration` | `Do not approve request` |

#### Section `DEBIT & COFF`

| # | Label on screen | Control | PL | COFF |
|---|---|---|---|---|
| 19 | **Monthly Debit Limit** | number box | `0` | `0` |
| 20 | **Batch Debit Limit** | number box | `0` | `0` |
| 21 | **Batch Debit Duration** | number box | `0` | `0` |
| 22 | **☐ Is Coff Enjoy First** | checkbox | unchecked | unchecked |
| 23 | **Coff Expiry (days)** | number box | `0` | `0` |

#### Section `ENCASHMENT`

| # | Label on screen | Control | PL | COFF |
|---|---|---|---|---|
| 24 | **☐ Is Encashable** | checkbox | unchecked | unchecked |
| 25 | **Encash Limit** | number box — **hidden until `Is Encashable` is ticked** | `0` (hidden) | `0` (hidden) |
| 26 | **Encash Formula** | textarea — **hidden until `Is Encashable` is ticked** | empty (hidden) | empty (hidden) |

#### Section `FORMULAS`

| # | Label on screen | Control | PL | COFF |
|---|---|---|---|---|
| 27 | **Credit Formula (yearly)** + a blue **`Check`** link | textarea, placeholder `Credit formula` | *empty* | **a real formula, see below** |
| 28 | **Opening Credit Formula** + a blue **`Check`** link | textarea, placeholder `Opening formula` | *empty* | *empty* |

**COFF's live Credit Formula (yearly), exactly as stored:**
```
if (ExtraMins >= FullDayMins)
{
     Result =1;
}
else
{
 Result  =0 ;
}
```
*(i.e. "if the extra minutes worked reach a full day's minutes, credit 1 comp-off day, else credit
nothing." The two `Check` links are formula validators sitting beside each box.)*

**Dialog buttons:** `[×]` (top right) · **[Close]** · **[Update Configuration]**.
The dialog is **modal and sticky** — `data-backdrop="static"`, `data-keyboard="false"`, so it cannot
be dismissed by clicking outside it or pressing Escape; you must use Close or ×.

**So the honest count is 28 controls, not 15** — 23 of them visible for a normal (non-hourly) leave
type, of which 3 more only appear once their parent checkbox is ticked. **× 6 leave types × 5 leave
levels = 840 individual settings** the demo exposes without a line of code.

**Which switches actually differ between two leave types on the same level?** On Office Staff, PL vs
COFF differ in exactly two places: **`Allowed After (days)` = 180 for PL and 0 for COFF**, and
**COFF carries a Credit Formula while PL does not.** Everything else is identical. CL matches PL
(180); LOP matches COFF (0). That is the real-world shape: a probation gate on earned leave, none on
comp-off or loss-of-pay, and the accrual maths only where leave is *earned* rather than *granted*.

---

## 1.3 Leave Entry — `/Leave/LeaveEntry_Mst.aspx?MenuId=18`

**Where:** Attendance ▸ Leave Entry. Where somebody's leave is actually put on the calendar.

**What you see on arrival:** a page titled *Leave Entry Master* with a **collapsed blue `Filter`
card** (funnel icon, a `−` collapse tool and an `×` remove tool on the right) and a
**[New Leave Entry]** button. **Nothing else. There is no list of existing leave entries.**

**The `Filter` card** (expand it by clicking the blue header) holds:
`Date From` (date box, defaults to today, `07-09-2026`) · `Date To` (same default) ·
`Employee Name` (dropdown, `All` + 173) · `Company` (`All`+2) · `Division` (`All`+9) ·
`Categorgy` (`All`+7) · `Department` (`All`+21) · **[Filter]**.

**Empty state:** I pressed **[Filter]** with the defaults. **The screen returns no grid and no
message at all** — the page below the filter stays blank. See *Odd things I noticed*.

**[New Leave Entry] → `/Leave/LeaveEntry_AU.aspx?MenuId=18`** *(opened live)* — and this is the
screen worth copying:

**Layout:** a four-field row across the top, then a `Search :` box, then a big employee grid, then
one **[Save]**.

| Field | Type | Options / default |
|---|---|---|
| **Leave Status** | dropdown | **2 options, both listed:** `FullDay` · `HalfDay` — default `FullDay` |
| **From Date** | date box | empty |
| **To Date** | date box | empty |
| **Leave Type** | dropdown | **6 options:** `PL · COFF · CL · SL · ML · LOP` — default `PL` |

**The grid — `☐ | Emp ID | Emp Code | Employee Name | Location | Company | Division | Department |
Category | Balance Leave`.** 80 rows rendered on the page I opened. The header checkbox is a
**check-all**. `Search :` filters the grid as you type.

**Live values from the grid — and the interesting column is the last one:**

| ☐ | Emp ID | Emp Code | Employee Name | Location | Company | Division | Department | Category | Balance Leave |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | 1 | EMP001 | Test 1 | Location 2 | Company 2 | Division 2 | Marketing | Category 4 | **12** |
| ☐ | 2 | EMP002 | Test 2 | Location 2 | Company 2 | Division 2 | Marketing | Category 2 | **5** |
| ☐ | 3 | EMP003 | Test 3 | Location 2 | Company 2 | Division 2 | Dispatch | Category 4 | **7** |
| ☐ | 5 | EMP005 | Test 5 | Location 2 | Company 2 | Division 2 | Production | Category 2 | **0** |
| ☐ | 7 | EMP007 | Test 7 | Location 2 | Company 2 | Division 2 | Production | Category 6 | **−5** |

**`Balance Leave` shows a negative number (−5) for a real employee** — proof that
`Allow Negative Balance` (switch 11) is doing its job somewhere in this dataset.

**One button: [Save].** Not pressed. What it claims to do: apply *one* date range, *one* leave status
and *one* leave type to *every ticked employee* at once.

> **⭐ Copy this pattern.** One date range, many people, and **each person's remaining balance is
> visible in the row while you tick them.** You never have to leave the screen to check whether
> somebody can afford the leave you are about to give them.

---

## 1.4 Leave Opening — `/Leave/Leave_Opening.aspx?MenuId=19`

**Where:** Attendance ▸ Leave Opening. The starting balance each person begins a leave year with.

**What you see on arrival:** *Leave Opening* (breadcrumb says *Employee Leave Opening*), a collapsed
blue `Filter` card, an **[Excel Import]** button, and a `Search` box.

**The `Filter` card:**

| Field | Type | Options | Default |
|---|---|---|---|
| Leave Year | dropdown | **6:** `2022 · 2023 · 2024 · 2025 · 2026 · 2027` | `2026` |
| Leave Type | dropdown | **6:** `PL · COFF · CL · SL · ML · LOP` | `PL` |
| Employee Name | dropdown | `All` + 173 | `All` |
| Company | dropdown | `All` + 2 | `All` |
| Division | dropdown | `All` + 9 | `All` |
| Categorgy | dropdown | `All` + 7 | `All` |
| Department | dropdown | `All` + 21 | `All` |
| **[Filter]** | button | | |

**I pressed [Filter]. The output grid — and the old capture never saw it:**

`Emp Code | Employee Name | Company Name | Department Name | **Allowed Leaves**`

**`Allowed Leaves` is an editable text box in every row.** 23 rows per page with a **numeric pager
(1 … 9)** underneath. Live values on the first page ran `0` for most rows and `6` for several
(EMP159, EMP156, EMP155, EMP154, EMP153…). Rows come back newest-code-first (`EMP173` at the top).

There is **no Save button on this screen.** You type into the boxes, and the only write control the
screen offers is Excel Import. *(I did not press anything, so I cannot say how a typed value is
committed — see* Odd things I noticed*.)*

**[Excel Import] → `/Leave/Leave_Import.aspx`** — a shared screen titled **Leave Import**, subtitle
**Leave Import  File Format**, where `File Format` is a **download link to a sample workbook**
(`/Sample_Files/LeaveImport.xlsx`).

| Field | Type | Options | Default |
|---|---|---|---|
| Leave Year | dropdown | 6 (`2022…2027`) | `2026` |
| Leave Type | dropdown | 6 (`PL…LOP`) | `PL` |
| Import Leave From Excel | **file picker** (`Choose file`) | | empty |
| *`-----OR-----`* (printed between them) | | | |
| Paste Data Here | large textarea | | empty |
| **[Preview]** | button | | |

*Upload OR paste — and the button says **Preview**, not Import.* Not pressed.

---

## 1.5 Leave CarryForward — `/Leave/Leave_Transaction.aspx?MenuId=60`

**Where:** Attendance ▸ Leave CarryForward. Carrying last year's unused leave into this year.

**What you see on arrival:** *Leave Transaction*, an **Advanced Filters** strip across the top, then
a helper sentence, then a wide grid with an empty-state message.

**The helper sentence, printed on screen, verbatim:**
> *"Select rows in the grid to create a leave-type batch. One batch is created per leave type
> (e.g. EL separately from PL). Batch is optional for direct processing."*

**Advanced Filters:**

| Field | Control | Options | Default |
|---|---|---|---|
| Leave Month | month box | | `Sep/2026` |
| Leave Year | dropdown | **only one option: `2026`** | `2026` |
| **Leave Type (carry forward)** | custom drop-down (a button + a searchable tick-list) | **the list is EMPTY** | label shows `â€"` |
| Category | custom drop-down + `Search…` + `Select All` | 7 categories | `All` |
| Company | same | 2 companies | `All` |
| Division | same | 9 divisions | `All` |
| Department | same | 21 departments | `All` |
| **[Show]** · **[Export]** · **[Show Batch Panel]** | buttons | | |
| `Search` | free-text box, filters the grid | | |

**Main grid (12 columns):**
`☐ | EMP CODE | EMPLOYEE NAME | COMPANY NAME | LEAVE | OPENING PRESENT | OPENING ABSENT | PRESENT |
ABSENT | PREV. BALANCE | THIS YEAR | TOTAL BALANCE`

**Empty state, verbatim:** *"No data loaded. Set filters and click Show."*

**I pressed [Show].** It returned the empty state again — **because the `Leave Type (carry forward)`
picker has no options to choose.** I opened the picker and it stayed empty; the other four pickers
populated correctly (7 / 2 / 9 / 21 entries). So **this screen cannot be driven on this demo.**
Everything below is therefore captured from the screen's own markup, honestly labelled.

**[Preview & create batch]** → modal **`Preview batch`**
- grid `Include | Emp code | Employee | Company | Leave type | Balance`
- one field: `Batch name prefix` (text)
- buttons `[×] [Cancel] [Create batch(es)]` — **a write. Not pressed.**

**[Show Batch Panel]** → modal **`Batch`**
- upper grid `Emp Code | Employee Name | Company Name | Leave | Opening Present | Opening Absent |
  Present | Absent | Prev. Balance | This Year | Total Balance | **Allowed (batch)**`
- lower results grid `☐ | Emp Code | Employee | Leave | Allowed | Status | Message | Rev | Rem`
- buttons `[×] [Close] [Run full batch] [Proceed selected]` — **both writes. Not pressed.**
- a check-all on the results grid

**Batch list grid:** `Batch Name | Leave Type | Status | Total | Pending | Done | Failed | Action`.
Its empty state reads **"No batch found."**

**Also present but not visible:** four unlabelled buttons (`Create Batch`, `Refresh Batches`,
`Run Batch`, `Reset Batch`) and two hidden fields (`Batch Name`, an existing-batch dropdown) — the
panel's plumbing.

**[Carry forward history report]** → `/Leave/Leave_CarryForward_Report.aspx`. **I opened it. It
errors out** to the app's friendly failure page: *"😏 Houston, we have a tiny glitch. Don't worry —
your data is safe. Our code just took an unexpected coffee break."* with a `Reference: HRM-OOPS-…`
code and `[Back to Home] [Go Back]`.

> **⭐ The design worth copying anyway:** preview → named batch → run → per-row `Status / Message` →
> a re-runnable batch with `Pending / Done / Failed` counters. A bulk job that shows you exactly what
> it is about to do, then tells you row-by-row what happened, and lets you retry only the failures.

---

## 1.6 Leave Credit — `/Leave/Leave_Credit.aspx?MenuId=61`

**Where:** Attendance ▸ Leave Credit. Adding this month's earned leave onto everybody's balance.

**What you see on arrival:** *Leave Credit* (breadcrumb *Employee Leave Credit*) — a very small
screen. Two fields, two buttons, a search box, nothing else.

| Field | Type | Options | Default |
|---|---|---|---|
| **Leave Month** | month box | | **empty** |
| **Leave Type** | dropdown | **6:** `PL · COFF · CL · SL · ML · LOP` | `PL` |
| **[Show]** | button | | |
| **[Excel Import]** | button | | |
| `Search` | text box | | |

**I pressed [Show]** — with the month blank, and again with `Sep/2026` typed in. **Both times the
screen returned nothing: no grid, no columns, no "no records" line.** So the columns this screen
would show are not recorded here, because I could not make it show them.

**[Excel Import]** goes to the **same** `/Leave/Leave_Import.aspx` screen described in §1.4 —
one shared import screen for both Opening and Credit. *(Its breadcrumb still says "Leave Opening"
even when you arrive from Leave Credit.)*

---

## 1.7 Leave enCashment — `/Leave/Leave_EnCashment.aspx?MenuId=62`

**Where:** Attendance ▸ Leave enCashment. Paying somebody money instead of giving them the day off.

**What you see on arrival:** *Leave Encashment*, split into **two independent blocks**: an entry form
at the top, and an encashment **history** search underneath with its own filters and grid.

**Block 1 — the entry form:**

| Field | Type | Options | Default |
|---|---|---|---|
| **Encashment Date** | date box | | **`07-Sep-2026`** (today) |
| **Emp Name** | dropdown | `Select` + **124 employees** *(fewer than the usual 173 — this list is filtered)* | `Select` |
| **Leave Type** | dropdown | **only `Select`** | `Select` |
| **Leaves to Encash** | number box | | empty |
| **[Save]** | button | | **a write. Not pressed.** |
| **[Excel Import]** | button | | **a write. Not pressed.** |

**I selected `EMP001 : Test 1` to see the Leave Type list fill in. It did not — it stayed at
`Select` alone.** Consistent with §1.2: `Is Encashable` is unticked on every leave type on this demo,
so there is nothing encashable to pick. **This screen cannot be driven here either.**

**Block 2 — `Encashment history`:**

| Field | Type | Options | Default |
|---|---|---|---|
| Month | month box | | empty |
| Company | dropdown | `All` + 2 | `All` |
| Category | dropdown | `All` + 7 | `All` |
| Department | dropdown | `All` + **18** *(alphabetised, and shorter than the 21 elsewhere)* | `All` |
| Division | dropdown | `All` + 7 *(shorter than the 9 elsewhere)* | `All` |
| **[Apply Filter]** | button | | |

**History grid:** `EMP CODE | EMPLOYEE NAME | AVAILABLE BALANCE | LEAVES ENCASHED | AMOUNT`
**Empty state, verbatim:** *"No encashment history."*

---

## 1.8 Leave Statement — `/Leave/Leave_Statement.aspx?MenuId=63`

**Where:** Attendance ▸ Leave Statement. Everybody's leave balances on one page.

**What you see on arrival:** *Leave Statement* with a **[Settings]** button top-right, an
**Advanced Filters** strip, a `Type to filter...` box, and **[Show] [Export]**.

**Advanced Filters** — five of the seven are the *modern* multi-select style (a button showing `All`,
which opens a tick-list with its own `Select All`), not plain dropdowns:

| Field | Control | Options | Default |
|---|---|---|---|
| Leave Month | month box | | `Sep/2026` |
| Leave Year | plain dropdown | **6:** `2022 · 2023 · 2024 · 2025 · 2026 · 2027` | `2026` |
| **Leave Type** | multi-select tick-list + `Select All` | `PL · COFF · CL · SL · ML · LOP` | button reads `All` |
| **Category** | multi-select + `Select All` | 7 categories | `All` |
| **Company** | multi-select + `Select All` | 2 companies | `All` |
| **Division** | multi-select + `Select All` | 9 divisions | `All` |
| **Department** | multi-select + `Select All` | 21 departments | `All` |

**[Settings]** → modal titled **`Settings`** containing exactly one control: **`☐ Show Present`**
(unchecked). Buttons `[×] [Close]` — there is **no Save on the settings modal**.

**I pressed [Show]. Real output — 512 rows:**

`empid | EmpCode | EmployeeName | Company_Name | LeaveName | OpeningLeave | CreditLeave | DebitLeave |
EnCashLeave | **AdvanceLeave** | balanceLeave`

One row **per employee per leave type**, with the employee/company cells **row-span merged** down the
block so each person appears once. Live sample:

| EmpCode | EmployeeName | Company_Name | LeaveName | Opening | Credit | Debit | EnCash | Advance | Balance |
|---|---|---|---|---|---|---|---|---|---|
| EMP001 | Test 1 | Company 2 | CL | 3 | 0 | 0.00 | 0 | 0.00 | 3 |
| ″ | ″ | ″ | COFF | 0 | 0 | 0.00 | 0 | 0.00 | 0 |
| ″ | ″ | ″ | LOP | 0 | 0 | 0.00 | 0 | 0.00 | 0 |
| ″ | ″ | ″ | ML | 0 | 0 | 0.00 | 0 | 0.00 | 0 |
| ″ | ″ | ″ | PL | 12 | 0 | 0.00 | 0 | 0.00 | 12 |
| ″ | ″ | ″ | SL | 1 | 0 | 0.00 | 0 | 0.00 | 1 |
| EMP002 | Test 2 | Company 2 | SL | 3.5 | 0 | 0.00 | 0 | 0.00 | **3.5** |

Balances are held in **half-days** (`3.5`), matching the `FullDay / HalfDay` choice on Leave Entry.
Note also that people are listed with **different numbers of leave rows** (EMP003 has 4, EMP001 has
6) — a leave type only appears for someone whose Leave Level has it ticked Active.

**[Export]** — a spreadsheet export. Not pressed.
`Type to filter...` filters the rendered rows client-side.

---

## 1.9 Leave Ledger — `/Leave/LeaveLedger.aspx?MenuId=217`

**Where:** Attendance ▸ Leave Ledger. One person's leave story, month by month.

**What you see on arrival:** *Leave Ledger*, four controls in a row, `[Show]`, and an empty grid.

| Field | Control | Options | Default |
|---|---|---|---|
| **Employee Name** | plain dropdown | 173 employees, **no `All`** | `EMP001 : Test 1` |
| **Leave Year** | plain dropdown | **7:** `Please Select · 2022 · 2023 · 2024 · 2025 · 2026 · 2027` | `2026` |
| **Salary Month to** | month box | | `Sep/2026` |
| **Leave Type** | multi-select tick-list + `Select All` | `All · PL · COFF · CL · SL · ML · LOP` | button reads `All` |
| **[Show]** | button | | |
| **[Print]** | button — **hidden until a result exists** | | |

**I pressed [Show] for EMP001. Real output — 55 rows:**

`Period | Leave Type | Opening Balance | Credit | Debit | Encash | Closing Balance`

| Period | Leave Type | Opening | Credit | Debit | Encash | Closing |
|---|---|---|---|---|---|---|
| Jan/2026 | PL | 12.00 | – | – | – | 12.00 |
| ″ | COFF | – | – | – | – | – |
| ″ | CL | 7.00 | – | **2.00** | – | **5.00** |
| ″ | SL | 5.00 | – | **3.00** | – | **2.00** |
| ″ | ML | – | – | – | – | – |

Empty cells print as **`–`**, not `0`. `Period` is row-span merged, so each month shows once with its
leave types under it. It runs from January of the chosen year up to the `Salary Month to` you set.

---

## 1.10 How a leave balance is actually arrived at

Reading only what these screens print, per **employee × leave type × leave year**:

```
Closing Balance  =  Opening Leave           (Leave Opening, or "Auto Credit Opening"/Opening Credit Formula)
                 +  Credit Leave            (Leave Credit, monthly; or Auto Credit (Monthly); or the yearly Credit Formula)
                 +  Carry Forward           (last year's leftover, brought over by Leave CarryForward, capped by Carry Limit)
                 −  Debit Leave             (leave actually taken — from Leave Entry, and from ESS requests)
                 −  EnCash Leave            (days paid out as money instead of taken)
                 −  Advance Leave           (leave taken BEFORE it had accrued — the "borrowed" column)
```

- **The Leave Statement prints exactly these six ingredients side by side**
  (`OpeningLeave | CreditLeave | DebitLeave | EnCashLeave | AdvanceLeave | balanceLeave`), which is
  why it is the screen a payroll clerk actually lives in.
- **The Leave Ledger prints the same sum one month at a time**
  (`Opening Balance → Credit → Debit → Encash → Closing Balance`), so each month's closing figure is
  the next month's opening figure.
- **`Yearly Limit`** (switch 2) caps how much can be credited in a year; **`Monthly Debit Limit`**
  and **`Batch Debit Limit`** (19, 20) cap how much can be taken at once; **`Allowed After (days)`**
  (5) blocks the whole leave type until the person has been employed that many days.
- **`Allow Negative Balance`** (11) is what lets the number go below zero — I saw `Balance Leave: −5`
  on a live row in Leave Entry.
- **`Is Coff Enjoy First`** (22) decides the order things are spent in: burn comp-off before earned
  leave. **`Include WO in Leave`** (9) decides whether a weekly-off day sitting inside a leave span
  gets counted as leave or skipped over.
- Carry-forward is **not** automatic — it is a deliberate, previewed, batched job (§1.5).

---

# PART 2 — ATTENDANCE CALCULATION

## 2.1 Attendance Calculation — `/Attendance/Attendance_Calculation.aspx?MenuId=64`

**Where:** Attendance ▸ Attendance Calculation. The month-end button that turns raw punches into
counted days. **I opened it and read it. I did NOT press Calculate.**

**What you see on arrival** (screenshot `03-attendance-calculation.png`): a white card headed
*Attendance Calculation* holding two date boxes; below it a **blue `Filter` card** (funnel icon,
with a `−` collapse tool and an `×` remove tool); inside the Filter card four bordered panels;
and at the very bottom a grey action bar with two radio buttons, one blue button, and a progress bar.

**Every parameter it takes:**

| # | Parameter | Control | Options | Default |
|---|---|---|---|---|
| 1 | **Date From** | date box + calendar icon | | **`07-09-2026`** (today) |
| 2 | **Date To** | date box + calendar icon | | **`07-09-2026`** (today) |
| 3 | **☐ Employee** | panel master checkbox *(this panel has **no** "Select All")* | | unchecked |
| 4 | **Employee Name** | dropdown inside that panel | `All` + 173 employees | `All` |
| 5 | **Category** | dropdown inside that panel | `All` + 7 categories | `All` |
| 6 | **☐ Company** + **☐ Select All** | panel with a tick-list | `Company 1` · `Company 2` | all unchecked |
| 7 | **☐ Division** + **☐ Select All** | panel with a tick-list | `Division 1 … Division 9` | all unchecked |
| 8 | **☐ Department** + **☐ Select All** | panel with a tick-list | the 21 departments | all unchecked |
| 9 | **○ Pending Entries** | radio | | **unchecked** |
| 10 | **○ All Entries** | radio | | **unchecked** |

**The run button — its exact wording is `Calculate`.** It is a blue button in the bottom bar, and it
**disables itself the moment it is clicked** (`this.disabled=true` before the postback fires) so it
cannot be double-run.

**What the screen says it will do:** nothing — there is no explanatory sentence anywhere on it. The
only statement of intent is the pair of radios: **`Pending Entries`** (only the days not yet
calculated — an incremental run) versus **`All Entries`** (recalculate everything in the date range
from scratch). Neither is pre-selected.

**While it runs:** a **progress bar sits under the radios, reading `0%`**, and it fills as the job
goes. **When it finishes with problems:** a modal (`modal-message`) opens containing a **read-only
error textarea** and a single **[Close]** button — a plain text log of every row that failed.

**What it produces, and who consumes it** — from the screens I have seen:

The Calculate step reads raw device punches for the chosen people over the chosen dates and writes
**one attendance-day row per person per day**, carrying that day's status (Present / Absent /
Half Day / Weekly Off / Holiday / On Duty / Leave), the in/out times, and the late/early/overtime
minutes. Downstream:

- **Leave** — the day rows are what turn a leave entry into a `DebitLeave` figure, and (via the COFF
  credit formula, which tests `ExtraMins >= FullDayMins`) what earns comp-off. Everything in
  §1.8/§1.9 is downstream of this button.
- **Attendance Checklist / Attendance Voucher / Monthly Attendance Voucher** — the review screens
  where a human corrects a day before payroll (other terminals' scope).
- **Payroll ▸ Collect Attendance → Salary Process** — payroll reads the counted days, not the punches.

> **⭐ Three things to copy from this one screen:** *incremental vs full recompute as an explicit
> choice*, *a visible progress bar so a long job never looks frozen*, and *an error log you can read
> afterwards instead of a lost toast*.

---

# PART 3 — LOAN AND ADVANCE

**Types used throughout: `LOAN · ADVANCE · HOME_LOAN`.**

## 3.1 Loan — `/Transaction/Emp_Loan.aspx?MenuId=21`

**Where:** Loan And Advance ▸ Loan. The list of live loans.

**What you see on arrival:** *Employee Loan*, an **[Add]** button, a numeric pager **`1 2 3 4`**, and
a table. No filters and no search box on this screen.

**Table — `EmpCode | Employee Name | Loan | Installment | Date | (edit) | (delete)`**, 12 rows per
page across 4 pages. Live rows:

| EmpCode | Employee Name | Loan | Installment | Date |
|---|---|---|---|---|
| EMP001 | Test 1 | 5000.00 | 5000.00 | 7/1/2025 12:00:00 AM |
| EMP023 | Test 23 | 102500.00 | 12500.00 | 9/1/2025 12:00:00 AM |
| EMP011 | Test 11 | 65000.00 | 5000.00 | 6/1/2025 12:00:00 AM |
| EMP007 | Test 7 | 80000.00 | 5000.00 | 9/1/2025 12:00:00 AM |
| EMP015 | Test 15 | 484000.00 | 10000.00 | 1/7/2025 12:00:00 AM |

Dates render as raw US datetimes with the midnight time still attached.

**Row actions:** `[Edit]` · `[Delete]` — **Delete asks nothing. There is no confirm on this screen**
(unlike Leave Type, which does confirm).

**The form — `Employee Loan Transaction` on `/Transaction/Emp_Loan_AU.aspx?LoanType=Transaction`**
*(opened live, both Add and Edit):*

| Field | Type | Options | Default |
|---|---|---|---|
| **Select Employee** | dropdown | 173 employees, no `All` | `EMP001 : Test 1` |
| **Loan Type** | dropdown | **3, all listed:** `LOAN` · `ADVANCE` · `HOME_LOAN` | `LOAN` |
| **Loan Amount** | text box | | empty |
| **Installment Amount** | text box | | empty |
| **(date)** | date box, unlabelled on screen | | empty |
| **[Save]** | button *(reads **[Update]** when opened via Edit)* | | Not pressed. |

**⚠️ There is no interest-rate field, no tenure field and no instalment count.** You give a total and
a per-month instalment; the app divides. The number of months is implied, never entered — and yet
the Loan Statement has an `Interest` column and the payslip has an `INTEREST` column. **Interest is
not set anywhere in this menu.**

---

## 3.2 Loan Manage — `/Transaction/Loan_Advance_Manage.aspx?MenuId=83`

**Where:** Loan And Advance ▸ Loan Manage. Overriding one month's deduction for one person —
"skip Ravi's EMI this month", "take 2,000 instead of 5,000".

**What you see on arrival:** two cards. **`Loan & Advance Manage`** (the entry form) on top,
**`Loan & Advance Search`** underneath.

**Card 1 — `Loan & Advance Manage`:**

| Field | Type | Options | Default |
|---|---|---|---|
| **Transaction Month** | month box | | **empty** |
| **Emp Name** | dropdown | 173 employees, no `All` | `EMP001 : Test 1` |
| **Trans type** | dropdown | **3:** `LOAN · ADVANCE · HOME_LOAN` | `LOAN` |
| **Amount** | text box | | empty |
| **[Save]** | button | | **a write. Not pressed.** |

**Card 2 — `Loan & Advance Search`:**
`Month` (defaults `Sep/2026`) · `Categorgy` (`All`+7) · `Company` (`All`+2) · `Division` (`All`+9) ·
`Department` (`All`+21) · **[Show]** · `Search` box · **[Excel Export]**.

**I pressed [Show].** **No grid appears — no columns, no rows, no empty-state message.** I checked
the page afterwards and there is no results table element on it at all. So this screen's search half
shows nothing on this demo, and its output columns are not recorded here.

---

## 3.3 Loan Prepayment — `/Transaction/Loan_Prepayment.aspx?MenuId=91`

**Where:** Loan And Advance ▸ Loan Prepayment. Somebody paying a lump sum off their loan early.

**What you see on arrival:** the same two-card shape. **`Loan Prepayment Entry`** on top *(collapsed
by default — the fields are there but not shown until you open it)*, **`Loan Prepayment Search`**
underneath.

**Card 1 — `Loan Prepayment Entry`:**

| Field | Type | Options | Default |
|---|---|---|---|
| **Transaction Date** | date box | | `07/09/2026` (today) |
| **Emp Name** | dropdown | 173 employees | `EMP001 : Test 1` |
| **Trans type** | dropdown | **3:** `LOAN · ADVANCE · HOME_LOAN` | `LOAN` |
| **Amount** | text box | | empty |
| **Remark** | text box | | empty |
| **[Save]** | button | | **a write. Not pressed.** |

**Card 2 — `Loan Prepayment Search`:** identical to §3.2 — `Transaction Date` · `Categorgy` ·
`Company` · `Division` · `Department` · **[Show]** · `Search` · **[Excel Export]**.

**I pressed [Show]. Same as Loan Manage — nothing renders.** No grid, no message.

**The closure flow:** there is **no "close this loan" button anywhere in the menu.** A loan closes by
arithmetic — when the Loan Statement's `ClosingBal` reaches zero. I saw exactly that in live data:
`EMP013` and `EMP038` both show `OpeningBal 5000 → Installment 5000 → ClosingBal 0`. A prepayment is
simply an extra debit that gets the balance to zero sooner; it shows up in the Loan Statement's own
`Prepayment` column.

---

## 3.4 Advance — `/Transaction/Emp_Advance.aspx?MenuId=22`

**Where:** Loan And Advance ▸ Advance. A salary advance — no instalments, no schedule.

**What you see on arrival:** *Employee Advance*, an **[Add]** button, and a three-column table. No
pager, no search, no filters.

**Table — `EmpCode | Employee Name | Advance | (edit) | (delete)`.** Live rows:

| EmpCode | Employee Name | Advance |
|---|---|---|
| EMP001 | Test 1 | 500.00 |
| EMP001 | Test 1 | 898.00 |
| EMP003 | Test 3 | 898.00 |

*(the same person can hold more than one advance row)*

**Row actions:** `[Edit]` · `[Delete]` — again **no confirmation on Delete**.

**The form — `Employee Advance` on `/Transaction/Emp_Advance_AU.aspx`** *(opened live):*

| Field | Type | Options | Default |
|---|---|---|---|
| **Select Employee** | dropdown | 173 employees | `EMP001 : Test 1` |
| **Amount** | text box | | empty |
| **[Save]** / **[Update]** | button | | Not pressed. |

**Two fields.** No type, no date, no instalment — that is the entire difference between an Advance
and a Loan on the entry side.

---

## 3.5 Loan Opening — `/Transaction/Loan_Opening.aspx?MenuId=23`

**Where:** Loan And Advance ▸ Loan Opening. Loans that already existed before the company started
using HRMex — the opening balances you type in on day one.

**What you see on arrival:** *Loan Opening* (breadcrumb, oddly, says *Employee Leave Opening*),
**[Add]** and **[Excel Import]** buttons, a `Search` box, and a table.

**Table — `Emp Code | Employee Name | Type | Loan | Installment | Date | (edit) | (delete)`.**
One live row: `EMP001 | Test 1 | LOAN | 500.00 | 500.00 | 8/21/2026 12:00:00 AM`.
Row actions `[Edit]` `[Delete]` — **no confirm.**

**[Add] → `/Transaction/Emp_Loan_AU.aspx?LoanType=Opening&MenuId=21`** — **the very same form as
§3.1**, only the heading changes to **`Employee Loan Opening`** and the breadcrumb to
*Opening Master*. Identical five fields, identical `LOAN · ADVANCE · HOME_LOAN` dropdown, identical
`[Save]`. *One form, two modes, switched by the address.*

**[Excel Import] → `/Utilitty/Loan_Import.aspx?MenuId=21`** — a small screen titled **Loan Import**,
subtitle **Loan Import  File Format**, where `File Format` is a **download link to a sample workbook**
(`/Sample_Files/LoanImport.xlsx`):

| Field | Type | Options | Default |
|---|---|---|---|
| **Loan Type** | dropdown | **3:** `LOAN · ADVANCE · HOME_LOAN` | `LOAN` |
| **Import Loan** | file picker (`Choose file`) | | empty |
| **[Import]** | button | | **a write. Not pressed.** |

*(Note the asymmetry with the Leave importer: leave lets you upload **or paste**, and its button says
**Preview**; loan is upload-only and its button says **Import** — it commits straight away.)*

---

## 3.6 Loan Statement — `/Transaction/Loan_Statement.aspx?MenuId=65`

**Where:** Loan And Advance ▸ Loan Statement. Every live loan in the company, for one month.

**What you see on arrival:** *Loan Statement*, an **Advanced Filters** strip, a `Search in grid` box,
**[Show]** and **[Excel Export]**.

**Advanced Filters** — same modern multi-select style as Leave Statement:

| Field | Control | Options | Default |
|---|---|---|---|
| Loan Month | month box | | `Sep/2026` |
| **Loan Type** | multi-select tick-list + `Select All` | `All · LOAN · ADVANCE · HOME_LOAN` | button reads `All` |
| **Category** | multi-select + `Select All` | 7 | `All` |
| **Company** | multi-select + `Select All` | 2 | `All` |
| **Division** | multi-select + `Select All` | 9 | `All` |
| **Department** | multi-select + `Select All` | 21 | `All` |

**I pressed [Show]. Real output — the old capture never recorded these columns:**

`EmpID | EmpCode | EmployeeName | **LoanName** | OpeningBal | New Loan | Installment | Prepayment |
Interest | ClosingBal` — **plus a bold TOTAL row at the bottom.**

| EmpCode | EmployeeName | LoanName | OpeningBal | New Loan | Installment | Prepayment | Interest | ClosingBal |
|---|---|---|---|---|---|---|---|---|
| EMP001 | Test 1 | **PERSONALE LOAN** | 60500 | 0 | 500 | 0 | 0 | 60000 |
| EMP006 | Test 6 | PERSONALE LOAN | 805000 | 0 | 20000 | 0 | 0 | 785000 |
| EMP007 | Test 7 | PERSONALE LOAN | 35000 | 0 | 5000 | 0 | 0 | 30000 |
| EMP013 | Test 13 | PERSONALE LOAN | 5000 | 0 | 5000 | 0 | 0 | **0** |
| EMP015 | Test 15 | PERSONALE LOAN | 1554000 | 0 | 10000 | 0 | 0 | 1544000 |
| EMP023 | Test 23 | PERSONALE LOAN | 30000 | 0 | 12500 | 0 | 0 | 17500 |
| | **TOTAL** | | **2842500** | | **86000** | | | **2756500** |

13 employees, ₹28.4 lakh outstanding, ₹86,000 collected this month. **`Interest` is `0` on every
single row**, consistent with there being no rate field anywhere (§3.1).
`Search in grid` filters the rendered rows. **[Excel Export]** not pressed.

---

## 3.7 Loan Ledger — `/Transaction/Loan_Ledger.aspx?MenuId=66`

**Where:** Loan And Advance ▸ Loan Ledger. One person's loan story, transaction by transaction.

**What you see on arrival:** *Loan Ledger* — four controls, `[Show]`, and a hidden `[Print]`.

| Field | Control | Options | Default |
|---|---|---|---|
| **Employee Name** | dropdown | 173 employees, no `All` | `EMP001 : Test 1` |
| **Att Month From** | month box | | `Sep/2026` |
| **Att Month To** | month box | | `Sep/2026` |
| **Loan Type** | multi-select tick-list + `Select All` | `LOAN · ADVANCE · HOME_LOAN` | **all three already ticked**, button reads `All` |
| **[Show]** | button | | |
| **[Print]** | button — **hidden until a result exists** | | |

**I pressed [Show] for EMP001. Real output:**

`TransactionType | Date | LoanName | Interest | Debit | Credit | Balance`

| TransactionType | Date | LoanName | Interest | Debit | Credit | Balance |
|---|---|---|---|---|---|---|
| **Installment** | 01-Sep-2026 | PERSONALE LOAN | 0 | 500 | 0 | **−500** |

`TransactionType` is the word that tells you what happened — here `Installment`. The other kinds this
menu can produce (New Loan, Prepayment, Opening) would appear in the same column.

---

## 3.8 How a loan deduction reaches payroll

The Loan screens themselves never name a salary head — none of the five entry forms has a "post to"
field. **The mapping is made once, centrally, on `Master ▸ Master Setting`**, which carries a
dropdown labelled **`Loan Head`** (currently pointing at salary head id `2009`). I opened that screen
only to confirm this one field. The same settings page also maps `Absent Head`, `Present Head`,
`PT Head`, `PF Head`, `OT Head`, `OT Hrs Head`, `Bonus Head`, `ESIC Head`, `Extra Hrs Head` — and,
on the leave side, a **`COFF Head`** whose options are the *leave types* (`PL · COFF · CL · SL · ML ·
LOP`, currently `COFF`), i.e. which leave type comp-off gets credited into.

The company's salary-head list does contain heads literally named **`LOAN`**, **`Advance`** and
**`HOME_LOAN`** (alongside BASIC, HRA, PF, PT, TDS, ESIC and ~55 others), so the three loan types
each have a head available to them.

**So the chain is:** enter the loan → the monthly instalment becomes a deduction line → that line is
posted against the head named in `Master Setting → Loan Head` → it appears on the payslip block
`LOAN NAME | NEW LOAN | INSTALLMENT | INTEREST | BALANCE`, which is the same five figures the Loan
Statement shows minus `Prepayment` and `OpeningBal`.

**One thing I could not resolve:** the Loan Statement's `LoanName` reads **`PERSONALE LOAN`** on every
row, and **no screen in the Loan And Advance menu lets you enter, pick or edit that name.** It is not
one of the three loan types and it is not in the salary-head list I saw. It is set somewhere outside
this scope.

---

## Corrections to the 2026-08-16 capture

*(old claim → what is actually on the screen today)*

1. **"Leave policy = ~15 switches per Leave Level × Leave Type"** → **28 controls**, in **five**
   labelled sections, not four. The old list missed the entire **`FORMULAS`** section (`Credit
   Formula (yearly)` and `Opening Credit Formula`, each with a blue **`Check`** validator link), the
   **`Carry Limit`** box inside the dialog, **`Encash Limit`** and **`Encash Formula`**, and the
   six-control hourly block (`Late`, `MidDay`, `Early`, `Limit`, `Duration (Mins)`, and the
   **`Hourly Leave Restriction`** dropdown with its two options). Three controls are
   **conditionally revealed** by their parent checkbox — the old capture recorded them flat.
2. **"Leave Level Master → `Level Name`, `☐ Allow Quarter leave` → the leave policy grid"** → true
   for the **New** dialog only. The **Edit** screen (`LeaveLevel_AU.aspx`) is a different, much
   bigger page: *Leave Level Configuration* + *Leave Type Management* grid + the Configure dialog.
3. **Leave Entry — "Grid `☐ | Emp ID | … | Balance Leave` and `[Save]`"** → correct, and the list
   screen in front of it was never described: it holds a **collapsed `Filter` card** (Date From/To,
   Employee, Company, Division, Categorgy, Department, `[Filter]`) and **never renders a list of
   existing leave entries** — pressing Filter returns nothing at all.
4. **Leave Opening — "`[Filter]`, `[Excel Import]`"** → the grid was never captured. It is
   **`Emp Code | Employee Name | Company Name | Department Name | Allowed Leaves`**, `Allowed
   Leaves` is an **editable box in every row**, 23 rows per page with a **9-page numeric pager**, and
   there is **no Save button on the screen**. Also add the `Search` box.
5. **Leave Credit — "`Salary Month`, `Leave Type`, `[Show]`, `[Excel Import]`"** → the label on
   screen is **`Leave Month`**, not Salary Month. And `[Show]` **renders no grid at all**, with or
   without a month filled in.
6. **Leave enCashment — "`Select Date`, `Emp Name`, `Leave Type`, `Leaves to Encash`, org filters,
   `[Apply Filter] [Excel Import] [Save]`"** → the date label is **`Encashment Date`**. The screen is
   **two independent blocks**: an entry form, and a separate **`Encashment history`** search with its
   own five filters. The employee list here is **124 people, not 173**, and its Department/Division
   lists are shorter (18 / 7) than everywhere else. Empty state: *"No encashment history."*
7. **Leave CarryForward — "⚠️ the `Leave Type` dropdown's default option renders as `â€"`"** →
   still true, and worse: **the picker has no options at all** and stays empty when opened, so
   `[Show]` can never return data. The other four pickers populate fine. Add to the batch-panel grid
   the column **`Allowed (batch)`**, and note **`Leave Year` offers only `2026`**.
8. **Leave CarryForward — "`[Carry forward history report]`"** → the link exists but the page
   **errors out** to the app's `/Oops.aspx` failure screen.
9. **Loan — "Grid `EmpCode | Employee Name | Loan | Installment | Date`, `[Add] [Edit] [Delete]`"** →
   correct; add that it pages **12 rows across 4 pages**, and that **Delete asks no confirmation**
   here (Leave Type's Delete does).
10. **Loan Opening — "`[Add] [Excel Import]`"** → its `[Add]` is **not a separate form**: it reuses
    `Emp_Loan_AU.aspx` with `?LoanType=Opening`, heading *Employee Loan Opening*. Its row actions
    `[Edit] [Delete]` were not listed. Its `[Excel Import]` goes to `/Utilitty/Loan_Import.aspx`
    (Loan Type + file + `[Import]` + a **File Format sample-file link**).
11. **Loan Statement — "`MMM/yyyy`, `Loan Type {All|LOAN|ADVANCE|HOME_LOAN}` + org filters,
    `[Show] [Excel Export]`"** → the filters are **multi-select tick-lists with `Select All`**, not
    plain dropdowns, and the **output columns were never captured**: `EmpID | EmpCode |
    EmployeeName | LoanName | OpeningBal | New Loan | Installment | Prepayment | Interest |
    ClosingBal` **+ a TOTAL row**.
12. **Loan Ledger — "Grid `Period | Leave Type | …`"** *(the old doc reused the Leave Ledger's
    columns)* → the real columns are **`TransactionType | Date | LoanName | Interest | Debit |
    Credit | Balance`**, its Loan Type filter is a multi-select with **all three pre-ticked**, and
    `[Print]` is **hidden until a result exists**.
13. **Loan Manage / Loan Prepayment — "search block with org filters, `[Show] [Excel Export]`"** →
    correct that the block exists; **it produces no results grid whatsoever** on either screen.
14. **"Reaches payroll via the `Loan Head` map"** → confirmed: `Master ▸ Master Setting → Loan Head`.
    Worth adding beside it: the same page carries a **`COFF Head`** that maps comp-off into a *leave
    type*.
15. **Leave Ledger — "`Employee Name`, `Leave Year`, `Salary Month to`, `Leave Type`"** → correct;
    add that `Leave Year` starts with a `Please Select` entry (7 options, not 6), the Leave Type
    filter is a **multi-select tick-list**, and empty cells print as **`–`**, not `0`.
16. **Attendance Calculation** → the old note is accurate. Two additions: the **Employee panel holds
    *two* dropdowns** (Employee Name *and* Category) and, unlike the other three panels, has **no
    "Select All"**; and **neither radio is selected by default**.

---

## Odd things I noticed

- **Leave CarryForward cannot be run on this demo.** Its Leave Type picker is permanently empty and
  its label renders as the mojibake `â€"` (a UTF-8 em-dash read as Latin-1). The same mojibake
  appears on the `/Oops.aspx` error page.
- **Leave enCashment cannot be driven either** — the Leave Type dropdown stays at `Select` even after
  choosing an employee, which follows from `Is Encashable` being unticked on all six leave types.
- **Three screens return nothing when you press their read button:** Leave Credit `[Show]`, Loan
  Manage `[Show]` and Loan Prepayment `[Show]` render no grid, no columns and **no empty-state
  message** — just blank space where a result should be. Leave Entry's `[Filter]` does the same.
- **Leave Opening has editable boxes but no Save button** on the screen.
- **Delete is inconsistent.** Leave Type and Leave Level confirm with *"Do you want to Delete ?"*;
  Loan, Advance and Loan Opening delete with **no confirmation at all**.
- **Three different employee lists** exist across ten screens: 173 with `All`, 173 without, and 124.
  The Encashment screen's Department (18) and Division (7) lists are also shorter than the 21/9 used
  everywhere else.
- **`Categorgy`** is misspelled on four screens and spelled correctly on two.
- **Dates render three ways** on screens that sit next to each other: `07-09-2026` (Attendance
  Calculation), `07-Sep-2026` (Encashment), `07/09/2026` (Prepayment), and raw
  `7/1/2025 12:00:00 AM` in the Loan and Loan Opening grids.
- **Loan Ledger shows a `Balance` of `−500`** for a repayment of 500 against a 60,500 loan — the sign
  convention in the ledger is the opposite of the Loan Statement's `ClosingBal`.
- The **Leave Import** screen's breadcrumb always says *"Leave Opening"*, even when you arrive from
  Leave Credit.
- The **Loan Statement's `LoanName` = `PERSONALE LOAN`** (sic) on every row, and nothing in this menu
  sets it.

---

## In human language — every feature in this area, as points

- **Leave kinds list** — a short list of the kinds of leave your company gives (paid leave, casual,
  sick, maternity, comp-off, unpaid). You click Leave Type and add a name and a short code. That is
  all it holds — it is just the vocabulary; the actual rules live in the next point.
- **Leave rules per staff class** — the heart of the whole thing. You group staff into classes
  (office staff, workers, heads of department), and then for each class you set the rules for each
  kind of leave separately, using about 28 switches and boxes. Nobody writes any code. This is where
  a company's leave policy actually gets typed in.
- **How many days a year** — a single number per class per leave kind. Office staff get X paid leave,
  workers get Y.
- **The probation gate** — "this leave doesn't exist for someone until they've been here N days".
  Set to 180 days for paid leave and casual leave on this demo, 0 for comp-off and unpaid.
- **Carry the leftovers into next year (or don't)** — a yes/no switch, plus a cap so you can say
  "you may carry over unused days, but no more than 10".
- **Add leave automatically each month, or by hand** — a switch that quietly tops everybody up every
  month, so nobody has to remember.
- **Take leave away automatically each month** — the mirror switch, for policies that work that way.
- **Hide a leave kind from staff** — a "is it visible" switch, so a leave type can exist for the
  office without appearing on everybody's screen.
- **Does a weekly off inside a holiday count as leave?** — one switch that settles the argument every
  business has: if someone takes Friday to Monday off, do you charge them for Sunday too.
- **Let the balance go below zero** — a switch that decides whether someone can take leave they
  haven't earned yet. On this demo somebody's balance really does sit at minus five days.
- **Write the accrual as a small formula** — for the cases where "so many days a year" isn't enough.
  The comp-off rule on this demo reads, in plain terms, "if the extra minutes someone worked add up
  to a full day, give them one comp-off day, otherwise give nothing." There's a **Check** link beside
  the box to test your formula before saving it.
- **Caps on how much can be taken at once** — a per-month cap and a per-batch cap, so nobody empties
  a year's balance in one go.
- **Comp-off gets used up first** — a switch that says: burn the comp-off days before touching the
  proper paid leave. Fair to the employee, and it stops comp-off quietly expiring.
- **Comp-off expiry** — a number of days after which an unused comp-off day disappears.
- **Can this leave be cashed in?** — a switch, plus a cap and a formula for what the money works out
  to.
- **Quarter-day leave** — a switch on the staff class allowing leave in quarter-days, not just halves.
- **Hourly leave** — a whole extra block of settings (late, mid-day, early, a minutes limit, and a
  choice between "refuse the request" and "just mark them late") that only appears for a leave kind
  you have marked as hourly. Nothing on this demo uses it.
- **Give leave to many people at once** — the best screen in the leave area. You pick a date range,
  pick full day or half day, pick the leave kind, then tick people from a list — **and each person's
  remaining balance is shown right there in their row** while you're ticking. One click applies it to
  everyone you ticked.
- **Starting balances** — for the day you switch to this system: a screen listing every employee with
  a box for "how many days do they start with", plus an option to upload a spreadsheet or paste the
  numbers in instead of typing 173 rows.
- **Monthly top-up** — a screen for adding this month's earned leave to everybody, with a spreadsheet
  upload as an alternative.
- **Carry last year's leftovers over** — a bulk job, and a well-designed one. You filter down to the
  people you mean, see exactly what it's about to do in a preview, give the batch a name, then run
  it — and get a line per person saying what happened, with counts of done / pending / failed, so you
  can re-run only the ones that failed. *(On this demo it can't be run — the leave-kind picker is
  empty.)*
- **Pay leave out as money** — a screen to say "this person is cashing in N days", with a history
  underneath showing everyone who has ever cashed leave in, how many days, and how much money.
- **Everybody's balances on one page** — one row per person per leave kind, showing the six numbers
  that make up a balance: what they started with, what was added, what they took, what they cashed,
  what they borrowed early, and what's left. This is the page a payroll clerk lives in. There's a
  small settings button with one option, "show present", and an export button.
- **One person's leave history, month by month** — a statement you can print and hand to somebody:
  every month from January onwards, per leave kind, with the opening figure, what was added, what was
  taken, what was cashed, and the closing figure — and each month's closing figure is next month's
  opening figure.
- **The "borrowed leave" column** — a number, on the balances page, for leave someone took before
  they'd actually earned it. Most systems hide this; this one puts it in its own column.
- **The month-end attendance run** — the single button that turns the raw clock-in/clock-out records
  into counted days. You pick the dates, optionally narrow it to certain people, companies, divisions
  or departments, and choose between *only the days not done yet* (fast) and *do the whole lot again*
  (when you've corrected something). A progress bar shows how far it's got, and anything that went
  wrong is listed in a box you can read afterwards. Everything about leave and pay is downstream of
  this button.
- **Loans** — a list of who owes the company money. To add one, you pick the person, pick the kind
  (ordinary loan, advance, home loan), enter the total and the monthly instalment, and give it a
  date. There is **no interest rate to enter anywhere** — you set the total and the monthly amount,
  and the system just counts down.
- **Advances** — a simpler version for a one-off salary advance: just a person and an amount. No
  instalments, no schedule.
- **Loans that pre-date the system** — a separate screen for typing in loans already running when you
  started using this software, so their balances are right from day one. It's the same form as a new
  loan, and it takes a spreadsheet upload too.
- **Change one month's instalment** — a screen for the ordinary human situations: "don't take Ravi's
  EMI this month", "take 2,000 instead of 5,000." You pick the month, the person, the loan kind and
  the amount. *(Its search half shows nothing on this demo.)*
- **Early lump-sum repayment** — a screen for when somebody pays a chunk off ahead of schedule: date,
  person, loan kind, amount, and a note explaining it. *(Its search half also shows nothing here.)*
- **How a loan closes** — there is no "close loan" button, and that's deliberate. A loan closes when
  the balance reaches zero, whether by instalments or by early repayment. Two people on this demo
  show a balance of exactly zero.
- **Every loan in the company, for one month** — a single page showing each person's loan, what they
  owed at the start of the month, anything new, the instalment taken, any early repayment, any
  interest, and what's left — with a **total line at the bottom**. On this demo: thirteen people,
  about ₹28.4 lakh outstanding, ₹86,000 collected that month, and interest of zero on every row.
- **One person's loan history** — a printable statement listing each transaction against their loan
  with a running balance.
- **Bulk upload for loans and for leave** — both the loan and leave screens accept a spreadsheet
  rather than typing, and both offer a **sample file to download** so you can see the exact layout
  expected. The leave one also lets you simply paste rows in, and shows you a **preview before
  committing**; the loan one imports straight away.
- **Where a loan lands on the payslip** — set once, centrally, not per loan. Somewhere in the master
  settings a single choice says which line of the payslip loan deductions appear on. Same idea for
  comp-off: one setting says which leave kind comp-off days get added into.
- **Export everything** — the balances page, the carry-forward page, the loan statement, the loan
  search and the manage screen all have an export button, so any of these can leave as a spreadsheet.

---

```
H17 — Leave (8 screens) + Attendance Calculation + Loan And Advance — DONE
Screens captured: 25 / expected ~14     Dialogs opened: 8     Dropdowns fully listed: 41
File: docs/capture/H17-leave-and-loans.md
Could not reach:
  - Leave CarryForward results — its Leave Type picker is empty, so [Show] can never return rows
    (screen, filters, grids, both modals and every button ARE captured, from the live page)
  - Leave enCashment entry — its Leave Type list stays empty because no leave type is marked
    encashable on this demo (all fields and the history grid ARE captured)
  - Leave Credit / Loan Manage / Loan Prepayment result grids — [Show] renders no table at all
  - Leave Entry list grid — [Filter] renders no table at all
  - Carry forward history report — the page errors to /Oops.aspx
  - the hourly-leave block in the policy dialog — no leave type on this demo is hourly, so it is
    recorded from the dialog's markup and labelled as such
Nothing was saved, submitted, deleted, run, imported or exported. Calculate was never pressed.
Browser closed: yes
```
