# N1 — Nexeor Agency OS v2.0: the way in, the app shell, and the screens nobody links to

**Site:** `https://os-staging.product.nexeor.com` · **Product name shown on screen:** Nexeor Agency OS v2.0
**Captured:** 2026-09-07, signed in as the demo account (`demo_om85i@demo.agency`), Chromium 1512×950 and 390×844.
**Method:** drove the real browser and read the rendered screen (the app is client-rendered — raw HTML gives nothing).
**Nothing was created, saved, sent, assigned or deleted.** Every form was read and abandoned.

> ### ⚠️ Read this before using the other N-files — the sidebar is bigger than the brief said
> The project brief describes “28 sidebar routes in 6 groups”. What the sidebar actually holds, once
> **every** level is expanded, is **46 static addresses** (plus per-client rows that are data, not routes).
> The extra ones are a **third level** that only appears when you click a small `›` chevron sitting next to
> certain child items — Finance ▸ Accounting, Finance ▸ Operations, Finance ▸ Reports & Tax,
> Finance ▸ AI & Tools, HR ▸ Attendance, HR ▸ Recruiting and Marketing ▸ Clients each hide a further list.
> **21 addresses were therefore in nobody's assigned scope** — rather than leave that as an open question,
> they are **captured in full in §6 of this file**, together with three public, no-sign-in screens (§5)
> that are not in the menu either. Whoever assembles the master document should still re-check the split
> so N6–N10 do not re-capture the same ground.


> ### 📋 Handover for batch 2 (N6–N10) — please read before launching them
> This file already captures ground that N6, N7, N8 and N10 would otherwise re-walk. To avoid four
> terminals paying for the same screens twice:
> - **N8 (Finance)** — keep `/finance`, `/finance/cash-book`, `/finance/invoices`, `/finance/profitability`,
>   `/finance/inbox`. **The other 13 Finance screens are done** (§6.1–6.13) — skip them.
> - **N10 (HR part 2)** — keep `/hr/performance`, `/hr/resources`, `/hr/payroll`, and `/hr/onboarding`'s
>   **Board** tab. **Its Positions tab, the candidate pipeline, a candidate file and a pay-run detail are
>   done** (§6.17–6.20) — skip them.
> - **N9 (HR part 1)** — keep `/hr/dashboard`, `/hr/employees`, `/hr/attendance`, `/hr/time-tracking`.
>   **The three Attendance sub-screens are done** (§6.14–6.16) — skip them.
> - **N6 (Marketing)** — keep the five listed screens. **A client workspace and a project workspace with
>   all four of its tabs and all four create dialogs are done** (§6.21–6.22) — capture the *directory*
>   `/marketing/clients`, not the per-client pages.
> - **N7 (Web Projects)** — keep its three screens. **The three admin-only ones are done** (§3.5).
> - **Nobody was assigned the four public, no-sign-in screens** (§5) or the four Settings screens (§3) —
>   both are done here.

---

## 1. Sign-in screen — `/login`

**Where:** the only door. Two ways to arrive:
1. Type `/login`.
2. **Ask for any signed-in address while signed out and you are sent here** — verified with `/tasks`
   (→ `/login`) and with `/` (the root itself → `/login`). No message is shown about why you were moved;
   the address bar simply reads `/login`.

**What you see on arrival:** a pure black page (`bg-neutral-950`) with a very faint concentric-ring glow
behind everything. Dead centre, one rounded card about 330 px wide. Nothing else — no nav, no footer,
no language or theme control, no “forgot password”, no “sign up”, no links of any kind (the page contains
**zero** `<a>` elements). Two grey lines sit under the card: `PROTECTED SYSTEM` and `Nexeor Agency OS v2.0`.

**Inside the card, top to bottom:**

| # | Element | Detail |
|---|---|---|
| 1 | Logo tile | small rounded-square dark tile, gold/bronze Nexeor crest, the word `NEXEOR` under it |
| 2 | `Welcome back` | H1, white, bold |
| 3 | Sub-line | “Sign in to access your workspace and manage your agency.” |
| 4 | **`Continue with Google`** | full-width **white** button, Google “G” colour logo on the left. `type=submit`. This is the real staff route (Google/NextAuth). **Not clicked** — following it leaves the product for Google's own screens. |
| 5 | Divider | a hairline either side of the tiny grey caption **`STAGING ONLY`** |
| 6 | **`Sign in with Demo Credentials`** | full-width dark button with a hairline border. Nothing else is on screen at this point — **no fields exist yet** (the page has 0 inputs on arrival). |

**The one interaction the screen has — clicking the demo button:**

Clicking `Sign in with Demo Credentials` does **not** submit anything. It:
- **renames itself** to **`Access Demo Portal`**, and restyles from dark/outline to a **filled blue** button;
- **reveals two fields above itself**, so the card grows and re-centres:
  1. `Demo Username` — text input, **required**, empty by default, no autocomplete hint;
  2. `Password` — password input, **required**, empty by default;
- leaves `Continue with Google` and the `STAGING ONLY` divider exactly as they were;
- starts the new button **disabled** (greyed) — it stays disabled until both fields have content.

There is no “show password” eye, no “remember me”, no field labels above the boxes (the placeholder text
*is* the label), and no client-side validation message.

**A normal successful sign-in:** filling both boxes and pressing Enter (or the button) lands you on
**`/crm`** — confirmed: the address becomes `/crm` and the tab title becomes `CRM Board | Agency OS`.
There is no interstitial, no “choose a workspace” step and no welcome tour. The tab title on the login
page itself is just `Agency OS`.

**At 390 px:** the card shrinks to fit and stays usable and centred, in the same order. Two things to note:
the page reports a **scroll width of 695 px against a 390 px screen**, so the phone can be dragged sideways
into empty black — the decorative background layer, not the card, is what is oversized.

**Empty state / realtime:** none. Nothing on this screen moves on its own. The only network activity is a
repeated `GET /api/auth/session`.

### Odd things I noticed
- The login page scrolls sideways on a phone (695 px of page in a 390 px window) — the card is fine, the
  background layer is not.
- Wrong values were deliberately **not** tried, per the capture rules, so nothing here describes error text.

---

## 2. The app shell — the frame around every signed-in screen

**Where:** everywhere. Every signed-in address renders inside it.

**What you see on arrival:** the shell is **only two things — a left sidebar and a footer line.**
**There is no top header bar at all.** The page contains no `<header>` element, and no sticky or fixed bar
sits above the content on any screen I opened. There is:

- **no global search** (only per-page search boxes, e.g. “Search leads…” which belongs to the CRM page);
- **no notification bell**;
- **no avatar, no user menu, no “my account”** — the signed-in person's name and email appear nowhere in
  the shell. I searched every button, link and image in the DOM for avatar/profile/user/bell/gear/settings
  and got **zero** hits outside the nav itself;
- **no workspace or company picker**;
- **no theme control** — the app is dark-only (`body class="bg-neutral-950 text-neutral-100"`, no theme
  class ever set on `<html>`, no toggle anywhere).

Each page therefore supplies its own title block, and the only chrome is the rail on the left.

### 2.1 The sidebar — structure

- **Width 256 px**, pure black (`bg-black`), hairline right border, sticky full height, its own scrollbar.
- **Top 64 px = brand row:** the small gold Nexeor crest, **`Agency OS`** in white bold with **`NEXEOR`**
  in tiny letter-spaced grey beneath it, and on the right a **`‹` collapse button** (icon only).
- **Middle = the nav**, in this order: two loose items, then five collapsible groups.
- **Bottom, pinned, above a hairline: `Sign Out`** — icon + label, in red (`text-rose-400/80`).
  **Not clicked** — it would end the session; described from the screen only.
- **Under the whole page, full width:** the shell footer —
  `POWERED BY NEXEOR • COPYRIGHT © 2026 NEXEOR CREATIVE TECHNOLOGIES` (tiny, uppercase, letter-spaced, grey).

### 2.2 The complete sidebar tree, with the real address next to every line

Labels are exactly as printed. **Indentation = the click depth.** A `›` marks an item that is *both* a link
*and* an expander — clicking the label navigates, clicking its chevron opens a further list.

```
Agency OS / NEXEOR                                      (brand, not a link)   ‹ collapse
│
├── My Portal ....................................... /hr/portal
├── Global Tasks .................................... /tasks
│
├── ▾ Sales                                          (group header, not a link)
│     ├── CRM Board ................................. /crm
│     ├── Payment Calendar .......................... /crm/milestones
│     ├── Reports .................................. /crm/analytics
│     ├── Proposal Exporter ......................... /crm/proposal-builder
│     └── Campaign Pages ............................ /crm/campaigns
│
├── ▾ Marketing
│     ├── Overview .................................. /marketing
│     ├── Clients ›................................. /marketing/clients
│     │     ├── VELOCITY FITNESS .................... /marketing/clients/cmnyxtzxy003dj97l9ju2b2x7
│     │     │     └── Q2 Digital Retainer  (2 icon links, no text label)
│     │     │            ├── ☑ tasks ............... /marketing/projects/cmnyxu04u003gj97lzhbu42fv?tab=tasks
│     │     │            └── 🗓 calendar ............ /marketing/projects/cmnyxu04u003gj97lzhbu42fv?tab=calendar
│     │     ├── HORIZON RETAIL ..................... /marketing/clients/cmnyxty91002ij97l2xzl1846
│     │     │     └── Q2 Digital Retainer
│     │     │            ├── ☑ tasks ............... /marketing/projects/cmnyxtyet002lj97lyawjurvr?tab=tasks
│     │     │            └── 🗓 calendar ............ /marketing/projects/cmnyxtyet002lj97lyawjurvr?tab=calendar
│     │     └── NEXUS DYNAMICS ..................... /marketing/clients/cmnyxtvwm001mj97l29w75aq7
│     │           └── Q2 Digital Retainer
│     │                  ├── ☑ tasks ............... /marketing/projects/cmnyxtwb4001pj97lsh14pnru?tab=tasks
│     │                  └── 🗓 calendar ............ /marketing/projects/cmnyxtwb4001pj97lsh14pnru?tab=calendar
│     ├── Calendar ................................. /marketing/calendar
│     ├── Tasks .................................... /marketing/tasks
│     └── Ideas .................................... /marketing/ideas
│
├── ▾ Web Projects
│     ├── Board .................................... /projects/board
│     ├── My Work .................................. /projects/my-work
│     └── All Clients/Projects ..................... /projects
│
├── ▾ Finance
│     ├── Overview .................................. /finance
│     ├── Accounting ›.............................. /finance/cash-book
│     │     ├── CASH BOOK .......................... /finance/cash-book
│     │     ├── RECEIVABLES ........................ /finance/receivables
│     │     ├── PAYABLES ........................... /finance/payables
│     │     └── CLIENT LEDGERS ..................... /finance/client-ledgers
│     ├── Operations ›............................. /finance/invoices
│     │     ├── INVOICES ........................... /finance/invoices
│     │     ├── APPROVALS .......................... /finance/approvals
│     │     ├── INVENTORY .......................... /finance/inventory
│     │     ├── PAYROLL ............................ /finance/payroll
│     │     ├── RECONCILIATION ..................... /finance/reconciliation
│     │     └── WIO BANKING ........................ /finance/banking
│     ├── Reports & Tax ›.......................... /finance/profitability
│     │     ├── PROFITABILITY ...................... /finance/profitability
│     │     ├── VAT FILING ......................... /finance/vat
│     │     ├── TDS CREDITS ........................ /finance/tds
│     │     ├── CORPORATE TAX ...................... /finance/corporate-tax
│     │     └── FIXED ASSETS ....................... /finance/fixed-assets
│     └── AI & Tools ›............................. /finance/inbox
│           ├── FINANCE INBOX ...................... /finance/inbox
│           └── AI BOOKKEEPER ...................... /finance/ai-assistant
│
├── ▾ HR
│     ├── Dashboard ................................ /hr/dashboard
│     ├── Directory ................................ /hr/employees
│     ├── Attendance ›............................. /hr/attendance
│     │     ├── DASHBOARD (LIST) ................... /hr/attendance
│     │     ├── MASTER CALENDAR .................... /hr/attendance/calendar
│     │     ├── COMPANY HOLIDAYS ................... /hr/attendance/holidays
│     │     └── MARK ATTENDANCE .................... /hr/attendance/mark
│     ├── Time Tracking ........................... /hr/time-tracking
│     ├── Performance .............................. /hr/performance
│     ├── Recruiting ›............................. /hr/onboarding
│     │     ├── PIPELINE BOARD ..................... /hr/onboarding
│     │     ├── OPEN POSITIONS ..................... /hr/onboarding?tab=positions
│     │     └── CANDIDATE PIPELINE ................. /hr/onboarding/pipeline
│     ├── Resources ................................ /hr/resources
│     └── Payroll .................................. /hr/payroll
│
└── Sign Out                                        (button — ends the session)
```

**The label does not match the address in nine places** — write these down, they are the trap:

| Sidebar label | Actually goes to | Note |
|---|---|---|
| Finance ▸ **Accounting** | `/finance/cash-book` | the group's first child, not an “accounting” page |
| Finance ▸ **Operations** | `/finance/invoices` | |
| Finance ▸ **Reports & Tax** | `/finance/profitability` | |
| Finance ▸ **AI & Tools** | `/finance/inbox` | |
| HR ▸ **Attendance** | `/hr/attendance` | same address as its own child “DASHBOARD (LIST)” |
| HR ▸ **Recruiting** | `/hr/onboarding` | the word “onboarding” in the address means *recruiting*, not staff onboarding |
| HR ▸ **Recruiting ▸ OPEN POSITIONS** | `/hr/onboarding?tab=positions` | a tab, reached as a menu item |
| Marketing ▸ **Clients** | `/marketing/clients` | also the expander for the live client list |
| Web Projects ▸ **All Clients/Projects** | `/projects` | the group's *third* item is the group's root |

Also note: **HR ▸ Payroll (`/hr/payroll`) and Finance ▸ Operations ▸ PAYROLL (`/finance/payroll`) are two
different addresses with the same word on the label.**

### 2.3 How the current page is shown

- **A child item that is the current page**: pale-blue pill — `bg-sky-500/10`, sky-blue text, sky-blue
  hairline border. On `/crm`, `CRM Board` carries it.
- **Its parent group** shows it too: the group icon turns sky-blue and the group label goes from grey to
  full white, so you can see which section you are in even when the group is collapsed.
- **A loose item that is the current page** (My Portal / Global Tasks) gets a **solid blue pill**, not the
  pale one — seen on `/tasks`.
- Everything else is grey (`text-white/40`–`/70`) and lightens on hover.
- Each group header carries a chevron: **`▾` when open, `›` when closed.**

### 2.4 The sidebar's own controls

| Control | Where | What it does |
|---|---|---|
| **`‹` collapse** | top-right of the sidebar | Shrinks the sidebar **256 px → 70 px**. Brand text, all labels and the group children disappear; you are left with a vertical icon rail: hamburger at the top, then the 7 section icons, then the red sign-out icon at the bottom. The `‹` itself becomes a **`☰`** icon. Clicking it again restores 256 px. **The collapsed state is not remembered** — navigate to another screen and it is back to 256 px (nothing is stored in `localStorage` except a NextAuth session marker). |
| **Group header** (Sales, Marketing, Web Projects, Finance, HR) | in the nav | Opens/closes that group in place. **Only the group containing the current page starts open**; the other four start closed. Opening one does not close the others. |
| **`›` next to a child** | Marketing ▸ Clients, Finance ▸ Accounting / Operations / Reports & Tax / AI & Tools, HR ▸ Attendance / Recruiting | Opens the third level shown in the tree above. Marketing ▸ Clients goes deeper again: each client row has its own `›` opening its projects, and each project shows two icon-only links (tasks / calendar). |
| **`Sign Out`** | pinned bottom | Ends the session. Not clicked. |

### 2.5 Which sections appear at all — the shell is permission-driven

The shell asks the product who you are on **every** screen (`GET /api/settings/rbac`). For the demo account
the product answers:

```
superAdmin : false
fullAccess : false
permissions: ["Sales", "Marketing", "HR", "Web Projects", "Finance", "Global Tasks"]
```

Those six names are **exactly** what the sidebar renders — five groups plus the loose “Global Tasks”.
**“My Portal” is shown regardless** (it is not in the permission list). The role screen (§4) offers ten
menu names in total, so **four menus exist in the permission model that this login never sees**:
**Payroll, Settings, Paid Ads, Lighting Studio.** That is why the Settings screens in §3 are real pages
with no way to click to them from here — the menu that would link them is switched off for this role.
This also settles the “six groups” in the brief: there are **six permission-gated menus**, of which five
draw as groups and one (Global Tasks) draws as a single item.

### 2.6 The shell at 390 px

- **The sidebar is gone.** Both copies of it are off-screen: the desktop rail is `display:none`, the drawer
  copy sits at `x = -288`. The page content uses the full 390 px. Page width is exactly 390 — **no sideways
  scroll**, unlike the login screen.
- **A floating menu button appears instead**: a 36×36 rounded-square black button with a hairline border and
  a `☰` icon, **fixed 16 px from the left, 12 px from the top**, floating over the page content (`z-40`).
  It is the only navigation on a phone.
- **Tapping it slides in a 288 px-wide drawer** from the left over a dark scrim, holding the **same nav**:
  brand row (with an **`✕`** in place of the `‹`), My Portal, Global Tasks, the five groups (each still
  expandable), and `Sign Out` pinned at the bottom above a hairline. The current item is a solid blue pill.
- **Closing it:** the `✕` slides the drawer back to `x = -288`.
- **Nothing is unreachable** — the phone drawer carries the entire tree, including the third level.
- The collapse-to-70 px control does not exist at this width (it is desktop-only).

### Odd things I noticed
- The floating `☰` sits on top of whatever the page draws in its own top-left corner; on `/crm` it overlaps
  the area just left of the page title.
- On `/crm` an invisible overlay is always in the page (`fixed inset-0 z-[70] pointer-events-none`) whose
  text reads `Lead / ✕ / Loading Lead…`. It never becomes visible and never blocks clicks — the lead drawer's
  resting state. It does mean the words “Loading Lead…” are technically present on every CRM visit.

---

## 3. The screens nobody links to

None of the following is in the sidebar, and no button, gear or menu anywhere in the shell reaches them
(there is no gear and no user menu at all). I found them two ways: the obvious sibling addresses, and by
reading the route names the app's own shipped code carries. **Everything in this section renders a real
screen** unless marked.

### 3.1 `/settings` — the settings hub

**Where:** not reachable by clicking, for this login. Typed address only. (`/settings/*` sub-screens each
have a small back-arrow that returns *here*, so this is the intended hub.) It renders **inside the normal
shell**, so the sidebar is present.

**What you see on arrival:** one column of cards. A heading blurb that promises far more than is on screen:
“**Global Module Configurations** — Manage system-wide settings, SMTP credentials, webhook notifications,
and external integrations for HR, CRM, and Marketing modules.” Under it, only two cards render for this
role — there is **no visible link from here to `/settings/configuration`, `/settings/teams` or
`/settings/email-logs`**, even though those pages exist and link back to this one.

**Cards and controls:**

1. **Your GitHub Account** (H2, with a small `ⓘ` info button beside the title — **opened**: it reveals a
   step-by-step **“Creating a Personal Access Token”** helper listing exactly what to set —
   `Resource owner`, `Repository access`, `Repository permissions` with `Issues:`, `Pull requests:` and
   `Contents:` spelled out, the `repo` scope, `Generate token`, then “Paste it here and hit Connect.”)
   - Copy: “Connect your own token and issues, comments and edits you make in the portal are authored by
     you on GitHub instead of the shared Nexeor OS bot. Without it everything still works — it just shows
     up under the shared account.”
   - **Field:** password input, placeholder `github_pat_… or ghp_…`, empty, not required, **enabled**.
   - **Button:** `Connect` — **disabled**.
2. **Data Import Settings** (H1) — “Import data from Notion exports or external markdown files.”
   - **Import Notion Export (CSV)** — “Upload the Sales CRM…all.csv file exported from Notion.
     Automatically maps "Estimated Value" (AED), Status, Services (from Name tags), and Assignees.”
     Drop area labelled `Click to select CSV file`; hidden file input `accept=".csv"`, **disabled**.
     Button: **`Disabled for Demo`**.
   - **Legacy Markdown Import** — “Bulk import individual .md files”. File input
     `accept=".md,text/markdown"`, **disabled**. Button: **`Disabled for Demo`**.

**Tables/lists:** none. **Tabs:** none. **Empty state:** n/a. **Realtime:** none.
**What it asks the product for:** `/api/settings/rbac` (200), `/api/projects/github/token` (200),
`/api/settings/demo` (**403** — this is what turns the import buttons into “Disabled for Demo”).

### 3.2 `/settings/configuration` — Module Configurations

**Where:** typed address. Back-arrow at the top-left returns to `/settings`.
**What you see on arrival:** H1 **`Module Configurations`** — “Global settings, integrations, and webhooks
mapped specifically by workspace module.” Under it a row of **five tabs**, then that tab's cards.

**Tabs (all five, in order): `Email Senders` · `HR & Operations` · `Sales CRM` · `Finance` · `Marketing`.**

#### Tab 1 — Email Senders
- **Email Sender Identities** — “Configure the sender name and email address for each module. All emails
  are sent via AWS SES with automatic SMTP fallback. Each module can have its own branded sender identity.”
- **Email Logo** (H3) — “This logo appears at the top of every outgoing email. Upload a square logo for
  best results.” Drop area: `Drop image or click to upload`, `Recommended: 200×200px`, `Max size: 500 KB`,
  `PNG or SVG preferred`.
- Then **four sender blocks**, each with two empty fields labelled `SENDER NAME` and `SENDER EMAIL`:

| Block | Badge | Its stated purpose | Name placeholder | Email placeholder |
|---|---|---|---|---|
| **System Default** | `FALLBACK` | “general system notifications, password resets, and any module without a specific sender configured” | `Nexeor OS` | `os@nexeor.com` |
| **Sales & CRM** | — | “Invoices, retainer reminders, proposals, and all client-facing emails from the CRM module.” | `Nexeor Sales` | `sales@nexeor.com` |
| **HR & Operations** | — | “Onboarding invitations, offer letters, leave notifications, and payroll communications.” | `Nexeor HR` | `hr@nexeor.com` |
| **Marketing** | — | “Campaign emails, marketing automations, and outreach communications.” | `Nexeor Marketing` | `marketing@nexeor.com` |

- **DNS & Deliverability** note: “All sender emails must belong to a domain verified in AWS SES. If you also
  use Google Workspace on the same domain, ensure your SPF record includes both `include:amazonses.com` and
  `include:_spf.google.com`. DKIM keys from both services should be configured in your DNS.”
- “Empty fields will use the System Default sender. If Default is also empty, the env variable `SMTP_FROM`
  is used.”
- One button: **`Disabled for Demo`** (this is the save).

#### Tab 2 — HR & Operations
- **HR Email Alerts** — “Configure which email addresses or staff members should receive automated alerts
  (e.g., when a candidate submits onboarding or signs an offer).”
  Current recipients shown as removable chips (`✕` on each): `kartik.kittad@nexeor.com`, `amal@nexeor.com`.
  Then **`Select System User`**, a dropdown whose **complete option list is 28 entries** — the whole staff
  directory, formatted `Name (email)`:
  `-- Click to select staff --` (default) · xyz (xyz@nexeor.com) · abcd (abcd@nexeor.com) ·
  Mathangi Chandu (mathangi@…) · ritika (ritika@…) · Antra Agrawal (antra.agrawal@…) · Sandra KK (sandra@…) ·
  Deep Sheth (deep@…) · akhila kr (akhila.kr@…) · Dhrumil Gadaria (dhrumil@…) · work6 (work6@…) ·
  Test Demo (test_demo@example.com) · Emaad Sultan (emaad@…) · Megha M (megha@…) ·
  Kingson Thomas (kingson@…) · Admin (admin@nexeor.ae) · Amal Vijayakumar (amal@…) · Ganesh S N (ganesh@…) ·
  Syeda Umme Kulsum (syeda@…) · Kevin Norbert (kevin.norbert@…) · Info Nexeor (info@…) ·
  Navaneeth B (navaneeth.b@…) · Gokulakrishnan R (gokulakrishnan@…) · Kartik Kittad (kartik.kittad@…) ·
  Swathikrishna U S (swathikrishna@…) · Rayan Patel (rayan@…) · Chris george (chris.george@…) ·
  Rohit Vinod (rohitvinod@…).
  Beside it **`Or Type Custom Email`** — email input, placeholder `external@domain.com`, plus a **`+`** button.
  Save: **`Disabled for Demo`**.
- **Employee Attendance & Leave Policy** — “Determine the maximum allowed paid leaves, sick leaves, and
  company holiday limitations.” Four number fields **with their live values**:
  `Max Paid Leaves (PTO) / Month` = **2** · `Max Sick Leaves (SL) / Month` = **2** ·
  `Sick Leave Med Cert Threshold (Days)` = **2** · `Total Global Holidays / Year` = **13**.
  Save: **`Disabled for Demo`**.
- **Email Delivery** — a read-only notice, “**Managed by AWS SES**”: “All HR emails (onboarding, offer
  letters, leave notifications) are now sent via AWS SES with automatic SMTP fallback. To configure the
  sender address for HR emails, go to Settings → Configuration → Email Senders.” (That trail is a button.)
- **Slack Notifications** — “Determine where automated HR alerts are routed in your Slack Workspace.”
  `Slack Channel Name` (text, placeholder `#hr-updates`, empty) · `Channel ID (Webhook reference)` (text,
  placeholder `C01234567`, empty) · two switches: **Announce New Employee Onboarding** and
  **Notify on new Leave/Absence Requests**. Save: **`Disabled for Demo`**.

#### Tab 3 — Sales CRM
- **Lead Services** — “The service tags offered when creating or editing a lead. Renaming a service updates
  it everywhere — the stored code stays fixed so existing leads keep their tags.”
  A `PREVIEW` strip of chips, then the editable list. **All 11 services, label → stored code:**
  Website → `WEBSITE` · Marketing → `DIGITAL_MARKETING` · E-Commerce → `ECOMMERCE` · Nexeor OX → `NEXEOR_OX` ·
  Custom Dev → `CUSTOM_DEV` · SEO → `SEO` · Mobile App → `MOBILE_APP` ·
  Digital Partnership → `DIGITAL_PARTNERSHIP` · Branding → `BRANDING` · ERP → `ERP` · Other → `OTHER`.
  **Row actions (per service):** `↑ Move up` · `↓ Move down` · `⌄ Edit` · `🗑 Delete` — except **Other**,
  which shows a **padlock** titled “Other is the fallback and can't be deleted”.
  Below: **`Add Service`** · **`Restore defaults`** · a **`Saved`** state chip.
- **Invoice Numbering & Defaults** — “Global fallbacks that pre-fill when creating new invoices from the
  CRM. These can be overridden per invoice.” + a pointer: “Company letterheads, tax and payment terms now
  live per entity in Settings → Configuration → Finance.”
  **Numbering:** prefix = **`NXRU`** (“Fallback series prefix — used when an entity has no series of its
  own”) · `Starting Number` = **1** · `Default Currency` = **AED**. Save: **`Disabled for Demo`**.
- **Bank Accounts** + **`Add Bank`** — “Configure bank accounts for wire transfers. These will be available
  when creating invoices — you can select one or more banks per invoice.” Two accounts:
  **Nexeor Creative Technologies FZCO** and **INR - Nexeor Creative Technologies PVT LTD**; the second
  prints its full `BANK DETAILS` (Axis Bank, Palarivattom Ernakulam branch, account 925020058216178,
  IFSC UTIB0000691, branch ID 691, SWIFT AXISINBB081, and the branch address). Per-account actions:
  **`★ Set as Default`**, **`✎ Edit`**, **`✕`**.
- **Email Delivery ▸ Default recipients** — “Always copied on outbound sales email — invoices and retainer
  reminders. They appear in the composer so they can be removed for a one-off send, and are applied again
  on the server so a send can never miss them.” `CC` = rohitvinod@nexeor.com · `BCC` = rohitvinod92@gmail.com.
  Save: **`Disabled for Demo`**. Plus the same “Managed by AWS SES” notice.

#### Tab 4 — Finance
This tab is the money-approval and legal-entity setup. **A red line at the bottom reads `Failed to load
settings`** while the form itself renders (see Odd things).
- **Approval routing** — “Who approves each domain at the leadership stage. Anything unclassified goes to
  the fallback (Chris). Accounts then verifies & releases for payment.” **Six domain rows**, each a
  dropdown currently reading **`— unassigned —`** (and offering only that, for this login):
  1. `Operations — Accounts, IT-client side — Chris`
  2. `Sales & Marketing — MKT, Sales — Manan`
  3. `IT / Nexeor spend — IT high-level, Nexeor expenditure — Kevin`
  4. `Admin — Master admin — Rohit`
  5. `HR — Payroll & HR activities`
  6. `Unclassified fallback — new / unknown → Chris`
- **Threshold approver** — “Above the per-entity threshold, only this person may approve stage 1.”
  One dropdown: `— select (Rohit) —`.
- **Accounts role** — “Members of this role perform the final verify & release for payment.”
  One dropdown: `— select Accounts role —`.
- **Escalation thresholds** — “In each entity's local currency. Leave blank until set by Rohit. A request
  above the threshold routes to the threshold approver above.” Two number fields, both empty
  (placeholder `not set`): **Nexeor India (INR)** and **Nexeor UAE (AED)**.
- **Entities** — “The full invoicing profile per legal entity — legal name, registered address,
  registrations, tax, numbering series, currencies and bank accounts. Everything printed on invoices and
  statements comes from here.” **Two entities, `INDIA` and `UAE`**, each with a radio
  “Default entity — bills all unlisted currencies” and this identical field set:
  `DISPLAY NAME` · `LEGAL NAME` (placeholder “Printed on documents”) · `REGISTERED ADDRESS` (textarea) ·
  `REGISTRATIONS (PRINTED UNDER THE ADDRESS)` — repeating pairs of *type* (placeholder
  `GSTIN / CIN / PAN / TRN`) and *value*, each removable via `✕ Remove registration`, plus
  **`Add registration`** · `EMAIL` · `PHONES (COMMA-SEPARATED)` · `WEBSITE` · `LOGO URL` ·
  `TAX LABEL` (placeholder `VAT (5%) / GST (18%)`) · `TAX RATE %` · `INVOICE PREFIX` (placeholder
  `NXRU / NXIN`) · `NUMBERING START` · `CURRENCIES (COMMA-SEPARATED)` (placeholder
  “AED / INR — first exact match wins”) · `PAYMENT TERMS` (placeholder “e.g. Due within 14 days”) ·
  `BANK ACCOUNTS` — tick-boxes for the two accounts above.
  India's live values: Nexeor India / Nexeor Creative Technologies Private Limited /
  17/1 Kavalampilly Padikkal, Paradise Road, Vyttila, Kochi … / GSTIN 32AALCN8952A1ZI ·
  CIN U62090KL2026PTC104949 · PAN AALCN8952A / info@nexeor.com / +91 95677 00937 / www.nexeor.com /
  GST (18%) / 18 / NXIN / 1 / INR.
- One save: **`Save finance settings`** (this tab's save is **not** disabled for the demo — **not clicked**).

#### Tab 5 — Marketing
A single line: **“Marketing Configurations coming soon.”** No fields, no buttons.

### Odd things I noticed
- The Finance tab shows **`Failed to load settings`** at the bottom while simultaneously rendering the
  entities with real values — the error and the data disagree.
- The Finance tab's **`Save finance settings`** is the one settings button *not* locked behind
  “Disabled for Demo”.
- The six approval-routing dropdowns and the two role dropdowns offer **no choices at all** for this login
  (just the `— unassigned —` / `— select … —` placeholder), so the screen cannot be completed from here.

### 3.3 `/settings/teams` — Teams & Access  *(this is the roles-and-users screen)*

**Where:** typed address. Renders in the normal shell.
**What you see on arrival:** H1 **`Teams & Access`** — “Manage role-based security arrays, invite new staff
members, and configure dynamic dashboard visibility rules globally.” A **two-button segmented control at
the top right**: **`Overview & Roster`** (default) and **`Access Roles`**.

#### Tab A — Overview & Roster
- **Active Roster** (H2) with one button on the right: **`Disabled for Demo`** (the invite control).
- **Team tiles**, seven of them, each “name + member count”:
  **Super Admins — 24** · QA team — 2 members · multiple member test team — 0 members ·
  Developer Team — 6 members · Marketing Team — 2 members · HR Department — 4 members · Sales Team — 3 members.
- **User Roster Directory** (H3) — a card list, **27 people**, each row: circular initial avatar · name ·
  a role chip · email · optional GitHub handle · the role chip again on the right, then the row actions.
  The full roster as printed: xyz (QA team) · abcd (QA team) · Mathangi Chandu · ritika · Antra Agrawal ·
  Sandra KK · Deep Sheth · akhila kr · Dhrumil Gadaria · **work6 (no role — shows `Assign roles…`)** ·
  Test Demo · Emaad Sultan · Megha M (@MeghaMuralidharan) · Kingson Thomas · Admin · Amal Vijayakumar ·
  Ganesh S N · Syeda Umme Kulsum · Kevin Norbert · Info Nexeor · Navaneeth B (@iinava) ·
  Gokulakrishnan R (@gokul9070) · Kartik Kittad (@gokul9070) · Swathikrishna U S (@swathikrishnaus) ·
  Rayan Patel · Chris george · Rohit Vinod (@RohitKV1n0d). All except xyz, abcd and work6 read **`SYS ADMIN`**.
- **Row actions:**
  - the **role chip** itself is a button (`SYS ADMIN`, `QA team`, or `Assign roles…` when empty) — it opens
    the role picker described next;
  - **`🗑` titled “Permanently Delete User”** — on every row;
  - **`GitHub` icon titled “Disconnect @&lt;handle&gt; from GitHub”** — only on the five rows that have a handle.
- **The role picker** (opened from a chip, closed with Escape — nothing was selected): a small popover
  headed **`ACCESS PROTOCOL`** listing **`System Admin` — `Full Access`**, then the six roles:
  `QA team` · `multiple member test team` · `Developer Team` · `Marketing Team` · `HR Department` · `Sales Team`.
  Same list from either an assigned chip or the empty `Assign roles…`.
- **No search, no filter, no sort, no paging** on this roster — all 27 rows render at once.

#### Tab B — Access Roles
- **`Construct New Role`** (card, shield icon)
  - **`ROLE IDENTITY`** — text field, placeholder **`e.g. Content Marketing Team`**, empty, the only field.
  - **`+ Create Role`** — green button. *(Not clicked.)*
  - **`INJECT ALLOWED SIDEBAR MENUS`** — a grid of **ten toggle chips**, each with a small dot on its right
    (all off by default). **The complete list, in screen order:**
    1. `Global Tasks`
    2. `Sales`
    3. `Marketing`
    4. `Web Projects`
    5. **`Paid Ads`**
    6. `Finance`
    7. `HR`
    8. **`Payroll`**
    9. **`Settings`**
    10. **`Lighting Studio`**
  - This ten-name list **is** the whole permission vocabulary the product offers. There is no
    read/write/delete dimension and no per-screen or per-field permission — **a role is a set of
    top-level menus, nothing finer.**
- **`Existing Database Roles`** — a card grid. **Seven cards:**

  | Role | Menu allocations | Members | Actions |
  |---|---|---|---|
  | **System Admin** (green, first) | — “Base Core system accounts natively bypass the entire RBAC database matrix, ensuring unhindered access globally. **Cannot be deleted.**” badge **`CORE NATIVE`** | (24, per the roster tile) | none |
  | QA team | Global Tasks · Sales · Marketing · Web Projects | 2 Connected Members | `EDIT` `DELETE` |
  | multiple member test team | Marketing · Settings · HR | 0 Connected Members | `EDIT` `DELETE` |
  | Developer Team | Web Projects | 6 Connected Members | `EDIT` `DELETE` |
  | Marketing Team | Marketing · Global Tasks | 2 Connected Members | `EDIT` `DELETE` |
  | HR Department | HR · Payroll · Settings · Web Projects | 4 Connected Members | `EDIT` `DELETE` |
  | Sales Team | Sales · Finance · Global Tasks | 3 Connected Members | `EDIT` `DELETE` |

- **`EDIT` turns the top card into an edit form** (verified on QA team, then left without saving):
  the heading changes **`Construct New Role` → `Update Existing Role`**, `ROLE IDENTITY` pre-fills with the
  role name (`QA team`), the ten menu chips light up to match that role, and the buttons become
  **`Cancel`** and **`Save Changes`**. *(`Save Changes` not clicked; left via navigation.)*
- **`DELETE`** — not clicked.
- **Empty state:** not seen; there are always at least the System Admin card.
- **Realtime:** none — the lists load once per visit.

### 3.4 `/settings/email-logs` — Email Logs

**Where:** typed address; back-arrow to `/settings`.
**What you see on arrival:** H1 **`Email Logs`** — “Track all outgoing emails — SES delivery, SMTP fallback,
and failures.” Four stat tiles, a filter row, then a list.

**Numbers/cards on the page (live values):**
`11` **TOTAL SENT** · `0` **FAILED** · `66` **SMTP FALLBACK** · `0` **THIS WEEK**.
*(These do not reconcile with the list's own total of 77 — see Odd things.)*

**Filters (complete option lists):**
- Search box — placeholder `Search by email, subject...`
- Module dropdown: `All Modules` (default) · `HR` · `CRM` · `NOTIFICATIONS` · `MARKETING` · `SYSTEM`
- Status dropdown: `All Statuses` (default) · `Sent` · `Fallback` · `Failed`
- Two **date** inputs (from / to), both empty.

**The list:** each row is a clickable card, not a table — recipient email · module badge · subject ·
event-type code · transport (`SES` or `SMTP`) · timestamp.
**Clicking a row opens the full delivery record** (opened on an `INVOICE_SEND` row): a `VIA SES` badge,
then `FROM` (the resolved sender identity, here `Nexeor OS <os@nexeor.com>`), `TO`, `CC`, `BCC`, `SENT`
(the full timestamp — `August 20th, 2026 at 8:12:04 AM`), `TRIGGER`, `MESSAGE ID` (the mail provider's
own id, e.g. `010901a01d0c0d52-1c667718-18f8-4aa7-acee-d33e584b0b80-000000`), and a **`Metadata`** block
holding the record the mail was about, as stored:
`{ "leadId": "cmnyxtnjw0007j97lkwhihdip", "currency": "INR", "invoiceId": "cmt07nxsv000i14g7iqogi32c", "totalAmount": 9097, "invoiceNumber": "NXRU0014" }`.
So a delivery can be traced back to the exact invoice and lead. A **funnel** icon sits beside the search
row; clicking it revealed nothing new (the filters it would toggle are already on screen). Event codes seen in the data:
`GENERAL`, `INVOICE_SEND`, `RETAINER_MANUAL_EMAIL`, `RETAINER_TEST_EMAIL`, `FINANCE_INVOICE_SEND`.
Modules seen: `SYSTEM`, `CRM`, `FINANCE`.
**Page size 20**, and the footer reads **`77 total · Page 1 of 4`** with prev/next arrows.
Newest first (Aug 20 down to Jul 24 on page 1).
**Realtime:** none; it fetches `/api/settings/email-logs?page=1&limit=20` per page.

### Odd things I noticed
- The four tiles disagree with the list: “TOTAL SENT 11” and “SMTP FALLBACK 66” against a list that says
  **77 total**. It reads as if “total sent” is counting only one transport.

### 3.5 Three admin-only Web Projects screens

These exist, are in no menu, and answer with a polite refusal for this login (the product's own words, no
error page):

| Address | What it renders |
|---|---|
| `/projects/capacity` | H1 **`Restricted`** — “Team capacity and workload data are visible to administrators only.” (its data call answers 403) |
| `/projects/clients` | H3 **`Admins only`** — “Client Dashboards are restricted to system administrators.” plus a **`Back to Projects`** link to `/projects` |
| `/projects/revenue` | H1 **`Restricted`** — “Revenue and financial figures are visible to administrators only.” |

They render inside the shell and are, on the evidence of the copy, real dashboards for a System Admin.

### 3.6 `/payroll` — an unfinished stub

Renders in the shell with the title **`Finance`** and one line: **“This is the Finance page. More features
coming soon.”** Not in any menu. (`Payroll` is one of the ten permission names, so this is presumably where
that menu will point.)

### 3.7 `/dashboard` — an alias

Answers 200 but immediately lands you on **`/crm`**. No screen of its own.

### 3.8 What an address that does not exist shows

`/zzz-not-a-page` → **HTTP 404** and the bare Next.js default: **`404`** as an H1 and
**`This page could not be found.`** as an H2, centred on white-on-black. **No sidebar, no footer, no
“go back” link, no product branding at all** — it does not look like Nexeor. The tab title stays
`Agency OS`.

**The same 404 was returned by:** `/settings/rbac`, `/settings/users`, `/settings/roles`, `/settings/general`,
`/settings/integrations`, `/admin`, `/profile`, `/users`, `/notifications`, `/onboarding`, `/team`,
`/account`, `/rbac`, `/paid-ads`, `/ads`, `/lighting`, `/lighting-studio`, `/studio`, `/marketing/paid-ads`.
So **“Paid Ads” and “Lighting Studio” are permission names with no screen behind them yet**, and the
roles/users screens live at `/settings/teams`, not at any `rbac`/`users` address.

---

## 4. The role model, as the product presents it

Everything below is read off `/settings/teams ▸ Access Roles`. Nothing was ticked, created or saved.

- **A role is a name plus a list of allowed top-level menus.** That is the entire model. There is no
  read/write/approve distinction, no per-screen permission, no per-field permission and no data scoping
  (“only my own leads”) offered anywhere on this screen.
- **The vocabulary is exactly ten menu names:** `Global Tasks`, `Sales`, `Marketing`, `Web Projects`,
  `Paid Ads`, `Finance`, `HR`, `Payroll`, `Settings`, `Lighting Studio`.
- **`System Admin` is outside the model** — “Base Core system accounts natively bypass the entire RBAC
  database matrix, ensuring unhindered access globally. Cannot be deleted.” In the picker it reads
  `System Admin — Full Access`. 24 of the 27 people in the roster hold it.
- **Six editable roles exist**, with the allocations in the table in §3.3.
- **A person can hold more than one role** — the control is called “Assign roles…” (plural) and the tab
  copy says “role-based security arrays”.
- **What a role controls is visibility of a menu.** Proven live: the demo login is granted
  `Sales, Marketing, HR, Web Projects, Finance, Global Tasks` and the sidebar renders precisely those; the
  `Settings` menu it is *not* granted is absent, while the `/settings/*` screens themselves still render.
  Some individual screens additionally refuse on their own (`/projects/capacity`, `/projects/clients`,
  `/projects/revenue` say “administrators only”), so screen-level admin checks exist in the product but are
  **not** something this screen lets you configure.
- **Three people carry a non-admin role or none:** xyz and abcd are `QA team`; `work6` has no role at all
  and shows `Assign roles…`.

### Odd things I noticed
- Two roles in the live data look like leftovers from testing: **`QA team`** and
  **`multiple member test team`** (0 members).
- `HR Department` and `multiple member test team` both include **`Settings`** — i.e. the settings hub,
  the email logs and this very roles screen — alongside ordinary HR duties.
- The first sidebar item, **My Portal (`/hr/portal`), does not work for this login**: it renders
  **“Access Restricted / User not found”** with a `Sign Out` button. The demo account has no employee
  record behind it. (Screen belongs to N5's scope; recorded here because it is the shell's first item.)

---

## 5. The other three doors — the public screens

**`/login` is not the only way in.** Three more address families answer with a full screen and **no
sign-in at all** (each verified in a clean browser with no session: they render identically signed-in and
signed-out). All belong in this file because they are entrances to the same product and are in no menu:
the leave portal (§5.1), the careers pages (§5.2–5.3), and **one portal per client** (§5.4).

### 5.1 `/attendance` — Leave Request Portal *(public)*

**Where:** typed address, or the **`Open Public Portal`** button that sits at the top of all three HR ▸
Attendance screens. **No sidebar, no footer, no branding** — a bare centred form on the dark background.
**Identical whether or not you are signed in.**

**What you see:** H1 **`Leave Request Portal`** — “Officially submit your leave requests directly into the
centralized Agency dashboard securely.” Four numbered steps:

| Step | Control | Detail |
|---|---|---|
| **1. FIND YOUR IDENTITY** | text box, placeholder `Type to search your name...` | a type-ahead against the staff list — you identify yourself by picking your own name |
| **2. LEAVE MODALITY** | dropdown | **all 3 options:** `Annual Leave / PTO` (default) · `Sick Leave` · `Unpaid Leave` |
| **3. DURATION TYPE** | dropdown | **all 3 options:** `Single Day Leave` · `Multiple Days` (default) · `Half Day Leave` — then two date boxes, `FIRST DAY` and `LAST DAY` |
| **4. MANDATORY REASON / NOTES** | textarea, placeholder `Please provide explicit details for HR review...` | |

One button: **`Transmit Secure Request`** — **not clicked** (it would file a real leave request against a
real person's name).

### 5.2 `/apply` — Join Our Team *(public careers index)*

**Where:** typed address, or the `Apply` breadcrumb on a job page. **This screen uses a completely
different shell from the rest of the product** — the public Nexeor marketing site's chrome:
a top nav of `Home` · `Services` · `Portfolio` · `Contact` (all pointing off-site to `nexeor.com`,
`/services`, `/portfolio`, `/contact`), and a full marketing footer:
*“Elevate. Innovate. Dominate. Your trusted partner in digital transformation.”* with the **Dubai** office
(Building A1, IFZA Business Park, DDP, Dubai Silicon Oasis), the **Kochi** office (Near Petta Metro
Station), `info@nexeor.com`, `+971 56 661 3554`, `+91 95677 00937`, `© 2026 Nexeor. All Rights Reserved.`
and Instagram / LinkedIn / X links.

**What you see:** H1 **`Join Our Team`** — “Explore open positions and build the future with us. We are
always looking for passionate individuals to join our growing agency.” A **`FILTERS`** panel with three
dropdowns whose options are built from the live jobs (`LOCATION`: All / kochin · `ROLE TYPE`: All /
FULL TIME · `DOMAIN`: All / Engineering), the count line **`Showing 1 role`**, and one job card
(`tester l2` · INR 35000 · FULL TIME · Engineering · kochin) with a **`View JD`** button.

### 5.3 `/apply/<slug>` — the job page and application form *(public)*

**Where:** `/apply/tester-l2` — the slug is set by whoever creates the position (§6.18). Same public
marketing shell as `/apply`.

**What you see:** the job header (title, department, location, `FULL TIME`, `INR 35000`, the description
“good knowledge in testing”) and the **share URL printed on the page**, complete with its campaign tag:
`https://os-staging.product.nexeor.com/apply/tester-l2?source=linkedin`.

**Two ways to apply — the first is the AI one:**
1. **`Easy Apply`** — badge **`AI-POWERED APPLICATION`**. “Drop your resume and our AI will auto-fill your
   entire application in seconds.” A drag-and-drop area: `Drag & drop your resume here` /
   `or click to browse • PDF, DOC, DOCX` / `AI reads and auto-fills everything`. One file input.
2. **`or apply manually without a resume →`** — reveals the full form, in six numbered sections:

| Section | Fields (placeholder in brackets; `*` = required) |
|---|---|
| **Personal Information** | `FIRST NAME *` [John] · `LAST NAME *` [Doe] · `EMAIL ADDRESS *` [john@example.com] · `PHONE NUMBER` [+1 234 567 890] · `CURRENT TITLE` [e.g. Senior Frontend Developer] · `LOCATION` [e.g. Dubai, UAE] |
| **Links & Portfolio** | `LINKEDIN` [https://linkedin.com/in/…] · `PORTFOLIO / WEBSITE` [https://…] · `RESUME` — upload area, “PDF, DOC, or DOCX” |
| **Skills** | a tag box, `Add a skill…` |
| **Work Experience** | repeating block, **`Add Experience`** |
| **Education** | repeating block, **`Add Education`** |
| **Cover Letter** | marked `Optional`; textarea “Tell us why you're interested in this role and what makes you a great fit…” |

One button: **`Submit Application`** — **not clicked**.

**Realtime:** none. **Empty state:** `/apply` would show its “Showing N roles” count at 0; not seen with
zero jobs.

### Odd things I noticed
- The public leave portal identifies a person only by picking their name from a list, and the same form
  exists inside the product as HR ▸ Attendance ▸ **Mark Absence Override** (§6.16) — the two screens are
  the same four steps with different wording (“FIND YOUR IDENTITY” vs “SELECT EMPLOYEE PROFILE”).
- The careers pages are the only screens in the whole product that carry the outward-facing Nexeor
  website design instead of the black dashboard shell.


### 5.4 `/share/<token>` — the client's own portal *(public)*

**Where:** every Marketing client carries one. On the client workspace (§6.21) the link is shown truncated
as `.../share/cmnyxt...` beside **`Copy Link`**, **`Preview`** and **`Regenerate`**. The real address is
built from the client record's `publicToken`, which is a *different* id from the client's own —
e.g. client `cmnyxtzxy003dj97l9ju2b2x7` → **`/share/cmnyxtzxy003ej97lzks126av`**. The record also carries
an on/off flag (`isPublicActive`), so a portal can presumably be switched off; **`Regenerate`** replaces
the token, which is how you revoke a link you have already sent.
**No sign-in.** Verified in a clean browser with no session. `/share` on its own is a 404 — the token is
the whole address, so a client cannot browse from their portal to anyone else's.

**What you see on arrival:** a compact header — an `NX` badge, the client's name (**Velocity Fitness**),
and three tabs. No sidebar, no sign-out, nothing of the agency's own product. Then
H2 `Marketing Overview` — “Real-time updates on your campaigns and content.”

**Tabs (3): `Content Calendar` (default) · `Master Assets` · `Live Performance`.**

- **`Content Calendar`** — a month grid (`September 2026`, a `Today` button, `‹`/`›`, the day marked
  **`TODAY`**), then a **`TIMELINE VIEW`** listing every planned post in date order: month + day, the
  state chip (`PUBLISHED`, `APPROVED`, `SCHEDULED`, `DESIGN`, `DRAFTING`, `IN PROGRESS`, `REVIEW`,
  `CHANGES REQUESTED`, `REJECTED`, `DONE`, `TODO`), the post title, and a caption preview — or the words
  **`No caption preview`** where there is none. This is the same content the agency sees internally on
  the project's calendar tab, minus the internal deadlines.
- **`Master Assets`** — H3 `Master Assets` — “Access shared folders, files, and submit brand reference
  links directly.” One button, **`Submit Reference Link`** — so the portal is not read-only; the client
  can push URLs back into the agency's vault. Then `ROOT VAULT RESOURCES`.
  **Empty state:** **`Vault Empty`** — “Use the "Submit Reference Link" button above to inject URLs
  directly into your agency dashboard.” (`Submit Reference Link` **not clicked** — it writes into the
  agency's data.)
- **`Live Performance`** — **this tab crashes the portal.** See below.

**At 390 px** the portal fits the screen exactly (page width 390, no sideways scroll) — which matters,
because a client is the person most likely to open this on a phone.

### Odd things I noticed
- **The `Live Performance` tab takes down the whole client portal.** Clicking it replaces everything with
  the browser's own message: *“Application error: a client-side exception has occurred while loading
  os-staging.product.nexeor.com (see the browser console for more information).”* The underlying error is
  `Cannot read properties of undefined (reading 'length')`. **Reproduced 2 times out of 2** in a clean
  browser with no session: the portal loads fine, the tab is clicked, the page dies. Once it dies the
  client has lost the calendar too, and has to reload the link to get anything back. This is on a page
  the agency sends to paying clients.
- The portal's calendar shows posts dated `JAN 1` titled `BUG-86 Rejected overdue`,
  `BUG-86 Approved overdue`, `BUG-86 Done overdue`, `BUG-86 Active overdue` and `achu` — internal test
  rows, visible to the client on the client-facing page.

---

## 6. The screens nobody was assigned — captured (22 of them)

Every one of these renders a real screen. They were reached from the sidebar's third level (the `›`
chevrons) or from links inside the screens above. Format matches the rest of the file.

### 6.1 Receivables — `/finance/receivables`
**Where:** Finance ▸ Accounting ▸ RECEIVABLES.
**What you see:** H1 `Receivables` — “Track outstanding invoices and incoming payments”. An entity switch,
a date range, three money tiles, an aging panel, a status filter and one long table.
**Entity switch (3 buttons):** `Consolidated` (default) · `Nexeor India (INR)` · `Nexeor UAE (AED)`.
**Date range:** two `dd-mm-yyyy` boxes (`From date` → `To date`), each with a “Open … date picker” button.
**Numbers/cards:** `Outstanding` **AED 222,142** (30 invoices pending) · `Overdue` **AED 222,142**
(30 invoices past due date) · `Collected` **AED 114,080** (all received payments).
**Aging Analysis:** `Current` AED 172,433 (9 invoices) · `31-60 Days` AED 7,246 (8) ·
`61-90 Days` AED 42,463 (13) · `90+ Days` AED 0 (0).
**Controls:** `Export` (**not clicked**), search box `Search invoices...`, and a status filter —
**all 4:** `All` · `Sent` · `Overdue` · `Paid`.
**Table columns (9):** `INVOICE #` · `ITEM` · `CLIENT` · `ISSUED` · `DUE` · `AMOUNT` · `OUTSTANDING` ·
`STATUS` · `VIEW`. A due date that has passed prints the age inline, e.g. `2026-06-20(79d)`. The last
column is either a **`View`** button (title “View invoice in Finance”) or the flat text **`No invoice`**
where the row has no invoice number (the `INVOICE #` cell shows `—`).
**Realtime:** none.

### 6.2 Payables — `/finance/payables`
**Where:** Finance ▸ Accounting ▸ PAYABLES.
**What you see:** H1 `Payables` — “Bills you owe vendors & suppliers”. The same entity switch, the same
date range, `Export`, and **`Add Bill`**. Then, in place of the list, the single word **`Unauthorized`**.
**Why:** the page's own data request answers 401 for this login. The toolbar still renders.
**Not reachable for this login**, so the bill list, its columns and the `Add Bill` form are unknown.

### 6.3 Client Ledgers — `/finance/client-ledgers`
**Where:** Finance ▸ Accounting ▸ CLIENT LEDGERS.
**What you see:** H1 `Client Ledgers` — “Full transaction history per client account · 14 clients”. Entity
switch, date range, `Export`, a searchable client list on the left (`Search clients...`), and the selected
client's ledger on the right.
**The client list** — each row: circular initial · client name · `Last: <date> · N txns` · either
`Due: AED N` or a green **`✓ Settled`**. Live rows (14, footer `14 of 14 clients`):
Stave Corp IN_PROGRESS - 3 (AED 81,461) · Stave Corp ON_HOLD - 1 (71,142) ·
Stave Corp RECURRING - 4 (40,770) · Italica (18,045) · Stave Corp CLOSED - 1 (10,797) ·
Stave Corp RECURRING - 5 (9,804) · Stave Corp IN_PROGRESS - 2 (7,345) ·
Stave Corp IN_PROGRESS - 4 (4,504) · Stave Corp IN_PROGRESS - 5 (2,700) ·
Stave Corp IN_PROGRESS - 1 (2,000) · Stave Corp QUALIFIED - 1 (707) · Checkpoint 12 INR Test (35) ·
Test (13) · Stave Corp IN_PROGRESS - 7 (Settled).
**The selected ledger:** the client name, `N transactions`, `Balance Due`, two tiles (`TOTAL INVOICED`,
`TOTAL RECEIVED`), a **`Balance Trend`** line chart, a three-way filter — **all 3:** `All Transactions` ·
`Invoiced` · `Received` — and a table: `DATE` · `DESCRIPTION` · `INVOICED` · `RECEIVED` · `BALANCE`
(running balance).

### 6.4 Approvals — `/finance/approvals`
**Where:** Finance ▸ Operations ▸ APPROVALS.
**What you see:** H1 `Approvals` — “Expenditure awaiting approval. Leadership approves first (Rohit above
threshold), then Accounts verifies & releases for payment.” One control, a **`My queue`** toggle, then the
single word **`Unauthorized`** (its data request answers 401 for this login).
**Not reachable for this login.** The queue, its columns and the approve/release controls are unknown —
but the strapline confirms the two-stage flow configured in Settings ▸ Configuration ▸ Finance (§3.2).

### 6.5 Inventory — `/finance/inventory`
**Where:** Finance ▸ Operations ▸ INVENTORY.
**What you see:** H1 `Inventory` — “Software licenses · Hardware · Cloud services · Print media”. Four
tiles, a bar chart, two tabs, a category filter and a table.
**Numbers/cards:** `Total Inventory Value` **AED 72,670** · `Total Units/Seats` **5,045** ·
`Low / Out of Stock` **3** · `SKUs Tracked` **9**.
**Chart:** `Inventory Value by Category` (Total: AED 72,670) across Software · Hardware · CloudServices ·
Print Media · Credits.
**Controls:** `Export` (**not clicked**) · **`Add Item`** — **this button does nothing** (see Odd things) ·
search `Search items or SKU...` · category filter, **all 6:** `All` · `Software` · `Hardware` ·
`Cloud Services` · `Print Media` · `Credits`.
**Tabs (2):**
- **`Item Register`** (default) — columns `ITEM` · `CATEGORY` · `QTY` · `UNIT COST` · `SALE PRICE` ·
  `TOTAL VALUE` · `STATUS`. The item cell carries the SKU under the name; the sale-price cell prints the
  margin (`50% margin`); status is `In Stock` / `Low Stock` / `Out of Stock`. All 9 SKUs:
  Adobe CC Seat License (ADO-CC-001, 12 seats) · Figma Professional Seat (FIG-PRO-001, 8) ·
  Shopify Partner Credits (SHP-CRED-001, 5000 credits) · MacBook Pro M3 Demo Unit (APL-MBP-M3, 2) ·
  Wacom Cintiq 16 Tablet (WAC-CTQ-16, **0 — Out of Stock**) · AWS Reserved Compute 1yr (AWS-EC2-RSV, 3) ·
  Vercel Pro Team Plan (VCL-PRO-TM, 1) · Printed Branding Kits (BRD-KIT-001, 15 — Low Stock) ·
  A0 Display Boards (DISP-A0-001, 4 — Low Stock).
- **`Stock Movements`** — columns `DATE` · `ITEM` · `REFERENCE` · `TYPE` · `QTY` · `BALANCE`. Type is
  `Issued` or `Received`; the reference names why, e.g. `CLIENT: Al Futtaim Group`,
  `PURCHASE: AWS invoice`, `DISPOSED: Damaged unit`. Signed quantities (`-2`, `+10`) and the running
  balance after the move.

### 6.6 Payroll (Finance view) — `/finance/payroll`
**Where:** Finance ▸ Operations ▸ PAYROLL. **Not the same screen as HR ▸ Payroll.**
**What you see:** H1 `Payroll` — “August 2026 · 23 employees · mirrors HR payroll”, a red badge
**`22 pending approval`**, the entity switch, the date range, `Export`, and a **`Manage in HR Payroll`**
link to `/hr/payroll` — this screen is the read-only mirror.
**Numbers/cards:** `Total Gross Payroll` **AED 10,232,222** · `Processed` **1** ·
`Pending Approval` **22** · `Avg. Salary` **AED 444,879**.
**Charts:** `Payroll Trend` (“Recent pay runs” — Dec 2025, Jan 2026, July 2026, August 2026) and
`By Role` (August split: Employee AED 10,000,234 · Software Engineer 82,188 · HR Specialist 78,667 ·
Marketing Manager 71,133).
**Controls:** search `Search employees...`.
**Table columns (9):** `EMPLOYEE` · `ROLE` · `BASE` · `ALLOWANCE` · `BONUS / REIMB.` · `DEDUCTION` ·
`NET PAY` · `STATUS` · `ACTIONS`. Status is `Pending` or `Processed`. 23 rows, footer row
`Total Gross Payroll – August 2026  AED 10,232,222`. Each row links to the per-employee pay run (§6.20).

### 6.7 Payment Reconciliation — `/finance/reconciliation`
**Where:** Finance ▸ Operations ▸ RECONCILIATION.
**What you see:** H1 `Payment Reconciliation` — “Match Wio Bank transactions to system records”, with
`Last synced: 2 hours ago`. Then a progress panel and **two facing columns** — the bank on the left, the
product's own records on the right — and a summary.
**Numbers:** `Reconciliation Progress` — “May 2026 · Wio Business Account”, **0/9 transactions confirmed**,
`6 auto-matched · 0 manual`, `3 unmatched`.
**Left — `Wio Bank Feed`** (“9 transactions this period”): each row has a direction arrow (↑ in / ↓ out),
a description (`INCOMING: Al Futtaim Group`, `PAYMENT: AWS Cloud Services`, `PAYROLL Batch May-26`, …),
its bank reference (`WIO-TXN-9981`), the date, the signed amount, and **a match confidence** — `96%`,
`100%`, `88%` or the word **`Unmatched`**.
**Right — `System Records`** (“Invoices, bills & payroll entries”): typed badges **`INV`**, **`BILL`**,
**`PAY`**, the document reference (`INV-0091`, `BILL-0041`, `PAY-0526`), date, amount, and a state of
`Matched ✓` or `Pending`.
**`Match Summary`:** `9` Total Bank Entries · `6` Auto-Matched · `0` Manually Linked · `0` Confirmed.
**Controls:** **`Confirm All Matches`** (**not clicked**), plus two per-row icon buttons — a
**tick** (confirm this match) and a **broken-link** icon (unlink). Both left alone.
**Odd:** amounts deliberately differ across the two columns on the unmatched rows (bank AED 19,687 vs
invoice AED 18,750; bank 36,750 vs 35,000) — that is the point of the screen.

### 6.8 Wio Bank Integration — `/finance/banking`
**Where:** Finance ▸ Operations ▸ WIO BANKING.
**What you see:** H1 `Wio Bank Integration` — “Connected · 3 accounts synced · UAE Central Bank Regulated”,
a green `All Accounts Connected` state and a **`Sync Now`** button (**not clicked**).
**Four feature cards:** `Instant Payments` (“Real-time AED transfers via AANI”) · `Bank-level Security`
(“256-bit encryption, 2FA enforced”) · `Auto Reconciliation` (“Transactions synced every 2h”) ·
`ERP Integration` (“Mapped to Finance module”).
**Numbers:** `TOTAL PORTFOLIO BALANCE` **AED 579,810** (`+AED 17,450 vs yesterday`). Three account cards,
each `Live`, with a masked number, type, balance, available balance, today's movement and “Synced 2 hours
ago”: **Wio Business Main** AE••••••••••7823 Current Account **AED 342,810** (available 338,200) ·
**Wio Payroll Account** AE••••••••••4412 Business Payroll **AED 52,000** ·
**Wio Business Savings** AE••••••••••9901 Savings Account **AED 185,000**.
**Chart:** `Balance Trend – All Accounts` (May 2026) with three series — Main / Payroll / Savings.
**`Recent Bank Transactions`** (“Across all Wio accounts”) — columns `TRANSACTION ID` · `DESCRIPTION` ·
`ACCOUNT` · `CATEGORY` · `DATE` · `AMOUNT`. Categories seen: `Invoice Payment`, `SaaS`,
`Internal Transfer`, `Payroll`. A **`Statement`** button and a **`+ Show 3 more transactions`** expander
(6 of 9 shown initially).
**`Wio Integration Settings`:** `API Connection` = “Connected – Wio Business API v2.1” ·
**`Sync Frequency`** dropdown, **all 4 options:** `Every 2 hours (recommended)` (default) ·
`Every 6 hours` · `Daily` · `Real-time (premium)` · `Auto-Reconciliation` = “Auto-match transactions” ·
`Notification Alerts` = “Large transaction alerts (> AED 50k)”.

### 6.9 VAT Filing — `/finance/vat`
**Where:** Finance ▸ Reports & Tax ▸ VAT FILING.
**What you see:** H1 `VAT Filing` — “UAE FTA compliance · 5% standard rate · Quarterly returns”, a badge
`FTA Registered · TRN-100485921400003`, and **`Export VAT Return`** (**not clicked**).
**Tabs (2):** `Current Period` (default) · `Filing History`.
**Current Period:** `CURRENT FILING PERIOD` **Q2 2026 (Apr–Jun)** — `Due: 2026-07-28 · -41 days remaining`,
state **`In Progress`**. Three tiles: `Output VAT (Sales)` **AED 15,290** (5% on taxable supplies) ·
`Input VAT (Purchases)` **AED 4,960** (5% on business expenses) · `Net VAT Payable` **AED 10,330**
(payable to FTA). A bar chart `Monthly VAT Breakdown – Q2 2026` (output vs input, Apr/May/Jun). Then two
itemised lists: **`Output VAT`** (“6 taxable sales · AED 15,290”, tagged **`Box 1`**) listing each invoice
with its net and its VAT, and **`Input VAT (Reclaimable)`** (“5 business expenses · AED 4,960”, tagged
**`Box 9`**) listing each expense with a negative VAT figure. Footer restates the sum:
“Output VAT – Input VAT = AED 15,290 – AED 4,960 → **AED 10,330**, Due by 2026-07-28”.
**Filing History:** table `PERIOD` · `DUE DATE` · `OUTPUT VAT` · `INPUT VAT` · `NET PAYABLE` · `STATUS` ·
`ACTIONS`. Three rows, all **`Filed`**: Q1 2026 (Jan–Mar) 18,450 / 6,200 / 12,250 ·
Q4 2025 15,800 / 5,400 / 10,400 · Q3 2025 12,300 / 4,100 / 8,200.

### 6.10 TDS Credits — `/finance/tds`
**Where:** Finance ▸ Reports & Tax ▸ TDS CREDITS.
**What you see:** H1 `TDS Credits` — “Tax withheld at source by clients · claim back at year end ·
reconcile against Form 26AS”. Controls: **`Refresh`**, **`Export ledger`** (disabled), and one empty
dropdown. The body reads **“TDS records are visible to admins only.”**
**Not reachable for this login** (its data request answers 403).

### 6.11 Corporate Tax Filing — `/finance/corporate-tax`
**Where:** Finance ▸ Reports & Tax ▸ CORPORATE TAX.
**What you see:** H1 `Corporate Tax Filing` — “UAE CT Law · 9% above AED 375k · FY 2026”, badge
`CT Registered`, and **`Export CT Computation`** (**not clicked**).
**`FILING TIMELINE – FY 2026`** — four numbered steps: `1 Financial Year End` Dec 31, 2026 ·
`CT Registration` **Registered – TRN-CT-100485921** (shown as done) · `3 Prepare & Submit CT Return`
Sep 30, 2027 · `4 Tax Payment Due` Sep 30, 2027.
**Numbers:** `Total Revenue` **AED 1,205,400** · `Adjusted Taxable Income` **AED 501,400** ·
`Estimated CT Payable` **AED 11,376** · `Effective Tax Rate` **2.27%**.
**Tabs (3):**
- **`Tax Computation`** (default) — the full worked calculation, line by line:
  Accounting Profit AED 526,200 → Add: Non-deductible expenses 24,800 → Less: Tax depreciation allowance
  (3,200) → Less: Exempt income 0 → Less: Prior year losses c/f 0 → **= Taxable Income 501,400** →
  Zero-rate band (0% on first AED 375,000) (375,000) → Taxable Income above threshold 126,400 →
  **CT @ 9% = 11,376** → Less: Qualifying Free Zone relief 0 → **= UAE CT Payable AED 11,376**.
- **`Quarterly Provisions`** — a bar chart plus table `QUARTER` · `TAXABLE INCOME` · `PROVISION` ·
  `CUMULATIVE`: Q1 2026 115,000 / 0 / 0 · Q2 2026 138,000 / 0 / 0 · Q3 2026 (est.) 128,000 / 11,520 /
  11,520 · Q4 2026 (est.) 120,000 / 10,800 / 22,320.
- **`Disallowances`** — “Items added back to accounting profit under UAE CT law”, table `ITEM` · `REASON` ·
  `AMOUNT`: Client entertainment (50% deductible cap exceeded) 8,400 · Non-business meal expenses
  (Personal nature) 3,200 · Penalties & fines (Non-deductible per CT law) 1,200 · Depreciation
  (accounting) (Add back accounting dep.) 8,800 · Tax depreciation allowance (Capital allowances per CT
  rules) 3,200 · **Total Disallowances AED 24,800**.

### 6.12 Fixed Assets — `/finance/fixed-assets`
**Where:** Finance ▸ Reports & Tax ▸ FIXED ASSETS.
**What you see:** H1 `Fixed Assets` — “Asset register · Straight-line depreciation · 9 active assets”.
**Numbers:** `Total Asset Cost` **AED 251,300** · `Accumulated Depreciation` **AED 108,374** ·
`Net Book Value` **AED 142,926** · `Monthly Dep. Charge` **AED 4,001`**.
**Chart:** `Monthly Depreciation Charge – 2026` — “Straight-line method · AED 4,001 / month”, Jan–Jun.
**Controls:** `Export Register` (**not clicked**) · **`Add Asset`** — **does nothing** (see Odd things) ·
category filter, **all 6:** `All` · `IT Equipment` · `Software` · `Furniture` · `Vehicles` · `Equipment`.
**Table columns (8):** `ASSET` · `CATEGORY` · `PURCHASE DATE` · `COST` · `ACC. DEP.` ·
`NET BOOK VALUE` · `LIFE` · `ACTIONS`. The asset cell carries `FA-00N · <location>` under the name.
All 9: MacBook Pro 16" M3 Max ×4 (FA-001, JLT Office, 32,000, 5y) · Dell 4K Monitors ×8 (FA-002, 12,800,
5y) · Adobe Creative Cloud Annual (FA-003, Cloud, 18,000, 3y) · Figma Organization Plan (FA-004, Cloud,
8,400, 3y) · Office Furniture JLT Suite (FA-005, 45,000, 10y) · Server Rack + NAS Storage (FA-006,
Server Room, 22,000, 7y) · Epson Large Format Printer (FA-007, 8,500, 7y) · Toyota Camry Company Car
(FA-008, Dubai, 95,000, 5y) · iPad Pro 12.9" ×3 (FA-009, Field, 9,600, 4y).
**Row actions (2):** an **eye** and a **pencil**.
- The **eye** opens a small read-only card: asset name, `Asset ID`, `Category`, `Location`,
  `Purchase Date`, `Original Cost`, `Useful Life`, `Accumulated Dep.`, `Net Book Value`,
  `Monthly Dep.` (e.g. FA-001 → AED 533/month).
- The **pencil** does **nothing** (see Odd things).

### 6.13 Finance Inbox / AI Bookkeeper — `/finance/ai-assistant`
**Where:** Finance ▸ AI & Tools ▸ AI BOOKKEEPER. (Its sibling, `FINANCE INBOX` → `/finance/inbox`, is N8's.)
**What you see:** H1 `AI Bookkeeper` with a **`Beta`** badge — “Reads your live Nexeor finance data · UAE
tax-aware”, and a green `Connected to live data` strip showing the figures it is reading:
`Bank: AED 342,810` · `Receivables: AED 184,750` · `Payables: AED 67,300` · `VAT Due: Jul 28` ·
`Sync: 2h ago`.
**The chat opens with:** “Hi! I'm your AI Bookkeeper for Nexeor Agency OS. I have access to your live
financial data including invoices, payroll, bank balances, VAT position, and cash flow. What would you
like to explore today?”
**Six suggested questions (all of them):** `Summarise this month's finances` ·
`Which expenses are deductible for CT?` · `Draft payroll journal entries for May` ·
`What's our 30-day cash flow forecast?` · `Which invoices are overdue?` · `What's our VAT liability for Q2?`
**Five quick chips (all of them):** `Monthly summary` · `Overdue invoices` · `VAT position` ·
`Cash forecast` · `CT deductibles`
**Controls:** message box `Ask anything about your finances…`, a **send** button (disabled while empty),
a **`Clear chat`** icon, and a back link to `/finance`.
**Footer warning:** “AI responses are generated from your live finance data. Always verify before
submitting official filings.”
**Nothing was asked** — no message was sent.

### 6.14 Master Calendar — `/hr/attendance/calendar`
**Where:** HR ▸ Attendance ▸ MASTER CALENDAR. All three Attendance screens carry a top strip
`ATTENDANCE MANAGEMENT SYSTEM` and an **`Open Public Portal`** link to `/attendance` (§5.1).
**What you see:** H1 `Master Calendar` — “Unified view of all company holidays, leave requests, and daily
presences.” A **legend of four states: `Leave` · `Pending` · `Holiday` · `Unpaid`**, an employee filter, a
month grid, and a detail panel.
**Employee filter:** dropdown, **32 options** — `All Employees` (default) then Amal Vijayakumar, Ganesh S N,
Gokulakrishnan R, Kartik Kittad, Kingson Thomas, Megha M, Mock Employee 10, Mock Employee 9,
Mock Employee 3, Mock Employee 1, Mock Employee 2, Mock Employee 4, Mock Employee 5, Mock Employee 7,
Mock Employee 8, work6, Navaneeth B, Rohit Vinod, Syeda Umme Kulsum, Test Demo, Chris george,
Swathikrishna U S, test er, test, Mock Employee S, MEGHA M, Megha M, chris g, leya xyz, Mock employee U,
John Doe.
**Calendar:** month title (`September 2026`), `‹`/`›` month steppers, a **`Today`** button, week starting
`SUN`, and the standard leading/trailing greyed days.
**Detail panel:** `Select Date Coordinate` — “Click any day on the Master Calendar to inspect isolated
daily metrics gracefully.” (this is the **empty state**).

### 6.15 Company Holidays — `/hr/attendance/holidays`
**Where:** HR ▸ Attendance ▸ COMPANY HOLIDAYS.
**What you see:** H1 `Company Holidays` — “Register recognized public days and aggregate assigned
workers.” A left list of holidays, a right panel for opt-ins, and an add form.
**Controls:** **`Delete All`** (**not clicked**) · **`Upload`** (bulk import — **not clicked**) ·
the inline add form: `Holiday Name (e.g. Thanksgiving)` (text) + a date box + **`Add`**.
**The list — all 14 live rows,** each numbered, with the weekday+date and an opt-in count:
1 New Year (Thu, Jan 1) 8 Opt-Ins · 2 Eid Al Fitr (Fri, Mar 20) 9 · 3 Labor Day (Fri, May 1) 7 ·
4–13 `Test Holiday 1`…`Test Holiday 10` (Sat Jun 6 → Mon Jun 15) 1 each ·
14 National Day (Wed, Dec 2) 12. Each row has **`Edit`**.
**`Edit`** switches the form into update mode — the two buttons become **`Cancel`** and **`Update`**
(**not clicked**).
**Right panel empty state:** `Select a Holiday` — “Click a holiday from the left to configure explicit
employee opt-in mappings.”
**Clicking a holiday opens the mapping** (opened on `National Day`), and it reveals the rule this screen
actually implements — **the company holidays are FLEXIBLE, not fixed.** The panel reads:
**“Select employees who opted to execute 1 of their 13 available flexible dates on this holiday.”**
(13 is the `Total Global Holidays / Year` set in Settings ▸ Configuration ▸ HR & Operations, §3.2.)
Below it, one tick-box per employee, each labelled with the person's name **and their employee code** —
`Amal Vijayakumar [EMP-R35ITN]`, `Ganesh S N [EMP-RFY3RP]`, `Gokulakrishnan R [EMP-MPCGJOYJ]`,
`Kartik Kittad [EMP-W4C4XO]`, `Kingson Thomas [EMP-JBIX92]`, `Megha M [EMP-F6RBVN]`,
`Mock Employee 1…10 [EMP1001…EMP1010]`, `work6 [EMP1006]`, `Navaneeth B [EMP-LH6ZU8]`,
`Rohit Vinod [EMP-MP574EOJ]`, `Syeda Umme Kulsum [EMP-A7NYMO]`, `Test Demo [EMP-DEMO-02]`,
`Chris george [EMP-ROT6A7]`, `Swathikrishna U S [EMP-0CLL5U]`, `test er [EMP-C5TQ3M]`, `test [EMP-EJY24V]`.
That is what the `N Opt-Ins` count on each holiday row is counting. **Nothing was ticked.**

### 6.16 Mark Absence Override — `/hr/attendance/mark`
**Where:** HR ▸ Attendance ▸ MARK ATTENDANCE.
**What you see:** H1 `Mark Absence Override` — “Officially submit or force-inject approved leaves directly
into the centralized Agency dashboard securely.” **The same four-step form as the public portal** (§5.1),
with step 1 relabelled: `1. SELECT EMPLOYEE PROFILE` (type-ahead `Type to search name...`) ·
`2. LEAVE MODALITY` (`Annual Leave / PTO` default · `Sick Leave` · `Unpaid Leave`) ·
`3. DURATION TYPE` (`Single Day Leave` · `Multiple Days` default · `Half Day Leave`) with `FIRST DAY` /
`LAST DAY` · `4. MANDATORY REASON / NOTES`.
One button: **`Transmit Secure Request`** — **not clicked**.

### 6.17 Candidate Pipeline — `/hr/onboarding/pipeline`
**Where:** HR ▸ Recruiting ▸ CANDIDATE PIPELINE.
**What you see:** H1 `Candidate Pipeline` — “Review onboarding forms and publish official Offer Letters.”
A search box, a status filter, then one card per candidate.
**Search:** `Search candidates by name, email, or role...`
**Status filter — all 5 options:** `All Statuses` (default) · `Awaiting Portal Submit` ·
`Pending Verification` · `Offers Sent` · `Offers Accepted`.
**Each candidate card:** name, email, then four labelled facts — `Role`, `Job Type` (`FULL TIME` /
`INTERN`), `Department`, `Expected Start` — a state chip, and the actions.
**States seen on cards:** `Invited Form Sent` · `Needs Verification` · `Offer Sending`.
**Row actions:** **`Resend Email`** (only on `Invited Form Sent` cards — **not clicked**) ·
**`Review Profile & Offer`** (a link to the candidate page, §6.19) · a **`🗑` titled “Permanently Delete
Candidate”**.
**Live rows (7):** MEGHA M (Software Engineer, FULL TIME, Engineering, 7/20/2026, Invited Form Sent) ·
Megha M (same, Invited Form Sent) · John Doe (Marketing Manager, FULL TIME, 7/18/2026, Invited Form Sent) ·
chris g (Marketing Manager, INTERN, 7/17/2026, Needs Verification) · leya xyz (Software Engineer, INTERN,
7/10/2026, Needs Verification) · Mock employee U (Software Engineer, FULL TIME, 6/8/2026, Offer Sending) ·
Mock Employee S (Software Engineer, INTERN, 6/8/2026, Invited Form Sent).

### 6.18 Recruiting ▸ Open Positions — `/hr/onboarding?tab=positions`
**Where:** HR ▸ Recruiting ▸ OPEN POSITIONS (a tab of `/hr/onboarding`, reached as its own menu item).
**What you see:** H1 `Recruiting` — “Track candidates through your hiring pipeline”, with the page's two
tabs **`Board`** and **`Positions`**. On Positions: H2 `Open Positions` — “Manage job postings and track
performance”, a status filter and a table.
**Status filter — all 3:** `Active` (default) · `Paused` · `Completed`.
**Table columns (5):** `JOB TITLE` · `CANDIDATES` · `DATE POSTED` · `STATUS` · `LINK`. The title cell
carries the location and `· Department` beneath it; the candidates cell breaks down `All` / `New`.
Live row: `tester l2` (kochin · Engineering) · 0 all, 0 new · 1 months ago / Aug 4, 2026 · Active ·
a **`Copy application link`** icon.
**`New Position` dialog** — a slide-over titled by the fields below, all of them:

| Field | Type | Detail |
|---|---|---|
| `JOB TITLE *` | text | placeholder `e.g. Full Stack Developer` |
| `URL SLUG *` | text | placeholder `full-stack-developer`, prefixed on screen by **`/apply/`** — this is what builds the public job address (§5.3) |
| `DESCRIPTION` | textarea | |
| `DEPARTMENT` | dropdown | **all 4:** `Any` (default) · `Engineering` · `Human Resources` · `Marketing` |
| `LOCATION` | text | placeholder `e.g. Remote` |
| `TYPE` | dropdown | **all 4:** `Full Time` (default) · `Part Time` · `Internship` · `Contract` |
| `CURRENCY` | dropdown | **all 5:** `AED (د.إ)` (default) · `INR (₹)` · `USD ($)` · `EUR (€)` · `GBP (£)` |
| `SALARY RANGE` | text | placeholder `e.g. 15,000 - 25,000` |

Buttons: **`Cancel`** · **`Create Position`** (**not clicked**).

### 6.19 Candidate review & offer — `/hr/onboarding/<candidateId>`
**Where:** HR ▸ Recruiting ▸ CANDIDATE PIPELINE → **`Review Profile & Offer`** on any card.
**What you see:** a `Back to Pipeline` link, the candidate's name, email and raw `ID:`, then seven
read-only sections. Everything not yet supplied prints **`—`** or a sentence saying so, which makes this
also the screen's empty state.
**Sections and their fields:**
- **`Proposed Role`** — `DESIGNATION` (+ a `FULL TIME`/`INTERN` chip) · `DEPARTMENT` ·
  `MONTHLY COMPENSATION` (e.g. `5,000 AED`) · `JOINING DATE` · `INTERNSHIP DURATION` (e.g. `6 Months`) ·
  `REPORTING TO` (a named person).
- **`Bank Details`** — “Not provided yet.”
- **`Personal Information`** — `BLOOD GROUP` · `DATE OF BIRTH` · `CONTACT` · `EMERGENCY` ·
  `MARITAL STATUS`.
- **`Addresses`** — `CURRENT ADDRESS` · `PERMANENT ADDRESS`.
- **`Offer Notes & Special Conditions`** — with an **`Edit Notes`** button; empty state “No special
  conditions attached.”
- **`Academics & Employment`** — `HIGHEST DEGREE` · `PREVIOUS EMPLOYMENT HISTORY` (empty state
  “Fresh Graduate / No history attached.”).
- **`Uploaded Documents`** — six named slots, each `Not uploaded` until supplied: `Photo ID` ·
  `Govt ID Proof` · `PAN / Tax ID` · `Resume` · `Payslips` · `Relieving Letter`.
**Controls:** an **`Edit Candidate Profile`** pencil, and `Edit Notes`. Neither saved.

### 6.20 Payroll run detail — `/hr/payroll/<runId>`
**Where:** Finance ▸ Operations ▸ PAYROLL → any employee row; also under HR ▸ Payroll.
**What you see:** H1 **`Payroll Run: August 2026`** — `CYCLE: JUL 5 – AUG 5, 2026 · CREATED 8/13/2026`,
and a progress figure **`4% Completed`**. Then one card per employee.
**Each employee card:** initial avatar · name · role · `BASE` · `NET` · **an INR conversion of the net**
(`≈ INR 870,414`) · the bank the money goes to (bank name + account number, and `IFSC` where the account
is Indian) · and the action.
**Row action:** **`Register Pay`** where unpaid — **not clicked, this is a payment step**. Where already
done the card shows **`Paid`** plus a reference note.
**Banks seen across the run:** SBI (IFSC SBIN0004321) · RAK BANK · DUBAI ISLAMIC BANK ·
ICICI BANK (ICIC0001567) · ADCB · EMIRATES NBD · AXIS BANK (UTIB0002345) · FAB · ADIB. One employee
(Kartik Kittad) is paid in INR with no bank on file.
**Paging:** a page-size dropdown — **all 4:** `10 / page` (default) · `25 / page` · `50 / page` ·
`100 / page` — with `23 results`, `Page 1 / 3`, and `Previous` (disabled on page 1) / `Next`.
**Controls:** a **`Refresh salary & deductions`** icon (**not clicked**), and a back link to `/hr/payroll`.

### 6.21 Marketing client workspace — `/marketing/clients/<clientId>`
**Where:** Marketing ▸ Clients ▸ *(client name)* in the sidebar, or the Clients directory.
**What you see:** `Back to Directory`, then the client header — initial tile, **`Velocity Fitness`**, the
industry (`Health & Wellness`), a `Website` link out to the client's own site, and a **shareable link**
shown truncated (`.../share/cmnyxt...`) with three icon buttons: **`Copy Link`**, **`Preview`** and
**`Regenerate`** (regenerate **not clicked** — it would invalidate the link the client is using).
**Controls:** **`New Project`**, and two tabs: **`Active Projects (1)`** and **`Master Assets (0)`**.
**Active Projects:** one card — `Q2 Digital Retainer`, “No description”, chip **`ACTIVE`**,
`Updated 6/29/2026`, and **four deep links into the project**: `Full Workspace` · `Plan & Tasks (28)` ·
`Calendar (15)` · `Campaigns` · `Ad Metrics` (the counts are live).
**Right column:** `ACCOUNT DETAILS` (`Industry`, `Account Owner` — `—` here) · `AGENCY STATS`
(`1 Projects`, `0 Active Campaigns`) · `INTEGRATIONS` (`Slack Notifications` — `1 Active Channels`, with
an **`Edit Integrations`** pencil).
**`DANGER ZONE`:** “Permanently delete this workspace, including all of its projects, tasks, and uploaded
vault assets. This action is irreversible.” → **`Delete Client`** (**not clicked**).
**`Master Assets` tab (opened):** H3 `ROOT ASSETS` with a `Vault Root` breadcrumb and three controls —
**`New Folder`**, **`Add Link`** and a file-upload input. This is the agency side of the same vault the
client can see and push links into from their portal (§5.4).
**Empty state:** the tab reads `Master Assets (0)` and the vault is empty.

### 6.22 Marketing project workspace — `/marketing/projects/<projectId>` (4 tabs)
**Where:** Marketing ▸ Clients ▸ client ▸ project, or the four deep links above.
**Header on every tab:** project name `Q2 Digital Retainer`, chip `ACTIVE`, the client name as a link back,
a **`Delete Project`** icon (**not clicked**), and four create buttons — **`Log Spend`**, **`New Post`**,
**`New Task`**, **`New Idea`**.
**Tabs (4):** `Plan & Tasks` · `Content Calendar` · `Campaigns` · `Ad Performance`.

**Tab 1 — `Plan & Tasks` (`?tab=tasks`)** — H3 `Workspace Board`, a kanban.
Filters: search `Search tasks...`; `All Assignees` dropdown (this project's people: Amal Vijayakumar,
Navaneeth B, Syeda Umme Kulsum, Kartik Kittad); `All Campaigns` (Phase 1 / Phase 2 / Phase 3 Awareness
Surge); `All Priorities` — **all 5:** `All Priorities` · `P0 Urgent` · `P1 High` · `P2 Medium` · `P3 Low`.
A **`Sort`** popover: `SORT BY` — **all 4:** `🕐 Last Updated` · `🔴 Deadline` · `📅 Publish Date` ·
`⚡ Priority`; `DIRECTION` — `Newest First DESC`.
Columns seen with counts: `BACKLOG` 4 · `TO DO` 13 · and further columns beyond. Each card shows a state
chip (`REVISION REQUESTED`, `TODO`, `CHANGES REQUESTED`…), the title, an assignee initial, a priority chip
(`P2` / `Medium Priority`), the description, and two dates labelled `Internal Due Date` and `Publish Date`.
A per-column **`Select All in Column`** tick button.

**Tab 2 — `Content Calendar` (`?tab=calendar`)** — H3 `SOCIAL CALENDAR`.
Controls: **`Import Calendar`** (**not clicked — it writes**) · **`Add Post`** · a date-basis switch
(`Publish Date` / `Internal Due`) · a view switch (`Month` / `Week`) · `‹`/`›` steppers.
A month grid with post chips coloured by state, and beside it a **phone mock-up preview** of the feed
(`9:41`, `Brand_Account`, `38 Posts`, `4.5k Followers`).
Below, `Content Pipeline` — table `PLATFORM` · `POST TITLE` · `STATUS` · `PUBLISH DATE` · `INTERNAL DUE` ·
`ASSIGNEE`. Statuses seen: `PUBLISHED`, `CHANGES REQUESTED`, `APPROVED`, `SCHEDULED`, `DESIGN`,
`DRAFTING`, `REVIEW`, `DONE`, `IN PROGRESS`, `TODO`. The platform cell reads **`MISSING PLATFORMS`** on
every row here (see Odd things).

**Tab 3 — `Campaigns` (`?tab=campaigns`)** — H3 `MARKETING CAMPAIGNS`, **`New Campaign`**, then one card
per campaign showing the name, the strapline, a start date, and `SPEND` vs `BUDGET`:
Phase 1 Awareness Surge (AED 0 / **AED 17,786**) · Phase 2 (0 / **14,210**) · Phase 3 (0 / **5,271**),
all “High volume brand awareness and click-throughs · 4/1/2026”.

**Tab 4 — `Ad Performance` (`?tab=ads`)** — H3 `AD SPEND LOG`, **`Log Daily Spend`**, and a table
`DATE` · `PLATFORM` · `SPEND` · `CLICKS` · `ROAS`. **Empty state: “No ads logged yet.”**

**The four create dialogs (opened, read, cancelled — nothing created):**

| Dialog | Fields, in order | Buttons |
|---|---|---|
| **`Create New Task`** | `TITLE / HEADLINE *` [e.g. Design Winter Banner] · `DESCRIPTION / NOTES` · `PRIORITY` — **all 4:** P3 - Low / **P2 - Medium** (default) / P1 - High / P0 - Urgent · `STATUS` — **all 4:** **Backlog** (default) / To Do / Internal Review / Client Approval · `ASSIGNEE` — **all 27:** Unassigned (default) + the full staff list · `INTERNAL DUE` (date, pre-filled today) · `TARGET DATE` (date) · `LINK TO CAMPAIGN (OPTIONAL)` — **all 4:** Standalone Post (No Campaign) (default) / Phase 1 / Phase 2 / Phase 3 | `Cancel` · `Create` |
| **`Create Social Post`** | `POST TITLE *` [e.g. Winter Collection Teaser] · `PLATFORM` — **all 6:** **Instagram** (default) / LinkedIn / TikTok / Facebook / YouTube / Twitter · `POST TYPE` — **all 5:** **Reel / Short Video** (default) / Story / Carousel / Static Image / Article / Text · `CAPTION & INSTRUCTIONS` [Write the caption or leave notes for the designer...] · `GO-LIVE PUBLISH DATE` (today) · `INTERNAL DUE DATE` (today) · `ASSIGN TO` — the same 27 · `INITIAL STATUS` — **all 3:** Backlog / **To Do (Ready)** (default) / In Progress · `UPLOAD REFERENCE MEDIA` (“Drop inspiration, raw assets, or brand guidelines”) · `LINK TO CAMPAIGN (OPTIONAL)` — the same 4 | `Cancel` · `Create` |
| **`Create campaign`** | `CAMPAIGN NAME *` [e.g. Summer Sale 2026] · `TOTAL BUDGET (AED)` [10000] · under a **`STRATEGIC BRIEF`** heading: `OBJECTIVE` — **all 5:** Select Objective… (default) / Lead Generation / Brand Awareness / Sales / Conversions / Event Promotion · `TARGET AUDIENCE` [e.g. UAE Expats 25-40] · `KEY MESSAGE / VALUE PROPOSITION` [What is the single most important thing they need to know?] · `FLIGHT START DATE` · `FLIGHT END DATE` | `Cancel` · `Create` |
| **`Create ad log`** | `DATE *` · `SPEND (AED)` [0.00] · `CLICKS` [0] · `LINK TO CAMPAIGN (OPTIONAL)` — the same 4 | `Cancel` · `Create` |

**`New Idea` is not a dialog** — it navigates to `/marketing/ideas?projectId=<id>`, the
**Marketing Ideas Repository** filtered to this project (`Filters 1`, a `Kanban`/`Grid` view switch, a
`Reset all`, and four columns `BACKLOG` / `REVIEW` / `IMPLEMENTED` / `DISCARDED`, each “No ideas yet”).

### Odd things I noticed
- **Three buttons do nothing at all.** Verified twice each, with the page's HTML measured before and
  after the click (zero change, no dialog, no navigation): **`Add Item`** on Inventory, **`Add Asset`** on
  Fixed Assets, and the **pencil/edit** icon on a Fixed Assets row. The eye icon on the same row works.
- **Payables and Approvals show the bare word `Unauthorized`** where their content should be, under a
  fully drawn toolbar. Other restricted screens in this product explain themselves politely
  (“visible to administrators only”); these two do not.
- **`/finance/payroll` shows a AED 10,232,222 total** driven by one row — Navaneeth B, with a
  `BONUS / REIMB.` of AED 10,000,234 against a base of 0. It also drags `Avg. Salary` to AED 444,879.
  Almost certainly test data, but it is the headline number on a finance screen.
- **Every row of the content pipeline reads `MISSING PLATFORMS`** in the platform column, while the
  create-post dialog offers six platforms — the existing posts appear to have been created without one.
- The Master Calendar's employee list has **visible duplicates and casing variants** —
  `Megha M`, `MEGHA M` and `Megha M` again, plus `test`, `test er`, `chris g`.
- VAT says `-41 days remaining` for a period due 2026-07-28 — a negative countdown rather than “overdue”.
- Company Holidays carries **ten rows literally named `Test Holiday 1`–`10`** in the live list.
- Some screens name a bank integration as fact — “Connected · 3 accounts synced”, “Last synced: 2 hours
  ago” — while the Finance Overview says the bank balance “still needs a bank feed”. The two disagree.

---

## Routes nobody was assigned — now captured in §5–§6

These addresses exist and were **not** in any N1–N10 scope as the brief wrote it. Rather than leave them
as a question, they are captured in full above. **26 screens in total:**

**Finance (13)** — `/finance/receivables` §6.1 · `/finance/payables` §6.2 · `/finance/client-ledgers` §6.3 ·
`/finance/approvals` §6.4 · `/finance/inventory` §6.5 · `/finance/payroll` §6.6 ·
`/finance/reconciliation` §6.7 · `/finance/banking` §6.8 · `/finance/vat` §6.9 · `/finance/tds` §6.10 ·
`/finance/corporate-tax` §6.11 · `/finance/fixed-assets` §6.12 · `/finance/ai-assistant` §6.13

**HR (6)** — `/hr/attendance/calendar` §6.14 · `/hr/attendance/holidays` §6.15 · `/hr/attendance/mark` §6.16 ·
`/hr/onboarding/pipeline` §6.17 · `/hr/onboarding?tab=positions` §6.18 · `/hr/onboarding/<candidateId>` §6.19 ·
`/hr/payroll/<runId>` §6.20

**Marketing (2 shapes)** — `/marketing/clients/<clientId>` §6.21 ·
`/marketing/projects/<projectId>` with its four tabs `?tab=tasks|calendar|campaigns|ads` §6.22

**Web Projects (3)** — `/projects/capacity` · `/projects/clients` · `/projects/revenue` §3.5
(all three admin-only for this login)

**Settings (4) + 1 stub** — `/settings` §3.1 · `/settings/configuration` §3.2 · `/settings/teams` §3.3 ·
`/settings/email-logs` §3.4 · `/payroll` §3.6

**Public, no sign-in (4)** — `/attendance` §5.1 · `/apply` §5.2 · `/apply/<slug>` §5.3 ·
`/share/<token>` §5.4 (one per client)

**The full static route list for this product is therefore 46 sidebar addresses + 5 settings/stub +
4 public + 3 admin-only project screens + 2 per-record shapes.** The brief's figure of 28 counted only
the first two levels of the menu.


## In human language — every feature in this area, as points

- **One front door.** There is a single sign-in page and no way past it. Ask for any page inside the system
  while signed out and it quietly puts you back at the sign-in page. Nothing about the company's work is
  visible before you are in.
- **Staff sign in with their Google work account.** One white button, “Continue with Google”. Nobody has a
  separate password to remember or lose, and whoever runs the Google accounts controls who can get in.
- **A staging-only back door for demos.** A second button, clearly fenced off under the words “STAGING
  ONLY”, opens a username-and-password box so a demo or test account can get in without Google. It stays
  hidden until you click, and the button renames itself to “Access Demo Portal” so you know you have
  switched to the demo route. It is for the test copy of the system, not the real one.
- **You always land in the same place.** A successful sign-in drops you straight onto the sales pipeline
  board. No “where do you want to go” step, no setup wizard.
- **One black menu rail down the left, and that is the whole frame.** Everything else on any screen belongs
  to that screen. There is no top bar, no search box across the app, no notification bell, no photo of you
  in the corner, no menu with “my profile” in it, and no light/dark switch — the product is dark, always.
- **The menu is grouped by the part of the business you work in.** Two everyday items on their own at the
  top — your own personal portal and the shared task board — then five sections: Sales, Marketing, Web
  Projects, Finance and HR. Each section opens and closes with a click, and only the section you are
  currently in starts open, so the menu stays short.
- **Some menu items hide a further list behind a little arrow.** Finance in particular is four doors —
  Accounting, Operations, Reports & Tax, and AI & Tools — and each opens onto its own set of screens
  (cash book, receivables, payables, ledgers; invoices, approvals, inventory, payroll, reconciliation,
  banking; profitability, VAT, TDS, corporate tax, fixed assets; the finance inbox and an AI bookkeeper).
  HR does the same for Attendance and Recruiting. If you never click the little arrow you never learn those
  screens exist — worth knowing, because it is more than half the product.
- **The menu also grows a branch for your live clients.** Under Marketing ▸ Clients, each client appears by
  name, opens to show their live project, and the project offers two one-tap jumps: its task list or its
  content calendar. It means you can reach a specific client's work from anywhere without going through
  three screens.
- **The menu always tells you where you are.** The screen you are on is a highlighted blue strip, and its
  section stays lit even when closed, so you never lose your place.
- **You can shrink the menu to a thin strip of icons** to give a wide table or board more room, and widen it
  again with one click. It forgets you did that as soon as you move to another screen, so it is a
  per-screen convenience rather than a setting.
- **On a phone the menu becomes a slide-out drawer.** A small floating menu button sits in the top-left
  corner of every screen; tap it and the same full menu slides over the page, tap the ✕ and it slides away.
  Nothing in the system is out of reach on a phone.
- **Sign Out sits at the bottom of the menu, in red, on its own**, away from everything else, so it is hard
  to hit by accident.
- **Every screen is stamped with the company's name at the very bottom** — a thin “Powered by Nexeor,
  copyright 2026” line under the page.
- **What you can see is decided by your role, and it decides whole sections.** The system asks “who is this
  and what are they allowed?” on every screen, and simply does not draw the sections you are not allowed.
  Someone in the Developer Team sees only Web Projects; the Sales Team sees Sales, Finance and the task
  board. Nobody sees a locked door they cannot open — the door isn't drawn.
- **Roles are made and edited in one place: a “Teams & Access” screen.** You type a role name, tick which
  of the ten sections that role may see, and press Create. Existing roles show as cards you can edit or
  delete, each listing what it can see and how many people hold it.
- **There is a top level that is above all of this.** “System Admin” ignores the whole permission system and
  sees everything, and it cannot be deleted. Most of the company (24 of 27 people) currently holds it —
  which is worth a conversation, because it means the role system is barely being used.
- **The ten things a role can be given** are: the shared task board, Sales, Marketing, Web Projects, Paid
  Ads, Finance, HR, Payroll, Settings and Lighting Studio. Two of those — Paid Ads and Lighting Studio —
  are names reserved for parts of the product that do not exist yet.
- **Permissions are coarse, and this is the single most important thing to know about the product.** A role
  can only be given or denied a whole section. You cannot say “can see invoices but not create them”, “can
  see salaries but not change them”, or “can only see their own clients”. Every person allowed into Finance
  is allowed into all of Finance.
- **A staff directory with the people, their roles and their GitHub accounts.** One list of 27 people, each
  with their initial, name, email, the role they hold, and the developer account they have linked. From
  each row you can change someone's role, unlink their developer account, or permanently delete them.
- **Teams are shown as headcount tiles** — Super Admins 24, Developer Team 6, HR Department 4, Sales Team 3,
  Marketing Team 2, QA team 2 — so you can see the shape of the company at a glance.
- **New staff are invited by email from that same screen** (the invite button is switched off in the demo
  copy).
- **A settings area exists that ordinary staff cannot see at all.** It is real and it works — it just isn't
  drawn in the menu unless your role includes “Settings”. It holds four screens: the hub, the module
  configuration, teams & access, and the email log.
- **Each person can connect their own developer account.** Paste your GitHub token once and any issue,
  comment or edit you make from inside the system is filed under your name on GitHub instead of a shared
  robot account. Optional — everything works without it.
- **You can move a whole sales pipeline in from Notion.** Upload the CSV a Notion export gives you and it
  maps the deal value, the status, the services and the people automatically. There is also a bulk importer
  for loose Markdown files, for older records.
- **Outgoing email is branded per department.** Invoices go out as “Nexeor Sales”, offer letters as
  “Nexeor HR”, campaigns as “Nexeor Marketing”, and anything else falls back to a house default — each with
  its own sender name and address, plus one logo that appears at the top of every email the system sends.
  The screen also spells out the DNS records the domain needs so the mail actually arrives.
- **Email is sent through a professional mail service with an automatic fallback.** If the main route is
  unavailable it re-sends through a backup route rather than dropping the message.
- **A complete record of every email the system has ever sent.** 77 of them here — who it went to, what it
  said, which department sent it, which route carried it, and when. You can search it and narrow it by
  department, by outcome (sent / fell back / failed) and by date. This is how you answer “did the client
  ever actually receive that invoice?”.
- **HR alert recipients are chosen, not hard-coded.** Pick the staff who should be told when a candidate
  submits their onboarding or signs an offer — from the staff list, or by typing any outside email address.
- **The company's leave rules are numbers on a screen.** Paid leave per month, sick leave per month, how
  many sick days before a medical certificate is required, and how many public holidays the year has.
  Currently 2, 2, 2 and 13.
- **HR events can also be announced in Slack** — name a channel and switch on the two things worth
  announcing: a new person joining, and a new leave request.
- **The list of services you sell is editable, and renaming one is safe.** Website, Marketing, E-Commerce,
  Nexeor OX, Custom Dev, SEO, Mobile App, Digital Partnership, Branding, ERP and Other. You can add, reorder
  and rename them; renaming updates them everywhere without breaking the tags already on old deals, and
  “Other” cannot be deleted because it is the catch-all.
- **Invoice numbering has house defaults.** A prefix, a starting number and a default currency, used
  whenever an invoice doesn't have a series of its own — so numbering never restarts by accident.
- **Company bank accounts are stored once and offered when invoicing.** Two are set up (a UAE company and
  an Indian one, with full account, IFSC and SWIFT details), one is marked the default, and any invoice can
  print one or more of them for the client to pay into.
- **The business runs as two legal companies, and the system knows the difference.** A UAE entity and an
  Indian entity, each with its own legal name, registered address, tax registrations (GSTIN, CIN, PAN, TRN),
  tax label and rate, invoice number series, currencies and payment terms. Which entity bills a client
  follows the currency, and everything printed on an invoice comes from here rather than being typed each
  time.
- **Money approvals are routed by the kind of spend.** Six lanes — operations, sales & marketing, IT and
  internal spend, admin, HR & payroll, and a catch-all for anything unclassified — each with a named
  approver, plus a rule that anything above a set amount must go to one specific person, and a final
  accounts step that verifies and releases the payment. The thresholds are set per company in that
  company's own currency.
- **Certain screens are for administrators only and say so politely.** Team capacity and workload, the
  client dashboards, and the revenue figures each greet everyone else with a plain line explaining it is
  admin-only — not an error, and not a dead end.
- **A wrong web address shows a bare “404 — this page could not be found”** with no menu and no way back —
  the only screen in the whole product that doesn't look like the product.


### The other ways in — no password needed

- **Anyone can request leave without an account.** There is a second, completely separate page — a plain
  leave-request form. You find your own name in a list, say whether it is holiday, sick or unpaid leave,
  say whether it is one day, several days or a half day, pick the dates, type the reason, and send it. It
  needs no password, and staff reach it from a button at the top of the attendance screens. It is for the
  people who are never going to log into an office system.
- **The same leave form exists inside the system for HR.** Identical four steps, except HR picks the
  employee instead of themselves — that is how HR records leave on somebody's behalf, or corrects it.
- **There is a public careers page, and it looks like the company website, not the office system.** A
  “Join Our Team” page listing the open jobs, with filters for location, role type and department. Every
  job also has its own page with its own web address you can put in a LinkedIn post — and the page even
  shows you the tagged link so you can tell where applicants came from.
- **Applicants can apply by dropping in a CV and letting the computer read it.** “Easy Apply” takes a
  PDF or Word CV and fills the whole application in by itself. Anyone who would rather type has a link to
  the full form: name, email, phone, current job title, location, LinkedIn, portfolio, CV upload, a skills
  list, as many past jobs and qualifications as they want to add, and an optional covering letter.

### Getting the money in

- **A receivables screen that answers “who owes us, and how late are they?”** Total outstanding, how much
  of it is overdue, how much has been collected, and the invoice list behind it — filterable to just the
  overdue ones, searchable, and each row jumps to the invoice. It also shows how many days late each one
  is, right next to the due date.
- **Debt sorted by how old it is.** Money owed is split into current, 31–60 days, 61–90 days and over 90
  days, with both the amount and the number of invoices in each band — the standard way to spot the debt
  that is turning bad.
- **A payables screen for bills the agency owes** its suppliers, with a button to add a bill. Locked to
  administrators, so it could not be read on this login.
- **A running account per client, like a bank statement.** Pick a client from the list — each showing when
  they last transacted, how many transactions and how much is due — and see every invoice and every
  payment in date order with a running balance, a chart of that balance over time, and a filter to show
  only what was billed or only what was received. Clients who owe nothing are marked “Settled”.
- **Every money screen can be read as one business or as each company separately.** A three-way switch —
  everything together, the Indian company, or the UAE company — plus a date range, sits at the top of the
  receivables, payables, ledger and payroll screens.

### Getting the money out, and proving it

- **Spending has to be approved by the right person before it is paid.** A queue of expenditure waiting
  for approval, with the rule spelled out on screen: a leader approves first, one specific person must
  approve anything above a set amount, and only then does accounts verify it and release the payment.
  Administrators only, so the queue itself could not be read.
- **The bank feed and the books are matched side by side.** The bank's transactions on the left, the
  agency's own invoices, bills and payroll entries on the right, and the system's guess at which pairs
  belong together — shown as a confidence percentage, or the word “unmatched”. You can confirm a match,
  break a wrong one, or confirm everything at once. It also tracks how much of the month you have got
  through: nine transactions, six matched automatically, three still to sort out.
- **The business bank accounts are read live inside the system.** Three accounts — main, payroll and
  savings — with today's balance, the available balance, what has moved today, when they last synced, and
  a total across all three. Plus a chart of all three balances over the month and a list of recent
  transactions, each already sorted into a category like “invoice payment”, “software subscription” or
  “internal transfer”.
- **You choose how often the bank is checked** — every two hours, every six hours, once a day, or live —
  and whether large payments (over fifty thousand) raise an alert.

### Tax, done properly

- **Quarterly VAT is prepared for you, not by you.** The current quarter shows what VAT you charged, what
  VAT you can claim back, and what you owe, with the due date and a countdown. Underneath, every single
  sale and every single expense that makes up those two numbers is itemised — so if the tax office asks,
  the working is already on screen.
- **Past VAT returns are kept.** A history table of every quarter already filed, with what was charged,
  what was reclaimed, what was paid and its status.
- **Corporate tax is computed line by line.** Accounting profit, then each addition and deduction, the
  zero-rate band on the first AED 375,000, the 9% calculation and the final figure — presented as the
  computation an accountant would want to see, with the effective tax rate shown as a headline.
- **The system knows which expenses the tax office will not allow.** A list of items added back to profit
  — entertainment over the allowed half, personal meals, penalties and fines, accounting depreciation —
  each with the reason it is disallowed and the amount.
- **Tax is estimated quarter by quarter, not just at year end**, including forecasts for the quarters that
  have not happened yet, so the bill is never a surprise.
- **A filing calendar for the year** — financial year end, registration, the deadline to submit the
  return, and the deadline to pay — with the registration already ticked off.
- **Tax withheld by Indian clients is tracked so it can be claimed back.** Administrators only on this
  login.

### Things the agency owns

- **A register of software seats, hardware, cloud plans and printed material.** Every item with a stock
  code, how many you have, what it cost, what you sell it on for, the margin on it, and its total value —
  plus a warning list of what is low or out of stock, and a chart of value by category.
- **A movement history for stock.** Every time something was issued or received, when, how many, what the
  balance became, and why — which client it went to, which purchase it came from, or that it was thrown
  away damaged.
- **An asset register with depreciation worked out automatically.** Laptops, monitors, furniture, a
  company car, software licences: what each cost, where it is, how much value it has lost so far, what it
  is worth now, and how long it is expected to last — plus the monthly depreciation charge, both per asset
  and for the company as a whole.

### Paying people

- **A finance-side view of payroll that mirrors HR's.** The month, the headcount, the total wage bill, how
  many pay runs are still waiting for approval, the average salary, a trend across recent months, and a
  breakdown by job role — with a link across to HR to actually make changes.
- **Each pay run can be worked through person by person.** One card per employee showing base pay, net
  pay, the same amount converted into rupees, and the exact bank account and sort code the money is going
  to — with a “register pay” button per person and a running “percent completed” for the run. Ten, 25, 50
  or 100 people to a page.

### An assistant for the books

- **A chat assistant that has read the agency's real numbers.** It shows you what it can see — the bank
  balance, what is owed, what is owing, when VAT is due — and offers to answer things like “summarise this
  month”, “which invoices are overdue”, “what is our VAT liability”, “draft the payroll journal entries”
  or “what is our 30-day cash forecast”. It is labelled as beta and says plainly that you should verify
  anything before it goes to the tax office.

### Attendance and hiring

- **One calendar showing the whole company's time off.** Holidays, approved leave, leave still waiting for
  a decision and unpaid leave, all colour-coded, filterable down to one employee, with a click on any day
  to see what happened that day.
- **The company's public holidays are a list you own.** Fourteen are set up, each with the date and a
  count of how many staff it applies to; you can add one, edit one, or set which employees each holiday
  actually applies to — because not everyone gets the same days.
- **A candidate pipeline with a status for each person.** Waiting for the candidate to fill in their form,
  needing checking, offer sent, offer accepted. Each candidate card shows the role, the type of job, the
  department and the expected start date, with buttons to re-send their invitation email or open their
  file.
- **A full file per candidate before you hire them.** Proposed job title, department, monthly pay, start
  date, internship length, who they will report to, their bank details, personal and emergency contacts,
  both addresses, their qualifications and work history, notes and special conditions on the offer, and a
  checklist of six documents (photo ID, government ID, tax ID, CV, payslips, relieving letter) that shows
  what is still missing.
- **Job adverts are created inside the system and published to the web.** Title, the web address it will
  live at, description, department, location, type of contract, currency and a salary range — then the
  advert is live on the careers page and you can copy its link to post anywhere. Adverts can be active,
  paused or completed, and each shows how many people have applied.

### A client's own workspace

- **Each client gets a workspace page with a link you can share with them.** The client's industry, their
  website, agency stats, which chat channels they are wired into, and a shareable link you can copy,
  preview as they would see it, or regenerate if it has gone astray.
- **Deleting a client is deliberately walled off.** It sits in a red “danger zone” with the consequence
  spelled out — every project, task and uploaded file goes with it, and it cannot be undone.
- **Each project is one workspace with four views.** A task board, a content calendar, the campaigns, and
  the advertising spend — all under the same project, with four “create” buttons always in reach.
- **Tasks carry both an internal deadline and a client-facing publish date** — the thing agencies always
  need and most tools only give one of. Plus priority (urgent to low), an owner, a status from backlog
  through internal review to client approval, and an optional link to a campaign.
- **A content calendar that looks like the phone it will be posted from.** A month or week grid of planned
  posts, colour-coded by how far along they are, next to a mock-up of the social feed showing follower and
  post counts. You can switch whether the calendar arranges posts by their publish date or by the
  internal deadline.
- **Planning a social post is one form.** Title, platform (Instagram, LinkedIn, TikTok, Facebook, YouTube
  or Twitter), the kind of post (reel, story, carousel, static image or article), the caption or the brief
  for the designer, the go-live date, the internal deadline, who is doing it, its starting status, any
  reference material to upload, and which campaign it belongs to.
- **Campaigns hold a budget and a brief.** Name, total budget, the objective (leads, awareness, sales or
  an event), the target audience, the one key message, and the start and end dates — then the campaign
  card shows spend against budget as the money goes out.
- **Daily ad spend is logged by hand and tied back to a campaign** — date, amount, clicks — and the screen
  shows return on ad spend once there is data.
- **Ideas have their own place, separate from work.** A repository with four stages — backlog, review,
  implemented, discarded — so a suggestion is not lost and not confused with a committed task.

### The client's own portal

- **Every client gets their own private web page, with no password.** You copy a link, send it to the
  client, and they see their content calendar and their shared files — nothing else, and nobody else's.
  The link itself is the key, so there is no account to set up for them.
- **You can revoke a client link at any time.** A "regenerate" button issues a new link and kills the old
  one, so a link that went to the wrong person stops working.
- **The client sees the plan, not the agency's private deadlines.** Their page lists every planned post by
  date with its stage — published, approved, scheduled, in design, drafting, changes requested — so they
  can see progress without being able to see the internal due dates or move anything.
- **Clients can send you reference material without email.** A "submit reference link" button on their
  page pushes a URL straight into the agency's file vault for that client. The agency side of that same
  vault sits on the client's workspace, where you can make folders, add links and upload files.
- **⚠️ One tab on that client page is broken.** The third tab, "Live Performance", crashes the whole page
  for the client — everything vanishes and is replaced by a browser error message, and they lose the
  calendar too until they reload the link. It happened both times it was tried, on a page clients are sent.
- **⚠️ Internal test rows are visible to clients on that page.** Items called "BUG-86 Rejected overdue"
  and "achu" sit in the calendar the client sees.

### Two rules I would have got wrong without opening them

- **Public holidays here are flexible, not fixed.** Each person gets a set number of flexible days a year
  (currently 13) and *opts in* to the specific holidays they want to take — so "National Day" is not a day
  the office simply closes, it is a day 12 people chose to spend one of their allowance on. The holiday
  screen is where you tick who opted in, person by person, each shown with their employee code.
- **Every sent email keeps a full delivery record, not just a line in a list.** Open any row in the email
  log and you get who it came from, who it went to including anyone copied, the exact second it was sent,
  what triggered it, the mail provider's own tracking id, and the record it was about — the invoice number,
  the amount and the currency. That is enough to prove to a client that an invoice was sent, when, and for
  how much.
- **The system explains how to connect a developer account rather than assuming you know.** A small info
  button walks through creating the access token step by step, naming every setting to choose.
---

## Coverage note (honesty)

- **Not clicked, deliberately:** `Continue with Google` (leaves the product), `Sign Out` (ends the session),
  `Create Role`, `Save Changes`, `Save finance settings`, `DELETE` on any role, `Permanently Delete User`,
  `Disconnect … from GitHub`, `Add Bank`, `Add Service`, `Restore defaults`, `Add registration`,
  and any option inside the role picker. Also, across §5–§6: `Transmit Secure Request` (both the public
  leave portal and HR's override — it would file a real request against a real person), `Submit
  Application`, every `Export` / `Export Register` / `Export VAT Return` / `Export CT Computation` /
  `Statement`, `Sync Now`, `Confirm All Matches` and the per-row confirm/unlink ticks, `Register Pay`,
  `Refresh salary & deductions`, `Resend Email`, `Permanently Delete Candidate`, `Delete All` and
  `Upload` on Company Holidays, `Update` on a holiday, `Delete Client`, `Delete Project`,
  `Regenerate` on a client's share link, `Import Calendar`, and `Create` / `Create Position` on all five
  create dialogs. Each was opened, read in full and cancelled or navigated away from.
- **Confirmed dead, not assumed:** `Add Item` (Inventory), `Add Asset` (Fixed Assets) and the row-edit
  pencil (Fixed Assets) were each clicked twice with the page's HTML measured before and after — no
  dialog, no navigation, no change of any kind.
- **Wrong sign-in values were not tried**, so this file says nothing about sign-in error messages.
- **Not reachable for this login, so described from its own words only:** the contents of
  `/projects/capacity`, `/projects/clients`, `/projects/revenue`, `/hr/portal`, `/finance/tds`, and — with
  no words of their own, just `Unauthorized` — `/finance/payables` and `/finance/approvals`.
- **Also not clicked in this last pass:** `Submit Reference Link` on the client portal (it writes into
  the agency's vault), `Regenerate` on a client's share link (it would break the link the client is
  using), `New Folder` / `Add Link` / the vault upload, and every opt-in tick-box on a company holiday.
- **Captured from one live record each, as the template for all of them:** the client workspace
  (Velocity Fitness), its public client portal, the project workspace (Q2 Digital Retainer, all four tabs), the candidate file
  (Mock Employee S), the pay-run detail (August 2026) and the public job page (`tester-l2`). The other
  records of each kind were listed but not opened one by one.
