# Manager PIN gating, unified table-close, and maintenance lockdown

**Date:** 2026-06-17
**Status:** Approved (owner) — ready to implement

## Goal

Add a **per-manager PIN** that gates a few sensitive **tablet** actions, **unify the
table-close logic** across the manager and tablet panels, and **lock down the
maintenance switch** (remove the floating button everywhere; restrict to admin +
manager). Builds on existing infra: `staff_users.pin_hash` (per-user, already there,
commented "Phase 3 money gates"), `can_self_reset` (password self-reset toggle), and
the first-login `profile_confirmed` capture flow.

## Decisions (from owner)

1. **PIN is per-manager** (not one shared PIN). Each manager has their own PIN in
   `staff_users.pin_hash`. A tablet action is unlocked by **any active manager's PIN**;
   the log records which manager authorized it.
2. **Who can set a manager's PIN:** the manager themselves OR the admin — controlled
   by a per-user admin toggle **`can_self_set_pin`**, mirroring `can_self_reset`.
   - Toggle ON  → the "Set/Change PIN" option shows in that user's profile drawer.
   - Toggle OFF → it's hidden; only admin can set it (in the Users editor).
3. **First-login capture:** when a **manager** logs in for the first time and has **no
   PIN yet** *and* `can_self_set_pin` is ON, the one-time welcome drawer (name + phone)
   **also requires a PIN** before they can continue. If `can_self_set_pin` is OFF, the
   PIN is not forced (admin will set it) — never lock the manager out.
4. **Tablet actions requiring a manager PIN:**
   - **Ban guest** — always.
   - **Discount** — always.
   - **Close table** — only when blocked (unpaid bill OR an order still going). Free if
     nothing's been ordered.
   - **Restart table** — same rule as close.
   - Kick / Make-head / Shift / Attend / take-order — never (waiter freedom).
   - Manager (editor panel) and admin are **never** prompted.
5. **Table-close rule (both panels, identical):** blocked if any order is **unpaid** OR
   **still cooking** (status `received`/`preparing`). A **"close anyway" override** stays:
   on the editor the manager just confirms; on the tablet the override is exactly the
   case that **requires a manager PIN**.
6. **Maintenance:** remove the floating top-right "Menu live/offline" button from **every**
   panel. Keep it only in the **admin panel** (its own switch) and the **manager's profile
   drawer** (manager login is enough — no PIN). Kitchen and tablet lose it. Lock the
   `/api/maintenance` endpoint server-side to **admin-or-manager**.
7. **Bootstrap:** until a manager PIN exists, gated tablet actions stay **open** (today's
   behavior) so a waiter is never locked out mid-service; enforcement begins once any
   active manager has a PIN.

## Components & data flow

### DB — migration `057_staff_can_self_set_pin.sql`
- `ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS can_self_set_pin boolean NOT NULL DEFAULT true;`

### `lib/managerPin.ts` (new)
- `verifyManagerPin(pin): Promise<{ ok: boolean; managerId?: string; managerName?: string }>`
  — loads active `manager` users that have a `pin_hash`, checks the PIN against each with
  the existing PBKDF2 `verifySecret`. Returns the first match (for logging). Slow hashing
  is the brute-force deterrent; add a small per-process attempt throttle.
- `anyManagerHasPin(): Promise<boolean>` — for the bootstrap rule (#7).

### `lib/sessionClose.ts` (new) — the single shared close function
- `closeSessionOrThrow(sb, sessionId, { force }, actor): Promise<sessionRow>`
  - Block (throw a tagged 409 error) if unpaid OR cooking orders exist and `!force`.
  - On force/clear: set session `closed`, cancel+archive un-served unpaid orders, archive
    the rest, log `close_unpaid` (if money owed) + `table_close`. All writes `must()`-checked
    (fixes the tablet's previously-swallowed errors — old item #2).
- Both `app/api/editor/[...path]` and `app/api/tablet/[...path]` close endpoints call it.

### API
- `app/api/admin/users/route.ts`: GET returns `can_self_set_pin`; PATCH `set_access`
  also accepts `can_self_set_pin`; new PATCH `set_pin` (admin sets/clears a user's PIN,
  hashed; logs `pin_set`).
- `app/api/panel-profile/route.ts`: GET returns `canSelfSetPin`; POST `pin` honors the
  toggle (reject if off); first-login `profile_confirmed` flow accepts an optional `pin`.
- `app/api/maintenance/route.ts`: POST now requires admin-or-manager (server-side).
- Tablet route: ban / discount require a valid `managerPin`; close/restart force requires
  a valid `managerPin` (when blocked). Each logs the authorizing manager. Editor route
  unchanged on auth (manager already).

### UI
- `app/aevinite/users/page.tsx`: add "Can change own PIN" ToggleRow + an admin PIN
  set/clear area (mirrors the password area), shown for `manager` users.
- `public/panels/maint.js`: delete `buildAdminToggle` (floating button); show the drawer
  maintenance section only for `manager`; gate the PIN section on `canSelfSetPin`; extend
  the first-login card to require a PIN for managers per #3.
- `public/panels/tablet/app.js`: a PIN-prompt modal; ban/discount prompt first; close/restart
  retry-with-PIN on a 409/403 "needs manager PIN".

## Testing
- Unit: `verifyManagerPin` (right/wrong PIN, inactive manager, no-PIN bootstrap).
- Unit/logic: `closeSessionOrThrow` block conditions (unpaid, cooking, force).
- Typecheck clean; `node --check` on all panel JS.
- Manual/browser: maintenance hidden on kitchen/tablet, present on manager + admin;
  tablet ban/discount prompts for PIN; close on an empty table is free; close on an
  unpaid/cooking table prompts for PIN on the tablet and "close anyway" on the editor.

## Out of scope
- No change to the shared/anon menu, the 3D pipeline, or kitchen actions.
- No multi-tenant work.
