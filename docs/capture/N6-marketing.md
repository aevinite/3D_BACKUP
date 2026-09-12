# N6 — Marketing (all five screens)

**Site:** Nexeor Agency OS v2.0 — `https://os-staging.product.nexeor.com`
**Captured:** 2026-09-07, signed in as the shared demo account (`demo_om85i@demo.agency`).
**Scope:** the whole **Marketing** sidebar group — `/marketing` (Overview), `/marketing/clients`,
`/marketing/calendar`, `/marketing/tasks`, `/marketing/ideas` — plus everything those five screens
lead into.

> **Honesty note.** All five screens opened normally with this account — **no locked screen
> anywhere in Marketing**. Everything below was captured by driving a real browser: every button
> clicked, every dialog opened, every dropdown listed. Two exceptions, both deliberate:
> 1. **I never clicked `Delete Client`, `Delete Project`, `Delete idea`, `Create`, `Save` or
>    `Submit`.** Where the behaviour of a destructive or saving control matters, I read it out of
>    the page's own shipped JavaScript and marked it **`[from code]`** — every string quoted there
>    is a literal in the app's own bundle, but it was not seen on screen.
> 2. **Drag-and-drop is described, never completed** (rule from RULES.md §1). Where a board is
>    draggable I say so, and the rules that govern a drop are `[from code]`.
>
> The screens hold real client names and real numbers. Nothing was created, edited or deleted.

**Where this group lives.** Left sidebar, third block: brand ("Agency OS / NEXEOR"), then two
standalone items (**My Portal**, **Global Tasks**), then five collapsible groups — Sales,
**Marketing**, Web Projects, Finance, HR — then **Sign Out**. Opening **Marketing** reveals five
sub-items, and **the sidebar label matches the address in all five cases** (no drift here):

| Sidebar label | Address | Page heading (differs from the label — record both) |
|---|---|---|
| Overview | `/marketing` | **Marketing Command Center** |
| Clients | `/marketing/clients` | **Client Workspaces** |
| Calendar | `/marketing/calendar` | **Calendar** |
| Tasks | `/marketing/tasks` | **Global Marketing Tasks** |
| Ideas | `/marketing/ideas` | **Marketing Ideas Repository** |

Every one of these five screens ends with the same footer strip:
`POWERED BY NEXEOR • COPYRIGHT © 2026 NEXEOR CREATIVE TECHNOLOGIES`.

**Three more screens hang off this group** and are captured here too, because you cannot describe
Clients without them:

| Screen | Address | Reached from |
|---|---|---|
| Client detail ("workspace") | `/marketing/clients/<clientId>` | Clients → a row → **Open Full Workspace** |
| Project workspace | `/marketing/projects/<projectId>` | Client detail → **Full Workspace** |
| Public client portal | `/share/<publicToken>` | Client detail → the share strip → **Preview** |

**Money is in AED** everywhere in this group (`AED 8,076`), with one exception noted in §2b.

---

# 1. Overview — `/marketing`

**Where:** sidebar → Marketing → **Overview**. No tabs, no sub-pages.

**What you see on arrival.** A single scrolling page, max width 1600px. Top-left: the title
**"Marketing Command Center"** and the subtitle *"Overview of campaigns, content, and tasks."*
Top-right: two buttons — an outlined **`View All Clients`** and a white **`New Project`**. Below
that the page splits into two columns (three-column grid; content takes two, the rail takes one):
the **left/wide column** holds *Content Needing Approval* then *Live Campaigns*; the **right rail**
holds *My Tasks* then *Active Clients*.

**Numbers/cards on the page.** There are **no KPI tiles, no charts, no filters and no date-period
selector on this screen at all** — it is four live lists, not a dashboard of figures. (If you are
looking for the marketing numbers: ad spend and ROAS live on the client detail screen §2b and the
project workspace's *Ad Performance* tab §2d.) The only figures are inside the lists:

| Section | What it lists | Live values as captured |
|---|---|---|
| **Content Needing Approval** (amber image icon) | content sitting in review | **empty** — *"All caught up! No content pending review."* |
| **Live Campaigns** (rose megaphone icon) | every campaign with status ACTIVE | **5 rows**: Phase 1 Awareness Surge — Nexus Dynamics — BUDGET **AED 8,076** · Phase 2 — Nexus Dynamics — **AED 6,933** · Phase 3 — Nexus Dynamics — **AED 6,905** · Phase 1 — Horizon Retail — **AED 15,437** · Phase 2 — Horizon Retail — **AED 12,769** |
| **My Tasks** (emerald tick icon) | tasks assigned to the signed-in person | **empty** — *"No pending tasks."* |
| **Active Clients** (indigo briefcase icon) + a **`View All`** link | client shortcuts with a project count | **3 rows**: Velocity Fitness · 1 Projects · Horizon Retail · 1 Projects · Nexus Dynamics · 1 Projects |

**Controls, in the order they appear:**

1. **`View All Clients`** (outlined, grid icon) → navigates to `/marketing/clients`. It is a plain link.
2. **`New Project`** (white, plus icon) → **also navigates to `/marketing/clients`**. It opens no
   dialog; the real project-creation form lives on the client detail screen (§2b).
3. **`View All`** (tiny indigo text, top-right of *Active Clients*) → `/marketing/clients`.
4. **Each Active Clients row** → `/marketing/clients/<clientId>`. These are the only clickable rows
   on the screen.
5. **Live Campaigns rows** — styled as if clickable (hover highlight, a grey right-arrow on the
   right) but **`[from code]` they carry no click handler**: nothing happens.
6. **My Tasks rows** — same: `cursor-pointer` styling, no handler.
7. **Approval cards** — same: hover turns the border amber, but no handler.

**Every form/dialog it opens:** **none.** This screen has no dialog of its own.

**What each row shows `[from code]`, so you can rebuild it:**

- *Approval card* (2-across grid when populated): amber **"Review"** pill · the item's scheduled
  date (short local date) · the title · then `<client name> • <platform>`, falling back to
  *"Unknown Client"*.
- *Live campaign row*: rose megaphone avatar · campaign name · client name underneath · right side
  **"BUDGET"** over `AED <amount>` (thousands separated, `0` if unset) · a grey arrow.
- *My Tasks row*: a small square checkbox outline (**rose outline if the priority is HIGH**,
  otherwise white) that fills emerald on hover · the task title · then
  `<client name or "General"> • <due date>`.
- *Active client row*: client name · a pill reading `<n> Projects`.

**Empty states (all four, exact words):**
- Approvals — *"All caught up! No content pending review."* (dashed border box)
- Campaigns — *"No active campaigns."* (italic)
- My Tasks — *"No pending tasks."*
- Clients — *"No clients added yet."* (italic)

**Loading and failure `[from code]`:** while loading, the whole page is the single line
**"Loading Marketing OS..."**. If the one API call fails you get a dashed rose panel: an alert icon,
**"System Error"**, the message *"Failed to load dashboard data. Please check database connection."*
(or *"Could not fetch data"*), and a **`Retry`** button that simply reloads the page.

**Realtime/auto:** none. One call, `GET /api/marketing/dashboard`, on mount. Nothing polls, nothing
moves on its own; `Retry`/refresh is the only way to update it.

### Odd things I noticed — `/marketing`
- **`New Project` does not create a project.** It is a link to the client list.
- **Three of the four lists are dead ends** — campaign rows, task rows and approval cards all look
  clickable and do nothing. Only client rows navigate.
- The Live Campaigns list ignores the campaign's own dates: all five rows ran **Apr 1 → May 30,
  2026**, i.e. they were over three months before the capture date, yet they are listed as "Live"
  purely because `status = ACTIVE`.
- The heading calls this a "Command Center" but there is **not one number tile** on it.

---

# 2. Clients — `/marketing/clients`

**Where:** sidebar → Marketing → **Clients**.

**What you see on arrival.** Heading **"Client Workspaces"** with the subtitle *"Manage active
retainers, campaigns, and content workflows."*; on the same line, right-aligned, a **search box**
("Search brands…", 320px on desktop) and a white **`Add Client`** button. Below: one **fat row per
client**, stacked vertically (not a table — no column headers). Each row is a card that **expands in
place when clicked**.

**This is a list of 3 clients.** Live values as captured:

| Avatar | Client | Status control | Industry | Overdue | Projects | Open Tasks |
|---|---|---|---|---|---|---|
| **V** | Velocity Fitness | IN PROGRESS | Health & Wellness | **17 Overdue** | **1 Active** | **23 Pending** |
| **H** | Horizon Retail | IN PROGRESS | E-Commerce | **14 Overdue** | **1 Active** | **21 Pending** |
| **N** | Nexus Dynamics | IN PROGRESS | SaaS Tech | **17 Overdue** | **1 Active** | **22 Pending** |

**The row, left to right:** a 48px rounded avatar holding the client's first letter · the client
name (bold, 18px) · a small **external-link icon** next to the name that opens the client's own
website in a new tab (`https://velocityfitness.com` etc.) · underneath the name, the **status
dropdown** and then the industry after a divider · then a rose pill `<n> Overdue` with a clock
icon · then two stat columns, **PROJECTS** `<n> Active` and **OPEN TASKS** `<n> Pending` · then a
chevron on the far right that rotates when the row is open. The three middle columns are hidden
below the `md` breakpoint (name, status and industry survive on a phone).

**Row controls:**

1. **The row body** (anywhere except the status dropdown and the website icon) → **expands the row
   in place**; it does not navigate.
2. **The status dropdown** — a real `<select>` **that writes immediately on change**, so I read its
   options and left it alone. Current value for all three rows: `ACTIVE`. **Complete list, all 4:**

   | Stored value | What the screen shows | Colour |
   |---|---|---|
   | `ONBOARDING` | **ONBOARDING** | blue |
   | `ACTIVE` | **IN PROGRESS** | emerald |
   | `PAUSED` | **ON HOLD** | amber |
   | `CHURNED` | **OFFBOARDED / CLOSED** | rose |

3. **The website icon** → the client's site in a new tab.

**The expanded row** (captured on Velocity Fitness) adds a three-part panel:

- **`Open Full Workspace`** button → `/marketing/clients/<clientId>` (the detail screen, §2b).
- **ACTIVE PROJECTS** — one card per project: the project name (a link to
  `/marketing/projects/<id>`), a status pill (**On Track**), a **progress percentage** (`21%` for
  Velocity Fitness, 29% Horizon Retail, 22% Nexus Dynamics), then four chips that deep-link into the
  project workspace's tabs: **Tasks** (`?tab=tasks`), **Calendar** (`?tab=calendar`), **Campaigns**
  (`?tab=campaigns`), **Ads** (`?tab=ads`). Below them a **`+ New Project`** button.
- **NEXT DELIVERABLES** — *"No upcoming tasks"* for all three clients.
- **CAMPAIGN PERFORMANCE** — **Ad Spend (MTD)** `$0` and **ROAS** `0.0x`, footnoted
  *"Updated real-time"*. **Note the currency: this one panel prints `$`, while every other money
  figure in Marketing is `AED`.**

**Sort / filter / page size:** there is **no sort control, no filter and no pagination** — the search
box is the only narrowing tool, and it filters as you type. Empty result:

> **No clients found** — *"Your search didn't return any active workspaces. Try adjusting filters or
> create a new client."* with a **`Create New Client`** button.

**Realtime/auto:** none. One call, `GET /api/marketing/clients`, on mount.

## 2a. Dialog: `Add Client` → "New Client Workspace"

A centred modal, max width 640px. **Two modes, chosen by a segmented pair at the top** — the default
is **FROM CRM DEAL**:

**Mode 1 — `From CRM Deal` (default).** A scrolling pick-list (max 280px tall) of CRM deals, each row
showing the **deal name** on top and the **service** underneath, with a radio circle on the right.
The 11 deals offered at capture time:

| Deal | Service |
|---|---|
| Stave Corp IN_PROGRESS - 2 | PPC Campaigns |
| Stave Corp RECURRING - 4 | Website Dev |
| Stave Corp RECURRING - 2 | SEO Optimization |
| Stave Corp CLOSED - 5 | Website Dev |
| Stave Corp RECURRING - 1 | SEO Optimization |
| Stave Corp RECURRING - 5 | App Development |
| Stave Corp CLOSED - 1 | Branding |
| Stave Corp RECURRING - 3 | App Development |
| Stave Corp CLOSED - 4 | App Development |
| Stave Corp CLOSED - 3 | PPC Campaigns |
| Stave Corp CLOSED - 2 | Social Media |

**Mode 2 — `Manual Entry`.** Three text fields, none marked required:

| Field | Type | Placeholder / default |
|---|---|---|
| **BRAND NAME** | text | `Acme Corp` |
| **INDUSTRY** | text | `SaaS, Fashion...` |
| **WEBSITE** | text | `https://...` |

**Shared by both modes:** a divider then **SLACK CHANNEL ID (OPTIONAL)**, text, placeholder
`e.g. C012345678`.

**Buttons:** an **✕** top-right, then **`Cancel`** and **`Create Workspace`**.

---

# 2b. Client detail / "workspace" — `/marketing/clients/<clientId>`

**Where:** Clients → click a row → **`Open Full Workspace`** (or the Overview's Active Clients
rows). Captured on **Velocity Fitness** (`cmnyxtzxy003dj97l9ju2b2x7`). **This is the deepest screen
in the group.**

**What you see on arrival.** A **`← Back to Directory`** link (mono, tiny) → `/marketing/clients`.
Then a header block: a 64px indigo avatar with the initial **V**, the client name **Velocity
Fitness** at 30px, and under it two meta items — a briefcase icon + **Health & Wellness**, and a
globe icon + **Website** (a link to the client's own site). Right-aligned: the **share-link strip**
and a white **`New Project`** button. A hairline divider, then **two tabs**, then a
three-column body: content on the left (two columns wide) and a **right rail of four panels**.

**Numbers/cards on the page** (right rail, top to bottom):

| Panel | Rows / tiles | Live values |
|---|---|---|
| **ACCOUNT DETAILS** | Industry · Account Owner · (`[from code]` a **Stage** row also exists, shown for clients that came from a CRM lead) | Health & Wellness · **—** |
| **AGENCY STATS** | two big numbers: **Projects**, **Active Campaigns** | **1** · **0** |
| **INTEGRATIONS** | **Slack Notifications** + a count line | **1 Active Channels** (`[from code]` reads **"Not Connected"** when no project has a channel) — plus a pencil button, title **"Edit Integrations"** |
| **DANGER ZONE** (rose border) | the warning text and one button | *"Permanently delete this workspace, including all of its projects, tasks, and uploaded vault assets. This action is irreversible."* → **`Delete Client`** |

**Tabs (2):**

1. **`Active Projects (1)`** — the default. A section headed *Active Projects* with one card per
   project: the project name (18px bold), the description or *"No description"*, a status pill
   (**ACTIVE**), a **`Full Workspace ↗`** link, then a footer row of four deep links —
   **Plan & Tasks (28)** · **Calendar (15)** · **Campaigns** · **Ad Metrics** — and, right-aligned,
   **"Updated 6/29/2026"**. The two counts come from the project's task and content totals.
   `[from code]` empty state: **"No projects started"** / *"Create a workspace to start assigning
   tasks."* / a **`Create First Project`** button.
2. **`Master Assets (0)`** — the client's file vault. See §2b-2.

**The share-link strip** (top right, before `New Project`) — a bordered pill containing the
truncated public address `.../share/cmnyxt...` and **three icon buttons**:

| Icon | Title | What it does |
|---|---|---|
| copy | **Copy Link** | copies the public portal address to the clipboard |
| eye | **Preview** | opens the client-facing portal in a new tab — `/share/<publicToken>` (§2c) |
| refresh (turns rose on hover) | **Regenerate** | `[from code]` confirms first — *"This will invalidate the old link. Continue?"* — then issues a new token |

## 2b-1. Dialogs on the client detail screen

**`New Project` → "Create Workspace"** (modal, 640px):

| Field | Type | Placeholder |
|---|---|---|
| **PROJECT NAME** | text | `e.g. SEO Retainer 2026` |
| **DESCRIPTION** | text | `Brief goal of this project...` |

Buttons: **✕**, **`Cancel`**, **`Launch Project`**.

**pencil → "Configure Slack Settings"** (modal, 640px): an explainer line — *"To find a Slack Channel
ID: Right-click any channel in Slack → View Channel Details → Scroll down to find Channel ID at the
very bottom. Leave blank to disable."* — then **one text field per project of this client**, each
labelled with the project name. For Velocity Fitness: **Q2 Digital Retainer**, prefilled
`C0ANJJRB94H`, placeholder `e.g. C012345678`. Buttons **`Cancel`** / **`Save Configuration`**.
`[from code]` failure message: *"Failed to save Slack Channels"*; if the client has no projects the
dialog reads **"No projects exist yet. Create one first."**

**`Delete Client`** — **not clicked.** `[from code]` it is a one-step browser confirm:
> *"Are you absolutely sure you want to permanently delete this client and ALL associated data?"*

Accepting sends `DELETE /api/marketing/clients/<id>` and then redirects to `/marketing/clients`; a
failure shows the browser alert *"Failed to delete client"*. There is no type-the-name step and no
undo.

## 2b-2. Tab: `Master Assets` — the client vault

**What you see:** a dark card. Top-left a breadcrumb starting at **`Vault Root`** (clickable);
top-right two buttons, **`New Folder`** and **`Add Link`**. Under that the section label **ROOT
ASSETS**, then a **dashed drop zone** — *"Drop files instantly to the root vault"* — which is also a
file input (click to pick). Below it the list, currently the empty state **"No files or links
here."** `[from code]` there is also a **Directories** block for folders, an **"Uploading
securely..."** state, and the narrower empty states **"No files uploaded."** and **"No web links
saved."**

**Dialogs:**

| Dialog | Fields | Buttons |
|---|---|---|
| **Create New Folder** | **FOLDER NAME** — text, placeholder `e.g. Brand Assets` | ✕ · `Cancel` · `Create Folder` |
| **Add Web Link** | **RESOURCE TITLE** — text, `e.g. Competitor Website` · **URL** — text, `https://...` | ✕ · `Cancel` · `Save Link` |
| **Move Item** `[from code]` | **Select Destination** — a list beginning **"Vault Root (No Folder)"** then every folder | `Cancel` |

`[from code]` the vault's other actions and their exact confirms/errors:
- delete a file or link → *"Are you sure you want to permanently delete this item?"*; failure
  *"Failed to delete asset"*
- delete a folder → *"Are you sure? This will delete the folder AND all assets inside it!"*; failure
  *"Failed to delete folder"*
- other failures: *"Failed to create folder"*, *"Failed to add link"*, *"Failed to move asset"*,
  *"Failed to upload assets securely to vault."*
- uploads are signed server-side (`/api/upload/sign` then `/api/upload`); folders and attachments
  have their own endpoints under `/api/marketing/clients/<id>/…`.
- the whole screen's error state is the single line **"Client not found"**.

**What is NOT on the client detail screen** — worth stating plainly, because it is what an agency
would expect: **there is no retainer or package panel, no monthly fee or contract term, no services
list, no attached people/contacts list, no social-account connections and no deliverable counters
beyond the two per-project numbers (28 tasks / 15 content items).** "Account Owner" exists as a row
but was **—** (empty), and there is no control on the screen to set it. Retainer-ish information
lives only in the project's *name* ("Q2 Digital Retainer") and its type
(`SOCIAL_MEDIA_RETAINER`, stored but never shown).

### Odd things I noticed — Clients + client detail
- **`Add Client`'s CRM list shows deals in every stage**, including eleven rows of which six read
  `CLOSED`, so a closed-lost deal can be turned into a live client workspace with no warning.
- **The status dropdown on the list writes on change with no confirmation and no undo** — the
  mouse-wheel over a focused select is enough to move a client to "OFFBOARDED / CLOSED".
- **The Campaign Performance panel prints `$0`** while the rest of Marketing prints AED.
- **"Active Campaigns: 0" on the client detail contradicts the Overview**, which lists three ACTIVE
  campaigns for other clients and (per the project workspace, §2d) three for this one. The client
  detail's counter reads 0 for all three clients.
- **`Delete Client` is a single browser confirm** for an action described in its own panel as
  irreversible and cascading to projects, tasks and vault files.
- The share strip shows the address truncated to `.../share/cmnyxt...`, which is not enough to read
  or verify the link without clicking Copy or Preview.

---

# 2c. Public client portal — `/share/<publicToken>` (opened by `Preview`)

Not a sidebar screen, but it is the client-facing half of the Clients feature, so it belongs here.
Captured at `/share/cmnyxtzxy003ej97lzks126av`.

**What you see:** an **NX** mark, the client name **Velocity Fitness**, three tabs — **Content
Calendar** · **Master Assets** · **Live Performance** — then the heading **"Marketing Overview"**
with *"Real-time updates on your campaigns and content."*

**Tab 1 — Content Calendar (default).** A month grid (**September 2026**, SUN→SAT, a **TODAY**
marker) with a **`Today`** button and prev/next arrows, then a **TIMELINE VIEW** list underneath:
one row per content item showing month, day, a **status word** and the title, plus the caption
preview or *"No caption preview"*. Statuses seen on the client's own view: REJECTED, APPROVED, DONE,
TODO, PUBLISHED, CHANGES REQUESTED, SCHEDULED, DESIGN, DRAFTING, IN PROGRESS, REVIEW.
**Clicking an item** opens a right-side drawer showing the weekday and date (e.g. *"THURSDAY,
JANUARY 1"*), the title, and **CURRENT PIPELINE** with the status — **and nothing else: no approve
button, no comment box, no reject.** Only a close ✕ (Escape does not close it).

**Tab 2 — Master Assets.** *"Access shared folders, files, and submit brand reference links
directly."* One button, **`Submit Reference Link`**, then **ROOT VAULT RESOURCES** and the empty
state **"Vault Empty"** / *"Use the "Submit Reference Link" button above to inject URLs directly into
your agency dashboard."*
**Dialog — "Submit Reference Resource":** **RESOURCE NAME** (text, `e.g., Q3 Brand Moodboard`) and
**TARGET URL** (url, `https://drive.google.com/...`); buttons **`Cancel Request`** and
**`Deposit Link →`**.

**Tab 3 — Live Performance.** **This tab crashes the portal.** The whole page is replaced by
*"Application error: a client-side exception has occurred while loading os-staging.product.nexeor.com"*.
The console error is `TypeError: Cannot read properties of undefined (reading 'length')`. Reproduced
twice; the only way back is a reload.

### Odd things I noticed — public portal
- **The client's "Live Performance" tab is broken** (above) — and it is the tab a paying client is
  most likely to open.
- The portal shows the client **every internal status verbatim** — `REJECTED`, `CHANGES REQUESTED`,
  `DESIGN`, `DRAFTING` — with no friendlier client-facing wording.
- The calendar opens on **the current month**, which was empty; all the real content sits in April–May
  2026, so a client lands on a blank grid.
- The item drawer is read-only, so **there is no way for a client to approve anything from the
  portal** even though the agency side has a "Client Approval" status waiting for exactly that.

---

# 2d. Project workspace — `/marketing/projects/<projectId>`

**Where:** client detail → **`Full Workspace`**, or any of the four deep-link chips. Captured on
**Q2 Digital Retainer** for Velocity Fitness (`cmnyxu04u003gj97lzhbu42fv`).

**What you see:** header — project name **Q2 Digital Retainer**, an **ACTIVE** pill, and the client
name **Velocity Fitness** as a link back to the client detail. Right side, four buttons:
**`Log Spend`** · **`New Post`** · **`New Task`** · **`New Idea`** (and a **`Delete Project`**
button, rose). Then **four tabs**, driven by `?tab=`:

| Tab | `?tab=` | What it shows |
|---|---|---|
| **Plan & Tasks** | default | the **Workspace Board** — a 7-lane kanban of this project's tasks |
| **Content Calendar** | `calendar` | the **Social Calendar** + an Instagram-style preview + the **Content Pipeline** table |
| **Campaigns** | `campaigns` | **Marketing Campaigns** — one card per campaign |
| **Ad Performance** | `ads` | the **Ad Spend Log** table |

**Tab: Plan & Tasks.** Controls: **Search tasks…**, three `<select>` filters and a **`Sort`** menu.
The filter option lists in full:

| Filter | Options |
|---|---|
| Assignee | All Assignees · Amal Vijayakumar · Navaneeth B · Syeda Umme Kulsum · Kartik Kittad |
| Campaign | All Campaigns · Phase 1 Awareness Surge · Phase 2 Awareness Surge · Phase 3 Awareness Surge |
| Priority | All Priorities · P0 Urgent · P1 High · P2 Medium · P3 Low |

Lane counts as captured: **BACKLOG 4 · TO DO 13 · IN PROGRESS 7 · REVIEW & APPROVAL 1** (and the
remaining lanes further right). `[from code]` this board's lane→status map differs from the global
one in a single, important way — **this board's *In Progress* lane also holds `DRAFTING` and
`DESIGN`**:

| Lane | Statuses it collects |
|---|---|
| Backlog | `BACKLOG`, `CHANGES_REQUESTED` |
| To Do | `TODO` |
| **In Progress** | `IN_PROGRESS`, **`DRAFTING`**, **`DESIGN`** |
| Review & Approval | `REVIEW`, `CLIENT_APPROVAL` |
| Approved / Done | `APPROVED`, `SCHEDULED`, `DONE` |
| Published | `PUBLISHED` |
| Rejected | `REJECTED` |

Cards in the Backlog lane carry a **"REVISION REQUESTED"** ribbon when the underlying status is
`CHANGES_REQUESTED`.

**Tab: Content Calendar.** Section label **SOCIAL CALENDAR** with two buttons — **`Import
Calendar`** and **`Add Post`** — then the month name, a **Publish Date | Internal Due** pair and a
**Month | Week** pair, then the grid. To the side, a **phone mock-up preview** of the feed: a status
bar (`9:41`), the handle **Brand_Account**, **38 Posts** and **4.5k Followers**, and a grid of the
scheduled posts (each showing its status word). Underneath, **Content Pipeline — 38 Active Posts**,
a real table:

| Column | Notes |
|---|---|
| **PLATFORM** | shows a rose button reading **`MISSING PLATFORMS`** when the item has no platform set |
| **POST TITLE** | |
| **STATUS** | PUBLISHED / CHANGES REQUESTED / APPROVED / SCHEDULED / DESIGN / DRAFTING / IN PROGRESS / REVIEW / DONE / TODO |
| **PUBLISH DATE** | e.g. *Sat, Apr 4* |
| **INTERNAL DUE** | e.g. *Fri, Apr 3* |
| **ASSIGNEE** | *Unassigned* where empty |

**Tab: Campaigns.** Label **MARKETING CAMPAIGNS** + a **`New Campaign`** button, then one card per
campaign: name, objective (*"High volume brand awareness and click-throughs"*), the start date, and
**SPEND** vs **BUDGET**. Live values for this project: Phase 1 — AED 0 / **AED 17,786** · Phase 2 —
AED 0 / **AED 14,210** · Phase 3 — AED 0 / **AED 5,271**.

**Tab: Ad Performance.** Label **AD SPEND LOG** + a **`Log Daily Spend`** button, then a table with
**DATE · PLATFORM · SPEND · CLICKS · ROAS** and the empty state **"No ads logged yet."**

## 2d-1. The five dialogs of the project workspace

**`Log Spend` / `Log Daily Spend` → "Create ad log"**

| Field | Type | Required | Default / placeholder |
|---|---|---|---|
| **DATE \*** | date | **yes** | empty |
| **SPEND (AED)** | number | no | `0.00` |
| **CLICKS** | number | no | `0` |
| **LINK TO CAMPAIGN (OPTIONAL)** | select | no | **Standalone Post (No Campaign)** · Phase 1 Awareness Surge · Phase 2 Awareness Surge · Phase 3 Awareness Surge |

Buttons: ✕ · `Cancel` · `Create`.

**`New Post` / `Add Post` → "Create Social Post"** — nine fields, every list complete:

| Field | Type | Required | Options / default |
|---|---|---|---|
| **POST TITLE \*** | text | **yes** | placeholder `e.g. Winter Collection Teaser` |
| **PLATFORM** | select | no | **Instagram** (default) · LinkedIn · TikTok · Facebook · YouTube · Twitter — *6 options* |
| **POST TYPE** | select | no | **Reel / Short Video** (default) · Story · Carousel · Static Image · Article / Text — *5 options* |
| **CAPTION & INSTRUCTIONS** | textarea | no | `Write the caption or leave notes for the designer...` |
| **GO-LIVE PUBLISH DATE** | date | no | **today** (2026-09-07 at capture) |
| **INTERNAL DUE DATE** | date | no | **today** |
| **ASSIGN TO** | select | no | **Unassigned** (default) + 26 named people — Admin, Amal Vijayakumar, Antra Agrawal, Chris george, Deep Sheth, Dhrumil Gadaria, Emaad Sultan, Ganesh S N, Gokulakrishnan R, Info Nexeor, Kartik Kittad, Kevin Norbert, Kingson Thomas, Mathangi Chandu, Megha M, Navaneeth B, Rayan Patel, Rohit Vinod, Sandra KK, Swathikrishna U S, Syeda Umme Kulsum, Test Demo, abcd, akhila kr, ritika, xyz — *27 options* |
| **INITIAL STATUS** | select | no | Backlog · **To Do (Ready)** (default) · In Progress — *3 options only* |
| **UPLOAD REFERENCE MEDIA** | file | no | drop zone — *"Drop inspiration, raw assets, or brand guidelines"* |
| **LINK TO CAMPAIGN (OPTIONAL)** | select | no | Standalone Post (No Campaign) + the 3 phases |

Buttons: ✕ · `Cancel` · `Create`.

**`New Task` → "Create New Task"**

| Field | Type | Required | Options / default |
|---|---|---|---|
| **TITLE / HEADLINE \*** | text | **yes** | `e.g. Design Winter Banner` |
| **DESCRIPTION / NOTES** | textarea | no | `Details...` |
| **PRIORITY** | select | no | P3 - Low · **P2 - Medium** (default) · P1 - High · P0 - Urgent |
| **STATUS** | select | no | **Backlog** (default) · To Do · Internal Review · Client Approval — *4 options only* |
| **ASSIGNEE** | select | no | Unassigned + the same 26 people |
| **INTERNAL DUE** | date | no | **today** |
| **TARGET DATE** | date | no | empty |
| **LINK TO CAMPAIGN (OPTIONAL)** | select | no | Standalone + the 3 phases |

Buttons: ✕ · `Cancel` · `Create`.

**`New Campaign` → "Create campaign"**

| Field | Type | Required | Options / placeholder |
|---|---|---|---|
| **CAMPAIGN NAME \*** | text | **yes** | `e.g. Summer Sale 2026` |
| **TOTAL BUDGET (AED)** | number | no | `10000` |
| **OBJECTIVE** (under the header *STRATEGIC BRIEF*) | select | no | **Select Objective...** · Lead Generation · Brand Awareness · Sales / Conversions · Event Promotion — *4 real options* |
| **TARGET AUDIENCE** | text | no | `e.g. UAE Expats 25-40` |
| **KEY MESSAGE / VALUE PROPOSITION** | textarea | no | `What is the single most important thing they need to know?` |
| **FLIGHT START DATE** | date | no | empty |
| **FLIGHT END DATE** | date | no | empty |

Buttons: ✕ · `Cancel` · `Create`.

**`Import Calendar`** — a two-step bulk importer, and the most rebuildable-worthy piece in the group:

- **Step 1 "Import Calendar"** shows three things:
  - an indigo **AI Generator Prompt** panel — *"Provide this precise instruction block to an LLM like
    ChatGPT or Claude, and it will guarantee a perfectly structured matrix compatible with this
    importer."* — with a **`Copy Prompt`** button (turns emerald **"Copied!"** for 2s). The prompt it
    copies, verbatim `[from code]`:

    ```
    Act as an expert Social Media Manager. Generate a content calendar. Output your response as a
    standard Markdown table so I can easily copy it into Excel/Google Sheets. Include these exact
    headers:
    Title | Description | Platform | PostType | PublishDate | DueDate | Priority | Assignee

    Rules:
    Platform: INSTAGRAM, LINKEDIN, TIKTOK, FACEBOOK, YOUTUBE
    PostType: REEL, STORY, CAROUSEL, STATIC_IMAGE, VIDEO
    Dates: YYYY-MM-DD
    Priority: URGENT, HIGH, MEDIUM, LOW
    ```
  - **Paste Table Data** *(Secondary quick-import method)* — a textarea: *"Highlight the table columns
    directly from Excel, Sheets, or Notion, then press Cmd+V / Ctrl+V to paste the raw Tab-Separated
    payload right here..."*
  - **OR FILE UPLOAD** — *"Click to select CSV/XLSX file..."* / *"Ensure standard calendar columns
    are present natively"*. The spreadsheet is parsed in the browser.
- **Step 2 "Review Imports"** `[from code]` — a wide (1200px) editable review table before anything
  is saved; confirming posts every row to
  `POST /api/marketing/projects/<id>/items/bulk`. Failures alert *"Failed to parse the uploaded
  file."* or *"Failed to bulk import items."*
- **How it reads your columns `[from code]`:** `Title`, `Description`/`Caption`, `Platform`,
  `PostType`/`Type`, `PublishDate`/`Publish Date`/`Post Date`/`Date`, `InternalDueDate`/`DueDate`/
  `Due Date`, `Priority`, `Assignee` — each with lower-case and spaced variants. Platform must be
  one of the 7 (INSTAGRAM, LINKEDIN, TIKTOK, FACEBOOK, YOUTUBE, TWITTER, PINTEREST) or it silently
  becomes **INSTAGRAM**; post type must be one of 6 (REEL, STORY, CAROUSEL, STATIC_IMAGE, VIDEO,
  ARTICLE) or it becomes **STATIC_IMAGE**; a missing internal due date copies the publish date;
  priority defaults to **MEDIUM**; the assignee is matched by first name, then by second name if
  several people share a first name, and left unassigned if no one matches. Every imported row lands
  in status **REVIEW**.

**`New Idea`** on this screen is **not a dialog** — it navigates to
`/marketing/ideas?projectId=<projectId>`, i.e. the Ideas screen pre-filtered to this project.

**`MISSING PLATFORMS`** in the pipeline table is a button, but clicking it produced only the row's
hover card in this build; it opened no platform picker.

### Odd things I noticed — project workspace
- **Three different "create" dialogs can create what is essentially the same record** (New Post, New
  Task, and an imported row), each offering a *different* subset of statuses: New Post offers 3,
  New Task offers 4 (including two review statuses but **not** In Progress), the importer forces
  REVIEW.
- **The `Twitter`/`X` naming is inconsistent across the product**: the post dialog says *Twitter*,
  the content drawer's platform list says *TWITTER*, and the Ideas platform list says *X*.
- The importer's copied prompt lists **5 platforms and 5 post types**, while the importer itself
  accepts **7 and 6**. PINTEREST/TWITTER and ARTICLE will import fine but the AI is never told they
  exist.
- The phone preview claims **4.5k Followers** — it is a static mock, not connected to any social
  account.
- **`Delete Project`** sits in the header next to everyday buttons rather than in a danger zone.

---

# 3. Calendar — `/marketing/calendar`

**Where:** sidebar → Marketing → **Calendar**. No tabs. This is the agency-wide content calendar —
every client, on one grid.

**What you see on arrival.** Heading **"Calendar"**. Immediately under/next to it a control bar:
**‹ ›** arrows, the period label (**Sep 2026**), a white **`Today`** button, then three filter
buttons (**All Clients**, **All Projects**, **All Assignees**), then two small segmented toggles —
**MONTH | WEEK** and **PUBLISH DATE | INTERNAL DUE**. Below: the weekday header **SUN MON TUE WED
THU FRI SAT** and the month grid. The cell for today carries a **TODAY** label.

**What a cell is:** **one day**. Each day cell (min height 140px on desktop, 100px on a phone, and it
grows to fit) contains, top to bottom:

1. **the date number** in a round button, and beside it a **tiny grey count** of the items in that day;
2. a **stack of thin colour bars** — one per **campaign** whose flight covers that day, full width,
   6px tall (Apr 11 showed **9** bars). `[from code]` a bar also marks the campaign's first and last
   day and highlights a campaign that is live right now;
3. then the **post cards** for that day.

**A scheduled post on the grid** is a small card with: a **3px coloured stripe down its left edge**
(the status colour), a **platform icon** (Instagram pink, LinkedIn blue, Facebook darker blue, and a
grey globe for anything else), the **title** on up to two lines, and a second line reading
`<client name> · <POST TYPE>`.

**The colour coding, exactly `[from code]`:**

| Left stripe | Statuses it means |
|---|---|
| **purple** | `PUBLISHED` |
| **emerald** | `DONE`, `APPROVED`, `SCHEDULED` |
| **amber** | `CLIENT_APPROVAL`, `REVIEW`, `CHANGES_REQUESTED` |
| **sky blue** | `IN_PROGRESS` |
| **slate grey** | everything else — `BACKLOG`, `TODO`, `DESIGN`, `DRAFTING`, `REJECTED` |

**The campaign bar colours are identity, not meaning:** `[from code]` a five-colour palette — blue,
fuchsia, cyan, orange, emerald — is assigned to each campaign by its id, so a colour tells you
"same campaign", not "same state".

**Live values as captured.** September 2026 was **empty** (`content: []`, `campaigns: []`). Stepping
back five months to **April 2026** gave **45 content items and 9 campaigns**; e.g. Apr 11 held 5
posts and 9 campaign bars. The nine April campaigns, all `ACTIVE`, all flighted **2026-04-01 →
2026-05-30**: Phase 1/2/3 Awareness Surge for each of Nexus Dynamics (AED 8,076 / 6,933 / 6,905),
Horizon Retail (15,437 / 12,769 / 12,051) and Velocity Fitness (17,786 / 14,210 / 5,271).

**Controls, in the order they appear → what each does:**

1. **‹ / ›** — one month back/forward in Month view, one week in Week view. Each step refetches
   (`GET /api/marketing/calendar?month=YYYY-MM`).
2. **`Today`** — jumps back to the current period.
3. **`All Clients`** — opens a 220px popover: **`RESET SELECTION`** then **Nexus Dynamics ·
   Horizon Retail · Velocity Fitness** (complete list, 3).
4. **`All Projects`** — same shape: **`RESET SELECTION`** then **Q2 Digital Retainer ×3** (one per
   client — three identically-named entries, indistinguishable in the list).
5. **`All Assignees`** — same shape: **`RESET SELECTION`** then **27 people**: Rohit Vinod, Deep
   Sheth, abcd, Kevin Norbert, Rayan Patel, Kingson Thomas, Megha M, akhila kr, Dhrumil Gadaria,
   Info Nexeor, Syeda Umme Kulsum, Ganesh S N, Admin, ritika, Sandra KK, Emaad Sultan, Test Demo,
   xyz, Kartik Kittad, Antra Agrawal, Gokulakrishnan R, Mathangi Chandu, work6, Chris george, Amal
   Vijayakumar, Swathikrishna U S, Navaneeth B.
6. **`MONTH` | `WEEK`** — **MONTH is the default** (highlighted white/10). WEEK shows seven day
   columns headed e.g. **SUN 29 … SAT 4** with the period label reading **"Week of Mar 29"**; a day
   with nothing in it reads **"Empty"**; in Week view each card puts the **post type on its own line
   above the title**.
7. **`PUBLISH DATE` | `INTERNAL DUE`** — **INTERNAL DUE is the default** (highlighted indigo), i.e.
   the calendar opens on the *internal deadline*, not the go-live date. Switching genuinely
   re-lays-out the month; measured on April 2026:
   - INTERNAL DUE: 1,2,2,1,0,1,1,0,0,2,2,**5**,3,1,2,2,1,0,2,0,0,2,2,1,1,4,3,2,0,0,1
   - PUBLISH DATE: 1,2,2,1,2,0,1,1,0,0,1,1,0,**6**,3,3,2,0,0,3,2,0,1,1,0,1,3,4,1,2,2
8. **The date number button** in each cell — no handler; **clicking an empty day does nothing**
   (there is no "add a post on this day" on this screen).

**Hover behaviour (both are real, both are useful):**

- **Hovering a post card** raises a floating card: the title · `<client> — <project>` · the **post
  type** · the brief · **Status** (the raw value, e.g. `DESIGN`) · **Publish Date** (e.g. *Thu, Apr
  2*) · **Internal Due** (*Wed, Apr 1*) · and, when assigned, **Owner** with the person's initial
  and name (e.g. *R — Rayan Patel*).
- **Hovering a campaign bar** raises: the campaign name · `<client> — <project>` · **Status**
  `ACTIVE` · **Spans** *Apr 1 → May 31* · **Budget** *AED 8,076*.

**Right-click a post card** → a 224px **QUICK ACTIONS** menu: the item's title as a header, then
**`Copy Direct Link`** and **`Open Project Layer`** (which goes to the project workspace).

**Drag-to-reschedule: there is none on this screen.** `[from code]` a post card carries exactly four
handlers — `onClick`, `onContextMenu`, `onMouseEnter`, `onMouseLeave` — no `draggable`, no
`onDragStart`, and the day cells have **no handlers at all**, so there is no drop target. The card is
`select-none cursor-pointer`, which reads like a drag handle but is not one. Rescheduling is done by
opening the item and editing **GO-LIVE DATE** / **INTERNAL DUE** in the drawer (§6).

**A day with many items:** nothing is hidden and nothing is collapsed — there is **no "+3 more"
overflow**. The cell simply grows and the row of the grid grows with it (Apr 11's five posts and nine
campaign bars all rendered in full).

**Clicking a post** opens the shared **content drawer** — described once, in §6, because the same
drawer is used by Calendar, Marketing Tasks and the project board.

**Empty state:** an empty month is not announced — you get the grid with empty cells and no message.

**Realtime/auto:** none. One fetch per period change; nothing polls.

### Odd things I noticed — `/marketing/calendar`
- **The calendar opens on the current month and on INTERNAL DUE**, and the label reading *PUBLISH
  DATE* sits to the *left* of the active one, so it looks like publish date is the default when it
  is not.
- **The hover card can name a different day than the cell it sits in.** With the browser in
  Asia/Kolkata (UTC+5:30), an item whose stored publish date is `2026-04-01T19:59Z` renders in the
  **Apr 1** cell while its hover card reads **"Publish Date: Thu, Apr 2"** — the grid places by one
  interpretation of the timestamp and the tooltip formats by local time.
- **There is no way to create anything from the calendar** — no "New Post" button, no click-an-empty-day.
- The campaign bars have **no legend**, so nine coloured lines on a day mean nothing until you hover
  each one.
- The seeded titles and the post-type labels disagree (a card titled *"… REEL content"* labelled
  **STORY**); that is the demo data, not the screen.

---

# 4. Tasks — `/marketing/tasks`

**Where:** sidebar → Marketing → **Tasks**. No tabs.

**What you see on arrival.** Heading **"Global Marketing Tasks"**, subtitle *"Manage deliverables for
Projects, Campaigns, and Content."* A control row: **Search…**, the three filter buttons (**All
Clients**, **All Projects**, **All Assignees**), a segmented **`My Tasks` | `All`** toggle, and a
**`Sort`** menu. Then the board: **seven fixed-width columns (320px each)**, side by side,
horizontally scrollable, filling the height below the header.

**Lanes and live counts as captured (on `All`):**

| # | Lane | Header dot | Count | Statuses it collects `[from code]` |
|---|---|---|---|---|
| 1 | **BACKLOG** | neutral grey | **1** | `BACKLOG`, `CHANGES_REQUESTED` |
| 2 | **TO DO** | slate | **16** | `TODO` |
| 3 | **IN PROGRESS** | indigo | **2** | `IN_PROGRESS` |
| 4 | **REVIEW & APPROVAL** | amber | **0** | `REVIEW`, `CLIENT_APPROVAL` |
| 5 | **APPROVED / DONE** | emerald | **5** | `APPROVED`, `SCHEDULED`, `DONE` |
| 6 | **PUBLISHED** | purple | **1** | `PUBLISHED` |
| 7 | **REJECTED** | red | **5** | `REJECTED` |

Total shown = 30, which is exactly the page size the screen asks for
(`GET /api/tasks?filter=all&source=marketing&limit=30`); scrolling a lane loads more.
**`[from code]` two statuses have no lane on this board — `DRAFTING` and `DESIGN`** — so a task in
either is fetched and then not displayed anywhere on the screen (the project board, §2d, does show
them, folded into In Progress).

**A task card carries:** a **REVISION REQUESTED** ribbon when the status is `CHANGES_REQUESTED` ·
`CLIENT NAME • PROJECT NAME` in tiny caps · the title · the **raw status** as a mono pill · the
**platform names** it targets (Instagram / Youtube / Facebook / Linkedin / Tiktok / Twitter, one chip
each) · the **post type** · the **priority** (`P2` + *Medium Priority*; P0 Urgent, P1 High, P3 Low) ·
the description · the **assignee's name** · **`<date>` Internal Due Date** and **• `<date>` Publish
Date** · and, when time has been logged, **`3h 10m` Total Time Logged** with comment/attachment
counts. Cards with an image or video attachment show a thumbnail `[from code]`.

**Controls → what each does:**

1. **Search…** — narrows the board as you type. When nothing matches, **every lane shows 0 and there
   is no "no results" message at all**.
2. **`All Clients` / `All Projects` / `All Assignees`** — the same 220px popovers as the calendar, but
   scoped to what this board holds: Clients = *RESET SELECTION · Velocity Fitness · Horizon Retail ·
   Nexus Dynamics*; Projects = *RESET SELECTION · Q2 Digital Retainer*; Assignees = *RESET SELECTION ·
   Amal Vijayakumar · Navaneeth B · Syeda Umme Kulsum · Kartik Kittad · Rayan Patel ·
   Gokulakrishnan R* (6 — only people who actually hold a task here).
3. **`My Tasks` | `All`** — **All is the default.** On `My Tasks` this account's board is **all seven
   lanes at 0**, again with no empty-state message.
4. **`Sort`** — a 220px menu, complete: **🕐 Last Updated** · **🔴 Deadline** · **📅 Publish Date** ·
   **⚡ Priority**, then a direction row currently reading **"Newest First / DESC"**, and
   `[from code]` a **`Reset to Default`** item. The default sort is **Last Updated, descending**.
5. **Clicking a card** → the shared content drawer (§6).
6. **Right-clicking a card** → the same 224px **QUICK ACTIONS** menu as the calendar: the title,
   **`Copy Direct Link`**, **`Open Project Layer`**.

**There is no `New Task` button on this screen** and no `+` in a lane header — tasks are created from
a project workspace (§2d-1).

**Drag and drop — real here, and it has rules.** Cards are `draggable` with `onDragStart`/`onDragEnd`,
and each lane is a drop target (`onDragOver`/`onDrop`) that glows indigo while you hover it. I
described it without completing a drop; `[from code]` the drop logic is:

- The task takes **the first status of the lane you drop on** (Backlog lane → `BACKLOG`, Review lane →
  `REVIEW`, and so on).
- **A move into Review & Approval is refused when the task has no attachment.** A toast appears
  top-centre for 4 seconds: a paperclip icon, **"ASSETS REQUIRED"**, and *Add at least one asset to
  "<task title>" before submitting for review.*
- If the task is currently `BACKLOG`, `TODO` or `CHANGES_REQUESTED`, the move applies straight away
  (`PATCH /api/tasks/<id>` with the new status).
- **Otherwise a "Log Time Spent" modal appears first**: a clock icon, the title **"Log Time Spent"**,
  the subtitle *"Cancel to move task to Backlog"*, a chip pair showing **from-status → to-status**, an
  **H — Hours | M — Minutes** segmented switch, **Hours** and **Minutes** inputs, a
  **"Time to log: …"** readout, and **`Cancel — Move to Backlog`**. Confirming sends the status plus
  `timeTaken: {hours, minutes}` and the old status — this is where the *Total Time Logged* figure on
  the cards comes from.
- On a phone (below `md`) the seven columns collapse into **a tab strip** — one lane at a time, each
  tab showing its label and count.

**Realtime/auto:** no polling; the board refetches after its own writes.

## 4.1 Is this the same task data as Global Tasks (`/tasks`)? — **Yes, one system**

Asked directly in the brief, so here is the answer with the evidence I measured myself this session.
**`/marketing/tasks` and `/tasks` are two windows onto the same task table; Marketing ▸ Tasks is the
wider one.**

1. **Same endpoint.** `/marketing/tasks` calls `GET /api/tasks?filter=all&source=marketing&limit=30`.
   `/tasks` calls `GET /api/tasks?filter=mine` (and `?filter=all` on its All Tasks toggle) — the
   *same route*, minus the `source` parameter.
2. **One record set, strictly nested.** Fetched both in the same session:
   `?filter=all` returned **15** records; `?filter=all&source=marketing&limit=200` returned **50**;
   **records in the global set that are absent from the marketing set: 0.** Global Tasks is a subset
   of the marketing task list.
3. **Same record shape** — identical field names on both responses (`title, description, startDate,
   dueDate, publishDate, status, priority, postType, caption, publishedUrl, assignedToId, projectId,
   campaignId, clientId, platforms, attachments, _count, totalTimeLogged`, …). The fields are
   marketing fields: post type, platforms, publish date, caption, published URL.
4. **The same individual records appear on both** (e.g. *Expert Interview Series*, *BUG-86 Active
   overdue*).
5. **They differ only in presentation.** `/tasks` groups into **Backlog · To Do · In Progress ·
   Review · Approved · Done · Rejected**; `/marketing/tasks` groups into **Backlog · To Do · In
   Progress · Review & Approval · Approved / Done · Published · Rejected**. `/tasks` has a
   **`New Task`** button; `/marketing/tasks` has none but adds client/project/assignee filters and a
   sort menu.

I opened `/tasks` once, for that comparison only (its board was empty for this account on the default
`My Tasks` filter: seven lanes at 0 with the message *"No tasks"* in each). Terminal N5 owns that
screen.

### Odd things I noticed — `/marketing/tasks`
- **Two statuses are invisible here.** `DRAFTING` and `DESIGN` have no lane, so those tasks are
  fetched and silently dropped — and they are not rare: the same project shows four of them on its
  own board.
- **No empty state anywhere.** A search with no matches, and `My Tasks` for a person with nothing
  assigned, both render seven empty columns with no words at all.
- **The board can create nothing** — the screen whose whole job is marketing deliverables has no way
  to add one.
- **The drawer offers ten statuses and this board has seven lanes**, so setting a task to *Drafting*
  or *Design* from the project board makes it vanish from this one.
- The **"Log Time Spent"** modal's cancel button promises *"Move to Backlog"*, but `[from code]` its
  cancel handler puts the task back to **the status it came from** — the label and the behaviour
  disagree.
- Priority is shown twice on every card (`P2` and *"Medium Priority"*).

---

# 5. Ideas — `/marketing/ideas`

**Where:** sidebar → Marketing → **Ideas**. Also reached pre-filtered from a project workspace as
`/marketing/ideas?projectId=<id>`.

**What you see on arrival.** Heading **"Marketing Ideas Repository"**. A control row: a **search box**
("Search ideas…"), a **`Filters`** button, a **`Filter by date`** button, a **`Kanban` | `Grid`**
toggle, and a **`Create idea`** button. Then **four status columns**. At the bottom, a
**`Load More (10 of 24)`** button — the screen loads **10 ideas at a time**
(`GET /api/marketing/ideas?limit=10&skip=0`).

**Lanes and live counts:** **BACKLOG 9 · REVIEW 0 · IMPLEMENTED 0 · DISCARDED 1** (of 24 total).
Empty lane text: **"No ideas yet"** in Kanban, and the fuller **"No ideas in Review."** /
**"No ideas in Implemented."** in Grid.

**An idea card in Kanban** shows the **title**, then the **client**, the **project**, and the
**campaign** when set (e.g. *"NI 10 / Horizon Retail / Q2 Digital Retainer / Phase 2 Awareness
Surge"*). In **Grid** view each card adds a **thumbnail panel** — reading **"NO PREVIEW"** when the
idea has no image — and a line **"Review: 6/24/2026"** or **"Review: Not set"**.

**Every field an idea holds** (from the record itself, so nothing is guessed): `title`, `summary`,
`description`, `status`, `ideaType`, `priority`, `tags`, `impact`, `mood`, `projectId`, `campaignId`,
`clientId`, `createdById`, `internalReviewDate`, `platform`, `slackMessageTs`, `slackReportedAt`,
`attachments`, and a **`shareUrl`** of the form `/marketing/ideas/<ideaId>`. **Note:** `summary`,
`tags`, `impact` and `mood` exist on the record but **no screen in this group shows or edits them** —
they were null on every idea.

**Controls → what each does:**

1. **Search ideas…** — narrows live; no matches gives four lanes at 0, each reading *"No ideas yet"*.
2. **`Filters`** — a command-palette popover (with its own **"Search filters…"** box) offering **six
   dimensions**; picking one drills into its values. All six, with their complete option lists:

   | Dimension | Options |
   |---|---|
   | **Client** | Velocity Fitness · Horizon Retail · Nexus Dynamics |
   | **Project** | Q2 Digital Retainer |
   | **Campaign** | Phase 3 Awareness Surge · Phase 2 Awareness Surge · Phase 1 Awareness Surge |
   | **Status** | Backlog · Review · Implemented · Discarded |
   | **Platform** | INSTAGRAM · TIKTOK · FACEBOOK · LINKEDIN · X · YOUTUBE · PINTEREST · COMPETITOR RESEARCH · INTERNAL BRAINSTORMING · CLIENT SUGGESTIONS · OTHER *(11)* |
   | **Creator** | Chris george · Syeda Umme Kulsum · Megha M |

3. **`Filter by date`** — a popover with a **`Single date` | `Date range`** switch and **FROM** / **TO**
   calendars.
4. **`Kanban` | `Grid`** — Kanban is the default; Grid keeps the same four status groups but shows
   thumbnail cards with the review date.
5. **`Load More (10 of 24)`** — appends the next ten.
6. **Clicking a card** → the **idea detail modal** (below).

## 5.1 Dialog: `Create idea` → "Create new idea"

A centred modal. Ten fields; the three marked `*` are the required ones:

| Field | Type | Required | Options / default / placeholder |
|---|---|---|---|
| **Title \*** | text | **yes** | `Idea headline` |
| **Client \*** | select | **yes** | **Select client** (default, empty) · Velocity Fitness · Horizon Retail · Nexus Dynamics |
| **Project** | select | no | **Select project** (default, empty) · Q2 Digital Retainer *(the list depends on the client chosen)* |
| **Campaign** | select | no | disabled until a project is chosen — its only entry reads **"Select project first"** |
| **Internal Review Date** | date | no | empty |
| **Description \*** | textarea | **yes** | *"Detailed idea description, mood and strategy notes. Type @ to tag someone"* — **@mentions supported** |
| **Priority \*** | select | **yes** | P0 · P1 · **P2** (default) — *3 options only, no P3* |
| **Platform** | select | no | INSTAGRAM · TIKTOK · FACEBOOK · LINKEDIN · X · YOUTUBE · PINTEREST · COMPETITOR RESEARCH · INTERNAL BRAINSTORMING · CLIENT SUGGESTIONS · **OTHER** (default) — *11 options* |
| **Internal Comments** | textarea | no | *"Add internal feedback, review notes, or next-step context... Type @ to tag someone"* |
| **Creative assets** | file picker | no | *"Upload images, videos, PDFs, screenshots, design references, and documents."* + a **`Choose files`** button |

Buttons: ✕ · **`Create idea`** · **`Cancel`**.

**Note the shape of the "Platform" list:** it mixes real channels with **where the idea came from**
(Competitor Research, Internal Brainstorming, Client Suggestions), so this one dropdown is doing both
"platform" and "source".

## 5.2 The idea detail modal

Clicking a card opens a centred modal (not a page, though the record does carry a shareable
`/marketing/ideas/<id>` address). Contents, in order:

- the **title** as the header, with **`Copy idea link`** and **`Close`** buttons;
- **Description** — editable textarea, *"Type the idea details here. Use @ to tag someone"*;
- **Internal Comments** — editable textarea, same @mention support;
- **STATUS** — select: **BACKLOG · REVIEW · IMPLEMENTED · DISCARDED**;
- **PLATFORM** — select, the same 11 options (shown here in title case: Instagram, TikTok, Facebook,
  LinkedIn, X, YouTube, Pinterest, Competitor Research, Internal Brainstorming, Client Suggestions,
  Other);
- **PRIORITY** — select: **P0 · P1 · P2**;
- **PROJECT**, **CAMPAIGN**, **CLIENT** — shown as **read-only text** (e.g. *Q2 Digital Retainer* /
  *None* / *Nexus Dynamics*); they cannot be changed after creation;
- **Creative assets** — *"Images, videos, PDFs, screenshots, and design references."*, a
  **`Choose files`** button, and the empty state **"No attachments yet."**;
- **Activity log** — newest first, each entry with a type chip, the person and a timestamp, ending
  with **"End of activity log"**. Real entries captured:
  `Idea included in Slack digest — SLACK DELIVERED — System - 6/29/2026, 4:01:01 PM` ·
  `Good — COMMENTED — Megha M - 6/22/2026, 11:18:47 AM` ·
  `Idea created — CREATED — Megha M - 6/22/2026, 11:18:46 AM`. It pages ten entries at a time
  (`?activityLimit=10&activitySkip=…`);
- footer: **`Delete idea`** (not clicked), **`Save updates`**, **`Cancel`**.

## 5.3 How an idea moves forward — and the honest answer about "promote / convert"

The brief asked where the promote-to-task-or-post control is. **There isn't one.** I looked for it
three ways: on the card, in the detail modal, and in the screen's own shipped JavaScript — the Ideas
bundle contains **no convert/promote action of any kind**, and no call that creates a task or a
content item. What an idea can actually do:

- **change status** to **REVIEW → IMPLEMENTED** (or **DISCARDED**) by hand, which is the only
  "it happened" signal;
- **be reported to Slack** — every idea carries `slackReportedAt`/`slackMessageTs` and the activity
  log records **"Idea included in Slack digest"**, so ideas are pushed into a Slack digest
  automatically;
- **carry an internal review date** for a scheduled discussion;
- **be linked to a client, project and campaign at birth**, so whoever later creates the post knows
  where it belongs.

So the workflow is: capture the idea → discuss it (comments, @mentions, Slack digest) → mark it
IMPLEMENTED → **and then re-type it as a post or task in the project workspace by hand.**
**There is also no voting and no rating** — no upvote, no score, no reaction anywhere on an idea; the
only ranking is `PRIORITY` (P0/P1/P2), and the only "categories/tags" are the single **Platform**
dropdown (11 values). The record's `tags`, `impact` and `mood` fields are never surfaced.

### Odd things I noticed — `/marketing/ideas`
- **An idea is a dead end** — the one screen designed to feed the calendar cannot hand anything to
  it; the copy must be retyped in the project workspace.
- **Internal Review Date can be set at creation but not edited afterwards** — the detail modal has no
  date field, while the Grid card prints *"Review: …"* prominently.
- **Priority is P0–P2 here and P0–P3 everywhere else** in Marketing, so a "low priority" idea cannot
  be expressed.
- **"Platform" is really two questions in one list** (channel vs where the idea came from), which
  makes the platform filter unusable as a channel filter.
- **Project / Campaign / Client are frozen after creation** — an idea filed against the wrong client
  can only be discarded and retyped.
- The demo data shows this being used as a scratchpad ("DUPLICATE TEST IDEA 12345", "fd", "sdgdf",
  "tess"), and nothing warns about a duplicate title.
- The four columns are status columns but the header uses no counts-in-context — 9 of 24 ideas are
  loaded, so the lane counts describe the loaded page, not the repository.

---

# 6. The shared content drawer — one screen used by three

Calendar, Marketing Tasks and the project board all open **the same right-side drawer** when you
click an item, so it is described once. It slides in from the right, 1152px wide (full width on a
phone), with a translucent backdrop.

**Header:** a breadcrumb `<Client> / <Project>` (a link into the project), then three icon buttons —
a **link** icon (copy a direct link), a **trash** icon (delete the item), and **✕** (close). A
collapse chevron appears on desktop.

**Left half (the record):**

- the **title**, as a large editable textarea (placeholder *"Task Title..."*);
- a **field grid**:

  | Field | Control | Complete option list |
  |---|---|---|
  | **STATUS** | select | Backlog · To Do · In Progress · Internal Review · Client Approval · Approved · Published · Scheduled · Done · Rejected — **10 options** (stored as `BACKLOG, TODO, IN_PROGRESS, REVIEW, CLIENT_APPROVAL, APPROVED, PUBLISHED, SCHEDULED, DONE, REJECTED`) |
  | **PRIORITY** | select | P3 Low · P2 Med · P1 High · P0 Urgent (`LOW, MEDIUM, HIGH, URGENT`) |
  | **PLATFORMS** | multi-select popover (button reads *"Select platforms…"* when empty) | **INSTAGRAM · LINKEDIN · TIKTOK · FACEBOOK · TWITTER · YOUTUBE · PINTEREST** — 7, pick any number |
  | **ASSIGNEE** | select | **Unassigned** + 26 people (Admin, Amal Vijayakumar, Antra Agrawal, Chris george, Deep Sheth, Dhrumil Gadaria, Emaad Sultan, Ganesh S N, Gokulakrishnan R, Info Nexeor, Kartik Kittad, Kevin Norbert, Kingson Thomas, Mathangi Chandu, Megha M, Navaneeth B, Rayan Patel, Rohit Vinod, Sandra KK, Swathikrishna U S, Syeda Umme Kulsum, Test Demo, abcd, akhila kr, ritika, xyz) |
  | **CAMPAIGN** (emerald-tinted) | select | **Standalone** + every campaign of the project (Phase 1/2/3 Awareness Surge) |
  | **POST TYPE** | select | Reel · Story · Carousel · Static · Article (`REEL, STORY, CAROUSEL, STATIC_IMAGE, ARTICLE`) |
  | **INTERNAL DUE** | date | the internal deadline |
  | **GO-LIVE DATE** (sky-tinted) | date | the publish date |
  | **PUBLISHED URL** | text (`https://...`) | appears for content items |

- **EXECUTIVE BRIEF** — textarea, *"Creative brief, design notes, or strategic instructions..."*;
- **SOCIAL CAPTION** — textarea, *"Final caption text, hashtags, and mentions..."*, with a live
  **`0 / 5000`** counter;
- **CREATIVE ASSETS** — a dashed drop zone, *"Drop files or click to upload"*. `[from code]` accepted
  types: `image/*`, `video/*`, PDF, `.doc/.docx`, `.xls/.xlsx`, `.ppt/.pptx`, `.ai`, `.psd`, `.svg`,
  `.zip`, `.rar`, multiple at once; each upload shows a name, a **percentage** and a progress bar that
  turns emerald on success and rose on failure; images get a thumbnail, videos a film icon. Clicking
  an asset opens a **full-screen lightbox** with the file name, an `n / total` counter and the file
  size.

**Right half (the conversation):** **ACTIVITY & DISCUSSION** — a scrolling feed whose empty state is
*"No activity yet. Upload files or start a discussion..."*. Real entries include **field-change rows**
that print the old value → the new value (e.g. an **ASSIGNEE** change from *Kartik Kittad* to
*Navaneeth B*). At the bottom, a comment box (*"Comment or @mention..."*) with a paperclip
**"Attach files"** button on the left and, on the right, a **Send** button.

**The approval workflow lives in this drawer's footer `[from code]`, and it is asset-gated:**

| The item's status | What the footer offers |
|---|---|
| `IN_PROGRESS`, `TODO`, `DRAFTING`, `DESIGN` **with ≥1 attachment** | an indigo **`Submit for Review`** button (eye icon) → moves it to **REVIEW** |
| the same statuses **with no attachment** | an amber notice instead: **"ADD AT LEAST ONE ASSET TO SUBMIT FOR REVIEW"** |
| `CHANGES_REQUESTED` **with ≥1 attachment** | an emerald **`Resolve & Request Review`** button (tick icon) → back to **REVIEW** |
| `CHANGES_REQUESTED` **with no attachment** | the same amber notice |
| `REVIEW` or `CLIENT_APPROVAL` | next to the comment box, an amber **`Revise`** button (title *"Request revision"*, rotate icon) that is enabled only once you have typed a comment → moves the item to **CHANGES_REQUESTED**, with your comment as the reason |

**There is no "Approve" button anywhere.** Approving is done by setting **STATUS → Approved** by hand
(and `[from code]` the only scripted transitions in the whole bundle are `submitForReview`,
`resolveAndRequestReview` and `revise` — all three land on REVIEW or CHANGES_REQUESTED).

**Escape does not close the drawer** — the ✕ or the backdrop does.

## 6.1 Reference: every enumeration in Marketing, in one place

| Enumeration | Values |
|---|---|
| **Content/task status** (13 exist in the data) | `BACKLOG`, `TODO`, `IN_PROGRESS`, `DRAFTING`, `DESIGN`, `REVIEW`, `CLIENT_APPROVAL`, `CHANGES_REQUESTED`, `APPROVED`, `SCHEDULED`, `PUBLISHED`, `DONE`, `REJECTED` — **the drawer's dropdown offers only 10** (no DRAFTING, DESIGN, CHANGES_REQUESTED) |
| **Priority** (tasks/content) | `LOW` (P3), `MEDIUM` (P2, default), `HIGH` (P1), `URGENT` (P0) |
| **Priority** (ideas) | `P0`, `P1`, `P2` (default P2) |
| **Post type** | `REEL`, `STORY`, `CAROUSEL`, `STATIC_IMAGE`, `ARTICLE` — plus **`VIDEO`**, which exists in the data and in the importer but is **not offered in any dropdown** |
| **Platforms** (drawer, multi-select) | INSTAGRAM, LINKEDIN, TIKTOK, FACEBOOK, TWITTER, YOUTUBE, PINTEREST |
| **Platform** (New Post dialog) | Instagram, LinkedIn, TikTok, Facebook, YouTube, Twitter *(6 — no Pinterest)* |
| **Platform** (ideas) | INSTAGRAM, TIKTOK, FACEBOOK, LINKEDIN, **X**, YOUTUBE, PINTEREST, COMPETITOR_RESEARCH, INTERNAL_BRAINSTORMING, CLIENT_SUGGESTIONS, OTHER |
| **Client status** | `ONBOARDING` → "Onboarding", `ACTIVE` → "In Progress", `PAUSED` → "On Hold", `CHURNED` → "Offboarded / Closed" |
| **Idea status** | `BACKLOG`, `REVIEW`, `IMPLEMENTED`, `DISCARDED` |
| **Campaign status** | `ACTIVE` (the only value present) |
| **Campaign objective** | Lead Generation, Brand Awareness, Sales / Conversions, Event Promotion |
| **Project type** | `SOCIAL_MEDIA_RETAINER` (stored, never shown on screen) |

## 6.2 Reference: the addresses this group calls

`GET /api/marketing/dashboard` · `GET /api/marketing/clients` · `GET|DELETE
/api/marketing/clients/<id>` · `/api/marketing/clients/<id>/folders[/<id>]` ·
`/api/marketing/clients/<id>/attachments[/<id>]` · `GET /api/marketing/projects` ·
`GET /api/marketing/projects/<id>` · `POST /api/marketing/projects/<id>/items/bulk` ·
`GET /api/marketing/calendar?month=YYYY-MM` · `GET /api/marketing/ideas?limit&skip` ·
`GET|PATCH|DELETE /api/marketing/ideas/<id>?activityLimit&activitySkip` ·
`GET /api/tasks?filter=all&source=marketing&limit=30` · `PATCH /api/tasks/<id>` ·
`GET /api/crm/users?module=Marketing` · `/api/upload/sign` + `/api/upload` ·
`GET /api/settings/rbac` (the sidebar's entitlement check).

---

# 7. Everything I could not reach, and why

**Nothing in my scope was unreachable.** All five screens, the client detail, the project workspace
and the public portal opened normally. Three things are described from the app's own code rather than
seen, on purpose (see the honesty note): the result of **`Delete Client` / `Delete Project` /
`Delete idea`**, the result of any **`Create` / `Save` / `Submit`**, and the result of **completing a
drag** on the two draggable boards. One thing is genuinely broken rather than unreached: the public
portal's **Live Performance** tab (§2c).

---

# In human language — every feature in this area, as points

**Marketing home (Overview)**

- **Marketing home page** — one page that answers "what is happening in marketing right now": what
  is waiting for approval, which campaigns are running, what is on my plate, and which clients we
  look after. Click Marketing → Overview in the left menu. It is the morning glance before you dig
  into anything.
- **"Content needing approval" list** — shows every piece of content that has been sent for review
  and is still waiting on a yes. On the marketing home page, top-left. It stops finished work from
  sitting unnoticed while a publish date goes past.
- **"Live campaigns" list** — every campaign currently switched on, with the client it belongs to and
  the money set aside for it. On the marketing home page, under the approvals list. It is the
  "where is our money committed" line-up.
- **"My tasks" list** — the jobs assigned to the person signed in, newest deadlines and all, on the
  right of the marketing home page. So you do not have to open the big board just to see your own
  work.
- **"Active clients" shortcuts** — the client names with how many projects each has, on the right of
  the marketing home page, each one a door straight into that client. The quickest route to a
  particular brand.

**Clients**

- **Client list** — one fat row per brand you do marketing for, showing the brand name, its industry,
  how many jobs are overdue, how many projects are running and how many jobs are still open. Click
  Marketing → Clients. This is the "how healthy is each account" screen.
- **Search brands** — a search box on the client list that narrows to the brand you type. For an
  agency with fifty clients instead of three.
- **Set a client's stage** — a little dropdown on each client row with four choices: Onboarding, In
  Progress, On Hold, Offboarded / Closed. It records where the relationship stands. Careful: it saves
  the moment you pick, with no "are you sure".
- **Open the client's own website** — a small icon next to the brand name on the client list, opens
  their site in a new tab. Handy when you need to check their live branding.
- **Client quick-look** — clicking a client row opens a summary strip in place: the running projects
  with a progress percentage, what is due next, and the ad spend and return figures. It answers "how
  is this account doing" without leaving the list.
- **Add a client from a sales deal** — the Add Client button offers a list of deals from the sales
  side; pick one and the marketing workspace is created from it. It stops you retyping a client the
  sales team already entered.
- **Add a client by hand** — the same Add Client button has a Manual Entry mode asking only for brand
  name, industry and website. For a client who never went through the sales pipeline.
- **Attach a Slack channel when creating a client** — an optional Slack channel box on the Add Client
  form, so updates about this client can land in the right team chat from day one.

**A single client's workspace**

- **Client workspace page** — the client's own home: their name, industry, website, their projects,
  their files, their integrations, and their numbers. Click a client row then Open Full Workspace. It
  is the folder you live in while working on that brand.
- **Project list with jump-in shortcuts** — each project on the client page shows its status, how far
  along it is, and four shortcuts straight to that project's jobs, calendar, campaigns and ad
  figures. Fewer clicks to the place you actually work.
- **Create a project for a client** — the New Project button on the client page asks for a name and a
  one-line goal. A project is the container a retainer's work sits in, e.g. "Q2 Digital Retainer".
- **The client's file vault** — a Master Assets tab on the client page where you keep the brand's
  files: logos, guidelines, raw footage. You can make folders, drop files straight in, and move
  things between folders. So nobody has to ask "where are the brand assets" again.
- **Save a web link as an asset** — an Add Link button in the same vault for things that live
  elsewhere: a Drive folder, a competitor's site, a moodboard. Links sit beside files instead of
  getting lost in chat.
- **Account details panel** — the client page's side panel showing the industry and who owns the
  account. The one-line "who is this client" record.
- **Agency stats panel** — two big numbers on the client page: how many projects and how many
  campaigns are running for this client.
- **Slack settings per project** — a small pencil on the client page's integrations panel lets you set
  a Slack channel for each project separately, with plain instructions for finding the channel's ID.
  Updates then go to the team that owns that project.
- **A shareable client portal link** — on the client page, a strip with three buttons: copy the link,
  preview what the client will see, or issue a brand-new link. That is how you show the client their
  own calendar without giving them a login.
- **Retire the old client link** — the refresh button on that strip issues a new link and kills the
  old one, after asking. For when a link has been forwarded somewhere it shouldn't have been.
- **Delete a client** — a red panel at the bottom of the client page that removes the client and
  everything under it: projects, jobs and vault files. It asks once and cannot be undone.

**What the client themselves sees (the shared portal)**

- **A client-facing content calendar** — the page your client opens from the link you send: their
  month laid out, plus a simple list of every piece of content with its date and where it stands. It
  replaces the weekly "what's coming up?" email.
- **A client-facing item view** — the client can click any piece and see the date, the title and its
  current stage. It is read-only: they can look, not change.
- **A client-facing assets area** — the client can see the shared folders and files you have put in
  their vault.
- **Let the client send you a reference link** — a Submit Reference Link button on their portal where
  they can drop in a moodboard or a Drive link, and it appears on your side. It keeps client
  references out of WhatsApp.
- **A client-facing performance tab** — meant to show the client their live campaign results.
  **It is broken right now**: opening it crashes their page and they have to reload.

**Inside a project**

- **The project workspace** — one project with four areas: its jobs, its calendar, its campaigns and
  its ad figures. Reached from the client page. This is where the day-to-day work happens.
- **The project job board** — the project's tasks as cards in seven columns from Backlog through to
  Published, with filters for who it's for, which campaign, and how urgent, plus a sort menu. The
  team's working view of one client.
- **The project's social calendar** — the same month grid but only this project's posts, with a
  mock-up of what the feed will look like on a phone. Good for showing a client the shape of a month.
- **The content pipeline table** — under the project calendar, every planned post as a table row with
  its platform, stage, publish date, internal deadline and who owns it. The spreadsheet view for
  people who think in lists.
- **Campaign list with money** — the project's campaigns each showing what was budgeted and what has
  been spent so far. It is the "are we on budget" check.
- **Create a campaign** — a form asking for the campaign name, the total budget, the goal (leads,
  awareness, sales or an event), who it is aimed at, the single key message, and the start and end
  dates. A campaign is the umbrella several posts and adverts sit under.
- **Ad spend log** — a table of what was spent by day, on which platform, with clicks and return.
  The record behind the performance numbers.
- **Log a day's ad spend** — a small form for the date, the amount spent, the clicks, and which
  campaign it belongs to. This is how spend gets into the system; nothing is imported automatically.
- **Create a social post** — the fullest create form in marketing: title, platform, post type,
  caption or instructions for the designer, the go-live date, the internal deadline, who it is
  assigned to, its starting stage, reference files to work from, and the campaign it belongs to. One
  form turns a plan into a job someone owns.
- **Create a task** — the same idea for work that is not a post: a title, notes, urgency, starting
  stage, owner, internal deadline and target date. For the "write the strategy deck" kind of job.
- **Jump to this project's ideas** — a New Idea button on the project that takes you to the idea bank
  already filtered to this project.
- **Import a whole month's calendar** — paste a table straight from Excel, Sheets or Notion, or upload
  a spreadsheet, and every row becomes a planned post. It turns the way agencies already plan (in a
  sheet) into real scheduled work in one go.
- **A ready-made instruction for an AI to write that sheet** — a Copy Prompt button in the same
  importer that copies a paragraph you can paste into ChatGPT or Claude; what comes back is a table
  the importer accepts without editing. It is a shortcut from "we need a content plan" to a filled
  calendar.
- **Check the import before it lands** — after pasting or uploading you get an editable review table
  and nothing is saved until you confirm. So a wrong column does not pollute the calendar.
- **Delete a project** — a button in the project header that removes the project.

**The agency-wide calendar**

- **One calendar for every client** — the whole agency's content in a single month or week grid, so
  you can see at a glance whether next week is empty or overloaded. Click Marketing → Calendar.
- **Switch between "when it goes live" and "when it's due internally"** — a two-button switch on the
  calendar. The team plans against the internal deadline; the client cares about the go-live date;
  the same month looks different in each, and the calendar opens on the internal deadline.
- **Filter the calendar by client, project or person** — three dropdowns at the top. So a designer can
  see only their own month, or an account manager only their brand.
- **Campaign bars across the days** — thin coloured lines in each day showing which campaigns are
  running then, and hovering one names it and shows its dates and budget. It puts the posts in the
  context of the campaign paying for them.
- **Colour tells you the stage** — each post carries a coloured edge: purple means published, green
  means approved or done, amber means it is waiting on a review or an approval, blue means someone is
  working on it, grey means it has not started. You can read the month's health without opening
  anything.
- **Hover a post for the whole story** — pointing at a post shows its title, client, project, type,
  brief, stage, publish date, internal deadline and owner, without opening it.
- **Right-click a post for quick actions** — a small menu with "copy a direct link to this item" and
  "open the project this belongs to". For pasting a specific post into a chat.
- **Jump to today, or step month by month** — a Today button and arrows at the top of the calendar.
- **Note: you cannot drag a post to a new date on this calendar, and you cannot create one here.**
  Rescheduling is done by opening the post and changing its dates.

**The marketing jobs board**

- **One board for every client's marketing jobs** — cards in seven columns: Backlog, To Do, In
  Progress, Review & Approval, Approved / Done, Published, Rejected. Click Marketing → Tasks. It is
  the production line for the whole department.
- **Mine or everyone's** — a two-button switch so a person can strip the board down to their own work.
- **Search, filter and sort the board** — a search box, filters for client, project and person, and a
  sort menu offering last updated, deadline, publish date or urgency, in either direction.
- **Drag a card to move a job along** — pick a card up and drop it in another column and the job's
  stage changes. The normal way work advances.
- **You cannot send something for review with nothing attached** — dropping a card into Review &
  Approval when no file is attached is refused, with a message naming the job and asking for at least
  one asset. It stops empty "please review" hand-offs.
- **Logging your time when a job moves on** — moving a job out of the middle of the process asks how
  long it took, in hours or minutes, and the total then shows on the card. That is how the agency
  learns what a reel actually costs in hours.
- **A card that tells you everything** — each card shows the client and project, the stage, which
  platforms it is for, the post type, the urgency, both dates, the owner, the time logged so far and
  how many comments and files it has.
- **It is the same list as the company-wide jobs board** — the marketing board and the company Global
  Tasks board read the same records; the marketing one simply shows more of them and groups them
  differently. Changing a job in one place changes it in the other.

**The idea bank**

- **A place to park ideas** — four columns: Backlog, Review, Implemented, Discarded. Click Marketing →
  Ideas. It is the "we should do a series about X" list that otherwise dies in a chat.
- **Write down an idea properly** — the Create Idea form asks for a headline, which client it is for,
  optionally the project and campaign, the platform (or where the idea came from: competitor
  research, an internal brainstorm, a client suggestion), how urgent it is, a date to review it, the
  idea itself, internal notes, and any reference files. Enough that a stranger could pick it up
  months later.
- **Tag someone inside an idea** — typing @ in the idea's description or notes tags a colleague. It
  pulls the right person into the thinking.
- **Two ways to look at the bank** — a Kanban view of the four columns, or a Grid view with a picture
  on each card and its review date. Grid is for browsing visually, Kanban for moving things along.
- **Filter the bank six ways** — a Filters button offering client, project, campaign, stage, platform
  and who wrote it, plus a separate date filter for a single day or a range, plus a search box.
- **Load more ideas** — the bank shows ten at a time with a button that says how many there are in
  total.
- **Open an idea to work on it** — clicking an idea opens it: edit the description and internal notes,
  change its stage, platform and urgency, attach files, and read its whole history. The one place an
  idea is discussed.
- **Every idea keeps a diary** — the idea's history records when it was created, every comment, and
  when it went into the Slack digest, each with a name and a timestamp.
- **Copy a link to an idea** — a button in the idea that copies a direct address, so you can paste one
  idea into a chat or an email.
- **Ideas get pushed into Slack automatically** — new ideas are included in a Slack digest and the
  idea's own history says so. The bank nudges the team instead of waiting to be visited.
- **Delete an idea** — a button in the idea, for the ones that were typed twice or tested.
- **Note: an idea cannot be turned into a post or a job.** There is no "promote this" button anywhere.
  You mark it Implemented and then create the post by hand in the project. Also: there is no voting,
  no scoring and no tags — the only ranking is the urgency setting, and its options here are P0 to P2
  rather than P0 to P3 as everywhere else.

**Opening one piece of content or one job (the same panel everywhere)**

- **One editor for a piece of content** — clicking an item on the calendar, on the marketing board or
  on a project board slides open the same panel from the right, and everything about that item is
  editable in it: title, stage, urgency, which platforms, who owns it, which campaign, what type of
  post, the internal deadline, the go-live date, the published link, the creative brief and the final
  caption (with a 5,000-character counter). One place, so nothing has two versions.
- **Attach the actual work** — a drop zone in that panel takes images, videos, PDFs, Word, Excel,
  PowerPoint, Illustrator, Photoshop, SVG and zips, several at a time, each with an upload bar.
  Clicking one opens it full-screen with its size and its place in the set. The work and its brief
  live together.
- **Discuss it in place, and tag people** — a comment box at the bottom of the same panel, with @
  mentions. Feedback ends up attached to the thing being discussed instead of in a chat thread.
- **See who changed what** — the same feed records field changes, showing the old value and the new
  one side by side, so "who reassigned this?" has an answer.
- **Send it for review** — when a job is being worked on and has at least one file attached, a Submit
  for Review button appears at the bottom of the panel. Without a file, it tells you to add one first.
- **Send back a revised version** — when a job has had changes requested, the button becomes Resolve &
  Request Review, so a second round is one click.
- **Ask for changes with a reason** — when something is sitting in review, a Revise button next to the
  comment box turns your typed comment into the reason and sends the job back for changes. Feedback
  can never be recorded without saying why.
- **Approving is a stage change, not a button** — there is no Approve button; whoever approves sets the
  stage to Approved (or Published, Scheduled, Done). Worth knowing when you train people on it.
- **Copy a link to any item, or delete it** — two small icons at the top of the panel.

---

**Captured by terminal N6, 2026-09-07.** Screenshots: `.claude/capture/shots/N6/` (47 images).
