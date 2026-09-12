# N8 — Nexeor Agency OS v2.0 · the **Finance** group

Captured 2026-09-07 from `https://os-staging.product.nexeor.com`, signed in as the demo account
(`demo_om85i@demo.agency`), headless Chromium 1512×950, re-checked at 390×844.
**Look-only capture — nothing was created, edited, saved, sent, marked paid, voided, deleted,
confirmed, synced, uploaded or exported.** Every dropdown was opened and read, then closed with
Escape. Every download offer was cancelled before it touched disk (none was ever triggered).

Every screen is client-rendered — the raw HTML holds nothing. Every value below was read off the
rendered page.

---

## 0. THE HEADLINE: the sidebar has 5 Finance items, the group actually has 18 screens

The brief expected "5 routes, tabs inside". It is **not tabs**. Each of the five Finance sidebar
entries is a **collapsible sub-menu**, and the sidebar label deep-links to the *first child* of
that sub-menu. That is exactly why four of the five labels "lie".

Each sidebar row has a small **chevron button** to its right (hidden until you hover the row).
Clicking the chevron expands that group's children in place. The group belonging to the page you
are on is **auto-expanded**, and when auto-expanded its children render in **UPPERCASE**; when you
expand a group manually the same children render in **Title Case**. That is a CSS difference only —
same links.

| Sidebar label | Where the label points | Its children (the real screens) |
|---|---|---|
| **Overview** | `/finance` | *(no children — it is a leaf)* |
| **Accounting** | `/finance/cash-book` | Cash Book `/finance/cash-book` · Receivables `/finance/receivables` · Payables `/finance/payables` · Client Ledgers `/finance/client-ledgers` |
| **Operations** | `/finance/invoices` | Invoices `/finance/invoices` · Approvals `/finance/approvals` · Inventory `/finance/inventory` · Payroll `/finance/payroll` · Reconciliation `/finance/reconciliation` · Wio Banking `/finance/banking` |
| **Reports & Tax** | `/finance/profitability` | Profitability `/finance/profitability` · VAT Filing `/finance/vat` · TDS Credits `/finance/tds` · Corporate Tax `/finance/corporate-tax` · Fixed Assets `/finance/fixed-assets` |
| **AI & Tools** | `/finance/inbox` | Finance Inbox `/finance/inbox` · AI Bookkeeper `/finance/ai-assistant` |

**1 + 4 + 6 + 5 + 2 = 18 screens.** All 18 were opened. **14 of them show content to this demo
account; 4 answer with a locked block** (see §1.1). One more, TDS Credits, renders its header and
then an admin-only message instead of the ledger — 5 screens withheld in total.

### 0.1 The five screens that are withheld from this account

| Screen | What renders | Exact words |
|---|---|---|
| Cash Book `/finance/cash-book` | **Nothing but the block.** No page title, no toolbar. A rose-bordered rose-tinted panel on the dark background. | `Unauthorized` |
| Invoices `/finance/invoices` | Same — no title, no toolbar, just the block. | `Unauthorized` |
| Payables `/finance/payables` | Title, subtitle **and the whole toolbar render**; the block replaces only the body. | `Unauthorized` |
| Approvals `/finance/approvals` | Title, subtitle and the `My queue` toggle render; the block replaces only the body. | `Unauthorized` |
| TDS Credits `/finance/tds` | Title, subtitle and both toolbar buttons render; a plain grey line replaces the ledger. | `TDS records are visible to admins only.` |

- Stable, not a loading race — re-checked with a 12-second settle on each. The sidebar shell,
  header and footer all render normally around the block; there is **no sign-out button** inside
  this particular block (unlike the locked screens batch 1 found elsewhere in the product).
- The screen loads its own permission set from a role endpoint on every finance page; for this
  account it comes back as **not super-admin, not full-access, with access to the six top-level
  groups** (`Sales, Marketing, HR, Web Projects, Finance, Global Tasks`). So the Finance *group* is
  open and these five *screens inside it* need something extra. Recorded and moved on — no other
  way in was attempted.
- **Consequence for the rest of this document:** the create-invoice form, the invoice list with its
  statuses and row actions, the cash-book ledger with its add-entry form and category list, and the
  vendor-bill list are **inside those blocked screens and could not be captured.** Everything I
  *could* learn about invoices from the screens that do open is in §7 and §20.

---

## 1. The shell, and the four controls that repeat across screens

**Where:** the left sidebar is always present at ≥1024 px. Top to bottom: the `Agency OS / NEXEOR`
brand block with a collapse chevron, then `My Portal` (`/hr/portal`) and `Global Tasks` (`/tasks`),
then five collapsible group buttons — `Sales`, `Marketing`, `Web Projects`, `Finance`, `HR` — then a
rose-coloured `Sign Out` at the bottom. The footer strip on every screen reads
`POWERED BY NEXEOR • COPYRIGHT © 2026 NEXEOR CREATIVE TECHNOLOGIES`.

Four toolbar controls recur. Where a screen has them they sit on one row, right-aligned under the
page title, in this order:

### 1.1 The entity / currency switcher — three segmented buttons
`Consolidated` · `Nexeor India (INR)` · `Nexeor UAE (AED)`. `Consolidated` is the default and is
highlighted sky-blue. Purely client-side — the address never changes. **Appears on:** Receivables,
Payables, Client Ledgers, Payroll. Not on Overview, Inventory, Reconciliation, Banking, or any
Reports & Tax screen.

The two entities behind it (read from the app's own entity list):

| | **Nexeor India** | **Nexeor UAE** |
|---|---|---|
| Legal name | Nexeor Creative Technologies Private Limited | Nexeor Creative Technologies – FZCO |
| Currency | **INR** | **AED** |
| Default entity | no | **yes** (`defaultCurrency: AED`) |
| Address | Kochi, Ernakulam, Kerala – 682019, India | IFZA Business Park, DDP, Dubai Silicon Oasis, Dubai 342001, UAE |
| Registrations shown on paperwork | **GSTIN**, **CIN**, **PAN** (three values) | *(none registered)* |
| Tax label + rate | **GST (18%)**, rate `18` | **VAT**, rate `0` |
| Label used for the buyer's tax number | `GSTIN` | `TRN` |
| **Invoice number prefix** | **`NXIN`** | **`NXRU`** |
| Numbering starts at | 1 | 1 |
| Bank block attached | one (an INR account) | none |
| Default payment terms | *(empty)* | *(empty)* |

There are **two bank blocks** on file, each a rich-text panel that gets stamped onto paperwork. One
is labelled `INR - Nexeor Creative Technologies PVT LTD` and contains the field labels
**Account Name, Bank, Branch, Account Number, IFSC Code, Branch ID, SWIFT Code, Branch Address**
(the real values are live banking details and are deliberately not reproduced here). The other is
labelled `Nexeor Creative Technologies FZCO` and contains only placeholder text and three
`localhost:3000` links — i.e. the UAE bank block has never been filled in.

### 1.2 The date range — two native date boxes
Two `dd-mm-yyyy` boxes with a `→` between them, aria-labelled **From date** and **To date**, both
empty by default. Clicking the visible label calls the browser's own date picker (a native
calendar, not an in-page dialog). **Once a date is set, a small `clear` link appears** beside them
which empties both. **Appears on:** Receivables, Payables, Client Ledgers, Payroll.

### 1.3 The `Export` button — a three-option menu
A plain `Export` button that opens a menu (it is a real menu — `aria-haspopup="menu"`):

1. **`PDF (letterhead)`**
2. **`Excel (.xlsx)`**
3. **`CSV`**

Identical list on **Receivables, Payables, Client Ledgers and Payroll**. I opened the menu on each
and chose nothing. Note the *other* export buttons in this group are different beasts and are
covered per screen — `Export` on Inventory, `Export Register` on Fixed Assets,
`Export VAT Return` on VAT and `Export CT Computation` on Corporate Tax all open **no menu at all**
and do nothing when pressed (§22.4).

### 1.4 The search box
A single text box, no button, filters as you type, no debounce visible. The placeholder differs per
screen: `Search invoices...`, `Search clients...`, `Search employees...`, `Search items or SKU...`,
`Search documents...`.

### 1.5 At 390 px
No page-level sideways scrolling on any screen tested. The sidebar collapses behind a hamburger
button fixed at the top-left. Tiles restack to one or two columns. Wide tables keep their width but
sit inside their own horizontally-scrolling card (Receivables' table is 979 px inside a 364 px card;
Profitability's is 700 px), so the page itself never overflows.

---

## 2. Overview — `/finance`

**Where:** sidebar → **Finance** → **Overview**. Page H1: **Finance Overview**. No tabs, no
sub-navigation, no filters, no search.

**What you see on arrival:** top-left the title `Finance Overview` with the line
`Nexeor Agency OS · AED` under it; top-right a single sky-blue **`Invoices`** button. Under that a
full-width amber-ish note. Then a **7-tile grid**. Below the tiles a two-column split: on the left
the `Revenue Received` bar chart, on the right the `Recent Receipts` list. At the very bottom a
row of six shortcut chips.

**The note under the title, word for word:**
> Revenue, receivables, payables and total-owed are live. Bank Balance still needs a bank feed —
> shown as “—” until that’s connected.

### Numbers/cards on the page — all 7 tiles

Each tile is a whole clickable link. Values read on capture day.

| # | Label | Big value | Small line under it | Where it takes you |
|---|---|---|---|---|
| 1 | `Total Revenue` | **AED 86,900** | `28 payments received` | `/finance/receivables` |
| 2 | `Receivables` | **AED 222,142** | `30 outstanding · 30 overdue` | `/finance/receivables` |
| 3 | `Overdue` | **30** | `invoices past due date` | `/finance/receivables` |
| 4 | `Payables` | **AED 200,526** | `open vendor bills` | `/finance/payables` *(locked screen)* |
| 5 | `Total Owed` | **AED 10,399,379** | `payables AED 200,526 + payroll AED 10,198,853` | `/finance/payables` *(locked screen)* |
| 6 | `Bank Balance`, carrying a **`PHASE 2`** ribbon | **—** | `awaiting bank feed` | `/finance/banking` |
| 7 | `AI Bookkeeper` (no number) | — | `Ask about cash flow, overdue invoices & financial summaries` | `/finance/ai-assistant` |

- Tile 5 is the only tile that shows its own arithmetic in the subtitle.
- Tile 6 is the only tile with a phase ribbon, and the only one whose value is a dash. Behind it the
  bank balance genuinely comes back empty, which is what the note at the top is explaining.
- **Cash-in vs cash-out:** the overview *does* track money out (payables AED 200,526 feeds tile 4
  and tile 5), but there is **no expenses tile and no net-profit tile on the screen**, and the chart
  is money-in only. The data behind the screen carries a monthly expenses series and a net-profit
  figure (net profit AED −113,626 on capture day) that the page never displays.

### Controls — every one, in order

1. **`Invoices`** (sky-blue, top right) → navigates to `/finance/invoices`. Same-tab navigation, no
   dialog. That destination is one of the locked screens for this account.
2. **Each of the 7 tiles** is a link — destinations in the table above.
3. **`View All`** (top-right of the Recent Receipts card) → `/finance/cash-book` — also a locked
   screen for this account.
4. **Each of the 8 receipt rows** in Recent Receipts is a link → `/finance/receivables` (all eight
   go to the same list; none deep-links to the specific receipt).
5. **The six shortcut chips** along the bottom: `Cash Book` → `/finance/cash-book` ·
   `Receivables` → `/finance/receivables` · `Payables` → `/finance/payables` ·
   `Ledgers` → `/finance/client-ledgers` · `Invoices` → `/finance/invoices` ·
   `AI Chat` → `/finance/ai-assistant`.

**Every form/dialog it opens: none.** Nothing on this screen opens a modal, drawer, dropdown or
form. **There is no period selector of any kind** — no month picker, no preset list
(today/week/month/quarter/year), no date boxes, no `select` element anywhere on the page. The chart
window is hard-wired to the last 7 months.

### The `Revenue Received` chart
Card heading `Revenue Received`, sub-line `Last 7 months · money in`. A bar chart, x-axis
`Mar Apr May Jun Jul Aug Sep`, y-axis `0k 20k 40k 60k 80k`. **Hovering a bar shows a one-line
tooltip: `Revenue: AED 77,690`** (that value is June's). Behind it the series carried:
Mar 0, Apr 0, May 0, Jun 77,690, Jul 7,210, Aug 2,000, Sep 0 — and an expenses series that is 0 in
every month and is not drawn.

### The `Recent Receipts` list
Heading `Recent Receipts`, sub-line `Latest payments in`, `View All` at the right. Eight rows, each:
client name (with the lead's stage baked into the name in this demo data), then
`<milestone name> · <date>`, then the amount in green with a `+` sign. Exactly as captured:

| Client | Milestone · date | Amount |
|---|---|---|
| Stave Corp IN_PROGRESS - 1 | Monthly SEO - Jul 2026 · 2026-08-12 | +AED 2,000 |
| Italica | Milestone 2 - Sprint Close · 2026-07-27 | +AED 388 |
| Italica | Milestone 1 - Advance · 2026-07-27 | +AED 6,818 |
| Checkpoint 12 INR Test | Full Payment · 2026-07-20 | +AED 4 |
| Stave Corp IN_PROGRESS - 4 | dggh · 2026-06-25 | +AED 1,000 |
| Stave Corp IN_PROGRESS - 4 | abcdefgh - Jun 2026 · 2026-06-23 | +AED 500 |
| Stave Corp RECURRING - 5 | Initial Payment · 2026-06-23 | +AED 200 |
| Stave Corp RECURRING - 5 | fhbdskjvbkdh - Jul 2026 · 2026-06-23 | +AED 2,000 |

Each row carries the CRM lead's id underneath (see §20) but the link on the row throws that away
and goes to the plain receivables list.

**Empty state:** not observable — every tile and both cards had data.
**Realtime/auto:** nothing moves on its own; the page fetches once on load.

---

## 3. Accounting → **Cash Book** — `/finance/cash-book`

**Where:** sidebar → Finance → **Accounting** (the label's own destination), or → Accounting →
`CASH BOOK`.

**Not reachable with this account.** The page renders as nothing but a rose-bordered panel reading
**`Unauthorized`** — no title, no toolbar, no tabs. Underneath, the screen asks for the cash book
one page at a time (`page=1`, `pageSize=20`, plus the entity), so the real screen is a
**paginated ledger of 20 rows a page** with the same entity switcher as its siblings — but its
columns, its category list, its add-entry form, its bank/account picker, its reconciliation controls
and its running-balance behaviour are all behind the block and **were not captured**. Reported, not
worked around.

---

## 4. Accounting → **Receivables** — `/finance/receivables`

**Where:** sidebar → Finance → Accounting → `RECEIVABLES`. Also every revenue/overdue tile and
every receipt row on the Overview lands here. H1: **Receivables**, sub-line
`Track outstanding invoices and incoming payments`.

**What you see on arrival:** title top-left; toolbar top-right (entity switcher, date range,
`Export`). Then a row of **three summary tiles**. Then an **`Aging Analysis`** card of four buckets.
Then a search box with four status chips, and finally one long table — **47 rows on Consolidated,
all of them, with no pagination and no page-size control.**

### Numbers/cards on the page

Three tiles (Consolidated):

| Label | Value | Small line |
|---|---|---|
| `Outstanding` | AED 222,142 | `30 invoices pending` |
| `Overdue` | AED 222,142 | `30 invoices past due date` |
| `Collected` | AED 114,080 | `All received payments` |

`Aging Analysis` — four buckets, each a value plus a count:

| Bucket | Consolidated | Nexeor India (INR) | Nexeor UAE (AED) |
|---|---|---|---|
| `Current` | AED 172,433 · 9 invoices | INR 463,195 · 4 | AED 152,603 · 4 |
| `31-60 Days` | AED 7,246 · 8 invoices | INR 20,400 · 2 | AED 6,453 · 6 |
| `61-90 Days` | AED 42,463 · 13 invoices | INR 0 · 0 | AED 42,463 · 13 |
| `90+ Days` | AED 0 · 0 invoices | INR 0 · 0 | AED 0 · 0 |

And the tiles per entity: **India** — Outstanding INR 483,595 (6 pending) · Overdue INR 483,595
(6) · Collected INR 185,600, **6 rows**. **UAE** — Outstanding AED 201,519 (23) · Overdue AED
201,519 (23) · Collected AED 106,870, **40 rows**. (6 + 40 = 46, against 47 on Consolidated.)

### The table — every column

`INVOICE #` · `ITEM` · `CLIENT` · `ISSUED` · `DUE` · `AMOUNT` · `OUTSTANDING` · `STATUS` · `VIEW`

- **`INVOICE #`** — the number (`NXRU0012`, `NXIN0001`, …) or an em dash. **Only 10 of the 47 rows
  have an invoice number**; the other 37 show `—`.
- **`ITEM`** — the milestone's name (`MONTHLY Retainer`, `Initial Payment`, `Final Payment`,
  `Milestone 1 - Advance`, `Full Payment`, and free-typed demo names like `gggg`, `dggh`, `xyz`).
- **`CLIENT`** — two lines: the client/lead name on top, the contact person below
  (`Stave Corp IN_PROGRESS - 2` / `Lead Contact 1`). **Not a link.** The row is not clickable
  either (default cursor, no hover navigation).
- **`ISSUED`** — a plain date.
- **`DUE`** — the date, and if it is past, the age in brackets in red: `2026-06-20(79d)`.
- **`AMOUNT`** / **`OUTSTANDING`** — money. A fully-paid row shows `—` in OUTSTANDING.
- **`STATUS`** — a pill. **Only two values occur in this data: `Paid` (17 rows) and `Overdue`
  (30 rows).**
- **`VIEW`** — either a **`View`** button (10 rows) or the flat grey words **`No invoice`** (37 rows).

**Sorting:** no sortable headers, no sort control. Rows come out ordered by due date, oldest first.
**Page size:** none — the whole set renders.

### Status chips — the four filters, and what each actually shows

| Chip | Rows on Consolidated | What it means here |
|---|---|---|
| `All` | 47 | everything |
| **`Sent`** | **0** | see below |
| `Overdue` | 30 | past the due date and not settled |
| `Paid` | 17 | settled |

**`Sent` is empty and can never fill with this data.** The chips filter on the *milestone's* status,
which is only ever `paid` or `overdue`, while `Sent` is an *invoice* status. Underneath, 4 of the 10
invoices attached to these rows are in fact `SENT` (and 5 are `DRAFT`, 1 is `PAID`) — so the invoice
statuses the product uses are **DRAFT / SENT / PAID**, but the Sent chip does not find them.

**Empty state:** filtering to nothing gives the line **`No receivables match your filters`**.

### The one dialog on this screen — the invoice preview

Pressing **`View`** on a row opens a **small centred read-only modal**. It is the only place in my
whole scope where an invoice document can be seen.

```
NXRU0012
Stave Corp IN_PROGRESS - 2                                          ×

Issued            2026-08-05
Due               2026-06-20

DESCRIPTION        QTY     RATE       AMOUNT
Initial Payment     1      23,632     23,632

Subtotal        AED 23,632
VAT             AED 1,182
Total           AED 24,814
Paid            AED 0
Balance Due     AED 24,814
```

- **The only control on it is the `×` close button.** No Send, no Mark paid, no Void, no Delete, no
  Download, no Print, no Edit, no "open full invoice". Nothing to cancel out of — so nothing was
  risked here.
- **There is no full-page invoice route.** `/finance/invoices/<the invoice's own id>` answers
  **`404 — This page could not be found.`** This modal is the whole invoice view.
- The stored invoice record carries: number, issue date, due date, currency, status, `pdfUrl`
  (empty on every record I saw), subtotal, tax amount, total, amount paid, balance due, and line
  items of `{ description, subDescription, quantity, rate, amount }`. **`subDescription` is a real
  second line on a line item that the modal does not display.**
- ⚠️ The modal and its own table row disagree — see §22.1.

**Realtime/auto:** nothing. One fetch on load, one on each entity switch.

---

## 5. Accounting → **Payables** — `/finance/payables`

**Where:** sidebar → Finance → Accounting → `PAYABLES`. Also the `Payables` and `Total Owed` tiles
on the Overview. H1: **Payables**, sub-line `Bills you owe vendors & suppliers`.

**Header and toolbar render; the body is the locked block.** So this much is real and recordable:

**Controls (all present, all rendered, the list below them blocked):**
1. Entity switcher — `Consolidated` · `Nexeor India (INR)` · `Nexeor UAE (AED)`.
2. Date range — two `dd-mm-yyyy` boxes with `→`.
3. **`Export`**.
4. **`Add Bill`** — the create-a-vendor-bill control. It sits to the right of Export.

Then, where the list would be: **`Unauthorized`**.

**Not captured:** the bill list's columns, statuses and row actions, and the whole `Add Bill` form.
The Overview tells us the total behind it is **AED 200,526 of open vendor bills**.

---

## 6. Accounting → **Client Ledgers** — `/finance/client-ledgers`

**Where:** sidebar → Finance → Accounting → `CLIENT LEDGERS`, or the `Ledgers` chip on the
Overview. H1: **Client Ledgers**, sub-line `Full transaction history per client account · 14 clients`.

**What you see on arrival:** title and the standard toolbar (entity switcher, date range, `Export`).
Below that a **two-pane layout**: a left column listing every client as a selectable card, and a
right pane holding the selected client's ledger. The **first client is selected automatically** on
load (the one with the biggest balance due).

### The left pane — the client picker
A `Search clients...` box, then one card per client, **sorted by balance due, biggest first**, and a
count line at the bottom reading `14 of 14 clients` (it becomes `1 of 14 clients` when you search).
Each card shows: a round initial avatar, the client name, `Last: <date> · <n> txns`, and either
`Due: AED <amount>` or the green words **`✓ Settled`**.

All 14, exactly as they read:

| Client | Last activity | Txns | Balance |
|---|---|---|---|
| Stave Corp IN_PROGRESS - 3 | 2026-09-03 | 2 | Due: AED 81,461 |
| Stave Corp ON_HOLD - 1 | 2026-09-03 | 2 | Due: AED 71,142 |
| Stave Corp RECURRING - 4 | 2026-07-06 | 3 | Due: AED 40,770 |
| Italica | 2026-08-26 | 5 | Due: AED 18,045 |
| Stave Corp CLOSED - 1 | 2026-07-02 | 7 | Due: AED 10,797 |
| Stave Corp RECURRING - 5 | 2026-07-21 | 17 | Due: AED 9,804 |
| Stave Corp IN_PROGRESS - 2 | 2026-08-22 | 5 | Due: AED 7,345 |
| Stave Corp IN_PROGRESS - 4 | 2026-07-24 | 11 | Due: AED 4,504 |
| Stave Corp IN_PROGRESS - 5 | 2026-07-22 | 5 | Due: AED 2,700 |
| Stave Corp IN_PROGRESS - 1 | 2026-08-12 | 5 | Due: AED 2,000 |
| Stave Corp QUALIFIED - 1 | 2026-09-02 | 2 | Due: AED 707 |
| Checkpoint 12 INR Test | 2026-07-20 | 2 | Due: AED 35 |
| Test | 2026-07-23 | 3 | Due: AED 13 |
| Stave Corp IN_PROGRESS - 7 | 2026-09-01 | 6 | **✓ Settled** |

### The right pane — one client's ledger
Top: the client name, `<n> transactions`, and `Balance Due: AED <amount>`. Then two figures side by
side, **`TOTAL INVOICED`** and **`TOTAL RECEIVED`**. Then a **`Balance Trend`** line chart (x-axis is
the transaction dates in `MM-DD`, y-axis money; for Italica it ran `-8k 0k 8k 15k 23k`). Then three
tabs, then the transactions table.

**Tabs — three, and what changes:**

| Tab | Effect (on Italica, 5 txns) |
|---|---|
| **`All Transactions`** (default) | every row — invoices raised and payments received |
| `Invoiced` | only the rows that raised money owed |
| `Received` | only payments in |

The row count line above the table follows the tab (`2 transactions`, `0 transactions`, …). The
**column headers never change**: `DATE` · `DESCRIPTION` · `INVOICED` · `RECEIVED` · `BALANCE`.

A real ledger, exactly as rendered (Italica):

| DATE | DESCRIPTION | INVOICED | RECEIVED | BALANCE |
|---|---|---|---|---|
| 2026-07-27 | Payment — Milestone 1 - Advance | — | AED 6,818 | AED 6,818 |
| 2026-07-27 | Payment — Milestone 2 - Sprint Close | — | AED 388 | AED 7,207 |
| 2026-07-29 | Milestone 1 - Advance | AED 7,576 | — | AED 369 |
| 2026-08-12 | Milestone 2 - Sprint Close | AED 10,101 | — | AED 10,470 |
| 2026-08-26 | Milestone 3 - Go-Live | AED 7,576 | — | AED 18,046 |

**Running-balance behaviour:** the balance is a running total down the page, and a payment received
is prefixed `Payment — ` in the description. Note the header says `Balance Due: AED 18,045` while
the last row says `AED 18,046`, and the balance never shows a minus even when the client is ahead —
the trend chart drops below zero but the column does not. See §22.3.

**Empty state:** the `Received` tab on a client with no payments shows `0 transactions` and an empty
table (headers stay).
**Realtime/auto:** none.

---

## 7. Operations → **Invoices** — `/finance/invoices`

**Where:** sidebar → Finance → **Operations** (the label's own destination), or → Operations →
`INVOICES`; also the sky `Invoices` button and the `Invoices` chip on the Overview.

**Not reachable with this account.** The whole page is the rose panel reading **`Unauthorized`** —
no title, no toolbar, no tabs, no create button. Underneath it asks for the invoice list for the
selected entity, so it is entity-aware like its siblings.

**Not captured, and I am not going to guess at it:** the invoice list's columns, its status set and
what each status means, its row actions, **the create-invoice form in full** (line items, tax
options, currency handling, payment terms, discounts, notes, the number series), and the invoice
detail/preview page with its buttons.

**What I could establish about invoices from the screens that do open** — collected here so the gap
is as small as I can honestly make it:

- **The number series is per entity, and it is a prefix + a 4-digit counter starting at 1.**
  India issues `NXIN####`, UAE issues `NXRU####`. Live numbers seen: `NXRU0001`, `NXRU0003`,
  `NXRU0012`, `NXRU0013`, `NXRU0014`, `NXRU0015`, `NXRU0018`, `NXRU0019`, `NXIN0001`.
- **Statuses that exist on the invoice record: `DRAFT`, `SENT`, `PAID`** (5 / 4 / 1 across the ten
  invoices attached to receivables rows).
- **A line item is** `description`, `subDescription`, `quantity`, `rate`, `amount`.
- **An invoice totals as** subtotal → tax amount → total → amount paid → balance due. The tax line
  is labelled from the entity (`VAT` for UAE, `GST (18%)` for India) and the buyer's tax number is
  labelled `TRN` for UAE and `GSTIN` for India.
- **An invoice can carry a `pdfUrl`** — empty on every record here — which is what `PDF (letterhead)`
  and the entity's bank block are for.
- **Payment terms exist as an entity-level default** and are empty for both entities.
- Nothing anywhere suggested a per-invoice discount field; the discount concept did not appear on
  any screen in this group.

---

## 8. Operations → **Approvals** — `/finance/approvals`

**Where:** sidebar → Finance → Operations → `APPROVALS`. H1: **Approvals**.

**Header renders, body is locked.** The subtitle is the most informative thing on the screen and
describes the whole approval chain, word for word:

> Expenditure awaiting approval. Leadership approves first (Rohit above threshold), then Accounts
> verifies & releases for payment.

**Controls:** exactly one — a **`My queue`** toggle chip at the top right. Pressing it changes
nothing visible, because the body underneath is **`Unauthorized`**. Underneath, the screen asks for
approvals with `status=PENDING`, so pending is the default view.

So the product's approval design, as far as it is stated on screen: **two stages** — leadership
first (with a named person, Rohit, taking anything above a money threshold), then Accounts verifies
and releases for payment. **Not captured:** the queue itself, the threshold value, the approve/reject
controls.

---

## 9. Operations → **Inventory** — `/finance/inventory`

**Where:** sidebar → Finance → Operations → `INVENTORY`. H1: **Inventory**, sub-line
`Software licenses · Hardware · Cloud services · Print media`.

**What you see on arrival:** title top-left; two buttons top-right (`Export`, `Add Item`). Then four
tiles. Then a bar chart. Then two tabs, a search box and six category chips, then the table.
**No entity switcher and no date range on this screen.**

### Numbers/cards
| Label | Value |
|---|---|
| `Total Inventory Value` | AED 72,670 |
| `Total Units/Seats` | 5,045 |
| `Low / Out of Stock` | 3 |
| `SKUs Tracked` | 9 |

**Chart:** `Inventory Value by Category`, sub-line `Total: AED 72,670`, y-axis `0k 7k 14k 21k 28k`,
x-axis `Software`, `Hardware`, `CloudServices`, `Print Media`, `Credits`. (The third label renders
without its space — `CloudServices`.)

### Tabs — two
1. **`Item Register`** (default) — the stock list.
2. **`Stock Movements`** — the in/out history. Switching swaps the table entirely, including the
   headers; the four tiles, the chart, the search box and the category chips stay put but the chips
   no longer apply.

### Tab 1 · Item Register
Columns: `ITEM` · `CATEGORY` · `QTY` · `UNIT COST` · `SALE PRICE` · `TOTAL VALUE` · `STATUS`.
The ITEM cell is two lines — name on top, **SKU** below. The SALE PRICE cell is two lines — the price
and, under it, the **margin as a percentage**. No row actions at all, no per-row buttons, no
pagination. All 9 rows:

| Item | SKU | Category | Qty | Unit cost | Sale price | Margin | Total value | Status |
|---|---|---|---|---|---|---|---|---|
| Adobe CC Seat License | ADO-CC-001 | Software | 12 seats | AED 1,500 | AED 3,000 | 50% | AED 18,000 | In Stock |
| Figma Professional Seat | FIG-PRO-001 | Software | 8 seats | AED 1,050 | AED 2,100 | 50% | AED 8,400 | In Stock |
| Shopify Partner Credits | SHP-CRED-001 | Credits | 5000 credits | AED 1 | AED 2.5 | 60% | AED 5,000 | In Stock |
| MacBook Pro M3 (Demo Unit) | APL-MBP-M3 | Hardware | 2 units | AED 8,000 | AED 12,000 | 33% | AED 16,000 | In Stock |
| Wacom Cintiq 16 Tablet | WAC-CTQ-16 | Hardware | 0 units | AED 2,800 | AED 4,200 | 33% | AED 0 | **Out of Stock** |
| AWS Reserved Compute (1yr) | AWS-EC2-RSV | Cloud Services | 3 instances | AED 4,200 | AED 6,800 | 38% | AED 12,600 | In Stock |
| Vercel Pro Team Plan | VCL-PRO-TM | Cloud Services | 1 plan | AED 4,800 | AED 9,600 | 50% | AED 4,800 | In Stock |
| Printed Branding Kits | BRD-KIT-001 | Print Media | 15 kits | AED 450 | AED 900 | 50% | AED 6,750 | **Low Stock** |
| A0 Display Boards | DISP-A0-001 | Print Media | 4 units | AED 280 | AED 560 | 50% | AED 1,120 | **Low Stock** |

**Statuses:** `In Stock`, `Low Stock`, `Out of Stock`. **The quantity carries its own unit** —
seats, credits, units, instances, plan, kits.

**Category chips — all six, with what each shows:** `All` (9) · `Software` (2) · `Hardware` (2) ·
`Cloud Services` (2) · `Print Media` (2) · `Credits` (1).

### Tab 2 · Stock Movements
Columns: `DATE` · `ITEM` · `REFERENCE` · `TYPE` · `QTY` · `BALANCE`. Six rows, newest first. **Types
are `Issued` and `Received`; QTY carries the sign (`-2`, `+1`) and BALANCE is the stock left after
that movement.** The REFERENCE is a prefixed free-text reason, and the three prefixes seen are
**`CLIENT:`**, **`PURCHASE:`** and **`DISPOSED:`**.

| Date | Item | Reference | Type | Qty | Balance |
|---|---|---|---|---|---|
| 2026-05-19 | Adobe CC Seat License | CLIENT: Al Futtaim Group | Issued | -2 | 12 |
| 2026-05-17 | AWS Reserved Compute | PURCHASE: AWS invoice | Received | +1 | 3 |
| 2026-05-15 | Printed Branding Kits | CLIENT: Emaar Properties | Issued | -3 | 15 |
| 2026-05-12 | Figma Professional Seat | CLIENT: DEWA Digital | Issued | -1 | 8 |
| 2026-05-10 | Wacom Cintiq 16 Tablet | DISPOSED: Damaged unit | Issued | -1 | 0 |
| 2026-05-08 | Printed Branding Kits | PURCHASE: Printsmith Co. | Received | +10 | 18 |

### Its two toolbar buttons
**`Export`** and **`Add Item`** both render and are both enabled — and **both do nothing when
pressed.** No menu, no dialog, no navigation, no file offered, no error in the browser console, and
no hidden file input or form anywhere on the page. So Inventory has **no add-item form to capture
and no export option list** — the buttons are placeholders. (Distinct from the Export on
Receivables/Payables/Ledgers/Payroll, which genuinely opens the three-option menu.)

**Empty state:** every category has at least one item, so not observable. A search with no match
leaves the table empty with the headers in place.
**Realtime/auto:** none. This screen's data is fixed demo content — the dates all sit in May 2026.

---

## 10. Operations → **Payroll** — `/finance/payroll`

**Where:** sidebar → Finance → Operations → `PAYROLL`. H1: **Payroll**, sub-line
`<Month Year> · 23 employees · mirrors HR payroll`. Beside the title an amber pill:
`23 pending approval`.

**What you see on arrival:** title with the pill; the full standard toolbar (entity switcher, date
range, `Export`) plus a **`Manage in HR Payroll`** link; four tiles; two charts side by side; then
the employee table with a totals row.

**"mirrors HR payroll" is the point of the screen** — it is a read-out of the HR module's pay run,
not a place to run payroll. There is no Run, Approve, Process or Pay control anywhere on it.

### Numbers/cards (Consolidated, on one load)
| Label | Value |
|---|---|
| `Total Gross Payroll` | AED 199,784 |
| `Processed` | 0 |
| `Pending Approval` | 23 |
| `Avg. Salary` | AED 8,686 |

**Charts:** `Payroll Trend` (sub-line `Recent pay runs`; x-axis the pay runs by name —
`Dec 2025`, `Jan 2026`, `July 2026`, `August 2026`, `September 2026`; y-axis up to `12000k`) and
`By Role` (sub-line `<Month Year> payroll split`) — a list, not a chart:
`HR Specialist AED 78,667`, `Marketing Manager AED 71,133`, `Software Engineer AED 49,984`,
`Employee AED 0`.

### The table — every column
`EMPLOYEE` · `ROLE` · `BASE` · `ALLOWANCE` · `BONUS / REIMB.` · `DEDUCTION` · `NET PAY` · `STATUS` ·
`ACTIONS`

- EMPLOYEE is an initials avatar plus the name. ROLE is the job title.
- Allowance, bonus/reimbursement and deduction were `—` on all 23 rows, so `NET PAY` equals `BASE`
  throughout.
- **`STATUS`** was `Pending` on all 23 rows; the tile alongside it counts a `Processed` state too,
  so the pair is at least **Pending / Processed**.
- **`ACTIONS`** is a **single icon link titled `View in HR`** → `/hr/payroll/<pay-run id>`.
  **Every row's link is identical** — it opens the pay run, not the person.
- **A totals row closes the table:** `Total Gross Payroll – September 2026 | AED 199,784`.
- 23 rows, no pagination, no sortable headers.

Roles seen: Software Engineer, HR Specialist, Marketing Manager, and a bare `Employee` (8 people on
`AED 0`).

### Controls
1. **Entity switcher.** **India → `No pay run · 0 employees`, INR 0 across all four tiles, 0 rows.
   UAE → the same, AED 0.** Payroll only exists on `Consolidated`.
2. **Date range.** This is the screen's real period selector, and it is not a preset list — you type
   two dates and it picks **the pay run whose period falls inside the range**. Setting
   `2026-07-01 → 2026-07-31` re-titled the screen `July 2026 · 21 employees`, changed the pill to
   `20 pending approval`, and gave `Total Gross Payroll AED 233,038 · Processed 1 ·
   Pending Approval 20 · Avg. Salary AED 11,097`, 21 rows. A `clear` link appears next to the boxes
   while dates are set.
3. **`Export`** → the three-option menu (`PDF (letterhead)`, `Excel (.xlsx)`, `CSV`).
4. **`Manage in HR Payroll`** → `/hr/payroll` (the HR module, outside this group).
5. **`Search employees...`** — filters the rows (`mock` → 9 rows).

**Empty state:** a search with no match gives **`No employees match your search`**. An entity with
no pay run gives `No pay run · 0 employees` in the subtitle with zeroed tiles.
**Realtime/auto:** none, but see §22.8 — which month you land on is not stable.

---

## 11. Operations → **Reconciliation** — `/finance/reconciliation`

**Where:** sidebar → Finance → Operations → `RECONCILIATION`. H1: **Payment Reconciliation**,
sub-line `Match Wio Bank transactions to system records`, and beside it `Last synced: 2 hours ago`.

**What you see on arrival:** title, and top-right a single **`Confirm All Matches`** button. Then a
`Reconciliation Progress` card. Then **two columns side by side** — the bank's transactions on the
left, the app's own records on the right — and a `Match Summary` strip at the bottom. This is the
classic two-column matching screen.

### `Reconciliation Progress`
Sub-line `May 2026 · Wio Business Account`. A big **`0/9`** with `transactions confirmed` under it,
then two lines: **`6 auto-matched · 0 manual`** and **`3 unmatched`**.

### Left column — `Wio Bank Feed`
Sub-line `9 transactions this period`. Each row: a direction arrow (**↑ for money in, ↓ for money
out**), the description, the bank's own reference, the date, the amount (incoming amounts carry a
`+`), and on the right either a **match-confidence percentage** or the word **`Unmatched`**.

| | Description | Ref | Date | Amount | Confidence |
|---|---|---|---|---|---|
| ↑ | INCOMING: Al Futtaim Group | WIO-TXN-9981 | 2026-05-19 | +AED 50,925 | **96%** |
| ↓ | PAYMENT: AWS Cloud Services | WIO-TXN-9980 | 2026-05-18 | AED 3,200 | **100%** |
| ↑ | INCOMING: Emaar Properties | WIO-TXN-9979 | 2026-05-17 | +AED 75,600 | **Unmatched** |
| ↓ | PAYMENT: Payroll Batch May-26 | WIO-TXN-9978 | 2026-05-15 | AED 52,000 | **100%** |
| ↑ | INCOMING: DEWA Digital Corp. | WIO-TXN-9977 | 2026-05-14 | +AED 19,687 | **Unmatched** |
| ↓ | PAYMENT: JLT Tower Rent | WIO-TXN-9976 | 2026-05-13 | AED 12,000 | **100%** |
| ↑ | INCOMING: Majid Al Futtaim | WIO-TXN-9975 | 2026-05-12 | +AED 36,750 | **Unmatched** |
| ↓ | PAYMENT: Google Ads | WIO-TXN-9974 | 2026-05-11 | AED 8,400 | **100%** |
| ↑ | INCOMING: ADNOC Group | WIO-TXN-9973 | 2026-05-10 | +AED 64,260 | **88%** |

**Row actions — two small icon buttons, and only on the six rows that have a confidence score:**
1. A **green circle-tick** — confirm this match.
2. A **red broken-link** — break/reject this match.

The three `Unmatched` rows have **no buttons at all**, so there is **no "find me a match" or
"link manually" control on the screen** even though the progress card counts `0 manual` as if
manual linking were possible. Neither icon was pressed — both write.

### Right column — `System Records`
Sub-line `Invoices, bills & payroll entries`. Each row is tagged by kind — **`INV`**, **`BILL`** or
**`PAY`** — then the description, the internal reference, the date, the amount, and a status of
**`Matched ✓`** or **`Pending`**.

| Kind | Description | Ref | Date | Amount | Status |
|---|---|---|---|---|---|
| INV | Invoice #INV-0091 – Al Futtaim Group | INV-0091 | 2026-05-19 | +AED 50,925 | Matched ✓ |
| BILL | AWS Cloud Services Bill #0041 | BILL-0041 | 2026-05-18 | AED 3,200 | Matched ✓ |
| INV | Invoice #INV-0090 – Emaar Properties | INV-0090 | 2026-05-17 | +AED 75,600 | Pending |
| PAY | Payroll Disbursement May 2026 | PAY-0526 | 2026-05-15 | AED 52,000 | Matched ✓ |
| INV | Invoice #INV-0089 – DEWA Digital | INV-0089 | 2026-05-14 | +AED 18,750 | Pending |
| BILL | JLT Tower Office Rent | BILL-0042 | 2026-05-13 | AED 12,000 | Matched ✓ |
| INV | Invoice #INV-0088 – Majid Al Futtaim | INV-0088 | 2026-05-12 | +AED 35,000 | Pending |
| BILL | Google Ads Campaign – May | BILL-0043 | 2026-05-11 | AED 8,400 | Matched ✓ |
| INV | Invoice #INV-0087 – ADNOC Group | INV-0087 | 2026-05-10 | +AED 61,200 | Matched ✓ |

**How the confidence score reads:** the exact-amount pairs score 100%, and the two that score below
100% are the ones where the bank amount and the record amount differ — ADNOC 64,260 vs 61,200 gives
88%, Al Futtaim 50,925 vs 50,925 with a two-day-old invoice gives 96%. The three `Pending` records
sit against the three `Unmatched` bank lines and their amounts are close but not equal (75,600 vs
75,600, 19,687 vs 18,750, 36,750 vs 35,000).

### `Match Summary`
Four figures: **`9` Total Bank Entries · `6` Auto-Matched · `0` Manually Linked · `0` Confirmed.**

### `Confirm All Matches`
A single top-right button, enabled. **Not pressed** — it commits all six auto-matches at once, which
is exactly the sort of money write this capture must not do. Described only.

**Empty state:** not observable (fixed demo data).
**Realtime/auto:** nothing moves; `Last synced: 2 hours ago` is static text.

---

## 12. Operations → **Wio Banking** — `/finance/banking`

**Where:** sidebar → Finance → Operations → `WIO BANKING`, or the `Bank Balance` tile on the
Overview. H1: **Wio Bank Integration**, sub-line
`Connected · 3 accounts synced · UAE Central Bank Regulated`, and a green pill
`All Accounts Connected`.

Wio is a UAE digital business bank; this is the bank-feed integration screen.

**What you see on arrival:** title, pill and a **`Sync Now`** button top-right. A row of four
feature strips. A `TOTAL PORTFOLIO BALANCE` figure. Three account cards. A balance chart. A
transactions table. A settings card at the bottom.

### The four feature strips (marketing copy, not controls)
1. **`Instant Payments`** — `Real-time AED transfers via AANI`
2. **`Bank-level Security`** — `256-bit encryption, 2FA enforced`
3. **`Auto Reconciliation`** — `Transactions synced every 2h`
4. **`ERP Integration`** — `Mapped to Finance module`

### Balances
**`TOTAL PORTFOLIO BALANCE` — AED 579,810**, with `+AED 17,450 vs yesterday` under it.

Three account cards, each with a green **`Live`** badge, and each card is a button:

| Account | Number | Type | Balance | Available | Today | Synced |
|---|---|---|---|---|---|---|
| Wio Business Main | AE••••••••••7823 | Current Account | AED 342,810 | AED 338,200 | AED 12,450 today | Synced 2 hours ago |
| Wio Payroll Account | AE••••••••••4412 | Business Payroll | AED 52,000 | AED 52,000 | AED 52,000 today | Synced 2 hours ago |
| Wio Business Savings | AE••••••••••9901 | Savings Account | AED 185,000 | AED 185,000 | AED 5,000 today | Synced 2 hours ago |

The IBANs are masked on screen to the last four digits. **The cards are buttons but clicking one
does nothing** — no filter, no drill-down, no dialog.

**Chart:** `Balance Trend – All Accounts`, sub-line `May 2026`, a three-series line chart legended
`Main`, `Payroll`, `Savings`; x-axis `May 1, 5, 8, 10, 12, 13, 14, 15, 17, 18, 19`; y-axis
`0k 95k 190k 285k 380k`.

### `Recent Bank Transactions`
Sub-line `Across all Wio accounts`, and a **`Statement`** button at the card's top-right.
Columns: `TRANSACTION ID` · `DESCRIPTION` · `ACCOUNT` · `CATEGORY` · `DATE` · `AMOUNT`.

Six rows show, then a **`+ Show 3 more transactions`** link that reveals the last three in place
(the link then disappears). All nine:

| ID | Description | Account | Category | Date | Amount |
|---|---|---|---|---|---|
| WIO-9981 | INCOMING: Al Futtaim Group | Main | Invoice Payment | 2026-05-19 | +AED 50,925 |
| WIO-9980 | PAYMENT: AWS Cloud Services | Main | SaaS | 2026-05-18 | AED 3,200 |
| WIO-9979 | INCOMING: Emaar Properties | Main | Invoice Payment | 2026-05-17 | +AED 75,600 |
| WIO-9978 | TRANSFER: Payroll Account | Main | Internal Transfer | 2026-05-15 | AED 52,000 |
| WIO-P001 | PAYROLL: Team Disbursement | Payroll | Payroll | 2026-05-15 | AED 52,000 |
| WIO-9977 | INCOMING: DEWA Digital | Main | Invoice Payment | 2026-05-14 | +AED 19,687 |
| WIO-9976 | PAYMENT: JLT Office Lease | Main | Rent | 2026-05-13 | AED 12,000 |
| WIO-9975 | INCOMING: Majid Al Futtaim | Main | Invoice Payment | 2026-05-12 | +AED 36,750 |
| WIO-S001 | TRANSFER TO: Savings Account | Savings | Internal Transfer | 2026-05-10 | +AED 5,000 |

**Bank-transaction categories seen:** `Invoice Payment`, `SaaS`, `Internal Transfer`, `Payroll`,
`Rent`. **Account names:** `Main`, `Payroll`, `Savings`.

### `Wio Integration Settings` — the settings card, all four fields
| Field label | Control | Value / options |
|---|---|---|
| `API Connection` | read-only, pulsing green dot | `Connected – Wio Business API v2.1` |
| **`Sync Frequency`** | **a real `<select>`** | **`Every 2 hours (recommended)` (selected) · `Every 6 hours` · `Daily` · `Real-time (premium)`** |
| `Auto-Reconciliation` | a toggle labelled `Auto-match transactions` | shown **ON** |
| `Notification Alerts` | a toggle labelled `Large transaction alerts (> AED 50k)` | shown **ON** |

Both toggles are drawn as switches with a `cursor: pointer`, but they are **plain elements with no
checkbox and no state behind them** — they can only ever look ON. The `<select>` is a genuine
dropdown; I read its four options and changed nothing.

### The two buttons I did not press
- **`Sync Now`** — pulls the bank feed. A run/refresh against a live-looking bank connection; out
  of bounds for a look-only pass.
- **`Statement`** — sits where a download would; not pressed, in keeping with "export nothing".

**Realtime/auto:** the screen claims a 2-hourly sync; nothing moved while I watched.
**Empty state:** not observable.

⚠️ Read this screen together with the Overview, which says the bank balance is **`PHASE 2` /
`awaiting bank feed`** and shows `—`. See §22.6.

---

## 13. Reports & Tax → **Profitability** — `/finance/profitability`

**Where:** sidebar → Finance → **Reports & Tax** (the label's own destination), or → Reports & Tax →
`PROFITABILITY`. H1: **Profitability**, sub-line `Revenue, expenses, and margin analysis · FY 2026`,
and a green pill `YoY Growth: +23.4%`.

**What you see on arrival:** title and pill; four tiles; two charts side by side; a
`Profitability by Service` card; a `Profitability by Client` table. **No toolbar at all** — no entity
switcher, no dates, no export, no search, no period selector anywhere. The reporting window is
fixed at FY 2026.

### The four tiles — each with a year-on-year comparison line
| Label | Value | Comparison line |
|---|---|---|
| `Total Revenue (7M)` | AED 1205k | `+23.4% vs same period last year` |
| `Total Expenses (7M)` | AED 679k | `+15.1% vs same period last year` |
| `Gross Profit (7M)` | AED 526k | `+31.2% vs same period last year` |
| `Avg Profit Margin` | 43.7% | `+2.8pp vs same period last year` |

### The two charts
1. **`Monthly Profit Trend`** — sub-line `Revenue, expenses & net profit · Nov 2025 – May 2026`;
   x-axis `Nov Dec Jan Feb Mar Apr May`; y-axis `0k 60k 120k 180k 240k`. Three series.
2. **`Net Margin Trend (%)`** — sub-line `Monthly profit margin progression`; same x-axis; y-axis
   `30% 37% 44% 55%`.

### `Profitability by Service` — six services, each with profit and margin
| Service | Profit | Margin |
|---|---|---|
| Web Development | AED 231k | 47.5% |
| Mobile Apps | AED 162k | 51.9% |
| UI/UX Design | AED 113k | 59.8% |
| Branding | AED 58k | 61.7% |
| Digital Marketing | AED 28k | 41.2% |
| Consulting | AED 27k | 64.3% |

### `Profitability by Client`
Sub-line `Top clients by gross profit contribution`. Above the table, a **three-way segmented
switch: `Profit` (selected by default) · `Revenue` · `Margin`.**
Columns: `CLIENT` · `REVENUE` · `COST` · `PROFIT` · `MARGIN` · `CONTRIBUTION`. The client cell is
numbered `1`–`8`; the CONTRIBUTION cell is a horizontal bar, widest at the top.

| # | Client | Revenue | Cost | Profit | Margin |
|---|---|---|---|---|---|
| 1 | ADNOC Group | AED 266,200 | AED 108,000 | AED 158,200 | 59.4% |
| 2 | Emaar Properties | AED 247,000 | AED 102,000 | AED 145,000 | 58.7% |
| 3 | Al Futtaim Group | AED 183,500 | AED 72,000 | AED 111,500 | 60.7% |
| 4 | First Abu Dhabi Bank | AED 80,400 | AED 38,000 | AED 42,400 | 52.7% |
| 5 | DP World | AED 84,500 | AED 48,000 | AED 36,500 | 43.2% |
| 6 | Aldar Properties | AED 52,000 | AED 26,000 | AED 26,000 | 50% |
| 7 | Abu Dhabi Tourism | AED 44,000 | AED 28,000 | AED 16,000 | 36.4% |
| 8 | Etihad Airways | AED 27,800 | AED 19,000 | AED 8,800 | 31.7% |

**What the switch does:** the sky-blue highlight moves to whichever of the three you press, and
**nothing else changes** — the rows keep the same order, the columns are the same, and the
contribution bars keep exactly the same widths (100%, 91.66%, 70.48%, 26.80%…). Measured before and
after each press. See §22.5.

**Tax output on this screen: none.** Despite the group being called "Reports & Tax", the
profitability screen produces no tax figure and no filing; tax lives on the VAT, TDS and Corporate
Tax screens.
**Exports: none — there is no export control on this screen at all.**
**Empty state / realtime:** neither observable; the data is fixed demo content.

---

## 14. Reports & Tax → **VAT Filing** — `/finance/vat`

**Where:** sidebar → Finance → Reports & Tax → `VAT FILING`. H1: **VAT Filing**, sub-line
`UAE FTA compliance · 5% standard rate · Quarterly returns`, and a green pill
**`FTA Registered · TRN-100485921400003`**.

FTA = the UAE Federal Tax Authority; TRN = the Tax Registration Number.

**Controls:** top-right **`Export VAT Return`**, then **two tabs** — `Current Period` (default) and
`Filing History`.

### Tab 1 · `Current Period`
A banner card: label `CURRENT FILING PERIOD`, then **`Q2 2026 (Apr–Jun)`**, then
`Due: 2026-07-28 · -41 days remaining` and a status pill **`In Progress`**.
(The days-remaining number is negative because the due date has passed.)

Three tiles:

| Label | Value | Small line |
|---|---|---|
| `Output VAT (Sales)` | AED 15,290 | `5% on taxable supplies` |
| `Input VAT (Purchases)` | AED 4,960 | `5% on business expenses` |
| `Net VAT Payable` | AED 10,330 | `Payable to FTA` |

**Chart:** `Monthly VAT Breakdown – Q2 2026`, sub-line `Output vs. Input VAT per month`, x-axis
`Apr May Jun`, y-axis `0 2,000 4,000 6,000 8,000`.

Then **two itemised lists side by side, each tagged with its FTA box number** — this is the actual
return working:

**`Output VAT`** — sub-line `6 taxable sales · AED 15,290`, tagged **`Box 1`**:

| Item | Line under it | VAT |
|---|---|---|
| Invoice #INV-0091 – Al Futtaim Group | 2026-05-05 · Net: AED 48,500 | +AED 2,425 |
| Invoice #INV-0090 – Emaar Properties | 2026-05-01 · Net: AED 72,000 | +AED 3,600 |
| Invoice #INV-0089 – DEWA Digital | 2026-04-28 · Net: AED 18,750 | +AED 937.5 |
| Invoice #INV-0088 – Majid Al Futtaim | 2026-04-20 · Net: AED 35,000 | +AED 1,750 |
| Invoice #INV-0087 – ADNOC Group | 2026-05-10 · Net: AED 61,200 | +AED 3,060 |
| Invoice #INV-0086 – DP World | 2026-05-18 · Net: AED 29,500 | +AED 1,475 |
| **Total Output VAT** | | **AED 15,290** |

**`Input VAT (Reclaimable)`** — sub-line `5 business expenses · AED 4,960`, tagged **`Box 9`**:

| Item | Line under it | VAT |
|---|---|---|
| AWS Cloud Services – Monthly | 2026-05-18 · Net: AED 3,200 | -AED 160 |
| Google Ads – Campaign Spend | 2026-05-11 · Net: AED 8,400 | -AED 420 |
| Figma Enterprise License | 2026-05-09 · Net: AED 2,400 | -AED 120 |
| Slack Business Plan | 2026-05-05 · Net: AED 850 | -AED 42.5 |
| Office Supplies – Staples | 2026-04-22 · Net: AED 640 | -AED 32 |
| **Total Input VAT** | | **AED 4,960** |

A closing card spells out the sum: **`Net VAT Payable to FTA`**,
`Output VAT – Input VAT = AED 15,290 – AED 4,960`, **`AED 10,330`**, `Due by 2026-07-28`.

### Tab 2 · `Filing History`
Card heading `Filing History`, sub-line `All submitted VAT returns`.
Columns: `PERIOD` · `DUE DATE` · `OUTPUT VAT` · `INPUT VAT` · `NET PAYABLE` · `STATUS` · `ACTIONS`.

| Period | Due date | Output VAT | Input VAT | Net payable | Status | Actions |
|---|---|---|---|---|---|---|
| Q1 2026 (Jan–Mar) | 2026-04-28 | AED 18,450 | AED 6,200 | AED 12,250 | `Filed` | a **download** icon |
| Q4 2025 (Oct–Dec) | 2026-01-28 | AED 15,800 | AED 5,400 | AED 10,400 | `Filed` | a **download** icon |
| Q3 2025 (Jul–Sep) | 2025-10-28 | AED 12,300 | AED 4,100 | AED 8,200 | `Filed` | a **download** icon |

**Return statuses seen:** `In Progress` (the current one) and `Filed` (the history). The download
icon per row is the filed return; not pressed.

### What tax output it produces
A **UAE FTA quarterly VAT return**, laid out the way the FTA form is: output VAT as **Box 1**, input
VAT as **Box 9**, net payable = Box 1 − Box 9, against a fixed 5% rate and a quarterly cycle with a
28-day-after-quarter-end due date. **`Export VAT Return`** is the only export control — and it opens
no menu and does nothing when pressed (§22.4), so there is no format choice to record here.

---

## 15. Reports & Tax → **TDS Credits** — `/finance/tds`

**Where:** sidebar → Finance → Reports & Tax → `TDS CREDITS`. H1: **TDS Credits**, sub-line
`Tax withheld at source by clients · claim back at year end · reconcile against Form 26AS`.

TDS = India's Tax Deducted at Source; Form 26AS is the Indian tax-credit statement. So this is the
India-side counterpart to the UAE VAT screen.

**Controls:** two buttons render, **`Refresh`** and **`Export ledger`**, plus one empty `<select>`
(a dropdown with **zero options** — presumably a year or client picker with nothing to put in it).

**Then, in place of the ledger, one plain line:**
> **TDS records are visible to admins only.**

So: the screen exists, its purpose is stated on it, and its contents are admin-only for this
account. **Not captured:** the TDS ledger's columns, the picker's options, and what `Export ledger`
offers. Recorded and moved on.

---

## 16. Reports & Tax → **Corporate Tax** — `/finance/corporate-tax`

**Where:** sidebar → Finance → Reports & Tax → `CORPORATE TAX`. H1: **Corporate Tax Filing**,
sub-line `UAE CT Law · 9% above AED 375k · FY 2026`, and a green pill `CT Registered`.

**Controls:** top-right **`Export CT Computation`**; **three tabs** — `Tax Computation` (default),
`Quarterly Provisions`, `Disallowances`.

### Above the tabs — always visible
**`FILING TIMELINE – FY 2026`** — a four-step tracker:

| Step | Name | Value |
|---|---|---|
| 1 | `Financial Year End` | Dec 31, 2026 |
| *(ticked)* | `CT Registration` | `Registered – TRN-CT-100485921` |
| 3 | `Prepare & Submit CT Return` | Sep 30, 2027 |
| 4 | `Tax Payment Due` | Sep 30, 2027 |

(Step 2 shows a tick instead of a number because registration is done.)

Then four tiles:

| Label | Value |
|---|---|
| `Total Revenue` | AED 1,205,400 |
| `Adjusted Taxable Income` | AED 501,400 |
| `Estimated CT Payable` | AED 11,376 |
| `Effective Tax Rate` | 2.27% |

### Tab 1 · `Tax Computation`
Card `CT Computation – FY 2026` — a proper computation ladder, line by line:

| Line | Amount |
|---|---|
| Accounting Profit | AED 526,200 |
| Add: Non-deductible expenses | AED 24,800 |
| Less: Tax depreciation allowance | (AED 3,200) |
| Less: Exempt income | AED 0 |
| Less: Prior year losses c/f | AED 0 |
| **= Taxable Income** | **AED 501,400** |
| Zero-rate band (0% on first AED 375,000) | (AED 375,000) |
| Taxable Income above threshold | AED 126,400 |
| CT @ 9% | AED 11,376 |
| Less: Qualifying Free Zone relief | AED 0 |
| **= UAE CT Payable** | **AED 11,376** |

### Tab 2 · `Quarterly Provisions`
Card `Quarterly Tax Provisions`, with a bar chart (x-axis `Q1 2026`, `Q2 2026`, `Q3 2026 (est.)`,
`Q4 2026 (est.)`; y-axis `0 3,000 6,000 9,000 12,000`) and a table.
Columns: `QUARTER` · `TAXABLE INCOME` · `PROVISION` · `CUMULATIVE`.

| Quarter | Taxable income | Provision | Cumulative |
|---|---|---|---|
| Q1 2026 | AED 115,000 | AED 0 | AED 0 |
| Q2 2026 | AED 138,000 | AED 0 | AED 0 |
| Q3 2026 (est.) | AED 128,000 | AED 11,520 | AED 11,520 |
| Q4 2026 (est.) | AED 120,000 | AED 10,800 | AED 22,320 |

(The first two quarters provision nothing because the AED 375,000 zero-rate band has not been used
up yet; `(est.)` marks the forecast quarters.)

### Tab 3 · `Disallowances`
Card `Disallowed Expenses & Add-backs`, sub-line
`Items added back to accounting profit under UAE CT law`.
Columns: `ITEM` · `REASON` · `AMOUNT`.

| Item | Reason | Amount |
|---|---|---|
| Client entertainment | 50% deductible cap exceeded | AED 8,400 |
| Non-business meal expenses | Personal nature | AED 3,200 |
| Penalties & fines | Non-deductible per CT law | AED 1,200 |
| Depreciation (accounting) | Add back accounting dep. | AED 8,800 |
| Tax depreciation allowance | Capital allowances per CT rules | AED 3,200 |
| **Total Disallowances** | | **AED 24,800** |

### What tax output it produces
A **UAE Corporate Tax computation for the financial year** — accounting profit adjusted to taxable
income, the AED 375,000 zero-rate band applied, 9% on the rest, plus a quarterly provisioning
schedule and the add-back working that supports the "non-deductible expenses" line. It is a
computation and a schedule, **not** a submission form. `Export CT Computation` offers no format
choice and does nothing when pressed (§22.4).

---

## 17. Reports & Tax → **Fixed Assets** — `/finance/fixed-assets`

**Where:** sidebar → Finance → Reports & Tax → `FIXED ASSETS`. H1: **Fixed Assets**, sub-line
`Asset register · Straight-line depreciation · 9 active assets`.

**Controls:** top-right **`Export Register`** and **`Add Asset`**; below, six category chips. No
entity switcher, no dates, no search box.

### The four tiles
| Label | Value |
|---|---|
| `Total Asset Cost` | AED 251,300 |
| `Accumulated Depreciation` | AED 108,374 |
| `Net Book Value` | AED 142,926 |
| `Monthly Dep. Charge` | AED 4,001 |

**Chart:** `Monthly Depreciation Charge – 2026`, sub-line
`Straight-line method · AED 4,001 / month`, x-axis `Jan Feb Mar Apr May Jun`, y-axis
`0 2,500 5,000 7,500 10,000`.

### The table
Columns: `ASSET` · `CATEGORY` · `PURCHASE DATE` · `COST` · `ACC. DEP.` · `NET BOOK VALUE` · `LIFE` ·
`ACTIONS`. The ASSET cell is two lines — the name, then **`<asset code> · <location>`**. `LIFE` is
the useful life in years. All 9 rows:

| Asset | Code · location | Category | Purchased | Cost | Acc. dep. | Net book value | Life |
|---|---|---|---|---|---|---|---|
| MacBook Pro 16" M3 Max (x4) | FA-001 · JLT Office | IT Equipment | 2024-01-15 | AED 32,000 | AED 10,667 | AED 21,333 | 5y |
| Dell 4K Monitors (x8) | FA-002 · JLT Office | IT Equipment | 2024-01-15 | AED 12,800 | AED 4,267 | AED 8,533 | 5y |
| Adobe Creative Cloud (Annual) | FA-003 · Cloud | Software | 2025-03-01 | AED 18,000 | AED 5,000 | AED 13,000 | 3y |
| Figma Organization Plan | FA-004 · Cloud | Software | 2025-04-01 | AED 8,400 | AED 2,333 | AED 6,067 | 3y |
| Office Furniture – JLT Suite | FA-005 · JLT Office | Furniture | 2023-09-01 | AED 45,000 | AED 13,500 | AED 31,500 | 10y |
| Server Rack + NAS Storage | FA-006 · Server Room | IT Equipment | 2023-06-15 | AED 22,000 | AED 9,143 | AED 12,857 | 7y |
| Epson Large Format Printer | FA-007 · JLT Office | Equipment | 2023-02-10 | AED 8,500 | AED 4,464 | AED 4,036 | 7y |
| Toyota Camry (Company Car) | FA-008 · Dubai | Vehicles | 2022-11-01 | AED 95,000 | AED 57,000 | AED 38,000 | 5y |
| iPad Pro 12.9" (x3) | FA-009 · Field | IT Equipment | 2024-06-01 | AED 9,600 | AED 2,000 | AED 7,600 | 4y |

**Locations seen:** JLT Office, Cloud, Server Room, Dubai, Field.

**Row actions — two icon buttons on every row:** an **eye** (view the asset) and a **pen**
(edit the asset). Neither pressed.

**Category chips — all six, with counts:** `All` (9) · `IT Equipment` (4) · `Software` (2) ·
`Furniture` (1) · `Vehicles` (1) · `Equipment` (1). Exact-match filtering — `Equipment` does not
pick up `IT Equipment`.

**`Export Register` and `Add Asset`** both render, both enabled, and **both do nothing when
pressed** — no menu, no dialog, no download (§22.4). So the add-asset form could not be captured
because it does not open.

**Empty state:** every category has at least one asset; not observable.

---

## 18. AI & Tools → **Finance Inbox** — `/finance/inbox`

**Where:** sidebar → Finance → **AI & Tools** (the label's own destination), or → AI & Tools →
`FINANCE INBOX`. H1: **Finance Inbox**, sub-line
`Centralised document intake · Auto-categorisation`, and an amber pill
**`1 documents need review`**.

**What it receives, and how:** **bills, receipts, invoices and contracts, and they arrive by
email** — every document card shows a **`From:` email address**, and the addresses are the vendors'
own billing senders (`aws-invoices@amazon.com`, `billing@google.com`, `receipts@slack.com`,
`accounts@jlt-tower.ae`, `billing@figma.com`, `finance@dpworld.ae`) plus one internal expense-tool
sender (`navan@nexeor.agency`) and one stranger (`unknown@domain.ae`). So the intake model is a
**mailbox the agency's suppliers send to**, plus a manual upload path.

**Is there a forwarding address shown?** **No.** Nothing on the screen displays the inbox's own
email address — you can see what arrived and who sent it, but not where to forward to. Whatever sets
that up is not on this screen.

**What you see on arrival:** title and pill top-left, **`Upload Document`** top-right. Four tiles.
A dashed **drop zone**. Then a search box, five filter chips, and the document cards in one column.

### The four tiles
| Label | Value |
|---|---|
| `Total Documents` | 8 |
| `Pending Review` | 1 |
| `Categorised` | 5 |
| `Rejected` | 1 |

(8 = 1 pending + 5 categorised + 1 rejected + 1 processing; `Processing` has no tile.)

### The drop zone
Dashed box, centred, reading **`Drop files here to upload`**, then the line
**`PDF, JPG, PNG · Invoices, bills, receipts, contracts`**, then a **`Browse files`** button.
That line is the stated accepted-format list.

### The filter chips — five
`All` (8 cards) · `Pending Review` (1) · `Processing` (1) · `Categorised` (5) · `Rejected` (1).

### The document cards — and what the AI claims to extract
Every card shows the filename, `From: <sender>`, and `<date time> · <file size>`. A card that has
been through the AI **also shows four extracted values**, and this is the answer to "what does the AI
fill in":

1. **the expense category** (as a coloured tag)
2. **`Vendor: <name>`**
3. **the amount**
4. **`VAT: <amount>`**

All eight documents, exactly as they read:

| File | From | Received · size | Category | Vendor | Amount | VAT | State |
|---|---|---|---|---|---|---|---|
| AWS_Invoice_May2026.pdf | aws-invoices@amazon.com | 2026-05-19 14:22 · 142 KB | **Vendor Bill** | Amazon Web Services | AED 3,200 | AED 160 | `Categorised` |
| JLT_Lease_May2026.pdf | accounts@jlt-tower.ae | 2026-05-18 09:41 · 280 KB | **Rent** | JLT Tower Properties | AED 12,000 | AED 0 | `Categorised` |
| Receipt_Lunch_Team.jpg | navan@nexeor.agency | 2026-05-17 13:05 · 1.2 MB | — | — | — | — | **`Pending Review`** + a `Review` button |
| GoogleAds_Statement_May.pdf | billing@google.com | 2026-05-16 08:00 · 198 KB | **Marketing Expense** | Google Ads | AED 8,400 | AED 420 | `Categorised` |
| DP_World_PO_0091.pdf | finance@dpworld.ae | 2026-05-16 11:30 · 320 KB | — | — | — | — | **`Processing`** |
| Slack_Invoice_May.pdf | receipts@slack.com | 2026-05-14 07:12 · 88 KB | **SaaS Expense** | Slack Technologies | AED 850 | AED 42.50 | `Categorised` |
| Unknown_Document.pdf | unknown@domain.ae | 2026-05-13 16:44 · 450 KB | — | — | — | — | **`Rejected`** |
| Figma_Annual_Invoice.pdf | billing@figma.com | 2026-05-12 10:00 · 115 KB | **SaaS Expense** | Figma Inc. | AED 2,400 | AED 120 | `Categorised` |

**The four states a document moves through:** `Processing` (the AI is reading it) → `Pending Review`
(the AI could not decide — a human must categorise it) → `Categorised` (done) or `Rejected`
(thrown out). The one photo of a lunch receipt is the one sitting in Pending Review, and the one
from an unknown sender is the one Rejected — which is exactly the shape of the flow.

**Every card also carries an `eye` icon button** (view the document). Pressing it does nothing —
no preview, no dialog, no new tab.

### The one dialog on this screen — `Review Document`
Pressing **`Review`** on a Pending Review card opens a centred modal. This is the confirm/reject
step:

```
Review Document                                                    ×
Receipt_Lunch_Team.jpg
navan@nexeor.agency · 2026-05-17 13:05

Assign Category
[ Vendor Bill ] [ Client Invoice ] [ Rent ] [ Payroll ]
[ Marketing Expense ] [ SaaS Expense ] [ Travel ] [ Other ]

                                                              [ Reject ]
```

- **The categories are the whole form. There are no input fields at all** — no amount box, no VAT
  box, no vendor box, no date, no notes. One label, `Assign Category`, then **eight category
  buttons**, and a `Reject`.
- **The complete category list, all eight:** **`Vendor Bill`** · **`Client Invoice`** · **`Rent`** ·
  **`Payroll`** · **`Marketing Expense`** · **`SaaS Expense`** · **`Travel`** · **`Other`**.
  (Five of those eight are also seen live as tags on the categorised cards, which confirms this is
  the same list the AI picks from.)
- **Buttons on the dialog:** the eight categories, `Reject`, and a `×` close. Pressing a category
  files the document and pressing Reject bins it — **neither was pressed.** I closed with Escape.
- So the confirm step is **one click**: pick the category, or reject. The amount and VAT the AI
  extracted are not editable anywhere I could find.

### The upload path
**`Upload Document`** (top right) and **`Browse files`** (in the drop zone) both render and are
both enabled — and **neither opens a file picker, a dialog or anything else.** There is no
`<input type="file">` anywhere on the page. So **nothing was uploaded, and nothing could have
been**: the upload controls are not wired. The drop zone's dashed box is likewise inert as far as
clicking goes.

**Empty state:** searching for something with no match **shows nothing at all** — the card list
simply disappears, with no "no documents" message, while the four tiles keep counting all 8.
**Realtime/auto:** nothing moves; the `Processing` card stayed `Processing` throughout.

---

## 19. AI & Tools → **AI Bookkeeper** — `/finance/ai-assistant`

**Where:** sidebar → Finance → AI & Tools → `AI BOOKKEEPER`, or the `AI Bookkeeper` tile / `AI Chat`
chip on the Overview. H1: **AI Bookkeeper** with a **`Beta`** badge, sub-line
`Reads your live Nexeor finance data · UAE tax-aware`.

**What you see on arrival:** a chat screen. Top-left a back arrow → `/finance`. A green
`Connected to live data` strip carrying five live figures. The assistant's opening message. Six
big suggestion cards. Then, pinned to the bottom, five small chips, the text box, and a send
button. A disclaimer under it.

### The `Connected to live data` strip — five figures
`Bank: AED 342,810` · `Receivables: AED 184,750` · `Payables: AED 67,300` · `VAT Due: Jul 28` ·
`Sync: 2h ago`

### The opening message, word for word
> Hi! I'm your AI Bookkeeper for Nexeor Agency OS. I have access to your live financial data
> including invoices, payroll, bank balances, VAT position, and cash flow.
>
> What would you like to explore today?

### The six suggestion cards — the full list
1. **`Summarise this month's finances`**
2. **`Which expenses are deductible for CT?`**
3. **`Draft payroll journal entries for May`**
4. **`What's our 30-day cash flow forecast?`**
5. **`Which invoices are overdue?`**
6. **`What's our VAT liability for Q2?`**

### The five quick chips above the box — the full list
`Monthly summary` · `Overdue invoices` · `VAT position` · `Cash forecast` · `CT deductibles`

### Controls
1. **Back arrow** (top-left) → `/finance`.
2. **A refresh-style icon button titled `Clear chat`** (top-right of the chat card).
3. **The six suggestion cards** and **the five chips** — each one puts that question in and asks it.
4. **The text box** — placeholder `Ask anything about your finances…`, no length limit set.
5. **The send button** — a paper-plane icon on a violet gradient, **disabled while the box is
   empty**.

**Nothing was asked.** Sending a message is a send, and it would also spend the product's own AI
budget on someone else's staging account. Every prompt the screen offers is written down above
instead.

**The disclaimer at the bottom, word for word:**
> AI responses are generated from your live finance data. Always verify before submitting official
> filings.

**Empty state:** the opening message *is* the empty state.
**Realtime/auto:** nothing moves on its own.

---

## 20. How an invoice here connects back to a project or a CRM lead

Plainly: **it connects to a CRM lead, and it does not connect to a project at all.**

- **The "client" in Finance *is* a CRM lead.** Every receivables row, every client-ledger account
  and every recent-receipt card is stamped with a CRM **lead id**, and the name shown is the lead's
  name (which is why the demo data reads `Stave Corp IN_PROGRESS - 3` — the lead's pipeline stage is
  baked into its name). There is no separate customer record in between.
- **A receivable is a payment milestone on that lead**, not an invoice. Each row carries the
  milestone's own name (`Milestone 1 - Advance`, `MONTHLY Retainer`, `Full Payment`), its amount, its
  own currency, its due date, and — **only sometimes** — an invoice attached to it. **Only 10 of 47
  rows have one.** So in this product **the milestone comes first and the invoice is raised against
  it afterwards**, which is exactly why 37 rows say `No invoice`.
- **Following the link:** the finance screens themselves expose **no clickable link back to the
  lead** — the client cell on Receivables is plain text and the row is not clickable. The app's own
  deep-link shape for a lead is **`/crm?leadId=<the lead id>`** (it is what the Sales →
  Payment Calendar uses on its payment cards), and taking a finance row's lead id to that address
  **lands on the CRM pipeline board at `/crm?leadId=…`** — the Kanban board with the stage columns,
  where that lead's detail then opens. The Overview's receipt cards *carry* the lead id but throw it
  away, linking to the plain `/finance/receivables` list instead.
- **Projects: no connection anywhere.** Nothing in this group's data or on any of its 18 screens
  references a project, a project id, or the Web Projects module. The only cross-module links in the
  whole Finance group are the two into HR from the Payroll screen (`Manage in HR Payroll` →
  `/hr/payroll`, and every row's `View in HR` → `/hr/payroll/<pay-run id>`).
- **The invoice itself has nowhere else to live:** there is no per-invoice page
  (`/finance/invoices/<id>` is a 404), so the only invoice view in this whole group is the small
  read-only modal on Receivables (§4).

---

## 21. Currency — exactly how AED and INR are mixed

This matters enough to state on its own, because the product genuinely runs two currencies at once.

1. **Two legal entities, one currency each:** Nexeor India in **INR**, Nexeor UAE in **AED**. UAE is
   the default and **AED is the app's default display currency** (the Overview even labels itself
   `Nexeor Agency OS · AED`).
2. **Each record keeps its OWN currency** and, alongside it, **an AED-converted value.** Of the 47
   receivables rows, **36 are AED and 11 are INR** natively.
3. **`Consolidated` shows everything converted to AED.** So an INR milestone of ₹23,632 appears on
   the consolidated list as **AED 918**.
4. **`Nexeor India (INR)` shows only INR records, in INR** — the tiles change unit as well as value
   (`INR 483,595`). **`Nexeor UAE (AED)` shows only AED records.** Nothing is converted inside a
   single-entity view.
5. **Paperwork changes with the entity, not just the currency:** the invoice prefix
   (**`NXIN`** vs **`NXRU`**), the tax label (**`GST (18%)`** vs **`VAT`** at 0%), the label for the
   customer's tax number (**`GSTIN`** vs **`TRN`**), the registration numbers printed
   (GSTIN/CIN/PAN vs none) and the bank block attached (an INR Axis Bank block vs a UAE block that
   is still unfilled placeholder text).
6. **The tax screens are UAE-only.** VAT Filing and Corporate Tax are both UAE (FTA, 5%, 9% above
   AED 375k) with no entity switcher; the India side gets its own screen, TDS Credits, which this
   account cannot read.
7. ⚠️ The conversion is not applied consistently in one place — §22, first item.

---

## 22. Odd things I noticed

Recorded as I found them, in product language, and nothing was re-opened to poke at:

1. **An invoice preview can disagree with its own row.** Row `NXRU0012` on Receivables reads
   `Issued 2026-06-19`, `AMOUNT AED 918`, `OUTSTANDING AED 918`. Its `View` modal reads
   `Issued 2026-08-05`, `Subtotal AED 23,632`, `VAT AED 1,182`, `Total AED 24,814`,
   `Balance Due AED 24,814`. Reason: the milestone is an **INR** record (₹23,632 → AED 918 on the
   consolidated list) while the invoice raised against it stored the figure **23,632 labelled AED**.
   The row converts, the modal does not, and the invoice's stored currency does not match the
   milestone's. Same pattern on `NXRU0013` (row AED 797, modal total AED 837 — the modal adds VAT
   the row does not show).
2. **The `Sent` filter on Receivables can never show anything.** The chip filters the milestone
   status (only ever `paid` / `overdue`), while `Sent` is an invoice status — and 4 of the 10
   attached invoices genuinely are `SENT`. The chip reads
   `No receivables match your filters` regardless.
3. **A client ledger's `BALANCE` column never goes negative.** On Italica the running balance goes
   6,818 → 7,207 → **369** → 10,470 → 18,046 as invoices and payments alternate; the sign is
   dropped, so a client who is ahead looks like a client who owes. The `Balance Trend` chart beside
   it *does* draw below zero (its axis starts at `-8k`), so the chart and the column disagree. The
   header's `Balance Due: AED 18,045` is also one rupee/dirham off the last row's `AED 18,046`.
4. **Seven buttons across four screens do nothing at all.** `Export` and `Add Item` on Inventory,
   `Export Register` and `Add Asset` on Fixed Assets, `Export VAT Return` on VAT Filing,
   `Export CT Computation` on Corporate Tax, and both `Upload Document` and `Browse files` on the
   Finance Inbox. Each renders enabled, and pressing it produces no menu, no dialog, no navigation,
   no file and no browser-console error. (The `Export` on Receivables/Payables/Ledgers/Payroll, by
   contrast, works and opens its three-option menu.) Because of this, **the add-item, add-asset and
   upload flows have no form to capture.**
5. **The `Profit / Revenue / Margin` switch on Profitability changes only itself.** The highlight
   moves, and the table's order, columns and contribution-bar widths are byte-identical before and
   after (measured, not eyeballed).
6. **Overview and Wio Banking tell opposite stories about the bank feed.** The Overview shows
   `Bank Balance —`, a `PHASE 2` ribbon and the note "Bank Balance still needs a bank feed", while
   `/finance/banking` presents three `Live` accounts, an `AED 579,810` portfolio, a
   `Connected – Wio Business API v2.1` status and nine transactions. The banking screen's data is
   also fixed to May 2026 and does not move, so it reads as a designed preview of the integration
   rather than a live feed.
7. **The AI Bookkeeper's live-data strip does not match the live screens.** It says
   `Receivables: AED 184,750` and `Payables: AED 67,300`; Receivables itself says
   **AED 222,142** and the Overview says payables **AED 200,526**. Its `Bank: AED 342,810` matches
   the Wio "Main" account rather than the portfolio total.
8. **Which payroll month you land on is not stable.** With no dates set the screen showed
   `September 2026 · AED 199,784` on one load and `August 2026 · AED 10,232,222` on the next
   (switching entity to India and back also flips it). There is no month picker — the only period
   control is the date range — so the landing month is whatever the screen picks, and the two
   answers differ by fifty-fold.
9. **Reconciliation counts `0 manual` but offers no way to link one.** The three `Unmatched` bank
   rows carry no buttons; only already-matched rows get the confirm/unlink pair.
10. **The Overview's `View All` and `Invoices` buttons both lead to screens this account cannot
    open** (`/finance/cash-book`, `/finance/invoices`) — the tiles and shortcuts are not filtered by
    what the signed-in person may see.
11. **Small text slips:** the Inventory chart's x-axis renders `CloudServices` with no space; the
    Inbox pill reads `1 documents need review`; the VAT banner reads `-41 days remaining` for an
    overdue period.
12. **The Finance Inbox has an "arrived by email" model but never shows the address to forward to.**
13. **The two toggles in the Wio settings card cannot be turned off** — they are drawn as switches
    with a pointer cursor but have no checkbox or state behind them, so they will always read ON.

---

## 23. What I could not reach, and why

| Screen / thing | Why |
|---|---|
| **Cash Book** `/finance/cash-book` — the whole ledger, its columns, the entry categories, the add-entry form, the bank/account picker, reconciliation controls, running-balance behaviour | the screen answers this demo account with `Unauthorized` |
| **Invoices** `/finance/invoices` — the invoice list, its statuses and row actions, **and the create-invoice form in full** (line items, taxes, currency, payment terms, discounts, notes, number series) | same — `Unauthorized`. What could be pieced together from the other screens is in §7 |
| **Payables** `/finance/payables` — the bill list and the **`Add Bill`** form | header renders, body is `Unauthorized` |
| **Approvals** `/finance/approvals` — the queue, the approval threshold, the approve/reject controls | header renders, body is `Unauthorized` |
| **TDS Credits** `/finance/tds` — the ledger, the (empty) picker's options, what `Export ledger` offers | the screen states `TDS records are visible to admins only.` |
| Inventory's add-item form · Fixed Assets' add-asset form · the Inbox upload picker | the buttons are not wired — nothing opens (§22.4) |
| Anything behind `Confirm All Matches`, the per-row confirm/unlink icons, `Sync Now`, `Statement`, the per-row download on filed VAT returns, the `Review` dialog's eight categories and `Reject`, the export menus' three formats, and asking the AI Bookkeeper a question | **deliberately not activated** — each one writes, sends, syncs, files or exports. Every one is described above instead |

No other way in was attempted on any of the five withheld screens.

---

## In human language — every feature in this area, as points

- **A money home page** — one screen that answers "how is the business doing" in seven boxes: money
  earned, money owed to us, how many bills are late, money we owe, everything we owe in total, the
  bank balance, and a shortcut to the finance chatbot. Click Finance, then Overview. It is the page
  the boss opens first.
- **Every box on that home page is a door** — tapping the "money owed to us" box takes you straight
  to the list of who owes it. Nothing is a dead number.
- **A bar chart of money coming in, month by month** — the last seven months, and hovering a bar
  tells you that month's exact figure. On the Finance home page.
- **A "latest money received" list** — the last eight payments that landed, who paid, what for, and
  how much. On the Finance home page, right-hand side.
- **A five-part finance menu that opens out** — Finance splits into Accounting, Operations, Reports
  & Tax, and AI & Tools, and each of those opens to reveal its own screens underneath. Click the
  little arrow next to a name in the left menu.
- **Two companies in one system** — an Indian company and a UAE company. A switch on the money
  screens lets you see just the Indian side in rupees, just the UAE side in dirhams, or both
  together converted into dirhams. It is the same business, kept properly separate on paper.
- **Each company brings its own paperwork** — its own bill numbering, its own tax name and rate
  (18% GST in India, VAT in the UAE), its own company registration numbers and its own bank details
  to print on a bill. Set up behind the scenes; you just pick the company.
- **A "who owes us money" list** — every payment you are expecting, with what it is for, which
  client, when it was raised, when it is due, how much, how much is still unpaid, and whether it is
  paid or late. Finance → Accounting → Receivables. This is the chasing list.
- **A late-payment ageing breakdown** — how much of the money owed is fresh, 1–2 months old, 2–3
  months old, or older than three months, with a count for each. Same screen, near the top. It tells
  you how bad the problem is, not just how big.
- **Filter the owed list by state** — everything, sent, late, or paid, as four little buttons.
  (Heads up: the "sent" one comes back empty in practice.)
- **Search the owed list** by typing part of a name or number.
- **Filter any money list to a date range** — two date boxes and a "clear" link. On the owed list,
  the bills-we-owe list, the client statements and payroll.
- **Download any of those four lists three ways** — as a PDF on your company letterhead, as an
  Excel file, or as a plain CSV for a spreadsheet. Press Export and pick.
- **See a bill without leaving the list** — a small window with the bill number, the client, the
  dates, the lines on it, the running total, the tax, what has been paid and what is still due.
  Press View on a row. It is read-only: nothing on it can be sent, changed or deleted.
- **A statement per client** — pick a client from a list down the left and see every invoice and
  every payment they have ever made, in date order, with a running balance, plus their total
  invoiced, total received, and a line chart of their balance over time. Finance → Accounting →
  Client Ledgers. This is what you send a client who says "what do I actually owe you?".
- **The client list is sorted by who owes the most**, shows when they last did anything, how many
  entries they have, and marks anyone fully paid up with a green "Settled". Same screen, left side.
- **Show only invoices, only payments, or both** in a client statement — three tabs above the table.
- **Search your clients** by name in that same left-hand list.
- **A cash book** — the day-to-day record of money in and money out, page by page. Finance →
  Accounting. **This demo login cannot open it**; it answers "Unauthorized".
- **A bills-we-owe list with an "Add Bill" button** — for what the agency owes suppliers. Finance →
  Accounting → Payables. The heading, the company switch, the dates and the Export and Add Bill
  buttons all appear, but **this login cannot see the list itself**.
- **A spend-approval queue** — money going out waits for a yes. The screen states the rule: a leader
  approves first (a named person handles anything above a set size), then Accounts checks it and
  releases the payment. Finance → Operations → Approvals. **This login cannot see the queue.**
- **A stock and licence register** — what the agency owns to sell or hand out: software seats,
  laptops and tablets, cloud plans, printed material and pre-bought credits. Each with a product
  code, how many are left, what it cost, what you sell it for, the profit margin as a percentage,
  the total value, and whether stock is fine, low, or gone. Finance → Operations → Inventory.
- **A picture of where your stock value sits** — a bar per category with the total above it. Same
  screen.
- **A stock in-and-out history** — every time something was issued or received, the date, which
  item, why (to a client, bought in, or written off as damaged), how many, and how many were left
  after. Same screen, the "Stock Movements" tab.
- **Filter stock by kind** — all, software, hardware, cloud services, print media, or credits.
- **Search stock** by item name or product code.
- **A payroll read-out** — this month's pay run: everyone's name, job, basic pay, allowances,
  bonuses, deductions, take-home, and whether their pay is still waiting for approval, with a total
  at the bottom. Finance → Operations → Payroll. It is a window onto the HR module's pay run, not a
  place to pay anybody.
- **Two views of the wage bill** — a bar chart of recent pay runs, and a split of this month's wages
  by job title. Same screen.
- **Jump into HR to actually do payroll** — a "Manage in HR Payroll" link, plus a small icon on
  every row that opens the pay run in HR. Same screen.
- **Pick a different pay month** by typing a date range — the screen swaps to the pay run inside
  those dates and every figure follows.
- **Search for one person's pay** by name.
- **Bank matching, side by side** — the bank's transactions on the left, the agency's own invoices,
  bills and payroll entries on the right, with a confidence score on each pair (100% for an exact
  match, lower when the amounts differ) and the word "Unmatched" where the system found nothing.
  Finance → Operations → Reconciliation. This is the monthly tick-off.
- **A progress counter for that tick-off** — how many of the month's bank lines are confirmed, how
  many were matched automatically, how many by hand, and how many are still unmatched. Same screen,
  top and bottom.
- **Confirm one match, or break one** — a green tick and a red broken-link button on each matched
  row. Not pressed here, on purpose: both change the books.
- **Confirm every suggested match at once** — one button at the top right. Also not pressed.
- **A bank connection screen** — three business accounts (main, payroll, savings) with their
  balances, what is available to spend, what moved today and when each last synced, plus a combined
  total across all three and a chart of all three balances over the month. Finance → Operations →
  Wio Banking. The account numbers are shown with only the last four digits.
- **A list of recent bank transactions**, each labelled with what kind of money it was — an invoice
  payment, a software subscription, rent, wages, or a transfer between the agency's own accounts.
  Same screen, with a "show 3 more" link.
- **Choose how often the bank syncs** — every 2 hours, every 6 hours, once a day, or live (a paid
  extra). Same screen, bottom.
- **Two bank switches, shown on** — automatically match transactions, and alert us about any
  transaction over 50,000 dirhams. Same screen, bottom. (They display as on and cannot actually be
  turned off.)
- **A profit report** — money in, money out, profit and profit margin for the year so far, each with
  how much better or worse it is than the same point last year. Finance → Reports & Tax →
  Profitability.
- **Profit over time, two ways** — a monthly chart of income, costs and profit, and a second chart
  of the profit margin percentage month by month. Same screen.
- **Which of your services actually make money** — six services ranked by profit with each one's
  margin, so you can see that design earns a better margin than marketing. Same screen.
- **Which of your clients actually make money** — the top eight ranked by profit, with what they
  paid, what they cost, the profit, the margin and a bar showing their share. Same screen.
- **A UAE VAT return, worked out for you** — the tax you charged on sales, the tax you paid on
  purchases, and the difference you owe the tax authority, with the due date and how many days are
  left. Finance → Reports & Tax → VAT Filing.
- **Every line that makes up that VAT return** — each sale with its net amount and the tax on it,
  each expense with its net amount and the tax you can claim back, each list totalled and labelled
  with the tax authority's own box number. Same screen.
- **A record of VAT returns already filed** — each quarter, its due date, the tax charged, the tax
  reclaimed, the net paid, and a download for the filed return. Same screen, "Filing History" tab.
- **A month-by-month VAT chart** for the current quarter. Same screen.
- **An Indian tax-withheld register** — where clients have held back tax at source, to be claimed
  back at year end and checked against the Indian tax statement. Finance → Reports & Tax → TDS
  Credits. **The records themselves are admin-only**, and the screen says so.
- **A UAE corporate tax calculation** — starts at the accounting profit, adds back what the tax law
  will not allow, takes off allowances, applies the nil band on the first 375,000 dirhams, charges
  9% on the rest, and lands on the tax bill. Finance → Reports & Tax → Corporate Tax.
- **A tax filing calendar** — year end, whether you are registered, when the return must be
  submitted and when the money is due, as four dated steps. Same screen.
- **Quarterly tax set-asides** — how much to put aside each quarter, with the later quarters marked
  as estimates and a running total. Same screen, second tab.
- **The list of expenses the tax office will not accept** — client entertainment over the cap,
  personal meals, fines, and the depreciation swap — each with the reason and the amount, totalled.
  Same screen, third tab. This is the working that supports the tax bill.
- **An asset register** — the things the agency owns that lose value over time: laptops, monitors,
  furniture, a server rack, a printer, the company car, annual software plans. Each with a code,
  where it is, what it cost, how much value it has lost so far, what it is worth now, and how many
  years it is expected to last. Finance → Reports & Tax → Fixed Assets.
- **This year's monthly wear-and-tear charge**, as a figure and a chart, worked out in equal
  monthly amounts. Same screen.
- **Filter assets by kind** — all, IT equipment, software, furniture, vehicles, other equipment.
- **View or edit a single asset** — an eye and a pencil button on each row.
- **A document inbox that receives bills by email** — Amazon, Google, Slack, Figma, the landlord and
  clients send their paperwork in, and it lands here as a card showing who sent it, when, and how
  big the file is. Finance → AI & Tools → Finance Inbox.
- **The computer reads each document and fills in four things** — what kind of expense it is, the
  supplier's name, the amount, and the tax on it — so nobody types a bill in by hand.
- **A document moves through four states** — being read, waiting for a human, filed, or thrown out —
  and a counter at the top tells you how many are waiting for you.
- **Filter the inbox** by those states — all, waiting for review, being read, filed, rejected.
- **Search the inbox** by document name or sender.
- **A one-click review step** — when the computer cannot decide, you open the document and press one
  of eight buttons to file it: supplier bill, client invoice, rent, wages, marketing, software
  subscription, travel, or other. Or press Reject to bin it. That is the whole form — no typing.
- **A drop zone for uploading a document yourself** — it accepts PDFs and photos and says so. (On
  this staging site the upload buttons do not actually open a file chooser.)
- **A finance chatbot that reads your real numbers** — it shows your bank balance, what you are
  owed, what you owe, when VAT is due and when it last synced, then answers questions in plain
  language. Finance → AI & Tools → AI Bookkeeper.
- **Six ready-made questions to press** — summarise this month, which expenses are tax-deductible,
  draft the payroll bookkeeping entries, forecast the next 30 days of cash, which invoices are late,
  and what the VAT bill will be. Plus five one-word shortcuts along the bottom.
- **Type your own question** in the box, or **clear the conversation** and start again.
- **A warning under the chatbot** telling you to check its answers before you file anything
  official.
- **A money-owed figure that adds wages to supplier bills** — the "Total Owed" box on the Finance
  home page shows what the agency owes suppliers *plus* the wages it still has to pay, and spells
  out the two halves underneath.
- **Finance follows the sales pipeline, not projects** — the "client" on every money screen is a
  sales lead from the CRM, and each expected payment is a payment stage on that lead. An invoice is
  raised against a payment stage afterwards, which is why most expected payments have no invoice
  number yet.
- **Screens are locked per person, not per section** — this demo login can open the Finance section
  but five of its eighteen screens (the cash book, the invoice list, the bills-we-owe list, the
  approval queue and the Indian tax register) answer with a short refusal instead of their contents.
- **It works on a phone** — the left menu folds behind a hamburger button, the boxes restack, and
  wide tables slide sideways inside their own card rather than breaking the page.

---

*Captured by terminal N8, 2026-09-07. 18 screens opened · 14 with content · 5 withheld ·
2 dialogs opened and closed without saving · 14 option lists fully enumerated ·
0 records created, changed, sent, confirmed, exported, uploaded or deleted.*
