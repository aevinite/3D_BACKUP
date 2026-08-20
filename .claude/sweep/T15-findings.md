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

### H1 · a module gate with no switch — RESOLVED by the owner, 2026-08-18

He chose the toggle: *"I want that toggle thing where you can able to check… I want to turn on and
turn off the feature if the restaurant required or not required."* Three rows are back on **Main
features** (`take_orders`, `table_ops`, `table_tags`), so the `module:` bindings in
`lib/accessModel.ts` are correct again and no other terminal's file was touched.
`scripts/verify-access-model.mjs` check 23's handoff list is empty and it still fails the day a
FOURTH module loses its row. Commit `b6fb6d89`.

**Still true, and worth him knowing:** seven restaurants are stored OFF for `table_ops` and six for
`table_tags`, and a NEW restaurant is born with both off (`lib/settingsClone.ts`). The switch shows
that honestly now; turning them on is a decision per restaurant, not a code change.

### H2 · the Recent-changes strip said "pin" — DONE, 2026-08-18

He approved it directly. `describeAccessPatch` now says "on, with a manager PIN" for a column-bound
waiter row, matching the `capTablet` branch below it. Commit `24f1b7e2` —
`app/api/admin/restaurants/access-tree/route.ts` is another terminal's file and was edited on his
instruction.

## A second round of problems, found while checking that every toggle works (2026-08-18)

| # | severity | state | what | where it lives | commit |
|---|----------|-------|------|----------------|--------|
| P11 | HIGH | fixed | **Two switches could not be saved at all.** "Quick order — send to a table" and "Parcel — send it out" did nothing when tapped: no request left the browser, and the save line read "Not saved". A header must be ISO-8859-1 and `fetch()` throws away the whole request if it is not — the `X-LFH-Expect` clash header carries the row's NAME, and both contain an em dash. The gate meant to protect a save was making it impossible. The staff profile had the same trap waiting on a person's own typing. `confirmed`. | admin console → Access & permissions → Main features → Quick order / Parcel → its two rows | `835ad550` |
| P12 | MEDIUM | fixed | A refused save on the Access screen showed its reason for one frame. The 409 path sets the sentence and reloads the row on the same line, and the reload cleared it — sampled every 100ms: there at +0ms, gone by +100ms. The switch snapped back with nothing to explain it. `confirmed`. | admin console → Access & permissions → any switch, when a second admin has moved it first | `6470d38f` |

**Everything else on that screen works.** 83 switchable rows were tapped in the browser and read
back from the server, one at a time, each put straight back: 73 in one sequential pass, and all 11
the pass could not reach — each a child of a row it had just switched off, so the greyed block
correctly refused the tap — worked when re-tested with the parent on.

