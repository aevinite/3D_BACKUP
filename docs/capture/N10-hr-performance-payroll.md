# N10 — Nexeor Agency OS v2.0 — HR part 2: Performance · Recruiting · Resources · Payroll

Captured 2026-09-07 against `https://os-staging.product.nexeor.com`, signed in as the demo
account `demo_om85i@demo.agency` (helper `nexeor({ who: 'N10' })`, one sign-in, session cached).
Scope: 4 sidebar routes. Two extra screens were found *inside* the scope and are captured too
(`/hr/onboarding/pipeline` and `/hr/onboarding/<candidateId>`), so **6 screens** in total.

> **Method note, stated up front for honesty.** Everything below was seen rendered in a real
> browser, except where a heading says **"(read from the shipped page code, not seen rendered)"**.
> That marker appears on exactly two things: the whole of **Performance** (the demo account gets a
> locked screen there — see §1) and the few payroll/recruiting buttons that **write real records**,
> which I describe but did not press. For those I read the product's own published JavaScript
> bundle — the same file the browser downloads — so the field lists, dropdown options and confirm
> wording are the product's literal strings, not a guess.

> ### ⚠️ One thing I did that I should not have — reported before anything else
> `Start New Payroll Run` on `/hr/payroll` looks like a button that opens a "pick a month" dialog.
> It is not. It is a **bare `POST /api/hr/payroll` with no dialog and no confirm** — one click and
> the server had created a **new payroll run for September 2026 with 23 employee lines**, then
> redirected me into it. I did not intend to create a record.
> **I removed it the same session**, using the product's own `Delete Payroll Run` control on that
> one card (its confirm reads *"Are you sure you want to permanently delete this payroll run? This
> will remove all associated payment lines."*). Verified afterwards through the list API: the run
> list is back to its original **4 runs — August 2026, July 2026, Jan 2026, Dec 2025** — and the
> September row is gone. No payment line was ever registered on it, and no other record on the site
> was touched.
> The silver lining, and it is a real one: I got to document a **brand-new, untouched payroll run**
> (§4.3) as well as the two part-paid ones, which is the most complete picture of this screen anyone
> in this exercise will get. The lesson for the owner's own build is in §4.11.

---

## Contents

1. Performance — `/hr/performance`
2. Recruiting — `/hr/onboarding` (label ≠ address)
   - 2.b Candidate Pipeline — `/hr/onboarding/pipeline`
   - 2.c Offer review — `/hr/onboarding/<candidateId>`
3. Resources — `/hr/resources`
4. **Payroll — `/hr/payroll`** and `/hr/payroll/<runId>`
5. Odd things I noticed
6. **In human language — every feature in this area, as points**

---

# 1. Performance — `/hr/performance`

**Where:** left sidebar → **HR** (expandable group) → **Performance**. No tabs above it.
Sidebar label and address match here.

## 1.1 What you see on arrival — the locked screen (seen rendered)

The demo account does **not** get this screen. The whole page area renders one small centred card:

```
HR access required

Your own reviews live in My Portal.
```

- `HR access required` is the `<h1>`/heading.
- `My Portal` is a live link to **`/hr/portal`** (that screen is terminal N5's scope).
- There is **no** sign-out button on this particular locked screen (unlike some others in batch 1) —
  just the message and the one link. The sidebar and footer render normally around it.
- **Numbers/cards:** none. **Controls:** none but the link. **Tabs:** none. **Realtime:** none.

The gate, in the page's own code, is `role === "ADMIN" || fullAccess === true`. The demo account has
neither, so it is shown the message instead of the content. Per the batch-1 note, this is a real,
recordable product behaviour, not a fault. I did not try any other way in.

## 1.2 What the screen IS — (read from the shipped page code, not seen rendered)

The page loads three things on mount: `GET /api/hr/departments`, `GET /api/hr/performance/metrics`,
`GET /api/hr/performance/cycles`.

**Header:** title **Performance**, and under it the strapline
*"Metrics are scored out of 5. A 90° review collects manager feedback every 6 months."*

**Two tabs** (pill buttons, top-right of the header):

| Tab button says | What it shows |
|---|---|
| **Metric library** | The definable scoring criteria, grouped by department |
| **All reviews** | Every review cycle across the company |

**Four number cards, always visible above the tabs:**

| Card label | What it counts |
|---|---|
| **Collecting** | reviews with status `IN_PROGRESS` (amber) |
| **Ready to publish** | reviews with status `COMPLETED` (sky blue) |
| **Overdue** | `IN_PROGRESS` reviews whose due date has passed (red) |
| **Metrics defined** | active metrics, all departments (white) |

### Tab A — "Metric library"

**Left rail — a department picker.** First row is **Company-wide** (with a count of metrics that
have no department); then one row per department from `/api/hr/departments` (on this site:
**Engineering, Human Resources, Marketing**), each with its own count.

**Right panel header** changes with the selection:
- Company-wide → title **"Company-wide metrics"**, note *"Applied to every employee, on top of
  their department's own metrics."*
- A department → title **"<Department> metrics"**, note *"Only used for employees in this
  department."*

**Add-a-metric row** (inline, not a dialog) — three fields and a button:

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| Metric name | text | yes (button does nothing while empty) | empty | placeholder `Metric name — e.g. Code quality`; Enter submits |
| Description | text | no | empty | placeholder `What good looks like (optional)` |
| Weight | number, min 1 | no | `1` | tooltip `Weight in the overall score` |
| **Add** | button | — | — | `POST /api/hr/performance/metrics` |

**The metric list** below — one row per metric, showing:
- **▲ / ▼** tiny arrows on the left (tooltips `Move up` / `Move down`) — reorders the metric within
  its department.
- Metric name; a **`weight ×N`** chip when weight is above 1; an **`ARCHIVED`** chip when inactive
  (the whole row dims to 40% opacity).
- The description underneath, if one was given.
- Three icon buttons on the right:
  - ✏️ `Edit metric` (double-clicking the row does the same),
  - 👁 `Archive (stops appearing on new reviews)` / `Restore` when already archived,
  - 🗑 `Delete metric` → browser confirm: **`Remove "<name>"? Past reviews keep their recorded scores.`**

**Editing a metric in place** swaps the row for name / description / weight inputs plus **Save**
and ✕. Enter saves, Escape cancels. Below the inputs sits the warning
*"Renaming affects future reviews only — reviews already created keep the wording they were written
against."*

**Empty state (metric list):** *"No metrics here yet. Add the first one above."*

### Tab B — "All reviews"

One clickable row per review, each linking to **`/hr/employees/<employeeId>`** (i.e. the review
itself opens on the employee's own record, in terminal N9's screen). Each row shows:

- Employee full name.
- **Cycle type** — one of exactly two: **`90° Review`** or **`180° Review`**.
- The period, formatted `Mon YYYY – Mon YYYY`.
- **`<n>/<n> submitted`** — how many of the invited reviewers have filed.
- **`overdue`** in red with a clock icon, when past due.
- A **status chip**, one of exactly four:

| Chip text | Colour | Internal state |
|---|---|---|
| **Collecting** | amber | `IN_PROGRESS` |
| **Ready to publish** | sky blue | `COMPLETED` |
| **Shared with employee** | green | `SHARED` |
| **Cancelled** | grey | `CANCELLED` |

- A **score pill**, e.g. `4.2/5`, or `—/5` when nothing is scored yet.

**Empty state:** *"No reviews started yet. Open one from an employee's Performance tab."* — which
is the answer to "where is the review form": **a review is created and filled on the employee's
own record, not here.** This screen is the library + the register.

### The rating scale — exact, and the same everywhere in the product

- **Every metric is scored 1–5 whole stars.** The picker is five star buttons, `aria-label`
  `"<n> out of 5"`, with hover preview; the number beside it reads **`n/5`**, or **`Not scored`**
  when empty. There is no half-star, no 1–10, no letter grade, no "N/A".
- Scores display to one decimal (`4.2/5`) once averaged.
- **Colour bands** (used on both the pill and the bar, so a manager reads the verdict by colour):
  ≥ 4.5 green · ≥ 3.5 lime · ≥ 2.5 amber · ≥ 1.5 orange · below that red · not scored → grey.
- **Weight**: each metric carries an integer weight (default 1) that scales its contribution to the
  overall score.

### Who reviews whom

Three reviewer relationships exist, labelled:

| Label shown | Meaning |
|---|---|
| **Manager** | the person's manager |
| **Co-worker** | a peer |
| **Self-assessment** | the employee scoring themselves |

And the two cycle types carry these hints in the product's own words:

| Cycle | Hint text |
|---|---|
| **90° Review** | *"Manager feedback · every 6 months"* |
| **180° Review** | *"Manager + co-workers · once a year"* |

So: a 90° review is manager-only, twice a year. A 180° adds co-workers, once a year. A
self-assessment is a reviewer slot that can be added to either. **There is no 360° option** in this
product — no upward/subordinate review, and no external/client reviewer.

**Reports:** the only reporting on this screen is the four cards + the per-review score pill. There
is no chart, no export, no CSV, no "performance report" document.

---

# 2. Recruiting — `/hr/onboarding`

**Where:** left sidebar → **HR** → **Recruiting**.

## 2.0 The label/address mismatch — recorded as asked

| | |
|---|---|
| Sidebar label | **Recruiting** |
| Actual address | **`/hr/onboarding`** |

When you hover/expand the sidebar item, three sub-links appear underneath it, and their labels
differ from the page's own tab names again:

| Sidebar sub-label | Address | The page's own tab name |
|---|---|---|
| **PIPELINE BOARD** | `/hr/onboarding` | **Board** |
| **OPEN POSITIONS** | `/hr/onboarding?tab=positions` | **Positions** |
| **CANDIDATE PIPELINE** | `/hr/onboarding/pipeline` | *(its own screen, no tab)* |

So the answer to "is this hiring, or new-joiner onboarding, or both" is: **both, and the address
tells you which half came first.** `/hr/onboarding` was built as onboarding, then hiring was built
on top of it and the label was changed to *Recruiting* while the URL stayed. Concretely:

- **`/hr/onboarding`** (Board + Positions) = **hiring**. Job postings, applicants, stages,
  interviews, scorecards.
- **`/hr/onboarding/pipeline`** (Candidate Pipeline) = **new-joiner onboarding + offer letters**.
  Once someone is marked *Hired*, they leave the board and appear here as a candidate who must fill
  a portal form, be verified, and be sent an official offer letter.
- The joining checklist itself lives on the **employee** record (§2.d).

## 2.1 Board tab — what you see on arrival

Top: title **Recruiting**, strapline *"Track candidates through your hiring pipeline"*, and on the
right a two-button segmented switch **Board | Positions** (Board selected, blue).

Second row: a search box **`Search candidates...`**, then three buttons — **Filters**,
**Add Candidate** (solid blue), **Copy Apply Link** (tooltip `Copy application page link`).

Middle: a horizontally scrolling **kanban board of six fixed columns**. On a narrow screen the six
columns collapse to a row of pill buttons (`New Applied (0)`, `Contacted (0)`, …) that switch which
single column is shown.

**Numbers on the page:** each column header carries a live count. On this site:

| Column | Dot colour | Count |
|---|---|---|
| **New Applied** | sky | 0 |
| **Contacted** | amber | 0 |
| **Interview** | violet | 0 |
| **Under Review** | blue | 0 |
| **Hired** | green | **1** |
| **Not Hired** | rose | 0 |

Those six are the complete stage list (internally `NEW_APPLIED`, `CONTACTED`, `INTERVIEW`,
`UNDER_REVIEW`, `HIRED`, `NOT_HIRED`). Every column has its own dashed **+ Add Candidate** button
at the bottom, which opens the same dialog pre-set to that column.

**Empty column:** nothing at all — just the dashed *Add Candidate* button. No "no candidates" text.

**Candidate card** (the one live example, in *Hired*):
```
LinkedIn                    ← source chip, top-left
★★★★★                       ← five stars, filled to the candidate's rating
John  Doe
full stack                  ← the role applied for
53d ago                     ← how long since they applied
```
The card is `draggable="true"` — **drag-and-drop between columns is how a stage is changed.**
I did not drag anything.

**Realtime/auto:** nothing polls. The board reloads after your own action only.

## 2.2 Controls on the Board, in order

| Control | What it does |
|---|---|
| **Board / Positions** switch | swaps the whole body; Positions sets `?tab=positions` in the address |
| **Search candidates…** | filters cards live by name/email as you type |
| **Filters** | opens the filter panel (§2.3) |
| **Add Candidate** | opens the *Add Candidate* dialog (§2.4) |
| **Copy Apply Link** | **copies `https://os-staging.product.nexeor.com/apply` to the clipboard** and the button label flips to **`Copied!`** for ~2s. Verified — I read the clipboard back. This is the company-wide public application page. |
| Card drag | changes stage. **Dragging onto *Hired* triggers the hire dialog (§2.5) — not pressed.** |
| Card click | opens the candidate drawer (§2.6) |

## 2.3 The **Filter Candidates** panel — every option

Panel title **Filter Candidates**. Five filters, each labelled in small caps, plus a **Clear all**
link and a **`Filtered by:`** summary line that appears once something is set.

| Filter | Control | Complete option list |
|---|---|---|
| **POSITION** | dropdown | `All Positions` · `tester l2` *(the live open positions — one on this site)* |
| **DEPARTMENT** | dropdown | `All Departments` · `Engineering` · `Human Resources` · `Marketing` |
| **SOURCE** | dropdown | `All Sources` · `LinkedIn` *(only sources actually used by existing candidates appear)* |
| **MIN RATING** | six buttons | `All` · `1★` · `2★` · `3★` · `4★` · `5★` |
| **APPLIED DATE** | two date inputs with a `→` between | from → to, both empty by default |

The panel's own code also supports two boolean filters — **`Has resume`** and **`Has LinkedIn`** —
which did not render for this account/data.

## 2.4 Dialog: **Add Candidate**

Header **Add Candidate**, subtitle *"Manually add a candidate to the pipeline"*, ✕ top-right.
It is a real `<form>`; the fields, in order:

| # | Label | Type | Required | Default | Options / placeholder |
|---|---|---|---|---|---|
| 1 | **Open Position** | dropdown | no | `Select or type custom...` | `Select or type custom...` · `tester l2 (Engineering)` — i.e. blank + one entry per live position |
| 2 | **First Name \*** | text | **yes** | empty | placeholder `John` |
| 3 | **Last Name \*** | text | **yes** | empty | placeholder `Doe` |
| 4 | **Email \*** | email | **yes** | empty | placeholder `candidate@example.com` |
| 5 | **Phone** | text | no | empty | placeholder `+1 234 567 890` |
| 6 | **Source** | dropdown | no | **`Company Website`** | `Company Website` · `LinkedIn` · `Indeed` · `Referral` · `Walk-in` · `Other` — all six |
| 7 | **Position / Role \*** | text | **yes** | empty | placeholder `e.g. Frontend Developer` |

Buttons: **Cancel** · **Add to Pipeline** (submit — not pressed).
Validation message if a required field is empty: *"Please fill all required fields."*

## 2.5 Dialog: the hire form — (read from the shipped page code, not pressed)

Moving a candidate into **Hired** does not just change a chip; it opens a form that creates an
employee and emails them. Header line: **`Send onboarding link to <name>`**. Fields:

| Label | Type | Required | Notes |
|---|---|---|---|
| **Department \*** | dropdown | yes | placeholder `Select Dept...` |
| **Designation \*** | dropdown | yes | placeholder `Select Role...` |
| **Monthly Comp \*** | currency dropdown + number | yes | currency `AED` (default) · `INR` · `USD`; amount placeholder `20000` |
| **Joining Date \*** | date | yes | |
| **Intern?** | checkbox | no | unticked by default |
| **Intern Role** | text | no | only when *Intern?* is ticked |
| **Intern Duration (Mos)** | number | no | replaces *Probation* when *Intern?* is ticked |
| **Probation (Months)** | number | no | shown when *Intern?* is unticked |
| **Reporting Manager** | dropdown | no | first option **`None / HR`** |

Buttons **Cancel** and the confirm. Validation: *"Please fill department, designation,
compensation, and joining date"*. Failure toast: *"Failed to hire"*.

## 2.6 The candidate drawer (right-hand slide-over)

Opens over the board when a card is clicked; the address stays `/hr/onboarding`. Closed with the ✕
in its top bar. **Escape did not close it** — see §5.

**Top block:**
- Candidate name (h2) and the role under it.
- Two icon buttons top-right: 🗑 `Delete` and ✏️ `Edit`. The delete confirm reads
  **`Permanently delete this applicant? This cannot be undone.`**
- A **stage dropdown** with all six stages: `New Applied` · `Contacted` · `Interview` ·
  `Under Review` · `Hired` · `Not Hired`. Changing it moves the candidate (a write — not touched).
- Three quick actions: an **email** link (`mailto:`), a **call** link (`tel:`), and a
  **Schedule** button (tooltip `Schedule Interview`) → §2.7.
- A green status strip when hired: **`Hired — Onboarding link has been sent`**, with a
  **Resend Link** button beside it (a write — not pressed; its failure message is
  *"Failed to resend onboarding email"*).

**Two tabs inside the drawer: `Application` · `Activity & Notes`.**

### Tab `Application`

- **CANDIDATE RATING** panel:
  - **`HR Screening`** with a star total on the right (live example **`5/5`**), and three
    criteria each with a five-star row and its number:
    | Criterion |
    |---|
    | **Communication** |
    | **Cultural Fit** |
    | **Professionalism** |
  - When interviews have been scored, a second block appears: **`Interview Panel Score`** with a
    violet **`n/5`** pill, a chip per interviewer reading `Firstname: 4/5` or `Firstname: Pending`,
    and a **`View scorecards →`** link that jumps to the *Activity & Notes* tab. Its five criteria
    are a different, longer rubric:
    | Criterion |
    |---|
    | **Technical Skills** |
    | **Problem Solving** |
    | **Communication** |
    | **Teamwork** |
    | **Initiative & Drive** |
  - The panel also shows **`Global Interview Avg: n/5`** and **`<x> of <y> scored`**.
- **CV block.** With no CV: an icon plus **`No resume uploaded`** / *"Candidate did not provide a
  CV"*. With one: a **Resume Preview** with **Resume Fullscreen**, and `View Document` links.
- **CANDIDATE SUMMARY** — five labelled rows: **EMAIL** (mailto link) · **PHONE** (tel link) ·
  **POSITION** · **SOURCE** · **APPLIED** (date).

### Tab `Activity & Notes`

- **INTERVIEW PANEL** — a dropdown **`+ Add interviewer...`** listing every internal user by name.
  On this site, 27 names: Admin, Amal Vijayakumar, Antra Agrawal, Chris george, Deep Sheth,
  Dhrumil Gadaria, Emaad Sultan, Ganesh S N, Gokulakrishnan R, Info Nexeor, Kartik Kittad,
  Kevin Norbert, Kingson Thomas, Mathangi Chandu, Megha M, Navaneeth B, Rayan Patel, Rohit Vinod,
  Sandra KK, Swathikrishna U S, Syeda Umme Kulsum, Test Demo, abcd, akhila kr, ritika, work6, xyz.
  Names already on the panel are removed from the list.
- **Scorecards** — one card per interviewer, with the five-criteria rubric above, a free-text
  **`Add interview feedback...`** box, and **Save Feedback**. Your own card is highlighted violet;
  you can only score your own.
- **INTERNAL NOTES** — a textarea, placeholder `Add internal notes about this candidate...`, and a
  **Save Notes** button (a write — not pressed; failure message *"Failed to save notes"*).
- **ACTIVITY TIMELINE** — an automatic dated trail of every stage the candidate passed through.
  The live example, verbatim:
  ```
  Applied   via LinkedIn   Jul 16
  Contacted                Jul 17
  Interview                Jul 17
  Under Review             Jul 17
  Hired                    Jul 17
  ```
  Nobody types these; the app writes one entry per stage change and records the source on the first.

## 2.7 Dialog: **Schedule Interview** — opened, described, not sent

A big near-full-screen dialog (95vw × 85vh) with a dark grey chrome, opened by **Schedule**.
Top bar: a violet video icon, title **Schedule Interview**, then **Cancel** and
**Schedule & Send** (violet; label becomes `Scheduling...`). I opened it and cancelled.

**Left column (380px) — the form:**

| Field | Type | Default | Options |
|---|---|---|---|
| **(untitled, large)** | text | empty | placeholder **`Interview title`** |
| **DATE** | date | today | |
| **TIME** | time | current-ish | |
| **DURATION** | dropdown | **`30m`** | `15m` · `30m` · `45m` · `1h` · `1.5h` — all five |

Then **INTERVIEW PANEL & GUESTS**, with a live **`<n> invited`** counter:
- A search box **`Search by name or email...`**.
- **INTERNAL TEAM (INTERVIEWERS)** — a tick-list of every internal user with avatar, name and work
  email (the same 27 people; e.g. `Admin admin@nexeor.ae`, `Amal Vijayakumar amal@nexeor.com`).
  Clicking a row ticks/unticks. When searching, the heading gains **`· <n> found`**.
- **EXTERNAL GUESTS** — type a full email address and either press Enter or click the ➕ (tooltip
  **`Add as external guest`**) to invite somebody who is not a user. If a search matches nobody:
  *"No team members match. Type a full email and press Enter to add as external guest."*
- A **Google Meet** row with the note **`Video link added automatically`** — the meeting link is
  created for you, there is nothing to paste.
- A description/notes area (`Add interview feedback...`-style free text) passed as the invite body.

**Right column — a real availability calendar.**
- **Day | Week** toggle (Week widens the dialog to 1400px), a **`GMT+04`** timezone label, a red
  "now" line across today, and 15-minute snapping.
- It calls **`POST /api/integrations/google/calendar/freebusy`** with the invitees' emails and
  paints each person's **busy blocks** on the grid, labelled with their name — so you can see a free
  slot before you pick one.
- The proposed meeting block itself is **draggable** — drag it up/down to change the time, and in
  Week view drag sideways to change the day.

Sending posts to `/api/hr/recruiting/applicants/<id>/schedule-interview` with title, start time,
duration, attendee emails and description. Failure: *"Failed to schedule"*.

## 2.8 Positions tab — `/hr/onboarding?tab=positions`

**What you see:** the Recruiting header is still there; below it a second header —
**Open Positions**, strapline *"Manage job postings and track performance"* — and a
**New Position** button. Then a three-button status filter **Active | Paused | Completed**.

**The table.** Column headers, exactly: **JOB TITLE · CANDIDATES · DATE POSTED · STATUS · LINK**
(plus an unlabelled sixth column holding the expand chevron). No sort controls, no page-size
control, no pagination.

The one live row:
| Job Title | Candidates | Date Posted | Status | Link |
|---|---|---|---|---|
| **tester l2**<br>📍kochin · Engineering | **0** All · **0** New | 1 months ago<br>Aug 4, 2026 | dropdown → `Active` | 🔗 |

- **CANDIDATES** is two counters side by side: **All** and **New**.
- **STATUS** is an editable dropdown right in the row — `Active` (green) · `Paused` (amber) ·
  `Completed` (grey). Changing it writes immediately, so I left it alone.
- **LINK** is an icon button, tooltip **`Copy application link`**.
- The row's title/chevron **opens the position's own detail view** (§2.9).
- Deleting a position confirms with: **`Delete this position? Existing applicants will not be
  affected.`**

**Empty state:** *"No positions created yet. Create your first open position to generate an
application link."*

## 2.9 Position detail (expanded row)

A **Back to positions** link, then the job header: title, an **`OPEN`** badge, and a meta line
`Engineering • kochin • FULL TIME • ₹ 35000`, then `Posted Aug 4, 2026 (1 months ago)`. Top-right:
an **Edit** button (toggles to **Cancel**) and a 🗑 `Delete`.

**Card: `Job Performance`** — dated `Aug 4, 2026 — Today`. Four tiles and three derived rates:

| Tile | Live value |
|---|---|
| **Impressions** | 20 |
| **Clicks** | 20 |
| **Started Applications** | 1 |
| **Applications** | 0 |

`Click rate: 100.0%` · `Start rate: 5.0%` · `Completion rate: 0.0%`

**Card: `Application Link`** — *"Copy source-specific links to track where candidates come from"*.
Shows the canonical link **`https://os-staging.product.nexeor.com/apply/tester-l2`** with **Copy**
and **Preview** buttons, then four one-click tracked variants:

| Button | Link it copies |
|---|---|
| **Indeed Link** | `…/apply/tester-l2?source=indeed` |
| **LinkedIn Link** | `…/apply/tester-l2?source=linkedin` |
| **Website Link** | `…/apply/tester-l2?source=website` |
| **Referral Link** | `…/apply/tester-l2?source=referral` |

**Card: `Job Description`** — the rendered rich text (live example: *"good knowledge in testing"*).

## 2.10 Dialog: **New Position** (and *Edit Position*) — opened, cancelled

It opens inline in the page (not a floating modal), as a `<form>`:

| Label | Type | Required | Default | Options / placeholder |
|---|---|---|---|---|
| **Job Title \*** | text | **yes** | empty | placeholder `e.g. Full Stack Developer` |
| **URL Slug \*** | text with a fixed `/apply/` prefix | **yes** | auto from title | placeholder `full-stack-developer` |
| **Description** | rich-text editor | no | empty | placeholder *"Write a detailed job description — responsibilities, requirements, benefits..."* |
| **Department** | dropdown | no | **`Any`** | `Any` · `Engineering` · `Human Resources` · `Marketing` |
| **Location** | text | no | empty | placeholder `e.g. Remote` |
| **Type** | dropdown | no | **`Full Time`** | `Full Time` · `Part Time` · `Internship` · `Contract` — all four |
| **Currency** | dropdown | no | **`AED (د.إ)`** | `AED (د.إ)` · `INR (₹)` · `USD ($)` · `EUR (€)` · `GBP (£)` — all five |
| **Salary Range** | text | no | empty | placeholder `e.g. 15,000 - 25,000` — free text, not two numbers |
| **Status** | dropdown | no | `Active` | `Active` · `Paused` · `Completed` |

Buttons **Cancel** · **Create Position** (or **Save Changes** when editing).
Validation: *"Title and slug are required"*.

**The description editor's toolbar, every button in order** (all are `title=` tooltips):
`Undo` · `Redo` │ `Bold` · `Italic` · `Underline` · `Strikethrough` │ `Heading 2` · `Heading 3` ·
`Paragraph` │ `Bullet List` · `Numbered List` · `Quote` │ `Divider` · `Insert Link`.
`Insert Link` prompts **`Enter URL:`**. The editing area is ~160px tall and styles H2/H3/lists/
quote/link/rule/code/bold live.

---

# 2.b Candidate Pipeline — `/hr/onboarding/pipeline`

**Where:** sidebar → HR → Recruiting → **CANDIDATE PIPELINE**. Its own page, not a tab.

**What you see on arrival:** title **Candidate Pipeline**, strapline *"Review onboarding forms and
publish official Offer Letters."* Below: a search box and one status dropdown. Then a grid of
candidate cards. No numbers/tiles, no tabs.

**Controls at the top:**
- Search: **`Search candidates by name, email, or role...`**
- Status dropdown — **the complete list, five options**:

| Option shown | Internal |
|---|---|
| **All Statuses** (default) | `ALL` |
| **Awaiting Portal Submit** | `INVITED` |
| **Pending Verification** | `PENDING_VERIFICATION` |
| **Offers Sent** | `OFFER_SENT` |
| **Offers Accepted** | `ACCEPTED` |

**Each card:** name (h3), email, and a 🗑 button top-right, tooltip
**`Permanently Delete Candidate`**, whose confirm reads
**`Are you absolutely sure you want to permanently delete this candidate? This cannot be undone.`**
Then a four-field grid — **Role · Job Type · Department · Expected Start** — then a status chip and
the buttons.

| Status chip seen | Buttons on that card |
|---|---|
| **Invited Form Sent** | **Resend Email** + **Review Profile & Offer** |
| **Needs Verification** | **Review Profile & Offer** only |
| **Offer Sending** | **Review Profile & Offer** only |

**The seven live candidates**, verbatim, because they show the states side by side:

| Name | Email | Role | Job Type | Dept | Expected Start | Status |
|---|---|---|---|---|---|---|
| MEGHA M | megha71bs@gmail.com | Software Engineer | Full Time | Engineering | 7/20/2026 | Invited Form Sent |
| Megha M | megha710sw@gmail.com | Software Engineer | Full Time | Engineering | 7/20/2026 | Invited Form Sent |
| John Doe | john@gmail.com | Marketing Manager | Full Time | Engineering | 7/18/2026 | Invited Form Sent |
| chris g | chrisgeo.facts@gmail.com | Marketing Manager | **Intern** | Engineering | 7/17/2026 | Needs Verification |
| leya xyz | chrisgeorge252@gmail.com | Software Engineer | **Intern** | Engineering | 7/10/2026 | Needs Verification |
| Mock employee U | syedaummekulsum9@gmail.com | Software Engineer | Full Time | Engineering | 6/8/2026 | Offer Sending |
| Mock Employee S | S@gmail.com | Software Engineer | **Intern** | Engineering | 6/8/2026 | Invited Form Sent |

**Empty state:** none rendered (the list is populated). **Realtime:** none; the list reloads on
filter change (`GET /api/hr/candidates?status=…`). **Resend Email** hits
`/api/hr/candidates/<id>/resend` — not pressed.

---

# 2.c Offer review — `/hr/onboarding/<candidateId>`

Reached by **Review Profile & Offer**. Read-only on arrival. I opened two, in different states.

**Header:** **Back to Pipeline** · candidate name · a state badge · email · **`ID: <candidateId>`**
(the raw id is shown on screen). Badges seen: **`NEEDS REVIEW`**, **`OFFER SENT`**; the code also
has **`Verified`**, **`Accepted`** and a **`Promotion`** badge.

**Top-right buttons depend on the state:**

| State | Buttons |
|---|---|
| Needs review | **Generate & Preview Offer** |
| Offer already sent | **Revise & Resend Offer** · **View Offer PDF** |

Both writing buttons were left alone. In the page's own code they go to
`POST /api/hr/candidates/<id>/offer`; the success messages are
*"Offer generated and emailed successfully!"* and *"Revised Offer generated and emailed
successfully!"*, and the preview modal is titled **`Review Generated Offer Letter`** with a
**`Generate Preview`** step and a final **`Confirm & Send Offer`** button. The PDF is served as
**`Offer_Letter.pdf`** in an iframe. Failures: *"Failed to generate preview"* / *"Failed to generate
offer"*.

**Then six read-only cards. Every label, from the two live examples:**

**`Proposed Role`** — DESIGNATION (with an **`INTERN`** chip when applicable) · DEPARTMENT ·
MONTHLY COMPENSATION (e.g. `1,000 AED`, `20,000 AED`) · JOINING DATE · **INTERNSHIP DURATION**
(e.g. `3 Months`, shown only for interns) · REPORTING TO.

**`Bank Details`** — four lines: `Account:` · `Bank:` · `A/C Number:` · `IFSC/Code:`.

**`Personal Information`** — BLOOD GROUP · DATE OF BIRTH · CONTACT · EMERGENCY · MARITAL STATUS.
Missing values render as `—`.

**`Addresses`** — CURRENT ADDRESS · PERMANENT ADDRESS.

**`Offer Notes & Special Conditions`** — with an **Edit Notes** button. Empty text:
*"No special conditions attached."* Saving notes reports *"Notes updated successfully."*

**`Academics & Employment`** — HIGHEST DEGREE (e.g. `Bachelors`, `Masters`) · PREVIOUS EMPLOYMENT
HISTORY, whose empty text is *"Fresh Graduate / No history attached."*

**`Uploaded Documents`** — six fixed slots, each either a **View Document** link or the words
**`Not uploaded`**:

| Slot |
|---|
| **Photo ID** |
| **Govt ID Proof** |
| **PAN / Tax ID** |
| **Resume** |
| **Payslips** *(the candidate's payslips from their previous employer)* |
| **Relieving Letter** |

**Dialog: `Edit Candidate Profile`** — (read from the shipped page code). Note under the title:
*"Update core details. If an offer was already sent, you can regenerate a revised version
afterwards."* Fields: First Name · Last Name · Email · Contact Number · Department (`Select
Department`) · Designation (`Select Designation`) · Monthly Compensation (number + currency
`AED`/`INR`/`USD`/`EUR`) · Joining Date (date) · Reporting Manager (`No Manager Assigned`) ·
Current Address · Permanent Address. Buttons **Cancel** · **Save Changes**, and when an offer was
already out, **Prepare Revised Offer**, which adds a **`Notes for Email (Optional)`** box —
*"Let the candidate know what changed in this revised offer letter."*, placeholder *"e.g. Updated
your permanent address and contact number as you requested."* Success: *"Candidate profile updated
successfully."*

---

# 2.d The joining checklist — every item

The checklist is not on the recruiting screens; it is carried on the **employee** record (it comes
back inside the payroll API payload as `onboardingTasks`, which is how I read it without touching
anything). **Seven fixed items, in order:**

| # | Item as shown |
|---|---|
| 1 | **Create Workspace Email** |
| 2 | **Send Onboarding Email with Handbook** |
| 3 | **Add to Slack Workspace** |
| 4 | **Send Agency OS Invite Link** |
| 5 | **Sign Non-Disclosure Agreement (NDA)** |
| 6 | **Submit Bank Details for Payroll** |
| 7 | **Acknowledge Code of Conduct** |

Each is a simple tick (`completed: true/false`). The list is the same seven for everybody — there is
no per-role or per-department checklist, and no way to add an eighth item.

---

# 3. Resources — `/hr/resources`

**Where:** sidebar → **HR** → **Resources**.

**What you see on arrival:** an amber book icon and the title **Company Resources**, then the
strapline *"Centrally manage handbooks, policies, and vital employee documentation. Items uploaded
here are immediately synchronized to all Employee Portals globally."* On the right, one amber
button **Publish Resource**. Below it, a single card with a thin amber gradient bar along its top
containing the list.

**What a "resource" is here — plainly: a titled, categorised LINK.** Not an upload. There is no
file input anywhere on this screen; the only content field is an external URL (placeholder
`https://drive.google.com/...`). So it is a **link directory of company documents** — you keep the
handbook in Drive and publish a pointer to it.

**Numbers/cards on the page:** none. **Tabs:** none. **Search/filter/sort/pagination:** none.
**Realtime:** none — one `GET /api/hr/resources` on load.

**Empty state (this is what it shows today):** a dashed box with a shield icon and, in italics,
**`The Resource Vault is currently empty.`** While loading it reads **`Loading Resources Engine...`**

**A populated row** (from the page's own code) shows: a file icon; the **title**; a small
**amber category chip**; a `• <date created>`; an **External Link** link that opens the URL in a new
tab; and a 🗑 button, tooltip **`Destroy Resource`**, whose confirm reads
**`Remove this resource? It will be immediately inaccessible in Employee Portals.`**

## Dialog: **Publish Central Resource**

Opened and cancelled live. Header **Publish Central Resource** with the sub-label
**`GLOBAL DISTRIBUTION`**. The three field labels render in small caps: **`RESOURCE TITLE`**,
**`SECURITY CATEGORY`**, **`EXTERNAL CONTENT URI`**. Cancel closes it cleanly.

| Label | Type | Required | Default | Options / placeholder |
|---|---|---|---|---|
| **Resource Title** | text | **yes** — empty gives the alert *"Title is mandatory"* | empty | placeholder `e.g. Employee Code of Conduct 2026` |
| **Security Category** | dropdown | no | **`General Policy`** | **all four:** `General Policy` (GENERAL) · `IT & Security Configuration` (IT) · `Hardware Matrix` (HARDWARE) · `Legal Compliance` (COMPLIANCE) |
| **External Content URI** | text | no | empty | placeholder `https://drive.google.com/...` |

There is a fourth value in the form's state — `icon`, fixed at `Book` — with **no control on the
dialog**, so every resource shows the same icon.

Buttons: **Cancel** · **Publish to Portal** (label becomes `Publishing...`). Failure alert:
*"Failed to save resource."* Not pressed, and **nothing was uploaded.**

## Permissions — who can see what

Honest answer: **the screen has no per-resource permission control at all.** Its own promise is the
opposite — *"immediately synchronized to all **Employee Portals globally**"*, and deleting one makes
it *"immediately inaccessible in Employee Portals"*. So a published resource is visible to
**every** employee; the four categories are labels for the reader, not access levels, despite the
field being called *Security Category*. The only gate is on the publishing screen itself: reaching
`/hr/resources` needs HR access, and the employee side is read-only through
`/hr/portal` (N5's scope).

---

# 4. Payroll — `/hr/payroll`

**Where:** sidebar → **HR** → **Payroll**. Label and address match.
*(Separately, the **Finance** sidebar group also lists a "Payroll" item under its Operations
sub-heading — a different screen, in terminal N8's scope. Worth knowing they are not the same.)*

## 4.1 What you see on arrival

A blue-tinted banner card across the top: credit-card icon, title **Payroll Management**, strapline
**"Generate monthly payruns and register manual bank transfers."**, and on the right one blue
button **Start New Payroll Run**. Below the banner, a responsive grid (1 / 2 / 3 columns) of
**one card per payroll run**, newest first. No tabs, no search, no filter, no sort, no pagination.

That strapline is the whole design in nine words: this screen **generates a run** and **records
transfers you made in your bank by hand**. It does not pay anybody.

## 4.2 The run cards — every figure

Each card links to `/hr/payroll/<runId>` and shows:

- A **calendar icon**, or a **green tick icon** when the run is fully paid.
- A **status chip**, top-right, whose text is computed:
  | Condition | Chip text |
  |---|---|
  | every line paid | **`Completed`** |
  | some lines paid | **`<paid>/<total> Paid`** e.g. `1/23 Paid` |
  | none paid | the run's own stored status, i.e. **`Draft`** |
- A 🗑 button beside the chip (hidden until hover on desktop, always visible on mobile), tooltip
  **`Delete Payroll Run`**.
- The **month** as a big heading, e.g. `August 2026`.
- The **creation date** in mono small-caps, e.g. `8/13/2026`.
- A **progress bar** = paid lines ÷ total lines.
- Bottom row: **`<n> Employees`**; **`−<n> deductions`** in red *only when deductions exist*; and
  the money — **`AED <totalNet>`** with **`(INR <converted>)`** underneath.

**The four live runs, exactly as they read:**

| Card | Chip | Created | Employees | Total | INR line |
|---|---|---|---|---|---|
| **August 2026** | `1/23 Paid` | 8/13/2026 | 23 Employees | AED 10,267,785 | (INR 264,297,806) |
| **July 2026** | `1/21 Paid` | 7/17/2026 | 21 Employees | AED 268,601 | (INR 6,913,921) |
| **Jan 2026** | `COMPLETED` | 5/19/2026 | 1 Employees | AED 50,000 | (INR 1,287,024) |
| **Dec 2025** | `COMPLETED` | 5/19/2026 | 1 Employees | AED 50,000 | (INR 1,287,024) |

Two things to notice, both real: the total is **labelled AED regardless** of the employees' own
currencies (Jan/Dec 2025 are a single INR employee on ₹50,000, printed as "AED 50,000"), and
"1 Employees" is not pluralised.

**Empty state:** a dashed box, credit-card icon, **`No payroll runs found.`** and an outline button
**`Generate First Run`** (same action as the header button).

**Realtime/auto:** none. One `GET /api/hr/payroll` on load, plus one live call to
`https://open.er-api.com/v6/latest/AED` for today's AED→INR rate — **the INR figures are not
stored, they are recomputed from a live third-party rate every time the page opens.**

## 4.3 How a month is selected — **it isn't**

This is the answer the owner needs, and it is blunt:

- **`Start New Payroll Run` takes no input.** No month picker, no cycle picker, no employee picker,
  no dialog, no confirm. It is a single `POST /api/hr/payroll` and then a redirect straight into the
  new run. The **server** decides which month, which cycle dates and which employees.
- What it produced when I clicked it on 7 September 2026: month **`September 2026`**, cycle
  **`Aug 5 – Sep 5, 2026`**, **23 lines** (every active employee), status **`Draft`**, totalNet
  **199,784**, every line **`PENDING`**. So the cycle is **the 5th to the 5th**, and the run is
  named for the month it *ends* in.
- Existing runs match: August 2026 → `Jul 5 – Aug 5, 2026`; July 2026 → `Jun 5 – Jul 5, 2026`.
  The two old single-employee runs have no cycle at all — their note is just
  `Payroll for Jan 2026`.
- **There is no guard against making the same month twice.** The button is enabled even when this
  month's run already exists; if the server refuses, the page shows a plain `alert()` with whatever
  message came back, or *"Failed to create payroll"*.

## 4.4 Run states — what the screen calls each one

There are **two** state fields, and only one of them is really used.

**The run itself** (`status`): the only values in the live data are **`Draft`** and **`Completed`**.
A run created today is `Draft` and **stays `Draft` forever** — August 2026 has a paid line and is
still stored as `Draft`; the card only *displays* `1/23 Paid` because it computes that from the
lines. The two `Completed` runs are old, hand-seeded rows.

**Each line** (`status`): **`PENDING`** or **`PAID`**. That is all.

So, against the five states the owner asked about:

| State he asked about | Does it exist here? |
|---|---|
| draft | yes — `Draft`, and it is the only state a new run ever has |
| calculated | **no** — the figures are computed at creation, there is no separate calculate step |
| locked | **no** — nothing locks. A paid line can still be recalculated by the ↻ button |
| finalised | **no** — no finalise, approve or close action exists anywhere on either screen |
| paid | at **line** level only (`PAID`), and only as a manual note that you paid outside the app |

## 4.5 The run detail screen — `/hr/payroll/<runId>`

**Header:** a **‹** back arrow to `/hr/payroll`; **`Payroll Run: <Month Year>`**; under it, in
small caps, **`Cycle: <range> · Created <date>`** (e.g. `CYCLE: AUG 5 – SEP 5, 2026 · CREATED
9/7/2026`).

**Right of the header:**
- **`Total Deductions`** with **`−<n>`** in red — **this tile appears only when the run's total
  deductions are above zero.** On every live run today, deductions are 0, so the tile is absent.
- **`<n>% Completed`** with a progress bar = paid lines ÷ total lines.

There is **no** other header control. No approve. No lock. No finalise. No email-all-payslips. No
export. No bank-file download. No month navigation. I checked the rendered page and then read the
whole component's source to be sure, because a missing export is a bigger design statement than a
present one.

**Body:** one card per employee, sorted by base salary descending, paginated. Then a footer bar with
a **page-size dropdown — `10 / page` (default) · `25 / page` · `50 / page` · `100 / page`** — a
**`<n> results`** count, and **Previous / Page x / y / Next**.

**Empty / failure states:** a spinner while loading; if the id is bad, the whole page is the words
**`Payrun not found.`**

## 4.6 The employee line — every column and figure

Left to right on a wide screen:

1. **Avatar** — the first letter of the first name, or a **green tick** on a paid line.
2. **Name** (the name stored on the line, not looked up live) and, under it, the **role**
   (`Software Engineer`, `HR Specialist`, `Marketing Manager`, or `Employee` when blank).
3. **`BASE`** — the base figure with the employee's own currency, e.g. `AED 33,815`, `INR 30,000`.
4. **`Ded.`** — with a down-trend arrow, in red, e.g. `−AED 1,500`, and an ⓘ. **Shown only when the
   deduction is above zero, and it is a button** — clicking it expands the leave breakdown (§4.7).
   Little `→` arrows appear either side of it so the row reads *base → deduction → net*.
5. **`NET`** — the largest figure on the row, e.g. `AED 33,815`, with **`≈ INR 870,414`** in green
   underneath (live-rate conversion; absent when the employee is already in INR).
6. **Bank block** (desktop only) — a building icon, then **two click-to-copy buttons**: one labelled
   with the bank name showing the account number in green mono (e.g. `SBI / 38293746501234`), one
   labelled `IFSC` (e.g. `SBIN0004321`). Each shows a green tick for 2s when copied. If the employee
   has no bank details at all, the words **`No bank`** appear instead; if they have some but no IFSC,
   only the account button renders.
7. **↻ icon button**, tooltip **`Refresh salary & deductions`** — fades in on row hover. **A write —
   not pressed** (§4.9).
8. **The pay control**, which is one of three things:
   - **PAID** → a green chip **`✓ Paid`**, and beside it, if a reference was entered, a
     **click-to-copy chip** showing the transaction id (truncated to ~80px, full value in the
     tooltip).
   - **default** → a blue **`Register Pay`** button. **It is disabled when the employee has no bank
     details** — which is how the screen stops you recording a transfer to nobody.
   - **mid-entry** → the button is replaced by a small inline row: a mono text input
     **`Transaction ID`** (with a hash icon), a **green ✓ confirm button** — greyed and unclickable
     until you type something — and a **✕** to abandon. **Enter** confirms, **Escape** abandons.

**The 23 live lines of the September run I accidentally created** (the cleanest example of a fresh
run, and the numbers the app itself computed):

| Name | Role | Base | Cur | Net | ≈ INR |
|---|---|---|---|---|---|
| work6 | Software Engineer | 33,815 | AED | 33,815 | 870,414 |
| Mock Employee 10 | HR Specialist | 32,026 | AED | 32,026 | 824,364 |
| Swathikrishna U S | Software Engineer | 30,000 | INR | 30,000 | 30,000 |
| Mock Employee 5 | Marketing Manager | 28,930 | AED | 28,930 | 744,672 |
| Mock Employee 2 | Marketing Manager | 27,081 | AED | 27,081 | 697,078 |
| Kartik Kittad | Software Engineer | 25,000 | INR | 25,000 | 25,000 |
| Mock Employee 1 | HR Specialist | 19,201 | AED | 19,201 | 494,243 |
| Mock Employee 7 | HR Specialist | 17,359 | AED | 17,359 | 446,829 |
| Mock Employee 8 | Marketing Manager | 15,122 | AED | 15,122 | 389,247 |
| Chris george | Software Engineer | 11,022 | AED | 11,022 | 283,711 |
| Mock Employee 4 | HR Specialist | 10,081 | AED | — | — |
| Mock Employee 3 | Software Engineer | 10,000 | INR | — | — |
| Amal Vijayakumar | Software Engineer | 2,323 | AED | — | — |
| test er | Software Engineer | 2,000 | INR | — | — |
| Syeda Umme Kulsum | Software Engineer | 222 | AED | — | — |
| Ganesh S N · Kingson Thomas · test · Gokulakrishnan R · Megha · Test Demo · Rohit Vinod | Employee | **0** | AED/INR | 0 | — |
| Navaneeth B | Employee | **0** | AED | **10,000,234** | — |

(`—` = on pages 2–3, same shape.) Two facts worth the owner's attention: **an employee with no
salary set is still given a line, at zero**, and **Navaneeth B's ten-million net comes entirely from
a `bonus` field that the screen never shows** — see §4.8.

## 4.7 The `Leave Deduction Breakdown` — the only deduction this product has

Clicking a red `Ded.` figure expands a rose-tinted panel under the row, titled with a warning
triangle: **`LEAVE DEDUCTION BREAKDOWN`**. Four tiles, then the arithmetic:

| Tile | Shows | Red sub-line |
|---|---|---|
| **PTO** | `<ptoTaken> / <allowedPTO>` | **`+<n> excess`** when over |
| **Sick** | `<sickTaken> / <allowedSick>` | **`+<n> excess`** when over |
| **Unpaid** | `<unpaidTaken> days` | **`All deducted`** whenever above zero |
| **Total Excess** | `<totalExcessDays> days` (red) | `× <CUR> <perDay>/day` |

Then a mono strip spelling out the sum:
**`<totalExcessDays> days × <CUR> <perDay>/day = −<CUR> <amount>`**

**The rules underneath, exactly as the product implements them:**
- **A working month is hard-coded at 22 days.** The per-day rate is `round(base / 22)` —
  literally a constant `22` in the page, not a setting, not a calendar count, not the actual working
  days of that month.
- **Allowance is 2 PTO days and 2 sick days per cycle** in the live data (`allowedPTO: 2`,
  `allowedSick: 2`) — same for every one of the 23 employees, so it looks like a company-wide figure
  rather than a per-person entitlement.
- Only the **excess** over the allowance is deducted; **unpaid leave is deducted in full**.
- The API also returns `workingDays: 22` per employee alongside the same constant.

**Live examples:** in the August 2026 run, several employees show `ptoTaken: 1` of 2 allowed →
0 excess → **no deduction**. Kartik Kittad's Jan and Dec runs show `ptoTaken: 9, allowedPTO: 2,
excessPTO: 7, totalExcessDays: 7` — **and the stored deduction on those lines is still 0**, i.e.
the breakdown had been computed but never applied to the money (§4.9 explains why).

## 4.8 **Does a payslip show a structure amount AND an earned amount? — the plain answer**

**No. There is one number per line, and no payslip.**

Said plainly, because this is the answer that decides part of the owner's own design:

1. **There is no per-person payslip view in this product.** No payslip screen, no payslip route, no
   payslip PDF, no "email payslip" button, no print view. The word *Payslips* appears exactly once
   in the whole HR area and it is a **document upload slot for a new joiner's payslips from their
   previous employer**. Clicking an employee's row on the payroll screen does nothing — the row is
   not a link.
2. **There is no pay-structure or salary-head concept.** No basic/HRA/conveyance/special-allowance
   breakdown, no earnings table, no deductions table, no salary-head library, nothing per-component.
   The employee record carries a single **`baseSalary`** and a **`currency`**, and that is the whole
   structure.
3. **The line the screen shows has exactly two money figures**: **`BASE`** and **`NET`** — plus
   **`Ded.`** when a deduction exists. `Base` is not "the structure"; it is the same one number that
   `net` is derived from. So there is **only one number per line**, never a
   *entitled-vs-actually-earned* pair.
4. **And the data model quietly disagrees with the screen.** Each payroll line actually stores five
   figures — **`base`, `allowance`, `bonus`, `deduction`, `net`** — but the screen renders only
   `base`, `deduction` and `net`. `allowance` and `bonus` have **no control and no display anywhere
   on either payroll screen**. The consequences are visible in the live data:
   - Kartik Kittad's Jan 2026 line: `base 50,000`, **`allowance 13,500`**, `net 50,000` — the
     allowance is stored and **excluded from net**, and invisible on screen.
   - His Dec 2025 line: `base 50,000`, `allowance 13,500`, **`bonus 4,500`**, `net 50,000` — both
     ignored.
   - Navaneeth B's August 2026 line: `base 0`, **`bonus 10,000,234`**, `net 10,000,234` — here the
     bonus *did* land in net, and it is **the single reason the August run's headline total reads
     AED 10,267,785** instead of about 268,000. The screen shows him as `BASE 0 → NET 10,000,234`
     with no explanation of where the money came from.

**The one-line version for the owner: this product's payroll is base-salary-only, with a single net
figure and one kind of deduction (excess leave). If he wants a payslip that shows what a head was
worth versus what was actually earned, this product is not a precedent — it is the gap.**

## 4.9 Every control that writes — described, and NOT pressed

Four controls in this whole area write real money records. Here is exactly what each one says and
what it does, from the product's own code. **I pressed none of them** (the one exception, and its
cleanup, is at the top of this file).

| Control | Where | What it says it does | What it actually does |
|---|---|---|---|
| **Start New Payroll Run** | `/hr/payroll` header, and `Generate First Run` in the empty state | nothing — no dialog, no confirm, no fields | `POST /api/hr/payroll` → **creates a run and a line for every active employee**, then redirects into it. The only warning you ever get is the strapline. |
| **Register Pay** | each employee row | blue button; opens an inline **`Transaction ID`** field with a green ✓ | `PATCH /api/hr/payroll/line/<lineId>` with `{ status: "PAID", transactionId }` → **marks that person paid and stores your bank reference.** Irreversible from the screen: once a line reads `✓ Paid` there is no "un-pay", no edit and no delete on it. Disabled if the employee has no bank details. Requires a non-empty reference — you cannot mark someone paid without typing something. |
| **↻ Refresh salary & deductions** | each employee row, tooltip only | nothing written next to it | `PUT /api/hr/payroll/line/<lineId>` → **recalculates that line's salary and leave deduction and overwrites the stored figures**, and returns a fresh leave breakdown. **It is not disabled on a paid line** — you can silently change the money on a row already marked paid. This is almost certainly why the old runs show 7 excess leave days and a zero deduction: the breakdown is only turned into money when somebody presses ↻. |
| **🗑 Delete Payroll Run** | each run card, tooltip `Delete Payroll Run` | browser confirm: **`Are you sure you want to permanently delete this payroll run? This will remove all associated payment lines.`** | `DELETE /api/hr/payroll/<runId>` → removes the run **and every line under it, including lines already marked paid.** A whole month of pay records can be erased by one click plus one OK, with nothing kept behind. |

**And here is what does not exist, which matters just as much:**
no **Calculate**, no **Lock**, no **Finalise**, no **Approve**, no **Mark all paid**,
no **Email payslip**, no **Export**, no **Bank file / WPS / NEFT / SIF download**,
no **Reopen**, no **Undo payment**, no **Credit note**, no **audit trail** of who paid whom or who
recalculated a line (only a `paidAt` timestamp and your typed reference on the line itself).

## 4.10 Statutory, arrears, loans, reimbursements — every one, checked

The owner asked specifically. Every answer is the same answer:

| Concept | Present? |
|---|---|
| **PF / EPF / Provident Fund** | **No.** No such field, label or setting anywhere in the HR area. |
| **ESI** | **No.** |
| **PT / Professional Tax** | **No.** |
| **TDS / income tax** | **No** in payroll. (`TDS Credits` exists, but it is a **Finance** sidebar item under *Reports & Tax* — a company-tax screen, not a salary deduction. N8's scope.) |
| **UAE equivalents** — WPS / gratuity / end-of-service / air-ticket allowance | **No.** Nothing, despite AED being the default currency and the cycle running 5th-to-5th. |
| **Arrears** | **No.** No arrears line, no back-pay, no retro-effect field. A salary change simply produces a different number next time ↻ is pressed. |
| **Loan / advance deduction** | **No.** No loan register, no advance, no instalment, no recovery. The only deduction that can ever exist is excess leave. |
| **Reimbursement / expense claim** | **No** in payroll. `allowance` and `bonus` are stored on the line but, as §4.8 shows, have no control and no display. |
| **Overtime** | **No.** |
| **Multiple pay entities** | The run carries an **`entity`** field, `null` on all four live runs, and there is **no control for it** on either screen — a multi-company hook that was never surfaced. |

So the complete deduction list for this product is: **excess PTO days, excess sick days, unpaid
leave days.** Nothing else can reduce anyone's pay.

## 4.11 The lesson from my own mistake, since the owner is building this

The single most useful thing I can hand over about this screen is what went wrong when I looked at
it. **The most destructive control on the screen looked like a form-opener.** "Start New Payroll
Run" reads like *"open the wizard"*; it was *"write 23 rows now"*. A month picker, or a
`confirm("Create the September 2026 run for 23 employees?")`, or even a disabled state while this
month's run already exists, would each have made that click safe. In the same family: `Delete
Payroll Run` erases paid lines behind a single browser OK, and `↻` rewrites the money on a line
already marked paid. **In a payroll module, the shape of the button has to match the size of the
write.**

---

# 5. Odd things I noticed

One line each, product language, no follow-up attempted:

- **`Start New Payroll Run` writes on the first click** — no dialog, no confirm, no month choice.
- **A run never leaves `Draft`.** August 2026 has a paid line and is still stored as `Draft`; the
  card's `1/23 Paid` is computed on the fly, not a stored state.
- **`allowance` and `bonus` are stored on every payroll line and never shown**, and they are not
  treated consistently: Kartik's ₹13,500 allowance is excluded from net, while Navaneeth B's
  10,000,234 bonus is included — and that one bonus is the whole of the August run's headline total.
- **A working month is hard-coded to 22 days**; the per-day rate for a leave deduction is
  `base ÷ 22` regardless of the actual month.
- **The leave breakdown and the deduction can disagree.** Kartik's Jan/Dec lines show 7 excess days
  and a stored deduction of 0.
- **`↻ Refresh salary & deductions` is not disabled on a line already marked `✓ Paid`.**
- **Run totals are always labelled `AED`** even when every employee in the run is paid in INR.
- **The INR figures come from a live third-party rate** (`open.er-api.com`) at page-open time, so the
  same run shows different rupee numbers on different days, and shows none if that service is down.
- **Employees with no salary set still get a payroll line, at zero** — 7 of the 23 in September.
- **`1 Employees`** — the count is never singularised.
- **The sidebar says *Recruiting*, the address says `/hr/onboarding`**, and the sidebar's three
  sub-labels (PIPELINE BOARD / OPEN POSITIONS / CANDIDATE PIPELINE) don't match the page's own tab
  names (Board / Positions).
- **Escape does not close the Add Candidate dialog or the candidate drawer** — you must use Cancel
  or the ✕.
- **The offer page prints the raw internal candidate id on screen** as `ID: cmrn1zk1q…`.
- **Two candidates named "MEGHA M" and "Megha M"** sit in the pipeline with near-identical details
  and different emails — looks like duplicate demo data, not a product behaviour.
- **The Resources field is called *Security Category* but grants no security** — the screen's own
  promise is that everything published is synchronised to *all* Employee Portals.
- **A resource is a link, not a file** — there is no upload control on a screen whose own text says
  "Items uploaded here".
- **The Publish Resource form carries an `icon` value with no control**, so every resource gets the
  same book icon.
- **The Performance screen's own reviews are not on it** — the empty state tells you to open one
  from an employee's Performance tab, i.e. from another screen entirely.

---

# 6. In human language — every feature in this area, as points

## Performance

- **Locked performance screen** — for a staff member without HR rights, the whole performance
  section shows one short message saying they need HR access, with a link to their own portal where
  their personal reviews live. It exists so ordinary staff cannot browse everybody's scores.
- **Scoring criteria library** — HR writes the list of things people get judged on ("Code quality",
  "Communication"), each with a short "what good looks like" note. Click HR, then Performance, then
  the *Metric library* tab. It is the job of making appraisals consistent instead of each manager
  inventing their own questions.
- **Company-wide criteria versus team criteria** — the left-hand list lets you keep some criteria
  for everyone and add extra ones that only apply to, say, the engineering team. A person is judged
  on both lists together.
- **Importance weighting** — each criterion can be marked as counting more than the others, so
  "delivered the work" can outweigh "tidy paperwork" in the final score.
- **Ordering the criteria** — small up and down arrows let HR put the criteria in the order they
  want managers to read them.
- **Retiring a criterion without losing history** — a criterion can be archived so it stops
  appearing on new reviews while old reviews keep the scores already given, and renaming one only
  affects future reviews. It exists so last year's appraisals still make sense next year.
- **Everything is out of five stars** — every score in the whole product is one to five stars, shown
  with a colour: green is strong, amber is middling, red is weak. One scale everywhere means numbers
  can be compared across people and teams.
- **Two kinds of review** — a "90°" review, which is the manager's feedback twice a year, and a
  "180°" review, which adds the person's co-workers once a year. Self-assessment can be part of
  either, so somebody scores themselves alongside their manager.
- **Review register with progress** — one list of every review in the company showing who it is
  about, which kind it is, the period it covers, how many of the invited people have filed their
  part, and whether it is late. It exists so HR can chase the stragglers instead of guessing.
- **Four review counters** — small tiles at the top counting reviews still being collected, reviews
  ready to be shared with the employee, reviews now overdue, and how many criteria are defined.
- **Review stages in plain words** — a review reads as "Collecting", then "Ready to publish", then
  "Shared with employee", or "Cancelled". So everyone knows whether the employee has seen it yet.
- **Reviews are filled on the person's own record** — the register only lists them; clicking one
  takes you to that employee's page to read or write the actual feedback.

## Recruiting and hiring

- **Hiring board** — six columns you drag a candidate along: newly applied, contacted, interview,
  under review, hired, not hired. Click HR, then Recruiting. It is the whole hiring process on one
  screen so nobody is forgotten in an inbox.
- **Candidate cards with a rating** — each card shows the person's name, the role, where they came
  from, their star rating and how long ago they applied, so you can see the shape of the queue at a
  glance.
- **Add a candidate by hand** — a short form for somebody who came in by email or a friend rather
  than through the website: name, email, phone, the role, and where they came from.
- **Where candidates came from** — every candidate is tagged with a source (your website, LinkedIn,
  Indeed, a referral, a walk-in, or other), so at the end of a hire you know which channel is worth
  paying for.
- **Search and filter the queue** — search by name, then narrow by which job, which department, which
  source, a minimum star rating, and the dates they applied. For when the board has two hundred
  people on it and you only care about one slice.
- **One public application page** — a single "Copy Apply Link" button puts your company's careers
  page address on the clipboard, ready to paste into a post.
- **Job postings** — create an open position with a title, its own web address, a properly formatted
  job description, the department, the location, whether it is full time, part time, an internship or
  a contract, the currency and the salary range. It exists so applications arrive already attached to
  the right job.
- **Rich job description writing** — a small word-processor for the description with bold, italic,
  underline, strike-through, two heading sizes, bullet and numbered lists, quotes, a divider and
  links, so the advert reads properly without anyone knowing web code.
- **Pause a job instead of deleting it** — a posting can be set to active, paused, or completed, and
  deleting one is promised not to affect the people who already applied.
- **Job advert performance** — each posting reports how many people saw it, how many clicked, how
  many started an application and how many finished, plus the three percentages between them. It
  exists so you can tell "nobody is applying" from "everybody gives up halfway through the form".
- **Tracked links per channel** — one click copies a version of the application link tagged for
  Indeed, LinkedIn, your website, or a referral, so the numbers above tell you which channel is
  actually working.
- **Candidate file** — clicking a card slides out everything about one person: their contact details,
  the role, the source, when they applied, their CV, and their scores.
- **Screening scorecard** — the first-pass HR score, out of five stars each, on communication,
  cultural fit and professionalism.
- **Interview scorecards, one per interviewer** — each person on the panel scores technical skills,
  problem solving, communication, teamwork, and initiative, and writes their feedback in their own
  card. Nobody can edit somebody else's. It exists so a hiring decision is a set of independent
  opinions rather than the loudest voice in the room.
- **A combined interview average** — the panel's scores roll up into one number out of five, with a
  chip per interviewer showing who has scored and who is still pending.
- **Interview panel list** — you pick which colleagues are on the panel for this candidate from a
  list of everybody in the company.
- **Private notes on a candidate** — a notes box only the hiring team sees, for the things that do
  not belong on a scorecard.
- **Automatic history for every candidate** — a dated trail writes itself as the person moves
  through the stages, including where they originally came from. Nobody has to keep a spreadsheet of
  "when did we contact her".
- **Interview scheduling with everybody's diary on screen** — pick a date, a time and a length,
  choose the interviewers, and the screen shows each of their existing busy blocks from their
  calendars so you can drop the interview into a genuinely free slot. Drag the block to move it. It
  exists so nobody has to send "does 3pm work for you all?" five times.
- **Invite people outside the company** — type any email address and it is added as a guest to the
  interview, for a client or a freelance specialist sitting in.
- **A video call link created for you** — a meeting link is attached to the invitation
  automatically; there is nothing to set up or paste.
- **Interview invitations sent by email** — one button both books the slot and sends the invite to
  the candidate and the panel.
- **Turning a candidate into an employee** — marking someone hired opens one short form for their
  department, job title, monthly pay, start date, whether they are an intern (with the internship
  length) or on probation (with its length), and who they report to. Filling it creates the employee
  and emails them their joining link.
- **New-joiner pipeline** — a separate screen listing everyone who has been hired but has not
  started, showing whether they have filled in their joining form, whether their details still need
  checking, whether an offer has gone out, and whether it has been accepted.
- **Chasing a joining form** — a "Resend Email" button on anyone who has not filled theirs in yet.
- **The joining paperwork, reviewed on one page** — for each new joiner: the role and pay being
  offered, their bank details, blood group, date of birth, contact and emergency numbers, marital
  status, both addresses, their highest qualification, their previous employment, and their uploaded
  photo ID, government ID, tax ID, CV, old payslips and relieving letter. It exists so an HR person
  can check one screen before an offer letter goes out, rather than seven email attachments.
- **Special conditions on an offer** — a notes box for anything unusual being promised, kept with the
  offer rather than in somebody's sent mail.
- **Offer letter generated, previewed, then sent** — the system builds the official offer letter as a
  PDF, shows it to you first, and only emails it when you confirm. The sent letter stays viewable
  afterwards.
- **Revised offers** — if a detail was wrong, you correct it and send a revised letter, with an
  optional short note to the candidate explaining what changed. So a mistake is a new version, not a
  quiet edit.
- **Joining checklist** — seven fixed tasks for every new starter: create their work email, send the
  welcome email with the handbook, add them to Slack, send their app invite, get the NDA signed,
  collect their bank details for payroll, and get the code of conduct acknowledged. It exists so
  nobody starts on Monday without a laptop login.

## Company resources

- **Company document shelf** — one place to publish the handbook, the policies and the important
  staff documents, and everything published appears in every employee's own portal straight away.
  Click HR, then Resources.
- **Each item is a title plus a link** — you keep the actual file wherever it lives (Drive,
  for example) and publish a pointer to it, with the date it was published shown next to it.
- **Four categories** — general policy, IT and security, hardware, and legal compliance, so a long
  shelf is still readable.
- **Removing an item** — deleting one warns you it will immediately disappear from every employee's
  portal.
- **Everyone sees everything** — there is no per-document permission here; anything published is
  visible to all staff. Worth knowing before something sensitive goes up.

## Payroll

- **Monthly payroll runs** — one screen listing each month's payroll as a card with the month, when
  it was created, how many people are in it, the total to pay, and how many have been paid so far.
  Click HR, then Payroll.
- **Starting a month's payroll in one click** — one button builds the month's payroll for every
  active employee. There is no month to choose and no confirmation step: the system decides the
  month and the cycle, which runs from the 5th to the 5th. Worth treating that button carefully.
- **Progress you can see** — each month's card carries a bar and a label like "1 of 23 paid", and
  the month's page shows a percentage complete, so you know where you stopped.
- **The people list for a month** — every employee with their base pay, any deduction, and the final
  amount, biggest salary first, ten to a page (or twenty-five, fifty or a hundred).
- **Each person's own currency** — someone can be on dirhams and someone else on rupees in the same
  month, each shown in their own currency with an approximate rupee equivalent underneath, worked out
  from today's exchange rate.
- **Bank details on the row, ready to copy** — the bank name, account number and bank code sit
  beside each person, and one click copies each of them, because you are going to paste them into
  your bank's website.
- **Recording a payment you made yourself** — the app does not move money. You pay from your bank,
  then type the bank's reference number against that person and the row turns green with a tick. It
  exists so the record of who has been paid matches what actually left the account.
- **No reference, no payment recorded** — you cannot mark somebody paid without typing a reference,
  and you cannot mark somebody paid at all if the app has no bank details for them.
- **Copy back the payment reference** — a paid row keeps its reference on screen and lets you copy
  it again, for when the accountant asks.
- **Leave that costs money** — someone gets a couple of paid days off and a couple of sick days per
  cycle; anything beyond that, plus any unpaid leave, is deducted. Clicking the red deduction figure
  opens the arithmetic: days taken against days allowed, the excess, the daily rate, and the
  multiplication. It exists so the person can be shown exactly why their pay is short, rather than
  being told "the system worked it out".
- **A month's total deduction** — the month's page shows the whole run's deductions in one red
  figure at the top, when there are any.
- **Recalculating one person's pay** — a small refresh button on a row works their salary and leave
  deduction out again, for when their salary or their leave was corrected after the run was made. Two
  things to know: nothing recalculates by itself, and this still works on a row already marked paid.
- **Deleting a whole month's payroll** — each month's card has a delete button that warns it will
  permanently remove that month and every payment line under it, including the ones already marked
  paid.
- **What this payroll deliberately does not do** — there are no pay components (no basic, no housing,
  no allowances shown), no payslip for the employee, no payslip email, no bank file to download, no
  provident fund, no insurance, no professional tax, no income tax, no gratuity, no arrears, no
  loans or advances, no reimbursements, no overtime, no approval step, and no lock. A month stays
  open and editable forever, and nothing records who paid whom. Any of those has to be built, not
  copied.

---

*End of N10 capture.*
