# Realtime Architecture (Stage 2) — Design

**Goal:** Kill aggressive polling (staff 1s, guests 2–3s) and the resulting Supabase
egress, while keeping the *identical* live-update UX on all four surfaces (guest
phone, waiter tablet, kitchen screen, manager panel). Long-term architecture, not
a patch.

## The problem
Every open device re-downloads state every 1–3s even when nothing changed. With
many devices this is millions of needless reads/day → egress blowup (seen even in
testing). My recent auth gate added a `staff_users` read per request, amplifying it.

## Chosen approach — "signal table + refetch-on-change"
Rather than subscribing the browser directly to sensitive tables (which would
require exposing `orders`/`sessions` to the public anon key — a data leak), we use
a small **non-sensitive breadcrumb table** + Postgres triggers:

```
order/call/session/etc. changes
        ↓ (AFTER trigger, SECURITY DEFINER)
realtime_events  { topic, kind, entity_id, table_number, created_at }
        ↓ Supabase Realtime (postgres_changes on realtime_events only)
device's open WebSocket (filtered by its topic)
        ↓ on breadcrumb
device refetches via its EXISTING secure path (RPC for guests, /api for staff)
```

Plus a **60–120s backup poll** for recovery (websocket death, tab sleep, network
change), and a **refetch on tab-wake / reconnect**.

### Why this design
- **Security:** sensitive tables stay locked behind RLS + SECURITY DEFINER RPCs;
  only the harmless breadcrumb (`order 51 changed, table 5` — no names/prices/PII)
  is anon-readable.
- **Robustness:** because we refetch authoritative state on signal, duplicate /
  out-of-order events are harmless — no client-side merge bugs.
- **Low risk:** existing rendering + data code is untouched; only the *trigger*
  for a refresh changes (event instead of 1s timer). Fully reversible.
- **Egress:** refetch happens on real change, not 60×/min → ~90%+ reduction.

### Topics
- `ops` — any operational change staff panels care about (orders, items, calls,
  sessions, members, requests, table state). Staff panels refetch full state
  (debounced ~300ms) on any `ops` breadcrumb.
- `table:<n>` — changes relevant to one table's guests. Guest components refetch
  their session/orders on their table's breadcrumb.

(Trigger emits an `ops` row always; also a `table:<n>` row when a table is known.)

### Data model
```sql
realtime_events(
  id bigint identity PK,
  topic text not null,          -- 'ops' | 'table:5'
  kind text not null,           -- 'order'|'order_item'|'call'|'session'|'member'|'request'|'table'
  entity_id text,               -- changed row id (for future granular use)
  table_number text,
  created_at timestamptz default now()
)
```
RLS ON; anon gets **SELECT only**. Triggers insert via SECURITY DEFINER. Added to
the `supabase_realtime` publication. Pruned to the last ~15 minutes.

### Client pieces
- `/api/rt-config` — returns the **public** Supabase url + anon key so the static
  vanilla panels can boot a Supabase client (these values are already public).
- `public/panels/realtime.js` — shared panel helper: boots the anon client,
  subscribes to topic(s), calls a debounced `onEvent`, handles reconnect/tab-wake,
  collects metrics. Panels swap `setInterval(load,1000)` → event-driven + 60s backup.
- Guest (React): a `RealtimeProvider` subscribes to `table:<n>` and dispatches a
  `lfh:rt-tick` window event; existing poll components listen for it (immediate
  refetch) and stretch their own interval to 60s.

### Metrics (per the reviewer's insistence)
A tiny collector (`window.__lfh_rt`) tracks: active connections, reconnect count,
events/min, websocket errors, last-event time. Surfaced in console and (if time)
a small readout in /admin.

## Phases (each committed + tested on branch `realtime-migration`)
- **P0 Foundation:** events table + triggers infra + publication + anon policy +
  `/api/rt-config` + `realtime.js` helper + metrics + guest RealtimeProvider.
- **P1 Orders:** orders + order_items → kitchen, tablet, manager, guest tracker.
  Switch their 1s/3s polls to event-driven + 60s backup. **Test.**
- **P2 Calls + floor/table state:** waiter_calls + table state. **Test.**
- **P3 Sessions + cart + requests:** sessions, session_members, requests, shared
  cart, live bill. **Test.**

## Non-goals (explicit follow-ups)
- Granular `{id,status}` patching (we refetch instead — simpler, safe).
- Per-device realtime authorization via login JWT (breadcrumbs are non-sensitive;
  harden to private channels later).
- Moving static data (menu/categories/settings/staff_users) to realtime — those
  stay fetch-once.

## Must-not-break
Customer order tracking, kitchen live updates, waiter tablet updates, session
management, shared cart, live bill, waiter calls. UX identical; only transport changes.
