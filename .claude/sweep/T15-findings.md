# T15 — ADMIN ACCESS TREE & PEOPLE · problems found

Working machinery for the merge terminal. The owner reads the chat window, not this file.

Territory: `app/aevinite/access/**` · `app/aevinite/users/**` · `components/admin/AccessTree.tsx` ·
`components/admin/StaffProfile.tsx` · `lib/accessTree.ts` · `lib/accessModel.ts` · `lib/staffCaps.ts` ·
`lib/staffProfileShared.ts` + the three docs. Phases P07001–P07500.

| # | severity | state | what | where it lives | commit |
|---|----------|-------|------|----------------|--------|
| P1 | HIGH | fixed | The admin could not create a WAITER at all — the Add-a-user form never sent `tables`, and `newWaiterTables()` refuses an empty pick for every restaurant. The form submitted and the server answered "Pick at least one table… Use 'Select all'", naming a control that was not on the screen. `confirmed` — watched on French House. | admin console → Users → + Add user → Role: Tablet (waiter) → Create user | `cadc31b9` |
| P2 | MEDIUM | fixed | Access & permissions → Manager → "Permission for manager" told the admin, in its own description, that the group holds "delete a bill", and the Bills row said "Reopen, delete and discount keep their own rows above". That row was deleted on 2026-08-16 (`docs/REJECTED-IDEAS.md` R27) and must never exist. `docs/ACCESS-MODEL.md` §B listed it as live too. `confirmed` — read on screen. | admin console → Access & permissions → Manager → Permission for manager (the row's own words and its ⓘ) | `e43150bd` |
| P3 | MEDIUM | fixed | On the LIGHT admin skin the "Default" chip — the one thing saying whether every manager or waiter at a restaurant starts with a power on or off — measured 1.91:1 (On), 2.99:1 (Off), 1.83:1 (On + PIN), and the word DEFAULT 2.45:1. Dark: 6.55 / 4.25 / 6.86 / 6.79. `confirmed` — measured on the running screen in all three real states. | admin console → Access & permissions → Manager and Waiter → the green/red/amber chip on a two-control row | `09162771` |
| P4 | MEDIUM | fixed | On the LIGHT admin skin the Users page's red error banner read 1.90:1 and the green banner carrying a brand-new password read 1.40:1 ("copy it now, it won't be shown again"). Dark: 9.72 and 13.14. `confirmed` — measured and looked at. | admin console → Users → the bar at the top after a create or a failure | `b12cb12e` |
| P5 | LOW | fixed | The rail's "Record complete X of 14" counted a **pay setup** that most records have no card to enter: the Pay card needs a non-owner, in a role with a profile, at a restaurant whose payroll module is on — and it ships off. A cook, an owner and everyone at a payroll-off restaurant could never finish their record. `code-read` + confirmed on three real people. | admin console → Users → a person → the left rail, "Record complete" | `82921b1f` |
| P6 | LOW | fixed | Picking another restaurant carried the previous one's open dropdowns across AND overwrote that restaurant's own remembered layout — the save effect runs before the reset effect on the rid change. The comment beside it has always claimed the opposite. `confirmed`. | admin console → Access & permissions → the restaurant picker at the top right | `6d72c5b9` |
| P7 | LOW | fixed | A refused save on a staff profile (someone else changed the same field first) printed the machine code `clash_changed_elsewhere` at the admin. The owner's copy of the same panel, and the Access screen, both show the plain sentence. `confirmed`. | admin console → Users → a person → any card's Save, when a second person has moved that field | `94a9bbef` |
| P8 | LOW | fixed | Opening ⓘ on any of the ~86 rows with no captured screenshot showed two bordered boxes carrying their alt text plus the "Example from a demo restaurant" caption, until the 404s came back. The code's own note claimed it "never shows a broken image". `confirmed`. | admin console → Access & permissions → the ⓘ on any row | `236f997e` |
| P9 | LOW | fixed | Seven `HELP_SHOTS` keys named rows renamed away in 2026-08, so they matched nothing. Invisible today (a key that matches no row looks exactly like one never written) — the point is the guard. `code-read`. | backend only, nothing on screen | `d7cd448f` |
| P10 | LOW | fixed | `docs/ACCESS-MODEL.md` A1 was missing the "Prep time on a dish" row and had Bubble effect and Design and styling in the wrong order, calling the wrong one "(last)". `code-read`. | backend only, nothing on screen — it is the spec the next session builds from | `b91f229c` |

## 🔗 HANDOFF — the fix lives in another terminal's files

### H1 · a module gate with no switch on the screen — table_ops and table_tags (HIGH)

**Measured on the backup database, 2026-08-18.** `settings.table_ops_allowed` is **false** on
`burger-barn`, `sakura-sushi`, `demo-bistro`, `green-bowl`, `taco-fiesta`, `pizza-palace` and
`spice-route` — true only on `french-house` and `aangan`. `table_tags_allowed` is false on the same
seven minus `pizza-palace`.

`lib/accessModel.ts` still carries a `module:` binding for both, so `app/api/editor`'s whoami forces
`effectivePowers.table_ops = false` and `app/api/tablet` forces `tablet_table_ops = "off"`. The
2026-07-31 rebuild deleted those module switches, so a stored `false` is unreachable from every
screen — the owner's settings page only offers a module whose `_owner_control` is on, and it writes
`_enabled`, not `_allowed`.

**Watched, on French House put into that state and put back:** Access & permissions → Waiter →
"Move, merge or split a table" reads **On**, while the manager panel is told
`effectivePowers.table_ops = false` (the KOT ▾ menu — move a party, merge two tables, move a ticket,
move a dish, split a bill, reprint a KOT — is gone) and the tablet is told `tablet_table_ops = "off"`.
`table_tags` is worse: the manager is refused while the tablet is still told "on", so the two panels
disagree with each other as well as with the screen.

**The change, and it is the one parcel and platform already had (2026-08-03, mig 263):**

1. `lib/tableTags.ts` — `tableOpsLadder`, `tableTagsLadder` and `takeOrdersLadder` return `ALWAYS_ON`,
   exactly as `parcelLadder` / `takeawayLadder` do.
2. `app/api/tablet/[...path]/route.ts` — `tableOpsEffectiveFromRow` and `takeOrdersEffectiveFromRow`
   return `true`, exactly as `parcelEffectiveFromRow` already does (its comment states the reason:
   "an old row may say false — reading it again would let a retired switch take a live feature away").
3. `lib/accessModel.ts` *(T15's own file — deliberately left undone, because doing only this half
   would fix the manager and leave the tablet refusing)* — drop the `module:` binding from
   `take_orders`, `table_ops` and `table_tags`, as the file's own note at the parcel/platform rows
   instructs: *"Do not re-add a module binding without a switch on the Access screen to go with it."*
4. Take those three names out of `HANDOFF_PENDING` in `scripts/verify-access-model.mjs` check 23 in
   the same commit — the guard fails if they are left there after the bindings go.

**The alternative, if the owner would rather keep the gate:** put the two module switches back on
the Access screen (Extra features) instead. Either way the screen and the server must stop
disagreeing. This is listed for him as 🟡 D2.

### H2 · the Recent-changes strip says "pin", not English (LOW)

`app/api/admin/restaurants/access-tree/route.ts` → `describeAccessPatch`. A `tablet` bind's value is
written raw, so the strip reads **"Mark a bill paid: pin"**. The `capTablet` branch of the same
function, twenty lines below, correctly says "on, with a manager PIN". Six of the eight waiter rows
are column-bound, so this is the common case. It also writes no section prefix, although the comment
in `components/admin/AccessTree.tsx` describing the log claims the format is
"Menu → 3D dish viewer: off · Manager → Delete a bill: on".

**The change:** in the `patch.settings` loop, route a `tablet`-bound key through the same wording the
`capTablet` branch uses (`"pin"` → `"on, with a manager PIN"`).

**Where the owner would see it:** admin console → Access & permissions → "Recent changes here",
the strip at the top of the tree.
