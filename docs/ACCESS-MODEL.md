# Access & permissions — THE NEW MODEL (owner rebuild, 2026-07-31)

> **This replaces `docs/ACCESS-LADDER.md` completely.** The old 4-rung ladder
> (`admin → owner → manager → tablet` on *every* feature, ~54 sub-checkboxes of which 45 were
> read by no code) is being **deleted as a concept**. Do not add anything to the old shape.
> Status: **BUILT** — all six phases below are done. `docs/ACCESS-LADDER.md` is deleted.

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
| Owner panel | Owner | nothing (they *use* features; they don't switch them) |
| Manager panel → Settings | Manager | per-table name/seats/QR only — no Access screen, no defaults, no admin-only stubs |

---

## SECTION A — MAIN FEATURES

What this restaurant *has*. Each row is one master toggle; its sub-tree only renders when the
master is on. Order is fixed.

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
| **Favourites** | ON | The heart + Favourites tab. (Loyalty will build on this later.) |
| **Veg / non-veg** | ON | The veg/non-veg filter chips **and** the veg icon on dishes. Off for pure-veg restaurants. |
| **Format** *(last)* | — | Default menu layout (grid/list), default light/dark, menu theme, **languages** (one or many — default English only), **currency** (default ₹). With a single language + single currency the guest-side switchers are **removed**, not disabled. |

### A2 · Pay later (khata)
OFF ⇒ the khata tab/entries disappear from the **manager** and **owner** panels entirely.

### A3 · Takeaway & delivery  *(one row, three channels)*
Own-website takeaway + **Zomato** + **Swiggy**. Zomato/Swiggy each need their API credentials,
entered per channel; a channel with no credentials shows as "not connected", never as broken UI.

### A4 · Auto-print KOT
### A5 · Banquet billing
### A6 · Payroll   — sub: show payroll cost inside the main reports as an expense line
### A7 · Inventory — sub: show inventory cost inside the main reports as an expense line
### A8 · Bill
GST number / legal name / bill address text fields, **plus** a **Bill design editor** toggle
(design the whole bill like a document) — **LEFT TO BUILD**: ships as a labelled preview.

---

## SECTION B — MANAGER (restructured by the owner, 2026-08-02)
Three sub-groups, in his words: *"in the manager, there will be three suboption — manager's
menu, permission for manager, manager settings."*

1. **Manager's menu** — exactly FOUR rows: `Edit menu (Editor)` · `Rating review` (renamed
   from Ratings — label only, keys unchanged) · `Audit` (the activity log lives INSIDE it;
   more sub-options to come) · `Dashboard`. The first three carry the TWO-CONTROL row:
   **Feature** (`access_config.menus.manager[key]` — OFF removes the menu from EVERY
   manager, whatever their per-person setting; the tab is gone and tabGate refuses) and
   **Default** (`manager_permissions[flag]` — what a manager on "Default" follows, and what
   every NEWLY CREATED manager gets, since new people are created with `permissions: {}`).
   `Tables` · `Platform` · `Bills` · `Settings` are **FIXED** — every manager always has
   them, so they have no row (no row = permanently on; `MANAGER_TAB_KEYS` no longer lists
   `bills`, and a stored `menus.manager.bills=false` is ignored like every retired key).
   **Edit menu OFF ⇒ the tab becomes the read-only "View menu" VIEWER**, never a vanished
   tab — the manager can browse the whole menu but every edit control is locked and the
   server refuses writes.
2. **Permission for manager** — `Delete a bill` · `Reopen a bill` (with **Only within**,
   default **5 min**, enforced at the void-invoice endpoint for a real manager) ·
   `Discount a bill` (with the % cap, default **50%** for a manager, 5% for a waiter —
   `lib/discountCap.ts` falls back to these model defaults when nothing is stored).
3. **Manager settings (what manager can do)** — only `Tables — name & seats` · `Users —
   staff logins` · `Sections — who serves which table`. Billing/kitchen/sessions rows were
   removed (admin-only in the panel — dead switches). The Users rules: a manager may
   CREATE (new logins start on Default), RESET a password and DISABLE (the person is told
   *"This login has been disabled"* at sign-in) — a manager can **never DELETE** a login.
Off ⇒ the row's tab/section is gone for a real manager and the server refuses its endpoints.

## SECTION C — OWNER'S MENU
`Edit menu` · `Ratings` · `Logs` · `Manager mode` (**LEFT TO BUILD** — shown, labelled).

## SECTION D — DEFAULT SET FOR USER
The capability set a **new person of that role** starts with. A person's own row can differ
later (per-person overrides stay); this section only sets the starting point.

- **Manager** — Edit menu (ON) → *customisation · add new dish · edit dish info · change
  price · delete dish · mark sold out · manage categories · manage filters · **attach a 3D
  model (OFF)*** — plus Ratings (ON), Logs (ON), Dashboard (daily / daily + yesterday,
  generate the daily report).
- **Owner** — same list, plus Ratings, Logs, **Manager mode** (left to build).
- **Waiter (tablet)** — Menu · Table type (ON) · Reopen invoice (**OFF**) · Generate bills (**OFF**).

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
