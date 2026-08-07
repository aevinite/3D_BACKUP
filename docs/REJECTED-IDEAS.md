# REJECTED IDEAS — things the owner has already said NO to

**Read this BEFORE suggesting any improvement, and before "fixing" anything that looks odd.**
An idea on this list has already been decided. Re-suggesting it wastes the owner's time and — worse —
invites someone to "fix" a thing that is deliberate.

> **The rule (owner, 2026-08-07):**
> *"everything I reject also should be written in the comment in the code."*
> *"While suggesting something and doing, at that time, you have to make sure I have already said no for it. So you don't repeat the same thing again."*
>
> So every rejection lands in **two** places: a row here, **and** a comment at the exact line in the
> code someone would otherwise change. `npm run verify:rejected` fails if a rejection listed here has
> no comment at its code site.

## How to add one

1. Add a row to the table below with the date and the owner's own words where you have them.
2. Put a comment at the code site starting with `REJECTED (owner, <date>):` and one line of why.
3. Run `npm run verify:rejected`.

Never delete a row. If the owner changes his mind, move it to **Reversed** at the bottom with the new
date — the history is the point.

---

## Rejected

| # | idea | owner's decision | code site |
|---|---|---|---|
| R1 | Make FREE table tiles shorter / denser so they stop being mostly blank space | **NO** (2026-08-07): *"I want free table to look empty only"* — a free tile looking empty is the design, not a defect. Do not shrink it, do not fill it, do not "use the space". | `public/panels/tablet/app.js` → `tileHtml()` |
| R2 | Hide the "Your tables 1–30 · 30 tables" section strip when the waiter holds the whole floor | **NO** (2026-08-07) — not wanted. | `public/panels/tablet/app.js` → `renderMySection()` |
| R3 | Collapse an EMPTY kitchen column ("New — Nothing here") on a phone to reclaim ~101px | **NO** (2026-08-07) — not wanted. The three columns stay whatever is in them. | `public/panels/kitchen/app.js` → `renderColumns()` |
| R4 | Widen the 💳 Mark-paid / ⏻ Close tap targets on a floor tile (they are 22–25px) | **NO** (2026-08-07): *"Don't do fix number four"* — the size is accepted; the two-step confirm is the answer to mis-taps. | `public/panels/tablet/app.js` → `tileHtml()` acts row |
| R5 | Give the kitchen a "ready for N minutes" ageing signal on the Ready column | **NO** (2026-08-07) — not picked. The cooking-age warning is enough. | `public/panels/kitchen/app.js` → `ageClass()` |
| R6 | Restate `TILE_MIN_PX` (the 44px tappability floor) in the waiter tablet alongside the per-row constants | **NO** (2026-08-07) — not picked. | `public/panels/tablet/app.js` → `FLOOR_PER_ROW_*` block |
| R7 | Any kind of PROFILE on the kitchen panel — a profile page, a pay record, a "👤 Profile" button, a personal-settings door | **NO, STANDING** (owner, 2026-07-29, re-confirmed 2026-08-05 and again **2026-08-07**: *"Kitchen panel will not have profile or stuff like that. I have already told this"*). This was asked twice and offered back to him a third time as an "improvement" — that is the mistake this whole file exists to stop. The kitchen keeps its login, its PIN and its action log; it has no profile of any kind and no button that says Profile. | `lib/staffProfileShared.ts` → `PROFILE_ROLES` · `public/panels/kitchen/app.js` → `LFH_SUPPRESS_SETTINGS_BTN` |

## Reversed (the owner changed his mind — newest first)

_(none yet)_
