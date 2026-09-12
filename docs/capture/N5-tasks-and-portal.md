# N5 — Global Tasks + My Portal (self-service)

**Site:** Nexeor Agency OS v2.0 — `https://os-staging.product.nexeor.com`
**Captured:** 2026-09-07, signed in as the shared demo account (`demo_om85i@demo.agency`,
displayed name **Little French House**, session role **DEMO**).
**Scope:** the two top-level sidebar items — `/tasks` ("Global Tasks") and `/hr/portal` ("My Portal").

> **Read this first — honesty note on the second screen.** `/tasks` was captured live in the
> browser: every control clicked, every dialog opened, every dropdown listed. **`/hr/portal`
> could NOT be opened with the capture account** — it answers `Access Restricted / User not
> found`, because My Portal requires the signed-in person to have an HR employee record and the
> demo login has none. So the My Portal section below is split in two: what the screen actually
> showed (§2.1, observed), and a complete inventory of what that page renders, read out of the
> page's own shipped JavaScript (§2.2 onward, **labelled `[from code]`, not seen on screen**).
> Nothing in it is guessed — every label, option and endpoint quoted is a literal string in the
> page's own code — but it was not visually confirmed, and layout/order is inferred from render
> order.

**Where both live in the sidebar.** The left rail is: brand block ("Agency OS / NEXEOR"), then
**two standalone items above every group** — **My Portal** (`/hr/portal`) and **Global Tasks**
(`/tasks`) — then the five collapsible groups (Sales, Marketing, Web Projects, Finance, HR), then
**Sign Out** at the bottom. Neither of my two screens has any sub-item.

Entitlement: `GET /api/settings/rbac` returns for this account
`{"superAdmin":false,"fullAccess":false,"permissions":["Sales","Marketing","HR","Web Projects","Finance","Global Tasks"]}`
— so **"Global Tasks" is itself a named permission**, alongside the five group names. "My Portal"
is not in that list; it gates on having an employee record instead.

---

# 1. Task Board — `/tasks`

**Where:** sidebar → **Global Tasks** (top-level, above the groups). No tabs, no sub-pages.

**What you see on arrival.** A full-height, single-screen board that does not scroll vertically.
Top-left: the title **"Task Board"** and the subtitle *"Manage tasks across all projects and
leads."* Top-right, in one row: a **search box** ("Search tasks…" with a magnifier), a
**two-button segmented toggle** (`My Tasks` | `All Tasks`), and a white **`New Task`** button with
a plus icon. Below that, the whole remaining height is **seven fixed columns** side by side
(horizontally scrollable, each 320px wide on desktop). The page footer reads
"POWERED BY NEXEOR • COPYRIGHT © 2026 NEXEOR CREATIVE TECHNOLOGIES".

**Numbers/cards on the page.** There are no KPI tiles. The only numbers are the **per-lane
counts** in each column header. Live values as captured, on `All Tasks`:

| Lane | Status value | Header dot | Count |
|---|---|---|---|
| Backlog | `BACKLOG` | neutral grey | 0 |
| To Do | `TODO` | indigo | 3 |
| In Progress | `IN_PROGRESS` | sky blue | 0 |
| Review | `REVIEW` | amber | 0 |
| Approved | `APPROVED` | emerald | 3 |
| Done | `DONE` | white/faded | 2 |
| Rejected | `REJECTED` | red | 5 |

On `My Tasks` every lane is 0 for this account.

## 1.1 Controls, in the order they appear

1. **Search box** ("Search tasks…") — filters the board. **Server-side**: typing re-requests
   `GET /api/tasks?filter=<mine|all>&search=<text>` after a **300 ms debounce**. Typing `BUG`
   narrowed the board to the four `BUG-86 …` tasks (To Do 1, Approved 1, Done 1, Rejected 1).
   A no-match term leaves all seven lanes showing "No tasks".
2. **`My Tasks`** (default, selected) — requests `GET /api/tasks?filter=mine`.
3. **`All Tasks`** — requests `GET /api/tasks?filter=all`.
4. **`New Task`** — **does nothing.** Clicked repeatedly, waited 200 ms / 400 ms / 1 s / 2.5 s:
   no dialog, no drawer, no route change, no console error, no network call. The button carries
   **no click handler at all** — in the page's shipped code it is
   `Button({className:"bg-white text-black…", children:[Plus," New Task"]})` with no `onClick`.
   **There is therefore no create-task form to capture on this screen.** (The page does hold the
   state a create form would need — a "selected lane" value initialised to `BACKLOG` — so the
   form looks unfinished rather than deliberately absent.)
5. **A `+` button in every lane header** (7 of them) — **also does nothing**, same reason: no
   click handler in the code. Presumably intended as "add a task straight into this lane".
6. **Every task card** — opens the **task detail drawer** (§1.3). This is the only working
   control on the board besides search and the two view buttons.

**Filters, sorting, grouping, bulk-select: none of these exist on this screen.** No client
dropdown, no assignee/client/project filter, no sort control, no grouping control, no checkboxes
on cards, no bulk action bar. (Marketing ▸ Tasks, a different screen, does have such filters —
see §1.6.) The grouping is fixed: always by status, always these seven lanes.

**View switches: there is only one view.** No list / board / calendar switcher. It is a board,
always.

**Drag and drop: not supported.** Cards have no `draggable` attribute and no drag handlers; lanes
have no drop handlers. A task is moved between lanes only by changing **Status** inside the
detail drawer.

## 1.2 The task card — every element

Each card is a dark rounded tile with an indigo hover glow. Top to bottom:

- **Breadcrumb line** (tiny, uppercase, indigo, with a small square icon): `<Client> / <Project>`
  — e.g. `VELOCITY FITNESS / Q2 DIGITAL RETAINER`. Truncated at 150px.
- **Title** — up to 2 lines, then clipped.
- **Bottom row, left:** a **priority letter badge** — the *first letter of the priority value*:
  `L` (Low), `M` (Medium), `H` (High), `U` (Urgent). Colours: **High = rose, Medium = amber,
  everything else = plain grey** — which means **P0 Urgent renders in the same faint grey as P3
  Low** and reads as less urgent than P1 High.
- **Bottom row, next to it:** the **due date** with a clock icon, formatted `Jun 16`. Coloured
  **rose + bold when the date is in the past and the status is not `DONE`**, otherwise faint grey.
- **Bottom row, right:** the **assignee avatar** — an indigo circle with the first letter of the
  name, and the full name in a hover tooltip (`title="Navaneeth B"`). **Unassigned** shows a
  dashed-outline circle with a small `+` inside.

**Not on the card:** no checklist counter, no comment count, no attachment count, no label/tag
chips, no client logo, no time-logged figure. (The API does return `_count.comments`,
`_count.attachments` and `totalTimeLogged` per task — the card just doesn't render them.)

## 1.3 The task detail drawer — every field, tab and action

Opened by clicking any card. A **right-hand drawer** over a blurred black backdrop (full height,
slides in from the right). **It has no tabs** — it is one continuous scrolling column.

**Closing it:** the **✕** button, or **clicking the dark backdrop**. **The Escape key does not
close it** (tested — the drawer stayed open and kept swallowing clicks).

**Header row:** the breadcrumb as a **link** — `Velocity Fitness / Q2 Digital Retainer` →
`/marketing/projects/<projectId>` — then three icon buttons on the right:

| Icon | What it does |
|---|---|
| 🔗 link | Copies a link to the task. **No toast, no message, no visible confirmation of any kind.** |
| 🗑 trash | Deletes the task. **Described only — not clicked.** |
| ✕ | Closes the drawer. |

**Then the editable body**, in order:

1. **Task title** — a 2-row textarea, placeholder "Task Title…", pre-filled with the title.
2. **STATUS** — a dropdown. **All 10 options** (value → label):
   `BACKLOG`→Backlog · `TODO`→To Do · `IN_PROGRESS`→In Progress · `REVIEW`→**Internal Review** ·
   `CLIENT_APPROVAL`→**Client Approval** · `APPROVED`→Approved · `PUBLISHED`→**Published** ·
   `SCHEDULED`→**Scheduled** · `DONE`→Done · `REJECTED`→Rejected.
   Note the drawer offers **10 statuses while the board has only 7 lanes** (§1.5).
3. **PRIORITY** — a dropdown, 4 options: `LOW`→P3 Low · `MEDIUM`→P2 Med · `HIGH`→P1 High ·
   `URGENT`→P0 Urgent.
4. **PLATFORMS** — a button showing the current selection (e.g. `YOUTUBE`, or the placeholder
   **"Select platforms…"** when empty) with a chevron; it opens a multi-select popover. **All 7
   options:** `INSTAGRAM · LINKEDIN · TIKTOK · FACEBOOK · TWITTER · YOUTUBE · PINTEREST`.
   (Opened and read; no option was clicked.)
5. **ASSIGNEE** — a dropdown. **All 27 options**, in this order: **Unassigned** (empty value),
   Admin, Amal Vijayakumar, Antra Agrawal, Chris george, Deep Sheth, Dhrumil Gadaria, Emaad
   Sultan, Ganesh S N, Gokulakrishnan R, Info Nexeor, Kartik Kittad, Kevin Norbert, Kingson
   Thomas, Mathangi Chandu, Megha M, Navaneeth B, Rayan Patel, Rohit Vinod, Sandra KK,
   Swathikrishna U S, Syeda Umme Kulsum, Test Demo, abcd, akhila kr, ritika, xyz.
   (The list is fetched per task from `/api/crm/users` and `/api/crm/users?module=Marketing`.)
6. **CAMPAIGN** — a dropdown. **All 4 options:** **Standalone** (empty value), Phase 1 Awareness
   Surge, Phase 2 Awareness Surge, Phase 3 Awareness Surge.
7. **POST TYPE** — a dropdown, 5 options: `REEL`→Reel · `STORY`→Story · `CAROUSEL`→Carousel ·
   `STATIC_IMAGE`→Static · `ARTICLE`→Article.
8. **INTERNAL DUE** — a date field.
9. **GO-LIVE DATE** — a date field.
10. **PUBLISHED URL** — a text field, placeholder `https://…`. **Only rendered when the task has
    at least one platform selected** (see §1.4).
11. **EXECUTIVE BRIEF** — a textarea, placeholder *"Creative brief, design notes, or strategic
    instructions…"*.
12. **SOCIAL CAPTION** — a textarea, placeholder *"Final caption text, hashtags, and mentions…"*,
    with a live **`0 / 5000`** character counter. **Also only when a platform is selected.**
13. **CREATIVE ASSETS** — a drop zone: *"Drop files or click to upload"*. The heading carries a
    **count badge** when files exist (e.g. `CREATIVE ASSETS 1`) plus a **`DOWNLOAD ALL`** button.
    Each attached file row has four icon buttons: **✕ (remove)**, **👁 (preview)**,
    **⬇ (download)**, **🗑 (delete)**. Accepted types (from the file input):
    `image/*`, `video/*`, `application/pdf`, `.pdf .doc .docx .xls .xlsx .ppt .pptx .ai .psd .svg
    .zip .rar`; multiple files allowed.
14. **ACTIVITY & DISCUSSION** — a combined comment thread *and* audit history, oldest first. Six
    kinds of entry were observed:
    - **field change** — who, when, then `FIELD  old → new`. Seen for **ASSIGNEE, STATUS, POST
      TYPE, INTERNAL DUE DATE, MEDIA ASSET**.
    - **`MOVED`** — a lane move, e.g. `MOVED  REVIEW → REJECTED`.
    - **comment** — the author, the time, the text.
    - a plain-English echo of a comment, e.g. *Commented on task "Nexus Dynamics - STORY
      content": vhjvgj…*
    - **file upload** — `1 file / KARTIK KITTAD UPLOADED / nexeor-logo.png / 268.0 KB`.
    - **time logged** — e.g. **`59m time logged`**. So time *is* recorded against tasks, but this
      drawer only *shows* it; there is no start/stop timer or "log time" control here.
15. **Footer bar** (sticky, bottom of the drawer):
    - a **gate hint** — observed: **"ADD AT LEAST ONE ASSET TO SUBMIT FOR REVIEW"** (shown on
      tasks with no attachments).
    - a **comment box**, placeholder *"Comment or @mention…"*.
    - an **attach-files button** (`title="Attach files"`, same accepted types as above).
    - a **send button**, **disabled while the comment box is empty**.

**No subtasks, no dependencies, no checklist, no labels/tags, no estimate field, no recurrence,
no watchers, no "duplicate", no "move to project"** anywhere in this drawer.

**Saving.** Every control is a live field; there is no Save button. Closing the drawer refetches
the board, so a change made in the drawer is reflected in the lanes. *(Inferred from the drawer's
`onUpdate` refetch — no field was changed.)*

## 1.4 Which sections appear depends on the task — measured

Five tasks were opened. The rule: **`PUBLISHED URL` and `SOCIAL CAPTION` render only when the
task has at least one platform selected.** Everything else is always present.

| Task | Status | Post type | Platforms | Published URL? | Social Caption? | Assets |
|---|---|---|---|---|---|---|
| Expert Interview Series | To Do | Reel | YOUTUBE | yes | yes | 0 |
| BUG-86 Approved overdue | Approved | Static | *none* | **no** | **no** | 0 |
| Brand Story & Mission | Done | Reel | LINKEDIN | yes | yes | 0 |
| Nexus Dynamics - STORY content | Rejected | Reel | *none* | **no** | **no** | 0 |
| achu | Rejected | Static | *none* | **no** | **no** | 0 |
| Viral Challenge Participation | Rejected | Reel | TIKTOK | yes | yes | **1** |

## 1.5 Empty state, and what the board hides

**Empty state.** Every lane with nothing in it shows a dashed-border box reading **"No tasks"**.
On `My Tasks` for this account **all seven lanes** show it — `GET /api/tasks?filter=mine`
returned 0 records, because no task is assigned to the demo user. There is no page-level "you're
all clear" illustration; the seven empty lanes *are* the empty state.

**Tasks in a status with no lane are silently invisible.** `filter=all` returned **15** task
records, but the board rendered only **13** cards. The seven lanes are a hard-coded list and
tasks are bucketed by exact status match, so the 2 records whose status was `CHANGES_REQUESTED`
(1) and `PUBLISHED` (1) appear in **no lane at all** and cannot be reached from this screen. The
same would apply to `SCHEDULED`, `CLIENT_APPROVAL`, `DRAFTING` and `DESIGN` — statuses that exist
in the data (§1.6) but have no lane.

**Realtime / auto-refresh: none.** With the board left open and untouched for **50 seconds**,
**zero** network requests were made. Nothing polls, nothing refreshes on its own, no websocket.
The board reloads only when you change the view toggle, type in the search box, or close the
drawer after an edit.

**Deep links: not supported.** `/tasks?task=<id>` loads the board with the drawer **closed** —
the query is ignored. So the 🔗 copy-link button's link cannot be opened on this screen.

**At 390px (phone).** The seven columns become a **horizontally scrollable row of pills** —
`Backlog (0) · To Do (3) · In Progress (0) · Review (0) · Approved (3) · Done (2) · Rejected (5)`
— each with its lane dot; **one lane's column shows at a time** below them, and tapping a pill
switches lane. The header wraps: search on its own line, then the toggle and `New Task`. Nothing
overflows the viewport (page width stayed exactly 390px). The sidebar collapses off-screen.

## 1.6 Is this the same task data as Marketing ▸ Tasks and Web Projects ▸ My Work?

**Answer: Global Tasks and Marketing ▸ Tasks are ONE task system. Web Projects ▸ My Work is a
different system.** Evidence, all measured this session:

**Global Tasks ↔ Marketing ▸ Tasks — the same table, the same API, the same records:**

- **Same endpoint.** `/tasks` calls `GET /api/tasks?filter=mine|all`. `/marketing/tasks` calls
  `GET /api/tasks?filter=all&source=marketing&limit=30` — the *same* route, plus a `source`
  parameter.
- **Same record shape.** Both responses return objects with an identical 26 fields: `id,
  createdAt, updatedAt, title, description, startDate, dueDate, publishDate, status, priority,
  postType, caption, publishedUrl, createdById, assignedToId, leadId, projectId, campaignId,
  clientId, platforms, assignedTo, project, lead, attachments, _count, totalTimeLogged`.
- **The record sets overlap exactly, one inside the other.** `?filter=all` → **15** records;
  `?filter=all&source=marketing&limit=200` → **50** records; **overlap = 15; records in the
  Global set that are NOT in the marketing set = 0.** Global Tasks is a strict subset.
- **The same individual tasks appear on both** — e.g. "Expert Interview Series" and "BUG-86
  Active overdue" are on both screens.
- **The fields are marketing fields.** The Global Tasks drawer edits post type, platforms,
  go-live date, social caption and published URL, and its breadcrumb links to
  `/marketing/projects/<id>`. It is the marketing content record, shown on a company-wide board.
- **Why the counts differ:** Global Tasks passes no `source` and returns a narrower default
  slice (15 of 50), then drops any task whose status has no lane (§1.5). Marketing ▸ Tasks shows
  statuses Global Tasks has no lane for — its data contains `TODO 16, APPROVED 7, REJECTED 5,
  IN_PROGRESS 5, BACKLOG 4, CHANGES_REQUESTED 3, DONE 3, REVIEW 2, DRAFTING 2, PUBLISHED 2,
  DESIGN 1`. So **Global Tasks is a partial window onto the marketing task table, not a
  different list.**

**Web Projects ▸ My Work — a separate system:**

- **Different endpoint:** `GET /api/projects/my-work` (not `/api/tasks`).
- **Different record type:** it returns `{ issues: [...], columns: [...] }` — **"issues"**, not
  tasks.
- **Its own column set, hard-coded in the response:** `Backlog · Todo · In Progress · In Review ·
  staging · Done` — six columns, different names and different colours from the task board's
  seven.
- For this account it was empty: *"My Work — Everything assigned to you across all web projects.
  0 open."*, a **`Show completed`** toggle, and the empty state **"All clear / Nothing assigned
  to you right now."**

So: **two task systems, not three.** Marketing tasks (shared by Global Tasks and Marketing ▸
Tasks) and Web Projects issues. N6 and N7 have the detail of the other two screens.

## 1.7 Odd things I noticed — `/tasks`

- The **`New Task` button does nothing.** There is no way to create a task from the screen whose
  whole purpose is company-wide tasks.
- The **`+` button in each of the 7 lane headers does nothing** either.
- **Two of the 15 tasks the screen fetched are not shown anywhere on it**, because their status
  has no lane — and there is no "other"/overflow lane and no count of what was dropped.
- **The drawer offers 10 statuses but the board has 7 lanes** — setting a task to Published,
  Scheduled or Client Approval from the drawer makes it vanish from the board.
- **Escape does not close the detail drawer** (the backdrop and ✕ do).
- The **🔗 copy-link button gives no confirmation**, and the link it copies (`?task=<id>`) is
  **ignored** when opened — the drawer does not reopen from a URL.
- **P0 Urgent's badge is faint grey**, the same as P3 Low; only P1 High (rose) and P2 Med (amber)
  are coloured, so the most urgent priority is the least visible.
- The card shows **no comment or attachment count** even though the API returns both.
- The subtitle says *"across all projects **and leads**"*, but all 15 records had a project and
  **none** had a lead.

---

# 2. My Portal — `/hr/portal`

**Where:** sidebar → **My Portal** (top-level, above the groups). This is the self-service
screen: what one employee sees and can do about **their own** record.

## 2.1 What the screen actually showed — observed

With the capture account it renders a full-page centred gate, on black:

- an icon,
- **`Access Restricted`** (heading),
- **`User not found`** (subtext),
- a single outlined **`Sign Out`** button.

The sidebar still renders around it. The page does make its normal calls first —
`GET /api/hr/portal` and `GET /api/hr/portal?activitiesOnly=true&date=2026-09-07` — and both
answer **404 `{"error":"User not found"}`**. The account holds the `HR` permission but has no
employee record, and My Portal is keyed to the employee record, not to the permission. **So the
portal itself was never displayed. Nothing below this line was seen on screen.**

## 2.2 `[from code]` What My Portal renders — layout

*Everything from here on is read from the page's own shipped JavaScript (one page module,
`/hr/portal`), so the labels, options and endpoints are exact; the visual layout is inferred from
render order and was not observed.*

A single long scrolling page on black, no tabs:

- **A gradient hero banner** (emerald → sky) with the small label **`NEXEOR PORTAL`** top-left
  and a ghost **`Sign Out`** button top-right.
- **The person's identity block**: a circular avatar of their initials, an `h1` of
  **First Last**, and a subtitle **`<designation> • <department>`** (falling back to
  `Employee • Nexeor`).
- **A GitHub row**, shown only to admins and technical teams (§2.11): either
  **`@username ✓`** linking to `github.com/<username>` with a `?` hint reading
  **"Request admin to disconnect"**, or a **`Connect GitHub`** link to
  `/api/auth/github/connect`.
- **Three action buttons**: **`Log Time`** (toggles to `Close`), **`Request Leave`**,
  **`Expenses`**. Labelled on desktop; icon-only on smaller widths (a timer, a calendar-clock and
  a receipt), with a floating variant on phones.
- **Four KPI tiles**, then **the attendance calendar**, then the cards listed in §2.5–§2.10.

## 2.3 `[from code]` Numbers/cards on the page — the four tiles

| Tile | What it counts |
|---|---|
| **Leaves Approved** | the person's leave requests with status `APPROVED` |
| **Leaves Pending** | their leave requests with status `PENDING` |
| **Payrolls Received** | how many payroll lines exist for them |
| **Confirmed Upcoming Holidays** | future company holidays that are either national **or** an optional one they have locked in |

## 2.4 `[from code]` Personal Attendance Calendar

Heading **` Personal Attendance Calendar`**. A month grid: **‹** back, a middle button showing
the month ("September 2026") that **jumps back to today** when clicked, **›** forward. Weekday
headers **Sun Mon Tue Wed Thu Fri Sat**; 42 day cells.

Each day cell can carry up to four chips (and tiny colour dots instead, on narrow screens):

- **a holiday chip** — the holiday's name; **emerald** if it is a national holiday, **rose with a
  ✓** if it is an optional holiday this person chose, **grey and struck through** if it is an
  optional holiday they did not choose.
- **`<n>h HR`** — hours logged through HR time tracking that day (timer icon).
- **`<h>h <m>m Mktg`** — time logged against marketing tasks that day (clock icon).
- **`Leave`** — with **`(0.5)`** appended for a half day.

**Clicking a day** opens a panel below: **`Entries for <Weekday, Month D>`** with the day's total
hours (e.g. `4.5h`) and the list of that day's time entries, each with **Edit** and **Delete**
icon buttons. Empty: **"No time entries for this day."**

**Attendance is view-only here. There is no clock-in / clock-out / check-in / punch control
anywhere on this page** — no such string or control exists in the page's code. An employee sees
their attendance; they do not mark it from My Portal.

## 2.5 `[from code]` Leave — the request form and the history

**`Request Leave`** opens a dialog titled **`Leave Request Portal`**, subtitle *"Officially
submit your leave requests securely."*, laid out as three numbered steps:

**`1. Leave Modality`** — 3 choices: `PTO`→**Annual Leave / PTO** · `SICK`→**Sick Leave** ·
`UNPAID`→**Unpaid Leave**.

**`2. Duration Type`** — 3 choices: `SINGLE`→**Single Day Leave** · `MULTIPLE`→**Multiple Days** ·
`HALF`→**Half Day Leave**. The date fields follow the choice: **Multiple Days** shows
**`First Day`** + **`Last Day`**; Single/Half shows one **`Exact Date`**.

**`3. Mandatory Reason / Notes`** — a textarea, placeholder *"Please provide explicit details for
HR review…"*. **Required**: submitting empty gives *"Please provide an explicit reason for your
request."*

**Live policy warnings** above the buttons, driven by
`GET /api/public/attendance/policy?employeeId=…&month=…&year=…`:
- *"Monthly allowance of `<n>` paid leaves exceeded. `<n>` taken. Salary deductions possible."*
- *"Monthly allowance of `<n>` sick leaves exceeded. `<n>` taken. Salary deductions possible."*
- *"Medical certificate required for extended sick leave."* (when a sick request runs past the
  policy's certificate threshold) — appended as *"Medical certificate required."* if another
  warning is already showing.

**Buttons:** **Cancel** and submit. Submitting POSTs to `/api/public/attendance`; success shows
*"Your request was submitted and recorded successfully."* and prepends the request to the list.
Failures: *"Failed to submit request."* / *"An error occurred. Please contact HR."*
**This form was described only — nothing was submitted.**

**The history card** — heading **` All historical requested leaves`**, a table with **5 columns**:
**Date Range** (`start → end`, one date if same day) · **Type** · **Duration** (`Full Day` /
`Half Day`) · **Reason** (`—` when blank) · **Status** (a coloured pill). Empty state:
**"No leaves have been requested yet."**

## 2.6 `[from code]` Log Time — the form

**`Log Time`** expands a panel titled **`Log Working Hours`**, subtitle *"Record your time against
active projects"*, with an ✕ to close. Fields:

| Field | Type | Notes |
|---|---|---|
| **Date\*** | date | required |
| **Project\*** | custom two-level picker | required. Projects grouped by category; each group is a collapsible row with a count; each project shows **`Name — Client`**; a tick marks the chosen one. Placeholder **"Select project…"**, loading state **"Loading projects…"**. Fed by `/api/projects`. |
| **Task** | dropdown | shown only to admins and non-marketing/sales departments. **All 10 options:** Development · Design · Project Management · Code Review · QA & Testing · Bug Fix · Documentation · Planning · Research · Other. For marketing/sales people the field is hidden and the task is recorded as **`General`**. |
| **Hours\*** | number | required; `step 0.25`, min 0, max 24, placeholder **"e.g. 4.5"** |
| **Notes** | text | placeholder **"Optional"** |

Saves with `POST /api/hr/time-tracking`. Editing a day's entry opens **`Edit Time Entry`** with
**Hours · Project · Task · Notes**, and **Cancel** / **`Save Changes`** (`PATCH`); deleting uses
`DELETE /api/hr/time-tracking?id=…`.

## 2.7 `[from code]` Expenses — the form

**`Expenses`** opens **`Submit Expense`**, carrying its own banner: **"UI only - backend
connection pending. Finance approval required before payout."** Fields, in order:

| Field | Type | Options / notes |
|---|---|---|
| **Expense Category \*** | dropdown | **7:** Software Subscription · Marketing Expense · Travel Expense · Office Expense · Vendor Payment · Client Related Expense · Other |
| **Other Category \*** | text | only when Category = Other; placeholder *"Describe the expense category"* |
| **Description \*** | textarea | placeholder *"Example: Google Workspace Monthly Subscription"* |
| **Amount Spent \*** | number | placeholder `0.00`, with a currency dropdown — **3:** AED · INR · USD |
| **Date of Expenditure \*** | date | defaults to today |
| **Paid By \*** | dropdown | **4:** Employee · Company · Client · Other |
| **Paid By Other \*** | text | only when Paid By = Other; placeholder *"Enter who paid for this expense"* |
| **Claimant / Submitted By \*** | text | |
| **Responsible Person / Team** | text | placeholder *"Example: Finance team, Accounts, Project owner"* |
| **Payment Method** | dropdown | **4:** Credit Card · Debit Card · Bank Transfer · Cash |
| **Department / Project** | dropdown | **5:** Marketing · Development · Accounts · Finance · HR — placeholder *"Select department or project"* |
| **Bill / Receipt Attachment \*** | file upload | *"Upload PDF, JPG or PNG receipts"*, *"Multiple attachments supported"*, **Remove file** per file; uploads via `/api/upload` |
| **Recurring Expense** | checkbox | *"Use for subscriptions and repeated operational expenses."* |
| **Recurring Frequency** | dropdown | only when recurring — **3:** Monthly · Quarterly · Yearly |

Buttons: **Reset** · **Cancel** · submit → `POST /api/hr/expenses`, with the progress line
*"Submitting for approval…"* and outcomes *"Expense submitted for approval."* /
*"Attachment upload failed"* / *"Submission failed. Please try again."*
**Described only — nothing was submitted.**

## 2.8 `[from code]` Processed Payrolls, and Download Payslips

Card heading **` Processed Payrolls`**, with a **`Bulk Download`** button when there is at least
one payroll line. Each row shows **`<Month> Payroll`**, **`Dispensed <date>`**, **`TXN: <id>`**
when a transaction id exists, the **net amount + currency** (default `AED`), **`−<amount> ded.`**
when there were deductions, and a **download icon** per row that fetches
`/api/hr/portal/payslip?lineId=…` and saves **`Payslip_<Month>.pdf`**.
Empty state: **"No payroll deposits logged."**

**`Bulk Download`** opens **`Download Payslips`** ("Select a date range") with five range
buttons — **1 Month · 3 Months · 6 Months · 1 Year · Custom Range** — and, for Custom,
**`From Month`** and **`To Month`** month pickers. The button reads **` Download Payslips`**, then
**` Generating PDF…`**; it saves **`Payslips_<from>_to_<to>.pdf`** from
`/api/hr/portal/payslip?from=…&to=…`. Guards: *"Please select both start and end months."* and
*"Failed to generate payslips"*.

## 2.9 `[from code]` Activity Log

Heading **` Activity Log`**, with the selected date and **`• <n> entries`**. Each row is a
coloured dot, the entry's own description sentence, the timestamp, and a type label. **All 8
types**, with their dot colours:

| Type | Label shown | Dot |
|---|---|---|
| `TIME_TRACKING` | Time Tracking | emerald |
| `ATTENDANCE_LOG` | Attendance | indigo |
| `STATUS_CHANGE` | Status Change | amber |
| `TASK_CREATED` | Task Created | sky |
| `TASK_COMPLETED` | Task Completed | sky |
| `TASK_UPDATED` | Task Updated | sky |
| `COMMENTED` | Commented | rose |
| `NOTE_ADDED` | Note Added | rose |

Loading: **" Loading activities…"**. Empty: **"No activity on `<D Mon>`"**. It is date-scoped —
refetched per selected day via `/api/hr/portal?activitiesOnly=true&date=…`.

## 2.10 `[from code]` Identity, Resources, Documents, Optional Holidays

- **` Identity Details`** — three read-only rows: **Employee Code** · **Joining Date** (`N/A`
  when blank) · **Employment** (the employment type, de-underscored and lower-cased). **There is
  no profile-edit control on this page** — no name, contact, address, bank or emergency-contact
  field, and nothing editable about the person's own record.
- **` Resources Vault`** — company resources shared with the employee; each row is a link
  (opens in a new tab) with a title, a category and a download icon. Empty:
  **"No resources attached."**
- **` Personal Documents`** — the person's own documents; each row shows the file name, its
  category, a **`✓ Verified`** badge when HR has verified it, and a download icon. Empty:
  **"No personal documents uploaded."** **View and download only — there is no upload control
  for documents on this page.**
- **` Chosen Optional Holidays`** — a counter **`<chosen> / <max> Chosen`** (max defaults to
  **13**), the chosen non-national holidays split into **Upcoming Selected / Upcoming** and
  **Expired Selected / Expired**, capped at 6 with a **"Show all `<n>` selected holidays"**
  expander and a **`Remove <n>`** control. Empty:
  **"You haven't locked in any optional dates yet."**
  A **`Select Optional Holidays`** dialog offers the still-available optional holidays —
  *"You can select up to `<n>`"*, a live **`Selected: <n>`**, **Cancel** and **`Lock Selection`**
  (`POST /api/hr/portal/holidays`, then the page reloads). When none are left:
  *"There are no more optional company holidays available to choose from."*

## 2.11 `[from code]` Performance reviews on the portal

A card near the bottom holds two halves:

**`Reviews to give`** — with a **`<n> pending`** count. Empty:
**"Nobody's waiting on feedback from you right now."** Each waiting review has a
**`Give feedback`** button, which opens a review dialog: the employee's avatar and name, the
cycle type · period · *"you're reviewing as **`<relationship>`**"*, and the notice
**"Scores and comments are shared with `<name>` once HR publishes the review, attributed to you
as their manager."** Then, per metric, the metric's name, a **star picker**, and an optional
comment (*"Add context for this score (optional)…"*); then **`Overall comments`** (*"Strengths,
areas to develop, anything the scores don't capture…"*). The footer shows
**`<scored>/<total> metrics scored`** — or **"Submitted — this review is now read-only."** — and
two buttons: **`Save draft`** and **`Submit review`**, with **Submit disabled until every metric
is scored**. Saves via `PUT /api/hr/performance/assignments/<id>`; badges `PENDING` / `SUBMITTED`;
error *"Failed to save"*.

**`My performance reviews`** — the person's own published results: an **`Overall`** score, a
**`Summary from HR`**, and a **Manager** vs **You** score comparison per metric. Empty:
**"No published reviews yet."** / *"Results appear here once HR shares them with you."*
Fed by `/api/hr/performance/my` and `/api/hr/performance/assignments/inbox`.

**Who sees the technical extras.** The **GitHub row** and the **Task** dropdown in Log Time are
shown when the person's role is `ADMIN` or their team/department name contains developer, dev,
engineering, tech, web, qa or pm. The three action buttons themselves (Log Time, Request Leave,
Expenses) are shown to everyone.

## 2.12 `[from code]` What is NOT on My Portal

Worth stating plainly, because the brief asked for them: **no clock-in/clock-out control**, **no
announcements feed**, **no birthdays list**, **no team/company holiday calendar beyond the
optional-holiday picker and the chips on the person's own calendar**, **no leave-balance meter**
(only the approved/pending counts and the over-allowance warnings), **no profile editing**, **no
document upload**, and **no "approvals waiting on you" queue other than the performance reviews
in §2.11**.

## 2.13 Realtime / auto behaviour on My Portal

`[from code]` Nothing polls. The page refetches `/api/hr/portal` after each of its own writes
(time entry saved/deleted, leave submitted), refetches the activity list whenever the selected
calendar day changes, and **fully reloads the page** after locking optional holidays. On the
observed gate screen, no request repeated on its own.

## 2.14 Odd things I noticed — `/hr/portal`

- **The account that can reach the sidebar item cannot open the screen.** "My Portal" is shown to
  a user who holds the `HR` permission but has no employee record; clicking it lands on
  `Access Restricted / User not found`. The only thing to do from there is sign out.
- **The Expenses form says so itself:** *"UI only - backend connection pending."* — the form is
  finished, the payout path is not.
- **Locking optional holidays reloads the whole page** rather than updating the card in place.
- The page's error copy for a failed portal fetch is *"Network fault connecting to portal."*,
  which is what a real user would see for any 4xx/5xx — including the 404 above.

---

# In human language — every feature in this area, as points

- **The company task board** — one screen that shows the company's tasks as seven columns, from
  "Backlog" all the way to "Rejected", so anyone can see what stage each piece of work is at.
  Click "Global Tasks" in the left menu. It is the single place to look at work without going
  into a particular client or project.
- **"My tasks" versus "all tasks"** — a two-button switch at the top right that flips the board
  between only the work assigned to you and everybody's work. Useful for starting your day on
  your own list, then widening out.
- **Search the board** — a search box at the top; type a few letters and every column shrinks to
  the matching tasks. It asks the server each time, so it searches the real list, not just what
  is on screen.
- **A task card that tells you the situation at a glance** — each card shows the client and
  project it belongs to, its title, a one-letter priority badge, its due date, and a small circle
  with the initial of the person responsible (or a dashed empty circle if nobody has it yet). A
  date that has already passed turns red.
- **Open a task and see everything about it** — clicking a card slides in a panel from the right
  with the whole record: its title, its stage, its priority, which social platforms it is for,
  who it is assigned to, which campaign it belongs to, what kind of post it is, its internal
  deadline, its go-live date, the link where it was published, the creative brief, the final
  caption, the files, and the full history. Close it with the ✕ or by clicking the dark area
  beside it.
- **Change a task without leaving the board** — inside that panel every field is editable, so you
  can move a task to a new stage, raise its priority, hand it to someone else, or shift its
  dates, and the board updates when you close it.
- **Ten stages of work for a piece of content** — from Backlog and To Do through In Progress,
  Internal Review, Client Approval, Approved, Published, Scheduled, Done and Rejected. It follows
  a social post from idea to published.
- **Four priority levels** — P3 Low, P2 Medium, P1 High and P0 Urgent, so the team knows what to
  pick up first.
- **Seven social platforms per task** — Instagram, LinkedIn, TikTok, Facebook, Twitter, YouTube
  and Pinterest. A task can be for several at once. Choosing at least one is what makes the
  caption box and the published-link box appear.
- **Five kinds of post** — Reel, Story, Carousel, Static image and Article.
- **Tie a task to a campaign** — leave it standalone or attach it to a campaign phase, so a
  month's push can be seen as one body of work rather than scattered jobs.
- **Two different deadlines on every task** — the internal date the team must have it ready by,
  and the date it actually goes live for the client. That gap is the buffer for review.
- **A brief and a caption in the same place** — one box for the instructions to the person doing
  the work, another for the exact caption and hashtags that will be posted, with a 5,000-character
  counter so nothing gets cut off.
- **Attach the creative work to the task** — drag files onto the task or click to upload: images,
  video, PDFs, Word, Excel, PowerPoint, Illustrator and Photoshop files, and zips. Each file can
  be previewed, downloaded or removed, and there is a "download all" button when several are
  attached.
- **A running history of the task** — every change is written down automatically: who reassigned
  it, who moved it to a new stage, who changed a date, who uploaded a file, and how much time has
  been logged against it. Nobody has to remember what happened.
- **Talk about the work on the work** — a comment box at the bottom of the task panel, with
  @mentions, and the ability to attach a file to a comment. The whole conversation lives on the
  task instead of in chat.
- **A rule that stops work being sent for review too early** — the task tells you "add at least
  one asset to submit for review" when there is nothing attached yet.
- **Copy a link to a task** — one button copies a link to that task so you can paste it to a
  colleague. (Worth knowing: opening that link today lands on the board, not on the task.)
- **Delete a task** — a bin button in the task panel. It is the only destructive control there.
- **The board works on a phone** — the seven columns turn into a row of tappable chips with
  counts, one column at a time, and everything fits a phone screen.
- **What is not there yet, and matters** — the "New Task" button and the little "+" on each
  column do nothing at all, so no task can be created from this screen; and a task parked in a
  stage the board has no column for (like Published) disappears from the board entirely. Both are
  worth fixing before anyone is told to run their day from here.
- **One task list, not two** — the company board and the Marketing task screen are the same
  records from the same place; the board simply shows a narrower slice of them. Web Projects "My
  Work" is genuinely separate: it tracks development issues with its own columns.

*The points below are My Portal. The screen refused the demo login, so these are read from the
page's own code rather than seen working — the labels are exact, the look was not confirmed.*

- **A personal portal for each employee** — one page in the left menu, "My Portal", where a
  person sees their own working life: their attendance, their leave, their payslips, their
  documents, their reviews. It is the employee's side of HR, as opposed to what HR sees about
  everyone.
- **Your own name and role at the top** — a banner with your initials, your name, your job title
  and your department, so it is obvious whose record you are looking at.
- **Four headline numbers** — how many of your leave requests were approved, how many are still
  waiting, how many pay runs you have been paid in, and how many company holidays are coming up
  for you.
- **Your own attendance calendar** — a month grid you can page back and forth through, showing
  for every day: any holiday, how many hours you logged, how much time went to marketing work,
  and whether you were on leave (with half days marked).
- **Click a day to see what you did** — the calendar opens a list of that day's time entries with
  the day's total hours, and lets you correct or remove an entry.
- **Request leave yourself** — a form in three steps: what kind of leave (annual/paid, sick or
  unpaid), how long (one day, several days, or a half day), and a compulsory reason. No reason,
  no request.
- **The form warns you before you overspend your leave** — if the request would take you past
  your monthly allowance it says so, and tells you salary deductions are possible. For a long
  sick leave it tells you a medical certificate will be needed.
- **A full record of every leave you ever asked for** — a table of date range, type, whether it
  was a full or half day, your reason, and where the request stands.
- **Log the hours you worked** — a form for the date, the project (browsable by category, with
  the client's name next to each project), what kind of work it was, how many hours, and a note.
  Hours go in quarter-hour steps up to 24 in a day.
- **The work-type list only appears for the technical teams** — developers, QA, project managers
  and admins pick from a list of ten work types; marketing and sales people just log the hours.
- **Claim an expense** — a full expense form: category, description, amount and currency, the
  date, who paid, who is claiming, who is responsible, how it was paid, which department, and the
  receipt itself (several files allowed). Subscriptions can be marked as recurring monthly,
  quarterly or yearly. Note: the form says its payout side is not connected yet.
- **See every pay run you have been paid in** — each shows the month, the day the money went out,
  the transaction reference, the amount, and any deduction.
- **Download your payslips** — one button per pay run for that month's payslip, plus a bulk
  download that gives you the last month, three months, six months, a year, or any two months you
  choose, as a single PDF.
- **A day-by-day activity log** — an honest record of what the system saw you do: time logged,
  attendance, stage changes, tasks created, updated and finished, comments and notes.
- **Your employment facts in one box** — your employee code, the day you joined, and your kind of
  employment.
- **A shelf of company resources** — documents the company has shared with you, each downloadable.
- **Your own documents, with a verified stamp** — the papers HR holds for you, marked "verified"
  once HR has checked them. You can read and download them here; you cannot upload from this page.
- **Pick your optional holidays and lock them in** — the company offers a set of optional
  holidays; you choose up to a limit (thirteen by default), see how many you have chosen, and
  lock the selection. Your chosen days then appear on your calendar, split into upcoming and past.
- **Give the reviews you owe** — if you manage people, the portal lists the reviews waiting on
  you, with a star rating and a comment per measure plus overall comments. You can save a draft,
  and you cannot submit until every measure is scored. It tells you plainly that your scores will
  be shown to the person once HR publishes them, with your name on them.
- **See your own review results** — your overall score, HR's written summary, and your manager's
  score next to your own for each measure — but only once HR chooses to publish it.
- **Connect your GitHub account** — for developers and admins, a one-click link between the
  portal and a GitHub username. Only an admin can disconnect it again.
- **What the portal deliberately does not do** — you cannot clock in or out from it (attendance
  is something you view, not something you mark), and there is no announcements board, birthday
  list or profile editing on it.
- **One thing worth knowing** — the portal only opens for someone who has an employee record in
  HR. A user without one still sees the menu item, clicks it, and gets a locked screen with
  nothing but a sign-out button.
