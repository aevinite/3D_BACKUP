# Guest ordering redesign — name capture + live "My Order" page + rounds

**Date:** 2026-06-13
**Owner request:** when a guest orders, ask their name (remember it, feed blocking); after ordering, take them to a brand-new "My Order" live page showing their dishes + live status, a way to add more (a new round that merges into the same bill), and pairing suggestions. Head and partners both see this. Backend (editor/kitchen/tablet) shows rounds in sequence.

This is **guest-facing** (`app/menu`, `components/`, `lib/`). It builds on the existing session model and the order-status engine; no new "brain."

---

## Goals / definition of done

1. **Confirm + name step** before an order is sent: "Are you sure?" lists the items and asks the guest's **name** (pre-filled if remembered).
2. **Name is remembered** on the device and saved to the member, and is usable for **blocking**.
3. A new **"My Order" live page** the guest lands on after ordering: their dishes with live **cooking / ready / served** chips, a progress summary, and a live "ready!" banner.
4. **Price-free** live page + a **🧾 View bill** action that opens the full itemised bill with prices.
5. **＋ Add to your order** → fresh menu/cart → places a **new round** that merges into the **same table bill**; the live page then shows Order 1, Order 2, …
6. **Pairing suggestions** ("Goes well with your order") addable in one tap.
7. **Head and partners** both see the same table-wide live order.
8. Backend (editor/kitchen/tablet) shows the rounds **in sequence on the same table** (already supported via `session_id` + `created_at` + `kot_no`).

---

## Locked decisions (from brainstorm)

- **Pricing:** the live "My Order" page is **price-free** — it's about *what's coming and how close it is*. A **"View bill"** affordance opens the itemised bill **with prices** on demand. (Reconciles owner's "without pricing, just the order" + "you'll get the whole bill.")
- **"Add to your order" = a new round** (Western course-by-course): empty cart, build, place; it attaches to the same session/bill as a **separate order** (own KOT). A fired order is never re-edited.
- **Name asked once** at the confirm step; remembered so later rounds skip retyping (quick confirm).
- Status vocabulary reuses the four dish states already built: new / cooking / **ready (pink)** / served. The guest sees dish-level chips; the order-level status stays coarse for anything else.

---

## Data / plumbing (mostly reuse — minimal new schema)

Existing (from the code map):
- `session_members.name` already exists; `lfh_join_session(table, name, lat, lng)` already stores it. The **head** currently has `name = NULL`.
- Orders carry `session_id`, `member_id`, `created_at`, `kot_no`, `table_number` — so rounds already sequence on the backend.
- `get_order_status(order_id)` returns `{status, table_number, created_at, kot_no}`; `lib/orderStatus.ts` polls `lfh_active_orders` (localStorage) every 1.5s.
- Blocking: `blocklist` (phone, table_number, member_id, device_id) + `lfh_is_blocked(phone, table)`.
- Suggestions: `MenuItem` has `category`, `tags`, `relatedSlugs`, `rating`; an existing category-based pairing exists in `CartPanel.tsx` (`PAIR_CATS`).

New / changed:
- **Capture name at order time.** Add a name field to the confirm step. Persist to:
  - `localStorage` key `lfh_guest_name` (long-lived on the device).
  - the member: set `session_members.name` for THIS member (new tiny RPC `lfh_set_member_name(p_token, p_name)`, or extend the order RPC to accept an optional name and set it). Head included (head can now have a name).
- **Blocking by name:** store name alongside the order/member (already on the member). Extend the editor's block UI to block by the captured name where useful; optionally add `name` to `blocklist` + a clause in `lfh_is_blocked`. (Keep minimal — primary identity stays member_id/phone/device; name is a human label + an extra match.)
- **"My Order" status source:** for a session table, fetch the table's orders + per-dish `order_items` status for the guest's session (so head & partners see the whole table's rounds). Reuse `get_order_status` per order, or a small new read RPC `lfh_my_orders(p_token)` returning the session's orders + items (anon-safe, token-scoped). This is the cleanest single source for the page.
- **Suggestions:** derive "goes well with" from `relatedSlugs` first, then fall back to category/tags + rating; exclude items already ordered and sold-out.

---

## Components / structure

- `components/OrderConfirmSheet.tsx` — the "are you sure + your name" sheet (new; or fold into CartPanel's place-order path). Pre-fills name from `lfh_guest_name`.
- `components/MyOrderPage.tsx` (or a `/menu` view state / route `app/menu/my-order`) — the live page: greeting, live banner, order cards with dish status chips + progress, **Add to your order**, **Suggestions**, **View bill**.
- `components/MyOrderCard.tsx` — one round (KOT, time, dish rows with status chips, progress bar).
- Reuse `lib/orderStatus.ts` (extend to track per-dish status for session tables) and `lib/menu.ts` ordering helpers.
- `lib/guestName.ts` — read/write `lfh_guest_name`.
- View bill = a sheet reusing the existing bill/cart total rendering (with prices).

Keep files small and single-purpose; the live page composes the cards + suggestions + actions.

---

## Flow (happy path)

1. Browse menu → add to cart (existing).
2. Tap **Place order** → **OrderConfirmSheet**: items + name (pre-filled) → **Place order**.
3. Order placed (session path, attaches to the table's session) → navigate to **My Order** live page.
4. Page polls the table's orders + dish statuses; chips update (cooking→ready→served); banner fires when a dish is ready.
5. **＋ Add to your order** → menu (empty cart) → add → **quick confirm** (name known) → new round, same bill → back to My Order showing Order 1 + Order 2.
6. **🧾 View bill** → itemised bill with prices for the whole table.

Edge/error handling: blocked guest → can't place (existing guard); no session / sessions OFF → fall back to the current public order + the existing single-order tracker (the new page is best with sessions ON; degrade gracefully). Name optional but encouraged; empty name allowed (just no personalization, weaker blocking).

---

## Phases (each verified in the browser)

1. **Name capture** — confirm sheet with name, persist to device + member; quick-confirm on later rounds.
2. **My Order page** — layout, order cards, live dish-status chips, progress, ready banner (reuse status engine).
3. **Add to your order** — round flow merging into the same bill; page shows multiple rounds.
4. **Suggestions** — pairing row (relatedSlugs → category/tags), one-tap add.
5. **View bill** — itemised bill sheet with prices.
6. **Blocking hook** — editor can block by the captured name; `lfh_is_blocked` optionally matches name.
7. **Backend sequence check** — confirm editor/kitchen/tablet show rounds in order on the same table (mostly verification).

---

## Testing / DoD
- Verified live in Chrome (place → My Order → status updates → add round → view bill), not from source alone.
- Cross-panel: a guest round shows on tablet/kitchen/editor as a sequenced order on the same table, with the captured name attributed.
- `npm run lint` / type-check passes.
- Nothing pushed until the owner says push.
