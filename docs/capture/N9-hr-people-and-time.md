# N9 — HR part 1: Dashboard · Directory · Attendance · Time Tracking

**Site:** Nexeor Agency OS v2.0 — `https://os-staging.product.nexeor.com`
**Captured:** 2026-09-07, signed in as the shared demo account (`demo_om85i@demo.agency`).
**Scope:** the first four items of the sidebar's **HR** group, plus every screen and dialog they
open. Terminal N10 has Performance / Recruiting / Resources / Payroll; N5 has `/hr/portal`.

> **How this was captured, honestly.** All four screens opened normally with this account — none
> of them showed the "locked screen" that other batch-1 screens show. Every button was clicked,
> every dialog opened, every dropdown listed, then cancelled or navigated away from. **Nothing was
> saved, submitted, sent, approved, deleted or uploaded.** For the whole click-through the browser
> was additionally configured to refuse every non-GET request, so an accidental write was
> impossible; the log shows **zero blocked writes**, i.e. nothing I clicked even tried to change
> data. Native browser `confirm()` boxes were auto-dismissed (= Cancel) and their exact wording is
> recorded below.
>
> A handful of facts are marked **`[from code]`**. Those are labels, option lists, formulas or
> endpoints read out of the page's own shipped JavaScript, because the demo data has no rows to
> render them (there is not a single daily-attendance record, asset, or performance review in the
> whole database). Every `[from code]` string is a literal in the shipped bundle — none is guessed
> — but it was not seen painted on screen.

**Sidebar labels vs. real addresses.** In this group the labels mostly match, with one exception,
and Attendance has four sub-items that only appear when you are inside it:

| Sidebar label | Real address |
|---|---|
| Dashboard | `/hr/dashboard` |
| Directory | `/hr/employees` |
| Attendance | `/hr/attendance` |
| — Dashboard (List) | `/hr/attendance` |
| — Master Calendar | `/hr/attendance/calendar` |
| — Company Holidays | `/hr/attendance/holidays` |
| — Mark Attendance | `/hr/attendance/mark` |
| Time Tracking | `/hr/time-tracking` |
| Performance | `/hr/performance` *(N10)* |
| **Recruiting** | **`/hr/onboarding`** ← label and address differ |
| Resources | `/hr/resources` *(N10)* |
| Payroll | `/hr/payroll` *(N10)* |

Two further addresses are reached only from inside my scope: **`/hr/employees/<id>`** (the employee
detail screen), **`/hr/employees/bulk-edit`** (the spreadsheet), and **`/attendance`** — a
signed-out-friendly public leave portal linked from the Attendance header.

**Screens all render at 390 px** (document scroll width exactly 390 on all four; the sidebar turns
into an off-canvas drawer behind a hamburger).

---

# 1. Command Center — `/hr/dashboard`

**Where:** sidebar → **HR** → **Dashboard**. No tabs, no sub-pages.

**What you see on arrival.** A short page, three blocks. Top row: the title **"Command Center"**,
the subtitle *"Global oversight of agency personnel and actionable requests."*, and one blue button
**`Run Payroll Report`** on the right. Below, a two-thirds / one-third pair of cards: **The Pulse
(Today)** on the left, **Action Queue** on the right. Under both, full width, **Upcoming Milestones
(Next 30 Days)**. Footer: "POWERED BY NEXEOR • COPYRIGHT © 2026 NEXEOR CREATIVE TECHNOLOGIES".

**Data source:** one call, `GET /api/hr/dashboard`, returning `{pulse, actionQueue:{leaves,expenses},
upcomingMilestones:{probations,birthdays}, activeCount}`.

## 1.1 Numbers/cards on the page

**The Pulse (Today)** — header has a pulsing green dot. Two tiles side by side:

| Tile | Label | What it counts | Live value |
|---|---|---|---|
| left, white number | `ACTIVE EMPLOYEES` | `activeCount` — employees with status ACTIVE | **23** |
| right, rose number on a rose card | `ON LEAVE` | rows of today's attendance where `status === "LEAVE"` **`[from code]`** | **0** |

**Action Queue** — header has a badge reading **`<n> PENDING`** (amber when >0, plain white when 0).
The badge counts **pending leave requests only**. Live value: **`0 PENDING`**, and the body shows
the empty state — a circled tick icon and **"No pending approvals!"**.
`[from code]` when there IS something, this card lists:
- one row per pending **leave**: a sky clock icon, the person's name, "<TYPE> Request" underneath,
  and a `Review` button on the right;
- if there are pending **expense claims**, ONE emerald summary row: "<n> expense claim(s)" /
  *"Review expense approvals in Finance."* with an **`Open Finance`** button that jumps to
  `/finance/approvals`.

**Upcoming Milestones (Next 30 Days)** — purple calendar icon. Live value: **"No upcoming
milestones."** `[from code]` it lists two kinds of row, each with a round avatar initial and an
arrow button on the right (the arrow has no action):
- **birthdays** (purple avatar) — "Birthday on <Month d>";
- **probations** (amber avatar) — "Probation Ends on <Month d>".

## 1.2 Controls, in the order they appear

1. **`Run Payroll Report`** (blue, top right) — **does nothing.** Clicked and waited 3.5 s: no
   dialog, no navigation, no download, no network call. In the shipped code the button is declared
   with no `onClick` handler at all. There is no payroll-report output on this screen.
2. **`Review`** on a pending-leave row `[from code]` — opens the **Review dialog** (§1.3). Could not
   be exercised: this account has no pending leave.
3. **`Open Finance`** on the expense row `[from code]` — sets `window.location.href =
   "/finance/approvals"`. Leaves HR entirely.
4. **Arrow button** on each milestone row `[from code]` — declared with no handler; decorative.

## 1.3 Every dialog it opens

**"Review Leave Request" / "Review Expense Claim"** `[from code]` — one dialog, title switches on
which kind of row you clicked. Subtitle: *"Review and approve or reject this pending request."*
Body: avatar + person's name + the kind of request, then a bordered detail block —

| Row | Shown for |
|---|---|
| **Type** | leave |
| **Amount** (amount + currency) | expense |
| **Date** (e.g. "Jul 20, 2026") | both |
| **Reason** (under its own small heading) | both |
| **View Receipt →** (opens the file in a new tab) | expense, when a receipt exists |

Footer: **`Reject`** (rose outline) and **`Approve`** (emerald). Either one sends
`PATCH /api/hr/dashboard/action` with `{id, type, action:"APPROVED"|"REJECTED"}`, removes the row
optimistically and closes.

**Empty state:** the circled-tick block with "No pending approvals!" (Action Queue) and the italic
line "No upcoming milestones." (Milestones).

**Realtime/auto:** none. The page fetches once on mount and never refreshes itself.

---

# 2. Agency Roster — `/hr/employees`  (sidebar label: **Directory**)

**Where:** sidebar → **HR** → **Directory**.

**What you see on arrival.** Title **"Agency Roster"**, subtitle *"Manage team members, roles, and
profiles."* Top-right, a row of four buttons: **`Bulk Edit`** (purple), **`Manage Depts`** (indigo),
**`Add Employee`** (sky outline), **`Onboard`** (emerald). Second row: a wide **search box**
("Search by name, role, or department…"), then a **`Filters`** button, then a **two-icon view
toggle** (list / grid). The body is **grouped by department**, each group a heading + a round count
badge + a hairline rule, then that department's people.

**Data source:** `GET /api/hr/employees?status=Active` on load; `GET /api/hr/departments` and
`GET /api/hr/designations` for the pickers.

**Live grouping and counts:** Engineering **11**, Human Resources **4**, Marketing **3**,
No Department **5** — 23 rows, matching the dashboard's ACTIVE EMPLOYEES tile. The full roster in
the database is **31** people; the other 8 are non-ACTIVE (1 TERMINATED, 4 INVITED,
2 PENDING_VERIFICATION, 1 OFFER_SENT) and are hidden by the default status filter.

**Empty state:** a dashed-border box reading **"No employees found."**

**Realtime/auto:** none.

## 2.1 The two views

The **view toggle** is two small unlabelled icon buttons at the far right of the filter row
(a *list* icon and a *grid* icon). **Grid is the default.**

### Grid view — one card per person
Centre-aligned card: a badge strip across the top, a large round 2-letter avatar, the person's
**name**, the **employee code** in mono type, the **designation** (or *"No Designation"*), a green
**role-level** chip if set (`L1 JUNIOR` / `L2 MID` / `L3 SENIOR`), then two pill chips — the
**department** (or *"No Dept"*) and the **status** — and at the bottom, behind a divider, a mail
icon plus the **work email** (or *"Missing Work Email"*).

**Every badge and exactly when it shows** `[from code]`, verified against the live cards:

| Badge | Colour | Condition |
|---|---|---|
| `PROFILE INCOMPLETE` | amber, warning icon | profile incomplete (see rule below) and onboarding complete |
| `ONBOARDING INCOMPLETE` | amber, warning icon | onboarding tasks outstanding, profile complete |
| `PROFILE & ONBOARDING` | amber, warning icon | both of the above |
| `ONBOARDING` | red, pulsing | the row is a candidate (`isCandidateMode`), not yet an employee |
| `INTERN` | purple | `isIntern` |
| `UNLINKED PROFILE` | amber, pulsing | no linked Nexeor user account and not a candidate |
| `PROMOTION IN PROGRESS` | sky, pulsing | `isPromotionInProgress` |

**The "profile incomplete" rule, in full** `[from code]`: a profile counts as incomplete if ANY of
these is missing — department · designation · phone · emergency contact name · emergency contact
phone · address · joining date · (internship end date, if the person is an intern) · any email at
all (work, personal or the linked account's). **"Onboarding incomplete"** = the person has an
onboarding checklist and at least one item is unticked.

The **status pill** is emerald for `ACTIVE`, rose for `ON_LEAVE`, amber+pulsing and relabelled
`ONBOARDING` for a candidate, and plain grey for anything else (e.g. `TERMINATED`).

### List view — a table per department group

| Column header | Contents |
|---|---|
| `EMPLOYEE` | avatar initials, name, inline `INTERN` / `UNLINKED` tags, employee code |
| `DEPARTMENT` | department name, or `--` |
| `POSITION` | designation + role-level chip, or `--` |
| `BASE SALARY` | e.g. `AED 2,323`; for non-AED, the original plus a converted line, e.g. `INR 25,000` / `(AED 971)` |
| `STATUS / LINK` | `ACTIVE`, `TERMINATED`, … |
| `ACTIONS` | a `…` (ellipsis) button |

**Row actions:** there is only one. The `…` button — and clicking anywhere on the name cell —
opens the **Employee Preview** modal (§2.2). There is no dropdown menu, no per-row edit, no per-row
delete, and **no bulk-select checkboxes anywhere on this screen** (so no bulk action bar to
describe; the only bulk facility is the separate Bulk Edit page, §2.8).

**Sorting:** none. Rows are grouped by department and otherwise come back in the API's order.
**Page size:** none — every matching person renders; there is no pagination or "load more".

## 2.2 Employee Preview (modal)

Opened by clicking any card or row. Header: the small caps line **"EMPLOYEE PREVIEW"**, the
person's name as a large heading, and the employee code (or `--`) beneath; a `×` button labelled
"Close preview" on the right. Body: a two-column grid of icon + label + value —

`DEPARTMENT` (or "No Department") · `POSITION` (or "No Position") · `ROLE LEVEL` (underscore
replaced by a space, or "None") · `JOINING DATE` (or `--`) · `WORK EMAIL` (falls back to the linked
account's email, or `--`) · `PHONE` (or `--`) · `ADDRESS` (full width, or `--`).

Footer: **`Close`** (outline) and **`View More`** (blue) — View More navigates to
`/hr/employees/<id>`. **Escape closes it, and so does clicking the dark backdrop.**

## 2.3 `Filters` — the filter panel

A 360 px-wide panel drops out under the button. Header: **"Filter By"** / *"DEPARTMENT, POSITION,
SALARY OR JOINING DATE"* and a `×`. Four collapsed sections, each a row you click to expand
(the right-hand word flips **Show** ⇄ **Hide**), then **`Clear Filters`** and **`Apply`** side by
side at the bottom. Nothing is applied until you press Apply.

**1. Department / Position** — *"Click to show departments and positions"*. Expands to one
collapsible block per department, each showing the department name and **"<n> POSITIONS"**:
- Engineering — 1 POSITIONS
- Human Resources — 1 POSITIONS
- Marketing — 1 POSITIONS

Clicking a department expands it to **`All positions`** plus that department's positions as
sub-rows (Engineering → *Software Engineer*; Human Resources → *HR Specialist*; Marketing →
*Marketing Manager*); a department with none shows the italic line *"No positions"*. Selecting a
department alone filters to the department; selecting a position narrows further. One department
at a time.

**2. Salary Range** — *"Click to set max monthly salary"*. Expands to a **`Clear`** link and a
single slider: `min 0 · max 50000 · step 500`, default at the top. Under it, three markers — `0`,
the live value (**"Any"** when cleared, otherwise `AED <n>` with thousands separators), and
`50,000+`. It is a **maximum** salary, not a band.

**3. Date of Joining** — *"Click to filter by joining date"*. Expands to two date inputs,
**`FROM`** and **`TO`**, both empty by default.

**4. Status** — *"Click to filter by employee status"*. Expands to three checkboxes. **Complete
list, and the default:**
- `Active` — **ticked by default**
- `Terminated` — unticked
- `Onboarding` — unticked

Those three are the whole choice on screen, but the database holds five statuses (`ACTIVE`,
`TERMINATED`, `INVITED`, `PENDING_VERIFICATION`, `OFFER_SENT`), so "Onboarding" is the umbrella for
the three invite/offer states.

**Search box** — filters by name, role or department. Client-side; no network call, no debounce
visible.

## 2.4 `Manage Depts` → the **Organization Manager** dialog

Title **"Organization Manager"** with a sky building icon and a `×`. Two tabs: **`Departments`**
(default) and **`Positions`**.

**Departments tab** — a **`Create Department`** button, then the existing list, each row the name
and **"<n> Members"**:
- Engineering — 12 Members
- Human Resources — 4 Members
- Marketing — 3 Members

(Note: the roster's Engineering group counts 11 because it only counts ACTIVE people; this list
counts 12, including the terminated one.)

Below the list, a **New Department** composer with two fields:
- **`DEPARTMENT NAME`** — text, placeholder *"e.g. Design, Marketing"*
- **`ICONOGRAPHY SELECTION`** — a search box (*"Search icons (e.g. Code, Palette, Zap)…"*) over a
  grid of icon buttons. **The option list is the entire Lucide icon set**, alphabetical and
  lazily rendered — with an empty search it starts `AArrowDown, AArrowUp, ALargeSmall,
  Accessibility, Activity, ActivitySquare, AirVent, Airplay, AlarmCheck, AlarmClock,
  AlarmClockCheck, AlarmClockMinus, AlarmClockOff, AlarmClockPlus, AlarmMinus, …` and continues
  for well over a thousand names. It is not a curated list, so it is not reproduced in full here.

Footer: **`Save Changes`**.

**Positions tab** — identical shape. **`Create Position`** button, then:
- HR Specialist — 4 Members
- Marketing Manager — 3 Members
- Software Engineer — 10 Members

Composer: **`POSITION NAME`** (placeholder *"e.g. Senior Designer, Manager"*) and the same
**`ICONOGRAPHY SELECTION`** picker. Footer **`Save Changes`**.

## 2.5 `Add Employee` → **"Add Employee (Offline Profile)"** dialog

Creates a record for somebody who will not (yet) be able to log in. Every field, in order:

| # | Field | Type | Required | Default |
|---|---|---|---|---|
| 1 | `FIRST NAME *` | text | **yes** | empty |
| 2 | `LAST NAME` | text | no | empty |
| 3 | `DEPARTMENT` | dropdown | no | *Select Dept…* |
| 4 | `DESIGNATION` | dropdown | no | *Select Role…* |
| 5 | `REPORTING MANAGER` | dropdown | no | *No manager set…* |
| 6 | `ROLE LEVEL` | dropdown | no | **No Level** |
| 7 | currency | dropdown | no | **AED** |
| 8 | `MONTHLY BASE SALARY` | number, step 1 | no | `0` |
| 9 | `JOINING DATE *` | date | **yes** | empty |
| 10 | `Is Intern Profile` | switch | no | off |
| 11 | `WORK EMAIL` | email | no | empty |
| 12 | `PERSONAL EMAIL` | email | no | empty |
| 13 | `PERSONAL PHONE` | text | no | empty |
| 14 | `ADDRESS / LOCATION` | text | no | empty |
| 15 | `EMERGENCY CONTACT NAME` | text | no | empty |
| 16 | `EMERGENCY CONTACT PHONE` | text | no | empty |
| — | **Financial Information** — heading, with a live "`<CUR>` Format" tag | | | |
| 17.. | bank fields — see below | text | no | empty |

**Complete dropdown option lists.**

- **`DEPARTMENT`** (4): `Select Dept...` · `Engineering` · `Human Resources` · `Marketing`
- **`DESIGNATION`** (4): `Select Role...` · `HR Specialist` · `Marketing Manager` ·
  `Software Engineer`
- **`ROLE LEVEL`** (4): `No Level` · `Junior (L1)` · `Mid-Level (L2)` · `Senior (L3)`
- **currency** (2): `AED` · `INR`
- **`REPORTING MANAGER`** (32) — *every employee record, shown as "Name — Designation" when they
  have one*: `No manager set...` · `Amal Vijaykumar — Software Engineer` · `Ganesh Sn` ·
  `Gokulakrishnan R` · `Kartik Kittad — Software Engineer` · `Kingson` ·
  `Megha — Software Engineer` · `Mock Employee 10 — HR Specialist` ·
  `Mock Employee 9 — Software Engineer` · `Mock Employee 3 — Software Engineer` ·
  `Mock Employee 1 — HR Specialist` · `Mock Employee 2 — Marketing Manager` ·
  `Mock Employee 4 — HR Specialist` · `Mock Employee 5 — Marketing Manager` ·
  `Mock Employee 7 — HR Specialist` · `Mock Employee 8 — Marketing Manager` ·
  `Mock Employee 6 — Software Engineer` · `Navaneeth B` · `Rohit Vinod` ·
  `Syeda Kulsum — Software Engineer` · `Test Demo` · `chris george — Software Engineer` ·
  `swathi krishna — Software Engineer` · `test er — Software Engineer` · `test` ·
  `Mock Employee S — Software Engineer` · `MEGHA M — Software Engineer` ·
  `Megha M — Software Engineer` · `chris g — Marketing Manager` ·
  `leya xyz — Software Engineer` · `Mock employee U — Software Engineer` ·
  `John Doe — Marketing Manager`

**The bank block changes shape with the currency** — this is the one genuinely conditional part
of the form:

| Currency | Fields shown |
|---|---|
| **AED** (tag reads "AED Format") | `ACCOUNT NAME` · `IBAN` · `SWIFT CODE` · `BANK NAME` · `BRANCH` |
| **INR** (tag reads "INR Format") | `ACCOUNT NAME` · `ACCOUNT NUMBER` · `IFSC CODE` · `BANK NAME` · `BRANCH` · `UPI ID` (placeholder `xyz@upi`) |

Buttons: **`Cancel`** · **`Save Profile`**. *(Cancelled — nothing saved.)*

## 2.6 `Onboard` → **"Start Onboarding"** dialog

Subtitle: *"Send a welcome email perfectly automatically securely."* A switch **`Onboard as
Intern`** sits in the header. Fields:

| # | Field | Type | Required | Default |
|---|---|---|---|---|
| 1 | `FIRST NAME` | text, placeholder `John` | **yes** | empty |
| 2 | `LAST NAME` | text, placeholder `Doe` | **yes** | empty |
| 3 | `PERSONAL EMAIL` | email, placeholder `candidate@example.com` | **yes** | empty |
| 4 | `DEPARTMENT` | dropdown | **yes** | *Select Dept…* |
| 5 | `DESIGNATION` | dropdown | **yes** | *Select Role…* |
| 6 | `REPORTING MANAGER (OPTIONAL)` | dropdown | no | *None / HR Department* |
| 7 | currency | dropdown | no | **AED** |
| 8 | `MONTHLY COMP` | number, min 0, step 0.01, placeholder `20000` | **yes** | empty |
| 9 | `EXPECTED JOINING DATE` | date | **yes** | empty |
| 10 | `PROBATION PERIOD (MONTHS)` | number, min 1, placeholder `e.g. 6` | **yes** | **6** |

**Complete dropdown option lists** (the two that differ from Add Employee):

- **currency** (4 here, not 2): `AED` · `INR` · `USD` · `EUR`
- **`REPORTING MANAGER (OPTIONAL)`** (28) — *this one lists Nexeor **user accounts**, with each
  one's system role in brackets, not employee records*: `None / HR Department` · `xyz (STAFF)` ·
  `abcd (STAFF)` · `Mathangi Chandu (ADMIN)` · `ritika (ADMIN)` · `Antra Agrawal (ADMIN)` ·
  `Sandra KK (ADMIN)` · `Deep Sheth (ADMIN)` · `akhila kr (ADMIN)` · `Dhrumil Gadaria (ADMIN)` ·
  `work6 (STAFF)` · `Test Demo (ADMIN)` · `Emaad Sultan (ADMIN)` · `Megha M (ADMIN)` ·
  `Kingson Thomas (ADMIN)` · `Admin (ADMIN)` · `Amal Vijayakumar (ADMIN)` · `Ganesh S N (ADMIN)` ·
  `Syeda Umme Kulsum (ADMIN)` · `Kevin Norbert (ADMIN)` · `Info Nexeor (ADMIN)` ·
  `Navaneeth B (ADMIN)` · `Gokulakrishnan R (ADMIN)` · `Kartik Kittad (ADMIN)` ·
  `Swathikrishna U S (ADMIN)` · `Rayan Patel (ADMIN)` · `Chris george (ADMIN)` ·
  `Rohit Vinod (ADMIN)`
- `DEPARTMENT` and `DESIGNATION` are the same 4-option lists as §2.5.

Buttons: **`Cancel`** · **`Send Onboarding Link`**. *(Cancelled — no email sent.)* The record it
creates is what later shows the red pulsing `ONBOARDING` badge on the roster.

## 2.7 `Bulk Edit` → **Bulk Edit Spreadsheet**, `/hr/employees/bulk-edit`

A full page, not a dialog. Header: a **`Back`** link to the Directory, the title **"Bulk Edit
Spreadsheet"**, the subtitle *"Rapidly orchestrate employee data updates in one go."*, and on the
right **`Add Row`** (emerald outline) and **`Save All Data`** (purple). One editable row per
employee — **31 rows, every person including non-active ones** — and every cell is a live input.

**Every column, left to right, with its input type:**

| # | Column header | Input |
|---|---|---|
| 1 | `FIRST NAME` | text |
| 2 | `LAST NAME` | text |
| 3 | `DEPARTMENT` | dropdown: `No Department` · `Engineering` · `Human Resources` · `Marketing` |
| 4 | `ROLE / POSITION` | dropdown: `No Role` · `HR Specialist` · `Marketing Manager` · `Software Engineer` |
| 5 | `LEVEL` | dropdown: `No Level` · `L1 (Junior)` · `L2 (Mid)` · `L3 (Senior)` |
| 6 | `SALARY` | a currency dropdown (`AED` · `INR`) + a number box, in one cell |
| 7 | `PHONE NUMBER` | text |
| 8 | `WORK EMAIL` | email, placeholder `work@agency.com` |
| 9 | `PERSONAL EMAIL` | email, placeholder `personal@mail.com` |
| 10 | `BANK` | a small building-icon button, tooltip "Edit Bank Details" → opens the dialog below |
| 11 | `DATE OF JOINING` | date |
| 12 | `INTERN?` | checkbox |
| 13 | `INTERNSHIP END` | date **when `INTERN?` is ticked**; otherwise a greyed, unusable cell reading *"Not Applicable"* |

**`Add Row`** prepends one blank row (currency defaults to AED, salary to 0) — it does not save.
**There is no per-row delete on this page.**

**`Save All Data`** sends every row at once: `PUT /api/hr/employees/bulk-edit` with
`{updates:[…]}`. On success a green chip appears next to the buttons — **"Successfully pushed
updates for all rows."** — and clears itself after 3 seconds; on failure, **"Failed to update
employees."** or **"An error occurred while saving."** *(Not pressed.)*

### The **Bank Details Config** dialog (from the `BANK` cell)

Title "Bank Details Config" with a `×`. First a read-only row **`Currency Mode`** showing that
row's currency in green. Then **`Account Name`** (forced upper-case), and after that the same
currency split as the Add Employee form:

- **AED**: `IBAN` · `Swift Code` · `Bank Name` · `Branch`
- **INR**: `Account Number` · `IFSC Code` · `Bank Name` · `Branch` · `UPI ID` (placeholder `xyz@upi`)

One button: **`Done`** — which only closes the dialog. The values are not written until you press
**Save All Data** on the page behind it.

## 2.8 Built, but with no way in: **Bulk Import Roster**

The Directory ships a complete two-step import modal that **no button on any screen opens.** It is
wired into the page's render tree, but the function that would switch it on is never called
anywhere in the bundle. Recorded here because it is finished work the owner would otherwise not
know exists `[from code]`:

- Title **"Bulk Import Roster"**, subtitle *"Supports CSV/TSV with columns: Name, Position,
  Department, Monthly Salary, Comments, Personal Email, Work Email, Bank Details"*.
- **Step 1** — an emerald **"AI Generator Prompt"** panel (*"Provide this precise instruction block
  to an LLM like ChatGPT or Claude, and it will guarantee a perfectly structured matrix compatible
  with this importer."*) with a **`Copy Prompt`** button that flips to **`Copied!`** for 2 seconds.
  The prompt it copies is: *"Act as an expert HR Manager. Generate an employee roster table. Output
  your response as a standard Markdown table so I can easily copy it into Excel/Google Sheets.
  Include these exact headers: Name | Position | Department | Monthly Salary | Comments | Personal
  Email | Work Email | Bank Details. Rules: Name: First and Last Name. Monthly Salary: Numbers
  only. Designation: Be specific (e.g., Senior Full Stack Engineer)"*.
  Then **"Paste Table Data"** (*"Secondary quick-import method"*) — a textarea that parses a
  tab-separated paste the moment you drop it in — an "Or File Upload" divider, and a dashed
  drop-zone (**"Click to select CSV/TSV file…"**, accepts `.csv .tsv .txt`; error if the file has
  fewer than two lines: *"File must contain a header row and data."*).
- **Step 2** — "Found <n> valid employee records", an **`Upload Different File`** link, and an
  editable preview table: `First Name` · `Last Name` · `Position` · `Department` · `Salary` ·
  `Work Email` · `Personal Email` · `#` (an `×` that drops that row). Footer: **`Cancel`** and
  **`Finalize Import`** → `POST /api/hr/employees/bulk`.

---

# 3. The employee detail screen — `/hr/employees/<id>`

**Where:** Directory → click a person → **`View More`** in the preview modal. (This is the single
deepest screen in the group; the URL carries the employee's internal id.)

**Data source:** `GET /api/hr/employees/<id>`, plus `GET /api/hr/employees/<id>/holidays` and
`GET /api/settings/users`.

**What you see on arrival.** A 190 px sky→indigo gradient banner. Along its top: **`Back to
Directory`** on the left, and on the right a cluster of action buttons. Overlapping the bottom of
the banner, a large 112 px rounded avatar (the linked account's photo, or 2 initials), and beside it
the person's **name** as a big heading with badges after it, then a grey line
"`<Designation> • <Department>`". Below the banner: an amber **"Profile Incomplete"** notice when
applicable, then a **link-status card**, then the **seven tabs**, then the active tab's content.

## 3.1 Header buttons — exactly which appear, and when

| Button | Shown when | What it does |
|---|---|---|
| **`Back to Directory`** | always | link to `/hr/employees` |
| **`Promote to Permanent`** (emerald, award icon) | **only if the person is an intern** | opens the Promote dialog (§3.3) |
| **`Offboard`** (rose outline) | always | opens the Offboard dialog (§3.3) |
| **a red trash-icon button, no label** | always | **permanently deletes the employee.** Native confirm: *"Are you absolutely sure you want to permanently delete this employee? This action cannot be undone."* → `DELETE /api/hr/employees/<id>` → redirects to the Directory. Easy to miss: it carries no text at all, just an icon, sitting between Offboard and Edit Profile. *(Dismissed.)* |
| **`Edit Profile`** (white) | always | opens the Edit Employee Profile dialog (§3.3) |

**Badges next to the name:** `ACTIVE` / `TERMINATED` (the raw status), `INTERN` where applicable,
and **`OFFLINE ACCOUNT`** when the record has no linked Nexeor user.

**The "Profile Incomplete" notice** reads: *"Important fields like contact info, job parameters, or
base salary are not provided."* It uses the same rule as the roster badge (§2.1).

**The link-status card** has two forms:
- linked — heading **"Linked Profile"**, *"This profile is successfully linked to a Nexeor User
  account."*, and one button **`Unlink Profile`**. That button opens a **native browser confirm**,
  not a styled dialog: *"Are you sure you want to unlink this user account? The employee will lose
  access to the portal."* → `POST /api/hr/employees/<id>/unlink`. *(Dismissed.)*
- unlinked — heading **"Unlinked Profile"**, *"This profile was generated offline. They cannot log
  in until linked to an active Nexeor User."*, and **two** buttons, **`Invite to OS`** and
  **`Connect manually`** (§3.3).

## 3.2 The seven tabs

Tabs, in order: **`Personal Data`** (default) · **`Onboarding`** · **`Job & Timeline`** ·
**`Vault`** · **`Payroll Ledger`** · **`Assets`** · **`Performance`**. Switching is instant and
local — only the Performance tab fetches (`GET /api/hr/performance/cycles?employeeId=<id>`).

### Tab 1 — `Personal Data`
Three stacked blocks, all read-only display.

- **Personal Information** — `PHONE NUMBER` · `WORK EMAIL (PRIMARY)` · `PERSONAL EMAIL` ·
  `ADDRESS`. Missing values render as an em-dash **—**.
- **Emergency Contact** — `CONTACT NAME` · `CONTACT PHONE`.
- **Bank & Payout Details** — shows only the bank fields that are filled: e.g. `ACCOUNT NAME`
  alone for one person, `ACCOUNT NAME` + `BANK NAME` + `A/C NUMBER` for another, and nothing at all
  when the record has no bank data. One button, **`Edit Bank Details`** — which opens the **whole
  Edit Employee Profile dialog** (§3.3), not a bank-only form.

### Tab 2 — `Onboarding`
Heading **"Onboarding Checklist"**, *"Track essential setup tasks for new hires."*, and a big
**`<n>%` PROGRESS** figure (live: **0%**). Then the checklist. **All seven items, in order — this
is the fixed default list every new record gets:**

1. `Create Workspace Email` (`email_creation`)
2. `Send Onboarding Email with Handbook` (`send_handbook`)
3. `Add to Slack Workspace` (`slack_invite`)
4. `Send Agency OS Invite Link` (`app_invite`)
5. `Sign Non-Disclosure Agreement (NDA)` (`nda_sign`)
6. `Submit Bank Details for Payroll` (`bank_details`)
7. `Acknowledge Code of Conduct` (`read_handbook`)

**Each row is itself the control** — clicking it toggles that item and **immediately** sends
`PATCH /api/hr/employees/<id>` with the whole task array. There is no confirm, no Save button and
no undo, so these were deliberately **not clicked**. There is no way to add, rename or remove an
item.

### Tab 3 — `Job & Timeline`
Heading **"Job & Timeline"**, *"Employment history, roles, and status changes."*

- Two read-only figures: **`DATE OF JOINING`** and **`PROBATION ENDS`** (renders **"Not set"** when
  empty — it is empty for every person in this database).
- **Attendance Record (Last 10 Days)** — empty for every single employee: **"No attendance logged
  yet."** There are no daily-attendance rows anywhere in this product's data.
- **Holiday Selection (Opt-In & National)** — the interesting part. A counter
  **"`<n>` / 13 Optional Holidays Selected"** (13 comes from the company policy's
  `totalHolidaysPerYear`; the count excludes anything typed "national"), a **`Save Holidays`**
  button, and then every company holiday as a tickable row showing its name and
  "`<type>` • `<date>`". Live list of all 14:

  `New Year` — Public Holiday • 1/1/2026 · `Eid Al Fitr` — Public Holiday • 3/20/2026 ·
  `Labor Day` — Public Holiday • 5/1/2026 · `Test Holiday 1` — Company Holiday • 6/6/2026 ·
  `Test Holiday 2` — 6/7/2026 · `Test Holiday 3` — 6/8/2026 · `Test Holiday 4` — 6/9/2026 ·
  `Test Holiday 5` — 6/10/2026 · `Test Holiday 6` — 6/11/2026 · `Test Holiday 7` — 6/12/2026 ·
  `Test Holiday 8` — 6/13/2026 · `Test Holiday 9` — 6/14/2026 · `Test Holiday 10` — 6/15/2026 ·
  `National Day` — Public Holiday • 12/2/2026

  Live counters seen: Amal `0 / 13`, Kartik `4 / 13`, Mock Employee 9 `13 / 13`.
  `Save Holidays` sends `POST /hr/employees/<id>/holidays` with `{holidayIds}`; failure alerts
  *"Failed to save holidays."* *(Not pressed.)*

### Tab 4 — `Vault`
Heading **"Document Vault"**, *"Upload exactly required identity and operational files."* One
button **`Upload Document`** — it opens the **operating system's file picker** (a hidden file input,
**no type restriction, one file at a time**), so there is no in-app dialog to photograph. While it
works the button reads **"Uploading…"**; on failure it alerts *"Document upload failed."* /
*"Failed to save document."* The upload is two calls: `POST /api/upload` (multipart, into folder
`hr/employees/<id>/documents`) then `POST /api/hr/employees/<id>/documents`.

**Every document is filed under the category `OTHER`, always** — the category is hard-coded; there
is no picker.

**Empty state:** a dashed box, **"No documents uploaded yet."**
**A document row** (seen live on one employee: `JANTA Decor Logo.cdr.zip`, `OTHER`, `PENDING`) is a
card with a file icon, the file name, its category, and a status chip — **`VERIFIED`** in emerald or
**`PENDING`** in amber. The whole card is a link: clicking it opens the file in a new tab. **There
is no verify, rename, re-categorise or delete control on this tab** — a document, once up, can only
be opened.

### Tab 5 — `Payroll Ledger`
Heading **"Payroll & Ledger"**, *"Salary base configurations and processed payruns."* Two cards
side by side, then a history list.

- **`BASE SALARY`** — the figure in the person's own currency, and **when that isn't AED, a second
  line "converted: AED <n>"** (live: `INR 25,000` → *converted: AED 971*). Button
  **`Modify Compensation Range`** — which opens the same **Edit Employee Profile** dialog (§3.3).
- **`PAYOUT ACCOUNT`** — reads **"Bank Setup"** with the note *"Full details securely stored in
  Personal Data"*, and a **`View Bank Details`** button. That button does **not** open anything:
  it simply switches you to the Personal Data tab, where the bank block lives.
- **Payment History** — small caps **"RECENT RECORDS"**. Empty state: *"No processed payroll
  records found."* A row (live, on Kartik) shows the payrun name, the amount + *"Base Paid"*, an
  emerald **`PROCESSED`** chip, and the paid-at timestamp:
  - `Jan 2026 Payroll` — 50,000 Base Paid — PROCESSED — 1/28/2026, 5:30:00 AM
  - `Dec 2025 Payroll` — 50,000 Base Paid — PROCESSED — 12/28/2025, 5:30:00 AM

  These rows are read-only; there is no drill-through to a payslip from here.

### Tab 6 — `Assets`
Heading **"Assigned Assets"**, *"Hardware tracking and software seats."* One button
**`Assign Asset`** — and **it does nothing.** Clicked and waited: no dialog, no file input, no
network call, no console error; in the shipped code the button carries no `onClick`. **There is
therefore no way to give anybody an asset from this product**, and the empty state
**"No assets distributed to this profile."** is what every one of the 31 employees shows.
`[from code]` an asset row, if one existed, would show the asset **name**, a **TYPE** chip,
**"SN: <serial number>"** when present, and **"Assigned: <date>"** on the right. No unassign
control.

### Tab 7 — `Performance`
Heading **"Performance reviews"** with the descriptive line **"90° review — manager feedback,
scored out of 5, every 6 months"**. Empty state: *"No reviews recorded yet."* — true for every
employee. `[from code]` an HR user also gets a create-review button here, and each review row
offers a **Remind** action (`POST /api/hr/performance/cycles/<id>/remind`, which reports back
through a browser alert), status changes (`PATCH …/cycles/<id>`, which can ask for confirmation a
second time when feedback is still outstanding), and a delete guarded by the confirm *"Delete this
review and all feedback collected in it? This cannot be undone."* The full Performance screen is
N10's scope.

## 3.3 Every dialog the detail screen opens

**"Edit Employee Profile"** — reached from **three** different buttons (`Edit Profile`,
`Edit Bank Details`, `Modify Compensation Range`); all three open the identical dialog, pre-filled.
Its fields, defaults and dropdown lists are **exactly the Add Employee form in §2.5** (same 16
fields plus the currency-dependent bank block; `FIRST NAME` required, `JOINING DATE` required,
`REPORTING MANAGER` listing all 32 employee records). Buttons **`Cancel`** · **`Save Profile`**.
*(Cancelled.)*

**"End Service / Offboard"** — warning icon, subtitle *"Transition this employee to inactive."*
Body text: *"Marking an employee as offboarded will disable their active standing but retain their
historical data (Ledger, Assets, Documents)."* One field, **`LAST WORKING DATE`** (date, empty by
default). Then an amber note: *"Note: Remember to upload end-of-service and final settlement
documents to their Vault after this process."* Buttons **`Cancel`** ·
**`Confirm Offboarding`** — **disabled until a date is chosen**. It sends
`PATCH /api/hr/employees/<id>` with `{status:"TERMINATED", exitDate}`. *(Cancelled.)*

**"Promote to Permanent"** (interns only) — subtitle *"Issue a new offer letter. Notification will
be sent to their registered email."* Fields:
- **`NEW JOINING DATE`** — date, **defaults to today**
- **`REVISED BASE SALARY`** — number, pre-filled with the current salary
- **`REPORTING MANAGER`** — dropdown of the 27 Nexeor **user accounts** (no role suffix here):
  `Select a user...` · `xyz` · `abcd` · `Mathangi Chandu` · `ritika` · `Antra Agrawal` ·
  `Sandra KK` · `Deep Sheth` · `akhila kr` · `Dhrumil Gadaria` · `work6` · `Test Demo` ·
  `Emaad Sultan` · `Megha M` · `Kingson Thomas` · `Admin` · `Amal Vijayakumar` · `Ganesh S N` ·
  `Syeda Umme Kulsum` · `Kevin Norbert` · `Info Nexeor` · `Navaneeth B` · `Gokulakrishnan R` ·
  `Kartik Kittad` · `Swathikrishna U S` · `Rayan Patel` · `Chris george` · `Rohit Vinod`
  (default in the underlying state is `HR Department`)

Below the fields, an amber block appears when the record is thin — heading **"Incomplete HR
Vault"**, text *"This intern is missing critical profile documents (e.g. Bank Details, ID). We
recommend triggering the full onboarding link so they can populate these records before signing
their offer."* Buttons on the version I opened: **`Trigger Full Onboarding`** and
**`Cancel Operations`**. It posts to `/api/hr/employees/<id>/promote` with
`{joiningDate, baseSalary, designationId, departmentId, reportingManager, sendDirectOfferLink}`;
if anything is blank it alerts *"Please fill all details including Reporting Manager."*
*(Cancelled.)*

**`Invite to OS`** (unlinked profiles) — not a modal but an **inline panel** inside the link-status
card. Two controls:
- **`EMAIL ADDRESS`** — email input, placeholder `colleague@agency.com`
- **`ASSIGN PERMISSIONS`** — a **`Select Roles…`** multi-select. **Complete option list (7):**
  `System Admin` · `QA team` · `multiple member test team` · `Developer Team` ·
  `Marketing Team` · `HR Department` · `Sales Team`

  Buttons: **`Dispatch Invite`** · **`CANCEL`**. *(Cancelled.)*

**`Connect manually`** (unlinked profiles) — also an inline panel: a list of the **unclaimed Nexeor
user accounts** to attach this employee record to, one button each, alphabetical. Live list (14):
`Admin` · `Antra Agrawal` · `Deep Sheth` · `Dhrumil Gadaria` · `Emaad Sultan` · `Info Nexeor` ·
`Kevin Norbert` · `Mathangi Chandu` · `Rayan Patel` · `Sandra KK` · `abcd` · `akhila kr` ·
`ritika` · `xyz`. Plus a **`CANCEL`** button. *(Cancelled.)*

## 3.4 The employee record, field by field

The record behind this screen — useful if the owner is rebuilding the table `[from API shape]`:

`id` · `userId` (null = offline profile) · `firstName` · `lastName` · `employeeCode` (e.g.
`EMP-R35ITN`, `EMP1003`) · `personalEmail` · `workEmail` · `phone` · `emergencyContactName` ·
`emergencyContactPhone` · `address` · `birthDate` · `departmentId` · `designationId` · `roleLevel`
· `employmentType` · `location` · `joiningDate` · `probationEndDate` · `status` · `isIntern` ·
`internshipEndDate` · `exitDate` · `baseSalary` · `currency` · `bankDetails` (a nested object:
`accountName`, `accountNumber`, `ifsc`, `iban`, `swift`, `bankName`, `branch`, `upiId`) · `notes` ·
`onboardingTasks` (the array of 7) · `managerId` · `isPromotionInProgress` · `promotionStatus`,
and the joined collections **documents · leaves · attendance · assets · expenses ·
performanceReviews · payrunLines**.

**Live value sets in this database:** `status` — ACTIVE 23, INVITED 4, PENDING_VERIFICATION 2,
TERMINATED 1, OFFER_SENT 1. `employmentType` — `FULL_TIME` only. `roleLevel` — `L1_JUNIOR`,
`L2_MID`, `L3_SENIOR` or null. `currency` — AED 25, INR 6. `isIntern` — true for 6.
`location`, `promotionStatus`, `birthDate` — **null for every single person**, which is why the
dashboard's birthday milestones never populate.

The four INVITED / two PENDING_VERIFICATION / one OFFER_SENT rows have **no employee record on the
detail endpoint at all** — they are candidates, not employees, and clicking through to them is not
possible from the default (Active) roster.

---

# 4. Attendance — `/hr/attendance` and its three sub-screens

Every screen in this family carries a shared header strip: the small caps title **"ATTENDANCE
MANAGEMENT SYSTEM"** on the left and an **`Open Public Portal`** button (globe icon) on the right,
which opens `/attendance` (§4.5). The sidebar's Attendance item expands to the four sub-items while
you are in here.

## 4.1 Attendance & Leaves — `/hr/attendance`  *(sidebar sub-item: DASHBOARD (LIST))*

**What you see on arrival.** Title **"Attendance & Leaves"**, subtitle *"Master calendar for
tracking PTO, sick leaves, and public holidays."*, and a blue **`Request Leave / Log Absence`**
button top-right — which is a plain link to `/hr/attendance/mark`. Below, a 2:1 layout: a tall
**Upcoming Leaves & Holidays** panel on the left, and stacked on the right **Pending Requests** and
**Activity Log**.

**Data source:** `GET /api/hr/attendance` (no month parameter) and
`GET /api/hr/attendance?activityPage=1&activityLimit=5`.

**Numbers on the page:** only one — the Activity Log's **"`<n>` total"** (live: **43 total**).

### Upcoming Leaves & Holidays
Header has **`Prev`** and **`Next`** buttons. **Both do nothing** — clicked, no request, no change;
in the shipped code neither button has a handler. There is no working period navigation on this
screen, which matters because the panel asks the API for **no month at all**, so it always comes
back empty and always shows its empty state: **"No activity recorded for this period."**

`[from code]` when it does have rows it mixes three kinds, and this is what each looks like:
- **a leave** — a round avatar of the person's initials (replaced by a **⃠ ban icon** for unpaid
  leave), their name, a **type chip** (`PTO` rose · `SICK` orange · `UNPAID` amber) and a **status
  chip** (`APPROVED` emerald · `PENDING` amber · `REJECTED` rose), and on the right the dates as
  "<start> to <end>". Unpaid rows get an amber left border. Hovering shows a floating card with the
  name, the type and the reason in quotes — or *"No explicit reason logged."* Two hover controls:
  a **pencil** ("Edit leave type") that swaps in three inline buttons **`PTO` `SICK` `UNPAID`**
  (each sends `PATCH /api/hr/attendance/<id>` with `{type:"leave", leaveType}`), and a **bin**.
- **an attendance/presence row** — emerald avatar, name, **"Clocked In: <time>"** (or `--`), the
  date, and a bin.
- **a company holiday** — indigo avatar, the holiday name, its type (or "Company Holiday"), the
  date, and a bin.

**Every bin uses a native browser confirm — "Delete this entry?"** — then
`DELETE /api/hr/attendance/<id>?type=leave|attendance|holiday`. *(Not exercised.)*

### Pending Requests
Amber tick icon. Live state: **"No pending leave requests"**. `[from code]` a row shows the
person's name, the date range, and two half-width buttons — **`Approve`** (emerald) and
**`Reject`** (rose) — each sending `PATCH /api/hr/attendance/<id>` with
`{type:"leave", status:"APPROVED"|"REJECTED"}` and spinning while it saves. **This is the only
approval step in the whole leave flow: one person, one click, no second approver, no comment box.**

### Activity Log
Indigo activity icon, the **"43 total"** counter, and a vertical timeline of five entries at a
time — each a one-line description plus "by `<name>` • `<date, time>`" (falling back to "System").
Live entries:
- *Leave request marked as APPROVED* — by Syeda Umme Kulsum • 7/10/2026, 6:01:45 PM
- *Leave request marked as APPROVED* — by Syeda Umme Kulsum • 7/10/2026, 5:57:33 PM
- *Submitted leave: PTO from 10 Jul to 10 Jul* — by Syeda Umme Kulsum • 7/10/2026, 5:52:47 PM
- *Submitted leave: PTO from 10 Jul to 10 Jul* — by Syeda Umme Kulsum • 7/10/2026, 5:50:53 PM
- *Leave request marked as APPROVED* — by Gokulakrishnan R • 5/28/2026, 9:53:15 PM

At the bottom, **`LOAD MORE (38 REMAINING)`** — a working paginator, 5 rows a page, that counts
down as you go. Empty state: "No recent activities". The activity rows are typed `ATTENDANCE_LOG`.

## 4.2 Master Calendar — `/hr/attendance/calendar`

**What you see on arrival.** Title **"Master Calendar"** (sky calendar icon), subtitle *"Unified
view of all company holidays, leave requests, and daily presences."* Top-right, on one line: a
**colour legend**, an **employee dropdown**, then **`‹`  `<Month Year>`  `›`** and a **`Today`**
button. The body is a month grid; a 384 px panel down the right side shows one day's detail.

**Data source:** `GET /api/hr/attendance?month=<0-based>&year=<yyyy>` on every month change, plus
`GET /api/hr/employees` and `GET /api/settings/config?module=HR`.

### The legend — every code and what it means
Four dots in a pill at the top right. **This is the full legend; there is no other key anywhere in
Attendance:**

| Dot | Label | Meaning |
|---|---|---|
| rose | **Leave** | an approved leave that is inside the monthly allowance |
| white | **Pending** | a leave request nobody has approved or rejected yet |
| indigo | **Holiday** | a company or public holiday |
| amber | **Unpaid** | unpaid leave — **and also** a paid/sick leave that has gone over the monthly allowance |

There is deliberately **no "present" / "absent" / "half day" / "week-off" code** on this calendar.
The product does not model a day as one of several attendance states: a day is made of *events*
(holidays, leave records, clock-ins). Half-day is a **flag on a leave record**
(`isHalfDay`), shown as the words "HALF DAY" / "FULL DAY" in the day panel, not as its own colour.
Weekends are only a slightly darker cell; there is no configurable week-off.

### What a cell shows
The day number, then a stack of small chips — the chip is a **count**, not a name, so a busy day
stays legible `[from code, matched against live cells]`:
- a **sky chip with a palm-tree icon** per holiday on that day, showing how many people opted in;
- a **rose chip with a clock icon** — how many approved, within-allowance, paid leaves;
- an **amber chip with a warning triangle** — how many **unpaid** leaves;
- a second **amber warning chip** — how many leaves that have gone **over the allowance**;
- a **faint white chip with a clock** — how many **pending** requests;
- a **very faint chip** — how many **rejected** ones.

Live example, July 2026: the 10th shows **3** and the 17th shows **1**; June 2026 shows a **1** on
each of the 6th–15th (the ten test holidays). Today gets a ring; the selected day goes sky-blue;
days from the neighbouring months are dimmed and unclickable.

### Controls
1. **legend** — display only.
2. **employee dropdown** — narrows the whole calendar to one person. **Purely client-side; no
   network call.** Options: `All Employees` then **all 31 employee records** (including the
   terminated and candidate ones, which the roster hides): `Amal Vijayakumar` · `Ganesh S N` ·
   `Gokulakrishnan R` · `Kartik Kittad` · `Kingson Thomas` · `Megha M` · `Mock Employee 10` ·
   `Mock Employee 9` · `Mock Employee 3` · `Mock Employee 1` · `Mock Employee 2` ·
   `Mock Employee 4` · `Mock Employee 5` · `Mock Employee 7` · `Mock Employee 8` · `work6` ·
   `Navaneeth B` · `Rohit Vinod` · `Syeda Umme Kulsum` · `Test Demo` · `Chris george` ·
   `Swathikrishna U S` · `test er` · `test` · `Mock Employee S` · `MEGHA M` · `Megha M` ·
   `chris g` · `leya xyz` · `Mock employee U` · `John Doe`
3. **`‹` / `›`** — previous / next month. Each one refetches
   (`?month=7&year=2026` for August, `?month=8&year=2026` for September — **the month index is
   0-based in this API**, unlike Time Tracking's, which is 1-based).
4. **`Today`** — jumps back to the current month.
5. **any day cell** — loads that day into the right-hand panel.

### The day panel
Before you pick anything: a big calendar icon, **"Select Date Coordinate"**, *"Click any day on the
Master Calendar to inspect isolated daily metrics gracefully."*

After picking a day: the date as a heading (e.g. "Tuesday, September 15") and the count line
**"`<n>` active vectors on this explicitly selected coordinate."** Then up to five sections
`[from code]`, in this order:

- **Recognized Holidays** (palm tree) — per holiday: its name, "`<n>` on leave", "`<n>` Employees
  Assigned:" and then each opted-in person by name.
- **Employees on Leave** (calendar) — per person: initials, name, and
  "`<TYPE>` - FULL DAY|HALF DAY", with **"(Exceeded)"** appended in amber when the leave has gone
  past the monthly allowance and **"(Deducted)"** when it is unpaid. A pencil per row reveals the
  same inline **`PTO` `SICK` `UNPAID`** switch.
- **Pending Requests** (clock) — same row shape, plus **`Approve`** / **`Reject`**.
- **Rejected** (cross) — the name struck through at half opacity, "`<TYPE>` — REJECTED".
- **Daily Presences** (user-check) — per person: initials, name, and the **clock-in time**, or the
  word **`REMOTE`** when there is no clock-in time.
- If a day has nothing: a calendar icon and **"No Assigned Metrics"**.

Live check: 15 Sept 2026 → "0 active vectors…" / "No Assigned Metrics".

### The allowance rule — where "Exceeded" comes from
The screen reads a company policy from `GET /api/public/attendance/policy?employeeId&month&year`.
**Live values for this agency:**

```
maxPaidLeavesPerMonth : 2
maxSickLeavesPerMonth : 2
totalHolidaysPerYear  : 13
sickLeaveMedCertDays  : 2
```

Days are counted **within the displayed month**, a half day counting 0.5. A `PTO` leave whose
running total passes `maxPaidLeavesPerMonth`, or a `SICK` leave past `maxSickLeavesPerMonth`, is
flagged **Exceeded** and drawn amber like unpaid leave — the product's way of saying "this one is
going to cost the person money". `UNPAID` is always amber.

### Bulk Manage Mode — built, but there is no way to switch it on
The Master Calendar contains a complete second mode which **cannot be reached**: the only control
that turns it on lives inside a bar that is itself only rendered *while the mode is already on*, so
nothing in the shipped bundle can ever enable it. Recorded because it is finished work
`[from code]`:

- The subtitle changes to *"Select an employee, then click days to select leave records for bulk
  deletion."*, the legend hides, and a rose bar appears with a second employee dropdown
  (**"— Select Employee to Filter —"**, then every person as "Name (CODE)"), a **`Select All`**
  button, a **`Clear`** button and an **`Exit Bulk`** button.
- Day cells become dashed check-boxes; clicking one toggles that person's leave records on that day.
- The right panel becomes **"Bulk Manage Mode"** (shield icon) with the help text *"Select an
  employee from the dropdown, then click calendar days to select leave records. Use the action bar
  to delete all selected."*, the person's initials + name + "Filtered View", and a
  **"Leave records this month"** list where each record is a tickable row reading
  "`<d Mon>` → `<d Mon>`" and "`<TYPE>` · `<STATUS>` · Half|Full".
- A floating bar at the bottom reads "`<n>` leave record(s) selected" with the person's name under
  it, plus **`Clear All`** and a red **`Delete Selected`**.
- **`Delete Selected`** opens a confirm modal: **"Confirm Bulk Deletion"** — *"You are about to
  permanently delete `<n>` leave record(s) for `<name>`."* / *"This action cannot be undone."* with
  **`Cancel`** and **`Delete <n> Record(s)`** → `POST /api/hr/attendance/bulk-delete`
  `{ids, type:"leave"}`.

## 4.3 Company Holidays — `/hr/attendance/holidays`

**What you see on arrival.** Title **"Company Holidays"**, subtitle *"Register recognized public
days and aggregate assigned workers."* Top-right: **`Delete All`** and **`Upload`**. Below, a
two-column layout — on the left an inline **add composer** and then the numbered holiday list; on
the right an assignment panel.

**Data source:** `GET /api/hr/holidays` and `GET /api/hr/employees`.

### The add composer (always visible, not a dialog)
Sitting directly above the list: a text field **"Holiday Name (e.g. Thanksgiving)"** (required), a
**date** input (required), and an **`Add`** button. There is **no type field** — you cannot say
"Public" vs "Company" when adding by hand; the list simply shows "Company Holiday" for anything
without a type. Pressing **`Edit`** on a row loads that row into this same composer and the button
pair becomes **`Cancel`** / **`Update`**.

### The list
14 rows, numbered 1–14. Each row: a **row checkbox**, the number, the **name**, the date as
"Thu, Jan 1", the count **"`<n>` Opt-Ins"**, and an **`Edit`** button. Live:

| # | Name | Date | Opt-Ins |
|---|---|---|---|
| 1 | New Year | Thu, Jan 1 | 8 |
| 2 | Eid Al Fitr | Fri, Mar 20 | 9 |
| 3 | Labor Day | Fri, May 1 | 7 |
| 4 | Test Holiday 1 | Sat, Jun 6 | 1 |
| 5 | Test Holiday 2 | Sun, Jun 7 | 1 |
| 6 | Test Holiday 3 | Mon, Jun 8 | 1 |
| 7 | Test Holiday 4 | Tue, Jun 9 | 1 |
| 8 | Test Holiday 5 | Wed, Jun 10 | 1 |
| 9 | Test Holiday 6 | Thu, Jun 11 | 1 |
| 10 | Test Holiday 7 | Fri, Jun 12 | 1 |
| 11 | Test Holiday 8 | Sat, Jun 13 | 1 |
| 12 | Test Holiday 9 | Sun, Jun 14 | 1 |
| 13 | Test Holiday 10 | Mon, Jun 15 | 1 |
| 14 | National Day | Wed, Dec 2 | 12 |

A holiday record holds `id`, `name`, `type` ("Public Holiday" / null), `date`, `notificationSent`,
and its `employeeOptIns`.

### The right panel — the assignment matrix
Before you pick: **"Select a Holiday"** / *"Click a holiday from the left to configure explicit
employee opt-in mappings."*

After clicking a holiday: heading **"Assignment Matrix: `<name>`"** and the explanatory line
**"Select employees who opted to execute 1 of their 13 available flexible dates on this holiday."**
Then every employee as a tickable row showing the name and the code in brackets — the 24 people the
matrix offers: Amal Vijayakumar [EMP-R35ITN] · Ganesh S N [EMP-RFY3RP] · Gokulakrishnan R
[EMP-MPCGJOYJ] · Kartik Kittad [EMP-W4C4XO] · Kingson Thomas [EMP-JBIX92] · Megha M [EMP-F6RBVN] ·
Mock Employee 10 [EMP1010] · Mock Employee 9 [EMP1009] · Mock Employee 3 [EMP1003] ·
Mock Employee 1 [EMP1001] · Mock Employee 2 [EMP1002] · Mock Employee 4 [EMP1004] ·
Mock Employee 5 [EMP1005] · Mock Employee 7 [EMP1007] · Mock Employee 8 [EMP1008] ·
work6 [EMP1006] · Navaneeth B [EMP-LH6ZU8] · Rohit Vinod [EMP-MP574EOJ] ·
Syeda Umme Kulsum [EMP-A7NYMO] · Test Demo [EMP-DEMO-02] · Chris george [EMP-ROT6A7] ·
Swathikrishna U S [EMP-0CLL5U] · test er [EMP-C5TQ3M] · test [EMP-EJY24V].

Footer button: **`Save <n> Opt-Ins for <name>`** — the label carries the live count.
*(Not pressed.)* This is the same opt-in set the employee's own **Job & Timeline** tab edits
(§3.2), from the other end.

### The two toolbar buttons
- **`Upload`** → a dialog, **"Upload Company Holidays"**. Its whole body is the format spec:
  *"Select an Excel (.xlsx, .xls) or .csv file structured as Name of Holiday | Type
  (Public/national/Govern) | Date (DD/MM/YYYY) | Employee names (comma separated)."* It exposes a
  file input accepting **`.csv,.xls,.xlsx`** and one button, **`Cancel`**. Note the **type
  vocabulary the importer accepts — Public / national / Govern** — which is the only place in the
  product that names holiday types, and it can also assign the opt-ins in the same file.
- **`Delete All`** → a **native browser confirm**: *"Are you sure you want to delete ALL holidays?
  This cannot be undone."* *(Dismissed — all 14 still present.)*

**The row checkboxes have no visible bulk action bar** — ticking rows produced no toolbar in this
build; the only mass operation offered is Delete All.

## 4.4 Mark Absence Override — `/hr/attendance/mark`  *(sidebar sub-item: MARK ATTENDANCE)*

Reached from the sidebar or from **`Request Leave / Log Absence`** on `/hr/attendance`.

**What you see on arrival.** A single narrow card, max ~672 px, centred. Header: a rose pencil
icon, the title **"Mark Absence Override"**, and the subtitle *"Officially submit or force-inject
approved leaves directly into the centralized Agency dashboard securely."* Then a four-step
numbered form.

**This is the only way to record an absence anywhere in the product.** There is no clock-in
button, no device-log import, no biometric or terminal source, and no "mark present" anywhere — see
§4.6.

| Step | Field | Type | Required | Default |
|---|---|---|---|---|
| **1. SELECT EMPLOYEE PROFILE** | a search-as-you-type combobox, placeholder *"Type to search name..."* | text + list | **yes** | empty |
| **2. LEAVE MODALITY** | dropdown | yes | `Annual Leave / PTO` |
| **3. DURATION TYPE** | dropdown | yes | `Single Day Leave` on screen (`MULTIPLE` in the underlying state) |
| — | `FIRST DAY` / `LAST DAY`, or `EXACT DATE` | date(s) | **yes** | today for the single-date field |
| **4. MANDATORY REASON / NOTES** | textarea, placeholder *"Please provide explicit details for HR review..."* | textarea | **yes** | empty |

**Complete dropdown option lists:**
- **LEAVE MODALITY** (3): `Annual Leave / PTO` (value `PTO`) · `Sick Leave` (`SICK`) ·
  `Unpaid Leave` (`UNPAID`)
- **DURATION TYPE** (3): `Single Day Leave` (`SINGLE`) · `Multiple Days` (`MULTIPLE`) ·
  `Half Day Leave` (`HALF`)

**How the dates change with Duration Type** — the one conditional part of the form:
- **Multiple Days** → two fields, **`FIRST DAY`** and **`LAST DAY`**, the second with a minimum of
  the first.
- **Single Day** or **Half Day** → one field labelled **`EXACT DATE`**.

**The employee combobox:** typing filters by name; each option shows the name on the left and the
person's designation as a small mono chip on the right. Empty result: *"No matching profiles
found."* It draws on the full 31-record employee list.

**The warning banner** — an amber block with a warning triangle appears live as you fill the form
in, driven by the policy endpoint. Exact wordings `[from code]`:
- *"Monthly allowance of 2 paid leaves exceeded. `<n>` taken. Salary deductions possible."*
- *"Monthly allowance of 2 sick leaves exceeded. `<n>` taken. Salary deductions possible."*
- *"Medical certificate required for extended sick leave."* — when a sick leave runs longer than
  `sickLeaveMedCertDays` (2). If a quota message is already showing, this is appended as
  *"Medical certificate required."*

A half day counts **0.5** toward the allowance; a multi-day leave counts every inclusive day.

**Validation and result messages** `[from code]`: *"Please select an employee profile."* ·
*"Please provide an explicit reason."* · on success, a green *"Leave/Absence record documented
successfully!"* and the form clears; otherwise the server's own error, or *"Failed to save
record."* / *"An error occurred."*

Button: **`Transmit Secure Request`** (full width, rose) → `POST /api/hr/attendance/mark` with
`{employeeId, type, reason, startDate, endDate, isHalfDay}`. *(Not pressed.)*

**Note on the name "Override":** what this form posts is a *leave record*, and the same endpoint
backs the public portal. Whether it lands APPROVED or PENDING is decided server-side, not by
anything on this screen.

## 4.5 Leave Request Portal — `/attendance` (the "Open Public Portal" target)

**Where:** the **`Open Public Portal`** button in the Attendance header. This page has **no
sidebar, no app shell and no HR chrome** — it is the staff-facing version of the same form, meant
to be handed to people who don't use the OS.

Title **"Leave Request Portal"**, subtitle *"Officially submit your leave requests directly into
the centralized Agency dashboard securely."* The form is **field-for-field identical to §4.4**
(same four numbered steps, same three-option Modality list, same three-option Duration list, same
conditional dates, same required reason, same **`Transmit Secure Request`** button) with two
wording differences: step 1 is **"1. FIND YOUR IDENTITY"** and its placeholder is *"Type to search
your name..."*. It reads its people from a separate public endpoint,
`GET /api/public/employees`.

## 4.6 Two things Attendance does NOT have — worth stating plainly

- **No clock-in.** The data model has a `clockIn` field and the UI can render "Clocked In: <time>"
  and "REMOTE", but nothing in the product writes an attendance row: the `attendance` array comes
  back **empty for every month and every employee**, and every employee's *Attendance Record (Last
  10 Days)* says "No attendance logged yet." Nobody's presence is being recorded.
- **No correction workflow for a day.** You cannot edit or correct a day's attendance, because
  there is no day record to correct. The only editing available on an existing record is
  **changing a leave's type** (the pencil → PTO / SICK / UNPAID) or **deleting** it. There is no
  regularisation request, no manager amendment, no audit of who changed what beyond the free-text
  Activity Log.

---

# 5. Time Tracking — `/hr/time-tracking`

**Where:** sidebar → **HR** → **Time Tracking**. No tabs, no sub-pages.

**What you see on arrival.** Title **"Time Tracking"** with a sky clock icon, subtitle *"Log and
track working hours across projects and tasks."*, and top-right a **person dropdown** (defaults to
whoever is signed in). Second row: **"FILTERS:"** and three dropdowns — Category, Client, Project.
The body is a 1fr / 340 px split: on the left a **month calendar** with an hours figure in every
day cell and a running total column, and under it an **"Entries for <date>"** list; on the right,
stacked, the **log-time form**, a **SUMMARY** card and an **Activity Log**.

**Data source:** `GET /api/hr/time-tracking?year=<yyyy>&month=<1-12>&userId=<id>` (**month is
1-based here** — the opposite of the Master Calendar), plus a second call with
`&activities=true&activityDate=<yyyy-mm-dd>` for the activity list, and `GET /api/settings/users`,
`GET /api/hr/portal`, `GET /api/crm/board`, `GET /api/tasks?source=marketing`,
`GET /api/projects?status=ACTIVE`, `GET /api/hr/departments` for the pickers.

## 5.1 What the unit of work actually is

One entry = **hours against a category, optionally a project (and through it a client), optionally
a task, on one date, for one person.** The record is:

```
{ id, date, hours, category, project, client, task, notes, employeeId }
```

Live example: `{date: 2026-09-01, hours: 23, category: "Tech", project: "testt222",
client: "testt555", task: "Project Management", notes: null}`.

Note what is **not** there: **no billable / non-billable flag, no rate, no start/stop timestamps,
no approval status and no link to an invoice.** The words "billable", "utilisation" and "timer"
appear **nowhere** in this screen's shipped code. Hours are typed in, never clocked — **there is no
timer control on this screen to start**, so there was nothing to leave running.

## 5.2 Controls, in the order they appear

1. **person dropdown** (top right) — whose timesheet you are looking at. Changing it refetches.
   **Complete list (27 Nexeor user accounts):** `xyz` · `abcd` · `Mathangi Chandu` · `ritika` ·
   `Antra Agrawal` · `Sandra KK` · `Deep Sheth` · `akhila kr` · `Dhrumil Gadaria` · `work6` ·
   `Test Demo` · `Emaad Sultan` · `Megha M` · `Kingson Thomas` · `Admin` · `Amal Vijayakumar` ·
   `Ganesh S N` · `Syeda Umme Kulsum` · `Kevin Norbert` · `Info Nexeor` · `Navaneeth B` ·
   `Gokulakrishnan R` · `Kartik Kittad` · `Swathikrishna U S` · `Rayan Patel` · `Chris george` ·
   `Rohit Vinod`
2. **`All Categories` filter** — 7 options: `All Categories` · `Marketing` · `Tech / Web Dev` ·
   `Sales` · `Accounts / Client Management` · `HR` · `Miscellaneous`
3. **`All Clients` filter** — built from the entries actually on screen. With the demo user it is
   just `All Clients`; on a populated timesheet: `All Clients` · `testt555` · `WEBSITE`
4. **`All Projects` filter** — likewise: `All Projects`, or on a populated timesheet
   `All Projects` · `testt222` · `General` · `Checkpoint 12 INR Test` ·
   `Stave Corp IN_PROGRESS - 8` · `Miscellaneous` · `Italica`
5. **`‹` / `›`** around the month name — previous / next month (rolls the year at the boundaries).
6. **`Quick entry mode`** — a switch (§5.4).
7. a **`MONTH <total>`** chip beside the switch, and — only when there is any — a second amber
   **`Mktg <total>`** chip.
8. **any day cell** — selects that day for the entry list and the form.
9. the **log-time form** (§5.3).
10. a **bin** on each entry row — native confirm **"Delete this time entry?"** then
    `DELETE /api/hr/time-tracking?id=<id>`. *(Not exercised.)*

## 5.3 The log-time form (right column) — every field

Header: the selected date as a heading (e.g. "Monday, September 7") and under it either
**"`<n>`H LOGGED"** or **"NO ENTRIES YET"**.

| Field | Type | Required | Default / notes |
|---|---|---|---|
| `CATEGORY*` | dropdown | **yes** | **auto-matched to the selected person's department** |
| `PROJECT` / `LEAD / PROJECT` / `CLIENT / PROJECT` | a custom picker button | no | *"Select a project..."* — hidden entirely for HR and Miscellaneous |
| `TASK` | dropdown | no | *"Select task (optional)..."* — only appears for Tech, Marketing and HR |
| `HOURS*` | number, **min 0, max 24, step 0.25** | **yes** | empty, placeholder "Enter hours" |
| `NOTES` | textarea | no | empty, placeholder "Enter notes" |
| — | **`Log Time`** button (sky, plus icon) | | posts the entry |

**`CATEGORY` — the complete list, with the departments each one auto-matches** `[from code]`:

| Label on screen | Stored value | Auto-selected for departments named |
|---|---|---|
| `Marketing` | `Marketing` | marketing |
| `Tech / Web Dev` | `Tech` | tech, engineering, web dev, development, it |
| `Sales` | `Sales` | sales |
| `Accounts / Client Management` | `Accounts` | accounts, client management, accounting, finance |
| `HR` | `HR` | hr, human resources |
| `Miscellaneous` | `Miscellaneous` | — |

**`TASK` — the complete list per category** `[from code]`, confirmed on screen for Tech:

- **Tech / Web Dev** (10): `Development` · `Design` · `Project Management` · `Code Review` ·
  `QA & Testing` · `Bug Fix` · `Documentation` · `Planning` · `Research` · `Other`
- **Marketing** (6): `Content Creation` · `Campaign Execution` · `Client Communication` ·
  `Strategy & Planning` · `Reporting` · `Other`
- **HR** (3): `Recruitment` · `Interviews` · `Internal Tasks`
- **Sales · Accounts / Client Management · Miscellaneous** — **no task list at all**; the TASK
  field is not rendered for these three.

**The project picker** is a button that drops a searchable panel, not a `<select>`. Its **label and
placeholder change with the category** — `Project` / *"Select a project..."* normally,
**`Lead / Project`** / *"Select a lead..."* for Sales, **`Client / Project`** for Accounts. What it
offers also changes: for most categories it lists projects whose own category matches; for
**Accounts** it pools projects categorised Marketing, Tech, Won or Accounts and groups them under
category sub-headings. Each option reads "`<Project>` — `<Client>`" when a client is attached, with
a tick on the current choice. Empty: *"No projects for `<Category>`"*.

**HR and Miscellaneous are "no-project" categories** `[from code]`: for those two the project
picker disappears and the entry is filed with the **category name as the project** and no client.
For everything else, a blank project falls back to the literal project name **`General`**.

**`Log Time`** sends `POST /api/hr/time-tracking` with
`{date, hours, project, task, notes, category, client, userId}`. *(Not pressed.)*

## 5.4 The month grid, and Quick entry mode

**Columns:** `MON TUE WED THU FRI SAT SUN` and then an eighth column, **`TOT`** — that week's
total. Each **day cell** shows the day number and, in emerald, that day's total formatted **"23h"**
/ **"4h 24m"** / **"48m"**; a second, smaller amber figure appears underneath for time that came
from the **marketing task board** rather than being typed here. Days with anything logged get an
emerald tint; the weekend columns are slightly darker; today is ringed; the selected day is sky.

Live grid for **Gokulakrishnan R, September 2026** (the only populated timesheet in the data):

| | MON | TUE | WED | THU | FRI | SAT | SUN | TOT |
|---|---|---|---|---|---|---|---|---|
| | | 1 · 23h | 2 · 22h | 3 · 4h 24m | 4 · 5481h | 5 · 23455h | 6 · 48m | 28986h 12m |
| | 7 · 3h 35m | 8 · 6m | 9 · 42m | 10 · 36m | 11 | 12 | 13 | 4h 59m |
| | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 0 |
| | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 0 |
| | 28 | 29 | 30 | | | | | 0 |

**`Quick entry mode`** (the switch above the grid) — turns every day cell into a one-tap entry box:
each cell grows a dashed sky border and a faint **`+`**. Clicking a cell opens an inline number
field over it (step 0.25, minimum 0, placeholder "0h", auto-focused); **Enter** saves, **Escape**
or clicking away cancels. What it saves is a bare entry with **project `General` and task
`General`** and nothing else `[from code]` — which is why an entry row with those two values gets a
green tick icon instead of initials. *(Switch flipped to look, no cell committed.)*

## 5.5 "Entries for <date>" — the day list

Heading **"Entries for `<Weekday, Month d>`"**. Empty: *"No time entries for this day."*
Each row: a 36 px icon (a **green tick** for a quick entry, otherwise sky initials of the
category), then the **duration**, the **project**, a **category chip**, the **task**, and after a
`•` the **client**. Category chip colours: Marketing amber · Tech sky · Sales purple · Accounts
cyan · HR rose · Miscellaneous grey. A **bin** appears on hover.

Live, 7 September 2026: `59m — Stave Corp IN_PROGRESS - 8 — Project Management` ·
`6m — Stave Corp IN_PROGRESS - 8 — Project Management` ·
`2h 30m — Italica — Tech — Development • WEBSITE`.
Live, 1 September 2026: `23h — testt222 — Tech — Project Management • testt555`.

## 5.6 SUMMARY and the two other right-column cards

**SUMMARY** — four tiles, two by two. **Exactly how each is worked out** `[from code]`:

| Tile | Label | Formula | Live (Gokulakrishnan, Sept 2026) |
|---|---|---|---|
| white | `MONTH HOURS` | sum of the hours on every entry that passes the filters | **28991h 11m** |
| sky | `ENTRIES` | how many entries pass the filters | **20** |
| emerald | `AVG/DAY` | MONTH HOURS ÷ **number of distinct dates that have an entry** (not calendar days, not working days) | **2899h 7m** |
| purple | `DAYS LOGGED` | count of distinct dates with an entry | **10** |

**MARKETING TASKS** — an amber card, subtitle **"Time from task board transitions"**, one figure
and the label **`THIS MONTH`**. Live: **0h**. This is the product's only automatic time capture:
hours inferred from cards moving on the Marketing task board, kept separate from typed entries and
shown as the small amber figure in each day cell.

**Activity Log** — indigo icon and a counter reading "`<d Mon>` • `<n>` entries". Rows read
**"Logged 2.5h on Italica — 7 Sept 2026"** with **"by Gokulakrishnan R • 02:47 PM"** underneath.
Empty: *"No activity on `<d Mon>`"*.

**There is no approval step in Time Tracking.** No submit-for-approval, no timesheet lock, no
manager sign-off, no period close — an entry exists the moment it is logged and can be deleted by
whoever is looking at it.

## 5.7 Realtime/auto

Nothing moves on its own on any of the four screens. Every panel fetches when it mounts or when you
change the month / person / filter, and never polls.

---

# How these four hang together

**A person existing → their day being recorded → their hours reaching a project.**

1. **A person starts as one of two things.** Either **`Onboard`** on the Directory sends a
   candidate a welcome link (they appear on the roster with a red pulsing `ONBOARDING` badge and
   have no employee record yet), or **`Add Employee`** creates an "offline profile" straight away
   — a real employee row that nobody can log in as, marked `UNLINKED PROFILE`. An unlinked profile
   is joined to a real login later, from the detail screen, with **`Invite to OS`** (send an
   invite, assign permission groups) or **`Connect manually`** (attach an existing Nexeor account).
   `Bulk Edit` and the never-wired `Bulk Import Roster` are the mass versions of the same step.

2. **Their record fills up on the detail screen.** Personal and bank details, department and
   position (both maintained in the Organization Manager), reporting manager, salary and currency,
   the 7-item onboarding checklist, documents in the Vault, and — from **Job & Timeline** — which
   of the year's **13 optional holidays** they have chosen to spend. Two amber badges chase the
   gaps: **PROFILE INCOMPLETE** until every contact and job field is present,
   **ONBOARDING INCOMPLETE** until all 7 tasks are ticked.

3. **A day only gets recorded when somebody is AWAY.** This is the pivot of the whole design.
   Nobody clocks in; there is no attendance state per day. A day becomes a record only through a
   **leave**, raised either by HR on **Mark Absence Override** or by the person themselves on the
   **public Leave Request Portal**. It is one of three kinds — PTO, Sick, Unpaid — for a single
   day, a range, or a half day, and it always needs a reason. As you fill the form the company
   policy is checked live (2 paid and 2 sick days a month; a sick spell over 2 days needs a
   medical certificate) and warns that anything beyond that may cost the person money.

4. **One person approves it, in one click.** The request lands in **Pending Requests** — on
   `/hr/attendance` and again in the Master Calendar's day panel — where **Approve** or **Reject**
   settles it. There is no second approver and no comment. Every step writes a line into the
   **Activity Log** ("Submitted leave: PTO from 10 Jul to 10 Jul", "Leave request marked as
   APPROVED", with who and when). Approved leaves, pending ones, rejected ones and the company
   holidays then all sit on the **Master Calendar**, colour-coded, with anything over the monthly
   allowance turned amber and labelled *(Exceeded)* — the calendar's way of pointing at the days
   payroll will need to look at. **Company Holidays** is the other half: the calendar of shared
   days off, and the matrix of who opted into each one.

5. **Hours are a completely separate story from attendance.** **Time Tracking** is where work gets
   measured, and it never touches leave or presence. A person picks a **category** (their
   department chooses it for them), then a **project** — the same projects and clients the CRM and
   Web Projects modules own, which is the join to the rest of the agency — then a **task**, then
   types the hours. HR and Miscellaneous work needs no project. A separate amber figure arrives on
   its own from cards moving on the Marketing task board.

6. **And here the chain stops.** Hours reach a project and a client by name, and the SUMMARY card
   totals them per person per month — but **the entry carries no rate, no billable flag and no
   invoice link, and nothing approves or locks a timesheet.** So Time Tracking tells the agency
   *how much effort went where*; turning that into money is not something these four screens do.
   The only money that flows out of this group is the **base salary** on the employee record, which
   the **Payroll Ledger** tab reads (and shows past payruns against) — and the leave days the
   calendar has flagged as exceeded or unpaid, which are the deductions payroll is expected to
   apply.

---

# Odd things I noticed

- **`Run Payroll Report`** on the HR Dashboard has no click handler at all — the most prominent
  button on the screen does nothing.
- The Action Queue says **"0 PENDING / No pending approvals!"** while the very same API response
  carries **7 pending expense claims**. The empty-state check only looks at pending *leaves*, so
  the expense row that would have shown them is never reached.
- **`Prev`** and **`Next`** on *Upcoming Leaves & Holidays* have no handlers, and the panel asks the
  API for no month — so that panel is permanently empty ("No activity recorded for this period.")
  even in months that clearly have leave.
- **`Assign Asset`** on the employee Assets tab has no handler. Nothing in the product can assign
  an asset, yet the tab, the empty state and the row layout all exist.
- The **permanent delete-employee** control is an unlabelled red bin icon in the detail header, one
  button away from `Edit Profile`, guarded only by a plain browser confirm.
- **Bulk Manage Mode** (Master Calendar) and **Bulk Import Roster** (Directory) are both complete,
  including their confirm dialogs — and neither has any control that can switch it on.
- The two calendars disagree about month numbering: `/api/hr/attendance` takes a **0-based** month,
  `/api/hr/time-tracking` a **1-based** one.
- Vault documents are all filed as category **`OTHER`**, and the Verified/Pending chip has no
  control that can change it.
- Copy in this area drifts between plain and oddly technical — "active vectors on this explicitly
  selected coordinate", "Select Date Coordinate", "force-inject approved leaves", "Rapidly
  orchestrate employee data updates", "Transmit Secure Request".
- The Time Tracking demo data holds entries of **23,455 hours in one day**, so the HOURS box's
  `max="24"` is not enforced by whatever wrote those rows.
- `birthDate` is null for all 31 employees, so the dashboard's birthday milestones can never fire;
  `probationEndDate` is null for all of them, so the probation milestones can't either.
- On the Time Tracking Activity Log, the counter names the selected day ("1 Sept • 10 entries")
  while the rows listed underneath span the whole month.
- The Directory's Manage-Depts dialog counts Engineering at **12 Members** while the roster group
  above it reads **11** — the dialog counts everyone, the roster only the active.

---

# In human language — every feature in this area, as points

- **The HR home screen** — one page that answers "how many people do we have, is anything waiting
  for me, and is anything coming up". Click HR, then Dashboard. It is the first thing an HR person
  opens in the morning.
- **Headcount at a glance** — a big number for how many people are currently employed, and next to
  it how many are off today. Same screen, top-left card.
- **A queue of things waiting for a yes or no** — leave requests, and a reminder when there are
  expense claims sitting in the money section. Same screen, top-right card. It saves HR from
  hunting through screens for anything that needs a decision.
- **Approve or reject from a small pop-up** — click Review on a waiting request and a card shows
  who, what kind, which dates and why, with a receipt link for an expense. Two buttons: approve or
  reject. The point is deciding without leaving the page.
- **A reminder of birthdays and probation end-dates in the next month** — bottom card of the same
  screen. It is there so nobody's probation quietly runs past its date.
- **The staff directory** — every person in the company on one page, grouped by department with a
  count on each group. Click HR, then Directory.
- **Two ways to look at the directory** — pretty cards, or a plain table with salary and status
  columns. The two small icons to the right of the Filters button switch between them. Cards are
  nicer to browse, the table is faster to compare.
- **Warning badges that show whose file is unfinished** — a person's card shouts "profile
  incomplete" if any of their contact details, job details or joining date are missing, "onboarding
  incomplete" if their new-starter checklist isn't finished, "unlinked profile" if they have no
  login yet, "intern", or "promotion in progress". Right on their card in the directory. It means
  nobody has to open 31 files to find the gaps.
- **Search the directory** — one box, searches names, job titles and departments together.
- **Filter the directory four ways** — the Filters button opens a panel where you can narrow by
  department (and then by the exact job title inside it), set a maximum monthly salary on a slider,
  give a from/to range for when people joined, and tick which statuses to include (currently
  employed, left the company, or still being onboarded — only "currently employed" is ticked by
  default, which is why the page shows 23 of the 31 people on file).
- **A quick peek at a person without leaving the list** — clicking anyone pops up a small card with
  their department, job title, level, joining date, work email, phone and address, and a button to
  open their full file. Press Escape or click the background to dismiss it.
- **Each person's full file** — one screen per employee, reached from that peek card. This is the
  heart of the whole HR area.
- **A person's contact and bank details** — phone, work email, personal email, address, who to call
  in an emergency, and their bank account or UPI. First tab of their file.
- **A bank form that changes with the currency** — pick dirhams and it asks for IBAN and SWIFT;
  pick rupees and it asks for account number, IFSC code and UPI ID instead. So nobody is asked for
  a field that doesn't exist in their country.
- **A new-starter checklist, the same seven steps for everybody** — create their work email, send
  the handbook, add them to Slack, send the app invite, get the NDA signed, collect bank details,
  confirm they've read the code of conduct. Second tab of their file, with a percentage at the top.
  Tapping a line ticks it immediately — there is no save button and no undo.
- **Their employment timeline** — joining date, when probation ends, and a space for the last ten
  days of attendance. Third tab. The attendance part is empty for everybody, because nothing in
  this product records attendance.
- **Letting a person choose their own holidays** — the company publishes a list of holidays and
  each person picks which of their 13 allowed flexible days to spend on which. Third tab of their
  file, with a counter like "4 / 13 selected". This is how a company with staff of different faiths
  gives everyone the same number of days but not the same days.
- **A document safe per person** — upload their ID, contracts and anything else; each file shows as
  verified or pending. Fourth tab. Files can be opened but not renamed, re-filed or removed, and
  everything is filed under "other".
- **Their pay and pay history** — their monthly base salary (with the dirham equivalent shown
  underneath if they're paid in another currency), where it gets paid, and a list of past payroll
  runs marked processed. Fifth tab.
- **A place to record their laptop and software seats** — sixth tab. The screen and the layout
  exist, but the "Assign Asset" button does nothing, so nothing can actually be recorded here yet.
- **Their performance reviews** — seventh tab: a manager-scored review out of 5, every six months.
  Nobody has one yet.
- **Editing a person** — one form covering name, department, job title, reporting manager, level,
  salary, currency, joining date, whether they're an intern, all their contact details and their
  bank details. Reached from three different buttons on their file, all of which open the same form.
- **Ending someone's employment properly** — the Offboard button asks for their last working day
  and explains that their history stays (pay, assets, documents) while their active standing is
  switched off, and reminds you to put the settlement papers in their document safe. It won't let
  you confirm without a date.
- **Deleting a person for good** — a small red bin icon on their file wipes the record entirely,
  after one browser warning. Easy to hit by accident; it sits right next to Edit Profile.
- **Turning an intern into a permanent employee** — a green button on an intern's file only. It
  asks for the new joining date, the new salary and their manager, and issues a fresh offer letter
  by email. If their paperwork is thin it says so and offers to send the full onboarding link
  instead.
- **Giving an existing record a login** — for people added as "offline profiles", one button emails
  them an invite and lets you tick which permission groups they get (System Admin, QA team,
  multiple member test team, Developer Team, Marketing Team, HR Department, Sales Team); another
  button attaches them to an existing account instead. And a third removes the login again, which
  takes away their access.
- **Adding one person by hand** — a form for someone who won't be logging in yet: name, department,
  job title, manager, level, salary, joining date, intern or not, contact details and bank details.
  The Add Employee button on the directory.
- **Inviting a new hire to onboard themselves** — the Onboard button emails a candidate a welcome
  link. You give their name, personal email, department, job title, optional manager, pay,
  expected start date and probation length in months. They then appear on the directory with an
  "onboarding" flag until their record is complete.
- **Editing everybody at once, like a spreadsheet** — the Bulk Edit button opens a real grid: one
  row per person, thirteen editable columns (names, department, job title, level, currency and
  salary, phone, both emails, bank, joining date, intern tick, internship end date), a button to
  add a blank row, and one button that saves the whole sheet. Faster than opening 31 files. There
  is no way to delete a row here.
- **Bank details inside the spreadsheet** — a small building icon in each row opens that person's
  bank fields, again matched to their currency. It fills the row in; the actual saving still
  happens with the sheet's own save button.
- **Managing departments and job titles** — one dialog with two tabs. Create a department or a job
  title, give it an icon picked from a searchable library, and see how many people are in each.
  Reached from Manage Depts on the directory. This is what feeds every department and job-title
  dropdown in the product.
- **Importing a whole roster from a spreadsheet** — a finished two-step importer that takes a
  pasted table or a CSV/TSV file, previews and lets you fix every row, then creates everybody at
  once. It even hands you a ready-made instruction to paste into ChatGPT or Claude so the AI
  produces a file in exactly the right shape. **There is currently no button anywhere that opens
  it** — the feature is built and unreachable.
- **The leave and absence home screen** — a list of upcoming leaves and holidays, the queue of
  requests waiting for a decision, and a running history of everything anyone did. Click HR, then
  Attendance.
- **Approving or rejecting a leave request** — two buttons on the waiting request. One person,
  one click, no second signature, no comment box.
- **Changing what kind of leave something was** — a small pencil on any leave row swaps it between
  annual, sick and unpaid. Useful when somebody files the wrong kind, and it is the only way to
  correct an existing record.
- **A history of everything that happened to leave** — who submitted what, who approved what, and
  exactly when, in plain English, five at a time with a "load more" button. Currently 43 entries.
  It is the audit trail if anyone ever disputes a day.
- **The company-wide leave calendar** — a month grid where every holiday, every approved leave,
  every request still waiting and every rejection shows up as a small coloured tag, so you can see
  at a glance who is away when. Click Attendance, then Master Calendar.
- **Four colours, and that's the whole key** — red means someone is on leave, white means a request
  nobody has answered, purple-blue means a company holiday, amber means unpaid leave *or* leave
  that has gone past the monthly allowance. There is deliberately no "present", "absent",
  "half day" or "weekly off" colour, because this product does not record a state for each day —
  it only records the things that happen.
- **Clicking a day to see exactly who and why** — the panel on the right breaks that day into
  recognised holidays (and who opted into each), who is on leave and whether it's a full or half
  day, what is still awaiting a decision, what was rejected, and who clocked in. You can approve,
  reject or re-classify from right there.
- **A warning when someone goes over their allowance** — the company allows 2 paid and 2 sick days
  a month; anything past that is marked "(Exceeded)" in amber, and unpaid leave is marked
  "(Deducted)". This is the screen that tells payroll which days will cost the person money.
- **Filtering the calendar to one person** — a dropdown above the grid. Instant, no waiting.
- **Moving month to month** — arrows either side of the month name, and a Today button to come
  back.
- **Deleting a pile of someone's leave records in one go** — pick a person, click the days, and one
  red button removes them all after a clear "this cannot be undone" warning. Complete and
  well-built — but **there is no button anywhere that turns this mode on**.
- **The company holiday calendar** — the list of the year's shared days off with the date and how
  many people opted into each. Click Attendance, then Company Holidays. Currently 14 of them.
- **Adding or editing a holiday** — a name and a date typed straight above the list. Editing swaps
  the Add button for Update and Cancel.
- **Deciding who takes which holiday** — clicking a holiday shows every employee with a tick box,
  so you can record who is spending one of their 13 flexible days on it. The same choice the person
  makes on their own file, from the company's side.
- **Loading a year of holidays from a spreadsheet** — an upload that takes an Excel or CSV file
  with the holiday name, its type, the date, and even the list of people who opted in, all in one
  file. Saves typing the year in by hand.
- **Wiping the holiday calendar** — one button clears all of them, after a warning.
- **Recording that somebody was away** — the only way in this whole product to record an absence.
  You search for the person, pick annual, sick or unpaid, pick a single day, a range or a half day,
  give a compulsory reason, and send. Click Attendance, then Mark Attendance.
- **A live warning while you fill that form in** — as soon as it can tell, it says things like
  "monthly allowance of 2 paid leaves exceeded, 2 taken, salary deductions possible", or that a
  long sick leave needs a medical certificate. The warning arrives before you submit, not after.
- **A staff-facing leave request page with no login and no menus** — the same form, worded for the
  person asking rather than for HR, on its own plain page you can send anyone. Reached from the
  "Open Public Portal" button. It is how a company gets leave requests from people who never open
  the system.
- **The timesheet** — a month calendar per person showing hours logged on each day, a total for
  each week, and the entries for whichever day you click. Click HR, then Time Tracking.
- **Logging hours against real work** — pick a kind of work, then the project (which brings its
  client with it), then the specific task, type the hours and add a note. The kind of work is
  pre-chosen based on the person's department, and the task list changes to match — development,
  design, code review and so on for tech; content, campaigns, client communication and reporting
  for marketing; recruitment and interviews for HR. Internal and miscellaneous work needs no
  project at all.
- **Logging hours in one tap** — a "quick entry mode" switch turns every day of the month into a
  box you click and type a number into, then press Enter. For catching up a whole week of general
  work without filling the form five times.
- **Seeing whose timesheet you're looking at** — a dropdown at the top right switches between all
  27 people, so a manager can review anyone's month.
- **Narrowing a month down** — three filters above the calendar: kind of work, client, and project.
  The client and project lists are built from what that person actually logged.
- **A monthly summary per person** — total hours, number of entries, average per day (worked out
  across the days they actually logged, not calendar days), and how many days they logged at all.
- **Time that counts itself** — hours picked up automatically from marketing cards moving across
  the task board, shown separately in amber so it never gets confused with typed hours.
- **A record of who logged what and when** — "Logged 2.5h on Italica, 7 Sept, by
  Gokulakrishnan R, 02:47 PM". Bottom of the timesheet.
- **Deleting a time entry** — a small bin on any entry, with a one-line confirmation.
- **What the timesheet does NOT do** — there is no start/stop timer, nothing marks an hour as
  billable or not, there are no rates, nothing works out a utilisation percentage, nobody has to
  submit or approve a timesheet, and no month can be locked. So the hours tell you where effort
  went; turning them into an invoice is not something these screens do.
