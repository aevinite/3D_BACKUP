# Sweep #10 · Terminal 18 — the access and permission model · findings

15 files, 4,250 lines. **483 older ledger rows re-run** (1 regression) and **503 new checks**
(`P187001`–`P187503`, `.claude/sweep/LEDGER/T18-S10.md`), 69 of them driving the real app on port 4418
or reading a real screen. **Six problems found, all six fixed, one commit each, each with a guard.**
No improvement was built — every idea is listed in the terminal report for the owner's decision.

## 1 · REGRESSION (P22157, green 2026-08-27) — the Access screen offered a permission the owner retired
`/aevinite → Access & permissions → Manager → Permission for manager` described a manager's starting
rights as including "whether they may set the printers up from their own computer". The owner retired
that permission on 2026-09-14; commit ecec794e removed the row and left the sentence. Fixed in
`lib/accessTree.ts`. **Guard:** `verify:access` check 51b (a count in the sentence must equal the
folder's rows; a retired phrase may not appear in any row's words). Sabotage-tested red.

## 2 · The Loyalty points switch painted OFF the moment it was tapped ON (P22167)
Seen on French House's real Access screen (restored afterwards): tap ON → database ON, switch grey
until a reload. `applyPatch()` merged a bag module's bare on/off where the state holds an entry, so
`nodeValue` read "nothing stored". It now merges exactly as the server does. **Guard:** `verify:access`
check 57 (every boolean row reads back what it was set to through the screen's own merge, from empty
and from the stored server shape). Sabotage-tested red. Seen fixed on the real screen.

## 3 · A staff date that is not a real day was stored, or failed with no field named
`isoDate()` in `lib/staffProfileShared.ts` checked the shape only. A birth date of 1990-02-30 was stored;
a joining/leaving/payment date died at Postgres behind a vague message; a mis-shaped payment date became
today. Now a real calendar day is required; joining/leaving/payment dates are refused in words; a bad
birth date leaves the stored one alone. Driven: the real admin route answers 400 "That joining date
isn't a real date — use the date picker." **Guard:** 3 unit tests (`npm run test:units`). Sabotage-tested.

## 4 · A manager's profile left out the three switches inside "Users — staff logins"
`capsForRole("manager")` stopped one level down in Manager settings, so Add a new login / Reset a
password / Switch a login off (owner-approved 2026-08-20) were on the Access screen and on no manager's
profile. Now listed read-only. Seen on French House manager diagm1's real profile ("6 settings").
**Guard:** `verify:access` check 58 (every storing row in Manager, Waiter and Owner is on that role's
person page). Sabotage-tested red.

## 5 · A staff text field sent an object or a list stored "[object Object]"
`str()` ran `String(v)`. A non-text value now keeps the stored profile field (proven on the real route:
profile read before and after, identical) and is refused in words for job/pay/payment fields.
**Guard:** 2 unit tests. Sabotage-tested.

## 6 · The two docs that describe the Access screen described a different one
`docs/ACCESS-MODEL.md`'s card table named "Auto-print KOT" (moved to Printing 2026-08-29) and omitted
the three floor switches and Loyalty points; B.2 said "TWO rows" over a folder of four.
`docs/STAFF-PROFILE.md` said a manager's page has two blocks (three) and 7 dropdowns (8). Corrected.
**Guard:** `verify:access` check 59 (names and numbers only). Sabotage-tested with the old docs.

## Recorded, not fixed in round 1 — ALL SETTLED IN ROUND 2 (items 16, 17, 18, 19, 20, 21 below)
- The OWNER's own panel can change one person's permissions (`/owner/staff/<id>`, live dropdowns), while
  `docs/ACCESS-MODEL.md` and CLAUDE.md say only the admin holds permissions. Which is right is his call.
- `docs/ACCESS-REDESIGN-SPEC.md`: four of its nine `☐` lines are built or were overruled by him later;
  CLAUDE.md quotes the count, so ticking them is his call and touches CLAUDE.md (not this territory).

## Outside this territory (one line each, left for their owners)
- The Access screen's save route takes any word for a pick-one sub-option, which is how French House
  holds `true` for "Who may take the menu down" (screen shows neither choice; the gate stays safe).
- `app/api/owner/staff/route.ts` keeps a never-called `capGroupsFor()`.
- `lib/settingsClone.ts` cites "REJECTED-IDEAS R8" for the inherited guest-menu settings; R8 is a
  different (moot) idea.
- On a phone, "Manager settings (what manager can do)" wraps below its chevron on the Access screen.

---

# ROUND 2 (2026-10-10) — 21 more problems, all fixed, one commit each, each with a guard

The owner: *"fix all the problems that you have listed … what you find outside of your territory for now …
check every single bit … I want zero error in my code."* 603 new checks (`P187504`–`P188000`,
`P165001`–`P165106`), all ✅; every round-1 row re-run green after the changes. Measured with line/branch
coverage (1,275 of 1,276 lines run; every unreached arm has an invariant row) and three mutation passes
(712 → 146 → 46 → 36 breaks undetected; the 36 are equivalent, each reason in
`scripts/sweep/t18s10/r2/equivalent.json`).

| # | where it lives (panel → screen → what you would see) | what was wrong → what it does now | guard |
|---|---|---|---|
| 7 | backend only, nothing on screen | `lib/accessModel.ts` held 16 helpers of the retired 4-rung panel nothing called → deleted | `verify:access` 60 |
| 8 | Admin → Access → Waiter (backend gate) | a waiter action stored in access_config ignored its restaurant switch → honours it | 61 |
| 9 | Admin → Access → Main → Move, merge & split (data) | ON for every restaurant but Aangan (the control); French House "who may take the menu down" held `true` → `"owner"` | live rows |
| 10 | Admin → Access → Extra → Delivery apps → key box | a key under 8 characters could show whole behind the dots → dots only (`credHint`) | 62 |
| 11 | backend only | a comment named a reader (featureDepth) that does not exist → corrected | 63 |
| 12 | Owner panel → any page (backend gate) | a failed read of the owner's pages OPENED every page → retries once, then closes | 64 |
| 13 | Owner → Staff → a person → Pay → Record a payment | ₹0.004 was saved as a ₹0.00 payment → refused after rounding | unit + live |
| 14 | Admin → "view as this person" (backend) | a missing restaurant id was not refused on its own → refused before any read | 65 |
| 15 | Admin → Access → Delivery apps / Ratings master | two admins both got "Saved", second silently won → first save wins, second told | 66 |
| 16 | Owner → Staff → a person → Permissions | the owner could change one person's permissions, against "only the admin holds permissions" → read-only, "set by Aevidine"; the route refuses | 67 + live |
| 17 | backend docs (`docs/ACCESS-REDESIGN-SPEC.md`) | 9 "open" lines, 7 built or overruled → ticked; 2 genuinely open | 54 |
| 18 | Admin → Access → any pick-one sub-option (save) | any word was stored → only its own choices, else refused in words | 68 + live |
| 19 | backend only | a never-called `capGroupsFor()` in the owner staff route → deleted | 69 |
| 20 | backend docs (`docs/REJECTED-IDEAS.md`) | a lost rejection (old R8) restored as R66; `lib/settingsClone.ts` cites it | `verify:rejected` 3c/3d |
| 21 | Admin → Access → a long row name, on a phone | the arrow sat alone on its own line → title wraps beside it | 70 + measured live |
| 22 | backend tooling | `verify:guards-alive` refused saves over a list of files meant to be gone → fixed (#1481) | itself |
| 23 | backend tooling | terminal 13's runner ended with a bare `process.exit()` → flushes first (#1481) | `verify:guards-alive` |
| 24 | Admin + Owner → the Access reply (browser network tab) | every delivery app's API key reached the browser in full → only the masked hint | 3 unit + live |
| 25 | backend only | `lib/accessModel.ts` is wiring only; each module carries the Access screen's own name | 71 |
| 26 | backend only | the retired `powerEntitled()` removed | 60 |
| 27 | backend only | the last unused export (`ModuleDef`) → sweep #9's P105050 is green; a duplicate "greater than zero" test merged | P105050 |

**One of my own checks was wrong, and was fixed:** the live "₹0.00 payment is refused" row sent the
person's id in a field the payment route does not read, got "not found", and passed. It now sends the
right field and requires the exact amount sentence and no row written.

**Still open (2 lines of the spec, genuinely unbuilt — not faults):** reset a staff PIN; a waiter's own
profile sections.
