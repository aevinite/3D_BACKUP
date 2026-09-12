# N7 — Nexeor Agency OS v2.0 · the **Web Projects** group (6 addresses)

Captured 2026-09-07 against `https://os-staging.product.nexeor.com`, signed in as the demo
account `demo_om85i@demo.agency` (display name **Little French House**, role `DEMO`).
Everything below was seen rendered in a real browser. Nothing was saved, submitted, deleted or
sent; every form was opened and then cancelled or escaped.

**What this account is allowed to see** (`GET /api/settings/rbac`):

```json
{"superAdmin":false,"fullAccess":false,
 "permissions":["Sales","Marketing","HR","Web Projects","Finance","Global Tasks"]}
```

So `Web Projects` is granted — but three screens in the group answer with an admin-only notice,
and two more answer with less data than an owner would see. Each is written down where it happens.

## The group, label vs address

The sidebar group is called **Web Projects** and holds three items. The third item is the group's
own root, and its label does not match its address:

| # | Sidebar label | Real address | Reachable with this login |
|---|---|---|---|
| 1 | `Board` | `/projects/board` | ✅ fully — 72 issues |
| 2 | `My Work` | `/projects/my-work` | ✅ — renders its empty state |
| 3 | `All Clients/Projects` | `/projects` | ✅ — renders its **empty** state |
| — | *(not in the sidebar)* | `/projects/capacity` | ⛔ admin-only notice |
| — | *(not in the sidebar)* | `/projects/clients` | ⛔ admin-only notice |
| — | *(not in the sidebar)* | `/projects/revenue` | ⛔ admin-only notice |
| — | *(not in the sidebar)* | `/projects/<projectId>` | ⛔ **Project not found** (the API answers `403 {"error":"Forbidden"}`) |

---

# 1. All Clients/Projects — `/projects`

**Where:** sidebar → `Web Projects` → `All Clients/Projects`. It is also the group's root address,
so a click on the group header's own destination lands here.

**What you see on arrival:** a page-title block top-left — a globe icon plus **`Web Projects`** in
white, and under it the grey line *"Manage web development projects, clients, kanban boards, and
team tracking."* Top-right, on the same row, a search box and one blue button. The whole rest of
the page is a single bordered empty-state card in the middle.

**Numbers/cards on the page:** none. This screen carries no tiles or counters at all.

**Controls, in the order they appear:**

| Control | Type | What it does |
|---|---|---|
| `Search projects or clients...` | text box, 256 px wide, magnifier icon inside on the left | filters the list. With no list, typing changes nothing on screen. |
| **`Import from CRM`** | solid blue (`bg-sky-600`) button with a `+` icon, top-right | opens the **Import Client from CRM** dialog (§1.2) |
| **`Import from CRM`** | second copy, outline style in sky-blue, inside the empty-state card | the same dialog — the empty state repeats the call to action |

**Tables/lists:** none rendered for this account. The search placeholder ("projects **or clients**")
and the subtitle both say the populated screen lists two kinds of row — clients and their projects —
but with an empty payload nothing is on screen, so **no column headers, row actions, sort options
or page size could be observed here.** Written down as not seen rather than guessed.

**Tabs:** none.

**Empty state (what it actually says):**

> **No projects found**
> Import an In Progress client from the Sales CRM to get started.
> `Import from CRM`

with a large grey folder-kanban icon above the heading.

**Why it is empty — and why that is not a fault of the screen:** the page asks
`GET /api/projects`, which answers **`200 {"projects":[]}`** for this account. Meanwhile the Board
on the very next screen lists four projects by name (Italica, Stave Corp IN_PROGRESS - 8, testt222,
testtttttt). So the master list is scoped to projects this person belongs to, and the demo account
belongs to none. The Board reads a different, unscoped feed.

**Realtime/auto:** nothing. One `GET /api/projects` on arrival and no polling.

## 1.1 The three requests this screen makes

```
200 GET /api/settings/rbac
200 GET /api/auth/session
200 GET /api/projects        →  {"projects":[]}
```

## 1.2 Dialog — **Import Client from CRM**

Opened by either `Import from CRM` button. It is a centred modal card, roughly 560 px wide, with a
heading **`Import Client from CRM`** and an `✕` close button in its top-right corner.

This dialog is the **only** way a project is created anywhere in this group. There is no blank
"New Project" form: a project always starts as a won CRM lead.

| # | Field | Type | Required | Default | Notes |
|---|---|---|---|---|---|
| 1 | **Link to CRM Lead** | a button that opens a searchable lead list, labelled `Search & select a lead...` | **yes** (`*`) | nothing selected | see §1.3 |
| 2 | **Repositories** | a button that opens a live GitHub repository list, labelled `Search & select a repository…` | no | nothing selected | see §1.4 |
| 2b | *(repo kind)* | native dropdown, tooltip **"Tag for the next repo you add"** | no | **`Monorepo`** | full option list below |
| 3 | **Project Name** | text | **yes** (`*`) | empty, placeholder `e.g. Agency Website Redesign` | |
| 4 | **Client / Company Name** | text | **yes** (`*`) | empty, placeholder `e.g. Acme Corp` | |
| 5 | **Status** | native dropdown | no | **`Planning`** | full option list below |
| 6 | **Description** | textarea, 3 rows | no | empty, placeholder `Brief overview of the project...` | |

**Repo-kind dropdown — the complete list (6):** `Frontend` · `Backend` · **`Monorepo` (default)** ·
`Mobile` · `Infra` · `Other`.

**Status dropdown — the complete list (5):** **`Planning` (default)** · `Under Development` ·
`On Hold` · `Completed` · `Off boarded`.
*(The stored values differ from the words: `PLANNING`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `ARCHIVED` —
so "Under Development" is the app's word for active, and "Off boarded" is its word for archived.)*

**The two helper lines printed inside the dialog, word for word:**

> ⓘ Showing won CRM leads (In Progress, Recurring, Closed) that aren't linked to a project yet

> Mono-repo projects need one repo; split stacks can add frontend/backend repos separately. The ★
> repo is where new issues are created by default. You can also manage repos later in Settings.

**Buttons on the dialog:** `✕` (top-right) · **`Cancel`** · **`Import Project`** — the last one is
**disabled** until a lead is chosen and the two required names are filled.

## 1.3 The CRM lead picker (inside the import dialog)

Clicking `Search & select a lead...` drops open a scrollable list. It asks
`GET /api/crm/leads?limit=20&page=1&stages=IN_PROGRESS,RECURRING,CLOSED&unlinked=1` — i.e. **won
leads only, and only leads not already turned into a project.** The list footer reads
**`20 eligible leads`**.

Each row shows five things: a coloured circle with the company's first letter · the **company
name** · the **contact person** · the **contact email** · the **service** in small caps · the
**deal value with its currency**. Rows with no value simply omit the amount.

The 20 rows offered at capture time:

| Company | Contact | Email | Service | Value |
|---|---|---|---|---|
| Stave Corp IN_PROGRESS - 7 | Lead Contact 6 | contact6@in_progress.com | PPC CAMPAIGNS | AED 8,000 |
| Stave Corp IN_PROGRESS - 2 | Lead Contact 1 | contact1@in_progress.com | PPC CAMPAIGNS | *(none)* |
| Stave Corp IN_PROGRESS - 1 | Lead Contact 0 | contact0@in_progress.com | BRANDING | AED 45,389 |
| Stave Corp QUALIFIED - 1 | Lead Contact 0 | contact0@qualified.com | BRANDING | INR 697 |
| Stave Corp ON_HOLD - 1 | Lead Contact 0 | contact0@on_hold.com | SOCIAL MEDIA | AED 71,142 |
| Stave Corp IN_PROGRESS - 5 | Lead Contact 4 | stavecorp@gmail.com | PPC CAMPAIGNS | AED 2,500 |
| Stave Corp IN_PROGRESS - 4 | Lead Contact 3 | contact3@in_progress.com | APP DEVELOPMENT | AED 1,500 |
| XYZ | *(none)* | *(none)* | WEBSITE | AED 2,000 |
| Stave Corp RECURRING - 4 | Lead Contact 3 | contact3@recurring.com | WEBSITE DEV | AED 30,000 |
| Stave Corp RECURRING - 2 | Lead Contact 1 | contact1@recurring.com | SEO OPTIMIZATION | AED 76,236 |
| Stave Corp CLOSED - 5 | Lead Contact 4 | contact4@closed.com | WEBSITE DEV | AED 4,000 |
| Stave Corp RECURRING - 1 | Lead Contact 0 | contact0@recurring.com | SEO OPTIMIZATION | AED 19,511 |
| Stave Corp RECURRING - 5 | Lead Contact 4 | contact4@recurring.com | APP DEVELOPMENT | AED 1,000 |
| Stave Corp RECURRING - 3 | Lead Contact 2 | contact2@recurring.com | APP DEVELOPMENT | AED 36,098 |
| Stave Corp CLOSED - 2 | Lead Contact 1 | contact1@closed.com | SOCIAL MEDIA | AED 8,950 |
| Stave Corp CLOSED - 4 | Lead Contact 3 | contact3@closed.com | APP DEVELOPMENT | AED 37,871 |
| Stave Corp CLOSED - 3 | Lead Contact 2 | contact2@closed.com | PPC CAMPAIGNS | AED 35,760 |
| Stave Corp IN_PROGRESS - 6 | Lead Contact 5 | contact5@in_progress.com | SOCIAL MEDIA | AED 62,046 |
| *(plus 2 more of the same shape)* | | | | |

*(One row, `Stave Corp QUALIFIED - 1`, is named "QUALIFIED" but its stored stage is `IN_PROGRESS` —
the name is just demo text, the stage filter is what decides eligibility.)*

## 1.4 The GitHub repository picker (inside the import dialog)

Clicking `Search & select a repository…` shows **`Loading repositories…`** for about ten seconds,
then lists live repositories from the agency's GitHub organisation `Nexeor-dev-space`, newest-
touched first. Each row: **owner/repo** · its GitHub description (or `No description`) · its main
language · `updated <ago>`. Ten were offered:

| Repository | Description | Language | Updated |
|---|---|---|---|
| Nexeor-dev-space/e-com-pachchigarandsons | Fullstack Next JS project for Pachchigar and sons E-com project | TypeScript | 2m ago |
| Nexeor-dev-space/Italica-ERP-fullstack | ERP for Italica | Python | 23m ago |
| Nexeor-dev-space/italicawebdemo | No description | TypeScript | 37m ago |
| Nexeor-dev-space/nexeor-agency-os | No description | TypeScript | 46m ago |
| Nexeor-dev-space/SP-ERP-NextJS | No description | TypeScript | 2h ago |
| Nexeor-dev-space/fc-filmwerks-design | No description | TypeScript | 2h ago |
| Nexeor-dev-space/rewire-electronics-design | No description | TypeScript | 5h ago |
| Nexeor-dev-space/E-commerce-wishmaster-backend | E commerce backend for wishmaster. | Python | 5h ago |
| Nexeor-dev-space/E-commerce-wishmaster-frontend | No description | JavaScript | 1d ago |
| Nexeor-dev-space/dj-ganesh-website-design | No description | TypeScript | 1d ago |

### Odd things I noticed
- The screen's own subtitle and its search placeholder both promise clients as well as projects,
  but the empty state's heading only says "No projects found".
- `Import from CRM` appears twice on the same screen (header and empty-state card).

---

# 2. Board — `/projects/board`

**Where:** sidebar → `Web Projects` → `Board`.

**What it actually is — read this first:** it is **not** a project pipeline. It is a single shared
**issue board across every web project at once**, and its cards are GitHub issues. The lanes are
work stages (Backlog → Done), not sales stages. Every project's issues sit in the same six lanes,
side by side, and a filter narrows it to one project.

**What you see on arrival, top to bottom:**
1. Title row — a kanban icon plus **`Board`**, and under it *"Every issue across all web projects.
   **72 of 72** shown."* On the right of the same row: a search box, a small icon button
   (**tooltip "Refresh board"**) and a small button **`Columns`** (**tooltip "Edit columns"**).
2. A row of six **summary tiles**.
3. A horizontally scrolling **strip of people chips**, one per team member plus `Unassigned`.
4. A row of **nine dropdown filters** and one **`Done`** toggle button.
5. The board itself — six 320 px lanes, scrolling sideways, each lane scrolling vertically.

## 2.1 Numbers/cards on the page (six tiles, live values at capture)

| Tile | Big number | Caption | Clickable? |
|---|---|---|---|
| 1 | **58** | `Open · 14 done` | no |
| 2 | **1** | `In review` | no |
| 3 | **3** | `Overdue` | **yes — filters the board to overdue only** |
| 4 | **0** | `Due 7d` | **yes — filters to due within 7 days** |
| 5 | **5** | `Unassigned` | **yes — filters to issues with no assignee** |
| 6 | **28h** | `Est. left · 3h spent` | no |

The three clickable tiles are toggles: click once to filter, click again to clear. Clicking
`Overdue` took the board from *72 of 72* to **3 of 72**.

## 2.2 The people strip

One chip per person, each a toggle filter, each with a tooltip spelling out the numbers. A chip
shows: avatar (20 px, from Google or GitHub) · name · **open count** · and, in red, an **overdue
count written as `N!`** when there is one.

| Chip | Open | Overdue | Tooltip, word for word |
|---|---|---|---|
| Chris george | 1 | 1 | `Chris george — 1 open, 1 overdue, 8h estimated` |
| Rohit Vinod | 3 | 2 | `Rohit Vinod — 3 open, 2 overdue, 16h estimated` |
| akhila kr | 0 | — | `akhila kr — 0 open` |
| Kevin Norbert | 0 | — | `Kevin Norbert — 0 open` |
| Syeda Umme Kulsum | 0 | — | `Syeda Umme Kulsum — 0 open` |
| Swathikrishna U S | 1 | — | `Swathikrishna U S — 1 open` |
| Gokulakrishnan R | 1 | — | `Gokulakrishnan R — 1 open` |
| Sandra KK | 0 | — | `Sandra KK — 0 open` |
| Kingson Thomas | 1 | — | `Kingson Thomas — 1 open, 3h estimated` |
| abcd | 0 | — | `abcd — 0 open` *(no photo — shows the initials `AB`)* |
| Unassigned | 5 | — | `Unassigned — 5 open` |

Clicking **Rohit Vinod** gave **4 of 72** — one more than his chip's "3", because the chip counts
only *open* issues while the filter also brings in his finished one.

## 2.3 Filters — every dropdown, every option

Nine native dropdowns in a row. **All filtering is done in the browser; the address bar never
changes** (`/projects/board` stays exactly that, no query string), so a filtered board cannot be
bookmarked or shared as a link.

**1. Projects (5 options)** — `All projects` *(default)* · `Italica` · `Stave Corp IN_PROGRESS - 8` ·
`testt222` · `testtttttt`

**2. Clients (5)** — `All clients` *(default)* · `Checkpoint` · `Italica` ·
`Stave Corp IN_PROGRESS - 8` · `testt555`

**3. Priorities (5)** — `All priorities` *(default)* · `P0 Critical` · `P1 High` · `P2 Medium` ·
`P3 Low`

**4. Types (5)** — `All types` *(default)* · `Bug` · `Feature` · `Task` · `Improvement`

**5. Sprints (5)** — `All sprints` *(default)* · `test · Italica` ·
`testing for sprint capacity bug · Stave Corp IN_PROGRESS - 8` ·
`Sprint 1 — Mobilization & Environment Lock · Italica` · `No sprint`
*(each sprint is written `sprint name · project name`)*

**6. Milestones (6)** — `All milestones` *(default)* · `Full Payment · testtttttt` ·
`Milestone 1 - Advance · Italica` · `Milestone 2 - Sprint Close · Italica` ·
`Milestone 3 - Go-Live · Italica` · `No milestone`

**7. Repos (3)** — `All repos` *(default)* · `Italica-ERP-fullstack` · `demo-Italica-app`

**8. Labels (59 options — `All labels` plus all 58 labels in use).** In the order the dropdown
lists them: `accounts`, `admin-panel`, `api`, `architecture`, `auth`, `aws`, `backend`, `beats`,
`bug`, `bugfix`, `catalog`, `ci`, `ci-cd`, `client`, `crm`, `data-migration`, `database`,
`dependencies`, `dependency`, `deploy`, `devops`, `fastapi`, `flutter`, `infra`, `integration`,
`journey`, `jwt`, `kickoff`, `kyc`, `leads`, `logistics`, `milestone`, `milestone-review`,
`mobile`, `monitoring`, `monorepo`, `nextjs`, `orders`, `pipeline`, `planning`, `pm`,
`priority: high`, `priority: medium`, `priority: urgent`, `qa`, `rbac`, `regression`,
`release-notes`, `scaffold`, `schema`, `scope`, `security`, `sign-off`, `staging`, `tally`,
`test-data`, `uat`, `ux`.

**9. Due date (5)** — `Any due date` *(default)* · `Overdue` · `Due today` · `Due in 7 days` ·
`No due date`

**Then one toggle button:** **`Done`**, tooltip **"Hide done columns"**. Pressing it removes the
whole `Done` lane from the board (counter went to **58 of 72**) and its tooltip flips to **"Show
done columns"**.

**And one more button that only exists when something is filtered:** a **`Clear`** button appears
at the end of the filter row as soon as a search or filter is active, and disappears again when
nothing is filtered.

**Search box** (`Search issues, projects, people, labels...`) searches all four of those things at
once. Typing `tally` gave **3 of 72**.

## 2.4 The lanes

Six lanes, in this fixed order, each 320 px wide:

| Lane | Count | Time sum | Dot colour |
|---|---|---|---|
| `Backlog` | 49 | `Σ 5h` | grey |
| `Todo` | 5 | *(none shown)* | amber |
| `In Progress` | 3 | `Σ 15h` | sky blue |
| `In Review` | 1 | `Σ 8h` | purple |
| `staging` | 0 | — | emerald |
| `Done` | 14 | `Σ 4h` | emerald |

**Lane header, left to right:** a coloured dot · the lane name in bold · the **issue count** in
mono grey · the **`Σ <hours>` estimate sum** (only when there is one) · a small icon button
**tooltip "Select all in column"**. On the far right of the header: a `+` icon button
**tooltip "New issue"**.

**Empty lane:** the lane body simply reads **`Empty`** in grey. (`staging` shows this.)

**Board with nothing matching** (search `zzzzqqq`): the header reads *"**0 of 72** shown"*, every
tile drops to `0` (`Open · 0 done`, `0h Est. left · 0h spent`), every people chip drops to `0`, and
**all six lanes render, each showing `Empty`**. It does not replace the board with a single empty
message.

## 2.5 The card — every badge on it

Cards are `320px`-wide tiles. Top to bottom, a fully-loaded card shows:

1. **Top-left source line** — either a green circle-dot icon plus **`owner/repo`** and the GitHub
   issue number (`Nexeor-dev-space/demo-Italica-app` `#15`), **or** the words **`Local issue`**
   when the issue only exists inside Nexeor.
2. **Top-right** — the assignee's round avatar (20 px, overlapping if several), tooltip
   **`Assigned to <name>`**. Plus a **`Select`** checkbox that is invisible until you hover the
   card (`opacity-0 group-hover:opacity-100`).
3. **Title** — 13 px, white, wraps over as many lines as it needs.
4. **Project link** — the project name in small sky-blue text, tooltip `<project> · <client>`,
   linking to `/projects/<projectId>`.
5. **Chip row** — the **type** chip (`◦ Task`, `✨ Feature`, `🐞 Bug`, `⚙ Improvement`); a red
   **due-date** chip with a calendar-clock icon reading e.g. `45d over`, tooltip
   `Due 7/24/2026`; a **sprint** pill with a flag icon, and a **milestone** pill with a milestone
   icon reading e.g. `Milestone 1 - Advance` plus, in red, `· 11d over`.
6. **Label chips** — every GitHub label, each painted in that label's own GitHub colour.
7. **Linked-PR pill** — purple, with a git-branch icon, reading e.g. `#47`.
8. **Bottom row** — the **priority** pill (`MEDIUM`, `HIGH`, `CRITICAL`, `LOW`, coloured) on the
   left, and on the right a clock icon with **`spent / estimate`** (e.g. `1h / 2h`).

**Drag affordance — described, never dropped.** Every card carries `draggable="true"` with
`cursor-grab` and `active:cursor-grabbing`, so the pointer becomes an open hand over a card and a
closed hand while dragging. The lane wrapper carries a `transition-colors` border, which is what
changes colour to show it will accept the card. **No card was dragged and nothing was dropped** —
moving a card is a real write (the app also logs time from it: see §2.9's "Move the card on the
board" hint).

## 2.6 The bulk-select bar

Hovering a card reveals a `Select` checkbox in its top-right corner; the lane header also offers
`Select all in column`. Selecting one card makes a small bar float at the bottom of the screen:

> **`1`  Selected**  ·  `Move to…` ▾  ·  **`Delete`**  ·  `✕`

- **`Move to…`** — a dropdown with the six lanes: `Move to…` *(placeholder)* · `Backlog` · `Todo` ·
  `In Progress` · `In Review` · `staging` · `Done`.
- **`Delete`** — red text button.
- **`✕`** — tooltip **"Clear selection"**.

Neither `Move to…` nor `Delete` was used.

## 2.7 Dialog — **`Columns`** (the board-column editor)

`Columns` opens a modal headed **`Board Columns`** with the subtitle
**"Shared by every project. Renames migrate all issues."** — i.e. these lanes are global, and
renaming one moves every issue that sits in it.

One row per lane, in board order, each row holding four controls:

| Control | Behaviour |
|---|---|
| a colour swatch button, tooltip **"Change color"** | **it does not open a palette — each click steps to the next colour.** Observed on `Backlog`: grey → amber → sky blue |
| a **text box holding the lane's name**, editable in place | `Backlog`, `Todo`, `In Progress`, `In Review`, `staging`, `Done` |
| **↑** arrow | move the lane left; **disabled on the first row** |
| **↓** arrow | move the lane right; **disabled on the last row** |
| **✕** | delete the lane (turns rose-red on hover) |

Below the six rows: a text box **`New column (e.g. Staging)`** with a `+` button beside it.
At the bottom: **`Cancel`** and **`Save`**. An `✕` closes the modal top-right.

Opened, every control inspected, then **Cancel**.

## 2.8 Dialog — **`New issue`** (the `+` on any lane header)

A modal headed **`New issue`** with the subtitle *"Filed in the portal and mirrored to the linked
GitHub repo."* — so an issue created here is pushed to GitHub, not kept private.

| # | Field | Type | Required | Default |
|---|---|---|---|---|
| 1 | **PROJECT** | dropdown | — | `Italica` (first project) |
| 2 | **TITLE** | text, placeholder `What needs to be done?` | **yes** (`*`) | empty |
| 3 | **DESCRIPTION** | markdown textarea, placeholder `Context, acceptance criteria, links… (markdown supported)` | no | empty |
| 4 | **TYPE** | dropdown | — | `Task` |
| 5 | **PRIORITY** | dropdown | — | `P2 · Medium` |
| 6 | **COLUMN** | dropdown | — | the lane you clicked `+` on (`Backlog`) |
| 7 | **ASSIGNEE** | dropdown | — | `Unassigned` |
| 8 | **MILESTONE** | dropdown | — | `None` |
| 9 | **SPRINT** | dropdown | — | `Backlog (no sprint)` |
| 10 | **START DATE** | date | no | empty |
| 11 | **DUE DATE** | date | no | empty |
| 12 | **ESTIMATE (HOURS)** | number, placeholder `Helps the forecast` | no | empty |
| 13 | **REPOSITORY** | dropdown | — | the project's starred repo |
| 14 | **Visible to the client in the portal** | checkbox | no | **unticked** |

**Every dropdown's complete option list:**

- **PROJECT (4):** `Italica` · `Stave Corp IN_PROGRESS - 8` · `testt222` · `testtttttt`
- **TYPE (4):** `Bug` · `Feature` · `Task` *(default)* · `Improvement`
- **PRIORITY (4):** `P0 · Critical` · `P1 · High` · `P2 · Medium` *(default)* · `P3 · Low`
- **COLUMN (6):** `Backlog` *(default here)* · `Todo` · `In Progress` · `In Review` · `staging` · `Done`
- **ASSIGNEE (11):** `Unassigned` *(default)* · `Chris george (GitHub missing)` · `Rohit Vinod` ·
  `akhila kr (GitHub missing)` · `Kevin Norbert (GitHub missing)` ·
  `Syeda Umme Kulsum (GitHub missing)` · `Swathikrishna U S` · `Gokulakrishnan R` ·
  `Sandra KK (GitHub missing)` · `Kingson Thomas (GitHub missing)` · `abcd (GitHub missing)`
  — **the `(GitHub missing)` suffix marks a team member with no GitHub account linked**
- **MILESTONE (4):** `None` *(default)* · `Milestone 1 - Advance` · `Milestone 2 - Sprint Close` ·
  `Milestone 3 - Go-Live`
- **SPRINT (3):** `Backlog (no sprint)` *(default)* · `test` ·
  `Sprint 1 — Mobilization & Environment Lock`
- **REPOSITORY (1, for Italica):** `Italica-ERP-fullstack · monorepo ★` — written as
  `repo · kind ★`, the star marking the default repo for new issues

**The description box has its own markdown toolbar** — 12 icon buttons, tooltips in order:
`Bold (Ctrl+B)` · `Italic (Ctrl+I)` · `Strikethrough` · `Heading` · `Bulleted list` ·
`Numbered list` · `Task list` · `Quote` · `Code` · `Link (Ctrl+K)` · `Attach image or video` —
plus a **`PREVIEW`** toggle.

**Buttons at the bottom:** **`Cancel`** and, in place of a submit button, a **disabled** button
reading **`GitHub token required`**, tooltip *"Connect your GitHub account in Settings first"*.
Above it the dialog prints the reason in full:

> Connect your GitHub account first. Issues are filed on GitHub under your own account, so a
> personal access token is required before you can create one. Add it in Settings → Your GitHub
> Account (the ⓘ there explains how to generate one), then reopen this dialog.

So **nobody can create an issue at all until they have personally connected GitHub** — the app
files it as them, not as a service account. (It checks with
`GET /api/projects/github/token` when the dialog opens.)

## 2.9 The issue drawer — what opens when you click a card

Clicking a card's title slides a very large panel over the board from the right (about two thirds
of the screen). This is the deepest screen in the whole group. It does **not** change the address —
the URL stays `/projects/board`.

**Top bar:** a repo chip **`Nexeor-dev-space/demo-Italica-app  #15`** · **`Copy Link`** ·
**`Open on GitHub`** · **`✕`**.

**Title block:** the issue title in large white text with its number beside it, a pencil button
(**tooltip "Edit title"**), then a green **`Open`** state pill, then
*`nexeor-os[bot]` opened this issue `46d ago` · `0 comments`*.

**Main column, top to bottom:**

1. **Description card** — author line (`nexeor-os[bot] opened 46d ago`) and an **`Edit`** button.
   The body renders full markdown: paragraphs, an `Acceptance criteria:` heading, **live tickable
   checkboxes** for each criterion, a horizontal rule, italic footer text
   *"Created via Nexeor OS plan import by Rohit Vinod"*, and **inline screenshots**.
   *(The checkboxes were not ticked — ticking one writes to GitHub.)*
2. **A big full-width gradient button** — **`Submit for Review`**. It is **stage-dependent**: the
   In-Progress issue showed it; a Backlog issue did not.
3. **`ACTIVITY (0)`** section — with two dropdowns and a search box:
   - a period dropdown, **5 options:** `All Time` *(default)* · `Today` · `7 Days` · `30 Days` ·
     `Custom`
   - a page-size dropdown, **3 options:** `5` *(default)* · `10` · `20`
   - a text box `Search activity...`
   - the list itself, which for this account reads **`No activity yet.`**
4. **Comment box** — textarea `Leave a comment (paste or drop images to attach)`, an image button
   (**tooltip "Attach image or video"**, accepts `image/*,video/*`, multiple), the caption
   **"Markdown supported · posted to GitHub with your name"**, and two buttons:
   **`Close issue`** (with a check-circle icon) and **`Comment`** (disabled while empty).

**Right rail — every panel, in order:**

| Panel | What it holds |
|---|---|
| **Board** | dropdown, **6 options:** `Backlog` · `Todo` · `In Progress` *(current)* · `In Review` · `staging` · `Done` |
| **Client Visibility** | a switch reading **`Internal Only`**, and under it *"Only client-visible tasks appear in the public portal."* |
| **Assignee** | the line *"No team members on this project."* and then the current assignee's chip (`Rohit Vinod`) |
| **Type** | dropdown, **4 options:** `🐞 Bug` · `✨ Feature` · `◦ Task` *(current)* · `⚙ Improvement` |
| **Priority** | dropdown, **4 options:** `P3 · Low` · `P2 · Medium` *(current)* · `P1 · High` · `P0 · Critical` |
| **Sprint** | dropdown — only `No sprint` was offered for this account |
| **Milestone** | dropdown — only `No milestone` was offered for this account |
| **Attachments** | a **`+ Add Document`** file button (multiple files) |
| **Dates** | two date boxes, **`Start`** (`2026-07-23`) and **`Due`** (`2026-07-24`) |
| **Labels** | the issue's labels as coloured chips (`integration`, `tally`, `dependency`) and an **`Edit labels`** button |
| **Development** | linked pull requests — a pill **`Cruds v1 frontend #47`**, an external-link icon to `https://github.com/…/pull/47` (tooltip "Open on GitHub"), an **unlink** icon (tooltip "Unlink from this issue"), and a **`+ Link a pull request`** button |
| **Participants** | round avatars of everyone involved (`nexeor-os[bot]`, `Rohit Vinod`) |
| **TIME TRACKING** | see below |

**The TIME TRACKING panel** shows `Logged **1h** / Est **2h**`, a progress bar labelled
**`50% of estimate`**, then a target icon reading `Estimate: 2h` with a pencil button
(**tooltip "Change estimate (PM/QA)"**). Clicking that pencil turns the figure into a small number
box with placeholder `hrs`. Under it two breakdown panels, **`BY SOURCE`** and **`BY PERSON`**,
which for this account render as **headings with no rows underneath**.

When an issue has no time at all the panel instead reads `Logged 0m`, `Estimate: Not set`, and:

> No time logged yet. Move the card on the board or add `#{issue} -t 20m` to a commit.

— so time is logged two ways: by moving the card, or by writing `-t 20m` in a git commit message.

### 2.9.1 The four in-drawer editors (each opened, then cancelled)

**`Edit labels`** — drops a picker in place listing **every label in the repository (37)**, plus a
**`Done`** button to close it. The full list: `admin-panel`, `architecture`, `auth`, `aws`,
`backend`, `bug`, `ci-cd`, `database`, `dependency`, `devops`, `documentation`, `duplicate`,
`enhancement`, `fastapi`, `flutter`, `good first issue`, `help wanted`, `infra`, `integration`,
`invalid`, `kickoff`, `milestone-review`, `mobile`, `monorepo`, `nextjs`, `pm`, `PR`, `qa`,
`question`, `Resolved`, `scaffold`, `schema`, `scope`, `sign-off`, `tally`, `ux`, `wontfix`.
*(This is the repository's label set, which is not the same as the board filter's 58 labels — the
filter lists labels in use across all repos.)*

**`Link a pull request`** — opens a search box **`Search open PRs, or paste a link / number`**, a
checkbox, and a message. For this account: **`No open pull requests in this project's repos.`**
(`GET /api/projects/<id>/github/prs?state=open` answered `403`.) When there is no linked PR at all
the panel's own empty line reads:

> No linked pull requests. Branch names like `fix/2-…` or "fixes #2" in the PR link it automatically.

**`Edit`** (description) — turns the description into a markdown textarea prefilled with the current
text (placeholder `Add a description... (paste or drop images to attach)`), plus **`Attach media`**,
**`Cancel`** and **`Save description`**. On an issue with no description the body is instead a
button reading **`No description provided. Click to add one.`**

**`Edit title`** (the pencil) — replaces the title with a text box holding the title, and puts
**`Save`** and **`Cancel`** in the top bar.

### 2.9.2 A local issue's drawer is different

Opening a card marked `Local issue` gives the same drawer with four differences:

- the top bar reads **`Local issue — not on GitHub`** and offers **only `Copy Link`** — no
  `Open on GitHub`;
- the comment caption changes from "posted to GitHub with your name" to
  **"Markdown supported · saved in Nexeor OS"**;
- there is **no Labels panel and no Participants panel** at all;
- the author reads **`Someone`** where a GitHub issue names its bot or user.

### 2.9.3 What the drawer asks the product for

```
403 GET /api/projects/<projectId>
403 GET /api/projects/<projectId>/issues/<issueId>
403 GET /api/projects/<projectId>/issues/<issueId>/github-timeline
403 GET /api/projects/<projectId>/issues/<issueId>/activities?limit=5&offset=0
403 GET /api/projects/<projectId>/issues/<issueId>/activities?type=TIME_LOGGED&limit=200
200 GET /api/projects/<projectId>/repo-meta?repo=<owner>%2F<repo>
```

So for this account the drawer paints everything it can from the board's own payload, and the five
detail feeds are refused — which is exactly why `ACTIVITY` says "No activity yet", why the two time
breakdowns are empty headings, and why Sprint and Milestone offer only their "none" option.
**On an owner's account those five panels would carry content; this document cannot show what.**

## 2.10 Realtime/auto on the Board

**The board refetches itself every 60 seconds.** Watched idle for 75 s: `GET /api/projects/board`
at 1 s and again at 61 s, nothing else. The **`Refresh board`** icon button forces the same call
immediately.

### Odd things I noticed
- Two lanes are named in different styles — five are capitalised (`Backlog`, `Todo`, `In Progress`,
  `In Review`, `Done`) and one is lower-case (`staging`), because lanes are free text.
- Filtering never touches the address bar, so a filtered view cannot be linked to.
- One person's chip carries no photo and falls back to the initials `AB` for the name `abcd`.

---

# 3. My Work — `/projects/my-work`

**Where:** sidebar → `Web Projects` → `My Work`.

**What you see on arrival:** a title row — a check-square icon plus **`My Work`**, with the line
*"Everything assigned to you across all web projects. **0** open."* Under it a single checkbox,
and then one centred card. That is the entire screen.

**Numbers/cards on the page:** one live number, the **open count**, printed inside the subtitle.
No tiles.

**Controls:** exactly one — a checkbox labelled **`Show completed`**, unticked by default.
There are **no other buttons, no filters, no dropdowns, no search, no tabs**.

**What it pulls in:** issues, not tasks and not approvals. Its feed is
`GET /api/projects/my-work`, which answers with two things:

```json
{"issues":[],
 "columns":[{"name":"Backlog","color":"bg-white/10"},
            {"name":"Todo","color":"bg-amber-500/20"},
            {"name":"In Progress","color":"bg-sky-500/20"},
            {"name":"In Review","color":"bg-purple-500/20"},
            {"name":"staging","color":"bg-emerald-500/20"},
            {"name":"Done","color":"bg-emerald-500/20"}]}
```

**How it is grouped:** by the **same six board columns**, with the same colours — the endpoint
hands the screen the column list along with the issues, so My Work is the Board's six lanes
narrowed to one person. With zero issues the grouping cannot be seen rendered, and that is written
down as not seen.

**Empty state, word for word:**

> **All clear**
> Nothing assigned to you right now.

with a large faint icon above it. Ticking `Show completed` changed nothing visible, because there
are no completed items either.

**Is it the same data as Global Tasks? No — plainly not, and here is the evidence.**

| | **Global Tasks** (`/tasks`) | **My Work** (`/projects/my-work`) |
|---|---|---|
| Feed | `GET /api/tasks?filter=mine\|all` | `GET /api/projects/my-work` |
| Thing it lists | tasks | **web-project issues** |
| Grouping | its own lanes (seven of them) | **the six board columns, sent by the API** |
| Controls | search, `My Tasks` / `All Tasks` switch | one `Show completed` checkbox |

Two different endpoints, two different record types. My Work is the personal slice of the **issue
board**; Global Tasks is a separate task board. *(The `/tasks` endpoint names above are as recorded
by terminal N5 for the same account; the `/api/projects/my-work` call and its payload are my own
observation.)*

**Realtime/auto:** nothing. Watched idle for 70 s — one call on arrival, no polling. Unlike the
Board, this screen does **not** refresh itself.

---

# 4. The three screens nobody had opened — all three are admin-only

All three render the app shell (sidebar, footer) normally and then a short notice in the content
area. **Each was tried once and left alone.** Their data calls answer `403`.

## 4.1 `/projects/capacity`

**Heading:** `Restricted`
**Message, word for word:** *"Team capacity and workload data are visible to administrators only."*
**Buttons offered:** none of its own — only the shell's sidebar and its `Sign Out`.
**Not reachable for this account.** (Sidebar label: none — this screen is not in the menu.)

## 4.2 `/projects/clients`

**Heading:** `Admins only`
**Message, word for word:** *"Client Dashboards are restricted to system administrators."*
**One control of its own:** a **`Back to Projects`** link, going to `/projects`.
**Not reachable for this account.** From the wording, on an admin account this is a per-client
dashboard area ("Client Dashboards", plural).

## 4.3 `/projects/revenue`

**Heading:** `Restricted`
**Message, word for word:** *"Revenue and financial figures are visible to administrators only."*
**Buttons offered:** none of its own.
**Not reachable for this account.**

**What this tells us about the product:** the permission `Web Projects` opens the group, but three
screens inside it carry a **second, admin-only gate** — capacity/workload, client dashboards and
revenue. Those are exactly the three subjects an agency would keep from staff: who is overloaded,
what each client sees, and what the work earns.

---

# 5. The chain — CRM lead → project → money

This was the thing nobody had written down. Here is what can be proved from what renders, and
where the chain goes dark for this account.

**Backwards: a won lead becomes a *linked* project, and the lead stays a lead.**

- The **only** way to create a project is `Import from CRM`. There is no blank project form
  anywhere in the group.
- The lead list it offers is fetched as
  `/api/crm/leads?stages=IN_PROGRESS,RECURRING,CLOSED&unlinked=1`, and the dialog says so in
  plain words: *"Showing won CRM leads (In Progress, Recurring, Closed) that aren't linked to a
  project yet."*
- Two facts follow from that one request. **"Won" means one of three CRM stages** — In Progress,
  Recurring or Closed — not a single "Won" stage. And **`unlinked=1` proves the link is
  one-to-one**: once a lead has a project, it drops out of the list forever, so a lead can never
  spawn two projects.
- The lead is **not** consumed. It keeps living in the CRM with its own money fields — the payload
  for each lead carries `value`, `originalValue`, `currency`, `paymentStatus`
  (`PAID` / `PARTIALLY_PAID` / `NOT_PAID`), `paymentBillingMode` (`MILESTONE` / `RECURRING`) and an
  `invoiceDefaults` block (bill-to company, address, tax id, PO number, payment terms, bill-to
  email and phone).
- The import copies the lead's company into **two** new editable fields, `Project Name` and
  `Client / Company Name`, so a project's client name starts as the lead's company but can then
  drift from it. That is visible on the Board, where the project filter lists `testtttttt` while
  the client filter lists `testt555` — the same record, two different names.

**Forwards: the money is tracked on the lead's payment milestones, and the project's issues hang
off those same milestones.**

- The Board's milestone filter offers `Milestone 1 - Advance · Italica`,
  `Milestone 2 - Sprint Close · Italica`, `Milestone 3 - Go-Live · Italica` and
  `Full Payment · testtttttt`. These are **payment** milestones, not delivery phases — "Advance",
  "Sprint Close", "Go-Live", "Full Payment" is a payment schedule.
- The same milestone names appear on the CRM side: the Payment Calendar at `/crm/milestones`
  (captured by terminal N3) lists payment milestones **belonging to leads**, including
  `Italica → Milestone 2 - Sprint Close` with a part-paid caption
  *"INR 10,000 received · INR 250,000 left"*.
- So one milestone row does double duty: **on the CRM side it is an instalment to collect; on the
  project side it is the tag that says which issues that instalment pays for.** A card even shows
  its milestone's own lateness — `Milestone 1 - Advance · 11d over` — meaning a developer sees the
  client's unpaid instalment on the issue itself.
- **Invoices.** The invoicing details (`invoiceDefaults`: bill-to company, address, tax id, PO
  number, payment terms) sit **on the CRM lead**, not on the project. So the chain runs
  *lead → its payment milestones → an invoice raised from the lead's details*, with the project
  supplying the delivery evidence rather than the billing data.

**Where the chain goes dark, honestly:** there is **no button anywhere in this group that links to
Finance**. Not on the Board, not on a card, not in the issue drawer. The only forward link a card
offers is the project name, pointing at `/projects/<projectId>` — and that screen answers
`403 Forbidden` for this account, rendering **`Project not found`**. If a "raise an invoice for this
milestone" button exists, it lives on that project detail screen or on the CRM/Finance side, and
**this document cannot claim to have seen it.**

## 5.1 The project detail screen — attempted, not reachable

Three project ids were tried, taken from the Board's own card links:

| Address | Result |
|---|---|
| `/projects/cmrxcqrpj0002tjg0dozuomhv` (Italica) | `403 {"error":"Forbidden"}` → page renders **`Project not found`** |
| `/projects/cmshoj9d70007g75yirvadiqu` (testt222) | same |
| `/projects/cms9z4ibr000yxuh5hc2yqnal` (Stave Corp IN_PROGRESS - 8) | same |

The screen renders nothing but the shell and those two words — no tabs, no panels, no milestones,
no team, no budget-vs-spent, no files, no status timeline. **Every one of those was in my brief and
none of them could be opened.** Not guessed, not inferred from code — recorded as unreachable.

What can still be said about it *from the outside*, because other screens name its parts:

- It exists as a real screen and every board card links to it.
- It owns **repository settings** — the import dialog says *"You can also manage repos later in
  Settings"* and the new-issue dialog points at *"Settings → Your GitHub Account"*.
- It has **milestones, sprints and a team**, because the Board's filters are built from them,
  labelled per project (`Sprint 1 — Mobilization & Environment Lock · Italica`).
- It has a **project status** — the import form's five values (`Planning`, `Under Development`,
  `On Hold`, `Completed`, `Off boarded`) must be shown and changed somewhere.
- It has a **client-facing portal**, because two separate screens mention it: the issue drawer's
  *"Only client-visible tasks appear in the public portal"* and the new-issue form's
  *"Visible to the client in the portal"* checkbox.

---

# 6. Counts, for the record

| | |
|---|---|
| Addresses opened | **6** (3 in scope + 3 previously unopened) + 3 project-detail ids |
| Screens that rendered content | 3 (`/projects`, `/projects/board`, `/projects/my-work`) |
| Screens that answered with an admin-only notice | 3 (`capacity`, `clients`, `revenue`) |
| Dialogs / drawers / editors / panels opened and cancelled | **13** — Import Client from CRM · its lead picker · its repository picker · Board Columns · New issue · the issue drawer (GitHub issue) · the issue drawer (local issue) · Edit labels · Link a pull request · Edit description · Edit title · Change estimate · the bulk-select bar |
| Dropdowns fully listed | **27** — 9 board filters · 8 in New issue · 7 in the issue drawer · 2 in Import from CRM · 1 in the bulk bar |
| Searchable pickers fully listed | **3** — 20 eligible CRM leads · 10 GitHub repositories · 37 repository labels |
| Longest single option list | 59 (the board's label filter) |
| Nothing was saved, submitted, deleted, moved or sent | ✅ |

---

# In human language — every feature in this area, as points

- **One place that lists every client and every project the agency is building.** He clicks Web
  Projects, then All Clients/Projects. It is the master register — the answer to "who are we
  building for right now, and what are we building". For this demo login it shows nothing, because
  the list only shows projects you personally belong to.

- **A project can only be born from a won sale.** There is no "make a blank project" button
  anywhere. He clicks Import from CRM, and the app shows him only the deals that were actually won
  and don't already have a project. This is the rule that stops the delivery side and the sales
  side from ever drifting apart — if work is happening, a real signed client is behind it.

- **A deal can only ever become one project.** Once a deal has been turned into a project, it
  vanishes from that list, so nobody can accidentally start the same job twice.

- **Filling in the new project takes six things.** He picks the won deal, optionally picks the code
  folders it lives in, then types the project name and the client's name, chooses a starting status,
  and can write a short description. The client and project names start off the same but can be
  changed independently later.

- **A project has five life stages.** Planning, Under Development, On Hold, Completed, and Off
  boarded. That last one is how a finished client is retired without being deleted.

- **Projects are wired to the real code.** When creating a project he can attach the agency's actual
  code folders from GitHub, and mark what each one is — the website part, the server part, one
  combined folder, the phone app, or the infrastructure. One of them is starred as "the main one",
  and new work items get filed there by default.

- **One giant shared work board for the whole agency.** He clicks Web Projects, then Board. Every
  single job across every client sits on one screen, in six columns from Backlog through to Done.
  This is the "what is everybody doing" view — it is the busiest screen in the product.

- **The board shows six headline numbers before you read a single card.** How many jobs are open
  (and how many are finished), how many are waiting to be checked, how many are late, how many are
  due this week, how many nobody has picked up, and how many hours of work are left against how many
  have been spent.

- **Three of those numbers are also buttons.** Tapping "late", "due this week" or "nobody's got
  this" instantly narrows the whole board to just those jobs. Tap again to go back.

- **A row of faces across the top shows the team's load at a glance.** Each person's photo carries
  their number of open jobs and, in red, how many of theirs are late. Hovering says it in words —
  "3 open, 2 overdue, 16 hours estimated". Tapping a face shows only that person's work. This is the
  fastest way to spot who is buried and who is free.

- **Nine ways to narrow the board.** By project, by client, by urgency, by kind of work, by sprint,
  by payment milestone, by code folder, by any of 58 tags, and by when it is due. Plus a search box
  that looks through job titles, project names, people and tags all at once.

- **One switch hides everything already finished,** so the board shows only live work. It
  remembers which way it is set until you flip it back.

- **A "Clear" button appears the moment anything is filtered,** so he is never stuck wondering why
  the board looks half empty.

- **Every job is a card, and the card tells the story without being opened.** Which client, which
  code folder and its number, the title, what kind of job it is, how urgent, who it belongs to, how
  late it is, which payment milestone it belongs to, its tags, any code change linked to it, and
  hours spent against hours estimated.

- **Cards are dragged between columns to move work along.** Picking one up changes the cursor to a
  hand and the column you are over lights up to show it will take the card. Dragging a card is also
  how time gets logged against a job.

- **The columns themselves can be renamed, recoloured, reordered and added to.** He clicks Columns.
  The screen warns him honestly that these columns are shared by every project and renaming one
  moves every job sitting in it — so this is a decision for the whole agency, not one client.

- **Several jobs can be handled at once.** Hover a card and a tick box appears; there is also a
  "tick everything in this column" button. Once anything is ticked, a bar appears at the bottom
  offering to move them all to another column, or delete them.

- **Creating a new job asks for fourteen things** — which project, the title, a description, the
  kind of job, how urgent, which column it starts in, who does it, which payment milestone and which
  sprint it belongs to, when it starts, when it is due, how many hours it should take, which code
  folder it goes in, and whether the client is allowed to see it.

- **The description box is a proper writing tool** — bold, italic, strikethrough, headings, bullet
  and numbered lists, tick-lists, quotes, code, links, image and video attachments, and a preview
  button.

- **Nobody can create a job until they have connected their own GitHub account.** The app tells him
  exactly why in plain words: jobs are filed on GitHub under the person's own name, so the app needs
  their personal key first. This means the code history always shows a real human, never a robot.

- **Jobs created here appear on GitHub automatically, and the other way round.** The new-job window
  says it outright: filed in the portal and mirrored to the linked code folder. The board is showing
  live GitHub issues, not a copy someone has to keep updated.

- **Clicking a card opens a full job sheet over the board** — big enough to work in, and it never
  loses your place on the board behind it.

- **The job sheet links straight out to GitHub, and can copy its own link to send someone.**

- **The job's title and description can both be edited in place**, and an empty description shows a
  friendly "click to add one" instead of a blank space.

- **Tick-lists inside a job actually work.** If the description has an acceptance-criteria list,
  each line is a real tick box that can be ticked off as the work is done.

- **Screenshots and files live on the job.** Images pasted into the description show inline, and
  there is an "Add Document" button for anything else.

- **One button pushes a job into review** when it is ready, and it only shows up when the job has
  reached the right stage.

- **Every job carries an activity history with its own filters** — this week, this month, a custom
  range, five or ten or twenty at a time, and a search box for finding a specific note.

- **Anyone can comment on a job, and the comment goes to GitHub under their own name.** On jobs
  that only exist inside the app, the comment stays inside the app and it says so.

- **A job can be closed from inside the app** without going to GitHub.

- **Each job has a client-visibility switch.** By default a job is internal only; flipping it makes
  it appear in the client's own portal. This is how the agency decides exactly what the client sees
  and what stays behind the curtain.

- **Nine things about a job can be changed from the side panel** — its column, its client
  visibility, who owns it, what kind it is, how urgent, its sprint, its payment milestone, its start
  and due dates, and its tags.

- **Code changes attach themselves to jobs automatically.** If a developer names their branch
  after the job number, or writes "fixes #2" in it, the app links them without anyone doing
  anything. They can also be linked by hand.

- **Time is tracked on every job, two ways, without a stopwatch.** Moving the card along the board
  logs time, and a developer can also write "20m" in a code commit message. The job sheet shows
  hours spent against hours estimated with a progress bar and a percentage, and a manager can
  correct the estimate.

- **The time spent can be broken down by where it came from and by which person spent it** — the
  panels are there, though this login sees no figures in them.

- **Jobs can exist without any code at all.** A job with no code folder is clearly marked "Local
  issue — not on GitHub", which means non-technical work (a phone call to chase a client, a
  document to send) lives on the same board as the coding.

- **Team members without a GitHub account are flagged.** When picking who does a job, anyone whose
  GitHub is not connected is labelled so, so nobody is assigned work that then cannot be filed.

- **The board refreshes itself every minute,** and there is a refresh button for when he cannot
  wait. So two people looking at the board are looking at the same thing.

- **A personal to-do view showing only his own work.** He clicks Web Projects, then My Work.
  Everything assigned to him from every client, grouped into the same six columns as the big board,
  with a count of how many are open. This is the "what do I do today" screen, as opposed to the "what
  is everybody doing" screen.

- **My Work can also show what he has already finished,** with one tick box, so a person can see
  their own week.

- **When he has nothing assigned, it says so kindly** — "All clear. Nothing assigned to you right
  now." — rather than showing an empty grid.

- **My Work is not the same list as Global Tasks.** They are two separate boards: My Work is his
  slice of the web-project work, Global Tasks is the agency's general task list.

- **A team-capacity and workload screen exists, and only administrators can see it.** Anyone else
  is told plainly: capacity and workload data are for administrators only. This keeps who-is-
  overloaded a management matter.

- **Client dashboards exist, and only administrators can see them.** Everyone else gets a short
  notice and a link back to the projects list.

- **A revenue screen exists, and only administrators can see it.** Its notice says revenue and
  financial figures are for administrators only — so a developer on the board can never see what
  the job is worth.

- **The payment milestones from the sales side are the same milestones the work hangs off.**
  "Advance", "Sprint Close", "Go-Live", "Full Payment" — a job on the board is tagged with the
  instalment it belongs to, and the card even warns when that instalment is overdue. This is the
  single thread that ties the money to the work: the accounts team and the developers are looking
  at the same milestone from two ends.

- **Each project has its own client-facing portal,** which is why every job carries a
  "client can see this" switch. The client sees the jobs the agency chose to show, and nothing else.
