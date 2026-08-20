# T15 — ADMIN ACCESS TREE & PEOPLE · improvement ideas

Working machinery for the merge terminal. The owner reads the chat window, not this file.

## 🟢 Built in this branch

| # | what | where it lives | commit |
|---|------|----------------|--------|
| I1 | On a phone, a person's row in the Users list now says their ROLE in words. Below 640px the role pill is hidden for width, which left the colour of the avatar circle as the only thing telling a manager from a cook from a waiter — fine on the seeded logins, which are literally named "…tablet", useless for a person called Raj. The separator is real text in the markup, not a `::after`: generated content is invisible to innerText, to a copy-paste and to a screen reader, and the first draft read as "Kitchenno phone" to everything except a screenshot. | admin console → Users → the list, on a phone | `a96c916e` |
| I2 | The ⓘ sheet stopped flashing two broken pictures on the ~86 rows that have no capture. See finding P8. | admin console → Access & permissions → the ⓘ on any row | `236f997e` |
| I3 | Guards: verify:access grew five checks — 21 (nothing offers "delete a bill", R27), 22 (every help-picture key names a real row), 23 (a module gate with no switch, with the three outstanding ones recorded by name), 24 (the spec's Menu table lists every row the screen shows), 25 (the admin's Add-a-user form asks for a waiter's tables while the server demands them), plus check 20 extended to both profile hosts. Every one was proven to fail by re-injecting the fault. | backend only, nothing on screen | across the ten commits |
| I4 | `lib/staffProfileShared.test.mjs` — the first unit test for this file. Locks the completeness rule and, deliberately, that kitchen has no profile (R7). | backend only, nothing on screen | `82921b1f` |
| I5 | **The three floor features got their switch back** (his decision, 2026-08-18): Take a new order · Move, merge & split tables · Table types. See finding H1. | admin console → Access & permissions → Main features | `b6fb6d89` |
| I6 | **A person's page mirrors the Access screen** (his rule, 2026-08-18): a manager went from 9 rows to 25, a waiter from 9 to 10 — everything on Default, the extras read-only with the restaurant's own value. | admin console → Users → a person → Permissions · and Access → Per person | `0b2bdf26` |
| I7 | **The Owner rows show the owner's own panel** (his ask, 2026-08-18): eight new captures of his own pages, replacing five "there wasn't a good picture" and two that were showing the MANAGER's screens. | admin console → Access & permissions → Owner → the ⓘ on any row | `e511192b` |
| I8 | Guards 26, 27 and 28 — an expectation header must be pure ASCII; a refused save must still be on screen a second later; the activity line says a waiter's PIN state in words. All three proven to fail by re-injecting the fault. | backend only, nothing on screen | `835ad550` · `6470d38f` · `24f1b7e2` |

## 🟡 Listed for the owner, not built

| # | what | why it is not built | where he would see it |
|---|------|---------------------|-----------------------|
| D1 | ~~A manager's profile shows 9 rows where Access shows 23~~ — **BUILT** on his instruction, 2026-08-18. See I6. | — | — |
| D2 | ~~The module gate with no switch~~ — **BUILT** on his instruction, 2026-08-18. See I5 and finding H1. | — | — |
| D3 | ~~Five owner rows show no picture~~ — **BUILT** on his instruction, 2026-08-18. See I7. | — | — |
| D4 | ~~The "Recent changes here" strip says "pin"~~ — **DONE** on his instruction, 2026-08-18. See finding H2. | — | — |
| D5 | The owner panel has **no Rating review page in its nav** at all, yet Access → Owner has a switch for it. The entitlement is real and gates `/api/owner/ratings`, so it is not a dead switch — but there is no page of his to switch off. | Noticed while capturing the owner's screens for I7. Whether that page should exist is a product decision, not a fault to fix inside this territory. | admin console → Access & permissions → Owner → Rating review · and the owner panel's own left nav, where no such link appears |
| D6 | A **new restaurant** is born with `table_ops_allowed = false` and `table_tags_allowed = false` (`lib/settingsClone.ts`), so every new restaurant starts without the merge/split menu and without table types until somebody switches them on. | Now that the switches exist he can see and set this per restaurant; changing what a NEW restaurant starts with is his call, and the file belongs to another terminal. | admin console → Access & permissions → Main features, on any restaurant created from now on |
