# T20 — improvements · admin server routes (part B) + the owner routes

Five built (🟢, all inside my territory, none needing a migration, a screen, a module or a
permission). Four left for the owner to decide (🟡). Phases P09501–P10000.

---

## 🟢 BUILT

### I1 (item 6) · Four switches can no longer die on a name the recycle bin gave back
`settings.id` is a PRIMARY KEY (mig 003). Migration 319 frees a restaurant's slug the moment it is
binned, but a binned restaurant KEEPS its settings row — so a name can be free in `restaurants` and
still taken in `settings`. Four routes keyed a new settings row by the slug, and their upsert
conflicts on `restaurant_id`, not on `id`, so the clash surfaces as
`duplicate key value violates unique constraint "settings_pkey"` on the admin's screen for flipping a
switch. The create route and quick-features were moved to the uuid on 2026-08-16; these four were
left behind: `platform-channels`, `google-review`, `staff-features`, `restaurants/settings`.

Not reachable today (all 17 restaurants have a settings row, so the clone branch never runs). Closed
because the symptom is invisible until it happens. Three of them now read one column fewer.
Guard: `npm run verify:admin-refusals` walks `app/api/admin` and finds every settings-template cloner.

### I2 (item 7) · The console stops showing Postgres prose in its red toast
26 sites across 10 routes now go through `lib/adminFail`, which keeps a plain sentence in `error` and
the database's own words in `detail` + the server log. The helper was written for this on 2026-08-14
and the rollout was never finished, because nothing was watching.
Guard: `verify:admin-refusals` scans all 49 admin routes and carries a shrink-only `NOT_YET` list
naming the eight files in the other half of the admin API that still send raw prose.

### I3 (item 8) · Pay Later says when it couldn't tell which restaurant a debt is from
`lib/restaurantNames` reports a failed lookup as `partial` — that IS finding F17 — and five of six
callers passed it on. Khata dropped it, so every debt rendered "—" with nothing saying why.
Guard: all six callers checked in `verify:read-guards`.

### I4 (item 9) · A recovery backup that is incomplete says so at the top
`_meta` now carries `failed` (which tables could not be read), `complete` (one flag a restore script
can branch on) and a note leading with "INCOMPLETE BACKUP". Previously a failed table was only visible
if you scrolled to that key in a hundred-thousand-line file, so the download looked complete.
Guard: `verify:admin-refusals`.

### I5 (item 10) · The owner dashboard stops reading the whole restaurant list twice
Two expense tiles each resolved the scope for themselves, and on the admin's all-restaurants view that
means paging the whole `restaurants` table — twice per recompute, the second waiting on the first.
One memoised list, both tiles started together. Still a promise, so a single-restaurant owner pays
nothing. No figure changes.
Guard: `verify:admin-refusals` — at most one call site, and the two tiles fetched together.

---

## 🟡 NOT BUILT — his call (full six-line rows are in the chat report)

### Y1 (item 11) · Three finer manager staff switches are half-built
`app/api/owner/staff` has `mgrStaffOpt("create"|"reset_pw"|"delete")` reading
`access_config.manage_staff.manager_opts.*`. Only `reset_pw` is ever called; `create` and `delete`
have no call site, and **no node in `lib/accessTree.ts` writes that path at all**, so all three fall
back to their defaults and `reset_pw` defaults open. Nothing is broken today (default open = the
behaviour before the switches were imagined) and one wasted indexed read per manager password reset.
Either finish it (a node per switch in `lib/accessTree.ts` — another terminal's file, so a
🔗 HANDOFF) or delete the helper. A product decision, not a bug.

### Y2 (item 13) · Platform revenue silently under-reports past PostgREST's row caps
`/api/admin/revenue` reads `restaurant_billing` and `restaurants` with no paging and
`restaurant_payments` capped at 10,000 rows ordered newest-first. Past those caps MRR, the status
bars and "collected all time" go quietly small — the same class `scopedRestaurantIds` and
`allRestaurantIds` were written to page around. Harmless at 17 restaurants. Doing it properly is a
SQL aggregate, i.e. a migration, which is outside a 🟢 improvement.

### Y3 (item 14) · A restaurant's Full report shows three figures as absent on a read blip
`/api/admin/restaurants/report` swallows the errors on the owner-name, plan and table-count reads, so
each reads as "—" or 0 rather than "couldn't read it". The owner panel has the `partial` convention
for exactly this; the admin console has no such convention yet, so adopting it here is a product
decision about how the console should behave, not a one-line fix.

### Y4 (item 15) · Assigning an owner to a restaurant that no longer exists answers "Saved"
`PATCH /api/admin/restaurants` does not confirm the restaurant exists, so a valid-but-unknown uuid
updates 0 rows and still returns `{ok:true}` — the silent-success shape the branding route was fixed
for on 2026-07-06. Not reachable from the console's own list today (a purge keeps the row and a bin
keeps the row), which is why it is a 🟡 and not a fix.

### Y5 · Two admin screens disagree about how to CLEAR a channel key
See 🔗 H2 in the findings file. `""` clears on one route and `null` clears on the other, on the same
column. Both are mine to change; I did not, because each screen matches its own route and picking the
winner is a decision.
