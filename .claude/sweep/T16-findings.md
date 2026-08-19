# T16 findings — the admin's restaurants, owners, settings, billing, bin & platform floor

Sweep #6, terminal 16. Phases **P07501–P08000**. All eight were FIXED in this branch; the four
biggest were observed BEFORE and AFTER the fix by running the same check against the committed
file and then the fixed one, with the dev server hot-reloading between them.

| # | severity | what a person loses | where it lives | how it was confirmed | ledger rows |
|---|---|---|---|---|---|
| 1 | HIGH | The admin picks a setting on Access (tables per row, what a menu price means, which screen prints the kitchen ticket), closes the row, and the pick is gone — no write, no Save bar, no message | Admin → Access & permissions → any embedded settings card (`components/admin/RestaurantSettings.tsx`) | confirmed — drove the real Access row: before, a pick of 9 left the stored value at 4; after, 9 and then 7 both stored | P07602–P07604 |
| 2 | HIGH | A restaurant WITH an owner reads as having none, in the list and in the Owner card, so the admin assigns somebody and quietly replaces an owner nobody told them about | Admin → Restaurants (Owner column) and a restaurant's Owner card (`app/aevinite/restaurants/page.tsx`) | confirmed — suspended a fixture owner: before, the column read "—" and the card read "— no owner —"; after, "assigned · not active" and a named explanation | P07523, P07524, P07814, P07815 |
| 3 | MEDIUM | Every restaurant door on the platform floor does nothing and says nothing when the browser blocks the pop-up | Admin → Live floor (restaurant names, open-table chips, Today-tab names) | confirmed — window.open stubbed to null, which IS the blocked-pop-up condition; before, silence; after, "allow pop-ups for this site, then tap again" | P07667, P07735, P07859–P07861 |
| 4 | MEDIUM | The admin sets 7 days of log retention believing it applies everywhere, while a restaurant whose manager chose "3 months" keeps 90 days of activity and customer log | Admin → Settings → Log retention (`app/aevinite/settings/page.tsx`) | code-read + confirmed on screen — mig 157 makes the value a DEFAULT, and the manager panel's own picker offers 90 days | P07697, P07698, P07872, P07975 |
| 5 | LOW | Attach five restaurants to an owner, have the third fail, and the pane shows none of them — so the admin re-picks all five | Admin → Owners → an owner → Assign restaurant | confirmed — one attach 200 + one 404 leaves a real half-done batch; the pane now lists what landed | P07580, P07845 |
| 8 | HIGH | The settings cards on a JUST-CREATED restaurant lock themselves behind "Couldn't load this restaurant's settings" | Admin → Access & permissions, seconds after creating a restaurant | confirmed — two concurrent first loads: one 200, one 500 ("couldn't mint unique codes"); seen on screen, and gone after the fix | P07594 |
| 9 | MEDIUM | Two of a restaurant's four tile rows on the platform floor are one unreadable run of digits | Admin → Live floor → a restaurant's tile grid | confirmed BY READING A SCREENSHOT, then measured: 8 seven-digit labels, 22px squares, no clipping | P07915 |
| 12 | MEDIUM | The Table setting card states the opposite of what the printer does with a renamed table | Admin → Access → Table → Table name & seats (`components/admin/RestaurantSettings.tsx`) | confirmed — named table 5, rendered the real bill: it printed "Table zzt16 Banquet", against the card's "bills & QR codes keep the number" | P07931 |

Two more were phone polish the code had already asked for and not got (items 10 and 11): the floor
gate's only button measured 40px against its own `min-height: 44px`, and the billing editor's card
sat ~2px off a 360px screen. Both fixed.

## 🔗 HANDOFF — the real fix is outside this territory

| id | file | the change needed | why |
|---|---|---|---|
| H1 | `scripts/verify-purge-classified.mjs` (or a migration extending `admin_purge_restaurant()`) | classify `bill_chain` and `print_stations` — `bill_chain` belongs on KEEP ("the signature chain that proves the KEPT bills were not altered", mig 332); `print_stations` (mig 338) is operational and should be purged | `npm run verify:purge` is RED on `origin/main` and stays red. Its FK to `restaurants` is `ON DELETE CASCADE`, but the purge deliberately keeps the restaurants row, so the rows genuinely linger |
| H2 | `public/panels/editor/app.js` → `RETENTION_OPTS` · `app/api/editor/[...path]/route.ts` → the 1..90 clamp | drop the "3 months" option and clamp to 30, so the owner's "1 month MAX" (2026-07-09) is enforced and not just stated | the admin's platform default cannot cap a restaurant that chose its own window. I fixed the honesty half on the admin screen; only these two files can fix the enforcement half |
| H3 | `app/api/admin/restaurants/settings/route.ts` → `ensureCodes()` | `insert(missing)` → `upsert(missing, { onConflict: "restaurant_id,table_number", ignoreDuplicates: true })`, then re-read the map | two first loads on a new restaurant race to mint the same table codes; the retry loop re-mints the CODE while the conflict is on the (restaurant, table) pair, so all three attempts fail and the route 500s. Reproduced: 200 + 500 |
| H4 | `lfh_floor_state` (mig 126) / `app/api/admin/floor/route.ts` | decide whether an order keyed by something that is not a table number should arrive as a "table" — the list is `generate_series(1, table_count)` UNION every session/order `table_number`, and French House carries eight 7-digit ones | I stopped them smearing across the tile grid; whether they belong on a floor at all is not a display question |
