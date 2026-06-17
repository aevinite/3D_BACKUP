# Order-flow changes — name-once, staff edit-after-confirm, icon + allergen cleanup

Date: 2026-06-17
Owner request (voice). Beginner owner; plain-language teaching.

## Scope (4 changes)

### A — Ask the guest's name ONCE, at session open
Today the nickname is only requested inside the **order** branch of `SessionGate.act()`
(`components/SessionGate.tsx:144-149`). The table head and silent-connect paths therefore
reach the kitchen with no name until they place an order.

**Change:** move the `if (!getNickname())` check to the **top of `act()`**, so it runs once
before ANY session action — connect (add-to-cart), order, or call-waiter. `submitNickname()`
then resumes the **original** queued action via `act()` (not `placeOrderNow()` directly), so
saving a name during an add-to-cart does NOT wrongly fire an order. Reword the prompt copy to
be neutral ("What should we call you?") since it can now appear before a cart add or waiter call.
Only active when the dining-session feature is ON (unchanged otherwise).

### B — Staff edit an order AFTER it is confirmed (manager + tablet only; never guest)
One unified **Edit** affordance per placed order. Capabilities (owner-picked):
change quantity · add a dish · edit note · add/remove allergy · remove a dish.
Every edit is gated by a 2-step **confirm**: "Have you checked with the kitchen this order is
still editable?" → [Cancel] / [Yes — it's editable]. This is the manual safety because the
screen may already show "cooking".

Backend gap (today only delete exists — `lfh_delete_order_item`, migration 062). New RPCs needed:
- `lfh_edit_item_qty(item_id, qty)` — set a line's quantity (>=1), recompute order total.
- `lfh_edit_item_note(item_id, note)` — set a line's note.
- `lfh_add_item_to_order(order_id, title, qty, unit_price, options, removed, note)` — append a
  line to an EXISTING placed order, recompute total. (Heaviest piece.)
- Allergy edit reuses the existing `POST /orders/{id}/allergies` RPC.
All staff-only: `REVOKE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role`
(per the migration-038 gotcha). Exposed via `app/api/editor` + `app/api/tablet` route handlers.

### C — Bigger delete (trash) icon
Editor `.icon-del` is 30×30 / 14px; tablet `.idel` is 14px. Bump to a larger, obvious tap
target (≈22px glyph, ≈38px box) on both, especially for tablet touch.

### D — Remove the always-on "Avoid (all dishes)" allergen chip row
Remove the standalone editable allergen chip rows from the order cards
(editor `ord-allergy-edit` blocks at app.js ~750 and ~846; tablet `ordctl` block at ~257-266).
Per-item "NO NUTS" display on the dish line STAYS. Allergy add/remove moves into the B edit flow.

## Build order
A + C first (small, independent, instantly visible). Then D + B together (coupled: D removes the
standalone allergen UI, B re-homes allergy editing inside the gated edit flow).

## Done = type-check passes, panels load in Chrome, edit/confirm flow works end-to-end,
no anon access to the new staff RPCs.
