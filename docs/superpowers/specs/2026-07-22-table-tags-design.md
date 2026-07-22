# Table Tags (VIP / Family / Owner's Guest / Pay Later) — Design

Date: 2026-07-22 · Status: awaiting owner approval · Owner request: mark tables as
special guest types, distinct look in ALL panels, pay-later bills in a separate
section, full permission ladder.

## 1. What it does (plain language)

Staff can mark any table with one of THREE guest types (VIP / Family / Owner's Guest); "Pay later (Khata)" is a bill-time payment choice instead. The tile immediately looks
clearly different from every normal table — in the manager floor, waiter tablet,
kitchen tickets, and the admin live floor — so staff treat the party accordingly.
The mark clears automatically when the table closes, or manually.

## 2. The tags — THREE table marks + bill-time Khata (owner decisions 2026-07-22)

| slug | Label | Tile look | Billing behaviour |
|---|---|---|---|
| `vip` | 👑 VIP | Royal purple bg, GOLD border+ribbon, crown badge | Pays normally (service priority only) |
| `family` | 🏠 Family | Crimson/rose bg, red ribbon, home badge | Settle offers **"On the house — no charge"** |
| `guest` | 🤝 Owner's Guest | **Platinum silver** bg/ribbon (owner picked option A) | Same "On the house" option |

**Khata / Pay later is NOT a table mark** (owner picked option B): it lives ONLY in
the existing payment popup as a 4th method button — 💵 Cash · 📱 UPI · 💳 Card ·
**📒 Collect later** — available on ANY table at bill time, permission-laddered.

**Tile design is APPROVED from the 2026-07-22 mockup** (preserved at
`docs/superpowers/specs/2026-07-22-table-tags-mockup.html` — copy its CSS recipe
faithfully; owner picked Guest colour A = platinum, Khata placement B = bill-time;
the mockup page shows all variants, the spec table above is what ships): tag layer =
2px coloured border + corner RIBBON (rotated banner) + diagonal-stripe/radial
tint overlay + pill badge, layered over the untouched state strip/label. VIP and
Family must ship looking EXACTLY like the approved mockup ("i love this design
make sure exactly same").

The tag styling layers OVER the existing state system: the `ft-strip` status bar,
state label ("Preparing/Ready/Served…"), and pay ring all keep working. Tag = a
`tag-<slug>` class + badge on the tile; never replaces state classes.

## 3. Data model (one small migration)

- New table `table_tags(restaurant_id uuid, table_number int, tag text CHECK (tag in
  ('vip','family','guest')), tagged_by text, tagged_at timestamptz,
  PRIMARY KEY (restaurant_id, table_number))`. RLS like sibling tables;
  service-role writes only (all writes go through the panel APIs).
- `lfh_rt_emit`-style trigger on `table_tags` carrying `table_number` → panels
  refetch ONLY that table (egress rule; matches migrations 057–059 pattern).
- Mark/clear API: new editor + tablet route actions (`POST tables/:t/tag`,
  `DELETE`), permission-gated per the ladder (§6).
- **Auto-clear:** deleting the row when the table's session closes/restarts —
  hook into `lib/autoSettle.ts` close/restart paths AND the manual close-table
  path so a new party never inherits the previous party's tag.
- Read paths that gain a `tag` field: `lfh_floor_state` (041/081/126 lineage —
  base the edit on the HIGHEST-numbered version, see
  migration-recreate-reverts-fix memory), `lfh_table_view_summary` (101),
  `lfh_floor_bundle` (100), `lfh_kitchen_tickets` (041), `lfh_admin_floor_all`
  (145 — add trimmed field `g`, still money-free).

## 4. Panel rendering

- **Manager** (`public/panels/editor/app.js`): `floorTileHtml` (~:4545) adds
  `tag-<slug>` class + corner badge; tile quick-menu gains "Mark table…" (3 tags +
  Clear). CSS in `public/panels/editor/style.css` (new tag backgrounds, distinct
  from every state tint + pay red/green). Legend row gains the three tag swatches.
- **Tablet** (`public/panels/tablet/app.js`): `summaryTile` (~:260) same class +
  badge; mark/clear action in the table detail sheet (gated by the tablet rung).
  Any new popup registers with `LFH_BACK.layer` (back-button rule).
- **Kitchen** (`public/panels/kitchen/app.js` ~:190): badge next to `T${n}` on
  the ticket head (e.g. `👑 T5`). Read-only.
- **Admin** (`components/admin/shared.tsx` FloorGrid ~:138): tint + badge from the
  new `g` field.
- `boardSig` note: rows now include `tag`, and boardSig serialises full rows, so
  repaint is automatic — do NOT add `tag` to `RT_VOLATILE`.

## 5. Billing behaviour

- **On the house** (family/guest tables): one-tap settle option = apply 100%
  whole-bill discount via the EXISTING `lfh_staff_bill_discount` machinery with
  note `on-the-house`, then mark paid with `payment_method='On the house'`.
  Reuse means every money view (already net-of-discount, paid-only) stays correct
  with zero changes to the 16 money views. Staff can still charge normally.
- **Collect later / Khata** (bill-time, ANY table — owner decision 2026-07-22):
  a 4th button in the existing payment popup (manager + tablet, each behind its
  ladder rung) that closes the table while the bill stays uncollected — and
  every khata bill is attached to a PERSON (owner request 2026-07-22):
  - New table `khata_customers(id uuid PK, restaurant_id uuid, name text NOT
    NULL, phone text, note text, created_at)`, unique `(restaurant_id, phone)`
    when phone present; index `(restaurant_id, name)`. Scoped reads only.
  - The "Collect later" flow opens a small person picker: SEARCH existing
    customers by name/phone (scoped, LIMIT 8, debounced) or ADD NEW (name
    required, mobile optional, note optional).
  - Markers on orders: `orders.khata_at timestamptz` + `orders.khata_customer_id
    uuid` (NULL = normal bill). Khata bills are EXCLUDED from the "pending
    bills" banner/warnings and from revenue (revenue is already paid-only).
  - **Bills → "Khata / Pay later"** view groups by customer: each person shows
    name, phone, total outstanding, bill count, expandable bill list, "Mark
    paid" per bill (normal pay modal) and "Settle all". Marking paid sets
    paid_at; khata_at/customer_id retained for history.
  - v2 (not now): full ledger page per customer with payment history/partial
    payments.
- **On-the-house report:** owner panel + manager dashboard get a separate report
  table listing comp bills (date, table, tag, items, would-be amount, marked-by),
  date-filterable, reading a scoped indexed query (`restaurant_id, paid_at` +
  `payment_method='On the house'`; add partial index if needed). A small toggle
  ("include on-the-house rows in main bill lists: on/off") lives in the report —
  display-level only, never changes revenue math.

## 6. Permission ladder (OWNER RULE — applies to every feature)

Effective access = AND of all rungs; each rung's UI disappears when off AND the
server refuses (never client-only). CORRECTED per owner 2026-07-22: admin's second
switch is a POWER-TRANSFER switch, not a depth selector.

1. **Admin** (/aevinite, per restaurant) has TWO switches per feature:
   (a) **Application** — the feature on/off itself. (b) **Power transfer** — may
   the OWNER control this feature's on/off from the owner panel. When (b) is ON,
   the owner panel shows the feature toggle (this supersedes the old "owner panel
   has NO feature toggles" rule — owners get toggles exactly where admin delegates
   them); when OFF, only admin's setting counts. Default OFF for new restaurants
   (new-module rule).
2. **Owner → Manager:** manager-power switch `table_tags` via the existing
   `MANAGER_POWER_FLAGS` / `managerCan()` pattern (`lib/ownerEntitlements.ts`),
   visible/usable when admin transferred the power (1b) or as plain manager-power
   when the feature is admin-ON.
3. **Manager → Tablet:** tablet switch via the existing tablet-permissions
   pattern (the one gating `tablet_mark_paid`); if that pattern isn't
   manager-editable today, build the manager→tablet rung as a REUSABLE mechanism,
   not a one-off.

Kitchen/admin displays are read-only and always show the tag when the feature is
entitled (no rung needed to *see*).

## 7. Egress & scale rules (non-negotiable, from CLAUDE.md)

Scoped reads only (`restaurant_id` + column list + limit); tag changes ride the
per-table breadcrumb → one-table refetch; no polls faster than the 60s backstop;
verify in the Network tab that marking a table refetches only that table.

## 8. Verification (definition of done)

Type-check clean; mark/clear each tag from manager AND tablet on a NON-#1
restaurant; observe instant tile change in manager+tablet+kitchen+admin with no
flicker; on-the-house settle produces ₹0-due bill and appears in the new report
(and not in revenue); khata settle frees the table, bill appears in the Khata
list, later Mark paid works; ladder: flipping each rung hides the control below
AND the API refuses; desktop + ~390 px mobile; back-button registered for any new
popup.

## Out of scope (v1)

Per-customer credit ledger with balances/history (Khata v1 = parked-bills list);
auto-treatments (auto-discounts for VIP); guest-menu visibility of tags.
