# Platform panel (Zomato / Swiggy / Takeaway) + kitchen sync — design

Date: 2026-06-20 · Status: approved direction, pre-implementation
Owner decisions captured via brainstorm on 2026-06-20.

## Goal

Add a **Platform** section to the **manager** panel (main app, port 4000), beside
Tables, that manages **Zomato / Swiggy / takeaway** orders. These orders also flow to
the **kitchen** with a coloured source badge. Dine-in stays exactly as it is today.
Build to run on **test orders now**, with a clean seam for a **real aggregator API later**
(Zomato/Swiggy are webhook-push + partner-onboarded; no keys today).

## Key decisions (owner)

1. **Isolation: separate table + toggle-to-mirror.** Platform orders live in their OWN
   table (`aggregator_orders`, enriched) — NOT mixed into `orders`. Every existing
   dine-in order, bill, KOT, total and query is untouched (zero regression by
   construction). A toggle **"Also push platform orders into Bills"** (default OFF)
   optionally mirrors a platform order into `orders` as a bill.
2. **Kitchen: full redesign**, shown as a mockup for approval BEFORE touching the real
   kitchen. Must keep working exactly as now (New/Cooking/Ready, KOT, allergens, tick
   buttons, 86 board, new-order sound) + add the source badge. Current cold navy theme
   → warm espresso/ivory to match the app.
3. **Manager** must not break. Platform is a new tab beside Tables; nothing else changes.

## Data model

Enrich existing `aggregator_orders` (migration 037) — additive only:
`source ('zomato'|'swiggy'|'takeaway'|'other')`, `external_id`, `customer_name`,
`customer_phone`, `items JSONB`, `total NUMERIC`, `status` (new→accepted→preparing→
ready→handed_over / cancelled), `status_history JSONB`, `kot_no INT`, `rider_*` (later),
`order_id UUID` (the mirrored bill, when toggle ON), `created_at`. Keep `payload JSONB`
for raw API audit. Unique `(source, external_id)` stays (dedupe).

A test order = a row with a generated `external_id` and random items/customer.

## Surfaces

- **Manager → Platform tab**: status board (New → Preparing → Ready → Handed over),
  cards badged by source, filter chips, summary strip, **"＋ Add test order"** button.
  (Visual approved via the 7777 mockup.)
- **Kitchen**: board fetch returns platform orders as a second list; they render as
  tickets with a coloured source badge; Accept/Ready act on platform endpoints. Redesign
  the whole kitchen look (mockup-approved) but preserve every existing behaviour.
- **Bills toggle**: a setting (`features.platform_in_bills` or a settings column),
  default OFF. OFF = platform orders never touch `orders`. ON = mirror each into `orders`.

## Backend seam (dormant today)

- `aggregators` feature flag stays OFF; everything platform works in a "manual/test" mode
  regardless, but the **real-API path** is gated on the flag + keys.
- Webhook endpoint `POST /api/aggregators/webhook/[source]` (stub: verify + normalize +
  insert into `aggregator_orders`) and a `ZomatoProvider`/`SwiggyProvider` class
  (ported from the reference editor, behind `ZOMATO_API_*`/`SWIGGY_API_*` env). No-ops
  with no keys. Live order/rider status arrives via the aggregator's push, not polling.

## Build order (each phase tested before the next; nothing merged until green)

1. Additive migration enriching `aggregator_orders` + a few RPCs
   (`lfh_add_platform_test_order`, `lfh_platform_set_status`, optional mirror-to-bill).
2. Manager **Platform tab** + board UI + test-order button + API routes.
3. Kitchen **redesign** (approved mockup) + merge-in platform tickets + source badge.
4. **Bills toggle**.
5. Webhook + provider **stub** (off).

Each on a branch off `origin/main`, tested on 4000 (Chrome + the verify flow), then
pushed to `main` and confirmed deploy READY. No existing flow may regress
(dine-in place/accept/ready/serve, manager Orders & Tables, kitchen 86 board + sound,
realtime, KOT/bill numbering, bill archiving).

## Out of scope (later)

Real API keys/onboarding; rider live-tracking UI; payments reconciliation; the
`orders`→`bills` global rename (separate task).
