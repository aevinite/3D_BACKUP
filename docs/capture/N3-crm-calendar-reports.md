# N3 — Nexeor Agency OS v2.0 · Sales → **Payment Calendar** + **Reports**

Captured 2026-09-07 from `https://os-staging.product.nexeor.com`, signed in as the demo account,
Chromium 1512×950 (and re-checked at 390×844). **Look-only capture — nothing was created,
edited, saved, deleted or exported.**

Scope: the two money-and-measurement screens of the **Sales** group.

| Sidebar label | Route | Page title on screen |
|---|---|---|
| Payment Calendar | `/crm/milestones` | **Milestone Calendar** |
| Reports | `/crm/analytics` | **Executive Overview** |

Both screens are client-rendered — the raw HTML contains nothing useful; every value below was
read off the rendered page.

---

## Payment Calendar — `/crm/milestones`

**Where:** left sidebar → group **Sales** → menu item **Payment Calendar**. No tabs, no
sub-navigation. (The sidebar label says "Payment Calendar"; the page's own H1 says
"Milestone Calendar" — the two names differ.)

**What you see on arrival:** a page title block at the top-left ("Milestone Calendar" +
"Track payment milestones and visualize cash flow across all clients"). Under it a row of **four
summary tiles**. Below that a **two-thirds / one-third split**: on the left the month calendar
card (month name + two arrow buttons, a Sun→Sat 7-column grid, a colour legend along the bottom);
on the right a **sticky day panel** listing the payments due on whichever day is selected. No
top bar, no toolbar, no filter row, no create button, no search. At 390 px the four tiles become
2×2 and the day panel drops below the calendar (no horizontal overflow).

### Numbers/cards on the page — the four tiles

Read in September 2026 (the live month on capture day). Each tile is a rounded card with a small
coloured icon top-right, a big value, and a small count line under it.

| # | Label (exact) | Big value | Small line under it | Icon tint | What it counts |
|---|---|---|---|---|---|
| 1 | `Expected this month` | AED 76,742 | `4 milestones` | blue | every payment milestone dated inside the shown month, at full value, converted to AED |
| 2 | `Received` | AED 87 | `1 paid` | green | the part already collected in that month |
| 3 | `Still to collect` | AED 76,655 | `0 pending` | yellow/amber | expected minus received. **The count line counts only *pending* (not-yet-due) milestones — so it reads `0 pending` while the value is AED 76,655** |
| 4 | `Overdue` | AED 76,655 | `3 overdue` | red | past their due date and not fully paid |

- Tile 4 is the only one that changes appearance: when the overdue count is above zero the card
  gets a **red border and a red-tinted background**; in a month with 0 overdue it renders in the
  same neutral white/5 style as the other three (verified in October and December 2026).
- All four tiles recompute per month as you navigate. Values observed:

| Month shown | Expected | Received | Still to collect | Overdue |
|---|---|---|---|---|
| September 2026 | AED 76,742 · 4 milestones | AED 87 · 1 paid | AED 76,655 · 0 pending | AED 76,655 · 3 overdue |
| August 2026 | AED 100,167 · 7 milestones | AED 4,388 · 1 paid | AED 95,779 · 0 pending | AED 95,779 · 6 overdue |
| July 2026 | AED 52,659 · 16 milestones | AED 16,580 · 5 paid | AED 36,079 · 0 pending | AED 36,079 · 11 overdue |
| June 2026 | AED 106,655 · 20 milestones | AED 93,783 · 11 paid | AED 12,872 · 0 pending | AED 12,872 · 9 overdue |
| October / November / December 2026 | AED 0 · 0 milestones | AED 0 · 0 paid | AED 0 · 0 pending | AED 0 · 0 overdue |

### Controls — every one, in the order they appear

1. **Previous month** (left chevron, top-right of the calendar card, `aria-label="Previous month"`)
   → steps the whole page back one month: the H2 month name, all four tiles and the whole grid
   reload. **It also clears the selected day**, so the right panel falls back to
   "Select a day to see payments due".
2. **Next month** (right chevron, same place, `aria-label="Next month"`) → the same, forward. No
   limit found in either direction; I walked back to January 2026 and forward to December 2026.
3. **Each day cell of the grid is a button** (30 in September; the leading blanks before the 1st
   are inert `div`s, not buttons) → clicking one selects that day and fills the right-hand panel.
   Clicking a day with no payments still selects it and shows the empty line.
4. **Each payment card inside the right panel is a link** → `/crm?leadId=<id>`, i.e. it leaves
   this screen and opens the CRM Board with that lead. Same tab. On hover the card's title turns
   light blue.

**That is the complete control list.** There is **no view switcher** (no month/week/list/agenda
toggle — month grid is the only view), **no "Today" jump button**, **no create/add control**,
**no filter of any kind** (not by client, not by owner, not by status), **no search**, **no
export**, **no totals row inside the grid**, and **no bulk actions**. Payment milestones are not
created here; the calendar only displays milestones that exist on leads.

### Every form/dialog it opens

**None.** Clicking a day fills an in-page panel; clicking a payment navigates away to the CRM
Board. Nothing on this screen opens a modal, drawer, dropdown, popover or form. Hovering a day
cell shows no tooltip and the cells carry no `title` attribute.

### The calendar grid — what a payment looks like on it

Column headers: `SUN MON TUE WED THU FRI SAT` (small, uppercase, grey). Cells are 64 px minimum
height, arranged 7 across with a small gap.

A **day with no payments** shows only its date number in dim grey and has no background.

A **day with payments** shows, stacked top to bottom:
1. the **date number** in solid white (instead of dim grey),
2. the **day's total, abbreviated** — `87`, `353`, `76.3K`, `4K`, `40.7K`, `1.8K` — i.e. plain
   digits under 1,000 and a `K` suffix above, always the AED-converted figure, no currency word,
3. a **row of small round dots, one dot per payment** on that day (up to 4 seen on a single day),
4. a faint tinted background (white/7) and a **coloured inset ring** around the cell.

**Colour coding — the legend at the bottom of the calendar card reads, in this order:**

| Legend swatch | Label | Meaning |
|---|---|---|
| small yellow dot | **Pending** | due, not yet past its date, not paid |
| small red dot | **Overdue** | past its due date and not fully paid |
| small green dot | **Paid** | fully collected |
| small blue rounded square | **Today** | the current date, whether or not it has payments |

How that plays out on a cell: each payment contributes its own dot in its own colour (green /
red / yellow), and the **cell's ring takes the worst status present** — `ring-red-400/40` if any
payment on that day is overdue, otherwise `ring-green-400/30`. Today's cell instead gets a
**blue-tinted background and a blue date number**, and that blue treatment *replaces* the status
ring (7 September had no payments, so no ring; a day that is both today and overdue would show
blue as its cell styling).

Examples read live in September 2026:

| Day | On the cell | Dots | Ring |
|---|---|---|---|
| 1 | `1` / `87` | 1 green | green |
| 2 | `2` / `353` | 1 red | red |
| 3 | `3` / `76.3K` | 2 red | (none — this was the selected day, selection overrides) |
| 7 (today) | `7`, no amount | none | blue background + blue number |
| 4–6, 8–30 | dim number only | none | none |

### The right-hand day panel — every field of a payment entry

Header row: **the full day name and date** on the left (`Tuesday, September 1`,
`Wednesday, September 2`, `Thursday, September 3`, `Wednesday, August 12` …) and **the day's AED
total** on the right (`AED 87`, `AED 353`, `AED 76,302`, `AED 10,101`) — the total is omitted
when the day has no payments. The panel is sticky, capped at `100vh − 120px`, and scrolls its own
list when a day holds many payments.

Each payment is one card with these fields, top-left to bottom-right:

| Field | What it holds | Live examples |
|---|---|---|
| **Client / lead name** (bold white, truncated) | the lead this milestone belongs to | `Stave Corp IN_PROGRESS - 7`, `Stave Corp QUALIFIED - 1`, `Italica`, `Stave Corp ON_HOLD - 1` |
| **Milestone name** (small grey, truncated) | free text typed on the lead | `final`, `second`, `Final Payment`, `Initial Payment`, `Milestone 2 - Sprint Close`, `monthly`, `Monthly SEO` |
| **Recurring mark** | a small repeat icon shown *next to the milestone name*, only when the milestone repeats | present on `monthly`, `Monthly SEO` |
| **Status pill** (top-right of the card) | one of exactly three: **`Paid`** (green pill, green text), **`Overdue`** (red pill, red text), **`Pending`** (yellow, per the legend) | `Paid`, `Overdue` |
| **Amount** (bold white, bottom-left) | the amount **in the currency it was agreed in** | `AED 87`, `AED 40,731`, `INR 9,098`, `INR 260,000`, `INR 47,264` |
| **AED equivalent** (tiny grey, bottom-right) | `≈ AED <n>`, shown **only when the amount is not already in AED** | `≈ AED 353`, `≈ AED 10,101`, `≈ AED 1,836` |
| **Part-paid progress bar** | a thin green fill bar, shown **only when some but not all of the amount has been received** | see below |
| **Part-paid caption** | `<amount> received · <amount> left`, in the original currency | `INR 10,000 received · INR 250,000 left` (on `Italica` → `Milestone 2 - Sprint Close`, 12 Aug 2026) |

So a card can be **Overdue *and* part-paid at the same time** — the pill says Overdue while the
green bar shows what has already come in.

### Tables/lists

There is no table on this screen and no pagination. The day panel is an unpaginated list of that
day's payments (2 entries seen on 3 Sep and 20 Aug), sorted as the data arrives.

### Tabs

None.

### Empty states — all three of them

1. **Day selected, nothing due:** the panel shows the day name and, centred underneath,
   *"No payments due this day"*.
2. **No day selected** (the state you land in after changing month, and the state visible for a
   moment while the page loads): *"Select a day to see payments due"*.
3. **A whole month with no payments** (October, November, December 2026): all four tiles read
   `AED 0` with `0 milestones / 0 paid / 0 pending / 0 overdue`, the Overdue tile drops its red
   styling, every day cell is a dim number with no dot and no ring, the legend still shows all
   four keys, and the panel reads *"Select a day to see payments due"*.

### Realtime/auto

Nothing moves on its own. The page fetches once per month view and does not poll or auto-refresh.

### What loads first vs what appears after

1. Click **Payment Calendar** → for roughly the first **0.2 s** the CRM Board is still on screen.
2. At about **0.4 s** the Milestone Calendar frame paints: title, subtitle, all four tile labels
   with an **em-dash `—` instead of a value**, the month name, the full day grid **with date
   numbers only** (no amounts, no dots, no rings), the legend, and *"Select a day to see payments
   due"*.
3. At about **0.6–0.8 s** the data lands in one go: all four tile values and count lines, the
   day amounts + dots + rings, and the panel auto-selects **today** — so it flips to
   `Monday, September 7` / "No payments due this day".

One request per month view: `GET /api/crm/payments/calendar?year=<yyyy>&month=<0-11>` (the month
is zero-based — September 2026 is `month=8`). Each response carries a `summary` block (the four
tiles) and a `dayEvents` map keyed by `YYYY-MM-DD`; each entry carries the amount, the amount
received, the amount pending, the currency, the AED conversion, the lead name, the lead id, and
three flags — recurring, overdue, paid — plus a partial flag. That is exactly the field set the
cards render.

---

## Reports — `/crm/analytics`

**Where:** left sidebar → group **Sales** → menu item **Reports**. No tabs, no sub-navigation.
(The sidebar says "Reports"; the page's own H1 says **"Executive Overview"**.)

**What you see on arrival:** a header row — title "Executive Overview" + subtitle "Real-time
performance metrics and sales intelligence." on the left, and a **right-aligned mini-stat**
(`TOTAL PIPELINE` / `AED 1,614,163`) sitting in the header itself. Under it a row of **four
metric cards**. Below that a **two-thirds / one-third split**: left column holds the
**Top Performers** table and, under it, the **Team Collaborations** panel; right column holds
**Pipeline Funnel** and, under it, **Latest Wins**. Nothing below that. The page background is
near-black (#09090b), cards are #121214. At 390 px the metric cards go 2×2, the two columns
stack, and the Top Performers table scrolls sideways inside its own card (the page itself does
not overflow).

### Numbers/cards on the page — every tile with its exact label and live value

**In the page header (not a card):**

| Label (exact) | Live value | Note |
|---|---|---|
| `TOTAL PIPELINE` | **AED 1,614,163** | mono type, top-right of the header |

**The four metric cards, left to right:**

| # | Label (exact, uppercase on screen) | Live value | Caption under the value | Icon tint | What it is counting |
|---|---|---|---|---|---|
| 1 | `MONTHLY RECURRING (MRR)` | **AED 162,845** | `Active Retainers` | purple | recurring/retainer revenue per month |
| 2 | `CLOSED REVENUE (ONE-OFF)` | **AED 133,378** | `Project Based Wins` | emerald | one-time project revenue already won |
| 3 | `WIN RATE` | **69%** | `Lead-to-Close Efficiency` | amber | won ÷ (won + lost) |
| 4 | `ACTIVE OPPORTUNITIES` | **49** | `Deals in Progress` | sky blue | live deals across the working stages |

The only thing hovering a metric card does is grow its little icon slightly (a 1.1× scale). There
is no tooltip, no drill-down, no click target.

### Controls — every button on the screen

**There are none.** Inside the page body there is not a single button, link, select, input,
checkbox, radio, tab or focusable control — I enumerated every interactive element in the main
content area and the list came back empty. The only clickable things on the route are the app
shell's own sidebar (`My Portal`, `Global Tasks`, and the Sales group's `CRM Board`,
`Payment Calendar`, `Reports`, `Proposal Exporter`, `Campaign Pages`, plus the group headers
`Sales` / `Marketing` / `Web Projects` / `Finance` / `HR` and `Sign Out`) — which belong to the
shell, not to this screen.

Stated plainly, because the brief asked for each of these by name:

- **Date-range filter / presets: none.** There is no date picker, no "Last 7 days / This month /
  This quarter / Custom" strip, no calendar control — so there are no presets to list, and I
  could not pick a far-past range to see a no-data state, because there is no range control to
  pick with.
- **Person / owner filter: none.** (The Top Performers table lists every agent; you cannot filter
  to one.)
- **Service filter: none. Stage filter: none. Search: none.**
- **Comparison ("vs last month", arrows, deltas, sparklines): none.** Every number is a single
  absolute figure with no trend indicator.
- **Export control: none** — no export button, no download icon, no print control, and therefore
  no format menu to open and no formats to list. Nothing was exported.
- **Chart shape toggles: none.**
- **Row actions / sorting / pagination on the table: none.**

The screen is a read-only dashboard, end to end.

### Every "chart" on the screen — what it IS

There is **no charting library on this page** — no canvas, no Recharts, no plotted axes. The two
visual elements are both **CSS bar/progress compositions**, described here as they are:

**1. Pipeline Funnel** (right column, top card)

- A vertical list of five stages, each a row of: a small coloured status dot on a vertical
  gradient rail down the left, the **stage name** on the left, the **count** on the right in mono
  type, and a **thin horizontal progress bar** (8 px tall) below the pair. There is a small faint
  chevron at the right end of each row.
- The five rows, with the live counts and bar colours:

| Stage label | Count | Bar colour | Bar fill measured |
|---|---|---|---|
| `Leads` | 9 | slate | 42 px of 305 px (≈14%) |
| `Qualified` | 10 | blue | 47 px (≈15%) |
| `Proposal` | 5 | indigo | 23 px (≈8%) |
| `Negotiation` | 7 | purple | 33 px (≈11%) |
| `Won Deals` | 11 | emerald, **gently pulsing** | 305 px — the **full width** |

- So the bar length is *the stage count as a share of all leads ever* (65 in the data behind the
  screen — a number that is never printed anywhere on the page), except **Won Deals, which is
  hard-set to a full-width pulsing emerald bar** rather than a proportional one.
- **Nothing hovers.** No tooltip, no highlight, no click-through, no legend, no axes, no
  percentages printed. It has one shape and no way to change it. It fills the width of its card.
- The bars animate their width in over about 1 second on first paint.

**2. The Top Performers win-rate cell** is the only other bar-like element, and it is just a
tinted pill around a percentage — not a chart.

**Team Collaborations** and **Latest Wins** are lists, not charts (below).

### Tables/lists — every column, every row shape

**Top Performers** (left column, top card). Header row: card title **"Top Performers"** with a
small gold trophy icon, and on the right a static grey badge reading **`Individual`** (a label,
not a switch — there is no "Team" alternative to click).

| Column header (exact, uppercase) | Alignment | What the cell holds |
|---|---|---|
| `AGENT` | left | a **rank medallion** (a circle with the position number — 1 is gold, 2 silver, 3 bronze, then neutral), the **agent name** in white (truncated at 200 px), and the fixed sub-label **`Sales Rep`** under it |
| `REVENUE` | right | AED figure in bold emerald |
| `WIN RATE` | centre | a percentage in a tinted pill — **emerald when above zero, rose when zero** |
| `WON / LOST` | centre | won in white, a grey `/`, lost in muted rose |
| `ACTIVE` | right | a plain count in grey |

Live rows, exactly as shown (6 rows, no pagination, no sort control, no row menu; hovering a row
just lightens its background):

| # | Agent | Revenue | Win rate | Won/Lost | Active |
|---|---|---|---|---|---|
| 1 | **Unassigned** · Sales Rep | AED 296,223 | 69% | 11 / 5 | 41 |
| 2 | Rayan Patel · Sales Rep | AED 0 | 0% | 0 / 0 | 2 |
| 3 | Rohit Vinod · Sales Rep | AED 0 | 0% | 0 / 0 | 2 |
| 4 | Info Nexeor · Sales Rep | AED 0 | 0% | 0 / 0 | 1 |
| 5 | Syeda Umme Kulsum · Sales Rep | AED 0 | 0% | 0 / 0 | 2 |
| 6 | Amal Vijayakumar · Sales Rep | AED 0 | 0% | 0 / 0 | 1 |

**Latest Wins** (right column, bottom card). A scrolling list of 5 rows, each a pill with a soft
emerald left-to-right gradient:

| Field | What it holds | Live values |
|---|---|---|
| Client name (bold white, top-left) | **renders empty on every row** — the row's name line has zero height | *(blank ×5)* |
| Closer line (tiny emerald, under the name) | `Closer: <name>` | `Closer: System` on all five rows |
| Amount (bold emerald, right) | the won value | `AED 0`, `AED 30,000`, `AED 76,236`, `AED 4,000`, `AED 19,511` |
| Revenue kind (tiny grey caps, under the amount) | `MRR` or `ONE-TIME` | MRR, MRR, MRR, **ONE-TIME**, MRR |

The list has its own scrollbar; only 5 wins are supplied.

### Tabs

None on either screen.

### Empty states

- **Team Collaborations** (left column, bottom card): title **"Team Collaborations"** + a static
  grey badge **`Joint Deals`**, and inside a **dashed-border box** the italic grey line
  *"No joint deals recorded yet. Add multiple owners to a lead to track team stats."* That is its
  live state right now — the underlying list is empty.
- I could not produce a "range with no data" state for the rest of the screen, because the screen
  has no range control (see Controls above). The tiles have no zero-state variant to trigger.

### Realtime/auto

Despite the subtitle "Real-time performance metrics", the screen **does not update itself**. I
sat on it idle for 75 seconds and it issued **zero** further requests — no polling, no socket, no
timed refresh. The numbers are as of page load; you refresh or re-navigate to move them.

### What loads first vs what appears after

The page issues three requests on arrival: `GET /api/settings/rbac`, `GET /api/crm/stats` and
`GET /api/auth/session`. The whole body (all four metric cards, the table, the funnel, both
lists) fills in from the single `/api/crm/stats` response, so the screen goes from empty frame to
fully populated in one step — there is no per-card staggering and no skeleton state as distinct
as the calendar's `—` placeholders. The funnel bars then animate their width in over ~1 second.

`/api/crm/stats` returns five blocks that map one-to-one onto the screen: `kpi` (the header
figure + the four cards), `leaderboard` (Top Performers), `groupLeaderboard` (Team Collaborations
— currently an empty array), `funnel` (the five stage counts), `recentWins` (Latest Wins).

---

## Do the Reports numbers agree with the CRM Board's own column totals?

Read on the CRM Board (`/crm`) the same session, same account:

| Board column | Count | Column total |
|---|---|---|
| LEAD | 9 | AED 263,374 |
| QUALIFIED | 10 | AED 349,445 |
| PROPOSAL | 5 | AED 187,419 |
| NEGOTIATION | 7 | AED 343,122 |
| ON_HOLD | 5 | AED 160,802 |
| IN_PROGRESS | 13 | AED 246,282 |
| LOST | 5 | AED 165,069 |

**The counts agree exactly.**

- Funnel `Leads 9` = board LEAD 9 · `Qualified 10` = QUALIFIED 10 · `Proposal 5` = PROPOSAL 5 ·
  `Negotiation 7` = NEGOTIATION 7. ✔
- `ACTIVE OPPORTUNITIES 49` = LEAD 9 + QUALIFIED 10 + PROPOSAL 5 + NEGOTIATION 7 + ON_HOLD 5 +
  IN_PROGRESS 13 = **49**. ✔ (LOST is excluded, correctly.)

**The money does not agree.** Adding the same six active columns gives **AED 1,550,444**, while
the Reports header says **TOTAL PIPELINE AED 1,614,163** — a gap of **AED 63,719**. Both figures
are recorded under *Odd things I noticed* below; I did not go looking for the cause.

---

## Odd things I noticed

- **Total Pipeline vs the board columns disagree by AED 63,719.** Reports header:
  `TOTAL PIPELINE AED 1,614,163`. The six active CRM Board columns add up to `AED 1,550,444`
  (263,374 + 349,445 + 187,419 + 343,122 + 160,802 + 246,282). The deal *counts* match perfectly
  (49), so the two screens agree on which deals are in the pipeline and disagree on their value.
- **Every "Latest Wins" row has a blank client name.** The bold white name line is present in the
  layout but measures zero pixels high on all five rows, so each win reads only
  "Closer: System / AED 30,000 / MRR" with nothing above it. The data behind the list carries an
  id, a value, a stage and an owner — but no client or lead name at all, so there is nothing for
  that line to print.
- **"Closer: System" on all five wins**, because the owner field is empty on each — the same
  reason the Top Performers table's number-one seller is called **"Unassigned"** and holds
  AED 296,223 of the AED 296,223 total revenue. All five named agents show AED 0.
- **The subtitle promises "Real-time performance metrics" and the screen never refreshes** — 75
  seconds idle, zero requests.
- **"Still to collect" says `0 pending` while showing AED 76,655.** The value is expected minus
  received; the count underneath counts only *pending* (future-dated) milestones, of which there
  are none in any month I looked at. The two lines are measuring different things.
- **The "Pending" (yellow) colour in the calendar legend has no live example anywhere.** Every
  month from January to December 2026 reports `0 pending` — everything unpaid is already past its
  date, so it reads Overdue. The yellow key is documented but never exercised.
- **Won Deals is the only funnel bar that isn't proportional** — it is pinned to full width and
  pulses, while the other four are drawn as a share of the 65 total leads. So the funnel doesn't
  read as a funnel: the last bar is always the longest.
- **The funnel's denominator (65 total leads) is never shown on screen** — it silently sets every
  bar length.
- **Two screens, two names each.** The sidebar says "Payment Calendar" and the page says
  "Milestone Calendar"; the sidebar says "Reports" and the page says "Executive Overview".
- **The Reports screen has no controls at all.** For a screen called "Reports" there is no date
  range, no filter, no export and no print — nothing to narrow or take away.
- **Many milestone names are placeholder text** on the demo data: `fhbdskjvbkdh`, `ettdfgd`,
  `ABCDEFG`, and lead names like `Stave Corp IN_PROGRESS - 7` / `Dharamvaak (Test)`.
- **The calendar's day totals abbreviate to one decimal `K`** (`76.3K`), so a day holding
  AED 76,302 and a day holding AED 76,349 look identical on the grid; the exact figure only
  appears once you select the day.

---

## In human language — every feature in this area, as points

- **Payment Calendar (a month view of money you are owed)** — a normal month calendar where each
  day shows how much money is due from clients that day. Click Sales, then Payment Calendar in
  the left menu. It is for answering "what is landing this month, and what has not landed?"
  without opening a single client file.

- **The four money boxes at the top of the calendar** — four small boxes reading *Expected this
  month*, *Received*, *Still to collect* and *Overdue*, each with an amount and a count. They
  change to match whichever month you are looking at. They are the one-glance answer to "how is
  this month going for cash?"

- **The red box for late money** — the *Overdue* box turns red and outlined the moment even one
  payment is late in the month you are viewing, and goes back to plain grey in a month where
  nothing is late. It exists so late money cannot hide in a wall of grey boxes.

- **Money shown on the day squares** — a day that has money due shows the amount right on the
  square, shortened (76.3K instead of 76,302), so you can scan a whole month in one look and see
  where the big days are.

- **Coloured dots on the day squares, one per payment** — a green dot for money already received,
  a red dot for money that is late, a yellow dot for money due but not late yet. Three payments
  that day means three dots. It tells you not just how much, but what shape that day's money is in.

- **The coloured outline round a busy day** — the square gets a red outline if anything on that
  day is late, green if everything is settled. It is the "is this day a problem?" signal from
  across the room.

- **Today, marked in blue** — the current date is shaded blue with a blue number, and there is a
  small blue key at the bottom of the calendar telling you that is what blue means.

- **The colour key under the calendar** — a little four-item legend spelling out Pending,
  Overdue, Paid and Today, so nobody has to guess what a colour means.

- **Clicking a day to see who owes what** — click any square and the panel on the right fills in
  with that day's payments: the client's name, what the payment is called, whether it is Paid,
  Overdue or Pending, and how much. It turns "there's 76.3K on the 3rd" into "it's these two
  clients."

- **The day panel's own total** — the panel header shows the day's date in full and the day's
  total beside it, so the detail and the sum are in the same place.

- **Payments in the client's own currency, with your currency beside it** — a payment agreed in
  rupees shows as *INR 9,098* with *≈ AED 353* underneath. You see what the client agreed to pay
  and what it is worth to you, without doing the maths.

- **The part-paid bar** — when a client has paid some but not all of a payment, the card grows a
  thin green bar and a line reading "10,000 received · 250,000 left". It stops a half-paid
  payment from looking either settled or untouched.

- **The repeat mark on monthly payments** — a payment that comes round every month carries a small
  repeat symbol next to its name, so a recurring retainer is not mistaken for a one-off.

- **Jump from a payment straight to the client** — clicking any payment in the day panel takes
  you to the sales board with that client open, so chasing the money starts with one click.

- **Stepping month by month** — two arrows beside the month name walk you back through past
  months and forward into future ones. Everything on the page (the four boxes, the squares, the
  colours) rebuilds for the month you land on, so you can look at what was collected in June or
  what is coming in December.

- **The "pick a day" prompt** — every time you change month the right panel resets and says
  "Select a day to see payments due", so you are never looking at yesterday's month with today's
  detail beside it.

- **The quiet day message** — click a day with nothing due and it plainly says "No payments due
  this day" rather than showing an empty box.

- **A completely empty month** — a month with no payments at all shows all four boxes at zero,
  every square plain, and the calendar still fully drawn. Nothing breaks and nothing looks broken.

- **Reports (the sales scoreboard)** — one page of the agency's sales numbers: how much money is
  in play, how much comes in monthly, how much has been won, how often you win, who is selling,
  and where deals are stuck. Click Sales, then Reports. It is the "how are we doing?" page you
  open in a Monday meeting.

- **Total Pipeline, in the page header** — the single biggest number, top-right: everything
  currently in play across all live deals, added up in your own currency.

- **Monthly Recurring box** — how much money comes in every month from retainer clients. This is
  the number that tells you whether the agency has a floor under it or starts from zero each month.

- **Closed Revenue box** — the money already won from one-off projects, as opposed to monthly
  retainers. It separates "we did a job" income from "they pay us every month" income.

- **Win Rate box** — the percentage of deals you win out of the ones you win or lose. It answers
  "when we chase something, how often do we get it?"

- **Active Opportunities box** — the plain count of live deals still being worked. It is the
  workload number: 49 things in the air right now.

- **Top Performers table** — a ranked league table of the sales people: their position, name,
  revenue brought in, win rate, their won-versus-lost record, and how many deals they are
  currently sitting on. Gold, silver and bronze circles mark the top three. It is for seeing who
  is carrying the sales and who is quiet.

- **The zero-versus-something colouring in that table** — a win rate above zero shows green, a
  win rate of zero shows red. You read the table's health without reading the numbers.

- **Team Collaborations panel** — a place for deals worked by more than one person, so shared
  wins get shared credit. Right now it is empty and says so, and it tells you exactly how to fill
  it: put more than one owner on a deal.

- **Pipeline Funnel** — five bars stacked down the right: Leads, Qualified, Proposal,
  Negotiation, Won Deals, each with how many deals are sitting at that step and a bar showing how
  big that step is. It is for spotting where deals pile up and stop moving.

- **Latest Wins list** — the five most recent deals won, each showing who closed it, how much it
  was worth, and whether it is monthly money or a one-off. It is the good-news feed and the
  freshest proof of what is working.

- **The monthly-versus-one-off tag on each win** — every win is labelled either MRR (monthly) or
  ONE-TIME, so you know whether a win adds to next month's floor or is a single payday.

- **Both screens read the whole agency, not one client** — the calendar collects payments across
  every client and lead, and the scoreboard adds up every deal, so neither needs you to pick a
  client first.

- **Both screens work on a phone** — the boxes rearrange into two columns, the columns stack, and
  the scoreboard's table slides sideways inside its own card rather than pushing the page wide.

- **Neither screen can change anything** — there is nothing on either page to create, edit, send,
  approve or delete. The calendar's payments are set up on the client's own record; these two
  screens only report. That makes them safe to leave open in front of anyone.

- **What these two screens deliberately do NOT have** — the calendar has no week or list view, no
  "jump to today" button, no way to filter by client, owner or status, and no add-a-payment
  button. The scoreboard has no date range, no month-versus-month comparison, no filter by person
  or service, and no export or download of any kind. If the owner expects to pull a PDF or a
  spreadsheet out of Reports, that does not exist here today.
