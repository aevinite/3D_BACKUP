# MASTER PLAN — InfiniDine (working name) · nextjs_MENU_FINAL

> THE single source of truth for everything we're building. Written 2026-06-12 from
> the owner's instructions + Petpooja research. The owner is a beginner — keep all
> work explained in plain language. **Git rule: COMMIT but NEVER PUSH until told.**

## The product in one line

A restaurant operating system: guest menu + admin panel + editor + kitchen panel +
waiter tablet, all on ONE backend — where the admin panel can switch every feature
ON/OFF per restaurant (the future hybrid-SaaS model).

---

## 1. NEW CODE STRUCTURE (owner's design)

The repo root IS the **Admin Panel** ("the crazy one"): runs LOCALLY only, never
deployed. It is the master control room — every feature of every other panel can be
turned on/off here (e.g. switch "ratings" off → ratings disappear everywhere).

```
nextjs_MENU_FINAL/          ← root = ADMIN PANEL (local only, feature flags, master controls)
├── menu/                   ← the GUEST MENU app — pushing/deploying THIS folder alone
│                              gives the public site (what customers scan)
├── editor/                 ← the BOSS panel (current editor: floor, orders, menu editing)
├── kitchen/                ← KITCHEN PANEL: incoming orders only + "order ready" flow
├── tablet/                 ← WAITER TABLET: live table map, take orders FOR customers
│                              (when a guest calls the waiter to order manually)
└── supabase/               ← the shared backend (one database serves all panels)
```

- Database changes WILL be needed (feature-flag table, panel/device roles, KOT
  numbers, etc.). This workspace has its OWN Supabase project (keys in .env.local —
  never print them). It is fully seeded and identical to the old project as of
  2026-06-12 (34 migrations + menu data).
- Old workspace `backup_Menu` stays as the live/demo version until this replaces it.

## 2. INTERFACE RULES (apply to every panel, always)

- **User-friendly above all**: easy to use, easy to access, easy to change anything.
- **Responsive by default** — fluid grids, no dead gaps, works phone→desktop.
- **Two-step confirm** ("Are you sure?") on every destructive or easily-misclicked
  action (kick, ban, transfer, close table, delete dish, day close…). Big/scary
  variants for floor-wide actions. Undo toasts where possible.
- Owner mentioned "/color blue" — confirm with him: likely a BLUE accent theme for
  the new panels (kitchen/tablet/admin) to tell them apart from the gold guest menu.
- Plain-language labels, no jargon on staff screens.

## 3. FEATURE BACKLOG — the full list

### 3.1 FIRST UP (owner picked): Petpooja-style dine-in menu UX
Researched live at dinein.petpooja.com (gaming café, table G5):
- **Scroll-spy category bar**: as the guest scrolls the menu, the active category
  chip in the sticky top bar switches automatically (Coffee → Beverages → …), and
  the bar auto-scrolls horizontally to keep the active chip in view. Tapping a chip
  scrolls to that category. (VERIFIED in their live app — chip got orange highlight
  + checkmark + underline as its section entered view.)
- Sticky search + category bar while scrolling.
- Bottom tab bar on the guest app: Home / Menu / Orders / Pay Bill.
- Truncated dish descriptions with "Read More".
- "Group Order" entry chip in the header (we already have table sessions — surface
  them like this).

### 3.2 KOT / POS / Kitchen
- **KOT (ticket) numbers**: every order gets a short daily serial (#47) staff can
  shout. Show it on guest tracker, kitchen panel, editor, bills.
- **Kitchen panel** (kitchen/ folder): live incoming orders, per-dish cooking
  status, big "Order ready" action; kitchen can mark a dish out-of-stock.
- Station routing (drinks vs kitchen) — later, with printer support (much later).

### 3.3 Billing & money (no payment gateway yet)
- **Visible IDs everywhere**: short order ID + bill ID per table session (owner:
  "put only particular order ID, bill ID, everything").
- **Table shift/transfer**: move a party + their orders + bill to another table.
- Merge tables / split bill (by item or person), discounts & coupons, extra charges.
- GST-ready invoice: per-restaurant GSTIN setting, sequential immutable invoice
  numbers, CGST/SGST breakup, tax-inclusive/exclusive setting, Bill of Supply mode.
  (Software side only — needs NO company registration to build.)
- Payment MODE recording (cash/card/UPI as labels), day-end totals.

### 3.4 Waiter tablet (tablet/ folder)
- Live table count + states (reuse floor board), waiter takes orders on behalf of
  a table (when called to order manually), sees calls/requests, settles bills.

### 3.5 Admin panel (root — the feature-flag brain)
- Per-restaurant **feature flags**: every feature toggleable (ratings, 3D, sessions,
  geofence, languages, allergies, reviews, waiter calls, …). Off = fully gone from
  the guest/staff UIs.
- Master settings: restaurant identity, tables, taxes, panels on/off.
- Runs locally only.

### 3.6 Dashboard & analytics (owner: "full graph type shit")
- Sales over time (day/week/month), per-dish performance, per-category & future
  sub-category breakdowns, order counts by hour, table utilisation, waiter-call
  volume, average ticket size. Graphs, not just tables of numbers.

### 3.7 CRM & customers (build the parts that need no SMS provider)
- Customer database from sessions (names/phones when verification lands), order
  history per customer, visit counts.
- Feedback collection after billing; loyalty points (earn/redeem rules) later.
- SMS/WhatsApp campaigns & e-bills → DEFERRED (external providers).

### 3.8 Misc backlog
- Reservations / waitlist.
- Staff accounts, roles & permissions, audit log (who voided what).
- Reports library (start with ~10 useful ones, not 80).
- Multi-outlet support (rides on the feature-flag/SaaS architecture).
- Sub-categories in the menu structure (affects DB + editor + guest UI).

### 3.9 DEFERRED — SECOND-LAST (owner's explicit order)
- Phone number verification + email verification (OTP). The seam exists in code.

### 3.10 DEFERRED — LAST (external approvals / paid / government)
- Payment gateway integration (UPI/cards in-app).
- Zomato / Swiggy aggregator APIs (partner-gated).
- GST government filing integrations (e-invoice APIs etc.).

---

## 4. BUILD ORDER (proposed)

| Phase | What | Why this order |
|---|---|---|
| 0 | **Scroll-spy category bar + dine-in UX polish** (owner's pick) | Guest-visible win, no DB changes, sets the interface standard |
| 1 | **Folder restructure** (menu/ editor/ kitchen/ tablet/ + admin root) + **feature-flag system** (DB table + admin UI skeleton) | Everything later plugs into this skeleton — do it before adding panels |
| 2 | **Kitchen panel + KOT numbers** | Highest daily-use value; mostly reuses existing order data |
| 3 | **Waiter tablet** | Reuses menu + ordering + floor board |
| 4 | **Billing depth**: order/bill IDs, table shift, split/merge, discounts, GST fields | The biggest Petpooja gap |
| 5 | **Dashboard & analytics graphs** | Needs the order data the earlier phases enrich |
| 6 | **CRM-lite + feedback + reports** | Builds on customer/order history |
| 7 | Phone/email verification (SECOND-LAST, owner's order) | |
| 8 | Payments, Zomato/Swiggy, GST e-invoicing (LAST — external) | |

Each phase = build → robot verify script → owner's 10-minute phone walkthrough →
commit (NO push).

## 5. RESEARCH NOTES — Petpooja (for parity checks)

From petpooja.com + their live dine-in app: 3-click billing; split/merge/move
bills; KDS with station-wise orders + out-of-stock marking; Captain App (orders,
reservations, billing at table, payment gateways); CRM (customer pool labels,
campaigns, loyalty, feedback); 80+ reports; aggregator integrations (Zomato,
Swiggy, Dineout) with stock sync + reconciliation, zero commission; QSR token
mode; marketplace of 200+ integrations; staff rights to prevent fraud/pilferage.
Their dine-in guest app: sticky search+categories with scroll-spy, bottom tabs
(Home/Menu/Orders/Pay Bill), Group Order, veg dots, Read More descriptions,
+Add on photos.

## 6. OUR EDGE (never lose while copying their checklist)

Table sessions (head/approve/transfer social model), 3D dishes, 6 languages,
allergy intelligence, no-app no-login ordering, server-authoritative pricing,
27-check robot test suite. Petpooja is staff-first; we are guest-first AND
becoming staff-complete.
