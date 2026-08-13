# Tablet (Waiter) panel — full redesign + fixes

**Date:** 2026-06-13
**Owner request:** the waiter/tablet panel looks bad and confusing vs the editor, shift-table is slow, ordering is untested/buggy, and it doesn't show live kitchen status. Bring it to editor quality, make it responsive, and wire it to the kitchen.

Files in play: `public/panels/tablet/{index.html,app.js,style.css}`, `app/api/tablet/[...path]/route.ts`, and (read-only reference) `public/panels/editor/app.js`, `app/api/kitchen/[...path]/route.ts`, `supabase/migrations/036_*`.

---

## Goals (what "done" means)

1. A floor screen that reads like the editor: an always-on **legend**, color-coded tiles, and a big editor-style **Open** button.
2. Tapping a table opens an **editor-quality detail panel** (right on desktop, bottom on tablet) showing every order and **each dish's live state**.
3. The waiter can **advance a single dish**: new → cooking → served (and back), like the editor.
4. **Online/phone orders sync** onto the table's bill and are clearly marked.
5. One clear primary action (**Take order**); **Move table** / **Move an order** are secondary — no two competing buttons.
6. A big **ATTEND** button for waiter calls, sized to the leftover bottom-bar space.
7. **Responsive**: tablet = tables on top, detail below, tap → auto-scroll to detail; a way to get back to the grid.
8. **Shift-table feels instant** (no multi-second wait).
9. **Every bug in the order flow fixed**, verified in a real browser.
10. **Business-day** KOT/bill reset + "today" filter made timezone-consistent.

---

## Locked design decisions

### Colors (one meaning each, always shown in the legend)

| Meaning | Color | Where |
|---|---|---|
| Free | grey `#6b6253` | empty table |
| Seated, no order | teal `#2dd4bf` | guests sat, nothing ordered |
| New order (just in, not accepted) | **orange `#f59e0b`** | kitchen hasn't accepted yet |
| Preparing / cooking | blue `#4f9dff` | accepted, on the pass |
| Served / ready | green `#22c55e` | food delivered |
| Called you | red `#ef4444` 🔔 + glow | waiter bell / needs attention |
| Unpaid / Paid | red / green **border (outline)** | payment state of the bill |

(Owner approved orange for "new order" over the earlier yellow.)

### Floor screen
- **Legend bar** pinned at top: "INSIDE" swatches (the fills) + "OUTLINE" swatches (paid/unpaid). Always visible.
- Live **count chips** beside the "Waiter" brand (e.g. "1 needs you · 2 seated · 11 free"); tapping a chip filters. Replaces the old All/Needs/Open/Free tab row.
- **Free tile:** dim, table number, "Free", a big editor-style **Open** button (tap card or button opens it).
- **Open tile:** fill color = its state; shows guests, KOT#, a kitchen **progress bar**, and pills (`2 cooking`, `3 ready`); **border** = paid/unpaid; red 🔔 + glow when called.
- Grid stays fluid/responsive (auto-fit columns).

### Detail panel (tap a table)
- Header: Table #, guests, bill #, open/closed badge.
- **Order cards** stacked; each shows KOT chip, time, total, and per-dish rows with a status pill (`new`/`cooking`/`served`).
- Orders that came from the guest menu carry a **"via app 📱"** badge (online sync, see below).
- Not-yet-accepted orders show **✓ Accept & send to kitchen**.
- Per-dish **tap to advance status** (new→cooking→served), mirroring the kitchen/editor item buttons.
- **Actions row:** `＋ Take order` (primary) · `⇄ Move table` · `↪ Move an order` (secondary).
- **Bottom bar:** left = bill# + paid/unpaid chip (bordered red/green); right = big **ATTEND — <reason>** button that fills the remaining width, present **only when there's an active call**.

### Responsive
- Desktop (wide): floor left, detail right (current 2-column).
- Tablet/narrow: floor on top, detail stacked below; tapping a table **smooth-scrolls** to the detail; a **"↑ Back to tables"** affordance returns to the grid. The grid is never trapped behind the detail.

---

## Architecture / data changes

### Tablet `/state` (GET) — add per-dish items
Currently returns `orders` (table-level) but **not** `order_items` (per-dish). Add `order_items` (today, by `created_at`) to the `/state` payload so the floor tiles and detail panel can show dish-level status. Mirror the kitchen board's query.

### New tablet POST: `items/:id/status`
Mirror `app/api/kitchen/.../items/:id/status` exactly (validate `received|preparing|served`, set `served_at`, roll the parent order's overall status up). Lets the waiter advance a single dish from the tablet. Reuse the kitchen rollup logic so kitchen + tablet stay consistent.

### New tablet POST: `orders/:id/accept`
Mirror the kitchen `orders/:id/accept` so the waiter can accept a phone/online order straight from the table detail ("Accept & send to kitchen").

### Move a single order: `orders/:id/move`
New endpoint: move one order (and its `order_items`) to another **open** table's session. Validates target is open (or opens it). Distinct from whole-party `sessions/:id/shift`.

### Online/phone order sync
Guest-menu orders already insert into `orders`/`order_items` tied to a `session_id`/`table_number`, so they **already arrive** in `/state`'s today query — the work is (a) **display** them on the right table with the "via app" badge, and (b) verify the guest checkout actually attaches `session_id`/`table_number` correctly. If guest orders are NOT attaching to the open session, fix that link (verify in browser, this is bug-hunt territory).

### Shift-table latency
Likely causes: the 1s full re-poll + a synchronous `lfh_staff_shift_table` round-trip with a full re-render. Fix with **optimistic UI** (move the tile/detail immediately, reconcile on the next poll) like the editor, and only re-render the affected tiles (already signature-diffed). Measure before/after in the browser; if the RPC itself is slow, inspect it.

### Business-day numbering (KOT / bill)
`daily_counters` keys on `CURRENT_DATE` (DB clock = UTC); the "today" filters use the server clock. Make both use the **restaurant's timezone** so the daily reset and the "today" list always agree. Confirm the timezone with the owner first; smallest change that makes them consistent (no full counter redesign).

---

## Build phases (each verified in Chrome before moving on)

1. **API foundation** — add `order_items` to `/state`; add tablet `items/:id/status`, `orders/:id/accept`, `orders/:id/move`. (No UI yet; verify with curl/browser.)
2. **Floor redesign** — legend, count chips, new free/open tiles with kitchen progress + payment outline + call glow. Big Open button.
3. **Detail panel** — editor-quality order cards, per-dish status pills, per-dish tap-to-advance, Accept button, "via app" badge.
4. **Actions** — Take order (existing flow, cleaned), Move table (existing shift), Move an order (new). Remove the duplicate-button confusion.
5. **ATTEND bottom bar** — bill chip + dynamic attend button.
6. **Responsive** — stacked layout, auto-scroll to detail, back-to-tables.
7. **Performance** — optimistic shift/move; verify it feels instant.
8. **Bug sweep** — run the full order flow end-to-end in Chrome, fix every error found (ordering, options, allergies, send-to-kitchen, online sync).
9. **Business-day fix** — timezone-consistent reset + today filter.

---

## Testing / definition of done
- `npm run lint` (type-check) passes.
- Each phase verified live in Chrome via MCP (screenshot / network / state), not from source alone.
- Full waiter flow walked end-to-end: open table → take order → kitchen receives → advance dishes → online order syncs in → attend a call → move table/order → bill reads correct.
- `node scripts/verify-cache.mjs` only if 3D loading is touched (it isn't expected to be).
- Nothing pushed until the owner says push (per standing rule).
