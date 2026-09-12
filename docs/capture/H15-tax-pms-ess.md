# H15 — HRMex: IT Declaration (tax) · PMS (performance) · ESS menu

**Product:** HRMex 10.0.0.0 — `https://demo.hrmexweb.in` (Cloudmex's demo; ASP.NET WebForms).
**Captured:** 2026-09-07, signed in once as `Superadmin` (session cached as `H15`).
**Scope:** HRMS ▸ IT Declaration · HRMS ▸ PMS (KRA / KPI / Report) · the whole ESS menu.
**Screens opened live:** 12 (list + long form + report-viewer output + 3 PMS + 3 ESS + 3 dialogs/viewers).
**Nothing was saved, submitted, deleted, uploaded, locked, e-mailed or run.** Every write control below
is described from its label and its markup, and marked *not activated* where that is the case.
**Evidence:** screenshots in `.claude/capture/shots/H15/`.

---

# 1. IT Declaration

## 1.1 Employee List (the declaration list) — `/HRMS/IT_Declare_List.aspx?MenuId=50`

**Where:** top menu **HRMS → IT Declaration**. Breadcrumb reads `Home / Employee List`.

**What you see on arrival:** a page titled **Employee List** with a dark blue collapsed bar labelled
**Filter** at the top (a funnel icon, a `+` tool and an `×` tool on the right). Under it, right-aligned,
a small **HRMS Settings** link. Then a `Search :` box and one long table of every employee — all **173
rows render at once**, no paging, no page-size control. There are no counter tiles or cards on this page.

**Numbers/cards on the page:** none. The only count you can get is by reading the table.

### Controls, in the order they appear
1. **Filter bar (collapsed)** — click the bar (or its `+`) to expand the filter card. The `×` tool
   *removes the whole filter card* from the page for that visit.
2. **HRMS Settings** (link, top right) → opens the **HRMS Settings** dialog (§1.2).
3. **Search :** box, placeholder `Search Here...` — filters the table as you type (client-side).
4. **Lock** column: a **select-all checkbox in the header** plus one checkbox per row.
   ⚠️ Each tick fires a server postback **the instant it is clicked** — there is no Save button and no
   confirmation, and the header box locks every listed employee in one action. *Not activated.*
5. **Column headers** `Emp Code · Employee Name · Location · Company · Division · Department · Category`
   are all sort links.
6. **[IT Declaration]** button on every row → opens that person's declaration (§1.3).
7. Inside the expanded filter card, three buttons: **[Filter] · [TaxProjection] · [Reprocess TDS]**.

### The filter card (once expanded) — 6 fields, all dropdowns, all defaulting to `All`
| Label as printed | Options (complete) |
|---|---|
| **Categorgy** *(spelt so on screen)* | All · Category 1 · Category 2 · Category 3 · Category 4 · Category 5 · Category 6 · Category 7 |
| **Company** | All · Company 1 · Company 2 |
| **Division** | All · Division 1 … Division 9 |
| **Department** | All · Default · Marketing · Dispatch · Production · Accounts · Loading · STORE · Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing · Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT |
| **Status** | All · Working · Resign |
| **Year** *(default `2024-25`)* | 2024-25 · 2023-24 · 2022-23 |

- **[Filter]** — re-reads the list with those choices.
- **[TaxProjection]** — opens a **new browser tab** on `/Reports/Report_Viewer.aspx`, the standard
  ASP.NET report viewer (a toolbar reading `of 0 · Find | Next`). Opened live with nobody ticked, it
  returned an empty report, so it clearly prints the projection **for the ticked employees only**.
  Read-only: it produces a document, it does not write.
- **[Reprocess TDS]** — recomputes and stores the monthly TDS for the ticked employees. **Not
  activated** (it writes).

### Table
`☐ Lock | Emp Code | Employee Name | Location | Company | Division | Department | Category | [IT Declaration]`
Live rows: EMP001 "Test 1" … EMP173 "Test 173", all on `Location 2 / Company 2`. Nobody is locked
(0 of 173 ticked). **Empty state:** not seen — the list is never empty in this demo.
**Realtime/auto:** nothing moves on its own.

## 1.2 Dialog — **HRMS Settings** (rounding)

Opened from the list. A large dialog, **static backdrop and keyboard-dismiss disabled** (you must use
Close or ×). Three controls on one row:

| Field | Type | Default | Notes |
|---|---|---|---|
| **Round the values?** | checkbox | **unticked** | ticking it posts back and enables the other two |
| **Type of rounding** | dropdown | `Round to Nearest (Round Off)` — also `Round Down (Floor)`, `Round Up (Ceil)` | **greyed out** until the box is ticked |
| **Round To** | number, placeholder `Enter Round off value` | empty | **greyed out** until the box is ticked |

Buttons: **[Close] [Save]**. *Save not activated.*

## 1.3 IT Declaration (the long form) — `/HRMS/IT_Declaration.aspx?MenuId=50`

**Where:** HRMS → IT Declaration → the **[IT Declaration]** button on an employee's row.
Breadcrumb `Home / Employee List / IT Declaration`. Captured live for **EMP001 "Test 1", year 2024-25**.

**What you see on arrival:** a header strip with the year, the employee (read-only), the tax regime, a
**Compare** button and a **Form 16** link. Below it a row of **8 tabs**. Below that, on the first tab,
**five collapsible "Exemption Catogory" cards** (the first one open, the other four shut). At the very
bottom, always visible whatever tab you are on, a **13-box computation strip** and a **Calculate** button.

### Header
| Field | Type | Value / options |
|---|---|---|
| **Year** | dropdown, posts back on change | `2024-25` *(default)* · 2023-24 · 2022-23 |
| **Emp Code** | text, **greyed out** | `EMP001` |
| **Employee Name** | text, **greyed out** | `Test 1` |
| **Regime** | dropdown, posts back on change | Old Regime · **New Regime** ← *the live default* |
| **Compare regime** | button **[Compare]** | a form submit; the page carries one dialog titled **Summary** holding a single green message line. *Not activated* (it is a submit). |
| **Form 16** | link | **works: it downloads `Form16.pdf`** for that employee and year. The page does not change. |

### The 8 tabs
`IT Declaration · HRA Declaration · Housing Property - SelfOccupied · Housing Property - LetOut ·
Income From Previous Employment · Other Income · Other Deduction · Already Paid Tax`
Switching tabs is instant (no page reload). All eight were opened live.

### Tab 1 — **IT Declaration**: five exemption cards
Every card holds the same grid: **`Particular | Max. Limit | Declared Amount | Actual Amount | [Download]`**.
`Max. Limit` is printed by the system; **Declared Amount** and **Actual Amount** are the two typeable
boxes (both showing `0`), and each **posts back the moment you leave the box**. `[Download]` fetches the
proof document filed against that line. **Every line, in the order shown:**

**Card 1 — `Exemption Catogory: 80EE - Interest on Housing Loan`** *(open on arrival)*
| Particular | Max. Limit |
|---|---|
| 80EE - interest on home loan | 200000 |

**Card 2 — `Exemption Catogory: C - Deduction Under Chapter VI A`** *(collapsed; 12 lines + a total)*
| Particular | Max. Limit |
|---|---|
| PF Deduction | 150000 |
| 80c - 5 years of fixed deposit in scheduled bank | 150000 |
| 80c - child education fee | 150000 |
| 80c - deposit in nsc | 150000 |
| 80c - interest on nsc reinvested | 150000 |
| 80c - life insurance premium | 150000 |
| 80c - mutual funds | 150000 |
| 80c - principal repayment of home loan | 150000 |
| 80c - public provident fund | 150000 |
| 80c stamp duty and registration charges | 150000 |
| 80c - ulip of uti/lic | 150000 |
| 80ccd - national pension scheme | 150000 |
| **Total Exemption** *(footer row, sums Declared and Actual — live `0` / `0`)* | — |

**Card 3 — `Exemption Catogory: D - Rajiv Gandhi Equity Saving Scheme`** *(collapsed)*
| Particular | Max. Limit |
|---|---|
| 80ccg rajiv gandhi equity scheme | 25000 |

**Card 4 — `Exemption Catogory: E - Medical Insurance Premium`** *(collapsed; 8 lines)*
| Particular | Max. Limit |
|---|---|
| 80d - medical insurance premium for individual below 60 years | 25000 |
| 80d - medical insurance premium for parent below 60 years | 25000 |
| 80d - preventive healthcare for dependent parent | 5000 |
| 80d - medical bills - above 60 years parents | 50000 |
| 80d - medical insurance premium for parents above 60 years | 50000 |
| 80d - medical insurance individual above 60 years | 50000 |
| 80d - preventive healthcare for Individual | 5000 |
| 80d - medical bills - above 60 years Individual | 50000 |

**Card 5 — `Exemption Catogory: F - Medical Treatment for Handicapped Dependents`** *(collapsed; 3 lines)*
| Particular | Max. Limit |
|---|---|
| 80dd - medical treatment / insurance of handicapped dependant | 100000 |
| 80e - interst on education loan *(spelt so)* | 0 |
| 80g -Donation | 0 |

### Tab 2 — **HRA Declaration**
One grid, **13 rows**, columns **`Particular | Metro | Declared Amount | Actual Amount`** — no Download
column here. `Metro` is a **tick-box per row** (all unticked), so metro/non-metro is set month by month.
Rows: **Yearly · Apr · May · Jun · Jul · Aug · Sep · Oct · Nov · Dec · Jan · Feb · Mar** — i.e. a whole-year
figure or twelve monthly rents. Both amount boxes are empty and post back on change. No Update button on
this tab.

### Tab 3 — **Housing Property - SelfOccupied**
| Field | Type | Default |
|---|---|---|
| Property Address | text, placeholder `Enter Address Here` | empty |
| Loan Sanction Amount | number | 0 |
| Interest Paid During Year | number | 0 |
| Property Value | number | 0 |
| **Loan Sanction Before Apr/2016** | checkbox | unticked |
| Total Eligible Deduction | number | 0 |

Button: **[Update]**. *Not activated.*

### Tab 4 — **Housing Property - LetOut**
| Field | Type | Default |
|---|---|---|
| Address | text, placeholder `Enter Address Here` | empty |
| Rent Received During the Year | number | 0 |
| Interest Paid During Year | number | 0 |
| **Muncipal Tax Paid** *(spelt so)* | number | 0 |
| **Repair Maintaince Charge** *(spelt so)* | number | 0 |
| IT Deduction Amount | number | 0 |

Button: **[Update]** (a second, separate one). *Not activated.*

### Tab 5 — **Income From Previous Employment**
| Field | Type | Default |
|---|---|---|
| **Income after Excemption** *(spelt so)* | number | 0 |
| Professional Tax | number | 0 |
| Income Tax | number | 0 |
| Raw Tax | number | 0 |
| SurCharge | number | 0 |
| Cess | number | 0 |

Button: **[Update]** (a third one). *Not activated.*

### Tab 6 — **Other Income**
A two-column grid **`Other Income | Amount`** with **one blank line** to type into, plus two boxes below:
**Leave Encashment** (`0`) and **Perquisites** (`0`).

### Tab 7 — **Other Deduction**
A two-column grid **`Other Deduction | Amount`**, one blank line. Nothing else on the tab.

### Tab 8 — **Already Paid Tax**
A two-column grid **`Tax Paid | Amount`**, one blank line, plus one box: **Tax On Bonus** (`0`).

### The computation strip (always visible, all 13 boxes greyed out) + **[Calculate]**
Live values for EMP001, 2024-25, New Regime — **already filled on arrival**, so these are stored figures,
not something Calculate had to produce:

| Total Income | ITD Exempt | HRA Exempt | Std Dedc | Total Exempt | Taxable inc | Net Tax | Rebate | Surcharge | Edu Cess | Total Tax | Already Paid Tax | Payable Tax |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 676368 | 0 | 0 | 50000 | 50000 | 626368 | 11318 | 11318 | 0 | 0 | 0 | 0 | 0 |

**[Calculate]** re-runs the tax on what is on screen. Its internal name is `BtnSave1` — it is a full form
submit, so it also posts every typed box back. *Not activated.*

**Approval / verification step:** there is **none on this form** — no Approve, Verify, Submit or Reject
button, and no status field. The only gate in the whole feature is the **per-employee Lock tick on the
list screen**, plus the fact that HR alone types the **Actual Amount** column against the employee's
**Declared Amount**. Who files the declaration in the first place (the employee, from a portal) is not
visible from this login — see §4.

**Empty state:** not applicable; every line always renders with `0`.
**Realtime/auto:** nothing moves on its own, but almost every box on this form posts back to the server
when you leave it, so the screen flickers/reloads constantly while you type.

---

# 2. PMS — performance management

## 2.1 **KRA Master** — `/HRMS/PMS/KRA_Master.aspx?MenuId=301`

**Where:** HRMS → PMS → KRA Master. Page title **KRA Master**, breadcrumb `Home / KRA Master`.
*(A KRA — Key Result Area — is the broad area of responsibility a person is judged on.)*

**What you see on arrival:** a collapsible card headed **KRA definition** holding the form, and below it
a card headed **Saved records** holding the grid. No tiles or counters.

### Form — card **KRA definition**
| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| **KRA Name \*** | text | yes | empty | max 200 characters |
| **Description** | textarea | no | empty | |
| **Department** | dropdown, posts back | no | `— Select —` | full list: — Select — · Default · Marketing · Dispatch · Production · Accounts · Loading · STORE · Maintenance · Consumables Store · HR · House Keeping · RM Store · QC · Purchase · Packing · Safety · RM & Con Store · Production Pardi · QC PARDI · Admin · IT |
| **Weightage (%)** | text | no | `0` | |
| **Active** | checkbox | — | **ticked** | |
| **Created By** | display only | — | `—` | fills in after saving |
| **Created Date** | display only | — | `—` | fills in after saving |

Buttons: **[Save]** · **[Clear / New]**. *Save not activated.*
**A KRA attaches to a DEPARTMENT only — there is no designation field anywhere on this screen.**

### Grid — card **Saved records**
`KRA Name | Description | Department | Weightage % | Status | Created By | Created Date | Action`
- **Every column has both a filter dropdown and a search box** in the header, plus ascending/descending
  sort arrows. The KRA Name column's box reads `Search KRA Name`; each filter dropdown lists only the
  values actually present (e.g. Department → `All · Marketing`; Weightage % → `All · 100.00`;
  Status → `All · Active`; Created By → `All · SuperAdmin`).
- **Row action: `Edit` only. There is no Delete.**
- Footer: `Records: 2 · Showing 1-2 of 2 · Page 1 of 1`, pager `« 1 »`, page-size dropdown
  **10 · 20 · 30 · 50 · 100 · 500 · 1000** (default **30**).
- Live rows: `Test2 / Test / Marketing / 100.00 / Active / SuperAdmin / 7/14/2026 4:03 PM` and
  `Test1 / test / Marketing / 100.00 / Active / SuperAdmin / 7/14/2026 2:59 PM`.
**Empty state:** not seen (two records exist).

## 2.2 **KPI Master** — `/HRMS/PMS/KPI_Master.aspx?MenuId=302`

**Where:** HRMS → PMS → KPI Master. Page title **KPI Master**.
*(A KPI — Key Performance Indicator — is one measurable target that sits under a KRA.)*

**What you see on arrival:** the same two-card layout — a collapsible **KPI definition** form, then
**Saved KPIs** with the grid.

### Form — card **KPI definition**
| Field | Type | Required | Default | Options / notes |
|---|---|---|---|---|
| **KRA \*** | dropdown, posts back | yes | `- Select KRA -` | `- Select KRA -` · Test1 · Test2 — i.e. the KRA Master list |
| **KPI Name \*** | text | yes | empty | max 200 characters |
| **Description** | textarea | no | empty | |
| **Target value** | text | no | `0` | |
| **Unit of measure \*** | dropdown, posts back | yes | `- Select UOM -` | `- Select UOM -` · **Count (#)** · **Hours (hr)** · **Percentage (%)** · **Rupee (?)** — the rupee sign renders as a literal `?` |
| **Weightage (%) (from KRA Master)** | display only | — | `-` | inherited from the parent KRA, never typed |
| **Calculation Type \*** | dropdown, posts back | yes | `- Select -` | `- Select -` · **Higher is better** · **Lower is better** · **Range** |
| **Minimum threshold \*** | text | yes | empty | **appears only when Calculation Type = Range** |
| **Maximum threshold \*** | text | yes | empty | **appears only when Calculation Type = Range** |
| **Active** | checkbox | — | **ticked** | |
| **Created By** / **Created Date** | display only | — | `—` / `—` | |

Buttons: **[Save]** · **[Clear / New]**. *Save not activated.* (Choosing `Range` was done live — it only
re-renders the form and reveals the two threshold boxes; nothing was saved.)

### Grid — card **Saved KPIs**
`KRA | KPI Name | Target | Unit | Weight % | Calculation Type | Min | Max | Status | Created By | Created | Action`
- Per-column sort arrows, filter dropdowns and search boxes (`Search KRA`, `Search KPI Name`).
- Row action **Edit** only; no Delete. Same footer/pager/page-size set as KRA Master (default 30).
- Live rows:
  `Test2 | Increase production | 100.0000 | Hours | 100.00 | HIGHER_IS_BETTER | — | — | Active | Test 81 | 7/14/2026 4:03 PM`
  `Test1 | Test | 50.0000 | Count | 100.00 | HIGHER_IS_BETTER | — | — | Active | SuperAdmin | 7/14/2026 3:00 PM`
- Note the calculation type is stored and shown in raw form (`HIGHER_IS_BETTER`), not as the friendly
  wording used in the form.
- **Min and Max print as `â€"`** (a broken em-dash) rather than a blank — the same mojibake the
  2026-08-16 capture recorded, still present.
- One KPI (`Test2`) was created by **Test 81**, an ordinary employee-named user, not SuperAdmin.

## 2.3 **PMS Report** — `/HRMS/PMS/Report.aspx?MenuId=305`

**Where:** HRMS → PMS → Report. Page title **PMS report**, breadcrumb `Home / Report`.

**What you see on arrival:** a card headed **Filters**, then a card headed **PMS consolidated report**
with two coloured chips above a wide 14-column table, five pages long.

**Numbers/chips on the page:**
- **`Assigned KPI: 2`** and **`Not assigned KPI: 123`** — two clickable chips that narrow the list.
- A **Grand total** row pinned in the grid: `Grand total | 124 (employee count) | … | 2 (KPIs assigned) |
  … | 1.12 (average KPI score) | 1.12 (average KRA score) | 4.84 (average final rating)`.

**Controls:** the **Filters** card and a **[Refresh]** button — and that is all.
⚠️ **The Filters card contains no filters.** Expanded, it holds exactly one read-only line:
**`Access Scope: CEO/Admin`** — it tells you whose numbers you are allowed to see, nothing more. All
actual filtering is done by the per-column dropdowns and the two search boxes (`Search Emp`,
`Search Employee Name`) in the grid header.

### Grid — **PMS consolidated report**
`Emp Code | Employee Name | Department | Designation | Period | Assigned KPI | KPI created by |
KPI definition status | Total KPI Score | Total KRA Score | Final rating (Feedback) | Approval | Stage | Review Date`

Per-column filter dropdowns list the real values present:
- **Department** — All · Accounts · Consumables Store · Default · Dispatch · House Keeping · HR · IT ·
  Loading · Maintenance · Marketing · Packing · Production · Production Pardi · Purchase · QC · QC PARDI ·
  Safety · STORE
- **Designation** (49 values) — All · Accounts Executive · AGM Marketing · Asst. Store Manager ·
  Asst. Supervisor · Asst. Trainee Operator · Data Entry Operator · Default · DISPATCH EXECUTIVE ·
  Dispatch Head · Driver · Fitter Maintenance · GM Marketing · HELPER · HR Generalist ·
  IT Support Engineer · Jr. Operator · Loading Supervisor Incharge · Maintenance manager ·
  Manager Accounts & finance · Office Assistant · Operation Head · Operator · Packing Supervisor ·
  Plant Head · Purchase Executive · Purchase Manager · QA Executive · QC Executive · Qc Head ·
  Safety Officer · Sales Executive · Shift Incharge · Slitting Operator · Sr. Accounts Executive ·
  Sr. Electrician · Sr. HR Executive · Sr. Maintenance Executive · Sr. Operator · Sr. Quality Executive ·
  Sr. Sales Executive · Sr. Slitting Operator · Store Executive · Store Incharge · Store Keeper ·
  Store Manager · Supervisor · Trainee Operator · Unloading INCHARGE · Zonal Head
- **Period** — All · `—` · **MONTHLY** · **YEARLY**
- **Assigned KPI** — All · 0 · 1
- **KPI created by** — All · `—` · SuperAdmin · Test 81
- **KPI definition status** — All · `—` · **KPI definition active**
- **Total KPI Score** / **Total KRA Score** — All · 0.00 · 50.00 · 90.00
- **Final rating (Feedback)** — All · `—` · **4.67** · **5.00**
- **Approval** — All · `—` *(no other value exists in the data)*
- **Stage** — All · `—` · **MANAGER**
- **Review Date** — All · `—` · 7/14/2026 3:09 PM · 7/14/2026 4:10 PM
- Page-size dropdown 10 · 20 · 30 · 50 · 100 · 500 · 1000 (default **30**), pager `« 1 2 3 4 5 »`.

**What a completed review actually looks like** (the only two in the demo, both for EMP112 "Test 112",
Marketing, Office Assistant):
| Period | Assigned KPI | KPI created by | KPI definition status | Total KPI | Total KRA | Final rating | Approval | Stage | Review Date |
|---|---|---|---|---|---|---|---|---|---|
| MONTHLY | 1 | SuperAdmin | KPI definition active | 50.00 | 50.00 | **5.00** | — | **MANAGER** | 7/14/2026 3:09 PM |
| YEARLY | 1 | Test 81 | KPI definition active | 90.00 | 90.00 | **4.67** | — | **MANAGER** | 7/14/2026 4:10 PM |

Everyone else reads `— / 0 / — / — / 0.00 / 0.00 / — / — / — / —`.

**The rating scale:** there is **no rating-scale screen, legend, tooltip or band table anywhere in the
PMS area.** The rating is a bare number to two decimals; from the live data (5.00, 4.67, average 4.84)
it is plainly **out of 5**, but no band labels ("Excellent", "Good", …) exist in the product to record.
I looked for one on all three PMS screens and on the permissions master; there is none.

**Empty state:** not seen — every employee gets a row whether or not they have a KPI.
**Realtime/auto:** nothing; **[Refresh]** is manual.

## 2.4 How a review cycle works here — and the honest limit
From the admin side the chain is: **KRA (per department, carrying the weight) → KPI (per KRA, with a
target, a unit and a direction) → the consolidated report**, which shows a **Period** (MONTHLY or YEARLY),
a **Stage** (`MANAGER`), an **Approval** column and a **Review Date**.

**What is NOT in this menu:** there is **no screen for assigning a KPI to a person, entering a score,
self-rating, or approving a review.** The PMS menu has exactly three entries (menu ids 301, 302, 305 —
303 and 304 are unused), and none of them does that. Yet the report proves it has happened: EMP112 has
a scored MONTHLY and a scored YEARLY review, one of them created by **Test 81**, who is not the admin.
So the scoring and approval step lives **outside the administrator menu** — logically in the manager /
employee portal, which this login cannot reach. **Whether a self-rating exists, and what the outcome
connects to (an increment, or nothing), could not be seen and I will not guess it.** No link from any
PMS screen points at Increment Initialize or anything else.

---

# 3. ESS — the whole menu (from the administrator's side)

The **ESS** top menu has exactly **three** items, and no fourth is hidden:
`ESS Requests` · `Announcement` · `Company policies`.

## 3.1 **ESS Request Details** — `/ESS/ESSRequestDetails.aspx?MenuId=153`

**Where:** ESS → ESS Requests. Page title **ESS Request Details**, breadcrumb `Home / Details`.

**What you see on arrival:** a collapsed bar headed **Filters**, then a card headed **All Requests**
which, with the default dates, shows only the line *"No records found for the selected filters."*
That empty state is misleading — see below.

### Filters (click the **Filters** bar to open; 6 controls + 2 buttons)
| Field | Type | Default | Options |
|---|---|---|---|
| **From Date** | read-only date picker, `dd-mm-yyyy` | **1st of the current month** (live: `01-09-2026`) | picker has its own month + year selectors |
| **To Date** | read-only date picker, `dd-mm-yyyy` | **today** (live: `07-09-2026`) | |
| **Request Type** | dropdown | `All Types` | All Types · **Leave** · **Miss Punch** · **OD** · **Reimbursement** · **OT Sanction** |
| **Leave Type** | dropdown | `All Leave Types` | empty until Request Type = Leave; then **All Leave Types · CL · COFF · LOP · ML · PL · SL** |
| **Status** | dropdown | `All Status` | All Status · **Pending** · **Approved** · **Disapproved** |
| **Pending Level** | dropdown | `All Levels` | All Levels · **Pending at L1 · L2 · L3 · L4 · L5** |

Buttons: **[Apply]** (magnifier) · **[Reset]** (both read-only searches).

### The list, once the window is widened
Searched live for **01-01-2025 → 07-09-2026**: **864 requests**. A badge appears reading **`864 Records`**
and a summary bar appears above the table:
**`Total: 864 · Pending: 98 · Approved: 563 · Disapproved: 203`**.

Columns (11): `# | REQUEST TYPE | EMP CODE | EMPLOYEE NAME | DEPARTMENT | FROM DATE | TO DATE |
EXTRA INFO | ENTRY DATE | STATUS | PENDING LEVEL`
- **Request Type**, **Status** and **Pending Level** render as colour-coded pills (a distinct colour per
  level, L1…L5).
- **Extra Info** carries whatever that request type needs: the **leave code** for a leave (`SL`, `CL`), the
  **punch time** for a miss-punch (`00:08:00`, `06:11:00`).
- **Pending Level** reads `Pending at L1`…`L5` while pending, and `Approved` once approved.
- Real rows, e.g. `Leave / EMP035 / Test 35 / Marketing / 27-06-2026 → 27-06-2026 / SL /
  2026-06-29 13:58:10 / Pending / Pending at L1`.
- **There are NO row actions and no Action column** — you cannot approve, reject or open anything from
  here. It is a **read-only monitor**. (The one `Action` label in the markup is a hidden spacer above the
  Apply/Reset buttons, not a column.)
- All 864 rows render at once — no pager, no page-size control.
- **Empty state:** *"No records found for the selected filters."*
- **Realtime/auto:** none; the list loads once per Apply.

## 3.2 **Announcement Selection** — `/Announcement/Announcement.aspx?menuId=154`

**Where:** ESS → Announcement. Browser title **Announcement Selection**.

**What you see on arrival:** a search box with **[Search] [Refresh] [Add]**, one table, and
First/Previous/Next/Last navigation with a `1 - 1 of 1` counter. Unlike the rest of the product this
screen is drawn by the browser, not by the server, and its form is a **pop-up dialog**.

**Controls:** search box (placeholder **`Search by title, description, status...`**) · **[Search]** ·
**[Refresh]** · **[Add]** → the dialog · per-row **[Edit]** → the same dialog, pre-filled ·
per-row **[Delete]** · **[First] [Previous] [Next] [Last]**.

### Dialog — **Add Announcement** / **Edit Announcement**
| Field | Type | Required | Default (Add) | Options |
|---|---|---|---|---|
| **Title \*** | text | yes | empty, placeholder `Enter title` | max **500** characters |
| **Announcement Date** | date picker | no | **today** (live: `2026-09-07`) | |
| **Priority** | dropdown | no | **Normal** | Normal · High · Low |
| **Status** | dropdown | no | **Active** | Active · Inactive |
| **Description** | textarea | no | empty, placeholder `Enter description` | |

Buttons: **[Cancel] [Save]**. Both dialogs were opened live and cancelled; *Save not activated.*
The Edit dialog arrived correctly pre-filled (`test` / `2026-08-13` / Normal / Active / `hwvhwv`).

**Table:** `ID | TITLE | DATE | PRIORITY | STATUS | DESCRIPTION | ACTIONS`.
Live row: `1 | test | 13-08-2026 | Normal | Active | hwvhwv | Edit Delete`.
**Empty state:** not seen (one record exists). **Realtime/auto:** none.

## 3.3 **Company Policy Upload** — `/NotificationSender/Notification_Sender.aspx?MenuId=97`

**Where:** ESS → Company policies. Page heading **Company Policy Upload**. *(The same address is also
where the bell menu's "View All Notifications" lands.)*

**What you see on arrival:** two stacked cards — **Upload New Policy** (the form, with a small live
preview box on the right) and **Uploaded Policies** (the table of what is already published).

### Card — **Upload New Policy**
| Field | Type | Required | Notes |
|---|---|---|---|
| **Policy Name** | text, placeholder `Enter Policy Name` | **yes** | |
| **Upload Policy Document** | file picker, button reads `Choose file` | — | on-screen note: **"Supported formats: PDF, JPG, PNG, DOCX"** |
| **Policy Description** | **rich-text editor** (CKEditor 5 classic, loaded from a CDN) — a toolbar with a `Paragraph` style dropdown and formatting buttons | no | not a plain text box |
| **Preview** | display panel | — | shows an image thumbnail for a picture, a red PDF icon + "PDF Document" for a PDF; reads **"No file selected"** until you pick one |

Buttons: **[Clear]** · **[Upload Policy]**. *Upload not activated (it writes and uploads).*

### Card — **Uploaded Policies**
`ID | Policy Name | File Name | File Type | Upload Date | Actions` — with **[View] [Edit] [Delete]** on
each row. **Delete asks first**, with exactly this wording:
*"Are you sure you want to delete this policy?"* *Not activated.*

Seven live policies (real company documents, so listed by name only):
| ID | Policy Name | File Type | Upload Date |
|---|---|---|---|
| 10 | Company's Loan Policy | application/pdf | 24-02-2026 |
| 9 | Company's Attendance Policy | application/pdf | 17-01-2026 |
| 8 | Company's Leave Policy | application/pdf | 17-01-2026 |
| 7 | Company's Loan Policy | application/pdf | 05-06-2025 |
| 6 | Company's Overtime Policy | application/pdf | 05-06-2025 |
| 5 | Company's Leave Policy | application/pdf | 05-06-2025 |
| 4 | Company's Attendance Policy | application/pdf | 05-06-2025 |

**Empty state:** not seen. **Realtime/auto:** none.

## 3.4 **View Policy** — `/NotificationSender/ViewPolicy.aspx?id=<n>` *(newly recorded screen)*

**Where:** ESS → Company policies → the **[View]** button on a row. It is a **separate page**, not a
dialog. Opened live for id 10.

**What you see:** a heading **Company Policies**, then the policy name (*Company's Loan Policy*), a line
**`Uploaded on: 24 February 2026`**, the description, and an **Attachment** section with a
**Download Attachment** link. No editing controls, no back button of its own.

## 3.5 The ESS boundary — stated plainly
**The employee's own view of ESS was NOT visible from this login, and I did not try to reach it.**
What I can state from what I did see:
1. The **ESS menu on the administrator side is three screens**, and only one of them is about employee
   requests — and that one is **read-only**. Approving a leave or a miss-punch happens on the
   Attendance/Leave screens (other terminals' scope), not here.
2. The demo's **sign-in page offers exactly one door** — `User Id`, `Password`, `Remember Me`, `Login`.
   There is **no employee/ESS mode, no mobile-number or OTP option**. So the 2026-08-16 note that *"no
   employee-facing ESS portal exists in the demo"* still holds as far as this login can establish.
3. What an employee is allowed to raise is set **per Category** on Master Settings ▸ ESS (§2.1 of the
   2026-08-16 doc), using the day-action list — not on any ESS screen.
4. The two per-person switches, **ESS Password** and **Block Employee ESS**, live on the **Employee
   Master record** (Master → Employee Master). They exist and that is where they are; **terminal H14
   holds that screen** and I did not open it.
5. Evidence that a portal exists somewhere: 864 requests were raised by employees, and one PMS KPI was
   created by a non-admin user (`Test 81`). Neither could have been produced on the three ESS screens
   above.

---

# Corrections to the 2026-08-16 capture

Where the old text is right I say so, because "verified" is the deliverable too.

### §3.1 IT Declaration
1. **Filter card is hidden on arrival.** Old text lists the six filters as if visible. They are inside a
   **collapsed** card; you must click the **Filter** bar first. The card also has an **`×` tool that
   removes it** from the page. *(New.)*
2. **The Category filter's label is misspelt on screen: `Categorgy`.** *(New.)*
3. **The Lock tick saves instantly.** Old text says only "a per-employee Lock so a declaration can't
   change after cut-off" — correct in purpose, but incomplete in a way that matters: there is **no Save
   button for it, no confirmation**, and the header checkbox **locks every employee in the filtered list
   in one click**. *(New.)*
4. **Grid header confirmed** (`☐ Lock | Emp Code | Employee Name | Location | Company | Division |
   Department | Category | [IT Declaration]`), and **all 173 rows render at once with no pager**. *(New.)*
5. **`[TaxProjection]` output identified.** Old text names the button only. It opens
   **`/Reports/Report_Viewer.aspx` in a new tab** — the standard ASP.NET report viewer — and prints the
   projection for the **ticked** employees (with none ticked it returns an empty report). *(New.)*
6. **HRMS Settings modal:** old text is right about the three controls. Add that **"Round the values?" is
   unticked by default and the other two controls are greyed out until it is ticked**, and the dialog
   cannot be dismissed with the keyboard or by clicking away. *(New.)*
7. **Regime default is `New Regime`.** Old text lists `{Old Regime | New Regime}` with no default. Live,
   EMP001 / 2024-25 arrives on **New Regime**. *(New.)*
8. **`[Compare]` — what it opens.** Old text says it "compares the two regimes". The page carries exactly
   one dialog, titled **Summary**, whose body is a **single green message line** — so the comparison is
   delivered as one sentence, not a side-by-side table. I did not press it (it is a form submit), so the
   sentence it produces was not seen. In the markup that line still holds the design-time placeholder
   text `Label`. *(Refined + flagged.)*
9. **`Form 16` works.** Old text lists it as a link. Pressed live: it **downloads `Form16.pdf`** and the
   page does not change. *(New.)*
10. **The 8 tabs are exactly as recorded** — all eight opened live, names verified character for character.
11. **The 5 exemption accordions are exactly as recorded** — and the **first (80EE) is open on arrival,
    the other four are collapsed**. *(New.)*
12. **Every line of every accordion is now written out** (§1.3) — the old capture gave one example row.
    Counts: 80EE **1** line · Chapter VI A **12** lines **+ a `Total Exemption` footer row** · Rajiv
    Gandhi **1** · Medical Insurance **8** · Handicapped Dependents **3**. The footer total row was not
    recorded before. *(New.)*
13. **The HRA grid has no `[Download]` column** — its columns are `Particular | Metro | Declared Amount |
    Actual Amount`, with a **Metro tick-box per row** and **13 rows: Yearly + Apr…Mar**. The old text
    implied the `[Download]` pattern was uniform across the grids. *(Correction.)*
14. **`[Calculate]` — two corrections.** (a) The computation strip is **already filled on arrival**; the
    old wording *"`[Calculate]` then a computation strip"* suggests you must press it to see numbers.
    (b) The button's internal name is **`BtnSave1`** and it is a full form submit, not a display-only
    recalculation. *(Correction.)*
15. **The live figures for EMP001 are unchanged** from the 2026-08-16 capture, box for box
    (676368 / 0 / 0 / 50000 / 50000 / 626368 / 11318 / 11318 / 0 / 0 / 0 / 0 / 0). *(Verified.)*
16. **Three separate `[Update]` buttons exist**, one each on Housing-SelfOccupied, Housing-LetOut and
    Income-From-Previous-Employment — the old capture didn't record them, and their presence alongside
    `[Calculate]` is easy to get wrong. Tabs 2, 6, 7 and 8 have **no** save button of their own. *(New.)*
17. **Tabs 3–8 field lists were never recorded** — all six are now written out in full (§1.3). *(Gap filled.)*
18. **There is no approval or verification step on the declaration form** — no Approve/Verify/Submit/
    Reject control and no status field. The only gate is the list's Lock tick. *(Gap filled.)*

### §3.2 PMS
19. **KRA Master — field list confirmed**, plus: the form is in a collapsible **KRA definition** card;
    **Active is ticked by default**; Weightage defaults to `0`; KRA Name is capped at **200 characters**;
    there are two **read-only Created By / Created Date** displays. *(New.)*
20. **KRA row action is `Edit` only — there is no Delete.** Same on KPI Master. *(New.)*
21. **A KRA attaches to a Department, never to a designation.** My brief asked how one attaches to a
    designation — it cannot; the only place designations appear in PMS is as a *column* on the report.
    *(Gap filled.)*
22. **Both PMS masters carry a full grid toolkit** the old text didn't mention: per-column filter
    dropdowns **and** per-column search boxes, page-size **10/20/30/50/100/500/1000 (default 30)**,
    `Records: n · Showing 1-n of n · Page 1 of 1` and a `« 1 »` pager. *(New.)*
23. **KPI Master — `Min` and `Max` explained.** Old text flagged the mojibake but not the cause: the two
    fields **`Minimum threshold *` and `Maximum threshold *` appear only when Calculation Type = `Range`**
    (verified live). With `Higher is better` / `Lower is better` they do not exist. *(Gap filled.)*
24. **The rupee unit renders as `Rupee (?)`** on screen — the same encoding fault as `â€"`. The old text
    wrote `Rupee (₹)`, which is the intent, not what a person sees. *(Correction.)*
25. **The grid stores the raw calculation type** (`HIGHER_IS_BETTER`), not the friendly wording. *(New.)*
26. **PMS Report — `[Filters]` holds no filters.** Old text reads *"`[Filters] [Refresh]`"*, implying a
    filter set. Expanded, that card contains one read-only line: **`Access Scope: CEO/Admin`**. All
    filtering is in the column headers. *(Correction.)*
27. **PMS Report — the chips and the Grand total row were never recorded:** `Assigned KPI: 2`,
    `Not assigned KPI: 123`, and a Grand total of **124 employees / 2 assigned / avg KPI 1.12 /
    avg KRA 1.12 / avg final rating 4.84**. *(New.)*
28. **PMS Report was captured with data.** Old text lists the columns only. Live: **EMP112 has two
    completed reviews** — MONTHLY (score 50.00 → rating **5.00**) and YEARLY (score 90.00 → rating
    **4.67**), both at Stage **MANAGER**, Approval blank. Everyone else is empty. *(Gap filled.)*
29. **There is no rating scale to record.** No band table, legend or tooltip exists anywhere in PMS. The
    rating is a bare number, evidently out of 5. My brief asked for "every band and its label" — the
    product does not have them. *(Answered, negatively.)*
30. **There is no screen for assigning a KPI to a person, scoring a review, self-rating or approving one.**
    The PMS menu is three screens (ids 301/302/305; 303/304 unused), and the report proves the scoring
    happens elsewhere — outside this menu. *(Gap filled, with the limit stated.)*

### §9 ESS
31. **§9.1 — the filter is a From/To date PAIR**, not "a date": two read-only pickers defaulting to
    **1st of the current month → today**. *(Correction.)*
32. **§9.1 — the recorded empty state was an artefact of that default window.** Old text records
    *"Live empty state: No records found for the selected filters"* as if the feature had no data.
    Widened to 01-01-2025 → 07-09-2026 it returns **864 requests**. *(Important correction.)*
33. **§9.1 — a summary bar and a record badge exist** once there are rows:
    **`Total: 864 · Pending: 98 · Approved: 563 · Disapproved: 203`** and a **`864 Records`** badge.
    *(New.)*
34. **§9.1 — Leave Type fills in only when Request Type = Leave**, and then lists
    **CL · COFF · LOP · ML · PL · SL**. Old text records the dropdown as present but empty. *(Gap filled.)*
35. **§9.1 — the grid has no row actions.** Read-only monitor; Request Type / Status / Pending Level are
    colour-coded pills; `Extra Info` carries the leave code for a leave and the punch time for a
    miss-punch. *(New.)*
36. **§9.2 Announcement — the old description is of the wrong screen shape.** It is **not** a WebForms
    grid with an inline form; it is a browser-rendered table whose form is a **dialog** titled
    **Add Announcement / Edit Announcement** with **[Cancel] [Save]**. Add: browser title
    *Announcement Selection*; search placeholder *"Search by title, description, status..."*;
    **Title is required, max 500 chars**; **Announcement Date defaults to today**; Priority defaults
    **Normal**; Status defaults **Active**; row actions **Edit** and **Delete**; pager shows `1 - 1 of 1`.
    *(Correction + detail.)*
37. **§9.3 Company policies — three things the old text misses:** Policy Name is **required**; the file
    box states **"Supported formats: PDF, JPG, PNG, DOCX"**; and **Policy Description is a CKEditor 5
    rich-text editor**, not a plain textarea. There is also a **live Preview panel** ("No file selected").
    *(Correction + new.)*
38. **§9.3 — Delete has a confirmation**, worded *"Are you sure you want to delete this policy?"*, and
    **[View] navigates to a separate page**, `ViewPolicy.aspx?id=<n>` — a screen the 2026-08-16 capture
    does not contain at all (§3.4 above). *(New screen.)*
39. **§9 — the ESS menu is exactly three items** and no fourth is hidden in the menu tree. *(Verified.)*
40. **§9.1's note that no employee-facing ESS portal exists is still true** as far as this login can
    establish: the sign-in page offers one door only (User Id + Password + Remember Me), with no employee
    mode and no OTP. *(Verified, with the method stated.)*

---

# Odd things I noticed

- **Sorting the IT Declaration list by any column sorts by Company.** Every one of the seven header links
  posts the same sort argument (`Sort$CompanyName`) — Emp Code, Employee Name, Location, Division,
  Department and Category all included.
- **A higher score produced a lower rating.** On the PMS Report, EMP112's MONTHLY row scores 50.00 and
  rates **5.00**, while the YEARLY row scores 90.00 and rates **4.67**.
- **The `Approval` column is empty for both completed reviews**, while `Stage` says `MANAGER` — so it is
  not obvious from the report whether those two reviews are finished or still waiting.
- **`Min` and `Max` on KPI Master print `â€"`**, and the rupee unit prints **`Rupee (?)`** — a character-
  encoding fault in two places on the same screen.
- **The Compare dialog's message line still holds its design-time placeholder text (`Label`)** in the
  page markup.
- **The View Policy page prints the description's HTML tags literally** — the live policy shows
  `<p>LOAN POLICY HAS BEEN UPDATED AND UPLOADED…IN &nbsp;2026</p>` on screen, tags and all.
- **Four save buttons on one form.** The declaration screen has `Calculate` plus three separate `Update`
  buttons on three different tabs, and nothing on screen says which one commits what.
- **Almost every box on the declaration form posts back when you leave it**, so the screen reloads
  repeatedly while a person is typing a long declaration.
- **Label typos, as printed:** `Categorgy` · `Exemption Catogory` (all five cards) · `Muncipal Tax Paid` ·
  `Repair Maintaince Charge` · `Income after Excemption` · `80e - interst on education loan`.
- **Menu ids 303 and 304 are unused** between KPI Master (302) and Report (305) — consistent with a PMS
  scoring/appraisal screen that is not in this menu.

---

# In human language — every feature in this area, as points

- **Yearly tax declaration for every employee** — a page listing all 173 staff where the HR person opens
  any one of them and records what tax savings that person is claiming this year, so the right amount of
  tax gets cut from their salary. Click HRMS, then IT Declaration. It is the thing that stops an employee
  being over-taxed all year and complaining in March.
- **Pick the tax year before you start** — the same list and the same form can be opened for this year or
  either of the two years before it, so you can go back and fix an old year without losing the new one.
- **Narrow the list before you work** — you can show only one company, one branch, one department, one
  staff grade, or only people still working versus people who have left, so a big company's HR person is
  not scrolling past 170 names to reach the 8 they need.
- **A search box on the list** — type part of a name or a staff code and the list shrinks to it.
- **Lock a person's declaration** — a tick box on their row that freezes what they claimed, so nobody can
  quietly change their tax savings after the cut-off date has passed. There is a tick at the top of the
  column that freezes everybody at once. Be careful: it saves the moment you tick it, with no "are you
  sure".
- **Old tax scheme or new tax scheme** — a switch at the top of a person's declaration for the two Indian
  tax systems, because the same savings are worth a lot in one and nothing in the other.
- **Compare the two schemes** — a button that works out which of the two leaves that person with more
  money and tells you in one line, so HR can advise them instead of guessing.
- **What they say now versus what they prove later** — every savings line has two amount boxes side by
  side: what the employee *promised* in April, and what they actually *proved* with receipts later. That
  one idea is what makes the whole feature honest.
- **A place to keep the proof** — each savings line has a download button that fetches the receipt or
  certificate filed against it, so an auditor's question can be answered from the same screen.
- **The system prints the legal ceiling for each item** — beside every savings line it shows the maximum
  the law allows, so nobody accidentally claims more than is permitted.
- **Home-loan interest savings** — one line for the interest an employee pays on their house loan.
- **The big savings basket** — twelve lines in one group covering provident fund, life insurance, mutual
  funds, children's school fees, five-year bank deposits, national savings certificates, public provident
  fund, home-loan principal, stamp duty, unit-linked plans and the national pension scheme, with a running
  total at the bottom of the group.
- **An equity savings scheme line** — a single older scheme kept as its own group.
- **Health insurance savings, eight ways** — separate lines for the employee's own policy and their
  parents' policy, each split by whether the person is under or over 60, plus health-check-up costs and
  medical bills. The split matters because the legal ceiling is different for each.
- **Savings for treating a disabled dependant, education-loan interest and donations** — three more lines
  in their own group.
- **House rent, month by month** — a whole tab for rent, with a row for each of the twelve months plus a
  yearly figure, and a tick per month for whether the person was living in a big city (the allowance is
  bigger there). Month by month exists because people move house mid-year.
- **The house they live in** — a tab to record the address, the loan amount, the interest paid this year,
  what the property is worth, and whether the loan was taken before April 2016 (an older, more generous
  rule).
- **A house they rent out** — a separate tab for a second property: the address, the rent they collected,
  the interest they paid, the municipal tax, and repair costs, because a rented-out house is taxed on the
  profit, not the rent.
- **Pay from a previous job this year** — a tab for what someone earned and what tax was already cut
  before they joined, so their final tax adds up correctly for somebody who joined mid-year.
- **Other income and other deductions** — two free-text tabs for anything that does not fit the standard
  lines, plus boxes for leave that was paid out in cash and for perks.
- **Tax already paid** — a tab to record tax the person has already paid themselves, including tax on a
  bonus, so it is not collected twice.
- **The running tax result, always on screen** — a strip of thirteen figures along the bottom (total
  income, everything exempted, taxable income, the tax, the rebate, the cess, and finally what is still
  payable) that stays visible whichever tab you are on. It is already filled when you open the screen.
- **Recalculate on demand** — a button that redoes the tax sum after HR changes something.
- **Their Form 16, as a PDF** — a link that produces the official year-end tax certificate for that
  employee as a downloadable file. This is the document every Indian employee asks HR for.
- **A printable tax forecast** — tick some employees on the list and get a proper printable report of
  their projected tax for the year, in a viewer with search and page controls.
- **Redo everyone's monthly tax deduction** — one button that recalculates the tax to be cut from the
  ticked employees' salaries after their declarations change. This is the write that makes the whole
  feature take effect on payslips.
- **Round the tax figures your way** — a small settings box where the company chooses whether tax amounts
  are rounded, and whether up, down or to the nearest, and to what step.
- **Define what each department is judged on** — a screen for writing down the broad result areas a job is
  measured by (one per department) and how much each is worth as a percentage. Click HRMS, then PMS, then
  KRA Master. It is the frame a performance review hangs on.
- **Define the actual measurable targets** — a screen for the specific numbers under each result area:
  what is being counted, the target figure, whether it is counted in units, hours, percent or rupees, and
  whether bigger is better, smaller is better, or it must land inside a range. Click HRMS, then PMS, then
  KPI Master. Its weight is inherited from the result area above it, so the numbers cannot drift apart.
- **A must-be-within-a-range target** — choosing "range" adds a minimum and a maximum, for things where
  neither too little nor too much is good.
- **Turn a target on or off without deleting it** — an active tick on both screens, so last year's
  measures can be retired but kept on record. Nothing here can be deleted, only edited or switched off.
- **Who wrote it and when** — both screens stamp each entry with its author and date, so you can see who
  set a target.
- **One consolidated performance sheet for the whole company** — a table with every employee, their
  department and job title, the period reviewed, how many targets they have, their scores, their final
  rating out of five, the approval position, which stage the review has reached and when it was reviewed.
  Click HRMS, then PMS, then Report.
- **See at a glance who has been left out** — two counters on that report: how many people have targets
  set and how many do not (in the demo, 2 against 123). That is the number that tells an HR head whether
  performance management is actually running.
- **Company-wide averages on the same sheet** — a total row with the headcount, the number of targets set
  and the average scores and rating, so you can read the whole company in one line.
- **Filter and sort the performance sheet on any column** — every column has its own picker and search box,
  and you can show 10 to 1000 people per page.
- **You only see the people you are allowed to see** — the report states your access level on the page, so
  a department head and the company head can share one screen without sharing everyone's ratings.
- **A single window on every request the staff have raised** — one screen listing leave requests,
  forgotten-punch corrections, on-duty requests, expense claims and overtime approvals from every
  employee, with who raised it, for which dates, when they raised it, and whether it is still waiting.
  Click ESS, then ESS Requests. It is the screen that answers "what is stuck?".
- **Counters across the top of that list** — how many requests in total, how many still waiting, how many
  approved and how many refused, for the dates you chose.
- **See exactly how far up the chain a request has got** — each waiting request shows which of the five
  approval levels it is sitting at, colour-coded, so you can tell whether it is stuck with the supervisor
  or with the manager.
- **Choose the dates you are looking at** — the list opens on the current month only, so widening the two
  date boxes is what reveals the history (hundreds of requests, in this demo).
- **Filter requests by kind, by leave type, by status and by level** — including narrowing to just casual
  leave, sick leave, paid leave, loss of pay, compensatory off or maternity leave.
- **This request screen is for watching, not deciding** — you cannot approve or refuse from here; it is a
  monitor, and the approving is done on the leave and attendance screens.
- **Post an announcement to the staff** — a small screen to write a notice with a title, a date, a priority
  of normal, high or low, and a description, and to switch it on or off. Click ESS, then Announcement. It
  is how a company tells everybody something without an e-mail.
- **Edit or remove an announcement, and search old ones** — each notice can be reopened, changed or
  deleted, and there is a search box across titles and text.
- **Publish the company's policy documents** — upload the leave policy, attendance policy, overtime policy
  or loan policy as a PDF, picture or Word file, give it a name and a formatted description, and it joins
  a list every employee can read. Click ESS, then Company policies.
- **See the file before you publish it** — a small preview appears next to the upload box so you know you
  picked the right document.
- **A proper written description, not just a file name** — the description box is a full text editor with
  formatting, so a policy can carry a readable summary above the attachment.
- **Read a published policy on its own page** — a view button opens a clean page with the policy name, the
  date it was published, the description and a download link for the attachment.
- **Replace or withdraw a policy** — each published policy can be edited or deleted, and deleting asks for
  confirmation first, because staff may be relying on it.
- **Two switches on a person's own record control their portal access** — an ESS password and a block
  switch, which live on the employee's record rather than on these ESS screens, so one person can be shut
  out of the portal without changing anything company-wide.
- **What an employee is allowed to raise is decided by their staff category** — not on these screens, but
  on the master settings for the category, which is why two employees can see different options.
- **The employee's own portal was not visible here** — everything above is the administrator's side. The
  staff clearly have somewhere to raise requests (hundreds exist) and a manager clearly has somewhere to
  score a review (two exist), but there is no such screen in this login's menus and the sign-in page
  offers no employee door, so what an employee actually sees is not recorded in this document.
