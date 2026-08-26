# T16 findings — sweep #7, 2026-08-27

Terminal 16 of 40. Territory: the admin console's **Restaurants · Owners · Settings · Billing &
plans · Recycle bin · Live floor**, plus the settings card those screens embed
(`components/admin/RestaurantSettings.tsx`).

Branch `sweep7/t16-admin-restaurants`, worktree `../wt-s7-t16`, dev port **4216**.
Ledger: `.claude/sweep/LEDGER/T16.md` — 500 existing rows re-run in place, 500 new rows
`P22601`–`P23100` added.

Every temporary row this run created was a `zzt16s7…` row and was removed **by its own id** in a
`finally` and on SIGINT/SIGTERM. Every write pass counts what is left as its last line; it was 0
every time. French House and Aangan were never written to. No login request was made at all — the
admin cookie was used throughout — so no rate limit could be touched.

---

## Fixed on this branch (one commit each, the number in the message)

| # | where | what was wrong |
|---|---|---|
| 1 | Owners → any owner | Deleting an owner left the page's `busy` flag set, so **every action button on the next owner opened was dead** until a reload. Released in a `finally`. Reproduced live on a temp owner. |
| 2 | Restaurants → Danger zone, Owners → Danger zone + delete dialog | All three still promised a **90-day protection window** the recycle bin stopped giving on 2026-08-20 (mig 342). A REGRESSION by drift: the ledger row `P07771` was ✅ in sweep #6 and the code around it moved. |
| 3 | Billing & plans → "Collected this year" | A currency stored as `inr` was **neither counted in the tile nor named under "not counted above"** — the money simply disappeared while the row still printed ₹. One grouping pass on a canonical code now produces both figures from the rows on screen; the editor sends a normalised code. |
| 4 | Access → Table setting | Clearing a table's seats box stored **1 seat**, while the card promises "nothing set = 4". Clearing now removes the entry. |
| 5 | Owners → New owner | Closing the password card with Escape / phone Back / the scrim **did not refresh the roster**, so an owner who had been created was missing from the list. |
| 6 | Restaurants → a restaurant → Tickets | A refused Resolve/Reopen **reverted with no reason given**. It now says why, in the card. |
| 7 | Restaurants → Open & manage (×4) and Recycle bin → panel buttons (×3) | A blocked tab answered "allow pop-ups for this site" — the wording the owner ruled on for the platform floor on 2026-08-20. All five now offer the panel **in this tab**. In the bin it also stopped landing in the slot whose Retry re-reads the counts. |
| 8 | Live floor → blocked-tab card | It offered the guest menu of a **suspended** restaurant, which is offline. |
| 9 | Access → Guest QR link per table | "Print sheet" **silently skipped** a table with no code. It now names them. (Also closed a stale "HANDOFF H3" note — that route change shipped.) |
| 10 | Billing → Payment history | A refused delete reported itself **one section up**, next to "Add payment". |
| 11 | Recycle bin | A dead `canPurge` permission flag that could only ever say yes, read by nothing, sitting on the type that describes a permanent delete. |
| 12 | Restaurants → a SUSPENDED restaurant → Danger zone | The line said suspending stops staff logging in. **It does not** — that is the recycle bin. Three other sentences on the same screen already said so. |
| 13 | Restaurants → New restaurant → the reused-address note | It said the previous occupant "went to the recycle bin", which is wrong when that restaurant was **removed for good**. |

All 13 are covered by `scripts/verify-admin-restaurants.mjs`, sections 11–23 (30 new checks). Run
against `origin/main`'s own files, 26 of the 30 go red and the four that pass are the ones asserting
something that was already true — and every one of the guard's PREVIOUS checks still passes there.

---

## Found, NOT fixed here — needs a decision (report items 14 and 15)

### 14 · A restaurant created on a REUSED web address can serve a 404 on its own guest menu

`lfh_guest_restaurant(p_slug)` (migration 282) is:

```sql
SELECT to_jsonb(r) - ARRAY[…] FROM restaurants r WHERE r.slug = p_slug LIMIT 1;
```

No `deleted_at IS NULL` filter, no `ORDER BY`. Since migration 309 a permanently-removed
restaurant's `restaurants` row **survives** (marked `purged_at`) so the kept bills have something to
hang off, and migration 319 made the slug's unique index partial (`WHERE deleted_at IS NULL`) so a
new restaurant may take the freed name. Two rows therefore legitimately hold one slug, and `LIMIT 1`
with no order can return the dead one — `lib/tenant.ts` sees `deleted_at`, returns null, and the new
restaurant's guest menu answers **404**.

Reproduced four separate times, with the resolver asked directly through the app's own public
function: it returned the row with `deleted_at` and `purged_at` set instead of the live restaurant.
It is **intermittent** — `LIMIT 1` with no order is not deterministic — which is worse, not better:
the same address can serve one minute and 404 the next. The admin console meanwhile lists the
restaurant as **Active**, and nothing on any admin screen says otherwise.

**Not fixed here on purpose:** it is a database migration and the guest resolver, neither of which
is this terminal's territory, and a migration on the shared dev database during a 40-terminal sweep
is exactly the kind of change that collides. The fix is one clause plus a deterministic order.

Evidence rows: `P07967`, `P23033`–`P23040`.

### 15 · The health filter chips on Restaurants do not clear when tapped again

Tapping the active chip a second time leaves the filter on; the "All" chip is the only way out. The
Owners page's KPI tiles next door DO toggle. Nothing is unreachable, so this is a preference — and
the two nearest decisions the owner has already made about chip furniture (R25, R40) both went the
other way, so it is listed rather than built.

Evidence row: `P22601`.

---

## Checked and found clean — do not re-report

* The four `select("*")` style reads flagged in sweep #6's `P07729`/`P07785` are single-row
  `.eq(…).maybeSingle()` template reads that clone restaurant #1's whole settings row. Bounded,
  scoped, deliberate, and present at sweep #6 too.
* The two recycle-bin choosers use `width: min(94vw, 520px)` where the other dialogs were changed to
  `min(100%, …)`. **Measured** at 360×780: it fits, both sides inside the viewport (`P23071`,
  `P22857`). A consistency nit, not a fault — not changed.
* The connection pill ("Live", 25px) is the shell's shared `connbadge`, and `docs/REJECTED-IDEAS.md`
  R40 refuses enlarging it for the third time. Excluded from the tap-target row (`P23079`) by name.
* `verify:purge` was `⏭` in sweep #6 (red before that branch). It is **green now**, and it asserts
  the retention lock stays removed — the same fact item 2 fixed on screen.
