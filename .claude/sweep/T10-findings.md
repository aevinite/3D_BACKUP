# T10 findings — guest & staff-panel API routes (phases P04501–P05000)

Four real problems in 10,733 lines across 25 files. All four are FIXED in this branch.
No `🔗 HANDOFF` blockers — one handoff row is listed at the end for a fix that lives in
another terminal's file.

Everything else in the territory came back clean. In particular: the four `[...path]`
catch-alls' tenant scoping, every money gate, the tri-state waiter caps, the discount
caps, the Z-report numbering, the guest offline-replay routes, the two login doors, the
rate limits and the bot check were all read line by line and are correct.

---

## F1 — the staff sign-in page shows an error page instead of the form when the database is slow

* **Where** — the staff sign-in screen (`/login`, and the tenant door `/r/<slug>/login`).
  What the person sees: a bare "Application error" page instead of the Username / Password card.
* **Severity** — medium. Nobody can start a shift; the screen gives them nothing to act on.
* **Named person** — a manager, waiter or cook arriving at the sign-in screen while the
  database is having a sustained flap.
* **How it happens** — the page calls `userFromCookie()` to decide whether to redirect an
  ALREADY-signed-in person straight to their panel. That function deliberately THROWS
  `AuthDbError` when the `staff_users` lookup itself fails (it already retries once). The throw
  was uncaught, so Next rendered its error page. `lib/userAuth.ts` says this in its own words:
  *"a brief DB/DNS flap otherwise threw AuthDbError, which the page/layout gates surface as a raw
  500"* — and *"a transient outage must surface as 503 ('try again'), never as 'please log in'"*.
* **Why it matters that the form renders instead** — with the form on screen, the sign-in POST
  answers 503 with "Server can't reach the database — retrying", which the card shows and the
  person can retry from. From the crash page they have to guess to reload.
* **Confirmed** — code-read. (`app/owner/layout.tsx`, `/api/panel-logout` and `/api/panel-profile`
  were each fixed for this exact shape in the T17 sweep; `/login` was left behind.)
* **Fix** — catch `AuthDbError` and fall through to the form. The form is public, so falling
  through discloses nothing; the worst case is that a signed-in person sees the card for a moment
  instead of being auto-redirected.
* **Guard** — `scripts/verify-panel-api-guards.mjs` → "a login door never lets AuthDbError escape".

## F2 — attaching a photo to a floor problem says "please log in" to someone who IS logged in

* **Where** — manager / kitchen / waiter-tablet panels → the "⚠️ Report a problem" sheet → Add
  photo or a voice note. What the person sees: **"Couldn't send: Not authorised — please log in."**
  and the whole report — photo, voice note and text — is abandoned rather than saved.
* **Severity** — medium-high. The report is LOST, and the message is actively misleading: it tells
  a signed-in cook their session is bad when it isn't.
* **Named person** — a cook or waiter photographing a broken fryer / a wrong delivery while the
  database is having a sustained flap.
* **How it happens** — `app/api/issue-media/route.ts` wrapped `userFromCookie()` in
  `try { … } catch { /* treat as not-staff */ }`. That comment was written for a BAD COOKIE, and
  it swallowed `AuthDbError` too — so a database blip turned a signed-in staff member into
  "nobody", and the `if (!staff && !isAdmin)` line answered 401. `public/panels/issue-raise.js`
  throws on any non-ok upload, so `sendBtn` fails before the text is even queued.
* **Confirmed** — code-read, and the client's failure path read line by line
  (`issue-raise.js` `uploadMedia` → `throw` → `catch` → "Couldn't send: …").
* **Fix** — tell the two apart: only a genuinely bad/absent cookie falls through to the admin
  check; `AuthDbError` answers **503 with the `busy` marker** every other panel route uses
  (`lib/dbRefusal.BUSY_MESSAGE` + `X-LFH-Busy: 1`), which is a "try again", not a "log in".
* **Guard** — `scripts/verify-panel-api-guards.mjs` → "issue-media tells a blip from a bad cookie".

## F3 — one database blip can leave every screen in the restaurant polling every 5 seconds, for the rest of the day

* **Where** — backend only, nothing on screen at first: `/api/rt-config` is what every staff panel
  asks for before it opens its live connection. What the owner would eventually SEE is the
  connection badge on the manager / kitchen / tablet panels stuck on "weak", and boards updating a
  few seconds late instead of instantly.
* **Severity** — medium. Nothing breaks; it costs live-ness and a lot of database reads.
* **Named person** — the owner (egress bill and slower boards) and every member of floor staff
  (a KOT can be several seconds late).
* **How it happens** — three things line up:
  1. `rt-config` called `userFromCookie()` bare, so a sustained database flap made the route throw
     an unhandled, unclassified 500;
  2. `public/panels/realtime.js` → `getClient()` does `await (await fetch(...)).json()`, which
     throws on that body, so `sb` stays null and the panel falls back to `catchUp()` — a **5-second**
     board poll;
  3. `catchUp()` never re-attempts `ensureClient()`. The only things that do are `visibilitychange`,
     `focus`, `pageshow` and `online` — **none of which ever fire on a wall-mounted kitchen display
     that is never touched.** So the 5-second poll runs until somebody reloads the page.
* **Confirmed** — code-read across three files, plus the running route on :4110 (the route answers
  correctly when the database is healthy, which is why this has never been noticed).
* **Fix (my half)** — `AuthDbError` now answers **503 with `reason: "rt_busy"`, `retryable: true`**
  instead of escaping as an unclassified 500. The badge can branch on the code (the house rule:
  branch on codes, never on prose), and this route stops being the one panel API that has no
  answer for "the database didn't reply".
* **🔗 HANDOFF (not my file)** — `public/panels/realtime.js`: after a FAILED boot, `catchUp()`
  should also retry `ensureClient()` (it already runs on a backing-off timer, and it already knows
  `connStatus !== "online"`). One line inside its `run()`: `if (!sb) await ensureClient();` before
  the `fn()` call. Without it, an always-visible screen still cannot recover from a boot failure of
  ANY cause — a slow cold start, a blocked CDN, a 502 from the platform — not just this one.

## F4 — the same ingredient twice on one purchase bill puts the wrong quantity into stock

* **Where** — manager panel → **Inventory** tab → **🧾 New vendor bill** / **⚡ Quick cash buy** →
  add the same ingredient on two lines (two crates at different rates, or a correction). What the
  owner would SEE afterwards: the bill total is right, but the ingredient's stock on hand and its
  average cost are wrong, and "what to order today" is wrong with it.
* **Severity** — high for a restaurant using Inventory. It is a silent money-and-stock error: the
  purchase record and the stock ledger disagree, and nothing on any screen says so.
* **Named person** — the manager entering the bill, and the owner reading stock value / the order list.
* **How it happens** — `app/api/inventory/[...path]/route.ts`, the purchases POST. The lines are
  inserted correctly, then the stock movements are posted in a loop that looks each line back up by
  a NON-UNIQUE key:

  ```js
  for (const row of li.data || []) {
    const l = lines.find((x) => x.item_id === row.item_id)!;   // ← first match, both times
  ```

  With tomatoes on lines 1 and 2, `find` returns line 1 for BOTH inserted rows. So the second
  movement posts line 1's `qty_base` and line 1's rate, and `last_rate` is written from line 1 twice.
  Buying 10 kg @ ₹20 and 5 kg @ ₹30 puts **20 kg** into stock instead of 15, valued at the wrong
  average. The dedupe keys are per LINE id, so nothing catches it — each movement is "new".
* **Reachable** — `public/panels/editor/inventory.js` → `purchasePop()` `$("#ppAdd").onclick`
  pushes a line with **no duplicate check at all**, and `inv_purchase_lines` has **no unique
  constraint** on `(purchase_id, item_id)` (migration 221), so both rows insert. Putting the same
  item on two lines of one bill is ordinary — two pack sizes, two rates, or a corrected quantity.
* **Confirmed** — code-read + a reproduction of the exact lookup with no database
  (see the guard). NOT driven against the live inventory module on purpose: stock movements are an
  append-only ledger, so a test purchase would leave rows that cannot be cleanly removed, and
  Inventory is switched off for French House anyway.
* **Fix** — stop looking the line back up at all. `inv_purchase_lines` already returns
  `qty_base`, `rate` and `amount` on the inserted row, so each movement is posted from the row it
  actually belongs to; only `purchase_factor` and `track_level` are looked up, and those are
  per-ITEM so a shared lookup is correct for them. `last_rate` now ends on the last line's rate,
  which is the most recent rate paid — previously it was line 1's, twice.
* **Guard** — `scripts/verify-panel-api-guards.mjs` → "a purchase line's movement comes from its own
  row", which both greps the route for the old `lines.find(` shape and runs the two-line
  reproduction.

---

## 🔗 HANDOFF rows (for the merge terminal)

| file | change needed | why |
|------|---------------|-----|
| `public/panels/realtime.js` | in `catchUp()`'s `run()`, re-attempt `ensureClient()` while `sb` is null | F3 — an always-visible kitchen display can never recover from a failed realtime boot; nothing fires `visibilitychange`/`focus`/`pageshow`/`online` on it |
| `lib/panelGate.ts` | `requirePanel` / `panelAdminRid` / `requirePanelAt` call `userFromCookie()` bare | same shape as F1: a database flap renders a raw error page on `/manager`, `/kitchen`, `/tablet` instead of bouncing to the login door. Not my file; the fix is the same try/catch |
| `app/r/[restaurant]/login/page.tsx` | same bare `userFromCookie()` call as F1 | the tenant-scoped sign-in door has the identical crash; my F1 fix covers `/login` only |
| `lib/logTrail.ts` | give `kot_printed`, `kot_print_failed` and `admin_enter_panel` a place | **`npm run verify:read-guards` is RED on `origin/main` already** — not caused by this branch. Proven: the two files that check reads (`lib/logTrail.ts`, `components/admin/shared.tsx`) are byte-identical to `origin/main` in my tree. Those three codes were added on 2026-08-16 without a matching trail entry, so their Activity rows read "System › Other" — the exact thing the owner's 2026-08-12 rule forbids |
| `supabase/migrations/**` (`lfh_staff_unmerge_table`) | separating two merged tables emits no realtime breadcrumb | **`npm run verify:write-paths` is RED on `origin/main` already** — "3664 SEPARATING them announces itself too — 0 crumb(s)". Merging emits 5; unmerging emits none, so the other devices' tiles only catch up on the 60s backstop. A database-function concern (T21–T23) |
| `scripts/verify-write-paths.mjs` | its cleanup cannot work, and never could | the same gate's "cleanup: no ticket this test placed is left on the kitchen board" tries a **hard DELETE** of its own orders. Migration 190 (`trg_block_issued_delete`) deliberately refuses to hard-delete an order that is served, paid, or on a session with a `bill_no` — "a sale can be cancelled, a sale can never disappear". So every run of this gate, by every terminal, leaves tickets behind and reports itself failed. It should CANCEL them (what `closeSession` does, mig 232) instead, and it should check the delete's `.error` rather than ignoring it. **I cleared my own run's three live tickets by id** (kot 67/68/69 on French House, cancelled + archived — never deleted), and deliberately left other terminals' rows alone |
</content>
