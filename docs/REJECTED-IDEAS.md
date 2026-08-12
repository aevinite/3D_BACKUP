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
| R7 | Any kind of PROFILE on the kitchen panel — including the one-time "👋 Finish setup" card (settled 2026-08-08: `LFH_NO_PROFILE_AT_ALL`) — a profile page, a pay record, a "👤 Profile" button, a personal-settings door | **NO, STANDING** (owner, 2026-07-29, re-confirmed 2026-08-05 and again **2026-08-07**: *"Kitchen panel will not have profile or stuff like that. I have already told this"*). This was asked twice and offered back to him a third time as an "improvement" — that is the mistake this whole file exists to stop. The kitchen keeps its login, its PIN and its action log; it has no profile of any kind and no button that says Profile. | `lib/staffProfileShared.ts` → `PROFILE_ROLES` · `public/panels/kitchen/app.js` → `LFH_SUPPRESS_SETTINGS_BTN` |
| R8 | Give a NEW restaurant explicit factory defaults for the guest-menu columns instead of cloning restaurant #1's (`menu_enabled`, `sessions_enabled`, `bubbles_enabled`, `menu_default_layout`, `menu_default_mode`, `menu_languages`, `menu_currencies`, `qop_allowed`, `qop_tables_allowed`, `qop_parcel_allowed`) — reported by sweep T6, 2026-08-10, as "a new restaurant is born with French House's three languages and Open-table on, which is not what the Access screen calls the default" | **NO** (owner, 2026-08-11) — deliberate. A new restaurant starting as a copy of the flagship's guest-menu setup is a useful starting point; the admin changes whatever differs on the Access screen afterwards. Do not add explicit defaults for these columns, and do not report the drift they show against `node.def` as a fault. (The tax, tablet, module and channel columns stay explicit — those are money, permissions and third-party accounts, not look-and-feel.) | `lib/settingsClone.ts` → the `platform_channels` block |

| R8 | Make the manager floor's "→ N more" chip say how many of the OFF-SCREEN tables need attention ("→ 15 more · 3 need you") | **NO** (2026-08-11): *"if the tables are assigned to the waiter, it will be assigned — they could able to see only that part, not others. And if they are not assigned, all will be visible. Then why we need this all?"* Who sees which tables is already decided by the waiter's section, so a chip re-ranking the hidden ones solves a problem the assignment already solves. The plain count stays. | `public/panels/editor/app.js` → `syncFloorMore()` |
| R9 | Show how long a party has been merged ("⇄ with T7 · 40m") so a forgotten merge stands out | **NO** (2026-08-11): *"I don't implement improvement number three. We will ignore improvement number three. We will skip it."* | `public/panels/editor/app.js` → the `ft-merge` chip in `floorTileHtml()` |
| R10 | Put the money beside the floor header's "To pay" count ("To pay 2 · ₹1,659") | **NO** (2026-08-11): *"We don't need improvement number six."* The count stays a count. | `public/panels/editor/app.js` → `floorStatsHtml()` |
| R11 | Stop the floor header's 🧾 KOT ▾ / ⚡ QO/P pair wrapping onto a second line (it costs ~60px above the tables at 1280px) | **NO** (2026-08-11): *"Don't solve p four. P four is perfectly fine. We don't need that."* The header's current layout is accepted as it is — do not re-flow it to keep the buttons on the title's line, and do not raise it again as a finding. | `public/panels/editor/style.css` → `.floor-head` / `.floor-head-acts` |
| R12 | Make the dish PRICE (and the muted meta line, and a sold-out dish's greyed price) obey their CSS colours by beating the `a *, .item-card-link * { color: inherit !important }` reset — reported by guest sweep T1, 2026-08-12, measured: the price computes as `--text` while `--accent` sits unused on the same element | **NO** (owner, 2026-08-12): *"I don't think P1 is a problem like I don't know like what are you saying like it's not a problem … I don't think it's required … because bill will be black and white colour will stand out."* The plain-text price is accepted on every restaurant, in both skins. Do not add `!important`, do not re-report it. | `app/globals.css` → the comment above `.dish-price` |
| R13 | Make the guest search-suggestion panel use the restaurant's own colours instead of the hardcoded `#1b120c` brown + `rgba(212,165,116,…)` gold — reported by guest sweep T1 as a white-label leak, measured identical on green-bowl, sakura-sushi, spice-route and aangan | **NO** (owner, 2026-08-12): *"P3 is completely trash. I want … all the panels and all that stuff write in a code as a comment that should be this colour only like golden and little french house theme one."* GOLDEN + the little-French-house theme is the intended house style here and on the panels. Do not swap these for `var(--accent)`, do not re-report it. | `app/globals.css` → the comment above `.search-dropdown` |
| R14 | An automatic translator for DISH names, so a guest browsing in Hindi can search a dish in Hindi (offered as sweep idea I6, 2026-08-12 — the third time this has been raised) | **NO** (owner, 2026-08-12): *"we will not do auto translator … I will tell you only, I will add the translated word, and we will fix that and keep that for the menu … So don't show it as a problem again."* He supplies the words himself when he wants them; they go in `searchAlias`. Never build it, never offer it. | `lib/menu.ts` → the dish-translation decision block |
| R15 | Translate the three remaining English app labels on the guest menu — the "Maximum 99 per dish" toast, the "<dish> added / tap to view your bill" toast, and the offline strip ("Your order is saved and will send by itself") | **NO** (owner, 2026-08-12, asked directly): *"No — English is fine for these."* Distinct from R11: these are our own labels, not dish names. Leave them as English literals; do not move them into `lib/i18n.ts`. | `components/FoodCard.tsx` → the 99-cap toast · `components/OfflineNotice.tsx` → `msg` |

| R16 | Give the GUEST menu a longer offline window than the 2 hours staff get, so a diner who returns after a few hours still sees the menu they were reading (T1 improvement 7, 2026-08-12) | **NO** (owner, 2026-08-12): *"there is no off-line limit for diner. Diner should be online."* The window exists for staff continuity; one number covers everyone. Do not add a per-family window, do not re-report it. | `public/sw.js` → the comment above `MAX_STALE_MS` |
| R17 | Refresh the currency conversion rates from a live FX feed instead of the hand-edited table (T1 improvement 12, 2026-08-12) | **NO** (owner, 2026-08-12): *"leave it and make sure you don't show as improvement or error again … this will be like this only."* No scheduled fetch, no stored per-restaurant rate. Not a finding. | `lib/format.ts` → the comment above `CURRENCIES` |

## Reversed (the owner changed his mind — newest first)

_(none yet)_
