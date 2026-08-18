# T15 — ADMIN ACCESS TREE & PEOPLE · improvement ideas

Working machinery for the merge terminal. The owner reads the chat window, not this file.

## 🟢 Built in this branch

| # | what | where it lives | commit |
|---|------|----------------|--------|
| I1 | On a phone, a person's row in the Users list now says their ROLE in words. Below 640px the role pill is hidden for width, which left the colour of the avatar circle as the only thing telling a manager from a cook from a waiter — fine on the seeded logins, which are literally named "…tablet", useless for a person called Raj. The separator is real text in the markup, not a `::after`: generated content is invisible to innerText, to a copy-paste and to a screen reader, and the first draft read as "Kitchenno phone" to everything except a screenshot. | admin console → Users → the list, on a phone | `a96c916e` |
| I2 | The ⓘ sheet stopped flashing two broken pictures on the ~86 rows that have no capture. See finding P8. | admin console → Access & permissions → the ⓘ on any row | `236f997e` |
| I3 | Guards: verify:access grew five checks — 21 (nothing offers "delete a bill", R27), 22 (every help-picture key names a real row), 23 (a module gate with no switch, with the three outstanding ones recorded by name), 24 (the spec's Menu table lists every row the screen shows), 25 (the admin's Add-a-user form asks for a waiter's tables while the server demands them), plus check 20 extended to both profile hosts. Every one was proven to fail by re-injecting the fault. | backend only, nothing on screen | across the ten commits |
| I4 | `lib/staffProfileShared.test.mjs` — the first unit test for this file. Locks the completeness rule and, deliberately, that kitchen has no profile (R7). | backend only, nothing on screen | `82921b1f` |

## 🟡 Listed for the owner, not built

| # | what | why it is not built | where he would see it |
|---|------|---------------------|-----------------------|
| D1 | A **manager's** profile shows 9 permission rows; Access → Manager shows 23. The owner's profile mirrors its read-only sub-rows (fixed in T6 for exactly this reason); the manager's does not, so the nine Edit-menu parts, the three log views, the dashboard reach, the bills reach and the two discount caps are absent from a manager's own page. | It would add 14 read-only rows to every manager's profile. That is a product decision about how long that block should be, not a fault — `docs/STAFF-PROFILE.md`'s rule ("a person's rows are exactly the rows Access has for their role") can be read either way. | admin console → Users → a manager → Permissions |
| D2 | The module gate with no switch — see 🔗 H1 in the findings file. Two ways out: make the three ladders permanent (what the model says today), or put the two switches back on Access. | It spans three files, two of which are other terminals'; and which way to go is his call, because "make them permanent" hands the KOT ▾ menu and the table-type ribbon to seven restaurants at once. | admin console → Access & permissions → Waiter, and every manager panel and tablet on those seven restaurants |
| D3 | Five owner-menu rows show "There wasn't a good picture for this one" although the app has a capture of that screen (`view_logs.png`, `view_customers.png`, `handle_issues.png`, `edit_settings.png`, `owner-staff.png`). They were unmapped after the 2026-08 renames. | The captures are of the MANAGER panel, not the owner's, and the owner's standing rule is "if there's no good photo which represents it, don't add any". Mapping them would put a picture of a different panel on an owner row — which is the thing he objected to. Re-capturing the owner's own screens is the honest answer, and that is a job, not a line. | admin console → Access & permissions → Owner → the ⓘ on Reports / Customers / Feedback / Settings / Audit & logs |
| D4 | The "Recent changes here" strip — see 🔗 H2. | The wording lives in the access-tree route, another terminal's file. | admin console → Access & permissions → Recent changes here |
