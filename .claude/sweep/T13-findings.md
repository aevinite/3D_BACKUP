# T13 findings — sweep #7 · the owner's Menu, Team & Settings

**2026-08-27** · branch `sweep7/t13-owner-menu-staff` · port 4213 (production build, proved mine)
**Territory:** `app/owner/menu/**` · `app/owner/staff/**` · `app/owner/settings/**`
**Ledger:** `.claude/sweep/LEDGER/T13.md` — P06001–P06500 re-run, P21101–P21600 written

> ⚠️ The four-part report the owner reads is in the TERMINAL, not in this file — that is his own
> instruction for sweep #7. This file is the durable record of what was found and fixed, for the
> next sweep. It carries no improvement ideas.

**Six problems found, six fixed. One of them is a REGRESSION.** One commit each, numbered, so any
single one can be dropped without unpicking the rest.

---

## 1 · REGRESSION — `verify:staff-accounts` was red on clean code (ledger P06276)

**Where it lives:** backend only, nothing on screen. `scripts/verify-staff-accounts.mjs`.

The guard asserted that no action name among the last 30 rows of `/api/admin/oplog` contains the
letters "edit". That log is **platform-wide**, and the product has since grown three legitimate such
actions — `staff_profile_edit`, `staff_job_edit` (`app/api/owner/staff/route.ts`) and
`rate_limit_edit` (`app/api/admin/rate-limits/route.ts`) — each a write the owner is meant to see in
Audit & logs. With several sweep lanes sharing one dev database, one of them landing in the last 30
rows is close to certain.

**The guard was wrong; the route is right.** `app/api/admin/users` calls `logAction` for create,
set_job, set_permissions, reset_password, enable, disable, set_role, set_access, set_pin and delete,
and for nothing else. The tell was inside the file: its `before` and `newRows` locals were computed
and never used, so the row comparison it was reaching for had been started and never finished.

**Fixed:** it compares log-row id sets before and after, scopes the question to that one person, and
**proves its own matcher can see the `user_create` row that DOES name them** before it trusts an
absence. 41/41.

---

## 2 · The SECOND identical refusal never reached the screen (ledger P06230)

**Where it lives:** owner panel → Team → the Add row at the bottom of a restaurant card, on a phone.

Measured on 360×780. Add an existing username: the banner scrolls to y = 194 and is read. Tap Add
again unchanged: the banner sits at **y = −1190**, off the top, typing still in the boxes.

`setErr(sameString)` is a no-op in React, so nothing re-rendered and the scroll effect — keyed on
`[err]` — never fired again. F3 (2026-08-17) added that effect precisely because a refusal above the
fold is the same as no refusal; it only ever worked for the first attempt. **Six earlier passes each
measured one refusal.**

**Fixed:** the message carries a counter that always moves, and the effect watches it. Re-measured:
y = 194 both times. Guarded by `verify:owner-panel` §2, which asserts the property rather than the
spelling and goes red when the dependency is removed (proved).

---

## 3 · The printing card kept asking the server in a tab nobody was looking at

**Where it lives:** owner panel → Settings → "Kitchen printing".

Measured: 4 requests to `/api/owner/printing` in 40s with the tab in front, and **2 more in the next
35s after it was hidden**. The repeat was unconditional, so a restaurant with printing switched off —
which shows no card at all (R36) — paid for it too. Each call is five reads (the scope, `settings`,
then agents + routes + the waiting count): roughly **1,200 reads an hour** for a card nobody is
looking at. Every other owner page (Customers, Pay Later, Feedback & complaints) already skips a
hidden tab and stops on `visibilitychange`.

**Fixed:** gated on the card being present, skips a hidden tick, stops and restarts on
`visibilitychange`, unhooks its own listener. **15s is kept while the card is visible, deliberately** —
the admin's Printing screen uses the same cadence for the same reason (`HELPER_STALE_MS` is 30s, so a
slower tick would let the card call a sleeping computer ready). Re-measured: 0 requests while hidden.

---

## 4 · The printer-guide button's icon touched its own first letter

**Where it lives:** owner panel → Settings → Kitchen printing → "Open the printer setup guide".

Measured 0px between the book icon and the "O", at both widths and in both skins. Cause:
`.owx .adm-btn` is `display: inline-flex` with no `gap`, and a flex container discards the leading
whitespace of a text run. Its three neighbours escape it only because their emoji sits inside the text.

**Fixed:** an explicit gap on that button (7px, matching `.ost-btn`). Re-measured: 7px.

**Not fixed here, reported:** the same shape affects four more buttons in this console — Refresh /
Try again on Activity and on Feedback & complaints. One `gap` on `.owx .adm-btn` in
`app/globals.css` would cure all five. Those files are not this territory's.

---

## 5 · Searching for a disabled person left the "Team" heading empty

**Where it lives:** owner panel → Team → "Find someone".

Search a disabled person's name and every match lands under "Disabled · N", leaving "Team", blank,
then the group. They *were* found and the header says "1 of 2 shown", but the first thing the eye
meets is the search term under a heading with nobody beneath it.

**Fixed:** the gap now says "Nobody working matches "X" — the match below cannot sign in.", with a
no-search wording for a team who are all disabled. Guarded by `verify:owner-panel` §14.

---

## 6 · A second restaurant would have been told the wrong printer

**Where it lives:** owner panel → Settings → Kitchen printing → the restaurant rows.

`/api/owner/printing` answers for ONE restaurant — the pinned one, else the first — and does not say
which. The card's "which computer prints the kitchen slips" lookup sat inside the per-restaurant loop
but did not depend on the row being drawn, so an owner with printing on at two restaurants would have
read the FIRST restaurant's computer and printer on the SECOND restaurant's row.

**Not reachable on this stack** — no owner here holds two restaurants — so it was found and fixed by
reading. While there is exactly one row the answer provably belongs to it; beyond that the card falls
back to the per-restaurant sentence, which is correct either way. A single-restaurant owner sees no
change.

**The fuller fix belongs elsewhere:** `/api/owner/printing` should echo the `restaurant_id` it
answered for. That route is T20's.

---

## Guards this run leaves behind

| guard | covers |
|---|---|
| `verify:owner-panel` (69, was 61) | §2 gains the repeated-refusal check; new §13 (printing: gated, hidden-aware, unhooked, one answer per row, the icon gap, R36) and §14 (the empty Team heading) |
| `verify:staff-accounts` (41, was 40) | the corrected admin-edit claim, plus a self-proof that its matcher works |
| `verify:owner-s7` (300, new) | P21101–P21400 |
| `verify:owner-s7-live` (200, new) | P21401–P21600 |

**Every new check was negative-tested** — the fix was removed and the check confirmed red — rather
than trusted because it printed a tick.

## Reported, not fixed — outside this territory

1. `.owx .adm-btn` / `.adx .adm-btn` have no `gap`, so any icon+label button in either console loses
   its space. Five known today. One line in `app/globals.css` (T26/T29).
2. `/api/owner/printing` does not echo the restaurant it answered for (T20).
3. `--line` is declared by the panel stylesheets but **not** by the owner/admin console, so
   `components/owner/OwnerMenuEditor.tsx`'s restaurant-switcher bar falls back to a dark navy
   hairline in the light skin. Only visible to a two-restaurant owner. `components/owner/` is not
   this territory's.
4. `components/admin/TicketCard.tsx` and `components/admin/NotificationBell.tsx` read `var(--line)`
   with **no fallback at all**, in the same console (T15/T16).

## Nothing was written to the database by this run's own checks

Every forced state was produced by answering this browser's own request differently. The two guards
that do write clean up by id and assert they left nothing behind. Aangan untouched; AV live never
referenced; the deploy lock never taken; `main` never touched.
