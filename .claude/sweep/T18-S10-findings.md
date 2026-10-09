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

## Recorded, not fixed (decisions for the owner — in the chat report)
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
