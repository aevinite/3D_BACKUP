# Access & permissions — THE NEW MODEL (owner rebuild, 2026-07-31)

> **This replaces `docs/ACCESS-LADDER.md` completely.** The old 4-rung ladder
> (`admin → owner → manager → tablet` on *every* feature, ~54 sub-checkboxes of which 45 were
> read by no code) is being **deleted as a concept**. Do not add anything to the old shape.
> Status: **BUILT** — all six phases below are done. `docs/ACCESS-LADDER.md` is **kept as HISTORY
> only** (it was never actually deleted — this line used to claim it had been). Read it to
> understand what the old shape was; never add to it.

## The one sentence

**A toggle exists only where the owner listed one.** Everything else in the app is
**permanently ON** for whoever's panel it belongs to — no switch, no greyed-out ghost, no
`access_config` key. If a capability has no toggle in this document, it is not configurable.

Three consequences, applied everywhere:

1. **No dead switches.** A control that no server code reads gets deleted, not hidden.
2. **No greyed-out ghosts.** If a role can never reach a thing, that thing is **absent** from
   that role's screen — not shown disabled with a tooltip. (Killed: the manager's
   Billing / Kitchen / Dining-sessions rail stubs and the "Defaults for everyone" card.)
3. **The admin owns every switch.** Owners and managers configure nothing about permissions.

## Where the switches live

| Screen | Who | What it holds |
|---|---|---|
| `/aevinite` → **Access & permissions** | Admin only | **Everything** in this document |
| `/aevinite` → **Restaurants → <a restaurant>** | Admin | **NO permissions at all.** Identity, owner assignment, branding, tables & QR, status. Every feature/permission card is removed from here. |
| Owner panel | Owner | **nothing** (they *use* features; they don't switch them). The last exception went on 2026-08-04: `/owner/staff` still rendered nine per-person waiter tri-states from a private list in that file. Deleted. |
| Manager panel → Settings | Manager | per-table name/seats/QR only — no Access screen, no defaults, no admin-only stubs |

---

## SECTION A — MAIN FEATURES  ·  and A2, "EXTRA FEATURES"

What this restaurant *has*. Each row is one master toggle; its sub-tree only renders when the
master is on. Order is fixed.

**Two cards on screen, not one** (owner, 2026-08-01 — "so that main features doesn't look too
full and looks organised"). The line is what a restaurant runs on EVERY day versus what it takes
on as well:

| **Main features** | **Extra features** |
|---|---|
| Menu (and its whole sub-tree) · Auto-print KOT · Quick order / Parcel · Orders without a table · Bill · Table | Pay later (khata) · Banquet billing · Staff profiles & pay · Inventory |

So A2–A7 below describe rows that live on the **Extra features** card, all OFF by default. Their
storage, defaults and dropdowns are unchanged — only which card they sit on.

### A1 · Menu  *(the whole guest menu)*

Master OFF ⇒ **there is no guest menu at all** — no QR menu, no `/r/<slug>/menu`, no guest
routes. The restaurant runs on staff panels only.

| Sub-option | Default | What it does |
|---|---|---|
| **Dining sessions** | **OFF** | The table-session system (`sessions_enabled` + require-location / geofence / OTP). **OFF removes the "Open table" step entirely** — the floor switches to DIRECT ORDERING: staff punch an order straight in without opening a table first (owner, 2026-07-31). This is a staff-panel behaviour change, not only a guest one. |
| **Ratings** | *menu rating only* | Single-choice: `menu rating only` · `Google review only` · `both — Google after the menu one`. Maps to the existing `google_review_mode`. |
| **Show reviews** | ON | Written reviews wherever they appear: the menu list, the dish detail page, and the "what others wrote" panel beside the rating box. |
| **3D viewer** | ON | The rotating dish model. Off ⇒ the dish shows "3D preview not available". |
| **Allergy & notes** | ON | Allergen badges + the allergy/notes step at ordering. Two subs, **both ON**: ① guest may type **their own allergy** ("Other…") ② guest may **write their own note**. Off = preset allergies/notes only; nothing free-text. |
| **Put menu on maintenance** | **OFF** | Hands someone the red "close the menu to diners" control in their own Settings — `access_config.maintenance.on`, enforced on the WRITE at `/api/maintenance`. Its one sub-option, **Who may do it**, is `Owner only` (default) or `Owner and manager`. OFF for every restaurant until it is deliberately handed over. |
| **Favourites** | ON | The heart + Favourites tab. (Loyalty will build on this later.) |
| **Veg / non-veg** | ON | The veg/non-veg filter chips **and** the veg icon on dishes. Off for pure-veg restaurants. |
| **Bubble effect** | ON | The rising bubble particles on the guest menu background (`bubbles_enabled`, read by `lib/menu.ts`). Off gives a flat, calm background. |
| **Design and styling** *(last)* | — | Default menu layout (grid/list), default light/dark, menu theme, **languages** (one or many — default English only), **currency** (default ₹). With a single language + single currency the guest-side switchers are **removed**, not disabled. |

### A2 · Pay later (khata)
OFF ⇒ the khata tab/entries disappear from the **manager** and **owner** panels entirely.

### A3 · Parcel + Platforms — ONE PERMANENT FEATURE (mig 263, 2026-08-03 — supersedes the table below)

**Read this first.** Neither one is a switch any more. The owner made both permanent on
2026-08-03 ("the parcel counter should not have a toggle option… permanently there"):
`parcelLadder()` and `platformLadder()` in `lib/tableTags.ts` are hard-coded ALWAYS_ON, and the
only switches left are the three delivery CHANNELS (`settings.platform_channels` — Zomato,
Swiggy, own website), each with its own API key. There is no `Parcel` row and no `Platforms`
row on the Access screen; where a parcel can be SENT is decided inside Quick order / Parcel
(`qop_parcel_allowed`).

The table below is the one-day mig-259 shape and is kept only to explain why the two were ever
told apart — do not implement from it.

#### (history) mig 259, 2026-08-02 — the day they were two rows

They were ONE row ("Takeaway & delivery") between migs 235 and 259. They are not one thing,
and merging them cost a real order: a restaurant with no delivery account has Platforms OFF,
which silently removed the counter-parcel button — the floor still offered Parcel and the
server refused the finished order at the last tap. Keep them apart.

| | **Parcel — counter takeaway** | **Platforms (Zomato, Swiggy, own website)** |
|---|---|---|
| Where on the screen | **Main** features (everyday running) | **Extra** features (an add-on) |
| Default | **ON** — it replaced a button every floor had | **OFF** — needs an account first |
| Columns | `parcel_allowed / _owner_control / _enabled` | `takeaway_allowed / _owner_control / _enabled` |
| Ladder | `parcelLadder()` | `platformLadder()` = `takeawayLadder()` |
| What it is | An order the restaurant's OWN staff punch in at the counter: ⚡ QO/P → Parcel, tablet ☰ → New parcel, the Parcel tiles under the live floor, the parcel bill | Orders that ARRIVE from outside: each channel switched on separately with its own API key; a channel with no credentials reads "not connected", never broken UI |
| Off means | No Parcel bar on QO/P, no tablet entry, no parcel tiles — and the endpoint refuses, for the admin too | No delivery side of the 🛵 board, webhooks refused — parcels are untouched |

Both kinds of order are stored in `aggregator_orders` and share the 🛵 board; that is a
storage detail, not a shared switch. The board **names itself** after what the restaurant
has: both ⇒ "🛵 Platform", parcel only ⇒ "🥡 Parcels".

### A4 · Auto-print KOT
### A5 · Banquet billing
### A6 · Payroll   — sub: show payroll cost inside the main reports as an expense line
### A7 · Inventory — sub: show inventory cost inside the main reports as an expense line
### A8 · Bill
A pure group — a restaurant can always issue a bill, so there is no on/off. What is inside:

| Row | Default | What it does |
|---|---|---|
| **What a menu price means** | *GST is added on top* | `price_tax_mode` — `excl` · `incl` · `composition`. Read by `lib/tax.ts` on every money path, so the bill, the guest cart and the reports can never show three different totals. Composition prints **no tax line at all**. |
| **Let individual dishes differ from this** | **OFF** | `item_tax_modes_allowed` — needed for MRP items (a sealed bottle). OFF means a dish's own tax setting is **ignored**, not merely hidden. Its sub-option **GST on MRP items** (`mrp_tax_treatment`) is `No GST` (default) or `GST is inside the MRP price`. |
| **Format of KOT bills** | — | The dine-in bill editor (GSTIN, legal name, address, phone, invoice prefix, tax rows, footer, ask-for-customer-name). Preview renders `/panels/billdoc.js` — the very page the manager panel hands the printer. |
| **Format of parcel bill** | — | The same, for a parcel: no table, says PARCEL. |
| **Bill design editor** | — | **LEFT TO BUILD**: ships as a labelled preview, stores nothing. |

All three tax rows are **admin-only** (owner, 2026-08-04): no owner and no manager screen offers them.

---

## SECTION B — MANAGER (restructured by the owner, 2026-08-02)
Three sub-groups, in his words: *"in the manager, there will be three suboption — manager's
menu, permission for manager, manager settings."*

1. **Manager's menu** — exactly FOUR rows: `Edit menu (Editor)` · `Rating review` (renamed
   from Ratings — label only, keys unchanged) · `Audit & logs` (renamed from Audit,
   2026-08-02 — label only, the tab key stays `log` and the grant stays `view_logs`; its
   sub-options are the tab's three VIEWS — **Removals record** · **Activity log** ·
   **Customer log** — stored at `access_config.view_logs.manager_opts.*`, ABSENT = ON,
   enforced at GET `/audit`, `/oplog` and `/users`; recording a removal is never gated) ·
   `Dashboard`. The first three carry the TWO-CONTROL row:
   **Feature** (`access_config.menus.manager[key]` — OFF removes the menu from EVERY
   manager, whatever their per-person setting; the tab is gone and tabGate refuses) and
   **Default** (`manager_permissions[flag]` — what a manager on "Default" follows, and what
   every NEWLY CREATED manager gets, since new people are created with `permissions: {}`).
   `Tables` · `Platform` · `Bills` · `Settings` are **FIXED** — every manager always has
   them, so they have no row (no row = permanently on; `MANAGER_TAB_KEYS` no longer lists
   `bills`, and a stored `menus.manager.bills=false` is ignored like every retired key).
   **Edit menu OFF ⇒ the tab is GONE and its endpoints refuse, reads included.** `tabGate()` in
   `app/api/editor/[...path]/route.ts` runs inside GET as well as the write verbs and answers
   403 *"the menu editor isn't part of this restaurant's manager panel"* for `items` /
   `categories` / `filters`. This paragraph used to promise a read-only "View menu" VIEWER
   instead; no such viewer exists, and the model's own row text always agreed with the code
   ("The Feature switch removes it from every manager of this restaurant"). Corrected
   2026-08-04 — if the viewer is wanted, it is a build, not a description.
2. **Permission for manager** — `Delete a bill` · `Reopen a bill` (**default OFF for every
   restaurant** — owner, 2026-08-02, superseding his earlier same-day word that it ships on;
   with **Only within**, default **5 min**, enforced at the void-invoice endpoint for a real
   manager) ·
   `Discount a bill` (with the % cap, default **50%** for a manager, 5% for a waiter —
   `lib/discountCap.ts` falls back to these model defaults when nothing is stored) ·
   `Bills` (owner, 2026-08-03 — a folder, not a switch: the Bills tab stays fixed) with
   **"Which bills they can see"** — `Today only` (every restaurant's default) or
   `Today + yesterday`. Stored at `access_config.view_bills.manager_opts.range`, read by
   `lib/dashRange.ts → billsReach()`, carried to the panel by `/whoami` and ENFORCED at
   `GET /orders?bills=` + every bill search (the free date search left the panel with it).
3. **Manager settings (what manager can do)** — only `Tables — name & seats` · `Users —
   staff logins` · `Sections — who serves which table`. Billing/kitchen/sessions rows were
   removed (admin-only in the panel — dead switches). The Users rules: a manager may
   CREATE (new logins start on Default), RESET a password and DISABLE (the person is told
   *"This login has been disabled"* at sign-in) — a manager can **never DELETE** a login.
Off ⇒ the row's tab/section is gone for a real manager and the server refuses its endpoints.

## SECTION C — OWNER'S MENU
`Edit menu` · `Ratings` · `Audit & logs` (renamed from Audit, 2026-08-02 — the section key
stays `logs`; the old duplicate "Activity log" child bound the SAME switch twice and is
gone; its sub-options are the page's two VIEWS — **Removals record** · **Activity log** —
stored at `access_config.view_logs.owner_opts.*`, ABSENT = ON, enforced at
`/api/owner/audit` and `/api/owner/oplog`) · `Manager mode`.

## SECTION D — WAITER  (rebuilt to the owner's rule, 2026-08-04)

His words: *"Tablet will not have option of print and reopen bill and stuff. They can only mark
as paid — only if permission is given, through Access and the permission."*

Two folders, the same shape as Manager. Every row is a tri-state (`Off` · `On` ·
`On + manager PIN`) and every one is per-person overridable on the Per-person tab.

**1 · Permission for waiter** — what a waiter may do with money. All OFF except the walk-out.

| Row | Stored at | Default | Notes |
|---|---|---|---|
| Mark a bill paid | `settings.tablet_mark_paid` | **Off** | The one power the owner asked to be handed over deliberately. |
| Discount a bill | `settings.tablet_discount` | **Off** | Child: the % ceiling (default 5% for a waiter, 50% for a manager). Shares the restaurant-level Feature switch with the manager's discount row. |
| Close a table that still owes money | `access_config.close_unpaid.tablet` | **On + manager PIN** | A walk-out. Its own key since 2026-08-04 — it used to hang off `void_bills.tablet`, i.e. off the row labelled "Reopen a bill", which is a different act. Migration 268 carries stored values across. |

**NOT here, and not grantable to a tablet at all:**
- **Print / issue an invoice** — `WAITER_NEVER` in `lib/accessTree.ts`. `waiterCapValue()` answers
  `"off"` for `tablet_invoice` whatever is stored, `tabletPerm()` refuses it for a real waiter, and
  the button is hidden because the server sends the resolved value. There is no row, so there is
  nothing to switch on.
- **Reopen a bill** — a manager row only. The waiter's `capTablet: "void_bills"` row is gone.

**2 · What a waiter can do on the floor** — how the tablet does its job. All **ON**.

`Take an order` (`tablet_take_orders`) · `Move, merge or split a table` (`tablet_table_ops`) ·
`Mark a table's type` (`tablet_table_tags`) · `Pay later (khata)` (`tablet_khata`) ·
`Parcel` (`tablet_parcel`) · `Banquet billing` (`tablet_banquet`).

A module that is off still removes its own (no khata module ⇒ no khata on the tablet, whatever
the row says).

### Why these six rows had to exist — the bug they repair

The model used to say these were *"permanently on for whoever's panel owns them, so removing
them from this list is the whole change"*. That is true for a MANAGER (an absent
`manager_permissions` key reads as the model's default) and **the exact opposite for a waiter**: a
waiter's power is a stored `settings.tablet_*` tri-state, `tabletPerm()` read
`settings[key] || "off"`, and `lib/settingsClone.ts` wrote `'off'` into every new restaurant.
Measured on the backup database on 2026-08-04:

```
aangan / green-bowl / taco-fiesta / demo-bistro / burger-barn /
spice-route / sakura-sushi / pizza-palace   mark_paid=off invoice=off table_ops=off
french-house                               mark_paid=on  invoice=on  table_ops=on
```

Eight of nine restaurants: a waiter could not settle a bill, and **no screen could change it** —
while the waiter panel's own admin ribbon offered *"⚙ change in Access"* for a switch that did not
exist. `waiterCapValue()` is now the ONE answer for the screen, the panel and every endpoint
(never-list → off · listed row → stored-or-default · **unlisted → on**), and migration 268 makes
the stored data agree with the defaults above.

The **daily report** the manager dashboard generates and the **owner's daily analysis report**
are the SAME report, one design. *(LEFT TO BUILD: the owner picks which sub-reports get sent,
and the chosen ones also appear at the bottom of the dashboard.)*

---

## Build phases
1. Model + storage + admin Access UI (the tree above); everything unlisted becomes always-on.
2. Guest-menu enforcement (A1 and all its subs).
3. Panel-menu enforcement (B, C).
4. Default-set-for-user + per-person (D).
5. Strip permissions out of the restaurant detail view; clean the manager's Settings rail.
6. Rewrite CLAUDE.md + memory; full verification sweep; merge.

**Dev/test (`3-d-backup`) only.** AV live keeps the old model until a separate, explicitly
asked-for release — flipping ~45 switches to always-on would change a paying client's app.
