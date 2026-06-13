# Spec — The Floor-State "Brain" (one source of truth)

- **Date:** 2026-06-13
- **Status:** Approved (Approach A); awaiting spec review
- **Piece:** 1 of 5 in the unified-app rewrite (see "Bigger picture" below)
- **Migration:** `supabase/migrations/041_floor_state_brain.sql`

## Problem

Every staff screen decides "is this table busy or free?" on its own, from raw
rows, with slightly different rules:

- **Editor floor** loads up to 200 orders + all non-closed sessions, then runs
  `tableTileState()` in JS (with reconciliation guards).
- **Tablet floor** loads **today-only** orders (`created_at >= midnight`) + all
  non-closed sessions, then runs its own `tileState()`.
- **Kitchen** is order/KOT-driven only.

Because each screen computes status differently — and some clip orders to
"today" while sessions have no date limit — the screens **disagree**.

**Confirmed live example (2026-06-13):** table 3 has an *open* session from
2026-06-12 with one **unpaid** €12.46 order. The editor's order list shows it
(loads history); a today-only view shows the table **Free** (yesterday's order
is invisible to a "today" query, even though the table is still open). The
database is *correct and consistent*; only the read logic diverges.

## Goal / success criteria

1. There is **exactly one** place that computes each table's status.
2. Editor, kitchen, and tablet **render** that one answer — they no longer
   compute table state from raw rows.
3. An **open table always carries its unpaid orders**, regardless of the date
   the order was created. (This single rule kills the overnight-table bug.)
4. Given the same database, all staff screens show the **same** status for
   every table, every time.

## Approach (chosen: A — the brain lives in the database)

Add one `SECURITY DEFINER` Postgres function, **`lfh_floor_state()`**, that
returns the authoritative status of **every** table in one call. Staff panels
call it on their existing ~1s poll and paint the result. Logic lives once, in
the backend — matching the project's SaaS rule ("business rules in the backend,
not the UI") so even a future white-label frontend gets the identical answer.

Rejected: a shared TS module (truth would live in the browser; a different
frontend would re-implement it and could drift again) and a SQL view (clumsy
for the conditional state + date rules).

### `lfh_floor_state()` — contract

Returns a JSON array, **one object per table 1..`settings.table_count`**, plus
any extra table numbers that have an open session or live orders (walk-ins /
shifted parties above the configured count are never dropped):

```jsonc
{
  "table_number": "3",
  "state": "served",        // free | seated | new | preparing | served | cleared
  "open": true,             // is there an open session?
  "session_id": "df0d…",
  "members": 2,             // seated, not removed
  "pending_members": 0,     // joiners awaiting approval
  "has_new": false,         // an order at 'received' needing accept
  "has_call": true,         // an unresolved waiter call (only counts if open)
  "due": 12.46,             // unpaid, accepted bill total net of discount
  "pay": "red",             // red unpaid | green paid | "" nothing accepted
  "orders": [ { "id", "status", "payment_status", "total", "discount", "kot_no", "created_at" } ],
  "last_activity_at": "…"
}
```

### Canonical state rules (the ONE definition, ported from the editor's guards)

- **open** = a `sessions` row for this table with `status = 'open'`.
- **Orders that belong to the table** = non-archived, non-cancelled orders for
  the table **whose `session_id` is the open session**, OR (when sessions are
  OFF) the table's non-archived orders. **No date filter** — an open table's
  unpaid orders always count.
- When **sessions are ON and there is no open session**, leftover non-archived
  orders are treated as stale (meal over) → the table is **Free**. (Mirrors the
  editor's existing guard so a closed table never keeps showing "Preparing".)
- **state** precedence: any item `received` → `new`; else any `preparing` →
  `preparing`; else has orders + unpaid → `served`; else has orders + paid →
  `cleared`; else open session with no orders → `seated`; else → `free`.
- **due** counts only **accepted** unpaid orders (status ∉ {received, cancelled}
  and payment ≠ paid), net of `discount` — same as the tile today.
- **has_call** only counts while the table is open (kills lingering call badges).

### Kitchen companion

The kitchen cares about **cooking tickets (KOTs)**, not table bills, so it reads
a thin companion, **`lfh_kitchen_tickets()`**, returning the same underlying
truth sliced as KOT tickets (kot_no, table, items + per-item status, age). Same
source data, kitchen's view of it. (Both functions read the same tables; they
never re-derive conflicting status.)

### Security

Both functions are **service-role only**: `REVOKE EXECUTE … FROM PUBLIC, anon,
authenticated; GRANT EXECUTE … TO service_role;` (per migration 038's rule —
new functions are PUBLIC by default). Staff panels already call the DB with the
service-role key from their server side. The **guest menu keeps its existing
`lfh_table_status(p_table)`** (it only needs open/closed for its own table) — it
does NOT use the staff brain.

## Consumers & rollout (no big-bang)

- New migration 041 adds the two functions. Nothing breaks on its own.
- As each panel is migrated (pieces 2–4), it switches from local tile maths to
  reading `lfh_floor_state()` / `lfh_kitchen_tickets()`.
- During migration the **old panels keep working**; the frozen copy in
  `reference/` and the `pre-rewrite-reference` git tag remain the fallback.

## Testing / verification

1. **SQL check:** call `lfh_floor_state()` and confirm table 3 shows
   `state:"served"`, `open:true`, `due:12.46` — i.e., the bug case is correct.
2. **Cross-panel check (Chrome MCP):** once a panel reads it, confirm editor,
   tablet, and admin show table 3 identically; flip a table open/closed on one
   screen and confirm the others match within ~1s.
3. **Regression:** existing guest flows (open/join/order) untouched; the guest
   `lfh_table_status` path still works.

## Out of scope (later pieces)

- The unified app shell, the floating top-right switcher, per-panel URLs, one
  shared env/secret location, `npm run dev` + `.bat` launchers, admin being the
  sole server — **piece 2**.
- Admin's redesigned dashboard + feature toggles moving out of the editor —
  **piece 3.** Role-based password login — **piece 5 (later).**

## Bigger picture (context, not built here)

Unified single app (one server) that behaves like all four panels + admin:
full-screen panels, floating switcher, each panel on its own URL, secrets in one
place, admin = the only server controlling everything. This spec is only the
**brain** that every panel will read; it is deliberately built first so nothing
on top of it can ever disagree again.
