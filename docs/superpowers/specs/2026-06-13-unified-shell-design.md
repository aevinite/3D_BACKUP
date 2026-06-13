# Spec — The Unified Shell (one app, one server)

- **Date:** 2026-06-13
- **Status:** Approach approved ("move screens in as-is, polish later"); building incrementally
- **Piece:** 2 of 5 in the rewrite
- **Depends on:** Piece 1 (the brain — `lfh_floor_state()` / `lfh_kitchen_tickets()`)

## Goal

ONE Next.js app (the existing root) is the only server. It serves all panels as
routes; the admin is the master. No more four local servers.

- Routes: `/menu` (exists), `/admin`, `/editor`, `/kitchen`, `/tablet`.
- **Admin-only floating switcher** overlaid on every panel: movable anywhere,
  can be a dropdown, to jump between panels. A normal customer on `/menu`, or
  anyone opening a single panel standalone, never sees it.
- Each panel has its **own URL** so a screen can show just that panel.
- **Secrets in one place:** the root `.env.local`; the service-role key is used
  ONLY in server-side route handlers, never shipped to the browser.
- `npm run dev` runs everything; a `.bat` launcher opens it.

## Approach (chosen: A — move screens in as-is)

Keep the current kitchen/tablet/editor UIs (vanilla HTML/JS) and bring them under
the one Next server, porting each panel's Express `/api/*` endpoints to Next
route handlers (server-side, service-role). Rebuild each panel into clean React
later, one at a time (piece 4). Fastest path to the one-window result, lowest risk.

## Build order within piece 2

1. **Admin floor view reading the brain** (first visible win): a server-only
   service client, `GET /api/admin/floor` → `lfh_floor_state()`, and an `/admin`
   page that polls it ~1s and renders live tiles. Proves the brain end-to-end.
2. **Floating switcher** (admin-only, movable, dropdown) + an "is admin" gate
   (reuse an admin password cookie; full role login is piece 5).
3. **Bring panels under the one server**: serve each panel UI at its route and
   port its `/api/*` endpoints to Next route handlers (service-role). Editor,
   kitchen, tablet — one at a time; old Express servers remain as fallback until
   each is proven.
4. **Launchers + cleanup**: `npm run dev` + `.bat`; retire the per-panel servers.

## Server-only secret handling

`lib/supabaseAdmin.ts` builds a service-role client from
`SUPABASE_SERVICE_ROLE_KEY`. It is imported ONLY by route handlers under
`app/api/**` (server). It must never be imported by a client component. This is
the "secrets in one place" rule realized.

## Verification

- Step 1: open `/admin`, confirm the live floor shows table 3 as busy/served
  with €12.46 due (the brain's answer), and that flipping a table open/closed
  elsewhere updates `/admin` within ~1s.
- Cross-panel: once panels read the brain, all show identical table states.

## Out of scope (later pieces)

Admin's full dashboard polish + feature toggles moving out of the editor (piece 3,
gets a visual design pass). Per-panel React rewrites (piece 4). Role login (piece 5).
