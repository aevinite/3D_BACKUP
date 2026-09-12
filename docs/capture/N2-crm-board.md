# N2 — CRM Board (the pipeline) — `/crm`

Product: **Nexeor Agency OS v2.0** · `https://os-staging.product.nexeor.com`
Captured 2026-09-07 by terminal N2, signed in as the demo account (`demo_om85i@demo.agency`).
Documentation only — nothing was saved, submitted, sent, deleted or dropped.

---

## CRM Board — `/crm`

**Where:** left sidebar → group **Sales** → **CRM Board**. It is the first item under Sales and
the app's busiest screen. Page title in the browser tab: `CRM Board | Agency OS`.

**What you see on arrival:**
- Top-left of the content area: heading **CRM** with the sub-line *"Pipeline board • drag & drop • lead details"*.
- Under that, a **two-row toolbar**: row 1 = `New`, `Upcoming`, a green money pill, a person
  picker, `Hot Leads`; row 2 = a search box, `Filter`, `Sort`.
- Below the toolbar, a **horizontally-scrolling row of 8 stage columns**, each 300px wide except
  the wide green "Won" column (700px). The whole row scrolls sideways; each column scrolls
  vertically inside itself.
- The page is dark-only (`#09090b`/`#18181b` cards). A footer line reads
  *"POWERED BY NEXEOR • COPYRIGHT © 2026 NEXEOR CREATIVE TECHNOLOGIES"*.
- A right-hand **lead drawer** (560px) is already in the page but transparent and click-through
  until a card is opened.

**Realtime/auto:** none. On arrival the page fires exactly seven calls
(`/api/settings/rbac`, `/api/crm/services-config`, `/api/crm/users`, `/api/twilio/balance`,
`/api/crm/board?limit=10`, `/api/users`, `/api/auth/session`) and then goes silent. Watched idle
for **90 seconds: zero further requests, no websocket**. Nothing on this screen moves on its own —
it refetches only when you change a filter, the person picker, the search box, or press *Show more*.
The only animated thing is the rose "stale leads" badge, which pulses.

**While it is loading:** the sidebar, the `CRM` heading and the toolbar render immediately, but the
person picker holds only *All Users* and *You (…)* until `/api/crm/users` lands, and the board area
is a set of **grey skeleton blocks** (empty rounded placeholders in a column shape) that fade in to
the real board (`transition-opacity duration-300`).

---

## 1. The stage columns — every stage, left to right

Nine pipeline stages live in **eight columns**, because the green "Won" column holds two of them
side by side. Live values as captured:

| # | Column | Count badge | Stale badge | Money total | Dot colour / tint |
|---|---|---|---|---|---|
| 1 | **LEAD** | 9 | 9 | AED 263,374 | slate dot, white tint |
| 2 | **QUALIFIED** | 10 | 10 | AED 349,445 | amber dot, amber tint |
| 3 | **PROPOSAL** | 5 | 5 | AED 187,419 | sky dot, sky tint |
| 4 | **NEGOTIATION** | 7 | — | AED 343,122 | violet dot, violet tint |
| 5 | **ON_HOLD** | 5 | — | AED 160,802 | zinc dot, grey tint |
| 6 | **IN_PROGRESS** | 13 | — | AED 246,282 *(10 of 13 loaded)* | blue dot, blue tint |
| 7 | **Won** → sub-column **Recurring** | 11 (whole column) | — | AED 143,580 (whole column); Recurring itself: **MRR AED 5,838**, **Total AED 10,202** | emerald dot, emerald tint |
| 7 | **Won** → sub-column **Closed** | — | — | AED 133,378 | circle-check icon |
| 8 | **LOST** | 5 | — | AED 165,069 | rose dot, rose tint |

- **The two numbers next to a stage name.** The first is a grey pill = how many leads are in that
  stage (`title="LEAD: 9 leads"`). The second, only present on some columns, is a **pulsing rose
  pill with an alert icon** = `title="9 Stale Leads"` — leads that have not been touched recently.
  Columns 4–8 showed no stale pill at all in this capture.
- **The money figure** on the right of each header is that column's total deal value, always shown
  converted to **AED**, in a small monospace font.
- **Last stage.** The right-most column is **LOST**. "Won" is not last — it sits between
  IN_PROGRESS and LOST, and it is the one column that is *won business*, split into **Recurring**
  (live retainers) and **Closed** (finished/collected work).
- **IN_PROGRESS header extra:** a small chevron button, `title="View upcoming payments breakdown"`,
  which slides open an **Upcoming Payments** panel inside the column: a total (`AED 89,894`), a
  **NEXT MILESTONES** list of 8 rows (lead name · milestone name · amount · `≈ AED …` when foreign ·
  `Overdue`).
- **Recurring sub-column header extra:** `MRR` and `Total` figures plus a chevron button,
  `title="View upcoming recurring payments"`, opening **Upcoming Recurring** (`AED 1,838`) with rows
  of lead · `MONTHLY Retainer` · amount · `≈ AED …` · next date (`Jun 21`, `Jun 22`).
- **Bottom of every ordinary column:** a dashed-outline **`+ New Deal`** button. The Won column has
  no New Deal button (you cannot create a lead straight into Won).
- **`Show more (10 of 13)`** appears on IN_PROGRESS only, because the board loads
  `?limit=10` cards per column. Pressing it loads the rest and the button disappears.

**Empty state of a stage:** when a filter or search empties a column, the column keeps its header
(name, `0` badge, `AED 0`) and the card area renders **literally nothing** — no illustration, no
"no leads here" wording — with only the dashed `+ New Deal` button beneath it.

---

## 2. The toolbar — every control, in order

### Row 1

1. **`New`** (blue pill, plus icon, plus a chevron on the right — the chevron is part of the same
   single button, there is no split menu). → opens the **Add New Lead** dialog (§3.1).
2. **`Upcoming`** (dollar icon) → opens the **Upcoming Cash Flow** dialog (§3.2).
3. **`$14.26`** — a green pill with a *phone-call* icon. It is a **`<div>` with `cursor: default`,
   not a button**: purely a read-out. It is the **calling credit balance**, fetched from
   `/api/twilio/balance`, printed with a `$` prefix. Clicking it does nothing.
4. **Person picker** (a native `<select>` with a user icon). Full option list, in order:
   `All Users` · `You (Little French House)` · `----------` (a disabled separator) · `Admin` ·
   `Amal Vijayakumar` · `Antra Agrawal` · `Chris george` · `Deep Sheth` · `Dhrumil Gadaria` ·
   `Emaad Sultan` · `Ganesh S N` · `Gokulakrishnan R` · `Info Nexeor` · `Kartik Kittad` ·
   `Kevin Norbert` · `Kingson Thomas` · `Mathangi Chandu` · `Megha M` · `Navaneeth B` ·
   `Rayan Patel` · `Rohit Vinod` · `Sandra KK` · `Swathikrishna U S` · `Syeda Umme Kulsum` ·
   `Test Demo` · `akhila kr` · `ritika` — **26 entries** (24 real people + *All Users* + *You*).
   **What picking one does:** the whole board is filtered to the leads that person owns, and every
   column count and money total is recalculated. Picking `Rayan Patel` left LEAD 1 / AED 6,000,
   QUALIFIED 1 / AED 2,000 and all six other columns at 0 / AED 0.
5. **`Hot Leads`** (flame icon, a toggle pill). Off = grey outline; **on = rose outline, rose
   background, rose text**. It keeps only **HIGH-priority** leads: the board went from 65 visible
   cards to 3 (LEAD 1, QUALIFIED 1, IN_PROGRESS 1; every other column 0). The grey total badge
   keeps showing the unfiltered stage count while the money total and the rose badge follow the
   filtered set.

### Row 2

6. **Search box** — `placeholder="Search leads..."`, magnifier icon. Types straight into the board:
   typing `italica` left one card, in IN_PROGRESS; a nonsense string emptied all eight columns.
7. **`Filter`** (sliders icon) → a command-palette popover (§3.3). Once a filter is on, the button
   label is replaced by **the number of active filters** (`1`).
8. **`Sort`** (up-down arrows icon) → a popover (§3.4). Once changed, the button label becomes the
   chosen sort (`Value Low → High`).
9. **Active-filter chip row** (only when a filter is on, below row 2): per filter a chip made of
   `[icon] Priority` · a small **`is` ▾** button · a **value ▾** button · an `✕` to drop that
   filter — followed by a **`Clear all`** button.

### Mobile (≤ md, checked at 390 × 844)

The eight columns collapse to **one at a time**, and a horizontal **stage tab strip** appears above
the board: `LEAD (9)` · `QUALIFIED (10)` · `PROPOSAL (5)` · `NEGOTIATION (7)` · `ON HOLD (5)` ·
`IN PROGRESS (10)` · `WON (11)` · `LOST (5)`. Tapping a tab shows that column full-width (350px)
and hides the other seven. `Filter` and `Sort` drop off the mobile toolbar; `New`, `Upcoming`, the
credit pill, the person picker and `Hot Leads` stay.

---

## 3. Every dialog the board opens

### 3.1 `Add New Lead (<Stage>)` — the create-lead form

Opened by the toolbar **`New`** button, or by a column's **`+ New Deal`**. The dialog title names
the stage it will land in: from the toolbar it is **`Add New Lead (Lead)`**; from the NEGOTIATION
column **`Add New Lead (Negotiation)`**; from LOST **`Add New Lead (Lost)`**. Header has an `✕`.

The body is three blocks:

**Top block (the deal itself)**
| Field | Type | Required marker | Default |
|---|---|---|---|
| Company Name | text, `placeholder="Company Name"` | none shown | empty |
| Currency | `<select>`, **166 options** | — | **AED** |
| Amount | number, `placeholder="0.00"` | none shown | empty |
| Priority | three buttons **`LOW` / `MED` / `HIG`** | — | (segmented, none pre-highlighted in the markup) |

Currency list, complete and in the app's own order — the five it puts first, then alphabetical:
`AED, USD, EUR, GBP, SAR,` then `AFN, ALL, AMD, ANG, AOA, ARS, AUD, AWG, AZN, BAM, BBD, BDT, BGN,
BHD, BIF, BMD, BND, BOB, BRL, BSD, BTN, BWP, BYN, BZD, CAD, CDF, CHF, CLF, CLP, CNH, CNY, COP, CRC,
CUP, CVE, CZK, DJF, DKK, DOP, DZD, EGP, ERN, ETB, FJD, FKP, FOK, GEL, GGP, GHS, GIP, GMD, GNF, GTQ,
GYD, HKD, HNL, HRK, HTG, HUF, IDR, ILS, IMP, INR, IQD, IRR, ISK, JEP, JMD, JOD, JPY, KES, KGS, KHR,
KID, KMF, KRW, KWD, KYD, KZT, LAK, LBP, LKR, LRD, LSL, LYD, MAD, MDL, MGA, MKD, MMK, MNT, MOP, MRU,
MUR, MVR, MWK, MXN, MYR, MZN, NAD, NGN, NIO, NOK, NPR, NZD, OMR, PAB, PEN, PGK, PHP, PKR, PLN, PYG,
QAR, RON, RSD, RUB, RWF, SBD, SCR, SDG, SEK, SGD, SHP, SLE, SLL, SOS, SRD, SSP, STN, SYP, SZL, THB,
TJS, TMT, TND, TOP, TRY, TTD, TVD, TWD, TZS, UAH, UGX, UYU, UZS, VES, VND, VUV, WST, XAF, XCD, XCG,
XDR, XOF, XPF, YER, ZAR, ZMW, ZWG, ZWL`.

**`POC Details`** (user icon) — six inputs, each with its own icon:
| Field | Type | Placeholder |
|---|---|---|
| Contact Person | text | `Contact Person` |
| Phone | a **country-code button `+971` ▾** + `type="tel"` input | `Phone Number` |
| Email Address | email | `Email Address` |
| Website URL | text | `Website URL` |
| City | text | `City` |
| Country | text | `Country` |

The **`+971` ▾ country picker** lists 54 countries with their dial codes, in this order:
United States (US) +1 · Canada (CA) +1 · United Kingdom (GB) +44 · United Arab Emirates (AE) +971 ·
India (IN) +91 · Australia (AU) +61 · Saudi Arabia (SA) +966 · Pakistan (PK) +92 · Egypt (EG) +20 ·
Germany (DE) +49 · France (FR) +33 · Italy (IT) +39 · Spain (ES) +34 · Brazil (BR) +55 ·
Mexico (MX) +52 · South Africa (ZA) +27 · Nigeria (NG) +234 · Japan (JP) +81 · China (CN) +86 ·
Singapore (SG) +65 · Malaysia (MY) +60 · Indonesia (ID) +62 · Philippines (PH) +63 ·
New Zealand (NZ) +64 · Ireland (IE) +353 · Netherlands (NL) +31 · Sweden (SE) +46 ·
Switzerland (CH) +41 · Turkey (TR) +90 · Russia (RU) +7 · Qatar (QA) +974 · Kuwait (KW) +965 ·
Oman (OM) +968 · Bahrain (BH) +973 · Jordan (JO) +962 · Lebanon (LB) +961 · Morocco (MA) +212 ·
Argentina (AR) +54 · Colombia (CO) +57 · Chile (CL) +56 · Peru (PE) +51 · South Korea (KR) +82 ·
Vietnam (VN) +84 · Thailand (TH) +66 · Bangladesh (BD) +880 · Sri Lanka (LK) +94 · Nepal (NP) +977 ·
Kenya (KE) +254 · Ghana (GH) +233 · Ecuador (EC) +593 · Bolivia (BO) +591 · Venezuela (VE) +58 ·
Uruguay (UY) +598 · Paraguay (PY) +595. Default **+971 (UAE)**.

**`Services`** (layers icon) — 11 icon toggle buttons, multi-choose:
`Website` (globe) · `Marketing` (megaphone) · `E-Commerce` (cart) · `Nexeor OX` (layers) ·
`Custom Dev` (code) · `SEO` (magnifier) · `Mobile App` (phone) · `Digital Partnership` (handshake) ·
`Branding` (palette) · `ERP` (database) · `Other` (layers).

**`Assign Team`** (briefcase icon) — 27 avatar+name toggle buttons, multi-choose:
Admin · Amal Vijayakumar · Antra Agrawal · Chris george · Deep Sheth · Dhrumil Gadaria ·
Emaad Sultan · Ganesh S N · Gokulakrishnan R · Info Nexeor · Kartik Kittad · Kevin Norbert ·
Kingson Thomas · Mathangi Chandu · Megha M · Navaneeth B · Rayan Patel · Rohit Vinod · Sandra KK ·
Swathikrishna U S · Syeda Umme Kulsum · Test Demo · abcd · akhila kr · ritika · work6 · xyz.
*(This list carries three extra names the toolbar picker does not show: `abcd`, `work6`, `xyz`.)*

**`Lead Source`** (hash icon) — a `<select>`, 9 options: `Contact Circle` (default, first) ·
`Referral` · `Meta Ads` · `Instagram` · `WhatsApp` · `Website Form` · `Cold Call` · `Imported` ·
`Linkedin`. A small **`+` glyph** sits in the top-right corner of the select box; it is a plain
`<div class="absolute right-1 top-1">` with no cursor and no title, and clicking it added no field —
it reads as decoration/dead affordance rather than an "add a source" control.

**`Internal Notes`** — a textarea, `placeholder="Context, requirements, etc..."`.

**Buttons on the dialog:** `Cancel` · **`Create & Add Another`** · **`Create Lead`**.
No field is marked required in the markup (no `required`, no asterisks). *Cancelled out.*

### 3.2 `Upcoming Cash Flow`

Opened by the toolbar **`Upcoming`**. Header + `✕`.

- **`TIMEFRAME`** — five buttons: `7 Days` · `10 Days` · **`1 Month`** (calendar icon; the one
  highlighted) · `2 Months` · **`Custom`**.
  Pressing **`Custom`** reveals an inline range picker inside the dialog: preset buttons
  `Today` · `7d` · `30d` · `This Mo` · `Last Mo`, plus a month calendar (`◀ Sep 2026 ▶`, Su–Sa
  header, day buttons including the greyed neighbouring-month days).
- **`Refresh`** button (refresh icon) and a warning chip **`⚠ 29 overdue`**.
- **`TOTAL EXPECTED`** tile — `AED 221,384`, sub-line `29 Pending Transactions`.
- **The list** — one row per expected payment: an icon (`file-text` for a one-off milestone,
  `refresh-cw` for a retainer cycle), the **lead name**, the **milestone/retainer name**, then a
  **clickable due-date button** (`title="Click to change the due date"`, shows `OVERDUE • 79d` with
  a pencil) and the amount (plus `≈ AED …` when the amount is in another currency).
  29 rows were present, sorted most-overdue first.
- **Clicking a due date** opens an **inline reschedule editor** in that row:
  `Due date` + `input type="date"` (pre-filled with the existing date) + quick buttons
  `Today` · `+7d` · `+14d` · `+1 mo` · `Month end`, a read-back line (`Sat, 20 Jun 2026`), a warning
  *"This date is in the past — it will show as overdue."*, and `Cancel` / `Save` (Save starts
  disabled until the date changes). *Cancelled out — no date was saved.*
- **Footer:** the hint *"Click any due date to reschedule it."* and a `Close` button.

### 3.3 `Filter` — the popover, and every option in it

A command-palette popover with a search box (`placeholder="Filter..."`) and 8 categories in two
groups:

*Group 1 (attribute filters):* `Stage` (layers) · `Priority` (shield) · `Service` (tag) ·
`Source` (signal) · `Country` (globe) · `Payment Status` (dollar).
*Group 2 (range filters, after a separator):* `Deal Value` (dollar) · `Date Range` (calendar).

Each category drills into its own panel with a `◀` back button:

- **Stage** → 9: `Lead` · `Qualified` · `Proposal` · `Negotiation` · `On Hold` · `In Progress` ·
  `Recurring` · `Closed` · `Lost`.
- **Priority** → 3: `High` · `Medium` · `Low`.
- **Service** → 11: `Website` · `Marketing` · `E-Commerce` · `Nexeor OX` · `Custom Dev` · `SEO` ·
  `Mobile App` · `Digital Partnership` · `Branding` · `ERP` · `Other`.
- **Source** → 10: `Website` · `Referral` · `WhatsApp` · `Cold Call` · `Social Media` · `Campaign` ·
  `LinkedIn` · `Email` · `Google` · `Other`. *(Note: a different list from the create form's
  Lead Source select.)*
- **Country** → 1: `India` — it lists only the countries actually present on leads.
- **Payment Status** → 3: `Not Paid` · `Partially Paid` · `Paid`.
- **Deal Value** → not a list but a mini-form: heading `Deal Value (AED)`, `Min`
  (`placeholder="0"`) and `Max` (`placeholder="No limit"`) number inputs with a `to` between them,
  and an **`Apply`** button. The suggestion list below reads `No results.`
- **Date Range** → presets `Today` · `7d` · `30d` · `This Mo` · `Last Mo`, a month calendar
  (`◀ Sep 2026 ▶`, Su–Sa, day buttons), and an **`Apply`** button.

**Once a filter is applied**, re-opening the popover shows an **`Active Filters`** block at the top
(the chip: `Priority is High`), the category list with a count badge beside the used category, and a
**`Reset all filters`** button. The chip's **`is` ▾** button offers exactly two operators:
**`is`** / **`is not`**; the value button re-offers that category's list (`High` / `Medium` / `Low`).
Applying `Priority is High` reduced the board to 3 cards.

### 3.4 `Sort` — every option

A popover with the group label **`Sort By`** and **5 options** (no search box):
**`Value High → Low`** (default, ticked) · `Value Low → High` · `Updated Newest` ·
`Updated Oldest` · `Created Newest`. Choosing one re-orders the cards inside every column and the
`Sort` button starts showing the chosen sort's name.

### 3.5 The bulk-selection bar

Every card carries a **circular tick control in its top-right corner**, visible on hover. Ticking
one card slides a **fixed bar** in with:
- **`N Selected`**
- **`Assign To…`** ▾ — the 27-name list (Admin … xyz, as in §3.1).
- **`Move To…`** ▾ — 9 stages: `LEAD` · `QUALIFIED` · `PROPOSAL` · `NEGOTIATION` · `ON HOLD` ·
  `IN PROGRESS` · `RECURRING` · `CLOSED` · `LOST`.
- **`Delete`** (trash icon).
- **`✕`** to clear the selection.
*Nothing was assigned, moved or deleted.*

---

## 4. A lead card — every part of it

Markup: `<div draggable="true">`, `cursor: pointer`, hover raises a shadow, press gives
`active:scale-[0.99]`.

1. **Select tick** — a circle in the top-right corner (appears on hover) → the bulk bar (§3.5).
2. **Service tag** — a pill with the service icon and name. The full set seen on live cards:
   `Website` (globe) · `Marketing` (megaphone) · `App Development` · `Branding` (palette) ·
   `Seo Optimization` · `Social Media` · `Ppc Campaigns` · `Website Dev` (the last six all render
   with the generic *layers* icon). The **create form's** canonical list is the 11 in §3.1 —
   the older card labels above are historic data values, not form options.
3. **Priority badge**, top-right: **`LOW` · `MEDIUM` · `HIGH`** — only these three exist
   (the edit form's priority select has exactly 3 options, and the filter offers exactly 3).
4. **Lead name** (bold, `title` = the full name so long names can be read on hover).
5. **Contact person** — user icon + name (`Kevin`, `Lead Contact 3`, `vic`). Blank when unset.
6. **Owner line** — the assigned team member's name, or **`Unassigned`**.
7. **Deal value** — right-aligned, currency code in a small span then the number
   (`title="Deal value: AED 45,389"`).
8. **The AED conversion line** — when the deal is not in AED, a second, smaller line appears
   directly under the amount: `≈ AED 437` for `INR10,000`, `≈ AED 28.4k` for `INR650,000`
   (it abbreviates above ~10k). Always the AED equivalent, always prefixed `≈`.
9. **Payment strip** (only on leads that have a payment plan):
   - a row of small **milestone chips** — a number for an unpaid one, a tick for a paid one, each
     with a tooltip like `title="Monthly SEO - Jun 2026 - Missed"` / `"Full Payment - Paid"`;
   - a red summary `1 Missed Overdue` / `2 Missed Overdue`;
   - **`Paid: AED 47,389`** and **`Pending: AED 2,000`**;
   - a thin progress bar.
10. **Retainer strip** (only on leads with a live retainer): `MONTHLY Retainer`, the cycle amount,
    `Overdue 78d`, and a state chip **`ACTIVE`** or **`ENDED`**.
11. **Footer, left:** a clock icon and a day counter — **`38d`, `145d`** — whose tooltip says
    exactly what it counts: `title="Last updated 38 days ago"`. It is **days since the lead was
    last touched**, and it turns rose on stale leads.
12. **Footer, right — the two trailing `0 0` counters:**
    - a **speech-bubble icon + number** = **comments in the lead's Discussion thread**;
    - a **ticked-square icon + number** = **open action items (tasks) on the lead**.
    A third, optional **video-camera pill** sits to the left of them when the lead has a scheduled
    meeting.

**Drag & drop — what the card actually does when you grab it.**
Driven for real over the Chrome DevTools Protocol (`Input.setInterceptDrags` + `dispatchDragEvent`),
so a genuine `dragstart` fired and Chromium handed the drag back to me mid-flight. Findings:

- The drag **does** start and **does** carry a payload: the intercepted drag reported one item of
  MIME type `text/plain`, i.e. the card's `onDragStart` writes the lead id into the drag data.
- Reading React's attached props confirms the wiring: **the card** has
  `draggable`, `onDragStart`, `onClick` and `onContextMenu`; **the column** (the outer 300px div)
  has `onDragOver`, `onDragLeave` and `onDrop`. So every stage column is the drop target, and
  dropping a card on one is the same operation as the bulk bar's `Move To…`.
- **There is no visual feedback while dragging.** Held mid-drag and then held again hovering over
  the QUALIFIED column, the grabbed card's classes, inline style, computed `opacity` and
  `transform` were **byte-identical** to its resting state, and all eight columns' classes were
  unchanged. No ghost, no dimming, no tilt, no gap where the card came from, no highlight or ring
  on the column you are about to drop into, and no "drop here" wording anywhere in the page.
  The only feedback the card has at all is its ordinary hover shadow and the `active:scale-[0.99]`
  press squeeze — neither of which is drag-specific.
  *(The column does carry `onDragOver`/`onDragLeave` and a `transition-colors` class, so a
  highlight looks like it was intended; it did not paint in this capture.)*
- **I did not complete a drop.** The drag was ended with `dragCancel`, and the board was verified
  unchanged afterwards — same eight columns, same counts, same totals, same first card.

### The card right-click menu

Every card also answers a **right-click** (`onContextMenu`) with a small floating menu — nothing on
the board hints that this exists. Two groups:

- **`Edit Lead`** (pen icon) — opens the lead drawer straight into its edit form.
- **`Copy Link`** (link icon) — copies a **direct address for that one lead**:
  `https://os-staging.product.nexeor.com/crm?leadId=<lead id>`. Pasting that URL back in opens
  `/crm` with that lead's drawer already open. No toast or confirmation is shown.
- **`Copy Name`** (copy icon) — copies just the lead's name as plain text (`Test Voice Rec`).
- *(separator)* **`Email`** (envelope) — a `mailto:` link to the contact. **This item only appears
  when the lead has an email address**: the Italica card's menu had three items, not four.

---

## 5. The lead detail drawer — click any card

Opens as a **560px right-hand drawer** over a 50%-black scrim. **The URL does not change** — it
stays `/crm`, so a lead has no shareable link from this screen. While it loads the drawer shows the
header `Lead` + `✕` and the words **`Loading Lead...`**.

**Header of the drawer**
- A strip reading **`Lead`** (the same word for every stage) and a **`✕` Close**.
- **Lead name** as an `<h2>` + the priority badge.
- Icon actions, right: **`Delete Lead`** (trash) · **`Edit Details`** (pen).
- **`DEAL VALUE`** + the amount, and to its right: **`Email Lead`** (envelope — a real
  `mailto:` link, present only when the lead has an email) and **`Schedule Meeting`** (video).
- **Tabs:** **`Overview`** always; **`Payments`** (dollar icon) **only on leads in
  IN_PROGRESS, RECURRING or CLOSED**. Checked all nine stages: LEAD, QUALIFIED, PROPOSAL,
  NEGOTIATION, ON_HOLD and LOST show Overview only.
- The **`Overview` button is itself a dropdown** (chevron) — a **section jump menu**:
  `Key Details` · `Action Items` · `Scheduled Meetings` · `Internal Notes` · `Discussion` ·
  `Attachments` · `Activity History`.

### 5.1 Overview tab — the seven sections

**`#section-key-details`** — read-only pairs: `Current Stage` (a badge, e.g. *In Progress*) ·
`Lead Source` · `Contact Person` · `Email` · `Phone` · `Location` · `Assigned Team` ·
`Services`. Empty values render as an em-dash `—`.

**`Edit Details`** (the pen) turns this same block into a form **in place** — it is not a modal.
Fields, with what they were pre-filled with:
| Field | Control | Options / default |
|---|---|---|
| Lead name | text input | current name |
| Priority | `<select>` | `LOW` · `MEDIUM` · `HIGH` |
| Deal value | currency `<select>` (the same 166) + number input | current |
| **Stage** | `<select>`, **9 options** | `Lead` · `Qualified` · `Proposal` · `Negotiation` · `On Hold` · `In Progress` · `Recurring` · `Closed` · `Lost` |
| Contact Person | text | current |
| Email | text | current |
| Phone | `+971` ▾ country button (54 countries) + `type="tel"` | current |
| Location | two inputs, `City` and `Country` | current |
| **Lead Source** | `<select>`, **11 options** | `Contact Circle` · `Referral` · `Meta Ads` · `Instagram` · `WhatsApp` · `Website Form` · `Cold Call` · `Imported` · `Linkedin` · **`Other`** · **`WhatsApp AI`** — two more than the create dialog offers |
| **Assigned Team** | chip multi-select ▾ | the 27 names; selected ones become removable chips with an `✕`, chosen ones carry a tick in the list |
| **Services** | chip multi-select ▾ | the 11 services; same chip/tick behaviour |

Buttons: **`Cancel`** · **`Save Changes`**. *Cancelled out.*

**`#section-action-items`** — a one-line task composer:
- text input `placeholder="What needs to be done? (@ to mention)"`;
- **`Set date`** with a hidden `input type="date"`;
- **`Assign`** — a `<select>` of **28 options**: `Unassigned` + the 27 people (values are
  internal ids);
- an **`Add`** button, disabled until the text box has content.
Typing **`@`** in the box opens a **`Suggested Users`** panel listing all 27 people with their
avatar initial, name and email address. Below the composer, the list, or **`No open tasks`**.

**`#section-meetings`** — heading `Scheduled Meetings` with two buttons:
- **`+ Add Bot`** → dialog **`Add Bot to Meeting`**: `Meeting URL`
  (`placeholder="https://meet.google.com/xxx-xxxx-xxx"`) and `Meeting Name` (pre-filled
  `"<Lead> Discussion"`); buttons `Cancel` · `Add Bot` (disabled until a URL is typed).
- **`+ Add`** → the same **`Schedule Meeting`** dialog as the header video icon (below).
Each meeting row shows a bot icon (or a `MON D` date block), the meeting title, the time, and a
**`Join`** link straight to the Google Meet URL.

**`Schedule Meeting` dialog** — a wide two-pane modal:
*Left (the form)* — title input pre-filled **`<Lead> x Nexeor | WEB | Discussion`** ·
`Date` (`type=date`, defaults to tomorrow) · `Time` (`type=time`, default `10:00`) ·
`Duration` `<select>`: **`15m` · `30m` · `45m` · `1h`** · a **`Guests`** block with a count
(`1 invited`), an input `Add external guests by email` with a **`+` `title="Add email"`** button,
an **`Internal Team`** tick-list of all 27 staff (avatar initial, name, work email), and an
**`External Guests`** chip list (the lead's own email, each removable) · a **Google Meet** note:
*"Joining info added automatically"*.
*Right (the preview)* — a live calendar: **`Day` / `Week`** buttons, `◀ ▶` month nav, `Sep 2026`,
a `GMT+04` timezone label, a day header (`Tue 8`), an hour grid `1 AM … 11 PM`, and the new meeting
drawn as a draggable block (`10:00 - 10:30 AM`) with a grip handle.
Dialog buttons: **`Cancel`** · **`Save`**. *Cancelled out.*

**`#section-notes`** — `Internal Notes` + an **`EDIT`** button (pen). Empty state:
*"No internal notes added."* Editing swaps in a textarea
(`placeholder="Write detailed notes here... (Type @ to mention)"`) with `Cancel` / `Save`.

**`#section-discussion`** — `Discussion` + an input
`placeholder="Write a comment... (@ to mention)"` and a **`Post`** button (disabled while empty).
`@` opens the same **`Suggested Users`** panel.

**`#section-attachments`** — `Attachments` + a big dashed drop-target label
**`Click to upload (PDF, HTML, TXT, Images)`** (cloud-upload icon, hidden `input type="file"`).
Empty state: *"No files attached yet."* Each attached file is a row with:
- a star icon (marks the final proposal), the file name (with a `title`), and a meta line
  `pdf • 8.2 MB • Final Proposal`;
- row actions **`Preview`** (eye) · **`Download`** (a direct link to the S3 object) ·
  **`Delete`** (trash);
- a **category `<select>` with 7 options**: `Other` · `Proposal` · `Contract` · `Invoice` ·
  `Brief` · `Media` · `Moodboard`;
- a **`Set as Final`** button, which reads **`Final Proposal`** once the file already is the final one.
**`Preview`** opens a **full-screen overlay**: the file name, a `Download` link, an `✕`, and the
document rendered in an `<iframe>`.

**`#section-activity`** — `Activity History`, a reverse-chronological feed of `<who> <did what>` +
timestamp. Real examples of every event type seen:
`Created new lead: Italica` · `updated Stage to IN_PROGRESS` · `updated Deal Value to INR 650000` ·
`Uploaded file: … (OTHER)` · `Marked "…pdf" as Final Proposal` · `Added payment milestone: …` ·
`Payment received for Milestone 2 - Sprint Close` ·
`Payment received for Milestone 1 - Advance (TDS 19500 withheld)` ·
`Invoice NXRU0018 created (INR 195,000)` (with the invoice number and amount as chips) ·
`Scheduled: …` · `Bot Scheduled: …` · `Bot Added: …`.
A meeting-bot entry is much richer: it embeds an **audio player** (play button, scrubber,
`0:00 / 1:39`), an **AI meeting summary** in markdown (Meeting Name / Key Takeaways / Action Items),
and a **`View Interactive Transcript`** button.

**`Interactive Transcript` dialog** — header `Interactive Transcript` + `4 spoken segments`, an
`<audio>` element with a play button and a `range` scrubber (`0:00` … `1:39`), then one row per
segment: a clickable **timestamp button** (`00:12`, `00:18`, `00:41`, `01:03`) that seeks the audio,
the **speaker name**, and the spoken text.

### 5.2 Payments tab (IN_PROGRESS / RECURRING / CLOSED leads only)

Header **`Payment Tracking`**, sub-line *"Track received payments and outstanding receivables."*,
and a status chip: **`Not Paid` / `Partially Paid` / `Paid`**.

- **Plan-type segmented control: `Milestone` | `Recurring`.** The active one is stored per lead as
  `paymentBillingMode`. **It is a write, not a view toggle**: pressing it fires
  `PATCH /api/crm/leads/<id>/payments/mode` with `{"billingMode":"RECURRING"|"MILESTONE"}`, logs a
  `System — Changed payment billing mode to <mode>` row in the lead's Activity History, and on a
  lead with no plan yet it also **zeroes the deal value** (see finding 9). Active button styling is
  `bg-white text-black`; the idle one is `text-white/50`.
  - **`Milestone` mode, nothing added yet:** the allocation meter reads
    `AED 0 allocated of AED 10,292` with a chip **`AED 10,292 unallocated`** (it reads `Balanced`
    once the milestones add up), both quick plans are offered, and the list says
    **`No payment items have been added.`** with every filter chip at `(0)`.
  - **`Recurring` mode, nothing added yet:** the milestone blocks are replaced by the
    **`Create recurring retainer`** form, and the two lists read
    **`No recurring retainers have been created.`** and **`No payment items have been added.`**
- **`Show in:`** four currency buttons — **`د.إ AED` · `₹ INR` · `$ USD` · `£ GBP`** — plus a
  `Base: INR` label whose tooltip reads *"Amounts are recorded in the base currency; conversion is
  for display only."*
- **Collection bar** — `32% collected`, `₹2,05,000 of ₹6,50,000`, with two coloured segments
  (`Received`, `TDS withheld`).
- **Four tiles:** `Received` · `TDS withheld` · `Receivable` · `Overdue`.
- **`Milestone allocation`** — `₹6,50,000 allocated of ₹6,50,000`, plus a state chip
  **`Balanced`** and a bar.

**Milestone mode blocks**
- **`Quick payment plans`** — note: *"Quick plans can only be applied before adding other
  milestones."* Two cards: **`100% in one payment`** ("One payment for the complete deal value.")
  with a date input and **`Create 100% Plan`**; **`50/50 payment`** ("Half at the beginning and half
  at completion.") with `Initial due date` and `Final due date` and **`Create 50/50 Plan`**. All of
  these were **disabled** on a lead that already has milestones.
- **`Add payment milestone manually`** — *"Use this for contract-specific or milestone-based
  payments."* Fields: `Milestone` (text, `placeholder="e.g. Design approved"`),
  `Amount (INR)` (number, `placeholder="5000"`), `Due date` (date) → **`Add Milestone`**.
- **`AI Autofill from Proposal`** (sparkles) — *"Reads the latest proposal from attachments and
  extracts milestone splits automatically."* → **`Extract Milestones`** button. *Not pressed.*
- **`Payment milestones`** — header buttons **`Configure Invoice`**
  (`title="Billing address, GSTIN, notes and terms for this client"`) and **`Export CSV`**
  (download icon), then filter chips **`All (3)` · `Upcoming (0)` · `Unpaid (0)` · `Partial (0)` ·
  `Overdue (2)` · `Paid (1)`**.
- **Each milestone row:** name + a status chip (`Paid` / `Overdue · 26d` / …), the amount,
  `Due 8/12/2026`, `Received …`, `TDS …`, a two-tone progress bar with a legend
  (`Received` / `TDS withheld`), a line like
  `₹1,95,000 of ₹1,95,000 · ₹1,75,500 cash + ₹19,500 TDS`, a percentage, and
  **`View payment history (1)`** which expands **in place** into a list of receipts
  (`+₹1,75,500  TDS ₹19,500 — Received 7/27/2026`) and flips to `Hide payment history (1)`.
- **Row actions.** Unpaid: **`Invoice`** (`title="Create Invoice for this milestone"`) ·
  **`Log`** (`Log Payment`) · **`Mark Paid`** (`Mark Fully Paid`) · **`Send Reminder`**
  (`Send Payment Reminder`) · a pencil **`Edit payment item`** · a trash **`Delete payment item`**.
  Already paid: the **invoice number as a button** (`title="View Invoice NXRU0018"`) ·
  **`Mark Unpaid`** (`title="Mark Unpaid — reverses payment"`) · trash.
- **`Invoices (N)`** — one row per invoice: the number, a status chip (`PAID`), then
  `<client> · INR 195,000 · Due 29 Jul 2026`, with **`View Invoice`** (eye) and
  **`Delete Invoice`** (trash).

**Recurring mode blocks**
- **`Create recurring retainer`** — *"Installments are generated automatically through one cycle
  ahead."* Fields: `Retainer name` (text, `placeholder="e.g. Monthly SEO Retainer"`),
  `Amount per cycle (INR)` (number, `placeholder="5000"`), **`Frequency`** `<select>`:
  `Monthly` · `Quarterly` · `Annually`, `Start date`, `End date (optional)` →
  **`Create Retainer`**.
- **`Recurring retainers`** — per retainer: its name, a chip **`ACTIVE`**, `₹47,264 · monthly`,
  the period `6/22/2026 – 7/22/2026`, and buttons **`Pause`** · **`End`** · trash
  (`title="Delete Retainer"`).
  Four tiles: `Cycles billed` · `Cycles paid` · `Overdue` · `Collected`.
  An **`Invoice for`** segmented control **`Previous Month` | `This Month`**, a
  `Billing: September 2026` read-out and a **`Generate Installment`** button.
  A rate box (number input, pre-filled with the current cycle amount) + **`Update Future Rate`**.
  An **`Auto Email`** switch, then **`Configure Email`** · **`Configure Invoice`** ·
  **`Send Now`** and a `Last sent: Jul 27, 2026, 10:49 PM` line.
- **`Payment installments`** — the same list/filter machinery as milestones, with rows named
  `monthly - Jun 2026`, `monthly - Jul 2026`, `monthly - Aug 2026`.

**`Invoice details for this client` dialog** (the `Configure Invoice` button)
Intro: *"Pre-fills every new invoice raised for this client — milestone invoices and retainer cycles
alike. Your company details, tax rate and bank accounts stay global in Settings → Configuration →
CRM."* Fields: `Bill to` (text, placeholder = the client name) · `Billing address` (textarea,
placeholder `Street / City, Emirate / State / Country`) · `Billing email`
(`accounts@client.com`) · `Billing phone` (`+971 ...`) · `GSTIN` (`Printed on the invoice`) ·
`Default PO number` (`If the client requires one`) · **`Payment due`** `<select>` with **32
options**: `Follow the retainer schedule` (default) then `1st … 31st` — with the note *"Due dates
come from the retainer's start date — the same day-of-month every cycle."* · `Payment terms`
(textarea, *"Overrides the global terms for this client only"*) · `Invoice notes` (textarea,
*"Appears in the Notes block at the bottom of the invoice"*).
Buttons: **`Cancel`** · **`Save details`**. *Cancelled out.*

**`Log received payment` dialog** (the `Log` button)
Shows the milestone name and **`Outstanding: ₹2,50,000`**. Fields:
- `Amount received in bank (INR)` — number.
- **`TDS deducted by client`** — five quick buttons with Indian TDS-section tooltips:
  **`10%`** (*194J professional / technical fees*) · **`5%`** (*194H commission or brokerage*) ·
  **`2%`** (*194C contractor (company)*) · **`1%`** (*194C contractor (individual / HUF)*) ·
  **`Balance`** (*"The entire remaining balance was withheld as TDS"*) · **`Clear`**;
  then a number input and a **`Section`** `<select>` with 7 options:
  `Section` (empty default) · `194J` · `194C` · `194H` · `194I` · `194Q` · `195`.
  Help text: *"Tax the client withheld and paid to the government on your behalf. It closes out the
  invoice and is tracked for your year-end refund claim."*
- `Date received` — date, defaults to today.
Buttons: **`Cancel`** · **`Log Payment`**. *Cancelled out.*

**`Edit payment item` dialog** (the pencil) — `Name` (text) · `Amount (INR)` (number) ·
`Due date` (date), all pre-filled; **`Cancel`** · **`Save Changes`**. *Cancelled out.*

**`Edit Invoice` dialog** (the invoice number / `View Invoice`)
A full invoice editor. Header: `Edit Invoice`, `NXRU0018 · Italica`, a **status `<select>`** with 5
options **`Draft` · `Sent` · `Paid` · `Overdue` · `Cancelled`**, then
**`Preview`** (*"Preview the invoice as the client receives it"*) ·
**`AI Fill`** (*"Extract invoice details from the proposal with AI"*) ·
**`PDF`** (*"Download the invoice as a PDF"*) · **`Save Draft`** · **`Save & Email`**.
Body:
- Six header fields: `Invoice #` (`NXRU0001`) · `Date` · `Due Date` · `Currency` · `PO Number`
  (`Optional`) · `WIO Reference` (`Optional`).
- **`From`** — an "issued by" `<select>` with **2 options**: `Nexeor India · INR` and
  `Nexeor UAE · AED`; then Company Name, Address (textarea), Email, Phone, Website, all pre-filled
  with the issuing company's details.
- **`Bill To`** — Client Name, Address, Email, Phone, and a **`TRN`** field (*"Client's TRN"*).
- **`Line Items`** — a table with columns **`Item` · `Qty` · `Rate` · `Amount` · (row delete)**;
  each item row has a name input and an optional description input; plus a
  **`+ Line Item`** button.
- **Totals** — `Subtotal`, then three add-buttons **`+ Discount`** · **`+ Tax`** · **`+ Shipping`**.
  Each reveals its own editable line: *Discount* = a label input (default `Discount`) + a negative
  amount; *Tax* = a label input (default **`VAT`**) + a percentage + a toggle **`Excl.`**
  (*"Prices exclude tax — the tax shown is added on top"*) + the computed tax; *Shipping* = an
  amount. Then `Total`, an editable **`Amount Paid`** number, and `Balance Due`.
- **`Bank Details`** — an **`+ Add Bank`** button and a pick-one list of the saved accounts
  (`Nexeor Creative Technologies FZCO`, `INR - Nexeor Creative Technologies PVT LTD`), plus a
  textarea *"Additional payment instructions..."*.
- **`Notes`** (textarea) and **`Payment Terms`** (textarea, *"e.g. Due within 14 days of invoice
  date..."*).
- **`Preview`** opens a right-hand **`LIVE PREVIEW`** pane, labelled with the issuing entity and
  currency, explaining *"This is the document the client receives. Edits on the left appear here as
  you type."* The button flips to `Hide preview`.
*Nothing was saved, emailed or downloaded.*

**`Email Template` panel** (the `Configure Email` button on a retainer) — opens **inline in the
drawer**, not as a modal. Fields:
- **`To`** — removable email chips + a free input.
- A locked block, `title="Configured in Settings → Configuration → CRM → Default recipients"`,
  headed **`Always included`**, listing the global `Cc` and `Bcc` addresses (padlock icon).
- **`Cc`** — removable chips + input. **`Bcc`** — input, `placeholder="Blind copy"`.
- **`Subj`** — text, pre-filled `Payment Reminder — monthly — {{billing_month}}`.
- **`Day`** — a number input (default `1`) reading *"Day [1] of each month cycle"*.
- **`For`** — segmented **`Previous Month` | `Upcoming Month`**.
- **Variables** you can use, all 12: `{{amount}}` `{{due_date}}` `{{billing_month}}`
  `{{retainer_name}}` `{{client_name}}` `{{currency}}` `{{amount_number}}` `{{frequency}}`
  `{{prev_month}}` `{{next_month}}` `{{current_month}}` `{{current_year}}` — with the note
  *"{{amount}} includes the currency · {{amount_number}} is the bare figure"*.
- A **rendered preview** of the email body (Dear …, the reminder paragraph, a
  Retainer / Amount / Frequency table, and the sign-off).
- A ticked checkbox **`Attach invoice PDF`**, with a status card
  (`Billing monthly - Aug 2026`, `No invoice configured`, *"A basic sheet is generated from the
  retainer. Configure an invoice to control billing address, notes and tax."*) and a
  **`Configure invoice`** button.
- Buttons: **`Save Template`** · **`Preview`** · **`Send test to me`**
  (`title="Sends only to you - the client gets nothing"`) · **`Send to client`**.
*Nothing was saved or sent.*

---

## What I changed on the site, and what I could not put back

Everything else in this document was captured by looking. Three writes happened, all on **seeded
demo leads** in the `Stave Corp …` series (contacts `contact6/7@in_progress.com`), none on a
named client:

1. **`Stave Corp IN_PROGRESS - 8` — billing mode flipped to `Recurring` and back to `Milestone`.**
   I chose this lead precisely because it had *no* payment plan, so there was nothing to convert.
   The mode is correctly back to `Milestone` (verified against the API and after a full reload).
   **But the flip zeroed the lead's deal value from `AED 10,292` to `AED 0`, and I could not
   restore it** — every write to that lead's record returns HTTP 500 (finding 10), including
   through the app's own Edit form. So right now:
   - that card reads **`AED0`** where it read `AED10,292`, and its day counter reads `0d`;
   - the **IN_PROGRESS column total reads `AED 235,990`** where it read `AED 246,282`;
   - the lead's history holds **two permanent `System — Changed payment billing mode` rows**
     (15:49 and 15:51 local, 7 Sep 2026).
   The number to put back is **10,292 AED** (`value` and `originalValue`, which every other lead
   keeps equal). It will need a fix to that 500 first, or a direct database write.
2. **`Stave Corp IN_PROGRESS - 7` and `Stave Corp LOST - 4` — one no-op save each.** I re-sent each
   lead's own current field values unchanged, purely to prove the 500 above was specific to one
   record rather than the whole save button. Their data is identical; only `updatedAt` /
   `lastActivityAt` moved to today, which makes their cards read `0d` instead of their old
   day counts.
3. **No drop was ever completed, no invoice raised, no payment marked paid, no reminder or email
   sent, no record deleted, nothing exported.**

## Odd things I noticed

*(Each one: which panel → which screen → what he would see → then the technical note.)*

1. **CRM panel → CRM Board → a stage column's money total changes when you press *Show more*.**
   IN_PROGRESS read `AED 246,282` with 10 of 13 cards loaded; after `Show more (10 of 13)` the same
   header read **`AED 310,340`**. The count badge is the true total (13) but the money total only
   adds up the cards currently downloaded. Backend note: the board loads `?limit=10` per column.
2. **CRM panel → CRM Board → the same foreign-currency deal converts to two different AED figures.**
   The card for *client xya* shows `INR10,000 ≈ AED 437`, but with `Hot Leads` (or
   `Priority is High`) on, the LEAD column header total for that single card reads **`AED 388`**.
   Two conversion paths disagree.
3. **CRM panel → CRM Board → three stage columns never show the "stale" warning.**
   LEAD, QUALIFIED and PROPOSAL show the pulsing rose *N Stale Leads* pill; NEGOTIATION, ON_HOLD,
   IN_PROGRESS, Won and LOST show none, even though they hold cards last touched 145 days ago.
4. **CRM panel → lead drawer → the header always says "Lead".** A lead sitting in Closed, Recurring
   or Lost still opens under the word `Lead`; the actual stage is only visible in the
   *Current Stage* row inside.
5. **CRM panel → lead drawer → the source lists disagree.** Creating a lead offers 9 sources;
   editing the same lead offers 11 (it adds `Other` and `WhatsApp AI`). Filtering by Source offers a
   third, different list of 10 (`Social Media`, `Campaign`, `Google`, `Email` appear only there).
6. **CRM panel → CRM Board → New → the `+` in the Lead Source box does nothing.** A plus glyph sits
   in the corner of the Lead Source select; it is a plain `div` with no cursor and no tooltip, and
   clicking it added no field. It reads as an "add a new source" affordance that isn't wired.
7. **CRM panel → CRM Board → New → Assign Team shows three names the toolbar picker doesn't.**
   `abcd`, `work6` and `xyz` are assignable but not in the board's own person filter (which lists 24
   people). They look like test accounts.
8. **CRM panel → CRM Board → the only way to link to a lead is hidden behind a right-click.**
   Clicking a card opens its drawer without changing the URL, so the address bar never shows which
   lead is open and Back does not close it. A per-lead address *does* exist —
   `/crm?leadId=<id>`, and it opens the drawer correctly — but nothing on screen offers it except
   `Copy Link` in the card's right-click menu, which has no visible affordance at all.

9. **CRM panel → lead drawer → Payments → the `Milestone` / `Recurring` switch is not a view
   toggle, it rewrites the deal.** It fires `PATCH /api/crm/leads/<id>/payments/mode`
   (`{"billingMode":"RECURRING"}`) and, on a lead with no plan yet, **moves the deal value to 0** —
   the drawer's `DEAL VALUE`, the lead's card on the board and its stage column total all drop to
   `AED 0`. Switching back to `Milestone` restores the mode but **does not bring the value back**.
   It sits in the middle of a read-heavy page, looks exactly like the `Show in: AED / INR / USD /
   GBP` display toggle a few pixels below it, and asks for no confirmation.
10. **CRM panel → lead drawer → Edit Details → `Save Changes` can fail permanently on a lead, with
    no message on screen.** On `Stave Corp IN_PROGRESS - 8`, every write to
    `PATCH /api/crm/leads/<id>` answers **HTTP 500 `{"error":"Failed to update lead"}`** — the
    edit form, the Internal Notes save, and a bare `{value: …}` all fail. The identical request
    against two sibling leads returns 200, so the endpoint is fine and that one record is
    unsaveable. It is the only lead of the three whose stored `notes` and `priority` are both
    `null`. The screen shows no error when this happens — the form simply closes.
11. **CRM panel → the same lead shows two different priorities in two places.** For a lead whose
    stored `priority` is `null`, the card on the board renders **`LOW`** while the drawer header
    for the same lead renders **`MEDIUM`**, and the edit form posts `MEDIUM`. One of the two
    screens is inventing a default.

---

## In human language — every feature in this area, as points

- **The pipeline board** — one wide screen showing every deal the agency is chasing, laid out as
  columns you read left to right: brand-new enquiry, qualified, proposal sent, negotiating, on hold,
  work in progress, won, lost. Click *Sales → CRM Board* in the left menu. It is the one place a
  salesperson can see the whole sales pipeline without opening anything.
- **Nine stages, eight columns** — the "Won" column is double-width because won work splits in two:
  *Recurring* (clients on a monthly retainer) and *Closed* (jobs finished and paid). Everything
  else gets one column each.
- **A running total per column** — each column tells you how many deals are in it and what they add
  up to in dirhams, so you can see at a glance where the money is sitting.
- **A "going cold" warning** — a red pulsing badge on a column counts the deals nobody has touched
  in a while, so old enquiries can't quietly rot at the top of the pipeline.
- **A card for every deal** — one small tile per client showing the service they want, how urgent
  it is, who they are, who at the agency owns it, and the money. It is the whole deal in one glance.
- **Foreign money is always translated** — if the deal is priced in rupees or dollars, the card also
  shows roughly what that is in dirhams, so you never have to convert in your head.
- **A "days since we touched this" counter** — every card carries a small clock and a number of days
  since anything last happened on that deal. It is the single best nudge to go and follow up.
- **Two little counters on every card** — one is how many comments the team has left on the deal,
  the other is how many jobs are still open on it. You can see if a deal is being worked without
  opening it.
- **A meeting badge** — a small camera icon appears on a card when a meeting is booked with that
  client.
- **Right-click any deal for a shortcut menu** — a small hidden menu with: edit the deal, copy a
  link straight to it, copy its name, and email the contact. Nothing on the card tells you it's
  there, but it is the fastest way in.
- **A link to one single deal** — "copy link" gives you a web address that opens that exact deal
  for a colleague, so you can paste a deal into a chat instead of saying "look for Italica".
- **Switch a deal between one-off billing and a monthly retainer** — one switch on the payments
  page changes whether the client pays in stages or every month. Be careful with it: it is a real
  change to the deal, not just a different view, and it can wipe the deal's price.
- **Drag a deal to move it along** — pick a card up and drop it in the next column to say "this one
  moved forward". That is the whole point of the board.
- **Create a deal in one form** — the *New* button asks for the company, the money and currency, how
  urgent it is, the contact person's phone/email/website/city/country, which services they want, who
  on the team owns it, where the enquiry came from, and any private notes. It can save and
  immediately open a blank one again, which is what you want after a phone-in day.
- **Add a deal straight into a stage** — every column has its own *New Deal* button at the bottom,
  and the form remembers which stage you started from.
- **Prices in 166 currencies and phone codes for 54 countries** — the agency sells abroad, and the
  form is built for that.
- **Search the pipeline** — one box filters every column live, by client name.
- **Filter the pipeline eight ways** — by stage, urgency, service, where the enquiry came from,
  country, whether they've paid, a money range (from/to), or a date range with a calendar. Each
  filter you add becomes a removable little tag you can flip from "is" to "is not", plus a
  clear-everything button.
- **Sort the pipeline five ways** — biggest money first, smallest first, most recently touched,
  longest untouched, or newest created.
- **See only one person's deals** — a dropdown of everyone in the agency; pick a name and the whole
  board (and every total) narrows to their deals. There is a "just mine" shortcut at the top.
- **A "hot leads" switch** — one tap leaves only the deals marked urgent, so you can start the day
  with the three that matter.
- **Cash coming in, in one dialog** — the *Upcoming* button lists every payment the agency is
  waiting for over the next week, ten days, month, two months or a range you pick, with a grand
  total, a count of how many are late, and the client and job each one belongs to.
- **Reschedule a payment from that list** — click any due date and change it there, with shortcuts
  for today, a week out, a fortnight, a month, or the end of the month, and a warning if you pick a
  date in the past.
- **Your calling credit on screen** — a small green figure at the top is how much phone credit is
  left for calling clients from the system.
- **Tick several deals at once** — a circle on each card lets you select many, then hand them all to
  one person, move them all to another stage, or delete them together.
- **A deal's full file, in a side panel** — clicking any card slides out everything known about it:
  the money, the contact details, who owns it, the services, its stage and where it came from.
- **Jump straight to a part of the file** — a small dropdown at the top of the panel jumps to key
  details, jobs, meetings, notes, the chat, the files or the history.
- **Edit the deal in place** — a pencil turns that same panel into a form: rename it, change the
  money or currency, change the urgency, move its stage, fix the contact, swap who owns it, change
  the services and the source.
- **A to-do list on every deal** — write a job, give it a date, hand it to a colleague. Type "@" and
  a list of everyone in the agency appears, so you can tag the person you mean.
- **A private notes pad on every deal** — long-form notes only the agency sees, not the client.
- **A comment thread on every deal** — short back-and-forth between staff, with "@" tagging, so the
  conversation lives on the deal instead of in chat.
- **Files on every deal** — drag in proposals, contracts, invoices, briefs, images or moodboards,
  label each one, preview it in the browser, download it, or delete it.
- **Mark one file as "the final proposal"** — the one document that counts gets a star, and the
  system can then read the numbers out of it.
- **Book a meeting from the deal** — a full scheduler: title (already written for you), date, time,
  a 15/30/45/60-minute length, invite anyone in the agency by ticking them, add outside guests by
  email, and a Google Meet link is created automatically. A live calendar on the right shows where
  the meeting will land, in the agency's timezone.
- **Send a note-taking bot to a meeting** — paste a meeting link, name it, and a bot joins to record
  it.
- **Recordings, written up automatically** — after a bot-attended meeting the deal's history holds a
  playable recording, an AI-written summary of the meeting (its name, the key takeaways and the
  action items), and a full transcript.
- **An interactive transcript** — every line of the meeting with who said it and a timestamp you can
  click to jump the audio to that moment.
- **A complete history of the deal** — who created it, every stage change, every price change, every
  file uploaded, every payment received, every invoice raised, every meeting booked, all stamped
  with a name and a time. Nothing about a deal is untraceable.
- **A payments side to won work** — deals that have reached "in progress", "recurring" or "closed"
  get a second tab that turns the deal into money: how much has come in, how much is still owed,
  how much is late, and how much tax the client held back.
- **See the money in another currency** — one tap re-reads the whole payment page in dirhams,
  rupees, dollars or pounds, while making clear the real records stay in the deal's own currency.
- **Two ways to be paid, per deal** — either a set of milestones (advance, on delivery, on go-live)
  or a repeating retainer.
- **Two one-tap payment plans** — "the whole amount in one payment" or "half now, half at the end",
  each just needing the dates. They are only offered before you've added milestones of your own,
  which stops half-built plans.
- **Add your own payment milestones** — name it, price it, date it. A running "allocated of total"
  meter tells you when the milestones add up to the deal value, so you can't under- or over-bill.
- **Let the AI read the proposal** — one button reads the final proposal you attached and creates the
  payment milestones from it, instead of you retyping the split.
- **A retainer that bills itself** — set an amount per cycle, monthly/quarterly/yearly, a start and
  an optional end date, and the system keeps generating the next instalment a cycle ahead.
- **Run a retainer's life** — see cycles billed, cycles paid, how many are late and how much has
  been collected; pause it, end it, raise the rate for future cycles only, or generate this month's
  or last month's instalment by hand.
- **Automatic payment-reminder emails** — a switch turns them on, and an editable template controls
  who they go to (with agency-wide addresses always copied in, locked from here), the subject, which
  day of the month they go out, whether they bill the previous or the coming month, and the wording
  — with fill-in tags for the amount, the due date, the month, the client and so on. You can preview
  it, send a test to yourself only, or send it to the client.
- **Filter a payment list** — every payment list can be narrowed to upcoming, unpaid, part-paid,
  overdue or paid, each showing its count.
- **Record a payment properly, Indian tax included** — logging money received also captures the tax
  the client withheld (TDS), with one-tap 10/5/2/1 per-cent buttons that name the exact tax section,
  and an explanation that this closes the invoice and is tracked for the year-end refund claim.
- **A payment history per milestone** — expand any milestone to see each part-payment, the tax held
  back and the date it arrived.
- **Chase a late payment in one click** — a *Send Reminder* button on every unpaid milestone.
- **Undo a payment** — a milestone marked paid can be marked unpaid again, and it says plainly that
  this reverses the payment.
- **Raise an invoice from a milestone** — one button turns a payment milestone into a numbered
  invoice.
- **A full invoice editor** — choose which of the agency's two companies (India or UAE) issues it,
  set the number, dates, currency, PO and reference, fill in who it's from and who it's to
  (including the client's tax number), add as many line items as you want with quantity and rate,
  and add a discount, a tax percentage (inclusive or on top) and shipping. It shows the total,
  what's been paid and what's still due.
- **See the invoice as the client will** — a live preview pane beside the editor that updates as you
  type, plus a PDF download.
- **Let the AI fill the invoice** — one button pulls the invoice details out of the attached
  proposal.
- **Bank details on the invoice** — pick which of the agency's accounts to print, add a new one, and
  add payment instructions, notes and terms.
- **Save an invoice as a draft or email it** — two clearly separate buttons, so nothing goes to a
  client by accident.
- **Per-client billing defaults** — set a client's billing name, address, email, phone, tax number,
  standing PO number, which day of the month they pay, and their own payment terms and notes, and
  every future invoice for them is pre-filled. It says which settings stay agency-wide.
- **Export a payment list** — one button downloads the milestones or instalments as a spreadsheet.
- **A payment countdown inside the board** — the "in progress" column can open a small panel listing
  the next payments due across all those deals, and the "recurring" column does the same for
  retainer money, so you don't have to open a single deal to know what's coming.
- **Works on a phone** — on a narrow screen the eight columns become one, with a row of stage tabs
  across the top to switch between them.
