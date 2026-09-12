# HRMex 10.0.0.0 — Attendance, part 1: the nine day-to-day screens

**Terminal H16 · captured live 2026-09-07** on `https://demo.hrmexweb.in`, signed in as `Superadmin`
(Super Admin). **Look-only:** nothing was saved, submitted, generated, removed, recalculated,
approved, imported or printed-to-a-device. Filters were changed and `[Show]`/`[Filter]` pressed
(those only read), dialogs were opened and closed with **Escape/Close**, and the two view switches
on the Attendance Voucher were flipped on and **flipped back off**.

**Scope:** Device Logs · Late Early Entry · Logs Approval · Holiday · OD Entry · COFF ·
**Attendace Voucher** *(their spelling)* · Attendance Checklist · **Shift Shedule** *(their spelling)*.
Leave screens and Attendance Calculation belong to H17 and were not touched.

**Screens opened live: 9 of 9**, plus three screens the 2026-08-16 capture never recorded at all —
the **Late Early "New Entry" page**, the **Shift Schedule Excel-Import page**, and the
**Report Viewer popup** the Voucher's Print opens.

Legend: `{a | b}` = the complete option list · `[btn]` = a button · **⚠️** = differs from the
2026-08-16 capture (every ⚠️ is repeated in *Corrections* near the end) · *(markup)* = read from the
page's own markup rather than triggered, and why is always said.

**How you get to any of these:** left sidebar → **Attendance** → the item. Every screen opens as a
tab inside the app shell. Each address needs its `?MenuId=` — the sidebar always supplies it:
Device Logs `52` · Late Early Entry `53` · Logs Approval `54` · Holiday `55` · OD Entry `56` ·
COFF `57` · Attendace Voucher `58` · Shift Shedule `59` · Attendance Checklist `90`.

**One thing that repeats on nearly every screen and is worth reading once:** the standard filter
bar. Wherever you see it below, it is these six controls with these exact option lists —
`Employee Name {All | EMP001:Test 1 … EMP173:Test 173}` (174 entries; the demo's people are all
named "Test N") · `Category {All | Category 1 … Category 7}` · `Company {All | Company 1 | Company 2}` ·
`Division {All | Division 1 … Division 9}` · `Department {All | Default | Marketing | Dispatch |
Production | Accounts | Loading | STORE | Maintenance | Consumables Store | HR | House Keeping |
RM Store | QC | Purchase | Packing | Safety | RM & Con Store | Production Pardi | QC PARDI | Admin |
IT}` (22) · `Location {All | Location 1 … Location 5}` (only on the Checklist).

---

## 1. Device Logs — `/Attendance/Device_Logs.aspx?MenuId=52`

**Where:** Attendance → Device Logs. The raw punch feed — every tap on a machine, before any
attendance meaning is put on it.

**What you see on arrival:** a breadcrumb `Home / Device Logs` top-right; one white card titled
**Device Logs**; inside it a two-row filter bar; below the filter bar a single blue
**[Add Manual Punch]** button; and **below that, nothing at all** until you press Show.

**Controls, in the order they appear**

| Control | What it is | Default |
|---|---|---|
| `Date From` | date box with a calendar icon, `dd-MM-yyyy` | today (`07-09-2026`) |
| `Date To` | date box with a calendar icon | today |
| `Employee Name` | the standard 174-entry picker | `All` |
| **`Categorgy`** *(their typo, on screen)* | 8 options | `All` |
| `Company` | 3 options | `All` |
| `Division` | 10 options | `All` |
| `Department` | 22 options | `All` |
| **[Show]** | blue; loads the grid. Nothing loads until you press it | — |
| `Search` | a free-text box beside Show, searches the loaded rows | empty |
| **[Add Manual Punch]** | blue; opens the *Manual Log Entry* dialog | — |

**The grid** (appears only after Show, and only when the range has punches):

`Device Code | Employee Name | Log Datetime | Device | (source) | (blank) | Remark | (blank) | (blank)`

- The four blue headers `Device Code`, `Employee Name`, `Log Datetime`, `Device`, `Remark` are
  clickable sort links.
- The unnamed column after `Device` carries the punch's **source**, showing `Location` on every row.
- **Row actions:** blue **[Edit]** and red **[Delete]** at the right of every row.
- **No paging and no page-size box** — every matching row is drawn at once. 01–03 Jan 2026 alone
  produced **645 rows** on one page.
- Live sample: `GPPI5013 | Test 133 | 01-01-2026 05:30 | ME(OUT) | Location | | MP` ·
  `GPPI0020 | Test 15 | 01-01-2026 06:00 | Sarigam | Location | |`
- **`Device` shows the real machine name** — `Sarigam` for device punches, and `ME` / `ME(IN)` /
  `ME(OUT)` for punches a person typed in by hand. `MP` in Remark = miss-punch.

**Dialog — `Manual Log Entry`** (opened by **[Add Manual Punch]**)

| Field | Type | Default | Options |
|---|---|---|---|
| `Device Code` | dropdown | `GPPI0001` | **173 device codes** — `GPPI0001…GPPI0007`, `GPPI0010…`, the `GPPI5001…GPPI5025` series, plus two hand-typed oddities `dr` and `DR MARKETING` and one blank entry |
| `Employee Name` | dropdown | `EMP001:Test 1` | the 173 people |
| **`Log DateTime`** ⚠️ | date-and-time box | empty | — |
| `Device Name` | dropdown | `ME` | `{ME \| ME(IN) \| ME(OUT)}` |
| `Remark` | text, placeholder *"Enter Remark Here"* | empty | — |
| Buttons | | | `[×] [Close] [Save]` |

**Empty state:** genuinely empty. With no punches in the range the card ends after
[Add Manual Punch] — **no table, no headers, and no "no records" message.**

**Realtime/auto:** none. The screen only moves when you press Show.

---

## 2. Late Early Entry — `/Attendance/LateEarlyEntry.aspx?MenuId=53`

**Where:** Attendance → Late Early Entry. Where a *reason* is attached to people who came late or
left early — so the lateness is on record with an explanation rather than as a bare number.

**What you see on arrival:** breadcrumb `Home / Late Early List`; a card titled **Late Early Entry**
holding `Date From` · `Date To` · **[Show]** · `Search` · **[New Entry]**, and nothing below it.

**Controls**

| Control | Default | Notes |
|---|---|---|
| `Date From` | **first of this month** (`01-09-2026`) | the only screen in this group that defaults to a month rather than today |
| `Date To` | **last of this month** (`30-09-2026`) | |
| **[Show]** | — | loads the list |
| `Search` | empty | searches the loaded list |
| **[New Entry]** | — | **replaces the whole page with the entry form below** — it is not a pop-up ⚠️ |

**Empty state:** nothing at all below the filter row — not even column headers.

**A dialog that exists but never opened for me:** the markup carries a modal titled
**`View Entry`** with a `Search` box and `[Close]`. Nothing on the empty list opened it; it is
presumably the per-row "look at this entry" pop-up. *(markup — the demo had no rows to click.)*

### The `New Entry` page — the real feature ⚠️ (never recorded before)

Pressing **[New Entry]** swaps the list for a full-page form headed **Late Early Entry**. It applies
**one reason to many people in one go**:

| Field | Type | Default | Complete option list |
|---|---|---|---|
| `Date` | date box | today | — |
| **`Shift`** | dropdown | `General` | **`{General \| NS \| Day Shift \| Night Shift \| General 1 \| General Shift2 \| General Shift HOD \| GS Shift NIGHT \| General Night \| NORMAL GS SHIFT \| Production General Shift HOD}`** — the 11 shifts by their **long names** |
| `Reason` | dropdown | `Bus` | **`{Bus \| Election \| SHL}`** — these come from the Late/Early Reason master |
| `Late/Early` | dropdown | `Late` | `{Late \| Early}` |
| `Late/Early By(in Mins)` | text | empty | the number of minutes |
| `Category` · `Company` · `Division` · `Department` | the standard pickers | all `All` | — |
| **[Show]** | button | — | fills the people list below with everyone matching those four filters |
| `Search` | text | empty | searches the people list |
| `Remark` | text | empty | one remark for the whole batch |
| **The people list** | grid | — | `☐ (with a tick-all box in the header) \| EmpCode \| EmployeeName \| Company Name` — one row per person, **125+ rows drawn at once, no paging** |
| **[Save Entry]** | button | — | writes the reason against every ticked person. **Not pressed.** |

> The 11 long shift names line up one-for-one, in the same order, with the 11 short codes the rest of
> the product uses (`GS · NS · DS · NIS · GS1 · GS2 · GSH · GS19T · GS9T · NGS · PGSH`). So
> `GS = General`, `DS = Day Shift`, `GSH = General Shift HOD`, `PGSH = Production General Shift HOD`,
> and so on. *(The pairing is read off the identical ordering, not from a screen that shows both.)*

---

## 3. Logs Approval — `/Attendance/Logs_Approval.aspx?MenuId=54`

**Where:** Attendance → Logs Approval. The queue where a punch **somebody typed in by hand** waits
for a human to accept it before it counts.

**What you see on arrival:** breadcrumb `Home / Logs Approval`; a card titled **Logs Approval** with
the full standard filter bar, **[Show]**, a `Search` box and a blue **[Excel]** button; nothing below
until Show.

**Controls:** `Date From` (today) · `Date To` (today) · `Employee Name` · `Category` · `Company` ·
`Division` · `Department` · **[Show]** · `Search` · **[Excel]** (downloads the list; not pressed).

**The grid** — same shape as Device Logs, different actions:

`Device Code | Employee Name | Log Datetime | Device | (source) | (blank) | Remark | (blank) | (blank)`

- **Row actions: blue [Validate] and red [Disapprove].** ⚠️ *(the earlier capture recorded no
  buttons at all here — these two are the whole point of the screen.)*
- No paging, no page-size control.
- Live sample (Jan 2026, 12 rows waiting): `GPPI5013 | Test 133 | 01-01-2026 04:00 | ME | Location | | Out time` ·
  `GPPI5002 | Test 65 | 02-01-2026 18:00 | ME | Location | | Miss punch` ·
  `GPPI0065 | Test 38 | 23-01-2026 22:45 | ME | Location | | Due to travelling forgot to punch. Missed punch.`
- Every waiting row has `Device = ME`, i.e. every row in the queue is a hand-typed punch. The
  Remark is the reason the person gave.

**A dialog it also carries:** the same **`Manual Log Entry`** form as Device Logs
(`Device Code` · `Employee Name` · `Log DateTime` · `Remark` · `[Save]`) is present in the markup, but
**no visible button on this screen opens it** — presumably it is the Edit form for a queued row.
*(markup.)*

**Empty state:** nothing below the filter bar.

---

## 4. Holiday — `/Attendance/Holiday_Mst.aspx?MenuId=55`

**Where:** Attendance → Holiday. The company's holiday calendar, year by year.

**What you see on arrival:** page title **Holiday Master**, breadcrumb `Home / Holiday`; a
**[New Holiday]** button; two dropdowns (`Holiday Group`, `Year`); then a card titled
**Holiday List** with the grid, already filled — this screen loads its data without a Show button.

**Controls**

| Control | Default | Options |
|---|---|---|
| **[New Holiday]** | — | opens the `Holiday` dialog |
| `Holiday Group` | `All` | **`{All \| Default \| BAKRA EID \| Eid ul Fittar \| specila}`** *(their spelling of "special")* |
| `Year` | **`2026`** | `{2022 \| 2023 \| 2024 \| 2025 \| 2026 \| 2027}` |

Changing either dropdown reloads the grid immediately.

**The grid** — `Holiday Name | Holiday Date | (Edit) | (Delete)`
- Both text headers are sort links.
- Row actions: **[Edit]** (opens the dialog pre-filled) and **[Delete]** (browser confirm:
  *"Do you want to Delete ?"* — read from the button, never triggered).
- No paging; all rows drawn at once.

**The complete holiday list in the demo**

*2026 — 14 rows:*
`Makar Sankranti 14/01/2026 · Republic Day 26/01/2026 · Labor Day 01/05/2026 · Holi 04/03/2026 ·
Independence Day 15/08/2026 · Raksha Bandhan 28/08/2026 · Vishwakarma Pooja 17/09/2026 ·
Dussehra 20/10/2026 · Diwali 08/11/2026 · Diwali 09/11/2026 · Diwali 10/11/2026 ·
JANMASHTAMI 04/09/2026 · Eid ul Fittar 21/03/2026 · BAKRA EID 28/05/2026`
(Diwali is **three separate rows** — that is how a multi-day festival is entered. The list is **not
sorted by date**; it is in entry order.)

*2025 — 10 rows:*
`Makar Sankranti 14/01/2025 · BAKRA EID 07/06/2025 · Raksha Bandhan 09/08/2025 ·
Independence Day 15/08/2025 · Shri Krishna Janmashtami 16/08/2025 · Vishwakarma Pooja 17/09/2025 ·
Diwali 21/10/2025 · Dussehra 02/10/2025 · New Year 22/10/2025 · Bhai Dooj 23/10/2025`

*2022, 2023, 2024, 2027 — **empty**, and the empty state is the grid vanishing entirely: no headers,
no "no records" line.*

**Filtering 2026 by group:** `BAKRA EID` → 1 row · `Eid ul Fittar` → 1 row · `Default` → **nothing** ·
`specila` → **nothing**. So the 12 ordinary holidays are not in the `Default` group.

**Dialog — `Holiday`** (from [New Holiday], and the same form from [Edit])

| Field | Type | Default | Options |
|---|---|---|---|
| `Holiday Name` | text, placeholder *"Enter Holiday Name"* | empty | — |
| `Holiday Date` | date box | empty | — |
| `Holiday Type` | dropdown | `FullDay` | `{FullDay \| HalfDay}` |
| `Holiday Group` | dropdown | `All` | `{All \| Default \| BAKRA EID \| Eid ul Fittar \| specila}` |
| Buttons | | | `[×] [Close] [Save]` |

**How a holiday group reaches a person.** The groups themselves are a separate master —
**Master → Holiday Group** (`/Master/HolidayGroup_Mst.aspx?MenuId=41`), a plain list
`Holiday Group Name | Actions` with **[New Holiday Group]** and a page-size box
`{5 | 10 | 13 | 15 | 25}`, holding exactly five rows: **`All`, `Default`, `BAKRA EID`,
`Eid ul Fittar`, `specila`**. **"All" is a real group with its own row**, not a filter word — which is
why the 12 ordinary 2026 holidays show under group `All` and not under `Default`. Each holiday is
tagged with one group here on the Holiday screen; which group a *person* belongs to is set on that
person's record in Employee Master (H14's screen — I did not open it). So the chain is:
**group defined in Master → holiday tagged with a group here → person carries a group on their record.**

---

## 5. OD Entry (On Duty) — `/Attendance/OD_Entry.aspx?MenuId=56`

**Where:** Attendance → OD Entry. "On Duty" = the person was working but not at the machine — a site
visit, a client meeting, a delivery. It makes the day count as present with no punch.

**What you see on arrival:** page title **OD Entry**, breadcrumb `Home / OD Entry`; a **collapsed**
card headed **Filter** (⚠️ you have to open it — the filters are hidden by default); then a
**[New Entry]** button; then a card titled **OD List** with the grid already loaded.

**The Filter card** (once expanded): `Date From` (today) · `Date To` (today) · `Employee Name` ·
`Company` · `Division` · **`Categorgy`** *(same typo)* · `Department` · **[Filter]**.

**The grid** — `Emp Code | Emp Name | OD Date | OD Status | (Edit) | (Delete)`
- All four text headers are sort links.
- Row actions **[Edit]** / **[Delete]** (confirm: *"Do you want to Delete ?"*).
- **Paged, 10 rows a page**, numbered pager `1 2 3 4 5 6 7 8` — 8 pages of OD entries in the demo.
- Live sample: `EMP023 | Test 23 | 22-06-2026 | FullDay` · `EMP015 | Test 15 | 12-06-2026 | FullDay` ·
  `EMP001 | Test 1 | 21-05-2026 | FullDay`.

**Dialog — `OD Entry`** (from [New Entry] and from [Edit])

| Field | Type | Default | Options |
|---|---|---|---|
| `Employee Name` | dropdown | `EMP001:Test 1` | the 173 people |
| `OD From Date` | date box | empty | — |
| `OD To Date` | date box | empty | — |
| `OD Status` | dropdown | `FullDay` | `{FullDay \| HalfDay}` |
| `OT Minutes` | number, placeholder *"Enter Here"* | `0` | — |
| `Extra Work` | number, placeholder *"Enter Here"* | `0` | — |
| `Remark` | text, placeholder *"Enter Remark Here"* | empty | — |
| Buttons | | | `[×] [Close] [Save]` |

A date **range** in, one row per day out — the grid shows single dates.

---

## 6. COFF (Compensatory Off) — `/Attendance/COFFGenerate.aspx?MenuId=57`

**Where:** Attendance → COFF. A person worked on their weekly off or a holiday, so they are owed a
day back. This screen finds those days and turns them into credits — and this is the most modern
screen in the whole area.

**What you see on arrival:** breadcrumb `Home / COFF Generate`; a **blue "Filters" header bar** with a
chevron that collapses it; the filters inside; a grey action strip; and the message
**"Click Show to load COFF data."**

**The filter panel** ⚠️ — this is no longer a plain filter bar. `Employee Name`, `Category`,
`Company`, `Division` and `Department` are **multi-select** pickers: each is a button reading
`All Employees` / `All Categories` / `All Companies` / `All Divisions` / `All Departments`, and
clicking it drops a panel with a `Search...` box, an **`All …`** tick-row at the top and a tick-box
per option. Picking two or more makes the button read **"2 selected"**. `Date From` and `Date To`
(both today) sit above them.

**The action strip:** blue **[Show]** · green **[Generate All]** · red **[Remove All]** on the left,
and on the right the words `COFF lists` followed by five links —
`Consumed | Upcoming expiry | Expired | Generated (by employee) | Print consumed & expired`.
**Generate All** and **Remove All** act on every row the filters currently return; neither was pressed.

**The candidates grid** (after Show) — blue header row:

`EMPCODE | EMPLOYEE NAME | DATE | IN TIME | OUT TIME | STATUS | SHIFT | (button)`

- IN/OUT carry the **full date and time**, so a night shift that ends the next morning reads
  `01-01-2026 08:01 → 02-01-2026 07:55`.
- `STATUS` is a coloured dot plus a code (`P`, `WOP`, …).
- **1,862 candidate rows** for 01-01-2026 → 07-09-2026, all drawn at once, no paging.
- **The last column is one button per row, and its wording tells you the state of that day**
  *(logic read from the page's own script — I pressed none of them)*:

| Button | Colour | Meaning |
|---|---|---|
| **Generate** | blue | not turned into a credit yet — press to create the COFF |
| **Generated** | red, disabled | already a credit, and either it has no expiry set or it is already used up |
| **Extend** | amber | a live credit with an expiry date, not yet used — press to push the expiry out |
| **Extended** | grey, disabled | its expiry has already been pushed out once; it cannot be extended again |

**The `Extend COFF expiry` dialog** *(built by script; read from the markup, never opened against a
real credit because the demo has none)*: `Current Expiry` (shown, not editable) · **Extend by**
`○ Fixed date` / `○ Number of days` · `Extend till` (date box `DD-MM-YYYY`, pre-filled with a suggested
new expiry the server calculates) · `Days to add` (number, **default 30**, counted from the current
expiry) · `Reason (optional)` (textarea, *"Enter reason..."*) · buttons **[Extend]** and **[Cancel]**.
If the fancy dialog can't load, the page falls back to plain browser prompts —
*"OK = extend by DATE. Cancel = extend by DAYS."*, then *"Extend Till (dd-MM-yyyy):"* or
*"Days to add (positive number):"*, then *"Reason (optional):"*.

**The COFF lists panel** (opened by any of the four links; it slides in under the grid, and a small
grey line explains it: *"Same date range and filters as above. Each row is a COFF credit whose credit
date falls in that range. Generated (by employee) shows one row per employee (code, name) with the
number of COFF line items in range. Click + to see each work date and credit; click again to hide."*)

Four tabs, each with a live count badge — in the demo **all four read 0**:

```
Consumed COFF (0)          EMPCODE | NAME | COFF DATE | CREDIT | EXPIRY | CONSUMED ON
Upcoming expiry (0)        EMPCODE | NAME | COFF DATE | CREDIT | EXPIRY | DAYS LEFT | EXTENDED
Already expired (0)        EMPCODE | NAME | COFF DATE | CREDIT | EXPIRY | DAYS OVER | EXTENDED
Generated (by employee)(0) (+) | EMPCODE | EMPLOYEE NAME | NO. OF COFF (ROWS) | TOTAL CREDIT (DAYS)
```

Above the tabs sit four buttons with their own tooltips:
**[🖨 Print this list]** *"Print the tab you are viewing (consumed, upcoming, or expired)"* ·
**[🖨 Print consumed & expired]** *"Print consumed and already expired tables on one page"* ·
**[🖨 Print all lists]** *"Print consumed, upcoming expiry, and expired lists"* · **[Hide lists]**.

**Empty states:** before Show — *"Click Show to load COFF data."*; a range with no candidates —
*"No records found."*; each tab with nothing in it — *"No records."*

**Messages the screen will show you** (read from its script): *"Set dates and click Show first."* ·
*"Set dates first."* · *"Please select Date From and Date To."* · *"Please select dates."* ·
*"Please allow pop-ups to print."* · *"Invalid days"*.

**Realtime/auto:** none, but every list is fetched by background call rather than a page reload, so
switching tabs is instant.

---

## 7. ⭐ Attendace Voucher *(their spelling)* — `/Attendance/MonthlyAttVoucher.aspx?MenuId=58`

**Where:** Attendance → Attendace Voucher. **This is the operational heart of the product.** One
person, one month, one row per day — and every correction anyone will ever need to make to that
month is on a single dropdown at the end of each day's row.

### On arrival — the drill-down

A slim white bar across the top holds the **month stepper** `[<] Sep-2026 [>]` (the middle box is a
month picker, format `MMM-yyyy`) and, at the right, a blue **[↓]** button. Under it a card with
**[← Back]** on the left and a **`Home`** breadcrumb on the right, and inside the card a list of large
outlined cards you click through, one level at a time:

`Home → Location 1 / Location 2 → Company → Division → Department → the people`

The breadcrumb grows as you go and every step in it is clickable to jump back:
`Home / Location 2 / Company 2 / Division 2 / Marketing / EMP001:Test 1`. At the very bottom of the
card sit two view switches, **`Multiple Punch`** and **`Punch Device`**, both off. A small blue **`>`**
tab is stuck to the left edge of the window — it re-opens the tree panel if you have closed it (the
page remembers your choice in a cookie for 7 days).

### Once you land on a person

The top bar becomes: **[↑]** and the person's name **`EMP001:Test 1`** on the left · the month stepper
in the middle · **`Device logs`** · **`Print`** · **[↓]** on the right.

- **[↑] / [↓] are previous person / next person** ⚠️ — pressing ↓ moved from `EMP001:Test 1` to
  `EMP002:Test 2` and the breadcrumb followed; ↑ moved back. (They are *not* a download button.)
- **`EMP001:Test 1`** in the header is itself a link — it opens the person's summary card.
- **`Device logs`** opens a read-only pop-up of that person's punches for the month.
- **`Print`** opens a **new browser window** on `/Reports/Report_Viewer.aspx` — the standard report
  viewer with `of 0 · Find | Next` paging controls. (Empty in the demo because the month has no data.)
- **`Recalculate`** — a link at the bottom-left, next to the two switches. It re-runs the attendance
  calculation for this person and month. **Described, not pressed.**

### The month grid — 16 columns

```
Date | In Time | Out Time | Work Duration | OT | COFF | E-Work | Total Dur |
Status | Shift | Late By | Early By | SS | Day | HPMinutes | Action
```

| Column | What it holds |
|---|---|
| `Date` | `01-09-2026` — one row per day |
| `In Time` / `Out Time` | the first and last punch of the day |
| `Work Duration` | time actually worked, `H:MM` |
| `OT` | overtime, `H:MM` |
| `COFF` | the compensatory-off credit earned that day |
| `E-Work` | extra work, `HH:MM` |
| `Total Dur` | work + everything counted |
| `Status` | the day's verdict — see the code list below |
| `Shift` | the shift code that applied that day (`NS`, `GS`, …) |
| `Late By` / `Early By` | minutes late in / early out, `HH:MM` |
| `SS` | the **scheduled** shift (what the roster said, against `Shift` which is what was used) |
| `Day` | one letter — `M T W T F S S` |
| `HPMinutes` | half-present minutes |
| **`Action`** | the dropdown that does everything — below |

**How much it shows:** for the **current** month it draws only the days up to today (01–07 Sep gave
7 rows); for a **past** month it draws every day (Aug-2026 gave 31).

**The footer chips** — a strip of coloured badges under the grid, counting the month:
`✖ A = 5` (red) · `🏝 H = 1` (green) · `🏠 WO = 1` (purple) · `🕐 OT = 0:0` (dark green) ·
`💼 E-Work = 0:0` (blue). A chip only appears if it has something to count — Aug-2026 for the same
person showed only `A = 31 · OT = 0:0 · E-Work = 0:0`.

**Status codes seen across the demo:** `P` present · `A` absent · `H` holiday · `WO` weekly off ·
`WOP` worked on the weekly off · `HP` half present · `OD` on duty · `COFF` compensatory off ·
`MissPunch` · `NSF` no shift found · `SHL` short leave · `LTD` late · `SPL` special · `MD` .

### ⭐ The `[Action ▾]` on every single day — all 17, with their stored values

The control is a `<select>` per row (id `grdAttendanceView_ddlCategory_<n>`); the page dresses it up
as a custom drop-panel, and picking anything posts straight back to the server.

| # | Value | Option | What it does |
|---|---|---|---|
| — | `` | `--Select--` | the resting state; does nothing |
| 1 | `1` | **Add Punch** | type in a punch this person missed — opens *Manual Log Entry* |
| 2 | `2` | **Leave Entry** | put the day down as leave — opens *Apply Leave* |
| 3 | `3` | **Change Shift** | run the day against a different shift — opens *Change Shift* |
| 4 | `4` | **Assign WO** | make this day the person's weekly off |
| 5 | `5` | **Cancel WO** | take the weekly off back off this day |
| 6 | `6` | **OD Entry** | mark the day as on-duty (off-site work) — opens *OD Entry* |
| 7 | `7` | **OT Sanction** | approve overtime for the day — opens *OT Sanction* |
| 8 | `8` | **OT Cancel** | withdraw that overtime approval |
| 9 | `9` | **COFF Generate** | turn a day worked on an off-day into a COFF credit — opens *COFF Generate* |
| 10 | `10` | **OT Cutoff** | cap the overtime at a set figure — opens *OT Saction* |
| 11 | `11` | **Delete Leave Entry** | remove the leave that was put on this day |
| 12 | `12` | **Delete OD Entry** | remove the on-duty entry |
| 13 | `13` | **COFF Cutoff** | cap the COFF credit at a set figure — opens *COFF Cutoff* |
| 14 | `14` | **Delete COFF** | remove the COFF credit |
| 15 | `15` | **Re-Assign Holiday** | put a holiday back onto this day |
| 16 | `16` | **Cancel Holiday** | take the holiday off this day for this person |
| 17 | `17` | **Short Leave** | a few hours' leave rather than a day — opens *Apply Short Leave* |

> **How I captured these honestly.** Every one of the 17 is a server post, and six of them
> (`Cancel WO`, `OT Cancel`, `Delete Leave Entry`, `Delete OD Entry`, `Delete COFF`, `Cancel Holiday`)
> read as things that act the moment you pick them. On somebody else's live records that is not
> something to try, so I opened **one** — `Leave Entry` — read its form and closed it, and read the
> other ten dialogs straight out of the page's own markup, where they all sit ready. Names, fields,
> defaults and option lists below are therefore exact; the "what it does" column is what each option
> plainly says.

### Every dialog the Voucher carries — twelve of them

**`Apply Leave`** — *opened live; this is why the two lists below are real values*

| Field | Type | Default |
|---|---|---|
| `Employee Name` | dropdown, 173 people | the person you are on |
| `Leave Status` | dropdown | `FullDay` — `{FullDay \| HalfDay}` |
| `From Date` | date | **the day you clicked** (`01-09-2026`) |
| `To Date` | date | **the same day** |
| **`Leave Type`** | dropdown | `SL (1)` — **`{SL (1) \| PL (12) \| ML (0) \| LOP (0) \| COFF (0) \| CL (3)}`** |
| `Remark` | text, *"Enter Remark"* | empty |
| | | `[×] [Close] [Save]` |

**The number in brackets after each leave type is that person's remaining balance** — sick leave 1
left, privilege leave 12, medical 0, loss-of-pay 0, comp-off 0, casual 3. You choose the leave with
the balance in front of you.

**`Manual Log Entry`** — `Employee Name` (173) · `Log DateTime` · **`○ Punch IN / ○ Punch OUT`**
(radio pair, neither pre-picked) · `Remark` *"Enter Remark Here"* · `[×] [Close] [Save]`.

**`Change Shift`** (header reads `DeviceCode`) — `Shift` dropdown, default `GS`,
**`{GS | NS | DS | NIS | GS1 | GS2 | GSH | GS19T | GS9T | NGS | PGSH}`** · `[×] [Close] [Save]`.

**`COFF Generate`** — `COFF Status` `{FullDay | HalfDay}` default `FullDay` · `WOP Date` (date) ·
`Remark` *"Enter Remark"* · `[×] [Close] [Save]`.

**`OD Entry`** — `Employee Name` · `OD Date` · `OD Status` `{FullDay | HalfDay}` · `OT Minutes`
(number, *"Enter Here"*) · `Extra Work` (number) · `Remark` · `[×] [Close] [Save]`.

**`OT Sanction`** — `Employee Name` · `OT Date` · **`OT Duration`** (a proper time box) ·
`[×] [Close] [Save]`.

**`OT Saction`** *(their typo — this is the OT **Cutoff** dialog)* — `Employee Name` · `OT Date` ·
`OT Minutes` (number) · `OT Hrs` (text) · `Remark` · `[×] [Close] [Save]`.

**`COFF Cutoff`** — `Employee Name` · `COFF Date` · `COFF Minutes` (number) · `COFF Hrs` (text) ·
`Remark` · `[×] [Close] [Save]`.

**`Apply Short Leave`** — `Employee Name` · `Date` · `Leave Status` · `Leave Type` · `Remark` ·
`[×] [Close] [Save]`. (The two lists are filled by the server the moment it opens, exactly as on
*Apply Leave*.)

**`Official Gatepass Entry`** — `Employee Name` · `Out Time` · `In Time` · `Duration` (number,
*"Enter Here"*) · **`Approved Duration`** (number) · `Remark` · `[×] [Close] [Save]`. A gate pass for
stepping out mid-shift, where the hours claimed and the hours approved are two different boxes.
**No option on the 17-item list opens it** — it is reached some other way, or is left over.

**`(employee card)`** — opened by clicking the person's name in the header. A photo, then
`Gender: Male` · `Status: Working` · `Joining Date: 01-Jan-2016` · `Category: Category 4` ·
`Shift Group: GS-HOD` · `Weekly Off: Sunday (Employee Wise)` · `Weeklyoff 2:` (blank here) ·
`Is OT applicable? No (Employee Wise)`, and a `Shift Name | Field | Value` table. Read-only, one `[×]`.
**"(Employee Wise)"** after a value means it is set on this person rather than inherited from their
category — a quiet but important label.

**`(device logs)`** — opened by the `Device logs` link. Titled with the person's code and name;
read-only; showed **"No Device logs for this month."** with `[×] [Close]`.

### The two view switches at the bottom

Both off by default. They **widen the grid rather than change any data**:

- **`Multiple Punch`** on → 13 extra columns appear between In Time and Out Time:
  `Punch 1 | Punch 2 | Punch 3 | Duration1 | Punch 4 | Punch 5 | Duration2 | Punch 6 | Punch 7 |
  Duration3 | Punch 8 | Punch 9 | Duration4` — up to **nine punches a day in four in/out pairs**, each
  pair with its own duration.
- **`Punch Device`** on (on top of the first) → a **`Device`** column is inserted beside every single
  punch, so you can see which machine each tap came from. The grid reaches **39 columns**.

Both were switched back off after reading.

**Empty state:** a person with no punches still gets a full row per day — `A` in Status, `0:00`
everywhere. The month is never blank.

---

## 8. Attendance Checklist — `/Attendance/AttendanceChecklist.aspx?MenuId=90`

**Where:** Attendance → Attendance Checklist. The "who is wrong today" screen — one line per person
per day across the whole company, filtered down to just the problems.

**What you see on arrival:** breadcrumb `Home / Attendance CheckList` and **a single collapsed card
headed `Filter`** ⚠️ — that is the entire screen until you open it and press Show.

**The Filter card**

| Control | Default | Complete option list |
|---|---|---|
| `Attendance From` | today, **`dd/MM/yyyy`** ⚠️ (slashes, unlike every other screen here) | — |
| `Attendance To` | today | — |
| `Location` | `All` | `{All \| Location 1 \| Location 2 \| Location 3 \| Location 4 \| Location 5}` |
| `Category` | `All` | the 8 |
| `Company` | `All` | the 3 |
| `Division` | `All` | the 10 |
| `Department` | `All` | the 22 |
| **`Status`** | `All` | **`{All \| Present \| Absent \| WeeklyOFF \| Holiday \| OnLeave \| MissPunch \| NSF \| Miss Punch & NSF}`** |
| **`Order By`** | `Company_Name,EmployeeName` | **`{Company_Name,EmployeeName \| EmpCode \| EmployeeName \| Company_Name \| Company_Name,EmpCode \| intime \| Company_Name,Category_Name \| Company_Name,Department_Name \| Department_Name}`** |
| `Sort by` | `Ascending` | `{Ascending \| Descending}` |
| **[Show]** | — | loads the grid |
| `Search` | empty | searches the loaded rows |

**The grid** — 17 columns:

`EmpCode | EmployeeName | Location | Company | Department | Gender | Date | In Time | Out Time |
Work Duration | OT | Total Dur | Status | Shift | Late By | Early By | Action`

- `Action` is a small dropdown on every row with **exactly two entries: `{--Select-- | Add Punch}`** ⚠️.
  Picking `Add Punch` opens the **`Manual Log Entry`** dialog described below — so a missing punch can
  be fixed straight from the list without going into anybody's voucher.
- **No paging.** 01–07 Sep across all people drew **868 rows** in one grid.
- Live sample:
  `EMP082 | Test 82 | Location 3 | Company 1 | Production | Male | 01-09-2026 | | | 0:00 | 0:00 | 0:00 | A | NS | 00:00 | 00:00 | [--Select--]`

**Dialog — `Manual Log Entry`** (id `modal-punch`) ⚠️ *(new — the earlier capture recorded no dialog
on this screen)*: `Employee Name` (173, shown as `EMP001 : Test 1` with spaces round the colon here) ·
`Log DateTime` · `Remark` *"Enter Remark Here"* · `[×] [Close] [Save]`.

**Empty state:** just the collapsed `Filter` card and nothing else.

**One thing worth knowing:** the date boxes are not checked before the page posts. Typing a date in
this screen's *other* format (`01-09-2026` instead of `01/09/2026`) sends you to the friendly error
page — *"Houston, we have a tiny glitch… String was not recognized as a valid DateTime."* with a
reference code and `[Back to Home] [Go Back]`. Using the calendar icon avoids it.

---

## 9. ⭐ Shift Shedule *(their spelling)* — `/Attendance/Shift_Shedule_View.aspx?MenuId=59`

**Where:** Attendance → Shift Shedule. The roster: who is on which shift, day by day, for a month.

**What you see on arrival:** a **two-panel screen**, not the month grid the earlier capture described.
⚠️

**Left panel (about a quarter of the width):** a month box **`Sep-2026`** with a calendar icon; below
it a `Search here` box and a blue **[Filter]** button; below that an **expanding tree of the 18
departments**, in alphabetical order:
`Accounts · Consumables Store · Default · Dispatch · House Keeping · HR · IT · Loading · Maintenance ·
Marketing · Packing · Production · Production Pardi · Purchase · QC · QC PARDI · Safety · STORE`.
Click a department and it expands **in place** to list its people with a small person icon —
Marketing opened to 20: `EMP001:Test 1 · EMP002:Test 2 · EMP004:Test 4 · EMP006:Test 6 · EMP008:Test 8 ·
EMP033:Test 33 · EMP035:Test 35 · EMP038:Test 38 · EMP042:Test 42 · EMP048:Test 48 · EMP083:Test 83 ·
EMP100:Test 100 · EMP107:Test 107 · EMP112:Test 112 · EMP139:Test 139 · EMP140:Test 140 ·
EMP141:Test 141 · EMP152:Test 152 · EMP157:Test 157`. The department turns green while open and the
selected person turns green.

**Right panel:** a card holding three blue buttons side by side —
**[Excel Import]** · **[Manual Generate]** · **[Auto Generate]** — and, under them, the area where the
roster is drawn.

**⚠️ Honest finding: the roster area was empty on every attempt.** I checked Sep-2026, Aug-2026,
Jul-2026 and Jun-2026, at department level and at person level, and the panel below the buttons stayed
blank every time. The demo has no shift schedule rows to show. The page's markup confirms the
schedule is drawn server-side into an empty container. **What the roster grid's columns look like when
it does have rows is therefore something I could not see, and I am not going to guess it.**

**A second finding: the three buttons disappear after your first click in the tree.** They render on
first load; once you select a department or a person the right-hand card comes back with the buttons
gone, and only re-appear on a fresh page load.

**A right-click menu on the roster** — the page carries a hidden context menu with two entries,
**`Edit`** and **`Delete`**, meant for right-clicking a roster cell. *(markup — with no rows there was
nothing to right-click. The two functions it calls, `editRow()` and `deleteRow()`, are not defined in
anything the page loads, so on this build the menu would do nothing.)*

### The three ways to fill a roster

**1 — `Excel Import`** ⚠️ *(never recorded before — it is its own page)*
Goes to **`/Attendance/ShiftShedule_Import.aspx?MenuId=59`**, titled **Shift Shedule Import**:
- a **`File Format`** link at the top right → downloads the blank template **`/Sample_Files/ShiftSchedule.xlsx`**
- `Attendance Month` — date box, `Sep-2026`
- a heading `Excel Import`, then a **`Choose file`** picker
- the word **`-----OR-----`**
- **`Paste Data Here`** — a textarea, so you can paste rows straight out of Excel instead of uploading
- one button: **[Preview]** — you look at what will be imported *before* anything is written.

**2 — `Manual Generate`** — dialog **`Employee Shift`**, one person one day:

| Field | Type | Default | Options |
|---|---|---|---|
| `Employee Name` | dropdown | `EMP001:Test 1` | the 173 people |
| **`Shift Date`** ⚠️ | date box | today | *(one date, not a from/to range)* |
| `Shift` | dropdown | `GS` | **`{GS \| NS \| DS \| NIS \| GS1 \| GS2 \| GSH \| GS19T \| GS9T \| NGS \| PGSH}`** |
| **`WO`** | checkbox | unticked | ticking it makes that day the person's weekly off instead of a shift |
| | | | `[×] [Close] [Save]` |

**3 — `Auto Generate`** — dialog **`Auto Generate Shift Schedule`**, the bulk route:

| Field | Type | Default | Options |
|---|---|---|---|
| `Month` | date box | `Sep-2026` | — |
| `Company` | dropdown | **`Company 1`** | `{Company 1 \| Company 2}` — **no "All"; a run covers one company** |
| `Department` | dropdown | `All` | the 22 |
| `Category` | dropdown | `All` | the 8 |
| `Employee` | dropdown | `All` | `All` + the 173 |
| | | | `[×] [Close]` and **[Generate]** |

Narrow it to a department, a category or one person, or leave everything on `All` and roll the whole
company's month in one press. It reads each person's **shift group** and **weekly off** from their
record (the summary card on the Voucher shows both — `Shift Group: GS-HOD`,
`Weekly Off: Sunday (Employee Wise)`) and lays the month out from that. **[Generate] was not pressed.**

**Two more dialogs the page carries but nothing visible opens:** the same **`COFF Generate`**
(`COFF Status {FullDay|HalfDay}` · `WOP Date` · `Remark`) and **`Manual Log Entry`**
(`Device Code` · `Employee Name` · `Log DateTime` · `Remark`) as elsewhere — presumably meant for the
roster's right-click menu. *(markup.)*

**Empty state:** the right-hand panel is simply blank — no headings, no "nothing rostered" message.

---

## Corrections to the 2026-08-16 capture

Every item below was checked live on 2026-09-07.

1. **Device Logs — the second button is not `[Excel]`.** Old: *"`[Show] [Excel]`"*. It reads
   **[Add Manual Punch]** (the control's internal name is `BtnExcel`, which is likely where the
   mistake came from). There is **no Excel export on Device Logs**. Logs Approval does have `[Excel]`.
2. **Device Logs — the Manual Punch field is `Log DateTime`, not `Log Date`,** and the dialog carries a
   **`Device Code`** picker of **173 codes** (including the hand-typed `dr` and `DR MARKETING` and one
   blank), which the old note reduced to *"{GPPI0001…}"*.
3. **Device Logs / Logs Approval — the grid columns were never recorded.** Both are
   `Device Code | Employee Name | Log Datetime | Device | (source) | | Remark | | ` with a source
   column showing `Location`.
4. **Logs Approval — the two buttons that make it an approval screen were missing.** Every row has
   **[Validate]** (blue) and **[Disapprove]** (red). Old text only said *"where punches wait for
   approval"*.
5. **Logs Approval also carries the `Manual Log Entry` dialog** in its markup, unmentioned before.
6. **Late Early Entry — `[New Entry]` is a whole page, not a small form,** and it was never
   described. It carries `Date`, `Shift` (**11 long shift names**), `Reason {Bus | Election | SHL}`,
   `Late/Early {Late | Early}`, `Late/Early By(in Mins)`, the four scope filters, `[Show]`, a
   **tick-list of every matching person** with a tick-all header, one `Remark`, and **[Save Entry]**.
   The old note said only *"Reasons come from the Late/Early Reason Master"* — the three reasons in
   the demo are `Bus`, `Election`, `SHL`.
7. **Late Early Entry's date defaults are the month, not today** (`01-09-2026` → `30-09-2026`), unlike
   every other screen in this group.
8. **Holiday — the demo list was never written down.** 14 rows for 2026, 10 for 2025, **nothing at all
   for 2022, 2023, 2024 and 2027**. Diwali 2026 is three separate rows.
9. **Holiday — `All` is a real holiday group,** one of five rows in
   `/Master/HolidayGroup_Mst.aspx?MenuId=41`, not a "show everything" word. Filtering 2026 by
   `Default` returns nothing; the 12 ordinary holidays sit in the group named `All`.
10. **Holiday — the grid's row actions were not recorded:** `[Edit]` and `[Delete]`
    (*"Do you want to Delete ?"*), and both column headers are sort links.
11. **OD Entry — the filter card is collapsed on arrival** and the button is `[Filter]`, not `[Show]`.
    The grid is **paged at 10 rows** with a numbered pager (8 pages in the demo) — no paging was
    mentioned before. Field names on the dialog are `OD From Date` / `OD To Date`.
12. **COFF — the filters are now multi-select with search.** Old: a plain filter list. Each of
    Employee / Category / Company / Division / Department is a button (`All Employees`, …) opening a
    tick-panel with a `Search...` box and an `All …` row, and the button then reads *"n selected"*.
13. **COFF — the per-row button has four states, not one.** `Generate` (blue) → `Generated`
    (red, disabled) → `Extend` (amber) → `Extended` (grey, disabled).
14. **COFF — the whole extend-the-expiry feature was missing.** `Extend COFF expiry`:
    current expiry shown, `○ Fixed date` / `○ Number of days`, `Extend till`, `Days to add` (default
    **30**), optional `Reason`, `[Extend]`. The `EXTENDED` column on two of the tabs is what it feeds.
15. **COFF — the tab names on screen are `Consumed COFF`, `Upcoming expiry`, `Already expired`,
    `Generated (by employee)`,** each with a count badge; the old note called the third "Already
    expired" correctly but listed the first as "Consumed COFF (0)" only. All four read **0** today.
16. **Attendance Voucher — `[↓]` is not a download.** `[↑]` and `[↓]` are **previous person** and
    **next person**; pressing ↓ moved EMP001 → EMP002 and updated the breadcrumb.
17. **Attendance Voucher — `Recalculate` is a link at the bottom-left beside the two switches,** not
    part of the top link row as the old layout implied.
18. **Attendance Voucher — `Print` opens a separate browser window** on `/Reports/Report_Viewer.aspx`
    (a report viewer with `of 0 · Find | Next`), not an in-page print.
19. **Attendance Voucher — the 17 actions are confirmed exactly as recorded**, and their stored values
    are `1`–`17` in the listed order. The old capture got this right; this run adds the values, what
    each one does, and which dialog each opens.
20. **Attendance Voucher — the `Leave Type` list carries live balances:**
    `{SL (1) | PL (12) | ML (0) | LOP (0) | COFF (0) | CL (3)}`. The old note listed the fields of
    *Apply Leave* but not that the options show what the person has left. `Leave Status` is
    `{FullDay | HalfDay}` and both dates arrive **pre-filled with the day you clicked**.
21. **Attendance Voucher — `Manual Log Entry` here has a `○ Punch IN / ○ Punch OUT` radio pair**, which
    the Device Logs version does not (that one has a `Device Name` dropdown instead).
22. **Attendance Voucher — there are twelve dialogs, not eight.** The four not listed before: the
    **employee summary card**, the **device-logs pop-up**, **`Official Gatepass Entry`** (which no
    Action option opens), and **`OT Saction`** — the OT *Cutoff* dialog, whose title is misspelled and
    which is a different dialog from `OT Sanction`.
23. **Attendance Voucher — the switches were never explained.** `Multiple Punch` adds 13 columns
    (nine punches in four in/out pairs, each with a duration); `Punch Device` adds a `Device` column
    beside every punch, taking the grid to 39 columns.
24. **Attendance Voucher — the drill-down is a card list, not a side tree,** with `[← Back]`, a
    clickable breadcrumb, and a `>` tab on the window edge that re-opens the panel. The choice is
    remembered in a cookie for 7 days.
25. **Attendance Voucher — the current month stops at today** (7 rows on 07-09-2026); past months draw
    every day.
26. **Attendance Checklist — the filter card is collapsed on arrival**, and its date boxes use
    **`dd/MM/yyyy`** while every other screen here uses `dd-MM-yyyy`.
27. **Attendance Checklist — the grid and its `Action` dropdown were never recorded.** 17 columns, and
    every row has `{--Select-- | Add Punch}` opening a `Manual Log Entry` dialog. 868 rows for 7 days
    with no paging.
28. **Shift Schedule — the layout is wrong in the old capture.** It is not *"Month picker + search +
    [Filter]"* over a grid; it is a **department tree on the left** that expands to people, with the
    three buttons and the roster area on the right.
29. **Shift Schedule — `Manual Generate` has one `Shift Date`, not `Entry From Date`** (no range), and
    the dialog is titled **`Employee Shift`**.
30. **Shift Schedule — `Excel Import` is its own page**, `/Attendance/ShiftShedule_Import.aspx`, with a
    **[File Format]** template download (`/Sample_Files/ShiftSchedule.xlsx`), a file picker, an
    **`-----OR----- Paste Data Here`** textarea, and a **[Preview]** button — never recorded.
31. **Shift Schedule — `Auto Generate`'s Company picker has no `All`.** `{Company 1 | Company 2}` only,
    so one run covers one company.
32. **Both spellings in the menu are the product's own** — "Attendace Voucher" and "Shift Shedule" —
    and so is `Categorgy` on three filter bars and `OT Saction` on a dialog title.

---

## Odd things I noticed

- **Every "no data" state in this group is an empty space.** Device Logs, Logs Approval, Late Early
  Entry, Holiday for an empty year, and the Shift Schedule roster all just end — no headers, no
  "no records found". Only COFF and its tabs say anything (*"Click Show to load COFF data."*,
  *"No records found."*, *"No records."*).
- **Sorting on the OD Entry and Holiday grids appears to be wired to the wrong field.** Every column
  header — `Emp Code`, `Emp Name`, `OD Date`, `OD Status`, `Holiday Name`, `Holiday Date` — posts back
  the identical instruction, `Sort$CompanyName`.
- **The Shift Schedule's three buttons vanish after the first click in the tree** and only come back on
  a page reload, which makes the screen feel broken the moment you start using it.
- **The Shift Schedule's right-click Edit/Delete menu calls two functions that do not exist** in
  anything the page loads.
- **The Attendance Checklist accepts a badly formatted date and answers with the error page** rather
  than saying "that date isn't right". The error page itself is friendly — *"Houston, we have a tiny
  glitch… Don't worry — your data is safe."* with a reference code and `[Back to Home] [Go Back]`.
- **`Categorgy`** is misspelt on Device Logs, OD Entry and the Late Early entry form, but spelled
  correctly on Logs Approval, COFF and the Checklist — so the same filter has two spellings depending
  on which screen you are standing on.
- **Two dialog titles are misspelt:** the OT Cutoff dialog is headed `OT Saction`, and the Change Shift
  dialog is headed `DeviceCode`.
- **The Change Shift dialog uses short shift codes** (`GS`, `NS`, …) while the Late Early form uses the
  long names (`General`, `Day Shift`, …) for the same eleven shifts. Nowhere shows both together.
- **The Holiday screen and its master both offer a group called `All`,** which reads as "every group"
  but is a group in its own right — the 12 ordinary 2026 holidays are in it, and filtering by
  `Default` returns nothing.
- **The device code list contains three entries that look hand-typed:** `dr`, `DR MARKETING`, and one
  blank line, sitting among 170 well-formed `GPPI####` codes.
- **`GPPI0173` appears twice** in the device code list.

---

## In human language — every feature in this area, as points

**Reading the punches**

- **The punch list** — Every tap on a fingerprint or card machine lands here as a line: whose card,
  which machine, the exact date and time. This is the raw truth before anyone decides what the day
  meant. Attendance → Device Logs, then pick your dates and press Show.
- **Filtering the punch list** — You can narrow it to one person, one company, one branch-type group,
  one department or one staff category before you look, and then type in a search box to find a name
  inside what came back.
- **Typing in a punch somebody's machine missed** — A blue "Add Manual Punch" button opens a small
  form: pick the card number, pick the person, type the date and time, say whether it counts as an
  arrival or a departure, add a note. It is how a forgotten punch gets fixed.
- **Correcting or removing a punch** — Every line in the punch list has an Edit and a Delete button
  beside it.
- **Seeing which machine a punch came from** — Real machines show their own name (the demo's is called
  "Sarigam"); punches somebody typed in show as ME, ME(IN) or ME(OUT), so a hand-made punch is never
  mistaken for a real one.

**Approving the punches people typed themselves**

- **The approval queue** — Every hand-typed punch waits in one list until someone in charge looks at
  it. Attendance → Logs Approval. Each line shows the person, the time claimed and the reason they
  gave ("Out time", "Miss punch", "Due to travelling forgot to punch").
- **Accept or refuse, one line at a time** — Two buttons on every row: a blue **Validate** to let the
  punch count, a red **Disapprove** to throw it out. Nothing a person typed becomes real attendance
  until one of those is pressed.
- **Take the queue away with you** — An Excel button downloads the whole waiting list.

**Explaining lateness**

- **The late/early record** — A separate list of every time someone came late or left early *with a
  reason attached*, so the number in the attendance report has a story behind it. Attendance →
  Late Early Entry.
- **Marking a whole group late at once** — Press New Entry and you get a form for the situation, not
  the person: the date, the shift, why (the demo offers Bus, Election, SHL), whether it was late or
  early, and how many minutes. Then you tick every person it applied to from a list and save once.
  One bus breakdown, sixty people, one entry.

**The holiday calendar**

- **The company's holiday list** — Attendance → Holiday shows the year's holidays by name and date.
  Pick a different year from the dropdown and the list changes.
- **Adding a holiday** — Name, date, whether it is a full day or a half day, and which holiday group
  it belongs to.
- **Half-day holidays** — A holiday can be worth half a day rather than a whole one, which matters for
  a factory that works a short shift on a festival morning.
- **A festival that runs several days is entered several times** — Diwali appears as three separate
  rows, one per day.
- **Holiday groups** — Not everyone gets the same holidays. Groups are set up under Master →
  Holiday Group; each holiday is tagged with a group when you add it; each person carries a group on
  their own record. That is how a Muslim-holiday group and a general group can live side by side in
  one company.
- **Editing or removing a holiday** — Every row has Edit and Delete, and Delete asks you first.

**Days worked away from the office**

- **On-duty days** — When someone is genuinely working but nowhere near a punching machine — a site
  visit, a client meeting, a delivery run — you record an "OD". The day then counts as worked with no
  punches at all. Attendance → OD Entry.
- **Recording an OD** — Pick the person, a from-date and a to-date, whether it is a full or half day,
  any overtime minutes and any extra work, plus a note.
- **The OD list** — Every OD entry ever made, ten to a page, with Edit and Delete on each. You can
  narrow it by date, person, company, branch group, category or department.

**Days off owed back (comp-off)**

- **Finding who is owed a day** — Attendance → COFF finds every day in your date range where someone
  worked when they should have been off, and lists them with the hours they actually put in.
- **Turning a worked off-day into a day owed** — A Generate button on each line converts that day into
  a credit the person can take later. There is also a Generate All that does the whole filtered list
  in one press, and a Remove All that undoes it.
- **Picking several people, several departments at once** — Every filter on this screen lets you tick
  more than one thing and has a search box inside it, so "these four departments" is one selection
  rather than four runs.
- **Days owed have a use-by date** — A credit is not forever. The screen keeps four lists: ones already
  taken, ones expiring soon (with days left), ones that already expired (with days over), and a
  per-person summary of how many credits each person has and how many days that adds up to.
- **Giving somebody longer to use a day they are owed** — An Extend button on a credit lets you push
  its expiry out, either to a date you pick or by a number of days (it suggests 30), with an optional
  reason. It can only be done once — after that the button reads "Extended" and is greyed out.
- **Printing the comp-off lists** — Three print buttons: the tab you are looking at, the taken-and-
  expired pair on one page, or all of them together.

**⭐ Fixing one person's month — the Attendance Voucher**

- **One person, one month, one screen** — The single most important screen in the product. You reach a
  person by clicking down through location → company → division → department → their name, and you get
  every day of their month as a row.
- **What each day shows** — the date, first punch in, last punch out, hours worked, overtime, comp-off
  earned, extra work, the total, the verdict for the day (present, absent, holiday, weekly off, half
  present, on duty, missing punch and so on), which shift applied, how late they were in, how early
  they left, what the roster had said they should be on, the weekday, and half-present minutes.
- **The month at a glance** — Coloured badges under the grid count the month up: absences, holidays,
  weekly offs, total overtime, total extra work.
- **Moving to the next person without going back** — Up and down arrows in the header step through the
  people in the same department; the trail at the top follows you.
- **Stepping through months** — Arrows either side of the month box, or type the month straight in.
- **Who this person is, at a glance** — Clicking their name opens a card: photo, gender, working
  status, joining date, category, shift group, weekly off day, and whether overtime applies to them.
  Where a setting was made specially for this person rather than inherited, it says so.
- **Their punches for the month** — A "Device logs" link shows the raw machine record for this person
  and this month, side by side with the attendance you are correcting.
- **Printing the month** — A Print link opens the month as a proper printable report in its own window.
- **Recalculating** — A Recalculate link re-runs the whole month's arithmetic after you have corrected
  things, so the totals catch up with your fixes.
- **Seeing every single punch of a day, not just first and last** — A "Multiple Punch" switch opens the
  grid out to show up to nine punches a day in four in/out pairs, each with its own duration. Useful
  where people clock out for lunch and site trips.
- **Seeing which machine each punch came from** — A second switch, "Punch Device", adds the machine
  name beside every punch, for sites with more than one entrance.
- **⭐ Seventeen ways to correct a single day** — every day's row ends in one dropdown, and this is what
  makes the screen the heart of the product. In its own words: **Add Punch · Leave Entry · Change
  Shift · Assign WO · Cancel WO · OD Entry · OT Sanction · OT Cancel · COFF Generate · OT Cutoff ·
  Delete Leave Entry · Delete OD Entry · COFF Cutoff · Delete COFF · Re-Assign Holiday · Cancel
  Holiday · Short Leave.** The eleven points below say what each of those means.
- **Add a missing punch to a day** — Opens a small form to type the time in, marking it as an arrival
  or a departure.
- **Turn a day into leave** — Opens a leave form with the day already filled in, where you pick full or
  half day and the leave type. **The leave list shows what the person has left** — sick 1, privilege
  12, casual 3 and so on — so you choose with the balance in front of you.
- **Run a day against a different shift** — If someone covered the night shift, you switch that one day
  to that shift and the lateness and overtime recalculate against the right hours.
- **Make a day a weekly off, or take that back** — Two of the seventeen: "Assign WO" and "Cancel WO".
  Useful when the rest day moved that week.
- **Mark a day as on-duty from here** — The same on-duty form as the OD screen, reachable without
  leaving the person's month. "Delete OD Entry" takes it back off.
- **Approve overtime, cap it, or withdraw it** — "OT Sanction" approves a day's overtime (you type the
  duration); "OT Cutoff" caps it at a figure you set; "OT Cancel" withdraws the approval entirely.
- **Create or cap or delete a comp-off from the day itself** — "COFF Generate" turns this one day into
  a day owed; "COFF Cutoff" caps how much it is worth; "Delete COFF" removes it.
- **Put a holiday back on a day, or take it off for this one person** — "Re-Assign Holiday" and
  "Cancel Holiday", for the person who had to come in on a festival, or the one who should have got a
  holiday and did not.
- **A few hours off rather than a day** — "Short Leave" records a part-day absence against the day.
- **A gate pass for stepping out mid-shift** — A form recording when the person left, when they came
  back, how long that was, and separately **how long was approved** — so a two-hour trip can be
  allowed as one.

**Spotting problems across everybody**

- **The "who is wrong today" list** — Attendance → Attendance Checklist gives one line per person per
  day for the whole company, with location, company, department, gender, times, hours, overtime, the
  verdict, the shift and the lateness all on one row.
- **Show me only the problems** — A single dropdown filters the whole company to Present, Absent,
  Weekly Off, Holiday, On Leave, Missing Punch, No Shift Found, or Missing Punch and No Shift Found
  together. That last one is the daily morning job: everyone whose day cannot be worked out.
- **Order it the way you want to read it** — Nine ready-made sort orders (by company then name, by
  employee code, by name, by company then code, by clock-in time, by company then category, by company
  then department, by department) and ascending or descending.
- **Fix a missing punch straight from the list** — Every row on the checklist has a small dropdown
  whose only entry is "Add Punch", which opens the punch form there and then. You never have to open
  the person's month for a simple missing punch.

**⭐ Putting people on shifts**

- **The roster screen** — Attendance → Shift Shedule. Departments down the left; click one and it opens
  to show its people; click a person and their month's roster appears on the right.
- **Eleven shifts to choose from** — General, night, day, night-in, three more general variants, a head-
  of-department general, a night general, a normal general and a production head-of-department shift.
- **Rostering one person for one day** — "Manual Generate": pick the person, the date, the shift, save.
  A tick-box on that same form says "this day is their weekly off" instead of a shift.
- **⭐ Rostering a whole company's month in one press** — "Auto Generate": pick the month and the
  company, then optionally narrow to a department, a staff category or a single person, and press
  Generate. It builds the month from each person's own shift group and weekly-off day, which are set
  on their record. One company at a time — there is no "all companies" option.
- **Bringing a roster in from a spreadsheet** — "Excel Import" opens its own page with a **File Format**
  link that downloads the blank template, so you fill in the sheet the system expects. Choose the file
  **or paste the rows straight in from Excel**, then press **Preview** — you look at what is about to
  go in before anything is written.
- **Changing a rostered day afterwards** — Right-clicking a day in the roster is meant to offer Edit
  and Delete. *(In this demo build the menu is wired to nothing, and the roster area itself never had
  rows to try it on.)*

**Things that are true across the whole area**

- **Nothing loads until you ask** — Almost every screen here sits empty until you set your dates and
  press Show or Filter. It never fetches a year of records because you happened to open the page.
- **The same five filters everywhere** — Person, category, company, division, department. Learn them
  once and every screen in Attendance filters the same way.
- **One shape of correction, offered in several places** — The punch form, the leave form, the on-duty
  form and the comp-off form are the same forms whether you reach them from their own screen, from the
  checklist, or from a day on somebody's month. You are never made to learn two versions of the same
  job.
- **Deleting always asks** — Every Delete button on these screens puts up "Do you want to Delete ?"
  first.
